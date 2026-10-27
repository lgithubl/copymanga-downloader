// Ren'Py 三个适配器（renpy-monmusu / renpy-legeclo / renpy-minashigo）共用的零件：
//   - 选项编译：config.adapterOptions['<适配器 id>'] → 编译好的规则（带默认值；非法项丢掉，不抛）
//   - 台词 / 播放语句 / 流程语句 / 转场的小解析器：全部由选项里的表驱动，这里不认识任何游戏
//   - 上下文（视频别名表 + 图片名索引）：按 aliasPatterns / imageIndex 建，路径核对走 gal/resolve.mjs 的 createIndexResolver
// 适配器各自的 DEFAULT_OPTIONS 写「今天的行为」；管理员脚本（gal-layout）把猜出来的表写进 adapterOptions 覆盖它们。
// 公共选项（schema 见各适配器头注释；每个适配器只收它默认值里列出的键）：
//   align            { <at 后面的变换名>: 'left'|'right'|'center'|<自定义> }                 立绘站位表
//   speakers         { <角色变量>: <显示名> }（'' = 旁白）；speakerVars [正则]：这些变量名写的 `e "台词"` 也算台词
//   nameVar          '$ <名字> = "说话人"' 设说话人的变量名（'' = 不用）
//   flow             { menu: 'raw'|'linear', conditionals: 'linear'|'ignore' }
//   aliasPatterns    [{ kind: 'movie'|'image', re, scope?: 'line'|'text' }]   命名组 (?<name>) (?<path>)；movie 的 loop 看 movieNoLoopRe
//   movieNoLoopRe    匹配整条 movie 定义文本，命中 = 不循环
//   imageIndex       { preferDirs: [资源路径前缀], ext: [扩展名], extPriority: false }
//   audioCommands    { music: [声道], voice: [声道], se: [声道], other: 'raw'|'se'|'ignore' }   声道名末尾可带 * 通配
//   voiceNoQuote     { variables: { <变量名>: <路径> } }
//   bareVoice        [语句名]：裸的 `<语句名> "路径"`（Ren'Py 的 voice 语句，没有 play）按语音处理，对应下一句台词；[] = 不认（记 raw）。只有默认值里写了这个键的适配器才读它（legeclo 默认 ['voice']）
//   transitions      { named: <正则>, seconds: 0.5 }
//   blackRes         [正则]：scene 名字命中 = 黑底
//   sniff            { labelRe, markerRes: [正则] }
//   composite        { enabled: true }：多行 `image <名字（可含空格）> = Composite(` … `(0,0), "a.png",` … `)` 定义按图片别名读（只认默认值里写了这个键的适配器：monmusu / legeclo）；图层取带图片扩展名的字符串，第一层 = 背景（bg.src），有第二层以上时最后一层 = bg.over
import { compileSafeRegex } from '../voice.mjs'
import { createIndexResolver } from '../resolve.mjs'

// ---------- 小工具 ----------
export const clean = (rel) => String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
export const aliasKey = (name) => String(name).trim().replace(/\s+/g, ' ').toLowerCase()
export const num = (text, fallback = 0) => { const n = Number.parseFloat(text); return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : fallback }
export const segmentsOf = (text) => (text ? [{ text }] : [])
export const KEYWORDS = new Set(['play', 'queue', 'scene', 'show', 'hide', 'with', 'stop', 'label', 'jump', 'call', 'window', 'pause', 'return', 'voice', 'translate', 'image', 'define', 'init', 'python', 'if', 'elif', 'else', 'while', 'menu'])
export const IGNORED_WORDS = new Set(['label', 'jump', 'return', 'window', 'call', 'translate'])

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

// ---------- 选项编译 ----------
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)
const strings = (v, fallback) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : fallback)
const safe = (source, flags = '') => { try { return compileSafeRegex(source, { flags, label: 'adapterOptions' }) } catch { return null } }
const regexes = (v, fallback, flags = '') => (Array.isArray(v) ? v.map((s) => safe(s, flags)).filter(Boolean) : fallback.map((s) => safe(s, flags)).filter(Boolean))
const table = (v, fallback, valueOk = (x) => typeof x === 'string') => new Map(Object.entries(isObject(v) ? v : fallback).filter(([k, x]) => k && valueOk(x)))
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback)
const channelMatcher = (names) => {
  const exact = new Set(names.filter((n) => !n.endsWith('*')))
  const prefixes = names.filter((n) => n.endsWith('*')).map((n) => n.slice(0, -1))
  return (channel) => exact.has(channel) || prefixes.some((p) => channel.startsWith(p))
}

const COMPILERS = {
  align: (v, d) => table(v, d, (x) => typeof x === 'string' && /^[\w-]{1,20}$/.test(x)),
  speakers: (v, d) => table(v, d),
  speakerVars: (v, d) => regexes(v, d),
  nameVar: (v, d) => (typeof v === 'string' && /^\w*$/.test(v) ? v : d),
  flow: (v, d) => ({ menu: oneOf(v?.menu, ['raw', 'linear'], d.menu), conditionals: oneOf(v?.conditionals, ['linear', 'ignore'], d.conditionals) }),
  aliasPatterns: (v, d) => {
    const source = Array.isArray(v) ? v : d
    const out = []
    for (const entry of source) {
      if (!isObject(entry) || !['movie', 'image'].includes(entry.kind)) continue
      const scope = entry.scope === 'text' ? 'text' : 'line'
      const re = safe(entry.re, scope === 'text' ? 'gm' : '')
      if (re) out.push({ kind: entry.kind, scope, re })
    }
    return out
  },
  movieNoLoopRe: (v, d) => safe(typeof v === 'string' ? v : d),
  imageIndex: (v, d) => {
    const given = isObject(v) ? v : {}
    const extList = strings(given.ext, d.ext).map((e) => e.replace(/^\./, '').toLowerCase())
    return { preferDirs: strings(given.preferDirs, d.preferDirs).map(clean).map((p) => p.replace(/\/+$/, '')), ext: new Set(extList), extList, extPriority: given.extPriority === undefined ? d.extPriority : given.extPriority === true }
  },
  audioCommands: (v, d) => {
    const given = isObject(v) ? v : {}
    const pick = (key) => channelMatcher(strings(given[key], d[key]))
    return { music: pick('music'), voice: pick('voice'), se: pick('se'), other: oneOf(given.other, ['raw', 'se', 'ignore'], d.other) }
  },
  bareVoice: (v, d) => new Set(strings(v, d).filter((w) => /^[A-Za-z_]\w*$/.test(w))),
  voiceNoQuote: (v, d) => ({ variables: table(isObject(v) ? v.variables : undefined, d.variables) }),
  transitions: (v, d) => ({ named: safe(typeof v?.named === 'string' ? v.named : d.named, 'i'), seconds: Number.isFinite(Number(v?.seconds)) ? num(v.seconds) : d.seconds }),
  blackRes: (v, d) => regexes(v, d),
  sniff: (v, d) => ({ labelRe: safe(typeof v?.labelRe === 'string' ? v.labelRe : d.labelRe, 'm'), markerRes: regexes(v?.markerRes, d.markerRes, 'm') }),
  composite: (v, d) => ({ enabled: typeof v?.enabled === 'boolean' ? v.enabled : d.enabled === true }),
  standTags: (v, d) => new Set(strings(v, d)),
  fadeTags: (v, d) => new Set(strings(v, d)),
  cropForms: (v, d) => regexes(v, d),
  flash: (v, d) => ({ counts: table(isObject(v) ? v.counts : undefined, d.counts, Number.isFinite), seconds: Number.isFinite(Number(v?.seconds)) ? Math.max(0, Math.min(10, Number(v.seconds))) : d.seconds, color: typeof v?.color === 'string' && v.color ? v.color : d.color }),
}

// defaults（JSON 形状）→ (options) => 编译结果；同一个 options 对象只编译一次
export function optionsCompiler(defaults) {
  const cache = new WeakMap()
  const compile = (options) => {
    const given = isObject(options) ? options : {}
    const out = {}
    for (const key of Object.keys(defaults)) if (COMPILERS[key]) out[key] = COMPILERS[key](given[key], defaults[key])
    return out
  }
  const base = compile({})
  return (options) => {
    if (!isObject(options) || !Object.keys(options).length) return base
    if (!cache.has(options)) cache.set(options, compile(options))
    return cache.get(options)
  }
}

export function makeSniff(compiled) {
  return (text, options) => {
    const o = compiled(options).sniff
    const head = String(text || '').slice(0, 8192)
    return Boolean(o.labelRe && o.labelRe.test(head) && o.markerRes.some((re) => re.test(head)))
  }
}

// ---------- 语句 ----------
const quoted = (n, q) => `([${q}])((?:(?!\\${n})[^\\\\]|\\\\.)*)\\${n}`
const dialogueCache = new Map()
// 组：1 角色变量（可无）、3 第一个字符串、5 第二个字符串
export const dialogueRe = (q) => dialogueCache.get(q) || dialogueCache.set(q, new RegExp(`^(?:([A-Za-z_]\\w*)\\s+)?${quoted(2, q)}(?:\\s+${quoted(4, q)})?(?:\\s+with\\s+\\S.*)?$`)).get(q)
const isSpeakerVar = (o, name) => !KEYWORDS.has(name) && (o.speakers.has(name) || o.speakerVars.some((re) => re.test(name)))

// 台词行 → { name, body } | null。`"名字" "台词"` / `"台词"` / `<变量> "台词"`（变量要在 speakers 表里或匹配 speakerVars）
// fallback：没写名字时的说话人（minashigo 用 `$ name=` 设的；null = 没有这个机制，单字符串台词是旁白、变量写法用 speakers 表 / 变量名本身）
export function readDialogue(line, o, q, fallback = null) {
  const m = dialogueRe(q).exec(line)
  if (!m) return null
  const v = m[1]
  if (v) {
    if (!isSpeakerVar(o, v)) return null
    return { name: o.speakers.has(v) ? o.speakers.get(v) : (fallback === null ? v : fallback), body: renpyText(m[3]) }
  }
  if (m[5] !== undefined) return { name: renpyText(m[3]), body: renpyText(m[5]) }
  return { name: fallback ?? '', body: renpyText(m[3]) }
}

export const interpolate = (o, text) => (o.voiceNoQuote.variables.size ? String(text).replace(/\[(\w+)\]/g, (all, name) => (o.voiceNoQuote.variables.has(name) ? o.voiceNoQuote.variables.get(name) : all)) : String(text))

// 路径操作数：`"路径"`（[变量] 按表替换）/ `[变量]` / 裸变量名（只认 voiceNoQuote.variables 里有的）→ 路径 | ''
const operandRe = (q) => new RegExp(`^(?:\\[([^\\]]*)\\]|${quoted(2, q)}|([A-Za-z_]\\w*)\\b)`)
export function readOperand(rest, o, q) {
  const m = operandRe(q).exec(String(rest).trim())
  if (!m) return ''
  if (m[3] !== undefined) return clean(interpolate(o, m[3]))
  const name = m[1] ?? m[4]
  return o.voiceNoQuote.variables.has(name) ? clean(o.voiceNoQuote.variables.get(name)) : ''
}

// play / queue <声道> <操作数> → { kind: 'bgm'|'voice'|'se', src } | { kind: '', src: '' }（没认出来 → 调用方记 raw）| { kind: 'bgm'…, src: '' }（路径空：忽略）
const PLAY = /^(?:play|queue)\s+(\w+)\s+(.*)$/
export function readPlay(line, o, q) {
  const m = PLAY.exec(line)
  if (!m) return null
  const a = o.audioCommands
  const kind = a.music(m[1]) ? 'bgm' : a.voice(m[1]) ? 'voice' : a.se(m[1]) ? 'se' : a.other === 'se' ? 'se' : ''
  if (!kind) return a.other === 'ignore' && m[1] ? { kind: 'ignore', src: '' } : null
  const operand = /^\[|^["']|^[A-Za-z_]/.test(m[2].trim()) ? readOperand(m[2], o, q) : ''
  const literal = new RegExp(`^[${q}]`).test(m[2].trim())
  if (!operand && !literal) return null   // 认不出的写法（[表达式] / 没配的变量）：raw
  return { kind, src: operand }
}
// 裸语音语句：`voice "路径" [sustain / 其它参数]` → 路径（只取第一个引号串；[变量] / 裸变量名只认 voiceNoQuote.variables 里有的，同 play）；认不出 → ''（调用方记 raw）
export const readBareVoice = (rest, o, q) => readOperand(rest, o, q)
export const isMusicChannel = (o, channel) => o.audioCommands.music(channel)

// 转场 → 渐变秒数：Dissolve(0.5) / Fade(0.5, 0, 0.5) 取第一个数；命名转场（transitions.named）按 transitions.seconds；None 或认不出 = 0
export function transitionSeconds(expr, o) {
  const text = String(expr ?? '').trim()
  if (!text || /^none$/i.test(text)) return 0
  const m = /\(\s*([\d.]+)/.exec(text)
  if (m) return num(m[1])
  return o.transitions.named?.test(text) ? o.transitions.seconds : 0
}
// `xxx with Dissolve(0.5)` → { rest: 'xxx', fade }
export function splitWith(rest, o) {
  const text = String(rest).trim()
  const at = text.search(/\s+with\s+/)
  if (at < 0) return { rest: text, fade: 0 }
  return { rest: text.slice(0, at).trim(), fade: transitionSeconds(text.slice(at).replace(/^\s+with\s+/, ''), o) }
}
export const isBlackName = (o, key) => o.blackRes.some((re) => re.test(key))

// 流程语句：menu / if / elif / else。返回 (rawLine, line, count) => 这行是不是被流程规则吃掉了
//   默认（menu: raw，conditionals: linear）一行都不吃——和以前一样，menu / if 行记 raw，各分支的正文照线性读
//   menu: linear → menu: 和 "选项文字": 行静默跳过；conditionals: ignore → if / elif / else 块的正文整块跳过（头行记 raw）
export function flowFilter(flow) {
  let skipIndent = null
  const indentOf = (raw) => raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length
  return (rawLine, line, count) => {
    if (flow.conditionals === 'ignore') {
      const indent = indentOf(rawLine)
      if (skipIndent !== null) { if (indent > skipIndent) return true; skipIndent = null }
      const head = /^(if|elif|else)\b.*:$/.exec(line)
      if (head) { count('raw', head[1]); skipIndent = indent; return true }
    }
    if (flow.menu === 'linear' && (/^menu\b.*:$/.test(line) || /^(["']).*\1\s*(?:if\s.+)?:$/.test(line))) return true
    return false
  }
}

// ---------- 上下文：视频别名表 + 图片名索引 ----------
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif']
export const DEFAULT_ALIAS = {
  aliasPatterns: [
    { kind: 'movie', re: '^image\\s+(?<name>.+?)\\s*=\\s*Movie\\s*\\([^)]*\\bplay\\s*=\\s*"(?<path>[^"]+)"[^)]*\\)' },
    { kind: 'movie', re: "^image\\s+(?<name>.+?)\\s*=\\s*Movie\\s*\\([^)]*\\bplay\\s*=\\s*'(?<path>[^']+)'[^)]*\\)" },
    { kind: 'image', re: '^image\\s+(?<name>.+?)\\s*=\\s*"(?<path>[^"]+)"\\s*$' },
    { kind: 'image', re: "^image\\s+(?<name>.+?)\\s*=\\s*'(?<path>[^']+)'\\s*$" },
  ],
  movieNoLoopRe: '\\bloop\\s*=\\s*False\\b',
  imageIndex: { preferDirs: [], ext: IMAGE_EXTS, extPriority: false },
}

const extOf = (name) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

// 多行 Composite 定义：`image <名字> = Composite(` 之后配对括号读到结束（跳过字符串里的括号），取里面带图片扩展名的字符串 = 图层（按出现顺序）。
// 名字可以带空格（`ms0101b6 01`）。单个定义最多读 4000 个字符、一个文件最多 2000 个，防坏脚本
const COMPOSITE_HEAD = /^[ \t]*image[ \t]+(.+?)[ \t]*=[ \t]*Composite[ \t]*\(/gm
export function readComposites(body, extOk) {
  const out = []
  COMPOSITE_HEAD.lastIndex = 0
  let head
  while ((head = COMPOSITE_HEAD.exec(body)) && out.length < 2000) {
    let depth = 1
    let quote = ''
    let i = COMPOSITE_HEAD.lastIndex
    const start = i
    for (; i < body.length && i - start < 4000 && depth > 0; i++) {
      const c = body[i]
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = '' } else if (c === '"' || c === "'") quote = c
      else if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === '#') { while (i < body.length && body[i] !== '\n') i++ }
    }
    if (depth !== 0) continue
    const inner = body.slice(start, i - 1)
    const layers = []
    for (const m of inner.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) {
      const src = clean(m[1] ?? m[2])
      if (src && extOk(extOf(src))) layers.push(src)
    }
    if (layers.length) out.push({ name: head[1], layers })
    COMPOSITE_HEAD.lastIndex = i
  }
  return out
}
// 图层 → bg 指令的 src / over（一层只有 src；多层 = 第一层打底、最后一层叠在上面）
export const compositeBg = (layers) => (layers.length > 1 ? { src: layers[0], over: layers.at(-1) } : { src: layers[0] })

// 参数：prepare 的入参（options 已经编译成 o）。resourceResolve = config.resourceResolve（没有 = 不开额外规则）
export function buildRenpyContext({ texts, files, toResourcePath, resourceResolve }, o) {
  const movies = new Map()   // 别名 → { src, loop }
  const images = new Map()   // 别名 → 资源路径
  const composites = new Map()   // 别名 → 图层资源路径[]（Composite 定义，o.composite.enabled 时才有）
  const { ext, extList, extPriority, preferDirs } = o.imageIndex
  const toRes = (rel) => (toResourcePath ? toResourcePath(rel) : rel)
  const sorted = [...(files || [])].sort()
  const fileKeys = sorted.map(toRes)
  const resolver = createIndexResolver({ index: fileKeys, cfg: resourceResolve, preferDirs: preferDirs.length ? preferDirs : null })
  const record = (kind, groups, whole) => {
    const name = groups?.name
    const raw = groups?.path
    if (!name || !raw) return
    const src = clean(raw)
    if (kind === 'movie') movies.set(aliasKey(name), { src, loop: !o.movieNoLoopRe?.test(whole) })
    else if (ext.has(extOf(src))) images.set(aliasKey(name), resolver.resolve(src) || src)   // 索引里有（含大小写 / 扩展名规则）取真实路径，没有保持脚本里写的
  }
  for (const text of Object.values(texts || {})) {
    const body = String(text)
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, '').trim()
      if (!line) continue
      for (const p of o.aliasPatterns) {
        if (p.scope !== 'line') continue
        const m = p.re.exec(line)
        if (m) { record(p.kind, m.groups, m[0]); break }
      }
    }
    if (o.composite?.enabled) {
      for (const { name, layers } of readComposites(body, (e) => ext.has(e))) {
        const key = aliasKey(name)
        if (images.has(key)) continue   // 前面已经有 `image X = "…"` 的明确定义：不覆盖
        const real = layers.map((layer) => resolver.resolve(layer) || layer)
        composites.set(key, real)
        images.set(key, real[0])
      }
    }
    for (const p of o.aliasPatterns) {
      if (p.scope !== 'text') continue
      p.re.lastIndex = 0
      for (const m of body.matchAll(p.re)) record(p.kind, m.groups, m[0])
    }
  }
  // 图片目录：Ren'Py 把 images/ 下的文件按「无扩展名的文件名」自动命名。同名取：preferDirs 顺序 → （extPriority 时）ext 顺序 → 路径顺序
  const rankDir = (p) => { const i = preferDirs.findIndex((d) => p === d || p.startsWith(`${d}/`)); return i < 0 ? preferDirs.length : i }
  const rankExt = (p) => (extPriority ? extList.indexOf(extOf(p)) : 0)
  const best = new Map()
  sorted.forEach((rel, i) => {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const dot = name.lastIndexOf('.')
    if (dot <= 0 || !ext.has(extOf(name))) return
    const key = aliasKey(name.slice(0, dot))
    const path = fileKeys[i]
    const score = [rankDir(path), rankExt(path)]
    const cur = best.get(key)
    if (!cur || score[0] < cur.score[0] || (score[0] === cur.score[0] && score[1] < cur.score[1])) best.set(key, { path, score })
  })
  for (const [key, { path }] of best) if (!images.has(key)) images.set(key, path)
  return { movies, images, composites }
}
