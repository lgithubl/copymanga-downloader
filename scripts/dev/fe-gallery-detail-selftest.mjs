#!/usr/bin/env node
// 浏览器自测：图集阅读（沉浸）控制条里的「更多 › 详情」——标题 / 标签，标签可点击（和库页卡片同一套全局处理）；右下滚动条上不弹控制条。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gallery-detail-selftest.mjs     需要 ImageMagick（造图）和 python3
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

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-gdetail-'))
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
const port = 8118
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

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/media/archive/${item.itemId}`)
  await page.waitForSelector('.media-image-list img', { timeout: 30000 })
  await page.waitForFunction(() => document.querySelector('#app').classList.contains('stream-immersive'), null, { timeout: 8000 })
  // 沉浸：贴底唤出控制条
  await page.mouse.move(400, 790)
  await page.waitForFunction(() => document.querySelector('#app').classList.contains('stream-chrome-visible'))
  check('图集沉浸控制条里有「更多」', Boolean(await page.$('.gallery-bar .gallery-more-btn')))
  await page.click('.gallery-bar .gallery-more-btn')
  check('点「更多」展开菜单，里面有「详情」', await page.$eval('.gallery-more-menu', (e) => !e.hidden) && Boolean(await page.$('.gallery-more-menu .gallery-detail-btn')))
  await page.click('.gallery-detail-btn')
  const detail = await page.evaluate(() => {
    const panel = document.querySelector('.media-detail-panel')
    return { shown: Boolean(panel) && !panel.hidden, text: panel?.textContent || '', pills: [...(panel?.querySelectorAll('.tag-pill[data-tag]') || [])].map((e) => e.dataset.tag), kind: panel?.dataset.kind, menuHidden: document.querySelector('.gallery-more-menu').hidden }
  })
  check('详情面板：标题、标签数量、标签列表（带 data-tag），面板带 data-kind；点开后「更多」菜单收起', detail.shown && /样式-系列成员2/.test(detail.text) && detail.pills.length > 5 && detail.kind !== undefined && detail.menuHidden, J({ shown: detail.shown, n: detail.pills.length, kind: detail.kind, menuHidden: detail.menuHidden }))
  await sleep(2800)   // 超过控制条的自动隐藏时间：详情开着时控制条不能收起
  check('详情开着时控制条不会自动收起', await page.evaluate(() => document.querySelector('#app').classList.contains('stream-chrome-visible')))
  // 点标签：走全局处理（这里没配新标签页规则 → 在本页跳到库页并填入 tag 搜索）
  const first = detail.pills.find((t) => t.startsWith('语言:')) || detail.pills[0]
  await page.click(`.media-detail-panel .tag-pill[data-tag="${first.replace(/"/g, '\\"')}"]`)
  await page.waitForFunction(() => document.querySelector('#library-view')?.classList.contains('active'), null, { timeout: 8000 })
  const search = await page.$eval('#library-tag-search', (e) => e.value)
  check('点详情里的标签：跳到库页并搜索这个标签（和库页卡片上的标签一样）', search.includes(first), search)
  check('点标签后详情面板收起', await page.evaluate(() => document.querySelector('.media-detail-panel').hidden))

  // 右下角：鼠标在底部且在右侧滚动条上，不弹控制条
  await page.goto(`${base}/#/media/archive/${item.itemId}`)
  await page.waitForSelector('.media-image-list img', { timeout: 30000 })
  await page.waitForFunction(() => document.querySelector('#app').classList.contains('stream-immersive'))
  await sleep(3500)
  await page.evaluate(() => document.querySelector('#app').classList.remove('stream-chrome-visible'))
  const geo = await page.evaluate(() => { const c = document.querySelector('.media-reader-content'); const r = c.getBoundingClientRect(); return { right: r.right, sb: c.offsetWidth - c.clientWidth } })
  await page.mouse.move(400, 300)
  await page.mouse.move(geo.right - Math.max(2, geo.sb / 2), 795)
  await sleep(500)
  const onBar = await page.evaluate(() => document.querySelector('#app').classList.contains('stream-chrome-visible'))
  await page.mouse.move(400, 795)
  await sleep(500)
  const mid = await page.evaluate(() => document.querySelector('#app').classList.contains('stream-chrome-visible'))
  // 无头浏览器的滚动条是覆盖式的（宽 0），这时只能验证「底部其它位置照常弹出」；有真实滚动条宽度时才验证「滚动条上不弹」
  check(`右下角：底部其它位置照常弹出${geo.sb > 0 ? '；鼠标在右侧滚动条上不弹控制条' : '（本环境滚动条宽 0，滚动条那一段没法测）'}`, geo.sb > 0 ? (!onBar && mid) : mid, J({ geo, onBar, mid }))
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
