#!/usr/bin/env node
// 浏览器自测：ミナシゴノシゴトR（uviewer-csv + sprites）——导入（gal-layout 的 minashigo_r 配置）→ 列表按角色编号分组 → 播放页：
//   plist 图集立绘（身体底图 + 表情帧、旋转帧、两个槽位）、CG（sprite → overlay）、spriteoff、缺图集的提示；第二个条目（手写配置）验证叠加层的矩形 / 图 / imgconf 布局更新 / spriteoff。像素在 canvas 里取。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-minashigo-r-selftest.mjs     截图在 SHOT_DIR（默认 /tmp/minashigo-r-shots）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMinashigoRFixture, script } from './make-minashigo-r-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR || '/tmp/minashigo-r-shots'
await mkdir(shotDir, { recursive: true })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-mgr-'))
const dirA = path.join(dataDir, 'gal', 'minashigo_r演示')
const dirB = path.join(dataDir, 'gal', 'minashigo_r叠加层')
await buildMinashigoRFixture(dirA)
const line = (...f) => f.join(',')
const msg = (t) => [line('name', '', ''), line('msg', '1', t, '', '', '', '', '', '', '', '')]
await buildMinashigoRFixture(dirB, {
  stories: {
    '120090301': script([
      [...msg('矩形 + 黑图'), line('mask', 'black1', 0, 0, 1280, 200, 0.5, '', '', '', ''), line('sprite', 'adv/image/ef/black.jpg', 'k', 200, 100, 10, 0)],
      [...msg('imgconf 改布局'), line('imgconf', 'k', 'm', 0, 0, '', '', 0, 1, 1, 0)],
      [...msg('spriteoff'), line('spriteoff', 'k', 0), line('spriteoff', 'all', 0)],
      [...msg('清空叠加层'), line('mask', 'black1', 0, 0, 1280, 200, 0, '', '', '', '')],
    ]),
  },
})
const port = 8194
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const importItem = async (dir, profile, actions) => {
    const form = new FormData()
    form.set('importProfile', 'gal-import'); form.set('sourcePath', dir)
    form.set('profileOptions', JSON.stringify(profile)); form.set('metadataActionIds', actions)
    const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
    return imported.items[0].itemId
  }
  // 条目 A：gal-layout 的 minashigo_r 配置（真实 LAYOUTS）
  const itemA = await importItem(dirA, { adapters: ['uviewer-csv'], config: { game: { id: 'minashigo_r' } } }, 'gal-layout')
  let full = null
  for (let i = 0; i < 60; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemA}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
  check('导入 + gal-layout：game.id minashigo_r、sprites 打开、groups 写进配置、脚本数 3', full.config?.game?.id === 'minashigo_r' && full.config?.adapterOptions?.['uviewer-csv']?.sprites?.enabled === true && full.config?.groups?.length === 7 && full.scriptCount === 3, J([full.config?.game, full.config?.groups, full.scriptCount]))
  // 条目 B：手写配置（不跑 gal-layout，game.id 用不认识的值）：sprites 开、mask 当矩形、imgconf 改布局（默认表）
  const itemB = await importItem(dirB, { adapters: ['uviewer-csv'], config: { game: { id: 'custom-r' }, scriptRoots: [{ id: 'story', dir: 'data/adv/textfiles/story', label: 'story' }], resourceRoots: ['data'], scriptExtensions: ['txt'], adapterOptions: { 'uviewer-csv': { sprites: { enabled: true } } } } }, '')
  const reader = async (id, sectionId) => (await (await fetch(`${base}/api/library/items/gal/${id}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
  const homeA = await reader(itemA, '')
  const groupCard = homeA.node.items.find((i) => i.title === '200903')
  const groupA = await reader(itemA, groupCard.node)
  const targetA = groupA.node.items.find((i) => i.title === '120090301').node
  const homeB = await reader(itemB, '')
  const targetB = homeB.node.items.find((i) => i.title === '120090301')?.node

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  const link = (id, node) => `${base}/#/media/gal/${id}/main?section=${encodeURIComponent(node)}`
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '')
  const pixel = (sel, x, y) => page.evaluate(([s, px, py]) => { const c = document.querySelector(s); if (!c) return null; const d = c.getContext('2d').getImageData(px, py, 1, 1).data; return [d[0], d[1], d[2], d[3]] }, [sel, x, y])
  const stand = (x, y) => pixel('canvas.gal-stand', x, y)
  const overlay = (x, y) => pixel('canvas.gal-overlay', x, y)
  const near = (px, want, tol = 14) => Boolean(px) && want.every((v, i) => Math.abs(px[i] - v) <= tol)
  const parts = (sel) => page.$eval(sel, (c) => c.dataset.parts).catch(() => '')
  const waitCount = (t) => page.waitForFunction((v) => document.querySelector('.gal-count')?.textContent === v, t)
  // 轮询直到条件成立（立绘是异步加载 plist + 贴图的）
  const until = async (fn, tries = 40) => { let last; for (let i = 0; i < tries; i++) { last = await fn(); if (last === true || (last && last.ok)) return last; await sleep(150) } return last }
  const next = async (count) => { await page.keyboard.press('Space'); await waitCount(count) }

  // 列表：按角色编号分组
  await page.goto(link(itemA, ''))
  await page.waitForSelector('.gal-browse .gal-card')
  check('首页：角色编号分组卡片「200903」+ 不匹配分组规则的 100042 脚本（照常列出）', J((await page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))).sort()) === J(['100042', '200903']), J(await page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))))
  await page.click('.gal-card[data-title="200903"]')
  await page.waitForSelector('.gal-card.is-script')
  check('进分组：两个脚本 120090301 / 120090302', J(await page.$$eval('.gal-card-title', (es) => es.map((e) => e.textContent))) === J(['120090301', '120090302']))
  await page.screenshot({ path: path.join(shotDir, '1-group.png') })

  // ---- 条目 A：立绘 ----
  await page.goto(link(itemA, targetA))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 5')
  // 第 1 步：dan = body.png（红，身体）+ 000.png（绿，脸）。画布 1920x1080；舞台 1280x720 → k = 1.5；画布中心 (960, 540) = 舞台中心
  //   身体：中心在画布中心下 20 → (960, 570)、大小 90x120 → x 915..1005, y 510..630；脸：中心在画布中心上 40 → (960, 480)、大小 30x24
  const s1 = await until(async () => { const body = await stand(925, 600); const face = await stand(960, 480); return { ok: near(body, [255, 0, 0, 255]) && near(face, [0, 255, 0, 255]), body, face } })
  check('第 1 步：立绘 dan 画出来了（plist 图集：身体底图 body.png 红 + 表情 000.png 绿，按 spriteOffset 摆在原图画布里）', s1.ok, J(s1))
  check('第 1 步：身体 / 脸以外是透明的；canvas 叠在背景之上、不挡点击', (await stand(100, 100))?.[3] === 0 && await page.evaluate(() => { const c = document.querySelector('canvas.gal-stand'); return Number(getComputedStyle(c).zIndex) > Number(getComputedStyle(document.querySelector('.gal-bg')).zIndex) && getComputedStyle(c).pointerEvents === 'none' }))
  check('第 1 步：台词；背景（bg0000702）', (await text('.gal-text')).includes('第一步') && (await page.$$eval('.gal-bg', (els) => els.some((e) => /bg0000702/.test(e.style.backgroundImage)))))
  await page.screenshot({ path: path.join(shotDir, '2-stand-dan.png') })
  // 第 2 步：dan2 = body 底图 + 旋转帧 001（左半蓝右半黄），x=200 y=100（向上）scale 2：中心 (960+300, 540-150) = (1260, 390)、s = 3
  //   旋转帧：画布中心上 40 → 中心 (1260, 270)，还原后 30x10 → 90x30：x 1215..1305, y 255..285；左半蓝、右半黄。底图身体：中心 (1260, 450)、180x240 → y 330..570
  await next('2 / 5')
  const s2 = await until(async () => { const blue = await stand(1235, 270); const yellow = await stand(1285, 270); const body = await stand(1180, 560); const dan = await stand(925, 600); return { ok: near(blue, [0, 0, 255, 255]) && near(yellow, [255, 255, 0, 255]) && near(body, [255, 0, 0, 255]) && near(dan, [255, 0, 0, 255]), blue, yellow, body, dan } })
  check('第 2 步：第二个槽位 dan2（放大 2 倍、x=200 y=100）：旋转帧逆时针还原（左半蓝、右半黄）、底图身体在下面；dan 仍在', s2.ok, J(s2))
  check('第 2 步：stand canvas 里 2 个槽位（dataset.slots）', J(JSON.parse(await page.$eval('canvas.gal-stand', (c) => c.dataset.slots))) === J(['dan', 'dan2']) && (await parts('canvas.gal-stand')) === '2')
  await page.screenshot({ path: path.join(shotDir, '3-two-slots.png') })
  // 第 3 步：去掉 dan；CG still1（64x36 橙色，fit contain 铺满舞台）画在 overlay canvas
  await next('3 / 5')
  const s3 = await until(async () => { const cg = await overlay(100, 100); const cg2 = await overlay(1800, 1000); const dan = await stand(925, 600); const dan2 = await stand(1180, 560); return { ok: near(cg, [255, 165, 0, 255]) && near(cg2, [255, 165, 0, 255]) && dan?.[3] === 0 && near(dan2, [255, 0, 0, 255]), cg, cg2, dan, dan2 } })
  check('第 3 步：spriteoff dan = 只去掉 dan（dan2 还在）；CG（sprite → overlay，contain）铺满舞台，叠在立绘之上', s3.ok, J(s3))
  check('overlay canvas：z-index 高于立绘 canvas、不挡点击', await page.evaluate(() => { const o = getComputedStyle(document.querySelector('canvas.gal-overlay')); const s = getComputedStyle(document.querySelector('canvas.gal-stand')); return Number(o.zIndex) > Number(s.zIndex) && o.pointerEvents === 'none' }))
  await page.screenshot({ path: path.join(shotDir, '4-cg.png') })
  // 第 4 步：spriteoff still1 + spriteoff all（清立绘）+ shake + flash（实时播放，不报错）
  await next('4 / 5')
  const s4 = await until(async () => ({ ok: (await parts('canvas.gal-stand')) === '0' && (await parts('canvas.gal-overlay')) === '0' && (await overlay(100, 100))?.[3] === 0 && (await stand(1180, 560))?.[3] === 0, stand: await parts('canvas.gal-stand'), overlay: await parts('canvas.gal-overlay') }))
  check('第 4 步：spriteoff still1 / spriteoff all → 叠加层和全部立绘都清空（canvas 全透明）；抖动 / 闪屏照常播放', s4.ok, J(s4))
  await sleep(500)
  // 后退到第 2 步：一步到位重建（两个槽位）
  await page.keyboard.press('ArrowLeft'); await waitCount('3 / 5')
  await page.keyboard.press('ArrowLeft'); await waitCount('2 / 5')
  const back = await until(async () => ({ ok: near(await stand(1235, 270), [0, 0, 255, 255]) && near(await stand(925, 600), [255, 0, 0, 255]) && (await parts('canvas.gal-overlay')) === '0' }))
  check('后退到第 2 步：dan + dan2 重新画出来、CG 没有', back.ok, J(back))
  // 第 5 步：缺图集 → 缺资源提示，不崩
  await next('3 / 5'); await next('4 / 5'); await next('5 / 5')
  await page.waitForFunction(() => /缺少资源/.test(document.querySelector('.gal-note')?.textContent || ''))
  await page.click('.gal-note')
  const diag = await page.$eval('.gal-diag-text', (e) => e.textContent)
  check('第 5 步：图集（999999/atlas/stand_a.plist）不存在 → 「缺少资源」提示里列出路径；播放器不崩', /999999\/atlas\/stand_a\.plist/.test(diag) && (await text('.gal-text')).includes('第五步'), diag.slice(0, 500))
  check('诊断里没有 spriteatlas / sprite / spriteoff / shake（已渲染）；全表默认下 flash / shake 也不在「暂未渲染」里', !/spriteatlas|spriteoff|shake|flash/.test(diag), diag.slice(0, 500))
  await page.click('.gal-diag button:has-text("关闭")')
  await page.screenshot({ path: path.join(shotDir, '5-missing.png') })

  // ---- 条目 B：叠加层 ----
  await page.goto(link(itemB, targetB))
  await page.waitForSelector('.gal-player .gal-stage')
  await waitCount('1 / 4')
  // 矩形：mask black1 0,0,1280,200 alpha 0.5，y 向上 → 舞台底部 200 像素（y 520..720）→ 画布 y 780..1080、半透明黑
  //   黑图：16x16 黑，缩放 10 → 160x160 舞台像素，中心偏移 (200, -100 向下) → 画布中心 (1260, 390)，240x240：x 1140..1380, y 270..510
  const b1 = await until(async () => { const rect = await overlay(100, 1000); const top = await overlay(100, 100); const dot = await overlay(1260, 390); return { ok: near(rect, [0, 0, 0, 128], 6) && top?.[3] === 0 && near(dot, [0, 0, 0, 255], 6), rect, top, dot } })
  check('叠加层（手写配置）：mask → 舞台底部 200 像素的半透明黑色矩形；sprite → 缩放 10 倍的图（位置按 x / y）；其余透明', b1.ok, J(b1))
  check('overlay canvas 有 2 个叠加层（slots = black1、k）', J(JSON.parse(await page.$eval('canvas.gal-overlay', (c) => c.dataset.slots))) === J(['black1', 'k']) && (await parts('canvas.gal-overlay')) === '2')
  await page.screenshot({ path: path.join(shotDir, '6-overlay-rect.png') })
  await next('2 / 4')   // imgconf k：缩放 1、位置回到中心 → 24x24（画布）中心 (960, 540)
  const b2 = await until(async () => { const old = await overlay(1260, 390); const moved = await overlay(960, 540); const rect = await overlay(100, 1000); return { ok: old?.[3] === 0 && near(moved, [0, 0, 0, 255], 6) && near(rect, [0, 0, 0, 128], 6), old, moved, rect } })
  check('imgconf：已有叠加层 k 的布局被更新（缩放 1、移到舞台中心），图还是同一张，矩形不受影响', b2.ok, J(b2))
  await next('3 / 4')   // spriteoff k + spriteoff all（只清立绘）：k 没了，矩形还在
  const b3 = await until(async () => ({ ok: (await overlay(960, 540))?.[3] === 0 && near(await overlay(100, 1000), [0, 0, 0, 128], 6) && (await parts('canvas.gal-overlay')) === '1', parts: await parts('canvas.gal-overlay') }))
  check('spriteoff k：只去掉 k；spriteoff all 默认只清立绘，矩形（叠加层）保留', b3.ok, J(b3))
  await next('4 / 4')   // mask black1 alpha 0 → 隐藏
  const b4 = await until(async () => ({ ok: (await parts('canvas.gal-overlay')) === '0' && (await overlay(100, 1000))?.[3] === 0, parts: await parts('canvas.gal-overlay') }))
  check('同槽位再来一条 mask（alpha 0）：矩形被更新成隐藏', b4.ok, J(b4))
  check('全程没有页面报错', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await rm(dataDir, { recursive: true, force: true }).catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed（截图：${shotDir}）`)
process.exit(fail ? 1 : 0)
