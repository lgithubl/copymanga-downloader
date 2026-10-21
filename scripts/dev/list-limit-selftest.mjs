#!/usr/bin/env node
// 回归：媒体库列表接口的条数上限。
//   - 不分页的 GET /api/library/items?type=… 只返回最新的一小批（IMPORT_LIST_LIMIT），不是全库；
//   - 分页接口的 limit 一律在 1~1000，0 / 负数 / 非数字 / 超大都不会变成「全部」；
//   - 索引没就绪时不分页的请求不能把全库扫一遍（那条路径在几十万条时会让服务长时间无响应）。
// 用法：node scripts/dev/list-limit-selftest.mjs   （自己起一个临时服务，不需要任何外部依赖）
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArchiveGalleryHandler } from '../../web/library/types/archive-gallery.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const N = 130
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'list-limit-'))
const cfg = { archiveCacheDir: path.join(dataDir, 'cache', 'ac'), mediaImportProfiles: { 'archive-gallery': { managedDir: path.join(dataDir, 'm') } }, mediaImportSourceRoots: '/input' }
const handler = createArchiveGalleryHandler({ type: 'archive', dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async () => false, getConfig: () => cfg })
for (let i = 0; i < N; i++) {
  const id = createHash('sha1').update(`item-${i}`).digest('hex')
  await handler.internals.writeItem(handler.internals.buildItem({
    itemId: id, title: `条目 ${i}`, tags: [`标签:t${i % 7}`], zipPath: `/x/${i}.zip`, external: true, size: 1, mtimeMs: 1, pageCount: 3,
    sourceProfile: 'archive-gallery', createdAt: new Date(1.7e12 + i * 1000).toISOString(),
  }))
}

const port = 8096
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
const base = `http://127.0.0.1:${port}`
for (let i = 0; i < 100; i++) {
  try { await fetch(`${base}/health`); break } catch { await new Promise((r) => setTimeout(r, 200)) }
}
const get = async (p) => (await fetch(base + p)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  // 索引还没建（缓存缺失）：分页接口返回空 + 索引状态
  const early = await get('/api/library/items?type=archive&page=1&limit=10')
  check('索引缺失时分页接口返回空并带索引状态', early.items.length === 0 && early.index?.status !== 'ready', JSON.stringify(early.index))

  await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
  for (let i = 0; i < 100; i++) {
    const p = await get('/api/library/items?type=archive&page=1&limit=1')
    if (p.index.status === 'ready') break
    await sleep(300)
  }

  const unpaged = await get('/api/library/items?type=archive')
  check(`不分页接口只返回最新一小批（${N} 条里的 50 条），不是全库`, Array.isArray(unpaged) && unpaged.length === 50, String(unpaged.length))
  check('不分页接口返回的是最新的（按导入时间倒序）', unpaged[0]?.title === `条目 ${N - 1}`, unpaged[0]?.title)

  for (const [query, expected, note] of [
    ['limit=10', 10, '正常'],
    ['limit=0', 50, '0 不是「全部」，按默认 50'],
    ['limit=-1', 1, '负数夹到 1，不是「全部」'],
    ['limit=abc', 50, '非数字按默认 50'],
    ['limit=100000', N, '超大夹到 1000（这里一共才 130 条）'],
  ]) {
    const page = await get(`/api/library/items?type=archive&page=1&${query}`)
    check(`分页 ${query}：${note}`, page.items.length === expected && page.limit >= 1 && page.limit <= 1000, `${page.items.length} limit=${page.limit}`)
  }
  const last = await get('/api/library/items?type=archive&page=3&limit=50')
  check('翻页：第 3 页（每页 50）剩 30 条，总页数 3', last.items.length === 30 && last.totalPages === 3 && last.total === N, JSON.stringify([last.items.length, last.totalPages, last.total]))
  const beyond = await get('/api/library/items?type=archive&page=99&limit=50')
  check('页码越界：返回空列表而不是全库', beyond.items.length === 0, String(beyond.items.length))
} finally {
  server.kill('SIGTERM')
  await rm(dataDir, { recursive: true, force: true }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
