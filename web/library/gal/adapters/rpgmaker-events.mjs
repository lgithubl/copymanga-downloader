import { safeRegex } from './options-merge.mjs'

const v = id => `rpg:v:${Number(id)}`
const s = id => `rpg:s:${Number(id)}`
const literalArgs = text => {
  // JSON literals only, never eval/Function. Game code is untrusted input.
  try { const a = JSON.parse(`[${text}]`); return a.every(x => x === null || ['number', 'string', 'boolean'].includes(typeof x)) ? a : null } catch { return null }
}

export function compileRpgEvents(list, ctx, meta) {
  const o = meta.options, stage = ctx.stage || o.stage, steps = [], stats = { commands: 0, text: 0, choices: 0, raw: {}, warnings: [...(ctx.warnings || [])], scene: meta.scene }
  const initial = new Map(), calls = [], guards = [], pictures = new Map()
  const cgMatch = safeRegex(o.pictures.cgMatch), bgMatch = safeRegex(o.pictures.backgroundMatch)
  let pending = [], serial = 0, standingHold = false
  const flush = () => { if (pending.length) { steps.push({ index: steps.length, commands: pending }); pending = [] } }
  const when = () => guards.flatMap(g => g.conditions || [])
  const emit = cmd => { if ((stats.emitted = (stats.emitted || 0) + 1) > o.maxCommands) throw new Error('RPG Maker 导出指令达到上限'); const w = when(); pending.push(w.length ? { ...cmd, when: [...w] } : cmd) }
  const raw = (key, args) => { stats.raw[key] = (stats.raw[key] || 0) + 1; emit({ op: 'raw', cmd: key, args: JSON.stringify(args).slice(0, 1000) }) }
  const variable = (id, kind = 'v') => { const key = kind === 's' ? s(id) : v(id); let value = (kind === 's' ? o.initialSwitches : o.initialVariables)[id] ?? 0; if (kind === 's' && typeof value === 'boolean') value = Number(value); if (!initial.has(key)) initial.set(key, value); return key }
  const resource = (folder, name, ext = 'png') => {
    const clean = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!clean || clean.split('/').some(x => x === '..')) return ''
    return `${folder}/${clean.replace(new RegExp(`\\.${ext}$`, 'i'), '')}.${ext}`
  }
  const textParts = text => {
    let value = String(text).replace(/\\N\[(\d+)\]/gi, (_, id) => ctx.actors?.[Number(id)]?.name || `Actor ${id}`)
    value = value.replace(/\\(?:C|I|FS|PX|PY|OW|OC)\[[^\]]*\]/gi, '').replace(/\\[.!|><^{}$]/g, '').replace(/\\G\b/g, ctx.system?.currencyUnit || '')
    const parts = []; let at = 0
    for (const m of value.matchAll(/\\V\[(\d+)\]/gi)) { if (m.index > at) parts.push({ text: value.slice(at, m.index) }); parts.push({ text: '0', var: variable(m[1]) }); at = m.index + m[0].length }
    if (at < value.length) parts.push({ text: value.slice(at) })
    return parts.length ? parts : [{ text: '' }]
  }
  const audio = (kind, sound) => {
    const folder = kind === 'bgm' ? 'bgm' : kind === 'bgse' ? 'bgs' : kind === 'voice' || kind === 'bgvoice' ? 'voice' : kind === 'me' ? 'me' : 'se'
    const src = resource(sound?.folder || (kind === 'voice' || kind === 'bgvoice' ? ctx.voiceFolder || 'audio/voice' : 'audio/' + folder), sound?.name, 'ogg')
    if (src) emit({ op: kind === 'me' ? 'se' : kind, src, ...(kind === 'bgvoice' ? { slot: String(sound.slot || '0') } : {}), volume: Math.max(0, Math.min(1, Number(sound.volume ?? 100) / 100)), ...(kind === 'bgse' ? { loop: true } : {}) })
  }
  const picture = (p, move = false) => {
    const id = Number(p[0]), src = move ? '' : resource(o.pictures.folder, p[1])
    if (!move && !src) { emit({ op: 'overlayOff', slot: `rpg-picture-${id}` }); return }
    const offset = 0, origin = Number(p[2]), variablePos = Number(p[3]) === 1
    const x = Number(p[4 - offset]) || 0, y = Number(p[5 - offset]) || 0
    const cmd = { op: 'overlay', slot: `rpg-picture-${id}`, stage, x: x - stage[0] / 2, y: y - stage[1] / 2, anchor: origin ? [0.5, 0.5] : [0, 0], scaleX: Math.abs(Number(p[6 - offset]) || 0) / 100, scaleY: Math.abs(Number(p[7 - offset]) || 0) / 100, alpha: Number(p[8 - offset] ?? 255) / 255, z: id, fit: 'none', flipX: Number(p[6 - offset]) < 0 }
    if (src) { cmd.src = src; pictures.set(id, src); if (cgMatch?.test(src)) cmd.cg = true; else if (bgMatch?.test(src)) cmd.kind = 'bg' }
    if (variablePos) Object.assign(cmd, { xVar: variable(x), yVar: variable(y), xOffset: -stage[0] / 2, yOffset: -stage[1] / 2 })
    emit(cmd)
    if (move && p[11]) emit({ op: 'wait', seconds: Math.min(60, Number(p[10] || 0) / 60) })
  }
  const standing = text => {
    if (!o.plugins.standingPicture) return text
    text = String(text).replace(/\\\\/g, '\\')
    if (!standingHold) for (let n = 1; n <= 8; n++) emit({ op: 'overlayOff', slot: `rpg-standing-${n}` })
    const matches = [...text.matchAll(/\\F([1-8]?|F{1,3})\[([^\]]*)\]/gi)]
    for (const m of matches) {
      const n = /^F+$/i.test(m[1]) ? m[1].length + 1 : Number(m[1]) || 1, item = ctx.standing?.get(m[2]), slot = `rpg-standing-${n}`
      if (!item) { if (!m[2] || m[2] === '0') emit({ op: 'overlayOff', slot }); else raw('standing-missing', m[2]); continue }
      const suffix = (n - 1) % 4 + 1, x = Number(item[suffix === 1 ? 'x' : `x${suffix}`]) || 0, y = Number(item[suffix === 1 ? 'y' : `y${suffix}`]) || 0
      emit({ op: 'overlay', slot, kind: 'stand', src: resource(o.pictures.folder, item.imageName), stage, x: x - stage[0] / 2, y: y - stage[1] / 2, anchor: Number(item.origin) ? [0.5, 0.5] : [0, 0], scaleX: Math.abs(Number(item.scaleX || 100)) / 100, scaleY: Math.abs(Number(item.scaleY || 100)) / 100, alpha: Number(item.opacity ?? 255) / 255, flipX: n % 2 === 0 && Number(item.reverse) < 0, z: -10 + n })
    }
    const hold = /\\FH\[(ON|OFF)\]/i.exec(text); if (hold) standingHold = hold[1].toUpperCase() === 'ON'
    for (const m of text.matchAll(/\\M[1-8F]*\[([^\]]+)\]/gi)) raw('standing-motion', m[1])
    if (hold && !standingHold && !matches.length) for (let n = 1; n <= 8; n++) emit({ op: 'overlayOff', slot: `rpg-standing-${n}` })
    return text.replace(/\\(?:F[1-8]?|F{2,4}|M[1-8]?|M{2,4}|FH|AA)\[[^\]]*\]/gi, '')
  }
  const plugin = text => {
    const words = String(text).trim().split(/\s+/), command = words.shift(), arg = words
    if (/^SV_RESERVE/i.test(command)) { raw('voice-reservation-unhandled', text); return }
    if (/^SV_(?:PLAY|RESERVE)(?:_LOOP)?_VOICE$/i.test(command) && o.plugins.simpleVoice) {
      const loop = /LOOP/i.test(command)
      audio(loop ? 'bgvoice' : 'voice', { name: arg[0], volume: Number(arg[1] || 90), slot: arg[4] || '0' }); return
    }
    if (/^SV_STOP_VOICE$/i.test(command) && o.plugins.simpleVoice) { emit({ op: 'bgvoiceOff', slot: arg[0] || '' }); return }
    if (command === 'LL_StandingPictureMV' && o.plugins.standingPicture) { standing(arg.slice(1).join(' ')); return }
    for (const rule of o.plugins.commands || []) {
      const match = safeRegex(rule.match)?.exec(String(text))
      if (match && ['voice', 'bgvoice', 'bgm', 'se', 'bgse'].includes(rule.op)) { audio(rule.op, { name: match.groups?.name || match[1], folder: rule.folder, volume: 100 }); return }
    }
    raw(`plugin:${command || 'empty'}`, text)
  }
  const script = text => {
    const remaining = text.replace(/\$gameScreen\.(?:showPicture|movePicture|erasePicture|clearPictures)\([^;\n]*\)\s*;?/g, '').replace(/\/\/[^\n]*/g, '').trim()
    if (remaining) { raw('script-unhandled', text); return }
    let count = 0
    if (o.plugins.pictureCalls) for (const m of text.matchAll(/\$gameScreen\.(showPicture|movePicture|erasePicture|clearPictures)\(([^;\n]*)\)\s*;?/g)) {
      const args = literalArgs(m[2]); if (!args) continue
      if (m[1] === 'showPicture') picture([args[0], args[1], args[2], 0, ...args.slice(3)])
      if (m[1] === 'movePicture') picture([args[0], '', args[1], 0, ...args.slice(2)], true)
      if (m[1] === 'erasePicture') emit({ op: 'overlayOff', slot: `rpg-picture-${Number(args[0])}` })
      if (m[1] === 'clearPictures') for (const id of pictures.keys()) emit({ op: 'overlayOff', slot: `rpg-picture-${id}` })
      count++
    }
    // Do not report a compound/loop script as fully implemented after matching
    // a single known call inside it; uncovered source is still diagnosed.
    if (!count || remaining) raw('script-unhandled', text)
  }
  const condition = p => {
    if (p[0] === 0) return { var: variable(p[1], 's'), op: '===', value: p[2] === 0 ? 1 : 0 }
    if (p[0] === 1) return { var: variable(p[1]), op: ['===', '>=', '<=', '>', '<', '!=='][p[4]] || '===', ...(p[2] === 0 ? { value: p[3] } : { valueVar: variable(p[3]) }) }
    raw('condition-unhandled', p)
    return null
  }
  const run = (commands, depth = 0, callId = '') => {
    if (depth > o.maxCallDepth || calls.includes(callId) && callId) { raw('common-event-cycle-or-depth', callId); return }
    calls.push(callId); const guardBase = guards.length, live = `rpg:scope:${serial++}`
    emit({ op: 'set', var: live, value: 1 })
    guards.push({ type: 'scope', indent: -1, conditions: [{ var: live, op: '===', value: 1 }] })
    const labels = new Map(commands.map((c, i) => c.code === 118 ? [String(c.parameters?.[0]), i] : [null, -1]))
    for (let i = 0; i < commands.length; i++) {
      if (++stats.commands > o.maxCommands) throw new Error(`RPG Maker 指令超过 ${o.maxCommands} 上限，停止解析`)
      const c = commands[i], p = c.parameters || [], indent = Number(c.indent || 0)
      if (c.code === 101) {
        const text = []
        while (commands[i + 1]?.code === 401) text.push(String(commands[++i].parameters?.[0] || ''))
        let body = standing(text.join('\n')), name = String(p[4] || '')
        body = body.replace(/\\n<([^>]+)>/gi, (_, who) => { name = who; return '' })
        emit({ op: 'speaker', segments: textParts(name) }); emit({ op: 'text', segments: textParts(body) }); stats.text++; flush(); continue
      }
      if (c.code === 102) {
        flush(); const key = `rpg:choice:${serial++}`, options = (p[0] || []).map((label, n) => ({ value: n + 1, segments: textParts(label) }))
        if (p[1] === -2) options.push({ value: 0, segments: [{ text: '取消' }] })
        emit({ op: 'choice', id: `${steps.length}:${pending.length}`, var: key, options }); stats.choices++; flush()
        guards.push({ indent, type: 'choice', key, conditions: [] }); continue
      }
      if (c.code === 402 || c.code === 403) { const g = [...guards].reverse().find(g => g.type === 'choice' && g.indent === indent); if (g) g.conditions = [{ var: g.key, op: '===', value: c.code === 403 ? 0 : Number(p[0]) + 1 }]; continue }
      if (c.code === 404 || c.code === 412) { const n = guards.findLastIndex(g => g.indent === indent); if (n >= guardBase) guards.splice(n, 1); continue }
      if (c.code === 111) {
        const test = condition(p), key = `rpg:branch:${serial++}`
        if (test) emit({ op: 'set', var: key, test })
        const cond = { var: key, op: '===', value: 1 }
        guards.push({ indent, type: 'if', condition: cond, conditions: [cond] }); continue
      }
      if (c.code === 411) { const g = [...guards].reverse().find(g => g.type === 'if' && g.indent === indent); if (g) g.conditions = [{ ...g.condition, not: true }]; continue }
      if (c.code === 117) { const id = Number(p[0]), inner = ctx.common?.[id]; if (inner?.list) run(inner.list, depth + 1, String(id)); else raw('common-event-missing', id); continue }
      if (c.code === 121) { for (let id = p[0]; id <= Math.min(p[1], p[0] + 10000); id++) emit({ op: 'set', var: variable(id, 's'), value: p[2] === 0 ? 1 : 0 }); continue }
      if (c.code === 122) {
        if (p[3] !== 0 && p[3] !== 1) { raw('variable-operand-unhandled', p); continue }
        for (let id = p[0]; id <= Math.min(p[1], p[0] + 10000); id++) emit({ op: 'set', var: variable(id), calc: ['set', 'add', 'sub', 'mul', 'div', 'mod'][p[2]], ...(p[3] === 0 ? { value: p[4] } : { valueVar: variable(p[4]) }) }); continue
      }
      if (c.code === 231) { picture(p); continue }
      if (c.code === 232) { picture(p, true); continue }
      if (c.code === 235) { emit({ op: 'overlayOff', slot: `rpg-picture-${Number(p[0])}` }); pictures.delete(Number(p[0])); continue }
      if (c.code === 241 || c.code === 245 || c.code === 249 || c.code === 250) { audio(({241:'bgm',245:'bgse',249:'me',250:'se'})[c.code], p[0]); continue }
      if (c.code === 242) { emit({ op: 'bgmStop', fade: Number(p[0] || 0) }); continue }
      if (c.code === 246) { emit({ op: 'bgseStop' }); continue }
      if (c.code === 230) { emit({ op: 'wait', seconds: Math.min(60, Number(p[0] || 0) / 60) }); continue }
      if (c.code === 221 || c.code === 222) { emit({ op: 'fade', to: c.code === 221 ? 'black' : 'clear', seconds: 0.4 }); continue }
      if (c.code === 225) { emit({ op: 'shake', strength: Number(p[0] || 0), seconds: Number(p[2] || 0) / 60 }); continue }
      if (c.code === 261) { const src = resource('movies', p[0], 'webm'); if (src) emit({ op: 'movie', srcs: [src], loop: false }); continue }
      if (c.code === 356) { plugin(p[0]); continue }
      if (c.code === 357) { const args = p[3] || {}; plugin(`${p[0]} ${p[1]} ${Object.values(args).join(' ')}`); continue }
      if (c.code === 355) { let text = String(p[0] || ''); while (commands[i + 1]?.code === 655) text += '\n' + String(commands[++i].parameters?.[0] || ''); script(text); continue }
      if (c.code === 119) { const at = labels.get(String(p[0])); if (at > i && guards.length === guardBase + 1) i = at; else raw('jump-unhandled', p); continue }
      if (c.code === 115) { emit({ op: 'set', var: live, value: 0 }); continue }
      if ([0, 108, 408, 118].includes(c.code)) continue
      raw(`event:${c.code}`, p)
    }
    guards.splice(guardBase); calls.pop()
  }
  const conditions = meta.pageConditions
  if (conditions) {
    if (conditions.switch1Valid) initial.set(variable(conditions.switch1Id, 's'), 1)
    if (conditions.switch2Valid) initial.set(variable(conditions.switch2Id, 's'), 1)
    if (conditions.variableValid) { const key = variable(conditions.variableId); initial.set(key, Math.max(Number(initial.get(key)) || 0, Number(conditions.variableValue || 0))) }
  }
  emit({ op: 'bg', color: [0, 0, 0] })
  if (meta.map?.parallaxName) emit({ op: 'bg', src: resource('img/parallaxes', meta.map.parallaxName) })
  else if (meta.map) stats.warnings.push('地图瓦片/行走角色未渲染；使用黑底播放事件对话与图片，未模拟地图探索')
  if (meta.map?.autoplayBgm) audio('bgm', meta.map.bgm)
  run(list, 0, Array.isArray(ctx.common) && String(meta.scene).startsWith('common-') ? String(meta.eventId) : '')
  flush()
  const initialization = [...initial].map(([key, value]) => ({ op: 'set', var: key, value }))
  if (!steps.length) steps.push({ index: 0, commands: [] })
  steps[0].commands.unshift(...initialization)
  stats.steps = steps.length
  if (Object.keys(stats.raw).length) stats.warnings.push('未支持的游戏指令已记入 raw；不执行任意游戏JavaScript，也不模拟地图探索/战斗')
  return { steps, stats }
}
