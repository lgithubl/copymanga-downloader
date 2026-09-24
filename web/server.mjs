import { createServer } from 'node:http'
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = path.join(__dirname, 'static')
const DATA_DIR = process.env.DATA_DIR || '/data'
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(DATA_DIR, 'downloads')
const DEFAULT_API_DOMAIN = process.env.COPYMANGA_API_DOMAIN || 'api.copy202601.com'
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || 8080)

const jobs = new Map()
const sseClients = new Set()
let config = defaultConfig()

const apiHeaders = {
  'User-Agent': 'COPY/3.0.0',
  Accept: 'application/json',
  version: '2025.08.15',
  platform: '1',
  webp: '1',
  region: '1',
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function text(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function cleanName(value) {
  return String(value || '')
    .replace(/[\\/]/g, ' ')
    .replace(/:/g, '：')
    .replace(/\*/g, '⭐')
    .replace(/\?/g, '？')
    .replace(/"/g, "'")
    .replace(/</g, '《')
    .replace(/>/g, '》')
    .replace(/\|/g, '丨')
    .trim() || 'unknown'
}

function defaultConfig() {
  return {
    token: '',
    downloadDir: DOWNLOAD_DIR,
    metadataDir: '',
    exportDir: path.join(DATA_DIR, 'exports'),
    apiDomainMode: 'Default',
    customApiDomain: DEFAULT_API_DOMAIN,
    downloadFormat: 'Webp',
    enableFileLogger: true,
    chapterConcurrency: 3,
    chapterDownloadIntervalSec: 0,
    imgConcurrency: 6,
    imgDownloadIntervalSec: 0,
    updateDownloadedComicsIntervalSec: 0,
    enablePickedComicSyncGuard: false,
    comicDirFmt: '{comic_title}',
    chapterDirFmt: '{group_title}/{order} {chapter_title}',
    exportDirFmt: '{comic_title}/{export_format}/{group_title}/{order} {chapter_title}',
    mergePdfFmt: '{comic_title}/pdf/{group_title}',
    createPdfConcurrency: 2,
    enableMergePdf: true,
    exportSkipMode: 'None',
  }
}

function normalizeConfig(value) {
  const defaults = defaultConfig()
  const apiDomainMode = value?.apiDomainMode === 'Custom' ? 'Custom' : 'Default'
  const downloadFormat = value?.downloadFormat === 'Jpeg' ? 'Jpeg' : 'Webp'
  const exportSkipMode = ['None', 'SkipExisting', 'SkipExported'].includes(value?.exportSkipMode)
    ? value.exportSkipMode
    : defaults.exportSkipMode
  return {
    token: String(value?.token || defaults.token),
    downloadDir: DOWNLOAD_DIR,
    metadataDir: String(value?.metadataDir || defaults.metadataDir),
    exportDir: String(value?.exportDir || defaults.exportDir),
    apiDomainMode,
    customApiDomain: String(value?.customApiDomain || value?.apiDomain || defaults.customApiDomain).trim() || defaults.customApiDomain,
    apiDomain: apiDomainMode === 'Custom'
      ? (String(value?.customApiDomain || value?.apiDomain || defaults.customApiDomain).trim() || defaults.customApiDomain)
      : DEFAULT_API_DOMAIN,
    downloadFormat,
    enableFileLogger: Boolean(value?.enableFileLogger ?? defaults.enableFileLogger),
    chapterConcurrency: clampNumber(value?.chapterConcurrency, 1, 30, defaults.chapterConcurrency),
    chapterDownloadIntervalSec: clampNumber(value?.chapterDownloadIntervalSec, 0, 3600, defaults.chapterDownloadIntervalSec),
    imgConcurrency: clampNumber(value?.imgConcurrency, 1, 60, defaults.imgConcurrency),
    imgDownloadIntervalSec: clampNumber(value?.imgDownloadIntervalSec, 0, 3600, defaults.imgDownloadIntervalSec),
    updateDownloadedComicsIntervalSec: clampNumber(
      value?.updateDownloadedComicsIntervalSec,
      0,
      3600,
      defaults.updateDownloadedComicsIntervalSec,
    ),
    enablePickedComicSyncGuard: Boolean(value?.enablePickedComicSyncGuard ?? defaults.enablePickedComicSyncGuard),
    comicDirFmt: String(value?.comicDirFmt || defaults.comicDirFmt),
    chapterDirFmt: String(value?.chapterDirFmt || defaults.chapterDirFmt),
    exportDirFmt: String(value?.exportDirFmt || defaults.exportDirFmt),
    mergePdfFmt: String(value?.mergePdfFmt || defaults.mergePdfFmt),
    createPdfConcurrency: clampNumber(value?.createPdfConcurrency, 1, 30, defaults.createPdfConcurrency),
    enableMergePdf: Boolean(value?.enableMergePdf ?? defaults.enableMergePdf),
    exportSkipMode,
  }
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

async function loadConfig() {
  try {
    return normalizeConfig(JSON.parse(await readFile(CONFIG_PATH, 'utf8')))
  } catch {
    return defaultConfig()
  }
}

async function saveConfig(nextConfig) {
  config = normalizeConfig({ ...config, ...nextConfig })
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
  return config
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf8')
  return body ? JSON.parse(body) : {}
}

async function copyFetch(urlPath, { method = 'GET', query, token, form } = {}) {
  const url = new URL(`https://${getApiDomain()}${urlPath}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
  }

  const headers = { ...apiHeaders }
  let body
  const effectiveToken = token || config.token
  if (effectiveToken) headers.authorization = `Token ${effectiveToken}`
  if (form) {
    body = new URLSearchParams(form)
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
  }

  const resp = await fetch(url, { method, headers, body })
  const raw = await resp.text()
  if (!resp.ok && resp.status !== 210) {
    throw new Error(`CopyManga HTTP ${resp.status}: ${raw}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`CopyManga returned non-JSON: ${raw.slice(0, 300)}`)
  }
  if (parsed.code !== 200) {
    throw new Error(`CopyManga code ${parsed.code}: ${raw.slice(0, 500)}`)
  }
  return parsed.results
}

function getApiDomain() {
  return config.apiDomainMode === 'Custom' ? config.customApiDomain : DEFAULT_API_DOMAIN
}

function formatTemplate(template, params) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)(?::([^}]+))?\}/g, (_, key, fmt) => {
    const raw = params[key]
    if (raw === undefined || raw === null) return ''
    if (key === 'order' && fmt) return formatOrder(raw, fmt)
    return String(raw)
  })
}

function formatOrder(value, fmt) {
  const order = String(value)
  const [intPart, fracPart = ''] = order.split('.')
  const match = fmt.match(/^0>(\d+)$/)
  const formatted = match ? intPart.padStart(Number(match[1]), '0') : intPart
  return fracPart && fracPart !== '0' ? `${formatted}.${fracPart}` : formatted
}

function formatPath(template, params) {
  const parts = String(template)
    .split('/')
    .map((part) => cleanName(formatTemplate(part, params)))
    .filter(Boolean)
  return path.join(...parts)
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

function metadataRoot() {
  return config.metadataDir ? path.resolve(config.metadataDir) : DOWNLOAD_DIR
}

function authorText(comic) {
  return (comic.comic?.author || comic.author || [])
    .map((author) => author.name)
    .filter(Boolean)
    .join(', ')
}

async function login(username, password) {
  const salt = 1729
  return copyFetch('/api/v3/login', {
    method: 'POST',
    form: {
      username,
      password: Buffer.from(`${password}-${salt}`).toString('base64'),
      salt,
    },
  })
}

async function search(keyword, page = 1) {
  const limit = 20
  return copyFetch('/api/v3/search/comic', {
    query: {
      limit,
      offset: (Number(page) - 1) * limit,
      q: keyword,
      q_type: '',
      platform: 1,
    },
  })
}

function favoriteOrdering(value) {
  switch (value) {
    case 'Updated':
      return '-datetime_updated'
    case 'Read':
      return '-datetime_browse'
    case 'Added':
    default:
      return '-datetime_modifier'
  }
}

async function getFavorite(page = 1, ordering = 'Added', token = '') {
  const limit = 18
  if (!token) {
    return { list: [], total: 0, limit, offset: (Number(page) - 1) * limit }
  }
  return copyFetch('/api/v3/member/collect/comics', {
    token,
    query: {
      limit,
      offset: (Number(page) - 1) * limit,
      free_type: 1,
      ordering: favoriteOrdering(ordering),
    },
  })
}

async function getGroupChapters(comicPathWord, groupPathWord) {
  const limit = 100
  const first = await copyFetch(`/api/v3/comic/${comicPathWord}/group/${groupPathWord}/chapters`, {
    query: { limit, offset: 0 },
  })
  const list = [...(first.list || [])]
  const totalPages = Math.ceil((first.total || 0) / limit)
  for (let page = 2; page <= totalPages; page += 1) {
    const pageData = await copyFetch(`/api/v3/comic/${comicPathWord}/group/${groupPathWord}/chapters`, {
      query: { limit, offset: (page - 1) * limit },
    })
    list.push(...(pageData.list || []))
  }
  return list
}

async function getComic(comicPathWord) {
  const data = await copyFetch(`/api/v3/comic2/${comicPathWord}`, { query: { platform: 1 } })
  const groupsChapters = {}
  for (const groupPathWord of Object.keys(data.groups || {})) {
    groupsChapters[groupPathWord] = await getGroupChapters(comicPathWord, groupPathWord)
  }
  return markDownloadedChapters({ ...data, groupsChapters }, await listDownloaded())
}

async function getChapter(comicPathWord, chapterUuid, token) {
  return copyFetch(`/api/v3/comic/${comicPathWord}/chapter2/${chapterUuid}`, {
    token,
    query: { platform: 1 },
  })
}

function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) client.write(payload)
}

function updateJob(job, patch) {
  if (!jobs.has(job.id)) return
  Object.assign(job, patch, { updatedAt: new Date().toISOString() })
  emit('job', publicJob(job))
}

function publicJob(job) {
  const { token, ...safeJob } = job
  return safeJob
}

function publicJobs() {
  return [...jobs.values()].map(publicJob)
}

function createJob({ comicPathWord, chapterUuids, token }) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id,
    status: 'queued',
    comicPathWord,
    chapterUuids,
    token,
    totalChapters: chapterUuids.length,
    doneChapters: 0,
    totalImages: 0,
    doneImages: 0,
    message: '等待开始',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function startJob(job) {
  job.status = 'queued'
  job.doneChapters = 0
  job.totalImages = 0
  job.doneImages = 0
  job.message = '等待开始'
  job.updatedAt = new Date().toISOString()
  jobs.set(job.id, job)
  emit('job', publicJob(job))
  runJob(job, job)
}

function findChapter(comic, chapterUuid) {
  for (const [groupPathWord, chapters] of Object.entries(comic.groupsChapters || {})) {
    const chapter = chapters.find((item) => item.uuid === chapterUuid || item.chapter_uuid === chapterUuid)
    if (chapter) return { groupPathWord, chapter }
  }
  return undefined
}

async function walk(dir) {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(fullPath))
    else files.push(fullPath)
  }
  return files
}

async function listDownloaded() {
  const downloadFiles = await walk(DOWNLOAD_DIR)
  const metadataFiles = config.metadataDir ? await walk(metadataRoot()) : downloadFiles
  const comicFiles = metadataFiles.filter((file) => path.basename(file) === 'comic.json')
  const comics = []
  for (const file of comicFiles) {
    try {
      const comic = JSON.parse(await readFile(file, 'utf8'))
      const metadataComicDir = path.dirname(file)
      const relativeComicDir = path.relative(metadataRoot(), metadataComicDir)
      const downloadComicDir = path.join(DOWNLOAD_DIR, relativeComicDir)
      const chapterFiles = metadataFiles.filter((candidate) => (
        candidate.startsWith(`${metadataComicDir}${path.sep}`) && path.basename(candidate) === 'chapter.json'
      ))
      const chapterUuids = []
      for (const chapterFile of chapterFiles) {
        try {
          const chapter = JSON.parse(await readFile(chapterFile, 'utf8'))
          if (chapter.chapterUuid) chapterUuids.push(chapter.chapterUuid)
        } catch {
          // Ignore broken chapter metadata and keep the rest of the inventory usable.
        }
      }
      const imageFiles = downloadFiles.filter((candidate) => (
        candidate.startsWith(`${downloadComicDir}${path.sep}`) && /\.(webp|jpe?g)$/i.test(candidate)
      ))
      const info = await stat(file)
      comics.push({
        path: relativeComicDir,
        comicPathWord: comic.comic?.path_word || comic.comic?.pathWord || comic.path_word || '',
        title: comic.comic?.name || comic.name || path.basename(downloadComicDir),
        cover: comic.comic?.cover || comic.cover || '',
        author: comic.comic?.author || comic.author || [],
        groups: comic.groups || {},
        chapterUuids,
        chapterCount: chapterFiles.length,
        imageCount: imageFiles.length,
        updatedAt: info.mtime.toISOString(),
      })
      if (config.updateDownloadedComicsIntervalSec > 0) await sleep(config.updateDownloadedComicsIntervalSec)
    } catch (error) {
      console.warn(`skip invalid inventory file ${file}: ${error.message}`)
    }
  }
  return comics.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function markDownloadedChapters(comic, downloadedComics) {
  const comicPathWord = comic.comic?.path_word || comic.comic?.pathWord || comic.path_word || ''
  const downloaded = downloadedComics.find((item) => item.comicPathWord === comicPathWord)
  if (!downloaded) return comic

  const downloadedChapterUuids = new Set(downloaded.chapterUuids || [])
  for (const chapters of Object.values(comic.groupsChapters || {})) {
    for (const chapter of chapters) {
      const uuid = chapter.uuid || chapter.chapter_uuid || chapter.chapterUuid
      chapter.isDownloaded = downloadedChapterUuids.has(uuid)
    }
  }
  comic.isDownloaded = true
  return comic
}

async function downloadImage(url, filePath) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`image HTTP ${resp.status}: ${url}`)
  const contentType = resp.headers.get('content-type') || ''
  const ext = config.downloadFormat === 'Jpeg' ? 'jpg' : (contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'webp')
  const target = filePath.replace(/\.[^.]+$/, `.${ext}`)
  await mkdir(path.dirname(target), { recursive: true })
  if (config.downloadFormat === 'Jpeg' && contentType.includes('webp')) {
    throw new Error('Web 版暂未实现 webp 转 jpg，请使用 Webp 下载格式')
  }
  const stream = createWriteStream(target)
  await new Promise((resolve, reject) => {
    resp.body.pipeTo(
      new WritableStream({
        write(chunk) {
          stream.write(Buffer.from(chunk))
        },
        close() {
          stream.end(resolve)
        },
        abort(error) {
          stream.destroy()
          reject(error)
        },
      }),
    ).catch(reject)
  })
}

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
}

async function runJob(job, { comicPathWord, chapterUuids, token }) {
  try {
    updateJob(job, { status: 'running', message: '读取漫画信息' })
    const comic = await getComic(comicPathWord)
    const comicTitle = cleanName(comic.comic?.name || comic.name || comicPathWord)
    const baseParams = {
      comic_uuid: comic.comic?.uuid || comic.uuid || '',
      comic_path_word: comic.comic?.path_word || comic.comic?.pathWord || comicPathWord,
      comic_title: comic.comic?.name || comic.name || comicPathWord,
      author: authorText(comic),
    }
    job.comicTitle = comicTitle
    const relativeComicDir = formatPath(config.comicDirFmt, baseParams)
    const comicDir = path.join(DOWNLOAD_DIR, relativeComicDir)
    const metadataComicDir = path.join(metadataRoot(), relativeComicDir)
    await mkdir(comicDir, { recursive: true })
    await mkdir(metadataComicDir, { recursive: true })
    await writeFile(path.join(metadataComicDir, 'comic.json'), JSON.stringify(comic, null, 2))

    await runWithConcurrency(chapterUuids, config.chapterConcurrency, async (chapterUuid) => {
      const found = findChapter(comic, chapterUuid)
      if (!found) throw new Error(`找不到章节 ${chapterUuid}`)

      const chapterMeta = found.chapter
      const group = comic.groups?.[found.groupPathWord]
      const groupTitle = cleanName(group?.name || group?.title || chapterMeta.group_name || found.groupPathWord)
      const chapterTitle = cleanName(chapterMeta.name || chapterMeta.chapter_name || chapterMeta.chapter_title || chapterUuid)
      const order = chapterMeta.ordered ?? chapterMeta.index ?? chapterMeta.order ?? job.doneChapters + 1

      updateJob(job, { message: `读取章节 ${chapterTitle}` })
      const chapter = await getChapter(comicPathWord, chapterUuid, token)
      const contents = chapter.chapter?.contents || []
      const words = chapter.chapter?.words || contents.map((_, index) => index)
      job.totalImages += contents.length
      updateJob(job, { totalImages: job.totalImages })

      const chapterDir = path.join(comicDir, formatPath(config.chapterDirFmt, {
        ...baseParams,
        group_path_word: found.groupPathWord,
        group_title: groupTitle,
        chapter_uuid: chapterUuid,
        chapter_title: chapterTitle,
        order,
      }))
      await runWithConcurrency(contents, config.imgConcurrency, async (content, i) => {
        const imageUrl = String(content.url || '').replace('.c800x.', '.c1500x.')
        const index = Number(words[i] ?? i) + 1
        const filePath = path.join(chapterDir, `${String(index).padStart(3, '0')}.webp`)
        await downloadImage(imageUrl, filePath)
        job.doneImages += 1
        updateJob(job, { doneImages: job.doneImages, message: `下载 ${chapterTitle} ${job.doneImages}/${job.totalImages}` })
        if (config.imgDownloadIntervalSec > 0) await sleep(config.imgDownloadIntervalSec)
      })

      const relativeChapterDir = path.relative(comicDir, chapterDir)
      const metadataChapterDir = path.join(metadataComicDir, relativeChapterDir)
      await mkdir(metadataChapterDir, { recursive: true })
      await writeFile(path.join(metadataChapterDir, 'chapter.json'), JSON.stringify({ comicPathWord, chapterUuid, chapterMeta }, null, 2))
      job.doneChapters += 1
      updateJob(job, { doneChapters: job.doneChapters })
      if (config.chapterDownloadIntervalSec > 0) await sleep(config.chapterDownloadIntervalSec)
    })

    updateJob(job, { status: 'completed', message: '下载完成' })
  } catch (error) {
    updateJob(job, { status: 'failed', message: error.message })
  }
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  const filePath = path.normalize(path.join(STATIC_DIR, relative))
  if (!filePath.startsWith(STATIC_DIR)) return text(res, 403, 'Forbidden')
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return text(res, 404, 'Not found')
    const body = await readFile(filePath)
    const ext = path.extname(filePath)
    const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html'
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': body.length })
    res.end(body)
  } catch {
    text(res, 404, 'Not found')
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = decodeURIComponent(url.pathname)

  try {
    if (pathname === '/health') return json(res, 200, { ok: true })
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      res.write(`event: ready\ndata: {}\n\n`)
      return
    }
    if (pathname === '/api/jobs' && req.method === 'GET') return json(res, 200, publicJobs())
    if (pathname === '/api/config' && req.method === 'GET') return json(res, 200, config)
    if (pathname === '/api/config' && req.method === 'POST') {
      return json(res, 200, await saveConfig(await readJson(req)))
    }
    if (pathname === '/api/jobs/retry-failed' && req.method === 'POST') {
      const retried = []
      for (const [id, job] of [...jobs.entries()]) {
        if (job.status !== 'failed') continue
        const retry = createJob(job)
        jobs.delete(id)
        emit('jobDelete', { id })
        startJob(retry)
        retried.push(publicJob(retry))
      }
      return json(res, 202, { retried })
    }
    if (pathname === '/api/jobs/clear-active' && req.method === 'POST') {
      let cleared = 0
      for (const [id, job] of [...jobs.entries()]) {
        if (job.status === 'completed') continue
        jobs.delete(id)
        cleared += 1
        emit('jobDelete', { id })
      }
      return json(res, 200, { cleared })
    }
    if (pathname === '/api/downloaded' && req.method === 'GET') return json(res, 200, await listDownloaded())
    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, 200, await login(body.username, body.password))
    }
    if (pathname === '/api/profile' && req.method === 'GET') {
      return json(res, 200, await copyFetch('/api/v3/member/info', { token: url.searchParams.get('token') }))
    }
    if (pathname === '/api/search' && req.method === 'GET') {
      return json(res, 200, await search(url.searchParams.get('q') || '', url.searchParams.get('page') || 1))
    }
    if (pathname === '/api/favorite' && req.method === 'GET') {
      return json(res, 200, await getFavorite(
        url.searchParams.get('page') || 1,
        url.searchParams.get('ordering') || 'Added',
        url.searchParams.get('token') || '',
      ))
    }
    if (pathname.startsWith('/api/comic/') && req.method === 'GET') {
      return json(res, 200, await getComic(pathname.split('/').pop()))
    }
    if (pathname.startsWith('/api/chapter/') && req.method === 'GET') {
      const [, , , comicPathWord, chapterUuid] = pathname.split('/')
      return json(res, 200, await getChapter(comicPathWord, chapterUuid, url.searchParams.get('token') || ''))
    }
    if (pathname === '/api/download' && req.method === 'POST') {
      const body = await readJson(req)
      if (!body.comicPathWord || !Array.isArray(body.chapterUuids) || body.chapterUuids.length === 0) {
        return json(res, 400, { error: 'comicPathWord and chapterUuids are required' })
      }
      const jobs = body.chapterUuids.map((chapterUuid) => createJob({
        ...body,
        chapterUuids: [chapterUuid],
      }))
      for (const job of jobs) startJob(job)
      return json(res, 202, { jobs: jobs.map(publicJob) })
    }

    return serveStatic(req, res, pathname)
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: error.message })
  }
}

await mkdir(DOWNLOAD_DIR, { recursive: true })
config = await loadConfig()
createServer(route).listen(PORT, HOST, () => {
  console.log(`copymanga web listening on http://${HOST}:${PORT}`)
  console.log(`download dir: ${DOWNLOAD_DIR}`)
})
