#!/usr/bin/env node
// 浏览器自测：E-mote 立绘（Artemis）——默认开：E-mote 画布出画；「更多」里的开关关掉 = 画布清空、回到静态立绘；再打开 = 又出画；没有 E-mote 运行时 / 加载失败时自动用静态立绘。
//   需要：真实的 E-mote 模型（EMOTE_SAMPLE=<已解开 pf8 外层的 .psb>）、emotedriver.dll（EMOTE_DLL）、web/static/vendor/ 里有 FreeMote SDK（sh scripts/fetch-emote-runtime.sh）、Chromium（CHROME）；缺任何一样就 SKIP。
//   PLAYWRIGHT_PATH=<@playwright/test> [CHROME=<chrome>] EMOTE_SAMPLE=… EMOTE_DLL=… node scripts/dev/fe-gal-emote-selftest.mjs
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from '../../web/library/gal/tomoe.mjs'
import { astOf, buildPf8 } from './make-artemis-fixture.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!process.env.EMOTE_SAMPLE || !process.env.EMOTE_DLL || !existsSync(path.join(root, 'web/static/vendor/emoteplayer.js'))) { console.log('SKIP 需要 EMOTE_SAMPLE / EMOTE_DLL / web/static/vendor/emoteplayer.js'); process.exit(0) }
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-emote-'))
const media = path.join(work, 'data', 'gal', 'art', 'game')
await mkdir(media, { recursive: true })
const solid = (r, g, b) => { const px = Buffer.alloc(64 * 64 * 4); for (let i = 0; i < 64 * 64; i++) { px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255 } return encodePng(64, 64, px, 4) }
const blocks = [{ cmds: [['fg', { mode: 2, ch: '花衣', size: 'no', always: '通常待機', file: 'kae_2', path: ':fg/', face: '笑顔Ａ', x: 200, lv: 3, id: 1 }]], text: { name: ['花衣'], lines: ['こんにちは'] } }, { text: { lines: ['つづき'] } }]
await writeFile(path.join(media, 'game.pfs'), buildPf8([{ name: 'script/a.ast', data: Buffer.from(astOf(blocks)) }]))
await writeFile(path.join(media, 'game.pfs.000'), buildPf8([{ name: 'image/fg/kae_2.psb', data: readFileSync(process.env.EMOTE_SAMPLE) }, { name: 'image/fg/_blog/kae_2/笑顔Ａ.png', data: solid(255, 0, 255) }]))
await copyFile(process.env.EMOTE_DLL, path.join(media, 'emotedriver.dll'))
await writeFile(path.join(media, 'game.exe'), 'MZ')
const port = 8124
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: path.join(work, 'data'), PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
let browser
try {
  const api = async (p, init) => { const r = await fetch(base + p, init); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
  const form = new FormData(); form.set('title', 'art'); form.set('importProfile', 'gal-import'); form.set('metadataActionIds', 'gal-layout')
  form.set('profileOptions', JSON.stringify({ rootDir: path.dirname(media), adapters: ['artemis::ast'], defaultMetadataActions: ['gal-layout'], dryRun: false }))
  const id = (await api('/api/library/items?type=gal', { method: 'POST', body: form })).items[0].itemId
  await sleep(6000)
  const rd = (s) => api(`/api/library/items/gal/${id}/reader/main${s ? `?sectionId=${encodeURIComponent(s)}` : ''}`)
  const home = await rd('')
  const dir = await rd(home.node.items[0].node)
  const sec = dir.node.items[0].node
  const scene = (await rd(sec)).scene
  const standCmd = scene.steps.flatMap((s) => s.commands).find((c) => c.op === 'stand')
  check('场景：stand 部件带 emote（slot / src / main / diff），stats.emote.resolved = 1', standCmd?.parts?.[0]?.emote?.src === 'image/fg/kae_2.emote.psb' && standCmd.parts[0].emote.diff === '笑顔Ａ' && scene.stats.emote?.resolved === 1, J([standCmd, scene.stats.emote]))
  const psb = await fetch(`${base}/api/library/items/gal/${id}/resource?path=${encodeURIComponent('image/fg/kae_2.emote.psb')}`)
  const bytes = Buffer.from(await psb.arrayBuffer())
  check('资源：.emote.psb 取得到（转好的纯 PSB：魔数 PSB、头标志 0）', psb.status === 200 && bytes.toString('latin1', 0, 4) === 'PSB\0' && bytes.readUInt16LE(6) === 0, `${psb.status} ${bytes.length}`)

  browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/media/gal/${id}/main?section=${encodeURIComponent(sec)}`)
  await page.waitForSelector('.gal-player .gal-stage')
  await sleep(2000)
  const count = async () => Number((await page.$eval('.gal-count', (e) => e.textContent)).split('/')[0]) - 1
  const standStep = scene.steps.findIndex((s) => s.commands.some((c) => c.op === 'stand'))
  for (let g = 0; (await count()) < standStep && g < 50; g++) { await page.keyboard.press('ArrowRight'); await sleep(100) }
  const opaque = (sel) => page.evaluate((s) => { const c = document.querySelector(s); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < d.length; k += 4000) if (d[k]) n++; return n }, sel)
  const waitOpaque = async (sel, min) => { for (let i = 0; i < 40; i++) { if ((await opaque(sel)) >= min) return true; await sleep(250) } return false }
  check('默认开：E-mote 画布出画（有不透明像素）', await waitOpaque('.gal-emote', 50), String(await opaque('.gal-emote')))
  await sleep(500)
  check('默认开：静态立绘那张（紫色方块）不再画——E-mote 接管', (await opaque('.gal-stand')) === 0, String(await opaque('.gal-stand')))
  const row = await page.evaluate(() => { const r = [...document.querySelectorAll('.gal-more-field')].find((x) => /E-mote/.test(x.textContent)); return r ? { hidden: r.hidden, checked: r.querySelector('input').checked } : null })
  check('设置里有「E-mote 立绘」开关：显示、默认勾选', row && !row.hidden && row.checked, J(row))
  const toggle = () => page.evaluate(() => [...document.querySelectorAll('.gal-more-field')].find((x) => /E-mote/.test(x.textContent)).querySelector('input').click())
  await toggle()
  await sleep(1500)
  check('关掉开关：E-mote 画布清空、静态立绘画出来', (await opaque('.gal-emote')) === 0 && (await opaque('.gal-stand')) > 0, J([await opaque('.gal-emote'), await opaque('.gal-stand')]))
  await toggle()
  check('再打开：E-mote 又出画，静态立绘退下', await waitOpaque('.gal-emote', 50) && (await opaque('.gal-stand')) === 0, J([await opaque('.gal-emote'), await opaque('.gal-stand')]))
  check('没有页面错误', errors.length === 0, J(errors.slice(0, 2)))
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message} @ ${(error.stack || '').split('\n')[1] || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
