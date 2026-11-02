#!/usr/bin/env node
// 浏览器自测：Gal 播放器的朗读（TTS）——原文先显示不被合成阻塞 / 预加载窗口 + 服务端并发 + 按说话人选音色 / 自动播放等朗读播完 / 阻塞最大 N 秒 / 读译文 / 开关记住
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-tts-selftest.mjs     端口 8163（应用）
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

// ---- 假 GSV-TTS-Lite：POST /tts/batched → { success, filenames, subtitles }；GET /audio/<name> → 2 秒静音 wav ----
const wav = (() => {
  const rate = 8000
  const data = Buffer.alloc(rate * 2 * 2)   // 2 秒 16 位单声道
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
})()
const gsv = { delay: 100, calls: [], inFlight: 0, peak: 0, n: 0 }
const gsvServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/audio/')) { res.setHeader('content-type', 'audio/wav'); res.end(wav); return }
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', async () => {
    const b = JSON.parse(body)
    if (process.env.DEBUG_AUDIO) console.log('GSV', Date.now() % 100000, J(b.texts))
    gsv.calls.push({ texts: b.texts, voice: b.speaker_audio || '', lang: b.text_language || '', at: Date.now() })
    gsv.inFlight += 1
    gsv.peak = Math.max(gsv.peak, gsv.inFlight)
    await sleep(gsv.delay)
    gsv.inFlight -= 1
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ success: true, filenames: b.texts.map(() => `f${++gsv.n}.wav`), subtitles: b.texts.map((t) => [{ text: t }]) }))
  })
})
await new Promise((resolve) => gsvServer.listen(0, '127.0.0.1', resolve))
// ---- 假翻译模型（OpenAI 兼容）----
const llmServer = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    const last = JSON.parse(body).messages.at(-1).content.split('\n').at(-1)
    const texts = last.startsWith('[') ? JSON.parse(last) : [last]
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: last.startsWith('[') ? J(texts.map((t) => `译:${t}`)) : `译:${texts[0]}` } }] }))
  })
})
await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve))

// ---- 夹具 ----
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-tts-'))
const media = path.join(dataDir, 'gal', '朗读演示')
const T = (...p) => path.join(media, 'resources', 'download', 'adv', 'text', ...p)
await mkdir(T('cabin', 'adultr'), { recursive: true })
await mkdir(path.join(media, 'user_data'), { recursive: true })
await writeFile(path.join(media, 'UViewer.exe'), 'MZ')
await writeFile(path.join(media, 'start.bat'), '@echo off\nstart UViewer.exe\n')
await writeFile(path.join(media, 'user_data', 'settings.json'), J({ resource_path: './resources', script_language: 'zh', text_size: 18 }))
const msg = (who, text) => `name,${who},\nmsg,0,${text},,,,,,,,,\nclickwait,,,,,,,,,,,\n`
const script = (prefix, n) => 'bg,color_20_60_40,0,,,,,,,,\n' + Array.from({ length: n }, (_, i) => msg(i % 2 ? '旁白' : '小夜', `${prefix}${i + 1}`)).join('')
await writeFile(T('cabin/adultr/800100.txt'), script('甲', 30))   // 预加载 / 音色
await writeFile(T('cabin/adultr/800200.txt'), script('乙', 6))    // 慢 GSV：原文不被阻塞
await writeFile(T('cabin/adultr/800300.txt'), script('丙', 6))    // 自动播放等朗读播完
await writeFile(T('cabin/adultr/800400.txt'), script('丁', 6))    // 阻塞超时
await writeFile(T('cabin/adultr/800500.txt'), script('戊', 6))    // 读译文

const port = 8163
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const cfg = await (await fetch(`${base}/api/config`)).json()
  await fetch(`${base}/api/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ ...cfg, galTtsEnabled: true, epubTtsApiBase: `http://127.0.0.1:${gsvServer.address().port}`, epubTtsSpeakerAudio: 'default.wav', galTtsRules: [{ match: '^小夜$', speaker_audio: 'sayo.wav' }], galTtsLookahead: 4, epubTtsMaxConcurrency: 1, epubTtsBatchMaxSentences: 2, galTranslateEnabled: true, galTranslateApiBase: `http://127.0.0.1:${llmServer.address().port}`, galTranslateLookahead: 6, galTranslateRetryCount: 0, galTranslateSourceLanguage: 'ja', galTranslateTargetLanguage: 'zh' }) })
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
  await ctx.addInitScript(() => { window.__audio = []; const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function (...a) { const rec = { src: String(this.src).slice(-20), at: Date.now() }; window.__audio.push(rec); this.addEventListener('ended', () => { rec.ended = Date.now() }); return play.apply(this, a) } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  const wavRequests = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  if (process.env.DEBUG_AUDIO) page.on('response', async (r) => { if (/\/api\/gal\/tts$/.test(r.url())) console.log('tts resp', Date.now() % 100000, r.status(), J(r.request().postDataJSON()).slice(0, 200), (await r.text().catch(() => '')).slice(0, 200)) })
  if (process.env.DEBUG_AUDIO) page.on('request', (r) => { if (/\/api\/gal\/(tts|translate)$/.test(r.url())) console.log('REQ', Date.now() % 100000, r.url().slice(-14), J(r.postDataJSON()).slice(0, 150)) })
  page.on('request', (r) => { if (/\/api\/gal\/tts\/[0-9a-f]{40}\.wav/.test(r.url())) wavRequests.push(Date.now()) })
  const cnt = () => page.$eval('.gal-count', (e) => e.textContent).catch(() => '')
  const text = () => page.$eval('.gal-text', (e) => e.textContent).catch(() => '')
  const open = async (rel) => { await reset(rel); await page.goto(`${base}/health`); await page.goto(link(rel)); await page.waitForSelector('.gal-player .gal-stage'); await page.waitForFunction(() => /^1 \//.test(document.querySelector('.gal-count')?.textContent || '')); await sleep(400) }
  const setLs = (kv) => page.evaluate((o) => { for (const [k, v] of Object.entries(o)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } }, kv)
  // 上一个场景留在 GSV 里的慢请求（并发 1：新请求要排在它后面）先等它做完，别让场景互相影响
  const idle = async () => { let seen = -1, quiet = 0; for (let i = 0; i < 1200 && quiet < 15; i++) { await sleep(100); if (gsv.inFlight || gsv.calls.length !== seen) { seen = gsv.calls.length; quiet = 0 } else quiet += 1 } }   // 连续 1.5 秒没有在途也没有新调用才算空闲（排队的批之间会有空隙）
  const clearLs = () => setLs({ 'copymanga.gal.ttsOn': null, 'copymanga.gal.translateOn': null, 'copymanga.gal.autoTranslate': null, 'copymanga.gal.ttsSource': null, 'copymanga.gal.translateBlockSec': null, 'copymanga.gal.autoVoiceDelay': '0' })

  // ---- 1. 按钮 / 音量滑块 / 设置 ----
  gsv.delay = 100
  await open('cabin/adultr/800100.txt')
  check('朗读启用后工具栏出现「朗读」按钮（默认没按下）；音频里有「朗读」音量滑块；设置里有「朗读内容」「朗读也读有语音的句子」', await page.$eval('.gal-tts-btn', (b) => !b.hidden && b.getAttribute('aria-pressed') === 'false') && await page.evaluate(() => { const g = document.querySelector('[data-audio-group="tts"]'); const rows = [...document.querySelectorAll('.gal-set-row')]; return Boolean(g) && !g.hidden && rows.some((r) => /朗读内容/.test(r.textContent) && !r.hidden) && rows.some((r) => /也读有语音/.test(r.textContent) && !r.hidden) }))
  // ---- 2. 点朗读：原文先显示；按说话人选音色；预加载窗口；并发 ----
  gsv.calls.length = 0
  await page.click('.gal-tts-btn')
  check('点朗读：原文（甲1）一直在显示；按钮按下', (await text()).includes('甲1') && await page.$eval('.gal-tts-btn', (b) => b.getAttribute('aria-pressed') === 'true'))
  await page.waitForFunction(() => true)
  await sleep(1800)
  const asked = gsv.calls.flatMap((c) => c.texts.map((t) => ({ t, voice: c.voice })))
  const names = asked.map((a) => a.t)
  check('预加载：当前句 + 往后 4 句（甲1…甲5）都合成了，甲6 以后一句都没要', ['甲1', '甲2', '甲3', '甲4', '甲5'].every((t) => names.includes(t)) && !names.some((t) => /甲([6-9]|\d\d)/.test(t)), J(names))
  check('音色：说话人「小夜」（奇数句 甲1 甲3 甲5）用 sayo.wav，「旁白」（甲2 甲4）用默认 default.wav', asked.filter((a) => ['甲1', '甲3', '甲5'].includes(a.t)).every((a) => a.voice === 'sayo.wav') && asked.filter((a) => ['甲2', '甲4'].includes(a.t)).every((a) => a.voice === 'default.wav'), J(asked))
  check('并发：同一时刻最多 1 个请求打到 GSV（峰值 ' + gsv.peak + '）；同音色才合批（每批的音色一致）', gsv.peak === 1 && gsv.calls.every((c) => c.texts.length <= 2))
  check('合成好的声音被浏览器取走播放（请求了 /api/gal/tts/<hash>.wav）', wavRequests.length >= 1, wavRequests.length)
  // 开关记住
  await page.reload(); await page.waitForSelector('.gal-player .gal-stage'); await sleep(800)
  check('刷新后「朗读」仍然是开着的', await page.$eval('.gal-tts-btn', (b) => b.getAttribute('aria-pressed') === 'true'))
  await page.click('.gal-tts-btn')
  check('再点一下关掉', await page.$eval('.gal-tts-btn', (b) => b.getAttribute('aria-pressed') === 'false'))

  // ---- 3. 原文不被慢 GSV 阻塞 ----
  await idle()
  gsv.delay = 5000
  await clearLs(); await setLs({ 'copymanga.gal.ttsOn': '1' })
  await open('cabin/adultr/800200.txt')
  const s0 = Date.now()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('乙2'))
  const showMs = Date.now() - s0
  check(`GSV 很慢（5 秒 / 批）：翻页后原文（乙2）立刻显示（${showMs}ms）——原文不被合成阻塞`, showMs < 1000, showMs)

  // ---- 4. 自动播放等朗读播完 ----
  await idle()
  gsv.delay = 100
  await clearLs(); await setLs({ 'copymanga.gal.ttsOn': '1' })
  await open('cabin/adultr/800300.txt')
  await sleep(600)   // 第 1 句的声音合成好、开始播
  const a0 = Date.now()
  await page.click('.gal-auto')
  await page.waitForFunction(() => /^2 \//.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 15000 })
  const advMs = Date.now() - a0
  const audioLog = await page.evaluate((t) => window.__audio.map((r) => ({ play: r.at - t, ended: r.ended ? r.ended - t : null })), a0)
  if (process.env.DEBUG_AUDIO) console.log('audio log', J(await page.evaluate((t) => window.__audio.map((r) => ({ src: r.src, play: r.at - t, ended: r.ended ? r.ended - t : null })), a0)))
  check(`自动播放：朗读的声音（2 秒）播完才翻页——翻页发生在第 1 段声音结束之后（声音时长 ${audioLog[0] ? audioLog[0].ended - audioLog[0].play : '?'}ms，结束于点击后 ${audioLog[0]?.ended}ms，翻页于 ${advMs}ms）`, Boolean(audioLog[0]?.ended) && audioLog[0].ended - audioLog[0].play >= 1800 && advMs >= audioLog[0].ended - 50, J([audioLog, advMs]))
  await page.click('.gal-auto')

  // ---- 5. 声音还没合成好：自动播放最多等 N 秒 ----
  await idle()
  gsv.delay = 9000
  await clearLs(); await setLs({ 'copymanga.gal.ttsOn': '1', 'copymanga.gal.translateBlockSec': '1' })
  await open('cabin/adultr/800400.txt')
  const b0 = Date.now()
  await page.click('.gal-auto')
  await page.waitForFunction(() => /^2 \//.test(document.querySelector('.gal-count')?.textContent || ''), null, { timeout: 15000 })
  const blockMs = Date.now() - b0
  check(`阻塞最大 1 秒：GSV 9 秒也不死等，约 1 秒后照常翻页（${blockMs}ms < 4s）`, blockMs < 4000 && blockMs >= 900, blockMs)
  await page.click('.gal-auto')
  gsv.delay = 100   // 场景 5 留下的排队批次别再每批 9 秒，尽快放空

  // ---- 6. 读译文：朗读文本 = 译文、语言 = 目标语言 ----
  await idle()
  if (process.env.DEBUG_AUDIO) console.log('idle done', Date.now() % 100000, gsv.inFlight, J(gsv.calls.slice(-3).map((c) => [c.texts, c.at % 100000])))
  gsv.delay = 100
  gsv.calls.length = 0
  await clearLs(); await setLs({ 'copymanga.gal.ttsOn': '1', 'copymanga.gal.translateOn': '1', 'copymanga.gal.ttsSource': 'trans' })
  await open('cabin/adultr/800500.txt')
  await sleep(2500)
  if (process.env.DEBUG_AUDIO) console.log('trans dbg', J(await page.$eval('.gal-trans', (e) => ({ hidden: e.hidden, t: e.textContent })).catch(() => null)), J(gsv.calls), J(await page.evaluate(() => [localStorage.getItem('copymanga.gal.ttsSource'), localStorage.getItem('copymanga.gal.translateOn'), localStorage.getItem('copymanga.gal.ttsOn')])))
  if (process.env.DEBUG_AUDIO) { const probe = await (await fetch(`${base}/api/gal/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ lines: [{ text: '探针', speaker: 'x' }], priority: 'now', waitMs: 3000 }) })).json(); console.log('probe', J(probe), 'gsv', gsv.inFlight, gsv.n, gsv.calls.length) }
  const trans = gsv.calls.flatMap((c) => c.texts.map((t) => ({ t, lang: c.lang })))
  check('朗读内容 = 译文：GSV 收到的是译文（译:戊1），文本语言 = 目标语言 zh；原文没有被送去合成', trans.some((x) => x.t === '译:戊1' && x.lang === 'zh') && !trans.some((x) => x.t === '戊1'), J(trans))
  check('全程没有页面错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  server.kill()
  gsvServer.close()
  llmServer.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
