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
// 资源目录来自 config.adapterOptions['artwhirl-json']：{ root（game 目录，相对媒体目录，默认 'game'）, standZoom（立绘缩放，默认 1） }

export const ADAPTER_ID = 'artwhirl-json'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => String(options?.root ?? 'game').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

const HEAD = /^\s*\{\s*"bgms"\s*:\s*\[/
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 8192)
  return HEAD.test(head) && /"chara_keys"\s*:/.test(head)
}

// ---------- 上下文：图片 / 音频索引 ----------
export const contextFiles = () => []
export const contextDirs = (options) => ['images', 'audio'].map((dir) => joinPath(rootOf(options), dir))

export function prepare({ options, files, toResourcePath }) {
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  const voices = new Map()   // 语音文件名（小写）→ 资源路径
  for (const rel of files || []) {
    const res = toRes(rel)
    resources.add(res)
    const m = /^audio\/voice\/(?:.+\/)?([^/]+)$/i.exec(res)
    if (m && !voices.has(m[1].toLowerCase())) voices.set(m[1].toLowerCase(), res)
  }
  return { resources, voices, hasIndex: Boolean(files?.length), standZoom: Number(options?.standZoom) > 0 ? Number(options.standZoom) : 1 }
}

// ---------- 解析 ----------
const str = (value) => (value === null || value === undefined ? '' : String(value))
const STRIP_RENPY_TAGS = /\{(?:\/?[a-z]+(?:=[^}]*)?|w(?:=[\d.]*)?|nw|p|fast)\}/gi

export function parse(text, ctx = null, meta = {}) {
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || !Array.isArray(data.texts)) throw new Error('找不到 texts（不是 ArtWhirl 的剧情 JSON）')
  const dic = Array.isArray(data.dic) ? data.dic : []
  const total = data.texts.length
  const stats = { rows: total, commands: 0, raw: {}, unresolved: {}, stands: 0 }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const value = (v) => (Number.isInteger(v) ? (v >= 0 && v < dic.length ? dic[v] : null) : v)   // 官方：整数 = dic 下标（bool 不算）
  const at = (key, i) => (Array.isArray(data[key]) ? data[key][i] : undefined)
  const exists = (res) => (ctx?.hasIndex ? ctx.resources.has(res) : true)
  const has = (res) => Boolean(ctx?.resources?.has(res))
  const stem = String(meta?.stem || '')

  // 资源名 → 相对 game/ 的路径（和官方 _json_story_asset 一样）；.mp3 优先找同名 .ogg
  const assetOf = (resource) => {
    const r = str(resource).replace(/\\/g, '/')
    if (!r) return ''
    let rel
    if (r.startsWith('bg/')) rel = `images/${r}`
    else if (r.startsWith('chara/')) {
      const parts = r.replace(/^\/+|\/+$/g, '').split('/')
      rel = parts.length === 3 ? `images/bg/${parts[1]}_${parts[2]}` : `images/hcg/${r.slice('chara/'.length)}`
    } else if (r.startsWith('effect/')) rel = `images/${r}`
    else if (r.startsWith('bgm/')) rel = `audio/${r}`
    else rel = r
    if (/\.mp3$/i.test(rel) && ctx?.hasIndex && has(rel.replace(/\.mp3$/i, '.ogg'))) return rel.replace(/\.mp3$/i, '.ogg')
    return rel
  }

  const steps = []
  let commands = []
  let pendingCurBg = null
  let curBgm = null
  let standOn = false
  let speaker = ''
  const emit = (command) => commands.push(command)

  for (let i = 0; i < total; i++) {
    const rawText = at('texts', i)
    const rowCommands = Array.isArray(at('others', i)) ? at('others', i) : []
    for (const c of rowCommands) if (c && c.cmd && c.cmd !== 'bg_change') count('raw', `others:${c.cmd}`)
    if (at('effects', i) !== null && at('effects', i) !== undefined) count('raw', 'effects')

    // --- 背景 ---
    const background = value(at('bgs', i))
    const changed = rowCommands.some((c) => c && c.cmd === 'bg_change')
    if (background && (changed || background !== pendingCurBg)) {
      const rel = assetOf(background)
      if (str(background).startsWith('chara/') && str(background).replace(/^\/+|\/+$/g, '').split('/').length === 4) {
        // HCG：同名 .webm 存在就当视频播；帧名（最后一段）1 / 4 不循环
        const base = rel.replace(/\.[^./]+$/, '')   // 资源名可能带扩展名也可能不带
        const movie = `${base}.webm`
        const frame = base.split('/').pop().split('@')[0]
        const still = /\.[^./]+$/.test(rel) ? rel : ['.png', '.jpg', '.webp'].map((ext) => base + ext).find((candidate) => has(candidate)) || `${base}.png`
        if (ctx?.hasIndex && has(movie)) emit({ op: 'movie', srcs: [movie], loop: !['1', '4'].includes(frame) })
        else if (exists(still)) emit({ op: 'bg', src: still, fade: 0 })
        else count('unresolved', `hcg:${background}`)
      } else if (exists(rel)) emit({ op: 'bg', src: rel, fade: 0 })
      else count('unresolved', `bg:${background}`)
      pendingCurBg = background
    }

    // --- BGM ---
    const bgm = value(at('bgms', i))
    if (bgm !== curBgm) {
      if (bgm) {
        const rel = assetOf(bgm)
        if (exists(rel)) emit({ op: 'bgm', src: rel }); else count('unresolved', `bgm:${bgm}`)
      } else emit({ op: 'bgmStop', fade: 0 })
      curBgm = bgm
    }

    // --- 立绘 ---
    const charas = at('charas', i)
    if (Array.isArray(charas) && charas.length) {
      const parts = []
      for (const index of charas) {
        const character = value(index)
        if (!character || typeof character !== 'object') continue
        const key = str(character.key || character.chara_id)
        const body = str(character.body || character.body_file)
        if (!key || !body) continue
        const brow = str(character.brow || 'b')
        const eye = str(character.eye || 'e') || 'e'
        const lip = str(character.lip || 'r')
        const isH = Boolean(character.h)
        const tried = []
        for (const [b, e, h] of [[brow, eye, isH], [brow, eye, false], ['b', eye, isH], ['b', eye, false], [brow, 'e', isH], [brow, 'e', false], ['b', 'e', isH], ['b', 'e', false]]) {
          const rel = `images/stands/${key}/${body}/${key}_${body}_${b}_${e}_${lip}${h ? '_h' : ''}.png`
          if (!tried.includes(rel)) tried.push(rel)
        }
        const found = ctx?.hasIndex ? tried.find((rel) => has(rel)) : tried[0]
        if (!found) { count('unresolved', `stand:${key}/${body}`); continue }
        const pos = Number.parseFloat(character.pos)
        parts.push({ src: found, xalign: Number.isFinite(pos) ? Math.max(0, Math.min(1, pos)) : 0.5, ...(ctx?.standZoom && ctx.standZoom !== 1 ? { zoom: ctx.standZoom } : {}) })
      }
      if (parts.length) { emit({ op: 'stand', parts }); standOn = true; stats.stands += 1 } else if (standOn) { emit({ op: 'standOff' }); standOn = false }
    }

    // --- 语音 ---
    const voice = str(at('voices', i))
    if (voice) {
      const wanted = voice.replace(/\.mp3$/i, '.ogg')
      const found = ctx?.voices?.get(wanted.toLowerCase())
      if (found) emit({ op: 'voice', src: found })
      else if (ctx?.hasIndex) count('unresolved', `voice:${wanted}`)
      else emit({ op: 'voice', src: `audio/voice/${stem}/${wanted}` })
    }

    // --- 台词：null = 只放指令（并进下一句）---
    if (rawText === null || rawText === undefined) continue
    const body = str(rawText).replace(/\{n\d+\}/g, '').replace(STRIP_RENPY_TAGS, '')
    const nameValue = at('names', i) === null || at('names', i) === undefined ? null : value(at('names', i))
    const name = nameValue !== null && nameValue !== undefined && !(/^\{.*\}$/.test(str(nameValue))) ? str(nameValue) : ''
    const colorValue = at('colors', i) === null || at('colors', i) === undefined ? null : str(value(at('colors', i)))
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
