// 适配器：Otogi Frontier R（离线网页版播放器，用户本地的拷贝）的剧情 JSON → 规范场景（gal-scene/1）。
// 游戏目录（= root）：list.json、typeadv/MScenes/<id>（普通剧情）、json/<id>（成人剧情）、Episode/Main/<章 id>、VieableEpisodeList/<n>、MasterData/MMonsters.json …
// 剧情文件**没有扩展名**（typeadv/MScenes/10001、json/1200051）→ 引擎的 config.scriptExtensions 写 ['']（空串 = 没有扩展名，见 config.mjs）。
// 两种脚本（sniff 按开头认：{"Id":N,"Title":…,"MSceneDetails":[ / {"Id":N,"Description":…,"MAdultDetails":[；容忍 BOM / 缩进 / 换行；顶层不是剧情对象的 JSON 不认）：
//   普通剧情 { Id, Title, MSceneDetails: [行] }，一行 = 玩家点一下（20 个键，常用 Position Name Phrase MMonsterId EmotionId BackgroundImage BGM SE VoiceFileName Effect）：
//     BackgroundImage → bg（typeadv/bg/adventure/<名>.png；磁盘上也可能平铺在 typeadv/bg/，两个候选都试）    BGM → bgm（bgm/<名>.m4a，保持到换）
//     SE / VoiceFileName → se / voice（typeadv/voice/adventure/voice_adventure_<MSceneId>/<名>.m4a；用户那份只有一小部分语音，找不到的不发指令，记进 stats.missing）
//     Effect → effects 表（Flash = 白屏渐退 wash、Damage = 红屏渐退；表里没有的值记 raw）
//     Phrase（%user_name → protagonist）→ text；Position 1 = 旁白（说话人空）；Position 2 / 3 = 说话人 Name，同时摆这个位置的立绘（MMonsterId 非空时）
//     立绘 = typeadv/CharaStand/Adventure/<MMonsterId>/body.png（底）+ 表情叠层（EmotionId → idle / sad / surprise / angry / shy / joy / idle / violent：先 <表情>_c.png 再 <表情>.png 叠上去，
//       原页面的 CSS 背景层写的是 url(<表情>.png), url(<表情>_c.png)，前一层在上）；Position 2 = 左、3 = 右（positions 表）；同一个角色已经在另一边 → 另一边收掉；说话的一边画在上面；
//       IsBackgroundOnly → 两边都收掉；立绘有没有、换不换、收不收完全看脚本怎么写（MMonsterId / IsBackgroundOnly / 换背景），旁白行不做特殊处理
//     空 Phrase 的行（只换背景 / 立绘 / 声音）：命令并进下一句（原页面里要多点一下，文字不变）。SpeechBalloon / FrameImage / HintImageName / PhraseFontSize / IsPhraseCenter 只是界面皮肤，不渲染（PhraseFontSize 可用 text.sizeMap 映射成字号）
//   成人剧情 { Id, Description, MAdultDetails: [行] }（json/<Id> 日文；jsoncn/<Id> 中文），一行 = 一步（Order Name Serif Motion Voice StillPath BGM CharaAnimation SE Effect）：
//     画面 = Spine 静态画面 chara/still/<Id>/<Id>.json + <Id>.atlas.txt（Spine 3.6 JSON）→ spine 指令（kind still，slot still1）；Order 1（或第一行）建它，位置 / 缩放来自 list.json data[<Id>]["1"] = {X, Y, Z}
//     CharaAnimation → anim 表（1 = animation1 循环、2 = animation2 循环、3 = animation3 播一次 + 白闪 + 速度 0.5、4 = animation4 循环；null = 不变）；Motion → speed（> 1 乘 0.75，0 = 暂停用 motion.zero；null = 不变；CharaAnimation 3 的行不看 Motion）
//     Effect "2" → 黑场渐退 0.5 秒（wash black）；Effect "1" 原页面没有处理（表里写 []）；BGM → bgm；Voice → voice（othersounds/still/<Id>/<Voice>.m4a，找不到的不发指令、记 stats.missing）；Name / Serif → speaker / text
//     SE 非空：原页面不处理 → raw；StillPath：原页面不用，忽略
// 语言：options.lang（jp / cn / tw，默认 jp）按 langs 表选目录（普通剧情 typeadv/MScenes_TW、成人剧情 jsoncn），表里没有的文件退回日文；列表（catalog）里每个节点的脚本路径就是选好的那个文件（打开脚本只认路径，所以选择发生在列表里）。
//   MScenes_TW 里有的文件顶层是数组（多个场景）：parse 容忍——arrayScenes 'first'（默认）= 只播第一个场景（原页面非「主线」模式的做法）/ 'all' = 依次全播。
// 列表（catalog，节点 id 稳定）：
//   main              主线（Episode/Main/<章 id> 每章一个目录 main/<章 id>，章名 = list.json worldmap 里同 Id 的名字，没有就用章 id；里面是 MStoryId 对应的场景，标题 = 数组里的 Title）
//   chars             角色（VieableEpisodeList 里按 MMonsterId 分组：c/<MMonsterId>，名字 = MasterData/MMonsters.json 的 n，没有就取 list.json chara[id].name[0]；里面是这个角色的普通剧情（MSceneId）和成人剧情（MAdultId，角标 R18））
//   all               全部普通剧情（typeadv/MScenes 里每个文件，标题 = 文件里的 Title，没有就用 id）
//   adult             全部成人剧情（json 里每个文件，标题 = VieableEpisodeList 里的 Title，没有就用 id）
//   没有脚本文件的条目（MStoryId / MSceneId 指到不存在的文件）不列。标题来自读每个剧情文件开头（contextSampleLimit 20000）。
// 参数全部来自 config.adapterOptions['otogi-json']（meta.options / prepare 的 options），完整结构和默认值见 DEFAULT_OPTIONS（对象逐层合并，数组 / 标量整个替换；表类的键（langs / positions / emotions / anim / effects）逐项覆盖 / 追加）。
//   管理员脚本 gal-layout 的 ADAPTER_RULES['otogi-json'] 抄一份写进条目 config（漂移守卫 scripts/dev/gal-layout-rules-selftest.mjs）。
//   root ('')                      游戏目录（相对媒体目录）
//   lang ('jp') / langs            见上；langs[<语言>] = { normal: [目录…], adult: [目录…] }（相对 root，按顺序试，最后总是退回 jp）
//   protagonist ('人間')           %user_name 换成什么
//   idPattern ('^\d+$')            剧情文件名（去掉扩展名）长什么样才算剧情（列表只收匹配的；目录里的说明 / 备份文件不进列表）
//   data { list, monsters, episodes, main }   list.json / MMonsters.json / VieableEpisodeList / Episode/Main 的位置（相对 root）
//   index { dirs, ext }            进文件索引的目录（相对 root；引擎的 contextDirs 最多 10 个）/ 扩展名正则（资源文件才进索引；剧情目录单独登记）
//   paths { bg, bgm, voice, se, adultVoice, stand, skel, atlas, icon }    候选路径模板（数组，第一个在索引里的为准；占位符 {name} {scene} {monster} {ext}（见 exts））；没有索引时按每个列表的第一条猜
//   exts { image: [png, webp, jpg], audio: [m4a, mp3, ogg, wav] }          {ext} 的顺序 = 同名文件的优先级
//   positions { '1': 'narration', '2': 'left', '3': 'right' }               Position → narration / left / center / right（不在表里的 Position 当旁白）
//   emotions { '1': 'idle', … '8': 'violent' }                              EmotionId → 表情文件名（不在表里 / null = 沿用这个位置上同一角色的上一个表情，没有就只有 body）
//   stand { body: 'body', layers: ['{emotion}_c', '{emotion}'], fit: 1, duplicate: 'hideOther', dim: 0 }
//        body = 底图名；layers = 叠层（从下到上，{emotion} = 表情名）；fit = 立绘部件的 fit（图比画面高就缩到画面高度，0 = 不带）；narration = keep / hide；duplicate = hideOther（同一角色在另一边已出现就收掉另一边）/ keep；dim = 0..1 不说话的一边的亮度（0 = 不压暗）
//   anim { '1': { anim: 'animation1', loop: true }, '2': …, '3': { anim: 'animation3', loop: false, speed: 0.5, effect: 'climax' }, '4': … }    CharaAnimation → spine 动画；speed = 这个动画自己的速度（有就覆盖 Motion）；effect = 进 effects 表的名字（每遇到一行都发）
//   motion { fastAbove: 1, fastFactor: 0.75, zero: 0.01 }                   Motion > fastAbove 时 speed = Motion × fastFactor；Motion 0 → zero（spine 指令不认 0）
//   effects { Flash: [{ op: 'wash', color: 'white', seconds: 1.04 }], Damage: […red], '1': [], '2': [{ op: 'wash', color: 'black', seconds: 0.52 }], climax: [{ op: 'flash', color: 'white', count: 1, seconds: 3 }] }    Effect 的值 → 要发的指令（数组；[] = 认得、没有画面；op 只能是 wash / flash / fade / shake）
//   text { sizeMap: {}, breakPattern: '<br\\s*/?>' }      PhraseFontSize → 字号（style.size，空 = 不设）；Phrase 里当换行的写法（正则，空 = 不处理）
//   arrayScenes ('first')          顶层是数组的文件：first / all
//   sniff { bytes: 8192, normal: 'MSceneDetails', adult: 'MAdultDetails' }  嗅探读多少字节 / 两种剧情的行数组键名
// 文件索引走 createIndexResolver（config.resourceResolve 自动生效）；索引在 prepare 里按目录遍历一次（语音约十万个文件，contextWalkLimit 80 万）。

import { expandTemplate, guessTemplate, lookupFor, mergeOptions, safeRegex } from './path-templates.mjs'

export const ADAPTER_ID = 'otogi-json'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const cleanDir = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
const isObj = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const AUDIO = ['m4a', 'mp3', 'ogg', 'wav']
const IMAGE = ['png', 'webp', 'jpg']

export const DEFAULT_OPTIONS = Object.freeze({
  root: '',
  lang: 'jp',
  langs: {
    jp: { normal: ['typeadv/MScenes'], adult: ['json'] },
    cn: { normal: ['typeadv/MScenes_TW'], adult: ['jsoncn'] },
    tw: { normal: ['typeadv/MScenes_TW'], adult: ['jsoncn'] },
  },
  protagonist: '人間',
  idPattern: '^\\d+$',
  data: { list: 'list.json', monsters: 'MasterData/MMonsters.json', episodes: 'VieableEpisodeList', main: 'Episode/Main' },
  index: {
    dirs: ['typeadv', 'chara/still', 'othersounds', 'bgm', 'json', 'jsoncn', 'VieableEpisodeList', 'Episode/Main', 'icon/chara/icon/png'],
    ext: '\\.(?:png|jpe?g|webp|m4a|mp3|ogg|wav|json|atlas\\.txt)$',
  },
  paths: {
    bg: ['typeadv/bg/adventure/{name}.{ext}', 'typeadv/bg/{name}.{ext}'],
    bgm: ['bgm/{name}.{ext}'],
    voice: ['typeadv/voice/adventure/voice_adventure_{scene}/{name}.{ext}'],
    se: ['typeadv/voice/adventure/voice_adventure_{scene}/{name}.{ext}'],
    adultVoice: ['othersounds/still/{scene}/{name}.{ext}'],
    stand: ['typeadv/CharaStand/Adventure/{monster}/{name}.{ext}'],
    skel: ['chara/still/{scene}/{scene}.json'],
    atlas: ['chara/still/{scene}/{scene}.atlas.txt'],
    icon: ['icon/chara/icon/png/{monster}.{ext}'],
  },
  exts: { image: IMAGE, audio: AUDIO },
  positions: { 1: 'narration', 2: 'left', 3: 'right' },
  emotions: { 1: 'idle', 2: 'sad', 3: 'surprise', 4: 'angry', 5: 'shy', 6: 'joy', 7: 'idle', 8: 'violent' },
  stand: { body: 'body', layers: ['{emotion}_c', '{emotion}'], fit: 1, duplicate: 'hideOther', dim: 0 },
  anim: {
    1: { anim: 'animation1', loop: true },
    2: { anim: 'animation2', loop: true },
    3: { anim: 'animation3', loop: false, speed: 0.5, effect: 'climax' },
    4: { anim: 'animation4', loop: true },
  },
  motion: { fastAbove: 1, fastFactor: 0.75, zero: 0.01 },
  effects: {
    Flash: [{ op: 'wash', color: 'white', seconds: 1.04 }],
    Damage: [{ op: 'wash', color: 'red', seconds: 1.04 }],
    1: [],
    2: [{ op: 'wash', color: 'black', seconds: 0.52 }],
    climax: [{ op: 'flash', color: 'white', count: 1, seconds: 3 }],
  },
  text: { sizeMap: {}, breakPattern: '<br\\s*/?>' },
  arrayScenes: 'first',
  sniff: { bytes: 8192, normal: 'MSceneDetails', adult: 'MAdultDetails' },
})
const FREE_TABLES = ['langs', 'positions', 'emotions', 'anim', 'effects', 'sizeMap']
const EFFECT_OPS = ['wash', 'flash', 'fade', 'shake']

const resolved = new WeakMap()
// 原始参数 → 补满默认值、规整过的参数（同一个对象只算一次）
export function resolveOptions(options) {
  const source = isObj(options) ? options : null
  if (source && resolved.has(source)) return resolved.get(source)
  const o = mergeOptions(DEFAULT_OPTIONS, source, FREE_TABLES)
  const list = (value, fallback) => (Array.isArray(value) ? value.map(String).filter(Boolean) : fallback)
  // 表类的键（逐项覆盖）：默认项被写坏（类型不对）时退回默认值，不是丢掉
  const keep = (table, defaults, ok) => { for (const [key, value] of Object.entries(defaults)) if (!ok(table[key])) table[key] = structuredClone(value) }
  keep(o.anim, DEFAULT_OPTIONS.anim, (v) => isObj(v) && typeof v.anim === 'string' && v.anim)
  keep(o.effects, DEFAULT_OPTIONS.effects, Array.isArray)
  keep(o.positions, DEFAULT_OPTIONS.positions, (v) => typeof v === 'string' && v)
  keep(o.emotions, DEFAULT_OPTIONS.emotions, (v) => typeof v === 'string' && v)
  o.root = cleanDir(o.root)
  o.lang = String(o.lang || 'jp').toLowerCase()
  if (!isObj(o.langs[o.lang])) o.lang = 'jp'
  for (const [lang, table] of Object.entries(o.langs)) {
    const given = isObj(table) ? table : {}
    o.langs[lang] = { normal: list(given.normal, []).map(cleanDir), adult: list(given.adult, []).map(cleanDir) }
  }
  if (!isObj(o.langs.jp)) o.langs.jp = { normal: ['typeadv/MScenes'], adult: ['json'] }
  o.protagonist = String(o.protagonist ?? '人間')
  o.idRe = safeRegex(o.idPattern, '') || /^\d+$/
  for (const key of ['list', 'monsters', 'episodes', 'main']) o.data[key] = cleanDir(o.data[key]) || DEFAULT_OPTIONS.data[key]
  o.index.dirs = list(o.index.dirs, DEFAULT_OPTIONS.index.dirs).map(cleanDir).filter(Boolean)
  o.index.re = safeRegex(o.index.ext, 'i')
  for (const key of Object.keys(DEFAULT_OPTIONS.paths)) o.paths[key] = list(o.paths[key], DEFAULT_OPTIONS.paths[key])
  for (const key of Object.keys(DEFAULT_OPTIONS.exts)) o.exts[key] = list(o.exts[key], DEFAULT_OPTIONS.exts[key])
  o.positions = Object.fromEntries(Object.entries(o.positions).map(([k, v]) => [String(k), String(v)]))
  o.emotions = Object.fromEntries(Object.entries(o.emotions).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => [String(k), v]))
  o.stand.body = String(o.stand.body || 'body')
  o.stand.layers = list(o.stand.layers, DEFAULT_OPTIONS.stand.layers)
  o.stand.duplicate = o.stand.duplicate === 'keep' ? 'keep' : 'hideOther'
  o.stand.dim = Number(o.stand.dim) > 0 && Number(o.stand.dim) < 1 ? Number(o.stand.dim) : 0
  o.anim = Object.fromEntries(Object.entries(o.anim).filter(([, v]) => isObj(v) && typeof v.anim === 'string' && v.anim).map(([k, v]) => [String(k), { anim: v.anim, loop: v.loop !== false, speed: Number(v.speed) > 0 ? Number(v.speed) : 0, effect: typeof v.effect === 'string' ? v.effect : '' }]))
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
  o.motion = { fastAbove: num(o.motion.fastAbove, 1), fastFactor: Number(o.motion.fastFactor) > 0 ? Number(o.motion.fastFactor) : 0.75, zero: Number(o.motion.zero) > 0 ? Number(o.motion.zero) : 0.01 }
  const effects = {}
  for (const [key, commands] of Object.entries(o.effects)) {
    if (!Array.isArray(commands)) continue
    effects[String(key)] = commands.filter((c) => isObj(c) && EFFECT_OPS.includes(c.op)).map((c) => structuredClone(c))
  }
  o.effects = effects
  o.text.sizeMap = isObj(o.text.sizeMap) ? Object.fromEntries(Object.entries(o.text.sizeMap).filter(([, v]) => Number(v) > 0).map(([k, v]) => [String(k), Number(v)])) : {}
  o.text.re = o.text.breakPattern ? safeRegex(o.text.breakPattern, 'gi') : null
  o.arrayScenes = o.arrayScenes === 'all' ? 'all' : 'first'
  o.sniff = { bytes: Math.max(256, Math.min(65536, Math.floor(num(o.sniff.bytes, 8192)))), normal: String(o.sniff.normal || 'MSceneDetails'), adult: String(o.sniff.adult || 'MAdultDetails') }
  if (source) resolved.set(source, o)
  return o
}

// ---------- 嗅探 ----------
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sniffRes = new Map()
function sniffRe(o) {
  const key = `${o.sniff.normal}|${o.sniff.adult}`
  if (!sniffRes.has(key)) {
    const value = '(?:"(?:[^"\\\\]|\\\\.)*"|null)'
    sniffRes.set(key, new RegExp(`^\\s*(\\[\\s*)?\\{\\s*"Id"\\s*:\\s*-?\\d+\\s*,\\s*"(?:Title|Description)"\\s*:\\s*${value}\\s*,\\s*"(${escapeRe(o.sniff.normal)}|${escapeRe(o.sniff.adult)})"\\s*:\\s*\\[`))
  }
  return sniffRes.get(key)
}
// 为什么认 / 不认（给诊断和测试用）：{ ok, kind: 'normal' | 'adult' | '', array, reason }
export function explainSniff(text, options = null) {
  const o = resolveOptions(options)
  const head = String(text || '').replace(/^﻿/, '').slice(0, o.sniff.bytes)
  const trimmed = head.trimStart()
  if (!trimmed) return { ok: false, kind: '', array: false, reason: '空文件' }
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return { ok: false, kind: '', array: false, reason: '不是 JSON 对象 / 数组' }
  const m = sniffRe(o).exec(head)
  if (!m) return { ok: false, kind: '', array: trimmed[0] === '[', reason: trimmed[0] === '[' ? '顶层是数组，但第一个元素不是 {"Id":N,"Title|Description":…,"<行数组>":[ 开头的剧情对象' : '开头不是 {"Id":N,"Title|Description":…,"<行数组>":[' }
  return { ok: true, kind: m[2] === o.sniff.adult ? 'adult' : 'normal', array: Boolean(m[1]), reason: '' }
}
export function sniff(text, options = null) { return explainSniff(text, options).ok }

// ---------- 上下文：文件索引 + 剧情文件表 + 列表数据 ----------
export const contextFiles = (options) => { const o = resolveOptions(options); return [joinPath(o.root, o.data.list), joinPath(o.root, o.data.monsters)] }
export const contextDirs = (options) => { const o = resolveOptions(options); return o.index.dirs.map((dir) => joinPath(o.root, dir)) }
export const contextTextFilter = (options) => {
  const o = resolveOptions(options)
  const prefixes = [...(o.langs.jp.normal), o.data.episodes, o.data.main].map((dir) => `${joinPath(o.root, dir)}/`)
  return (rel) => prefixes.some((prefix) => rel.startsWith(prefix))
}
export const contextWalkLimit = 800000     // 语音约 10 万个 + chara/still 几万个，比默认的 40 万多一点余量
export const contextSampleLimit = 20000    // 3395 个普通剧情的开头（标题）+ 1418 个 VieableEpisodeList + 章列表

const stripBom = (text) => String(text || '').replace(/^﻿/, '')
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const idOfName = (name) => name.replace(/\.[^./]+$/, '')

// 数组 JSON；只读了开头（被截断）时退回：截到最后一个完整元素
function arrayOf(text) {
  const source = stripBom(text)
  try {
    const value = JSON.parse(source)
    if (Array.isArray(value)) return value
    if (isObj(value)) { const first = Object.values(value).find(Array.isArray); return first || [] }
    return []
  } catch { /* 被截断 */ }
  let end = source.lastIndexOf('}')
  for (let tries = 0; end > 0 && tries < 20; tries += 1, end = source.lastIndexOf('}', end - 1)) {
    try { const value = JSON.parse(`${source.slice(0, end + 1)}]`); if (Array.isArray(value)) return value } catch { /* 再往前一个 */ }
  }
  return []
}
const jsonOrNull = (text) => { try { return JSON.parse(stripBom(text)) } catch { return null } }
const headTitle = (text) => {
  const m = /"Title"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(String(text || ''))
  if (!m) return ''
  try { return String(JSON.parse(m[1])).trim() } catch { return '' }
}

export function prepare({ options, texts, files, toResourcePath, truncated, sampleTruncated }) {
  const o = resolveOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const prefix = o.root ? `${o.root}/` : ''
  const scriptDirs = new Map()   // 目录（相对 root）→ Map(id → 相对媒体目录的路径)
  for (const table of Object.values(o.langs)) for (const dir of [...table.normal, ...table.adult]) if (!scriptDirs.has(dir)) scriptDirs.set(dir, new Map())
  const dataDirs = [o.data.episodes, o.data.main].map((dir) => `${dir}/`)
  const index = new Map()   // 相对 root 的路径 → 资源路径（模板按这个找）
  for (const rel of files || []) {
    if (prefix && !rel.startsWith(prefix)) continue
    const key = rel.slice(prefix.length)
    const slash = key.lastIndexOf('/')
    const dir = slash < 0 ? '' : key.slice(0, slash)
    const table = scriptDirs.get(dir)
    if (table) { const id = idOfName(key.slice(slash + 1)); if (id && o.idRe.test(id) && !table.has(id)) table.set(id, rel); continue }
    if (dataDirs.some((d) => key.startsWith(d))) continue
    if (!o.index.re || o.index.re.test(key)) index.set(key, toRes(rel))
  }

  // 列表数据
  const textOf = (rel) => (texts || {})[joinPath(o.root, rel)] || ''
  const list = jsonOrNull(textOf(o.data.list))
  const monsterRows = arrayOf(textOf(o.data.monsters))
  const sceneTitles = new Map()   // 普通剧情 id → 文件里的 Title
  const chapters = []             // { id, entries: [{ id, title, condition }] }
  const episodes = []             // VieableEpisodeList 的条目
  for (const [rel, text] of Object.entries(texts || {})) {
    const key = prefix && rel.startsWith(prefix) ? rel.slice(prefix.length) : rel
    const slash = key.lastIndexOf('/')
    const dir = key.slice(0, slash)
    const name = idOfName(key.slice(slash + 1))
    if (dir === o.data.main) {
      const entries = arrayOf(text).filter((e) => isObj(e) && e.MStoryId !== undefined && e.MStoryId !== null).map((e) => ({ id: String(e.MStoryId), title: typeof e.Title === 'string' ? e.Title.trim() : '', condition: typeof e.RequireCondition === 'string' ? e.RequireCondition.trim() : '' }))
      chapters.push({ id: name, entries })
    } else if (dir === o.data.episodes) {
      for (const e of arrayOf(text)) if (isObj(e)) episodes.push(e)
    } else if (o.langs.jp.normal.includes(dir)) {
      const title = headTitle(text)
      if (title) sceneTitles.set(name, title)
    }
  }
  chapters.sort((a, b) => natural(a.id, b.id))
  const chapterNames = new Map()
  for (const map of Array.isArray(list?.worldmap) ? list.worldmap : []) for (const d of Array.isArray(map?.data) ? map.data : []) if (d && d.Id !== undefined && typeof d.Name === 'string') chapterNames.set(String(d.Id), d.Name)
  const charaNames = isObj(list?.chara) ? list.chara : {}
  const monsterNames = new Map()
  for (const row of monsterRows) if (isObj(row) && row.id !== undefined && typeof row.n === 'string' && row.n) monsterNames.set(String(row.id), row.n)
  const stillView = new Map()   // 成人剧情 id → { x, y, z }（list.json data[<id>]["1"]）
  if (isObj(list?.data)) {
    for (const [id, value] of Object.entries(list.data)) {
      const v = value?.['1']
      if (isObj(v)) stillView.set(id, { x: Number(v.X) || 0, y: Number(v.Y) || 0, z: Number(v.Z) > 0 ? Number(v.Z) : 1 })
    }
  }
  const ctx = { options, hasIndex: Boolean(files?.length), truncated: Boolean(truncated), sampleTruncated: Boolean(sampleTruncated), index, scriptDirs, stillView, chapterNames, sceneTitles, hasList: Boolean(list), counts: { chapters: chapters.length, episodes: episodes.length } }
  ctx.catalogTree = buildCatalog({ o, ctx, chapters, episodes, chapterNames, charaNames, monsterNames })
  return ctx
}

// 一个 id 的脚本文件（语言目录依次试，最后退回 jp）：返回相对媒体目录的路径，没有 ''
function scriptOf(ctx, o, kind, id) {
  for (const dir of [...(o.langs[o.lang]?.[kind] || []), ...o.langs.jp[kind]]) {
    const hit = ctx.scriptDirs.get(dir)?.get(id)
    if (hit) return hit
  }
  return ''
}
const idsOf = (ctx, o, kind) => {
  const ids = new Set()
  for (const dir of new Set([...o.langs.jp[kind], ...(o.langs[o.lang]?.[kind] || [])])) for (const id of ctx.scriptDirs.get(dir)?.keys() || []) ids.add(id)
  return [...ids].sort(natural)
}

// ---------- 列表（catalog）----------
function buildCatalog({ o, ctx, chapters, episodes, chapterNames, charaNames, monsterNames }) {
  const found = (kind, id) => scriptOf(ctx, o, kind, id)
  const normalIds = idsOf(ctx, o, 'normal')
  const adultIds = idsOf(ctx, o, 'adult')
  const episodeTitle = { normal: new Map(), adult: new Map() }
  for (const e of episodes) {
    const title = typeof e.Title === 'string' ? e.Title.trim() : ''
    if (!title) continue
    if (e.MSceneId !== undefined && e.MSceneId !== null && !episodeTitle.normal.has(String(e.MSceneId))) episodeTitle.normal.set(String(e.MSceneId), title)
    if (e.MAdultId !== undefined && e.MAdultId !== null && !episodeTitle.adult.has(String(e.MAdultId))) episodeTitle.adult.set(String(e.MAdultId), title)
  }
  const normalTitle = (id) => ctx.sceneTitles.get(id) || episodeTitle.normal.get(id) || id
  const adultTitle = (id) => episodeTitle.adult.get(id) || id
  const top = []

  // 主线
  const mainChildren = []
  for (const chapter of chapters) {
    const children = []
    for (const entry of chapter.entries) {
      const script = found('normal', entry.id)
      if (script) children.push({ id: `main/${chapter.id}/${entry.id}`, title: entry.title || normalTitle(entry.id), subtitle: entry.condition || `#${entry.id}`, script })
    }
    if (children.length) mainChildren.push({ id: `main/${chapter.id}`, title: chapterNames.get(chapter.id) || chapter.id, subtitle: `${children.length} 话 · ${chapter.id}`, children })
  }
  if (mainChildren.length) top.push({ id: 'main', title: '主线', subtitle: `${mainChildren.length} 章`, children: mainChildren })

  // 角色：VieableEpisodeList 按 MMonsterId 分组
  const byMonster = new Map()
  for (const e of episodes) {
    if (e.MMonsterId === undefined || e.MMonsterId === null) continue
    const key = String(e.MMonsterId)
    if (!byMonster.has(key)) byMonster.set(key, [])
    byMonster.get(key).push(e)
  }
  const charaChildren = []
  for (const monster of [...byMonster.keys()].sort(natural)) {
    const seen = new Set()
    const children = []
    for (const e of byMonster.get(monster).slice().sort((a, b) => natural(String(a.Id ?? ''), String(b.Id ?? '')))) {
      const title = typeof e.Title === 'string' ? e.Title.trim() : ''
      for (const [kind, field, badge] of [['normal', 'MSceneId', ''], ['adult', 'MAdultId', 'R18']]) {
        if (e[field] === undefined || e[field] === null) continue
        const id = String(e[field])
        const script = found(kind, id)
        if (!script || seen.has(script)) continue
        seen.add(script)
        children.push({ id: `c/${monster}/${kind === 'adult' ? 'a' : 'n'}${id}`, title: title || (kind === 'adult' ? adultTitle(id) : normalTitle(id)), subtitle: `#${id}`, badge, script })
      }
    }
    if (!children.length) continue
    const name = monsterNames.get(monster) || charaNames[monster]?.name?.[0] || charaNames[String(Math.floor(Number(monster) / 10))]?.name?.[0] || `#${monster}`
    const icon = o.paths.icon.flatMap((template) => expandTemplate(template, { monster, ext: o.exts.image })).find((key) => ctx.index.has(key)) || ''
    charaChildren.push({ id: `c/${monster}`, title: name, subtitle: `${children.length} 个剧情 · ${monster}`, ...(icon ? { thumb: ctx.index.get(icon) } : {}), children })
  }
  if (charaChildren.length) top.push({ id: 'chars', title: '角色', subtitle: `${charaChildren.length} 个角色`, children: charaChildren })

  // 全部普通 / 成人剧情
  const normalLeaves = normalIds.map((id) => ({ id: `all/${id}`, title: normalTitle(id), subtitle: `#${id}`, script: found('normal', id) })).filter((leaf) => leaf.script)
  if (normalLeaves.length) top.push({ id: 'all', title: '全部普通剧情', subtitle: `${normalLeaves.length} 项`, children: normalLeaves })
  const adultLeaves = adultIds.map((id) => ({ id: `adult/${id}`, title: adultTitle(id), subtitle: `#${id}`, badge: 'R18', script: found('adult', id) })).filter((leaf) => leaf.script)
  if (adultLeaves.length) top.push({ id: 'adult', title: '全部成人剧情', subtitle: `${adultLeaves.length} 项`, children: adultLeaves })
  return top.length ? { children: top } : null
}
export const catalog = (ctx) => ctx?.catalogTree || null

// 体检（列表页的渲染诊断）
export function health(ctx) {
  const out = []
  if (!ctx?.hasIndex || !ctx.index.size) out.push({ level: 'warn', code: 'otogi-index-empty', message: '没读到资源文件（检查 adapterOptions[\'otogi-json\'].root 和 index.dirs）：背景 / 立绘 / 语音都会找不到' })
  if (ctx && !ctx.hasList) out.push({ level: 'warn', code: 'otogi-list-missing', message: '没读到 list.json（章名、成人剧情的画面位置 / 缩放要用它）' })
  if (ctx?.hasIndex && ![...(ctx.scriptDirs.values())].some((table) => table.size)) out.push({ level: 'warn', code: 'otogi-scripts-missing', message: '没找到剧情文件（typeadv/MScenes/<id>、json/<id>）：检查 root 和 langs' })
  if (ctx?.truncated) out.push({ level: 'warn', code: 'otogi-index-truncated', message: '文件索引超过上限被截断（部分剧情 / 资源会找不到）：调大 config.limits.walkFiles' })
  if (ctx?.sampleTruncated) out.push({ level: 'warn', code: 'otogi-sample-truncated', message: '剧情抽样超过上限（部分标题会显示成 id）：调大 config.limits.sampleFiles（最多 20000）' })
  return out
}

// ---------- 解析 ----------
const present = (value) => value !== undefined && value !== null && String(value) !== ''

export function parse(text, ctx = null, meta = {}) {
  const o = resolveOptions(meta?.options ?? ctx?.options)
  let doc
  try { doc = JSON.parse(stripBom(text)) } catch (error) { throw new Error(`不是合法的 JSON（Otogi 剧情）：${String(error?.message || error).slice(0, 120)}`) }
  const scenes = (Array.isArray(doc) ? (o.arrayScenes === 'all' ? doc : doc.slice(0, 1)) : [doc]).filter(isObj)
  if (!scenes.length || !scenes.some((s) => Array.isArray(s[o.sniff.normal]) || Array.isArray(s[o.sniff.adult]) || Array.isArray(s.MRichSceneDetails))) throw new Error(`不是 Otogi 的剧情（没有 ${o.sniff.normal} / ${o.sniff.adult}）`)

  const stats = { scenes: scenes.length, rows: 0, commands: 0, raw: {}, unresolved: {}, missing: {}, ignored: {}, stands: 0, voices: { total: 0, found: 0, missing: 0 }, ...(ctx?.truncated ? { indexTruncated: true } : {}), ...(Array.isArray(doc) ? { arrayTop: doc.length } : {}) }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const indexed = Boolean(ctx?.hasIndex && ctx.index?.size)
  const lookup = indexed ? lookupFor(ctx, ctx.index, meta?.config?.resourceResolve) : null
  // 名字 → 资源路径：有索引就查索引（找不到 ''），没有索引就按模板猜
  const memo = new Map()
  const resolve = (kind, vars, extKind) => {
    const memoKey = `${kind}|${extKind}|${JSON.stringify(vars)}`
    if (memo.has(memoKey)) return memo.get(memoKey)
    const full = { ...vars, ext: o.exts[extKind] }
    let src
    if (!indexed) src = guessTemplate(o.paths[kind], full)
    else { const key = lookup.find(o.paths[kind], full, 'first'); src = key ? ctx.index.get(key) || '' : '' }
    memo.set(memoKey, src)
    return src
  }
  const replaceUser = (value) => String(value).replace(/%user_name/g, o.protagonist)
  const clean = (value) => { const t = replaceUser(value); return o.text.re ? t.replace(o.text.re, '\n') : t }
  const effectCommands = (key) => {
    const table = o.effects[String(key)]
    if (table) return table.map((c) => structuredClone(c))
    count('raw', `Effect:${key}`)
    return [{ op: 'raw', cmd: 'Effect', args: [String(key)] }]
  }
  const steps = []
  let pending = []
  const push = (commands) => { stats.commands += commands.length; steps.push({ index: steps.length, commands }) }
  let curBgm = ''
  let curBg = ''
  let speaker = null
  const fallbackId = String(meta?.stem ?? '')

  const bgm = (value, emit) => {
    if (!present(value) || String(value) === curBgm) return
    const src = resolve('bgm', { name: String(value) }, 'audio')
    if (src) { emit({ op: 'bgm', src }); curBgm = String(value) } else count('unresolved', `bgm:${value}`)
  }
  // 声音（se / voice）：找得到才发指令；找不到不发（不会请求 404），只记 stats.missing.<what>；语音另外汇总进 stats.voices
  const audio = (kind, vars, name, emit, what) => {
    const src = resolve(kind, { ...vars, name: String(name) }, 'audio')
    if (what === 'voice') { stats.voices.total += 1; stats.voices[src ? 'found' : 'missing'] += 1 }
    if (src) emit({ op: what, src }); else count('missing', what)
  }

  // ---------------- 普通剧情 ----------------
  const playNormal = (scene) => {
    const rows = scene[o.sniff.normal].filter(isObj)
    const sceneId = String(scene.Id ?? fallbackId)
    const slots = new Map()      // Position → { monster, emotion, kind }
    const hidden = new Set()
    let active = null
    let standSig = ''
    const missedStand = new Set()
    const missedFace = new Set()
    const faceOf = (row, slot, monster) => {
      const named = present(row.EmotionId) ? o.emotions[String(row.EmotionId)] : ''
      if (named) return named
      return slot && slot.monster === monster ? slot.emotion : ''   // 没有 / 不认识的表情：沿用同一个角色的上一个
    }
    const standParts = () => {
      const order = [...slots.keys()].filter((p) => !hidden.has(p)).sort((a, b) => (a === active) - (b === active) || a - b)   // 说话的一边最后画（在上面）
      const parts = []
      for (const position of order) {
        const slot = slots.get(position)
        const body = resolve('stand', { monster: slot.monster, name: o.stand.body }, 'image')
        if (!body) { if (!missedStand.has(slot.monster)) { missedStand.add(slot.monster); count('unresolved', `stand:${slot.monster}`) } continue }
        const common = { align: slot.kind, ...(o.stand.fit ? { fit: o.stand.fit } : {}), ...(o.stand.dim && order.length > 1 && position !== active ? { dim: o.stand.dim } : {}) }
        parts.push({ src: body, ...common })
        if (slot.emotion) {
          for (const layer of o.stand.layers) {
            const name = layer.replace(/\{emotion\}/g, slot.emotion)
            const src = resolve('stand', { monster: slot.monster, name }, 'image')
            if (src) parts.push({ src, ...common })
            else if (!missedFace.has(`${slot.monster}/${name}`)) { missedFace.add(`${slot.monster}/${name}`); count('missing', `face:${slot.monster}/${name}`) }   // 每个缺的文件只记一次
          }
        }
      }
      return parts
    }

    for (const row of rows) {
      stats.rows += 1
      const emit = (command) => pending.push(command)
      // 背景 / 音乐 / 音效 / 语音 / 特效
      if (present(row.BackgroundImage) && String(row.BackgroundImage) !== curBg) {
        const src = resolve('bg', { name: String(row.BackgroundImage) }, 'image')
        if (src) { emit({ op: 'bg', src, fade: 0 }); curBg = String(row.BackgroundImage) } else count('unresolved', `bg:${row.BackgroundImage}`)
      }
      bgm(row.BGM, emit)
      const mscene = String(row.MSceneId ?? sceneId)
      if (present(row.SE)) audio('se', { scene: mscene }, row.SE, emit, 'se')
      if (present(row.VoiceFileName)) audio('voice', { scene: mscene }, row.VoiceFileName, emit, 'voice')
      if (present(row.Effect)) for (const command of effectCommands(row.Effect)) emit(command)
      if (present(row.HintImageName)) count('ignored', 'HintImageName')

      // 立绘
      const phrase = row.Phrase === undefined || row.Phrase === null ? '' : String(row.Phrase)
      const position = Number(row.Position)
      const kind = o.positions[String(position)] || 'narration'
      if (present(row.MMonsterId) && kind !== 'narration') {
        const monster = String(row.MMonsterId)
        slots.set(position, { monster, emotion: faceOf(row, slots.get(position), monster), kind })
        hidden.delete(position)
        if (o.stand.duplicate === 'hideOther') for (const [p, slot] of slots) if (p !== position && slot.monster === monster) hidden.add(p)
        active = position
      }
      if (row.IsBackgroundOnly === true) for (const p of slots.keys()) hidden.add(p)
      const parts = standParts()
      const sig = JSON.stringify(parts)
      if (sig !== standSig) {
        if (parts.length) { emit({ op: 'stand', parts }); stats.stands += 1 } else if (standSig && standSig !== '[]') emit({ op: 'standOff' })
        standSig = sig
      }

      if (phrase === '') continue   // 只换画面 / 声音的行：并进下一句
      const who = kind === 'narration' ? '' : String(row.Name ?? '')
      if (who !== speaker) { emit({ op: 'speaker', segments: who ? [{ text: who }] : [] }); speaker = who }
      const size = o.text.sizeMap[String(row.PhraseFontSize)]
      emit({ op: 'text', segments: [{ text: clean(phrase), ...(size ? { style: { size } } : {}) }] })
      push(pending)
      pending = []
    }
  }

  // ---------------- 成人剧情 ----------------
  const playAdult = (scene) => {
    const rows = scene[o.sniff.adult].filter(isObj)
    const id = String(scene.Id ?? fallbackId)
    const view = ctx?.stillView?.get(id)
    let spineOn = false
    let ani = '1'
    let spRaw = 1       // 原页面的 sp 变量：Motion 和它不一样才改速度
    let timeScale = 1
    let last = ''
    let skeleton = null
    let tried = false
    const toScale = (motion) => (motion <= 0 ? o.motion.zero : motion > o.motion.fastAbove ? motion * o.motion.fastFactor : motion)
    for (const row of rows) {
      stats.rows += 1
      const commands = []
      const emit = (command) => commands.push(command)
      const anim = present(row.CharaAnimation) ? String(row.CharaAnimation) : ''
      if (present(row.Effect)) for (const command of effectCommands(row.Effect)) emit(command)
      if (anim && o.anim[anim]?.effect) for (const command of effectCommands(o.anim[anim].effect)) emit(command)
      bgm(row.BGM, emit)
      if (present(row.Voice)) audio('adultVoice', { scene: id }, row.Voice, emit, 'voice')
      if (present(row.SE)) { count('raw', 'SE'); emit({ op: 'raw', cmd: 'SE', args: [String(row.SE)] }) }
      if (present(row.StillPath)) count('ignored', 'StillPath')

      // 画面：Order 1（或第一行）建，CharaAnimation / Motion 变了再更新
      if (anim !== '3' && row.Motion !== undefined && row.Motion !== null && Number.isFinite(Number(row.Motion)) && Number(row.Motion) !== spRaw) { spRaw = Number(row.Motion); timeScale = toScale(spRaw) }
      const create = !spineOn || String(row.Order) === '1'
      if (!tried) {
        tried = true
        const skel = resolve('skel', { scene: id }, 'image')
        const atlas = skel ? resolve('atlas', { scene: id }, 'image') : ''
        if (skel && atlas) skeleton = { skel, atlas }
        else count('unresolved', `still:${id}`)
      }
      if (skeleton) {
        if (create) { ani = '1'; last = ''; timeScale = toScale(spRaw) }
        if (anim && !o.anim[anim]) { count('raw', `CharaAnimation:${anim}`); emit({ op: 'raw', cmd: 'CharaAnimation', args: [anim] }) }   // 表里没有的值：不猜，记 raw
        else if (anim && anim !== ani) { ani = anim; if (o.anim[anim].speed) timeScale = o.anim[anim].speed }
        const entry = o.anim[ani] || o.anim['1']
        const sig = `${entry?.anim}|${entry?.loop}|${timeScale}`
        if (sig !== last) {
          emit({ op: 'spine', slot: 'still1', kind: 'still', skel: skeleton.skel, atlas: skeleton.atlas, anim: entry?.anim || 'animation1', loop: entry ? entry.loop : true, speed: timeScale, order: 1, ...(view ? { x: view.x, y: view.y, scale: view.z } : {}) })
          last = sig
          spineOn = true
        }
      }
      if (present(row.Name) || row.Name === '') {
        const who = String(row.Name ?? '')
        if (who !== speaker) { emit({ op: 'speaker', segments: who ? [{ text: who }] : [] }); speaker = who }
      }
      if (row.Serif !== undefined && row.Serif !== null) emit({ op: 'text', segments: [{ text: clean(row.Serif) }] })
      if (commands.length) push(commands)
    }
  }

  for (const scene of scenes) {
    if (Array.isArray(scene[o.sniff.adult])) playAdult(scene)
    else if (Array.isArray(scene[o.sniff.normal]) && (scene[o.sniff.normal].length || !Array.isArray(scene.MRichSceneDetails))) playNormal(scene)
    else if (Array.isArray(scene.MRichSceneDetails)) { count('raw', 'MRichSceneDetails'); pending.push({ op: 'raw', cmd: 'MRichSceneDetails', args: [String(scene.MRichSceneDetails.length)] }) }
  }
  if (pending.length) {
    if (steps.length) { steps[steps.length - 1].commands.push(...pending); stats.commands += pending.length } else push([...pending, { op: 'text', segments: [] }])
  }
  if (!steps.length) push([{ op: 'text', segments: [] }])
  return { steps, stats }
}

export const otogiJsonAdapter = { id: ADAPTER_ID, label: 'Otogi Frontier R 剧情 JSON', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare, catalog, health }
