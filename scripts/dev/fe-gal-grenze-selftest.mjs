#!/usr/bin/env node
// 浏览器自测：Grenze（GrenzeViewer 的 easy_dialog-N.xml，静态立绘）——
//   (1) 适配器本身（不需要浏览器）：sniff / 行解析（转义、旁白 / 说话人）/ next_id 链拆场景（起点、汇合、悬空、环）/ 背景 bgm se voice 的文件名索引 / non / bg_b / 立绘（body.webp 优先、body.png、没有 body、头像图标不当立绘）
//       / 未知指令 raw / 缺资源不致命 / 没有索引时的约定路径 / 5 万行的大文件解析时间 / gal-layout 探测（含多一层目录）
//   (2) 真实服务：导入（adapter + game.id + gal-layout）→ 列表（每个文件一个目录，里面是场景；>4MB 的大文件照样列）→ 播放页：台词 / 说话人 / 背景 / 立绘（canvas：居中、右、旁白沿用、没有 body 清掉、
//       比画面高的缩到画面高度、换背景清掉）/ 声音请求 / 大文件里的场景。素材全是合成的（不含原作内容）。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-grenze-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/grenze-shots）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'
import { galAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { parse, readRows, sniff, splitScenes, unescapeXml } from '../../web/library/gal/adapters/grenze-xml.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { buildGrenzeFixture } from './make-grenze-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/grenze-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const BIG_ROWS = 50000

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-gz-'))
const media = path.join(dataDir, 'gal', 'Grenze演示')
await buildGrenzeFixture(media, { bigRows: BIG_ROWS })

// ---------- (1) 适配器 ----------
{
  const file1 = await readFile(path.join(media, 'TextAsset', 'easy_dialog-1.xml'), 'utf8')
  const adapter = galAdapter('grenze-xml')
  const config = normalizeGalConfig({ resourceRoots: ['assets/resources/patchres'], adapterOptions: { 'grenze-xml': {} } })
  const ctx = await loadAdapterContext({ adapter, mediaDir: media, config })
  const cmds = (out) => out.steps.map((s) => s.commands)
  const flat = (out) => out.steps.flatMap((s) => s.commands)
  const play = (scene, c = ctx) => parse(file1, c, { stem: 'easy_dialog-1', scene })

  check('sniff：认得 <easy_dialog-N id=…> 行，不认别的 XML / 别的格式；注册表里按内容认出 grenze-xml', sniff(file1) && !sniff('<dialog-3 id="1"/>') && !sniff('<buff id="1"/>') && !sniff('{"bgms":[]}') && sniffGalAdapter(file1) === 'grenze-xml' && sniffGalAdapter('<dialog-3 id="1"/>') === '', '')
  check('XML 转义：&#xA; 换行、&amp; &lt; &quot; &#x…; &#…;；认不出的实体原样留着', unescapeXml('a&#xA;b &amp; &lt;c&gt; &quot;d&quot; &#x3042;&#12354; &bogus;') === 'a\nb & <c> "d" ああ &bogus;', unescapeXml('a&#xA;b &amp; &lt;c&gt; &quot;d&quot; &#x3042;&#12354; &bogus;'))
  const rows = readRows(file1)
  check('逐行解析：行数 / 属性（单引号、值里带 > 也行）', rows.length === 22 && rows[2].screen_effect === '4' && readRows(`<easy_dialog-1 id='1' text="a > b"/>`)[0].text === 'a > b' && readRows(`<easy_dialog-1 id='1' text="a > b"/>`)[0].id === '1', J(rows.length))
  const split = splitScenes(rows)
  check('next_id 链拆场景：起点 = 没人指向的行；行交错 + id 不连续也对；汇合点（130009）算 1 处；悬空的 next_id 在那里结束；没人指向的环也是一个场景',
    J(split.scenes.map((s) => s.start)) === J(['110001', '120001', '130001', '140001', '150001', '160001']) && split.stats.merges === 1 && split.stats.cycles === 1
      && split.scenes[0].rows.length === 10 && split.scenes[1].rows.length === 3 && split.scenes[2].rows.length === 4 && split.scenes[3].rows.length === 3 && split.scenes[4].rows.length === 2 && split.scenes[5].rows.length === 2, J(split.scenes.map((s) => [s.start, s.rows.length])) + J(split.stats))

  const s1 = play('110001')
  const all = flat(s1)
  const texts = s1.steps.map((s) => s.commands.find((c) => c.op === 'text').segments[0]?.text)
  check('场景 110001：只有这条链的 10 行；只放指令的行（screen_effect=8）并进下一句，一句台词一步（9 步）', s1.stats.rows === 10 && s1.steps.length === 9 && J(s1.steps.map((s) => s.index)) === J([0, 1, 2, 3, 4, 5, 6, 7, 8]), J([s1.stats, s1.steps.length]))
  check('旁白（name="-" / 没有 name）= 空说话人；说话人变了才发 speaker；转义还原、《俺》心声记号原样保留', J(cmds(s1)[0].find((c) => c.op === 'speaker')) === J({ op: 'speaker', segments: [] }) && texts[1] === '《俺》Thinking & more <ok>.\nSecond line.' && !cmds(s1)[1].some((c) => c.op === 'speaker') && J(cmds(s1)[2].find((c) => c.op === 'speaker')) === J({ op: 'speaker', segments: [{ text: 'Alice' }] }) && J(cmds(s1)[7].find((c) => c.op === 'speaker')) === J({ op: 'speaker', segments: [] }), J(texts))
  check('background：bg_b 没有图 = 黑底；名字查文件名索引（bg/battlebg/<名>/<名>.webp，带 # 的重复文件不收）；只有 png 的也行', J(cmds(s1)[0][0]) === J({ op: 'bg', color: [0, 0, 0], fade: 0 }) && J(cmds(s1)[1][0]) === J({ op: 'bg', src: 'bg/battlebg/bg_demo_1/bg_demo_1.webp', fade: 0 }) && all.some((c) => c.op === 'bg' && c.src === 'bg/battlebg/bg_demo_png/bg_demo_png.png'), J(all.filter((c) => c.op === 'bg')))
  check('bgm / sound / voice 按名字找（bgm/<名小写>/<名>.m4a、sound/<名>/<名>.m4a、voice/<包小写>/<语音名>.m4a）；bg_sound 和 sound 都是一次性 se', all.some((c) => c.op === 'bgm' && c.src === 'bgm/er2_bgm02/ER2_bgm02.m4a') && all.filter((c) => c.op === 'se' && c.src === 'sound/se_378/se_378.m4a').length === 2 && all.some((c) => c.op === 'voice' && c.src === 'voice/main11/MainVoice_00_01_001.m4a'), J(all.filter((c) => ['bgm', 'se', 'voice'].includes(c.op))))
  check('non：bgm=non → bgmStop（正在放才发）；sound1=non / bg_sound1=non 什么都不发；没放过的 bgm=non 不发', all.filter((c) => c.op === 'bgmStop').length === 1 && all.filter((c) => c.op === 'se').length === 2 && flat(parse(`<easy_dialog-1 id="1" text="x" bgm="non"/>`, ctx, { scene: '1' })).every((c) => c.op !== 'bgmStop'), '')
  const stands = all.filter((c) => c.op === 'stand')
  check('立绘：hero_group_id → merc/pic/<id>/body.webp（webp 优先于 png）、pic_pos 1/2/3 = left/center/right；整张图 + fit', J(stands.map((c) => [c.parts[0].src, c.parts[0].align])) === J([['merc/pic/101011/body.webp', 'center'], ['merc/pic/701004/body.png', 'right'], ['merc/pic/101063/body.webp', 'left']]) && stands.every((c) => c.parts.length === 1 && c.parts[0].fit === 1), J(stands))
  check('立绘：旁白行沿用上一个（不重发）；没有 body 的 hero 记 unresolved 并清掉立绘；换背景清掉立绘；头像图标 / 图集（N.webp、<id>.webp）不当立绘', cmds(s1)[4].every((c) => c.op !== 'stand' && c.op !== 'standOff') && cmds(s1)[5][0].op === 'standOff' && s1.stats.unresolved['stand:999'] === 1 && cmds(s1)[7][0].op === 'standOff' && !ctx.index.has('merc/pic/999/body.webp') && !ctx.index.has('merc/pic/999/body.png'), J(cmds(s1).slice(4, 8)))
  check('含义未知的 screen_effect / pic_action / effect(+effect_pos) 不猜：raw {cmd, args}，计入 stats.raw', J(all.filter((c) => c.op === 'raw')) === J([{ op: 'raw', cmd: 'screen_effect', args: ['4'] }, { op: 'raw', cmd: 'pic_action', args: ['5'] }, { op: 'raw', cmd: 'effect', args: ['17', '2'] }, { op: 'raw', cmd: 'screen_effect', args: ['8'] }]) && J(s1.stats.raw) === J({ screen_effect: 2, pic_action: 1, effect: 1 }), J(s1.stats.raw))
  check('缺资源不致命：缺的背景 / bgm / 音效 / 语音 / 立绘记进 stats.unresolved，台词照出', J(Object.keys(s1.stats.unresolved).sort()) === J(['bg:bg_missing', 'bgm:no_such_bgm', 'sound:no_such_se', 'sound:se_00', 'stand:999', 'voice:Main11/NoSuchVoice']) && texts.at(-1) === 'Missing files are not fatal.', J(s1.stats.unresolved))
  const merged = [play('130001'), play('140001')].map((out) => out.steps.map((s) => s.commands.find((c) => c.op === 'text').segments[0].text))
  check('汇合：两个场景各自走到底，共用后半段（Shared tail one / two）都在', J(merged[0]) === J(['Branch A start.', 'Branch A second.', 'Shared tail one.', 'Shared tail two.']) && J(merged[1]) === J(['Branch B start.', 'Shared tail one.', 'Shared tail two.']), J(merged))
  check('悬空 next_id / 环：在那里结束，不死循环', play('150001').steps.length === 2 && play('160001').steps.length === 2, '')
  let missing = ''
  try { play('424242') } catch (error) { missing = error.message }
  check('场景号不存在：报错说明', /424242/.test(missing), missing)
  check('没指定场景（直接打开整份文件）：播第一个场景', parse(file1, ctx, {}).stats.scene === '110001', '')
  const bare = flat(play('110001', null))
  check('没有文件索引（ctx 为空）：按约定路径拼（不过滤）', bare.some((c) => c.op === 'bg' && c.src === 'bg/battlebg/bg_missing/bg_missing.webp') && bare.some((c) => c.op === 'voice' && c.src === 'voice/main11/MainVoice_00_01_001.m4a') && bare.some((c) => c.op === 'bgm' && c.src === 'bgm/er2_bgm02/ER2_bgm02.m4a'), J(bare.filter((c) => c.op === 'bg')))
  check('文件索引不能被悄悄截断：适配器把目录遍历上限提到 200 万（引擎封顶值），ctx.truncated 为假', adapter.contextWalkLimit === 2000000 && ctx.truncated === false && ctx.hasIndex, String(adapter.contextWalkLimit))
  const names = ctx.catalogTree.children.map((c) => [c.title, c.children.length])
  check('列表（catalog）：每个 easy_dialog-N.xml 一个目录（按数字排序：1、2、10、99），里面是它的场景；dialog-3.xml / buff.xml 不出现', J(names) === J([['easy_dialog-1', 6], ['easy_dialog-2', 2], ['easy_dialog-10', 1], ['easy_dialog-99', BIG_ROWS / 100]]) && ctx.catalogTree.children[0].children[0].script === 'TextAsset/easy_dialog-1.xml::110001', J(names))

  // 大文件：5 万行
  const bigText = await readFile(path.join(media, 'TextAsset', 'easy_dialog-99.xml'), 'utf8')
  let t = Date.now()
  const bigRows = readRows(bigText)
  const tRead = Date.now() - t
  t = Date.now()
  const bigSplit = splitScenes(bigRows)
  const tSplit = Date.now() - t
  t = Date.now()
  const bigScene = parse(bigText, ctx, { scene: '5004900' })
  const tParse = Date.now() - t
  t = Date.now()
  await loadAdapterContext({ adapter, mediaDir: media, config: normalizeGalConfig({ resourceRoots: ['assets/resources/patchres'], adapterOptions: { 'grenze-xml': { textDir: 'TextAsset' } } }) })
  const tCtx = Date.now() - t
  console.log(`  大文件 ${(bigText.length / 1048576).toFixed(1)}MB / ${bigRows.length} 行：readRows ${tRead}ms，splitScenes ${tSplit}ms，打开一个场景 ${tParse}ms，重建上下文（场景列表已缓存）${tCtx}ms`)
  check(`大文件（${BIG_ROWS} 行 ${(bigText.length / 1048576).toFixed(1)}MB）：行解析 + 拆场景 + 打开一个场景都在几秒内，场景数 ${BIG_ROWS / 100}、每个 100 行`, bigRows.length === BIG_ROWS && bigSplit.scenes.length === BIG_ROWS / 100 && bigScene.stats.rows === 100 && tRead + tSplit + tParse < 5000, `${tRead} ${tSplit} ${tParse}`)

  // gal-layout：没写 game.id 也认出；多一层目录
  const nested = path.join(dataDir, 'nested')
  await buildGrenzeFixture(path.join(nested, 'Wrapper', 'GrenzeViewer'))
  const layout = await galLayoutScript({ item: { itemId: 'gz', title: 'gz', config: {}, source: { path: nested }, adapters: ['grenze-xml'] }, script: { id: 'gal-layout', version: '2.8.0', options: {} } })
  const cfg = layout.itemPatch?.gal?.config
  check('gal-layout：没写 game.id 也认出 grenze（脚本根 TextAsset、资源根 assets/resources/patchres、扩展名 xml、适配器参数 root；游戏根多一层目录也找得到）', cfg?.game?.id === 'grenze' && cfg.scriptRoots[0].dir === 'Wrapper/GrenzeViewer/TextAsset' && J(cfg.resourceRoots) === J(['Wrapper/GrenzeViewer/assets/resources/patchres']) && J(cfg.scriptExtensions) === J(['xml']) && cfg.adapterOptions['grenze-xml'].root === 'Wrapper/GrenzeViewer' && cfg.scriptCount === 3, J(cfg) + J(layout.logs))
  const layoutFlat = await galLayoutScript({ item: { itemId: 'gz2', title: 'gz2', config: {}, source: { path: media }, adapters: ['grenze-xml'] }, script: { id: 'gal-layout', version: '2.8.0', options: {} } })
  check('gal-layout：游戏根就是媒体目录时 root 为空、脚本根 TextAsset；没有 TextAsset 的目录不认领', layoutFlat.itemPatch?.gal?.config?.scriptRoots?.[0]?.dir === 'TextAsset' && layoutFlat.itemPatch.gal.config.game.id === 'grenze' && (await galLayoutScript({ item: { itemId: 'gz3', title: 'gz3', config: { game: { id: 'grenze' } }, source: { path: path.join(media, 'assets') }, adapters: [] }, script: { id: 'gal-layout', version: '2.8.0', options: {} } })).itemPatch === undefined, J(layoutFlat.itemPatch?.gal?.config?.scriptRoots))
}

// ---------- (2) 真实服务 + 浏览器 ----------
const port = 8147
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
  form.set('profileOptions', JSON.stringify({ adapters: ['grenze-xml'], config: { game: { id: 'grenze' } } })); form.set('metadataActionIds', 'gal-layout')
  const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
  const itemId = imported.items[0].itemId
  let full = null
  for (let i = 0; i < 60; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
  check('导入 + gal-layout：adapter grenze-xml、game.id grenze、脚本跑过、脚本数 4（对话 XML 的个数）', full.adapters?.[0] === 'grenze-xml' && full.config?.game?.id === 'grenze' && full.config?.script?.id === 'gal-layout' && full.scriptCount === 4 && (full.tags || []).includes('Gal游戏: grenze'), J([full.adapters, full.config?.game, full.scriptCount, full.tags]))
  const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
  const home = await reader('')
  check('首页：每个对话文件一个目录（1、2、10、99 的顺序），副标题写场景数', J(home.node.items.map((i) => i.title)) === J(['easy_dialog-1', 'easy_dialog-2', 'easy_dialog-10', 'easy_dialog-99']) && home.node.items[0].subtitle === '6 个场景' && home.node.items[3].subtitle === `${BIG_ROWS / 100} 个场景`, J(home.node.items.map((i) => [i.title, i.subtitle])))
  const list1 = await reader(home.node.items[0].node)
  check('文件目录：场景卡片（起点 id 当标题，副标题 = 句数 · 说话人 · 首句）', list1.node.items.length === 6 && list1.node.items[0].title === '110001' && /^9 句 · Alice、Bob、Carol · ――Opening\.$/.test(list1.node.items[0].subtitle), J(list1.node.items.slice(0, 2)))
  const target = list1.node.items[0].node
  const playHttp = await reader(target)
  check('播放页（接口）：场景 110001 的 9 步；面包屑 首页 > easy_dialog-1 > 110001；上一话 / 下一话在同一个文件目录里', playHttp.node.kind === 'player' && playHttp.scene.steps.length === 9 && playHttp.node.breadcrumb.map((b) => b.title).join('>') === '首页>easy_dialog-1>110001' && playHttp.sectionNavigation.prev === null && playHttp.sectionNavigation.next?.title === '120001', J([playHttp.node.breadcrumb, playHttp.sectionNavigation]))
  // 大文件（>4MB）里的场景
  const list99 = await reader(home.node.items[3].node)
  const bigPlay = await reader(list99.node.items[7].node)
  check('大文件（easy_dialog-99.xml 超过普通脚本的 4MB 上限）里的场景照样能打开：100 行、台词对得上', bigPlay.node?.kind === 'player' && bigPlay.scene?.steps?.length === 100 && bigPlay.scene.steps[0].commands.some((c) => c.op === 'text' && c.segments[0]?.text.startsWith('Line 700.')), J([bigPlay.node?.kind, bigPlay.scene?.steps?.length, bigPlay.error || bigPlay.message]))
  const bad = await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent('s:easy_dialog-1.xml::424242')}`)
  check('不存在的场景号：报错而不是崩', bad.status === 404, String(bad.status))

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await bctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const page = await bctx.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  const resources = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  page.on('response', (r) => { if (/\/resource\?path=/.test(r.url())) resources.push(decodeURIComponent(r.url().split('path=')[1])) })
  const link = (id) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(id)}`
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '')
  const standPixel = (x, y) => page.evaluate(([px, py]) => {
    const c = document.querySelector('.gal-stand')
    if (!c) return null
    return [...c.getContext('2d').getImageData(px, py, 1, 1).data]
  }, [x, y])
  const near = (rgba, [r, g, b], tol = 30) => Boolean(rgba) && rgba[3] > 200 && Math.abs(rgba[0] - r) <= tol && Math.abs(rgba[1] - g) <= tol && Math.abs(rgba[2] - b) <= tol
  const clear = (rgba) => Boolean(rgba) && rgba[3] < 10
  const waitPixel = async (x, y, want) => { for (let i = 0; i < 40; i++) { const p = await standPixel(x, y); if (near(p, want)) return { ok: true, p }; await sleep(150) } return { ok: false, p: await standPixel(x, y) } }
  const waitCount = (t) => page.waitForFunction((v) => document.querySelector('.gal-count')?.textContent === v, t)
  const parts = () => page.$eval('.gal-stand', (c) => c.dataset.parts).catch(() => '')
  const CRIMSON = [220, 20, 60]; const BLUE = [65, 105, 225]; const GOLD = [218, 165, 32]

  await page.goto(link(''))
  await page.waitForSelector('.gal-browse')
  check('浏览：首页的目录卡片', J(await page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))) === J(['easy_dialog-1', 'easy_dialog-2', 'easy_dialog-10', 'easy_dialog-99']), '')
  await page.screenshot({ path: path.join(shotDir, '1-home.png') })

  await page.goto(link(target))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 9')
  check('第 1 步：旁白（说话人清空）、台词；bg_b 没图 = 黑底', (await text('.gal-name')) === '' && (await text('.gal-text')) === '――Opening.', `${await text('.gal-name')} | ${await text('.gal-text')}`)
  await page.keyboard.press('Space'); await waitCount('2 / 9')
  check('第 2 步：转义还原（&amp; 换行）、《俺》保留；背景图加载', (await text('.gal-text')) === '《俺》Thinking & more <ok>.\nSecond line.' && /bg_demo_1/.test(await page.$$eval('.gal-bg', (es) => es.map((e) => e.style.backgroundImage + getComputedStyle(e).backgroundImage).join())), await text('.gal-text'))
  await page.screenshot({ path: path.join(shotDir, '2-step2.png') })
  await page.keyboard.press('Space'); await waitCount('3 / 9')
  const alice = await waitPixel(960, 1040, CRIMSON)
  check('第 3 步：说话人 Alice；整张立绘（body.webp）居中、底边对齐画面底边', (await text('.gal-name')) === 'Alice' && alice.ok, J(alice.p))
  await sleep(500)
  check('第 3 步的声音请求：se / voice 的路径（sound/se_378、voice/main11）被请求', resources.some((p) => /sound\/se_378\/se_378\.m4a/.test(p)) && resources.some((p) => /voice\/main11\/MainVoice_00_01_001\.m4a/.test(p)), J(resources.filter((p) => /\.m4a/.test(p))))
  await page.screenshot({ path: path.join(shotDir, '3-alice.png') })
  await page.keyboard.press('Space'); await waitCount('4 / 9')
  const bob = await waitPixel(1900, 1040, BLUE)
  check('第 4 步：换人（pic_pos=3）→ 立绘贴右边（body.png）', bob.ok && (await text('.gal-name')) === 'Bob', J(bob.p))
  await page.keyboard.press('Space'); await waitCount('5 / 9')
  check('第 5 步：旁白行沿用上一个立绘（还在右边）', (await text('.gal-name')) === '' && near(await standPixel(1900, 1040), BLUE), J(await standPixel(1900, 1040)))
  await page.keyboard.press('Space'); await waitCount('6 / 9')
  await sleep(400)
  check('第 6 步：hero 没有 body 图 → 立绘清掉（不会留着上一个人）', (await parts()) === '0', await parts())
  await page.keyboard.press('Space'); await waitCount('7 / 9')
  const dave = await waitPixel(50, 1060, GOLD)
  const top = await standPixel(50, 20)
  const wide = await standPixel(250, 540)
  check('第 7 步：比画面高的立绘（300×1500）缩到画面高度（顶到底都有、宽度缩成约 216 所以 x=250 是空的），靠左', dave.ok && near(top, GOLD) && clear(wide), J([dave.p, top, wide]))
  await page.screenshot({ path: path.join(shotDir, '4-tall.png') })
  await page.keyboard.press('Space'); await waitCount('8 / 9')
  await sleep(400)
  check('第 8 步：换背景（png 的）→ 立绘清掉', (await parts()) === '0' && /bg_demo_png/.test(await page.$$eval('.gal-bg', (es) => es.map((e) => e.style.backgroundImage + getComputedStyle(e).backgroundImage).join())), await parts())
  await page.keyboard.press('Space'); await waitCount('9 / 9')
  check('第 9 步：缺的背景 / 音乐 / 语音不崩，台词照出', (await text('.gal-text')) === 'Missing files are not fatal.', await text('.gal-text'))
  await page.screenshot({ path: path.join(shotDir, '5-last.png') })

  // 大文件的场景（5 万行里的第 8 个场景）
  await page.goto(link(list99.node.items[7].node))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 100')
  check('大文件里的场景：播放页第 1 句', /^Line 700\./.test(await text('.gal-text')), await text('.gal-text'))
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
