// 适配器：TyranoScript（.ks）脚本（Kamihime Player：game/dmm/raw_scenario/<类别>/<目录>/<id>_script.ks）→ 规范场景（gal-scene/1）。
// 这个格式的特点（照 Kamihime 的 3067 份脚本）：
//   *start / [call target=*start storage="tyrano.ks"]   脚本开头（sniff 认 *start + Tyrano 标签）；[position] [ptext] [chara_config] [call] [preload] 等界面设置不碰
//   [chara_new name= storage= jname=]                  声明角色：storage = 基础立绘（带 -<sha1>），jname = 显示名
//   [chara_face name= face= storage=]                  声明表情：一整张图（每个表情一个文件）；第一个带 hash，后面常常不带（fureafuarukon_01.png）
//   #<角色 key>                                        说话人标记（key → chara_new 的 jname；没声明的 key 原样当名字；单独一个 # = 旁白）
//   [chara_show name=] / [chara_mod name= face=] / [chara_hide name=]   立绘 = 一整张图 → stand 指令（和 legeclo 一样，部件带 align）；
//                                                      在场的角色按出场顺序摆：1 个居中，2 个左 / 右，3 个以上 左 / 中 / 右（脚本里的 left= / top= 不用，没有对照）
//   文字行 + [r]（换行）[l]（等点击）[cm]（清文本框）  非标签、非 # 行都是台词；[l] 结束一步，文本框内容 = 上次 [cm] 之后攒的全部文字；[cm] 前没有 [l] 的文字也算一步
//   [bg storage= time=]                                背景（black-<hash>.png / white-<hash>.png 直接当纯色，不查文件）；time（毫秒）→ 渐变
//   [playbgm storage=] / [stopbgm] / [fadeoutbgm]       bgm / bgmStop
//   [playse storage= loop=]                            loop=true → 背景音效声道（bgse），[stopse] 停它；否则：在 <resource_directory>/ 里的（h_get_* 这类语音）→ voice，别的 → se
//   [wait time=]                                       wait（毫秒 → 秒）
//   [quake count= time= hmax=|vmax=]                   shake（hmax 横 / vmax 竖，幅度按 1 像素 = 1/40）
//   [anim name=… top=|left=…]                          角色的跳 / 抖：连着的几条合成一个 shake（整个画面抖，不是只抖那个角色——没有单个立绘的动作指令）
//   [image storage="sepia_filter-<hash>.png" layer=4] / [freeimage layer=4] / [layopt layer=4 visible=]   整屏滤镜 → 当前背景的 over（再发一条 bg）；换背景时带着走
//   其余的（[anim layer=…] 的滑入 / 滑出、layer 3 的 layopt / freeimage、[kanim] [keyframe] [frame]、[iscript] 块、[mem_img] [mem_voice] [memorial]、没见过的标签）→ raw 原样保留，stats.raw 里有次数
//   [wa] [stopse] [cm] [position] [ptext] [chara_config] [call] [preload] [resetfont] [delay] 以及标签行外的注释（; 开头）静默忽略；[if] / [jump] / [glink] 等流程标签当 raw、脚本按顺序一路播下去
// 资源（相对资源根 game/dmm/assets）：
//   带 hash 的文件在 assets 平铺层，名字照抄（-<sha1>.<扩展名>）；找不到整名时按 stem（去掉 -<sha1>）再找一次
//   不带 hash 的：图片按「stem + 扩展名」在平铺层找 <stem>-<sha1>.<扩展名>；语音 / 音效先查这个脚本自己的 assets/<resource_directory>/<文件名>（resource_directory 在同目录的 <id>.json 里，不带 _script），
//   再按文件名在所有 resource_directory 里找（第一个）；都没有就算缺
//   缺文件都不致命：表情缺 → 退回这个角色的基础立绘；背景 / BGM 缺 → stats.unresolved（渲染诊断里能看到）；表情 / 语音 / 音效 / 滤镜缺 → 只记 stats.missing，不提示
// 列表（catalog）：raw_scenario 下的 类别 → 目录 → 剧情，剧情标题取同目录 json 的 title，is_r18 的带角标 R18。
// 资源目录来自 config.adapterOptions['tyrano-ks']：{ root（含 assets / raw_scenario 的目录，相对媒体目录，默认 'game/dmm'） }

export const ADAPTER_ID = 'tyrano-ks'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => String(options?.root ?? 'game/dmm').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

// 独有写法：*start 标签 + Tyrano 的标签（chara_new / call tyrano.ks / position / ptext …）
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 8192)
  return /^\s*\*start\b/m.test(head) && /\[(?:chara_new|chara_config|chara_show|ptext|position|playbgm|bg|call)\b/.test(head)
}

// ---------- 上下文：assets 文件索引 + 每个剧情 json 里的 resource_directory / 标题 ----------
export const contextFiles = () => []
export const contextDirs = (options) => [joinPath(rootOf(options), 'assets'), joinPath(rootOf(options), 'raw_scenario')]
export const contextTextFilter = (options) => {
  const prefix = `${joinPath(rootOf(options), 'raw_scenario')}/`
  return (rel) => rel.startsWith(prefix) && /\.json$/i.test(rel)
}
export const contextWalkLimit = 800000    // assets 平铺 1.1 万个 + 5000 多个 resource_directory 子目录，比默认的 40 万个文件多一点余量
export const contextSampleLimit = 20000   // 3067 个剧情各一个 json，超过默认的 3000

const HASHED = /^(.+)-[0-9a-f]{40}(\.[^.]+)?$/i
const lower = (text) => String(text).toLowerCase()
// 剧情脚本 / json 的键：路径最后 3 段（类别 / 目录 / 文件），去掉 _script 和扩展名——脚本和 json 的前缀不一样（相对脚本根 / 相对媒体目录），只看最后几段
const scriptKey = (rel) => String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-3).join('/').replace(/(?:_script)?\.[^./]+$/, '')

function readMeta(text) {
  try {
    const data = JSON.parse(String(text || '').replace(/^﻿/, ''))
    return { rd: String(data?.resource_directory || ''), title: String(data?.title || ''), r18: Boolean(data?.is_r18), summary: String(data?.summary || '') }
  } catch {   // 只读了开头 24KB 被截断：退回用正则取 resource_directory / title
    const t = String(text || '')
    return { rd: /"resource_directory"\s*:\s*"([^"]*)"/.exec(t)?.[1] || '', title: /"title"\s*:\s*"([^"]*)"/.exec(t)?.[1] || '', r18: /"is_r18"\s*:\s*true/.test(t), summary: '' }
  }
}

export function prepare({ options, texts, files, toResourcePath }) {
  const toRes = toResourcePath || ((rel) => rel)
  const assets = `${joinPath(rootOf(options), 'assets')}/`
  const scenarioDir = `${joinPath(rootOf(options), 'raw_scenario')}/`
  const flat = new Map()        // 文件名（小写）→ 资源路径（assets 平铺层）
  const stems = new Map()       // <stem><扩展名>（去掉 -<sha1>，小写）→ 资源路径
  const stemsAny = new Map()    // <stem>（不要扩展名）→ 资源路径
  const rdFiles = new Map()     // <resource_directory>/<文件名>（小写）→ 资源路径
  const byName = new Map()      // 文件名（小写）→ 第一个在 resource_directory 里的资源路径
  const scripts = []            // raw_scenario 下的 .ks（相对媒体目录）
  for (const rel of files || []) {
    if (rel.startsWith(assets)) {
      const rest = rel.slice(assets.length)
      const slash = rest.indexOf('/')
      if (slash < 0) {
        flat.set(lower(rest), toRes(rel))
        const m = HASHED.exec(rest)
        if (m) {
          const key = lower(m[1])
          if (!stemsAny.has(key)) stemsAny.set(key, toRes(rel))
          if (!stems.has(key + lower(m[2] || ''))) stems.set(key + lower(m[2] || ''), toRes(rel))
        }
      } else {
        const name = lower(rest.slice(rest.lastIndexOf('/') + 1))
        rdFiles.set(`${lower(rest.slice(0, slash))}/${name}`, toRes(rel))
        if (!byName.has(name)) byName.set(name, toRes(rel))
      }
    } else if (rel.startsWith(scenarioDir) && /\.ks$/i.test(rel)) scripts.push(rel)
  }
  const meta = new Map()   // 剧情键 → { rd, title, r18, summary }
  for (const [rel, text] of Object.entries(texts || {})) if (rel.startsWith(scenarioDir)) meta.set(scriptKey(rel), readMeta(text))
  return { flat, stems, stemsAny, rdFiles, byName, scripts, meta, scenarioDir, hasIndex: Boolean(files?.length) }
}

// ---------- 列表（catalog）：类别 → 目录 → 剧情 ----------
const natural = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
const catalogCache = new WeakMap()   // ctx → 目录树（3000 多个剧情，建一次够了；ctx 在文件变化时会重建）
export function catalog(ctx) {
  if (!ctx?.scripts?.length) return null
  if (!catalogCache.has(ctx)) catalogCache.set(ctx, buildCatalog(ctx))
  return catalogCache.get(ctx)
}
function buildCatalog(ctx) {
  const root = { children: [] }
  const dirs = new Map()   // 目录 id → 节点
  for (const rel of [...ctx.scripts].sort(natural)) {
    const parts = rel.slice(ctx.scenarioDir.length).split('/')
    const file = parts.pop()
    let holder = root
    let id = ''
    for (const part of parts) {
      id = id ? `${id}/${part}` : part
      let node = dirs.get(id)
      if (!node) { node = { id, title: part, children: [] }; dirs.set(id, node); holder.children.push(node) }
      holder = node
    }
    const info = ctx.meta.get(scriptKey(rel))
    const stem = file.replace(/(?:_script)?\.ks$/i, '')
    holder.children.push({ id: `s:${rel}`, title: info?.title || stem, subtitle: info?.title ? stem : '', badge: info?.r18 ? 'R18' : '', script: rel })
  }
  for (const node of dirs.values()) node.subtitle = `${node.children.length} 项`
  return root
}

// 体检（列表页的渲染诊断）：没读到 assets 索引 / 没有剧情 json
export function health(ctx) {
  const out = []
  if (!ctx?.hasIndex || !ctx.flat.size) out.push({ level: 'warn', code: 'tyrano-assets-empty', message: '没读到 assets 下的文件（检查 adapterOptions[\'tyrano-ks\'].root，默认 game/dmm）：背景 / 立绘 / 语音都会找不到' })
  if (ctx?.scripts?.length && !ctx.meta.size) out.push({ level: 'warn', code: 'tyrano-json-empty', message: '剧情脚本旁边没有读到 .json（resource_directory / 标题）：语音只能按文件名找，标题用脚本名' })
  return out
}

// ---------- 标签解析 ----------
// 一行拆成 [{ tag, attrs, raw }] 和文字片段 { text }；引号里的 ] 不算结束；没有 ] 的标签（[stopse）吃到行尾；标签里再遇到 [ 就在那里结束（[stopbgm[[playbgm …]）
function tokenize(line) {
  const out = []
  let i = 0
  let buf = ''
  const pushText = () => { if (buf) { out.push({ text: buf }); buf = '' } }
  while (i < line.length) {
    const ch = line[i]
    if (ch !== '[') { buf += ch; i += 1; continue }
    if (line[i + 1] === '[' && !/^\[\[\s*[A-Za-z_]/.test(line.slice(i))) { buf += '['; i += 2; continue }   // [[ = 文字里的 [（后面不是标签名的时候）
    pushText()
    i += 1
    while (line[i] === '[') i += 1
    let inner = ''
    let quote = false
    while (i < line.length) {
      const c = line[i]
      if (c === '"') quote = !quote
      if (!quote && (c === ']' || c === '[')) break
      inner += c
      i += 1
    }
    if (line[i] === ']') i += 1
    const m = /^\s*(;|[\w.-]+)\s*([\s\S]*)$/.exec(inner)
    if (!m) continue
    out.push({ tag: m[1].toLowerCase(), raw: m[2].trim(), attrs: attrsOf(m[2]) })
  }
  pushText()
  return out
}

function attrsOf(text) {
  const attrs = {}
  const re = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g
  let m
  while ((m = re.exec(String(text || '')))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return attrs
}

const secs = (ms, fallback = 0, max = 60) => { const n = Number.parseFloat(ms); return Number.isFinite(n) ? Math.max(0, Math.min(max, n / 1000)) : fallback }
const delta = (value) => { const n = Number.parseFloat(String(value ?? '').replace(/^[+-]=/, '')); return Number.isFinite(n) ? n : 0 }
const baseName = (storage) => String(storage ?? '').replace(/\\/g, '/').split('/').pop().trim()
const SILENT = new Set(['wa', 'wb', 'ws', 'cm', 'clearfix', 'er', 'nolog', 'endnolog', 'position', 'ptext', 'chara_config', 'call', 'preload', 'resetfont', 'delay', 'font', 'ct', 'trans', 'hidemessage', 'showmessage', 'chara_layer', 'chara_part', 'macro', 'endmacro', ';'])
const IF_TAGS = new Set(['if', 'elsif', 'else', 'endif', 'jump', 'glink', 'link', 'endlink', 'button', 'clickable', 's'])

export function parse(text, ctx = null, meta = {}) {
  const steps = []
  let current = []
  const stats = { commands: 0, raw: {}, unresolved: {}, missing: {}, fallbacks: {}, stands: 0 }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const emit = (command) => { current.push(command) }
  const info = ctx?.meta?.get(scriptKey(meta?.rel || ''))   // 同目录 json：resource_directory / 标题
  const rd = lower(info?.rd || '')
  const index = Boolean(ctx?.hasIndex)

  // ---- 资源查找（返回相对资源根的路径，找不到返回 ''）----
  // kind：'image'（带 hash 的整名 → stem 退一步；不带的按 stem + 扩展名）/ 'audio'（先查本剧情的 resource_directory，再查所有 resource_directory）
  const find = (storage, kind = 'image') => {
    const name = baseName(storage)
    if (!name) return ''
    if (!index) return rd && kind === 'audio' && !HASHED.test(name) ? `${info.rd}/${name}` : name
    const key = lower(name)
    if (ctx.flat.has(key)) return ctx.flat.get(key)
    const m = HASHED.exec(name)
    if (m) return ctx.stems.get(lower(m[1]) + lower(m[2] || '')) || ''
    if (kind === 'audio') return (rd && ctx.rdFiles.get(`${rd}/${key}`)) || ctx.byName.get(key) || ctx.stems.get(key) || ''
    return ctx.stems.get(key) || ctx.stemsAny.get(key.replace(/\.[^.]+$/, '')) || ''
  }
  const inRd = (path) => rd && String(path).toLowerCase().startsWith(`${rd}/`)

  // ---- 状态 ----
  const chars = new Map()        // key → { jname, base（基础立绘路径或 ''）, faces: Map(face → storage), face（当前表情的路径） }
  const shown = []               // 在场角色 key（出场顺序）
  let standOn = false
  let standDirty = false
  let speaker = ''               // 当前 # 说话人的显示名
  let emittedSpeaker = ''
  let windowText = ''            // 文本框里现在的文字（[cm] 清掉）
  let unclicked = false          // 文本框里有还没成一步（没遇到 [l]）的新文字
  let curBg = null               // 当前背景指令（{ src } 或 { color }），滤镜 over 要重发它
  let overlay = ''               // 整屏滤镜（layer 4）的图
  let overlayVisible = true
  let looping = false            // 背景音效声道在响
  let hop = null                 // 连着的 [anim name=…] 攒成一个 shake
  let inScript = false

  const charOf = (key) => {
    const k = lower(key)
    if (!chars.has(k)) chars.set(k, { jname: '', base: '', faces: new Map(), face: '' })
    return chars.get(k)
  }
  const flushStand = () => {
    if (!standDirty) return
    standDirty = false
    const parts = []
    shown.forEach((key, i) => {
      const c = chars.get(key)
      const src = c?.face || c?.base
      if (!src) return
      const n = shown.length
      const align = n === 1 ? 'center' : i === 0 ? 'left' : i === n - 1 ? 'right' : 'center'
      parts.push({ src, align })
    })
    if (parts.length) { emit({ op: 'stand', parts }); standOn = true; stats.stands += 1 } else if (standOn) { emit({ op: 'standOff' }); standOn = false }
  }
  const flushHop = () => {
    if (!hop) return
    emit({ op: 'shake', axis: hop.axis, strength: Math.min(1, Math.max(0.05, hop.amp / 40)), seconds: Math.max(0.1, Math.min(3, hop.ms / 1000)) })
    hop = null
  }
  const emitBg = (fade = 0) => {
    if (!curBg) return
    emit({ op: 'bg', ...curBg, ...(overlay && overlayVisible ? { over: overlay } : {}), fade })
  }
  const raw = (cmd, attrsText) => { count('raw', cmd); emit({ op: 'raw', cmd, args: attrsText ? [attrsText] : [] }) }
  // 结束一步（[l]）：立绘 → 说话人 → 台词 → 切步
  const clickStep = () => {
    flushHop()
    const body = windowText.replace(/^\n+|\n+$/g, '')
    if (!body && !current.length) return
    flushStand()
    if (speaker !== emittedSpeaker) { emit({ op: 'speaker', segments: speaker ? [{ text: speaker }] : [] }); emittedSpeaker = speaker }
    emit({ op: 'text', segments: body ? [{ text: body }] : [] })
    unclicked = false
    stats.commands += current.length
    steps.push({ index: steps.length, commands: current })
    current = []
  }
  const clearWindow = () => {   // [cm]：文本框里还有没等点击的文字就先成一步，再清
    if (unclicked && windowText.replace(/\n/g, '').trim()) clickStep()
    windowText = ''
  }

  const handleTag = ({ tag, attrs, raw: rawText }) => {
    if (tag !== 'anim') flushHop()
    switch (tag) {
      case 'chara_new': {
        const c = charOf(attrs.name || '')
        c.jname = attrs.jname || ''
        const src = find(attrs.storage)
        c.base = src
        c.face = src
        if (!src && attrs.storage) count(index ? 'unresolved' : 'missing', `chara:${baseName(attrs.storage)}`)
        break
      }
      case 'chara_face': {
        const c = charOf(attrs.name || '')
        if (attrs.face) c.faces.set(attrs.face, attrs.storage || '')
        break
      }
      case 'chara_show': {
        const key = lower(attrs.name || '')
        if (!key) break
        if (!shown.includes(key)) shown.push(key)
        standDirty = true
        break
      }
      case 'chara_hide': case 'chara_delete': {
        const at = shown.indexOf(lower(attrs.name || ''))
        if (at >= 0) { shown.splice(at, 1); standDirty = true }
        break
      }
      case 'chara_hide_all': if (shown.length) { shown.length = 0; standDirty = true } break
      case 'chara_mod': {
        const c = chars.get(lower(attrs.name || ''))
        if (!c || !attrs.face) break
        const storage = c.faces.get(attrs.face)
        let src = storage ? find(storage) : ''
        if (!src) {   // 表情文件缺（或没声明这个表情）：退回基础立绘
          src = c.base
          count('fallbacks', `face:${storage ? baseName(storage) : attrs.face}`)
          if (storage) count('missing', `face:${baseName(storage)}`)
        }
        if (src !== c.face) { c.face = src; if (shown.includes(lower(attrs.name))) standDirty = true }
        break
      }
      case 'bg': {
        flushStand()
        const name = baseName(attrs.storage)
        const fade = secs(attrs.time)
        const colorOf = /^(black|white)-[0-9a-f]{40}\.\w+$/i.exec(name) || /^(black|white)\.\w+$/i.exec(name)
        if (colorOf) curBg = { color: lower(colorOf[1]) === 'black' ? [0, 0, 0] : [255, 255, 255] }
        else {
          const src = find(attrs.storage)
          if (src) curBg = { src }
          else { count('unresolved', `bg:${name}`); break }
        }
        emitBg(fade)
        break
      }
      case 'playbgm': case 'fadeinbgm': {
        const src = find(attrs.storage, 'audio')
        if (src) emit({ op: 'bgm', src })
        else count('unresolved', `bgm:${baseName(attrs.storage)}`)
        break
      }
      case 'stopbgm': case 'fadeoutbgm': emit({ op: 'bgmStop', fade: secs(attrs.time) }); break
      case 'playse': {
        const src = find(attrs.storage, 'audio')
        if (!src) { count('missing', `se:${baseName(attrs.storage)}`); break }
        if (/^true$/i.test(attrs.loop || '')) { emit({ op: 'bgse', src, loop: true }); looping = true } else emit({ op: inRd(src) ? 'voice' : 'se', src })
        break
      }
      case 'stopse': if (looping) { emit({ op: 'bgseStop' }); looping = false } break
      case 'wait': { const seconds = secs(attrs.time, 0, 30); if (seconds > 0) { flushStand(); emit({ op: 'wait', seconds }) } break }
      case 'quake': {
        flushStand()
        const vertical = attrs.vmax !== undefined && attrs.hmax === undefined
        emit({ op: 'shake', axis: vertical ? 'vertical' : 'horizontal', strength: Math.min(1, Math.max(0.05, delta(vertical ? attrs.vmax : attrs.hmax) / 40)), seconds: Math.max(0.1, Math.min(5, secs(attrs.time, 0.3))) })
        break
      }
      case 'anim': {
        const move = attrs.top !== undefined ? 'top' : attrs.left !== undefined ? 'left' : ''
        if (attrs.name && !attrs.layer && move) {   // 角色的跳 / 抖：连着的合成一个 shake
          const amp = Math.abs(delta(attrs[move]))
          if (!hop) hop = { axis: move === 'top' ? 'vertical' : 'horizontal', amp: 0, ms: 0 }
          hop.amp = Math.max(hop.amp, amp)
          hop.ms += Number.parseFloat(attrs.time) || 0
        } else { flushHop(); raw('anim', rawText) }   // layer 的滑入 / 滑出等
        break
      }
      case 'image': {
        if (String(attrs.layer) === '4' && /sepia/i.test(attrs.storage || '')) {
          const src = find(attrs.storage)
          if (!src) { count('missing', `image:${baseName(attrs.storage)}`); break }
          overlay = src
          overlayVisible = true
          if (curBg) { flushStand(); emitBg(secs(attrs.time)) } else raw('image', rawText)
        } else raw('image', rawText)
        break
      }
      case 'freeimage': {
        if (String(attrs.layer) === '4') { if (overlay) { overlay = ''; flushStand(); emitBg(secs(attrs.time)) } } else raw('freeimage', rawText)
        break
      }
      case 'layopt': {
        if (String(attrs.layer) === '4' && attrs.visible !== undefined) {
          const visible = !/^false$/i.test(attrs.visible)
          if (visible !== overlayVisible) { overlayVisible = visible; if (overlay) emitBg(0) }
        } else raw('layopt', rawText)
        break
      }
      case 'iscript': inScript = true; raw('iscript', ''); break
      default:
        if (SILENT.has(tag)) break
        if (IF_TAGS.has(tag)) { raw(tag, rawText); break }
        raw(tag, rawText)   // kanim / keyframe / frame / mem_* / 没见过的标签：原样保留，不丢也不炸
    }
  }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.replace(/^﻿/, '').trim()
    if (!line) continue
    if (inScript) { if (/\[endscript\]|^@endscript/i.test(line)) inScript = false; continue }   // [iscript] 块里是 JS
    if (line.startsWith(';') || line.startsWith('*')) continue   // 注释 / 标签（*start）
    if (line.startsWith('@')) line = `[${line.slice(1)}]`        // @tag 属性 = [tag 属性]
    if (line.startsWith('#')) {
      const key = line.slice(1).split(':')[0].trim()
      speaker = key ? chars.get(lower(key))?.jname || key : ''
      continue
    }
    for (const token of tokenize(line)) {
      if (token.text !== undefined) { windowText += token.text; if (token.text.trim()) unclicked = true; continue }
      switch (token.tag) {
        case 'r': windowText += '\n'; break
        case 'l': clickStep(); break
        case 'p': clickStep(); windowText = ''; break
        case 'cm': clearWindow(); break
        case 'endscript': inScript = false; break
        default: handleTag(token)
      }
      if (inScript) break
    }
  }
  flushHop()
  clearWindow()
  flushStand()
  // 最后一次点击之后剩下的指令并进最后一步，不单独成一步（否则末尾多一个空白的「点一下」）
  if (current.length) {
    if (steps.length) { steps[steps.length - 1].commands.push(...current); stats.commands += current.length } else steps.push({ index: 0, commands: [...current, { op: 'text', segments: [] }] })
  }
  return { steps, stats }
}

export const tyranoKsAdapter = { id: ADAPTER_ID, label: 'TyranoScript（Kamihime Player）', sniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare, catalog, health }
