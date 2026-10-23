#!/usr/bin/env node
// 浏览器自测：很多个标签页同时搜索不会卡死。
//   PLAYWRIGHT_PATH=<@playwright/test> [BIG_ITEMS=60000] node scripts/dev/fe-tabs-selftest.mjs
//   · 点标签开出来的搜索页（#/library?tab=new…）是「只读页」：只发 1 个启动请求（/api/library/boot），
//     不开 SSE、不轮询，也不请求 jobs / downloaded / reading-progress / inventory-update / history / config / types / metadata-actions
//   · 用户在这个页里切到别的视图时才启动后台同步；普通页面（没有 tab=new）的行为不变
//   · 同一个浏览器的普通页面只开 1 条 SSE（Web Locks 选组长，BroadcastChannel 转发事件），组长关了自动换人；后台页不轮询
//   · 服务端：并发 tag 搜索（倒排索引）不会把事件循环占满
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
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

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
  await sleep(1500)   // 等标签倒排索引分批建好
  await fetch(q(0))
  let worst = 0
  let stop = false
  const beat = (async () => { while (!stop) { const t = performance.now(); await fetch(`${base}/health`); worst = Math.max(worst, performance.now() - t); await sleep(20) } })()
  const t0 = performance.now()
  const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => fetch(q(i)).then((r) => r.json())))
  const took = performance.now() - t0
  stop = true
  await beat
  check(`服务端：${ITEMS} 条的库，8 个并发 tag 搜索都有结果`, results.every((r) => r.total > 0 && r.items.length > 0), JSON.stringify(results.map((r) => r.total)))
  check(`服务端：8 个并发搜索总共 < ${Math.round(ITEMS / 300)}ms，期间 /health 没被堵住`, took < ITEMS / 300 && worst < 300, `${took.toFixed(0)}ms / health 最长 ${worst.toFixed(0)}ms`)

  // ---- 浏览器 ----
  browser = await chromium.launch()
  const context = await browser.newContext()
  const pending = new Map()
  const apiCalls = new Map()    // 页名 → [路径]
  const errors = []
  const watch = (page, name) => {
    apiCalls.set(name, [])
    page.on('request', (r) => {
      const u = r.url().replace(base, '')
      pending.set(r, { name, page, url: u })
      if (u.startsWith('/api/') && !u.includes('/thumbnail/')) apiCalls.get(name).push(u.split('?')[0])   // 缩略图请求不算（由 ThumbLoader 另测）
    })
    page.on('requestfinished', (r) => pending.delete(r))
    page.on('requestfailed', (r) => pending.delete(r))
    page.on('pageerror', (e) => errors.push(e.message))
    // 缩略图不是这个测试关心的：直接回一个 1 像素图
    page.route('**/thumbnail/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  }
  const sse = () => [...pending.values()].filter((r) => r.url === '/api/events' && !r.page.isClosed()).map(({ name }) => name)
  const cardsOf = (page) => page.waitForFunction(() => document.querySelectorAll('#library-items .library-card').length > 0, null, { timeout: 20000 }).then(() => true, () => false)
  const newTabRoute = (i) => `${base}/#/library?tab=new&tag=${encodeURIComponent(`作者:作者${i}`)}`
  const FORBIDDEN = ['/api/events', '/api/jobs', '/api/downloaded', '/api/reading-progress', '/api/inventory-update', '/api/library/history', '/api/config', '/api/library/types', '/api/metadata-actions', '/api/library/items']

  // 一、8 个 tab=new 搜索页同时打开
  const tabs = []
  for (let i = 1; i <= 8; i++) { const page = await context.newPage(); watch(page, `搜索页${i}`); tabs.push(page) }
  const s0 = performance.now()
  await Promise.all(tabs.map((page, i) => page.goto(newTabRoute(i + 1), { waitUntil: 'commit' })))
  const shown = await Promise.all(tabs.map(cardsOf))
  check(`8 个搜索页（tab=new）同时点开：都出结果（${Math.round(performance.now() - s0)}ms）`, shown.every(Boolean), JSON.stringify(shown))
  await sleep(1500)
  const callsOf = (name) => apiCalls.get(name)
  check('搜索页只发 1 个 API 请求：/api/library/boot（配置 + 类型 + 列表 + 元数据脚本一起取回）', tabs.every((_, i) => JSON.stringify(callsOf(`搜索页${i + 1}`)) === JSON.stringify(['/api/library/boot'])), JSON.stringify(callsOf('搜索页1')))
  check('搜索页不请求 SSE / jobs / downloaded / reading-progress / inventory-update / history / config / types / metadata-actions / 单独的列表', tabs.every((_, i) => callsOf(`搜索页${i + 1}`).every((c) => !FORBIDDEN.includes(c))))
  check('8 个搜索页：没有任何 SSE 长连接占着浏览器的连接', sse().length === 0, JSON.stringify(sse()))
  const rendered = await tabs[0].evaluate(() => ({ cfg: document.querySelector('#config-library-thumb-batch')?.value, types: document.querySelectorAll('#library-type option').length, tag: document.querySelector('#library-tag-search')?.value, scripts: document.querySelectorAll('input[name="library-tag-script"]').length }))
  check('启动请求带回的东西都应用到了页面：配置（缩略图设置）、类型下拉、URL 里的标签条件、元数据脚本', rendered.cfg === '60' && rendered.types > 1 && rendered.tag === '作者:作者1' && rendered.scripts >= 0, JSON.stringify(rendered))

  // 二、再开第 9 个：照样秒出
  const p9 = await context.newPage(); watch(p9, '搜索页9')
  const s9 = performance.now()
  await p9.goto(newTabRoute(9), { waitUntil: 'commit' })
  check(`再开第 9 个搜索页：照样很快出结果（${Math.round(performance.now() - s9)}ms）`, await cardsOf(p9) && performance.now() - s9 < 10000)

  // 三、在搜索页里翻页 / 重新搜索：走普通的列表接口（带 ETag），不再是启动接口
  const pager = await context.newPage(); watch(pager, '翻页页')
  await pager.goto(`${base}/#/library?tab=new&tag=${encodeURIComponent('语言:中文')}&limit=20`, { waitUntil: 'commit' })
  await cardsOf(pager)
  await pager.evaluate(() => document.querySelector('#library-next')?.click())
  await pager.waitForFunction(() => document.querySelector('#library-page')?.value === '2', null, { timeout: 8000 }).catch(() => {})
  await sleep(600)
  const pagerCalls = callsOf('翻页页')
  check('在搜索页里翻页：走 /api/library/items（带进度，不再取 history / types / config），启动接口只用了一次', (await pager.$eval('#library-page', (e) => e.value)) === '2' && pagerCalls.includes('/api/library/items') && !pagerCalls.includes('/api/library/history') && pagerCalls.filter((c) => c === '/api/library/boot').length === 1 && JSON.stringify(pagerCalls) === JSON.stringify(['/api/library/boot', '/api/library/items']), JSON.stringify(pagerCalls))
  await pager.close()

  // 四、在搜索页里切到别的视图：这时才启动后台同步
  const view = await context.newPage(); watch(view, '切视图页')
  await view.goto(newTabRoute(11), { waitUntil: 'commit' })
  await cardsOf(view)
  const before = callsOf('切视图页').length
  await view.evaluate(() => document.querySelector('.tab[data-view="downloaded-view"]')?.click())
  await sleep(1500)
  const after = callsOf('切视图页').slice(before)
  check('切到别的视图（下载）：才启动后台同步 —— 补任务快照、取 downloaded / reading-progress / inventory-update，并加入 SSE 组', ['/api/jobs', '/api/downloaded', '/api/reading-progress', '/api/inventory-update'].every((c) => after.includes(c)) && sse().length === 1, JSON.stringify({ after, sse: sse() }))
  await view.close()
  await sleep(300)

  // 五、普通页面（没有 tab=new）行为不变：照旧启动后台同步、用普通的列表接口，不走启动接口
  const normals = []
  for (let i = 1; i <= 4; i++) { const page = await context.newPage(); watch(page, `普通页${i}`); normals.push(page) }
  await Promise.all(normals.map((page) => page.goto(`${base}/#/library`, { waitUntil: 'commit' })))
  await Promise.all(normals.map(cardsOf))
  await sleep(1500)
  check('普通页面：照旧启动后台同步（任务快照 / downloaded / reading-progress / inventory-update）+ 普通列表接口，不走 /api/library/boot', normals.every((_, i) => { const c = callsOf(`普通页${i + 1}`); return ['/api/jobs', '/api/downloaded', '/api/library/types', '/api/library/items'].every((x) => c.includes(x)) && !c.includes('/api/library/boot') }), JSON.stringify(callsOf('普通页1')))
  check('普通页面里卡片上的「继续」进度不再单独取 /api/library/history', normals.every((_, i) => !callsOf(`普通页${i + 1}`).includes('/api/library/history')))
  check('4 个普通页 + 其它页：整个浏览器只有 1 条 SSE', sse().length === 1, JSON.stringify(sse()))

  // 事件转发：组长收到的事件，别的标签页也能收到
  await normals[0].evaluate(() => new BroadcastChannel('copymanga-server-events').postMessage({ kind: 'event', type: 'job', data: { id: 'relay-1', comicTitle: 'RelayTest', status: 'running', message: 'm', doneChapters: 0, totalChapters: 1, doneImages: 0, totalImages: 0, createdAt: new Date().toISOString() } }))
  await sleep(500)
  const seen = await Promise.all(normals.slice(1).map((page) => page.evaluate(() => document.querySelector('#jobs')?.textContent.includes('RelayTest'))))
  check('事件转发：一个标签页发到频道里的任务事件，其余普通标签页都更新了任务列表', seen.every(Boolean), JSON.stringify(seen))

  // 组长关了：另一个接班
  const leaderName = sse()[0]
  const everyPage = [...tabs, p9, ...normals]
  const names = [...tabs.map((_, i) => `搜索页${i + 1}`), '搜索页9', ...normals.map((_, i) => `普通页${i + 1}`)]
  const leaderPage = everyPage[names.indexOf(leaderName)]
  await leaderPage.close()
  await sleep(1500)
  check('组长标签页关了：另一个标签页自动接班，仍然只有 1 条 SSE', sse().length === 1 && sse()[0] !== leaderName, JSON.stringify(sse()))

  // 后台标签页不轮询：模拟「页面不可见」，之后的一段时间里它不再请求 /api/jobs
  const hiddenPage = normals.find((page) => !page.isClosed())
  const hiddenName = names[everyPage.indexOf(hiddenPage)]
  await hiddenPage.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await sleep(300)
  const jobsBefore = callsOf(hiddenName).filter((c) => c === '/api/jobs').length
  await sleep(7000)   // 轮询间隔 5 秒：不可见时这段时间里应该一条都没有
  const jobsAfter = callsOf(hiddenName).filter((c) => c === '/api/jobs').length
  check('不可见的标签页不轮询 /api/jobs（7 秒内 0 次）', jobsAfter === jobsBefore, `${jobsBefore} → ${jobsAfter}`)
  await hiddenPage.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
  await sleep(800)
  check('切回可见：立刻对齐一次并恢复轮询', callsOf(hiddenName).filter((c) => c === '/api/jobs').length > jobsAfter)
  check('没有页面错误', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.stack?.split('\n').slice(0, 3).join(' | ')}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
