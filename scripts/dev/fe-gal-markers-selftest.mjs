#!/usr/bin/env node
// 自测：场景跳转点（config.sceneMarkers）——真实服务端流程：导入时带规则 → 列表卡片上有跳转点按钮 → 点了从那一步开始播（计数、台词、没有上次进度）；点卡片本身仍从头开始。
//   node scripts/dev/fe-gal-markers-selftest.mjs      PLAYWRIGHT_PATH=<@playwright/test> 再加上浏览器（合成数据：AdvHD 的小游戏，1×1 的图）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { existsSync } from 'node:fs'
import { buildAdvhdFixture } from './make-advhd-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-markers-'))
const media = path.join(work, 'Lovey-dovey Part-time')
await buildAdvhdFixture(media)

const require = createRequire(import.meta.url)
let chromium = null
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { /* 没有 playwright：只做 HTTP 部分 */ }
const port = 8151
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
    // STORY_001：步 3 = 事件图 EV_01 叠在背景上（bg.over）；规则：背景带 EV_01 的每一段开头
    form.set('profileOptions', JSON.stringify({ adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' }, sceneMarkers: [{ label: 'CG 开始', kind: 'bg', match: 'EV_01' }, { label: '旁白', kind: 'cmd', op: 'text', match: '^ナレーション$', max: 1 }] } })); form.set('metadataActionIds', 'gal-layout')
    const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
    const itemId = imported.items[0].itemId
    let full = null
    for (let i = 0; i < 80; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
    check('导入：新版布局自动添加 AdvHD 中途开始规则', full.config?.sceneMarkers?.some(r=>r.op==='bgvoice') && full.config?.sceneMarkers?.some(r=>r.label==='CG 开始'), J(full.config?.sceneMarkers))
    const handler=createGalHandler({dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({})})
    await handler.patchItemMetadata(itemId,{gal:{config:{sceneMarkers:[{label:'CG 开始',kind:'bg',match:'EV_01'},{label:'旁白',kind:'cmd',op:'text',match:'^ナレーション$',max:1}]}}})
    const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
    const home = await reader('')
    const dirNode = (await reader(home.node.items.find((i) => i.title === 'Rio1').node)).node
    const card = dirNode.items.find((i) => i.title === '001_00')
    check('服务端：卡片含步1旁白与步3CG，无标记脚本没有标签', J(card.markers?.map((m) => [m.step, m.label])) === J([[1, '旁白'], [3, 'CG 开始']]) && dirNode.items.find((i) => i.title === '003_00')?.markers === undefined, J(dirNode.items.map((i) => [i.title, i.markers])))
    if (!chromium) console.log('SKIP 没有 @playwright/test：跳过浏览器部分')
    else {
      const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH}:{}), args: ['--autoplay-policy=no-user-gesture-required'] })
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
        const page = await ctx.newPage()
        page.setDefaultTimeout(12000)
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        const text = () => page.$eval('.gal-text', (e) => e.textContent)
        const count = () => page.$eval('.gal-count', (e) => e.textContent)
        const open = async () => { await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(home.node.items.find((i) => i.title === 'Rio1').node)}`); await page.waitForSelector('.gal-card.is-script') }
        await open()
        const marks = await page.$$eval('.gal-card-mark', (bs) => bs.map((b) => [b.textContent, b.dataset.step]))
        check('列表：001_00 卡片含旁白与CG两个标签', J(marks) === J([['旁白', '1'], ['CG 开始', '3']]), J(marks))
        await page.click('.gal-card-mark[data-step="3"]')
        await page.waitForSelector('.gal-player .gal-stage')
        await page.waitForFunction(() => /^4 \/ 6/.test(document.querySelector('.gal-count')?.textContent || ''))
        check('点按钮：从第 4 步开始（计数「4 / 6」），台词是第 4 句「CG」', /^4 \/ 6/.test(await count()) && /CG/.test(await text()), J([await count(), await text()]))
        const over = await page.evaluate(() => [...document.querySelectorAll('.gal-bg')].map((l) => l.style.backgroundImage + l.innerHTML).join('|'))
        check('起播时画面已经是那一步的状态（事件图 EV_01 在背景层里）', /EV_01/.test(decodeURIComponent(over)), over.slice(0, 200))
        check('播放器标记与卡片一致；当前最后一个标记没有下个、仍有上个', await page.locator('.gal-mark-next').isDisabled() && await page.locator('.gal-mark-prev').isEnabled())
        const order = await page.locator('.gal-fast-btn').evaluate(e=>[e.nextElementSibling?.classList.contains('gal-mark-prev'),e.nextElementSibling?.nextElementSibling?.classList.contains('gal-mark-next'),e.nextElementSibling?.nextElementSibling?.nextElementSibling?.classList.contains('gal-trans-btn')])
        check('两个标签按钮在快进与翻译之间', J(order)===J([true,true,true]),J(order))
        await page.click('.gal-mark-prev'); await sleep(100)
        check('上个标签还原旁白步骤；没有更早标签则置灰', /^2 \/ 6/.test(await count()) && /ナレーション/.test(await text()) && await page.locator('.gal-mark-prev').isDisabled() && await page.locator('.gal-mark-next').isEnabled(),J([await count(),await text()]))
        await page.click('.gal-mark-next'); await sleep(100)
        check('下个标签跳回CG并还原图片', /^4 \/ 6/.test(await count()) && /CG/.test(await text()),J([await count(),await text()]))
        await page.keyboard.press('Space'); await sleep(400)
        check('继续点一下 = 下一步（5 / 6）', /^5 \/ 6/.test(await count()), await count())
        await open()
        await page.locator('.gal-card[data-title="001_00"] .gal-card-title').click()
        await page.waitForSelector('.gal-player .gal-stage')
        await page.waitForFunction(() => /\/ 6/.test(document.querySelector('.gal-count')?.textContent || ''))
        check('点普通卡片仍能进入播放器', /\/ 6/.test(await count()), await count())
        await open(); await page.locator('.gal-card[data-title="003_00"]').click(); await page.waitForSelector('.gal-player')
        check('无标签脚本两个按钮均置灰', await page.locator('.gal-mark-prev').isDisabled() && await page.locator('.gal-mark-next').isDisabled())
        check('没有页面错误', errors.length === 0, J(errors))
      } finally { await browser.close() }
    }
  }
} finally { server?.kill() }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
