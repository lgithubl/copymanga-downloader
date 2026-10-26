// Gal 媒体的 config：条目元数据里唯一的「配置」字段，引擎和 tag 脚本（gal-layout）之间只通过它交互。
//   引擎：读浏览、封面、资源时只认它，缺的字段用下面的默认值补；
//   脚本：发现目录没按默认结构走时，往里写需要调整的字段（合并补丁，或整体替换），媒体就能读到正确的位置。
// 默认值 = 一套「标准结构」（UViewer 资源包的布局）：导入后不用脚本，按标准结构放的目录就是可运行的。
// config 全是数据（路径、字典、模板），不含代码：模板只做占位符替换，之后仍要通过存在性检查和「只认媒体目录内的真实路径」才会被读。

import { safeRelPath } from './paths.mjs'
import { compileSafeRegex, isValidVoiceRegex } from './voice.mjs'

export const DEFAULT_PAGE_SIZE = 25
export const DEFAULT_INDEX_SKIP = Object.freeze(['^\\.', '\\|', '#'])
export const MAX_SCRIPT_BYTES = 4 * 1024 * 1024
// 脚本卡片的兜底封面（没有任何缩略图规则命中时从脚本里收图，见 fallback-thumbs.mjs）
export const FALLBACK_PREFER = Object.freeze(['cg', 'stand', 'bg'])
export const DEFAULT_FALLBACK_SKIP = Object.freeze(['(?:^|[^a-z])(?:black|white|blank)(?:[^a-z]|$)'])
export const DEFAULT_THUMB_FALLBACK = Object.freeze({ enabled: true, max: 6, prefer: FALLBACK_PREFER, skipBlack: true, skip: DEFAULT_FALLBACK_SKIP, scanSteps: 200 })
// thumbSources 模板里能用的占位符（见 thumbs.mjs 的说明；{1}{2}… 捕获组和命名捕获组另算）
export const FILE_PLACEHOLDERS = Object.freeze(['file', 'base', 'dirname', 'dir1', 'dir2', 'dir3', 'dirpath'])
export const CARD_PLACEHOLDERS = Object.freeze(['stem', 'name', 'parent', 'parent2'])
export const THUMB_FALLBACK_LIMITS = Object.freeze({ max: [1, 12], scanSteps: [10, 2000], skip: 10 })

export const DEFAULT_GAL_CONFIG = Object.freeze({
  // 脚本根（相对媒体目录）：可以有几个——它们是「可切换的文本版本」（比如中/日），首页上有下拉；第一个是默认
  scriptRoots: [{ id: 'text', dir: 'resources/download/adv/text', label: 'text' }],
  // 资源根（脚本里的 download/... 从这里起算）、名称文件（{ 目录名: 显示名 }）、缩略图缓存目录：都是数组，按顺序查找
  resourceRoots: ['resources'],
  namesFiles: ['user_data/character_names.json'],
  thumbsDirs: ['user_data/thumbnails'],
  stripPrefixes: [],
  scriptExtensions: ['txt'],   // 脚本扩展名（不带点，不分大小写）；'' = 没有扩展名的文件（['']，只认没有扩展名的；['', 'json'] = 两种都认）
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
  // paths 里文件名 / 目录名段可以带通配 * ?（* = 段内任意字符，? = 单个字符），匹配到的全部都算（按自然序）；没有通配的模板按原样、存在就算。
  // 所有存在的路径都进卡片的 thumbs 数组（去重、最多 12 张），第一张 = thumb。UViewer 的资源目录是 <4 位编号><2 位变体>（几乎没有 00），所以 {name}?? 把每个变体都收进来，{name}00 排在最前
  dirThumbs: [{ parent: 'character', name: '^\\d{4}$', paths: ['download/character/{name}00/adv/image/{name}00.png', 'download/character/{name}00/adv/image/{name}00_100.png', 'download/character/{name}??/adv/image/{name}??.png', 'download/character/{name}??/adv/image/{name}??_100.png'] }],
  // 脚本卡片的缩略图（先于「脚本里第一张背景图」）：{stem} 是脚本文件名（无扩展名），{thumbsDir} 对每个缩略图目录各试一次；~/ = 相对媒体目录
  scriptThumbs: ['~/{thumbsDir}/{stem}.webp', '~/{thumbsDir}/scripts/{stem}.webp'],
  // 可配置的缩略图提取（按文件名 / 目录结构给脚本卡片 / 目录卡片配图，和 scriptThumbs / dirThumbs 并存，结果接在它们后面；多条规则、多个文件的结果合并：按规则顺序、真实文件去重、最多 12 张）：
  //   [{ dir, match, key, for, forKey, forMatch, forStrip, kind, limit, fallback }]
  //   dir       目录（相对资源根；~/ 开头 = 相对媒体目录，只有缩略图目录读得到）。可带通配 * ?（每段内；比如 scenes/* = 每个场景目录，最多展开 3000 个目录）；每条规则只列一次目录（按目录 mtime 缓存，每个目录最多读 2 万项），建成 键 → 文件[] 的索引
  //   match     正则，对 dir 里的「文件名」（含扩展名）匹配，不匹配的忽略
  //   key       文件的键（模板）：{1}{2}… = match 的捕获组，{名字} = 命名捕获组，{dirname}（= {dir1}）= 文件所在目录的名字（通配匹配到的那个目录）、{dir2} / {dir3} = 再上一级 / 两级目录名、{dirpath} = 目录完整路径、
  //             {file} = 文件名、{base} = 无扩展名的文件名；不写 = {1}。键可以完全来自目录结构（Girls Creation：scenes/<场景>/thumbnail.png → key '{dirname}'）
  //   for       给谁用：script（脚本卡片）| dir（目录 / 分组卡片）| both（默认）
  //   forKey    卡片自己的键（模板）：{stem}（脚本名，无扩展名）{name}（目录名 / 分组键；脚本里 = {stem}）{parent}（父目录名：脚本 = 脚本所在目录的名字，相对脚本根；目录 = 上一级目录名）{parent2}（再上一级）；
  //             不写 = 脚本 {stem}、目录 {name}。卡片用这个键去索引里取文件
  //   forMatch  可选，正则：对 stem / name 先匹配一次，捕获组 {1}… / 命名组 {名字} 也能写进 forKey（不匹配 = 这条规则对这张卡片不适用）
  //   forStrip  可选，正则（或正则数组）：forKey 展开后，依次把匹配到的部分删掉再去查索引（去前缀 / 后缀：'^scene_' 把 scene_123456789 变成 123456789）
  //   切片      任何模板里的 {x:起:止} / {x:起}：取占位符值的 [起, 止)（JS slice：从 0 数、止不含、可为负）。{stem:0:9} = 前 9 个字符，{stem:1:7} = 第 1～6 个字符（120090312 → 200903）
  //   kind      image（默认，只收图片扩展名）| video（只收 mp4 mkv webm mov m4v，卡片显示视频的一帧）
  //   limit     每张卡片最多取几张（默认 12）；fallback：true = 前面都没找到图时才用这条
  thumbSources: [],
  // 兜底封面：脚本卡片没有任何缩略图规则（scriptThumbs / thumbSources / scriptIndex）命中时，从脚本自己收图（几张，卡片可以悬停轮播）。和适配器无关，只看解析好的场景（只扫前 scanSteps 步）。
  //   enabled   false = 旧行为（只取脚本里第一张背景图，单图）
  //   max       最多几张（1～12，默认 6）
  //   prefer    优先级，数组：cg（事件图：带 over 的 bg、带 cg / still 标记的指令、静态画面的 thumb）→ stand（立绘）→ bg（背景）；默认 ['cg', 'stand', 'bg']（'bgOver' 是 cg 的别名）
  //   skipBlack true（默认）= 文件名命中 skip 的（纯黑 / 纯白占位图）不要
  //   skip      正则数组（对无扩展名的文件名，不分大小写），默认 black / white / blank 按单词；scanSteps 最多扫几步（10～2000，默认 200）
  thumbFallback: { ...DEFAULT_THUMB_FALLBACK, prefer: [...DEFAULT_THUMB_FALLBACK.prefer], skip: [...DEFAULT_THUMB_FALLBACK.skip] },
  // 卡片封面怎么选（卡片有多张图时）：random（默认，每次渲染随机一张当封面，悬停时随机顺序轮播）| first（只显示第一张，不轮播 = 旧行为）| hover（封面固定第一张，悬停时轮播）
  thumbMode: 'random',
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
  // 音频指令重分类（所有适配器的输出统一过一遍，见 scene.mjs applyClassify）：[{ match, on, from, as }]，≤ 50 条，第一条命中的生效
  classify: [],
  // 资源路径解析规则（见 resolve.mjs）：{ extensionFallbacks, rewrites, normalizeUnicode, preferDirs, caseInsensitive, allowedRoots }；没写的项 = 原行为
  resourceResolve: {},
  // 文件索引（context.mjs 的目录遍历）跳过的名字：正则源码数组，对「文件名 / 目录名」匹配。默认 = 以前写死的规则（. 开头 / 含 | / 含 #），写 [] = 一个都不跳过
  indexSkip: DEFAULT_INDEX_SKIP,
  // 上限：{ walkFiles, sampleFiles, sampleBytes, scriptBytes, walkDepth }（没写的用引擎默认 / 适配器自己的 contextWalkLimit / contextSampleLimit）
  limits: {},
  // 播放器默认值（只在用户浏览器里没有存过对应设置时生效）：{ fontScale, textOpacity, autoDelay, cameraMode, zoom, minFitScale, fastInterval }
  player: {},
  scriptCount: 0,     // 脚本数（脚本统计后写；0 = 不知道）
  script: null,       // 谁写的这份配置：{ id, version, ranAt }（脚本自己写，用来知道当前配置是哪一版脚本生成的）
})

const MAX_LIST = 20
const MAX_RULE_REGEX = 200
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function relList(value, fallback, { allowEmpty = false, onDrop = null } = {}) {
  if (!Array.isArray(value)) return fallback.slice()
  const out = []
  for (const raw of value.slice(0, 10)) {
    const rel = safeRelPath(raw)
    if (rel === null || (rel === '' && !allowEmpty) || out.includes(rel)) { if (rel === null || (rel === '' && !allowEmpty)) onDrop?.(raw); continue }
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

// ---------- 新增字段的上限 ----------
export const CLASSIFY_MAX = 50
export const CLASSIFY_FROM = ['se', 'voice', 'bgm', 'bgse', 'bgvoice']
export const CLASSIFY_ON = ['src', 'speaker', 'text']
export const CLASSIFY_AS = ['voice', 'se', 'bgm', 'bgse', 'bgvoice', 'drop']
export const RESOLVE_MAX = { rewrites: 30, extKeys: 30, extTargets: 10, dirs: 20, roots: 20 }
export const INDEX_SKIP_MAX = 20
// 数值上限：{ 字段: [最小, 最大] }（超出就夹到范围内并报告；不是数字就丢掉并报告）
export const LIMIT_RANGES = {
  walkFiles: [1, 2000000],
  sampleFiles: [1, 20000],
  sampleBytes: [256, 256 * 1024],
  scriptBytes: [1024, 64 * 1024 * 1024],
  walkDepth: [1, 12],
}
// 播放器默认值：{ 字段: [最小, 最大, 是否取整] }，对应 gal-player.js 的 GAL_SETTINGS（cameraMode 另算）
export const PLAYER_RANGES = {
  fontScale: [0.6, 2],        // 台词字体倍数（copymanga.gal.fontScale）
  textOpacity: [0, 1],        // 文本框背景不透明度（copymanga.gal.boxOpacity）
  autoDelay: [0, 30],         // 自动播放：语音播完再等几秒（copymanga.gal.autoVoiceDelay）
  zoom: [0.5, 4],             // 画面放大（静图 / 角色，没有按媒体存过时）
  minFitScale: [0.3, 1],      // 台词太长时最多缩到字体设置的多少倍（没有浏览器设置项，直接用）
  fastInterval: [20, 500, true], // 快进每步间隔毫秒
}
export const ADAPTER_OPTIONS_MAX = { perAdapter: 16 * 1024, total: 64 * 1024, adapters: 10 }

const snippetOf = (value) => { try { const t = typeof value === 'string' ? value : JSON.stringify(value); return String(t ?? '').replace(/\s+/g, ' ').slice(0, 80) } catch { return '' } }
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// raw（元数据里存的）→ { config, warnings }。warnings = [{ field, reason, snippet }]：每一处被丢掉 / 夹住 / 退回默认的内容都报告，不再悄悄丢
export function normalizeGalConfigWithWarnings(raw) {
  const v = isPlainObject(raw) ? raw : {}
  const d = DEFAULT_GAL_CONFIG
  const warnings = []
  const warn = (field, reason, value) => { if (warnings.length < 200) warnings.push({ field, reason, snippet: snippetOf(value) }) }
  const overList = (field, value, max) => { if (Array.isArray(value) && value.length > max) warn(field, `超过 ${max} 项，多出的被丢掉`, value.slice(max, max + 1)) }

  const roots = []
  const seen = new Set()
  overList('scriptRoots', v.scriptRoots, MAX_LIST)
  for (const r of Array.isArray(v.scriptRoots) ? v.scriptRoots.slice(0, MAX_LIST) : []) {
    const dir = safeRelPath(r?.dir)
    const id = typeof r?.id === 'string' ? r.id : ''
    if (dir === null || id.includes('|') || id.includes('#') || seen.has(id)) { warn('scriptRoots', dir === null ? 'dir 不是安全的相对路径' : seen.has(id) ? 'id 重复' : 'id 里不能有 | 或 #', r); continue }
    seen.add(id)
    roots.push({ id, dir, label: text(r?.label, 60) || id })
  }
  if (v.scriptRoots !== undefined && !Array.isArray(v.scriptRoots)) warn('scriptRoots', '不是数组，用默认值', v.scriptRoots)

  const labels = {}
  if (isPlainObject(v.labels)) {
    for (const [name, label] of Object.entries(v.labels).slice(0, 500)) {
      if (safeName(name) && text(label, 40)) labels[name] = text(label, 40)
      else warn('labels', '目录名或标签无效', { [name]: label })
    }
  } else if (v.labels !== undefined) warn('labels', '不是对象，已丢掉', v.labels)

  const views = []
  overList('views', v.views, MAX_LIST)
  for (const rule of Array.isArray(v.views) ? v.views.slice(0, MAX_LIST) : []) {
    const parent = safeGlob(rule?.parent) === '.' || !rule?.parent ? '' : safeRelPath(text(rule.parent, 200))
    const as = safeName(typeof rule?.as === 'string' ? rule.as : '')
    if (parent === null || !as) { warn('views', parent === null ? 'parent 不是安全路径' : 'as 无效', rule); continue }
    const dirs = (Array.isArray(rule?.dirs) ? rule.dirs : []).map(safeName).filter(Boolean).slice(0, 10)
    const match = text(rule?.match, 200)
    if (match) { try { new RegExp(match) } catch { warn('views', 'match 不是合法正则', rule); continue } }
    const badges = {}
    if (isPlainObject(rule.badges)) {
      for (const [name, badge] of Object.entries(rule.badges).slice(0, 10)) if (safeName(name) && text(badge, 12)) badges[name] = text(badge, 12)
    }
    if (views.some((x) => x.parent === parent && x.as === as)) { warn('views', 'parent + as 重复', rule); continue }
    views.push({ parent, as, label: text(rule?.label, 40), dirs, match, exclusive: Boolean(rule?.exclusive), badges })
  }

  const nodes = normalizeNodes(v.nodes)
  if (v.nodes !== undefined && v.nodes !== null && !nodes) warn('nodes', '没有 home 节点或格式不对，当作没配', v.nodes)

  const merge = []
  overList('merge', v.merge, MAX_LIST)
  for (const rule of Array.isArray(v.merge) ? v.merge.slice(0, MAX_LIST) : []) {
    const parent = safeGlob(rule?.parent)
    const dirs = (Array.isArray(rule?.dirs) ? rule.dirs : []).map(safeName).filter(Boolean).slice(0, 10)
    if (!parent || !dirs.length) { warn('merge', 'parent 或 dirs 无效', rule); continue }
    const badges = {}
    if (isPlainObject(rule.badges)) {
      for (const [name, badge] of Object.entries(rule.badges).slice(0, 10)) if (safeName(name) && text(badge, 12)) badges[name] = text(badge, 12)
    }
    merge.push({ parent, dirs, badges })
  }

  const dirThumbs = []
  overList('dirThumbs', v.dirThumbs, MAX_LIST)
  for (const rule of Array.isArray(v.dirThumbs) ? v.dirThumbs.slice(0, MAX_LIST) : []) {
    const paths = (Array.isArray(rule?.paths) ? rule.paths : []).map((p) => text(p, 300)).filter(Boolean).slice(0, 10)
    if (!paths.length) { warn('dirThumbs', 'paths 为空', rule); continue }
    const name = text(rule.name, 100)
    if (name) { try { new RegExp(name) } catch { warn('dirThumbs', 'name 不是合法正则', rule); continue } }
    dirThumbs.push({ parent: text(rule.parent, 100) || '*', name, paths })
  }

  const thumbSources = []
  overList('thumbSources', v.thumbSources, 10)
  for (const rule of Array.isArray(v.thumbSources) ? v.thumbSources.slice(0, 10) : []) {
    const raw = text(rule?.dir, 200).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const fromMedia = raw.startsWith('~/')
    const rest = safeRelPath(fromMedia ? raw.slice(2) : raw)
    const match = text(rule?.match, 300)
    if (rest === null || !match) { warn('thumbSources', rest === null ? 'dir 不是安全路径' : 'match 为空', rule); continue }
    try { new RegExp(match); if (rule.forMatch && !regexOrEmpty(rule.forMatch)) { warn('thumbSources', 'forMatch 不是合法正则', rule); continue } } catch { warn('thumbSources', 'match 不是合法正则', rule); continue }
    if (!rest) { warn('thumbSources', 'dir 为空', rule); continue }
    // forStrip：一个正则或正则数组；不合法的丢掉并报告（规则本身保留）
    const stripRaw = rule.forStrip === undefined || rule.forStrip === null || rule.forStrip === '' ? [] : Array.isArray(rule.forStrip) ? rule.forStrip : [rule.forStrip]
    const forStrip = []
    for (const one of stripRaw.slice(0, 4)) { const source = regexOrEmpty(one); if (source) forStrip.push(source); else warn('thumbSources', 'forStrip 里有不是合法正则的项，已丢掉', one) }
    if (stripRaw.length > 4) warn('thumbSources', 'forStrip 超过 4 项，多出的被丢掉', stripRaw[4])
    const entry = {
      dir: fromMedia ? `~/${rest}` : rest, match, key: text(rule.key, 100) || '{1}',
      for: ['script', 'dir'].includes(rule.for) ? rule.for : 'both', forKey: text(rule.forKey, 100), forMatch: regexOrEmpty(rule.forMatch),
      kind: rule.kind === 'video' ? 'video' : 'image', limit: Math.max(1, Math.min(12, Math.floor(Number(rule.limit)) || 12)), fallback: Boolean(rule.fallback),
      ...(forStrip.length ? { forStrip } : {}),
    }
    // 模板里写了没有的占位符（拼错）：展开成空串，这条规则永远查不到——报出来（规则保留）
    for (const [field, allowed, source] of [['key', FILE_PLACEHOLDERS, match], ['forKey', CARD_PLACEHOLDERS, entry.forMatch]]) {
      const named = [...String(source).matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((m) => m[1])
      const unknown = [...new Set([...entry[field].matchAll(/\{(\w+)(?::-?\d*)?(?::-?\d*)?\}/g)].map((m) => m[1]).filter((name) => !/^\d+$/.test(name) && !allowed.includes(name) && !named.includes(name)))]
      if (unknown.length) warn('thumbSources', `${field} 里的占位符 ${unknown.map((n) => `{${n}}`).join(' ')} 不认识（可用：${allowed.map((n) => `{${n}}`).join(' ')}、{1}{2}… 捕获组、命名捕获组），展开成空`, rule)
    }
    thumbSources.push(entry)
  }

  // thumbFallback：兜底封面（见 DEFAULT_GAL_CONFIG 里的说明）。没写 = 默认；写了的字段逐个校验，不合格的退回默认并报告
  const dtf = DEFAULT_THUMB_FALLBACK
  const thumbFallback = { ...dtf, prefer: [...dtf.prefer], skip: [...dtf.skip] }
  if (v.thumbFallback !== undefined && !isPlainObject(v.thumbFallback)) warn('thumbFallback', '不是对象，用默认值', v.thumbFallback)
  if (isPlainObject(v.thumbFallback)) {
    const tf = v.thumbFallback
    for (const key of Object.keys(tf)) if (!(key in dtf)) warn('thumbFallback', `不认识的字段 ${key}，已丢掉`, key)
    for (const key of ['enabled', 'skipBlack']) {
      if (tf[key] === undefined) continue
      if (typeof tf[key] === 'boolean') thumbFallback[key] = tf[key]
      else warn(`thumbFallback.${key}`, '只能是 true / false，用默认值', tf[key])
    }
    for (const key of ['max', 'scanSteps']) {
      if (tf[key] === undefined) continue
      const n = Math.floor(Number(tf[key]))
      const [lo, hi] = THUMB_FALLBACK_LIMITS[key]
      if (tf[key] === null || tf[key] === '' || typeof tf[key] === 'boolean' || !Number.isFinite(n)) { warn(`thumbFallback.${key}`, '不是数字，用默认值', tf[key]); continue }
      thumbFallback[key] = Math.max(lo, Math.min(hi, n))
      if (thumbFallback[key] !== n) warn(`thumbFallback.${key}`, `超出范围 ${lo}–${hi}，夹到 ${thumbFallback[key]}`, tf[key])
    }
    if (tf.prefer !== undefined) {
      const list = Array.isArray(tf.prefer) ? tf.prefer : null
      const kinds = (list || []).map((k) => (k === 'bgOver' ? 'cg' : k)).filter((k, i, all) => FALLBACK_PREFER.includes(k) && all.indexOf(k) === i)
      if (!list || !kinds.length) warn('thumbFallback.prefer', '要是 cg / stand / bg 组成的数组（bgOver = cg），用默认值', tf.prefer)
      else {
        if (list.length > kinds.length) warn('thumbFallback.prefer', '有不认识 / 重复的项，已丢掉', list)
        thumbFallback.prefer = kinds
      }
    }
    if (tf.skip !== undefined) {
      const list = Array.isArray(tf.skip) ? tf.skip : null
      if (!list) warn('thumbFallback.skip', '不是数组，用默认值', tf.skip)
      else {
        const ok = list.slice(0, THUMB_FALLBACK_LIMITS.skip).map((source) => text(source, 120)).filter((source) => { if (!source) return false; try { new RegExp(source, 'i'); return true } catch { return false } })
        if (ok.length < list.length) warn('thumbFallback.skip', `${list.length - ok.length} 项不是合法正则 / 太长 / 超过 ${THUMB_FALLBACK_LIMITS.skip} 项，已丢掉`, list)
        thumbFallback.skip = ok
      }
    }
  }

  const groups = []
  overList('groups', v.groups, MAX_LIST)
  for (const rule of Array.isArray(v.groups) ? v.groups.slice(0, MAX_LIST) : []) {
    const parent = safeGlob(rule?.parent)
    const pattern = text(rule?.pattern, 200)
    if (!parent || !pattern) { warn('groups', 'parent 或 pattern 为空', rule); continue }
    try { if (new RegExp(`${pattern}|`).exec('').length < 2) { warn('groups', 'pattern 没有捕获组', rule); continue } } catch { warn('groups', 'pattern 不是合法正则', rule); continue }
    groups.push({ parent, pattern })
  }

  const game = isPlainObject(v.game) && /^[A-Za-z0-9_-]{1,40}$/.test(String(v.game.id ?? ''))
    ? { id: String(v.game.id), title: text(v.game.title, 100) }
    : null
  if (v.game !== undefined && v.game !== null && !game) warn('game', 'id 必须是 1-40 位字母 / 数字 / _ / -，当作没配', v.game)

  // adapterOptions：每个适配器 ≤ 16 KB，合计 ≤ 64 KB（规则表会放在这里）；id 不合格 / 不是对象 / 太大 / 超出合计 = 丢掉并报告
  const adapterOptions = {}
  if (isPlainObject(v.adapterOptions)) {
    let total = 0
    const entries = Object.entries(v.adapterOptions)
    if (entries.length > ADAPTER_OPTIONS_MAX.adapters) warn('adapterOptions', `适配器超过 ${ADAPTER_OPTIONS_MAX.adapters} 个，多出的被丢掉`, entries[ADAPTER_OPTIONS_MAX.adapters][0])
    for (const [id, options] of entries.slice(0, ADAPTER_OPTIONS_MAX.adapters)) {
      if (!/^[a-z0-9-]{1,40}$/.test(id)) { warn('adapterOptions', '适配器 id 不合格（只能是小写字母 / 数字 / -，≤ 40 位），整项被丢掉', id); continue }
      if (!isPlainObject(options)) { warn(`adapterOptions.${id}`, '不是对象，已丢掉', options); continue }
      try {
        const json = JSON.stringify(options)
        if (json.length > ADAPTER_OPTIONS_MAX.perAdapter) { warn(`adapterOptions.${id}`, `序列化后 ${json.length} 字符，超过单个适配器上限 ${ADAPTER_OPTIONS_MAX.perAdapter}，已丢掉`, json); continue }
        if (total + json.length > ADAPTER_OPTIONS_MAX.total) { warn(`adapterOptions.${id}`, `合计超过 ${ADAPTER_OPTIONS_MAX.total} 字符，已丢掉`, json); continue }
        total += json.length
        adapterOptions[id] = JSON.parse(json)
      } catch { warn(`adapterOptions.${id}`, '无法序列化，已丢掉', '') }
    }
  } else if (v.adapterOptions !== undefined) warn('adapterOptions', '不是对象，已丢掉', v.adapterOptions)

  const scriptIndex = []
  overList('scriptIndex', v.scriptIndex, MAX_LIST)
  for (const rule of Array.isArray(v.scriptIndex) ? v.scriptIndex.slice(0, MAX_LIST) : []) {
    const dir = safeRelPath(rule?.dir)
    const pattern = text(rule?.pattern, 200)
    if (!dir || !pattern) { warn('scriptIndex', 'dir 或 pattern 无效', rule); continue }
    try { new RegExp(pattern) } catch { warn('scriptIndex', 'pattern 不是合法正则', rule); continue }
    scriptIndex.push({ dir, pattern, key: text(rule?.key, 100) || '{1}', badge: text(rule?.badge, 12) })
  }

  const rawIgnore = []
  overList('rawIgnore', v.rawIgnore, 50)
  for (const source of (Array.isArray(v.rawIgnore) ? v.rawIgnore : []).slice(0, 50)) {
    const pattern = text(source, 200)
    if (!pattern || rawIgnore.includes(pattern)) { if (!pattern) warn('rawIgnore', '空的或不是字符串', source); continue }
    try { new RegExp(pattern, 'i') } catch { warn('rawIgnore', '不是合法正则', source); continue }
    rawIgnore.push(pattern)
  }

  // ---------- classify ----------
  const classify = []
  if (v.classify !== undefined && !Array.isArray(v.classify)) warn('classify', '不是数组，已丢掉', v.classify)
  overList('classify', v.classify, CLASSIFY_MAX)
  for (const rule of Array.isArray(v.classify) ? v.classify.slice(0, CLASSIFY_MAX) : []) {
    if (!isPlainObject(rule)) { warn('classify', '规则不是对象', rule); continue }
    let re = null
    try { re = compileSafeRegex(rule.match, { flags: 'i', label: 'match' }) } catch (error) { warn('classify', `match：${error.message}`, rule); continue }
    if (!re) { warn('classify', 'match 为空', rule); continue }
    const on = rule.on === undefined ? 'src' : rule.on
    if (!CLASSIFY_ON.includes(on)) { warn('classify', `on 只能是 ${CLASSIFY_ON.join(' / ')}`, rule); continue }
    if (!CLASSIFY_AS.includes(rule.as)) { warn('classify', `as 只能是 ${CLASSIFY_AS.join(' / ')}`, rule); continue }
    let from = CLASSIFY_FROM.slice()
    if (rule.from !== undefined) {
      const given = Array.isArray(rule.from) ? rule.from : []
      from = [...new Set(given.filter((op) => CLASSIFY_FROM.includes(op)))]
      if (from.length !== given.length || !Array.isArray(rule.from)) warn('classify', `from 里有不认识的 op（可选：${CLASSIFY_FROM.join(' / ')}）`, rule)
      if (!from.length) { warn('classify', 'from 没有合法的 op，规则已丢掉', rule); continue }
    }
    classify.push({ match: text(rule.match, MAX_RULE_REGEX), on, from, as: rule.as })
  }

  // ---------- resourceResolve ----------
  const resourceResolve = {}
  if (v.resourceResolve !== undefined && !isPlainObject(v.resourceResolve)) warn('resourceResolve', '不是对象，已丢掉', v.resourceResolve)
  if (isPlainObject(v.resourceResolve)) {
    const rr = v.resourceResolve
    const extOk = (e) => typeof e === 'string' && /^\.[^./\\\0]{1,16}$/.test(e)
    if (rr.extensionFallbacks !== undefined) {
      if (!isPlainObject(rr.extensionFallbacks)) warn('resourceResolve.extensionFallbacks', '不是 { 扩展名: [扩展名…] } 对象，已丢掉', rr.extensionFallbacks)
      else {
        const out = {}
        const entries = Object.entries(rr.extensionFallbacks)
        if (entries.length > RESOLVE_MAX.extKeys) warn('resourceResolve.extensionFallbacks', `超过 ${RESOLVE_MAX.extKeys} 项，多出的被丢掉`, entries[RESOLVE_MAX.extKeys][0])
        for (const [from, list] of entries.slice(0, RESOLVE_MAX.extKeys)) {
          const key = from.toLowerCase()
          const targets = (Array.isArray(list) ? list : []).filter(extOk).slice(0, RESOLVE_MAX.extTargets)
          if (!extOk(from) || !targets.length || !Array.isArray(list) || targets.length !== list.length) warn('resourceResolve.extensionFallbacks', '扩展名要写成 ".xxx"，值是非空数组', { [from]: list })
          if (extOk(from) && targets.length) out[key] = targets
        }
        if (Object.keys(out).length) resourceResolve.extensionFallbacks = out
      }
    }
    if (rr.rewrites !== undefined) {
      if (!Array.isArray(rr.rewrites)) warn('resourceResolve.rewrites', '不是数组，已丢掉', rr.rewrites)
      else {
        overList('resourceResolve.rewrites', rr.rewrites, RESOLVE_MAX.rewrites)
        const out = []
        for (const rule of rr.rewrites.slice(0, RESOLVE_MAX.rewrites)) {
          if (!isPlainObject(rule) || typeof rule.replace !== 'string' || rule.replace.length > 200) { warn('resourceResolve.rewrites', 'replace 必须是 ≤ 200 字符的字符串', rule); continue }
          const flags = rule.flags === undefined || rule.flags === '' ? '' : rule.flags === 'i' ? 'i' : null
          if (flags === null) { warn('resourceResolve.rewrites', "flags 只能是 'i'", rule); continue }
          try { if (!compileSafeRegex(rule.match, { flags, label: 'match' })) { warn('resourceResolve.rewrites', 'match 为空', rule); continue } } catch (error) { warn('resourceResolve.rewrites', `match：${error.message}`, rule); continue }
          out.push({ match: text(rule.match, MAX_RULE_REGEX), replace: rule.replace, ...(flags ? { flags } : {}) })
        }
        if (out.length) resourceResolve.rewrites = out
      }
    }
    if (rr.normalizeUnicode !== undefined) {
      const given = Array.isArray(rr.normalizeUnicode) ? rr.normalizeUnicode : []
      const out = [...new Set(given.filter((f) => f === 'NFC' || f === 'NFD'))]
      if (!Array.isArray(rr.normalizeUnicode) || out.length !== given.length) warn('resourceResolve.normalizeUnicode', "只能是 ['NFC', 'NFD'] 里的值", rr.normalizeUnicode)
      if (out.length) resourceResolve.normalizeUnicode = out
    }
    if (rr.preferDirs !== undefined) {
      const given = Array.isArray(rr.preferDirs) ? rr.preferDirs : []
      overList('resourceResolve.preferDirs', given, RESOLVE_MAX.dirs)
      const out = []
      for (const dir of given.slice(0, RESOLVE_MAX.dirs)) {
        const rel = typeof dir === 'string' ? safeRelPath(dir) : null
        if (!rel) { warn('resourceResolve.preferDirs', '不是安全的相对目录', dir); continue }
        if (!out.includes(rel)) out.push(rel)
      }
      if (!Array.isArray(rr.preferDirs)) warn('resourceResolve.preferDirs', '不是数组，已丢掉', rr.preferDirs)
      if (out.length) resourceResolve.preferDirs = out
    }
    if (rr.caseInsensitive !== undefined) {
      if (typeof rr.caseInsensitive === 'boolean') { if (rr.caseInsensitive === false) resourceResolve.caseInsensitive = false }
      else warn('resourceResolve.caseInsensitive', '必须是 true / false，按默认（true）', rr.caseInsensitive)
    }
    if (rr.allowedRoots !== undefined) {
      const given = Array.isArray(rr.allowedRoots) ? rr.allowedRoots : []
      overList('resourceResolve.allowedRoots', given, RESOLVE_MAX.roots)
      const out = []
      for (const dir of given.slice(0, RESOLVE_MAX.roots)) {
        const ok = typeof dir === 'string' && dir.length <= 400 && !dir.includes('\0') && (dir.startsWith('/') || /^[A-Za-z]:[\\/]/.test(dir)) && !dir.replace(/\\/g, '/').split('/').includes('..')
        if (!ok) { warn('resourceResolve.allowedRoots', '必须是不含 .. 的绝对目录', dir); continue }
        const normalized = dir.length > 1 ? dir.replace(/[\\/]+$/, '') : dir
        if (normalized === '/' || normalized === '') { warn('resourceResolve.allowedRoots', '不允许放行根目录', dir); continue }
        if (!out.includes(normalized)) out.push(normalized)
      }
      if (!Array.isArray(rr.allowedRoots)) warn('resourceResolve.allowedRoots', '不是数组，已丢掉', rr.allowedRoots)
      if (out.length) resourceResolve.allowedRoots = out
    }
    for (const key of Object.keys(rr)) if (!['extensionFallbacks', 'rewrites', 'normalizeUnicode', 'preferDirs', 'caseInsensitive', 'allowedRoots'].includes(key)) warn('resourceResolve', `不认识的字段 ${key}，已丢掉`, key)
  }

  // ---------- indexSkip ----------
  let indexSkip = DEFAULT_INDEX_SKIP.slice()
  if (v.indexSkip !== undefined) {
    if (!Array.isArray(v.indexSkip)) warn('indexSkip', '不是数组，用默认规则', v.indexSkip)
    else {
      overList('indexSkip', v.indexSkip, INDEX_SKIP_MAX)
      indexSkip = []
      for (const source of v.indexSkip.slice(0, INDEX_SKIP_MAX)) {
        try {
          const re = compileSafeRegex(source, { flags: '', label: 'indexSkip' })
          if (!re) { warn('indexSkip', '空的正则', source); continue }
          if (!indexSkip.includes(text(source, MAX_RULE_REGEX))) indexSkip.push(text(source, MAX_RULE_REGEX))
        } catch (error) { warn('indexSkip', error.message, source) }
      }
    }
  }

  // ---------- limits ----------
  const limits = {}
  if (v.limits !== undefined && !isPlainObject(v.limits)) warn('limits', '不是对象，已丢掉', v.limits)
  if (isPlainObject(v.limits)) {
    for (const [key, value] of Object.entries(v.limits)) {
      const range = LIMIT_RANGES[key]
      if (!range) { warn('limits', `不认识的字段 ${key}，已丢掉`, key); continue }
      const n = Math.floor(Number(value))
      if (value === null || value === '' || typeof value === 'boolean' || !Number.isFinite(n)) { warn(`limits.${key}`, '不是数字，已丢掉', value); continue }
      const clamped = Math.max(range[0], Math.min(range[1], n))
      if (clamped !== n) warn(`limits.${key}`, `超出范围 ${range[0]}–${range[1]}，夹到 ${clamped}`, value)
      limits[key] = clamped
    }
  }

  // ---------- player ----------
  const player = {}
  if (v.player !== undefined && !isPlainObject(v.player)) warn('player', '不是对象，已丢掉', v.player)
  if (isPlainObject(v.player)) {
    for (const [key, value] of Object.entries(v.player)) {
      if (key === 'cameraMode') {
        if (value === 'auto' || value === 'fixed') player.cameraMode = value
        else warn('player.cameraMode', "只能是 'auto' 或 'fixed'，已丢掉", value)
        continue
      }
      const range = PLAYER_RANGES[key]
      if (!range) { warn('player', `不认识的字段 ${key}，已丢掉`, key); continue }
      const n = Number(value)
      if (value === null || value === '' || typeof value === 'boolean' || !Number.isFinite(n)) { warn(`player.${key}`, '不是数字，已丢掉', value); continue }
      let clamped = Math.max(range[0], Math.min(range[1], n))
      if (range[2]) clamped = Math.round(clamped)
      else clamped = Math.round(clamped * 1000) / 1000
      if (clamped !== n) warn(`player.${key}`, `超出范围 ${range[0]}–${range[1]}，夹到 ${clamped}`, value)
      player[key] = clamped
    }
  }

  const cover = text(v.cover, 400)
  const coverRel = cover.startsWith('~/') ? safeRelPath(cover.slice(2)) : safeRelPath(cover)
  if (cover && coverRel === null) warn('cover', '不是安全的相对路径，已丢掉', cover)
  const script = isPlainObject(v.script)
    ? { id: text(v.script.id, 60), version: text(v.script.version, 40), ranAt: text(v.script.ranAt, 40) }
    : null

  const voiceRegexField = (field) => {
    if (isValidVoiceRegex(v[field])) return text(v[field], 200)
    if (v[field] !== undefined && v[field] !== '') warn(field, '不是合格的正则（太长 / 量词套量词 / 反向引用 / 语法错误），已置空', v[field])
    return ''
  }
  const dropped = (field, list, kept) => { if (Array.isArray(list) && list.length > kept) warn(field, `${list.length - kept} 项无效被丢掉`, list) }
  const relListOf = (field, value, fallback, opts) => {
    const bad = []
    const out = relList(value, fallback, { ...opts, onDrop: (raw) => bad.push(raw) })
    for (const raw of bad) warn(field, '不是安全的相对路径，已丢掉', raw)
    return out
  }

  const config = {
    scriptRoots: roots.length ? roots : d.scriptRoots.map((r) => ({ ...r })),
    resourceRoots: relListOf('resourceRoots', v.resourceRoots, d.resourceRoots, { allowEmpty: true }),
    namesFiles: relListOf('namesFiles', v.namesFiles, d.namesFiles),
    thumbsDirs: relListOf('thumbsDirs', v.thumbsDirs, d.thumbsDirs),
    stripPrefixes: (Array.isArray(v.stripPrefixes) ? v.stripPrefixes : d.stripPrefixes).map((p) => text(p, 60)).filter((p) => p && !p.includes('..')).slice(0, 10),
    scriptExtensions: (Array.isArray(v.scriptExtensions) ? v.scriptExtensions : d.scriptExtensions).map((e) => String(e).trim().replace(/^\./, '').toLowerCase()).filter((e) => /^[a-z0-9]{0,10}$/.test(e)).slice(0, 10).filter((e, i, all) => all.indexOf(e) === i),   // 空串 '' = 「没有扩展名」的文件（Otogi 的 typeadv/MScenes/<id>）
    hiddenDirs: (Array.isArray(v.hiddenDirs) ? v.hiddenDirs : d.hiddenDirs).map(safeName).filter(Boolean).slice(0, 50),
    pageSize: Math.max(1, Math.min(200, Math.floor(Number(v.pageSize)) || d.pageSize)),
    labels: v.labels === undefined ? { ...d.labels } : labels,
    merge: v.merge === undefined ? d.merge.map((r) => ({ ...r, dirs: [...r.dirs], badges: { ...r.badges } })) : merge,
    views: v.views === undefined ? [] : views,
    dirThumbs: v.dirThumbs === undefined ? d.dirThumbs.map((r) => ({ ...r, paths: [...r.paths] })) : dirThumbs,
    scriptThumbs: v.scriptThumbs === undefined ? d.scriptThumbs.slice() : (Array.isArray(v.scriptThumbs) ? v.scriptThumbs : []).map((t) => text(t, 300)).filter(Boolean).slice(0, 10),
    thumbSources: v.thumbSources === undefined ? [] : thumbSources,
    thumbFallback,
    thumbMode: ['random', 'first', 'hover'].includes(v.thumbMode) ? v.thumbMode : d.thumbMode,
    groups: v.groups === undefined ? [] : groups,
    scriptIndex: v.scriptIndex === undefined ? [] : scriptIndex,
    game,
    adapterOptions,
    rawIgnore: v.rawIgnore === undefined ? [] : rawIgnore,
    voiceInclude: voiceRegexField('voiceInclude'),
    voiceExclude: voiceRegexField('voiceExclude'),
    classify,
    resourceResolve,
    indexSkip,
    limits,
    player,
    nodes,
    cover: coverRel === null ? '' : cover,
    scriptCount: Math.max(0, Math.floor(Number(v.scriptCount)) || 0),
    script: script && (script.id || script.version) ? script : null,
  }
  if (v.thumbMode !== undefined && !['random', 'first', 'hover'].includes(v.thumbMode)) warn('thumbMode', '只能是 random / first / hover，用默认值', v.thumbMode)
  if (Array.isArray(v.scriptExtensions)) dropped('scriptExtensions', v.scriptExtensions, config.scriptExtensions.length)
  if (Array.isArray(v.hiddenDirs)) dropped('hiddenDirs', v.hiddenDirs, config.hiddenDirs.length)
  if (Array.isArray(v.stripPrefixes)) dropped('stripPrefixes', v.stripPrefixes, config.stripPrefixes.length)
  return { config, warnings }
}

// 向后兼容的入口：返回规整后的 config；warnings 挂在一个不可枚举的属性上（不进 JSON / 展开）
export function normalizeGalConfig(raw) {
  const { config, warnings } = normalizeGalConfigWithWarnings(raw)
  Object.defineProperty(config, 'warnings', { value: warnings, enumerable: false })
  return config
}

// 给适配器的只读视图（buildScene 的 meta.config）：只含适配器 / 通用后处理需要的几项，深度冻结（拷贝，改不到 provider 自己的 config）
export function galConfigView(config) {
  const deepFreeze = (value) => {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value) }
    return value
  }
  const pick = (value) => JSON.parse(JSON.stringify(value ?? null))
  return Object.freeze({
    classify: deepFreeze(pick(config.classify) || []),
    resourceResolve: deepFreeze(pick(config.resourceResolve) || {}),
    player: deepFreeze(pick(config.player) || {}),
    limits: deepFreeze(pick(config.limits) || {}),
    indexSkip: deepFreeze(pick(config.indexSkip) || []),
  })
}

// 存进元数据的是「用户/脚本明确写过的字段」（raw），不是补满默认值的完整版：默认值以后改了，没写过的字段跟着变。
// 只保留认识的字段；每个字段的合法性在 normalizeGalConfig 里查（读的时候），这里只做去掉未知字段和限量
const KNOWN = Object.keys(DEFAULT_GAL_CONFIG)
export function cleanGalConfigRawWithWarnings(raw) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  for (const key of KNOWN) if (v[key] !== undefined) out[key] = v[key]
  // 过一遍规整，把不合法的字段丢掉（规整后和原值不一致就说明有问题：用规整后的值）；丢了什么由 warnings 报告
  const { config, warnings } = normalizeGalConfigWithWarnings(out)
  const clean = {}
  for (const key of Object.keys(out)) clean[key] = config[key]
  return { clean, warnings }
}
export const cleanGalConfigRaw = (raw) => cleanGalConfigRawWithWarnings(raw).clean

// 补丁：默认合并（补丁里写了的顶层字段替换原来的，没写的保留）；replace = 整体替换。值为 null 的字段 = 删掉（回到默认）
// WithWarnings：同时返回这次补丁里被丢掉 / 夹住的内容（handler 把它记在条目上，列表页的「渲染诊断」里报 config-dropped）
export function applyGalConfigPatchWithWarnings(currentRaw, patch, { replace = false } = {}) {
  const base = replace ? {} : { ...cleanGalConfigRaw(currentRaw) }
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  for (const key of KNOWN) {
    if (p[key] === undefined) continue
    if (p[key] === null) delete base[key]
    else base[key] = p[key]
  }
  const { clean, warnings } = cleanGalConfigRawWithWarnings(base)
  return { config: clean, warnings }
}
export const applyGalConfigPatch = (currentRaw, patch, options) => applyGalConfigPatchWithWarnings(currentRaw, patch, options).config

// 模板：{name} 之类的占位符替换；替换后的路径必须仍是安全的相对路径（或 ~/ 开头）
export function expandTemplate(template, vars) {
  const filled = String(template).replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''))
  if (filled.startsWith('~/')) return safeRelPath(filled.slice(2)) === null || safeRelPath(filled.slice(2)) === '' ? null : filled
  const rel = safeRelPath(filled)
  return rel ? rel : null
}
