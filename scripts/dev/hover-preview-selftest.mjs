#!/usr/bin/env node
// 悬停放大层的尺寸/位置纯函数单测：node scripts/dev/hover-preview-selftest.mjs
import { fitPreview, placeExpanded, worthExpanding, HOVER_MARGIN, HOVER_MAX_COVER_RATIO } from '../../web/static/hover-preview.js'

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

const cover = (left, top, w = 160, h = 213) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h })
let p = placeExpanded({ coverRect: cover(500, 300), width: 400, height: 560, ...vp })
check('以封面中心为锚点居中展开', p.left === 380 && Math.abs(p.top - 127) <= 1, JSON.stringify(p))
p = placeExpanded({ coverRect: cover(10, 300), width: 400, height: 560, ...vp })
check('靠左：夹到左边距', p.left === HOVER_MARGIN, JSON.stringify(p))
p = placeExpanded({ coverRect: cover(1200, 300), width: 400, height: 560, ...vp })
check('靠右：夹到右边距，整体在视口内', p.left + 400 === 1280 - HOVER_MARGIN, JSON.stringify(p))
p = placeExpanded({ coverRect: cover(500, -100), width: 400, height: 560, ...vp })
check('封面被滚出视口顶部：夹到顶边距', p.top === HOVER_MARGIN, JSON.stringify(p))
p = placeExpanded({ coverRect: cover(500, 700), width: 400, height: 560, ...vp })
check('靠底：夹到底边距', p.top + 560 === 800 - HOVER_MARGIN, JSON.stringify(p))
p = placeExpanded({ coverRect: cover(0, 0, 1280, 800), width: 500, height: 500, ...vp })
check('封面占满视口：仍在视口内', p.left >= HOVER_MARGIN && p.top >= HOVER_MARGIN && p.left + 500 <= 1280 && p.top + 500 <= 800, JSON.stringify(p))

// 卡宽 160 → 封面框 160x213：maxWidth = 160 * 2.5 = 400
r = fitPreview({ naturalWidth: 400, naturalHeight: 566, ...vp, maxWidth: 160 * HOVER_MAX_COVER_RATIO })
check('卡宽 160：漫画 400x566 展开到 ≤400 宽（不超过封面的 2.5 倍），比例不变', r.width <= 400 && Math.abs(r.width / r.height - 400 / 566) < 0.01, JSON.stringify(r))
r = fitPreview({ naturalWidth: 1200, naturalHeight: 400, ...vp, maxWidth: 160 * HOVER_MAX_COVER_RATIO })
check('卡宽 160：超宽 3:1 展开到 400x133', r.width === 400 && r.height === 133, JSON.stringify(r))
check('worthExpanding：40x40 的小图（展开后 50x50 < 封面框）不展开', !worthExpanding({ width: 50, height: 50 }, cover(0, 0)))
check('worthExpanding：400x133 比封面框宽 → 展开', worthExpanding({ width: 400, height: 133 }, cover(0, 0)))
check('worthExpanding：和封面框一样大 → 不展开', !worthExpanding({ width: 160, height: 213 }, cover(0, 0)))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
