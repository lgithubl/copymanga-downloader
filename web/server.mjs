import { createServer } from 'node:http'
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = path.join(__dirname, 'static')
const DATA_DIR = process.env.DATA_DIR || '/data'
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(DATA_DIR, 'downloads')
const API_DOMAIN = process.env.COPYMANGA_API_DOMAIN || 'api.copy202601.com'
const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || 8080)

const jobs = new Map()
const sseClients = new Set()

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

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf8')
  return body ? JSON.parse(body) : {}
}

async function copyFetch(urlPath, { method = 'GET', query, token, form } = {}) {
  const url = new URL(`https://${API_DOMAIN}${urlPath}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
  }

  const headers = { ...apiHeaders }
  let body
  if (token) headers.authorization = `Token ${token}`
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
  const files = await walk(DOWNLOAD_DIR)
  const comicFiles = files.filter((file) => path.basename(file) === 'comic.json')
  const comics = []
  for (const file of comicFiles) {
    try {
      const comic = JSON.parse(await readFile(file, 'utf8'))
      const comicDir = path.dirname(file)
      const chapterFiles = files.filter((candidate) => (
        candidate.startsWith(`${comicDir}${path.sep}`) && path.basename(candidate) === 'chapter.json'
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
      const imageFiles = files.filter((candidate) => (
        candidate.startsWith(`${comicDir}${path.sep}`) && /\.(webp|jpe?g)$/i.test(candidate)
      ))
      const info = await stat(file)
      comics.push({
        path: path.relative(DOWNLOAD_DIR, comicDir),
        comicPathWord: comic.comic?.path_word || comic.comic?.pathWord || comic.path_word || '',
        title: comic.comic?.name || comic.name || path.basename(comicDir),
        cover: comic.comic?.cover || comic.cover || '',
        author: comic.comic?.author || comic.author || [],
        groups: comic.groups || {},
        chapterUuids,
        chapterCount: chapterFiles.length,
        imageCount: imageFiles.length,
        updatedAt: info.mtime.toISOString(),
      })
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
  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'webp'
  const target = filePath.replace(/\.[^.]+$/, `.${ext}`)
  await mkdir(path.dirname(target), { recursive: true })
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

async function runJob(job, { comicPathWord, chapterUuids, token }) {
  try {
    updateJob(job, { status: 'running', message: '读取漫画信息' })
    const comic = await getComic(comicPathWord)
    const comicTitle = cleanName(comic.comic?.name || comic.name || comicPathWord)
    job.comicTitle = comicTitle
    const comicDir = path.join(DOWNLOAD_DIR, comicTitle)
    await mkdir(comicDir, { recursive: true })
    await writeFile(path.join(comicDir, 'comic.json'), JSON.stringify(comic, null, 2))

    for (const chapterUuid of chapterUuids) {
      const found = findChapter(comic, chapterUuid)
      if (!found) throw new Error(`找不到章节 ${chapterUuid}`)

      const chapterMeta = found.chapter
      const group = comic.groups?.[found.groupPathWord]
      const groupTitle = cleanName(group?.name || group?.title || chapterMeta.group_name || found.groupPathWord)
      const chapterTitle = cleanName(chapterMeta.name || chapterMeta.chapter_name || chapterMeta.chapter_title || chapterUuid)
      const order = String(chapterMeta.index ?? chapterMeta.order ?? job.doneChapters + 1).padStart(3, '0')

      updateJob(job, { message: `读取章节 ${chapterTitle}` })
      const chapter = await getChapter(comicPathWord, chapterUuid, token)
      const contents = chapter.chapter?.contents || []
      const words = chapter.chapter?.words || contents.map((_, index) => index)
      job.totalImages += contents.length
      updateJob(job, { totalImages: job.totalImages })

      const chapterDir = path.join(comicDir, groupTitle, `${order} ${chapterTitle}`)
      for (let i = 0; i < contents.length; i += 1) {
        const imageUrl = String(contents[i].url || '').replace('.c800x.', '.c1500x.')
        const index = Number(words[i] ?? i) + 1
        const filePath = path.join(chapterDir, `${String(index).padStart(3, '0')}.webp`)
        await downloadImage(imageUrl, filePath)
        job.doneImages += 1
        updateJob(job, { doneImages: job.doneImages, message: `下载 ${chapterTitle} ${job.doneImages}/${job.totalImages}` })
      }

      await writeFile(path.join(chapterDir, 'chapter.json'), JSON.stringify({ comicPathWord, chapterUuid, chapterMeta }, null, 2))
      job.doneChapters += 1
      updateJob(job, { doneChapters: job.doneChapters })
    }

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
    if (pathname === '/api/jobs/retry-failed' && req.method === 'POST') {
      const retried = []
      for (const job of [...jobs.values()]) {
        if (job.status !== 'failed') continue
        const retry = createJob(job)
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
      const job = createJob(body)
      startJob(job)
      return json(res, 202, publicJob(job))
    }

    return serveStatic(req, res, pathname)
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: error.message })
  }
}

await mkdir(DOWNLOAD_DIR, { recursive: true })
createServer(route).listen(PORT, HOST, () => {
  console.log(`copymanga web listening on http://${HOST}:${PORT}`)
  console.log(`download dir: ${DOWNLOAD_DIR}`)
})
