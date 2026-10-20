// 压缩包图集：一个压缩包（现在只有 zip）就是一个条目，一个条目一个「图集」单元。
// 和「媒体」类型分开写成独立的库类型，不碰媒体处理里那套以 files/ 目录为中心的逻辑：
//   - 元数据：<data>/library-meta/archive/ab/cd/<id>.json（分片，和老的 metadata.json 完全分开）
//   - 压缩包：新导入的 mv 到 <导入方案 JSON 里的 managedDir>/ab/cd/<id>.zip；
//             迁移（LANraragi）的只读挂载，原地引用（zip.external = true），我们永远不改、不删它
//   - 阅读：第一次打开才解压到 <archiveCacheDir>/ab/cd/<id>/pages/，有缓存就直接用；缓存目录的淘汰由部署方自己管
//   - 封面：<data>/cache/library-thumbnails/archive/ab/cd/<id>.jpg
// 条目 id = 文件前 512000 字节的 SHA-1（和 LANraragi 的档案 ID 同一算法）：同一个压缩包重复导入自动去重，
// 迁移过来的和新导入的 id 体系一致。

import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { withFileLock } from '../atomic-json-store.mjs'
import { shardedPath, shardOf, walkShardedFiles, writeJsonAtomic } from '../meta-shard.mjs'
import { parseTags } from '../tag-store.mjs'
import { comparePageNames, extensionOf, IMAGE_EXTENSIONS, openZip } from '../zip-reader.mjs'

const execFileAsync = promisify(execFile)

export const ARCHIVE_TYPE = 'archive'
export const ARCHIVE_PROFILE = 'archive-gallery'
export const LRR_INIT_PROFILE = 'lrr-init'
export const ARCHIVE_UNIT_ID = 'zip'
const ARCHIVE_EXTENSIONS = new Set(['zip', 'cbz'])
const ID_SAMPLE_BYTES = 512000
const MAX_CONCURRENT_EXTRACTIONS = 4

// zip 里文件名的编码：导入方案的 JSON 配置（zipFilenameEncoding）会写进每个条目，读取时按条目自己的来；
// 条目没记（老数据）时才退回环境变量 ZIP_FILENAME_ENCODING，再退回 utf-8。
const ENCODING = String(process.env.ZIP_FILENAME_ENCODING || 'utf-8').trim().toLowerCase()
const encodingOf = (item) => String(item?.zip?.filenameEncoding || ENCODING).trim().toLowerCase()

export async function computeArchiveId(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(ID_SAMPLE_BYTES)
    let done = 0
    while (done < ID_SAMPLE_BYTES) {
      const { bytesRead } = await handle.read(buf, done, ID_SAMPLE_BYTES - done, done)
      if (!bytesRead) break
      done += bytesRead
    }
    if (!done) throw new Error('空文件')
    return createHash('sha1').update(buf.subarray(0, done)).digest('hex')
  } finally {
    await handle.close()
  }
}

export function isArchiveFileName(name) {
  return ARCHIVE_EXTENSIONS.has(extensionOf(name))
}

export function createArchiveGalleryHandler({ type = ARCHIVE_TYPE, dataDir, safeSegment, pathExists, getConfig }) {
  const metaRoot = path.join(dataDir, 'library-meta', type)
  const thumbRoot = path.join(dataDir, 'cache', 'library-thumbnails', type)
  const progressRoot = path.join(dataDir, 'cache', 'library', 'reading-progress', type)
  const extractions = new Map()    // itemId -> Promise，同一个包的并发请求合并成一次解压
  let activeExtractions = 0
  const extractionWaiters = []

  const cfg = () => getConfig()
  // 新导入压缩包的存放目录来自「压缩包图集」导入方案的 JSON（managedDir）；本次路径导入用提交时带来的，上传用已保存的
  const managedRoot = (override = '') => path.resolve(override || cfg().mediaImportProfiles?.['archive-gallery']?.managedDir)
  const cacheRoot = () => path.resolve(cfg().archiveCacheDir)

  function assertId(itemId) {
    const id = String(itemId || '')
    if (!id || id !== safeSegment(id)) throw new Error(`无效的条目 id：${id}`)
    return id
  }

  const metaPath = (itemId) => shardedPath(metaRoot, assertId(itemId))
  const thumbPath = (itemId) => shardedPath(thumbRoot, assertId(itemId), '.jpg')
  const progressPath = (itemId) => shardedPath(progressRoot, assertId(itemId))
  const managedZipPath = (itemId, root = '') => shardedPath(managedRoot(root), assertId(itemId), '.zip')
  function cacheDirFor(itemId) {
    const [a, b] = shardOf(assertId(itemId))
    return path.join(cacheRoot(), a, b, itemId)
  }
  const thumbnailUrl = (itemId) => `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/thumbnail/${ARCHIVE_UNIT_ID}/cover`

  // ---------- 元数据 ----------

  function normalizeUnit(unit, item) {
    return {
      type,
      unitId: ARCHIVE_UNIT_ID,
      title: String(unit?.title || item.title || item.itemId),
      fileName: String(unit?.fileName || item.fileName || ''),
      relativePath: String(unit?.relativePath || unit?.fileName || item.fileName || ''),
      mediaKind: 'image-gallery',
      imageCount: Number(unit?.imageCount ?? item.pageCount ?? 0),
      size: Number(unit?.size ?? item.zip?.size ?? 0),
      tags: parseTags(unit?.tags || []),
      index: 0,
      createdAt: String(unit?.createdAt || item.createdAt || ''),
      updatedAt: String(unit?.updatedAt || item.updatedAt || ''),
    }
  }

  function normalizeItem(raw) {
    const now = new Date().toISOString()
    const item = {
      type,
      itemId: String(raw?.itemId || ''),
      title: String(raw?.title || raw?.itemId || 'Untitled'),
      author: Array.isArray(raw?.author) ? raw.author : [],
      tags: parseTags(raw?.tags || []),
      cover: String(raw?.cover || ''),
      productId: '',
      sourceProfile: String(raw?.sourceProfile || ARCHIVE_PROFILE),
      workKey: String(raw?.workKey || ''),
      dlsite: null,
      fileName: String(raw?.fileName || ''),
      pageCount: Number(raw?.pageCount || 0),
      zip: {
        path: String(raw?.zip?.path || ''),
        external: Boolean(raw?.zip?.external),
        size: Number(raw?.zip?.size || 0),
        mtimeMs: Number(raw?.zip?.mtimeMs || 0),
        filenameEncoding: String(raw?.zip?.filenameEncoding || ''),
      },
      origin: raw?.origin && typeof raw.origin === 'object' ? raw.origin : null,
      createdAt: String(raw?.createdAt || now),
      publishedAt: String(raw?.publishedAt || raw?.createdAt || now),
      updatedAt: String(raw?.updatedAt || now),
    }
    const unit = normalizeUnit(Array.isArray(raw?.mediaUnits) ? raw.mediaUnits[0] : null, item)
    item.mediaUnits = [unit]
    item.unitCount = 1
    return item
  }

  function buildItem({ itemId, title, tags = [], zipPath, external, size, mtimeMs, pageCount = 0, sourceProfile = ARCHIVE_PROFILE, origin = null, createdAt = '', cover = '', filenameEncoding = '' }) {
    const now = new Date().toISOString()
    return normalizeItem({
      itemId,
      title: String(title || '').normalize('NFC') || itemId,
      tags,
      cover,
      sourceProfile,
      fileName: path.basename(zipPath),
      pageCount,
      zip: { path: zipPath, external, size, mtimeMs, filenameEncoding },
      origin,
      createdAt: createdAt || now,
      updatedAt: now,
    })
  }

  async function readItem(itemId) {
    return normalizeItem(JSON.parse(await readFile(metaPath(itemId), 'utf8')))
  }

  async function itemExists(itemId) {
    return pathExists(metaPath(itemId))
  }

  async function writeItem(item) {
    const normalized = normalizeItem(item)
    await withFileLock(metaPath(normalized.itemId), () => writeJsonAtomic(metaPath(normalized.itemId), normalized))
    return normalized
  }

  async function updateItem(itemId, mutate) {
    const file = metaPath(itemId)
    return withFileLock(file, async () => {
      const current = normalizeItem(JSON.parse(await readFile(file, 'utf8')))
      const next = normalizeItem(await mutate(current))
      await writeJsonAtomic(file, next)
      return next
    })
  }

  async function scanItems() {
    const items = []
    const pending = new Set()
    const read = async (file) => {
      try {
        items.push(normalizeItem(JSON.parse(await readFile(file, 'utf8'))))
      } catch {
        // 单个损坏的元数据不应该让整个列表消失
      }
    }
    for await (const file of walkShardedFiles(metaRoot)) {
      const task = read(file).finally(() => pending.delete(task))
      pending.add(task)
      if (pending.size >= 64) await Promise.race(pending)
    }
    await Promise.all(pending)
    return items
  }

  const getItem = (itemId) => readItem(itemId)
  async function listUnits(itemId) {
    return (await readItem(itemId)).mediaUnits
  }

  // ---------- 解压到缓存 ----------

  async function withExtractionSlot(work) {
    if (activeExtractions >= MAX_CONCURRENT_EXTRACTIONS) {
      await new Promise((resolve) => extractionWaiters.push(resolve))
    }
    activeExtractions += 1
    try {
      return await work()
    } finally {
      activeExtractions -= 1
      extractionWaiters.shift()?.()
    }
  }

  async function zipStamp(item) {
    const info = await stat(item.zip.path)
    return { size: info.size, mtimeMs: Math.floor(info.mtimeMs) }
  }

  async function readCachedPages(dir, stamp) {
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, 'pages.json'), 'utf8'))
      if (manifest.size === stamp.size && manifest.mtimeMs === stamp.mtimeMs && Array.isArray(manifest.pages)) return manifest.pages
    } catch {
      // 没有或损坏，按没缓存处理
    }
    return null
  }

  function ensureExtracted(itemId) {
    const running = extractions.get(itemId)
    if (running) return running
    const task = withExtractionSlot(() => extractItem(itemId)).finally(() => extractions.delete(itemId))
    extractions.set(itemId, task)
    return task
  }

  async function extractItem(itemId) {
    const item = await readItem(itemId)
    const zipFile = item.zip.path
    if (!zipFile || !await pathExists(zipFile)) throw new Error(`压缩包不存在：${zipFile || '(未记录路径)'}`)
    const stamp = await zipStamp(item)
    const dir = cacheDirFor(itemId)
    const cached = await readCachedPages(dir, stamp)
    if (cached) return { dir, pages: cached }
    // 先解到同级临时目录，pages.json 最后写，整体 rename 成最终目录：并发读到的要么是完整缓存、要么没有
    await mkdir(path.dirname(dir), { recursive: true })
    const temp = await mkdtemp(path.join(path.dirname(dir), `.${itemId}.tmp-`))
    try {
      const pages = await extractPages(zipFile, path.join(temp, 'pages'), encodingOf(item))
      await writeFile(path.join(temp, 'pages.json'), JSON.stringify({ size: stamp.size, mtimeMs: stamp.mtimeMs, pages }))
      await rm(dir, { recursive: true, force: true })
      await rename(temp, dir)
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    const pages = await readCachedPages(dir, stamp)
    return { dir, pages: pages || [] }
  }

  // 页面一律改名成 000001.jpg 这种顺序名：压缩包里的原始文件名编码、特殊字符、目录层级都不再影响读取，
  // 原名只作为标题记在 pages.json 里
  async function extractPages(zipFile, pagesDir, encoding) {
    await mkdir(pagesDir, { recursive: true })
    try {
      const zip = await openZip(zipFile, { filenameEncoding: encoding })
      try {
        const entries = zip.imageEntries()
        if (!entries.length) throw new Error('压缩包里没有图片')
        const width = Math.max(6, String(entries.length).length)
        const pages = []
        for (let i = 0; i < entries.length; i++) {
          const ext = extensionOf(entries[i].name)
          const file = `${String(i + 1).padStart(width, '0')}.${ext}`
              await writeFile(path.join(pagesDir, file), await zip.read(entries[i]))
          pages.push({ file, title: entries[i].name.split('/').pop() })
        }
        return pages
      } finally {
        await zip.close()
      }
    } catch (error) {
      if (!/不支持|加密|损坏|不是有效/.test(error.message)) throw error
      return extractPagesWithUnar(zipFile, pagesDir)
    }
  }

  // 自带 reader 读不了（加密、少见压缩方式）时退回 unar
  async function extractPagesWithUnar(zipFile, pagesDir) {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'archive-unar-'))
    try {
      await execFileAsync('unar', ['-quiet', '-no-directory', '-force-overwrite', '-o', temp, zipFile], { timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 })
      const files = []
      const walk = async (dir, prefix) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel)
          else if (IMAGE_EXTENSIONS.has(extensionOf(entry.name))) files.push(rel)
        }
      }
      await walk(temp, '')
      files.sort(comparePageNames)
      if (!files.length) throw new Error('压缩包里没有图片')
      const width = Math.max(6, String(files.length).length)
      const pages = []
      for (let i = 0; i < files.length; i++) {
        const file = `${String(i + 1).padStart(width, '0')}.${extensionOf(files[i])}`
        await copyFile(path.join(temp, ...files[i].split('/')), path.join(pagesDir, file))
        pages.push({ file, title: files[i].split('/').pop() })
      }
      return pages
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => {})
    }
  }

  // ---------- 阅读 ----------

  const publicItem = (item) => {
    const { mediaUnits, ...rest } = item
    return rest
  }

  async function getReaderContent(itemId, unitId) {
    const item = await readItem(itemId)
    if (unitId && unitId !== ARCHIVE_UNIT_ID) throw new Error(`Unit not found: ${unitId}`)
    const { pages } = await ensureExtracted(itemId)
    if (pages.length !== item.pageCount) {
      // 页数以压缩包实际内容为准（迁移带来的 pagecount 可能是 0 或旧值）
      updateItem(itemId, (current) => ({ ...current, pageCount: pages.length, mediaUnits: [{ ...current.mediaUnits[0], imageCount: pages.length }] })).catch(() => {})
      item.pageCount = pages.length
      item.mediaUnits[0].imageCount = pages.length
    }
    const unit = item.mediaUnits[0]
    return {
      type: 'images',
      item: publicItem(item),
      unit,
      sections: [],
      section: null,
      navigation: { prev: null, next: null },
      images: pages.map((page, index) => ({
        index,
        title: page.title,
        url: `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/resource?path=${encodeURIComponent(`pages/${page.file}`)}`,
      })),
    }
  }

  async function getResource(itemId, resourcePath) {
    const normalized = String(resourcePath || '').replace(/^[/\\]+/, '')
    if (!/^pages\/[^/\\]+$/.test(normalized)) throw new Error('resource path is outside archive item')
    const { dir } = await ensureExtracted(itemId)
    return {
      body: await readFile(path.join(dir, normalized)),
      contentType: imageContentType(normalized),
    }
  }

  // ---------- 封面 ----------

  async function getThumbnail(itemId) {
    try {
      return { body: await readFile(thumbPath(itemId)), contentType: 'image/jpeg' }
    } catch {
      throw new Error('缩略图不存在')
    }
  }

  async function hasCover(itemId) {
    return pathExists(thumbPath(itemId))
  }

  async function setCoverFromBuffer(itemId, buffer) {
    const target = thumbPath(itemId)
    await mkdir(path.dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    await writeFile(temp, buffer)
    await rename(temp, target)
  }

  // 迁移用：直接复制 LANraragi 已经生成好的缩略图
  async function copyCoverFile(itemId, sourceFile) {
    const target = thumbPath(itemId)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(sourceFile, target)
  }

  async function markItemCover(itemId) {
    return updateItem(itemId, (item) => ({ ...item, cover: thumbnailUrl(itemId) }))
  }

  // 从压缩包的第一张图生成封面：只读中央目录和这一张图，不解压整个包
  async function generateCover(itemId, { force = false } = {}) {
    if (!force && await hasCover(itemId)) return { status: 'exists' }
    const item = await readItem(itemId)
    const zip = await openZip(item.zip.path, { filenameEncoding: encodingOf(item) })
    let first
    try {
      const entries = zip.imageEntries()
      if (!entries.length) throw new Error('压缩包里没有图片')
      first = await zip.read(entries[0])
    } finally {
      await zip.close()
    }
    await setCoverFromBuffer(itemId, await resizeToJpeg(first))
    await markItemCover(itemId)
    return { status: 'created' }
  }

  async function resizeToJpeg(buffer) {
    const errors = []
    for (const command of ['magick', 'convert']) {
      try {
        return await new Promise((resolve, reject) => {
          const child = spawn(command, ['-', '-auto-orient', '-resize', '360x>', '-quality', '82', 'jpg:-'])
          const chunks = []
          const errChunks = []
          child.stdout.on('data', (chunk) => chunks.push(chunk))
          child.stderr.on('data', (chunk) => errChunks.push(chunk))
          child.on('error', reject)
          child.on('close', (code) => code === 0 && chunks.length
            ? resolve(Buffer.concat(chunks))
            : reject(new Error(Buffer.concat(errChunks).toString().slice(0, 300) || `exit ${code}`)))
          child.stdin.on('error', () => {})
          child.stdin.end(buffer)
        })
      } catch (error) {
        errors.push(`${command}: ${error.message}`)
      }
    }
    throw new Error(`缩略图编码失败：${errors.join('；')}`)
  }

  // 给标签脚本用：页数和文件名（不解压）。用完必须 close()。
  async function inspect(itemId) {
    const item = await readItem(itemId)
    const zip = await openZip(item.zip.path, { filenameEncoding: encodingOf(item) })
    const entries = zip.imageEntries()
    return {
      item,
      pageCount: entries.length,
      names: entries.map((entry) => entry.name),
      allNames: zip.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name),
      readText: async (name) => {
        const entry = zip.entries.find((candidate) => candidate.name === name)
        return entry ? (await zip.read(entry)).toString('utf8') : null
      },
      close: () => zip.close(),
    }
  }

  // ---------- 标签 / 补丁 / 进度 ----------

  const updateItemTags = (itemId, tags = []) => updateItem(itemId, (item) => ({ ...item, tags: parseTags(tags), updatedAt: new Date().toISOString() }))

  async function updateUnitTags(itemId, unitId, tags = []) {
    if (unitId !== ARCHIVE_UNIT_ID) throw new Error(`Unit not found: ${unitId}`)
    const next = await updateItem(itemId, (item) => ({
      ...item,
      mediaUnits: [{ ...item.mediaUnits[0], tags: parseTags(tags) }],
      updatedAt: new Date().toISOString(),
    }))
    return next.mediaUnits[0]
  }

  function patchItemMetadata(itemId, patch = {}) {
    return updateItem(itemId, (item) => {
      const next = { ...item }
      if (patch.workKey !== undefined) next.workKey = String(patch.workKey || '')
      if (patch.title !== undefined && String(patch.title || '').trim()) next.title = String(patch.title).trim()
      const published = Date.parse(String(patch.publishedAt || ''))
      if (Number.isFinite(published)) next.publishedAt = new Date(published).toISOString()
      return { ...next, updatedAt: new Date().toISOString() }
    })
  }

  async function patchUnitMetadata(itemId, unitId) {
    return (await readItem(itemId)).mediaUnits.find((unit) => unit.unitId === unitId)
  }

  const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0))

  function normalizeProgress(value, itemId) {
    return {
      itemId,
      lastUnitId: String(value?.lastUnitId || ''),
      lastScrollRatio: clamp(value?.lastScrollRatio || 0),
      readUnits: value?.readUnits && typeof value.readUnits === 'object' ? value.readUnits : {},
      updatedAt: String(value?.updatedAt || ''),
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
      current.lastScrollRatio = clamp(patch.scrollRatio ?? patch.lastScrollRatio ?? current.lastScrollRatio)
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
    await writeJsonAtomic(progressPath(itemId), current)
    return current
  }

  // ---------- 导入 ----------

  async function movePath(source, target) {
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await rename(source, target)
    } catch (error) {
      if (error.code !== 'EXDEV') throw error
      await execFileAsync('mv', [source, target])
    }
  }

  function sourceRoots() {
    return String(cfg().mediaImportSourceRoots || '').split(',').map((item) => item.trim()).filter(Boolean)
  }

  function assertAllowedSource(source) {
    const roots = sourceRoots().map((root) => path.resolve(root))
    if (!roots.length) throw new Error('未配置媒体导入来源目录')
    if (!roots.some((root) => source === root || source.startsWith(`${root}${path.sep}`))) {
      throw new Error(`导入路径不在允许目录内：${source}`)
    }
  }

  async function* walkArchives(source) {
    const info = await stat(source)
    if (info.isFile()) {
      if (isArchiveFileName(source)) yield source
      return
    }
    const stack = [source]
    while (stack.length) {
      const dir = stack.pop()
      let entries = []
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile() && isArchiveFileName(entry.name)) yield full
      }
    }
  }

  async function pageCountOf(zipFile, encoding = ENCODING) {
    const zip = await openZip(zipFile, { filenameEncoding: encoding })
    try {
      return zip.imageEntries().length
    } finally {
      await zip.close()
    }
  }

  // 从目录（或单个压缩包）导入：每个压缩包 mv 进受管目录并建一个条目。
  // onItems(batch) 每攒一批调用一次（服务端用它批量写标签库）；返回统计。
  // options：limit（最多新导入几个，0 = 不限）、dryRun（只统计，不 mv、不写）、zipFilenameEncoding（写进条目，读取时用）
  async function importFromSource({ sourcePath, tags = [], profile = ARCHIVE_PROFILE, options = {}, onItems = null, onProgress = null, shouldStop = () => false }) {
    const limit = Math.max(0, Number(options.limit) || 0)
    const dryRun = Boolean(options.dryRun)
    const encoding = String(options.zipFilenameEncoding || ENCODING).trim().toLowerCase()
    const source = path.resolve(String(sourcePath || ''))
    assertAllowedSource(source)
    const stats = { scanned: 0, imported: 0, skipped: 0, failed: 0, errors: [], dryRun, limit, limited: false }
    let batch = []
    const flush = async () => {
      if (!batch.length) return
      const items = batch
      batch = []
      await onItems?.(items)
    }
    for await (const file of walkArchives(source)) {
      if (shouldStop()) break
      if (limit && stats.imported >= limit) { stats.limited = true; break }
      stats.scanned += 1
      try {
        const itemId = await computeArchiveId(file)
        if (await itemExists(itemId)) {
          stats.skipped += 1
        } else if (dryRun) {
          stats.imported += 1   // 试运行里表示「将会导入」
        } else {
          const info = await stat(file)
          const pageCount = await pageCountOf(file, encoding)
          const target = managedZipPath(itemId, options.managedDir)
          await movePath(file, target)
          const moved = await stat(target)
          const item = await writeItem(buildItem({
            itemId,
            title: path.basename(file, path.extname(file)),
            tags: parseTags(tags),
            zipPath: target,
            external: false,
            size: info.size,
            mtimeMs: Math.floor(moved.mtimeMs),
            pageCount,
            sourceProfile: profile,
            filenameEncoding: encoding,
          }))
          batch.push(item)
          stats.imported += 1
        }
      } catch (error) {
        stats.failed += 1
        if (stats.errors.length < 50) stats.errors.push({ file, error: error.message })
      }
      if (batch.length >= 200) await flush()
      if (stats.scanned % 100 === 0) onProgress?.({ ...stats })
    }
    await flush()
    onProgress?.({ ...stats })
    return stats
  }

  // 浏览器上传的压缩包：落到临时文件再走同一条 mv 流程
  async function importUpload({ files = [], tags = [], profile = ARCHIVE_PROFILE }) {
    const items = []
    for (const file of files) {
      if (!file.buffer?.length) continue
      if (!isArchiveFileName(file.filename || '')) throw new Error(`只支持 zip 压缩包：${file.filename}`)
      const temp = await mkdtemp(path.join(os.tmpdir(), 'archive-upload-'))
      try {
        const tempFile = path.join(temp, path.basename(file.filename))
          await writeFile(tempFile, file.buffer)
        const itemId = await computeArchiveId(tempFile)
        if (await itemExists(itemId)) {
          items.push(await readItem(itemId))
          continue
        }
        const info = await stat(tempFile)
        const encoding = String(cfg().mediaImportProfiles?.['archive-gallery']?.zipFilenameEncoding || ENCODING).trim().toLowerCase()
        const pageCount = await pageCountOf(tempFile, encoding)
        const target = managedZipPath(itemId)
        await movePath(tempFile, target)
        const moved = await stat(target)
        items.push(await writeItem(buildItem({
          itemId,
          title: path.basename(file.filename, path.extname(file.filename)),
          tags: parseTags(tags),
          zipPath: target,
          external: false,
          size: info.size,
          mtimeMs: Math.floor(moved.mtimeMs),
          pageCount,
          sourceProfile: profile,
          filenameEncoding: encoding,
        })))
      } finally {
        await rm(temp, { recursive: true, force: true }).catch(() => {})
      }
    }
    return { items }
  }

  return {
    type,
    label: '压缩包图集',
    scanItems,
    getItem,
    listUnits,
    getReaderContent,
    getResource,
    getThumbnail,
    getProgress,
    saveProgress,
    updateItemTags,
    updateUnitTags,
    patchItemMetadata,
    patchUnitMetadata,
    importItem: async ({ files = [], fields = {} }) => {
      if (String(fields.sourcePath || '').trim()) throw new Error('压缩包图集的路径导入是后台任务，请走 /api/archive-gallery/import')
      return importUpload({ files, tags: parseTags(fields.tags || ''), profile: String(fields.importProfile || ARCHIVE_PROFILE) })
    },
    importFromSource,
    // 给迁移和标签脚本用的内部接口
    internals: {
      buildItem,
      writeItem,
      readItem,
      updateItem,
      itemExists,
      hasCover,
      copyCoverFile,
      markItemCover,
      generateCover,
      inspect,
      thumbnailUrl,
      ensureExtracted,
      paths: { metaPath, thumbPath, cacheDirFor, managedZipPath },
    },
  }
}

function imageContentType(name) {
  const ext = extensionOf(name)
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif' || ext === 'jpe') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'bmp') return 'image/bmp'
  return 'application/octet-stream'
}
