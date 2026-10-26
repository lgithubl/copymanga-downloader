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
// 没做：others 里的 action / emotion（立绘动作 / 表情特效）、effects、waits、colors 以外的台词样式；这些记在 stats.raw。

import { createIndexResolver } from '../resolve.mjs'
import { cleanDir, createOptionsReader, fillTemplate, safeRegex } from './options-merge.mjs'

// 资源目录来自 config.adapterOptions['artwhirl-json']（全部可选，没写 = DEFAULT_OPTIONS = 以前的行为；数组整体替换、对象逐项合并）：
//   root          game 目录（相对媒体目录，默认 'game'）           dirs        索引哪些目录（相对 root）            standZoom   立绘缩放（> 0）
//   dic           { indexFields: [值是整数时当 dic 下标的字段] }
//   assets        [{ match, replace }]：剧情里的资源名 → 相对 game/ 的路径，第一条命中的生效（replace 里 $1 / $& 可用），都不中 = 原样；
//   extPrefer     { '.mp3': ['.ogg'] }：资源名带这个扩展名、索引里有同名的偏好扩展名就用后者（按顺序试；要关掉某一项写空数组）
//   stand         { path 模板（{key} {body} {brow} {eye} {lip} {h}）, fields { 字段: [候选键名…] }, defaults { brow, eye, lip }, hSuffix,
//                   fallback [[替换…]…] 找不到时按顺序试：每项是一组 '字段->值' 替换（值空 = 去掉，如 'h->'）同时生效 }
//   hcg           { match：哪些资源名是 HCG（图 / 视频）, imageExts }          video { ext: [同名视频扩展名], noLoopFrames: [不循环的帧名], frameSplit }
//   voice         { dir 语音目录, preferDirs 同名语音挑哪个目录, ext { '.mp3': '.ogg' } 语音名扩展名换算（要关掉某一项写空串）, fallback 没有索引时的路径模板（{stem} {name}）}
export const ADAPTER_ID = 'artwhirl-json'
export const DEFAULT_OPTIONS = {
  root: 'game',
  dirs: ['images', 'audio'],
  standZoom: 1,
  dic: { indexFields: ['bgs', 'bgms', 'charas', 'names', 'colors'] },
  assets: [
    { match: '^(?:bg|effect)/', replace: 'images/$&' },
    { match: '^chara/([^/]+)/([^/]+)/*$', replace: 'images/bg/$1_$2' },
    { match: '^chara/(.*)$', replace: 'images/hcg/$1' },
    { match: '^bgm/', replace: 'audio/$&' },
  ],
  extPrefer: { '.mp3': ['.ogg'] },
  stand: {
    path: 'images/stands/{key}/{body}/{key}_{body}_{brow}_{eye}_{lip}{h}.png',
    fields: { key: ['key', 'chara_id'], body: ['body', 'body_file'], brow: ['brow'], eye: ['eye'], lip: ['lip'], pos: ['pos'], h: ['h'] },
    defaults: { brow: 'b', eye: 'e', lip: 'r' },
    hSuffix: '_h',
    fallback: [['h->'], ['brow->b'], ['brow->b', 'h->'], ['eye->e'], ['eye->e', 'h->'], ['brow->b', 'eye->e'], ['brow->b', 'eye->e', 'h->']],
  },
  hcg: { match: '^chara/[^/]+/[^/]+/[^/]+$', imageExts: ['.png', '.jpg', '.webp'] },
  video: { ext: ['webm'], noLoopFrames: ['1', '4'], frameSplit: '@' },
  voice: { dir: 'audio/voice', preferDirs: [], ext: { '.mp3': '.ogg' }, fallback: 'audio/voice/{stem}/{name}' },
}
const optionsOf = createOptionsReader(DEFAULT_OPTIONS)
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
const STRIP_RENPY_TAGS = /\{(?:\/?[a-z]+(?:=[^}]*)?|w(?:=[\d.]*)?|nw|p|fast)\}/gi

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || optionsOf(meta?.options)
  const rx = compiled(opt)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || !Array.isArray(data.texts)) throw new Error('找不到 texts（不是 ArtWhirl 的剧情 JSON）')
  const dic = Array.isArray(data.dic) ? data.dic : []
  const total = data.texts.length
  const stats = { rows: total, commands: 0, raw: {}, unresolved: {}, stands: 0 }
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
    for (const c of rowCommands) if (c && c.cmd && c.cmd !== 'bg_change') count('raw', `others:${c.cmd}`)
    if (at('effects', i) !== null && at('effects', i) !== undefined) count('raw', 'effects')

    // --- 背景 ---
    const background = value('bgs', at('bgs', i))
    const changed = rowCommands.some((c) => c && c.cmd === 'bg_change')
    if (background && (changed || background !== pendingCurBg)) {
      const rel = assetOf(background)
      if (rx.hcg?.test(str(background).replace(/^\/+|\/+$/g, ''))) {
        // HCG：同名视频（video.ext）存在就当视频播；帧名（最后一段）在 video.noLoopFrames 里不循环
        const base = rel.replace(/\.[^./]+$/, '')   // 资源名可能带扩展名也可能不带
        const movies = ctx?.hasIndex ? opt.video.ext.map((ext) => `${base}.${String(ext).replace(/^\./, '')}`).map(lookup).filter(Boolean) : []
        const frame = base.split('/').pop().split(opt.video.frameSplit || '@')[0]
        const still = extOf(rel) ? rel : opt.hcg.imageExts.map((ext) => base + ext).find((candidate) => has(candidate)) || `${base}${opt.hcg.imageExts[0] || '.png'}`
        const stillHit = lookup(still)
        if (movies.length) emit({ op: 'movie', srcs: movies, loop: !opt.video.noLoopFrames.map(String).includes(frame) })
        else if (stillHit) emit({ op: 'bg', src: stillHit, fade: 0 })
        else count('unresolved', `hcg:${background}`)
      } else if (lookup(rel)) emit({ op: 'bg', src: lookup(rel), fade: 0 })
      else count('unresolved', `bg:${background}`)
      pendingCurBg = background
    }

    // --- BGM ---
    const bgm = value('bgms', at('bgms', i))
    if (bgm !== curBgm) {
      if (bgm) {
        const rel = lookup(assetOf(bgm))
        if (rel) emit({ op: 'bgm', src: rel }); else count('unresolved', `bgm:${bgm}`)
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
    }

    // --- 语音 ---
    const voice = str(at('voices', i))
    if (voice) {
      const ext = extOf(voice).toLowerCase()
      const wanted = rx.voiceExt.has(ext) ? voice.slice(0, voice.length - ext.length) + rx.voiceExt.get(ext) : voice
      const found = ctx?.voices?.resolveByName(wanted)
      if (found) emit({ op: 'voice', src: found })
      else if (ctx?.hasIndex) count('unresolved', `voice:${wanted}`)
      else emit({ op: 'voice', src: fillTemplate(opt.voice.fallback, { stem, name: wanted }) })
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
