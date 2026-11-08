#!/usr/bin/env node
// 浏览器自测：图集阅读（沉浸）右侧 ▲ 自动 ▼——「自动」= 一直按住 ▼：同样的设置（分段 / 连续、速度、分段比例）下，和真的按住 ▼ 走出来的距离一样。
//   PLAYWRIGHT_PATH=<@playwright/test> [CHROME=<chrome>] node scripts/dev/fe-gallery-auto-selftest.mjs     需要 ImageMagick（造图）和 python3
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-gauto-'))
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
const port = 8121
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  // 灌一批压缩包图集（样式测试数据：很多 tag、超长标题…）
  execFileSync('node', ['scripts/dev/upload-visual-demo-data.mjs', base], { cwd: root, stdio: 'ignore', timeout: 400000 })
  const list = await (await fetch(`${base}/api/library/items?type=archive&keyword=${encodeURIComponent('样式-系列成员2')}&page=1&limit=5`)).json()
  const item = list.items[0]
  check('（准备）灌进了压缩包图集', Boolean(item), J(list).slice(0, 200))

  browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const open = async (settings) => {
    await page.goto('about:blank')   // 设置是进沉浸时读的：每个场景都要重新进
    await page.goto(`${base}/#/library`)
    await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }, settings)
    await page.goto(`${base}/#/media/archive/${item.itemId}`)
    await page.waitForSelector('.media-image-list img', { timeout: 30000 })
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('stream-immersive'), null, { timeout: 8000 })
    await sleep(1500)
    await page.evaluate(() => { const list = document.querySelector('.media-image-list'); const imgs = [...list.querySelectorAll('img')]; for (let i = 0; i < 60; i++) for (const img of imgs) list.append(img.cloneNode(true)) })   // 把内容撑长（克隆图片），不然几秒就滚到底了
    await page.waitForFunction(() => { const c = document.querySelector('.media-reader-content'); return c.scrollHeight > c.clientHeight * 20 }, null, { timeout: 30000 })
    await page.evaluate(() => { document.querySelector('.media-reader-content').scrollTop = 0 })
    await sleep(300)
  }
  const top = () => page.$eval('.media-reader-content', (c) => Math.round(c.scrollTop))
  const vh = () => page.$eval('.media-reader-content', (c) => c.clientHeight)
  const reset = async () => { await page.evaluate(() => { document.querySelector('.media-reader-content').scrollTop = 0 }); await sleep(300) }
  const holdDown = async (ms) => { const box = await (await page.$('.gallery-scroll-arrow[data-dir="1"]')).boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await sleep(ms); await page.mouse.up(); await sleep(400) }

  for (const [name, settings, ratio] of [
    ['分段 / 速度 3000 / 80%（和你的设置一样）', { 'copymanga.galleryScrollMode': 'step', 'copymanga.galleryScrollSpeed': '3000', 'copymanga.galleryScrollStepRatio': '0.8', 'copymanga.scrollAutoRate': '2' }, 0.8],
    ['分段 / 速度 1000 / 50%', { 'copymanga.galleryScrollMode': 'step', 'copymanga.galleryScrollSpeed': '1000', 'copymanga.galleryScrollStepRatio': '0.5', 'copymanga.scrollAutoRate': '2' }, 0.5],
    ['连续 / 速度 600', { 'copymanga.galleryScrollMode': 'smooth', 'copymanga.galleryScrollSpeed': '600', 'copymanga.scrollAutoRate': '2' }, 0.35],
  ]) {
    await open(settings)
    check(`${name}：箭头之间有「自动」按钮（▲ 自动 ▼）`, J(await page.$$eval('.gallery-scroll-nav button', (b) => b.map((x) => x.textContent))) === J(['▲', '⇊', '▼']))
    check(`${name}：模式 / 速度 / 分段比例在这个视图自己的「更多」菜单里，栏上没有`, (await page.$$('.gallery-more-menu .gallery-speed')).length >= 1 && (await page.$$('.gallery-more-menu .gallery-scroll-mode')).length === 1 && (await page.$$('.gallery-bar > .gallery-speed')).length === 0)
    check(`${name}：「更多」里有「自动滚动」滑块（11 档，当前每秒 2 次，和媒体库同一个设置）`, await page.$eval('.gallery-more-menu .gallery-auto-rate-input', (i) => i.max === '10' && i.value === '3') && (await page.$eval('.gallery-more-menu .gallery-auto-rate .gallery-speed-val', (e) => e.textContent)) === '每秒 2 次')
    await holdDown(2000)
    const held = await top()
    await reset()
    await page.evaluate(() => document.querySelector('.gallery-scroll-auto').click())
    await sleep(2000)
    const autoMid = await top()
    const pressed = await page.$eval('.gallery-scroll-auto', (b) => b.getAttribute('aria-pressed'))
    await page.evaluate(() => document.querySelector('.gallery-scroll-auto').click())
    await sleep(500)
    const after = await top()
    await sleep(800)
    // 自动按「自动滚动」滑块的每秒 N 次走（N = 2，一次 = 一个分段跳的距离），不再等于按住 ▼ 的 px/s
    const expected = 2 * 2 * (await vh()) * ratio
    check(`${name}：自动 2 秒滚的距离 ≈ 每秒 2 次 × 2 秒 × 一跳（期望 ${Math.round(expected)}px / 实际 ${autoMid}px，差 ≤ 40%）`, autoMid > 200 && Math.abs(autoMid - expected) <= expected * 0.4, J({ held, autoMid, expected }))
    check(`${name}：再点一次就停（不再滚）；按钮在自动中是「停」/ aria-pressed`, pressed === 'true' && (await top()) - after <= 2 && (await page.$eval('.gallery-scroll-auto', (b) => b.textContent)) === '⇊', J({ pressed, after, now: await top() }))
  }

  // 分段模式没有「每秒最多几次」的限制：每秒 10 次 × 每跳 15% 屏 → 1.5 屏/秒（以前 340ms 的下限会把它压到约 3 次/秒 = 0.45 屏/秒）
  await open({ 'copymanga.galleryScrollMode': 'step', 'copymanga.galleryScrollStepRatio': '0.15', 'copymanga.scrollAutoRate': '10' })
  await reset()
  await page.evaluate(() => document.querySelector('.gallery-scroll-auto').click())
  await sleep(1500)
  const fast = await top()
  await page.evaluate(() => document.querySelector('.gallery-scroll-auto').click())
  const fastExpected = 10 * 1.5 * 0.15 * (await vh())
  check(`分段 / 每秒 10 次 / 15%：1.5 秒滚的距离 ≈ 10 × 1.5 × 一跳（期望 ${Math.round(fastExpected)}px / 实际 ${fast}px，差 ≤ 35%）`, fast > fastExpected * 0.65 && fast < fastExpected * 1.35, J({ fast, fastExpected }))
  await sleep(500)

  // 滚轮 / 手动点 ▼ 会停掉自动；滚到底自己停
  await open({ 'copymanga.galleryScrollMode': 'step', 'copymanga.galleryScrollSpeed': '3000', 'copymanga.galleryScrollStepRatio': '0.8' })
  await page.evaluate(() => document.querySelector('.gallery-scroll-auto').click())
  await sleep(600)
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 10)
  await sleep(300)
  const t1 = await top(); await sleep(900)
  check('自动中滚轮 = 停', (await page.$eval('.gallery-scroll-auto', (b) => b.getAttribute('aria-pressed'))) === 'false' && (await top()) - t1 <= 2, J({ t1, now: await top() }))
  await reset()
  await page.evaluate(() => { const c = document.querySelector('.media-reader-content'); c.scrollTop = c.scrollHeight - c.clientHeight * 2.2 })
  await sleep(300)
  await page.evaluate(() => document.querySelector('.gallery-scroll-auto').click())
  await sleep(2500)
  check('自动滚到底就自己停', (await page.$eval('.gallery-scroll-auto', (b) => b.getAttribute('aria-pressed'))) === 'false' && (await page.$eval('.media-reader-content', (c) => c.scrollTop + c.clientHeight >= c.scrollHeight - 2)))
  check('没有页面错误', errors.length === 0, J(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message} @ ${(error.stack || '').split('\n')[1] || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
