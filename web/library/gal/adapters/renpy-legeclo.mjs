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
//   voice "路径" [sustain …]                  Ren'Py 的 voice 语句（没有 play；真实脚本 39238 行，路径相对 game/）→ voice 指令，和后面的那句台词同一步；只取第一个引号串，sustain 等参数忽略；`voice [变量]` / 无引号写法记 raw（voiceNoQuote.variables 里有的除外）
//   "名字" "台词" / "" "台词"（旁白）            speaker + text，一句台词 = 一步；\n 是换行，{i}{w} 之类的文字标记去掉
//   pause [秒] / with Dissolve(n) / window / jump / return / call   pause 带秒数 → wait；with 转场 → 短暂等待；其余忽略
// 翻译叠加（tl/jptoen、tl/jptocn 里的 translate 块）暂不处理；只有 .rpyc 没有 .rpy 的脚本读不了（编译过的）。
//
// 选项 config.adapterOptions['renpy-legeclo']（DEFAULT_OPTIONS = 今天的行为；公共选项的含义见 renpy-common.mjs / renpy-monmusu.mjs 头注释）：
//   aliasFiles / imageDirs / aliasPatterns / movieNoLoopRe / imageIndex / voiceNoQuote / speakers / speakerVars / flow / transitions   同 monmusu（默认也一样；imageDirs 默认 ['images']）
//   align {left:'left', right:'right', center:'center', truecenter:'center'}   show … at <变换名> → stand 部件的 align；表里没有的变换名 = 不写 align（可加 pos_left: 'left' 之类）
//   audioCommands {music:['music'], voice:['voice'], se:['sound','audio'], other:'raw'}
//   bareVoice ['voice']   裸 `voice "路径"` 语句按语音处理（列出语句名；[] = 关掉，这些行记 raw）
//   blackRes ['^black$', '(?:^|_)black\\d*$']   scene 名字命中 = 黑底（不当背景图、不当缩略图）
//   sniff {labelRe:'^\\s*label\\s+H_\\w+\\s*:', markerRes:['^\\s*(?:\\$\\s*enable_skip\\s*\\(|play\\s+voice\\s+")']}   sniff(text, options)
import { DEFAULT_OPTIONS as MONMUSU_OPTIONS, contextDirs, contextFiles } from './renpy-monmusu.mjs'
import { IGNORED_WORDS, aliasKey, buildRenpyContext, clean, compositeBg, flowFilter, isBlackName, isMusicChannel, makeSniff, num, optionsCompiler, readBareVoice, readDialogue, readPlay, segmentsOf, splitWith, transitionSeconds } from './renpy-common.mjs'

export const ADAPTER_ID = 'renpy-legeclo'
export { contextDirs, contextFiles }

export const DEFAULT_OPTIONS = {
  ...MONMUSU_OPTIONS,
  align: { left: 'left', right: 'right', center: 'center', truecenter: 'center' },
  bareVoice: ['voice'],
  blackRes: ['^black$', '(?:^|_)black\\d*$'],
  // 独有写法：label H_xxx:（大写 H + 下划线）。monmusu 的 label 是 h<数字>，minashigo 靠 $ name= / xyz "…"，都不会被它认走
  sniff: { labelRe: '^\\s*label\\s+H_\\w+\\s*:', markerRes: ['^\\s*(?:\\$\\s*enable_skip\\s*\\(|play\\s+voice\\s+")'] },
}
export const opts = optionsCompiler(DEFAULT_OPTIONS)
export const sniff = makeSniff(opts)
export const prepare = (args) => buildRenpyContext(args, opts(args?.options))

const Q = '"'

// `show xxx at left with Dissolve(0.5)` → { name, fade, align }
function splitShow(rest, o) {
  const split = splitWith(rest, o)
  const at = /\s+at\s+(\w+)/.exec(split.rest)
  return { name: split.rest.replace(/\s+(?:at|onlayer|behind|as|zorder)\s.*$/, '').trim(), fade: split.fade, align: at ? o.align.get(at[1]) || '' : '' }
}

export function parse(text, ctx = null, meta = null) {
  const o = opts(meta?.options)
  const skipFlow = flowFilter(o.flow)
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
  const playMovie = (key) => {
    const movie = ctx.movies.get(key)
    emit({ op: 'movie', srcs: [movie.src], loop: movie.loop })
    inMovie = true
    stats.movies += 1
  }
  const movieOff = () => { if (inMovie) { emit({ op: 'movieOff' }); inMovie = false } }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    if (!line || line.startsWith('#')) continue
    if (skipFlow(rawLine, line, count)) continue
    stats.commands += 1
    if (line.startsWith('$')) continue   // python 语句（$ enable_skip() 之类）不碰

    const dialogue = readDialogue(line, o, Q)
    if (dialogue) {
      flushStand()
      if (dialogue.name !== speaker) { emit({ op: 'speaker', segments: segmentsOf(dialogue.name) }); speaker = dialogue.name }
      emit({ op: 'text', segments: segmentsOf(dialogue.body) })
      flush()
      continue
    }

    const word = /^[A-Za-z_]\w*/.exec(line)?.[0] || ''
    if (word && o.bareVoice.has(word) && /^\w+\s+\S/.test(line)) {   // 裸 voice 语句（没有 play）：和后面的台词同一步
      const src = readBareVoice(line.slice(word.length), o, Q)
      if (src) emit({ op: 'voice', src }); else count('raw', word)
      continue
    }
    switch (word) {
      case 'scene': {
        const { name, fade } = splitShow(line.slice(5), o)
        const key = aliasKey(name)
        standOff()   // scene 会清掉屏幕上所有已显示的图（包括立绘）
        if (isBlackName(o, key)) {
          movieOff()
          emit({ op: 'bg', color: [0, 0, 0], fade })
        } else if (ctx?.movies?.has(key)) playMovie(key)
        else if (ctx?.images?.has(key)) {
          movieOff()
          emit({ op: 'bg', ...(ctx.composites?.has(key) ? compositeBg(ctx.composites.get(key).map(clean)) : { src: clean(ctx.images.get(key)) }), fade })
        } else {
          count('unresolved', name)
          emit({ op: 'raw', cmd: 'scene', args: [name] })
        }
        break
      }
      case 'show': {
        const { name, align } = splitShow(line.slice(4), o)
        const key = aliasKey(name)
        if (ctx?.movies?.has(key)) playMovie(key)   // show 一个视频别名：当整幅画面的视频背景
        else if (ctx?.images?.has(key)) {
          shown.set(key, { src: clean(ctx.images.get(key)), align })
          standDirty = true
        } else count('unresolved', `show ${name}`)
        break
      }
      case 'hide': {
        const target = line.slice(4).trim()
        if (/^screen\b/.test(target)) break   // hide screen xxx：界面，不碰
        if (shown.delete(aliasKey(target.replace(/\s+with\s+.*$/, '')))) standDirty = true
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
        const m = /^stop\s+(\w+)(?:\s+fadeout\s*\(?\s*([\d.]+))?/.exec(line)
        if (m && isMusicChannel(o, m[1])) emit({ op: 'bgmStop', fade: num(m[2]) })
        break   // stop voice / stop sound：忽略
      }
      case 'pause': {
        const seconds = num(line.slice(5))
        if (seconds > 0) emit({ op: 'wait', seconds })
        break
      }
      case 'with': {
        const fade = transitionSeconds(line.slice(4), o)
        if (fade > 0) { flushStand(); emit({ op: 'wait', seconds: Math.min(fade, 1) }) }
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

export const renpyLegecloAdapter = { id: ADAPTER_ID, label: "Ren'Py 脚本（legeclo）", sniff, parse, contextFiles, contextDirs, prepare }
