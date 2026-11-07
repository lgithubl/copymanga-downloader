// 适配器：Artemis 引擎的剧情脚本（.ast = Lua 表，astver = 2.0；由 containers.mjs 从 pf8 档案里解密、原样展开成文本）→ 规范场景（gal-scene/1）。
// id = artemis::ast：引擎家族 artemis 的脚本适配器，家族里所有游戏（game.id = artemis::<游戏>）共用；游戏之间的差别只在 config（adapterOptions['artemis::ast'] + containers 规则）。
//
// 依据：采集的真实游戏（g13，83 个剧本）。脚本结构：
//   astver / astname / ast = { block_00000 = { {命令…}, text = { vo = { {"vo", file, ch} }, ja = { { name = {说话人…}, "一行文字", {"rt2"}, … } } }, select = { ja = { 选项文字… } }, linknext, linkback }, …, label = { top = { block } } }
//   命令 = { "名字", 键 = 值 … }；{"text"} 标记「这里显示文字」；{"rt2"} = 一行结束
// 映射（全部可以用 adapterOptions['artemis::ast'] 改，见 DEFAULT_OPTIONS）：
//   text.ja[…] → speaker（name 的最后一项，没有 = 旁白）+ text（rt2 之间换行）；text.vo → voice（sound/vo/<ch>/ 或 sound/vobin/<ch>/ 下按文件名找）
//   bg（file + path）→ bg：path 的 ":bg/" → image/bg/、":ev/<组>/" → image/ev/<组>/ …；black / white 找不到文件时 = 纯色
//   fg（mode = 2，ch / file / face / x）→ stand；mode = -2 → standOff
//   bgm（file | stop）→ bgm / bgmStop；se（file）→ se；ex（func = wait）→ wait
//   select（每个 {"select", file} = 一个选项跳去的脚本，文字在 block.select.ja）→ choice + 带 when 的 goto
//   excall（file）：整个脚本最后一个 block 里的 = scene.next（接着播）；别的只记 stats.links
// 推断（没有对照画面，都可以用 options 改）：
//   · 立绘：游戏本身用 E-mote（image/fg/*.psb，30~67MB 一个，浏览器放不了），这里改用 image/fg/_blog/<file>/<face>.png（和脚本里 file / face 一一对上，样本里 3209 次使用全部有对应的 png）当立绘；真实图（v1.6 采集）是 576×324、透明背景的 16:9 半身像（角色大约在画框中间偏左、表情已经画好），所以按铺满 1920 宽的设计画面放大（zoom 1920 / 576）、底边对齐；位置（x）没有游戏截图对照
//   · fg 的 x（±280 / ±150 …）按「相对画面中心的偏移（1280 舞台像素，×1.5 换成设计坐标）」处理（没有对照）；mx / size / lv / id / always（动作）不用；mode = 1 / -1 的含义不明，忽略
//   · bg 带 id（>= 1）= 叠在主背景上的图层（cinema 黑边 / 白闪 / sd 小人）→ overlay（槽 bg<id>）；bg 不带 id（主背景）会删掉所有立绘和图层（face=1 除外）；fg mode = -1 删这个角色；cgdel（id = -1 全部 / id = N）去图层——依据 system/image/image_bg.lua 的 image_view / cgdel_main
//   · extrans / quake / flash / fgf / fgact / scene / evset 等记进 stats.ignored，不渲染
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader, safeRegex } from './options-merge.mjs'

export const ADAPTER_ID = 'artemis::ast'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  stage: [1280, 720],
  colorImages: [{ match: '^black$', color: [0, 0, 0] }, { match: '^white$', color: [255, 255, 255] }],
  speaker: { strip: [] },
  imageDirs: { bg: 'image/bg', ev: 'image/ev', sd: 'image/sd', sys: 'image/sys' },   // path 前缀 ":xx/…" → 目录
  imageExts: ['png', 'jpg', 'jpeg', 'webp'],
  videoExts: ['ogv', 'webm', 'mp4'],   // bg 找不到图时按同名找视频（ev_*_m01_* 是 .ogv 动态事件图）→ movie（循环）
  audioExts: ['ogg', 'flac', 'wav', 'mp3'],
  bgmDir: 'sound/bgm',
  seDir: 'sound/se',
  voiceDirs: ['sound/vo', 'sound/vobin'],
  stand: { enabled: true, dir: 'image/fg/_blog', ext: 'png', align: 'center', useX: true, zoom: 3.3333, xScale: 1.5 },   // _blog 图 576×324（16:9 的半身像画框）：放大到铺满 1920 宽的设计画面（1920 / 576）；脚本里的 x 是 1280 舞台的像素，×1.5 换成设计坐标
  emote: { enabled: true, dir: 'image/fg', ext: 'emote.psb', xScale: 1.5, view: 'bust', zoom: 0.72, top: 0.04 },   // E-mote 立绘（FreeMote WebGL SDK 在浏览器里播）：模型 = containers 转好的 image/fg/<file>.emote.psb；播放器「更多」里的 E-mote 开关关了就用上面的静态立绘。view: bust（半身，按 zoom 缩放、头顶留 top 比例）| full（整身塞进舞台）；zoom = 每个单位多少设计像素（半身框；psb 一个单位 ≈ 1 像素的图集像素）；x 用 xScale 换成设计像素
  layers: { enabled: true, cover: '^(white|black)$', maxFade: 5 },   // bg 带 id（>= 1）= 叠在主背景上的图层（cinema 黑边 / 白闪 / sd 小人 …），不是换背景；cover = 铺满舞台的纯色图（其余按原大小居中）；cgdel 去掉
  wait: { enabled: true, max: 10 },
  extraDirs: [],
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*astver\s*=/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 256))
export const explainSniff = () => '开头不是 astver = …（这个适配器吃 containers 从 pf8 里解密出来的 Artemis .ast 脚本）'

export const contextFiles = () => []
export const contextDirs = (options) => { const opt = readOptions(options); return [opt.resDir, ...opt.extraDirs].map((dir) => String(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean) }
export const contextTextFilter = () => () => false
export const contextWalkLimit = 800000
export const contextSampleLimit = 20000

export function prepare({ options, files, toResourcePath, resourceResolve, truncated }) {
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  for (const rel of files || []) resources.add(toRes(rel))
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  return { opts: opt, resources, resolver, hasIndex: Boolean(files?.length), truncated: Boolean(truncated) }
}

// ---------- Lua 表解析（只认 ast 用到的子集：表 / 字符串 / 数字 / true false nil / 标识符；注释） ----------
export class LuaTable {
  constructor() { this.list = []; this.map = new Map() }
  get(key) { return this.map.get(key) }
}
export function parseLua(text) {
  const src = String(text)
  const n = src.length
  let i = 0
  const fail = (msg) => { throw new Error(`Lua 解析：${msg}（第 ${src.slice(0, i).split('\n').length} 行）`) }
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++
      if (src[i] === '-' && src[i + 1] === '-') { while (i < n && src[i] !== '\n') i++; continue }
      return
    }
  }
  const ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v', 0: '\0' }
  const readString = (quote) => {
    i++
    let out = ''
    while (i < n && src[i] !== quote) {
      if (src[i] === '\\') {
        i++
        const c = src[i]
        if (/[0-9]/.test(c) && c !== '0') { let d = ''; while (d.length < 3 && /[0-9]/.test(src[i])) d += src[i++]; out += String.fromCharCode(Number(d)); continue }
        out += c in ESC ? ESC[c] : c
        i++
      } else out += src[i++]
    }
    if (i >= n) fail('字符串没有结束')
    i++
    return out
  }
  const readValue = () => {
    skip()
    const c = src[i]
    if (c === '{') return readTable()
    if (c === '"' || c === "'") return readString(c)
    const m = /^(?:-?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|[A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i, i + 64))
    if (!m) fail(`看不懂的字符 ${JSON.stringify(c)}`)
    i += m[0].length
    const t = m[0]
    if (t === 'true') return true
    if (t === 'false') return false
    if (t === 'nil') return null
    if (/^[-\d.]/.test(t)) return Number(t)
    return { ident: t }
  }
  const readTable = () => {
    i++
    const table = new LuaTable()
    for (;;) {
      skip()
      if (i >= n) fail('表没有结束')
      if (src[i] === '}') { i++; return table }
      if (src[i] === ',' || src[i] === ';') { i++; continue }
      // 键 = 值：标识符 / [表达式] 后面跟 =（不是 ==）
      const save = i
      let key
      if (src[i] === '[') {
        i++
        key = readValue()
        skip()
        if (src[i] !== ']') fail('缺 ]')
        i++
        skip()
        if (src[i] !== '=') fail('缺 =')
        i++
        table.map.set(key, readValue())
        continue
      }
      const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 128))
      if (id) {
        i += id[0].length
        skip()
        if (src[i] === '=' && src[i + 1] !== '=') { i++; table.map.set(id[0], readValue()); continue }
        i = save
      }
      table.list.push(readValue())
    }
  }
  const root = new LuaTable()
  for (;;) {
    skip()
    if (i >= n) break
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 128))
    if (!id) fail('顶层应该是 名字 = 值')
    i += id[0].length
    skip()
    if (src[i] !== '=') fail('顶层缺 =')
    i++
    root.map.set(id[0], readValue())
  }
  return root
}

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const isTable = (v) => v instanceof LuaTable
const cmdName = (t) => (isTable(t) && typeof t.list[0] === 'string' ? t.list[0] : '')
const param = (t, key) => t.map.get(key)
const strParam = (t, key) => { const v = param(t, key); return typeof v === 'string' ? v : '' }

const compiledCache = new WeakMap()
function compiled(opt) {
  if (compiledCache.has(opt)) return compiledCache.get(opt)
  const out = {
    colors: opt.colorImages.map((r) => ({ re: safeRegex(r?.match, 'i'), color: Array.isArray(r?.color) ? r.color.slice(0, 3).map((x) => Math.max(0, Math.min(255, Number(x) || 0))) : [0, 0, 0] })).filter((r) => r.re),
    speakerStrip: (Array.isArray(opt.speaker.strip) ? opt.speaker.strip : []).map((s) => safeRegex(s)).filter(Boolean),
    layerCover: safeRegex(opt.layers.cover, 'i'),
  }
  compiledCache.set(opt, out)
  return out
}

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  const rx = compiled(opt)
  let root
  try { root = parseLua(String(text || '').replace(/^﻿/, '')) } catch (error) { throw new Error(error.message || '不是有效的 Lua 表') }
  const ast = root.get('ast')
  if (!isTable(ast)) throw new Error('没有 ast 表')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { events: 0, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, raw: {}, ignored: {}, unresolved: {}, links: {}, blocks: { total: 0, walked: 0 } }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const nameOf = (file) => String(file || '').replace(/\\/g, '/').replace(/^.*\//, '')
  const find = (candidates, exts) => {
    if (!hasIndex) return ''
    for (const base of candidates) {
      if (!base) continue
      let hit = ctx.resolver.resolve(base)
      if (hit) return hit
      for (const ext of exts) { hit = ctx.resolver.resolve(`${base}.${ext}`); if (hit) return hit }
    }
    return ''
  }
  const findByName = (name, exts) => {
    const wanted = nameOf(name)
    if (!wanted || !hasIndex) return ''
    let hit = ctx.resolver.resolveByName(wanted)
    if (hit) return hit
    for (const ext of exts) { hit = ctx.resolver.resolveByName(`${wanted}.${ext}`); if (hit) return hit }
    return ''
  }
  const colorOf = (name) => rx.colors.find((r) => r.re.test(name))?.color || null

  const steps = []
  let commands = []
  let nextScript = ''
  const emit = (command) => commands.push(command)
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  // ---- 画面状态：视觉变化在发台词那一刻提交 ----
  let bgState = null
  let stands = new Map()   // ch → { parts, x }
  let overlays = new Map()   // 槽（bg<id>）→ overlay 指令
  let shown = { bg: null, stand: null, overlays: new Map() }
  let dirty = false
  function commit() {
    if (!dirty) return
    dirty = false
    const sig = bgState ? JSON.stringify(bgState) : ''
    if (sig !== (shown.bg ?? '')) {
      if (bgState?.movie) emit({ op: 'movie', srcs: [bgState.movie], loop: true })
      else {
        if (shown.movieOn) emit({ op: 'movieOff' })
        if (bgState) emit({ op: 'bg', ...bgState })
        else if (shown.bg) emit({ op: 'bgoff' })
      }
      shown.movieOn = Boolean(bgState?.movie)
      shown.bg = sig
    }
    const parts = []
    for (const [, stand] of [...stands].sort((a, b) => a[1].x - b[1].x)) for (const part of stand.parts) parts.push(part)
    const standSig = JSON.stringify(parts)
    if (standSig !== (shown.stand ?? '[]')) {
      if (parts.length) { emit({ op: 'stand', parts }); stats.stands += 1 } else emit({ op: 'standOff' })
      shown.stand = standSig
    }
    for (const slot of [...shown.overlays.keys()]) if (!overlays.has(slot)) { emit({ op: 'overlayOff', slot }); shown.overlays.delete(slot) }
    for (const [slot, spec] of overlays) {
      const sig = JSON.stringify(spec)
      if (shown.overlays.get(slot) === sig) continue
      emit(spec)
      shown.overlays.set(slot, sig)
    }
  }

  const imageRef = (found, name) => {
    stats.images.referenced += 1
    if (found) { stats.images.resolved += 1; return { src: found } }
    stats.images.unresolved += 1
    if (hasIndex) count('unresolved', `image:${name}`)
    return null
  }
  // path ":bg/" / ":ev/<组>/" → image/bg/ / image/ev/<组>/
  const imageDirOf = (p) => {
    const m = /^:([A-Za-z0-9_]+)\/(.*)$/.exec(String(p || ''))
    if (!m) return ''
    const base = opt.imageDirs[m[1]] || `image/${m[1]}`
    return `${base}/${m[2]}`.replace(/\/+$/, '')
  }

  // 引擎（system/image/image_bg.lua image_view）：bg 不带 id（= 0）是主背景——换它会把所有立绘删掉（fgdelall）并重置所有图层（reset_bg），除非 face=1；
  // 带 id（>= 1）是叠在上面的图层（no = id + 1 > 1），不动立绘，由 cgdel（id = -1 全部 / id = N 一个）去掉
  function onLayerBg(cmd, id, file) {
    if (!opt.layers.enabled) { count('ignored', 'bg:layer'); return }
    const dir = imageDirOf(strParam(cmd, 'path'))
    const hit = find([dir ? `${dir}/${file}` : ''], opt.imageExts) || findByName(file, opt.imageExts)
    const img = imageRef(hit, file)
    if (!img) return
    const alpha = param(cmd, 'alpha') ?? param(cmd, 'a')
    const slot = `bg${id}`
    const spec = { op: 'overlay', slot, src: img.src, ...(rx.layerCover?.test(file) ? { fit: 'cover' } : {}), z: num(param(cmd, 'lv'), 5) }
    if (alpha !== undefined) spec.alpha = Math.max(0, Math.min(1, num(alpha, 255) / 255))
    const time = num(param(cmd, 'time'), 0)
    if (!overlays.has(slot) && time > 2) spec.fade = Math.min(opt.layers.maxFade, time / 1000)
    overlays.set(slot, spec)
    dirty = true
  }
  function onCgdel(cmd) {
    const id = num(param(cmd, 'id'), -1)
    if (id === -1) { if (overlays.size) { overlays = new Map(); dirty = true } return }
    if (overlays.delete(`bg${id}`)) dirty = true
  }
  function onBg(cmd) {
    const file = strParam(cmd, 'file')
    if (!file) return
    const layerId = num(param(cmd, 'id'), 0)
    if (layerId >= 1) { onLayerBg(cmd, layerId, file); return }
    if (num(param(cmd, 'face'), 0) !== 1) { if (stands.size || overlays.size) dirty = true; stands = new Map(); overlays = new Map() }
    const dir = imageDirOf(strParam(cmd, 'path'))
    const hit = find([dir ? `${dir}/${file}` : ''], opt.imageExts) || findByName(file, opt.imageExts)
    if (hit) bgState = imageRef(hit, file)
    else if (find([dir ? `${dir}/${file}` : ''], opt.videoExts) || findByName(file, opt.videoExts)) {
      const video = find([dir ? `${dir}/${file}` : ''], opt.videoExts) || findByName(file, opt.videoExts)
      stats.images.referenced += 1; stats.images.resolved += 1; stats.videos = (stats.videos || 0) + 1
      bgState = { movie: video }
    } else {
      const solid = colorOf(file)
      if (solid) bgState = { color: solid }
      else bgState = imageRef('', file)
    }
    dirty = true
  }
  function onFg(cmd) {
    const mode = num(param(cmd, 'mode'), 0)
    if (mode === -2) { if (stands.size) { stands = new Map(); dirty = true } return }
    if (mode === -1) { if (stands.delete(strParam(cmd, 'ch') || strParam(cmd, 'file'))) dirty = true; return }   // 删这个角色的立绘（mx / time 的滑出动画不做）
    if (mode !== 2 || !opt.stand.enabled) { count('ignored', `fg:mode=${mode}`); return }
    const ch = strParam(cmd, 'ch') || strParam(cmd, 'file')
    const file = strParam(cmd, 'file')
    const face = strParam(cmd, 'face')
    if (!file || !face) { count('ignored', 'fg:nofile'); return }
    const src = find([`${opt.stand.dir}/${file}/${face}.${opt.stand.ext}`], [])
    const img = imageRef(src, `${file}/${face}`)
    if (!img) return
    const x = opt.stand.useX && Number.isFinite(Number(param(cmd, 'x'))) ? num(param(cmd, 'x')) : 0
    const shiftX = Math.round(x * opt.stand.xScale)
    let emote = null
    if (opt.emote.enabled) {
      const psb = find([`${opt.emote.dir}/${file}.${opt.emote.ext}`], [])
      stats.emote = stats.emote || { referenced: 0, resolved: 0 }
      stats.emote.referenced += 1
      if (psb) {
        stats.emote.resolved += 1
        const always = strParam(cmd, 'always')
        emote = { slot: ch, src: psb, main: always, diff: face, x: Math.round(x * opt.emote.xScale), view: opt.emote.view, zoom: opt.emote.zoom, top: opt.emote.top }
      }
    }
    stands.set(ch, { parts: [{ src: img.src, align: opt.stand.align, ...(opt.stand.zoom && opt.stand.zoom !== 1 ? { zoom: opt.stand.zoom } : {}), ...(shiftX ? { shiftX } : {}), ...(emote ? { emote } : {}) }], x })
    dirty = true
  }
  function onSound(name, cmd) {
    if (name === 'bgm') {
      const file = strParam(cmd, 'file')
      if (file) {
        stats.bgm.referenced += 1
        const hit = find([`${opt.bgmDir}/${file}`], opt.audioExts) || findByName(file, opt.audioExts)
        if (hit) { stats.bgm.resolved += 1; emit({ op: 'bgm', src: hit }) } else { stats.bgm.unresolved += 1; if (hasIndex) count('unresolved', `bgm:${file}`) }
      } else if (num(param(cmd, 'stop')) === 1) emit({ op: 'bgmStop', fade: Math.min(10, num(param(cmd, 'time')) / 1000) })
    } else {
      const file = strParam(cmd, 'file')
      if (!file) { count('ignored', 'se:stop'); return }
      const hit = find([`${opt.seDir}/${file}`], opt.audioExts) || findByName(file, opt.audioExts)
      if (hit) emit({ op: 'se', src: hit }); else if (hasIndex) count('unresolved', `se:${file}`)
    }
  }
  function voiceOf(vo) {
    const file = strParam(vo, 'file')
    const ch = strParam(vo, 'ch')
    if (!file) return
    stats.voices.referenced += 1
    const hit = find(opt.voiceDirs.map((d) => `${d}/${ch}/${file}`), opt.audioExts) || findByName(file, opt.audioExts)
    if (hit) { stats.voices.resolved += 1; emit({ op: 'voice', src: hit }) } else { stats.voices.unresolved += 1; if (hasIndex) count('unresolved', `voice:${file}`) }
  }

  const lineOf = (entry) => {
    const parts = []
    let line = ''
    for (const item of entry.list) {
      if (typeof item === 'string') line += item
      else if (isTable(item) && cmdName(item) === 'rt2') { parts.push(line); line = '' }
    }
    if (line) parts.push(line)
    return parts.join('\n')
  }
  function onText(block) {
    const textTable = block.get('text')
    if (!isTable(textTable)) return false
    const ja = textTable.get('ja')
    const vos = textTable.get('vo')
    const entries = isTable(ja) ? ja.list.filter(isTable) : []
    if (!entries.length) return false
    commit()
    entries.forEach((entry, k) => {
      const vo = isTable(vos) ? vos.list.filter(isTable)[k] : null
      if (vo && cmdName(vo) === 'vo') voiceOf(vo)
      const nameTable = entry.get('name')
      let who = isTable(nameTable) ? String(nameTable.list.filter((v) => typeof v === 'string').at(-1) || '') : ''
      for (const re of rx.speakerStrip) who = who.replace(re, '')
      emit({ op: 'speaker', segments: who ? [{ text: who }] : [] })
      const body = lineOf(entry)
      emit({ op: 'text', segments: body ? [{ text: body }] : [] })
      stats.messages += 1
      endStep()
    })
    return true
  }
  function onSelect(block, selects) {
    const options = block.get('select')?.get?.('ja')
    const texts = isTable(options) ? options.list.filter((v) => typeof v === 'string') : []
    const targets = selects.map((c) => strParam(c, 'file')).filter(Boolean)
    if (!texts.length) { count('ignored', 'select:notext'); return }
    commit()
    stats.choices += 1
    const prev = !commands.length && steps.length ? steps[steps.length - 1] : null
    const host = prev && prev.commands.some((c) => c.op === 'text' && c.segments.length) && !prev.commands.some((c) => c.op === 'choice') ? prev : null
    const stepIndex = host ? host.index : steps.length
    const variable = `sel${stepIndex}`
    const into = host ? host.commands : commands
    into.push({ op: 'choice', id: `${stepIndex}:${into.length}`, var: variable, options: texts.map((t, n) => ({ value: n + 1, segments: [{ text: t }] })) })
    if (!host) { into.push({ op: 'text', segments: [] }); endStep() }
    targets.forEach((script, n) => {
      count('links', `select:${script}`)
      if (n < texts.length) emit({ op: 'goto', script, when: [{ var: variable, op: '==', value: n + 1 }] })
    })
    if (commands.length) { emit({ op: 'text', segments: [] }); endStep() }
  }

  // ---- 走 block 链：从 label.top.block 起沿 linknext ----
  const blocks = new Map()
  for (const [key, value] of ast.map) if (key !== 'label' && isTable(value)) blocks.set(key, value)
  stats.blocks.total = blocks.size
  const labels = ast.get('label')
  const top = isTable(labels) && isTable(labels.get('top')) ? labels.get('top').get('block') : null
  let key = typeof top === 'string' && blocks.has(top) ? top : [...blocks.keys()][0]
  const seen = new Set()
  while (key && blocks.has(key) && !seen.has(key)) {
    seen.add(key)
    stats.blocks.walked += 1
    const block = blocks.get(key)
    const selects = []
    let textDone = false
    let lastExcall = ''
    for (const item of block.list) {
      const name = cmdName(item)
      if (!name) continue
      stats.events += 1
      if (name === 'text') { if (!textDone) { textDone = true; if (selects.length) { onSelect(block, selects); selects.length = 0 } else onText(block) } }
      else if (name === 'rt2') continue
      else if (name === 'bg') onBg(item)
      else if (name === 'fg') onFg(item)
      else if (name === 'cgdel') onCgdel(item)
      else if (name === 'bgm' || name === 'se') onSound(name, item)
      else if (name === 'ex') { if (strParam(item, 'func') === 'wait') { if (opt.wait.enabled) { const seconds = Math.min(opt.wait.max, num(param(item, 'time')) / 1000); if (seconds > 0) emit({ op: 'wait', seconds }) } } else count('ignored', `ex:${strParam(item, 'func')}`) }
      else if (name === 'select') selects.push(item)
      else if (name === 'excall') { const file = strParam(item, 'file'); if (file) { lastExcall = file; count('links', `excall:${file}`) } }
      else count('ignored', name)
    }
    if (selects.length) onSelect(block, selects)
    if (!textDone) onText(block)   // 没有 {"text"} 标记但有 text 表（保险）
    const next = block.get('linknext')
    if (lastExcall && !(typeof next === 'string' && blocks.has(next))) nextScript = lastExcall
    key = typeof next === 'string' ? next : ''
  }
  commit()
  if (commands.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((total, step) => total + step.commands.length, 0)
  return { steps, stats, ...(nextScript ? { next: { script: nextScript } } : {}) }
}

export const artemisAstAdapter = { id: ADAPTER_ID, label: 'Artemis（.ast，经 containers 从 pf8 展开）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
