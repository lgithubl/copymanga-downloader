import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { generateTags } from '../tag-scripts/gal-download/main.js'
import { createPathInspector } from '../tag-scripts/gal-download/path-inspector.mjs'
import { auditAtlasPages, filePngSize } from '../tag-scripts/gal-download/atlas-audit.mjs'
import { encodePng } from '../tag-scripts/gal-download/png.mjs'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'

test('atlas audit is read-only, deduplicates pages and ignores category-skipped images', async () => {
  const root = await mkdtemp('/tmp/atlas-audit-')
  try {
    const image = encodePng(8, 6, Buffer.alloc(8 * 6 * 4, 255), 4)
    await writeFile(path.join(root, 'page.png'), image)
    await writeFile(path.join(root, 'skip.png'), image)
    await writeFile(path.join(root, 'one.atlas.txt'), 'page.png\nsize:8,8\nfilter:Linear,Linear\nregion\nbounds:0,2,8,6\n\nskip.png\nsize:8,8\n')
    await writeFile(path.join(root, 'two.atlas.txt'), 'page.png\nsize:8,8\n')
    const plan = { entries: [{ assets: ['one.atlas.txt', 'two.atlas.txt', 'page.png'].map(target => ({ target })) }] }
    const audit = await auditAtlasPages(plan, createPathInspector(root))
    assert.equal(audit.size, 1); assert.equal(audit.get('page.png').atlases.length, 2)
    assert.deepEqual(audit.get('page.png').png, { width: 8, height: 6 })
    assert.deepEqual(await readFile(path.join(root, 'page.png')), image)
  } finally { await archiveToTmp(root) }
})

const fixture = path.resolve('.cache/diagnostics-138')
const stem = 'Stills/st_1038004/st_1038004'
const collected = path.join(fixture, 'extracted/g02/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X')
test('dry-run reports atlas repair candidates in the plan without moving or fetching files', async () => {
  const dir = await mkdtemp('/tmp/atlas-dry-'), root = path.join(dir, 'media')
  await mkdir(root)
  const image = encodePng(8, 6, Buffer.alloc(8 * 6 * 4, 255), 4)
  await writeFile(path.join(root, 'page.png'), image)
  await writeFile(path.join(root, 'page.atlas.txt'), 'page.png\nsize:8,8\n')
  const oldFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('dry-run must not fetch') }
  try {
    const output = await generateTags({ type: 'gal', item: { adapters: ['test'], source: { path: root } }, cacheDir: path.join(dir, 'cache'), script: { options: { tasks: [{ provider: 'files', adapters: ['test'], dryRun: true, source: { entries: ['page.png', 'page.atlas.txt'].map(target => ({ target, url: 'https://local.test/' + target })) } }] } } })
    const plan = JSON.parse(await readFile(output.details.tasks[0].planPath))
    assert.equal(plan.repairCandidates.length, 1)
    assert.deepEqual(await readFile(path.join(root, 'page.png')), image)
    assert.equal(existsSync(path.join(dir, 'cache/repair-backups')), false)
  } finally { globalThis.fetch = oldFetch; await archiveToTmp(dir) }
})

test('real TSK cropped CG is backed up inside cache and repaired from bundle; extraction failure leaves old file intact', { skip: !existsSync(path.join(fixture, 'st_1038004.bundle')) }, async () => {
  const dir = await mkdtemp('/tmp/atlas-repair-'), root = path.join(dir, 'media'), cache = path.join(dir, 'cache')
  await mkdir(path.join(root, path.dirname(stem)), { recursive: true })
  const png = path.join(root, stem + '.png'), old = await readFile(path.join(collected, stem + '.png'))
  for (const ext of ['png', 'atlas.txt', 'skel.bytes']) await copyFile(path.join(collected, stem + '.' + ext), path.join(root, stem + '.' + ext))
  const rawAtlas = await readFile(path.join(root, stem + '.atlas.txt'))
  const source = { entries: [{ url: 'https://local.test/still', target: stem + '.png' }] }
  const run = dryRun => generateTags({ type: 'gal', item: { adapters: ['test'], source: { path: root } }, cacheDir: cache, script: { options: { tasks: [{ id: 'repair', provider: 'files', adapters: ['test'], source, dryRun }] } } })
  const oldFetch = globalThis.fetch; let requests = 0
  globalThis.fetch = async url => { requests++; return new Response(String(url).endsWith('/broken') ? 'UnityFS\0bad header' : await readFile(path.join(fixture, 'st_1038004.bundle'))) }
  try {
    const dry = await run(true), planPath = dry.details.tasks[0].planPath
    const plan = JSON.parse(await readFile(planPath))
    plan.entries[0].bundle = true
    plan.entries[0].assets = ['png', 'atlas.txt', 'skel.bytes'].map(ext => ({ target: stem + '.' + ext, source: 'Assets/AssetBundles/' + stem + '.' + ext, kind: ext === 'png' ? 'png' : 'raw', category: 'still' }))
    await writeFile(planPath, JSON.stringify(plan))
    const output = await run(false), result = JSON.parse(await readFile(path.join(output.details.runDir, 'result.json'))).results[0]
    assert.equal(result.status, 'completed')
    assert.equal(result.repairs.repairedFiles, 1)
    assert.deepEqual(await filePngSize(png), { width: 2048, height: 2048 })
    const backup = result.entries[0].repairs[0].backup
    assert.ok(backup.startsWith(path.join(cache, 'repair-backups') + path.sep), backup)
    assert.deepEqual(await readFile(backup), old)
    assert.deepEqual(await readFile(path.join(root, stem + '.atlas.txt')), rawAtlas)
    assert.match(await readFile(output.details.logFile, 'utf8'), /repair-written/)
    await run(false); assert.equal(requests, 1, 'corrected PNG must skip without another request')
    // A mismatching atlas alone must not force replacement when the original
    // bundle exports the same dimensions (legitimate scaled atlas pages).
    await writeFile(path.join(root, stem + '.atlas.txt'), rawAtlas.toString().replace('size:2048,2048', 'size:4096,4096'))
    const scaled = await run(false), checked = JSON.parse(await readFile(path.join(scaled.details.runDir, 'result.json'))).results[0]
    assert.equal(checked.status, 'completed'); assert.equal(checked.repairs.repairedFiles, 0)
    assert.equal(checked.repairs.verifiedExistingFiles, 1)
    assert.equal(requests, 1, 'candidate verification should reuse the cached bundle')
    await writeFile(path.join(root, stem + '.atlas.txt'), rawAtlas)
    // A failing extraction must not remove or archive the old image first.
    await writeFile(png, old); plan.entries[0].url = 'https://local.test/broken'; await writeFile(planPath, JSON.stringify(plan))
    const failed = await run(false), failure = JSON.parse(await readFile(path.join(failed.details.runDir, 'result.json'))).results[0]
    assert.equal(failure.entries[0].status, 'extract-failed')
    assert.deepEqual(await readFile(png), old)
    assert.equal(failure.repairs.repairedFiles, 0)
    assert.equal(failure.entries[0].repairs?.length || 0, 0)
  } finally { globalThis.fetch = oldFetch; await archiveToTmp(dir) }
})
