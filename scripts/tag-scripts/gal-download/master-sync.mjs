// Refresh official Utage mappings while preserving local display names/aliases.
// No game code is executed and no media files are touched here.
const kinds = { Character: 'CharacterName', Texture: 'Label', Sound: 'Label' }
const kindOf = table => /:([A-Za-z]+)\s*$/.exec(String(table?.name || ''))?.[1]
const parse = (bytes, label) => {
  let data
  try { data = JSON.parse(String(bytes).replace(/^\uFEFF/, '')) } catch { throw new Error(`${label} Master 不是有效 JSON；保留原文件`) }
  if (!Array.isArray(data?.settingList)) throw new Error(`${label} Master 缺少 settingList；保留原文件`)
  return data
}
const tableInfo = table => {
  const header = table.rows?.[table.headerRow ?? 0]?.strings
  if (!Array.isArray(header)) throw new Error(`Master 表头无效: ${table.name}`)
  const key = kinds[kindOf(table)], keyIndex = header.indexOf(key), rows = new Map()
  if (keyIndex < 0) throw new Error(`Master 表缺少 ${key}: ${table.name}`)
  for (const row of table.rows) {
    if (row === table.rows[table.headerRow ?? 0] || row.isEmpty || row.isCommentOut) continue
    const value = row.strings?.[keyIndex]
    if (value && !rows.has(value)) rows.set(value, row)
  }
  return { header, keyIndex, rows }
}
const cells = (row, header) => Object.fromEntries(header.map((name, i) => [name, String(row.strings?.[i] ?? '')]))
const equalCells = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => (a[key] || '') === (b[key] || ''))

export function mergeMaster(previousBytes, officialBytes) {
  const official = parse(officialBytes, '官方'), previous = previousBytes ? parse(previousBytes, '现有') : null
  const merged = { ...(previous || {}), ...structuredClone(official) }
  // Local translation annotations must survive an official export lacking them.
  for (const [key, value] of Object.entries(previous || {})) if (key.startsWith('_tsk_')) merged[key] = value
  const report = { addedRows: 0, updatedRows: 0, keptLocalRows: 0, preservedNames: 0, inferredNames: 0, tables: {} }
  const oldTables = new Map((previous?.settingList || []).map(table => [kindOf(table), table]))
  let characters = 0
  for (const table of merged.settingList) {
    const kind = kindOf(table)
    if (!kinds[kind]) continue
    const current = tableInfo(table), oldTable = oldTables.get(kind), old = oldTable ? tableInfo(oldTable) : null
    if (kind === 'Character') characters += current.rows.size
    const counts = { added: [], updated: [], keptLocal: [], preservedNames: 0, inferredNames: 0 }
    const translations = new Map(), nameIndex = current.header.indexOf('NameText')
    if (old && nameIndex >= 0) for (const [key, row] of current.rows) {
      const sourceName = String(row.strings[nameIndex] || ''), local = old.rows.get(key)
      const localName = local && cells(local, old.header).NameText
      if (sourceName && localName) {
        const names = translations.get(sourceName) || new Set()
        names.add(localName); translations.set(sourceName, names)
      }
    }
    for (const [key, row] of current.rows) {
      const oldRow = old?.rows.get(key), oldCells = oldRow ? cells(oldRow, old.header) : null
      const sourceName = nameIndex >= 0 ? String(row.strings[nameIndex] || '') : ''
      if (oldCells?.NameText && nameIndex >= 0) { row.strings[nameIndex] = oldCells.NameText; counts.preservedNames++ }
      else if (!oldRow && translations.get(sourceName)?.size === 1) { row.strings[nameIndex] = [...translations.get(sourceName)][0]; counts.inferredNames++ }
      if (!oldRow) counts.added.push(key)
      else if (!equalCells(cells(row, current.header), oldCells)) counts.updated.push(key)
    }
    if (old) for (const [key, row] of old.rows) if (!current.rows.has(key)) {
      const local = cells(row, old.header)
      table.rows.push({ ...structuredClone(row), rowIndex: table.rows.length, strings: current.header.map(column => local[column] || '') })
      counts.keptLocal.push(key)
    }
    table.textLength = table.rows.reduce((n, row) => n + (row.strings || []).reduce((sum, value) => sum + String(value).length, 0), 0)
    report.tables[kind] = counts
    report.addedRows += counts.added.length; report.updatedRows += counts.updated.length; report.keptLocalRows += counts.keptLocal.length
    report.preservedNames += counts.preservedNames; report.inferredNames += counts.inferredNames
  }
  if (!characters) throw new Error('官方 Master 没有有效 Character 映射；保留原文件')
  const officialKinds = new Set(merged.settingList.map(kindOf))
  for (const table of previous?.settingList || []) if (!officialKinds.has(kindOf(table))) merged.settingList.push(structuredClone(table))
  return { bytes: Buffer.from(JSON.stringify(merged, null, 2)), changed: !previous || JSON.stringify(previous) !== JSON.stringify(merged), report }
}
