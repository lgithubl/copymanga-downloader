#!/usr/bin/env node
// 演示站点的浏览器冒烟（真实点击）：灌完数据后把今天几个改动各走一遍。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/demo-browser-smoke.mjs <站点地址> [认证头]
//   基本只读 + 点击；唯一会写的是把 Gal 分支脚本的阅读进度清零（让每次都从头走）。
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const BASE = (process.argv[2] || '').replace(/\/$/, '')
if (!BASE) { console.error('用法: demo-browser-smoke.mjs <站点地址> [认证头]'); process.exit(2) }
const extra = {}
if (process.argv[3]) { const [k, ...v] = process.argv[3].split(':'); extra[k.trim()] = v.join(':').trim() }
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: extra })
const errors = []
const popups = []
context.on('page', (p) => { popups.push(p); p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.dismiss().catch(() => {})) })
const page = await context.newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('dialog', (d) => d.dismiss().catch(() => {}))
const chunkBodies = []
page.on('request', (r) => { if (r.method() === 'POST' && /\/tts-chunk$/.test(r.url())) { try { chunkBodies.push(JSON.parse(r.postData() || '{}')) } catch { /* ignore */ } } })
const openLibrary = async (type = 'all') => {
  for (const p of context.pages()) if (p !== page) await p.close().catch(() => {})
  popups.length = 0
  await page.goto(`${BASE}/`)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.click('[data-view="library-view"]')
  await page.waitForSelector('#library-items .library-card', { timeout: 20000 })
  // 演示里条目多（样式测试数据），按类型筛一下才找得到想点的卡片
  if (type !== 'all') { await page.click('.library-more-controls summary'); await page.selectOption('#library-type', type); await sleep(1500); await page.waitForSelector('#library-items .library-card', { timeout: 20000 }) }
  await sleep(600)
}
const card = (title) => page.locator('#library-items .library-card', { hasText: title }).first()

// ================= 媒体库：三种导入方案都在 =================
const allItems = (await (await context.request.get(`${BASE}/api/library/items?page=1&limit=200`)).json()).items
check('媒体库里有 Gal / 文本媒体 / EPUB（导入方案各一）', ['gal-import', 'text-media'].every((p) => allItems.some((i) => i.sourceProfile === p)) && allItems.some((i) => i.type === 'epub'), J(allItems.map((i) => [i.type, i.sourceProfile]).slice(0, 8)))
await openLibrary('gal')
check('卡片带导入方案（data-profile）', (await page.$$eval('#library-items .library-card', (cs) => cs.map((c) => c.dataset.profile))).includes('gal-import'))

// ================= 新页面规则（预置：Gal、文本媒体开新页；压缩包图集的标签开新页）=================
{
  await openLibrary('gal')
  const popupP = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
  await card('UViewer演示').click()
  const gp = await popupP
  check('点 Gal 卡片：按规则 {profile:gal-import} 开新页（URL 带 tab=new）；当前页留在媒体库', Boolean(gp) && /tab=new/.test(gp.url()) && /\/media\/gal\//.test(gp.url()) && Boolean(await page.$('#library-view.active')), gp?.url() || '无')
  await openLibrary('media')
  const textP = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
  await card('文本媒体演示').click()
  await page.locator('#library-units .library-unit').first().click().catch(() => {})
  const tp = await textP
  check('点文本媒体的章节：按规则 {profile:text-media} 开新页', Boolean(tp) && /tab=new/.test(tp.url()), tp?.url() || '无')
  await openLibrary('epub')
  const epubP = context.waitForEvent('page', { timeout: 2500 }).catch(() => null)
  await card('朗读规则演示').click()
  await sleep(500)
  const ep = await epubP
  check('EPUB 没有规则：点它不开新页（在当前页打开或选中）', !ep, ep?.url())
  // 点标签：EPUB 的标签（没规则）当前页搜索；Ctrl 点击永远新页
  await openLibrary('epub')
  const tagPill = card('朗读规则演示').locator('.tag-pill').first()
  const tagP = context.waitForEvent('page', { timeout: 2500 }).catch(() => null)
  await tagPill.click()
  check('点 EPUB 卡片上的标签：没有规则 → 当前页搜索（搜索框填入标签）', !(await tagP) && (await page.inputValue('#library-tag-search')).includes('演示'))
  await openLibrary('epub')
  const ctrlP = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
  await card('朗读规则演示').locator('.tag-pill').first().click({ modifiers: ['Control'] })
  const cp = await ctrlP
  check('Ctrl 点击标签：永远开新页', Boolean(cp) && /tab=new/.test(cp.url()), cp?.url() || '无')
  const archive = allItems.filter((i) => i.sourceProfile === 'archive-gallery').length
  if (archive) {
    await openLibrary('archive')
    const aP = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
    await page.locator('#library-items .library-card[data-profile="archive-gallery"] .tag-pill').first().click()
    const ap = await aP
    check('点压缩包图集卡片上的标签：规则 {profile:archive-gallery} 命中 → 开新页', Boolean(ap) && /tab=new/.test(ap.url()), ap?.url() || '无')
  } else console.log('（演示里没有压缩包图集条目，跳过「点它的标签开新页」）')
  // 新页里「返回」：统一开关（默认开 = 关闭标签页）
  await openLibrary('gal')
  const bp = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
  await card('UViewer演示').click()
  const gal = await bp
  await gal.waitForSelector('.gal-browse', { timeout: 15000 })
  const closed = new Promise((resolve) => gal.once('close', () => resolve(true)))
  await gal.evaluate(() => document.querySelector('#media-reader-back')?.click())
  check('新页里点「返回」：统一开关开着 → 关闭这个标签页', (await Promise.race([closed, sleep(3000).then(() => false)])) === true)
}

// ================= Gal：浏览 → 沉浸 → 分支 → 自动选择 → 字体 =================
{
  // 按路由直接进首页（点卡片会「继续」上次看到的脚本，这里要从首页开始走）
  const galItem = (await (await context.request.get(`${BASE}/api/library/items?type=gal&page=1&limit=5`)).json()).items[0]
  // 重复跑时先把这个脚本的进度（含选项的选择）清零，保证每次都从头走
  await context.request.post(`${BASE}/api/library/items/gal/${galItem.itemId}/progress`, { data: { unitId: 'main', sectionId: 's:character/1003/adultr/100300.txt', scrollRatio: 0, choices: {} } })
  const g = await context.newPage()
  g.on('pageerror', (e) => errors.push(e.message))
  g.on('dialog', (d) => d.dismiss().catch(() => {}))
  await g.goto(`${BASE}/#/media/gal/${galItem.itemId}/main`)
  await g.setViewportSize({ width: 1280, height: 800 })
  await g.waitForSelector('.gal-browse', { timeout: 15000 })
  await sleep(500)
  const st = await g.evaluate(() => ({ cards: [...document.querySelectorAll('.gal-card .gal-card-title')].map((e) => e.textContent), imm: document.querySelector('#app').classList.contains('stream-immersive'), sets: [...document.querySelectorAll('.gal-browse-sets option')].map((o) => o.textContent) }))
  check('Gal 首页：真实目录树 9 个目录（中文标签）；默认沉浸；有「文本版本」下拉', st.cards.length === 9 && st.cards[0] === '纪念馆' && st.imm && st.sets.length === 2, J(st))
  await g.click('.gal-card[data-node="d:character"]'); await g.waitForSelector('.gal-card[data-node="d:character/1003"]')
  check('角色页：名称文件里的名字', J(await g.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))) === J(['卡蒂娅', '小夜', '2001']))
  await g.click('.gal-card[data-node="d:character/1003"]'); await g.waitForSelector('.gal-card[data-node="d:character/1003/adultr"]')
  await g.click('.gal-card[data-node="d:character/1003/adultr"]'); await g.waitForSelector('.gal-row[data-title="100300"]')
  await g.click('.gal-row[data-title="100300"] .gal-row-main'); await g.waitForSelector('.gal-player .gal-stage')
  check('点进分支脚本：沉浸保持（头部仍收起）；总步数先不含分支（1 / 5）', (await g.evaluate(() => document.querySelector('#app').classList.contains('stream-immersive'))) && (await g.$eval('.gal-count', (e) => e.textContent)) === '1 / 5')
  // 打开设置：字体大小 / 自动选择
  await g.click('.gal-cfg'); await sleep(200)
  const rows = await g.$$eval('.gal-settings .gal-set-row .gal-set-label', (es) => es.map((e) => e.textContent))
  check('⚙ 设置里有：字体大小、文本框透明度、BGM、语音/音效、自动等待、自动选择', ['字体大小', '文本框透明度', 'BGM 音量'].every((t) => rows.includes(t)) && rows.some((r) => /自动选择/.test(r)), J(rows))
  await g.click('.gal-cfg')
  for (let i = 0; i < 12 && !(await g.$eval('.gal-choices', (e) => !e.hidden).catch(() => false)); i++) { await g.keyboard.press('Space'); await sleep(450) }
  check('走到选项：画面正中竖排的选项出现（1「想听」/ 2「不想听」）', (await g.$$eval('.gal-choice', (bs) => bs.map((b) => b.textContent))).join() === '1「想听」,2「不想听」')
  await g.keyboard.press('2'); await sleep(500)
  check('按数字键 2 选第二项：选项收起；总步数变成 6，走乙线', !(await g.$eval('.gal-choices', (e) => !e.hidden)) && (await g.$eval('.gal-count', (e) => e.textContent)).endsWith('/ 6'))
  // 往前走一步再退回选项那一步 = 重选
  await g.keyboard.press('Space'); await sleep(500)
  await g.keyboard.press('ArrowLeft'); await sleep(600)
  check('往前一步再退回选项那一步：重新弹出选项', await g.$eval('.gal-choices', (e) => !e.hidden))
  await g.click('.gal-cfg'); await g.fill('.gal-set-autochoice', '1'); await g.dispatchEvent('.gal-set-autochoice', 'input'); await sleep(1200)
  check('自动选择设成 1：选项约 0.7 秒后自动选第 1 项；工具栏「自选:1」亮着', !(await g.$eval('.gal-choices', (e) => !e.hidden)) && (await g.$eval('.gal-autosel', (b) => b.textContent)) === '自选:1')
  await g.$eval('.gal-settings .gal-set-row:nth-child(1) input', (e) => { e.value = '150'; e.dispatchEvent(new Event('input', { bubbles: true })) })
  check('字体大小调到 150%：台词字号变大', (await g.$eval('.gal-set-value', (e) => e.textContent)) === '150%')
  await g.click('.gal-cfg')
  await sleep(1500)   // 等进度保存（防抖）
  await g.click('.gal-up'); await g.waitForSelector('.gal-browse')
  check('「↑ 列表」回到脚本列表，沉浸保持，列表上标出看到哪', (await g.evaluate(() => document.querySelector('#app').classList.contains('stream-immersive'))) && /看到|已看完/.test(await g.$eval('.gal-row[data-title="100300"]', (e) => e.textContent)))
  await g.keyboard.press('Escape'); await sleep(400)
  check('浏览层按 Esc 退出沉浸（头部回来）', !(await g.evaluate(() => document.querySelector('#app').classList.contains('stream-immersive'))))
  await g.close()
}

// ================= EPUB：朗读规则（ja / zh 各用各的参数）=================
{
  await openLibrary('epub')
  await card('朗读规则演示').click()
  await page.waitForSelector('#library-units .library-unit', { timeout: 10000 }).catch(() => {})
  await page.locator('#library-units .library-unit').first().click().catch(() => {})
  await page.waitForSelector('#media-reader-content [data-tts-flag]', { state: 'attached', timeout: 20000 })
  await sleep(800)
  if (!(await page.$('.epub-tts-toggle'))) await page.click('#media-immersive').catch(() => {})
  await page.waitForSelector('.epub-tts-toggle', { timeout: 10000 })
  const options = await page.$$eval('.epub-tts-flag option', (os) => os.map((o) => o.value))
  check('阅读页：朗读范围下拉有 全部 / ja / zh', [...options].sort().join() === 'all,ja,zh', J(options))
  chunkBodies.length = 0
  await page.click('.epub-tts-toggle')
  for (let i = 0; i < 40 && !(chunkBodies.some((b) => b.flags?.includes('ja')) && chunkBodies.some((b) => b.flags?.includes('zh'))); i++) await sleep(300)
  await sleep(1500)
  const all = chunkBodies.flatMap((b) => (b.texts || []).map((t, i) => (b.flags || [])[i]))
  check('朗读「全部」：请求带上每句的 flag（ja 和 zh 都有）', all.includes('ja') && all.includes('zh'), J(all))
  const playing = await page.evaluate(() => [...document.querySelectorAll('audio')].length >= 0)
  check('朗读起来了（按钮是激活态或有声音请求）', playing && chunkBodies.length >= 1)
  await page.click('.epub-tts-toggle'); await sleep(300)
}

// ================= 配置页：朗读规则 JSON + 新页面规则 JSON =================
{
  await page.goto(`${BASE}/`)
  await page.click('[data-view="settings-view"]')
  await page.waitForSelector('#config-epub-tts-rules')
  await page.waitForFunction(() => document.querySelector('#config-epub-tts-rules')?.value.length > 2 && document.querySelector('#config-media-new-tab-rules')?.value.length > 2, null, { timeout: 10000 })
  const tts = JSON.parse(await page.inputValue('#config-epub-tts-rules'))
  const open = JSON.parse(await page.inputValue('#config-media-new-tab-rules'))
  check('配置页：朗读规则、新页面规则都是 JSON 数组（预置了演示规则）', tts.length === 2 && tts[0].flag === 'ja' && open.some((r) => r.profile === 'gal-import'), J([tts, open]))
  await page.click('#config-epub-tts-flag-check')
  await page.waitForFunction(() => /ja：参考音频 demo-ja\.wav/.test(document.querySelector('#config-epub-tts-flag-result')?.textContent || ''), null, { timeout: 8000 })
  check('「检查规则」：列出 ja / zh 各自实际生效的参数', /zh：参考音频 demo-default\.wav/.test(await page.$eval('#config-epub-tts-flag-result', (e) => e.textContent)))
  await page.selectOption('#config-media-new-tab-pick-profile', 'rj-media'); await page.selectOption('#config-media-new-tab-pick-kind', 'video')
  await page.click('#config-media-new-tab-add')
  check('「添加规则」下拉：加一条 {profile, kind} 到 JSON 数组（这里只看文本框，没保存）', JSON.parse(await page.inputValue('#config-media-new-tab-rules')).some((r) => r.profile === 'rj-media' && r.kind === 'video'))
}

check('全程没有页面错误', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
