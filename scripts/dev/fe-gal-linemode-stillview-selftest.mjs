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
import { execFileSync } from 'node:child_process'
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
  'chara,st1,chara_1,0,0,10,1,1,0,off', 'charamotion,chara_1,loop,on', 'charamotion,chara_1,joy,on', 'charafade,chara_1,in,0.2', 'await', 'msgvoicesync,chara_1,甲,「同步台词」,iab4030908,v2', 'cgmode,on'].join('\n'))
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
// 第一步：出场时初始动画是不存在的预设名「通常」（SPINE_ACTOR 第 4 项）、还没有任何 SPINE_ACTOR_PLAY；第二步：PLAY 另一个不存在的预设名「照れ」
await writeFile(path.join(layered, 'script.txt'), ['<SPINE_ACTOR>1,st3,,通常,,0,0,x=0|y=0,1,skel', '<NAME_PLATE>丙', '一', '<PAUSE>', '<SPINE_ACTOR_PLAY>1,照れ,0,true', '<NAME_PLATE>丙', '二', '<PAUSE>', '<SPINE_ACTOR_PLAY>1,驚き,0,true', '<NAME_PLATE>丙', '三', '<PAUSE>', ''].join('\n'))
// Screen 混合的槽 + 「完全透明但带白色 RGB」的贴图（直通 alpha 的特效层，像 chara_0125 的 Eff）：按预乘画时透明处必须还是透明，不能被加成白块
const fx = path.join(pk, 'scenes', 'chmr_5')
await mkdir(path.join(fx, 'spines'), { recursive: true })
await writeSpine(path.join(fx, 'spines'), 'st4', { format: 'json', color: 'red', animations: ['Wait'] })
{
  const file = path.join(fx, 'spines/st4.skel.bytes')
  const json = JSON.parse(await readFile(file, 'utf8'))
  json.slots[0].blend = 'screen'
  await writeFile(file, JSON.stringify(json))
  execFileSync('convert', ['-size', '64x128', 'xc:rgba(255,255,255,0)', path.join(fx, 'spines/st4.png')])
  await rename(file, path.join(fx, 'spines/st4.json'))
  await rename(path.join(fx, 'spines/st4.atlas.txt'), path.join(fx, 'spines/st4.atlas'))
}
await writeFile(path.join(fx, 'script.txt'), ['<SPINE_ACTOR>1,st4,,Wait,,0,0,x=0|y=0,1,skel', '<NAME_PLATE>丁', 'hi', '<PAUSE>', ''].join('\n'))
const gc = importer(gcMedia)
const gcImp = await gc.importFromSource({ sourcePath: gcMedia, options: { adapters: ['girlscreation-tag'], config: { game: { id: 'girlscreation' } } } })
const gcOut = await layoutScript({ item: gcImp.items[0], script: { id: 'gal-layout', version: '2.7.0', options: {} } })
await gc.patchItemMetadata(gcImp.items[0].itemId, { gal: gcOut.itemPatch.gal })
const gcId = gcImp.items[0].itemId
check('gal-layout：只有 hmr_<id>.txt 的场景也算场景（hmr_1 + 标签式的 chmr_3 / chmr_4 / chmr_5，脚本数 4）', gcOut.itemPatch.gal.config.scriptCount === 4 && gcOut.itemPatch.gal.config.game.id === 'girlscreation', J(gcOut.itemPatch?.gal?.config))

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

// ---- 素材 5：maid 式的全局分层脸骨架（package.nw/data/spine/cast/cast001001/c1_001.*）+ 用了预设名的脚本，给首页「表情」入口用 ----
const exMedia = path.join(dataDir, 'gal', 'gc-expr')
const exPk = path.join(exMedia, 'package.nw')
const exSpine = path.join(exPk, 'data/spine/cast/cast001001')
await mkdir(exSpine, { recursive: true })
await mkdir(path.join(exPk, 'data/audio/bgm'), { recursive: true })
await writeSpine(exSpine, 'c1_001', { format: 'json', color: 'orange', animations: ['eye/eye_001', 'eye/eye_002', 'eyebrow/eyebrow_001', 'mouse/mouse_001', 'mouse/mouse_002', 'cheek/cheek_none', 'cheek/cheek_001'] })
await rename(path.join(exSpine, 'c1_001.skel.bytes'), path.join(exSpine, 'c1_001.json'))
await rename(path.join(exSpine, 'c1_001.atlas.txt'), path.join(exSpine, 'c1_001.atlas'))
for (const [id, preset] of [['story_1', '喜'], ['story_2', '照れ'], ['story_3', '喜']]) {
  await mkdir(path.join(exPk, 'scenes', id), { recursive: true })
  await writeFile(path.join(exPk, 'scenes', id, 'script.txt'), ['<SPINE_ACTOR>7,cast001001/c1_001,,通常,,0,0,x=0|y=0,1,json', '<NAME_PLATE>甲', '一', '<PAUSE>', `<SPINE_ACTOR_PLAY>7,${preset},0,true`, '<NAME_PLATE>甲', '二', '<PAUSE>', ''].join('\n'))
}
const ex = importer(exMedia)
const exImp = await ex.importFromSource({ sourcePath: exMedia, options: { adapters: ['girlscreation-tag'], config: { game: { id: 'girlscreation' } } } })
const exOut = await layoutScript({ item: exImp.items[0], script: { id: 'gal-layout', version: '2.8.0', options: {} } })
await ex.patchItemMetadata(exImp.items[0].itemId, { gal: exOut.itemPatch.gal })
const exId = exImp.items[0].itemId

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
    const openMore = () => page.evaluate(() => { const menu = document.querySelector('.gal-more'); if (menu.hidden) document.querySelector('.gal-more-btn').click() })
    // 默认（自动）：和以前一样（上个版本的行为）——骨架整个放进舞台，缩放绕骨骼原点（脚）：533×1386 的骨架放进去占满高度，脚本缩放 0.7 → 脚落在舞台底、头顶在 30% 的位置
    const [aboveAuto, headAuto, bodyAuto, feetAuto] = [await alphaAt(page, 0.5, 0.08), await alphaAt(page, 0.5, 0.2), await alphaAt(page, 0.5, 0.5), await alphaAt(page, 0.5, 0.95)]
    check('角色摆放默认 = 自动（上个版本的行为）：高个子角色（缩放 0.7）脚在舞台底、头顶在 30% 左右（8% 和 20% 处是空的，50% 和 95% 处是身体）', aboveAuto < 20 && headAuto < 20 && bodyAuto > 200 && feetAuto > 200, J([aboveAuto, headAuto, bodyAuto, feetAuto]))
    await openMore()
    check('「更多」里有「角色摆放」（自动 / 固定相机），默认是自动，三个数字先不显示', (await page.$eval('.gal-more select.gal-more-select', (e) => e.value)) === 'fit' && !(await page.$eval('.gal-cam-row', (e) => e.offsetParent !== null)))
    // 固定相机（Girls Creation R Viewer 的常数 1920 / 0 / 900）：原点在舞台中心偏下 900 个单位——y=0、缩放 0.7 时头顶在舞台 43% 的位置，脚在舞台下面
    await page.selectOption('.gal-more select.gal-more-select', 'fixed')
    await sleep(500)
    const [above, belowHead, body] = [await alphaAt(page, 0.5, 0.2), await alphaAt(page, 0.5, 0.40), await alphaAt(page, 0.5, 0.6)]
    check('固定相机（1920 / 0 / 900）：头顶在舞台上 43% 的位置（20% 和 40% 处是空的，60% 处是身体）；三个数字出现', above < 20 && belowHead < 20 && body > 200 && !(await page.$eval('.gal-cam-row', (e) => e.hidden)), J([above, belowHead, body]))
    // 改中心 Y 到 0（原点在画面中心的 CG 类骨架用）：整个人往上移到原点在舞台正中
    await openMore()
    await page.fill('.gal-cam-row input:nth-of-type(3)', '0')
    await page.dispatchEvent('.gal-cam-row input:nth-of-type(3)', 'change')
    await sleep(500)
    const [midHead, midAbove] = [await alphaAt(page, 0.5, 0.4), await alphaAt(page, 0.5, 0.9)]
    check('固定相机改中心 Y = 0：原点在舞台正中（骨架 0..1386 高、缩放 0.7，从中心往上伸出去 → 40% 处是身体，90% 处是空的）', midHead > 200 && midAbove < 20, J([midHead, midAbove]))
    const savedCam = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || 'null')?.camera, gcId)
    check('摆放设置按媒体存（camera.mode = fixed、cy = 0），别的媒体不受影响', savedCam?.mode === 'fixed' && savedCam.cy === 0 && (await page.evaluate((id) => localStorage.getItem(`copymanga.gal.view.${id}`), ttId)) === null, J(savedCam))
    await openMore()
    await page.selectOption('.gal-more select.gal-more-select', 'fit')
    await sleep(400)
    check('全是 normal 混合的骨骼：「更多」里没有「混合模式」', !(await page.evaluate(() => [...document.querySelectorAll('.gal-more .gal-more-field')].some((row) => /混合模式/.test(row.textContent) && row.offsetParent !== null))))
    await openMore()
    check('「更多」里标成「角色放大 / 角色中心」（当前画面是角色，不是静态画面）', (await page.$eval('.gal-more-field span', (e) => e.textContent).catch(() => '')) !== undefined && /角色放大/.test(await page.evaluate(() => document.querySelector('.gal-more')?.innerText || '')))
    await page.fill('.gal-more input.gal-more-number[max="4"]', '2')
    await page.dispatchEvent('.gal-more input.gal-more-number[max="4"]', 'change')
    await sleep(500)
    const zoomedHead = await alphaAt(page, 0.5, 0.2)
    check('角色放大 2 倍（中心默认在舞台正中）：原来头顶上面 20% 处（空的）现在是身体', headAuto < 20 && zoomedHead > 200, String(zoomedHead))
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
    const diag1 = await page.$eval('.gal-diag', (e) => e.innerText)
    check('第一步（只有 SPINE_ACTOR 的初始动画「通常」、还没有 PLAY）就有脸：「通常」在内置预设表里 → eye_001 / eyebrow_001 / mouse_001 / cheek_none', /表情预设「通常」→ 预设表（范围 default）/.test(diag1) && /eye\/eye_001/.test(diag1) && /mouse\/mouse_001/.test(diag1) && /cheek\/cheek_none/.test(diag1) && /eyebrow\/eyebrow_001/.test(diag1), diag1.slice(0, 700))
    await page.click('.gal-diag .gal-btn:last-of-type').catch(() => {})
    await goTo(page, '2 / 3')
    await sleep(500)
    await page.click('.gal-note')
    await sleep(300)
    const diag2 = await page.$eval('.gal-diag', (e) => e.innerText)
    const shyLine = (diag2.match(/表情预设「照れ」→ 预设表[^\n]*/) || [''])[0]   // 只看这一行（「骨架里的动画」那行本来就列着 cheek_none）
    check('第二步 PLAY「照れ」：内置预设表 = 通常的脸 + 腮红 001（cheek/cheek_001 取代 cheek_none）', /cheek\/cheek_001/.test(shyLine) && !/cheek\/cheek_none/.test(shyLine) && /eye\/eye_001/.test(shyLine), shyLine)
    await page.click('.gal-diag .gal-btn:last-of-type').catch(() => {})
    await goTo(page, '3 / 3')
    await sleep(500)
    await page.click('.gal-note')
    await sleep(300)
    const diag3 = await page.$eval('.gal-diag', (e) => e.innerText)
    check('第三步 PLAY「驚き」：预设表里没有 → 表情预设没有映射，用默认脸', /表情预设没有映射/.test(diag3) && /驚き/.test(diag3) && /mouse\/mouse_001/.test(diag3), diag3.slice(0, 700))
    await page.click('.gal-diag .gal-btn:last-of-type').catch(() => {})
    // 表情面板：「更多 → 表情…」→ 给「驚き」挑 eye_002 / mouse（预览）→ 存到这个角色 → 诊断里变成预设表
    await page.evaluate(() => { const menu = document.querySelector('.gal-more'); if (menu.hidden) document.querySelector('.gal-more-btn').click() })
    check('「更多」里有「角色表情 / 表情…」（分层脸骨架才有）', await page.$eval('.gal-expr-btn', (e) => e.offsetParent !== null))
    await page.click('.gal-expr-btn')
    await page.waitForSelector('.gal-expr:not([hidden])')
    check('表情面板：预设名默认是正在用的「驚き」；有眼 / 眉 / 嘴 / 腮红 等部件的下拉', (await page.$eval('.gal-expr-preset', (e) => e.value)) === '驚き' && (await page.$$('.gal-expr-groups select')).length >= 4)
    const eyeSelect = (await page.$$('.gal-expr-groups select'))[0]
    const groupLabels = await page.$$eval('.gal-expr-groups .gal-expr-field > span', (nodes) => nodes.map((n) => n.textContent))
    const eyeIndex = groupLabels.findIndex((t) => /\(eye\)|（eye）/.test(t))
    const box = await page.evaluate(() => { const p = document.querySelector('.gal-expr').getBoundingClientRect(); const st = document.querySelector('.gal-stage').getBoundingClientRect(); return { w: p.width / st.width, h: p.height / st.height } })
    check('表情面板是小框：宽 / 高都不到舞台的一半（选了之后看得到实际效果）；内容多时自己有滚动条', box.w < 0.5 && box.h < 0.5 && (await page.$eval('.gal-expr', (e) => getComputedStyle(e).overflowY)) === 'auto', J(box))
    const eyeBefore = await page.evaluate((i) => document.querySelectorAll('.gal-expr-groups select')[i].value, eyeIndex)
    const eyeSteps = (await page.$$('.gal-expr-groups .gal-expr-field'))[eyeIndex]
    await (await eyeSteps.$$('.gal-step'))[1].click()
    const eyeNext = await page.evaluate((i) => document.querySelectorAll('.gal-expr-groups select')[i].value, eyeIndex)
    await (await (await page.$$('.gal-expr-groups .gal-expr-field'))[eyeIndex].$$('.gal-step'))[0].click()
    const eyeBack = await page.evaluate((i) => document.querySelectorAll('.gal-expr-groups select')[i].value, eyeIndex)
    check('每个下拉框左右有 ◀ ▶：▶ = 下一项（值变了）、◀ = 回到上一项；角色 / 预设名 / 保存到 也有', eyeNext !== eyeBefore && eyeBack === eyeBefore && (await page.$$('.gal-expr .gal-step')).length >= 2 * (4 + 3), J([eyeBefore, eyeNext, eyeBack, (await page.$$('.gal-expr .gal-step')).length]))
    await (await page.$$('.gal-expr-groups select'))[eyeIndex].selectOption('002')
    await sleep(400)
    const scopeOptions = await page.$$eval('.gal-expr .gal-more-select', (nodes) => nodes[nodes.length - 1] ? [...nodes[nodes.length - 1].options].map((o) => o.value) : [])
    await page.click('.gal-expr-foot .gal-btn:first-of-type')
    await sleep(300)
    const savedExpr = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || 'null')?.expressions, gcId)
    check('存到「这个角色」（范围 st3 = 骨架文件名，因为路径里没有 cast 目录）：驚き 的眼 = 002', savedExpr?.st3?.['驚き']?.eye === '002', J([savedExpr, scopeOptions]))
    await page.click('.gal-expr .gal-diag-head .gal-btn:last-of-type')
    await page.click('.gal-note')
    await sleep(300)
    const diag4 = await page.$eval('.gal-diag', (e) => e.innerText)
    check('保存后诊断变成：表情预设「驚き」→ 预设表（范围 st3），眼用 eye/eye_002', /表情预设「驚き」→ 预设表（范围 st3）/.test(diag4) && /eye\/eye_002/.test(diag4), diag4.slice(0, 700))
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
    check('渲染诊断：初始姿势没有可见附件的层，包围盒按动画首帧算，并写明「初始姿势没有可见附件，已按动画首帧计算包围盒」', /初始姿势没有可见附件，已按动画首帧计算包围盒/.test(diag) && /边界 -100 0 200 400（按动画首帧算）/.test(diag), diag.slice(0, 600))
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }

  {
    const page = await newPage()
    await page.goto(link(gcId, 's:chmr_5/script.txt'))
    await page.waitForSelector('.gal-player')
    await page.waitForFunction(() => /Actor1/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 15000 })
    await sleep(900)
    // 舞台垫一块绿底，对舞台截图取中心几点的颜色：透明的特效层不该改变绿色（以前会被加成白）
    await page.evaluate(() => { document.querySelector('.gal-stage').style.background = 'rgb(42, 106, 58)'; document.querySelector('.gal-hud').style.display = 'none' })
    const shot = path.join(work, 'fx-shot.png')
    await page.locator('.gal-stage').screenshot({ path: shot })
    const pixel = (x, y) => execFileSync('convert', [shot, '-format', `%[fx:int(255*p{${x},${y}}.r)],%[fx:int(255*p{${x},${y}}.g)],%[fx:int(255*p{${x},${y}}.b)]`, 'info:'], { encoding: 'utf8' }).split(',').map(Number)
    const dims = execFileSync('identify', ['-format', '%w,%h', shot], { encoding: 'utf8' }).split(',').map(Number)
    const samples = [[0.5, 0.5], [0.5, 0.3], [0.45, 0.7]].map(([fx, fy]) => pixel(Math.round(dims[0] * fx), Math.round(dims[1] * fy)))
    check('Screen 混合 + 透明处带白色 RGB 的直通贴图：画出来后绿底还是绿的（不会被加成白块）——上传时预乘、按预乘画', samples.every(([r, g, b]) => Math.abs(r - 42) < 12 && Math.abs(g - 106) < 12 && Math.abs(b - 58) < 12), J(samples))
    await page.click('.gal-note')
    await sleep(300)
    check('渲染诊断写明「直通贴图，上传时预乘」和 screen 槽数', /直通贴图，上传时预乘/.test(await page.$eval('.gal-diag', (e) => e.innerText)))
    await page.click('.gal-diag .gal-btn:last-of-type').catch(() => {})
    // 混合模式开关：骨骼里有 screen 槽 → 「更多」里出现「混合模式」；切到「全部按普通」→ 存进这个媒体、诊断写明；改回原样 → 提示消失
    const blendVisible = () => page.evaluate(() => [...document.querySelectorAll('.gal-more .gal-more-field')].some((row) => /混合模式/.test(row.textContent) && row.offsetParent !== null))
    await page.evaluate(() => { const menu = document.querySelector('.gal-more'); if (menu.hidden) document.querySelector('.gal-more-btn').click() })
    check('骨骼里有 screen 混合的槽：「更多」里出现「混合模式」', await blendVisible())
    const blendSelect = page.locator('.gal-more .gal-more-field', { hasText: '混合模式' }).locator('select')
    await blendSelect.selectOption('allNormal')
    await sleep(400)
    const savedBlend = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || '{}').blend, gcId)
    await page.click('.gal-note')
    await sleep(300)
    check('切到「全部按普通」：存进这个媒体（blend = allNormal），诊断写明「混合模式覆盖：全部按普通画」', savedBlend === 'allNormal' && /混合模式覆盖：全部按普通画/.test(await page.$eval('.gal-diag', (e) => e.innerText)), String(savedBlend))
    await page.click('.gal-diag .gal-btn:last-of-type').catch(() => {})
    await page.evaluate(() => { const menu = document.querySelector('.gal-more'); if (menu.hidden) document.querySelector('.gal-more-btn').click() })
    await blendSelect.selectOption('native')
    await sleep(300)
    await page.click('.gal-note')
    await sleep(300)
    check('改回「原样」：诊断里不再有覆盖提示', !/混合模式覆盖/.test(await page.$eval('.gal-diag', (e) => e.innerText)))
    await page.click('.gal-diag .gal-btn:last-of-type').catch(() => {})
    check('没有页面错误', page.errors.length === 0, J(page.errors))
    await page.context().close()
  }

  // ===== (2c) 首页「表情」入口：角色 + 预设逐个确认；播放页诊断里的 WebGL 信息 =====
  {
    const page = await newPage()
    await page.goto(`${base}/#/media/gal/${exId}/main`)
    await page.waitForFunction(() => /表情/.test(document.body.innerText), null, { timeout: 15000 })
    check('首页有「表情」卡片', true)
    await page.getByText('表情', { exact: true }).first().click()
    await page.waitForSelector('.gal-expr-review')
    await page.waitForFunction(() => document.querySelector('.gal-expr-info')?.textContent?.includes('预设'), null, { timeout: 15000 })
    check('表情页：左边角色列表（c1_001，0 / 3 已确认），右边预设按次数排（通常 3、喜 2、照れ 1），顶部进度「已确认 0 / 3」', /c1_001/.test(await page.$eval('.gal-expr-cast', (e) => e.textContent)) && /0 \/ 3/.test(await page.$eval('.gal-expr-cast', (e) => e.textContent)) && J(await page.$$eval('.gal-expr-preset-btn', (n) => n.map((b) => b.textContent))) === J(['通常', '喜', '照れ']) && /已确认 0 \/ 3/.test(await page.$eval('.gal-expr-progress', (e) => e.textContent)))
    await page.waitForFunction(() => document.querySelectorAll('.gal-expr-groups select').length >= 3, null, { timeout: 20000 })
    await sleep(700)
    if (process.env.SHOT_EXPR) await page.screenshot({ path: process.env.SHOT_EXPR })
    check('预览：骨架画出来了（预览画布有不透明像素）', await page.evaluate(() => { const c = document.querySelector('.gal-expr-stage .gal-spine'); if (!c || !c.width) return false; const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n += 1; return n / (c.width * c.height) > 0.01 }))
    // 点「喜」：内置表里没有 → 信息写明用默认脸；调眼 = 002、嘴 = 002，保存到这个角色，再确认
    await page.getByRole('button', { name: '喜', exact: true }).click()
    await page.waitForFunction(() => /喜/.test(document.querySelector('.gal-expr-info')?.textContent || '') && /默认脸/.test(document.querySelector('.gal-expr-info')?.textContent || ''), null, { timeout: 15000 })
    check('点「喜」：预设表里没有 → 信息里写明现在用的是默认脸', true)
    const labels = await page.$$eval('.gal-expr-groups .gal-expr-field > span', (n) => n.map((e) => e.textContent))
    const selects = await page.$$('.gal-expr-groups select')
    await selects[labels.findIndex((t) => /\(eye\)|（eye）/.test(t))].selectOption('002')
    await selects[labels.findIndex((t) => /mouse/.test(t))].selectOption('002')
    await sleep(300)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForFunction(() => /来自预设表/.test(document.querySelector('.gal-expr-info')?.textContent || ''), null, { timeout: 10000 })
    const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || '{}'), exId)
    check('保存：存到这个媒体的 expressions（范围 cast001001：喜 = eye 002 + mouse 002），信息变成「来自预设表」', saved.expressions?.cast001001?.['喜']?.eye === '002' && saved.expressions.cast001001['喜'].mouse === '002', J(saved))
    await page.getByRole('button', { name: '确认这个预设', exact: true }).click()
    await page.waitForFunction(() => /已确认 1 \/ 3/.test(document.querySelector('.gal-expr-progress')?.textContent || ''), null, { timeout: 10000 })
    const afterConfirm = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || '{}'), exId)
    check('确认：进度「已确认 1 / 3」，「喜」按钮带 ✓，左边变 1 / 3；confirmed 存进去、没把 expressions 弄丢', afterConfirm.confirmed?.cast001001?.['喜'] === true && afterConfirm.expressions?.cast001001?.['喜']?.eye === '002' && /✓ 喜/.test(await page.$$eval('.gal-expr-preset-btn', (n) => n.map((b) => b.textContent).join('|'))) && /1 \/ 3/.test(await page.$eval('.gal-expr-cast', (e) => e.textContent)), J(afterConfirm))
    await page.getByRole('button', { name: '下一个未确认 ▶' }).click()
    await sleep(500)
    check('「下一个未确认」：跳到「喜」后面第一个没确认的预设（照れ），照れ 在内置预设表里（腮红 001）所以信息写「来自预设表」', /照れ/.test(await page.$eval('.gal-expr-info', (e) => e.textContent)) && /来自预设表（范围 default）/.test(await page.$eval('.gal-expr-info', (e) => e.textContent)), await page.$eval('.gal-expr-info', (e) => e.textContent))
    await page.reload()
    await page.waitForSelector('.gal-expr-review')
    await page.waitForFunction(() => /已确认 1 \/ 3/.test(document.querySelector('.gal-expr-progress')?.textContent || ''), null, { timeout: 15000 })
    check('刷新页面后确认状态还在（已确认 1 / 3）', true)
    await page.click('.gal-expr-review-head .gal-btn')
    await page.waitForFunction(() => /表情/.test(document.body.innerText) && !document.querySelector('.gal-expr-review'), null, { timeout: 15000 })
    check('「↑ 上一级」回到首页', true)
    // 播放页：用到「喜」的脚本，诊断里写「预设表」+ WebGL 信息
    await page.goto(`${base}/#/media/gal/${exId}/main?section=${encodeURIComponent('s:story_1/script.txt')}`)
    await page.waitForSelector('.gal-player')
    await page.waitForFunction(() => /Actor7/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 20000 })
    await goTo(page, '2 / 2')
    await sleep(600)
    await page.click('.gal-note')
    await sleep(300)
    const diag = await page.$eval('.gal-diag', (e) => e.innerText)
    check('播放页：「喜」走你刚保存的预设表（eye_002 / mouse_002）', /表情预设「喜」→ 预设表（范围 cast001001）/.test(diag) && /eye\/eye_002/.test(diag) && /mouse\/mouse_002/.test(diag), diag.slice(0, 900))
    check('渲染诊断有 WebGL 一行：显卡型号 / 上下文状态 / 画布尺寸 / 最大贴图 / 最近 GL 错误', /WebGL（Spine 3\.8）：显卡 .+ · 上下文正常 · 画布 \d+x\d+.+ · 最大贴图 \d+ · 最近 GL 错误 /.test(diag), diag.split('\n').filter((l) => /WebGL/.test(l)).join('|'))
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
    await page.waitForFunction(() => /5 个剧情/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {})
    const after = await page.evaluate(() => document.body.innerText)
    check('点「刷新」后新增的场景出现在列表里（chmr 分类 4 个剧情变 5 个）', /5 个剧情/.test(after) && !/4 个剧情/.test(after), J(after.split('\n').filter(Boolean).slice(8, 40)))
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
  console.log(`FAIL 测试中断：${String(error?.message || error).split('\n')[0]}`); if (process.env.LM_DEBUG) console.log(String(error?.message || error).slice(0, 900))
  if (process.env.LM_DEBUG && lastPage) { console.log(await lastPage.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '')); console.log(lastPage.errors) }
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
