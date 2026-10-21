#!/usr/bin/env node
// 浏览器自测：点标签用新标签页（#/library?… 路由）+ 卡片悬停预览。需要 Playwright：
//   NODE_PATH=<含 @playwright/test 的 node_modules> node scripts/dev/fe-library-route-selftest.mjs
// 自己起临时服务、造几个压缩包图集条目，不需要任何外部依赖。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArchiveGalleryHandler } from '../../web/library/types/archive-gallery.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test'))
} catch {
  console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH 指向它，或把它装进 NODE_PATH')
  process.exit(2)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 数据：6 个条目。A 有预览（预览文件在盘上）；D 标了 ready 但预览文件不在（悬停 404）；B/C/E/F 没有
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-route-'))
const cfg = { archiveCacheDir: path.join(dataDir, 'c'), mediaImportProfiles: { 'archive-gallery': { managedDir: path.join(dataDir, 'm') } }, mediaImportSourceRoots: '/input' }
const handler = createArchiveGalleryHandler({ type: 'archive', dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async () => false, getConfig: () => cfg })
const { internals } = handler
const ids = {}
for (const [i, name] of ['A有预览', 'B迁移封面', 'C普通', 'D预览文件丢了', 'E普通', 'F普通'].entries()) {
  const id = createHash('sha1').update(name).digest('hex')
  ids[name[0]] = id
  await internals.writeItem(internals.buildItem({ itemId: id, title: name, tags: [`标签:共用`, `社团:社团${i % 2}`], zipPath: `/x/${name}.zip`, external: true, size: 1, mtimeMs: 1, pageCount: 3, sourceProfile: 'archive-gallery', createdAt: new Date(1.7e12 + i * 1000).toISOString(), cover: name[0] === 'C' || name[0] === 'E' || name[0] === 'F' ? '' : internals.thumbnailUrl(id) }))
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
for (const key of ['A', 'B', 'D']) {
  await mkdir(path.dirname(internals.paths.thumbPath(ids[key])), { recursive: true })
  await writeFile(internals.paths.thumbPath(ids[key]), png)
}
await writeFile(internals.paths.previewPath(ids.A), png)   // A 的预览文件在（内容是个 1x1 图，浏览器能解出来）
for (const key of ['A', 'D']) {
  await internals.updateItem(ids[key], (item) => ({ ...item, mediaUnits: [{ ...item.mediaUnits[0], thumbnail: { status: 'ready', coverUrl: internals.thumbnailUrl(ids[key]), previewUrl: internals.thumbnailUrl(ids[key], 'preview') } }] }))
}

const port = 8099
const base = `http://127.0.0.1:${port}`
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
for (let i = 0; i < 100; i++) { const p = await (await fetch(`${base}/api/library/items?type=archive&page=1&limit=1`)).json(); if (p.index.status === 'ready') break; await sleep(200) }
// 写标签库（标签管理页读它）
for (const [i, name] of ['A', 'B', 'C', 'D', 'E', 'F'].entries()) await post(`/api/library/items/archive/${ids[name]}/tags`, { tags: ['标签:共用', `社团:社团${i % 2}`] })
const setConfig = (value) => post('/api/config', value)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const requested = []
context.on('request', (r) => { if (/\/thumbnail\/zip\/preview/.test(r.url())) requested.push(r.url()) })
const evalVal = (p, sel) => p.$eval(sel, (e) => e.value)

async function openLibrary(p, hash = '') {
  await p.goto(`${base}/${hash}`)
  if (!hash.startsWith('#/library')) await p.click('[data-view="library-view"]')
  await p.waitForSelector('#library-items .card')
  await p.waitForTimeout(400)
}
const cardOf = (p, prefix) => p.locator('#library-items .card', { hasText: prefix }).first()
async function clickPillAndWaitNewPage(modifiers = []) {
  const popupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
  await cardOf(page, 'C普通').locator('.tag-pill[data-tag="社团:社团0"]').click({ modifiers })
  return popupPromise
}

// 主标签页：先选类型 archive，并往 localStorage 里留一份状态（后面验证新标签页不会读它、也不会写它）
await openLibrary(page)
await page.evaluate(() => { const s = document.querySelector('#library-type'); s.value = 'archive'; s.dispatchEvent(new Event('change')) })
await page.waitForTimeout(800)

// ---- 1. 默认配置（一个都没勾）：普通点击留在当前标签页
let popup = await clickPillAndWaitNewPage()
await page.waitForTimeout(600)
check('默认（没勾任何类型）：普通点击标签，在当前标签页搜索，不开新标签页', !popup && (await evalVal(page, '#library-tag-search')).includes('社团:社团0'), String(popup))
// ---- 2. Ctrl 点击：一律新标签页
await page.fill('#library-tag-search', '')
await page.evaluate(() => { const s = document.querySelector('#library-type'); s.value = 'archive'; s.dispatchEvent(new Event('change')) })
await page.waitForTimeout(900)
// 主标签页自己此刻的搜索状态（它自己改条件会保存；下面只验证「新标签页」不会去动它）
const stateBefore = await page.evaluate(() => localStorage.getItem('copymanga.library.state'))
popup = await clickPillAndWaitNewPage(['Control'])
check('Ctrl 点击标签：开新标签页', !!popup)
if (popup) {
  const url = new URL(popup.url())
  check('新标签页 URL 是 #/library?… 且带 tab=new、类型和标签条件', url.hash.startsWith('#/library?') && url.hash.includes('tab=new') && url.hash.includes('type=archive') && decodeURIComponent(url.hash).includes('tag:"社团:社团0"'), url.hash)
  await popup.waitForSelector('#library-items .card'); await popup.waitForTimeout(600)
  check('新标签页：落在媒体库页，搜索框和类型被反填', await popup.$eval('#library-view', (e) => e.classList.contains('active')) && (await evalVal(popup, '#library-tag-search')) === 'tag:"社团:社团0"' && (await evalVal(popup, '#library-type')) === 'archive')
  const titles = await popup.$$eval('#library-items .card .card-title', (els) => els.map((e) => e.textContent))
  check('新标签页：列表确实是按这个标签筛出来的（社团0 的 3 个）', titles.length === 3 && titles.every((t) => ['A有预览', 'C普通', 'E普通'].includes(t)), JSON.stringify(titles))
  // 新标签页里改条件，不写 localStorage
  await popup.evaluate(() => { const s = document.querySelector('#library-sort'); s.value = 'title_asc'; s.dispatchEvent(new Event('change')) })
  await popup.waitForTimeout(800)
  const stateAfterNewTab = await page.evaluate(() => localStorage.getItem('copymanga.library.state'))
  check('新标签页（tab=new）改了排序：localStorage 里的搜索状态没被动', stateAfterNewTab === stateBefore, `${stateBefore} -> ${stateAfterNewTab}`)
  await popup.close()
}
// ---- 3. 缺省 = 缺省值，不读 localStorage
const fresh = await context.newPage()
await fresh.goto(`${base}/#/library?tab=new&tag=${encodeURIComponent('tag:"标签:共用"')}`)
await fresh.waitForSelector('#library-items .card'); await fresh.waitForTimeout(600)
check('路由缺省的字段用缺省值，不读 localStorage 里存的 archive/排序等状态（类型 all、排序 imported_desc、每页 20）', (await evalVal(fresh, '#library-type')) === 'all' && (await evalVal(fresh, '#library-sort')) === 'imported_desc' && (await evalVal(fresh, '#library-limit')) === '20', `${await evalVal(fresh, '#library-type')} ${await evalVal(fresh, '#library-sort')} ${await evalVal(fresh, '#library-limit')}`)
await fresh.close()
// ---- 4. 按类型配置
await setConfig({ tagSearchOpenInNewTabKinds: ['video'] })
await page.reload(); await openLibrary(page)
await page.evaluate(() => { const s = document.querySelector('#library-type'); s.value = 'archive'; s.dispatchEvent(new Event('change')) }); await page.waitForTimeout(800)
await page.fill('#library-tag-search', '')
popup = await clickPillAndWaitNewPage()
check('只勾了「视频」：图集条目里的标签普通点击仍在当前标签页', !popup)
await setConfig({ tagSearchOpenInNewTabKinds: ['image-gallery'] })
await page.reload(); await openLibrary(page)
await page.evaluate(() => { const s = document.querySelector('#library-type'); s.value = 'archive'; s.dispatchEvent(new Event('change')) }); await page.waitForTimeout(800)
await page.fill('#library-tag-search', '')
popup = await clickPillAndWaitNewPage()
check('勾了「图集」：图集条目里的标签普通点击就开新标签页', !!popup && popup.url().includes('tab=new'))
check('开新标签页时当前标签页的搜索框没被改', (await evalVal(page, '#library-tag-search')) === '')
await popup?.close()
// ---- 5. 详情页里的标签（类型取自章节）
await cardOf(page, 'C普通').locator('.library-units-go').click(); await page.waitForTimeout(1200)
const detailPopupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
await page.locator('.library-detail-main .tag-pill[data-tag="标签:共用"]').first().click()
const detailPopup = await detailPopupPromise
check('详情页里的标签（类型取自第一个章节 = 图集）：按配置开新标签页', !!detailPopup)
await detailPopup?.close()
// ---- 6. 标签管理页：只响应 Ctrl 点击
await page.click('[data-view="tag-manager-view"]'); await page.waitForSelector('#tag-manager-tags .card'); await page.waitForTimeout(400)
let tmPopupPromise = context.waitForEvent('page', { timeout: 3000 }).catch(() => null)
await page.locator('#tag-manager-tags .card', { hasText: '标签:共用' }).first().click()
check('标签管理页：普通点击不受配置影响，在当前标签页搜索（即使勾了图集）', !(await tmPopupPromise) && await page.$eval('#library-view', (e) => e.classList.contains('active')))
await page.click('[data-view="tag-manager-view"]'); await page.waitForSelector('#tag-manager-tags .card')
tmPopupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
await page.locator('#tag-manager-tags .card', { hasText: '标签:共用' }).first().click({ modifiers: ['Control'] })
const tmPopup = await tmPopupPromise
check('标签管理页：Ctrl 点击开新标签页', !!tmPopup && tmPopup.url().includes('tab=new'))
await tmPopup?.close()

// ---- 7. 悬停预览：只有 hasPreview 的卡片才请求预览
await setConfig({ tagSearchOpenInNewTabKinds: [] })
await page.goto(`${base}/`); await page.click('[data-view="library-view"]'); await page.waitForSelector('#library-items .card'); await page.waitForTimeout(600)
await page.evaluate(() => { const s = document.querySelector('#library-limit'); s.value = '50'; s.dispatchEvent(new Event('change')) }); await page.waitForTimeout(800)
requested.length = 0
const coverOf = (prefix) => cardOf(page, prefix).locator('.library-card-cover')
const hoverCover = async (prefix) => { const c = coverOf(prefix); await c.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await c.hover() }   // 先滚到位：滚动会关掉放大层
const popSrc = () => page.evaluate(() => { const p = document.querySelector('.cover-hover-popover'); return p && !p.hidden ? p.querySelector('img')?.getAttribute('src') : null })
await hoverCover('B迁移封面'); await page.waitForTimeout(800)
check('没有预览的卡片（只有迁移带来的封面）：悬停放大层显示封面，不发预览请求', !requested.some((u) => u.includes(ids.B)) && /\/cover$/.test(await popSrc() || ''), JSON.stringify(requested))
check('卡片内的封面图不被替换', /\/cover$/.test(await cardOf(page, 'B迁移封面').locator('img.cover').getAttribute('src')))
await hoverCover('A有预览'); await page.waitForTimeout(900)
check('有预览的卡片：悬停请求预览，放大层显示预览图', requested.some((u) => u.includes(ids.A)) && /\/preview$/.test(await popSrc() || ''))
check('卡片内的封面图仍是封面', /\/cover$/.test(await cardOf(page, 'A有预览').locator('img.cover').getAttribute('src')))
await page.mouse.move(2, 2); await page.waitForTimeout(300)
check('移开：放大层隐藏', (await popSrc()) === null)
const dBefore = requested.filter((u) => u.includes(ids.D)).length
await hoverCover('D预览文件丢了'); await page.waitForTimeout(900)
check('hasPreview 为真但预览文件丢了（404）：放大层回退到封面', /\/cover$/.test(await popSrc() || '') && requested.filter((u) => u.includes(ids.D)).length === dBefore + 1, JSON.stringify([await popSrc(), requested.filter((u) => u.includes(ids.D)).length, dBefore]))
await page.mouse.move(2, 2); await page.waitForTimeout(300)
await hoverCover('D预览文件丢了'); await page.waitForTimeout(800)
check('同一张卡片再悬停：不重复请求预览（记住了缺失）', requested.filter((u) => u.includes(ids.D)).length === dBefore + 1)
await page.mouse.move(2, 2)
await hoverCover('C普通'); await page.waitForTimeout(800)
check('没有封面的卡片（占位）：不弹放大层', (await popSrc()) === null)
check('没有页面错误', errors.length === 0, errors.join(' | '))

await browser.close()
server.kill('SIGTERM')
await rm(dataDir, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
