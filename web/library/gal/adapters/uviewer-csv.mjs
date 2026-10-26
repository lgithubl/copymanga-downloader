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
//   默认只有 flash 被渲染（闪屏）；ミナシゴノシゴトR 这类带立绘 / 叠加层的游戏打开 sprites.enabled（见下，由 gal-layout 脚本的 LAYOUTS 写进条目 config），下面这些指令才按 sprites 表翻译：
//   spriteatlas,<图集路径（无扩展名）>,<层名>:<帧号>,<槽位>,<x>,<y>,<缩放>,<淡入秒>   立绘：plist 图集的一帧 → 场景 stand { slot, parts: [{ atlas: { plist, texture, frames, base? }, x, y, scale }], fade, stage }（同槽位再来一条 = 换帧；帧名按 sprites.atlas.frameKeys 生成候选，播放器取 plist 里第一个存在的）
//   spriteoff,<槽位|all>,<淡出秒>                      去掉立绘 / 叠加层：槽位按脚本里它是怎么建的选 standOff / overlayOff（没建过 = 什么都不输出）；all = sprites.offAll 列的那几类（默认只清立绘）
//   sprite,<图片路径>,<槽位>,<x>,<y>,<缩放>,<淡入秒>      静态图（CG still、黑底图…）→ overlay { slot, src, x, y, scaleX, scaleY, fade, fit?, stage }
//   mask,<名字>,<x>,<y>,<宽>,<高>,<alpha>               矩形 → overlay { slot: 名字, rect, color: sprites.maskColor, alpha, stage }（猜测：游戏里它很可能是 imgconf 用的裁剪窗口而不是要画出来的色块；所以 minashigo_r 的 LAYOUTS 把它设成 raw）
//   imgconf,<目标槽位>,<mask 名>,<x>,<y>,,,<旋转>,<缩放x>,<缩放y>,<淡入秒>   改一个已有叠加层的布局 → overlay { slot, x, y, scaleX, scaleY, fade }（目标不是脚本里建过的叠加层 = raw；旋转 / mask 名暂不用）
//   flash,<r>,<g>,<b>,<次数>,<每次秒数>,<强度>             闪屏；shake,<秒>,<次数>,<x>,<y>[,<槽位>]   画面抖动（整屏；带槽位的也按整屏抖——播放器没有按槽位抖动）→ shake { axis, strength, seconds }
//   anm,tint,… 保留 raw（染色动画，播放器没有对应的渲染）；endwmsg 忽略。
//
// 选项 config.adapterOptions['uviewer-csv']（适配器只读配置、按配置匹配；DEFAULT_OPTIONS = 今天的行为）：
//   commands { aliases: {}, known: [KNOWN], rawHints: [RAW_HINTS] }   aliases：{ 别名: 规范指令名 }（别名按规范指令处理，嗅探也算认得）；known / rawHints：嗅探时「认得的指令名」（整体替换默认表，不影响 parse 的 switch）
//   msg { textArgIndex: 1, singleArgText: false }          台词 = 第 textArgIndex 个逗号之后的整段；逗号不够时：singleArgText = true 取 msg, 之后的整段，false 当空
//   playvoice { pathArgIndex: 1 }                           语音路径所在参数（参数不够时取第一个）
//   bg { colorPrefix: 'color_' }                            bg 参数以它开头 = 纯色（color_R_G_B）；'' = 没有纯色写法
//   select { var: 'select', prefixRe: '^(?:選項|选项|選擇|选择|Option)\\s*\\d+[\\s\\u3000:：.、-]*' }   弹选项：选的序号记进 var；选项文字开头匹配 prefixRe 的部分去掉（'' = 不去）
//   conditions { vars: {} }                                 { 变量名: 初始值 }：除 select 以外「一直不变」的变量，if 条件在解析时就判定（成立 = 去掉条件，不成立 = 这个块里的指令不输出）；没配的变量 = 以前的行为（没设过 → 条件不成立，块不可见）
//   sniff { minKnownRatio: 0.6, minLines: 3, maxLines: 40 }   sniff(text, options)：看前 maxLines 条指令，至少 minLines 条且认得的比例 ≥ minKnownRatio
//   sprites（enabled = false 时下面都不生效，立绘 / 叠加层指令保持 raw = 以前的行为）：
//     enabled      true = 按下面的表翻译 spriteatlas / spriteoff / sprite / mask / imgconf / shake（flash 本来就翻译，endwmsg 本来就忽略）
//     stage        { width: 1280, height: 720 }：脚本里 x / y / 矩形所指的舞台大小（猜测值，写进场景指令的 stage 字段）
//     yUp          true：脚本的 y 向上为正（Cocos2d 约定），输出时取反成场景的「y 向下」；矩形的 y 是从底边往上数，也相应换算
//     numbers      { x: 0, y: 1, scale: 2, fade: 3 }：槽位参数之后第几个参数是 x / y / 缩放 / 淡入秒（spriteatlas 和 sprite 共用）
//     atlas        { plistExt: '.plist', textureExt: '.png', frameKeys: ['{n}.png', '{name}:{n}.png', '{n}'], baseKeys: [] }：图集路径 + 扩展名 = plist / 贴图；帧参数 `body:003` 的 {name} = body、{n} = 003，frameKeys 生成候选帧名（数组，播放器取第一个存在的）；baseKeys（例：['{name}.png']）= 要先画的底图帧（存在才画）
//     fit          'none' | 'contain' | 'cover'：sprite 图片的适配方式（'contain' = 先缩放到舞台大小，再乘脚本里的缩放；CG 不是舞台尺寸时用）
//     maskColor    mask 矩形的填充色（'#000000'）
//     offAll       ['stand']：spriteoff,all 清哪几类（stand / overlay）
//     commands     { spriteatlas: 'stand', spriteoff: 'off', sprite: 'overlay', mask: 'rect', imgconf: 'layout', anm: 'raw', shake: 'shake', flash: 'flash', endwmsg: 'ignore' }：每条指令怎么处理（可选值：各指令的默认值 / raw = 保留成 raw 指令 / ignore = 丢掉）
//     slotRules    [{ cmds?: [指令名], match: 正则（对槽位名 / mask 名 / imgconf 目标，不分大小写）, as: 'raw' | 'ignore' | 该指令的处理名 }]：命中的第一条覆盖 commands 表（按槽位名区分，例：黑底图 black* 保留 raw）

import { condMet } from '../../../static/gal-engine.js'
import { compileSafeRegex } from '../voice.mjs'

export const ADAPTER_ID = 'uviewer-csv'

const KNOWN = [
  'bg', 'bgoff', 'name', 'msg', 'playvoice', 'playse', 'playbgm', 'stopbgm', 'fadeinblack', 'fadeoutblack',
  'wait', 'movie', 'movieoff', 'clickwait', 'endwait', 'select', 'if', 'elseif', 'else', 'endif',
]
const RAW_HINTS = ['spriteatlas', 'sprite', 'spriteoff', 'flash', 'endwmsg', 'anm', 'mask', 'imgconf', 'spine', 'spineoff']
// sprites.commands：每条指令能选的处理（第一个 = 默认）；raw = 保留成 raw 指令，ignore = 丢掉
const SPRITE_ACTIONS = {
  spriteatlas: ['stand', 'raw', 'ignore'], spriteoff: ['off', 'raw', 'ignore'], sprite: ['overlay', 'raw', 'ignore'], mask: ['rect', 'raw', 'ignore'],
  imgconf: ['layout', 'raw', 'ignore'], anm: ['raw', 'ignore'], shake: ['shake', 'raw', 'ignore'], flash: ['flash', 'raw', 'ignore'], endwmsg: ['ignore', 'raw'],
}
const OPTION_PREFIX_SOURCE = '^(?:選項|选项|選擇|选择|Option)\\s*\\d+[\\s\\u3000:：.、-]*'

export const DEFAULT_OPTIONS = {
  commands: { aliases: {}, known: KNOWN, rawHints: RAW_HINTS },
  msg: { textArgIndex: 1, singleArgText: false },
  playvoice: { pathArgIndex: 1 },
  bg: { colorPrefix: 'color_' },
  select: { var: 'select', prefixRe: OPTION_PREFIX_SOURCE },
  conditions: { vars: {} },
  sniff: { minKnownRatio: 0.6, minLines: 3, maxLines: 40 },
  sprites: {
    enabled: false,
    stage: { width: 1280, height: 720 },
    yUp: true,
    numbers: { x: 0, y: 1, scale: 2, fade: 3 },
    atlas: { plistExt: '.plist', textureExt: '.png', frameKeys: ['{n}.png', '{name}:{n}.png', '{n}'], baseKeys: [] },
    fit: 'none',
    maskColor: '#000000',
    offAll: ['stand'],
    commands: { spriteatlas: 'stand', spriteoff: 'off', sprite: 'overlay', mask: 'rect', imgconf: 'layout', anm: 'raw', shake: 'shake', flash: 'flash', endwmsg: 'ignore' },
    slotRules: [],
  },
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
    sprites: compileSprites(given.sprites),
  }
}
// sprites 子表 → 编译结果（enabled !== true = null：整块不生效）
const strings = (v, d, max = 16) => (Array.isArray(v) ? v : d).filter((x) => typeof x === 'string' && x && x.length <= 80).slice(0, max)
function compileSprites(given) {
  const d = DEFAULT_OPTIONS.sprites
  const sp = isObject(given) ? given : {}
  if (sp.enabled !== true) return null
  const sub = (key) => (isObject(sp[key]) ? sp[key] : {})
  const dim = (v, def) => (Number.isFinite(v) && v >= 1 && v <= 16384 ? v : def)
  const numbers = {}
  for (const key of Object.keys(d.numbers)) numbers[key] = index(sub('numbers')[key], d.numbers[key], 0, 8)
  const commands = {}
  for (const [cmd, allowed] of Object.entries(SPRITE_ACTIONS)) commands[cmd] = allowed.includes(sub('commands')[cmd]) ? sub('commands')[cmd] : d.commands[cmd]
  const rules = []
  for (const rule of (Array.isArray(sp.slotRules) ? sp.slotRules : d.slotRules).slice(0, 64)) {
    if (!isObject(rule) || typeof rule.match !== 'string' || typeof rule.as !== 'string') continue
    let re = null
    try { re = compileSafeRegex(rule.match, { flags: 'i', label: 'sprites.slotRules.match' }) } catch { continue }
    const cmds = Array.isArray(rule.cmds) ? new Set(rule.cmds.filter((c) => Object.hasOwn(SPRITE_ACTIONS, c))) : null
    if (cmds && !cmds.size) continue
    rules.push({ re, cmds, as: rule.as })
  }
  const maskColor = safeColor(sp.maskColor)
  return {
    stage: [dim(sub('stage').width, d.stage.width), dim(sub('stage').height, d.stage.height)],
    yUp: sp.yUp !== false,
    numbers,
    plistExt: typeof sub('atlas').plistExt === 'string' && /^\.?\w{0,8}$/.test(sub('atlas').plistExt) ? sub('atlas').plistExt : d.atlas.plistExt,
    textureExt: typeof sub('atlas').textureExt === 'string' && /^\.?\w{0,8}$/.test(sub('atlas').textureExt) ? sub('atlas').textureExt : d.atlas.textureExt,
    frameKeys: strings(sub('atlas').frameKeys, d.atlas.frameKeys),
    baseKeys: strings(sub('atlas').baseKeys, d.atlas.baseKeys),
    fit: ['none', 'contain', 'cover'].includes(sp.fit) ? sp.fit : d.fit,
    maskColor: maskColor || d.maskColor,
    offAll: (Array.isArray(sp.offAll) ? sp.offAll : d.offAll).filter((k) => k === 'stand' || k === 'overlay'),
    commands,
    rules,
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

// ---------- sprites（立绘 / 叠加层 / 抖动）：只在 options.sprites.enabled 时由 parse 调用 ----------
const flashOp = (args) => {   // flash,r,g,b,次数,每次秒数,强度：闪屏（强度暂不用）
  const c = [args[0], args[1], args[2]].map((v) => Math.max(0, Math.min(255, Math.round(Number.parseFloat(v) || 0))))
  return { op: 'flash', color: `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`, count: Math.max(1, Math.min(10, Math.round(Number.parseFloat(args[3]) || 1))), seconds: seconds(args[4], 0.3) }
}
const number = (value, fallback) => { const n = Number.parseFloat(String(value ?? '').trim()); return Number.isFinite(n) ? n : fallback }
const rounded = (n) => Math.round(n * 1000) / 1000
// 槽位名所在参数：spriteatlas 第 3 个，sprite / anm 第 2 个，mask / imgconf / spriteoff 第 1 个，shake 可选的第 5 个
const SLOT_ARG = { spriteatlas: 2, sprite: 1, anm: 1, mask: 0, imgconf: 0, spriteoff: 0, shake: 4 }

function spriteAction(sp, cmd, args) {
  const slot = String(args[SLOT_ARG[cmd]] ?? '')
  for (const rule of sp.rules) if ((!rule.cmds || rule.cmds.has(cmd)) && SPRITE_ACTIONS[cmd].includes(rule.as) && rule.re.test(slot)) return rule.as
  return sp.commands[cmd]
}

// 返回要输出的指令数组（可以是空）；kinds：槽位 → 'stand' | 'overlay'（这份脚本里它是怎么建的，spriteoff 用）
function spriteCommands(sp, cmd, args, kinds) {
  const action = spriteAction(sp, cmd, args)
  if (action === 'ignore') return []
  const raw = [{ op: 'raw', cmd, args }]
  const stage = [...sp.stage]
  const at = (i) => args[i + 1 + (SLOT_ARG[cmd] ?? 0)]
  const y = (v) => (sp.yUp ? 0 - v : v)
  switch (action) {
    case 'stand': {
      const path = normalizeAssetPath(args[0]).replace(/\.(?:plist|png)$/i, '')
      const slot = String(args[2] ?? '')
      if (!path || !slot) return raw
      const frameArg = String(args[1] ?? '')
      const colon = frameArg.indexOf(':')
      const name = colon < 0 ? '' : frameArg.slice(0, colon)
      const n = colon < 0 ? frameArg : frameArg.slice(colon + 1)
      const fill = (keys) => [...new Set(keys.filter((k) => n && (name || !k.includes('{name}'))).map((k) => k.replaceAll('{name}', name).replaceAll('{n}', n)))]
      const frames = fill(sp.frameKeys)
      const base = fill(sp.baseKeys)
      if (!frames.length) return raw
      kinds.set(slot, 'stand')
      const atlas = { plist: `${path}${sp.plistExt}`, texture: `${path}${sp.textureExt}`, frames, ...(base.length ? { base } : {}) }
      return [{ op: 'stand', slot, stage, parts: [{ atlas, x: number(at(sp.numbers.x), 0), y: y(number(at(sp.numbers.y), 0)), scale: number(at(sp.numbers.scale), 1) }], fade: seconds(at(sp.numbers.fade)) }]
    }
    case 'overlay': {   // sprite
      const src = normalizeAssetPath(args[0])
      const slot = String(args[1] ?? '')
      if (!src || !slot) return raw
      kinds.set(slot, 'overlay')
      const scale = number(at(sp.numbers.scale), 1)
      return [{ op: 'overlay', slot, src, x: number(at(sp.numbers.x), 0), y: y(number(at(sp.numbers.y), 0)), scaleX: scale, scaleY: scale, ...(sp.fit !== 'none' ? { fit: sp.fit } : {}), fade: seconds(at(sp.numbers.fade)), stage }]
    }
    case 'rect': {   // mask,名字,x,y,宽,高,alpha
      const slot = String(args[0] ?? '')
      const [rx, ry, w, h] = [1, 2, 3, 4].map((i) => number(args[i], NaN))
      if (!slot || ![rx, ry, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return raw
      kinds.set(slot, 'overlay')
      return [{ op: 'overlay', slot, rect: [rx, sp.yUp ? sp.stage[1] - ry - h : ry, w, h], color: sp.maskColor, alpha: Math.max(0, Math.min(1, number(args[5], 1))), stage }]
    }
    case 'layout': {   // imgconf,目标,mask 名,x,y,,,旋转,缩放x,缩放y,淡入秒
      const slot = String(args[0] ?? '')
      if (kinds.get(slot) !== 'overlay') return raw
      const sx = number(args[7], 1)
      const sy = number(args[8], sx)
      return [{ op: 'overlay', slot, x: number(args[2], 0), y: y(number(args[3], 0)), scaleX: sx, scaleY: sy, fade: seconds(args[9]) }]
    }
    case 'off': {   // spriteoff,槽位|all,淡出秒
      const target = String(args[0] ?? '')
      const fade = seconds(args[1])
      if (target.toLowerCase() === 'all') {
        const out = []
        for (const kind of sp.offAll) out.push(kind === 'stand' ? { op: 'standOff', fade } : { op: 'overlayOff', fade })
        for (const [slot, kind] of [...kinds]) if (sp.offAll.includes(kind)) kinds.delete(slot)
        return out
      }
      const kind = kinds.get(target)
      if (!kind) return []
      kinds.delete(target)
      return [{ op: kind === 'stand' ? 'standOff' : 'overlayOff', slot: target, fade }]
    }
    case 'shake': {   // shake,秒,次数,x,y[,槽位]：振幅取 x / y 的大者，播放器按 strength × 40 像素抖
      const sx = Math.abs(number(args[2], 0))
      const sy = Math.abs(number(args[3], 0))
      if (!sx && !sy) return []
      return [{ op: 'shake', axis: sx && sy ? 'overall' : sx ? 'horizontal' : 'vertical', strength: rounded(Math.max(sx, sy) / 40), seconds: seconds(args[0], 0.5) }]
    }
    case 'flash':
      return [flashOp(args)]
    default:
      return raw
  }
}

export function parse(text, _ctx = null, meta = null) {
  const o = opts(meta?.options)
  const steps = []
  let current = []
  const stats = { commands: 0, raw: {}, choices: 0, unmatchedEndif: 0 }
  const ifStack = []   // { branches: [cond|null], cur: [cond] }
  const spriteKinds = new Map()   // 槽位 → 'stand' | 'overlay'（sprites 开着时：spriteoff 按它选 standOff / overlayOff）
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
    if (o.sprites && Object.hasOwn(SPRITE_ACTIONS, cmd)) {
      for (const command of spriteCommands(o.sprites, cmd, args, spriteKinds)) {
        if (command.op === 'raw') stats.raw[cmd] = (stats.raw[cmd] || 0) + 1
        emit(command)
      }
      continue
    }
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
      case 'flash':
        emit(flashOp(args))
        break
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
