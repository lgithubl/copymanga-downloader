#!/usr/bin/env node
// 连续朗读流程自测（模拟 GSV + 真实服务端 + 真实浏览器）：
//   - 整章没有文字（插画章）：停留「无文字章停留」秒数后自动翻到下一章接着读，停留时控制条有提示
//   - 停留期间点「朗读」（暂停）会取消翻章；停留设成 0 直接翻
//   - 下一章预加载：本章排完后提前生成下一章开头几句（跳过没文字的章），真翻过去时已经在缓存里
//   - 读完最后一章不翻进「图片集」（全书插图汇总的虚拟章节）
//
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/epub-tts-flow-selftest.mjs <站点地址>
// 会改站点配置里的 epubTtsApiBase（指向本脚本起的模拟 GSV，结束时改回原值），并导入一本测试 EPUB。需要 python3。
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const BASE = (process.argv[2] || '').replace(/\/$/, '')
if (!BASE) { console.error('用法: epub-tts-flow-selftest.mjs <站点地址>'); process.exit(2) }

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (p, init = {}) => { const r = await fetch(BASE + p, init); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
const postJson = (p, v) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J(v) })

// ---- 模拟 GSV：每句 0.4 秒正弦波；记下每次合成请求的文本和时间 ----
function wav(seconds) {
  const sr = 16000, n = Math.round(sr * seconds), buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2)
  return buf
}
const WAV = wav(0.4)
const gsvCalls = []
let counter = 0
const gsv = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (req.method === 'POST' && req.url === '/tts/batched') {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    gsvCalls.push({ t: Date.now(), texts: body.texts })
    await sleep(150)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(J({ success: true, filenames: body.texts.map(() => `f${++counter}.wav`), subtitles: body.texts.map((t) => [{ text: t, start: 0, end: 0.4 }]) }))
    return
  }
  if (req.method === 'GET' && req.url.startsWith('/audio/')) { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(WAV); return }
  res.writeHead(404); res.end()
})
await new Promise((r) => gsv.listen(0, '127.0.0.1', r))

const originalConfig = await api('/api/config')
await postJson('/api/config', { epubTtsApiBase: `http://127.0.0.1:${gsv.address().port}` })

// ---- 测试 EPUB：甲（有字）→ 乙（只有插图）→ 丙（有字）；带图片资源，所以末尾会多出「图片集」 ----
const RUN = Math.random().toString(36).slice(2, 6)   // 每次的句子都不一样，避开上次的朗读缓存
const work = await mkdtemp(path.join(os.tmpdir(), 'tts-flow-'))
const dir = path.join(work, 'e')
await mkdir(path.join(dir, 'META-INF'), { recursive: true })
await mkdir(path.join(dir, 'OEBPS'), { recursive: true })
await writeFile(path.join(dir, 'mimetype'), 'application/epub+zip')
await writeFile(path.join(dir, 'META-INF/container.xml'), '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
await writeFile(path.join(dir, 'OEBPS/content.opf'), `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">flow-${RUN}</dc:identifier><dc:title>朗读流程${RUN}</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="img" href="i.png" media-type="image/png"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>`)
const chapter = (title, body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`
const A = [`甲一${RUN}。`, `甲二${RUN}。`]
const C = [`丙一${RUN}。`, `丙二${RUN}。`]
await writeFile(path.join(dir, 'OEBPS/a.xhtml'), chapter('甲', A.map((t) => `<p>${t}</p>`).join('')))
await writeFile(path.join(dir, 'OEBPS/b.xhtml'), chapter('乙', '<div><img src="i.png" alt=""/></div>'))
await writeFile(path.join(dir, 'OEBPS/c.xhtml'), chapter('丙', C.map((t) => `<p>${t}</p>`).join('')))
await writeFile(path.join(dir, 'OEBPS/i.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
execFileSync('python3', ['-I', '-c', 'import sys,zipfile,os\nsrc,out=sys.argv[1],sys.argv[2]\nz=zipfile.ZipFile(out,"w")\nz.write(os.path.join(src,"mimetype"),"mimetype",zipfile.ZIP_STORED)\nfor d,_,fs in os.walk(src):\n  for f in fs:\n    p=os.path.join(d,f); r=os.path.relpath(p,src)\n    if r!="mimetype": z.write(p,r,zipfile.ZIP_DEFLATED)\nz.close()', dir, path.join(work, 'f.epub')])
const form = new FormData()
form.set('importProfile', 'text-media')
form.append('file', new Blob([await readFile(path.join(work, 'f.epub'))]), `朗读流程${RUN}.epub`)
const item = await api('/api/library/items?type=media', { method: 'POST', body: form })
const unit = (await api(`/api/library/items/media/${item.itemId}/units`))[0]
const reader = await api(`/api/library/items/media/${item.itemId}/reader/${unit.unitId}`)
const sections = reader.sections || []
check('准备：测试 EPUB 有 甲 / 乙 / 丙 三章 + 末尾的「图片集」', sections.length === 4 && sections[3].type === 'gallery', J(sections.map((s) => [s.title, s.type])))

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  const runReading = async ({ dwell, pauseDuringDwell = false, waitMs }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const chunkMap = new Map()   // 音频文件名（hash） -> 句子文本
    const prefetch = []          // { t, texts }：浏览器发出的 tts-chunk 请求
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/tts-chunk$/.test(r.url())) { try { prefetch.push({ t: Date.now(), texts: JSON.parse(r.postData() || '{}').texts || [] }) } catch { /* 忽略 */ } }
    })
    page.on('response', async (r) => {
      if (r.request().method() !== 'POST' || !/\/tts-chunk$/.test(r.url())) return
      try {
        const texts = JSON.parse(r.request().postData() || '{}').texts || []
        for (const chunk of (await r.json()).chunks || []) if (chunk.url) chunkMap.set(chunk.url.split('/').pop(), texts[chunk.index])
      } catch { /* 忽略 */ }
    })
    await page.addInitScript(() => {
      window.__log = []
      const Native = window.Audio
      window.Audio = function (src) {
        const a = new Native(src)
        const file = String(src).split('/').pop().split('?')[0]
        window.__log.push({ t: Date.now(), ev: 'new', file })
        a.addEventListener('ended', () => window.__log.push({ t: Date.now(), ev: 'ended', file }))
        return a
      }
      window.Audio.prototype = Native.prototype
      // 朗读状态提示的变化（「本章没有文字…」）
      new MutationObserver(() => {
        const el = document.querySelector('.epub-tts-status')
        const text = el && !el.hidden ? el.textContent : ''
        if (text !== window.__lastStatus) { window.__lastStatus = text; window.__log.push({ t: Date.now(), ev: 'status', text }) }
      }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
    })
    await page.goto(`${BASE}/`)
    await page.evaluate((d) => { localStorage.setItem('copymanga.immersivePref', '{"html":true}'); localStorage.setItem('copymanga.epubTtsEmptyDwell', String(d)) }, dwell)
    await page.goto('about:blank')
    await page.goto(`${BASE}/#/media/media/${item.itemId}/${unit.unitId}?section=${encodeURIComponent(sections[0].sectionId)}`)
    await page.waitForSelector('.epub-bar .epub-tts-toggle', { state: 'attached', timeout: 20000 })
    await sleep(800)
    await page.click('.epub-bar .epub-tts-toggle', { force: true })
    if (pauseDuringDwell) {
      await page.waitForFunction(() => /没有文字/.test(document.querySelector('.epub-tts-status')?.textContent || ''), null, { timeout: 15000 })
      await page.click('.epub-bar .epub-tts-toggle', { force: true })
    }
    await sleep(waitMs)
    const log = await page.evaluate(() => window.__log)
    const state = await page.evaluate(() => ({
      section: document.querySelector('#media-section-select')?.value,
      html: document.querySelector('#media-reader-content')?.classList.contains('media-html'),
      playing: document.querySelector('.epub-bar .epub-tts-toggle')?.classList.contains('active'),
      status: document.querySelector('.epub-tts-status')?.hidden === false ? document.querySelector('.epub-tts-status').textContent : '',
    }))
    await page.close()
    const spoken = log.filter((e) => e.ev === 'new').map((e) => ({ ...e, text: chunkMap.get(e.file) }))
    return { log, spoken, state, prefetch, errors }
  }

  // ---- 停留 1 秒：完整读一遍 ----
  {
    const r = await runReading({ dwell: 1, waitMs: 9000 })
    const order = r.spoken.map((e) => e.text)
    check('朗读顺序：甲一 → 甲二 → （跳过没有文字的乙）→ 丙一 → 丙二', J(order) === J([...A, ...C]), J(order))
    const a2End = r.log.find((e) => e.ev === 'ended' && r.spoken.find((s) => s.file === e.file)?.text === A[1])
    const c1New = r.spoken.find((e) => e.text === C[0])
    const gap = a2End && c1New ? c1New.t - a2End.t : -1
    check('没有文字的乙章停留约 1 秒才翻到丙（不是卡住，也不是一闪而过）', gap >= 900 && gap < 4000, `${gap}ms`)
    check('停留时控制条提示「本章没有文字，1 秒后继续」，翻过去后提示消失', r.log.some((e) => e.ev === 'status' && /本章没有文字，1 秒后继续/.test(e.text)) && !r.state.status, J(r.log.filter((e) => e.ev === 'status')))
    const firstC = r.prefetch.find((p) => p.texts.includes(C[0]))
    const a1End = r.log.find((e) => e.ev === 'ended')
    check('预加载：丙章开头的句子在读甲章时就提前请求了（跳过了没文字的乙）', Boolean(firstC && a1End && firstC.t < a1End.t), J({ firstC: firstC?.t, a1End: a1End?.t }))
    check('预加载：丙章的句子在 GSV 只合成一次（翻过去时命中缓存，不再现生成）', gsvCalls.flatMap((c) => c.texts).filter((t) => t === C[0]).length === 1, J(gsvCalls.map((c) => c.texts)))
    check('读完最后一章停在丙，不翻进「图片集」；朗读结束', r.state.section === sections[2].sectionId && r.state.html && !r.state.playing, J(r.state))
    check('没有页面脚本错误', r.errors.length === 0, r.errors.join(' | '))
  }

  // ---- 停留期间暂停：不再翻章 ----
  {
    const r = await runReading({ dwell: 3, pauseDuringDwell: true, waitMs: 4500 })
    check('停留期间点「朗读」暂停：留在乙章，不再翻到丙，提示消失', r.state.section === sections[1].sectionId && !r.state.playing && !r.state.status && !r.spoken.some((e) => C.includes(e.text)), J({ state: r.state, spoken: r.spoken.map((e) => e.text) }))
  }

  // ---- 停留 0：直接翻 ----
  {
    const r = await runReading({ dwell: 0, waitMs: 6000 })
    const a2End = r.log.find((e) => e.ev === 'ended' && r.spoken.find((s) => s.file === e.file)?.text === A[1])
    const c1New = r.spoken.find((e) => e.text === C[0])
    const gap = a2End && c1New ? c1New.t - a2End.t : -1
    check('停留设成 0：不停留、不显示提示，直接翻到丙接着读', gap >= 0 && gap < 900 && !r.log.some((e) => e.ev === 'status' && e.text), `${gap}ms ${J(r.log.filter((e) => e.ev === 'status'))}`)
  }
} finally {
  await browser.close()
  await postJson('/api/config', { epubTtsApiBase: originalConfig?.epubTtsApiBase || '' })
  gsv.close()
  await rm(work, { recursive: true, force: true }).catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
