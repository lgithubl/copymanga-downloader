#!/usr/bin/env node
// 自测：angelic 立绘（gal-samples15 的 371IH42Z15.rpy）：`show 371lid 01:` + 缩进的 ypos / xalign / zoom，
// 图片是 Composite((1166, 1026), (0,0), "371lid_st_s_99", (0,0), "371lid_st_s_01")——图层是没有扩展名的图片名。
//   node scripts/dev/gal-angelic-stand-selftest.mjs
import * as monmusu from '../../web/library/gal/adapters/renpy-monmusu.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const defs = `image 371lid 01 = Composite(
    (1166, 1026),
    (0,0), "371lid_st_s_99",
    (0,0), "371lid_st_s_01")
image 371lid 02 = Composite(
    (1166, 1026),
    (0,0), "371lid_st_s_99",
    (0,0), "371lid_st_s_02")
`
const script = `label H371IH42Z15:
    show ba073 
    show 371lid 01:
        ypos -180 
        xalign 0.5
        zoom 1.8 
    voice "resources/371I/voice/F001.mp3"
    "A" "hello"
    hide 371lid 01 
    show 371lid 02
    "A" "plain"
    scene black
    "A" "end"
`
const files = ['images/stand/371LID/371LID_st_s_01.png', 'images/stand/371LID/371LID_st_s_02.png', 'images/stand/371LID/371LID_st_s_99.png', 'images/bg/ba073.jpg']
const prep = (options) => monmusu.prepare({ options, texts: { 'script/hscene/a.rpy': defs }, files })
const cmds = (ctx, options) => monmusu.parse(script, ctx, { options }).steps.flatMap((s) => s.commands)

{
  const options = { composite: { byName: true }, stands: { enabled: true } }
  const ctx = prep(options)
  check('Composite 的图层写图片名（没有扩展名）：靠图片目录的自动命名查到真实路径；画布大小记下来', J(ctx.composites.get('371lid 01')) === J(['images/stand/371LID/371LID_st_s_99.png', 'images/stand/371LID/371LID_st_s_01.png']) && J(ctx.compositeSize.get('371lid 01')) === '[1166,1026]', J([...ctx.composites]))
  const out = cmds(ctx, options)
  const stands = out.filter((c) => c.op === 'stand')
  const s0 = stands[0]
  // zoom 1.8：2098.8 × 1846.8；xalign 0.5 → 左 = 0.5×(1920−2098.8) = −89.4，中心 x = 960 → 相对舞台中心 0；ypos −180 → 中心 y = −180 + 923.4 = 743.4 → 相对 +203.4
  check('show 371lid 01: ypos -180 / xalign 0.5 / zoom 1.8 → slot 371lid，舞台 1920×1080，两个图层同位置同比例', s0?.slot === '371lid' && J(s0.stage) === '[1920,1080]' && s0.parts.length === 2 && s0.parts.every((p) => Math.abs(p.x) < 1e-6 && Math.abs(p.y - 203.4) < 1e-6 && p.scale === 1.8), J(s0))
  check('不带位置的 show：底边居中（zoom 1 → y = 1080 − 1026/2 − 540 = 27）', stands[1]?.parts[0].x === 0 && stands[1].parts[0].y === 27 && stands[1].parts[0].scale === 1, J(stands[1]))
  check('hide 371lid 01 → standOff slot 371lid；scene → standOff 全部', out.filter((c) => c.op === 'standOff').map((c) => c.slot ?? '*').join() === '371lid,*', J(out.filter((c) => c.op === 'standOff')))
  check('show ba073（没有属性的名字）仍然是背景', out.some((c) => c.op === 'bg' && /ba073/.test(c.src)), J(out.slice(0, 3)))
}
{
  const ctx = prep({})
  check('默认（没开）：Composite 里没有扩展名的图层不读，show 带属性 = raw，行为不变', !ctx.composites.has('371lid 01') && !cmds(ctx, {}).some((c) => c.op === 'stand' || c.op === 'standOff'))
}
{
  const { buildSourceIndex, subjectKey } = await import('../../web/library/gal/thumbs.mjs')
  const { LAYOUTS } = await import('../../scripts/tag-scripts/gal-layout/main.js')
  const { normalizeGalConfig } = await import('../../web/library/gal/config.mjs')
  const rule = normalizeGalConfig(LAYOUTS.angelic.config).thumbSources[0]
  const map = buildSourceIndex(rule, [{ dir: 'images/thumbnail', name: '371i_idle.jpg' }, { dir: 'images/thumbnail', name: '371i_hover.jpg' }, { dir: 'images/thumbnail', name: '371s_idle.jpg' }])
  const key = subjectKey(rule, { kind: 'script', stem: '371IH42Z15' })
  check('angelic 封面：脚本 371IH42Z15 → images/thumbnail/371i_idle.jpg（键忽略大小写；hover 图不收）', rule?.lower === true && key === '371i' && J(map.get(key)) === J(['images/thumbnail/371i_idle.jpg']), J([rule, key, [...map]]))
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
