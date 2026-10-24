#!/usr/bin/env node
// 浏览器自测：Gal 列表页底栏和文本页（播放页）底栏的位置 / 宽度一致（沉浸模式，几种窗口宽度），以及列表页「渲染诊断」。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-bars-selftest.mjs
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as tenkeiScript } from '../tag-scripts/gal-layout/main.js'
import { buildTenkeiFixture } from './make-spine-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-bars-'))
const dataDir = path.join(work, 'data')
const media = path.join(dataDir, 'gal', 'tenkei-pack')
await mkdir(media, { recursive: true })
await buildTenkeiFixture(media)
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })
const imp = await handler.importFromSource({ sourcePath: media, options: { adapters: ['tenkeiprdx-json'], config: { game: { id: 'tenkeiprdx' } } } })
const out = await tenkeiScript({ item: imp.items[0], script: { id: 'gal-layout', version: '1.0.0', options: {} } })
await handler.patchItemMetadata(imp.items[0].itemId, { gal: out.itemPatch.gal })
const itemId = imp.items[0].itemId

const port = 8117
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const link = (section) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(section)}`
  for (const [w, h] of [[1280, 800], [1920, 1080], [2560, 1080]]) {
    const context = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) } }, sel)
    await page.goto(link('v:all'))
    await page.waitForSelector('.gal-browse .gal-browse-bar')
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('stream-immersive'))
    await sleep(500)
    const list = { bar: await rect('.gal-browse-bar'), up: await rect('.gal-up') }
    await page.goto(link('s:10010101.json'))
    await page.waitForSelector('.gal-player .gal-bar-wrap')
    await sleep(800)
    const player = { bar: await rect('.gal-bar-wrap'), up: await rect('.gal-up') }
    check(`${w}x${h} 沉浸：列表底栏和文本页底栏左右一样宽（都贴满窗口）、都贴着最下沿`, list.bar.l === player.bar.l && list.bar.r === player.bar.r && list.bar.l === 0 && list.bar.r === w && list.bar.b === player.bar.b && list.bar.b === h, J({ list: list.bar, player: player.bar }))
    check(`${w}x${h} 沉浸：「↑ 上一级」按钮左边、高度的位置一致`, Math.abs(list.up.l - player.up.l) <= 1 && Math.abs(list.up.b - player.up.b) <= 2 && Math.abs((list.up.b - list.up.t) - (player.up.b - player.up.t)) <= 1, J({ list: list.up, player: player.up }))
    check(`${w}x${h} 没有页面错误`, errors.length === 0, J(errors))
    await context.close()
  }

  // 点过「下一句」按钮后（焦点还在按钮上）再按空格：只能走一步，不能「按钮点击 + 全局按键」走两步（走到最后一句再多走一步会回到列表）
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto(link('s:10010101.json'))
    await page.waitForSelector('.gal-player .gal-count')
    await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '1 / 4')
    await sleep(2500)   // 第一句的动画 / 立绘加载完（还在播放时点下一句只是「跳过动画」，不前进）
    await page.click('.gal-next-btn')
    await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '2 / 4', null, { timeout: 8000 })
    await sleep(2500)
    await page.keyboard.press('Space')
    await sleep(2500)
    const after = await page.$eval('.gal-count', (e) => e.textContent)
    check('焦点在「下一句」按钮上时按空格：只前进一步（2 → 3），不会走两步', after === '3 / 4', after)
    await context.close()
  }

  // 渲染诊断：卡片没有图 / 脚本问题 都列出来
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.goto(link('v:all'))
  await page.waitForSelector('.gal-browse .gal-browse-bar')
  await sleep(500)
  await page.click('.gal-browse-more-btn')
  const label = await page.$eval('.gal-browse-diag-btn', (e) => e.textContent)
  await page.click('.gal-browse-diag-btn')
  await page.waitForFunction(() => document.querySelector('.gal-browse-diag-text')?.textContent !== '加载中…')
  const text = await page.$eval('.gal-browse-diag-text', (e) => e.textContent)
  check('列表页菜单项叫「渲染诊断」，面板标题也是（不只是图片）', /^渲染诊断/.test(label) && /渲染诊断/.test(await page.$eval('.gal-browse-diag-head strong', (e) => e.textContent)), label)
  check('渲染诊断：汇总行「节点 … N 个问题」；没问题时明说「没有发现渲染问题」', /节点 .*个问题/.test(text) && (/没有发现渲染问题/.test(text) || /\[(没有图|加载失败|脚本问题|节点)\]/.test(text)), text.slice(0, 300))
  await page.click('.gal-browse-diag-head .gal-btn:nth-of-type(2)')

  await context.close()
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
