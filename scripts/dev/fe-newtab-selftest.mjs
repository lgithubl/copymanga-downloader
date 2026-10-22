#!/usr/bin/env node
// 浏览器自测：「点媒体 / 点标签 是否用新页面」——按导入方案（sourceProfile）单独设置，优先于按类型的勾选；
// 新页面里「返回」是关闭标签页还是回媒体库页，由统一开关 mediaCloseNewTabOnBack 决定。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-newtab-selftest.mjs
// 需要 ImageMagick、python3（造 zip）。用三种导入方案的条目：gal-import（Gal）、archive-gallery（压缩包图集）、text-media（TXT）。
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGalFixture } from './make-gal-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test'))
} catch {
  console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH')
  process.exit(2)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-newtab-'))
const dataDir = path.join(work, 'data')
const galDir = path.join(dataDir, 'gal', '演示Gal')
await mkdir(galDir, { recursive: true })
await buildGalFixture(galDir, { many: 2 })
const port = 8104
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用（上次测试没清理干净？）`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

const api = async (p, init = {}) => {
  const res = await fetch(base + p, init)
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: text } }
}
const postJson = (p, v) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })
// 服务端保存配置是合并式的：每次先清掉这几项再套上本次要的，测试之间才互不影响
const CLEAN = { mediaOpenInNewTabKinds: [], mediaOpenInNewTabProfiles: {}, tagSearchOpenInNewTabKinds: [], tagSearchOpenInNewTabProfiles: {}, mediaCloseNewTabOnBack: true }
const setConfig = (patch = {}) => postJson('/api/config', { ...CLEAN, ...patch })

// ---- 造数据：三种导入方案各一个条目 ----
{
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', galDir); form.set('profileOptions', '{}')
  const g = await api('/api/library/items?type=gal', { method: 'POST', body: form })
  const zdir = path.join(work, 'zip'); await mkdir(zdir, { recursive: true })
  for (let i = 1; i <= 3; i++) execFileSync('magick', ['-size', '300x400', `xc:#${i}a6cb0`, path.join(zdir, `${i}.png`)])
  execFileSync('python3', ['-I', '-c', 'import sys,zipfile,glob,os\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor f in sorted(glob.glob(os.path.join(sys.argv[2],"*.png"))): z.write(f,os.path.basename(f))\nz.close()', path.join(work, '压缩包图集.zip'), zdir])
  const zf = new FormData()
  zf.set('importProfile', 'archive-gallery'); zf.set('file', new Blob([await (await import('node:fs/promises')).readFile(path.join(work, '压缩包图集.zip'))]), '压缩包图集.zip')
  const a = await api('/api/library/items?type=archive', { method: 'POST', body: zf })
  const tf = new FormData()
  tf.set('importProfile', 'text-media'); tf.set('file', new Blob([`第一章\n${'这是一些文字。\n'.repeat(60)}`]), '文本媒体.txt')
  const t = await api('/api/library/items?type=media', { method: 'POST', body: tf })
  check('造数据：三种导入方案各导入成功（gal-import / archive-gallery / text-media）', g.status < 300 && a.status < 300 && t.status < 300, J([g.status, a.status, t.status]))
}
await api('/api/library/index/rebuild', { method: 'POST' })
let items = []
for (let i = 0; i < 40; i++) { items = (await api('/api/library/items?page=1&limit=50')).body.items || []; if (items.length >= 3) break; await sleep(400) }
const by = (profile) => items.find((i) => i.sourceProfile === profile)
const G = by('gal-import'), A = by('archive-gallery'), T = by('text-media')
check('索引里三个条目都带 sourceProfile', Boolean(G && A && T), J(items.map((i) => [i.title, i.sourceProfile])))
for (const [it, tag] of [[G, '标签G'], [A, '标签A'], [T, '标签T']]) await postJson(`/api/library/items/${it.type}/${it.itemId}/tags`, { tags: [tag] })
await api('/api/library/index/rebuild', { method: 'POST' })
await sleep(1500)

// ---- 配置接口：归一化 ----
{
  await setConfig({ mediaOpenInNewTabProfiles: { 'gal-import': true, 'text-media': false, 'bad name!': true, 'x': 'yes', 'archive-gallery': 1, '../etc': true }, tagSearchOpenInNewTabProfiles: [true], mediaOpenInNewTabKinds: ['text', 'nope'] })
  const c = (await api('/api/config')).body
  check('配置：按导入方案的映射只收「安全方案名 → 布尔」；非法名/非布尔/数组都丢', J(c.mediaOpenInNewTabProfiles) === J({ 'gal-import': true, 'text-media': false }) && J(c.tagSearchOpenInNewTabProfiles) === J({}), J([c.mediaOpenInNewTabProfiles, c.tagSearchOpenInNewTabProfiles]))
  check('配置：按类型的勾选原样保留（非法类型丢）', J(c.mediaOpenInNewTabKinds) === J(['text']))
  await setConfig({})
  const d = (await api('/api/config')).body
  check('默认：两个映射都是空（= 全部跟随类型），统一开关默认开（新页里返回=关闭标签页）', J(d.mediaOpenInNewTabProfiles) === '{}' && J(d.tagSearchOpenInNewTabProfiles) === '{}' && d.mediaCloseNewTabOnBack === true)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const errors = []
const newPages = []
context.on('page', (p) => { newPages.push(p); p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.dismiss().catch(() => {})) })
const page = await context.newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('dialog', (d) => d.dismiss().catch(() => {}))
newPages.length = 0

const openLibrary = async () => {
  for (const p of context.pages()) if (p !== page) await p.close().catch(() => {})
  newPages.length = 0
  await page.goto(`${base}/`)
  await page.evaluate(() => localStorage.clear())   // 点标签（当前页）会把搜索条件存下来，别带到下一个用例
  await page.reload()
  await page.click('[data-view="library-view"]')
  await page.waitForSelector('#library-items .library-card')
  await sleep(500)
}
const card = (title) => page.locator('#library-items .library-card', { hasText: title }).first()
// 点「打开」：返回 { popup: 开出的新页面（没有就 null）, same: 当前页里是不是进了阅读器 }
const attemptOpen = async (title, { ctrl = false } = {}) => {
  const popupP = context.waitForEvent('page', { timeout: 2200 }).catch(() => null)
  await card(title).click({ modifiers: ctrl ? ['Control'] : [] })
  // 文本媒体点卡片只是选中，要再点章节行才是打开
  if (title === '文本媒体' && !(await page.$('#media-viewer-view.active'))) {
    await page.waitForSelector('#library-units .library-unit', { timeout: 4000 })
    await page.locator('#library-units .library-unit').first().click({ modifiers: ctrl ? ['Control'] : [] })
  }
  const popup = await popupP
  await sleep(500)
  const same = Boolean(await page.$('#media-viewer-view.active'))
  return { popup, same, url: popup ? popup.url() : '' }
}
const outcome = (r) => (r.popup ? 'new' : r.same ? 'same' : 'none')

// ---- 默认：全部当前页 ----
await openLibrary()
{
  const out = {}
  for (const [title, key] of [['演示Gal', 'gal'], ['压缩包图集', 'archive'], ['文本媒体', 'text']]) {
    await openLibrary()
    out[key] = outcome(await attemptOpen(title))
  }
  check('默认（什么都没勾）：三种都在当前页打开', J(out) === J({ gal: 'same', archive: 'same', text: 'same' }), J(out))
}

// ---- 只按类型：text 勾了 → 只有 text 开新页（Gal/压缩包图集没有对应类型可勾） ----
await setConfig({ mediaOpenInNewTabKinds: ['text'] })
{
  const out = {}
  for (const [title, key] of [['演示Gal', 'gal'], ['压缩包图集', 'archive'], ['文本媒体', 'text']]) { await openLibrary(); out[key] = outcome(await attemptOpen(title)) }
  check('只勾类型 text：文本媒体开新页，另外两种仍在当前页', J(out) === J({ gal: 'same', archive: 'same', text: 'new' }), J(out))
}

// ---- 按导入方案：Gal 开新页（类型里本来没法勾 gal）----
await setConfig({ mediaOpenInNewTabProfiles: { 'gal-import': true } })
{
  await openLibrary()
  const r = await attemptOpen('演示Gal')
  check('按方案 gal-import=新页面：Gal 媒体开新页；URL 是媒体路由并带 tab=new', outcome(r) === 'new' && /#\/media\/gal\//.test(r.url) && /tab=new/.test(r.url), J([outcome(r), r.url]))
  await openLibrary()
  check('当前页没有被带走（还在媒体库页）', Boolean(await page.$('#library-view.active')) && !(await page.$('#media-viewer-view.active')))
  await openLibrary()
  check('其它方案不受影响：压缩包图集仍在当前页', outcome(await attemptOpen('压缩包图集')) === 'same')
}
// ---- 方案比类型优先：类型勾了 text，但 text-media 方案设成当前页 → 当前页 ----
await setConfig({ mediaOpenInNewTabKinds: ['text'], mediaOpenInNewTabProfiles: { 'text-media': false } })
{
  await openLibrary()
  check('方案 text-media=当前页 优先于类型 text=新页面：在当前页打开', outcome(await attemptOpen('文本媒体')) === 'same')
}
// ---- 方案 = 新页面，类型没勾 ----
await setConfig({ mediaOpenInNewTabProfiles: { 'archive-gallery': true, 'text-media': true } })
{
  await openLibrary()
  const a = await attemptOpen('压缩包图集')
  await openLibrary()
  const t = await attemptOpen('文本媒体')
  check('压缩包图集 / 文本媒体 方案=新页面：都开新页；Gal 回到当前页（没设）', outcome(a) === 'new' && outcome(t) === 'new', J([outcome(a), outcome(t)]))
  await openLibrary()
  check('没设方案的 Gal 回到「跟随类型」：当前页', outcome(await attemptOpen('演示Gal')) === 'same')
}
// ---- Ctrl/⌘ 点击永远新页，哪怕方案说当前页 ----
await setConfig({ mediaOpenInNewTabProfiles: { 'gal-import': false } })
{
  await openLibrary()
  check('Ctrl 点击：方案=当前页 也开新页', outcome(await attemptOpen('演示Gal', { ctrl: true })) === 'new')
  await openLibrary()
  check('不按 Ctrl：方案=当前页 就是当前页', outcome(await attemptOpen('演示Gal')) === 'same')
}

// ---- 历史里点「继续」：服务端记了方案，按方案判断 ----
await setConfig({ mediaOpenInNewTabProfiles: {} })
{
  await openLibrary()
  await attemptOpen('演示Gal'); await sleep(900)
  const hist = (await api('/api/library/history')).body
  const list = Array.isArray(hist) ? hist : hist.items || []
  const rec = list.find((h) => h.type === 'gal')
  check('历史记录里带上了 sourceProfile（服务端从条目补的）', rec?.sourceProfile === 'gal-import', J(rec))
  await setConfig({ mediaOpenInNewTabProfiles: { 'gal-import': true } })
  await openLibrary()
  await page.click('[data-view="history-view"]')
  await page.waitForSelector('#history-list .history-card')
  const popupP = context.waitForEvent('page', { timeout: 2500 }).catch(() => null)
  await page.locator('#history-list .history-card', { hasText: '演示Gal' }).first().locator('.history-continue').click()
  const popup = await popupP
  check('历史里点 Gal 的「继续」：按方案 gal-import=新页面 开新页', Boolean(popup) && /tab=new/.test(popup?.url() || ''), popup?.url() || '无')
}

// ---- 点标签（搜索）：同样按方案；和打开媒体的设置分开 ----
const tagOutcome = async (title, tag) => {
  await openLibrary()
  const popupP = context.waitForEvent('page', { timeout: 2200 }).catch(() => null)
  await card(title).locator(`.tag-pill[data-tag="${tag}"]`).first().click()
  const popup = await popupP
  await sleep(400)
  return { popup, url: popup?.url() || '', same: (await page.inputValue('#library-tag-search').catch(() => '')).includes(tag) }
}
await setConfig({ mediaOpenInNewTabProfiles: { 'gal-import': true } })   // 打开媒体的设置不影响点标签
{
  const r = await tagOutcome('演示Gal', '标签G')
  check('点标签与「打开媒体」分开：只设了打开媒体，点标签仍在当前页（搜索框填入标签）', !r.popup && r.same, J([r.url, r.same]))
}
await setConfig({ tagSearchOpenInNewTabProfiles: { 'archive-gallery': true }, tagSearchOpenInNewTabKinds: ['text'] })
{
  const a = await tagOutcome('压缩包图集', '标签A')
  const g = await tagOutcome('演示Gal', '标签G')
  const t = await tagOutcome('文本媒体', '标签T')
  check('点标签：压缩包图集（方案=新页面）开新页，URL 是媒体库路由；Gal 当前页；文本（类型勾了）新页', Boolean(a.popup) && /tab=new/.test(a.url) && !g.popup && g.same && Boolean(t.popup), J([!!a.popup, a.url, !!g.popup, !!t.popup]))
}
await setConfig({ tagSearchOpenInNewTabProfiles: { 'text-media': false }, tagSearchOpenInNewTabKinds: ['text'] })
{
  const t = await tagOutcome('文本媒体', '标签T')
  check('点标签：方案 text-media=当前页 优先于类型 text=新页面', !t.popup && t.same)
}

// ---- 新页面里「返回」：统一开关 ----
await setConfig({ mediaOpenInNewTabProfiles: { 'gal-import': true }, mediaCloseNewTabOnBack: true })
{
  await openLibrary()
  const r = await attemptOpen('演示Gal')
  const popup = r.popup
  await popup.waitForSelector('.gal-browse', { timeout: 8000 })
  const closed = new Promise((resolve) => popup.once('close', () => resolve(true)))
  await popup.evaluate(() => document.querySelector('#media-reader-back')?.click())
  const didClose = await Promise.race([closed, sleep(2500).then(() => false)])
  check('统一开关=开：新页面里点「返回」→ 关闭这个标签页', didClose === true, J(didClose))
}
await setConfig({ mediaOpenInNewTabProfiles: { 'gal-import': true }, mediaCloseNewTabOnBack: false })
{
  await openLibrary()
  const r = await attemptOpen('演示Gal')
  const popup = r.popup
  await popup.waitForSelector('.gal-browse', { timeout: 8000 })
  await popup.evaluate(() => document.querySelector('#media-reader-back')?.click())
  await sleep(1500)
  const state = await popup.evaluate(() => ({ lib: document.querySelector('#library-view')?.classList.contains('active'), reader: document.querySelector('#media-viewer-view')?.classList.contains('active') })).catch(() => null)
  check('统一开关=关：新页面里点「返回」→ 留在这个标签页，回到媒体库页', state && state.lib && !state.reader, J(state))
}
await setConfig({ mediaOpenInNewTabProfiles: { 'archive-gallery': true }, mediaCloseNewTabOnBack: true })
{
  await openLibrary()
  const r = await attemptOpen('压缩包图集')
  const popup = r.popup
  await popup.waitForSelector('#media-viewer-view.active', { timeout: 8000 })
  const closed = new Promise((resolve) => popup.once('close', () => resolve(true)))
  await popup.evaluate(() => document.querySelector('#media-reader-back')?.click())
  check('统一开关对所有方案一样：压缩包图集新页里「返回」也关闭标签页', (await Promise.race([closed, sleep(2500).then(() => false)])) === true)
}

// ---- 配置页：按导入方案的下拉（跟随类型 / 新页面 / 当前页）----
await setConfig({ mediaOpenInNewTabProfiles: { 'gal-import': true, 'text-media': false }, tagSearchOpenInNewTabProfiles: { 'archive-gallery': true }, mediaCloseNewTabOnBack: true })
{
  await page.goto(`${base}/`); await page.reload()
  await page.click('[data-view="settings-view"]')
  await page.waitForSelector('.config-media-new-tab-profile')
  await page.locator('.config-media-new-tab-profile').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp/gal-shots', 'config-newtab.png') })
  const vals = await page.$$eval('.config-media-new-tab-profile', (ss) => Object.fromEntries(ss.map((s) => [s.dataset.profile, s.value])))
  const tvals = await page.$$eval('.config-tag-search-new-tab-profile', (ss) => Object.fromEntries(ss.map((s) => [s.dataset.profile, s.value])))
  check('配置页：6 个导入方案各一个下拉（打开媒体 / 点标签各一组），显示已存的值', Object.keys(vals).length === 6 && vals['gal-import'] === 'new' && vals['text-media'] === 'same' && vals['archive-gallery'] === '' && tvals['archive-gallery'] === 'new' && tvals['gal-import'] === '', J([vals, tvals]))
  await page.selectOption('.config-media-new-tab-profile[data-profile="rj-media"]', 'new')
  await page.selectOption('.config-media-new-tab-profile[data-profile="gal-import"]', '')
  await page.selectOption('.config-tag-search-new-tab-profile[data-profile="normal-video"]', 'same')
  await page.click('#config-save')
  await sleep(1200)
  const saved = (await api('/api/config')).body
  const sorted = (o) => J(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
  check('配置页保存：新页面=true、当前页=false、跟随类型=不写', sorted(saved.mediaOpenInNewTabProfiles) === sorted({ 'text-media': false, 'rj-media': true }) && sorted(saved.tagSearchOpenInNewTabProfiles) === sorted({ 'archive-gallery': true, 'normal-video': false }), J([saved.mediaOpenInNewTabProfiles, saved.tagSearchOpenInNewTabProfiles]))
  await page.reload(); await page.click('[data-view="settings-view"]'); await page.waitForSelector('.config-media-new-tab-profile')
  check('刷新后配置页还显示保存的值', (await page.$eval('.config-media-new-tab-profile[data-profile="rj-media"]', (s) => s.value)) === 'new' && (await page.$eval('.config-media-new-tab-profile[data-profile="gal-import"]', (s) => s.value)) === '')
  check('统一开关的说明写清楚了：开 = 关闭标签页、关 = 回到媒体库页', /开 = 关闭这个标签页；关 = 回到媒体库页/.test(await page.$eval('label:has(#config-media-close-new-tab-on-back)', (l) => l.textContent)))
}

check('全程没有页面错误', errors.length === 0, errors.join(' | '))
await browser.close()
server.kill('SIGTERM')
await rm(work, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
