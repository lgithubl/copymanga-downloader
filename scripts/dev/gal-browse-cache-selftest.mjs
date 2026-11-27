import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, mkdir, writeFile, utimes } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createGalBrowseCache, browseSourceSignature } from '../../web/library/gal/browse-cache.mjs'
import { queueGalCacheBuild, inGalCacheBuild } from '../../web/library/gal/cache-jobs.mjs'
const tick = () => new Promise((r) => setImmediate(r)),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const wait = async (fn) => {
  for (let n = 0; n < 200; n++) {
    if (fn()) return
    await sleep(5)
  }
  assert.fail('timed out')
}
const fixture = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gal-browse-cache-'))
  let clock = 100000,
    source = 'one',
    n = 0,
    fail = false,
    block = null,
    invalidations = 0
  const options = { dir, now: () => clock, ttl: 100, checkInterval: 10 },
    cache = createGalBrowseCache(options),
    request = {
      id: dir,
      key: 'home',
      persist: true,
      signature: async () => source,
      invalidate: () => {
        invalidations++
      },
      build: async () => {
        n++
        if (block) await block
        if (fail) throw Error('test parse failure')
        return { node: { kind: 'cards', id: '', items: [{ title: 'version ' + n }], index: { files: n } } }
      },
    }
  return {
    dir,
    cache,
    request,
    options,
    get n() {
      return n
    },
    get invalidations() {
      return invalidations
    },
    advance() {
      clock += 200
    },
    source(s) {
      source = s
    },
    fail() {
      fail = true
    },
    block(p) {
      block = p
    },
  }
}
test('cold build deduplication, fast stale reads, changed source and atomic replacement', async () => {
  const f = await fixture(),
    first = await Promise.all([f.cache.get(f.request), f.cache.get(f.request)])
  assert.equal(f.n, 1)
  assert.deepEqual(first[0].value, first[1].value)
  let release
  f.block(new Promise((r) => (release = r)))
  f.advance()
  f.source('two')
  const stale = await f.cache.get(f.request)
  assert.equal(stale.value.node.items[0].title, 'version 1')
  await wait(() => f.n === 2)
  assert.ok(['queued', 'running'].includes(f.cache.status(f.request.id).status))
  assert.equal((await f.cache.get(f.request)).value.node.items[0].title, 'version 1')
  assert.equal(f.n, 2)
  release()
  await wait(() => f.cache.status(f.request.id).status === 'ready')
  assert.equal((await f.cache.get(f.request)).value.node.items[0].title, 'version 2')
  assert.equal(f.invalidations, 1)
})
test('failed rebuild retains in-memory and persisted snapshot and reports error', async () => {
  const f = await fixture()
  await f.cache.get(f.request)
  const before = await readFile(path.join(f.dir, 'home.json'), 'utf8')
  f.fail()
  await f.cache.refresh(f.request)
  await wait(() => f.cache.status(f.request.id).status === 'error')
  const result = await f.cache.get(f.request)
  assert.equal(result.value.node.items[0].title, 'version 1')
  assert.match(result.cache.error, /test parse failure/)
  assert.equal(await readFile(path.join(f.dir, 'home.json'), 'utf8'), before)
})
test('disk snapshot returns while restart warmup is blocked; incompatible key never reuses it', async () => {
  const f = await fixture()
  await f.cache.get(f.request)
  let release
  const restarted = createGalBrowseCache(f.options),
    request = {
      ...f.request,
      build: async () => {
        await new Promise((r) => (release = r))
        return { node: { kind: 'cards', items: [{ title: 'new' }] } }
      },
    }
  const got = await restarted.get(request)
  assert.equal(got.value.node.items[0].title, 'version 1')
  await wait(() => Boolean(release))
  release()
  await wait(() => restarted.status(request.id).status === 'ready')
  const other = await restarted.get({ ...f.request, id: 'changed-options', key: 'changed-options' })
  assert.notEqual(other.value.node.items[0].title, 'version 1')
})
test('one global rebuild lane across games, nested context work does not deadlock', async () => {
  let active = 0,
    max = 0
  await Promise.all(
    [1, 2, 3].map((id) =>
      queueGalCacheBuild('lane-test-' + id, async () => {
        active++
        max = Math.max(max, active)
        assert.equal(inGalCacheBuild(), true)
        await queueGalCacheBuild('nested-' + id, async () => {
          await sleep(5)
        })
        active--
      }),
    ),
  )
  assert.equal(max, 1)
})
test('manual refresh is nonblocking and duplicate clicks share a job', async () => {
  const f = await fixture()
  await f.cache.get(f.request)
  let release
  f.block(new Promise((r) => (release = r)))
  await f.cache.refresh(f.request)
  await f.cache.refresh(f.request)
  await wait(() => f.n === 2)
  assert.equal((await f.cache.get(f.request)).value.node.items[0].title, 'version 1')
  release()
  await wait(() => f.cache.status(f.request.id).status === 'ready')
  await tick()
  assert.equal(f.n, 2)
})

test('source signatures detect explicit data changes and exclude generated container outputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gal-cache-signature-'))
  await mkdir(path.join(root, 'arc/res'), { recursive: true })
  await writeFile(path.join(root, 'data.json'), 'one')
  await writeFile(path.join(root, 'game.arc'), 'source')
  const config = {
    resourceRoots: [''],
    scriptRoots: [{ dir: 'arc/script' }],
    containers: { enabled: true, dir: 'arc' },
  }
  const adapters = [{ contextFiles: () => ['data.json'], contextDirs: () => ['arc/res'] }]
  const first = await browseSourceSignature(root, config, adapters)
  await writeFile(path.join(root, 'arc/res', 'decoded.png'), 'generated')
  assert.equal(await browseSourceSignature(root, config, adapters), first)
  await writeFile(path.join(root, 'data.json'), 'two-longer')
  assert.notEqual(await browseSourceSignature(root, config, adapters), first)
  const second = await browseSourceSignature(root, config, adapters)
  await utimes(path.join(root, 'game.arc'), new Date(), new Date(Date.now() + 5000))
  assert.notEqual(await browseSourceSignature(root, config, adapters), second)
})
