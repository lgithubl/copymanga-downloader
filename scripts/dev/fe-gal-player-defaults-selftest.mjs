#!/usr/bin/env node
// 浏览器自测：config.player 的默认值只在「浏览器里没存过对应设置」时生效（存过的优先）；端口 8171
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-player-defaults-selftest.mjs
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-pdef-'))
const media = path.join(dataDir, 'gal', 'Defaults演示')
const T = (...p) => path.join(media, 'resources', 'download', 'adv', 'text', ...p)
await mkdir(T('cabin', 'adultr'), { recursive: true })
await mkdir(path.join(media, 'user_data'), { recursive: true })
await writeFile(path.join(media, 'user_data', 'settings.json'), J({ resource_path: './resources', script_language: 'zh' }))
const msg = (who, text) => `name,${who},\nmsg,0,${text},,,,,,,,,\nclickwait,,,,,,,,,,,\n`
await writeFile(T('cabin/adultr/700100.txt'), 'bg,color_20_60_40,0,,,,,,,,\n' + [['小夜', '「第一句。」'], ['小夜', '「第二句。」']].map(([w, t]) => msg(w, t)).join(''))

const port = 8171
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
  form.set('profileOptions', JSON.stringify({ adapters: ['uviewer-csv'], config: { player: { fontScale: 1.5, textOpacity: 0.3, autoDelay: 5, cameraMode: 'fixed', zoom: 2, minFitScale: 0.8, fastInterval: 40, bogus: 1 } } }))
  const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
  const itemId = imported.items[0].itemId
  const section = 's:cabin/adultr/700100.txt'
  const api = await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(section)}`)).json().catch(() => null)
  check('API：播放页节点带 node.player（规整后的默认值，非法字段已去掉）', api?.node?.player && api.node.player.fontScale === 1.5 && api.node.player.zoom === 2 && api.node.player.fastInterval === 40 && !('bogus' in api.node.player), J(api?.node?.player))

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('pdef-init')) { localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })); sessionStorage.setItem('pdef-init', '1') } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  const open = async () => { await page.goto(`${base}/health`); await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(section)}`); await page.waitForSelector('.gal-player .gal-stage'); await sleep(400) }
  const read = () => page.evaluate(() => {
    const root = document.querySelector('.gal-player')
    return {
      font: root.style.getPropertyValue('--gal-font-scale'),
      alpha: root.style.getPropertyValue('--gal-box-alpha'),
      delay: document.querySelector('.gal-set-number:not(.gal-set-autochoice)').value,
      fontRange: document.querySelector('.gal-settings input[type=range]').value,
    }
  })
  // 1. 浏览器里什么都没存过：全部用服务端默认
  await open()
  let v = await read()
  check('没有本地设置：字体 / 文本框透明度 / 自动播放等待 = config.player', v.font === '1.5' && v.alpha === '0.3' && v.delay === '5' && v.fontRange === '150', J(v))
  // 2. 存了字体和透明度：本地优先；没存的（等待秒数）仍用默认
  await page.evaluate(() => { localStorage.setItem('copymanga.gal.fontScale', '1.2'); localStorage.setItem('copymanga.gal.boxOpacity', '0.9') })
  await open()
  v = await read()
  check('本地存过的设置优先（字体 1.2、透明度 0.9）；没存过的（等待 5 秒）仍是默认', v.font === '1.2' && v.alpha === '0.9' && v.delay === '5', J(v))
  // 3. 全存了
  await page.evaluate(() => { localStorage.setItem('copymanga.gal.autoVoiceDelay', '2') })
  await open()
  v = await read()
  check('三项都存过：全用本地的', v.font === '1.2' && v.alpha === '0.9' && v.delay === '2', J(v))
  // 4. 画面：zoom / cameraMode 默认；存过的（按媒体）优先
  const views = () => page.evaluate(() => ({ zoom: document.querySelector('.gal-settings input[title*="画面放大倍率"]')?.value, cam: document.querySelector('.gal-settings select')?.value }))
  await page.evaluate(() => localStorage.clear())
  await open()
  const v1 = await views()
  check('画面放大默认 = config.player.zoom（2）', v1.zoom === '2', J(v1))
  await page.evaluate((id) => localStorage.setItem(`copymanga.gal.view.${id}`, JSON.stringify({ still: { zoom: 1.25, cx: 0.5, cy: 0.5 } })), itemId)
  await open()
  const v2 = await views()
  check('按媒体存过画面放大（still 1.25）→ 本地优先', v2.zoom === '1.25', J(v2))
  check('没有页面错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  server.kill()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
