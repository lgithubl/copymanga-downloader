// 适配器：友恵の探偵物語（TinkerBell 引擎，tomoe.exe；game.id = tomoe::<游戏>）的剧本（Arc04.dat 的记录流，由 containers 按 ML 记录切成章节 JSON tomoe-arc04/1，format: tomoe）→ 规范场景（gal-scene/1）。
// 指令（对照 tomoe.exe 反汇编 + 引擎自带测试脚本 + 真实 Arc04.dat 的 68611 条记录；统计见 README）：
//   ['T', 文本]：一行文字（连续的 T = 同一行折行，每段末尾的 \n 是折行不是换行）；ÿÿ<注音长度><注音><正文长度><正文> = 注音（ルビ）
//   ['#', 87]：行末等点击；['#', 70]：页末（点击后清页）
//   ['#', 43, 声音号, 声道]：语音（声道 = 说话人序号，见选项 speakers）；['#', 46, 声音号]：音效；['#', 114, 声音号]：循环音效（-1 = 停）；['#', 131, n, -1]：BGM（声音号 = 6018 + n；n = -1 停）
//   ['$', 204, 1, a, 图号, b, 层, 1]：在「层」上显示图（图号 ≥ 816 = 清掉这一层）；['#', 29, 2] … ['#', 13, 2]：画面切换（淡入淡出）的开始 / 提交
//   层：132 / 120 / 127 / 117 / 121 / 9999 = 背景（Data000 的 JPEG / 位图）；2 / 140 / 141 / 4 = 叠在上面的图层（CG / 补丁）。带遮罩的补丁图（<编号>.p.png）盖在这一层原来的整张图上；整张图换掉这一层的整张图
// 没处理：选项（#134 … #136，只在调试菜单里）、跳转 / 变量（#1 #2 #3 #8 #10，剧情是一条线）、#150 #66 #132 #54 #100 …（作用不明，记在 stats.ignored）
// 没验证（没有游戏截图对照）：层的叠放顺序（按 overlayZ）、补丁盖在哪一层、图号 817 / 818 当「清空」用、切换时间；章节切分和章节的先后（c01… 按在文件里的顺序）
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'tomoe::arc04'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  imgDir: 'img',
  sndDir: 'snd',
  stage: [1920, 1080],
  bgLayers: [132, 120, 127, 117, 121, 9999],
  overlayZ: { 2: 10, 140: 20, 141: 30, 4: 40 },   // 叠加层的层号 → z（越大越靠上）；补丁 +1
  clearFrom: 816,                                  // 图号 >= 这个 = 清空这一层
  bgmBase: 6018,                                   // BGM n → 声音号 bgmBase + n
  fade: 0.5,                                       // 画面切换的淡入淡出秒数
  pageLimit: 12,                                   // 一页最多累计几行（防止没有页末记号时无限变长）
  speakers: { 1: '友恵', 2: '真由美', 3: '依子', 4: '聡子', 5: 'えみり', 6: '豊子', 7: 'れいか', 8: '宇佐美', 9: '直美', 10: 'プリン', 11: 'のぞみ', 12: 'るい子', 13: 'みちる', 14: 'さおり', 15: '香子', 16: 'ユイナ', 17: 'カフェ店員', 18: '純代', 19: '恵子', 20: 'かおり', 21: 'じゅん子', 22: 'えりな', 23: 'ちひろ' },
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"tomoe-arc04\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 256))
export const explainSniff = () => '开头不是 {"format":"tomoe-arc04/1"…（这个适配器吃 containers 从 Arc04.dat 切出来的章节，不是原始 Arc04.dat）'
export const contextFiles = () => []
export const contextDirs = (options) => [String(readOptions(options).resDir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')].filter(Boolean)
export const contextTextFilter = () => () => false
export const contextWalkLimit = 800000
export const contextSampleLimit = 0

export function prepare({ options, files, toResourcePath, resourceResolve, truncated }) {
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  for (const rel of files || []) resources.add(toRes(rel))
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  return { opts: opt, resources, resolver, hasIndex: Boolean(files?.length), truncated: Boolean(truncated) }
}

// 一行文字 → 片段（ÿÿ<注音长度><注音><正文长度><正文> → { text: 正文, ruby: 注音 }）
export function lineSegments(line) {
  const segments = []
  let buf = ''
  const src = String(line)
  let i = 0
  while (i < src.length) {
    if (src.charCodeAt(i) === 0xff && src.charCodeAt(i + 1) === 0xff && i + 2 < src.length) {
      const rubyLen = src.charCodeAt(i + 2)
      const ruby = src.slice(i + 3, i + 3 + rubyLen)
      const baseAt = i + 3 + rubyLen
      const baseLen = src.charCodeAt(baseAt)
      const base = src.slice(baseAt + 1, baseAt + 1 + baseLen)
      if (rubyLen > 0 && baseLen > 0 && ruby.length === rubyLen && base.length === baseLen) {
        if (buf) { segments.push({ text: buf }); buf = '' }
        segments.push({ text: base, ruby })
        i = baseAt + 1 + baseLen
        continue
      }
    }
    buf += src[i]
    i += 1
  }
  if (buf) segments.push({ text: buf })
  return segments
}

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (data?.format !== 'tomoe-arc04/1' || !Array.isArray(data.events)) throw new Error('不是 tomoe-arc04/1 剧情')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { events: data.events.length, messages: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, sounds: { referenced: 0, resolved: 0, unresolved: 0 }, ignored: {}, unresolved: {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const find = (rel, exts) => {
    if (!hasIndex) return ''
    for (const ext of exts) { const hit = ctx.resolver.resolve(`${rel}.${ext}`); if (hit) return hit }
    return ''
  }
  const sound = (bucket, id) => {
    stats[bucket].referenced += 1
    const src = find(`${opt.sndDir}/${id}`, ['ogg'])
    if (src) stats[bucket].resolved += 1; else { stats[bucket].unresolved += 1; if (hasIndex) count('unresolved', `${bucket}:${id}`) }
    return src
  }
  const bgLayers = new Set(opt.bgLayers.map(Number))
  const layers = new Map()      // 层号 → { base: { id, src }, patch: { id, src } }
  const bgOrder = []            // 背景层按最近一次换整张图的先后
  const applied = { bg: undefined, overlays: new Map() }   // 已经发出去的：bg src（'' = 黑）/ slot → src
  const steps = []
  let cmds = []
  let page = []
  let line = ''
  let hasLine = false
  let voice = null
  let transition = false
  const emit = (command) => cmds.push(command)
  const layerState = (layer) => { let s = layers.get(layer); if (!s) { s = { base: null, patch: null }; layers.set(layer, s) } return s }
  const imageSrc = (id) => {
    stats.images.referenced += 1
    for (const ext of ['p.png', 'png', 'jpg']) {
      const src = find(`${opt.imgDir}/${id}`, [ext])
      if (src) { stats.images.resolved += 1; return { src, patch: ext === 'p.png' } }
    }
    stats.images.unresolved += 1
    if (hasIndex) count('unresolved', `image:${id}`)
    return null
  }
  const showLayer = (layer, id) => {
    const state = layerState(layer)
    if (id >= opt.clearFrom) { state.base = null; state.patch = null; const at = bgOrder.indexOf(layer); if (at >= 0) bgOrder.splice(at, 1); return }
    const img = imageSrc(id)
    if (!img) return
    if (img.patch) { state.patch = { id, src: img.src }; return }
    state.base = { id, src: img.src }
    state.patch = null
    if (bgLayers.has(layer)) { const at = bgOrder.indexOf(layer); if (at >= 0) bgOrder.splice(at, 1); bgOrder.push(layer) }
  }
  // 把各层的最终状态和「已经发出去的」比一下，只发有变的
  const applyLayers = (fade) => {
    const wantBg = bgOrder.length ? layers.get(bgOrder[bgOrder.length - 1])?.base?.src || '' : ''
    if (wantBg !== applied.bg) { applied.bg = wantBg; emit(wantBg ? { op: 'bg', src: wantBg, fade } : { op: 'bg', color: [0, 0, 0], fade }) }
    const want = new Map()
    for (const [layer, state] of layers) {
      const z = opt.overlayZ[layer]
      const isBg = bgLayers.has(layer)
      if (!isBg && state.base) want.set(`L${layer}`, { src: state.base.src, z })
      if (state.patch) want.set(isBg ? `B${layer}p` : `L${layer}p`, { src: state.patch.src, z: isBg ? 1 : (z ?? 10) + 1 })
    }
    for (const [slot, item] of want) {
      if (applied.overlays.get(slot) === item.src) continue
      applied.overlays.set(slot, item.src)
      emit({ op: 'overlay', slot, src: item.src, fit: 'none', stage: opt.stage, z: item.z, fade })
    }
    for (const slot of [...applied.overlays.keys()]) if (!want.has(slot)) { applied.overlays.delete(slot); emit({ op: 'overlayOff', slot }) }
  }
  const flushLine = () => {
    if (!hasLine) return
    hasLine = false
    page.push({ text: line, speaker: voice?.speaker || '' })
    voice = voice && { ...voice, used: true }
    line = ''
  }
  const endStep = () => {
    flushLine()
    applyLayers(0)
    if (page.length) {
      if (page.length > opt.pageLimit) page = page.slice(-opt.pageLimit)
      const last = page[page.length - 1]
      const segments = []
      page.forEach((p, i) => { if (i) segments.push({ text: '\n' }); segments.push(...lineSegments(p.text)) })
      emit({ op: 'speaker', segments: last.speaker ? [{ text: last.speaker }] : [] })
      emit({ op: 'text', segments })
      stats.messages += 1
    } else emit({ op: 'text', segments: [] })
    if (voice?.used) voice = null
    steps.push({ index: steps.length, commands: cmds })
    cmds = []
  }
  for (const ev of data.events) {
    const kind = ev[0]
    if (kind === 'T') { line += String(ev[1]).replace(/\n$/, ''); hasLine = true; continue }
    flushLine()
    const op = ev[1]
    if (kind === '#') {
      if (op === 87) endStep()
      else if (op === 70) { endStep(); page = [] }
      else if (op === 43) {
        const src = sound('voices', ev[2])
        if (src) { emit({ op: 'voice', src }); voice = { speaker: opt.speakers[ev[3]] || '' } } else voice = { speaker: opt.speakers[ev[3]] || '' }
      }
      else if (op === 46) { const src = sound('sounds', ev[2]); if (src) emit({ op: 'se', src }) }
      else if (op === 114) { if (ev[2] >= 0) { const src = sound('sounds', ev[2]); if (src) emit({ op: 'bgse', src, loop: true }) } else emit({ op: 'bgseStop' }) }
      else if (op === 131) { if (ev[2] >= 0) { const src = sound('bgm', opt.bgmBase + ev[2]); if (src) emit({ op: 'bgm', src }) } else emit({ op: 'bgmStop' }) }
      else if (op === 29) transition = true
      else if (op === 13) { applyLayers(transition ? opt.fade : 0); transition = false }
      else count('ignored', `#${op}`)
    } else if (kind === '$' && op === 204) showLayer(Number(ev[6]), Number(ev[4]))
    else count('ignored', `${kind}${op}`)
  }
  flushLine()
  if (cmds.length || !steps.length) endStep()
  return { steps, stats }
}

export const tomoeArc04Adapter = { id: ADAPTER_ID, label: '友恵の探偵物語（TinkerBell，Arc04 剧本，经 containers 切章）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
