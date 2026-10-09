import { createServer } from 'node:http'
import { open, readFile, readdir, stat, writeFile, mkdir, rename, rm, mkdtemp } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { promisify } from 'node:util'
import { registerLibraryHandler, libraryHandler, libraryTypes, scanLibraryItems } from './library/registry.mjs'
import { createEpubHandler } from './library/types/epub.mjs'
import { createStreamMediaHandler } from './library/types/stream-media.mjs'
import { initTagStore, listTags, normalizeTagName, parseTags, searchItemKeys, setItemTags, setUnitTags, syncItemTagIndex } from './library/tag-store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = path.join(__dirname, 'static')
const DATA_DIR = process.env.DATA_DIR || '/data'
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(DATA_DIR, 'downloads')
const PREVIEW_CACHE_DIR = path.join(DATA_DIR, 'cache', 'preview')
const READING_PROGRESS_DIR = path.join(DATA_DIR, 'cache', 'reading-progress')
const INVENTORY_INDEX_DIR = path.join(DATA_DIR, 'cache', 'inventory-index')
const LIBRARY_HISTORY_DIR = path.join(DATA_DIR, 'cache', 'library', 'history')
const LIBRARY_HISTORY_INDEX = path.join(LIBRARY_HISTORY_DIR, 'index.json')
const LIBRARY_INDEX_DIR = path.join(DATA_DIR, 'cache', 'library-index')
const LIBRARY_INDEX_BASE = path.join(LIBRARY_INDEX_DIR, 'media-items')
const TAG_SCRIPTS_DIR = process.env.TAG_SCRIPTS_DIR || path.join(DATA_DIR, 'tag-scripts')
const TAG_SCRIPT_RUN_DIR = path.join(DATA_DIR, 'cache', 'library', 'tag-runs')
const TAG_OVERRIDE_DIR = path.join(DATA_DIR, 'cache', 'library', 'tag-overrides')
const TAG_SCRIPT_CONFIG_DIR = path.join(DATA_DIR, 'cache', 'library', 'tag-script-config')
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
const libraryHistoryCache = new Map()
const libraryHistoryDirty = new Set()
const libraryHistoryTimers = new Map()
let libraryHistoryIndex = null
let libraryHistoryIndexTimer = null
const SUBTITLE_PRESENT_TAG = normalizeTagName('字幕v1: 有')
const SERIES_TAG_PREFIX = normalizeTagName('系列:')
// 超过这个条目数，JSON.stringify 的产出会逼近 V8 的 512MB 字符串上限，
// 届时重建是直接抛 Invalid string length，而不是变慢。
const LIBRARY_INDEX_SIZE_WARN = 250000

const libraryIndexState = {
  items: [],
  seriesMap: new Map(),
  builtAt: '',
  loadedFrom: '',
  status: 'missing',
  dirty: true,
  error: '',
  buildId: 0,
  sourceCount: 0,
  itemCount: 0,
}
let libraryIndexRebuildPromise = null
let libraryIndexRebuildRequested = false
let tagScriptsCache = null
const tagJobs = new Map()
const tagQueue = []
const runningTagJobIds = new Set()
let tagWorkerTimer = null
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

function webHeaders(headers = {}) {
  return {
    'Permissions-Policy': 'clipboard-read=(self), clipboard-write=(self)',
    ...headers,
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, webHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }))
  res.end(body)
}

function text(res, status, body) {
  res.writeHead(status, webHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }))
  res.end(body)
}

function binary(res, status, body, contentType) {
  res.writeHead(status, webHeaders({
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=3600',
  }))
  res.end(body)
}

function streamFile(res, filePath, contentType) {
  res.writeHead(200, webHeaders({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
  }))
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

async function atomicWriteJson(filePath, payload, { jobId = 'job', verify, compact = false } = {}) {
  await withLock(fileLocks, path.resolve(filePath), async () => {
    // compact 用于超大 payload：缩进会多占约 15% 的字符串长度和峰值内存
    await atomicWriteFile(filePath, JSON.stringify(payload, null, compact ? 0 : 2), { jobId })
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    if (verify) verify(parsed)
  })
}

async function atomicWriteJsonIfChanged(filePath, payload, { jobId = 'job', verify } = {}) {
  const nextBody = JSON.stringify(payload, null, 2)
  return await withLock(fileLocks, path.resolve(filePath), async () => {
    try {
      const currentBody = await readFile(filePath, 'utf8')
      if (currentBody === nextBody) {
        const parsed = JSON.parse(currentBody)
        if (verify) verify(parsed)
        return false
      }
    } catch {
      // Missing or unreadable metadata should be rewritten normally.
    }
    await atomicWriteFile(filePath, nextBody, { jobId })
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    if (verify) verify(parsed)
    return true
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
    mediaImportProfiles: {
      'rj-media': {
        maxDepth: 6,
        idPattern: '(?:RJ|VJ|BJ|EJ)\\d{6,8}',
        defaultMetadataActions: ['builtin-scan-media-units', 'builtin-subtitles', 'rj-dlsite-v1', 'builtin-thumbnails'],
        fetchDlsiteCover: true,
        fetchDlsiteTitle: true,
        dlsiteRequestMinIntervalMs: 1500,
        dlsiteRequestJitterMs: 800,
      },
    },
    mediaSubtitleExtensions: 'srt,vtt,crt,ass,ssa,lrc,sbv,smi,sami,ttml,dfxp,xml,sub',
    mediaTagDisplayKeys: ['DL标题:', 'DL社团:', 'DL声优:', 'DL标签:', '字幕v1:'],
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
    mediaImportProfiles: normalizeMediaImportProfiles(value?.mediaImportProfiles, defaults.mediaImportProfiles),
    mediaSubtitleExtensions: normalizeExtensionList(value?.mediaSubtitleExtensions, defaults.mediaSubtitleExtensions),
    mediaTagDisplayKeys: normalizeStringList(value?.mediaTagDisplayKeys, defaults.mediaTagDisplayKeys),
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

function normalizeMediaImportProfiles(value, defaults) {
  const source = value && typeof value === 'object' ? value : {}
  const rj = source['rj-media'] && typeof source['rj-media'] === 'object' ? source['rj-media'] : {}
  const fallback = defaults['rj-media']
  return {
    'rj-media': {
      maxDepth: clampNumber(rj.maxDepth, 1, 20, fallback.maxDepth),
      idPattern: String(rj.idPattern || fallback.idPattern).trim() || fallback.idPattern,
      defaultMetadataActions: normalizeRjDefaultMetadataActions(rj.defaultMetadataActions, fallback.defaultMetadataActions),
      fetchDlsiteCover: Boolean(rj.fetchDlsiteCover ?? fallback.fetchDlsiteCover),
      fetchDlsiteTitle: Boolean(rj.fetchDlsiteTitle ?? fallback.fetchDlsiteTitle),
      dlsiteRequestMinIntervalMs: clampNumber(rj.dlsiteRequestMinIntervalMs, 0, 60000, fallback.dlsiteRequestMinIntervalMs),
      dlsiteRequestJitterMs: clampNumber(rj.dlsiteRequestJitterMs, 0, 60000, fallback.dlsiteRequestJitterMs),
    },
  }
}

function normalizeRjDefaultMetadataActions(value, fallback) {
  const tags = parseTags(value || fallback)
  if (tags.join(',') === 'builtin-subtitles,rj-dlsite-v1') return fallback
  return tags.length ? tags : fallback
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

function normalizeStringList(value, fallback = []) {
  const input = Array.isArray(value) ? value : String(value || '').split(/[,\n，]+/)
  const list = [...new Set(input.map((item) => String(item || '').trim()).filter(Boolean))]
  return list.length ? list : fallback
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

function createJob({ comicPathWord, chapterUuids, token, force = false, batchId = '', retryOf = '', supersededBy = '' }) {
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
    supersededBy,
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

async function walkMatchingFiles(dir, predicate) {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walkMatchingFiles(fullPath, predicate))
    else if (predicate(fullPath, entry.name)) files.push(fullPath)
  }
  return files
}

function inventoryIndexPath(comicPathWord) {
  return path.join(INVENTORY_INDEX_DIR, `${safeSegment(comicPathWord)}.json`)
}

async function readInventoryIndex(comicPathWord) {
  if (!comicPathWord) return {}
  try {
    return JSON.parse(await readFile(inventoryIndexPath(comicPathWord), 'utf8'))
  } catch {
    return {}
  }
}

async function writeInventoryContentIndex(comicPathWord, patch = {}) {
  if (!comicPathWord) return
  const current = await readInventoryIndex(comicPathWord)
  const next = {
    ...current,
    comicPathWord,
    contentUpdatedAt: patch.contentUpdatedAt || current.contentUpdatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await atomicWriteJson(inventoryIndexPath(comicPathWord), next, { jobId: 'inventory-index' })
}

async function countImagesUnder(dir) {
  const files = await walkMatchingFiles(dir, (file) => /\.(webp|jpe?g|png|gif)$/i.test(file))
  return files.length
}

async function newestFileMtime(files = []) {
  let newest = ''
  for (const file of files) {
    try {
      const info = await stat(file)
      const mtime = info.mtime.toISOString()
      if (mtime > newest) newest = mtime
    } catch {
      // Ignore files that disappeared during inventory scan.
    }
  }
  return newest
}

function readingStatsForItem(item, progressMap = {}) {
  const progress = progressMap[item.comicPathWord] || {}
  const read = new Set(Object.keys(progress.readChapters || {}))
  const all = item.allChapterUuids || []
  const total = all.length || Number(item.remoteChapterTotal || 0) || 0
  const readCount = all.length ? all.filter((uuid) => read.has(uuid)).length : read.size
  return { readCount, total, hasAnyRead: read.size > 0 }
}

function inventoryReadMatchesServer(item, readFilter, progressMap = {}) {
  if (!readFilter || readFilter === 'all') return true
  const stats = readingStatsForItem(item, progressMap)
  if (readFilter === 'hasUnread') return stats.total > 0 && stats.readCount < stats.total
  if (readFilter === 'allRead') return stats.total > 0 && stats.readCount >= stats.total
  if (readFilter === 'unread') return stats.readCount === 0
  return true
}

function inventorySearchTokens(query = '') {
  return String(query || '')
    .trim()
    .split(/\s+/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const exclude = raw.startsWith('-')
      const body = exclude ? raw.slice(1) : raw
      return { exclude, text: body.replace(/^tag:/i, '').toLowerCase() }
    })
    .filter((item) => item.text)
}

function inventoryImageTag(summary = {}) {
  const failed = Number(summary.failed || 0)
  const checking = Number(summary.checking || 0)
  const pending = Number(summary.pending || 0)
  const unknown = Number(summary.unknown || 0)
  const total = Number(summary.total || 0)
  const passed = Number(summary.passed || 0)
  if (failed > 0) return ['图片异常', '图片未完全检查ok']
  if (checking > 0 || pending > 0) return ['图片检查中', '图片未完全检查ok']
  if (unknown > 0) return ['图片未检查', '图片未完全检查ok']
  if (total > 0 && passed === total) return ['图片ok', '图片检查ok', '图片检查通过']
  return ['图片未检查', '图片未完全检查ok']
}

function inventoryNeedsImageCheckSearch(keyword = '') {
  return inventorySearchTokens(keyword).some((token) => (
    token.text.includes('图片') || token.text.includes('image')
  ))
}

function inventoryImageFilterMatchesServer(item, imageFilter = 'all') {
  if (!imageFilter || imageFilter === 'all') return true
  const summary = item.imageCheckSummary || emptyImageCheckSummary()
  const passed = Number(summary.passed || 0)
  const failed = Number(summary.failed || 0)
  const checking = Number(summary.checking || 0)
  const pending = Number(summary.pending || 0)
  const unknown = Number(summary.unknown || 0)
  const total = Number(summary.total || 0)
  if (imageFilter === 'ok') return total > 0 && passed === total
  if (imageFilter === 'failed') return failed > 0
  if (imageFilter === 'checking') return checking + pending > 0
  if (imageFilter === 'unknown') return total === 0 || unknown > 0
  if (imageFilter === 'not-ok') return total === 0 || failed + checking + pending + unknown > 0 || passed < total
  return true
}

function inventoryKeywordMatchesServer(item, keyword = '') {
  const tokens = inventorySearchTokens(keyword)
  if (!tokens.length) return true
  const tags = inventoryImageTag(item.imageCheckSummary || {})
  const haystack = [
    item.title,
    item.comicPathWord,
    item.path,
    ...(Array.isArray(item.author) ? item.author : []),
    ...tags,
  ].join(' ').toLowerCase()
  return tokens.every((token) => {
    const matched = haystack.includes(token.text)
    return token.exclude ? !matched : matched
  })
}

function publicDownloadedItem(item) {
  const { chapterMetadataFiles, ...publicItem } = item
  return publicItem
}

async function enrichDownloadedComicDetails(summary) {
  const chapterImageChecks = {}
  const imageCheckSummary = emptyImageCheckSummary()
  let chapterFiles = []
  try {
    const chaptersDir = path.join(summary.metadataComicDir, 'chapters')
    const entries = await readdir(chaptersDir, { withFileTypes: true })
    chapterFiles = entries
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
      .map((entry) => path.join(chaptersDir, entry.name))
  } catch {
    chapterFiles = summary.chapterMetadataFiles || []
  }
  for (const chapterFile of chapterFiles) {
    try {
      const chapter = JSON.parse(await readFile(chapterFile, 'utf8'))
      const chapterUuid = chapterUuidOf(chapter) || path.basename(chapterFile, '.json')
      if (!chapterUuid) continue
      const tag = chapterImageCheckTag(chapter)
      chapterImageChecks[chapterUuid] = tag
      addImageCheckSummary(imageCheckSummary, tag)
    } catch {
      // Ignore broken chapter metadata and keep the page usable.
    }
  }
  let imageCount = summary.imageCount
  if (imageCount == null && summary.path) {
    imageCount = await countImagesUnder(path.join(DOWNLOAD_DIR, summary.path))
  }
  return {
    ...summary,
    imageCount,
    imageCheckSummary,
    chapterImageChecks,
  }
}

async function listDownloaded({ includeDetails = false } = {}) {
  if (config.metadataDir) return listDownloadedFromMetadataDir({ includeDetails })

  const metadataFiles = await walkMatchingFiles(DOWNLOAD_DIR, (file, name) => (
    name === APP_COMIC_METADATA || name === APP_CHAPTER_METADATA
  ))
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
          if (!chapterUuid) continue
          chapterUuids.push(chapterUuid)
          if (includeDetails) {
            const tag = chapterImageCheckTag(chapter)
            chapterImageChecks[chapterUuid] = tag
            addImageCheckSummary(imageCheckSummary, tag)
          }
        } catch {
          // Ignore broken chapter metadata and keep the rest of the inventory usable.
        }
      }
      const allChapterUuids = collectAllChapterUuids(comic)
      const remoteChapterTotal = countComicChapters(comic)
      const info = await stat(file)
      const index = await readInventoryIndex(comicPathWordOf(comic))
      const contentUpdatedAt = index.contentUpdatedAt || await newestFileMtime(chapterFiles) || info.mtime.toISOString()
      const summary = {
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
        imageCount: null,
        imageCheckSummary,
        chapterImageChecks,
        metadataUpdatedAt: info.mtime.toISOString(),
        contentUpdatedAt,
        updatedAt: contentUpdatedAt,
        chapterMetadataFiles: chapterFiles,
      }
      comics.push(includeDetails ? await enrichDownloadedComicDetails(summary) : summary)
    } catch (error) {
      console.warn(`skip invalid inventory file ${file}: ${error.message}`)
    }
  }
  return comics.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function listDownloadedPage({ page = 1, limit = 10, readFilter = 'all', imageFilter = 'all', keyword = '' } = {}) {
  const pageNumber = Math.max(1, Math.floor(Number(page) || 1))
  const pageSize = clampNumber(limit, 1, 100, 10)
  const progressMap = await listReadingProgress()
  const needsImageCheck = inventoryNeedsImageCheckSearch(keyword) || (imageFilter && imageFilter !== 'all')
  const summaries = await listDownloaded({ includeDetails: false })
  const searchable = needsImageCheck ? await Promise.all(summaries.map(enrichDownloadedComicDetails)) : summaries
  const filtered = searchable
    .filter((item) => inventoryReadMatchesServer(item, readFilter, progressMap))
    .filter((item) => inventoryImageFilterMatchesServer(item, imageFilter))
    .filter((item) => inventoryKeywordMatchesServer(item, keyword))
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const normalizedPage = Math.max(1, Math.min(totalPages, pageNumber))
  const offset = (normalizedPage - 1) * pageSize
  const items = await Promise.all(filtered.slice(offset, offset + pageSize).map(enrichDownloadedComicDetails))
  return {
    items: items.map(publicDownloadedItem),
    total,
    page: normalizedPage,
    limit: pageSize,
    totalPages,
  }
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

async function listDownloadedFromMetadataDir({ includeDetails = true } = {}) {
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
      const summary = await downloadedComicSummaryFromMetadataFile(file, comicPathWord)
      comics.push(includeDetails ? await enrichDownloadedComicDetails(summary) : summary)
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
  await atomicWriteJsonIfChanged(metadataFile, appComicMetadataFrom(comic), {
    jobId: 'inventory',
    verify: (metadata) => {
      if (!comicPathWordOf(metadata)) throw new Error('漫画元数据写入校验失败')
    },
  })
}

async function getDownloadedComic(comicPathWord, { refresh = false, token = '' } = {}) {
  if (config.metadataDir) return getDownloadedComicFromMetadataDir(comicPathWord, { refresh, token })

  const downloadedComics = await listDownloaded()
  const downloadedComicSummary = downloadedComics.find((item) => item.comicPathWord === comicPathWord)
  const downloadedComic = downloadedComicSummary ? await enrichDownloadedComicDetails(downloadedComicSummary) : null
  if (!downloadedComic) throw new Error(`本地库存不存在 ${comicPathWord}`)
  if (refresh) {
    const comic = await getComic(comicPathWord)
    await writeDownloadedComicMetadata(downloadedComic, comic)
    return {
      ...markDownloadedChapters(comic, [downloadedComic]),
      source: 'remote',
      downloadedInfo: downloadedComic,
    }
  }

  const metadataComicFile = downloadedComic.metadataComicFile || path.join(metadataRoot(), downloadedComic.path, APP_COMIC_METADATA)
  const comic = normalizeComicMetadata(JSON.parse(await readFile(metadataComicFile, 'utf8')))
  return {
    ...markDownloadedChapters(comic, [downloadedComic]),
    source: 'metadata',
    downloadedInfo: downloadedComic,
  }
}

async function getDownloadedComicFromMetadataDir(comicPathWord, { refresh = false, token = '' } = {}) {
  const file = metadataComicFile(comicPathWord)
  const comic = normalizeComicMetadata(JSON.parse(await readFile(file, 'utf8')))
  const downloadedComic = await enrichDownloadedComicDetails(await downloadedComicSummaryFromMetadataFile(file, comicPathWord))
  if (refresh) {
    const remote = await getComic(comicPathWord)
    await writeDownloadedComicMetadata(downloadedComic, remote)
    return {
      ...markDownloadedChapters(remote, [downloadedComic]),
      source: 'remote',
      downloadedInfo: downloadedComic,
    }
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
  const info = await stat(file)
  const index = await readInventoryIndex(comicPathWord)
  const chapterFiles = chapterUuids.map((chapterUuid) => path.join(metadataComicDir, 'chapters', `${chapterUuid}.json`))
  const contentUpdatedAt = index.contentUpdatedAt || await newestFileMtime(chapterFiles) || info.mtime.toISOString()
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
    imageCheckSummary: emptyImageCheckSummary(),
    chapterImageChecks: {},
    metadataUpdatedAt: info.mtime.toISOString(),
    contentUpdatedAt,
    updatedAt: contentUpdatedAt,
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
  const downloadedComics = await listDownloaded({ includeDetails: true })
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
      await writeInventoryContentIndex(comicPathWord, { contentUpdatedAt: new Date().toISOString() })
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
    const type = ({
      '.css': 'text/css',
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.svg': 'image/svg+xml',
    })[ext] || 'application/octet-stream'
    res.writeHead(200, webHeaders({ 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': body.length }))
    res.end(body)
  } catch {
    text(res, 404, 'Not found')
  }
}

async function scanLibraryItemsWithTags({ type = 'all', tag = '' } = {}) {
  const indexed = searchLibraryIndex({
    type,
    tag,
    keyword: '',
    sourceProfile: '',
    page: 1,
    limit: 0,
    sort: 'imported_desc',
  })
  if (indexed.index.status === 'ready') return indexed.items
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
  return items.sort(compareLibraryImportOrder)
}

function compareLibraryImportOrder(a, b) {
  return String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || ''))
}

function libraryIndexPath(version = 0) {
  return `${LIBRARY_INDEX_BASE}.${version}.json`
}

async function loadLibraryIndexCache() {
  await mkdir(LIBRARY_INDEX_DIR, { recursive: true })
  for (const version of [0, 1, 2]) {
    const filePath = libraryIndexPath(version)
    try {
      const payload = JSON.parse(await readFile(filePath, 'utf8'))
      if (payload?.schema !== 3 || !Array.isArray(payload.items)) continue
      libraryIndexState.items = payload.items.map(normalizeLibraryIndexItem)
      libraryIndexState.seriesMap = Array.isArray(payload.series) && payload.series.length
        ? new Map(payload.series.map((entry) => [entry.key, entry]))
        : buildSeriesMap(libraryIndexState.items)
      libraryIndexState.builtAt = String(payload.builtAt || '')
      libraryIndexState.loadedFrom = filePath
      libraryIndexState.status = 'ready'
      libraryIndexState.dirty = false
      libraryIndexState.error = ''
      libraryIndexState.sourceCount = Number(payload.sourceCount || payload.items.length || 0)
      libraryIndexState.itemCount = libraryIndexState.items.length
      return libraryIndexPublicStatus()
    } catch {
      // Try the next cache generation.
    }
  }
  libraryIndexState.status = 'missing'
  libraryIndexState.dirty = true
  return libraryIndexPublicStatus()
}

function libraryIndexPublicStatus() {
  return {
    status: libraryIndexState.status,
    dirty: Boolean(libraryIndexState.dirty),
    builtAt: libraryIndexState.builtAt,
    loadedFrom: libraryIndexState.loadedFrom,
    sourceCount: libraryIndexState.sourceCount,
    itemCount: libraryIndexState.itemCount,
    error: libraryIndexState.error,
    buildId: libraryIndexState.buildId,
    rebuildQueued: Boolean(libraryIndexRebuildRequested),
  }
}

function markLibraryIndexDirty() {
  if (libraryIndexState.status === 'ready') libraryIndexState.dirty = true
}

async function rebuildLibraryIndex() {
  const buildId = libraryIndexState.buildId + 1
  libraryIndexState.buildId = buildId
  libraryIndexState.status = 'building'
  libraryIndexState.error = ''
  const startedAt = new Date().toISOString()
  try {
    const items = await scanLibraryItems({ type: 'all' })
    if (libraryIndexState.buildId !== buildId) {
      return { ...libraryIndexPublicStatus(), status: 'cancelled' }
    }
    const summaries = items.map(libraryIndexItemFromMetadata).sort(compareLibraryIndexItems)
    const seriesMap = buildSeriesMap(summaries)
    if (summaries.length >= LIBRARY_INDEX_SIZE_WARN) {
      console.warn(`library index has ${summaries.length} items; approaching the V8 512MB string limit for JSON.stringify — consider sharding the cache`)
    }
    const payload = {
      schema: 3,
      builtAt: new Date().toISOString(),
      startedAt,
      sourceCount: items.length,
      itemCount: summaries.length,
      items: summaries,
      series: [...seriesMap.values()],
    }
    await writeLibraryIndexPayload(payload, buildId)
    if (libraryIndexState.buildId !== buildId) {
      return { ...libraryIndexPublicStatus(), status: 'cancelled' }
    }
    libraryIndexState.items = summaries
    libraryIndexState.seriesMap = seriesMap
    libraryIndexState.builtAt = payload.builtAt
    libraryIndexState.loadedFrom = libraryIndexPath(0)
    libraryIndexState.status = 'ready'
    libraryIndexState.dirty = false
    libraryIndexState.error = ''
    libraryIndexState.sourceCount = items.length
    libraryIndexState.itemCount = summaries.length
    return libraryIndexPublicStatus()
  } catch (error) {
    if (libraryIndexState.buildId === buildId) {
      libraryIndexState.status = 'failed'
      libraryIndexState.error = error.message
    }
    throw error
  }
}

function startLibraryIndexRebuild() {
  if (libraryIndexRebuildPromise) {
    libraryIndexRebuildRequested = true
    if (libraryIndexState.status === 'ready') libraryIndexState.dirty = true
    return libraryIndexPublicStatus()
  }
  libraryIndexRebuildPromise = runLibraryIndexRebuildLoop()
  return libraryIndexPublicStatus()
}

async function runLibraryIndexRebuildLoop() {
  try {
    do {
      libraryIndexRebuildRequested = false
      try {
        await rebuildLibraryIndex()
      } catch (error) {
        console.error('library index rebuild failed', error)
      }
    } while (libraryIndexRebuildRequested)
  } finally {
    libraryIndexRebuildPromise = null
  }
}

async function writeLibraryIndexPayload(payload, buildId) {
  await mkdir(LIBRARY_INDEX_DIR, { recursive: true })
  const nextPath = `${LIBRARY_INDEX_BASE}.next.json`
  await atomicWriteJson(nextPath, payload, {
    jobId: `library-index-${buildId}`,
    compact: true,
    verify: (value) => {
      if (value?.schema !== 3 || !Array.isArray(value.items)) throw new Error('library index cache verify failed')
    },
  })
  for (const [from, to] of [[1, 2], [0, 1]]) {
    const source = libraryIndexPath(from)
    if (await pathExists(source)) await renameOrMove(source, libraryIndexPath(to))
  }
  await renameOrMove(nextPath, libraryIndexPath(0))
}

// 没有 系列: tag 的条目按「单成员系列」处理，筛选和展示就不必写特例。
function seriesKeyOf(item) {
  for (const tag of item.tags || []) {
    const normalized = normalizeTagName(tag)
    if (normalized.startsWith(SERIES_TAG_PREFIX)) {
      const value = normalized.slice(SERIES_TAG_PREFIX.length).trim()
      if (value) return value
    }
  }
  return `\u0000${item.type}\u001f${item.itemId}`
}

// 带 productId 的整体靠前；都带则先看字幕（有>无）再按 productId 逆序；
// 都不带按标题逆序。排第一的即「快速进入」的目标。
function compareSeriesPriority(a, b) {
  const pa = a.productId ? 1 : 0
  const pb = b.productId ? 1 : 0
  if (pa !== pb) return pb - pa
  if (pa === 1) {
    if (a.hasSubtitle !== b.hasSubtitle) return a.hasSubtitle ? -1 : 1
    const cmp = String(b.productId).localeCompare(String(a.productId), undefined, { numeric: true })
    if (cmp !== 0) return cmp
  }
  return String(b.title || '').localeCompare(String(a.title || ''), undefined, { numeric: true })
}

function buildSeriesMap(items) {
  const groups = new Map()
  for (const item of items) {
    const key = seriesKeyOf(item)
    const member = {
      type: item.type,
      itemId: item.itemId,
      title: item.displayTitle || item.title || item.itemId,
      cover: item.cover || '',
      productId: String(item.realProductId || ''),
    hasSubtitle: Boolean(item.hasSubtitle),
    }
    const list = groups.get(key)
    if (list) list.push(member)
    else groups.set(key, [member])
  }
  const result = new Map()
  for (const [key, members] of groups) {
    members.sort(compareSeriesPriority)
    result.set(key, {
      key,
      members,
      hasSubtitle: members.some((member) => member.hasSubtitle),
      primaryItemId: members[0]?.itemId || '',
    })
  }
  return result
}

function seriesOfItem(item) {
  return libraryIndexState.seriesMap.get(seriesKeyOf(item)) || null
}

function libraryIndexItemFromMetadata(item = {}) {
  const units = Array.isArray(item.mediaUnits) ? item.mediaUnits : []
  const tags = parseTags(item.tags || [])
  const unitTags = parseTags(units.flatMap((unit) => unit.tags || []))
  const dlsite = item.dlsite && typeof item.dlsite === 'object' ? item.dlsite : {}
  const displayTitle = String(dlsite.title || item.extractedTitle || item.title || item.itemId || '')
  const publishedAt = String(item.publishedAt || item.createdAt || '')
  const productId = String(item.productId || dlsite.productId || item.itemId || '')
  const realProductId = String(item.productId || dlsite.productId || '')
  const searchParts = [
    item.type,
    item.itemId,
    item.title,
    displayTitle,
    item.sourceProfile,
    productId,
    dlsite.title,
    dlsite.circle,
    dlsite.releaseDate,
    ...(Array.isArray(item.author) ? item.author : []),
    ...tags,
    ...unitTags,
  ]
  return normalizeLibraryIndexItem({
    type: item.type,
    itemId: item.itemId,
    title: item.title,
    displayTitle,
    cover: item.cover,
    sourceProfile: item.sourceProfile,
    productId,
    unitCount: item.unitCount || units.length || 0,
    tags,
    unitTags,
    dlsite: {
      title: dlsite.title || '',
      circle: dlsite.circle || '',
      releaseDate: dlsite.releaseDate || '',
    },
    createdAt: item.createdAt,
    importedAt: item.createdAt,
    publishedAt,
    sortTitle: displayTitle || item.title || item.itemId,
    sortImportedAt: item.createdAt || '',
    sortPublishedAt: publishedAt,
    sortProductId: productId,
    realProductId,
    hasSubtitle: [...tags, ...unitTags].some((tag) => normalizeTagName(tag) === SUBTITLE_PRESENT_TAG),
    searchText: normalizeTagName(searchParts.filter(Boolean).join('\n')),
  })
}

function normalizeLibraryIndexItem(item = {}) {
  return {
    type: String(item.type || ''),
    itemId: String(item.itemId || ''),
    title: String(item.title || item.itemId || ''),
    displayTitle: String(item.displayTitle || item.title || item.itemId || ''),
    cover: String(item.cover || ''),
    sourceProfile: String(item.sourceProfile || ''),
    productId: String(item.productId || ''),
    unitCount: Number(item.unitCount || 0),
    tags: parseTags(item.tags || []),
    unitTags: parseTags(item.unitTags || []),
    dlsite: {
      title: String(item.dlsite?.title || ''),
      circle: String(item.dlsite?.circle || ''),
      releaseDate: String(item.dlsite?.releaseDate || ''),
    },
    createdAt: String(item.createdAt || ''),
    importedAt: String(item.importedAt || item.createdAt || ''),
    publishedAt: String(item.publishedAt || item.createdAt || ''),
    sortTitle: normalizeTagName(item.sortTitle || item.displayTitle || item.title || item.itemId || ''),
    sortImportedAt: String(item.sortImportedAt || item.importedAt || item.createdAt || ''),
    sortPublishedAt: String(item.sortPublishedAt || item.publishedAt || item.importedAt || item.createdAt || ''),
    sortProductId: normalizeTagName(item.sortProductId || item.productId || item.itemId || ''),
    realProductId: String(item.realProductId || ''),
    hasSubtitle: Boolean(item.hasSubtitle),
    searchText: String(item.searchText || '').toLowerCase(),
  }
}

function compareLibraryIndexItems(a, b) {
  return String(b.sortImportedAt || '').localeCompare(String(a.sortImportedAt || '')) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
    String(a.itemId || '').localeCompare(String(b.itemId || ''))
}

function searchLibraryIndex({ type = 'all', tag = '', keyword = '', sourceProfile = '', seriesSubtitle = 'any', page = 1, limit = 50, sort = 'imported_desc' } = {}) {
  if (!libraryIndexState.items.length) {
    return {
      items: [],
      page,
      limit,
      total: 0,
      totalPages: 1,
      index: libraryIndexPublicStatus(),
    }
  }
  const normalizedType = String(type || 'all')
  const normalizedKeyword = normalizeTagName(keyword)
  const normalizedSourceProfile = String(sourceProfile || '').trim()
  const tagTokens = parseLibraryIndexTagQuery(tag)
  let items = libraryIndexState.items.filter((item) => normalizedType === 'all' || item.type === normalizedType)
  if (normalizedSourceProfile) items = items.filter((item) => item.sourceProfile === normalizedSourceProfile)
  if (normalizedKeyword) items = items.filter((item) => item.searchText.includes(normalizedKeyword))
  if (seriesSubtitle === 'has' || seriesSubtitle === 'none') {
    const want = seriesSubtitle === 'has'
    items = items.filter((item) => Boolean(seriesOfItem(item)?.hasSubtitle) === want)
  }
  if (tagTokens.length) {
    items = items.filter((item) => libraryIndexTagTokensMatch(item, tagTokens))
  }
  items = sortLibraryIndexItems(items, sort)
  const safeLimit = Math.max(0, Math.min(1000, Math.floor(Number(limit) || 50)))
  const safePage = Math.max(1, Math.floor(Number(page) || 1))
  const total = items.length
  const totalPages = Math.max(1, safeLimit ? Math.ceil(total / safeLimit) : 1)
  const offset = safeLimit ? (safePage - 1) * safeLimit : 0
  return {
    items: (safeLimit ? items.slice(offset, offset + safeLimit) : items).map(decorateWithSeries),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
    index: libraryIndexPublicStatus(),
  }
}

function publicLibraryIndexItem(item) {
  return {
    type: item.type,
    itemId: item.itemId,
    title: item.title,
    extractedTitle: item.displayTitle,
    cover: item.cover,
    sourceProfile: item.sourceProfile,
    productId: item.productId,
    unitCount: item.unitCount,
    tags: item.tags,
    dlsite: item.dlsite,
    createdAt: item.createdAt,
    importedAt: item.importedAt,
    publishedAt: item.publishedAt,
  }
}

function parseLibraryIndexTagQuery(query = '') {
  const input = String(query || '').trim()
  if (!input) return []
  return [...input.matchAll(/-?(?:tag|unitTag):"[^"]+"|-?(?:tag|unitTag):\S+|-\S+|\S+/gi)]
    .map((match) => match[0])
    .map((raw) => {
      const exclude = raw.startsWith('-')
      let body = exclude ? raw.slice(1) : raw
      const unitOnly = /^unitTag:/i.test(body)
      body = body.replace(/^(?:tag|unitTag):/i, '').replace(/^"|"$/g, '')
      return { exclude, unitOnly, name: normalizeTagName(body) }
    })
    .filter((item) => item.name)
}

function libraryIndexTagTokensMatch(item, tokens) {
  const itemTags = new Set((item.tags || []).map(normalizeTagName))
  const unitTags = new Set((item.unitTags || []).map(normalizeTagName))
  for (const token of tokens) {
    const source = token.unitOnly ? unitTags : new Set([...itemTags, ...unitTags])
    const matched = source.has(token.name)
    if (token.exclude ? matched : !matched) return false
  }
  return true
}

// 只给当前页挂系列信息：整库挂一遍没必要，而且会把 payload 撑大几倍。
function decorateWithSeries(item) {
  const entry = seriesOfItem(item)
  const base = publicLibraryIndexItem(item)
  if (!entry || entry.members.length < 2) return base
  return {
    ...base,
    series: {
      key: entry.key,
      count: entry.members.length,
      hasSubtitle: entry.hasSubtitle,
      primaryItemId: entry.primaryItemId,
      selfHasSubtitle: Boolean(item.hasSubtitle),
      members: entry.members,
    },
  }
}

function sortLibraryIndexItems(items, sort) {
  const list = [...items]
  const mode = String(sort || 'imported_desc')
  if (mode === 'random') return shuffleLibraryIndexItems(list)
  const byTitle = (a, b) => String(a.sortTitle || '').localeCompare(String(b.sortTitle || ''), undefined, { numeric: true })
  const byImported = (a, b) => String(a.sortImportedAt || '').localeCompare(String(b.sortImportedAt || ''))
  const byPublished = (a, b) => String(a.sortPublishedAt || '').localeCompare(String(b.sortPublishedAt || ''))
  const byProductId = (a, b) => String(a.sortProductId || '').localeCompare(String(b.sortProductId || ''), undefined, { numeric: true })
  const byUnitCount = (a, b) => Number(a.unitCount || 0) - Number(b.unitCount || 0)
  const comparators = {
    imported_asc: byImported,
    imported_desc: (a, b) => byImported(b, a),
    published_asc: byPublished,
    published_desc: (a, b) => byPublished(b, a),
    product_id_asc: byProductId,
    product_id_desc: (a, b) => byProductId(b, a),
    title_asc: byTitle,
    title_desc: (a, b) => byTitle(b, a),
    unit_count_asc: byUnitCount,
    unit_count_desc: (a, b) => byUnitCount(b, a),
  }
  return list.sort(comparators[mode] || comparators.imported_desc)
}

function shuffleLibraryIndexItems(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = items[index]
    items[index] = items[swapIndex]
    items[swapIndex] = current
  }
  return items
}

function libraryHistoryKey(type, itemId) {
  return `${String(type || '')}\u001f${String(itemId || '')}`
}

function libraryHistoryPath(type, itemId) {
  return path.join(LIBRARY_HISTORY_DIR, safeSegment(type), `${safeSegment(itemId)}.json`)
}

function normalizeLibraryHistory(value) {
  const now = new Date().toISOString()
  const type = String(value?.type || '')
  const itemId = String(value?.itemId || '')
  const position = value?.position && typeof value.position === 'object' ? value.position : {}
  return {
    type,
    itemId,
    title: String(value?.title || itemId || 'Untitled'),
    cover: String(value?.cover || ''),
    tags: Array.isArray(value?.tags) ? value.tags.map(String).filter(Boolean) : [],
    lastUnitId: String(value?.lastUnitId || ''),
    lastUnitTitle: String(value?.lastUnitTitle || ''),
    lastSectionId: String(value?.lastSectionId || ''),
    lastSectionTitle: String(value?.lastSectionTitle || ''),
    position: {
      kind: String(position.kind || ''),
      seconds: Number.isFinite(Number(position.seconds)) ? Number(position.seconds) : 0,
      duration: Number.isFinite(Number(position.duration)) ? Number(position.duration) : 0,
      ratio: Number.isFinite(Number(position.ratio)) ? Math.max(0, Math.min(1, Number(position.ratio))) : 0,
    },
    enteredAt: String(value?.enteredAt || now),
    updatedAt: String(value?.updatedAt || now),
    visits: Math.max(0, Math.floor(Number(value?.visits || 0))),
  }
}

async function ensureLibraryHistoryIndex() {
  if (libraryHistoryIndex) return libraryHistoryIndex
  try {
    const records = JSON.parse(await readFile(LIBRARY_HISTORY_INDEX, 'utf8'))
    libraryHistoryIndex = Array.isArray(records) ? records.map(normalizeLibraryHistory) : []
  } catch {
    libraryHistoryIndex = []
  }
  return libraryHistoryIndex
}

async function readLibraryHistory(type, itemId) {
  const key = libraryHistoryKey(type, itemId)
  if (libraryHistoryCache.has(key)) return libraryHistoryCache.get(key)
  try {
    const record = normalizeLibraryHistory(JSON.parse(await readFile(libraryHistoryPath(type, itemId), 'utf8')))
    libraryHistoryCache.set(key, record)
    return record
  } catch {
    return null
  }
}

async function listLibraryHistory({ type = 'all', limit = 100, keyword = '' } = {}) {
  const index = await ensureLibraryHistoryIndex()
  const normalizedType = String(type || 'all')
  const normalizedKeyword = String(keyword || '').trim().toLowerCase()
  const max = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 100)))
  return index
    .filter((record) => normalizedType === 'all' || record.type === normalizedType)
    .filter((record) => {
      if (!normalizedKeyword) return true
      return [
        record.title,
        record.itemId,
        record.lastUnitTitle,
        record.lastSectionTitle,
        ...(record.tags || []),
      ].join('\n').toLowerCase().includes(normalizedKeyword)
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, max)
}

function updateLibraryHistoryIndex(record) {
  const next = normalizeLibraryHistory(record)
  const key = libraryHistoryKey(next.type, next.itemId)
  const index = libraryHistoryIndex || []
  const filtered = index.filter((item) => libraryHistoryKey(item.type, item.itemId) !== key)
  filtered.unshift(next)
  libraryHistoryIndex = filtered
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 1000)
  scheduleLibraryHistoryIndexFlush()
}

function scheduleLibraryHistoryIndexFlush(delay = 3000) {
  if (libraryHistoryIndexTimer) clearTimeout(libraryHistoryIndexTimer)
  libraryHistoryIndexTimer = setTimeout(() => {
    flushLibraryHistoryIndex().catch(() => {})
  }, delay)
}

async function flushLibraryHistoryIndex() {
  if (!libraryHistoryIndex) return
  if (libraryHistoryIndexTimer) {
    clearTimeout(libraryHistoryIndexTimer)
    libraryHistoryIndexTimer = null
  }
  await atomicWriteJson(LIBRARY_HISTORY_INDEX, libraryHistoryIndex, { jobId: 'library-history-index' })
}

function scheduleLibraryHistoryFlush(type, itemId, delay = 3000) {
  const key = libraryHistoryKey(type, itemId)
  if (libraryHistoryTimers.has(key)) clearTimeout(libraryHistoryTimers.get(key))
  libraryHistoryTimers.set(key, setTimeout(() => {
    libraryHistoryTimers.delete(key)
    flushLibraryHistory(type, itemId).catch(() => {})
  }, delay))
}

async function flushLibraryHistory(type, itemId) {
  const key = libraryHistoryKey(type, itemId)
  if (libraryHistoryTimers.has(key)) {
    clearTimeout(libraryHistoryTimers.get(key))
    libraryHistoryTimers.delete(key)
  }
  const record = libraryHistoryCache.get(key)
  if (!record || !libraryHistoryDirty.has(key)) return record || null
  await atomicWriteJson(libraryHistoryPath(type, itemId), record, { jobId: `library-history-${type}-${itemId}` })
  libraryHistoryDirty.delete(key)
  updateLibraryHistoryIndex(record)
  await flushLibraryHistoryIndex()
  return record
}

async function recordLibraryHistory(type, itemId, patch, { flush = false } = {}) {
  const now = new Date().toISOString()
  const current = await readLibraryHistory(type, itemId)
  const merged = normalizeLibraryHistory({
    ...(current || {}),
    ...patch,
    type,
    itemId,
    position: {
      ...(current?.position || {}),
      ...(patch?.position || {}),
    },
    enteredAt: current?.enteredAt || patch?.enteredAt || now,
    updatedAt: patch?.updatedAt || now,
    visits: Math.max(1, Number(current?.visits || 0) + (patch?.visit === false ? 0 : 1)),
  })
  const key = libraryHistoryKey(type, itemId)
  libraryHistoryCache.set(key, merged)
  libraryHistoryDirty.add(key)
  updateLibraryHistoryIndex(merged)
  if (flush) await flushLibraryHistory(type, itemId)
  else scheduleLibraryHistoryFlush(type, itemId)
  return merged
}

async function deleteLibraryHistory(type, itemId) {
  const key = libraryHistoryKey(type, itemId)
  if (libraryHistoryTimers.has(key)) {
    clearTimeout(libraryHistoryTimers.get(key))
    libraryHistoryTimers.delete(key)
  }
  libraryHistoryCache.delete(key)
  libraryHistoryDirty.delete(key)
  await rm(libraryHistoryPath(type, itemId), { force: true })
  await ensureLibraryHistoryIndex()
  libraryHistoryIndex = libraryHistoryIndex.filter((item) => libraryHistoryKey(item.type, item.itemId) !== key)
  await flushLibraryHistoryIndex()
}

async function clearLibraryHistory(type = 'all') {
  await ensureLibraryHistoryIndex()
  const records = type === 'all' ? libraryHistoryIndex : libraryHistoryIndex.filter((item) => item.type === type)
  for (const record of records) {
    await deleteLibraryHistory(record.type, record.itemId)
  }
}

function normalizeTagScriptManifest(manifest, dirName) {
  const id = safeScriptId(manifest?.id || dirName)
  const defaultOptions = manifest?.options && typeof manifest.options === 'object' ? manifest.options : {}
  return {
    id,
    name: String(manifest?.name || id),
    version: String(manifest?.version || '0.0.0'),
    description: String(manifest?.description || ''),
    scope: Array.isArray(manifest?.scope) ? manifest.scope.map(String) : ['item', 'unit'],
    libraryTypes: Array.isArray(manifest?.libraryTypes) ? manifest.libraryTypes.map(String) : [],
    mediaKinds: Array.isArray(manifest?.mediaKinds) ? manifest.mediaKinds.map(String) : [],
    exclusiveTagGroups: parseTags(manifest?.exclusiveTagGroups || manifest?.exclusiveGroups || []),
    defaultOptions,
    userOptions: {},
    options: defaultOptions,
    defaultEnabled: Boolean(manifest?.defaultEnabled),
    main: String(manifest?.main || 'main.js'),
    dirName,
  }
}

function safeScriptId(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'script'
}

async function scanTagScripts({ force = false } = {}) {
  if (tagScriptsCache && !force) return tagScriptsCache
  const scripts = []
  const seenIds = new Set()
  for (const rootDir of tagScriptRoots()) {
    if (rootDir.writable) await mkdir(rootDir.dir, { recursive: true }).catch(() => {})
    const entries = await readdir(rootDir.dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(rootDir.dir, entry.name)
      let scriptId = safeScriptId(entry.name)
      try {
        const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
        const script = normalizeTagScriptManifest(manifest, entry.name)
        scriptId = script.id
        if (scriptId === 'subtitle-v1') {
          seenIds.add(scriptId)
          continue
        }
        if (seenIds.has(scriptId)) continue
        const userOptions = await readTagScriptOptions(script.id)
        script.userOptions = userOptions
        script.options = mergePlainObject(script.defaultOptions, userOptions)
        const mainPath = path.resolve(dir, script.main)
        const root = path.resolve(dir)
        if (!mainPath.startsWith(`${root}${path.sep}`) && mainPath !== root) throw new Error('main path escapes script dir')
        script.mainPath = mainPath
        script.source = rootDir.label
        scripts.push(script)
      } catch (error) {
        if (seenIds.has(scriptId)) continue
        scripts.push({
          id: scriptId,
          name: entry.name,
          version: 'invalid',
          description: `加载失败：${error.message}`,
          scope: [],
          libraryTypes: [],
          mediaKinds: [],
          exclusiveTagGroups: [],
          defaultOptions: {},
          userOptions: {},
          options: {},
          defaultEnabled: false,
          dirName: entry.name,
          source: rootDir.label,
          error: error.message,
        })
      }
      seenIds.add(scriptId)
    }
  }
  tagScriptsCache = scripts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return tagScriptsCache
}

async function scanMetadataActions({ force = false } = {}) {
  const scripts = await scanTagScripts({ force })
  return [
    ...builtinMetadataActions(),
    ...scripts.map((script) => ({
      ...script,
      actionType: 'script',
      capabilities: script.capabilities?.length ? script.capabilities : ['tags'],
    })),
  ]
}

function builtinMetadataActions() {
  return [
    {
      id: 'builtin-scan-media-units',
      name: '媒体目录扫描',
      version: '1.0.0',
      description: '扫描托管目录并刷新章节列表、字幕匹配和媒体基础元数据。',
      scope: ['item'],
      libraryTypes: ['media'],
      mediaKinds: [],
      exclusiveTagGroups: [],
      defaultOptions: {},
      userOptions: {},
      options: {},
      defaultEnabled: false,
      actionType: 'builtin',
      capabilities: ['metadata', 'units'],
    },
    {
      id: 'builtin-subtitles',
      name: '字幕扫描',
      version: '1.0.0',
      description: '扫描媒体文件附近的字幕并写入章节元数据，同时刷新字幕 tag。',
      scope: ['item', 'unit'],
      libraryTypes: ['media'],
      mediaKinds: ['audio', 'video'],
      exclusiveTagGroups: ['字幕v1'],
      defaultOptions: {},
      userOptions: {},
      options: {},
      defaultEnabled: false,
      actionType: 'builtin',
      capabilities: ['subtitles', 'tags'],
    },
    {
      id: 'builtin-thumbnails',
      name: '缩略图生成',
      version: '1.0.1',
      description: '为音视频章节生成封面和预览缩略图，并标记 DL 封面刷新状态。',
      scope: ['item', 'unit'],
      libraryTypes: ['media'],
      mediaKinds: ['audio', 'video'],
      exclusiveTagGroups: ['DL封面'],
      defaultOptions: {},
      userOptions: {},
      options: {},
      defaultEnabled: false,
      actionType: 'builtin',
      capabilities: ['thumbnail'],
    },
  ]
}

function tagScriptRoots() {
  return [{ dir: path.resolve(TAG_SCRIPTS_DIR), label: 'runtime', writable: true }]
}

function tagScriptConfigPath(scriptId) {
  return path.join(TAG_SCRIPT_CONFIG_DIR, `${safeScriptId(scriptId)}.json`)
}

async function readTagScriptOptions(scriptId) {
  try {
    const value = JSON.parse(await readFile(tagScriptConfigPath(scriptId), 'utf8'))
    return value?.options && typeof value.options === 'object' ? value.options : {}
  } catch {
    return {}
  }
}

async function saveTagScriptOptions(scriptId, options) {
  const id = safeScriptId(scriptId)
  await atomicWriteJson(tagScriptConfigPath(id), {
    scriptId: id,
    options: options && typeof options === 'object' ? options : {},
    updatedAt: new Date().toISOString(),
  }, { jobId: `tag-script-config-${id}` })
  tagScriptsCache = null
  return await scanTagScripts({ force: true })
}

async function deleteTagScriptOptions(scriptId) {
  await moveAside(tagScriptConfigPath(scriptId), 'metadata-action-config-reset').catch(() => {})
  tagScriptsCache = null
  return await scanTagScripts({ force: true })
}

async function installTagScriptPackage(file) {
  if (!file?.buffer?.length) throw new Error('脚本包不能为空')
  const filename = String(file.filename || '').toLowerCase()
  if (!/\.(tar\.gz|tgz|zip)$/.test(filename)) throw new Error('只支持 .tar.gz/.tgz/.zip 脚本包')
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'copymanga-tag-scripts-'))
  const archivePath = path.join(tempDir, safeSegment(file.filename || 'tag-scripts.tgz'))
  const extractDir = path.join(tempDir, 'extract')
  await mkdir(extractDir, { recursive: true })
  await writeFile(archivePath, file.buffer)
  try {
    if (/\.zip$/.test(filename)) {
      await execFileAsync('unzip', ['-q', archivePath, '-d', extractDir], { timeout: 60000 })
    } else {
      await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir], { timeout: 60000 })
    }
    const scriptDirs = await findExtractedTagScriptDirs(extractDir)
    if (!scriptDirs.length) throw new Error('脚本包里没有找到 manifest.json')
    await mkdir(TAG_SCRIPTS_DIR, { recursive: true })
    const installed = []
    for (const sourceDir of scriptDirs) {
      const manifest = JSON.parse(await readFile(path.join(sourceDir, 'manifest.json'), 'utf8'))
      const script = normalizeTagScriptManifest(manifest, path.basename(sourceDir))
      const mainPath = path.resolve(sourceDir, script.main)
      const root = path.resolve(sourceDir)
      if (!mainPath.startsWith(`${root}${path.sep}`) && mainPath !== root) throw new Error(`${script.id}: main path escapes script dir`)
      if (!await pathExists(mainPath)) throw new Error(`${script.id}: main.js 不存在`)
      const target = path.join(TAG_SCRIPTS_DIR, safeScriptId(script.id))
      if (await pathExists(target)) await moveAside(target, 'tag-script-replace')
      await renameOrMove(sourceDir, target)
      installed.push({ id: script.id, name: script.name, version: script.version })
    }
    tagScriptsCache = null
    return { installed, scripts: await scanTagScripts({ force: true }) }
  } finally {
    await moveAside(tempDir, 'metadata-action-upload-temp').catch(() => {})
  }
}

async function findExtractedTagScriptDirs(rootDir) {
  const found = []
  async function visit(dir, depth = 0) {
    if (depth > 3) return
    if (await pathExists(path.join(dir, 'manifest.json'))) {
      found.push(dir)
      return
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('__MACOSX')) continue
      await visit(path.join(dir, entry.name), depth + 1)
    }
  }
  await visit(rootDir)
  const resolvedRoot = path.resolve(rootDir)
  return found
    .map((dir) => path.resolve(dir))
    .filter((dir) => dir === resolvedRoot || dir.startsWith(`${resolvedRoot}${path.sep}`))
}

async function renameOrMove(sourcePath, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true })
  try {
    await rename(sourcePath, targetPath)
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    await execFileAsync('mv', [sourcePath, targetPath])
  }
}

function mergePlainObject(base = {}, override = {}) {
  return {
    ...(base && typeof base === 'object' ? base : {}),
    ...(override && typeof override === 'object' ? override : {}),
  }
}

function publicTagJob(job) {
  return {
    id: job.id,
    type: job.type,
    itemId: job.itemId,
    scriptIds: job.scriptIds,
    actionIds: job.scriptIds,
    unitIds: job.unitIds || [],
    force: Boolean(job.force),
    status: job.status,
    message: job.message,
    results: job.results || [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

function publicTagJobSummary(job) {
  return {
    ...publicTagJob(job),
    results: (job.results || []).map((result) => ({
      scriptId: result.scriptId,
      actionId: result.actionId,
      scriptVersion: result.scriptVersion,
      status: result.status,
      message: result.message,
      itemTagCount: result.itemTagCount,
      unitTagCount: result.unitTagCount,
      thumbnailJobs: result.thumbnailJobs,
      error: result.error,
      hasDetails: Boolean(
        result.details ||
        result.result ||
        result.logs?.length ||
        result.itemTags?.length ||
        result.unitTags?.length ||
        result.unitPatches?.length ||
        result.unitPatchCount
      ),
    })),
  }
}

function paginatedResponse(items, { page, limit, total }) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 200))
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0))
  const safePage = Math.max(1, Math.floor(Number(page) || 1))
  return {
    items,
    page: safePage,
    limit: safeLimit,
    total: safeTotal,
    totalPages: Math.max(1, Math.ceil(safeTotal / safeLimit)),
  }
}

function paginationFromSearchParams(params, defaultLimit = 200, maxLimit = 1000) {
  const hasPagination = params.has('page') || params.has('limit') || params.has('offset') || params.has('keyword')
  if (!hasPagination) return null
  const limit = Math.max(1, Math.min(maxLimit, Math.floor(Number(params.get('limit') || defaultLimit) || defaultLimit)))
  const page = Math.max(1, Math.floor(Number(params.get('page') || 1) || 1))
  const explicitOffset = params.has('offset') ? Math.max(0, Math.floor(Number(params.get('offset') || 0) || 0)) : null
  const offset = explicitOffset ?? ((page - 1) * limit)
  return { page: Math.floor(offset / limit) + 1, limit, offset, keyword: params.get('keyword') || '' }
}

function importTagScriptIds(fields = {}) {
  const profile = String(fields.importProfile || fields.mediaImportProfile || '').trim()
  if (profile === 'rj-media') {
    return parseTags(config.mediaImportProfiles?.['rj-media']?.defaultMetadataActions || ['builtin-scan-media-units', 'builtin-subtitles', 'rj-dlsite-v1', 'builtin-thumbnails'])
  }
  return parseTags(fields.metadataActionIds || fields.actionIds || fields.tagScriptIds || fields.tagScripts || '')
}

function updateTagJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() })
  emit('tagJob', publicTagJob(job))
}

function enqueueMetadataActions({ type, itemId, actionIds = [], unitIds = [], reason = 'manual', force = false }) {
  const ids = [...new Set((actionIds || []).map((id) => safeScriptId(id)).filter(Boolean))]
  const selectedUnitIds = [...new Set((unitIds || []).map((id) => String(id || '').trim()).filter(Boolean))]
  if (!type || !itemId || !ids.length) return null
  const now = new Date().toISOString()
  const id = `metadata-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const job = {
    id,
    type,
    itemId,
    scriptIds: ids,
    unitIds: selectedUnitIds,
    reason,
    force: Boolean(force),
    status: 'queued',
    message: '等待执行元数据脚本',
    results: [],
    createdAt: now,
    updatedAt: now,
  }
  tagJobs.set(id, job)
  tagQueue.push(id)
  emit('tagJob', publicTagJob(job))
  scheduleTagWorker()
  return job
}

function enqueueLibraryIndexRefreshTrigger({ reason = 'import', delaySeconds = 3 } = {}) {
  const existingId = tagQueue.find((id) => {
    const queued = tagJobs.get(id)
    return queued?.type === 'library-index-refresh' && queued.status === 'queued'
  })
  if (existingId) return tagJobs.get(existingId)
  const now = new Date().toISOString()
  const id = `metadata-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const job = {
    id,
    type: 'library-index-refresh',
    itemId: '__library_index__',
    scriptIds: ['library-index-refresh'],
    unitIds: [],
    reason,
    force: false,
    delaySeconds: Math.max(0, Number(delaySeconds) || 0),
    status: 'queued',
    message: '等待触发媒体缓存刷新',
    results: [],
    createdAt: now,
    updatedAt: now,
  }
  tagJobs.set(id, job)
  tagQueue.push(id)
  emit('tagJob', publicTagJob(job))
  scheduleTagWorker()
  return job
}

function scheduleTagWorker() {
  if (tagWorkerTimer) return
  tagWorkerTimer = setImmediate(processTagQueue)
}

async function processTagQueue() {
  tagWorkerTimer = null
  if (runningTagJobIds.size > 0) return
  const id = tagQueue.shift()
  if (!id) return
  const job = tagJobs.get(id)
  if (!job || job.status !== 'queued') return scheduleTagWorker()
  runningTagJobIds.add(id)
  try {
    await runTagJob(job)
  } finally {
    runningTagJobIds.delete(id)
    if (tagQueue.length) scheduleTagWorker()
  }
}

async function runTagJob(job) {
  if (job.type === 'library-index-refresh') {
    updateTagJob(job, { status: 'running', message: '等待媒体脚本任务完成后触发缓存刷新' })
    if (job.delaySeconds) await sleep(job.delaySeconds)
    const status = startLibraryIndexRebuild()
    updateTagJob(job, {
      status: 'completed',
      message: '已触发媒体缓存刷新',
      results: [{
        scriptId: 'library-index-refresh',
        actionId: 'library-index-refresh',
        status: 'completed',
        message: `缓存状态：${status.status}`,
      }],
    })
    return
  }
  updateTagJob(job, { status: 'running', message: '执行元数据脚本中' })
  const actions = await scanMetadataActions()
  const byId = new Map(actions.filter((action) => !action.error).map((action) => [action.id, action]))
  const handler = libraryHandler(job.type)
  const results = []
  for (const scriptId of job.scriptIds) {
    const item = await handler.getItem(job.itemId)
    const units = handler.listUnits ? await handler.listUnits(job.itemId) : (item.mediaUnits || [])
    const action = byId.get(scriptId)
    if (!action) {
      results.push({ scriptId, actionId: scriptId, status: 'failed', message: '脚本不存在或加载失败' })
      continue
    }
    try {
      if (action.actionType === 'builtin') {
        updateTagJob(job, { message: `运行 ${action.name}` })
        const applied = await executeBuiltinMetadataAction({ action, handler, type: job.type, itemId: job.itemId, unitIds: job.unitIds || [], force: job.force })
        results.push({ scriptId, actionId: action.id, scriptVersion: action.version, status: 'completed', ...applied })
        continue
      }
      const previous = await readTagRun(job.type, job.itemId, action.id)
      if (!job.force && !(job.unitIds || []).length && isCompletedSameVersionRun(previous, action, item, units)) {
        results.push({
          scriptId,
          actionId: action.id,
          scriptVersion: action.version,
          status: 'skipped',
          message: '同版本已生成，跳过',
        })
        continue
      }
      updateTagJob(job, { message: `运行 ${action.name}` })
      const selectedUnits = (job.unitIds || []).length
        ? units.filter((unit) => job.unitIds.includes(unit.unitId))
        : units
      const output = await executeTagScript(action, { type: job.type, item, units: selectedUnits, selectedUnitIds: job.unitIds || [] })
      const applied = await applyTagScriptOutput({ type: job.type, itemId: job.itemId, script: action, output, unitIds: job.unitIds || [] })
      results.push({ scriptId, actionId: action.id, scriptVersion: action.version, status: 'completed', ...applied })
    } catch (error) {
      results.push({ scriptId, actionId: scriptId, scriptVersion: action?.version || '', status: 'failed', message: error.message })
    }
  }
  const failed = results.filter((item) => item.status === 'failed').length
  updateTagJob(job, {
    status: failed ? 'failed' : 'completed',
    message: failed ? `元数据脚本执行完成，失败 ${failed} 个` : '元数据脚本执行完成',
    results,
  })
  markLibraryIndexDirty()
}

async function executeBuiltinMetadataAction({ action, handler, type, itemId, unitIds = [], force = false }) {
  if (action.id === 'builtin-scan-media-units') {
    if (!handler.rescanMediaUnits) throw new Error('当前媒体类型不支持目录扫描')
    if (unitIds.length) throw new Error('目录扫描只支持合集级执行')
    const result = await handler.rescanMediaUnits(itemId)
    const updated = await handler.getItem(itemId)
    await syncItemTagIndex(updated)
    return { message: `已扫描目录，章节 ${result.unitCount || 0} 个`, result }
  }
  if (action.id === 'builtin-subtitles') {
    if (!handler.rescanSubtitles) throw new Error('当前媒体类型不支持字幕扫描')
    const result = await handler.rescanSubtitles(itemId)
    const playable = (result.units || []).filter((unit) => unit.mediaKind === 'audio' || unit.mediaKind === 'video')
    const matched = playable.filter((unit) => Array.isArray(unit.subtitles) && unit.subtitles.length > 0)
    const unmatched = (result.units || []).filter((unit) => unit.mediaKind === 'subtitle')
    const output = {
      itemTags: [`字幕v1: ${matched.length || unmatched.length ? '有' : '无'}`],
      unitTags: (result.units || []).map((unit) => ({
        unitId: unit.unitId,
        tags: [`字幕v1: ${unit.mediaKind === 'subtitle' ? '未匹配' : Array.isArray(unit.subtitles) && unit.subtitles.length ? '有' : '无'}`],
      })),
    }
    const applied = await applyTagScriptOutput({ type, itemId, script: action, output, unitIds })
    return { message: unitIds.length ? `已扫描字幕并更新 ${unitIds.length} 个章节 tag` : '已扫描字幕并更新 tag', result, ...applied }
  }
  if (action.id === 'builtin-thumbnails') {
    if (unitIds.length) {
      if (!handler.enqueueThumbnail) throw new Error('当前媒体类型不支持单章节缩略图')
      const jobs = []
      for (const unitId of unitIds) jobs.push(await handler.enqueueThumbnail(itemId, unitId, { force }))
      return { message: `已提交缩略图任务 ${jobs.length} 个`, thumbnailJobs: jobs.length }
    }
    if (!handler.enqueueThumbnails) throw new Error('当前媒体类型不支持批量缩略图')
    return await enqueueThumbnailsWithCoverTag({ action, handler, type, itemId, force })
  }
  throw new Error(`未知内置元数据脚本：${action.id}`)
}

async function enqueueThumbnailsWithCoverTag({ action, handler, type, itemId, force = false }) {
  const result = await handler.enqueueThumbnails(itemId, { force })
  const coverTag = dlCoverTagFromExternalCover(result.externalCover)
  const applied = coverTag
    ? await applyTagScriptOutput({
        type,
        itemId,
        script: action,
        output: {
          itemTags: [coverTag],
          logs: dlCoverLogs(result.externalCover),
        },
      })
    : {}
  return {
    message: coverTag ? `已提交批量缩略图任务，${coverTag}` : '已提交批量缩略图任务',
    result,
    ...applied,
  }
}

function dlCoverLogs(externalCover = {}) {
  return [
    `DL 封面状态: ${externalCover?.status || 'unknown'}`,
    externalCover?.productId ? `DL 编号: ${externalCover.productId}` : '',
    externalCover?.site ? `DL 站点: ${externalCover.site}` : '',
    externalCover?.cover ? `DL 封面: ${externalCover.cover}` : '',
    externalCover?.message ? `DL 信息: ${externalCover.message}` : '',
    externalCover?.error ? `DL 错误: ${externalCover.error}` : '',
  ].filter(Boolean)
}

function dlCoverTagFromExternalCover(externalCover = {}) {
  const status = String(externalCover?.status || '').toLowerCase()
  const message = String(externalCover?.message || '')
  if (status === 'completed') return 'DL封面: 成功'
  if (status === 'not_found') return 'DL封面: 无'
  if (status === 'failed' || status === 'fetch_failed') return 'DL封面: 失败'
  if (status === 'skipped' && /不是 RJ/.test(message)) return 'DL封面: 非RJ'
  if (status === 'skipped') return 'DL封面: 跳过'
  if (status) return `DL封面: ${status}`
  return ''
}

function isCompletedSameVersionRun(previous, script, item, units = []) {
  if (!(previous?.status === 'completed' &&
    previous.scriptId === script.id &&
    previous.scriptVersion === script.version)) return false
  return previousGeneratedTagsExist(previous, item, units)
}

function previousGeneratedTagsExist(previous, item, units = []) {
  const itemTags = new Set((item?.tags || []).map(normalizeTagName))
  const previousItemTags = previous?.itemTags || []
  const previousUnitTags = previous?.unitTags || []
  if (!previousItemTags.length && !previousUnitTags.length) return false
  if (!previousItemTags.every((tag) => itemTags.has(normalizeTagName(tag)))) return false
  const unitsById = new Map((units || []).map((unit) => [unit.unitId, unit]))
  for (const entry of previousUnitTags) {
    const unitTags = new Set((unitsById.get(entry.unitId)?.tags || []).map(normalizeTagName))
    if (!(entry.tags || []).every((tag) => unitTags.has(normalizeTagName(tag)))) return false
  }
  return true
}

async function executeTagScript(script, { type, item, units, selectedUnitIds = [] }) {
  const info = await stat(script.mainPath)
  const mod = await import(`${pathToFileURL(script.mainPath).href}?v=${encodeURIComponent(`${info.mtimeMs}-${script.version}`)}`)
  if (typeof mod.generateTags !== 'function') throw new Error('main.js 必须 export async function generateTags(ctx)')
  const ctx = {
    type,
    item,
    units,
    selectedUnitIds,
    scope: selectedUnitIds.length ? 'units' : 'item',
    filesRoot: item?.mediaUnits?.[0]?.managedPath ? path.dirname(item.mediaUnits[0].managedPath) : '',
    cacheDir: path.join(DATA_DIR, 'cache', 'library', 'tag-script-cache', safeSegment(script.id)),
    script: {
      id: script.id,
      name: script.name,
      version: script.version,
      options: script.options || {},
    },
    config,
  }
  const timeoutMs = Number.isFinite(Number(script.options?.scriptTimeoutMs)) ? Number(script.options.scriptTimeoutMs) : 60000
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('脚本超时')), timeoutMs))
  return await Promise.race([Promise.resolve(mod.generateTags(ctx)), timeout])
}

function tagRunPath(type, itemId, scriptId) {
  return path.join(TAG_SCRIPT_RUN_DIR, safeSegment(type), safeSegment(itemId), `${safeSegment(scriptId)}.json`)
}

function tagOverridePath(type, itemId) {
  return path.join(TAG_OVERRIDE_DIR, safeSegment(type), `${safeSegment(itemId)}.json`)
}

async function readTagRun(type, itemId, scriptId) {
  try {
    return JSON.parse(await readFile(tagRunPath(type, itemId, scriptId), 'utf8'))
  } catch {
    return null
  }
}

async function readAllTagRuns(type, itemId) {
  const dir = path.dirname(tagRunPath(type, itemId, 'placeholder'))
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const runs = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      runs.push(JSON.parse(await readFile(path.join(dir, entry.name), 'utf8')))
    } catch {
      // Ignore corrupt historical script-run records; the next run will rewrite its own record.
    }
  }
  return runs
}

async function readTagOverrides(type, itemId) {
  try {
    return normalizeTagOverrides(JSON.parse(await readFile(tagOverridePath(type, itemId), 'utf8')))
  } catch {
    return normalizeTagOverrides(null)
  }
}

function normalizeTagOverrides(value) {
  const units = {}
  for (const [unitId, tags] of Object.entries(value?.units || {})) {
    units[unitId] = normalizeOverrideMap(tags)
  }
  return {
    item: normalizeOverrideMap(value?.item || {}),
    units,
    updatedAt: String(value?.updatedAt || ''),
  }
}

function normalizeOverrideMap(value) {
  const result = {}
  for (const [group, tag] of Object.entries(value || {})) {
    const normalizedGroup = normalizeTagName(group)
    const normalizedTag = parseTags([tag])[0]
    if (normalizedGroup && normalizedTag) result[normalizedGroup] = normalizedTag
  }
  return result
}

async function writeTagOverrides(type, itemId, overrides) {
  await atomicWriteJson(tagOverridePath(type, itemId), {
    item: overrides.item || {},
    units: overrides.units || {},
    updatedAt: new Date().toISOString(),
  }, { jobId: `tag-overrides-${type}-${itemId}` })
}

async function saveManualTagOverrides({ type, itemId, unitId = '', tags, exclusiveGroups }) {
  const groups = exclusiveGroups instanceof Set ? exclusiveGroups : new Set()
  const normalizedTags = canonicalizeExclusiveTags(tags || [], groups)
  if (!groups.size) return normalizedTags
  const overrides = await readTagOverrides(type, itemId)
  const groupTags = tagsByExclusiveGroup(normalizedTags, groups)
  if (unitId) {
    const unitOverrides = { ...(overrides.units[unitId] || {}) }
    for (const group of groups) {
      if (groupTags[group]) unitOverrides[group] = groupTags[group]
      else delete unitOverrides[group]
    }
    if (Object.keys(unitOverrides).length) overrides.units[unitId] = unitOverrides
    else delete overrides.units[unitId]
  } else {
    for (const group of groups) {
      if (groupTags[group]) overrides.item[group] = groupTags[group]
      else delete overrides.item[group]
    }
  }
  await writeTagOverrides(type, itemId, overrides)
  return normalizedTags
}

function normalizeScriptTags(values) {
  if (!Array.isArray(values)) return []
  return parseTags(values.map((item) => typeof item === 'string' ? item : item?.tag).filter(Boolean))
}

function normalizeTagScriptOutput(output) {
  return {
    itemTags: normalizeScriptTags(output?.itemTags || output?.item || []),
    unitTags: Array.isArray(output?.unitTags || output?.units)
      ? (output.unitTags || output.units).map((entry) => ({
        unitId: String(entry?.unitId || ''),
        tags: normalizeScriptTags(entry?.tags || []),
      })).filter((entry) => entry.unitId && entry.tags.length)
      : [],
    unitPatches: normalizeScriptUnitPatches(output?.unitPatches || output?.unitPatch || []),
    logs: normalizeScriptLogs(output?.logs || output?.log || output?.messages || []),
    details: normalizeScriptDetails(output?.details || output?.detail || null),
    itemPatch: normalizeScriptItemPatch(output?.itemPatch || output?.metadataPatch || null),
  }
}

function normalizeScriptUnitPatches(values) {
  const list = Array.isArray(values) ? values : (values ? [values] : [])
  return list.map((entry) => {
    const patch = {}
    if (Array.isArray(entry?.subtitles)) {
      patch.subtitles = entry.subtitles.map(normalizeScriptSubtitle).filter((subtitle) => subtitle.relativePath)
    }
    return {
      unitId: String(entry?.unitId || ''),
      patch,
    }
  }).filter((entry) => entry.unitId && Object.keys(entry.patch).length)
}

function normalizeScriptSubtitle(value = {}) {
  return {
    title: String(value.title || value.relativePath || '字幕').slice(0, 500),
    relativePath: String(value.relativePath || '').replace(/^[/\\]+/, '').slice(0, 2000),
    language: String(value.language || '').slice(0, 50),
    url: '',
    contentType: String(value.contentType || 'text/vtt').slice(0, 100),
  }
}

function normalizeScriptItemPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const patch = {}
  const publishedAt = normalizeIsoDateTime(value.publishedAt)
  if (publishedAt) patch.publishedAt = publishedAt
  if (value.dlsite && typeof value.dlsite === 'object' && !Array.isArray(value.dlsite)) {
    const dlsite = {}
    for (const key of ['productId', 'originalProductId', 'status', 'site', 'originalSite', 'title', 'circle', 'cover', 'releaseDate', 'error', 'fetchedAt']) {
      if (value.dlsite[key] !== undefined) dlsite[key] = String(value.dlsite[key] || '').slice(0, 2000)
    }
    if (value.dlsite.translation && typeof value.dlsite.translation === 'object' && !Array.isArray(value.dlsite.translation)) {
      dlsite.translation = {}
      for (const key of ['productId', 'site', 'title', 'circle', 'cover', 'releaseDate']) {
        if (value.dlsite.translation[key] !== undefined) dlsite.translation[key] = String(value.dlsite.translation[key] || '').slice(0, 2000)
      }
      if (!Object.keys(dlsite.translation).length) delete dlsite.translation
    }
    if (Object.keys(dlsite).length) patch.dlsite = dlsite
  }
  return Object.keys(patch).length ? patch : null
}

function normalizeIsoDateTime(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''
}

function normalizeScriptLogs(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : [])
  return list
    .flatMap((entry) => String(entry || '').split(/\r?\n/))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 80)
    .map((entry) => entry.slice(0, 500))
}

function normalizeScriptDetails(value) {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 4000)
  try {
    const text = JSON.stringify(value)
    return text.length > 4000 ? `${text.slice(0, 4000)}...` : value
  } catch {
    return String(value).slice(0, 4000)
  }
}

async function applyTagScriptOutput({ type, itemId, script, output, unitIds = [] }) {
  const handler = libraryHandler(type)
  if (!handler.updateItemTags || !handler.updateUnitTags) throw new Error('当前媒体类型不支持 tag 更新')
  const previous = await readTagRun(type, itemId, script.id)
  const allRuns = await readAllTagRuns(type, itemId)
  const overrides = await readTagOverrides(type, itemId)
  const next = normalizeTagScriptOutput(output)
  const selectedUnitIds = new Set(unitIds || [])
  if (selectedUnitIds.size) {
    next.unitTags = next.unitTags.filter((entry) => selectedUnitIds.has(entry.unitId))
    next.unitPatches = next.unitPatches.filter((entry) => selectedUnitIds.has(entry.unitId))
    next.itemTags = []
  }
  const exclusiveGroups = scriptExclusiveGroups(script)
  const item = await handler.getItem(itemId)
  const previousItemTags = previous?.itemTags || []
  let updatedItem = item
  if (!selectedUnitIds.size) {
    const generatedItemTags = allRuns.flatMap((run) => run?.itemTags || [])
    const mergedItemTags = mergeGeneratedTags(item.tags || [], previousItemTags, next.itemTags, exclusiveGroups, {
      generatedTags: generatedItemTags,
      manualOverrides: overrides.item,
    })
    updatedItem = await handler.updateItemTags(itemId, mergedItemTags)
    await setItemTags({ type, itemId, tags: updatedItem.tags || [] })
    if (next.itemPatch) {
      if (!handler.patchItemMetadata) throw new Error('当前媒体类型不支持元数据更新')
      updatedItem = await handler.patchItemMetadata(itemId, next.itemPatch)
    }
  }
  const appliedUnitTags = []
  const appliedUnitPatches = []
  if (next.unitPatches.length) {
    if (!handler.patchUnitMetadata) throw new Error('当前媒体类型不支持章节元数据更新')
    for (const entry of next.unitPatches) {
      await handler.patchUnitMetadata(itemId, entry.unitId, entry.patch)
      appliedUnitPatches.push(entry)
    }
  }
  const units = handler.listUnits ? await handler.listUnits(itemId) : (updatedItem.mediaUnits || [])
  const byUnit = new Map(units.map((unit) => [unit.unitId, unit]))
  const previousByUnit = new Map((previous?.unitTags || []).map((entry) => [entry.unitId, entry.tags || []]))
  const touched = selectedUnitIds.size
    ? new Set([...selectedUnitIds])
    : new Set([...next.unitTags.map((entry) => entry.unitId), ...previousByUnit.keys()])
  for (const unitId of touched) {
    const unit = byUnit.get(unitId)
    if (!unit) continue
    const nextEntry = next.unitTags.find((entry) => entry.unitId === unitId)
    const generatedUnitTags = allRuns.flatMap((run) => (
      run?.unitTags || []
    ).filter((entry) => entry?.unitId === unitId).flatMap((entry) => entry.tags || []))
    const merged = mergeGeneratedTags(unit.tags || [], previousByUnit.get(unitId) || [], nextEntry?.tags || [], exclusiveGroups, {
      generatedTags: generatedUnitTags,
      manualOverrides: overrides.units?.[unitId] || {},
    })
    const updatedUnit = await handler.updateUnitTags(itemId, unitId, merged)
    await setUnitTags({ type, itemId, unitId, tags: updatedUnit.tags || [] })
    appliedUnitTags.push({ unitId, tags: nextEntry?.tags || [] })
  }
  const runRecord = {
    status: 'completed',
    type,
    itemId,
    scriptId: script.id,
    scriptVersion: script.version,
    itemTags: selectedUnitIds.size ? previousItemTags : next.itemTags,
    itemPatch: selectedUnitIds.size ? previous?.itemPatch || null : next.itemPatch,
    unitPatches: selectedUnitIds.size
      ? [
        ...(previous?.unitPatches || []).filter((entry) => !selectedUnitIds.has(entry.unitId)),
        ...appliedUnitPatches,
      ]
      : appliedUnitPatches,
    unitTags: selectedUnitIds.size
      ? [
        ...(previous?.unitTags || []).filter((entry) => !selectedUnitIds.has(entry.unitId)),
        ...appliedUnitTags,
      ]
      : appliedUnitTags,
    updatedAt: new Date().toISOString(),
  }
  await atomicWriteJson(tagRunPath(type, itemId, script.id), runRecord, { jobId: `tag-run-${script.id}` })
  return {
    itemTagCount: next.itemTags.length,
    unitTagCount: appliedUnitTags.reduce((sum, entry) => sum + entry.tags.length, 0),
    metadataPatched: Boolean(!selectedUnitIds.size && next.itemPatch),
    unitPatchCount: appliedUnitPatches.length,
    logs: next.logs,
    details: next.details,
  }
}

function mergeGeneratedTags(currentTags, previousGenerated, nextGenerated, exclusiveGroups = new Set(), options = {}) {
  const previous = new Set((previousGenerated || []).map(normalizeTagName))
  const generated = new Set((options.generatedTags || []).map(normalizeTagName))
  const manualOverrides = normalizeOverrideMap(options.manualOverrides || {})
  const nextGroups = new Set(parseTags(nextGenerated || []).map((tag) => exclusiveTagGroup(tag, exclusiveGroups)).filter(Boolean))
  const kept = canonicalizeExclusiveTags(parseTags(currentTags).filter((tag) => {
    const normalized = normalizeTagName(tag)
    const group = exclusiveTagGroup(tag, exclusiveGroups)
    if (previous.has(normalized)) return false
    if (group && manualOverrides[group]) return false
    if (group && nextGroups.has(group) && generated.has(normalized)) return false
    return true
  }), exclusiveGroups)
  const keptGroups = new Set(kept.map((tag) => exclusiveTagGroup(tag, exclusiveGroups)).filter(Boolean))
  const allowedGenerated = []
  for (const tag of parseTags(nextGenerated || [])) {
    const group = exclusiveTagGroup(tag, exclusiveGroups)
    if (group && (manualOverrides[group] || keptGroups.has(group))) continue
    allowedGenerated.push(tag)
  }
  return canonicalizeExclusiveTags([...kept, ...allowedGenerated, ...Object.values(manualOverrides)], exclusiveGroups)
}

function scriptExclusiveGroups(script) {
  return new Set(parseTags(script?.exclusiveTagGroups || []).map(normalizeTagName))
}

async function knownExclusiveTagGroups() {
  const scripts = await scanMetadataActions()
  return new Set(scripts.flatMap((script) => script.exclusiveTagGroups || []).map(normalizeTagName))
}

function canonicalizeExclusiveTags(tags, exclusiveGroups = new Set()) {
  const result = []
  const indexByGroup = new Map()
  for (const tag of parseTags(tags)) {
    const group = exclusiveTagGroup(tag, exclusiveGroups)
    if (group && indexByGroup.has(group)) result[indexByGroup.get(group)] = null
    if (group) indexByGroup.set(group, result.length)
    result.push(tag)
  }
  return result.filter(Boolean)
}

function exclusiveTagGroup(tag, exclusiveGroups = new Set()) {
  if (!exclusiveGroups?.size) return ''
  const match = /^([^:：]+)\s*[:：]/.exec(String(tag || '').trim())
  const group = normalizeTagName(match?.[1] || '')
  return group && exclusiveGroups.has(group) ? group : ''
}

function tagsByExclusiveGroup(tags, exclusiveGroups = new Set()) {
  const result = {}
  for (const tag of canonicalizeExclusiveTags(tags || [], exclusiveGroups)) {
    const group = exclusiveTagGroup(tag, exclusiveGroups)
    if (group) result[group] = tag
  }
  return result
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
      res.writeHead(200, webHeaders({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      }))
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      res.write(`event: ready\ndata: {}\n\n`)
      return
    }
    if (pathname === '/api/jobs' && req.method === 'GET') return json(res, 200, publicJobs())
    if (pathname === '/api/image-check/status' && req.method === 'GET') return json(res, 200, latestImageCheckSummary())
    if (pathname === '/api/image-check/inventory' && req.method === 'POST') return json(res, 202, await enqueueInventoryImageChecks())
    if (pathname === '/api/image-check/chapter' && req.method === 'POST') {
      const body = await readJson(req)
      const job = enqueueImageCheck({
        comicPathWord: body.comicPathWord || '',
        chapterUuid: body.chapterUuid || '',
        chapterTitle: body.chapterTitle || '',
        reason: 'manual',
      })
      if (!job) return json(res, 400, { error: 'comicPathWord and chapterUuid are required' })
      return json(res, 202, { job: publicImageCheckJob(job) })
    }
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
      const pagination = paginationFromSearchParams(url.searchParams, 200, 1000)
      if (!pagination) return json(res, 200, listTags())
      const result = listTags(pagination)
      return json(res, 200, paginatedResponse(result.items, {
        page: pagination.page,
        limit: result.limit,
        total: result.total,
      }))
    }
    if ((pathname === '/api/metadata-actions' || pathname === '/api/tag-scripts') && req.method === 'GET') {
      const actions = await scanMetadataActions({ force: url.searchParams.get('reload') === '1' })
      const pagination = paginationFromSearchParams(url.searchParams, 200, 1000)
      if (!pagination) return json(res, 200, actions)
      const keyword = normalizeTagName(pagination.keyword)
      const filtered = keyword
        ? actions.filter((item) => [item.id, item.name, item.description, item.version].some((value) => normalizeTagName(value).includes(keyword)))
        : actions
      return json(res, 200, paginatedResponse(filtered.slice(pagination.offset, pagination.offset + pagination.limit), {
        page: pagination.page,
        limit: pagination.limit,
        total: filtered.length,
      }))
    }
    if ((pathname === '/api/metadata-actions/upload' || pathname === '/api/tag-scripts/upload') && req.method === 'POST') {
      const form = await readMultipart(req)
      const file = form.files.find((item) => item.name === 'file') || form.files[0]
      return json(res, 201, await installTagScriptPackage(file))
    }
    if ((pathname.startsWith('/api/metadata-actions/') || pathname.startsWith('/api/tag-scripts/')) && req.method === 'POST') {
      const [, , scriptId, action] = pathname.split('/').filter(Boolean)
      if (action !== 'config') return json(res, 404, { error: 'Not found' })
      const body = await readJson(req)
      return json(res, 200, await saveTagScriptOptions(scriptId, body.options || body))
    }
    if ((pathname.startsWith('/api/metadata-actions/') || pathname.startsWith('/api/tag-scripts/')) && req.method === 'DELETE') {
      const [, , scriptId, action] = pathname.split('/').filter(Boolean)
      if (action !== 'config') return json(res, 404, { error: 'Not found' })
      return json(res, 200, await deleteTagScriptOptions(scriptId))
    }
    if ((pathname === '/api/metadata-jobs' || pathname === '/api/tag-jobs') && req.method === 'GET') {
      const pagination = paginationFromSearchParams(url.searchParams, 200, 1000)
      const sorted = [...tagJobs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      if (!pagination) return json(res, 200, sorted.map(publicTagJob))
      const keyword = normalizeTagName(pagination.keyword)
      const filtered = keyword
        ? sorted.filter((job) => [
            job.id,
            job.type,
            job.itemId,
            job.status,
            job.message,
            ...(job.scriptIds || []),
          ].some((value) => normalizeTagName(value).includes(keyword)))
        : sorted
      return json(res, 200, paginatedResponse(filtered.slice(pagination.offset, pagination.offset + pagination.limit).map(publicTagJobSummary), {
        page: pagination.page,
        limit: pagination.limit,
        total: filtered.length,
      }))
    }
    if ((pathname.startsWith('/api/metadata-jobs/') || pathname.startsWith('/api/tag-jobs/')) && req.method === 'GET') {
      const parts = pathname.split('/').filter(Boolean)
      const job = tagJobs.get(parts[2])
      if (!job) return json(res, 404, { error: 'Job not found' })
      return json(res, 200, publicTagJob(job))
    }
    if (pathname === '/api/library/history' && req.method === 'GET') {
      return json(res, 200, await listLibraryHistory({
        type: url.searchParams.get('type') || 'all',
        limit: url.searchParams.get('limit') || 100,
        keyword: url.searchParams.get('keyword') || '',
      }))
    }
    if (pathname === '/api/library/history' && req.method === 'DELETE') {
      await clearLibraryHistory(url.searchParams.get('type') || 'all')
      return json(res, 200, { ok: true })
    }
    if (pathname === '/api/library/index/status' && req.method === 'GET') {
      return json(res, 200, libraryIndexPublicStatus())
    }
    if (pathname === '/api/library/index/rebuild' && req.method === 'POST') {
      return json(res, 202, startLibraryIndexRebuild())
    }
    if (pathname === '/api/library/items' && req.method === 'GET') {
      const hasPagedQuery = url.searchParams.has('page') || url.searchParams.has('limit') || url.searchParams.has('keyword') || url.searchParams.has('sort') || url.searchParams.has('sourceProfile') || url.searchParams.has('seriesSubtitle')
      if (hasPagedQuery) {
        const pagination = paginationFromSearchParams(url.searchParams, 50, 1000) || { page: 1, limit: 50, offset: 0, keyword: '' }
        return json(res, 200, searchLibraryIndex({
          type: url.searchParams.get('type') || 'all',
          tag: url.searchParams.get('tag') || '',
          keyword: pagination.keyword,
          sourceProfile: url.searchParams.get('sourceProfile') || '',
          seriesSubtitle: url.searchParams.get('seriesSubtitle') || 'any',
          page: pagination.page,
          limit: pagination.limit,
          sort: url.searchParams.get('sort') || 'imported_desc',
        }))
      }
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
      markLibraryIndexDirty()
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
      const items = Array.isArray(item?.items) ? item.items : [item]
      const actionIds = importTagScriptIds(form.fields)
      for (const imported of items) {
        await syncItemTagIndex(imported)
        if (handler.enqueueThumbnails && imported.sourceProfile !== 'rj-media') {
          handler.enqueueThumbnails(imported.itemId, { force: false }).catch(() => {})
        }
        if (actionIds.length) enqueueMetadataActions({ type, itemId: imported.itemId, actionIds, reason: 'import' })
      }
      markLibraryIndexDirty()
      if (items.length) enqueueLibraryIndexRefreshTrigger({ reason: 'import', delaySeconds: 3 })
      return json(res, 201, Array.isArray(item?.items) ? { ...item, items } : items[0])
    }
    if (pathname.startsWith('/api/library/items/') && req.method === 'GET') {
      const parts = pathname.split('/').filter(Boolean)
      const [, , , type, itemId, action, unitId] = parts
      const handler = libraryHandler(type)
      if (!itemId) return json(res, 400, { error: 'itemId is required' })
      if (!action) return json(res, 200, await handler.getItem(itemId))
      if (action === 'units') return json(res, 200, await handler.listUnits(itemId))
      if (action === 'history') return json(res, 200, await readLibraryHistory(type, itemId) || null)
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
      if (action === 'history') {
        const body = await readJson(req)
        return json(res, 200, await recordLibraryHistory(type, itemId, body, { flush: Boolean(body.flush) }))
      }
      if (action === 'history-flush') {
        const body = await readJson(req)
        return json(res, 200, await recordLibraryHistory(type, itemId, body, { flush: true }))
      }
      if (action === 'metadata-actions' || action === 'tag-scripts') {
        const body = await readJson(req)
        const job = enqueueMetadataActions({
          type,
          itemId,
          actionIds: body.actionIds || body.scriptIds || body.tagScriptIds || [],
          unitIds: body.unitIds || [],
          reason: 'manual',
          force: body.force === true,
        })
        if (!job) return json(res, 400, { error: 'actionIds is required' })
        return json(res, 202, { job: publicTagJob(job) })
      }
      if (action === 'tags') {
        if (!handler.updateItemTags) return json(res, 400, { error: 'This library type does not support tags' })
        const body = await readJson(req)
        const tags = await saveManualTagOverrides({ type, itemId, tags: body.tags || [], exclusiveGroups: await knownExclusiveTagGroups() })
        const item = await handler.updateItemTags(itemId, tags)
        await setItemTags({ type, itemId, tags: item.tags || [] })
        markLibraryIndexDirty()
        return json(res, 200, item)
      }
      if (action === 'thumbnails') {
        if (!handler.enqueueThumbnails) return json(res, 400, { error: 'This library type does not support thumbnails' })
        const body = await readJson(req)
        const thumbnailAction = builtinMetadataActions().find((item) => item.id === 'builtin-thumbnails')
        return json(res, 202, await enqueueThumbnailsWithCoverTag({
          action: thumbnailAction,
          handler,
          type,
          itemId,
          force: body.force !== false,
        }))
      }
      if (action === 'subtitles') {
        if (!handler.rescanSubtitles) return json(res, 400, { error: 'This library type does not support subtitles' })
        return json(res, 200, await handler.rescanSubtitles(itemId))
      }
      if (action === 'units' && parts[6] && parts[7] === 'thumbnail') {
        if (!handler.enqueueThumbnail) return json(res, 400, { error: 'This library type does not support thumbnails' })
        const body = await readJson(req)
        return json(res, 202, { job: await handler.enqueueThumbnail(itemId, parts[6], { force: body.force !== false }) })
      }
      if (action === 'units' && parts[6] && parts[7] === 'subtitles') {
        if (!handler.rescanSubtitles) return json(res, 400, { error: 'This library type does not support subtitles' })
        return json(res, 200, await handler.rescanSubtitles(itemId, { unitId: parts[6] }))
      }
      if (action === 'units' && parts[6] && parts[7] === 'tags') {
        if (!handler.updateUnitTags) return json(res, 400, { error: 'This library type does not support unit tags' })
        const body = await readJson(req)
        const tags = await saveManualTagOverrides({ type, itemId, unitId: parts[6], tags: body.tags || [], exclusiveGroups: await knownExclusiveTagGroups() })
        const unit = await handler.updateUnitTags(itemId, parts[6], tags)
        await setUnitTags({ type, itemId, unitId: parts[6], tags: unit.tags || [] })
        markLibraryIndexDirty()
        return json(res, 200, unit)
      }
    }
    if (pathname.startsWith('/api/library/items/') && req.method === 'DELETE') {
      const parts = pathname.split('/').filter(Boolean)
      const [, , , type, itemId, action] = parts
      if (!itemId) return json(res, 400, { error: 'itemId is required' })
      if (action === 'history') {
        await deleteLibraryHistory(type, itemId)
        return json(res, 200, { ok: true })
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
      const superseded = []
      for (const [id, job] of [...jobs.entries()]) {
        if (job.deleted || job.status !== 'failed') continue
        const retry = createJob({ ...job, retryOf: job.id })
        startJob(retry)
        updateJob(job, {
          status: 'superseded',
          stage: 'superseded',
          supersededBy: retry.id,
          message: `${job.message || '失败'} · 已创建重试任务 ${retry.id}`,
        })
        retried.push(publicJob(retry))
        superseded.push(publicJob(job))
      }
      return json(res, 202, { retried, superseded })
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
    if (pathname === '/api/downloaded' && req.method === 'GET') {
      if (
        url.searchParams.has('page')
        || url.searchParams.has('limit')
        || url.searchParams.has('readFilter')
        || url.searchParams.has('imageFilter')
        || url.searchParams.has('keyword')
      ) {
        return json(res, 200, await listDownloadedPage({
          page: url.searchParams.get('page') || 1,
          limit: url.searchParams.get('limit') || 10,
          readFilter: url.searchParams.get('readFilter') || 'all',
          imageFilter: url.searchParams.get('imageFilter') || 'all',
          keyword: url.searchParams.get('keyword') || '',
        }))
      }
      return json(res, 200, (await listDownloaded({ includeDetails: false })).map(publicDownloadedItem))
    }
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

const epubHandler = createEpubHandler({ dataDir: DATA_DIR, safeSegment, pathExists, moveAside })
registerLibraryHandler(epubHandler)
registerLibraryHandler(createStreamMediaHandler({ type: 'media', dataDir: DATA_DIR, safeSegment, pathExists, getConfig: () => config, epubSupport: epubHandler }))

await mkdir(DOWNLOAD_DIR, { recursive: true })
await initTagStore(DATA_DIR)
config = await loadConfig()
await loadLibraryIndexCache()
createServer(route).listen(PORT, HOST, () => {
  console.log(`copymanga web listening on http://${HOST}:${PORT}`)
  console.log(`download dir: ${DOWNLOAD_DIR}`)
})
