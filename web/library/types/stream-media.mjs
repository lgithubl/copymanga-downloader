import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { atomicWriteJson, withFileLock } from '../atomic-json-store.mjs'

const execFileAsync = promisify(execFile)

const AUDIO_EXTENSIONS = ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'webm']
const VIDEO_EXTENSIONS = ['m4v', 'mkv', 'mov', 'mp4', 'webm']
const IMAGE_EXTENSIONS = ['gif', 'jpg', 'jpeg', 'png', 'webp']
const DEFAULT_SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'crt']

export function createStreamMediaHandler({ type, dataDir, safeSegment, pathExists, getConfig }) {
  const extensions = type === 'video'
    ? VIDEO_EXTENSIONS
    : type === 'audio'
      ? AUDIO_EXTENSIONS
      : [...new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS])]
  const label = type === 'video' ? '视频' : type === 'audio' ? '音频' : '媒体'
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
    const file = metadataPath(itemId)
    return withFileLock(file, () => writeMetadataUnlocked(itemId, item))
  }

  async function writeMetadataUnlocked(itemId, item) {
    await atomicWriteJson(metadataPath(itemId), normalizeItem(item))
  }

  async function updateMetadata(itemId, mutate) {
    const file = metadataPath(itemId)
    return withFileLock(file, async () => {
      const current = normalizeItem(JSON.parse(await readFile(file, 'utf8')))
      const next = normalizeItem(await mutate(current))
      await writeMetadataUnlocked(itemId, next)
      return next
    })
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
    const inputTags = parseTags(fields.tags || '')
    const fileInputs = files.filter((file) => file.buffer?.length)
    if (!sourcePath && !fileInputs.length) throw new Error('sourcePath or file is required')

    const seedTitle = collectionTitle || seedTitleForImport({ sourcePath, fileInputs })
    const itemId = requestedItemId || uniqueItemId(seedTitle)
    const existing = requestedItemId && await pathExists(metadataPath(itemId))
      ? await readMetadata(itemId)
      : normalizeItem({
        type,
        itemId,
        title: seedTitle,
        tags: inputTags,
        mediaUnits: [],
        unitCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

    await mkdir(itemPath(itemId), { recursive: true })
    if (sourcePath) {
      const source = path.resolve(sourcePath)
      await assertAllowedSource(source)
      await assertMediaRoot(source)
      await importSourceRoot({ itemId, source, preferredName: path.basename(source) })
    }
    for (const file of fileInputs) {
      if (isZipName(file.filename)) {
        const source = await extractZipUpload(file)
        await assertMediaRoot(source)
        await importSourceRoot({ itemId, source, preferredName: path.basename(file.filename, path.extname(file.filename)) })
      } else if (isSupportedName(file.filename)) {
        await writeUploadIntoItem({ itemId, file })
      }
    }

    const units = await scanMediaUnits(itemId)
    if (!units.length) throw new Error(`没有找到支持的${label}文件`)
    units.sort((a, b) => String(a.fileName).localeCompare(String(b.fileName), undefined, { numeric: true }))
    const next = normalizeItem({
      ...existing,
      title: collectionTitle || existing.title || seedTitle,
      tags: inputTags.length ? inputTags : existing.tags || [],
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
    if (unit.mediaKind === 'image-gallery') {
      return {
        type: 'images',
        item: pickPublicItem(item),
        unit,
        sections: [],
        section: null,
        navigation: {
          prev: units[index - 1] || null,
          next: units[index + 1] || null,
        },
        images: (unit.images || []).map((image, imageIndex) => ({
          index: imageIndex,
          title: image.title || path.posix.basename(image.relativePath || ''),
          url: `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/resource?path=${encodeURIComponent(image.relativePath || '')}`,
        })),
      }
    }
    return {
      type: unit.mediaKind || type,
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

  async function getResource(itemId, resourcePath, options = {}) {
    const filePath = safeManagedFilePath(itemId, resourcePath)
    if (options.subtitle && isSubtitleName(filePath)) {
      return {
        body: Buffer.from(await subtitleFileToWebVtt(filePath)),
        contentType: 'text/vtt; charset=utf-8',
      }
    }
    return {
      body: await readFile(filePath),
      contentType: contentType(filePath),
    }
  }

  async function updateItemTags(itemId, tags = []) {
    return updateMetadata(itemId, (item) => ({
      ...item,
      tags: parseTags(tags),
      updatedAt: new Date().toISOString(),
    }))
  }

  async function updateUnitTags(itemId, unitId, tags = []) {
    let updatedUnit
    await updateMetadata(itemId, (item) => {
      const units = mediaUnitsForItem(item)
      const index = units.findIndex((unit) => unit.unitId === unitId)
      if (index < 0) throw new Error(`Unit not found: ${unitId}`)
      updatedUnit = normalizeMediaUnit({ ...units[index], tags: parseTags(tags) })
      units[index] = updatedUnit
      return { ...item, mediaUnits: units, updatedAt: new Date().toISOString() }
    })
    return updatedUnit
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

  async function assertMediaRoot(source) {
    const info = await stat(source)
    const root = info.isDirectory() ? source : path.dirname(source)
    const candidates = info.isDirectory() ? await walkFiles(source) : [source]
    const mediaFiles = candidates.filter(isSupportedName)
    if (!mediaFiles.length) throw new Error(`没有找到支持的${label}文件`)
    return { root, mediaFiles }
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

  async function walkFiles(dir) {
    const result = []
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return result
      throw error
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) result.push(...await walkFiles(fullPath))
      else if (entry.isFile()) result.push(fullPath)
    }
    return result
  }

  async function importSourceRoot({ itemId, source, preferredName }) {
    const info = await stat(source)
    if (info.isDirectory()) {
      await importDirectoryRoot({ itemId, source, preferredName })
    } else {
      await importSingleFile({ itemId, source, relativeName: path.basename(source) })
    }
  }

  async function importDirectoryRoot({ itemId, source, preferredName }) {
    await mkdir(itemPath(itemId), { recursive: true })
    if (!await pathExists(filesPath(itemId))) {
      await movePath(source, filesPath(itemId))
      return
    }
    const entries = await readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      const from = path.join(source, entry.name)
      const to = await uniqueImportTarget(path.join(filesPath(itemId), safeSegment(entry.name || preferredName || type)))
      await movePath(from, to)
    }
  }

  async function importSingleFile({ itemId, source, relativeName }) {
    const target = await uniqueImportTarget(path.join(filesPath(itemId), safeRelativePath(relativeName || path.basename(source))))
    await mkdir(path.dirname(target), { recursive: true })
    await movePath(source, target)
  }

  async function writeUploadIntoItem({ itemId, file }) {
    const target = await uniqueImportTarget(path.join(filesPath(itemId), safeRelativePath(file.filename || `${type}-upload`)))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.buffer)
  }

  async function extractZipUpload(file) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `copymanga-${type}-zip-`))
    const zipPath = path.join(tempDir, safeSegment(file.filename || `${type}.zip`))
    const extractDir = path.join(tempDir, 'extract')
    await mkdir(extractDir, { recursive: true })
    await writeFile(zipPath, file.buffer)
    await assertSafeZip(zipPath)
    await extractZipArchive(zipPath, extractDir)
    await assertSafeExtractedTree(extractDir)
    return extractDir
  }

  async function extractZipArchive(zipPath, extractDir) {
    const attempts = [
      ['unar', ['-quiet', '-force-overwrite', '-no-directory', '-output-directory', extractDir, zipPath]],
      ['bsdtar', ['-xf', zipPath, '-C', extractDir]],
      ['unzip', ['-q', zipPath, '-d', extractDir]],
    ]
    const errors = []
    for (const [command, args] of attempts) {
      try {
        await execFileAsync(command, args)
        return
      } catch (error) {
        errors.push(`${command}: ${error.message}`)
        if (command === 'unar' && error.code === 'ENOENT') continue
        if (command === 'bsdtar' && error.code === 'ENOENT') continue
      }
    }
    throw new Error(`zip 解压失败：${errors.join('；')}`)
  }

  async function assertSafeZip(zipPath) {
    const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath])
    const names = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    if (!names.length) throw new Error('zip 文件为空')
    for (const name of names) {
      const segments = name.split(/[\\/]+/).filter(Boolean)
      if (
        path.isAbsolute(name) ||
        /^[a-zA-Z]:/.test(name) ||
        segments.some((segment) => segment === '..')
      ) {
        throw new Error(`zip 内包含不安全路径：${name}`)
      }
    }
  }

  async function assertSafeExtractedTree(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`zip 内包含不支持的链接：${entry.name}`)
      if (entry.isDirectory()) await assertSafeExtractedTree(fullPath)
    }
  }

  async function scanMediaUnits(itemId) {
    if (!await pathExists(filesPath(itemId))) return []
    const allFiles = await walkFiles(filesPath(itemId))
    const subtitleFiles = allFiles.filter(isSubtitleName)
    const subtitlesByKey = subtitlesByMediaKey(itemId, subtitleFiles)
    const files = allFiles
      .filter(isSupportedName)
      .sort((a, b) => relativePath(itemId, a).localeCompare(relativePath(itemId, b), undefined, { numeric: true }))
    if (type !== 'media') {
      return Promise.all(files.map((filePath) => unitFromFile({
        itemId,
        filePath,
        subtitles: subtitlesByKey.get(mediaSubtitleKey(itemId, filePath)) || [],
      })))
    }
    const units = []
    const imagesByDir = new Map()
    for (const filePath of files) {
      const kind = mediaKind(filePath)
      if (kind === 'image') {
        const dir = path.posix.dirname(relativePath(itemId, filePath))
        const key = dir === '.' ? '' : dir
        const list = imagesByDir.get(key) || []
        list.push(filePath)
        imagesByDir.set(key, list)
      } else {
        units.push(await unitFromFile({
          itemId,
          filePath,
          subtitles: subtitlesByKey.get(mediaSubtitleKey(itemId, filePath)) || [],
        }))
      }
    }
    for (const [groupPath, imageFiles] of imagesByDir.entries()) {
      units.push(await galleryUnitFromFiles({ itemId, groupPath, files: imageFiles }))
    }
    return units.sort((a, b) => String(a.relativePath || a.fileName).localeCompare(String(b.relativePath || b.fileName), undefined, { numeric: true }))
  }

  async function uniqueImportTarget(candidate) {
    const parsed = path.parse(candidate)
    let target = candidate
    let index = 2
    while (await pathExists(target)) {
      target = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
      index += 1
    }
    return target
  }

  async function movePath(source, target) {
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await rename(source, target)
    } catch (error) {
      if (error.code !== 'EXDEV') throw error
      await execFileAsync('mv', [source, target])
    }
  }

  async function unitFromFile({ itemId, filePath, subtitles = [] }) {
    const info = await stat(filePath)
    const fileName = relativePath(itemId, filePath)
    const title = path.basename(fileName, path.extname(fileName))
    const unitId = uniqueUnitId(fileName)
    const kind = mediaKind(filePath)
    return normalizeMediaUnit({
      type,
      unitId,
      title,
      fileName,
      relativePath: fileName,
      groupPath: groupPathOf(fileName),
      mediaKind: kind,
      tags: [kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片'],
      managedPath: filePath,
      streamPath: streamPathForManagedPath(filePath),
      streamUrl: streamUrlForPath(filePath),
      metaUrl: metaUrlForPath(filePath),
      size: info.size,
      contentType: contentType(filePath),
      subtitles,
      updatedAt: info.mtime.toISOString(),
      createdAt: new Date().toISOString(),
    })
  }

  async function galleryUnitFromFiles({ itemId, groupPath, files }) {
    const relative = groupPath || 'images'
    const unitId = `gallery_${createHash('sha1').update(relative).digest('hex').slice(0, 12)}`
    const images = files.map((filePath, index) => ({
      index,
      title: path.basename(filePath),
      relativePath: relativePath(itemId, filePath),
      size: 0,
    }))
    return normalizeMediaUnit({
      type,
      unitId,
      title: groupPath || '图片',
      fileName: relative,
      relativePath: relative,
      groupPath,
      mediaKind: 'image-gallery',
      tags: ['图片'],
      imageCount: images.length,
      images,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  function relativePath(itemId, filePath) {
    return path.relative(filesPath(itemId), filePath).split(path.sep).join('/')
  }

  function safeManagedFilePath(itemId, resourcePath) {
    const base = filesPath(itemId)
    const normalized = path.normalize(String(resourcePath || '').replace(/^[/\\]+/, ''))
    const target = path.resolve(base, normalized)
    if (target !== path.resolve(base) && !target.startsWith(`${path.resolve(base)}${path.sep}`)) {
      throw new Error('resource path is outside media item')
    }
    return target
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

  function isSubtitleName(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    return subtitleExtensions().includes(ext)
  }

  function subtitleExtensions() {
    const configured = getConfig().mediaSubtitleExtensions
    const input = Array.isArray(configured) ? configured : String(configured || '').split(/[,\s，]+/)
    const values = [...new Set(input
      .map((item) => String(item || '').trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean))]
    return values.length ? values : DEFAULT_SUBTITLE_EXTENSIONS
  }

  function subtitlesByMediaKey(itemId, subtitleFiles) {
    const map = new Map()
    for (const filePath of subtitleFiles.sort((a, b) => relativePath(itemId, a).localeCompare(relativePath(itemId, b), undefined, { numeric: true }))) {
      const relative = relativePath(itemId, filePath)
      const key = subtitleMediaKey(relative)
      const list = map.get(key) || []
      list.push({
        title: subtitleTitle(relative),
        relativePath: relative,
        language: subtitleLanguage(relative),
        url: `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/resource?path=${encodeURIComponent(relative)}&subtitle=1`,
        contentType: 'text/vtt',
      })
      map.set(key, list)
    }
    return map
  }

  function mediaSubtitleKey(itemId, filePath) {
    const relative = relativePath(itemId, filePath)
    return subtitleKey(groupPathOf(relative), path.posix.basename(relative, path.posix.extname(relative)))
  }

  return {
    type,
    label,
    scanItems,
    importItem,
    getItem,
    listUnits,
    getReaderContent,
    getResource,
    getProgress,
    saveProgress,
    updateItemTags,
    updateUnitTags,
  }
}

function normalizeItem(item) {
  const mediaUnits = Array.isArray(item?.mediaUnits) ? item.mediaUnits.map(normalizeMediaUnit) : []
  return {
    type: String(item?.type || ''),
    itemId: String(item?.itemId || ''),
    title: String(item?.title || item?.itemId || 'Untitled'),
    author: Array.isArray(item?.author) ? item.author : [],
    tags: parseTags(item?.tags || []),
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
    relativePath: String(unit?.relativePath || unit?.fileName || ''),
    groupPath: String(unit?.groupPath || groupPathOf(unit?.relativePath || unit?.fileName || '')),
    mediaKind: String(unit?.mediaKind || unit?.kind || unit?.type || ''),
    tags: parseTags(unit?.tags || []),
    managedPath: String(unit?.managedPath || ''),
    streamPath: String(unit?.streamPath || ''),
    streamUrl: String(unit?.streamUrl || ''),
    metaUrl: String(unit?.metaUrl || ''),
    size: Number(unit?.size || 0),
    contentType: String(unit?.contentType || ''),
    imageCount: Number(unit?.imageCount || 0),
    images: Array.isArray(unit?.images) ? unit.images : [],
    subtitles: Array.isArray(unit?.subtitles) ? unit.subtitles.map(normalizeSubtitle) : [],
    createdAt: String(unit?.createdAt || ''),
    updatedAt: String(unit?.updatedAt || ''),
  }
}

function normalizeSubtitle(subtitle) {
  return {
    title: String(subtitle?.title || subtitle?.relativePath || '字幕'),
    relativePath: String(subtitle?.relativePath || ''),
    language: String(subtitle?.language || ''),
    url: String(subtitle?.url || ''),
    contentType: String(subtitle?.contentType || 'text/vtt'),
  }
}

function mediaUnitsForItem(item) {
  return Array.isArray(item?.mediaUnits) ? item.mediaUnits.map(normalizeMediaUnit) : []
}

function pickPublicItem(item) {
  const { mediaUnits, ...publicItem } = item
  return publicItem
}

function mediaKind(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  return 'unknown'
}

function groupPathOf(relativePath) {
  const dir = path.posix.dirname(String(relativePath || '').split(path.sep).join('/'))
  return dir === '.' ? '' : dir
}

function subtitleMediaKey(relativePath) {
  const dir = groupPathOf(relativePath)
  let stem = path.posix.basename(relativePath, path.posix.extname(relativePath))
  const tokens = ['sc', 'tc', 'chs', 'cht', 'zh', 'cn', 'jp', 'ja', 'en', 'eng', 'jpn', '字幕', 'sub', 'subs']
  let changed = true
  while (changed) {
    changed = false
    for (const token of tokens) {
      const pattern = new RegExp(`(?:[._ -])${escapeRegExp(token)}$`, 'i')
      if (pattern.test(stem)) {
        stem = stem.replace(pattern, '')
        changed = true
      }
    }
  }
  return subtitleKey(dir, stem)
}

function subtitleKey(dir, stem) {
  return `${String(dir || '').toLowerCase()}\u001f${String(stem || '').toLowerCase()}`
}

function subtitleTitle(relativePath) {
  const stem = path.posix.basename(relativePath, path.posix.extname(relativePath))
  const suffix = stem.split(/[._ -]+/).pop()
  if (suffix && suffix !== stem && /^[a-z]{2,4}$/i.test(suffix)) return suffix.toUpperCase()
  return stem
}

function subtitleLanguage(relativePath) {
  const stem = path.posix.basename(relativePath, path.posix.extname(relativePath))
  const suffix = stem.split(/[._ -]+/).pop()?.toLowerCase()
  const languages = {
    sc: 'zh-CN',
    chs: 'zh-CN',
    cn: 'zh-CN',
    tc: 'zh-TW',
    cht: 'zh-TW',
    zh: 'zh',
    en: 'en',
    eng: 'en',
    jp: 'ja',
    ja: 'ja',
    jpn: 'ja',
  }
  return languages[suffix] || ''
}

async function subtitleFileToWebVtt(filePath) {
  const text = await readFile(filePath, 'utf8')
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (ext === 'vtt') return text.replace(/^\uFEFF/, '').startsWith('WEBVTT') ? text : `WEBVTT\n\n${text}`
  return srtToWebVtt(text)
}

function srtToWebVtt(text) {
  const normalized = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${normalized.replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+)/gm, '')}`
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function uniqueItemId(title) {
  const digest = createHash('sha1').update(`${title}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 8)
  return `${slug(title)}-${digest}`
}

function uniqueUnitId(filePath) {
  return `${slug(path.basename(filePath, path.extname(filePath)))}_${createHash('sha1').update(filePath).digest('hex').slice(0, 8)}`
}

function seedTitleForImport({ sourcePath, fileInputs }) {
  if (sourcePath) return path.basename(sourcePath, path.extname(sourcePath)) || 'media'
  const firstZip = fileInputs.find((file) => isZipName(file.filename))
  if (firstZip) return path.basename(firstZip.filename, path.extname(firstZip.filename)) || 'media'
  const firstFile = fileInputs[0]?.filename || 'media'
  return path.basename(firstFile, path.extname(firstFile)) || 'media'
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

function safeRelativePath(value) {
  return String(value || 'media')
    .split(/[\\/]+/)
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/:/g, '：').replace(/\*/g, '⭐').replace(/\?/g, '？').replace(/"/g, "'").replace(/</g, '《').replace(/>/g, '》').replace(/\|/g, '丨'))
    .join('/') || 'media'
}

function parseTags(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(/[,\n，#]+/)
  return [...new Set(input.map((item) => String(item || '').trim()).filter(Boolean))]
}

function isZipName(filePath) {
  return path.extname(filePath || '').toLowerCase() === '.zip'
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
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg'
  if (['png'].includes(ext)) return 'image/png'
  if (['gif'].includes(ext)) return 'image/gif'
  if (['webp'].includes(ext)) return 'image/webp'
  if (['vtt', 'srt', 'crt'].includes(ext)) return 'text/vtt; charset=utf-8'
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
