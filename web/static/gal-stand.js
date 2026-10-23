// 立绘层（renpy-minashigo 的 stand 指令）：一组「立绘图集上裁出的一块」叠在一起，画在一个 1920x1080 的 canvas 上（CSS 缩放到舞台大小）。
//   part = { src, crop?: [x, y, w, h], zoom, x, y }：从图集 src 的 crop 区域裁出来，按 zoom 缩放后画在 (x, y)（相对立绘左上角）
// 整个立绘按 Ren'Py 的默认摆法放：底边对齐画面底边、水平居中。图缺了就报 onMissing（顶部提示「缺少资源」），别的部件照画。
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
      const zoom = Number(part.zoom) || 1
      return { img, sx, sy, sw, sh, dx: Number(part.x) || 0, dy: Number(part.y) || 0, dw: sw * zoom, dh: sh * zoom }
    }).filter(Boolean)
    const width = Math.max(0, ...items.map((it) => it.dx + it.dw))
    const height = Math.max(0, ...items.map((it) => it.dy + it.dh))
    return { items, ox: (DESIGN_W - width) / 2, oy: DESIGN_H - height }
  }

  async function set(stand) {
    const mine = ++seq
    const parts = stand?.parts || []
    if (!parts.length) { ctx.clearRect(0, 0, DESIGN_W, DESIGN_H); canvas.dataset.parts = '0'; return }
    const loaded = await Promise.all(parts.map((part) => load(part.src)))
    if (mine !== seq) return   // 加载期间又换了立绘：丢掉这次
    const { items, ox, oy } = layout(parts, loaded)
    ctx.clearRect(0, 0, DESIGN_W, DESIGN_H)
    for (const it of items) ctx.drawImage(it.img, it.sx, it.sy, it.sw, it.sh, ox + it.dx, oy + it.dy, it.dw, it.dh)
    canvas.dataset.parts = String(items.length)
  }

  return { set, canvas, destroy: () => { seq += 1; canvas.remove(); images.clear() } }
}
