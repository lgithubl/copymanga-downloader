// One original SN0000 scene for an explicitly incomplete HTTP diagnostic demo.
// Copy captured source bytes only. Do not execute game EXEs or invent dialogue.
import { readFile, writeFile, mkdir, copyFile, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { readAgeIndex } from '../../web/library/gal/age.mjs'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { ensureContainers } from '../../web/library/gal/containers.mjs'
import { prepare, parse } from '../../web/library/gal/adapters/age-sys4.mjs'

const out = path.resolve(process.argv[2] || '.cache/age-http-demo'), game = path.join(out, 'game')
await mkdir(game, { recursive: true })
const sources = [
  ['SYS4INI.BIN', '.cache/new-games-043952/extracted/g05/SYS4INI.BIN'],
  ['SN0000.BIN', '.cache/age-072229/extracted/g01/__verify/age/SN0000.BIN'],
  ['EV901A.AGF', '.cache/age-prologue-065112/extracted/g01/__verify/age/EV901A.AGF'],
  ['EV902A.AGF', '.cache/age-prologue-065112/extracted/g01/__verify/age/EV902A.AGF'],
]
const files = []
for (const [name, source] of sources) {
  const data = await readFile(source)
  await copyFile(source, path.join(game, name))
  files.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') })
}
const index = readAgeIndex(await readFile(path.join(game, 'SYS4INI.BIN'))), sizes = {}
for (const row of index.entries) sizes[row.archive] = Math.max(sizes[row.archive] || 0, row.offset + row.size)
// Sparse placeholders preserve original index bounds. Only captured loose
// resources above contain data; no uncaptured archive range is a valid asset.
for (const [name, size] of Object.entries(sizes)) { const h = await open(path.join(game, name), 'w'); try { await h.truncate(size) } finally { await h.close() } }
await writeFile(path.join(out, 'archive-sizes.json'), JSON.stringify(sizes))
const title = '天結いラビリンスマイスター · SN0000（原始开场诊断预览）'
const tagged = await generateTags({ item: { itemId: 'age-http', title, source: { path: game }, adapters: ['age::sys4'], config: { game: { id: 'age::http-preview', title } } }, script: { version: '2.64.2', options: {} } })
const config = tagged.itemPatch?.gal?.config
if (!config?.containers || config.containers.format !== 'age') throw Error('Native AGE layout was not detected')
config.adapterOptions['age::sys4'].partialPreview = true
config.containers.rules = [{ match: '\\.alf$', include: ['^SN0000\\.BIN$', '^EV90[12]A\\.AGF$'] }]
config.views = []
const normalized = normalizeGalConfig(config)
const expansion = await ensureContainers({ mediaDir: game, config: normalized })
if (expansion.scripts !== 1) throw Error('Expected exactly one original scene')
const text = await readFile(path.join(game, 'age/script/sys4ini/SN0000.age'), 'utf8')
const context = await prepare({ mediaDir: game, options: normalized.adapterOptions['age::sys4'] })
const scene = parse(text, context)
if (scene.stats.complete !== false || scene.stats.previewStopped?.opcode !== 0x35d) throw Error('Unexpected real-scene preview boundary')
await writeFile(path.join(out, 'profile.json'), JSON.stringify({ adapters: ['age::sys4'], config }))
await writeFile(path.join(out, 'provenance.json'), JSON.stringify({ originalScript: true, originalBytecodeUnchanged: true, syntheticDialogue: false, sparseArchives: 'Only the listed loose captures contain data; all other ranges unavailable', files, expansion, preview: { steps: scene.steps.length, stop: scene.stats.previewStopped, warnings: scene.stats.opcodeWarnings } }, null, 2))
console.log(JSON.stringify({ out, scene: 'SN0000.BIN', steps: scene.steps.length, stop: scene.stats.previewStopped, files }, null, 2))
