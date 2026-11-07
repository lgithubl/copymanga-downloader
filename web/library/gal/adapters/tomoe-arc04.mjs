// 适配器：友恵の探偵物語（TinkerBell 引擎，tomoe.exe；game.id = tomoe::<游戏>）的剧本（Arc04.dat 的记录流，由 containers 按 ML 记录切成章节 JSON tomoe-arc04/1，format: tomoe）→ 规范场景（gal-scene/1）。
// 指令（对照 tomoe.exe 反汇编 + 引擎自带测试脚本 + 真实 Arc04.dat 的 68611 条记录；统计见 README）：
//   ['T', 文本]：一行文字（连续的 T = 同一行折行，每段末尾的 \n 是折行不是换行）；ÿÿ<注音长度><注音><正文长度><正文> = 注音（ルビ）
//   ['#', 87]：行末等点击；['#', 70]：页末（点击后清页）
//   ['#', 43, 声音号, 声道]：语音（声道 = 说话人序号，见选项 speakers）；['#', 46, 声音号]：音效；['#', 114, 声音号]：循环音效（-1 = 停）；['#', 131, n, -1]：BGM（声音号 = 6018 + n；n = -1 停）
//   ['#', 132, 毫秒]：BGM 淡出（99 处全是 2000，后面跟换场景；整个剧本 ['#', 131, -1, -1] 只有 1 处，游戏靠它停音乐）
//   ['#', 35, 层]：清掉这一层（9999 = 全部层，每次换场景都有一条）
//   ['$', 204, 1, a, 图号, b, 层, 1]：在「层」上显示图（图号 ≥ 816 = 清掉这一层）；['#', 29, 2] … ['#', 13, 2]：画面切换（淡入淡出）的开始 / 提交
//   层：132 / 120 / 127 / 117 / 121 / 9999 = 背景（Data000 的 JPEG / 位图）；2 / 140 / 141 / 4 = 叠在上面的图层（CG / 补丁）。每一层是「整张图 + 之后累计叠上去的补丁」：整张图换掉这一层的全部内容，带遮罩的补丁图（<编号>.p.png，只含和上一帧不同的像素）一张一张累计盖在上面（H 场景的 CG 差分就是这样连着来的；只画最后一张补丁会得到碎片），清空（图号 >= 816）把这一层清掉
// 没处理：选项（#134 … #136，只在调试菜单里）、跳转 / 变量（#1 #2 #3 #8 #10，剧情是一条线）、#150 #66 #132 #54 #100 …（作用不明，记在 stats.ignored）
// 没验证（没有游戏截图对照）：层的叠放顺序（现在按「最近画的在上面」，不看层号）、补丁盖在哪一层、图号 817 / 818 当「清空」用、切换时间；章节切分和章节的先后（c01… 按在文件里的顺序）
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'tomoe::arc04'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  imgDir: 'img',
  sndDir: 'snd',
  stage: [1920, 1080],
  bgLayers: [132, 120, 127, 117, 121, 9999],
  keepBg35: true,                                  // #35 9999 只清叠加层（2 / 140 / 141 / 4），背景层留着（CG 的抠图补丁盖在原来的背景上；用真实图核对过：不留 = 抠图的人物站在黑底上），背景层靠图号 >= clearFrom 清；false = 全清（旧）
  clearOp35: true,                                 // #35 是否清层（false = 不清；只有图号 >= clearFrom 的绘制才清那一层）
  clearFrom: 816,                                  // 图号 >= 这个 = 清空这一层
  bgmBase: 6018,                                   // BGM n → 声音号 bgmBase + n
  fade: 0.5,                                       // 画面切换的淡入淡出秒数
  pageMode: 'sentence',                            // 'sentence' = 一次点击一步，只显示这一次点击对应的那一段（一句句）；'page' = 游戏原样：同一页的行累计显示到页末（#70）才清
  pageLimit: 12,                                   // pageMode = page 时，一页最多累计几行（防止没有页末记号时无限变长）
  maxPatches: 32,                                  // 一层最多累计几张补丁（超过的丢掉最早的，整张图保留）
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
  const layers = new Map()      // 层号 → { stack: [{ id, src, patch }] }（整张图 + 累计的补丁）
  const bgOrder = []            // 背景层按最近一次换整张图的先后
  const applied = { bg: undefined, overlays: new Map() }   // 已经发出去的：bg src（'' = 黑）/ slot → src
  const steps = []
  let cmds = []
  let page = []
  let since = []   // 上一次点击以来的段落（sentence 模式只显示这些）
  let line = ''
  let hasLine = false
  let voice = null
  let transition = false
  const emit = (command) => cmds.push(command)
  let drawSeq = 0   // 绘制先后：叠放顺序按「最近画的在上面」（H 场景里 140 层的特写和 2 层的帧交替出现，只有最近画的才是想让人看到的）
  const layerState = (layer) => { let s = layers.get(layer); if (!s) { s = { stack: [] }; layers.set(layer, s) } return s }
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
    if (id >= opt.clearFrom) { state.stack = []; const at = bgOrder.indexOf(layer); if (at >= 0) bgOrder.splice(at, 1); return }
    const img = imageSrc(id)
    if (!img) return
    if (img.patch) {   // 补丁：累计盖在这一层现有内容上
      state.stack.push({ id, src: img.src, patch: true, seq: ++drawSeq })
      const patches = state.stack.filter((x) => x.patch)
      if (patches.length > opt.maxPatches) state.stack.splice(state.stack.indexOf(patches[0]), 1)
    } else state.stack = [{ id, src: img.src, patch: false, seq: ++drawSeq }]
    if (bgLayers.has(layer)) { const at = bgOrder.indexOf(layer); if (at >= 0) bgOrder.splice(at, 1); bgOrder.push(layer) }
  }
  // 把各层的最终状态和「已经发出去的」比一下，只发有变的
  const applyLayers = (fade) => {
    const top = bgOrder.length ? layers.get(bgOrder[bgOrder.length - 1]) : null
    const topBase = top?.stack.find((x) => !x.patch)
    const wantBg = topBase?.src || ''
    if (wantBg !== applied.bg) { applied.bg = wantBg; emit(wantBg ? { op: 'bg', src: wantBg, fade } : { op: 'bg', color: [0, 0, 0], fade }) }
    const want = new Map()
    const addStack = (prefix, stack, zBase) => {
      let k = 0
      for (const item of stack) {
        const z = zBase + item.seq * 0.0001
        if (item.patch) { want.set(`${prefix}p${k}`, { src: item.src, z }); k += 1 } else if (prefix.startsWith('L')) want.set(prefix, { src: item.src, z })
      }
    }
    if (top) addStack(`B${bgOrder[bgOrder.length - 1]}`, top.stack, 1)
    for (const [layer, state] of layers) {
      if (bgLayers.has(layer) || !state.stack.length) continue
      addStack(`L${layer}`, state.stack, 10)
    }
    for (const [slot, item] of want) {
      const key = `${item.src}|${item.z}`
      if (applied.overlays.get(slot) === key) continue
      applied.overlays.set(slot, key)
      emit({ op: 'overlay', slot, src: item.src, fit: 'none', stage: opt.stage, z: item.z, fade })
    }
    for (const slot of [...applied.overlays.keys()]) if (!want.has(slot)) { applied.overlays.delete(slot); emit({ op: 'overlayOff', slot }) }
  }
  const flushLine = () => {
    if (!hasLine) return
    hasLine = false
    page.push({ text: line, speaker: voice?.speaker || '' })
    since.push({ text: line, speaker: voice?.speaker || '' })
    voice = voice && { ...voice, used: true }
    line = ''
  }
  const endStep = () => {
    flushLine()
    applyLayers(0)
    const shown = opt.pageMode === 'page' ? page : since
    since = []
    if (shown.length) {
      if (page.length > opt.pageLimit) page = page.slice(-opt.pageLimit)
      const last = shown[shown.length - 1]
      const segments = []
      shown.forEach((p, i) => { if (i) segments.push({ text: '\n' }); segments.push(...lineSegments(p.text)) })
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
      else if (op === 132) emit({ op: 'bgmStop', fade: Math.max(0, Math.min(10, (Number(ev[2]) || 0) / 1000)) })   // #132 毫秒 = BGM 淡出
      else if (op === 131) { if (ev[2] >= 0) { const src = sound('bgm', opt.bgmBase + ev[2]); if (src) emit({ op: 'bgm', src }) } else emit({ op: 'bgmStop' }) }
      else if (op === 35 && opt.clearOp35) {   // #35 层：清掉这一层的内容（9999 = 全部层）；keepBg35：9999 不动背景层（只清叠加层）
        if (Number(ev[2]) === 9999) { for (const [layer, state] of layers) if (!(opt.keepBg35 && bgLayers.has(layer))) state.stack = []; if (!opt.keepBg35) bgOrder.length = 0 } else { layerState(Number(ev[2])).stack = []; const at = bgOrder.indexOf(Number(ev[2])); if (at >= 0) bgOrder.splice(at, 1) }
      }
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
