// 适配器：KiriKiri Z（Wamsoft，Hxv4 加密的 xp3）的场景脚本（scn.xp3 里的 PSB，由 containers.mjs 解密 + krkr-scn.mjs 压成 JSON）→ 规范场景（gal-scene/1）。
// id = krkr::scn：引擎家族 krkr 的脚本适配器，家族里所有游戏（game.id = krkr::<游戏>）共用。
//
// 输入：{"format":"krkr-scn/1","arc","name","scenes":[{label,title,nexts,steps:[{t,n,v,l,b,pre}]}]}
//   步：t = 台词（\n 换行）、n = 说话人、v = 语音名、l = 图层 [名字, 类别, 文件, options, posName, showmode(3 显示 / 0 隐藏), actions]、b = [bgm 文件, 状态(1 = 在放), 音量, 循环]、pre = [[命令, 参数…]]
// 映射：
//   台词 → speaker + text；语音 → voice；bgm 文件变了 / 状态 0 → 1 → bgm，状态变 0 → bgmStop；
//   图层 bg（stage，showmode 3）→ bg（文件 = 图名，图在 image.xp3 / data.xp3 里是 .png / .jpg；`width,1,height,1,color,0xff000000` 这种是纯色）；
//   图层 ev（event，showmode 3）= 事件 CG → 盖在 bg 上（当成 bg 换掉，去掉后回到背景；ev 的图取不到——mpg 视频、没采到——就退回背景）；
//     ev 是 .l2d（Live2D 模型包）→ live2d 指令（src = 虚拟的 <名字>.l2d/<名字>.model3.json；options 的 motion / loop / variables 原样带上），底下的背景照常显示；模型取不到记 unresolved；
//   pre 里的 wait → wait（秒，最多 10）；playvoice（背景语音 type 2）/ quake / stopvoice 不渲染，记 stats.ignored
//   多个 scene（脚本里的 *start / *dummy1 …）按顺序接在一起；最后一个 scene 的 nexts 指向别的脚本（不是 gameloop.txt 的菜单）→ scene.next
// 没做 / 推断：
//   立绘（class character，imageFile.file = cha001.stand + options { dress, face, pose, add }，showmode 3 = 显示）→ 每个角色一个槽位（slot = 角色名）的 stand：PIMG（cha001.pimg，分层 PSB，每层一张 TLG）按 options 选图层
//     （dress + pose → 身体、face、add 用 ':' 隔开的各项；映射表 = <名字>.sinfo.json，没有就按层名猜，见 krkr-pimg.mjs），每层一个部件，部件的位置 = 层在画布里的位置；containers 把 PIMG 虚拟成 <名字>.pimg.json（层表）和 <名字>.pimg/<层 id>.png（每层转好的 PNG）。
//     位置 / 缩放（推断，没有对照图）：缩放 = leveloffset 的第 4 项（百分比）× 舞台高 ÷ 画布高（真实 PIMG：身体 1948 高 / 画布 2246 高，111% 时正好 ≈ 舞台高）；水平 = action.xpos，没有按 posName（左 -480 / 右 480 / 左中 -240 / 右中 240 / 其余居中）；
//     缩放后身体不超过舞台高 = 画布底边对齐舞台底边，否则（特写）头顶落在舞台上方 5% 处。leveloffset 的 y、zpos、order 没用。想调就用播放器「设置 → 画面 → 立绘」。
//   · 每步的图层是脚本自带的「此刻的环境快照」（texts[i][4].data），不重放 envupdate；没有台词也没有等待的画面变化会并进下一句
//   · 转场：envupdate 的 trans（crossfade / universal 遮罩擦除 / mosaic / ripple / rotateswap，时长毫秒）→ 换背景 / 事件图时的 fade 秒数（全部近似成淡入淡出，方式记 stats.transitions）；没写时长的转场不淡
//   · 镜头动作（xpos / ypos / zpos / zoom）不渲染：真实脚本里背景 / 事件图上没有 MoveAction（只有立绘上的 RandomAction / SinAction 抖动），静态的偏移 / 缩放量的原点和单位没法对照验证
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'
import { pickPimgLayers } from '../krkr-pimg.mjs'

export const ADAPTER_ID = 'krkr::scn'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  stage: [1920, 1080],
  imageExts: ['png', 'jpg'],
  audioExts: ['ogg', 'opus', 'wav', 'mp3'],
  wait: { enabled: true, max: 10 },
  transitionMax: 3,   // 转场淡入淡出最多几秒（0 = 不要转场）
  menuScripts: ['^gameloop'],   // nexts 指向这些脚本（返回菜单）= 播完了，不接着播
  extraDirs: [],
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"krkr-scn\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 512))
export const explainSniff = () => '开头不是 {"format":"krkr-scn/1"…（这个适配器吃 containers 从 KiriKiri 的 scn.xp3 里解出来的场景 JSON，不是原始 PSB）'

export const contextFiles = () => []
export const contextDirs = (options) => { const opt = readOptions(options); return [opt.resDir, ...opt.extraDirs].map((dir) => String(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean) }
export const contextTextFilter = () => (rel) => /\.(pimg|sinfo)\.json$/i.test(rel)   // 立绘的层表 / 选项表（containers 虚拟出来的，很小）
export const contextWalkLimit = 800000
export const contextSampleLimit = 2000

export function prepare({ options, files, texts, toResourcePath, resourceResolve, truncated }) {
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  for (const rel of files || []) resources.add(toRes(rel))
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  const lowerTexts = new Map()   // 资源路径（小写）→ 文本
  for (const [rel, text] of Object.entries(texts || {})) lowerTexts.set(toRes(rel).toLowerCase(), text)
  const json = new Map()
  const readJson = (resPath) => {
    const key = String(resPath || '').toLowerCase()
    if (!key) return null
    if (!json.has(key)) { try { json.set(key, JSON.parse(lowerTexts.get(key) || 'null')) } catch { json.set(key, null) } }
    return json.get(key)
  }
  return { opts: opt, resources, resolver, hasIndex: Boolean(files?.length), truncated: Boolean(truncated), readJson }
}

const str = (v) => (typeof v === 'string' ? v : '')
// width,1,height,1,color,0xff000000 → [r, g, b]
const COLOR_FILE = /^width,\d+,height,\d+,color,0x([0-9a-f]{8})$/i
const colorOf = (file) => { const m = COLOR_FILE.exec(file); if (!m) return null; const v = parseInt(m[1], 16); return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255] }

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || data.format !== 'krkr-scn/1' || !Array.isArray(data.scenes)) throw new Error('不是 krkr-scn/1 场景')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { events: 0, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, live2d: 0, raw: {}, ignored: {}, unresolved: {}, links: {}, transitions: {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const find = (name, exts) => {
    const wanted = String(name || '').replace(/\\/g, '/').replace(/^.*\//, '')
    if (!wanted || !hasIndex) return ''
    let hit = ctx.resolver.resolveByName(wanted)
    if (hit) return hit
    for (const ext of exts) { hit = ctx.resolver.resolveByName(`${wanted}.${ext}`); if (hit) return hit }
    return ''
  }
  const menus = (opt.menuScripts || []).map((s) => { try { return new RegExp(s, 'i') } catch { return null } }).filter(Boolean)
  const steps = []
  let commands = []
  const emit = (command) => commands.push(command)
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  // 当前显示：背景（bg）+ 事件 CG（ev）；变了才发
  let shown = ''
  let bgm = { file: null, playing: false }
  const imageCache = new Map()   // 图名 → 解析结果（同一张图只算一次，统计也只计一次）
  const imageOf = (file) => {
    if (imageCache.has(file)) return imageCache.get(file)
    const color = colorOf(file)
    let result
    if (color) result = { color }
    else {
      const src = find(file, opt.imageExts)
      stats.images.referenced += 1
      if (src) { stats.images.resolved += 1; result = { src } } else {
        stats.images.unresolved += 1
        if (hasIndex) count('unresolved', `image:${file}`)
        result = null
      }
    }
    imageCache.set(file, result)
    return result
  }
  // 立绘：槽位（角色名）→ 上次发出去的签名；变了才发
  const shownStands = new Map()
  const stageW = opt.stage[0]
  const stageH = opt.stage[1]
  const POS_X = { 左: -480, 右: 480, 左中: -240, 右中: 240 }
  function standOf(layer) {
    const [name, , file, options, posName, , actions] = layer
    const stem = String(file || '').replace(/\.[^.]+$/, '')
    if (!stem) return null
    const infoPath = hasIndex ? ctx.resolver.resolveByName(`${stem}.pimg.json`) : ''
    const info = infoPath ? ctx.readJson?.(infoPath) : null
    if (!info?.layers) { if (hasIndex) count('unresolved', `pimg:${stem}`); return null }
    const act = Object.fromEntries((actions || []).map((a) => [a[0], a[1]]))
    const pct = Number(String(act.leveloffset || '').split(',')[3])
    const zoom = (Number.isFinite(pct) && pct > 0 ? pct / 100 : 1) * (stageH / info.height)
    const xpos = Number(act.xpos)
    const x = Number.isFinite(xpos) ? xpos : POS_X[posName] ?? 0
    const sinfoPath = ctx.resolver.resolveByName(`${stem}.sinfo.json`)
    const { ids, missing } = pickPimgLayers(info, options || {}, sinfoPath ? ctx.readJson?.(sinfoPath) : null)
    for (const m of missing) count('ignored', `pimg-layer:${m}`)
    if (!ids.length) return null
    const byId = new Map(info.layers.map((l) => [l[0], l]))   // 层 = [id, 名, 组, left, top, w, h, 可见, 类别, 资源号]
    const bodyTop = Math.min(...ids.map((id) => byId.get(id)[4]))
    const bodyBottom = Math.max(...ids.map((id) => byId.get(id)[4] + byId.get(id)[6]))
    // 画布中心相对舞台中心的竖直偏移：身体放大后没超过舞台 = 画布底边贴舞台底边；超过（特写）= 头顶在舞台上方 5%
    const fits = (bodyBottom - bodyTop) * zoom <= stageH * 1.05
    const y = fits ? (stageH - info.height * zoom) / 2 : (0.05 * stageH - bodyTop * zoom + (info.height * zoom) / 2) - stageH / 2
    const parts = ids.map((id) => {
      const l = byId.get(id)
      return { src: `${stem}.pimg/${id}.png`, x: Math.round(x + (l[3] + l[5] / 2 - info.width / 2) * zoom), y: Math.round(y + (l[4] + l[6] / 2 - info.height / 2) * zoom), scale: Math.round(zoom * 10000) / 10000 }
    })
    return { slot: String(name), parts }
  }
  let shownL2d = ''
  function l2dOf({ file, options }) {
    const stem = String(file).replace(/\.l2d$/i, '')
    const src = hasIndex ? ctx.resolver.resolveByName(`${stem}.model3.json`) : ''
    if (!src) { if (hasIndex) count('unresolved', `l2d:${stem}`); return null }
    const o = options && typeof options === 'object' ? options : {}
    const variables = o.variables && typeof o.variables === 'object' && Object.keys(o.variables).length ? o.variables : null
    return { src, ...(typeof o.motion === 'string' && o.motion ? { motion: o.motion } : {}), ...(o.loop === true || o.loop === 'true' ? { loop: true } : {}), ...(variables ? { variables } : {}) }
  }
  function applyLayers(layers, tr) {
    let bg = null
    let ev = null
    let l2d = null
    for (const l of layers || []) {
      if (!Array.isArray(l)) continue
      const [name, cls, file, options, , showmode] = l
      if (showmode !== 3) continue
      if (cls === 'stage' && name === 'bg' && file) bg = file
      else if (cls === 'event' && name === 'ev' && file) { if (/\.l2d$/i.test(file)) l2d = { file, options } ; else ev = file }
    }
    // 事件 CG（ev）盖在背景上；ev 的图取不到（Live2D 的 .l2d、mpg 视频、没采到）= 退回背景，不要黑屏
    let img = ev ? imageOf(ev) : null
    let want = img ? ev : ''
    if (!img && bg) { img = imageOf(bg); want = img ? bg : '' }
    if (want !== shown) {
      shown = want
      // 转场（envupdate 的 trans）：不管 crossfade / universal（遮罩擦除）/ mosaic / ripple / rotateswap，都近似成同样时长的淡入淡出；方式记进 stats.transitions（看得出哪些是近似的）
      const fade = Array.isArray(tr) && tr[1] > 0 ? Math.min(opt.transitionMax, tr[1] / 1000) : 0
      if (Array.isArray(tr)) count('transitions', `${tr[0]}${tr[2] ? `:${tr[2]}` : ''}`)
      if (!img) emit({ op: 'bgoff', ...(fade ? { fade } : {}) }); else emit({ op: 'bg', ...img, ...(fade ? { fade } : {}) })
    }
    // Live2D（ev 层的 .l2d）：model3.json 在虚拟索引里（containers 把 .l2d ZIP 展开成 <名字>.l2d/<成员>）；底下的背景照常显示
    const spec = l2d ? l2dOf(l2d) : null
    const l2dSig = spec ? JSON.stringify(spec) : ''
    if (l2dSig !== shownL2d) { shownL2d = l2dSig; emit(spec ? { op: 'live2d', ...spec } : { op: 'live2dOff' }); if (spec) stats.live2d += 1 }
    // 立绘：每个显示着的角色一个槽位；没了的去掉
    const now = new Map()
    for (const l of layers || []) {
      if (!Array.isArray(l) || l[1] !== 'character' || l[5] !== 3) continue
      const stand = standOf(l)
      if (stand) now.set(stand.slot, stand)
      else if (l[2]) count('ignored', 'character')
    }
    for (const slot of [...shownStands.keys()]) if (!now.has(slot)) { emit({ op: 'standOff', slot }); shownStands.delete(slot) }
    for (const [slot, stand] of now) {
      const sig = JSON.stringify(stand.parts)
      if (shownStands.get(slot) === sig) continue
      emit({ op: 'stand', slot, parts: stand.parts, stage: [stageW, stageH], ...(shownStands.has(slot) ? {} : { fade: 0.25 }) })
      shownStands.set(slot, sig)
      stats.stands += 1
    }
  }
  function applyBgm(b) {
    if (!Array.isArray(b)) return
    const [file, state] = b
    const playing = state === 1
    if (playing && file && (file !== bgm.file || !bgm.playing)) {
      stats.bgm.referenced += 1
      const hit = find(file, opt.audioExts)
      if (hit) { stats.bgm.resolved += 1; emit({ op: 'bgm', src: hit }) } else { stats.bgm.unresolved += 1; if (hasIndex) count('unresolved', `bgm:${file}`) }
      bgm = { file, playing: true }
    } else if (!playing && bgm.playing && (state === 0)) { emit({ op: 'bgmStop', fade: 1 }); bgm = { file, playing: false } }
  }

  let next = null
  for (const scene of data.scenes) {
    for (const step of scene.steps || []) {
      stats.events += 1
      for (const pre of step.pre || []) {
        if (pre[0] === 'wait') { if (opt.wait.enabled) { const seconds = Math.min(opt.wait.max, Number(pre[1]) / 1000); if (seconds > 0) emit({ op: 'wait', seconds }) } } else count('ignored', pre[0])
      }
      applyLayers(step.l, step.tr)
      applyBgm(step.b)
      if (typeof step.v === 'string') {
        stats.voices.referenced += 1
        const hit = find(step.v, opt.audioExts)
        if (hit) { stats.voices.resolved += 1; emit({ op: 'voice', src: hit }) } else { stats.voices.unresolved += 1; if (hasIndex) count('unresolved', `voice:${step.v}`) }
      }
      if (typeof step.t === 'string') {
        emit({ op: 'speaker', segments: step.n ? [{ text: step.n }] : [] })
        emit({ op: 'text', segments: step.t ? [{ text: step.t }] : [] })
        stats.messages += 1
      } else emit({ op: 'text', segments: [] })
      endStep()
    }
  }
  const lastScene = data.scenes[data.scenes.length - 1]
  const storage = str((lastScene?.nexts || [])[0]?.storage).replace(/\.txt$/i, '')
  if (storage && storage !== data.name && !menus.some((re) => re.test(storage))) { next = { script: storage }; count('links', `script:${storage}`) }
  if (commands.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((n, step) => n + step.commands.length, 0)
  return { steps, stats, ...(next ? { next } : {}) }
}

export const krkrScnAdapter = { id: ADAPTER_ID, label: 'KiriKiri Z（Hxv4，经 containers 解密）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
