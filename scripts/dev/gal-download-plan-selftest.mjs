import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, chmod } from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { generateTags } from '../tag-scripts/gal-download/main.js'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'

test('dryRun saves a complete plan, execution reads it without reparsing source, and logs existing skips', async () => {
  const base = await mkdtemp('/tmp/gdl-plan-flow-')
  const root = path.join(base, 'media'); await mkdir(root)
  let requests = 0
  const server = http.createServer((req, res) => { requests++; res.end(req.url) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const source = path.join(base, 'files.json')
  const entries = [0, 1, 2].map((i) => ({ url: `http://127.0.0.1:${server.address().port}/${i}`, target: `file-${i}` }))
  await writeFile(source, JSON.stringify({ entries }))
  const task = { id: 'demo', adapters: ['test-adapter'], dryRun: false, downloadLimit: 1, provider: 'files', source: { path: source } }
  const ctx = { type: 'gal', item: { adapters: ['test-adapter'], source: { path: root } }, cacheDir: path.join(base, 'cache'), script: { options: { tasks: [task] } } }
  try {
    const missing = await generateTags(ctx)
    assert.equal(missing.details.status, 'failed')
    assert.match(missing.logs.join('\n'), /没有 plan/)
    assert.equal(requests, 0)
    task.dryRun = true
    const preview = await generateTags(ctx)
    const plan = JSON.parse(await readFile(preview.details.tasks[0].planPath))
    assert.equal(plan.entries.length, 3, 'limit must not truncate persisted plan')
    assert.equal(requests, 0)
    // A file appearing after plan creation must still be skipped at execution.
    await writeFile(path.join(root, 'file-0'), 'already here')
    // Execution only stats the source to detect changes; it must not open/reparse it.
    await chmod(source, 0)
    task.dryRun = false; task.downloadLimit = 2; task.logPrefix = 'execute-demo'
    const execution = await generateTags(ctx)
    assert.equal(execution.details.status, 'completed')
    assert.equal(requests, 2)
    assert.equal(await readFile(path.join(root, 'file-0'), 'utf8'), 'already here')
    const log = await readFile(execution.details.tasks[0].logFile, 'utf8')
    assert.match(log, /使用已有 plan/)
    assert.match(log, /skip-existing: file-0/)
    assert.doesNotMatch(log, /生成 plan：解析/)
    const again = await generateTags(ctx)
    assert.equal(again.details.results[0].summary['skip-existing'], 3)
    assert.equal(requests, 2)
    // Editing source invalidates the saved plan, without starting downloads.
    await chmod(source, 0o600)
    await writeFile(source, JSON.stringify({ entries: entries.slice(0, 1) }))
    const stale = await generateTags(ctx)
    assert.equal(stale.details.status, 'failed')
    assert.match(stale.logs.join('\n'), /plan 与 APK\/关键配置不一致/)
    assert.equal(requests, 2)
  } finally {
    await chmod(source, 0o600)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await archiveToTmp(base)
  }
})
