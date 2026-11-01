// 适配器：KiriKiri Z（Wamsoft，Hxv4 加密的 xp3）的场景脚本（scn.xp3 里的 PSB，由 containers.mjs 解密 + krkr-scn.mjs 压成 JSON）→ 规范场景（gal-scene/1）。
// id = krkr::scn：引擎家族 krkr 的脚本适配器，家族里所有游戏（game.id = krkr::<游戏>）共用。
//
// 输入：{"format":"krkr-scn/1","arc","name","scenes":[{label,title,nexts,steps:[{t,n,v,l,b,pre}]}]}
//   步：t = 台词（\n 换行）、n = 说话人、v = 语音名、l = 图层 [名字, 类别, 文件, options, posName, showmode(3 显示 / 0 隐藏), actions]、b = [bgm 文件, 状态(1 = 在放), 音量, 循环]、pre = [[命令, 参数…]]
// 映射：
//   台词 → speaker + text；语音 → voice；bgm 文件变了 / 状态 0 → 1 → bgm，状态变 0 → bgmStop；
//   图层 bg（stage，showmode 3）→ bg（文件 = 图名，图在 image.xp3 / data.xp3 里是 .png / .jpg；`width,1,height,1,color,0xff000000` 这种是纯色）；
//   图层 ev（event，showmode 3）= 事件 CG → 盖在 bg 上（当成 bg 换掉，去掉后回到背景）；
//   pre 里的 wait → wait（秒，最多 10）；playvoice（背景语音 type 2）/ quake / stopvoice 不渲染，记 stats.ignored
//   多个 scene（脚本里的 *start / *dummy1 …）按顺序接在一起；最后一个 scene 的 nexts 指向别的脚本（不是 gameloop.txt 的菜单）→ scene.next
// 没做 / 推断：
//   · 立绘（class character，imageFile.file = cha001.stand + options { dress, face, pose, add }）：是 fgimage.xp3 里的 PIMG（PSB 分层图，每层一张 TLG）按 options 选图层——这一版还没做，记 stats.ignored['character']
//   · 每步的图层是脚本自带的「此刻的环境快照」（texts[i][4].data），不重放 envupdate；没有台词也没有等待的画面变化会并进下一句
//   · 转场（crossfade 等）/ 镜头动作（xpos / ypos / zpos 的移动）不渲染
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'krkr::scn'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  stage: [1920, 1080],
  imageExts: ['png', 'jpg'],
  audioExts: ['ogg', 'opus', 'wav', 'mp3'],
  wait: { enabled: true, max: 10 },
  menuScripts: ['^gameloop'],   // nexts 指向这些脚本（返回菜单）= 播完了，不接着播
  extraDirs: [],
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"krkr-scn\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 512))
export const explainSniff = () => '开头不是 {"format":"krkr-scn/1"…（这个适配器吃 containers 从 KiriKiri 的 scn.xp3 里解出来的场景 JSON，不是原始 PSB）'

export const contextFiles = () => []
export const contextDirs = (options) => { const opt = readOptions(options); return [opt.resDir, ...opt.extraDirs].map((dir) => String(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean) }
export const contextTextFilter = () => () => false
export const contextWalkLimit = 800000
export const contextSampleLimit = 200

export function prepare({ options, files, toResourcePath, resourceResolve, truncated }) {
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  for (const rel of files || []) resources.add(toRes(rel))
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  return { opts: opt, resources, resolver, hasIndex: Boolean(files?.length), truncated: Boolean(truncated) }
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
  const stats = { events: 0, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, raw: {}, ignored: {}, unresolved: {}, links: {} }
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
  const imageOf = (file) => {
    const color = colorOf(file)
    if (color) return { color }
    const src = find(file, opt.imageExts)
    stats.images.referenced += 1
    if (src) { stats.images.resolved += 1; return { src } }
    stats.images.unresolved += 1
    if (hasIndex) count('unresolved', `image:${file}`)
    return null
  }
  function applyLayers(layers) {
    let bg = null
    let ev = null
    let characters = 0
    for (const l of layers || []) {
      if (!Array.isArray(l)) continue
      const [name, cls, file, , , showmode] = l
      if (showmode !== 3) continue
      if (cls === 'stage' && name === 'bg' && file) bg = file
      else if (cls === 'event' && name === 'ev' && file) ev = file
      else if (cls === 'character') characters += 1
    }
    const want = ev || bg || ''
    if (want !== shown) {
      shown = want
      if (!want) emit({ op: 'bgoff' })
      else { const img = imageOf(want); if (img) emit({ op: 'bg', ...img }); else emit({ op: 'bgoff' }) }
    }
    if (characters) stats.ignored.character = (stats.ignored.character || 0) + 1
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
      applyLayers(step.l)
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
