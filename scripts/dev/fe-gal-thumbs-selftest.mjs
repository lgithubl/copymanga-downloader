#!/usr/bin/env node
// 浏览器自测：Gal 卡片缩略图——数组（thumbs）、随机封面、悬停轮播、thumbMode（first / hover）、prefers-reduced-motion、
// 封面加载失败时换下一张 / 全失败才报「加载失败」、视频帧缩略图（ffmpeg + cache/gal-thumbs；没有 ffmpeg 就跳过这部分）。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-thumbs-selftest.mjs        端口 8162；需要 ImageMagick（convert）
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

// 造数据：脚本 s1..s6（根目录）+ 目录 d1。s1 四张图；s2 一张；s3 一个视频；s4 两张坏图；s5 一好一坏；s6 坏视频；d1 三张（目录卡片）
async function buildFixture(dir) {
  const R = (rel) => path.join(dir, 'resources', rel)
  const put = async (rel, content) => { await mkdir(path.dirname(R(rel)), { recursive: true }); await writeFile(R(rel), content) }
  const png = async (rel, color) => { await mkdir(path.dirname(R(rel)), { recursive: true }); spawnSync('convert', ['-size', '64x36', `xc:${color}`, R(rel)]) }
  const script = 'msg,0,hello\nclickwait\nmsg,0,second\nclickwait\nmsg,0,third\nclickwait\n'
  for (const n of ['s1', 's2', 's3', 's4', 's5', 's6']) await put(`download/adv/text/${n}.txt`, script)
  await put('download/adv/text/d1/x.txt', script)
  for (const [i, c] of ['red', 'green', 'blue', 'gold'].entries()) await png(`shots/s1_${'abcd'[i]}.png`, c)
  await png('shots/s2_a.png', 'purple')
  await png('shots/s5_b.png', 'teal')
  for (const [i, c] of ['red', 'green', 'blue'].entries()) await png(`shots/d1_${'abc'[i]}.png`, c)
  await put('bad/s4_a.png', 'not an image'); await put('bad/s4_b.png', 'not an image either'); await put('bad/s5_a.png', 'broken')
  await put('clips/s6.mp4', 'this is not a video')
  if (hasFfmpeg) {
    await mkdir(R('clips'), { recursive: true })
    spawnSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x90:rate=10', '-pix_fmt', 'yuv420p', R('clips/s3.mp4')])
  }
}
const sources = [
  { dir: 'shots', match: '^(s\\d)_\\w+\\.png$', key: '{1}', for: 'script' },
  { dir: 'shots', match: '^(d\\d)_\\w+\\.png$', key: '{1}', for: 'dir' },
  { dir: 'bad', match: '^(s\\d)_\\w+\\.png$', key: '{1}', for: 'script' },
  { dir: 'clips', match: '^(s\\d)\\.mp4$', key: '{1}', for: 'script', kind: 'video' },
]

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-thumbs8162-'))
const modes = ['random', 'first', 'hover']
for (const mode of modes) await buildFixture(path.join(dataDir, 'gal', `thumbs-${mode}`))
const port = 8162
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const ids = {}
  for (const mode of modes) {
    const form = new FormData()
    form.set('importProfile', 'gal-import'); form.set('sourcePath', path.join(dataDir, 'gal', `thumbs-${mode}`))
    form.set('profileOptions', JSON.stringify({ adapters: ['uviewer-csv'], defaultMetadataActions: [], config: { game: { id: 'thumbs' }, scriptThumbs: [], thumbSources: sources, thumbMode: mode } }))
    ids[mode] = (await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()).items[0].itemId
  }
  const reader = async (mode, sectionId = '') => (await (await fetch(`${base}/api/library/items/gal/${ids[mode]}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
  const home = (await reader('random')).node
  const item = Object.fromEntries(home.items.map((i) => [i.title, i]))

  // —— API：thumbs 数组 / thumb = 第一张 / thumbMode ——
  check('API：s1 四张（自然序）、thumb = thumbs[0]；s2 一张；d1 目录卡片三张；s4 两张坏图；节点带 thumbMode', J(item.s1.thumbs) === J(['shots/s1_a.png', 'shots/s1_b.png', 'shots/s1_c.png', 'shots/s1_d.png']) && item.s1.thumb === 'shots/s1_a.png' && J(item.s2.thumbs) === J(['shots/s2_a.png']) && item.d1.thumbs.length === 3 && item.d1.thumb === item.d1.thumbs[0] && item.s4.thumbs.length === 2 && home.thumbMode === 'random' && (await reader('first')).node.thumbMode === 'first', J(home.items.map((i) => [i.title, i.thumbs])))

  browser = await chromium.launch()
  const open = async (mode, { reducedMotion = 'no-preference' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion })
    await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
    const page = await ctx.newPage()
    page.setDefaultTimeout(12000)
    page.errors = []
    page.on('pageerror', (e) => page.errors.push(e.message))
    await page.goto(`${base}/#/media/gal/${ids[mode]}/main?section=`)
    await page.waitForSelector('.gal-card')
    return { ctx, page }
  }
  const sel = (title) => `.gal-card[data-title="${title}"] img`
  const pathOf = (src) => new URL(src, base).searchParams.get('path')
  const loaded = (page, title) => page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0 }, sel(title))
  const srcOf = (page, title) => page.$eval(sel(title), (i) => i.getAttribute('src'))
  const s1 = ['shots/s1_a.png', 'shots/s1_b.png', 'shots/s1_c.png', 'shots/s1_d.png']

  // —— random：封面是数组里的一张；每次加载不同；稳定在一次渲染内 ——
  const { ctx, page } = await open('random')
  await loaded(page, 's1')
  const covers = []
  for (let i = 0; i < 9; i++) {
    if (i) { await page.reload(); await page.waitForSelector('.gal-card') }
    await loaded(page, 's1')
    covers.push(pathOf(await srcOf(page, 's1')))
  }
  check('random：封面是 thumbs 里的一张；9 次加载里出现过不止一种（随机）', covers.every((c) => s1.includes(c)) && new Set(covers).size > 1, J(covers))
  const stable = await srcOf(page, 's1'); await sleep(1500)
  check('random：不悬停时封面稳定（一次渲染内不变）；单张的卡片（s2）封面就是它', (await srcOf(page, 's1')) === stable && pathOf(await srcOf(page, 's2')) === 'shots/s2_a.png')
  const dirCover = pathOf(await srcOf(page, 'd1'))
  check('random：目录卡片（d1）也一样——封面在它的 3 张里', ['shots/d1_a.png', 'shots/d1_b.png', 'shots/d1_c.png'].includes(dirCover), dirCover)

  // —— hover 轮播 ——
  await page.reload(); await page.waitForSelector('.gal-card'); await loaded(page, 's1')
  const cover = await srcOf(page, 's1')
  await page.hover('.gal-card[data-title="s1"]')
  const t0 = Date.now()
  const seen = []
  const changes = []
  let prev = cover
  while (Date.now() - t0 < 4200) {
    const now = await srcOf(page, 's1')
    if (now !== prev) { changes.push(Date.now() - t0); seen.push(pathOf(now)); prev = now }
    await sleep(40)
  }
  const gaps = changes.slice(1).map((t, i) => t - changes[i])
  check('hover：src 随时间变化（4 秒内 3–6 次换图），换的都是这张卡片自己的图；每张 700–900ms（容许 ±250ms 抖动）', changes.length >= 3 && changes.length <= 6 && seen.every((p) => s1.includes(p)) && gaps.every((g) => g >= 450 && g <= 1250) && changes[0] >= 450, J({ changes, seen }))
  check('hover：随机顺序——一轮里先轮完其余 3 张（不重复），再回到别的', new Set(seen.slice(0, 3)).size === 3 && !seen.slice(0, 3).includes(pathOf(cover)), J(seen))
  await page.mouse.move(2, 2)
  await sleep(150)
  const restored = await srcOf(page, 's1')
  await sleep(1800)
  check('mouseleave：立刻停下并还原封面，之后不再变化；data-src（thumbLoader 的）没被改动', restored === cover && (await srcOf(page, 's1')) === cover && (await page.$eval(sel('s1'), (i) => i.dataset.src)) === cover, J([cover, restored, await srcOf(page, 's1')]))
  // 没悬停的卡片不动；单张卡片悬停也不动
  const s3before = await srcOf(page, 's2')
  await page.hover('.gal-card[data-title="s2"]'); await sleep(1800)
  check('单张图的卡片悬停：不轮播；别的卡片（s1）也没动', (await srcOf(page, 's2')) === s3before && (await srcOf(page, 's1')) === cover)
  await page.mouse.move(2, 2)

  // —— 加载失败：全坏 → 报一次「加载失败」；一好一坏 → 换下一张，不报 ——
  await sleep(500)
  const diag = async () => { await page.$eval('.gal-browse-diag-btn', (b) => b.click()); await page.waitForFunction(() => { const d = document.querySelector('.gal-browse-diag'); return d && !d.hidden && !/加载中/.test(d.textContent) }); const t = await page.$eval('.gal-browse-diag', (d) => d.textContent); await page.$eval('.gal-browse-diag-btn', (b) => b.click()); return t }
  const report = await diag()
  const failed = [...report.matchAll(/\[加载失败\] (\S+)/g)].map((m) => m[1])
  const s5 = await page.waitForFunction(() => { const i = document.querySelector('.gal-card[data-title="s5"] img'); return i && i.complete && i.naturalWidth > 0 }).then(() => true, () => false)
  check('封面加载失败：s4（两张都坏）报「加载失败」一次、卡片显示无图状态；s5（一好一坏）自动换到好的那张、不报', failed.filter((t) => t === 's4').length === 1 && !failed.includes('s5') && s5 && await page.$eval('.gal-card[data-title="s4"] .gal-card-thumb', (b) => b.classList.contains('empty')), J([failed, s5, report.slice(0, 400)]))
  check('没有页面错误', page.errors.length === 0, J(page.errors))
  await ctx.close()

  // —— prefers-reduced-motion：只选封面，不轮播 ——
  const rm = await open('random', { reducedMotion: 'reduce' })
  await loaded(rm.page, 's1')
  const rmCover = await srcOf(rm.page, 's1')
  await rm.page.hover('.gal-card[data-title="s1"]'); await sleep(2400)
  check('prefers-reduced-motion：悬停不轮播（封面不变）', (await srcOf(rm.page, 's1')) === rmCover && s1.includes(pathOf(rmCover)))
  await rm.ctx.close()

  // —— thumbMode first：封面永远是第一张、不轮播 ——
  const first = await open('first')
  const firstCovers = []
  for (let i = 0; i < 4; i++) { if (i) { await first.page.reload(); await first.page.waitForSelector('.gal-card') } await loaded(first.page, 's1'); firstCovers.push(pathOf(await srcOf(first.page, 's1'))) }
  await first.page.hover('.gal-card[data-title="s1"]'); await sleep(2000)
  check('thumbMode first：4 次加载封面都是第一张，悬停也不轮播', firstCovers.every((c) => c === 'shots/s1_a.png') && pathOf(await srcOf(first.page, 's1')) === 'shots/s1_a.png', J(firstCovers))
  await first.ctx.close()

  // —— thumbMode hover：封面固定第一张，悬停才轮播 ——
  const hov = await open('hover')
  const hovCovers = []
  for (let i = 0; i < 4; i++) { if (i) { await hov.page.reload(); await hov.page.waitForSelector('.gal-card') } await loaded(hov.page, 's1'); hovCovers.push(pathOf(await srcOf(hov.page, 's1'))) }
  await hov.page.hover('.gal-card[data-title="s1"]'); await sleep(2200)
  const hovSrc = pathOf(await srcOf(hov.page, 's1'))
  await hov.page.mouse.move(2, 2); await sleep(200)
  check('thumbMode hover：封面固定第一张；悬停时会换图；移开还原', hovCovers.every((c) => c === 'shots/s1_a.png') && hovSrc !== 'shots/s1_a.png' && pathOf(await srcOf(hov.page, 's1')) === 'shots/s1_a.png', J([hovCovers, hovSrc]))

  // —— 视频帧缩略图 ——
  const resource = (p, extra = '') => fetch(`${base}/api/library/items/gal/${ids.random}/resource?path=${encodeURIComponent(p)}${extra}`)
  const badVideo = await resource('clips/s6.mp4', '&frame=1')
  const notVideo = await resource('shots/s1_a.png', '&frame=1')
  const escape = await resource('../x/y.mp4', '&frame=1')
  check('frame=1：不是视频 → 415；路径穿越 → 400；坏视频 → 422（说明原因）', notVideo.status === 415 && escape.status === 400 && badVideo.status === 422 && /ffmpeg/.test(await badVideo.text()), J([notVideo.status, escape.status, badVideo.status]))
  const s6 = item.s6
  check('API：视频也是 thumbs 里的路径（带 .mp4）', J(s6.thumbs) === J(['clips/s6.mp4']), J(s6.thumbs))
  if (!hasFfmpeg) console.log('SKIP 视频帧：没有 ffmpeg，跳过截帧的检查')
  else {
    const ok = await resource('clips/s3.mp4', '&frame=1')
    const body = Buffer.from(await ok.arrayBuffer())
    const etag = ok.headers.get('etag')
    const cached = await fetch(`${base}/api/library/items/gal/${ids.random}/resource?path=${encodeURIComponent('clips/s3.mp4')}&frame=1`, { headers: { 'If-None-Match': etag } })
    const plain = await resource('clips/s3.mp4')
    const cacheFiles = []
    for (const d of await readdir(path.join(dataDir, 'cache', 'gal-thumbs')).catch(() => [])) for (const f of await readdir(path.join(dataDir, 'cache', 'gal-thumbs', d))) cacheFiles.push(f)
    check('视频帧：frame=1 → image/jpeg（JPEG 文件头）、长缓存头 + ETag；缓存文件在 DATA_DIR/cache/gal-thumbs；If-None-Match → 304；不带 frame 仍是原视频', ok.status === 200 && ok.headers.get('content-type') === 'image/jpeg' && body[0] === 0xff && body[1] === 0xd8 && /max-age=\d{6,}/.test(ok.headers.get('cache-control') || '') && Boolean(etag) && cacheFiles.length >= 1 && cacheFiles.every((f) => /^[0-9a-f]{40}\.jpg$/.test(f)) && cached.status === 304 && plain.headers.get('content-type') === 'video/mp4', J([ok.status, ok.headers.get('content-type'), ok.headers.get('cache-control'), cacheFiles, cached.status, plain.headers.get('content-type')]))
    const cardImg = await (async () => { const v = await open('random'); await v.page.waitForFunction(() => { const i = document.querySelector('.gal-card[data-title="s3"] img'); return i && i.complete && i.naturalWidth > 0 }).catch(() => {}); const r = await v.page.$eval('.gal-card[data-title="s3"] img', (i) => [i.getAttribute('src'), i.naturalWidth]).catch(() => null); await v.ctx.close(); return r })()
    check('卡片：视频卡片（s3）的封面是视频的一帧（地址带 frame=1，已加载出来）', cardImg && /frame=1/.test(cardImg[0]) && cardImg[1] > 0, J(cardImg))
  }
  // 视频失败的卡片：无图状态 + 「加载失败」（诊断里说明是 ffmpeg 截帧）
  const vf = await open('random')
  await sleep(1500)
  await vf.page.$eval('.gal-browse-diag-btn', (b) => b.click())
  await vf.page.waitForFunction(() => { const d = document.querySelector('.gal-browse-diag'); return d && !d.hidden && !/加载中/.test(d.textContent) })
  const vfText = await vf.page.$eval('.gal-browse-diag', (d) => d.textContent)
  check('坏视频（s6）：卡片是无图状态，诊断里「加载失败」并说明是视频 / ffmpeg 截帧', await vf.page.$eval('.gal-card[data-title="s6"] .gal-card-thumb', (b) => b.classList.contains('empty')) && /\[加载失败\] s6/.test(vfText) && /ffmpeg/.test(vfText), vfText.slice(0, 300))
  await vf.ctx.close()
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message} @ ${(error.stack || '').split('\n')[1] || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(dataDir, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
