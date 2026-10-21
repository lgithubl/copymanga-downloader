#!/usr/bin/env node
// 浏览器自测：媒体库卡片封面（统一 3:4 + 铺满裁剪）/ 悬停放大层 / 长标题 / 长 tag / 多 tag / 各种宽高比封面，
// 多个视口 + 系列弹框。需要 Playwright 与 ImageMagick（造各种比例的测试封面）：
//   PLAYWRIGHT_PATH=<含 @playwright/test 的 node_modules/@playwright/test> node scripts/dev/fe-card-visual-selftest.mjs
// 截图写到 SHOT_DIR（默认 /tmp/card-visual-shots），方便人眼看一遍。
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArchiveGalleryHandler } from '../../web/library/types/archive-gallery.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test'))
} catch {
  console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH')
  process.exit(2)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/card-visual-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 造封面：带网格和对角线，裁剪/拉伸一眼可见
const work = await mkdtemp(path.join(os.tmpdir(), 'card-visual-'))
const makeImg = (w, h, color) => {
  const f = path.join(work, `${w}x${h}.jpg`)
  execFileSync('magick', ['-size', `${w}x${h}`, `xc:${color}`, '-fill', 'none', '-stroke', 'white', '-strokewidth', '3',
    '-draw', `rectangle 2,2 ${w - 3},${h - 3}`, '-draw', `line 0,0 ${w},${h}`, '-draw', `line 0,${h} ${w},0`,
    '-fill', 'white', '-stroke', 'none', '-pointsize', String(Math.max(12, Math.min(w, h) / 6)), '-gravity', 'center', '-annotate', '0', `${w}x${h}`, '-quality', '80', f])
  return f
}
const LONG_LATIN = 'Extraordinarily-Long-Unbroken-Title-Without-Any-Spaces-To-Wrap-' + 'x'.repeat(80)
const LONG_CJK = '这是一个非常非常长的标题用来测试卡片在标题超过两行的时候会不会把卡片撑坏或者把按钮挤出卡片之外而且还要包含【方括号】和（括号）以及更多的字'.repeat(2)
const manyTags = Array.from({ length: 60 }, (_, i) => `标签${i}:取值${i}`)
const longTags = ['作者:' + 'a'.repeat(150), '社团:' + '很长的社团名'.repeat(20), 'x'.repeat(200), '语言:中文', '字幕:有', '分辨率:1080p']
const specs = [
  { key: 'manga', title: '漫画 3:4 正常', cover: [400, 566, '#2b6cb0'], tags: ['作者:甲', '语言:中文', '社团:乙'] },
  { key: 'tall', title: '超高封面 0.5（400x800）', cover: [400, 800, '#2f855a'], tags: ['作者:甲'] },
  { key: 'wide3', title: '超宽封面 3:1（1200x400）', cover: [1200, 400, '#c05621'], tags: ['作者:甲'] },
  { key: 'wide169', title: '视频 16:9 封面', cover: [640, 360, '#6b46c1'], tags: ['语言:日语'] },
  { key: 'wide43', title: '4:3 封面', cover: [400, 300, '#b83280'], tags: [] },
  { key: 'square', title: '方形封面', cover: [400, 400, '#2c7a7b'], tags: ['作者:甲'] },
  { key: 'tiny', title: '极小封面 40x40', cover: [40, 40, '#975a16'], tags: ['作者:甲'] },
  { key: 'huge', title: '超大封面 1600x2400', cover: [1600, 2400, '#744210'], tags: ['作者:甲'] },
  { key: 'broken', title: '封面文件丢了（破图）', cover: 'missing', tags: ['作者:甲'] },
  { key: 'none', title: '没有封面（占位）', cover: null, tags: ['作者:甲'] },
  { key: 'longcjk', title: LONG_CJK, cover: [400, 566, '#2d3748'], tags: ['作者:甲'] },
  { key: 'longlatin', title: LONG_LATIN, cover: [400, 566, '#4a5568'], tags: ['作者:甲'] },
  { key: 'manytags', title: '60 个标签', cover: [400, 566, '#2b6cb0'], tags: manyTags },
  { key: 'longtags', title: '超长标签（150/200 字符不换行）', cover: [400, 566, '#2f855a'], tags: longTags },
  { key: 'special', title: `<b>特殊</b> "引号" & '单引' <img src=x onerror=1>`, cover: [400, 566, '#c05621'], tags: ['作者:<i>x</i>', 'a&b"c'] },
  { key: 'worst', title: LONG_LATIN + LONG_CJK, cover: [1200, 400, '#6b46c1'], tags: [...manyTags, ...longTags] },
  { key: 'previewA', title: '有预览（悬停显示动图）', cover: [400, 566, '#2b6cb0'], tags: ['作者:甲'], preview: [400, 300, '#e53e3e'] },
  { key: 's1', title: '系列成员 1', cover: [400, 566, '#2b6cb0'], tags: ['系列:视觉测试系列', '字幕:有', '作者:甲'] },
  { key: 's2', title: '系列成员 2 ' + LONG_LATIN, cover: [1200, 400, '#2f855a'], tags: ['系列:视觉测试系列', ...manyTags.slice(0, 20)] },
  { key: 's3', title: '系列成员 3', cover: [400, 800, '#c05621'], tags: ['系列:视觉测试系列', ...longTags] },
  { key: 's4', title: '系列成员 4', cover: null, tags: ['系列:视觉测试系列'] },
]
const dataDir = path.join(work, 'data')
const cfg = { archiveCacheDir: path.join(dataDir, 'c'), mediaImportProfiles: { 'archive-gallery': { managedDir: path.join(dataDir, 'm') } }, mediaImportSourceRoots: '/input' }
const handler = createArchiveGalleryHandler({ type: 'archive', dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async () => false, getConfig: () => cfg })
const { internals } = handler
const ids = {}
for (const [i, spec] of specs.entries()) {
  const id = createHash('sha1').update(spec.key).digest('hex')
  ids[spec.key] = id
  await internals.writeItem(internals.buildItem({ itemId: id, title: spec.title, tags: spec.tags, zipPath: `/x/${spec.key}.zip`, external: true, size: 1, mtimeMs: 1, pageCount: 3, sourceProfile: 'archive-gallery', createdAt: new Date(1.7e12 + (specs.length - i) * 1000).toISOString(), cover: spec.cover ? internals.thumbnailUrl(id) : '' }))
  if (Array.isArray(spec.cover)) {
    await mkdir(path.dirname(internals.paths.thumbPath(id)), { recursive: true })
    await writeFile(internals.paths.thumbPath(id), await readFile(makeImg(...spec.cover)))
  }
  if (spec.preview) {
    await writeFile(internals.paths.previewPath(id), await readFile(makeImg(...spec.preview)))
    await internals.updateItem(id, (item) => ({ ...item, mediaUnits: [{ ...item.mediaUnits[0], thumbnail: { status: 'ready', coverUrl: internals.thumbnailUrl(id), previewUrl: internals.thumbnailUrl(id, 'preview') } }] }))
  }
}

const port = 8101
const base = `http://127.0.0.1:${port}`
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
for (let i = 0; i < 100; i++) { const p = await (await fetch(`${base}/api/library/items?type=archive&page=1&limit=1`)).json(); if (p.index.status === 'ready') break; await sleep(200) }

const browser = await chromium.launch()
const errors = []
const requests = []
const openLibrary = async (page) => {
  await page.goto(`${base}/`)
  await page.click('[data-view="library-view"]')
  await page.waitForSelector('#library-items .card')
  await page.evaluate(() => { const s = document.querySelector('#library-limit'); s.value = '50'; s.dispatchEvent(new Event('change')) })
  await page.waitForFunction((n) => document.querySelectorAll('#library-items .card').length >= n, specs.length - 3, { timeout: 15000 })
  await sleep(800)
}
const cardOf = (page, title) => page.locator('#library-items .card', { hasText: title }).first()

// 几何检查：每张卡片 —— 封面 3:4、不横向溢出、按钮没被切、标题没撑出卡片
const geometry = (scopeSel) => (sel) => {
  const out = []
  for (const card of document.querySelectorAll(`${sel} .library-card`)) {
    const r = card.getBoundingClientRect()
    const cover = card.querySelector('.library-card-cover .cover')
    const cr = cover.getBoundingClientRect()
    const btn = card.querySelector('.library-continue').getBoundingClientRect()
    const title = card.querySelector('.card-title').getBoundingClientRect()
    const body = card.querySelector('.card-body')
    const tagList = card.querySelector('.tag-list')
    const overflowing = [...card.querySelectorAll('.card-body *')].filter((el) => {
      const b = el.getBoundingClientRect()
      return b.width && (b.right > r.right + 1 || b.left < r.left - 1)
    }).map((el) => el.className || el.tagName)
    out.push({
      title: card.querySelector('.card-title').textContent.slice(0, 24),
      w: r.width, h: r.height, coverRatio: cr.width / cr.height, coverW: cr.width,
      fit: getComputedStyle(cover).objectFit, isImg: cover.tagName === 'IMG',
      btnClipped: btn.bottom > r.bottom + 0.5 || btn.height < 10,
      titleOut: title.right > r.right + 1,
      titleLines: Math.round(title.height / parseFloat(getComputedStyle(card.querySelector('.card-title')).lineHeight || 18)),
      overflowing, bodyScrollW: body.scrollWidth - body.clientWidth,
      tagBottomClipped: tagList ? tagList.getBoundingClientRect().bottom > r.bottom + 0.5 : false,
    })
  }
  return out
}

for (const vp of [{ w: 1280, h: 800 }, { w: 1920, h: 1080 }, { w: 1024, h: 700 }, { w: 800, h: 900 }, { w: 390, h: 800 }]) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${vp.w}: ${e.message}`))
  await openLibrary(page)
  const tag = `${vp.w}x${vp.h}`
  const rows = await page.evaluate(geometry(), '#library-items')
  check(`[${tag}] 渲染了全部卡片`, rows.length >= specs.length - 3, `rows=${rows.length}`)
  check(`[${tag}] 所有封面框 3:4（±0.02）`, rows.every((r) => Math.abs(r.coverRatio - 0.75) < 0.02), JSON.stringify(rows.filter((r) => Math.abs(r.coverRatio - 0.75) >= 0.02).map((r) => [r.title, r.coverRatio])))
  check(`[${tag}] 有封面的卡 object-fit: cover`, rows.filter((r) => r.isImg).every((r) => r.fit === 'cover'))
  check(`[${tag}] 按钮都没被卡片切掉`, rows.every((r) => !r.btnClipped), JSON.stringify(rows.filter((r) => r.btnClipped).map((r) => r.title)))
  check(`[${tag}] 卡片内容没有横向溢出`, rows.every((r) => !r.overflowing.length && !r.titleOut), JSON.stringify(rows.filter((r) => r.overflowing.length || r.titleOut).map((r) => [r.title, r.overflowing])))
  check(`[${tag}] 标签区没被卡片切掉`, rows.every((r) => !r.tagBottomClipped), JSON.stringify(rows.filter((r) => r.tagBottomClipped).map((r) => r.title)))
  const colW = rows.map((r) => r.w)
  check(`[${tag}] 卡片宽度 ≥ 160（窄屏单列除外按视口）`, Math.min(...colW) >= Math.min(160, vp.w - 60), `min=${Math.min(...colW)}`)
  const hscroll = await page.evaluate(() => { const el = document.querySelector('#library-items'); return { list: el.scrollWidth - el.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth } })
  check(`[${tag}] 列表和页面没有横向滚动条`, hscroll.list <= 1 && hscroll.doc <= 1, JSON.stringify(hscroll))
  const heights = rows.map((r) => Math.round(r.h))
  console.log(`   [${tag}] 卡宽 ${Math.round(Math.min(...colW))}~${Math.round(Math.max(...colW))}，卡高 ${Math.min(...heights)}~${Math.max(...heights)}`)
  await page.screenshot({ path: path.join(shotDir, `grid-${tag}.png`) })
  if (vp.w === 1280) {
    for (const key of ['manytags', 'longtags', 'worst', 'longlatin', 'special', 'broken']) {
      const c = cardOf(page, specs.find((x) => x.key === key).title.slice(0, 12))
      await c.scrollIntoViewIfNeeded()
      await c.screenshot({ path: path.join(shotDir, `card-${key}.png`) })
    }
  }
  // 被裁剪的真实视觉：长条封面 cover 只露出中间一段，悬停放大层应能看到整图
  await context.close()
}

// ---- 悬停原位展开（1280x800）
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`hover: ${e.message}`))
  page.on('request', (r) => { if (/\/thumbnail\//.test(r.url())) requests.push(r.url()) })
  await openLibrary(page)
  // 记录每次弹出时「第一帧」的位置：应该就是封面框本身（从原位出发）
  await page.evaluate(() => {
    window.__firstRect = null
    new MutationObserver(() => {
      const p = document.querySelector('.cover-hover-popover')
      if (!p || p.hidden) { window.__firstRect = null; return }
      if (!window.__firstRect) { const r = p.getBoundingClientRect(); window.__firstRect = { left: r.left, top: r.top, width: r.width, height: r.height } }
    }).observe(document.body, { subtree: true, attributes: true, childList: true })
  })
  const pop = () => page.evaluate(() => {
    const p = document.querySelector('.cover-hover-popover')
    if (!p || p.hidden) return null
    const img = p.querySelector('img'); const r = p.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, nw: img.naturalWidth, nh: img.naturalHeight, src: img.getAttribute('src'), pe: getComputedStyle(p).pointerEvents, count: document.querySelectorAll('.cover-hover-popover').length, first: window.__firstRect, anim: p.getAnimations().length }
  })
  const coverBox = (key) => cardOf(page, specs.find((s) => s.key === key).title).locator('.library-card-cover')
  const hoverCover = async (key) => { const c = coverBox(key); await c.scrollIntoViewIfNeeded(); await sleep(150); await c.hover() }
  const near = (a, b, t = 2) => Math.abs(a - b) <= t

  await hoverCover('tall')
  await sleep(150)
  check('悬停 150ms：还没弹（有延迟）', (await pop()) === null)
  await sleep(500)
  let p = await pop()
  const cb = await coverBox('tall').boundingBox()
  check('弹出后 pointer-events:none，且只有一个', p && p.pe === 'none' && p.count === 1, JSON.stringify(p))
  check('第一帧就是封面框本身（原位出发，位置和大小一致）', p && p.first && near(p.first.left, cb.x) && near(p.first.top, cb.y) && near(p.first.width, cb.width) && near(p.first.height, cb.height), JSON.stringify([p?.first, cb]))
  await sleep(500)
  p = await pop()
  check('动画结束后：整图比例与原图一致（400x800 → 1:2），高 ≤ 视口 80%，宽 ≤ 封面框 2.5 倍', p && near(p.w / p.h, 0.5, 0.02) && p.h <= 640.5 && p.w <= cb.width * 2.5 + 1, JSON.stringify([p, cb.width]))
  check('展开层以封面框中心为锚点（没被视口夹住时中心重合）', p && near((p.left + p.right) / 2, cb.x + cb.width / 2, 3) || p.left <= 9 || p.right >= 1271, JSON.stringify([p, cb]))
  check('展开层在视口内', p && p.left >= 0 && p.top >= 0 && p.right <= 1280 && p.bottom <= 800, JSON.stringify(p))
  check('展开层比封面框大', p && p.w > cb.width && p.h > cb.height, JSON.stringify([p, cb]))
  await page.screenshot({ path: path.join(shotDir, 'hover-tall.png') })
  await page.mouse.move(2, 2); await sleep(150)
  check('移开：隐藏', (await pop()) === null)

  await hoverCover('wide3'); await sleep(1000); p = await pop()
  check('超宽图 1200x400：整图、比例 3:1', p && near(p.w / p.h, 3, 0.08), JSON.stringify(p))
  await page.screenshot({ path: path.join(shotDir, 'hover-wide.png') })
  await page.mouse.move(2, 2)
  await hoverCover('tiny'); await sleep(900)
  check('极小图 40x40：展开后还没封面框大 → 不展开', (await pop()) === null)
  await page.mouse.move(2, 2)
  await hoverCover('huge'); await sleep(1000); p = await pop()
  check('超大图 1600x2400：比例 2:3，高 ≤ 640', p && near(p.w / p.h, 2 / 3, 0.02) && p.h <= 640.5, JSON.stringify(p))
  await page.mouse.move(2, 2)

  // 最左 / 最右列、最上 / 最下行的卡片：都夹在视口内
  const edge = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#library-items .library-card')]
    const lefts = cards.map((c) => c.getBoundingClientRect().left)
    return { right: lefts.indexOf(Math.max(...lefts)), left: lefts.indexOf(Math.min(...lefts)) }
  })
  for (const [name, idx] of [['最右列', edge.right], ['最左列', edge.left]]) {
    const c = page.locator('#library-items .library-card').nth(idx).locator('.library-card-cover')
    await c.scrollIntoViewIfNeeded(); await sleep(150); await c.hover(); await sleep(1000); p = await pop()
    check(`${name}卡片：展开层在视口内`, p === null || (p.left >= 0 && p.right <= 1280 && p.top >= 0 && p.bottom <= 800), JSON.stringify(p))
    await page.mouse.move(2, 2); await sleep(100)
  }

  // 预览卡：用 preview 图（400x300 → 4:3），卡片内封面 src 不被替换
  requests.length = 0
  await hoverCover('previewA'); await sleep(1000); p = await pop()
  check('有预览：展开层显示 /preview（4:3）', p && /\/preview$/.test(p.src) && near(p.w / p.h, 4 / 3, 0.03), JSON.stringify(p))
  check('有预览：卡片内封面 src 不被替换', /\/cover$/.test(await cardOf(page, '有预览').locator('img.cover').getAttribute('src')))
  await page.mouse.move(2, 2)
  requests.length = 0
  await hoverCover('manga'); await sleep(900)
  check('无预览：不请求 /preview', !requests.some((u) => /\/preview/.test(u)), JSON.stringify(requests))
  await page.mouse.move(2, 2)
  await hoverCover('none'); await sleep(800)
  check('占位卡（没封面）：不弹', (await pop()) === null)
  await page.mouse.move(2, 2)
  await hoverCover('broken'); await sleep(800)
  check('破图卡：不弹', (await pop()) === null)
  await page.mouse.move(2, 2)

  await hoverCover('manga'); await sleep(900)
  check('（前置）manga 弹出', (await pop()) !== null)
  await page.evaluate(() => { document.querySelector('#library-items').scrollBy(0, 40) }); await sleep(150)
  check('滚动：隐藏', (await pop()) === null)
  await hoverCover('manga'); await sleep(900); await page.keyboard.press('Escape'); await sleep(100)
  check('Esc：隐藏', (await pop()) === null)
  await hoverCover('manga'); await sleep(900); await page.setViewportSize({ width: 1200, height: 760 }); await sleep(150)
  check('窗口 resize：隐藏', (await pop()) === null)
  await page.setViewportSize({ width: 1280, height: 800 })
  await hoverCover('manga'); await sleep(100); await page.mouse.move(2, 2); await sleep(700)
  check('快速掠过（<300ms 就移开）：不弹', (await pop()) === null)
  for (const k of ['manga', 'tall', 'wide169']) { await hoverCover(k); await sleep(700) }
  p = await pop()
  check('连续悬停多张：始终只有一个展开层', p && p.count === 1, JSON.stringify(p))
  await page.mouse.move(2, 2)
  // 动画过程截几帧（不断言，给人眼看「提一下再展开」）
  await hoverCover('wide169'); await sleep(305)
  for (const i of [0, 1, 2]) { await page.screenshot({ path: path.join(shotDir, `hover-frame-${i}.png`), clip: { x: 60, y: 150, width: 1100, height: 650 } }); await sleep(60) }
  await page.mouse.move(2, 2)
  // 徽标在封面左上角、点徽标/按钮不触发卡片点击以外的问题：徽标都在封面框内
  const badgeBox = await page.evaluate(() => [...document.querySelectorAll('#library-items .library-card')].every((c) => {
    const cr = c.querySelector('.library-card-cover').getBoundingClientRect()
    return [...c.querySelectorAll('.library-card-badges > *')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= cr.left - 1 && r.right <= cr.right + 1 && r.top >= cr.top - 1 && r.bottom <= cr.bottom + 1 })
  }))
  check('类型/合并/系列徽标都落在封面框内', badgeBox)
  await context.close()
}

// ---- 系列弹框：卡片没被 overflow 切掉
{
  for (const vp of [{ w: 1280, h: 800 }, { w: 1920, h: 1080 }, { w: 800, h: 900 }]) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(`series ${vp.w}: ${e.message}`))
    await openLibrary(page)
    const dot = page.locator('#library-items .library-series-dot').first()
    const n = await dot.count()
    check(`[series ${vp.w}] 找到系列入口`, n > 0)
    if (n) {
      await dot.scrollIntoViewIfNeeded(); await dot.click()
      await page.waitForSelector('.series-modal-list .library-card'); await sleep(800)
      const rows = await page.evaluate(geometry(), '.series-modal-list')
      check(`[series ${vp.w}] 4 个成员都在`, rows.length === 4, `rows=${rows.length}`)
      check(`[series ${vp.w}] 封面 3:4`, rows.every((r) => Math.abs(r.coverRatio - 0.75) < 0.02), JSON.stringify(rows.map((r) => r.coverRatio)))
      check(`[series ${vp.w}] 按钮没被切、没横向溢出`, rows.every((r) => !r.btnClipped && !r.overflowing.length), JSON.stringify(rows.map((r) => [r.title, r.btnClipped, r.overflowing])))
      check(`[series ${vp.w}] 标签区没被切掉（tag 区自己滚）`, rows.every((r) => !r.tagBottomClipped), JSON.stringify(rows.map((r) => [r.title, r.tagBottomClipped])))
      const hs = await page.evaluate(() => { const el = document.querySelector('.series-modal-list'); return el.scrollWidth - el.clientWidth })
      check(`[series ${vp.w}] 弹框列表无横向滚动`, hs <= 1, String(hs))
      await page.screenshot({ path: path.join(shotDir, `series-${vp.w}.png`) })
    }
    await context.close()
  }
}

check('没有页面错误', errors.length === 0, errors.join(' | '))
await browser.close()
server.kill('SIGTERM')
await rm(work, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
