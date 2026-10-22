#!/usr/bin/env node
// 拿一份真实的 Spine 3.8 数据（骨骼 + atlas + 图集 png）过一遍我们的播放器，截图看渲染对不对（方向、网格、IK、纹理有没有错位）。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/spine-sample-check.mjs <放着 *.skel(.bytes) / *.atlas(.txt) / *.png 的目录> [动画名] [输出截图路径]
//   官方示例（spineboy，3.8 分支 examples/spineboy/export）：把 spineboy-pro.skel / spineboy.atlas / spineboy.png 下载到一个目录就行。
// 做法：把它们当作 Spines/9001/9001_01.* 放进一份临时的 tenkeiprdx 素材，造一个站位立绘的剧情，起服务、真实 WebGL 渲染、截图，并读回 canvas 看有没有画出东西。
import { spawn, execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalHandler } from '../../web/library/types/gal.mjs'

const [dir, anim = '', out = '/tmp/spine-sample.png'] = process.argv.slice(2)
if (!dir) { console.error('用法：spine-sample-check.mjs <目录> [动画名] [输出截图]'); process.exit(2) }
const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const names = await readdir(dir)
const skel = names.find((n) => /\.skel(\.bytes)?$/i.test(n))
const atlas = names.find((n) => /\.atlas(\.txt)?$/i.test(n))
if (!skel || !atlas) { console.error('目录里要有 *.skel(.bytes) 和 *.atlas(.txt)'); process.exit(2) }
const work = await mkdtemp(path.join(os.tmpdir(), 'spine-sample-'))
const dataDir = path.join(work, 'data')
const media = path.join(dataDir, 'gal', 'sample')
const spines = path.join(media, 'Spines', '9001')
await mkdir(spines, { recursive: true })
await mkdir(path.join(media, 'scenes'), { recursive: true })
await mkdir(path.join(media, 'Backgrounds/adventure'), { recursive: true })
await copyFile(path.join(dir, skel), path.join(spines, '9001_01.skel.bytes'))
await copyFile(path.join(dir, atlas), path.join(spines, '9001_01.atlas.txt'))
for (const n of names) if (/\.png$/i.test(n)) await copyFile(path.join(dir, n), path.join(spines, n))
execFileSync('convert', ['-size', '160x90', 'gradient:#334-#889', path.join(media, 'Backgrounds/adventure/bg1.png')])
const face = ['idle_normal', 'idle_joy', 'idle_sad', 'idle_angry', 'idle_surprise', 'idle_shy', 'idle_unique'].indexOf(anim)
await writeFile(path.join(media, 'scenes/90010001.json'), JSON.stringify({ result: { sceneDetails: [{ assetId: '90010001', sceneFrameDetails: [{ speakerName: 'Sample', phraseContents: skel, backgroundImage: 'bg1', adventureCharacters: [{ characterMasterId: 9001, characterAppearance: 1, characterPosition: 0, characterAction: 0, characterFacialExpression: face }] }] }] } }))
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media } } }) })
const imp = await handler.importFromSource({ sourcePath: media, options: { adapters: ['tenkeiprdx-json'], config: { game: { id: 'tenkeiprdx' }, scriptRoots: [{ id: 's', dir: 'scenes' }], scriptExtensions: ['json'], resourceRoots: [''], adapterOptions: { 'tenkeiprdx-json': { root: '' } } } } })
const port = 8108
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); break } catch { await new Promise((r) => setTimeout(r, 200)) } }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
let code = 0
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  await page.goto(`http://127.0.0.1:${port}/#/media/gal/${imp.items[0].itemId}/main?section=${encodeURIComponent('s:90010001.json')}`)
  await page.waitForSelector('.gal-player')
  await page.waitForTimeout(3500)
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('.gal-spine')
    if (!c || c.hidden) return -1
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height
    const ctx = g.getContext('2d'); ctx.drawImage(c, 0, 0)
    const d = ctx.getImageData(0, 0, g.width, g.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++
    return n / (g.width * g.height)
  })
  const note = await page.$eval('.gal-note', (e) => e.textContent)
  await page.screenshot({ path: out })
  console.log(`骨骼 ${skel} / ${atlas}；画出的像素占画布 ${(drawn * 100).toFixed(1)}%；提示「${note}」；页面错误 ${JSON.stringify(errors)}；截图 ${out}`)
  if (drawn <= 0 || errors.length) code = 1
} finally {
  await browser.close()
  server.kill()
  await rm(work, { recursive: true, force: true })
}
process.exit(code)
