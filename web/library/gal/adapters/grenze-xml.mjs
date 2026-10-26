// 适配器：GrenzeViewer（Grenze）的对话 XML（TextAsset/easy_dialog-N.xml）→ 规范场景（gal-scene/1）。只做静态立绘（整张 body 图），Spine 动画不在这里。
// 一份文件（1~10MB、最多约 5 万行）里装着几百个场景，所以：
//   · 行是 <easy_dialog-N id="" next_id="" name="" text="" …/>，用正则逐行扫（不建 DOM）；流程 = next_id 串成的链表（没有 next_id 的行 = 一条链的末尾）
//   · 场景 = 一条链：没有任何行指向它的行是起点；脚本路径带场景号 `TextAsset/easy_dialog-1.xml::<起点行 id>`（`::` 之后的部分引擎会拆出来放进 meta.scene，打开的还是那个文件）
//   · 列表（catalog）= 每个文件一个目录（easy_dialog-N），里面是它的场景（起点 id + 句数 + 说话人 + 首句）；文件在 prepare 里读一次，按 文件 mtime+size 缓存扫描结果
//   · 链可能在中间汇合（几行的 next_id 相同）：每个场景各自沿 next_id 走到底（共用的后半段在每个场景里都有）；有环 / 指向不存在的 id 就在那里结束；没人指向的环也算一个场景（从文件里最靠前的行起）
// 行的属性（文件 1 里的出现次数见 README）：
//   name（'-' 或没有 = 旁白）、text（XML 转义：&#xA; 换行、&amp; …；《俺》这类心声记号原样保留）
//   hero_group_id + pic_pos（1/2/3 = 左/中/右）→ stand（merc/pic/<hero_group_id>/body.webp|png 一整张）；pic_face 是头像图标的序号，不是表情叠层，不用
//     没有 hero_group_id 的行（旁白 / 只放指令）沿用上一个立绘，直到换了 hero_group_id / pic_pos、或换背景（background）才清掉；一次只显示一个立绘；找不到 body 图的 hero 记 unresolved 并清掉立绘
//   background → bg（bg/battlebg/<名>/<名>.webp；名字查文件名索引，找不到记 unresolved；bg_b 找不到文件时当黑底——没有对照样本，推测）
//   bgm（non = 停）→ bgm / bgmStop；sound1..3、bg_sound1..3 → se（一次性；bg_sound 是不是循环没有对照样本，按一次性放；non = 无）；voice_pack + voice → voice
//   back_voice（<名>#<音量>，back_voice_pack = 包）→ bgvoice（slot back，循环的背景人声）/ non = bgvoiceOff；screen_effect / pic_action / effect / pic_size 按下面的映射表（名字 → 现有场景指令）处理；
//   映射表里没有的 / 映射成 raw 的值 → raw {cmd, args}，stats.raw 里按「属性:值」分开记（screen_effect:8、pic_action:立ち絵全消え …），诊断里能看到有哪些不同的值；pic_action_val 等没有表的属性仍是 raw
// 资源（相对资源根 assets/resources/patchres/）：bg/battlebg/<名>/<名>.webp、bgm/<名小写>/<名>.m4a、sound/<名>/<名>.m4a、voice/<包小写>/<语音名>.m4a、merc/pic/<id>/body.webp|png；
//   每种资源先按 paths 里的模板精确找，找不到再按「文件名（无扩展名，不分大小写）」在对应目录里找（contextDirs 的目录递归列出来），不写死目录层级；merc/pic 下的 N.webp / <id>.webp 是头像图标 / 图集，不是立绘
// 适配器只「读配置、按配置匹配」：所有猜出来的路径 / 名字 / 数字都在 DEFAULT_OPTIONS 里，由 config.adapterOptions['grenze-xml']（管理员脚本 gal-layout 写）逐项覆盖
// （对象逐层合并，数组 / 标量整个替换；没跑过脚本的条目用内置默认值，行为和以前一样）。完整选项（括号里 = 默认值）：
//   root ('')  textDir ('<root>/TextAsset')  resourceDir ('<root>/assets/resources/patchres')    游戏根 / 对话 XML 目录 / 资源根（相对媒体目录）
//   resourceDirs (['bg','bgm','sound','voice','merc/pic'])   资源根下进索引的子目录；index.ext = 进索引的扩展名正则（默认 \.(?:webp|png|jpe?g|m4a|mp3|ogg|wav)$）
//   exts { bg: ['webp','png','jpg','jpeg'], bgm / sound / voice: ['m4a','mp3','ogg','wav'] }      模板里 {ext} 按这个顺序各试一次（= 同名文件的优先级；没有索引时用第一个）
//   paths { bg, bgm, sound, voice, stand }   候选路径模板（数组，按顺序试，第一个在索引里的为准；索引里的路径都相对资源根）。占位符：{name}（属性值原样）{lower}（小写）{pack}（voice_pack 小写）{voice}（语音名）{hero}（hero_group_id）{ext}（见 exts）{file}（见 standFiles）；**/ = 中间任意层目录（按文件名找，大小写 / 扩展名后备 / preferDirs 来自 config.resourceResolve）
//        默认 bg ['bg/battlebg/{name}/{name}.{ext}', 'bg/**/{name}.{ext}']、bgm ['bgm/{lower}/{name}.{ext}', 'bgm/**/{name}.{ext}']、sound ['sound/{name}/{name}.{ext}', 'sound/**/{name}.{ext}']、voice ['voice/{pack}/{voice}.{ext}', 'voice/**/{voice}.{ext}']、stand ['merc/pic/{hero}/{file}']；没有索引时按每个列表第一条猜
//   duplicates { bg: 'first', bgm: 'first', sound: 'first', voice: 'skip', stand: 'first' }       **/ 模板里同名文件不止一个时：skip = 不猜（记 unresolved）/ first = 路径字典序第一个 / preferDirs = 按 config.resourceResolve.preferDirs 挑
//   standFiles (['body.webp','body.png'])   一整张立绘图的文件名（优先级 = 顺序）；standPos ({ '1': 'left', '2': 'center', '3': 'right', default: 'center' })   pic_pos → align；standFit (1)   stand 部件的 fit（0 = 不带）
//   standKeep ('untilNewHero')   没有 hero_group_id 的行：untilNewHero = 沿用上一个立绘直到换人 / 换位置 / 换背景；perRow = 每一行自己决定（没有 hero_group_id 就清掉立绘）
//   none (['non'])   bgm / sound / voice / background 里表示「没有 / 停」的值（不分大小写）；bgBlack (['bg_b'])   找不到文件时变黑底的背景名（推测）
//   bgSound { mode: 'se', attrs: ['bg_sound1','bg_sound2','bg_sound3'] }   bg_sound 怎么放：se = 一次性 / bgse = 循环背景音；soundAttrs (['sound1','sound2','sound3'])   一次性音效的属性（先放 bgSound.attrs 再放这些）
//   rawAttrs (['screen_effect','pic_action','pic_action_val','pic_size','effect+effect_pos'])   要处理的「特效类」属性（a+b = 同一条，args = [a 的值, b 的值]；有 a 才发）：值在 attrTables 指向的表里有映射就发映射出来的指令，否则记成 raw {cmd, args}；要忽略 / 改路由就从这里拿掉
//   attrTables ({ screen_effect: 'screenEffects', pic_action: 'picActions', effect: 'effects', pic_size: 'picSize' })   属性 → 映射表（下面几个选项的名字）；没有表的属性只记 raw
//   映射表（值 → 映射；整张表逐项覆盖 / 追加，值的内容不限类型）：映射 = null / 'raw'（记 raw，什么都不发）/ 'drop'（忽略，不记）/ 场景指令对象 / 指令对象数组（用现有指令，比如 { op: 'shake', axis: 'overall', strength: 0.2, seconds: 0.5 }）。
//        指令对象可带 at（不进场景）：'start' = 这一行最前面（背景之前，比如淡到黑要先黑再换背景）/ 'stand' = 背景之后、立绘之前（比如先清立绘再出新立绘）/ 'end'（默认）= 这一行立绘之后、语音之前。op 是 standOff 时和立绘状态同步（没有立绘就不发）。
//        picSize 的映射是立绘部件的覆盖 { zoom?, fit? }（没有 op；一直生效到下一个 pic_size；换了会重发当前立绘）。值取自属性原文（XML 解转义、去首尾空白）。
//   screenEffects  速い画面揺れ / 画面シェイク → shake（overall）；溶明_黒幕 → fade clear；溶暗_黒幕 → fade black（at start）；フラッシュ / フラッシュ2回 → flash（count 1 / 2）；光エフェクト → wash；数字 id（1–13，含义未知）→ null = raw。秒数 / 强度全是猜的
//   picActions     立ち絵全消え → standOff（at stand）；溶明溶暗 → 淡到黑再淡回；下から_全身 / 右側現れ消え / 左側現れ消え / マスク / 数字 id → raw（立绘没有进出场指令）
//   effects        战斗技能特效（ダメージエフェクト / 斬撃1–3 / ハンマー / 波動 / エナジードレイン / 数字 id）：没有渲染器，全部 raw（表是以后填的地方）
//   effectPos      effect_pos 的值 → left / center / right（中 左 右 / 1 2 3；数字顺序按 pic_pos 的 1 左 2 中 3 右猜）：映射出的指令里的 {pos} 换成它（raw 指令不变，args 仍是 [effect, effect_pos]）
//   picSize        拡大 / 通常 / 数字 id / 立ち絵全消え：全部 raw；想让「拡大」放大立绘就写 { '拡大': { zoom: 1.2, fit: 0 } }（fit 默认 1 会把比画面高的立绘缩回画面高度，zoom 对它们无效，所以放大要同时 fit: 0）
//   backVoice { attr: 'back_voice', packAttr: 'back_voice_pack', sep: '#', slot: 'back', volume: 1, onMissing: 'keep' }   背景人声：值 = <名>#<音量>（没有 # = volume 默认值），资源按 paths.backVoice（{pack} = 包小写、{voice} = 名）；none（non）= 停；
//        onMissing：没有这个属性的行 keep = 沿用（和 bgm 一样，默认；non 出现了 161 次，说明停是显式写的）/ stop = 这一行没有就停；只在名字变了时才发 bgvoice
//   scene { split: 'chains', forkPolicy: 'merge' }   场景划分：chains = next_id 链；几条链汇合时 merge = 每个场景各自走到底（共用的后半段每个场景都有）/ first = 共用部分只属于文件里最靠前的那条链
// 资源目录来自 config.adapterOptions['grenze-xml']：{ root（游戏根，相对媒体目录，默认 ''）, textDir（默认 <root>/TextAsset）, resourceDir（默认 <root>/assets/resources/patchres）, …上面的选项 }

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { decodeTextFile } from '../../text-decode.mjs'
import { guessTemplate, isPlain, lookupFor, mergeOptions, safeRegex } from './path-templates.mjs'

export const ADAPTER_ID = 'grenze-xml'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const cleanDir = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
const AUDIO_EXTS = ['m4a', 'mp3', 'ogg', 'wav']

export const DEFAULT_OPTIONS = Object.freeze({
  root: '',
  textDir: '',
  resourceDir: '',
  resourceDirs: ['bg', 'bgm', 'sound', 'voice', 'merc/pic'],
  index: { ext: '\\.(?:webp|png|jpe?g|m4a|mp3|ogg|wav)$' },
  exts: { bg: ['webp', 'png', 'jpg', 'jpeg'], bgm: AUDIO_EXTS, sound: AUDIO_EXTS, voice: AUDIO_EXTS, backVoice: AUDIO_EXTS },
  paths: {
    bg: ['bg/battlebg/{name}/{name}.{ext}', 'bg/**/{name}.{ext}'],
    bgm: ['bgm/{lower}/{name}.{ext}', 'bgm/**/{name}.{ext}'],
    sound: ['sound/{name}/{name}.{ext}', 'sound/**/{name}.{ext}'],
    voice: ['voice/{pack}/{voice}.{ext}', 'voice/**/{voice}.{ext}'],
    backVoice: ['voice/{pack}/{voice}.{ext}', 'voice/**/{voice}.{ext}'],
    stand: ['merc/pic/{hero}/{file}'],
  },
  duplicates: { bg: 'first', bgm: 'first', sound: 'first', voice: 'skip', backVoice: 'skip', stand: 'first' },
  standFiles: ['body.webp', 'body.png'],
  standPos: { 1: 'left', 2: 'center', 3: 'right', default: 'center' },
  standKeep: 'untilNewHero',
  standFit: 1,
  none: ['non'],
  bgBlack: ['bg_b'],
  bgSound: { mode: 'se', attrs: ['bg_sound1', 'bg_sound2', 'bg_sound3'] },
  soundAttrs: ['sound1', 'sound2', 'sound3'],
  rawAttrs: ['screen_effect', 'pic_action', 'pic_action_val', 'pic_size', 'effect+effect_pos'],
  attrTables: { screen_effect: 'screenEffects', pic_action: 'picActions', effect: 'effects', pic_size: 'picSize' },
  screenEffects: {
    '速い画面揺れ': { op: 'shake', axis: 'overall', strength: 0.15, seconds: 0.4 },
    '画面シェイク': { op: 'shake', axis: 'overall', strength: 0.25, seconds: 0.6 },
    '溶明_黒幕': { op: 'fade', to: 'clear', seconds: 1 },
    '溶暗_黒幕': { op: 'fade', to: 'black', seconds: 1, at: 'start' },
    'フラッシュ': { op: 'flash', color: 'white', count: 1, seconds: 0.3 },
    'フラッシュ2回': { op: 'flash', color: 'white', count: 2, seconds: 0.3 },
    '光エフェクト': { op: 'wash', color: 'white', seconds: 1 },
    ...Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '13'].map((id) => [id, null])),
  },
  picActions: {
    '立ち絵全消え': { op: 'standOff', at: 'stand' },
    '溶明溶暗': [{ op: 'fade', to: 'black', seconds: 0.4 }, { op: 'fade', to: 'clear', seconds: 0.4 }],
    '下から_全身': null, '右側現れ消え': null, '左側現れ消え': null, 'マスク': null,
    ...Object.fromEntries(['1', '2', '3', '4', '5', '8', '9', '10'].map((id) => [id, null])),
  },
  effects: {
    'ダメージエフェクト': null, '斬撃1': null, '斬撃2': null, '斬撃3': null, 'ハンマー': null, '波動': null, 'エナジードレイン': null,
    ...Object.fromEntries(['17', '18', '20', '21', '22'].map((id) => [id, null])),
  },
  effectPos: { '中': 'center', '左': 'left', '右': 'right', 1: 'left', 2: 'center', 3: 'right' },
  picSize: { '拡大': null, '通常': null, '2': null, '立ち絵全消え': null },
  backVoice: { attr: 'back_voice', packAttr: 'back_voice_pack', sep: '#', slot: 'back', volume: 1, onMissing: 'keep' },
  scene: { split: 'chains', forkPolicy: 'merge' },
})
const FREE_TABLES = ['exts', 'duplicates', 'standPos', 'screenEffects', 'picActions', 'effects', 'effectPos', 'picSize']
const resolved = new WeakMap()
export function resolveOptions(options) {
  const source = options && typeof options === 'object' ? options : null
  if (source && resolved.has(source)) return resolved.get(source)
  const o = mergeOptions(DEFAULT_OPTIONS, source, FREE_TABLES)
  o.root = cleanDir(o.root)
  o.textDir = cleanDir(o.textDir) || joinPath(o.root, 'TextAsset')
  o.resourceDir = cleanDir(o.resourceDir) || joinPath(o.root, 'assets/resources/patchres')
  const list = (value, fallback) => (Array.isArray(value) ? value.map(String) : fallback)
  for (const key of ['resourceDirs', 'standFiles', 'none', 'bgBlack', 'soundAttrs', 'rawAttrs']) o[key] = list(o[key], DEFAULT_OPTIONS[key])
  o.bgSound.attrs = list(o.bgSound.attrs, DEFAULT_OPTIONS.bgSound.attrs)
  for (const key of Object.keys(DEFAULT_OPTIONS.paths)) o.paths[key] = list(o.paths[key], DEFAULT_OPTIONS.paths[key])
  for (const key of Object.keys(o.exts)) o.exts[key] = list(o.exts[key], AUDIO_EXTS)
  for (const key of ['screenEffects', 'picActions', 'effects', 'effectPos', 'picSize']) { o[key] = Object.fromEntries(Object.entries(o[key]).filter(([name]) => name !== '__proto__')) }
  if (!isPlain(o.attrTables)) o.attrTables = DEFAULT_OPTIONS.attrTables
  o.none = o.none.map((v) => v.toLowerCase())
  o.bgBlack = o.bgBlack.map((v) => v.toLowerCase())
  o.ext = safeRegex(o.index.ext, 'i')
  if (source) resolved.set(source, o)
  return o
}
const textDirOf = (options) => resolveOptions(options).textDir
const resourceDirOf = (options) => resolveOptions(options).resourceDir

export function sniff(text) {
  return /<easy_dialog-\d+(?:\s[^>]*)?\sid\s*=\s*"/.test(String(text || '').slice(0, 8192))
}

// ---------- XML 行 ----------
const ROW_RE = /<easy_dialog-\d+((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g
const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function unescapeXml(value) {
  const s = String(value ?? '')
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity.toLowerCase()] ?? whole
  })
}

// 文本 → 行数组：每行 = 属性对象（值是没有解转义的原文，text / name 用到时再 unescapeXml）
export function readRows(text) {
  const rows = []
  const source = String(text || '')
  ROW_RE.lastIndex = 0
  let m
  while ((m = ROW_RE.exec(source))) {
    const row = {}
    ATTR_RE.lastIndex = 0
    let a
    const attrs = m[1]
    while ((a = ATTR_RE.exec(attrs))) row[a[1]] = a[2] ?? a[3]
    rows.push(row)
  }
  return rows
}

const MAX_CHAIN_ROWS = 200000
// 行数组 → 场景（链）：{ start: 起点行 id, rows: [行下标…] }；forks = 有几行指向同一个 id（汇合点）的个数
// forkPolicy：'merge'（默认）每个场景各自走到底；'first' 汇合后的共用部分只属于最靠前的那条链（后面的链走到已经被认领的行就停）
// 返回的 walk(i) = 从第 i 行沿 next_id 走到底（完整的一条链，不管有没有被认领）
export function splitScenes(rows, { forkPolicy = 'merge' } = {}) {
  const indexOf = new Map()
  rows.forEach((row, i) => { if (row.id !== undefined && !indexOf.has(row.id)) indexOf.set(row.id, i) })
  const incoming = new Set()
  let merges = 0
  const pointed = new Map()
  for (const [i, row] of rows.entries()) {
    const next = row.next_id
    if (next === undefined || next === '' || !indexOf.has(next) || indexOf.get(next) === i) continue
    incoming.add(next)
    pointed.set(next, (pointed.get(next) || 0) + 1)
  }
  for (const n of pointed.values()) if (n > 1) merges += 1
  const claimed = new Uint8Array(rows.length)
  const walkFrom = (from, stopAtClaimed) => {
    const chain = []
    const seen = new Set()
    let i = from
    while (i !== undefined && !seen.has(i) && chain.length < MAX_CHAIN_ROWS && !(stopAtClaimed && claimed[i])) {
      seen.add(i)
      chain.push(i)
      const next = rows[i].next_id
      i = next === undefined || next === '' ? undefined : indexOf.get(next)
    }
    return chain
  }
  const scenes = []
  const take = (i) => {
    const chain = walkFrom(i, forkPolicy === 'first')
    for (const r of chain) claimed[r] = 1
    scenes.push({ start: rows[i].id, rows: chain })
  }
  for (const [i, row] of rows.entries()) {
    if (row.id === undefined || indexOf.get(row.id) !== i || incoming.has(row.id)) continue
    take(i)
  }
  let cycles = 0
  for (const [i, row] of rows.entries()) {   // 没人指向的环（和环尾巴）：没被任何起点走到的行，从最靠前的开始
    if (claimed[i] || row.id === undefined || indexOf.get(row.id) !== i) continue
    take(i)
    cycles += 1
  }
  return { scenes, indexOf, walk: (from) => walkFrom(from, false), stats: { rows: rows.length, merges, cycles, duplicateIds: rows.filter((row, i) => row.id !== undefined && indexOf.get(row.id) !== i).length } }
}

// ---------- 上下文：场景索引 + 资源文件名索引 ----------
export const contextFiles = () => []
export const contextDirs = (options) => [textDirOf(options), ...resolveOptions(options).resourceDirs.map((dir) => joinPath(resourceDirOf(options), dir))]
export const contextWalkLimit = 2000000   // voice 一个目录就十万级文件，索引绝不能被默认的 40 万上限悄悄截断

const SCENE_CACHE_MAX = 200
const sceneCache = new Map()   // 绝对路径|mtime|size → { scenes, stats }（一个文件的场景列表；文件没变就不再扫描）
const stripMarks = (text) => String(text).replace(/\s+/g, ' ').trim()

// 一个文件 → 场景列表（给列表用：起点 id、行数、句数、前几个说话人、首句）
function summarize(rows, forkPolicy) {
  const { scenes, stats } = splitScenes(rows, { forkPolicy })
  const out = scenes.map((scene) => {
    const names = []
    let lines = 0
    let excerpt = ''
    for (const i of scene.rows) {
      const row = rows[i]
      if (row.text === undefined || row.text === '') continue
      lines += 1
      const name = unescapeXml(row.name ?? '')
      if (name && name !== '-' && names.length < 3 && !names.includes(name)) names.push(name)
      if (!excerpt) excerpt = stripMarks(unescapeXml(row.text)).slice(0, 24)
    }
    return { start: scene.start, rows: scene.rows.length, lines, names, excerpt }
  })
  return { scenes: out, stats }
}

async function scenesOfFile(abs, forkPolicy) {
  let info
  try { info = await stat(abs) } catch { return null }
  const key = `${abs}|${info.mtimeMs}|${info.size}|${forkPolicy}`
  const hit = sceneCache.get(key)
  if (hit) return hit
  let text
  try { text = decodeTextFile(await readFile(abs)).text } catch { return null }
  const summary = summarize(readRows(text), forkPolicy)
  if (sceneCache.size >= SCENE_CACHE_MAX) sceneCache.delete(sceneCache.keys().next().value)
  sceneCache.set(key, summary)
  return summary
}

export async function prepare({ options, files, toResourcePath, truncated, mediaDir }) {
  const o = resolveOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const { textDir, resourceDir } = o
  const index = new Map()     // 相对资源根的路径（模板按这个找）→ 资源路径（播放页 / 资源接口认的路径）
  const dialogFiles = []
  for (const rel of files || []) {
    if (rel.startsWith(`${textDir}/`)) {
      const inText = rel.slice(textDir.length + 1)
      const m = /^easy_dialog-(\d+)\.xml$/i.exec(inText)
      if (m) dialogFiles.push({ rel, n: Number(m[1]), name: inText })
      continue
    }
    if (!rel.startsWith(`${resourceDir}/`)) continue
    if (!o.ext || o.ext.test(rel)) index.set(rel.slice(resourceDir.length + 1), toRes(rel))
  }
  dialogFiles.sort((a, b) => a.n - b.n)
  const catalogFiles = []
  for (const file of dialogFiles) {
    const got = mediaDir ? await scenesOfFile(path.join(mediaDir, ...file.rel.split('/')), o.scene.forkPolicy) : null
    if (got?.scenes.length) catalogFiles.push({ ...file, ...got })
  }
  const ctx = { index, hasIndex: Boolean(files?.length), truncated: Boolean(truncated), resourceDir, options }
  ctx.catalogTree = buildCatalog(catalogFiles)
  return ctx
}

function buildCatalog(catalogFiles) {
  if (!catalogFiles.length) return null
  return {
    children: catalogFiles.map((file) => {
      const id = `f${file.n}`
      return {
        id,
        title: `easy_dialog-${file.n}`,
        subtitle: `${file.scenes.length} 个场景`,
        children: file.scenes.map((scene) => ({
          id: `${id}/${scene.start}`,
          title: scene.start,
          subtitle: [`${scene.lines} 句`, scene.names.join('、'), scene.excerpt].filter(Boolean).join(' · '),
          script: `${file.rel}::${scene.start}`,
        })),
      }
    }),
  }
}

export const catalog = (ctx) => ctx?.catalogTree || null

// ---------- 解析 ----------
export function parse(text, ctx = null, meta = {}) {
  const rows = readRows(text)
  if (!rows.length) throw new Error('找不到 easy_dialog 行（不是 Grenze 的对话 XML）')
  const o = resolveOptions(meta?.options ?? ctx?.options)
  const { scenes, indexOf, walk, stats: graph } = splitScenes(rows, { forkPolicy: o.scene.forkPolicy === 'first' ? 'first' : 'merge' })
  const want = meta?.scene !== undefined && meta?.scene !== '' ? String(meta.scene) : ''
  let chain
  let start
  if (want) {
    if (!indexOf.has(want)) throw Object.assign(new Error(`文件里没有场景 ${want}（起点行 id 不存在）`), { statusCode: 404 })
    start = want
    chain = o.scene.forkPolicy === 'first' ? scenes.find((scene) => scene.start === want)?.rows : null
    chain = chain || walk(indexOf.get(want))
  } else {   // 没指定场景（直接打开整份文件）：播第一个场景
    start = scenes[0]?.start ?? rows[0].id
    chain = scenes[0]?.rows || [0]
  }
  const stats = { rows: chain.length, scene: start, scenes: scenes.length, commands: 0, raw: {}, unresolved: {}, mapped: {}, stands: 0, ...(ctx?.truncated ? { indexTruncated: true } : {}), ...(graph.merges ? { merges: graph.merges } : {}), ...(graph.cycles ? { cycles: graph.cycles } : {}) }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const indexed = Boolean(ctx?.hasIndex)
  const lower = (value) => String(value).trim().toLowerCase()
  const isNone = (value) => o.none.includes(lower(value ?? ''))
  const lookup = indexed ? lookupFor(ctx, ctx.index, meta?.config?.resourceResolve) : null

  // 名字 → 资源路径：有索引就查索引（找不到 = ''），没有索引就按模板猜（每个列表的第一条）
  const resolve = (kind, vars) => {
    const templates = o.paths[kind]
    const full = { ...vars, ext: o.exts[kind] }
    if (!indexed) return guessTemplate(templates, full)
    const key = lookup.find(templates, full, o.duplicates[kind])
    return key ? ctx.index.get(key) || '' : ''
  }
  const bgOf = (name) => resolve('bg', { name })
  const bgmOf = (name) => resolve('bgm', { name, lower: lower(name) })
  const soundOf = (name) => resolve('sound', { name })
  const voiceOf = (pack, name) => resolve('voice', { pack: lower(pack), voice: name })
  const standOf = (id) => resolve('stand', { hero: String(id).trim(), file: o.standFiles })
  const present = (value) => value !== undefined && value !== ''

  const backVoiceOf = (pack, name) => resolve('backVoice', { pack: lower(pack), voice: name })
  const steps = []
  let commands = []
  let speaker = null
  let curBgm = ''
  let pack = ''
  let backPack = ''
  let curBackVoice = ''   // 正在放的背景人声（<名>#<音量> 原文）
  let stand = ''        // 当前立绘的 hero_group_id|pic_pos（空 = 没有）
  let standHero = ''    // 当前立绘的 hero_group_id（pic_size 变了要重发时用）
  let standAlign = ''
  let size = null       // 当前 pic_size 的覆盖 { zoom?, fit? }（picSize 表里映射成对象的）
  let standSrc = ''
  let standSize = ''    // 当前立绘是按哪个 pic_size 覆盖画的（JSON）
  const emit = (command) => commands.push(command)
  const standOff = () => { if (stand) { emit({ op: 'standOff' }); stand = ''; standHero = ''; standSrc = '' } }
  const standPart = (src, align) => {
    const fit = size && size.fit !== undefined ? size.fit : o.standFit
    return { src, align, ...(fit ? { fit } : {}), ...(size && Number(size.zoom) > 0 && Number(size.zoom) !== 1 ? { zoom: Number(size.zoom) } : {}) }
  }
  const attrValue = (value) => unescapeXml(value).trim()
  const posOf = (value) => (value !== undefined && value !== '' && Object.hasOwn(o.effectPos, attrValue(value)) ? String(o.effectPos[attrValue(value)]) : '')
  const fill = (op, pos) => (pos ? Object.fromEntries(Object.entries(op).map(([k, v]) => [k, typeof v === 'string' ? v.replaceAll('{pos}', pos) : v])) : op)
  // 特效类属性 → 映射出来的指令（按 at 分到三个时机）或 raw；返回 false = 不是本函数处理的（没有这个属性）
  const phases = { start: [], stand: [], end: [], raw: [] }
  const collectAttr = (spec, row) => {
    const [cmd, ...more] = spec.split('+')
    if (!present(row[cmd])) return
    const value = attrValue(row[cmd])
    const tableName = Object.hasOwn(o.attrTables, cmd) ? o.attrTables[cmd] : ''
    const table = tableName && isPlain(o[tableName]) ? o[tableName] : null
    const mapping = table && Object.hasOwn(table, value) ? table[value] : null
    const label = `${cmd}:${value}`
    if (mapping === 'drop') return
    if (cmd === 'pic_size' && isPlain(mapping) && mapping.op === undefined) { size = mapping; count('mapped', label); return }
    const pos = more.length ? posOf(row[more[0]]) : ''
    const ops = (Array.isArray(mapping) ? mapping : isPlain(mapping) ? [mapping] : []).filter((op) => isPlain(op) && typeof op.op === 'string')
    if (!ops.length) {
      phases.raw.push({ op: 'raw', cmd, args: [row[cmd], ...more.map((attr) => row[attr] ?? '')] })
      count('raw', label)
      return
    }
    for (const { at, ...op } of ops) phases[at === 'start' || at === 'stand' ? at : 'end'].push(fill(op, pos))
    count('mapped', label)
  }
  const flushPhase = (name) => {
    for (const op of phases[name]) { if (op.op === 'standOff') standOff(); else emit(op) }
    phases[name] = []
  }

  for (const i of chain) {
    const row = rows[i]
    for (const spec of o.rawAttrs) collectAttr(spec, row)
    flushPhase('start')
    // --- 背景（换背景 = 换场景，立绘清掉）---
    if (present(row.background) && !isNone(row.background)) {
      const src = bgOf(row.background)
      standOff()
      if (src) emit({ op: 'bg', src, fade: 0 })
      else if (o.bgBlack.includes(lower(row.background))) emit({ op: 'bg', color: [0, 0, 0], fade: 0 })
      else count('unresolved', `bg:${row.background}`)
    }
    // --- BGM（none = 停）---
    if (present(row.bgm)) {
      if (isNone(row.bgm)) { if (curBgm) emit({ op: 'bgmStop', fade: 0 }); curBgm = '' } else if (row.bgm !== curBgm) {
        const src = bgmOf(row.bgm)
        if (src) { emit({ op: 'bgm', src }); curBgm = row.bgm } else count('unresolved', `bgm:${row.bgm}`)
      }
    }
    // --- 音效（none = 无）：bg_sound 按 bgSound.mode 放，其余一次性 ---
    for (const [key, background] of [...o.bgSound.attrs.map((attr) => [attr, true]), ...o.soundAttrs.map((attr) => [attr, false])]) {
      const name = row[key]
      if (!present(name) || isNone(name)) continue
      const src = soundOf(name)
      if (!src) count('unresolved', `sound:${name}`)
      else emit(background && o.bgSound.mode === 'bgse' ? { op: 'bgse', src, loop: true } : { op: 'se', src })
    }
    // --- 立绘（没有 hero_group_id 的行按 standKeep：沿用上一个 / 清掉）---
    flushPhase('stand')
    if (present(row.voice_pack)) pack = row.voice_pack
    if (present(row.back_voice_pack)) backPack = row.back_voice_pack
    const sizeKey = size ? JSON.stringify(size) : ''
    if (present(row.hero_group_id)) {
      const align = o.standPos[String(Number(row.pic_pos))] || o.standPos.default || 'center'
      const key = `${String(row.hero_group_id).trim()}|${align}|${sizeKey}`
      if (key !== stand) {
        const src = standOf(row.hero_group_id)
        if (src) { emit({ op: 'stand', parts: [standPart(src, align)] }); stand = key; standHero = String(row.hero_group_id).trim(); standSrc = src; standAlign = align; standSize = sizeKey; stats.stands += 1 } else { count('unresolved', `stand:${row.hero_group_id}`); standOff() }
      }
    } else if (o.standKeep === 'perRow') standOff()
    else if (stand && standSrc && sizeKey !== standSize) {   // pic_size 变了：用新的大小重发当前立绘
      emit({ op: 'stand', parts: [standPart(standSrc, standAlign)] })
      stand = `${standHero}|${standAlign}|${sizeKey}`
      standSize = sizeKey
    }
    flushPhase('end')
    // --- 语音 ---
    if (present(row.voice) && !isNone(row.voice)) {
      const src = voiceOf(row.voice_pack || pack, row.voice)
      if (src) emit({ op: 'voice', src }); else count('unresolved', `voice:${row.voice_pack || pack}/${row.voice}`)
    }
    // --- 背景人声（back_voice = <名>#<音量>；none = 停；没有这个属性按 backVoice.onMissing）---
    const bv = o.backVoice
    const bvValue = present(row[bv.attr]) ? attrValue(row[bv.attr]) : undefined
    if (bvValue !== undefined && isNone(bvValue)) { if (curBackVoice) emit({ op: 'bgvoiceOff', slot: bv.slot }); curBackVoice = '' } else if (bvValue === undefined) {
      if (bv.onMissing === 'stop' && curBackVoice) { emit({ op: 'bgvoiceOff', slot: bv.slot }); curBackVoice = '' }
    } else if (bvValue !== curBackVoice) {
      const cut = bv.sep ? bvValue.lastIndexOf(bv.sep) : -1
      const name = (cut > 0 ? bvValue.slice(0, cut) : bvValue).trim()
      const volume = cut > 0 && Number.isFinite(Number.parseFloat(bvValue.slice(cut + bv.sep.length))) ? Math.max(0, Math.min(1, Number.parseFloat(bvValue.slice(cut + bv.sep.length)))) : bv.volume
      const src = backVoiceOf(backPack || pack, name)
      if (src) { emit({ op: 'bgvoice', slot: bv.slot, src, volume }); curBackVoice = bvValue } else count('unresolved', `backVoice:${backPack || pack}/${name}`)
    }
    // --- 含义未知的 / 没有映射的：raw ---
    for (const op of phases.raw) emit(op)
    phases.raw = []

    // --- 台词：没有 text 的行只放指令（并进下一句）---
    if (row.text === undefined || row.text === '') continue
    const name = unescapeXml(row.name ?? '')
    const who = name === '-' ? '' : name
    if (who !== speaker) { emit({ op: 'speaker', segments: who ? [{ text: who }] : [] }); speaker = who }
    const body = unescapeXml(row.text)
    emit({ op: 'text', segments: body ? [{ text: body }] : [] })
    stats.commands += commands.length
    steps.push({ index: steps.length, commands })
    commands = []
  }
  if (commands.length) {
    stats.commands += commands.length
    if (steps.length) steps[steps.length - 1].commands.push(...commands)
    else steps.push({ index: 0, commands: [...commands, { op: 'text', segments: [] }] })
  }
  return { steps, stats }
}

export const grenzeXmlAdapter = { id: ADAPTER_ID, label: 'Grenze（GrenzeViewer）对话 XML', sceneInPath: true, sniff, parse, contextFiles, contextDirs, contextWalkLimit, prepare, catalog }
