// 适配器：MistTrainGirls X（Unity 剧情查看器）的剧情 JSON → 规范场景（gal-scene/1）。语义照反编译出来的查看器 Assembly-CSharp.dll
// （DIALOGUE_LINE.FromRowArray / ConversationManager / DialogueSystem / ProcessBgEventAnimation；见 private-scripts 里的 mmm.zip）。
// 输入形态：位置数组 [null, [<场景 id>, [行…], …]]（UScenes/<id>/<id>.json 或 UScenes/Stills/<角色底号>/<id>.json），一行的字段位置：
//   0 GroupOrder  1 ViewOrder  2 说话人  3 台词（\n 换行；<ruby=读音>字</ruby> / <emoji=heart01> 标签）  4 字号  5 语速  6 居中  7 说话角色 id  8 说话标志
//   9 frameImage（样本里恒为 0，不处理）  10 语音  11 背景  12 BGM  13 音效  14 soundTag（样本里恒空）  15 effect  16 背景效果类型（样本里恒 0）
//   17 立绘数组（样本里恒空，不处理）  18 stillDetail = [动画名, 动画速度, 镜头缩放, 镜头 x, 镜头 y, 镜头时长, 镜头旋转]
// 播放规则（照查看器）：
//   · 只有带台词的行才停下来等点击；没台词的行（只放指令）并进下一句的这一步，结尾剩下的并进最后一步。
//   · effect '1' = 白屏淡入（wash white）；'3' = 白色闪烁（flash white）；其它取值不处理，记在 stats.raw。时长查看器里没读到常量，按 1 秒 / 0.3 秒×2 估的。
//   · 静态画面 = Spines/**/<场景 id>/ 目录：still_configuration.json 的 Parts[].Path 决定叠哪几层（<Path>.skel.bytes / .atlas.txt / .png，按顺序叠），
//     IsMosaic 的层默认不叠（adapterOptions.showMosaic 打开才叠）；没有 still_configuration.json 就按文件名数字顺序叠全部。默认放 animation1，stillDetail 里写了动画名就切。
//   · 一次性动画（ShouldPlayOneShotWithFade）：总层数 8 的 animation3/7、7 的 animation3/6、4 或 5 的 animation3 → 不循环 + 降速（spine 指令带 slow:true）。
//   · 联动背景音效（PlaySpineLinkedBgSE，按总层数 N + 动画名 + 速度选 Hse1~4，没有匹配就停掉）：
//       N=8  animation3/7 → Hse4；animation2/6 → 速度 2 用 Hse3，否则 Hse2
//       N=7  animation3/6 → Hse4；animation2/5 → 同上
//       N=5  animation5 → Hse1；animation3 → Hse4；animation2 → 同上
//       N=4  animation3 → Hse4；animation2 → 同上
//     Hse4 不循环，其余循环（循环标志查看器里是局部变量，没读全，这是推的）。文件 Sounds/BgSe/<名>.ogg。
//   · 镜头：缩放 = 值 + 0.03（|值| > 0.0001 才改），位置 = (-x, -y) × 0.015 世界单位，旋转直接设；时长 > 0 是线性插值（单位按秒）。
//     换算成播放器的 camera 单位：位置 ×0.84（0.015 世界单位按 100 像素/单位、播放器 1 单位 = 屏高的 1.65‰ 折的，没法在真机上对，可能有偏差），
//     第 4 项 = 旋转度数（播放器 CSS 转，逆时针为正取反）。
//   · 声音：BGM Sounds/Bgms/Adv/<名>.ogg · 音效 Sounds/Se/<名>.ogg · 语音在 Sounds/Voices 下按文件名找（查看器拼 Sounds/Voices/Scenarios/Stills/<底号>/<数字>/<名>.ogg，
//     目录层级里的数字不是行里能直接看出来的，所以靠索引按文件名找；索引超过 6 万个文件会漏）。
// 列表（adapter.catalog）：角色（Stills/<底号>/ 下的剧情，名字查 MasterData/MCharacterBaseViewModel.json、剧情标题查 MSceneViewModel.json，场景 id = 文件名去掉末 2 位）/
// 其它剧情（UScenes/<id>/）/ 全部剧情。列表每次从文件现读。
//
// ---------- 参数（config.adapterOptions['misttrain-json']；全部可选，没写 = DEFAULT_OPTIONS = 以前的行为）----------
// 适配器只读参数、按参数匹配；猜出来的数字 / 规则都在 DEFAULT_OPTIONS 里，数组整体替换、对象逐项合并：
//   root（游戏数据目录，相对媒体目录）  showMosaic（IsMosaic 的层叠不叠；播放器「更多」里的开关优先）
//   dirs            { spines, backgrounds, sounds, masterData } 索引的目录名      master { scenes, characters, idKey, titleKey, nameKey } 名称表文件 / 键
//   scenes          { dirs: [剧情脚本目录…], stillsDir: 角色底号目录名, collision: 'last'（同名剧情后收到的赢，以前的行为）| 'first' }
//   fieldMap        row { 行内各字段的位置 }、detail { stillDetail 内各项的位置 }
//   backgrounds     { ext: [背景图扩展名…] }（行里写的名字带这些扩展名会先去掉）
//   paths           { bgm, se, bgse, background, voiceFallback } 路径模板（{name}）；没有索引时 / 索引里没有时按它拼
//   voice           { dir 语音目录, ext 扩展名（按顺序试）, preferDirs 同名语音挑哪个目录（resolveByName），duplicates: 'first' 取第一个 | 'skip' 同名不止一个就不播（记未解析） }
//   titleLookup     { trim: 场景 id = 文件名去掉末几位（0 = 不试）, tryAsIs, tryMinusOne }
//   still           { defaultAnimation, configFile }
//   camera          { positionScale: 位置换算（猜的）, zoomAdd: 缩放加数, zoomEpsilon, zoomUnit, maxSeconds }
//   effects         { fadeSeconds, flashSeconds, flashCount（这三个是查看器里没读到的估值）, map { effect 取值: 'wash' | 'flash' }（其它取值 / 空串记 stats.raw）,
//                     oneShotRule { 总层数: [动画名…] } 一次性动画（不循环 + 降速）, linkedBgSe { 总层数: { 动画名: [普通速度的音效, 速度 = fastSpeed 时的音效] } }（要关掉某一项写 ['', '']）, fastSpeed, loopExcept [不循环的背景音效] }
//   emoji           { <emoji=名字> → 符号 }
import { createIndexResolver } from '../resolve.mjs'
import { cleanDir, createOptionsReader, escapeRegex, fillTemplate, safeRegex } from './options-merge.mjs'

export const ADAPTER_ID = 'misttrain-json'
export const DEFAULT_OPTIONS = {
  root: '',
  showMosaic: false,
  dirs: { spines: 'Spines', backgrounds: 'BackGrounds', sounds: 'Sounds', masterData: 'MasterData' },
  master: { scenes: 'MSceneViewModel.json', characters: 'MCharacterBaseViewModel.json', idKey: 'Id', titleKey: 'Title', nameKey: 'Name' },
  scenes: { dirs: ['UScenes'], stillsDir: 'Stills', collision: 'last' },
  fieldMap: {
    row: { speaker: 2, text: 3, frameImage: 9, voice: 10, background: 11, bgm: 12, se: 13, soundTag: 14, effect: 15, backgroundEffectType: 16, stand: 17, detail: 18 },
    detail: { animation: 0, speed: 1, zoom: 2, x: 3, y: 4, seconds: 5, rotation: 6 },
  },
  paths: { bgm: 'Sounds/Bgms/Adv/{name}.ogg', se: 'Sounds/Se/{name}.ogg', bgse: 'Sounds/BgSe/{name}.ogg', background: 'BackGrounds/{name}.png', voiceFallback: 'Sounds/Voices/Scenarios/Stills/{name}.ogg' },
  backgrounds: { ext: ['png', 'jpg'] },
  voice: { dir: 'Sounds/Voices', ext: ['ogg'], preferDirs: [], duplicates: 'first' },
  titleLookup: { trim: 2, tryAsIs: true, tryMinusOne: true },
  still: { defaultAnimation: 'animation1', configFile: 'still_configuration.json' },
  camera: { positionScale: 0.84, zoomAdd: 0.03, zoomEpsilon: 1e-4, zoomUnit: 1.3, maxSeconds: 60 },
  effects: {
    fadeSeconds: 1, flashSeconds: 0.3, flashCount: 2,
    map: { 1: 'wash', 3: 'flash' },
    oneShotRule: { 8: ['animation3', 'animation7'], 7: ['animation3', 'animation6'], 5: ['animation3'], 4: ['animation3'] },
    linkedBgSe: {
      8: { animation3: ['Hse4', 'Hse4'], animation7: ['Hse4', 'Hse4'], animation2: ['Hse2', 'Hse3'], animation6: ['Hse2', 'Hse3'] },
      7: { animation3: ['Hse4', 'Hse4'], animation6: ['Hse4', 'Hse4'], animation2: ['Hse2', 'Hse3'], animation5: ['Hse2', 'Hse3'] },
      5: { animation5: ['Hse1', 'Hse1'], animation3: ['Hse4', 'Hse4'], animation2: ['Hse2', 'Hse3'] },
      4: { animation3: ['Hse4', 'Hse4'], animation2: ['Hse2', 'Hse3'] },
    },
    fastSpeed: 2,
    loopExcept: ['Hse4'],
  },
  emoji: { heart01: '♥', heart02: '♥', heart03: '♥', heart04: '♥', smile: '☺', star: '★' },
}
const optionsOf = createOptionsReader(DEFAULT_OPTIONS)
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => cleanDir(optionsOf(options).root)

// 1 = 数组形：[null, [<id>, [[…行], …], …]]
const HEAD = /^\s*\[\s*null\s*,\s*\[\s*"?\d{5,}"?\s*,\s*\[/
// 2 = 对象形：{"r":{"MSceneId":…,"MSceneDetailViewModel":[{"GroupOrder":…,"Name":…,"Phrase":…}, …]}}（Stills 里有的剧情是这种）
const OBJECT_HEAD = /^\s*\{\s*"r"\s*:\s*\{\s*"MSceneId"\s*:\s*"?\d{5,}"?\s*,\s*"MSceneDetailViewModel"\s*:\s*\[/
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 2048)
  return HEAD.test(head) || OBJECT_HEAD.test(head)
}

// 对象形的一行 → 位置数组（和数组形同一套字段位置）。键名只有 GroupOrder / ViewOrder / Name / Phrase 有样本，其余按常见写法不分大小写猜；
// 没认出的键记进 stats.raw（field:<键名>），在「渲染诊断」里能看到，照着补
const ROW_KEYS = [
  ['GroupOrder'], ['ViewOrder'], ['Name'], ['Phrase'], ['PhraseFontSize', 'FontSize'], ['PhraseSpeed', 'Speed'], ['IsPhraseCenter', 'IsCenter'], ['SpeechMCharacterId', 'MCharacterId'], ['IsSpeakingFlags', 'SpeakFlag'],
  ['FrameImage', 'FrameImageName'], ['VoiceFileName', 'Voice', 'VoiceName'], ['BackgroundImage', 'BackGround', 'Background', 'BackgroundName'], ['BGM', 'Bgm', 'BgmName'],
  ['SE', 'Se', 'SeName'], ['SoundTag'], ['Effect'], ['BackgroundEffectType'], ['StandCharacters'], ['StillDetail'],
]
function objectRowToArray(row, unknown) {
  const lower = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]))
  const used = new Set()
  const out = ROW_KEYS.map((names) => {
    for (const name of names) { const key = lower.get(name.toLowerCase()); if (key !== undefined) { used.add(key); return row[key] } }
    return null
  })
  for (const key of Object.keys(row)) if (!used.has(key)) unknown.add(key)
  // stillDetail 写成对象的话按常见键名转成 [动画名, 速度, 缩放, x, y, 时长, 旋转]
  const detail = out[18]
  if (detail && !Array.isArray(detail) && typeof detail === 'object') {
    // 键名（样本确认）：AnimationName / AnimationSpeed / CameraPositionX / CameraPositionY / CameraRotation / CameraWorkDuration / CameraZoomRatio；后面的正则只是兜底
    const entries = Object.entries(detail)
    const pick = (...patterns) => { for (const re of patterns) { const hit = entries.find(([key]) => re.test(key)); if (hit) return hit[1] } return null }
    out[18] = [pick(/^AnimationName$/i, /anim.*name/i), pick(/^AnimationSpeed$/i, /anim.*speed/i), pick(/^CameraZoomRatio$/i, /zoom|scale/i), pick(/^CameraPositionX$/i, /position.*x/i), pick(/^CameraPositionY$/i, /position.*y/i), pick(/^CameraWorkDuration$/i, /duration|second/i), pick(/^CameraRotation$/i, /rotat|angle/i)]
  }
  return out
}

// ---------- 上下文：资源目录索引 + 名称表 ----------
export const contextFiles = (options) => {
  const opt = optionsOf(options)
  return [opt.master.scenes, opt.master.characters].map((name) => joinPath(rootOf(options), cleanDir(opt.dirs.masterData), name))
}
export const contextDirs = (options) => {
  const opt = optionsOf(options)
  return [...opt.scenes.dirs, opt.dirs.spines, opt.dirs.backgrounds, opt.dirs.sounds].map((dir) => joinPath(rootOf(options), cleanDir(dir)))
}
export const contextTextFilter = (options) => {
  const re = safeRegex(`/${escapeRegex(optionsOf(options).still.configFile)}$`)
  return (rel) => Boolean(re?.test(rel))
}

const numericPrefix = (name) => { const m = /^(\d+)/.exec(name); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER }
const natAsc = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
const jsonArray = (text) => { try { const v = JSON.parse(String(text || '').replace(/^﻿/, '')); return Array.isArray(v) ? v : [] } catch { return [] } }

export function prepare({ options, texts, files, toResourcePath, resourceResolve }) {
  const opt = optionsOf(options)
  const toRes = toResourcePath || ((rel) => rel)
  const scenes = new Map()    // 剧情 id → { rel, base }（base = Stills 下的角色底号，其它 ''）
  const folders = new Map()   // 场景 id → { dir, count, bases: [<基名>…按数字排序] }（含 *.skel.bytes 的目录，目录名 = 场景 id）
  const backgrounds = new Map()
  const voiceIndex = new Set()   // 语音路径（相对资源根）；按文件名找见 voiceOf
  const voiceCount = new Map()   // 语音文件名 → 个数（voice.duplicates = 'skip' 用）
  const sceneRes = opt.scenes.dirs.map((dir) => safeRegex(`^${escapeRegex(cleanDir(dir))}/(?:${escapeRegex(cleanDir(opt.scenes.stillsDir))}/([^/]+)/)?(?:[^/]+/)?([^/]+)\\.json$`)).filter(Boolean)
  const spineRe = safeRegex(`^${escapeRegex(cleanDir(opt.dirs.spines))}/(.+)/([^/]+)/([^/]+)\\.skel\\.bytes$`)
  const exts = (list) => (Array.isArray(list) ? list : []).map((e) => escapeRegex(String(e).replace(/^\./, ''))).filter(Boolean).join('|') || '(?!)'
  const bgRe = safeRegex(`^${escapeRegex(cleanDir(opt.dirs.backgrounds))}/(.+)\\.(?:${exts(opt.backgrounds.ext)})$`)
  const voiceRe = safeRegex(`^${escapeRegex(cleanDir(opt.voice.dir))}/(.+/)?([^/]+)\\.(?:${exts(opt.voice.ext)})$`)
  for (const rel of files || []) {
    const res = toRes(rel)
    let m = null
    for (const re of sceneRes) { m = re.exec(res); if (m) break }
    if (m) { if (!(opt.scenes.collision === 'first' && scenes.has(m[2]))) scenes.set(m[2], { rel, base: m[1] || '' }); continue }
    m = spineRe?.exec(res)
    if (m) {
      const key = m[2]
      const dir = `${cleanDir(opt.dirs.spines)}/${m[1]}/${m[2]}`
      if (!folders.has(key)) folders.set(key, { dir, bases: [] })
      folders.get(key).bases.push(m[3])
      continue
    }
    m = bgRe?.exec(res)
    if (m) { backgrounds.set(m[1].toLowerCase(), res); continue }
    m = voiceRe?.exec(res)
    if (m) { voiceIndex.add(res); voiceCount.set(m[2], (voiceCount.get(m[2]) || 0) + 1) }
  }
  for (const folder of folders.values()) { folder.bases.sort((a, b) => numericPrefix(a) - numericPrefix(b) || a.localeCompare(b)); folder.count = folder.bases.length }
  const textOf = (name) => Object.entries(texts || {}).find(([key]) => key.endsWith(`/${name}`) || key === name)?.[1] || ''
  const stillConfigs = new Map()
  const configRe = safeRegex(`(?:^|/)([^/]+)/${escapeRegex(opt.still.configFile)}$`)
  for (const [key, value] of Object.entries(texts || {})) {
    const m = configRe?.exec(toRes(key))
    if (m) stillConfigs.set(m[1], value)
  }
  const master = readMasterdata(textOf(opt.master.scenes), textOf(opt.master.characters), opt.master)
  // 语音只知道文件名：按 voice.preferDirs 的顺序在索引里挑（不再是「文件顺序里第一个」），voice.ext 依次试
  const resolver = createIndexResolver({ index: voiceIndex, cfg: resourceResolve, preferDirs: opt.voice.preferDirs.length ? opt.voice.preferDirs : null })
  const voiceOf = (name) => {
    if (opt.voice.duplicates === 'skip' && (voiceCount.get(name) || 0) > 1) return ''
    for (const ext of opt.voice.ext) {
      const file = `${name}.${String(ext).replace(/^\./, '')}`
      const hit = resolver.resolveByName(file)
      if (hit) return hit
    }
    return ''
  }
  const ctx = { opts: opt, scenes, folders, backgrounds, voiceOf, stillConfigs, master, hasIndex: Boolean(files?.length), showMosaic: Boolean(opt.showMosaic) }
  ctx.catalogTree = buildCatalog(ctx)
  return ctx
}

function readMasterdata(sceneText, baseText, keys) {
  const titles = new Map()
  for (const row of jsonArray(sceneText)) if (row && row[keys.idKey] !== undefined) titles.set(String(row[keys.idKey]), str(row[keys.titleKey]))
  const bases = new Map()
  for (const row of jsonArray(baseText)) if (row && row[keys.idKey] !== undefined) bases.set(String(row[keys.idKey]), str(row[keys.nameKey]))
  return { titles, bases }
}

// 剧情文件名 → 标题（titleLookup）：场景 id = 文件名去掉末 2 位；找不到再试原样、末位减 1（技能场景 55000405 对应 55000404）
function titleOf(master, stem, lookup = DEFAULT_OPTIONS.titleLookup) {
  const tries = []
  if (lookup.trim > 0) tries.push(stem.slice(0, -lookup.trim))
  if (lookup.tryAsIs) tries.push(stem)
  if (lookup.tryMinusOne) tries.push(String(Number(stem) - 1))
  for (const key of tries) { const title = master.titles.get(key); if (title) return title }
  return ''
}

function buildCatalog(ctx) {
  const { scenes, master } = ctx
  if (!scenes.size) return null
  const node = (id, stem, entry, prefix) => {
    const title = titleOf(master, stem, ctx.opts.titleLookup)
    return { id: `${prefix}/${id}`, title: title || stem, subtitle: title ? stem : '', script: entry.rel }
  }
  const lists = []
  const byBase = new Map()
  const others = []
  for (const [stem, entry] of [...scenes].sort((a, b) => natAsc(a[0], b[0]))) {
    if (entry.base) { if (!byBase.has(entry.base)) byBase.set(entry.base, []); byBase.get(entry.base).push([stem, entry]) } else others.push([stem, entry])
  }
  const people = [...byBase].sort((a, b) => natAsc(a[0], b[0])).map(([base, list]) => ({
    id: `chars/${base}`,
    key: base,   // 取缩略图用（Textures/Characters/Bases/<底号>201.png），标题是显示名
    title: master.bases.get(base) || `角色 ${base}`,
    subtitle: `${list.length} 项`,
    children: list.map(([stem, entry]) => node(stem, stem, entry, `chars/${base}`)),
  }))
  if (people.length) lists.push({ id: 'chars', title: '角色', children: people })
  if (others.length) lists.push({ id: 'other', title: '其它剧情', children: others.map(([stem, entry]) => node(stem, stem, entry, 'other')) })
  lists.push({ id: 'all', title: '全部剧情', children: [...scenes].sort((a, b) => natAsc(a[0], b[0])).map(([stem, entry]) => node(stem, stem, entry, 'all')) })
  return { children: lists }
}

export const catalog = (ctx) => ctx?.catalogTree || null

// ---------- 解析 ----------
const str = (value) => (value === null || value === undefined ? '' : String(value))
const numOrNull = (value) => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null }
const cleanName = (value) => str(value).trim().replace(/\\/g, '/').replace(/^\/+/, '')

// 一句台词的片段：<ruby=读音>字</ruby> → { text, ruby }；<emoji=名字> → 一个符号；其余原样
function segmentsOf(raw, emoji = DEFAULT_OPTIONS.emoji) {
  const text = str(raw).replace(/\\n/g, '\n').replace(/<emoji=(.*?)>/g, (_all, name) => emoji[name] || '')
  const segments = []
  let last = 0
  for (const m of text.matchAll(/<ruby=(.*?)>(.*?)<\/ruby>/g)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) })
    segments.push({ text: m[2], ruby: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments.filter((segment) => segment.text)
}

// 总层数 N + 动画名 + 速度 → 联动背景音效（照 PlaySpineLinkedBgSE；表在 effects.linkedBgSe：值是名字，或 [慢速, 快速]）
export function linkedBgSe(n, anim, speed, effects = DEFAULT_OPTIONS.effects) {
  const entry = effects.linkedBgSe?.[n]?.[anim]
  if (Array.isArray(entry)) return (Math.abs(speed - effects.fastSpeed) < 1e-6 ? entry[1] : entry[0]) || ''
  return typeof entry === 'string' ? entry : ''   // 写成单个名字 = 快慢一样
}
export const isOneShot = (n, anim, effects = DEFAULT_OPTIONS.effects) => Boolean(effects.oneShotRule?.[n]?.includes(anim))

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || optionsOf(meta?.options)
  const { row: F, detail: D } = opt.fieldMap
  const zoomCode = (scale) => ((scale - 1) / opt.camera.zoomUnit) * 1000   // 播放器 zoomOf(z) = 1 + z/1000×zoomUnit 的反函数
  const bgExt = safeRegex(`\\.(?:${(opt.backgrounds.ext || []).map((e) => escapeRegex(String(e).replace(/^\\./, ''))).join('|') || '(?!)'})$`)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  const unknownKeys = new Set()
  let scene = Array.isArray(data) ? data[1] : null
  if (!Array.isArray(scene) && data?.r && Array.isArray(data.r.MSceneDetailViewModel)) {   // 对象形
    scene = [data.r.MSceneId, data.r.MSceneDetailViewModel.filter((row) => row && typeof row === 'object').map((row) => objectRowToArray(row, unknownKeys))]
  }
  if (!Array.isArray(scene) || !Array.isArray(scene[1])) throw new Error('找不到场景行（[null, [<id>, [行…]]] 或 {"r":{"MSceneDetailViewModel":[…]}}）')
  const sceneId = str(scene[0]) || str(meta?.stem)
  const rows = scene[1].filter((row) => Array.isArray(row))
  const stats = { rows: rows.length, commands: 0, raw: {}, unresolved: {}, spines: 0, mosaicSkipped: 0, notes: [] }
  // 马赛克层是否叠：播放器「更多」里的开关（按媒体存，经 reader?mosaic=1 传来）优先，没有就看 adapterOptions.showMosaic
  const showMosaic = meta?.showMosaic ?? ctx?.showMosaic
  for (const key of unknownKeys) stats.raw[`field:${key}`] = 1
  const miss = (kind, name) => { const key = `${kind}:${name}`; stats.unresolved[key] = (stats.unresolved[key] || 0) + 1 }
  const raw = (key) => { stats.raw[key] = (stats.raw[key] || 0) + 1 }

  // --- 静态画面的层 ---
  const folder = ctx?.folders?.get(sceneId)
  const mosaicNames = []
  let parts = []
  if (folder) {
    let order = folder.bases
    const config = ctx.stillConfigs?.get(sceneId)
    if (config) {
      try {
        const list = JSON.parse(config.replace(/^﻿/, ''))?.Parts
        if (Array.isArray(list) && list.length) {
          const wanted = []
          for (const part of list) {
            if (part?.IsMosaic) { mosaicNames.push(str(part?.Path)); if (!showMosaic) { stats.mosaicSkipped += 1; continue } }
            const name = str(part?.Path)
            if (name && folder.bases.includes(name)) wanted.push(name)
          }
          if (wanted.length) order = wanted
        }
      } catch { /* 配置坏了就按全部层 */ }
    }
    // 被配置排除的层要在诊断里说清楚：马赛克层（IsMosaic）默认不叠；不在 Parts 里的文件也不叠
    const listed = new Set(order.concat(mosaicNames))
    const unlisted = folder.bases.filter((base) => !listed.has(base))
    if (mosaicNames.length) stats.mosaic = { total: mosaicNames.length, shown: Boolean(showMosaic) }
    if (mosaicNames.length && !showMosaic) stats.notes.push(`still_configuration.json 里有 ${mosaicNames.length} 个马赛克层（IsMosaic：${mosaicNames.join('、')}），默认不叠；「更多 → 显示马赛克层」或 adapterOptions['misttrain-json'].showMosaic 打开`)
    if (unlisted.length && order !== folder.bases) stats.notes.push(`${unlisted.length} 个骨架文件不在 still_configuration.json 的 Parts 里，没有叠：${unlisted.join('、')}`)
    parts = order.map((base) => ({ skel: `${folder.dir}/${base}.skel.bytes`, atlas: `${folder.dir}/${base}.atlas.txt` }))
  } else if (ctx?.folders) miss('spines', sceneId)
  const total = folder?.count || 0

  const stripExt = (name) => (bgExt ? name.replace(bgExt, '') : name)
  const resolveBg = (name) => {
    const key = stripExt(name.toLowerCase())
    if (ctx?.backgrounds?.has(key)) return ctx.backgrounds.get(key)
    if (ctx?.hasIndex) miss('background', name)
    return fillTemplate(opt.paths.background, { name: stripExt(name) })
  }

  const steps = []
  let pending = []            // 还没有台词的行攒下来的指令
  let speaker = null
  let lastBgm = ''
  let stillOn = false
  let anim = ''
  let speed = 1
  let bgSeNow = ''
  let camera = [0, 0, 0, 0]   // 播放器单位：[x, y, zoomCode, 旋转]
  let scale = 1

  const playStill = (command, animName) => {
    const name = animName || anim || opt.still.defaultAnimation
    const oneShot = isOneShot(total, name, opt.effects)
    anim = name
    parts.forEach((part, order) => {
      stats.spines += 1
      command({ op: 'spine', slot: `still${order}`, kind: 'still', skel: part.skel, atlas: part.atlas, anim: name, loop: !oneShot, speed, order, ...(oneShot ? { slow: true } : {}) })
    })
    const linked = linkedBgSe(total, name, speed, opt.effects)
    if (linked) {
      if (bgSeNow !== linked) { command({ op: 'bgse', src: fillTemplate(opt.paths.bgse, { name: linked }), loop: !opt.effects.loopExcept.includes(linked) }); bgSeNow = linked }
    } else if (bgSeNow) { command({ op: 'bgseStop' }); bgSeNow = '' }
  }

  rows.forEach((row, rowIndex) => {
    const commands = pending
    pending = []
    const emit = (command) => { commands.push(command) }
    const background = cleanName(row[F.background])
    const detail = Array.isArray(row[F.detail]) ? row[F.detail] : []
    const animName = str(detail[D.animation]).trim()
    const effect = str(row[F.effect]).trim()

    if (background) emit({ op: 'bg', src: resolveBg(background), fade: 0.5 })
    if (row[F.frameImage]) raw('frameImage')
    if (str(row[F.soundTag]).trim()) raw('soundTag')
    if (Array.isArray(row[F.stand]) && row[F.stand].length) raw('standCharacters')
    if (numOrNull(row[F.backgroundEffectType])) raw('backgroundEffectType')

    // --- 静态画面 + 动画 + 镜头 ---
    const nextSpeed = numOrNull(detail[D.speed])
    if (nextSpeed !== null && nextSpeed > 0) speed = nextSpeed
    if (parts.length && (!stillOn || animName)) {
      stillOn = true
      playStill(emit, animName)
    }
    const camValues = [D.zoom, D.x, D.y, D.seconds, D.rotation].map((i) => numOrNull(detail[i]))
    if (camValues.some((v) => v !== null)) {
      const [zoom, px, py, seconds, rotation] = camValues
      const from = [...camera]
      const zoomed = zoom !== null && Math.abs(zoom) > opt.camera.zoomEpsilon
      if (zoomed) scale = zoom + opt.camera.zoomAdd
      const next = [px !== null ? px * opt.camera.positionScale : camera[0], py !== null ? py * opt.camera.positionScale : camera[1], zoomed ? zoomCode(scale) : camera[2], rotation !== null ? rotation : camera[3]]
      camera = next
      emit({ op: 'camera', from, to: [...next], seconds: Math.max(0, Math.min(opt.camera.maxSeconds, seconds && seconds > 0 ? seconds : 0)) })
    }

    // --- 屏幕效果 ---
    const kind = opt.effects.map[effect]
    if (kind === 'wash') emit({ op: 'wash', color: 'white', seconds: opt.effects.fadeSeconds })
    else if (kind === 'flash') emit({ op: 'flash', color: 'white', count: opt.effects.flashCount, seconds: opt.effects.flashSeconds })
    else if (effect && effect !== '0') raw(`effect:${effect}`)

    // --- 声音 ---
    const bgm = cleanName(row[F.bgm])
    if (bgm && bgm !== lastBgm) { emit({ op: 'bgm', src: fillTemplate(opt.paths.bgm, { name: bgm }) }); lastBgm = bgm }
    const se = cleanName(row[F.se])
    if (se) emit({ op: 'se', src: fillTemplate(opt.paths.se, { name: se }) })
    const voice = cleanName(row[F.voice])
    if (voice) {
      const src = ctx?.voiceOf?.(voice)
      if (src) emit({ op: 'voice', src })
      else if (ctx?.hasIndex) miss('voice', voice)
      else emit({ op: 'voice', src: fillTemplate(opt.paths.voiceFallback, { name: voice }) })
    }

    // --- 台词：没有台词的行不停（指令并进下一句） ---
    const segments = segmentsOf(row[F.text], opt.emoji)
    const hasText = segments.some((segment) => segment.text.trim())
    if (!hasText) { pending = commands; return }
    const name = str(row[F.speaker]).trim()
    if (name !== speaker) { emit({ op: 'speaker', segments: name ? [{ text: name }] : [] }); speaker = name }
    emit({ op: 'text', segments })
    stats.commands += commands.length
    steps.push({ index: steps.length, commands, row: rowIndex })
  })
  if (pending.length) {
    if (steps.length) { steps[steps.length - 1].commands.push(...pending); stats.commands += pending.length } else { steps.push({ index: 0, commands: pending }); stats.commands += pending.length }
  }
  for (const step of steps) delete step.row
  return { steps, stats }
}

// 体检：没有标题的剧情（卡片显示文件名）/ 没有 Spines 目录的剧情（按文件名当场景 id 查）/ 没读到名称表
export function health(ctx) {
  const out = []
  const sample = (list) => `${list.slice(0, 5).join('、')}${list.length > 5 ? ' 等' : ''}`
  if (!ctx.master.titles.size) out.push({ code: 'master-missing', message: '没读到 MasterData/MSceneViewModel.json：剧情标题都显示文件名（检查 adapterOptions.root）' })
  if (!ctx.master.bases.size) out.push({ code: 'master-chars-missing', message: '没读到 MasterData/MCharacterBaseViewModel.json：角色名都显示「角色 <底号>」' })
  const untitled = [...ctx.scenes.keys()].filter((stem) => !titleOf(ctx.master, stem, ctx.opts.titleLookup))
  if (ctx.master.titles.size && untitled.length) out.push({ code: 'scene-no-title', message: `${untitled.length} 个剧情在 MSceneViewModel 里查不到标题（卡片显示文件名）：${sample(untitled)}` })
  const noSpine = [...ctx.scenes.keys()].filter((stem) => !ctx.folders.has(stem))
  if (noSpine.length) out.push({ code: 'scene-no-spine', message: `${noSpine.length} 个剧情在 Spines/ 下没有以文件名命名的目录（没有静态画面，或场景 id 和文件名不一致）：${sample(noSpine)}` })
  return out
}
export const misttrainJsonAdapter = { id: ADAPTER_ID, health, label: 'MistTrainGirls X 剧情 JSON', sniff, parse, contextFiles, contextDirs, contextTextFilter, prepare, catalog }
