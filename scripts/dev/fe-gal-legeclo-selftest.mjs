#!/usr/bin/env node
// 浏览器自测：legeclo（Ren'Py）——导入（adapter + game.id + gal-layout）→ 浏览（角色分组、头像）→ 播放页：台词 / 说话人 / 背景 / 整张立绘（canvas，at left / right 各自对齐）/ 视频背景。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-legeclo-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/legeclo-shots）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLegecloFixture } from './make-legeclo-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/legeclo-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-lg-'))
await buildLegecloFixture(path.join(dataDir, 'gal', 'legeclo演示'))
const port = 8119
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', path.join(dataDir, 'gal', 'legeclo演示'))
  form.set('profileOptions', JSON.stringify({ adapters: ['renpy-legeclo'], config: { game: { id: 'legeclo' } } })); form.set('metadataActionIds', 'gal-layout')
  const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
  const itemId = imported.items[0].itemId
  let full = null
  for (let i = 0; i < 60; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
  check('导入 + gal-layout：adapter renpy-legeclo、game.id legeclo、脚本跑过、脚本数 4', full.adapters?.[0] === 'renpy-legeclo' && full.config?.game?.id === 'legeclo' && full.config?.script?.id === 'gal-layout' && full.scriptCount === 4 && (full.tags || []).includes('Gal游戏: legeclo'), J([full.adapters, full.config?.game, full.scriptCount, full.tags]))
  const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
  const home = await reader('')
  const group = await reader(home.node.items.find((i) => i.title === 'demo_hero').node)
  const target = group.node.items.find((i) => i.title === 'demo_hero_02').node

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const page = await ctx.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  const link = (id) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(id)}`
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '')
  const standPixel = (x, y) => page.evaluate(([px, py]) => {
    const c = document.querySelector('.gal-stand')
    if (!c) return null
    return [...c.getContext('2d').getImageData(px, py, 1, 1).data]
  }, [x, y])
  const near = (rgba, [r, g, b], tol = 30) => Boolean(rgba) && rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol
  const waitPixel = async (x, y, want) => { for (let i = 0; i < 40; i++) { const p = await standPixel(x, y); if (near(p, want)) return { ok: true, p }; await sleep(150) } return { ok: false, p: await standPixel(x, y) } }
  const CRIMSON = [220, 20, 60]; const GOLD = [218, 165, 32]; const BLUE = [65, 105, 225]
  const waitCount = (t) => page.waitForFunction((v) => document.querySelector('.gal-count')?.textContent === v, t)

  // 浏览
  await page.goto(link(''))
  await page.waitForSelector('.gal-browse')
  check('首页：角色分组卡片；头像加载出来（带 _idle 的和不带的都行）', J(await page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))) === J(['demo_hero', 'long_name_with_parts', 'other_one']) && await page.waitForFunction(() => [...document.querySelectorAll('.gal-card img')].filter((i) => i.complete && i.naturalWidth > 0).length === 2).then(() => true))
  await page.screenshot({ path: path.join(shotDir, '1-home.png') })

  // 播放：第 1 句 = 一个居中的立绘（没有 align）；背景、台词、说话人
  await page.goto(link(target))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 4')
  const p1 = await waitPixel(960, 1040, CRIMSON)
  check('第 1 句：立绘（整张图）居中、底边对齐画面底边', p1.ok, J(p1.p))
  check('第 1 句：台词 / 说话人（\\n 换行）', (await text('.gal-name')) === 'Hero' && (await text('.gal-text')) === 'First line.\nSecond row.', `${await text('.gal-name')} | ${await text('.gal-text')}`)
  const bg = await page.$eval('.gal-bg', (e) => getComputedStyle(e).backgroundImage).catch(() => '')
  check('背景：黑图当黑底、第二张真正的背景图加载', /ab_007_room/.test(bg + (await page.$$eval('.gal-bg', (es) => es.map((e) => e.style.backgroundImage).join()))))
  await page.screenshot({ path: path.join(shotDir, '2-step1.png') })
  await page.keyboard.press('Space'); await waitCount('2 / 4')
  await sleep(500)
  check('第 2 句：旁白（说话人清空）；hide 之后立绘去掉', (await text('.gal-name')) === '' && (await text('.gal-text')) === 'A narration line without a speaker.' && (await page.$eval('.gal-stand', (c) => c.dataset.parts)) === '0', `${await text('.gal-text')} | parts=${await page.$eval('.gal-stand', (c) => c.dataset.parts)}`)
  await page.keyboard.press('Space'); await waitCount('3 / 4')
  const left = await waitPixel(20, 1040, BLUE)
  const right = await waitPixel(1900, 1040, GOLD)
  check('第 3 句：两个立绘各自对齐——at left 贴左边、at right 贴右边（同时显示）', left.ok && right.ok, J({ left: left.p, right: right.p }))
  await page.screenshot({ path: path.join(shotDir, '3-two-sprites.png') })
  await page.keyboard.press('Space'); await waitCount('4 / 4')
  const note = await text('.gal-note')
  check('第 4 句：不存在的立绘 show 不崩，只是提示缺图 / 没渲染', (await text('.gal-text')) === 'A sprite that is not on disk.', note)

  // 视频背景别名
  const videoNode = group.node.items.find((i) => i.title === 'demo_hero_03').node
  await page.goto(link(videoNode))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 1')
  check('视频别名（scene hs_…_mo_…）→ 视频背景元素', await page.$eval('.gal-movie', (v) => !v.hidden).catch(() => false), String(await page.$eval('.gal-movie', (v) => v.hidden).catch(() => 'none')))
  check('没有页面错误', errors.length === 0, J(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message} @ ${(error.stack || '').split('\n')[1] || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(dataDir, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
