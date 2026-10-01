import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { atomicWriteJson, withFileLock } from '../atomic-json-store.mjs'

const execFileAsync = promisify(execFile)

const AUDIO_EXTENSIONS = ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'webm']
const VIDEO_EXTENSIONS = ['m4v', 'mkv', 'mov', 'mp4', 'webm']
const IMAGE_EXTENSIONS = ['gif', 'jpg', 'jpeg', 'png', 'webp']
const DEFAULT_SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'crt', 'ass', 'ssa', 'lrc', 'sbv', 'smi', 'sami', 'ttml', 'dfxp', 'xml', 'sub']

export function createStreamMediaHandler({ type, dataDir, safeSegment, pathExists, getConfig }) {
  const extensions = type === 'video'
    ? VIDEO_EXTENSIONS
    : type === 'audio'
      ? AUDIO_EXTENSIONS
      : [...new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS])]
  const label = type === 'video' ? '视频' : type === 'audio' ? '音频' : '媒体'
  const progressRoot = path.join(dataDir, 'cache', 'library', 'reading-progress', type)
  const thumbnailRoot = path.join(dataDir, 'cache', 'library-thumbnails', type)
  const thumbnailJobs = new Map()
  const thumbnailQueue = []
  let thumbnailWorkerRunning = false

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

  function thumbnailDir(itemId, unitId) {
    return path.join(thumbnailRoot, safeSegment(itemId), safeSegment(unitId))
  }

  function thumbnailPath(itemId, unitId, name) {
    return path.join(thumbnailDir(itemId, unitId), name)
  }

  function thumbnailUrl(itemId, unitId, kind) {
    return `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/thumbnail/${encodeURIComponent(unitId)}/${kind}`
  }

  async function existingThumbnailName(itemId, unitId, kind) {
    for (const ext of ['webp', 'png', 'jpg', 'jpeg']) {
      const name = `${kind}.${ext}`
      if (await pathExists(thumbnailPath(itemId, unitId, name))) return name
    }
    return ''
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
      } else if (isSupportedName(file.filename) || isSubtitleName(file.filename)) {
        await writeUploadIntoItem({ itemId, file })
      }
    }

    const units = await scanMediaUnits(itemId)
    if (!units.length) throw new Error(`没有找到支持的${label}文件`)
    units.sort(compareMediaUnits)
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

  async function getThumbnail(itemId, unitId, kind = 'cover') {
    const name = await existingThumbnailName(itemId, unitId, kind === 'preview' ? 'preview' : 'cover')
    if (!name) throw new Error('缩略图不存在')
    return {
      body: await readFile(thumbnailPath(itemId, unitId, name)),
      contentType: contentType(name),
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

  async function enqueueThumbnail(itemId, unitId, { force = false } = {}) {
    const item = await readMetadata(itemId)
    const unit = mediaUnitsForItem(item).find((entry) => entry.unitId === unitId)
    if (!unit) throw new Error(`Unit not found: ${unitId}`)
    if (!(unit.mediaKind === 'video' || unit.mediaKind === 'audio')) throw new Error('只支持生成音视频缩略图')
    const active = [...thumbnailJobs.values()].find((job) => (
      !['completed', 'failed', 'skipped'].includes(job.status) &&
      job.itemId === itemId &&
      job.unitId === unitId
    ))
    if (active) return publicThumbnailJob(active)
    const job = {
      id: `thumb-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      itemId,
      unitId,
      title: unit.title || unit.fileName || unitId,
      force: Boolean(force),
      status: 'queued',
      message: '等待生成缩略图',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    thumbnailJobs.set(job.id, job)
    thumbnailQueue.push(job.id)
    await setUnitThumbnailStatus(itemId, unitId, { status: 'queued', error: '' })
    processThumbnailQueue()
    return publicThumbnailJob(job)
  }

  async function enqueueThumbnails(itemId, { force = false } = {}) {
    const item = await readMetadata(itemId)
    const jobs = []
    for (const unit of mediaUnitsForItem(item)) {
      if (!(unit.mediaKind === 'video' || unit.mediaKind === 'audio')) continue
      if (!force && unit.thumbnail?.status === 'ready') continue
      jobs.push(await enqueueThumbnail(itemId, unit.unitId, { force }))
    }
    return { queued: jobs }
  }

  async function rescanSubtitles(itemId) {
    if (!await pathExists(filesPath(itemId))) throw new Error(`Media files not found: ${itemId}`)
    const subtitleFiles = (await walkFiles(filesPath(itemId))).filter(isSubtitleName)
    const subtitlesByKey = subtitlesByMediaKey(itemId, subtitleFiles)
    let nextUnits = []
    const matchedSubtitlePaths = new Set()
    await updateMetadata(itemId, async (item) => {
      const previousUnmatched = new Map(mediaUnitsForItem(item)
        .filter((unit) => unit.mediaKind === 'subtitle')
        .map((unit) => [unit.relativePath, unit]))
      nextUnits = []
      for (const unit of mediaUnitsForItem(item)) {
        if (unit.mediaKind === 'subtitle') continue
        if (unit.mediaKind === 'audio' || unit.mediaKind === 'video') {
          const subtitles = subtitlesByKey.get(subtitleKey(groupPathOf(unit.relativePath || unit.fileName), path.posix.basename(unit.relativePath || unit.fileName, path.posix.extname(unit.relativePath || unit.fileName)))) || []
          for (const subtitle of subtitles) matchedSubtitlePaths.add(subtitle.relativePath)
          nextUnits.push(normalizeMediaUnit({ ...unit, subtitles }))
        } else {
          nextUnits.push(unit)
        }
      }
      for (const filePath of subtitleFiles) {
        const relative = relativePath(itemId, filePath)
        if (matchedSubtitlePaths.has(relative)) continue
        const subtitleUnit = await subtitleUnitFromFile({ itemId, filePath })
        const previous = previousUnmatched.get(relative)
        nextUnits.push(normalizeMediaUnit({
          ...subtitleUnit,
          tags: previous?.tags?.length ? previous.tags : subtitleUnit.tags,
        }))
      }
      nextUnits.sort(compareMediaUnits)
      return {
        ...item,
        unitCount: nextUnits.length,
        mediaUnits: nextUnits.map((unit, index) => normalizeMediaUnit({ ...unit, index })),
        updatedAt: new Date().toISOString(),
      }
    })
    return {
      unitCount: nextUnits.length,
      matched: matchedSubtitlePaths.size,
      unmatched: nextUnits.filter((unit) => unit.mediaKind === 'subtitle').length,
      units: nextUnits,
    }
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
    const matchedSubtitlePaths = new Set()
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
        const subtitles = subtitlesByKey.get(mediaSubtitleKey(itemId, filePath)) || []
        for (const subtitle of subtitles) matchedSubtitlePaths.add(subtitle.relativePath)
        units.push(await unitFromFile({
          itemId,
          filePath,
          subtitles,
        }))
      }
    }
    for (const [groupPath, imageFiles] of imagesByDir.entries()) {
      units.push(await galleryUnitFromFiles({ itemId, groupPath, files: imageFiles }))
    }
    for (const filePath of subtitleFiles) {
      if (!matchedSubtitlePaths.has(relativePath(itemId, filePath))) {
        units.push(await subtitleUnitFromFile({ itemId, filePath }))
      }
    }
    return units.sort(compareMediaUnits)
  }

  function processThumbnailQueue() {
    if (thumbnailWorkerRunning) return
    thumbnailWorkerRunning = true
    setImmediate(async () => {
      try {
        while (thumbnailQueue.length) {
          const id = thumbnailQueue.shift()
          const job = thumbnailJobs.get(id)
          if (!job || job.status !== 'queued') continue
          await runThumbnailJob(job)
        }
      } finally {
        thumbnailWorkerRunning = false
        if (thumbnailQueue.length) processThumbnailQueue()
      }
    })
  }

  async function runThumbnailJob(job) {
    updateThumbnailJob(job, { status: 'running', message: '生成缩略图中' })
    await setUnitThumbnailStatus(job.itemId, job.unitId, { status: 'running', error: '' })
    try {
      const item = await readMetadata(job.itemId)
      const unit = mediaUnitsForItem(item).find((entry) => entry.unitId === job.unitId)
      if (!unit) throw new Error(`Unit not found: ${job.unitId}`)
      if (!(unit.mediaKind === 'video' || unit.mediaKind === 'audio')) throw new Error('只支持生成音视频缩略图')
      if (
        !job.force &&
        await existingThumbnailName(job.itemId, job.unitId, 'cover') &&
        await existingThumbnailName(job.itemId, job.unitId, 'preview')
      ) {
        await setUnitThumbnailReady(job.itemId, job.unitId, { status: 'ready', frameCount: unit.thumbnail?.frameCount || 0 })
        updateThumbnailJob(job, { status: 'skipped', message: '缩略图已存在' })
        return
      }
      if (job.force) await moveThumbnailDirAside(job.itemId, job.unitId)
      const result = unit.mediaKind === 'audio'
        ? await generateAudioThumbnailSet({ itemId: job.itemId, unitId: job.unitId, filePath: unit.managedPath })
        : await generateVideoThumbnailSet({
          itemId: job.itemId,
          unitId: job.unitId,
          filePath: unit.managedPath,
          seed: unit.relativePath || unit.fileName || unit.unitId,
        })
      await setUnitThumbnailReady(job.itemId, job.unitId, result)
      updateThumbnailJob(job, { status: 'completed', message: `缩略图完成 ${result.frameCount} 帧` })
    } catch (error) {
      await setUnitThumbnailStatus(job.itemId, job.unitId, { status: 'failed', error: error.message }).catch(() => {})
      updateThumbnailJob(job, { status: 'failed', message: error.message })
    }
  }

  async function generateVideoThumbnailSet({ itemId, unitId, filePath, seed }) {
    const duration = await videoDuration(filePath)
    const positions = thumbnailPositions(duration, seed)
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `copymanga-thumb-${unitId}-`))
    try {
      const frames = []
      for (const [index, seconds] of positions.entries()) {
        const framePath = path.join(tempDir, `frame-${String(index + 1).padStart(3, '0')}.png`)
        try {
          await execFileAsync('ffmpeg', [
            '-y',
            '-ss', seconds.toFixed(3),
            '-i', filePath,
            '-frames:v', '1',
            '-vf', 'scale=480:-2:flags=lanczos',
            framePath,
          ], { timeout: 45000 })
          frames.push(framePath)
        } catch {
          // Some containers cannot seek to every sampled timestamp; keep usable frames.
        }
      }
      if (!frames.length) throw new Error('无法从视频截取缩略图')
      const coverTemp = path.join(tempDir, 'cover.webp')
      const previewTemp = path.join(tempDir, 'preview.webp')
      const coverSource = frames[Math.floor(frames.length / 2)]
      const coverFile = await encodeStillThumbnail(coverSource, path.join(tempDir, 'cover'))
      let previewFile = previewTemp
      try {
        await encodeAnimatedWebp(frames, previewTemp)
      } catch {
        previewFile = await encodeStillThumbnail(coverSource, path.join(tempDir, 'preview'))
      }
      await mkdir(thumbnailDir(itemId, unitId), { recursive: true })
      await movePath(coverFile, thumbnailPath(itemId, unitId, path.basename(coverFile)))
      await movePath(previewFile, thumbnailPath(itemId, unitId, path.basename(previewFile)))
      return { status: 'ready', frameCount: frames.length }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function generateAudioThumbnailSet({ itemId, unitId, filePath }) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `copymanga-audio-thumb-${unitId}-`))
    try {
      const coverSource = path.join(tempDir, 'embedded-cover')
      const waveformSource = path.join(tempDir, 'waveform.png')
      let source = ''
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', filePath,
          '-an',
          '-vcodec', 'copy',
          `${coverSource}.jpg`,
        ], { timeout: 20000 })
        source = `${coverSource}.jpg`
      } catch {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', filePath,
          '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=640x360:colors=#14b8a6',
          '-frames:v', '1',
          waveformSource,
        ], { timeout: 45000 })
        source = waveformSource
      }
      const coverFile = await encodeStillThumbnail(source, path.join(tempDir, 'cover'))
      const previewFile = await encodeStillThumbnail(source, path.join(tempDir, 'preview'))
      await mkdir(thumbnailDir(itemId, unitId), { recursive: true })
      await movePath(coverFile, thumbnailPath(itemId, unitId, path.basename(coverFile)))
      await movePath(previewFile, thumbnailPath(itemId, unitId, path.basename(previewFile)))
      return { status: 'ready', frameCount: 1 }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function videoDuration(filePath) {
    try {
      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { timeout: 20000 })
      const duration = Number(stdout.trim())
      if (Number.isFinite(duration) && duration > 0) return duration
    } catch {
      // Fall through to a short-video fallback.
    }
    return 12
  }

  async function encodeStillThumbnail(inputPath, outputBasePath) {
    const webpPath = `${outputBasePath}.webp`
    try {
      await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-vf', 'scale=360:-2:flags=lanczos', '-c:v', 'libwebp', '-compression_level', '5', webpPath], { timeout: 30000 })
      return webpPath
    } catch {
      try {
        await runImageMagick([inputPath, '-resize', '360x', webpPath], { timeout: 30000 })
        return webpPath
      } catch {
        const pngPath = `${outputBasePath}.png`
        await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-vf', 'scale=360:-2:flags=lanczos', '-frames:v', '1', '-update', '1', pngPath], { timeout: 30000 })
        return pngPath
      }
    }
  }

  async function encodeAnimatedWebp(framePaths, outputPath) {
    try {
      await execFileAsync('ffmpeg', ['-y', '-framerate', '2', '-i', path.join(path.dirname(framePaths[0]), 'frame-%03d.png'), '-vf', 'scale=320:-2:flags=lanczos', '-loop', '0', '-c:v', 'libwebp', '-compression_level', '5', outputPath], { timeout: 60000 })
      return
    } catch {
      await runImageMagick(['-delay', '50', '-loop', '0', ...framePaths, '-resize', '320x', outputPath], { timeout: 60000 })
    }
  }

  async function runImageMagick(args, options) {
    const errors = []
    for (const command of ['magick', 'convert']) {
      try {
        await execFileAsync(command, args, options)
        return
      } catch (error) {
        errors.push(`${command}: ${error.message}`)
        if (error.code === 'ENOENT') continue
      }
    }
    throw new Error(`WebP 编码失败：${errors.join('；')}`)
  }

  async function setUnitThumbnailStatus(itemId, unitId, thumbnail) {
    return updateMetadata(itemId, (item) => ({
      ...item,
      mediaUnits: mediaUnitsForItem(item).map((unit) => (
        unit.unitId === unitId
          ? normalizeMediaUnit({ ...unit, thumbnail: normalizeThumbnail({ ...(unit.thumbnail || {}), ...thumbnail }) })
          : unit
      )),
      updatedAt: new Date().toISOString(),
    }))
  }

  async function setUnitThumbnailReady(itemId, unitId, thumbnail) {
    return setUnitThumbnailStatus(itemId, unitId, {
      status: thumbnail.status || 'ready',
      coverUrl: thumbnailUrl(itemId, unitId, 'cover'),
      previewUrl: thumbnailUrl(itemId, unitId, 'preview'),
      frameCount: thumbnail.frameCount || 0,
      generatedAt: new Date().toISOString(),
      error: '',
    })
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

  async function moveThumbnailDirAside(itemId, unitId) {
    const source = thumbnailDir(itemId, unitId)
    if (!await pathExists(source)) return
    const target = path.join(os.tmpdir(), `copymanga-thumbnail-${Date.now()}-${safeSegment(unitId)}`)
    await movePath(source, target)
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

  async function subtitleUnitFromFile({ itemId, filePath }) {
    const info = await stat(filePath)
    const fileName = relativePath(itemId, filePath)
    return normalizeMediaUnit({
      type,
      unitId: `subtitle_${createHash('sha1').update(fileName).digest('hex').slice(0, 12)}`,
      title: subtitleTitle(fileName),
      fileName,
      relativePath: fileName,
      groupPath: groupPathOf(fileName),
      mediaKind: 'subtitle',
      tags: ['字幕', '未匹配'],
      size: info.size,
      contentType: 'text/vtt',
      subtitleUnmatched: true,
      createdAt: new Date().toISOString(),
      updatedAt: info.mtime.toISOString(),
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
    return subtitleKey(groupPathOf(relative), subtitleMatchStem(relative))
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
    getThumbnail,
    enqueueThumbnail,
    enqueueThumbnails,
    rescanSubtitles,
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
    subtitleUnmatched: Boolean(unit?.subtitleUnmatched),
    thumbnail: normalizeThumbnail(unit?.thumbnail),
    createdAt: String(unit?.createdAt || ''),
    updatedAt: String(unit?.updatedAt || ''),
  }
}

function normalizeThumbnail(thumbnail) {
  if (!thumbnail || typeof thumbnail !== 'object') return { status: '' }
  return {
    status: String(thumbnail.status || ''),
    coverUrl: String(thumbnail.coverUrl || ''),
    previewUrl: String(thumbnail.previewUrl || ''),
    frameCount: Number(thumbnail.frameCount || 0),
    generatedAt: String(thumbnail.generatedAt || ''),
    error: String(thumbnail.error || ''),
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

function compareMediaUnits(a, b) {
  const rank = (unit) => unit?.mediaKind === 'subtitle' ? 1 : 0
  const rankDiff = rank(a) - rank(b)
  if (rankDiff) return rankDiff
  return String(a.relativePath || a.fileName).localeCompare(String(b.relativePath || b.fileName), undefined, { numeric: true })
}

function publicThumbnailJob(job) {
  return {
    id: job.id,
    itemId: job.itemId,
    unitId: job.unitId,
    title: job.title,
    status: job.status,
    message: job.message,
    force: job.force,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

function updateThumbnailJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() })
}

function thumbnailPositions(duration, seed) {
  const ratios = [0.08, 0.18, 0.31, 0.45, 0.59, 0.72, 0.86]
  const max = Math.max(1, Number(duration || 0))
  return ratios.map((ratio, index) => {
    const jitter = (stableRandom(`${seed}:${index}`) - 0.5) * 0.06
    const sampled = max * Math.max(0.02, Math.min(0.98, ratio + jitter))
    return Math.max(0.2, Math.min(max - 0.2, sampled))
  })
}

function stableRandom(seed) {
  const digest = createHash('sha1').update(String(seed)).digest()
  return digest.readUInt32BE(0) / 0xffffffff
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
  return subtitleKey(dir, subtitleMatchStem(relativePath))
}

function subtitleMatchStem(relativePath) {
  let stem = path.posix.basename(relativePath, path.posix.extname(relativePath))
  let changed = true
  while (changed) {
    const before = stem
    stem = stripTrailingSubtitleToken(stem)
    stem = stripTrailingMediaExtension(stem)
    stem = stripTrailingSubtitleToken(stem)
    changed = stem !== before
  }
  return stem
}

function stripTrailingSubtitleToken(stem) {
  const tokens = ['sc', 'tc', 'chs', 'cht', 'zh', 'cn', 'jp', 'ja', 'en', 'eng', 'jpn', 'zh-cn', 'zh-tw', '字幕', 'sub', 'subs']
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
  return stem
}

function stripTrailingMediaExtension(stem) {
  const ext = path.posix.extname(stem).slice(1).toLowerCase()
  if (!ext) return stem
  const mediaExtensions = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]
  return mediaExtensions.includes(ext) ? stem.slice(0, -(ext.length + 1)) : stem
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
  if (ext === 'ass' || ext === 'ssa') return assToWebVtt(text)
  if (ext === 'lrc') return lrcToWebVtt(text)
  if (ext === 'sbv') return sbvToWebVtt(text)
  if (ext === 'smi' || ext === 'sami') return samiToWebVtt(text)
  if (ext === 'ttml' || ext === 'dfxp' || ext === 'xml') return ttmlToWebVtt(text)
  if (ext === 'sub' && /^\s*\{\d+\}\{\d+\}/m.test(text)) return microDvdToWebVtt(text)
  return srtToWebVtt(text)
}

function srtToWebVtt(text) {
  const normalized = normalizeSubtitleText(text)
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${normalized.replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+)/gm, '')}`
}

function assToWebVtt(text) {
  const lines = normalizeSubtitleText(text).split('\n')
  let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
  const cues = []
  for (const line of lines) {
    if (/^format\s*:/i.test(line)) {
      fields = line.replace(/^format\s*:/i, '').split(',').map((item) => item.trim().toLowerCase())
      continue
    }
    if (!/^dialogue\s*:/i.test(line)) continue
    const payload = line.replace(/^dialogue\s*:/i, '')
    const parts = splitAssDialogue(payload, fields.length)
    const start = parseAssTime(parts[fields.indexOf('start')])
    const end = parseAssTime(parts[fields.indexOf('end')])
    const raw = parts[fields.indexOf('text')] || ''
    if (start == null || end == null || end <= start) continue
    cues.push({ start, end, text: cleanAssText(raw) })
  }
  return cuesToWebVtt(cues)
}

function lrcToWebVtt(text) {
  const entries = []
  for (const line of normalizeSubtitleText(text).split('\n')) {
    const times = [...line.matchAll(/\[(\d{1,3}:\d{2}(?::\d{2})?(?:[.:]\d{1,3})?)\]/g)]
    if (!times.length) continue
    const lyric = line.replace(/\[[^\]]+\]/g, '').trim()
    if (!lyric) continue
    for (const match of times) {
      const start = parseLrcTime(match[1])
      if (start != null) entries.push({ start, text: lyric })
    }
  }
  entries.sort((a, b) => a.start - b.start)
  const cues = entries.map((entry, index) => ({
    start: entry.start,
    end: Math.max(entry.start + 0.5, entries[index + 1]?.start ?? entry.start + 4),
    text: entry.text,
  }))
  return cuesToWebVtt(cues)
}

function sbvToWebVtt(text) {
  const cues = []
  const blocks = normalizeSubtitleText(text).split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    const timing = lines.shift() || ''
    const match = timing.match(/^\s*(.+?)\s*,\s*(.+?)\s*$/)
    if (!match) continue
    const start = parseFlexibleTime(match[1])
    const end = parseFlexibleTime(match[2])
    if (start == null || end == null || end <= start) continue
    cues.push({ start, end, text: lines.join('\n') })
  }
  return cuesToWebVtt(cues)
}

function samiToWebVtt(text) {
  const normalized = normalizeSubtitleText(text)
  const syncs = [...normalized.matchAll(/<sync\b[^>]*\bstart\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<sync\b|<\/body>|<\/sami>|$)/gi)]
  const cues = []
  for (const [index, match] of syncs.entries()) {
    const start = Number(match[1]) / 1000
    const end = Number(syncs[index + 1]?.[1]) / 1000 || start + 4
    const cueText = htmlToSubtitleText(match[2])
    if (end > start && cueText) cues.push({ start, end, text: cueText })
  }
  return cuesToWebVtt(cues)
}

function ttmlToWebVtt(text) {
  const normalized = normalizeSubtitleText(text)
  const cues = []
  for (const match of normalized.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const attrs = match[1] || ''
    const start = parseFlexibleTime(attrValue(attrs, 'begin'))
    let end = parseFlexibleTime(attrValue(attrs, 'end'))
    const duration = parseFlexibleTime(attrValue(attrs, 'dur'))
    if (start == null) continue
    if (end == null && duration != null) end = start + duration
    if (end == null || end <= start) end = start + 4
    const cueText = htmlToSubtitleText(match[2])
    if (cueText) cues.push({ start, end, text: cueText })
  }
  return cuesToWebVtt(cues)
}

function microDvdToWebVtt(text) {
  const fps = Number(normalizeSubtitleText(text).match(/^\s*\{1\}\{1\}(\d+(?:\.\d+)?)\s*$/m)?.[1]) || 25
  const cues = []
  for (const line of normalizeSubtitleText(text).split('\n')) {
    const match = line.match(/^\s*\{(\d+)\}\{(\d+)\}([\s\S]*)$/)
    if (!match) continue
    const start = Number(match[1]) / fps
    const end = Number(match[2]) / fps
    const cueText = match[3].replace(/\|/g, '\n').replace(/\{[^}]+\}/g, '').trim()
    if (end > start && cueText) cues.push({ start, end, text: cueText })
  }
  return cuesToWebVtt(cues)
}

function cuesToWebVtt(cues) {
  const valid = cues
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && String(cue.text || '').trim())
    .sort((a, b) => a.start - b.start)
  return `WEBVTT\n\n${valid.map((cue) => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${escapeCueText(cue.text)}`).join('\n\n')}`
}

function normalizeSubtitleText(text) {
  return String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function splitAssDialogue(value, fieldCount) {
  const parts = []
  let rest = String(value || '')
  for (let index = 0; index < fieldCount - 1; index += 1) {
    const comma = rest.indexOf(',')
    if (comma < 0) {
      parts.push(rest)
      rest = ''
    } else {
      parts.push(rest.slice(0, comma))
      rest = rest.slice(comma + 1)
    }
  }
  parts.push(rest)
  return parts
}

function cleanAssText(value) {
  return String(value || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[nNh]/g, '\n')
    .replace(/\\[A-Za-z]+(?:\([^)]*\))?/g, '')
    .trim()
}

function htmlToSubtitleText(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n'))
}

function attrValue(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return match?.[1] || ''
}

function parseAssTime(value) {
  const match = String(value || '').trim().match(/^(\d+):(\d{2}):(\d{2})(?:[.](\d{1,3}))?$/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number((match[4] || '0').padEnd(3, '0')) / 1000
}

function parseLrcTime(value) {
  const parts = String(value || '').trim().split(':')
  if (parts.length < 2) return null
  const seconds = Number(parts.pop().replace(',', '.'))
  const minutes = Number(parts.pop())
  const hours = parts.length ? Number(parts.pop()) : 0
  if (![hours, minutes, seconds].every(Number.isFinite)) return null
  return hours * 3600 + minutes * 60 + seconds
}

function parseFlexibleTime(value) {
  const input = String(value || '').trim()
  if (!input) return null
  const unit = input.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/i)
  if (unit) {
    const amount = Number(unit[1])
    const suffix = unit[2].toLowerCase()
    if (suffix === 'h') return amount * 3600
    if (suffix === 'm') return amount * 60
    if (suffix === 'ms') return amount / 1000
    return amount
  }
  const parts = input.replace(',', '.').split(':')
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts.map(Number)
    if ([hours, minutes, seconds].every(Number.isFinite)) return hours * 3600 + minutes * 60 + seconds
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts.map(Number)
    if ([minutes, seconds].every(Number.isFinite)) return minutes * 60 + seconds
  }
  const numeric = Number(input)
  return Number.isFinite(numeric) ? numeric : null
}

function formatVttTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000))
  const hours = Math.floor(totalMs / 3600000)
  const minutes = Math.floor((totalMs % 3600000) / 60000)
  const secs = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function escapeCueText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/-->/g, '--&gt;')
}

function decodeHtmlEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase()
    if (key[0] === '#') {
      const code = key[1] === 'x' ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : match
  })
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
