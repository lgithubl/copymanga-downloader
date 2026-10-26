#!/usr/bin/env node
// 浏览器自测：Otogi Frontier R（离线网页版的剧情 JSON，没有扩展名，otogi-json）的真实服务 + WebGL：导入（gal-layout 认出 otogi、scriptExtensions [''] 存得进去读得回来）→ 列表（主线 / 角色 / 全部）→
//   打开普通剧情（读 canvas 像素：左 / 右立绘、表情叠层顺序、换位、收掉；声音请求；缺语音不请求 404）→ 打开成人剧情（Spine 3.6 JSON 静态画面、动画名随 CharaAnimation 变、声音请求）。素材全是合成的。
//   适配器 / 引擎 / gal-layout 的纯 node 部分在 gal-otogi-selftest.mjs。需要先 sh scripts/fetch-spine-runtime.sh。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-otogi-selftest.mjs     端口 8195；截图在 SHOT_DIR（默认 /tmp/gal-otogi-shots）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOtogiFixture } from './make-otogi-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!existsSync(path.join(root, 'web/static/vendor/spine-webgl-3.6.js'))) { console.error('缺 web/static/vendor/spine-webgl-3.6.js：先 sh scripts/fetch-spine-runtime.sh'); process.exit(2) }
const shotDir = process.env.SHOT_DIR || '/tmp/gal-otogi-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const flat = (out) => out.steps.flatMap((s) => s.commands)

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-otogi-'))
const media = path.join(dataDir, 'gal', 'Otogi演示')
await buildOtogiFixture(media)

// ---------- (2) 真实服务 + 浏览器 ----------
const port = 8195
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
  form.set('profileOptions', JSON.stringify({ adapters: ['otogi-json'], config: { game: { id: 'otogi' } } })); form.set('metadataActionIds', 'gal-layout')
  const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
  const itemId = imported.items[0].itemId
  let full = null
  for (let i = 0; i < 60; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
  check('导入 + gal-layout（真实服务）：adapter otogi-json、game.id otogi、scriptExtensions [""]（存下来、读回来都还是空串）、脚本数 7', full.adapters?.[0] === 'otogi-json' && full.config?.game?.id === 'otogi' && J(full.config?.scriptExtensions) === J(['']) && full.scriptCount === 7 && (full.tags || []).includes('Gal游戏: otogi'), J([full.adapters, full.config?.game, full.config?.scriptExtensions, full.scriptCount, full.tags]))
  const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
  const home = await reader('')
  check('首页：主线 / 角色 / 全部普通剧情 / 全部成人剧情（副标题带数量）', J(home.node.items.map((i) => i.title)) === J(['主线', '角色', '全部普通剧情', '全部成人剧情']) && home.node.items[0].subtitle === '2 章' && home.node.items[2].subtitle === '5 项', J(home.node.items.map((i) => [i.title, i.subtitle])))
  const mainList = await reader(home.node.items[0].node)
  const chapter = await reader(mainList.node.items[0].node)
  check('主线 → 章（章名取 list.json）→ 场景卡片（标题 = Episode/Main 的 Title，副标题 = RequireCondition）', J(mainList.node.items.map((i) => i.title)) === J(['1.Small Island', '25001']) && J(chapter.node.items.map((i) => [i.title, i.subtitle])) === J([['1 Arrival', '1-1 clear'], ['2 Second', '1-2 clear']]), J(chapter.node.items))
  const charList = await reader(home.node.items[1].node)
  const alice = await reader(charList.node.items[0].node)
  check('角色 → 角色卡片（带图标）→ 他的剧情（普通 + 成人，成人带 R18 角标）', charList.node.items[0].title === 'Alice' && /icon\/chara\/icon\/png\/10011\.png/.test(charList.node.items[0].thumb || '') && J(alice.node.items.map((i) => [i.title, i.badge])) === J([['Alice story one', ''], ['Alice story one', 'R18']]), J([charList.node.items[0], alice.node.items]))
  const sceneNode = chapter.node.items[0].node
  const playHttp = await reader(sceneNode)
  check('播放页（接口）：scene 3 的 8 步；面包屑 首页 > 主线 > 章 > 场景；下一话 = 2 Second', playHttp.node.kind === 'player' && playHttp.scene.steps.length === 8 && playHttp.node.breadcrumb.map((b) => b.title).join('>') === '首页>主线>1.Small Island>1 Arrival' && playHttp.sectionNavigation.next?.title === '2 Second', J([playHttp.node.breadcrumb, playHttp.sectionNavigation]))
  const adultNode = alice.node.items[1].node
  const adultHttp = await reader(adultNode)
  check('成人剧情（接口）：6 步，带 spine still 指令；渲染诊断没有因为缺语音报「缺少资源」', adultHttp.scene.steps.length === 6 && flat(adultHttp.scene).some((c) => c.op === 'spine' && c.kind === 'still') && !(adultHttp.node.issues || []).some((i) => /缺少资源/.test(i)), J(adultHttp.node.issues))

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await bctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const page = await bctx.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  const resources = []
  const resourceStatus = {}
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  page.on('response', (r) => { if (/\/resource\?path=/.test(r.url())) { const p = decodeURIComponent(r.url().split('path=')[1]); resources.push(p); resourceStatus[p] = r.status() } })
  const link = (id) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(id)}`
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '')
  const standPixel = (x, y) => page.evaluate(([px, py]) => { const c = document.querySelector('.gal-stand'); return c ? [...c.getContext('2d').getImageData(px, py, 1, 1).data] : null }, [x, y])
  const near = (rgba, [r, g, b], tol = 30) => Boolean(rgba) && rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol
  const clear = (rgba) => Boolean(rgba) && rgba[3] < 10
  const waitPixel = async (x, y, want) => { for (let i = 0; i < 40; i++) { const p = await standPixel(x, y); if (near(p, want)) return { ok: true, p }; await sleep(150) } return { ok: false, p: await standPixel(x, y) } }
  const waitCount = (t) => page.waitForFunction((v) => document.querySelector('.gal-count')?.textContent === v, t)
  const parts = () => page.$eval('.gal-stand', (c) => c.dataset.parts).catch(() => '')
  const spines = () => page.$eval('.gal-world', (e) => JSON.parse(e.dataset.spines || '{}')).catch(() => ({}))
  const next = async (n) => { await page.keyboard.press('Space'); await waitCount(n) }
  const CRIMSON = [220, 20, 60]; const BLUE = [0, 0, 255]; const YELLOW = [255, 255, 0]; const ROYAL = [65, 105, 225]

  await page.goto(link(''))
  await page.waitForSelector('.gal-browse')
  check('浏览：首页的目录卡片', J(await page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))) === J(['主线', '角色', '全部普通剧情', '全部成人剧情']), '')
  await page.screenshot({ path: path.join(shotDir, '1-home.png') })

  await page.goto(link(sceneNode))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 8')
  check('第 1 步：旁白（说话人空）；%user_name → 人間；背景（adventure/ 子目录）和 BGM 被请求', (await text('.gal-name')) === '' && (await text('.gal-text')) === '人間 arrives at the little island.' && resources.some((p) => /typeadv\/bg\/adventure\/bg_adventure_0001\.png/.test(p)) && resources.some((p) => /bgm\/bgm_adv_03\.m4a/.test(p)), J(resources))
  await next('2 / 8')
  const left = await waitPixel(5, 1000, CRIMSON)
  check('第 2 步：Alice 在左边（body 底边对齐画面底边）；表情叠层：idle（蓝）盖在 idle_c（黄）上面，两者都有的地方是蓝、只有 idle_c 的地方是黄；右边没有人', (await text('.gal-name')) === 'Alice' && left.ok && near(await standPixel(20, 900), BLUE) && near(await standPixel(50, 930), YELLOW) && clear(await standPixel(1000, 1000)) && clear(await standPixel(1830, 1000)), J([left.p, await standPixel(20, 900), await standPixel(50, 930)]))
  await sleep(400)
  check('第 2 步的声音请求：SE（se_adv_09）和语音（m1_001）在 voice_adventure_3 下', resources.some((p) => /voice_adventure_3\/se_adv_09\.m4a/.test(p)) && resources.some((p) => /voice_adventure_3\/m1_001\.m4a/.test(p)), J(resources.filter((p) => /\.m4a/.test(p))))
  await page.screenshot({ path: path.join(shotDir, '2-alice-left.png') })
  await next('3 / 8')
  const right = await waitPixel(1830, 1000, ROYAL)
  check('第 3 步：Bob（Position 3）在右边（angry 表情叠层：蓝在黄上），Alice 还在左边；缺的语音（m1_missing）没有被请求', (await text('.gal-name')) === 'Bob' && right.ok && near(await standPixel(1840, 900), BLUE) && near(await standPixel(1870, 930), YELLOW) && near(await standPixel(5, 1000), CRIMSON) && !resources.some((p) => /m1_missing/.test(p)), J([right.p, await standPixel(5, 1000)]))
  await next('4 / 8')
  const moved = await waitPixel(5, 1000, ROYAL)
  check('第 4 步：同一个角色（Bob）出现在 Position 2 → 右边收掉，只剩左边的 Bob', moved.ok && clear(await standPixel(1830, 1000)) && (await parts()) === '3', J([moved.p, await standPixel(1830, 1000), await parts()]))
  await next('5 / 8')
  check('第 5 步：旁白行不动立绘（左边还是 Bob）', (await text('.gal-name')) === '' && near(await standPixel(5, 1000), ROYAL), J(await standPixel(5, 1000)))
  await next('6 / 8')
  const back = await waitPixel(5, 1000, CRIMSON)
  check('第 6 步：Alice（violent 表情文件不存在）只有 body，没有表情叠层；空 Phrase 行的背景（平铺的 bg_adventure_0002）和特效并进来', back.ok && near(await standPixel(20, 900), CRIMSON) && resources.some((p) => /typeadv\/bg\/bg_adventure_0002\.png/.test(p)), J([back.p, await standPixel(20, 900)]))
  await next('7 / 8')
  await sleep(400)
  check('第 7 步：IsBackgroundOnly → 立绘全收；<br> = 换行、%user_name 换成人間', (await parts()) === '0' && (await text('.gal-text')) === 'The end\nsecond line for 人間.', `${await parts()} | ${await text('.gal-text')}`)
  await next('8 / 8')
  check('第 8 步：未知特效 Weird 不崩（记 raw：提示里是「1 条指令暂未渲染」），台词照出；缺的语音 / 表情文件不算「缺少资源」（没有 404 请求）', (await text('.gal-text')) === 'Weird effect.' && (await text('.gal-note')) === '立绘/特效等 1 条指令暂未渲染' && !Object.values(resourceStatus).some((code) => code >= 400), `${await text('.gal-text')} | ${await text('.gal-note')} | ${J(Object.entries(resourceStatus).filter(([, c]) => c >= 400))}`)
  await page.screenshot({ path: path.join(shotDir, '3-last.png') })

  // 成人剧情：Spine 3.6 JSON 静态画面
  await page.goto(link(adultNode))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 6')
  await page.waitForFunction(() => /still1/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 15000 })
  check('成人第 1 步：说话人 Alice、%user_name 换成人間；Spine still（slot still1，animation1）；骨架 json / atlas 请求 200；语音（othersounds/still/<Id>/h_v1）和 bgm_10 被请求', (await text('.gal-name')) === 'Alice' && (await text('.gal-text')) === '人間, hello.' && J(await spines()) === J({ still1: 'animation1' }) && resourceStatus['chara/still/1200051/1200051.json'] === 200 && resourceStatus['chara/still/1200051/1200051.atlas.txt'] === 200 && resources.some((p) => /othersounds\/still\/1200051\/h_v1\.m4a/.test(p)) && resources.some((p) => /bgm\/bgm_10\.m4a/.test(p)), J([await spines(), resources.filter((p) => /still|bgm_10/.test(p))]))
  await page.screenshot({ path: path.join(shotDir, '4-adult-1.png') })
  await next('2 / 6')
  await page.waitForFunction(() => /animation2/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 5000 })
  check('成人第 2 步：CharaAnimation 2 → animation2；旁白（说话人空）；缺的语音（h_missing）没有被请求', J(await spines()) === J({ still1: 'animation2' }) && (await text('.gal-name')) === '' && !resources.some((p) => /h_missing/.test(p)), J(await spines()))
  await next('3 / 6')
  await page.waitForFunction(() => /animation3/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 5000 })
  check('成人第 3 步：CharaAnimation 3 → animation3', J(await spines()) === J({ still1: 'animation3' }) && (await text('.gal-text')) === 'Climax.', J(await spines()))
  await next('4 / 6')
  await page.waitForFunction(() => /animation4/.test(document.querySelector('.gal-world')?.dataset.spines || ''), null, { timeout: 5000 })
  check('成人第 4 步：CharaAnimation 4 → animation4', J(await spines()) === J({ still1: 'animation4' }), J(await spines()))
  await next('5 / 6')
  check('成人第 5 步：Serif 为 null 的行不改文字（还是 Afterglow.）；SE 是 raw，不崩', (await text('.gal-text')) === 'Afterglow.', await text('.gal-text'))
  await next('6 / 6')
  check('成人第 6 步：Serif 为空串 = 清空文字；SE 是 raw（提示「1 条指令暂未渲染」），声音 / 骨架都没有缺资源', (await text('.gal-text')) === '' && (await text('.gal-note')) === '立绘/特效等 1 条指令暂未渲染' && !Object.values(resourceStatus).some((code) => code >= 400), `${await text('.gal-note')} | ${J(Object.entries(resourceStatus).filter(([, c]) => c >= 400))}`)
  await page.screenshot({ path: path.join(shotDir, '5-adult-last.png') })
  check('没有页面错误', errors.length === 0, J(errors))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message} @ ${(error.stack || '').split('\n')[1] || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(dataDir, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed（截图：${shotDir}）`)
process.exit(fail ? 1 : 0)

