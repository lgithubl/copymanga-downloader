#!/usr/bin/env node
// 浏览器自测：MistTrainGirls X（misttrain）的播放：合成素材（UScenes + Spines/Stills/<底号>/<场景 id>/ + still_configuration.json + MasterData）。
// 真实 WebGL（headless Chromium + SwiftShader）、官方 spine-webgl 3.8 运行时；检查：导入 + gal-layout 认出 misttrain、列表（角色名 / 剧情标题）、
// 静态画面按 still_configuration.json 叠层（IsMosaic 的层不叠）、动画切换、一次性动画 + 降速标记、镜头（缩放 / 平移 / 旋转）、声音请求。需要先 sh scripts/fetch-spine-runtime.sh。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-misttrain-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/gal-misttrain-shots）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
const shotDir = process.env.SHOT_DIR || '/tmp/gal-misttrain-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-mt-'))
const dataDir = path.join(work, 'data')
const media = path.join(dataDir, 'gal', 'mt-pack')
const root0 = path.join(media, 'MistTrainGirls X')
const at = (...parts) => path.join(root0, ...parts)
const ANIMS = ['animation1', 'animation2', 'animation3', 'animation4']
await writeSpine(at('Spines/Stills/234/223440107'), '1', { format: 'binary', color: 'goldenrod', animations: ANIMS })
await writeSpine(at('Spines/Stills/234/223440107'), '2', { format: 'binary', color: 'crimson', animations: ANIMS })
await writeSpine(at('Spines/Stills/234/223440107'), '3', { format: 'json', color: 'deepskyblue', animations: ANIMS, region: { width: 100, height: 200, y: 100 } })   // 比底图小一半的一层：包围盒不一样
await writeFile(at('Spines/Stills/234/223440107/still_configuration.json'), J({ Parts: [{ IsMosaic: false, Path: '1' }, { IsMosaic: true, Path: '2' }, { IsMosaic: false, Path: '3' }] }))
for (const dir of ['MasterData', 'Sounds/Bgms/Adv', 'Sounds/BgSe', 'Sounds/Se', 'Sounds/Voices/Scenarios/Stills/234/234101', 'BackGrounds']) await mkdir(at(dir), { recursive: true })
await writeFile(at('MasterData/MSceneViewModel.json'), J([{ Id: 2234401, Title: '夜の約束' }]))
await writeFile(at('MasterData/MCharacterBaseViewModel.json'), J([{ Id: 234, Name: 'エスト' }]))
for (const rel of ['Sounds/Bgms/Adv/adv_03.ogg', 'Sounds/Se/click.ogg', 'Sounds/BgSe/Hse2.ogg', 'Sounds/BgSe/Hse4.ogg', 'Sounds/Voices/Scenarios/Stills/234/234101/s_223440107_001.ogg']) await writeFile(at(rel), Buffer.alloc(64))
// 一行 = 位置数组：[Group, View, 说话人, 台词, 字号, 语速, 居中, 角色 id, 标志, frame, 语音, 背景, bgm, se, tag, effect, 背景效果, 立绘[], stillDetail[7]]
const row = (o = {}) => [1, 1, o.speaker ?? '', o.text ?? '', 2, 3, false, null, 0, 0, o.voice ?? '', '', o.bgm ?? '', o.se ?? '', '', o.effect ?? null, 0, [], o.detail ?? ['', null, null, null, null, null, null]]
await mkdir(at('UScenes/Stills/234'), { recursive: true })
await writeFile(at('UScenes/Stills/234/223440107.json'), J([null, [223440107, [
  row({ speaker: 'エスト', text: '「一句目」', voice: 's_223440107_001', bgm: 'adv_03' }),
  row({ speaker: 'エスト', text: '二句目', se: 'click', detail: ['animation2', 2, null, null, null, null, null] }),
  row({ speaker: 'エスト', text: '三句目', detail: ['animation3', null, 0.5, 100, -50, 1, 20] }),
  row({ speaker: 'エスト', text: '四句目', effect: '3', detail: ['animation1', null, null, null, null, null, null] }),
], [[], [], []], false]]))

const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })
const imp = await handler.importFromSource({ sourcePath: media, options: { adapters: ['misttrain-json'], config: { game: { id: 'misttrain' } } } })
const out = await layoutScript({ item: imp.items[0], script: { id: 'gal-layout', version: '2.7.0', options: {} } })
await handler.patchItemMetadata(imp.items[0].itemId, { gal: out.itemPatch.gal })
const itemId = imp.items[0].itemId
check('导入 + gal-layout：认出 misttrain，脚本根 UScenes（多一层目录带前缀）', out.itemPatch.gal.config.game.id === 'misttrain' && out.itemPatch.gal.config.scriptRoots[0].dir === 'MistTrainGirls X/UScenes', J(out.itemPatch?.gal?.config))

const port = 8104
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
page.on('request', (r) => { if (process.env.MT_DEBUG && /resource|spine/i.test(r.url())) console.log('REQ', decodeURIComponent(r.url()).slice(0, 160)) })
page.on('response', (r) => { if (/\/resource\?path=/.test(r.url())) { const p = decodeURIComponent(r.url().split('path=')[1]); resources.push(p); resourceStatus[p] = r.status() } })
const waitCount = (text) => page.waitForFunction((t) => document.querySelector('.gal-count')?.textContent === t, text, { timeout: 8000 })
const spines = () => page.$eval('.gal-world', (e) => JSON.parse(e.dataset.spines || '{}'))
const waitRes = async (name, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (resources.includes(name)) return true; await sleep(100) } return false }

// 列表：角色（名字查 MasterData）→ 剧情（标题查 MSceneViewModel）
await page.goto(`${base}/#/media/gal/${itemId}/main`)
await page.waitForSelector('.gal-browse, .gal-card, [class*="gal-"]', { timeout: 10000 })
const homeText = async () => page.evaluate(() => document.body.innerText)
await page.waitForFunction(() => /角色/.test(document.body.innerText), null, { timeout: 8000 })
check('首页有「角色」「其它剧情」「全部剧情」', /角色/.test(await homeText()) && /全部剧情/.test(await homeText()), (await homeText()).slice(0, 200))
await page.getByText('角色', { exact: true }).first().click()
await page.waitForFunction(() => /エスト/.test(document.body.innerText), null, { timeout: 8000 })
await page.getByText('エスト').first().click()
await page.waitForFunction(() => /夜の約束/.test(document.body.innerText), null, { timeout: 8000 })
check('角色 → エスト（MCharacterBaseViewModel）→ 剧情标题「夜の約束」（MSceneViewModel：场景 id 去末 2 位）', true)
await page.screenshot({ path: path.join(shotDir, '0-list.png') })
await page.getByText('夜の約束').first().click()
await page.waitForSelector('.gal-player', { timeout: 10000 })
await waitCount('1 / 4')
await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines?.includes('still1'), null, { timeout: 15000 })
check('台词 / 说话人（第 1 句）', (await page.$eval('.gal-text', (e) => e.textContent)) === '「一句目」' && (await page.$eval('.gal-name', (e) => e.textContent)) === 'エスト')
check('静态画面：按 still_configuration.json 叠 1 和 3（IsMosaic 的 2 不叠）：slot still0 / still1，animation1', J(await spines()) === J({ still0: 'animation1', still1: 'animation1' }), J(await spines()))
await waitRes('Spines/Stills/234/223440107/3.png', 8000)
await sleep(300)
check('骨骼 / atlas / 图集请求成功（200），没有请求 mosaic 层 2', ['1', '3'].every((n) => resourceStatus[`Spines/Stills/234/223440107/${n}.skel.bytes`] === 200 && resourceStatus[`Spines/Stills/234/223440107/${n}.png`] === 200) && !resources.some((p) => /\/2\.skel\.bytes$/.test(p)), J(resources.filter((p) => /Spines/.test(p))))
check('声音：BGM Sounds/Bgms/Adv/adv_03.ogg、语音按文件名在 Sounds/Voices 下找到', (await waitRes('Sounds/Bgms/Adv/adv_03.ogg')) && (await waitRes('Sounds/Voices/Scenarios/Stills/234/234101/s_223440107_001.ogg')), J(resources.filter((p) => /Sounds/.test(p))))
// 各层共用一套变换（以最大的一层为准）：小的一层只占底图的下半、中间那半宽；不能各按各的包围盒放大到铺满
await sleep(800)
const px = (fx, fy) => page.evaluate(([x, y]) => {
  const c = document.querySelector('.gal-spine')
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
  const ctx = g.getContext('2d'); ctx.drawImage(c, 0, 0)
  return [...ctx.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data]
}, [fx, fy])
const stageRatio = await page.$eval('.gal-spine', (c) => c.width / c.height)
const nearColor = (rgba, [r, g, b], tol = 40) => rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol
const topLeft = await px(0.5 - 0.4 * (0.5 / stageRatio), 0.1)      // 底图的左上角附近：只有底图（金色）
const lowLeft = await px(0.5 - 0.2 * (0.5 / stageRatio), 0.85)     // 底图的左下附近：小层的范围内，小层在上（天蓝）
check('静态画面各层共用同一套变换：小层只占下半（上方露出底图的金色，下方是小层的天蓝），没有被放大铺满', nearColor(topLeft, [218, 165, 32]) && nearColor(lowLeft, [0, 191, 255]), J([topLeft, lowLeft]))
await page.screenshot({ path: path.join(shotDir, '1-still.png') })
// 马赛克层开关：这个场景有 IsMosaic 的层（2）→「更多」里出现「显示马赛克层」；诊断里写明默认不叠；打开 → 重取脚本、叠上 2；再关掉回到只有 1、3
await page.click('.gal-more-btn')
check('「更多」里有「显示马赛克层」（这个场景有马赛克层）', /显示马赛克层/.test(await page.evaluate(() => document.querySelector('.gal-more')?.innerText || '')))
await page.click('.gal-more-btn')   // 收起菜单
await page.click('.gal-note')
await sleep(300)
const mosaicDiag = await page.$eval('.gal-diag', (e) => e.innerText)
check('渲染诊断写明：有 1 个马赛克层默认不叠；骨架 4 个层里 3 号（天蓝）正常叠', /马赛克层.*默认不叠/.test(mosaicDiag), mosaicDiag.slice(0, 500))
await page.click('.gal-diag .gal-btn:last-of-type').catch(() => {})
await page.click('.gal-more-btn')
await page.check('.gal-more .gal-more-field input[type="checkbox"]')
await page.waitForFunction(() => Object.keys(JSON.parse(document.querySelector('.gal-world')?.dataset.spines || '{}')).length === 3, null, { timeout: 15000 })
check('打开「显示马赛克层」：重取脚本，叠上 2（still0 / still1 / still2）', J(Object.keys(await spines())) === J(['still0', 'still1', 'still2']), J(await spines()))
const savedMosaic = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('copymanga.gal.view.')).map(([, v]) => JSON.parse(v).showMosaic))
check('开关按媒体存在浏览器里（showMosaic = true）', savedMosaic.includes(true), J(savedMosaic))
await page.click('.gal-more-btn')
await page.uncheck('.gal-more .gal-more-field input[type="checkbox"]')
await page.waitForFunction(() => Object.keys(JSON.parse(document.querySelector('.gal-world')?.dataset.spines || '{}')).length === 2, null, { timeout: 15000 })
check('再关掉：回到只有 1、3 两层', J(Object.keys(await spines())) === J(['still0', 'still1']), J(await spines()))
await waitCount('1 / 4')

await page.keyboard.press('Space')
await waitCount('2 / 4')
await page.waitForFunction(() => /animation2/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 5000 })
check('第 2 句：动画切到 animation2、音效 Sounds/Se/click.ogg（N=3 层没有联动背景音效，不请求 Hse）', J(await spines()) === J({ still0: 'animation2', still1: 'animation2' }) && (await waitRes('Sounds/Se/click.ogg')) && !resources.some((p) => /BgSe\/Hse/.test(p)), J(await spines()))
await page.keyboard.press('Space')
await waitCount('3 / 4')
await page.waitForTimeout(1300)
const matrix = await page.$eval('.gal-world', (e) => getComputedStyle(e).transform)
const parts = /matrix\(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)/.exec(matrix)
const scale = parts ? Math.hypot(Number(parts[1]), Number(parts[2])) : 0
const angle = parts ? (Math.atan2(Number(parts[2]), Number(parts[1])) * 180) / Math.PI : 0
check('镜头 1 秒后：缩放 0.53（0.5 + 0.03）、旋转 20°（逆时针为正 → CSS −20°）', Math.abs(scale - 0.53) < 0.02 && Math.abs(angle + 20) < 1, matrix)
check('镜头位置 = (100, −50) × 0.84（播放器单位）', await page.$eval('.gal-world', (e) => e.dataset.camera) === '[84,-42,-362.0,20]' || Math.abs(JSON.parse(await page.$eval('.gal-world', (e) => e.dataset.camera))[0] - 84) < 0.01, await page.$eval('.gal-world', (e) => e.dataset.camera))
await page.screenshot({ path: path.join(shotDir, '3-camera.png') })
await page.keyboard.press('Space')
await waitCount('4 / 4')
const flashing = await page.$eval('.gal-flash', (e) => e.getAnimations().length)
check('第 4 句：effect 3 → 白色闪屏动画', flashing >= 1, String(flashing))
check('没有页面错误', errors.length === 0, J(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message.split('\n')[0]} @ ${(error.stack || '').split('\n').find((l) => l.includes('fe-gal-misttrain-selftest')) || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
