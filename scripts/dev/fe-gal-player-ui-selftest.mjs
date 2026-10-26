#!/usr/bin/env node
// 浏览器自测：Gal 播放器界面——固定文本框（名牌固定、台词区固定 2 行、太长缩字号 / 滚动）、快进按钮、设置 / 更多合并的弹层、音量感知曲线。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-player-ui-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/player-ui-shots），端口 8161
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { volumeGain } from '../../web/static/gal-engine.js'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/player-ui-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

// ---- 0. 音量曲线（纯函数）----
check('volumeGain：0 → 0，1 → 1，0.5 → 0.25（p²）', volumeGain(0) === 0 && volumeGain(1) === 1 && volumeGain(0.5) === 0.25)
check('volumeGain：单调递增；越界 / 非数字被夹到 0..1', [0, 0.1, 0.3, 0.6, 1].every((p, i, a) => i === 0 || volumeGain(p) > volumeGain(a[i - 1])) && volumeGain(2) === 1 && volumeGain(-1) === 0 && volumeGain(NaN) === 0 && Math.abs(volumeGain('0.4') - 0.16) < 1e-9)
check('volumeGain：左端比线性更细（0.1 → 0.01），低位不会一下子消失', Math.abs(volumeGain(0.1) - 0.01) < 1e-9 && volumeGain(0.9) < 0.9)

// ---- 夹具：一个 uviewer-csv 目录；几个脚本 ----
const LONG = '这是一句很长很长的台词，用来测试文本框在文字太多的时候会不会自动缩小字号，让它刚好放进固定的两行高度里面去。'.repeat(1)
const LONGER = `${LONG}${LONG}`
const HUGE = LONG.repeat(14)
const rich = `<size=34><outline width=2 color=black>${LONG}</outline></size><ruby>幻夢境|げんむきょう</ruby>${LONG.slice(0, 40)}`
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-pui-'))
const media = path.join(dataDir, 'gal', 'UI演示')
const T = (...p) => path.join(media, 'resources', 'download', 'adv', 'text', ...p)
await mkdir(T('cabin', 'adultr'), { recursive: true })
await mkdir(path.join(media, 'user_data'), { recursive: true })
await writeFile(path.join(media, 'UViewer.exe'), 'MZ')
await writeFile(path.join(media, 'start.bat'), '@echo off\nstart UViewer.exe\n')
await writeFile(path.join(media, 'user_data', 'settings.json'), J({ resource_path: './resources', script_language: 'zh', text_size: 18 }))
const msg = (who, text) => `name,${who},\nmsg,0,${text},,,,,,,,,\nclickwait,,,,,,,,,,,\n`
// 600100：对话 / 旁白 / 长台词 / 带样式的长台词 / 超长台词
await writeFile(T('cabin/adultr/600100.txt'), 'bg,color_20_60_40,0,,,,,,,,\n' + [['小夜', '「早上好。」'], ['', '旁白一句。'], ['小夜', LONGER], ['小夜', rich], ['', HUGE], ['小夜', '「最后一句。」']].map(([w, t]) => msg(w, t)).join(''))
// 600200：25 句 + 选项 + 2 句（快进要停在选项上）
await writeFile(T('cabin/adultr/600200.txt'), 'bg,color_20_60_40,0,,,,,,,,\n' + Array.from({ length: 25 }, (_, i) => msg('小夜', `第${i + 1}句`)).join('') + 'select,選項1　「甲」,選項2　「乙」\nif,select_===_1,,,,,,,,,,\n' + msg('小夜', '甲的后续') + 'elseif,select_===_2,,,,,,,,,,\n' + msg('小夜', '乙的后续') + 'endif,,,,,,,,,,,\n' + msg('小夜', '合流句'))
// 600300：12 句没有选项（快进到结尾自动停）
await writeFile(T('cabin/adultr/600300.txt'), 'bg,color_20_60_40,0,,,,,,,,\n' + Array.from({ length: 12 }, (_, i) => msg('小夜', `短${i + 1}`)).join(''))

const port = 8161
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
  form.set('profileOptions', JSON.stringify({ adapters: ['uviewer-csv'] })); form.set('metadataActionIds', 'gal-layout')
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
  const open = async (rel) => { await reset(rel); await page.goto(`${base}/health`); await page.goto(link(rel)); await page.waitForSelector('.gal-player .gal-stage'); await page.waitForFunction(() => /^1 \//.test(document.querySelector('.gal-count')?.textContent || '')); await sleep(500) }
  const goto = async (n) => { for (let i = 0; i < 40 && !(await cnt()).startsWith(`${n} /`); i++) { await page.keyboard.press('Space'); await sleep(120) } }
  const R = (v) => Math.round(v * 100) / 100
  const rects = () => page.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 100) / 100) }; return { box: r('.gal-box'), name: r('.gal-name'), text: r('.gal-text') } })
  const textInfo = () => page.evaluate(() => { const t = document.querySelector('.gal-text'); const hud = parseFloat(getComputedStyle(document.querySelector('.gal-hud')).fontSize); return { fs: parseFloat(getComputedStyle(t).fontSize), hud, fit: t.style.getPropertyValue('--gal-fit'), fits: t.scrollHeight <= t.clientHeight + 1, scroll: t.classList.contains('gal-text-scroll'), overflowY: getComputedStyle(t).overflowY, nameHidden: document.querySelector('.gal-name').classList.contains('gal-name-empty'), nameVis: getComputedStyle(document.querySelector('.gal-name')).visibility } })

  // ---- 1. 文本框矩形固定 ----
  const runBox = async (label) => {
    await open('cabin/adultr/600100.txt')
    const a = { r: await rects(), i: await textInfo() }
    await page.screenshot({ path: path.join(shotDir, `${label}-a-speaker.png`) })
    await goto(2); await sleep(150)
    const b = { r: await rects(), i: await textInfo() }
    await page.screenshot({ path: path.join(shotDir, `${label}-b-narration.png`) })
    await goto(3); await sleep(150)
    const c = { r: await rects(), i: await textInfo() }
    await page.screenshot({ path: path.join(shotDir, `${label}-c-long.png`) })
    await goto(4); await sleep(150)
    const d = { r: await rects(), i: await textInfo() }
    await page.screenshot({ path: path.join(shotDir, `${label}-d-rich.png`) })
    await goto(5); await sleep(150)
    const e = { r: await rects(), i: await textInfo() }
    await page.screenshot({ path: path.join(shotDir, `${label}-e-huge.png`) })
    const same = [b, c, d, e].every((x) => J(x.r) === J(a.r))
    check(`${label}：文本框 / 名牌 / 台词区矩形在 说话人+短句 / 旁白 / 长台词 / 带样式 / 超长 之间完全一致`, same, J([a.r, b.r, c.r, d.r, e.r]))
    check(`${label}：旁白时名牌只是不可见（仍占位），说话人时可见`, b.i.nameHidden && b.i.nameVis === 'hidden' && !a.i.nameHidden && a.i.nameVis === 'visible', J([a.i, b.i]))
    check(`${label}：短句不缩字（--gal-fit 空）；长台词字号缩小、放得进台词区`, a.i.fit === '' && Math.abs(a.i.fs - a.i.hud) < 0.01 && c.i.fs < a.i.fs - 0.5 && c.i.fs >= a.i.hud * 0.6 - 0.1 && c.i.fits && !c.i.scroll, J([a.i, c.i]))
    check(`${label}：带 <size> / ruby / 描边的长台词也放得进`, d.i.fits && d.i.fs <= a.i.fs && d.i.fs >= a.i.hud * 0.6 - 0.1, J(d.i))
    check(`${label}：超长台词：保持最小字号（0.6）并可滚动`, e.i.scroll && e.i.overflowY === 'auto' && Math.abs(e.i.fs - e.i.hud * 0.6) < 0.2, J(e.i))
    return { a, c }
  }
  await runBox('1280x800')
  // 字体大小设置 150%：高度按新字号重算，仍然固定
  await page.click('.gal-cfg')
  await page.$eval('.gal-settings .gal-set-row:nth-child(1) input', (e) => { e.value = '150'; e.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.click('.gal-cfg')
  await runBox('font150')
  await page.click('.gal-cfg')
  await page.$eval('.gal-settings .gal-set-row:nth-child(1) input', (e) => { e.value = '100'; e.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.click('.gal-cfg')
  // 窗口缩小：重新适配
  await open('cabin/adultr/600100.txt'); await goto(3)
  await page.setViewportSize({ width: 700, height: 700 }); await sleep(500)
  const small = await textInfo()
  check('窗口缩小后长台词重新适配（仍放得进台词区或在滚动）', small.fits || small.scroll, J(small))
  await page.screenshot({ path: path.join(shotDir, 'resized-small.png') })
  await page.setViewportSize({ width: 1280, height: 800 }); await sleep(500)
  const back = await textInfo()
  check('窗口恢复：同一句重新适配，字号比小窗口时大、仍放得进', back.fits && back.fs > small.fs, J([small, back]))
  await open('cabin/adultr/600100.txt'); await page.setViewportSize({ width: 1920, height: 1000 }); await sleep(500)
  const wide = await rects()
  check('更大的舞台（1920x1000）：文本框仍在舞台里', await page.evaluate(() => { const s = document.querySelector('.gal-stage').getBoundingClientRect(); const b = document.querySelector('.gal-box').getBoundingClientRect(); return b.left >= s.left && b.right <= s.right && b.bottom <= s.bottom }), J(wide))
  await page.setViewportSize({ width: 1280, height: 800 })

  // ---- 2. 合并的设置弹层 ----
  await sleep(300)
  check('工具栏上只有一个「设置」按钮（没有单独的「更多」/ ⚙）', (await page.$$eval('.gal-bar .gal-btn', (bs) => bs.filter((b) => /设置|更多|⚙/.test(b.textContent)).length)) === 1 && (await page.$$('.gal-bar .gal-more-btn')).length === 1 && (await page.$$('.gal-bar .gal-cfg')).length === 1)
  check('弹层默认收起', await page.$eval('.gal-settings', (e) => e.hidden))
  await page.click('.gal-cfg')
  const pop = await page.evaluate(() => {
    const p = document.querySelector('.gal-settings')
    const q = (s) => Boolean(p.querySelector(s))
    return { shown: !p.hidden && getComputedStyle(p).display !== 'none', titles: [...p.querySelectorAll('.gal-set-section')].map((s) => s.dataset.title), font: q('.gal-set-row input[title*="字体"]'), opacity: q('.gal-set-row input[title*="透明"]'), bgm: q('.gal-set-row input[title*="BGM"]'), se: q('.gal-set-row input[title*="语音"]'), delay: q('.gal-set-number:not(.gal-set-autochoice)'), auto: q('.gal-set-autochoice'), imm: q('.gal-imm'), fs: q('.gal-fs'), slow: q('input.gal-more-number[max="1"]'), fps: q('input.gal-more-number[max="60"]'), zoom: q('input.gal-more-number[max="4"]'), center: q('.gal-center-btn'), step: p.querySelector('.gal-set-row input[title*="BGM"]')?.step, pct: p.querySelectorAll('.gal-set-row')[2]?.querySelector('.gal-set-value')?.textContent, scrollable: getComputedStyle(p).overflowY, r: (() => { const b = p.getBoundingClientRect(); const s = document.querySelector('.gal-stage').getBoundingClientRect(); return b.left >= s.left - 1 && b.right <= s.right + 1 && b.top >= 0 && b.bottom <= innerHeight })() }
  })
  check('弹层分 显示 / 音频 / 播放 / 画面 四组', J(pop.titles) === J(['显示', '音频', '播放', '画面']), J(pop.titles))
  check('弹层里有原来 ⚙ 的全部控件：字体 / 透明度 / BGM / 语音音效 / 自动等待 / 自动选择', pop.shown && pop.font && pop.opacity && pop.bgm && pop.se && pop.delay && pop.auto, J(pop))
  check('弹层里有原来「更多」的全部控件：沉浸 / 全屏 / 动画4降速 / 帧动画速度 / 画面放大 / 选择中心', pop.imm && pop.fs && pop.slow && pop.fps && pop.zoom && pop.center, J(pop))
  check('音量滑块步长 0.02、旁边有百分比；弹层在舞台宽度内、不超出窗口、可滚动', pop.step === '0.02' && /%$/.test(pop.pct || '') && pop.scrollable === 'auto' && pop.r, J(pop))
  await page.screenshot({ path: path.join(shotDir, 'popover.png') })
  const stepBefore = await cnt()
  await page.click('.gal-stage', { position: { x: 60, y: 60 } })
  check('弹层开着时点舞台：只收弹层，不翻页（first-click-closes 保持）', (await page.$eval('.gal-settings', (e) => e.hidden)) && (await cnt()) === stepBefore, await cnt())
  await page.click('.gal-cfg'); await page.keyboard.press('Escape')
  check('Esc 收弹层', await page.$eval('.gal-settings', (e) => e.hidden))
  // 音量：存的是滑块位置，百分比跟着变
  await page.click('.gal-cfg')
  await page.$eval('.gal-set-row input[title*="BGM"]', (e) => { e.value = '0.5'; e.dispatchEvent(new Event('input', { bubbles: true })) })
  const vol = await page.evaluate(() => ({ stored: localStorage.getItem('copymanga.gal.bgmVolume'), label: [...document.querySelectorAll('.gal-set-row')].find((r) => /BGM/.test(r.textContent)).querySelector('.gal-set-value').textContent }))
  check('BGM 滑块 0.5：浏览器里存滑块位置 0.5，显示 50%（实际增益 0.25）', vol.stored === '0.5' && vol.label === '50%' && volumeGain(Number(vol.stored)) === 0.25, J(vol))
  await page.click('.gal-cfg')

  // ---- 3. 快进按钮 ----
  await open('cabin/adultr/600200.txt')
  check('快进按钮在工具栏上，默认没按下', (await page.$eval('.gal-fast-btn', (b) => b.getAttribute('aria-pressed') === 'false' && !b.classList.contains('active'))))
  await page.click('.gal-fast-btn')
  check('点快进：按钮高亮（aria-pressed=true），出现「快进中」标记', await page.$eval('.gal-fast-btn', (b) => b.getAttribute('aria-pressed') === 'true' && b.classList.contains('active')) && (await page.$eval('.gal-fast-badge', (e) => !e.hidden)))
  await page.waitForFunction(() => !document.querySelector('.gal-choices')?.hidden, null, { timeout: 15000 })
  await sleep(300)
  check('快进自动翻页并停在选项上（26 / 26 之前不会越过选项）；按钮自动关掉', (await cnt()).startsWith('26 /') && await page.$eval('.gal-fast-btn', (b) => b.getAttribute('aria-pressed') === 'false' && !b.classList.contains('active')) && (await page.$eval('.gal-fast-badge', (e) => e.hidden)), await cnt())
  await page.screenshot({ path: path.join(shotDir, 'fast-choice.png') })
  const at = await cnt(); await sleep(500)
  check('停在选项后不再前进', (await cnt()) === at)
  await page.click('.gal-choice, .gal-choices button')
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('后续'))
  await page.keyboard.press('x')
  check('快捷键 X 也能开关快进', await page.$eval('.gal-fast-btn', (b) => b.classList.contains('active')))
  await page.keyboard.press('x')
  check('再按 X 关掉', await page.$eval('.gal-fast-btn', (b) => !b.classList.contains('active')))
  // 到结尾自动停
  await open('cabin/adultr/600300.txt')
  await page.click('.gal-fast-btn')
  await page.waitForFunction(() => !document.querySelector('.gal-player') || !document.querySelector('.gal-fast-btn')?.classList.contains('active'), null, { timeout: 15000 })
  await sleep(500)
  check('快进到脚本结尾：自动停（按钮关掉，或播放器已退出回列表）', !(await page.$('.gal-fast-btn.active')))
  // 按住 Ctrl 的快进仍然可用
  await open('cabin/adultr/600200.txt')
  await page.keyboard.down('Control'); await sleep(900)
  const ctrlFast = await page.$eval('.gal-player', (e) => e.classList.contains('is-fast'))
  const ctrlStep = await cnt()
  await page.keyboard.up('Control'); await sleep(200)
  check('按住 Ctrl 仍然快进（不经过按钮），松开就停', ctrlFast && !(await page.$eval('.gal-player', (e) => e.classList.contains('is-fast'))) && Number(ctrlStep.split(' ')[0]) > 2, ctrlStep)
  // 离开播放器：按钮状态不残留
  await page.click('.gal-fast-btn')
  await page.goto(`${base}/#/`); await sleep(300)
  await open('cabin/adultr/600300.txt')
  check('离开播放器再进来：快进是关着的', await page.$eval('.gal-fast-btn', (b) => !b.classList.contains('active')))

  check('全程没有页面错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  server.kill()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
