// 立绘层（renpy-minashigo / renpy-legeclo 的 stand 指令）：画在一个 1920x1080 的 canvas 上（CSS 缩放到舞台大小）。
//   part = { src, crop?: [x, y, w, h], zoom, x, y, align?, dim? }   dim = 0~1 的亮度（压暗）
//   minashigo：一组「立绘图集上裁出的一块」叠成一个立绘，part 画在 (x, y)（相对立绘左上角），整体按 Ren'Py 的默认摆法放（底边对齐画面底边、水平居中）。
//   legeclo：每个部件是一整张立绘图（没有 crop），可以带 align: 'left' | 'center' | 'right'（show xxx at left）——有 align 的部件各自独立摆放，
//   底边对齐画面底边，水平按 align 贴左 / 居中 / 贴右（和 Ren'Py 的 xalign 0 / 0.5 / 1 一样）；没有 align 的还是上面那种整体摆法。
//   grenze：同 legeclo（整张图 + align），另带 fit: 1（图比画面高就缩到画面高度）。
// 图缺了就报 onMissing（顶部提示「缺少资源」），别的部件照画。
//
// 按槽位的立绘（stand 指令带 slot）和图集帧（part.atlas，Cocos2d plist）：画在同一个 canvas 上（先画上面的整体立绘，再按槽位顺序叠）。
//   slot 立绘 = { slot, parts: [part], fade?, stage?: [w, h] }；part = { atlas | src, x?, y?, scale?, dim? }
//     坐标是「舞台像素」（stage 默认 1280x720，整个舞台按比例铺满 1920x1080 的 canvas）：x / y = 原图画布（图集里就是 spriteSourceSize 那块；整张图就是图本身）的中心相对舞台中心的偏移，y 向下为正（适配器负责把「y 向上」的游戏换算过来）；scale 默认 1；scale <= 0 = 隐藏（不加载）
//     atlas = { plist, frame | frames, texture?, base? }：plist / texture 是资源路径（texture 缺省 = plist 换成 .png）；frames = 候选帧名（第一个在 plist 里存在的）；base = 底图帧名（存在才画，先画）。plist 由这里拉取、解析（gal-atlas.js），按 URL 缓存
//     fade：槽位第一次出现时淡入（秒，只在实时播放时；消失是立即的）
//   plist 取不到 / 解析失败 / 找不到帧 / 贴图取不到 = 报 onMissing（plist 路径 / 「plist#帧名」/ 贴图路径），别的照画。
// 叠加层（overlay 指令）在 createOverlayLayer：静态图 / 矩形，见该函数上面的注释。
import { atlasFrames, framePlacement, parsePlist, resolveAtlasFrames } from '/gal-atlas.js'
import { easeOf } from '/gal-engine.js'

const DESIGN_W = 1920
const DESIGN_H = 1080
const DEFAULT_STAGE = [1280, 720]
const COLOR_RE = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-20000, Math.min(20000, n)) : d }
const clamp01 = (v, d = 1) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d }

// 舞台像素 → canvas 像素：舞台等比放进 1920x1080（中心对齐）
function geometry(stage) {
  const [sw, sh] = Array.isArray(stage) && stage.length >= 2 && Number(stage[0]) > 0 && Number(stage[1]) > 0 ? [Number(stage[0]), Number(stage[1])] : DEFAULT_STAGE
  const k = Math.min(DESIGN_W / sw, DESIGN_H / sh)
  return { k, cx: DESIGN_W / 2, cy: DESIGN_H / 2, sw, sh }
}

// 图 / 图集的加载和缓存（立绘层和叠加层共用一份；失败报 onMissing，同一个路径只报一次）
export function createStageMedia({ url, onMissing = () => {} }) {
  const images = new Map()   // src → Promise<HTMLImageElement | null>
  const atlases = new Map()  // plist 路径|贴图路径 → Promise<{ frames, image } | null>
  const reported = new Set()
  const missing = (key) => { if (!reported.has(key)) { reported.add(key); onMissing(key) } }
  const image = (src) => {
    if (!images.has(src)) {
      images.set(src, new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => { missing(src); resolve(null) }
        img.src = url(src)
      }))
    }
    return images.get(src)
  }
  const atlas = (spec) => {
    const plist = String(spec?.plist || '')
    if (!plist) return Promise.resolve(null)
    const texture = String(spec.texture || plist.replace(/\.plist$/i, '.png'))
    const key = `${plist}|${texture}`
    if (!atlases.has(key)) {
      atlases.set(key, (async () => {
        let frames
        try {
          const response = await fetch(url(plist))
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          frames = atlasFrames(parsePlist(await response.text())).frames
        } catch { missing(plist); return null }
        const img = await image(texture)
        return img ? { frames, image: img } : null
      })())
    }
    return atlases.get(key)
  }
  return { image, atlas, missing }
}

// 一个槽位部件 → 可画的东西（加载 + 找帧）；失败 / 隐藏返回 null
async function resolvePart(media, part) {
  if (!part || typeof part !== 'object' || !(num(part.scale, 1) > 0)) return null
  if (part.atlas) {
    const loaded = await media.atlas(part.atlas)
    if (!loaded) return null
    const frames = resolveAtlasFrames(loaded.frames, part.atlas)
    if (!frames) { media.missing(`${part.atlas.plist}#${[part.atlas.frames ?? part.atlas.frame].flat().join('|')}`); return null }
    return { part, image: loaded.image, frames }
  }
  if (part.src) {
    const img = await media.image(part.src)
    return img ? { part, image: img, frames: null } : null
  }
  return null
}

function drawResolved(ctx, geo, item, alpha, off = [0, 0]) {
  const { part, image, frames } = item
  const scale = num(part.scale, 1)
  const s = geo.k * scale
  const px = geo.cx + geo.k * (num(part.x) + off[0])
  const py = geo.cy + geo.k * (num(part.y) + off[1])
  ctx.globalAlpha = alpha
  ctx.filter = Number(part.dim) > 0 && Number(part.dim) < 1 ? `brightness(${Number(part.dim)})` : 'none'
  if (!frames) {
    ctx.drawImage(image, px - (image.naturalWidth * s) / 2, py - (image.naturalHeight * s) / 2, image.naturalWidth * s, image.naturalHeight * s)
  } else {
    for (const frame of frames) {
      const f = framePlacement(frame)
      const cx = px + f.dx * s
      const cy = py + f.dy * s
      if (f.rotated) {   // 贴图里是顺时针转了 90° 存的：逆时针转回来画
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(-Math.PI / 2)
        ctx.drawImage(image, f.sx, f.sy, f.sw, f.sh, (-f.sw * s) / 2, (-f.sh * s) / 2, f.sw * s, f.sh * s)
        ctx.restore()
      } else ctx.drawImage(image, f.sx, f.sy, f.sw, f.sh, cx - (f.w * s) / 2, cy - (f.h * s) / 2, f.w * s, f.h * s)
    }
  }
  ctx.filter = 'none'
  ctx.globalAlpha = 1
}

// 第一次出现的槽位淡入：key → { born, seconds }；消失的从表里去掉（再出现又淡入）
function fadeTracker() {
  const born = new Map()
  return {
    sync(keys, live, fadeOf, now) {
      for (const key of [...born.keys()]) if (!keys.includes(key)) born.delete(key)
      for (const key of keys) if (!born.has(key)) born.set(key, live && fadeOf(key) > 0 ? { at: now, seconds: Math.min(10, fadeOf(key)) } : null)
    },
    alpha(key, now) {
      const f = born.get(key)
      if (!f) return 1
      return Math.max(0, Math.min(1, (now - f.at) / (f.seconds * 1000)))
    },
    active(now) { return [...born.values()].some((f) => f && now - f.at < f.seconds * 1000) },
    clear() { born.clear() },
  }
}

// 槽位当前的位置偏移（舞台像素）：offset 是动画都播完之后的累计偏移；这一步新开的 moves（实时播放才有）各自从 0 走到 to（缓动 ease、delay 秒后开始、seconds 秒），多个同时叠加（立绘抖动是十几个小动画一起跑）
function slotOffset(slot, now) {
  const final = slot.offset || [0, 0]
  if (!slot.moves?.length || slot.startAt === undefined) return { at: final, moving: false }
  let dx = final[0]
  let dy = final[1]
  let moving = false
  for (const move of slot.moves) {
    const elapsed = (now - slot.startAt) / 1000 - (move.delay || 0)
    const progress = move.seconds > 0 ? Math.max(0, Math.min(1, elapsed / move.seconds)) : 1
    if (progress < 1) moving = true
    const rest = 1 - easeOf(move.ease, progress)   // 还差多少没走完
    dx -= move.to[0] * rest
    dy -= move.to[1] * rest
  }
  return { at: [dx, dy], moving }
}

export function createStandLayer({ parent, url, onMissing = () => {}, media = null }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'gal-stand'
  canvas.width = DESIGN_W
  canvas.height = DESIGN_H
  parent.append(canvas)
  const ctx = canvas.getContext('2d')
  const shared = media || createStageMedia({ url, onMissing })
  const images = new Map()   // src → Promise<HTMLImageElement | null>（整体立绘用；失败报 onMissing）
  let seq = 0
  let frameRaf = 0
  const fades = fadeTracker()
  let drawn = null   // { legacy, slots: [{ slot, geo, items }] }：最近一次解析好的内容（淡入时按帧重画）

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

  function paint(now = performance.now()) {
    frameRaf = 0
    ctx.clearRect(0, 0, DESIGN_W, DESIGN_H)
    if (!drawn) return
    if (drawn.legacy) {
      const { items, ox, oy } = drawn.legacy
      for (const it of items) {
        ctx.filter = it.dim ? `brightness(${it.dim})` : 'none'   // dim：不说话的角色压暗（Fruits 的 ACTOR_COLOR_FILTER dark）
        ctx.drawImage(it.img, it.sx, it.sy, it.sw, it.sh, it.align ? it.fixedX : ox + it.dx, it.align ? it.fixedY : oy + it.dy, it.dw, it.dh)
      }
      ctx.filter = 'none'
    }
    let moving = false
    for (const slot of drawn.slots) {
      const off = slotOffset(slot, now)
      if (off.moving) moving = true
      for (const item of slot.items) drawResolved(ctx, slot.geo, item, fades.alpha(slot.slot, now), off.at)
    }
    if (moving || fades.active(now)) frameRaf = requestAnimationFrame(paint)
  }

  // stand：整体立绘（旧行为，{ parts: [{ src, crop?, zoom, … }] }）；stands：按槽位的立绘 [{ slot, parts, fade?, stage? }]；live：实时播放（槽位第一次出现时才淡入）
  async function set(stand, stands = null, { live = false } = {}) {
    const mine = ++seq
    cancelAnimationFrame(frameRaf)
    frameRaf = 0
    const parts = stand?.parts || []
    const slots = Array.isArray(stands) ? stands.filter((s) => s && typeof s === 'object' && Array.isArray(s.parts)) : []
    if (!parts.length && !slots.length) { drawn = null; fades.clear(); ctx.clearRect(0, 0, DESIGN_W, DESIGN_H); canvas.dataset.parts = '0'; canvas.dataset.slots = '[]'; return }
    const [loaded, resolved] = await Promise.all([
      Promise.all(parts.map((part) => load(part.src))),
      Promise.all(slots.map((slot) => Promise.all(slot.parts.map((part) => resolvePart(shared, part))))),
    ])
    if (mine !== seq) return   // 加载期间又换了立绘：丢掉这次
    const legacy = parts.length ? layout(parts, loaded) : null
    const now = performance.now()
    const drawnSlots = slots.map((slot, i) => ({ slot: String(slot.slot), geo: geometry(slot.stage), items: resolved[i].filter(Boolean), offset: Array.isArray(slot.offset) ? [num(slot.offset[0]), num(slot.offset[1])] : null, ...(live && Array.isArray(slot.moves) && slot.moves.length ? { moves: slot.moves.filter((m) => m && Array.isArray(m.to)).map((m) => ({ to: [num(m.to[0]), num(m.to[1])], seconds: Math.max(0, num(m.seconds)), ease: Math.trunc(num(m.ease)), delay: Math.max(0, num(m.delay)) })), startAt: now } : {}) }))
    drawn = { legacy, slots: drawnSlots }
    fades.sync(drawnSlots.map((s) => s.slot), live, (key) => num(slots.find((s) => String(s.slot) === key)?.fade), now)
    paint(now)
    canvas.dataset.parts = String((legacy?.items.length || 0) + drawnSlots.reduce((n, s) => n + s.items.length, 0))
    canvas.dataset.slots = JSON.stringify(slots.map((s) => String(s.slot)))
  }

  return { set, canvas, destroy: () => { seq += 1; cancelAnimationFrame(frameRaf); canvas.remove(); images.clear() } }
}

// ---------- 叠加层（overlay 指令）：静态图 / 矩形，画在立绘之上 ----------
//   overlay = { slot, src?, rect?: [x, y, w, h], color?, alpha?, x?, y?, scaleX?, scaleY?, fit?, fade?, z?, stage? }（同 slot 再来一条 = 引擎已经合并好了，这里只管画）
//   src：图（资源路径），以「舞台中心 + (x, y)」为中心画（y 向下为正），大小 = 原图 × fit 系数 × (scaleX, scaleY)；fit：none（默认）| contain | cover（先把图缩放到舞台大小再乘 scale）
//   rect：舞台像素里的矩形（左上角 + 宽高，y 向下；再加上 x / y 偏移、宽高乘 scaleX / scaleY）。没有 src 时用 color 填它（color 缺省黑色；rect 缺省整个舞台）；有 src 时 rect 是裁剪窗口（图只在它里面可见）
//   alpha：0~1（默认 1）；alpha / scaleX / scaleY <= 0 = 隐藏；z：越大越靠上（同 z 按出现顺序）；fade：第一次出现淡入（秒，实时播放时）。图缺了报 onMissing。
export function createOverlayLayer({ parent, url, onMissing = () => {}, media = null, under = false }) {
  const canvas = document.createElement('canvas')
  canvas.className = under ? 'gal-overlay gal-overlay-under' : 'gal-overlay'   // under：画在立绘 / 骨骼之下（背景的前景部件）
  canvas.width = DESIGN_W
  canvas.height = DESIGN_H
  parent.append(canvas)
  const ctx = canvas.getContext('2d')
  const shared = media || createStageMedia({ url, onMissing })
  const fades = fadeTracker()
  let seq = 0
  let frameRaf = 0
  let drawn = []   // [{ spec, geo, img }]

  function drawOne({ spec, geo, img }, fade) {
    const alpha = clamp01(spec.alpha) * fade
    const sx = num(spec.scaleX, 1)
    const sy = num(spec.scaleY, 1)
    if (!(alpha > 0) || !(sx > 0) || !(sy > 0)) return false
    const k = geo.k
    const rect = Array.isArray(spec.rect) && spec.rect.length >= 4 ? spec.rect.slice(0, 4).map((v) => num(v)) : null
    ctx.save()
    ctx.globalAlpha = alpha
    if (img) {
      if (rect) {   // 有图又有 rect：rect 是裁剪窗口
        ctx.beginPath()
        ctx.rect(geo.cx - (k * geo.sw) / 2 + k * rect[0], geo.cy - (k * geo.sh) / 2 + k * rect[1], k * rect[2], k * rect[3])
        ctx.clip()
      }
      const f = spec.fit === 'contain' ? Math.min(geo.sw / img.naturalWidth, geo.sh / img.naturalHeight) : spec.fit === 'cover' ? Math.max(geo.sw / img.naturalWidth, geo.sh / img.naturalHeight) : 1
      const w = img.naturalWidth * f * sx * k
      const h = img.naturalHeight * f * sy * k
      ctx.drawImage(img, geo.cx + k * num(spec.x) - w / 2, geo.cy + k * num(spec.y) - h / 2, w, h)
    } else {
      const r = rect || [0, 0, geo.sw, geo.sh]
      ctx.fillStyle = typeof spec.color === 'string' && COLOR_RE.test(spec.color) ? spec.color : '#000'
      ctx.fillRect(geo.cx - (k * geo.sw) / 2 + k * (r[0] + num(spec.x)), geo.cy - (k * geo.sh) / 2 + k * (r[1] + num(spec.y)), k * r[2] * sx, k * r[3] * sy)
    }
    ctx.restore()
    return true
  }

  function paint(now = performance.now()) {
    frameRaf = 0
    ctx.clearRect(0, 0, DESIGN_W, DESIGN_H)
    let count = 0
    for (const item of drawn) if (drawOne(item, fades.alpha(String(item.spec.slot), now))) count += 1
    canvas.dataset.parts = String(count)
    if (fades.active(now)) frameRaf = requestAnimationFrame(paint)
  }

  async function set(overlays, { live = false } = {}) {
    const mine = ++seq
    cancelAnimationFrame(frameRaf)
    frameRaf = 0
    const specs = (Array.isArray(overlays) ? overlays : []).filter((o) => o && typeof o === 'object' && (o.src || o.rect || o.color) && clamp01(o.alpha) > 0 && num(o.scaleX, 1) > 0 && num(o.scaleY, 1) > 0)   // 隐藏的（alpha / scale <= 0）不加载
    const images = await Promise.all(specs.map((spec) => (spec.src ? shared.image(String(spec.src)) : null)))
    if (mine !== seq) return
    drawn = specs.map((spec, i) => ({ spec, geo: geometry(spec.stage), img: images[i] })).filter((item) => !item.spec.src || item.img)
      .map((item, i) => ({ ...item, order: i })).sort((a, b) => num(a.spec.z) - num(b.spec.z) || a.order - b.order)
    const now = performance.now()
    fades.sync(drawn.map((d) => String(d.spec.slot)), live, (key) => num(drawn.find((d) => String(d.spec.slot) === key)?.spec.fade), now)
    canvas.dataset.slots = JSON.stringify(specs.map((o) => String(o.slot)))
    paint(now)
  }

  return { set, canvas, destroy: () => { seq += 1; cancelAnimationFrame(frameRaf); canvas.remove() } }
}
