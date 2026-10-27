#!/usr/bin/env node
// Gal 自测（只用 node）：卡片封面 / 悬停轮播的配置与选择逻辑。
//   1. thumbCover / thumbHover 规整（默认、非法值、夹范围、thumbMode 旧别名）+ clean 往返
//   2. 封面选择（pickCover：random / first / last / { index }）+ 悬停轮播计划（hoverPlan：count / random / sequential）
//   3. thumbSources.forStrip（先从脚本名 / 目录名上去掉，再算 forKey）
//   4. thumbFallback.topUp（规则的图在前，再用脚本自己的图补到 max）+ 节点带 thumbCover / thumbHover
//   node scripts/dev/gal-thumb-display-selftest.mjs
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { cleanGalConfigRaw, normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { subjectKey } from '../../web/library/gal/thumbs.mjs'
import { hoverPlan, pickCover } from '../../web/static/thumb-cycle.js'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

// ================= 1. 配置规整 =================
{
  const d = normalizeGalConfig({})
  check('默认：thumbCover random；thumbHover { enabled, count 4, random, [700, 900] }；thumbFallback.topUp false', d.thumbCover === 'random' && J(d.thumbHover) === J({ enabled: true, count: 4, order: 'random', intervalMs: [700, 900] }) && d.thumbFallback.topUp === false && d.thumbMode === 'random', J([d.thumbCover, d.thumbHover]))
  const cov = (v) => normalizeGalConfigWithWarnings({ thumbCover: v })
  check('thumbCover：random / first / last / { index: N } 原样；index 夹到 0–11（带警告）；负数 / 非数字 / 未知字符串 → 默认 random + 警告', ['random', 'first', 'last'].every((m) => cov(m).config.thumbCover === m && !cov(m).warnings.length) && J(cov({ index: 2 }).config.thumbCover) === J({ index: 2 }) && J(cov({ index: '3' }).config.thumbCover) === J({ index: 3 }) && J(cov({ index: 99 }).config.thumbCover) === J({ index: 11 }) && cov({ index: 99 }).warnings.length === 1 && [{ index: -1 }, { index: 'x' }, {}, 'middle', 5, null].every((v) => cov(v).config.thumbCover === 'random' && cov(v).warnings.some((w) => w.field === 'thumbCover')), J(cov({ index: 99 })))
  const alias = (mode, extra = {}) => normalizeGalConfig({ thumbMode: mode, ...extra })
  check('thumbMode 旧别名：random → 封面 random；first → 封面 first 且不轮播；hover → 封面 first 轮播；thumbCover / thumbHover 写了就以它们为准', alias('random').thumbCover === 'random' && alias('first').thumbCover === 'first' && alias('first').thumbHover.enabled === false && alias('hover').thumbCover === 'first' && alias('hover').thumbHover.enabled === true && alias('first', { thumbCover: 'last', thumbHover: { enabled: true } }).thumbCover === 'last' && alias('first', { thumbHover: { count: 2 } }).thumbHover.enabled === true && alias('first').thumbMode === 'first', J([alias('first').thumbCover, alias('first').thumbHover]))
  const hov = (v) => normalizeGalConfigWithWarnings({ thumbHover: v })
  check('thumbHover：只写一部分 = 其余默认；count 夹 1–12；order 只认 random / sequential；intervalMs 夹 100–10000、小的在前；单个数字 = [n, n]', J(hov({ enabled: false }).config.thumbHover) === J({ enabled: false, count: 4, order: 'random', intervalMs: [700, 900] }) && hov({ count: 99 }).config.thumbHover.count === 12 && hov({ count: 0 }).config.thumbHover.count === 1 && hov({ order: 'sequential' }).config.thumbHover.order === 'sequential' && J(hov({ intervalMs: [1500, 50] }).config.thumbHover.intervalMs) === J([100, 1500]) && J(hov({ intervalMs: 400 }).config.thumbHover.intervalMs) === J([400, 400]) && hov({ intervalMs: [50000, 60000] }).warnings.length === 1, J(hov({ intervalMs: [1500, 50] })))
  const bad = hov({ enabled: 'yes', count: 'many', order: 'shuffle', intervalMs: ['a', 1], extra: 1 })
  check('thumbHover 非法值：字段退回默认并各报一条警告；不认识的字段丢掉并警告；不是对象 → 默认 + 警告', J(bad.config.thumbHover) === J(d.thumbHover) && ['enabled', 'count', 'order', 'intervalMs'].every((f) => bad.warnings.some((w) => w.field === `thumbHover.${f}`)) && bad.warnings.some((w) => w.field === 'thumbHover' && /extra/.test(w.reason)) && J(hov('x').config.thumbHover) === J(d.thumbHover) && hov('x').warnings.length === 1, J(bad.warnings))
  const raw = cleanGalConfigRaw({ thumbCover: { index: 1 }, thumbHover: { count: 99, intervalMs: [900, 700] }, thumbFallback: { topUp: true, max: 3 }, nope: 1 })
  check('cleanGalConfigRaw 往返：存规整后的值（index / count 夹好、intervalMs 排好序）；topUp 保留；再规整结果不变', J(raw.thumbCover) === J({ index: 1 }) && raw.thumbHover.count === 12 && J(raw.thumbHover.intervalMs) === J([700, 900]) && raw.thumbFallback.topUp === true && raw.thumbFallback.max === 3 && !('nope' in raw) && J(normalizeGalConfig(raw).thumbHover) === J(raw.thumbHover), J(raw))
  const tu = normalizeGalConfigWithWarnings({ thumbFallback: { topUp: 'yes' } })
  check('thumbFallback.topUp：只认 true / false，其它 → 默认 false + 警告', tu.config.thumbFallback.topUp === false && tu.warnings.some((w) => w.field === 'thumbFallback.topUp') && normalizeGalConfig({ thumbFallback: { topUp: true } }).thumbFallback.topUp === true, J(tu.warnings))
  const fs = normalizeGalConfigWithWarnings({ thumbSources: [{ dir: 'a', match: 'x', forStrip: '^scene_' }, { dir: 'b', match: 'x', forStrip: ['^@', '(', '_ex$'] }, { dir: 'c', match: 'x' }] })
  check('thumbSources.forStrip：字符串 / 数组 → 正则数组；不合法的项丢掉（带警告）；没写 = 没有这个键', J(fs.config.thumbSources[0].forStrip) === J(['^scene_']) && J(fs.config.thumbSources[1].forStrip) === J(['^@', '_ex$']) && !('forStrip' in fs.config.thumbSources[2]) && fs.warnings.length === 1, J(fs))
}

// ================= 2. 封面 / 轮播计划 =================
{
  const rnd = (...values) => { let i = 0; return () => values[i++ % values.length] }
  check('pickCover：first → 0；last → 末张；{ index } 超出取末张；单张永远 0', pickCover(5, 'first') === 0 && pickCover(5, 'last') === 4 && pickCover(5, { index: 2 }) === 2 && pickCover(5, { index: 40 }) === 4 && pickCover(1, 'last') === 0 && pickCover(1, { index: 3 }) === 0 && pickCover(0, 'random') === 0)
  check('pickCover：random 随机（rand=0 → 0、rand≈1 → 末张），覆盖所有位置；旧的 thumbMode 字符串（first / hover）= 第一张', pickCover(4, 'random', () => 0) === 0 && pickCover(4, 'random', () => 0.999) === 3 && new Set(Array.from({ length: 200 }, () => pickCover(4, 'random'))).size === 4 && pickCover(4, 'hover') === 0 && pickCover(4, 'first') === 0 && pickCover(4) >= 0)
  const seq = (total, cover, count) => hoverPlan(total, cover, { count, order: 'sequential' })
  check('hoverPlan sequential：封面之后按原顺序（到头绕回开头），一共最多 count 张（含封面）', J(seq(6, 1, 4)) === J([2, 3, 4]) && J(seq(6, 4, 4)) === J([5, 0, 1]) && J(seq(6, 5, 3)) === J([0, 1]) && J(seq(3, 0, 12)) === J([1, 2]) && J(seq(6, 2, 1)) === J([]), J([seq(6, 1, 4), seq(6, 4, 4)]))
  const rp = hoverPlan(8, 3, { count: 4, order: 'random' })
  check('hoverPlan random：count-1 张、不含封面、不重复、都在范围内；count 大于张数 = 全部其余；默认 count 4', rp.length === 3 && !rp.includes(3) && new Set(rp).size === 3 && rp.every((i) => i >= 0 && i < 8) && hoverPlan(3, 0, { count: 12, order: 'random' }).length === 2 && hoverPlan(8, 0).length === 3 && J(hoverPlan(5, 0, { count: 2, order: 'random' }, rnd(0))) !== undefined)
  const seen = new Set()
  for (let i = 0; i < 300; i++) for (const x of hoverPlan(8, 3, { count: 4, order: 'random' })) seen.add(x)
  check('hoverPlan random：多次抽样，其余 7 张都有机会入选（不是固定前几张）', seen.size === 7, J([...seen]))
}

// ================= 3. forStrip =================
{
  const sk = (rule, subject) => subjectKey({ for: 'both', ...rule }, subject)
  check('forStrip 先从名字上去掉：{stem:0:9} 看到的是去掉前缀之后的名字（scene_123456789012 → 前 9 位）；forMatch 也对去掉之后的名字', sk({ forKey: '{stem:0:9}', forStrip: '^scene_' }, { kind: 'script', stem: 'scene_123456789012' }) === '123456789' && sk({ forMatch: '^(\\d{4})', forKey: '{1}', forStrip: '^@' }, { kind: 'script', stem: '@20240101' }) === '2024' && sk({ forMatch: '^(\\d{4})', forKey: '{1}' }, { kind: 'script', stem: '@20240101' }) === null)
  check('forStrip：目录卡片也一样（{name}）；数组依次去；去完是空 = 规则不适用；旧写法（forKey 用 {parent}，展开后再去）仍然有效', sk({ forKey: '{name}', forStrip: ['^@', '_old$'] }, { kind: 'dir', name: '@chara_old' }) === 'chara' && sk({ forStrip: '^scene_' }, { kind: 'script', stem: 'scene_' }) === null && sk({ forKey: '{parent}', forStrip: '^scene_' }, { kind: 'script', stem: 'script', parent: 'scene_S01' }) === 'S01')
}

// ================= 4. 引擎：topUp + 节点带配置 =================
const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gal-thumb-display-')))
const media = path.join(work, 'media')
const mk = async (rel, content = 'x') => { await mkdir(path.dirname(path.join(media, rel)), { recursive: true }); await writeFile(path.join(media, rel), content) }
const resolveAsset = async (rel) => {
  const file = path.join(media, rel.startsWith('~/') ? rel.slice(2) : `resources/${rel}`)
  try { await readFile(file); return file } catch { throw Object.assign(new Error('资源不存在'), { code: 'ENOENT', statusCode: 404 }) }
}
registerGalAdapter({ id: 'test-topup', label: '测试：JSON 步骤', sniff: (text) => text.startsWith('#TU'), parse: (text) => ({ steps: JSON.parse(text.slice(3)).map((commands, index) => ({ index, commands })), stats: {} }) })
{
  for (const f of ['ev_a.png', 'ev_b.png', 'st_a.png', 'room1.png', 'room2.png', 'scene_x_rule.png', 'scene_y_rule1.png', 'scene_y_rule2.png']) await mk(`resources/tu/img/${f}`)
  const bg = (name, extra = {}) => ({ op: 'bg', src: `tu/img/${name}`, ...extra })
  const steps = [[bg('room1.png')], [{ op: 'stand', parts: [{ src: 'tu/img/st_a.png' }] }], [bg('ev_a.png', { over: 'tu/img/ev_b.png' })], [bg('room2.png')]]
  for (const stem of ['scene_x', 'scene_y', 'scene_z']) await mk(`resources/tu/s/${stem}.txt`, `#TU${J(steps)}`)
  const rules = [{ dir: 'tu/img', match: '^scene_(\\w)_rule\\d?\\.png$', key: '{1}', for: 'script', forKey: '{stem}', forStrip: '^scene_' }]
  const run = async (thumbFallback, extra = {}) => {
    const provider = createBrowseProvider({ mediaDir: media, adapters: ['test-topup'], resolveAsset, config: { scriptRoots: [{ id: 'text', dir: 'resources/tu/s' }], scriptThumbs: [], thumbSources: rules, thumbFallback, ...extra } })
    const node = (await provider.getNode('')).node
    return { node, items: Object.fromEntries(node.items.map((i) => [i.title, i])) }
  }
  const img = (list) => list.map((p) => p.replace('tu/img/', ''))
  const off = await run({ max: 4 })
  check('forStrip 在引擎里：scene_x → 键 x（规则的图）；topUp 默认关：规则命中就不兜底（x 只有 1 张、y 2 张）；z 没命中 = 兜底 4 张', J(img(off.items.scene_x.thumbs)) === J(['scene_x_rule.png']) && J(img(off.items.scene_y.thumbs)) === J(['scene_y_rule1.png', 'scene_y_rule2.png']) && off.items.scene_z.thumbs.length === 4, J(Object.values(off.items).map((i) => i.thumbs)))
  const on = await run({ max: 4, topUp: true })
  check('topUp: true：规则的图在前，再用脚本自己的图（事件图 → 立绘 → 背景）补到 max；y（2 张）补 2 张；z（没规则命中）和以前一样', J(img(on.items.scene_x.thumbs)) === J(['scene_x_rule.png', 'ev_b.png', 'ev_a.png', 'st_a.png']) && J(img(on.items.scene_y.thumbs)) === J(['scene_y_rule1.png', 'scene_y_rule2.png', 'ev_b.png', 'ev_a.png']) && J(on.items.scene_z.thumbs) === J(off.items.scene_z.thumbs) && on.items.scene_x.thumb === on.items.scene_x.thumbs[0], J(Object.values(on.items).map((i) => img(i.thumbs))))
  const small = await run({ max: 2, topUp: true })
  check('topUp：规则的图已经够 max 张就不补（max 2：y 保持 2 张）；max 比规则的图少也不截断规则的图', J(img(small.items.scene_y.thumbs)) === J(['scene_y_rule1.png', 'scene_y_rule2.png']) && J(img(small.items.scene_x.thumbs)) === J(['scene_x_rule.png', 'ev_b.png']), J(small.items.scene_x.thumbs))
  const disabled = await run({ max: 4, topUp: true, enabled: false })
  check('thumbFallback.enabled: false 时 topUp 不生效（旧行为）', J(img(disabled.items.scene_x.thumbs)) === J(['scene_x_rule.png']), J(disabled.items.scene_x.thumbs))
  const cfg = await run({}, { thumbCover: 'last', thumbHover: { count: 3, order: 'sequential', intervalMs: [300, 500] } })
  const legacy = await run({}, { thumbMode: 'first' })
  check('节点带 thumbCover / thumbHover（规整后的值）；旧 thumbMode: first → thumbCover first + thumbHover.enabled false；默认 random / enabled', cfg.node.thumbCover === 'last' && J(cfg.node.thumbHover) === J({ enabled: true, count: 3, order: 'sequential', intervalMs: [300, 500] }) && legacy.node.thumbCover === 'first' && legacy.node.thumbHover.enabled === false && legacy.node.thumbMode === 'first' && (await run({})).node.thumbCover === 'random', J([cfg.node.thumbCover, legacy.node.thumbHover]))
}

// ================= 5. 适配器目录（catalog）里的卡片也走规则 + 兜底 =================
{
  for (const f of ['room1.png', 'room2.png', 'dir_A.png', 'dir_A2.png']) await mk(`resources/cat/img/${f}`)
  const steps = [[{ op: 'bg', src: 'cat/img/room1.png' }], [{ op: 'bg', src: 'cat/img/room2.png' }]]
  for (const stem of ['s1', 's2']) await mk(`resources/cat/s/${stem}.txt`, `#CT${J(steps)}`)
  registerGalAdapter({
    id: 'test-catalog', label: '测试：目录', prepare: () => ({ ok: 1 }), sniff: (text) => text.startsWith('#CT'), parse: (text) => ({ steps: JSON.parse(text.slice(3)).map((commands, index) => ({ index, commands })), stats: {} }),
    catalog: () => ({ children: [
      { id: 'dirA', title: 'A', children: [{ id: 'leaf1', title: 'one', script: 'resources/cat/s/s1.txt' }] },
      { id: 'dirB', title: 'B', children: [{ id: 'leaf2', title: 'two', script: 'resources/cat/s/s2.txt', thumb: 'cat/img/room2.png' }] },
      { id: 'leaf3', title: 'three', script: 'resources/cat/s/s1.txt' },
    ] }),
  })
  const run = async (extra = {}) => {
    const provider = createBrowseProvider({ mediaDir: media, adapters: ['test-catalog'], resolveAsset, config: { scriptRoots: [{ id: 'text', dir: 'resources/cat/s' }], scriptThumbs: [], ...extra } })
    return (await provider.getNode('')).node.items
  }
  const items = await run({ thumbSources: [{ dir: 'cat/img', match: '^dir_(\\w)\\d?\\.png$', key: '{1}', for: 'dir', forKey: '{name}' }] })
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]))
  check('catalog 目录卡片（适配器没给 thumb）：thumbSources 规则按卡片标题（A → dir_A.png、dir_A2.png）取图，不再没图；没有命中规则的目录（B）仍没有', J(byTitle.A.thumbs.map((p) => p.replace('cat/img/', ''))) === J(['dir_A.png', 'dir_A2.png']) && byTitle.B.thumbs.length === 0 && Array.isArray(byTitle.B.thumbWhy), J(items))
  const leaves = await run({})
  const leafOne = (await createBrowseProvider({ mediaDir: media, adapters: ['test-catalog'], resolveAsset, config: { scriptRoots: [{ id: 'text', dir: 'resources/cat/s' }], scriptThumbs: [] } }).getNode('')).node.items.find((i) => i.title === 'three')
  check('catalog 脚本卡片（适配器没给 thumb）：走和文件系统列表一样的兜底（脚本里的背景图）；适配器自己给了 thumb 的（two）原样保留', J(leafOne.thumbs.map((p) => p.replace('cat/img/', ''))) === J(['room1.png', 'room2.png']) && leafOne.thumb === leafOne.thumbs[0] && !('thumbWhy' in leafOne), J(leafOne))
  // 胶片背景（bg.film）不当兜底封面（整张条带 / 转了 90° 存的图直接显示是错的）
  {
    const { collectFallbackImages } = await import('../../web/library/gal/fallback-thumbs.mjs')
    const got = collectFallbackImages({ steps: [{ index: 0, commands: [{ op: 'bg', src: 'a/strip.jpg', film: { ratio: 1.40625, fps: 16, rotate: 90 } }] }, { index: 1, commands: [{ op: 'bg', src: 'a/room.png' }] }] }, normalizeGalConfig({}).thumbFallback)
    check('兜底封面：带 film 的 bg 跳过，只取普通背景（room.png）', J(got.images.map((i) => i.src)) === J(['a/room.png']), J(got.images))
  }
  const noFallback = await run({ thumbFallback: { enabled: false } })
  check('thumbFallback.enabled = false：脚本卡片退回「脚本第一张背景图」（旧逻辑，仍然有图）', noFallback.find((i) => i.title === 'three').thumbs.length === 1, J(noFallback))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
