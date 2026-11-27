import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { registerGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { invalidateContexts } from '../../web/library/gal/context.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  until = async (fn) => {
    for (let i = 0; i < 200; i++) {
      if (await fn()) return
      await sleep(10)
    }
    assert.fail('timeout')
  }
test('actual import/reader/cache-status/refresh and restart snapshot keep pages usable and preserve errors', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'gal-cache-handler-')),
    source = path.join(dataDir, 'source')
  await mkdir(path.join(source, 'script'), { recursive: true })
  await writeFile(path.join(source, 'meta.txt'), 'one')
  await writeFile(path.join(source, 'script', 'scene.txt'), 'CACHE-SCENE\ntext')
  let gate = null,
    fail = false,
    builds = 0
  registerGalAdapter({
    id: 'cache-fixture',
    label: 'Cache fixture',
    sniff: (t) => t.startsWith('CACHE-SCENE'),
    contextFiles: () => ['meta.txt'],
    contextDirs: () => ['script'],
    prepare: async ({ texts }) => {
      builds++
      if (gate) await gate
      if (fail) throw Error('fixture parse failed')
      return { title: texts['meta.txt'] }
    },
    catalog: (ctx) => ({
      title: 'Fixture',
      children: [{ id: 'scene', title: ctx.title, script: 'script/scene.txt', subtitle: 'data ' + ctx.title }],
    }),
    parse: () => ({
      steps: [{ index: 0, commands: [{ op: 'text', segments: [{ text: 'body' }] }] }],
      stats: { commands: 1, raw: {} },
    }),
  })
  const create = () =>
      createGalHandler({
        dataDir,
        safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'),
        pathExists: async (p) => existsSync(p),
        getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: source } } }),
      }),
    handler = create()
  const result = await handler.importFromSource({
      sourcePath: source,
      options: {
        adapters: ['cache-fixture'],
        config: {
          scriptRoots: [{ id: 'main', dir: 'script' }],
          resourceRoots: [''],
          scriptExtensions: ['txt'],
          thumbFallback: { max: 0 },
        },
      },
    }),
    id = result.items[0].itemId
  const first = await handler.getReaderContent(id, 'main')
  assert.equal(first.node.items[0].title, 'one')
  assert.equal(builds, 1)
  let release
  gate = new Promise((r) => (release = r))
  await writeFile(path.join(source, 'meta.txt'), 'two')
  const refresh = await handler.refreshIndex(id)
  assert.ok(['queued', 'running'].includes(refresh.status))
  await until(() => builds === 2)
  const t = performance.now(),
    stale = await handler.getReaderContent(id, 'main')
  assert.equal(stale.node.items[0].title, 'one')
  assert.ok(performance.now() - t < 200, 'cached reader is not waiting on blocked prepare')
  await handler.refreshIndex(id)
  release()
  gate = null
  await until(async () => (await handler.cacheStatus(id)).status === 'ready')
  assert.equal((await handler.getReaderContent(id, 'main')).node.items[0].title, 'two')
  assert.equal(builds, 2)
  // Simulate lost process contexts while retaining the persisted homepage data.
  invalidateContexts(await realpath(source))
  let warmRelease
  gate = new Promise((r) => (warmRelease = r))
  const restarted = create(),
    saved = await restarted.getReaderContent(id, 'main')
  assert.equal(saved.node.items[0].title, 'two')
  await until(() => builds === 3)
  assert.ok(['queued', 'running'].includes((await restarted.cacheStatus(id)).status))
  warmRelease()
  gate = null
  await until(async () => (await restarted.cacheStatus(id)).status === 'ready')
  fail = true
  await restarted.refreshIndex(id)
  await until(async () => (await restarted.cacheStatus(id)).status === 'error')
  const old = await restarted.getReaderContent(id, 'main')
  assert.equal(old.node.items[0].title, 'two')
  assert.match(old.cache.error, /fixture parse failed/)
  console.log('Verified artifacts retained:', dataDir)
})
