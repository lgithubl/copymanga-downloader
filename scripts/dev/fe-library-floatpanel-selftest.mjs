#!/usr/bin/env node
// 浏览器自测：媒体库「右侧详情浮动模式」（左右栏都收起、右边栏是小框）——脚本栏（执行选中章节 / 执行全量…）不能被下面的封面卡 / 章节列表盖住；章节很多时列表在框里滚动、不超出框。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-library-floatpanel-selftest.mjs
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { createGalHandler } from '../../web/library/types/gal.mjs'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const work = await mkdtemp(path.join(os.tmpdir(), 'fl-')); const dataDir = path.join(work, 'data'); const gal = path.join(dataDir, 'gal')
const dir = path.join(gal, 'item-a', 'resources/download/adv/text'); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 's.txt'), 'bg,a.jpg,0\nname,甲\nmsg,0,hi\nclickwait\n')
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
await handler.importFromSource({ sourcePath: path.join(gal, 'item-a'), options: {} })
const port = 8197, base = `http://127.0.0.1:${port}`; const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' }); await sleep(1500)
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await ctx.addInitScript(() => { localStorage.setItem('copymanga.sidebarHidden', '1'); localStorage.setItem('copymanga.detailFloat', '1') })
const page = await ctx.newPage()
await page.goto(base); await page.waitForSelector('.tab[data-view="library-view"]'); await page.click('.tab[data-view="library-view"]'); await page.waitForSelector('#library-items > *', { timeout: 20000 })
const btns = await page.$$eval('#library-items > * button', (b) => b.map((x) => x.textContent.trim())); await page.locator('#library-items > * button', { hasText: '目录' }).first().click(); await sleep(1500)
const info = await page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] }
  const units = document.querySelector('#library-units')
  for (let i = 0; i < 40; i++) { const d = document.createElement('div'); d.className = 'chapter'; d.textContent = 'unit ' + i; units.append(d) }
  return { scrolls: units.scrollHeight > units.clientHeight, cls: document.querySelector('#library-view').className, panel: document.querySelector('#library-detail-panel').className, panelRect: r('#library-detail-panel'), head: r('#library-detail-panel .chapter-head'), bar: r('.tag-script-bar'), units: r('#library-units'), card: r('.library-detail-card'), cover: r('.library-detail-cover'), display: getComputedStyle(document.querySelector('#library-detail-panel')).display, rows: getComputedStyle(document.querySelector('#library-detail-panel')).gridTemplateRows }
})
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const [bl, bt, bw, bh] = info.bar, [ul, ut] = info.units, [pl, pt, pw, ph] = info.panelRect
check('浮动模式：详情面板是 flex 列（不是 grid），脚本栏有自己的高度', info.display === 'flex' && bh > 20, JSON.stringify(info))
check('脚本栏在标题行下面、章节列表上面，互不重叠（脚本栏底边 ≤ 列表顶边）', bt >= info.head[1] + info.head[3] - 1 && bt + bh <= ut + 1, JSON.stringify(info))
check('章节列表没有超出浮动框（底边 ≤ 框底边），内容多时在列表里滚动', ut + info.units[3] <= pt + ph + 1 && info.scrolls, JSON.stringify(info))
await browser.close(); server.kill(); await rm(work, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
