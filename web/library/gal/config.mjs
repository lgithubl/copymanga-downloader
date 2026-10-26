// Gal 媒体的 config：条目元数据里唯一的「配置」字段，引擎和 tag 脚本（gal-layout）之间只通过它交互。
//   引擎：读浏览、封面、资源时只认它，缺的字段用下面的默认值补；
//   脚本：发现目录没按默认结构走时，往里写需要调整的字段（合并补丁，或整体替换），媒体就能读到正确的位置。
// 默认值 = 一套「标准结构」（UViewer 资源包的布局）：导入后不用脚本，按标准结构放的目录就是可运行的。
// config 全是数据（路径、字典、模板），不含代码：模板只做占位符替换，之后仍要通过存在性检查和「只认媒体目录内的真实路径」才会被读。

import { safeRelPath } from './paths.mjs'
import { isValidVoiceRegex } from './voice.mjs'

export const DEFAULT_PAGE_SIZE = 25
export const MAX_SCRIPT_BYTES = 4 * 1024 * 1024

export const DEFAULT_GAL_CONFIG = Object.freeze({
  // 脚本根（相对媒体目录）：可以有几个——它们是「可切换的文本版本」（比如中/日），首页上有下拉；第一个是默认
  scriptRoots: [{ id: 'text', dir: 'resources/download/adv/text', label: 'text' }],
  // 资源根（脚本里的 download/... 从这里起算）、名称文件（{ 目录名: 显示名 }）、缩略图缓存目录：都是数组，按顺序查找
  resourceRoots: ['resources'],
  namesFiles: ['user_data/character_names.json'],
  thumbsDirs: ['user_data/thumbnails'],
  stripPrefixes: [],
  scriptExtensions: ['txt'],
  hiddenDirs: [],     // 列目录时不显示的目录名（任意层级，按目录名精确匹配；比如导航界面、翻译目录）
  pageSize: DEFAULT_PAGE_SIZE,
  // 目录名 → 中文标签（缺的显示原目录名）
  labels: {
    cabin: '纪念馆', character: '角色', room: '房间', other: '其他', event: '活动', gacha: '扭蛋', memorial: '回忆', quest: '任务', tutorial: '教程',
    adultr: '成人向', extra: '额外',
  },
  // 合并目录：列 parent（通配）下的目录时，把 dirs 里这几个子目录的内容合进同一个列表（不再显示这几个子目录），
  // 每项带来源标记 badges[目录名]（没写就是目录名）
  merge: [{ parent: 'character/*', dirs: ['adultr', 'extra'], badges: { adultr: 'adu', extra: 'ext' } }],
  // 虚拟目录（视图）：在 parent 下多出一个叫 as 的目录，内容 = dirs 里这几个子目录（不写 = parent 自己）的脚本，stem 匹配 match 的才算；
  // exclusive = 被它收走的脚本不再出现在 parent 自己的列表里。分组（groups）、封面（dirThumbs）、标签（labels）都按路径 <parent>/<as> 配
  views: [],
  // 目录卡片的头像：parent 是父目录名（* = 任意），name 是目录名的正则；paths 是模板，{name} {parent} 会被替换，取第一个存在的
  dirThumbs: [{ parent: 'character', name: '^\\d{4}$', paths: ['download/character/{name}00/adv/image/{name}00.png', 'download/character/{name}00/adv/image/{name}00_100.png'] }],
  // 脚本卡片的缩略图（先于「脚本里第一张背景图」）：{stem} 是脚本文件名（无扩展名），{thumbsDir} 对每个缩略图目录各试一次；~/ = 相对媒体目录
  scriptThumbs: ['~/{thumbsDir}/{stem}.webp', '~/{thumbsDir}/scripts/{stem}.webp'],
  // 分组：列 parent（通配；'.' = 脚本根本身）下的目录时，脚本文件名（无扩展名）能匹配 pattern 的，按第 1 个捕获组分成虚拟目录
  // （比如 ^(\\d{5}) 把 10001A1、10001B1 归到「10001」一张卡片里）；不匹配的脚本照常列出。虚拟目录的名字/头像和真实目录一样查 labels / namesFiles / dirThumbs
  groups: [],
  // 谁：{ id, title }。id 是游戏/资源包的标识（用户在 config 里写，脚本按它分发，不同游戏即使用同一个 adapter 也能区分）
  game: null,
  // 适配器参数：{ <adapter id>: {…} }，原样交给适配器（适配器自己校验；路径类参数相对媒体目录）
  adapterOptions: {},
  // 脚本索引（给脚本配缩略图 + 来源角标）：[{ dir, pattern, key, badge }]。dir（相对媒体目录）里的文件名匹配 pattern 时，按 key 模板（{1}{2}… = 捕获组）
  // 算出它对应哪个脚本（脚本文件名，无扩展名），这个文件就是那个脚本的缩略图；badge 是卡片右上角的标记（比如 event / extra）
  scriptIndex: [],
  // 节点图（可选）：首页（id = home）开始的一张图，节点之间是「包含」（children，浏览用的树）和「关联」（related，只做跳转链接，不当父子）。
  // 节点：{ title, subtitle, text, badge, thumb, children: [节点 id], related: [节点 id], dirs: [目录通配（相对脚本根）], match: 脚本名正则,
  //        expand: { dirs: [目录通配], as: 模板节点 id, match } }。title / subtitle / thumb / dirs 里可以用 {name} {path} {label}（expand 出来的目录）。
  // catalog = 引用适配器目录里的节点（gal-layout 生成的默认节点图就是这样：和适配器原来给的列表一模一样，但每一项都可以改 / 挪 / 隐藏 / 加相关）。
// dirs = 把这些目录里认得出的脚本收进来；expand = 每个匹配的目录生成一个子节点（用 as 指的节点当模板）。有它的话首页和所有列表都由它给，
  // 目录对不上 / 没匹配到 / 有文件没人认的地方，列表页的「渲染诊断」里都会报。null = 不用节点图（走适配器 catalog 或真实目录）
  nodes: null,
  cover: '',          // 封面：相对资源根的路径；~/ 开头 = 相对媒体目录（只给封面用）
  // 允许忽略的未渲染指令（正则字符串列表，不分大小写）：播放器里「N 条指令暂未渲染」的统计会跳过匹配的指令。
  // 匹配对象是指令名（如 spriteatlas）和「指令名,参数1,参数2…」（如 anm,foo,bar），任一匹配就算「我允许了」
  rawIgnore: [],
  // 随机语音的默认白名单 / 黑名单（JS 正则源码，不分大小写，≤200 字符，匹配语音的资源路径；不合格的置空）。界面 / 请求里填了的覆盖它，见 README「随机语音」
  voiceInclude: '',
  voiceExclude: '',
  scriptCount: 0,     // 脚本数（脚本统计后写；0 = 不知道）
  script: null,       // 谁写的这份配置：{ id, version, ranAt }（脚本自己写，用来知道当前配置是哪一版脚本生成的）
})

const MAX_LIST = 20
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function relList(value, fallback, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) return fallback.slice()
  const out = []
  for (const raw of value.slice(0, 10)) {
    const rel = safeRelPath(raw)
    if (rel === null || (rel === '' && !allowEmpty) || out.includes(rel)) continue
    out.push(rel)
  }
  return out.length ? out : fallback.slice()
}

// 路径通配：只支持 * （一段路径里的任意字符，不跨 /），别的字符按字面
export function globToRegExp(glob) {
  const escaped = String(glob).split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')
  return new RegExp(`^${escaped}$`)
}

const safeGlob = (value) => {
  const glob = text(value, 200).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (glob === '.') return glob   // '.' = 脚本根本身
  return glob && !glob.split('/').some((part) => part === '..' || part === '.') ? glob : ''
}
// 规则里的 parent → 匹配「脚本根下的相对目录」的正则（'.' 只匹配根）
export const parentRegExp = (parent) => (parent === '.' ? /^$/ : globToRegExp(parent))
const safeName = (value) => (typeof value === 'string' && /^[^/\\\0|#]{1,100}$/.test(value) && value !== '.' && value !== '..' ? value : '')

// 节点图（config.nodes）：{ <节点 id>: spec }。非法的节点 / 字段丢掉；没有 home 就当没配
const NODE_ID = /^[\w.-]{1,40}$/
const nodeText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const regexOrEmpty = (value) => { const t = nodeText(value, 200); if (!t) return ''; try { new RegExp(t); return t } catch { return '' } }
const idList = (value, max) => (Array.isArray(value) ? value : []).filter((id) => typeof id === 'string' && NODE_ID.test(id)).slice(0, max)
const globList = (value) => (Array.isArray(value) ? value : []).map((g) => (g === '.' ? '.' : safeGlob(typeof g === 'string' ? g.replace(/\{(\w+)\}/g, '$1') : ''))).filter(Boolean).slice(0, 20)
export function normalizeNodes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const [id, spec] of Object.entries(raw).slice(0, 500)) {
    if (!NODE_ID.test(id) || !spec || typeof spec !== 'object' || Array.isArray(spec)) continue
    const expand = spec.expand && typeof spec.expand === 'object' && Array.isArray(spec.expand.dirs) && typeof spec.expand.as === 'string' && NODE_ID.test(spec.expand.as)
      ? { dirs: globList(spec.expand.dirs), as: spec.expand.as, match: regexOrEmpty(spec.expand.match) } : null
    out[id] = {
      title: nodeText(spec.title, 100), subtitle: nodeText(spec.subtitle, 100), text: nodeText(spec.text, 500), badge: nodeText(spec.badge, 12), thumb: nodeText(spec.thumb, 300),
      children: idList(spec.children, 500), related: idList(spec.related, 50),
      // catalog：引用适配器目录（catalog）里的一个节点（id 如 chars / c/chmr；'*' = 全部顶层），它的内容原样挂进来；空的 title / subtitle / thumb / badge 沿用适配器节点的
      catalog: nodeText(spec.catalog, 200),
      // auto：gal-layout 生成的节点（重跑会重新生成；手写的不带它，重跑不会动）。适配器没有这个目录时 auto 节点静默跳过
      auto: spec.auto === true,
      // dirs 允许 {name} {path} 占位符（模板节点用），所以这里只做长度 / 条数限制，展开后才过 safeRelPath
      dirs: (Array.isArray(spec.dirs) ? spec.dirs : []).map((d) => nodeText(d, 200).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter((d) => d && !d.split('/').some((part) => part === '..')).slice(0, 20),
      match: regexOrEmpty(spec.match), expand,
    }
  }
  return out.home ? out : null
}

// raw（元数据里存的）→ 规整后的完整 config（缺的字段用默认；非法的丢掉或退回默认）。没有 raw 的字段取默认值，不是「空」
export function normalizeGalConfig(raw) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const d = DEFAULT_GAL_CONFIG

  const roots = []
  const seen = new Set()
  for (const r of Array.isArray(v.scriptRoots) ? v.scriptRoots.slice(0, MAX_LIST) : []) {
    const dir = safeRelPath(r?.dir)
    const id = typeof r?.id === 'string' ? r.id : ''
    if (dir === null || id.includes('|') || id.includes('#') || seen.has(id)) continue
    seen.add(id)
    roots.push({ id, dir, label: text(r?.label, 60) || id })
  }

  const labels = {}
  if (v.labels && typeof v.labels === 'object' && !Array.isArray(v.labels)) {
    for (const [name, label] of Object.entries(v.labels).slice(0, 500)) if (safeName(name) && text(label, 40)) labels[name] = text(label, 40)
  }

  const views = []
  for (const rule of Array.isArray(v.views) ? v.views.slice(0, MAX_LIST) : []) {
    const parent = safeGlob(rule?.parent) === '.' || !rule?.parent ? '' : safeRelPath(text(rule.parent, 200))
    const as = safeName(typeof rule?.as === 'string' ? rule.as : '')
    if (parent === null || !as) continue
    const dirs = (Array.isArray(rule?.dirs) ? rule.dirs : []).map(safeName).filter(Boolean).slice(0, 10)
    const match = text(rule?.match, 200)
    if (match) { try { new RegExp(match) } catch { continue } }
    const badges = {}
    if (rule.badges && typeof rule.badges === 'object' && !Array.isArray(rule.badges)) {
      for (const [name, badge] of Object.entries(rule.badges).slice(0, 10)) if (safeName(name) && text(badge, 12)) badges[name] = text(badge, 12)
    }
    if (views.some((x) => x.parent === parent && x.as === as)) continue
    views.push({ parent, as, label: text(rule?.label, 40), dirs, match, exclusive: Boolean(rule?.exclusive), badges })
  }

  const nodes = normalizeNodes(v.nodes)

  const merge = []
  for (const rule of Array.isArray(v.merge) ? v.merge.slice(0, MAX_LIST) : []) {
    const parent = safeGlob(rule?.parent)
    const dirs = (Array.isArray(rule?.dirs) ? rule.dirs : []).map(safeName).filter(Boolean).slice(0, 10)
    if (!parent || !dirs.length) continue
    const badges = {}
    if (rule.badges && typeof rule.badges === 'object' && !Array.isArray(rule.badges)) {
      for (const [name, badge] of Object.entries(rule.badges).slice(0, 10)) if (safeName(name) && text(badge, 12)) badges[name] = text(badge, 12)
    }
    merge.push({ parent, dirs, badges })
  }

  const dirThumbs = []
  for (const rule of Array.isArray(v.dirThumbs) ? v.dirThumbs.slice(0, MAX_LIST) : []) {
    const paths = (Array.isArray(rule?.paths) ? rule.paths : []).map((p) => text(p, 300)).filter(Boolean).slice(0, 6)
    if (!paths.length) continue
    const name = text(rule.name, 100)
    if (name) { try { new RegExp(name) } catch { continue } }
    dirThumbs.push({ parent: text(rule.parent, 100) || '*', name, paths })
  }

  const groups = []
  for (const rule of Array.isArray(v.groups) ? v.groups.slice(0, MAX_LIST) : []) {
    const parent = safeGlob(rule?.parent)
    const pattern = text(rule?.pattern, 200)
    if (!parent || !pattern) continue
    try { if (new RegExp(`${pattern}|`).exec('').length < 2) continue } catch { continue }
    groups.push({ parent, pattern })
  }

  const game = v.game && typeof v.game === 'object' && !Array.isArray(v.game) && /^[A-Za-z0-9_-]{1,40}$/.test(String(v.game.id ?? ''))
    ? { id: String(v.game.id), title: text(v.game.title, 100) }
    : null

  const adapterOptions = {}
  if (v.adapterOptions && typeof v.adapterOptions === 'object' && !Array.isArray(v.adapterOptions)) {
    for (const [id, options] of Object.entries(v.adapterOptions).slice(0, 10)) {
      if (!/^[a-z0-9-]{1,40}$/.test(id) || !options || typeof options !== 'object' || Array.isArray(options)) continue
      try {
        const json = JSON.stringify(options)
        if (json.length <= 8000) adapterOptions[id] = JSON.parse(json)
      } catch { /* 丢掉 */ }
    }
  }

  const scriptIndex = []
  for (const rule of Array.isArray(v.scriptIndex) ? v.scriptIndex.slice(0, MAX_LIST) : []) {
    const dir = safeRelPath(rule?.dir)
    const pattern = text(rule?.pattern, 200)
    if (!dir || !pattern) continue
    try { new RegExp(pattern) } catch { continue }
    scriptIndex.push({ dir, pattern, key: text(rule?.key, 100) || '{1}', badge: text(rule?.badge, 12) })
  }

  const rawIgnore = []
  for (const source of (Array.isArray(v.rawIgnore) ? v.rawIgnore : []).slice(0, 50)) {
    const pattern = text(source, 200)
    if (!pattern || rawIgnore.includes(pattern)) continue
    try { new RegExp(pattern, 'i') } catch { continue }
    rawIgnore.push(pattern)
  }

  const cover = text(v.cover, 400)
  const coverRel = cover.startsWith('~/') ? safeRelPath(cover.slice(2)) : safeRelPath(cover)
  const script = v.script && typeof v.script === 'object' && !Array.isArray(v.script)
    ? { id: text(v.script.id, 60), version: text(v.script.version, 40), ranAt: text(v.script.ranAt, 40) }
    : null

  return {
    scriptRoots: roots.length ? roots : d.scriptRoots.map((r) => ({ ...r })),
    resourceRoots: relList(v.resourceRoots, d.resourceRoots, { allowEmpty: true }),
    namesFiles: relList(v.namesFiles, d.namesFiles),
    thumbsDirs: relList(v.thumbsDirs, d.thumbsDirs),
    stripPrefixes: (Array.isArray(v.stripPrefixes) ? v.stripPrefixes : d.stripPrefixes).map((p) => text(p, 60)).filter((p) => p && !p.includes('..')).slice(0, 10),
    scriptExtensions: (Array.isArray(v.scriptExtensions) ? v.scriptExtensions : d.scriptExtensions).map((e) => String(e).trim().replace(/^\./, '').toLowerCase()).filter((e) => /^[a-z0-9]{1,10}$/.test(e)).slice(0, 10).filter((e, i, all) => all.indexOf(e) === i),
    hiddenDirs: (Array.isArray(v.hiddenDirs) ? v.hiddenDirs : d.hiddenDirs).map(safeName).filter(Boolean).slice(0, 50),
    pageSize: Math.max(1, Math.min(200, Math.floor(Number(v.pageSize)) || d.pageSize)),
    labels: v.labels === undefined ? { ...d.labels } : labels,
    merge: v.merge === undefined ? d.merge.map((r) => ({ ...r, dirs: [...r.dirs], badges: { ...r.badges } })) : merge,
    views: v.views === undefined ? [] : views,
    dirThumbs: v.dirThumbs === undefined ? d.dirThumbs.map((r) => ({ ...r, paths: [...r.paths] })) : dirThumbs,
    scriptThumbs: v.scriptThumbs === undefined ? d.scriptThumbs.slice() : (Array.isArray(v.scriptThumbs) ? v.scriptThumbs : []).map((t) => text(t, 300)).filter(Boolean).slice(0, 10),
    groups: v.groups === undefined ? [] : groups,
    scriptIndex: v.scriptIndex === undefined ? [] : scriptIndex,
    game,
    adapterOptions,
    rawIgnore: v.rawIgnore === undefined ? [] : rawIgnore,
    voiceInclude: isValidVoiceRegex(v.voiceInclude) ? text(v.voiceInclude, 200) : '',
    voiceExclude: isValidVoiceRegex(v.voiceExclude) ? text(v.voiceExclude, 200) : '',
    nodes,
    cover: coverRel === null ? '' : cover,
    scriptCount: Math.max(0, Math.floor(Number(v.scriptCount)) || 0),
    script: script && (script.id || script.version) ? script : null,
  }
}

// 存进元数据的是「用户/脚本明确写过的字段」（raw），不是补满默认值的完整版：默认值以后改了，没写过的字段跟着变。
// 只保留认识的字段；每个字段的合法性在 normalizeGalConfig 里查（读的时候），这里只做去掉未知字段和限量
const KNOWN = Object.keys(DEFAULT_GAL_CONFIG)
export function cleanGalConfigRaw(raw) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  for (const key of KNOWN) if (v[key] !== undefined) out[key] = v[key]
  // 过一遍规整，把不合法的字段丢掉（规整后和原值不一致就说明有问题：用规整后的值）
  const norm = normalizeGalConfig(out)
  const clean = {}
  for (const key of Object.keys(out)) clean[key] = norm[key]
  return clean
}

// 补丁：默认合并（补丁里写了的顶层字段替换原来的，没写的保留）；replace = 整体替换。值为 null 的字段 = 删掉（回到默认）
export function applyGalConfigPatch(currentRaw, patch, { replace = false } = {}) {
  const base = replace ? {} : { ...cleanGalConfigRaw(currentRaw) }
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  for (const key of KNOWN) {
    if (p[key] === undefined) continue
    if (p[key] === null) delete base[key]
    else base[key] = p[key]
  }
  return cleanGalConfigRaw(base)
}

// 模板：{name} 之类的占位符替换；替换后的路径必须仍是安全的相对路径（或 ~/ 开头）
export function expandTemplate(template, vars) {
  const filled = String(template).replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''))
  if (filled.startsWith('~/')) return safeRelPath(filled.slice(2)) === null || safeRelPath(filled.slice(2)) === '' ? null : filled
  const rel = safeRelPath(filled)
  return rel ? rel : null
}
