// 适配器：Ren'Py 脚本（MinashigoViewer：game/scripts/scene_*.rpy）→ 规范场景（gal-scene/1）。
// 和 renpy-monmusu 是两个独立的适配器（写法不一样，互不影响）：这里的特点是
//   $ name= "说话人"                         说话人（空 = 旁白）；之后的 xyz "台词" 都用它（xyz = DynamicCharacter("name")）
//   xyz "台词"                               台词，一句 = 一步；"\n" 是换行；也认 "台词" / "名字" "台词"
//   scene <图片名> [with 转场]               背景：先查视频别名（image X = Movie(play=…)）→ 图片目录；black / black1… 没有图片就是黑底
//   play music '路径' / play voice2 '路径' / queue sound '路径'   bgm / voice（voice、voice2 都算语音）/ se；引号单双都行
//   stop music [fadeout n]                   bgmStop
//   show standimage <属性…> / hide standimage   立绘：script.rpy 里的 layeredimage standimage，每个属性 = 一张立绘图集上裁出的一块
//                                            （im.Crop("images/stand/xxx.png",(x,y,w,h)) + zoom / xpos / ypos）→ stand 指令（parts）；hide / scene → standOff
//   show black with Dissolve(n) / hide black 黑场渐入 / 去掉；with flash / flash2… → flash（闪 1/2/… 次）
//   show <别的特效图> / hide …               认得但暂未渲染，只记在 stats.raw 里
//   pause [秒] / window / with / jump / return / label / $renpy.end_replay()   pause 带秒数 → wait，其余忽略
// 别名表、立绘定义、图片目录由 config.adapterOptions['renpy-minashigo'] 指定（路径相对媒体目录，适配器本身不读文件）：
//   { aliasFiles: ['game/movie.rpy'], standFiles: ['game/script.rpy'], imageDirs: ['game/images'] }
import { prepare as monmusuPrepare, renpyText } from './renpy-monmusu.mjs'

export const ADAPTER_ID = 'renpy-minashigo'
const DEFAULT_OPTIONS = { aliasFiles: ['game/movie.rpy'], standFiles: ['game/script.rpy'], imageDirs: ['game/images'] }
const optionList = (options, key) => (Array.isArray(options?.[key]) ? options[key] : DEFAULT_OPTIONS[key]).map(String)

// 这个格式独有的写法：$ name= "…" 或 xyz "…"。监视器之外的 Ren'Py 脚本（monmusu）没有它们
const MARKER_RE = /^\s*(?:\$\s*name\s*=|xyz\s+["'])/m
export function sniff(text) {
  const head = String(text || '').slice(0, 8192)
  return /^\s*label\s+[A-Za-z_]\w*\s*:/m.test(head) && MARKER_RE.test(head)
}

export const contextFiles = (options) => [...new Set([...optionList(options, 'aliasFiles'), ...optionList(options, 'standFiles')])]
export const contextDirs = (options) => optionList(options, 'imageDirs')

// ---------- 上下文：视频别名 + 图片目录（和 monmusu 同一套）+ 立绘定义 ----------
const CROP_RE = /im\.Crop\(\s*(["'])(.+?)\1\s*,\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\)/
const STRING_RE = /^(["'])(.+?)\1\s*$/
const numberOf = (text, key) => { const m = new RegExp(`\\b${key}\\s+(-?[\\d.]+)`).exec(text); return m ? Number.parseFloat(m[1]) : null }
const cleanPath = (rel) => String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')

// layeredimage <名字>: 下面每个 attribute：{ src, crop?: [x,y,w,h], zoom, x, y, order }（order = 定义顺序，画的时候按它叠）
export function readLayeredImages(texts) {
  const layered = new Map()   // 名字 → Map(属性 → 部件)
  for (const text of Object.values(texts || {})) {
    if (!String(text).includes('layeredimage')) continue
    let current = null
    let attr = null
    let order = 0
    const finish = () => {
      if (current && attr && attr.src) current.set(attr.name, { src: attr.src, ...(attr.crop ? { crop: attr.crop } : {}), zoom: attr.zoom, x: attr.x, y: attr.y, order: attr.order })
      attr = null
    }
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.replace(/^﻿/, '')
      if (!line.trim() || line.trim().startsWith('#')) continue
      const indented = /^\s/.test(line)
      const head = /^layeredimage\s+([\w.]+)\s*:/.exec(line)
      if (head) { finish(); current = layered.get(head[1]) || new Map(); layered.set(head[1], current); order = 0; continue }
      if (!indented) { finish(); current = null; continue }
      if (!current) continue
      const body = line.trim()
      const def = /^attribute\s+(\S+?)(?:\s+(.*?))?\s*:?\s*$/.exec(body)
      if (def) {
        finish()
        const props = def[2] || ''
        attr = { name: def[1], zoom: numberOf(props, 'zoom') ?? 1, x: numberOf(props, 'xpos') ?? 0, y: numberOf(props, 'ypos') ?? 0, order: order++, src: '', crop: null }
        continue
      }
      if (/^(?:group|always|if)\b/.test(body)) { finish(); continue }
      if (!attr) continue
      const crop = CROP_RE.exec(body)
      if (crop) { attr.src = cleanPath(crop[2]); attr.crop = [Number(crop[3]), Number(crop[4]), Number(crop[5]), Number(crop[6])]; continue }
      const plain = STRING_RE.exec(body)
      if (plain && !attr.src) { attr.src = cleanPath(plain[2]); continue }
      const zoom = numberOf(body, 'zoom'); if (zoom !== null) attr.zoom = zoom
      const x = numberOf(body, 'xpos'); if (x !== null) attr.x = x
      const y = numberOf(body, 'ypos'); if (y !== null) attr.y = y
    }
    finish()
  }
  return layered
}

export function prepare({ texts, files, toResourcePath }) {
  const base = monmusuPrepare({ texts, files, toResourcePath })
  return { ...base, stands: readLayeredImages(texts) }
}

// ---------- 语句解析 ----------
// 带引号的字符串（单双引号都行，支持 \" 转义）。引号捕获组的序号要写对：反向引用 \N 指的是它
const quoted = (n) => `(["'])((?:(?!\\${n})[^\\\\]|\\\\.)*)\\${n}`
// 组：1 角色变量（可无）、2/3 第一个字符串（引号 / 内容）、4/5 第二个字符串
const DIALOGUE_RE = new RegExp(`^(?:([A-Za-z_]\\w*)\\s+)?${quoted(2)}(?:\\s+${quoted(4)})?(?:\\s+with\\s+\\S.*)?$`)
const NAME_VAR_RE = new RegExp(`^\\$\\s*name\\s*=\\s*${quoted(1)}\\s*$`)
// 组：1 声道、2/3 路径
const PLAY_RE = new RegExp(`^(?:play|queue)\\s+(\\w+)\\s+${quoted(2)}`)
const KEYWORDS = new Set(['play', 'queue', 'scene', 'show', 'hide', 'with', 'stop', 'label', 'jump', 'call', 'window', 'pause', 'return', 'voice', 'translate', 'image', 'define', 'init', 'python', 'if', 'elif', 'else', 'while', 'menu'])
const aliasKey = (name) => String(name).trim().replace(/\s+/g, ' ').toLowerCase()
const num = (text, fallback = 0) => { const n = Number.parseFloat(text); return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : fallback }
function transitionSeconds(expr) {
  const text = String(expr ?? '').trim()
  if (!text || /^none$/i.test(text)) return 0
  const m = /\(\s*([\d.]+)/.exec(text)
  if (m) return num(m[1])
  return /^(?:dissolve|fade|pixellate|move)/i.test(text) ? 0.5 : 0
}
const FLASH_COUNT = { flash: 1, flash2: 2, flash3: 3, flash4: 4 }
const STAND_TAG = 'standimage'

export function parse(text, ctx = null) {
  const steps = []
  let current = []
  let speaker = ''
  let inMovie = false
  let shown = new Set()      // 当前立绘的属性
  let standOn = false        // 屏幕上现在有立绘
  let standDirty = false     // 属性变了还没发 stand 指令（show 一条条来，等到下一句台词 / 换场再一起发）
  let overlayBlack = false
  const stats = { commands: 0, raw: {}, unresolved: {}, movies: 0, stands: 0 }
  const emit = (command) => { current.push(command) }
  const flush = () => {
    if (current.length) steps.push({ index: steps.length, commands: current })
    current = []
  }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const layer = ctx?.stands?.get(STAND_TAG)
  const flushStand = () => {
    if (!standDirty) return
    standDirty = false
    const parts = []
    for (const attr of shown) {
      const part = layer?.get(attr)
      if (part) parts.push(part)
      else count('unresolved', `stand:${attr}`)
    }
    parts.sort((a, b) => a.order - b.order)
    if (parts.length) { emit({ op: 'stand', parts: parts.map(({ order: _order, ...rest }) => rest) }); standOn = true; stats.stands += 1 }
    else if (standOn) { emit({ op: 'standOff' }); standOn = false }
  }
  const standOff = () => {
    shown = new Set()
    standDirty = false
    if (standOn) { emit({ op: 'standOff' }); standOn = false }
  }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '').trim()
    if (!line || line.startsWith('#')) continue
    stats.commands += 1

    const nameVar = NAME_VAR_RE.exec(line)
    if (nameVar) { speaker = renpyText(nameVar[2]); continue }
    if (line.startsWith('$')) continue   // 其余 python 语句（$renpy.end_replay() 之类）不碰

    const dialogue = DIALOGUE_RE.exec(line)
    if (dialogue && (!dialogue[1] || !KEYWORDS.has(dialogue[1]))) {
      // "名字" "台词" 两个字符串 = 带名字的台词；一个字符串（前面可以有角色变量 xyz）= 台词，说话人用 $ name 设的
      const named = dialogue[5] !== undefined && !dialogue[1]
      const who = named ? renpyText(dialogue[3]) : speaker
      const body = renpyText(named ? dialogue[5] : dialogue[3])
      flushStand()
      emit({ op: 'speaker', segments: who ? [{ text: who }] : [] })
      emit({ op: 'text', segments: body ? [{ text: body }] : [] })
      flush()
      continue
    }

    const word = /^[A-Za-z_]\w*/.exec(line)?.[0] || ''
    switch (word) {
      case 'scene': {
        let rest = line.slice(5).trim()
        let fade = 0
        const withAt = rest.search(/\s+with\s+/)
        if (withAt >= 0) { fade = transitionSeconds(rest.slice(withAt).replace(/^\s+with\s+/, '')); rest = rest.slice(0, withAt).trim() }
        rest = rest.replace(/\s+(?:at|onlayer|behind|as)\s.*$/, '').trim()
        const key = aliasKey(rest)
        standOff()   // scene 会清掉屏幕上所有已显示的图（包括立绘）
        overlayBlack = false
        if (ctx?.movies?.has(key)) {
          const movie = ctx.movies.get(key)
          emit({ op: 'movie', srcs: [movie.src], loop: movie.loop })
          inMovie = true
          stats.movies += 1
        } else if (ctx?.images?.has(key)) {
          if (inMovie) { emit({ op: 'movieOff' }); inMovie = false }
          emit({ op: 'bg', src: cleanPath(ctx.images.get(key)), fade })
        } else if (/^black\d*$/.test(key)) {
          if (inMovie) { emit({ op: 'movieOff' }); inMovie = false }
          emit({ op: 'bg', color: [0, 0, 0], fade })
        } else {
          count('unresolved', rest)
          emit({ op: 'raw', cmd: 'scene', args: [rest] })
        }
        break
      }
      case 'show': {
        let rest = line.slice(4).trim()
        let fade = 0
        const withAt = rest.search(/\s+with\s+/)
        if (withAt >= 0) { fade = transitionSeconds(rest.slice(withAt).replace(/^\s+with\s+/, '')); rest = rest.slice(0, withAt).trim() }
        rest = rest.replace(/\s+(?:at|onlayer|behind|as)\s.*$/, '').trim()
        const [tag, ...attrs] = rest.split(/\s+/)
        if (tag === STAND_TAG) { for (const attr of attrs) shown.add(attr); standDirty = true }
        else if (tag === 'black') { emit({ op: 'fade', to: 'black', seconds: fade }); overlayBlack = true }
        else count('raw', `show ${tag}`)
        break
      }
      case 'hide': {
        const tag = line.slice(4).trim().split(/\s+/)[0]
        if (tag === STAND_TAG) standOff()
        else if (tag === 'black') { if (overlayBlack) emit({ op: 'fade', to: 'clear', seconds: 0 }); overlayBlack = false }
        // 其他特效图（slash_1 之类）：show 时已记在 raw 里
        break
      }
      case 'play':
      case 'queue': {
        const m = PLAY_RE.exec(line)
        if (!m) { count('raw', line.split(/\s+/).slice(0, 2).join(' ')); break }
        const src = cleanPath(m[3])
        if (!src) break
        if (m[1] === 'music') emit({ op: 'bgm', src })
        else if (/^voice/.test(m[1])) emit({ op: 'voice', src })
        else emit({ op: 'se', src })
        break
      }
      case 'stop': {
        const m = /^stop\s+music(?:\s+fadeout\s+([\d.]+))?/.exec(line)
        if (m) emit({ op: 'bgmStop', fade: num(m[1]) })
        break
      }
      case 'pause': {
        const seconds = num(line.slice(5))
        if (seconds > 0) emit({ op: 'wait', seconds })
        break
      }
      case 'with': {
        const expr = line.slice(4).trim()
        if (FLASH_COUNT[expr]) { flushStand(); emit({ op: 'flash', color: 'white', count: FLASH_COUNT[expr], seconds: 0.3 }) }
        else { const fade = transitionSeconds(expr); if (fade > 0) { flushStand(); emit({ op: 'wait', seconds: Math.min(fade, 1) }) } }
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

export const renpyMinashigoAdapter = { id: ADAPTER_ID, label: "Ren'Py 脚本（Minashigo）", sniff, parse, contextFiles, contextDirs, prepare }
