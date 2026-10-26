// 适配器：tenkeiprdx（Unity 剧情查看器）的剧情 JSON → 规范场景（gal-scene/1）。语义照反编译出来的查看器（见 private-scripts/tenkeiprdx-x）。
// 输入形态：对象形 { result: { sceneDetails: [{ assetId, sceneFrameDetails: [帧…] }] } }（取 assetId = 脚本文件名那一项，没有就取第一项）；
// 或位置数组形（游戏原始数据，没有键名：[[ "<场景 id>", n, n, bool, [帧…], … ]]）——先转成对象形再走同一套解析，字段位置见 arrayFrameToObject。
// 一帧 = 一步（点一下）。每帧的字段 → 指令：
//   backgroundImage          bg（查 Backgrounds/adventure|still|eventstill）；名字里带 still_02..05 还会触发音效/闪白（照查看器）
//   still + stillAnimation   整幅静态画面 = Stills/<名>/ 下所有 *.skel.bytes（按数字前缀排序叠起来），播放 stillAnimation；
//                            animation2/3/4 联动背景音效 Hse2/Hse3/Hse4，animation4 闪白两次并在 1 秒内降速（spine 指令带 slow:true，降到多少由播放器设置），animation5 白屏淡出，animation3 倍速 1.5
//   sceneCamera*             camera：起止位置 + Z（缩放，千分比）+ 时长（毫秒）
//   adventureCharacters[]    站位立绘 = Spines/<角色id>/ 下的 *.skel.bytes；表情 0..6 → idle_normal/joy/sad/angry/surprise/shy/unique；
//                            站位 1 左 / 2 右 / 其余居中；动作 1 跳两下 / 2 左右抖 / 3 下沉；空数组 = 立绘全部隐藏
//   phraseVoice / backgroundMusic / soundEffect   AdventureVoice/<场景id>/<名>.ogg · BGM/<名>.ogg（没有就找 <名>_loop.ogg）· Se/<名>.ogg
//   speakerName（%username% → Masterdata/username.txt） / phraseContents（\n 换行）   speaker / text
// 对象形里没有「谁在说话」的站位字段，所以不做说话人高亮（数组形才有，暂不支持）；frameEffect 的取值不明，原样记在 stats.frameEffects 里。
// 列表（adapter.catalog，照原查看器的三个列表页）：活动 = EpisodeThumbnails/event（新的在前，剧情 id = '2'+文件名第 3、4 段）、
// 附加 = EpisodeThumbnails/extra（同上，id 以 1 结尾的末位换成 2；标题查 Masterdata/masterdata_32.json）、
// 角色 = CharacterIcons/<8 位角色号>*.png（名字、称号查 masterdata_4.json）→ 点进去是这个角色的 EX 剧情（masterdata_32.json 里按 <角色号>_01|02_still 找，
// 缩略图 Backgrounds/still/<key>.png）、全部剧情 = scenes/ 下所有剧情 JSON。列表都是每次从文件现读的：数据文件更新了，列表跟着变。

import { createIndexResolver } from '../resolve.mjs'
import { cleanDir, createOptionsReader, escapeRegex, fillTemplate, safeRegex } from './options-merge.mjs'

// ---------- 参数（config.adapterOptions['tenkeiprdx-json']；全部可选，没写 = 下面的默认值 = 以前的行为）----------
// 适配器只读这些参数、按参数匹配；路径 / 字段位置 / 命名规则 / 推出来的数字都在 DEFAULT_OPTIONS 里（数组、对象逐项可覆盖，数组整体替换）：
//   root            Imported 目录（相对媒体目录）                   unknownName     %username% 没有 username.txt 时的名字
//   stillPng        'spine' | 'image'：<Stills 目录名>_still_0N 背景当骨架动画还是普通图
//   positions       站位 → 横向位置 0..1（positionX 是旧名，同样合并进来）；defaultX 没列出的站位；facial 表情 0.. → 动画名
//   fieldMap        数组形里各字段的位置（游戏版本变了只改这里）：scene { id, frames }；frame { 键名: 位置 }（soundEffect / still / stillAnimation 默认没有位置）；
//                   character { 键名: 位置 }；skip 不当「未知字符串」处理的位置；master { row, char { id, name, title, minLength }, scene { title, jsonIds, stills, minLength } }
//   dirs / files    索引哪些目录（spines stills backgrounds bgm scenes icons thumbs masterdata）、名称表 / username 的文件名
//   paths           路径模板（{name} {scene}）：background / bgm / se / voice 是候选数组，按顺序取索引里第一个存在的，都不在 = 第一个；
//                   backgroundMissing 背景索引里没有时 [{ match?, path }]（第一条命中的）；thumbStill 列表里 still 缩略图的兜底路径
//   still           backgroundRe（背景名 → 骨架目录 + N）/ animationRe（字符串值像动画名）/ animationName 模板 / defaultAnimation
//   hse             stillRe（背景名触发的效果，第 1 组 = 效果键）+ effects { 键: [指令…] }（背景音效 / 闪白 / 白屏，指令原样发出）
//   animations      noLoop / slow（动画名列表）/ speed { 动画名: 倍速 } / linked { 动画名: { bgse, loop, flash } } / flash { color, count, seconds } / wash { 动画名: { color, seconds } }
//   animationSpeed  { msThreshold: 100, msDivisor: 1000 } 速度大于阈值当千分比
//   camera          { durationMs: 2500, maxSeconds: 60 }           stand { preferred: '{id}_{appearance}', appearancePad: 2 }
//   bgm             { stopRe, fadeRe } 停掉 BGM 的写法            userPlaceholder  台词里的主角名占位符
//   kinds           列表页的分类 [{ id, label, dir }]（缩略图目录 EpisodeThumbnails/<dir>）；idRules 缩略图名 → 剧情 id（见 resolveSceneId）：
//                   { kind, split, segments, prefix, minParts, lastDigit { 末位: 换成 }, forms [候选末位，'' = 不改] }；
//                   catalog { thumbPrefix, thumbStillSuffix, charCodeRe, charStills [前缀模板 {id}], labels { chars, all, unknownChar } }
export const ADAPTER_ID = 'tenkeiprdx-json'
export const DEFAULT_OPTIONS = {
  root: '',
  unknownName: '플레이어',
  stillPng: 'spine',
  userPlaceholder: '%username%',
  positions: { 0: 0.5, 1: 0.3, 2: 0.7 },
  positionX: {},
  defaultX: 0.5,
  facial: ['idle_normal', 'idle_joy', 'idle_sad', 'idle_angry', 'idle_surprise', 'idle_shy', 'idle_unique'],
  fieldMap: {
    scene: { id: 0, frames: 4 },
    frame: { backgroundImage: 3, speakerName: 10, phraseContents: 12, backgroundMusic: 27, phraseVoice: 29, adventureCharacters: 31, soundEffect: null, still: null, stillAnimation: null },
    character: { characterMasterId: 0, characterAppearance: 1, characterPosition: 2, characterAction: 3, characterEmotionIcon: 4, characterFacialExpression: 5 },
    skip: [0, 30],
    master: { row: 1, char: { id: 0, name: 3, title: 4, minLength: 4 }, scene: { title: 2, jsonIds: 9, stills: 10, minLength: 11 } },
  },
  dirs: { masterdata: 'Masterdata', spines: 'Spines', stills: 'Stills', backgrounds: 'Backgrounds', bgm: 'BGM', scenes: 'scenes', icons: 'CharacterIcons', thumbs: 'EpisodeThumbnails' },
  files: { username: 'username.txt', characters: 'masterdata_4.json', scenarios: 'masterdata_32.json' },
  paths: {
    background: ['Backgrounds/adventure/{name}.png', 'Backgrounds/still/{name}.png', 'Backgrounds/eventstill/{name}.png'],
    backgroundMissing: [{ match: '_still_', path: 'Backgrounds/still/{name}.png' }, { path: 'Backgrounds/adventure/{name}.png' }],
    thumbStill: 'Backgrounds/still/{name}.png',
    bgm: ['BGM/{name}.ogg', 'BGM/{name}_loop.ogg'],
    se: ['Se/{name}.ogg'],
    voice: ['AdventureVoice/{scene}/{name}.ogg'],
  },
  still: { backgroundRe: '^(.+)_still_0*(\\d+)$', animationRe: '^animation\\d+$', animationName: 'animation{n}', defaultAnimation: 'animation1' },
  hse: {
    stillRe: 'still_0([2-5])',
    effects: {
      2: [{ op: 'bgse', src: 'BgSe/Hse5.ogg', loop: false }],
      3: [{ op: 'bgse', src: 'BgSe/Hse2.ogg', loop: true }],
      4: [{ op: 'flash', color: 'white', count: 2, seconds: 0.3 }, { op: 'bgse', src: 'BgSe/Hse4.ogg', loop: false }],
      5: [{ op: 'wash', color: 'white', seconds: 2 }],
    },
  },
  animations: {
    noLoop: ['animation4'],
    slow: ['animation4'],
    speed: { animation3: 1.5 },
    linked: { animation2: { bgse: 'BgSe/Hse2.ogg', loop: true }, animation3: { bgse: 'BgSe/Hse3.ogg', loop: true }, animation4: { bgse: 'BgSe/Hse4.ogg', loop: false, flash: true } },
    flash: { color: 'white', count: 2, seconds: 0.3 },
    wash: { animation5: { color: 'white', seconds: 1.5 } },
  },
  animationSpeed: { msThreshold: 100, msDivisor: 1000 },
  camera: { durationMs: 2500, maxSeconds: 60 },
  stand: { preferred: '{id}_{appearance}', appearancePad: 2 },
  bgm: { stopRe: '^noBGM(?:\\{([^}]*)\\})?$', fadeRe: 'Fade_([\\d.]+)' },
  kinds: [{ id: 'event', label: '活动', dir: 'event' }, { id: 'extra', label: '附加', dir: 'extra' }, { id: 'special', label: '特别', dir: 'special' }],
  idRules: [
    { kind: 'event', split: '_', segments: [2, 3], prefix: '2', minParts: 4, lastDigit: {}, forms: [''] },
    { kind: 'extra', split: '_', segments: [2, 3], prefix: '2', minParts: 4, lastDigit: { 1: '2' }, forms: [''] },
    { kind: 'special', split: '_', segments: [2, 3], prefix: '2', minParts: 4, lastDigit: {}, forms: ['', '2', '1'] },
  ],
  catalog: { thumbPrefix: 'ep_eventstill_', thumbStillSuffix: '_still_01', charCodeRe: '^\\d{8}', charStills: ['{id}_01_still', '{id}_02_still'], labels: { chars: '角色', all: '全部剧情', unknownChar: '???' } },
}
const optionsOf = createOptionsReader(DEFAULT_OPTIONS)
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => cleanDir(optionsOf(options).root)

// 规整后的参数 → 编译好的正则 / 查表（同一份参数只编译一次）
const compiledCache = new WeakMap()
function compiled(opt) {
  if (compiledCache.has(opt)) return compiledCache.get(opt)
  const d = opt.dirs
  const kindDirs = new Map(opt.kinds.filter((k) => k && k.id && k.dir).map((k) => [String(k.dir).toLowerCase(), k.id]))
  const out = {
    scene: safeRegex(`^${escapeRegex(d.scenes)}/([^/]+)\\.json$`),
    thumb: safeRegex(`^${escapeRegex(d.thumbs)}/(${[...kindDirs.keys()].map(escapeRegex).join('|') || '(?!)'})/(${escapeRegex(opt.catalog.thumbPrefix)}[^/]+)\\.png$`),
    icon: safeRegex(`^${escapeRegex(d.icons)}/([^/]+)\\.png$`),
    spine: safeRegex(`^(${escapeRegex(d.spines)}|${escapeRegex(d.stills)})/([^/]+)/(.+)\\.skel\\.bytes$`),
    kindDirs,
    stillsLower: d.stills.toLowerCase(),
    indexed: new Set([d.backgrounds, d.bgm].map((x) => `${cleanDir(x)}/`.toLowerCase())),
    hseStill: safeRegex(opt.hse.stillRe),
    stillBg: safeRegex(opt.still.backgroundRe),
    stillAnim: safeRegex(opt.still.animationRe),
    bgmStop: safeRegex(opt.bgm.stopRe),
    bgmFade: safeRegex(opt.bgm.fadeRe),
    charCode: safeRegex(opt.catalog.charCodeRe),
    missing: opt.paths.backgroundMissing.map((rule) => ({ re: rule?.match ? safeRegex(rule.match) : null, any: !rule?.match, path: rule?.path })).filter((rule) => rule.path && (rule.any || rule.re)),
  }
  compiledCache.set(opt, out)
  return out
}

// 两种形状：对象形（带键名 sceneDetails / sceneFrameDetails）、位置数组形（游戏原始数据：[[ "<场景 id>", n, n, bool, [帧…], … ]]，没有任何键名）
const ARRAY_HEAD = /^\s*\[\s*\[\s*"\d{6,}"\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*(?:true|false)\s*,\s*\[/
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 16384)
  return /"(?:sceneFrameDetails|sceneDetails)"\s*:/.test(head) || ARRAY_HEAD.test(head)
}

// 数组形 → 对象形（之后复用同一套解析）。位置在 opt.fieldMap（默认值来自样本对照）：
//   场景  [0] 场景 id  [4] 帧数组
//   帧    [3] backgroundImage  [10] speakerName  [12] phraseContents  [27] backgroundMusic  [29] phraseVoice  [31] adventureCharacters
//   角色  [0] characterMasterId  [1] characterAppearance  [2] characterPosition  [3] characterAction  [4] characterEmotionIcon  [5] characterFacialExpression
//         （顺序 = 对象形里这几个键的声明顺序，样本里 [3] 在有语音的那句从 0 变成 4（像是说话动作）、[5] 恒为 2；没有对照样本，stats.arrayGuess 里标明）
// 其余位置没有样本：字符串值按内容认——名字是 Stills 目录里的 → still；animationN → stillAnimation（认不出的记在 stats.arrayUnknown）
const posOf = (value) => (Number.isInteger(value) && value >= 0 ? value : null)
function arrayFrameToObject(frame, ctx, opt) {
  const at = (i) => (i === null || frame[i] === null || frame[i] === undefined ? '' : frame[i])
  const { frame: fields, character: charFields, skip } = opt.fieldMap
  const out = {}
  const known = new Set(skip)
  for (const [key, raw] of Object.entries(fields)) {
    const i = posOf(raw)
    if (i === null) continue
    known.add(i)
    if (key !== 'adventureCharacters') out[key] = at(i)
  }
  const stand = posOf(fields.adventureCharacters)
  out.adventureCharacters = stand !== null && Array.isArray(frame[stand])
    ? frame[stand].map((c) => (Array.isArray(c) ? Object.fromEntries(Object.entries(charFields).filter(([, p]) => posOf(p) !== null).map(([key, p]) => [key, c[p]])) : null)).filter(Boolean)
    : null
  const unknown = []
  const rx = compiled(opt)
  frame.forEach((value, i) => {
    if (known.has(i) || typeof value !== 'string' || !value.trim()) return
    const v = value.trim()
    if (rx.stillAnim?.test(v)) out.stillAnimation = v
    else if (ctx?.spines?.has(`${opt.dirs.stills}/${v}`)) out.still = v
    else unknown.push(`[${i}]=${v.slice(0, 40)}`)
  })
  return { frame: out, unknown }
}
function readArrayScenes(data, wantedId, ctx, opt) {
  const { id: idAt, frames: framesAt } = opt.fieldMap.scene
  const scenes = data.filter((item) => Array.isArray(item) && Array.isArray(item[framesAt]))
  if (!scenes.length) throw new Error('找不到场景（数组形）')
  const scene = scenes.find((item) => str(item[idAt]) === str(wantedId)) || scenes[0]
  const unknown = {}
  const frames = scene[framesAt].map((frame) => {
    if (!Array.isArray(frame)) return {}
    const { frame: obj, unknown: extra } = arrayFrameToObject(frame, ctx, opt)
    for (const key of extra) unknown[key] = (unknown[key] || 0) + 1
    return obj
  })
  return { assetId: str(scene[idAt]), frames, unknown }
}

// ---------- 上下文：资源目录索引 + username ----------
export const contextFiles = (options) => {
  const opt = optionsOf(options)
  return [opt.files.username, opt.files.characters, opt.files.scenarios].map((name) => joinPath(rootOf(options), opt.dirs.masterdata, name))
}
export const contextDirs = (options) => Object.values(optionsOf(options).dirs).map((dir) => joinPath(rootOf(options), cleanDir(dir)))

const numericPrefix = (name) => { const m = /^(\d+)/.exec(name); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER }

export function prepare({ options, texts, files, toResourcePath, resourceResolve }) {
  const opt = optionsOf(options)
  const rx = compiled(opt)
  const toRes = toResourcePath || ((rel) => rel)
  const spines = new Map()   // 'Spines/<id>' / 'Stills/<名>' → [基名…]
  const index = new Set()    // 背景 / BGM 目录下的资源路径（路径模板按它找；支持 resourceResolve 的大小写 / 改写 / 换扩展名）
  const scenes = new Map()   // 剧情 id → 相对媒体目录的路径
  const thumbs = Object.fromEntries(opt.kinds.map((k) => [k.id, []]))
  const icons = []
  for (const rel of files || []) {
    const res = toRes(rel)
    let t = rx.scene?.exec(res)
    if (t) { scenes.set(t[1], rel); continue }
    t = rx.thumb?.exec(res)
    if (t) { thumbs[rx.kindDirs.get(t[1].toLowerCase())]?.push({ name: t[2], res }); continue }
    t = rx.icon?.exec(res)
    if (t) { icons.push({ name: t[1], res }); continue }
    const m = rx.spine?.exec(res)
    if (m) {
      const key = `${m[1].toLowerCase() === rx.stillsLower ? opt.dirs.stills : opt.dirs.spines}/${m[2]}`
      if (!spines.has(key)) spines.set(key, [])
      spines.get(key).push(m[3])
      continue
    }
    const lower = res.toLowerCase()
    for (const prefix of rx.indexed) if (lower.startsWith(prefix)) { index.add(res); break }
  }
  for (const list of spines.values()) list.sort((a, b) => numericPrefix(a) - numericPrefix(b) || a.localeCompare(b))
  const textOf = (name) => Object.entries(texts || {}).find(([key]) => key.endsWith(`/${name}`) || key === name)?.[1] || ''
  const username = textOf(opt.files.username).trim()
  const master = readMasterdata(textOf(opt.files.characters), textOf(opt.files.scenarios), opt.fieldMap.master)
  const resolver = createIndexResolver({ index, cfg: resourceResolve })
  // 路径模板数组：取索引里第一个存在的，都不在 = 第一个（没建索引 / 目录不在索引里也走这条）
  const pick = (templates, values) => {
    for (const template of templates) { const hit = resolver.resolve(fillTemplate(template, values)); if (hit) return hit }
    return templates.length ? fillTemplate(templates[0], values) : ''
  }
  const found = (templates, values) => templates.map((template) => resolver.resolve(fillTemplate(template, values))).find(Boolean) || ''
  const ctx = { opts: opt, spines, index, resolver, pick, found, username, scenes, thumbs, icons, master, hasIndex: Boolean(files?.length), stillAsSpine: opt.stillPng !== 'image' }
  ctx.catalogTree = buildCatalog(ctx)
  return ctx
}

// ---------- 名称表 / 列表 ----------
const jsonArray = (text) => { try { const v = JSON.parse(String(text || '').replace(/^﻿/, '')); return Array.isArray(v) ? v : [] } catch { return [] } }
// masterdata_4：[ ?, [角色号, ?, ?, 名字, 称号, …, 第 10 项分组号] ]；masterdata_32：[ ?, [?, ?, 标题, …, 第 9 项 [剧情 id…], 第 10 项 [still 键…]] ]（位置在 fieldMap.master）
function readMasterdata(text4, text32, map) {
  const chars = new Map()
  for (const row of jsonArray(text4)) {
    const data = Array.isArray(row) ? row[map.row] : null
    if (!Array.isArray(data) || data.length < map.char.minLength) continue
    const id = Number(data[map.char.id])
    if (Number.isFinite(id) && !chars.has(id)) chars.set(id, { name: str(data[map.char.name]), title: str(data[map.char.title]) })
  }
  const scenarios = []
  const byStill = new Map()
  for (const row of jsonArray(text32)) {
    const data = Array.isArray(row) ? row[map.row] : null
    if (!Array.isArray(data) || data.length < map.scene.minLength) continue
    const stills = Array.isArray(data[map.scene.stills]) ? data[map.scene.stills].map(str).filter(Boolean) : []
    const entry = { title: str(data[map.scene.title]), jsonId: Array.isArray(data[map.scene.jsonIds]) ? str(data[map.scene.jsonIds][0]) : '', stills }
    scenarios.push(entry)
    for (const key of stills) if (!byStill.has(key)) byStill.set(key, entry)
  }
  return { chars, scenarios, byStill }
}

const natDesc = (a, b) => b.localeCompare(a, 'en', { numeric: true })
const natAsc = (a, b) => a.localeCompare(b, 'en', { numeric: true })

// 缩略图名 → 剧情 id（按 idRules 里这个分类的规则；候选里第一个真有剧情文件的，都没有 = 第一个）；没有规则 / 段数不够 → ''
export function resolveSceneId(opt, kind, thumbName, scenes) {
  const rule = opt.idRules.find((r) => r?.kind === kind)
  if (!rule) return ''
  const parts = thumbName.split(rule.split ?? '_')
  if (parts.length < (Number(rule.minParts) || 0)) return ''
  const segments = (Array.isArray(rule.segments) ? rule.segments : []).map((i) => parts[i])
  if (segments.some((seg) => seg === undefined)) return ''
  let id = `${rule.prefix ?? ''}${segments.join('')}`
  const last = rule.lastDigit?.[id.slice(-1)]
  if (last !== undefined) id = `${id.slice(0, -1)}${last}`
  const forms = (Array.isArray(rule.forms) && rule.forms.length ? rule.forms : ['']).map((form) => (form === '' ? id : `${id.slice(0, -1)}${form}`))
  return forms.find((candidate) => scenes.has(candidate)) || forms[0]
}

function buildCatalog(ctx) {
  const { scenes, thumbs, icons, master, opts: opt } = ctx
  if (!scenes.size) return null
  const labels = opt.catalog.labels
  const info = new Map()   // 剧情 id → { title, thumb, badge }（先收到的为准）
  const note = (id, entry) => { if (!info.has(id)) info.set(id, entry) }
  const lists = []
  const stillThumb = (key) => ctx.found(opt.paths.background, { name: key }) || (ctx.hasIndex ? '' : fillTemplate(opt.paths.thumbStill, { name: key }))

  for (const { id: kind, label } of opt.kinds) {
    const children = []
    for (const thumb of [...(thumbs[kind] || [])].sort((a, b) => natDesc(a.name, b.name))) {
      const id = resolveSceneId(opt, kind, thumb.name, scenes)
      const script = id && scenes.get(id)
      if (!script) continue
      const title = master.byStill.get(`${thumb.name.slice(opt.catalog.thumbPrefix.length)}${opt.catalog.thumbStillSuffix}`)?.title || ''
      note(id, { title: title || id, thumb: thumb.res, badge: kind })
      children.push({ id: `${kind}/${id}`, title: title || id, subtitle: title ? id : '', thumb: thumb.res, badge: kind, script })
    }
    if (children.length) lists.push({ id: kind, title: label, children })
  }

  const people = []
  const codeRe = compiled(opt).charCode
  for (const icon of [...icons].sort((a, b) => natDesc(a.name, b.name))) {
    const code = codeRe?.exec(icon.name)?.[0]
    const id = code ? Number(code) : -1
    const person = master.chars.get(id)
    const children = []
    const prefixes = opt.catalog.charStills.map((template) => fillTemplate(template, { id }))
    for (const row of master.scenarios) {
      if (!row.jsonId || !row.stills.some((key) => prefixes.some((prefix) => key.startsWith(prefix)))) continue
      const script = scenes.get(row.jsonId)
      if (!script) continue
      const key = row.stills.find((k) => k.includes(opt.catalog.thumbStillSuffix)) || row.stills[0]
      const thumb = stillThumb(key)
      const title = row.title || row.jsonId
      note(row.jsonId, { title, thumb, badge: '' })
      children.push({ id: `chars/${code || icon.name}/${row.jsonId}`, title, thumb, script })
    }
    people.push({ id: `chars/${code || icon.name}`, title: person?.name || labels.unknownChar, subtitle: [person?.title, `${children.length} 项`].filter(Boolean).join(' · '), thumb: icon.res, children })
  }
  if (people.length) lists.push({ id: 'chars', title: labels.chars, children: people })

  const all = [...scenes.keys()].sort(natAsc).map((id) => {
    const known = info.get(id)
    return { id: `all/${id}`, title: known?.title || id, subtitle: known && known.title !== id ? id : '', thumb: known?.thumb || '', badge: known?.badge || '', script: scenes.get(id) }
  })
  lists.push({ id: 'all', title: labels.all, children: all })
  return { children: lists }
}

// 适配器的列表（见 ../browse.mjs 的 catalog）：没有可用的数据（没有剧情文件）就返回 null，浏览退回按目录
export const catalog = (ctx) => ctx?.catalogTree || null

// ---------- 解析 ----------
const str = (value) => (value === null || value === undefined ? '' : String(value))
const numOrNull = (value) => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null }
const intOf = (value, fallback = 0) => { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? n : fallback }
const cleanName = (value) => str(value).trim().replace(/\\/g, '/').replace(/^\/+/, '')
const safeSeg = (value) => (/^[^/\\\0]+$/.test(value) && value !== '.' && value !== '..' ? value : '')
const baseName = (src) => src.replace(/^.*\//, '').replace(/\.[^.]+$/, '')

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || optionsOf(meta?.options)
  const rx = compiled(opt)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  let sceneId
  let frames
  let arrayForm = null
  if (Array.isArray(data)) {
    arrayForm = readArrayScenes(data, meta?.stem, ctx, opt)
    sceneId = safeSeg(arrayForm.assetId || str(meta?.stem))
    frames = arrayForm.frames
  } else {
    const details = data?.result?.sceneDetails
    if (!Array.isArray(details) || !details.length) throw new Error('找不到 sceneDetails')
    const scene = details.find((item) => str(item?.assetId) === str(meta?.stem)) || details[0]
    sceneId = safeSeg(str(scene?.assetId) || str(meta?.stem))
    frames = Array.isArray(scene?.sceneFrameDetails) ? scene.sceneFrameDetails : []
  }
  const positionX = { ...opt.positions, ...opt.positionX }
  const stats = { frames: frames.length, commands: 0, raw: {}, unresolved: {}, frameEffects: {}, spines: 0 }
  if (arrayForm) { stats.form = 'array'; stats.arrayGuess = '角色项各位置（外观 [1] / 站位 [2] / 动作 [3] / 表情图标 [4] / 表情 [5]）是按对象形的键顺序推的，没有对照样本'; if (Object.keys(arrayForm.unknown).length) stats.arrayUnknown = arrayForm.unknown }
  const miss = (kind, name) => { const key = `${kind}:${name}`; stats.unresolved[key] = (stats.unresolved[key] || 0) + 1 }

  const username = ctx?.username || str(opt.unknownName) || DEFAULT_OPTIONS.unknownName
  const steps = []
  let speaker = null
  let lastBgm = ''
  let lastStill = ''
  let stillAnim = ''
  let lastSpeed = 1
  let bgSeNow = ''
  const chars = new Map()   // slot → 上一次的 spine 指令（后面的帧里没提到的站位保留）
  const paths = opt.paths
  const pick = (templates, values) => (ctx?.pick ? ctx.pick(templates, values) : templates.length ? fillTemplate(templates[0], values) : '')

  const resolveBg = (name) => {
    const hit = ctx?.found?.(paths.background, { name })
    if (hit) return hit
    if (ctx?.hasIndex) miss('background', name)
    const rule = rx.missing.find((r) => r.any || r.re.test(name))
    return fillTemplate(rule ? rule.path : paths.background[0] || '', { name })
  }
  const skelOf = (kind, folder, preferred) => {
    const dir = `${kind}/${folder}`
    const bases = ctx?.spines?.get(dir)
    if (!bases?.length) {
      if (ctx?.spines) miss(kind.toLowerCase(), folder)
      return preferred ? [{ skel: `${dir}/${preferred}.skel.bytes`, atlas: `${dir}/${preferred}.atlas.txt` }] : []
    }
    const picked = kind === opt.dirs.spines ? [bases.includes(preferred) ? preferred : bases[0]] : bases
    return picked.map((base) => ({ skel: `${dir}/${base}.skel.bytes`, atlas: `${dir}/${base}.atlas.txt` }))
  }
  const copy = (command) => (command && typeof command === 'object' ? { ...command } : null)

  frames.forEach((frame, frameIndex) => {
    const commands = []
    const emit = (command) => { if (command) commands.push(command) }
    const background = cleanName(frame?.backgroundImage)
    // 没有 still 字段、但 backgroundImage 指的是某个静态画面：当整幅静态画面播（不然只有写了 still 的那一帧是骨骼，后面几段都退成不动的图片）。
    // 两种写法：名字正好是 Stills/ 下的骨骼目录；或者 <Stills 目录名>_still_0N（Backgrounds/still 里每个静态画面有 _still_01..05 五张图，对应骨架的 animation1..5）→ 播那个骨架的 animationN。
    // adapterOptions.stillPng = 'image' 可以关掉（当普通背景图）；正则在 still.backgroundRe
    const explicitStill = safeSeg(cleanName(frame?.still))
    const exactFolder = !explicitStill && background && safeSeg(background) && ctx?.spines?.has(`${opt.dirs.stills}/${background}`) ? background : ''
    const pngMatch = !explicitStill && !exactFolder && background && ctx?.stillAsSpine !== false ? rx.stillBg?.exec(background) : null
    const pngFolder = pngMatch && safeSeg(pngMatch[1]) && ctx?.spines?.has(`${opt.dirs.stills}/${pngMatch[1]}`) ? pngMatch[1] : ''
    const stillFromBackground = Boolean(exactFolder || pngFolder)
    const stillName = explicitStill || exactFolder || pngFolder
    const pngAnim = pngFolder ? fillTemplate(opt.still.animationName, { n: Number(pngMatch[2]) }) : ''
    if (stillFromBackground) stats.stillFromBackground = (stats.stillFromBackground || 0) + 1
    const anim = str(frame?.stillAnimation).trim() || pngAnim
    const effect = str(frame?.frameEffect).trim()
    if (effect) stats.frameEffects[effect] = (stats.frameEffects[effect] || 0) + 1

    // --- 背景 / 静态画面 ---
    if (stillName) {
      if (stillName !== lastStill) {
        emit({ op: 'bgoff', fade: 0 })
        emit({ op: 'spineOff', prefix: 'still' })
        lastStill = stillName
      }
    } else if (background) {
      if (lastStill) { emit({ op: 'spineOff', prefix: 'still' }); emit({ op: 'camera', to: [0, 0, 0], seconds: 0 }); lastStill = ''; stillAnim = '' }
      emit({ op: 'bg', src: resolveBg(background), fade: 0.5 })
      const effectKey = rx.hseStill?.exec(background)?.[1]
      for (const command of Array.isArray(opt.hse.effects[effectKey]) ? opt.hse.effects[effectKey] : []) {
        const out = copy(command)
        emit(out)
        if (out?.op === 'bgse') bgSeNow = out.src || ''
      }
    }
    if (lastStill && (stillName || anim)) {
      const name = anim || stillAnim || opt.still.defaultAnimation
      let speed = numOrNull(frame?.animationSpeed)
      speed = speed === null ? lastSpeed : speed > opt.animationSpeed.msThreshold ? speed / opt.animationSpeed.msDivisor : speed
      lastSpeed = speed || 1
      if (opt.animations.speed[name] !== undefined) speed = opt.animations.speed[name]
      stillAnim = name
      const slow = opt.animations.slow.includes(name)
      skelOf(opt.dirs.stills, lastStill).forEach((part, order) => {
        stats.spines += 1
        emit({ op: 'spine', slot: `still${order}`, kind: 'still', skel: part.skel, atlas: part.atlas, anim: name, loop: !opt.animations.noLoop.includes(name), speed, order, ...(slow ? { slow: true } : {}) })
      })
      const linked = opt.animations.linked[name]
      if (linked?.bgse) {
        if (bgSeNow !== linked.bgse) { emit({ op: 'bgse', src: linked.bgse, loop: Boolean(linked.loop) }); bgSeNow = linked.bgse }
        if (linked.flash) emit({ op: 'flash', ...opt.animations.flash })
      } else if (bgSeNow) { emit({ op: 'bgseStop' }); bgSeNow = '' }
      const wash = opt.animations.wash[name]
      if (wash) emit({ op: 'wash', ...wash })
    }

    // --- 镜头 ---
    const cam = [frame?.sceneCameraStartPositionX, frame?.sceneCameraStartPositionY, frame?.sceneCameraStartPositionZ, frame?.sceneCameraEndPositionX, frame?.sceneCameraEndPositionY, frame?.sceneCameraEndPositionZ].map(numOrNull)
    if (cam.some((v) => v !== null) && lastStill) {
      const from = [cam[0] ?? 0, cam[1] ?? 0, cam[2] ?? 0]
      emit({ op: 'camera', from, to: [cam[3] ?? from[0], cam[4] ?? from[1], cam[5] ?? from[2]], seconds: Math.max(0, Math.min(opt.camera.maxSeconds, (numOrNull(frame?.sceneCameraActionDuration) ?? opt.camera.durationMs) / 1000)) })
    }

    // --- 站位立绘 ---
    const stand = frame?.adventureCharacters
    if (Array.isArray(stand)) {
      if (!stand.length) {
        if (chars.size) { emit({ op: 'spineOff', prefix: 'Chara' }); chars.clear() }
      } else {
        for (const entry of stand) {
          const id = safeSeg(str(entry?.characterMasterId))
          if (!id) continue
          const position = intOf(entry?.characterPosition)
          const preferred = fillTemplate(opt.stand.preferred, { id, appearance: String(intOf(entry?.characterAppearance)).padStart(opt.stand.appearancePad, '0') })
          const part = skelOf(opt.dirs.spines, id, preferred)[0]
          if (!part) continue
          const face = intOf(entry?.characterFacialExpression)
          const slot = `Chara${position}`
          chars.set(slot, { op: 'spine', slot, kind: 'chara', skel: part.skel, atlas: part.atlas, anim: opt.facial[face] || '', loop: true, speed: 1, x: positionX[position] ?? opt.defaultX, action: intOf(entry?.characterAction) })
        }
        for (const [slot, spec] of chars) {
          emit({ ...spec })
          stats.spines += 1
          chars.set(slot, { ...spec, action: 0 })   // 动作只在这一帧做一次
        }
      }
    }

    // --- 声音 ---
    const bgm = cleanName(frame?.backgroundMusic)
    // noBGM{Fade_0.5,Delay_0}：停掉 BGM（花括号里是淡出秒数）
    const stop = rx.bgmStop?.exec(bgm)
    if (stop) {
      if (lastBgm) { emit({ op: 'bgmStop', fade: numOrNull(rx.bgmFade?.exec(stop[1] || '')?.[1]) ?? 0 }); lastBgm = '' }
    } else if (bgm && bgm !== lastBgm) { emit({ op: 'bgm', src: pick(paths.bgm, { name: bgm }) }); lastBgm = bgm }
    const se = cleanName(frame?.soundEffect)
    if (se) emit({ op: 'se', src: pick(paths.se, { name: se }) })
    const voice = cleanName(frame?.phraseVoice)
    if (voice && sceneId) emit({ op: 'voice', src: pick(paths.voice, { scene: sceneId, name: voice }) })

    // --- 说话人 / 台词 ---
    const rawName = str(frame?.speakerName)
    const name = (rawName === opt.userPlaceholder ? username : rawName).trim()
    if (name !== speaker) { emit({ op: 'speaker', segments: name ? [{ text: name }] : [] }); speaker = name }
    const line = str(frame?.phraseContents).replace(/\\n/g, '\n').trim()
    emit({ op: 'text', segments: line ? [{ text: line }] : [] })

    stats.commands += commands.length
    steps.push({ index: frameIndex, commands })
  })
  return { steps, stats }
}

// 体检：没读到名称表（角色名 / 标题会缺）/ 剧情没有缩略图关联
export function health(ctx) {
  const out = []
  const files = ctx.opts?.files || DEFAULT_OPTIONS.files
  if (!ctx.master.chars.size) out.push({ code: 'master-chars-missing', message: `没读到 Masterdata/${files.characters}：角色名显示 ???（检查 adapterOptions.root 是不是 Imported 目录）` })
  if (!ctx.master.scenarios.length) out.push({ code: 'master-scenes-missing', message: `没读到 Masterdata/${files.scenarios}：剧情标题显示剧情 id` })
  if (!ctx.scenes.size) out.push({ code: 'no-scenes', message: 'scenes/ 下没有剧情 JSON' })
  return out
}
export const tenkeiprdxJsonAdapter = { id: ADAPTER_ID, health, label: 'Tenkeiprdx 剧情 JSON', sniff, parse, contextFiles, contextDirs, prepare, catalog }
