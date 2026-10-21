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
//   clickwait                                 等点击——一步（step）的结尾
//   endwait                                   等动画结束——规范场景里按顺序执行，不单独保留
// 其余指令（spriteatlas / sprite / anm / mask / imgconf / spine …）原样以 raw 指令保留，等对应渲染方式实现后再用。

export const ADAPTER_ID = 'uviewer-csv'

const KNOWN = new Set([
  'bg', 'bgoff', 'name', 'msg', 'playvoice', 'playse', 'playbgm', 'stopbgm', 'fadeinblack', 'fadeoutblack',
  'wait', 'movie', 'movieoff', 'clickwait', 'endwait',
])

// 第一条有意义的指令必须是已知指令名；用来在导入时判断一个 txt/csv 是不是这种脚本
export function sniff(text) {
  let checked = 0
  let known = 0
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('//')) continue
    const cmd = line.split(',', 1)[0].trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]*$/.test(cmd)) return false
    checked += 1
    if (KNOWN.has(cmd) || RAW_HINTS.has(cmd)) known += 1
    if (checked >= 40) break
  }
  return checked >= 3 && known / checked >= 0.6
}
const RAW_HINTS = new Set(['spriteatlas', 'sprite', 'spriteoff', 'anm', 'mask', 'imgconf', 'spine', 'spineoff'])

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
// 认得的标记：<outline width=2 color=black> <color=red>/<color value=red> <b> <i> <br>；其余标记丢掉，文字保留。
export function parseRichText(raw) {
  const text = String(raw ?? '').replace(/\\n/g, '\n')
  const out = []
  const stack = []
  const push = (chunk) => {
    if (!chunk) return
    const style = {}
    for (const entry of stack) Object.assign(style, entry.style)
    const last = out[out.length - 1]
    if (last && JSON.stringify(last.style || {}) === JSON.stringify(style)) last.text += chunk
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

export function parse(text) {
  const steps = []
  let current = []
  const stats = { commands: 0, raw: {} }
  const flush = () => {
    if (current.length) steps.push({ index: steps.length, commands: current })
    current = []
  }
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '')
    if (!line.trim() || line.startsWith('//')) continue
    const { cmd, rest } = splitLine(line)
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
        if (!src) current.push({ op: 'bgoff', fade })
        else if (/^color_/i.test(src)) {
          const [r, g, b] = src.split('_').slice(1).map((n) => Math.max(0, Math.min(255, Number.parseInt(n, 10) || 0)))
          current.push({ op: 'bg', color: [r || 0, g || 0, b || 0], fade })
        } else current.push({ op: 'bg', src: normalizeAssetPath(src), fade })
        break
      }
      case 'bgoff':
        current.push({ op: 'bgoff', fade: seconds(args[0]) })
        break
      case 'name':
        current.push({ op: 'speaker', segments: parseRichText(stripTrailingCommas(rest)) })
        break
      case 'msg': {
        const comma = rest.indexOf(',')
        const body = comma < 0 ? '' : stripTrailingCommas(rest.slice(comma + 1))
        current.push({ op: 'text', segments: parseRichText(body) })
        break
      }
      case 'playvoice': {
        const src = normalizeAssetPath(args.length >= 2 ? args[1] : args[0])
        if (src) current.push({ op: 'voice', src })
        break
      }
      case 'playse': {
        const src = normalizeAssetPath(args[0])
        if (src) current.push({ op: 'se', src })
        break
      }
      case 'playbgm': {
        const src = normalizeAssetPath(args[0])
        if (src) current.push({ op: 'bgm', src })
        break
      }
      case 'stopbgm':
        current.push({ op: 'bgmStop', fade: seconds(args[0]) })
        break
      case 'fadeinblack':
        current.push({ op: 'fade', to: 'black', seconds: seconds(args[0], 1) })
        break
      case 'fadeoutblack':
        current.push({ op: 'fade', to: 'clear', seconds: seconds(args[0], 1) })
        break
      case 'wait':
        current.push({ op: 'wait', seconds: seconds(args[0]) })
        break
      case 'movie': {
        const srcs = String(args[0] || '').split(':').map(normalizeAssetPath).filter(Boolean)
        if (srcs.length) current.push({ op: 'movie', srcs, loop: args[2] === '1' })
        break
      }
      case 'movieoff':
        current.push({ op: 'movieOff' })
        break
      default:
        stats.raw[cmd] = (stats.raw[cmd] || 0) + 1
        current.push({ op: 'raw', cmd, args })
    }
  }
  flush()
  return { steps, stats }
}

export const uviewerCsvAdapter = { id: ADAPTER_ID, label: 'UViewer 剧情脚本（CSV）', sniff, parse }
