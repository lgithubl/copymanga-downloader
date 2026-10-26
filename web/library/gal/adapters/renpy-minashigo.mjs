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
// 其余选项（DEFAULT_OPTIONS = 今天的行为；公共选项的含义见 renpy-common.mjs / renpy-monmusu.mjs 头注释）：
//   standTags ['standimage']       立绘层的 tag（script.rpy 里的 layeredimage 名）；show / hide 这些 tag = 立绘
//   cropForms [正则]               立绘属性里「图集裁剪」的写法，命名组 path / x / y / w / h（默认 im.Crop("路径",(x,y,w,h))）
//   nameVar 'name'                 `$ name = "说话人"` 设说话人的变量名（'' = 不用，单字符串台词算旁白）
//   speakers {} / speakerVars ['^[A-Za-z_]\\w*$']   `xyz "台词"` 的角色变量：speakerVars 命中（默认任何非关键字标识符）才算台词；speakers 里有的变量用表里的名字，没有的用 nameVar 设的说话人
//   audioCommands {music:['music'], voice:['voice*'], se:[], other:'se'}   末尾 * 通配（voice* = voice / voice2 / …）；没列的声道按 other（默认 se）
//   fadeTags ['black']             show / hide 这些名字 = 黑场渐入 / 去掉
//   flash {counts:{flash:1,flash2:2,flash3:3,flash4:4}, seconds:0.3, color:'white'}   with <名字> 闪屏
//   blackRes ['^black\\d*$']       scene 名字命中（且不是图片 / 视频别名）= 黑底
//   aliasPatterns / movieNoLoopRe / imageIndex / voiceNoQuote / flow / transitions / sniff   同 monmusu（sniff.markerRes 默认认 `$ name=` / `xyz "…"`）
import { DEFAULT_ALIAS, IGNORED_WORDS, aliasKey, buildRenpyContext, clean, flowFilter, isBlackName, isMusicChannel, makeSniff, num, optionsCompiler, readDialogue, readPlay, renpyText, splitWith, transitionSeconds } from './renpy-common.mjs'

export const ADAPTER_ID = 'renpy-minashigo'
export const DEFAULT_OPTIONS = {
  aliasFiles: ['game/movie.rpy'],
  standFiles: ['game/script.rpy'],
  imageDirs: ['game/images'],
  ...DEFAULT_ALIAS,
  standTags: ['standimage'],
  cropForms: ['im\\.Crop\\(\\s*["\'](?<path>[^"\']+)["\']\\s*,\\s*\\(\\s*(?<x>-?\\d+)\\s*,\\s*(?<y>-?\\d+)\\s*,\\s*(?<w>\\d+)\\s*,\\s*(?<h>\\d+)\\s*\\)\\s*\\)'],
  nameVar: 'name',
  speakers: {},
  speakerVars: ['^[A-Za-z_]\\w*$'],
  audioCommands: { music: ['music'], voice: ['voice*'], se: [], other: 'se' },
  voiceNoQuote: { variables: {} },
  fadeTags: ['black'],
  flash: { counts: { flash: 1, flash2: 2, flash3: 3, flash4: 4 }, seconds: 0.3, color: 'white' },
  flow: { menu: 'raw', conditionals: 'linear' },
  transitions: { named: '^(?:dissolve|fade|pixellate|move)', seconds: 0.5 },
  blackRes: ['^black\\d*$'],
  // 这个格式独有的写法：$ name= "…" 或 xyz "…"。监视器之外的 Ren'Py 脚本（monmusu）没有它们
  sniff: { labelRe: '^\\s*label\\s+[A-Za-z_]\\w*\\s*:', markerRes: ['^\\s*(?:\\$\\s*name\\s*=|xyz\\s+["\'])'] },
}
export const opts = optionsCompiler(DEFAULT_OPTIONS)
const optionList = (options, key) => (Array.isArray(options?.[key]) ? options[key] : DEFAULT_OPTIONS[key]).map(String)
export const sniff = makeSniff(opts)

export const contextFiles = (options) => [...new Set([...optionList(options, 'aliasFiles'), ...optionList(options, 'standFiles')])]
export const contextDirs = (options) => optionList(options, 'imageDirs')

// ---------- 上下文：视频别名 + 图片目录（和 monmusu 同一套）+ 立绘定义 ----------
const STRING_RE = /^(["'])(.+?)\1\s*$/
const numberOf = (text, key) => { const m = new RegExp(`\\b${key}\\s+(-?[\\d.]+)`).exec(text); return m ? Number.parseFloat(m[1]) : null }

// layeredimage <名字>: 下面每个 attribute：{ src, crop?: [x,y,w,h], zoom, x, y, order }（order = 定义顺序，画的时候按它叠）
export function readLayeredImages(texts, options = null) {
  const cropForms = opts(options).cropForms
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
      const line = rawLine.replace(/^\uFEFF/, '')
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
      const crop = cropForms.map((re) => re.exec(body)).find((m) => m?.groups?.path)
      if (crop) { const g = crop.groups; attr.src = clean(g.path); attr.crop = [Number(g.x), Number(g.y), Number(g.w), Number(g.h)]; continue }
      const plain = STRING_RE.exec(body)
      if (plain && !attr.src) { attr.src = clean(plain[2]); continue }
      const zoom = numberOf(body, 'zoom'); if (zoom !== null) attr.zoom = zoom
      const x = numberOf(body, 'xpos'); if (x !== null) attr.x = x
      const y = numberOf(body, 'ypos'); if (y !== null) attr.y = y
    }
    finish()
  }
  return layered
}

export function prepare(args) {
  return { ...buildRenpyContext(args, opts(args?.options)), stands: readLayeredImages(args?.texts, args?.options) }
}

// ---------- 语句解析 ----------
const Q = '"\''
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const nameVarRe = (name) => new RegExp(`^\\$\\s*${escapeRe(name)}\\s*=\\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1\\s*$`)
const nameVarCache = new Map()

export function parse(text, ctx = null, meta = null) {
  const o = opts(meta?.options)
  const skipFlow = flowFilter(o.flow)
  const nameVar = o.nameVar ? (nameVarCache.get(o.nameVar) || nameVarCache.set(o.nameVar, nameVarRe(o.nameVar)).get(o.nameVar)) : null
  const steps = []
  let current = []
  let speaker = ''
  let inMovie = false
  const shown = new Map()    // 立绘 tag → 当前属性集合
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
  const flushStand = () => {
    if (!standDirty) return
    standDirty = false
    const parts = []
    for (const [tag, attrs] of shown) {
      const layer = ctx?.stands?.get(tag)
      for (const attr of attrs) {
        const part = layer?.get(attr)
        if (part) parts.push(part)
        else count('unresolved', `stand:${attr}`)
      }
    }
    parts.sort((a, b) => a.order - b.order)
    if (parts.length) { emit({ op: 'stand', parts: parts.map(({ order: _order, ...rest }) => rest) }); standOn = true; stats.stands += 1 }
    else if (standOn) { emit({ op: 'standOff' }); standOn = false }
  }
  const standOff = () => {
    shown.clear()
    standDirty = false
    if (standOn) { emit({ op: 'standOff' }); standOn = false }
  }
  const movieOff = () => { if (inMovie) { emit({ op: 'movieOff' }); inMovie = false } }
  const clauses = (rest) => splitWith(rest, o)

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    if (!line || line.startsWith('#')) continue
    if (skipFlow(rawLine, line, count)) continue
    stats.commands += 1

    const named = nameVar?.exec(line)
    if (named) { speaker = renpyText(named[2]); continue }
    if (line.startsWith('$')) continue   // 其余 python 语句（$renpy.end_replay() 之类）不碰

    // "名字" "台词" 两个字符串 = 带名字的台词；一个字符串（前面可以有角色变量 xyz）= 台词，说话人用 $ name 设的（speakers 表里有的变量用表里的名字）
    const dialogue = readDialogue(line, o, Q, o.nameVar ? speaker : '')
    if (dialogue) {
      flushStand()
      emit({ op: 'speaker', segments: dialogue.name ? [{ text: dialogue.name }] : [] })
      emit({ op: 'text', segments: dialogue.body ? [{ text: dialogue.body }] : [] })
      flush()
      continue
    }

    const word = /^[A-Za-z_]\w*/.exec(line)?.[0] || ''
    switch (word) {
      case 'scene': {
        const split = clauses(line.slice(5))
        const rest = split.rest.replace(/\s+(?:at|onlayer|behind|as)\s.*$/, '').trim()
        const key = aliasKey(rest)
        standOff()   // scene 会清掉屏幕上所有已显示的图（包括立绘）
        overlayBlack = false
        if (ctx?.movies?.has(key)) {
          const movie = ctx.movies.get(key)
          emit({ op: 'movie', srcs: [movie.src], loop: movie.loop })
          inMovie = true
          stats.movies += 1
        } else if (ctx?.images?.has(key)) {
          movieOff()
          emit({ op: 'bg', src: clean(ctx.images.get(key)), fade: split.fade })
        } else if (isBlackName(o, key)) {
          movieOff()
          emit({ op: 'bg', color: [0, 0, 0], fade: split.fade })
        } else {
          count('unresolved', rest)
          emit({ op: 'raw', cmd: 'scene', args: [rest] })
        }
        break
      }
      case 'show': {
        const split = clauses(line.slice(4))
        const [tag, ...attrs] = split.rest.replace(/\s+(?:at|onlayer|behind|as)\s.*$/, '').trim().split(/\s+/)
        if (o.standTags.has(tag)) {
          if (!shown.has(tag)) shown.set(tag, new Set())
          for (const attr of attrs) shown.get(tag).add(attr)
          standDirty = true
        } else if (o.fadeTags.has(tag)) { emit({ op: 'fade', to: 'black', seconds: split.fade }); overlayBlack = true }
        else count('raw', `show ${tag}`)
        break
      }
      case 'hide': {
        const tag = line.slice(4).trim().split(/\s+/)[0]
        if (o.standTags.has(tag)) standOff()
        else if (o.fadeTags.has(tag)) { if (overlayBlack) emit({ op: 'fade', to: 'clear', seconds: 0 }); overlayBlack = false }
        // 其他特效图（slash_1 之类）：show 时已记在 raw 里
        break
      }
      case 'play':
      case 'queue': {
        const play = readPlay(line, o, Q)
        if (!play) { count('raw', line.split(/\s+/).slice(0, 2).join(' ')); break }
        if (!play.src) break
        emit({ op: play.kind === 'bgm' ? 'bgm' : play.kind === 'voice' ? 'voice' : 'se', src: play.src })
        break
      }
      case 'stop': {
        const m = /^stop\s+(\w+)(?:\s+fadeout\s+([\d.]+))?/.exec(line)
        if (m && isMusicChannel(o, m[1])) emit({ op: 'bgmStop', fade: num(m[2]) })
        break
      }
      case 'pause': {
        const seconds = num(line.slice(5))
        if (seconds > 0) emit({ op: 'wait', seconds })
        break
      }
      case 'with': {
        const expr = line.slice(4).trim()
        if (o.flash.counts.has(expr)) { flushStand(); emit({ op: 'flash', color: o.flash.color, count: o.flash.counts.get(expr), seconds: o.flash.seconds }) }
        else { const fade = transitionSeconds(expr, o); if (fade > 0) { flushStand(); emit({ op: 'wait', seconds: Math.min(fade, 1) }) } }
        break
      }
      default:
        if (!IGNORED_WORDS.has(word)) count('raw', word || line.slice(0, 20))
    }
  }
  flushStand()
  // 最后一句之后剩下的指令（stop music 之类）并进最后一步，不单独成一步（否则末尾多一个空白的「点一下」）
  if (current.length && steps.length) { steps[steps.length - 1].commands.push(...current); current = [] }
  flush()
  return { steps, stats }
}

export const renpyMinashigoAdapter = { id: ADAPTER_ID, label: "Ren'Py 脚本（Minashigo）", sniff, parse, contextFiles, contextDirs, prepare }
