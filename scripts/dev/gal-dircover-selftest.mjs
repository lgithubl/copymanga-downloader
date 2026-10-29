#!/usr/bin/env node
// 自测（纯 node）：目录卡片封面 / 轮播的配置化
//   · config：dirCover（enabled / scan / depth / max / merge / prefer 档位 / skip / only）、thumbHover.mode（hover | auto）与 count 上限 24、thumbFallback.only（白名单）的校验和默认值
//   · pickDirCover：prefer 档位（第一档有就用、没有才下一档）、take、match（正则）、merge、max、skip / only
//   · collectFallbackImages：thumbFallback.only 白名单（对完整路径）
//   node scripts/dev/gal-dircover-selftest.mjs
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { pickDirCover } from '../../web/library/gal/dir-cover.mjs'
import { collectFallbackImages } from '../../web/library/gal/fallback-thumbs.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

// ---- config ----
const d = normalizeGalConfig({})
check('默认：dirCover = auto / scan 6 / depth 3 / max 6 / 不合并 / prefer [render, image]（对象形状）/ skip、only 空；thumbHover.mode = hover；thumbFallback.only = []', J(d.dirCover) === J({ enabled: 'auto', scan: 6, depth: 3, max: 6, merge: false, prefer: [{ source: 'render', match: '', take: 0 }, { source: 'image', match: '', take: 0 }], skip: [], only: [] }) && d.thumbHover.mode === 'hover' && J(d.thumbFallback.only) === '[]', J([d.dirCover, d.thumbHover.mode, d.thumbFallback.only]))
const c = normalizeGalConfig({
  dirCover: { enabled: true, scan: 99, depth: 0, max: 99, merge: true, prefer: ['image', { source: 'render', match: 'ch_\\d+', take: 2 }, 'zzz', { source: 'image', match: '(' }], skip: ['black', '('], only: ['bg'], extra: 1 },
  thumbHover: { mode: 'auto', count: 30 }, thumbFallback: { only: ['bg/', '[', 5] },
})
check('dirCover 校验：数值夹到范围（scan ≤ 30、depth ≥ 1、max ≤ 24）；prefer 不认识的档丢掉、写坏的 match 丢掉（档保留）；skip / only 不合法的正则丢掉；不认识的字段丢掉', c.dirCover.enabled === true && c.dirCover.scan === 30 && c.dirCover.depth === 1 && c.dirCover.max === 24 && c.dirCover.merge === true && J(c.dirCover.prefer) === J([{ source: 'image', match: '', take: 0 }, { source: 'render', match: 'ch_\\d+', take: 2 }, { source: 'image', match: '', take: 0 }]) && J(c.dirCover.skip) === '["black"]' && J(c.dirCover.only) === '["bg"]', J(c.dirCover))
check('thumbHover.mode: auto 认；count 上限 24；thumbFallback.only 只留合法正则（"[" 和数字丢掉）', c.thumbHover.mode === 'auto' && c.thumbHover.count === 24 && J(c.thumbFallback.only) === '["bg/"]', J([c.thumbHover, c.thumbFallback.only]))
check('写错的值：dirCover.enabled 不认 → auto；thumbHover.mode 不认 → hover；报告里有对应的提示', (() => { const x = normalizeGalConfig({ dirCover: { enabled: 'maybe', prefer: [] }, thumbHover: { mode: 'sometimes' } }); return x.dirCover.enabled === 'auto' && x.thumbHover.mode === 'hover' && x.warnings.some((w) => w.field === 'dirCover.enabled') && x.warnings.some((w) => w.field === 'thumbHover.mode') && x.warnings.some((w) => w.field === 'dirCover.prefer') })())

// ---- pickDirCover ----
const base = { enabled: true, scan: 6, depth: 3, max: 6, merge: false, skip: [], only: [] }
const cands = {
  render: [{ name: 'S/a.book.json::5', render: { key: 'k5', node: 'n5' } }, { name: 'S/b.book.json::2', render: { key: 'k2', node: 'n2' } }],
  image: [{ name: 'bg/room.png', path: 'bg/room.png' }, { name: 'cg/ev_01.png', path: 'cg/ev_01.png' }, { name: 'bg/black.png', path: 'bg/black.png' }],
}
const tiers = (...t) => t.map((x) => (typeof x === 'string' ? { source: x, match: '', take: 0 } : { match: '', take: 0, ...x }))
let r = pickDirCover(cands, { ...base, prefer: tiers('render', 'image') })
check('render > image：有渲染图就只要渲染图（第一档有候选，不看下一档）', r.renders.length === 2 && r.thumbs.length === 0, J(r))
r = pickDirCover({ ...cands, render: [] }, { ...base, prefer: tiers('render', 'image') })
check('没有渲染图：落到 image 档', r.renders.length === 0 && r.thumbs.length === 3, J(r))
r = pickDirCover(cands, { ...base, prefer: tiers({ source: 'render', take: 1 }, 'image') })
check('take：render 档最多 1 张', r.renders.length === 1 && r.renders[0].key === 'k5', J(r))
r = pickDirCover(cands, { ...base, prefer: tiers({ source: 'image', match: '^cg/' }, 'render') })
check('match：匹配 cg/ 的图最优先；有就不看 render', J(r.thumbs) === '["cg/ev_01.png"]' && r.renders.length === 0, J(r))
r = pickDirCover({ ...cands, image: [{ name: 'bg/room.png', path: 'bg/room.png' }] }, { ...base, prefer: tiers({ source: 'image', match: '^cg/' }, 'render') })
check('match 没有命中：落到下一档（render）', r.renders.length === 2 && r.thumbs.length === 0, J(r))
r = pickDirCover(cands, { ...base, merge: true, prefer: tiers('render', 'image'), max: 4 })
check('merge：render 在前、image 补上，最多 max（4）张', r.renders.length === 2 && r.thumbs.length === 2, J(r))
r = pickDirCover(cands, { ...base, prefer: tiers('image'), skip: ['black'] })
check('skip 黑名单：bg/black.png 丢掉', J(r.thumbs) === '["bg/room.png","cg/ev_01.png"]', J(r))
r = pickDirCover(cands, { ...base, prefer: tiers('image'), only: ['^cg/'] })
check('only 白名单：只留 cg/', J(r.thumbs) === '["cg/ev_01.png"]', J(r))
r = pickDirCover(cands, { ...base, prefer: tiers('render', 'image'), only: ['\\.png$'] })
check('only 对 render 也生效（按脚本路径）：脚本路径都不是 .png → 没有渲染图候选，落到 image 档', r.renders.length === 0 && r.thumbs.length === 3, J(r))
r = pickDirCover({ render: [], image: [] }, { ...base, prefer: tiers('render', 'image') })
check('什么候选都没有：空结果', r.thumbs.length === 0 && r.renders.length === 0)

// ---- thumbFallback.only ----
const scene = { steps: [{ commands: [{ op: 'bg', src: 'bg/room.png' }, { op: 'bg', src: 'cg/ev_01.png', over: true }] }, { commands: [{ op: 'bg', src: 'bg/hall.png' }] }] }
const all = collectFallbackImages(scene, {})
const only = collectFallbackImages(scene, { only: ['^bg/h'] })
check('thumbFallback.only：不写 = 都要；写 ^bg/h = 只留 bg/hall.png（对完整路径）', all.images.length === 3 && J(only.images.map((i) => i.src)) === '["bg/hall.png"]', J([all.images, only.images]))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
