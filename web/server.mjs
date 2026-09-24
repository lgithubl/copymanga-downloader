import { createServer } from 'node:http'
import { readFile, readdir, stat, writeFile, mkdir, rename } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import { promisify } from 'node:util'
import { registerLibraryHandler, libraryHandler, libraryTypes, scanLibraryItems } from './library/registry.mjs'
import { createEpubHandler } from './library/types/epub.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = path.join(__dirname, 'static')
const DATA_DIR = process.env.DATA_DIR || '/data'
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(DATA_DIR, 'downloads')
const PREVIEW_CACHE_DIR = path.join(DATA_DIR, 'cache', 'preview')
const READING_PROGRESS_DIR = path.join(DATA_DIR, 'cache', 'reading-progress')
const DEFAULT_API_DOMAIN = process.env.COPYMANGA_API_DOMAIN || 'api.copy202601.com'
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || 8080)

const jobs = new Map()
const inventoryUpdates = new Map()
const sseClients = new Set()
const previewSessions = new Map()
let config = defaultConfig()
const execFileAsync = promisify(execFile)
const APP_COMIC_METADATA = '元数据.json'
const APP_CHAPTER_METADATA = '章节元数据.json'

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

function binary(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=3600',
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

function safeSegment(value) {
  return cleanName(value).replace(/\.+/g, '.').slice(0, 180)
}

async function pathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function moveAside(sourcePath, reason = 'redownload') {
  if (!sourcePath || !(await pathExists(sourcePath))) return null
  const resolvedSource = path.resolve(sourcePath)
  const targetRoot = path.join('/tmp', `copymanga-${reason}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const targetPath = path.join(targetRoot, safeSegment(path.basename(resolvedSource)))
  await mkdir(targetRoot, { recursive: true })
  try {
    await rename(resolvedSource, targetPath)
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    await execFileAsync('mv', [resolvedSource, targetPath])
  }
  return targetPath
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
    viewerImageBatchSize: 5,
    readColor: '#ecfdf3',
    unreadColor: '#fff7ed',
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
    viewerImageBatchSize: clampNumber(value?.viewerImageBatchSize, 1, 50, defaults.viewerImageBatchSize),
    readColor: normalizeColor(value?.readColor, defaults.readColor),
    unreadColor: normalizeColor(value?.unreadColor, defaults.unreadColor),
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

function normalizeColor(value, fallback) {
  const text = String(value || '').trim()
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback
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

async function readBuffer(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function readMultipart(req) {
  const contentType = req.headers['content-type'] || ''
  const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1]?.replace(/^"|"$/g, '')
  if (!boundary) throw new Error('multipart boundary is required')
  const body = await readBuffer(req)
  const parts = splitBuffer(body, Buffer.from(`--${boundary}`))
  const fields = {}
  const files = []
  for (const rawPart of parts) {
    let part = trimPart(rawPart)
    if (!part.length || part.equals(Buffer.from('--'))) continue
    if (part.subarray(0, 2).toString() === '--') continue
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd < 0) continue
    const headerText = part.subarray(0, headerEnd).toString('utf8')
    let content = part.subarray(headerEnd + 4)
    if (content.subarray(-2).toString() === '\r\n') content = content.subarray(0, -2)
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headerText)?.[1] || ''
    const name = /name="([^"]+)"/i.exec(disposition)?.[1] || ''
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || ''
    if (!name) continue
    if (filename) {
      files.push({ name, filename, buffer: content })
    } else {
      fields[name] = content.toString('utf8')
    }
  }
  return { fields, files }
}

function splitBuffer(buffer, separator) {
  const parts = []
  let start = 0
  let index = buffer.indexOf(separator, start)
  while (index !== -1) {
    parts.push(buffer.subarray(start, index))
    start = index + separator.length
    index = buffer.indexOf(separator, start)
  }
  parts.push(buffer.subarray(start))
  return parts
}

function trimPart(buffer) {
  let start = 0
  let end = buffer.length
  while (start < end && (buffer[start] === 13 || buffer[start] === 10)) start += 1
  while (end > start && (buffer[end - 1] === 13 || buffer[end - 1] === 10)) end -= 1
  return buffer.subarray(start, end)
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

async function listComics({ ordering = '-datetime_updated', limit = 10, offset = 0, theme = '', region = '', status = '' }) {
  const query = {
    ordering,
    limit: clampNumber(limit, 1, 100, 10),
    offset: Math.max(0, Number(offset) || 0),
  }
  if (theme) query.theme = theme
  if (region !== '') query.region = region
  if (status !== '') query.status = status
  return copyFetch('/api/v3/comics', { query })
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

function publicInventoryUpdate(update) {
  return update
}

function latestInventoryUpdate() {
  return [...inventoryUpdates.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
}

function createJob({ comicPathWord, chapterUuids, token, force = false }) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id,
    status: 'queued',
    comicPathWord,
    chapterUuids,
    token,
    force: Boolean(force),
    totalChapters: chapterUuids.length,
    doneChapters: 0,
    totalImages: 0,
    doneImages: 0,
    message: '等待开始',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function createChapterJobs({ comicPathWord, chapterUuids, token, force = false }) {
  return chapterUuids.map((chapterUuid) => createJob({
    comicPathWord,
    chapterUuids: [chapterUuid],
    token,
    force,
  }))
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
  normalizeComicMetadata(comic)
  for (const [groupPathWord, chapters] of Object.entries(comic.groupsChapters || {})) {
    const chapter = chapters.find((item) => chapterUuidOf(item) === chapterUuid)
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
  const comicFiles = collectComicMetadataFiles(metadataFiles)
  const comics = []
  for (const file of comicFiles) {
    try {
      const comic = normalizeComicMetadata(JSON.parse(await readFile(file, 'utf8')))
      const metadataComicDir = path.dirname(file)
      const relativeComicDir = inferRelativeComicDir({ comic, comicFile: file, metadataComicDir })
      const downloadComicDir = path.join(DOWNLOAD_DIR, relativeComicDir)
      const chapterFiles = collectChapterMetadataFiles(metadataFiles, metadataComicDir)
      const chapterUuids = []
      for (const chapterFile of chapterFiles) {
        try {
          const chapter = JSON.parse(await readFile(chapterFile, 'utf8'))
          const chapterUuid = chapterUuidOf(chapter)
          if (chapterUuid) chapterUuids.push(chapterUuid)
        } catch {
          // Ignore broken chapter metadata and keep the rest of the inventory usable.
        }
      }
      const imageFiles = downloadFiles.filter((candidate) => (
        candidate.startsWith(`${downloadComicDir}${path.sep}`) && /\.(webp|jpe?g)$/i.test(candidate)
      ))
      const allChapterUuids = collectAllChapterUuids(comic)
      const remoteChapterTotal = countComicChapters(comic)
      const info = await stat(file)
      comics.push({
        path: relativeComicDir,
        metadataComicFile: file,
        metadataComicDir,
        comicPathWord: comicPathWordOf(comic),
        title: comicTitleOf(comic, path.basename(downloadComicDir)),
        cover: comic.comic?.cover || comic.cover || '',
        author: comic.comic?.author || comic.author || [],
        groups: comic.groups || {},
        allChapterUuids,
        chapterUuids,
        chapterCount: chapterFiles.length,
        remoteChapterTotal: remoteChapterTotal || null,
        imageCount: imageFiles.length,
        updatedAt: info.mtime.toISOString(),
      })
    } catch (error) {
      console.warn(`skip invalid inventory file ${file}: ${error.message}`)
    }
  }
  return comics.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function collectAllChapterUuids(comic) {
  normalizeComicMetadata(comic)
  return Object.values(comic.groupsChapters || {})
    .flatMap((chapters) => Array.isArray(chapters) ? chapters : [])
    .map(chapterUuidOf)
    .filter(Boolean)
}

function countComicChapters(comic) {
  normalizeComicMetadata(comic)
  return Object.values(comic.groupsChapters || {})
    .reduce((total, chapters) => total + (Array.isArray(chapters) ? chapters.length : 0), 0)
}

async function writeDownloadedComicMetadata(downloadedComic, comic) {
  if (!downloadedComic.path) return
  normalizeComicMetadata(comic)
  const comicDir = path.join(DOWNLOAD_DIR, downloadedComic.path)
  const metadataFile = appComicMetadataPath(comic, comicDir)
  await mkdir(path.dirname(metadataFile), { recursive: true })
  await writeFile(metadataFile, JSON.stringify(appComicMetadataFrom(comic), null, 2))
}

async function getDownloadedComic(comicPathWord, { refresh = false, token = '' } = {}) {
  const downloadedComics = await listDownloaded()
  const downloadedComic = downloadedComics.find((item) => item.comicPathWord === comicPathWord)
  if (!downloadedComic) throw new Error(`本地库存不存在 ${comicPathWord}`)
  if (refresh) {
    const comic = await getComic(comicPathWord)
    await writeDownloadedComicMetadata(downloadedComic, comic)
    return { ...comic, source: 'remote', downloadedInfo: downloadedComic }
  }

  const metadataComicFile = downloadedComic.metadataComicFile || path.join(metadataRoot(), downloadedComic.path, APP_COMIC_METADATA)
  const comic = normalizeComicMetadata(JSON.parse(await readFile(metadataComicFile, 'utf8')))
  return {
    ...markDownloadedChapters(comic, downloadedComics),
    source: 'metadata',
    downloadedInfo: downloadedComic,
  }
}

async function findLocalChapter(comicPathWord, chapterUuid) {
  const metadataFiles = await walk(metadataRoot())
  const chapterFiles = metadataFiles.filter((file) => isChapterMetadataFile(file))
  for (const chapterFile of chapterFiles) {
    try {
      const chapter = JSON.parse(await readFile(chapterFile, 'utf8'))
      if (chapter.comicPathWord !== comicPathWord || chapterUuidOf(chapter) !== chapterUuid) continue
      const metadataChapterDir = path.dirname(chapterFile)
      let downloadChapterDir = metadataChapterDir
      if (config.metadataDir) {
        const downloadedComic = (await listDownloaded()).find((item) => item.comicPathWord === comicPathWord)
        if (!downloadedComic) continue
        const comic = normalizeComicMetadata(JSON.parse(await readFile(downloadedComic.metadataComicFile, 'utf8')))
        const found = findChapter(comic, chapterUuid)
        if (!found) continue
        const groupTitle = cleanName(chapter.groupName || found.chapter.groupName || found.chapter.group_name || found.groupPathWord)
        const chapterTitle = cleanName(chapterTitleOf(chapter, chapterUuid))
        const chapterDir = path.join(DOWNLOAD_DIR, downloadedComic.path, formatPath(config.chapterDirFmt, {
          ...comicDirParams(comic, comicPathWord),
          group_path_word: found.groupPathWord,
          group_title: groupTitle,
          chapter_uuid: chapterUuid,
          chapter_title: chapterTitle,
          order: chapter.order ?? found.chapter.order ?? 1,
        }))
        downloadChapterDir = chapterDir
      }
      const relativeChapterDir = path.relative(DOWNLOAD_DIR, downloadChapterDir)
      const files = (await walk(downloadChapterDir))
        .filter((file) => /\.(webp|jpe?g|png|gif)$/i.test(file))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      return {
        chapter,
        relativeChapterDir,
        metadataChapterFile: chapterFile,
        metadataChapterDir,
        downloadChapterDir,
        files,
      }
    } catch {
      // Ignore broken metadata and continue scanning.
    }
  }
  return null
}

function imageContentType(filePath, fallback = 'image/webp') {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  return fallback
}

function previewImageUrl(sessionId, index) {
  return `/api/preview-image?sessionId=${encodeURIComponent(sessionId)}&index=${index}`
}

async function getChapterImages({ comicPathWord, chapterUuid, token = '' }) {
  const navigation = await getChapterNavigation({ comicPathWord, chapterUuid })
  const local = await findLocalChapter(comicPathWord, chapterUuid)
  if (local?.files?.length) {
    return {
      source: 'local',
      title: chapterTitleOf(local.chapter, chapterUuid),
      count: local.files.length,
      navigation,
      images: local.files.map((file, index) => ({
        index,
        url: `/api/local-image?path=${encodeURIComponent(path.relative(DOWNLOAD_DIR, file))}`,
      })),
    }
  }

  const chapter = await getChapter(comicPathWord, chapterUuid, token)
  const contents = chapter.chapter?.contents || []
  const words = chapter.chapter?.words || contents.map((_, index) => index)
  const sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const images = contents.map((content, index) => ({
    index: Number(words[index] ?? index),
    url: String(content.url || '').replace('.c800x.', '.c1500x.'),
  })).filter((item) => item.url)
  previewSessions.set(sessionId, {
    id: sessionId,
    comicPathWord,
    chapterUuid,
    images,
    createdAt: Date.now(),
  })
  return {
    source: 'remote',
    sessionId,
    title: chapter.chapter?.name || chapter.chapter?.chapter_name || chapterUuid,
    count: images.length,
    navigation,
    images: images.map((_, index) => ({
      index,
      url: previewImageUrl(sessionId, index),
    })),
  }
}

function readingProgressPath(comicPathWord) {
  return path.join(READING_PROGRESS_DIR, `${safeSegment(comicPathWord)}.json`)
}

function normalizeReadingProgress(progress, comicPathWord = '') {
  const readChapters = progress?.readChapters && typeof progress.readChapters === 'object'
    ? progress.readChapters
    : {}
  return {
    comicPathWord: String(progress?.comicPathWord || comicPathWord || ''),
    comicTitle: String(progress?.comicTitle || ''),
    lastChapterUuid: String(progress?.lastChapterUuid || ''),
    lastChapterTitle: String(progress?.lastChapterTitle || ''),
    readChapters,
    updatedAt: String(progress?.updatedAt || ''),
  }
}

async function readReadingProgress(comicPathWord) {
  if (!comicPathWord) return null
  try {
    const progress = JSON.parse(await readFile(readingProgressPath(comicPathWord), 'utf8'))
    return normalizeReadingProgress(progress, comicPathWord)
  } catch {
    return null
  }
}

async function listReadingProgress() {
  let entries = []
  try {
    entries = await readdir(READING_PROGRESS_DIR, { withFileTypes: true })
  } catch {
    return {}
  }
  const result = {}
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const progress = normalizeReadingProgress(JSON.parse(await readFile(path.join(READING_PROGRESS_DIR, entry.name), 'utf8')))
      if (progress.comicPathWord) result[progress.comicPathWord] = progress
    } catch {
      // Ignore broken reading state files; they should not block inventory.
    }
  }
  return result
}

async function recordReadingProgress({ comicPathWord, comicTitle = '', chapterUuid, chapterTitle = '' }) {
  if (!comicPathWord || !chapterUuid) throw new Error('comicPathWord and chapterUuid are required')
  const now = new Date().toISOString()
  const current = await readReadingProgress(comicPathWord)
  const progress = normalizeReadingProgress(current, comicPathWord)
  progress.comicPathWord = comicPathWord
  progress.comicTitle = comicTitle || progress.comicTitle
  progress.lastChapterUuid = chapterUuid
  progress.lastChapterTitle = chapterTitle || progress.lastChapterTitle || chapterUuid
  progress.readChapters ||= {}
  progress.readChapters[chapterUuid] = {
    ...(progress.readChapters[chapterUuid] || {}),
    chapterUuid,
    chapterTitle: chapterTitle || progress.readChapters[chapterUuid]?.chapterTitle || chapterUuid,
    enteredAt: progress.readChapters[chapterUuid]?.enteredAt || now,
    updatedAt: now,
  }
  progress.updatedAt = now
  await mkdir(READING_PROGRESS_DIR, { recursive: true })
  const file = readingProgressPath(comicPathWord)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(progress, null, 2))
  await rename(tmp, file)
  return progress
}

async function markAllReadingProgress({ comicPathWord, comicTitle = '', chapters = [] }) {
  if (!comicPathWord || !Array.isArray(chapters) || chapters.length === 0) {
    throw new Error('comicPathWord and chapters are required')
  }
  const now = new Date().toISOString()
  const current = await readReadingProgress(comicPathWord)
  const progress = normalizeReadingProgress(current, comicPathWord)
  progress.comicPathWord = comicPathWord
  progress.comicTitle = comicTitle || progress.comicTitle
  progress.readChapters ||= {}
  for (const chapter of chapters) {
    const chapterUuid = String(chapter.chapterUuid || chapter.uuid || '').trim()
    if (!chapterUuid) continue
    const chapterTitle = String(chapter.chapterTitle || chapter.title || chapterUuid)
    progress.readChapters[chapterUuid] = {
      ...(progress.readChapters[chapterUuid] || {}),
      chapterUuid,
      chapterTitle,
      enteredAt: progress.readChapters[chapterUuid]?.enteredAt || now,
      updatedAt: now,
    }
    progress.lastChapterUuid = chapterUuid
    progress.lastChapterTitle = chapterTitle
  }
  if (!Object.keys(progress.readChapters).length) throw new Error('chapters are required')
  progress.updatedAt = now
  await mkdir(READING_PROGRESS_DIR, { recursive: true })
  const file = readingProgressPath(comicPathWord)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(progress, null, 2))
  await rename(tmp, file)
  return progress
}

async function serveLocalImage(res, relativePath) {
  const filePath = path.resolve(DOWNLOAD_DIR, relativePath || '')
  if (!filePath.startsWith(path.resolve(DOWNLOAD_DIR) + path.sep)) return text(res, 403, 'Forbidden')
  const body = await readFile(filePath)
  return binary(res, 200, body, imageContentType(filePath))
}

async function servePreviewImage(res, sessionId, index) {
  const session = previewSessions.get(sessionId)
  const item = session?.images?.[Number(index)]
  if (!session || !item?.url) return text(res, 404, 'Not found')
  const url = new URL(item.url)
  const ext = path.extname(url.pathname).replace('.', '').toLowerCase() || 'webp'
  const fileName = `${String(Number(index) + 1).padStart(3, '0')}.${['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? ext : 'webp'}`
  const cachePath = path.join(
    PREVIEW_CACHE_DIR,
    safeSegment(session.comicPathWord),
    safeSegment(session.chapterUuid),
    fileName,
  )
  try {
    const body = await readFile(cachePath)
    return binary(res, 200, body, imageContentType(cachePath))
  } catch {
    const resp = await fetch(item.url)
    if (!resp.ok) throw new Error(`preview image HTTP ${resp.status}: ${item.url}`)
    const contentType = resp.headers.get('content-type') || imageContentType(cachePath)
    const body = Buffer.from(await resp.arrayBuffer())
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, body)
    return binary(res, 200, body, contentType)
  }
}

function markDownloadedChapters(comic, downloadedComics) {
  const comicPathWord = comic.comic?.path_word || comic.comic?.pathWord || comic.path_word || ''
  const downloaded = downloadedComics.find((item) => item.comicPathWord === comicPathWord)
  if (!downloaded) return comic

  const downloadedChapterUuids = new Set(downloaded.chapterUuids || [])
  for (const chapters of Object.values(comic.groupsChapters || {})) {
    for (const chapter of chapters) {
      const uuid = chapterUuidOf(chapter)
      chapter.isDownloaded = downloadedChapterUuids.has(uuid)
    }
  }
  comic.isDownloaded = true
  return comic
}

function activeJobKey(job) {
  return `${job.comicPathWord}:${job.chapterUuids?.[0] || ''}`
}

function comicPathWordOf(comic) {
  return comic.comic?.path_word || comic.comic?.pathWord || comic.path_word || comic.pathWord || ''
}

function comicTitleOf(comic, fallback = '') {
  return comic.comic?.name || comic.name || fallback
}

function chapterUuidOf(chapter) {
  return chapter.chapterUuid || chapter.chapter_uuid || chapter.uuid || ''
}

function chapterTitleOf(chapter, fallback = '') {
  return chapter.chapterTitle || chapter.chapter_title || chapter.chapter_name || chapter.name || fallback
}

function chapterOrderOf(chapter, fallback = 1) {
  return chapter.order ?? chapter.ordered ?? chapter.index ?? fallback
}

function appOrderOf(chapter, fallback = 1) {
  const order = Number(chapterOrderOf(chapter, fallback) || 0)
  return order / (order > 9 ? 10 : 1)
}

function normalizeComicMetadata(comic) {
  if (!comic || typeof comic !== 'object') return comic
  if (!comic.groupsChapters && comic.comic?.groups) {
    comic.groupsChapters = comic.comic.groups
  }
  return comic
}

function isComicMetadataFile(file) {
  return path.basename(file) === APP_COMIC_METADATA
}

function isChapterMetadataFile(file, metadataComicDir = '') {
  const name = path.basename(file)
  if (name === APP_CHAPTER_METADATA) return true
  if (config.metadataDir && path.extname(file).toLowerCase() === '.json' && path.basename(path.dirname(file)) === 'chapters') return true
  if (!metadataComicDir || path.extname(file).toLowerCase() !== '.json') return false
  const chaptersDir = path.join(metadataComicDir, 'chapters')
  return isSameOrChild(file, chaptersDir) && name !== APP_COMIC_METADATA
}

function collectComicMetadataFiles(metadataFiles) {
  return metadataFiles.filter(isComicMetadataFile)
}

function collectChapterMetadataFiles(metadataFiles, metadataComicDir) {
  return metadataFiles.filter((candidate) => (
    candidate.startsWith(`${metadataComicDir}${path.sep}`) && isChapterMetadataFile(candidate, metadataComicDir)
  ))
}

function isAppIndependentMetadataDir(metadataComicDir, comicFile) {
  return config.metadataDir && path.basename(comicFile) === APP_COMIC_METADATA && path.basename(path.dirname(metadataComicDir)) === 'comics'
}

function comicDirParams(comic, fallbackPathWord = '') {
  return {
    comic_uuid: comic.comic?.uuid || comic.uuid || '',
    comic_path_word: comicPathWordOf(comic) || fallbackPathWord,
    comic_title: comicTitleOf(comic, fallbackPathWord),
    author: authorText(comic),
  }
}

function inferRelativeComicDir({ comic, comicFile, metadataComicDir }) {
  const explicitDir = comic.comicDownloadDir || comic.comic_download_dir
  if (explicitDir && isSameOrChild(explicitDir, DOWNLOAD_DIR)) return path.relative(DOWNLOAD_DIR, explicitDir)
  if (isAppIndependentMetadataDir(metadataComicDir, comicFile)) return formatPath(config.comicDirFmt, comicDirParams(comic, path.basename(metadataComicDir)))
  return path.relative(metadataRoot(), metadataComicDir)
}

function appChapterMetadataFrom({ comic, groupPathWord, groupTitle, groupSize, chapterMeta, chapterUuid, chapterTitle, order, chapterSize = 0 }) {
  const statusValue = comic.comic?.status?.value ?? comic.status?.value ?? 0
  return {
    chapterUuid,
    chapterTitle,
    chapterSize,
    comicUuid: comic.comic?.uuid || comic.uuid || '',
    comicTitle: comicTitleOf(comic, ''),
    comicPathWord: comicPathWordOf(comic),
    groupPathWord,
    groupName: groupTitle,
    groupSize: chapterMeta.count ?? groupSize,
    order: Number(order || 0),
    comicStatus: Number(statusValue) === 0 ? 'ongoing' : 'completed',
    isPdfExported: Boolean(chapterMeta.isPdfExported),
    isCbzExported: Boolean(chapterMeta.isCbzExported),
  }
}

function appComicMetadataFrom(comic) {
  const metadata = structuredClone(comic)
  metadata.comic ||= {}
  metadata.comic.groups = {}
  for (const [groupPathWord, chapters] of Object.entries(comic.groupsChapters || {})) {
    const group = comic.groups?.[groupPathWord]
    metadata.comic.groups[groupPathWord] = chapters.map((chapter, index) => {
      const chapterUuid = chapterUuidOf(chapter)
      const groupTitle = group?.name || group?.title || chapter.groupName || chapter.group_name || groupPathWord
      const order = appOrderOf(chapter, index + 1)
      return appChapterMetadataFrom({
        comic,
        groupPathWord,
        groupTitle,
        groupSize: chapters.length,
        chapterMeta: chapter,
        chapterUuid,
        chapterTitle: chapterTitleOf(chapter, chapterUuid),
        order,
        chapterSize: chapter.size || chapter.chapterSize || 0,
      })
    })
  }
  delete metadata.groupsChapters
  delete metadata.isDownloaded
  delete metadata.comicDownloadDir
  delete metadata.comic_download_dir
  return metadata
}

function appComicMetadataPath(comic, comicDir) {
  if (config.metadataDir) {
    return path.join(metadataRoot(), 'comics', comicPathWordOf(comic), APP_COMIC_METADATA)
  }
  return path.join(comicDir, APP_COMIC_METADATA)
}

function appChapterMetadataPath(comic, chapterUuid, chapterDir) {
  if (config.metadataDir) {
    return path.join(metadataRoot(), 'comics', comicPathWordOf(comic), 'chapters', `${chapterUuid}.json`)
  }
  return path.join(chapterDir, APP_CHAPTER_METADATA)
}

function buildChapterNavigation(comic, chapterUuid, downloadedChapterUuids = []) {
  normalizeComicMetadata(comic)
  const downloaded = new Set(downloadedChapterUuids)
  const chapters = []
  for (const [groupPathWord, groupChapters] of Object.entries(comic.groupsChapters || {})) {
    for (const chapter of groupChapters || []) {
      const uuid = chapterUuidOf(chapter)
      if (!uuid) continue
      chapters.push({
        chapterUuid: uuid,
        title: chapterTitleOf(chapter, uuid),
        groupPathWord,
        isDownloaded: downloaded.has(uuid),
      })
    }
  }
  const index = chapters.findIndex((chapter) => chapter.chapterUuid === chapterUuid)
  if (index < 0) return { prev: null, next: null }
  return {
    prev: chapters[index - 1] || null,
    next: chapters[index + 1] || null,
  }
}

async function getChapterNavigation({ comicPathWord, chapterUuid }) {
  try {
    const downloadedComics = await listDownloaded()
    const downloadedComic = downloadedComics.find((item) => item.comicPathWord === comicPathWord)
    if (downloadedComic?.metadataComicFile) {
      const comic = normalizeComicMetadata(JSON.parse(await readFile(downloadedComic.metadataComicFile, 'utf8')))
      return buildChapterNavigation(comic, chapterUuid, downloadedComic.chapterUuids || [])
    }
  } catch {
    // Fall back to remote metadata below.
  }

  try {
    const comic = await getComic(comicPathWord)
    const downloaded = (await listDownloaded()).find((item) => item.comicPathWord === comicPathWord)
    return buildChapterNavigation(comic, chapterUuid, downloaded?.chapterUuids || [])
  } catch {
    return { prev: null, next: null }
  }
}

function updateInventory(update, patch) {
  Object.assign(update, patch, { updatedAt: new Date().toISOString() })
  emit('inventoryUpdate', publicInventoryUpdate(update))
}

function startInventoryUpdate({ token = '', scope = 'downloadedGroups' } = {}) {
  const running = [...inventoryUpdates.values()].find((update) => update.status === 'running')
  if (running) return running

  const update = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: 'running',
    total: 0,
    current: 0,
    groupCurrent: 0,
    groupTotal: null,
    chapterDownloaded: 0,
    chapterTotal: null,
    pendingChapters: 0,
    aggregateChapterDownloaded: 0,
    aggregateChapterTotal: 0,
    aggregatePendingChapters: 0,
    created: 0,
    skipped: 0,
    currentTitle: '',
    message: '准备更新库存',
    scope,
    errors: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  inventoryUpdates.set(update.id, update)
  emit('inventoryUpdate', publicInventoryUpdate(update))
  runInventoryUpdate(update, { token, scope }).catch((error) => {
    updateInventory(update, {
      status: 'failed',
      message: error.message,
      errors: [{ title: '更新库存失败', error: error.message }],
    })
  })
  return update
}

async function runInventoryUpdate(update, { token = '', scope = 'downloadedGroups' } = {}) {
  updateInventory(update, {
    message: '正在扫描本地库存',
  })
  const downloadedComics = await listDownloaded()
  updateInventory(update, {
    total: downloadedComics.length,
    current: 0,
    groupCurrent: 0,
    groupTotal: null,
    chapterDownloaded: 0,
    chapterTotal: null,
    pendingChapters: 0,
    aggregateChapterDownloaded: 0,
    aggregateChapterTotal: 0,
    aggregatePendingChapters: 0,
    message: downloadedComics.length === 0 ? '没有本地库存' : '正在获取最新章节',
  })
  const activeKeys = new Set(
    [...jobs.values()]
      .filter((job) => job.status !== 'completed')
      .map(activeJobKey),
  )
  const createdJobs = []
  const skipped = []
  let aggregateChapterDownloaded = 0
  let aggregateChapterTotal = 0
  let aggregatePendingChapters = 0

  for (const [index, downloadedComic] of downloadedComics.entries()) {
    const comicPathWord = downloadedComic.comicPathWord
    if (!comicPathWord) continue
    updateInventory(update, {
      current: index + 1,
      groupCurrent: 0,
      groupTotal: null,
      chapterDownloaded: downloadedComic.chapterCount || 0,
      chapterTotal: downloadedComic.remoteChapterTotal || null,
      pendingChapters: 0,
      currentTitle: downloadedComic.title || comicPathWord,
      message: `检查 ${downloadedComic.title || comicPathWord}`,
    })

    try {
      const comic = await getComic(comicPathWord)
      await writeDownloadedComicMetadata(downloadedComic, comic)
      const chapterUuids = []
      const groupEntries = Object.entries(comic.groupsChapters || {})
      const consideredGroups = scope === 'allGroups'
        ? groupEntries
        : groupEntries.filter(([, chapters]) => chapters.some((chapter) => chapter.isDownloaded === true))
      const chapterTotal = consideredGroups.reduce((total, [, chapters]) => total + chapters.length, 0)
      let chapterDownloaded = 0

      updateInventory(update, {
        groupCurrent: 0,
        groupTotal: consideredGroups.length,
        chapterDownloaded: 0,
        chapterTotal,
        pendingChapters: 0,
      })

      for (const [groupIndex, [, chapters]] of consideredGroups.entries()) {
        for (const chapter of chapters) {
          if (chapter.isDownloaded === true) {
            chapterDownloaded += 1
            continue
          }
          const uuid = chapterUuidOf(chapter)
          const key = `${comicPathWord}:${uuid}`
          if (uuid && !activeKeys.has(key)) {
            chapterUuids.push(uuid)
            activeKeys.add(key)
          }
        }
        updateInventory(update, {
          groupCurrent: groupIndex + 1,
          groupTotal: consideredGroups.length,
          chapterDownloaded,
          chapterTotal,
          pendingChapters: chapterUuids.length,
          message: `检查 ${downloadedComic.title || comicPathWord}`,
        })
      }

      const nextJobs = createChapterJobs({ comicPathWord, chapterUuids, token })
      for (const job of nextJobs) startJob(job)
      createdJobs.push(...nextJobs.map(publicJob))
      aggregateChapterDownloaded += chapterDownloaded
      aggregateChapterTotal += chapterTotal
      aggregatePendingChapters += chapterUuids.length
      updateInventory(update, {
        created: createdJobs.length,
        pendingChapters: chapterUuids.length,
        aggregateChapterDownloaded,
        aggregateChapterTotal,
        aggregatePendingChapters,
      })
      if (config.updateDownloadedComicsIntervalSec > 0) await sleep(config.updateDownloadedComicsIntervalSec)
    } catch (error) {
      aggregateChapterDownloaded += downloadedComic.chapterCount || 0
      if (downloadedComic.remoteChapterTotal) aggregateChapterTotal += downloadedComic.remoteChapterTotal
      skipped.push({
        comicPathWord,
        title: downloadedComic.title,
        error: error.message,
      })
      updateInventory(update, {
        skipped: skipped.length,
        errors: skipped.slice(-5),
        groupCurrent: 0,
        groupTotal: null,
        chapterDownloaded: downloadedComic.chapterCount || 0,
        chapterTotal: downloadedComic.remoteChapterTotal || null,
        pendingChapters: 0,
        aggregateChapterDownloaded,
        aggregateChapterTotal,
        aggregatePendingChapters,
      })
      if (config.updateDownloadedComicsIntervalSec > 0) await sleep(config.updateDownloadedComicsIntervalSec)
    }
  }

  updateInventory(update, {
    status: 'completed',
    current: downloadedComics.length,
    groupCurrent: 0,
    groupTotal: null,
    chapterDownloaded: aggregateChapterDownloaded,
    chapterTotal: aggregateChapterTotal || null,
    pendingChapters: aggregatePendingChapters,
    aggregateChapterDownloaded,
    aggregateChapterTotal,
    aggregatePendingChapters,
    created: createdJobs.length,
    skipped: skipped.length,
    errors: skipped.slice(-5),
    currentTitle: '',
    message: skipped.length > 0 ? `完成，跳过 ${skipped.length} 部` : '更新完成',
  })
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

function isSameOrChild(filePath, root) {
  const resolvedPath = path.resolve(filePath)
  const resolvedRoot = path.resolve(root)
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
}

async function moveForcedChapterAside({ comicPathWord, chapterUuid, comicDir, metadataComicDir, chapterDir, metadataChapterFile, metadataChapterDir }) {
  const candidates = []
  const local = await findLocalChapter(comicPathWord, chapterUuid)
  if (local?.downloadChapterDir) candidates.push(local.downloadChapterDir)
  if (local?.metadataChapterFile) candidates.push(local.metadataChapterFile)
  else if (local?.metadataChapterDir) candidates.push(local.metadataChapterDir)
  candidates.push(chapterDir, metadataChapterFile || metadataChapterDir)

  const allowedRoots = [DOWNLOAD_DIR, metadataRoot()]
  const protectedDirs = [DOWNLOAD_DIR, metadataRoot(), comicDir, metadataComicDir].map((item) => path.resolve(item))
  const unique = [...new Set(candidates.map((item) => path.resolve(item)).filter((item) => (
    allowedRoots.some((root) => isSameOrChild(item, root)) && !protectedDirs.includes(item)
  )))]

  for (const dir of unique) {
    await moveAside(dir, 'redownload')
  }
}

async function runJob(job, { comicPathWord, chapterUuids, token, force = false }) {
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
    const metadataComicFile = appComicMetadataPath(comic, comicDir)
    const metadataComicDir = path.dirname(metadataComicFile)
    await mkdir(comicDir, { recursive: true })
    await mkdir(metadataComicDir, { recursive: true })
    await writeFile(metadataComicFile, JSON.stringify(appComicMetadataFrom(comic), null, 2))

    await runWithConcurrency(chapterUuids, config.chapterConcurrency, async (chapterUuid) => {
      const found = findChapter(comic, chapterUuid)
      if (!found) throw new Error(`找不到章节 ${chapterUuid}`)

      const chapterMeta = found.chapter
      const group = comic.groups?.[found.groupPathWord]
      const groupTitle = cleanName(group?.name || group?.title || chapterMeta.group_name || found.groupPathWord)
      const chapterTitle = cleanName(chapterTitleOf(chapterMeta, chapterUuid))
      const order = appOrderOf(chapterMeta, job.doneChapters + 1)

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
      const metadataChapterFile = appChapterMetadataPath(comic, chapterUuid, chapterDir)
      const metadataChapterDir = path.dirname(metadataChapterFile)
      if (force) {
        updateJob(job, { message: `移动旧章节 ${chapterTitle}` })
        await moveForcedChapterAside({ comicPathWord, chapterUuid, comicDir, metadataComicDir, chapterDir, metadataChapterFile, metadataChapterDir })
      }

      await runWithConcurrency(contents, config.imgConcurrency, async (content, i) => {
        const imageUrl = String(content.url || '').replace('.c800x.', '.c1500x.')
        const index = Number(words[i] ?? i) + 1
        const filePath = path.join(chapterDir, `${String(index).padStart(3, '0')}.webp`)
        await downloadImage(imageUrl, filePath)
        job.doneImages += 1
        updateJob(job, { doneImages: job.doneImages, message: `下载 ${chapterTitle} ${job.doneImages}/${job.totalImages}` })
        if (config.imgDownloadIntervalSec > 0) await sleep(config.imgDownloadIntervalSec)
      })

      await mkdir(metadataChapterDir, { recursive: true })
      const appChapterMetadata = appChapterMetadataFrom({
        comic,
        groupPathWord: found.groupPathWord,
        groupTitle,
        groupSize: (comic.groupsChapters?.[found.groupPathWord] || []).length,
        chapterMeta,
        chapterUuid,
        chapterTitle,
        order,
        chapterSize: contents.length || chapterMeta.size || chapterMeta.chapterSize || 0,
      })
      await writeFile(metadataChapterFile, JSON.stringify(appChapterMetadata, null, 2))
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
    if (pathname === '/api/inventory-update' && req.method === 'GET') {
      return json(res, 200, latestInventoryUpdate() || null)
    }
    if (pathname === '/api/config' && req.method === 'GET') return json(res, 200, config)
    if (pathname === '/api/config' && req.method === 'POST') {
      return json(res, 200, await saveConfig(await readJson(req)))
    }
    if (pathname === '/api/library/types' && req.method === 'GET') {
      return json(res, 200, libraryTypes())
    }
    if (pathname === '/api/library/items' && req.method === 'GET') {
      return json(res, 200, await scanLibraryItems({ type: url.searchParams.get('type') || 'all' }))
    }
    if (pathname === '/api/library/items/sample' && req.method === 'POST') {
      const handler = libraryHandler(url.searchParams.get('type') || 'epub')
      if (!handler.createSampleItem) return json(res, 400, { error: 'This library type has no sample generator' })
      return json(res, 201, await handler.createSampleItem())
    }
    if (pathname === '/api/library/items' && req.method === 'POST') {
      const type = url.searchParams.get('type') || 'epub'
      const handler = libraryHandler(type)
      if (!handler.importItem) return json(res, 400, { error: 'This library type is not importable' })
      const form = await readMultipart(req)
      const file = form.files.find((item) => item.name === 'file') || form.files[0]
      if (!file) return json(res, 400, { error: 'file is required' })
      return json(res, 201, await handler.importItem({ fileName: file.filename, buffer: file.buffer, fields: form.fields }))
    }
    if (pathname.startsWith('/api/library/items/') && req.method === 'GET') {
      const parts = pathname.split('/').filter(Boolean)
      const [, , , type, itemId, action, unitId] = parts
      const handler = libraryHandler(type)
      if (!itemId) return json(res, 400, { error: 'itemId is required' })
      if (!action) return json(res, 200, await handler.getItem(itemId))
      if (action === 'units') return json(res, 200, await handler.listUnits(itemId))
      if (action === 'reader') {
        return json(res, 200, await handler.getReaderContent(itemId, unitId, {
          sectionId: url.searchParams.get('sectionId') || '',
        }))
      }
      if (action === 'resource') {
        const resource = await handler.getResource(itemId, url.searchParams.get('path') || '')
        return binary(res, 200, resource.body, resource.contentType)
      }
      if (action === 'progress') return json(res, 200, await handler.getProgress(itemId))
    }
    if (pathname.startsWith('/api/library/items/') && req.method === 'POST') {
      const parts = pathname.split('/').filter(Boolean)
      const [, , , type, itemId, action] = parts
      const handler = libraryHandler(type)
      if (!itemId) return json(res, 400, { error: 'itemId is required' })
      if (action === 'progress') return json(res, 200, await handler.saveProgress(itemId, await readJson(req)))
    }
    if (pathname === '/api/reading-progress' && req.method === 'GET') {
      return json(res, 200, await listReadingProgress())
    }
    if (pathname.startsWith('/api/reading-progress/') && req.method === 'GET') {
      return json(res, 200, await readReadingProgress(decodeURIComponent(pathname.split('/').pop())) || null)
    }
    if (pathname === '/api/reading-progress' && req.method === 'POST') {
      return json(res, 200, await recordReadingProgress(await readJson(req)))
    }
    if (pathname === '/api/reading-progress/mark-all' && req.method === 'POST') {
      return json(res, 200, await markAllReadingProgress(await readJson(req)))
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
    if (pathname.startsWith('/api/downloaded/comic/') && req.method === 'GET') {
      const comicPathWord = pathname.split('/').pop()
      return json(res, 200, await getDownloadedComic(comicPathWord, {
        refresh: url.searchParams.get('refresh') === '1',
        token: url.searchParams.get('token') || '',
      }))
    }
    if (pathname === '/api/downloaded/update' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, 202, publicInventoryUpdate(startInventoryUpdate({
        token: body.token || '',
        scope: body.scope === 'allGroups' ? 'allGroups' : 'downloadedGroups',
      })))
    }
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
    if (pathname === '/api/comics' && req.method === 'GET') {
      return json(res, 200, await listComics({
        ordering: url.searchParams.get('ordering') || '-datetime_updated',
        limit: url.searchParams.get('limit') || 10,
        offset: url.searchParams.get('offset') || 0,
        theme: url.searchParams.get('theme') || '',
        region: url.searchParams.get('region') ?? '',
        status: url.searchParams.get('status') ?? '',
      }))
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
    if (pathname === '/api/chapter-images' && req.method === 'GET') {
      return json(res, 200, await getChapterImages({
        comicPathWord: url.searchParams.get('comicPathWord') || '',
        chapterUuid: url.searchParams.get('chapterUuid') || '',
        token: url.searchParams.get('token') || '',
      }))
    }
    if (pathname === '/api/local-image' && req.method === 'GET') {
      return serveLocalImage(res, url.searchParams.get('path') || '')
    }
    if (pathname === '/api/preview-image' && req.method === 'GET') {
      return servePreviewImage(res, url.searchParams.get('sessionId') || '', url.searchParams.get('index') || 0)
    }
    if (pathname === '/api/download' && req.method === 'POST') {
      const body = await readJson(req)
      if (!body.comicPathWord || !Array.isArray(body.chapterUuids) || body.chapterUuids.length === 0) {
        return json(res, 400, { error: 'comicPathWord and chapterUuids are required' })
      }
      const jobs = createChapterJobs(body)
      for (const job of jobs) startJob(job)
      return json(res, 202, { jobs: jobs.map(publicJob) })
    }

    return serveStatic(req, res, pathname)
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: error.message })
  }
}

registerLibraryHandler(createEpubHandler({ dataDir: DATA_DIR, safeSegment, pathExists, moveAside }))

await mkdir(DOWNLOAD_DIR, { recursive: true })
config = await loadConfig()
createServer(route).listen(PORT, HOST, () => {
  console.log(`copymanga web listening on http://${HOST}:${PORT}`)
  console.log(`download dir: ${DOWNLOAD_DIR}`)
})
