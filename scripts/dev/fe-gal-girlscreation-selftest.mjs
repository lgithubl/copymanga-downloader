#!/usr/bin/env node
// 浏览器自测：Girls Creation R Viewer（标签式脚本）——导入（adapter + game.id + gal-layout）→ 目录树（分类 → 说话人 → 场景，封面）→ 播放页：台词 / 说话人 / 背景 /
// Spine 角色（真实 WebGL：双轨道、两个角色、移动、缺失动画名的诊断）/ 视频。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-girlscreation-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/girlscreation-shots）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGirlsCreationFixture } from './make-girlscreation-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/girlscreation-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-gc-'))
await buildGirlsCreationFixture(path.join(dataDir, 'gal', 'girlscreation演示'))
const port = 8120
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', path.join(dataDir, 'gal', 'girlscreation演示'))
  form.set('profileOptions', JSON.stringify({ adapters: ['girlscreation-tag'], config: { game: { id: 'girlscreation' } } })); form.set('metadataActionIds', 'gal-layout')
  const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
  const itemId = imported.items[0].itemId
  let full = null
  for (let i = 0; i < 60; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
  check('导入 + gal-layout：adapter girlscreation-tag、game.id girlscreation、脚本跑过、场景数 4', full.adapters?.[0] === 'girlscreation-tag' && full.config?.game?.id === 'girlscreation' && full.config?.script?.id === 'gal-layout' && full.scriptCount === 4 && (full.tags || []).includes('Gal游戏: girlscreation'), J([full.adapters, full.config?.game, full.scriptCount, full.tags]))
  const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
  const home = await reader('')
  const chmr = await reader(home.node.items[0].node)
  const hana = await reader(chmr.node.items[0].node)
  const target = hana.node.items[0].node

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  const link = (id) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(id)}`
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '')
  const waitCount = (t) => page.waitForFunction((v) => document.querySelector('.gal-count')?.textContent === v, t)
  const spines = () => page.$eval('.gal-world', (e) => JSON.parse(e.dataset.spines || '{}')).catch(() => ({}))
  // 舞台 canvas 里按「骨架包围盒 200x400 放进舞台、再按 x（设计稿 1920 宽的像素）偏移」算出来的位置取像素
  const probe = (dxUnits, dyFrac = 0.5) => page.evaluate(([dx, fy]) => {
    const c = document.querySelector('.gal-spine')
    if (!c) return null
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
    const x = g.getContext('2d'); x.drawImage(c, 0, 0)
    const s = c.height / 400
    const px = Math.round(c.width / 2 + dx.shift * (c.width / 1920) + dx.half * 100 * s)
    return [...x.getImageData(px, Math.round(c.height * fy), 1, 1).data]
  }, [dxUnits, dyFrac])
  const near = (rgba, [r, g, b], tol = 30) => Boolean(rgba) && rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol
  const waitProbe = async (d, want, fy) => { for (let i = 0; i < 40; i++) { const p = await probe(d, fy); if (near(p, want)) return { ok: true, p }; await sleep(150) } return { ok: false, p: await probe(d, fy) } }
  const CRIMSON = [220, 20, 60]

  // 目录树
  await page.goto(link(''))
  await page.waitForSelector('.gal-browse')
  check('首页：分类 chmr / chsr；点进去是说话人，再点进去是场景（标题 / 封面）', J(await page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))) === J(['chmr', 'chsr']))
  await page.click('.gal-card[data-title="chmr"]')
  await page.waitForSelector('.gal-card[data-title="Hana"]')
  await page.click('.gal-card[data-title="Hana"]')
  await page.waitForSelector('.gal-card.is-script')
  check('场景列表：标题取自原始脚本的 title 行；封面图加载出来了（thumbnail.png）', J(await page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))) === J(['First Meeting', 'chmr_40101002']) && await page.waitForFunction(() => [...document.querySelectorAll('.gal-card img')].every((i) => i.complete && i.naturalWidth > 0)).then(() => true))
  await page.screenshot({ path: path.join(shotDir, '1-scenes.png') })

  // 播放：第 1 步 = 一个角色（槽 1，x=+100）
  await page.goto(link(target))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 5')
  await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines?.includes('Actor1'))
  const a1 = await waitProbe({ shift: 100, half: 0 }, CRIMSON)
  check('第 1 步：Spine 角色（槽 1）画出来了，位置按 x=100 偏移；canvas 在背景之上', a1.ok, J(a1.p))
  check('第 1 步：说话人 / 台词；背景图加载', (await text('.gal-name')) === 'Hana' && (await text('.gal-text')) === '"Hello there, first line."', `${await text('.gal-name')} | ${await text('.gal-text')}`)
  check('双轨道：槽 1 = Actor1，播 loop（轨道 0）+ ex_loop（轨道 1）', J(await spines()) === J({ Actor1: 'loop' }), J(await spines()))
  const left = await probe({ shift: -100, half: -0.9 })
  check('第 1 步只有一个角色：槽 2 的位置上还是空的', !near(left, CRIMSON), J(left))
  await page.screenshot({ path: path.join(shotDir, '2-actor1.png') })
  await page.keyboard.press('Space'); await waitCount('2 / 5')
  await sleep(400)
  check('第 2 步：旁白（说话人清空）；\\n 换行', (await text('.gal-name')) === '' && (await text('.gal-text')) === 'A narration line.\nWith a second row.', await text('.gal-text'))
  await page.keyboard.press('Space'); await waitCount('3 / 5')
  await page.keyboard.press('Space'); await waitCount('4 / 5')
  await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines?.includes('Actor2'))
  const a2 = await waitProbe({ shift: -100, half: -0.9 }, CRIMSON)
  check('第 4 步：槽 2 新建（同一套骨架、x=-100）：只属于槽 2 的那一块出现了；槽 1 仍在', a2.ok && J(Object.keys(await spines()).sort()) === J(['Actor1', 'Actor2']), J([a2.p, await spines()]))
  await sleep(700)   // 槽 1 的移动（0.5 秒）完成
  const moved = await waitProbe({ shift: 0, half: 0.9 }, CRIMSON)
  check('第 4 步：槽 1 移动到 x=0（0.5 秒）后，原来 x=100 才碰得到的那一块（右边）不再被槽 1 覆盖', !near(await probe({ shift: 100, half: 0.97 }), CRIMSON) || moved.ok, J(moved.p))
  // 诊断：脚本要的第 3 轨道动画骨架里没有
  await page.waitForFunction(() => /骨骼 \d+ 个|暂未渲染/.test(document.querySelector('.gal-note')?.textContent || ''), null, { timeout: 5000 }).catch(() => {})
  await page.click('.gal-note')
  const diag = await page.$eval('.gal-diag-text', (e) => e.textContent)
  check('渲染诊断：列出两个角色、「骨架里没有这些动画：nope_anim」；SCREEN_SHAKE 记在暂未渲染的指令里', /Actor1/.test(diag) && /Actor2/.test(diag) && /没有这些动画（脚本要的）：nope_anim/.test(diag) && /SCREEN_SHAKE/.test(diag), diag.slice(0, 600))
  await page.click('.gal-diag button:has-text("关闭")')
  await page.screenshot({ path: path.join(shotDir, '3-two-actors.png') })
  await page.keyboard.press('Space'); await waitCount('5 / 5')
  await sleep(500)
  check('第 5 步：槽 1 退场；背景去掉；最后一步', J(Object.keys(await spines())) === J(['Actor2']) && (await text('.gal-text')) === '"The end."', J(await spines()))

  // 视频场景
  const chsr = await reader(home.node.items[1].node)
  const who = await reader(chsr.node.items[0].node)
  await page.goto(link(who.node.items[0].node))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 3')
  await sleep(2500)   // 第一步有黑场渐入 / 等待共约 1.3 秒：播放中点下一步只是「跳过动画」
  check('视频场景：VIDEO_PLAY → 视频背景元素显示；台词；BGM / 语音按场景自己的目录请求', await page.$eval('.gal-movie', (v) => !v.hidden).catch(() => false) && (await text('.gal-text')) === '"A line over the video."', await text('.gal-text'))
  await page.keyboard.press('Space'); await waitCount('2 / 3')
  await page.keyboard.press('Space'); await waitCount('3 / 3')
  await sleep(500)
  check('光秃秃的 <PAUSE> 是一个空步（点一下什么都不变）；VIDEO_STOP 之后视频背景去掉', (await text('.gal-text')) === 'Back to a still.' && await page.$eval('.gal-movie', (v) => v.hidden).catch(() => true), await text('.gal-text'))
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
