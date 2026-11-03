#!/usr/bin/env node
// 浏览器自测：Gal 诊断中心——「更多」里的总开关（默认关）→ 卡片小按钮（只打开窗口）→ 窗口里点具体诊断才请求服务端；缩略图诊断的候选表（留 / 丢 / 大小 / 原因）；配置检查 / 缓存占用；接口的参数校验
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-diag-selftest.mjs     端口 8164（应用）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from '../../web/library/gal/bgi.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

// ---- 夹具：uviewer-csv 目录；缩略图用 scriptThumbs 模板（{thumbsDir}/{stem}.png 和 _b.png），一张小一张大，thumbSkip 丢小的 ----
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-diag-'))
const media = path.join(dataDir, 'gal', '诊断演示')
const T = (...p) => path.join(media, 'resources', 'download', 'adv', 'text', ...p)
await mkdir(T('cabin', 'adultr'), { recursive: true })
await mkdir(path.join(media, 'user_data', 'thumbnails'), { recursive: true })
await writeFile(path.join(media, 'UViewer.exe'), 'MZ')
await writeFile(path.join(media, 'start.bat'), '@echo off\nstart UViewer.exe\n')
await writeFile(path.join(media, 'user_data', 'settings.json'), J({ resource_path: './resources', script_language: 'zh', text_size: 18 }))
const msg = (who, text) => `name,${who},\nmsg,0,${text},,,,,,,,,\nclickwait,,,,,,,,,,,\n`
await writeFile(T('cabin/adultr/700100.txt'), 'bg,color_20_60_40,0,,,,,,,,\n' + msg('小夜', '你好') + msg('小夜', '再见'))
const png = (w, h) => encodePng(w, h, 4, Buffer.alloc(w * h * 4, 7))
await writeFile(path.join(media, 'user_data', 'thumbnails', '700100.png'), png(40, 30))   // 小图（几十字节）：被 thumbSkip 丢掉
await writeFile(path.join(media, 'user_data', 'thumbnails', '700100_b.png'), Buffer.concat([png(100, 50), Buffer.alloc(1200 * 1024)]))   // 大图（> 1MB）：留下

const port = 8164
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
  form.set('profileOptions', J({ adapters: ['uviewer-csv'], config: { thumbsDirs: ['user_data/thumbnails'], scriptThumbs: ['~/{thumbsDir}/{stem}.png', '~/{thumbsDir}/{stem}_b.png'], thumbSkip: [{ minMB: 1 }] } }))
  const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
  const itemId = imported.items[0].itemId
  const api = `${base}/api/library/items/gal/${itemId}`
  const post = (p, body) => fetch(`${api}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J(body) })

  // ---- 1. 接口：列出（不计算）/ 参数校验 ----
  const list = await (await fetch(`${api}/diagnostics?scope=card`)).json()
  check('接口：GET diagnostics 只列出支持的诊断（名字 / 说明 / 范围 / 开销 / 参数），不带结果', list.diagnostics?.length === 3 && list.diagnostics.every((d) => d.id && d.title && d.description && d.scope && d.cost && !('run' in d) && !('sections' in d)) && J(list.diagnostics.map((d) => d.id)) === J(['thumbs', 'config', 'cache']), J(list))
  const itemList = await (await fetch(`${api}/diagnostics?scope=item`)).json()
  check('接口：scope=item 不含需要卡片的「缩略图」，只有 config / cache', J(itemList.diagnostics.map((d) => d.id)) === J(['config', 'cache']), J(itemList))
  check('接口：未知诊断 404；缩略图诊断没带 node 400', (await post('/diagnostics/nope', {})).status === 404 && (await post('/diagnostics/thumbs', {})).status === 400)

  // ---- 2. 浏览页：开关默认关 → 没有小按钮 ----
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const requests = []
  page.on('request', (r) => { if (/\/diagnostics/.test(r.url())) requests.push(`${r.method()} ${r.url().replace(base, '')}`) })
  const reader = async (sectionId) => (await (await fetch(`${api}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json()).node
  let node = await reader('')
  while (node.items?.length && node.items[0].type === 'dir') node = await reader(node.items[0].node)
  const cardNode = node.id
  await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(cardNode)}`)
  await page.waitForSelector('.gal-card')
  check('开关默认关：卡片上没有「诊」按钮', (await page.$$('.gal-card-diag')).length === 0)

  // ---- 3. 更多里打开总开关 → 每张卡片有小按钮 ----
  await page.click('.gal-browse-more-btn')
  check('「更多」里有「诊断按钮」开关，默认没勾', await page.$eval('.gal-browse-diag-toggle', (b) => !b.checked))
  await page.click('.gal-browse-diag-toggle')
  await page.waitForSelector('.gal-card-diag')
  check('打开开关：每张卡片都有「诊」按钮，本机存了偏好（gal.diag = on）', (await page.$$('.gal-card-diag')).length === (await page.$$('.gal-card')).length && (await page.evaluate(() => localStorage.getItem('gal.diag'))) === 'on')

  // ---- 4. 点小按钮 = 只打开窗口：不跳转、不请求诊断（只有列表） ----
  const hash0 = await page.evaluate(() => location.hash)
  requests.length = 0
  await page.click('.gal-card-diag')
  await page.waitForSelector('.gal-diag-dialog .gal-diag-item')
  check('点「诊」：弹出诊断窗口，列出 3 个诊断（每个有说明和开销），没有跳转到别的页面', (await page.$$('.gal-diag-item')).length === 3 && (await page.evaluate(() => location.hash)) === hash0 && (await page.$$('.gal-diag-cost')).length === 3)
  check('窗口打开时只请求了「列出」（GET …/diagnostics?scope=card），没有任何 POST 运行', requests.length === 1 && /^GET .*\/diagnostics\?scope=card/.test(requests[0]), J(requests))
  check('窗口里提示「点运行才开始」，结果区还没有表格', (await page.$eval('.gal-diag-result', (e) => e.textContent)).includes('点「运行」') && (await page.$$('.gal-diag-table')).length === 0)

  // ---- 5. 点具体诊断的「运行」才算 ----
  requests.length = 0
  const items = await page.$$('.gal-diag-item')
  const run = async (idx) => { await (await items[idx].$('.gal-diag-run')).click(); await page.waitForSelector('.gal-diag-table') }
  await run(0)
  const rows = await page.$$eval('.gal-diag-table:first-of-type tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)))
  const cand = await page.$$eval('.gal-diag-table', (ts) => [...ts[0].querySelectorAll('tr')].slice(1).map((tr) => [...tr.children].map((c) => c.textContent)))
  check('运行「缩略图候选与过滤」才发出 POST …/diagnostics/thumbs', requests.some((r) => /^POST .*\/diagnostics\/thumbs$/.test(r)), J(requests))
  check('缩略图候选表：小图 700100.png「丢掉」并写明命中 thumbSkip 和大小，大图 700100_b.png「留下」', cand.some((r) => /700100\.png$/.test(r[1]) && r[5] === '丢掉' && /thumbSkip\[0\]/.test(r[6])) && cand.some((r) => /700100_b\.png$/.test(r[1]) && r[5] === '留下'), J(cand))
  check('候选表里有转换后大小和宽×高（大图 100×50，> 1MB）', cand.some((r) => /700100_b/.test(r[1]) && r[4] === '100×50' && /MB$/.test(r[3])), J(cand))
  check('有「复制为文本」「下载 JSON」按钮；摘要里有适配器和留 / 丢数量', (await page.$$('.gal-diag-actions button')).length === 2 && /留下 1 个、丢掉 1 个/.test(await page.$eval('.gal-diag-summary', (e) => e.textContent)), await page.$eval('.gal-diag-summary', (e) => e.textContent))
  requests.length = 0
  await run(1)
  check('运行「配置检查」：只发 config 这一个请求，摘要里有配置警告数', requests.length === 1 && /diagnostics\/config$/.test(requests[0]) && /配置警告/.test(await page.$eval('.gal-diag-summary', (e) => e.textContent)), J(requests))
  requests.length = 0
  await run(2)
  check('运行「缓存占用」：只发 cache 这一个请求，列出 5 个缓存目录', requests.length === 1 && /diagnostics\/cache$/.test(requests[0]) && (await page.$$eval('.gal-diag-table tr', (t) => t.length)) === 6, J(requests))

  // ---- 6. 关闭窗口 / 关掉开关 ----
  await page.click('.gal-diag-head button')
  check('关闭按钮：窗口没了', (await page.$$('.gal-diag-dialog')).length === 0)
  await page.click('.gal-browse-more-btn'); await page.click('.gal-browse-diag-toggle')
  await sleep(500)
  check('关掉开关：卡片上的「诊」按钮没了，偏好清掉', (await page.$$('.gal-card-diag')).length === 0 && (await page.evaluate(() => localStorage.getItem('gal.diag'))) === null)
  check('全程没有页面错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  server.kill()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
