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
    return { id, text: JSON.stringify({ format: DIALOG_FORMAT, id, title, rows: drama.rows, text }) }
  })
}
