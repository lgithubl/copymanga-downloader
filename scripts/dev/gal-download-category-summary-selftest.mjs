import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeCategories } from '../tag-scripts/gal-download/category-summary.mjs'
import { generateTags } from '../tag-scripts/gal-download/main.js'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'

test('per-category bundle counts deduplicate shared owners/dependencies and preserve a unique global total', () => {
  const assets = [
    { target: 'a.ogg', category: 'voice', dependencies: ['dep'] },
    { target: 'b.json', category: 'scenario', dependencies: ['dep'] },
    { target: 'existing.ogg', category: 'voice', dependencies: ['unused'] }
  ]
  const plan = { classification: { voice: {}, scenario: {}, shop: {} }, entries: [{ url: 'owner', assets }], skippedAssets: [{ target: 'shop.png', category: 'shop' }] }
  const prepared = [{ url: 'owner', assets: assets.slice(0, 2), preserved: ['existing.ogg'] }]
  const rows = [
    { url: 'owner', status: 'would-download', cacheAvailable: false, transfer: 'download', skipped: ['existing.ogg'] },
    { url: 'dep', status: 'limited', cacheAvailable: false }
  ]
  const summary = summarizeCategories(plan, prepared, rows)
  for (const category of ['voice', 'scenario']) {
    assert.equal(summary.categories[category].downloadBundles, 2)
    assert.equal(summary.categories[category].selectedDownloadBundles, 1)
    assert.equal(summary.categories[category].limitedBundles, 1)
    assert.equal(summary.categories[category].missingFiles, 1)
  }
  assert.equal(summary.categories.voice.existingFiles, 1)
  assert.equal(summary.categories.shop.categorySkippedFiles, 1)
  assert.equal(summary.categories.shop.downloadBundles, 0)
  assert.equal(summary.totals.downloadBundles, 2, 'shared URLs must not be counted four times')
  assert.equal(summary.totals.missingFiles, 2)
})

test('cached bundles do not count as downloads; completed transfers and written files remain visible', () => {
  const assets = [{ target: 'cached.png', category: 'still' }, { target: 'new.ogg', category: 'voice' }]
  const plan = { entries: [{ url: 'cached', assets: [assets[0]] }, { url: 'network', assets: [assets[1]] }] }
  const summary = summarizeCategories(plan, plan.entries, [
    { url: 'cached', cacheAvailable: true, transfer: 'cache', status: 'written', downloadStatus: 'cached', written: ['cached.png'] },
    { url: 'network', cacheAvailable: false, transfer: 'download', status: 'written', downloadStatus: 'downloaded', written: ['new.ogg'] }
  ])
  assert.equal(summary.categories.still.cachedBundles, 1)
  assert.equal(summary.categories.still.downloadBundles, 0)
  assert.equal(summary.categories.voice.downloadedBundles, 1)
  assert.equal(summary.categories.voice.writtenFiles, 1)
  assert.equal(summary.totals.downloadBundles, 1)
  assert.equal(summary.totals.writtenFiles, 2)
})

test('dryRun returns and ends its log with missing/download/limit/existing/category-skip counts for every category', async () => {
  const base = await mkdtemp('/tmp/gdl-category-summary-'), root = path.join(base, 'media')
  await mkdir(root); await writeFile(path.join(root, 'existing'), 'existing')
  const ctx = { type: 'gal', item: { adapters: ['test-adapter'], source: { path: root } }, cacheDir: path.join(base, 'cache'), script: { options: { tasks: [{
    id: 'summary', adapters: ['test-adapter'], provider: 'files', dryRun: true, downloadLimit: 1, skipCategories: ['shop'], source: { entries: [
      { url: 'https://example.invalid/a', target: 'existing', category: 'voice' },
      { url: 'https://example.invalid/b', target: 'missing-voice', category: 'voice' },
      { url: 'https://example.invalid/c', target: 'missing-still', category: 'still' },
      { url: 'https://example.invalid/d', target: 'ignored', category: 'shop' }
    ] }
  }] } } }
  try {
    const out = await generateTags(ctx)
    assert.equal(out.details.status, 'completed')
    const summary = out.details.results[0].categorySummary
    assert.equal(summary.voice.existingFiles, 1)
    assert.equal(summary.voice.downloadBundles, 1)
    assert.equal(summary.voice.selectedDownloadBundles, 1)
    assert.equal(summary.still.downloadBundles, 1)
    assert.equal(summary.still.selectedDownloadBundles, 0)
    assert.equal(summary.still.limitedBundles, 1)
    assert.equal(summary.shop.categorySkippedFiles, 1)
    const log = await readFile(out.details.logFile, 'utf8')
    assert.match(log, /分类下载汇总/)
    assert.match(log, /voice.*需下载 bundle 1.*已有 skip 1/)
    assert.match(log, /shop.*分类 skip 1/)
    assert.ok(log.lastIndexOf('分类下载汇总') > log.lastIndexOf('另 '))
    const result = JSON.parse(await readFile(path.join(out.details.runDir, 'result.json')))
    assert.equal(result.results[0].categoryTotals.downloadBundles, 2)
  } finally { await archiveToTmp(base) }
})
