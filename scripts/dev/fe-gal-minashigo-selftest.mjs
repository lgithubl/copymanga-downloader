#!/usr/bin/env node
// 浏览器自测：minashigo（Ren'Py，MinashigoViewer）——导入（adapter + game.id + gal-layout）→ 浏览（角色分组）→ 播放页：台词 / 说话人 / 背景 / 立绘（canvas 裁剪合成）/ 换人 / scene 清立绘 / 缺资源提示。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-minashigo-selftest.mjs
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMinashigoFixture } from './make-minashigo-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test'))
} catch {
  console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH')
  process.exit(2)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/minashigo-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-mg-'))
await buildMinashigoFixture(path.join(dataDir, 'gal', 'minashigo演示'))
const port = 8109
const base = `http://127.0.0.1:${port}`
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
const form = new FormData()
form.set('importProfile', 'gal-import'); form.set('sourcePath', path.join(dataDir, 'gal', 'minashigo演示'))
form.set('profileOptions', JSON.stringify({ adapters: ['renpy-minashigo'], config: { game: { id: 'minashigo' } } })); form.set('metadataActionIds', 'gal-layout')
const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
const itemId = imported.items[0].itemId
let full = null
for (let i = 0; i < 60; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
check('导入 + gal-layout：adapter renpy-minashigo、game.id minashigo、脚本跑过、脚本数 5', full.adapters?.[0] === 'renpy-minashigo' && full.config?.game?.id === 'minashigo' && full.config?.script?.id === 'gal-layout' && full.scriptCount === 5, JSON.stringify([full.adapters, full.config?.game, full.scriptCount]))
const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
const home = await reader('')
const group = await reader(home.node.items.find((i) => i.title === '302201').node)
const target = group.node.items.find((i) => i.title === 'scene_130220102').node
const evNode = home.node.items.find((i) => i.title === 'scene_ev059_00_02').node

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
const page = await ctx.newPage()
page.setDefaultTimeout(12000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('dialog', (d) => d.dismiss().catch(() => {}))
const link = (id) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(id)}`
const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '')
const pixel = (x, y) => page.evaluate(([px, py]) => { const c = document.querySelector('canvas.gal-stand'); if (!c) return null; const d = c.getContext('2d').getImageData(px, py, 1, 1).data; return [d[0], d[1], d[2], d[3]] }, [x, y])
const standParts = () => page.$eval('canvas.gal-stand', (c) => c.dataset.parts).catch(() => '')
const near = (px, want) => px && want.every((v, i) => Math.abs(px[i] - v) <= 12)

await page.goto(link(''))
await page.waitForSelector('.gal-browse .gal-card')
check('首页：同角色归成一张卡片（302201）、主线 / 活动脚本照常列出', (await page.$$('.gal-card.is-dir')).length === 2 && (await page.$$('.gal-card.is-script')).length === 2)
await page.screenshot({ path: path.join(shotDir, 'home.png') })

await page.goto(link(target))
await page.waitForSelector('.gal-player .gal-stage')
await page.waitForFunction(() => /^1 \/ 5/.test(document.querySelector('.gal-count')?.textContent || ''))
await sleep(900)
check('播放页：5 步；第 1 句旁白（没有说话人），背景是 bg5000604', (await text('.gal-text')).includes('旁白第一句') && (await page.$eval('.gal-name', (e) => e.hidden)) && (await page.$$eval('.gal-bg', (els) => els.some((e) => /bg5000604/.test(e.style.backgroundImage)))))
check('第 1 步还没有立绘', !(await standParts()) || (await standParts()) === '0')
await page.keyboard.press('Space'); await sleep(900)
check('第 2 步：说话人「ワーテルロー」；立绘 canvas 画了 2 个部件', (await text('.gal-name')).includes('ワーテルロー') && (await standParts()) === '2', await standParts())
// 立绘：身体 1000x900 ×0.9 → 900x810，表情 100x95 ×0.9 在 (350,100)；整体底边对齐 1080、水平居中：左上 = ((1920-900)/2, 1080-810) = (510, 270)
const body = await pixel(510 + 10, 270 + 400)
const face = await pixel(510 + 350 + 20, 270 + 100 + 20)
check('立绘像素：身体是红色（crimson）、表情是黄色，底边贴着画面下沿居中', near(body, [220, 20, 60, 255]) && near(face, [255, 255, 0, 255]), JSON.stringify([body, face]))
// 光 canvas 里有像素不算数：它必须真的叠在背景之上（z-index 比背景层高；canvas 不挡鼠标，所以不能用 elementFromPoint 判断）
const z = await page.evaluate(() => ({ stand: Number(getComputedStyle(document.querySelector('canvas.gal-stand')).zIndex), bg: Number(getComputedStyle(document.querySelector('.gal-bg')).zIndex), pe: getComputedStyle(document.querySelector('canvas.gal-stand')).pointerEvents }))
check('立绘 canvas 叠在背景之上（z-index 高于背景）且不挡点击', z.stand > z.bg && z.pe === 'none', JSON.stringify(z))
check('立绘以外的地方是透明的（左上角）', (await pixel(10, 10))?.[3] === 0)
await page.screenshot({ path: path.join(shotDir, 'stand-1.png') })
await page.keyboard.press('Space'); await sleep(900)
const body2 = await pixel(510 + 10, 270 + 400)
check('第 3 步：换成另一个角色（身体变蓝），说话人「ナポレオン」', (await text('.gal-name')).includes('ナポレオン') && near(body2, [65, 105, 225, 255]), JSON.stringify(body2))
await page.keyboard.press('Space'); await sleep(2800)   // scene black1 + 黑场 + flash 的动画
check('第 4 步：scene 清掉了立绘（canvas 全透明）', (await standParts()) === '0' && (await pixel(510 + 10, 270 + 400))?.[3] === 0, `${await standParts()}`)
check('第 4 步：说话人没了（$ name= ""）', await page.$eval('.gal-name', (e) => e.hidden))
await page.keyboard.press('Space'); await sleep(1200)
const face3 = await pixel(510 + 350 + 20, 270 + 100 + 20)
check('第 5 步：scene 之后重新 show，表情换成绿色（302201a004）', (await standParts()) === '2' && near(face3, [0, 255, 0, 255]), JSON.stringify(face3))
check('提示：特效图 slash_1 暂未渲染（1 条），可点开看明细', /1 条指令暂未渲染/.test(await text('.gal-note')), await text('.gal-note'))
await page.screenshot({ path: path.join(shotDir, 'stand-5.png') })
// 后退一步：立绘随状态回到上一步（一步到位渲染）
await page.keyboard.press('ArrowLeft'); await sleep(700)
check('后退：回到第 4 步的状态（立绘已清）', (await standParts()) === '0' && /^4 \/ 5/.test(await text('.gal-count')), `${await standParts()} ${await text('.gal-count')}`)
// 续播 / 刷新：直接渲染第 N 步的状态（看完 = 100% 会从头来，所以退到第 3 步再刷新）
await page.keyboard.press('Space'); await sleep(900)
await page.keyboard.press('ArrowLeft'); await sleep(500)
await page.keyboard.press('ArrowLeft'); await sleep(500)
await sleep(2500)   // 等进度保存的防抖落盘
await page.reload()
await page.waitForSelector('.gal-player .gal-stage'); await sleep(1800)
const bodyR = await pixel(510 + 10, 270 + 400)
check('刷新续播：直接恢复到第 3 步，立绘（蓝色身体）也画出来', (await standParts()) === '2' && /^3 \/ 5/.test(await text('.gal-count')) && near(bodyR, [65, 105, 225, 255]), `${await standParts()} ${await text('.gal-count')} ${JSON.stringify(bodyR)}`)
await page.screenshot({ path: path.join(shotDir, 'resume-3.png') })

// 图片查不到的脚本：缺资源提示，不崩
await page.goto(link(evNode))
await page.waitForSelector('.gal-player .gal-stage'); await sleep(900)
check('scene 图片查不到：播放器不崩、能继续点', (await text('.gal-text')).includes('活动'))
await page.keyboard.press('Space'); await sleep(600)
check('下一步照常显示台词', (await text('.gal-text')).includes('图片不存在'))
check('没有页面错误', errors.length === 0, errors.join(' | '))

await browser.close()
server.kill('SIGTERM')
await rm(dataDir, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed（截图：${shotDir}）`)
process.exit(fail ? 1 : 0)
