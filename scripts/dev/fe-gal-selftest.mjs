#!/usr/bin/env node
// 浏览器自测：Gal 导入（导入页 UI）→ 媒体库卡片 → 单元 → 浏览层（首页/分类/角色/翻页/变体/返回/刷新恢复）→ 播放器（步进/后退/键盘/自动/记录/续播/缺资源/沉浸/多视口）。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/gal-shots）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
const shotDir = process.env.SHOT_DIR || '/tmp/gal-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-gal-'))
const dataDir = path.join(work, 'data')
const mediaDir = path.join(dataDir, 'gal', 'UViewer演示')   // 一个目录 = 一个 Gal 媒体
await mkdir(mediaDir, { recursive: true })
await buildGalFixture(mediaDir, { exampleScript: process.env.GAL_EXAMPLE || '' })
const DPATH = process.env.GAL_EXAMPLE ? 'character/1010/adultr/10100204.txt' : 'character/1010/adultr/10100204.txt'
const sec = (rel) => `s:${rel}`
const port = 8102
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用（上次测试没清理干净？）`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.addInitScript(() => { if (!localStorage.getItem('copymanga.immersivePref')) localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })) })
const page = await context.newPage()
const errors = []
const dialogs = []
const resourceRequests = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss().catch(() => {}) })
page.on('request', (r) => { if (/\/resource\?path=/.test(r.url())) resourceRequests.push(decodeURIComponent(r.url().split('path=')[1])) })

// ---- 1. 导入页：方案 / 控件 / 导入 ----
await page.goto(`${base}/`)
await page.click('[data-view="media-import-view"]')
await page.waitForSelector('#media-import-profile')
const profiles = await page.$$eval('#media-import-profile option', (os) => os.map((o) => [o.value, o.textContent]))
check('导入方案里有「Gal 导入」', profiles.some(([v, t]) => v === 'gal-import' && /Gal/.test(t)), JSON.stringify(profiles))
await page.selectOption('#media-import-profile', 'gal-import')
await page.waitForTimeout(300)
const ui = await page.evaluate(() => ({
  type: document.querySelector('#media-import-type').value,
  typeOptions: [...document.querySelectorAll('#media-import-type option')].map((o) => o.value),
  sourceDisabled: document.querySelector('#media-import-source-path')?.disabled,
  filesDisabled: document.querySelector('#media-import-files')?.disabled,
  config: document.querySelector('#media-import-profile-config').value,
  submit: document.querySelector('#media-import-submit').textContent,
}))
check('选方案后媒体类型自动变 gal', ui.type === 'gal' && ui.typeOptions.includes('gal'), JSON.stringify(ui))
check('不用选文件、不用填来源路径', ui.sourceDisabled === true && ui.filesDisabled === true, JSON.stringify(ui))
check('JSON 配置可见：含 rootDir / adapters / defaultMetadataActions（默认勾的元数据脚本）', /"rootDir"/.test(ui.config) && /"adapters"/.test(ui.config) && /uviewer-csv/.test(ui.config) && /"defaultMetadataActions": \[\s*"gal-layout"/.test(ui.config), ui.config)
const ticks = await page.$$eval('input[name="media-import-tag-script"]', (is) => is.filter((i) => i.checked).map((i) => i.value))
check('导入页：元数据脚本 gal-layout 默认勾上（来自方案的 defaultMetadataActions），别的脚本不乱勾', ticks.join() === 'gal-layout', JSON.stringify(ticks))
// 把 rootDir 指到要导入的目录（默认值是 /data/gal，测试机上不存在）
await page.fill('#media-import-profile-config', JSON.stringify({ rootDir: mediaDir, maxDepth: 6, scriptExtensions: ['txt', 'csv'], adapters: ['uviewer-csv'] }))
await page.click('#media-import-submit')
await page.waitForFunction(() => document.querySelector('#library-view:not(.hidden)') || true, null, { timeout: 15000 })
await page.waitForTimeout(2500)
check('导入完成有汇总提示（一个目录 = 新建 1 个媒体；导入不扫描，提示会自动跑元数据脚本）', dialogs.some((d) => /Gal 导入完成/.test(d) && /新建 1/.test(d) && /gal-layout/.test(d)), JSON.stringify(dialogs))
// 导入后自动排了元数据脚本 gal-layout：它把 config 调对、挑封面、数脚本。等它跑完（config.script 里有版本）
for (let i = 0; i < 80; i++) {
  const it = (await (await fetch(`${base}/api/library/items?type=gal&page=1&limit=5`)).json()).items?.[0]
  const full = it ? await (await fetch(`${base}/api/library/items/gal/${it.itemId}`)).json() : null
  if (full?.config?.script?.version) break
  await sleep(500)
}
errors.length = 0

// ---- 2. 媒体库 ----
const apiItems = await (await fetch(`${base}/api/library/items?type=gal&page=1&limit=50`)).json()
for (let i = 0; i < 40 && apiItems.index?.status !== 'ready'; i++) await sleep(300)
await page.goto(`${base}/`)
await page.click('[data-view="library-view"]')
await page.waitForSelector('#library-items .card')
await page.selectOption('#library-type', 'gal').catch(() => {})
await page.waitForTimeout(1200)
const cards = await page.$$eval('#library-items .library-card', (cs) => cs.map((c) => ({ title: c.querySelector('.card-title')?.textContent, typePill: c.querySelector('.library-type-pill')?.textContent, img: c.querySelector('img.cover')?.getAttribute('src') || '', ph: Boolean(c.querySelector('.cover.placeholder')), natural: c.querySelector('img.cover')?.naturalWidth || 0 })))
check('类型筛选里有 Gal，列表只有 1 个媒体（整个目录）', cards.length === 1, JSON.stringify(cards.map((c) => c.title)))
const cardA = cards[0]
check('卡片：标题是目录名、类型胶囊「Gal」、封面图加载成功（第一张背景图当封面）', cardA?.title === 'UViewer演示' && cardA.typePill === 'Gal' && cardA.natural > 0 && /thumbnail\/script\/cover$/.test(cardA.img), JSON.stringify(cardA))
await page.screenshot({ path: path.join(shotDir, 'library.png') })
const M = (await (await fetch(`${base}/api/library/items?type=gal&page=1&limit=50`)).json()).items[0]
const link = (nodeId = '') => `${base}/#/media/gal/${M.itemId}/main${nodeId ? `?section=${encodeURIComponent(nodeId)}` : ''}`
const t = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null)
const textNow = () => page.$eval('.gal-text', (e) => e.textContent)
const nameNow = () => page.$eval('.gal-name', (e) => (e.hidden ? '' : e.textContent))
const countNow = () => t('.gal-count')
const crumbs = () => page.$$eval('.gal-browse-crumb', (es) => es.map((e) => e.textContent).join('>'))
const rowTitles = () => page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))
const hashSection = () => page.evaluate(() => decodeURIComponent((location.hash.split('section=')[1] || '').split('&')[0]))
const imagesLoaded = () => page.$$eval('.gal-browse img', (is) => is.length && is.every((i) => i.complete && i.naturalWidth > 0))

// ---- 3. 打开媒体：详情里只有 1 个单元 → 进浏览层（首页），不是直接进播放器 ----
await page.locator('#library-items .library-card', { hasText: 'UViewer演示' }).first().click()
await page.waitForSelector('.gal-browse')   // 只有 1 个单元：点卡片直接进它（和别的单卷类型一样）
const apiUnits = await (await fetch(`${base}/api/library/items/gal/${M.itemId}/units`)).json()
check('详情：只有 1 个单元（main），记着脚本数', apiUnits.length === 1 && apiUnits[0].unitId === 'main' && apiUnits[0].stepCount >= 50, JSON.stringify(apiUnits))
check('点卡片：进的是首页（浏览层），没有播放器', !(await page.$('.gal-player')) && (await crumbs()) === '首页' && (await page.$$('.gal-card')).length === 9, await crumbs())
check('首页：9 张卡片（真实目录树，名字用中文标签）；上一级按钮禁用（位置不变）；沉浸按钮可用（浏览层也有沉浸）', JSON.stringify(await rowTitles()) === JSON.stringify(['纪念馆', '角色', '活动', '扭蛋', '回忆', '其他', '任务', '房间', '教程']) && await page.$eval('.gal-browse-up', (b) => b.disabled) && !(await page.$eval('#media-immersive', (b) => b.disabled)), JSON.stringify(await rowTitles()))
await page.screenshot({ path: path.join(shotDir, 'browse-home.png') })
check('首页：URL 里没有 section（首页就是单元的默认节点）', (await hashSection()) === '', await hashSection())

await page.click('.gal-card[data-node="d:cabin"]')
await page.waitForSelector('.gal-card[data-node="d:cabin/adultr"]')
check('点「纪念馆」：只有一个子目录「成人向」（目录一层层点进去）；面包屑；上一级出现；URL 带节点', JSON.stringify(await rowTitles()) === JSON.stringify(['成人向']) && (await crumbs()) === '首页>纪念馆' && !(await page.$eval('.gal-browse-up', (b) => b.disabled)) && (await hashSection()) === 'd:cabin', JSON.stringify([await rowTitles(), await crumbs(), await hashSection()]))
await page.click('.gal-card[data-node="d:cabin/adultr"]')
await page.waitForSelector('.gal-card.is-script')
await page.waitForFunction(() => [...document.querySelectorAll('.gal-browse img')].every((i) => i.complete), null, { timeout: 5000 })
check('点「成人向」：列表 2 项（notes.txt 不是脚本）；每行有缩略图（UViewer 自己生成的 / 脚本里的背景图）且加载成功；摘要是第一句台词', JSON.stringify(await rowTitles()) === JSON.stringify(['600130', '600230']) && (await crumbs()) === '首页>纪念馆>成人向' && (await hashSection()) === 'd:cabin/adultr' && /早上好/.test(await page.$eval('.gal-card[data-title="600130"]', (e) => e.textContent)), JSON.stringify([await rowTitles(), await crumbs(), await hashSection()]))
check('缩略图加载成功（含 ~/user_data/thumbnails 里的 webp）', await imagesLoaded())
await page.screenshot({ path: path.join(shotDir, 'browse-cabin.png') })
await page.click('.gal-browse-up'); await page.waitForSelector('.gal-card[data-node="d:cabin/adultr"]')
await page.click('.gal-browse-up'); await page.waitForSelector('.gal-card[data-node="d:character"]')
check('点两次「↑ 上一级」：回到首页', (await crumbs()) === '首页' && (await page.$$('.gal-card')).length === 9)
// 文本版本
const sets = await page.$$eval('.gal-browse-sets option', (os) => os.map((o) => [o.textContent, o.selected]))
check('首页「更多」里有「文本版本」下拉：text（默认选中）+ 另一套', JSON.stringify(sets) === JSON.stringify([['text', true], ['text---日文20251102', false]]), JSON.stringify(sets))
await sleep(300)
check('首页载入后：「更多」菜单是收起的、搜索框没有被自动聚焦（根节点 id 是空串，不能和「没有待办」混淆）', await page.$eval('.gal-browse-more-menu', (m) => m.hidden) && !(await page.evaluate(() => document.activeElement?.classList.contains('gal-browse-search'))))
await page.click('.gal-browse-more-btn')   // 文本版本下拉在「更多」里
await page.waitForSelector('.gal-browse-more-menu:not([hidden])')
await page.selectOption('.gal-browse-sets', { label: 'text---日文20251102' })
await page.waitForFunction(() => document.querySelectorAll('.gal-card').length === 2)
check('切到另一套文本：看到它自己的目录（2 个），面包屑标出版本，URL 带版本前缀', JSON.stringify(await rowTitles()) === JSON.stringify(['纪念馆', '角色']) && /text---日文/.test(await crumbs()) && (await hashSection()).startsWith('@text---日文20251102|'), JSON.stringify([await rowTitles(), await crumbs(), await hashSection()]))
await sleep(300)
await page.click('.gal-browse-more-btn')
await page.waitForSelector('.gal-browse-more-menu:not([hidden])')
await page.selectOption('.gal-browse-sets', { label: 'text' })
await page.waitForFunction(() => document.querySelectorAll('.gal-card').length === 9)
await page.click('.gal-card[data-node="d:character"]')
await page.waitForSelector('.gal-card[data-node="d:character/1003"]')
await page.waitForFunction(() => [...document.querySelectorAll('.gal-browse img')].every((i) => i.complete), null, { timeout: 5000 })
check('点「角色」：3 个角色（名称文件里的显示名；没名称的就是编号），卡蒂娅的头像加载成功', JSON.stringify(await rowTitles()) === JSON.stringify(['卡蒂娅', '小夜', '2001']) && (await page.$eval('.gal-card[data-node="d:character/1003"] img', (i) => i.naturalWidth)) > 0, JSON.stringify(await rowTitles()))
await page.screenshot({ path: path.join(shotDir, 'browse-characters.png') })
await page.click('.gal-card[data-node="d:character/1003"]')
await page.waitForSelector('.gal-card.is-script')
check('卡蒂娅：adultr 和 extra 合并成一个列表（5 张脚本卡片，自然序混排）；右上角来源标签 adu / ext；面包屑里没有 adultr', JSON.stringify(await rowTitles()) === JSON.stringify(['100300', '10030302', '10030304', '10030305_old', '10030305']) && JSON.stringify(await page.$$eval('.gal-card-badge', (es) => es.map((e) => e.textContent))) === JSON.stringify(['adu', 'ext', 'adu', 'adu', 'adu']) && (await crumbs()) === '首页>角色>卡蒂娅', JSON.stringify([await rowTitles(), await crumbs()]))
check('列表是卡片（不是长条）：卡片网格、每张有缩略图区域、标题和摘要', (await page.$$('.gal-card.is-script .gal-card-thumb')).length === 5 && !(await page.$('.gal-row')) && await page.$eval('.gal-browse-cards', (e) => getComputedStyle(e).display === 'grid'))
const cardBox = await page.evaluate(() => { const c = [...document.querySelectorAll('.gal-card.is-script')].map((e) => e.getBoundingClientRect()); return { sameRow: c.filter((r) => Math.abs(r.top - c[0].top) < 2).length, w: Math.round(c[0].width), h: Math.round(c[0].height) } })
check('卡片多列排布（1280 宽一行放得下好几张），宽高合理', cardBox.sameRow >= 3 && cardBox.w >= 150 && cardBox.w <= 260 && cardBox.h > 100, JSON.stringify(cardBox))
await page.screenshot({ path: path.join(shotDir, 'browse-groups.png') })
await page.click('.gal-card[data-title="10030304"]')
await page.waitForSelector('.gal-player .gal-stage')
check('点脚本：进播放页；标题；URL 带真实路径；浏览层已移除；沉浸按钮可用；顶部「下一章/上一章」= 合并列表里相邻的脚本（跨来源）', (await page.$eval('#media-reader-title', (e) => e.textContent)) === '10030304' && (await hashSection()) === 's:character/1003/adultr/10030304.txt' && !(await page.$('.gal-browse')) && !(await page.$eval('#media-immersive', (b) => b.disabled)) && !(await page.$eval('#media-reader-next', (b) => b.disabled)) && !(await page.$eval('#media-reader-prev', (b) => b.disabled)))
await page.click('#media-reader-prev')
await page.waitForFunction(() => document.querySelector('#media-reader-title')?.textContent === '10030302')
check('「上一章」去的是 extra 里的 10030302（合并后同一个列表里的上一个）', (await hashSection()) === 's:character/1003/extra/10030302.txt')
await page.click('.gal-up')
await page.waitForSelector('.gal-card.is-script')
check('播放页点「↑ 列表」：回到合并后的卡蒂娅列表', (await crumbs()) === '首页>角色>卡蒂娅' && !(await page.$('.gal-player')), await crumbs())
await page.reload()
await page.waitForSelector('.gal-card.is-script')
check('刷新：停在同一个节点，不会跳回首页', (await crumbs()) === '首页>角色>卡蒂娅' && (await hashSection()) === 'd:character/1003', JSON.stringify([await crumbs(), await hashSection()]))
// 列表和播放器的底部栏：位置几乎统一（数据少时列表的栏也贴底；「↑ 上一级」和「↑ 列表」在差不多的位置）
{
  await page.goto(link('d:cabin/adultr')); await page.waitForSelector('.gal-browse[data-node="d:cabin/adultr"]'); await sleep(500)
  const rectOf = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), b: Math.round(r.bottom) } })
  const frame = () => page.$eval('#media-reader-content', (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) } })
  const listUp = await rectOf('.gal-browse-up')
  const listBar = await rectOf('.gal-browse-bar')
  const f1 = await frame()
  check('数据少（2 个脚本）时列表底部栏也贴着阅读区最下沿（不是跟在卡片后面）', f1.bottom - listBar.b <= 12 && listBar.y > f1.top + 200, JSON.stringify({ f1, listBar }))
  await page.click('.gal-card.is-script >> nth=0'); await page.waitForSelector('.gal-player .gal-stage'); await sleep(700)
  const playUp = await rectOf('.gal-up')
  const playBar = await rectOf('.gal-bar-wrap')
  check('播放页的工具栏在舞台下面、也贴着阅读区最下沿；舞台没有被挤出阅读区', (await frame()).bottom - playBar.b <= 12 && await page.$eval('.gal-stage', (s) => s.getBoundingClientRect().bottom <= document.querySelector('.gal-bar-wrap').getBoundingClientRect().top + 1))
  check('列表的「↑ 上一级」和播放页的「↑ 列表」位置几乎统一（水平 / 垂直都差不到 16px）', Math.abs(listUp.x - playUp.x) <= 16 && Math.abs(listUp.y - playUp.y) <= 16, JSON.stringify({ listUp, playUp }))
}
// 房间：翻页
await page.goto(link('d:room')); await page.waitForSelector('.gal-browse[data-node="d:room"]')
const PG = '.gal-browse-pager'
const pagerState = () => page.evaluate((sel) => ({ page: document.querySelector(`${sel} .gal-pager-jump`)?.value, info: document.querySelector(`${sel} .gal-pager-info`)?.textContent, range: document.querySelector('.gal-browse-range')?.textContent || '', prevOff: document.querySelector(`${sel} .gal-pager-btn[title="上一页"]`)?.disabled, nextOff: document.querySelector(`${sel} .gal-pager-btn[title="下一页"]`)?.disabled }), PG)
const pager1 = await pagerState()
check('房间：每页 25，页码 1 / 2 页，共 31 项，上一页禁用', (await page.$$('.gal-card')).length === 25 && pager1.page === '1' && /2 页/.test(pager1.info) && /31/.test(pager1.range) && pager1.prevOff, JSON.stringify(pager1))
await page.click(`${PG} .gal-pager-btn[title="下一页"]`)
await page.waitForFunction(() => document.querySelector('.gal-browse-pager .gal-pager-jump')?.value === '2')
const pager2 = await pagerState()
check('点「下一页」：第 2 页 6 项；URL 带页码；下一页禁用', (await page.$$('.gal-card')).length === 6 && (await hashSection()) === 'd:room#2' && pager2.nextOff, await hashSection())
await page.screenshot({ path: path.join(shotDir, 'browse-room2.png') })
await page.click('.gal-card[data-title="100113027"]')
await page.waitForSelector('.gal-player .gal-stage')
await page.click('.gal-up')
await page.waitForSelector('.gal-card.is-script')
check('从第 2 页点进脚本再「列表」：回到第 2 页（不是第 1 页）', (await hashSection()) === 'd:room#2' && (await pagerState()).page === '2', await hashSection())
await page.goto(link('d:room')); await page.waitForSelector('.gal-browse[data-node="d:room"]')
check('缺资源的脚本在列表里是占位缩略图；其它有图', await page.$eval('.gal-card[data-title="100101027"]  .gal-card-thumb', (e) => e.classList.contains('empty')) && !(await page.$eval('.gal-card[data-title="100113001"]  .gal-card-thumb', (e) => e.classList.contains('empty'))))
// 头部返回：离开媒体回到媒体库
await page.click('#media-reader-back')
await page.waitForSelector('#library-items .library-card')
check('头部「返回」：离开这个媒体回到媒体库', await page.$eval('#library-view', (v) => v.classList.contains('active')))
errors.length = 0

// ---- 3b. 播放：从浏览层点进纪念馆的 600130 ----
await page.goto(link('')); await page.waitForSelector('.gal-browse[data-node=""]')
await page.click('.gal-card[data-node="d:cabin"]'); await page.waitForSelector('.gal-card[data-node="d:cabin/adultr"]')
await page.click('.gal-card[data-node="d:cabin/adultr"]'); await page.waitForSelector('.gal-card.is-script')
await page.click('.gal-card[data-title="600130"]')
await page.waitForSelector('.gal-player .gal-stage')
await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('早上好'), null, { timeout: 5000 })
check('第 1 步：说话人 + 台词（<outline> 标记没有当文字显示）', (await nameNow()) === '小夜' && (await textNow()) === '「早上好，今天也是个好天气呢。」' && (await countNow()) === '1 / 6', `${await nameNow()} | ${await textNow()} | ${await countNow()}`)
const outlineStyle = await page.$eval('.gal-text span', (e) => getComputedStyle(e).webkitTextStrokeWidth)
check('outline 描边样式生效', parseFloat(outlineStyle) > 0, outlineStyle)
await sleep(900)
const first = await page.evaluate(() => {
  const layers = [...document.querySelectorAll('.gal-bg')]
  const front = layers.find((l) => getComputedStyle(l).opacity === '1')
  return { bg: front?.style.backgroundImage || '', black: getComputedStyle(document.querySelector('.gal-black')).opacity }
})
check('背景图（bg_school）已显示，黑场已淡出', /bg_school/.test(first.bg) && first.black === '0', JSON.stringify(first))
check('请求了背景和 BGM 资源（路径被规范：无前导 /）', resourceRequests.includes('download/bg/bg_school.jpg') && resourceRequests.includes('download/sound/bgm/bgm_a.wav'), JSON.stringify(resourceRequests))
check('立绘指令暂未渲染的提示', /暂未渲染/.test((await t('.gal-note')) || ''), await t('.gal-note'))
const geo = await page.evaluate(() => {
  const s = document.querySelector('.gal-stage').getBoundingClientRect()
  const b = document.querySelector('.gal-box').getBoundingClientRect()
  return { ratio: s.width / s.height, inside: b.left >= s.left && b.right <= s.right && b.top >= s.top && b.bottom <= s.bottom, stageBottom: s.bottom, vh: innerHeight, barBottom: document.querySelector('.gal-bar').getBoundingClientRect().bottom }
})
check('舞台 16:9，台词框在舞台内', Math.abs(geo.ratio - 16 / 9) < 0.02 && geo.inside, JSON.stringify(geo))
await page.screenshot({ path: path.join(shotDir, 'player-step1.png') })

// 点击舞台 → 下一步
await page.click('.gal-stage')
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '2 / 6')
const step2 = await page.evaluate(() => ({ text: document.querySelector('.gal-text').textContent, colored: [...document.querySelectorAll('.gal-text span')].some((s) => s.style.color === 'rgb(255, 179, 71)'), bold: [...document.querySelectorAll('.gal-text span')].some((s) => s.style.fontWeight === '700'), italic: [...document.querySelectorAll('.gal-text span')].some((s) => s.style.fontStyle === 'italic') }))
check('第 2 步：颜色/粗体/斜体片段；半角逗号保留；\\n 换行', step2.colored && step2.bold && step2.italic && step2.text.includes('，还有半角逗号, 和第二行\n换行了。'), JSON.stringify(step2))
await sleep(300)
check('播放了音效（se_1.wav）', resourceRequests.includes('download/sound/se/se_1.wav'), JSON.stringify(resourceRequests))
// 空格 / 方向键 / Backspace
await page.keyboard.press('Space')
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '3 / 6')
await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('夜幕降临'), null, { timeout: 4000 })   // 先等背景渐变 0.8s，台词在其后
const s3 = await page.evaluate(() => ({ text: document.querySelector('.gal-text').textContent, who: document.querySelector('.gal-name').textContent, html: document.querySelector('.gal-text').innerHTML }))
check('第 3 步：危险标记被丢弃、只剩文字，没有生成 script/img 元素（无 XSS）', s3.text.includes('alert(1)') && !/<script|<img/i.test(s3.html) && (await page.evaluate(() => window.__xss === undefined)) && !dialogs.some((d) => d === '1' || d === '2'), JSON.stringify(s3))
check('播放了语音（角色目录下的 fav100300_01_01.mp3）', resourceRequests.includes('download/character/100300/adv/sound/fav100300_01_01.mp3'))
await page.keyboard.press('ArrowLeft')
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '2 / 6')
check('← 后退：回到第 2 步，台词一致，不重放音效', (await textNow()).includes('橙色的字') && resourceRequests.filter((r) => r.endsWith('se_1.wav')).length === 1)
await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '3 / 6')
// 第 4 步含 wait + 黑场；点击跳过动画
await page.keyboard.press('Enter')
await sleep(120)
const mid = await page.evaluate(() => ({ count: document.querySelector('.gal-count').textContent, running: true }))
await page.keyboard.press('Enter')   // 动画中再点：直接完成这一步
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent.startsWith('4 / 6') && document.querySelector('.gal-text')?.textContent.includes('纯色背景'), null, { timeout: 3000 })
const s4 = await page.evaluate(() => ({ black: getComputedStyle(document.querySelector('.gal-black')).opacity, bg: [...document.querySelectorAll('.gal-bg')].map((l) => [getComputedStyle(l).opacity, l.style.backgroundColor]) }))
check('第 4 步（wait + 变黑 + 换纯色 + 出黑场）：点击能跳过动画，最终状态正确（黑场已退、纯色背景）', parseFloat(s4.black) < 0.01 && s4.bg.some(([o, c]) => o === '1' && c === 'rgb(20, 60, 40)'), JSON.stringify(s4))
check('（动画中点击没有多前进一步）', mid.count === '4 / 6' || mid.count === '3 / 6')
// 后退到第 1 步（instant），再前进验证开头的状态不是残留
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft')
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '1 / 6')
check('连续后退到第 1 步：画面和第一次一样（bg_school，台词是第 1 句）', (await textNow()).includes('早上好') && (await page.evaluate(() => [...document.querySelectorAll('.gal-bg')].some((l) => getComputedStyle(l).opacity === '1' && /bg_school/.test(l.style.backgroundImage)))))
await page.keyboard.press('ArrowLeft')
check('第 1 步再后退：停在第 1 步', (await countNow()) === '1 / 6')
// 记录
await page.keyboard.press('l')
await page.waitForSelector('.gal-log:not([hidden]) .gal-log-row')
check('记录面板（L）：当前步及之前的台词', (await page.$$('.gal-log-row')).length === 1)
await page.keyboard.press('Escape')
// 前进到末尾
for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await sleep(150); await page.keyboard.press('Space'); await sleep(50) }
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '6 / 6', null, { timeout: 15000 })
check('走到末步：下一句按钮禁用，▼ 提示消失', (await page.$eval('.gal-next-btn', (b) => b.disabled)) && (await page.$eval('.gal-next', (e) => e.hidden)))
const endState = await page.evaluate(() => ({ boxHidden: document.querySelector('.gal-box').hidden, text: document.querySelector('.gal-text').textContent }))
check('末步台词（背景被撤掉后）', /最后一句/.test(endState.text), JSON.stringify(endState))
await page.keyboard.press('l')
await page.waitForSelector('.gal-log:not([hidden])')
const logRows = await page.$$eval('.gal-log-row', (rs) => rs.length)
check('记录面板：全部有台词的步', logRows >= 5, String(logRows))
await page.screenshot({ path: path.join(shotDir, 'player-log.png') })
await page.locator('.gal-log-row').first().click()
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '1 / 6')
check('点记录里的一行：跳到那一步，面板收起', await page.$eval('.gal-log', (e) => e.hidden))
// 自动播放
await page.keyboard.press('a')
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '2 / 6', null, { timeout: 8000 })
check('自动播放（A）：不点也会前进', true)
await page.keyboard.press('a')
const frozen = await countNow()
await sleep(2500)
check('再按 A 关闭自动：不再前进', (await countNow()) === frozen)

// ---- 4. 续播：每个脚本各记各的；列表里标出看到哪 ----
await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => /^3 \/ 6/.test(document.querySelector('.gal-count').textContent))
await sleep(1500)   // 等进度保存的防抖
const prog = await (await fetch(`${base}/api/library/items/gal/${M.itemId}/progress`)).json()
check('进度：记在这个脚本的节点上（第 3/6 步 = 40%），「上次看到」指向它', prog.lastSectionId === sec('cabin/adultr/600130.txt') && Math.abs(prog.nodes[sec('cabin/adultr/600130.txt')]?.ratio - 0.4) < 0.01, JSON.stringify(prog))
await page.click('.gal-up')
await page.waitForSelector('.gal-card.is-script')
check('回到列表：ep01 标「看到 40%」，ep02 没有标记', /看到 40%/.test(await page.$eval('.gal-card[data-title="600130"]', (e) => e.textContent)) && !/看到|已看完/.test(await page.$eval('.gal-card[data-title="600230"]', (e) => e.textContent)))
await page.click('.gal-card[data-title="600130"]')
await page.waitForSelector('.gal-player .gal-stage')
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent.length > 0)
const resumed = await countNow()
check('续播：重新点进同一脚本，回到上次的步数', /^3 \/ 6/.test(resumed), `${resumed} progress=${JSON.stringify(prog)}`)
// 在列表里逛不会冲掉「上次看到」
await page.click('.gal-up'); await page.waitForSelector('.gal-card.is-script'); await page.click('.gal-browse-up'); await page.waitForSelector('.gal-card')
await sleep(900)
check('在列表里逛：上次看到的位置不变（「继续」仍落在播放页）', (await (await fetch(`${base}/api/library/items/gal/${M.itemId}/progress`)).json()).lastSectionId === sec('cabin/adultr/600130.txt'))

// ---- 5. 同一级的下一个脚本（头部「下一章」）----
await page.goto(link(sec('cabin/adultr/600130.txt'))); await sleep(500)
await page.waitForSelector('.gal-player .gal-stage')
await page.click('#media-reader-next')
await page.waitForFunction(() => /\/ 2$/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 5000 }).catch(() => {})
check('下一章：切到同一级的下一个脚本 ep02（2 步）', /\/ 2$/.test((await countNow()) || '') && (await hashSection()) === sec('cabin/adultr/600230.txt'), await countNow())
check('最后一个脚本：「下一章」禁用', await page.$eval('#media-reader-next', (b) => b.disabled) && !(await page.$eval('#media-reader-prev', (b) => b.disabled)))

// ---- 6. 缺资源的作品 ----
await page.goto(link(sec('room/100101027.txt'))); await sleep(500)
await page.waitForSelector('.gal-player .gal-stage')
await page.waitForFunction(() => /缺少资源/.test(document.querySelector('.gal-note')?.textContent || ''), null, { timeout: 8000 }).catch(() => {})
check('缺资源：提示「缺少资源 N 个」，播放器不崩', /缺少资源 \d+ 个/.test((await t('.gal-note')) || ''), await t('.gal-note'))
await sleep(600)   // 等第 1 步的渐变做完（动画中按键是「跳过动画」而不是前进）
await page.keyboard.press('Space'); await sleep(300)
check('缺资源：仍能继续下一步（含不存在的视频）', /^2 \/ 2/.test(await countNow()), await countNow())
await page.screenshot({ path: path.join(shotDir, 'player-missing.png') })
// ---- 6b. 长脚本 D（立绘/遮罩/Spine 指令暂未渲染但不影响播放；伪 mp3 实为 wav，浏览器要能解码）----
await page.goto(link(sec(DPATH))); await sleep(500)
await page.waitForSelector('.gal-player .gal-stage')
await page.waitForFunction(() => /^1 \/ \d+/.test(document.querySelector('.gal-count')?.textContent || ''))
await sleep(1500)
const dTotal = Number((await countNow()).split('/')[1])
check('D：步数多（≥20），提示忽略了立绘/特效指令', dTotal >= 20 && /暂未渲染/.test((await t('.gal-note')) || ''), `${await countNow()} ${await t('.gal-note')}`)
check('D：BGM（扩展名 .mp3 的 wav 数据）能被浏览器解码，没有「缺少资源」', !/缺少资源/.test((await t('.gal-note')) || ''), await t('.gal-note'))
for (let i = 0; i < dTotal * 3 && (await countNow()) !== `${dTotal} / ${dTotal}`; i++) { await page.keyboard.press('Space'); await sleep(120) }   // 动画/wait 中按键是「跳过」，所以多按几次
await sleep(800)
check('D：一路点到最后一步', (await countNow()) === `${dTotal} / ${dTotal}`, await countNow())
check('D：没有「缺少资源」（含 se/第二首 BGM）', !/缺少资源/.test((await t('.gal-note')) || ''), await t('.gal-note'))
await page.screenshot({ path: path.join(shotDir, 'player-long.png') })

// ---- 6c. 更多菜单（沉浸 / 全屏）、渲染诊断面板、rawIgnore ----
{
  const vis = (sel) => page.$eval(sel, (e) => !e.hidden && getComputedStyle(e).display !== 'none').catch(() => false)
  check('播放器：沉浸 / 全屏不在工具栏外面，收在「更多」菜单里（默认收起）', !(await vis('.gal-more')) && await page.$eval('.gal-bar .gal-more-btn', (b) => b.textContent.includes('更多')) && !(await page.$('.gal-bar > .gal-imm')) && !(await page.$('.gal-bar > .gal-fs')))
  await page.click('.gal-more-btn')
  check('点「更多」：菜单里有「沉浸」「全屏」', (await vis('.gal-more')) && (await vis('.gal-more .gal-imm')) && (await vis('.gal-more .gal-fs')))
  await page.click('.gal-more .gal-imm'); await sleep(400)
  check('点「沉浸」：进入沉浸，菜单收起，按钮写「退出沉浸」且不高亮', (await page.$eval('#app', (a) => a.classList.contains('stream-immersive'))) && !(await vis('.gal-more')) && (await t('.gal-imm')) === '退出沉浸' && !(await page.$eval('.gal-imm', (b) => b.classList.contains('active'))))
  await page.click('.gal-more-btn'); await page.click('.gal-more .gal-imm'); await sleep(400)
  check('再从菜单点「退出沉浸」：退出', !(await page.$eval('#app', (a) => a.classList.contains('stream-immersive'))) && (await t('.gal-imm')) === '沉浸')
  // 诊断面板：点右下角提示
  check('提示可点击（有样式标记）', await page.$eval('.gal-note', (n) => n.classList.contains('clickable')))
  await page.click('.gal-note')
  check('点提示：展开诊断面板，列出未渲染的指令（指令名、数量、样例）和复制按钮', (await vis('.gal-diag')) && /spriteatlas ×\d+/.test(await t('.gal-diag-text')) && /步 \d+：spriteatlas,/.test(await t('.gal-diag-text')) && await vis('.gal-diag-copy'), (await t('.gal-diag-text')) || '')
  await page.click('.gal-diag-copy'); await sleep(200)
  check('「复制日志」点了不报错（按钮变「已复制」）', (await t('.gal-diag-copy')) === '已复制')
  await page.click('.gal-diag button:has-text("关闭")')
  check('关闭诊断面板', !(await vis('.gal-diag')))
  // rawIgnore：node.rawIgnore 里匹配的指令不计入提示（用请求拦截把 rawIgnore 塞进节点，等价于 config.rawIgnore）
  const ignoreAll = ['.']   // 匹配任意指令名
  await page.route(/\/reader\/[^?]+/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    if (body?.node?.kind === 'player') body.node.rawIgnore = ignoreAll
    await route.fulfill({ response, json: body })
  })
    await page.goto(link(sec('cabin/adultr/600230.txt'))); await sleep(800)
  await page.goto(link(sec(DPATH)))
  await page.waitForSelector('.gal-player .gal-stage'); await page.waitForFunction(() => /^1 \/ \d+/.test(document.querySelector('.gal-count')?.textContent || '')); await sleep(800)
  const noteAfter = (await t('.gal-note')) || ''
  const rawLeft = Number((noteAfter.match(/(\d+) 条指令暂未渲染/) || [])[1] || 0)
  await page.click('.gal-note').catch(() => {})
  const diagAfter = (await t('.gal-diag-text')) || ''
  check('rawIgnore 全部命中：不再提示「N 条暂未渲染」', !/暂未渲染/.test(noteAfter) && rawLeft === 0, `${noteAfter} | ${diagAfter.slice(0, 200)}`)
  await page.unroute(/\/reader\/[^?]+/)
}

// ---- 6d. 继续下一章 ----
{
  const vis = (sel) => page.$eval(sel, (e) => !e.hidden && getComputedStyle(e).display !== 'none').catch(() => false)
  await page.goto(link(sec('cabin/adultr/600130.txt')))
  await page.waitForSelector('.gal-player .gal-stage'); await sleep(800)
  check('还没看到最后一步：没有「继续下一章」', !(await vis('.gal-continue')))
  const total = Number((await countNow()).split('/')[1])
  for (let i = 0; i < total * 3 && (await countNow()) !== `${total} / ${total}`; i++) { await page.keyboard.press('Space'); await sleep(120) }
  await sleep(500)
  check('看到最后一步且有下一章：出现「继续下一章 ▶」（不进沉浸也有）', await vis('.gal-continue'), `${await countNow()} chNextDisabled=${await page.$eval('.gal-ch-next', (b) => b.disabled)} hash=${await hashSection()}`)
  await page.click('.gal-continue')
  await page.waitForFunction(() => decodeURIComponent(location.hash).includes('600230'), null, { timeout: 6000 })
  await page.waitForSelector('.gal-player .gal-stage'); await sleep(500)
  check('点「继续下一章」：进入下一个脚本；它是最后一个所以不再显示按钮', (await hashSection()).includes('600230') && !(await vis('.gal-continue')))
}

// ---- 6e. 列表：筛选 / 排序 / 每页条数 / 跳页 / 返回时保留 ----
{
  const cards = () => page.$$eval('.gal-card', (list) => list.map((c) => c.dataset.title))
  await page.goto(link('d:room'))
  await page.waitForSelector('.gal-browse[data-node="d:room"]')
  check('列表：搜索 / 排序 / 每页条数 收在「更多」菜单里（默认收起）', !!(await page.$('.gal-browse-more-menu .gal-browse-search')) && !!(await page.$('.gal-browse-more-menu .gal-browse-sort')) && !!(await page.$('.gal-browse-more-menu .gal-browse-size')) && await page.$eval('.gal-browse-more-menu', (m) => m.hidden))
  check('翻页条只有一个，在底部固定条里；固定条在卡片列表之后（底部）', (await page.$$('.gal-browse-pager')).length === 1 && await page.$eval('.gal-browse-bar .gal-browse-pager', () => true).catch(() => false) && await page.evaluate(() => { const bar = document.querySelector('.gal-browse-bar').getBoundingClientRect(); const card = document.querySelector('.gal-card').getBoundingClientRect(); return bar.top > card.top }))
  const barGap = () => page.evaluate(() => { const c = document.querySelector('#media-reader-content').getBoundingClientRect(); const s = document.querySelector('.gal-browse-bar').getBoundingClientRect(); return { scrolled: document.querySelector('#media-reader-content').scrollTop, gap: Math.round(c.bottom - s.bottom), h: Math.round(s.height) } })
  const at0 = await barGap()
  await page.evaluate(() => { document.querySelector('#media-reader-content').scrollTop = 300 })
  await sleep(250)
  const stick = await barGap()
  check('不管往上还是往下滚：位置 + 上一级 + 翻页 + 更多 的固定条一直贴在底部（同一个位置）', stick.scrolled > 100 && Math.abs(stick.gap - at0.gap) <= 2 && stick.gap <= 18, JSON.stringify([at0, stick]))
  await page.evaluate(() => { document.querySelector('#media-reader-content').scrollTop = 0 })
  const pos = async () => page.evaluate(() => Object.fromEntries(['.gal-browse-up', '.gal-pager-jump', '.gal-browse-more-btn'].map((sel) => [sel, Math.round(document.querySelector(sel).getBoundingClientRect().left)])))
  const posList = await pos()
  check('按钮顺序：↑ 上一级（最左）→ 翻页 → 更多，和播放页底栏同一个顺序', posList['.gal-browse-up'] < posList['.gal-pager-jump'] && posList['.gal-pager-jump'] < posList['.gal-browse-more-btn'], JSON.stringify(posList))
  await page.click('.gal-browse-more-btn')
  await page.fill('.gal-browse-search', '10011')
  await page.waitForFunction(() => decodeURIComponent(location.hash).includes('q=10011'), null, { timeout: 5000 })
  await page.waitForSelector('.gal-browse-range')
  const filtered = await cards()
  check('搜索「10011」：只剩匹配的卡片，范围提示带「筛选…N / 总数」，节点 id 带 q', filtered.length > 0 && filtered.length < 31 && filtered.every((n) => n.includes('10011')) && /筛选「10011」/.test(await t('.gal-browse-range')) && /\/ 31/.test(await t('.gal-browse-range')), `${filtered.length} ${await t('.gal-browse-range')}`)
  check('搜索后焦点回到搜索框，可以接着输入', await page.evaluate(() => document.activeElement?.classList.contains('gal-browse-search')))
  await page.selectOption('.gal-browse-sort', 'name_desc')
  await page.waitForFunction(() => decodeURIComponent(location.hash).includes('s=name_desc'))
  await page.waitForSelector('.gal-card')
  const desc = await cards()
  const sortedDesc = [...desc].sort((a, b) => b.localeCompare(a, 'zh-Hans-CN', { numeric: true }))
  check('排序「名称 ↓」：卡片按名称倒序', J(desc) === J(sortedDesc), J(desc))
  await page.click('.gal-card.is-script >> nth=0')
  await page.waitForSelector('.gal-player .gal-stage')
  await page.click('.gal-up')
  await page.waitForSelector('.gal-browse-bar')
  const back = await hashSection()
  check('从筛选后的列表点进脚本再「列表」：筛选 / 排序都还在（不是回到默认第 1 页）', /q=10011/.test(back) && /s=name_desc/.test(back) && (await page.$eval('.gal-browse-search', (i) => i.value)) === '10011', back)
  await page.click('.gal-browse-more-btn')
  await page.click('.gal-browse-more-menu button:has-text("清除筛选")')
  await page.waitForFunction(() => !decodeURIComponent(location.hash).includes('q='))
  await page.waitForSelector('.gal-card')
  await page.selectOption('.gal-browse-size', '50')
  await page.waitForFunction(() => decodeURIComponent(location.hash).includes('n=50'))
  await page.waitForSelector('.gal-card')
  check('每页 50：31 项一页放得下；翻页条还在原位但全部禁用（位置不跳）', (await page.$$('.gal-card')).length === 31 && await page.$$eval('.gal-browse-pager button, .gal-browse-pager input', (els) => els.length > 0 && els.every((e) => e.disabled)))
  await page.selectOption('.gal-browse-size', '25')
  await page.waitForFunction(() => /\|/.test(decodeURIComponent(location.hash).split('section=')[1] || '') || !decodeURIComponent(location.hash).includes('n=50'))
  await page.waitForFunction(() => !document.querySelector('.gal-pager-jump')?.disabled)
  await page.fill('.gal-browse-pager .gal-pager-jump', '2'); await page.press('.gal-browse-pager .gal-pager-jump', 'Enter')
  await page.waitForFunction(() => document.querySelector('.gal-pager-jump')?.value === '2')
  check('跳页输入框：输入 2 回车到第 2 页', (await page.$$('.gal-card')).length > 0 && /#2$/.test(await hashSection()), await hashSection())
  await page.click('.gal-browse-pager .gal-pager-btn[title="第一页"]')
  await page.waitForFunction(() => document.querySelector('.gal-pager-jump')?.value === '1')
  await page.fill('.gal-browse-pager .gal-pager-jump', '2'); await page.click('.gal-browse-pager .gal-pager-go')
  await page.waitForFunction(() => document.querySelector('.gal-pager-jump')?.value === '2')
  check('页码输入框旁的「跳转」小按钮：点一下跳到输入的页', /#2$/.test(await hashSection()), await hashSection())
  await page.click('.gal-browse-pager .gal-pager-btn[title="第一页"]')
  await page.waitForFunction(() => document.querySelector('.gal-pager-jump')?.value === '1')
  check('「«」回第一页', (await page.$$('.gal-card')).length === 25)
}
check('没有页面错误', errors.length === 0, errors.join(' | '))

// ---- 6c. 新功能：沉浸 / 工具栏在文本框底部 / 文本框透明度 / 自动播放等语音 ----
{
  const EP1 = sec('cabin/adultr/600130.txt')
  const resetNodes = async (...nodes) => { for (const n of nodes) await fetch(`${base}/api/library/items/gal/${M.itemId}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId: 'main', sectionId: n, scrollRatio: 0, choices: {} }) }) }
  const resetA = () => resetNodes(EP1, sec('cabin/adultr/600230.txt'))
  await resetA()
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // 记录语音的开始/播完时间，和台词计数器变化的时间，用来量「语音播完后等 N 秒」
  await ctx2.addInitScript(() => {
    window.__t = { voiceEnd: [], count: [] }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...args) {
      if (/fav100300_01_01/i.test(this.src || '') && !this.__hooked) { this.__hooked = true; this.addEventListener('ended', () => window.__t.voiceEnd.push(performance.now())) }
      return play.apply(this, args)
    }
    new MutationObserver(() => { const c = document.querySelector('.gal-count'); if (c && c.textContent !== window.__t.last) { window.__t.last = c.textContent; window.__t.count.push([c.textContent, performance.now()]) } }).observe(document, { childList: true, subtree: true, characterData: true })
  })
  const pg = await ctx2.newPage()
  const errs2 = []
  pg.on('pageerror', (e) => errs2.push(e.message))
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  const cnt = () => pg.$eval('.gal-count', (e) => e.textContent).catch(() => '')
  const press = async (key, n = 1) => { for (let i = 0; i < n; i++) { await pg.keyboard.press(key); await sleep(220) } }
  const goStep = async (n, total) => { for (let i = 0; i < 40 && (await cnt()) !== `${n} / ${total}`; i++) { await pg.keyboard.press('Space'); await sleep(260) } }
  const immState = () => pg.evaluate(() => ({
    app: document.querySelector('#app').classList.contains('stream-immersive'),
    view: document.querySelector('#media-viewer-view').classList.contains('stream-page-fullscreen'),
    head: getComputedStyle(document.querySelector('#media-viewer-view .chapter-head')).display,
    tabsY: Math.round(document.querySelector('#app .tabs').getBoundingClientRect().bottom),
    pref: JSON.parse(localStorage.getItem('copymanga.immersivePref') || '{}').gal,
    btn: document.querySelector('.gal-imm')?.textContent,
  }))

  // ---- 沉浸：默认开（和别的类型一致），顶栏/头部收起 ----
  await pg.goto(link(EP1))
  await pg.waitForSelector('.gal-stage')
  await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('早上好'), null, { timeout: 8000 })
  let st = await immState()
  check('沉浸：没存过偏好时默认进沉浸（头部和顶栏收起），按钮变「退出沉浸」', st.app && st.view && st.head === 'none' && st.tabsY <= 0 && st.btn === '退出沉浸', JSON.stringify(st))
  const imm1 = await pg.evaluate(() => { const s = document.querySelector('.gal-stage').getBoundingClientRect(); return { top: s.top, bottom: s.bottom, left: s.left, right: s.right, vw: innerWidth, vh: innerHeight, ratio: s.width / s.height } })
  check('沉浸：舞台 16:9、宽或高有一边贴满视口（16:9 放进别的比例的窗口，另一边留黑边）、没超出', Math.abs(imm1.ratio - 16 / 9) < 0.03 && Math.max((imm1.right - imm1.left) / imm1.vw, (imm1.bottom - imm1.top) / imm1.vh) >= 0.99 && imm1.bottom <= imm1.vh + 1 && imm1.top >= -1 && imm1.left >= -1 && imm1.right <= imm1.vw + 1, JSON.stringify(imm1))
  check('沉浸：「上话/下话/返回」按钮出现（头部藏起来了，需要这些）', await pg.$eval('.gal-ch-next', (b) => getComputedStyle(b).display !== 'none') && await pg.$eval('.gal-back', (b) => getComputedStyle(b).display !== 'none'))
  await pg.mouse.move(400, 2); await sleep(400)
  check('沉浸：鼠标贴顶边，顶栏滑出', await pg.$eval('#app', (a) => a.classList.contains('stream-chrome-visible')) && (await immState()).tabsY > 0)
  await pg.mouse.move(400, 400); await sleep(2400)
  check('沉浸：移开后顶栏自动收回', !(await pg.$eval('#app', (a) => a.classList.contains('stream-chrome-visible'))))
  await pg.screenshot({ path: path.join(shotDir, 'immersive.png') })

  // ---- 工具栏在文本框底部、按钮小 ----
  const geo2 = await pg.evaluate(() => {
    const stage = document.querySelector('.gal-stage').getBoundingClientRect()
    const hud = document.querySelector('.gal-hud').getBoundingClientRect()
    const box = document.querySelector('.gal-box').getBoundingClientRect()
    const bar = document.querySelector('.gal-bar').getBoundingClientRect()
    const btns = [...document.querySelectorAll('.gal-bar .gal-btn')].filter((b) => getComputedStyle(b).display !== 'none')
    return { barBelowStage: bar.top >= stage.bottom - 1, sameWidth: Math.abs(bar.left - stage.left) <= 2 && Math.abs(bar.right - stage.right) <= 2, barInHud: bar.top >= box.bottom - 1 && bar.bottom <= hud.bottom + 1 && bar.left >= hud.left - 1 && bar.right <= hud.right + 1, hudInStage: hud.left >= stage.left && hud.right <= stage.right && hud.bottom <= stage.bottom, boxAboveBar: box.bottom <= bar.top + 1, fonts: [...new Set(btns.map((b) => getComputedStyle(b).fontSize))], maxH: Math.max(...btns.map((b) => b.getBoundingClientRect().height)), n: btns.length, barOutside: !!document.querySelector('.gal-player > .gal-bar') }
  })
  check('工具栏在舞台下面（和舞台同宽、不叠在文本框里）、按钮小（13px）', geo2.fonts.length === 1 && geo2.fonts[0] === '13px' && geo2.maxH <= 32 && geo2.barBelowStage && geo2.sameWidth, JSON.stringify(geo2))
  check('按钮是小号的（字号 ≤ 13px，高度 ≤ 28px）', geo2.fonts.every((f) => parseFloat(f) <= 13.01) && geo2.maxH <= 28, JSON.stringify(geo2))
  await pg.screenshot({ path: path.join(shotDir, 'toolbar.png') })

  // 没有台词时（文本框收起）工具栏仍在底部：长脚本 D 的最后一步台词是空的
  await resetNodes(sec(DPATH))
  await pg.goto(link(sec(DPATH)))
  await pg.waitForSelector('.gal-stage')
  await pg.waitForFunction(() => /^1 \/ \d+/.test(document.querySelector('.gal-count')?.textContent || ''))
  const dN = Number((await cnt()).split('/')[1])
  await sleep(1800)
  await goStep(dN, dN); await sleep(1200)
  const emptyBox = await pg.evaluate(() => { const bar = document.querySelector('.gal-bar').getBoundingClientRect(); const st = document.querySelector('.gal-stage').getBoundingClientRect(); return { boxHidden: document.querySelector('.gal-box').hidden, barVisible: bar.width > 0 && bar.height > 0 && bar.top >= st.bottom - 1 } })
  check('没有台词（文本框收起）时，工具栏仍然可见、在舞台下面', emptyBox.boxHidden && emptyBox.barVisible, JSON.stringify(emptyBox))

  // ---- 点工具栏上的按钮不会顺带翻页；设置弹层 ----
  await resetA()
  await pg.goto(link(EP1))
  await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('早上好'), null, { timeout: 8000 })
  await sleep(800)
  const before = await cnt()
  await pg.click('.gal-cfg'); await sleep(250)
  const panel = await pg.evaluate(() => { const p = document.querySelector('.gal-settings').getBoundingClientRect(); const s = document.querySelector('.gal-stage').getBoundingClientRect(); return { hidden: document.querySelector('.gal-settings').hidden, inside: p.left >= s.left - 1 && p.right <= s.right + 1 && p.top >= s.top - 1 && p.bottom <= innerHeight } })
  check('点 ⚙：设置弹层向上打开、压在舞台下半部分里；这一下没有翻页', !panel.hidden && panel.inside && (await cnt()) === before, JSON.stringify([panel, before, await cnt()]))
  const alpha = () => pg.evaluate(() => { const m = getComputedStyle(document.querySelector('.gal-hud')).backgroundColor.match(/[\d.]+/g); return { a: m.length > 3 ? Number(m[3]) : 1, clear: document.querySelector('.gal-player').classList.contains('gal-clear'), val: document.querySelector('.gal-settings .gal-set-row:nth-child(2) input').value, label: document.querySelector('.gal-settings .gal-set-row:nth-child(2) .gal-set-value').textContent } })
  const a0 = await alpha()
  check('文本框透明度：默认 74%（原来写死的值）', Math.abs(a0.a - 0.74) < 0.01 && a0.val === '74' || a0.val === '75' && Math.abs(a0.a - 0.74) < 0.01, JSON.stringify(a0))
  const setRange = (selector, value) => pg.$eval(selector, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
  await setRange('.gal-settings .gal-set-row:nth-child(2) input', 30); await sleep(150)
  const a30 = await alpha()
  check('文本框透明度调到 30%：背景 alpha=0.3，并加了字影保证可读（gal-clear）', Math.abs(a30.a - 0.3) < 0.01 && a30.clear && a30.label === '30%', JSON.stringify(a30))
  await setRange('.gal-settings .gal-set-row:nth-child(2) input', 0); await sleep(150)
  const a00 = await alpha()
  check('调到 0%：完全透明（文字仍在，有字影）', a00.a === 0 && a00.clear && (await pg.$eval('.gal-text', (e) => e.textContent.length)) > 0, JSON.stringify(a00))
  await setRange('.gal-settings .gal-set-row:nth-child(2) input', 100); await sleep(150)
  const a100 = await alpha()
  check('调到 100%：不透明，字影去掉', a100.a === 1 && !a100.clear, JSON.stringify(a100))
  await setRange('.gal-settings .gal-set-row:nth-child(2) input', 50); await sleep(150)
  await pg.screenshot({ path: path.join(shotDir, 'settings.png') })
  check('设置存进浏览器', await pg.evaluate(() => localStorage.getItem('copymanga.gal.boxOpacity')) === '0.5')
  await pg.click('.gal-stage', { position: { x: 200, y: 120 } }); await sleep(300)
  check('设置弹层开着时点舞台：只收弹层，不翻页', await pg.$eval('.gal-settings', (e) => e.hidden) && (await cnt()) === before)
  await pg.reload(); await pg.waitForSelector('.gal-stage'); await sleep(900)
  await pg.click('.gal-cfg')
  const aKept = await alpha()
  check('刷新后透明度还在（50%）', Math.abs(aKept.a - 0.5) < 0.01 && aKept.label === '50%', JSON.stringify(aKept))
  await pg.keyboard.press('Escape'); await sleep(200)
  check('Esc：先收设置弹层（没有退出沉浸）', await pg.$eval('.gal-settings', (e) => e.hidden) && (await immState()).app)

  // ---- 自动播放：语音播完后等 N 秒 ----
  await pg.click('.gal-cfg')   // Esc 把设置弹层收了，改等待时间前先重新打开
  const delayInput = '.gal-settings .gal-set-number'
  const setDelay = async (v) => { await pg.fill(delayInput, String(v)); await pg.dispatchEvent(delayInput, 'change'); await sleep(100) }
  check('自动等待：默认 1 秒', (await pg.$eval(delayInput, (e) => e.value)) === '1')
  await setDelay(-5); check('自动等待：负数收回到 0', (await pg.$eval(delayInput, (e) => e.value)) === '0')
  await setDelay(99); check('自动等待：超过上限收回到 30', (await pg.$eval(delayInput, (e) => e.value)) === '30')
  await setDelay(2.5)
  check('自动等待存进浏览器', await pg.evaluate(() => localStorage.getItem('copymanga.gal.autoVoiceDelay')) === '2.5')
  await pg.click('.gal-cfg')   // 关掉设置面板
  // 第 3 步有语音（v_1.wav，0.6 秒）。从第 2 步开始自动播放：到第 3 步语音响完后，再等 2.5 秒才进第 4 步
  await resetA()
  await pg.goto(link(EP1)); await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('早上好'), null, { timeout: 8000 })
  await sleep(600)
  await goStep(2, 6); await sleep(500)
  await pg.evaluate(() => { window.__t.voiceEnd = []; window.__t.count = [] })
  await pg.keyboard.press('Space')            // → 第 3 步（先渐变 0.8 秒再放语音）
  await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '3 / 6')
  await pg.keyboard.press('a')               // 开自动
  await pg.waitForFunction(() => window.__t.voiceEnd.length >= 1, null, { timeout: 8000 })
  const ve = await pg.evaluate(() => window.__t.voiceEnd[0])
  await sleep(1300)
  const stillThree = await cnt()
  check('自动播放：语音刚播完 1.3 秒，还在第 3 步（在等配置的 2.5 秒，没有按台词长度提前翻）', stillThree === '3 / 6', stillThree)
  await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '4 / 6', null, { timeout: 6000 })
  const advAt = await pg.evaluate(() => window.__t.count.find(([c]) => c === '4 / 6')?.[1])
  const waited = (advAt - ve) / 1000
  check(`自动播放：语音播完后等了 ${waited.toFixed(2)} 秒再进第 4 步（配置 2.5 秒）`, waited >= 2.4 && waited <= 3.4, String(waited))
  await pg.keyboard.press('a')
  // 改成 0 秒：语音一播完就进下一步
  await pg.click('.gal-cfg'); await setDelay(0); await pg.click('.gal-cfg')
  await pg.keyboard.press('ArrowLeft'); await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '3 / 6'); await sleep(300)
  await pg.evaluate(() => { window.__t.voiceEnd = []; window.__t.count = [] })
  await pg.keyboard.press('ArrowLeft'); await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '2 / 6'); await sleep(400)
  await pg.keyboard.press('Space'); await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '3 / 6'); await pg.keyboard.press('a')
  await pg.waitForFunction(() => window.__t.voiceEnd.length >= 1, null, { timeout: 8000 })
  const ve0 = await pg.evaluate(() => window.__t.voiceEnd[0])
  await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '4 / 6', null, { timeout: 5000 })
  const adv0 = await pg.evaluate(() => window.__t.count.find(([c]) => c === '4 / 6')?.[1])
  check(`自动等待 0 秒：语音播完 ${(((adv0 - ve0) / 1000)).toFixed(2)} 秒后就进下一步`, (adv0 - ve0) / 1000 < 0.8, String((adv0 - ve0) / 1000))
  await pg.keyboard.press('a')
  // 语音放不出来（缺文件）：不能一直等，退回按台词长度估时
  await pg.route(/\/resource\?path=.*fav100300_01_01\.mp3/i, (r) => r.fulfill({ status: 404, body: 'nope' }))
  await sleep(1500); await resetA()   // 等进度保存的防抖落盘后清零：刷新会从上次进度续播，这里要从头来
  await pg.reload(); await pg.waitForFunction(() => /\/ 6$/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 8000 }); await sleep(600)
  await goStep(2, 6); await sleep(400)
  await pg.keyboard.press('Space'); await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '3 / 6'); await pg.keyboard.press('a')
  await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '4 / 6', null, { timeout: 14000 }).catch(() => {})
  check('语音文件缺失：自动播放不会卡住，退回按台词长度估时继续前进', (await cnt()) === '4 / 6', await cnt())
  await pg.keyboard.press('a')
  await pg.unroute(/\/resource\?path=.*fav100300_01_01\.mp3/i)

  // ---- 上话/下话/返回（沉浸里的按钮）、F 全屏、退出沉浸并记住 ----
  await pg.unroute(/\/resource\?path=.*fav100300_01_01\.mp3/i).catch(() => {})
  await sleep(1500); await resetA()   // 等进度保存的防抖落盘后清零
  await pg.goto(link(EP1)); await pg.reload()   // 同一个 URL：goto 不会重新加载，补一次 reload 从头开始（进度已清零）
  await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('早上好'), null, { timeout: 8000 }); await sleep(500)
  check('第 1 个脚本：上话禁用、下话可用', await pg.$eval('.gal-ch-prev', (b) => b.disabled) && !(await pg.$eval('.gal-ch-next', (b) => b.disabled)))
  await pg.click('.gal-ch-next')
  await pg.waitForFunction(() => /\/ 2$/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 6000 })
  st = await immState()
  check('点「下话」：切到第 2 个脚本，仍在沉浸里（沿用沉浸状态）', st.app && st.view && /\/ 2$/.test(await cnt()), JSON.stringify([st, await cnt()]))
  await pg.click('.gal-ch-prev')
  await pg.waitForFunction(() => /\/ 6$/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 6000 })
  check('点「上话」：回到第 1 个脚本', /\/ 6$/.test(await cnt()))
  await pg.keyboard.press('f'); await sleep(700)
  const fs = await pg.evaluate(() => document.fullscreenElement?.className || '')
  console.log(`  (全屏元素: ${fs || '无——无头浏览器可能不支持全屏'})`)
  if (fs) {
    check('F 全屏：全屏的是整个播放器（工具栏在里面）', /gal-player/.test(fs))
    const fsGeo = await pg.evaluate(() => { const s = document.querySelector('.gal-stage').getBoundingClientRect(); const b = document.querySelector('.gal-bar').getBoundingClientRect(); return { ratio: s.width / s.height, barIn: b.bottom <= innerHeight && b.top >= 0, w: s.width, vw: innerWidth } })
    check('全屏：舞台仍是 16:9 居中，工具栏可见', Math.abs(fsGeo.ratio - 16 / 9) < 0.03 && fsGeo.barIn, JSON.stringify(fsGeo))
    await pg.keyboard.press('f'); await sleep(500)
  }
  await pg.keyboard.press('Escape'); await sleep(400)
  st = await immSt()
  async function immSt() { return immState() }
  check('Esc：退出沉浸（头部和顶栏回来），并记住「不要沉浸」', !st.app && !st.view && st.head !== 'none' && st.pref === false, JSON.stringify(st))
  await pg.reload(); await pg.waitForSelector('.gal-stage'); await sleep(800)
  st = await immState()
  check('刷新后不再自动进沉浸（偏好被记住）', !st.app && st.btn === '沉浸', JSON.stringify(st))
  check('头部的「沉浸」按钮对 Gal 可用', !(await pg.$eval('#media-immersive', (b) => b.disabled)))
  await pg.click('#media-immersive'); await sleep(400)
  st = await immState()
  check('点头部「沉浸」：进入，偏好改回「要沉浸」', st.app && st.view && st.pref === true, JSON.stringify(st))
  await pg.keyboard.press('i'); await sleep(300)
  check('按 I：退出沉浸', !(await immState()).app)
  await pg.keyboard.press('i'); await sleep(300)
  check('再按 I：进入沉浸', (await immState()).app)
  await pg.click('.gal-back'); await sleep(700)
  st = await immState()
  check('点「返回」：退出沉浸并回到媒体库（不改偏好）', !st.app && st.pref === true && await pg.$eval('#library-view', (v) => v.classList.contains('active')), JSON.stringify(st))
  check('新功能全程没有页面错误', errs2.length === 0, errs2.join(' | '))
  await ctx2.close()
}

// ---- 6d. 浏览层 + 沉浸（窄屏）：浏览和播放共用同一套沉浸状态 ----
{
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 } })   // 没存沉浸偏好：默认沉浸
  const pg = await ctx3.newPage()
  const errs3 = []
  pg.on('pageerror', (e) => errs3.push(e.message))
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  const overflow = () => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const imm = () => pg.evaluate(() => ({ app: document.querySelector('#app').classList.contains('stream-immersive'), head: getComputedStyle(document.querySelector('#media-viewer-view .chapter-head')).display, pref: JSON.parse(localStorage.getItem('copymanga.immersivePref') || '{}').gal, leave: document.querySelector('.gal-browse-leave') ? getComputedStyle(document.querySelector('.gal-browse-leave')).display : null, btn: document.querySelector('.gal-browse-imm')?.textContent }))
  await pg.goto(link('')); await pg.waitForSelector('.gal-browse[data-node=""]')
  await sleep(300)
  let st = await imm()
  check('首页默认也进沉浸（和播放页一样）：头部收起，浏览层铺满；有「退出沉浸」「返回」按钮', st.app && st.head === 'none' && st.leave !== 'none' && st.btn === '退出沉浸', JSON.stringify(st))
  const fill = await pg.evaluate(() => { const r = document.querySelector('#media-reader-content').getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), vh: innerHeight, w: Math.round(r.width), vw: innerWidth } })
  check('[390x800] 沉浸：浏览层铺满视口，没有横向滚动条；卡片排得下', fill.top <= 2 && fill.h >= fill.vh - 4 && fill.w >= fill.vw - 2 && (await overflow()) <= 1 && (await pg.$$('.gal-card')).length === 9, JSON.stringify([fill, await overflow()]))
  await pg.screenshot({ path: path.join(shotDir, 'browse-390-immersive.png') })
  await pg.mouse.move(100, 2); await sleep(400)
  check('沉浸里鼠标贴顶边：顶栏滑出（和播放页一致）', await pg.$eval('#app', (a) => a.classList.contains('stream-chrome-visible')))
  await pg.mouse.move(100, 400); await sleep(2300)
  await pg.click('.gal-card[data-node="d:cabin"]'); await pg.waitForSelector('.gal-card[data-node="d:cabin/adultr"]')
  await pg.click('.gal-card[data-node="d:cabin/adultr"]'); await pg.waitForSelector('.gal-card.is-script')
  check('[390x800] 点进目录：仍在沉浸里（不退出再进入）；列表没有横向滚动条', (await imm()).app && (await overflow()) <= 1)
  await pg.screenshot({ path: path.join(shotDir, 'browse-390-list.png') })
  await pg.click('.gal-card[data-title="600130"]'); await pg.waitForSelector('.gal-player .gal-stage')
  await sleep(500)
  check('点进脚本：沉浸保持（播放页沉浸按钮在工具栏里）', (await imm()).app && (await imm()).head === 'none' && (await pg.$eval('.gal-imm', (b) => b.textContent)) === '退出沉浸')
  await pg.click('.gal-up'); await pg.waitForSelector('.gal-browse'); await sleep(300)
  check('沉浸里点「↑ 列表」：回到列表，仍是沉浸；没有改沉浸偏好', (await imm()).app && (await imm()).pref !== false)
  await pg.keyboard.press('Escape'); await sleep(400)
  st = await imm()
  check('浏览层按 Esc：退出沉浸（头部和顶栏回来），并记住「不要沉浸」', !st.app && st.head !== 'none' && st.pref === false && st.btn === '沉浸', JSON.stringify(st))
  await pg.click('.gal-card[data-title="600230"]'); await pg.waitForSelector('.gal-player .gal-stage'); await sleep(400)
  check('记住了偏好：再点进脚本也不会自动进沉浸', !(await imm()).app)
  await pg.click('.gal-up'); await pg.waitForSelector('.gal-browse'); await sleep(300)
  await pg.keyboard.press('i'); await sleep(300)
  check('浏览层按 I：进入沉浸（偏好改回「要沉浸」）', (await imm()).app && (await imm()).pref === true)
  await pg.click('.gal-browse-leave'); await sleep(600)
  st = await imm()
  check('浏览层沉浸里点「返回」：退出沉浸并离开这个媒体回到媒体库', !st.app && await pg.$eval('#library-view', (v) => v.classList.contains('active')), JSON.stringify(st))
  check('[390x800] 没有页面错误', errs3.length === 0, errs3.join('|'))
  await ctx3.close()
  // 接口层：reader 的 sectionId 就是节点 id；非法的在接口上就挡掉
  const get = async (section, unit = 'main') => { const r = await fetch(`${base}/api/library/items/gal/${M.itemId}/reader/${unit}?sectionId=${encodeURIComponent(section)}`); return { status: r.status, body: await r.json().catch(() => ({})) } }
  const ok = await get('d:cabin/adultr')
  check('接口：reader?sectionId=d:cabin/adultr 返回列表节点', ok.status === 200 && ok.body.node.kind === 'cards' && ok.body.scene === null && ok.body.node.items.length === 2)
  check('接口：脚本节点返回规范场景（含选项/条件的脚本）', (await get(sec('cabin/adultr/600130.txt'))).body.scene?.format === 'gal-scene/1' && (await get(sec('character/1003/adultr/100300.txt'))).body.scene.steps.some((st) => st.commands.some((c) => c.op === 'choice')))
  const bad = await Promise.all([get('s:../../etc/passwd'), get('s:cabin/adultr/notes.txt'), get('d:nope'), get('d:..'), get('', 'other-unit'), get(`s:${'a/'.repeat(300)}x.txt`), get('@nope|d:')])
  check('接口：穿越/非脚本/不存在/非法/未知单元/超长路径/未知文本版本 都是错误（不是 200）', bad.every((r) => r.status >= 400) && bad.slice(0, 4).map((r) => r.status).join() === '400,400,404,400', JSON.stringify(bad.map((r) => r.status)))
  const hit = await fetch(`${base}/api/library/items/gal/${M.itemId}/resource?path=${encodeURIComponent('~/user_data/license.dat')}`)
  check('接口：资源接口不让读 user_data 里别的文件（license.dat 等）', hit.status >= 400)
}

// ---- 6e. 分支：选项（正中、竖排）/ 条件 / 回退重选 / 续播 / 自动选择 / 字体大小 ----
{
  const BR = sec('character/1003/adultr/100300.txt')
  const resetBR = async () => { await fetch(`${base}/api/library/items/gal/${M.itemId}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId: 'main', sectionId: BR, scrollRatio: 0, choices: {} }) }) }
  await resetBR()
  const ctx4 = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx4.addInitScript(() => { if (!localStorage.getItem('copymanga.immersivePref')) localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })) })
  const pg = await ctx4.newPage()
  const errs4 = []
  pg.on('pageerror', (e) => errs4.push(e.message))
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  const cnt = () => pg.$eval('.gal-count', (e) => e.textContent).catch(() => '')
  const text = () => pg.$eval('.gal-text', (e) => e.textContent).catch(() => '')
  const choiceVisible = () => pg.$eval('.gal-choices', (e) => !e.hidden && getComputedStyle(e).display !== 'none').catch(() => false)
  const goText = async (re, key = 'Space') => { for (let i = 0; i < 25; i++) { if (re.test(await text())) return true; await pg.keyboard.press(key); await sleep(280) } return re.test(await text()) }
  const open = async () => { await pg.goto(link(BR)); await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('你想听听'), null, { timeout: 8000 }); await sleep(900) }
  await pg.goto(`${base}/`)
  await open()
  check('分支脚本：先没选 → 总步数只算不含分支的（1 / 5）', (await cnt()) === '1 / 5', await cnt())
  const sizes = await pg.evaluate(() => ({ name: getComputedStyle(document.querySelector('.gal-name span')).fontSize, nameBase: getComputedStyle(document.querySelector('.gal-name')).fontSize, body: getComputedStyle(document.querySelector('.gal-text span')).fontSize, bodyBase: getComputedStyle(document.querySelector('.gal-text')).fontSize }))
  check('<size=27> / <size=30>：相对基准字号缩放（名字 0.9 倍、正文 1 倍）', Math.abs(parseFloat(sizes.name) / parseFloat(sizes.nameBase) - 0.9) < 0.02 && Math.abs(parseFloat(sizes.body) / parseFloat(sizes.bodyBase) - 1) < 0.02, JSON.stringify(sizes))
  await pg.keyboard.press('Space')
  await pg.waitForFunction(() => document.querySelector('.gal-text ruby'), null, { timeout: 4000 })
  const ruby = await pg.$eval('.gal-text ruby', (r) => ({ base: r.firstChild.textContent, rt: r.querySelector('rt').textContent }))
  check('<ruby>幻夢境|げんむきょう</ruby>：渲染成注音', ruby.base === '幻夢境' && ruby.rt === 'げんむきょう', JSON.stringify(ruby))
  await pg.keyboard.press('Space')
  await pg.waitForFunction(() => { const c = document.querySelector('.gal-choices'); return c && !c.hidden }, null, { timeout: 4000 })
  const layout = await pg.evaluate(() => { const c = document.querySelector('.gal-choices').getBoundingClientRect(); const s = document.querySelector('.gal-stage').getBoundingClientRect(); const bs = [...document.querySelectorAll('.gal-choice')].map((b) => b.getBoundingClientRect()); return { cx: (c.left + c.right) / 2 - (s.left + s.right) / 2, texts: [...document.querySelectorAll('.gal-choice')].map((b) => b.textContent), vertical: bs.every((b, i) => i === 0 || b.top >= bs[i - 1].bottom - 1), centered: bs.every((b) => Math.abs((b.left + b.right) / 2 - (s.left + s.right) / 2) < 6), midY: bs.length ? (bs[0].top + bs.at(-1).bottom) / 2 - (s.top + s.bottom) / 2 : 999, count: document.querySelector('.gal-count').textContent } })
  check('出现选项：画面正中、竖排；每项带序号；去掉了「選項N」前缀', J(layout.texts) === J(['1「想听」', '2「不想听」']) && layout.vertical && layout.centered && Math.abs(layout.cx) < 4 && Math.abs(layout.midY) < 80, JSON.stringify(layout))
  await pg.screenshot({ path: path.join(shotDir, 'choices.png') })
  const stuck = await cnt()
  await pg.keyboard.press('Space'); await pg.click('.gal-stage', { position: { x: 30, y: 30 } }); await sleep(400)
  check('选项开着：空格/点舞台都不会翻页', (await cnt()) === stuck && (await choiceVisible()))
  await pg.screenshot({ path: path.join(shotDir, 'choices.png') })
  await pg.keyboard.press('1'); await sleep(400)
  check('按数字键 1：选第 1 项；选项收起；走甲线（台词是分支 1 的），总步数变成 6', !(await choiceVisible()) && /请听我说/.test(await text()) && (await cnt()) === '3 / 6', JSON.stringify([await text(), await cnt()]))
  check('选了甲线：没有出现乙线的台词（互斥）', !/那下次吧/.test(await text()))
  await pg.keyboard.press('Space'); await sleep(300)
  check('甲线第二句；乙线步骤被跳过', /分支 1 的第二句/.test(await text()) && (await cnt()) === '4 / 6', JSON.stringify([await text(), await cnt()]))
  await pg.keyboard.press('Space'); await sleep(300)
  check('两条线汇合后的句子', /汇合/.test(await text()) && (await cnt()) === '5 / 6')
  // 回看记录里只有走过的分支
  await pg.keyboard.press('l'); await pg.waitForSelector('.gal-log:not([hidden]) .gal-log-row')
  const logTexts = await pg.$$eval('.gal-log-row', (rs) => rs.map((r) => r.textContent).join('|'))
  check('回看记录：只含走过的分支（甲线有、乙线没有）', /请听我说/.test(logTexts) && !/那下次吧/.test(logTexts), logTexts)
  await pg.keyboard.press('Escape')
  // 往回走到选项那一步 = 重选
  await pg.keyboard.press('ArrowLeft'); await sleep(250)
  check('后退一步：回到甲线第二句', /分支 1 的第二句/.test(await text()) && (await cnt()) === '4 / 6')
  await pg.keyboard.press('ArrowLeft'); await sleep(500)
  check('再后退到选项那一步：重新弹出选项（已选的作废，路径回到没选时：3 / 5）', (await choiceVisible()) && (await cnt()) === '3 / 5', JSON.stringify([await choiceVisible(), await cnt()]))
  await pg.click('.gal-choice[data-value="2"]'); await sleep(400)
  check('点第 2 项：选项收起；路径变成乙线（3 / 6）', !(await choiceVisible()) && (await cnt()) === '3 / 6', await cnt())
  await pg.keyboard.press('Space'); await sleep(300)
  check('改走乙线：台词是乙线的，甲线的第二句不再出现', /那下次吧/.test(await text()) && (await cnt()) === '4 / 6', JSON.stringify([await text(), await cnt()]))
  // 续播：选择跟着进度存
  await sleep(1300)
  const saved = await (await fetch(`${base}/api/library/items/gal/${M.itemId}/progress`)).json()
  check('进度里存了选择（第一个选项 = 2）和位置', saved.nodes[BR]?.choices && Object.values(saved.nodes[BR].choices)[0] === 2 && Math.abs(saved.nodes[BR].ratio - 0.6) < 0.01, JSON.stringify(saved.nodes[BR]))
  await pg.reload(); await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.length > 0, null, { timeout: 8000 }); await sleep(800)
  check('刷新续播：回到乙线的同一句（选择被还原，路径一致）', /那下次吧/.test(await text()) && (await cnt()) === '4 / 6' && !(await choiceVisible()), JSON.stringify([await text(), await cnt()]))
  // 自动播放遇到选项会停下等人选
  await resetBR(); await pg.reload(); await pg.waitForFunction(() => /^1 \/ 5/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 8000 }); await sleep(600)
  await pg.keyboard.press('a')
  await pg.waitForFunction(() => { const c = document.querySelector('.gal-choices'); return c && !c.hidden }, null, { timeout: 15000 })
  await sleep(2500)
  check('自动播放（A）走到选项：停下等人选，不会自己选（等了 2.5 秒选项还在）', await choiceVisible())
  await pg.keyboard.press('a')
  // 自动选择
  await pg.click('.gal-cfg'); await sleep(200)
  const defaults = await pg.evaluate(() => ({ input: document.querySelector('.gal-set-autochoice').value, btn: document.querySelector('.gal-autosel').textContent, active: document.querySelector('.gal-autosel').classList.contains('active') }))
  check('自动选择默认关（-1）；工具栏「自选」开关没亮', defaults.input === '-1' && defaults.btn === '自选' && !defaults.active, JSON.stringify(defaults))
  await pg.fill('.gal-set-autochoice', '2'); await pg.dispatchEvent('.gal-set-autochoice', 'input'); await sleep(1200)
  check('选项开着时设成 2：约 0.7 秒后自动选第 2 项（乙线）', !(await choiceVisible()) && (await cnt()) === '3 / 6' && (await pg.$eval('.gal-autosel', (b) => b.textContent)) === '自选:2' && await pg.$eval('.gal-autosel', (b) => b.classList.contains('active')), JSON.stringify([await choiceVisible(), await cnt()]))
  check('自动选择存进浏览器', (await pg.evaluate(() => localStorage.getItem('copymanga.gal.autoChoice'))) === '2')
  await pg.click('.gal-cfg')
  const reopen = async () => { await sleep(1300); await resetBR(); await pg.reload(); await pg.waitForFunction(() => /^1 \/ 5/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 8000 }); await sleep(500); await pg.keyboard.press('Space'); await sleep(350); await pg.keyboard.press('Space') }
  await reopen()
  await pg.waitForFunction(() => /请听我说|那下次吧/.test(document.querySelector('.gal-text')?.textContent || ''), null, { timeout: 8000 }).catch(() => {})
  check('刷新后设置还在；到选项直接自动选第 2 项（不弹出等人）', /那下次吧|幻夢境/.test(await text()) && !(await choiceVisible()) && (await pg.$eval('.gal-autosel', (b) => b.textContent)) === '自选:2', JSON.stringify([await text(), await choiceVisible()]))
  await pg.click('.gal-autosel'); await sleep(200)
  check('点「自选」开关：关掉（存 -1）；再点：恢复成上一次的值（2）', (await pg.evaluate(() => localStorage.getItem('copymanga.gal.autoChoice'))) === '-1' && (await pg.$eval('.gal-autosel', (b) => b.textContent)) === '自选')
  await pg.click('.gal-autosel'); await sleep(200)
  check('再点「自选」：恢复 2', (await pg.evaluate(() => localStorage.getItem('copymanga.gal.autoChoice'))) === '2')
  // 0 = 随机；3 = 没有第 3 项 → 随机；1 = 选第 1 项
  const outcomes = async (value, runs) => {
    const seen = new Set()
    for (let i = 0; i < runs; i++) {
      await pg.click('.gal-cfg'); await pg.fill('.gal-set-autochoice', String(value)); await pg.dispatchEvent('.gal-set-autochoice', 'input'); await pg.click('.gal-cfg')
      await sleep(1300); await resetBR(); await pg.reload(); await pg.waitForFunction(() => /^1 \/ 5/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 8000 }); await sleep(400)
      await pg.keyboard.press('Space'); await sleep(350); await pg.keyboard.press('Space')
      await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '3 / 6', null, { timeout: 5000 }).catch(() => {})
      await sleep(900)
      const sv = await (await fetch(`${base}/api/library/items/gal/${M.itemId}/progress`)).json()
      const ch = sv.nodes?.[BR]?.choices
      seen.add(ch ? String(Object.values(ch)[0]) : `none`)
    }
    return [...seen]
  }
  check('自动选择 = 1：每次都选第 1 项', J(await outcomes(1, 2)) === J(['1']))
  const rnd = await outcomes(0, 6)
  check('自动选择 = 0：随机选一个（有效项之内；多次运行出现过的结果都合法）', rnd.every((x) => x === '1' || x === '2') && rnd.length >= 1, J(rnd))
  const three = await outcomes(3, 3)
  check('自动选择 = 3 但只有 2 项：退回随机（不会卡住、不会选出不存在的项）', three.every((x) => x === '1' || x === '2'), J(three))
  // 字体大小
  await pg.click('.gal-cfg'); await sleep(200)
  const fontOf = () => pg.evaluate(() => ({ hud: parseFloat(getComputedStyle(document.querySelector('.gal-hud')).fontSize), val: document.querySelector('.gal-settings .gal-set-row:nth-child(1) .gal-set-value').textContent, stored: localStorage.getItem('copymanga.gal.fontScale') }))
  const f100 = await fontOf()
  await pg.$eval('.gal-settings .gal-set-row:nth-child(1) input', (e) => { e.value = '150'; e.dispatchEvent(new Event('input', { bubbles: true })) }); await sleep(200)
  const f150 = await fontOf()
  check('设置里的「字体大小」：默认 100%；调到 150% 台词字号放大 1.5 倍（<size> 的相对大小跟着一起变）；存进浏览器', f100.val === '100%' && f150.val === '150%' && Math.abs(f150.hud / f100.hud - 1.5) < 0.03 && f150.stored === '1.5', JSON.stringify([f100, f150]))
  await pg.$eval('.gal-settings .gal-set-row:nth-child(1) input', (e) => { e.value = '60'; e.dispatchEvent(new Event('input', { bubbles: true })) }); await sleep(150)
  const f60 = await fontOf()
  check('调到下限 60%：字号缩小', Math.abs(f60.hud / f100.hud - 0.6) < 0.03)
  await pg.screenshot({ path: path.join(shotDir, 'settings-font.png') })
  await pg.reload(); await pg.waitForSelector('.gal-stage'); await sleep(700)
  check('刷新后字体大小还在（60%）', Math.abs((await fontOf()).hud / f100.hud - 0.6) < 0.03)
  check('分支功能全程没有页面错误', errs4.length === 0, errs4.join(' | '))
  await ctx4.close()
}

// ---- 7. 多视口：舞台比例、台词框、控制条 ----
// 续播会把进度存在服务端：每个视口都要从头看，先把 A 的进度清零
const resetProgress = async () => { for (const n of ['cabin/adultr/600130.txt', 'cabin/adultr/600230.txt']) await fetch(`${base}/api/library/items/gal/${M.itemId}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId: 'main', sectionId: sec(n), scrollRatio: 0 }) }) }
for (const vp of [{ w: 1920, h: 1080 }, { w: 1024, h: 700 }, { w: 800, h: 900 }, { w: 390, h: 800 }]) {
  await resetProgress()
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', (e) => errs.push(e.message))
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  await pg.goto(link(sec('cabin/adultr/600130.txt')))
  await pg.waitForSelector('.gal-stage')
  await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('早上好'), null, { timeout: 8000 })
  for (let i = 0; i < 4; i++) { await pg.keyboard.press('Space'); await sleep(250) }
  await pg.keyboard.press('Space'); await sleep(900)   // 第 5 步：超长台词（竖图背景）
  const g = await pg.evaluate(() => {
    const s = document.querySelector('.gal-stage').getBoundingClientRect()
    const b = document.querySelector('.gal-box').getBoundingClientRect()
    const bar = document.querySelector('.gal-bar').getBoundingClientRect()
    const player = document.querySelector('.gal-player').getBoundingClientRect()
    return { w: s.width, ratio: s.width / s.height, boxInside: b.left >= s.left - 1 && b.right <= s.right + 1 && b.top >= s.top - 1 && b.bottom <= s.bottom + 1, boxH: b.height, stageH: s.height, barW: bar.width, playerW: player.width, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, count: document.querySelector('.gal-count').textContent, text: document.querySelector('.gal-text').textContent.length }
  })
  check(`[${vp.w}x${vp.h}] 舞台 16:9、没有横向滚动条`, Math.abs(g.ratio - 16 / 9) < 0.03 && g.docOverflow <= 1, JSON.stringify(g))
  check(`[${vp.w}x${vp.h}] 超长台词：台词框没有超出舞台`, g.boxInside, JSON.stringify(g))
  check(`[${vp.w}x${vp.h}] 控制条没超出播放器宽度`, g.barW <= g.playerW + 1)
  await pg.screenshot({ path: path.join(shotDir, `player-${vp.w}.png`) })
  check(`[${vp.w}x${vp.h}] 没有页面错误`, errs.length === 0, errs.join('|'))
  await ctx.close()
}

await browser.close()
server.kill('SIGTERM')
await rm(work, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
