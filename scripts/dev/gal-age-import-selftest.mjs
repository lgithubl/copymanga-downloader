import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers, virtualEntry, materialize } from '../../web/library/gal/containers.mjs'
import { readAgeCatalog, ageResourceContext, readAgeEntry } from '../../web/library/gal/age-archive.mjs'
import { decodeAgeImage } from '../../web/library/gal/age.mjs'
import { prepare, parse } from '../../web/library/gal/adapters/age-sys4.mjs'
import { GAL_PRESETS } from '../../web/static/gal-import-presets.js'
import { makeAgeNativeFixture } from './make-age-native-fixture.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'

test('AGE dropdown -> layout -> native ALF script expansion, lazy PNG/voice and strict scene diagnostics', { skip: !existsSync('.cache/age-072229') }, async () => {
  assert.deepEqual(GAL_PRESETS.age.adapters, ['age::sys4'])
  const fixture = await makeAgeNativeFixture(), root = fixture.root
  assert.ok(fixture.written.length >= 30)
  const config = { game: { id: 'age::test', title: '用户设置的标题' } }
  const tagged = await generateTags({ item: { itemId: 'age-native', source: { path: root }, title: '目录标题', adapters: GAL_PRESETS.age.adapters, config }, script: { version: '2.64.0', options: {} } })
  const raw = tagged.itemPatch?.gal?.config
  assert.ok(raw, tagged.logs.join('\n')); assert.equal(raw.game.id, 'age::test')
  assert.equal(raw.game.title, '用户设置的标题')
  assert.equal(raw.scriptRoots[0].dir, 'age/script'); assert.equal(raw.containers.format, 'age')
  const { config: normalized, warnings } = normalizeGalConfigWithWarnings(raw)
  assert.deepEqual(warnings, [])
  const report = await ensureContainers({ mediaDir: root, config: normalized })
  assert.ok(!report.error, JSON.stringify(report)); assert.equal(report.scripts, 30)
  assert.equal(report.looseOverrides.length, 4)
  assert.equal((await ensureContainers({ mediaDir: root, config: normalized })).cached, true)
  const script = await readFile(path.join(root, 'age/script/sys4ini/SN0000.age'), 'utf8')
  const ctx = await prepare({ options: normalized.adapterOptions['age::sys4'], mediaDir: root })
  const prologueCaptured = fixture.written.includes('EV901A.AGF')
  const expectedStop = prologueCaptured ? /SN0000.BIN @2833 opcode 0x35c/ : /SN0000.BIN @23131 opcode 0x1f9/
  assert.throws(() => parse(script, ctx, {}), expectedStop)
  const catalog = await readAgeCatalog(root), main = catalog.indexes[0], imageRow = main.entries.find(r => r.name === 'BG054AA.AGF')
  const image = decodeAgeImage(readAgeEntry(imageRow)), resources = ageResourceContext(catalog)
  assert.equal(resources.resources.bgm[2], 'age/res/sys4ini/BGM002.wav')
  assert.equal(resources.resources.bgm[9], 'age/res/sys4ini/BGM009.wav')
  assert.equal(resources.resources.bgm[28], resources.resources.bgm[2], 'duplicate ordinal is deliberate in the original table')
  assert.equal(resources.resources.bgm[1], undefined)
  assert.equal(Object.keys(resources.resources.bgm).length, 61)
  assert.deepEqual([resources.resources.images[imageRow.ordinal].width, resources.resources.images[imageRow.ordinal].height], [1600, 900])
  const mediaPath = 'age/res/sys4ini/BG054AA.png', entry = await virtualEntry({ mediaDir: root, config: normalized, rels: [mediaPath] })
  assert.ok(entry)
  assert.equal(existsSync(path.join(root, mediaPath)), false, 'indexing does not eagerly materialize media')
  const png = await entry.read(); assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16), image.width); assert.equal(png.readUInt32BE(20), image.height)
  const audioPath = 'age/res/sys4ini/FIA0026.wav'
  assert.equal(resources.resources.voice[141], audioPath)
  const voice = await virtualEntry({ mediaDir: root, config: normalized, rels: [audioPath] })
  const wav = await voice.read(); assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE'); assert.ok(wav.length > 10000)
  assert.equal(await materialize({ mediaDir: root, config: normalized, rels: [audioPath] }), 1)
  assert.ok((await stat(path.join(root, audioPath))).size > 10000)
  assert.equal(catalog.indexes[1].entries[0].ordinal, 0); assert.equal(catalog.indexes[0].entries[0].ordinal, 0)
  assert.notEqual(catalog.indexes[1].entries[0].src, catalog.indexes[0].entries[0].src)
  assert.ok(catalog.indexes[1].entries[0].name.startsWith('$1$'))
  const handler = createGalHandler({ dataDir: path.join(root, 'library-cache'), safeSegment: String, pathExists: async p => existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: root } } }) })
  const imported = await handler.importFromSource({ sourcePath: root, options: { adapters: ['age::sys4'], config } }), item = imported.items[0]
  assert.ok(item)
  const layout = await generateTags({ item, script: { version: '2.64.0', options: {} } })
  await handler.patchItemMetadata(item.itemId, layout.itemPatch)
  const home = await handler.getReaderContent(item.itemId, 'main'), mainNode = home.node.items.find(row => row.title === '主包' || row.title === 'sys4ini')
  assert.ok(mainNode, JSON.stringify(home.node))
  const cards = await handler.getReaderContent(item.itemId, 'main', { sectionId: mainNode.node || mainNode.id })
  const sn = cards.node.items.find(row => /SN0000/.test(row.title))
  assert.ok(sn, JSON.stringify(cards.node))
  await assert.rejects(() => handler.getReaderContent(item.itemId, 'main', { sectionId: sn.node || sn.id }), expectedStop)
  const excluded = { ...normalized, containers: { ...normalized.containers, rules: [{ match: '\\.alf$', exclude: ['^BG054AA\\.AGF$'] }] } }
  assert.equal(await virtualEntry({ mediaDir: root, config: excluded, rels: [mediaPath] }), null, 'resource rules apply before virtual media lookup')
  const previous = await readFile(path.join(root, 'age/script/sys4ini/SN0000.age'))
  const rejected = await ensureContainers({ mediaDir: root, config: { ...normalized, containers: { ...normalized.containers, maxTotalMB: 0 } } })
  assert.match(rejected.error, /byte limit/)
  assert.match(rejected.arcs['SYS4INI.BIN'].error, /byte limit/)
  assert.deepEqual(await readFile(path.join(root, 'age/script/sys4ini/SN0000.age')), previous, 'failed script rebuild preserves previous cache')
  const loose = path.join(root, 'VIINIT.BIN')
  await writeFile(loose, await readFile(loose))
  const updated = await ensureContainers({ mediaDir: root, config: normalized })
  assert.ok(!updated.error, JSON.stringify(updated)); assert.equal(updated.mediaCacheArchived, true)
  assert.equal(existsSync(path.join(root, audioPath)), false, 'changed sources invalidate materialized audio without deleting it')
  const archived = await readdir(path.join(root, 'age/archive'))
  assert.ok(archived.some(name => existsSync(path.join(root, 'age/archive', name, 'res/sys4ini/FIA0026.wav'))), 'previous decoded voice moved into cache archive')
  console.log('AGE native ALF fixture and decoded resources retained:', root)
})
