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
// 资源目录来自 config.adapterOptions['bokusen-json']：{ root（游戏根，相对媒体目录，默认 ''）, resourceDir（默认 'resource'） }

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

  // 参数槽：数组按位置，对象按键；'nil' / null / 缺 = 没设（返回 ''）
  const slotOf = (group, i) => {
    const params = code.parameters[group]
    const value = Array.isArray(params) ? params[i] : params && typeof params === 'object' ? params[i] : undefined
    return value === null || value === undefined || NIL.has(String(value)) ? '' : String(value)
  }

  // images[i] / sounds[i] → 资源路径（相对资源根）；没有文件索引就按约定拼，有索引而找不到就返回 ''
  const found = (list, i, kind, exts) => {
    const entry = list[i]
    if (entry === undefined || entry === null) return ''
    const base = `${stem}/${kind}/${i}`
    if (!ctx?.hasIndex || !stem) return `${base}${exts[0]}`
    for (const ext of exts) if (ctx.resources.has(`${base}${ext}`)) return `${base}${ext}`
    return ctx.byBase.get(base) || ''
  }
  const entryName = (value) => String(value ?? '').split('?')[0]
  const imageOf = (i) => { const ext = extOf(entryName(images[i])) || '.jpg'; return found(images, i, 'images', [ext]) }
  const soundOf = (i) => { const ext = extOf(entryName(sounds[i])); return found(sounds, i, 'sounds', ext && ext !== '.wav' ? ['.wav', ext] : ['.wav']) }
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
  const pending = new Map()   // 层 → back 页上等 trans 的图 { src, x, y }
  const layers = new Map()    // 数字层 → { src, x, y, anim }
  const emitStand = () => {
    const ids = [...layers.keys()].sort((a, b) => Number(a) - Number(b))
    if (ids.length) { emit({ op: 'stand', parts: ids.map((id) => ({ src: layers.get(id).src, x: layers.get(id).x, y: layers.get(id).y })) }); stats.stands += 1 } else emit({ op: 'standOff' })
  }
  const showLayer = (layer, item) => {
    if (layer === 'base') emit({ op: 'bg', src: item.src, ...(item.frames ? { frames: item.frames } : {}), fade: item.fade || 0 })
    else { layers.set(layer, { src: item.src, x: item.x || 0, y: item.y || 0, anim: item.anim || '' }); emitStand() }
  }

  // ---- 声音 ----
  const loopBuffers = new Set()   // 正在循环的声道（bgse 只有一路）
  const bgmSource = () => {
    const i = sounds.findIndex((entry) => /\/bgm\//i.test(String(entry)))
    return soundOf(i >= 0 ? i : 0)
  }

  for (const entry of code.commands) {
    const tag = String(code.tags[Array.isArray(entry) ? entry[0] : -1] ?? '').toLowerCase()
    const group = Array.isArray(entry) ? entry[1] : -1
    const s = (i) => slotOf(group, i)
    switch (tag) {
      case 'articles': {
        const text = String(articles[indexOf(s(0), articles)] ?? '')
        const header = HEADER.exec(text.trim())
        if (header) { flush(); speaker = header[1].trim() } else line += text
        break
      }
      case 'r': closeLine(); break
      case 'p': flush(); break
      case 'cm': flush(); speaker = ''; break
      case 'image': {
        const layer = s(15) || 'base'
        const i = indexOf(s(28), images)
        if (i < 0) { rawOp('image', [`无效下标:${s(28)}`]); break }
        const src = imageOf(i)
        if (!src) { count('unresolved', `${layer === 'base' ? 'bg' : 'layer'}:${images[i]}`); break }
        const item = { src, x: num(s(16)), y: num(s(29)) }
        if (s(23) === 'back') pending.set(layer, item); else showLayer(layer, item)
        break
      }
      case 'trans': {
        const layer = s(2) || 'base'
        const item = pending.get(layer)
        if (!item) break
        pending.delete(layer)
        if (s(3) && s(3) !== 'cross') count('raw', `trans:${s(3)}`)
        showLayer(layer, { ...item, fade: layer === 'base' ? num(s(6)) / 1000 : 0 })
        break
      }
      case 'move': {
        const layer = s(2)
        const m = /\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(s(4))
        const item = layers.get(layer)
        if (!m || !item) { rawOp('move', [layer, s(4)]); break }
        if (num(m[3]) <= 0) layers.delete(layer); else { item.x = num(m[1]); item.y = num(m[2]) }
        emitStand()
        break
      }
      case 'animstart': {
        const layer = s(2) || 'base'
        const wanted = s(9).split(/\s+/).filter(Boolean).map((value) => indexOf(value, images)).filter((i) => i >= 0)
        const frames = wanted.map(imageOf).filter(Boolean)
        if (!frames.length) { count('unresolved', `anim:${s(0)}`); break }
        if (frames.length < wanted.length) count('unresolved', `anim-missing:${s(0)}`)
        if (layer === 'base') showLayer('base', { src: frames[0], ...(frames.length > 1 ? { frames } : {}) })
        else {
          showLayer(layer, { src: frames[0], x: num(s(3)), anim: s(0) })
          if (frames.length > 1) rawOp('animstart', [`多帧立绘:${s(0)}`, `${frames.length}帧`])
        }
        break
      }
      case 'animstop': {   // 立绘层的动画停了就去掉那一层；base 层的帧动画不停（换背景才停）
        let changed = false
        for (const [id, item] of layers) if (s(0) !== '' && item.anim === s(0)) { layers.delete(id); changed = true }
        if (changed) emitStand()
        break
      }
      case 'playse': {
        const i = indexOf(s(2), sounds)
        const src = i >= 0 ? soundOf(i) : ''
        if (!src) { count('unresolved', `se:${s(2)}`); break }
        if (s(1) === 'true') { emit({ op: 'bgse', src, loop: true }); loopBuffers.add(s(0)) }
        else if (/\/voice\//i.test(String(sounds[i]))) emit({ op: 'voice', src })
        else emit({ op: 'se', src })
        break
      }
      case 'stopse':
        if (loopBuffers.delete(s(0))) emit({ op: 'bgseStop' })
        break
      case 'fadese':   // 淡到 0 = 停掉循环声；淡到别的音量播放器没有对应指令
        if (num(s(2)) <= 0 && loopBuffers.delete(s(0))) emit({ op: 'bgseStop' })
        else if (num(s(2)) > 0) count('raw', 'fadese')
        break
      case 'playbgm': {
        const src = bgmSource()
        if (src) emit({ op: 'bgm', src }); else count('unresolved', 'bgm')
        break
      }
      case 'fadeoutbgm': emit({ op: 'bgmStop', fade: num(s(0)) / 1000 }); break
      case 'wait': if (num(s(2)) > 0) emit({ op: 'wait', seconds: num(s(2)) / 1000 }); break
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
