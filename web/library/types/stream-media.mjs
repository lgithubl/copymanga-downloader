import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const AUDIO_EXTENSIONS = ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'webm']
const VIDEO_EXTENSIONS = ['m4v', 'mkv', 'mov', 'mp4', 'webm']

export function createStreamMediaHandler({ type, dataDir, safeSegment, pathExists, getConfig }) {
  const extensions = type === 'video' ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS
  const label = type === 'video' ? '视频' : '音频'
  const progressRoot = path.join(dataDir, 'cache', 'library', 'reading-progress', type)

  function managedBasePath() {
    return path.resolve(getConfig().mediaManagedBasePath)
  }

  function typeRoot() {
    return path.join(managedBasePath(), type)
  }

  function itemPath(itemId) {
    return path.join(typeRoot(), safeSegment(itemId))
  }

  function filesPath(itemId) {
    return path.join(itemPath(itemId), 'files')
  }

  function metadataPath(itemId) {
    return path.join(itemPath(itemId), 'metadata.json')
  }

  function progressPath(itemId) {
    return path.join(progressRoot, `${safeSegment(itemId)}.json`)
  }

  async function readMetadata(itemId) {
    const item = normalizeItem(JSON.parse(await readFile(metadataPath(itemId), 'utf8')))
    const mediaUnits = mediaUnitsForItem(item).map((unit, index) => normalizeMediaUnit({
      ...unit,
      index,
      streamPath: unit.managedPath ? streamPathForManagedPath(unit.managedPath) : unit.streamPath,
      streamUrl: unit.managedPath ? streamUrlForPath(unit.managedPath) : unit.streamUrl,
      metaUrl: unit.managedPath ? metaUrlForPath(unit.managedPath) : unit.metaUrl,
    }))
    return normalizeItem({
      ...item,
      unitCount: mediaUnits.length,
      mediaUnits,
    })
  }

  async function writeMetadata(itemId, item) {
    await mkdir(itemPath(itemId), { recursive: true })
    await writeFile(metadataPath(itemId), JSON.stringify(normalizeItem(item), null, 2))
  }

  async function scanItems() {
    let entries = []
    try {
      entries = await readdir(typeRoot(), { withFileTypes: true })
    } catch {
      return []
    }
    const items = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        items.push(await readMetadata(entry.name))
      } catch {
        // Ignore broken imports so one bad media collection does not hide the list.
      }
    }
    return items
  }

  async function importItem({ files = [], fields = {} }) {
    const requestedItemId = String(fields.itemId || '').trim()
    const sourcePath = String(fields.sourcePath || fields.path || '').trim()
    const collectionTitle = String(fields.title || fields.collectionTitle || '').trim()
    const fileInputs = files.filter((file) => file.buffer?.length)
    if (!sourcePath && !fileInputs.length) throw new Error('sourcePath or file is required')

    const seedTitle = collectionTitle || (sourcePath ? path.basename(sourcePath) : path.basename(fileInputs[0]?.filename || type, path.extname(fileInputs[0]?.filename || '')))
    const itemId = requestedItemId || uniqueItemId(seedTitle)
    const existing = requestedItemId && await pathExists(metadataPath(itemId))
      ? await readMetadata(itemId)
      : normalizeItem({
        type,
        itemId,
        title: seedTitle,
        mediaUnits: [],
        unitCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

    await mkdir(filesPath(itemId), { recursive: true })
    const units = mediaUnitsForItem(existing)
    const imported = []
    if (sourcePath) {
      const sources = await collectSourceFiles(sourcePath)
      for (const source of sources) {
        imported.push(await moveSourceIntoItem({ itemId, source, existingUnits: units }))
      }
    }
    for (const file of fileInputs) {
      if (!isSupportedName(file.filename)) continue
      imported.push(await writeUploadIntoItem({ itemId, file, existingUnits: units }))
    }
    if (!imported.length) throw new Error(`没有找到支持的${label}文件`)

    units.push(...imported)
    units.sort((a, b) => String(a.fileName).localeCompare(String(b.fileName), undefined, { numeric: true }))
    const next = normalizeItem({
      ...existing,
      title: collectionTitle || existing.title || seedTitle,
      unitCount: units.length,
      mediaUnits: units.map((unit, index) => normalizeMediaUnit({ ...unit, index })),
      updatedAt: new Date().toISOString(),
    })
    await writeMetadata(itemId, next)
    return next
  }

  async function getItem(itemId) {
    return readMetadata(itemId)
  }

  async function listUnits(itemId) {
    const item = await readMetadata(itemId)
    return mediaUnitsForItem(item)
  }

  async function getReaderContent(itemId, unitId) {
    const item = await readMetadata(itemId)
    const units = mediaUnitsForItem(item)
    const index = units.findIndex((unit) => unit.unitId === unitId)
    if (index < 0) throw new Error(`Unit not found: ${unitId}`)
    const unit = units[index]
    return {
      type,
      item: pickPublicItem(item),
      unit,
      sections: [],
      section: null,
      navigation: {
        prev: units[index - 1] || null,
        next: units[index + 1] || null,
      },
      stream: {
        url: streamUrlForPath(unit.managedPath),
        metaUrl: metaUrlForPath(unit.managedPath),
        streamPath: streamPathForManagedPath(unit.managedPath),
      },
    }
  }

  async function getProgress(itemId) {
    try {
      return normalizeProgress(JSON.parse(await readFile(progressPath(itemId), 'utf8')), itemId)
    } catch {
      return normalizeProgress(null, itemId)
    }
  }

  async function saveProgress(itemId, patch = {}) {
    const current = await getProgress(itemId)
    const now = new Date().toISOString()
    const unitId = String(patch.unitId || patch.lastUnitId || '').trim()
    if (unitId) {
      current.lastUnitId = unitId
      current.lastScrollRatio = clampRatio(patch.scrollRatio ?? patch.lastScrollRatio ?? current.lastScrollRatio)
      current.readUnits ||= {}
      current.readUnits[unitId] = {
        ...(current.readUnits[unitId] || {}),
        unitId,
        title: String(patch.title || current.readUnits[unitId]?.title || unitId),
        enteredAt: current.readUnits[unitId]?.enteredAt || now,
        updatedAt: now,
      }
      if (current.lastScrollRatio >= 0.9) current.readUnits[unitId].completedAt ||= now
    }
    current.updatedAt = now
    await mkdir(progressRoot, { recursive: true })
    await writeFile(progressPath(itemId), JSON.stringify(current, null, 2))
    return current
  }

  async function collectSourceFiles(sourcePath) {
    const source = path.resolve(sourcePath)
    await assertAllowedSource(source)
    const info = await stat(source)
    const files = info.isDirectory() ? await walkMediaFiles(source) : [source]
    return files.filter(isSupportedName).sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }))
  }

  async function assertAllowedSource(source) {
    const roots = sourceRoots().map((root) => path.resolve(root)).filter(Boolean)
    if (!roots.length) throw new Error('未配置媒体导入来源目录')
    if (!roots.some((root) => source === root || source.startsWith(`${root}${path.sep}`))) {
      throw new Error(`导入路径不在允许目录内：${source}`)
    }
  }

  function sourceRoots() {
    return String(getConfig().mediaImportSourceRoots || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  async function walkMediaFiles(dir) {
    const result = []
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) result.push(...await walkMediaFiles(fullPath))
      else if (entry.isFile()) result.push(fullPath)
    }
    return result
  }

  async function moveSourceIntoItem({ itemId, source, existingUnits }) {
    const target = await uniqueTargetPath({ itemId, fileName: path.basename(source), existingUnits })
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await rename(source, target)
    } catch (error) {
      if (error.code !== 'EXDEV') throw error
      await execFileAsync('mv', [source, target])
    }
    return unitFromFile({ itemId, filePath: target })
  }

  async function writeUploadIntoItem({ itemId, file, existingUnits }) {
    const target = await uniqueTargetPath({ itemId, fileName: file.filename || `${type}-upload`, existingUnits })
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.buffer)
    return unitFromFile({ itemId, filePath: target })
  }

  async function uniqueTargetPath({ itemId, fileName, existingUnits }) {
    const parsed = path.parse(safeSegment(fileName || `${type}-file`))
    const base = parsed.name || type
    const ext = parsed.ext || ''
    const used = new Set(existingUnits.map((unit) => path.resolve(unit.managedPath || '')))
    let candidate = path.join(filesPath(itemId), `${base}${ext}`)
    let index = 2
    while (used.has(path.resolve(candidate)) || await pathExists(candidate)) {
      candidate = path.join(filesPath(itemId), `${base}-${index}${ext}`)
      index += 1
    }
    return candidate
  }

  async function unitFromFile({ itemId, filePath }) {
    const info = await stat(filePath)
    const fileName = path.basename(filePath)
    const unitId = uniqueUnitId(filePath)
    return normalizeMediaUnit({
      type,
      unitId,
      title: path.basename(fileName, path.extname(fileName)),
      fileName,
      managedPath: filePath,
      streamPath: streamPathForManagedPath(filePath),
      streamUrl: streamUrlForPath(filePath),
      metaUrl: metaUrlForPath(filePath),
      size: info.size,
      contentType: contentType(filePath),
      updatedAt: info.mtime.toISOString(),
      createdAt: new Date().toISOString(),
    })
  }

  function streamUrlForPath(managedPath) {
    return `${mediaStreamApiBase()}/api/stream/${encodeURIComponent(encodePath(streamPathForManagedPath(managedPath)))}`
  }

  function metaUrlForPath(managedPath) {
    return `${mediaStreamApiBase()}/api/meta/${encodeURIComponent(encodePath(streamPathForManagedPath(managedPath)))}`
  }

  function mediaStreamApiBase() {
    return String(getConfig().mediaStreamApiBase || '').replace(/\/+$/, '')
  }

  function streamPathForManagedPath(managedPath) {
    const managedBase = path.resolve(getConfig().mediaManagedBasePath)
    const streamBase = String(getConfig().mediaStreamBasePath || '').replace(/\/+$/, '')
    const resolved = path.resolve(managedPath)
    if (resolved === managedBase) return streamBase || resolved
    if (resolved.startsWith(`${managedBase}${path.sep}`) && streamBase) {
      return `${streamBase}/${path.relative(managedBase, resolved).split(path.sep).join('/')}`
    }
    return resolved
  }

  function isSupportedName(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    return extensions.includes(ext)
  }

  return {
    type,
    label,
    scanItems,
    importItem,
    getItem,
    listUnits,
    getReaderContent,
    getProgress,
    saveProgress,
  }
}

function normalizeItem(item) {
  const mediaUnits = Array.isArray(item?.mediaUnits) ? item.mediaUnits.map(normalizeMediaUnit) : []
  return {
    type: String(item?.type || ''),
    itemId: String(item?.itemId || ''),
    title: String(item?.title || item?.itemId || 'Untitled'),
    author: Array.isArray(item?.author) ? item.author : [],
    cover: String(item?.cover || ''),
    unitCount: Number(item?.unitCount || mediaUnits.length || 0),
    mediaUnits,
    createdAt: String(item?.createdAt || ''),
    updatedAt: String(item?.updatedAt || new Date().toISOString()),
  }
}

function normalizeMediaUnit(unit) {
  return {
    type: String(unit?.type || ''),
    unitId: String(unit?.unitId || ''),
    title: String(unit?.title || unit?.fileName || unit?.unitId || 'Media'),
    index: Number(unit?.index || 0),
    fileName: String(unit?.fileName || ''),
    managedPath: String(unit?.managedPath || ''),
    streamPath: String(unit?.streamPath || ''),
    streamUrl: String(unit?.streamUrl || ''),
    metaUrl: String(unit?.metaUrl || ''),
    size: Number(unit?.size || 0),
    contentType: String(unit?.contentType || ''),
    createdAt: String(unit?.createdAt || ''),
    updatedAt: String(unit?.updatedAt || ''),
  }
}

function mediaUnitsForItem(item) {
  return Array.isArray(item?.mediaUnits) ? item.mediaUnits.map(normalizeMediaUnit) : []
}

function pickPublicItem(item) {
  const { mediaUnits, ...publicItem } = item
  return publicItem
}

function uniqueItemId(title) {
  const digest = createHash('sha1').update(`${title}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 8)
  return `${slug(title)}-${digest}`
}

function uniqueUnitId(filePath) {
  return `${slug(path.basename(filePath, path.extname(filePath)))}_${createHash('sha1').update(filePath).digest('hex').slice(0, 8)}`
}

function slug(value) {
  return String(value || 'media')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 64) || 'media'
}

function encodePath(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function contentType(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (['mp3'].includes(ext)) return 'audio/mpeg'
  if (['wav'].includes(ext)) return 'audio/wav'
  if (['flac'].includes(ext)) return 'audio/flac'
  if (['m4a', 'aac'].includes(ext)) return 'audio/aac'
  if (['ogg', 'opus'].includes(ext)) return 'audio/ogg'
  if (['mp4', 'm4v'].includes(ext)) return 'video/mp4'
  if (['mov'].includes(ext)) return 'video/quicktime'
  if (['webm'].includes(ext)) return 'video/webm'
  if (['mkv'].includes(ext)) return 'video/x-matroska'
  return 'application/octet-stream'
}

function normalizeProgress(value, itemId) {
  return {
    itemId,
    lastUnitId: String(value?.lastUnitId || ''),
    lastScrollRatio: clampRatio(value?.lastScrollRatio || 0),
    readUnits: value?.readUnits && typeof value.readUnits === 'object' ? value.readUnits : {},
    updatedAt: String(value?.updatedAt || ''),
  }
}

function clampRatio(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}
