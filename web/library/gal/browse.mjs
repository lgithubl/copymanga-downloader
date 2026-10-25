// Gal 的「浏览节点」：一个 Gal 媒体（= 一个目录）里，用户从首页一层层点进去，最后到播放页。
// 前端不知道目录长什么样，只认节点：每个节点是 { id, kind, title, parent, breadcrumb, items… }，
// 选项自带下一个节点的 id；点了就用那个 id 再取一次（走通用的 reader?sectionId=<节点 id>）：
// 取到的是文本（kind=player）就按文本渲染，取到的是选项（kind=cards）就继续按选项渲染。
//
// 节点就是真实目录树（脚本根下的每个目录一个节点，目录里的脚本是叶子），层级、标签、头像、合并这些都由条目元数据里的
// config 决定（见 config.mjs）——引擎不内置任何游戏的目录知识。
//
// 节点 kind：
//   cards   卡片（目录卡片和脚本卡片混排：目录在前；每张卡片可带来源标记 badge、缩略图、一行摘要）
//   player  播放页（叶子，带规范场景）
//
// 节点 id（不透明字符串，前端原样传回）：
//   ''                          默认脚本根（首页）
//   d:<相对路径>[#页码]          目录                s:<相对路径>   脚本（播放页）
//   g:<编码后的分组键>:<相对路径>[#页码]   虚拟目录（config.groups：脚本名按正则分组，比如同一角色的几个脚本）
//   v:<编码后的目录 id>[#页码]            适配器给的「目录」（adapter.catalog：从数据文件里读出来的列表，比如活动 / 角色 / 他们的剧情）；有 catalog 时首页就是它
//   @<脚本根 id>|d:…  /  @<脚本根 id>|s:…  /  @<脚本根 id>|g:…   非默认的脚本根（比如另一种语言的文本）
// 列表节点（d: / g: / v: / 首页）的 id 还能带「视图参数」：`<基础 id>|q=<筛选词>&s=<排序>&n=<每页条数>[#页码]`（只写和默认不同的）。
//   q 筛选（名称 / 标题 / 编号，不分大小写的子串）；s 排序 default | name | name_desc；n 每页条数（25 / 50 / 100 / 200 / 500）。
//   参数在 id 里，所以刷新页面 / 分享链接 / 前端「返回上一层」都能原样还原（目录和脚本的名字里不会有 | 和 #，见 readEntries）。
//   脚本节点 s:… 不带视图参数（进度按它的 id 记）。
// 路径都相对「脚本根」。合并目录（config.merge）：列某个目录时，把它指定的几个子目录的内容合进同一个列表，
// 这几个子目录本身不再出现；脚本节点 id 仍是真实路径，所以进度/历史不受影响。
// 大目录靠翻页和按需读取：只列当前目录，读脚本头/内容只对当前页做，并按 mtime 缓存。
import { createHash } from 'node:crypto'
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { galAdapter, galAdapterIds, sniffGalAdapter } from './adapters/index.mjs'
import { expandTemplate, globToRegExp, normalizeGalConfig, parentRegExp } from './config.mjs'
import { buildGraphCatalog } from './graph.mjs'
import { contextStats, invalidateContexts, loadAdapterContext } from './context.mjs'
import { safeRelPath } from './paths.mjs'
import { buildScene, firstBackgroundSrc } from './scene.mjs'
import { decodeTextFile } from '../text-decode.mjs'

// ---------- 跨请求缓存（进程内）----------
// 浏览每次请求都会新建一个 provider，所以会反复读的东西必须缓存在模块级：
//   · 脚本是不是这种格式（读 8KB 头嗅探）：按 文件 mtime+size 缓存——不缓存的话，一个目录里 1000 个脚本，每翻一页都要 1000 次 stat + open + read
//   · 目录里有什么（目录 / 通过嗅探的脚本）：按 目录 mtime 缓存（里面增删改名 mtime 就变）
//   · 脚本摘要（缩略图 / 台词摘要 / 是否带视频）：按 文件 mtime+size + 配置指纹缓存，另有 5 分钟 TTL（缩略图文件可能后来才生成）
//   · 目录卡片上的数量：按 目录 mtime 缓存
// 都是 LRU，有上限。
const CACHE_TTL_MS = 5 * 60 * 1000
const sniffCache = new Map()
const entriesCache = new Map()
const scriptInfoCache = new Map()
const countCache = new Map()
const expressionCache = new Map()
// 手动刷新（界面「更多 → 刷新索引」）：丢掉这个媒体目录的全部缓存——适配器上下文（文件索引 + 名称表）、嗅探结果、目录列表、脚本摘要、数量
export function invalidateBrowseCaches(mediaDir) {
  let n = invalidateContexts(mediaDir)
  for (const map of [sniffCache, entriesCache, scriptInfoCache, countCache, expressionCache]) {
    for (const key of [...map.keys()]) if (String(key).startsWith(`${mediaDir}${path.sep}`) || String(key).startsWith(`${mediaDir}|`)) { map.delete(key); n += 1 }
  }
  return n
}
function cacheGet(map, key, ttl = 0) {
  const hit = map.get(key)
  if (hit === undefined) return undefined
  if (ttl && Date.now() - hit.at > ttl) { map.delete(key); return undefined }
  map.delete(key)
  map.set(key, hit)   // 最近用过 = 放到最后
  return hit.value
}
function cacheSet(map, key, value, max) {
  map.delete(key)
  map.set(key, { value, at: Date.now() })
  if (map.size > max) map.delete(map.keys().next().value)
}
// 并发上限地 map（读文件 / stat 这类 IO，一个个 await 太慢，全放出去又会占满线程池）
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i], i) }
  })
  await Promise.all(workers)
  return out
}
const IO_CONCURRENCY = 16

// ---------- 列表视图（筛选 / 排序 / 每页条数）----------
export const GAL_PAGE_SIZES = [10, 25, 50, 100, 200, 500]
export const GAL_SORTS = [{ id: 'default', label: '默认（目录在前）' }, { id: 'name', label: '名称 ↑' }, { id: 'name_desc', label: '名称 ↓' }]
export function parseGalView(optionText = '') {
  let params
  try { params = new URLSearchParams(optionText) } catch { params = new URLSearchParams() }
  const size = Math.floor(Number(params.get('n')))
  const sort = params.get('s') || 'default'
  return {
    q: String(params.get('q') || '').trim().slice(0, 100),
    sort: GAL_SORTS.some((entry) => entry.id === sort) ? sort : 'default',
    size: GAL_PAGE_SIZES.includes(size) ? size : 0,   // 0 = 用配置里的默认
  }
}
// 只写和默认不同的；没有就是空串
export function galViewSuffix(view = {}) {
  const params = new URLSearchParams()
  if (view.q) params.set('q', view.q)
  if (view.sort && view.sort !== 'default') params.set('s', view.sort)
  if (view.size) params.set('n', String(view.size))
  const text = params.toString()
  return text ? `|${text}` : ''
}

const naturalCompare = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
const extOf = (file) => path.extname(file).slice(1).toLowerCase()
const stemOf = (file) => path.basename(file, path.extname(file))
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const hidden = (name) => name.startsWith('.')
const parentRel = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1)
export const MAX_SCRIPT_BYTES = 4 * 1024 * 1024

// 台词摘要：第一句有字的台词，去掉标记，截断
const excerptOf = (scene) => {
  for (const step of scene.steps) {
    for (const command of step.commands) {
      if (command.op !== 'text') continue
      const text = (command.segments || []).map((s) => s.text).join('').replace(/\s+/g, ' ').trim()
      if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text
    }
  }
  return ''
}

// mediaDir：媒体目录（绝对路径）。config：条目元数据里的 config（原样传，这里规整）。
// resolveAsset(rel) → 磁盘真实路径（找不到抛错）；用来确认缩略图存在。
export function createBrowseProvider({ mediaDir, config: rawConfig, adapters, maxScriptBytes = MAX_SCRIPT_BYTES, resolveAsset }) {
  const config = normalizeGalConfig(rawConfig)
  const scriptExtensions = config.scriptExtensions
  const pageSize = config.pageSize
  const sets = config.scriptRoots
  const defaultSet = sets[0]
  const setById = (id) => sets.find((s) => s.id === id)
  const mergeRules = config.merge.map((rule) => ({ ...rule, test: parentRegExp(rule.parent) }))
  const groupRules = config.groups.map((rule) => ({ ...rule, test: parentRegExp(rule.parent), re: new RegExp(rule.pattern) }))
  // 虚拟目录（config.views）：<parent>/<as> 这个路径磁盘上没有，列它时把来源目录（dirs，没写 = parent 自己）里 stem 匹配 match 的脚本收进来
  const viewRules = config.views.map((rule) => ({ ...rule, rel: rule.parent ? `${rule.parent}/${rule.as}` : rule.as, re: rule.match ? new RegExp(rule.match) : null }))
  const viewAt = (rel) => viewRules.find((rule) => rule.rel === rel) || null
  const viewsUnder = (dirRel) => viewRules.filter((rule) => rule.parent === dirRel)
  const viewTakes = (rule, stem) => !rule.re || rule.re.test(stem)
  // 独占视图（exclusive，来源是 parent 自己）收走的脚本：在 parent 的列表里不再出现，它的「父节点」是这个视图
  const exclusiveViewOf = (dirRel, stem) => viewsUnder(dirRel).find((rule) => rule.exclusive && !rule.dirs.length && viewTakes(rule, stem)) || null
  const dirThumbRules = config.dirThumbs.map((rule) => ({ ...rule, nameRe: rule.name ? new RegExp(rule.name) : null }))
  // 缓存键里要带的「配置指纹」：配置变了（脚本扩展名 / 隐藏目录 / 适配器 / 缩略图规则…）缓存就不能沿用
  const entriesCfgKey = `${config.scriptExtensions.join(',')}|${config.hiddenDirs.join(',')}|${(adapters || []).join(',')}`
  const infoCfgKey = createHash('sha1').update(JSON.stringify([mediaDir, config.scriptThumbs, config.thumbsDirs, config.resourceRoots, config.stripPrefixes, config.scriptIndex, config.adapterOptions, config.rawIgnore, adapters])).digest('hex').slice(0, 16)
  let namesCache = null

  const absOf = (set, rel) => path.join(mediaDir, ...(set.dir ? set.dir.split('/') : []), ...(rel ? rel.split('/') : []))
  const mergeRuleAt = (dirRel) => mergeRules.find((rule) => rule.test.test(dirRel)) || null
  const groupRuleAt = (dirRel) => groupRules.find((rule) => rule.test.test(dirRel)) || null
  const groupKeyOf = (rule, stem) => {
    const key = rule ? rule.re.exec(stem)?.[1] : ''
    return key && key.length <= 100 ? key : ''
  }
  // 脚本所在列表（合并后的父目录）的分组键；不在分组规则下 = ''
  const scriptGroupKey = (rel) => groupKeyOf(groupRuleAt(effectiveParentDir(rel)), stemOf(rel))
  // d 是不是某个合并规则里被合并掉的子目录（返回规则；不是返回 null）
  const mergedSourceRule = (dirRel) => {
    if (!dirRel) return null
    const rule = mergeRuleAt(parentRel(dirRel))
    return rule && rule.dirs.includes(baseName(dirRel)) ? rule : null
  }
  // 一个路径（目录或脚本）在界面上的「父节点目录」：在被合并掉的子目录里的，父节点是合并它们的那个目录
  const effectiveParentDir = (rel) => {
    const dir = parentRel(rel)
    const taken = scriptExtensions.includes(extOf(rel)) ? exclusiveViewOf(dir, stemOf(rel)) : null
    if (taken) return taken.rel
    return mergedSourceRule(dir) ? parentRel(dir) : dir
  }

  // ---------- 节点 id ----------
  function parseNodeId(raw) {
    const textId = String(raw ?? '')
    const m = /^(.*?)(?:#(\d{1,6}))?$/s.exec(textId)
    let body = m[1]
    const page = Math.max(1, Number(m[2]) || 1)
    let set = defaultSet
    if (body.startsWith('@')) {
      const bar = body.indexOf('|')
      if (bar < 0) throw fail(`无效的节点：${textId.slice(0, 80)}`)
      set = setById(body.slice(1, bar))
      if (!set) throw fail('没有这个文本版本', 404)
      body = body.slice(bar + 1)
    }
    // 视图参数：基础 id 后面第一个 |（目录 / 脚本名里不会有 |）
    let view = parseGalView('')
    const optionsAt = body.indexOf('|')
    if (optionsAt >= 0) {
      view = parseGalView(body.slice(optionsAt + 1))
      body = body.slice(0, optionsAt)
    }
    if (!body) return { set, kind: 'dir', rel: '', page, view }
    const colon = body.indexOf(':')
    const tag = colon < 0 ? body : body.slice(0, colon)
    const arg = colon < 0 ? '' : body.slice(colon + 1)
    if (tag === 'v') {
      let id = ''
      try { id = decodeURIComponent(arg) } catch { /* 无效 */ }
      if (!id || id.length > 200) throw fail(`无效的节点：${textId.slice(0, 80)}`)
      return { set, kind: 'virtual', key: id, rel: '', page, view }
    }
    if (tag === 'g') {
      const split = arg.indexOf(':')
      let key = ''
      try { key = split < 0 ? '' : decodeURIComponent(arg.slice(0, split)) } catch { /* 无效 */ }
      const groupRel = split < 0 ? null : safeRelPath(arg.slice(split + 1))
      if (!key || groupRel === null) throw fail(`无效的节点：${textId.slice(0, 80)}`)
      return { set, kind: 'group', key, rel: groupRel, page, view }
    }
    if (tag !== 'd' && tag !== 's') throw fail(`无效的节点：${textId.slice(0, 80)}`)
    const rel = safeRelPath(arg)
    if (rel === null) throw fail('无效的路径', 400)
    return { set, kind: tag === 'd' ? 'dir' : 'script', rel, page: tag === 'd' ? page : 1, view }
  }
  const idOf = (set, _kind, rel) => `${set === defaultSet ? '' : `@${set.id}|`}s:${rel}`
  // 页码总是写出来（列表节点的 id 固定带 #页码），好和「回到第几页」对得上
  const dirNodeId = (set, rel, page, view = null) => {
    const options = galViewSuffix(view || {})
    if (!rel && set === defaultSet) return `${options}${page > 1 ? `#${page}` : ''}`
    return `${set === defaultSet ? '' : `@${set.id}|`}d:${rel}${options}${page > 1 ? `#${page}` : ''}`
  }

  const virtualNodeId = (id, page, view = null) => `v:${encodeURIComponent(id)}${galViewSuffix(view || {})}${page > 1 ? `#${page}` : ''}`
  const groupNodeId = (set, dirRel, key, page, view = null) => `${set === defaultSet ? '' : `@${set.id}|`}g:${encodeURIComponent(key)}:${dirRel}${galViewSuffix(view || {})}${page > 1 ? `#${page}` : ''}`

  // ---------- 列表视图：筛选 → 排序 → 分页 ----------
  // describe(entry) → { title, extra }：用来筛选（title + extra 里包含 q，不分大小写）和按名称排序（按 title 的自然序）。
  // 筛选 / 排序在整张列表（只有名字，便宜）上做，读脚本摘要 / 缩略图 / 数量只对当前页做。
  async function pageOfView(entries, view, page, describe) {
    const size = view.size || pageSize
    let list = entries
    if (view.q || view.sort === 'name' || view.sort === 'name_desc') {
      const described = await Promise.all(entries.map(async (entry) => ({ entry, ...(await describe(entry)) })))
      let rows = described
      if (view.q) {
        const needle = view.q.toLowerCase()
        rows = rows.filter((row) => `${row.title}\n${row.extra || ''}`.toLowerCase().includes(needle))
      }
      if (view.sort === 'name') rows = [...rows].sort((a, b) => naturalCompare(a.title, b.title))
      else if (view.sort === 'name_desc') rows = [...rows].sort((a, b) => naturalCompare(b.title, a.title))
      list = rows.map((row) => row.entry)
    }
    const total = list.length
    const pageCount = Math.max(1, Math.ceil(total / size))
    const current = Math.min(page, pageCount)
    return { slice: list.slice((current - 1) * size, current * size), total, pageCount, current, size, unfiltered: entries.length }
  }
  // 节点上给前端的视图信息：当前筛选 / 排序 / 每页条数，和可选项；viewBase = 不带视图参数和页码的基础 id（前端拼新 id 用）
  const viewInfo = (view, paged, viewBase) => ({
    viewBase,
    view: { q: view.q, sort: view.sort, size: paged.size, defaultSize: pageSize, sizes: GAL_PAGE_SIZES, sorts: GAL_SORTS, unfiltered: paged.unfiltered },
  })

  // ---------- 读目录 / 脚本 ----------
  async function readNames() {
    if (namesCache) return namesCache
    const merged = {}
    for (const file of [...config.namesFiles].reverse()) {   // 前面的文件优先
      try {
        const abs = path.join(mediaDir, ...file.split('/'))
        if ((await stat(abs)).size > 1024 * 1024) continue
        const data = JSON.parse(decodeTextFile(await readFile(abs)).text)
        if (data && typeof data === 'object' && !Array.isArray(data)) Object.assign(merged, data)
      } catch { /* 没有这个文件 */ }
    }
    namesCache = merged
    return merged
  }
  const viewLabels = Object.fromEntries(config.views.filter((rule) => rule.label).map((rule) => [rule.as, rule.label]))
  const labelOf = async (name) => config.labels[name] || viewLabels[name] || String((await readNames())[name] || '') || name

  // 脚本索引：{ 脚本名 → { thumb, badge } }（config.scriptIndex；读一次目录，本次请求内缓存）
  const indexRules = config.scriptIndex.map((rule) => ({ ...rule, re: new RegExp(rule.pattern) }))
  let scriptIndexCache = null
  const resourceRelOf = (rel) => {
    for (const root of [...config.resourceRoots].filter(Boolean).sort((a, b) => b.length - a.length)) if (rel.startsWith(`${root}/`)) return rel.slice(root.length + 1)
    return rel
  }
  async function readScriptIndex() {
    if (scriptIndexCache) return scriptIndexCache
    const map = new Map()
    for (const rule of indexRules) {
      let names = []
      try { names = (await readdir(path.join(mediaDir, ...rule.dir.split('/')))).sort(naturalCompare) } catch { /* 没有这个目录 */ }
      for (const name of names) {
        const m = rule.re.exec(name)
        if (!m || hidden(name)) continue
        const key = rule.key.replace(/\{(\d)\}/g, (_, n) => m[Number(n)] ?? '')
        if (key && !map.has(key)) map.set(key, { thumb: resourceRelOf(`${rule.dir}/${name}`), badge: rule.badge })
      }
    }
    scriptIndexCache = map
    return map
  }

  // 适配器的 catalog：适配器从数据文件（名称表、缩略图目录…）里读出一棵「目录树」{ id, title, subtitle?, thumb?, badge?, children? | script? }，
  // 有它时首页和列表都由它给；脚本卡片点进去还是 s:<路径>（进度按路径记，和从哪个列表进来无关）。每次请求现取（上下文按文件变化失效），数据文件更新了列表跟着变。
  const catalogAdapter = (adapters || []).map((id) => { try { return galAdapter(id) } catch { return null } }).find((a) => typeof a?.catalog === 'function')
  let catalogCache
  let graphProblems = []
  // 节点图要用的几个能力：目录通配展开 / 列目录里的脚本（含「扩展名对但没人认」的文件）/ 名称 / 缩略图
  const graphHelpers = () => ({
    async expandGlob(glob) {
      const segments = glob === '.' || glob === '' ? [] : glob.split('/')
      let current = ['']
      let exists = true
      for (const segment of segments) {
        const next = []
        for (const dir of current) {
          if (segment.includes('*')) {
            const got = await readEntries(defaultSet, dir)
            if (!got) { exists = false; continue }
            const re = globToRegExp(segment)
            for (const entry of got.dirs) if (re.test(entry.name)) next.push(entry.rel)
          } else {
            const rel = dir ? `${dir}/${segment}` : segment
            const info = await stat(absOf(defaultSet, rel)).catch(() => null)
            if (info?.isDirectory()) next.push(rel)
            else if (!dir || current.length === 1) exists = Boolean(info) || exists
          }
        }
        current = next
      }
      return { dirs: [...new Set(current)].sort(naturalCompare), exists: exists || segments.length === 0 }
    },
    async listScripts(rel) {
      const got = await readEntries(defaultSet, safeRelPath(rel) ?? '')
      if (!got) return { scripts: [], rejected: [], exists: false }
      return { scripts: got.scripts.map((script) => ({ rel: script.rel, stem: script.stem })), rejected: got.rejected, exists: true }
    },
    labelOf,
    async thumbOf(template, vars) {
      const candidate = expandTemplate(template, vars)
      if (!candidate) return ''
      try { await resolveAsset(candidate); return candidate } catch { return '' }
    },
    async scriptThumb(stem) {
      for (const template of config.scriptThumbs) {
        const paths = template.includes('{thumbsDir}') ? config.thumbsDirs.map((thumbsDir) => expandTemplate(template, { stem, thumbsDir })) : [expandTemplate(template, { stem })]
        for (const candidate of paths) {
          if (!candidate) continue
          try { await resolveAsset(candidate); return candidate } catch { /* 下一个 */ }
        }
      }
      return ''
    },
  })
  async function getCatalog() {
    if (catalogCache !== undefined) return catalogCache
    catalogCache = null
    const ctx = catalogAdapter ? await contextOf(catalogAdapter.id) : null
    // 适配器给的脚本路径是相对媒体目录的；节点 id 里的路径相对脚本根（和目录浏览一致），不在脚本根下的丢掉
    const prefix = defaultSet.dir ? `${defaultSet.dir}/` : ''
    const localize = (node) => ({
      ...node,
      ...(node.children ? { children: node.children.map(localize).filter((c) => c.children || c.script) } : {}),
      ...(node.script !== undefined ? { script: node.script.startsWith(prefix) ? node.script.slice(prefix.length) : '' } : {}),
    })
    let raw = null
    graphProblems = []
    if (config.nodes) {
      // 节点图（config.nodes）优先于适配器的 catalog：首页和所有列表都由它给
      const adapterRaw = ctx ? catalogAdapter.catalog(ctx) : null
      const findAdapterNode = (id, list = adapterRaw?.children || []) => {
        for (const child of list) {
          if (child.id === id) return child
          const hit = child.children ? findAdapterNode(id, child.children) : null
          if (hit) return hit
        }
        return null
      }
      const built = await buildGraphCatalog({ nodes: config.nodes, prefix, adapterCatalog: adapterRaw ? { top: adapterRaw.children || [], find: findAdapterNode } : null, ...graphHelpers() })
      raw = built.tree
      graphProblems = built.problems
    } else raw = ctx ? catalogAdapter.catalog(ctx) : null
    const tree = raw ? localize(raw) : null
    if (tree?.children?.length) {
      const byId = new Map()
      const parentOfId = new Map()     // 目录 id → 父目录 id（顶层 = ''）
      const scriptParent = new Map()   // 脚本路径 → 第一个收了它的目录 id
      const scriptEntry = new Map()
      const walk = (node, nodeId) => {
        for (const child of node.children || []) {
          if (!child?.id) continue
          if (child.script) {
            if (!scriptParent.has(child.script)) { scriptParent.set(child.script, nodeId); scriptEntry.set(child.script, child) }
          } else if (!byId.has(child.id)) {
            byId.set(child.id, child)
            parentOfId.set(child.id, nodeId)
            walk(child, child.id)
          }
        }
      }
      walk(tree, '')
      catalogCache = { tree, byId, parentOfId, scriptParent, scriptEntry }
    }
    return catalogCache
  }
  const catalogChildren = (catalog, id) => (id ? catalog.byId.get(id)?.children : catalog.tree.children) || []
  const catalogAncestors = (catalog, id) => {   // 从顶层到 id（含）
    const chain = []
    for (let cur = id; cur; cur = catalog.parentOfId.get(cur)) chain.unshift({ id: cur, title: catalog.byId.get(cur)?.title || cur })
    return chain
  }
  const catalogPageOf = (catalog, parentId, childId) => {
    const index = catalogChildren(catalog, parentId).findIndex((c) => c.id === childId)
    return Math.floor(Math.max(0, index) / pageSize) + 1
  }
  const catalogNodeRef = (parentId, page) => (parentId ? virtualNodeId(parentId, page) : dirNodeId(defaultSet, '', page))
  const catalogCrumbs = (catalog, id, tail) => [{ id: dirNodeId(defaultSet, '', 1), title: '首页' }, ...catalogAncestors(catalog, id).map((c) => ({ id: virtualNodeId(c.id, 1), title: c.title })), ...(tail ? [tail] : [])]
  const catalogItem = (child) => (child.children
    ? { type: 'dir', id: child.id, title: child.title, subtitle: child.subtitle ?? `${child.children.length} 项`, thumb: child.thumb || '', ...(child.thumb ? {} : { thumbWhy: ['适配器目录（catalog）没有给缩略图'] }), badge: child.badge || '', node: virtualNodeId(child.id, 1) }
    : { type: 'script', id: child.script, title: child.title, subtitle: child.subtitle || '', thumb: child.thumb || '', ...(child.thumb ? {} : { thumbWhy: ['适配器目录（catalog）没有给缩略图'] }), badge: child.badge || '', node: idOf(defaultSet, 'script', child.script) })

  async function catalogNode(catalog, id, page, view) {
    const holder = id ? catalog.byId.get(id) : catalog.tree
    if (!holder?.children) throw fail('目录不存在', 404)
    const paged = await pageOfView(holder.children, view, page, (child) => ({ title: child.title, extra: `${child.subtitle || ''} ${child.script ? stemOf(child.script) : child.id}` }))
    const parentId = id ? catalog.parentOfId.get(id) : null
    return {
      node: {
        id: id ? virtualNodeId(id, paged.current, view) : dirNodeId(defaultSet, '', paged.current, view),
        kind: 'cards',
        title: id ? holder.title : '首页',
        parent: id ? catalogNodeRef(parentId, catalogPageOf(catalog, parentId, id)) : null,
        breadcrumb: catalogCrumbs(catalog, id),
        sets: setChoices(defaultSet),
        pageSize: paged.size,
        page: paged.current,
        pageCount: paged.pageCount,
        total: paged.total,
        items: paged.slice.map(catalogItem),
        ...(holder.text ? { text: holder.text } : {}),
        ...(holder.related?.length ? { related: holder.related.map((rel) => ({ title: rel.title, node: virtualNodeId(rel.id, 1) })) } : {}),
        ...viewInfo(view, paged, id ? virtualNodeId(id, 1) : ''),
      },
    }
  }

  const adapterContexts = new Map()   // 适配器 id → ctx（本次请求内）
  async function contextOf(adapterId) {
    if (!adapterId) return null
    if (!adapterContexts.has(adapterId)) {
      adapterContexts.set(adapterId, await loadAdapterContext({ adapter: galAdapter(adapterId), mediaDir, config }).catch(() => null))
    }
    return adapterContexts.get(adapterId)
  }

  async function scriptAdapterOf(abs) {
    let info
    try { info = await stat(abs) } catch { return '' }
    if (!info.isFile() || !info.size || info.size > maxScriptBytes || !scriptExtensions.includes(extOf(abs))) return ''
    const key = `${abs}|${info.mtimeMs}|${info.size}|${(adapters || []).join(',')}`
    const cached = cacheGet(sniffCache, key)
    if (cached !== undefined) return cached
    let id = ''
    const handle = await open(abs, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(8192, info.size))
      await handle.read(buffer, 0, buffer.length, 0)
      id = sniffGalAdapter(decodeTextFile(buffer).text, adapters)
    } finally { await handle.close() }
    cacheSet(sniffCache, key, id, 100000)
    return id
  }

  // 一个目录里直接有什么：目录 + 通过嗅探的脚本。按目录 mtime 缓存（见文件开头），嗅探并发读头
  async function readEntries(set, rel, origin = '') {
    const dirAbs = absOf(set, rel)
    let dirInfo
    try { dirInfo = await stat(dirAbs) } catch { return null }
    const cacheKey = `${dirAbs}|${dirInfo.mtimeMs}|${entriesCfgKey}`
    let base = cacheGet(entriesCache, cacheKey, CACHE_TTL_MS)
    if (!base) {
      let entries
      try { entries = await readdir(dirAbs, { withFileTypes: true }) } catch { return null }
      const dirs = []
      const files = []
      const names = new Set(entries.map((entry) => entry.name))
      // 只有编译产物（.rpyc / .xxxc）没有源文件的脚本：解析不了，也不会出现在列表里——记下来，列表页的问题里报
      const compiledOnly = entries.filter((entry) => entry.isFile() && /c$/i.test(entry.name) && scriptExtensions.includes(extOf(entry.name).slice(0, -1)) && !names.has(entry.name.slice(0, -1))).map((entry) => (rel ? `${rel}/${entry.name}` : entry.name))
      for (const entry of entries) {
        if (hidden(entry.name) || entry.name.includes('|') || entry.name.includes('#')) continue
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (config.hiddenDirs.includes(entry.name)) continue
          dirs.push({ type: 'dir', name: entry.name, rel: childRel })
        } else if (entry.isFile() && scriptExtensions.includes(extOf(entry.name))) files.push({ name: entry.name, rel: childRel })
      }
      const sniffed = await mapLimit(files, IO_CONCURRENCY, async (file) => ((await scriptAdapterOf(absOf(set, file.rel))) ? file : null))
      const scripts = sniffed.filter(Boolean).map((file) => ({ type: 'script', name: file.name, stem: stemOf(file.name), rel: file.rel }))
      // 扩展名对、但没有适配器认得的文件：以前悄悄丢掉，规则对不上就永远发现不了；现在记下来，列表页的诊断里报
      const rejected = sniffed.map((file, i) => (file ? null : files[i].rel)).filter(Boolean)
      base = { dirs, scripts, rejected, compiledOnly }
      cacheSet(entriesCache, cacheKey, base, 3000)
    }
    return { dirs: base.dirs.map((entry) => ({ ...entry, origin })), scripts: base.scripts.map((entry) => ({ ...entry, origin })), rejected: base.rejected || [], compiledOnly: base.compiledOnly || [] }
  }

  // 一个目录里的内容：目录在前、脚本在后，自然序（合并目录时，几个来源的内容混在一起排）。
  // 脚本要被适配器认得才算（读 8KB 头，缓存）
  async function listDir(set, rel) {
    const view = viewAt(rel)
    let own
    const rejected = []
    const compiledOnly = []
    if (view) {
      own = { dirs: [], scripts: [] }
      for (const sourceName of view.dirs.length ? view.dirs : ['']) {
        const sourceRel = [view.parent, sourceName].filter(Boolean).join('/')
        const got = await readEntries(set, sourceRel, view.dirs.length ? (view.badges[sourceName] || sourceName) : '')
        if (got) { own.scripts = own.scripts.concat(got.scripts.filter((script) => viewTakes(view, script.stem))); rejected.push(...got.rejected) }
      }
    } else {
      own = await readEntries(set, rel)
      if (own) { rejected.push(...own.rejected); compiledOnly.push(...own.compiledOnly) }
    }
    if (!own) throw fail('目录不存在', 404)
    const rule = view ? null : mergeRuleAt(rel)
    let dirs = own.dirs
    let scripts = own.scripts
    // 这个目录下挂着的虚拟目录：独占的收走脚本；有内容的才列出来
    for (const sub of viewsUnder(rel)) {
      if (sub.exclusive && !sub.dirs.length) scripts = scripts.filter((script) => !viewTakes(sub, script.stem))
      const inside = await listDir(set, sub.rel).catch(() => null)
      if (inside?.allScripts.length) dirs = dirs.concat({ type: 'dir', name: sub.as, rel: sub.rel, origin: '', virtual: true })
    }
    if (rule) {
      dirs = dirs.filter((d) => !rule.dirs.includes(d.name))
      for (const sourceName of rule.dirs) {
        const sourceRel = rel ? `${rel}/${sourceName}` : sourceName
        const got = await readEntries(set, sourceRel, rule.badges[sourceName] || sourceName)
        if (!got) continue
        rejected.push(...got.rejected)
        dirs = dirs.concat(got.dirs)
        scripts = scripts.concat(got.scripts)
      }
    }
    dirs.sort((a, b) => naturalCompare(a.name, b.name))
    scripts.sort((a, b) => naturalCompare(a.name, b.name))
    // 分组：能匹配分组规则的脚本收进虚拟目录（一个键一张卡片），其余照常列出
    const groupRule = groupRuleAt(rel)
    const groups = []
    let rest = scripts
    if (groupRule) {
      const byKey = new Map()
      rest = []
      for (const script of scripts) {
        const key = groupKeyOf(groupRule, script.stem)
        if (!key) { rest.push(script); continue }
        if (!byKey.has(key)) byKey.set(key, [])
        byKey.get(key).push(script)
      }
      for (const [key, members] of byKey) groups.push({ type: 'group', name: key, key, rel: `g:${key}`, members })
      groups.sort((a, b) => naturalCompare(a.key, b.key))
    }
    return { dirs, groups, scripts: rest, allScripts: scripts, all: [...dirs, ...groups, ...rest], rejected, compiledOnly }
  }

  // 脚本摘要：缩略图候选（config 里的模板 → 脚本里第一张存在的背景图）、台词摘要、是不是带视频。按 mtime 缓存
  async function scriptInfo(set, rel) {
    const abs = absOf(set, rel)
    const info = await stat(abs)
    const key = `${abs}|${info.mtimeMs}|${info.size}|${infoCfgKey}`
    const cached = cacheGet(scriptInfoCache, key, CACHE_TTL_MS)
    if (cached) return cached
    const adapterId = await scriptAdapterOf(abs)
    let thumb = ''
    let excerpt = ''
    let hasMovie = false
    let scene = null
    let parseError = ''
    try {
      scene = buildScene(adapterId, decodeTextFile(await readFile(abs)).text, await contextOf(adapterId), { rel, stem: stemOf(rel) })
      excerpt = excerptOf(scene)
      hasMovie = scene.steps.some((step) => step.commands.some((c) => c.op === 'movie'))
    } catch (error) { parseError = error?.message || String(error) /* 解析失败：照样列出来，打开时再报错 */ }
    // 这个脚本渲染时会遇到的问题（给列表页的渲染诊断看，和播放页的诊断同一类：解析失败 / 缺资源 / 暂未渲染的指令）
    const issues = []
    if (parseError) issues.push(`解析失败（适配器 ${adapterId || '未识别'}）：${parseError}`)
    if (scene) {
      const unresolved = Object.entries(scene.stats?.unresolved || {})
      if (unresolved.length) issues.push(`缺少资源 ${unresolved.reduce((n, [, c]) => n + c, 0)} 处：${unresolved.slice(0, 5).map(([k, c]) => `${k}×${c}`).join('、')}${unresolved.length > 5 ? ` 等 ${unresolved.length} 种` : ''}`)
      const rawAllow = (config.rawIgnore || []).map((source) => { try { return new RegExp(source, 'i') } catch { return null } }).filter(Boolean)
      const raw = Object.entries(scene.stats?.raw || {}).filter(([cmd]) => !rawAllow.some((re) => re.test(cmd)))
      if (raw.length) issues.push(`暂未渲染的指令 ${raw.reduce((n, [, c]) => n + c, 0)} 条：${raw.slice(0, 5).map(([k, c]) => `${k}×${c}`).join('、')}${raw.length > 5 ? ` 等 ${raw.length} 种` : ''}`)
    }
    // 候选缩略图 + 来源（没找到图时给列表页的诊断面板看：每个来源试了什么、为什么没成）
    const candidates = []
    const why = []
    for (const template of config.scriptThumbs) {
      if (template.includes('{thumbsDir}')) {
        if (!config.thumbsDirs.length) why.push(`scriptThumbs「${template}」：thumbsDirs 为空，模板展开不了`)
        for (const thumbsDir of config.thumbsDirs) candidates.push({ from: 'scriptThumbs', path: expandTemplate(template, { stem: stemOf(rel), thumbsDir }) })
      } else candidates.push({ from: 'scriptThumbs', path: expandTemplate(template, { stem: stemOf(rel) }) })
    }
    if (!config.scriptThumbs.length) why.push('scriptThumbs：未配置')
    const indexed = indexRules.length ? (await readScriptIndex()).get(stemOf(rel)) : null
    if (indexed?.thumb) candidates.push({ from: 'scriptIndex', path: indexed.thumb })
    else why.push(indexRules.length ? `scriptIndex：${indexRules.length} 条规则（目录 ${[...new Set(indexRules.map((r) => r.dir))].join(' / ')}），索引里没有「${stemOf(rel)}」（索引了 ${(await readScriptIndex()).size} 个脚本）` : 'scriptIndex：未配置')
    if (scene) {
      const bg = firstBackgroundSrc(scene)
      if (bg) candidates.push({ from: '脚本第一张背景图', path: bg })
      else why.push(`脚本里没有背景图指令（bg）：${scene.steps.length} 步、${hasMovie ? '只有视频' : '没有画面指令'}`)
    } else why.push(`脚本没解析成功（适配器 ${adapterId}）：${parseError || '未知原因'}`)
    for (const candidate of candidates) {
      if (!candidate.path) { why.push(`${candidate.from}：路径展开失败（含不安全字符？）`); continue }
      try { await resolveAsset(candidate.path); thumb = candidate.path; break } catch (error) { why.push(`${candidate.from}：${candidate.path} → ${error?.code === 'ENOENT' || /not found|不存在|ENOENT/i.test(error?.message || '') ? '文件不存在' : (error?.message || '读不到')}`) }
    }
    const result = { adapterId, thumb, excerpt, hasMovie, badge: indexed?.badge || '', thumbWhy: thumb ? [] : why, issues }
    cacheSet(scriptInfoCache, key, result, 30000)
    return result
  }

  // tried：可选，传一个数组进来，没找到图时把「试了哪些规则 / 路径」写进去（列表页诊断用）
  async function dirThumb(entry, tried = []) {
    const parentName = entry.parentName ?? (entry.rel.includes('/') ? entry.rel.split('/').slice(-2, -1)[0] : '')
    let matched = 0
    for (const rule of dirThumbRules) {
      if (rule.parent !== '*' && rule.parent !== parentName) continue
      if (rule.nameRe && !rule.nameRe.test(entry.name)) continue
      matched += 1
      for (const template of rule.paths) {
        const candidate = expandTemplate(template, { name: entry.name, parent: parentName })
        if (!candidate) { tried.push(`dirThumbs「${template}」：路径展开失败`); continue }
        try { await resolveAsset(candidate); return candidate } catch { tried.push(`dirThumbs：${candidate} → 文件不存在`) }
      }
    }
    if (!matched) tried.push(dirThumbRules.length ? `dirThumbs：${dirThumbRules.length} 条规则里没有匹配（父目录「${parentName || '根'}」、名字「${entry.name}」）` : 'dirThumbs：未配置')
    return ''
  }
  const withWhy = async (entry, extra) => { const tried = []; const thumb = await dirThumb(entry, tried); return { thumb, ...(thumb ? {} : { thumbWhy: tried }), ...extra } }

  // 目录卡片上的数量：直接子项数（合并目录时 = 合并后的数量），不递归。每个目录按 mtime 缓存读出来的数量
  async function countEntries(abs) {
    let info
    try { info = await stat(abs) } catch { return 0 }
    const key = `${abs}|${info.mtimeMs}`
    const cached = cacheGet(countCache, key, CACHE_TTL_MS)
    if (cached !== undefined) return cached
    let count = 0
    try { count = (await readdir(abs)).filter((name) => !hidden(name)).length } catch { count = 0 }
    cacheSet(countCache, key, count, 20000)
    return count
  }
  async function countChildren(set, rel) {
    if (viewAt(rel)) return (await listDir(set, rel)).allScripts.length
    const rule = mergeRuleAt(rel)
    let total = await countEntries(absOf(set, rel))
    if (rule) {
      for (const sourceName of rule.dirs) {
        const sourceAbs = absOf(set, rel ? `${rel}/${sourceName}` : sourceName)
        const inner = await countEntries(sourceAbs)
        const exists = inner > 0 || await stat(sourceAbs).then((i) => i.isDirectory(), () => false)
        if (exists) total = total - 1 + inner   // 被合并掉的子目录本身不算一项，换成它里面的东西
      }
    }
    return Math.max(0, total)
  }

  // ---------- 父级 / 面包屑 ----------
  async function pageOfChild(set, dirRel, childRel) {
    const { all } = await listDir(set, dirRel)
    const index = all.findIndex((e) => e.rel === childRel)
    return Math.floor(Math.max(0, index) / pageSize) + 1
  }
  async function parentOf(set, kind, rel, key = '') {
    if (kind === 'dir' && !rel) return null
    if (kind === 'group') return dirNodeId(set, rel, await pageOfChild(set, rel, `g:${key}`))
    const dir = effectiveParentDir(rel)
    const groupKey = kind === 'script' ? scriptGroupKey(rel) : ''
    if (groupKey) {
      const { allScripts } = await listDir(set, dir)
      const index = allScripts.filter((s) => groupKeyOf(groupRuleAt(dir), s.stem) === groupKey).findIndex((s) => s.rel === rel)
      return groupNodeId(set, dir, groupKey, Math.floor(Math.max(0, index) / pageSize) + 1)
    }
    // 被合并掉的子目录本身（用链接直接进来的）不在父目录的列表里，回到父目录第 1 页
    const page = mergedSourceRule(rel) ? 1 : await pageOfChild(set, dir, rel)
    return dirNodeId(set, dir, page)
  }
  async function breadcrumbOf(set, kind, rel, key = '') {
    const crumbs = [{ id: dirNodeId(set, '', 1), title: sets.length > 1 && set !== defaultSet ? `首页（${set.label || set.id}）` : '首页' }]
    const parts = rel ? rel.split('/') : []
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      const last = i === parts.length - 1
      const isScript = kind === 'script' && last
      if (!isScript && !last && mergedSourceRule(acc)) continue   // 被合并掉的目录不出现在路径里
      const viewParent = isScript ? viewAt(effectiveParentDir(rel)) : null
      if (viewParent && viewParent.rel !== parentRel(rel)) crumbs.push({ id: dirNodeId(set, viewParent.rel, 1), title: await labelOf(viewParent.as) })   // 被独占视图收走的脚本：路径里补上这个视图
      if (isScript && key) crumbs.push({ id: groupNodeId(set, effectiveParentDir(rel), key, 1), title: await labelOf(key) })
      crumbs.push({ id: isScript ? idOf(set, 'script', acc) : dirNodeId(set, acc, 1), title: isScript ? stemOf(parts[i]) : await labelOf(parts[i]) })
    }
    if (kind === 'group') crumbs.push({ id: groupNodeId(set, rel, key, 1), title: await labelOf(key) })
    return crumbs
  }
  const setChoices = (active) => (sets.length > 1 ? sets.map((s) => ({ id: s.id, label: s.label || s.id || '默认', node: dirNodeId(s, '', 1), active: s === active })) : [])

  // ---------- 取节点 ----------
  async function getNodeInner(nodeId, opts = {}) {
    const { set, kind, rel, page, view, key: nodeKey = '' } = parseNodeId(nodeId)
    const catalog = set === defaultSet ? await getCatalog() : null
    if (kind === 'virtual') {
      if (!catalog) throw fail('目录不存在', 404)
      return catalogNode(catalog, nodeKey, page, view)
    }
    if (catalog && kind === 'dir' && !rel) return catalogNode(catalog, '', page, view)
    const key = kind === 'group' ? nodeKey : kind === 'script' ? scriptGroupKey(rel) : ''
    // 脚本在 catalog 里：上一级、面包屑、上一话/下一话都按 catalog 里收它的那个目录来
    const entry = catalog && kind === 'script' ? catalog.scriptEntry.get(rel) : null
    const holderId = entry ? catalog.scriptParent.get(rel) : ''
    const breadcrumb = entry ? catalogCrumbs(catalog, holderId, { id: idOf(set, 'script', rel), title: entry.title }) : await breadcrumbOf(set, kind, rel, key)
    const base = {
      parent: entry ? catalogNodeRef(holderId, holderId ? catalogPageOf(catalog, holderId, entry.id) : catalogPageOf(catalog, '', entry.id)) : await parentOf(set, kind, rel, key).catch(() => null),
      breadcrumb,
      sets: setChoices(set),
      pageSize,
    }

    if (kind === 'group') {
      const rule = groupRuleAt(rel)
      const { allScripts } = await listDir(set, rel).catch(() => { throw fail('目录不存在', 404) })
      const members = rule ? allScripts.filter((s) => groupKeyOf(rule, s.stem) === key) : []
      if (!members.length) throw fail('分组不存在', 404)
      const paged = await pageOfView(members, view, page, (entry) => ({ title: entry.stem, extra: entry.name }))
      const items = await mapLimit(paged.slice, IO_CONCURRENCY, async (entry) => {
        const info = await scriptInfo(set, entry.rel)
        return { type: 'script', id: entry.rel, title: entry.stem, subtitle: [info.hasMovie ? '含视频' : '', info.excerpt].filter(Boolean).join(' · '), thumb: info.thumb, ...(info.thumb ? {} : { thumbWhy: info.thumbWhy }), ...(info.issues?.length ? { issues: info.issues } : {}), badge: entry.origin || info.badge, node: idOf(set, 'script', entry.rel) }
      })
      return { node: { id: groupNodeId(set, rel, key, paged.current, view), kind: 'cards', title: await labelOf(key), ...base, pageSize: paged.size, page: paged.current, pageCount: paged.pageCount, total: paged.total, items, ...viewInfo(view, paged, groupNodeId(set, rel, key, 1)) } }
    }

    if (kind === 'dir') {
      // 脚本根本身读不到（目录没按标准结构放、config 还没调对）：不报错，给一个空的首页 + 提示，让人知道该去跑脚本/改 config
      let listing
      try { listing = await listDir(set, rel) } catch (error) {
        if (rel || error.statusCode !== 404) throw error
        return { node: { id: dirNodeId(set, '', 1), kind: 'cards', title: '首页', ...base, page: 1, pageCount: 1, total: 0, items: [], notice: `脚本根「${set.dir || '.'}」读不到：这个目录没有按标准结构放，请运行元数据脚本 gal-layout 探测并调整配置（或手动改 config）。`, ...viewInfo(view, { size: pageSize, unfiltered: 0 }, dirNodeId(set, '', 1)) } }
      }
      const describe = async (entry) => {
        if (entry.type === 'group') return { title: await labelOf(entry.key), extra: entry.key }
        if (entry.type === 'dir') return { title: await labelOf(entry.name), extra: entry.name }
        return { title: entry.stem, extra: entry.name }
      }
      const paged = await pageOfView(listing.all, view, page, describe)
      const items = await mapLimit(paged.slice, IO_CONCURRENCY, async (entry) => {
        if (entry.type === 'group') {
          const label = await labelOf(entry.key)
          return { type: 'dir', id: entry.rel, title: label, subtitle: `${label !== entry.key ? `${entry.key} · ` : ''}${entry.members.length} 项`, ...(await withWhy({ name: entry.key, parentName: rel ? baseName(rel) : '' })), badge: '', node: groupNodeId(set, rel, entry.key, 1) }
        }
        if (entry.type === 'dir') {
          const label = await labelOf(entry.name)
          const n = await countChildren(set, entry.rel)
          return { type: 'dir', id: entry.name, title: label, subtitle: `${label !== entry.name ? `${entry.name} · ` : ''}${n} 项`, ...(await withWhy(entry)), badge: entry.origin, node: dirNodeId(set, entry.rel, 1) }
        }
        const info = await scriptInfo(set, entry.rel)
        return { type: 'script', id: entry.rel, title: entry.stem, subtitle: [info.hasMovie ? '含视频' : '', info.excerpt].filter(Boolean).join(' · '), thumb: info.thumb, ...(info.thumb ? {} : { thumbWhy: info.thumbWhy }), ...(info.issues?.length ? { issues: info.issues } : {}), badge: entry.origin || info.badge, node: idOf(set, 'script', entry.rel) }
      })
      const title = rel ? await labelOf(baseName(rel)) : '首页'
      return { node: { id: dirNodeId(set, rel, paged.current, view), kind: 'cards', title, ...base, pageSize: paged.size, page: paged.current, pageCount: paged.pageCount, total: paged.total, items, ...viewInfo(view, paged, dirNodeId(set, rel, 1)) } }
    }

    // script
    if (!scriptExtensions.includes(extOf(rel))) throw fail('无效的脚本路径', 400)
    const abs = absOf(set, rel)
    let real
    try {
      real = await realpath(abs)
      const realMedia = await realpath(mediaDir)
      if (!real.startsWith(realMedia + path.sep) || !(await stat(real)).isFile()) throw new Error('x')
    } catch { throw fail('脚本不存在', 404) }
    const adapterId = await scriptAdapterOf(abs)
    if (!adapterId) {
      // 带上试过哪些适配器 + 文件开头，看一眼就知道是格式不对还是适配器没选
      const head = decodeTextFile((await readFile(real)).subarray(0, 120)).text.replace(/\s+/g, ' ').trim()
      throw fail(`不是可识别的脚本（试过：${(adapters?.length ? adapters : galAdapterIds()).join(' / ')}；文件开头：${head || '空'}）`, 400)
    }
    const scene = buildScene(adapterId, decodeTextFile(await readFile(real)).text, await contextOf(adapterId), { rel, stem: stemOf(rel), ...(opts.showMosaic !== undefined ? { showMosaic: opts.showMosaic } : {}) })

    if (entry) {
      const siblings = catalogChildren(catalog, holderId).filter((c) => c.script)
      const at = siblings.findIndex((c) => c.script === rel)
      const neighbour = (c) => (c ? { sectionId: idOf(set, 'script', c.script), title: c.title } : null)
      return {
        node: { id: idOf(set, 'script', rel), kind: 'player', title: entry.title, ...base, rawIgnore: config.rawIgnore, page: 1, pageCount: 1, total: scene.steps.length, items: [] },
        scene,
        sectionNavigation: { prev: at > 0 ? neighbour(siblings[at - 1]) : null, next: at >= 0 && at < siblings.length - 1 ? neighbour(siblings[at + 1]) : null },
      }
    }
    // 上一话/下一话：同一个列表里（合并目录时跨来源）相邻的脚本
    const dir = effectiveParentDir(rel)
    const listed = await listDir(set, dir).catch(() => ({ scripts: [], allScripts: [] }))
    const rule = groupRuleAt(dir)
    const scripts = key ? listed.allScripts.filter((s) => groupKeyOf(rule, s.stem) === key) : listed.scripts
    const at = scripts.findIndex((s) => s.rel === rel)
    const neighbour = (entry) => (entry ? { sectionId: idOf(set, 'script', entry.rel), title: entry.stem } : null)
    return {
      node: { id: idOf(set, 'script', rel), kind: 'player', title: stemOf(rel), ...base, rawIgnore: config.rawIgnore, page: 1, pageCount: 1, total: scene.steps.length, items: [] },
      scene,
      sectionNavigation: { prev: at > 0 ? neighbour(scripts[at - 1]) : null, next: at >= 0 && at < scripts.length - 1 ? neighbour(scripts[at + 1]) : null },
    }
  }

  // 文件索引的状态（适配器上下文的建立时间 / 文件数 / 是否被截断）：给界面「更多」里的索引信息和刷新按钮用
  function indexStatus() {
    const stats = contextStats(mediaDir)
    if (!stats.length) return null
    return {
      builtAt: stats.map((x) => x.builtAt).sort().at(-1),
      files: stats.reduce((n, x) => n + x.files, 0),
      truncated: stats.some((x) => x.truncated),
      limit: Math.max(...stats.map((x) => x.limit)),
      ms: stats.reduce((n, x) => n + x.ms, 0),
      adapters: stats.map((x) => x.adapter),
    }
  }

  // 列表阶段的问题（便宜的检查，不解析脚本）：索引被截断 / 脚本根不存在 / 扩展名对但没有适配器认得的文件 / 适配器没读到数据 / 适配器自己的体检（health）。
  // 规则和目录结构对不上的时候，这里能直接看到，不会「列表是空的却不知道为什么」
  async function problemsOf(parsed, result) {
    const problems = []
    const add = (level, code, message) => problems.push({ level, code, message })
    const status = indexStatus()
    if (status?.truncated) add('warn', 'index-truncated', `文件索引超过上限 ${status.limit} 个被截断，部分场景 / 资源会找不到（现有 ${status.files} 个）`)
    const home = parsed.kind === 'dir' && !parsed.rel
    if (home) {
      for (const set of sets) {
        const info = await stat(absOf(set, '')).catch(() => null)
        if (!info?.isDirectory()) add('error', 'script-root-missing', `脚本根目录不存在：${set.dir || '（媒体目录本身）'}（检查 config.scriptRoots）`)
      }
      if (config.nodes) { await getCatalog(); for (const entry of graphProblems) problems.push(entry) }
      if (catalogAdapter) {
        const catalog = await getCatalog()
        if (!catalog && !config.nodes) add('warn', 'catalog-empty', `适配器 ${catalogAdapter.id} 没有读到可用的数据（场景 / 名称表），已退回按目录浏览——检查目录结构和 adapterOptions.root`)
        else {
          const ctx = await contextOf(catalogAdapter.id)
          if (typeof catalogAdapter.health === 'function' && ctx) for (const entry of catalogAdapter.health(ctx) || []) add(entry.level || 'warn', entry.code || 'adapter', entry.message)
        }
      }
    }
    if (parsed.kind === 'dir' && !(parsed.set === defaultSet && result.node.kind === 'cards' && (config.nodes || catalogAdapter) && (await getCatalog()))) {
      const listed = await listDir(parsed.set, parsed.rel).catch(() => null)
      if (listed?.rejected?.length) add('warn', 'unrecognized-scripts', `${listed.rejected.length} 个扩展名对的文件没有适配器认得（格式不符），没有显示：${listed.rejected.slice(0, 5).map(baseName).join('、')}${listed.rejected.length > 5 ? ' 等' : ''}（适配器：${(adapters || []).join(' / ') || '未配置'}）`)
      if (listed?.compiledOnly?.length) add('warn', 'compiled-only-scripts', `${listed.compiledOnly.length} 个脚本只有编译产物（.${scriptExtensions[0] || 'rpy'}c）没有源文件，解析不了，没有显示：${listed.compiledOnly.slice(0, 5).map(baseName).join('、')}${listed.compiledOnly.length > 5 ? ' 等' : ''}（需要反编译出源文件，或把源文件放到同一目录）`)
    }
    return problems
  }

  // ---------- 表情（首页入口）：角色 + 预设名的列表，给「表情预设」一个个过用 ----------
  // 适配器实现了 scanExpressions(text)（girlscreation）才有。扫整个脚本目录一次（每个脚本读全文，只在这里读），结果按适配器上下文建立时间缓存，「刷新索引」会清掉
  const expressionAdapter = (adapters || []).map((id) => { try { return galAdapter(id) } catch { return null } }).find((a) => typeof a?.scanExpressions === 'function')
  async function expressionNode() {
    const ctx = await contextOf(expressionAdapter.id)
    const cacheKey = `${mediaDir}|expressions|${contextStats(mediaDir).map((x) => x.builtAt).join(',')}`
    let casts = cacheGet(expressionCache, cacheKey, CACHE_TTL_MS)
    if (!casts) {
      const counts = new Map()   // 骨架名 → Map(预设名 → 次数)
      const scripts = [...(ctx?.scenes?.values() || [])].map((scene) => scene.script).filter(Boolean)
      await mapLimit(scripts, IO_CONCURRENCY, async (rel) => {
        try {
          const real = await realpath(path.join(mediaDir, ...rel.split('/')))
          const text = decodeTextFile(await readFile(real)).text
          for (const [skel, preset] of expressionAdapter.scanExpressions(text)) {
            if (!counts.has(skel)) counts.set(skel, new Map())
            counts.get(skel).set(preset, (counts.get(skel).get(preset) || 0) + 1)
          }
        } catch { /* 读不了就跳过这个脚本 */ }
      })
      casts = []
      for (const [skel, presets] of counts) {
        const files = expressionAdapter.globalSpineFiles?.(ctx, skel)   // 只有全局骨架（maid 的 data/spine/…）有分层脸，能在这里预览
        if (!files) continue
        casts.push({ skel: files.skel, atlas: files.atlas, name: skel, castKey: /^(cast\d+)\//.exec(skel)?.[1] || '', label: skel.split('/').pop(), presets: [...presets].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([name, count]) => ({ name, count })) })
      }
      casts.sort((a, b) => naturalCompare(a.name, b.name))
      cacheSet(expressionCache, cacheKey, casts, 20)
    }
    return { node: { id: 'x:expr', kind: 'expr', title: '表情', parent: '', breadcrumb: [{ id: '', title: '首页' }, { id: 'x:expr', title: '表情' }], sets: [], pageSize, page: 1, pageCount: 1, total: casts.length, items: [], casts, adapter: expressionAdapter.id } }
  }
  const expressionCards = async () => {
    if (!expressionAdapter) return null
    const ctx = await contextOf(expressionAdapter.id).catch(() => null)
    const skeletons = [...(ctx?.globalSpines?.keys() || [])].filter((key) => !key.includes('/')).length   // 每个骨架登记了「文件名」和「目录/文件名」两个键，只数前一种
    return skeletons ? { type: 'dir', id: 'x:expr', title: '表情', subtitle: `${skeletons} 个角色骨架 · 表情预设逐个确认`, thumb: '', badge: '', node: 'x:expr' } : null
  }

  async function getNode(nodeId, opts = {}) {
    if (nodeId === 'x:expr') {
      if (!expressionAdapter) throw fail('这个媒体没有表情预设', 404)
      return expressionNode()
    }
    const parsed = parseNodeId(nodeId)
    const result = await getNodeInner(nodeId, opts)
    if (result?.node && result.node.kind === 'cards' && !result.node.parent && parsed.kind === 'dir' && !parsed.rel && parsed.page === 1 && !parsed.view.q) {
      const card = await expressionCards()   // 首页第一页多一张「表情」卡片（分层脸骨架才有）
      if (card) { result.node.items = [...result.node.items, card]; result.node.total += 1 }
    }
    if (result?.node && result.node.kind !== 'player') {
      const status = indexStatus()
      if (status) result.node.index = status
      const problems = await problemsOf(parsed, result).catch(() => [])
      if (problems.length) result.node.problems = problems
    }
    return result
  }

  return { config, getNode, internals: { parseNodeId, listDir, scriptInfo, idOf, dirNodeId, groupNodeId, virtualNodeId, effectiveParentDir } }
}
