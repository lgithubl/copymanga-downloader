#!/usr/bin/env node
// 浏览器自测：点媒体库卡片「直接进浏览 / 进目录」由配置 libraryDirectOpenRules 决定（profile? / kind? / unitsBelow），配置页能编辑。
//   PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-direct-open-selftest.mjs
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStyleStressFixture } from './make-style-stress-fixture.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test'))
} catch {
  console.error('需要 @playwright/test：设置 PLAYWRIGHT_PATH')
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
const J = JSON.stringify

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fe-direct-'))
await buildStyleStressFixture(dataDir, 12)
const port = 8108
const base = `http://127.0.0.1:${port}`
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
await fetch(`${base}/api/library/index/rebuild`, { method: 'POST' })
for (let i = 0; i < 100; i++) { const p = await (await fetch(`${base}/api/library/items?page=1&limit=1`)).json(); if (p.index?.status === 'ready' && p.total >= 12) break; await sleep(200) }
const setRules = (rules) => fetch(`${base}/api/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ libraryDirectOpenRules: rules }) })
const getRules = async () => (await (await fetch(`${base}/api/config`)).json()).libraryDirectOpenRules

check('默认规则：monthly-ani / archive-gallery / gal-import，单元数 < 2', J(await getRules()) === J([{ profile: 'monthly-ani', unitsBelow: 2 }, { profile: 'archive-gallery', unitsBelow: 2 }, { profile: 'gal-import', unitsBelow: 2 }]), J(await getRules()))
await setRules([{ profile: 'archive-gallery' }, { profile: 'a b', unitsBelow: 2 }, { unitsBelow: 0 }, { unitsBelow: 1.5 }, { kind: 'text', unitsBelow: 3 }, { kind: 'text', unitsBelow: 3 }, 'x', { profile: 'gal-import', unitsBelow: 2 }])
check('配置规整：缺 unitsBelow / 不合法的字符 / 0 / 小数 / 重复 / 非对象整条丢掉', J(await getRules()) === J([{ kind: 'text', unitsBelow: 3 }, { profile: 'gal-import', unitsBelow: 2 }]), J(await getRules()))
await setRules([{ profile: 'archive-gallery', unitsBelow: 2 }])
await setRules([{ profile: 'archive-gallery', unitsBelow: 2 }])

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.setDefaultTimeout(10000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const dialogs = []
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}) })
const apis = []
page.on('request', (r) => { if (/\/api\/library\/items\/[^/]+\/[^/]+\/reader/.test(r.url())) apis.push(r.url()) })
const open = async () => {
  await page.goto(`${base}/`)
  await page.reload()
  await page.click('[data-view="library-view"]')
  await page.waitForSelector('#library-items .card')
  await sleep(500)
}
const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
// 直接进浏览 = 点卡片后去取了阅读器 / 单元（夹具里的 zip 是假的，真去打开会报错弹窗，所以看「有没有去取」而不看有没有真的跳过去）
const jumped = () => apis.length > 0 || dialogs.length > 0
const reset = () => { apis.length = 0; dialogs.length = 0 }
const clickFirstCard = async () => { reset(); await page.click('#library-items .card >> nth=1 >> .library-card-cover'); await sleep(900) }
const backToLibrary = async () => { await page.goto(`${base}/#/library`); await sleep(300) }

await open()
const kind = await page.$eval('#library-items .card >> nth=1', (c) => c.dataset.kind)
await clickFirstCard()
check('规则 archive-gallery < 2：单元数 1 的卡片直接进浏览', jumped(), await hash())

await setRules([])
await open()
await clickFirstCard()
check('规则为空：点卡片进目录（选中条目，不跳转）', !jumped() && await page.$eval('#library-item-title', (e) => e.textContent.trim().length > 0), await hash())

await setRules([{ profile: 'archive-gallery', unitsBelow: 1 }])
await open()
await clickFirstCard()
check('unitsBelow = 1：单元数 1 不小于 1，进目录', !jumped(), await hash())

await setRules([{ kind, unitsBelow: 2 }])
await open()
await clickFirstCard()
check(`只写 kind（${kind}）：命中同类型的条目，直接进浏览`, jumped(), await hash())

await setRules([{ kind: 'video', unitsBelow: 99 }])
await open()
await clickFirstCard()
check('kind 不匹配（video）：进目录', !jumped(), await hash())

await setRules([{ profile: 'archive-gallery', kind, unitsBelow: 2 }])
await open()
await page.click('#library-items .card >> nth=1 >> .library-units-go')
await sleep(700)
check('命中规则时「目录」按钮仍然进目录（不跳转）', !jumped() && await page.$eval('#library-item-title', (e) => e.textContent.trim().length > 0), await hash())

// 配置页：文本框显示规则 / 「添加规则」追加一条 / 保存后生效
await setRules([{ profile: 'archive-gallery', unitsBelow: 2 }])
await open()
await page.click('[data-view="settings-view"]')
await page.waitForSelector('#config-library-direct-open-rules')
const text = await page.$eval('#config-library-direct-open-rules', (e) => e.value)
check('配置页：文本框里是当前规则（JSON 数组）', J(JSON.parse(text)) === J([{ profile: 'archive-gallery', unitsBelow: 2 }]), text)
await page.selectOption('#config-direct-open-pick-profile', 'gal-import')
await page.fill('#config-direct-open-pick-below', '5')
await page.click('#config-direct-open-add')
const added = JSON.parse(await page.$eval('#config-library-direct-open-rules', (e) => e.value))
check('「添加规则」：按下拉和数字追加一条 { profile, unitsBelow }', J(added[1]) === J({ profile: 'gal-import', unitsBelow: 5 }) && added.length === 2, J(added))
await page.click('#config-library-direct-open-rules'); await page.fill('#config-library-direct-open-rules', '[{"profile":"text-media","unitsBelow":3}]')
const saveBtn = page.locator('#settings-view button', { hasText: /^保存/ }).first()
await saveBtn.click(); await sleep(900)
check('保存配置后服务端按新规则生效', J(await getRules()) === J([{ profile: 'text-media', unitsBelow: 3 }]), J(await getRules()))
await page.fill('#config-library-direct-open-rules', '[{"profile":"gal-import"')
await saveBtn.click(); await sleep(400)
check('规则 JSON 写错：保存被拒绝，不会把已有规则清掉', J(await getRules()) === J([{ profile: 'text-media', unitsBelow: 3 }]), J(await getRules()))
void backToLibrary
check('没有页面错误', errors.length === 0, errors.join(' | '))

await browser.close()
server.kill('SIGTERM')
await rm(dataDir, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
