#!/usr/bin/env node
// 浏览器自测：媒体库卡片网格（#library-items）和别的滚动容器用的是我们的细滚动条（跟主题走），不是浏览器自带的粗滚动条。
//   造 80 个 Gal 条目（内容比窗口高 → 网格出现滚动条）；四个主题各量一次：scrollbar-width = thin、滚动条宽度 ≤ 12px（原生约 15px）、颜色跟 --site-muted 走。
//   无头 Chromium 默认是「覆盖式」滚动条（宽度 0），所以启动时去掉 --hide-scrollbars 并关掉 OverlayScrollbar，才量得到真实宽度。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-scrollbar-selftest.mjs
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

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-sb-'))
const dataDir = path.join(work, 'data')
const gal = path.join(dataDir, 'gal')
for (let i = 0; i < 80; i++) {
  const dir = path.join(gal, `item-${String(i).padStart(3, '0')}`, 'resources/download/adv/text')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 's.txt'), 'bg,a.jpg,0\nname,甲\nmsg,0,hi\nclickwait\n')
}
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: gal } } }) })
for (let i = 0; i < 80; i++) await handler.importFromSource({ sourcePath: path.join(gal, `item-${String(i).padStart(3, '0')}`), options: {} })   // 一个目录 = 一个媒体条目

const port = 8151
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
try {
  browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar'] })
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 520 } })).newPage()
  pageRef = page
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/library`)
  await page.waitForSelector('#library-items')
  await page.waitForFunction(() => document.querySelectorAll('#library-items .library-card').length >= 20, null, { timeout: 15000 })
  for (const theme of ['light', 'dark', 'warm', 'sepia']) {
    const r = await page.evaluate((t) => {
      const app = document.querySelector('#app')
      app.className = app.className.replace(/site-theme-\w+/g, '').trim() + ` site-theme-${t}`
      const grid = document.querySelector('#library-items')
      const cs = getComputedStyle(grid)
      return { scrolls: grid.scrollHeight > grid.clientHeight, width: cs.scrollbarWidth, bar: grid.offsetWidth - grid.clientWidth, color: cs.scrollbarColor, muted: getComputedStyle(app).getPropertyValue('--site-muted').trim() }
    }, theme)
    check(`${theme} 主题：卡片网格有滚动条（内容比窗口高）`, r.scrolls, JSON.stringify(r))
    check(`${theme} 主题：细滚动条（scrollbar-width: thin，宽度 ≤ 12px，不是原生 15px）`, r.width === 'thin' && r.bar > 0 && r.bar <= 12, JSON.stringify(r))
    check(`${theme} 主题：滚动条颜色跟主题走（不是默认色）`, /color\(srgb|rgba?\(/.test(r.color) && !/auto/.test(r.color), JSON.stringify(r))
  }
  const gutter = await page.evaluate(() => getComputedStyle(document.querySelector('#library-items')).scrollbarGutter)
  check('卡片网格 scrollbar-gutter: stable（滚动条出现 / 消失时网格宽度不跳）', /stable/.test(gutter), gutter)
  check('没有页面错误', errors.length === 0, JSON.stringify(errors))
  await page.screenshot({ path: process.env.SHOT || '/tmp/scrollbar-library.png' })
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
