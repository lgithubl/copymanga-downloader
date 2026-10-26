// Girls Creation R Viewer 的「行式脚本」（<场景 id>/hmr_<id>.txt / hsr_<id>.txt，逗号分隔，一行一条命令）→ 规范场景（gal-scene/1）。
// 和标签式脚本（script.txt）是同一个游戏的两种写法，指令一对一对得上；没有 script.txt 的场景只有这一种。由 girlscreation-tag 适配器按内容分发过来，不单独注册。
// 一步（点一下）的划分（样本对照：同一场景的 script.txt 里每条语音一个「点一下」）：
//   message,<说话人>,<台词>,<头像id>                        一句台词；说话人空 = 旁白；台词里 <br> 是换行；前面紧挨着的 voice 归这一句
//   msgvoicesync,<槽>,<说话人>,<台词>,<头像id>,<语音>        带语音的台词（槽 = 说话的角色，只用来对应立绘，不做高亮）
//   voice,<语音>                                           只有语音、没有台词（CG 里的喘息声）：自己一步，台词留空；连着的 voice 各是一步
//   window,on|off,<秒>                                     文本框显示 / 隐藏
// 画面 / 声音：
//   fade,out|in,black|white,<秒> / TransitionFade,<名>,out|in,<颜色>,<秒>   黑场（out = 变黑并保持，in = 渐出）/ 白场闪
//   bg,<图>,… / CrossFade,<图>,<渐变秒>,x,y,缩放x,缩放y / CrossFadeReady（只是准备，忽略）   背景（场景自己的 images/）
//   TransitionCrossFade,<图>,<过渡名 traNa>,<渐变秒>,x,y,缩放x,缩放y / TransitionCrossFadeReady   同 CrossFade（commands.crossfade = 'bg'）：过渡名是遮罩过渡的名字，没有对应的图元，忽略，当作普通渐变换背景；Ready 忽略
//     缩放不是 1 时跟一条 bgScale（只缩放当前背景；缩放没有真机对照，line.crossfadeScale = 'ignore' 可关）；x / y 位移没法跟背景走（bgZoom 不随换背景清掉），记 raw
//   bgmplay,<名>,… / bgmstop,<淡出秒>,…    seplay,<名>,on|off(循环),… / sestop,…      全局 data/audio 的 BGM / 音效
//   playmovie,<名>,loop|wait / stopmovie                    场景自己的 videos/（wait = 播一遍）
//   wait,<秒>    await（等异步动作，不处理）
// 角色（Spine，场景自己的 spines/<骨架名>）：
//   chara,<骨架名>,<槽 chara_N>,x,y,?,缩放x,缩放y,?,on|off(off = 先不显示，等 charafade in)
//   charamotion,<槽>,<动作>,on|off   —— 身体动作 = 轨道 0 的 <动作>（loop / joy / bashful / blues …，骨架里有同名动画），同时把轨道 1（表情）设成 ex_<动作>（骨架里成套有 ex_loop / ex_joy …，没有就跳过）
//   charaexpression,<槽>,<表情> → 轨道 1 的 ex_<表情>（单独改表情）    charafade|asynccharafade,<槽>,in|out,<秒>    charadelete,<槽>
//   asyncmoveobject,character,<槽>,<秒>,<dx>,<dy>,<n>,<缓动>   角色位移（commands.asyncmoveobject = 'move'）：spine 指令的 x / y + move（秒，播放器线性渐移；缓动名 / n 忽略）。dx / dy 的单位按和 chara 的 x / y 一样（骨骼坐标单位，没有对照）；
//        line.moveBase = 'offset'（默认）：dx / dy 是相对 chara 摆放位置的偏移（数据里 0,-40 之后常跟 0,0 回位，相对当前位置的话 0,0 就成了空操作）/ 'relative'：在当前位置上累加。目标不是 character / 槽里没有角色 → raw
//   asyncjump,character,<槽>,<dy>,<秒>,<次数>   角色跳一下（commands.asyncjump = 'hop'）：spine 指令的 action = line.jumpAction（1 = 站位动作里的「跳两下」，固定 0.4 秒；dy / 秒 / 次数忽略）。dy 的符号没有对照（样本只有 -30），不分上下都当跳
//   cgmode,on|off   看 CG 的模式（commands.cgmode = 'ui'）：on → 文本框隐藏（ui visible:false），off → 显示。没有真机对照：cgmode 也可能只是换一种 CG 版式而不是隐藏文本框——on 之后没有 off 的脚本里，台词会一直看不见（window,on 能再显示），觉得不对就设 commands.cgmode = 'raw'
// 认得但暂不渲染（记在 stats.raw）：jump / shake / asyncshake / shakeall / emote / subimage / subimagedelete / bgblur / bgcolor / textsize / prefab …（commands.* = 'raw' 时 cgmode / asyncjump / asyncmoveobject / TransitionCrossFade 也记 raw）
// title,<标题>, / endof 不是步骤：标题给列表用。
//
// ---------- 参数（config.adapterOptions['girlscreation-tag']，标签式和行式共用；全部可选，没写 = DEFAULT_OPTIONS = 以前的行为）----------
// 适配器只读参数、按参数匹配；数组整体替换、对象逐项合并：
//   root（package.nw 目录，相对媒体目录）  categoryLabels { 分类前缀: 显示名 }
//   player          { names: [主角名…] }（列表里不当「主要说话人」；旧写法 player: '館長' / ['館長'] 也认）
//   dialect         { window: 查方言标记看脚本开头多少字符, headWindow: 区分标签式 / 行式看多少字符,
//                     markers: { aku: [出现任一个 = Aku 写法], display: [有这些标签才需要 SPINE_ACTOR_DISPLAY 才显示角色], branch: [有这些标签 = 有分支] } }
//   stand           { akuOffset: Aku 写法 LEFT / RIGHT 的横向偏移（估的）, akuDirections { 横向取值: -1 | 0 | 1 }, fruitsDim: ACTOR_COLOR_FILTER dark 的压暗值 }
//   animation       { maxFrames: FRAME_ANIM / ANIM_PLAY 最多收多少帧 }
//   line            { expressionPrefix: charamotion / charaexpression 的表情动画前缀, imageIdRe: message 末尾的头像 id,
//                     objectKind: asyncjump / asyncmoveobject 第 2 项里「角色」的正则, jumpAction: asyncjump 用的站位动作码, moveBase: 'offset' | 'relative'（asyncmoveobject 的 dx / dy 相对什么）,
//                     crossfadeScale: 'bgScale' | 'ignore'（CrossFade 的缩放：跟一条 bgScale / 不管）}
//   line.clearActorsOnBg  换背景（bg / CrossFade / TransitionCrossFade）时把台上的演员收掉（默认 true；false = 只在脚本写了 charafade out / charadelete 时才收）
//   commands        { cgmode: 'ui' | 'raw', asyncjump: 'hop' | 'raw', asyncmoveobject: 'move' | 'raw'（旧名 'x' 也认）, crossfade: 'bg' | 'raw' }   每条命令的映射方式，默认 = 新映射；'raw' = 以前的行为
//                     crossfade 'raw'：CrossFade 照旧（换背景 + 渐变，缩放 / 位移记 raw），TransitionCrossFade / TransitionCrossFadeReady 记 raw
//   category        { re: 场景 id → 分类的正则（取匹配到的部分）, other: 没匹配时的分类名, unknownSpeaker: 没认出说话人的分组名 }
//   titleLines      [正则…]：原始脚本里取标题的行（第 1 组 = 标题，多行模式）    speaker { suffixRe } 说话人去掉的后缀（括号别名）
//   dirs            { scenes, audio, spine }（相对 root）  sceneDirs { 场景目录里各类资源的子目录名 }  audioKinds [data/audio 下的子目录]
//   scenes          { script: [脚本文件名，按优先级], lineScript: 行式脚本文件名正则, thumb: 封面文件名正则 }
//   sample          { files: [正则…] }：哪些文件的开头要读进来取标题 / 说话人（抽样字节数在引擎 limits.sampleBytes）
import { createOptionsReader, escapeRegex, safeRegex, safeRegexList } from './options-merge.mjs'

export const DEFAULT_OPTIONS = {
  root: '',
  categoryLabels: {},
  player: { names: ['館長'] },
  dialect: { window: 200000, headWindow: 8192, markers: { aku: ['<GROUP>', '<EV_DISPLAY>', '<SPINE_ACTOR_DISPLAY>'], display: ['<SPINE_ACTOR_DISPLAY>'], branch: ['<LABEL>'] } },
  stand: { akuOffset: 450, akuDirections: { LEFT: -1, RIGHT: 1, CENTER: 0 }, fruitsDim: 0.6 },
  animation: { maxFrames: 600 },
  line: { expressionPrefix: 'ex_', imageIdRe: '^[a-z]{2,4}\\d+$', objectKind: '^character$', jumpAction: 1, moveBase: 'offset', crossfadeScale: 'bgScale', clearActorsOnBg: true },
  commands: { cgmode: 'ui', asyncjump: 'hop', asyncmoveobject: 'move', crossfade: 'bg' },
  category: { re: '^[A-Za-z]+', other: '其他', unknownSpeaker: '（未识别）' },
  titleLines: ['^title,([^,\\r\\n]+),'],
  speaker: { suffixRe: '（[^）]*）$' },
  dirs: { scenes: 'scenes', audio: 'data/audio', spine: 'data/spine' },
  sceneDirs: { images: 'images', videos: 'videos', voices: 'voices', bgvoices: 'bgvoices', animations: 'animations', spines: 'spines' },
  audioKinds: ['bgm', 'se'],
  scenes: { script: ['script.txt', 'output_script.txt'], lineScript: '^h[ms]r_[^/]+\\.txt$', thumb: '^thumbnail\\.(?:png|jpe?g|webp)$' },
  sample: { files: ['/(?:script\\.txt|output_script\\.txt|script_original\\.txt|original_script\\.txt|originial_script\\.txt|h[ms]r_\\d+\\.txt)$'] },
}
// 旧写法 player: '館長' / ['館長'] → { names }（同一个原始对象只转一次）
const legacy = new WeakMap()
const reader = createOptionsReader(DEFAULT_OPTIONS)
export function girlsOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return reader(options)
  if (typeof options.player === 'string' || Array.isArray(options.player)) {
    if (!legacy.has(options)) legacy.set(options, { ...options, player: { names: [].concat(options.player).map(String) } })
    return reader(legacy.get(options))
  }
  return reader(options)
}
// 标记列表（'<GROUP>'…）→ 多行正则：脚本里任一行以其中一个开头
const markerCache = new WeakMap()
export function markerRegex(markers) {
  const list = Array.isArray(markers) ? markers : []
  if (!markerCache.has(list)) markerCache.set(list, list.length ? safeRegex(`^(?:${list.map((m) => escapeRegex(m)).join('|')})`, 'm') : null)
  return markerCache.get(list)
}
const compiledCache = new WeakMap()
// 规整后的参数 → 编译好的正则（同一份参数只编译一次）
export function girlsCompiled(opt) {
  if (!compiledCache.has(opt)) {
    compiledCache.set(opt, {
      imageId: safeRegex(opt.line.imageIdRe),
      objectKind: safeRegex(opt.line.objectKind),
      titles: safeRegexList(opt.titleLines, 'm'),
      suffix: safeRegex(opt.speaker.suffixRe),
      category: safeRegex(opt.category.re, ''),
      lineScript: safeRegex(opt.scenes.lineScript),
      thumb: safeRegex(opt.scenes.thumb),
      sample: safeRegexList(opt.sample.files),
      aku: markerRegex(opt.dialect.markers.aku),
      display: markerRegex(opt.dialect.markers.display),
      branch: markerRegex(opt.dialect.markers.branch),
    })
  }
  return compiledCache.get(opt)
}

const LINE_COMMANDS = new Set([
  'message', 'msgvoicesync', 'voice', 'window', 'fade', 'transitionfade', 'bg', 'crossfade', 'crossfadeready', 'bgmplay', 'bgmstop', 'seplay', 'sestop',
  'playmovie', 'stopmovie', 'wait', 'await', 'chara', 'charamotion', 'charaexpression', 'charafade', 'asynccharafade', 'charadelete', 'cgmode', 'title', 'endof',
  'asyncjump', 'asyncmoveobject', 'transitioncrossfade', 'transitioncrossfadeready',
])
// 只有行式脚本才会有的命令：认出任何一个就够；否则要求前面几行里至少 4 条已知命令
const LINE_ONLY = new Set(['message', 'msgvoicesync', 'chara', 'charamotion', 'charafade', 'asynccharafade', 'crossfade', 'crossfadeready', 'playmovie', 'bgmplay', 'seplay', 'cgmode'])

export function sniffLine(text) {
  let checked = 0
  let known = 0
  let only = 0
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('<')) return false   // 标签式
    const cmd = line.split(',', 1)[0].trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]*$/.test(cmd)) return false
    checked += 1
    if (LINE_COMMANDS.has(cmd)) known += 1
    if (LINE_ONLY.has(cmd)) only += 1
    if (checked >= 40) break
  }
  return checked >= 3 && known / checked >= 0.7 && only >= 1
}

// 行式脚本里的标题（title,<标题>,）
export function lineTitle(text, patterns = girlsCompiled(girlsOptions()).titles) {
  const clean = String(text || '').replace(/^﻿/, '')
  for (const re of patterns) { const title = re.exec(clean)?.[1]?.trim(); if (title) return title }
  return ''
}

// 行式脚本里出现的说话人（message / msgvoicesync 的说话人字段），给列表分组用
export function lineSpeakers(text) {
  const out = []
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const f = raw.trim().split(',')
    const cmd = f[0].toLowerCase()
    const name = cmd === 'message' ? f[1] : cmd === 'msgvoicesync' ? f[2] : ''
    if (name && name.trim()) out.push(name.trim())
  }
  return out
}

const numOf = (text, fallback = 0) => { const n = Number.parseFloat(text); return Number.isFinite(n) ? n : fallback }
const secOf = (text, fallback = 0) => Math.max(0, Math.min(60, numOf(text, fallback)))
const isOn = (text) => /^(?:on|true|1|loop)$/i.test(String(text || '').trim())
const slotOf = (text) => { const m = /(\d+)\s*$/.exec(String(text || '')); return m ? Number(m[1]) : 0 }

export function parseLine(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || girlsOptions(meta?.options)
  const imageId = girlsCompiled(opt).imageId   // 头像 id（iab4020078）
  const exPrefix = opt.line.expressionPrefix
  const kindRe = girlsCompiled(opt).objectKind
  const mode = {   // commands.*：不认识的值回到默认（asyncmoveobject 的旧名 'x' = 'move'）
    cgmode: opt.commands.cgmode === 'raw' ? 'raw' : 'ui',
    asyncjump: opt.commands.asyncjump === 'raw' ? 'raw' : 'hop',
    asyncmoveobject: opt.commands.asyncmoveobject === 'raw' ? 'raw' : 'move',
    crossfade: opt.commands.crossfade === 'raw' ? 'raw' : 'bg',
  }
  const steps = []
  let commands = []
  let speaker = ''
  let voiceOpen = false    // 前面有一条还没配上台词的 voice
  let loopSe = false
  let movieOn = false
  const sceneId = String(meta?.rel || '').split('/')[0]
  const scene = ctx?.scenes?.get(sceneId) || null
  const stats = { commands: 0, raw: {}, unresolved: {}, movies: 0, spines: 0, form: 'line' }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  if (ctx?.truncated) count('unresolved', '文件索引被截断（超过上限）：这个场景的资源可能找不到')
  const emit = (command) => { commands.push(command) }
  const res = (bucket, key) => scene?.[bucket]?.get(key) || ''
  const audio = (kind, key) => ctx?.audio?.[kind]?.get(key) || ''

  const actors = new Map()   // 槽 → { skel, x, y, scale, visible, tracks: [] }
  const skelFiles = (name) => {
    if (!scene) return ctx?.globalSpines?.get(name) || null
    if (scene.spines.has(name)) return scene.spines.get(name)
    for (const [key, files] of scene.spines) if (key.endsWith(`/${name}`)) return files
    return ctx?.globalSpines?.get(name) || null
  }
  const paintActor = (slot, fade = 0, extra = null) => {
    const actor = actors.get(slot)
    if (!actor || !actor.visible) return
    const files = skelFiles(actor.skel)
    const skelRes = files?.get('skel') || files?.get('bytes') || files?.get('json') || ''
    const atlasRes = files?.get('atlas') || files?.get('txt') || ''
    if (!skelRes || !atlasRes) { count('unresolved', `spine:${actor.skel}`); return }
    stats.spines += 1
    emit({
      op: 'spine', slot: `Actor${slot}`, kind: 'actor', skel: skelRes, atlas: atlasRes, x: actor.x, y: actor.y, scale: actor.scale, fade,
      tracks: actor.tracks.map((t, track) => (t ? { track, anim: t.anim, loop: t.loop } : null)).filter(Boolean), order: slot, loop: true, speed: 1,
      ...(extra || {}),
    })
  }

  // 收一步：commands + 台词（没有台词 = 空步，CG 里只有语音的「点一下」）
  const flush = (who = null, body = '') => {
    if (who !== null && who !== speaker) { emit({ op: 'speaker', segments: who ? [{ text: who }] : [] }); speaker = who }
    else if (who === null && speaker) { emit({ op: 'speaker', segments: [] }); speaker = '' }
    emit({ op: 'text', segments: body ? [{ text: body }] : [] })
    steps.push({ index: steps.length, commands })
    commands = []
    voiceOpen = false
  }
  // 换背景 = 进了下一个场景：还在台上的演员收掉（用户反馈：场景切换了人物没消失）。slot 里的演员记录留着，后面的 chara / charafade in 照常能再摆出来
  const clearActors = () => {
    if (opt.line.clearActorsOnBg === false) return
    for (const [slot, actor] of actors) if (actor.visible) { actor.visible = false; emit({ op: 'spineOff', slot: `Actor${slot}`, fade: 0 }) }
  }
  // CrossFade / TransitionCrossFade：换背景 + 渐变；缩放不是 1 跟一条 bgScale（换背景会清掉上一张的缩放）；x / y 位移没法表示，记 raw
  const crossFade = (image, seconds, x, y, scaleX, label) => {
    const src = res('images', image)
    if (!src) { count('unresolved', `bg:${image}`); return }
    if (movieOn) { emit({ op: 'movieOff' }); movieOn = false }
    clearActors()
    emit({ op: 'bg', src, fade: secOf(seconds) })
    const scale = numOf(scaleX, 1)
    const scaled = scale !== 1 && scale > 0
    if (scaled && opt.line.crossfadeScale !== 'ignore') emit({ op: 'bgScale', scale, seconds: 0, easing: 'linear' })
    if (numOf(x) !== 0 || numOf(y) !== 0 || (scaled && opt.line.crossfadeScale === 'ignore')) count('raw', `${label}(${scaled && opt.line.crossfadeScale === 'ignore' ? '缩放/位移' : '位移'})`)
  }
  const playVoice = (name) => {
    const src = res('voices', name)
    if (src) emit({ op: 'voice', src }); else count('unresolved', `voice:${name}`)
  }

  for (const rawLine of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '').trim()
    if (!line) continue
    stats.commands += 1
    const f = line.split(',').map((s) => s.trim())
    const cmd = f[0]
    switch (cmd.toLowerCase()) {
      case 'message': {
        // message,说话人,台词(可能含逗号),头像id；最后一项是头像 id 或空，去掉
        let end = f.length
        if (end > 3 && (f[end - 1] === '' || imageId?.test(f[end - 1]))) end -= 1
        const body = f.slice(2, end).join(',').replace(/<br>/gi, '\n').trim()
        flush(f[1] || '', body)
        break
      }
      case 'msgvoicesync': {   // msgvoicesync,槽,说话人,台词(可能含逗号),头像id,语音
        if (voiceOpen) flush(null, '')
        const voice = f.length >= 6 ? f[f.length - 1] : ''
        const body = f.slice(3, f.length >= 6 ? f.length - 2 : f.length).join(',').replace(/<br>/gi, '\n').trim()
        if (voice) playVoice(voice)
        flush(f[2] || '', body)
        break
      }
      case 'voice':
        if (voiceOpen) flush(null, '')   // 上一条语音没有台词：自己一步
        playVoice(f[1])
        voiceOpen = true
        break
      case 'window': emit({ op: 'ui', visible: isOn(f[1]), seconds: secOf(f[2]) }); break
      case 'fade':
      case 'transitionfade': {
        const out = cmd.toLowerCase() === 'fade' ? f : [f[0], ...f.slice(2)]   // TransitionFade,<名>,out,black,0.5 → 去掉过渡名
        const dir = String(out[1] || '').toLowerCase()
        const color = String(out[2] || '').toLowerCase()
        const seconds = secOf(out[3])
        if (color === 'black') emit({ op: 'fade', to: dir === 'out' ? 'black' : 'clear', seconds })
        else if (color === 'white') emit(dir === 'out' ? { op: 'fade', to: 'white', seconds } : { op: 'wash', color: 'white', seconds })
        else count('raw', cmd)
        break
      }
      case 'bg': {
        const src = res('images', f[1])
        if (src) { if (movieOn) { emit({ op: 'movieOff' }); movieOn = false } clearActors(); emit({ op: 'bg', src, fade: 0 }) } else count('unresolved', `bg:${f[1]}`)
        if (numOf(f[4], 1) !== 1 || numOf(f[3]) !== 0 || numOf(f[2]) !== 0) count('raw', 'bg(缩放/位移)')
        break
      }
      case 'crossfadeready': break
      case 'transitioncrossfadeready': if (mode.crossfade === 'raw') count('raw', cmd); break
      case 'crossfade': {   // CrossFade,图,渐变秒,x,y,缩放x,缩放y
        if (mode.crossfade === 'raw') {
          const src = res('images', f[1])
          if (src) { if (movieOn) { emit({ op: 'movieOff' }); movieOn = false } emit({ op: 'bg', src, fade: secOf(f[2]) }) } else count('unresolved', `bg:${f[1]}`)
          if (numOf(f[5], 1) !== 1 || numOf(f[3]) !== 0 || numOf(f[4]) !== 0) count('raw', 'CrossFade(缩放/位移)')
        } else crossFade(f[1], f[2], f[3], f[4], f[5], 'CrossFade')
        break
      }
      case 'transitioncrossfade': {   // TransitionCrossFade,图,过渡名,渐变秒,x,y,缩放x,缩放y（过渡名忽略）
        if (mode.crossfade === 'raw') count('raw', cmd)
        else crossFade(f[1], f[3], f[4], f[5], f[6], 'TransitionCrossFade')
        break
      }
      case 'bgmplay': { const src = audio('bgm', f[1]); if (src) emit({ op: 'bgm', src }); else count('unresolved', `bgm:${f[1]}`); break }
      case 'bgmstop': emit({ op: 'bgmStop', fade: secOf(f[1]) }); break
      case 'seplay': {
        const src = audio('se', f[1])
        if (!src) { count('unresolved', `se:${f[1]}`); break }
        if (isOn(f[2])) { emit({ op: 'bgse', src, loop: true }); loopSe = true } else emit({ op: 'se', src })
        break
      }
      case 'sestop': if (loopSe) { emit({ op: 'bgseStop' }); loopSe = false } break
      case 'playmovie': {
        const src = res('videos', f[1])
        if (src) { emit({ op: 'movie', srcs: [src], loop: /^loop$/i.test(f[2] || 'loop') }); movieOn = true; stats.movies += 1 } else count('unresolved', `video:${f[1]}`)
        break
      }
      case 'stopmovie': if (movieOn) { emit({ op: 'movieOff' }); movieOn = false } break
      case 'wait': { const seconds = secOf(f[1]); if (seconds > 0) emit({ op: 'wait', seconds }); break }
      case 'chara': {   // chara,骨架,槽,x,y,?,缩放x,缩放y,?,on|off
        const slot = slotOf(f[2])
        const previous = actors.get(slot)
        actors.set(slot, { skel: f[1], x: numOf(f[3]), y: numOf(f[4]), bx: numOf(f[3]), by: numOf(f[4]), scale: numOf(f[6], 1) || 1, visible: isOn(f[9] === undefined ? 'on' : f[9]), tracks: previous?.skel === f[1] ? previous.tracks : [] })
        paintActor(slot, 0)
        break
      }
      case 'charamotion': {   // charamotion,槽,动画,on|off
        const actor = actors.get(slotOf(f[1]))
        if (!actor) { count('raw', 'charamotion(槽里没有角色)'); break }
        const loop = isOn(f[3] === undefined ? 'on' : f[3])
        actor.tracks[0] = { anim: f[2], loop }
        actor.tracks[1] = { anim: `${exPrefix}${f[2]}`, loop: true }   // 动作带着同名表情；后面的 charaexpression 会单独改它
        paintActor(slotOf(f[1]), 0)
        break
      }
      case 'charaexpression': {
        const actor = actors.get(slotOf(f[1]))
        if (!actor) { count('raw', 'charaexpression(槽里没有角色)'); break }
        actor.tracks[1] = { anim: `${exPrefix}${f[2]}`, loop: true }
        paintActor(slotOf(f[1]), 0)
        break
      }
      case 'charafade':
      case 'asynccharafade': {   // charafade,槽,in|out,秒
        const slot = slotOf(f[1])
        const actor = actors.get(slot)
        if (!actor) break
        if (/^in$/i.test(f[2])) { actor.visible = true; paintActor(slot, secOf(f[3])) } else { actor.visible = false; emit({ op: 'spineOff', slot: `Actor${slot}`, fade: secOf(f[3]) }) }
        break
      }
      case 'charadelete': {
        const slot = slotOf(f[1])
        const actor = actors.get(slot)
        if (!actor) break
        if (actor.visible) emit({ op: 'spineOff', slot: `Actor${slot}`, fade: 0 })
        actors.delete(slot)
        break
      }
      case 'cgmode': {   // cgmode,on|off
        if (mode.cgmode === 'raw') { count('raw', cmd); break }
        emit({ op: 'ui', visible: !isOn(f[1]), seconds: 0 })
        break
      }
      case 'asyncjump': {   // asyncjump,character,槽,dy,秒,次数
        const slot = slotOf(f[2])
        if (mode.asyncjump === 'raw' || !kindRe?.test(f[1] || '')) { count('raw', cmd); break }
        if (!actors.has(slot)) { count('raw', 'asyncjump(槽里没有角色)'); break }
        paintActor(slot, 0, { action: opt.line.jumpAction })
        break
      }
      case 'asyncmoveobject': {   // asyncmoveobject,character,槽,秒,dx,dy,n,缓动
        const slot = slotOf(f[2])
        if (mode.asyncmoveobject === 'raw' || !kindRe?.test(f[1] || '')) { count('raw', cmd); break }
        const actor = actors.get(slot)
        if (!actor) { count('raw', 'asyncmoveobject(槽里没有角色)'); break }
        const relative = opt.line.moveBase === 'relative'
        const x = (relative ? actor.x : actor.bx) + numOf(f[4])
        const y = (relative ? actor.y : actor.by) + numOf(f[5])
        if (x === actor.x && y === actor.y) break
        actor.x = x
        actor.y = y
        const seconds = secOf(f[3])
        paintActor(slot, 0, seconds > 0 ? { move: seconds } : null)
        break
      }
      case 'await': case 'title': case 'endof': break
      default: count('raw', cmd)
    }
  }
  // 最后一条语音后面没有台词：补成一步；结尾剩下的指令并进最后一步
  if (voiceOpen) flush(null, '')
  if (commands.length) {
    if (steps.length) steps[steps.length - 1].commands.push(...commands)
    else steps.push({ index: 0, commands: [...commands, { op: 'text', segments: [] }] })
  }
  return { steps, stats }
}
