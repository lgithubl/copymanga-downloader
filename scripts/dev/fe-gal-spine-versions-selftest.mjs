#!/usr/bin/env node
// 浏览器自测：Spine 多版本运行时（3.8 / 4.0 / 4.2）。同一幅静态画面（misttrain 合成素材）里每层用不同版本的骨骼（JSON，颜色不同），
// 检查：按文件头识别版本并选对应运行时、三块 canvas 各画各的且共用同一套变换、诊断面板写出「识别：Spine x.y.z → 运行时 …」、
// 不支持的版本（4.1）报「版本不对」而不是缺资源、损坏的骨骼报「解析失败」、4.x 运行时下载不到时的提示。需要先 sh scripts/fetch-spine-runtime.sh。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-spine-versions-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/gal-spine-versions-shots）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as layoutScript } from '../tag-scripts/gal-layout/main.js'
import { writeSpine } from './make-spine-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!existsSync(path.join(root, 'web/static/vendor/spine-webgl.js'))) { console.error('缺 web/static/vendor/spine-webgl.js：先 sh scripts/fetch-spine-runtime.sh'); process.exit(2) }
if (!existsSync(path.join(root, 'web/static/vendor/spine-webgl-4.0.js')) || !existsSync(path.join(root, 'web/static/vendor/spine-webgl-4.2.js'))) { console.error('缺 4.0 / 4.2 运行时：先 sh scripts/fetch-spine-runtime.sh'); process.exit(2) }
const shotDir = process.env.SHOT_DIR || '/tmp/gal-spine-versions-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-spv-'))
const dataDir = path.join(work, 'data')
const media = path.join(dataDir, 'gal', 'sv-pack')
const R0 = path.join(media, 'G')
const at = (...parts) => path.join(R0, ...parts)
const ANIMS = ['animation1', 'animation2']
const SP = 'Spines/Stills/234/223440107'
// 1 = 3.8（金，底图 200×400）；3 = 4.0（天蓝，小一半）；5 = 4.2（红，更小）；7 = 4.1（不支持）；9 = 损坏的 3.8（atlas / png 都在）
await writeSpine(at(SP), '1', { format: 'json', color: 'goldenrod', animations: ANIMS, version: '3.8.99' })
await writeSpine(at(SP), '3', { format: 'json', color: 'deepskyblue', animations: ANIMS, version: '4.0.64', region: { width: 120, height: 240, y: 120 } })
await writeSpine(at(SP), '5', { format: 'json', color: 'crimson', animations: ANIMS, version: '4.2.38', region: { width: 60, height: 120, y: 60 } })
await writeSpine(at(SP), '7', { format: 'json', color: 'green', animations: ANIMS, version: '4.1.55' })
await writeSpine(at(SP), '9', { format: 'json', color: 'purple', animations: ANIMS, version: '3.8.99' })
await writeFile(at(`${SP}/9.skel.bytes`), '{"skeleton":{"spine":"3.8.99"},"bones":[{"name":"root"}],"slots":[{"name":"s","bone":"nope"}]}')   // 引用不存在的骨骼：解析失败
for (const dir of ['MasterData', 'Sounds']) await mkdir(at(dir), { recursive: true })
await writeFile(at('MasterData/MSceneViewModel.json'), '[]')
const row = (t, a) => [1, 1, '', t, 2, 3, false, null, 0, 0, '', '', '', '', '', null, 0, [], [a, null, null, null, null, null, null]]
await mkdir(at('UScenes/Stills/234'), { recursive: true })
await writeFile(at('UScenes/Stills/234/223440107.json'), J([null, [223440107, [row('a', 'animation1'), row('b', 'animation2')], [[], [], []], false]]))
await writeFile(at('Spines/Stills/234/still_configuration.json'), '{}')

const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })
const imp = await handler.importFromSource({ sourcePath: media, options: { adapters: ['misttrain-json'], config: { game: { id: 'misttrain' } } } })
const out = await layoutScript({ item: imp.items[0], script: { id: 'gal-layout', version: '2.7.0', options: {} } })
await handler.patchItemMetadata(imp.items[0].itemId, { gal: out.itemPatch.gal })
const itemId = imp.items[0].itemId

const port = 8105
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const open = async (route) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => { localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })) })
  const page = await context.newPage()
  const errors = []
  const logs = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (/gal-spine/.test(m.text())) logs.push(m.text()) })
  if (route) await route(page)
  await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent('s:Stills/234/223440107.json')}`)
  await page.waitForSelector('.gal-player', { timeout: 15000 })
  return { page, context, errors, logs }
}
const diagOf = async (page) => { await page.click('.gal-note'); const text = await page.$eval('.gal-diag-text', (e) => e.textContent); await page.click('.gal-diag button:has-text("关闭")'); return text }
const pixelAt = (page, which, fx, fy) => page.evaluate(([i, x, y]) => {
  const c = document.querySelectorAll('.gal-spine')[i]
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
  const ctx = g.getContext('2d'); ctx.drawImage(c, 0, 0)
  return [...ctx.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data]
}, [which, fx, fy])
const near = (rgba, [r, g, b], tol = 45) => rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol

// ---- 1. 三个版本同屏 ----
{
  const { page, context, errors, logs } = await open()
  await page.waitForFunction(() => document.querySelectorAll('.gal-spine').length >= 3, null, { timeout: 30000 })
  await page.waitForFunction(() => /识别/.test(document.querySelector('.gal-note')?.textContent || '') || document.querySelector('.gal-note')?.textContent, null, { timeout: 15000 })
  await sleep(2500)
  check('三个版本各一块 canvas（3.8 / 4.0 / 4.2），都标了 data-runtime', J(await page.$$eval('.gal-spine', (cs) => cs.map((c) => c.dataset.runtime).sort())) === J(['3.8', '4.0', '4.2']), J(await page.$$eval('.gal-spine', (cs) => cs.map((c) => c.dataset.runtime))))
  const runtimeIndex = (key) => page.$$eval('.gal-spine', (cs, k) => cs.findIndex((c) => c.dataset.runtime === k), key)
  const ratio = await page.$eval('.gal-spine', (c) => c.width / c.height)
  const half = 0.5 / ratio
  // 3.8 金色底图：左上角附近；4.0 天蓝（宽 120/200 = 0.6 倍，只占下面 0.6 高）：它的左下角附近；4.2 红（0.3 倍）：它的中下
  const gold = await pixelAt(page, await runtimeIndex('3.8'), 0.5 - 0.4 * half, 0.1)
  const sky = await pixelAt(page, await runtimeIndex('4.0'), 0.5 - 0.2 * half, 0.8)
  const red = await pixelAt(page, await runtimeIndex('4.2'), 0.5 - 0.1 * half, 0.9)
  check('3.8 / 4.0 / 4.2 的骨骼都画出来了，且共用同一套变换（小的层只占底图的下面一部分，没有被放大铺满）', near(gold, [218, 165, 32]) && near(sky, [0, 191, 255]) && near(red, [220, 20, 60]), J([gold, sky, red]))
  const upper4 = await pixelAt(page, await runtimeIndex('4.0'), 0.5 - 0.4 * half, 0.1)
  check('4.0 的层没有铺满整个舞台（上方是透明的，不是天蓝）', upper4[3] < 20, J(upper4))
  const diag = await diagOf(page)
  check('诊断面板：每个骨架写出「识别：Spine 版本 → 运行时」', /识别：Spine 3\.8\.99 → 运行时 3\.8/.test(diag) && /识别：Spine 4\.0\.64 → 运行时 4\.0/.test(diag) && /识别：Spine 4\.2\.38 → 运行时 4\.2/.test(diag), diag)
  check('不支持的版本（4.1.55）：诊断里写「版本不对：Spine 版本 4.1.55 不支持（支持 3.8 / 4.0 / 4.2）」，识别栏是 4.1.55 → 没有对应的运行时', /识别：Spine 4\.1\.55 → 没有对应的运行时/.test(diag) && /版本不对：Spine 版本 4\.1\.55 不支持（支持 3\.8 \/ 4\.0 \/ 4\.2）/.test(diag), diag)
  check('损坏的骨骼（图集 png 都在）：写「解析失败…Spine 3.8.99，运行时 3.8」，不冒充缺资源；缺资源清单里没有 9.png', /解析失败：骨骼解析失败（Spine 3\.8\.99，运行时 3\.8）/.test(diag) && !/9\.png/.test(diag.split('缺少资源')[1] || ''), diag)
  const noteText = await page.$eval('.gal-note', (e) => e.textContent)
  check('右下角提示：「Spine 版本不支持 1 个」「Spine 骨骼解析失败 1 个」，没有「缺少资源」', /Spine 版本不支持 1 个/.test(noteText) && /Spine 骨骼解析失败 1 个/.test(noteText) && !/缺少资源/.test(noteText), noteText)
  check('日志（console）里每个骨骼都有「识别为 Spine x.y.z → 运行时 …」', logs.some((l) => /1\.skel\.bytes.*识别为 Spine 3\.8\.99.*运行时 3\.8/.test(l)) && logs.some((l) => /3\.skel\.bytes.*识别为 Spine 4\.0\.64.*运行时 4\.0/.test(l)) && logs.some((l) => /5\.skel\.bytes.*识别为 Spine 4\.2\.38.*运行时 4\.2/.test(l)) && logs.some((l) => /7\.skel\.bytes.*识别为 Spine 4\.1\.55.*没有对应的运行时/.test(l)), J(logs))
  await page.screenshot({ path: path.join(shotDir, '1-three-versions.png') })
  check('没有页面错误', errors.length === 0, J(errors))
  await context.close()
}

// ---- 2. 4.0 运行时下载不到：只影响 4.0 的骨骼，别的版本照常画；提示写缺哪个版本 ----
{
  const { page, context, errors } = await open((p) => p.route('**/vendor/spine-webgl-4.0.js', (route) => route.abort()))
  await page.waitForFunction(() => document.querySelectorAll('.gal-spine').length >= 2, null, { timeout: 30000 })
  await sleep(2500)
  const diag = await diagOf(page)
  const noteText = await page.$eval('.gal-note', (e) => e.textContent)
  check('4.0 运行时取不到：提示「Spine 运行时缺失」且写明缺 4.0；3.8 / 4.2 的照常画', /Spine 运行时缺失/.test(noteText) && /缺 4\.0/.test(diag) && (await page.$$eval('.gal-spine', (cs) => cs.map((c) => c.dataset.runtime))).includes('3.8') && (await page.$$eval('.gal-spine', (cs) => cs.map((c) => c.dataset.runtime))).includes('4.2'), noteText + diag)
  check('4.0 运行时取不到时没有页面错误', errors.length === 0, J(errors))
  await context.close()
}

// ---- 3. 预乘 alpha 识别：按原始尺寸检测，不被「缩小后边缘像素平均」骗到 ----
{
  const png = async (name, pixel) => {
    const size = 2048
    const raw = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(pixel(x, y), (y * size + x) * 4)
    const rawFile = path.join(work, `${name}.rgba`)
    await writeFile(rawFile, raw)
    execFileSync('convert', ['-size', `${size}x${size}`, '-depth', '8', `rgba:${rawFile}`, path.join(work, `${name}.png`)])
    return (await readFile(path.join(work, `${name}.png`))).toString('base64')
  }
  // 预乘：棋盘格，一格不透明白、一格 alpha = 1 的黑（RGB ≤ alpha）。缩小一半以上后平均出「alpha ≈ 128、RGB ≈ 254」，缩小检测会认成直通
  const premultiplied = await png('pma-checker', (x, y) => ((x + y) & 1 ? [255, 255, 255, 255] : [0, 0, 0, 1]))
  // 直通：一格不透明白、一格 alpha = 128 的白（RGB 255 > alpha）
  const straight = await png('straight-checker', (x, y) => ((x + y) & 1 ? [255, 255, 255, 255] : [255, 255, 255, 128]))
  const { page, context } = await open()
  const result = await page.evaluate(async ({ premultiplied, straight }) => {
    const { detectPremultipliedImage } = await import('/gal-spine.js')
    const load = async (b64) => { const image = new Image(); image.src = `data:image/png;base64,${b64}`; await image.decode(); return image }
    // 对照：旧办法（缩小到 1024 再检测）在预乘棋盘格上会判错
    const old = (image) => { const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(image, 0, 0, 1024, 1024); const d = g.getImageData(0, 0, 1024, 1024).data; let semi = 0; let bad = 0; for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a === 0 || a === 255) continue; semi++; if (Math.max(d[i], d[i + 1], d[i + 2]) > a + 16) bad++ } return semi >= 50 && bad / semi < 0.002 }
    const pm = await load(premultiplied)
    const st = await load(straight)
    return { pmFull: detectPremultipliedImage(pm), stFull: detectPremultipliedImage(st), pmOld: old(pm) }
  }, { premultiplied, straight })
  check('预乘识别（2048² 棋盘格）：预乘 → true，直通 → false；而「缩小到 1024 再检测」的旧办法会把这张预乘图判成直通', result.pmFull === true && result.stFull === false && result.pmOld === false, J(result))
  await context.close()
}
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message.split('\n')[0]} @ ${(error.stack || '').split('\n').find((l) => l.includes('fe-gal-spine-versions-selftest')) || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
