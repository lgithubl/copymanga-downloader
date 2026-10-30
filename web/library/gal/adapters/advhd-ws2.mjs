// 适配器：WillPlus AdvHD 引擎（ADVPlayerHD）的剧情脚本（.ws2，由 containers.mjs 从 .arc 里读出来、解成 JSON 文本）→ 规范场景（gal-scene/1）。
// id = advhd::ws2：引擎家族 advhd 的脚本适配器，家族里所有游戏（game.id = advhd::<游戏>）共用；游戏之间的差别只在 config（adapterOptions['advhd::ws2'] + containers 规则），不写死游戏。
//
// 输入（advhd-ws2-decode.mjs 解出来的指令流）：{"format":"advhd-ws2/1","arc","name","size","truncated"?,"ins":[[偏移, 指令名, 参数[, 选项表 | 图片 id 表]]…]}。
// 指令含义的依据：社区的 ws2 指令表（DarthFly/advhd_ws2_tools，名字和参数个数）+ 对 LPSL 全部 153 个剧情脚本的统计 / 逐条对照；哪些是推断见下面「推断」。
// 映射（全部可以用 adapterOptions['advhd::ws2'] 改，见 DEFAULT_OPTIONS）：
//   DisplayMessage(id, 'char', 文本)            → text（%K %P 等控制符去掉，{汉字:ふりがな} = ruby，\n = 换行）；SetDisplayName('%LC名字') → speaker（空 = 旁白）
//   SoundEffect(通道, 文件)                      → 通道名按 channels 规则：char* = voice，bgv* = bgvoice（循环背景人声），其余 = se；PlayMusic = bgm，StopMusic = bgmStop
//   SetBackground(图层, 文件)                    → 图层按 layers 规则分角色：bg / ev（事件图 = bg 的 over）/ st；EF_BLACK / EF_WHITE 这类纯色图 = bg.color（colorImages）
//   UsePnaPackage(图层, 包名) + DisplayCharacterImage(图层, …, 图片 id 表) + MoveBackground(图层, …, x, y, …) → stand（按图层一个 slot）：包 = containers 展开的 <包名>.pna/{index.json,<帧 id>.png}，画 id 表里的帧
//   ClearLayer(图层 | *) 清图层；Unk65 = 一次「提交画面」（图层变更在这里生效，f32 第 1 个 = 渐变秒数）；PlayMovie → movie（在索引里找同名视频）
//   ShowChoice → choice；选项的跳转是本脚本的偏移（jump 6）→ 每个选项一段带 when 的分支，汇合点之后不带 when；跳转是文件名（jump 7）→ 记进 stats.links（播放器没有「换脚本」，选项只是展示）
//   Jump / Jump2 跟随；Condition(类型, 变量, 值, p1, p2) 按 flags / conditions 求值：成立 = 顺着往下，不成立 = p1（else 块）或 p2（结尾）（SetFlag / ExecuteFunction 的 setFlag 在本脚本里设过的变量按设的值；没有值的变量按 flags.values 默认，再没有按 flags.unknown，默认 = 真）；
//   ConditionalJump(a, b)：按 conditionalJump（默认取第二个目标 = 跳过动画）；FileEnd / NextFile = 结束（NextFile 的目标记进 stats.links）
//   ExecuteFunction(名字, 字符串, u16 标志号, byte) 按 functions 表：drop（不记）/ { setFlag: N }（函数把结果写进标志号，GetMsgSkip = 快进状态写 0）/ skip（不渲染，记 raw `ExecuteFunction:名字`、stats.skippedFunctions）；表里没有的名字 = default
//   不认识 / 没做的指令：ignoreOps 里的（布局 / 计时 / 内部状态）只计数（stats.ignored）；别的记 raw（stats.raw）——「立绘/特效等 N 条指令暂未渲染」和渲染诊断里能看到，哪个指令没做一目了然
// 推断（没有逆向 exe 的指令分发、没有立绘样本，下面这些是按数据猜的，都可以用 options 改）：
//   · Condition 的类型 2 / 128 / 129 / 130 = == / < / > / >=（社区文档也只写「相等、小于、大于、大于等于之类」，没确认哪个是哪个）。跳转的含义有数据证据：成立 = 往下走，不成立 = p1（else 块）或 p2（结尾）（263 处 p1、p2 都非零的 Condition 全是「真块 + Jump2 + 假块」）
//   · 标志 127 = 相册 / 回放模式（LegacyGame.lua 的 openConfirm：GetFlag(127) 为真时标题确认框换成相册版），正常阅读 = 0；标志 999 = GetMsgSkip 写的「正在快进」，正常阅读 = 0——两个默认值有 Lua 依据
//   · 0xAF 指令（解码器里 b4 + f4）、Unk65 的 f32 = 渐变秒数、MoveBackground 的 (x, y) = 图层左上角在舞台里的位置（舞台 1280×720）：都是按字节形状 / 数值范围猜的
//   · ConditionalJump 取第二个目标：样本里它后面总是同一个立绘的几帧小动画（带 SetTimer），第二个目标正好跳过它们
//   · PNA 帧里「type 0 = 图片、1 / 2 = 组开始 / 结束」来自 UI 包样本，立绘包没有样本；DisplayCharacterImage 的 id 表 = 要画的帧 id 是按名字 / 个数猜的
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader, safeRegex } from './options-merge.mjs'

export const ADAPTER_ID = 'advhd::ws2'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',   // containers 展开后的资源目录（相对媒体目录）；要和 config.containers.dir + resourceRoots 对上
  stage: [1280, 720],
  layers: [{ match: '^ev', role: 'ev' }, { match: '^bg', role: 'bg' }, { match: '^st', role: 'st' }],
  colorImages: [{ match: '^EF_BLACK', color: [0, 0, 0] }, { match: '^EF_WHITE', color: [255, 255, 255] }],
  channels: [{ match: '^char', as: 'voice' }, { match: '^bgv', as: 'bgvoice', volume: 1 }, { match: '^se', as: 'se' }],
  channelDefault: 'se',
  speaker: { strip: ['^%[A-Za-z]{1,3}'] },
  text: { strip: ['%[A-Za-z]'], newline: '\\n' },
  fade: { max: 10 },
  flags: { values: { 127: 0, 999: 0 }, unknown: true },
  conditions: { 2: '==', 128: '<', 129: '>', 130: '>=' },
  conditionalJump: 'second',
  functions: { default: 'skip', GetMsgSkip: { setFlag: 0 }, ArcGraphicOpenTest: { setFlag: 0 }, openCgBrowser: 'drop', openGallery: 'drop', openGalleryTitle: 'drop', openNmsSaveLoad: 'drop', openNameInput: 'drop', SetStopSkip: 'drop', openSceneSelect: 'drop', openCharSelect: 'drop' },
  skipFiles: ['^LAYER_ORDER$'],
  ignoreOps: ['Unk05', 'Unk08', 'Unk0A', 'Unk0D', 'Unk0E', 'Unk13', 'Unk16', 'Unk17', 'Unk19', 'Unk1B', 'Unk1D', 'Unk3D', 'Unk3E', 'Unk64', 'Unk68', 'UnkFB', 'UnkFC', 'UnkFD', 'LayerConfig', 'SetTimer', 'StartTimer', 'CharMessageStart', 'AddMessageToLog', 'InitKeyName', 'LayersList', 'SetFlag', 'SetVariable', 'VariableUnk', 'VariableUnk32', 'VariableUnk3', 'VariableUnk4', 'VariableUnk51', 'VariableUnk2', 'UnkBackground1', 'UnkBackground2', 'UnkBackground3', 'Unk42', 'Unk43', 'SoundUnk1', 'SoundUnk2', 'SoundEffectUnk30', 'MusicUnk1', 'ShowGraphic', 'SetMask', 'PrepareBackgroundArea', 'UnkScreen', 'Unk67', 'Unk97', 'UnkAF', 'UnkB0', 'SetPnaFile', 'Unk75', 'Unk78', 'Unk7A', 'Unk7B', 'Unk84', 'Unk4A', 'OpenTitle'],
  movie: { exts: ['mp4', 'webm', 'm4v', 'mov'] },
  audioExts: ['ogg', 'flac', 'wav', 'mp3'],
  imageExts: ['png', 'jpg', 'jpeg'],
  maxReach: 20000,
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"advhd-ws2\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 512))
export const explainSniff = () => '开头不是 {"format":"advhd-ws2/1"…（这个适配器吃 containers 从 .arc 里解出来的 .ws2 指令流，不是原始二进制）'

// ---------- 上下文：资源索引 + PNA 帧索引 ----------
export const contextFiles = () => []
export const contextDirs = (options) => [String(readOptions(options).resDir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')]
export const contextTextFilter = () => (rel) => /\.pna\/index\.json$/i.test(rel)
export const contextWalkLimit = 800000
export const contextSampleLimit = 20000

export function prepare({ options, files, texts, toResourcePath, resourceResolve, truncated }) {
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  const pnas = new Map()   // 小写的包名（带 .pna）→ { dir（资源路径）, width, height, frames: Map(id → 帧) }
  for (const rel of files || []) {
    if (/\.pna\/index\.json$/i.test(rel)) continue
    resources.add(toRes(rel))
  }
  let pnaBad = 0
  for (const [rel, text] of Object.entries(texts || {})) {
    const m = /^(.*\/([^/]+\.pna))\/index\.json$/i.exec(rel)
    if (!m) continue
    try {
      const data = JSON.parse(text)
      const frames = new Map()
      for (const frame of Array.isArray(data.frames) ? data.frames : []) if (frame && frame.type === 0 && typeof frame.file === 'string') frames.set(frame.id, frame)
      const entry = { dir: toRes(m[1]), width: Number(data.width) || 0, height: Number(data.height) || 0, frames }
      pnas.set(m[2].toLowerCase(), entry)
    } catch { pnaBad += 1 }   // 索引被截断 / 损坏：这个包当没有
  }
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  return { opts: opt, resources, resolver, pnas, pnaBad, hasIndex: Boolean(files?.length), truncated: Boolean(truncated) }
}

// ---------- 小工具 ----------
const FILE_ENDS = new Set(['FileEnd', 'NextFile', 'OpenTitle'])
const regexes = (list) => (Array.isArray(list) ? list : []).map((source) => safeRegex(source)).filter(Boolean)
const compiledCache = new WeakMap()
function compiled(opt) {
  if (compiledCache.has(opt)) return compiledCache.get(opt)
  const out = {
    layers: opt.layers.map((r) => ({ re: safeRegex(r?.match), role: String(r?.role || '') })).filter((r) => r.re && r.role),
    colors: opt.colorImages.map((r) => ({ re: safeRegex(r?.match), color: Array.isArray(r?.color) ? r.color.slice(0, 3).map((n) => Math.max(0, Math.min(255, Number(n) || 0))) : [0, 0, 0] })).filter((r) => r.re),
    channels: opt.channels.map((r) => ({ re: safeRegex(r?.match), as: String(r?.as || 'se'), volume: Number.isFinite(Number(r?.volume)) ? Number(r.volume) : 1 })).filter((r) => r.re),
    speakerStrip: regexes(opt.speaker.strip),
    textStrip: regexes(opt.text.strip).map((re) => new RegExp(re.source, 'gi')),
    skipFiles: regexes(opt.skipFiles),
    ignore: new Set(opt.ignoreOps),
    functions: new Map(Object.entries(opt.functions)),
  }
  compiledCache.set(opt, out)
  return out
}
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const nameOf = (file) => String(file || '').replace(/\\/g, '/').replace(/^.*\//, '')
const stemOf = (file) => nameOf(file).replace(/\.[^.]+$/, '')

// 文本：{汉字:ふりがな} → ruby 片段；%K / %P 等控制符去掉；字面的 \n（反斜杠 + n）= 换行
function segmentsOf(raw, opt, rx) {
  let textValue = String(raw ?? '')
  if (opt.text.newline) textValue = textValue.split(opt.text.newline).join('\n')
  for (const re of rx.textStrip) textValue = textValue.replace(re, '')
  const segments = []
  const ruby = /\{([^{}:]+):([^{}]*)\}/g
  let last = 0
  for (let m = ruby.exec(textValue); m; m = ruby.exec(textValue)) {
    if (m.index > last) segments.push({ text: textValue.slice(last, m.index) })
    segments.push({ text: m[1], ruby: m[2] })
    last = m.index + m[0].length
  }
  if (last < textValue.length) segments.push({ text: textValue.slice(last) })
  return segments.filter((s) => s.text !== '')
}

// ---------- 解析 ----------
export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  const rx = compiled(opt)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || data.format !== 'advhd-ws2/1' || !Array.isArray(data.ins)) throw new Error('不是 advhd-ws2/1 指令流')
  const list = data.ins.map((row) => ({ at: row[0], name: row[1], args: Array.isArray(row[2]) ? row[2] : [], extra: row[3] }))
  const byAt = new Map(list.map((ins, i) => [ins.at, i]))
  const stats = { instructions: list.length, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, raw: {}, ignored: {}, unresolved: {}, skippedFunctions: {}, links: {}, unvisited: 0 }
  if (data.truncated) stats.truncated = String(data.truncated).slice(0, 200)
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const hasIndex = Boolean(ctx?.hasIndex)

  // 资源：脚本里的名字（带扩展名）→ 索引里的路径；找不到按同名换扩展名再找
  const find = (name, exts) => {
    const wanted = nameOf(name)
    if (!wanted || !hasIndex) return ''
    let hit = ctx.resolver.resolveByName(wanted)
    if (hit) return hit
    const stem = stemOf(wanted)
    for (const ext of exts) { hit = ctx.resolver.resolveByName(`${stem}.${ext}`); if (hit) return hit }
    return ''
  }
  const pnaOf = (name) => (ctx?.pnas ? ctx.pnas.get(nameOf(name).toLowerCase()) || ctx.pnas.get(`${stemOf(name).toLowerCase()}.pna`) : null)

  // ---- 输出 ----
  const steps = []
  let commands = []
  let guard = []
  const emit = (command) => { commands.push(guard.length ? { ...command, when: guard } : command) }
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  // ---- 画面状态：图层表 + 「提交」时和已显示的比较，有变化才发指令 ----
  let layers = new Map()   // 图层名 → { kind: 'img'|'color'|'pna', src?, color?, pna?, ids?, x, y }
  let shown = { bg: null, stands: new Map() }
  let dirty = false
  let speaker = null
  let pendingName = ''
  let fadeSeconds = 0
  const roleOf = (layer) => rx.layers.find((r) => r.re.test(layer))?.role || ''

  function effectiveBg() {
    let bg = null
    let ev = null
    let color = null
    for (const [name, layer] of layers) {
      const role = roleOf(name)
      if (layer.kind === 'color') { if (role === 'st' || role === 'ev' || role === 'bg') color = { name, role, color: layer.color } }
      else if (layer.kind === 'img') { if (role === 'ev') ev = layer; else if (role === 'bg') bg = layer; else if (!bg) bg = layer }
    }
    if (color && (color.role === 'st' || !ev || color.role === 'ev')) return { color: color.color }
    if (ev && bg) return { src: bg.src, over: ev.src }
    if (ev) return { src: ev.src }
    if (bg) return { src: bg.src }
    return color ? { color: color.color } : null
  }
  function standParts(layer) {
    const entry = pnaOf(layer.pna)
    if (!entry) return null
    const [stageW, stageH] = opt.stage
    const parts = []
    for (const id of layer.ids || []) {
      const frame = entry.frames.get(id)
      if (!frame) { if (hasIndex) count('unresolved', `pna-frame:${layer.pna}#${id}`); continue }
      parts.push({ src: `${entry.dir}/${frame.file}`, x: Math.round(layer.x + frame.x + frame.w / 2 - stageW / 2), y: Math.round(layer.y + frame.y + frame.h / 2 - stageH / 2) })
    }
    return parts
  }
  function commit() {
    if (!dirty) return
    dirty = false
    const fade = Math.min(opt.fade.max, Math.max(0, fadeSeconds))
    fadeSeconds = 0
    const bg = effectiveBg()
    const sig = bg ? JSON.stringify(bg) : ''
    if (sig !== (shown.bg ?? '')) {
      if (bg) emit({ op: 'bg', ...bg, ...(fade ? { fade } : {}) })
      else if (shown.bg) emit({ op: 'bgoff', ...(fade ? { fade } : {}) })
      shown.bg = sig
    }
    const now = new Map()
    for (const [name, layer] of layers) if (layer.kind === 'pna') now.set(name, layer)
    for (const [slot, layer] of now) {
      const parts = standParts(layer)
      if (parts === null) { if (hasIndex && !shown.stands.has(`!${slot}:${layer.pna}`)) { count('unresolved', `pna:${layer.pna}`); shown.stands.set(`!${slot}:${layer.pna}`, '') } continue }
      const standSig = JSON.stringify(parts)
      if (shown.stands.get(slot) !== standSig) {
        if (parts.length) { emit({ op: 'stand', slot, parts, stage: opt.stage, ...(fade ? { fade } : {}) }); stats.stands += 1 }
        else emit({ op: 'standOff', slot })
        shown.stands.set(slot, standSig)
      }
    }
    for (const slot of [...shown.stands.keys()]) {
      if (slot.startsWith('!') || now.has(slot)) continue
      emit({ op: 'standOff', slot })
      shown.stands.delete(slot)
    }
  }
  const resetShown = () => { shown = { bg: null, stands: new Map() }; dirty = true }

  // ---- 控制流 ----
  const visited = new Set()
  const env = new Map()
  const flagValue = (id) => (env.has(id) ? env.get(id) : Object.hasOwn(opt.flags.values, String(id)) ? Number(opt.flags.values[String(id)]) : null)
  function condition(args) {
    const [kind, id, value] = args
    const op = opt.conditions[String(kind)]
    const left = flagValue(id)
    if (!op || left === null || !Number.isFinite(left)) return null
    switch (op) {
      case '==': return left === value
      case '!=': return left !== value
      case '<': return left < value
      case '>': return left > value
      case '>=': return left >= value
      case '<=': return left <= value
      default: return null
    }
  }
  // 从 start 往后能走到的所有偏移（Jump / Condition 两个出口 / ConditionalJump 两个出口 / 顺着往下），用来找选项分支的汇合点
  function reach(startIdx) {
    const seen = new Set()
    const stack = [startIdx]
    while (stack.length && seen.size < opt.maxReach) {
      let i = stack.pop()
      while (i !== undefined && i < list.length && !seen.has(i) && seen.size < opt.maxReach) {
        seen.add(i)
        const ins = list[i]
        if (FILE_ENDS.has(ins.name)) break
        if (ins.name === 'Jump' || ins.name === 'Jump2') { i = byAt.get(ins.args[0]); continue }
        if (ins.name === 'Condition' && ins.args.length >= 5) { const t = ins.args[3] || ins.args[4]; if (t && byAt.has(t)) stack.push(byAt.get(t)) }
        if (ins.name === 'ConditionalJump') { for (const t of ins.args) if (t && byAt.has(t)) stack.push(byAt.get(t)) }
        if (ins.name === 'ShowChoice') { for (const c of ins.extra || []) if (c.jump === 6 && byAt.has(c.target)) stack.push(byAt.get(c.target)); break }
        i += 1
      }
    }
    return seen
  }

  function message(ins) {
    commit()
    const body = segmentsOf(ins.args[2], opt, rx)
    stats.messages += 1
    let name = pendingName
    for (const re of rx.speakerStrip) name = name.replace(re, '')
    name = name.trim()
    if (name !== speaker) { emit({ op: 'speaker', segments: name ? [{ text: name }] : [] }); speaker = name }
    emit({ op: 'text', segments: body })
    endStep()
  }

  function sound(ins) {
    const [channel, file] = ins.args
    const rule = rx.channels.find((r) => r.re.test(String(channel)))
    const as = rule ? rule.as : opt.channelDefault
    const bucket = as === 'voice' || as === 'bgvoice' ? 'voices' : null
    if (bucket) stats.voices.referenced += 1
    const src = find(file, opt.audioExts)
    if (!src) {
      if (bucket) stats.voices.unresolved += 1
      if (hasIndex) count('unresolved', `${as}:${nameOf(file)}`)
      return
    }
    if (bucket) stats.voices.resolved += 1
    if (as === 'voice') emit({ op: 'voice', src })
    else if (as === 'bgvoice') emit({ op: 'bgvoice', slot: String(channel), src, volume: rule.volume })
    else emit({ op: 'se', src })
  }

  function exec(startIdx, stop) {
    let i = startIdx
    while (i !== undefined && i < list.length) {
      const ins = list[i]
      if (stop !== null && ins.at === stop) return 'merge'
      if (visited.has(ins.at)) return 'loop'
      visited.add(ins.at)
      const a = ins.args
      let next = i + 1
      switch (ins.name) {
        case 'Jump': case 'Jump2': next = byAt.has(a[0]) ? byAt.get(a[0]) : list.length; break
        case 'Condition': {
          // Condition(类型, 变量, 值, p1, p2)：条件成立 = 顺着往下走；不成立 = 有 p1（else 块的开头）就去 p1，没有就去 p2（整个 if 的结尾）。
          // 依据：样本里 263 处 p1、p2 都非零的 Condition 全是「真块 + Jump2 p2 + 假块（从 p1 开始）」的版式（253 处是 GetMsgSkip 之后的 StopMusic(0) / StopMusic(1)）；p1 = 0 的是「没有 else」的 if（跳到结尾）
          if (a.length >= 5) {
            const result = condition(a)
            const truth = result === null ? opt.flags.unknown !== false : result
            const target = truth ? 0 : a[3] || a[4]
            if (target) next = byAt.has(target) ? byAt.get(target) : list.length
            if (result === null) stats.ignored['Condition:unknown-flag'] = (stats.ignored['Condition:unknown-flag'] || 0) + 1
          }
          break
        }
        case 'ConditionalJump': {
          const target = opt.conditionalJump === 'first' ? a[0] : opt.conditionalJump === 'second' ? a[1] : 0
          if (target && byAt.has(target)) next = byAt.get(target)
          break
        }
        case 'SetFlag': env.set(a[0], a[1]); break
        case 'FileEnd': return 'end'
        case 'NextFile': count('links', `next:${a[0]}`); return 'end'
        case 'OpenTitle': return 'end'
        case 'RunFile': if (!rx.skipFiles.some((re) => re.test(String(a[0])))) { count('raw', `RunFile:${a[0]}`); emit({ op: 'raw', cmd: 'RunFile', args: [a[0]] }) } break
        case 'ClearLayer': {
          const target = String(a[0])
          if (target === '*') layers = new Map(); else layers.delete(target)
          dirty = true
          break
        }
        case 'SetBackground': {
          const [layer, file] = a
          const color = rx.colors.find((r) => r.re.test(nameOf(file)))
          if (color) layers.set(layer, { kind: 'color', color: color.color })
          else {
            stats.images.referenced += 1
            const src = find(file, opt.imageExts)
            if (src) { stats.images.resolved += 1; layers.set(layer, { kind: 'img', src }) } else { stats.images.unresolved += 1; if (hasIndex) count('unresolved', `image:${nameOf(file)}`); layers.delete(layer) }
          }
          dirty = true
          break
        }
        case 'UsePnaPackage': layers.set(a[0], { kind: 'pna', pna: a[1], ids: [], x: 0, y: 0 }); dirty = true; break
        case 'DisplayCharacterImage': { const layer = layers.get(a[0]); if (layer?.kind === 'pna') { layer.ids = Array.isArray(ins.extra) ? ins.extra : []; dirty = true } break }
        case 'MoveBackground': {
          const layer = layers.get(a[0])
          if (layer?.kind === 'pna') { layer.x = num(a[4]); layer.y = num(a[5]); dirty = true } else stats.ignored.MoveBackground = (stats.ignored.MoveBackground || 0) + 1
          break
        }
        case 'Unk65': fadeSeconds = Math.max(fadeSeconds, num(a[3])); commit(); break
        case 'SetDisplayName': pendingName = String(a[0] ?? ''); break
        case 'DisplayMessage': message(ins); break
        case 'SoundEffect': sound(ins); break
        case 'PlayMusic': {
          stats.bgm.referenced += 1
          const src = find(a[1], opt.audioExts)
          if (src) { stats.bgm.resolved += 1; emit({ op: 'bgm', src }) } else { stats.bgm.unresolved += 1; if (hasIndex) count('unresolved', `bgm:${nameOf(a[1])}`) }
          break
        }
        case 'StopMusic': emit({ op: 'bgmStop', fade: Math.min(10, Math.max(0, num(a[1]))) }); break
        case 'PlayMovie': {
          const stem = stemOf(a[1])
          const srcs = hasIndex ? opt.movie.exts.map((ext) => ctx.resolver.resolveByName(`${stem}.${ext}`)).filter(Boolean) : []
          if (srcs.length) emit({ op: 'movie', srcs, loop: false })
          else { count('raw', 'PlayMovie'); if (hasIndex) count('unresolved', `movie:${nameOf(a[1])}`); emit({ op: 'raw', cmd: 'PlayMovie', args: [a[1]] }) }
          break
        }
        case 'ExecuteFunction': {
          // ExecuteFunction(Lua 函数名, 字符串参数, u16 标志号, byte)：函数是游戏 Lua（LegacyGame.lua）里的全局函数。
          // functions 表：'drop' = 不记；{ setFlag: N } = 这个函数把结果写进「标志号」那个标志（GetMsgSkip = 现在是不是在快进，写 0；ArcGraphicOpenTest = 补丁标记图在不在，写 0），之后的 Condition 按它求值；
          // 别的（'skip'、表里没有的名字走 default）= 不渲染，记 raw ExecuteFunction:<名字> + stats.skippedFunctions
          const name = String(a[0])
          const mode = rx.functions.has(name) ? rx.functions.get(name) : rx.functions.get('default') || 'skip'
          if (mode && typeof mode === 'object' && Number.isFinite(Number(mode.setFlag))) { env.set(num(a[2]), Number(mode.setFlag)); stats.ignored[`ExecuteFunction:${name}`] = (stats.ignored[`ExecuteFunction:${name}`] || 0) + 1 }
          else if (mode !== 'drop') { count('skippedFunctions', name); count('raw', `ExecuteFunction:${name}`); emit({ op: 'raw', cmd: `ExecuteFunction:${name}`, args: a.slice(1, 3) }) }
          break
        }
        case 'ShowChoice': { return choice(ins, i) }
        default:
          if (rx.ignore.has(ins.name)) stats.ignored[ins.name] = (stats.ignored[ins.name] || 0) + 1
          else { count('raw', ins.name); emit({ op: 'raw', cmd: ins.name, args: a.slice(0, 8) }) }
      }
      i = next
    }
    return 'end'
  }

  function choice(ins) {
    commit()
    stats.choices += 1
    const options = (ins.extra || []).map((c, n) => ({ value: n + 1, segments: [{ text: String(c.text) }] }))
    // 选项挂在「问题那句台词」的步里（问题留在文本框里，选完直接进分支）；前面还有没发出去的指令（刚换了画面）/ 前一步不是台词时才自己一步（和别的适配器一样，带一句空台词）
    const prev = !commands.length && steps.length ? steps[steps.length - 1] : null
    const host = prev && prev.commands.some((c) => c.op === 'text' && c.segments.length) && !prev.commands.some((c) => c.op === 'choice') ? prev : null
    const stepIndex = host ? host.index : steps.length
    const variable = `sel${stepIndex}`
    const into = host ? host.commands : commands
    const put = (command) => into.push(guard.length ? { ...command, when: guard } : command)
    put({ op: 'choice', id: `${stepIndex}:${into.length}`, var: variable, options })
    if (!host) { put({ op: 'text', segments: [] }); endStep() }
    speaker = null
    const targets = (ins.extra || []).map((c) => (c.jump === 6 && byAt.has(c.target) ? byAt.get(c.target) : null))
    // 跳到别的脚本的选项（jump 7）：播放器没有「换脚本」，选了它就在这里结束——给一步提示（带 when），并且汇合后的内容对它不生效
    const links = []
    ;(ins.extra || []).forEach((c, n) => { if (c.jump === 7) { links.push(n + 1); count('links', `choice ${n + 1} 「${String(c.text).slice(0, 20)}」→ ${c.target}`) } })
    const outer = guard
    for (const [n, c] of (ins.extra || []).entries()) {
      if (c.jump !== 7) continue
      guard = [...outer, { var: variable, op: '==', value: n + 1 }]
      emit({ op: 'speaker', segments: [] })
      emit({ op: 'text', segments: [{ text: `（「${String(c.text)}」→ 脚本 ${String(c.target)} へ続く）` }] })
      endStep()
      speaker = ''
    }
    const local = targets.filter((t) => t !== null)
    if (!local.length) { guard = outer; return 'end' }
    // 汇合点：各分支能走到的偏移的交集里最靠前的那个；没有 = 分支各走各的、不汇合
    const reaches = local.map((t) => reach(t))
    let merge = null
    for (const at of [...reaches[0]].map((k) => list[k].at).sort((x, y) => x - y)) if (reaches.every((set) => set.has(byAt.get(at)))) { merge = at; break }
    const saved = new Map([...layers].map(([k, v]) => [k, { ...v }]))
    for (const [n, target] of targets.entries()) {
      if (target === null) continue
      layers = new Map([...saved].map(([k, v]) => [k, { ...v }]))
      resetShown()
      guard = [...outer, { var: variable, op: '==', value: n + 1 }]
      exec(target, merge)
      commit()
    }
    guard = [...outer, ...links.map((value) => ({ var: variable, op: '!=', value }))]
    if (merge === null) { guard = outer; return 'end' }
    resetShown()
    const result = exec(byAt.get(merge), null)
    guard = outer
    return result
  }

  exec(0, null)
  commit()
  // 没走到的指令（被条件 / 跳转绕开的）：只计数
  stats.unvisited = list.filter((ins) => !visited.has(ins.at)).length
  if (commands.length || !steps.length) { commands.push({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((n, step) => n + step.commands.length, 0)
  return { steps, stats }
}

export const advhdWs2Adapter = { id: ADAPTER_ID, label: 'WillPlus AdvHD（ws2 剧情，经 containers 展开）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
