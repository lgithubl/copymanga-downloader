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
const EPUB_EXTENSIONS = ['epub']
const DEFAULT_SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'crt', 'ass', 'ssa', 'lrc', 'sbv', 'smi', 'sami', 'ttml', 'dfxp', 'xml', 'sub']
const ITEM_COVER_UNIT_ID = '__cover'

export function createStreamMediaHandler({ type, dataDir, safeSegment, pathExists, getConfig, epubSupport = null }) {
  const extensions = type === 'video'
    ? VIDEO_EXTENSIONS
    : type === 'audio'
      ? AUDIO_EXTENSIONS
      : [...new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS, ...EPUB_EXTENSIONS])]
  const label = type === 'video' ? '视频' : type === 'audio' ? '音频' : '媒体'
  const progressRoot = path.join(dataDir, 'cache', 'library', 'reading-progress', type)
  const thumbnailRoot = path.join(dataDir, 'cache', 'library-thumbnails', type)
  // 合并掉的源条目搬到这里等人工处理，不直接删。放 dataDir 下而不是 os.tmpdir()，
  // 因为系统会清理 tmp——需要的时候东西还得在。
  const trashRoot = path.join(dataDir, 'cache', 'library-trash', type)
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

  function subtitleResourceUrl(itemId, relative) {
    return `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/resource?path=${encodeURIComponent(relative)}&subtitle=1`
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
    const importProfile = String(fields.importProfile || fields.mediaImportProfile || '').trim()
    const fileInputs = files.filter((file) => file.buffer?.length)
    if (!sourcePath && !fileInputs.length) throw new Error('sourcePath or file is required')
    if (importProfile === 'rj-media') {
      if (sourcePath && !fileInputs.length) return importRjDirectoryBatch({ sourcePath, inputTags })
      if (fileInputs.length) return importRjUploadBatch({ files: fileInputs, inputTags })
    }
    if (importProfile === 'monthly-ani') {
      if (fileInputs.length) return importMonthlyAniUploadBatch({ files: fileInputs, inputTags })
      return importMonthlyAniBatch({ sourcePath, inputTags })
    }

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
        publishedAt: new Date().toISOString(),
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

    const units = await scanMediaUnits(itemId, mediaUnitsForItem(existing))
    if (!units.length) throw new Error(`没有找到支持的${label}文件`)
    units.sort(compareMediaUnits)
    const next = normalizeItem({
      ...existing,
      title: collectionTitle || existing.title || seedTitle,
      tags: inputTags.length ? inputTags : existing.tags || [],
      cover: existing.cover || units.find((unit) => unit.cover)?.cover || '',
      unitCount: units.length,
      mediaUnits: units.map((unit, index) => normalizeMediaUnit({ ...unit, index })),
      publishedAt: existing.publishedAt || existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await writeMetadata(itemId, next)
    return next
  }

  async function importRjDirectoryBatch({ sourcePath, inputTags = [] }) {
    const source = path.resolve(sourcePath)
    await assertAllowedSource(source)
    const sourceInfo = await stat(source)
    if (!sourceInfo.isDirectory()) throw new Error('RJ 导入方案只支持目录来源')
    const options = rjImportOptions()
    const roots = await findRjImportRoots(source, options)
    if (!roots.length) throw new Error(`没有找到 RJ/VJ/BJ/EJ 目录：${source}`)
    const items = []
    for (const root of roots) {
      const item = await importRjDirectoryItem({ root, inputTags, options })
      items.push(item)
    }
    return {
      type,
      profile: 'rj-media',
      imported: items.length,
      items,
    }
  }

  async function importRjUploadBatch({ files = [], inputTags = [] }) {
    const options = rjImportOptions()
    const roots = []
    for (const file of files) {
      if (!isZipName(file.filename)) throw new Error('RJ 导入方案上传只支持 zip 文件')
      const source = await extractZipUpload(file)
      const found = await findRjImportRoots(source, options)
      roots.push(...found)
    }
    if (!roots.length) throw new Error('上传 zip 中没有找到 RJ/VJ/BJ/EJ 目录')
    const items = []
    for (const root of roots) {
      const item = await importRjDirectoryItem({ root, inputTags, options })
      items.push(item)
    }
    return {
      type,
      profile: 'rj-media',
      imported: items.length,
      items,
    }
  }

  async function importRjDirectoryItem({ root, inputTags = [], options }) {
    const title = root.productId
    const itemId = uniqueItemId(title)
    await mkdir(itemPath(itemId), { recursive: true })
    await importDirectoryRoot({ itemId, source: root.path, preferredName: title })
    const dlsite = {
      productId: root.productId,
      status: 'pending',
      site: '',
      title: '',
      circle: '',
      cover: '',
      fetchedAt: '',
    }
    const next = normalizeItem({
      type,
      itemId,
      title,
      productId: root.productId,
      sourceProfile: 'rj-media',
      dlsite,
      tags: inputTags,
      cover: '',
      unitCount: 0,
      mediaUnits: [],
      createdAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await writeMetadata(itemId, next)
    return next
  }

  // 月度 ANI：遍历来源目录下的所有视频，每个视频单独成一个合集。
  // 字幕按「同目录 + 归一化词干」跟着它的视频一起搬——用的就是 scanMediaUnits
  // 匹配字幕的那套键（subtitleMediaKey），保证搬进来的一定配得上，不会出现
  // 「文件在条目里却挂不上」的分裂。配不上任何视频的字幕不导入，但会回报出来。
  async function importMonthlyAniBatch({ sourcePath, inputTags = [] }) {
    if (!sourcePath) throw new Error('月度 ANI 导入方案需要来源路径')
    const source = path.resolve(sourcePath)
    await assertAllowedSource(source)
    const sourceInfo = await stat(source)
    if (!sourceInfo.isDirectory()) throw new Error('月度 ANI 导入方案只支持目录来源')
    return scanMonthlyAniSource({ source, inputTags })
  }

  // 上传走和 rj-media 一样的路子：先把上传内容落到一个暂存目录，再复用目录版逻辑。
  // 白名单（assertAllowedSource）只管用户指定的服务端路径，暂存目录是我们自己建的，
  // 不需要也不应该过那道检查。
  async function importMonthlyAniUploadBatch({ files = [], inputTags = [] }) {
    const stage = await mkdtemp(path.join(os.tmpdir(), `copymanga-${type}-ani-`))
    try {
      for (const file of files) {
        if (isZipName(file.filename)) {
          // 多个 zip 合并进同一个暂存目录，一次导入就能跨 zip 配字幕
          const extracted = await extractZipUpload(file)
          for (const entry of await readdir(extracted)) {
            const to = await uniqueImportTarget(path.join(stage, safeSegment(entry)))
            await movePath(path.join(extracted, entry), to)
          }
        } else {
          const to = await uniqueImportTarget(path.join(stage, safeRelativePath(file.filename || `${type}-upload`)))
          await mkdir(path.dirname(to), { recursive: true })
          await writeFile(to, file.buffer)
        }
      }
      // 必须 await：try/finally 里 `return promise` 会让 finally 立刻跑，
      // 暂存目录在扫描搬文件之前就被 rm 掉，报 ENOENT。
      return await scanMonthlyAniSource({ source: stage, inputTags })
    } finally {
      // 视频和已匹配字幕都被 movePath 搬进条目了，这里只剩没被认领的文件；
      // 它们在 skippedSubtitles 里有记录，而且上传方本来就还留着原件。
      await rm(stage, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function scanMonthlyAniSource({ source, inputTags = [] }) {
    const relOf = (filePath) => path.relative(source, filePath).split(path.sep).join('/')
    const byRelative = (a, b) => relOf(a).localeCompare(relOf(b), undefined, { numeric: true })
    const allFiles = await walkFiles(source)
    const videos = allFiles.filter((filePath) => mediaKind(filePath) === 'video').sort(byRelative)
    if (!videos.length) throw new Error(`没有找到视频文件：${source}`)

    const subtitlesByKey = new Map()
    for (const filePath of allFiles.filter(isSubtitleName).sort(byRelative)) {
      const key = subtitleMediaKey(relOf(filePath))
      const list = subtitlesByKey.get(key) || []
      list.push(filePath)
      subtitlesByKey.set(key, list)
    }

    const items = []
    const takenSubtitles = new Set()
    for (const video of videos) {
      const subtitles = subtitlesByKey.get(subtitleMediaKey(relOf(video))) || []
      for (const subtitle of subtitles) takenSubtitles.add(subtitle)
      items.push(await importMonthlyAniItem({ video, subtitles, inputTags }))
    }
    // 没被任何视频认领的字幕：常见于字幕单独放 Subs/ 子目录，或命名和视频对不上。
    // 静默丢掉会让人以为字幕丢了，所以显式回报。
    const skippedSubtitles = allFiles
      .filter(isSubtitleName)
      .filter((filePath) => !takenSubtitles.has(filePath))
      .map(relOf)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return {
      type,
      profile: 'monthly-ani',
      imported: items.length,
      skippedSubtitles,
      items,
    }
  }

  async function importMonthlyAniItem({ video, subtitles = [], inputTags = [] }) {
    const title = path.basename(video, path.extname(video)) || type
    const itemId = uniqueItemId(title)
    await mkdir(itemPath(itemId), { recursive: true })
    // 一律拍平到条目根：一个条目只有一个视频不会撞名，而字幕和视频必须落在
    // 同一层目录，匹配键的目录部分才相等（见 subtitleKey）。
    await importSingleFile({ itemId, source: video, relativeName: path.basename(video) })
    for (const subtitle of subtitles) {
      await importSingleFile({ itemId, source: subtitle, relativeName: path.basename(subtitle) })
    }
    const units = await scanMediaUnits(itemId, [])
    units.sort(compareMediaUnits)
    const next = normalizeItem({
      type,
      itemId,
      title,
      sourceProfile: 'monthly-ani',
      tags: inputTags,
      cover: units.find((unit) => unit.cover)?.cover || '',
      unitCount: units.length,
      mediaUnits: units.map((unit, index) => normalizeMediaUnit({ ...unit, index })),
      createdAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
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

  async function getReaderContent(itemId, unitId, options = {}) {
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
    if (unit.mediaKind === 'epub' && epubSupport?.getReaderContentFromItem) {
      return epubSupport.getReaderContentFromItem({
        item,
        itemDir: itemPath(itemId),
        itemId,
        unit,
        units,
        index,
        sectionId: options.sectionId || '',
        type,
      })
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
    if (resourcePath && epubSupport?.getResourceFromItem) {
      const item = await readMetadata(itemId).catch(() => null)
      if (isEpubResourcePath(resourcePath, mediaUnitsForItem(item))) {
        return epubSupport.getResourceFromItem({ itemDir: itemPath(itemId), resourcePath })
      }
    }
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

  async function patchItemMetadata(itemId, patch = {}) {
    return updateMetadata(itemId, (item) => mergeItemPatch(item, patch))
  }

  async function patchUnitMetadata(itemId, unitId, patch = {}) {
    const safePatch = await validateUnitPatch(itemId, patch)
    let updatedUnit
    await updateMetadata(itemId, (item) => {
      const units = mediaUnitsForItem(item)
      const index = units.findIndex((unit) => unit.unitId === unitId)
      if (index < 0) throw new Error(`Unit not found: ${unitId}`)
      updatedUnit = mergeUnitPatch(units[index], safePatch)
      units[index] = updatedUnit
      return { ...item, mediaUnits: units, updatedAt: new Date().toISOString() }
    })
    return updatedUnit
  }

  async function validateUnitPatch(itemId, patch = {}) {
    const next = {}
    if (Array.isArray(patch.subtitles)) {
      next.subtitles = []
      for (const subtitle of patch.subtitles) {
        const normalized = normalizeSubtitle(subtitle)
        if (!normalized.relativePath) continue
        const filePath = safeManagedFilePath(itemId, normalized.relativePath)
        if (!await pathExists(filePath)) throw new Error(`Subtitle file not found: ${normalized.relativePath}`)
        next.subtitles.push({ ...normalized, url: subtitleResourceUrl(itemId, normalized.relativePath) })
      }
    }
    return next
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
    if (active) {
      if (force && !active.force) updateThumbnailJob(active, { force: true })
      return publicThumbnailJob(active)
    }
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
    const externalCover = await refreshExternalCover(itemId, { force }).catch((error) => ({
      status: 'failed',
      message: error.message,
    }))
    const item = await readMetadata(itemId)
    const jobs = []
    for (const unit of mediaUnitsForItem(item)) {
      if (!(unit.mediaKind === 'video' || unit.mediaKind === 'audio')) continue
      if (!force && unit.thumbnail?.status === 'ready') continue
      jobs.push(await enqueueThumbnail(itemId, unit.unitId, { force }))
    }
    return { queued: jobs, externalCover }
  }

  async function refreshExternalCover(itemId, { force = false } = {}) {
    const item = await readMetadata(itemId)
    if (item.sourceProfile !== 'rj-media' || !item.productId) {
      return { status: 'skipped', message: '不是 RJ 导入媒体' }
    }
    const options = rjImportOptions()
    if (!force && item.cover && item.dlsite?.cover) {
      return { status: 'skipped', message: 'DL 封面已存在', cover: item.cover }
    }
    const dlsite = await fetchRjImportDlsite(item.productId, { ...options, fetchDlsiteCover: true, fetchDlsiteTitle: true }).catch((error) => ({
      productId: item.productId,
      status: 'fetch_failed',
      error: error.message,
      fetchedAt: new Date().toISOString(),
    }))
    const cover = dlsite.cover ? await cacheExternalCover(itemId, dlsite.cover, { force }).catch(() => dlsite.cover || '') : ''
    let updated
    await updateMetadata(itemId, (current) => {
      updated = normalizeItem({
        ...current,
        dlsite: {
          ...(current.dlsite || {}),
          ...dlsite,
          productId: item.productId,
        },
        cover: cover || current.cover || '',
        updatedAt: new Date().toISOString(),
      })
      return updated
    })
    return {
      productId: dlsite.productId || item.productId,
      site: dlsite.site || '',
      status: dlsite.cover ? 'completed' : (dlsite.status || 'failed'),
      cover: cover || dlsite.cover || '',
      message: dlsite.cover ? 'DL 封面已更新' : (dlsite.error || '未获取到 DL 封面'),
      error: dlsite.error || '',
    }
  }

  async function cacheExternalCover(itemId, coverUrl, { force = false } = {}) {
    if (!coverUrl) return ''
    if (force) await moveThumbnailDirAside(itemId, ITEM_COVER_UNIT_ID)
    const existing = !force ? await existingThumbnailName(itemId, ITEM_COVER_UNIT_ID, 'cover') : ''
    if (existing) return thumbnailUrl(itemId, ITEM_COVER_UNIT_ID, 'cover')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const res = await fetch(coverUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; copymanga-rj-cover/1.0)',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      })
      const contentType = String(res.headers.get('content-type') || '').toLowerCase()
      if (!res.ok || !contentType.startsWith('image/')) return coverUrl
      const body = Buffer.from(await res.arrayBuffer())
      if (!body.length) return coverUrl
      const ext = imageExtensionFromContentType(contentType) || imageExtensionFromUrl(coverUrl) || 'jpg'
      await mkdir(thumbnailDir(itemId, ITEM_COVER_UNIT_ID), { recursive: true })
      await writeFile(thumbnailPath(itemId, ITEM_COVER_UNIT_ID, `cover.${ext}`), body)
      return thumbnailUrl(itemId, ITEM_COVER_UNIT_ID, 'cover')
    } finally {
      clearTimeout(timer)
    }
  }

  function imageExtensionFromContentType(contentType) {
    if (contentType.includes('webp')) return 'webp'
    if (contentType.includes('png')) return 'png'
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
    if (contentType.includes('gif')) return 'gif'
    return ''
  }

  function imageExtensionFromUrl(value) {
    const ext = path.extname(String(value || '').split('?')[0]).replace(/^\./, '').toLowerCase()
    return IMAGE_EXTENSIONS.includes(ext) ? ext : ''
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
          const scannedSubtitles = subtitlesByKey.get(subtitleKey(groupPathOf(unit.relativePath || unit.fileName), path.posix.basename(unit.relativePath || unit.fileName, path.posix.extname(unit.relativePath || unit.fileName)))) || []
          const subtitles = mergeSubtitles(unit.subtitles || [], scannedSubtitles)
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

  async function rescanMediaUnits(itemId) {
    if (!await pathExists(filesPath(itemId))) throw new Error(`Media files not found: ${itemId}`)
    let nextUnits = []
    const updated = await updateMetadata(itemId, async (item) => {
      const previousUnits = mediaUnitsForItem(item)
      nextUnits = mergePreviousUnitState(await scanMediaUnits(itemId, previousUnits), previousUnits)
      return {
        ...item,
        unitCount: nextUnits.length,
        mediaUnits: nextUnits.map((unit, index) => normalizeMediaUnit({ ...unit, index })),
        updatedAt: new Date().toISOString(),
      }
    })
    return { itemId, unitCount: nextUnits.length, units: mediaUnitsForItem(updated) }
  }

  function mergePreviousUnitState(units = [], previousUnits = []) {
    const previousById = new Map(previousUnits.map((unit) => [unit.unitId, unit]))
    const previousByPath = new Map(previousUnits.filter((unit) => unit.relativePath).map((unit) => [unit.relativePath, unit]))
    return units.map((unit) => {
      const previous = previousById.get(unit.unitId) || previousByPath.get(unit.relativePath)
      if (!previous) return normalizeMediaUnit(unit)
      return normalizeMediaUnit({
        ...unit,
        tags: previous.tags?.length ? previous.tags : unit.tags,
        thumbnail: previous.thumbnail?.status ? previous.thumbnail : unit.thumbnail,
        cover: previous.cover || unit.cover,
        createdAt: previous.createdAt || unit.createdAt,
      })
    })
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

  function rjImportOptions() {
    const raw = getConfig().mediaImportProfiles?.['rj-media'] || {}
    return {
      maxDepth: finiteNumber(raw.maxDepth, 6),
      idPattern: String(raw.idPattern || '(?:RJ|VJ|BJ|EJ)\\d{6,8}'),
      fetchDlsiteCover: raw.fetchDlsiteCover !== false,
      fetchDlsiteTitle: raw.fetchDlsiteTitle === true,
      dlsiteRequestMinIntervalMs: finiteNumber(raw.dlsiteRequestMinIntervalMs, 1500),
      dlsiteRequestJitterMs: finiteNumber(raw.dlsiteRequestJitterMs, 800),
    }
  }

  async function findRjImportRoots(source, options) {
    const roots = []
    let pattern
    try {
      pattern = new RegExp(`^(${options.idPattern})$`, 'i')
    } catch {
      pattern = /^((?:RJ|VJ|BJ|EJ)\d{6,8})$/i
    }
    async function visit(dir, depth) {
      const name = path.basename(dir)
      const match = pattern.exec(name)
      if (match) {
        roots.push({ path: dir, productId: match[1].toUpperCase() })
        return
      }
      if (depth >= options.maxDepth) return
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue
        await visit(path.join(dir, entry.name), depth + 1)
      }
    }
    await visit(source, 0)
    return roots
  }

  async function fetchRjImportDlsite(productId, options) {
    const result = {
      productId,
      originalProductId: '',
      status: 'skipped',
      site: '',
      originalSite: '',
      title: '',
      circle: '',
      cover: '',
      translation: null,
      fetchedAt: new Date().toISOString(),
    }
    if (!options.fetchDlsiteCover && !options.fetchDlsiteTitle) return result
    if (options.fetchDlsiteTitle) {
      Object.assign(result, await fetchDlsiteDetail(productId, options))
    }
    if (options.fetchDlsiteCover) {
      result.cover ||= await resolveDlsiteCover(productId, options)
    }
    const originalProductId = originalProductIdFromCover(result.cover, productId)
    if (originalProductId) {
      const original = await fetchDlsiteDetail(originalProductId, options).catch(() => ({}))
      if (original.title || original.circle || original.cover) {
        result.translation = {
          productId: result.productId,
          site: result.site,
          title: result.title,
          circle: result.circle,
          cover: result.cover,
        }
        result.originalProductId = originalProductId
        result.originalSite = original.site || ''
        result.title = original.title || result.title
        result.circle = original.circle || result.circle
        result.cover = original.cover || result.cover
      }
    }
    result.status = result.title || result.circle || result.cover ? 'found' : 'not_found'
    return result
  }

  async function fetchDlsiteDetail(productId, options) {
    const detail = await fetchDlsiteAjaxDetail(productId, options)
    if (!detail.title || !detail.circle) {
      const html = await fetchDlsiteHtmlDetail(productId, options).catch(() => ({}))
      return {
        ...detail,
        site: detail.site || html.site || '',
        title: detail.title || html.title || '',
        circle: detail.circle || html.circle || '',
      }
    }
    return detail
  }

  async function fetchDlsiteAjaxDetail(productId, options) {
    for (const site of dlsiteSites(productId)) {
      await sleep(Math.max(0, options.dlsiteRequestMinIntervalMs || 0) + Math.floor(Math.random() * Math.max(0, options.dlsiteRequestJitterMs || 0)))
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)
      try {
        const res = await fetch(`https://www.dlsite.com/${site}/product/info/ajax?product_id=${encodeURIComponent(productId)}`, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; copymanga-rj-import/1.0)',
            Accept: 'application/json,*/*;q=0.8',
            'Accept-Language': 'ja,en;q=0.8,zh-CN;q=0.7',
          },
        })
        if (!res.ok) continue
        const data = await res.json()
        const row = data?.[productId] || data?.[String(productId).toUpperCase()] || (Array.isArray(data) ? data[0] : null)
        if (!row || typeof row !== 'object') continue
        return {
          site,
          title: cleanText(row.work_name || row.title || row.name),
          circle: cleanText(row.maker_name || row.circle_name || row.brand_name || row.maker?.name),
          cover: normalizeDlsiteImageUrl(cleanText(row.image_main || row.image || row.image_url || row.work_image)),
        }
      } catch {
        // Try the next DLsite area; network metadata is best-effort for imports.
      } finally {
        clearTimeout(timer)
      }
    }
    return {}
  }

  async function fetchDlsiteHtmlDetail(productId, options) {
    for (const site of dlsiteSites(productId)) {
      await sleep(Math.max(0, options.dlsiteRequestMinIntervalMs || 0) + Math.floor(Math.random() * Math.max(0, options.dlsiteRequestJitterMs || 0)))
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)
      try {
        const res = await fetch(`https://www.dlsite.com/${site}/work/=/product_id/${encodeURIComponent(productId)}.html`, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; copymanga-rj-import/1.0)',
            Accept: 'text/html,*/*;q=0.8',
            'Accept-Language': 'ja,en;q=0.8,zh-CN;q=0.7',
          },
        })
        if (!res.ok) continue
        const html = await res.text()
        return {
          site,
          title: cleanText(matchText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)),
          circle: cleanText(matchText(html, /<li[^>]+class=["'][^"']*topicpath_item[^"']*["'][^>]*>\s*<a[^>]+\/circle\/profile\/=\/maker_id\/[^>]+>\s*<span>([\s\S]*?)<\/span>/i)),
        }
      } catch {
        // Try the next DLsite area.
      } finally {
        clearTimeout(timer)
      }
    }
    return {}
  }

  function dlsiteSites(productId) {
    const prefix = String(productId || '').slice(0, 2).toUpperCase()
    if (prefix === 'VJ') return ['pro', 'maniax']
    if (prefix === 'BJ') return ['books', 'maniax']
    return ['maniax', 'pro', 'books']
  }

  async function resolveDlsiteCover(productId, options) {
    for (const url of dlsiteCoverCandidates(productId)) {
      if (await imageUrlExists(url, options)) return url
    }
    return ''
  }

  function dlsiteCoverCandidates(productId) {
    const id = String(productId || '').toUpperCase()
    const match = /^(RJ|VJ|BJ|EJ)(\d{6,8})$/.exec(id)
    if (!match) return []
    const bucketNumber = String(Math.ceil(Number(match[2]) / 1000) * 1000).padStart(match[2].length, '0')
    const bucket = `${match[1]}${bucketNumber}`
    const categories = match[1] === 'VJ' ? ['professional', 'doujin'] : ['doujin', 'professional', 'books']
    return categories.flatMap((category) => [
      `https://img.dlsite.jp/modpub/images2/work/${category}/${bucket}/${id}_img_main.jpg`,
      `https://img.dlsite.jp/modpub/images2/work/${category}/${bucket}/${id}_img_sam.jpg`,
    ])
  }

  async function imageUrlExists(url, options) {
    await sleep(Math.max(0, options.dlsiteRequestMinIntervalMs || 0) + Math.floor(Math.random() * Math.max(0, options.dlsiteRequestJitterMs || 0)))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Range: 'bytes=0-2047',
          'User-Agent': 'Mozilla/5.0 (compatible; copymanga-rj-import/1.0)',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      })
      return res.ok && String(res.headers.get('content-type') || '').toLowerCase().startsWith('image/')
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  function cleanText(value) {
    return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  }

  function normalizeDlsiteImageUrl(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    if (text.startsWith('//')) return `https:${text}`
    if (/^https?:\/\//i.test(text)) return text
    if (text.startsWith('/')) return `https://www.dlsite.com${text}`
    return text
  }

  function originalProductIdFromCover(cover, productId) {
    const fileName = decodeURIComponent(String(cover || '').split(/[?#]/)[0].split('/').pop() || '')
    const match = /(?:^|[_-])((?:RJ|VJ|BJ|EJ)\d{6,8})(?=(?:[_-]|\.|$))/i.exec(fileName)
    const id = match ? match[1].toUpperCase() : ''
    return id && id !== String(productId || '').toUpperCase() ? id : ''
  }

  function matchText(text, re) {
    const match = re.exec(text || '')
    return match ? match[1] : ''
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

  async function scanMediaUnits(itemId, previousUnits = []) {
    if (!await pathExists(filesPath(itemId))) return []
    const allFiles = await walkFiles(filesPath(itemId))
    const subtitleFiles = allFiles.filter(isSubtitleName)
    const subtitlesByKey = subtitlesByMediaKey(itemId, subtitleFiles)
    const previousByPath = new Map((previousUnits || [])
      .filter((unit) => unit.relativePath)
      .map((unit) => [unit.relativePath, unit]))
    const files = allFiles
      .filter(isSupportedName)
      .sort((a, b) => relativePath(itemId, a).localeCompare(relativePath(itemId, b), undefined, { numeric: true }))
    if (type !== 'media') {
      return Promise.all(files.map((filePath) => unitFromFile({
        itemId,
        filePath,
        previous: previousByPath.get(relativePath(itemId, filePath)),
        subtitles: mergeSubtitles(previousByPath.get(relativePath(itemId, filePath))?.subtitles || [], subtitlesByKey.get(mediaSubtitleKey(itemId, filePath)) || []),
      })))
    }
    const units = []
    const matchedSubtitlePaths = new Set()
    const imagesByDir = new Map()
    const previousEpubUnits = new Map(previousUnits
      .filter((unit) => unit.mediaKind === 'epub' && unit.relativePath)
      .map((unit) => [unit.relativePath, unit]))
    const importedEpubUnits = []
    for (const filePath of files) {
      const kind = mediaKind(filePath)
      if (kind === 'image') {
        const dir = path.posix.dirname(relativePath(itemId, filePath))
        const key = dir === '.' ? '' : dir
        const list = imagesByDir.get(key) || []
        list.push(filePath)
        imagesByDir.set(key, list)
      } else if (kind === 'epub') {
        const unit = await epubUnitFromFile({
          itemId,
          filePath,
          previous: previousEpubUnits.get(relativePath(itemId, filePath)),
          existingUnits: [...units, ...importedEpubUnits],
        })
        importedEpubUnits.push(unit)
        units.push(unit)
      } else {
        const subtitles = subtitlesByKey.get(mediaSubtitleKey(itemId, filePath)) || []
        for (const subtitle of subtitles) matchedSubtitlePaths.add(subtitle.relativePath)
        units.push(await unitFromFile({
          itemId,
          filePath,
          previous: previousByPath.get(relativePath(itemId, filePath)),
          subtitles: mergeSubtitles(previousByPath.get(relativePath(itemId, filePath))?.subtitles || [], subtitles),
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
      } catch (error) {
        // 原本只有 try/finally：runThumbnailJob 自己包了 try/catch，但队列循环本身
        // （取任务、读 Map）一旦抛出就会逃逸成未处理拒绝，把整个进程带走。
        console.error(`[thumbnail-queue] 未捕获异常 ${error?.stack || error}`)
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
        await setUnitThumbnailReady(job.itemId, job.unitId, { status: 'ready', frameCount: unit.thumbnail?.frameCount || 0 }, { force: job.force })
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
      await setUnitThumbnailReady(job.itemId, job.unitId, result, { force: job.force })
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

  async function setUnitThumbnailReady(itemId, unitId, thumbnail, { force = false } = {}) {
    const nextThumbnail = normalizeThumbnail({
      status: thumbnail.status || 'ready',
      coverUrl: thumbnailUrl(itemId, unitId, 'cover'),
      previewUrl: thumbnailUrl(itemId, unitId, 'preview'),
      frameCount: thumbnail.frameCount || 0,
      generatedAt: new Date().toISOString(),
      error: '',
    })
    return updateMetadata(itemId, (item) => {
      const mediaUnits = mediaUnitsForItem(item).map((unit) => (
        unit.unitId === unitId
          ? normalizeMediaUnit({ ...unit, thumbnail: nextThumbnail })
          : unit
      ))
      const withThumbnail = normalizeItem({ ...item, mediaUnits })
      return normalizeItem({
        ...withThumbnail,
        cover: nextItemCoverAfterThumbnail(withThumbnail, { force }) || withThumbnail.cover || '',
        updatedAt: new Date().toISOString(),
      })
    })
  }

  function nextItemCoverAfterThumbnail(item, { force = false } = {}) {
    if (item.sourceProfile === 'rj-media') return item.cover || ''
    if (!force && item.cover && !isGeneratedThumbnailCover(item, item.cover)) return item.cover
    const readyUnits = mediaUnitsForItem(item).filter((unit) => unit.thumbnail?.status === 'ready' && unit.thumbnail?.coverUrl)
    return (
      readyUnits.find((unit) => unit.mediaKind === 'video')?.thumbnail?.coverUrl ||
      readyUnits.find((unit) => unit.mediaKind === 'audio')?.thumbnail?.coverUrl ||
      ''
    )
  }

  function isGeneratedThumbnailCover(item, cover) {
    const prefix = `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(item.itemId)}/thumbnail/`
    return String(cover || '').startsWith(prefix)
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

  // 合并掉的源条目整个搬进回收目录，等人工确认后再删。带时间戳是为了能看出
  // 什么时候合的；uniqueImportTarget 兜底同一秒内合并同名条目的情况。
  async function trashItemDir(itemId) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = await uniqueImportTarget(path.join(trashRoot, `${safeSegment(itemId)}-${stamp}`))
    await movePath(itemPath(itemId), target)
    // 缩略图挂在另一个根（cache/library-thumbnails）下，以前合并完谁也不清，
    // 永久变孤儿；一并归到同一个回收目录，人工清理时一次清干净。
    const thumbnails = path.join(thumbnailRoot, safeSegment(itemId))
    if (await pathExists(thumbnails)) await movePath(thumbnails, path.join(target, 'thumbnails'))
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

  async function unitFromFile({ itemId, filePath, previous = null, subtitles = [] }) {
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
      tags: previous?.tags?.length ? previous.tags : [kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片'],
      managedPath: filePath,
      streamPath: streamPathForManagedPath(filePath),
      streamUrl: streamUrlForPath(filePath),
      metaUrl: metaUrlForPath(filePath),
      size: info.size,
      contentType: contentType(filePath),
      subtitles,
      updatedAt: info.mtime.toISOString(),
      createdAt: previous?.createdAt || new Date().toISOString(),
    })
  }

  async function epubUnitFromFile({ itemId, filePath, previous = null, existingUnits = [] }) {
    if (!epubSupport?.importUnitIntoItem) throw new Error('EPUB support is not configured')
    const info = await stat(filePath)
    const fileName = relativePath(itemId, filePath)
    if (
      previous &&
      previous.size === info.size &&
      previous.updatedAt === info.mtime.toISOString() &&
      previous.sections?.length
    ) {
      return normalizeMediaUnit(previous)
    }
    const imported = await epubSupport.importUnitIntoItem({
      itemId,
      itemDir: itemPath(itemId),
      fileName,
      buffer: await readFile(filePath),
      existingUnits,
      type,
    })
    return normalizeMediaUnit({
      ...imported,
      type,
      mediaKind: 'epub',
      fileName,
      relativePath: fileName,
      groupPath: groupPathOf(fileName),
      tags: imported.tags?.length ? imported.tags : ['EPUB'],
      managedPath: filePath,
      size: info.size,
      contentType: contentType(filePath),
      updatedAt: info.mtime.toISOString(),
      createdAt: imported.createdAt || new Date().toISOString(),
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
        url: subtitleResourceUrl(itemId, relative),
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

  // 把若干条目合并成一个：源条目的文件搬进目标、重扫出 unit、源目录进回收站。
  // 没有拆分能力，所以 itemId 校验从严，宁可报错也不要走偏。文件本身留在
  // cache/library-trash 下可人工取回，但元数据（标题、tag、unit 标注）是真的没了。
  // 调用方负责清理 itemId 之外的状态（历史、tag 索引），那些不在本类型的职责里。
  async function mergeItems({ targetItemId, sourceItemIds = [] }) {
    const target = String(targetItemId || '').trim()
    if (!target) throw new Error('targetItemId is required')
    const sources = [...new Set(sourceItemIds.map((id) => String(id || '').trim()).filter(Boolean))]
      .filter((id) => id !== target)
    if (!sources.length) throw new Error('没有可合并的源条目')

    const targetMeta = await readMetadata(target)
    const moved = []
    const skipped = []
    for (const sourceId of sources) {
      let sourceMeta
      try {
        sourceMeta = await readMetadata(sourceId)
      } catch {
        skipped.push({ itemId: sourceId, reason: '读不到元数据' })
        continue
      }
      const files = await walkFiles(filesPath(sourceId))
      // 撞名不能逐文件改名：字幕是按「目录 + 文件名词干」挂到视频上的，
      // 视频被改成 01-2.mp4 而字幕还叫 01.srt，词干就对不上了——实测的结果是
      // B 的视频丢了字幕，而 A 的同名视频反而把 B 的字幕吃了过去，数据直接串台。
      // 所以只要有任何一个文件会撞，就把这个源条目整组搬进自己的子目录：
      // 组内的目录和词干关系完整保留，也绝不会和目标条目的文件混在一起。
      let collides = false
      for (const filePath of files) {
        if (await pathExists(path.join(filesPath(target), safeRelativePath(relativePath(sourceId, filePath))))) {
          collides = true
          break
        }
      }
      const prefix = collides ? safeSegment(sourceId) : ''
      for (const filePath of files) {
        const relative = relativePath(sourceId, filePath)
        // 加了前缀之后理论上不会再撞，uniqueImportTarget 只作最后兜底
        const to = await uniqueImportTarget(path.join(filesPath(target), prefix, safeRelativePath(relative)))
        await mkdir(path.dirname(to), { recursive: true })
        await movePath(filePath, to)
        moved.push({ from: `${sourceId}/${relative}`, to: relativePath(target, to) })
      }
      // 文件此时已经搬进目标了，回收这一步再抛就是半合并状态。而且 rm(force) 几乎
      // 不会失败、movePath 会（跨盘没有 mv、回收目录没写权限），所以这里只记不抛：
      // 失败就把源目录原样留着——它会以 0 单元的条目重新出现在候选里，可见且没删东西。
      let trashedTo = ''
      let trashError = ''
      try {
        trashedTo = await trashItemDir(sourceId)
      } catch (error) {
        trashError = error.message
      }
      skipped.push({ itemId: sourceId, reason: '', title: sourceMeta.title, files: files.length, isolatedInto: prefix, trashedTo, trashError })
    }

    const units = await scanMediaUnits(target, mediaUnitsForItem(targetMeta))
    units.sort(compareMediaUnits)
    const next = normalizeItem({
      ...targetMeta,
      cover: targetMeta.cover || units.find((unit) => unit.cover)?.cover || '',
      unitCount: units.length,
      mediaUnits: units.map((unit, index) => normalizeMediaUnit({ ...unit, index })),
      updatedAt: new Date().toISOString(),
    })
    await writeMetadata(target, next)
    return { item: next, moved, merged: skipped.filter((s) => !s.reason), skipped: skipped.filter((s) => s.reason) }
  }

  return {
    type,
    label,
    scanItems,
    importItem,
    mergeItems,
    getItem,
    listUnits,
    getReaderContent,
    getResource,
    getProgress,
    saveProgress,
    updateItemTags,
    updateUnitTags,
    patchItemMetadata,
    patchUnitMetadata,
    getThumbnail,
    enqueueThumbnail,
    enqueueThumbnails,
    refreshExternalCover,
    rescanMediaUnits,
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
    productId: String(item?.productId || ''),
    sourceProfile: String(item?.sourceProfile || ''),
    // 作品身份键，带来源命名空间（anidb:17344 / dlsite:RJ123456）。
    // 共享同一个 workKey 的条目属于同一部作品，是合并候选的唯一依据。
    // 和「系列」是不同层级：workKey 多对一（多条目合成一个），系列一对多。
    workKey: String(item?.workKey || ''),
    dlsite: item?.dlsite && typeof item.dlsite === 'object' ? {
      productId: String(item.dlsite.productId || item?.productId || ''),
      originalProductId: String(item.dlsite.originalProductId || ''),
      status: String(item.dlsite.status || ''),
      site: String(item.dlsite.site || ''),
      originalSite: String(item.dlsite.originalSite || ''),
      title: String(item.dlsite.title || ''),
      circle: String(item.dlsite.circle || ''),
      cover: String(item.dlsite.cover || ''),
      releaseDate: String(item.dlsite.releaseDate || ''),
      translation: item.dlsite.translation && typeof item.dlsite.translation === 'object' ? {
        productId: String(item.dlsite.translation.productId || ''),
        site: String(item.dlsite.translation.site || ''),
        title: String(item.dlsite.translation.title || ''),
        circle: String(item.dlsite.translation.circle || ''),
        cover: String(item.dlsite.translation.cover || ''),
        releaseDate: String(item.dlsite.translation.releaseDate || ''),
      } : null,
      error: String(item.dlsite.error || ''),
      fetchedAt: String(item.dlsite.fetchedAt || ''),
    } : null,
    unitCount: Number(item?.unitCount || mediaUnits.length || 0),
    mediaUnits,
    createdAt: String(item?.createdAt || ''),
    publishedAt: String(item?.publishedAt || item?.createdAt || item?.updatedAt || ''),
    updatedAt: String(item?.updatedAt || new Date().toISOString()),
  }
}

function mergeItemPatch(item, patch = {}) {
  const next = { ...item }
  // workKey 是合并候选的依据，脚本可以改写（anidb-v1 的 force 开关就靠这个），
  // 传空字符串表示显式清除分组。
  if (patch.workKey !== undefined) next.workKey = String(patch.workKey || '')
  const publishedAt = normalizePublishedAt(patch.publishedAt)
  if (publishedAt) next.publishedAt = publishedAt
  if (patch.dlsite && typeof patch.dlsite === 'object') {
    const current = item.dlsite && typeof item.dlsite === 'object' ? item.dlsite : {}
    const dlsite = { ...current }
    for (const key of ['productId', 'originalProductId', 'status', 'site', 'originalSite', 'title', 'circle', 'cover', 'releaseDate', 'error', 'fetchedAt']) {
      if (patch.dlsite[key] !== undefined) dlsite[key] = String(patch.dlsite[key] || '')
    }
    if (patch.dlsite.translation && typeof patch.dlsite.translation === 'object') {
      const currentTranslation = current.translation && typeof current.translation === 'object' ? current.translation : {}
      dlsite.translation = { ...currentTranslation }
      for (const key of ['productId', 'site', 'title', 'circle', 'cover', 'releaseDate']) {
        if (patch.dlsite.translation[key] !== undefined) dlsite.translation[key] = String(patch.dlsite.translation[key] || '')
      }
    }
    next.dlsite = dlsite
  }
  return { ...next, updatedAt: new Date().toISOString() }
}

function mergeUnitPatch(unit, patch = {}) {
  const next = { ...unit }
  if (Array.isArray(patch.subtitles)) {
    const subtitles = []
    const seen = new Set()
    for (const subtitle of [...patch.subtitles, ...(unit.subtitles || [])]) {
      const normalized = normalizeSubtitle(subtitle)
      if (!normalized.relativePath) continue
      const key = normalized.relativePath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      subtitles.push(normalized)
    }
    next.subtitles = subtitles
  }
  return normalizeMediaUnit({ ...next, updatedAt: new Date().toISOString() })
}

function normalizePublishedAt(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''
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
    cover: String(unit?.cover || ''),
    managedPath: String(unit?.managedPath || ''),
    streamPath: String(unit?.streamPath || ''),
    streamUrl: String(unit?.streamUrl || ''),
    metaUrl: String(unit?.metaUrl || ''),
    size: Number(unit?.size || 0),
    contentType: String(unit?.contentType || ''),
    imageCount: Number(unit?.imageCount || 0),
    images: Array.isArray(unit?.images) ? unit.images : [],
    sectionCount: Number(unit?.sectionCount || 0),
    chapterCount: Number(unit?.chapterCount || 0),
    sections: Array.isArray(unit?.sections) ? unit.sections : [],
    imageResources: Array.isArray(unit?.imageResources) ? unit.imageResources : [],
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

function mergeSubtitles(current = [], incoming = []) {
  const result = []
  const seen = new Set()
  for (const subtitle of [...current, ...incoming]) {
    const normalized = normalizeSubtitle(subtitle)
    if (!normalized.relativePath) continue
    const key = normalized.relativePath.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
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
  if (EPUB_EXTENSIONS.includes(ext)) return 'epub'
  return 'unknown'
}

function isEpubResourcePath(resourcePath, units = []) {
  const firstSegment = normalizeZipPath(resourcePath).split('/')[0]
  return Boolean(firstSegment && units.some((unit) => unit.mediaKind === 'epub' && unit.unitId === firstSegment))
}

function normalizeZipPath(value) {
  const parts = String(value || '').replace(/\\/g, '/').split('/')
  const out = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
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

function finiteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
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
  if (['epub'].includes(ext)) return 'application/epub+zip'
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
