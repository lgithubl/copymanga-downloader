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

// ---- 6c. 新功能：沉浸 / 工具栏在文本框底部 / 文本框透明度 / 自动播放等语音 ----
{
  const listed2 = await (await fetch(`${base}/api/library/items?type=gal&page=1&limit=50`)).json()
  const A2 = listed2.items.find((i) => i.title.startsWith('演示作品A'))
  const D2 = listed2.items.find((i) => i.title.startsWith('演示作品D'))
  const unitsA = await (await fetch(`${base}/api/library/items/gal/${A2.itemId}/units`)).json()
  const resetA = async () => { for (const u of unitsA) await fetch(`${base}/api/library/items/gal/${A2.itemId}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId: u.unitId, scrollRatio: 0 }) }) }
  await resetA()
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // 记录语音的开始/播完时间，和台词计数器变化的时间，用来量「语音播完后等 N 秒」
  await ctx2.addInitScript(() => {
    window.__t = { voiceEnd: [], count: [] }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...args) {
      if (/voice(\/|%2F)/i.test(this.src || '') && !this.__hooked) { this.__hooked = true; this.addEventListener('ended', () => window.__t.voiceEnd.push(performance.now())) }
      return play.apply(this, args)
    }
    new MutationObserver(() => { const c = document.querySelector('.gal-count'); if (c && c.textContent !== window.__t.last) { window.__t.last = c.textContent; window.__t.count.push([c.textContent, performance.now()]) } }).observe(document, { childList: true, subtree: true, characterData: true })
  })
  const pg = await ctx2.newPage()
  const errs2 = []
  pg.on('pageerror', (e) => errs2.push(e.message))
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  const link = (item, unit) => `${base}/#/media/gal/${item.itemId}/${encodeURIComponent(unit.unitId)}`
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
  await pg.goto(link(A2, unitsA[0]))
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
    return { barInHud: bar.top >= box.bottom - 1 && bar.bottom <= hud.bottom + 1 && bar.left >= hud.left - 1 && bar.right <= hud.right + 1, hudInStage: hud.left >= stage.left && hud.right <= stage.right && hud.bottom <= stage.bottom, boxAboveBar: box.bottom <= bar.top + 1, fonts: [...new Set(btns.map((b) => getComputedStyle(b).fontSize))], maxH: Math.max(...btns.map((b) => b.getBoundingClientRect().height)), n: btns.length, barOutside: !!document.querySelector('.gal-player > .gal-bar') }
  })
  check('工具栏在文本框底部（同一块背景里）、在舞台内，不再在舞台外面', geo2.barInHud && geo2.hudInStage && geo2.boxAboveBar && !geo2.barOutside, JSON.stringify(geo2))
  check('按钮是小号的（字号 ≤ 13px，高度 ≤ 28px）', geo2.fonts.every((f) => parseFloat(f) <= 13.01) && geo2.maxH <= 28, JSON.stringify(geo2))
  await pg.screenshot({ path: path.join(shotDir, 'toolbar.png') })

  // 没有台词时（文本框收起）工具栏仍在底部：长脚本 D 的最后一步台词是空的
  const unitsD = await (await fetch(`${base}/api/library/items/gal/${D2.itemId}/units`)).json()
  await fetch(`${base}/api/library/items/gal/${D2.itemId}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId: unitsD[0].unitId, scrollRatio: 0 }) })
  await pg.goto(link(D2, unitsD[0]))
  await pg.waitForSelector('.gal-stage')
  await pg.waitForFunction(() => /^1 \/ \d+/.test(document.querySelector('.gal-count')?.textContent || ''))
  const dN = Number((await cnt()).split('/')[1])
  await sleep(1800)
  await goStep(dN, dN); await sleep(1200)
  const emptyBox = await pg.evaluate(() => { const bar = document.querySelector('.gal-bar').getBoundingClientRect(); const st = document.querySelector('.gal-stage').getBoundingClientRect(); return { boxHidden: document.querySelector('.gal-box').hidden, barVisible: bar.width > 0 && bar.height > 0 && bar.bottom <= st.bottom + 1 && bar.top >= st.top } })
  check('没有台词（文本框收起）时，工具栏仍然可见、在舞台底部', emptyBox.boxHidden && emptyBox.barVisible, JSON.stringify(emptyBox))

  // ---- 点工具栏上的按钮不会顺带翻页；设置弹层 ----
  await resetA()
  await pg.goto(link(A2, unitsA[0]))
  await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('早上好'), null, { timeout: 8000 })
  await sleep(800)
  const before = await cnt()
  await pg.click('.gal-cfg'); await sleep(250)
  const panel = await pg.evaluate(() => { const p = document.querySelector('.gal-settings').getBoundingClientRect(); const s = document.querySelector('.gal-stage').getBoundingClientRect(); return { hidden: document.querySelector('.gal-settings').hidden, inside: p.left >= s.left - 1 && p.right <= s.right + 1 && p.top >= s.top - 1 && p.bottom <= s.bottom + 1 } })
  check('点 ⚙：设置弹层打开、在舞台内；这一下没有翻页', !panel.hidden && panel.inside && (await cnt()) === before, JSON.stringify([panel, before, await cnt()]))
  const alpha = () => pg.evaluate(() => { const m = getComputedStyle(document.querySelector('.gal-hud')).backgroundColor.match(/[\d.]+/g); return { a: m.length > 3 ? Number(m[3]) : 1, clear: document.querySelector('.gal-player').classList.contains('gal-clear'), val: document.querySelector('.gal-settings input[type=range]').value, label: document.querySelector('.gal-set-value').textContent } })
  const a0 = await alpha()
  check('文本框透明度：默认 74%（原来写死的值）', Math.abs(a0.a - 0.74) < 0.01 && a0.val === '74' || a0.val === '75' && Math.abs(a0.a - 0.74) < 0.01, JSON.stringify(a0))
  const setRange = (selector, value) => pg.$eval(selector, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
  await setRange('.gal-settings .gal-set-row:nth-child(1) input', 30); await sleep(150)
  const a30 = await alpha()
  check('文本框透明度调到 30%：背景 alpha=0.3，并加了字影保证可读（gal-clear）', Math.abs(a30.a - 0.3) < 0.01 && a30.clear && a30.label === '30%', JSON.stringify(a30))
  await setRange('.gal-settings .gal-set-row:nth-child(1) input', 0); await sleep(150)
  const a00 = await alpha()
  check('调到 0%：完全透明（文字仍在，有字影）', a00.a === 0 && a00.clear && (await pg.$eval('.gal-text', (e) => e.textContent.length)) > 0, JSON.stringify(a00))
  await setRange('.gal-settings .gal-set-row:nth-child(1) input', 100); await sleep(150)
  const a100 = await alpha()
  check('调到 100%：不透明，字影去掉', a100.a === 1 && !a100.clear, JSON.stringify(a100))
  await setRange('.gal-settings .gal-set-row:nth-child(1) input', 50); await sleep(150)
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
  await pg.goto(link(A2, unitsA[0])); await pg.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('早上好'), null, { timeout: 8000 })
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
  await pg.route(/\/resource\?path=.*voice.*v_1\.wav/i, (r) => r.fulfill({ status: 404, body: 'nope' }))
  await sleep(1500); await resetA()   // 等进度保存的防抖落盘后清零：刷新会从上次进度续播，这里要从头来
  await pg.reload(); await pg.waitForFunction(() => /\/ 6$/.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 8000 }); await sleep(600)
  await goStep(2, 6); await sleep(400)
  await pg.keyboard.press('Space'); await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '3 / 6'); await pg.keyboard.press('a')
  await pg.waitForFunction(() => document.querySelector('.gal-count')?.textContent === '4 / 6', null, { timeout: 14000 }).catch(() => {})
  check('语音文件缺失：自动播放不会卡住，退回按台词长度估时继续前进', (await cnt()) === '4 / 6', await cnt())
  await pg.keyboard.press('a')
  await pg.unroute(/\/resource\?path=.*voice.*v_1\.wav/i)

  // ---- 上话/下话/返回（沉浸里的按钮）、F 全屏、退出沉浸并记住 ----
  await pg.unroute(/\/resource\?path=.*voice.*v_1\.wav/i).catch(() => {})
  await sleep(1500); await resetA()   // 等进度保存的防抖落盘后清零
  await pg.goto(link(A2, unitsA[0])); await pg.reload()   // 同一个 URL（只差 hash）goto 不会重新加载，所以补一次 reload 从头开始
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
