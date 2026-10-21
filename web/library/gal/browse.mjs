// Gal 的「浏览节点」：一个 Gal 媒体（= 一个目录）里，用户从首页一层层点进去，最后到播放页。
// 前端不知道目录长什么样，只认节点：每个节点是 { id, kind, title, parent, breadcrumb, items… }，
// 选项自带下一个节点的 id；点了就用那个 id 再取一次（走通用的 reader?sectionId=<节点 id>）。
//
// 节点 kind：
//   grid    卡片网格（分类、角色头像）
//   list    带缩略图的列表（脚本；一项可以带多个「变体」按钮，比如图片版/视频版）
//   player  播放页（叶子，带规范场景）
// 以后要「文本+图片」「文本+视频」之类，新增 kind 和一个前端渲染函数即可，取数接口不变。
//
// 节点 id（不透明字符串，前端原样传回）：
//   ''            首页          c:<分类id>      分类页       ch:<角色id>   角色页（脚本分组）
//   s:<相对路径>  播放页        列表节点可带 #<页码>
//
// 目录约定（没有真实样本，先编一套；全部写在 DEFAULT_BROWSE_LAYOUT 里，存进条目元数据 layout.browse，改约定只改这里/元数据）：
//   <媒体目录>/cabin|room|other/*.txt           各分类下直接是脚本
//   <媒体目录>/character/<角色id>/*.txt         角色下的脚本；文件名以 _image / _video 结尾的算同一组的两个变体
//   <媒体目录>/character/<角色id>/icon.png      可选，角色头像
//   <媒体目录>/character_names.json             可选，{ 角色id: 显示名 }
//   <媒体目录>/download/…                       脚本引用的资源（背景/BGM/语音…），见 gal.mjs 的 resolveAsset
//   一个分类目录都没有时，首页退化成「递归找到的所有脚本」的列表。
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { sniffGalAdapter } from './adapters/index.mjs'
import { buildScene, firstBackgroundSrc } from './scene.mjs'
import { decodeTextFile } from '../text-decode.mjs'

export const DEFAULT_BROWSE_LAYOUT = {
  pageSize: 25,
  categories: [
    { id: 'cabin', label: '纪念馆', dir: 'cabin', kind: 'scripts' },
    { id: 'character', label: '角色', dir: 'character', kind: 'characters' },
    { id: 'room', label: '家具', dir: 'room', kind: 'scripts' },
    { id: 'other', label: '复刻', dir: 'other', kind: 'scripts' },
  ],
  variants: [{ label: '图片', suffix: '_image' }, { label: '视频', suffix: '_video' }],
  namesFile: 'character_names.json',
  iconNames: ['icon.png', 'icon.jpg', 'icon.webp'],
}

const safeName = (value) => typeof value === 'string' && /^[^/\\\0]+$/.test(value) && value !== '.' && value !== '..'
const naturalCompare = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
const extOf = (file) => path.extname(file).slice(1).toLowerCase()
const stemOf = (file) => path.basename(file, path.extname(file))

export function normalizeBrowseLayout(raw) {
  const v = raw && typeof raw === 'object' ? raw : {}
  const d = DEFAULT_BROWSE_LAYOUT
  const categories = (Array.isArray(v.categories) ? v.categories : d.categories)
    .map((c) => ({ id: String(c?.id || ''), label: String(c?.label || c?.id || ''), dir: String(c?.dir || c?.id || ''), kind: c?.kind === 'characters' ? 'characters' : 'scripts' }))
    .filter((c) => safeName(c.id) && safeName(c.dir))
  const variants = (Array.isArray(v.variants) ? v.variants : d.variants)
    .map((x) => ({ label: String(x?.label || ''), suffix: String(x?.suffix || '') })).filter((x) => x.label && x.suffix)
  return {
    pageSize: Math.max(1, Math.min(200, Math.floor(Number(v.pageSize)) || d.pageSize)),
    categories: categories.length ? categories : d.categories,
    variants,
    namesFile: safeName(v.namesFile) ? v.namesFile : d.namesFile,
    iconNames: (Array.isArray(v.iconNames) ? v.iconNames : d.iconNames).map(String).filter(safeName),
  }
}

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

function parseNodeId(raw) {
  const text = String(raw || '')
  const m = /^(.*?)(?:#(\d{1,6}))?$/s.exec(text)
  const body = m[1]
  const page = Math.max(1, Number(m[2]) || 1)
  if (!body) return { kind: 'home', arg: '', page }
  const colon = body.indexOf(':')
  const tag = colon < 0 ? body : body.slice(0, colon)
  const arg = colon < 0 ? '' : body.slice(colon + 1)
  if (tag === 'c') return { kind: 'cat', arg, page }
  if (tag === 'ch') return { kind: 'char', arg, page }
  if (tag === 's') return { kind: 'script', arg, page: 1 }
  throw fail(`无效的节点：${text.slice(0, 80)}`)
}

// mediaDir：媒体目录（绝对路径）。layout/options 来自条目元数据。resolveAsset(rel) → 磁盘真实路径（找不到抛错）。
export function createBrowseProvider({ mediaDir, layout: rawLayout, adapters, scriptExtensions, maxScriptBytes, maxDepth = 6, resolveAsset }) {
  const layout = normalizeBrowseLayout(rawLayout)
  const exts = scriptExtensions
  const headCache = new Map()   // 文件 → 适配器 id（按 mtime+size 失效）
  const coverCache = new Map()

  const abs = (rel) => path.join(mediaDir, ...rel.split('/'))
  const catById = (id) => layout.categories.find((c) => c.id === id)

  async function readDirSafe(rel) {
    try { return await readdir(abs(rel), { withFileTypes: true }) } catch { return [] }
  }

  // 一个文件是不是（被适配器认得的）脚本。结果按 mtime+size 缓存
  async function scriptAdapterOf(rel) {
    const file = abs(rel)
    let info
    try { info = await stat(file) } catch { return '' }
    if (!info.isFile() || !info.size || info.size > maxScriptBytes || !exts.includes(extOf(file))) return ''
    const key = `${file}|${info.mtimeMs}|${info.size}`
    if (headCache.has(key)) return headCache.get(key)
    let id = ''
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(8192, info.size))
      await handle.read(buffer, 0, buffer.length, 0)
      id = sniffGalAdapter(decodeTextFile(buffer).text, adapters)
    } finally { await handle.close() }
    if (headCache.size > 20000) headCache.clear()
    headCache.set(key, id)
    return id
  }

  async function scriptsIn(dirRel) {
    const out = []
    for (const entry of (await readDirSafe(dirRel)).sort((a, b) => naturalCompare(a.name, b.name))) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name
      if (await scriptAdapterOf(rel)) out.push(rel)
    }
    return out
  }

  async function scriptsRecursive(dirRel = '', depth = 0, out = []) {
    for (const entry of (await readDirSafe(dirRel)).sort((a, b) => naturalCompare(a.name, b.name))) {
      if (entry.name.startsWith('.')) continue
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name
      if (entry.isDirectory()) { if (depth < maxDepth) await scriptsRecursive(rel, depth + 1, out); continue }
      if (entry.isFile() && await scriptAdapterOf(rel)) out.push(rel)
    }
    return out
  }

  async function readNames() {
    try {
      const file = abs(layout.namesFile)
      if ((await stat(file)).size > 1024 * 1024) return {}
      const data = JSON.parse(decodeTextFile(await readFile(file)).text)
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    } catch { return {} }
  }

  async function thumbOf(rel) {
    const file = abs(rel)
    let info
    try { info = await stat(file) } catch { return '' }
    const key = `${file}|${info.mtimeMs}|${info.size}`
    if (coverCache.has(key)) return coverCache.get(key)
    let src = ''
    try {
      const adapterId = await scriptAdapterOf(rel)
      const scene = buildScene(adapterId, decodeTextFile(await readFile(file)).text)
      const candidate = firstBackgroundSrc(scene)
      if (candidate) { await resolveAsset(candidate); src = candidate }
    } catch { src = '' }
    if (coverCache.size > 20000) coverCache.clear()
    coverCache.set(key, src)
    return src
  }

  // ---------- 各级「条目序列」：节点页面、上下话、返回页码都从这里来 ----------

  const scriptEntry = (rel) => ({ key: rel, title: stemOf(rel), variants: [{ label: '', rel }] })

  async function categoryEntries(cat) {
    if (cat.kind === 'characters') {
      const names = await readNames()
      const out = []
      for (const entry of (await readDirSafe(cat.dir)).sort((a, b) => naturalCompare(a.name, b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || !safeName(entry.name)) continue
        out.push({ key: entry.name, title: String(names[entry.name] || entry.name), id: entry.name })
      }
      return out
    }
    return (await scriptsIn(cat.dir)).map(scriptEntry)
  }

  async function groupEntries(charId) {
    const dirRel = `${charDir()}/${charId}`
    const groups = new Map()
    for (const rel of await scriptsIn(dirRel)) {
      const stem = stemOf(rel)
      const variant = layout.variants.find((v) => stem.endsWith(v.suffix) && stem.length > v.suffix.length)
      const key = variant ? stem.slice(0, -variant.suffix.length) : stem
      if (!groups.has(key)) groups.set(key, { key, title: key, variants: [] })
      groups.get(key).variants.push({ label: variant?.label || '', rel })
    }
    return [...groups.values()]
  }

  const characterCat = () => layout.categories.find((c) => c.kind === 'characters')
  const charDir = () => characterCat()?.dir || 'character'

  async function presentCategories() {
    const out = []
    for (const cat of layout.categories) {
      let isDir = false
      try { isDir = (await stat(abs(cat.dir))).isDirectory() } catch { /* 没有这个分类 */ }
      if (isDir) out.push(cat)
    }
    return out
  }

  async function homeEntries() {
    const cats = await presentCategories()
    return cats.length ? { mode: 'cats', cats } : { mode: 'flat', entries: (await scriptsRecursive()).map(scriptEntry) }
  }

  // 脚本属于哪一级：决定「返回」去哪、上下话在谁的序列里
  async function locate(rel) {
    const first = rel.split('/')[0]
    const second = rel.split('/')[1]
    const chars = characterCat()
    if (chars && first === chars.dir && rel.split('/').length >= 3 && safeName(second)) {
      return { parentBase: `ch:${second}`, entries: await groupEntries(second) }
    }
    const cat = layout.categories.find((c) => c.kind === 'scripts' && c.dir === first)
    if (cat && rel.split('/').length === 2) return { parentBase: `c:${cat.id}`, entries: await categoryEntries(cat) }
    return { parentBase: '', entries: (await homeEntries()).entries || [] }
  }

  const indexOfRel = (entries, rel) => entries.findIndex((e) => (e.variants || []).some((v) => v.rel === rel))
  const pageNode = (base, index) => {
    const page = Math.floor(Math.max(0, index) / layout.pageSize) + 1
    return base || page > 1 ? `${base}#${page}` : ''
  }

  async function parentOf(parsed) {
    if (parsed.kind === 'home') return null
    if (parsed.kind === 'cat') return ''
    if (parsed.kind === 'char') {
      const chars = characterCat()
      if (!chars) return ''
      const index = (await categoryEntries(chars)).findIndex((e) => e.key === parsed.arg)
      return pageNode(`c:${chars.id}`, index)
    }
    const { parentBase, entries } = await locate(parsed.arg)
    return pageNode(parentBase, indexOfRel(entries, parsed.arg))
  }

  async function breadcrumbOf(parsed) {
    const crumbs = [{ id: '', title: '首页' }]
    if (parsed.kind === 'home') return crumbs
    if (parsed.kind === 'cat') { crumbs.push({ id: `c:${parsed.arg}`, title: catById(parsed.arg)?.label || parsed.arg }); return crumbs }
    const chars = characterCat()
    const addChar = async (id) => {
      if (chars) crumbs.push({ id: `c:${chars.id}`, title: chars.label })
      const names = await readNames()
      crumbs.push({ id: `ch:${id}`, title: String(names[id] || id) })
    }
    if (parsed.kind === 'char') { await addChar(parsed.arg); return crumbs }
    const { parentBase } = await locate(parsed.arg)
    if (parentBase.startsWith('ch:')) await addChar(parentBase.slice(3))
    else if (parentBase.startsWith('c:')) crumbs.push({ id: parentBase, title: catById(parentBase.slice(2))?.label || parentBase })
    crumbs.push({ id: `s:${parsed.arg}`, title: stemOf(parsed.arg) })
    return crumbs
  }

  function paginate(entries, page) {
    const total = entries.length
    const pageCount = Math.max(1, Math.ceil(total / layout.pageSize))
    const current = Math.min(page, pageCount)
    return { total, pageCount, page: current, slice: entries.slice((current - 1) * layout.pageSize, current * layout.pageSize) }
  }

  async function scriptItem(entry) {
    const variants = entry.variants.map((v) => ({ label: v.label, node: `s:${v.rel}` }))
    return { id: entry.key, title: entry.title, thumb: await thumbOf(entry.variants[0].rel), node: variants.length === 1 ? variants[0].node : '', variants: variants.length > 1 ? variants : [] }
  }

  // ---------- 取节点 ----------

  async function getNodeRaw(nodeId) {
    const parsed = parseNodeId(nodeId)
    const parent = await parentOf(parsed).catch(() => '')
    const base = { parent, breadcrumb: await breadcrumbOf(parsed).catch(() => [{ id: '', title: '首页' }]) }

    if (parsed.kind === 'home') {
      const home = await homeEntries()
      if (home.mode === 'cats') {
        const items = []
        for (const cat of home.cats) {
          const entries = await categoryEntries(cat)
          items.push({ id: cat.id, title: cat.label, subtitle: `${entries.length} ${cat.kind === 'characters' ? '个角色' : '个脚本'}`, thumb: '', node: `c:${cat.id}` })
        }
        return { node: { id: '', kind: 'grid', title: '首页', ...base, page: 1, pageCount: 1, pageSize: layout.pageSize, total: items.length, items } }
      }
      const pg = paginate(home.entries, parsed.page)
      return { node: { id: pg.page > 1 ? `#${pg.page}` : '', kind: 'list', title: '首页', ...base, page: pg.page, pageCount: pg.pageCount, pageSize: layout.pageSize, total: pg.total, items: await Promise.all(pg.slice.map(scriptItem)) } }
    }

    if (parsed.kind === 'cat') {
      const cat = catById(parsed.arg)
      if (!cat) throw fail(`没有这个分类：${parsed.arg}`, 404)
      const entries = await categoryEntries(cat)
      const pg = paginate(entries, parsed.page)
      const id = `c:${cat.id}#${pg.page}`
      if (cat.kind === 'characters') {
        const items = []
        for (const e of pg.slice) {
          let thumb = ''
          for (const name of layout.iconNames) {
            try { await resolveAsset(`${cat.dir}/${e.id}/${name}`); thumb = `${cat.dir}/${e.id}/${name}`; break } catch { /* 下一个 */ }
          }
          items.push({ id: e.key, title: e.title, subtitle: e.title === e.key ? '' : e.key, thumb, node: `ch:${e.id}` })
        }
        return { node: { id, kind: 'grid', title: cat.label, ...base, page: pg.page, pageCount: pg.pageCount, pageSize: layout.pageSize, total: pg.total, items } }
      }
      return { node: { id, kind: 'list', title: cat.label, ...base, page: pg.page, pageCount: pg.pageCount, pageSize: layout.pageSize, total: pg.total, items: await Promise.all(pg.slice.map(scriptItem)) } }
    }

    if (parsed.kind === 'char') {
      if (!safeName(parsed.arg)) throw fail('无效的角色', 400)
      try { if (!(await stat(abs(`${charDir()}/${parsed.arg}`))).isDirectory()) throw new Error('x') } catch { throw fail(`没有这个角色：${parsed.arg}`, 404) }
      const names = await readNames()
      const pg = paginate(await groupEntries(parsed.arg), parsed.page)
      return { node: { id: `ch:${parsed.arg}#${pg.page}`, kind: 'list', title: String(names[parsed.arg] || parsed.arg), ...base, page: pg.page, pageCount: pg.pageCount, pageSize: layout.pageSize, total: pg.total, items: await Promise.all(pg.slice.map(scriptItem)) } }
    }

    // script
    const rel = parsed.arg.replace(/\\/g, '/')
    if (!rel || rel.split('/').some((part) => part === '' || part === '..' || part === '.') || !exts.includes(extOf(rel))) throw fail('无效的脚本路径', 400)
    const file = abs(rel)
    let real
    try {
      real = await realpath(file)
      const realRoot = await realpath(mediaDir)
      if (!real.startsWith(realRoot + path.sep) || !(await stat(real)).isFile()) throw new Error('x')
    } catch { throw fail('脚本不存在', 404) }
    const adapterId = await scriptAdapterOf(rel)
    if (!adapterId) throw fail('不是可识别的脚本', 400)
    const scene = buildScene(adapterId, decodeTextFile(await readFile(real)).text)

    // 上一话/下一话：在它所在的那一级序列里找邻居（变体优先同一种，没有就取第一个）
    const { entries } = await locate(rel)
    const at = indexOfRel(entries, rel)
    const label = at >= 0 ? entries[at].variants.find((v) => v.rel === rel)?.label || '' : ''
    const neighbour = (entry) => {
      if (!entry) return null
      const variant = entry.variants.find((v) => v.label === label) || entry.variants[0]
      return { sectionId: `s:${variant.rel}`, title: entry.title }
    }
    const entry = at >= 0 ? entries[at] : null
    const title = entry ? entry.title + (label ? ` · ${label}` : '') : stemOf(rel)
    base.breadcrumb[base.breadcrumb.length - 1].title = title
    return {
      node: { id: `s:${rel}`, kind: 'player', title, ...base, page: 1, pageCount: 1, pageSize: layout.pageSize, total: scene.steps.length, items: [] },
      scene,
      sectionNavigation: { prev: at > 0 ? neighbour(entries[at - 1]) : null, next: at >= 0 && at < entries.length - 1 ? neighbour(entries[at + 1]) : null },
    }
  }

  async function getNode(nodeId) {
    const result = await getNodeRaw(nodeId)
    // 选项字段对前端恒定：variants 恒为数组
    result.node.items = result.node.items.map((item) => ({ subtitle: '', thumb: '', node: '', variants: [], ...item }))
    return result
  }

  // 导入时用：媒体里一共有多少脚本、第一张能用的背景图（封面候选）
  async function summarize({ coverScanLimit = 30 } = {}) {
    const scripts = await scriptsRecursive()
    let cover = ''
    for (const rel of scripts.slice(0, coverScanLimit)) {
      cover = await thumbOf(rel)
      if (cover) break
    }
    return { scripts: scripts.length, cover }
  }

  return { layout, getNode, summarize, internals: { parseNodeId, scriptsRecursive, categoryEntries, groupEntries, locate } }
}
