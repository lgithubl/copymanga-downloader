#!/usr/bin/env node
// 浏览器自测：很多个标签页同时点标签搜索不会卡死。
//   - 同一个浏览器的所有标签页只开一条 SSE（Web Locks 选组长，BroadcastChannel 转发事件）；组长关了自动换人
//   - 8 个页面同时打开 #/library?tab=new&tag=…（大库：默认 6 万条）都能出结果，连浏览器的 6 连接上限都不会被 SSE 占满
//   - 后台标签页不轮询 /api/jobs
//   - 服务端：同一个 tag 搜索热了之后很快（条目的规整标签缓存），并发搜索不会把事件循环占满
//   PLAYWRIGHT_PATH=<@playwright/test> [BIG_ITEMS=60000] node scripts/dev/fe-tabs-selftest.mjs
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeBigIndex } from './make-big-index.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ITEMS = Number(process.env.BIG_ITEMS || 60000)

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-tabs-'))
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
await makeBigIndex(dataDir, ITEMS)
const port = 8111
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 200; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(250) } }
let browser
try {
  // ---- 服务端：并发 tag 搜索 ----
  const q = (n) => `${base}/api/library/items?type=all&tag=${encodeURIComponent(`作者:作者${n}`)}&page=1&limit=20`
  await sleep(1500)   // 等规整标签缓存分批预热完
  await fetch(q(0))
  let worst = 0
  let stop = false
  const beat = (async () => { while (!stop) { const t = performance.now(); await fetch(`${base}/health`); worst = Math.max(worst, performance.now() - t); await sleep(20) } })()
  const t0 = performance.now()
  const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => fetch(q(i)).then((r) => r.json())))
  const took = performance.now() - t0
  stop = true
  await beat
  check(`服务端：${ITEMS} 条的库，8 个并发 tag 搜索都有结果（每个作者 ${Math.round(ITEMS / 5000)} 条左右）`, results.every((r) => r.total > 0 && r.items.length > 0), JSON.stringify(results.map((r) => r.total)))
  check(`服务端：8 个并发搜索总共 < ${Math.round(ITEMS / 300)}ms（规整标签缓存生效；以前每次都对整库重新规整），期间 /health 没被堵住`, took < ITEMS / 300 && worst < 300, `${took.toFixed(0)}ms / health 最长 ${worst.toFixed(0)}ms`)

  // ---- 浏览器：8 个标签页 ----
  browser = await chromium.launch()
  const context = await browser.newContext()
  const pending = new Map()
  const pages = []
  const jobsRequests = []
  const watch = (page, name) => {
    page.on('request', (r) => { pending.set(r, { name, page, url: r.url().replace(base, '') }); if (/\/api\/jobs/.test(r.url())) jobsRequests.push({ name, at: Date.now() }) })
    page.on('requestfinished', (r) => pending.delete(r))
    page.on('requestfailed', (r) => pending.delete(r))
  }
  const errors = []
  for (let i = 1; i <= 8; i++) { const page = await context.newPage(); watch(page, `页${i}`); page.on('pageerror', (e) => errors.push(e.message)); pages.push(page) }
  const route = (i) => `${base}/#/library?tab=new&tag=${encodeURIComponent(`作者:作者${i}`)}`
  const s0 = performance.now()
  await Promise.all(pages.map((page, i) => page.goto(route(i + 1), { waitUntil: 'commit' })))
  const cardsOf = (page) => page.waitForFunction(() => document.querySelectorAll('#library-items .library-card').length > 0, null, { timeout: 20000 }).then(() => true, () => false)
  const shown = await Promise.all(pages.map(cardsOf))
  check(`8 个页面同时点开标签搜索：都出结果（${Math.round(performance.now() - s0)}ms）`, shown.every(Boolean), JSON.stringify(shown))
  await sleep(1500)
  const sse = () => [...pending.values()].filter((r) => r.url === '/api/events' && !r.page.isClosed()).map(({ name, url }) => ({ name, url }))   // 关掉的页面没有 requestfailed 事件，要排除
  check('同一个浏览器的 8 个标签页只有 1 条 SSE（/api/events）在占连接', sse().length === 1, JSON.stringify(sse()))
  // 页面 9：新开的也不被卡
  const p9 = await context.newPage(); watch(p9, '页9')
  const s9 = performance.now()
  await p9.goto(route(9), { waitUntil: 'commit' })
  check(`再开第 9 个页面：照样秒出结果（${Math.round(performance.now() - s9)}ms 内）`, await cardsOf(p9) && performance.now() - s9 < 10000)
  check('依然只有 1 条 SSE', sse().length === 1, JSON.stringify(sse()))

  // 事件转发：组长收到的事件，别的标签页也能收到（这里直接往频道里发一条 job 事件，看别的页面的任务列表）
  await pages[0].evaluate(() => new BroadcastChannel('copymanga-server-events').postMessage({ kind: 'event', type: 'job', data: { id: 'relay-1', comicTitle: 'RelayTest', status: 'running', message: 'm', doneChapters: 0, totalChapters: 1, doneImages: 0, totalImages: 0, createdAt: new Date().toISOString() } }))
  await sleep(500)
  const seen = await Promise.all(pages.slice(1).map((page) => page.evaluate(() => document.querySelector('#jobs')?.textContent.includes('RelayTest'))))
  check('事件转发：一个标签页发到频道里的任务事件，其余标签页都更新了任务列表', seen.every(Boolean), JSON.stringify(seen))

  // 组长关了：另一个接班
  const leader = sse()[0].name
  const leaderPage = [...pages, p9].find((_, i) => `页${i < 8 ? i + 1 : 9}` === leader)
  await leaderPage.close()
  await sleep(1500)
  check('组长标签页关了：另一个标签页自动接班，仍然是 1 条 SSE', sse().length === 1 && sse()[0].name !== leader, JSON.stringify(sse()))

  // 后台标签页不轮询：模拟「页面不可见」，之后的一段时间里它不再请求 /api/jobs
  const hiddenPage = pages.find((page) => !page.isClosed() && page !== leaderPage)
  const hiddenName = [...pages, p9].indexOf(hiddenPage) < 8 ? `页${[...pages, p9].indexOf(hiddenPage) + 1}` : '页9'
  await hiddenPage.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await sleep(300)
  const before = jobsRequests.filter((r) => r.name === hiddenName).length
  await sleep(7000)   // 轮询间隔 5 秒：不可见时这段时间里应该一条都没有
  const after = jobsRequests.filter((r) => r.name === hiddenName).length
  check('不可见的标签页不轮询 /api/jobs（7 秒内 0 次）', after === before, `${before} → ${after}`)
  await hiddenPage.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
  await sleep(800)
  check('切回可见：立刻对齐一次并恢复轮询', jobsRequests.filter((r) => r.name === hiddenName).length > after)
  check('没有页面错误', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message.split('\n')[0]}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
