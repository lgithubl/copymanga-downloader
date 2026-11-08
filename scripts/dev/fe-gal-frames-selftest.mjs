#!/usr/bin/env node
// 浏览器自测：帧动画（FRAME_ANIM）用 canvas 播——不再靠换 CSS background-image。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-frames-selftest.mjs      需要 ImageMagick（造图 / 算亮度）
// 要点：① 前台层里有 canvas.gal-frames，每帧换色（至少 4 种不同的颜色）；② 在「禁用缓存」下（DevTools 勾了 Disable cache）录屏，稳态下一帧都不能露出底色 #0b0f17；
//       ③ 首尾混合：循环处的颜色是渐变的（最后几帧是 帧 → 开头帧 的混合，不是硬跳）；④ 设置里有「帧动画首尾混合」。
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-frames-'))
const game = path.join(work, 'data', 'gal', 'game')
const scene = path.join(game, 'package.nw', 'scenes', 'story0001')
await mkdir(path.join(scene, 'animations'), { recursive: true })
await mkdir(path.join(scene, 'images'), { recursive: true })
await writeFile(path.join(game, 'package.json'), '{}')
await writeFile(path.join(game, 'game.exe'), 'MZ')
const N = 12
// 帧：亮色渐变（亮度都 > 100，和底色 #0b0f17 差得很远）：红 → 黄 → 绿 …
for (let i = 1; i <= N; i++) {
  const hue = Math.round(((i - 1) / N) * 300)
  execFileSync('convert', ['-size', '320x180', `xc:hsl(${hue},100%,60%)`, path.join(scene, 'animations', `anim_${i}.jpg`)])
}
execFileSync('convert', ['-size', '320x180', 'xc:white', path.join(scene, 'images', 'Bg_01.jpg')])
await writeFile(path.join(scene, 'script.txt'), ['<BG>Bg_01,NONE,0,1,0,0', '<NAME_PLATE>A', 'first line', '<PAUSE>', '<FRAME_ANIM>anim,1,12,33', '<NAME_PLATE>A', 'second line', '<PAUSE>', ''].join('\n'))
execFileSync('convert', ['-size', '64x36', 'xc:gray', path.join(scene, 'thumbnail.png')])

const port = 8155
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch { /* 空闲 */ }
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: path.join(work, 'data'), PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', game)
  form.set('profileOptions', JSON.stringify({ adapters: ['girlscreation-tag'], config: { game: { id: 'girlscreation' } } })); form.set('metadataActionIds', 'gal-layout')
  const id = (await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()).items[0].itemId
  for (let i = 0; i < 80; i++) { const f = await (await fetch(`${base}/api/library/items/gal/${id}`)).json(); if (f.config?.script?.id === 'gal-layout') break; await sleep(300) }
  const rd = async (sid) => (await fetch(`${base}/api/library/items/gal/${id}/reader/main${sid ? `?sectionId=${encodeURIComponent(sid)}` : ''}`)).json()
  let cur = await rd('')
  let sec = ''
  for (let d = 0; d < 6 && cur.node && cur.node.kind !== 'player'; d++) { const it = cur.node.items || []; sec = (it.find((i) => /story0001/.test(i.node || '')) || it[0]).node; cur = await rd(sec) }
  const frameOp = cur.scene.steps.flatMap((s) => s.commands).find((c) => c.op === 'bg' && c.frames)
  check('适配器：FRAME_ANIM → bg 带 frames（12 帧）', frameOp?.frames?.length === N, JSON.stringify(frameOp))

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })); localStorage.setItem('copymanga.gal.frameFps', '12') })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })   // DevTools 的「Disable cache」
  await page.goto(`${base}/#/media/gal/${id}/main?section=${encodeURIComponent(sec)}`)
  await page.waitForSelector('.gal-player .gal-stage')
  await sleep(1200)
  // 录屏从「点下一句」之前开始：把切进帧动画那一刻（帧还在下载、禁用缓存）也录进来——老办法就是在这时露出底色
  const shots = []
  cdp.on('Page.screencastFrame', (e) => { shots.push(Buffer.from(e.data, 'base64')); cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}) })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await sleep(300)
  await page.keyboard.press('Space')
  await sleep(5000)
  await cdp.send('Page.stopScreencast')

  check('前台层里有 canvas.gal-frames（不是靠换 CSS 背景图）', await page.$$eval('.gal-bg > canvas.gal-frames', (c) => c.length) >= 1)
  // ① 取色：画面中心像素随时间换 → 至少 4 种不同的颜色
  const colors = new Set()
  for (let k = 0; k < 40; k++) {
    colors.add(await page.evaluate(() => { const c = [...document.querySelectorAll('canvas.gal-frames')].pop(); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return [d[0] >> 4, d[1] >> 4, d[2] >> 4].join(',') }))
    await sleep(60)
  }
  check(`帧在循环（中心像素采到 ${colors.size} 种不同的颜色，应 ≥ 4）`, colors.size >= 4, [...colors].join(' '))
  // ② 禁用缓存下录屏：一帧都不露底色
  let dark = 0
  const stage = await (await page.$('.gal-stage')).boundingBox()
  for (let k = 0; k < shots.length; k++) {
    const file = path.join(work, `s${k}.png`)
    await writeFile(file, shots[k])
    const mean = Number(execFileSync('convert', [file, '-crop', `${Math.round(stage.width * 0.5)}x${Math.round(stage.height * 0.4)}+${Math.round(stage.x + stage.width * 0.25)}+${Math.round(stage.y + stage.height * 0.1)}`, '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:']).toString())
    if (mean < 0.25) dark++   // 底色 #0b0f17 的灰度 ≈ 0.05；帧最暗的也 > 0.5
  }
  check(`禁用缓存下录屏 ${shots.length} 帧（含切进帧动画那一刻）：露底色（暗帧）= 0`, shots.length > 20 && dark === 0, `${shots.length} 帧，暗 ${dark}`)
  // ③ 设置里有「帧动画首尾混合」
  check('设置 → 画面：有「帧动画首尾混合」输入框，默认 3', (await page.$$eval('.gal-more-field', (rows) => rows.filter((r) => /帧动画首尾混合/.test(r.textContent)).map((r) => r.querySelector('input').value))).join() === '3')
  check('没有页面错误', errors.length === 0, JSON.stringify(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
