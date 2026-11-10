import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { nativeTask } from '../tag-scripts/gal-download/worker-runner.mjs'
import { parse } from '../../web/library/gal/adapters/utage-book.mjs'
const root = path.resolve(process.env.GAL_TSK_REPORTED_DIR || '.cache/tsk-reported-errors')
const imageBundle = path.join(root, '0d8b3642f6c71bac685516640bf2fd80.bundle')
const chapterBundle = path.join(root, '2df5c5b8613a37397a852e06700ea300.bundle')

test('reported ASTC 4x4 bundle exports the full skeleton, atlas and 2048px PNG', { skip: !existsSync(imageBundle) }, async () => {
  const base = 'GachaCharaAnim/HighQuality/adult/tf_1006002/tf_1006002_m1'
  const assets = ['png', 'atlas.txt', 'skel.bytes'].map(ext => ({ source: `Assets/AssetBundles/${base}.${ext}`, target: `GachaCharaAnim/GachaCharaAnim/tf_1006002/tf_1006002_m1.${ext}`, kind: ext === 'png' ? 'png' : 'raw' }))
  const out = await nativeTask('extract', { bundle: imageBundle, assets })
  assert.equal(out.exports.length, 3)
  for (const file of out.exports) assert.ok(file.data.length)
  const png = Buffer.from(out.exports.find(f => f.target.endsWith('.png')).data)
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16), 2048); assert.equal(png.readUInt32BE(20), 2048)
  if (process.env.GAL_TSK_WRITE_VERIFY) { await mkdir(path.join(root, 'verified'), { recursive: true }); for (const file of out.exports) await writeFile(path.join(root, 'verified', path.basename(file.target)), Buffer.from(file.data)) }
})

test('reported chapter alias follows its dataList pointer to the differently named Utage book', { skip: !existsSync(chapterBundle) }, async () => {
  const asset = { source: 'Assets/Adventure/ImportChara/103402.chapter.asset', target: 'Adventure/CharaScenario/CharaScenario103402.book.json', kind: 'book' }
  const out = await nativeTask('extract', { bundle: chapterBundle, assets: [asset] })
  const book = JSON.parse(Buffer.from(out.exports[0].data).toString())
  assert.equal(book.m_Name, 'CharaScenario1034002.book')
  assert.ok(book.importGridList.length)
  assert.ok(parse(JSON.stringify(book)).steps.length > 0)
})

test('task deadline during real texture extraction stops once and defers later bundles', { skip: !existsSync(imageBundle) }, async () => {
  const { generateTags } = await import('../tag-scripts/gal-download/main.js')
  const { archiveToTmp } = await import('../tag-scripts/gal-download/archive.mjs')
  const { mkdtemp, readFile, readdir } = await import('node:fs/promises')
  const dir = await mkdtemp('/tmp/tsk-extract-deadline-'), media = path.join(dir, 'media')
  await mkdir(media)
  const oldFetch = globalThis.fetch, bytes = await readFile(imageBundle)
  globalThis.fetch = async url => new Response(String(url).endsWith('/a') ? bytes : 'later')
  const task = { id: 'deadline', adapters: ['test'], provider: 'files', source: { entries: [{ url: 'https://local.test/a', target: 'texture.png' }, { url: 'https://local.test/b', target: 'later.bin' }] } }
  const run = options => generateTags({ type: 'gal', item: { adapters: ['test'], source: { path: media } }, cacheDir: path.join(dir, 'cache'), script: { options: { tasks: [{ ...task, ...options }] } } })
  try {
    const dry = await run({ dryRun: true }), planPath = dry.details.tasks[0].planPath
    const plan = JSON.parse(await readFile(planPath))
    // Replay a saved bundle plan with the real PNG asset, exercising the actual worker abort seam.
    plan.entries[0].bundle = true
    plan.entries[0].assets[0] = { source: 'Assets/AssetBundles/GachaCharaAnim/HighQuality/adult/tf_1006002/tf_1006002_m1.png', target: 'texture.png', kind: 'png' }
    await writeFile(planPath, JSON.stringify(plan))
    const out = await run({ dryRun: false, runTimeoutMs: 1000 })
    assert.equal(out.details.status, 'partial')
    const result = JSON.parse(await readFile(path.join(out.details.runDir, 'result.json'))).results[0]
    assert.equal(result.stopReason, 'timeout')
    assert.deepEqual(result.entries.map(row => row.status), ['interrupted', 'deferred'])
    assert.deepEqual(await readdir(media), [])
    for (const row of result.entries) assert.ok(existsSync(row.cache), 'complete downloaded bundles must survive the deadline')
    const log = await readFile(out.details.logFile, 'utf8')
    assert.match(log, /解包 \/ 校验/); assert.doesNotMatch(log, /failed: https/)
  } finally { globalThis.fetch = oldFetch; await archiveToTmp(dir) }
})
