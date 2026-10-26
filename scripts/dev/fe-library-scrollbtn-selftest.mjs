#!/usr/bin/env node
// 浏览器自测：媒体库页的悬浮半透明 ▲▼ 分段滚动按钮（web/static/scroll-buttons.js）。
//   造 80 个 Gal 条目（内容比窗口高）：按钮存在 / 每次滚约 80% 可视高度 / 到顶到底禁用 / 内容放得下时隐藏 / 其它视图不显示 / 键盘可用 / 不挡点击 / 不压滚动条和右缘手柄；截图到 /tmp/scrollbtn-shots。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-library-scrollbtn-selftest.mjs
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-sbtn-'))
const dataDir = path.join(work, 'data')
const gal = path.join(dataDir, 'gal')
for (let i = 0; i < 80; i++) {
  const dir = path.join(gal, `item-${String(i).padStart(3, '0')}`, 'resources/download/adv/text')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 's.txt'), 'bg,a.jpg,0\nname,甲\nmsg,0,hi\nclickwait\n')
}
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: gal } } }) })
for (let i = 0; i < 80; i++) await handler.importFromSource({ sourcePath: path.join(gal, `item-${String(i).padStart(3, '0')}`), options: {} })   // 一个目录 = 一个媒体条目

const port = 8164
const base = `http://127.0.0.1:${port}`
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

// 条目是直接用 handler 导入的（没走服务端的导入接口），库索引要手动重建一次
await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
for (let i = 0; i < 100; i++) {
  const status = await (await fetch(`${base}/api/library/index/status`)).json()
  if (status.status === 'ready' && status.itemCount >= 80) break
  await sleep(200)
}

let browser
let pageRef = null
const shots = '/tmp/scrollbtn-shots'
await mkdir(shots, { recursive: true })
try {
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1100, height: 520 }, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  pageRef = page
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/library`)
  await page.waitForSelector('#library-items')
  await page.waitForFunction(() => document.querySelectorAll('#library-items .library-card').length >= 20, null, { timeout: 15000 })
  await sleep(500)
  const up = page.locator('#library-view .scroll-btn-up')
  const down = page.locator('#library-view .scroll-btn-down')
  const grid = () => page.evaluate(() => { const g = document.querySelector('#library-items'); return { top: g.scrollTop, client: g.clientHeight, scroll: g.scrollHeight } })
  const settle = async () => { let last = -1; for (let i = 0; i < 40; i++) { const t = (await grid()).top; if (t === last) return t; last = t; await sleep(120) } return last }
  const disabled = (loc) => loc.getAttribute('aria-disabled')

  check('两个按钮存在且可见（挂在 #library-view 里）', (await up.count()) === 1 && (await down.count()) === 1 && (await up.isVisible()) && (await down.isVisible()))
  check('title 提示：向上 80% / 向下 80%', (await up.getAttribute('title')) === '向上 80%' && (await down.getAttribute('title')) === '向下 80%')
  const g0 = await grid()
  check('前提：卡片网格自己是滚动容器且内容比可视区高', g0.scroll > g0.client + 200, JSON.stringify(g0))
  check('在顶部：▲ aria-disabled=true，▼ aria-disabled=false', (await disabled(up)) === 'true' && (await disabled(down)) === 'false')
  const op = await page.evaluate(() => getComputedStyle(document.querySelector('.scroll-btn-down')).opacity)
  check('默认半透明（opacity 约 0.35）', Math.abs(Number(op) - 0.35) < 0.05, op)
  await down.hover(); await sleep(300)
  check('悬停变不透明（>0.8）', Number(await page.evaluate(() => getComputedStyle(document.querySelector('.scroll-btn-down')).opacity)) > 0.8)
  await page.mouse.move(5, 5)

  // 位置：不压滚动条 / 右缘手柄 / 分页栏
  const geo = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect()
    const g = document.querySelector('#library-items')
    return { box: r('.scroll-btns'), grid: r('#library-items'), bar: g.offsetWidth - g.clientWidth, edge: r('#edge-right'), pager: r('#library-next'), vh: innerHeight }
  })
  check('位置：在卡片网格内、右缘留出滚动条宽度，不压滚动条', geo.box.right <= geo.grid.right - geo.bar - 4 && geo.box.left >= geo.grid.left, JSON.stringify(geo))
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  check('不和右缘详情手柄、分页按钮重叠', !overlap(geo.box, geo.edge) && !overlap(geo.box, geo.pager), JSON.stringify(geo))
  check('整组盒子很小（不会拦截别处点击），视口内', geo.box.width <= 60 && geo.box.height <= 100 && geo.box.top >= 0 && geo.box.bottom <= geo.vh, JSON.stringify(geo.box))
  const probe = await page.evaluate(() => { const g = document.querySelector('#library-items').getBoundingClientRect(); const el = document.elementFromPoint(g.left + 40, g.top + 40); return { inBtns: Boolean(el?.closest('.scroll-btns')), tag: el?.tagName } })
  check('盒子之外的点不会命中按钮（elementFromPoint）', !probe.inBtns, JSON.stringify(probe))

  // 点击：每次约 80% 可视高度（平滑滚动，等停下来再量）
  await down.click(); let t1 = await settle()
  const step = g0.client * 0.8
  check('点 ▼：滚动 ≈ 80% 可视高度（容差 6px）', Math.abs(t1 - step) <= 6, `${t1} vs ${step}`)
  check('离开顶部：▲ 可用', (await disabled(up)) === 'false')
  await down.click(); const t2 = await settle()
  check('再点 ▼：再滚 ≈ 80%', Math.abs(t2 - t1 - step) <= 6, `${t2 - t1} vs ${step}`)
  await up.click(); const t3 = await settle()
  check('点 ▲：往回滚 ≈ 80%', Math.abs(t2 - t3 - step) <= 6, `${t2 - t3} vs ${step}`)
  await page.screenshot({ path: `${shots}/middle.png` })

  // 到底 / 到顶
  await page.evaluate(() => { const g = document.querySelector('#library-items'); g.scrollTop = g.scrollHeight })
  await sleep(300)
  check('滚到底：▼ aria-disabled=true，▲ 可用', (await disabled(down)) === 'true' && (await disabled(up)) === 'false')
  const before = (await grid()).top
  await down.click({ force: true }).catch(() => {}); await sleep(400)
  check('到底时点 ▼ 不动', (await grid()).top === before)
  await page.screenshot({ path: `${shots}/bottom.png` })
  await page.evaluate(() => { document.querySelector('#library-items').scrollTop = 0 })
  await sleep(300)
  check('回到顶：▲ aria-disabled=true', (await disabled(up)) === 'true' && (await disabled(down)) === 'false')

  // 键盘：Tab 焦点、Enter / Space
  await down.focus()
  check('键盘可聚焦（button）', await page.evaluate(() => document.activeElement?.classList.contains('scroll-btn-down')))
  await page.keyboard.press('Enter'); const k1 = await settle()
  check('Enter 激活 ▼：滚 ≈ 80%', Math.abs(k1 - step) <= 6, String(k1))
  await up.focus(); await page.keyboard.press('Space'); const k2 = await settle()
  check('Space 激活 ▲：回到顶', k2 <= 2, String(k2))

  // 布局变化：窗口变高 / 浮动详情 / 卡片宽度
  await page.setViewportSize({ width: 1100, height: 700 })
  await sleep(500)
  const g1 = await grid()
  await page.locator('#library-view .scroll-btn-down').click(); const r1 = await settle()
  check('窗口变高后：仍按新的可视高度 80% 滚', Math.abs(r1 - g1.client * 0.8) <= 6, `${r1} vs ${g1.client * 0.8}`)
  await page.evaluate(() => { document.querySelector('#library-items').scrollTop = 0 })
  await page.click('#edge-right'); await sleep(500)
  const floatGeo = await page.evaluate(() => ({ box: document.querySelector('.scroll-btns').getBoundingClientRect(), grid: document.querySelector('#library-items').getBoundingClientRect(), edge: document.querySelector('#edge-right').getBoundingClientRect(), hidden: document.querySelector('.scroll-btns').hidden, vw: innerWidth }))
  check('详情浮动（列表占满宽度）：按钮跟着列表右缘走，且不压右缘手柄', !floatGeo.hidden && floatGeo.box.right <= floatGeo.grid.right - 4 && !overlap(floatGeo.box, floatGeo.edge) && floatGeo.box.right <= floatGeo.vw, JSON.stringify(floatGeo))
  await page.screenshot({ path: `${shots}/float.png` })
  await page.click('#edge-right'); await sleep(400)

  // 窄屏：整页滚动或网格滚动，按钮都要能滚到东西
  await page.setViewportSize({ width: 800, height: 520 })
  await sleep(600)
  const narrow = await page.evaluate(() => ({ hidden: document.querySelector('.scroll-btns').hidden, doc: document.scrollingElement.scrollHeight > innerHeight + 1 }))
  check('窄屏（≤900px）：按钮仍显示', !narrow.hidden, JSON.stringify(narrow))
  const nb = await page.evaluate(() => [document.scrollingElement.scrollTop, document.querySelector('#library-items').scrollTop])
  await page.locator('#library-view .scroll-btn-down').click(); await sleep(900)
  const na = await page.evaluate(() => [document.scrollingElement.scrollTop, document.querySelector('#library-items').scrollTop])
  check('窄屏：点 ▼ 后页面或网格确实滚动了', na[0] > nb[0] || na[1] > nb[1], JSON.stringify([nb, na]))
  await page.screenshot({ path: `${shots}/narrow.png` })
  await page.evaluate(() => { document.scrollingElement.scrollTop = 0; document.querySelector('#library-items').scrollTop = 0 })
  await page.setViewportSize({ width: 1100, height: 520 })
  await sleep(500)

  // prefers-reduced-motion：瞬间滚动（点完立刻就到位，不用等）
  const rmPage = await (await browser.newContext({ viewport: { width: 1100, height: 520 }, reducedMotion: 'reduce' })).newPage()
  await rmPage.goto(`${base}/#/library`)
  await rmPage.waitForFunction(() => document.querySelectorAll('#library-items .library-card').length >= 20, null, { timeout: 15000 })
  await sleep(500)
  await rmPage.locator('#library-view .scroll-btn-down').click()
  await sleep(60)
  const rm = await rmPage.evaluate(() => { const g = document.querySelector('#library-items'); return [g.scrollTop, g.clientHeight * 0.8] })
  check('prefers-reduced-motion：点击后立刻到位（不做平滑动画）', Math.abs(rm[0] - rm[1]) <= 6, JSON.stringify(rm))
  await rmPage.close()

  // 内容放得下 → 整组隐藏
  await page.fill('#library-tag-search', 'tag:"不存在的标签"')
  await page.click('#library-search')
  await page.waitForFunction(() => !document.querySelector('#library-items .library-card'), null, { timeout: 8000 })
  await sleep(400)
  check('内容放得下（没有结果）：按钮隐藏', await page.evaluate(() => document.querySelector('.scroll-btns').hidden || getComputedStyle(document.querySelector('.scroll-btns')).display === 'none'))
  await page.fill('#library-tag-search', '')
  await page.click('#library-search')
  await page.waitForFunction(() => document.querySelectorAll('#library-items .library-card').length >= 20, null, { timeout: 8000 })
  await sleep(500)
  check('结果回来后按钮重新出现', await down.isVisible())

  // 其它视图不显示
  for (const view of ['tasks-view', 'merge-view', 'history-view']) {
    await page.click(`[data-view="${view}"]`); await sleep(300)
    check(`${view}：没有悬浮滚动按钮`, !(await page.locator('.scroll-btn').first().isVisible()))
  }
  await page.click('[data-view="library-view"]'); await sleep(500)
  check('回到媒体库：按钮又出现', await down.isVisible())
  check('没有页面错误', errors.length === 0, JSON.stringify(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${String(error?.message || error).split('\n')[0]}`)
  if (process.env.SB_DEBUG && pageRef) console.log(await pageRef.evaluate(() => JSON.stringify({ cards: document.querySelectorAll('#library-items .library-card').length, hash: location.hash, text: document.body.innerText.slice(0, 400) })).catch(() => ''))
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
