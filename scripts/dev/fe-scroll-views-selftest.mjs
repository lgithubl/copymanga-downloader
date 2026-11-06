#!/usr/bin/env node
// 浏览器自测：图片浏览 / 媒体浏览 / 库页 三处的悬浮 ▲ 自动 ▼，以及三处频率下拉框共用同一个设置。起真服务端 + 真实 Chromium，往视图里塞一块很高的内容。
//   PLAYWRIGHT_PATH=<@playwright/test> [CHROME=<chrome>] node scripts/dev/fe-scroll-views-selftest.mjs
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const work = await mkdtemp(path.join(os.tmpdir(), 'fe-scrollviews-'))
const port = 8119
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: path.join(work, 'data'), PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
let browser
try {
  browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(base)
  await page.waitForSelector('#viewer-images', { state: 'attached' })
  await page.evaluate(() => localStorage.setItem('copymanga.scrollAutoRate', '3'))
  await page.reload()
  await page.waitForSelector('#viewer-images', { state: 'attached' })
  const rates = await page.$$eval('.scroll-auto-rate', (s) => s.map((x) => [x.id, x.value]))
  check('三个频率下拉框（库页 / 图片浏览 / 媒体浏览）都读到同一个存储值', rates.length === 3 && rates.every(([, v]) => v === '3'), JSON.stringify(rates))
  await page.evaluate(() => { const s = document.querySelector('#viewer-scroll-auto-rate'); s.value = '0.5'; s.dispatchEvent(new Event('change')) })
  const after = await page.$$eval('.scroll-auto-rate', (s) => s.map((x) => x.value))
  check('改一个，另两个跟着变，并写入 localStorage', after.every((v) => v === '0.5') && (await page.evaluate(() => localStorage.getItem('copymanga.scrollAutoRate'))) === '0.5', JSON.stringify(after))
  await page.evaluate(() => { const s = document.querySelector('#viewer-scroll-auto-rate'); s.value = '2'; s.dispatchEvent(new Event('change')) })

  const cases = [
    { name: '图片浏览', view: '#viewer-view', box: '#viewer-images' },
    { name: '媒体浏览', view: '#media-viewer-view', box: '#media-reader-content' },
  ]
  for (const c of cases) {
    await page.evaluate(({ view, box }) => {
      document.querySelectorAll('.view.active').forEach((v) => v.classList.remove('active'))
      document.querySelector(view).classList.add('active')
      const el = document.querySelector(box)
      el.classList.remove('empty-panel')
      el.style.height = '400px'
      el.innerHTML = '<div style="height:8000px">x</div>'
      el.scrollTop = 0
    }, c)
    await page.waitForFunction((view) => { const b = document.querySelector(`${view} .scroll-btns`); return b && !b.hidden }, c.view)
    const labels = await page.$$eval(`${c.view} .scroll-btns button`, (b) => b.map((x) => x.textContent))
    check(`${c.name}：▲ 自动 ▼，自动在中间`, JSON.stringify(labels) === JSON.stringify(['▲', '自动', '▼']), JSON.stringify(labels))
    const top = () => page.$eval(c.box, (e) => Math.round(e.scrollTop))
    await page.click(`${c.view} .scroll-btn-down`); await page.waitForTimeout(700)
    const t0 = await top()
    check(`${c.name}：▼ 滚一段（≈ 80% 可视高度 = 320px）`, t0 > 250 && t0 < 400, String(t0))
    await page.click(`${c.view} .scroll-btn-auto`); await page.waitForTimeout(2300)
    const t1 = (await top()) - t0
    check(`${c.name}：自动 = 按频率（2 次/秒）点 ▼，2.3 秒 ≈ 5 段`, t1 >= 1000 && t1 <= 2000, String(t1))
    await page.click(`${c.view} .scroll-btn-auto`); const t2 = await top(); await sleep(1200)
    check(`${c.name}：再点「停」不再滚`, (await top()) === t2)
    const visible = await page.$$eval('.scroll-btns', (bs) => bs.filter((b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed' && getComputedStyle(b).display !== 'none').length)
    check(`${c.name}：别的视图的按钮不显示（只显示当前这个）`, visible === 1, String(visible))
  }
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
