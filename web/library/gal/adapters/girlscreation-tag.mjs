// 适配器：Girls Creation R Viewer（NW.js 查看器）的剧情 → 规范场景（gal-scene/1）。
// 目录（<root> = package.nw，所在位置记在 config.adapterOptions['girlscreation-tag'].root）：
//   <root>/scenes/<场景 id>/script.txt            标签式脚本（每个场景都有；本适配器解析它）；新版数据里叫 output_script.txt（没有 script.txt 时用它）
//   <root>/scenes/<场景 id>/{images,videos,voices,animations,spines}/   这个场景自己的背景图 / 视频 / 语音 / Spine 骨骼
//   <root>/scenes/<场景 id>/script_original.txt 等   游戏原始的逗号式脚本（只有部分场景有，文件名还不统一；不解析，只拿来取标题：title,<标题>,）
//   <root>/data/audio/{bgm,se}/<名>.m4a            全局 BGM / 音效
// 标签式脚本：一行一个 <TAG>参数（一行里可以连着几个标签），<NAME_PLATE>说话人 + 下一行起的正文 + <PAUSE> = 一句台词（一步）；正文里 [br] 是换行。
//   <BG>名,NONE,0,缩放,x,y            背景图（场景自己的 images/<名>.* ；缩放 / 位移暂不渲染，记在 stats.raw 里）   <BG_OUT>ms 去掉背景
//   <FADE_OUT2>black,ms / <FADE_IN2>black|white,ms   黑场渐入 / 渐出，白场闪    <WAIT2>ms 等待
//   <BGM_PLAY>名,0, / <BGM_STOP>ms     data/audio/bgm      <SE_PLAY>通道,名,TRUE|FALSE,音量,0 / <SE_STOP>通道,ms   data/audio/se（循环的走背景音效声道）
//   <VOICE_PLAY>名 / <VOICE_SINGLE_PLAY>名    voices/<名>.*     <VIDEO_PLAY>名,loop,通道 / <VIDEO_STOP>   videos/<名>.*
//   <SPINE_ACTOR>槽,骨架名,,初始动画,,0,淡入ms,x=..|y=..,缩放,skel     放一个 Spine 角色（槽 1~4）：spine 指令（kind actor）；第 4 项是出场时播的动画（轨道 0，循环；maid 里写的是表情预设名，如「通常」）
//   <SPINE_ACTOR_PLAY>槽,动画,轨道,循环      轨道 0 身体、轨道 1 表情（ex_<名>）——两条轨道同时播；<SPINE_ACTOR_TRACK>槽,轨道,动画,循环 同样给某条轨道设动画（参数顺序不同）
//   <SPINE_ACTOR_SHAKE>槽,x,y,时长            角色抖动（衰减的来回晃，时长按 60 = 1 秒）
//   <SPINE_ACTOR_MOVE>槽,x,y,ms,FALSE / <SPINE_ACTOR_OUT>槽,淡出ms
//   别的（SCREEN_SHAKE、EFFECT_BG_BLUR、BG_SCALE、SE_VOLUME、SPINE_MASK_OPACITY、*_COLOR、UI_DISP …）认得但暂未渲染，记在 stats.raw 里
// 列表（adapter.catalog）：分类（场景 id 前缀 chmr / chsr …）→ 主要说话人（场景里出现最多的非「館長」的名字）→ 场景（标题取自原始脚本里的 title 行，没有就用 id；封面 = thumbnail.png）。
// 目录树每次从文件现读（上下文按目录变化失效）。

import { lineSpeakers, lineTitle, parseLine, sniffLine } from './girlscreation-line.mjs'

export const ADAPTER_ID = 'girlscreation-tag'
const DEFAULT_OPTIONS = { root: '', categoryLabels: {}, player: '館長' }
const IMAGE_EXTS = /\.(?:webp|png|jpe?g|avif|gif)$/i
const SAMPLE_FILE = /\/(?:script\.txt|output_script\.txt|script_original\.txt|original_script\.txt|originial_script\.txt|h[ms]r_\d+\.txt)$/i

const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => String(options?.root || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

// ---------- 上下文：场景索引 + 全局音频索引 + 标题 / 主要说话人 ----------
export const contextFiles = () => []
export const contextDirs = (options) => [joinPath(rootOf(options), 'scenes'), joinPath(rootOf(options), 'data/audio'), joinPath(rootOf(options), 'data/spine')]
export const contextTextFilter = (options) => {
  const base = `${joinPath(rootOf(options), 'scenes')}/`
  return (rel) => rel.startsWith(base) && SAMPLE_FILE.test(rel)
}

// 标签式脚本：把一行拆成 [{ tag, arg }]（一行里可以连着几个标签）
const TAG_RE = /<([A-Z][A-Z0-9_]*)>([^<]*)/g
export function tagsOf(line) {
  const out = []
  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(line); m; m = TAG_RE.exec(line)) out.push({ tag: m[1], arg: m[2].trim() })
  return out
}

export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 8192)
  return (/^<NAME_PLATE>/m.test(head) && /^<PAUSE>/m.test(head)) || sniffLine(head)   // 标签式（script.txt）或行式（hmr_/hsr_<id>.txt）
}

export function prepare({ options, texts, files, toResourcePath, truncated = false }) {
  const root = rootOf(options)
  const toRes = toResourcePath || ((rel) => rel)
  const scenesBase = `${joinPath(root, 'scenes')}/`
  const audioBase = `${joinPath(root, 'data/audio')}/`
  const spineBase = `${joinPath(root, 'data/spine')}/`
  const globalSpines = new Map()   // 全局骨架（maid：data/spine/cast/<目录>/<文件>）：键 = <目录>/<文件名> 和 <文件名>，值 = 扩展名 → 资源路径
  const scenes = new Map()   // 场景 id → { id, script, thumb, images: Map(无扩展名文件名 → 资源路径), videos, voices, spines: Map }
  const audio = { bgm: new Map(), se: new Map() }
  const sceneOf = (id) => {
    if (!scenes.has(id)) scenes.set(id, { id, script: '', thumb: '', images: new Map(), videos: new Map(), voices: new Map(), bgvoices: new Map(), animations: new Map(), spines: new Map() })
    return scenes.get(id)
  }
  const stem = (name) => name.replace(/\.[^.]+$/, '')
  for (const rel of files || []) {
    if (rel.startsWith(scenesBase)) {
      const parts = rel.slice(scenesBase.length).split('/')
      if (parts.length < 2) continue
      const scene = sceneOf(parts[0])
      if (parts.length === 2) {
        if (parts[1] === 'script.txt') scene.script = rel
        else if (/^h[ms]r_[^/]+\.txt$/i.test(parts[1])) { if (!scene.lineScript) scene.lineScript = rel }   // 没有标签式脚本的场景只有行式脚本（hmr_<id>.txt / hsr_<id>.txt）
        else if (parts[1] === 'output_script.txt') scene.altScript = rel   // 新版数据里的场景没有 script.txt，标签式脚本叫 output_script.txt；script.txt 优先
        else if (/^thumbnail\.(?:png|jpe?g|webp)$/i.test(parts[1])) scene.thumb = toRes(rel)
      } else if (parts.length === 4 && parts[1] === 'spines') {   // spines/<目录>/<文件>：骨架名 = <目录>/<文件名>（脚本里写 cast010002/momiji_002）
        const ext = parts[3].slice(parts[3].lastIndexOf('.') + 1).toLowerCase()
        const key = `${parts[2]}/${stem(parts[3])}`
        if (!scene.spines.has(key)) scene.spines.set(key, new Map())
        scene.spines.get(key).set(ext, toRes(rel))
      } else if (parts.length === 3) {
        if (parts[1] === 'spines') {   // 同名同目录的 .skel / .atlas / .png：按扩展名分开记（不然谁先到谁占位）
          const ext = parts[2].slice(parts[2].lastIndexOf('.') + 1).toLowerCase()
          if (!scene.spines.has(stem(parts[2]))) scene.spines.set(stem(parts[2]), new Map())
          scene.spines.get(stem(parts[2])).set(ext, toRes(rel))
          continue
        }
        const bucket = { images: scene.images, videos: scene.videos, voices: scene.voices, bgvoices: scene.bgvoices, animations: scene.animations }[parts[1]]
        if (bucket && !bucket.has(stem(parts[2]))) bucket.set(stem(parts[2]), toRes(rel))
      }
    } else if (rel.startsWith(spineBase)) {
      const parts = rel.slice(spineBase.length).split('/')
      const file = parts[parts.length - 1]
      const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
      const base = stem(file)
      for (const key of new Set([base, parts.length >= 2 ? `${parts[parts.length - 2]}/${base}` : base])) {
        if (!globalSpines.has(key)) globalSpines.set(key, new Map())
        globalSpines.get(key).set(ext, toRes(rel))
      }
    } else if (rel.startsWith(audioBase)) {
      const parts = rel.slice(audioBase.length).split('/')
      if (parts.length === 2 && audio[parts[0]] && !audio[parts[0]].has(stem(parts[1]))) audio[parts[0]].set(stem(parts[1]), toRes(rel))
    }
  }
  for (const scene of scenes.values()) if (!scene.script) scene.script = scene.altScript || scene.lineScript || ''   // 优先级：script.txt > output_script.txt > 行式脚本
  const noScript = []
  for (const [id, scene] of scenes) if (!scene.script) { noScript.push(id); scenes.delete(id) }   // 没有脚本的目录（PLACEHOLDER 之类）不是场景；记下来给体检报

  const player = String(options?.player ?? DEFAULT_OPTIONS.player)
  const info = new Map()   // 场景 id → { title, speaker }
  for (const [id, scene] of scenes) {
    const dir = scene.script.slice(0, scene.script.lastIndexOf('/') + 1)
    let title = scene.script === scene.lineScript ? lineTitle(texts?.[scene.script]) : ''
    for (const [rel, text] of Object.entries(texts || {})) {
      if (title) break
      if (!rel.startsWith(dir) || rel === scene.script) continue
      const m = /^title,([^,\r\n]+),/m.exec(String(text))
      if (m) { title = m[1].trim(); break }
    }
    const counts = new Map()
    for (const m of String(texts?.[scene.script] || '').matchAll(/^<NAME_PLATE>([^\r\n<]+)/gm)) {
      const name = m[1].trim().replace(/（[^）]*）$/, '')   // 去掉「（オルタ）」这类括号后缀，同一个人归一起
      if (name && name !== player) counts.set(name, (counts.get(name) || 0) + 1)
    }
    if (scene.script === scene.lineScript) for (const name of lineSpeakers(texts?.[scene.script])) if (name !== player) counts.set(name.replace(/（[^）]*）$/, ''), (counts.get(name.replace(/（[^）]*）$/, '')) || 0) + 1)
    const speaker = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    info.set(id, { title, speaker })
  }
  const categoryLabels = { ...(options?.categoryLabels && typeof options.categoryLabels === 'object' ? options.categoryLabels : {}) }
  return { root, scenes, audio, info, categoryLabels, truncated, noScript, globalSpines }
}

// ---------- 列表 ----------
const natAsc = (a, b) => a.localeCompare(b, 'en', { numeric: true })
export function catalog(ctx) {
  if (!ctx?.scenes?.size) return null
  const categories = new Map()   // 分类 → Map(说话人 → [场景])
  for (const id of [...ctx.scenes.keys()].sort(natAsc)) {
    const category = /^[A-Za-z]+/.exec(id)?.[0] || '其他'   // chmr_… / chara_… / story… → 开头的字母；数字开头（10001A5_R18）→ 其他
    const who = ctx.info.get(id)?.speaker || '（未识别）'
    if (!categories.has(category)) categories.set(category, new Map())
    const groups = categories.get(category)
    if (!groups.has(who)) groups.set(who, [])
    groups.get(who).push(id)
  }
  const sceneItem = (category, who, id) => {
    const scene = ctx.scenes.get(id)
    const title = ctx.info.get(id)?.title || ''
    return { id: `s/${id}`, title: title || id, subtitle: title ? id : '', thumb: scene.thumb, badge: category, script: scene.script }
  }
  const children = [...categories.entries()].sort((a, b) => natAsc(a[0], b[0])).map(([category, groups]) => {
    const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || natAsc(a[0], b[0]))
    const count = ordered.reduce((n, [, ids]) => n + ids.length, 0)
    return {
      id: `c/${category}`,
      title: ctx.categoryLabels[category] || category,
      subtitle: `${count} 个剧情 · ${ordered.length} 位${ctx.truncated ? ' · ⚠ 文件索引被截断，场景可能不全' : ''}`,
      thumb: ctx.scenes.get(ordered[0][1][0])?.thumb || '',
      children: ordered.map(([who, ids]) => ({
        id: `c/${category}/${who}`,
        title: who,
        subtitle: `${ids.length} 个剧情`,
        thumb: ctx.scenes.get(ids[0])?.thumb || '',
        badge: category,
        children: ids.map((id) => sceneItem(category, who, id)),
      })),
    }
  })
  return { children }
}

// ---------- 解析 ----------
const secs = (ms, fallback = 0) => { const n = Number.parseFloat(ms); return Number.isFinite(n) ? Math.max(0, Math.min(60, n / 1000)) : fallback }
const numOf = (text, fallback = 0) => { const n = Number.parseFloat(text); return Number.isFinite(n) ? n : fallback }
const bool = (text) => /^(?:true|1|loop)$/i.test(String(text || '').trim())
const splitArgs = (arg) => String(arg).split(',').map((s) => s.trim())
const cleanText = (lines) => lines.join('\n').replace(/\[br\]/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

// x=100|y=0 → { x: 100, y: 0 }
function parseProps(text) {
  const out = {}
  for (const part of String(text || '').split('|')) {
    const m = /^\s*(\w+)\s*=\s*(-?[\d.]+)/.exec(part)
    if (m) out[m[1]] = Number.parseFloat(m[2])
  }
  return out
}

export function parse(text, ctx = null, meta = {}) {
  if (!/^<[A-Z]/m.test(String(text || '').slice(0, 8192)) && sniffLine(String(text || '').slice(0, 8192))) return parseLine(text, ctx, meta)   // 行式脚本
  const steps = []
  let commands = []
  let lines = []            // 当前这句的正文行
  let name = null           // <NAME_PLATE> 之后的说话人（null = 这一步还没出现 NAME_PLATE）
  let speaker = ''
  let loopSe = false        // 背景音效声道里有没有在循环播的
  let movieOn = false
  const sceneId = String(meta?.rel || '').split('/')[0]
  const scene = ctx?.scenes?.get(sceneId) || null
  const stats = { commands: 0, raw: {}, unresolved: {}, movies: 0, spines: 0 }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  if (ctx?.truncated) count('unresolved', '文件索引被截断（超过上限）：这个场景的资源可能找不到')
  const emit = (command) => { commands.push(command) }
  let zoomScale = 1          // 全局 ZOOM：之后放出来的角色缩放 = 角色自己的缩放 × zoomScale；已经在场的角色缩放直接变成 zoomScale（原查看器就是这么做的）
  const waiting = new Map() // 槽 → 角色还没出现时先收到的动画
  const actors = new Map()  // 槽 → { skel, x, y, scale, fade, move, tracks: [{ anim, loop }] }
  const dirty = new Set()
  let shakeId = 0
  const flushActors = () => {
    for (const slot of dirty) {
      const actor = actors.get(slot)
      if (!actor) continue
      const files = scene?.spines?.get(actor.skel) || ctx?.globalSpines?.get(actor.skel)   // 场景自己的 spines/ 优先，没有再找全局的（maid 的角色在 data/spine/cast/…）
      const skelRes = files?.get('skel') || files?.get('bytes') || files?.get('json') || ''
      const atlasRes = files?.get('atlas') || files?.get('txt') || ''
      if (!skelRes || !atlasRes) { count('unresolved', `spine:${actor.skel}`); continue }
      stats.spines += 1
      emit({
        op: 'spine', slot: `Actor${slot}`, kind: 'actor', skel: skelRes, atlas: atlasRes,
        x: actor.x, y: actor.y, scale: actor.scale, fade: actor.fade,
        ...(actor.move ? { move: actor.move } : {}),
        ...(actor.shake ? { shake: actor.shake } : {}),   // 同一个 id 只抖一次（后面同一角色再发 spine 指令不会重抖）
        tracks: actor.tracks.map((t, track) => (t ? { track, anim: t.anim, loop: t.loop } : null)).filter(Boolean),
        order: slot, loop: true, speed: 1,
      })
      actor.fade = 0
      actor.move = 0
    }
    dirty.clear()
  }
  const flush = (force = false) => {
    const hasText = lines.length > 0 || name !== null
    if (!force && !commands.length && !dirty.size && !hasText) return
    flushActors()
    if (hasText) {
      const who = name || ''
      if (who !== speaker) { emit({ op: 'speaker', segments: who ? [{ text: who }] : [] }); speaker = who }
      const body = cleanText(lines)
      emit({ op: 'text', segments: body ? [{ text: body }] : [] })
    } else {
      emit({ op: 'text', segments: [] })   // 只有指令、没有台词的点一下（CG 等）：留一个空步，别吞掉
    }
    steps.push({ index: steps.length, commands })
    commands = []
    lines = []
    name = null
  }
  const res = (bucket, key) => scene?.[bucket]?.get(key) || ''
  const audio = (kind, key) => ctx?.audio?.[kind]?.get(key) || ''

  for (const rawLine of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    stats.commands += 1
    if (!line.startsWith('<')) { if (name !== null) lines.push(line); continue }   // 正文行（跟在 <NAME_PLATE> 后面）
    for (const { tag, arg } of tagsOf(line)) {
      const a = splitArgs(arg)
      switch (tag) {
        case 'NAME_PLATE': name = arg; lines = []; break
        case 'PAUSE': flush(true); break   // 光秃秃的 <PAUSE>（真实数据里有一百多个）也是一次「点一下」：留一个空步
        case 'BG': {
          const src = res('images', a[0])
          if (src) { if (movieOn) { emit({ op: 'movieOff' }); movieOn = false } emit({ op: 'bg', src, fade: 0 }) } else { count('unresolved', `bg:${a[0]}`) }
          if (numOf(a[3], 1) !== 1 || numOf(a[4]) !== 0 || numOf(a[5]) !== 0) count('raw', 'BG(缩放/位移)')
          break
        }
        case 'FRAME_ANIM': {   // FRAME_ANIM,前缀,起始帧,结束帧,速度：场景自己的 animations/<前缀>_<帧号>.jpg 逐帧循环（当背景）；第 4 项速度不用，速度在播放器「更多」里设
          const prefix = String(a[0] || '').trim()
          const first = Math.trunc(numOf(a[1], 1))
          const last = Math.min(first + 599, Math.trunc(numOf(a[2], first)))
          const frames = []
          for (let n = first; n <= last; n += 1) { const src = res('animations', `${prefix}_${n}`); if (src) frames.push(src) }
          if (!frames.length) { count('unresolved', `frame-anim:${prefix}`); break }
          if (frames.length < last - first + 1) count('unresolved', `frame-anim-missing:${prefix}`)
          if (movieOn) { emit({ op: 'movieOff' }); movieOn = false }
          emit({ op: 'bg', src: frames[0], frames, fade: 0 })
          break
        }
        case 'BG_OUT': emit({ op: 'bgoff', fade: secs(a[0]) }); break
        case 'EV_OUT': emit({ op: 'bgoff', fade: secs(a[0]) }); break   // EV_OUT,毫秒：把当前 EV 背景淡出（原查看器就是 fade-out + 清掉）
        case 'FADE_OUT2': case 'FADE_OUT':
          if (/^black$/i.test(a[0])) emit({ op: 'fade', to: 'black', seconds: secs(a[1]) })
          else if (/^white$/i.test(a[0])) emit({ op: 'fade', to: 'white', seconds: secs(a[1]) })   // 淡到白屏并保持，FADE_IN2,white 再渐退
          else count('raw', tag)
          break
        case 'FADE_IN2': case 'FADE_IN':
          if (/^black$/i.test(a[0])) emit({ op: 'fade', to: 'clear', seconds: secs(a[1]) })
          else if (/^white$/i.test(a[0])) emit({ op: 'wash', color: 'white', seconds: secs(a[1]) })
          else count('raw', tag)
          break
        case 'WAIT': case 'WAIT2': { const seconds = secs(a[0]); if (seconds > 0) emit({ op: 'wait', seconds }); break }
        case 'BGM_PLAY': { const src = audio('bgm', a[0]); if (src) emit({ op: 'bgm', src }); else count('unresolved', `bgm:${a[0]}`); break }
        case 'BGM_STOP': emit({ op: 'bgmStop', fade: secs(a[0]) }); break
        case 'SE_PLAY': {
          const src = audio('se', a[1])
          if (!src) { count('unresolved', `se:${a[1]}`); break }
          if (bool(a[2])) { emit({ op: 'bgse', src, loop: true }); loopSe = true } else emit({ op: 'se', src })
          break
        }
        case 'SE_STOP': if (loopSe) { emit({ op: 'bgseStop' }); loopSe = false } break
        case 'VOICE_PLAY': case 'VOICE_SINGLE_PLAY': { const src = res('voices', a[0]); if (src) emit({ op: 'voice', src }); else count('unresolved', `voice:${a[0]}`); break }
        case 'STOP_VOICE': break
        case 'VIDEO_PLAY': {
          const src = res('videos', a[0])
          if (src) { emit({ op: 'movie', srcs: [src], loop: a[1] === undefined ? true : /^loop$/i.test(a[1]) }); movieOn = true; stats.movies += 1 } else count('unresolved', `video:${a[0]}`)
          break
        }
        case 'VIDEO_STOP': if (movieOn) { emit({ op: 'movieOff' }); movieOn = false } break
        case 'SPINE_ACTOR': {
          const slot = Math.trunc(numOf(a[0]))
          const props = parseProps(a[7])
          const previous = actors.get(slot)
          // 同一个槽先 PLAY 后 ACTOR（OUT → PLAY → ACTOR 是脚本里的常见写法）：先记下的动画在角色出现时套用
          const tracks = previous?.skel === a[1] ? previous.tracks : (waiting.get(slot) || [])
          waiting.delete(slot)
          // 第 4 项 = 出场时的初始动画（原查看器：不为空就 setAnimation(名字, 循环)，即轨道 0）；已经有人给轨道 0 设过（先 PLAY 后 ACTOR）就让那个优先
          if (a[3] && !tracks[0]) tracks[0] = { anim: a[3], loop: true }
          actors.set(slot, { skel: a[1], x: props.x ?? 0, y: props.y ?? 0, scale: (numOf(a[8], 1) || 1) * zoomScale, fade: secs(a[6]), move: 0, tracks })
          dirty.add(slot)
          break
        }
        case 'SPINE_ACTOR_PLAY':    // 槽,动画,轨道,循环
        case 'SPINE_ACTOR_TRACK': {   // 槽,轨道,动画,循环（和 PLAY 一样是给某条轨道设动画，只是参数顺序不同；动画名可以带目录，如 cheek/cheek_002）
          const slot = Math.trunc(numOf(a[0]))
          const track = Math.trunc(numOf(tag === 'SPINE_ACTOR_TRACK' ? a[1] : a[2]))
          const entry = { anim: tag === 'SPINE_ACTOR_TRACK' ? a[2] : a[1], loop: bool(a[3]) }
          const actor = actors.get(slot)
          if (!actor) {   // 这个槽现在没有角色：先记下，等 SPINE_ACTOR 把它放出来再套用
            if (!waiting.has(slot)) waiting.set(slot, [])
            waiting.get(slot)[track] = entry
            break
          }
          actor.tracks[track] = entry
          dirty.add(slot)
          break
        }
        case 'SPINE_ACTOR_SHAKE': {   // 槽,x 幅度,y 幅度,时长：角色抖动（x / y 是骨骼坐标单位，时长按 60 帧 = 1 秒折，单位没有对照样本）
          const slot = Math.trunc(numOf(a[0]))
          const actor = actors.get(slot)
          if (!actor) { count('raw', 'SPINE_ACTOR_SHAKE(槽里没有角色)'); break }
          actor.shake = { id: (shakeId += 1), x: numOf(a[1]), y: numOf(a[2]), seconds: Math.max(0.05, Math.min(10, numOf(a[3], 60) / 60)) }
          dirty.add(slot)
          break
        }
        case 'SPINE_ACTOR_MOVE': {
          const slot = Math.trunc(numOf(a[0]))
          const actor = actors.get(slot)
          if (!actor) break
          // 第 5 个参数 TRUE = 相对位移（在当前位置上加偏移），否则是绝对位置
          const relative = /^true$/i.test(a[4] || '')
          actor.x = relative ? actor.x + numOf(a[1]) : numOf(a[1]); actor.y = relative ? actor.y + numOf(a[2]) : numOf(a[2]); actor.move = secs(a[3])
          dirty.add(slot)
          break
        }
        case 'SPINE_ACTOR_OUT': {
          const slot = Math.trunc(numOf(a[0]))
          dirty.delete(slot)
          waiting.delete(slot)
          if (actors.delete(slot)) emit({ op: 'spineOff', slot: `Actor${slot}`, fade: secs(a[1]) })
          break
        }
        case 'ZOOM': {   // ZOOM,缩放,?,x,y：背景整体缩放 + 平移（x 取反，单位场景像素），角色缩放按上面的规则
          const z = numOf(a[0], 1) || 1
          zoomScale = z
          for (const [slot, actor] of actors) { actor.scale = z; dirty.add(slot) }
          emit({ op: 'bgZoom', scale: z, x: -numOf(a[2]), y: numOf(a[3]) })
          break
        }
        case 'EV': {   // EV,图,IN|OUT|NONE,毫秒,图2：整屏 CG（图 2 叠在图上面）。IN 淡入、NONE 直接换；OUT（新 CG 淡出露出旧背景）没法用一条背景指令表达，记在 stats.raw
          const mode = String(a[1] || '').toUpperCase()
          if (mode === 'OUT') { count('raw', 'EV(OUT)'); break }
          const color = /^black$/i.test(a[0]) ? [0, 0, 0] : /^white$/i.test(a[0]) ? [255, 255, 255] : null
          const src = color ? '' : res('images', a[0])
          const over = a[3] ? res('images', a[3]) : ''
          if (movieOn) { emit({ op: 'movieOff' }); movieOn = false }
          if (color) emit({ op: 'bg', color, fade: mode === 'IN' ? secs(a[2]) : 0 })
          else if (src) emit({ op: 'bg', src, ...(over ? { over } : {}), fade: mode === 'IN' ? secs(a[2]) : 0 })
          else count('unresolved', `ev:${a[0]}`)
          if (a[3] && !over && !color) count('unresolved', `ev:${a[3]}`)
          break
        }
        case 'BG_SCALE': emit({ op: 'bgScale', scale: numOf(a[0], 1) || 1, seconds: secs(a[1]), easing: String(a[2] || 'linear').trim() }); break   // BG_SCALE,倍数,毫秒,缓动
        case 'EFFECT_BG_BLUR': emit({ op: 'bgBlur', radius: Math.max(0, numOf(a[0])) }); break   // EFFECT_BG_BLUR,半径（场景像素）
        case 'BG_VOICE': {   // BG_VOICE,槽,文件,音量：循环的背景人声（场景自己的 bgvoices/）
          const src = res('bgvoices', a[1])
          if (src) emit({ op: 'bgvoice', slot: String(Math.trunc(numOf(a[0]))), src, volume: Math.max(0, Math.min(1, numOf(a[2], 1))) }); else count('unresolved', `bgvoice:${a[1]}`)
          break
        }
        case 'BG_VOICE_STOP': emit({ op: 'bgvoiceOff', slot: String(Math.trunc(numOf(a[0]))) }); break
        case 'UI_DISP': emit({ op: 'ui', visible: /^on$/i.test(a[0] || ''), seconds: secs(a[1]) }); break
        case 'EFFECT_FLASH': emit({ op: 'wash', color: a[0] || 'white', seconds: secs(a[1], 0.3) }); break   // EFFECT_FLASH,颜色,毫秒：整屏闪色后渐隐
        case 'EFFECT_QUAKE': emit({ op: 'shake', axis: String(a[0] || '').toLowerCase() === 'vertical' ? 'vertical' : String(a[0] || '').toLowerCase() === 'overall' ? 'overall' : 'horizontal', strength: numOf(a[1], 0.2), seconds: secs(a[2], 0.5) }); break
        case 'SCREEN_SHAKE': emit({ op: 'shake', axis: 'horizontal', strength: numOf(a[0]) === 1 ? 0.1 : 0.2, seconds: secs(a[1], 0.5) }); break   // SCREEN_SHAKE,类型(0/1),毫秒
        case 'SCENARIO_END': break
        default: count('raw', tag)
      }
    }
  }
  // 最后一个 <PAUSE> 之后剩下的指令（<SCENARIO_END><FADE_OUT2>black 之类）并进最后一步，不单独成一步（否则末尾多一个空白的「点一下」）
  if (steps.length && lines.length === 0 && name === null) {
    flushActors()
    steps[steps.length - 1].commands.push(...commands)
    commands = []
  } else flush()
  return { steps, stats }
}

// 一个场景几百个文件（图 / 语音 / 骨骼…），几百个场景轻松超过默认的 6 万；要全部建索引就得放宽上限（见 context.mjs 的 contextWalkLimit）
export const contextWalkLimit = 400000
// 表情预设的使用情况（给首页「表情」入口用）：扫一份脚本，模拟槽 → 骨架，收集「哪个骨架用过哪个预设名（轨道 0 的动画）」。纯函数，不碰文件系统。
// 返回 [[骨架名（脚本里写的，如 cast009001/nashwa_001）, 预设名]]（可重复，数次数用）
export function scanExpressions(text) {
  const slots = new Map()
  const out = []
  for (const rawLine of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('<')) continue
    for (const { tag, arg } of tagsOf(line)) {
      const a = splitArgs(arg)
      if (tag === 'SPINE_ACTOR') { slots.set(a[0], a[1]); if (a[3]) out.push([a[1], a[3]]) }
      else if (tag === 'SPINE_ACTOR_OUT') slots.delete(a[0])
      else if ((tag === 'SPINE_ACTOR_PLAY' && Number(a[2]) === 0) || (tag === 'SPINE_ACTOR_TRACK' && Number(a[1]) === 0)) {
        const skel = slots.get(a[0])
        const preset = tag === 'SPINE_ACTOR_PLAY' ? a[1] : a[2]
        if (skel && preset) out.push([skel, preset])
      }
    }
  }
  return out
}
// 全局骨架（data/spine/…）的资源路径：骨架名 → { skel, atlas }（给表情页预览用；场景自己的骨架不在这里）
export function globalSpineFiles(ctx, name) {
  const files = ctx?.globalSpines?.get(name)
  if (!files) return null
  const skel = files.get('skel') || files.get('bytes') || files.get('json') || ''
  const atlas = files.get('atlas') || files.get('txt') || ''
  return skel && atlas ? { skel, atlas } : null
}

// 体检（列表阶段的便宜检查，只看索引）：没有脚本的场景目录 / 没有标题的场景 / 没有封面的场景 / 找不到 data/audio
export function health(ctx) {
  const out = []
  const sample = (list) => `${list.slice(0, 5).join('、')}${list.length > 5 ? ' 等' : ''}`
  if (ctx.noScript?.length) out.push({ code: 'scene-no-script', message: `${ctx.noScript.length} 个 scenes/ 下的目录没有脚本（script.txt / output_script.txt / hmr_·hsr_<id>.txt），没有当成场景：${sample(ctx.noScript)}` })
  const untitled = [...ctx.scenes.keys()].filter((id) => !ctx.info.get(id)?.title)
  if (untitled.length) out.push({ code: 'scene-no-title', message: `${untitled.length} 个场景没有标题（原始脚本里没有 title 行），卡片显示场景 id：${sample(untitled)}` })
  const noThumb = [...ctx.scenes.values()].filter((scene) => !scene.thumb).map((scene) => scene.id)
  if (noThumb.length) out.push({ code: 'scene-no-thumb', message: `${noThumb.length} 个场景目录没有 thumbnail.*：${sample(noThumb)}` })
  if (!ctx.audio.bgm.size && !ctx.audio.se.size) out.push({ code: 'audio-missing', message: '没有找到 data/audio/{bgm,se}：BGM / 音效会缺资源（检查 adapterOptions.root 是不是 package.nw）' })
  return out
}
export const girlsCreationTagAdapter = { id: ADAPTER_ID, scanExpressions, globalSpineFiles, health, contextWalkLimit, label: 'Girls Creation 查看器（标签式脚本）', sniff, parse, contextFiles, contextDirs, contextTextFilter, prepare, catalog }
