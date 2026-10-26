#!/usr/bin/env node
// 浏览器自测：Gal 列表上的「随机语音」🎲（卡片 / 目录卡片 / 工具栏）：点了出声但不打开、同一个 Audio、再点停止、放完复位、提示条、
// 过滤（白 / 黑名单正则，存 localStorage，刷新还在，非法的不发请求）、过滤光 / 没语音的错误提示、键盘可用、音量曲线。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-voice-selftest.mjs        （端口 8163）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileVoiceRegex } from '../../web/library/gal/voice.mjs'
import { regexProblem, voiceGain } from '../../web/static/gal-voice.js'
import { createGalHandler } from '../../web/library/types/gal.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

// ---------- 前端的正则校验和后端一致（两边各写了一份）+ 音量曲线 ----------
{
  const samples = ['', 'voice_\\d+', '(a+)+', '(\\w*)*', '(a{1,9}){1,9}', '(ab)+', '(a|b)+', '[(]a+[)]+', '(a{2})+', '(unclosed', '[', '(a)\\1', '(?<n>a)\\k<n>', 'x'.repeat(200), 'x'.repeat(201), '^(?:foo|bar)_\\d{2,3}$', 'a**', '(?:x+)*y']
  const diff = samples.filter((s) => Boolean(regexProblem(s)) !== (() => { try { compileVoiceRegex(s); return false } catch { return true } })())
  check('前端 regexProblem 和后端 compileVoiceRegex 对同一批写法的接受 / 拒绝完全一致', diff.length === 0, J(diff))
  check('音量曲线 gain = p²（0.5 → 0.25，0 → 0，1 → 1，越界 / 非数夹到 0–1 / 默认 1）', voiceGain(0.5) === 0.25 && voiceGain(0) === 0 && voiceGain(1) === 1 && voiceGain(7) === 1 && voiceGain(-1) === 0 && voiceGain('abc') === 1)
}

// ---------- fixture：UViewer 目录（默认配置就能浏览）+ 1.5 秒的静音 wav ----------
function wav(seconds) {
  const rate = 8000
  const samples = Math.floor(rate * seconds)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + samples * 2, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(samples * 2, 40)
  return Buffer.concat([head, Buffer.alloc(samples * 2)])
}
const work = await mkdtemp(path.join(os.tmpdir(), 'fe-voice-'))
const dataDir = path.join(work, 'data')
const media = path.join(dataDir, 'gal', 'voice-demo')
const text = path.join(media, 'resources/download/adv/text')
const voiceDir = path.join(media, 'resources/download/voice')
const script = (lines) => lines.flatMap(([name, line, voice]) => [`name,${name}`, `msg,0,${line}`, ...(voice ? [`playvoice,0,download/voice/${voice}`] : []), 'clickwait']).join('\n')
for (const dir of ['alice', 'bob', 'quiet']) await mkdir(path.join(text, dir), { recursive: true })
await mkdir(voiceDir, { recursive: true })
for (const f of ['intro_1', 'alice_1', 'alice_2', 'bob_1', 'bob_2']) await writeFile(path.join(voiceDir, `${f}.wav`), wav(1.5))
await writeFile(path.join(text, 'intro.txt'), script([['Narrator', '开场白。', 'intro_1.wav']]))
await writeFile(path.join(text, 'alice', 'a1.txt'), script([['Alice', '你好，我是爱丽丝。', 'alice_1.wav'], ['Alice', '今天天气不错。', 'alice_2.wav']]))
await writeFile(path.join(text, 'bob', 'b1.txt'), script([['Bob', 'Bob speaking here.', 'bob_1.wav'], ['Bob', 'Second bob line.', 'bob_2.wav']]))
await writeFile(path.join(text, 'quiet', 'q1.txt'), script([['Quiet', '没有语音的台词。', '']]))
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })
const imp = await handler.importFromSource({ sourcePath: media, options: { adapters: ['uviewer-csv'] } })
const itemId = imp.items[0].itemId

const port = 8163
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch { /* 空闲 */ }
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // 观察 Audio：记录每个被 play() 的元素（src / 音量），不替换行为
  await page.addInitScript(() => {
    window.__plays = []
    window.__audios = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...args) { window.__plays.push({ src: this.src, volume: this.volume }); if (!window.__audios.includes(this)) window.__audios.push(this); return play.apply(this, args) }
  })
  const requests = []
  page.on('request', (r) => { if (r.url().includes('/random-voice')) requests.push(decodeURIComponent(r.url())) })
  const home = `${base}/#/media/gal/${itemId}/main?section=`
  await page.goto(home)
  await page.waitForSelector('.gal-card')
  const home0 = page.url()   // 页面把地址规整后的样子
  const titles = await page.$$eval('.gal-card', (es) => es.map((e) => e.dataset.title))
  check('首页：目录卡片 alice / bob / quiet + 脚本卡片 intro', J(titles) === J(['alice', 'bob', 'quiet', 'intro']), J(titles))
  const dice = await page.$$eval('.gal-card .gal-card-voice', (es) => es.map((e) => [e.closest('.gal-card').dataset.title, e.getAttribute('role'), e.tabIndex, e.title, e.getAttribute('aria-label')]))
  check('每张卡片（目录 + 脚本）都有 🎲：role=button、可聚焦、有 title / aria-label 提示', dice.length === 4 && dice.every(([, role, tab, title, label]) => role === 'button' && tab === 0 && /随机/.test(title) && label === title), J(dice))
  const cardDice = (title) => page.locator(`.gal-card[data-title="${title}"] .gal-card-voice`)
  const toast = () => page.locator('.gal-voice-toast')
  const state = () => page.evaluate(() => ({ plays: window.__plays.length, playing: window.__audios.filter((a) => !a.paused && !a.ended).length, last: window.__plays.at(-1) || null }))
  const waitIdle = async () => { for (let i = 0; i < 30; i++) { if (!(await state()).playing) return; await sleep(200) } }
  const hoverVisible = async (title) => { await page.hover(`.gal-card[data-title="${title}"]`); return page.evaluate((t) => Number(getComputedStyle(document.querySelector(`.gal-card[data-title="${t}"] .gal-card-voice`)).opacity), title) }
  check('卡片上的 🎲 平时隐藏、鼠标移到卡片上才显示', (await page.evaluate(() => Number(getComputedStyle(document.querySelector('.gal-card .gal-card-voice')).opacity))) === 0 && (await hoverVisible('alice')) === 1)

  // ---- 脚本卡片：点 🎲 出声，不打开 ----
  await cardDice('intro').click()
  await page.waitForFunction(() => window.__plays.length >= 1)
  let s = await state()
  check('点脚本卡片的 🎲：开始播放这个脚本的语音（resource 接口地址 + intro_1.wav）、没有打开脚本（列表还在、地址没变）', s.plays === 1 && /\/resource\?path=download%2Fvoice%2Fintro_1\.wav/.test(s.last.src) && (await page.locator('.gal-browse').count()) === 1 && (await page.locator('.gal-player').count()) === 0 && page.url() === home0, J([s, page.url()]))
  await toast().waitFor({ state: 'visible' })
  const t1 = await toast().textContent()
  check('提示条：脚本标题 · 说话人：台词 · x / total', /intro/.test(t1) && /Narrator：开场白。/.test(t1) && /1 \/ 1/.test(t1), t1)
  check('播放中按钮变成 ⏹、aria-pressed=true；播放中的这个 Audio 音量 = 默认 1', (await cardDice('intro').textContent()) === '⏹' && (await cardDice('intro').getAttribute('aria-pressed')) === 'true' && s.last.volume === 1, J(s))
  // 再点同一个 = 停止
  await cardDice('intro').click()
  s = await state()
  check('再点同一张卡片的 🎲：停止（没有在播的 Audio、按钮复位成 🎲、没有多发一次请求）', s.playing === 0 && (await cardDice('intro').textContent()) === '🎲' && requests.length === 1, J([s, requests.length]))
  // 放完复位
  await cardDice('intro').click()
  await page.waitForFunction(() => window.__plays.length >= 2)
  await page.waitForFunction(() => window.__audios.every((a) => a.paused || a.ended), null, { timeout: 6000 })
  await sleep(300)
  check('放完（ended）：按钮自动复位成 🎲', (await cardDice('intro').textContent()) === '🎲' && (await cardDice('intro').getAttribute('aria-pressed')) === 'false')

  // ---- 目录卡片：不打开目录就放里面的语音；同一时间只有一个 Audio ----
  await cardDice('alice').click()
  await page.waitForFunction(() => window.__plays.length >= 3)
  s = await state()
  check('目录卡片 🎲：放 alice 目录里的语音（alice_1 / alice_2），没有进入目录', /alice_[12]\.wav/.test(decodeURIComponent(s.last.src)) && (await page.locator('.gal-card[data-title="bob"]').count()) === 1 && page.url() === home0, J([s.last, page.url()]))
  await cardDice('bob').click()
  await page.waitForFunction(() => window.__plays.length >= 4)
  s = await state()
  check('点另一张卡片：前一个先停，同一时间只有一个 Audio 在放；前一张的按钮复位、新的 ⏹', s.playing === 1 && (await cardDice('alice').textContent()) === '🎲' && (await cardDice('bob').textContent()) === '⏹' && /bob_[12]\.wav/.test(decodeURIComponent(s.last.src)), J(s))
  await cardDice('bob').click()
  await waitIdle()

  // ---- 音量：和播放器共用 seVolume，增益 = p² ----
  await page.evaluate(() => localStorage.setItem('copymanga.gal.seVolume', '0.5'))
  await cardDice('intro').click()
  await page.waitForFunction(() => window.__plays.length >= 5)
  s = await state()
  check('音量：localStorage copymanga.gal.seVolume = 0.5 → Audio.volume = 0.25（p²）', Math.abs(s.last.volume - 0.25) < 1e-9, J(s.last))
  await cardDice('intro').click()
  await page.evaluate(() => localStorage.removeItem('copymanga.gal.seVolume'))

  // ---- 没有语音的目录：非阻塞的错误提示 ----
  const before = (await state()).plays
  await cardDice('quiet').click()
  await page.waitForFunction(() => /没有语音/.test(document.querySelector('.gal-voice-toast')?.textContent || ''))
  check('没有语音的目录：提示「没有语音」（红色错误条），没有出声，按钮不卡在加载态', (await toast().getAttribute('class')).includes('is-error') && (await state()).plays === before && (await cardDice('quiet').getAttribute('aria-busy')) === 'false', await toast().textContent())

  // ---- 键盘：聚焦 🎲 回车触发，不会打开卡片 ----
  await cardDice('intro').focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction((n) => window.__plays.length >= n + 1, before)
  check('键盘：聚焦 🎲 按回车 = 点击（出声、没有打开脚本）', (await page.locator('.gal-player').count()) === 0 && page.url() === home0)
  await cardDice('intro').click()
  await waitIdle()

  // ---- 过滤 UI ----
  await page.hover('.gal-browse-bar-hot').catch(() => {})
  const filterBtn = page.locator('.gal-voice-filter-btn')
  await filterBtn.click({ force: true })
  const popover = page.locator('.gal-voice-filter')
  check('工具栏有「随机语音」按钮和「过滤」弹层；弹层有白名单 / 黑名单 / 匹配对象', (await page.locator('.gal-voice-list-btn').count()) === 1 && await popover.isVisible() && (await popover.locator('input').count()) === 2 && (await popover.locator('select option').allTextContents()).join() === '路径,说话人,台词')
  if (process.env.SHOT_DIR) { await mkdir(process.env.SHOT_DIR, { recursive: true }); await page.hover('.gal-card[data-title="alice"]'); await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'voice-filter.png') }) }
  const include = popover.locator('input').nth(0)
  const exclude = popover.locator('input').nth(1)
  // 非法正则：红框 + 提示 + 不保存 + 点了不发请求
  await include.fill('(a+)+')
  const invalidStatus = await popover.locator('.gal-voice-status').textContent()
  check('非法 / 危险的正则：输入框标红、给出原因、不保存', (await include.getAttribute('class')).includes('is-invalid') && /量词套量词/.test(invalidStatus) && (await page.evaluate(() => localStorage.getItem('copymanga.gal.voiceInclude'))) === null, invalidStatus)
  await include.fill('(unclosed')
  check('语法错误的正则：提示不合法', /不是合法的正则/.test(await popover.locator('.gal-voice-status').textContent()))
  const reqBefore = requests.length
  await page.locator('.gal-voice-list-btn').click({ force: true })
  await sleep(300)
  check('库里没存非法值；点工具栏 🎲 时用的是上一次合法（这里是空）的过滤，正常发请求并出声', requests.length === reqBefore + 1 && !/include=/.test(requests.at(-1)) && (await state()).plays > before)
  await page.locator('.gal-voice-list-btn').click({ force: true })   // 再点 = 停
  await waitIdle()
  // 合法白名单：只放 bob；存 localStorage；刷新还在
  await include.fill('^download/voice/bob_')
  check('合法正则：提示已保存、写进 localStorage（copymanga.gal.voiceInclude）', /已保存/.test(await popover.locator('.gal-voice-status').textContent()) && (await page.evaluate(() => localStorage.getItem('copymanga.gal.voiceInclude'))) === '^download/voice/bob_')
  const seen = new Set()
  for (let i = 0; i < 6; i++) {
    await page.locator('.gal-voice-list-btn').click({ force: true })
    await page.waitForFunction((n) => window.__plays.length > n, (await state()).plays)
    seen.add(decodeURIComponent((await state()).last.src).match(/voice\/(\w+)\.wav/)?.[1])
    await page.locator('.gal-voice-list-btn').click({ force: true })   // 停
  }
  check('白名单生效：工具栏 🎲 反复点，只会放 bob_1 / bob_2（整个当前列表里随机，但被白名单限制）', [...seen].every((x) => /^bob_[12]$/.test(x)) && seen.size >= 1, J([...seen]))
  check('请求带了 include 参数（用户填的原样）', requests.some((r) => /include=\^download\/voice\/bob_/.test(r)))
  // 黑名单叠加：排除 bob_1
  await exclude.fill('bob_1')
  const seen2 = new Set()
  for (let i = 0; i < 5; i++) {
    await page.locator('.gal-voice-list-btn').click({ force: true })
    await page.waitForFunction((n) => window.__plays.length > n, (await state()).plays)
    seen2.add(decodeURIComponent((await state()).last.src).match(/voice\/(\w+)\.wav/)?.[1])
    await page.locator('.gal-voice-list-btn').click({ force: true })
  }
  check('白名单 + 黑名单：只剩 bob_2', J([...seen2]) === J(['bob_2']), J([...seen2]))
  // 全被过滤
  await include.fill('nothing_matches_this')
  await page.locator('.gal-voice-list-btn').click({ force: true })
  await page.waitForFunction(() => /过滤/.test(document.querySelector('.gal-voice-toast')?.textContent || ''))
  check('过滤到一条都不剩：提示「都被白名单 / 黑名单过滤掉了」（非阻塞、可见、红色）', (await toast().getAttribute('class')).includes('is-error') && (await toast().isVisible()), await toast().textContent())
  // 匹配说话人
  await include.fill('^Alice$')
  await exclude.fill('')
  await popover.locator('select').selectOption('speaker')
  const seen3 = new Set()
  for (let i = 0; i < 4; i++) {
    await page.locator('.gal-voice-list-btn').click({ force: true })
    await page.waitForFunction((n) => window.__plays.length > n, (await state()).plays)
    seen3.add(decodeURIComponent((await state()).last.src).match(/voice\/(\w+)\.wav/)?.[1])
    await page.locator('.gal-voice-list-btn').click({ force: true })
  }
  check('匹配对象 = 说话人：白名单 ^Alice$ 只放 Alice 的语音；target 存进 localStorage', [...seen3].every((x) => /^alice_[12]$/.test(x)) && (await page.evaluate(() => localStorage.getItem('copymanga.gal.voiceTarget'))) === 'speaker' && requests.some((r) => /target=speaker/.test(r)), J([...seen3]))
  // 刷新还在
  await page.reload()
  await page.waitForSelector('.gal-card')
  await page.locator('.gal-voice-filter-btn').click({ force: true })
  const restored = await page.evaluate(() => [...document.querySelectorAll('.gal-voice-filter input')].map((i) => i.value).concat(document.querySelector('.gal-voice-filter select').value))
  check('刷新页面后过滤设置还在（白名单 / 黑名单 / 匹配对象）', J(restored) === J(['^Alice$', '', 'speaker']), J(restored))
  // 清空
  await page.locator('.gal-voice-filter .gal-pager-btn').click()
  check('清空：三项都回到默认并从 localStorage 清掉', await page.evaluate(() => localStorage.getItem('copymanga.gal.voiceInclude') === null && localStorage.getItem('copymanga.gal.voiceTarget') === null))
  check('整个过程没有页面脚本错误', errors.length === 0, errors.join('; '))
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
