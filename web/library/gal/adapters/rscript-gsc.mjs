// 适配器：Liar-soft codeX RScript 引擎（Fairytale 系列 / 誰ソ彼のシェイプシフター 等；game.id = rscript::<游戏>）的剧情脚本（.xfl 里的 .gsc 字节码，由 containers.mjs 读出来、「执行」一遍、解成 JSON 事件流）→ 规范场景（gal-scene/1）。
// 输入（rscript-run.mjs 的 decodeGscScript）：{"format":"rscript-gsc/1","arc","name","size","run":{steps,truncated,reason},"events":[事件…]}，事件见 rscript-run.mjs 开头。
// 映射：
//   m（说话人，文本，语音号）/ a（接在上一页后面的文本）→ speaker + text（行内标记：`|汉字[かん]` 或 `汉字[かん]` = ruby；^N = 换行；^C / ^B / ^I / ^S / ^D / ^F / ^L / ^V 这类样式 / 速度标记去掉）；语音号 → voice（voice/<号>.ogg；号 ≥ 10000 = 分库：voice/<号 ÷ 10000>/<号 mod 10000>.ogg）；独立的 v 事件 → voice
//   bg（图号，目录）/ ev → bg（<目录>/<图号 4 位>.png，目录默认 grpe——背景和事件 CG 都在 grpe.xfl 里）；图号 0 / fill → 纯色（fill 1 = 白，别的黑）；1 层（grpe）的图 = 事件 CG：盖在背景上换掉，隐藏后回到背景
//   L（层，图号，x，y，目录，锚点 cx，cy）/ P（层，x，y；移动到落点，动画不要）/ H（层）→ 立绘：目录 grpo_bu0 / grpo_bu1（1920×1680 的整张画布，身体 / 表情 / 嘴各一层，同一个 (x, y)）每层一个槽位 L<层号>；锚点 cx = 1 → x 是图的水平中心，cy = 1 → y 是图的垂直中心（真实脚本里立绘层都是 (1, 1)），没有锚点 = 左上角；
//     grpo_cu（1920×1080 的过场图）→ 铺满的叠加层；grpo 里的小图（335×98 的名牌）/ grpo_ef（特效屏）/ grpo_ex（缩略图）不画
//   bgm（曲号）→ bgm/Track<曲号 2 位>.wav；bgmStop；se（音效号，重复）→ wav/<号 4 位>.ogg；w（毫秒）→ wait；
//   x（问题，选项，分支）→ choice + 每个选项一段带 when 的分支（汇合点之后只有一份）；g（脚本号）→ scene.next（goto 在分支里 = 带 when 的 goto）；c（调别的脚本且没内联的）不跟，计数
// 没验证（没有游戏截图对照）：立绘的位置按「锚点 + (x, y)」直接当舞台（1920×1080）坐标；身体和表情是各自的槽位，叠放顺序 = 出现顺序，不是引擎的层序（层号越大越靠上）；^C 颜色（调色板在 exe 里）没做
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'rscript::gsc'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  stage: [1920, 1080],
  eventsDir: 'grpe',            // 0 层 / 没设目录的层的默认资源目录（APINI 的 events 目录）
  standDirs: ['grpo_bu0', 'grpo_bu1'],   // 立绘目录（整张画布的身体 / 表情层）
  overlayDirs: ['grpo_cu'],     // 铺满的过场叠加图
  eventLayers: [1],             // 这些层上的图 = 事件 CG（换掉背景显示）
  standMinLayer: 11,            // 立绘层号下限（1~10 是背景 / 事件层，名牌也在小层号）
  voiceDir: 'voice', soundDir: 'wav', bgmDir: 'bgm',
  bgmName: 'Track{n2}.wav',     // {n} 曲号 / {n2} 两位
  audioExts: ['ogg', 'wav'],
  wait: { enabled: true, max: 10 },
  colorImages: true,
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"rscript-gsc\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 512))
export const explainSniff = () => '开头不是 {"format":"rscript-gsc/1"…（这个适配器吃 containers 从 Liar-soft 的 scr.xfl 里解出来的事件流，不是原始 GSC 字节码）'
export const contextFiles = () => []
export const contextDirs = (options) => { const opt = readOptions(options); return [opt.resDir].map((dir) => String(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean) }
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

const pad = (n, w) => String(Math.max(0, Math.trunc(Number(n) || 0))).padStart(w, '0')
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

// 台词标记 → 片段。`|` 标注注音的起点（到 `[` 之前的字都是被注音的），没有 `|` = 只注前一个字；^X 开头的样式标记去掉（^N = 换行；^C / ^D / ^F / ^S 后面跟一个参数字符）
export function rscriptSegments(raw, stats = null) {
  const src = String(raw ?? '')
  const segments = []
  let buf = ''
  let baseStart = null   // buf 里被注音的起点（遇到 | 记下）
  const flush = () => { if (buf) { segments.push({ text: buf }); buf = '' } }
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (c === '|') { baseStart = buf.length; i += 1; continue }
    if (c === '[') {
      const end = src.indexOf(']', i + 1)
      if (end < 0) { buf += c; i += 1; continue }
      const ruby = src.slice(i + 1, end)
      const start = baseStart !== null ? baseStart : Math.max(0, buf.length - 1)
      const base = buf.slice(start)
      buf = buf.slice(0, start)
      flush()
      if (base) segments.push({ text: base, ruby })
      if (stats) stats.ruby = (stats.ruby || 0) + 1
      baseStart = null
      i = end + 1
      continue
    }
    if (c === '^' && i + 1 < src.length) {
      const k = src[i + 1].toUpperCase()
      i += 2
      if (k === 'N') buf += '\n'
      else if ('CDFS'.includes(k) && i < src.length) i += 1
      else if (k === 'V') while (/[-\d]/.test(src[i] || '')) i += 1
      continue
    }
    buf += c
    i += 1
  }
  flush()
  return segments.filter((s) => s.text !== '')
}

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || data.format !== 'rscript-gsc/1' || !Array.isArray(data.events)) throw new Error('不是 rscript-gsc/1 事件流')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { events: 0, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, raw: {}, ignored: {}, unresolved: {}, links: {}, commands: 0, run: data.run || null }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const [stageW, stageH] = opt.stage
  const find = (rel, exts) => {
    if (!hasIndex) return ''
    for (const ext of exts) { const hit = ctx.resolver.resolve(`${rel}.${ext}`); if (hit) return hit }
    return ''
  }
  const imageOf = (dir, image) => {
    const stem = String(dir || opt.eventsDir).split('/')[0] || opt.eventsDir
    stats.images.referenced += 1
    const src = find(`${stem}/${pad(image, 4)}`, ['png'])
    if (src) stats.images.resolved += 1; else { stats.images.unresolved += 1; if (hasIndex) count('unresolved', `image:${stem}/${pad(image, 4)}`) }
    return src
  }
  const voiceOf = (voice) => {
    stats.voices.referenced += 1
    const bank = Math.trunc(voice / 10000)
    const rel = bank ? `${opt.voiceDir}/${bank}/${pad(voice % 10000, 4)}` : `${opt.voiceDir}/${pad(voice, 4)}`
    const src = find(rel, opt.audioExts)
    if (src) stats.voices.resolved += 1; else { stats.voices.unresolved += 1; if (hasIndex) count('unresolved', `voice:${rel}`) }
    return src
  }

  const steps = []
  let commands = []
  let guard = []
  let nextScript = ''
  const emit = (command) => commands.push(guard.length ? { ...command, when: guard } : command)
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  // 画面状态：0 层背景 / 事件层（1 层）/ 叠加 / 立绘各层；变了才发
  let bgState = null            // { src } | { color } | null
  let eventState = null         // 事件层（1 层）的图 { src } | null
  let overlays = new Map()      // 层 → { src, x, y }
  let stands = new Map()        // 层 → { src, x, y }
  let shown = { bg: '', overlays: new Map(), stands: new Map() }
  let dirty = false
  const effectiveBg = () => (eventState?.src ? { src: eventState.src } : bgState)
  const centerOf = (layer, a) => {
    const w = layer.w || stageW
    const h = layer.h || stageH
    const x = a?.[0] ? layer.x : layer.x + w / 2
    const y = a?.[1] ? layer.y : layer.y + h / 2
    return { x: Math.round(x - stageW / 2), y: Math.round(y - stageH / 2) }
  }
  function commit() {
    if (!dirty) return
    dirty = false
    const bg = effectiveBg()
    const sig = bg ? JSON.stringify(bg) : ''
    if (sig !== shown.bg) { if (bg) emit({ op: 'bg', ...bg }); else if (shown.bg) emit({ op: 'bgoff' }); shown.bg = sig }
    for (const [layer, st] of stands) {
      const sigS = JSON.stringify(st)
      if (shown.stands.get(layer) === sigS) continue
      const c = centerOf(st, st.anchor)
      emit({ op: 'stand', slot: `L${layer}`, parts: [{ src: st.src, x: c.x, y: c.y, scale: 1 }], stage: [stageW, stageH], ...(shown.stands.has(layer) ? {} : { fade: 0.25 }) })
      shown.stands.set(layer, sigS)
      stats.stands += 1
    }
    for (const layer of [...shown.stands.keys()]) if (!stands.has(layer)) { emit({ op: 'standOff', slot: `L${layer}` }); shown.stands.delete(layer) }
    for (const [layer, ov] of overlays) {
      const sigO = JSON.stringify(ov)
      if (shown.overlays.get(layer) === sigO) continue
      const c = centerOf(ov, ov.anchor)
      emit({ op: 'overlay', slot: `O${layer}`, src: ov.src, x: c.x, y: c.y, scale: 1 })
      shown.overlays.set(layer, sigO)
    }
    for (const layer of [...shown.overlays.keys()]) if (!overlays.has(layer)) { emit({ op: 'overlayOff', slot: `O${layer}` }); shown.overlays.delete(layer) }
  }
  const resetShown = () => { shown = { bg: '', overlays: new Map(), stands: new Map() }; dirty = true }

  let lastText = null   // 上一页的 text 命令（a 事件往里接）
  function onMessage(ev) {
    commit()
    const [, voice, name, body] = ev
    stats.messages += 1
    const speaker = String(name || '').trim()
    emit({ op: 'speaker', segments: speaker ? rscriptSegments(speaker) : [] })
    if (voice) { const src = voiceOf(num(voice)); if (src) emit({ op: 'voice', src }) }
    const textCommand = { op: 'text', segments: rscriptSegments(body, stats), ...(guard.length ? { when: guard } : {}) }
    commands.push(textCommand)
    lastText = textCommand
    endStep()
  }
  function onAppend(ev) {
    const more = rscriptSegments(ev[1], stats)
    if (!more.length) return
    // 接在上一页的文本后面（上一页已经是一个步了：补到那一步的 text 里）
    const prev = steps[steps.length - 1]
    const target = prev?.commands.findLast?.((c) => c.op === 'text') || lastText
    if (target) target.segments.push(...more); else { commit(); emit({ op: 'text', segments: more }); endStep() }
  }

  function onLayerLoad(ev) {
    const [, layer, image, x, y, dir, cx, cy] = ev
    const stem = String(dir || '').split('/')[0]
    if (!image) return
    if (opt.eventLayers.includes(layer)) { const src = imageOf(stem || opt.eventsDir, image); eventState = src ? { src } : null; dirty = true; return }
    if (opt.standDirs.includes(stem) && layer >= opt.standMinLayer) {
      const src = imageOf(stem, image)
      if (src) { stands.set(layer, { src, x: num(x), y: num(y), anchor: [cx, cy], w: 1920, h: 1680 }); dirty = true }
      return
    }
    if (opt.overlayDirs.includes(stem)) {
      const src = imageOf(stem, image)
      if (src) { overlays.set(layer, { src, x: num(x), y: num(y), anchor: [cx, cy], w: stageW, h: stageH }); dirty = true }
      return
    }
    count('ignored', `layer:${stem || '?'}`)
  }
  function onMove(ev) {
    const [, layer, x, y] = ev
    for (const map of [stands, overlays]) { const e = map.get(layer); if (e) { map.set(layer, { ...e, x: num(x), y: num(y) }); dirty = true } }
  }
  function onHide(ev) {
    const layer = ev[1]
    if (opt.eventLayers.includes(layer)) { if (eventState) { eventState = null; dirty = true } return }
    if (stands.delete(layer) || overlays.delete(layer)) dirty = true
  }

  function onChoice(ev) {
    const [, question, options, branches] = ev
    const opts = (Array.isArray(options) ? options : []).map((t) => String(t))
    commit()
    stats.choices += 1
    const stepIndex = steps.length
    const variable = `sel${stepIndex}`
    // 问题 = 一句台词（带选项）：自己一步
    if (question) { emit({ op: 'speaker', segments: [] }); commands.push({ op: 'text', segments: rscriptSegments(question, stats), ...(guard.length ? { when: guard } : {}) }) } else commands.push({ op: 'text', segments: [], ...(guard.length ? { when: guard } : {}) })
    commands.push({ op: 'choice', id: `${stepIndex}:0`, var: variable, options: opts.map((t, n) => ({ value: n + 1, segments: rscriptSegments(t) })), ...(guard.length ? { when: guard } : {}) })
    endStep()
    const outer = guard
    const saved = { bgState, eventState, stands: new Map(stands), overlays: new Map(overlays) }
    for (const [n, events] of (Array.isArray(branches) ? branches : []).entries()) {
      bgState = saved.bgState; eventState = saved.eventState; stands = new Map(saved.stands); overlays = new Map(saved.overlays)
      guard = [...outer, { var: variable, op: '==', value: n + 1 }]
      resetShown()
      walk(Array.isArray(events) ? events : [])
      commit()
      if (commands.length) { emit({ op: 'text', segments: [] }); endStep() }
    }
    guard = outer
    bgState = saved.bgState; eventState = saved.eventState; stands = new Map(saved.stands); overlays = new Map(saved.overlays)
    resetShown()
  }

  function walk(events) {
    for (const ev of events) {
      stats.events += 1
      switch (ev[0]) {
        case 'm': onMessage(ev); break
        case 'a': onAppend(ev); break
        case 'bg': case 'ev': {
          const image = num(ev[1])
          if (!image) { bgState = null; eventState = null; stands = new Map(); overlays = new Map(); dirty = true; break }
          const src = imageOf(ev[2] || opt.eventsDir, image)
          bgState = src ? { src } : bgState
          eventState = null
          dirty = true
          break
        }
        case 'fill': bgState = { color: ev[1] ? [255, 255, 255] : [0, 0, 0] }; eventState = null; stands = new Map(); overlays = new Map(); dirty = true; break
        case 'L': onLayerLoad(ev); break
        case 'H': onHide(ev); break
        case 'P': onMove(ev); break
        case 'bgm': {
          commit()
          const track = num(ev[1])
          if (!track) { emit({ op: 'bgmStop' }); break }
          stats.bgm.referenced += 1
          const file = opt.bgmName.replace('{n2}', pad(track, 2)).replace('{n}', String(track))
          const rel = `${opt.bgmDir}/${file.replace(/\.[^.]+$/, '')}`
          const src = find(rel, [file.match(/\.([^.]+)$/)?.[1] || 'wav', ...opt.audioExts])
          if (src) { stats.bgm.resolved += 1; emit({ op: 'bgm', src }) } else { stats.bgm.unresolved += 1; if (hasIndex) count('unresolved', `bgm:${rel}`) }
          break
        }
        case 'bgmStop': commit(); emit({ op: 'bgmStop' }); break
        case 'se': { commit(); const rel = `${opt.soundDir}/${pad(ev[1], 4)}`; const src = find(rel, opt.audioExts); if (src) emit({ op: 'se', src }); else count('ignored', 'se-unresolved'); break }
        case 'v': { commit(); const src = voiceOf(num(ev[1])); if (src) emit({ op: 'voice', src }); break }
        case 'w': { if (opt.wait.enabled) { const seconds = Math.min(opt.wait.max, num(ev[1]) / 1000); if (seconds > 0) { commit(); emit({ op: 'wait', seconds }) } } break }
        case 'x': onChoice(ev); break
        case 'g': {
          const script = pad(ev[1], 4)
          count('links', `goto:${script}`)
          if (num(ev[1])) { if (guard.length) { commit(); emit({ op: 'goto', script }) } else nextScript = script }
          break
        }
        case 'c': count('links', `call:${pad(ev[1], 4)}${ev[2] ? `#${ev[2]}` : ''}`); break
        case 'seStop': break
        default: count('ignored', `event:${ev[0]}`)
      }
    }
  }

  walk(data.events)
  commit()
  if (commands.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((n, step) => n + step.commands.length, 0)
  return { steps, stats, ...(nextScript ? { next: { script: nextScript } } : {}) }
}

export const rscriptGscAdapter = { id: ADAPTER_ID, label: 'Liar-soft codeX RScript（GSC 字节码，经 containers 展开）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
