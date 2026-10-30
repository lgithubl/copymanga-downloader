#!/usr/bin/env node
// 自测（纯 node）：场景跳转点（config.sceneMarkers → markers.mjs → scriptInfo → 列表卡片的 item.markers）
//   · computeMarkers：bg（按当前背景，run / each / first / last）、cmd（指令名 + 正则）、第 0 步和最后两步不要、同一步只留一条、标签序号、总数上限
//   · config：校验（label / kind / op / match / pick / max）
//   · 引擎：规则 → 脚本卡片带 markers
//   · 真实样本（有就跑）：魔法学园 AKUKAGUYA_ca1_h2（H 的 CG 背景）、ぼくらの放課後戦争 4130（bgse / bgmStop）
//   node scripts/dev/gal-markers-selftest.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { computeMarkers } from '../../web/library/gal/markers.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const R = (rule) => ({ pick: rule.kind === 'bg' ? 'run' : 'each', max: 6, ...rule, re: rule.match ? new RegExp(rule.match, 'i') : null })
const scene = (...steps) => ({ steps: steps.map((commands, index) => ({ index, commands })) })
const bg = (src, over) => ({ op: 'bg', src, ...(over ? { over } : {}) })
const text = (t) => ({ op: 'text', segments: [{ text: t }] })

// ---- computeMarkers ----
{
  const s = scene([bg('room.png')], [text('a')], [bg('hcg/A/ca1x/0.jpg')], [bg('hcg/A/ca1x/1.jpg')], [bg('black.png')], [bg('hcg/A/ca2y/0.jpg')], [bg('hcg/A/ca2y/1.jpg')], [text('end')], [text('end2')], [text('end3')])
  const cg = R({ label: 'H 开始', kind: 'bg', match: 'hcg/' })
  check('bg run：每一段连续命中的第一步（2、5）；同一段里换图不算新的一段；多个就加序号', J(computeMarkers(s, [cg]).map((m) => [m.step, m.label])) === J([[2, 'H 开始 1'], [5, 'H 开始 2']]), J(computeMarkers(s, [cg])))
  check('bg each：每次换到命中的背景（2、3、5、6）', J(computeMarkers(s, [R({ ...cg, pick: 'each' })]).map((m) => m.step)) === '[2,3,5,6]')
  check('bg first / last：第一个 / 最后一个命中的 run 起点；只有一个时不加序号', J(computeMarkers(s, [R({ ...cg, pick: 'first' })]).map((m) => [m.step, m.label])) === J([[2, 'H 开始']]) && J(computeMarkers(s, [R({ ...cg, pick: 'last' })]).map((m) => m.step)) === '[5]')
  check('ratio = 步号 / (总步数 - 1)', computeMarkers(s, [cg])[0].ratio === Math.round((2 / 9) * 1000) / 1000)
  const c = scene([text('0')], [{ op: 'bgm', src: 'a.ogg' }], [text('x')], [{ op: 'bgm', src: 'b.ogg' }], [{ op: 'bgm', src: 'b.ogg' }], [text('y')], [{ op: 'bgm', src: 'c.ogg' }], [text('e1')], [text('e2')])
  check('cmd：按指令名，每个命中的步（1、3、4）；最后两步 / 第 0 步不要（6 是倒数第三步，保留）', J(computeMarkers(c, [R({ label: 'BGM', kind: 'cmd', op: 'bgm' })]).map((m) => m.step)) === '[1,3,4,6]', J(computeMarkers(c, [R({ label: 'BGM', kind: 'cmd', op: 'bgm' })])))
  check('cmd + match（对 src）：只要 b.ogg（3、4）；pick first = 3', J(computeMarkers(c, [R({ label: 'B', kind: 'cmd', op: 'bgm', match: 'b\\.ogg' })]).map((m) => m.step)) === '[3,4]' && J(computeMarkers(c, [R({ label: 'B', kind: 'cmd', op: 'bgm', match: 'b\\.ogg', pick: 'first' })]).map((m) => m.step)) === '[3]')
  check('cmd text：对台词文字', J(computeMarkers(c, [R({ label: 'Y', kind: 'cmd', op: 'text', match: '^y$' })]).map((m) => m.step)) === '[5]')
  check('同一步被两条规则命中：只留第一条的标签；按步号排序', (() => { const m = computeMarkers(c, [R({ label: '第一', kind: 'cmd', op: 'bgm', match: 'b\\.ogg', pick: 'first' }), R({ label: '第二', kind: 'cmd', op: 'bgm', match: 'b\\.ogg', pick: 'first' })]); return m.length === 1 && m[0].label === '第一' })())
  check('max 限制每条规则的个数；总数最多 12', computeMarkers(c, [R({ label: 'BGM', kind: 'cmd', op: 'bgm', max: 2 })]).length === 2 && computeMarkers(scene(...Array.from({ length: 40 }, (_, i) => [{ op: 'bgm', src: `${i}.ogg` }])), [R({ label: 'B', kind: 'cmd', op: 'bgm', max: 12 }), R({ label: 'C', kind: 'cmd', op: 'bgm', max: 12 })]).length === 12)
  check('没有规则 / 太短的场景 = 空', !computeMarkers(s, []).length && !computeMarkers(scene([text('a')]), [cg]).length)
}

// ---- config 校验 ----
{
  const ok = normalizeGalConfigWithWarnings({ sceneMarkers: [{ label: 'H', kind: 'bg', match: 'hcg/' }, { label: 'B', kind: 'cmd', op: 'bgmStop', pick: 'first', max: 99 }] })
  check('config：合法的保留，默认 pick（bg run / cmd each）、max 夹到 12', J(ok.config.sceneMarkers) === J([{ label: 'H', kind: 'bg', match: 'hcg/', pick: 'run', max: 6 }, { label: 'B', kind: 'cmd', op: 'bgmStop', pick: 'first', max: 12 }]) && !ok.warnings.length, J([ok.config.sceneMarkers, ok.warnings]))
  const bad = normalizeGalConfigWithWarnings({ sceneMarkers: [{ label: '', kind: 'bg', match: 'x' }, { label: 'a', kind: 'zzz' }, { label: 'b', kind: 'bg' }, { label: 'c', kind: 'bg', match: '(' }, { label: 'd', kind: 'cmd', op: 'bad op!' }, { label: 'e', kind: 'cmd', op: 'bgm', pick: 'run', max: 'x' }] })
  check('config：label 空 / kind 不对 / bg 没写 match / 坏正则 / op 不合法 都丢掉并报告；pick 不认识 → 默认；max 不是数字 → 6', bad.config.sceneMarkers.length === 1 && bad.config.sceneMarkers[0].label === 'e' && bad.config.sceneMarkers[0].pick === 'each' && bad.config.sceneMarkers[0].max === 6 && bad.warnings.length >= 6, J([bad.config.sceneMarkers, bad.warnings.map((w) => w.field)]))
  check('默认 sceneMarkers = []', J(normalizeGalConfigWithWarnings({}).config.sceneMarkers) === '[]')
}

// ---- 引擎：脚本卡片带 markers ----
{
  const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gal-markers-')))
  const media = path.join(work, 'media')
  await mkdir(path.join(media, 'resources/s'), { recursive: true })
  const steps = [[bg('i/room.png')], [text('a')], [bg('i/hcg/x/0.jpg')], [text('b')], [bg('i/black.png')], [bg('i/hcg/y/0.jpg')], [text('c')], [text('d')], [text('e')]]
  await writeFile(path.join(media, 'resources/s/scene_h.txt'), `#MK${J(steps)}`)
  await writeFile(path.join(media, 'resources/s/plain.txt'), `#MK${J([[bg('i/room.png')], [text('a')], [text('b')], [text('c')]])}`)
  registerGalAdapter({ id: 'test-markers', label: '测试', sniff: (t) => t.startsWith('#MK'), parse: (t) => ({ steps: JSON.parse(t.slice(3)).map((commands, index) => ({ index, commands })), stats: {} }) })
  const resolveAsset = async (rel) => { throw Object.assign(new Error('x'), { code: 'ENOENT', statusCode: 404 }) }
  const provider = (sceneMarkers) => createBrowseProvider({ mediaDir: media, adapters: ['test-markers'], resolveAsset, config: { scriptRoots: [{ id: 'text', dir: 'resources/s' }], scriptThumbs: [], sceneMarkers } })
  const items = Object.fromEntries((await provider([{ label: 'H 开始', kind: 'bg', match: 'hcg/' }]).getNode('')).node.items.map((i) => [i.title, i]))
  check('脚本卡片带 markers：scene_h = [{ step 2, H 开始 1 }, { step 5, H 开始 2 }]；没有命中的脚本没有这个字段', J(items.scene_h.markers?.map((m) => [m.step, m.label])) === J([[2, 'H 开始 1'], [5, 'H 开始 2']]) && items.plain.markers === undefined, J(items))
  const none = Object.fromEntries((await provider([]).getNode('')).node.items.map((i) => [i.title, i]))
  check('没配规则：卡片没有 markers（旧行为）', none.scene_h.markers === undefined)
  const changed = Object.fromEntries((await provider([{ label: '换', kind: 'bg', match: 'black' }]).getNode('')).node.items.map((i) => [i.title, i]))
  check('规则换了（缓存键含 sceneMarkers）：马上按新规则算', J(changed.scene_h.markers?.map((m) => m.step)) === '[4]', J(changed.scene_h))
}

// ---- 真实样本（有就跑）----
{
  const art = '/home/user/workspace/samples/gal-samples28/artwhirl/scripts/hscripts/AKUKAGUYA/AKUKAGUYA_ca1_h2.json'
  if (existsSync(art)) {
    const sc = buildScene('artwhirl-json', readFileSync(art, 'utf8'), null, { rel: 'x.json', stem: 'x', options: {}, config: {} })
    const m = computeMarkers(sc, [R({ label: 'H 开始', kind: 'bg', match: '/hcg/[^/]+/ca\\d+[A-Za-z0-9]+/\\d+(@\\d+)?\\.(jpe?g|png)$' })])
    check('真实样本（魔法学园 AKUKAGUYA_ca1_h2，340 步）：H 的 CG 背景两段 → 第 88、183 步', J(m.map((x) => x.step)) === '[88,183]', J(m))
  } else console.log('SKIP 没有魔法学园样本')
  const dir = '/home/user/workspace/samples/b4130'
  if (existsSync(dir)) {
    const fb = readdirSync(dir, { encoding: 'buffer' }).find((x) => x.toString('latin1').endsWith('.json'))
    const sc = buildScene('bokusen-json', readFileSync(Buffer.concat([Buffer.from(`${dir}/`), fb]), 'utf8'), null, { rel: 'x.json', stem: 'x', options: {}, config: {} })
    const m = computeMarkers(sc, [R({ label: '背景人声开始', kind: 'cmd', op: 'bgse', pick: 'first', max: 1 }), R({ label: 'BGM 停止', kind: 'cmd', op: 'bgmStop', max: 5 })])
    check('真实样本（ぼくら 4130，362 步）：bgmStop 在 50 / 151 / 170 / 199 / 319，背景人声在 203 开始', J(m.map((x) => x.step)) === '[50,151,170,199,203,319]', J(m))
  } else console.log('SKIP 没有 ぼくら 样本')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
