import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readdir, readFile, cp, writeFile } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import http from 'node:http'
import { generateTags } from '../tag-scripts/gal-download/main.js'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'
const exec = promisify(execFile)

test('run.log exists and has phase progress before a download finishes', async () => {
  const base = await mkdtemp('/tmp/gdl-live-log-')
  const root = path.join(base, 'media'); await mkdir(root)
  const started = Promise.withResolvers()
  let response
  const server = http.createServer((req, res) => { response = res; started.resolve() })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const ctx = { type: 'gal', item: { adapters: ['test-adapter'], source: { path: root } }, cacheDir: path.join(base, 'cache'), script: { options: { tasks: [{ adapters: ['test-adapter'], dryRun: true, provider: 'files', source: { entries: [{ url: `http://127.0.0.1:${server.address().port}/file`, target: 'file' }] } }] } } }
  await generateTags(ctx)
  ctx.script.options.tasks[0].dryRun = false
  const run = generateTags(ctx)
  try {
    await started.promise
    const directory = (await readdir(path.join(base, 'cache/runs'))).sort().at(-1)
    const log = await readFile(path.join(base, 'cache/runs', directory, 'run.log'), 'utf8')
    assert.match(log, /下载/)
    const progress = JSON.parse(await readFile(path.join(base, 'cache/runs', directory, 'progress.json')))
    assert.match(progress.phase, /下载/)
  } finally {
    response?.end('contents')
    await run
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await archiveToTmp(base)
  }
})

test('preflight does not stat/realpath every catalog asset when their parent directory is missing', async () => {
  const base = await mkdtemp('/tmp/gdl-io-regression-')
  await mkdir(path.join(base, 'media'))
  const trace = path.join(base, 'trace.json')
  const source = `import {generateTags} from ${JSON.stringify(new URL('../tag-scripts/gal-download/main.js', import.meta.url).href)};
    const out=await generateTags({type:'gal',item:{adapters:['test-adapter'],source:{path:${JSON.stringify(path.join(base, 'media'))}}},cacheDir:${JSON.stringify(path.join(base, 'cache'))},script:{options:{tasks:[{adapters:['test-adapter'],dryRun:true,downloadLimit:3,provider:'files',actions:['download','extract'],source:{entries:Array.from({length:200},(_,i)=>({url:'https://example.invalid/'+i,target:'Stills/st_'+(i%20)+'/file_'+i+'.png'}))}}]}}});
    if(out.details.status!=='completed')throw Error(JSON.stringify(out));`
  try {
    await exec(process.execPath, ['--trace-event-categories', 'node.fs.async', '--trace-event-file-pattern', trace, '--input-type=module', '-e', source], { maxBuffer: 1000000 })
    const events = JSON.parse(await readFile(trace)).traceEvents
    const calls = events.filter((event) => event.ph === 'b' && /^(stat|lstat|realpath)$/.test(event.name))
    assert.ok(calls.length < 20, `200 missing targets caused ${calls.length} filesystem metadata calls`)
  } finally { await archiveToTmp(base) }
})

test('adapter gating and task dryRun/limit/concurrency/logPrefix are independent', async () => {
  const base = await mkdtemp('/tmp/gdl-task-isolation-')
  const root = path.join(base, 'media'); await mkdir(root)
  const counts = {}, active = {}, peaks = {}
  const server = http.createServer((req, res) => {
    const group = req.url.split('/')[1]
    counts[group] = (counts[group] || 0) + 1
    active[group] = (active[group] || 0) + 1
    peaks[group] = Math.max(peaks[group] || 0, active[group])
    setTimeout(() => { active[group]--; res.end(req.url) }, 25)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const task = (id, settings = {}) => ({ id, adapters: ['test-adapter'], provider: 'files', logPrefix: id, dryRun: false, downloadLimit: 2, concurrency: 2,
    source: { entries: [0, 1, 2].map((n) => ({ url: `http://127.0.0.1:${server.address().port}/${id}/${n}`, target: `${id}/${n}` })) }, ...settings })
  try {
    const ctx = { type: 'gal', item: { adapters: ['test-adapter'], source: { path: root } }, cacheDir: path.join(base, 'cache'), script: { options: { tasks: [
      task('blocked', { adapters: ['other-adapter'] }), task('preview', { dryRun: true, downloadLimit: 1 }), task('serial', { concurrency: 1 }), task('parallel')
    ] } } }
    await generateTags({ ...ctx, script: { options: { tasks: ctx.script.options.tasks.map((task) => ({ ...task, dryRun: true })) } } })
    const out = await generateTags(ctx)
    assert.equal(out.details.tasks[0].status, 'skipped')
    assert.equal(counts.blocked, undefined)
    assert.equal(counts.preview, undefined)
    assert.equal(counts.serial, 2)
    assert.equal(counts.parallel, 2)
    assert.equal(peaks.serial, 1)
    assert.equal(peaks.parallel, 2)
    for (const task of out.details.tasks.slice(1)) {
      assert.ok(path.basename(task.runDir).startsWith(task.id + '-'))
      assert.match(await readFile(task.logFile, 'utf8'), /阶段: 结束/)
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await archiveToTmp(base)
  }
})

test('a nonmatching adapter does not touch media/cache or request any download', async () => {
  const out = await generateTags({ type: 'gal', item: { adapters: ['uviewer-csv'], source: { path: '/nonexistent/media' } }, cacheDir: '/nonexistent/cache', script: { options: { tasks: [{ id: 'tsk', adapters: ['utage-book'], game: 'tsk', provider: 'tsk', dryRun: false }] } } })
  assert.equal(out.details.tasks[0].status, 'skipped')
  assert.equal(out.details.runDir, undefined)
  await assert.rejects(() => generateTags({ type: 'gal', script: { options: { dryRun: true, tasks: [] } } }), /移入各 tasks/)
})

test('uploading a new script package bypasses previously cached helper modules without a server restart', async () => {
  const base = await mkdtemp('/tmp/gdl-hot-upload-')
  const pkg = path.join(base, 'package'), media = path.join(base, 'media')
  await cp(fileURLToPath(new URL('../tag-scripts/gal-download/', import.meta.url)), pkg, { recursive: true })
  await mkdir(media)
  await writeFile(path.join(pkg, 'package.json'), '{"type":"module"}')
  const helper = path.join(pkg, 'worker-runner.mjs'), current = await readFile(helper)
  await writeFile(helper, 'export async function nativeTask(){throw Error("cached old helper was used")}')
  await import(pathToFileURL(helper).href)
  await writeFile(helper, current)
  const catalog = path.join(base, 'catalog.json'), zero = Buffer.alloc(4).toString('base64')
  await writeFile(catalog, JSON.stringify({ m_BucketDataString: zero, m_KeyDataString: zero, m_EntryDataString: zero, m_InternalIds: [], m_InternalIdPrefixes: [] }))
  try {
    const fresh = await import(pathToFileURL(path.join(pkg, 'main.js')).href + '?uploaded=new')
    const out = await fresh.generateTags({ type: 'gal', item: { adapters: ['utage-book'], source: { path: media } }, cacheDir: path.join(base, 'cache'), script: { options: { tasks: [{ id: 'hot', adapters: ['utage-book'], provider: 'tsk', dryRun: true, source: { type: 'catalog', path: catalog } }] } } })
    assert.equal(out.details.status, 'completed', out.logs.join('\n'))
  } finally { await archiveToTmp(base) }
})
