// 适配器：Ren'Py 脚本（.rpy，monmusu 这类粉丝播放器的 script/hscene*/）→ 规范场景（gal-scene/1）。
// 只认剧情场景里用到的那一小撮语句，别的（界面、python、init）一律不碰：
//   scene black / scene <名字> [with 转场]   背景：名字先查视频别名（image X = Movie(play=…)）→ movie，再查图片目录 → bg；都查不到 → raw
//   show <单个名字> [with 转场]                angelic 的背景写法：名字查得到图片 / 视频别名就当背景（带属性 / at 的立绘不处理）
//   play music "路径" [fadein n] [fadeout n]  bgm（play sound → se）；stop music [fadeout n] → bgmStop
//   voice "路径"                              voice（对应下一句台词）
//   "名字" "台词" / "台词"                     speaker + text，一句台词 = 一步（点一下）
//   pause [秒] / window hide|show / with / jump / return / label   pause 带秒数 → wait，其余忽略
// 翻译叠加（tl/*）暂不处理。
//
// 适配器只读配置、按配置匹配：config.adapterOptions['renpy-monmusu']（路径相对媒体目录；适配器本身不读文件）。DEFAULT_OPTIONS = 今天的行为：
//   aliasFiles ['script/movie.rpy'] / imageDirs ['images']      视频别名表 / 图片目录（给 context.mjs 读）
//   aliasPatterns [{kind:'movie'|'image', re, scope?:'line'|'text'}]   别名定义写法（命名组 name / path；默认 = image X = Movie(play="…") / image X = "…"，单双引号各一条；scope 'text' = 对整个文件匹配，可写跨行形式）
//   stands {enabled:false, design:[1920,1080]}   `show 名字 属性:` + 缩进的 ypos / xalign / zoom → slot 立绘（见下）；composite.byName = 图层可以写没有扩展名的图片名
//   composite {enabled:true}       多行 Composite(...) 图片定义（名字可带空格）按图层读：第一层 = bg.src，两层以上时最后一层 = bg.over；false = 不读（这些名字查不到图）
//   movieNoLoopRe                  命中视频定义文本 = 不循环（默认 loop=False）
//   imageIndex {preferDirs:[], ext:[png,jpg,jpeg,webp,avif,gif], extPriority:false}   图片名 → 文件：同名文件按 preferDirs（资源路径前缀，靠前优先）→ extPriority 时按 ext 顺序 → 路径顺序挑；ext 也是别名定义里图片路径的扩展名白名单
//   audioCommands {music:['music'], voice:['voice'], se:['sound','audio'], other:'raw'}   play/queue 的声道归类（末尾 * 通配；other = 其它声道：raw 记入 stats.raw / se / ignore）；按路径再归类由引擎 config.classify 做
//   voiceNoQuote {variables:{}}    play voice [变量] / 裸变量名 / "路径含 [变量]" 按表替换成路径；表里没有 = 和以前一样记 raw
//   speakers {} / speakerVars []   `e "台词"` 这种角色变量写法：变量在 speakers 里（值 = 显示名，'' = 旁白）或匹配 speakerVars 里的正则才认；没配 = 只认字面名字
//   flow {menu:'raw', conditionals:'linear'}   menu: raw = menu 和选项行记 raw / linear = 静默跳过；conditionals: linear = if/elif/else 各分支按顺序读 / ignore = 整块跳过
//   transitions {named:'^(?:dissolve|fade|pixellate|move)', seconds:0.5}   命名转场的渐变秒数
//   blackRes ['^black$']           scene 名字命中 = 黑底
//   sniff {labelRe, markerRes[]}   sniff(text, options)：头 8KB 里 labelRe 命中且 markerRes 任一命中
import { DEFAULT_ALIAS, IGNORED_WORDS, aliasKey, buildRenpyContext, clean, compositeBg, flowFilter, isBlackName, isMusicChannel, makeSniff, num, optionsCompiler, readDialogue, readOperand, readPlay, renpyText, segmentsOf, splitWith, transitionSeconds } from './renpy-common.mjs'

export { renpyText }

export const ADAPTER_ID = 'renpy-monmusu'
export const DEFAULT_OPTIONS = {
  aliasFiles: ['script/movie.rpy'],
  imageDirs: ['images'],
  ...DEFAULT_ALIAS,
  composite: { enabled: true, byName: false },
  // stands：`show <名字> <属性>[:]` 查得到 Composite 就当立绘（槽位 = 名字第一个词，和 Ren'Py 的 image tag 一样；hide 去掉、scene 清空）。缩进块里的 xpos / ypos / xalign / yalign / zoom 按设计分辨率摆（没写位置 = 底边居中）
  stands: { enabled: false, design: [1920, 1080] },
  audioCommands: { music: ['music'], voice: ['voice'], se: ['sound', 'audio'], other: 'raw' },
  voiceNoQuote: { variables: {} },
  speakers: {},
  speakerVars: [],
  flow: { menu: 'raw', conditionals: 'linear' },
  transitions: { named: '^(?:dissolve|fade|pixellate|move)', seconds: 0.5 },
  blackRes: ['^black$'],
  sniff: { labelRe: '^\\s*label\\s+[A-Za-z_]\\w*\\s*:', markerRes: ['^\\s*(?:voice\\s+"|scene\\s+\\S|play\\s+(?:music|sound)\\s+")'] },
}
export const opts = optionsCompiler(DEFAULT_OPTIONS)
const optionList = (options, key) => (Array.isArray(options?.[key]) ? options[key] : DEFAULT_OPTIONS[key]).map(String)

export const sniff = makeSniff(opts)

// ---------- 上下文：视频别名表 + 图片目录索引 ----------
export const contextFiles = (options) => optionList(options, 'aliasFiles')
export const contextDirs = (options) => optionList(options, 'imageDirs')
export const prepare = (args) => buildRenpyContext(args, opts(args?.options))

// ---------- 语句解析 ----------
const Q = '"'

export function parse(text, ctx = null, meta = null) {
  const o = opts(meta?.options)
  const skipFlow = flowFilter(o.flow)
  const steps = []
  let current = []
  let speaker = ''
  let inMovie = false
  const stats = { commands: 0, raw: {}, unresolved: {}, movies: 0 }
  const emit = (command) => { current.push(command) }
  const flush = () => {
    if (current.length) steps.push({ index: steps.length, commands: current })
    current = []
  }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const playMovie = (key) => {
    const movie = ctx.movies.get(key)
    emit({ op: 'movie', srcs: [movie.src], loop: movie.loop })
    inMovie = true
    stats.movies += 1
  }
  const standOf = (key) => (o.stands.enabled && ctx?.composites?.has(key) ? key : '')
  const standSlot = (key) => key.split(/\s+/)[0]
  let block = null   // show X: 后面缩进的属性行
  const [dw, dh] = o.stands.design
  const finishBlock = () => {
    if (!block) return
    const { key, props } = block
    block = null
    const layers = ctx.composites.get(key)
    const [cw, ch] = ctx.compositeSize?.get(key) || [dw, dh]
    const zoom = props.zoom > 0 ? props.zoom : 1
    const w = cw * zoom
    const h = ch * zoom
    const left = props.xalign !== undefined ? props.xalign * (dw - w) : props.xpos !== undefined ? props.xpos : (dw - w) / 2
    const top = props.yalign !== undefined ? props.yalign * (dh - h) : props.ypos !== undefined ? props.ypos : dh - h
    const x = left + w / 2 - dw / 2
    const y = top + h / 2 - dh / 2
    emit({ op: 'stand', slot: standSlot(key), stage: [dw, dh], parts: layers.map((src) => ({ src: clean(src), x, y, scale: zoom })) })
  }
  const bgLayers = (c, key) => (c.composites?.has(key) ? compositeBg(c.composites.get(key).map(clean)) : { src: clean(c.images.get(key)) })
  const bgFrom = (key, fade) => {
    if (inMovie) { emit({ op: 'movieOff' }); inMovie = false }
    emit({ op: 'bg', ...bgLayers(ctx, key), fade })
  }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    if (!line || line.startsWith('#')) continue
    if (block) {
      const prop = /^(xpos|ypos|xalign|yalign|zoom)\s+(-?[\d.]+)\s*$/.exec(line)
      if (prop && rawLine.length - rawLine.trimStart().length > block.indent) { block.props[prop[1]] = Number(prop[2]); continue }
      finishBlock()
    }
    if (skipFlow(rawLine, line, count)) continue
    stats.commands += 1

    const dialogue = readDialogue(line, o, Q)
    if (dialogue) {
      if (dialogue.name !== speaker) { emit({ op: 'speaker', segments: segmentsOf(dialogue.name) }); speaker = dialogue.name }
      emit({ op: 'text', segments: segmentsOf(dialogue.body) })
      flush()
      continue
    }

    const word = /^[$A-Za-z_]\w*|^\$/.exec(line)?.[0] || ''
    switch (word) {
      case 'scene': {
        if (o.stands.enabled) emit({ op: 'standOff' })
        const split = splitWith(line.slice(5), o)
        const rest = split.rest.replace(/\s+(?:at|onlayer|behind|as)\s.*$/, '').trim()
        const key = aliasKey(rest)
        if (isBlackName(o, key)) {
          if (inMovie) { emit({ op: 'movieOff' }); inMovie = false }
          emit({ op: 'bg', color: [0, 0, 0], fade: split.fade })
        } else if (ctx?.movies?.has(key)) playMovie(key)
        else if (ctx?.images?.has(key)) bgFrom(key, split.fade)
        else {
          count('unresolved', rest)
          emit({ op: 'raw', cmd: 'scene', args: [rest] })
        }
        break
      }
      case 'show': {
        // angelic：背景用 `show ba013`（单个名字，没有属性 / at）。名字能查到图片 / 视频别名才当背景；带属性或 at / behind 的是立绘，仍然记 raw
        const split = splitWith(line.slice(4), o)
        const colon = /:\s*$/.test(split.rest)
        const key = aliasKey(split.rest.replace(/:\s*$/, ''))
        if (standOf(key)) { block = { key, props: {}, indent: rawLine.length - rawLine.trimStart().length }; if (!colon) finishBlock(); break }
        if (/\s/.test(key) || !key) { count('raw', 'show'); break }
        if (ctx?.movies?.has(key)) playMovie(key)
        else if (ctx?.images?.has(key)) bgFrom(key, split.fade)
        else count('raw', 'show')
        break
      }
      case 'hide': {
        const key = aliasKey(line.slice(4).replace(/\s+with\s.*$/, ''))
        if (standOf(key)) emit({ op: 'standOff', slot: standSlot(key) })
        else count('raw', 'hide')
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
      case 'voice': {
        const src = readOperand(line.slice(5), o, Q)
        if (src) emit({ op: 'voice', src })
        break
      }
      case 'pause': {
        const seconds = num(line.slice(5))
        if (seconds > 0) emit({ op: 'wait', seconds })
        break
      }
      case 'with': {
        const fade = transitionSeconds(line.slice(4), o)
        if (fade > 0) emit({ op: 'fade', to: 'clear', seconds: fade })
        break
      }
      default:
        if (!IGNORED_WORDS.has(word)) count('raw', word || line.slice(0, 20))
    }
  }
  finishBlock()
  flush()
  return { steps, stats }
}

export const renpyMonmusuAdapter = { id: ADAPTER_ID, label: "Ren'Py 脚本（monmusu）", sniff, parse, contextFiles, contextDirs, prepare }
