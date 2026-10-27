#!/usr/bin/env node
// 自测（只用 node）：Ren'Py 多行 Composite(...) 图片定义——renpy-common 的 readComposites / buildRenpyContext，renpy-monmusu / renpy-legeclo 的 scene 解析，composite 选项开关。
//   node scripts/dev/gal-renpy-composite-selftest.mjs
import * as legeclo from '../../web/library/gal/adapters/renpy-legeclo.mjs'
import * as monmusu from '../../web/library/gal/adapters/renpy-monmusu.mjs'
import { readComposites } from '../../web/library/gal/adapters/renpy-common.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const isImg = (e) => ['png', 'jpg', 'jpeg', 'webp'].includes(e)

const defs = `# 合成图
image ms0101b6 01 = Composite(
    (1280, 720),
    (0,0), "images/ev/ms0101b6_base.png",   # 底图 (带括号的注释)
    (0,0), "images/ev/ms0101b6_face.png",
    (10, 20), 'images/ev/ms0101b6_fx(1).png',
)
image single = Composite((100, 100), (0, 0), "images/ev/only.png")
image plain = "images/bg/plain.jpg"
image broken = Composite(
    (0,0), "images/ev/never_closed.png",
image movie_x = Movie(play="movies/x.webm")
`
const found = readComposites(defs, isImg)
check('readComposites：多行 + 名字带空格 + 单双引号 + 注释 / 字符串里的括号；没有图层 / 没闭合的不算', J(found) === J([
  { name: 'ms0101b6 01', layers: ['images/ev/ms0101b6_base.png', 'images/ev/ms0101b6_face.png', 'images/ev/ms0101b6_fx(1).png'], size: [1280, 720] },
  { name: 'single', layers: ['images/ev/only.png'], size: [100, 100] },
]), J(found))

const files = ['images/ev/ms0101b6_base.png', 'images/ev/ms0101b6_face.png', 'images/ev/ms0101b6_fx(1).png', 'images/ev/only.png', 'images/bg/plain.jpg', 'images/bg/other.jpg']
const script = `label h0101:
    scene ms0101b6 01 with Dissolve(0.5)
    "名字" "第一句"
    scene single
    "第二句"
    scene plain
    "第三句"
    scene other
    "第四句"
`
const bgs = (scene) => scene.steps.flatMap((s) => s.commands).filter((c) => c.op === 'bg')
for (const [label, mod, id] of [['monmusu', monmusu, 'renpy-monmusu'], ['legeclo', legeclo, 'renpy-legeclo']]) {
  const options = {}
  const ctx = mod.prepare({ options, texts: { 'script/movie.rpy': defs }, files, toResourcePath: (r) => r })
  check(`${label}：context.composites 有两个合成图（名字按空格归一 / 不分大小写）；images 指向第一层`, ctx.composites.size === 2 && ctx.composites.get('ms0101b6 01').length === 3 && ctx.images.get('ms0101b6 01') === 'images/ev/ms0101b6_base.png', J([...ctx.composites]))
  const { steps, stats } = mod.parse(script, ctx, { options })
  const list = bgs({ steps })
  check(`${label}：scene "ms0101b6 01" → bg src = 第一层、over = 最后一层；单层 composite 没有 over；普通 image / 目录索引照旧`, list.length === 4 && list[0].src === 'images/ev/ms0101b6_base.png' && list[0].over === 'images/ev/ms0101b6_fx(1).png' && list[0].fade === 0.5 && list[1].src === 'images/ev/only.png' && !('over' in list[1]) && list[2].src === 'images/bg/plain.jpg' && list[3].src === 'images/bg/other.jpg' && !Object.keys(stats.unresolved).length, J([list, stats]))
  const off = { composite: { enabled: false } }
  const ctxOff = mod.prepare({ options: off, texts: { 'script/movie.rpy': defs }, files, toResourcePath: (r) => r })
  const parsedOff = mod.parse(script, ctxOff, { options: off })
  check(`${label}：composite.enabled = false → 不读合成图，scene 记 unresolved（和以前一样）`, !ctxOff.composites.size && parsedOff.stats.unresolved['ms0101b6 01'] === 1 && parsedOff.stats.unresolved.single === 1, J(parsedOff.stats))
  check(`${label}：DEFAULT_OPTIONS.composite = { enabled: true, byName: false }（id ${id}）`, J(mod.DEFAULT_OPTIONS.composite) === J({ enabled: true, byName: false }))
}
// 图层名没有扩展名 / 不是图片的字符串（Composite 的第一个参数是尺寸元组，不是字符串）不会被当图层
check('尺寸元组 / 没有图片扩展名的字符串不算图层', J(readComposites('image a = Composite((1, 2), (0,0), "noext", (0,0), "x.txt")\n', isImg)) === '[]')
// 显式的 image X = "…" 在前，同名 Composite 不覆盖
const explicit = monmusu.prepare({ options: {}, texts: { a: 'image dup = "images/bg/plain.jpg"\nimage dup = Composite((1,1), (0,0), "images/ev/only.png")\n' }, files, toResourcePath: (r) => r })
check('同名时先出现的 image X = "…" 赢，Composite 不覆盖', explicit.images.get('dup') === 'images/bg/plain.jpg' && !explicit.composites.has('dup'), J([...explicit.images]))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
