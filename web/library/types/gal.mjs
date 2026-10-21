// Gal（视觉小说 / 剧情脚本）：一个目录 = 一个媒体条目，条目只有一个单元（'main'）；单元里是一棵由后端按需给出的「浏览节点」树
//   首页 → 分类 → （角色 →）脚本列表 → 播放页，节点怎么来见 web/library/gal/browse.mjs。前端走通用的 reader?sectionId=<节点 id>。
// 目录本身就是数据，不 mv、不拷贝、不改——导入只是给它建一份元数据 JSON（source.path 指向传进来的目录）。
//   - 来源目录：导入时传的 sourcePath；不传就用「Gal 导入」方案的 rootDir（默认 <data>/gal）
//   - 元数据：<data>/library-meta/gal/ab/cd/<id>.json（分片）；条目 id = sha1('gal:' + 目录真实路径)，重复导入原地更新
//   - 资源：脚本里的相对路径（如 download/bg/x.jpg）按媒体目录解析；找不到再去掉 layout.stripPrefixes 里的前缀重试
//   - 封面：目录下的 cover.(jpg|png|webp)，没有就取前几个脚本里第一张存在的背景图（存 coverPath；取的时候原样返回，不缩放）

import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from '../atomic-json-store.mjs'
import { galAdapterIds } from '../gal/adapters/index.mjs'
import { createBrowseProvider, normalizeBrowseLayout } from '../gal/browse.mjs'
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
export const GAL_DEFAULT_LAYOUT = { stripPrefixes: ['download/'] }
export const GAL_MAIN_UNIT = 'main'
const COVER_NAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp']

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/mp4',
}
const extOf = (file) => path.extname(file).slice(1).toLowerCase()
const contentTypeOf = (file) => MIME[extOf(file)] || 'application/octet-stream'
const sha1 = (value) => createHash('sha1').update(value).digest('hex')

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
      source: { path: String(raw?.source?.path || '') },
      layout: {
        ...GAL_DEFAULT_LAYOUT,
        ...(raw?.layout && typeof raw.layout === 'object' ? raw.layout : {}),
        browse: normalizeBrowseLayout(raw?.layout?.browse),
      },
      scriptCount: Math.max(0, Number(raw?.scriptCount) || 0),
      createdAt: String(raw?.createdAt || now),
      publishedAt: String(raw?.publishedAt || raw?.createdAt || now),
      updatedAt: String(raw?.updatedAt || now),
    }
    // 一个媒体只有一个单元：浏览、选脚本都在这个单元里面（节点树）
    const prevTags = Array.isArray(raw?.mediaUnits) ? raw.mediaUnits.find((unit) => unit?.unitId === GAL_MAIN_UNIT)?.tags : []
    item.mediaUnits = [normalizeUnit({ unitId: GAL_MAIN_UNIT, title: item.title, fileName: path.basename(item.source.path), tags: prevTags, stepCount: item.scriptCount }, item, 0)]
    item.unitCount = 1
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
    if (!item.source.path) throw new Error('条目没有记录来源目录')
    return path.resolve(item.source.path)
  }

  // 把脚本里的相对路径解析成磁盘上的真实文件。只认媒体目录之内的真实路径（realpath），目录穿越和符号链接逃逸都挡掉。
  async function resolveAsset(item, resourcePath) {
    const rel = String(resourcePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel || rel.split('/').some((part) => part === '..' || part === '')) throw Object.assign(new Error('资源路径无效'), { statusCode: 400 })
    const work = workDirOf(item)
    const candidates = [path.join(work, rel)]
    for (const prefix of item.layout.stripPrefixes || []) if (rel.startsWith(prefix)) candidates.push(path.join(work, rel.slice(prefix.length)))
    const realWork = await realpath(work).catch(() => work)
    for (const candidate of candidates) {
      try {
        const real = await realpath(candidate)
        if (!real.startsWith(realWork + path.sep)) continue
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

  function providerOf(item, opts = options()) {
    return createBrowseProvider({
      mediaDir: workDirOf(item),
      layout: item.layout.browse,
      adapters: opts.adapters,
      scriptExtensions: opts.scriptExtensions,
      maxScriptBytes: opts.maxScriptBytes,
      maxDepth: opts.maxDepth,
      resolveAsset: (rel) => resolveAsset(item, rel),
    })
  }

  // ---------- 阅读 ----------

  // sectionId = 浏览节点 id（见 gal/browse.mjs）：空 = 首页；播放页节点带规范场景，其余节点只有选项列表
  async function getReaderContent(itemId, unitId, { sectionId = '' } = {}) {
    const item = await readItem(itemId)
    if (unitId && unitId !== GAL_MAIN_UNIT) throw new Error(`Unit not found: ${unitId}`)
    const unit = item.mediaUnits[0]
    const { node, scene = null, sectionNavigation = { prev: null, next: null } } = await providerOf(item).getNode(sectionId)
    const { mediaUnits, ...publicItem } = item
    return {
      type: 'gal',
      item: publicItem,
      unit,
      sections: [],
      section: { sectionId: node.id, title: node.title, index: 0 },
      navigation: { prev: null, next: null },
      sectionNavigation,
      node,
      scene,
      resourceBase: resourceBase(itemId),
    }
  }

  // ---------- 导入（只建元数据） ----------

  // 一个目录 = 一个媒体。dryRun 只统计不写。返回 { items, report }
  async function importFromSource({ sourcePath = '', tags = [], options: override = {}, onProgress = null } = {}) {
    const opts = options(override)
    const dir = path.resolve(String(sourcePath || '').trim() || rootDir(opts.rootDir))
    let real
    try {
      real = await realpath(dir)
      if (!(await stat(real)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new Error(`Gal 目录不存在或不可读：${dir}`)
    }
    const report = { root: dir, dryRun: opts.dryRun, scanned: 1, imported: 0, updated: 0, skippedNoScript: 0, failed: 0, scripts: 0, limited: false, errors: [] }
    const itemId = sha1(`gal:${real.normalize('NFC')}`)
    const existing = (await itemExists(itemId)) ? await readItem(itemId) : null
    const layout = { ...GAL_DEFAULT_LAYOUT, ...(existing?.layout || {}) }
    const draft = normalizeItem({ itemId, title: existing?.title || path.basename(real).normalize('NFC'), source: { path: real }, layout })
    const summary = await providerOf(draft, opts).summarize()
    report.scripts = summary.scripts
    if (!summary.scripts) {
      report.skippedNoScript = 1
      onProgress?.({ done: 1, total: 1 })
      return { items: [], report }
    }
    // 封面：目录下显式的 cover.* 优先，其次脚本里第一张存在的背景图
    let coverPath = ''
    for (const name of COVER_NAMES) {
      try { await resolveAsset(draft, name); coverPath = name; break } catch { /* 下一个 */ }
    }
    coverPath ||= summary.cover
    const now = new Date().toISOString()
    const item = normalizeItem({
      ...(existing || {}),
      itemId,
      title: draft.title,
      tags: [...new Set([...(existing?.tags || []), ...parseTags(tags)])],
      sourceProfile: GAL_PROFILE,
      adapter: opts.adapters[0],
      source: { path: real },
      layout,
      scriptCount: summary.scripts,
      coverPath,
      cover: coverPath ? coverUrl(itemId) : '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    })
    if (existing) report.updated = 1
    else report.imported = 1
    if (!opts.dryRun) await writeItem(item)
    onProgress?.({ done: 1, total: 1 })
    return { items: opts.dryRun ? [] : [item], report }
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
  const MAX_NODE_PROGRESS = 3000
  const normalizeProgress = (value, itemId) => ({
    itemId,
    lastUnitId: String(value?.lastUnitId || ''),
    lastSectionId: String(value?.lastSectionId || ''),
    lastScrollRatio: clamp(value?.lastScrollRatio || 0),
    readUnits: value?.readUnits && typeof value.readUnits === 'object' ? value.readUnits : {},
    // 每个脚本（播放页节点）各自的进度：重新进某个脚本接着看，列表里也能标已读
    nodes: value?.nodes && typeof value.nodes === 'object' ? value.nodes : {},
    updatedAt: String(value?.updatedAt || ''),
  })
  async function getProgress(itemId) {
    try {
      return normalizeProgress(JSON.parse(await readFile(progressPath(itemId), 'utf8')), itemId)
    } catch {
      return normalizeProgress(null, itemId)
    }
  }
  // 只有播放页（s:…）算进度；在首页/分类里逛不改「上次看到哪」，不然「继续」会落到一个列表页上
  async function saveProgress(itemId, patch = {}) {
    const current = await getProgress(itemId)
    const now = new Date().toISOString()
    const unitId = String(patch.unitId || patch.lastUnitId || '').trim()
    const sectionId = String(patch.sectionId || '')
    if (unitId && sectionId.startsWith('s:')) {
      const ratio = clamp(patch.scrollRatio ?? patch.lastScrollRatio ?? current.lastScrollRatio)
      current.lastUnitId = unitId
      current.lastSectionId = sectionId
      current.lastScrollRatio = ratio
      const entry = current.readUnits[unitId] || {}
      current.readUnits[unitId] = { ...entry, unitId, title: String(patch.title || entry.title || unitId), enteredAt: entry.enteredAt || now, updatedAt: now }
      current.nodes[sectionId] = { ratio, title: String(patch.sectionTitle || current.nodes[sectionId]?.title || ''), updatedAt: now, ...(ratio >= 0.98 ? { completedAt: current.nodes[sectionId]?.completedAt || now } : {}) }
      const keys = Object.keys(current.nodes)
      if (keys.length > MAX_NODE_PROGRESS) {
        for (const key of keys.sort((a, b) => String(current.nodes[a].updatedAt).localeCompare(String(current.nodes[b].updatedAt))).slice(0, keys.length - MAX_NODE_PROGRESS)) delete current.nodes[key]
      }
    } else if (unitId && !current.lastUnitId) {
      current.lastUnitId = unitId
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
    internals: { normalizeItem, writeItem, readItem, updateItem, resolveAsset, rootDir, metaPath, coverUrl, providerOf },
  }
}
