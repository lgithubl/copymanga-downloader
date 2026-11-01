// 适配器：自有 arc 家族（eomaia 引擎：コンフィチュールソフト 等）的剧情脚本（SCRE，由 containers.mjs 从 script.arc 里读出来、arcfam-decode.mjs 认字节模式解成 JSON 事件流）→ 规范场景（gal-scene/1）。
// id = arcfam::scre：引擎家族 arcfam 的脚本适配器，家族里所有游戏（game.id = arcfam::<游戏>）共用；游戏之间的差别只在 config（adapterOptions['arcfam::scre'] + containers 规则）。
//
// 输入：{"format":"arcfam-scre/1","arc","name","size","events":[事件…]}；事件：["t", 文本, 行号] ["w", 说话人] ["v", 语音文件] ["b", BGM 文件] ["s", 音效文件] ["i", 方法号, 图文件]
// 映射：
//   t（+ 前面最近一个 w）→ speaker + text；v → voice；b → bgm；s → se
//   i 102（底图：bg* / BG_* / EV*S* / h* / e*）→ bg，同时清掉叠加层；i 105 / 106（叠加层：face / moji / karada / eff / cutin …）→ overlay（按文件名里「_种类」分槽，同种类再来一张 = 替换；整张铺满，真实样本里 EV 的底图和叠加层都是 1280×720）
// 没做 / 推断：
//   · 选择 / 分支 / 跳转（字节码没有逆全）：按文件里出现的顺序线性输出，分支各段都会出现；脚本之间没有 scene.next
//   · 叠加层的层序：按出现顺序叠；分槽方式是按文件名猜的；底图每句台词前都会重新发一次（引擎的习惯），重复的会被去掉
//   · 说话人：`【名字】` 压栈后下一句文本用它，用一次就清；没有 = 旁白
//   · 压缩的剧本（g11 的 .MES，算法没识别）不展开
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'arcfam::scre'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  stage: [1280, 720],
  imageExts: ['png', 'jpg'],
  audioExts: ['ogg', 'wav', 'mp3'],
  overlay: { enabled: true, fit: 'cover' },
  speaker: { strip: [] },
  extraDirs: [],
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"arcfam-scre\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 512))
export const explainSniff = () => '开头不是 {"format":"arcfam-scre/1"…（这个适配器吃 containers 从自有 arc 的 script.arc 里解出来的剧本事件流，不是原始二进制）'

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

const str = (v) => (typeof v === 'string' ? v : '')

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || data.format !== 'arcfam-scre/1' || !Array.isArray(data.events)) throw new Error('不是 arcfam-scre/1 事件流')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { events: 0, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, raw: {}, ignored: {}, unresolved: {}, links: {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const find = (name, exts) => {
    const wanted = String(name || '').replace(/\\/g, '/').replace(/^.*\//, '')
    if (!wanted || !hasIndex) return ''
    let hit = ctx.resolver.resolveByName(wanted)
    if (hit) return hit
    const stem = wanted.replace(/\.[^.]+$/, '')
    for (const ext of exts) { hit = ctx.resolver.resolveByName(`${stem}.${ext}`); if (hit) return hit }
    return ''
  }
  const steps = []
  let commands = []
  const emit = (command) => commands.push(command)
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  let base = null              // { src }：i 102
  let overlays = new Map()     // 种类 → src
  let shown = { base: null, overlays: new Map() }
  let dirty = false
  function commit() {
    if (!dirty) return
    dirty = false
    const sig = base ? JSON.stringify(base) : ''
    if (sig !== (shown.base ?? '')) {   // 换底图 = 先收掉旧的叠加层
      if (shown.overlays.size) emit({ op: 'overlayOff' })
      shown.overlays = new Map()
      if (base) emit({ op: 'bg', ...base }); else emit({ op: 'bgoff' })
      shown.base = sig
    }
    for (const slot of [...shown.overlays.keys()]) if (!overlays.has(slot)) { emit({ op: 'overlayOff', slot }); shown.overlays.delete(slot) }
    for (const [slot, src] of overlays) if (shown.overlays.get(slot) !== src) { emit({ op: 'overlay', slot, src, fit: opt.overlay.fit }); shown.overlays.set(slot, src) }
  }
  const imageRef = (file) => {
    const src = find(file, opt.imageExts)
    stats.images.referenced += 1
    if (src) { stats.images.resolved += 1; return src }
    stats.images.unresolved += 1
    if (hasIndex) count('unresolved', `image:${file}`)
    return ''
  }

  let speaker = ''
  for (const ev of data.events) {
    if (!Array.isArray(ev)) continue
    stats.events += 1
    const kind = ev[0]
    if (kind === 'i') {
      const method = Number(ev[1])
      const file = str(ev[2])
      if (method === 102) {
        const src = imageRef(file)
        base = src ? { src } : null
        overlays = new Map()
        dirty = true
      } else if (opt.overlay.enabled) {
        const src = imageRef(file)
        if (src) { const slot = (/_([a-z]+)\d*\.[a-z]+$/i.exec(file)?.[1] || 'layer').toLowerCase(); overlays.set(slot, src); dirty = true }
      } else count('ignored', `image:${method}`)
    } else if (kind === 'v') {
      stats.voices.referenced += 1
      const hit = find(str(ev[1]), opt.audioExts)
      if (hit) { stats.voices.resolved += 1; emit({ op: 'voice', src: hit }) } else { stats.voices.unresolved += 1; if (hasIndex) count('unresolved', `voice:${str(ev[1])}`) }
    } else if (kind === 'b') {
      stats.bgm.referenced += 1
      const hit = find(str(ev[1]), opt.audioExts)
      if (hit) { stats.bgm.resolved += 1; emit({ op: 'bgm', src: hit }) } else { stats.bgm.unresolved += 1; if (hasIndex) count('unresolved', `bgm:${str(ev[1])}`) }
    } else if (kind === 's') {
      const hit = find(str(ev[1]), opt.audioExts)
      if (hit) emit({ op: 'se', src: hit }); else if (hasIndex) count('unresolved', `se:${str(ev[1])}`)
    } else if (kind === 'w') speaker = str(ev[1])
    else if (kind === 't') {
      commit()
      let who = speaker
      speaker = ''
      for (const re of (Array.isArray(opt.speaker.strip) ? opt.speaker.strip : [])) { try { who = who.replace(new RegExp(re), '') } catch { /* 坏正则不管 */ } }
      emit({ op: 'speaker', segments: who ? [{ text: who }] : [] })
      emit({ op: 'text', segments: str(ev[1]) ? [{ text: str(ev[1]) }] : [] })
      stats.messages += 1
      endStep()
    } else count('ignored', String(kind))
  }
  commit()
  if (commands.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((n, step) => n + step.commands.length, 0)
  return { steps, stats }
}

export const arcfamScreAdapter = { id: ADAPTER_ID, label: '自有 arc / eomaia（SCRE，经 containers 展开）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
