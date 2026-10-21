#!/usr/bin/env node
// 回归：媒体库列表接口的条数上限。
//   - 不分页的 GET /api/library/items?type=… 只返回最新的一小批（IMPORT_LIST_LIMIT），不是全库；
//   - 分页接口的 limit 一律在 1~1000，0 / 负数 / 非数字 / 超大都不会变成「全部」；
//   - 不分页的请求只读内存索引，不看索引状态：索引还没建（空）→ 立刻返回空，不扫描全库、不写标签库；
//     重建进行中 → 立刻返回上一份索引里的数据，不等重建。曾经的回退路径会扫描全库并逐条写标签库，
//     几十万条时服务长时间无响应、响应体超过 V8 字符串上限。
// 用法：node scripts/dev/list-limit-selftest.mjs   （自己起一个临时服务，不需要任何外部依赖）
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArchiveGalleryHandler } from '../../web/library/types/archive-gallery.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 要足够大，重建才会持续几秒，才能在「重建进行中」这个状态下观察（太小一眨眼就建完了）
const N = Number(process.env.N || 30000)
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

  // 不分页接口在索引缺失时：立刻返回空，不扫描全库，也不去写标签库（磁盘上这 N 个条目带标签、标签库一开始是空的）
  let t = Date.now()
  const emptyList = await get('/api/library/items?type=archive')
  const emptyMs = Date.now() - t
  check(`索引缺失：不分页接口立刻返回空数组（${N} 个条目在盘上，耗时 ${emptyMs}ms，不扫描）`, Array.isArray(emptyList) && emptyList.length === 0 && emptyMs < 1500, `${emptyList.length} items ${emptyMs}ms`)
  await sleep(1500)
  const tagsAfter = await get('/api/library/tags?limit=20')
  const tagCount = Array.isArray(tagsAfter) ? tagsAfter.length : (tagsAfter.items || tagsAfter.tags || []).length
  check('索引缺失：不分页接口没有顺带去写标签库（标签库仍是空的）', tagCount === 0, JSON.stringify(tagsAfter).slice(0, 200))

  await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
  for (let i = 0; i < 100; i++) {
    const p = await get('/api/library/items?type=archive&page=1&limit=1')
    if (p.index.status === 'ready') break
    await sleep(300)
  }

  // 重建进行中：索引仍是上一份完整数据 → 不分页接口立刻返回旧数据，不等重建、不扫描
  await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
  await sleep(300)
  const building = await get('/api/library/items?type=archive&page=1&limit=1')
  t = Date.now()
  const stale = await get('/api/library/items?type=archive')
  const staleMs = Date.now() - t
  check(`重建进行中（状态 ${building.index.status}）：不分页接口立刻返回上一份索引的 50 条（耗时 ${staleMs}ms）`, stale.length === 50 && staleMs < 1500, `${stale.length} items ${staleMs}ms`)
  if (building.index.status !== 'building') console.log('  （提示：这次重建在请求前就完成了，没有真正在「重建进行中」观察到；可以把 N 调大）')
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
    ['limit=100000', 1000, '超大夹到 1000'],
  ]) {
    const page = await get(`/api/library/items?type=archive&page=1&${query}`)
    check(`分页 ${query}：${note}`, page.items.length === expected && page.limit >= 1 && page.limit <= 1000, `${page.items.length} limit=${page.limit}`)
  }
  const lastPage = Math.ceil(N / 50)
  const last = await get(`/api/library/items?type=archive&page=${lastPage}&limit=50`)
  check(`翻页：最后一页（第 ${lastPage} 页，每页 50）条数和总页数正确`, last.items.length === N - (lastPage - 1) * 50 && last.totalPages === lastPage && last.total === N, JSON.stringify([last.items.length, last.totalPages, last.total]))
  const beyond = await get(`/api/library/items?type=archive&page=${lastPage + 50}&limit=50`)
  check('页码越界：返回空列表而不是全库', beyond.items.length === 0, String(beyond.items.length))
} finally {
  server.kill('SIGTERM')
  await rm(dataDir, { recursive: true, force: true }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
