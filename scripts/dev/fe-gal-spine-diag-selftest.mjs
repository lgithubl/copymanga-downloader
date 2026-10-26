#!/usr/bin/env node
// 浏览器自测：Spine / 渲染问题要在右侧「渲染诊断」里说清楚（以前静默的）。端口 8181。需要先 sh scripts/fetch-spine-runtime.sh（3.6 / 3.8 / 4.0 运行时）。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-spine-diag-selftest.mjs
// A. 纯函数 spineProblemLines（不需要浏览器）
// B. 图层（3.8 二进制 / 3.8 JSON / 4.0 JSON / 3.6 JSON 各一遍）：(a) 要的动画骨架里没有（按轨道）(b) 要的皮肤没有 (c) 多轨道里没应用的轨道写原因
//    (d) 图集贴图缺失 / atlas 里没有页 (e) 加载成功但初始姿势没有可见附件：按动画首帧算包围盒（Aku No Onna Kanbu 的 3.6.53 结构：1 骨骼 + 11 槽 + 10 个只有 slots 时间线的动画，Em06 要画出东西）/ 骨骼头宽高 / 包围盒为空
// C. 整个播放器：这些行出现在右下角提示展开的渲染诊断里；config 里被夹住的内容（config-dropped）、适配器统计也在
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as layoutScript } from '../tag-scripts/gal-layout/main.js'
import { spineProblemLines } from '../../web/static/gal-spine.js'
import { writeSpine } from './make-spine-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
for (const name of ['spine-webgl.js', 'spine-webgl-3.6.js', 'spine-webgl-4.0.js']) if (!existsSync(path.join(root, 'web/static/vendor', name))) { console.error(`缺 ${name}：先 sh scripts/fetch-spine-runtime.sh`); process.exit(2) }
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const shotDir = process.env.SHOT_DIR || os.tmpdir()

// ---- A. 纯函数 ----
{
  const base = { loaded: true, slot: 'a', animations: ['idle', 'walk'], used: 'idle', skins: ['default(3)'], skin: '', skinRequested: '', skinFound: true, requestedTracks: [], boundsSource: 'setup', bounds: [0, 0, 1, 1], slotCount: 3 }
  check('没有问题的骨架 = 没有行', spineProblemLines(base).length === 0 && spineProblemLines(null).length === 0, '')
  const single = spineProblemLines({ ...base, requestedTracks: [{ track: 0, anim: 'run', found: false }] })
  check('(a) 单动画：要的动画骨架里没有 → 写明改播了哪个、骨架里有哪些', single.length === 1 && /要播的动画「run」骨架里没有，改播「idle」（骨架里有 2 个动画：idle, walk）/.test(single[0]), J(single))
  const multi = spineProblemLines({ ...base, used: 'a', animations: ['a'], requestedTracks: [{ track: 0, anim: 'a', found: true }, { track: 1, anim: 'b', found: false }] })
  check('(a)(c) 多轨道：哪条轨道的哪个动画没有，写明「这条轨道没有播」；汇总「要 0:a 1:b → 实际应用 0:a」并说原因', multi.some((l) => /轨道 1 要播的动画「b」骨架里没有，这条轨道没有播/.test(l)) && multi.some((l) => /多轨道：要 0:a 1:b → 实际应用 0:a；没应用的轨道原因：动画名在骨架里不存在/.test(l)), J(multi))
  check('(b) 皮肤：要的皮肤没有 → 写明改用了什么、骨架里有哪些', /要的皮肤「red」骨架里没有，改用「blue」（骨架里的皮肤：default, blue）/.test(spineProblemLines({ ...base, skinRequested: 'red', skinFound: false, skin: 'blue', skins: ['default(0)', 'blue(4)'] })[0]) && spineProblemLines({ ...base, skinRequested: 'default', skinFound: true }).length === 0, '')
  check('(d) 贴图页缺失：写明缺哪些页、atlas 声明几页；没加载好（loaded:false）也能报', /图集贴图缺失：a\/p1\.png, a\/p2\.png（atlas 声明 3 页，缺 2 页）/.test(spineProblemLines({ loaded: false, missingPages: ['a/p1.png', 'a/p2.png'], atlasPages: 3 })[0]), J(spineProblemLines({ loaded: false, missingPages: ['a/p1.png', 'a/p2.png'], atlasPages: 3 })))
  check('(e) 包围盒来源：animation / header / none 各一句；slots 为空也报', spineProblemLines({ ...base, boundsSource: 'animation' })[0] === '初始姿势没有可见附件，已按动画首帧计算包围盒' && /按骨骼文件头的宽高估算（1 2 3 4）/.test(spineProblemLines({ ...base, boundsSource: 'header', bounds: [1, 2, 3, 4] })[0]) && /^包围盒为空：骨架加载成功.*共 11 个槽.*骨骼文件头也没有宽高/.test(spineProblemLines({ ...base, boundsSource: 'none', boundsEmpty: true, slotCount: 11, animationsTried: true, bounds: null })[0]) && /没有任何槽/.test(spineProblemLines({ ...base, slotCount: 0 })[0]), '')
}

// ---- B. 图层 ----
const work = await mkdtemp(path.join(os.tmpdir(), 'fe-spdiag-'))
const fx = path.join(work, 'fx')
const ANIMS = ['idle_normal', 'idle_joy']
const VERSIONS = [
  { key: '38b', label: '3.8 二进制', runtime: '3.8', format: 'binary', version: '3.8.99' },
  { key: '38j', label: '3.8 JSON', runtime: '3.8', format: 'json', version: '3.8.99' },
  { key: '40j', label: '4.0 JSON', runtime: '4.0', format: 'json', version: '4.0.64' },
  { key: '36j', label: '3.6 JSON', runtime: '3.6', format: 'json', version: '3.6.52' },
]
for (const v of VERSIONS) {
  await writeSpine(fx, v.key, { format: v.format, color: 'seagreen', animations: ANIMS, version: v.version })
  // 整个身体由动画切附件拼出来（初始姿势没有可见附件）
  await writeSpine(fx, `em${v.key}`, { format: 'json-emotes', color: 'seagreen', version: v.version === '3.8.99' ? '3.8.99' : v.version === '3.6.52' ? '3.6.53' : v.version })
}
await writeSpine(fx, 'emhead', { format: 'json-emotes', color: 'seagreen', version: '3.8.99', emotesOptions: { noAttach: true } })                   // 任何动画里都没有附件，头里有宽高
await writeSpine(fx, 'emnone', { format: 'json-emotes', color: 'seagreen', version: '3.8.99', emotesOptions: { noAttach: true, header: false } })    // 连头里的宽高也没有
await writeSpine(fx, 'emlate', { format: 'json-emotes', color: 'seagreen', version: '3.6.53', emotesOptions: { firstFrameAt: 0.3 } })                // 首个关键帧在 0.3 秒（不在 0 秒）
await writeSpine(fx, 'nopage', { format: 'json', color: 'seagreen', animations: ANIMS })
await unlink(path.join(fx, 'nopage.png'))                                                                                                            // atlas 声明的贴图页不存在
await writeSpine(fx, 'noatlas', { format: 'json', color: 'seagreen', animations: ANIMS })
await writeFile(path.join(fx, 'noatlas.atlas.txt'), 'size: 64,128\nformat: RGBA8888\n')                                                              // atlas 里没有任何页

const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
const port = 8181
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/fx/**', async (route) => {
    const file = path.join(fx, decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/fx\//, '')))
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' })
    await route.fulfill({ status: 200, body: await readFile(file), contentType: /\.png$/.test(file) ? 'image/png' : 'application/octet-stream' })
  })
  await page.goto(`${base}/health`)
  const newLayer = () => page.evaluate(async () => {
    document.body.innerHTML = '<style>html,body{margin:0}#stage{position:relative;width:600px;height:600px;background:#000}#stage canvas{position:absolute;left:0;top:0;width:100%;height:100%}</style><div id="stage"></div>'
    const { createSpineLayer } = await import('/gal-spine.js')
    window.__events = { missing: [], unavailable: [], errors: [] }
    window.__layer?.destroy()
    window.__layer = createSpineLayer({ parent: document.getElementById('stage'), url: (src) => `/fx/${src}`, onMissing: (s) => window.__events.missing.push(s), onUnavailable: (v) => window.__events.unavailable.push(v), onError: (e) => window.__events.errors.push(e) })
  })
  const settle = (specs) => page.evaluate(async (s) => { await window.__layer.set(s, { live: false }); await window.__layer.ready() }, specs)
  const infoOf = (slot = 'A') => page.evaluate((s) => window.__layer.info().find((r) => r.slot === s), slot)
  const coverage = (runtime) => page.evaluate((rt) => {
    const c = document.querySelector(`canvas.gal-spine[data-runtime="${rt}"]`)
    if (!c) return -1
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
    const ctx = g.getContext('2d'); ctx.drawImage(c, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 200) n += 1
    return n / (c.width * c.height)
  }, runtime)
  const spec = (name, extra = {}) => ({ skel: `${name}.skel.bytes`, atlas: `${name}.atlas.txt`, kind: 'chara', x: 0.5, order: 0, ...extra })

  for (const v of VERSIONS) {
    await newLayer()
    // (a) 单动画不存在
    await settle({ A: spec(v.key, { anim: 'run' }) })
    let row = await infoOf()
    check(`${v.label}：(a) 要的动画骨架里没有 → problems 写「要播的动画「run」骨架里没有，改播「idle_normal」」并列出骨架里的动画；识别 ${v.version} / 运行时 ${v.runtime}`, row.loaded && row.runtime === v.runtime && row.problems.some((l) => /要播的动画「run」骨架里没有，改播「idle_normal」（骨架里有 2 个动画：idle_normal, idle_joy）/.test(l)), J(row.problems))
    // 动画存在 + 皮肤存在：没有问题
    await settle({ A: spec(v.key, { anim: 'idle_joy', skin: 'default' }) })
    row = await infoOf()
    check(`${v.label}：动画和皮肤都对 → problems 为空（骨架可见，包围盒来自初始姿势）`, row.problems.length === 0 && row.boundsSource === 'setup' && row.bounds?.length === 4 && row.used === 'idle_joy', J(row))
    // (b) 皮肤不存在
    await settle({ A: spec(v.key, { anim: 'idle_normal', skin: 'ghost' }) })
    row = await infoOf()
    check(`${v.label}：(b) 要的皮肤不存在 → 「要的皮肤「ghost」骨架里没有，用默认皮肤（骨架里的皮肤：default）」`, row.problems.some((l) => /要的皮肤「ghost」骨架里没有，用默认皮肤（骨架里的皮肤：default）/.test(l)) && row.skinRequested === 'ghost' && row.skinFound === false, J(row.problems))
    // (a)(c) 多轨道
    await settle({ A: spec(v.key, { tracks: [{ track: 0, anim: 'idle_normal', loop: true }, { track: 1, anim: 'smile_x', loop: true }, { track: 2, anim: 'idle_joy', loop: true }] }) })
    row = await infoOf()
    check(`${v.label}：(a)(c) 多轨道：轨道 1 的动画不存在 → 写「轨道 1 要播的动画「smile_x」骨架里没有，这条轨道没有播」，汇总「要 0:idle_normal 1:smile_x 2:idle_joy → 实际应用 0:idle_normal 2:idle_joy」，轨道 0 / 2 照常`, row.problems.some((l) => /轨道 1 要播的动画「smile_x」骨架里没有，这条轨道没有播（骨架里有 2 个动画/.test(l)) && row.problems.some((l) => /多轨道：要 0:idle_normal 1:smile_x 2:idle_joy → 实际应用 0:idle_normal 2:idle_joy；没应用的轨道原因/.test(l)) && !row.problems.some((l) => /轨道 [02] 要播/.test(l)), J(row.problems))
    // (e) 初始姿势没有可见附件：按动画首帧算包围盒，画得出来
    await newLayer()
    await settle({ A: spec(`em${v.key}`, { anim: 'Em06' }) })
    await sleep(500)
    row = await infoOf()
    const covered = await coverage(v.runtime)
    check(`${v.label}：(e) 整个身体由动画切附件拼出来（初始姿势没有附件）：包围盒来源 = animation，写「初始姿势没有可见附件，已按动画首帧计算包围盒」；Em06 画出非空像素（占画布 ${(covered * 100).toFixed(1)}%）`, row.loaded && row.boundsSource === 'animation' && row.boundsEmpty === false && row.attachmentsSetup === 0 && row.slotCount === 11 && row.bounds?.length === 4 && row.problems.includes('初始姿势没有可见附件，已按动画首帧计算包围盒') && covered > 0.05, J([row.boundsSource, row.bounds, row.problems, covered]))
    if (v.key === '36j') await page.screenshot({ path: path.join(shotDir, 'spine-diag-em06-36.png') })
  }

  // 3.6.53 JSON（Aku）细节：Em00 和 Em06 的画面都有东西；没有请求动画（空串）时包围盒来自头里的宽高；换动画后包围盒跟着重新量
  await newLayer()
  await settle({ A: spec('em36j', { anim: 'Em00' }) })
  await sleep(400)
  const em00 = await coverage('3.6')
  await settle({ A: spec('em36j', { anim: 'Em06' }) })
  await sleep(400)
  const em06 = await coverage('3.6')
  check('3.6.53 emotes：Em00 / Em06 都画得出来（切动画后包围盒重新量，画面仍在）', em00 > 0.05 && em06 > 0.05 && (await infoOf()).used === 'Em06', J([em00, em06]))
  await newLayer()
  await settle({ A: spec('em36j', { anim: '' }) })
  row0: {
    const row = await infoOf()
    check('3.6.53 emotes 没指定动画：用骨架第一个动画（Em00）首帧算包围盒，不是空', row.boundsSource === 'animation' && row.used === 'Em00', J([row.boundsSource, row.used]))
  }
  // 首个关键帧在 0.3 秒：首帧（0 秒）没有附件，往后几个时间点能量到
  await newLayer()
  await settle({ A: spec('emlate', { anim: 'Em06' }) })
  check('首个关键帧不在 0 秒（0.3 秒才打开附件）：往后取样也能量到包围盒', (await infoOf()).boundsSource === 'animation', J(await infoOf()))
  // 都没有：头里的宽高 / 空
  await newLayer()
  await settle({ A: spec('emhead', { anim: 'Em06' }) })
  let row = await infoOf()
  check('任何动画里都没有可见附件、骨骼头里有宽高：包围盒按头里的 1830×2696 估算（来源 header），诊断写明', row.boundsSource === 'header' && row.boundsEmpty === false && J(row.bounds) === J([-915, 0, 1830, 2696]) && row.problems.some((l) => /初始姿势和动画首帧都没有可见附件，包围盒按骨骼文件头的宽高估算（-915 0 1830 2696）/.test(l)), J([row.boundsSource, row.bounds, row.problems]))
  await newLayer()
  await settle({ A: spec('emnone', { anim: 'Em06' }) })
  row = await infoOf()
  check('连头里的宽高也没有：包围盒为空（来源 none），诊断写「包围盒为空：…共 11 个槽，0 个可见…画面上不会有东西」；骨架仍算加载成功，不抛错', row.loaded && row.boundsSource === 'none' && row.boundsEmpty === true && row.bounds === null && row.problems.some((l) => /^包围盒为空：骨架加载成功，但初始姿势和动画首帧都没有可见附件（共 11 个槽，附件 0 个可见）/.test(l)), J([row.boundsSource, row.problems]))
  // (d) 贴图页缺失 / atlas 没有页
  await newLayer()
  await settle({ A: spec('nopage', { anim: 'idle_normal' }) })
  row = await infoOf()
  const ev = await page.evaluate(() => window.__events)
  check('(d) atlas 声明的贴图页（nopage.png）取不到：骨架没加载，problems 写「图集贴图缺失：nopage.png（atlas 声明 1 页，缺 1 页）」，error 写原因，onMissing 报了这一页', !row.loaded && row.missingPages.length === 1 && row.problems.some((l) => /图集贴图缺失：nopage\.png（atlas 声明 1 页，缺 1 页）/.test(l)) && /取不到图集图片 nopage\.png（atlas 声明 1 页，缺 1 页）/.test(row.error) && ev.missing.includes('nopage.png'), J([row.problems, row.error, ev.missing]))
  await newLayer()
  await settle({ A: spec('noatlas', { anim: 'idle_normal' }) })
  row = await infoOf()
  const ev2 = await page.evaluate(() => window.__events)
  check('(d) atlas 里没有任何页：解析失败，写「atlas 里没有找到任何图集页」，不冒充缺资源', !row.loaded && row.errorKind === 'parse' && /atlas 里没有找到任何图集页/.test(row.error) && ev2.errors.some((e) => e.kind === 'parse') && ev2.missing.length === 0, J([row.error, ev2]))
  check('没有页面错误', errors.length === 0, J(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断（图层部分）：${error.message.split('\n')[0]} @ ${(error.stack || '').split('\n').find((l) => l.includes('spine-diag-selftest')) || ''}`)
}

// ---- C. 整个播放器 ----
try {
  const media = path.join(dataDir, 'gal', 'sd-pack')
  const R0 = path.join(media, 'G')
  const at = (...parts) => path.join(R0, ...parts)
  const ANIM1 = ['animation1']
  const SP = 'Spines/Stills/234/223440107'
  await writeSpine(at(SP), '1', { format: 'json', color: 'goldenrod', animations: ANIM1, version: '3.8.99' })                  // 只有 animation1；脚本要 Em06 → (a)
  await writeSpine(at(SP), '3', { format: 'json-emotes', color: 'deepskyblue', version: '3.8.99' })                             // 初始姿势没有可见附件 → (e)
  for (const dir of ['MasterData', 'Sounds']) await mkdir(at(dir), { recursive: true })
  await writeFile(at('MasterData/MSceneViewModel.json'), '[]')
  const row = (t, a) => [1, 1, '', t, 2, 3, false, null, 0, 0, '', '', '', '', '', null, 0, [], [a, null, null, null, null, null, null]]
  await mkdir(at('UScenes/Stills/234'), { recursive: true })
  await writeFile(at('UScenes/Stills/234/223440107.json'), J([null, [223440107, [row('a', 'Em06'), row('b', 'Em06')], [[], [], []], false]]))
  await writeFile(at('Spines/Stills/234/still_configuration.json'), '{}')
  const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })
  const imp = await handler.importFromSource({ sourcePath: media, options: { adapters: ['misttrain-json'], config: { game: { id: 'misttrain' } } } })
  const out = await layoutScript({ item: imp.items[0], script: { id: 'gal-layout', version: '2.7.0', options: {} } })
  const gal = { ...out.itemPatch.gal, config: { ...out.itemPatch.gal.config, thumbFallback: { max: 99 } } }   // 故意写错一个值：被夹住并报 config-dropped
  await handler.patchItemMetadata(imp.items[0].itemId, { gal })
  const itemId = imp.items[0].itemId
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => { localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })) })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent('s:Stills/234/223440107.json')}`)
  await page.waitForSelector('.gal-player', { timeout: 15000 })
  await page.waitForFunction(() => document.querySelectorAll('.gal-spine').length >= 1, null, { timeout: 30000 })
  await sleep(2500)
  const noteText = await page.$eval('.gal-note', (e) => e.textContent)
  await page.click('.gal-note')
  const diag = await page.$eval('.gal-diag-text', (e) => e.textContent)
  check('播放器右下角提示出现「骨骼渲染提示 N 条」「配置 / 索引提示 N 条」', /骨骼渲染提示 \d+ 条/.test(noteText) && /配置 \/ 索引提示 \d+ 条/.test(noteText), noteText)
  check('渲染诊断：(a) 骨骼 1 的动画 Em06 不存在 → 「⚠ 要播的动画「Em06」骨架里没有，改播「animation1」」', /\[still0\][^\n]*\n(?:    [^\n]*\n)*?    ⚠ 要播的动画「Em06」骨架里没有，改播「animation1」（骨架里有 1 个动画：animation1）/.test(diag), diag.slice(0, 1500))
  check('渲染诊断：(e) 骨骼 3（初始姿势没有可见附件）→ 「⚠ 初始姿势没有可见附件，已按动画首帧计算包围盒」，边界行标「（按动画首帧算）」', /⚠ 初始姿势没有可见附件，已按动画首帧计算包围盒/.test(diag) && /边界 [-\d ]+（按动画首帧算）/.test(diag), diag.slice(0, 1500))
  check('渲染诊断：config 里被夹住的内容（thumbFallback.max）出现在「配置 / 索引提示」里（播放页以前看不到）', /配置 \/ 索引提示（\d+）：\n  \[提示\] config-dropped：config\.thumbFallback\.max：超出范围 1–12，夹到 12/.test(diag), diag.slice(-700))
  await page.screenshot({ path: path.join(shotDir, 'spine-diag-player.png') })
  check('没有页面错误', errors.length === 0, J(errors))
  await context.close()
} catch (error) {
  fail++
  console.log(`FAIL 测试中断（播放器部分）：${error.message.split('\n')[0]} @ ${(error.stack || '').split('\n').find((l) => l.includes('spine-diag-selftest')) || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
