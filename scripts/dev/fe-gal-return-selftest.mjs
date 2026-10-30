#!/usr/bin/env node
// 自测：回到来路列表 + 滚动位置恢复（场景跳转点的同款真实服务端流程）；原：场景跳转点（config.sceneMarkers）——真实服务端流程：导入时带规则 → 列表卡片上有跳转点按钮 → 点了从那一步开始播（计数、台词、没有上次进度）；点卡片本身仍从头开始。
//   node scripts/dev/fe-gal-markers-selftest.mjs      PLAYWRIGHT_PATH=<@playwright/test> 再加上浏览器（合成数据：AdvHD 的小游戏，1×1 的图）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAdvhdFixture } from './make-advhd-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-return-'))
const media = path.join(work, 'Lovey-dovey Part-time')
await buildAdvhdFixture(media)

const require = createRequire(import.meta.url)
let chromium = null
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { /* 没有 playwright：只做 HTTP 部分 */ }
const port = 8157
const base = `http://127.0.0.1:${port}`
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
let server = null
try {
  try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch { /* 空闲 */ }
  server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
  let up = false
  for (let i = 0; i < 100 && !up; i++) { try { await fetch(`${base}/health`); up = true } catch { await sleep(200) } }
  if (!up) { console.log('SKIP 起不来 web 服务') } else {
    const form = new FormData()
    form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
    // STORY_001：步 3 = 事件图 EV_01 叠在背景上（bg.over）；规则：背景带 EV_01 的每一段开头
    form.set('profileOptions', JSON.stringify({ adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' }, sceneMarkers: [{ label: 'CG 开始', kind: 'bg', match: 'EV_01' }] } })); form.set('metadataActionIds', 'gal-layout')
    const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
    const itemId = imported.items[0].itemId
    let full = null
    for (let i = 0; i < 80; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
    check('导入：gal-layout 跑完后 config.sceneMarkers 还在（用户规则不被覆盖）', J(full.config?.sceneMarkers?.map((r) => r.label)) === J(['CG 开始']), J(full.config?.sceneMarkers))
    const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
    const home = await reader('')
    const dirNode = (await reader(home.node.items.find((i) => i.title === 'Rio1').node)).node
    const card = dirNode.items.find((i) => i.title === '001_00')
    check('服务端：001_00 的卡片带 markers = [{ step 3, CG 开始 }]；没有 EV_01 的脚本（003_00）没有', J(card.markers?.map((m) => [m.step, m.label])) === J([[3, 'CG 开始']]) && dirNode.items.find((i) => i.title === '003_00')?.markers === undefined, J(dirNode.items.map((i) => [i.title, i.markers])))
    if (!chromium) console.log('SKIP 没有 @playwright/test：跳过浏览器部分')
    else {
      const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
        const page = await ctx.newPage()
        page.setDefaultTimeout(12000)
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        const rio = home.node.items.find((i) => i.title === 'Rio1').node
        const scrollTop = () => page.evaluate(() => { const c = document.querySelector('.media-reader-content'); const e = getComputedStyle(c).overflowY === 'visible' ? document.scrollingElement : c; return e.scrollTop })
        await page.setViewportSize({ width: 360, height: 220 })
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(rio)}`)
        await page.waitForSelector('.gal-card.is-script')
        await page.addStyleTag({ content: '.gal-card { min-height: 420px }' })   // 只有 3 张卡：撑高让列表能滚动
        await page.evaluate(() => { const c = document.querySelector('.media-reader-content'); const e = getComputedStyle(c).overflowY === 'visible' ? document.scrollingElement : c; e.scrollTop = e.scrollHeight })
        const before = await scrollTop()
        check('前提：列表在小窗口里能滚动（滚到底 scrollTop > 0）', before > 20, String(before))
        await page.evaluate(() => [...document.querySelectorAll('.gal-card.is-script')].at(-1).click())
        await page.waitForSelector('.gal-player .gal-stage')
        check('进了场景（播放页）', Boolean(await page.$('.gal-player .gal-stage')))
        await page.evaluate(() => document.querySelector('.gal-player .gal-up').click())
        await page.waitForSelector('.gal-card.is-script')
        await sleep(300)
        const after = await scrollTop()
        check('点「列表」：回到进来的列表，滚动位置恢复（和进场景前一样）', Math.abs(after - before) <= 2, J([before, after]))
        await page.evaluate(() => { const c = document.querySelector('.media-reader-content'); const e = getComputedStyle(c).overflowY === 'visible' ? document.scrollingElement : c; e.scrollTop = 0 })
        await page.evaluate(() => document.querySelector('.gal-card.is-script').click())
        await page.waitForSelector('.gal-player .gal-stage')
        await page.evaluate(() => document.querySelector('.gal-player .gal-up').click())
        await page.waitForSelector('.gal-card.is-script')
        await sleep(300)
        check('列表在顶部进去、回来仍在顶部', (await scrollTop()) <= 2, String(await scrollTop()))
        check('没有页面错误', errors.length === 0, J(errors))
      } finally { await browser.close() }
    }
  }
} finally { server?.kill() }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
