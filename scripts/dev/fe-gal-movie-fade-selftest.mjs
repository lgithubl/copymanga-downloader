#!/usr/bin/env node
// 浏览器自测：视频换视频的交叉淡入（Artemis bg movie=1 time=400 → movie fade 0.4）。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-movie-fade-selftest.mjs
// 要点：新视频从 display:none 出来后必须强制重排再设 opacity 过渡，否则过渡不触发 = 硬切。夹具里的 ogv 是假数据（服务端转 mp4 也会失败）（解码不了），所以这里只看元素的 opacity 轨迹，不看画面
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { astOf, buildPf8 } from './make-artemis-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-mfade-'))
const media = path.join(work, 'data', 'gal', 'art', 'game')
await mkdir(media, { recursive: true })
const blocks = [
  { cmds: [['bg', { file: 'ev_a', path: ':ev/ev_x/', movie: 1, loop: 1 }]], text: { lines: ['first clip'] } },
  { cmds: [['bg', { file: 'ev_b', path: ':ev/ev_x/', movie: 1, loop: 1, face: 1, time: 400 }]], text: { lines: ['second clip'] } },
]
await writeFile(path.join(media, 'game.pfs'), buildPf8([{ name: 'script/a.ast', data: Buffer.from(astOf(blocks)) }, { name: 'image/ev/ev_x/ev_a.ogv', data: Buffer.from('not-a-video-a') }, { name: 'image/ev/ev_x/ev_b.ogv', data: Buffer.from('not-a-video-b') }]))
await writeFile(path.join(media, 'game.exe'), 'MZ')
const port = 8153
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch { /* 空闲 */ }
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: path.join(work, 'data'), PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
  const form = new FormData()
  form.set('title', 'art'); form.set('importProfile', 'gal-import'); form.set('metadataActionIds', 'gal-layout')
  form.set('profileOptions', JSON.stringify({ rootDir: path.dirname(media), adapters: ['artemis::ast'], defaultMetadataActions: ['gal-layout'], dryRun: false }))
  const id = (await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()).items[0].itemId
  await sleep(6000)
  const rd = async (s) => (await fetch(`${base}/api/library/items/gal/${id}/reader/main${s ? `?sectionId=${encodeURIComponent(s)}` : ''}`)).json()
  const home = await rd('')
  const dir = await rd(home.node.items[0].node)
  const section = dir.node.items[0].node
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })); localStorage.setItem('copymanga.gal.movieBrightness', '60'); localStorage.setItem('copymanga.gal.movieContrast', '110') })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/media/gal/${id}/main?section=${encodeURIComponent(section)}`)
  await page.waitForSelector('.gal-player .gal-stage')
  await page.waitForFunction(() => /^1 \/ 2/.test(document.querySelector('.gal-count')?.textContent || ''))
  for (let g = 0; g < 40 && await page.$eval('.gal-movie', (v) => v.hidden).catch(() => true); g++) await sleep(150)   // 第一个视频要等第一帧 / 3 秒超时才换上来
  check('第 1 步：视频元素显示（没有渐变：第一个视频硬切）', await page.$eval('.gal-movie', (v) => !v.hidden && (v.style.opacity === '' || v.style.opacity === '1')).catch(() => false))
  // 第 2 步：换视频。只听 transitionrun（不能在 rAF 里读 getComputedStyle：读样式会强制一次样式计算，让没有强制重排的老写法「碰巧」也能过渡）
  await page.evaluate(() => {
    window.__runs = []
    document.addEventListener('transitionrun', (e) => { if (e.propertyName === 'opacity' && e.target.classList?.contains('gal-movie')) window.__runs.push(e.elapsedTime) }, true)
  })
  await page.keyboard.press('Space')
  await sleep(4500)
  const runs = await page.evaluate(() => window.__runs)
  check(`第 2 步：新视频有 opacity 过渡（transitionrun 次数 ${runs.length}，应为 1）`, runs.length === 1, JSON.stringify(runs))
  // 过渡的时长：脚本 time=400 → 0.4 秒
  check('换完后新视频 opacity 回到默认（不留内联样式）', await page.$eval('.gal-movie', (v) => v.style.opacity === '' && v.style.transition === ''))
  check('换完后只剩一个视频元素（旧的移掉了）', (await page.$$('.gal-movie')).length === 1)
  // 视频亮度 / 对比度（设置 → 画面）：本机设置 60% / 110% → 视频元素的 CSS filter
  check('视频亮度 / 对比度设置生效：filter = brightness(0.6) contrast(1.1)；设置里有两个输入框且值对得上', await page.$eval('.gal-movie', (v) => getComputedStyle(v).filter) === 'brightness(0.6) contrast(1.1)' && (await page.$$eval('.gal-more-field', (rows) => rows.filter((r) => /视频亮度|视频对比度/.test(r.textContent)).map((r) => r.querySelector('input').value))).join() === '60,110')
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
