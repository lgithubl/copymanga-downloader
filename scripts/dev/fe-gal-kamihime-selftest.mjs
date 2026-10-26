#!/usr/bin/env node
// 自测：Kamihime Player（TyranoScript .ks）——适配器（带 hash / 不带 hash / 缺文件的资源查找、#说话人 + jname、[r] / [l]、anim 滑入、quake、layopt / freeimage、
// sepia 滤镜、没见过的标签）、上下文索引（contextDirs / contextTextFilter）、gal-layout 探测、列表（json 标题）；
// 然后起 web 服务导入（adapter + game.id + gal-layout）、读列表和脚本，有 @playwright/test 时再在浏览器里看立绘和台词。
//   node scripts/dev/fe-gal-kamihime-selftest.mjs                                          适配器 / 上下文 / gal-layout（不需要浏览器、不需要起服务）
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-kamihime-selftest.mjs      再加上服务 + 浏览器（web/node_modules 没装或没有 playwright 就跳过这一段）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { galAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { catalog, parse, prepare, sniff } from '../../web/library/gal/adapters/tyrano-ks.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'
import { RD1, RD2, buildKamihimeFixture, hashed } from './make-kamihime-fixture.mjs'
import { readFile } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/kamihime-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
let skipped = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-kh-'))
const media = path.join(dataDir, 'gal', 'kamihime演示')
await buildKamihimeFixture(media)
const SCRIPT1 = 'game/dmm/raw_scenario/eidolon/MB01_花/9101_harem-summon_script.ks'
const SCRIPT2 = 'game/dmm/raw_scenario/eidolon/MB01_花/9102_harem-summon_script.ks'
const text1 = await readFile(path.join(media, SCRIPT1), 'utf8')
const text2 = await readFile(path.join(media, SCRIPT2), 'utf8')

// ================= 适配器 / 上下文（不需要浏览器）=================
{
  const adapter = galAdapter('tyrano-ks')
  const config = normalizeGalConfig({ resourceRoots: ['game/dmm/assets'], adapterOptions: { 'tyrano-ks': { root: 'game/dmm' } } })
  const ctx = await loadAdapterContext({ adapter, mediaDir: media, config })
  check('sniff：认 *start + Tyrano 标签；不认别的格式；注册表里认走它的是 tyrano-ks', sniff(text1) && !sniff('bg,download/bg/a.jpg,0.5\nmsg,0,你好') && !sniff('{"a":1}') && sniffGalAdapter(text1) === 'tyrano-ks' && sniffGalAdapter('<NAME_PLATE>a\n<PAUSE>') !== 'tyrano-ks', sniffGalAdapter(text1))
  check('上下文：assets 平铺 + resource_directory 子目录都进了索引（资源路径相对 game/dmm/assets）；两个剧情的 json 都读到了（第三个剧情没有 json）', ctx.flat.size === 8 && ctx.rdFiles.size === 2 && ctx.meta.size === 2 && ctx.scripts.length === 3, J([ctx.flat.size, ctx.rdFiles.size, ctx.meta.size, ctx.scripts.length]))

  const out = parse(text1, ctx, { rel: 'eidolon/MB01_花/9101_harem-summon_script.ks', stem: '9101_harem-summon_script' })
  const cmds = out.steps.flatMap((s) => s.commands)
  const ops = (op) => cmds.filter((c) => c.op === op)
  check('带 hash 的资源：bg / bgm 名字照抄，在 assets 平铺层找到', ops('bg').some((c) => c.src === hashed('story-bg_beach_00', 'jpg')) && ops('bgm').some((c) => c.src === hashed('bgm_talk_001', 'mp3')), J(ops('bg')))
  check('black-<hash>.png 当黑色纯色背景（不查文件）；time=1000 → 渐变 1 秒', ops('bg')[0]?.color?.join() === '0,0,0' && ops('bg')[0].fade === 1, J(ops('bg')[0]))
  const stand0 = ops('stand')[0]
  check('不带 hash 的表情图（hana_01.png）按 stem 找到平铺层的 hana_01-<sha1>.png；一整张图 = 一个 stand 部件', stand0?.parts.length === 1 && stand0.parts[0].src === hashed('hana_01', 'png') && stand0.parts[0].align === 'center', J(stand0))
  check('两个角色同时在场：按出场顺序左 / 右', J(ops('stand')[1]?.parts.map((p) => p.align)) === J(['left', 'right']), J(ops('stand')[1]))
  check('缺的表情（不带 hash、带 hash 的各一个）退回基础立绘 hana_00；不进 stats.unresolved，只记 fallbacks / missing', ops('stand')[2]?.parts[0].src === hashed('hana_00', 'png') && Object.keys(out.stats.fallbacks).length === 2 && Object.keys(out.stats.missing).filter((k) => k.startsWith('face:')).length === 2 && !Object.keys(out.stats.unresolved).some((k) => k.startsWith('face') || k.startsWith('chara')), J([out.stats.fallbacks, out.stats.missing, out.stats.unresolved]))
  check('缺的语音（voice_a_99.mp3）静默跳过：没有对应指令，只记 stats.missing', !cmds.some((c) => /voice_a_99/.test(c.src || '')) && out.stats.missing['se:voice_a_99.mp3'] === 1)
  check('缺的背景记 stats.unresolved（渲染诊断里能看到），不炸', J(Object.keys(out.stats.unresolved)) === J([`bg:${hashed('missing_bg', 'jpg')}`]), J(out.stats.unresolved))
  check('语音：不带 hash 的 mp3 按这个剧情 json 的 resource_directory 找 → voice；平铺层不带 hash 的循环音效 → bgse，[stopse] → bgseStop', ops('voice')[0]?.src === `${RD1}/voice_a_01.mp3` && ops('bgse')[0]?.src === 'bgm_se_heartbeat.mp3' && ops('bgse')[0].loop === true && ops('bgseStop').length === 1, J([ops('voice'), ops('bgse'), ops('bgseStop')]))
  const out2 = parse(text2, ctx, { rel: 'eidolon/MB01_花/9102_harem-summon_script.ks', stem: '9102_harem-summon_script' })
  check('两个剧情里同名的语音各取自己的 resource_directory（第二个取 RD2，不是第一个目录里的）', out2.steps.flatMap((s) => s.commands).find((c) => c.op === 'voice')?.src === `${RD2}/voice_a_01.mp3`)
  const sp = ops('speaker').map((c) => c.segments.map((x) => x.text).join(''))
  check('#<角色 key> → chara_new 的 jname 当说话人（花 / 凛）；单独的 # = 旁白（空说话人）', J(sp) === J(['花', '凛', '']), J(sp))
  const texts = ops('text').map((c) => c.segments.map((x) => x.text).join(''))
  check('[r] 换行；[l] 结束一步；[l][r] 之后接着的文字累加在同一个文本框里；[cm] 清空；[cm] 之前已经点过的不再多出一步', texts[0] === '第一句台词。\n换行的第二行。' && texts[1] === '第一句台词。\n换行的第二行。\n后面接着的一行。' && texts[2] === '两个角色同时在场。' && out.steps.length === 8 && out.steps.every((s) => s.commands.some((c) => c.op === 'text')), J(texts) + out.steps.length)
  const rawOf = (cmd) => cmds.filter((c) => c.op === 'raw' && c.cmd === cmd)
  check('[anim layer=3 left="+=640"] 滑入 / 滑出 → raw（带原参数）；layer 3 的 layopt / freeimage 也是 raw', rawOf('anim').length === 2 && rawOf('anim')[0].args[0].includes('+=640') && rawOf('layopt').length === 1 && rawOf('freeimage').length === 1 && out.stats.raw.anim === 2, J(out.stats.raw))
  const shakes = ops('shake')
  check('[quake hmax=5 time=300] → shake（横向，0.3 秒）；连着的 [anim name= left=] 合成一个 shake（横向，0.2 秒，幅度 20 像素）', shakes.length === 2 && shakes[0].axis === 'horizontal' && Math.abs(shakes[0].seconds - 0.2) < 1e-9 && Math.abs(shakes[0].strength - 0.5) < 1e-9 && Math.abs(shakes[1].seconds - 0.3) < 1e-9, J(shakes))
  const withOver = ops('bg').find((c) => c.over)
  const afterFree = ops('bg').filter((c) => c.src && !c.over).at(-1)
  check('[image sepia_filter layer=4] → 当前背景带 over（滤镜图）、渐变 0.3 秒；[freeimage layer=4] 去掉它，背景重发不带 over', withOver?.src === hashed('story-bg_beach_00', 'jpg') && withOver.over === hashed('sepia_filter', 'png') && withOver.fade === 0.3 && afterFree && ops('bg').indexOf(afterFree) > ops('bg').indexOf(withOver), J(ops('bg')))
  check('[wait time=800] → wait 0.8 秒', ops('wait')[0]?.seconds === 0.8)
  check('没见过的标签 → raw（引号里有 ] 也不乱）；[iscript] 块里的内容不当剧情；没有 ] 的标签 / [stopbgm[[playbgm 都不炸，后者的 playbgm 还认', rawOf('foo_bar')[0]?.args[0] === 'x=1 y="a]b"' && rawOf('iscript').length === 1 && !texts.some((t) => /f\.foo/.test(t)) && ops('bgm').length === 2 && ops('bgmStop').length === 2, J(out.stats.raw))
  // 容错：空文本 / 乱七八糟的输入 / 没有 ctx 都不抛
  let threw = ''
  for (const input of ['', '*start\n', '[', '[]', '[[x', '[bg', '[chara_mod name=nobody face=x]\n[chara_show name=nobody]\n#nobody\n[l]', '@bg storage="a.jpg"\n文字[l]', '[playse storage=]', '[quake]', '[anim]', '[wait time=abc]', '[layopt layer=4]', '[image storage="sepia_x.png" layer=4]', '#', '[iscript]\nnever closed']) {
    try { parse(input, null, {}); parse(input, ctx, {}) } catch (error) { threw = `${J(input)}: ${error.message}` }
  }
  check('容错：空文本 / 残缺标签 / 没声明的角色 / 没有 ctx / 没关的 iscript，都不抛异常', !threw, threw)
  const noIndex = parse(text1, null, { rel: 'x', stem: 'x' })
  check('没有文件索引时不过滤：资源名照抄（带 hash 的整名；不带 hash 的语音没有 json 就是裸文件名）', noIndex.steps.flatMap((s) => s.commands).some((c) => /^(?:voice|se)$/.test(c.op) && c.src === 'voice_a_01.mp3'))
  const cat = catalog(ctx)
  const flat = []
  const walkCat = (node) => { for (const c of node.children || []) { flat.push(c); walkCat(c) } }
  walkCat(cat)
  const titles = flat.filter((c) => c.script).map((c) => c.title)
  check('列表（catalog）：类别 → 目录 → 剧情；标题取同目录 json 的 title（没有 json 的用脚本名）；is_r18 带 R18 角标', J(titles) === J(['花的初次相遇', '花的第二次', '0001_x']) && flat.find((c) => c.title === '花的第二次')?.badge === 'R18' && J(cat.children.map((c) => c.title)) === J(['eidolon', 'soul']), J(titles))

  // gal-layout：没写 game.id 也认出 kamihime；写了 game.id 走同一份探测
  for (const declared of [false, true]) {
    const layout = await galLayoutScript({ item: { itemId: 'kh', title: 'kh', config: declared ? { game: { id: 'kamihime' } } : {}, source: { path: media }, adapters: ['tyrano-ks'] }, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
    const cfg = layout.itemPatch?.gal?.config
    check(`gal-layout（${declared ? '声明 game.id' : '没写 game.id'}）：认出 kamihime（脚本根 dmm/raw_scenario、资源根 dmm/assets、扩展名 ks、适配器参数 root、脚本数 3）`, cfg?.game?.id === 'kamihime' && cfg.scriptRoots?.[0]?.dir === 'game/dmm/raw_scenario' && J(cfg.resourceRoots) === J(['game/dmm/assets']) && J(cfg.scriptExtensions) === J(['ks']) && cfg.adapterOptions?.['tyrano-ks']?.root === 'game/dmm' && cfg.scriptCount === 3 && layout.itemTags.includes('Gal游戏: kamihime'), J(cfg) + J(layout.logs))
  }
  const emptyDir = path.join(dataDir, 'empty-media')
  await mkdir(path.join(emptyDir, 'game', 'raw_scenario'), { recursive: true })   // 有 raw_scenario 但不在 dmm 下
  const other = await galLayoutScript({ item: { itemId: 'x', title: 'x', config: {}, source: { path: emptyDir }, adapters: [] }, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
  check('gal-layout 不会把没有 dmm/raw_scenario 的目录认成 kamihime', other.itemPatch?.gal?.config?.game?.id !== 'kamihime', J(other.itemPatch?.gal?.config?.game))
}

// ================= 服务 + 浏览器 =================
const require = createRequire(import.meta.url)
let chromium = null
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { /* 没有 playwright：只做 HTTP 部分 */ }
const port = 8141
const base = `http://127.0.0.1:${port}`
let server = null
try {
  try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch { /* 空闲 */ }
  server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
  let up = false
  for (let i = 0; i < 100 && !up; i++) { try { await fetch(`${base}/health`); up = true } catch { await sleep(200) } }
  if (!up) { skipped++; console.log('SKIP 起不来 web 服务（web/node_modules 没装？）：跳过导入 / 浏览器部分') } else {
    const form = new FormData()
    form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
    form.set('profileOptions', JSON.stringify({ adapters: ['tyrano-ks'], config: { game: { id: 'kamihime' } } })); form.set('metadataActionIds', 'gal-layout')
    const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
    const itemId = imported.items[0].itemId
    let full = null
    for (let i = 0; i < 60; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
    check('导入 + gal-layout：adapter tyrano-ks、game.id kamihime、脚本跑过、脚本数 3', full.adapters?.[0] === 'tyrano-ks' && full.config?.game?.id === 'kamihime' && full.config?.script?.id === 'gal-layout' && full.scriptCount === 3 && (full.tags || []).includes('Gal游戏: kamihime'), J([full.adapters, full.config?.game, full.scriptCount, full.tags]))
    const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
    const home = await reader('')
    check('首页（catalog）：类别 eidolon / soul', J(home.node.items.map((i) => i.title)) === J(['eidolon', 'soul']), J(home.node.items.map((i) => i.title)))
    const kind = await reader(home.node.items[0].node)
    const dir = await reader(kind.node.items[0].node)
    check('目录里的剧情卡片：标题取自 json（花的初次相遇 / 花的第二次），R18 角标', J(dir.node.items.map((i) => i.title)) === J(['花的初次相遇', '花的第二次']) && dir.node.items[1].badge === 'R18', J(dir.node.items))
    const target = dir.node.items[0].node
    const played = await reader(target)
    const scene = played.scene
    check('读脚本（真实 handler + 资源根）：scene 来自 tyrano-ks，8 步；语音带 resource_directory', scene?.adapter === 'tyrano-ks' && scene.steps.length === 8 && scene.steps.flatMap((s) => s.commands).some((c) => c.op === 'voice' && c.src === `${RD1}/voice_a_01.mp3`), J(scene?.stats))
    const res = async (src) => (await fetch(`${base}${played.resourceBase}?path=${encodeURIComponent(src)}`)).status
    check('资源接口：平铺的图、resource_directory 里的语音都取得到；缺的返回非 200', await res(hashed('hana_00', 'png')) === 200 && await res(`${RD1}/voice_a_01.mp3`) === 200 && await res(hashed('hana_02', 'png')) !== 200, `${await res(hashed('hana_00', 'png'))} ${await res(`${RD1}/voice_a_01.mp3`)}`)

    if (!chromium) { skipped++; console.log('SKIP 没有 @playwright/test（设置 PLAYWRIGHT_PATH）：跳过浏览器部分') } else {
      let browser
      try {
        browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
        const page = await ctx.newPage()
        page.setDefaultTimeout(12000)
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        page.on('dialog', (d) => d.dismiss().catch(() => {}))
        const link = (id) => `${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(id)}`
        const txt = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '')
        const pixel = (x, y) => page.evaluate(([px, py]) => { const c = document.querySelector('canvas.gal-stand'); if (!c) return null; const d = c.getContext('2d').getImageData(px, py, 1, 1).data; return [d[0], d[1], d[2], d[3]] }, [x, y])
        const parts = () => page.$eval('canvas.gal-stand', (c) => c.dataset.parts).catch(() => '')
        const near = (px, want) => px && want.every((v, i) => Math.abs(px[i] - v) <= 12)
        await page.goto(link(''))
        await page.waitForSelector('.gal-browse .gal-card')
        check('浏览器：首页两个类别卡片', (await page.$$('.gal-card.is-dir')).length === 2)
        await page.goto(link(target))
        await page.waitForSelector('.gal-player .gal-stage')
        await page.waitForFunction(() => /^1 \/ 8/.test(document.querySelector('.gal-count')?.textContent || ''))
        await sleep(1800)   // 黑场渐入 1 秒 + 背景渐变
        check('第 1 步：说话人「花」、台词两行；立绘 canvas 画了 1 个部件', (await txt('.gal-name')).includes('花') && (await txt('.gal-text')).includes('第一句台词') && (await parts()) === '1', `${await txt('.gal-name')} ${await parts()}`)
        // 立绘 40x120（表情 hana_01 = orange）：居中、底边对齐 1080 → 左上 (940, 960)
        const body = await pixel(960, 1000)
        check('立绘像素：表情图 hana_01（orange）居中、贴着画面下沿', near(body, [255, 165, 0, 255]), J(body))
        check('立绘以外是透明的', (await pixel(10, 10))?.[3] === 0)
        await page.screenshot({ path: path.join(shotDir, '1-stand.png') })
        await page.keyboard.press('Space'); await sleep(500)
        await page.keyboard.press('Space'); await sleep(900)
        check('第 3 步：两个角色（左 / 右）、说话人「凛」', (await parts()) === '2' && (await txt('.gal-name')).includes('凛'), `${await parts()} ${await txt('.gal-name')}`)
        await page.screenshot({ path: path.join(shotDir, '2-two.png') })
        await page.keyboard.press('Space'); await sleep(1200)
        check('第 4 步：缺的表情退回基础立绘（hana_00 = crimson）照常画出来', (await parts()) === '2', await parts())
        check('提示：layer 3 的滑入 / 滑出等暂未渲染（raw）可点开看明细', /条指令暂未渲染/.test(await txt('.gal-note')), await txt('.gal-note'))
        check('没有页面错误', errors.length === 0, J(errors))
      } catch (error) {
        fail++
        console.log(`FAIL 浏览器部分中断：${error.message} @ ${(error.stack || '').split('\n')[1] || ''}`)
      } finally { await browser?.close() }
    }
  }
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message} @ ${(error.stack || '').split('\n')[1] || ''}`)
} finally {
  server?.kill()
  await rm(dataDir, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed${skipped ? `，${skipped} 段跳过` : ''}`)
process.exit(fail ? 1 : 0)
