#!/usr/bin/env node
// 浏览器自测：Gal 播放器的翻译——原文先显示不被译文阻塞 / 预加载窗口 + 服务端并发上限 / 自动播放等译文（阻塞最大 N 秒）/ 开关记住
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-translate-selftest.mjs     端口 8162（应用）
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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
const J = JSON.stringify

// ---- 假模型（OpenAI 兼容）：记录每次调用；delay 可改 ----
const llm = { delay: 100, calls: [], inFlight: 0, peak: 0 }
const llmServer = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', async () => {
    const user = JSON.parse(body).messages.at(-1).content
    const last = user.split('\n').at(-1)
    const texts = last.startsWith('[') ? JSON.parse(last) : [last]
    llm.calls.push({ texts, at: Date.now() })
    llm.inFlight += 1
    llm.peak = Math.max(llm.peak, llm.inFlight)
    await sleep(llm.delay)
    llm.inFlight -= 1
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: last.startsWith('[') ? J(texts.map((t) => `译:${t}`)) : `译:${texts[0]}` } }] }))
  })
})
await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve))

// ---- 夹具：uviewer-csv 目录，几个脚本（每个脚本的句子不同，避免缓存互相影响）----
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-trans-'))
const media = path.join(dataDir, 'gal', '翻译演示')
const T = (...p) => path.join(media, 'resources', 'download', 'adv', 'text', ...p)
await mkdir(T('cabin', 'adultr'), { recursive: true })
await mkdir(path.join(media, 'user_data'), { recursive: true })
await writeFile(path.join(media, 'UViewer.exe'), 'MZ')
await writeFile(path.join(media, 'start.bat'), '@echo off\nstart UViewer.exe\n')
await writeFile(path.join(media, 'user_data', 'settings.json'), J({ resource_path: './resources', script_language: 'zh', text_size: 18 }))
const msg = (who, text) => `name,${who},\nmsg,0,${text},,,,,,,,,\nclickwait,,,,,,,,,,,\n`
const script = (prefix, n) => 'bg,color_20_60_40,0,,,,,,,,\n' + Array.from({ length: n }, (_, i) => msg('小夜', `${prefix}${i + 1}`)).join('')
await writeFile(T('cabin/adultr/700100.txt'), script('甲', 40))   // 预加载 / 并发
await writeFile(T('cabin/adultr/700200.txt'), script('乙', 12))   // 原文不被阻塞（慢模型）
await writeFile(T('cabin/adultr/700300.txt'), script('丙', 6))    // 自动播放等译文
await writeFile(T('cabin/adultr/700400.txt'), script('丁', 6))    // 阻塞超时

const port = 8162
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  // 翻译配置：开、批 5、上文 2、预加载 12、并发 1
  const cfg = await (await fetch(`${base}/api/config`)).json()
  await fetch(`${base}/api/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ ...cfg, galTranslateEnabled: true, galTranslateColor: '#ff8800', galTranslateApiBase: `http://127.0.0.1:${llmServer.address().port}`, galTranslateBatchSize: 5, galTranslateContextSize: 2, galTranslateLookahead: 12, galTranslateMaxConcurrency: 1, galTranslateRetryCount: 0 }) })
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
  form.set('profileOptions', J({ adapters: ['uviewer-csv'] })); form.set('metadataActionIds', 'gal-layout')
  const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
  const itemId = imported.items[0].itemId
  for (let i = 0; i < 60; i++) { const full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
  const link = (rel) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(`s:${rel}`)}`
  const reset = async (rel) => { await fetch(`${base}/api/library/items/gal/${itemId}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ unitId: 'main', sectionId: `s:${rel}`, scrollRatio: 0, choices: {} }) }) }

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  const cnt = () => page.$eval('.gal-count', (e) => e.textContent).catch(() => '')
  const text = () => page.$eval('.gal-text', (e) => e.textContent).catch(() => '')
  const trans = () => page.$eval('.gal-trans', (e) => ({ hidden: e.hidden, text: e.textContent, wait: e.classList.contains('gal-trans-wait') })).catch(() => null)
  const open = async (rel) => { await reset(rel); await page.goto(`${base}/health`); await page.goto(link(rel)); await page.waitForSelector('.gal-player .gal-stage'); await page.waitForFunction(() => /^1 \//.test(document.querySelector('.gal-count')?.textContent || '')); await sleep(400) }
  const setLs = (kv) => page.evaluate((o) => { for (const [k, v] of Object.entries(o)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } }, kv)

  // ---- 1. 按钮 / 原文先显示 / 译文后到 ----
  llm.delay = 150
  await open('cabin/adultr/700100.txt')
  check('翻译启用后工具栏出现「翻译」按钮，默认没按下；译文行隐藏', await page.$eval('.gal-trans-btn', (b) => !b.hidden && b.getAttribute('aria-pressed') === 'false') && (await trans()).hidden)
  llm.calls.length = 0
  const t0 = Date.now()
  await page.click('.gal-trans-btn')
  await page.waitForFunction(() => document.querySelector('.gal-trans') && !document.querySelector('.gal-trans').hidden)
  check('点翻译：原文（甲1）一直在，译文行出现（先「翻译中…」）', (await text()).includes('甲1') && ((await trans()).text === '翻译中…' || (await trans()).text.startsWith('译:')), J(await trans()))
  await page.waitForFunction(() => /^译:/.test(document.querySelector('.gal-trans')?.textContent || ''))
  check('译文到了：显示「译:甲1」，不再是等待样式；原文没变', (await trans()).text === '译:甲1' && !(await trans()).wait && (await text()).includes('甲1'), J(await trans()))
  // ---- 1b. 译文颜色：服务端默认（#ff8800）→ 设置里按设备改 → 恢复默认 ----
  const colorOf = () => page.$eval('.gal-trans', (e) => getComputedStyle(e).color)
  check('译文颜色：没有本机设置时用服务端设置的颜色 #ff8800（rgb(255, 136, 0)）', (await colorOf()) === 'rgb(255, 136, 0)', await colorOf())
  await page.click('.gal-cfg')
  await page.$eval('.gal-set-color', (input) => { input.value = '#12ab34'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  check('译文颜色：设置 → 显示 里改成 #12ab34，译文立刻变色，并存进本机（copymanga.gal.transColor）', (await colorOf()) === 'rgb(18, 171, 52)' && (await page.evaluate(() => localStorage.getItem('copymanga.gal.transColor'))) === '#12ab34', await colorOf())
  await page.reload(); await page.waitForSelector('.gal-player .gal-stage'); await page.waitForFunction(() => /译:/.test(document.querySelector('.gal-trans')?.textContent || ''))
  check('译文颜色：刷新后还是本机设置的颜色', (await colorOf()) === 'rgb(18, 171, 52)', await colorOf())
  await page.click('.gal-cfg'); await page.click('.gal-set-color-reset')
  check('译文颜色：恢复默认 = 清掉本机设置，回到服务端的 #ff8800', (await colorOf()) === 'rgb(255, 136, 0)' && (await page.evaluate(() => localStorage.getItem('copymanga.gal.transColor'))) === null, await colorOf())
  // ---- 2. 预加载窗口 + 并发上限 ----
  await sleep(1500)
  const asked = llm.calls.flatMap((c) => c.texts)
  check('预加载：只翻当前句后面 12 句（甲2…甲13），窗口外的（甲14…）一句都没要', asked.includes('甲2') && asked.includes('甲13') && !asked.includes('甲14') && !asked.some((t) => /甲(1[4-9]|[2-4]\d)/.test(t)), J(asked))
  check('服务端并发上限 1：同一时刻最多 1 个请求打到模型（峰值 ' + llm.peak + '）', llm.peak === 1)
  // 往后翻：窗口右移，新进窗口的句子才会被要
  const before = llm.calls.length
  await page.keyboard.press('Space'); await sleep(900)
  const fresh = llm.calls.slice(before).flatMap((c) => c.texts)
  check('往后翻一句：只补新进窗口的一句（甲14），已经翻好的不重复要', J(fresh) === J(['甲14']) && (await trans()).text === '译:甲2', J([fresh, await trans()]))
  // ---- 3. 开关记住 ----
  await page.reload(); await page.waitForSelector('.gal-player .gal-stage'); await sleep(800)
  check('刷新后「翻译」仍然是开着的（浏览器记住）', await page.$eval('.gal-trans-btn', (b) => b.getAttribute('aria-pressed') === 'true') && !(await trans()).hidden)
  await page.click('.gal-trans-btn')
  check('再点一下关掉：译文行隐藏', (await trans()).hidden)

  // ---- 4. 原文不被慢模型阻塞 ----
  llm.delay = 4000
  await setLs({ 'copymanga.gal.translateOn': '1' })
  await open('cabin/adultr/700200.txt')
  const s0 = Date.now()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('乙2'))
  const showMs = Date.now() - s0
  check(`模型很慢（4 秒 / 批）：翻页后原文（乙2）立刻显示（${showMs}ms），译文行在等待样式（翻译中…）——原文不被翻译阻塞`, showMs < 1000 && (await trans()).wait === true && (await trans()).text === '翻译中…', J([showMs, await trans()]))

  // ---- 5. 自动翻译：自动播放等译文 ----
  llm.delay = 1800
  await setLs({ 'copymanga.gal.translateOn': '1', 'copymanga.gal.autoTranslate': '1', 'copymanga.gal.translateBlockSec': '10' })
  await open('cabin/adultr/700300.txt')
  const a0 = Date.now()
  await page.click('.gal-auto')
  await page.waitForFunction(() => /^2 \//.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 15000 })
  const advancedMs = Date.now() - a0
  check(`自动翻译开着：自动播放等第 1 句的译文（模型 1.8 秒）才翻页——没有译文不翻（${advancedMs}ms ≥ 1.8s）`, advancedMs >= 1700, advancedMs)
  await page.click('.gal-auto')   // 关自动

  // ---- 6. 阻塞超时：最多等 N 秒 ----
  llm.delay = 8000
  await setLs({ 'copymanga.gal.translateOn': '1', 'copymanga.gal.autoTranslate': '1', 'copymanga.gal.translateBlockSec': '1' })
  await open('cabin/adultr/700400.txt')
  const b0 = Date.now()
  await page.click('.gal-auto')
  await page.waitForFunction(() => /^2 \//.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 15000 })
  const timeoutMs = Date.now() - b0
  check(`阻塞最大 1 秒：模型 8 秒也不死等，约 1.2 + 1 秒后照常翻页（${timeoutMs}ms < 5s），译文行仍在等待`, timeoutMs < 5000 && timeoutMs >= 1900 && (await trans()).wait === true, J([timeoutMs, await trans()]))
  await page.click('.gal-auto')
  // ---- 7. 自动翻译关着：不等 ----
  await setLs({ 'copymanga.gal.translateOn': '1', 'copymanga.gal.autoTranslate': '0' })
  await open('cabin/adultr/700100.txt')
  const c0 = Date.now()
  await page.click('.gal-auto')
  await page.waitForFunction(() => /^2 \//.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 15000 })
  const freeMs = Date.now() - c0
  check(`自动翻译关着：不等译文，按原来的节奏（约 1.2 秒）翻页（${freeMs}ms < 2.5s）`, freeMs < 2500, freeMs)
  await page.click('.gal-auto')
  check('全程没有页面错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  server.kill()
  llmServer.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
