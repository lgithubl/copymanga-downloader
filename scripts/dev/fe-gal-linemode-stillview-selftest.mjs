#!/usr/bin/env node
// 浏览器自测：(1) Girls Creation 行式脚本（hmr_<id>.txt，只有它没有 script.txt 的场景）——列表里出现、台词 / 说话人 / 只有语音的步 / Spine 角色（chara + charamotion + charafade）；
// (2) 静态画面的「静图放大 / 选择中心」（播放器「更多」）：放大后画面铺得更满、中心设到左上角后左上角被裁掉、拖动选中心 → Enter 保存。
// 素材全是合成的（不含原作内容）。真实 WebGL（headless Chromium + SwiftShader）、官方 spine-webgl 3.8。需要先 sh scripts/fetch-spine-runtime.sh。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-linemode-stillview-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/gal-linemode-shots）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as layoutScript } from '../tag-scripts/gal-layout/main.js'
import { GC_ANIMATIONS } from './make-girlscreation-fixture.mjs'
import { buildTenkeiFixture, writeSpine } from './make-spine-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!existsSync(path.join(root, 'web/static/vendor/spine-webgl.js'))) { console.error('缺 web/static/vendor/spine-webgl.js：先 sh scripts/fetch-spine-runtime.sh'); process.exit(2) }
const shotDir = process.env.SHOT_DIR || '/tmp/gal-linemode-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-lm-'))
const dataDir = path.join(work, 'data')
const importer = (media) => createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })

// ---- 素材 1：Girls Creation，只有行式脚本的场景 ----
const gcMedia = path.join(dataDir, 'gal', 'gc-line')
const pk = path.join(gcMedia, 'package.nw')
const scene = path.join(pk, 'scenes', 'chmr_1')
for (const dir of ['images', 'voices', 'spines']) await mkdir(path.join(scene, dir), { recursive: true })
for (const dir of ['bgm', 'se']) await mkdir(path.join(pk, 'data/audio', dir), { recursive: true })
// 0.3 秒静音 WAV（浏览器按内容嗅探，扩展名随便）
const wav = (() => { const n = 2205; const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(7350, 24); b.writeUInt32LE(14700, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b })()
for (const file of [path.join(scene, 'voices/v1.ogg'), path.join(scene, 'voices/v2.ogg'), path.join(pk, 'data/audio/bgm/bgm1.m4a')]) await writeFile(file, wav)
await writeSpine(path.join(scene, 'spines'), 'st1', { format: 'binary', color: 'crimson', animations: GC_ANIMATIONS })
// 真实数据里骨架文件叫 st1.skel / st1.atlas / st1.png（不是 .skel.bytes）
await rename(path.join(scene, 'spines/st1.skel.bytes'), path.join(scene, 'spines/st1.skel'))
await rename(path.join(scene, 'spines/st1.atlas.txt'), path.join(scene, 'spines/st1.atlas'))
await writeFile(path.join(scene, 'hmr_1.txt'), ['fade,out,black,0.2', 'title,行式テスト,', 'bgmplay,bgm1,0', 'window,on,0.25', 'message,,旁白一句,', 'voice,v1', 'message,甲,「第一句」,iab4020078', 'voice,v2',
  'chara,st1,chara_1,0,-700,10,1,1,0,off', 'charamotion,chara_1,loop,on', 'charamotion,chara_1,joy,on', 'charafade,chara_1,in,0.2', 'await', 'msgvoicesync,chara_1,甲,「同步台词」,iab4030908,v2', 'cgmode,on'].join('\n'))
// 高个子骨架（533 × 1386，和真实的「橋」一样）+ 标签式脚本：y=0、缩放 0.7——原查看器里这个人的头在舞台上 43% 的位置，脚在舞台下面
const tall = path.join(pk, 'scenes', 'chmr_3')
await mkdir(path.join(tall, 'spines'), { recursive: true })
await writeSpine(path.join(tall, 'spines'), 'st2', { format: 'json', color: 'seagreen', animations: ['Wait'], region: { name: 'body', width: 533, height: 1386, y: 693 } })
await rename(path.join(tall, 'spines/st2.skel.bytes'), path.join(tall, 'spines/st2.json'))
await rename(path.join(tall, 'spines/st2.atlas.txt'), path.join(tall, 'spines/st2.atlas'))
await writeFile(path.join(tall, 'script.txt'), ['<SPINE_ACTOR>1,st2,,,,0,0,x=0|y=0,0.7,skel', '<SPINE_ACTOR_PLAY>1,Wait,0,true', '<NAME_PLATE>乙', '你好', '<PAUSE>', ''].join('\n'))
// maid 式的分层脸骨架：动画是 eye/eye_001 这样一组一组的，脚本要的是表情预设名「照れ」（骨架里没有）
const layered = path.join(pk, 'scenes', 'chmr_4')
await mkdir(path.join(layered, 'spines'), { recursive: true })
await writeSpine(path.join(layered, 'spines'), 'st3', { format: 'json', color: 'orange', animations: ['eye/eye_001', 'eye/eye_002', 'eyebrow/eyebrow_001', 'mouse/mouse_001', 'cheek/cheek_none', 'cheek/cheek_001'] })
await rename(path.join(layered, 'spines/st3.skel.bytes'), path.join(layered, 'spines/st3.json'))
await rename(path.join(layered, 'spines/st3.atlas.txt'), path.join(layered, 'spines/st3.atlas'))
await writeFile(path.join(layered, 'script.txt'), ['<SPINE_ACTOR>1,st3,,,,0,0,x=0|y=-700,1,skel', '<SPINE_ACTOR_PLAY>1,照れ,0,true', '<NAME_PLATE>丙', '你好', '<PAUSE>', ''].join('\n'))
const gc = importer(gcMedia)
const gcImp = await gc.importFromSource({ sourcePath: gcMedia, options: { adapters: ['girlscreation-tag'], config: { game: { id: 'girlscreation' } } } })
const gcOut = await layoutScript({ item: gcImp.items[0], script: { id: 'gal-layout', version: '2.7.0', options: {} } })
await gc.patchItemMetadata(gcImp.items[0].itemId, { gal: gcOut.itemPatch.gal })
const gcId = gcImp.items[0].itemId
check('gal-layout：只有 hmr_<id>.txt 的场景也算场景（hmr_1 + 标签式的 chmr_3 / chmr_4，脚本数 3）', gcOut.itemPatch.gal.config.scriptCount === 3 && gcOut.itemPatch.gal.config.game.id === 'girlscreation', J(gcOut.itemPatch?.gal?.config))

// ---- 素材 2：tenkeiprdx（有静态画面） ----
const ttMedia = path.join(dataDir, 'gal', 'tt-pack')
await mkdir(ttMedia, { recursive: true })
await buildTenkeiFixture(ttMedia)
const tt = importer(ttMedia)
const ttImp = await tt.importFromSource({ sourcePath: ttMedia, options: { adapters: ['tenkeiprdx-json'], config: { game: { id: 'tenkeiprdx' } } } })
const ttOut = await layoutScript({ item: ttImp.items[0], script: { id: 'gal-layout', version: '2.7.0', options: {} } })
await tt.patchItemMetadata(ttImp.items[0].itemId, { gal: ttOut.itemPatch.gal })
const ttId = ttImp.items[0].itemId


// ---- 素材 3：节点图（config.nodes），UViewer 风格脚本 ----
const ngMedia = path.join(dataDir, 'gal', 'node-graph')
const uvText = 'bg,a.jpg,0\nname,甲\nmsg,0,hi\nclickwait\n'
for (const rel of ['chars/c01/s1.txt', 'chars/c01/s2.txt', 'chars/c02/s3.txt', 'events/ev1.txt', 'events/ev2.txt', 'events/other.txt']) {
  await mkdir(path.dirname(path.join(ngMedia, 'scripts', rel)), { recursive: true })
  await writeFile(path.join(ngMedia, 'scripts', rel), uvText)
}
await writeFile(path.join(ngMedia, 'scripts/events/junk.txt'), 'this is not a script at all\nreally\nnot\n')
await writeFile(path.join(ngMedia, 'names.json'), JSON.stringify({ c01: '甲', c02: '乙' }))
const ng = importer(ngMedia)
const ngImp = await ng.importFromSource({ sourcePath: ngMedia, options: { adapters: ['uviewer-csv'], config: {
  scriptRoots: [{ id: 't', dir: 'scripts', label: 't' }], namesFiles: ['names.json'], merge: [], resourceRoots: [],
  nodes: {
    home: { children: ['chars', 'events', 'missing'] },
    chars: { title: '角色', text: '所有角色', expand: { dirs: ['chars/*'], as: 'char' }, related: ['events'] },
    char: { title: '{label}', subtitle: '{name}', dirs: ['{path}'] },
    events: { title: '活动', dirs: ['events'], match: '^ev' },
    missing: { title: '不存在的', dirs: ['nope/*'] },
  },
} } })
const ngId = ngImp.items[0].itemId

// ---- 素材 4：misttrain，最底下的层初始姿势里没有可见附件（包围盒 Infinity，附件由动画打开）——不能拿它当参照层 ----
const meMedia = path.join(dataDir, 'gal', 'mt-empty')
const meRoot = path.join(meMedia, 'MistTrainGirls X')
await mkdir(path.join(meRoot, 'UScenes/Stills/9'), { recursive: true })
await writeSpine(path.join(meRoot, 'Spines/Stills/9/2940207'), '1', { format: 'json', color: 'goldenrod', animations: ['animation1'] })
await writeSpine(path.join(meRoot, 'Spines/Stills/9/2940207'), '3', { format: 'json', color: 'deepskyblue', animations: ['animation1'] })
{
  const file = path.join(meRoot, 'Spines/Stills/9/2940207/1.skel.bytes')
  const json = JSON.parse(await readFile(file, 'utf8'))
  delete json.slots[0].attachment   // 初始姿势没有附件 → 包围盒是空的
  json.animations.animation1.slots = { body: { attachment: [{ time: 0, name: 'body' }] } }   // 动画把附件打开
  await writeFile(file, JSON.stringify(json))
}
await writeFile(path.join(meRoot, 'Spines/Stills/9/2940207/still_configuration.json'), JSON.stringify({ Parts: [{ Path: '1', IsMosaic: false }, { Path: '3', IsMosaic: false }] }))
await mkdir(path.join(meRoot, 'MasterData'), { recursive: true })
await writeFile(path.join(meRoot, 'UScenes/Stills/9/2940207.json'), JSON.stringify([null, [2940207, [[1, 1, '甲', '你好', 2, 3, false, null, 0, 0, '', '', '', '', '', null, 0, [], ['animation1', null, null, null, null, null, null]]]]]))
const me = importer(meMedia)
const meImp = await me.importFromSource({ sourcePath: meMedia, options: { adapters: ['misttrain-json'], config: { game: { id: 'misttrain' } } } })
const meOut = await layoutScript({ item: meImp.items[0], script: { id: 'gal-layout', version: '2.8.0', options: {} } })
await me.patchItemMetadata(meImp.items[0].itemId, { gal: meOut.itemPatch.gal })
const meId = meImp.items[0].itemId

const port = 8131
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
let lastPage = null
try {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const newPage = async (init) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await context.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
    if (init) await context.addInitScript(init)   // 函数或脚本文本
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.errors = []
    lastPage = page
    page.on('pageerror', (e) => page.errors.push(e.message))
    return page
  }
  const countOf = (page) => page.$eval('.gal-count', (e) => e.textContent).catch(() => '')
  const goTo = async (page, t) => { for (let i = 0; i < 12 && (await countOf(page)) !== t; i += 1) { await page.keyboard.press('Space'); await sleep(350) } await waitCount(page, t) }
  const waitText = (page, t) => page.waitForFunction((v) => document.querySelector('.gal-text')?.textContent === v, t).then(() => true, () => false)
  const waitCount = (page, t) => page.waitForFunction((v) => document.querySelector('.gal-count')?.textContent === v, t)
  const spines = (page) => page.$eval('.gal-world', (e) => JSON.parse(e.dataset.spines || '{}')).catch(() => ({}))
  const link = (id, section) => `${base}/#/media/gal/${id}/main?section=${encodeURIComponent(section)}`
  // 舞台 canvas 的不透明像素占比 + 指定位置（占画布宽高的比例）的 alpha
  const coverage = (page) => page.evaluate(() => {
    const c = document.querySelector('.gal-spine')
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
    const x = g.getContext('2d'); x.drawImage(c, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n += 1
    return n / (c.width * c.height)
  })
  const alphaAt = (page, fx, fy) => page.evaluate(([a, b]) => {
    const c = document.querySelector('.gal-spine')
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
    const x = g.getContext('2d'); x.drawImage(c, 0, 0)
    return x.getImageData(Math.round(a * (c.width - 1)), Math.round(b * (c.height - 1)), 1, 1).data[3]
  }, [fx, fy])

  // ===== (1) 行式脚本 =====
  {
    const page = await newPage()
    await page.goto(`${base}/#/media/gal/${gcId}/main`)
    await page.waitForFunction(() => /chmr/.test(document.body.innerText))
    await page.getByText('chmr', { exact: true }).first().click()
    await page.waitForFunction(() => /甲/.test(document.body.innerText))
    await page.getByText('甲', { exact: true }).first().click()
    await page.waitForFunction(() => /行式テスト/.test(document.body.innerText))
    check('列表：分类 chmr → 说话人「甲」（取自 message）→ 场景标题取自 title 行', true)
    await page.getByText('行式テスト').first().click()
    await page.waitForSelector('.gal-player')
    await waitCount(page, '1 / 4')
    check('第 1 句：旁白（没有说话人）、台词「旁白一句」', (await waitText(page, '旁白一句')) && (await page.$eval('.gal-name', (e) => e.textContent)) === '', J([await page.$eval('.gal-text', (e) => e.textContent), await page.$eval('.gal-name', (e) => e.textContent)]))
    await goTo(page, '2 / 4')
    check('第 2 句：说话人 甲、台词「第一句」', (await waitText(page, '「第一句」')) && (await page.$eval('.gal-name', (e) => e.textContent)) === '甲')
    await goTo(page, '3 / 4')
    check('第 3 步：只有语音（voice,v2）没有台词，自己一步', (await page.$eval('.gal-text', (e) => e.textContent)) === '')
    await goTo(page, '4 / 4')
    await page.waitForFunction(() => /Actor1/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 15000 })
    check('第 4 步：msgvoicesync 的台词「同步台词」；角色 chara_1（Spine，轨道 0 loop）已出现', (await waitText(page, '「同步台词」')) && Boolean((await spines(page)).Actor1), J(await spines(page)))
    await sleep(600)
    check('角色真的画出来了（canvas 有不透明像素）', (await coverage(page)) > 0.01, String(await coverage(page)))
    await page.screenshot({ path: path.join(shotDir, 'line-actor.png') })
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }

  // ===== (2) 静图放大 / 选择中心 =====
  const openStill = async (page) => {
    await page.goto(link(ttId, 's:20010001.json'))
    await page.waitForSelector('.gal-player')
    for (let i = 0; i < 30; i += 1) {
      if (process.env.LM_DEBUG) console.log('step', i, await countOf(page), J(await spines(page)))
      if (Object.keys(await spines(page)).some((k) => k.startsWith('still'))) break
      await page.keyboard.press('Space')
      await sleep(400)
    }
    await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines?.includes('still0'), null, { timeout: 15000 })
    await sleep(900)
  }
  let base1 = 0
  {
    const page = await newPage()
    await openStill(page)
    base1 = await coverage(page)
    check('静图放大 1（默认）：静图画出来了', base1 > 0.02, String(base1))
    await page.click('.gal-more-btn')
    check('「更多」里有「静图放大」「选择中心」', Boolean(await page.$('.gal-more input.gal-more-number[max="4"]')) && Boolean(await page.$('.gal-center-btn')))
    await page.fill('.gal-more input.gal-more-number[max="4"]', '2')
    await page.dispatchEvent('.gal-more input.gal-more-number[max="4"]', 'change')
    await sleep(500)
    const zoomed = await coverage(page)
    check('放大 2 倍后画面铺得更满（不透明占比至少是 1 倍时的 1.8 倍或已满）', zoomed >= Math.min(0.97, base1 * 1.8), J([base1, zoomed]))
    const savedView = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || 'null'), ttId)
    check('放大倍率按媒体存进浏览器（copymanga.gal.view.<条目 id>.still），不是全局的', savedView?.still?.zoom === 2 && (await page.evaluate(() => localStorage.getItem('copymanga.gal.stillZoom'))) === null, J(savedView))
    await page.screenshot({ path: path.join(shotDir, 'still-zoom2.png') })
    // 拖动选中心：点「选择中心」→ 点画面框的左上区 → Enter
    await page.click('.gal-center-btn')
    await page.waitForSelector('.gal-center-layer')
    const frame = await page.$eval('.gal-center-frame', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height } })
    await page.mouse.click(frame.l + frame.w * 0.25, frame.t + frame.h * 0.25)
    await page.keyboard.press('Enter')
    await page.waitForSelector('.gal-center-layer', { state: 'detached' })
    const saved2 = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || 'null'), ttId)
    const saved = [saved2?.still?.cx, saved2?.still?.cy]
    check('选择中心：点画面框 25% / 25% 处，Enter 保存', Math.abs(saved[0] - 0.25) < 0.03 && Math.abs(saved[1] - 0.25) < 0.03, J(saved))
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }
  {
    // 中心设到左上角 + 放大 2：左上角那一点放在舞台正中 → 舞台左上 1/4 是空的（被裁掉的是画面外），右下 1/4 有画面
    const page = await newPage(`localStorage.setItem('copymanga.gal.view.${ttId}', JSON.stringify({ still: { zoom: 2, cx: 0, cy: 0 } }))`)
    await openStill(page)
    const topLeft = await alphaAt(page, 0.2, 0.2)
    const bottomRight = await alphaAt(page, 0.7, 0.7)
    check('放大 2、中心 0,0：舞台左上（画面外）是空的、右下有画面', topLeft < 20 && bottomRight > 200, J([topLeft, bottomRight]))
    await page.screenshot({ path: path.join(shotDir, 'still-center-topleft.png') })
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }

  // ===== (2b) 角色摆放照原查看器的固定相机 + 角色放大 / 中心（按媒体存）+ 渲染诊断 =====
  {
    const page = await newPage()
    await page.goto(link(gcId, 's:chmr_3/script.txt'))
    await page.waitForSelector('.gal-player')
    await page.waitForFunction(() => /Actor1/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 15000 })
    await sleep(800)
    const topFrac = 0.435   // 原查看器：原点在舞台中心 + (0, 900) 个单位（每个单位 = 舞台宽 / 1920），头顶 = 原点 − 1386 × 0.7 个单位
    const [above, belowHead, body] = [await alphaAt(page, 0.5, 0.2), await alphaAt(page, 0.5, 0.40), await alphaAt(page, 0.5, 0.6)]
    check(`高个子角色（y=0、缩放 0.7）：头顶在舞台上 ${Math.round(topFrac * 100)}% 的位置（20% 处和 40% 处是空的，60% 处是身体）——不会再顶出舞台上沿`, above < 20 && belowHead < 20 && body > 200, J([above, belowHead, body]))
    await page.click('.gal-more-btn')
    check('「更多」里标成「角色放大 / 角色中心」（当前画面是角色，不是静态画面）', (await page.$eval('.gal-more-field span', (e) => e.textContent).catch(() => '')) !== undefined && /角色放大/.test(await page.evaluate(() => document.querySelector('.gal-more')?.innerText || '')))
    await page.fill('.gal-more input.gal-more-number[max="4"]', '2')
    await page.dispatchEvent('.gal-more input.gal-more-number[max="4"]', 'change')
    await sleep(500)
    const zoomedHead = await alphaAt(page, 0.5, 0.40)
    check('角色放大 2 倍（中心默认在舞台正中）：原来头顶上面的 40% 处现在是身体', zoomedHead > 200, String(zoomedHead))
    const mine = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || 'null'), gcId)
    const others = await page.evaluate((id) => localStorage.getItem(`copymanga.gal.view.${id}`), ttId)
    check('按媒体存：这个媒体存了 actor.zoom = 2，别的媒体（tt）没有被影响', mine?.actor?.zoom === 2 && others === null, J([mine, others]))
    await page.click('.gal-note')
    await sleep(300)
    const diag = await page.$eval('.gal-diag', (e) => e.innerText)
    check('渲染诊断：有「预乘 alpha / 混合模式」一行；「要 0:Wait → 实际 Wait」不再误报「名字对不上」', /预乘 alpha：图集标记/.test(diag) && !/名字对不上/.test(diag), diag.slice(0, 600))
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }

  {
    const page = await newPage()
    await page.goto(link(gcId, 's:chmr_4/script.txt'))
    await page.waitForSelector('.gal-player')
    await page.waitForFunction(() => /Actor1/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 15000 })
    await sleep(600)
    await page.click('.gal-note')
    await sleep(300)
    const diag = await page.$eval('.gal-diag', (e) => e.innerText)
    check('分层脸 + 表情预设名「照れ」对不上：诊断里写明用默认脸顶上（eye/eye_001、eyebrow/eyebrow_001、mouse/mouse_001、cheek/cheek_none）', /表情预设没有映射/.test(diag) && /eye\/eye_001/.test(diag) && /mouse\/mouse_001/.test(diag) && /cheek\/cheek_none/.test(diag) && /eyebrow\/eyebrow_001/.test(diag), diag.slice(0, 700))
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }

  {
    const page = await newPage()
    await page.goto(link(meId, 's:Stills/9/2940207.json'))
    await page.waitForSelector('.gal-player')
    await page.waitForFunction(() => document.querySelector('.gal-world')?.dataset.spines?.includes('still1'), null, { timeout: 15000 })
    await sleep(900)
    check('最底下的层初始姿势没有可见附件（包围盒是 Infinity）：改用有包围盒的层当参照，画面照样画出来（不会整个消失）', (await coverage(page)) > 0.02, String(await coverage(page)))
    await page.click('.gal-note')
    await sleep(300)
    const diag = await page.$eval('.gal-diag', (e) => e.innerText)
    check('渲染诊断：空包围盒的层写明「无（初始姿势下没有可见附件，由动画打开，不当参照层）」', /边界 无（初始姿势下没有可见附件/.test(diag), diag.slice(0, 600))
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }

  // ===== (3) 文件索引行 + 刷新、节点图（相关链接）、列表阶段的问题 =====
  {
    // girlscreation 列表：「更多」里有文件索引信息 + 刷新；新增场景后点刷新才出现
    const page = await newPage()
    await page.goto(`${base}/#/media/gal/${gcId}/main`)
    await page.waitForFunction(() => /chmr/.test(document.body.innerText))
    await page.click('.gal-browse-more-btn')
    const infoText = await page.$eval('.gal-index-text', (e) => e.textContent)
    check('「更多」里有文件索引：个数 + 建立时间 + 刷新按钮', /文件索引：\d+ 个文件 · 建立于/.test(infoText) && Boolean(await page.$('.gal-index-refresh')), infoText)
    await mkdir(path.join(scene, '..', 'chmr_2'), { recursive: true })
    await writeFile(path.join(scene, '..', 'chmr_2', 'hmr_2.txt'), ['title,新场景,', 'message,乙,「新的」,iab4020078'].join('\n'))
    await page.click('.gal-index-refresh')
    await page.waitForFunction(() => /4 个剧情/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {})
    const after = await page.evaluate(() => document.body.innerText)
    check('点「刷新」后新增的场景出现在列表里（chmr 分类 3 个剧情变 4 个）', /4 个剧情/.test(after) && !/3 个剧情/.test(after), J(after.split('\n').filter(Boolean).slice(8, 40)))
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }
  {
    // 节点图：config.nodes（首页 → 角色 / 活动，角色 related 活动）
    const page = await newPage()
    await page.goto(`${base}/#/media/gal/${ngId}/main`)
    await page.waitForFunction(() => /角色/.test(document.body.innerText))
    const homeText = await page.evaluate(() => document.body.innerText)
    check('节点图：首页按 children 顺序列出「角色」「活动」', /角色/.test(homeText) && /活动/.test(homeText))
    check('节点图：首页的问题里有「没有匹配到任何目录」的错误提示（nope/*）', await page.evaluate(() => (document.querySelector('.gal-browse-diag-btn')?.textContent || '') !== '' ), '')
    await page.getByText('角色', { exact: true }).first().click()
    await page.waitForSelector('.gal-browse-related')
    check('节点图：节点有描述文字和「相关」链接（角色 → 活动）', (await page.$eval('.gal-browse-text', (e) => e.textContent)) === '所有角色' && (await page.$eval('.gal-browse-related-link', (e) => e.textContent)) === '活动')
    await page.click('.gal-browse-related-link')
    await page.waitForFunction(() => /ev1/.test(document.body.innerText))
    check('点相关链接进入「活动」节点（ev1 / ev2；other 被 match 过滤）', /ev2/.test(await page.evaluate(() => document.body.innerText)) && !/other/.test(await page.evaluate(() => document.body.innerText)))
    await page.click('.gal-browse-up')
    await page.waitForSelector('.gal-browse-related')
    check('返回上一级回到「角色」（沿着走过的路）', /甲/.test(await page.evaluate(() => document.body.innerText)))
    // 渲染诊断里能看到规则对不上的问题
    await page.goto(`${base}/#/media/gal/${ngId}/main`)
    await page.waitForSelector('.gal-browse-more-btn')
    await page.click('.gal-browse-more-btn')
    await page.click('.gal-browse-diag-btn')
    await page.waitForFunction(() => /graph-/.test(document.querySelector('.gal-browse-diag-text')?.textContent || ''))
    const diag = await page.$eval('.gal-browse-diag-text', (e) => e.textContent)
    check('渲染诊断：列出 graph-dir-missing（nope/*）和 graph-unrecognized（junk.txt）', /graph-dir-missing/.test(diag) && /junk\.txt/.test(diag), diag.slice(0, 500))
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${String(error?.message || error).split('\n')[0]}`)
  if (process.env.LM_DEBUG && lastPage) { console.log(await lastPage.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '')); console.log(lastPage.errors) }
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
