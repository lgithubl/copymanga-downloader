#!/usr/bin/env node
// 自测：随机排序 + 虚拟目录规则框（本地覆盖）——真实服务端 + 真浏览器：「更多 → 排序 → 随机」「重新随机」；「更多」里的「特殊场景」规则框：改规则 → 应用 → 命中数变（规则存在浏览器本地，随请求带 vr）→ 恢复默认。
//   node scripts/dev/fe-gal-viewrules-selftest.mjs      PLAYWRIGHT_PATH=<@playwright/test> 再加上浏览器（合成数据：AdvHD 的小游戏，1×1 的图）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { arcBuild, buildAdvhdFixture, msg, ws2Encode } from './make-advhd-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-viewrules-'))
const media = path.join(work, 'Lovey-dovey Part-time')
await buildAdvhdFixture(media)
// Rio1.arc 换成 12 个小脚本（3 个以 _H 结尾）：列表超过 8 项，「更多」里才有排序
const story = (n) => ws2Encode([['ClearLayer', ['*']], msg(0, `脚本${n}%K%P`), ['FileEnd', []]])
const scriptNames = Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(3, '0')}_00${[2, 5, 9].includes(i + 1) ? '_H' : ''}`)
await writeFile(path.join(media, 'Rio1.arc'), arcBuild(scriptNames.map((name, i) => ({ name: `${name}.ws2`, data: story(i + 1) }))))

const require = createRequire(import.meta.url)
let chromium = null
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { /* 没有 playwright：只做 HTTP 部分 */ }
const port = 8153
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
    form.set('profileOptions', JSON.stringify({ adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' } } })); form.set('metadataActionIds', 'gal-layout')
    const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
    const itemId = imported.items[0].itemId
    let full = null
    for (let i = 0; i < 80; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
    const reader = async (sectionId, extra = '') => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}${extra}`)).json())
    const home = await reader('')
    const rio1 = home.node.items.find((i) => i.title === 'Rio1')
    const plain = await reader(rio1.node)
    check('服务端：Rio1 有「特殊场景」（默认规则 _[hH]$，命中 3 个，local = false）', plain.node.viewRules?.[0]?.match === '_[hH]$' && plain.node.viewRules[0].count === 3 && plain.node.viewRules[0].local === false, JSON.stringify(plain.node.viewRules))
    const viaApi = await reader(rio1.node, `&vr=${encodeURIComponent(JSON.stringify({ special: { match: '^00[12]', on: 'name' } }))}`)
    check('服务端：请求带 vr 覆盖规则 → viewRules 变成本地规则、命中 2 个；写坏的 vr 被忽略', viaApi.node.viewRules[0].local === true && viaApi.node.viewRules[0].count === 2 && (await reader(rio1.node, '&vr=%7Bnot-json')).node.viewRules[0].count === 3)
    if (!chromium) console.log('SKIP 没有 @playwright/test：跳过浏览器部分')
    else {
      const browser = await chromium.launch()
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
        await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
        const page = await ctx.newPage()
        page.setDefaultTimeout(15000)
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        const vrRequests = []
        page.on('request', (r) => { if (/reader\/main/.test(r.url())) vrRequests.push(decodeURIComponent(r.url())) })
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(rio1.node)}`)
        await page.waitForSelector('.gal-card.is-script')
        const cardTitles = () => page.$$eval('.gal-card .gal-card-title', (els) => els.map((e) => e.textContent))
        const openMore = async () => { if (!(await page.$('.gal-browse-more-menu:not([hidden])'))) await page.click('.gal-browse-more-btn'); await page.waitForSelector('.gal-browse-more-menu:not([hidden])') }
        const natural = await cardTitles()
        await openMore()
        const options = await page.$$eval('.gal-browse-sort option', (os) => os.map((o) => o.textContent))
        check('「更多 → 排序」里有「随机」一项', options.includes('随机'), JSON.stringify(options))
        await page.selectOption('.gal-browse-sort', 'random')
        await page.waitForFunction((before) => document.querySelector('.gal-card') && JSON.stringify([...document.querySelectorAll('.gal-card .gal-card-title')].map((e) => e.textContent)) !== before, JSON.stringify(natural))
        const r1 = await cardTitles()
        check('选「随机」：顺序变了（目录「特殊场景」仍在最前），个数不变（13：12 个脚本 + 1 个虚拟目录）', r1.length === natural.length && r1[0] === natural[0] && JSON.stringify(r1) !== JSON.stringify(natural) && JSON.stringify([...r1].sort()) === JSON.stringify([...natural].sort()), JSON.stringify([natural, r1]))
        await openMore()
        const hasAgain = (await page.$$eval('.gal-browse-more-menu button', (bs) => bs.map((b) => b.textContent))).includes('重新随机')
        check('随机时「更多」里出现「重新随机」按钮', hasAgain)
        let changed = false
        for (let i = 0; i < 4 && !changed; i++) {
          await openMore()
          await page.evaluate(() => [...document.querySelectorAll('.gal-browse-more-menu button')].find((b) => b.textContent === '重新随机')?.click())
          await sleep(900)
          changed = JSON.stringify(await cardTitles()) !== JSON.stringify(r1)
        }
        check('点「重新随机」：换了一个顺序', changed)
        // 回到默认排序，测规则框
        await openMore()
        await page.selectOption('.gal-browse-sort', 'default')
        await page.waitForFunction((before) => JSON.stringify([...document.querySelectorAll('.gal-card .gal-card-title')].map((e) => e.textContent)) === before, JSON.stringify(natural))
        await openMore()
        const box = await page.$('.gal-view-rule[data-view="special"]')
        check('「更多」里有「特殊场景」规则框：默认规则 _[hH]$，命中 3 个，没有「恢复默认」', box && (await page.$eval('.gal-view-rule-input', (i) => i.value)) === '_[hH]$' && /命中 3 个/.test(await page.$eval('.gal-view-rule', (e) => e.textContent)) && !(await page.$$eval('.gal-view-rule button', (bs) => bs.some((b) => /恢复默认/.test(b.textContent)))))
        await page.fill('.gal-view-rule-input', '^00[12]')
        await page.click('.gal-view-rule button:has-text("应用")')
        await page.waitForFunction(() => /本地规则/.test(document.querySelector('.gal-view-rule')?.textContent || ''))
        const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || 'null'), itemId)
        check('应用：规则存进浏览器本地（copymanga.gal.view.<条目>.viewRules.special），请求带 vr；规则框变成「本地规则 · 命中 2 个」，出现「恢复默认」', saved?.viewRules?.special?.match === '^00[12]' && vrRequests.some((u) => /vr=\{"special":\{"match":"\^00\[12\]"/.test(u)) && /命中 2 个/.test(await page.$eval('.gal-view-rule', (e) => e.textContent)) && (await page.$$eval('.gal-view-rule button', (bs) => bs.some((b) => /恢复默认/.test(b.textContent)))), JSON.stringify([saved, await page.$eval('.gal-view-rule', (e) => e.textContent)]))
        const specialCard = async () => page.$$eval('.gal-card', (cards) => cards.filter((c) => /特殊场景/.test(c.textContent)).map((c) => c.querySelector('.gal-card-sub')?.textContent || ''))
        check('「特殊场景」卡片的数量跟着变（2 项）', (await specialCard()).some((t) => /2 项/.test(t)), JSON.stringify(await specialCard()))
        await openMore()
        await page.click('.gal-view-rule button:has-text("恢复默认")')
        await page.waitForFunction(() => /默认规则/.test(document.querySelector('.gal-view-rule')?.textContent || ''))
        const after = await page.evaluate((id) => JSON.parse(localStorage.getItem(`copymanga.gal.view.${id}`) || 'null'), itemId)
        check('恢复默认：本地规则清掉，命中回到 3 个', !after?.viewRules && /命中 3 个/.test(await page.$eval('.gal-view-rule', (e) => e.textContent)) && (await specialCard()).some((t) => /3 项/.test(t)), JSON.stringify([after, await specialCard()]))
        check('没有页面错误', errors.length === 0, JSON.stringify(errors))
      } finally { await browser.close() }
    }
  }
} finally { server?.kill() }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
