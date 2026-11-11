import { test, mock } from 'node:test'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { downloadBundle } from '../tag-scripts/gal-download/bundle-cache.mjs'
import { parse as parseBook } from '../../web/library/gal/adapters/utage-book.mjs'
import { generateTags } from '../tag-scripts/gal-download/main.js'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'

const sha = b => createHash('sha256').update(b).digest('hex')
const signal = () => AbortSignal.timeout(30000)
async function fixture(bytes = Buffer.from('previous')) {
  const base = await mkdtemp('/tmp/gdl-cache-version-'), cache = path.join(base, 'cache', 'bundles'), url = 'https://fixture.test/shared.bundle'
  await mkdir(cache, { recursive: true })
  const file = path.join(cache, sha(url))
  const record = { url, sha256: sha(bytes), size: bytes.length, etag: '"v1"', sourceStamp: 'old-apk' }
  await writeFile(file, bytes); await writeFile(file + '.json', JSON.stringify(record))
  return { base, cache, url, file, record }
}
const pace = handler => ({ start: async (url, timeout, options) => ({ requestSignal: signal(), pending: Promise.resolve(handler(url, options)) }), retry: async () => {} })

test('new source version uses conditional GET; 304 updates metadata once without replacing bytes', async () => {
  const f = await fixture(), stats = {}; let requests = 0
  const options = { sourceStamp: 'new-apk', stats }
  const pacing = pace((url, { headers }) => { requests++; assert.equal(headers['If-None-Match'], '"v1"'); return new Response(null, { status: 304 }) })
  try {
    const preview = await downloadBundle({ url: f.url, cachedOnly: true }, f.cache, signal(), 1000, null, options)
    assert.equal(preview.needsValidation, true); assert.equal(requests, 0)
    const got = await downloadBundle({ url: f.url }, f.cache, signal(), 1000, pacing, options)
    assert.equal(got.status, 'cached'); assert.equal(stats.validated, 1); assert.equal(stats.unchanged, 1)
    assert.equal((await readFile(f.file)).toString(), 'previous')
    assert.equal(JSON.parse(await readFile(f.file + '.json')).sourceStamp, 'new-apk')
    await downloadBundle({ url: f.url }, f.cache, signal(), 1000, pacing, options)
    assert.equal(requests, 1, 'same source version does not repeatedly contact CDN')
  } finally { await archiveToTmp(f.base) }
})

test('changed CDN body backs up old bytes and metadata; corrupt replacements and limit exhaustion preserve cache', async () => {
  const f = await fixture(Buffer.from('UnityFS\0previous')), stats = {}, backupDir = path.join(f.base, 'backups')
  const options = { sourceStamp: 'new-apk', stats, backupDir }
  try {
    const entry = { url: f.url, bundle: true }
    await assert.rejects(downloadBundle(entry, f.cache, signal(), 1000, pace(() => new Response('bad payload')), options), /不是 UnityFS/)
    assert.equal((await readFile(f.file)).toString(), 'UnityFS\0previous')
    assert.equal(JSON.parse(await readFile(f.file + '.json')).sourceStamp, 'old-apk')
    await assert.rejects(downloadBundle(entry, f.cache, signal(), 1000, pace(() => new Response('UnityFS\0new')), { ...options, claimDownload: () => false }), { code: 'DOWNLOAD_LIMIT' })
    assert.equal((await readFile(f.file)).toString(), 'UnityFS\0previous')
    const got = await downloadBundle(entry, f.cache, signal(), 1000, pace(() => new Response('UnityFS\0new', { headers: { ETag: '"v2"' } })), options)
    assert.equal(got.status, 'downloaded'); assert.equal(got.cacheEvent, 'refreshed')
    assert.equal((await readFile(got.backup)).toString(), 'UnityFS\0previous')
    assert.equal(JSON.parse(await readFile(got.metadataBackup)).etag, '"v1"')
    assert.ok(got.backup.startsWith(backupDir + path.sep))
    assert.equal((await readFile(f.file)).toString(), 'UnityFS\0new')
    assert.equal(JSON.parse(await readFile(f.file + '.json')).etag, '"v2"')
  } finally { await archiveToTmp(f.base) }
})

test('Last-Modified validators work without ETag; metadata publication failure restores the previous cache pair', async () => {
  const f = await fixture(), originalRename = fs.rename.bind(fs)
  const record = { ...f.record, etag: null, lastModified: 'Wed, 11 Nov 2026 05:09:26 GMT' }
  await writeFile(f.file + '.json', JSON.stringify(record))
  try {
    const unchanged = await downloadBundle({ url: f.url }, f.cache, signal(), 1000, pace((url, { headers }) => {
      assert.equal(headers['If-Modified-Since'], record.lastModified)
      return new Response(null, { status: 304 })
    }), { sourceStamp: 'new-apk' })
    assert.equal(unchanged.status, 'cached')
    const previousMetadata = await readFile(f.file + '.json')
    mock.method(fs, 'rename', async (source, target) => {
      if (target === f.file + '.json' && source.endsWith('.part')) throw Object.assign(Error('injected metadata publication failure'), { code: 'EIO' })
      return originalRename(source, target)
    })
    syncBuiltinESMExports()
    await assert.rejects(downloadBundle({ url: f.url, refresh: true }, f.cache, signal(), 1000, pace(() => new Response('replacement')), { sourceStamp: 'new-apk' }), /publication failure/)
    assert.equal((await readFile(f.file)).toString(), 'previous')
    assert.deepEqual(await readFile(f.file + '.json'), previousMetadata)
  } finally { mock.restoreAll(); syncBuiltinESMExports(); await archiveToTmp(f.base) }
})

const oldBundle = '.cache/tsk-reported-errors/2df5c5b8613a37397a852e06700ea300.bundle'
const freshBundle = '.cache/tsk-logs-055149/2df5c5b8613a37397a852e06700ea300.bundle'
test('task downloadLimit bounds stale-cache replacements, dryRun stays offline, and the next run resumes remaining targets', async () => {
  const f = await fixture(), root = path.join(f.base, 'media'), saved = globalThis.fetch
  await mkdir(root)
  const entries = ['one', 'two'].map(name => ({ url: `https://fixture.test/${name}`, target: name }))
  const task = { id: 'limit-cache', adapters: ['test'], provider: 'files', dryRun: true, downloadLimit: 1, source: { entries } }
  const ctx = { type: 'gal', item: { adapters: ['test'], source: { path: root } }, cacheDir: path.dirname(f.cache), script: { options: { tasks: [task] } } }
  let requests = 0
  globalThis.fetch = async () => { requests++; return new Response('new-content', { headers: { ETag: '"new"' } }) }
  try {
    for (const entry of entries) {
      const file = path.join(f.cache, sha(entry.url)), bytes = Buffer.from('old-content')
      await writeFile(file, bytes); await writeFile(file + '.json', JSON.stringify({ url: entry.url, sha256: sha(bytes), size: bytes.length, sourceStamp: 'old-apk', etag: '"old"' }))
    }
    const dry = await generateTags(ctx); assert.equal(requests, 0); assert.equal(dry.details.results[0].cacheStats.pendingValidation, 2)
    task.dryRun = false
    const out = await generateTags(ctx), result = out.details.results[0]
    assert.equal(result.status, 'partial'); assert.equal(result.categoryTotals.downloadedBundles, 1); assert.equal(result.categoryTotals.limitedBundles, 1)
    assert.equal((await readdir(root)).length, 1)
    const limited = JSON.parse(await readFile(path.join(out.details.runDir, 'result.json'))).results[0].entries.find(e => e.status === 'limited')
    assert.equal((await readFile(path.join(f.cache, sha(limited.url)))).toString(), 'old-content')
    const resumed = await generateTags(ctx); assert.equal(resumed.details.status, 'completed')
    assert.deepEqual((await readdir(root)).sort(), ['one', 'two'])
    assert.equal(requests, 3, 'one limited response cancelled; only remaining file downloaded on resume')
  } finally { globalThis.fetch = saved; await archiveToTmp(f.base) }
})

test('real updated APK chapters: source change refreshes cache; same-version missing objects refresh once; local-only stays offline', { skip: !existsSync(oldBundle) || !existsSync(freshBundle) }, async () => {
  const before = await readFile(oldBundle), after = await readFile(freshBundle), saved = globalThis.fetch
  for (const mode of ['new-source', 'late-cdn-update', 'still-failing', 'local-only']) {
    const f = await fixture(before), root = path.join(f.base, 'media'); await mkdir(root)
    const assets = ['1004007', '1122002'].map(id => ({ source: `Assets/Adventure/ImportChara/${id}.chapter.asset`, target: `Adventure/CharaScenario/CharaScenario${id}.book.json`, kind: 'book' }))
    const task = { id: 'cache-recovery', adapters: ['test'], provider: 'files', dryRun: true, downloadLimit: 1, source: { entries: [{ url: f.url, target: assets[0].target }] } }
    const ctx = { type: 'gal', item: { adapters: ['test'], source: { path: root } }, cacheDir: path.dirname(f.cache), script: { options: { tasks: [task] } } }
    let requests = 0
    globalThis.fetch = async (url, options) => { requests++; if (mode === 'late-cdn-update') assert.ok(!Object.keys(options.headers || {}).length, 'forced retry must bypass conditional validators'); return new Response(mode === 'still-failing' ? before : after, { headers: { ETag: '"new"' } }) }
    try {
      const preview = await generateTags(ctx), planPath = preview.details.tasks[0].planPath, plan = JSON.parse(await readFile(planPath))
      plan.entries[0].bundle = true; plan.entries[0].assets = assets; await writeFile(planPath, JSON.stringify(plan))
      await writeFile(f.file + '.json', JSON.stringify({ ...f.record, sourceStamp: mode === 'new-source' ? 'previous-apk' : plan.sourceStamp }))
      task.dryRun = false
      if (mode === 'local-only') task.actions = ['extract']
      const output = await generateTags(ctx), result = JSON.parse(await readFile(path.join(output.details.runDir, 'result.json'))).results[0]
      if (mode === 'local-only') { assert.equal(requests, 0); assert.equal(result.failureSummary.extract, 1); continue }
      assert.equal(requests, 1, 'one refresh per entry, never an unbounded extraction retry')
      if (mode === 'still-failing') { assert.equal(result.failureSummary.extract, 1); assert.equal(result.cacheStats.retryFailed, 1); assert.deepEqual(await readdir(root), []); continue }
      assert.equal(result.status, 'completed'); assert.equal(result.categoryTotals.writtenFiles, 2); assert.deepEqual(result.failureSummary, { download: 0, extract: 0, write: 0 })
      assert.equal(result.cacheStats.refreshed, 1); assert.equal(result.cacheStats.recovered, mode === 'late-cdn-update' ? 1 : 0)
      for (const asset of assets) { const book = JSON.parse(await readFile(path.join(root, asset.target))); assert.ok(book.importGridList.length); assert.ok(parseBook(JSON.stringify(book)).steps.length > 0); assert.equal(book.m_Name, path.basename(asset.target).replace('.json', '')) }
      const backup = result.entries[0].cacheBackups[0]; assert.deepEqual(await readFile(backup.file), before)
      assert.ok(backup.file.startsWith(result.cacheBackupDir + path.sep))
      await generateTags(ctx); assert.equal(requests, 1, 'written chapters skip on rerun')
    } finally { globalThis.fetch = saved; await archiveToTmp(f.base) }
  }
})

const subjugation = '.cache/tsk-logs-055149/495ee746f8d944fb4a755c8f107aa720.bundle'
test('current CDN event scenario exports and imports in the real Utage adapter', { skip: !existsSync(subjugation) }, async () => {
  const { extractTsk } = await import('../tag-scripts/gal-download/tsk.mjs')
  const asset = { source: 'Assets/Adventure/SubjugationEventScenario/SubjugationEventScenario0041.chapter.asset', target: 'Adventure/SubjugationEventScenario/SubjugationEventScenario0041.book.json', kind: 'book' }
  const out = await extractTsk({ bundle: subjugation, assets: [asset] })
  const text = Buffer.from(out.exports[0].data).toString()
  assert.equal(JSON.parse(text).m_Name, 'SubjugationEventScenario0041.book')
  assert.ok(parseBook(text).steps.length > 0)
})
