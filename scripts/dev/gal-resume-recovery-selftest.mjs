import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { loadReaderWithRecovery, readerRouteSectionId } from '../../web/static/gal-resume.js'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'

test('resuming a removed Tomoe chapter returns the current homepage and clears the stale route', async () => {
  const root = await mkdtemp('/tmp/gal-resume-')
  try {
    await mkdir(path.join(root, 'arc/script/Arc04/04'), { recursive: true })
    await writeFile(path.join(root, 'arc/script/Arc04/04/04_01_cg.tomoe'), JSON.stringify({ format: 'tomoe-arc04/1', events: [['T','opening'],['#',87]] }))
    const provider = createBrowseProvider({ mediaDir: root, config: { scriptRoots: [{ id: 'story', dir: 'arc/script' }], scriptExtensions: ['tomoe'], thumbFallback: { enabled: false } }, adapters: ['tomoe::arc04'], resolveAsset: async () => { throw Error('no resource') } })
    const calls = []
    const load = async sectionId => { calls.push(sectionId); try { const out = await provider.getNode(sectionId); return { ...out, type: 'gal', section: { sectionId: out.node.id } } } catch(error) { error.status = error.statusCode; throw error } }
    const old = 'd:Arc04/02'
    const out = await loadReaderWithRecovery({ load, type: 'gal', sectionId: old, resume: true })
    assert.deepEqual(calls, [old, ''])
    assert.equal(out.recovered, true)
    assert.equal(out.reader.section.sectionId, '')
    assert.equal(readerRouteSectionId(out.reader, old), '')
    assert.match(out.reader.node.notice, /上次阅读位置已失效/)
    assert.ok(out.reader.node.items.some(item => item.title === 'Arc04'))
    const existing = 's:Arc04/04/04_01_cg.tomoe'
    const valid = await loadReaderWithRecovery({ load, type: 'gal', sectionId: existing, resume: true })
    assert.equal(valid.recovered, false)
    assert.equal(readerRouteSectionId(valid.reader, existing), existing)
  } finally { await archiveToTmp(root) }
})

test('recovery applies only to missing Gal resume nodes; homepage/auth/server errors still propagate', async () => {
  for (const options of [{ type: 'gal', sectionId: 'old', resume: false }, { type: 'media', sectionId: 'old', resume: true }, { type: 'gal', sectionId: '', resume: true }]) {
    let calls = 0
    await assert.rejects(loadReaderWithRecovery({ ...options, load: async () => { calls++; throw Object.assign(Error('目录不存在'), { status: 404 }) } }), /目录不存在/)
    assert.equal(calls, 1)
  }
  for (const status of [400, 401, 403, 500]) {
    let calls = 0
    await assert.rejects(loadReaderWithRecovery({ type: 'gal', sectionId: 'old', resume: true, load: async () => { calls++; throw Object.assign(Error('error'), { status }) } }), /error/)
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(loadReaderWithRecovery({ type: 'gal', sectionId: 'old', resume: true, load: async () => { calls++; throw Object.assign(Error('missing'), { status: 404 }) } }), /missing/)
  assert.equal(calls, 2, 'a missing homepage must not trigger recursive retries')
})
