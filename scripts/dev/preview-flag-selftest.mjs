#!/usr/bin/env node
// 回归：索引里的 hasPreview（卡片悬停预览的门槛）和缩略图 404。
//   - hasPreview 来自元数据结构：封面是章节生成的缩略图、且该章节缩略图 ready 带 previewUrl；只有迁移带来的封面 → false；
//   - 缩略图/预览不存在返回 404（以前是 500 加堆栈，每个没预览的条目首次悬停都刷一段日志）；
//   - hasPreview 随 NDJSON 索引缓存往返（重启后还在）；旧的缓存（没有这个字段）能读进来、按 false 处理，不崩。
// 用法：node scripts/dev/preview-flag-selftest.mjs   （自己起临时服务）
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArchiveGalleryHandler } from '../../web/library/types/archive-gallery.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'preview-flag-'))
const cfg = { archiveCacheDir: path.join(dataDir, 'cache', 'ac'), mediaImportProfiles: { 'archive-gallery': { managedDir: path.join(dataDir, 'm') } }, mediaImportSourceRoots: '/input' }
const handler = createArchiveGalleryHandler({ type: 'archive', dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async () => false, getConfig: () => cfg })
const { internals } = handler
const idOf = (name) => createHash('sha1').update(name).digest('hex')
const A = idOf('with-preview'), B = idOf('migrated-cover-only'), C = idOf('no-cover')
const mk = (id, title, cover) => internals.writeItem(internals.buildItem({ itemId: id, title, tags: [], zipPath: `/x/${title}.zip`, external: true, size: 1, mtimeMs: 1, pageCount: 3, sourceProfile: 'archive-gallery', cover }))
await mk(A, '有预览', internals.thumbnailUrl(A))
await mk(B, '只有迁移封面', internals.thumbnailUrl(B))
await mk(C, '没有封面', '')
await internals.updateItem(A, (item) => ({ ...item, mediaUnits: [{ ...item.mediaUnits[0], thumbnail: { status: 'ready', coverUrl: internals.thumbnailUrl(A), previewUrl: internals.thumbnailUrl(A, 'preview') } }] }))
for (const [id, file] of [[A, internals.paths.thumbPath(A)], [A, internals.paths.previewPath(A)], [B, internals.paths.thumbPath(B)]]) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))
}

let server
let log = ''
const base = 'http://127.0.0.1:8098'
async function start() {
  log = ''
  server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: '8098', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', (d) => { log += d })
  server.stderr.on('data', (d) => { log += d })
  for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); return } catch { await sleep(200) } }
  throw new Error('server did not start')
}
async function stop() {
  server.kill('SIGTERM')
  await new Promise((r) => server.once('exit', r))
}
const get = async (p) => (await fetch(base + p)).json()
const flags = async () => {
  const page = await get('/api/library/items?type=archive&page=1&limit=50')
  return Object.fromEntries(page.items.map((item) => [item.itemId, item.hasPreview]))
}
async function rebuild() {
  await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
  for (let i = 0; i < 100; i++) {
    const p = await get('/api/library/items?type=archive&page=1&limit=1')
    if (p.index.status === 'ready') return
    await sleep(200)
  }
}

try {
  await start()
  await rebuild()
  let f = await flags()
  check('hasPreview：封面是章节生成的缩略图且章节有 previewUrl → true', f[A] === true, JSON.stringify(f))
  check('hasPreview：只有迁移带来的封面（章节没有 thumbnail 记录）→ false', f[B] === false, JSON.stringify(f))
  check('hasPreview：没有封面 → false', f[C] === false, JSON.stringify(f))

  const statusOf = async (p) => { const r = await fetch(base + p); await r.arrayBuffer(); return r.status }
  check('预览存在 → 200', await statusOf(`/api/library/items/archive/${A}/thumbnail/zip/preview`) === 200)
  check('预览不存在（迁移封面条目）→ 404，不是 500', await statusOf(`/api/library/items/archive/${B}/thumbnail/zip/preview`) === 404)
  check('封面不存在 → 404', await statusOf(`/api/library/items/archive/${C}/thumbnail/zip/cover`) === 404)
  const body = await (await fetch(`${base}/api/library/items/archive/${B}/thumbnail/zip/preview`)).json()
  check('404 响应带错误信息', typeof body.error === 'string' && body.error.length > 0, JSON.stringify(body))
  await sleep(300)
  check('404 只打一行日志，不打堆栈', /\[http 404\]/.test(log) && !/at Object\.getThumbnail/.test(log), log.slice(-400))

  // 重启：从 NDJSON 缓存加载，hasPreview 还在
  await stop(); await start()
  f = await flags()
  check('重启后从索引缓存加载：hasPreview 保留', f[A] === true && f[B] === false, JSON.stringify(f))

  // 旧缓存（没有 hasPreview 字段）：能读进来、按 false 处理、不崩；重建一次后恢复
  await stop()
  const cache = path.join(dataDir, 'cache', 'library-index', 'media-items.0.ndjson')
  const stripped = (await readFile(cache, 'utf8')).replace(/,"hasPreview":(true|false)/g, '')
  check('（准备）缓存里确实去掉了 hasPreview 字段', !/hasPreview/.test(stripped))
  await writeFile(cache, stripped)
  await start()
  f = await flags()
  check('旧缓存：所有条目 hasPreview 为 false，列表正常（不崩）', Object.keys(f).length === 3 && Object.values(f).every((v) => v === false), JSON.stringify(f))
  await rebuild()
  f = await flags()
  check('重建一次索引后恢复 hasPreview', f[A] === true && f[B] === false, JSON.stringify(f))
} finally {
  if (server) server.kill('SIGTERM')
  await rm(dataDir, { recursive: true, force: true }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
