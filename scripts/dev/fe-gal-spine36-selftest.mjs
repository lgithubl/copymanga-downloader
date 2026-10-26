#!/usr/bin/env node
// 自测：Spine 3.6（GrenzeViewer 那种 3.6.38 二进制 + 旧格式 atlas）。需要先 sh scripts/fetch-spine-runtime.sh（要 spine-webgl-3.6.js 和 spine-webgl.js）。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-spine36-selftest.mjs
// 三部分：
//   A. 版本识别 + 二进制 → JSON 转换器（合成的 3.6 二进制，不需要浏览器）
//   B. 官方 3.6 运行时：确认它有 SkeletonJson / SceneRenderer 而没有 SkeletonBinary（这就是要有转换器的原因）；
//      用官方 3.6 示例里成对的 .skel / .json（spine-runtimes 3.6 分支固定提交，测试时下载到临时目录，不进仓库；下不到就跳过这一段）逐项比对转换结果
//   C. 真实 WebGL（headless Chromium + SwiftShader）：3.6 二进制 / 3.6 JSON / 3.8 JSON 同一页里共存（互不覆盖全局 spine），画出来、动画生效、损坏的 3.6 骨骼报「解析失败」
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectSpineVersion, SPINE_RUNTIMES } from '../../web/static/gal-spine.js'
import { spine36BinaryToJson } from '../../web/static/gal-spine36-binary.js'
import { atlasText, spineBinary36, spineJson, writeSpine } from './make-spine-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vendor = (name) => path.join(root, 'web/static/vendor', name)
if (!existsSync(vendor('spine-webgl-3.6.js')) || !existsSync(vendor('spine-webgl.js'))) { console.error('缺 3.6 / 3.8 运行时：先 sh scripts/fetch-spine-runtime.sh'); process.exit(2) }
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- A. 版本识别 + 转换器 ----
{
  const bin = spineBinary36({ animations: ['idle', { name: 'flip', angle: 180 }] })
  check('3.6.38 二进制头（28 字符 hash + 版本）→ 3.6.38 / 运行时 3.6', J(detectSpineVersion(bin)) === J({ format: 'binary', version: '3.6.38', runtime: '3.6' }), J(detectSpineVersion(bin)))
  check('JSON "spine":"3.6.52" → 运行时 3.6；3.7.94 二进制 / JSON 仍然不支持', detectSpineVersion(spineJson({ version: '3.6.52' })).runtime === '3.6' && detectSpineVersion(spineBinary36({ version: '3.7.94' })).runtime === '' && detectSpineVersion(spineJson({ version: '3.7.94' })).runtime === '', '')
  check('SPINE_RUNTIMES 登记了 3.6（/vendor/spine-webgl-3.6.js），3.8 的路径没变', SPINE_RUNTIMES['3.6'] === '/vendor/spine-webgl-3.6.js' && SPINE_RUNTIMES['3.8'] === '/vendor/spine-webgl.js', J(SPINE_RUNTIMES))
  const root36 = spine36BinaryToJson(bin)
  check('转换器：头 / 骨骼 / 插槽 / 附件 / 动画的字段都读对', root36.skeleton.spine === '3.6.38' && root36.skeleton.width === 200 && J(root36.bones) === J([{ name: 'root', rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, length: 0, transform: 'normal' }]) && root36.slots[0].attachment === 'body' && root36.slots[0].blend === 'normal' && root36.slots[0].color === 'ffffffff' && root36.skins.default.body.body.type === 'region' && root36.skins.default.body.body.height === 400 && Object.keys(root36.animations).join() === 'idle,flip' && root36.animations.flip.bones.root.rotate[0].angle === 180, J(root36).slice(0, 600))
  const color = root36.animations.idle.slots.body.color
  check('转换器：曲线（线性 / 贝塞尔 / 阶梯）和帧时间读对，最后一帧没有曲线', J(color.map((f) => f.curve ?? null)) === J([[0.25, 0, 0.75, 1], 'stepped', null]) && J(color.map((f) => f.time)) === J([0, 0.5, 1]), J(color))
  check('转换器：nonessential 头（fps / images）读对', spine36BinaryToJson(spineBinary36({ nonessential: true })).skeleton.fps === 30, '')
  let truncated = ''
  try { spine36BinaryToJson(bin.subarray(0, bin.length - 7)) } catch (error) { truncated = error.message }
  let wrong = ''
  try { spine36BinaryToJson(spineBinary36({ version: '3.8.99' })) } catch (error) { wrong = error.message }
  check('转换器：被截断的文件、不是 3.6 的文件都抛错（由加载层报「解析失败」，不会静默画出空东西）', /读到文件末尾之外/.test(truncated) && /不是 Spine 3\.6/.test(wrong), J([truncated, wrong]))
}

// ---- B. 官方 3.6 运行时 ----
const loadRuntime = (file) => new Function('window', 'document', `${require_fs(file)}\nreturn spine`).call(globalThis, {}, {})
const require_fs = (file) => createRequire(import.meta.url)('node:fs').readFileSync(vendor(file), 'utf8')
{
  const sp = loadRuntime('spine-webgl-3.6.js')
  check('官方 3.6 运行时：有 SkeletonJson、spine.webgl.SceneRenderer、TextureAtlas；没有 SkeletonBinary（所以二进制要走转换器）', typeof sp.SkeletonJson === 'function' && typeof sp.webgl?.SceneRenderer === 'function' && typeof sp.TextureAtlas === 'function' && sp.SkeletonBinary === undefined, J(Object.keys(sp).filter((k) => /Skeleton/.test(k))))
  const atlas = new sp.TextureAtlas(atlasText('x'), () => ({ getImage: () => ({ width: 64, height: 128 }), setFilters() {}, setWraps() {} }))
  const data = new sp.SkeletonJson(new sp.AtlasAttachmentLoader(atlas)).readSkeletonData(spine36BinaryToJson(spineBinary36({ animations: ['idle', { name: 'flip', angle: 180 }] })))
  const flip = data.findAnimation('flip')
  check('官方 3.6 SkeletonJson 吃转换结果：版本 3.6.38、1 骨骼 1 插槽 2 个动画、旧格式 atlas 的区域解析出来了', data.version === '3.6.38' && data.bones.length === 1 && data.slots.length === 1 && data.animations.length === 2 && Boolean(flip) && atlas.findRegion('body')?.width === 64, '')
  const skeleton = new sp.Skeleton(data)
  const state = new sp.AnimationState(new sp.AnimationStateData(data))
  state.setAnimation(0, 'flip', true)
  state.update(0.1); state.apply(skeleton); skeleton.updateWorldTransform()
  check('官方 3.6 AnimationState 播放：flip 动画把根骨骼转到 180 度', Math.abs(skeleton.bones[0].rotation - 180) < 1e-3, String(skeleton.bones[0].rotation))

  // 官方示例里成对的 .skel / .json：转换结果和官方 JSON 建出来的 SkeletonData 逐项比对（数值容差：官方 JSON 只保留两位小数）
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spine36-ex-'))
  const SHA = '654c20e5b0e523040b6366bbd1042510d2645134'
  const names = ['alien/alien-pro', 'dragon/dragon-ess', 'goblins/goblins-pro', 'hero/hero-pro', 'powerup/powerup-pro', 'raptor/raptor-pro', 'spineboy/spineboy-pro', 'stretchyman/stretchyman-pro', 'tank/tank-pro', 'vine/vine-pro', 'speedy/speedy-ess']
  const get = async (rel, as) => { const r = await fetch(`https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/${SHA}/examples/${rel}`, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(String(r.status)); return as === 'text' ? r.text() : new Uint8Array(await r.arrayBuffer()) }
  const walk = (a, b, p, out) => {
    if (/\.(id|texture)$/.test(p) || /drawOrders/.test(p)) return   // 附件序号 / 假贴图 / 绘制顺序（无偏移时二进制写恒等顺序、JSON 写 null，效果一样）
    if (/\.curves\.\d+$/.test(p) && typeof a === 'number' && typeof b === 'number' && a !== b && [a, b].every((v) => v === 0 || v === 1)) return   // 线性 / 阶梯标记：示例里个别颜色帧两端同色，导出器写法不一样
    if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 0.2) out.push(`${p}: ${a} vs ${b}`); return }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a)
      if (Array.isArray(a) !== Array.isArray(b) || ka.length !== Object.keys(b).length) { out.push(`${p}: 形状 ${ka.length} vs ${Object.keys(b).length}`); return }
      for (const k of ka) walk(a[k], b[k], `${p}.${k}`, out)
      return
    }
    if (a !== b) out.push(`${p}: ${J(a)} vs ${J(b)}`)
  }
  const plain = (v, seen = new WeakSet()) => { if (v && typeof v === 'object') { if (ArrayBuffer.isView(v)) return Array.from(v); if (seen.has(v)) return '~'; seen.add(v); if (Array.isArray(v)) return v.map((x) => plain(x, seen)); const o = {}; for (const k of Object.keys(v).sort()) o[k] = plain(v[k], seen); return o } return v }
  try {
    const results = []
    for (const name of names) {
      const [folder, base] = name.split('/')
      const [skel, json, atlasTextRaw] = await Promise.all([get(`${folder}/export/${base}.skel`), get(`${folder}/export/${base}.json`, 'text'), get(`${folder}/export/${folder}.atlas`, 'text')])
      const loader = () => new sp.AtlasAttachmentLoader(new sp.TextureAtlas(atlasTextRaw, () => ({ getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {} })))
      const detected = detectSpineVersion(skel)
      const a = new sp.SkeletonJson(loader()).readSkeletonData(spine36BinaryToJson(skel))
      const b = new sp.SkeletonJson(loader()).readSkeletonData(json)
      a.hash = b.hash = a.version = b.version = null
      a.fps = b.fps = 0
      a.imagesPath = b.imagesPath = null
      const out = []
      walk(plain(a), plain(b), '', out)
      // 非渲染用的附件颜色（包围盒 / 路径的编辑器颜色）：二进制写了、JSON 没写，不比；其它差异一律算
      results.push({ name, runtime: detected.runtime, version: detected.version, diffs: out.filter((line) => !/\.(attachment|attachments\.\d+\.[^.]+)\.color\.[rgba]:/.test(line)), anims: a.animations.length })
    }
    const bad = results.filter((r) => r.diffs.length || r.runtime !== '3.6')
    check(`官方 3.6 示例（${results.length} 个真实 .skel，版本 ${[...new Set(results.map((r) => r.version))].join(' / ')}）：头识别为 3.6，转换后建出的骨架和官方 JSON 一致（骨骼 / 插槽 / 皮肤 / 网格 / 权重 / 约束 / 事件 / 变形 / 动画时间线）`, bad.length === 0, J(bad.map((r) => ({ name: r.name, runtime: r.runtime, diffs: r.diffs.slice(0, 4) }))))
  } catch (error) {
    console.log(`SKIP 官方 3.6 示例比对（下载不到：${error.message}）`)
  } finally { await rm(dir, { recursive: true, force: true }) }
}

// ---- C. 浏览器：3.6 / 3.8 同页共存 ----
let chromium
try { ;({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.log('SKIP 浏览器部分：需要 @playwright/test（设置 PLAYWRIGHT_PATH）'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0) }
const work = await mkdtemp(path.join(os.tmpdir(), 'fe-sp36-'))
const fx = path.join(work, 'fx')
const ANIMS = [{ name: 'idle', angle: 0 }, { name: 'flip', angle: 180 }]
await writeSpine(fx, 'b36', { format: 'binary36', color: 'deepskyblue', animations: ANIMS })                          // 3.6.38 二进制
await writeSpine(fx, 'j36', { format: 'json', color: 'crimson', animations: ['idle', 'flip'], version: '3.6.52' })    // 3.6 JSON
await writeSpine(fx, 'j38', { format: 'json', color: 'goldenrod', animations: ['idle', 'flip'], version: '3.8.99' })  // 3.8 JSON
await writeSpine(fx, 'bad36', { format: 'binary36', color: 'green', animations: ANIMS })
await writeFile(path.join(fx, 'bad36.skel.bytes'), (await readFile(path.join(fx, 'bad36.skel.bytes'))).subarray(0, 120))   // 截断的 3.6 二进制
await writeSpine(fx, 'png36', { format: 'binary36', color: 'purple', animations: ANIMS })
await writeSpine(fx, 'aku36', { format: 'json-emotes', color: 'darkorange', version: '3.6.53' })                      // Aku No Onna Kanbu 的结构：3.6.53 JSON、1 骨骼 + 11 槽、动画 Em00…Em09 只有 slots 时间线（附件由动画切出来），atlas 开头有空行
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
const port = 8136
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
let browser
try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await context.newPage()
  const errors = []
  const logs = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (/gal-spine/.test(m.text())) logs.push(m.text()) })
  await page.route('**/fx/**', async (route) => {
    const file = path.join(fx, decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/fx\//, '')))
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' })
    await route.fulfill({ status: 200, body: await readFile(file), contentType: /\.png$/.test(file) ? 'image/png' : 'application/octet-stream' })
  })
  await page.goto(`${base}/health`)
  await page.evaluate(async () => {
    document.body.innerHTML = '<style>html,body{margin:0}#stage{position:relative;width:600px;height:600px;background:#000}#stage canvas{position:absolute;left:0;top:0;width:100%;height:100%}</style><div id="stage"></div>'
    const { createSpineLayer } = await import('/gal-spine.js')
    window.__events = { missing: [], unavailable: [], errors: [] }
    window.__layer = createSpineLayer({ parent: document.getElementById('stage'), url: (src) => `/fx/${src}`, onMissing: (s) => window.__events.missing.push(s), onUnavailable: (v) => window.__events.unavailable.push(v), onError: (e) => window.__events.errors.push(e) })
  })
  const spec = (name, x, anim, extra = {}) => ({ skel: `${name}.skel.bytes`, atlas: `${name}.atlas.txt`, kind: 'chara', x, anim, order: 0, ...extra })
  const setSpecs = (specs) => page.evaluate((s) => window.__layer.set(s, { live: false }), specs)
  const pixel = (runtime, fx0, fy0) => page.evaluate(([rt, x, y]) => {
    const c = document.querySelector(`canvas.gal-spine[data-runtime="${rt}"]`)
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
    const ctx = g.getContext('2d'); ctx.drawImage(c, 0, 0)
    return [...ctx.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data]
  }, [runtime, fx0, fy0])
  const near = (rgba, [r, g, b], tol = 45) => rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol
  const info = () => page.evaluate(() => window.__layer.info())

  // 1. 同一页：3.6 二进制（左）+ 3.6 JSON（中）+ 3.8 JSON（右）
  await setSpecs({ A: spec('b36', 0.2, 'idle'), B: spec('j36', 0.5, 'idle'), C: spec('j38', 0.8, 'idle') })
  await page.waitForFunction(() => window.__layer.loadedCount() === 3, null, { timeout: 30000 })
  await sleep(800)
  const runtimes = await page.$$eval('canvas.gal-spine', (cs) => cs.map((c) => c.dataset.runtime).sort())
  check('3.6 和 3.8 各一块 canvas（3.6 二进制和 3.6 JSON 共用 3.6 这一块）', J(runtimes) === J(['3.6', '3.8']), J(runtimes))
  const globals = await page.evaluate(() => ({ hasGlobal: Boolean(window.spine?.webgl), binary: typeof window.spine?.SkeletonBinary, physics: typeof window.spine?.Physics }))
  check('全局 spine 还是 3.8 的（有 SkeletonBinary）：3.6 是隔离加载的，没有覆盖它', globals.hasGlobal && globals.binary === 'function', J(globals))
  // chara：高度 95%、底边对齐、水平居中在 x；200×400 的区域缩放成 0.95×600/400 = 1.425 倍，宽 285px 高 570px，所以舞台中间偏上的点都在里面
  await page.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), 'spine36-coexist.png') })
  const blue = await pixel('3.6', 0.2, 0.5)
  const red = await pixel('3.6', 0.5, 0.5)
  const gold = await pixel('3.8', 0.8, 0.5)
  check('3.6 二进制（天蓝）、3.6 JSON（红）、3.8 JSON（金）都画出来了', near(blue, [0, 191, 255]) && near(red, [220, 20, 60]) && near(gold, [218, 165, 32]), J([blue, red, gold]))
  // 3.6 的 Skeleton 没有 scaleX / scaleY：布局缩放靠乘到根骨骼上。区域 200×400 按 0.95×600/400 = 1.425 倍画，宽 285，红的在 x = 300 ± 142；不缩放（1 倍）的话只有 200..400
  const wide = await pixel('3.6', 0.5 - 0.22, 0.8)
  const tall = await pixel('3.6', 0.5, 0.1)
  check('3.6 的布局缩放生效（和 3.8 一样放大到 95% 舞台高度：红色立绘比 1 倍时更宽、更高）', near(wide, [220, 20, 60]) && tall[3] > 200, J([wide, tall]))
  const rows = await info()
  const rowA = rows.find((r) => r.slot === 'A')
  check('info()：3.6 二进制识别为 3.6.38 / 运行时 3.6，动画和皮肤读出来了', rowA.version === '3.6.38' && rowA.runtime === '3.6' && J(rowA.animations) === J(['idle', 'flip']) && rowA.skins.length === 1 && rowA.used === 'idle' && !rowA.error, J(rowA))
  const gl = await page.evaluate(() => window.__layer.glInfo().map((g) => g.runtime).sort())
  check('glInfo 里有 3.6 和 3.8 两个运行时', J(gl) === J(['3.6', '3.8']), J(gl))

  // 2. 动画采样：flip = 根骨骼固定转 180 度 → 立绘整个翻到原点下面，原来的位置变成透明；回到 idle 又出现
  await setSpecs({ A: spec('b36', 0.2, 'flip') })
  await sleep(600)
  const flipped = await pixel('3.6', 0.2, 0.5)
  const usedFlip = (await info()).find((r) => r.slot === 'A')?.used
  check('3.6 二进制的动画生效：切到 flip（转 180 度）后原位置变透明，used = flip', flipped[3] < 30 && usedFlip === 'flip', J([flipped, usedFlip]))
  await setSpecs({ A: spec('b36', 0.2, 'idle') })
  await sleep(600)
  const back = await pixel('3.6', 0.2, 0.5)
  check('切回 idle 又画出来', near(back, [0, 191, 255]), J(back))

  // 2b. Aku 结构：初始姿势没有任何可见附件，整个身体 / 脸由动画（Em06）的 slots 时间线打开——包围盒要按动画首帧算，不然布局拿到空包围盒、角色整个不画
  await setSpecs({ E: spec('aku36', 0.5, 'Em06') })
  await page.waitForFunction(() => window.__layer.loadedCount() >= 1 && window.__layer.info().some((r) => r.slot === 'E' && r.loaded), null, { timeout: 15000 })
  await sleep(600)
  const aku = (await info()).find((r) => r.slot === 'E')
  const akuCenter = await pixel('3.6', 0.5, 0.5)
  check('3.6.53 JSON（Aku 结构：1 骨骼 11 槽、Em00…Em09 只有 slots 时间线、atlas 开头有空行）：加载成功，识别 3.6.53，初始姿势 0 个可见附件、包围盒按动画首帧算（来源 animation）', aku.loaded && aku.version === '3.6.53' && aku.runtime === '3.6' && aku.animations.length === 10 && aku.slotCount === 11 && aku.attachmentsSetup === 0 && aku.boundsSource === 'animation' && aku.boundsEmpty === false && aku.used === 'Em06', J(aku))
  check('Aku 结构：Em06 画出非空像素（画面正中是饱和的橙色，不是透明）；诊断写「初始姿势没有可见附件，已按动画首帧计算包围盒」', near(akuCenter, [255, 140, 0]) && aku.problems.includes('初始姿势没有可见附件，已按动画首帧计算包围盒'), J([akuCenter, aku.problems]))
  await setSpecs({ E: spec('aku36', 0.5, 'Em06') })   // 同一动画再来一次：不重复建、不抛错

  // 3. 截断的 3.6 二进制：解析失败（带版本），不冒充缺资源
  await setSpecs({ X: spec('bad36', 0.5, 'idle') })
  await page.waitForFunction(() => window.__events.errors.length > 0, null, { timeout: 15000 })
  const ev = await page.evaluate(() => window.__events)
  check('截断的 3.6 二进制：onError kind = parse，写明 Spine 3.6.38 / 运行时 3.6；没有 onMissing', ev.errors[0]?.kind === 'parse' && /骨骼解析失败（Spine 3\.6\.38，运行时 3\.6）/.test(ev.errors[0].message) && ev.missing.length === 0, J(ev))

  // 4. 版本不支持的提示里包含 3.6；3.7 报版本不对
  await writeFile(path.join(fx, 'v37.skel.bytes'), spineBinary36({ version: '3.7.94' }))
  await writeFile(path.join(fx, 'v37.atlas.txt'), atlasText('png36'))
  await setSpecs({ Y: spec('v37', 0.5, 'idle') })
  await page.waitForFunction(() => window.__events.errors.some((e) => e.kind === 'version'), null, { timeout: 15000 })
  const ev2 = await page.evaluate(() => window.__events.errors.find((e) => e.kind === 'version'))
  check('3.7 仍报「版本不支持」，提示里写「支持 3.6 / 3.8 / 4.0 / 4.2」', /不支持（支持 3\.6 \/ 3\.8 \/ 4\.0 \/ 4\.2）/.test(ev2.message) && ev2.version === '3.7.94', J(ev2))
  check('日志里有「识别为 Spine 3.6.38 → 运行时 3.6」', logs.some((l) => /b36\.skel\.bytes.*识别为 Spine 3\.6\.38.*运行时 3\.6/.test(l)), J(logs))
  check('没有页面错误', errors.length === 0, J(errors))

  // 5. 3.6 运行时下载不到：只影响 3.6，提示缺 3.6
  const page2 = await context.newPage()
  await page2.route('**/vendor/spine-webgl-3.6.js', (route) => route.abort())
  await page2.route('**/fx/**', async (route) => {
    const file = path.join(fx, decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/fx\//, '')))
    await route.fulfill({ status: 200, body: await readFile(file), contentType: /\.png$/.test(file) ? 'image/png' : 'application/octet-stream' })
  })
  await page2.goto(`${base}/health`)
  const unavailable = await page2.evaluate(async () => {
    document.body.innerHTML = '<div id="stage" style="width:300px;height:300px"></div>'
    const { createSpineLayer } = await import('/gal-spine.js')
    const seen = []
    const layer = createSpineLayer({ parent: document.getElementById('stage'), url: (s) => `/fx/${s}`, onUnavailable: (v) => seen.push(v) })
    await layer.set({ A: { skel: 'b36.skel.bytes', atlas: 'b36.atlas.txt', kind: 'chara', x: 0.5, anim: 'idle' } }, { live: false })
    return seen
  })
  check('3.6 运行时取不到：onUnavailable("3.6")，不抛错', J(unavailable) === J(['3.6']), J(unavailable))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message.split('\n')[0]} @ ${(error.stack || '').split('\n').find((l) => l.includes('spine36-selftest')) || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
