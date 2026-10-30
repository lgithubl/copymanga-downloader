#!/usr/bin/env node
// 自测（纯 node）：随机排序 + 虚拟目录规则的本地覆盖（请求参数 vr，不写服务端配置）
//   · 随机排序：同一个种子顺序不变（翻页稳定）、换种子换顺序、目录在前各自随机、不丢不重；参数 r 进节点 id
//   · 本地覆盖：name / path / marker 三种匹配；没覆盖 = 布局里的默认规则；写坏的（坏正则 / 太长 / 不认识的视图名）忽略；node.viewRules 给出生效规则、默认规则、命中数、是不是本地的
//   node scripts/dev/gal-view-rules-selftest.mjs
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { createBrowseProvider, galViewSuffix, normalizeViewOverrides, parseGalView } from '../../web/library/gal/browse.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gal-view-rules-')))
const media = path.join(work, 'media')
const mk = async (rel, content = 'x') => { await mkdir(path.dirname(path.join(media, rel)), { recursive: true }); await writeFile(path.join(media, rel), content) }
registerGalAdapter({ id: 'test-vr', label: '测试', sniff: (t) => t.startsWith('#VR'), parse: (t) => ({ steps: JSON.parse(t.slice(3)).map((commands, index) => ({ index, commands })), stats: {} }) })
const body = (hcg) => `#VR${J([[{ op: 'bg', src: 'i/room.png' }], [{ op: 'text', segments: [{ text: 'a' }] }], [{ op: 'bg', src: hcg ? 'i/hcg/x.jpg' : 'i/room2.png' }], [{ op: 'text', segments: [{ text: 'b' }] }], [{ op: 'text', segments: [{ text: 'c' }] }], [{ op: 'text', segments: [{ text: 'd' }] }]])}`
const names = ['001_00', '002_00_H', '003_00_h', '004_00', '005_x_hcg', '006_00']
for (const n of names) await mk(`resources/s/Rio1/${n}.txt`, body(/hcg/.test(n)))
for (let i = 1; i <= 12; i++) await mk(`resources/s/Rio2/${String(i).padStart(2, '0')}.txt`, body(false))
for (let i = 1; i <= 3; i++) await mk(`resources/s/Rio3/sub${i}/a.txt`, body(false))
const resolveAsset = async () => { throw Object.assign(new Error('x'), { code: 'ENOENT', statusCode: 404 }) }
const provider = createBrowseProvider({ mediaDir: media, adapters: ['test-vr'], resolveAsset, config: {
  scriptRoots: [{ id: 'text', dir: 'resources/s' }], scriptThumbs: [],
  views: [{ parent: '*', as: 'special', label: '特殊场景', match: '_[hH]$' }],
  sceneMarkers: [{ label: 'H', kind: 'bg', match: 'hcg/' }],
} })
const node = async (id, opts) => (await provider.getNode(id, opts)).node
const titles = (n) => n.items.map((i) => i.title)

// ---- 随机排序 ----
{
  check('parseGalView / galViewSuffix：s=random + r=种子；不是 random 不写 r；种子只认 1–9 位数字', J(parseGalView('s=random&r=42')) === J({ q: '', sort: 'random', size: 0, seed: 42 }) && galViewSuffix({ sort: 'random', seed: 42 }) === '|s=random&r=42' && galViewSuffix({ sort: 'name', seed: 42 }) === '|s=name' && parseGalView('s=random&r=abc').seed === 0 && parseGalView('s=random&r=1234567890').seed === 0)
  const id = (seed, page = 1) => `d:Rio2|s=random&r=${seed}${page > 1 ? `#${page}` : ''}`
  const a1 = titles(await node(id(7)))
  const a2 = titles(await node(id(7)))
  const b = titles(await node(id(99)))
  const def = titles(await node('d:Rio2'))
  check('同一个种子：顺序不变；换种子：顺序变；和默认（自然序）不一样；不丢不重（12 个）', J(a1) === J(a2) && J(a1) !== J(b) && J(a1) !== J(def) && J([...a1].sort()) === J(def) && new Set(a1).size === 12, J([a1, b, def]))
  const small = createBrowseProvider({ mediaDir: media, adapters: ['test-vr'], resolveAsset, config: { scriptRoots: [{ id: 'text', dir: 'resources/s' }], scriptThumbs: [], pageSize: 5 } })
  const pages = []
  for (let p = 1; p <= 2; p++) pages.push(...(await small.getNode(`d:Rio2|n=10&s=random&r=7${p > 1 ? `#${p}` : ''}`)).node.items.map((i) => i.title))
  check('翻页稳定：每页 10 个、同一个种子分 2 页取，拼起来 = 整张随机序（不重复不遗漏）', new Set(pages).size === pages.length && pages.length === 12, J(pages))
  const home = await node('d:|s=random&r=3')
  const rio1 = await node('d:Rio3|s=random&r=3')
  check('目录在前、各自内部随机：首页只有目录；node.view.seed = 3、sort = random；节点 id 带 r', home.items.every((i) => i.type === 'dir') && home.view.sort === 'random' && home.view.seed === 3 && /r=3/.test(home.id) && rio1.items.length === 3, J([home.view, home.id]))
}

// ---- 虚拟目录规则的本地覆盖 ----
{
  const base = await node('d:Rio1')
  const special = base.items.find((i) => i.title === '特殊场景')
  const baseRule = base.viewRules?.find((r) => r.as === 'special')
  check('默认规则（布局）：特殊场景 = _H / _h 结尾的 2 个；node.viewRules = { match: _[hH]$, on: name, local: false, defaultMatch, count 2 }', special && baseRule && baseRule.match === '_[hH]$' && baseRule.on === 'name' && baseRule.local === false && baseRule.defaultMatch === '_[hH]$' && baseRule.count === 2 && J(titles(await node(special.node))) === J(['002_00_H', '003_00_h']), J(baseRule))
  const inside = async (ov) => titles(await node('d:Rio1/special', { viewRules: ov }))
  check('覆盖 name：^00[14] → 001_00、004_00；规则里 local = true、count 跟着变、defaultMatch 还是布局的', J(await inside({ special: { match: '^00[14]', on: 'name' } })) === J(['001_00', '004_00']) && (await node('d:Rio1', { viewRules: { special: { match: '^00[14]', on: 'name' } } })).viewRules[0].local === true && (await node('d:Rio1', { viewRules: { special: { match: '^00[14]', on: 'name' } } })).viewRules[0].count === 2)
  check('覆盖 path：对相对路径（Rio1/00[56]）→ 005_x_hcg、006_00', J(await inside({ special: { match: 'Rio1/00[56]', on: 'path' } })) === J(['005_x_hcg', '006_00']))
  check('覆盖 marker（命中 sceneMarkers 规则的脚本）：只有 005_x_hcg（里面背景换成了 hcg）；match 可以再按标签筛（H / 不存在）', J(await inside({ special: { match: '', on: 'marker' } })) === J(['005_x_hcg']) && J(await inside({ special: { match: '^H$', on: 'marker' } })) === J(['005_x_hcg']) && J(await inside({ special: { match: '^nope$', on: 'marker' } })) === '[]')
  check('大小写不敏感；空 match（非 marker）= 全部脚本', (await inside({ special: { match: '_h$', on: 'name' } })).length === 2 && (await inside({ special: { match: '', on: 'name' } })).length === 6)
  const bad = [{ special: { match: '(', on: 'name' } }, { special: { match: 'x'.repeat(300), on: 'name' } }, { nope: { match: 'x', on: 'name' } }, 'x', [1], { special: 5 }]
  const results = []
  for (const ov of bad) results.push(J(await inside(ov)))
  check('写坏的覆盖（坏正则 / 太长 / 不认识的视图名 / 不是对象）全部忽略 = 回到默认规则（2 个）；on 不认识 → name', results.every((r) => r === J(['002_00_H', '003_00_h'])) && J(await inside({ special: { match: '^001', on: 'zzz' } })) === J(['001_00']), J(results))
  check('normalizeViewOverrides：最多 6 个、视图名只认字母数字下划线横线点和中日文、正则要合法', Object.keys(normalizeViewOverrides(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`v${i}`, { match: 'a', on: 'name' }])))).length === 6 && normalizeViewOverrides({ 'a b': { match: 'x' } }) === null && normalizeViewOverrides({ ok: { match: '(' } }) === null)
  const noOv = await node('d:Rio1')
  check('覆盖只对带它的那次请求生效（请求级上下文，不会串到下一个请求）', noOv.viewRules[0].local === false && noOv.viewRules[0].count === 2)
  const concurrent = await Promise.all([node('d:Rio1', { viewRules: { special: { match: '^001', on: 'name' } } }), node('d:Rio1'), node('d:Rio1', { viewRules: { special: { match: '^00[56]', on: 'name' } } })])
  check('并发请求各用各的规则（命中数 1 / 2 / 2）', J(concurrent.map((n) => n.viewRules[0].count)) === '[1,2,2]', J(concurrent.map((n) => n.viewRules[0])))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
