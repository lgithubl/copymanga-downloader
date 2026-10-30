#!/usr/bin/env node
// 自测（纯 node）：场景卡片的「内部轮播」（thumbRender.inner）——规则给的封面（thumbnail 之类）仍是第一张，后面是场景里不同的骨骼 / 立绘 / CG 渲染，再后面是场景里的图；总数不超过 innerMax
//   · pickRenderSteps：画面不同才算一张（同一个骨骼换动画 = 不同；相同 = 去重），第 0 个 = pickRenderStep 的结果，数量不超过 count
//   · 引擎（browse.mjs scriptInfo）：规则命中 / 没命中 两种场景 × inner 开 / 关；renders 的 key 稳定且互不相同，variant 0 的 key 和没开 inner 时的 renderKey 一样；max 限制
//   node scripts/dev/gal-thumb-inner-selftest.mjs
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { pickRenderStep, pickRenderSteps } from '../../web/static/gal-thumb-pick.js'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const spine = (slot, anim, extra = {}) => ({ op: 'spine', slot, name: `sk_${slot}`, anim, ...extra })
const bg = (name, extra = {}) => ({ op: 'bg', src: `i/${name}`, ...extra })
const scene = (...steps) => ({ steps: steps.map((commands, index) => ({ index, commands })) })

// ---- 配置 ----
{
  const d = normalizeGalConfig({})
  check('默认：inner 关、innerMax 4、innerRenders 3', d.thumbRender.inner === false && d.thumbRender.innerMax === 4 && d.thumbRender.innerRenders === 3, J(d.thumbRender))
  const c = normalizeGalConfigWithWarnings({ thumbRender: { inner: 'yes', innerMax: 99, innerRenders: 0 } })
  check('校验：inner 不是布尔 → 默认 + 警告；innerMax 夹到 12、innerRenders 夹到 1', c.config.thumbRender.inner === false && c.config.thumbRender.innerMax === 12 && c.config.thumbRender.innerRenders === 1 && c.warnings.some((w) => w.field === 'thumbRender.inner'), J(c))
}

// ---- pickRenderSteps ----
{
  const s = scene(
    [bg('room.png')],
    [spine('a', 'idle')], [spine('a', 'idle')], [spine('a', 'smile')],       // 同一个骨骼：idle 和 smile 是两个画面
    [{ op: 'spineOff' }, bg('room.png', { over: 'i/ev_1.png' })],               // CG（bg.over）分数最高
    [bg('room2.png')],
  )
  const one = pickRenderStep(s, 150)
  const many = pickRenderSteps(s, 150, 3)
  check('第 0 个 = pickRenderStep 的结果（CG 优先）', many[0].index === one.index && one.score === 100, J([one, many.map((m) => [m.index, m.score])]))
  check('一共 3 个、画面各不相同（CG → 骨骼 idle → 骨骼 smile），纯背景不算', many.length === 3 && J(many.map((m) => m.score)) === '[100,30,30]', J(many.map((m) => [m.index, m.score])))
  check('count 1 = 只有第 0 个；count 很大也只有 3 种不同的画面（相同画面去重）', pickRenderSteps(s, 150, 1).length === 1 && pickRenderSteps(s, 150, 9).length === 3)
  check('只有背景的场景 = 没有（纯背景用普通图片缩略图）', pickRenderSteps(scene([bg('a.png')], [bg('b.png')]), 150, 3).length === 0)
}

// ---- 引擎 ----
const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gal-thumb-inner-')))
const media = path.join(work, 'media')
const mk = async (rel, content = 'x') => { await mkdir(path.dirname(path.join(media, rel)), { recursive: true }); await writeFile(path.join(media, rel), content) }
const resolveAsset = async (rel) => {
  const file = path.join(media, rel.startsWith('~/') ? rel.slice(2) : `resources/${rel}`)
  try { await readFile(file); return file } catch { throw Object.assign(new Error('资源不存在'), { code: 'ENOENT', statusCode: 404 }) }
}
registerGalAdapter({ id: 'test-inner', label: '测试：JSON 步骤', sniff: (text) => text.startsWith('#IN'), parse: (text) => ({ steps: JSON.parse(text.slice(3)).map((commands, index) => ({ index, commands })), stats: {} }) })
{
  for (const f of ['room.png', 'room2.png', 'ev_1.png', 'rule_x.png']) await mk(`resources/i/${f}`)
  const steps = [[bg('room.png')], [spine('a', 'idle')], [spine('a', 'smile')], [bg('room.png', { over: 'i/ev_1.png' })], [bg('room2.png')]]
  for (const stem of ['scene_x', 'scene_y']) await mk(`resources/s/${stem}.txt`, `#IN${J(steps)}`)
  const rules = [{ dir: 'i', match: '^rule_(\\w)\\.png$', key: '{1}', for: 'script', forMatch: '^scene_(\\w)$', forKey: '{1}' }]
  const run = async (thumbRender, extra = {}) => {
    const provider = createBrowseProvider({ mediaDir: media, adapters: ['test-inner'], resolveAsset, config: { scriptRoots: [{ id: 'text', dir: 'resources/s' }], scriptThumbs: [], thumbSources: rules, thumbRender, ...extra } })
    const items = (await provider.getNode('')).node.items
    return Object.fromEntries(items.map((i) => [i.title, i]))
  }
  const keys = (item) => [...(item.render ? [item.render.key] : []), ...(item.renders || []).map((r) => r.key)]
  const off = await run({})
  check('inner 关（默认）：和以前一样——scene_x（规则命中）没有渲染图；scene_y（没命中）一个 render、没有 ruleCover', !off.scene_x.renders && !off.scene_x.render && off.scene_y.render?.key && !off.scene_y.renders && !off.scene_y.ruleCover, J(off))
  const on = await run({ inner: true, innerMax: 4, innerRenders: 3 })
  const x = on.scene_x
  check('inner 开 + 规则命中（scene_x，规则图 rule_x.png）：封面仍是规则图（ruleCover）；后面 renders 最多 3 个、key 互不相同；总数（1 + 渲染）≤ innerMax', x.ruleCover === true && x.thumbs[0] === 'i/rule_x.png' && x.renders.length === 3 && new Set(x.renders.map((r) => r.key)).size === 3 && 1 + x.renders.length <= 4 && J(x.renders.map((r) => r.variant)) === '[0,1,2]', J(x))
  check('悬停轮播的张数跟着 innerMax（carousel 4）', x.carousel === 4, J(x.carousel))
  const y = on.scene_y
  check('inner 开 + 规则没命中（scene_y）：不是 ruleCover；render = variant 0（key 和关 inner 时一样），其余在 renders 里；渲染图 3 个', !y.ruleCover && y.renders.length === 3 && y.render.key === off.scene_y.render.key && y.renders[0].key === y.render.key && J(y.renders.map((r) => r.variant || 0)) === '[0,1,2]', J(y))
  const small = await run({ inner: true, innerMax: 2, innerRenders: 3 })
  check('innerMax 2：scene_x = 规则图 1 张 + 渲染 1 张；scene_y = 渲染 2 张、没有多余的图', small.scene_x.thumbs.length + small.scene_x.renders.length === 2 && small.scene_y.renders.length === 2 && small.scene_y.thumbs.length === 0, J([small.scene_x, small.scene_y]))
  const few = await run({ inner: true, innerMax: 6, innerRenders: 1 })
  check('innerRenders 1：只渲染 1 个画面；剩下的名额用场景里的图补（scene_x：规则图 + 渲染 1 + 图）', few.scene_x.renders.length === 1 && few.scene_x.thumbs.length > 1 && few.scene_x.thumbs.length + few.scene_x.renders.length <= 6, J(few.scene_x))
  const none = await run({ inner: false, innerMax: 6 })
  check('inner: false：innerMax 不生效', none.scene_x.thumbs.length === 1, J(none.scene_x.thumbs))
}

// ---- dirCover.from / leafScan（TSK：一本书 = 最后一章的封面）+ 头像 T5 优先 T6 兜底 ----
{
  for (const f of ['a1.png', 'a2.png', 'a3.png', 'b1.png', 'T5/chara_1091001_1.png', 'T6/chara_1091001_1.png', 'T6/chara_2222001_1.png']) await mk(`resources/lf/${f}`)
  const one = (img) => [[{ op: 'bg', src: `lf/${img}` }]]
  for (const [stem, img] of [['c1', 'a1.png'], ['c2', 'a2.png'], ['c3', 'a3.png'], ['d1', 'b1.png']]) await mk(`resources/lfs/${stem}.txt`, `#LF${J(one(img))}`)
  registerGalAdapter({
    id: 'test-leaf', label: '测试：书', prepare: () => ({ ok: 1 }), sniff: (text) => text.startsWith('#LF'), parse: (text) => ({ steps: JSON.parse(text.slice(3)).map((commands, index) => ({ index, commands })), stats: {} }),
    catalog: () => ({ children: [
      { id: 'book', title: 'CharaScenario1091002', children: ['c1', 'c2', 'c3'].map((c) => ({ id: c, title: c, script: `resources/lfs/${c}.txt` })) },
      { id: 'chara', title: '角色', key: '@1091', children: [{ id: 'd1', title: 'd1', script: 'resources/lfs/d1.txt' }] },
      { id: 'chara2', title: '角色2', key: '@2222', children: [{ id: 'd2', title: 'd2', script: 'resources/lfs/d1.txt' }] },
    ] }),
  })
  const thumbSources = [
    { dir: 'lf/T5', match: '^chara_(\\d{4})\\d{3}_.*\\.png$', key: '{1}', for: 'dir', forKey: '{name}', forStrip: '^@', limit: 6 },
    { dir: 'lf/T6', match: '^chara_(\\d{4})\\d{3}_.*\\.png$', key: '{1}', for: 'dir', forKey: '{name}', forStrip: '^@', limit: 6, fallback: true },
  ]
  const run = async (dirCover) => {
    const provider = createBrowseProvider({ mediaDir: media, adapters: ['test-leaf'], resolveAsset, config: { scriptRoots: [{ id: 'text', dir: 'resources/lfs' }], scriptThumbs: [], thumbSources, thumbFallback: { max: 6 }, dirCover } })
    return Object.fromEntries((await provider.getNode('')).node.items.map((i) => [i.title, i]))
  }
  const strip = (list) => (list || []).map((p) => p.replace('lf/', ''))
  const first = await run({ enabled: true, scan: 8, max: 6 })
  check('dirCover 默认（from first）：一本书 = 三章的图都轮播', J(strip(first.CharaScenario1091002.thumbs)) === '["a1.png","a2.png","a3.png"]', J(first.CharaScenario1091002))
  const last = await run({ enabled: true, scan: 8, max: 6, from: 'last', leafScan: 1 })
  check('from last + leafScan 1：一本书 = 只有最后一章的图（a3.png）', J(strip(last.CharaScenario1091002.thumbs)) === '["a3.png"]', J(last.CharaScenario1091002))
  const lastOnly = await run({ enabled: true, scan: 2, max: 6, from: 'last' })
  check('from last（不写 leafScan）：取最后 scan（2）个脚本 = a2、a3', J(strip(lastOnly.CharaScenario1091002.thumbs)) === '["a2.png","a3.png"]', J(lastOnly.CharaScenario1091002))
  check('头像：Thumb_005 有就只用它（1091 → T5 的图，不带 T6 的）；没有才用 T6（2222 → T6）', J(strip(first['角色'].thumbs)) === '["T5/chara_1091001_1.png"]' && J(strip(first['角色2'].thumbs)) === '["T6/chara_2222001_1.png"]', J([first['角色'].thumbs, first['角色2'].thumbs]))
  const bad = normalizeGalConfigWithWarnings({ dirCover: { from: 'middle', leafScan: -1 } })
  check('config 校验：from 只认 first / last、leafScan 不能是负数，退回默认并警告', bad.config.dirCover.from === 'first' && bad.config.dirCover.leafScan === 0 && bad.warnings.some((w) => w.field === 'dirCover.from') && bad.warnings.some((w) => w.field === 'dirCover.leafScan'), J(bad))
}

// ---- 胶片场景（bg.film）：同一条胶片取几个不同位置的帧 ----
{
  for (const f of ['strip1.jpg', 'strip2.jpg']) await mk(`resources/fm/${f}`)
  const film = { ratio: 1.40625, fps: 16, rotate: 90 }
  const text = (t) => ({ op: 'text', segments: [{ text: t }] })
  const fbg = (name) => ({ op: 'bg', src: `fm/${name}`, film })
  await mk('resources/fs/film_one.txt', `#FM${J([[fbg('strip1.jpg')], [text('a')], [text('b')], [text('c')]])}`)
  await mk('resources/fs/film_two.txt', `#FM${J([[fbg('strip1.jpg')], [text('a')], [fbg('strip2.jpg')], [text('b')], [text('c')]])}`)
  registerGalAdapter({ id: 'test-film', label: '测试：胶片', sniff: (t) => t.startsWith('#FM'), parse: (t) => ({ steps: JSON.parse(t.slice(3)).map((commands, index) => ({ index, commands })), stats: {} }) })
  const provider = (thumbRender) => createBrowseProvider({ mediaDir: media, adapters: ['test-film'], resolveAsset, config: { scriptRoots: [{ id: 'text', dir: 'resources/fs' }], scriptThumbs: [], thumbRender } })
  const items = async (tr) => Object.fromEntries((await provider(tr).getNode('')).node.items.map((i) => [i.title, i]))
  const off = await items({})
  check('胶片场景，inner 关（以前）：一条胶片 = 1 张渲染图（鼠标放上去不会动）；两条不同的胶片 = 2 张', off.film_one.renders === undefined && off.film_one.render?.film === 'fm/strip1.jpg' && off.film_two.renders?.length === 2, J([off.film_one, off.film_two.renders]))
  const on = await items({ inner: true, innerMax: 4, innerRenders: 3 })
  const one = on.film_one.renders
  check('胶片场景，inner 开：一条胶片 = 同一条胶片的 3 个不同位置的帧（先中间帧 0.5，再 0.167 / 0.833）；key 互不相同；第一张（中间帧）的 key 和 inner 关时一样；没有 frame 字段的是默认帧', one?.length === 3 && J(one.map((r) => r.frame ?? 0.5)) === '[0.5,0.167,0.833]' && new Set(one.map((r) => r.key)).size === 3 && one[0].key === off.film_one.render.key && one.every((r) => r.film === 'fm/strip1.jpg') && on.film_one.carousel === 4, J(one))
  const two = on.film_two.renders
  check('两条胶片 + inner：帧优先（先每条的中间帧，再下一个位置），总数不超过 innerMax（4）', two?.length === 4 && J(two.map((r) => [r.film, r.frame ?? 0.5])) === J([['fm/strip1.jpg', 0.5], ['fm/strip2.jpg', 0.5], ['fm/strip1.jpg', 0.167], ['fm/strip2.jpg', 0.167]]), J(two))
  // 黑 / 空白胶片不当封面（Kamihime 的 black.jpg）
  await mk('resources/fs/film_black.txt', `#FM${J([[fbg('black.jpg')], [text('a')], [fbg('strip3.jpg')], [text('b')]])}`)
  await mk('resources/fs/film_allblack.txt', `#FM${J([[fbg('black.jpg')], [text('a')], [fbg('blank.jpg')], [text('b')]])}`)
  const bl = await items({ inner: true })
  check('胶片里有 black.jpg：跳过黑胶片，封面和轮播都只用有内容的那条（strip3）', bl.film_black.renders?.length > 0 && bl.film_black.renders.every((r) => r.film === 'fm/strip3.jpg'), J(bl.film_black.renders))
  check('胶片全是 black / blank：没有渲染图（不拿黑图当封面）', !bl.film_allblack.render && !bl.film_allblack.renders, J(bl.film_allblack))

}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
