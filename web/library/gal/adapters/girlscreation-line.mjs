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
//   bgmplay,<名>,… / bgmstop,<淡出秒>,…    seplay,<名>,on|off(循环),… / sestop,…      全局 data/audio 的 BGM / 音效
//   playmovie,<名>,loop|wait / stopmovie                    场景自己的 videos/（wait = 播一遍）
//   wait,<秒>    await（等异步动作，不处理）
// 角色（Spine，场景自己的 spines/<骨架名>）：
//   chara,<骨架名>,<槽 chara_N>,x,y,?,缩放x,缩放y,?,on|off(off = 先不显示，等 charafade in)
//   charamotion,<槽>,<动作>,on|off   —— 身体动作 = 轨道 0 的 <动作>（loop / joy / bashful / blues …，骨架里有同名动画），同时把轨道 1（表情）设成 ex_<动作>（骨架里成套有 ex_loop / ex_joy …，没有就跳过）
//   charaexpression,<槽>,<表情> → 轨道 1 的 ex_<表情>（单独改表情）    charafade|asynccharafade,<槽>,in|out,<秒>    charadelete,<槽>
// 认得但暂不渲染（记在 stats.raw）：cgmode / jump / asyncjump / shake / asyncshake / shakeall / emote / subimage / asyncmoveobject / bgblur / bgcolor / textsize / prefab …
// title,<标题>, / endof 不是步骤：标题给列表用。

const LINE_COMMANDS = new Set([
  'message', 'msgvoicesync', 'voice', 'window', 'fade', 'transitionfade', 'bg', 'crossfade', 'crossfadeready', 'bgmplay', 'bgmstop', 'seplay', 'sestop',
  'playmovie', 'stopmovie', 'wait', 'await', 'chara', 'charamotion', 'charaexpression', 'charafade', 'asynccharafade', 'charadelete', 'cgmode', 'title', 'endof',
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
export const lineTitle = (text) => /^title,([^,\r\n]+),/m.exec(String(text || '').replace(/^﻿/, ''))?.[1]?.trim() || ''

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
const IMAGE_ID = /^[a-z]{2,4}\d+$/i   // 头像 id（iab4020078）

export function parseLine(text, ctx = null, meta = {}) {
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
    if (!scene) return null
    if (scene.spines.has(name)) return scene.spines.get(name)
    for (const [key, files] of scene.spines) if (key.endsWith(`/${name}`)) return files
    return null
  }
  const paintActor = (slot, fade = 0) => {
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
        if (end > 3 && (f[end - 1] === '' || IMAGE_ID.test(f[end - 1]))) end -= 1
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
        if (src) { if (movieOn) { emit({ op: 'movieOff' }); movieOn = false } emit({ op: 'bg', src, fade: 0 }) } else count('unresolved', `bg:${f[1]}`)
        if (numOf(f[4], 1) !== 1 || numOf(f[3]) !== 0 || numOf(f[2]) !== 0) count('raw', 'bg(缩放/位移)')
        break
      }
      case 'crossfadeready': break
      case 'crossfade': {   // CrossFade,图,渐变秒,x,y,缩放x,缩放y
        const src = res('images', f[1])
        if (src) { if (movieOn) { emit({ op: 'movieOff' }); movieOn = false } emit({ op: 'bg', src, fade: secOf(f[2]) }) } else count('unresolved', `bg:${f[1]}`)
        if (numOf(f[5], 1) !== 1 || numOf(f[3]) !== 0 || numOf(f[4]) !== 0) count('raw', 'CrossFade(缩放/位移)')
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
        actors.set(slot, { skel: f[1], x: numOf(f[3]), y: numOf(f[4]), scale: numOf(f[6], 1) || 1, visible: isOn(f[9] === undefined ? 'on' : f[9]), tracks: previous?.skel === f[1] ? previous.tracks : [] })
        paintActor(slot, 0)
        break
      }
      case 'charamotion': {   // charamotion,槽,动画,on|off
        const actor = actors.get(slotOf(f[1]))
        if (!actor) { count('raw', 'charamotion(槽里没有角色)'); break }
        const loop = isOn(f[3] === undefined ? 'on' : f[3])
        actor.tracks[0] = { anim: f[2], loop }
        actor.tracks[1] = { anim: `ex_${f[2]}`, loop: true }   // 动作带着同名表情；后面的 charaexpression 会单独改它
        paintActor(slotOf(f[1]), 0)
        break
      }
      case 'charaexpression': {
        const actor = actors.get(slotOf(f[1]))
        if (!actor) { count('raw', 'charaexpression(槽里没有角色)'); break }
        actor.tracks[1] = { anim: `ex_${f[2]}`, loop: true }
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
