import { test, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

// Linux may report EXDEV before checking source existence when /data and /tmp
// are separate mounts. Exercise the real mv fallback on every archive attempt.
const rename = fs.rename.bind(fs)
mock.method(fs, 'rename', async (source, target) => {
  if (target.startsWith('/tmp/gal-download-archive/')) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
  return rename(source, target)
})
syncBuiltinESMExports()
after(() => { mock.restoreAll(); syncBuiltinESMExports() })
const { archiveToTmp } = await import('../tag-scripts/gal-download/archive.mjs')
const { generateTags } = await import('../tag-scripts/gal-download/main.js')

test('cross-device archive ignores an already renamed partial and preserves existing files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gal-cross-device-'))
  try {
    assert.equal(await archiveToTmp(path.join(directory, `${randomUUID()}.part`)), null)
    const source = path.join(directory, 'failed.part')
    await fs.writeFile(source, 'partial bytes')
    const archived = await archiveToTmp(source)
    assert.equal(await fs.readFile(archived, 'utf8'), 'partial bytes')
    await assert.rejects(fs.stat(source), { code: 'ENOENT' })
    // A missing child caused by a non-directory parent is a real error.
    const parent = path.join(directory, 'plain-file')
    await fs.writeFile(parent, 'keep')
    await assert.rejects(archiveToTmp(path.join(parent, 'child')))
  } finally { await archiveToTmp(directory) }
})

test('cross-device cleanup allows download, extraction, and cached resume using the same plan', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gal-cross-device-download-'))
  const root = path.join(directory, 'media')
  await fs.mkdir(root)
  let requests = 0
  const server = http.createServer((req, res) => { requests++; res.end(`payload:${req.url}`) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const task = { id: 'resume', adapters: ['test'], provider: 'files', source: { entries: [
    { url: `http://127.0.0.1:${server.address().port}/a`, target: 'a.bin' },
    { url: `http://127.0.0.1:${server.address().port}/b`, target: 'b.bin' },
  ] } }
  const run = async (options) => {
    const output = await generateTags({ type: 'gal', item: { adapters: ['test'], source: { path: root } }, cacheDir: path.join(directory, 'cache'), script: { options: { tasks: [{ ...task, ...options }] } } })
    return JSON.parse(await fs.readFile(path.join(output.details.runDir, 'result.json'), 'utf8')).results[0]
  }
  try {
    await run({ dryRun: true, downloadLimit: 0 })
    assert.equal(requests, 0)
    const first = await run({ dryRun: false, downloadLimit: 1 })
    assert.equal(first.summary.written, 1)
    assert.equal(first.summary.failed, undefined)
    assert.equal(requests, 1)
    // Restore a missing exported file from cache even with a fresh-download limit.
    await archiveToTmp(path.join(root, 'a.bin'))
    const resume = await run({ dryRun: false, downloadLimit: 1 })
    assert.equal(resume.summary.written, 2)
    assert.equal(requests, 2)
    const final = await run({ dryRun: false, downloadLimit: 0 })
    assert.equal(final.summary['skip-existing'], 2)
    assert.equal(requests, 2)
    assert.equal(await fs.readFile(path.join(root, 'a.bin'), 'utf8'), 'payload:/a')
    assert.equal(await fs.readFile(path.join(root, 'b.bin'), 'utf8'), 'payload:/b')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await archiveToTmp(directory)
  }
})
