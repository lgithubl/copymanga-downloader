#!/usr/bin/env node
// 浏览器自测：缩略图分批 / 限并发加载器（web/static/thumb-loader.js）+ 它在媒体库页里的接入。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-thumbs-selftest.mjs
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeBigIndex } from './make-big-index.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-thumbs-'))
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
await makeBigIndex(dataDir, 3000)
const port = 8115
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 200; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(150) } }

let browser
try {
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } })

  // 记录缩略图请求：序号 + 同时在飞的最大数；响应延迟 80ms，好让「同时在飞」可观测
  const makeTracker = async (page, pattern, delay = 80) => {
    const t = { urls: [], inflight: 0, max: 0, indexes: () => t.urls.map((u) => Number(/(\d+)\.png|a(\d+)\/thumbnail/.exec(u)?.[1] ?? /a(\d+)\/thumbnail/.exec(u)?.[1])).sort((a, b) => a - b) }
    await page.route(pattern, async (route) => {
      t.urls.push(route.request().url())
      t.inflight++
      t.max = Math.max(t.max, t.inflight)
      await sleep(delay)
      t.inflight--
      await route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    })
    return t
  }

  // ======== 一、加载器本身（纯 DOM，页面里 import 它）========
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/library?tab=new`)
  const tr = await makeTracker(page, /\/__[tu]\//)
  const build = (n, prefix = '__t') => page.evaluate(async ({ n, prefix }) => {
    const { createThumbLoader } = await import('/thumb-loader.js')
    document.body.querySelector('#tl')?.remove()
    const box = document.createElement('div')
    box.id = 'tl'
    box.style.cssText = 'position:absolute;left:0;top:0;width:200px;z-index:-1'
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('div')
      cell.style.cssText = 'height:200px'
      const img = document.createElement('img')
      img.dataset.src = `/${prefix}/${i}.png`
      img.style.cssText = 'display:block;width:100px;height:150px'
      cell.append(img)
      box.append(cell)
    }
    document.body.append(box)
    window.__settings ||= {}
    window.__loader ||= createThumbLoader({ getSettings: () => window.__settings })
    return true
  }, { n, prefix })
  const attach = () => page.evaluate(() => window.__loader.attach(document.querySelectorAll('#tl img[data-src]')))
  const setSettings = (s) => page.evaluate((s) => { window.__settings = s }, s)
  const setVisible = (visible) => page.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible })
    document.dispatchEvent(new Event('visibilitychange'))
  }, visible)
  const scrollTo = async (y) => { await page.evaluate((y) => window.scrollTo(0, y), y); await sleep(50) }
  const reset = () => { tr.urls.length = 0; tr.max = 0 }

  // 1) 第一批马上请求；之后的不请求；并发不超过上限
  await build(300)
  await setSettings({ firstBatch: 10, batch: 20, concurrency: 3, concurrencyHidden: 1 })
  reset()
  await attach()
  await sleep(900)
  check('第一批：列表一渲染就请求前 10 张，之后的一张都不请求', J(tr.indexes()) === J([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), J(tr.indexes()))
  check('并发限制：同时在飞的请求不超过 3（10 张、每张 80ms，没限制的话会一次发完）', tr.max <= 3 && tr.max >= 2, String(tr.max))

  // 2) 滚动到附近：放行进入视口附近的那张和它后面的 batch-1 张（视口外 600px 内算附近）
  reset()
  await scrollTo(2000)   // 第 10 张（y=2000）进入视口；它和后面共 20 张
  await sleep(900)
  check('滚动到附近：放行进入视口的那张起共 20 张（10~29），再往后的不请求', J(tr.indexes()) === J(Array.from({ length: 20 }, (_, i) => 10 + i)), J(tr.indexes()))
  reset()
  await scrollTo(2000)
  await sleep(300)
  check('已经放行过的不会重复请求', tr.urls.length === 0)
  await scrollTo(0)

  // 3) 首批 0：不会「马上」请求，但前台页面的第一屏图片一进视口就放行（一批）
  await build(300)
  await setSettings({ firstBatch: 0, batch: 20, concurrency: 6, concurrencyHidden: 2 })
  reset()
  await attach()
  await sleep(700)
  check('首批 = 0（前台页面）：第一屏进视口时放行一批（0~19），没有更多', J(tr.indexes()) === J(Array.from({ length: 20 }, (_, i) => i)), J(tr.indexes()))

  // 4) 后台标签页：首批照发（并发 1），滚动 / 变化都不再请求；首批 0 的后台页什么都不发；变可见后才继续
  await build(300)
  await setSettings({ firstBatch: 10, batch: 20, concurrency: 5, concurrencyHidden: 1 })
  await setVisible(false)
  reset()
  await attach()
  await sleep(1400)
  check('后台标签页：首批 10 张照样请求，但并发只有 1（不和前台抢连接）', J(tr.indexes()) === J([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) && tr.max === 1, `${J(tr.indexes())} max=${tr.max}`)
  reset()
  await scrollTo(2000)
  await sleep(500)
  check('后台标签页：滚动不会放行更多（要等页面可见）', tr.urls.length === 0, J(tr.indexes()))
  await setVisible(true)
  await sleep(900)
  check('页面变可见：立刻放行视口附近的一批（并发恢复成前台的）', tr.indexes().length === 20 && tr.indexes()[0] === 10 && tr.max >= 2, `${J(tr.indexes())} max=${tr.max}`)
  await scrollTo(0)
  await build(300)
  await setSettings({ firstBatch: 0, batch: 20, concurrency: 5, concurrencyHidden: 1 })
  await setVisible(false)
  reset()
  await attach()
  await sleep(600)
  check('首批 0 + 后台标签页：一张都不请求', tr.urls.length === 0)
  await setVisible(true)
  await sleep(800)
  check('…第一次可见时才开始（放行第一屏的一批）', tr.indexes().length === 20 && tr.indexes()[0] === 0, J(tr.indexes()))

  // 5) 重新渲染：没发出去的丢掉、在飞的中止
  await build(300)
  await setSettings({ firstBatch: 100, batch: 20, concurrency: 3, concurrencyHidden: 1 })
  reset()
  await attach()
  await sleep(150)    // 前 3 张在飞
  const first = tr.urls.length
  await build(40, '__u')
  await page.evaluate(() => window.__loader.attach(document.querySelectorAll('#tl img[data-src]')))
  await sleep(1200)
  const oldAfter = tr.urls.filter((u) => u.includes('/__t/')).length
  const newOnes = tr.urls.filter((u) => u.includes('/__u/')).length
  check('重新渲染：旧一批没发出去的不再发（只有已经在飞的那几张），新一批照常', oldAfter <= first + 0 && newOnes === 40, `旧 ${oldAfter}（渲染时已发 ${first}），新 ${newOnes}`)

  // 6) 图片已经被从 DOM 里摘掉：不再请求
  await build(300)
  await setSettings({ firstBatch: 100, batch: 20, concurrency: 2, concurrencyHidden: 1 })
  reset()
  await attach()
  await sleep(120)
  const sent = tr.urls.length
  await page.evaluate(() => document.querySelector('#tl').remove())
  await sleep(700)
  check('图片被摘出 DOM（比如翻页）后，队列里没发的不再请求', tr.urls.length <= sent + 2, `${sent} → ${tr.urls.length}`)

  // 7) 设置函数：配置改了，下一次 attach 就生效；非法值用默认
  const parsed = await page.evaluate(async () => {
    const { thumbSettingsFromConfig } = await import('/thumb-loader.js')
    return [thumbSettingsFromConfig({}), thumbSettingsFromConfig({ libraryThumbFirstBatch: '0', libraryThumbBatch: 0, libraryThumbConcurrency: 'x', libraryThumbConcurrencyHidden: 3 })]
  })
  check('设置：没配用默认（30/60/6/2）；0 是合法的首批；批量最小 1；不是数字用默认', J(parsed[0]) === J({ firstBatch: 30, batch: 60, concurrency: 6, concurrencyHidden: 2 }) && J(parsed[1]) === J({ firstBatch: 0, batch: 1, concurrency: 6, concurrencyHidden: 3 }), J(parsed))

  // ======== 二、在媒体库页里 ========
  const lib = await context.newPage()
  lib.on('pageerror', (e) => errors.push(e.message))
  const lt = await makeTracker(lib, '**/api/library/items/*/*/thumbnail/**', 60)
  const cardsOf = () => lib.waitForFunction(() => document.querySelectorAll('#library-items .library-card').length > 0, null, { timeout: 20000 })
  await lib.goto(`${base}/#/library?tab=new&limit=100&tag=${encodeURIComponent('语言:中文')}`)
  await cardsOf()
  await sleep(900)
  const imgInfo = await lib.evaluate(() => ({ cards: document.querySelectorAll('#library-items .library-card').length, withSrc: document.querySelectorAll('#library-items img.cover[src]').length, deferred: document.querySelectorAll('#library-items img.cover[data-src]').length, lazyAttr: document.querySelectorAll('#library-items img.cover[loading]').length }))
  check('媒体库页（tab=new）：100 张只先建第一批 40 张 DOM（分批渲染），其中只有第一批 30 张设了 src', imgInfo.cards === 40 && imgInfo.withSrc === 30 && imgInfo.deferred === 40 && lt.urls.length === 30, J({ imgInfo, requests: lt.urls.length }))
  check('媒体库页：缩略图并发不超过前台上限 6', lt.max <= 6, String(lt.max))
  for (let i = 0; i < 8 && (await lib.$$eval('#library-items .library-card', (es) => es.length)) < 100; i++) {   // 一直往下拉：每次到底就再建一批
    await lib.evaluate(() => { const list = document.querySelector('#library-items'); list.scrollTop = list.scrollHeight })   // 卡片列表自己是滚动容器
    await sleep(500)
  }
  await sleep(1500)
  const total = await lib.evaluate(() => ({ cards: document.querySelectorAll('#library-items .library-card').length, sentinel: document.querySelectorAll('.library-lazy-sentinel').length }))
  check('滚到底：继续分批建 DOM，最终 100 张建完、哨兵消失', total.cards === 100 && total.sentinel === 0, J(total))
  check('分批之后每张缩略图最多请求一次（重新交给加载器时不会重复请求已经放行的）', new Set(lt.urls).size === lt.urls.length && lt.urls.length <= 100 && lt.max <= 6, J({ n: lt.urls.length, unique: new Set(lt.urls).size, max: lt.max }))
  await lib.evaluate(() => { const list = document.querySelector('#library-items'); list.scrollTop = list.scrollHeight * 0.4 })
  await sleep(1500)
  const mid = await lib.evaluate(() => {
    const list = document.querySelector('#library-items')
    const box = list.getBoundingClientRect()
    const visible = [...list.querySelectorAll('img.cover')].filter((img) => { const r = img.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom })
    return { visible: visible.length, withSrc: visible.filter((img) => img.getAttribute('src')).length }
  })
  check('滚到中间：视口里的卡片都放行了（有 src）', mid.visible > 0 && mid.withSrc === mid.visible, J(mid))

  // 配置改成首批 10 / 并发 2，重新打开：生效
  await fetch(`${base}/api/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ libraryThumbFirstBatch: 10, libraryThumbConcurrency: 2 }) })
  const lib2 = await context.newPage()
  lib2.on('pageerror', (e) => errors.push(e.message))
  const lt2 = await makeTracker(lib2, '**/api/library/items/*/*/thumbnail/**', 60)
  await lib2.goto(`${base}/#/library?tab=new&limit=100&tag=${encodeURIComponent('语言:中文')}`)
  await cardsOf.call(null).catch(() => {})
  await lib2.waitForFunction(() => document.querySelectorAll('#library-items .library-card').length > 0, null, { timeout: 20000 })
  await sleep(900)
  check('配置生效：首批改成 10、前台并发改成 2 后，新页面只请求 10 张、并发 ≤ 2', lt2.urls.length === 10 && lt2.max <= 2, `${lt2.urls.length} max=${lt2.max}`)
  await fetch(`${base}/api/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ libraryThumbFirstBatch: 30, libraryThumbConcurrency: 6 }) })

  // 系列弹窗里的卡片（不用分批）照常 loading=lazy 带 src
  check('没有页面错误', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.stack?.split('\n').slice(0, 3).join(' | ')}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
