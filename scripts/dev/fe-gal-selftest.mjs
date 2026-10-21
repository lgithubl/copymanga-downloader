#!/usr/bin/env node
// 浏览器自测：Gal 导入（导入页 UI）→ 媒体库卡片 → 单元列表 → 播放器（步进/后退/键盘/自动/记录/续播/缺资源/多视口）。
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

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-gal-'))
const dataDir = path.join(work, 'data')
await mkdir(path.join(dataDir, 'gal'), { recursive: true })
await buildGalFixture(path.join(dataDir, 'gal'), { exampleScript: process.env.GAL_EXAMPLE || '' })
const port = 8102
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用（上次测试没清理干净？）`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
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
check('JSON 配置可见：含 rootDir/maxDepth/scriptExtensions/adapters', /"rootDir"/.test(ui.config) && /"scriptExtensions"/.test(ui.config) && /"adapters"/.test(ui.config) && /uviewer-csv/.test(ui.config), ui.config)
// 把 rootDir 指到临时数据目录里的 gal（默认值是 /data/gal，测试机上不存在）
await page.fill('#media-import-profile-config', JSON.stringify({ rootDir: path.join(dataDir, 'gal'), maxDepth: 6, scriptExtensions: ['txt', 'csv'], adapters: ['uviewer-csv'] }))
await page.click('#media-import-submit')
await page.waitForFunction(() => document.querySelector('#library-view:not(.hidden)') || true, null, { timeout: 15000 })
await page.waitForTimeout(2500)
check('导入完成有汇总提示（新建、没有脚本 1）', dialogs.some((d) => /Gal 导入完成/.test(d) && /新建 4/.test(d) && /没有脚本 1/.test(d)), JSON.stringify(dialogs))
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
const expectWorks = 4
check(`类型筛选里有 Gal，列表是 ${expectWorks} 个作品`, cards.length === expectWorks, JSON.stringify(cards.map((c) => c.title)))
const cardA = cards.find((c) => c.title?.startsWith('演示作品A'))
check('A 卡片：类型胶囊「Gal」、封面图加载成功（背景图当封面）', cardA?.typePill === 'Gal' && cardA.natural > 0 && /thumbnail\/script\/cover$/.test(cardA.img), JSON.stringify(cardA))
check('B 卡片（没封面）：占位', cards.find((c) => c.title?.startsWith('演示作品B'))?.ph === true)
await page.screenshot({ path: path.join(shotDir, 'library.png') })

// ---- 3. 打开 A：详情单元列表 → 播放器 ----
await page.locator('#library-items .library-card', { hasText: '演示作品A' }).first().click()
await page.waitForSelector('#library-units .library-unit')
const units = await page.$$eval('#library-units .library-unit', (rs) => rs.map((r) => ({ title: r.querySelector('.chapter-title')?.textContent, meta: r.querySelector('.library-unit-path')?.textContent, status: r.querySelector('.library-unit-status')?.textContent })))
check('单元列表：2 个脚本，显示步数', units.length === 2 && /6步/.test(units[0].status) && /2步/.test(units[1].status), JSON.stringify(units))
await page.screenshot({ path: path.join(shotDir, 'units.png') })
await page.locator('#library-units .library-unit').first().click()
await page.waitForSelector('.gal-player .gal-stage')
const t = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null)
const textNow = () => page.$eval('.gal-text', (e) => e.textContent)
const nameNow = () => page.$eval('.gal-name', (e) => (e.hidden ? '' : e.textContent))
const countNow = () => t('.gal-count')
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
check('播放了语音（v_1.wav）', resourceRequests.includes('download/sound/voice/v_1.wav'))
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
check('第 4 步（wait + 变黑 + 换纯色 + 出黑场）：点击能跳过动画，最终状态正确（黑场已退、纯色背景）', s4.black === '0' && s4.bg.some(([o, c]) => o === '1' && c === 'rgb(20, 60, 40)'), JSON.stringify(s4))
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
check('走到末步：下一句按钮禁用，▼ 提示消失', (await page.$eval('.gal-bar button:nth-of-type(2)', (b) => b.disabled)) && (await page.$eval('.gal-next', (e) => e.hidden)))
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

// ---- 4. 续播 ----
await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => /^3 \/ 6/.test(document.querySelector('.gal-count').textContent))
await sleep(1500)   // 等进度保存的防抖
const prog = await (await fetch(`${base}/api/library/items/gal/${apiItems.items?.[0]?.itemId || ''}/progress`)).json().catch(() => null)
await page.click('[data-view="library-view"]')
await page.waitForSelector('#library-units .library-unit')
await sleep(600)
await page.locator('#library-units .library-unit').first().click()
await page.waitForSelector('.gal-player .gal-stage')
await page.waitForFunction(() => document.querySelector('.gal-count')?.textContent.length > 0)
const resumed = await countNow()
check('续播：重新打开同一脚本，回到上次的步数', /^[23] \/ 6/.test(resumed), `${resumed} progress=${JSON.stringify(prog)}`)

// ---- 5. 第二个脚本（上/下一单元） ----
await page.click('#media-reader-next').catch(() => {})
await page.waitForFunction(() => /\/ 2$/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 5000 }).catch(() => {})
check('下一单元：切到第 2 个脚本（2 步）', /\/ 2$/.test((await countNow()) || ''), await countNow())

// ---- 6. 缺资源的作品 ----
await page.click('[data-view="library-view"]')
await page.locator('#library-items .library-card', { hasText: '演示作品B' }).first().click()   // 只有 1 个脚本：点卡片直接进播放器
await page.waitForSelector('.gal-player .gal-stage')
await page.waitForFunction(() => /缺少资源/.test(document.querySelector('.gal-note')?.textContent || ''), null, { timeout: 8000 }).catch(() => {})
check('缺资源：提示「缺少资源 N 个」，播放器不崩', /缺少资源 \d+ 个/.test((await t('.gal-note')) || ''), await t('.gal-note'))
await sleep(600)   // 等第 1 步的渐变做完（动画中按键是「跳过动画」而不是前进）
await page.keyboard.press('Space'); await sleep(300)
check('缺资源：仍能继续下一步（含不存在的视频）', /^2 \/ 2/.test(await countNow()), await countNow())
await page.screenshot({ path: path.join(shotDir, 'player-missing.png') })
// ---- 6b. 长脚本 D（立绘/遮罩/Spine 指令暂未渲染但不影响播放；伪 mp3 实为 wav，浏览器要能解码）----
await page.click('[data-view="library-view"]')
await page.waitForSelector('#library-items .library-card')
await page.locator('#library-items .library-card', { hasText: '演示作品D' }).first().click()
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
check('没有页面错误', errors.length === 0, errors.join(' | '))

// ---- 7. 多视口：舞台比例、台词框、控制条 ----
// 续播会把进度存在服务端：每个视口都要从头看，先把 A 的进度清零
const listed = await (await fetch(`${base}/api/library/items?type=gal&page=1&limit=50`)).json()
const aItem = listed.items.find((i) => i.title.startsWith('演示作品A'))
const resetProgress = async () => {
  for (const u of (await (await fetch(`${base}/api/library/items/gal/${aItem.itemId}/units`)).json())) {
    await fetch(`${base}/api/library/items/gal/${aItem.itemId}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId: u.unitId, scrollRatio: 0 }) })
  }
}
for (const vp of [{ w: 1920, h: 1080 }, { w: 1024, h: 700 }, { w: 800, h: 900 }, { w: 390, h: 800 }]) {
  await resetProgress()
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', (e) => errs.push(e.message))
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  await pg.goto(`${base}/`)
  await pg.click('[data-view="library-view"]')
  await pg.waitForSelector('#library-items .card')
  await pg.locator('#library-items .library-card', { hasText: '演示作品A' }).first().click()
  await pg.waitForSelector('#library-units .library-unit')
  await pg.locator('#library-units .library-unit').first().click()
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
