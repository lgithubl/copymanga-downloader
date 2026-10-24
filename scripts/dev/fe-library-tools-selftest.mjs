#!/usr/bin/env node
// 浏览器自测：库页的 卡片宽度 / 页面总宽度（拖动，复用阅读宽度那套参考线）、封面放大倍率、页内匹配（只管当前页）、tab=new 的分批渲染。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-library-tools-selftest.mjs
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
const J = JSON.stringify
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-libtools-'))
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
await makeBigIndex(dataDir, 3000)
const port = 8116
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 200; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(150) } }

let browser
try {
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.route(/\/thumbnail\/cover/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const cards = () => page.$$eval('#library-items > .library-card', (es) => es.length)
  const firstCardWidth = () => page.$eval('#library-items > .library-card', (e) => Math.round(e.getBoundingClientRect().width))
  const openMore = async () => { if (!(await page.$eval('#library-view .library-more-controls', (d) => d.open))) await page.click('#library-view .library-more-controls summary') }

  // ---- 一、卡片宽度 ----
  await page.goto(`${base}/#/library?limit=100`)
  await page.waitForFunction(() => document.querySelectorAll('#library-items > .library-card').length === 100)
  const before = await firstCardWidth()
  await openMore()
  await page.click('#library-card-width')
  await page.waitForSelector('.media-width-layer')
  const label = await page.$eval('.media-width-label span', (e) => e.textContent)
  const rightEdge = await page.$eval('.media-width-edge-right', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 } })
  const leftIsFixed = await page.$eval('.media-width-edge-left', (e) => getComputedStyle(e).pointerEvents === 'none')
  await page.mouse.move(rightEdge.x, rightEdge.y)
  await page.mouse.down()
  await page.mouse.move(rightEdge.x - 40, rightEdge.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.media-width-layer'))
  const stored = Number(await page.evaluate(() => localStorage.getItem('copymanga.libraryCardWidth')))
  const after = await firstCardWidth()
  check('卡片宽度：单边参考线（左线固定在第一张卡片左边，只拖右线），提示条单位是 px / 张', /px \/ 张/.test(label) && leftIsFixed, label)
  check('卡片宽度：向左拖 40px 后卡片变窄（≈ 原宽 − 40），存进 localStorage，列表切到固定列宽', stored > 0 && Math.abs(after - (before - 40)) <= 4 && Math.abs(stored - after) <= 2 && (await page.$eval('#library-items', (e) => e.classList.contains('library-card-fixed'))), J({ before, after, stored }))
  await page.reload()
  await page.waitForFunction(() => document.querySelectorAll('#library-items > .library-card').length === 100)
  check('卡片宽度：刷新后保持', Math.abs((await firstCardWidth()) - after) <= 2, String(await firstCardWidth()))
  await openMore()
  await page.click('#library-card-width')
  await page.waitForSelector('.media-width-reset')
  await page.click('.media-width-reset')
  await page.waitForFunction(() => !document.querySelector('.media-width-layer'))
  check('卡片宽度：重置默认 = 清掉存储、回到 auto-fill', (await page.evaluate(() => localStorage.getItem('copymanga.libraryCardWidth'))) === null && !(await page.$eval('#library-items', (e) => e.classList.contains('library-card-fixed'))) && Math.abs((await firstCardWidth()) - before) <= 2)

  // ---- 二、页面总宽度 ----
  const fullWidth = await page.$eval('#library-view', (e) => Math.round(e.getBoundingClientRect().width))
  await openMore()
  await page.click('#library-page-width')
  await page.waitForSelector('.media-width-layer')
  const pageEdge = await page.$eval('.media-width-edge-right', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 } })
  await page.mouse.move(pageEdge.x, pageEdge.y)
  await page.mouse.down()
  await page.mouse.move(pageEdge.x - 200, pageEdge.y, { steps: 5 })   // 右线向里 200 → 总宽度 = 2 × (线到中心的距离)（对称）
  await page.mouse.up()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.media-width-layer'))
  const narrowed = await page.$eval('#library-view', (e) => ({ w: Math.round(e.getBoundingClientRect().width), left: Math.round(e.getBoundingClientRect().left), cls: e.classList.contains('library-width-custom') }))
  const expected = 2 * (pageEdge.x - 200 - fullWidth / 2)
  check('页面总宽度：居中对称拖动（起步比铺满窄一点，线才抓得住）；右线向里 200px → 总宽度 = 2 × 线到中心的距离，且仍居中', narrowed.cls && Math.abs(narrowed.w - expected) <= 8 && Math.abs(narrowed.left - (fullWidth - narrowed.w) / 2) <= 4, J({ fullWidth, expected, narrowed }))
  await openMore()
  await page.click('#library-page-width')
  await page.waitForSelector('.media-width-reset')
  await page.click('.media-width-reset')
  await page.waitForFunction(() => !document.querySelector('.media-width-layer'))
  check('页面总宽度：重置默认 = 铺满', Math.abs((await page.$eval('#library-view', (e) => Math.round(e.getBoundingClientRect().width))) - fullWidth) <= 2)

  // ---- 三、封面放大倍率 ----
  await openMore()
  const defaultRatio = await page.$eval('#library-hover-ratio', (e) => e.value)
  await page.fill('#library-hover-ratio', '1.4')
  await page.dispatchEvent('#library-hover-ratio', 'change')
  check('封面放大倍率：默认 1.8，改成 1.4 存进 localStorage', defaultRatio === '1.8' && (await page.evaluate(() => localStorage.getItem('copymanga.hoverRatio'))) === '1.4')
  await page.click('#library-view .library-more-controls summary')   // 收起菜单

  // ---- 四、页内匹配（只管当前页）----
  await page.click('#library-find')
  await page.keyboard.type('标题 2950')
  await sleep(300)
  const f1 = await page.evaluate(() => ({ count: document.querySelector('#library-find-count').textContent, current: document.querySelectorAll('.library-find-current').length, hits: document.querySelectorAll('.library-find-hit').length }))
  check('页内匹配：输入后命中 1 张（标题含「标题 2950」），计数 1/1，当前项高亮', f1.count === '1/1' && f1.current === 1, J(f1))
  await page.fill('#library-find', '标题 29')
  await sleep(300)
  const f2 = await page.evaluate(() => ({ count: document.querySelector('#library-find-count').textContent, hits: document.querySelectorAll('.library-find-hit').length }))
  await page.keyboard.press('Enter')
  await sleep(200)
  const f3 = await page.$eval('#library-find-count', (e) => e.textContent)
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  const f4 = await page.$eval('#library-find-count', (e) => e.textContent)
  check('页内匹配：「标题 29」命中本页 100 张（只管当前页）；Enter 下一个、Shift+Enter 上一个、到头循环', f2.count === '1/100' && f2.hits === 100 && f3 === '2/100' && f4 === '100/100', J({ f2, f3, f4 }))
  await page.fill('#library-find', '作者:不存在')
  await sleep(200)
  check('页内匹配：按标签也能匹配；没有命中显示「无」、输入框标红、上下按钮禁用', (await page.$eval('#library-find-count', (e) => e.textContent)) === '无' && (await page.$eval('#library-find', (e) => e.classList.contains('library-find-empty'))) && (await page.$eval('#library-find-next', (e) => e.disabled)))
  await page.fill('#library-find', '作者:作者2950')
  await sleep(200)
  check('页内匹配：按标签「作者:作者2950」命中', (await page.$eval('#library-find-count', (e) => e.textContent)) === '1/1')
  await page.keyboard.press('Escape')
  check('页内匹配：Esc 清空并清掉高亮', (await page.$eval('#library-find', (e) => e.value)) === '' && (await page.$$eval('.library-find-hit', (es) => es.length)) === 0)
  await page.keyboard.press('Control+f')
  check('Ctrl+F：库页里聚焦页内匹配框', await page.evaluate(() => document.activeElement?.id === 'library-find'))

  // ---- 五、tab=new：分批渲染 ----
  const lazy = await context.newPage()
  lazy.on('pageerror', (e) => errors.push(e.message))
  await lazy.goto(`${base}/#/library?tab=new&limit=100`)
  await lazy.waitForFunction(() => document.querySelectorAll('#library-items > .library-card').length > 0)
  const lazyCards = () => lazy.$$eval('#library-items > .library-card', (es) => es.length)
  const first = await lazyCards()
  check('tab=new：一页 100 张只先建第一批（40 张），底部有哨兵', first === 40 && (await lazy.$$('.library-lazy-sentinel')).length === 1, String(first))
  await lazy.click('#library-find')
  await lazy.keyboard.type('标题 2905')   // 第 95 张（按导入日期倒序：2999 在最前）
  await lazy.waitForFunction(() => document.querySelectorAll('#library-items > .library-card').length >= 95)
  await sleep(700)
  const jumped = await lazy.evaluate(() => {
    const card = document.querySelector('.library-find-current')
    const r = card?.getBoundingClientRect()
    return { found: Boolean(card), inView: Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight + 4), title: card?.querySelector('.card-title')?.textContent }
  })
  check('tab=new：匹配到还没建出来的卡片 → 按需建到那里并滚到视口里', jumped.found && /2905/.test(jumped.title || ''), J(jumped))
  await lazy.keyboard.press('Escape')
  await lazy.evaluate(() => document.querySelector('#library-items').scrollTo(0, 1e7))
  await lazy.waitForFunction(() => document.querySelectorAll('#library-items > .library-card').length === 100, null, { timeout: 8000 }).catch(() => {})
  check('tab=new：滚到底部附近继续分批，最终 100 张建完、哨兵消失', (await lazyCards()) === 100 && (await lazy.$$('.library-lazy-sentinel')).length === 0, String(await lazyCards()))
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
