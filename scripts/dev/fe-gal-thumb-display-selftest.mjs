#!/usr/bin/env node
// 浏览器自测：Gal 卡片封面 / 悬停轮播的配置与界面——thumbCover（last / { index }）、thumbHover（count / sequential / intervalMs / enabled:false）、
// 「更多」菜单里的两个本地开关（悬停轮播 / 封面）：持久化在 localStorage、覆盖配置、「跟随配置」还原。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-thumb-display-selftest.mjs        端口 8165；需要 ImageMagick（convert）
import { spawn, spawnSync } from 'node:child_process'
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
const J = JSON.stringify
const letters = 'abcdef'
const s1 = letters.split('').map((l) => `shots/s1_${l}.png`)

// s1：六张图（a–f）；s2：一张
async function buildFixture(dir) {
  const R = (rel) => path.join(dir, 'resources', rel)
  const script = 'msg,0,hello\nclickwait\nmsg,0,second\nclickwait\n'
  for (const n of ['s1', 's2']) { await mkdir(path.dirname(R(`download/adv/text/${n}.txt`)), { recursive: true }); await writeFile(R(`download/adv/text/${n}.txt`), script) }
  await mkdir(R('shots'), { recursive: true })
  for (const [i, c] of ['red', 'green', 'blue', 'gold', 'purple', 'teal'].entries()) spawnSync('convert', ['-size', '64x36', `xc:${c}`, R(`shots/s1_${letters[i]}.png`)])
  spawnSync('convert', ['-size', '64x36', 'xc:gray', R('shots/s2_a.png')])
}
const sources = [{ dir: 'shots', match: '^(s\\d)_\\w+\\.png$', key: '{1}', for: 'script' }]
const variants = {
  last: { thumbCover: 'last', thumbHover: { count: 3, order: 'sequential', intervalMs: [200, 300] } },
  index: { thumbCover: { index: 2 }, thumbHover: { enabled: false } },
  first: { thumbCover: 'first', thumbHover: { count: 3, order: 'sequential', intervalMs: [200, 300] } },
  random: { thumbHover: { count: 3, order: 'random', intervalMs: [200, 300] } },
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-thumbdisp8165-'))
for (const name of Object.keys(variants)) await buildFixture(path.join(dataDir, 'gal', `disp-${name}`))
const port = 8165
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const ids = {}
  for (const [name, config] of Object.entries(variants)) {
    const form = new FormData()
    form.set('importProfile', 'gal-import'); form.set('sourcePath', path.join(dataDir, 'gal', `disp-${name}`))
    form.set('profileOptions', JSON.stringify({ adapters: ['uviewer-csv'], defaultMetadataActions: [], config: { game: { id: 'disp' }, scriptThumbs: [], thumbSources: sources, ...config } }))
    ids[name] = (await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()).items[0].itemId
  }
  const node = async (name) => (await (await fetch(`${base}/api/library/items/gal/${ids[name]}/reader/main?sectionId=`)).json()).node
  const last = await node('last')
  check('API：节点带 thumbCover / thumbHover（规整后）', last.thumbCover === 'last' && J(last.thumbHover) === J({ enabled: true, count: 3, order: 'sequential', intervalMs: [200, 300] }) && J((await node('index')).thumbCover) === J({ index: 2 }) && (await node('random')).thumbCover === 'random', J(last))

  browser = await chromium.launch()
  const open = async (name, { prefs = {} } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addInitScript((p) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })); for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v) } }, prefs)
    const page = await ctx.newPage()
    page.setDefaultTimeout(12000)
    page.errors = []
    page.on('pageerror', (e) => page.errors.push(e.message))
    await page.goto(`${base}/#/media/gal/${ids[name]}/main?section=`)
    await page.waitForSelector('.gal-card')
    return { ctx, page }
  }
  const sel = '.gal-card[data-title="s1"] img'
  const pathOf = (src) => new URL(src, base).searchParams.get('path')
  const loaded = (page) => page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0 }, sel)
  const srcOf = async (page) => pathOf(await page.$eval(sel, (i) => i.getAttribute('src')))
  // 悬停 ms 毫秒，返回依次出现的图（去掉连续重复）
  const hoverSeen = async (page, ms) => {
    await page.hover('.gal-card[data-title="s1"]')
    const out = []
    const t0 = Date.now()
    const times = []
    let prev = await srcOf(page)
    while (Date.now() - t0 < ms) { const now = await srcOf(page); if (now !== prev) { out.push(now); times.push(Date.now() - t0); prev = now } await sleep(30) }
    await page.mouse.move(2, 2)
    await sleep(150)
    return { out, times }
  }
  const reopen = async (page) => { await page.reload(); await page.waitForSelector('.gal-card'); await loaded(page) }

  // —— thumbCover: last / { index } / first ——
  const a = await open('last'); await loaded(a.page)
  const lastCovers = []
  for (let i = 0; i < 4; i++) { if (i) await reopen(a.page); lastCovers.push(await srcOf(a.page)) }
  check('thumbCover last：4 次加载封面都是最后一张（f）', lastCovers.every((c) => c === s1[5]), J(lastCovers))
  // —— 悬停：sequential + count 3 + intervalMs [200, 300] ——
  const seq = await hoverSeen(a.page, 2200)
  const gaps = seq.times.slice(1).map((t, i) => t - seq.times[i])
  check('thumbHover sequential count 3：封面 f 之后依次 a、b（按原顺序，到头绕回开头），再回到 f——一共只轮 3 张', J(seq.out.slice(0, 4)) === J([s1[0], s1[1], s1[5], s1[0]]) && seq.out.every((p) => [s1[0], s1[1], s1[5]].includes(p)), J(seq.out))
  check('thumbHover intervalMs [200, 300]：2.2 秒里换了 6–11 次，间隔大致在 200–300ms（容许 ±150ms 抖动）', seq.out.length >= 6 && seq.out.length <= 11 && gaps.every((g) => g >= 100 && g <= 480), J({ n: seq.out.length, gaps }))
  check('mouseleave 还原封面', (await srcOf(a.page)) === s1[5], await srcOf(a.page))
  await a.ctx.close()

  const b = await open('index'); await loaded(b.page)
  const indexCover = await srcOf(b.page)
  const noHover = await hoverSeen(b.page, 1500)
  check('thumbCover { index: 2 }：封面是第 3 张（c）；config thumbHover.enabled: false → 悬停不轮播', indexCover === s1[2] && noHover.out.length === 0, J([indexCover, noHover.out]))
  // —— UI 开关：配置关了，本地开关打开 → 轮播（localStorage 持久、覆盖配置） ——
  await b.page.$eval('.gal-browse-more-btn', (btn) => btn.click())
  const toggle = b.page.locator('.gal-browse-hover-toggle')
  const coverSel = b.page.locator('.gal-browse-cover-select')
  check('「更多」菜单有两个控件：悬停轮播（复选框，状态跟随配置 = 关）、封面（下拉，默认「跟随配置」）', (await toggle.count()) === 1 && !(await toggle.isChecked()) && (await coverSel.inputValue()) === '', '')
  await toggle.check()
  const stored = await b.page.evaluate(() => localStorage.getItem('gal.thumbHover'))
  const withUi = await hoverSeen(b.page, 2200)
  check('打开「悬停轮播」：存进 localStorage（on），不用刷新就能轮播（count 默认 4 → 只轮 4 张内）', stored === 'on' && withUi.out.length >= 2 && new Set([...withUi.out, indexCover]).size <= 4 && withUi.out.every((p) => s1.includes(p)), J([stored, withUi.out]))
  await reopen(b.page)
  await b.page.$eval('.gal-browse-more-btn', (btn) => btn.click())
  check('刷新后开关仍是打开（本地偏好持久）', await b.page.locator('.gal-browse-hover-toggle').isChecked(), '')
  await b.page.locator('.gal-browse-hover-toggle').uncheck()
  check('关闭 = 本地存 off；悬停不轮播', (await b.page.evaluate(() => localStorage.getItem('gal.thumbHover'))) === 'off' && (await hoverSeen(b.page, 1500)).out.length === 0)
  // —— UI 开关：封面（菜单还开着；改封面会重绘，重绘后菜单自动重新打开） ——
  await b.page.locator('.gal-browse-cover-select').selectOption('first')
  await b.page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.getAttribute('src') }, sel)
  await loaded(b.page)
  check('封面选「第一张」：存进 localStorage、立刻重绘，封面变 a（覆盖配置里的 index 2）', (await b.page.evaluate(() => localStorage.getItem('gal.thumbCover'))) === 'first' && (await srcOf(b.page)) === s1[0], await srcOf(b.page))
  await reopen(b.page)
  check('刷新后封面仍是 a（本地偏好持久）', (await srcOf(b.page)) === s1[0])
  await b.page.$eval('.gal-browse-more-btn', (btn) => btn.click())
  await b.page.locator('.gal-browse-cover-select').selectOption('last')
  await loaded(b.page)
  check('封面选「最后一张」→ f', (await srcOf(b.page)) === s1[5], await srcOf(b.page))
  await b.page.locator('.gal-browse-cover-select').selectOption('')
  await loaded(b.page)
  check('「跟随配置」：清掉本地偏好，封面回到配置的 index 2（c）；本地轮播偏好（off）不受影响', (await b.page.evaluate(() => localStorage.getItem('gal.thumbCover'))) === null && (await srcOf(b.page)) === s1[2] && (await b.page.evaluate(() => localStorage.getItem('gal.thumbHover'))) === 'off', await srcOf(b.page))
  check('没有页面错误', b.page.errors.length === 0, J(b.page.errors))
  await b.ctx.close()

  // —— 配置开着轮播，本地关 ——
  const c = await open('first', { prefs: { 'gal.thumbHover': 'off' } }); await loaded(c.page)
  const off = await hoverSeen(c.page, 1500)
  check('本地偏好 off 覆盖配置的 enabled: true：不轮播', off.out.length === 0, J(off.out))
  await c.ctx.close()
  // —— random 封面 + 随机顺序、count 3：一次悬停只轮封面 + 2 张 ——
  const d = await open('random'); await loaded(d.page)
  const seenSet = new Set([await srcOf(d.page)])
  const rnd = await hoverSeen(d.page, 2500)
  for (const p of rnd.out) seenSet.add(p)
  check('random 顺序、count 3：一次悬停只出现 3 张不同的图（封面 + 2 张）', rnd.out.length >= 4 && seenSet.size === 3 && [...seenSet].every((p) => s1.includes(p)), J([...seenSet]))
  await d.ctx.close()
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
