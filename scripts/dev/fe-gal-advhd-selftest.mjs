#!/usr/bin/env node
// 自测：WillPlus AdvHD 家族（game.id = advhd::<游戏>）——真实服务端流程：导入（gal-import + gal-layout）→ 第一次浏览时服务端读 .arc 展开 → 列表 / 播放 / 取资源 → 浏览器里画面。
// 合成数据（ImageMagick 画纯色图：BG 蓝、EV 绿、立绘两帧红 / 黄），所以能在 canvas 上按位置点像素核对立绘的摆放。
//   node scripts/dev/fe-gal-advhd-selftest.mjs      PLAYWRIGHT_PATH=<@playwright/test> 再加上浏览器；需要 ImageMagick
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORY_001, STORY_BRANCH, arcBuild, commit, msg, pnaBuild, ws2Encode } from './make-advhd-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const png = (size, color) => execFileSync('convert', ['-size', size, `xc:${color}`, 'png:-'], { maxBuffer: 16 * 1024 * 1024 })

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-advhd-'))
const media = path.join(work, 'Lovey-dovey Part-time')
await mkdir(media, { recursive: true })
const put = (name, data) => writeFile(path.join(media, name), data)
const end = ['FileEnd', [0, 0, 0, 0, 0]]
await put('Script2.arc', arcBuild([{ name: 'ArcFileName.lua', data: Buffer.from('-- lua') }]))
await put('Rio.arc', arcBuild([{ name: 'LAYER_ORDER.ws2', data: ws2Encode([end]) }]))
// 长背景图平移：1280×1400 的竖条（上红下蓝），基准位置 (0, -250)，平移 (0, -400)、2 秒、线性
// 立绘位置偏移：红帧（舞台 x 100..., y 250..650）往下偏移 +40 像素，2 秒线性
const BOB = [['ClearLayer', ['*']], ['SetBackground', ['bg01', 'BG_01.PNG', 1, 1]], ['UsePnaPackage', ['st01', 'ST_TOW_A_M.PNA', 1, 1]], ['DisplayCharacterImage', ['st01', 2, 1, 1, 1]], ['MoveBackground', ['st01', 0, 0, 100, 50, 0, 0]], commit(0), ['SetRegister', [0, 5, 0]], ['SetRegister', [0, 6, 40]], ['Effect1', ['st01', 'effect01', 1, 0, 0xc0, 5, 6, 0, 0, 2, 0, 0]], msg(0, '晃动%K%P'), ['FileEnd', []]]
// 混合方式：红色底（帧 1，PNA 记录的 mode = 0）+ 50% 灰的「腮红」帧（帧 0，mode = 3 = 正片叠底），盖在底的一角；引擎按序号从大到小画，所以小序号的在上面
const BLEND = [['ClearLayer', ['*']], ['SetBackground', ['bg01', 'BG_01.PNG', 1, 1]], ['UsePnaPackage', ['st01', 'ST_BLEND.PNA', 1, 1]], ['DisplayCharacterImage', ['st01', 2, 1, 2, 1, 0]], ['MoveBackground', ['st01', 0, 0, 100, 50, 0, 0]], commit(0), msg(0, '混合%K%P'), ['FileEnd', []]]
const PAN = [['ClearLayer', ['*']], ['SetBackground', ['bg01', 'LONG_01.PNG', 1, 1]], ['MoveBackground', ['bg01', 0, 0, 0, -250, 0, 0]], commit(0), ['SetRegister', [0, 5, 0]], ['SetRegister', [0, 6, -400]], ['Effect1', ['bg01', 'effect01', 1, 0, 0xc0, 5, 6, 0, 0, 2, 0, 0]], msg(0, '平移%K%P'), ['FileEnd', []]]
await put('Rio1.arc', arcBuild([{ name: '001_00.ws2', data: ws2Encode(STORY_001) }, { name: '002_00_H.ws2', data: ws2Encode(STORY_BRANCH) }, { name: '003_PAN.ws2', data: ws2Encode(PAN) }, { name: '004_BOB.ws2', data: ws2Encode(BOB) }, { name: '005_BLEND.ws2', data: ws2Encode(BLEND) }]))
await put('Chip3.arc', arcBuild([
  { name: 'BG_01.png', data: png('1280x720', 'blue') },
  { name: 'EV_01.png', data: png('1280x720', 'lime') },
  { name: 'LONG_01.png', data: execFileSync('convert', ['-size', '1280x1400', 'gradient:red-blue', 'png:-'], { maxBuffer: 16 * 1024 * 1024 }) },
  { name: 'ST_BLEND.pna', data: pnaBuild({ width: 600, height: 800, frames: [
    { type: 0, id: 0, x: 100, y: 200, w: 100, h: 100, mode: 3, data: png('100x100', 'rgb(128,128,128)') },   // 0：灰（正片叠底），盖在底的左上角
    { type: 0, id: 1, x: 100, y: 200, w: 300, h: 400, data: png('300x400', 'red') },                            // 1：红色底
  ] }) },
  { name: 'ST_TOW_A_M.pna', data: pnaBuild({ width: 600, height: 800, frames: [
    { type: 1 }, { type: 0, id: 1, x: 100, y: 200, w: 300, h: 400, data: png('300x400', 'red') }, { type: 0, id: 2, x: 0, y: 0, w: 10, h: 10, data: png('10x10', 'black') },
    { type: 0, id: 3, x: 50, y: 60, w: 20, h: 30, data: png('20x30', 'yellow') }, { type: 2 },
  ] }) },
]))
await put('Voice.arc', arcBuild([{ name: 'TW_0001.ogg', data: Buffer.from('OggS-1') }, { name: 'TW_0002.ogg', data: Buffer.from('OggS-2') }, { name: 'SV_TOW_01.ogg', data: Buffer.from('OggS-3') }]))
await put('Bgm.arc', arcBuild([{ name: 'BGM01.ogg', data: Buffer.from('OggS-bgm') }]))
await put('Se.arc', arcBuild([{ name: 'SE_01.ogg', data: Buffer.from('OggS-se') }]))
await put('AdvHD.exe', 'MZ')

const require = createRequire(import.meta.url)
let chromium = null
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { /* 没有 playwright：只做 HTTP 部分 */ }
const port = 8149
const base = `http://127.0.0.1:${port}`
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
let server = null
try {
  try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch { /* 空闲 */ }
  server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
  let up = false
  for (let i = 0; i < 100 && !up; i++) { try { await fetch(`${base}/health`); up = true } catch { await sleep(200) } }
  if (!up) { console.log('SKIP 起不来 web 服务') } else {
    const form = new FormData()
    form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
    form.set('profileOptions', JSON.stringify({ adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' } } })); form.set('metadataActionIds', 'gal-layout')
    const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
    const itemId = imported.items[0].itemId
    let full = null
    for (let i = 0; i < 80; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
    check('导入（真实服务）：game.id「advhd::lpsl」（带 ::）存得下；gal-layout 按家族写好 config（脚本根 arc/script、containers 已启用、适配器 advhd::ws2）', full.config?.game?.id === 'advhd::lpsl' && full.config?.scriptRoots?.[0]?.dir === 'arc/script' && full.config?.containers?.enabled === true && J(full.adapters) === J(['advhd::ws2']), J([full.config?.game, full.config?.scriptRoots, full.adapters]))
    const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
    const home = await reader('')
    check('第一次浏览：服务端读 arc，首页 = 目录卡片 Rio1；没有 error 级的 problems', home.node?.items?.map((i) => i.title).join() === 'Rio1' && !(home.node.problems || []).some((p) => p.level === 'error'), J([home.node?.items?.map((i) => i.title), home.node?.problems]))
    const dir = await reader(home.node.items[0].node)
    check('目录里有虚拟目录「特殊场景」（_H 结尾的脚本），排在最前', dir.node.items[0]?.title === '特殊场景' && dir.node.items[0].type === 'dir', J(dir.node.items.map((i) => i.title)))
    dir.node.items = dir.node.items.filter((i) => i.type === 'script')   // 下面按脚本顺序取
    check('目录里 5 个脚本（001_00、002_00_H、003_PAN、004_BOB、005_BLEND）', dir.node.items.map((i) => i.title).join() === '001_00,002_00_H,003_PAN,004_BOB,005_BLEND', J(dir.node.items.map((i) => i.title)))
    const story = await reader(dir.node.items[0].node)
    const branch = await reader(dir.node.items[1].node)
    check('播放（001_00）：scene 来自 advhd::ws2，6 步；没走到的功能看得见（raw 里有 Effect1:kind0 / ExecuteFunction:playSpecialEffect）', story.scene?.adapter === 'advhd::ws2' && story.scene.steps.length === 6 && story.scene.stats.raw['Effect1:kind0'] === 1 && story.scene.stats.raw['ExecuteFunction:playSpecialEffect'] === 1, J(story.scene?.stats));
    const res = async (src) => fetch(`${base}${story.resourceBase}?path=${encodeURIComponent(src)}`)
    const bgRes = await res('Chip3/BG_01.png')
    const frameRes = await res('Chip3/ST_TOW_A_M.pna/1.png')
    check('资源接口：背景图 / PNA 的帧 PNG / 语音（arc 展开出来的文件）都能取，Content-Type 对', bgRes.status === 200 && /image\/png/.test(bgRes.headers.get('content-type')) && frameRes.status === 200 && (await res('Voice/TW_0001.ogg')).status === 200 && (await res('Voice/NOPE.ogg')).status === 404)
    check('列表卡片：脚本卡片有封面（兜底：事件图 EV_01）', dir.node.items[0].thumb === 'Chip3/EV_01.png', J(dir.node.items[0]))
    if (!chromium) console.log('SKIP 没有 @playwright/test：跳过浏览器部分')
    else {
      const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
        const page = await ctx.newPage()
        page.setDefaultTimeout(12000)
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        const missing = []
        page.on('response', (r) => { if (r.status() >= 400 && /resource/.test(r.url())) missing.push(`${r.status()} ${decodeURIComponent(r.url()).slice(-60)}`) })
        const text = () => page.$eval('.gal-text', (e) => e.textContent)
        const count = () => page.$eval('.gal-count', (e) => e.textContent)
        const pixel = (x, y) => page.evaluate(([px, py]) => { const c = document.querySelector('canvas.gal-stand'); if (!c) return null; return [...c.getContext('2d').getImageData(px, py, 1, 1).data] }, [x, y])
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(dir.node.items[0].node)}`)
        await page.waitForSelector('.gal-player .gal-stage')
        await page.waitForFunction(() => /^1 \/ 6/.test(document.querySelector('.gal-count')?.textContent || ''))
        await sleep(500)
        const bg = await page.evaluate(() => [...document.querySelectorAll('.gal-bg')].filter((l) => getComputedStyle(l).opacity === '1').map((l) => l.style.backgroundImage))
        check('第 1 步：台词（ruby 的假名在、%K%P 不显示）；背景 = 从 arc 展开的 BG_01.png', /よろしく/.test(await text()) && !/%K|%P/.test(await text()) && bg.some((b) => /BG_01\.png/.test(decodeURIComponent(b))), J([await text(), bg]))
        await page.keyboard.press('Space'); await sleep(300)
        await page.keyboard.press('Space'); await sleep(900)   // 第 3 步：立绘出场（两帧：红 300×400 @(100,200)，黄 20×30 @(50,60)，图层位置 (100,50)）
        check('第 3 步：台词「立ち絵あり」', /立ち絵あり/.test(await text()), await text())
        // 舞台 1280×720 → canvas 1920×1080（×1.5）；红帧中心 = (100+100+150, 50+200+200) = (350, 450) → (525, 675)；黄帧中心 = (100+50+10, 50+60+15) = (160, 125) → (240, 187.5)
        const red = await pixel(525, 675)
        const yellow = await pixel(240, 188)
        const empty = await pixel(1500, 900)
        check('立绘（canvas.gal-stand）：红帧在算出来的位置（中心像素是红），黄帧也在；别处是透明；第 2 帧（黑，不在 id 表里）没有画', red && red[0] > 200 && red[1] < 60 && red[2] < 60 && yellow && yellow[0] > 200 && yellow[1] > 200 && yellow[2] < 60 && empty && empty[3] === 0, J([red, yellow, empty]))
        await page.keyboard.press('Space'); await sleep(700)   // 第 4 步：事件图 EV（绿）盖在 BG 上
        const over = await page.evaluate(() => [...document.querySelectorAll('.gal-bg')].map((l) => `${getComputedStyle(l).opacity}|${l.style.backgroundImage}|${l.innerHTML.slice(0, 200)}`).join('\n'))
        check('第 4 步：事件图 EV_01.png 出现在背景层里（bg.over）', /EV_01\.png/.test(decodeURIComponent(over)), over)
        await page.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), 'advhd-story.png') })
        check('没有页面错误；除了没有的语音 / 资源，没有 4xx 的资源请求', errors.length === 0 && missing.length === 0, J([errors, missing]))

        // 分支脚本：选项 → 带 when 的分支 → 汇合
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(dir.node.items[1].node)}`)
        await page.waitForSelector('.gal-player .gal-stage')
        await page.waitForFunction(() => /選んでください/.test(document.querySelector('.gal-text')?.textContent || ''))
        await page.waitForFunction(() => { const c = document.querySelector('.gal-choices'); return c && !c.hidden }, null, { timeout: 5000 })
        const labels = await page.$$eval('.gal-choice', (bs) => bs.map((b) => b.textContent))
        check('选项界面：问题那句台词还在文本框里；3 个按钮（左へ / 右へ / 別の話へ）', /選んでください/.test(await text()) && labels.length === 3 && /左へ/.test(labels[0]) && /右へ/.test(labels[1]) && /別の話へ/.test(labels[2]), J([await text(), labels]))
        await page.locator('.gal-choice').nth(1).click()
        await sleep(500)
        check('选完：选项收起，路径变成 3 步（问题 → 右 → 合流），还停在问题那一步', (await page.$eval('.gal-choices', (e) => e.hidden)) && (await count()) === '1 / 3' && /選んでください/.test(await text()), J([await count(), await text()]))
        await page.keyboard.press('Space')
        await page.waitForFunction(() => /右の道/.test(document.querySelector('.gal-text')?.textContent || ''), null, { timeout: 5000 })
        check('下一步 = 右的分支台词（左分支的台词、「别的脚本」的提示都不出现）', /右の道/.test(await text()), await text())
        await page.keyboard.press('Space'); await sleep(400)
        check('下一步 = 汇合后的台词「合流」（左分支的「左の道」被跳过）', /合流/.test(await text()), await text())
        check('分支页面没有页面错误', errors.length === 0, J(errors))

        // 长背景图平移：原尺寸摆（基准位置 (0, -250)），2 秒线性平移 (0, -400) 之后停在 -650
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(dir.node.items[2].node)}`)
        await page.waitForSelector('.gal-player .gal-stage')
        const layerBox = () => page.evaluate(() => {
          const stage = document.querySelector('.gal-stage')
          const front = [...document.querySelectorAll('.gal-bg')].find((l) => getComputedStyle(l).opacity === '1')
          const cs = front && getComputedStyle(front)
          return front ? { k: stage.clientHeight / 720, size: cs.backgroundSize, pos: cs.backgroundPosition } : null
        })
        const px = (value) => value.split(' ').map((x) => Number.parseFloat(x))
        await sleep(300)
        const early = await layerBox()
        check('长背景图：按原尺寸摆（background-size = 1280 × 1400 乘舞台缩放），起点 = 基准位置 (0, -250)，300 毫秒时已经往上走了一点（-250 ~ -340）', early && Math.abs(px(early.size)[0] - 1280 * early.k) < 2 && Math.abs(px(early.size)[1] - 1400 * early.k) < 2 && px(early.pos)[1] <= -250 * early.k + 6 && px(early.pos)[1] >= -340 * early.k && Math.abs(px(early.pos)[0]) < 2, J(early))
        await sleep(2600)
        const late = await layerBox()
        check('平移 2 秒之后停在 -250 + -400 = -650（舞台像素乘缩放）', late && Math.abs(px(late.pos)[1] - -650 * late.k) < 6, J(late))
        await page.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), 'advhd-pan.png') })
        check('平移页面没有页面错误', errors.length === 0, J(errors))

        // 立绘位置偏移：红帧上沿在舞台 y = 250（canvas 375），往下偏移 40 → 290；在舞台 y = 270（canvas 405）取一个像素：开始是红的，播完是透明的
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(dir.node.items[3].node)}`)
        await page.waitForSelector('.gal-player .gal-stage')
        await page.waitForFunction(() => document.querySelector('canvas.gal-stand')?.dataset.slots === '["st01"]')
        const probe = () => page.evaluate(() => { const c = document.querySelector('canvas.gal-stand'); return [...c.getContext('2d').getImageData(525, 405, 1, 1).data] })
        await sleep(100)
        const before = await probe()
        await sleep(2600)
        const after = await probe()
        check('立绘位置偏移（standMove）：开始时红帧上沿还在原位（舞台 y = 270 处是红的），2 秒线性往下 40 像素之后上沿到了 290，那一点变成透明', before[0] > 200 && before[3] === 255 && after[3] === 0, J([before, after]))

        // 混合方式：红底 300×400 在舞台 (100 + 100, 50 + 200) = (200, 250) 起；灰色 100×100 在同一个左上角。canvas = 1.5 倍：灰块中心 = (250, 300) → (375, 450)；红底别处 = (467, 600) → (700, 900)
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(dir.node.items[4].node)}`)
        await page.waitForSelector('.gal-player .gal-stage')
        await page.waitForFunction(() => document.querySelector('canvas.gal-stand')?.dataset.slots === '["st01"]')
        await sleep(400)
        const overlap = await pixel(375, 450)
        const baseOnly = await pixel(700, 900)
        check('混合方式（PNA 帧 mode = 3 = 正片叠底）：灰块盖在红底上 = 红 × 灰 ≈ (128, 0, 0)（普通叠加会是灰色 (128, 128, 128)，就是「黑斑」）；红底别处还是红', overlap && Math.abs(overlap[0] - 128) < 8 && overlap[1] < 8 && overlap[2] < 8 && baseOnly && baseOnly[0] > 240 && baseOnly[1] < 8, J([overlap, baseOnly]))
        check('立绘偏移页面没有页面错误', errors.length === 0, J(errors))
      } finally { await browser.close() }
    }
  }
} finally { server?.kill() }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
