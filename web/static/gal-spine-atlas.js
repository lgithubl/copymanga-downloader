// 图集页尺寸和 PNG 对不上时的对齐（TSK 的 Stills：atlas 声明 2048×2048，PNG 实际 2048×2003——最上面的 45 行透明行被导出工具裁掉了，区域坐标没改）。
// 运行时按声明尺寸归一化 UV（u = x / 2048、v = y / 2048），PNG 少了 45 行，整张图集的内容就整体上移，越靠上的区域错得越多：脸的部件、衔接处全错位。
// 两种不一致要分开：
//   · 整体缩放（声明 4096、PNG 2048；声明 1513×1896、PNG 1024×2048）——内容按比例缩了，归一化 UV 本来就对，不能动
//   · 边缘被裁（PNG 比声明小几十像素，内容没缩，只是少了一圈）——要把 PNG 贴回声明大小的画布里（偏移 ox / oy），UV 才对
// 怎么分：用 atlas 的区域矩形当模板，找「不透明像素落在矩形之外最少」的偏移；偏移法残差明显小于缩放法才采用（没有把握就不动）。
const MAX_CROP = 96            // 最多裁掉几十像素（再多就不当作裁剪）
const MIN_RATIO = 0.9          // PNG 至少是声明尺寸的 90%（否则肯定不是边缘裁剪）
const OPAQUE = 24              // alpha 大于这个算内容

// 解析一页的区域矩形：bounds:x,y,w,h，rotate 90 / 270 时包围矩形是 h×w（Spine 4.x 新格式）。老格式（xy: / size:）不处理，返回空
export function atlasPageGeometry(atlasText) {
  const pages = []
  let page = null
  let region = null
  for (const raw of String(atlasText).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) { page = null; region = null; continue }
    if (/\.(?:png|jpe?g|webp)$/i.test(line) && !line.includes(':')) { page = { name: line, width: 0, height: 0, rects: [] }; pages.push(page); region = null; continue }
    if (!page) continue
    const size = /^size:\s*(\d+)\s*,\s*(\d+)/.exec(line)
    if (size && !region) { page.width = Number(size[1]); page.height = Number(size[2]); continue }
    if (!line.includes(':')) { region = { x: 0, y: 0, w: 0, h: 0, rot: 0 }; page.rects.push(region); continue }
    if (!region) continue
    const bounds = /^bounds:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(line)
    if (bounds) { region.x = Number(bounds[1]); region.y = Number(bounds[2]); region.w = Number(bounds[3]); region.h = Number(bounds[4]); continue }
    const rotate = /^rotate:\s*(\S+)/.exec(line)
    if (rotate) region.rot = rotate[1] === 'true' ? 90 : (Number(rotate[1]) || 0)
  }
  return pages.map((p) => ({ ...p, rects: p.rects.filter((r) => r.w > 0 && r.h > 0).map((r) => (r.rot === 90 || r.rot === 270 ? { x: r.x, y: r.y, w: r.h, h: r.w } : { x: r.x, y: r.y, w: r.w, h: r.h })) }))
}

function rectMask(dw, dh, rects, margin, scaleX = 1, scaleY = 1, outW = dw, outH = dh) {
  const mask = new Uint8Array(outW * outH)
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x * scaleX) - margin)
    const y0 = Math.max(0, Math.floor(r.y * scaleY) - margin)
    const x1 = Math.min(outW, Math.ceil((r.x + r.w) * scaleX) + margin)
    const y1 = Math.min(outH, Math.ceil((r.y + r.h) * scaleY) + margin)
    for (let y = y0; y < y1; y++) mask.fill(1, y * outW + x0, y * outW + x1)
  }
  return mask
}

// 不透明像素（按 step 抽样列）落在模板之外的个数；偏移 (ox, oy) = PNG 左上角在声明画布里的位置
function residual(opaque, w, h, mask, dw, ox, oy, step) {
  let n = 0
  for (let y = 0; y < h; y++) {
    const row = y * w
    const mrow = (y + oy) * dw + ox
    for (let x = 0; x < w; x += step) if (opaque[row + x] && !mask[mrow + x]) n += 1
  }
  return n
}

// alpha：长度 w×h 的 alpha 通道（0～255）；返回 { mode: 'pad', ox, oy, residual, stretch } 或 { mode: 'none', reason }
export function findCropOffset({ alpha, w, h, dw, dh, rects }) {
  if (!(dw > 0 && dh > 0) || !rects?.length) return { mode: 'none', reason: 'no-rects' }
  if (w === dw && h === dh) return { mode: 'none', reason: 'same-size' }
  if (w > dw || h > dh || dw - w > MAX_CROP || dh - h > MAX_CROP || w / dw < MIN_RATIO || h / dh < MIN_RATIO) return { mode: 'none', reason: 'not-a-crop' }
  const opaque = new Uint8Array(w * h)
  let total = 0
  for (let i = 0; i < opaque.length; i++) if (alpha[i] > OPAQUE) { opaque[i] = 1; total += 1 }
  if (total < 200) return { mode: 'none', reason: 'empty' }
  const mask = rectMask(dw, dh, rects, 1)
  const maxOx = dw - w
  const maxOy = dh - h
  // 坐标下降：先扫 oy（列抽样 3），再扫 ox，再用全分辨率细调一轮
  let ox = 0
  let oy = 0
  let best = Infinity
  for (let y = 0; y <= maxOy; y++) { const r = residual(opaque, w, h, mask, dw, ox, y, 3); if (r < best) { best = r; oy = y } }
  best = Infinity
  for (let x = 0; x <= maxOx; x++) { const r = residual(opaque, w, h, mask, dw, x, oy, 3); if (r < best) { best = r; ox = x } }
  best = Infinity
  let bx = ox
  let by = oy
  for (let y = Math.max(0, oy - 3); y <= Math.min(maxOy, oy + 3); y++) for (let x = Math.max(0, ox - 3); x <= Math.min(maxOx, ox + 3); x++) {
    const r = residual(opaque, w, h, mask, dw, x, y, 1)
    // 并列取偏移大的（裁掉的多半在上 / 左，PNG 贴回去靠下 / 右）
    if (r < best || (r === best && x + y > bx + by)) { best = r; bx = x; by = y }
  }
  // 裁掉的整圈透明边几乎总是在上 / 左（PNG 贴回去靠下 / 右）：满偏移的残差只比最好的多一点点时，取满偏移（偏移在几个像素内都对得上，只是边缘抗锯齿的差别）
  const full = residual(opaque, w, h, mask, dw, maxOx, maxOy, 1)
  if (full <= best + 3) { bx = maxOx; by = maxOy; best = full }
  // 缩放法的残差：矩形按 PNG / 声明的比例缩到 PNG 尺寸
  const stretchMask = rectMask(dw, dh, rects, 1, w / dw, h / dh, w, h)
  const stretch = residual(opaque, w, h, stretchMask, w, 0, 0, 1)
  const ok = best <= total * 0.004 && stretch > best * 3 + 200
  return ok ? { mode: 'pad', ox: bx, oy: by, residual: best, stretch, total } : { mode: 'none', reason: 'stretch-fits-as-well', residual: best, stretch, total }
}
