#!/usr/bin/env node
// EPUB 阅读器三个问题的自测（真实浏览器 + 真实服务端）：
//   1. 分页漂移：调过阅读宽度后，翻到后面每页的开头必须还贴着视口左边留白（原来每页多滚 2px，越翻越往左偏）
//   2. 倍速朗读句尾被吃：/tts-chunk/<hash>.wav 发出去时句尾要补一段静音（wav-pad 纯函数 + 可选的 HTTP 检查）
//   3. 续读：目录里点某本 EPUB 要回到它自己上次的章节和页码，多本互不干扰；只带 unit 的链接、换主题也一样
//
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/epub-reader-selftest.mjs <站点地址> [认证头]
//   可选 SELFTEST_DATA_DIR=<服务端的 DATA_DIR>：给了就往朗读缓存里放一个 wav，走 HTTP 验证补静音
// 会往站点里导入一个「阅读自测」文本媒体合集（两本 EPUB），并改写它的阅读进度；需要 python3 打 EPUB 的 zip。
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { padWavSilence } = await import(path.join(here, '../../web/library/wav-pad.mjs'))
const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const BASE = (process.argv[2] || '').replace(/\/$/, '')
if (!BASE) { console.error('用法: epub-reader-selftest.mjs <站点地址> [认证头]'); process.exit(2) }
const headers = {}
if (process.argv[3]) { const [k, ...v] = process.argv[3].split(':'); headers[k.trim()] = v.join(':').trim() }

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const api = async (p, init = {}) => {
  const res = await fetch(BASE + p, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, res }
}
const postJson = (p, v) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })

// ================= 2. 句尾补静音（纯函数）=================
function makeWav({ sampleRate = 24000, channels = 1, bits = 16, format = 1, frames = 2400, extensible = false, trailer = null, dataSizeField = null }) {
  const blockAlign = channels * bits / 8
  const data = Buffer.alloc(frames * blockAlign, 0x11)
  const fmtSize = extensible ? 40 : 16
  const fmt = Buffer.alloc(8 + fmtSize)
  fmt.write('fmt ', 0, 'ascii'); fmt.writeUInt32LE(fmtSize, 4)
  fmt.writeUInt16LE(extensible ? 0xfffe : format, 8); fmt.writeUInt16LE(channels, 10)
  fmt.writeUInt32LE(sampleRate, 12); fmt.writeUInt32LE(sampleRate * blockAlign, 16)
  fmt.writeUInt16LE(blockAlign, 20); fmt.writeUInt16LE(bits, 22)
  if (extensible) { fmt.writeUInt16LE(22, 24); fmt.writeUInt16LE(bits, 26); fmt.writeUInt32LE(0, 28); fmt.writeUInt16LE(format, 32) }
  const dataHead = Buffer.alloc(8); dataHead.write('data', 0, 'ascii'); dataHead.writeUInt32LE(dataSizeField ?? data.length, 4)
  const parts = [Buffer.from('RIFF\0\0\0\0WAVE', 'ascii'), fmt, dataHead, data]
  if (trailer) parts.push(trailer)
  const out = Buffer.concat(parts)
  out.writeUInt32LE(out.length - 8, 4)
  return { wav: out, data }
}
function readWav(buf) {
  let o = 12; const r = {}
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4); const size = buf.readUInt32LE(o + 4)
    if (id === 'data') { r.dataOffset = o + 8; r.dataSize = size }
    if (id === 'LIST') r.list = buf.subarray(o, o + 8 + size)
    o += 8 + size + (size % 2)
  }
  r.riffOk = buf.readUInt32LE(4) === buf.length - 8
  return r
}
{
  const { wav, data } = makeWav({})
  const out = padWavSilence(wav, 300)
  const r = readWav(out)
  const pad = 24000 * 0.3 * 2
  check('wav 补静音：16 位单声道补 300ms，data 长度和 RIFF 长度都改对', r.dataSize === data.length + pad && r.riffOk, J(r))
  check('wav 补静音：原样本不动、补的全是 0', out.subarray(r.dataOffset, r.dataOffset + data.length).equals(data) && out.subarray(r.dataOffset + data.length, r.dataOffset + r.dataSize).every((b) => b === 0))
  const u8 = padWavSilence(makeWav({ bits: 8 }).wav, 100)
  const r8 = readWav(u8)
  check('wav 补静音：8 位 PCM 的静音是 0x80', u8.subarray(r8.dataOffset + 2400, r8.dataOffset + r8.dataSize).every((b) => b === 0x80))
  const f32 = readWav(padWavSilence(makeWav({ bits: 32, format: 3, channels: 2 }).wav, 100))
  check('wav 补静音：32 位 float 双声道按 blockAlign 补', f32.dataSize === 2400 * 8 + 2400 * 8 && f32.riffOk, J(f32))
  const ext = readWav(padWavSilence(makeWav({ extensible: true }).wav, 100) || Buffer.alloc(12))
  check('wav 补静音：WAVE_FORMAT_EXTENSIBLE 包装的 PCM 也能补', ext.dataSize === 4800 + 4800, J(ext))
  const list = Buffer.from('LIST\x04\0\0\0abcd', 'latin1')
  const withList = readWav(padWavSilence(makeWav({ trailer: list }).wav, 100))
  check('wav 补静音：data 后面的 LIST 块原样保留', withList.list?.equals(list) && withList.riffOk, J(withList))
  const streaming = readWav(padWavSilence(makeWav({ dataSizeField: 0xffffffff }).wav, 100))
  check('wav 补静音：流式 WAV（data 长度写成 0xFFFFFFFF）按实际字节数补', streaming.dataSize === 4800 + 4800, J(streaming))
  check('wav 补静音：不认识的格式（非 WAV / 压缩编码）返回 null，原样发', padWavSilence(Buffer.from('ID3hello world!'), 300) === null && padWavSilence(makeWav({ format: 2 }).wav, 300) === null)
}

// ================= 准备数据：一个合集里两本 EPUB，每本两章、每章很长 =================
const work = await mkdtemp(path.join(os.tmpdir(), 'epub-reader-selftest-'))
const paragraph = (book, ch, i) => `<p>${book}-第${ch}章-第${i + 1}段：这一段是阅读自测用的正文，长度足够撑出很多页，用来检查翻页之后每一页的开头是不是还贴着左边。</p>`
async function buildEpub(name, book) {
  const dir = path.join(work, name)
  await mkdir(path.join(dir, 'META-INF'), { recursive: true })
  await mkdir(path.join(dir, 'OEBPS'), { recursive: true })
  await writeFile(path.join(dir, 'mimetype'), 'application/epub+zip')
  await writeFile(path.join(dir, 'META-INF/container.xml'), '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  await writeFile(path.join(dir, 'OEBPS/content.opf'), `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${name}</dc:identifier><dc:title>${book}</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`)
  await writeFile(path.join(dir, 'OEBPS/nav.xhtml'), '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章</a></li><li><a href="c2.xhtml">第二章</a></li></ol></nav></body></html>')
  for (const ch of [1, 2]) {
    await writeFile(path.join(dir, `OEBPS/c${ch}.xhtml`), `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${ch}章</title></head><body><h1>第${ch}章</h1>${Array.from({ length: 260 }, (_, i) => paragraph(book, ch, i)).join('')}</body></html>`)
  }
  const out = path.join(work, `${name}.epub`)
  execFileSync('python3', ['-I', '-c', 'import sys,zipfile,os\nsrc,out=sys.argv[1],sys.argv[2]\nz=zipfile.ZipFile(out,"w")\nz.write(os.path.join(src,"mimetype"),"mimetype",zipfile.ZIP_STORED)\nfor d,_,fs in os.walk(src):\n  for f in fs:\n    p=os.path.join(d,f); r=os.path.relpath(p,src)\n    if r!="mimetype": z.write(p,r,zipfile.ZIP_DEFLATED)\nz.close()', dir, out])
  return readFile(out)
}

const browser = await chromium.launch()
try {
  await postJson('/api/config', { mediaOpenInNewTabRules: [] })   // 点目录在当前页打开，自测才拿得到页面
  const form = new FormData()
  form.set('importProfile', 'text-media')
  form.append('file', new Blob([await buildEpub('book-a', '甲书')]), '阅读自测甲.epub')
  form.append('file', new Blob([await buildEpub('book-b', '乙书')]), '阅读自测乙.epub')
  const imported = await api('/api/library/items?type=media', { method: 'POST', body: form })
  const itemId = imported.body?.itemId
  check('导入两本 EPUB 到同一个文本媒体合集', imported.status < 300 && Boolean(itemId), J(imported.body).slice(0, 300))
  if (!itemId) throw new Error('导入失败，后面没法测')
  // 列表接口读的是索引：刚导入的条目要先重建索引才看得到
  await postJson('/api/library/index/rebuild', {})
  for (let i = 0; i < 60; i++) {
    const st = (await api('/api/library/index/status')).body
    if (st?.status === 'ready' && !st?.dirty && !st?.rebuildQueued) break
    await sleep(500)
  }
  const units = (await api(`/api/library/items/media/${itemId}/units`)).body || []
  const unitA = units.find((u) => /甲/.test(u.title))
  const unitB = units.find((u) => /乙/.test(u.title))
  check('合集里两本都在', Boolean(unitA && unitB), J(units.map((u) => u.title)))

  // ---- 可选：HTTP 验证补静音 ----
  if (process.env.SELFTEST_DATA_DIR) {
    const hash = 'f'.repeat(40)
    const dir = path.join(process.env.SELFTEST_DATA_DIR, 'cache', 'epub-tts', itemId)
    await mkdir(dir, { recursive: true })
    const { wav } = makeWav({})
    await writeFile(path.join(dir, `${hash}.wav`), wav)
    const res = await fetch(`${BASE}/api/epub/${itemId}/tts-chunk/${hash}.wav`, { headers })
    const body = Buffer.from(await res.arrayBuffer())
    const r = readWav(body)
    check('HTTP：/tts-chunk/<hash>.wav 发出去的音频句尾补了 300ms 静音，Content-Length 对得上', res.status === 200 && r.dataSize === 4800 + 14400 && Number(res.headers.get('content-length')) === body.length, J({ status: res.status, ...r, len: body.length }))
    for (const [pad, extra] of [['0', 0], ['1000', 48000], ['99999', 96000], ['abc', 14400]]) {
      const res2 = await fetch(`${BASE}/api/epub/${itemId}/tts-chunk/${hash}.wav?pad=${pad}`, { headers })
      const r2 = readWav(Buffer.from(await res2.arrayBuffer()))
      check(`HTTP：?pad=${pad} 补 ${extra / 48}ms（0 = 不补，上限 2000ms，非法值用默认 300ms）`, r2.dataSize === 4800 + extra, J(r2))
    }
    const disk = await readFile(path.join(dir, `${hash}.wav`))
    check('HTTP：缓存文件本身不被改写', disk.equals(wav))
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, extraHTTPHeaders: headers })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))

  const pageInfo = async () => {
    const text = await page.textContent('#media-reader-meta')
    const m = /第 (\d+)\/(\d+) 页/.exec(text || '')
    return m ? { index: Number(m[1]) - 1, count: Number(m[2]), text } : { index: -1, count: 0, text }
  }
  const waitReader = async () => {
    await page.waitForFunction(() => /第 \d+\/\d+ 页/.test(document.querySelector('#media-reader-content.media-html') ? document.querySelector('#media-reader-meta')?.textContent || '' : ''), null, { timeout: 20000 })
    await sleep(700)
  }
  const goToPage = async (target) => {
    for (let guard = 0; guard < 400; guard++) {
      const { index } = await pageInfo()
      if (index === target) break
      await page.click(index < target ? '#media-page-next' : '#media-page-prev')
      await sleep(20)
    }
    await sleep(900)   // 平滑滚动停稳 + 进度保存的 500ms 防抖
  }
  // 当前页第一栏的开头离视口左边多远：应该正好等于左右留白（gutter）；上一栏的任何一截都不该露进来
  const pageOffset = () => page.evaluate(() => {
    const content = document.querySelector('#media-reader-content')
    const rect = content.getBoundingClientRect()
    const left = rect.left + content.clientLeft
    const right = left + content.clientWidth
    const gutter = parseFloat(getComputedStyle(content).getPropertyValue('--media-page-gutter')) || 0
    let first = Infinity
    let leak = 0
    for (const el of content.querySelectorAll('.media-html-pages > *, .media-html-pages p')) {
      for (const r of el.getClientRects()) {
        if (r.width <= 0 || r.right <= left + 1 || r.left >= right - 1) continue
        first = Math.min(first, r.left - left)
        if (r.left < left + gutter - 2) leak = Math.max(leak, left + gutter - r.left)
      }
    }
    const pages = content.querySelector('.media-html-pages')
    const ps = getComputedStyle(pages)
    return { offset: first, gutter, leak, sw: content.scrollWidth, column: Math.round(pages.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)) }
  })
  const openDetail = async () => {
    await page.goto(`${BASE}/`)
    await page.evaluate(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ html: false })))
    await page.click('[data-view="library-view"]')
    const card = page.locator('#library-items .library-card', { hasText: '阅读自测' }).first()
    await card.waitFor({ timeout: 20000 })
    const unitsGo = card.locator('.library-units-go')
    if (await unitsGo.count()) await unitsGo.click(); else await card.click()
    await page.waitForSelector('#library-units .library-unit', { timeout: 20000 })
  }
  const clickUnit = async (title) => {
    if (!(await page.locator('#library-view.active').count())) await page.click('#media-reader-back')
    await page.locator('#library-units .library-unit', { hasText: title }).first().click()
    await waitReader()
  }

  // 沉浸控制条平时收在屏幕下面、鼠标贴边才出来：自测里直接钉在屏幕上。
  // 用行内样式而不是插 <style>：站点的 CSP 不让注入样式表。每次进沉浸控制条都是新建的，要重新钉
  const pinBar = async () => {
    await page.waitForSelector('.epub-bar', { state: 'attached', timeout: 10000 })
    await page.evaluate(() => { const bar = document.querySelector('.epub-bar'); bar.style.setProperty('transform', 'none', 'important'); bar.style.setProperty('transition', 'none', 'important') })
  }

  // 「退出」在沉浸条的「更多」里：菜单没开就先打开
  const exitImmersive = async () => {
    await pinBar()
    if (await page.locator('.epub-bar .epub-more .gallery-more-menu').isHidden()) await page.click('.epub-bar .epub-more-btn', { force: true })
    await page.click('.epub-bar .epub-exit', { force: true })
  }

  // ================= 1. 分页漂移 =================
  for (const width of [517, 733, 0]) {
    await page.goto(`${BASE}/`)
    await page.evaluate((w) => { if (w) localStorage.setItem('copymanga.epubPageWidth', String(w)); else localStorage.removeItem('copymanga.epubPageWidth') }, width)
    await openDetail()
    await clickUnit('阅读自测乙')
    await goToPage(0)
    const { count } = await pageInfo()
    const targets = [...new Set([0, 10, 30, Math.max(0, count - 2)].filter((n) => n < count))]
    const results = []
    for (const target of targets) { await goToPage(target); results.push({ page: target, ...(await pageOffset()) }) }
    if (process.env.SELFTEST_VERBOSE) console.log(J(results))
    const bad = results.filter((r) => Math.abs(r.offset - r.gutter) > 1.5 || r.leak > 0)
    check(`分页：阅读宽度 ${width || '铺满'}（实际栏宽 ${results[0]?.column}px），共 ${count} 页，第 ${targets.join('/')} 页的开头都贴着左边留白、不露上一栏`, count > 20 && bad.length === 0, J(results))
  }
  await page.evaluate(() => localStorage.removeItem('copymanga.epubPageWidth'))

  // ================= 3. 续读 =================
  await postJson(`/api/library/items/media/${itemId}/progress`, { unitId: unitB.unitId, title: unitB.title, sectionId: '', scrollRatio: 0 })   // 把上面测分页留下的位置清掉
  await openDetail()
  await clickUnit('阅读自测甲')
  check('续读：第一次打开甲书从第 1 页开始', (await pageInfo()).index === 0, (await pageInfo()).text)
  await goToPage(12)
  const a1 = await pageInfo()
  await clickUnit('阅读自测乙')
  check('续读：打开没读过的乙书，从第 1 页开始（不套用甲书的进度）', (await pageInfo()).index === 0, (await pageInfo()).text)
  await goToPage(5)
  await clickUnit('阅读自测甲')
  check('续读：目录里再点甲书，回到它自己的第 13 页（不是从头）', (await pageInfo()).index === a1.index, `${J(a1)} -> ${(await pageInfo()).text}`)
  await clickUnit('阅读自测乙')
  check('续读：再点乙书，回到它自己的第 6 页（两本互不覆盖）', (await pageInfo()).index === 5, (await pageInfo()).text)

  // 换到甲书第二章的第 5 页，刷新整个页面后再从目录点甲书
  await clickUnit('阅读自测甲')
  const sections = await page.$$eval('#media-section-select option', (os) => os.map((o) => o.value).filter(Boolean))
  await page.selectOption('#media-section-select', sections[1])
  await waitReader()
  await goToPage(4)
  await openDetail()
  await clickUnit('阅读自测甲')
  const sel = await page.$eval('#media-section-select', (s) => s.value)
  check('续读：刷新页面后点甲书，落在第二章第 5 页', sel === sections[1] && (await pageInfo()).index === 4, `${sel} ${(await pageInfo()).text}`)

  // 只带 unit、不带章节的链接（目录里 Ctrl+点击开新标签页就是这种）
  await page.goto(`${BASE}/#/media/media/${encodeURIComponent(itemId)}/${encodeURIComponent(unitA.unitId)}`)
  await page.reload()
  await waitReader()
  const viaLink = await pageInfo()
  check('续读：只带 unit 的链接打开，也落在第二章第 5 页', (await page.$eval('#media-section-select', (s) => s.value)) === sections[1] && viaLink.index === 4, viaLink.text)

  // 换阅读主题会整章重渲染，不能跳回本章第一页
  const before = await pageInfo()
  const themes = await page.$$eval('#media-reader-theme option', (os) => os.map((o) => o.value))
  const current = await page.$eval('#media-reader-theme', (s) => s.value)
  await page.selectOption('#media-reader-theme', themes.find((t) => t !== current))
  await sleep(800)
  check('换阅读主题后还在同一页', (await pageInfo()).index === before.index, `${before.text} -> ${(await pageInfo()).text}`)

  // 进度里存的章节失效（比如重新导入后章节 id 变了）：退回从这本开头打开，不报错
  await postJson(`/api/library/items/media/${itemId}/progress`, { unitId: unitA.unitId, title: unitA.title, sectionId: 'no-such-section', scrollRatio: 0.5 })
  await openDetail()
  await clickUnit('阅读自测甲')
  check('续读：存的章节已失效时退回从这本开头打开，不报加载失败', !/加载失败/.test((await pageInfo()).text) && (await pageInfo()).index === 0, (await pageInfo()).text)

  // 沉浸条布局：外面只留阅读时一直要用的；返回 / 上页 / 下页 / 倍速 / 音量 / 退出收进「更多」
  await page.click('#media-immersive')
  await page.waitForSelector('.epub-bar .epub-more-btn', { state: 'attached', timeout: 10000 })
  const outside = await page.$$eval('.epub-bar > *', (els) => els.map((e) => e.className.split(' ').pop()))
  check('沉浸条外面：全书进度、上章、章名页码、下章、目录、宽度、朗读（+ 平时隐藏的朗读状态提示）、读选中、朗读范围、更多', JSON.stringify(outside) === JSON.stringify(['epub-book-progress', 'epub-chapter-prev', 'epub-page-info', 'epub-chapter-next', 'immersive-toc', 'epub-width', 'epub-tts-toggle', 'epub-tts-status', 'epub-tts-selection', 'epub-tts-flag', 'epub-more']), JSON.stringify(outside))
  const inMore = await page.$$eval('.epub-bar .epub-more .gallery-more-menu', (menus) => ['.epub-back', '.epub-page-prev', '.epub-page-next', '.epub-exit', '.epub-tts-rate', '.epub-tts-volume'].filter((sel) => menus[0]?.querySelector(sel)))
  check('「更多」里：返回、上页、下页、退出、倍速、音量', inMore.length === 6, JSON.stringify(inMore))
  await exitImmersive()

  // 在本章第一页往回翻（← / 点左侧 / 更多里的「上页」）：落到上一章的最后一页；「上章」按钮仍到上一章开头
  {
    const order = (await api(`/api/library/items/media/${itemId}/units`)).body.map((u) => u.unitId)
    const [firstUnit, secondUnit] = order
    const firstTitle = firstUnit === unitA.unitId ? '阅读自测甲' : '阅读自测乙'
    const secondTitle = secondUnit === unitA.unitId ? '阅读自测甲' : '阅读自测乙'
    const immersiveInfo = async () => {
      const text = await page.textContent('.epub-bar .epub-page-num')
      const m = /(\d+) \/ (\d+)/.exec(text || '')
      return { index: m ? Number(m[1]) - 1 : -1, count: m ? Number(m[2]) : 0, section: await page.$eval('#media-section-select', (el) => el.value) }
    }
    const waitLanded = async () => { await sleep(400); await waitReader(); await sleep(600) }
    await openDetail()
    await clickUnit(firstTitle)
    await page.selectOption('#media-section-select', sections[1])
    await waitReader()
    await goToPage(0)
    await page.click('#media-immersive')
    await page.waitForSelector('.epub-bar .epub-more-btn', { state: 'attached', timeout: 10000 })
    await sleep(800)
    await page.keyboard.press('ArrowLeft')
    await waitLanded()
    let at = await immersiveInfo()
    check('第二章第 1 页按 ←：到第一章的最后一页（不是第一页）', at.section === sections[0] && at.count > 1 && at.index === at.count - 1, J(at))
    await page.keyboard.press('ArrowRight')
    await waitLanded()
    at = await immersiveInfo()
    check('第一章最后一页按 →：回到第二章第 1 页', at.section === sections[1] && at.index === 0, J(at))
    await pinBar()
    await page.click('.epub-bar .epub-chapter-prev', { force: true })
    await waitLanded()
    at = await immersiveInfo()
    check('「上章」按钮：到第一章第 1 页（行为不变）', at.section === sections[0] && at.index === 0, J(at))
    await exitImmersive()
    // 跨本：第二本第一章第 1 页往回翻 → 第一本最后一章的最后一页
    await openDetail()
    await clickUnit(secondTitle)
    await page.selectOption('#media-section-select', sections[0])
    await waitReader()
    await goToPage(0)
    await page.click('#media-immersive')
    await page.waitForSelector('.epub-bar .epub-more-btn', { state: 'attached', timeout: 10000 })
    await sleep(800)
    await page.keyboard.press('ArrowLeft')
    await waitLanded()
    at = await immersiveInfo()
    const title = await page.textContent('#media-reader-title').catch(() => '')
    check('合集第二本第一章第 1 页按 ←：到第一本最后一章的最后一页', at.section === sections[1] && at.index === at.count - 1 && at.count > 1, J({ at, title }))
    await exitImmersive()
  }

  // 沉浸条「更多 → 句尾留白」：滑块存本机，重新进沉浸还是这个值
  await page.evaluate(() => localStorage.removeItem('copymanga.epubTtsTailPad'))
  await page.click('#media-immersive')
  await page.waitForSelector('.epub-bar .epub-more-btn', { timeout: 10000 })
  await pinBar()
  await page.click('.epub-bar .epub-more-btn', { force: true })
  const tail = page.locator('.epub-bar .epub-tts-tail-input')
  const initial = await tail.inputValue()
  await tail.fill('650')
  await sleep(200)
  const stored = await page.evaluate(() => localStorage.getItem('copymanga.epubTtsTailPad'))
  check('沉浸条「更多」里有句尾留白滑块：默认 300ms，拖到 650 存进本机', initial === '300' && stored === '650' && /650ms/.test(await page.textContent('.epub-bar .epub-tts-tail')), `${initial} ${stored}`)
  await exitImmersive()
  await page.click('#media-immersive')
  await page.waitForSelector('.epub-bar .epub-tts-tail-input', { state: 'attached', timeout: 10000 })
  await pinBar()
  check('重新进沉浸，句尾留白还是 650', (await page.locator('.epub-bar .epub-tts-tail-input').inputValue()) === '650')

  // ================= 全书进度条（按字数加权）=================
  {
    const reader = (await api(`/api/library/items/media/${itemId}/reader/${encodeURIComponent(unitA.unitId)}`)).body
    const chars = (reader.sections || []).map((section) => section.chars)
    check('阅读器接口：每章带字数 chars（两章一样长，字数应接近）', chars.length === 2 && chars.every((n) => n > 5000) && Math.abs(chars[0] - chars[1]) / chars[0] < 0.05, J(chars))
    const slider = page.locator('.epub-bar .epub-book-slider')
    const sectionValue = () => page.$eval('#media-section-select', (el) => el.value)
    const bookValue = async () => Number(await slider.inputValue()) / 1000
    const waitSettled = async () => { await sleep(300); await waitReader() }
    // 从第一章第 1 页开始
    await exitImmersive()
    await page.selectOption('#media-section-select', sections[0])
    await waitReader()
    await goToPage(0)
    await page.click('#media-immersive')
    await page.waitForSelector('.epub-bar .epub-book-slider', { state: 'attached', timeout: 10000 })
    await pinBar()
    await sleep(500)
    check('全书进度条：第一章第 1 页 = 全书 0%，有 1 个章节刻度', (await bookValue()) === 0 && (await page.locator('.epub-bar .epub-book-ticks i').count()) === 1 && /全书 0%/.test(await page.textContent('.epub-bar .epub-book-label')), `${await bookValue()} ${await page.textContent('.epub-bar .epub-book-label')}`)
    // 拖到 75%：第二章的一半
    await slider.fill('750')
    await waitSettled()
    let info = await pageInfo()
    let ratio = info.index / Math.max(1, info.count - 1)
    check('全书进度条：拖到 75% → 跳到第二章、章内约 50%', (await sectionValue()) === sections[1] && Math.abs(ratio - 0.5) < 0.06, `${await sectionValue()} ${info.text}`)
    check('全书进度条：跳过去之后滑块回显约 75%', Math.abs((await bookValue()) - 0.75) < 0.03, String(await bookValue()))
    // 同一章里拖：不换章，只翻页
    await slider.fill('900')
    await sleep(1200)
    info = await pageInfo()
    ratio = info.index / Math.max(1, info.count - 1)
    check('全书进度条：同一章里拖到 90% → 还在第二章、章内约 80%', (await sectionValue()) === sections[1] && Math.abs(ratio - 0.8) < 0.06, `${await sectionValue()} ${info.text}`)
    // 拖回第一章
    await slider.fill('250')
    await waitSettled()
    info = await pageInfo()
    ratio = info.index / Math.max(1, info.count - 1)
    check('全书进度条：拖回 25% → 第一章、章内约 50%', (await sectionValue()) === sections[0] && Math.abs(ratio - 0.5) < 0.06, `${await sectionValue()} ${info.text}`)
    // 跳转后的位置要记进进度：从目录再点这本，落在同一处
    const landed = await pageInfo()
    await sleep(800)
    await exitImmersive()
    await openDetail()
    await clickUnit('阅读自测甲')
    // 沉浸和普通模式视口大小不同、一章的页数不同，所以按章内比例比（差一页以内）
    const back = await pageInfo()
    const landedRatio = landed.index / Math.max(1, landed.count - 1)
    const backRatio = back.index / Math.max(1, back.count - 1)
    check('全书进度条：跳转后的位置记进了进度，从目录再点这本回到同一处（按章内比例）', (await sectionValue()) === sections[0] && Math.abs(landedRatio - backRatio) <= 1 / Math.max(1, back.count - 1) + 0.01, `${landed.text} -> ${back.text}`)
  }

  check('全程没有页面脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))
  await context.close()
} finally {
  await browser.close()
  await rm(work, { recursive: true, force: true }).catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
