import { createServer } from 'node:http'
import { open, readFile, readdir, stat, writeFile, mkdir, rename } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import { promisify } from 'node:util'
import { registerLibraryHandler, libraryHandler, libraryTypes, scanLibraryItems } from './library/registry.mjs'
import { createEpubHandler } from './library/types/epub.mjs'
import { createStreamMediaHandler } from './library/types/stream-media.mjs'
import { initTagStore, listTags, searchItemKeys, setItemTags, setUnitTags, syncItemTagIndex } from './library/tag-store.mjs'

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
const jobQueue = []
const runningJobIds = new Set()
const jobBatches = new Map()
const fileLocks = new Map()
const chapterLocks = new Map()
const imageCheckJobs = new Map()
const imageCheckQueue = []
const runningImageCheckIds = new Set()
let jobQueueTimer = null
let imageCheckQueueTimer = null
let hasIdentifyCache = null
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

function streamFile(res, filePath, contentType) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
  })
  createReadStream(filePath).pipe(res)
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

async function withLock(lockMap, key, work) {
  const previous = lockMap.get(key) || Promise.resolve()
  let release
  const tail = new Promise((resolve) => {
    release = resolve
  })
  const next = previous.catch(() => {}).then(() => tail)
  lockMap.set(key, next)
  await previous.catch(() => {})
  try {
    return await work()
  } finally {
    release()
    if (lockMap.get(key) === next) lockMap.delete(key)
  }
}

async function atomicWriteFile(filePath, body, { jobId = 'job' } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp-${safeSegment(jobId)}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await writeFile(tmp, body)
  const info = await stat(tmp)
  if (!info.isFile() || info.size <= 0) throw new Error(`临时文件写入失败 ${path.basename(filePath)}`)
  await rename(tmp, filePath)
}

async function atomicWriteJson(filePath, payload, { jobId = 'job', verify } = {}) {
  await withLock(fileLocks, path.resolve(filePath), async () => {
    await atomicWriteFile(filePath, JSON.stringify(payload, null, 2), { jobId })
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    if (verify) verify(parsed)
  })
}

function defaultConfig() {
  return {
    token: '',
    downloadDir: DOWNLOAD_DIR,
    metadataDir: '',
    exportDir: path.join(DATA_DIR, 'exports'),
    mediaStreamApiBase: 'http://127.0.0.1:8080',
    mediaManagedBasePath: path.join(DATA_DIR, 'library', 'media'),
    mediaStreamBasePath: '/media',
    mediaImportSourceRoots: '/input',
    mediaSubtitleExtensions: 'srt,vtt,crt',
    apiDomainMode: 'Default',
    customApiDomain: DEFAULT_API_DOMAIN,
    downloadFormat: 'Webp',
    enableFileLogger: true,
    chapterConcurrency: 3,
    chapterDownloadIntervalSec: 0,
    imgConcurrency: 6,
    imgDownloadIntervalSec: 0,
    viewerImageBatchSize: 5,
    siteTheme: 'light',
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
  const siteTheme = ['light', 'dark', 'warm', 'sepia'].includes(value?.siteTheme)
    ? value.siteTheme
    : defaults.siteTheme
  return {
    token: String(value?.token || defaults.token),
    downloadDir: DOWNLOAD_DIR,
    metadataDir: String(value?.metadataDir || defaults.metadataDir),
    exportDir: String(value?.exportDir || defaults.exportDir),
    mediaStreamApiBase: String(value?.mediaStreamApiBase || defaults.mediaStreamApiBase).trim() || defaults.mediaStreamApiBase,
    mediaManagedBasePath: String(value?.mediaManagedBasePath || defaults.mediaManagedBasePath).trim() || defaults.mediaManagedBasePath,
    mediaStreamBasePath: String(value?.mediaStreamBasePath || defaults.mediaStreamBasePath).trim() || defaults.mediaStreamBasePath,
    mediaImportSourceRoots: String(value?.mediaImportSourceRoots || defaults.mediaImportSourceRoots).trim() || defaults.mediaImportSourceRoots,
    mediaSubtitleExtensions: normalizeExtensionList(value?.mediaSubtitleExtensions, defaults.mediaSubtitleExtensions),
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
    siteTheme,
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

function normalizeExtensionList(value, fallback) {
  const input = Array.isArray(value) ? value : String(value || fallback || '').split(/[,\s，]+/)
  const extensions = [...new Set(input
    .map((item) => String(item || '').trim().replace(/^\./, '').toLowerCase())
    .filter((item) => /^[a-z0-9]+$/.test(item)))]
  return extensions.length ? extensions.join(',') : fallback
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
  if (job.deleted) {
    emit('jobDelete', { id: job.id })
    return
  }
  emit('job', publicJob(job))
}

function publicJob(job) {
  const { token, ...safeJob } = job
  return safeJob
}

function publicJobs() {
  return [...jobs.values()].filter((job) => !job.deleted).map(publicJob)
}

function publicImageCheckJob(job) {
  return { ...job }
}

function publicImageCheckJobs() {
  return [...imageCheckJobs.values()].map(publicImageCheckJob)
}

function latestImageCheckSummary() {
  const jobs = publicImageCheckJobs()
  const counts = { queued: 0, running: 0, completed: 0, failed: 0, skipped: 0 }
  for (const job of jobs) counts[job.status] = (counts[job.status] || 0) + 1
  return {
    total: jobs.length,
    queued: counts.queued || 0,
    running: counts.running || 0,
    completed: counts.completed || 0,
    failed: counts.failed || 0,
    skipped: counts.skipped || 0,
    jobs,
  }
}

function createImageCheckJob({ comicPathWord, chapterUuid, chapterTitle = '', reason = 'manual' }) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id,
    status: 'queued',
    comicPathWord,
    chapterUuid,
    chapterTitle,
    reason,
    message: '等待检查',
    total: 0,
    checked: 0,
    failed: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function updateImageCheckJob(job, patch) {
  if (!imageCheckJobs.has(job.id)) return
  Object.assign(job, patch, { updatedAt: new Date().toISOString() })
  emit('imageCheck', publicImageCheckJob(job))
}

function enqueueImageCheck(payload) {
  if (!payload?.comicPathWord || !payload?.chapterUuid) return null
  const duplicate = [...imageCheckJobs.values()].find((job) => (
    (job.status === 'queued' || job.status === 'running') &&
    job.comicPathWord === payload.comicPathWord &&
    job.chapterUuid === payload.chapterUuid
  ))
  if (duplicate) return duplicate
  const job = createImageCheckJob(payload)
  imageCheckJobs.set(job.id, job)
  imageCheckQueue.push(job.id)
  emit('imageCheck', publicImageCheckJob(job))
  scheduleImageCheckQueue()
  return job
}

function scheduleImageCheckQueue() {
  if (imageCheckQueueTimer) return
  imageCheckQueueTimer = setTimeout(() => {
    imageCheckQueueTimer = null
    processImageCheckQueue()
  }, 0)
}

function processImageCheckQueue() {
  const limit = 1
  while (runningImageCheckIds.size < limit && imageCheckQueue.length > 0) {
    const id = imageCheckQueue.shift()
    const job = imageCheckJobs.get(id)
    if (!job || job.status !== 'queued') continue
    runningImageCheckIds.add(id)
    runImageCheckJob(job).finally(() => {
      runningImageCheckIds.delete(id)
      processImageCheckQueue()
    })
  }
}

function publicInventoryUpdate(update) {
  return update
}

function latestInventoryUpdate() {
  return [...inventoryUpdates.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
}

function createJob({ comicPathWord, chapterUuids, token, force = false, batchId = '', retryOf = '' }) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const chapterUuid = chapterUuids?.[0] || ''
  return {
    id,
    status: 'queued',
    stage: 'created',
    comicPathWord,
    chapterUuids,
    chapterUuid,
    chapterTitle: '',
    token,
    force: Boolean(force),
    batchId,
    retryOf,
    deleted: false,
    totalChapters: chapterUuids.length,
    doneChapters: 0,
    totalImages: 0,
    doneImages: 0,
    images: [],
    message: '等待开始',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function createChapterJobs({ comicPathWord, chapterUuids, token, force = false, batchId = '', retryOf = '' }) {
  return chapterUuids.map((chapterUuid) => createJob({
    comicPathWord,
    chapterUuids: [chapterUuid],
    token,
    force,
    batchId,
    retryOf,
  }))
}

function startJob(job) {
  job.status = 'queued'
  job.doneChapters = 0
  job.totalImages = 0
  job.doneImages = 0
  job.images = []
  job.stage = 'created'
  job.message = '等待开始'
  job.updatedAt = new Date().toISOString()
  jobs.set(job.id, job)
  if (!jobQueue.includes(job.id) && !runningJobIds.has(job.id)) jobQueue.push(job.id)
  emit('job', publicJob(job))
  scheduleJobQueue()
}

function scheduleJobQueue() {
  if (jobQueueTimer) return
  jobQueueTimer = setTimeout(() => {
    jobQueueTimer = null
    processJobQueue()
  }, 0)
}

function processJobQueue() {
  const limit = Math.max(1, Number(config.chapterConcurrency || 1))
  while (runningJobIds.size < limit && jobQueue.length > 0) {
    const id = jobQueue.shift()
    const job = jobs.get(id)
    if (!job || job.deleted || job.status !== 'queued') continue
    runningJobIds.add(id)
    runJob(job, job).finally(() => {
      runningJobIds.delete(id)
      processJobQueue()
    })
  }
}

function validateJobCompletion(job) {
  if (job.doneChapters !== job.totalChapters) {
    throw new Error(`章节完成数异常：${job.doneChapters}/${job.totalChapters}`)
  }
  if (job.totalImages <= 0 || job.doneImages !== job.totalImages) {
    throw new Error(`图片完成数异常：${job.doneImages}/${job.totalImages || '?'}`)
  }
}

function updateJobImage(job, imageIndex, patch) {
  const image = job.images?.[imageIndex]
  if (!image) return
  Object.assign(image, patch, { updatedAt: new Date().toISOString() })
  updateJob(job, {})
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
  if (config.metadataDir) return listDownloadedFromMetadataDir()

  const downloadFiles = await walk(DOWNLOAD_DIR)
  const metadataFiles = downloadFiles
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
      const imageCheckSummary = emptyImageCheckSummary()
      const chapterImageChecks = {}
      for (const chapterFile of chapterFiles) {
        try {
          const chapter = JSON.parse(await readFile(chapterFile, 'utf8'))
          const chapterUuid = chapterUuidOf(chapter)
          if (chapterUuid) {
            chapterUuids.push(chapterUuid)
            const tag = chapterImageCheckTag(chapter)
            chapterImageChecks[chapterUuid] = tag
            addImageCheckSummary(imageCheckSummary, tag)
          }
        } catch {
          // Ignore broken chapter metadata and keep the rest of the inventory usable.
        }
      }
      const imageFiles = downloadFiles.filter((candidate) => (
        candidate.startsWith(`${downloadComicDir}${path.sep}`) && /\.(webp|jpe?g|png|gif)$/i.test(candidate)
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
        imageCheckSummary,
        chapterImageChecks,
        updatedAt: info.mtime.toISOString(),
      })
    } catch (error) {
      console.warn(`skip invalid inventory file ${file}: ${error.message}`)
    }
  }
  return comics.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function metadataComicDir(comicPathWord) {
  return path.join(metadataRoot(), 'comics', safeSegment(comicPathWord))
}

function metadataComicFile(comicPathWord) {
  return path.join(metadataComicDir(comicPathWord), APP_COMIC_METADATA)
}

function metadataChaptersDir(comicPathWord) {
  return path.join(metadataComicDir(comicPathWord), 'chapters')
}

function metadataChapterFile(comicPathWord, chapterUuid) {
  return path.join(metadataChaptersDir(comicPathWord), `${safeSegment(chapterUuid)}.json`)
}

async function listDownloadedFromMetadataDir() {
  const comicsRoot = path.join(metadataRoot(), 'comics')
  let entries = []
  try {
    entries = await readdir(comicsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const comics = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const comicPathWord = entry.name
    const file = metadataComicFile(comicPathWord)
    try {
      comics.push(await downloadedComicSummaryFromMetadataFile(file, comicPathWord))
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
  await atomicWriteJson(metadataFile, appComicMetadataFrom(comic), {
    jobId: 'inventory',
    verify: (metadata) => {
      if (!comicPathWordOf(metadata)) throw new Error('漫画元数据写入校验失败')
    },
  })
}

async function getDownloadedComic(comicPathWord, { refresh = false, token = '' } = {}) {
  if (config.metadataDir) return getDownloadedComicFromMetadataDir(comicPathWord, { refresh, token })

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

async function getDownloadedComicFromMetadataDir(comicPathWord, { refresh = false, token = '' } = {}) {
  const file = metadataComicFile(comicPathWord)
  const comic = normalizeComicMetadata(JSON.parse(await readFile(file, 'utf8')))
  const downloadedComic = await downloadedComicSummaryFromMetadataFile(file, comicPathWord)
  if (refresh) {
    const remote = await getComic(comicPathWord)
    await writeDownloadedComicMetadata(downloadedComic, remote)
    return { ...remote, source: 'remote', downloadedInfo: downloadedComic }
  }
  return {
    ...markDownloadedChapters(comic, [downloadedComic]),
    source: 'metadata',
    downloadedInfo: downloadedComic,
  }
}

async function downloadedComicSummaryFromMetadataFile(file, fallbackPathWord = '') {
  const comic = normalizeComicMetadata(JSON.parse(await readFile(file, 'utf8')))
  const metadataComicDir = path.dirname(file)
  const relativeComicDir = inferRelativeComicDir({ comic, comicFile: file, metadataComicDir })
  const comicPathWord = comicPathWordOf(comic) || fallbackPathWord || path.basename(metadataComicDir)
  let chapterEntries = []
  try {
    chapterEntries = await readdir(path.join(metadataComicDir, 'chapters'), { withFileTypes: true })
  } catch {
    chapterEntries = []
  }
  const chapterUuids = chapterEntries
    .filter((item) => item.isFile() && path.extname(item.name).toLowerCase() === '.json')
    .map((item) => path.basename(item.name, '.json'))
  const imageCheckSummary = emptyImageCheckSummary()
  const chapterImageChecks = {}
  for (const entry of chapterEntries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue
    try {
      const chapter = JSON.parse(await readFile(path.join(metadataComicDir, 'chapters', entry.name), 'utf8'))
      const chapterUuid = chapterUuidOf(chapter) || path.basename(entry.name, '.json')
      const tag = chapterImageCheckTag(chapter)
      chapterImageChecks[chapterUuid] = tag
      addImageCheckSummary(imageCheckSummary, tag)
    } catch {
      // Ignore broken chapter metadata and keep the rest of the inventory usable.
    }
  }
  const info = await stat(file)
  return {
    path: relativeComicDir,
    metadataComicFile: file,
    metadataComicDir,
    comicPathWord,
    title: comicTitleOf(comic, comicPathWord),
    cover: comic.comic?.cover || comic.cover || '',
    author: comic.comic?.author || comic.author || [],
    groups: comic.groups || {},
    allChapterUuids: collectAllChapterUuids(comic),
    chapterUuids,
    chapterCount: chapterUuids.length,
    remoteChapterTotal: countComicChapters(comic) || null,
    imageCount: null,
    imageCheckSummary,
    chapterImageChecks,
    updatedAt: info.mtime.toISOString(),
  }
}

async function findLocalChapter(comicPathWord, chapterUuid) {
  if (config.metadataDir) return findLocalChapterFromMetadataDir(comicPathWord, chapterUuid)

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

async function findLocalChapterFromMetadataDir(comicPathWord, chapterUuid) {
  const chapterFile = metadataChapterFile(comicPathWord, chapterUuid)
  try {
    const chapter = JSON.parse(await readFile(chapterFile, 'utf8'))
    const comicFile = metadataComicFile(comicPathWord)
    const comic = normalizeComicMetadata(JSON.parse(await readFile(comicFile, 'utf8')))
    const metadataComicDir = path.dirname(comicFile)
    const relativeComicDir = inferRelativeComicDir({ comic, comicFile, metadataComicDir })
    const found = findChapter(comic, chapterUuid)
    if (!found) return null
    const groupTitle = cleanName(chapter.groupName || found.chapter.groupName || found.chapter.group_name || found.groupPathWord)
    const chapterTitle = cleanName(chapterTitleOf(chapter, chapterUuid))
    const downloadChapterDir = path.join(DOWNLOAD_DIR, relativeComicDir, formatPath(config.chapterDirFmt, {
      ...comicDirParams(comic, comicPathWord),
      group_path_word: found.groupPathWord,
      group_title: groupTitle,
      chapter_uuid: chapterUuid,
      chapter_title: chapterTitle,
      order: chapter.order ?? found.chapter.order ?? 1,
    }))
    const files = (await readdir(downloadChapterDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(webp|jpe?g|png|gif)$/i.test(entry.name))
      .map((entry) => path.join(downloadChapterDir, entry.name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return {
      chapter,
      relativeChapterDir: path.relative(DOWNLOAD_DIR, downloadChapterDir),
      metadataChapterFile: chapterFile,
      metadataChapterDir: path.dirname(chapterFile),
      downloadChapterDir,
      files,
    }
  } catch {
    return null
  }
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
  return streamFile(res, filePath, imageContentType(filePath))
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
      if (downloaded.chapterImageChecks?.[uuid]) chapter.imageCheck = downloaded.chapterImageChecks[uuid]
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
  if (config.metadataDir) {
    try {
      const comicFile = metadataComicFile(comicPathWord)
      const comic = normalizeComicMetadata(JSON.parse(await readFile(comicFile, 'utf8')))
      const downloadedComic = await downloadedComicSummaryFromMetadataFile(comicFile, comicPathWord)
      return buildChapterNavigation(comic, chapterUuid, downloadedComic.chapterUuids || [])
    } catch {
      return { prev: null, next: null }
    }
  }

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
      .filter((job) => !job.deleted && job.status !== 'completed')
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

      const batchId = `${update.id}-${comicPathWord}`
      const nextJobs = createChapterJobs({ comicPathWord, chapterUuids, token, batchId })
      if (nextJobs.length > 0) {
        jobBatches.set(batchId, {
          id: batchId,
          comicPathWord,
          requestedChapterUuids: chapterUuids,
          createdJobIds: nextJobs.map((job) => job.id),
          createdAt: new Date().toISOString(),
          source: 'inventory-update',
        })
      }
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
  if (!url) throw new Error('图片地址为空')
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`image HTTP ${resp.status}: ${url}`)
  const contentType = resp.headers.get('content-type') || ''
  const normalizedContentType = contentType.toLowerCase()
  if (!normalizedContentType.startsWith('image/')) throw new Error(`图片响应类型异常 ${contentType || 'unknown'}: ${url}`)
  const ext = config.downloadFormat === 'Jpeg' ? 'jpg' : (normalizedContentType.includes('jpeg') || normalizedContentType.includes('jpg') ? 'jpg' : 'webp')
  const target = filePath.replace(/\.[^.]+$/, `.${ext}`)
  await mkdir(path.dirname(target), { recursive: true })
  if (config.downloadFormat === 'Jpeg' && normalizedContentType.includes('webp')) {
    throw new Error('Web 版暂未实现 webp 转 jpg，请使用 Webp 下载格式')
  }
  const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const body = Buffer.from(await resp.arrayBuffer())
  if (body.length <= 0) throw new Error(`图片内容为空: ${url}`)
  await writeFile(tmp, body)
  const tmpInfo = await stat(tmp)
  if (!tmpInfo.isFile() || tmpInfo.size <= 0) throw new Error(`图片临时文件无效: ${url}`)
  await rename(tmp, target)
  const targetInfo = await stat(target)
  if (!targetInfo.isFile() || targetInfo.size <= 0) throw new Error(`图片落盘失败: ${path.basename(target)}`)
  return target
}

async function validateDownloadedImages({ chapterDir, files, expectedCount, chapterTitle }) {
  const uniqueFiles = [...new Set(files.map((file) => path.resolve(file)))]
  if (uniqueFiles.length !== expectedCount) {
    throw new Error(`章节图片数量异常：${chapterTitle} ${uniqueFiles.length}/${expectedCount}`)
  }
  for (const file of uniqueFiles) {
    const info = await stat(file)
    if (!info.isFile() || info.size <= 0) throw new Error(`章节图片文件无效：${chapterTitle} ${path.basename(file)}`)
  }
  const entries = await readdir(chapterDir, { withFileTypes: true })
  const validImages = entries.filter((entry) => entry.isFile() && /\.(webp|jpe?g|png|gif)$/i.test(entry.name))
  if (validImages.length < expectedCount) {
    throw new Error(`章节落盘图片不足：${chapterTitle} ${validImages.length}/${expectedCount}`)
  }
}

async function hasIdentify() {
  if (hasIdentifyCache !== null) return hasIdentifyCache
  try {
    await execFileAsync('identify', ['-version'])
    hasIdentifyCache = true
  } catch {
    hasIdentifyCache = false
  }
  return hasIdentifyCache
}

async function imageSignature(filePath) {
  const fd = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(12)
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await fd.close()
  }
}

function validImageSignature(filePath, signature) {
  const ext = path.extname(filePath).toLowerCase()
  const hex = signature.toString('hex')
  if (ext === '.webp') return /^52494646[0-9a-f]{8}57454250/i.test(hex)
  if (ext === '.jpg' || ext === '.jpeg') return /^ffd8ff/i.test(hex)
  if (ext === '.png') return /^89504e470d0a1a0a/i.test(hex)
  if (ext === '.gif') return /^474946383761|^474946383961/i.test(hex)
  return true
}

async function checkImageFile(filePath) {
  let info
  try {
    info = await stat(filePath)
  } catch (error) {
    return { ok: false, reason: `missing: ${error.message}` }
  }
  if (!info.isFile() || info.size <= 0) return { ok: false, reason: 'empty_or_missing' }
  const signature = await imageSignature(filePath)
  if (!validImageSignature(filePath, signature)) return { ok: false, reason: 'bad_signature' }
  if (await hasIdentify()) {
    try {
      const { stdout } = await execFileAsync('identify', ['-quiet', '-format', '%w %h', filePath])
      const [width, height] = stdout.trim().split(/\s+/).map(Number)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { ok: false, reason: 'invalid_dimensions' }
      }
      return { ok: true, width, height, mode: 'imagemagick' }
    } catch (error) {
      return { ok: false, reason: `decode_failed: ${error.message}` }
    }
  }
  return { ok: true, mode: 'signature' }
}

function normalizeImageCheckStatus(imageCheck) {
  const status = String(imageCheck?.status || 'unknown')
  return ['passed', 'failed', 'pending', 'checking', 'unknown'].includes(status) ? status : 'unknown'
}

function chapterImageCheckTag(chapter) {
  const imageCheck = chapter?.imageCheck || {}
  const status = normalizeImageCheckStatus(imageCheck)
  return {
    status,
    checkedAt: String(imageCheck.checkedAt || ''),
    total: Number(imageCheck.total || 0),
    failed: Number(imageCheck.failed || 0),
  }
}

function emptyImageCheckSummary() {
  return {
    passed: 0,
    failed: 0,
    checking: 0,
    pending: 0,
    unknown: 0,
    total: 0,
  }
}

function addImageCheckSummary(summary, tag) {
  const status = normalizeImageCheckStatus(tag)
  summary[status] = (summary[status] || 0) + 1
  summary.total += 1
  return summary
}

async function writeChapterImageCheck(local, imageCheck, jobId = 'image-check') {
  if (!local?.metadataChapterFile) throw new Error('章节元数据不存在')
  await withLock(fileLocks, path.resolve(local.metadataChapterFile), async () => {
    const current = JSON.parse(await readFile(local.metadataChapterFile, 'utf8'))
    current.imageCheck = imageCheck
    await atomicWriteFile(local.metadataChapterFile, JSON.stringify(current, null, 2), { jobId })
    const metadata = JSON.parse(await readFile(local.metadataChapterFile, 'utf8'))
    if (chapterUuidOf(metadata) !== chapterUuidOf(local.chapter)) throw new Error('章节元数据检查状态写入校验失败')
    if (!metadata.imageCheck?.status) throw new Error('章节图片检查状态缺失')
    local.chapter = current
  })
}

async function runImageCheckJob(job) {
  try {
    updateImageCheckJob(job, { status: 'running', message: '读取章节文件' })
    const local = await findLocalChapter(job.comicPathWord, job.chapterUuid)
    if (!local?.files?.length) {
      throw new Error('找不到本地章节图片')
    }
    await writeChapterImageCheck(local, {
      status: 'checking',
      checkedAt: '',
      checkerVersion: 1,
      mode: await hasIdentify() ? 'imagemagick' : 'signature',
      total: local.files.length,
      passed: 0,
      failed: 0,
      failedFiles: [],
    }, job.id)
    updateImageCheckJob(job, { total: local.files.length, checked: 0, failed: 0, message: '检查图片' })
    const failedFiles = []
    let passed = 0
    for (const [index, file] of local.files.entries()) {
      const result = await checkImageFile(file)
      if (result.ok) {
        passed += 1
      } else {
        failedFiles.push({
          index: index + 1,
          file: path.basename(file),
          reason: result.reason,
        })
      }
      updateImageCheckJob(job, {
        checked: index + 1,
        failed: failedFiles.length,
        message: `检查图片 ${index + 1}/${local.files.length}`,
      })
    }
    const imageCheck = {
      status: failedFiles.length ? 'failed' : 'passed',
      checkedAt: new Date().toISOString(),
      checkerVersion: 1,
      mode: await hasIdentify() ? 'imagemagick' : 'signature',
      total: local.files.length,
      passed,
      failed: failedFiles.length,
      failedFiles,
    }
    await writeChapterImageCheck(local, imageCheck, job.id)
    updateImageCheckJob(job, {
      status: failedFiles.length ? 'failed' : 'completed',
      checked: local.files.length,
      failed: failedFiles.length,
      message: failedFiles.length ? `发现异常图片 ${failedFiles.length}` : '检查通过',
    })
  } catch (error) {
    updateImageCheckJob(job, { status: 'failed', message: error.message })
  }
}

async function enqueueInventoryImageChecks() {
  const downloadedComics = await listDownloaded()
  const queued = []
  const skipped = []
  for (const comic of downloadedComics) {
    for (const chapterUuid of comic.chapterUuids || []) {
      const tag = comic.chapterImageChecks?.[chapterUuid]
      if (tag?.status === 'passed') {
        skipped.push({ comicPathWord: comic.comicPathWord, chapterUuid, reason: 'passed' })
        continue
      }
      const job = enqueueImageCheck({
        comicPathWord: comic.comicPathWord,
        chapterUuid,
        chapterTitle: chapterUuid,
        reason: 'inventory-full-check',
      })
      if (job) queued.push(publicImageCheckJob(job))
    }
  }
  return { queued, skipped, summary: latestImageCheckSummary() }
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
    updateJob(job, { status: 'running', stage: 'fetching_comic', message: '读取漫画信息' })
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
    await atomicWriteJson(metadataComicFile, appComicMetadataFrom(comic), {
      jobId: job.id,
      verify: (metadata) => {
        if (!comicPathWordOf(metadata)) throw new Error('漫画元数据写入校验失败')
      },
    })
    updateJob(job, { stage: 'comic_ready', message: '漫画信息已获取' })

    for (const chapterUuid of chapterUuids) {
      await withLock(chapterLocks, `${comicPathWord}:${chapterUuid}`, async () => {
      const found = findChapter(comic, chapterUuid)
      if (!found) throw new Error(`找不到章节 ${chapterUuid}`)

      const chapterMeta = found.chapter
      const groupChapters = comic.groupsChapters?.[found.groupPathWord] || []
      const group = comic.groups?.[found.groupPathWord]
      const groupTitle = cleanName(group?.name || group?.title || chapterMeta.group_name || found.groupPathWord)
      const chapterTitle = cleanName(chapterTitleOf(chapterMeta, chapterUuid))
      const order = appOrderOf(chapterMeta, groupChapters.findIndex((item) => chapterUuidOf(item) === chapterUuid) + 1 || job.doneChapters + 1)
      updateJob(job, { chapterUuid, chapterTitle })

      updateJob(job, { stage: 'fetching_chapter', message: `读取章节 ${chapterTitle}` })
      const chapter = await getChapter(comicPathWord, chapterUuid, token)
      const contents = chapter.chapter?.contents || []
      const words = chapter.chapter?.words || contents.map((_, index) => index)
      if (contents.length === 0) throw new Error(`章节没有图片：${chapterTitle}`)
      for (const [index, content] of contents.entries()) {
        if (!content?.url) throw new Error(`章节图片地址为空：${chapterTitle} #${index + 1}`)
      }
      job.totalImages += contents.length

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
      const imageJobs = contents.map((content, i) => {
        const imageUrl = String(content.url || '').replace('.c800x.', '.c1500x.')
        const index = Number(words[i] ?? i) + 1
        return {
          chapterUuid,
          chapterTitle,
          index,
          url: imageUrl,
          filePath: path.join(chapterDir, `${String(index).padStart(3, '0')}.webp`),
          status: 'pending',
          error: '',
          updatedAt: new Date().toISOString(),
        }
      })
      const imageOffset = job.images.length
      job.images.push(...imageJobs)
      updateJob(job, { stage: 'chapter_ready', totalImages: job.totalImages, message: `章节图片已获取 ${chapterTitle}` })

      if (force) {
        updateJob(job, { stage: 'preparing_chapter', message: `移动旧章节 ${chapterTitle}` })
        await moveForcedChapterAside({ comicPathWord, chapterUuid, comicDir, metadataComicDir, chapterDir, metadataChapterFile, metadataChapterDir })
      }

      const downloadedFiles = []
      updateJob(job, { stage: 'downloading_images', message: `下载 ${chapterTitle} ${job.doneImages}/${job.totalImages}` })
      await runWithConcurrency(imageJobs, config.imgConcurrency, async (imageJob, i) => {
        const absoluteImageIndex = imageOffset + i
        updateJobImage(job, absoluteImageIndex, { status: 'running', error: '' })
        try {
          const downloadedFile = await downloadImage(imageJob.url, imageJob.filePath)
          downloadedFiles.push(downloadedFile)
          job.doneImages += 1
          updateJobImage(job, absoluteImageIndex, { status: 'completed', filePath: downloadedFile })
          updateJob(job, { doneImages: job.doneImages, message: `下载 ${chapterTitle} ${job.doneImages}/${job.totalImages}` })
          if (config.imgDownloadIntervalSec > 0) await sleep(config.imgDownloadIntervalSec)
        } catch (error) {
          updateJobImage(job, absoluteImageIndex, { status: 'failed', error: error.message })
          throw error
        }
      })
      await validateDownloadedImages({ chapterDir, files: downloadedFiles, expectedCount: contents.length, chapterTitle })
      updateJob(job, { stage: 'images_ready', message: `图片下载完成 ${chapterTitle}` })

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
      updateJob(job, { stage: 'writing_metadata', message: `写入元数据 ${chapterTitle}` })
      await atomicWriteJson(metadataChapterFile, appChapterMetadata, {
        jobId: job.id,
        verify: (metadata) => {
          if (chapterUuidOf(metadata) !== chapterUuid) throw new Error(`章节元数据写入校验失败：${chapterTitle}`)
        },
      })
      updateJob(job, { stage: 'metadata_ready', message: `元数据写入完成 ${chapterTitle}` })
      enqueueImageCheck({ comicPathWord, chapterUuid, chapterTitle, reason: 'download-completed' })
      job.doneChapters += 1
      updateJob(job, { doneChapters: job.doneChapters })
      if (config.chapterDownloadIntervalSec > 0) await sleep(config.chapterDownloadIntervalSec)
      })
    }

    validateJobCompletion(job)
    updateJob(job, { status: 'completed', stage: 'completed', message: '下载完成' })
  } catch (error) {
    updateJob(job, { status: 'failed', stage: 'failed', message: error.message })
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

async function scanLibraryItemsWithTags({ type = 'all', tag = '' } = {}) {
  if (!String(tag || '').trim()) {
    const items = await scanLibraryItems({ type })
    for (const item of items) syncItemTagIndex(item).catch(() => {})
    return items
  }
  const keys = searchItemKeys(tag, { type })
  const items = []
  for (const key of keys) {
    try {
      items.push(await libraryHandler(key.type).getItem(key.itemId))
    } catch {
      // Ignore stale tag index rows; future tag edits or imports will refresh them.
    }
  }
  return items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

async function route(req, res) {
  const startedAt = process.hrtime.bigint()
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = decodeURIComponent(url.pathname)
  const shouldLogRequest = pathname !== '/api/events'
  if (shouldLogRequest) {
    res.once('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      console.log(`${req.method} ${pathname} ${res.statusCode} ${elapsedMs.toFixed(1)}ms`)
    })
  }

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
    if (pathname === '/api/image-check/status' && req.method === 'GET') return json(res, 200, latestImageCheckSummary())
    if (pathname === '/api/image-check/inventory' && req.method === 'POST') return json(res, 202, await enqueueInventoryImageChecks())
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
    if (pathname === '/api/library/tags' && req.method === 'GET') {
      return json(res, 200, listTags())
    }
    if (pathname === '/api/library/items' && req.method === 'GET') {
      return json(res, 200, await scanLibraryItemsWithTags({
        type: url.searchParams.get('type') || 'all',
        tag: url.searchParams.get('tag') || '',
      }))
    }
    if (pathname === '/api/library/items/sample' && req.method === 'POST') {
      const handler = libraryHandler(url.searchParams.get('type') || 'epub')
      if (!handler.createSampleItem) return json(res, 400, { error: 'This library type has no sample generator' })
      const item = await handler.createSampleItem()
      await syncItemTagIndex(item)
      return json(res, 201, item)
    }
    if (pathname === '/api/library/items' && req.method === 'POST') {
      const type = url.searchParams.get('type') || 'epub'
      const handler = libraryHandler(type)
      if (!handler.importItem) return json(res, 400, { error: 'This library type is not importable' })
      const form = await readMultipart(req)
      const files = form.files.filter((item) => item.buffer?.length)
      const file = files.find((item) => item.name === 'file') || files[0]
      const item = await handler.importItem({
        fileName: file?.filename || '',
        buffer: file?.buffer || Buffer.alloc(0),
        files,
        fields: form.fields,
      })
      await syncItemTagIndex(item)
      if (handler.enqueueThumbnails) handler.enqueueThumbnails(item.itemId, { force: false }).catch(() => {})
      return json(res, 201, item)
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
      if (action === 'thumbnail') {
        if (!handler.getThumbnail) return json(res, 400, { error: 'This library type does not support thumbnails' })
        const thumb = await handler.getThumbnail(itemId, unitId, parts[7] || 'cover')
        return binary(res, 200, thumb.body, thumb.contentType)
      }
      if (action === 'resource') {
        const resource = await handler.getResource(itemId, url.searchParams.get('path') || '', {
          subtitle: url.searchParams.get('subtitle') === '1',
        })
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
      if (action === 'tags') {
        if (!handler.updateItemTags) return json(res, 400, { error: 'This library type does not support tags' })
        const body = await readJson(req)
        const item = await handler.updateItemTags(itemId, body.tags || [])
        await setItemTags({ type, itemId, tags: item.tags || [] })
        return json(res, 200, item)
      }
      if (action === 'thumbnails') {
        if (!handler.enqueueThumbnails) return json(res, 400, { error: 'This library type does not support thumbnails' })
        const body = await readJson(req)
        return json(res, 202, await handler.enqueueThumbnails(itemId, { force: body.force !== false }))
      }
      if (action === 'units' && parts[6] && parts[7] === 'thumbnail') {
        if (!handler.enqueueThumbnail) return json(res, 400, { error: 'This library type does not support thumbnails' })
        const body = await readJson(req)
        return json(res, 202, { job: await handler.enqueueThumbnail(itemId, parts[6], { force: body.force !== false }) })
      }
      if (action === 'units' && parts[6] && parts[7] === 'tags') {
        if (!handler.updateUnitTags) return json(res, 400, { error: 'This library type does not support unit tags' })
        const body = await readJson(req)
        const unit = await handler.updateUnitTags(itemId, parts[6], body.tags || [])
        await setUnitTags({ type, itemId, unitId: parts[6], tags: unit.tags || [] })
        return json(res, 200, unit)
      }
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
        if (job.deleted || job.status !== 'failed') continue
        const retry = createJob({ ...job, retryOf: job.id })
        updateJob(job, { message: `${job.message || '失败'} · 已创建重试任务 ${retry.id}` })
        startJob(retry)
        retried.push(publicJob(retry))
      }
      return json(res, 202, { retried })
    }
    if (pathname === '/api/jobs/clear-active' && req.method === 'POST') {
      let cleared = 0
      for (const [id, job] of [...jobs.entries()]) {
        if (job.deleted || job.status === 'completed') continue
        job.deleted = true
        job.updatedAt = new Date().toISOString()
        cleared += 1
        emit('jobDelete', { id })
      }
      return json(res, 200, { cleared })
    }
    if (pathname === '/api/jobs/clear-completed' && req.method === 'POST') {
      let cleared = 0
      for (const [id, job] of [...jobs.entries()]) {
        if (job.deleted || job.status !== 'completed') continue
        job.deleted = true
        job.updatedAt = new Date().toISOString()
        cleared += 1
        emit('jobDelete', { id })
      }
      return json(res, 200, { cleared })
    }
    if (pathname.startsWith('/api/jobs/') && req.method === 'DELETE') {
      const id = pathname.split('/').pop()
      const job = jobs.get(id)
      if (job && !job.deleted) {
        job.deleted = true
        job.updatedAt = new Date().toISOString()
        emit('jobDelete', { id })
      }
      return json(res, 200, { deleted: Boolean(job) })
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
      const batchId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const nextJobs = createChapterJobs({ ...body, batchId })
      jobBatches.set(batchId, {
        id: batchId,
        comicPathWord: body.comicPathWord,
        requestedChapterUuids: body.chapterUuids,
        createdJobIds: nextJobs.map((job) => job.id),
        createdAt: new Date().toISOString(),
      })
      for (const job of nextJobs) startJob(job)
      return json(res, 202, { batch: jobBatches.get(batchId), jobs: nextJobs.map(publicJob) })
    }

    return serveStatic(req, res, pathname)
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: error.message })
  }
}

registerLibraryHandler(createEpubHandler({ dataDir: DATA_DIR, safeSegment, pathExists, moveAside }))
registerLibraryHandler(createStreamMediaHandler({ type: 'media', dataDir: DATA_DIR, safeSegment, pathExists, getConfig: () => config }))

await mkdir(DOWNLOAD_DIR, { recursive: true })
await initTagStore(DATA_DIR)
config = await loadConfig()
createServer(route).listen(PORT, HOST, () => {
  console.log(`copymanga web listening on http://${HOST}:${PORT}`)
  console.log(`download dir: ${DOWNLOAD_DIR}`)
})
