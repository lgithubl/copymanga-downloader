#!/usr/bin/env node
// 自测：Kamihime 的胶片剧情（<id>_harem-character_script.json，开场 .ks 的下一个编号）——gal-samples13 / 14 里 321 段的格式：
//   [{ fps, auto, film, talk: [{ chara, words, voice? }], bgm?, repeat?, stay?, transition? }]；film = 竖排胶片（一帧宽 : 高 = 1 : 1.40625），在 resource_directory 目录里。
// 适配器（不需要浏览器）→ gal-layout 认 json 扩展名 → 起服务导入 → 列表里有它 → 读出来 → 浏览器里胶片按 fps 往下翻（有 @playwright/test 时）。
//   node scripts/dev/fe-gal-kamihime-film-selftest.mjs      PLAYWRIGHT_PATH=<@playwright/test> 再加上浏览器
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalog, parse, prepare } from '../../web/library/gal/adapters/tyrano-ks.mjs'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const RD = '7b40b24d2302fe13b813d72bcace69b4f35e8ff45bc2dc46'
const FILM = [
  { fps: 1, auto: false, film: 'black.jpg', bgm: 'bgm_h_001.mp3', talk: [{ chara: 'ヒロイン', words: '一行目', voice: 'v_01.mp3' }, { chara: 'ヒロイン', words: '二行目', voice: 'v_02.mp3' }] },
  { fps: 24, auto: false, film: 'strip.jpg', talk: [{ chara: '', words: '地の文' }, { chara: '主人公', words: '三行目' }] },
  { fps: 8, auto: true, film: 'strip.jpg', repeat: false, stay: '1s', transition: 'whiteout2s', talk: [{ chara: '', words: '' }] },
  { fps: 1, auto: true, film: 'nothere.jpg', transition: 'unknownfx', talk: [{ chara: '', words: '' }] },
  { fps: 1, auto: false, film: 'single.jpg', talk: [{ chara: 'ヒロイン', words: '最後' }] },
]
const INTRO = '*start\n[position height=160 top=600]\n[call target=*start storage="tyrano.ks"]\n[chara_new name="a" storage="a-1.png" jname="ヒロイン"]\n[bg storage="black.jpg" time=0 wait=true]\n#a\nはじまり[l][cm]\n'

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-kh-film-'))
const media = path.join(work, 'kamihime film')
const dmm = path.join(media, 'game', 'dmm')
const put = async (rel, content) => { await mkdir(path.dirname(path.join(dmm, rel)), { recursive: true }); await writeFile(path.join(dmm, rel), content) }
const img = async (rel, size, ...colors) => { await mkdir(path.dirname(path.join(dmm, rel)), { recursive: true }); execFileSync('convert', ['-size', size, ...colors.flatMap((c) => [`xc:${c}`]), '-append', path.join(dmm, rel)]) }
await img(`assets/${RD}/black.jpg`, '64x90', 'black')
await img(`assets/${RD}/single.jpg`, '64x90', 'teal')
await img(`assets/${RD}/strip.jpg`, '64x90', 'red', 'lime', 'blue')            // 3 帧：红 / 绿 / 蓝，竖着接起来（64×270）
for (const v of ['v_01', 'v_02']) await put(`assets/${RD}/${v}.mp3`, 'mp3')
await put('assets/bgm_h_001-1111111111111111111111111111111111111111.mp3', 'mp3')
const KIND = 'raw_scenario/kamihime_SSR/テスト[x]'
await put(`${KIND}/9001_harem-character_script.ks`, INTRO)
await put(`${KIND}/9001_harem-character.json`, J({ is_r18: false, resource_directory: RD, scenario_path: `76/89/${RD}/scenario/first.ks`, summary: 's', title: '開場' }))
await put(`${KIND}/9002_harem-character_script.json`, J(FILM))
await put(`${KIND}/9002_harem-character.json`, J({ resource_directory: RD, scenario_path: `dc/46/${RD}/scenario.json` }))
const rels = [`game/dmm/assets/${RD}/black.jpg`, `game/dmm/assets/${RD}/single.jpg`, `game/dmm/assets/${RD}/strip.jpg`, `game/dmm/assets/${RD}/v_01.mp3`, `game/dmm/assets/${RD}/v_02.mp3`, 'game/dmm/assets/bgm_h_001-1111111111111111111111111111111111111111.mp3', `game/dmm/raw_scenario/kamihime_SSR/テスト[x]/9001_harem-character_script.ks`, `game/dmm/raw_scenario/kamihime_SSR/テスト[x]/9001_harem-character.json`, `game/dmm/raw_scenario/kamihime_SSR/テスト[x]/9002_harem-character_script.json`, `game/dmm/raw_scenario/kamihime_SSR/テスト[x]/9002_harem-character.json`]

// ---- 适配器 ----
{
  const strip = (rel) => rel.replace(/^game\//, '')
  const texts = Object.fromEntries(rels.filter((r) => r.endsWith('.json') && r.includes('raw_scenario')).map((r) => [strip(r), r.endsWith('_script.json') ? J(FILM) : r.endsWith('9001_harem-character.json') ? J({ is_r18: false, resource_directory: RD, title: '開場' }) : J({ resource_directory: RD })]))
  const ctx = prepare({ options: { root: 'dmm' }, texts, files: rels.map(strip), toResourcePath: (r) => r })
  check('prepare：开场 .ks 和胶片 _script.json 都进脚本列表（2 个）；胶片脚本没有覆盖元数据（9002 的 resource_directory 还在）', ctx.scripts.length === 2 && [...ctx.meta.values()].filter((m) => m.rd === RD).length === 2, J([ctx.scripts, [...ctx.meta]]))
  const tree = catalog(ctx)
  const leaves = tree.children[0].children[0].children
  check('catalog：目录里 2 张卡片，标题 = 元数据 title，没有 title 的用脚本名（9002_harem-character）', J(leaves.map((l) => l.title)) === J(['開場', '9002_harem-character']), J(leaves.map((l) => l.title)))
  const filmScript = leaves[1].script
  const out = parse(J(FILM), ctx, { rel: filmScript })
  const cmds = out.steps.map((s) => s.commands)
  const ops = (i) => cmds[i].map((c) => c.op).join(',')
  check('胶片剧情：每句台词一步（5 句 → 5 步）；第 1 步 = bgm + 背景（胶片）+ 语音 + 说话人 + 台词', out.steps.length === 5 && ops(0) === 'bgm,bg,voice,speaker,text', J(out.steps.map((s, i) => ops(i))))
  const bg0 = cmds[0].find((c) => c.op === 'bg')
  check('第 1 段：film 找到 resource_directory 里的 black.jpg；fps 1（静图），循环；一帧宽高比 1 : 1.40625', bg0.src === `game/dmm/assets/${RD}/black.jpg`.replace(/^game\//, '') && J(bg0.film) === J({ ratio: 1.40625, fps: 1, loop: true, rotate: 90 }), J(bg0))
  check('语音 / bgm：resource_directory 里的 v_01.mp3、平铺层带 hash 的 bgm（按 stem 回退）', cmds[0].find((c) => c.op === 'voice').src.endsWith(`${RD}/v_01.mp3`) && cmds[0].find((c) => c.op === 'bgm').src.includes('bgm_h_001-'), J(cmds[0]))
  check('第 2 段（fps 24）：两句 = 两步；第 1 步背景是 strip.jpg，旁白（chara 空）→ 说话人清空', ops(2) === 'bg,speaker,text' && cmds[2].find((c) => c.op === 'bg').film.fps === 24 && cmds[2].find((c) => c.op === 'speaker').segments.length === 0 && ops(3) === 'speaker,text', J([ops(2), ops(3)]))
  check('自动段（auto、没有台词）不单独成步：bg（repeat false → loop false）+ transition whiteout2s → wash 白 2 秒 + wait（16 帧 / 8fps = 2 秒 + stay 1 秒 = 3 秒）并进下一步开头', J(cmds[4].slice(0, 3).map((c) => [c.op, c.film?.loop, c.color, c.seconds])) === J([['bg', false, undefined, undefined], ['wash', undefined, 'white', 2], ['wait', undefined, undefined, 3]]), J(cmds[4]))
  check('找不到的胶片记 unresolved；没见过的 transition 记 raw；auto 段 fps 1 + 没有 repeat：wait 1 秒（stay 缺省）', out.stats.unresolved['film:nothere.jpg'] === 1 && out.stats.raw['film:transition:unknownfx'] === 1 && cmds[4].some((c) => c.op === 'wait' && c.seconds === 1), J(out.stats))
  const off = parse(J(FILM), ctx, { rel: filmScript, options: { film: { enabled: false } } })
  check('film.enabled = false：记 raw film-script，只有一个空步（不炸）', off.stats.raw['film-script'] === 1 && off.steps.length === 1)
  const tuned = parse(J(FILM), ctx, { rel: filmScript, options: { film: { frameRatio: 2, autoFrames: 8, transitions: { whiteout2s: { op: 'fade', to: 'white', seconds: 1 } } } } })
  check('film 参数可调：frameRatio 2、autoFrames 8（wait = 8 / 8 + 1 = 2 秒）、transition 表换成 fade white 1 秒', tuned.steps[0].commands.find((c) => c.op === 'bg').film.ratio === 2 && tuned.steps[4].commands.some((c) => c.op === 'fade' && c.to === 'white') && tuned.steps[4].commands.some((c) => c.op === 'wait' && c.seconds === 2), J(tuned.steps[4]))
  const withPortrait = prepare({ options: { root: 'dmm' }, texts, files: [...rels.map(strip), 'dmm/portrait/テスト.png', 'dmm/portrait/other.png'], toResourcePath: (r) => r.replace(/^dmm\/portrait\//, '') })
  const folder = catalog(withPortrait).children[0].children[0]
  check('catalog 角色目录卡片：目录名 テスト[x] 去掉 [称号] → portrait/テスト.png 当缩略图（资源根里是 テスト.png）；对不上头像的目录不给 thumb', folder.thumb === 'テスト.png' && !catalog(ctx).children[0].children[0].thumb, J([folder.thumb, folder.title]))
  check('不是胶片的 .ks 文本照旧走标签解析（开场：1 步，有台词）', parse(INTRO, ctx, { rel: leaves[0].script }).steps.length === 1)
}

// ---- gal-layout：Kamihime 的脚本扩展名要带 json ----
{
  const out = await galLayoutScript({ item: { itemId: 'kf', title: 'kf', config: { game: { id: 'kamihime' } }, source: { path: media }, adapters: ['tyrano-ks'] }, script: { id: 'gal-layout', version: '2.15.0', options: {} } })
  const cfg = out.itemPatch?.gal?.config
  check('gal-layout（kamihime）：scriptExtensions = [ks, json]，adapterOptions.tyrano-ks.film 在表里', J(cfg?.scriptExtensions) === J(['ks', 'json']) && cfg?.adapterOptions?.['tyrano-ks']?.film?.frameRatio === 1.40625, J([cfg?.scriptExtensions, cfg?.adapterOptions?.['tyrano-ks']?.film]))
}

// ---- 服务 + 浏览器 ----
const require = createRequire(import.meta.url)
let chromium = null
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { /* 没有 playwright：只做 HTTP 部分 */ }
const port = 8147
const base = `http://127.0.0.1:${port}`
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
let server = null
try {
  try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch { /* 空闲 */ }
  server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
  let up = false
  for (let i = 0; i < 100 && !up; i++) { try { await fetch(`${base}/health`); up = true } catch { await sleep(200) } }
  if (!up) { console.log('SKIP 起不来 web 服务'); } else {
    const form = new FormData()
    form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
    form.set('profileOptions', JSON.stringify({ adapters: ['tyrano-ks'], config: { game: { id: 'kamihime' } } })); form.set('metadataActionIds', 'gal-layout')
    const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
    const itemId = imported.items[0].itemId
    let full = null
    for (let i = 0; i < 60; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
    const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
    const home = await reader('')
    const kind = await reader(home.node.items[0].node)
    const dir = await reader(kind.node.items[0].node)
    check('导入后目录里有 2 张卡片（开场 .ks + 胶片 json）', dir.node.items.length === 2, J(dir.node.items.map((i) => i.title)))
    const played = await reader(dir.node.items[1].node)
    if (process.env.DEBUG_FILM) console.log(J(played).slice(0, 1500))
    const bgs = played.scene?.steps?.flatMap((s) => s.commands).filter((c) => c.op === 'bg') || []
    check('读胶片剧情（真实 handler）：scene 来自 tyrano-ks，5 步，背景带 film', played.scene?.adapter === 'tyrano-ks' && played.scene.steps.length === 5 && bgs.length >= 3 && bgs.every((b) => b.film), J(played.scene?.stats))
    const res = async (src) => (await fetch(`${base}${played.resourceBase}?path=${encodeURIComponent(src)}`)).status
    check('资源接口：胶片 jpg 取得到', await res(bgs[1].src) === 200, J(bgs[1]))
    // 列表卡片：胶片场景没有骨骼，但每段不同的胶片渲染一帧（renders，轮播）；兜底的灰底图不要
    const filmCard = dir.node.items[1]
    check('列表：胶片场景卡片带 renders（Kamihime 默认开了 inner：每段不同的、找得到的胶片的中间帧 black / strip / single，再加第一条胶片的另一个位置的帧，共 4 张（innerMax）；nothere 找不到，不出 bg，film 字段是胶片路径），兜底图不要（thumbs 空）', Array.isArray(filmCard.renders) && filmCard.renders.length === 4 && filmCard.renders.every((r) => /^[0-9a-f]{40}$/.test(r.key) && r.film) && J(filmCard.renders.map((r) => r.film.split('/').pop())) === J(['black.jpg', 'strip.jpg', 'single.jpg', 'black.jpg']) && filmCard.renders[3].frame > 0 && filmCard.renders[3].frame < 0.5 && filmCard.thumbs.length === 0 && J(filmCard.render) === J(filmCard.renders[0]), J(filmCard))
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
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(dir.node.items[1].node)}`)
        await page.waitForSelector('.gal-player .gal-stage')
        await page.waitForFunction(() => /^1 \/ 5/.test(document.querySelector('.gal-count')?.textContent || ''))
        // 胶片逆时针转了 90° 存的（作者的 2_build_rpy.py：Rotozoom(文件, 90)）：显示出来一帧是横版 1.40625 : 1，帧 0 在最左；条带转完之后的外接框 = 帧数 × 帧宽 × 帧高
        const filmBox = () => page.evaluate(() => {
          const f = [...document.querySelectorAll('.gal-film')].find((n) => n.parentElement.style.opacity !== '0')
          if (!f) return null
          const strip = f.firstElementChild.getBoundingClientRect()
          return { w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height, sw: strip.width, sh: strip.height, sx: strip.left - f.getBoundingClientRect().left, rotate: f.dataset.rotate, transform: f.firstElementChild.style.transform }
        })
        // 渲染缩略图：胶片取中间一帧（strip.jpg 三帧 红 / 绿 / 蓝 → 绿），转回正的再铺满
        const stripSrc = filmCard.renders[1].film
        const tint = await page.evaluate(async ([api, resourceBase, node, film, frameFraction]) => {
          const m = await import('/gal-thumb-render.js')
          const blob = await m.renderSceneThumb({ apiBase: api, resourceBase, node, film, filmFrame: frameFraction, width: 160 })
          const bmp = await createImageBitmap(blob)
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
          const x = c.getContext('2d'); x.drawImage(bmp, 0, 0)
          const px = (fx, fy) => [...x.getImageData(Math.round(fx * (c.width - 1)), Math.round(fy * (c.height - 1)), 1, 1).data]
          return { size: [bmp.width, bmp.height], center: px(0.5, 0.5), corners: [px(0.1, 0.1), px(0.9, 0.9)] }
        }, [`${base}/api/library/items/gal/${itemId}`, played.resourceBase, dir.node.items[1].node, stripSrc, 0.5])
        const greenish = (p) => p[1] > 150 && p[0] < 120 && p[2] < 120
        check('renderSceneThumb({ film }) 胶片中间一帧：160×90 的 JPEG，中心和四周都是绿（lime），不是红 / 蓝 / 黑', tint.size[0] === 160 && tint.size[1] === 90 && greenish(tint.center) && tint.corners.every(greenish), J(tint))
        const none = await page.evaluate(async ([api, resourceBase, node]) => {
          const m = await import('/gal-thumb-render.js')
          try { await m.renderSceneThumb({ apiBase: api, resourceBase, node, film: 'no/such/film.jpg', width: 160 }); return 'ok' } catch (e) { return String(e.message) }
        }, [`${base}/api/library/items/gal/${itemId}`, played.resourceBase, dir.node.items[1].node])
        check('film 对不上脚本里的任何一段胶片：报「脚本里没有用到胶片」，不画空图', /没有用到胶片/.test(none), none)
        await sleep(600)
        const first = await filmBox()
        check('第 1 段：胶片元素（.gal-film）存在，高 = 舞台高度、宽 = 高 × 1.40625（横版一帧居中）；rotate = 90', first && first.rotate === '90' && Math.abs(first.w / first.h - 1.40625) < 0.01, J(first))
        await page.keyboard.press('Space'); await sleep(300)
        await page.keyboard.press('Space'); await sleep(1200)   // 第 3 步：strip.jpg（3 帧，24fps，循环）
        const second = await filmBox()
        check('第 2 段：strip.jpg 按 3 帧切：转完之后的条带外接框 = 3 帧宽 × 1 帧高（高等于舞台里那一帧的高），帧 i 靠 translate(-i × 帧宽) 对齐', second && Math.abs(second.sh - second.h) < 2 && Math.abs(second.sw - 3 * second.w) < 3, J(second))
        const positions = new Set()
        for (let i = 0; i < 14; i++) { positions.add((await filmBox())?.transform); await sleep(30) }
        check('24fps 循环：采样到不止一个帧位置（translate 的 x 在 0 / −帧宽 / −2 × 帧宽 里至少两个）', positions.size >= 2, J([...positions]))
        await page.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), 'kamihime-film.png') })
        check('没有页面错误', errors.length === 0, J(errors))
      } finally { await browser.close() }
    }
  }
} finally { server?.kill() }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
