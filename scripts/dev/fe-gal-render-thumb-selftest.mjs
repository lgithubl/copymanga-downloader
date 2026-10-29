#!/usr/bin/env node
// 浏览器自测：渲染缩略图（骨骼 / 视频场景的列表封面）。
//   · 服务端：脚本里有骨骼、规则没给图 → 卡片带 render.key；视频 → 兜底取 movie（prefer 里的 movie）；key 随脚本改动而变
//   · 浏览器：列表页缓存没有（404）→ 离屏渲染（背景 + 真实 WebGL 骨骼）→ PUT 回服务器；再进列表直接取缓存图（不再渲染）
//   · 并发：同一时刻最多 1 个离屏渲染容器；失败（骨骼取不到）：不缓存、卡片仍显示兜底图，下次重建页面会再试
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-render-thumb-selftest.mjs
import { spawn } from 'node:child_process'
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGirlsCreationFixture } from './make-girlscreation-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH'); process.exit(2) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-rt-'))
const media = path.join(dataDir, 'gal', 'gc演示')
await buildGirlsCreationFixture(media)
const scenes = path.join(media, 'package.nw', 'scenes')
// 4 个带骨骼的场景（克隆 chmr_40101001），都去掉 thumbnail.png → 规则没图 → 要渲染
const clones = ['chmr_40101011', 'chmr_40101012', 'chmr_40101013', 'chmr_40101014']
for (const id of clones) await cp(path.join(scenes, 'chmr_40101001'), path.join(scenes, id), { recursive: true })
for (const id of ['chmr_40101001', ...clones]) await rm(path.join(scenes, id, 'thumbnail.png'), { force: true })
const port = 8195
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }

let browser
try {
  const form = new FormData()
  form.set('importProfile', 'gal-import'); form.set('sourcePath', media)
  form.set('profileOptions', JSON.stringify({ adapters: ['girlscreation-tag'], config: { game: { id: 'girlscreation' }, dirCover: { enabled: true, scan: 6, max: 3, prefer: ['render', 'image'] } } })); form.set('metadataActionIds', 'gal-layout')
  const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
  const itemId = imported.items[0].itemId
  for (let i = 0; i < 60; i++) { const full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
  const api = `${base}/api/library/items/gal/${itemId}`
  const reader = async (s) => (await (await fetch(`${api}/reader/main?sectionId=${encodeURIComponent(s)}`)).json())
  // 找到放着这几个场景的列表节点
  let listNode = ''
  let items = []
  const walk = async (nodeId) => {
    const r = await reader(nodeId)
    const scripts = r.node.items.filter((i) => i.type === 'script')
    if (scripts.some((i) => i.render)) { listNode = nodeId; items = r.node.items; return true }
    for (const it of r.node.items.filter((i) => i.type !== 'script')) if (await walk(it.node)) return true
    return false
  }
  await walk('')
  // 目录卡片（文件系统列表，不是 catalog）：规则没给图时，dirCover（enabled: true）用里面脚本的渲染图当封面，render.node 指向那个脚本
  const topDirs = (await reader('')).node.items.filter((i) => i.type === 'dir')
  const dirWithRender = topDirs.find((d) => d.render?.node)
  check('目录卡片（文件系统列表）：dirCover 开着 → 里面有骨骼渲染场景的目录卡片带 render（node = 里面那个脚本，key 合法）、carousel = max（3）', Boolean(dirWithRender) && /^[0-9a-f]{40}$/.test(dirWithRender.render.key) && /^s:/.test(dirWithRender.render.node) && dirWithRender.carousel === 3, J(topDirs.map((d) => [d.title, d.render, d.carousel])))
  const rendered = items.filter((i) => i.render)
  check('服务端：有骨骼、规则没给图的脚本卡片带 render.key（5 个）；有 thumbnail.png 的不带', rendered.length >= 4 && items.every((i) => !i.render || /^[0-9a-f]{40}$/.test(i.render.key)), J(items.map((i) => [i.title, !!i.render])))
  check('服务端：渲染缓存还没有 → GET render-thumb 404；key 不合法 → 400；PUT 非 JPEG → 415', (await fetch(`${api}/render-thumb?key=${rendered[0].render.key}`)).status === 404 && (await fetch(`${api}/render-thumb?key=zz`)).status === 400 && (await fetch(`${api}/render-thumb?key=${rendered[0].render.key}`, { method: 'PUT', body: Buffer.alloc(500, 1) })).status === 415, '')

  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
  const open = async ({ blockSkel = false } = {}) => {
    const page = await ctx.newPage()
    page.setDefaultTimeout(30000)
    const log = { puts: [], gets: [], maxHosts: 0, errors: [] }
    page.on('pageerror', (e) => log.errors.push(e.message))
    page.on('request', (r) => { if (/render-thumb/.test(r.url())) (r.method() === 'PUT' ? log.puts : log.gets).push(r.url()) })
    if (blockSkel) await page.route('**/resource?path=*.skel*', (route) => route.abort())
    await page.exposeFunction('__hosts', (n) => { log.maxHosts = Math.max(log.maxHosts, n) })
    await page.addInitScript(() => setInterval(() => window.__hosts?.(document.querySelectorAll('.gal-thumb-host').length), 20))
    await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(listNode)}`)
    await page.waitForSelector('.gal-card.is-script')
    return { page, log }
  }
  const imgSrcs = (page) => page.$$eval('.gal-card.is-script', (cards) => cards.map((c) => [c.dataset.title, c.querySelector('img')?.getAttribute('src') || '', c.querySelector('img')?.hidden || false]))
  const cacheFiles = async () => { try { const all = []; for (const d of await readdir(path.join(dataDir, 'cache', 'gal-render-thumbs'))) all.push(...await readdir(path.join(dataDir, 'cache', 'gal-render-thumbs', d))); return all } catch { return [] } }

  // ---- 0. 选哪一步：CG 优先 ----
  {
    const page = await ctx.newPage()
    await page.goto(`${base}/health`)
    const picks = await page.evaluate(async () => {
      const { pickRenderStep } = await import('/gal-thumb-render.js')
      const bg = (src, over) => ({ op: 'bg', src, ...(over ? { over } : {}) })
      const chara = { op: 'spine', slot: 'A', kind: 'actor', skel: 'a.skel', atlas: 'a.atlas' }
      const still = { op: 'spine', slot: 'still0', kind: 'still', skel: 's.skel', atlas: 's.atlas' }
      const text = { op: 'text', segments: [{ text: 'x' }] }
      const mk = (steps) => ({ steps: steps.map((commands, index) => ({ index, commands })) })
      const r = (scene) => { const p = pickRenderStep(scene, 150); return p ? [p.index, p.score] : null }
      return {
        onlyBg: r(mk([[bg('a.png'), text], [text]])),
        chara: r(mk([[bg('a.png'), text], [chara, text], [text], [text], [text]])),
        stillBeatsChara: r(mk([[bg('a.png'), chara, text], [text], [text], [still, text]])),
        evBeatsAll: r(mk([[bg('a.png'), chara, text], [still, text], [bg('a.png', 'ev.png'), text]])),
        farStill: r(mk([[bg('a.png'), chara, text], ...Array.from({ length: 300 }, () => [text]), [still, text]])),
      }
    })
    check('选帧：纯背景 → 不渲染（null）；有角色（第 1 步出现）→ 往后推 2 步 = 第 3 步（分 30）', picks.onlyBg === null && picks.chara[1] === 30 && picks.chara[0] === 3, JSON.stringify(picks))
    check('选帧：静态画面骨骼（still，90）比角色画面优先，CG（bg.over，100）比 still 优先；很靠后（300 步以后）的 CG 也找得到', picks.stillBeatsChara[1] === 90 && picks.stillBeatsChara[0] === 3 && picks.evBeatsAll[1] === 100 && picks.evBeatsAll[0] === 2 && picks.farStill[1] === 90 && picks.farStill[0] === 301, JSON.stringify(picks))
    await page.close()
  }
  // ---- 1. 第一次：缓存没有 → 渲染 → 上传 ----
  {
    const { page, log } = await open()
    await page.waitForFunction((n) => [...document.querySelectorAll('.gal-card.is-script img')].filter((i) => i.src.startsWith('blob:')).length >= n, rendered.length, { timeout: 90000 })
    await sleep(500)
    const srcs = await imgSrcs(page)
    check(`第一次进列表：${rendered.length} 张骨骼卡片都渲染出了图（blob），并全部传回服务器缓存`, rendered.every((r) => srcs.find((s) => s[0] === r.title)?.[1].startsWith('blob:')) && log.puts.length >= rendered.length && (await cacheFiles()).length >= rendered.length, J([srcs, log.puts.length, await cacheFiles()]))
    check('并发：同一时刻最多 1 个离屏渲染容器（队列一个个来）', log.maxHosts === 1, String(log.maxHosts))
    const px = await page.evaluate(async (title) => {
      const img = [...document.querySelectorAll('.gal-card.is-script')].find((c) => c.dataset.title === title).querySelector('img')
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`)
      return { w: c.width, h: c.height, colors: seen.size }
    }, rendered[0].title)
    check('渲染出来的图是 640×360、有内容（不是纯色）：背景 + 骨骼', px.w === 640 && px.h === 360 && px.colors > 3, J(px))
    check('没有页面错误', log.errors.length === 0, J(log.errors))
    await page.close()
  }
  // ---- 2. 第二次：命中缓存，直接取图，不再渲染 / 上传 ----
  {
    const { page, log } = await open()
    await page.waitForFunction((n) => [...document.querySelectorAll('.gal-card.is-script img')].filter((i) => /render-thumb/.test(i.src) && i.complete && i.naturalWidth > 0).length >= n, rendered.length, { timeout: 30000 })
    check('再进列表：直接用服务器缓存图（render-thumb 200），没有再 PUT', log.puts.length === 0 && log.maxHosts === 0, J([log.puts.length, log.maxHosts]))
    await page.close()
  }
  // ---- 3. 失败：骨骼取不到 → 不缓存、卡片仍有兜底图；解除后重建页面会再试 ----
  { const f = await cacheFiles(); if (process.env.SHOT_DIR && f[0]) { const { copyFile, mkdir } = await import('node:fs/promises'); await mkdir(process.env.SHOT_DIR, { recursive: true }); await copyFile(path.join(dataDir, 'cache', 'gal-render-thumbs', f[0].slice(0, 2), f[0]), path.join(process.env.SHOT_DIR, 'render-thumb.jpg')) } }
  await rm(path.join(dataDir, 'cache', 'gal-render-thumbs'), { recursive: true, force: true })
  {
    const { page, log } = await open({ blockSkel: true })
    await sleep(6000)
    const srcs = await imgSrcs(page)
    check('骨骼取不到：渲染失败不缓存（没有 PUT、缓存目录是空的），卡片显示兜底图（背景），不是空白', log.puts.length === 0 && (await cacheFiles()).length === 0 && rendered.every((r) => { const s = srcs.find((x) => x[0] === r.title); return s && !s[1].startsWith('blob:') && /abg|resource/.test(s[1]) && !s[2] }), J([srcs, log.puts.length]))
    check('渲染失败不留容器（离屏渲染容器都销毁了）', (await page.$$('.gal-thumb-host')).length === 0, '')
    await page.close()
  }
  {
    const { page, log } = await open()
    await page.waitForFunction((n) => [...document.querySelectorAll('.gal-card.is-script img')].filter((i) => i.src.startsWith('blob:')).length >= n, rendered.length, { timeout: 90000 })
    await sleep(500)
    check('重建页面：之前失败的会再试，这次成功并缓存', log.puts.length >= rendered.length && (await cacheFiles()).length >= rendered.length, J([log.puts.length, await cacheFiles()]))
    await page.close()
  }
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.message.split('\n')[0]} @ ${(error.stack || '').split('\n').find((l) => l.includes('render-thumb-selftest')) || ''}`)
} finally {
  await browser?.close()
  server.kill()
  await rm(dataDir, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
