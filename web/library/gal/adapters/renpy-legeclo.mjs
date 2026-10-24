// 适配器：Ren'Py 脚本（legeclo 这类粉丝播放器：game/script/hscene/<角色>_<编号>.rpy）→ 规范场景（gal-scene/1）。
// 和 renpy-monmusu / renpy-minashigo 是三个独立的适配器（写法不一样，互不影响），上下文（视频别名表 + 图片目录）直接复用 monmusu 的。
// 这个格式的特点：
//   label H_<角色>_<编号>:                    脚本开头；sniff 认 `H_` 开头的 label + 它独有的 `$ enable_skip()` / `play voice`
//   $ enable_skip() / hide screen xxx          python 和界面语句：不碰
//   scene <图片名> [with 转场]                 背景：先查视频别名（image X = Movie(play=…)）→ 图片目录（images/ 下的文件按无扩展名的文件名自动命名）；
//                                              名字里带 black 的当黑底（那张「黑图」不当背景图，也不会被拿去当缩略图）
//   show <立绘图名> [at left|right|center] [with 转场]   立绘 = images/sprite/ 下的一整张图（表情各是一个文件）→ stand 指令（单个部件、无裁剪）；
//                                              不同的图名是不同的 tag，会同时显示（和 Ren'Py 一样）；hide <图名> 去掉；scene 会清掉所有立绘
//   play music "路径" / play voice "路径" / play sound "路径"   bgm / voice / se；stop music [fadeout n] → bgmStop；stop voice / stop sound 忽略
//   "名字" "台词" / "" "台词"（旁白）            speaker + text，一句台词 = 一步；\n 是换行，{i}{w} 之类的文字标记去掉
//   pause [秒] / with Dissolve(n) / window / jump / return / call   pause 带秒数 → wait；with 转场 → 短暂等待；其余忽略
// 翻译叠加（tl/jptoen、tl/jptocn 里的 translate 块）暂不处理；只有 .rpyc 没有 .rpy 的脚本读不了（编译过的）。
import { prepare as monmusuPrepare, contextDirs as monmusuDirs, contextFiles as monmusuFiles, renpyText } from './renpy-monmusu.mjs'

export const ADAPTER_ID = 'renpy-legeclo'

export const contextFiles = monmusuFiles
export const contextDirs = monmusuDirs

// 独有写法：label H_xxx:（大写 H + 下划线）。monmusu 的 label 是 h<数字>，minashigo 靠 $ name= / xyz "…"，都不会被它认走
export function sniff(text) {
  const head = String(text || '').slice(0, 8192)
  return /^\s*label\s+H_\w+\s*:/m.test(head) && /^\s*(?:\$\s*enable_skip\s*\(|play\s+voice\s+")/m.test(head)
}

export const prepare = (args) => monmusuPrepare(args)

// ---------- 语句解析 ----------
const STR = '"((?:[^"\\\\]|\\\\.)*)"'
const DIALOGUE_RE = new RegExp(`^${STR}(?:\\s+${STR})?(?:\\s+with\\s+\\S.*)?$`)
const PATH_RE = /^(?:play|queue)\s+(music|sound|audio|voice)\s+(?:\[[^\]]*\]|"((?:[^"\\]|\\.)*)")/
const aliasKey = (name) => String(name).trim().replace(/\s+/g, ' ').toLowerCase()
const num = (text, fallback = 0) => { const n = Number.parseFloat(text); return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : fallback }
const clean = (rel) => String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
const ALIGN = { left: 'left', right: 'right', center: 'center', truecenter: 'center' }

// 转场 → 渐变秒数：Dissolve(0.5) / Fade(0.5, 0, 0.5) 取第一个数；dissolve / fade 这类命名转场按 0.5；None 或认不出 = 0
function transitionSeconds(expr) {
  const text = String(expr ?? '').trim()
  if (!text || /^none$/i.test(text)) return 0
  const m = /\(\s*([\d.]+)/.exec(text)
  if (m) return num(m[1])
  return /^(?:dissolve|fade|pixellate|move)/i.test(text) ? 0.5 : 0
}

// `scene xxx with Dissolve (0.5)` / `show xxx at left with Dissolve(0.5)` → { name, fade, align }
function splitShow(rest) {
  let text = String(rest).trim()
  let fade = 0
  const withAt = text.search(/\s+with\s+/)
  if (withAt >= 0) { fade = transitionSeconds(text.slice(withAt).replace(/^\s+with\s+/, '')); text = text.slice(0, withAt).trim() }
  let align = ''
  const at = /\s+at\s+(\w+)/.exec(text)
  if (at) align = ALIGN[at[1]] || ''
  text = text.replace(/\s+(?:at|onlayer|behind|as|zorder)\s.*$/, '').trim()
  return { name: text, fade, align }
}

const isBlack = (key) => /(?:^|_)black\d*$/.test(key)

export function parse(text, ctx = null) {
  const steps = []
  let current = []
  let speaker = ''
  let inMovie = false
  let shown = new Map()      // 立绘图名 → { src, align }（Map 保持 show 的先后）
  let standOn = false        // 屏幕上现在有立绘
  let standDirty = false     // 立绘变了还没发 stand 指令（等到下一句台词 / 换场再一起发）
  const stats = { commands: 0, raw: {}, unresolved: {}, movies: 0, stands: 0 }
  const emit = (command) => { current.push(command) }
  const flush = () => {
    if (current.length) steps.push({ index: steps.length, commands: current })
    current = []
  }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const flushStand = () => {
    if (!standDirty) return
    standDirty = false
    if (shown.size) {
      emit({ op: 'stand', parts: [...shown.values()].map(({ src, align }) => ({ src, ...(align ? { align } : {}) })) })
      standOn = true
      stats.stands += 1
    } else if (standOn) { emit({ op: 'standOff' }); standOn = false }
  }
  const standOff = () => {
    shown = new Map()
    standDirty = false
    if (standOn) { emit({ op: 'standOff' }); standOn = false }
  }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '').trim()
    if (!line || line.startsWith('#')) continue
    stats.commands += 1
    if (line.startsWith('$')) continue   // python 语句（$ enable_skip() 之类）不碰

    const dialogue = DIALOGUE_RE.exec(line)
    if (dialogue) {
      const named = dialogue[2] !== undefined
      const name = named ? renpyText(dialogue[1]) : ''
      const body = renpyText(named ? dialogue[2] : dialogue[1])
      flushStand()
      if (name !== speaker) { emit({ op: 'speaker', segments: name ? [{ text: name }] : [] }); speaker = name }
      emit({ op: 'text', segments: body ? [{ text: body }] : [] })
      flush()
      continue
    }

    const word = /^[A-Za-z_]\w*/.exec(line)?.[0] || ''
    switch (word) {
      case 'scene': {
        const { name, fade } = splitShow(line.slice(5))
        const key = aliasKey(name)
        standOff()   // scene 会清掉屏幕上所有已显示的图（包括立绘）
        if (key === 'black' || isBlack(key)) {
          if (inMovie) { emit({ op: 'movieOff' }); inMovie = false }
          emit({ op: 'bg', color: [0, 0, 0], fade })
        } else if (ctx?.movies?.has(key)) {
          const movie = ctx.movies.get(key)
          emit({ op: 'movie', srcs: [movie.src], loop: movie.loop })
          inMovie = true
          stats.movies += 1
        } else if (ctx?.images?.has(key)) {
          if (inMovie) { emit({ op: 'movieOff' }); inMovie = false }
          emit({ op: 'bg', src: clean(ctx.images.get(key)), fade })
        } else {
          count('unresolved', name)
          emit({ op: 'raw', cmd: 'scene', args: [name] })
        }
        break
      }
      case 'show': {
        const { name, align } = splitShow(line.slice(4))
        const key = aliasKey(name)
        if (ctx?.movies?.has(key)) {   // show 一个视频别名：当整幅画面的视频背景
          const movie = ctx.movies.get(key)
          emit({ op: 'movie', srcs: [movie.src], loop: movie.loop })
          inMovie = true
          stats.movies += 1
        } else if (ctx?.images?.has(key)) {
          shown.set(key, { src: clean(ctx.images.get(key)), align })
          standDirty = true
        } else {
          count('unresolved', `show ${name}`)
        }
        break
      }
      case 'hide': {
        const target = line.slice(4).trim()
        if (/^screen\b/.test(target)) break   // hide screen xxx：界面，不碰
        const key = aliasKey(target.replace(/\s+with\s+.*$/, ''))
        if (shown.delete(key)) standDirty = true
        break
      }
      case 'play':
      case 'queue': {
        const m = PATH_RE.exec(line)
        if (!m || m[2] === undefined) { count('raw', line.split(/\s+/).slice(0, 2).join(' ')); break }
        const src = clean(m[2])
        if (!src) break
        if (m[1] === 'music') emit({ op: 'bgm', src })
        else if (m[1] === 'voice') emit({ op: 'voice', src })
        else emit({ op: 'se', src })
        break
      }
      case 'stop': {
        const m = /^stop\s+music(?:\s+fadeout\s*\(?\s*([\d.]+))?/.exec(line)
        if (m) emit({ op: 'bgmStop', fade: num(m[1]) })
        break   // stop voice / stop sound：忽略
      }
      case 'pause': {
        const seconds = num(line.slice(5))
        if (seconds > 0) emit({ op: 'wait', seconds })
        break
      }
      case 'with': {
        const fade = transitionSeconds(line.slice(4))
        if (fade > 0) { flushStand(); emit({ op: 'wait', seconds: Math.min(fade, 1) }) }
        break
      }
      case 'label': case 'jump': case 'return': case 'window': case 'call': case 'translate':
        break
      default:
        count('raw', word || line.slice(0, 20))
    }
  }
  flushStand()
  // 最后一句之后剩下的指令（stop music 之类）并进最后一步，不单独成一步（否则末尾多一个空白的「点一下」）
  if (current.length && steps.length) { steps[steps.length - 1].commands.push(...current); current = [] }
  flush()
  return { steps, stats }
}

export const renpyLegecloAdapter = { id: ADAPTER_ID, label: "Ren'Py 脚本（legeclo）", sniff, parse, contextFiles, contextDirs, prepare }
