#!/usr/bin/env node
// 浏览器自测：Gal 播放器的 Spine 渲染（tenkeiprdx 合成素材）。真实 WebGL（headless Chromium + SwiftShader）、官方 spine-webgl 3.8 运行时，
// 骨骼文件两种格式（二进制 + JSON）都读；检查：立绘位置/颜色（读 canvas 像素）、表情动画、立绘隐藏、静态画面两层叠、镜头变换、
// 背景音效请求、闪屏动画、后退一步到位、运行时缺失时的降级提示。需要先 sh scripts/fetch-spine-runtime.sh。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-spine-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/gal-spine-shots）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as tenkeiScript } from '../tag-scripts/gal-layout/main.js'
import { buildTenkeiFixture } from './make-spine-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!existsSync(path.join(root, 'web/static/vendor/spine-webgl.js'))) { console.error('缺 web/static/vendor/spine-webgl.js：先 sh scripts/fetch-spine-runtime.sh'); process.exit(2) }
const shotDir = process.env.SHOT_DIR || '/tmp/gal-spine-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-spine-'))
const dataDir = path.join(work, 'data')
const media = path.join(dataDir, 'gal', 'tenkei-pack')
await mkdir(media, { recursive: true })
await buildTenkeiFixture(media)

// 先在数据目录里建好条目（导入 + 脚本写 config），再起服务
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })
const imp = await handler.importFromSource({ sourcePath: media, options: { adapters: ['tenkeiprdx-json'], config: { game: { id: 'tenkeiprdx' } } } })
const out = await tenkeiScript({ item: imp.items[0], script: { id: 'gal-layout', version: '1.0.0', options: {} } })
await handler.patchItemMetadata(imp.items[0].itemId, { gal: out.itemPatch.gal })
const itemId = imp.items[0].itemId

const port = 8103
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.addInitScript(() => { localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })) })
const page = await context.newPage()
const errors = []
const resources = []
const resourceStatus = {}
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => { if (/\/resource\?path=/.test(r.url())) { const p = decodeURIComponent(r.url().split('path=')[1]); resources.push(p); resourceStatus[p] = r.status() } })
const link = (section) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(section)}`
const count = () => page.$eval('.gal-count', (e) => e.textContent)
const waitCount = (text) => page.waitForFunction((t) => document.querySelector('.gal-count')?.textContent === t, text, { timeout: 8000 })
const spines = () => page.$eval('.gal-world', (e) => JSON.parse(e.dataset.spines || '{}'))
const loaded = () => page.evaluate(() => document.querySelector('.gal-spine') ? true : false)
const pixel = (fx, fy) => page.evaluate(([x, y]) => {
  const c = document.querySelector('.gal-spine')
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
  const ctx = g.getContext('2d'); ctx.drawImage(c, 0, 0)
  return [...ctx.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data]
}, [fx, fy])
const near = (rgba, [r, g, b], tol = 28) => rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol
const waitPixel = async (fx, fy, want, ms = 8000) => {
  const end = Date.now() + ms
  let last = []
  while (Date.now() < end) { last = await pixel(fx, fy).catch(() => []); if (near(last, want)) return { ok: true, last }; await sleep(150) }
  return { ok: false, last }
}
const CRIMSON = [220, 20, 60]
const SEAGREEN = [46, 139, 87]
const GOLD = [218, 165, 32]
const SKY = [0, 191, 255]
const waitRes = async (name, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (resources.includes(name)) return true; await sleep(100) } return false }

// ---- 1. 剧情：站位立绘（二进制骨骼 + JSON 骨骼）----
await page.goto(link('s:10010101.json'))
await page.waitForSelector('.gal-player')
await waitCount('1 / 4')
await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines?.includes('Chara1'))
const c1 = await waitPixel(0.3, 0.8, CRIMSON)
check('Spine 运行时已加载（官方 spine-webgl，第一次要画骨骼时才加载）', await page.evaluate(() => Boolean(window.spine?.webgl && window.spine.SkeletonBinary && window.spine.SkeletonJson)))
check('第 1 句：站位 1（左 0.3）画出了二进制骨骼的立绘（颜色 = 素材颜色）', c1.ok, J(c1.last))
check('第 1 句：表情 1 → idle_joy；canvas 在背景之上、不挡点击', J(await spines()) === J({ Chara1: 'idle_joy' }) && (await page.$eval('.gal-spine', (c) => getComputedStyle(c).pointerEvents)) === 'none')
check('台词/说话人正常', (await page.$eval('.gal-text', (e) => e.textContent)) === 'Hello there' && (await page.$eval('.gal-name', (e) => e.textContent)) === 'Alice')
await page.screenshot({ path: path.join(shotDir, '1-chara.png') })
// 诊断面板：骨骼明细（路径、要的 / 实际的动画、骨架里有哪些动画和皮肤），名字对不上时看得出来
await page.waitForFunction(() => /骨骼 \d+ 个|暂未渲染/.test(document.querySelector('.gal-note')?.textContent || ''), null, { timeout: 5000 }).catch(() => {})
await page.click('.gal-note')
const diag = await page.$eval('.gal-diag-text', (e) => e.textContent)
check('诊断面板列出 Spine 骨架明细：骨架路径、要的 → 实际动画、动画列表、皮肤、版本', /Spine 骨架 \d+ 个/.test(diag) && /Spines\/1001\/1001_01\.skel\.bytes/.test(diag) && /动画：要 idle_joy → 实际 idle_joy/.test(diag) && /骨架里的动画/.test(diag) && /皮肤：/.test(diag), diag.slice(0, 500))
await page.click('.gal-diag button:has-text("关闭")')
// 动画名对不上时：退到 idle*，再退到第一个（不能停在「初始姿势」——部件散开，看起来不是人）；默认皮肤是空的就改用有内容的皮肤
const picks = await page.evaluate(async () => {
  const { pickSpineAnimation, pickSpineSkin } = await import('/gal-spine.js')
  const data = (names) => ({ animations: names.map((name) => ({ name })), findAnimation: (n) => names.includes(n) ? { name: n } : null })
  const skin = (n, count) => ({ name: n, attachments: count ? [{ a: 1 }] : [{}] })
  const empty = skin('default', 0); const full = skin('costume', 1)
  return [
    pickSpineAnimation(data(['idle_normal', 'idle_joy']), 'idle_joy', 'chara'),
    pickSpineAnimation(data(['idle_normal', 'idle_joy']), 'idle_unknown', 'chara'),
    pickSpineAnimation(data(['Idle', 'talk']), 'idle_joy', 'chara'),
    pickSpineAnimation(data(['stand_idle_01', 'talk']), 'idle_joy', 'chara'),
    pickSpineAnimation(data(['talk', 'wave']), 'idle_joy', 'chara'),
    pickSpineAnimation(data(['animation1', 'animation2']), 'animation9', 'still'),
    pickSpineAnimation(data([]), 'x', 'chara'),
    pickSpineSkin({ defaultSkin: empty, skins: [empty, full] })?.name || null,
    pickSpineSkin({ defaultSkin: full, skins: [full, empty] })?.name || null,
    pickSpineSkin({ defaultSkin: empty, skins: [empty] })?.name || null,
  ]
})
check('选动画 / 皮肤的兜底：指定的有就用；没有 → idle_normal → idle* → 名字里带 idle → 第一个；默认皮肤为空才换皮肤', J(picks) === J(['idle_joy', 'idle_normal', 'Idle', 'stand_idle_01', 'talk', 'animation1', '', 'costume', null, null]), J(picks))

await page.keyboard.press('Space')
await waitCount('2 / 4')
const c2 = await waitPixel(0.7, 0.8, SEAGREEN)
check('第 2 句：站位 2（右 0.7）画出了 JSON 骨骼的立绘；左边的仍在', c2.ok && near(await pixel(0.3, 0.8), CRIMSON), J(c2.last))
check('第 2 句：表情切换 idle_sad / idle_normal；说话人用 username.txt 的名字；\\n 换行', J(await spines()) === J({ Chara1: 'idle_sad', Chara2: 'idle_normal' }) && (await page.$eval('.gal-name', (e) => e.textContent)) === 'Tester' && (await page.$eval('.gal-text', (e) => e.textContent)) === 'Line one\nline two')
check('第 2 句：语音请求了 AdventureVoice/<场景id>/…', resources.includes('AdventureVoice/10010101/v002.ogg') && resourceStatus['AdventureVoice/10010101/v002.ogg'] === 200, J(resources.slice(-8)))
await page.screenshot({ path: path.join(shotDir, '2-two-charas.png') })

await page.keyboard.press('Space')
await waitCount('3 / 4')
await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines === '{}')
check('第 3 句：adventureCharacters 为空 → 立绘全部隐藏；音效请求了 Se/', (await page.$eval('.gal-spine', (c) => c.hidden)) && (await waitRes('Se/se_click.ogg')))

await page.keyboard.press('ArrowLeft')
await waitCount('2 / 4')
const back = await waitPixel(0.7, 0.8, SEAGREEN)
check('后退一步：立绘一步到位恢复（两个都在）', back.ok && near(await pixel(0.3, 0.8), CRIMSON), J(back.last))
await page.keyboard.press('ArrowLeft')
await waitCount('1 / 4')
await page.waitForFunction(() => Object.keys(JSON.parse(document.querySelector('.gal-world').dataset.spines || '{}')).join() === 'Chara1')
check('再后退到第 1 句：只剩左边一个', (await waitPixel(0.3, 0.8, CRIMSON)).ok)
check('骨骼 / atlas / 图集都请求成功（200）', ['Spines/1001/1001_01.skel.bytes', 'Spines/1001/1001_01.atlas.txt', 'Spines/1001/1001_01.png', 'Spines/1002/1002_01.skel.bytes'].every((p) => resourceStatus[p] === 200), J(resourceStatus))
check('BGM 找不到 bgm_a.ogg 但有 _loop 版：请求的是 _loop', resources.includes('BGM/bgm_a_loop.ogg') && !resources.includes('BGM/bgm_a.ogg'))

// ---- 2. 静态画面：两层骨架、镜头、联动背景音效、闪屏 ----
await page.goto(link('s:20010001.json'))
await page.waitForSelector('.gal-player')
await waitCount('1 / 4')
await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines?.includes('still1'))
const top = await waitPixel(0.5, 0.75, SKY)
check('静态画面：两层骨架（序号小的在下、大的在上）：舞台中下部看到上层颜色（中心恰好是图上的白圆）', top.ok, J([top.last, Object.entries(resourceStatus).filter(([k]) => k.startsWith('Stills'))]))
check('静态画面：slot 是 still0 / still1，动画 animation1', J(await spines()) === J({ still0: 'animation1', still1: 'animation1' }))
await page.waitForTimeout(2300)
const matrix = await page.$eval('.gal-world', (e) => getComputedStyle(e).transform)
const scaleOf = (m) => Number(/matrix\(([-\d.]+)/.exec(m)?.[1])
check('镜头：2 秒后缩放到 1 + 200/1000×1.3 = 1.26', Math.abs(scaleOf(matrix) - 1.26) < 0.01, matrix)
await page.screenshot({ path: path.join(shotDir, '3-still.png') })

await page.keyboard.press('Space')
await waitCount('2 / 4')
check('animation2：联动背景音效 Hse2', (await waitRes('BgSe/Hse2.ogg')) && resourceStatus['BgSe/Hse2.ogg'] === 200)
await page.keyboard.press('Space')
await waitCount('3 / 4')
const flashing = await page.$eval('.gal-flash', (e) => e.getAnimations().length)
check('animation4：Hse4 + 闪屏动画', (await waitRes('BgSe/Hse4.ogg')) && flashing >= 1, J([resources.includes('BgSe/Hse4.ogg'), flashing]))
await page.keyboard.press('Space')
await waitCount('4 / 4')
await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines === '{}' && document.querySelector('.gal-world').dataset.camera === '[0,0,0]' && document.querySelector('.gal-text').textContent === 'Back to a background')
check('离开静态画面：骨架清掉、镜头归零、背景恢复', (await page.$eval('.gal-world', (e) => e.dataset.camera)) === '[0,0,0]' && (await page.$eval('.gal-text', (e) => e.textContent)) === 'Back to a background')
await page.keyboard.press('ArrowLeft')
await waitCount('3 / 4')
check('后退回静态画面：骨架一步到位恢复', (await waitPixel(0.5, 0.75, SKY)).ok)

// ---- 3. 浏览：列表（活动 / 附加 / 角色 / 全部剧情）、名字、缩略图、角标、上一级 ----
await page.goto(`${base}/#/media/gal/${itemId}/main`)
await page.waitForSelector('.gal-browse')
const titles = () => page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))
const loadedImgs = async () => { for (let i = 0; i < 40; i++) { if (await page.$$eval('.gal-browse img', (is) => is.length > 0 && is.every((x) => x.complete && x.naturalWidth > 0))) return true; await sleep(150) } return false }
check('浏览首页 = 适配器的列表：活动 / 附加 / 角色 / 全部剧情', J(await titles()) === J(['活动', '附加', '角色', '全部剧情']), J(await titles()))
await page.click('.gal-card[data-node="v:event"]')
await page.waitForSelector('.gal-card.is-script')
const ev = await page.$$eval('.gal-card', (es) => es.map((e) => [e.querySelector('.gal-card-title')?.textContent, e.querySelector('.gal-card-badge')?.textContent || '', e.querySelector('img')?.naturalWidth > 0]))
check('活动：标题来自名称表、角标 event、缩略图加载出来了；面包屑 首页›活动', J(ev) === J([['The First Event', 'event', true]]) && (await page.$$eval('.gal-browse-crumb', (es) => es.map((e) => e.textContent).join('>'))) === '首页>活动', J(ev))
await page.click('.gal-browse-up')
await page.waitForSelector('.gal-card[data-node="v:chars"]')
await page.click('.gal-card[data-node="v:chars"]')
await page.waitForSelector('.gal-card[data-node="v:chars%2F10010001"]')
check('角色列表：名字 + 称号 + EX 剧情数，头像加载出来了（Bob 在前：新的在前）', J(await titles()) === J(['Bob', 'Alice']) && (await page.$$eval('.gal-card-sub', (es) => es.map((e) => e.textContent))).join() === 'Rival · 0 项,Heroine · 1 项' && (await loadedImgs()), J([await titles(), await page.$$eval('.gal-card-sub', (es) => es.map((e) => e.textContent))]))
await page.screenshot({ path: path.join(shotDir, '4-chars.png') })
await page.click('.gal-card[data-node="v:chars%2F10010001"]')
await page.waitForSelector('.gal-card.is-script')
check('角色页：这个角色的 EX 剧情 + 缩略图；面包屑 首页›角色›Alice', J(await titles()) === J(['Alice EX']) && (await loadedImgs()) && (await page.$$eval('.gal-browse-crumb', (es) => es.map((e) => e.textContent).join('>'))) === '首页>角色>Alice')
await page.click('.gal-card[data-title="Alice EX"]')
await page.waitForSelector('.gal-player .gal-stage')
await page.waitForFunction(() => /\/ 4$/.test(document.querySelector('.gal-count')?.textContent || ''))   // 前面看过这个剧情：可能从上次的位置续播
check('点进剧情：标题是列表里的名字；「↑ 列表」回到角色页（不是目录）', (await page.$eval('#media-reader-title', (e) => e.textContent)) === 'Alice EX' && (await page.$eval('.gal-up', (b) => !b.hidden)))
await page.click('.gal-up')
await page.waitForSelector('.gal-browse')
check('「↑ 列表」：回到收它的角色页', (await page.$$eval('.gal-browse-crumb', (es) => es.map((e) => e.textContent).join('>'))) === '首页>角色>Alice')
await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent('v:all')}`)
await page.waitForFunction(() => document.querySelectorAll('.gal-card.is-script').length === 3)
check('全部剧情：scenes/ 下三个，已知的用名字、角标', J(await titles()) === J(['Alice EX', 'The First Event', 'An Extra Story']) && (await page.$$eval('.gal-card-badge', (es) => es.map((e) => e.textContent))).join() === 'event,extra')

// ---- 4. 没有运行时：降级 ----
const page2 = await context.newPage()
const errors2 = []
page2.on('pageerror', (e) => errors2.push(e.message))
await page2.route('**/vendor/spine-webgl.js', (route) => route.abort())
await page2.goto(link('s:10010101.json'))
await page2.waitForSelector('.gal-player')
await page2.waitForFunction(() => /Spine 运行时缺失/.test(document.querySelector('.gal-note')?.textContent || '') && document.querySelector('.gal-text')?.textContent.length > 0, null, { timeout: 8000 })
check('没有 Spine 运行时：提示「Spine 运行时缺失」（只有这一条提示，音频都放得出来），台词照常，不报页面错误', (await page2.$eval('.gal-text', (e) => e.textContent)).length > 0 && (await page2.$eval('.gal-note', (e) => e.textContent)) === 'Spine 运行时缺失：立绘/动画未渲染' && errors2.length === 0, J([errors2, await page2.$eval('.gal-note', (e) => e.title)]))
await page2.close()

check('没有页面错误', errors.length === 0, J(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message.split('\n')[0]} @ ${(error.stack || '').split('\n').find((l) => l.includes('fe-gal-spine-selftest')) || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
