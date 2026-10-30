// Gal（视觉小说 / 剧情脚本）：一个目录 = 一个媒体条目，条目只有一个单元（'main'）；单元里是一棵由后端按需给出的「浏览节点」树
//   首页 → 一层层目录 → 脚本列表 → 播放页，节点怎么来见 web/library/gal/browse.mjs。前端走通用的 reader?sectionId=<节点 id>。
// 目录本身就是数据，不 mv、不拷贝、不改——导入只是给它建一份元数据 JSON：来源路径 source.path + adapters（脚本格式适配器）+ 标题。
//   - 元数据里的 config（见 gal/config.mjs）是引擎和 tag 脚本（gal-layout）之间唯一的配置字段：脚本根、资源根、名称文件、
//     缩略图目录、目录标签、合并目录、头像/缩略图模板、封面……缺的用默认（= 标准结构：UViewer 资源包的布局），所以标准结构的目录导入完就能用；
//     目录没按标准结构放时，由脚本探测实际结构、把 config 里的参数调对。
//   - 元数据：<data>/library-meta/gal/ab/cd/<id>.json（分片）；条目 id = sha1('gal:' + 目录真实路径)，重复导入原地更新（config 保留）
//   - 资源：脚本里的相对路径（如 download/bg/x.jpg）按 config.resourceRoots 依次查找
//   - 封面：config.cover（脚本写；取的时候原样返回，不缩放）

import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from '../atomic-json-store.mjs'
import { galAdapterIds } from '../gal/adapters/index.mjs'
import { createBrowseProvider, invalidateBrowseCaches } from '../gal/browse.mjs'
import { applyGalConfigPatchWithWarnings, cleanGalConfigRawWithWarnings, normalizeGalConfig } from '../gal/config.mjs'
import { ensureContainers, materialize } from '../gal/containers.mjs'
import { resolveOnDisk } from '../gal/resolve.mjs'
import { isVideoPath } from '../gal/thumbs.mjs'
import { createFrameCache } from '../gal/video-thumb.mjs'
import { shardedPath, walkShardedFiles, writeJsonAtomic } from '../meta-shard.mjs'
import { parseTags } from '../tag-store.mjs'
import { decodeTextFile } from '../text-decode.mjs'

export const GAL_TYPE = 'gal'
export const GAL_PROFILE = 'gal-import'
export const GAL_MAIN_UNIT = 'main'   // 一个媒体只有一个单元

// 导入方案「gal-import」的参数：来源目录（不传来源时用的默认目录）、脚本格式适配器、导入后自动跑的元数据脚本
export const GAL_DEFAULT_OPTIONS = {
  adapters: ['uviewer-csv'],
  defaultMetadataActions: ['gal-layout'],
}
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
  const adapters = (Array.isArray(v.adapters) ? v.adapters : GAL_DEFAULT_OPTIONS.adapters).map(String).filter((id) => galAdapterIds().includes(id))
  const actions = Array.isArray(v.defaultMetadataActions) ? v.defaultMetadataActions : parseTags(v.defaultMetadataActions ?? GAL_DEFAULT_OPTIONS.defaultMetadataActions)
  return {
    rootDir: String(v.rootDir || '').trim(),
    adapters: adapters.length ? adapters : GAL_DEFAULT_OPTIONS.adapters,
    defaultMetadataActions: [...new Set(actions.map((id) => String(id).trim()).filter(Boolean))],
    // 导入时直接写进条目的初始 config（比如 {"game":{"id":"monmusu"}}）：新条目 = 这份 config；已有条目 = 作为补丁合并
    ...(v.config && typeof v.config === 'object' && !Array.isArray(v.config) ? { config: v.config } : {}),
    dryRun: Boolean(v.dryRun),
  }
}

export function createGalHandler({ type = GAL_TYPE, dataDir, safeSegment, pathExists, getConfig }) {
  const metaRoot = path.join(dataDir, 'library-meta', type)
  const progressRoot = path.join(dataDir, 'cache', 'library', 'reading-progress', type)
  const frames = createFrameCache({ dir: path.join(dataDir, 'cache', 'gal-thumbs') })   // 视频缩略图（一帧 JPEG）的缓存目录

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

  // config 被丢掉 / 夹住的内容（{ field, reason, snippet }）：上次写 config（导入 / 元数据脚本的补丁）时记下来的 + 这次读出来又丢掉的，≤ 20 条，去重；
  // 浏览层把它们报进列表页的「渲染诊断」（code: config-dropped）。没有就不写这个字段（条目 JSON 和以前一样）
  const cleanWarnings = (list) => (Array.isArray(list) ? list : []).filter((w) => w && typeof w.field === 'string').map((w) => ({ field: String(w.field).slice(0, 80), reason: String(w.reason || '').slice(0, 200), snippet: String(w.snippet || '').slice(0, 80) }))

  function normalizeItem(raw) {
    const now = new Date().toISOString()
    const cleaned = cleanGalConfigRawWithWarnings(raw?.config)
    const warnings = []
    for (const w of [...cleanWarnings(raw?.configWarnings), ...cleaned.warnings]) if (!warnings.some((x) => x.field === w.field && x.reason === w.reason && x.snippet === w.snippet)) warnings.push(w)
    const item = {
      type,
      itemId: String(raw?.itemId || ''),
      title: String(raw?.title || raw?.itemId || 'Untitled'),
      author: Array.isArray(raw?.author) ? raw.author : [],
      tags: parseTags(raw?.tags || []),
      cover: '',
      coverPath: '',
      productId: '',
      sourceProfile: String(raw?.sourceProfile || GAL_PROFILE),
      workKey: String(raw?.workKey || ''),
      dlsite: null,
      // 脚本格式适配器（可以有几个，按顺序试）
      adapters: (Array.isArray(raw?.adapters) ? raw.adapters.map(String) : []).filter((id) => galAdapterIds().includes(id)).slice(0, 5),
      source: { path: String(raw?.source?.path || '') },
      // 唯一的配置字段：只存写过的字段（缺的在读的时候用默认补），见 gal/config.mjs
      config: cleaned.clean,
      scriptCount: 0,
      createdAt: String(raw?.createdAt || now),
      publishedAt: String(raw?.publishedAt || raw?.createdAt || now),
      updatedAt: String(raw?.updatedAt || now),
    }
    // 被丢掉的适配器 id（不认识 / 写坏了 / 超过 5 个）：不可枚举（不写进元数据），给浏览层的诊断（code: config-dropped）报告
    const known = galAdapterIds()
    const rawAdapters = Array.isArray(raw?.adapters) ? raw.adapters.map(String) : []
    const adapterWarnings = [
      ...rawAdapters.filter((id) => !known.includes(id)).map((id) => ({ field: 'adapters', reason: '不认识的适配器 id，已丢掉', snippet: id.slice(0, 80) })),
      ...rawAdapters.filter((id) => known.includes(id)).slice(5).map((id) => ({ field: 'adapters', reason: '最多 5 个适配器，多出的丢掉', snippet: id })),
    ]
    if (!item.adapters.length) {
      item.adapters = [...GAL_DEFAULT_OPTIONS.adapters]
      if (rawAdapters.length) adapterWarnings.push({ field: 'adapters', reason: `没有可用的适配器，退回默认 ${item.adapters.join(' / ')}`, snippet: rawAdapters.join(',').slice(0, 80) })
    }
    Object.defineProperty(item, 'adapterWarnings', { value: adapterWarnings, enumerable: false })
    // 封面、脚本数来自 config（卡片/索引读的是 item.cover / item.scriptCount，这里同步出来）
    if (warnings.length) item.configWarnings = warnings.slice(0, 20)
    item.coverPath = item.config.cover || ''
    item.cover = item.coverPath ? coverUrl(item.itemId) : ''
    item.scriptCount = Math.max(0, Number(item.config.scriptCount) || 0)
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

  // 把脚本里的相对路径解析成磁盘上的真实文件。路径相对「资源根」（config.resourceRoots，按顺序找，取第一个存在的）；
  // `~/` 开头 = 相对媒体目录：资源接口只放行缩略图缓存目录（config.thumbsDirs），封面（allowMedia）可以是媒体目录里的任意文件，别的拒绝。
  // 只认媒体目录之内的真实路径（realpath），目录穿越和符号链接逃逸都挡掉。
  async function resolveAsset(item, resourcePath, { allowMedia = false } = {}) {
    const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
    const config = normalizeGalConfig(item.config)
    let rel = String(resourcePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    const fromMedia = rel.startsWith('~/')
    if (fromMedia) rel = rel.slice(2)
    if (!rel || rel.split('/').some((part) => part === '..' || part === '')) throw bad('资源路径无效')
    const work = workDirOf(item)
    await ensureContainers({ mediaDir: work, config }).catch(() => {})   // 容器（.arc）还没展开就先展开：直接打开资源链接（没经过浏览）也能找到文件
    // 解析顺序（规则全在 gal/resolve.mjs，config.resourceResolve 配）：原路径（资源根依次 + stripPrefixes 去前缀）→ rewrites → extensionFallbacks → normalizeUnicode → 按路径段忽略大小写；
    // 找到的真实路径（realpath）必须在媒体目录内，或在管理员写的 resourceResolve.allowedRoots 内——目录穿越和符号链接逃逸都挡掉。
    // 容器 hybrid 方式：这个路径如果是还没展开的资源，先从 .arc 里把那一个条目取出来（写成文件），后面就和普通文件一样
    const roots = (config.resourceRoots?.length ? config.resourceRoots : ['']).map((root) => String(root || '').replace(/^\.\/?/, '').replace(/\/+$/, ''))
    const wanted = fromMedia ? [rel] : [rel, ...config.stripPrefixes.filter((prefix) => rel.startsWith(prefix)).map((prefix) => rel.slice(prefix.length))].flatMap((variant) => roots.map((root) => (root ? `${root}/${variant}` : variant)))
    await materialize({ mediaDir: work, config, rels: wanted }).catch(() => {})
    if (fromMedia) {
      if (!allowMedia && !config.thumbsDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) throw bad('不允许的路径', 403)
      const hit = await resolveOnDisk({ work, rootRels: [''], variants: [rel], cfg: null, caseInsensitiveFallback: false })   // ~/ 路径：只认媒体目录内的原路径，不套任何解析规则 / allowedRoots
      if (hit) return hit
      throw bad('资源不存在', 404)
    }
    const variants = [rel, ...config.stripPrefixes.filter((prefix) => rel.startsWith(prefix)).map((prefix) => rel.slice(prefix.length))]
    const hit = await resolveOnDisk({ work, rootRels: config.resourceRoots, variants, cfg: config.resourceResolve })
    if (hit) return hit
    throw bad('资源不存在', 404)
  }

  // frame：视频 → 一帧 JPEG（卡片缩略图）。resolveAsset 已经把路径限制在媒体目录内，截出来的图缓存在 cache/gal-thumbs，返回 { file, contentType } 让路由按文件发（ETag / 长缓存）
  async function getResource(itemId, resourcePath, { frame = false } = {}) {
    const item = await readItem(itemId)
    const file = await resolveAsset(item, resourcePath)
    if (frame) {
      if (!isVideoPath(file)) throw Object.assign(new Error('不是视频文件'), { statusCode: 415 })
      return { file: await frames.frameOf(file, normalizeGalConfig(item.config).thumbFrame), contentType: 'image/jpeg', cacheControl: 'public, max-age=604800, stale-while-revalidate=2592000' }
    }
    return { body: await readFile(file), contentType: contentTypeOf(file) }
  }

  // 渲染缩略图（浏览器离屏渲染的一帧 JPEG）：按 key 存在 cache/gal-render-thumbs。GET 命中返回图、没有 404（前端据此决定要不要渲染）；PUT 存图（只收 JPEG、≤ 600KB、key 必须是 40 位十六进制）
  const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
  const renderDir = path.join(dataDir, 'cache', 'gal-render-thumbs')
  const renderFile = (key) => {
    if (!/^[0-9a-f]{40}$/.test(String(key))) throw bad('key 不合法', 400)
    return path.join(renderDir, key.slice(0, 2), `${key}.jpg`)
  }
  async function getRenderThumb(itemId, key) {
    await readItem(itemId)
    const file = renderFile(key)
    try { if ((await stat(file)).size > 0) return { file, contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } } catch { /* 没有 */ }
    throw bad('还没有渲染缩略图', 404)
  }
  async function putRenderThumb(itemId, key, buffer) {
    await readItem(itemId)
    const file = renderFile(key)
    if (!Buffer.isBuffer(buffer) || buffer.length < 200 || buffer.length > 600 * 1024) throw bad('图片大小不合格（200B ~ 600KB）', 413)
    if (!(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) throw bad('只收 JPEG', 415)
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}-${Date.now()}.tmp`
    try { await writeFile(tmp, buffer); await rename(tmp, file) } finally { await rm(tmp, { force: true }).catch(() => {}) }   // 同一个 key 两个页面同时传：后到的覆盖，内容等价
    return { ok: true }
  }

  async function getThumbnail(itemId) {
    const item = await readItem(itemId)
    if (!item.coverPath) throw Object.assign(new Error('缩略图不存在'), { statusCode: 404 })
    try {
      const file = await resolveAsset(item, item.coverPath, { allowMedia: true })
      return { body: await readFile(file), contentType: contentTypeOf(file) }
    } catch {
      throw Object.assign(new Error('缩略图不存在'), { statusCode: 404 })
    }
  }

  async function getThumbnailFile(itemId) {
    const item = await readItem(itemId)
    if (!item.coverPath) throw Object.assign(new Error('缩略图不存在'), { statusCode: 404 })
    try {
      const file = await resolveAsset(item, item.coverPath, { allowMedia: true })
      return { file, contentType: contentTypeOf(file) }
    } catch {
      throw Object.assign(new Error('缩略图不存在'), { statusCode: 404 })
    }
  }

  function providerOf(item) {
    return createBrowseProvider({
      mediaDir: workDirOf(item),
      config: item.config,
      adapters: item.adapters,
      resolveAsset: (rel) => resolveAsset(item, rel),
      extraWarnings: [...(item.configWarnings || []), ...(item.adapterWarnings || [])],
    })
  }

  // 手动刷新文件索引：丢掉这个条目的全部浏览缓存（适配器上下文 = 文件索引 + 名称表、嗅探、目录列表、脚本摘要），马上按磁盘现状重建首页，返回新的索引状态
  async function refreshIndex(itemId) {
    const item = await readItem(itemId)
    const cleared = invalidateBrowseCaches(workDirOf(item))
    const { node } = await providerOf(item).getNode('')
    return { cleared, index: node.index || null, problems: node.problems || [] }
  }

  // ---------- 阅读 ----------

  // sectionId = 浏览节点 id（见 gal/browse.mjs）：空 = 首页；播放页节点带规范场景，其余节点只有选项列表
  async function getReaderContent(itemId, unitId, { sectionId = '', showMosaic } = {}) {
    const item = await readItem(itemId)
    if (unitId && unitId !== GAL_MAIN_UNIT) throw new Error(`Unit not found: ${unitId}`)
    const unit = item.mediaUnits[0]
    const { node, scene = null, sectionNavigation = { prev: null, next: null } } = await providerOf(item).getNode(sectionId, showMosaic === undefined ? {} : { showMosaic })
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

  // ---------- 随机语音 ----------
  // params：{ node, include, exclude, target, bgvoice, tries }（见 gal/browse.mjs 的 randomVoice）；结果里的 src 已是可直接播的资源地址
  async function getRandomVoice(itemId, params = {}) {
    const item = await readItem(itemId)
    return providerOf(item).randomVoice({ ...params, resourceBase: resourceBase(itemId) })
  }

  // ---------- 导入（只建元数据） ----------

  // 一个目录 = 一个媒体：只记路径、adapters、标题，不扫描、不探测——配置按标准结构取默认，结构不对的由 gal-layout 脚本调。
  // 重复导入 = 原地更新（config、标签、标题都保留）。dryRun 只检查不写。返回 { items, report }
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
    const report = { root: dir, dryRun: opts.dryRun, scanned: 1, imported: 0, updated: 0, warnings: [], errors: [] }
    const itemId = sha1(`gal:${real.normalize('NFC')}`)
    const existing = (await itemExists(itemId)) ? await readItem(itemId) : null
    const now = new Date().toISOString()
    const importApplied = opts.config ? applyGalConfigPatchWithWarnings(existing?.config || {}, opts.config) : null
    const item = normalizeItem({
      ...(existing || {}),
      itemId,
      title: existing?.title || path.basename(real).normalize('NFC'),
      tags: [...new Set([...(existing?.tags || []), ...parseTags(tags)])],
      sourceProfile: GAL_PROFILE,
      adapters: opts.adapters,
      source: { path: real },
      config: importApplied ? importApplied.config : existing?.config || {},
      ...(importApplied?.warnings.length ? { configWarnings: cleanWarnings(importApplied.warnings).slice(0, 20) } : {}),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    })
    // 只做一次很轻的检查：脚本根在不在——不在也照样建，报告里提示，由元数据脚本去调。
    // 只有「靠默认脚本根（UViewer 的 resources/download/adv/text）」时才有意义：config 里还没写 scriptRoots、用的是 UViewer 适配器、
    // 也没声明成别的游戏。别的游戏（tenkeiprdx / monmusu…）的目录结构本来就不是这个，它们的脚本根由 gal-layout 脚本写，
    // 在这里提示「没有按标准结构放」只会误导（实际导入完脚本一跑就对了）。
    const cfg = normalizeGalConfig(item.config)
    const explicitRoots = item.config.scriptRoots !== undefined   // 脚本 / 用户写过脚本根：它不存在就是真问题
    const relyOnDefaultRoot = !explicitRoots && item.adapters.includes('uviewer-csv') && (!cfg.game || cfg.game.id === 'uviewer' || cfg.game.id === 'deepone')
    if (explicitRoots || relyOnDefaultRoot) {
      const firstRoot = cfg.scriptRoots[0]
      try {
        if (!(await stat(path.join(real, ...(firstRoot.dir ? firstRoot.dir.split('/') : [])))).isDirectory()) throw new Error('x')
      } catch {
        report.warnings.push(`脚本根「${firstRoot.dir || '.'}」不存在：这个目录没有按标准结构放，需要运行元数据脚本 gal-layout（或手动改 config）来调整`)
      }
    }
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
  // 容器（config.containers，如 WillPlus .arc）：gal-layout 把 config 写好之后马上在后台展开（大 arc 要几分钟，别等到第一次打开列表才开始；和浏览共用同一次展开——单飞）。
  // 失败不抛：浏览时会再试一次，错误在列表页的渲染诊断里
  const warmContainers = (item) => {
    try {
      const config = normalizeGalConfig(item.config)
      if (config.containers.enabled) ensureContainers({ mediaDir: workDirOf(item), config }).catch(() => {})
    } catch { /* 目录没了 / 配置坏了：浏览时会报 */ }
  }
  const patchItemMetadata = async (itemId, patch = {}) => {
    const next = await patchItemMetadataNow(itemId, patch)
    if (patch.gal?.config !== undefined) warmContainers(next)
    return next
  }
  const patchItemMetadataNow = (itemId, patch = {}) => updateItem(itemId, (item) => {
    const next = { ...item }
    if (patch.workKey !== undefined) next.workKey = String(patch.workKey || '')
    if (patch.title !== undefined && String(patch.title || '').trim()) next.title = String(patch.title).trim()
    const published = Date.parse(String(patch.publishedAt || ''))
    if (Number.isFinite(published)) next.publishedAt = new Date(published).toISOString()
    // gal.config：tag 脚本（gal-layout）写的配置补丁。默认合并（补丁里写了的字段替换原来的，值为 null = 删掉回默认），replace = 整体替换
    if (patch.gal && typeof patch.gal === 'object' && !Array.isArray(patch.gal) && patch.gal.config !== undefined) {
      const applied = applyGalConfigPatchWithWarnings(item.config, patch.gal.config, { replace: patch.gal.replace === true })
      next.config = applied.config
      // 这次补丁里被丢掉 / 夹住的内容记在条目上（替换上一次的），列表页的渲染诊断里能看到
      if (applied.warnings.length) next.configWarnings = cleanWarnings(applied.warnings).slice(0, 20)
      else delete next.configWarnings
    }
    return { ...next, updatedAt: new Date().toISOString() }
  })
  const patchUnitMetadata = async (itemId, unitId) => (await readItem(itemId)).mediaUnits.find((unit) => unit.unitId === unitId)

  const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0))
  const MAX_NODE_PROGRESS = 3000
  // 选项的选择：{ '步序号:指令序号': 选了第几个 }。只收格式对的、数量有上限，不信任页面传来的任意内容
  const cleanChoices = (value) => {
    const out = {}
    if (!value || typeof value !== 'object') return out
    for (const [id, picked] of Object.entries(value).slice(0, 200)) {
      const n = Math.floor(Number(picked))
      if (/^\d{1,6}:\d{1,6}$/.test(id) && Number.isFinite(n) && n >= 1 && n <= 99) out[id] = n
    }
    return out
  }
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
      const choices = patch.choices !== undefined ? cleanChoices(patch.choices) : current.nodes[sectionId]?.choices || {}
      current.nodes[sectionId] = { ratio, title: String(patch.sectionTitle || current.nodes[sectionId]?.title || ''), updatedAt: now, ...(Object.keys(choices).length ? { choices } : {}), ...(ratio >= 0.98 ? { completedAt: current.nodes[sectionId]?.completedAt || now } : {}) }
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
    refreshIndex,
    getRandomVoice,
    getResource,
    getRenderThumb,
    putRenderThumb,
    getThumbnail,
    getThumbnailFile,
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
