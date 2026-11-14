// One original SN0000 scene for an explicitly incomplete HTTP diagnostic demo.
// Copy captured source bytes only. Do not execute game EXEs or invent dialogue.
import { readFile, writeFile, mkdir, copyFile, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { readAgeIndex, decodeAgeScript, traceAgeProgram } from '../../web/library/gal/age.mjs'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { ensureContainers } from '../../web/library/gal/containers.mjs'
import { prepare, parse } from '../../web/library/gal/adapters/age-sys4.mjs'

const out = path.resolve(process.argv[2] || '.cache/age-http-demo'), game = path.join(out, 'game')
await mkdir(game, { recursive: true })
const sources = [
  ['SYS4INI.BIN', '.cache/new-games-043952/extracted/g05/SYS4INI.BIN'],
  ['INIT2.BIN', '.cache/age-072229/extracted/g01/__verify/age/INIT2.BIN'],
  ['SYSTEM4.BIN', '.cache/new-games-052443/extracted/g05/__verify/age/SYSTEM4.BIN'],
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
const title = '天結いラビリンスマイスター · SN0000（25段原始台词诊断试播）'
const tagged = await generateTags({ item: { itemId: 'age-http', title, source: { path: game }, adapters: ['age::sys4'], config: { game: { id: 'age::http-preview', title } } }, script: { version: '2.64.2', options: {} } })
const config = tagged.itemPatch?.gal?.config
if (!config?.containers || config.containers.format !== 'age') throw Error('Native AGE layout was not detected')
config.adapterOptions['age::sys4'].partialPreview = true
config.adapterOptions['age::sys4'].unverifiedPolicy = 'preview'
// Verified native ID-table helper, not the unsupported full SYSTEM4 startup.
// Without these IDs, text-window cleanup aliases the CG slot to zero.
const ids = traceAgeProgram(decodeAgeScript(await readFile(path.join(game,'SYSTEM4.BIN'))), {entry:2040})
if (ids.status !== 'returned') throw Error('Native ID-table initializer did not return')
const init2 = traceAgeProgram(decodeAgeScript(await readFile(path.join(game,'INIT2.BIN'))), {programName:'INIT2.BIN'})
if (init2.status !== 'missing-script' || init2.missingScript !== 22929 || init2.trace.at(-1)?.offset !== 340) throw Error('Unexpected INIT2 verified data-prefix boundary')
config.adapterOptions['age::sys4'].integers = {...ids.integers,...init2.integers}
config.adapterOptions['age::sys4'].floats = init2.floats
config.containers.rules = [{ match: '\\.alf$', include: ['^SN0000\\.BIN$', '^EV90[12]A\\.AGF$'] }]
config.views = []
const normalized = normalizeGalConfig(config)
const expansion = await ensureContainers({ mediaDir: game, config: normalized })
if (expansion.scripts !== 1) throw Error('Expected exactly one original scene')
const text = await readFile(path.join(game, 'age/script/sys4ini/SN0000.age'), 'utf8')
const context = await prepare({ mediaDir: game, options: normalized.adapterOptions['age::sys4'] })
const scene = parse(text, context)
const textSteps = scene.steps.filter(s => s.commands.some(c => c.op === 'text')).length
const pictures = [...new Set(scene.steps.flatMap(s => s.commands.filter(c => c.op === 'overlay').map(c => c.src)))]
if (textSteps !== 25 || pictures.length !== 2 || !scene.stats.approximate) throw Error('Native preview must contain 25 actual text steps and both captured CGs')
await writeFile(path.join(out, 'profile.json'), JSON.stringify({ adapters: ['age::sys4'], config }))
await writeFile(path.join(out, 'provenance.json'), JSON.stringify({ originalScript: true, originalBytecodeUnchanged: true, syntheticDialogue: false, initialization: [{source:'SYSTEM4.BIN',entry:2040,kind:'verified ID-table helper only; not full startup'},{source:'INIT2.BIN',beforeOffset:340,kind:'verified scalar data prefix before SCINIT call; not full startup'}], sparseArchives: 'Only the listed loose captures contain data; all other ranges unavailable', files, expansion, preview: { approximate: true, textSteps, pictures, steps: scene.steps.length, stop: scene.stats.previewStopped || null, warnings: scene.stats.opcodeWarnings } }, null, 2))
console.log(JSON.stringify({ out, scene: 'SN0000.BIN', steps: scene.steps.length, textSteps, pictures, stop: scene.stats.previewStopped || null, files }, null, 2))
