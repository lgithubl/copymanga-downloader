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
const CLEAN = { mediaOpenInNewTabRules: [], tagSearchOpenInNewTabRules: [], mediaCloseNewTabOnBack: true }
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

// ---- 配置接口：归一化 + 旧配置迁移 ----
{
  await setConfig({ mediaOpenInNewTabRules: [{ profile: 'gal-import' }, { kind: 'text' }, { profile: 'rj-media', kind: 'video' }, { profile: 'gal-import' }, {}, { profile: 'bad name!' }, { profile: 'ok', kind: '../x' }, { kind: 5 }, 'x', null, [1]], tagSearchOpenInNewTabRules: 'nope' })
  const c = (await api('/api/config')).body
  check('规则：只收「安全字符的 profile/kind」；重复、空规则、非法字段（整条丢，不会悄悄变宽）、非对象都丢', J(c.mediaOpenInNewTabRules) === J([{ profile: 'gal-import' }, { kind: 'text' }, { profile: 'rj-media', kind: 'video' }]), J(c.mediaOpenInNewTabRules))
  check('规则不是数组 → 当成没设置（空）', J(c.tagSearchOpenInNewTabRules) === '[]')
  await setConfig({ mediaOpenInNewTabRules: null, mediaOpenInNewTabKinds: ['text', 'epub'], mediaOpenInNewTabProfiles: { 'gal-import': true, 'rj-media': false }, tagSearchOpenInNewTabRules: null, tagSearchOpenInNewTabKinds: ['video'], tagSearchOpenInNewTabProfiles: { 'archive-gallery': true } })
  const m = (await api('/api/config')).body
  check('旧配置迁移：勾选的类型 → { kind }，按方案设成新页面的 → { profile }（旧的「当前页」没有对应规则，丢掉）', J(m.mediaOpenInNewTabRules) === J([{ kind: 'text' }, { kind: 'epub' }, { profile: 'gal-import' }]) && J(m.tagSearchOpenInNewTabRules) === J([{ kind: 'video' }, { profile: 'archive-gallery' }]), J([m.mediaOpenInNewTabRules, m.tagSearchOpenInNewTabRules]))
  check('保存后旧字段不再输出（只留新的规则字段）', !('mediaOpenInNewTabKinds' in m) && !('mediaOpenInNewTabProfiles' in m) && !('tagSearchOpenInNewTabKinds' in m))
  await setConfig()
  const d = (await api('/api/config')).body
  check('默认：两组规则都是空（= 都在当前页），统一开关默认开（新页里返回=关闭标签页）', J(d.mediaOpenInNewTabRules) === '[]' && J(d.tagSearchOpenInNewTabRules) === '[]' && d.mediaCloseNewTabOnBack === true)
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
const outcomes = async () => {
  const out = {}
  for (const [title, key] of [['演示Gal', 'gal'], ['压缩包图集', 'archive'], ['文本媒体', 'text']]) { await openLibrary(); out[key] = outcome(await attemptOpen(title)) }
  return out
}
await openLibrary()
check('默认（规则为空）：三种都在当前页打开', J(await outcomes()) === J({ gal: 'same', archive: 'same', text: 'same' }))

// ---- 只写类型：{kind:text}（不分方案）----
await setConfig({ mediaOpenInNewTabRules: [{ kind: 'text' }] })
check('规则 {kind:text}：文本媒体开新页，另外两种仍在当前页', J(await outcomes()) === J({ gal: 'same', archive: 'same', text: 'new' }))

// ---- 只写方案：{profile:gal-import}（Gal 的类型 gal 以前没法勾，现在按方案或类型都行）----
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'gal-import' }] })
{
  await openLibrary()
  const r = await attemptOpen('演示Gal')
  check('规则 {profile:gal-import}：Gal 媒体开新页；URL 是媒体路由并带 tab=new；当前页留在媒体库', outcome(r) === 'new' && /#\/media\/gal\//.test(r.url) && /tab=new/.test(r.url), J([outcome(r), r.url]))
  await openLibrary()
  check('当前页没有被带走（还在媒体库页）', Boolean(await page.$('#library-view.active')) && !(await page.$('#media-viewer-view.active')))
  await openLibrary()
  check('其它方案不受影响：压缩包图集仍在当前页', outcome(await attemptOpen('压缩包图集')) === 'same')
}
await setConfig({ mediaOpenInNewTabRules: [{ kind: 'gal' }] })
check('规则 {kind:gal}：按类型也能让 Gal 开新页', outcome(await (async () => { await openLibrary(); return attemptOpen('演示Gal') })()) === 'new')

// ---- 方案 && 类型（AND）：两个都要匹配 ----
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'text-media', kind: 'video' }] })
check('规则 {profile:text-media, kind:video}：类型对不上（文本媒体的单元是 text）→ 不开新页（AND，不是 OR）', J(await outcomes()) === J({ gal: 'same', archive: 'same', text: 'same' }))
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'archive-gallery', kind: 'text' }] })
check('规则 {profile:archive-gallery, kind:text}：方案对但类型不对 → 不开', J(await outcomes()) === J({ gal: 'same', archive: 'same', text: 'same' }))
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'archive-gallery', kind: 'image-gallery' }, { profile: 'text-media', kind: 'text' }] })
check('规则 {archive-gallery & image-gallery}、{text-media & text}：两个都匹配 → 压缩包图集和文本媒体开新页；Gal 不开', J(await outcomes()) === J({ gal: 'same', archive: 'new', text: 'new' }))

// ---- 多条规则：任意一条命中（OR）----
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'gal-import' }, { kind: 'text' }] })
check('规则 [{profile:gal-import},{kind:text}]：任意一条命中就开新页（Gal 和文本开，压缩包图集不开）', J(await outcomes()) === J({ gal: 'new', archive: 'same', text: 'new' }))

// ---- Ctrl/⌘ 点击永远新页 ----
await setConfig()
{
  await openLibrary()
  check('规则为空时 Ctrl 点击：也开新页', outcome(await attemptOpen('演示Gal', { ctrl: true })) === 'new')
  await openLibrary()
  check('不按 Ctrl：当前页', outcome(await attemptOpen('演示Gal')) === 'same')
}

// ---- 历史里点「继续」：服务端记了方案，按规则判断 ----
{
  await openLibrary()
  await attemptOpen('演示Gal'); await sleep(900)
  const hist = (await api('/api/library/history')).body
  const list = Array.isArray(hist) ? hist : hist.items || []
  const rec = list.find((h) => h.type === 'gal')
  check('历史记录里带上了 sourceProfile（服务端从条目补的）', rec?.sourceProfile === 'gal-import', J(rec))
  await setConfig({ mediaOpenInNewTabRules: [{ profile: 'gal-import' }] })
  await openLibrary()
  await page.click('[data-view="history-view"]')
  await page.waitForSelector('#history-list .history-card')
  const popupP = context.waitForEvent('page', { timeout: 2500 }).catch(() => null)
  await page.locator('#history-list .history-card', { hasText: '演示Gal' }).first().locator('.history-continue').click()
  const popup = await popupP
  check('历史里点 Gal 的「继续」：规则 {profile:gal-import} 命中 → 开新页', Boolean(popup) && /tab=new/.test(popup?.url() || ''), popup?.url() || '无')
}

// ---- 点标签（搜索）：同样的规则格式，但和「打开媒体」分开 ----
const tagOutcome = async (title, tag) => {
  await openLibrary()
  const popupP = context.waitForEvent('page', { timeout: 2200 }).catch(() => null)
  await card(title).locator(`.tag-pill[data-tag="${tag}"]`).first().click()
  const popup = await popupP
  await sleep(400)
  return { popup, url: popup?.url() || '', same: (await page.inputValue('#library-tag-search').catch(() => '')).includes(tag) }
}
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'gal-import' }] })   // 只设了打开媒体
{
  const r = await tagOutcome('演示Gal', '标签G')
  check('点标签与「打开媒体」分开：只设了打开媒体的规则，点标签仍在当前页（搜索框填入标签）', !r.popup && r.same, J([r.url, r.same]))
}
await setConfig({ tagSearchOpenInNewTabRules: [{ profile: 'archive-gallery' }, { kind: 'text' }] })
{
  const a = await tagOutcome('压缩包图集', '标签A')
  const g = await tagOutcome('演示Gal', '标签G')
  const t = await tagOutcome('文本媒体', '标签T')
  check('点标签规则 [{profile:archive-gallery},{kind:text}]：压缩包图集、文本开新页（URL 是媒体库路由）；Gal 当前页', Boolean(a.popup) && /tab=new/.test(a.url) && !g.popup && g.same && Boolean(t.popup), J([!!a.popup, a.url, !!g.popup, !!t.popup]))
}
await setConfig({ tagSearchOpenInNewTabRules: [{ profile: 'text-media', kind: 'video' }, { profile: 'gal-import', kind: 'gal' }] })
{
  const t = await tagOutcome('文本媒体', '标签T')
  const g = await tagOutcome('演示Gal', '标签G')
  check('点标签的 AND：{text-media & video} 对文本媒体不匹配 → 当前页；{gal-import & gal} 匹配 Gal → 新页', !t.popup && t.same && Boolean(g.popup))
}

// ---- 新页面里「返回」：统一开关 ----
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'gal-import' }], mediaCloseNewTabOnBack: true })
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
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'gal-import' }], mediaCloseNewTabOnBack: false })
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
await setConfig({ mediaOpenInNewTabRules: [{ profile: 'archive-gallery' }], mediaCloseNewTabOnBack: true })
{
  await openLibrary()
  const r = await attemptOpen('压缩包图集')
  const popup = r.popup
  await popup.waitForSelector('#media-viewer-view.active', { timeout: 8000 })
  const closed = new Promise((resolve) => popup.once('close', () => resolve(true)))
  await popup.evaluate(() => document.querySelector('#media-reader-back')?.click())
  check('统一开关对所有方案一样：压缩包图集新页里「返回」也关闭标签页', (await Promise.race([closed, sleep(2500).then(() => false)])) === true)
}

// ---- 配置页：JSON 数组 + 下拉「添加规则」 ----
{
  const dialogs = []
  page.removeAllListeners('dialog')
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}) })
  await setConfig({ mediaOpenInNewTabRules: [{ profile: 'gal-import' }, { profile: 'rj-media', kind: 'video' }], tagSearchOpenInNewTabRules: [{ kind: 'text' }], mediaCloseNewTabOnBack: true })
  await page.goto(`${base}/`); await page.reload()
  await page.click('[data-view="settings-view"]')
  await page.waitForSelector('#config-media-new-tab-rules')
  const shown = await page.inputValue('#config-media-new-tab-rules')
  check('配置页：规则以 JSON 数组显示，一条一行', shown === '[\n  {"profile":"gal-import"},\n  {"profile":"rj-media","kind":"video"}\n]' && (await page.inputValue('#config-tag-search-new-tab-rules')) === '[\n  {"kind":"text"}\n]', shown)
  check('下拉：方案 6 个 + 「任意」，类型 6 个 + 「任意」', (await page.$$eval('#config-media-new-tab-pick-profile option', (o) => o.length)) === 7 && (await page.$$eval('#config-media-new-tab-pick-kind option', (o) => o.length)) === 7)
  await page.locator('#config-media-new-tab-rules').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp/gal-shots', 'config-newtab.png') })
  await page.selectOption('#config-media-new-tab-pick-profile', 'monthly-ani')
  await page.click('#config-media-new-tab-add')
  check('选方案点「添加规则」：往数组里加一条 {profile}', (await page.inputValue('#config-media-new-tab-rules')).includes('{"profile":"monthly-ani"}'))
  await page.selectOption('#config-media-new-tab-pick-profile', 'text-media'); await page.selectOption('#config-media-new-tab-pick-kind', 'text')
  await page.click('#config-media-new-tab-add')
  await page.selectOption('#config-media-new-tab-pick-profile', 'text-media'); await page.selectOption('#config-media-new-tab-pick-kind', 'text')
  await page.click('#config-media-new-tab-add')
  const afterAdd = JSON.parse(await page.inputValue('#config-media-new-tab-rules'))
  check('方案 + 类型都选：加一条 {profile, kind}；同样的再加一次不重复', J(afterAdd) === J([{ profile: 'gal-import' }, { profile: 'rj-media', kind: 'video' }, { profile: 'monthly-ani' }, { profile: 'text-media', kind: 'text' }]), J(afterAdd))
  await page.selectOption('#config-media-new-tab-pick-profile', ''); await page.selectOption('#config-media-new-tab-pick-kind', 'audio')
  await page.click('#config-media-new-tab-add')
  check('只选类型：加一条 {kind}', JSON.parse(await page.inputValue('#config-media-new-tab-rules')).some((r) => r.kind === 'audio' && !r.profile))
  await page.selectOption('#config-media-new-tab-pick-profile', ''); await page.selectOption('#config-media-new-tab-pick-kind', '')
  const before = await page.inputValue('#config-media-new-tab-rules')
  await page.click('#config-media-new-tab-add')
  check('方案和类型都选「任意」：提示至少选一个，不加', dialogs.some((d) => /至少选一个/.test(d)) && (await page.inputValue('#config-media-new-tab-rules')) === before, J(dialogs))
  await page.selectOption('#config-tag-search-new-tab-pick-profile', 'archive-gallery')
  await page.click('#config-tag-search-new-tab-add')
  check('点标签那一组独立：加到它自己的数组里，不影响打开媒体', JSON.parse(await page.inputValue('#config-tag-search-new-tab-rules')).some((r) => r.profile === 'archive-gallery') && !(await page.inputValue('#config-media-new-tab-rules')).includes('archive-gallery'))
  await page.click('#config-save'); await sleep(1200)
  const saved = (await api('/api/config')).body
  check('保存：规则写进配置（点标签、打开媒体各一组）', J(saved.mediaOpenInNewTabRules) === J([{ profile: 'gal-import' }, { profile: 'rj-media', kind: 'video' }, { profile: 'monthly-ani' }, { profile: 'text-media', kind: 'text' }, { kind: 'audio' }]) && J(saved.tagSearchOpenInNewTabRules) === J([{ kind: 'text' }, { profile: 'archive-gallery' }]), J([saved.mediaOpenInNewTabRules, saved.tagSearchOpenInNewTabRules]))
  // 删规则 = 直接改 JSON
  await page.fill('#config-media-new-tab-rules', '[{"profile":"gal-import"}]')
  await page.click('#config-save'); await sleep(1200)
  check('删规则：直接改 JSON 保存（手写的紧凑格式也行）', J((await api('/api/config')).body.mediaOpenInNewTabRules) === J([{ profile: 'gal-import' }]))
  await page.reload(); await page.click('[data-view="settings-view"]'); await page.waitForSelector('#config-media-new-tab-rules')
  check('刷新后配置页显示保存的规则（统一格式）', (await page.inputValue('#config-media-new-tab-rules')) === '[\n  {"profile":"gal-import"}\n]')
  // JSON 写错：明确报错，不保存，也不把已有规则清掉
  dialogs.length = 0
  await page.fill('#config-media-new-tab-rules', '[{"profile":"gal-import"},')
  await page.click('#config-save'); await sleep(900)
  check('JSON 写错：弹出明确的错误、不保存，已存的规则还在', dialogs.some((d) => /不是合法的 JSON/.test(d) && /打开媒体/.test(d)) && J((await api('/api/config')).body.mediaOpenInNewTabRules) === J([{ profile: 'gal-import' }]), J(dialogs))
  dialogs.length = 0
  await page.fill('#config-media-new-tab-rules', '{"profile":"gal-import"}')
  await page.click('#config-save'); await sleep(900)
  check('不是数组（是对象）：报错、不保存', dialogs.some((d) => /必须是 JSON 数组/.test(d)) && J((await api('/api/config')).body.mediaOpenInNewTabRules) === J([{ profile: 'gal-import' }]))
  dialogs.length = 0
  await page.fill('#config-media-new-tab-rules', '[]')
  await page.click('#config-save'); await sleep(1200)
  check('清空成 []：保存成功，都回到当前页', J((await api('/api/config')).body.mediaOpenInNewTabRules) === '[]' && dialogs.length === 0)
  check('统一开关的说明写清楚了：开 = 关闭标签页、关 = 回到媒体库页', /开 = 关闭这个标签页；关 = 回到媒体库页/.test(await page.$eval('label:has(#config-media-close-new-tab-on-back)', (l) => l.textContent)))
}

check('全程没有页面错误', errors.length === 0, errors.join(' | '))
await browser.close()
server.kill('SIGTERM')
await rm(work, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
