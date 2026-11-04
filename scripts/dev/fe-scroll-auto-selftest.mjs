#!/usr/bin/env node
// 浏览器自测：悬浮 ▲ 自动 ▼（web/static/scroll-buttons.js）。静态页 + 真实 Chromium：
//   PLAYWRIGHT_PATH=<@playwright/test 或 playwright-core 的路径> [CHROME=<chrome 可执行文件>] node scripts/dev/fe-scroll-auto-selftest.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 playwright：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const page_html = '<!doctype html><html><body style="margin:0"><div id="host"><div id="box" style="height:400px;overflow:auto"><div style="height:6000px">x</div></div></div><script type="module">import { createScrollButtons } from "/scroll-buttons.js"; window.rate = 2; createScrollButtons({ host: document.querySelector("#host"), getTarget: () => document.querySelector("#box"), getAutoRate: () => window.rate })</script></body></html>'
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(page_html); return }
  if (req.url === '/scroll-buttons.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(path.join(root, 'web/static/scroll-buttons.js'))); return }
  res.statusCode = 404; res.end()
}).listen(0)
const port = server.address().port
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForSelector('.scroll-btn-auto')
  const top = () => page.$eval('#box', (e) => Math.round(e.scrollTop))
  check('▲ 自动 ▼ 三个按钮，「自动」在中间', JSON.stringify(await page.$$eval('.scroll-btns button', (b) => b.map((x) => x.textContent))) === JSON.stringify(['▲', '自动', '▼']))
  await page.click('.scroll-btn-auto'); await page.waitForTimeout(2300)
  const t1 = await top()
  check('频率 2 次/秒：2.3 秒 ≈ 5 次 ▼（每次 80% 可视高度 = 320px）', t1 >= 1280 && t1 <= 1920, String(t1))
  await page.click('.scroll-btn-auto'); const t2 = await top(); await page.waitForTimeout(1200)
  check('再点「停」：不再滚', (await top()) === t2, `${t2} → ${await top()}`)
  await page.evaluate(() => { window.rate = 'max' })
  const s0 = await top(); await page.click('.scroll-btn-auto'); await page.waitForTimeout(1000)
  const moved = (await top()) - s0
  check("频率「max」：持续滚动（1 秒 ≈ 6 个 80% 可视高度 ≈ 1920px）", moved > 1200 && moved < 2600, String(moved))
  await page.mouse.move(200, 200); await page.mouse.wheel(0, 10); await page.waitForTimeout(300)
  check('手动滚轮会停掉自动', !(await page.$eval('.scroll-btn-auto', (e) => e.classList.contains('active'))))
  await page.click('.scroll-btn-auto'); await page.waitForTimeout(8000)
  check('滚到底自己停', (await top()) >= 5590 && !(await page.$eval('.scroll-btn-auto', (e) => e.classList.contains('active'))))
} finally { await browser.close(); server.close() }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
