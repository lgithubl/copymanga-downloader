import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { classifyTskAsset, TSK_CATEGORIES } from '../tag-scripts/gal-download/tsk-categories.mjs'
import { filterCategories } from '../tag-scripts/gal-download/category-filter.mjs'
import { generateTags } from '../tag-scripts/gal-download/main.js'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'

test('TSK catalog paths distinguish requested UI categories and keep playable resources', () => {
  const fixtures = {
    'Sprites/Shop/Product/product_00156.png': 'shop',
    'Sprites/Equip/L/equip_3300274.png': 'equipment',
    'Sprites/Chara/Thumb_005/S/enemy_3312004.png': 'enemy-icon',
    'Sprites/Chara/Thumb_005/L/chara_1001001.png': 'character-icon',
    'Sprites/StartupNotification/announce_other_0708.png': 'announcement',
    'Sprites/Banner/L/m_event_70202.png': 'event',
    'Sprites/Banner/L/m_gacha_0301.png': 'gacha-ui',
    'Sprites/PictureBook/Still/still_1.png': 'picturebook',
    'Adventure/BackGrounds/HighQuality/bg_adv_1.png': 'background',
    'Stills/st_1/st_1.atlas.txt': 'still',
    'Characters/HighQuality/general/ch_1/ch_1.skel.bytes': 'character',
    'Sound/Voice/1/vo_1.ogg': 'voice',
    'Sound/Bgm/BGM_B204_loop.ogg': 'bgm',
    'Sound/BgVoice/b0074.ogg': 'bgvoice',
    'Sound/Se/a.ogg': 'se',
    'Sprites/NewUnknownSystem/new.png': 'other'
  }
  for (const [target, expected] of Object.entries(fixtures)) {
    assert.equal(classifyTskAsset('Assets/AssetBundles/' + target), expected, target)
    assert.equal(classifyTskAsset(target), expected)
    assert.ok(TSK_CATEGORIES[expected])
  }
  assert.equal(classifyTskAsset('Assets/Adventure/ImportChara/1001001.chapter.asset'), 'scenario')
})

test('category skip removes orphan bundles but retains dependencies required by another category', () => {
  const raw = { entries: [
    { url: 'main', assets: [
      { target: 'shop.png', category: 'shop', dependencies: ['shop-dependency'] },
      { target: 'still.png', category: 'still', dependencies: ['shared-dependency'] }
    ], dependencies: ['shop-dependency', 'shared-dependency'] },
    { url: 'shop-dependency', assets: [] }, { url: 'shared-dependency', assets: [] }
  ] }
  const plan = filterCategories(raw, ['shop'])
  assert.deepEqual(plan.entries.map((e) => e.url), ['main', 'shared-dependency'])
  assert.deepEqual(plan.entries[0].assets.map((a) => a.target), ['still.png'])
  assert.deepEqual(plan.entries[0].dependencies, ['shared-dependency'])
  assert.equal(plan.classification.shop.skipped, 1)
  assert.equal(plan.skippedAssets[0].reason, 'skip-category')
  assert.equal(filterCategories(raw, ['shop', 'still']).entries.length, 0)
  const custom = filterCategories({ entries: [{ url: 'custom', assets: [{ target: 'custom', category: 'constructor' }] }] })
  assert.equal(custom.classification.constructor.selected, 1)
})

test('each task persists category skips in its plan and must replan after changing categories', async () => {
  const base = await mkdtemp('/tmp/gdl-categories-')
  const root = path.join(base, 'media'); await mkdir(root)
  const requests = []
  const server = http.createServer((req, res) => { requests.push(req.url); res.end(req.url) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const task = { id: 'demo', adapters: ['test-adapter'], provider: 'files', dryRun: true, skipCategories: ['shop'], source: { entries: [
    { url: `http://127.0.0.1:${server.address().port}/shop`, target: 'shop.png', category: 'shop' },
    { url: `http://127.0.0.1:${server.address().port}/still`, target: 'still.png', category: 'still' },
    { url: `http://127.0.0.1:${server.address().port}/other`, target: 'other.png' }
  ] } }
  const ctx = { type: 'gal', item: { adapters: ['test-adapter'], source: { path: root } }, cacheDir: path.join(base, 'cache'), script: { options: { tasks: [task] } } }
  try {
    const preview = await generateTags(ctx)
    const plan = JSON.parse(await readFile(preview.details.tasks[0].planPath))
    assert.equal(plan.entries.length, 2)
    assert.equal(plan.skippedAssets.length, 1)
    assert.equal(plan.classification.other.selected, 1)
    assert.match(await readFile(preview.details.logFile, 'utf8'), /skip-category \[shop\]: shop.png/)
    task.dryRun = false
    const execution = await generateTags(ctx)
    assert.equal(execution.details.status, 'completed')
    assert.deepEqual(requests.sort(), ['/other', '/still'])
    task.skipCategories = []
    const stale = await generateTags(ctx)
    assert.equal(stale.details.status, 'failed')
    assert.match(stale.logs.join('\n'), /plan 与 APK\/关键配置不一致/)
    assert.equal(requests.length, 2)
    task.dryRun = true
    await generateTags(ctx)
    task.dryRun = false
    await generateTags(ctx)
    assert.equal(requests.length, 3)
    assert.equal(requests[2], '/shop')
    task.provider = 'tsk'; task.skipCategories = ['shoop']
    const typo = await generateTags(ctx)
    assert.equal(typo.details.status, 'failed')
    assert.match(typo.logs.join('\n'), /未知 TSK 分类 shoop/)
    assert.equal(requests.length, 3)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await archiveToTmp(base)
  }
})
