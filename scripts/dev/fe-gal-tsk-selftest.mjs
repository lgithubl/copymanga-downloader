#!/usr/bin/env node
// 浏览器自测：Twinkle Star Knights X（Utage *.book.json，utage-book）的播放：合成素材（Adventure/*.book.json + Master.chapter.json + Characters / Stills 的 Spine 4.0.37 JSON 骨架 + Sound）。
// 真实 WebGL（headless Chromium + SwiftShader）、官方 spine-webgl 4.0 运行时；检查：导入 + gal-layout 认出 tsk、列表（剧情文件夹 → 剧情）、旁白 / 台词 / 说话人（NameText、<Character=>、<Off>）、
// 立绘站位（读 canvas 像素）、Bg / Bgm / Se / BgSe / BgVoice / 语音的请求、Tween / Shake / ZoomCamera、BgEvent 静态画面（含隐藏文本框）、grid 之间清场、
// Selection 分支（选 2 → 只走 2 的分支；连续 Selection 选 3）、渲染诊断里的 raw / 缺资源。需要先 sh scripts/fetch-spine-runtime.sh。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-tsk-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/gal-tsk-shots）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as layoutScript } from '../tag-scripts/gal-layout/main.js'
import { buildTskFixture } from './make-tsk-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!existsSync(path.join(root, 'web/static/vendor/spine-webgl-4.0.js'))) { console.error('缺 web/static/vendor/spine-webgl-4.0.js：先 sh scripts/fetch-spine-runtime.sh'); process.exit(2) }
const shotDir = process.env.SHOT_DIR || '/tmp/gal-tsk-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-tsk-'))
const dataDir = path.join(work, 'data')
const media = path.join(dataDir, 'gal', 'tsk-pack')
await buildTskFixture(media)

const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })
const imp = await handler.importFromSource({ sourcePath: media, options: { adapters: ['utage-book'], config: { game: { id: 'tsk' } } } })
const out = await layoutScript({ item: imp.items[0], script: { id: 'gal-layout', version: '2.8.0', options: {} } })
await handler.patchItemMetadata(imp.items[0].itemId, { gal: out.itemPatch.gal })
const itemId = imp.items[0].itemId
check('导入 + gal-layout：认出 tsk，脚本根 Adventure、资源根 = StreamingAssets/<游戏名>、脚本数 4', out.itemPatch.gal.config.game.id === 'tsk' && out.itemPatch.gal.config.scriptRoots[0].dir.endsWith('/StreamingAssets/Twinkle Star Knights X/Adventure') && out.itemPatch.gal.config.scriptCount === 4, J(out.itemPatch.gal.config))

const port = 8147
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
  const SA = 'Twinkle Star Knights X'
  const waitCount = (text) => page.waitForFunction((t) => document.querySelector('.gal-count')?.textContent === t, text, { timeout: 10000 })
  const spines = () => page.$eval('.gal-world', (e) => JSON.parse(e.dataset.spines || '{}'))
  const waitRes = async (name, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (resources.includes(name)) return true; await sleep(100) } return false }
  const text = (sel) => page.$eval(sel, (e) => e.textContent)
  const next = async (count) => { await page.keyboard.press('Space'); await waitCount(count) }
  const px = (fx, fy) => page.evaluate(([x, y]) => {
    const c = document.querySelector('.gal-spine')
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
    const ctx = g.getContext('2d'); ctx.drawImage(c, 0, 0)
    return [...ctx.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data]
  }, [fx, fy])
  const nearColor = (rgba, [r, g, b], tol = 45) => rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol
  const waitColor = async (fx, fy, rgb) => { const end = Date.now() + 8000; let last; while (Date.now() < end) { last = await px(fx, fy); if (nearColor(last, rgb)) return { ok: true, last }; await sleep(150) } return { ok: false, last } }
  const CRIMSON = [220, 20, 60]
  const GOLD = [218, 165, 32]
  const SKY = [0, 191, 255]

  // 列表：首页 = 剧情文件夹（BackGrounds / Effects 不出现）→ 主线 → 剧情
  await page.goto(`${base}/#/media/gal/${itemId}/main`)
  await page.waitForFunction(() => /主线/.test(document.body.innerText), null, { timeout: 10000 })
  const home = await page.evaluate(() => document.body.innerText)
  check('首页：角色剧情 / 主线 / 全部剧情（剧情文件夹），没有 BackGrounds / Effects / Master.chapter', /角色剧情/.test(home) && /全部剧情/.test(home) && !/BackGrounds|Effects|Master/.test(home), home.slice(0, 200))
  await page.getByText('主线', { exact: true }).first().click()
  await page.waitForFunction(() => /MainScenario0001/.test(document.body.innerText), null, { timeout: 8000 })
  await page.screenshot({ path: path.join(shotDir, '0-list.png') })
  await page.getByText('MainScenario0001').first().click()
  await page.waitForSelector('.gal-player', { timeout: 10000 })
  await waitCount('1 / 12')
  await sleep(1500)   // 第一步有背景渐变 0.5 秒，BGM 在它之后才开始请求；播放中按下一句只是「跳过动画」

  // 1 旁白 + 背景 + BGM
  check('第 1 步：旁白（说话人空）；背景按 Texture 表（Adventure/BackGrounds/…）、BGM 播 loop 文件', (await text('.gal-text')) === '雨の音だけが聞こえる。' && (await text('.gal-name')) === '' && (await waitRes('Adventure/BackGrounds/bg_adv_001_1.png')) && (await waitRes('Sound/Bgm/BGM_A001_loop.ogg')) && resourceStatus['Adventure/BackGrounds/bg_adv_001_1.png'] === 200, J(resources))
  // 2 立绘行 + 台词 + 语音
  await next('2 / 12')
  await page.waitForFunction(() => /Chara1/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 10000 })
  check('第 2 步：台词 + 说话人（Master NameText「ミナ」）；Chara1 = 角色骨架（Characters/ch_1001001/ch_1001001_m0，动画 wait）；语音按文件名找到', (await text('.gal-text')) === '“こんにちは”' && (await text('.gal-name')) === 'ミナ' && J(await spines()) === J({ Chara1: 'wait' }) && (await waitRes('Characters/ch_1001001/ch_1001001_m0.skel.bytes')) && (await waitRes('Sound/Voice/ImportChara/1001001/a001_002_0277.ogg')) && resourceStatus['Characters/ch_1001001/ch_1001001_m0.skel.bytes'] === 200, J([await spines(), resources.filter((p) => /Characters|Voice/.test(p))]))
  const centre = await waitColor(0.5, 0.2, CRIMSON)
  check('Chara1（Arg4 空 = 居中）：舞台正中是 Chara1 的颜色', centre.ok, J(centre.last))
  // 3 三个站位
  await next('3 / 12')
  await page.waitForFunction(() => Object.keys(JSON.parse(document.querySelector('.gal-world')?.dataset.spines || '{}')).length === 3, null, { timeout: 10000 })
  const right = await waitColor(0.5 + 250 / 1280, 0.2, SKY)
  const left = await waitColor(0.5 - 250 / 1280, 0.2, GOLD)
  check('第 3 步：Arg4 = 250 → 右（x = 0.695）是 Chara2（天蓝），Arg4 = -250 → 左（x = 0.305）是 Chara3（金色）；说话人「ルカ」', right.ok && left.ok && (await text('.gal-name')) === 'ルカ' && J(Object.keys(await spines()).sort()) === J(['Chara1', 'Chara2', 'Chara3']), J([right.last, left.last, await spines()]))
  await page.screenshot({ path: path.join(shotDir, '1-stands.png') })
  // 4 <Off> / 5 NameText 空 / 6 <Character=>
  await next('4 / 12')
  check('第 4 步：Arg2 = <Off>：说话人「ゼロ」、不摆立绘（槽位不变，没有请求 ch_9999999）', (await text('.gal-name')) === 'ゼロ' && (await text('.gal-text')) === '“画面の外から”' && Object.keys(await spines()).length === 3 && !resources.some((p) => /ch_9999999/.test(p)), J(await spines()))
  await next('5 / 12')
  check('第 5 步：Master 里 NameText 空：说话人取名字里 - 前面的「ノア」', (await text('.gal-name')) === 'ノア')
  await next('6 / 12')
  check('第 6 步：Arg2 = <Character=ルカ-制服>：说话人显示「ルカ」（Arg1 是ミナ）', (await text('.gal-name')) === 'ルカ' && (await text('.gal-text')) === '“名前だけルカ”')
  // 7 Tween / Shake / ZoomCamera / 声音
  await page.evaluate(() => { window.__shake = 0; const t = setInterval(() => { const n = document.querySelector('.gal-world')?.getAnimations().length || 0; if (n > window.__shake) window.__shake = n }, 20); setTimeout(() => clearInterval(t), 4000) })
  await next('7 / 12')
  await sleep(1200)
  const moved = await px(0.5 + 250 / 1280, 0.2)
  const camera = JSON.parse(await page.$eval('.gal-world', (e) => e.dataset.camera || '[]'))
  const matrix = await page.$eval('.gal-world', (e) => getComputedStyle(e).transform)
  const scale = (() => { const m = /matrix\(([-\d.]+), ([-\d.]+)/.exec(matrix); return m ? Math.hypot(Number(m[1]), Number(m[2])) : 0 })()
  check('第 7 步：Tween MoveTo x=-250：Chara2 从右边（0.695）移到左边（那里已经没有天蓝）', moved[3] < 60 || !nearColor(moved, SKY), J(moved))
  check('第 7 步：ZoomCamera 模式 2 + 200% → camera z = 769（CSS 缩放 2.0）', Math.abs((camera[2] || 0) - 769.23) < 0.5 && Math.abs(scale - 2) < 0.05, J([camera, matrix]))
  check('第 7 步：Se（Master Sound 表）/ BgSe / BgVoice 请求到对应文件', (await waitRes('Sound/Se/SE_0001.ogg')) && (await waitRes('Sound/BgSe/SE_3022.ogg')) && (await waitRes('Sound/BgVoice/b001_002_0068.ogg')), J(resources.filter((p) => /Sound/.test(p))))
  check('第 7 步：Shake Graphics → 画面抖动动画（.gal-world 上出现过 Web Animation）', (await page.evaluate(() => window.__shake)) >= 1, String(await page.evaluate(() => window.__shake)))
  await page.screenshot({ path: path.join(shotDir, '2-zoom.png') })
  // 8 BgEvent 静态画面 + 隐藏文本框；镜头回 0；立绘收掉
  await page.keyboard.press('Space')
  await waitCount('8 / 12')
  await page.waitForFunction(() => /still0/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 15000 })
  await sleep(300)
  check('第 8 步：BgEvent st_1001001 cut_2_loop → Stills/st_1001001/ 的静态画面（kind still，slot still0），立绘全部收掉', J(await spines()) === J({ still0: 'cut_2_loop' }) && (await waitRes('Stills/st_1001001/st_1001001.skel.bytes')) && resourceStatus['Stills/st_1001001/st_1001001.skel.bytes'] === 200, J([await spines(), resources.filter((p) => /Stills/.test(p))]))
  check('第 8 步：ZoomCamera 模式 1 → 镜头回原位；HideMessageWindow → 文本框隐藏', (JSON.parse(await page.$eval('.gal-world', (e) => e.dataset.camera || '[]'))[2] || 0) === 0 && (await page.$eval('.gal-box', (b) => b.style.opacity === '0')), await page.$eval('.gal-box', (b) => b.style.cssText))
  await page.screenshot({ path: path.join(shotDir, '3-still.png') })
  await next('9 / 12')
  await page.waitForFunction(() => /cut_1/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 5000 })
  check('第 9 步：同一幅静态画面换动画 cut_1', J(await spines()) === J({ still0: 'cut_1' }), J(await spines()))
  await next('10 / 12')
  await sleep(500)
  check('第 10 步：ShowMessageWindow → 文本框回来；BgEventOff → 静态画面收掉；立绘重新摆（Chara1）；缺的语音不崩', await page.$eval('.gal-box', (b) => b.style.opacity !== '0') && J(Object.keys(await spines())) === J(['Chara1']) && (await text('.gal-text')) === '“資源の欠け”', J(await spines()))
  await next('11 / 12')
  check('第 11 步：<ruby=こえ>声</ruby> → ruby 注音；<color=red> → 红色', await page.$eval('.gal-text', (e) => Boolean(e.querySelector('ruby')) && [...e.querySelectorAll('span')].some((s) => /red|255, 0, 0/.test(s.style.color))), await page.$eval('.gal-text', (e) => e.innerHTML))
  await next('12 / 12')
  await sleep(500)
  check('第 12 步：下一个 grid 开头清场（立绘去掉）；台词照常', J(await spines()) === '{}' && /二つ目の grid/.test(await text('.gal-text')), J(await spines()))
  // 渲染诊断：raw 指令 / 缺资源
  await page.click('.gal-note')
  const diag = await page.$eval('.gal-diag-text', (e) => e.textContent)
  check('渲染诊断：暂未渲染的指令里有 FooBar / Sprite；缺资源里有缺的语音 zz_missing_voice 和背景 bg_adv_099_1', /FooBar/.test(diag) && /Sprite/.test(diag) && /zz_missing_voice/.test(diag) && /bg_adv_099_1/.test(diag), diag.slice(0, 900))
  await page.click('.gal-diag button:has-text("关闭")').catch(() => {})

  // 分支：交错写法（选 2 → 只走 2 的分支，一番的分支整步跳过）
  const openScene = async (title) => {
    await page.goto(`${base}/#/media/gal/${itemId}/main`)
    await page.waitForFunction(() => /全部剧情/.test(document.body.innerText), null, { timeout: 10000 })
    await page.getByText('全部剧情', { exact: true }).first().click()
    await page.waitForFunction((t) => document.body.innerText.includes(t), title, { timeout: 8000 })
    await page.getByText(title, { exact: true }).first().click()
    await page.waitForSelector('.gal-player', { timeout: 10000 })
  }
  const choices = () => page.$$eval('.gal-choice', (bs) => bs.map((b) => b.textContent))
  await openScene('CharaScenario1002001')
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent === '選んで。', null, { timeout: 10000 })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => { const c = document.querySelector('.gal-choices'); return c && !c.hidden }, null, { timeout: 5000 })
  check('Selection：弹出 2 个选项（一番 / 二番）', J(await choices()) === J(['1一番', '2二番']), J(await choices()))
  await page.screenshot({ path: path.join(shotDir, '4-choice.png') })
  await page.click('.gal-choice[data-value="2"]')
  await sleep(500)
  await page.keyboard.press('Space')   // 选完还停在选项这一步（文本框是空的），点一下才进分支
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent === '二番の答え。', null, { timeout: 5000 })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent === '二番の続き。', null, { timeout: 5000 })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent === '合流した後の台詞。', null, { timeout: 5000 })
  check('选 2：走「二番」的分支（答え → 続き），汇合后接「合流した後の台詞。」；一番的分支整步跳过', (await page.$eval('.gal-count', (e) => e.textContent)) === '5 / 5', await page.$eval('.gal-count', (e) => e.textContent))
  // 连续 Selection（相邻写法）：3 个选项，选 3
  await openScene('CharaScenario1002002')
  await page.waitForFunction(() => { const c = document.querySelector('.gal-choices'); return c && !c.hidden }, null, { timeout: 10000 })
  check('连续的 Selection：一次弹出 3 个选项（甲 / 乙 / 丙）', J(await choices()) === J(['1甲', '2乙', '3丙']), J(await choices()))
  await page.click('.gal-choice[data-value="3"]')
  await sleep(500)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent === '丙。', null, { timeout: 5000 })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent === '全員の後。', null, { timeout: 5000 })
  check('选 3：只走「丙」的分支，然后汇合到「全員の後。」（甲 / 乙的分支整步跳过：共 3 步）', (await page.$eval('.gal-count', (e) => e.textContent)) === '3 / 3', await page.$eval('.gal-count', (e) => e.textContent))
  check('没有页面错误', errors.length === 0, J(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message.split('\n')[0]} @ ${(error.stack || '').split('\n').find((l) => l.includes('fe-gal-tsk-selftest')) || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
