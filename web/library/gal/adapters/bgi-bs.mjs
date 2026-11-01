// 适配器：BGI / Ethornell 引擎（HOOKSOFT / Tily 等）的剧情脚本（BurikoCompiledScriptVer1.00，由 containers.mjs 从 BURIKO ARC20 里读出来、DSC 解压后「执行」一遍、解成 JSON 事件流）→ 规范场景（gal-scene/1）。
// id = bgi::bs：引擎家族 bgi 的脚本适配器，家族里所有游戏（game.id = bgi::<游戏>）共用；游戏之间的差别只在 config（adapterOptions['bgi::bs'] + containers 规则）。
//
// 输入（bgi.mjs 的 runBurikoScript 的结果）：{"format":"bgi-bs/1","arc","name","size","imports":[…],"run":{steps,choices,merged,unmerged,truncated},"events":[事件…]}
//   事件：["c", 库函数名, 偏移, [参数…]]   库函数（callfn）：_PlayVoice / _PlayBGM / _DrawScene / _DrawBS …
//         ["k", 命令号, 偏移, [参数…]]     游戏命令：只留 0x140（msg：文本、说话人在前）
//         ["s", 名字, 偏移, [参数…]]       系统调用：只留 call_scenario / jump_scenario
//         ["x", 偏移, 函数名, [选项文字…], [[分支事件…]…], 汇合偏移]   选择：每个选项一段分支，汇合点之后只有一份
// 映射（全部可以用 adapterOptions['bgi::bs'] 改，见 DEFAULT_OPTIONS）：
//   msg(文本, 说话人, …)                      → speaker + text（<Rふりがな>汉字</R> = ruby，别的 <…> 标记去掉；说话人空 = 旁白）
//   _PlayVoice(槽, 名, …)                    → voice；_PlayBGM(槽, 名, …) → bgm；_FadeBGM(槽, 毫秒, 0) / SoundStopAll(毫秒) → bgmStop；_PlaySE / _PlayStreamSE(槽, 名, …) → se
//   _DrawScene(名, …)                        → bg（BLACK / WHITE 这类纯色名 = bg.color）；换背景会清掉立绘
//   _DrawBS(槽, 本体, …, 表情…)              → 立绘（stand）：本体 + 后面的字符串参数（表情 / 配件）叠在一起；横向位置按 x 参数的正负分左 / 中 / 右；_FadeBS(槽, 0, …) 去掉这个槽
//   _DrawSPR(槽, 名, …) / _FadeSPR(槽, 0, …) → 事件图（CG / 过场）：当成 bg 换掉背景，_FadeSPR 去掉后回到 _DrawScene 的背景
//   _Wait(毫秒, …)                           → wait
//   SelectEx / _SelectEx(选项…)              → choice（选项挂在问题那句台词的步里）；每个选项一段带 when 的分支；jump_scenario 在分支里 = 带 when 的 goto
//   jump_scenario(文件, …)                   → scene.next（脚本末尾接着播）；call_scenario 是调库场景（_GM 之类）：不跟，计数
// 推断（没有样本验证，按数据猜的，都可以用 options 改）：
//   有依据（读 system.arc 里的 framework._bs）：_DrawBS 的 x = args[7]（相对画面中心的偏移，0x10000000 = 默认）、y = args[8]、放大率 = args[9]（百分比）；左右槽位的位置对称，支持 x 是中心相对
//   真实立绘图核对（g02 / g03 / g07 的 CompressedBG）：本体（如 NO04SA_M 1680×1580）头顶离图的上沿只有 ~57px、最下面一行不透明（身体被画面下沿截掉）；
//     本体 y = 180 / 300、放大 90 或默认：「图的底边对齐画面底边再平移 y」会把头顶推到画面外（-111px），所以 y 按「图的中心 = 画面中心 + (x, y)」处理（头顶落在画面 6%~19% 高度处）——
//     这是按「头不能被切掉」推的最合理的一种，没有游戏截图对照，不是证实
//   表情 / 嘴 / 眼部件：图头里没有偏移（22415 张图头 0x18~0x1f 全是 0），参数里也没有；**左上角对齐本体的左上角（0, 0）**——v1.5 采集里 f / k / l / m / n 五个尺寸变体各有成对的本体 + 部件：f / k / l 的部件和本体同尺寸，m（1620×1280 对 1920×1680）和 n（1320×1080 对 1920×1480）的部件比本体小，把部件放在 (0, 0) 时眼睛 / 嘴正好落在脸上（居中放则眼睛跑到头发里，目视核对）
//   部件里眨眼 / 说话的几帧竖着拼成一张（1330×2550 = 3 × 850、1620×5120 = 4 × 1280）：containers 取资源时按「同组最矮的同宽部件 = 一帧」只留第一帧
//   · _DrawScene 换背景会清掉立绘；_FadeBS 第 2 个参数 = 0 表示淡出（去掉）——参数含义按用法猜的
//   · _FadeBGM(槽, 毫秒, 音量) 音量 0 = 淡出停止
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader, safeRegex } from './options-merge.mjs'

export const ADAPTER_ID = 'bgi::bs'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',   // containers 展开后的资源目录（相对媒体目录）；要和 config.containers.dir + resourceRoots 对上
  stage: [1920, 1080],   // 游戏分辨率：纯色 BLACK 背景和 CG 都是 1920×1080（采集的真实图核对过）
  colorImages: [{ match: '^BLACK$', color: [0, 0, 0] }, { match: '^WHITE$', color: [255, 255, 255] }],
  speaker: { strip: [] },
  text: { stripTags: ['<\\/?C\\d*>', '<\\/?[A-QS-Z]\\w*>'] },   // ruby（<R…>）以外要去掉的标记（正则）
  voiceFunctions: ['_PlayVoice'],
  bgmFunctions: ['_PlayBGM'],
  seFunctions: ['_PlaySE', '_PlayStreamSE'],
  bgFunctions: ['_DrawScene'],
  eventImageFunctions: ['_DrawSPR'],
  bustFunctions: ['_DrawBS'],
  wait: { enabled: true, max: 10 },
  clearBustsOnScene: true,
  audioExts: ['ogg', 'flac', 'wav', 'mp3'],
  imageExts: ['png', 'jpg', 'jpeg'],
  extraDirs: [],
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"bgi-bs\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 512))
export const explainSniff = () => '开头不是 {"format":"bgi-bs/1"…（这个适配器吃 containers 从 BURIKO ARC20 里解出来的剧本事件流，不是原始二进制）'

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

const compiledCache = new WeakMap()
function compiled(opt) {
  if (compiledCache.has(opt)) return compiledCache.get(opt)
  const regexes = (list) => (Array.isArray(list) ? list : []).map((source) => safeRegex(source)).filter(Boolean)
  const out = {
    colors: opt.colorImages.map((r) => ({ re: safeRegex(r?.match, 'i'), color: Array.isArray(r?.color) ? r.color.slice(0, 3).map((n) => Math.max(0, Math.min(255, Number(n) || 0))) : [0, 0, 0] })).filter((r) => r.re),
    speakerStrip: regexes(opt.speaker.strip),
    tagStrip: regexes(opt.text.stripTags).map((re) => new RegExp(re.source, 'g')),
    voice: new Set(opt.voiceFunctions), bgm: new Set(opt.bgmFunctions), se: new Set(opt.seFunctions), bg: new Set(opt.bgFunctions), eventImage: new Set(opt.eventImageFunctions), bust: new Set(opt.bustFunctions),
  }
  compiledCache.set(opt, out)
  return out
}
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const str = (value) => (typeof value === 'string' ? value : '')

// 文本：<Rふりがな>漢字</R> → ruby 片段；别的标记按 stripTags 去掉；字面的 \n 换行
function segmentsOf(raw, rx) {
  let textValue = String(raw ?? '')
  for (const re of rx.tagStrip) textValue = textValue.replace(re, '')
  const segments = []
  const ruby = /<R([^<>]*)>([^<>]*)<\/R>/g
  let last = 0
  for (let m = ruby.exec(textValue); m; m = ruby.exec(textValue)) {
    if (m.index > last) segments.push({ text: textValue.slice(last, m.index) })
    segments.push({ text: m[2], ruby: m[1] })
    last = m.index + m[0].length
  }
  if (last < textValue.length) segments.push({ text: textValue.slice(last) })
  return segments.filter((s) => s.text !== '')
}

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  const rx = compiled(opt)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || data.format !== 'bgi-bs/1' || !Array.isArray(data.events)) throw new Error('不是 bgi-bs/1 事件流')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { events: 0, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, raw: {}, ignored: {}, unresolved: {}, links: {}, run: data.run || {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const nameOf = (file) => String(file || '').replace(/\\/g, '/').replace(/^.*\//, '')
  const stemOf = (file) => nameOf(file).replace(/\.[^.]+$/, '')
  const find = (name, exts) => {
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
  let guard = []
  let nextScript = ''
  const emit = (command) => commands.push(guard.length ? { ...command, when: guard } : command)
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  // ---- 画面状态 ----
  let bgState = null            // { src } | { color } | null：_DrawScene 的背景
  let eventImage = null         // _DrawSPR 的事件图：{ slot, src } | { slot, color }
  let busts = new Map()         // 槽 → { parts: [{ src, align }], x }
  let shown = { bg: null, stand: null }
  let dirty = false
  const effectiveBg = () => eventImage?.src || eventImage?.color ? (eventImage.src ? { src: eventImage.src } : { color: eventImage.color }) : bgState
  function commit() {
    if (!dirty) return
    dirty = false
    const bg = effectiveBg()
    const sig = bg ? JSON.stringify(bg) : ''
    if (sig !== (shown.bg ?? '')) {
      if (bg) emit({ op: 'bg', ...bg })
      else if (shown.bg) emit({ op: 'bgoff' })
      shown.bg = sig
    }
    const parts = []
    for (const [, bust] of [...busts].sort((a, b) => a[1].x - b[1].x)) for (const part of bust.parts) parts.push(part)
    const standSig = JSON.stringify(parts)
    if (standSig !== (shown.stand ?? '[]')) {
      if (parts.length) { emit({ op: 'stand', parts }); stats.stands += 1 } else emit({ op: 'standOff' })
      shown.stand = standSig
    }
  }
  const resetShown = () => { shown = { bg: null, stand: null }; dirty = true }

  const imageOf = (name, { color = false } = {}) => {
    const src = find(name, opt.imageExts)
    if (src) { stats.images.referenced += 1; stats.images.resolved += 1; return { src } }
    const solid = color ? colorOf(stemOf(name)) : null
    if (solid) return { color: solid }   // BLACK / WHITE 这类纯色名：不是缺资源
    stats.images.referenced += 1
    stats.images.unresolved += 1
    if (hasIndex) count('unresolved', `image:${nameOf(name)}`)
    return null
  }
  const bgOf = (name) => imageOf(name, { color: true })

  function onCall(ev) {
    const [, name, , args] = ev
    const a = Array.isArray(args) ? args : []
    if (rx.voice.has(name)) {
      const src = (() => { stats.voices.referenced += 1; const hit = find(str(a[1]), opt.audioExts); if (hit) stats.voices.resolved += 1; else { stats.voices.unresolved += 1; if (hasIndex) count('unresolved', `voice:${str(a[1])}`) } return hit })()
      if (src) emit({ op: 'voice', src })
    } else if (rx.bgm.has(name)) {
      stats.bgm.referenced += 1
      const hit = find(str(a[1]), opt.audioExts)
      if (hit) { stats.bgm.resolved += 1; emit({ op: 'bgm', src: hit }) } else { stats.bgm.unresolved += 1; if (hasIndex) count('unresolved', `bgm:${str(a[1])}`) }
    } else if (rx.se.has(name)) {
      const hit = find(str(a[1]), opt.audioExts)
      if (hit) emit({ op: 'se', src: hit }); else if (hasIndex) count('unresolved', `se:${str(a[1])}`)
    } else if (name === '_FadeBGM') { if (num(a[2], 1) === 0) emit({ op: 'bgmStop', fade: Math.min(10, num(a[1]) / 1000) }) }
    else if (name === 'SoundStopAll') emit({ op: 'bgmStop', fade: Math.min(10, num(a[0]) / 1000) })
    else if (rx.bg.has(name)) {
      const bg = bgOf(str(a[0]))
      bgState = bg
      eventImage = null
      if (opt.clearBustsOnScene) busts = new Map()
      dirty = true
    } else if (rx.eventImage.has(name)) {
      const img = bgOf(str(a[1]))
      eventImage = img ? { slot: num(a[0]), ...img } : null
      dirty = true
    } else if (name === '_FadeSPR') { if (eventImage && num(a[0]) === eventImage.slot && num(a[1], 1) === 0) { eventImage = null; dirty = true } }
    else if (rx.bust.has(name)) {
      const body = str(a[1])
      // 参数含义出自游戏自带的 framework._bs（system.arc）：a[7] = x（相对画面中心的偏移，0x10000000 = 默认），a[8] = y，a[9] = 放大率（百分比）
      const x = num(a[7], 0)
      const y = num(a[8], 0)
      const mag = num(a[9], 0)
      const shiftX = Math.abs(x) >= 1e6 ? 0 : x
      const shiftY = Math.abs(y) >= 1e6 ? 0 : y
      const zoom = mag > 0 && mag < 1e6 && mag !== 100 ? mag / 100 : 1
      const place = { align: 'center', vcenter: true, ...(shiftX ? { shiftX } : {}), ...(shiftY ? { shiftY } : {}), ...(zoom !== 1 ? { zoom } : {}) }
      const parts = []
      const bodySrc = imageOf(body)?.src
      if (bodySrc) parts.push({ src: bodySrc, ...place })
      // 本体后面的字符串参数 = 表情 / 嘴 / 眼等部件（比本体小、有的是几帧竖着拼的图，取资源时已经只留第一帧）：attach = 左上角对齐本体的左上角。
      // 不是图的（NO01_M007 这样的「表情编号」，不是档案里的条目）不算缺资源，记进 stats.ignored
      if (bodySrc) {
        for (const [i, v] of a.entries()) {
          if (i < 2 || typeof v !== 'string' || !v) continue
          const src = find(v, opt.imageExts)
          if (src) { stats.images.referenced += 1; stats.images.resolved += 1; parts.push({ src, attach: true, ...(zoom !== 1 ? { zoom } : {}) }) } else count('ignored', 'bs:part-not-file')
        }
      }
      if (parts.length) busts.set(num(a[0]), { parts, x })
      dirty = true
    } else if (name === '_FadeBS') { if (num(a[1], 1) === 0 && busts.delete(num(a[0]))) dirty = true }
    else if (name === '_Wait') { if (opt.wait.enabled) { const seconds = Math.min(opt.wait.max, num(a[0]) / 1000); if (seconds > 0) emit({ op: 'wait', seconds }) } }
    else count('ignored', name)
  }

  function onMsg(ev) {
    const [, , , args] = ev
    const a = Array.isArray(args) ? args : []
    commit()
    let who = str(a[1])
    for (const re of rx.speakerStrip) who = who.replace(re, '')
    emit({ op: 'speaker', segments: who ? [{ text: who }] : [] })
    emit({ op: 'text', segments: segmentsOf(str(a[0]), rx) })
    stats.messages += 1
    endStep()
  }

  function onSys(ev) {
    const [, name, , args] = ev
    const a = Array.isArray(args) ? args : []
    const target = str(a[0])
    count('links', `${name}:${target}${a[1] ? `#${str(a[1])}` : ''}`)
    if (name === 'jump_scenario' && target) {
      if (guard.length) { emit({ op: 'goto', script: target }) } else nextScript = target
    }
  }

  function walk(events) {
    for (const ev of events) {
      stats.events += 1
      const kind = ev[0]
      if (kind === 'c') onCall(ev)
      else if (kind === 'k') { if (ev[1] === 0x140) onMsg(ev); else count('ignored', `cmd:0x${num(ev[1]).toString(16)}`) }
      else if (kind === 's') onSys(ev)
      else if (kind === 'x') onChoice(ev)
    }
  }

  function onChoice(ev) {
    const [, , , options, branches] = ev
    const opts = Array.isArray(options) ? options.map(str) : []
    commit()
    stats.choices += 1
    // 选项挂在「问题那句台词」的步里（问题留在文本框里）；前面还有没发出去的指令 / 前一步不是台词时才自己一步（带一句空台词）
    const prev = !commands.length && steps.length ? steps[steps.length - 1] : null
    const host = prev && prev.commands.some((c) => c.op === 'text' && c.segments.length) && !prev.commands.some((c) => c.op === 'choice') ? prev : null
    const stepIndex = host ? host.index : steps.length
    const variable = `sel${stepIndex}`
    const into = host ? host.commands : commands
    const outer = guard
    into.push({ op: 'choice', id: `${stepIndex}:${into.length}`, var: variable, options: opts.map((text, n) => ({ value: n + 1, segments: [{ text }] })), ...(guard.length ? { when: guard } : {}) })
    if (!host) { into.push({ op: 'text', segments: [], ...(guard.length ? { when: guard } : {}) }); endStep() }
    const saved = { bgState, eventImage, busts: new Map(busts) }
    for (const [n, events] of (Array.isArray(branches) ? branches : []).entries()) {
      bgState = saved.bgState
      eventImage = saved.eventImage
      busts = new Map(saved.busts)
      guard = [...outer, { var: variable, op: '==', value: n + 1 }]
      resetShown()
      walk(Array.isArray(events) ? events : [])
      commit()
      if (commands.length) { emit({ op: 'text', segments: [] }); endStep() }
    }
    guard = outer
    resetShown()
  }

  walk(data.events)
  commit()
  if (commands.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((n, step) => n + step.commands.length, 0)
  return { steps, stats, ...(nextScript ? { next: { script: nextScript } } : {}) }
}

export const bgiBsAdapter = { id: ADAPTER_ID, label: 'BGI / Ethornell（BurikoCompiledScript，经 containers 展开）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
