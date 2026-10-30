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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
