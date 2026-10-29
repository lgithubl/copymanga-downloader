#!/usr/bin/env node
// 自测（纯 node）：图集页尺寸和 PNG 对不上时的对齐（web/static/gal-spine-atlas.js）
//   · atlasPageGeometry：bounds / rotate 解析（90 / 270 的包围矩形是 h×w，180 不交换）
//   · findCropOffset：PNG 被裁掉上 / 左的透明行（内容没缩）→ 找回偏移；整体缩放的 PNG（内容按比例缩了）→ 不动；尺寸相同 / 差太多 → 不动
//   node scripts/dev/gal-spine-atlas-selftest.mjs
import { atlasPageGeometry, findCropOffset } from '../../web/static/gal-spine-atlas.js'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const ATLAS = `page.png
size:400,400
filter:Linear,Linear
scale:0.5
a
bounds:10,60,100,50
b
bounds:150,80,40,90
rotate:90
c
bounds:220,200,120,60
offsets:2,3,124,66
rotate:180
d
bounds:30,250,80,80
`
const pages = atlasPageGeometry(ATLAS)
check('atlasPageGeometry：页名 / 声明尺寸 / 4 个区域；rotate:90 的矩形是 h×w，rotate:180 不交换', pages.length === 1 && pages[0].name === 'page.png' && pages[0].width === 400 && pages[0].height === 400 && J(pages[0].rects) === J([{ x: 10, y: 60, w: 100, h: 50 }, { x: 150, y: 80, w: 90, h: 40 }, { x: 220, y: 200, w: 120, h: 60 }, { x: 30, y: 250, w: 80, h: 80 }]), J(pages))
check('老格式（xy: / size:）的图集不报错，区域为空', atlasPageGeometry('p.png\nsize: 64,64\nformat: RGBA8888\nr\n  rotate: false\n  xy: 1, 1\n  size: 8, 8\n')[0].rects.length === 0)

// 合成「图集」：在声明大小的画布上按矩形画不透明块，然后裁掉上 / 左若干行得到 PNG 的 alpha
const DW = 400
const DH = 400
const rects = pages[0].rects
const canvas = new Uint8Array(DW * DH)
for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) canvas[y * DW + x] = 255
const crop = (left, top) => {
  const w = DW - left
  const h = DH - top
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = canvas[(y + top) * DW + x + left]
  return { alpha: out, w, h }
}
const c1 = crop(0, 36)
const r1 = findCropOffset({ ...c1, dw: DW, dh: DH, rects })
check('上边被裁 36 行（400 高的合成图，约 9%）：识别为裁剪，偏移 (0, 36)', r1.mode === 'pad' && r1.ox === 0 && r1.oy === 36, J(r1))
const c2 = crop(17, 30)
const r2 = findCropOffset({ ...c2, dw: DW, dh: DH, rects })
check('左 17 / 上 30 被裁：偏移 (17, 30)', r2.mode === 'pad' && r2.ox === 17 && r2.oy === 30, J(r2))

// 整体缩放：内容按比例缩小（声明 400×400，PNG 360×380，非均匀）→ 不动
const sx = 360 / DW
const sy = 380 / DH
const scaled = new Uint8Array(360 * 380)
for (const r of rects) for (let y = Math.round(r.y * sy); y < Math.round((r.y + r.h) * sy); y++) for (let x = Math.round(r.x * sx); x < Math.round((r.x + r.w) * sx); x++) scaled[y * 360 + x] = 255
const r3 = findCropOffset({ alpha: scaled, w: 360, h: 380, dw: DW, dh: DH, rects })
check('整体（非均匀）缩放的 PNG：不当作裁剪（缩放法残差更小），不动', r3.mode === 'none', J(r3))
check('尺寸相同：不动', findCropOffset({ alpha: canvas, w: DW, h: DH, dw: DW, dh: DH, rects }).mode === 'none')
check('PNG 比声明大（4096 对 2048 这种整体缩放）：不动', findCropOffset({ alpha: new Uint8Array(800 * 800), w: 800, h: 800, dw: DW, dh: DH, rects }).mode === 'none')
check('差太多（裁掉 150 行）：不当作裁剪', findCropOffset({ ...crop(0, 150), dw: DW, dh: DH, rects }).mode === 'none')
check('没有区域矩形（老格式 atlas）：不动', findCropOffset({ ...c1, dw: DW, dh: DH, rects: [] }).mode === 'none')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
