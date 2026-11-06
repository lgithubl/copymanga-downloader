// ArcRecord_D（幻想天街 Kuusoutengai，Unity 2018 Mono）的剧情表：StaticData/Dialog.txt（`@` 分隔的明文表，首行是列名）+ StaticData/Text/<语言>.txt（`Key@Value`，台词 / 说话人都是 T_ 开头的键）。
// 一段剧情（drama）= 从 DramaID 非空的那一行起，到下一个 DramaID 非空的行之前；DramaID 会重复（同一个 id 两段，导出时加 _2 / _3 区分）。
// 展开成每段一个 JSON（arcrecord-dialog/1）：{ id, title, rows: [{ id, 非空的列… }], text: { <语言>: { <键>: <文本> } } }（只带这一段用到的键；几种语言都带，适配器按选项选）。
export const DIALOG_FORMAT = 'arcrecord-dialog/1'
export const DEFAULT_LANGUAGES = ['JPN', 'CHS', 'CHT', 'ENG']
const decode = (buffer) => buffer.toString('utf8').replace(/^﻿/, '').replace(/\r/g, '')   // 个别行里有坏字节（游戏自己的数据）：按替换字符处理

export function parseTable(buffer) {
  const lines = decode(buffer).split('\n')
  const header = lines[0].split('@')
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue
    const cells = lines[i].split('@')
    const row = {}
    for (let c = 0; c < header.length; c += 1) if (cells[c]) row[header[c]] = cells[c]
    rows.push(row)
  }
  return { header, rows }
}
export function parseText(buffer) {
  const map = new Map()
  const lines = decode(buffer).split('\n')
  for (let i = 1; i < lines.length; i += 1) {
    const at = lines[i].indexOf('@')
    if (at > 0) map.set(lines[i].slice(0, at), lines[i].slice(at + 1))
  }
  return map
}
// 把 Dialog.txt 切成剧情；texts = { <语言>: Map }
export function buildDramas(dialogBuffer, texts = {}) {
  const { rows } = parseTable(dialogBuffer)
  const dramas = []
  let current = null
  for (const row of rows) {
    if (row.DramaID || !current) { current = { dramaId: row.DramaID || row.ID?.replace(/_\d+$/, '') || 'drama', rows: [] }; dramas.push(current) }
    current.rows.push(row)
  }
  const seen = new Map()
  return dramas.map((drama) => {
    const n = (seen.get(drama.dramaId) || 0) + 1
    seen.set(drama.dramaId, n)
    const id = n === 1 ? drama.dramaId : `${drama.dramaId}_${n}`
    const text = {}
    for (const [lang, map] of Object.entries(texts)) {
      const out = {}
      for (const row of drama.rows) for (const key of [row.Speaker, row.Dialog, row.Scene]) if (key && map.has(key) && !(key in out)) out[key] = map.get(key)
      if (Object.keys(out).length) text[lang] = out
    }
    const sceneKey = drama.rows.find((r) => r.Scene)?.Scene
    const title = (sceneKey && (texts.JPN?.get(sceneKey) || texts[Object.keys(texts)[0]]?.get(sceneKey))) || ''
    return { id, text: JSON.stringify({ format: DIALOG_FORMAT, id, title, rows: drama.rows, text }), rows: drama.rows, textMap: text, title }
  })
}

// 展开时的目录分组：H153_03 / H153_Event_S1_01 → H153（同一个角色的放一起）；E1_01_02 → E1_01（同一章）；别的按前缀
export function dramaGroup(id) {
  let m = /^(H\d+)_/i.exec(id)
  if (m) return m[1].toUpperCase()
  m = /^(E\d+_\d+)(?:_|$)/i.exec(id)
  if (m) return m[1]
  m = /^(CT_Event|OLD_E\d+_\d+|test)/i.exec(id)
  if (m) return m[1]
  return 'other'
}

// 把一串连续的短剧情合并成一整段：事件剧情 H153_Event_S1_01 / 02 / 03 → H153_Event_S1；主线 E1_01_02 / 03 / … → E1_01（按编号排）。只合并 2 段以上的
export function mergeDramas(dramas) {
  const groups = new Map()
  for (const d of dramas) {
    const m = /^(H\d+_Event_S\d+|CT_Event_S\d+|E\d+_\d+)_(\d+)$/i.exec(d.id)
    if (!m) continue
    if (!groups.has(m[1])) groups.set(m[1], [])
    groups.get(m[1]).push({ no: Number(m[2]), d })
  }
  const out = []
  for (const [id, list] of groups) {
    if (list.length < 2) continue
    list.sort((a, b) => a.no - b.no)
    const rows = []
    const text = {}
    const cg = {}
    for (const { d } of list) {
      Object.assign(cg, d.cgData || {})
      rows.push(...d.rows)
      for (const [lang, bucket] of Object.entries(d.textMap || {})) Object.assign((text[lang] ||= {}), bucket)
    }
    out.push({ id, merged: list.length, text: JSON.stringify({ format: DIALOG_FORMAT, id, title: list[0].d.title || '', rows, text, ...(Object.keys(cg).length ? { cg } : {}) }) })
  }
  return out
}

// LineDialog.txt（ラブトーク = LINE 风格的聊天剧情，一个 DramaID 一段；主角的回复 / 选项没有 Speaker）→ 同样格式的剧情。
// 行：ID@DramaID@Type@IsSafeMode@Speaker（H072 这样的角色编号）@SpeakerText@SpeakerIcon@Dialog（T_LineDialog_Dialog_<ID>）@NextDialogIDs（~ 分隔 = 分支）@Energy@DialogImagePrefab@DialogDramaImage@DialogDramaID
// 这里按文件里的顺序线性展开（分支 / 选项都留着：选项行前面加 ▶，主角的回复说话人 = 主角）；重复的行（同一个 ID 出现两次）只留第一次；Reward 行是奖励说明。
// roleNames：Role.txt 的 SpineObject（Hero/H105/H105_）→ NAME 键，用来把 H072 换成名字
export function buildLineDramas(lineBuffer, texts = {}, roleBuffer = null) {
  const { rows } = parseTable(lineBuffer)
  const heroKey = new Map()
  if (roleBuffer) for (const row of parseTable(roleBuffer).rows) { const m = /^Hero\/(H\d+)\//.exec(row.SpineObject || ''); if (m && row.NAME && !heroKey.has(m[1])) heroKey.set(m[1], row.NAME) }
  const byDrama = new Map()
  const seen = new Set()
  for (const row of rows) {
    if (!row.ID || !row.DramaID || seen.has(row.ID)) continue
    seen.add(row.ID)
    if (!byDrama.has(row.DramaID)) byDrama.set(row.DramaID, [])
    byDrama.get(row.DramaID).push(row)
  }
  const out = []
  for (const [id, list] of byDrama) {
    const text = {}
    const converted = list.map((row, i) => {
      const key = `__line_${row.ID}`
      const choose = /Choose$/.test(row.Type || '')
      const spk = row.Speaker ? `__spk_${row.Speaker}` : '__player'
      for (const [lang, map] of Object.entries(texts)) {
        const t = map.get(row.Dialog)
        if (t === undefined) continue
        const bucket = (text[lang] ||= {})
        bucket[key] = (choose ? '▶ ' : '') + t
        if (!(spk in bucket)) bucket[spk] = row.Speaker ? (map.get(heroKey.get(row.Speaker) || '') || row.Speaker) : 'player'
      }
      return { ID: row.ID, ...(i === 0 ? { DramaID: id } : {}), Speaker: spk, Dialog: key, ...(row.Type ? { Type: row.Type } : {}), ...(row.NextDialogIDs ? { Next: row.NextDialogIDs } : {}) }
    })
    out.push({ id, text: JSON.stringify({ format: DIALOG_FORMAT, id, title: '', kind: 'line', rows: converted, text }) })
  }
  return out
}

// —— CG 镜头动作（Unity AnimationClip YAML：CG/<编号>/<名>_Controller/<BGMotion 里的名字>.anim）——
// 只取位置 / 缩放曲线的最后一个关键帧作为终点、最后一个关键帧的时间作为时长（镜头推拉 / 换视角）；Shake / Loop 这类循环抖动不展开（终点 = 起点）。
// 位置是 Unity UI 单位（按 1920×1080 的画布），缩放是倍数。返回 { <名字>: { sec, pos: [x, y] | null, scale: s | null } }
export function parseCameraClip(yaml) {
  const curveEnd = (section) => {
    const i = yaml.indexOf(`  ${section}:`)
    if (i < 0) return null
    const rest = yaml.slice(i + section.length + 3)
    const next = rest.search(/\n  m_\w+:/)
    const body = next < 0 ? rest : rest.slice(0, next)
    const keys = [...body.matchAll(/time: ([-\d.e]+)\s+value: \{x: ([-\d.e]+), y: ([-\d.e]+), z: ([-\d.e]+)\}/g)].map((m) => ({ t: Number(m[1]), x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) }))
    return keys.length ? keys : null
  }
  const pos = curveEnd('m_PositionCurves')
  const scale = curveEnd('m_ScaleCurves')
  const times = [pos?.[pos.length - 1]?.t, scale?.[scale.length - 1]?.t].filter((t) => Number.isFinite(t))
  const lastP = pos?.[pos.length - 1]
  const lastS = scale?.[scale.length - 1]
  return { sec: times.length ? Math.max(...times) : 0, pos: lastP ? [lastP.x, lastP.y] : null, scale: lastS ? lastS.x : null }
}
export function parseClipName(yaml) { return /m_Name: (.+)/.exec(yaml)?.[1]?.trim() || '' }
