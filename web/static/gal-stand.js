// 立绘层（renpy-minashigo / renpy-legeclo 的 stand 指令）：画在一个 1920x1080 的 canvas 上（CSS 缩放到舞台大小）。
//   part = { src, crop?: [x, y, w, h], zoom, x, y, align?, dim? }   dim = 0~1 的亮度（压暗）
//   minashigo：一组「立绘图集上裁出的一块」叠成一个立绘，part 画在 (x, y)（相对立绘左上角），整体按 Ren'Py 的默认摆法放（底边对齐画面底边、水平居中）。
//   legeclo：每个部件是一整张立绘图（没有 crop），可以带 align: 'left' | 'center' | 'right'（show xxx at left）——有 align 的部件各自独立摆放，
//   底边对齐画面底边，水平按 align 贴左 / 居中 / 贴右（和 Ren'Py 的 xalign 0 / 0.5 / 1 一样）；没有 align 的还是上面那种整体摆法。
//   grenze：同 legeclo（整张图 + align），另带 fit: 1（图比画面高就缩到画面高度）。
// 图缺了就报 onMissing（顶部提示「缺少资源」），别的部件照画。
const DESIGN_W = 1920
const DESIGN_H = 1080

export function createStandLayer({ parent, url, onMissing = () => {} }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'gal-stand'
  canvas.width = DESIGN_W
  canvas.height = DESIGN_H
  parent.append(canvas)
  const ctx = canvas.getContext('2d')
  const images = new Map()   // src → Promise<HTMLImageElement | null>
  let seq = 0

  const load = (src) => {
    if (!images.has(src)) {
      images.set(src, new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => { onMissing(src); resolve(null) }
        img.src = url(src)
      }))
    }
    return images.get(src)
  }

  // 布局：每个部件画出来的大小 = crop（没有 crop 就是整张图）× zoom；整体包围盒决定摆放
  function layout(parts, loaded) {
    const items = parts.map((part, i) => {
      const img = loaded[i]
      if (!img) return null
      const [sx, sy, sw, sh] = part.crop || [0, 0, img.naturalWidth, img.naturalHeight]
      const zoom = part.fit && sh * (Number(part.zoom) || 1) > DESIGN_H ? DESIGN_H / sh : Number(part.zoom) || 1   // fit：比画面还高的整张立绘（grenze 的 body 有 1426×1580）缩到画面高度，矮的不放大
      return { img, sx, sy, sw, sh, dx: Number(part.x) || 0, dy: Number(part.y) || 0, dw: sw * zoom, dh: sh * zoom, align: ['left', 'center', 'right'].includes(part.align) ? part.align : '', dim: Number(part.dim) > 0 && Number(part.dim) < 1 ? Number(part.dim) : 0 }
    }).filter(Boolean)
    const grouped = items.filter((it) => !it.align)
    const width = Math.max(0, ...grouped.map((it) => it.dx + it.dw))
    const height = Math.max(0, ...grouped.map((it) => it.dy + it.dh))
    const ox = (DESIGN_W - width) / 2
    const oy = DESIGN_H - height
    // 有 align 的部件：各自的位置（左上角）算好，画的时候不再加整体的偏移
    for (const it of items) {
      if (!it.align) continue
      it.fixedX = it.align === 'left' ? 0 : it.align === 'right' ? DESIGN_W - it.dw : (DESIGN_W - it.dw) / 2
      it.fixedY = DESIGN_H - it.dh
    }
    return { items, ox, oy }
  }

  async function set(stand) {
    const mine = ++seq
    const parts = stand?.parts || []
    if (!parts.length) { ctx.clearRect(0, 0, DESIGN_W, DESIGN_H); canvas.dataset.parts = '0'; return }
    const loaded = await Promise.all(parts.map((part) => load(part.src)))
    if (mine !== seq) return   // 加载期间又换了立绘：丢掉这次
    const { items, ox, oy } = layout(parts, loaded)
    ctx.clearRect(0, 0, DESIGN_W, DESIGN_H)
    for (const it of items) {
      ctx.filter = it.dim ? `brightness(${it.dim})` : 'none'   // dim：不说话的角色压暗（Fruits 的 ACTOR_COLOR_FILTER dark）
      ctx.drawImage(it.img, it.sx, it.sy, it.sw, it.sh, it.align ? it.fixedX : ox + it.dx, it.align ? it.fixedY : oy + it.dy, it.dw, it.dh)
    }
    ctx.filter = 'none'
    canvas.dataset.parts = String(items.length)
  }

  return { set, canvas, destroy: () => { seq += 1; canvas.remove(); images.clear() } }
}
