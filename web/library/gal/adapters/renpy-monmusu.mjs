// 适配器：Ren'Py 脚本（.rpy，monmusu 这类粉丝播放器的 script/hscene*/）→ 规范场景（gal-scene/1）。
// 只认剧情场景里用到的那一小撮语句，别的（界面、python、init）一律不碰：
//   scene black / scene <名字> [with 转场]   背景：名字先查视频别名（image X = Movie(play=…)）→ movie，再查图片目录 → bg；都查不到 → raw
//   show <单个名字> [with 转场]                angelic 的背景写法：名字查得到图片 / 视频别名就当背景（带属性 / at 的立绘不处理）
//   play music "路径" [fadein n] [fadeout n]  bgm（play sound → se）；stop music [fadeout n] → bgmStop
//   voice "路径"                              voice（对应下一句台词）
//   "名字" "台词" / "台词"                     speaker + text，一句台词 = 一步（点一下）
//   pause [秒] / window hide|show / with / jump / return / label   pause 带秒数 → wait，其余忽略
// 视频别名表和图片目录由 config.adapterOptions['renpy-monmusu'] 指定（见 ../context.mjs，适配器本身不读文件）：
//   { aliasFiles: ['script/movie.rpy'], imageDirs: ['images'] }   路径相对媒体目录
// 翻译叠加（tl/*）暂不处理。

export const ADAPTER_ID = 'renpy-monmusu'
const DEFAULT_OPTIONS = { aliasFiles: ['script/movie.rpy'], imageDirs: ['images'] }
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'])

const optionList = (options, key) => (Array.isArray(options?.[key]) ? options[key] : DEFAULT_OPTIONS[key]).map(String)

export function sniff(text) {
  const head = String(text || '').slice(0, 8192)
  return /^\s*label\s+[A-Za-z_]\w*\s*:/m.test(head) && /^\s*(?:voice\s+"|scene\s+\S|play\s+(?:music|sound)\s+")/m.test(head)
}

// ---------- 上下文：视频别名表 + 图片目录索引 ----------
export const contextFiles = (options) => optionList(options, 'aliasFiles')
export const contextDirs = (options) => optionList(options, 'imageDirs')

const MOVIE_RE = /^image\s+(.+?)\s*=\s*Movie\s*\(([^)]*)\)/
const IMAGE_DEF_RE = /^image\s+(.+?)\s*=\s*(["'])((?:(?!\2).)+)\2\s*$/
const aliasKey = (name) => String(name).trim().replace(/\s+/g, ' ').toLowerCase()

export function prepare({ texts, files, toResourcePath }) {
  const movies = new Map()   // 别名 → { src, loop }
  const images = new Map()   // 别名 → 资源路径
  for (const text of Object.values(texts || {})) {
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, '').trim()
      if (!line.startsWith('image')) continue
      const movie = MOVIE_RE.exec(line)
      if (movie) {
        const play = /\bplay\s*=\s*(["'])((?:(?!\1).)+)\1/.exec(movie[2])
        if (play) movies.set(aliasKey(movie[1]), { src: play[2].replace(/\\/g, '/').replace(/^\/+/, ''), loop: !/\bloop\s*=\s*False\b/.test(movie[2]) })
        continue
      }
      const def = IMAGE_DEF_RE.exec(line)
      if (def && IMAGE_EXTS.has(def[3].split('.').pop().toLowerCase())) images.set(aliasKey(def[1]), def[3].replace(/\\/g, '/').replace(/^\/+/, ''))
    }
  }
  // 图片目录：Ren'Py 把 images/ 下的文件按「无扩展名的文件名」自动定义成图片名
  for (const rel of [...(files || [])].sort()) {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const dot = name.lastIndexOf('.')
    if (dot <= 0 || !IMAGE_EXTS.has(name.slice(dot + 1).toLowerCase())) continue
    const key = aliasKey(name.slice(0, dot))
    if (!images.has(key)) images.set(key, toResourcePath ? toResourcePath(rel) : rel)
  }
  return { movies, images }
}

// ---------- 语句解析 ----------
const STR = '"((?:[^"\\\\]|\\\\.)*)"'
const DIALOGUE_RE = new RegExp(`^${STR}(?:\\s+${STR})?(?:\\s+with\\s+\\S.*)?$`)
const PATH_RE = /^(?:play|queue)\s+(music|sound|audio|voice)\s+(?:\[[^\]]*\]|"((?:[^"\\]|\\.)*)")/
const num = (text, fallback = 0) => { const n = Number.parseFloat(text); return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : fallback }

// 转场 → 渐变秒数：Dissolve(0.4) / Fade(0.5, 0, 0.5) 取第一个数；dissolve / fade 这类命名转场按 0.5；None 或认不出 = 0
function transitionSeconds(expr) {
  const text = String(expr ?? '').trim()
  if (!text || /^none$/i.test(text)) return 0
  const m = /\(\s*([\d.]+)/.exec(text)
  if (m) return num(m[1])
  return /^(?:dissolve|fade|pixellate|move)/i.test(text) ? 0.5 : 0
}

// 台词文字：去掉 Ren'Py 文字标记（{i} {w} {size=…} …），{p}/{br} 当换行，转义还原；[变量] 原样保留
export function renpyText(raw) {
  return String(raw ?? '')
    .replace(/\{\{/g, '\u0001')
    .replace(/\{(?:p|br)(?:=[^}]*)?\}/g, '\n')
    .replace(/\{\/?[a-zA-Z][^}]*\}/g, '')
    .replace(/\u0001/g, '{')
    .replace(/\\n/g, '\n')
    .replace(/\\(["'\\])/g, '$1')
    .trim()
}
const segmentsOf = (text) => (text ? [{ text }] : [])
const clean = (rel) => String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')

export function parse(text, ctx = null) {
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

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    if (!line || line.startsWith('#')) continue
    stats.commands += 1

    const dialogue = DIALOGUE_RE.exec(line)
    if (dialogue) {
      const named = dialogue[2] !== undefined
      const name = named ? renpyText(dialogue[1]) : ''
      const body = renpyText(named ? dialogue[2] : dialogue[1])
      if (name !== speaker) { emit({ op: 'speaker', segments: segmentsOf(name) }); speaker = name }
      emit({ op: 'text', segments: segmentsOf(body) })
      flush()
      continue
    }

    const word = /^[$A-Za-z_]\w*|^\$/.exec(line)?.[0] || ''
    switch (word) {
      case 'scene': {
        let rest = line.slice(5).trim()
        let fade = 0
        const withAt = rest.search(/\s+with\s+/)
        if (withAt >= 0) { fade = transitionSeconds(rest.slice(withAt).replace(/^\s+with\s+/, '')); rest = rest.slice(0, withAt).trim() }
        rest = rest.replace(/\s+(?:at|onlayer|behind|as)\s.*$/, '').trim()
        const key = aliasKey(rest)
        if (key === 'black') {
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
          count('unresolved', rest)
          emit({ op: 'raw', cmd: 'scene', args: [rest] })
        }
        break
      }
      case 'show': {
        // angelic：背景用 `show ba013`（单个名字，没有属性 / at）。名字能查到图片 / 视频别名才当背景；带属性或 at / behind 的是立绘，仍然记 raw
        let rest = line.slice(4).trim()
        let fade = 0
        const withAt = rest.search(/\s+with\s+/)
        if (withAt >= 0) { fade = transitionSeconds(rest.slice(withAt).replace(/^\s+with\s+/, '')); rest = rest.slice(0, withAt).trim() }
        const key = aliasKey(rest)
        if (/\s/.test(key) || !key) { count('raw', 'show'); break }
        if (ctx?.movies?.has(key)) {
          const movie = ctx.movies.get(key)
          emit({ op: 'movie', srcs: [movie.src], loop: movie.loop })
          inMovie = true
          stats.movies += 1
        } else if (ctx?.images?.has(key)) {
          if (inMovie) { emit({ op: 'movieOff' }); inMovie = false }
          emit({ op: 'bg', src: clean(ctx.images.get(key)), fade })
        } else count('raw', 'show')
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
        const m = /^stop\s+music(?:\s+fadeout\s+([\d.]+))?/.exec(line)
        if (m) emit({ op: 'bgmStop', fade: num(m[1]) })
        break
      }
      case 'voice': {
        const m = new RegExp(`^voice\\s+${STR}`).exec(line)
        const src = clean(m?.[1])
        if (src) emit({ op: 'voice', src })
        break
      }
      case 'pause': {
        const seconds = num(line.slice(5))
        if (seconds > 0) emit({ op: 'wait', seconds })
        break
      }
      case 'with': {
        const fade = transitionSeconds(line.slice(4))
        if (fade > 0) emit({ op: 'fade', to: 'clear', seconds: fade })
        break
      }
      case 'label': case 'jump': case 'return': case 'window': case 'call': case 'translate':
        break
      default:
        count('raw', word || line.slice(0, 20))
    }
  }
  flush()
  return { steps, stats }
}

export const renpyMonmusuAdapter = { id: ADAPTER_ID, label: "Ren'Py 脚本（monmusu）", sniff, parse, contextFiles, contextDirs, prepare }
