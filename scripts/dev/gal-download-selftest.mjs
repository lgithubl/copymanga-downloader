import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink } from 'node:fs/promises'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { generateTags } from '../tag-scripts/gal-download/main.js'

test('download lifecycle: dryRun, limit, atomic output, cache repair, collection, errors', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gal-download-test-'))
  const media = path.join(dir, 'media')
  await mkdir(media)
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    if (req.url === '/fail') { res.writeHead(500); res.end(); return }
    res.end(`payload:${req.url}`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const ctx = (options) => ({ type: 'gal', item: { source: { path: media }, config: { game: { id: 'demo' } } }, cacheDir: path.join(dir, 'cache'), script: { options } })
  const tasks = [{ game: 'demo', provider: 'files', source: { entries: [
    { url: `${base}/a`, target: 'images/a.bin' },
    { url: `${base}/b`, target: 'images/b.bin' },
  ] } }]
  const run = async (options) => {
    const output = await generateTags(ctx({ tasks, ...options }))
    const full = JSON.parse(await readFile(path.join(output.details.runDir, 'result.json')))
    assert.deepEqual(output.itemTags, [])
    assert.match(await readFile(output.details.logFile, 'utf8'), /日志:/)
    return { ...output, full }
  }
  try {
    const dry = await run({ dryRun: true, logPrefix: '../debug', downloadLimit: 1 })
    assert.equal(requests, 0)
    assert.deepEqual(await readdir(media), [])
    assert.deepEqual(dry.full.results[0].summary, { 'would-download': 1, limited: 1 })
    const first = await run({ downloadLimit: 1 })
    assert.equal(requests, 1)
    assert.equal(await readFile(path.join(media, 'images/a.bin'), 'utf8'), 'payload:/a')
    assert.equal(first.full.results[0].summary.written, 1)
    assert.equal(first.full.results[0].summary.limited, 1)
    await run({ downloadLimit: 1 })
    assert.equal(requests, 2)
    const again = await run({ downloadLimit: 1 })
    assert.equal(requests, 2)
    assert.equal(again.full.results[0].summary.unchanged, 2)
    await writeFile(path.join(media, 'images/a.bin'), 'corrupted')
    await run({ downloadLimit: 1 })
    assert.equal(requests, 2, 'repair from cache without network')
    assert.equal(await readFile(path.join(media, 'images/a.bin'), 'utf8'), 'payload:/a')
    assert.ok(!(await readdir(path.join(media, 'images'))).some((name) => name.endsWith('.part')))
    const collect = await run({ tasks: [{ game: 'demo', actions: ['collect'], collectPatterns: ['images/*.bin'], collectSampleLimit: 1 }] })
    assert.equal(collect.full.results[0].collected, 2)
    assert.equal(collect.full.results[0].samples.length, 1)
    assert.equal(await readFile(path.join(path.dirname(collect.full.results[0].inventory), 'samples/images/a.bin'), 'utf8'), 'payload:/a')
    await symlink(dir, path.join(media, 'escape'))
    const escape = await run({ tasks: [{ provider: 'files', source: { entries: [{ url: `${base}/a`, target: 'escape/bad' }] } }] })
    assert.equal(escape.details.status, 'failed')
    assert.equal(requests, 2)
    const checksum = await run({ tasks: [{ provider: 'files', source: { entries: [{ url: `${base}/a`, target: 'bad', sha256: '0'.repeat(64) }] } }] })
    assert.equal(checksum.details.status, 'failed')
    assert.equal(requests, 5, 'invalid cache is not used; bounded retries')
    const mixed = await run({ tasks: [{ provider: 'invalid' }, { actions: ['collect'] }] })
    assert.equal(mixed.full.results[0].status, 'failed')
    assert.equal(mixed.full.results[1].status, 'completed')
    await writeFile(path.join(media, 'images/manual.bin'), 'manual')
    const readonly = await run({ tasks: [{ provider: 'files', source: { entries: [{ url: `${base}/b`, target: 'images/manual.bin' }] } }] })
    assert.equal(readonly.full.results[0].summary.preserved, 1)
    assert.equal(await readFile(path.join(media, 'images/manual.bin'), 'utf8'), 'manual')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await archiveToTmp(dir)
  }
})

test('deadline aborts requests and releases the media lock without publishing partial files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gal-download-timeout-'))
  const root = path.join(dir, 'media')
  await mkdir(root)
  const server = http.createServer((req, res) => { res.writeHead(200); res.write('partial') })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await generateTags({ type: 'gal', item: { source: { path: root } }, cacheDir: path.join(dir, 'cache'), script: { options: {
      runTimeoutMs: 1000,
      tasks: [{ provider: 'files', source: { entries: [{ url: `http://127.0.0.1:${server.address().port}/slow`, target: 'output' }] } }],
    } } })
    assert.equal(result.details.status, 'failed')
    assert.deepEqual(await readdir(root), [])
    assert.ok(!(await readdir(path.join(dir, 'cache'))).some((name) => name.startsWith('lock-')))
    assert.ok(!(await readdir(path.join(dir, 'cache/bundles'))).some((name) => name.endsWith('.part')))
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await archiveToTmp(dir)
  }
})
