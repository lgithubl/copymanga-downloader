#!/usr/bin/env node
// 自测（纯 node）：Kamihime 的角色头像（dmm/portrait）——gal-layout 要把 dmm/assets 和 dmm/portrait 两个资源根都写进 config（以前只写第一个，
// 头像路径 game/dmm/portrait/(称号)名.png 解析不了，目录卡片 404「加载失败」），目录卡片的头像能真的取到。
//   node scripts/dev/gal-kamihime-portrait-selftest.mjs      需要 ImageMagick（make-kamihime-fixture 用）
import { copyFile, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../../scripts/tag-scripts/gal-layout/main.js'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { resolveOnDisk } from '../../web/library/gal/resolve.mjs'
import { buildKamihimeFixture } from './make-kamihime-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const media = path.join(await realpath(await mkdtemp(path.join(os.tmpdir(), 'kami-portrait-'))), 'Kamihime_Player- 1.0')
await buildKamihimeFixture(media)
const dmm = path.join(media, 'game', 'dmm')
const dirName = '[愛及屋烏]エレシュキガル'
const sceneDir = path.join(dmm, 'raw_scenario', 'kamihime_SSR', dirName)
await mkdir(sceneDir, { recursive: true })
const from = path.join(dmm, 'raw_scenario', 'eidolon', 'MB01_花')
await copyFile(path.join(from, '9101_harem-summon_script.ks'), path.join(sceneDir, '9301_harem-summon_script.ks'))
await copyFile(path.join(from, '9101_harem-summon.json'), path.join(sceneDir, '9301_harem-summon.json'))
await mkdir(path.join(dmm, 'portrait'), { recursive: true })
await writeFile(path.join(dmm, 'portrait', '(愛及屋烏)エレシュキガル.png'), 'png')

const out = await generateTags({ item: { itemId: 'k', title: 'k', config: { game: { id: 'kamihime' } }, source: { path: media }, adapters: ['tyrano-ks'] }, script: { id: 'gal-layout', version: '2.26.0', options: {} } })
const raw = out.itemPatch?.gal?.config || out.itemPatch?.config
check('gal-layout：resourceRoots 两个都写（game/dmm/assets、game/dmm/portrait）', J(raw.resourceRoots) === J(['game/dmm/assets', 'game/dmm/portrait']), J(raw.resourceRoots))
const config = normalizeGalConfig(raw)
const resolveAsset = async (rel) => {
  const hit = await resolveOnDisk({ work: media, rootRels: config.resourceRoots, variants: [rel], cfg: config.resourceResolve })
  if (hit) return hit
  throw Object.assign(new Error('资源不存在'), { code: 'ENOENT', statusCode: 404 })
}
const provider = createBrowseProvider({ mediaDir: media, adapters: ['tyrano-ks'], resolveAsset, config })
const home = (await provider.getNode('')).node
const cat = home.items.find((i) => i.title === 'kamihime_SSR')
const list = (await provider.getNode(cat.node)).node.items
const card = list.find((i) => i.title === dirName)
check('目录卡片（角色）有头像路径，而且是相对资源根的（不带 game/dmm/portrait/ 前缀）', card && /^\(愛及屋烏\)エレシュキガル\.png$/.test(card.thumb || ''), J(card))
let resolved = ''
try { resolved = await resolveAsset(card.thumb) } catch (error) { resolved = `ERR ${error.message}` }
check('这个头像路径真的能解析成磁盘上的文件（以前 404）', resolved.endsWith(path.join('portrait', '(愛及屋烏)エレシュキガル.png')), resolved)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
