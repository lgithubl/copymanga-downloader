#!/usr/bin/env node
// 浏览器自测：左右边沿收缩箭头（左 = 隐藏任务栏；右 = 媒体库详情停靠 ↔ 浮动）、箭头上下拖动并记住位置。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-edges-selftest.mjs
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArchiveGalleryHandler } from '../../web/library/types/archive-gallery.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test'))
} catch {
  console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH')
  process.exit(2)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-edges-'))
const cfg = { archiveCacheDir: path.join(dataDir, 'c'), mediaImportProfiles: { 'archive-gallery': { managedDir: path.join(dataDir, 'm') } }, mediaImportSourceRoots: '/input' }
const handler = createArchiveGalleryHandler({ type: 'archive', dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async () => false, getConfig: () => cfg })
const { internals } = handler
for (const [i, name] of ['甲', '乙', '丙'].entries()) {
  const id = createHash('sha1').update(name).digest('hex')
  await internals.writeItem(internals.buildItem({ itemId: id, title: name, tags: ['标签:共用'], zipPath: `/x/${name}.zip`, external: true, size: 1, mtimeMs: 1, pageCount: 3, sourceProfile: 'archive-gallery', createdAt: new Date(1.7e12 + i * 1000).toISOString(), cover: '' }))
}
const port = 8104
const base = `http://127.0.0.1:${port}`
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
for (let i = 0; i < 100; i++) { const p = await (await fetch(`${base}/api/library/items?type=archive&page=1&limit=1`)).json(); if (p.index.status === 'ready') break; await sleep(200) }

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.setDefaultTimeout(10000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const vis = (sel) => page.$eval(sel, (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).catch(() => false)

await page.goto(`${base}/`)
await page.click('[data-view="library-view"]')
await page.waitForSelector('#library-items .card')
check('默认：左侧任务栏完全隐藏，内容铺满（左箭头可见）', !(await vis('.sidebar')) && (await vis('#edge-left')) && (await page.$eval('.content', (e) => e.getBoundingClientRect().left)) <= 1)
await page.click('#edge-left')
check('点左箭头：任务栏出现', await vis('.sidebar'))
await page.click('#edge-left')
check('再点：又完全隐藏', !(await vis('.sidebar')))
// 拖动
const box = await (await page.$('#edge-left')).boundingBox()
await page.mouse.move(box.x + 8, box.y + 28); await page.mouse.down(); await page.mouse.move(box.x + 8, box.y + 28 + 150, { steps: 6 }); await page.mouse.up()
const moved = await (await page.$('#edge-left')).boundingBox()
check('左箭头可上下拖动，拖动不会触发隐藏/显示', moved.y > box.y + 100 && !(await vis('.sidebar')), JSON.stringify([box.y, moved.y]))
const saved = await page.evaluate(() => Number(localStorage.getItem('copymanga.edgeLeftTop')))
check('位置记在 localStorage', saved > 0, String(saved))
await page.reload(); await page.click('[data-view="library-view"]'); await page.waitForSelector('#library-items .card')
const again = await (await page.$('#edge-left')).boundingBox()
check('刷新后位置保留', Math.abs(again.y - moved.y) < 6, JSON.stringify([moved.y, again.y]))

// 右：停靠 ↔ 浮动
check('默认停靠：右侧详情面板可见', await vis('#library-detail-panel') && await vis('#edge-right'))
await page.click('#edge-right')
check('点右箭头：详情改浮动（先不显示），列表占满整行', !(await vis('#library-detail-panel')) && (await page.$eval('#library-items', (e) => e.getBoundingClientRect().width)) > 1000)
await page.click('#library-items .card >> nth=0 >> .library-units-go')
await page.waitForSelector('#library-detail-panel.float-open')
const fb = await (await page.$('#library-detail-panel')).boundingBox()
check('点媒体：详情以浮动框弹出（在右侧、不超出视口）', fb.x + fb.width <= 1280 && fb.x > 600 && fb.width <= 520, JSON.stringify(fb))
await page.click('#library-detail-close')
check('点 ×：浮动框关闭', !(await vis('#library-detail-panel')))
await page.click('#library-items .card >> nth=1 >> .library-units-go')
await page.waitForSelector('#library-detail-panel.float-open')
await page.keyboard.press('Escape')
check('Esc 也能关', !(await vis('#library-detail-panel')))
await page.reload(); await page.click('[data-view="library-view"]'); await page.waitForSelector('#library-items .card')
check('刷新后仍是浮动模式', !(await vis('#library-detail-panel')))
await page.click('#edge-right')
check('再点右箭头：恢复停靠', await vis('#library-detail-panel'))
await page.click('[data-view="settings-view"]')
check('右箭头只在媒体库里出现', !(await vis('#edge-right')))
check('没有页面错误', errors.length === 0, errors.join('|'))

await browser.close()
server.kill('SIGTERM')
await rm(dataDir, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
