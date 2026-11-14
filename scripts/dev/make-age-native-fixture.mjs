// Reconstruct only captured ranges in sparse local ALFs; never modify source
// collection files and never treat zero-filled, uncaptured ranges as valid data.
import { readFile, readdir, writeFile, mkdir, open, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readAgeIndex } from '../../web/library/gal/age.mjs'

export async function makeAgeNativeFixture(parent = '.cache/age-native-tests', { additionalSources = [] } = {}) {
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(path.join(parent, 'game-')), indexes = []
  for (const name of ['SYS4INI.BIN', 'APPEND01.AAI', 'APPEND02.AAI']) {
    const bytes = await readFile('.cache/new-games-043952/extracted/g05/' + name)
    await writeFile(path.join(root, name), bytes); indexes.push(readAgeIndex(bytes))
  }
  const handles = new Map(), maximums = new Map()
  for (const table of indexes) for (const row of table.entries) maximums.set(row.archive, Math.max(maximums.get(row.archive) || 0, row.offset + row.size))
  try {
    for (const [archive, size] of maximums) { const h = await open(path.join(root, archive), 'w+'); handles.set(archive, h); await h.truncate(size) }
    const written = new Set(), mismatches = []
    const sources = ['.cache/new-games-043952/extracted/g05', '.cache/new-games-052443/extracted/g05/__verify/age', '.cache/age-072229/extracted/g01/__verify/age']
    const prologue = '.cache/age-prologue-065112/extracted/g01/__verify/age'
    if (existsSync(prologue)) sources.push(prologue)
    sources.push(...additionalSources)
    for (const source of sources) for (const name of await readdir(source)) {
      const row = indexes.flatMap(index => index.entries).find(r => r.name === name)
      if (!row || !/\.(?:bin|agf|xwm|ttf)$/i.test(name)) continue
      const bytes = await readFile(path.join(source, name))
      if (bytes.length !== row.size) {
        mismatches.push({ name, source, expected: row.size, captured: bytes.length, kind: 'captured loose override' })
        await writeFile(path.join(root, name), bytes); written.add(name); continue
      }
      await handles.get(row.archive).write(bytes, 0, bytes.length, row.offset); written.add(name)
    }
    await writeFile(path.join(root, 'fixture-ranges.json'), JSON.stringify({ written: [...written], mismatches }, null, 2))
    if (mismatches.length) console.log('AGE fixture preserves loose BIN files that differ from ALF index sizes:', mismatches)
    return { root: path.resolve(root), written: [...written], mismatches, indexes }
  } finally { for (const h of handles.values()) await h.close() }
}
