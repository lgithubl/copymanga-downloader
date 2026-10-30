#!/usr/bin/env node
// 自测：列表卡片的悬停轮播（thumbRender.inner）——真实服务端流程 + 真浏览器：导入时开 inner → 卡片带 renders → 鼠标悬停卡片 → 封面图真的在换（blob 图 / 渲染图）。
//   node scripts/dev/fe-gal-carousel-selftest.mjs      PLAYWRIGHT_PATH=<@playwright/test> 再加上浏览器（合成数据：AdvHD 的小游戏，1×1 的图）
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAdvhdFixture } from './make-advhd-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-carousel-'))
const media = path.join(work, 'Lovey-dovey Part-time')
await buildAdvhdFixture(media)

const require = createRequire(import.meta.url)
let chromium = null
try { ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')) } catch { /* 没有 playwright：只做 HTTP 部分 */ }
const port = 8152
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
    form.set('profileOptions', JSON.stringify({ adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' }, thumbRender: { inner: true, innerMax: 4, innerRenders: 3 } } })); form.set('metadataActionIds', 'gal-layout')
    const imported = await (await fetch(`${base}/api/library/items?type=gal`, { method: 'POST', body: form })).json()
    const itemId = imported.items[0].itemId
    let full = null
    for (let i = 0; i < 80; i++) { full = await (await fetch(`${base}/api/library/items/gal/${itemId}`)).json(); if (full.config?.script?.id === 'gal-layout') break; await sleep(300) }
    check('导入后 config.thumbRender.inner = true（gal-layout 没有把它改掉）', full.config?.thumbRender?.inner === true, J(full.config?.thumbRender))
    const reader = async (sectionId) => (await (await fetch(`${base}/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(sectionId)}`)).json())
    const home = await reader('')
    const rio1 = home.node.items.find((i) => i.title === 'Rio1')
    const dirNode = (await reader(rio1.node)).node
    const card = dirNode.items.find((i) => i.title === '001_00')
    console.log('card', J({ thumb: card.thumb, thumbs: card.thumbs, render: card.render, renders: card.renders, ruleCover: card.ruleCover, carousel: card.carousel }))
    check('服务端：001_00 的卡片总共有 ≥ 2 张图（renders + thumbs）', (card.renders?.length || 0) + (card.thumbs?.length || 0) >= 2, J(card))
    if (!chromium) console.log('SKIP 没有 @playwright/test：跳过浏览器部分')
    else {
      const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        await ctx.addInitScript(() => localStorage.setItem('copymanga.immersivePref', JSON.stringify({ gal: false })))
        const page = await ctx.newPage()
        page.setDefaultTimeout(15000)
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        const reqs = []
        page.on('response', (r) => { if (/render-thumb|thumbnail|resource/.test(r.url())) reqs.push(`${r.status()} ${decodeURIComponent(r.url()).slice(-70)}`) })
        await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(rio1.node)}`)
        await page.waitForSelector('.gal-card.is-script')
        await sleep(2500)   // 先让封面（渲染图）出来
        const imgSrc = () => page.$eval('.gal-card.is-script img', (i) => i.getAttribute('src') || '')
        const before = await imgSrc()
        const extraKey = card.renders?.[1]?.key
        check('不用悬停：卡片进了屏幕、空闲后就已经去取第 2 张轮播图（预渲染）', Boolean(extraKey) && reqs.some((r) => r.includes(extraKey.slice(0, 12)) || r.includes(extraKey.slice(-12))), J([extraKey, reqs]))
        check('卡片右下角有「轮播 N 张」角标（N ≥ 2）', /^轮播 [2-9]\d* 张$/.test(await page.$eval('.gal-card.is-script .gal-card-carousel', (e) => e.textContent).catch(() => '')), '')
        check('封面图还在（没有被「加载失败」的备用链删掉）', Boolean(await page.$('.gal-card.is-script .gal-card-thumb img')), '')
        await page.hover('.gal-card.is-script')
        const seen = new Set([before])
        for (let i = 0; i < 40; i++) { await sleep(250); seen.add(await imgSrc()) }
        console.log('图片地址序列', J([...seen].map((x) => x.slice(0, 80))))
        console.log('请求', J(reqs.slice(-12)))
        check('悬停卡片 10 秒内，封面 <img> 的地址至少换过一次（轮播真的在动）', seen.size >= 2, J([...seen].map((x) => x.slice(0, 80))))
        check('没有页面错误', errors.length === 0, J(errors))
      } finally { await browser.close() }
    }
  }
} finally { server?.kill() }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
