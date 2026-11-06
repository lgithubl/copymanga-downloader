// Unity 资源对象的最小读取（Texture2D / Sprite / SpriteAtlas），给 Imys 的背景 / 立绘 bundle 用。
// 只做 Imys 里用到的：未压缩的 Texture2D（RGB24 / RGBA32 / ARGB32 / Alpha8），数据在同包的 .resS 里；Sprite 的 rect + 渲染键；SpriteAtlas 里每个 Sprite 在图集里的位置。
// 布局按 Unity 6000.0 的序列化（真实 bundle 验证过：1280×720 RGB24 背景、1024×2048 RGBA32 图集）。
import { encodePng } from './tomoe.mjs'
import { imysDecrypt, readSerialized, readUnityFS } from './unity-bundle.mjs'

const align4 = (n) => (n + 3) & ~3

// 解开一个 .encrypted bundle → { objects: [{ classId, pathId, data }], res: Map<文件名, Buffer> }
export function openBundle(encrypted) {
  const files = readUnityFS(imysDecrypt(encrypted))
  const objects = []
  const res = new Map()
  for (const file of files) {
    if (/\.(resS|resource)$/.test(file.name)) { res.set(file.name, file.data); continue }
    let list
    try { list = readSerialized(file.data) } catch { continue }
    for (const o of list) objects.push({ classId: o.classId, pathId: o.pathId, data: file.data.subarray(o.start, o.start + o.size) })
  }
  return { objects, res }
}

export function readTexture2D(d) {
  let p = 0
  const nameLen = d.readUInt32LE(0)
  const name = d.toString('utf8', 4, 4 + nameLen)
  p = align4(4 + nameLen)
  const ints = []
  for (let i = 0; i < 23; i++) ints.push(d.readInt32LE(p + i * 4))
  p += 23 * 4
  const [, width, height, imageSize, , format, mips] = ints
  const imageData = ints[22]   // 内嵌数据大小（0 = 在 .resS 里）
  if (imageData) throw new Error('内嵌的纹理数据没做（只做了 .resS 里的）')
  const offset = Number(d.readBigUInt64LE(p)); p += 8
  const size = d.readUInt32LE(p); p += 4
  const pathLen = d.readUInt32LE(p); p += 4
  const path = d.toString('utf8', p, p + pathLen)
  return { name, width, height, imageSize, format, mips, stream: { offset, size, path } }
}

export function readSprite(d) {
  let p = 0
  const f32 = () => { const v = d.readFloatLE(p); p += 4; return v }
  const u32 = () => { const v = d.readUInt32LE(p); p += 4; return v }
  const str = () => { const n = u32(); const s = d.toString('utf8', p, p + n); p = align4(p + n); return s }
  const name = str()
  const rect = [f32(), f32(), f32(), f32()]
  const offset = [f32(), f32()]
  p += 16 + 4   // border + pixelsToUnits
  const pivot = [f32(), f32()]
  p += 4        // extrude
  p += 4        // isPolygon（bool + 对齐）
  const key = d.subarray(p, p + 24).toString('hex'); p += 24   // m_RenderDataKey = GUID(16) + int64
  return { name, rect, offset, pivot, key }
}

// SpriteAtlas：每个 Sprite 的渲染键 → 它在图集纹理里的矩形（左下角为原点）
export function readSpriteAtlas(d) {
  let p = 0
  const u32 = () => { const v = d.readUInt32LE(p); p += 4; return v }
  const i32 = () => { const v = d.readInt32LE(p); p += 4; return v }
  const f32 = () => { const v = d.readFloatLE(p); p += 4; return v }
  const str = () => { const n = u32(); const s = d.toString('utf8', p, p + n); p = align4(p + n); return s }
  str()                                      // 名字
  const packed = i32(); p += packed * 12     // m_PackedSprites（PPtr）
  const names = i32(); for (let i = 0; i < names; i++) str()
  const n = i32()
  const map = new Map()
  for (let i = 0; i < n; i++) {
    const key = d.subarray(p, p + 24).toString('hex'); p += 24
    p += 12 + 12                              // texture / alphaTexture PPtr
    const rect = [f32(), f32(), f32(), f32()]
    p += 8 + 8 + 16 + 4 + 4                   // textureRectOffset / atlasRectOffset / uvTransform / downscale / settingsRaw
    p += 4 + 4 * 0                            // secondaryTextures（空数组的个数）
    map.set(key, rect)
  }
  return map
}

// Texture2D 的像素 → RGBA（自上而下；Unity 纹理是自下而上，这里翻过来）
export function textureRgba(tex, res) {
  const blob = res.get(tex.stream.path.split('/').pop())
  if (!blob) throw new Error(`找不到纹理数据文件 ${tex.stream.path}`)
  const raw = blob.subarray(tex.stream.offset, tex.stream.offset + (tex.stream.size || tex.imageSize))
  const { width: w, height: h } = tex
  const out = Buffer.alloc(w * h * 4)
  const bpp = { 1: 1, 3: 3, 4: 4, 5: 4 }[tex.format]
  if (!bpp) throw new Error(`纹理格式 ${tex.format} 没做（只做了 Alpha8 / RGB24 / RGBA32 / ARGB32）`)
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * bpp
    for (let x = 0; x < w; x++) {
      const s = src + x * bpp
      const o = (y * w + x) * 4
      if (tex.format === 4) { out[o] = raw[s]; out[o + 1] = raw[s + 1]; out[o + 2] = raw[s + 2]; out[o + 3] = raw[s + 3] }
      else if (tex.format === 3) { out[o] = raw[s]; out[o + 1] = raw[s + 1]; out[o + 2] = raw[s + 2]; out[o + 3] = 255 }
      else if (tex.format === 5) { out[o] = raw[s + 1]; out[o + 1] = raw[s + 2]; out[o + 2] = raw[s + 3]; out[o + 3] = raw[s] }
      else { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = raw[s] }
    }
  }
  return { w, h, pixels: out }
}

// 背景 bundle → PNG（第一个 Texture2D）
export function backgroundPng(encrypted) {
  const { objects, res } = openBundle(encrypted)
  const t = objects.find((o) => o.classId === 28)
  if (!t) throw new Error('bundle 里没有 Texture2D')
  const tex = readTexture2D(t.data)
  const { w, h, pixels } = textureRgba(tex, res)
  const opaque = tex.format === 3
  if (opaque) { const rgb = Buffer.alloc(w * h * 3); for (let i = 0, j = 0; i < w * h; i++) { rgb[j++] = pixels[i * 4]; rgb[j++] = pixels[i * 4 + 1]; rgb[j++] = pixels[i * 4 + 2] } return encodePng(w, h, rgb, 3) }
  return encodePng(w, h, pixels, 4)
}

// 立绘 bundle → { sprites: Map<名字, { w, h, pixels(RGBA) }>, setting: { stand: [x, y], face: [x, y], emotion: [x, y] } }
export function tatiBundle(encrypted) {
  const { objects, res } = openBundle(encrypted)
  const tex = objects.find((o) => o.classId === 28)
  if (!tex) throw new Error('bundle 里没有图集纹理')
  const atlas = textureRgba(readTexture2D(tex.data), res)
  const atlasObj = objects.find((o) => o.classId === 687078895)
  const rects = atlasObj ? readSpriteAtlas(atlasObj.data) : new Map()
  const sprites = new Map()
  for (const o of objects.filter((x) => x.classId === 213)) {
    const s = readSprite(o.data)
    const r = rects.get(s.key)
    if (!r) continue
    const [rx, ry, rw, rh] = r.map(Math.round)
    const pixels = Buffer.alloc(rw * rh * 4)
    for (let y = 0; y < rh; y++) {
      // 图集里 (rx, ry) 是左下角：第 y 行（自上而下）对应图集自上而下的第 atlas.h - ry - rh + y 行
      const from = ((atlas.h - ry - rh + y) * atlas.w + rx) * 4
      atlas.pixels.copy(pixels, y * rw * 4, from, from + rw * 4)
    }
    sprites.set(s.name, { w: rw, h: rh, pixels })
  }
  const setting = {}
  const text = objects.find((o) => o.classId === 49)
  if (text) {
    const d = text.data
    const nl = d.readUInt32LE(0)
    const p = align4(4 + nl)
    const body = d.toString('utf8', p + 4, p + 4 + d.readUInt32LE(p))
    for (const line of body.split(/\r?\n/)) { const m = /^(\w+):\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)/.exec(line.trim()); if (m) setting[m[1]] = [Number(m[2]), Number(m[3])] }
  }
  return { sprites, setting }
}

export const FACE_ORDER = ['default', 'smile', 'shy', 'ang', 'gag', 'option', 'option2', 'option3', 'option4', 'option5', 'option6']   // Tati 的表情号 1.. → 图集里的脸

// 立绘 + 表情 → 舞台大小（默认 1280×720）的 PNG：身体按 setting.stand 摆（相对舞台中心，y 向上为正），脸按 setting.face（相对身体中心）摆
export function tatiComposePng(encrypted, expression, { stage = [1280, 720] } = {}) {
  const { sprites, setting } = tatiBundle(encrypted)
  const stand = sprites.get('stand')
  if (!stand) throw new Error('bundle 里没有 stand')
  const faceName = FACE_ORDER[expression - 1] || 'default'
  const face = sprites.get(faceName) || sprites.get('default')
  const [W, H] = stage
  const canvas = Buffer.alloc(W * H * 4)
  const [sx, sy] = setting.stand || [0, 0]
  const [fx, fy] = setting.face || [0, 0]
  const put = (img, cx, cy) => {   // cx / cy = 图的中心在画布里的位置（左上角原点，y 向下）
    const x0 = Math.round(cx - img.w / 2)
    const y0 = Math.round(cy - img.h / 2)
    for (let y = 0; y < img.h; y++) {
      const ty = y0 + y
      if (ty < 0 || ty >= H) continue
      for (let x = 0; x < img.w; x++) {
        const tx = x0 + x
        if (tx < 0 || tx >= W) continue
        const s = (y * img.w + x) * 4
        const a = img.pixels[s + 3]
        if (!a) continue
        const o = (ty * W + tx) * 4
        const ba = canvas[o + 3]
        if (a === 255 || !ba) { canvas[o] = img.pixels[s]; canvas[o + 1] = img.pixels[s + 1]; canvas[o + 2] = img.pixels[s + 2]; canvas[o + 3] = a; continue }
        const outA = a + (ba * (255 - a)) / 255
        for (let c = 0; c < 3; c++) canvas[o + c] = Math.round((img.pixels[s + c] * a + (canvas[o + c] * ba * (255 - a)) / 255) / outA)
        canvas[o + 3] = Math.round(outA)
      }
    }
  }
  const standCx = W / 2 + sx
  const standCy = H / 2 - sy
  put(stand, standCx, standCy)
  if (face) put(face, standCx + fx, standCy - fy)
  return { png: encodePng(W, H, canvas, 4), faceName, hasFace: Boolean(face) }
}
