// 适配器：UViewer 系剧情脚本（逗号分隔，一行一条指令）→ 我们的规范场景 JSON（gal-scene/1）。
// 适配器只做「原始文本 → 规范场景」，不碰文件系统、不落地；规范场景长什么样见 ../scene.mjs。
// 新增别的原始格式 = 新写一个适配器（id / label / sniff / parse），前端播放器不用改。
//
// 指令语义（来源：UViewer 前端对 bg/name/msg/playvoice/playbgm/stopbgm/fadein|outblack/movie 的用法 + 示例脚本的上下文）：
//   bg,<图片路径|color_R_G_B>,<渐变秒>        背景
//   bgoff,<渐变秒>                            去掉背景
//   name,<说话人>                             说话人（空 = 清掉）
//   msg,<?>,<台词>                            台词（空 = 清掉）；\n 是换行；带 <outline ...> 之类的标记
//   playvoice,<?>,<路径> / playse,<路径>      语音 / 音效
//   playbgm,<路径> / stopbgm,<渐变秒>         BGM（循环）
//   fadeinblack,<秒> / fadeoutblack,<秒>      渐入黑场（画面变黑）/ 从黑场渐出（画面出现）
//   wait,<秒>                                 等待
//   movie,<路径1:路径2:…>,<?>,<是否循环>        视频，多段连播
//   select,<选项1>,<选项2>,…                   弹选项（选项文字常带「選項1　」前缀，会去掉）；选的序号（1 起）记进变量 select
//   if,<变量>_<运算符>_<值> / elseif,… / else / endif   条件块（如 if,select_===_1）；块里每条指令带上 when 条件，播放时按变量判断；不配对的 endif 忽略
//   clickwait                                 等点击——一步（step）的结尾
//   endwait                                   等动画结束——规范场景里按顺序执行，不单独保留
// 其余指令（spriteatlas / sprite / anm / mask / imgconf / spine …）原样以 raw 指令保留，等对应渲染方式实现后再用。
//
// 选项 config.adapterOptions['uviewer-csv']（适配器只读配置、按配置匹配；DEFAULT_OPTIONS = 今天的行为）：
//   commands { aliases: {}, known: [KNOWN], rawHints: [RAW_HINTS] }   aliases：{ 别名: 规范指令名 }（别名按规范指令处理，嗅探也算认得）；known / rawHints：嗅探时「认得的指令名」（整体替换默认表，不影响 parse 的 switch）
//   msg { textArgIndex: 1, singleArgText: false }          台词 = 第 textArgIndex 个逗号之后的整段；逗号不够时：singleArgText = true 取 msg, 之后的整段，false 当空
//   playvoice { pathArgIndex: 1 }                           语音路径所在参数（参数不够时取第一个）
//   bg { colorPrefix: 'color_' }                            bg 参数以它开头 = 纯色（color_R_G_B）；'' = 没有纯色写法
//   select { var: 'select', prefixRe: '^(?:選項|选项|選擇|选择|Option)\\s*\\d+[\\s\\u3000:：.、-]*' }   弹选项：选的序号记进 var；选项文字开头匹配 prefixRe 的部分去掉（'' = 不去）
//   conditions { vars: {} }                                 { 变量名: 初始值 }：除 select 以外「一直不变」的变量，if 条件在解析时就判定（成立 = 去掉条件，不成立 = 这个块里的指令不输出）；没配的变量 = 以前的行为（没设过 → 条件不成立，块不可见）
//   sniff { minKnownRatio: 0.6, minLines: 3, maxLines: 40 }   sniff(text, options)：看前 maxLines 条指令，至少 minLines 条且认得的比例 ≥ minKnownRatio

import { condMet } from '../../../static/gal-engine.js'
import { compileSafeRegex } from '../voice.mjs'

export const ADAPTER_ID = 'uviewer-csv'

const KNOWN = [
  'bg', 'bgoff', 'name', 'msg', 'playvoice', 'playse', 'playbgm', 'stopbgm', 'fadeinblack', 'fadeoutblack',
  'wait', 'movie', 'movieoff', 'clickwait', 'endwait', 'select', 'if', 'elseif', 'else', 'endif',
]
const RAW_HINTS = ['spriteatlas', 'sprite', 'spriteoff', 'flash', 'endwmsg', 'anm', 'mask', 'imgconf', 'spine', 'spineoff']
const OPTION_PREFIX_SOURCE = '^(?:選項|选项|選擇|选择|Option)\\s*\\d+[\\s\\u3000:：.、-]*'

export const DEFAULT_OPTIONS = {
  commands: { aliases: {}, known: KNOWN, rawHints: RAW_HINTS },
  msg: { textArgIndex: 1, singleArgText: false },
  playvoice: { pathArgIndex: 1 },
  bg: { colorPrefix: 'color_' },
  select: { var: 'select', prefixRe: OPTION_PREFIX_SOURCE },
  conditions: { vars: {} },
  sniff: { minKnownRatio: 0.6, minLines: 3, maxLines: 40 },
}

// options → 编译结果（同一个 options 对象只编译一次；非法项回到默认值，不抛）
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)
const index = (v, d, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d)
const names = (v, d) => new Set((Array.isArray(v) ? v : d).filter((x) => typeof x === 'string' && x).map((x) => x.toLowerCase()))
function compileOptions(options) {
  const given = isObject(options) ? options : {}
  const d = DEFAULT_OPTIONS
  const sub = (key) => (isObject(given[key]) ? given[key] : {})
  const aliases = new Map()
  for (const [from, to] of Object.entries(isObject(sub('commands').aliases) ? sub('commands').aliases : d.commands.aliases)) if (from && typeof to === 'string' && to) aliases.set(from.toLowerCase(), to.toLowerCase())
  let prefixRe = null
  const prefixSource = typeof sub('select').prefixRe === 'string' ? sub('select').prefixRe : d.select.prefixRe
  try { prefixRe = compileSafeRegex(prefixSource, { flags: 'i', label: 'select.prefixRe' }) } catch { prefixRe = compileSafeRegex(d.select.prefixRe, { flags: 'i' }) }
  const seeds = {}
  for (const [name, value] of Object.entries(isObject(sub('conditions').vars) ? sub('conditions').vars : d.conditions.vars)) if (/^[A-Za-z_]\w*$/.test(name) && ['string', 'number', 'boolean'].includes(typeof value)) seeds[name] = String(value)
  const ratio = Number(sub('sniff').minKnownRatio)
  return {
    aliases,
    known: names(sub('commands').known, d.commands.known),
    rawHints: names(sub('commands').rawHints, d.commands.rawHints),
    textArgIndex: index(sub('msg').textArgIndex, d.msg.textArgIndex, 0, 8),
    singleArgText: sub('msg').singleArgText === true,
    pathArgIndex: index(sub('playvoice').pathArgIndex, d.playvoice.pathArgIndex, 0, 8),
    colorPrefix: typeof sub('bg').colorPrefix === 'string' ? sub('bg').colorPrefix.toLowerCase() : d.bg.colorPrefix,
    selectVar: typeof sub('select').var === 'string' && /^[A-Za-z_]\w*$/.test(sub('select').var) ? sub('select').var : d.select.var,
    prefixRe: prefixSource === '' ? null : prefixRe,
    seeds,
    minKnownRatio: ratio >= 0 && ratio <= 1 && sub('sniff').minKnownRatio !== undefined ? ratio : d.sniff.minKnownRatio,
    minLines: index(sub('sniff').minLines, d.sniff.minLines, 1, 1000),
    maxLines: index(sub('sniff').maxLines, d.sniff.maxLines, 1, 10000),
  }
}
const optionsCache = new WeakMap()
const baseOptions = compileOptions({})
const opts = (options) => {
  if (!isObject(options) || !Object.keys(options).length) return baseOptions
  if (!optionsCache.has(options)) optionsCache.set(options, compileOptions(options))
  return optionsCache.get(options)
}
const canonical = (o, cmd) => o.aliases.get(cmd) || cmd

// 第一条有意义的指令必须是已知指令名；用来在导入时判断一个 txt/csv 是不是这种脚本
export function sniff(text, options = null) {
  const o = opts(options)
  let checked = 0
  let known = 0
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('//')) continue
    const cmd = canonical(o, line.split(',', 1)[0].trim().toLowerCase())
    if (!/^[a-z][a-z0-9_]*$/.test(cmd)) return false
    checked += 1
    if (o.known.has(cmd) || o.rawHints.has(cmd)) known += 1
    if (checked >= o.maxLines) break
  }
  return checked >= o.minLines && known / checked >= o.minKnownRatio
}

const seconds = (value, fallback = 0) => {
  const n = Number.parseFloat(String(value ?? '').trim())
  return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : fallback
}

export function normalizeAssetPath(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

const COLOR_RE = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i
const safeColor = (value) => {
  const v = String(value ?? '').trim().replace(/^["']|["']$/g, '')
  return COLOR_RE.test(v) ? v : ''
}

// 台词标记 → 样式片段。不生成 HTML：前端只用 textContent + 内联样式渲染，不存在注入面。
// 认得的标记：<outline width=2 color=black> <color=red>/<color value=red> <size=27> <b> <i> <br> <ruby>漢|かん</ruby>；其余标记丢掉，文字保留。
export function parseRichText(raw) {
  const text = String(raw ?? '').replace(/\\n/g, '\n')
  const out = []
  const stack = []
  const push = (chunk) => {
    if (!chunk) return
    const style = {}
    for (const entry of stack) Object.assign(style, entry.style)
    const last = out[out.length - 1]
    if (last && !last.ruby && JSON.stringify(last.style || {}) === JSON.stringify(style)) last.text += chunk
    else out.push(Object.keys(style).length ? { text: chunk, style } : { text: chunk })
  }
  const tagRe = /<(\/?)([a-zA-Z]+)([^>]*)>/g
  let last = 0
  let match
  while ((match = tagRe.exec(text))) {
    push(text.slice(last, match.index))
    last = tagRe.lastIndex
    const [, closing, nameRaw, attrText] = match
    const name = nameRaw.toLowerCase()
    if (name === 'br') { push('\n'); continue }
    if (name === 'ruby' && !closing) {
      // <ruby>基字|注音</ruby>：整段取走，不走样式栈
      const close = text.toLowerCase().indexOf('</ruby>', tagRe.lastIndex)
      if (close >= 0) {
        const [baseText, reading = ''] = text.slice(tagRe.lastIndex, close).split('|')
        const style = {}
        for (const entry of stack) Object.assign(style, entry.style)
        if (baseText) out.push({ text: baseText, ...(reading ? { ruby: reading } : {}), ...(Object.keys(style).length ? { style } : {}) })
        last = tagRe.lastIndex = close + '</ruby>'.length
        continue
      }
    }
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) { stack.splice(i, 1); break }
      continue
    }
    const attrs = {}
    // <color=red> 这种「标签名=值」也算 value
    const eq = attrText.match(/^\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/)
    if (eq) attrs.value = eq[1].replace(/^["']|["']$/g, '')
    for (const m of attrText.matchAll(/([a-zA-Z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) attrs[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '')
    if (name === 'outline') {
      const width = Math.max(0, Math.min(8, Number.parseFloat(attrs.width ?? attrs.value ?? '1') || 1))
      stack.push({ name, style: { outline: { width, color: safeColor(attrs.color) || 'black' } } })
    } else if (name === 'color') {
      const color = safeColor(attrs.value ?? attrs.color)
      if (color) stack.push({ name, style: { color } })
    } else if (name === 'size') {
      const size = Math.round(Number.parseFloat(attrs.value ?? attrs.size ?? ''))
      if (Number.isFinite(size) && size > 0) stack.push({ name, style: { size: Math.max(8, Math.min(96, size)) } })
    } else if (name === 'b') stack.push({ name, style: { bold: true } })
    else if (name === 'i') stack.push({ name, style: { italic: true } })
    // 其它标记：忽略标记本身
  }
  push(text.slice(last))
  return out
}

// 一行 = 命令名 + 逗号分隔的参数；msg/name 的文字可能含半角逗号，整段取、只剥掉末尾那串空参数
function splitLine(line) {
  const first = line.indexOf(',')
  const cmd = (first < 0 ? line : line.slice(0, first)).trim().toLowerCase()
  const rest = first < 0 ? '' : line.slice(first + 1)
  return { cmd, rest }
}
const stripTrailingCommas = (value) => value.replace(/,+\s*$/, '')

// 条件：<变量>_<运算符>_<值>，例如 select_===_1。认不出来就当没有条件（宁可多显示也不吞内容）
const COND_RE = /^\s*([A-Za-z_][\w]*?)_(===|!==|==|!=|>=|<=|>|<)_(.+?)\s*$/
export function parseCondition(text) {
  const m = COND_RE.exec(String(text ?? ''))
  return m ? { var: m[1], op: m[2], value: m[3] } : null
}
const negate = (cond) => ({ ...cond, not: true })

export function parse(text, _ctx = null, meta = null) {
  const o = opts(meta?.options)
  const steps = []
  let current = []
  const stats = { commands: 0, raw: {}, choices: 0, unmatchedEndif: 0 }
  const ifStack = []   // { branches: [cond|null], cur: [cond] }
  const whenNow = () => ifStack.flatMap((frame) => frame.cur)
  const emit = (command) => {
    // conditions.vars 里的变量一直不变：条件在这里直接判定（不成立 = 这条指令不输出，成立 = 去掉条件）
    const when = []
    for (const cond of whenNow()) {
      if (Object.hasOwn(o.seeds, cond.var) && cond.var !== o.selectVar) { if (!condMet([cond], o.seeds)) return; continue }
      when.push(cond)
    }
    if (when.length) command.when = when
    current.push(command)
  }
  const flush = () => {
    if (current.length) steps.push({ index: steps.length, commands: current })
    current = []
  }
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '')
    if (!line.trim() || line.startsWith('//')) continue
    const split = splitLine(line)
    const cmd = canonical(o, split.cmd)
    const rest = split.rest
    if (!cmd) continue
    const args = rest.split(',').map((arg) => arg.trim())
    while (args.length && args[args.length - 1] === '') args.pop()
    stats.commands += 1
    switch (cmd) {
      case 'clickwait':
        flush()
        break
      case 'endwait':
        break
      case 'bg': {
        const src = args[0] || ''
        const fade = seconds(args[1])
        if (!src) emit({ op: 'bgoff', fade })
        else if (o.colorPrefix && src.toLowerCase().startsWith(o.colorPrefix)) {
          const [r, g, b] = src.slice(o.colorPrefix.length).split('_').map((n) => Math.max(0, Math.min(255, Number.parseInt(n, 10) || 0)))
          emit({ op: 'bg', color: [r || 0, g || 0, b || 0], fade })
        } else emit({ op: 'bg', src: normalizeAssetPath(src), fade })
        break
      }
      case 'bgoff':
        emit({ op: 'bgoff', fade: seconds(args[0]) })
        break
      case 'name':
        emit({ op: 'speaker', segments: parseRichText(stripTrailingCommas(rest)) })
        break
      case 'msg': {
        let from = 0
        let found = 0
        while (found < o.textArgIndex) { const at = rest.indexOf(',', from); if (at < 0) break; from = at + 1; found += 1 }
        const body = found < o.textArgIndex ? (o.singleArgText ? stripTrailingCommas(rest) : '') : stripTrailingCommas(rest.slice(from))
        emit({ op: 'text', segments: parseRichText(body) })
        break
      }
      case 'playvoice': {
        const src = normalizeAssetPath(args.length > o.pathArgIndex ? args[o.pathArgIndex] : args[0])
        if (src) emit({ op: 'voice', src })
        break
      }
      case 'playse': {
        const src = normalizeAssetPath(args[0])
        if (src) emit({ op: 'se', src })
        break
      }
      case 'playbgm': {
        const src = normalizeAssetPath(args[0])
        if (src) emit({ op: 'bgm', src })
        break
      }
      case 'stopbgm':
        emit({ op: 'bgmStop', fade: seconds(args[0]) })
        break
      case 'fadeinblack':
        emit({ op: 'fade', to: 'black', seconds: seconds(args[0], 1) })
        break
      case 'fadeoutblack':
        emit({ op: 'fade', to: 'clear', seconds: seconds(args[0], 1) })
        break
      case 'wait':
        emit({ op: 'wait', seconds: seconds(args[0]) })
        break
      case 'movie': {
        const srcs = String(args[0] || '').split(':').map(normalizeAssetPath).filter(Boolean)
        if (srcs.length) emit({ op: 'movie', srcs, loop: args[2] === '1' })
        break
      }
      case 'movieoff':
        emit({ op: 'movieOff' })
        break
      case 'select': {
        const options = args.map((arg, i) => ({ value: i + 1, segments: parseRichText(o.prefixRe ? arg.replace(o.prefixRe, '') : arg) })).filter((o) => o.segments.length)
        if (options.length) {
          // id = 步序号:步内指令序号，同一份脚本每次解析都一样，用来记「这个选项选了哪个」
          emit({ op: 'choice', id: `${steps.length}:${current.length}`, var: o.selectVar, options })
          stats.choices += 1
        }
        break
      }
      case 'if': {
        const cond = parseCondition(args[0])
        ifStack.push({ branches: [cond], cur: cond ? [cond] : [] })
        break
      }
      case 'elseif': {
        const frame = ifStack[ifStack.length - 1]
        if (!frame) break
        const cond = parseCondition(args[0])
        const before = frame.branches.filter(Boolean).map(negate)
        frame.branches.push(cond)
        frame.cur = cond ? [...before, cond] : before
        break
      }
      case 'else': {
        const frame = ifStack[ifStack.length - 1]
        if (frame) frame.cur = frame.branches.filter(Boolean).map(negate)
        break
      }
      case 'endif':
        if (ifStack.length) ifStack.pop()
        else stats.unmatchedEndif += 1
        break
      case 'flash': {   // flash,r,g,b,次数,每次秒数,强度：闪屏（强度暂不用）
        const c = [args[0], args[1], args[2]].map((v) => Math.max(0, Math.min(255, Math.round(Number.parseFloat(v) || 0))))
        emit({ op: 'flash', color: `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`, count: Math.max(1, Math.min(10, Math.round(Number.parseFloat(args[3]) || 1))), seconds: seconds(args[4], 0.3) })
        break
      }
      case 'endwmsg':   // 结束文字窗：没有画面效果
        break
      case 'spriteoff': // 去掉立绘：立绘（spriteatlas / sprite）还没渲染时没有可去的东西；别的立绘实现后再接
        break
      default:
        stats.raw[cmd] = (stats.raw[cmd] || 0) + 1
        emit({ op: 'raw', cmd, args })
    }
  }
  flush()
  return { steps, stats }
}

export const uviewerCsvAdapter = { id: ADAPTER_ID, label: 'UViewer 剧情脚本（CSV）', sniff, parse }
