// 适配器：ぼくらの放課後戦争（bokusen，KAG / Tyrano 风格脚本编译成的 JSON 表）→ 规范场景（gal-scene/1）。
// 脚本 JSON = { data: { code: { images: [文件名…], sounds: [文件名…], articles: [文本…], characters, tags: [标签名…], parameters: [[槽位值…]…], commands: [[标签下标, 参数组下标, 顺序]…] } } }（可能有 BOM）。
// 标签表是每个文件自带的：永远用 tags[标签下标] 取名字，不假定固定下标。parameters 里每组是按槽位排的数组，'nil' = 没设；commands 的第三项（顺序）单调不减（= 源码行号）。
// 槽位含义（样本 1888 个文件里没有反例的；带「未证实」的是推测）：
//   articles  0 = articles[] 的下标。文本是 【说话人】 标题行 和 「台词」 行；和 r（换行）/ p（等点击）/ cm（清文本框）交错
//   image     15 = 层（base = 背景层，数字 = 立绘 / 叠加层）  23 = 页（fore 立刻显示 | back 先放后台，等 trans）  28 = images[] 下标  16 = x 偏移  29 = y 偏移  22 = 未证实（0/100/150/200/255，像不透明度，忽略）
//   trans     2 = 层  3 = 方式（只见过 cross）  6 = 毫秒；把该层 back 页的图换成前台（背景 = 交叉淡入）
//   move      2 = 层  4 = 目标 "(x y 不透明度)"  6 = 毫秒（只取终点，不做补间；不透明度 0 = 去掉该层）
//   animstart 0 = 动画 id  1 = 15（未证实：帧率）  2 = 层  3 = x  5 = 循环  8 = 页  9 = 帧下标列表（空格分隔，images[] 的下标）  4 / 6 / 7 / 10 / 11 = 未证实
//   animstop  0 = 动画 id
//   playse    0 = 声道  1 = 循环  2 = sounds[] 下标      stopse 0 = 声道      fadese 0 = 声道  1 = 毫秒  2 = 目标音量      seopt 0 = 声道  3 = 音量（忽略）
//   playbgm   0 = 循环  1 = 0（未证实）；没有曲子下标，取 sounds[] 里路径带 /bgm/ 的第一个，没有就取第 0 个（未证实）      bgmopt 1 = 音量（忽略）      fadeoutbgm 0 = 毫秒
//   wait      2 = 毫秒      wt / wm / wf / wb = 等待（忽略）
// 资源（磁盘上，相对资源根 = <游戏根>/resource）：images[i] ↔ <脚本文件名>/images/<i><images[i] 的扩展名>；sounds[i] ↔ <脚本文件名>/sounds/<i>.wav（列表里写 .m4a，磁盘上是 .wav：先找 .wav 再找列表里的扩展名）。
//   1888 个脚本里只有 826 个有资源目录——没有就不报错：缺的图 / 声音记进 stats.unresolved，台词照常出。
// 表达：base 层图 → bg（trans cross = 带 fade 的 bg）；数字层 → stand（按层号叠放，part 带 x / y）；base 层多帧 animstart → bg + frames（和 Aku 的帧动画一样）；
//   循环的 playse → bgse / stopse → bgseStop，不循环的 → se（路径带 /voice/ 的 → voice）；playbgm → bgm；fadeoutbgm → bgmStop；wait → wait。
//   说不出来的（数字层多帧动画、非 0 目标的 fadese、非 cross 的 trans、move 到没有的层）→ raw 指令 + stats.raw。
// 没做：move 的补间（直接到终点）、立绘多帧动画、bgmopt / seopt 的音量、animstart 的 4 / 6 / 7 / 10 / 11 槽、animstop 对 base 层帧动画（不停，换背景才停）。
// 参数全部来自 config.adapterOptions['bokusen-json']（meta.options / prepare 的 options）；下面是完整的结构和默认值——默认值 = 上面写的「样本里的行为」，不配就和以前一样。
// 适配器本身只读配置、按配置匹配；所有「猜的」东西（槽位号、路径模板、正则）都在这张表里，猜错了改配置，不改代码（管理员脚本 gal-layout 的 LAYOUTS 表写这些）：
//   root: ''                         游戏根（相对媒体目录）          resourceDir: 'resource'   资源目录名
//   paths: {                         资源路径模板（相对资源根），按顺序试，第一个在文件索引里找到的生效；{stem} = 脚本文件名  {i} = 下标  {ext} = 下面的候选扩展名（逐个展开）  {name} = 列表里的文件名
//     images: ['{stem}/images/{i}{ext}'],   sounds: ['{stem}/sounds/{i}{ext}'],
//     anyExt: true }                 模板都没命中时，忽略扩展名再按序号找一次（以前的 byBase 行为）
//   image: { ext: ['{entry}'], defaultExt: '.jpg' }        图的候选扩展名：'{entry}' = 列表里写的扩展名（没写用 defaultExt）
//   sound: { ext: ['.wav', '{entry}'], defaultExt: '' }    声音的候选扩展名：先 .wav 再列表里的（磁盘上是 .wav，列表里写 .m4a）
//   slotMap: { <标签>: { <字段>: <槽位号 | null> } }        按位置的参数槽；null = 不读这个字段。只写要改的字段，其余用默认：
//     articles{index:0}  image{layer:15,page:23,index:28,x:16,y:29}  trans{layer:2,mode:3,ms:6}  move{layer:2,target:4}  animstart{id:0,layer:2,x:3,page:8,frames:9}  animstop{id:0}
//     playse{buffer:0,loop:1,index:2}  stopse{buffer:0}  fadese{buffer:0,volume:2}  playbgm{index:null}（null = 没有曲子下标，用 bgm.patterns）  fadeoutbgm{ms:0}  wait{ms:2}
//   bgm: { patterns: ['/bgm/'], index: 0 }       playbgm 选哪个 sounds[]：第一个路径匹配任一正则的；都不匹配取 index（数字；'first' = 0）
//   voice: { patterns: ['/voice/'], loopAsBgse: true }   不循环的 playse 路径匹配任一正则 → voice，否则 se；loopAsBgse：循环的 playse → bgse / stopse → bgseStop（false = 当普通 se，不管循环）
//   stand: { layers: [], overlayLayers: [], bgLayers: ['base'], xScale: 1, yScale: 1, origin: { x: 0, y: 0 }, moveMode: 'jump' }
//     bgLayers：这些层是背景；layers：数字层里哪些是立绘（[] = 除 overlayLayers 外全部）；overlayLayers：叠加层（没有对应的场景指令，记 raw + stats.raw）；
//     part 的 x / y = 脚本值 × xScale / yScale + origin；moveMode：'jump' = move 直接到终点（默认）；'tween'：场景格式没有立绘补间指令，不支持（按 jump 处理）
//   animation: { singleFrameAsStatic: true, multiFrameLayers: ['base'] }
//     multiFrameLayers：多帧动画能表达成 bg + frames 的层（其它层只显示第一帧 + raw）；singleFrameAsStatic：false = 单帧的 animstart 也记 raw（默认当静态图）。帧率是播放器的设置，场景没有 fps 字段。
// 文件索引里的查找走 createIndexResolver：config.resourceResolve（扩展名回退 / 改写 / unicode / 大小写 / preferDirs）自动生效；没配就是精确匹配 + 忽略大小写兜底。

import { createIndexResolver } from '../resolve.mjs'
import { compileSafeRegex } from '../voice.mjs'

export const ADAPTER_ID = 'bokusen-json'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const clean = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
const rootOf = (options) => clean(options?.root)
const resourceDirOf = (options) => clean(options?.resourceDir ?? 'resource') || 'resource'

// 只看开头（列表嗅探只读 8KB，images / sounds / articles 在 tags 之前，所以只认 data.code 的开头）；绝不抛错
const HEAD = /^\s*\{\s*"data"\s*:\s*\{\s*"code"\s*:\s*\{\s*"(?:images|sounds|articles|characters|tags|parameters|commands)"\s*:/
export function sniff(text) {
  try { return HEAD.test(String(text ?? '').replace(/^﻿/, '').slice(0, 8192)) } catch { return false }
}

// ---------- 上下文：resource 目录的文件索引 ----------
export const contextFiles = () => []
export const contextDirs = (options) => [joinPath(rootOf(options), resourceDirOf(options))]
export const contextWalkLimit = 1000000   // 826 个资源目录 × 每个几十到几百个文件，默认的 40 万不够稳

const extOf = (name) => (/\.[A-Za-z0-9]+$/.exec(String(name || '')) || [''])[0].toLowerCase()
const noExt = (name) => String(name).replace(/\.[A-Za-z0-9]+$/, '')

export function prepare({ options, files, toResourcePath }) {
  const toRes = toResourcePath || ((rel) => rel)
  const prefix = `${joinPath(rootOf(options), resourceDirOf(options))}/`
  const resources = new Set()
  const byBase = new Map()   // 去掉扩展名的资源路径 → 资源路径（扩展名对不上时按序号找）
  for (const rel of files || []) {
    let res = toRes(rel)
    if (res.startsWith(prefix)) res = res.slice(prefix.length)   // 资源根没配成 resource 目录时自己去掉前缀
    resources.add(res)
    if (!byBase.has(noExt(res))) byBase.set(noExt(res), res)
  }
  return { resources, byBase, hasIndex: Boolean(files?.length) }
}

// ---------- 参数（只读配置，补满默认值；同一个 options 对象只算一次）----------
const DEFAULT_SLOTS = {
  articles: { index: 0 },
  image: { layer: 15, page: 23, index: 28, x: 16, y: 29 },
  trans: { layer: 2, mode: 3, ms: 6 },
  move: { layer: 2, target: 4 },
  animstart: { id: 0, layer: 2, x: 3, page: 8, frames: 9 },
  animstop: { id: 0 },
  playse: { buffer: 0, loop: 1, index: 2 },
  stopse: { buffer: 0 },
  fadese: { buffer: 0, volume: 2 },
  playbgm: { index: null },
  fadeoutbgm: { ms: 0 },
  wait: { ms: 2 },
}
// 完整的默认参数表（= 上面注释里的结构 + 不配时的行为）。gal-layout 的 ADAPTER_RULES 抄一份写进条目 config；scripts/dev/gal-layout-rules-selftest.mjs 保证两边一致
export const DEFAULT_OPTIONS = {
  root: '',
  resourceDir: 'resource',
  paths: { images: ['{stem}/images/{i}{ext}'], sounds: ['{stem}/sounds/{i}{ext}'], anyExt: true },
  image: { ext: ['{entry}'], defaultExt: '.jpg' },
  sound: { ext: ['.wav', '{entry}'], defaultExt: '' },
  slotMap: structuredClone(DEFAULT_SLOTS),
  bgm: { patterns: ['/bgm/'], index: 0 },
  voice: { patterns: ['/voice/'], loopAsBgse: true },
  stand: { layers: [], overlayLayers: [], bgLayers: ['base'], xScale: 1, yScale: 1, origin: { x: 0, y: 0 }, moveMode: 'jump' },
  animation: { singleFrameAsStatic: true, multiFrameLayers: ['base'] },
}
const isObj = (value) => value && typeof value === 'object' && !Array.isArray(value)
const strList = (value, fallback) => (Array.isArray(value) ? value.map(String).filter(Boolean) : fallback)
const regexList = (value, fallback) => {
  const out = []
  for (const source of strList(value, fallback)) { try { const re = compileSafeRegex(source, { flags: 'i', label: 'bokusen pattern' }); if (re) out.push(re) } catch { /* 不合格的丢掉 */ } }
  return out
}
const numOr = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback)
const settingsCache = new WeakMap()
function settingsOf(options) {
  const o = isObj(options) ? options : {}
  if (settingsCache.has(o)) return settingsCache.get(o)
  const slots = {}
  for (const [tag, fields] of Object.entries(DEFAULT_SLOTS)) {
    slots[tag] = { ...fields }
    for (const [field, slot] of Object.entries(isObj(o.slotMap?.[tag]) ? o.slotMap[tag] : {})) if (field in fields && (slot === null || Number.isInteger(slot) || /^\d+$/.test(String(slot)))) slots[tag][field] = slot === null ? null : Number(slot)
  }
  const stand = isObj(o.stand) ? o.stand : {}
  const bgm = isObj(o.bgm) ? o.bgm : {}
  const voice = isObj(o.voice) ? o.voice : {}
  const anim = isObj(o.animation) ? o.animation : {}
  const paths = isObj(o.paths) ? o.paths : {}
  const out = {
    slots,
    paths: { images: strList(paths.images, ['{stem}/images/{i}{ext}']), sounds: strList(paths.sounds, ['{stem}/sounds/{i}{ext}']), anyExt: paths.anyExt !== false },
    ext: {
      images: { list: strList(o.image?.ext, ['{entry}']), defaultExt: String(o.image?.defaultExt ?? '.jpg') },
      sounds: { list: strList(o.sound?.ext, ['.wav', '{entry}']), defaultExt: String(o.sound?.defaultExt ?? '') },
    },
    bgm: { patterns: regexList(bgm.patterns, ['/bgm/']), index: bgm.index === 'first' ? 0 : Math.max(0, Math.floor(numOr(bgm.index, 0))) },
    voice: { patterns: regexList(voice.patterns, ['/voice/']), loopAsBgse: voice.loopAsBgse !== false },
    stand: {
      layers: strList(stand.layers, []), overlayLayers: strList(stand.overlayLayers, []), bgLayers: strList(stand.bgLayers, ['base']),
      xScale: numOr(stand.xScale, 1), yScale: numOr(stand.yScale, 1), originX: numOr(stand.origin?.x, 0), originY: numOr(stand.origin?.y, 0),
    },
    animation: { singleFrameAsStatic: anim.singleFrameAsStatic !== false, multiFrameLayers: strList(anim.multiFrameLayers, ['base']) },
  }
  settingsCache.set(o, out)
  return out
}

// 内存索引的查找器（ctx 重建就换新的；config.resourceResolve 变了也换）
const resolverCache = new WeakMap()
function resolverOf(ctx, cfg) {
  let hit = resolverCache.get(ctx)
  if (!hit || hit.cfg !== cfg) { hit = { cfg, resolver: createIndexResolver({ index: ctx.resources, cfg }) }; resolverCache.set(ctx, hit) }
  return hit.resolver
}

// ---------- 解析 ----------
const NIL = new Set(['nil', 'null', 'undefined'])
const num = (value, fallback = 0) => { const n = Number.parseFloat(value); return Number.isFinite(n) ? n : fallback }
const HEADER = /^【([^】]*)】$/

// 容错解析：BOM、尾部多余字符都先试着剥掉；还是不行就抛一个明确的错（列表页会当「解析失败」列出来，不会炸）
function parseJson(text) {
  const raw = String(text ?? '').replace(/^﻿/, '').trim()
  try { return JSON.parse(raw) } catch { /* 往下试 */ }
  const end = raw.lastIndexOf('}')
  if (end > 0) { try { return JSON.parse(raw.slice(0, end + 1)) } catch { /* 往下 */ } }
  throw new Error('不是有效的 JSON')
}

export function parse(text, ctx = null, meta = {}) {
  const code = parseJson(text)?.data?.code
  if (!code || !Array.isArray(code.commands) || !Array.isArray(code.tags) || !Array.isArray(code.parameters)) throw new Error('找不到 data.code 的 tags / parameters / commands（不是 bokusen 的剧情 JSON）')
  const images = Array.isArray(code.images) ? code.images : []
  const sounds = Array.isArray(code.sounds) ? code.sounds : []
  const articles = Array.isArray(code.articles) ? code.articles : []
  const stem = String(meta?.stem || '')
  const stats = { rows: code.commands.length, commands: 0, raw: {}, unresolved: {}, stands: 0 }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }

  const st = settingsOf(meta?.options)
  const resolver = ctx?.hasIndex && stem ? resolverOf(ctx, meta?.config?.resourceResolve) : null

  // 参数槽：数组按位置，对象按键；'nil' / null / 缺 = 没设（返回 ''）
  const slotOf = (group, i) => {
    if (i === null || i === undefined) return ''
    const params = code.parameters[group]
    const value = Array.isArray(params) ? params[i] : params && typeof params === 'object' ? params[i] : undefined
    return value === null || value === undefined || NIL.has(String(value)) ? '' : String(value)
  }

  // images[i] / sounds[i] → 资源路径（相对资源根）：按 paths 模板 × 候选扩展名逐个试；没有文件索引就取第一个候选，有索引而找不到就返回 ''
  const entryName = (value) => String(value ?? '').split('?')[0]
  const found = (list, i, kind) => {
    const entry = list[i]
    if (entry === undefined || entry === null) return ''
    const { list: extList, defaultExt } = st.ext[kind]
    const own = extOf(entryName(entry)) || defaultExt
    const exts = [...new Set(extList.map((e) => (e === '{entry}' ? own : e)).filter(Boolean))]
    const candidates = []
    for (const template of st.paths[kind]) {
      const fill = (ext) => template.replace(/\{(stem|i|name|ext)\}/g, (_, key) => ({ stem, i: String(i), name: entryName(entry), ext })[key])
      for (const candidate of /\{ext\}/.test(template) ? exts.map(fill) : [fill('')]) if (!candidates.includes(candidate)) candidates.push(candidate)
    }
    if (!resolver) return candidates[0] || ''
    for (const candidate of candidates) { const hit = resolver.resolve(candidate); if (hit) return hit }
    if (st.paths.anyExt) for (const candidate of candidates) { const hit = ctx.byBase.get(noExt(candidate)); if (hit) return hit }
    return ''
  }
  const imageOf = (i) => found(images, i, 'images')
  const soundOf = (i) => found(sounds, i, 'sounds')
  const indexOf = (value, list) => { const n = Number.parseInt(value, 10); return Number.isInteger(n) && n >= 0 && n < list.length ? n : -1 }

  const steps = []
  let commands = []
  const emit = (command) => commands.push(command)
  const rawOp = (cmd, args) => { count('raw', cmd); emit({ op: 'raw', cmd, args }) }

  // ---- 台词：articles 逐条累积，r 换行，p 出一步，cm 清文本框 ----
  let line = ''
  let lines = []
  let speaker = ''           // 当前说话人（【名字】 标题行设置，cm 清掉）
  let shownSpeaker = null    // 已经发给播放器的说话人
  const closeLine = () => { if (line.trim()) lines.push(line.trim()); line = '' }
  const flush = () => {
    closeLine()
    if (!lines.length) return
    if (shownSpeaker !== speaker) { emit({ op: 'speaker', segments: speaker ? [{ text: speaker }] : [] }); shownSpeaker = speaker }
    emit({ op: 'text', segments: [{ text: lines.join('\n') }] })
    lines = []
    stats.commands += commands.length
    steps.push({ index: steps.length, commands })
    commands = []
  }

  // ---- 画面：背景 + 数字层立绘 ----
  const { stand: sc, voice: vc, animation: ac } = st
  const isBg = (layer) => sc.bgLayers.includes(layer)
  const isOverlay = (layer) => sc.overlayLayers.includes(layer) || (sc.layers.length > 0 && !sc.layers.includes(layer))
  const pending = new Map()   // 层 → back 页上等 trans 的图 { src, x, y }
  const layers = new Map()    // 立绘层 → { src, x, y, anim }
  const emitStand = () => {
    const ids = [...layers.keys()].sort((a, b) => Number(a) - Number(b))
    const part = (id) => ({ src: layers.get(id).src, x: layers.get(id).x * sc.xScale + sc.originX, y: layers.get(id).y * sc.yScale + sc.originY })
    if (ids.length) { emit({ op: 'stand', parts: ids.map(part) }); stats.stands += 1 } else emit({ op: 'standOff' })
  }
  const showLayer = (layer, item) => {
    if (isBg(layer)) emit({ op: 'bg', src: item.src, ...(item.frames ? { frames: item.frames } : {}), fade: item.fade || 0 })
    else if (isOverlay(layer)) rawOp('layer', [`叠加层:${layer}`, item.src])
    else { layers.set(layer, { src: item.src, x: item.x || 0, y: item.y || 0, anim: item.anim || '' }); emitStand() }
  }

  // ---- 声音 ----
  const loopBuffers = new Set()   // 正在循环的声道（bgse 只有一路）
  const bgmSource = (pickedIndex) => {
    let i = indexOf(pickedIndex, sounds)
    if (i < 0) i = sounds.findIndex((entry) => st.bgm.patterns.some((re) => re.test(String(entry))))
    return soundOf(i >= 0 ? i : st.bgm.index)
  }

  for (const entry of code.commands) {
    const tag = String(code.tags[Array.isArray(entry) ? entry[0] : -1] ?? '').toLowerCase()
    const group = Array.isArray(entry) ? entry[1] : -1
    const m = DEFAULT_SLOTS[tag] ? st.slots[tag] : {}
    const s = (field) => slotOf(group, m[field])   // 标签的命名槽位（slotMap 可改）
    switch (tag) {
      case 'articles': {
        const text = String(articles[indexOf(s('index'), articles)] ?? '')
        const header = HEADER.exec(text.trim())
        if (header) { flush(); speaker = header[1].trim() } else line += text
        break
      }
      case 'r': closeLine(); break
      case 'p': flush(); break
      case 'cm': flush(); speaker = ''; break
      case 'image': {
        const layer = s('layer') || 'base'
        const i = indexOf(s('index'), images)
        if (i < 0) { rawOp('image', [`无效下标:${s('index')}`]); break }
        const src = imageOf(i)
        if (!src) { count('unresolved', `${isBg(layer) ? 'bg' : 'layer'}:${images[i]}`); break }
        const item = { src, x: num(s('x')), y: num(s('y')) }
        if (s('page') === 'back') pending.set(layer, item); else showLayer(layer, item)
        break
      }
      case 'trans': {
        const layer = s('layer') || 'base'
        const item = pending.get(layer)
        if (!item) break
        pending.delete(layer)
        if (s('mode') && s('mode') !== 'cross') count('raw', `trans:${s('mode')}`)
        showLayer(layer, { ...item, fade: isBg(layer) ? num(s('ms')) / 1000 : 0 })
        break
      }
      case 'move': {
        const layer = s('layer')
        const target = /\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(s('target'))
        const item = layers.get(layer)
        if (!target || !item) { rawOp('move', [layer, s('target')]); break }
        if (num(target[3]) <= 0) layers.delete(layer); else { item.x = num(target[1]); item.y = num(target[2]) }   // moveMode 只有 jump：场景没有立绘补间指令
        emitStand()
        break
      }
      case 'animstart': {
        const layer = s('layer') || 'base'
        const wanted = s('frames').split(/\s+/).filter(Boolean).map((value) => indexOf(value, images)).filter((i) => i >= 0)
        const frames = wanted.map(imageOf).filter(Boolean)
        if (!frames.length) { count('unresolved', `anim:${s('id')}`); break }
        if (frames.length < wanted.length) count('unresolved', `anim-missing:${s('id')}`)
        const multi = frames.length > 1
        const asFrames = multi && ac.multiFrameLayers.includes(layer) && isBg(layer)
        if (!multi && !ac.singleFrameAsStatic) { rawOp('animstart', [`单帧动画:${s('id')}`, layer]); break }
        showLayer(layer, { src: frames[0], ...(asFrames ? { frames } : {}), ...(isBg(layer) ? {} : { x: num(s('x')), anim: s('id') }) })
        if (multi && !asFrames) rawOp('animstart', [`多帧动画:${s('id')}`, `${frames.length}帧`])
        break
      }
      case 'animstop': {   // 立绘层的动画停了就去掉那一层；背景层的帧动画不停（换背景才停）
        let changed = false
        for (const [id, item] of layers) if (s('id') !== '' && item.anim === s('id')) { layers.delete(id); changed = true }
        if (changed) emitStand()
        break
      }
      case 'playse': {
        const i = indexOf(s('index'), sounds)
        const src = i >= 0 ? soundOf(i) : ''
        if (!src) { count('unresolved', `se:${s('index')}`); break }
        if (s('loop') === 'true' && vc.loopAsBgse) { emit({ op: 'bgse', src, loop: true }); loopBuffers.add(s('buffer')) }
        else if (s('loop') !== 'true' && vc.patterns.some((re) => re.test(String(sounds[i])))) emit({ op: 'voice', src })
        else emit({ op: 'se', src })
        break
      }
      case 'stopse':
        if (loopBuffers.delete(s('buffer'))) emit({ op: 'bgseStop' })
        break
      case 'fadese':   // 淡到 0 = 停掉循环声；淡到别的音量播放器没有对应指令
        if (num(s('volume')) <= 0 && loopBuffers.delete(s('buffer'))) emit({ op: 'bgseStop' })
        else if (num(s('volume')) > 0) count('raw', 'fadese')
        break
      case 'playbgm': {
        const src = bgmSource(s('index'))
        if (src) emit({ op: 'bgm', src }); else count('unresolved', 'bgm')
        break
      }
      case 'fadeoutbgm': emit({ op: 'bgmStop', fade: num(s('ms')) / 1000 }); break
      case 'wait': if (num(s('ms')) > 0) emit({ op: 'wait', seconds: num(s('ms')) / 1000 }); break
      case 'bgmopt': case 'seopt': case 'wt': case 'wm': case 'wf': case 'wb': break   // 音量 / 等待：不影响内容
      default: count('raw', `tag:${tag || '?'}`)
    }
  }
  flush()
  if (commands.length) {
    if (steps.length) { steps[steps.length - 1].commands.push(...commands); stats.commands += commands.length } else { steps.push({ index: 0, commands: [...commands, { op: 'text', segments: [] }] }); stats.commands += commands.length }
  }
  return { steps, stats }
}

export const bokusenJsonAdapter = { id: ADAPTER_ID, label: 'ぼくらの放課後戦争（bokusen）编译脚本 JSON', sniff, parse, contextFiles, contextDirs, contextWalkLimit, prepare }
