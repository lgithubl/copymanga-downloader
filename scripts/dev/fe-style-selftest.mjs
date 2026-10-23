#!/usr/bin/env node
// 浏览器样式压力自测：极长标题 / 很多很长的标签 / 各种比例的封面（make-style-stress-fixture）+ Gal 大目录，
// 在多个视口和主题下检查：没有横向滚动条、卡片内的元素不超出卡片、详情（停靠 / 浮动）不超出视口、Gal 工具栏和翻页条能换行。截图在 SHOT_DIR。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-style-selftest.mjs
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStyleStressFixture } from './make-style-stress-fixture.mjs'
import { buildBigGalFixture } from './make-gal-big-fixture.mjs'
import { buildGalFixture } from './make-gal-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test'))
} catch {
  console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH')
  process.exit(2)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/style-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-style-'))
await buildStyleStressFixture(dataDir, 120)
await buildGalFixture(path.join(dataDir, 'gal', 'UViewer演示'), {})
await buildBigGalFixture(path.join(dataDir, 'gal', '大目录'), { characters: 40, perCharacter: 8, room: 300 })
const port = 8105
const base = `http://127.0.0.1:${port}`
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
const importGal = async (name) => {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', path.join(dataDir, 'gal', name)); form.set('profileOptions', '{}')
  const r = await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })
  return r.json().catch(() => ({}))
}
await importGal('UViewer演示'); await importGal('大目录')
await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
for (let i = 0; i < 150; i++) { const p = await (await fetch(`${base}/api/library/items?page=1&limit=1`)).json(); if (p.index?.status === 'ready' && p.total >= 100) break; await sleep(200) }

const browser = await chromium.launch()
const errors = []

// 容器内的元素不超出容器左右边界（忽略 fixed / 隐藏 / 零尺寸元素；允许 1px 误差）
const escapes = (page, containerSel, innerSel = '*') => page.evaluate(([c, inner]) => {
  const out = []
  for (const box of document.querySelectorAll(c)) {
    const b = box.getBoundingClientRect()
    for (const el of box.querySelectorAll(inner)) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      if (r.right > b.right + 1.5 || r.left < b.left - 1.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} +${Math.round(Math.max(r.right - b.right, b.left - r.left))}px in ${box.className.slice(0, 30)}`)
      if (out.length > 5) return out
    }
  }
  return out
}, [containerSel, innerSel])
const hOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const fits = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, sw: e.scrollWidth - e.clientWidth } }).catch(() => null)

const viewports = [[1920, 1080], [1280, 800], [900, 700], [390, 800]]
const themes = ['site-theme-light', 'site-theme-dark', 'site-theme-warm']
for (const [vw, vh] of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (e) => errors.push(`[${vw}] ${e.message}`))
  await page.goto(`${base}/`)
  await page.click('[data-view="library-view"]')
  await page.waitForSelector('#library-items .card')
  await page.evaluate(() => { const s = document.querySelector('#library-limit'); if (s) { s.value = '100'; s.dispatchEvent(new Event('change')) } })
  await sleep(1200)
  const tag = `[${vw}x${vh}]`
  const total = await page.$$eval('#library-items .card', (c) => c.length)
  check(`${tag} 媒体库：每页 100 个，卡片都渲染出来`, total >= 50, String(total))
  check(`${tag} 媒体库：没有横向滚动条`, (await hOverflow(page)) <= 1, String(await hOverflow(page)))
  const list = await fits(page, '#library-items')
  check(`${tag} 媒体库：卡片列表自己没有横向溢出`, list && list.sw <= 1, JSON.stringify(list))
  const bad = await escapes(page, '#library-items .card')
  check(`${tag} 卡片里的元素（标题 / 标签 / 封面 / 按钮）都不超出卡片`, bad.length === 0, bad.join(' | '))
  const heights = await page.$$eval('#library-items .card', (c) => c.map((e) => Math.round(e.getBoundingClientRect().height)))
  const maxH = Math.max(...heights)
  check(`${tag} 卡片高度有上限（极长标题 / 60 个标签不会把卡片撑得没边）`, maxH <= Math.max(700, vh * 0.95), `max=${maxH}`)
  await page.screenshot({ path: path.join(shotDir, `library-${vw}.png`) })
  for (const theme of themes.slice(1)) {
    await page.evaluate((t) => { const a = document.querySelector('#app'); a.classList.remove('site-theme-light', 'site-theme-dark', 'site-theme-warm', 'site-theme-sepia'); a.classList.add(t) }, theme)
    await sleep(150)
    check(`${tag} 主题 ${theme}：没有横向溢出`, (await hOverflow(page)) <= 1)
    if (vw === 1280) await page.screenshot({ path: path.join(shotDir, `library-${vw}-${theme}.png`) })
  }
  await page.evaluate(() => { const a = document.querySelector('#app'); a.classList.remove('site-theme-dark', 'site-theme-warm'); a.classList.add('site-theme-light') })

  // 详情：挑一个有很多 / 很长标签的条目
  const idx = await page.$$eval('#library-items .card', (cards) => { let best = 0; let n = -1; cards.forEach((c, i) => { const t = c.querySelectorAll('.tag-pill').length; if (t > n) { n = t; best = i } }); return best })
  await page.click(`#library-items .card >> nth=${idx} >> .library-units-go`)
  await sleep(800)
  const panel = await fits(page, '#library-detail-panel')
  check(`${tag} 详情（停靠）：面板在视口内、没有横向溢出`, panel && panel.l >= -1 && panel.r <= vw + 1 && panel.sw <= 1, JSON.stringify(panel))
  const badDetail = await escapes(page, '#library-detail-panel')
  check(`${tag} 详情里的元素不超出面板`, badDetail.length === 0, badDetail.join(' | '))
  await page.screenshot({ path: path.join(shotDir, `detail-docked-${vw}.png`) })
  // 浮动模式
  await page.click('#edge-right')
  await page.click(`#library-items .card >> nth=${idx} >> .library-units-go`)
  await page.waitForSelector('#library-detail-panel.float-open')
  await sleep(500)
  const fl = await fits(page, '#library-detail-panel')
  check(`${tag} 详情（浮动）：框在视口内（上下左右都不出屏）`, fl && fl.l >= 0 && fl.r <= vw + 1 && fl.t >= 0 && fl.b <= vh + 1 && fl.sw <= 1, JSON.stringify(fl))
  await page.screenshot({ path: path.join(shotDir, `detail-float-${vw}.png`) })
  await page.keyboard.press('Escape')
  await page.click('#edge-right')   // 还原停靠

  // 左箭头：显示任务栏再隐藏，没有溢出
  await page.click('#edge-left'); await sleep(200)
  check(`${tag} 显示左侧任务栏后没有横向溢出`, (await hOverflow(page)) <= 1, String(await hOverflow(page)))
  await page.click('#edge-left')

  // Gal 浏览：大目录（房间 300 个脚本，每页 25/100，分页条、工具栏）
  const galTitle = await page.evaluate(() => [...document.querySelectorAll('#library-items .card')].find((c) => /大目录/.test(c.textContent))?.dataset?.itemId || '')
  await page.fill('#library-tag-search', '大目录').catch(() => {})
  await page.click('#library-search')
  await sleep(900)
  const galCard = page.locator('#library-items .card', { hasText: '大目录' }).first()
  if (await galCard.count()) {
    await galCard.locator('.library-units-go').click().catch(() => {})
    await sleep(700)
    const link = await page.evaluate(() => document.querySelector('#library-units a, #library-units button')?.textContent || '')
    void galTitle; void link
  }
  await ctx.close()
}

// Gal 浏览层：直接走路由打开（需要 item id）
const items = await (await fetch(`${base}/api/library/items?type=gal&page=1&limit=10`)).json()
const big = items.items?.find((i) => /大目录/.test(i.title)) || items.items?.[0]
if (big) {
  for (const [vw, vh] of [[1280, 800], [390, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } })
    await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', (e) => errors.push(`[gal ${vw}] ${e.message}`))
    const tag = `[Gal ${vw}x${vh}]`
    await page.goto(`${base}/#/media/gal/${big.itemId}/main?section=${encodeURIComponent('d:room')}`)
    await page.waitForSelector('.gal-browse .gal-card')
    await sleep(500)
    check(`${tag} Gal 房间列表（300 个）：没有横向滚动条`, (await hOverflow(page)) <= 1, String(await hOverflow(page)))
    check(`${tag} Gal 工具栏、翻页条、卡片都不超出浏览层`, (await escapes(page, '.gal-browse', '.gal-browse-tools *, .gal-browse-pager *, .gal-card')).length === 0, (await escapes(page, '.gal-browse', '.gal-browse-tools *, .gal-browse-pager *, .gal-card')).join(' | '))
    await page.screenshot({ path: path.join(shotDir, `gal-list-${vw}.png`) })
    await page.evaluate(() => { document.querySelector('#media-reader-content').scrollTop = 900; window.scrollTo(0, 900) })
    await sleep(300)
    const st = await page.$eval('.gal-browse-sticky', (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight } })
    check(`${tag} 滚动后固定条仍在可视区域内，没有盖住整屏`, st.top >= 0 && st.bottom < st.vh * 0.4, JSON.stringify(st))
    await page.screenshot({ path: path.join(shotDir, `gal-sticky-${vw}.png`) })
    await page.evaluate(() => { document.querySelector('#media-reader-content').scrollTop = 0 })
    await page.selectOption('.gal-browse-size', '500').catch(() => {})
    await sleep(900)
    check(`${tag} 每页 500：一页渲染完，没有横向溢出`, (await hOverflow(page)) <= 1 && (await page.$$('.gal-card')).length >= 100)
    await page.click('.gal-browse-more-btn')
    check(`${tag} 「更多」菜单在视口内`, await page.$eval('.gal-browse-more-menu', (m) => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 }))
    await page.screenshot({ path: path.join(shotDir, `gal-more-${vw}.png`) })
    await ctx.close()
  }
}

check('没有页面错误', errors.length === 0, errors.join(' | '))
await browser.close()
server.kill('SIGTERM')
await rm(dataDir, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed（截图：${shotDir}）`)
process.exit(fail ? 1 : 0)
