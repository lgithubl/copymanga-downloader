// 适配器：ArtWhirl（魔法学园的少女们，Ren'Py + JSON 剧情）的剧情 JSON → 规范场景（gal-scene/1）。语义照游戏自带的 json_story_player.rpy（官方解释器）：
// 剧情 JSON 是「并行数组」：第 i 行 = texts[i]（台词，null = 只放指令）、bgs[i]（背景）、bgms[i]、voices[i]、charas[i]（立绘集合）、names[i]、colors[i]、others[i]（指令列表）、effects[i]、waits[i]；
// 值是整数的（bgs / bgms / charas / names / colors）是 dic 的下标，dic[n] 才是真正的值（None = null）；{n1} 这种服务器的主角名占位符：名字里整个是 {…} 的当旁白，台词里的 {nN} 去掉。
// 资源路径（相对 game/）：
//   背景 bg/<x>            → images/bg/<x>              chara/<角色>/<文件>（3 段）→ images/bg/<角色>_<文件>（旧的静图声明）
//   HCG chara/<角色>/<资源>/<帧>（4 段）→ images/hcg/<角色>/<资源>/<帧>；同名 .webm 存在就当视频播（帧名 1 / 4 不循环，别的循环），否则当图
//   effect/<x> → images/effect/<x>      bgm/<x> → audio/bgm/<x>（.mp3 优先找同名 .ogg）
//   语音 → audio/voice/<剧情文件名>/<语音名>（.mp3 → .ogg）；有的剧情复用别的剧情组的语音（VICTORIA_ca2_h2 引用 VICTORIA_ca1_h2_*）——这里按语音文件名在索引里找，不看目录
//   立绘 charas[i] 里每项是 dic 里的一个字典 { key | chara_id, body | body_file, brow = b, eye = e, lip = r, pos = 0.5, h }：
//        images/stands/<key>/<body>/<key>_<body>_<brow>_<eye>_<lip>[_h].png，找不到按官方的顺序退（brow→b、eye→e、h→不带 h）；每次 charas 非空就整组替换（空 / null = 沿用上一组）
// 没做：others 里 action / emotion 的立绘动作 / 表情特效（只有 others 表里列出的类型有近似映射，见下）、effects、waits、colors 以外的台词样式；这些记在 stats.raw。
// 换场景：一行带 others 里的 bg_change（或背景换了）而这一行没有 charas（= 沿用上一组立绘）时，上一个场景的立绘要收掉（stand.clearOnBgChange，默认 true）。
//   证据（AMRITA_ep6_h，221 行）：charas 只在立绘集合变化的行非空，其余行 None = 沿用；第 37 行 others=['bg_change']、bgs 换成 39、charas=None 一直到第 45 行（新场景），
//   以前的实现只在 charas 非空时才换立绘，上一个场景的人物会一直留在新背景上（用户反馈「进入下一个场景的时候人物没有隐藏掉」）。第 0 行 bg_change 时还没有立绘，不发任何东西。

import { createIndexResolver } from '../resolve.mjs'
import { cleanDir, createOptionsReader, fillTemplate, safeRegex } from './options-merge.mjs'

// 资源目录来自 config.adapterOptions['artwhirl-json']（全部可选，没写 = DEFAULT_OPTIONS = 以前的行为；数组整体替换、对象逐项合并）：
//   root          game 目录（相对媒体目录，默认 'game'）           dirs        索引哪些目录（相对 root）            standZoom   立绘缩放（> 0）
//   dic           { indexFields: [值是整数时当 dic 下标的字段] }   字符串值一律原样；整数才查 dic（dic[n] 不是字符串 / 越界 = 空）。'voices' 也在默认列表里：语音是字符串 = 文件名，是整数 = dic 下标（两种写法都认）
//   assets        [{ match, replace }]：剧情里的资源名 → 相对 game/ 的路径，第一条命中的生效（replace 里 $1 / $& 可用），都不中 = 原样；
//   extPrefer     { '.mp3': ['.ogg'] }：资源名带这个扩展名、索引里有同名的偏好扩展名就用后者（按顺序试；要关掉某一项写空数组）
//   others        { <cmd>: { <type>: 映射, default: 映射 } }：others 里 { cmd, val: { type, target } } 指令怎么处理；映射 = 'raw'（只记 stats.raw[`others:<cmd>:<type>`]，什么都不发）/ 'drop'（忽略，不记）/
//                   一个场景指令对象 / 指令对象数组（用现有的 scene 指令，比如 { op: 'shake', axis, strength, seconds }）；类型表里没有的类型用该 cmd 的 default，cmd 不在表里 = raw。整张表逐 cmd、逐 type 覆盖 / 追加。
//                   已知类型（600 个脚本枚举）：action = bow 1365 / jump 906 / swing 833 / slideinR 261 / vibe 233 / slideinL 87 / attackR 56 / attackD 24 / attackL 23 / slideinD 22 / avoid 12（val.target 几乎总是 1 个 { body_file, chara_id }）；
//                   emotion = shock 740 / sweat 279 / question 179 / donyori 125 / exclamation 115 / anger 53 / paa 45 / kirakira 25。静图立绘的 stand 指令没有「单个部件的动作」（动作只有 spine 指令有），
//                   所以 bow / jump / swing / vibe / avoid 默认近似成整屏一次很轻的抖动（连背景一起动；方向 / 强度 / 时长都是推测值，不想要就把那项改成 'raw'）；slidein* / attack*（位移）和全部 emotion（气泡图标）没有对应指令，记 raw。
//                   没有 type 的指令（val 不是对象 / 没有 type）记成 `others:<cmd>`（和以前一样）。
//   bgChange      { f|c|s|…: { fade 秒 }, default }：others 里 bg_change 的 val（bg_change.val：f 4265 / c 1634 / s 250）→ 换背景的渐变秒数。f = fade 0.5、c = cut 0、s = 当 fade 0.5（含义和秒数都是猜的）；没有 val / 表里没有 = default（0 = 以前的行为）
//   audioExtFallback  [扩展名…]：音频名的扩展名在磁盘上找不到时按顺序换（默认 .ogg .mp3 .wav .m4a .opus .flac；只在原名和 extPrefer 都找不到时才试；[] = 不试）。只对资源名（bgm / se 等）生效，语音另见 voice.extFallback；stats.bgm = { referenced, resolved, unresolved }
//   stand         { clearOnBgChange（上面「换场景」，默认 true；false = 以前的行为）, path 模板（{key} {body} {brow} {eye} {lip} {h}）, fields { 字段: [候选键名…] }, defaults { brow, eye, lip }, hSuffix,
//                   fallback [[替换…]…] 找不到时按顺序试：每项是一组 '字段->值' 替换（值空 = 去掉，如 'h->'）同时生效 }
//   hcg           { match：哪些资源名是 HCG（图 / 视频）, imageExts }          video { ext: [同名视频扩展名], noLoopFrames: [不循环的帧名], frameSplit }
//   voice         { dir 语音目录, preferDirs 同名语音挑哪个目录, ext { '.mp3': '.ogg' } 语音名扩展名换算（要关掉某一项写空串；换算后的名字在索引里没有时，再试脚本里写的原名）， fallback 没有索引时的路径模板（{stem} {name}）,
//                   nameFields 语音值解出来是字典时，文件名取哪个键（按顺序，默认 ['file', 'name', 'voice']）, extFallback 原名也没有时按顺序换这些扩展名再找同名文件（默认 [] = 不试）}
//                   stats.voices = { referenced 引用了几次, resolved 在索引里找到, unresolved 没找到, guessed 没有索引时按 fallback 拼的 }；找不到的名字记在 stats.unresolved['voice:<名>']，dic 下标越界 / 解不出字符串记 'voice:#<n>'
export const ADAPTER_ID = 'artwhirl-json'
export const DEFAULT_OPTIONS = {
  root: 'game',
  dirs: ['images', 'audio'],
  standZoom: 1,
  dic: { indexFields: ['bgs', 'bgms', 'charas', 'names', 'colors', 'voices'] },
  assets: [
    { match: '^(?:bg|effect)/', replace: 'images/$&' },
    { match: '^chara/([^/]+)/([^/]+)/*$', replace: 'images/bg/$1_$2' },
    { match: '^chara/(.*)$', replace: 'images/hcg/$1' },
    { match: '^bgm/', replace: 'audio/$&' },
  ],
  extPrefer: { '.mp3': ['.ogg'] },
  // others 里 action / emotion 的类型表（全量枚举见 README；立绘是静图，没有「单个部件的动作」，近似成整屏一次很轻的抖动，数值都是推测）
  others: {
    action: {
      bow: [{ op: 'shake', axis: 'vertical', strength: 0.08, seconds: 0.5 }],
      jump: [{ op: 'shake', axis: 'vertical', strength: 0.12, seconds: 0.4 }],
      swing: [{ op: 'shake', axis: 'horizontal', strength: 0.1, seconds: 0.4 }],
      vibe: [{ op: 'shake', axis: 'horizontal', strength: 0.15, seconds: 0.5 }],
      avoid: [{ op: 'shake', axis: 'horizontal', strength: 0.1, seconds: 0.3 }],
      slideinR: 'raw', slideinL: 'raw', slideinD: 'raw', attackR: 'raw', attackL: 'raw', attackD: 'raw',
      default: 'raw',
    },
    emotion: { shock: 'raw', sweat: 'raw', question: 'raw', donyori: 'raw', exclamation: 'raw', anger: 'raw', paa: 'raw', kirakira: 'raw', default: 'raw' },
  },
  // bg_change 的 val（背景怎么切）→ 换背景的渐变秒数；没有 val / 表里没有的用 default。f / c / s 的含义是猜的（fade / cut / slide），s 当 fade 处理
  bgChange: { f: { fade: 0.5 }, c: { fade: 0 }, s: { fade: 0.5 }, default: { fade: 0 } },
  // 音频文件扩展名不对（名字 .mp3、磁盘上是别的）时按这个顺序换同名文件找；只在原名 / extPrefer / 引擎的 extensionFallbacks 都找不到时才试；清空 = 不试
  audioExtFallback: ['.ogg', '.mp3', '.wav', '.m4a', '.opus', '.flac'],
  stand: {
    clearOnBgChange: true,
    path: 'images/stands/{key}/{body}/{key}_{body}_{brow}_{eye}_{lip}{h}.png',
    fields: { key: ['key', 'chara_id'], body: ['body', 'body_file'], brow: ['brow'], eye: ['eye'], lip: ['lip'], pos: ['pos'], h: ['h'] },
    defaults: { brow: 'b', eye: 'e', lip: 'r' },
    hSuffix: '_h',
    fallback: [['h->'], ['brow->b'], ['brow->b', 'h->'], ['eye->e'], ['eye->e', 'h->'], ['brow->b', 'eye->e'], ['brow->b', 'eye->e', 'h->']],
  },
  hcg: { match: '^chara/[^/]+/[^/]+/[^/]+$', imageExts: ['.png', '.jpg', '.webp'] },
  video: { ext: ['webm'], noLoopFrames: ['1', '4'], frameSplit: '@' },
  voice: { dir: 'audio/voice', preferDirs: [], ext: { '.mp3': '.ogg' }, fallback: 'audio/voice/{stem}/{name}', nameFields: ['file', 'name', 'voice'], extFallback: [] },
}
// others 是「cmd → type → 映射」的自由表（映射可以是字符串 / 对象 / 数组，通用合并按默认值的类型卡会吞掉改成 'raw' 的项）：单独按 cmd、按 type 逐项合并
const { others: DEFAULT_OTHERS, ...OTHER_DEFAULTS } = DEFAULT_OPTIONS
const baseReader = createOptionsReader(OTHER_DEFAULTS)
const isTable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
function mergeOthers(given) {
  const out = structuredClone(DEFAULT_OTHERS)
  if (!isTable(given)) return out
  for (const [cmd, table] of Object.entries(given)) {
    if (cmd === '__proto__' || !isTable(table)) continue
    out[cmd] = { ...(out[cmd] || {}) }
    for (const [type, mapping] of Object.entries(table)) if (type !== '__proto__' && mapping !== undefined) out[cmd][type] = structuredClone(mapping)
  }
  return out
}
const optionsCache = new WeakMap()
const optionsOf = (options) => {
  const base = baseReader(options)
  const source = isTable(options) ? options : null
  const key = source || base
  if (!optionsCache.has(key)) optionsCache.set(key, { ...base, others: mergeOthers(source?.others) })
  return optionsCache.get(key)
}
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => cleanDir(optionsOf(options).root)

const HEAD = /^\s*\{\s*"bgms"\s*:\s*\[/
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 8192)
  return HEAD.test(head) && /"chara_keys"\s*:/.test(head)
}

// 规整后的参数 → 编译好的规则（同一份参数只编译一次）
const compiledCache = new WeakMap()
function compiled(opt) {
  if (compiledCache.has(opt)) return compiledCache.get(opt)
  const out = {
    assets: opt.assets.map((rule) => ({ re: safeRegex(rule?.match), replace: String(rule?.replace ?? '') })).filter((rule) => rule.re),
    hcg: safeRegex(opt.hcg.match),
    dic: new Set(opt.dic.indexFields),
    audioExts: opt.audioExtFallback.map((ext) => `.${String(ext).replace(/^\./, '')}`),
    voiceExts: opt.voice.extFallback.map((ext) => `.${String(ext).replace(/^\./, '')}`),
    extPrefer: new Map(Object.entries(opt.extPrefer).map(([from, to]) => [from.toLowerCase(), [].concat(to)])),
    voiceExt: new Map(Object.entries(opt.voice.ext).filter(([, to]) => to).map(([from, to]) => [from.toLowerCase(), String(to)])),
    stand: opt.stand.fallback.map((combo) => (Array.isArray(combo) ? combo : [combo]).map((sub) => String(sub).split('->')).filter((pair) => pair.length === 2)),
  }
  compiledCache.set(opt, out)
  return out
}

// ---------- 上下文：图片 / 音频索引 ----------
export const contextFiles = () => []
export const contextDirs = (options) => optionsOf(options).dirs.map((dir) => joinPath(rootOf(options), cleanDir(dir)))

export function prepare({ options, files, toResourcePath, resourceResolve }) {
  const opt = optionsOf(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  const voiceIndex = new Set()   // 语音目录下的资源路径（只知道文件名：同名的按 voice.preferDirs 挑）
  const voicePrefix = `${cleanDir(opt.voice.dir)}/`.toLowerCase()
  for (const rel of files || []) {
    const res = toRes(rel)
    resources.add(res)
    if (res.toLowerCase().startsWith(voicePrefix)) voiceIndex.add(res)
  }
  const resolver = createIndexResolver({ index: resources, cfg: resourceResolve })
  const voices = createIndexResolver({ index: voiceIndex, cfg: resourceResolve, preferDirs: opt.voice.preferDirs.length ? opt.voice.preferDirs : null })
  return { opts: opt, resources, resolver, voices, hasIndex: Boolean(files?.length), standZoom: opt.standZoom > 0 ? opt.standZoom : 1 }
}

// ---------- 解析 ----------
const str = (value) => (value === null || value === undefined ? '' : String(value))
// 语音值（dic 解过的）→ 文件名：字符串原样（去空白）；字典取 nameFields 里第一个非空字符串；别的（null / 数字 / 布尔 / 数组）= 没有
function voiceName(v, nameFields) {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)   // voices 不在 dic.indexFields 里时整数就是文件名本身（以前的行为）
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const key of nameFields) if (typeof v[key] === 'string' && v[key].trim()) return v[key].trim()
  return ''
}
const STRIP_RENPY_TAGS = /\{(?:\/?[a-z]+(?:=[^}]*)?|w(?:=[\d.]*)?|nw|p|fast)\}/gi

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || optionsOf(meta?.options)
  const rx = compiled(opt)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || !Array.isArray(data.texts)) throw new Error('找不到 texts（不是 ArtWhirl 的剧情 JSON）')
  const dic = Array.isArray(data.dic) ? data.dic : []
  const total = data.texts.length
  const stats = { rows: total, commands: 0, raw: {}, unresolved: {}, stands: 0, voices: { referenced: 0, resolved: 0, unresolved: 0, guessed: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, mapped: {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  // 官方：整数 = dic 下标（bool 不算）；只有 dic.indexFields 里的字段才这样解
  const value = (field, v) => (rx.dic.has(field) && Number.isInteger(v) ? (v >= 0 && v < dic.length ? dic[v] : null) : v)
  const at = (key, i) => (Array.isArray(data[key]) ? data[key][i] : undefined)
  // 索引里真实存在的路径（原样的键）；没有索引时不过滤，原样返回
  const lookup = (res) => (ctx?.hasIndex ? ctx.resolver.resolve(res) : res)
  const has = (res) => Boolean(ctx?.hasIndex && ctx.resolver.resolve(res))
  const stem = String(meta?.stem || '')
  const extOf = (rel) => /\.[^./]+$/.exec(rel)?.[0] || ''

  // 资源名 → 相对 game/ 的路径（assets 规则，第一条命中的）；扩展名偏好（extPrefer：.mp3 优先找同名 .ogg）
  const assetOf = (resource) => {
    const r = str(resource).replace(/\\/g, '/')
    if (!r) return ''
    const rule = rx.assets.find((item) => item.re.test(r))
    const rel = rule ? r.replace(rule.re, rule.replace) : r
    if (ctx?.hasIndex) {
      const ext = extOf(rel)
      for (const alt of rx.extPrefer.get(ext.toLowerCase()) || []) { const hit = lookup(rel.slice(0, rel.length - ext.length) + alt); if (hit) return hit }
      // 都没有：音频名按 audioExtFallback 换扩展名再找（只对音频扩展名生效）
      if (rx.audioExts.includes(ext.toLowerCase()) && !lookup(rel)) {
        for (const alt of rx.audioExts) { if (alt === ext.toLowerCase()) continue; const hit = lookup(rel.slice(0, rel.length - ext.length) + alt); if (hit) return hit }
      }
    }
    return rel
  }

  const steps = []
  let commands = []
  let pendingCurBg = null
  let curBgm = null
  let standOn = false
  let speaker = ''
  const emit = (command) => commands.push(command)
  const rawKeys = (character, names) => { for (const name of names) if (character[name] !== undefined) return character[name]; return undefined }
  const truthyKey = (character, names) => { for (const name of names) if (character[name]) return character[name]; return '' }

  for (let i = 0; i < total; i++) {
    const rawText = at('texts', i)
    const rowCommands = Array.isArray(at('others', i)) ? at('others', i) : []
    const otherOps = []   // others 表映射出来的场景指令（立绘之后发）
    for (const c of rowCommands) {
      if (!c || !c.cmd || c.cmd === 'bg_change') continue
      const type = typeof c.val?.type === 'string' ? c.val.type : ''
      const label = type ? `others:${c.cmd}:${type}` : `others:${c.cmd}`
      const table = Object.hasOwn(opt.others, c.cmd) ? opt.others[c.cmd] : null
      const mapping = table ? (type && Object.hasOwn(table, type) ? table[type] : table.default) : 'raw'
      if (mapping === 'drop') continue
      const ops = (Array.isArray(mapping) ? mapping : mapping && typeof mapping === 'object' ? [mapping] : []).filter((op) => op && typeof op.op === 'string')
      if (!ops.length) { count('raw', label); continue }
      otherOps.push(...ops.map((op) => ({ ...op })))
      count('mapped', label)
    }
    if (at('effects', i) !== null && at('effects', i) !== undefined) count('raw', 'effects')

    // --- 背景 ---
    const background = value('bgs', at('bgs', i))
    const changed = rowCommands.some((c) => c && c.cmd === 'bg_change')
    const sceneChanged = Boolean(background) && (changed || background !== pendingCurBg)
    const bgFade = (() => {   // bg_change 的 val（f / c / s）→ bgChange 表里的渐变秒数
      const key = String(rowCommands.find((c) => c && c.cmd === 'bg_change')?.val ?? '')
      const entry = key && key !== 'default' && Object.hasOwn(opt.bgChange, key) ? opt.bgChange[key] : opt.bgChange.default
      const seconds = Number(entry?.fade)
      return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 10) : 0
    })()
    if (sceneChanged) {
      const rel = assetOf(background)
      if (rx.hcg?.test(str(background).replace(/^\/+|\/+$/g, ''))) {
        // HCG：同名视频（video.ext）存在就当视频播；帧名（最后一段）在 video.noLoopFrames 里不循环
        const base = rel.replace(/\.[^./]+$/, '')   // 资源名可能带扩展名也可能不带
        const movies = ctx?.hasIndex ? opt.video.ext.map((ext) => `${base}.${String(ext).replace(/^\./, '')}`).map(lookup).filter(Boolean) : []
        const frame = base.split('/').pop().split(opt.video.frameSplit || '@')[0]
        const still = extOf(rel) ? rel : opt.hcg.imageExts.map((ext) => base + ext).find((candidate) => has(candidate)) || `${base}${opt.hcg.imageExts[0] || '.png'}`
        const stillHit = lookup(still)
        if (movies.length) emit({ op: 'movie', srcs: movies, loop: !opt.video.noLoopFrames.map(String).includes(frame) })
        else if (stillHit) emit({ op: 'bg', src: stillHit, fade: bgFade })
        else count('unresolved', `hcg:${background}`)
      } else if (lookup(rel)) emit({ op: 'bg', src: lookup(rel), fade: bgFade })
      else count('unresolved', `bg:${background}`)
      pendingCurBg = background
    }

    // --- BGM ---
    const bgm = value('bgms', at('bgms', i))
    if (bgm !== curBgm) {
      if (bgm) {
        const rel = lookup(assetOf(bgm))
        stats.bgm.referenced += 1
        if (rel) { emit({ op: 'bgm', src: rel }); stats.bgm.resolved += 1 } else { count('unresolved', `bgm:${bgm}`); stats.bgm.unresolved += 1 }
      } else emit({ op: 'bgmStop', fade: 0 })
      curBgm = bgm
    }

    // --- 立绘 ---
    const charas = at('charas', i)
    if (Array.isArray(charas) && charas.length) {
      const parts = []
      for (const index of charas) {
        const character = value('charas', index)
        if (!character || typeof character !== 'object') continue
        const f = opt.stand.fields
        const vars = {
          key: str(truthyKey(character, f.key)),
          body: str(truthyKey(character, f.body)),
          brow: str(truthyKey(character, f.brow) || opt.stand.defaults.brow),
          eye: str(truthyKey(character, f.eye) || opt.stand.defaults.eye) || opt.stand.defaults.eye,
          lip: str(truthyKey(character, f.lip) || opt.stand.defaults.lip),
          h: truthyKey(character, f.h) ? opt.stand.hSuffix : '',
        }
        if (!vars.key || !vars.body) continue
        const tried = []
        for (const combo of [[], ...rx.stand]) {
          const rel = fillTemplate(opt.stand.path, combo.reduce((acc, [name, to]) => ({ ...acc, [name]: name === 'h' && to === '' ? '' : to }), vars))
          if (!tried.includes(rel)) tried.push(rel)
        }
        const found = ctx?.hasIndex ? tried.map(lookup).find(Boolean) : tried[0]
        if (!found) { count('unresolved', `stand:${vars.key}/${vars.body}`); continue }
        const pos = Number.parseFloat(rawKeys(character, f.pos))
        parts.push({ src: found, xalign: Number.isFinite(pos) ? Math.max(0, Math.min(1, pos)) : 0.5, ...(ctx?.standZoom && ctx.standZoom !== 1 ? { zoom: ctx.standZoom } : {}) })
      }
      if (parts.length) { emit({ op: 'stand', parts }); standOn = true; stats.stands += 1 } else if (standOn) { emit({ op: 'standOff' }); standOn = false }
    } else if (opt.stand.clearOnBgChange && standOn && sceneChanged) {
      // 新场景（bg_change / 背景换了）而这一行没有新的立绘集合：上一个场景的人物收掉
      emit({ op: 'standOff' })
      standOn = false
    }
    for (const op of otherOps) emit(op)

    // --- 语音：字符串 = 文件名；整数 = dic 下标（dic[n] 是字符串 = 文件名；字典 = 取 voice.nameFields 里第一个字符串）；空 / null = 没有 ---
    const voiceRaw = value('voices', at('voices', i))
    const voice = voiceName(voiceRaw, opt.voice.nameFields)
    if (voice) {
      stats.voices.referenced += 1
      const ext = extOf(voice).toLowerCase()
      const wanted = rx.voiceExt.has(ext) ? voice.slice(0, voice.length - ext.length) + rx.voiceExt.get(ext) : voice
      let found = ctx?.voices?.resolveByName(wanted)
      if (!found && ctx?.hasIndex && wanted !== voice) found = ctx.voices.resolveByName(voice)   // 换算后（.ogg）没有 → 试脚本里写的原名（.mp3）
      if (!found && ctx?.hasIndex && rx.voiceExts.length) {
        const base = wanted.slice(0, wanted.length - extOf(wanted).length)
        for (const alt of rx.voiceExts) { found = ctx.voices.resolveByName(base + alt); if (found) break }
      }
      if (found) { emit({ op: 'voice', src: found }); stats.voices.resolved += 1 } else if (ctx?.hasIndex) { count('unresolved', `voice:${wanted}`); stats.voices.unresolved += 1 } else { emit({ op: 'voice', src: fillTemplate(opt.voice.fallback, { stem, name: wanted }) }); stats.voices.guessed += 1 }
    } else if (rx.dic.has('voices') && Number.isInteger(at('voices', i)) && voiceRaw === null) {
      // 整数下标指向 null（= 这行没有语音，正常）或越界（脚本和 dic 不一致）：只有越界才记
      if (at('voices', i) < 0 || at('voices', i) >= dic.length) { stats.voices.referenced += 1; stats.voices.unresolved += 1; count('unresolved', `voice:#${at('voices', i)}`) }
    }
    // --- 台词：null = 只放指令（并进下一句）---
    if (rawText === null || rawText === undefined) continue
    const body = str(rawText).replace(/\{n\d+\}/g, '').replace(STRIP_RENPY_TAGS, '')
    const nameValue = at('names', i) === null || at('names', i) === undefined ? null : value('names', at('names', i))
    const name = nameValue !== null && nameValue !== undefined && !(/^\{.*\}$/.test(str(nameValue))) ? str(nameValue) : ''
    const colorValue = at('colors', i) === null || at('colors', i) === undefined ? null : str(value('colors', at('colors', i)))
    const colorKey = `${name}|${colorValue || ''}`
    if (colorKey !== speaker) {
      emit({ op: 'speaker', segments: name ? [{ text: name, ...(colorValue && /^#[0-9a-f]{3,8}$/i.test(colorValue) ? { style: { color: colorValue } } : {}) }] : [] })
      speaker = colorKey
    }
    emit({ op: 'text', segments: body ? [{ text: body }] : [] })
    stats.commands += commands.length
    steps.push({ index: steps.length, commands })
    commands = []
  }
  if (commands.length) {
    if (steps.length) { steps[steps.length - 1].commands.push(...commands); stats.commands += commands.length } else { steps.push({ index: 0, commands: [...commands, { op: 'text', segments: [] }] }); stats.commands += commands.length }
  }
  return { steps, stats }
}

export const artwhirlJsonAdapter = { id: ADAPTER_ID, label: 'ArtWhirl（魔法学园的少女们）剧情 JSON', sniff, parse, contextFiles, contextDirs, prepare }
