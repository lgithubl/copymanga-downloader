import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { generateTags } from '../tag-scripts/gal-download/main.js'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'

test('task request spacing is shared by concurrent workers and retries; plans and cache hits never sleep', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gal-pacing-'))
  const root = path.join(directory, 'media'); await mkdir(root)
  const calls = [], attempts = new Map()
  let active = 0, maxActive = 0
  const server = http.createServer((req, res) => {
    calls.push({ url: req.url, at: performance.now() })
    const attempt = (attempts.get(req.url) || 0) + 1; attempts.set(req.url, attempt)
    if (req.url === '/a' && attempt < 3) { res.writeHead(503); res.end('retry'); return }
    active++; maxActive = Math.max(maxActive, active)
    setTimeout(() => { active--; res.end(`payload:${req.url}`) }, 250)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const task = { id: 'pace', adapters: ['test'], provider: 'files', concurrency: 3, source: { entries: ['a', 'b', 'c'].map(name => ({ url: `${base}/${name}`, target: `${name}.bin` })) } }
  const run = async (options) => generateTags({ type: 'gal', item: { adapters: ['test'], source: { path: root } }, cacheDir: path.join(directory, 'cache'), script: { options: { tasks: [{ ...task, ...options }] } } })
  try {
    let started = performance.now()
    const dry = await run({ dryRun: true, requestIntervalMs: 30000, retryDelayMs: 30000 })
    assert.equal(dry.details.status, 'completed')
    assert.equal(calls.length, 0)
    assert.ok(performance.now() - started < 5000, 'dryRun must not apply configured sleeps')
    const out = await run({ dryRun: false, requestIntervalMs: 100, retryDelayMs: 160 })
    assert.equal(out.details.status, 'completed')
    assert.equal(calls.length, 5)
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 80, 'shared request starts must be spaced even across different workers/retries')
    const retried = calls.filter(call => call.url === '/a')
    assert.equal(retried.length, 3)
    for (let i = 1; i < retried.length; i++) assert.ok(retried[i].at - retried[i - 1].at >= 145, 'retry delay must be applied')
    assert.ok(maxActive >= 2, 'spacing must not serialize in-flight downloads')
    const log = await readFile(out.details.logFile, 'utf8')
    assert.match(log, /请求间隔等待:/)
    assert.match(log, /重试等待: 160ms/)
    // Changing timing options must reuse the same plan and restore from cache.
    for (const name of ['a', 'b', 'c']) await archiveToTmp(path.join(root, `${name}.bin`))
    started = performance.now()
    const cached = await run({ dryRun: false, requestIntervalMs: 30000, retryDelayMs: 30000 })
    assert.equal(cached.details.status, 'completed')
    assert.equal(calls.length, 5)
    assert.ok(performance.now() - started < 5000, 'cached exports must not sleep')
    const invalid = await run({ dryRun: false, requestIntervalMs: -1 })
    assert.equal(invalid.details.status, 'failed')
    assert.match(invalid.logs.join('\n'), /requestIntervalMs 必须是/)
    assert.equal(calls.length, 5)
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await archiveToTmp(directory)
  }
})

test('task timeout interrupts an interval wait and releases the media lock', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gal-pacing-abort-'))
  const root = path.join(directory, 'media'); await mkdir(root)
  let requests = 0
  const server = http.createServer((req, res) => { requests++; res.end('ok') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const task = { id: 'abort', adapters: ['test'], provider: 'files', requestIntervalMs: 30000, concurrency: 2, source: { entries: ['a', 'b'].map(name => ({ url: `http://127.0.0.1:${server.address().port}/${name}`, target: name })) } }
  const run = (options) => generateTags({ type: 'gal', item: { adapters: ['test'], source: { path: root } }, cacheDir: path.join(directory, 'cache'), script: { options: { tasks: [{ ...task, ...options }] } } })
  try {
    await run({ dryRun: true })
    const started = performance.now()
    const aborted = await run({ dryRun: false, runTimeoutMs: 1000 })
    assert.equal(aborted.details.status, 'partial')
    const detail = aborted.details.results[0]
    assert.equal(detail.stopReason, 'timeout')
    assert.equal(detail.summary.interrupted, 1)
    assert.equal(detail.summary.deferred, 1)
    const log = await readFile(aborted.details.logFile, 'utf8')
    assert.match(log, /超时停止/)
    assert.doesNotMatch(log, /failed: http/)
    assert.equal(requests, 1)
    assert.ok(performance.now() - started < 5000, 'timeout must abort a long sleep')
    const resumed = await run({ dryRun: false, requestIntervalMs: 0 })
    assert.equal(resumed.details.status, 'completed', 'lock must be released after an aborted sleep')
    assert.equal(requests, 2, 'first completed request must be reused from cache')
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await archiveToTmp(directory)
  }
})
