#!/usr/bin/env node
// 悬停放大层的尺寸/位置纯函数单测：node scripts/dev/hover-preview-selftest.mjs
import { fitPreview, placePopover, sideRoom, HOVER_GAP, HOVER_MARGIN } from '../../web/static/hover-preview.js'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const vp = { viewportWidth: 1280, viewportHeight: 800 }

let r = fitPreview({ naturalWidth: 400, naturalHeight: 566, ...vp })
check('漫画 400x566：高 ≤ 视口 80%（640），放大不超过 1.25 倍', r.height <= 640 && r.width <= 500 && r.height <= 708, JSON.stringify(r))
r = fitPreview({ naturalWidth: 400, naturalHeight: 300, ...vp })
check('横图 400x300：只放大到 1.25 倍 → 500x375', r.width === 500 && r.height === 375, JSON.stringify(r))
r = fitPreview({ naturalWidth: 100, naturalHeight: 100, ...vp })
check('小图 100x100：最多 125x125，不硬拉大', r.width === 125 && r.height === 125, JSON.stringify(r))
r = fitPreview({ naturalWidth: 400, naturalHeight: 2000, ...vp })
check('超高图 400x2000：高度封顶 640，宽按比例缩小', r.height === 640 && r.width === 128, JSON.stringify(r))
r = fitPreview({ naturalWidth: 3000, naturalHeight: 400, ...vp })
check('超宽图 3000x400：宽度封顶视口一半 640', r.width === 640 && r.height === 85, JSON.stringify(r))
r = fitPreview({ naturalWidth: 400, naturalHeight: 566, viewportWidth: 1280, viewportHeight: 300 })
check('矮视口 300：高度封顶 240', r.height === 240, JSON.stringify(r))
check('无效尺寸 → null', fitPreview({ naturalWidth: 0, naturalHeight: 10, ...vp }) === null && fitPreview({ naturalWidth: NaN, naturalHeight: 10, ...vp }) === null)

const card = (left, top, w = 250, h = 480) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h })
let p = placePopover({ cardRect: card(100, 100), width: 400, height: 500, ...vp })
check('右侧放得下 → 右侧，紧挨卡片（间隔 GAP）', p.side === 'right' && p.left === 350 + HOVER_GAP, JSON.stringify(p))
p = placePopover({ cardRect: card(900, 100), width: 400, height: 500, ...vp })
check('右侧放不下 → 左侧', p.side === 'left' && p.left === 900 - HOVER_GAP - 400, JSON.stringify(p))
p = placePopover({ cardRect: card(100, 100), width: 400, height: 500, ...vp })
check('垂直居中对齐卡片中线', p.top === Math.round(100 + 240 - 250), JSON.stringify(p))
p = placePopover({ cardRect: card(100, -200), width: 400, height: 500, ...vp })
check('卡片顶部被滚出视口 → 夹到顶部边距', p.top === HOVER_MARGIN, JSON.stringify(p))
p = placePopover({ cardRect: card(100, 700), width: 400, height: 500, ...vp })
check('卡片靠底 → 夹到底部边距', p.top === 800 - 500 - HOVER_MARGIN, JSON.stringify(p))
p = placePopover({ cardRect: card(200, 100, 700, 480), width: 500, height: 500, ...vp })
check('两侧都放不下 → 取空间大的一侧，且整体仍在视口内', p.left >= HOVER_MARGIN && p.left + 500 <= 1280 - HOVER_MARGIN, JSON.stringify(p))
p = placePopover({ cardRect: card(0, 0, 1280, 800), width: 500, height: 500, ...vp })
check('卡片占满视口：仍夹在视口内', p.left >= HOVER_MARGIN && p.top >= HOVER_MARGIN && p.left + 500 <= 1280, JSON.stringify(p))

r = fitPreview({ naturalWidth: 1200, naturalHeight: 400, ...vp, maxWidth: 300 })
check('maxWidth 限制：超宽图缩到 300x100', r.width === 300 && r.height === 100, JSON.stringify(r))
const cr = card(616, 100, 253, 480)
const room = sideRoom({ cardRect: cr, viewportWidth: 1280 })
check('sideRoom：取左右较宽一侧并扣掉间隔/边距', room === Math.max(1280 - 869 - HOVER_GAP - HOVER_MARGIN, 616 - HOVER_GAP - HOVER_MARGIN), String(room))
r = fitPreview({ naturalWidth: 1200, naturalHeight: 400, ...vp, maxWidth: room })
p = placePopover({ cardRect: cr, width: r.width, height: r.height, ...vp })
check('用 sideRoom 限宽后放得下一侧，不压卡片', p.side === 'left' && p.left + r.width <= 616 - HOVER_GAP + 1, JSON.stringify([r, p]))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
