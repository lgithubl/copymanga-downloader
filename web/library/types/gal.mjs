// Gal（视觉小说 / 剧情脚本）：一个作品目录 = 一个条目，目录里每个剧情脚本 = 一个单元（章节）。
// 和别的库类型的区别：目录本身就是数据，不 mv、不拷贝、不改——导入只是给它建一份元数据 JSON；
// 阅读时现读脚本 → 适配器转成规范场景（web/library/gal/scene.mjs）→ 前端播放器渲染。场景不落地、不缓存。
//   - 根目录：「Gal 导入」方案 JSON 里的 rootDir（默认 <data>/gal），下面每个子目录是一个作品
//   - 元数据：<data>/library-meta/gal/ab/cd/<id>.json（分片）；条目 id = sha1('gal:' + 作品目录名)，重复导入原地更新
//   - 脚本：作品目录下（深度 ≤ maxDepth）扩展名在 scriptExtensions 里、且被某个适配器认得的文件；一个文件一个单元
//   - 资源：脚本里的相对路径（如 download/bg/x.jpg）先按作品目录解析；找不到再去掉 layout.stripPrefixes 里的前缀重试，
//     再找 rootDir 下的共享资源（layout.sharedRoot）。目录结构还没定死，这些约定都写在元数据 layout 里，改约定只改这里
//   - 封面：脚本里出现的第一张背景图（导入时挑，存 coverPath；取的时候原样返回，不缩放）

import { createHash } from 'node:crypto'
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from '../atomic-json-store.mjs'
import { galAdapterIds, sniffGalAdapter } from '../gal/adapters/index.mjs'
import { buildScene, firstBackgroundSrc } from '../gal/scene.mjs'
import { shardedPath, walkShardedFiles, writeJsonAtomic } from '../meta-shard.mjs'
import { parseTags } from '../tag-store.mjs'
import { decodeTextFile } from '../text-decode.mjs'

export const GAL_TYPE = 'gal'
export const GAL_PROFILE = 'gal-import'

export const GAL_DEFAULT_OPTIONS = {
  maxDepth: 6,
  scriptExtensions: ['txt', 'csv'],
  maxScriptBytes: 4 * 1024 * 1024,
  adapters: ['uviewer-csv'],
}
export const GAL_DEFAULT_LAYOUT = { stripPrefixes: ['download/'], sharedRoot: true }

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/mp4',
}
const extOf = (file) => path.extname(file).slice(1).toLowerCase()
const contentTypeOf = (file) => MIME[extOf(file)] || 'application/octet-stream'
const sha1 = (value) => createHash('sha1').update(value).digest('hex')
const naturalCompare = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function normalizeGalOptions(value = {}) {
  const v = value && typeof value === 'object' ? value : {}
  const exts = (Array.isArray(v.scriptExtensions) ? v.scriptExtensions : GAL_DEFAULT_OPTIONS.scriptExtensions)
    .map((e) => String(e).trim().replace(/^\./, '').toLowerCase()).filter(Boolean)
  const adapters = (Array.isArray(v.adapters) ? v.adapters : GAL_DEFAULT_OPTIONS.adapters).map(String).filter((id) => galAdapterIds().includes(id))
  return {
    rootDir: String(v.rootDir || '').trim(),
    maxDepth: Math.max(1, Math.min(20, Math.floor(Number(v.maxDepth)) || GAL_DEFAULT_OPTIONS.maxDepth)),
    scriptExtensions: exts.length ? exts : GAL_DEFAULT_OPTIONS.scriptExtensions,
    maxScriptBytes: Math.max(1024, Math.floor(Number(v.maxScriptBytes)) || GAL_DEFAULT_OPTIONS.maxScriptBytes),
    adapters: adapters.length ? adapters : GAL_DEFAULT_OPTIONS.adapters,
    limit: Math.max(0, Math.floor(Number(v.limit)) || 0),
    dryRun: Boolean(v.dryRun),
  }
}

export function createGalHandler({ type = GAL_TYPE, dataDir, safeSegment, pathExists, getConfig }) {
  const metaRoot = path.join(dataDir, 'library-meta', type)
  const progressRoot = path.join(dataDir, 'cache', 'library', 'reading-progress', type)

  const options = (override = {}) => normalizeGalOptions({ ...(getConfig().mediaImportProfiles?.[GAL_PROFILE] || {}), ...override })
  const rootDir = (override = '') => path.resolve(override || options().rootDir || path.join(dataDir, 'gal'))

  function assertId(itemId) {
    const id = String(itemId || '')
    if (!id || id !== safeSegment(id)) throw new Error(`无效的条目 id：${id}`)
    return id
  }
  const metaPath = (itemId) => shardedPath(metaRoot, assertId(itemId))
  const progressPath = (itemId) => shardedPath(progressRoot, assertId(itemId))
  const resourceBase = (itemId) => `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/resource`
  const coverUrl = (itemId) => `/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/thumbnail/script/cover`

  // ---------- 元数据 ----------

  function normalizeUnit(unit, item, index) {
    return {
      type,
      unitId: String(unit?.unitId || ''),
      title: String(unit?.title || unit?.fileName || unit?.unitId || ''),
      fileName: String(unit?.fileName || ''),
      relativePath: String(unit?.relativePath || ''),
      mediaKind: 'gal',
      stepCount: Number(unit?.stepCount || 0),
      size: Number(unit?.size || 0),
      tags: parseTags(unit?.tags || []),
      index,
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
      coverPath: String(raw?.coverPath || ''),
      productId: '',
      sourceProfile: String(raw?.sourceProfile || GAL_PROFILE),
      workKey: String(raw?.workKey || ''),
      dlsite: null,
      adapter: String(raw?.adapter || 'uviewer-csv'),
      source: { dir: String(raw?.source?.dir || '') },
      layout: { ...GAL_DEFAULT_LAYOUT, ...(raw?.layout && typeof raw.layout === 'object' ? raw.layout : {}) },
      createdAt: String(raw?.createdAt || now),
      publishedAt: String(raw?.publishedAt || raw?.createdAt || now),
      updatedAt: String(raw?.updatedAt || now),
    }
    item.mediaUnits = (Array.isArray(raw?.mediaUnits) ? raw.mediaUnits : []).map((unit, index) => normalizeUnit(unit, item, index))
    item.unitCount = item.mediaUnits.length
    return item
  }

  const readItem = async (itemId) => normalizeItem(JSON.parse(await readFile(metaPath(itemId), 'utf8')))
  const itemExists = (itemId) => pathExists(metaPath(itemId))
  async function writeItem(item) {
    const normalized = normalizeItem(item)
    await withFileLock(metaPath(normalized.itemId), () => writeJsonAtomic(metaPath(normalized.itemId), normalized))
    return normalized
  }
  async function updateItem(itemId, mutate) {
    const file = metaPath(itemId)
    return withFileLock(file, async () => {
      const next = normalizeItem(await mutate(normalizeItem(JSON.parse(await readFile(file, 'utf8')))))
      await writeJsonAtomic(file, next)
      return next
    })
  }

  async function scanItems() {
    const items = []
    for await (const file of walkShardedFiles(metaRoot)) {
      try {
        items.push(normalizeItem(JSON.parse(await readFile(file, 'utf8'))))
      } catch {
        // 单个损坏的元数据不应该让整个列表消失
      }
    }
    return items
  }
  const getItem = readItem
  const listUnits = async (itemId) => (await readItem(itemId)).mediaUnits

  // ---------- 目录约定 ----------

  const workDirOf = (item) => {
    if (!item.source.dir || item.source.dir !== path.basename(item.source.dir)) throw new Error('条目的作品目录无效')
    return path.join(rootDir(), item.source.dir)
  }

  // 把脚本里的相对路径解析成磁盘上的真实文件。只认 root 之内的真实路径（realpath），目录穿越和符号链接逃逸都挡掉。
  async function resolveAsset(item, resourcePath) {
    const rel = String(resourcePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel || rel.split('/').some((part) => part === '..' || part === '')) throw Object.assign(new Error('资源路径无效'), { statusCode: 400 })
    const root = rootDir()
    const work = workDirOf(item)
    const candidates = [path.join(work, rel)]
    for (const prefix of item.layout.stripPrefixes || []) if (rel.startsWith(prefix)) candidates.push(path.join(work, rel.slice(prefix.length)))
    if (item.layout.sharedRoot) candidates.push(path.join(root, rel))
    const realRoot = await realpath(root).catch(() => root)
    for (const candidate of candidates) {
      try {
        const real = await realpath(candidate)
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) continue
        if ((await stat(real)).isFile()) return real
      } catch {
        // 下一个候选
      }
    }
    throw Object.assign(new Error('资源不存在'), { statusCode: 404 })
  }

  async function getResource(itemId, resourcePath) {
    const item = await readItem(itemId)
    const file = await resolveAsset(item, resourcePath)
    return { body: await readFile(file), contentType: contentTypeOf(file) }
  }

  async function getThumbnail(itemId) {
    const item = await readItem(itemId)
    if (!item.coverPath) throw Object.assign(new Error('缩略图不存在'), { statusCode: 404 })
    try {
      const file = await resolveAsset(item, item.coverPath)
      return { body: await readFile(file), contentType: contentTypeOf(file) }
    } catch {
      throw Object.assign(new Error('缩略图不存在'), { statusCode: 404 })
    }
  }

  // ---------- 阅读 ----------

  async function readScriptText(item, unit) {
    const work = workDirOf(item)
    const file = path.resolve(work, unit.relativePath)
    if (file !== work && !file.startsWith(work + path.sep)) throw new Error('脚本路径无效')
    const real = await realpath(file)
    const realWork = await realpath(work)
    if (!real.startsWith(realWork + path.sep)) throw new Error('脚本路径无效')
    return decodeTextFile(await readFile(real)).text
  }

  async function getReaderContent(itemId, unitId) {
    const item = await readItem(itemId)
    const index = unitId ? item.mediaUnits.findIndex((unit) => unit.unitId === unitId) : 0
    const unit = item.mediaUnits[index]
    if (!unit) throw new Error(`Unit not found: ${unitId}`)
    const scene = buildScene(item.adapter, await readScriptText(item, unit))
    const { mediaUnits, ...publicItem } = item
    return {
      type: 'gal',
      item: publicItem,
      unit,
      sections: [],
      section: null,
      navigation: { prev: item.mediaUnits[index - 1] || null, next: item.mediaUnits[index + 1] || null },
      scene,
      resourceBase: resourceBase(itemId),
    }
  }

  // ---------- 导入（只建元数据） ----------

  // 在作品目录里找脚本：深度 ≤ maxDepth，扩展名匹配，大小有上限，内容被某个适配器认得
  async function findScripts(workDir, opts) {
    const found = []
    const walk = async (dir, depth) => {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      entries.sort((a, b) => naturalCompare(a.name, b.name))
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { if (depth < opts.maxDepth) await walk(full, depth + 1); continue }
        if (!entry.isFile() || !opts.scriptExtensions.includes(extOf(entry.name))) continue
        const info = await stat(full)
        if (!info.size || info.size > opts.maxScriptBytes) continue
        const handle = await open(full, 'r')
        let head
        try {
          const buffer = Buffer.alloc(Math.min(8192, info.size))
          await handle.read(buffer, 0, buffer.length, 0)
          head = decodeTextFile(buffer).text
        } finally { await handle.close() }
        const adapter = sniffGalAdapter(head, opts.adapters)
        if (adapter) found.push({ full, adapter, size: info.size, mtimeMs: info.mtimeMs })
      }
    }
    await walk(workDir, 0)
    return found
  }

  async function importWork(root, dirName, opts, tags) {
    const workDir = path.join(root, dirName)
    const scripts = await findScripts(workDir, opts)
    if (!scripts.length) return null
    const itemId = sha1(`gal:${dirName.normalize('NFC')}`)
    const existing = (await itemExists(itemId)) ? await readItem(itemId) : null
    const now = new Date().toISOString()
    const adapter = scripts[0].adapter
    const units = []
    let coverPath = ''
    for (const script of scripts) {
      const relativePath = path.relative(workDir, script.full).split(path.sep).join('/')
      const unitId = `u${sha1(relativePath).slice(0, 12)}`
      let scene = null
      try { scene = buildScene(script.adapter, decodeTextFile(await readFile(script.full)).text) } catch { /* 解析失败的脚本仍然列出来，打开时再报错 */ }
      if (!coverPath && scene) coverPath = firstBackgroundSrc(scene)
      const prev = existing?.mediaUnits.find((unit) => unit.unitId === unitId)
      units.push({
        unitId,
        title: path.basename(script.full, path.extname(script.full)),
        fileName: path.basename(script.full),
        relativePath,
        stepCount: scene?.steps.length || 0,
        size: script.size,
        tags: prev?.tags || [],
        createdAt: prev?.createdAt || now,
        updatedAt: now,
      })
    }
    units.sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    // 封面只认能在磁盘上找到的背景图
    const draft = normalizeItem({ itemId, title: dirName.normalize('NFC'), source: { dir: dirName }, mediaUnits: units })
    if (coverPath) {
      try { await resolveAsset({ ...draft, source: { dir: dirName } }, coverPath) } catch { coverPath = '' }
    }
    const item = normalizeItem({
      ...(existing || {}),
      itemId,
      title: existing?.title || dirName.normalize('NFC'),
      tags: [...new Set([...(existing?.tags || []), ...tags])],
      sourceProfile: GAL_PROFILE,
      adapter,
      source: { dir: dirName },
      layout: existing?.layout || GAL_DEFAULT_LAYOUT,
      coverPath,
      cover: coverPath ? coverUrl(itemId) : '',
      mediaUnits: units,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    })
    return { item, isNew: !existing }
  }

  // 扫根目录下的每个子目录。dryRun 只统计不写。返回 { items, report }
  async function importFromSource({ sourcePath = '', tags = [], options: override = {}, onProgress = null, shouldStop = null } = {}) {
    const opts = options(override)
    const root = rootDir(opts.rootDir)
    // 来源只能是根目录（在「Gal 导入」方案 JSON 的 rootDir 里配）：不让页面指定任意路径去读
    if (sourcePath && path.resolve(sourcePath) !== root) throw new Error(`来源目录必须是 Gal 根目录：${root}`)
    let entries
    try {
      entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    } catch {
      throw new Error(`Gal 根目录不存在或不可读：${root}`)
    }
    entries.sort((a, b) => naturalCompare(a.name, b.name))
    const report = { root, dryRun: opts.dryRun, scanned: entries.length, imported: 0, updated: 0, skippedNoScript: 0, failed: 0, scripts: 0, limited: false, errors: [] }
    const items = []
    for (const entry of entries) {
      if (shouldStop?.()) break
      if (opts.limit && items.length >= opts.limit) { report.limited = true; break }
      try {
        const result = await importWork(root, entry.name, opts, parseTags(tags))
        if (!result) { report.skippedNoScript += 1; continue }
        report.scripts += result.item.unitCount
        if (result.isNew) report.imported += 1
        else report.updated += 1
        if (!opts.dryRun) await writeItem(result.item)
        items.push(result.item)
      } catch (error) {
        report.failed += 1
        if (report.errors.length < 20) report.errors.push({ dir: entry.name, error: String(error?.message || error) })
      }
      onProgress?.({ done: report.imported + report.updated + report.skippedNoScript + report.failed, total: entries.length })
    }
    return { items: opts.dryRun ? [] : items, report }
  }

  // ---------- 标签 / 进度 ----------

  const updateItemTags = (itemId, tags = []) => updateItem(itemId, (item) => ({ ...item, tags: parseTags(tags), updatedAt: new Date().toISOString() }))
  async function updateUnitTags(itemId, unitId, tags = []) {
    const next = await updateItem(itemId, (item) => ({
      ...item,
      mediaUnits: item.mediaUnits.map((unit) => (unit.unitId === unitId ? { ...unit, tags: parseTags(tags) } : unit)),
      updatedAt: new Date().toISOString(),
    }))
    const unit = next.mediaUnits.find((entry) => entry.unitId === unitId)
    if (!unit) throw new Error(`Unit not found: ${unitId}`)
    return unit
  }
  const patchItemMetadata = (itemId, patch = {}) => updateItem(itemId, (item) => {
    const next = { ...item }
    if (patch.workKey !== undefined) next.workKey = String(patch.workKey || '')
    if (patch.title !== undefined && String(patch.title || '').trim()) next.title = String(patch.title).trim()
    const published = Date.parse(String(patch.publishedAt || ''))
    if (Number.isFinite(published)) next.publishedAt = new Date(published).toISOString()
    return { ...next, updatedAt: new Date().toISOString() }
  })
  const patchUnitMetadata = async (itemId, unitId) => (await readItem(itemId)).mediaUnits.find((unit) => unit.unitId === unitId)

  const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0))
  const normalizeProgress = (value, itemId) => ({
    itemId,
    lastUnitId: String(value?.lastUnitId || ''),
    lastScrollRatio: clamp(value?.lastScrollRatio || 0),
    readUnits: value?.readUnits && typeof value.readUnits === 'object' ? value.readUnits : {},
    updatedAt: String(value?.updatedAt || ''),
  })
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
      if (current.lastScrollRatio >= 0.98) current.readUnits[unitId].completedAt ||= now
    }
    current.updatedAt = now
    await writeJsonAtomic(progressPath(itemId), current)
    return current
  }

  return {
    type,
    label: 'Gal',
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
    // 上传没有意义（作品是整个目录）；这里的「导入」就是扫根目录建元数据，同步完成
    importItem: async ({ fields = {} }) => {
      let override = {}
      try { override = JSON.parse(String(fields.profileOptions || '{}')) } catch { throw new Error('导入方案配置不是合法的 JSON') }
      const { items, report } = await importFromSource({ sourcePath: String(fields.sourcePath || fields.path || '').trim(), tags: parseTags(fields.tags || ''), options: override })
      return { items, report }
    },
    importFromSource,
    internals: { normalizeItem, writeItem, readItem, updateItem, resolveAsset, rootDir, findScripts, metaPath, coverUrl },
  }
}
