// PNG（8 位 RGBA、不隔行）的颜色从「预乘 alpha」还原成「直通 alpha」：AdvHD 的 PNAP / WPAP 立绘帧里的 PNG 存的是预乘后的颜色（颜色 ≈ 原色 × alpha），
// 引擎按预乘混合（ONE, INV_SRC_ALPHA）画；浏览器的 canvas 把 PNG 当直通 alpha，直接画会双重变暗（腮红 / 阴影的正片叠底变成灰斑，半透明边缘一圈暗边）。
// 在服务端把像素除以 alpha 再重新编码，所有取这张图的地方（播放器 / 缩略图渲染）就都对了，不用在浏览器里再算（canvas 往返会在低 alpha 处丢精度）。
// 只认 8 位 RGBA、不隔行的 PNG（样本里全是）；别的格式原样返回（调用方当「没转」处理）。
import { deflateSync, inflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_PIXELS = 64 * 1024 * 1024

let crcTable = null
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c }
  }
  let c = -1
  for (let i = 0; i < buffer.length; i++) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, tail])
}

// 还原一行的滤波：type 0 无 / 1 Sub / 2 Up / 3 Average / 4 Paeth；bpp = 4（RGBA 8 位）
function unfilter(raw, width, height) {
  const bpp = 4
  const stride = width * bpp
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const up = y ? dst - stride : -1
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0
      const b = up >= 0 ? out[up + x] : 0
      const c = up >= 0 && x >= bpp ? out[up + x - bpp] : 0
      let value = raw[src + x]
      if (type === 1) value += a
      else if (type === 2) value += b
      else if (type === 3) value += (a + b) >> 1
      else if (type === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c } else if (type !== 0) throw new Error(`PNG 滤波类型 ${type} 不认识`)
      out[dst + x] = value & 0xff
    }
  }
  return out
}

// 返回 { buffer, converted }：converted = true 表示转过了；不是 8 位 RGBA / 隔行 / 解不开 = { buffer: 原样, converted: false, reason }
export function unpremultiplyPng(input) {
  try {
    if (input.length < 33 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) return { buffer: input, converted: false, reason: '不是 PNG' }
    let pos = 8
    let width = 0
    let height = 0
    let ok = false
    const idat = []
    const others = []   // IHDR 之后、IDAT 之前的辅助块（pHYs / gAMA …）原样带上；PLTE / tRNS 对 RGBA 没有意义
    while (pos + 8 <= input.length) {
      const length = input.readUInt32BE(pos)
      const type = input.subarray(pos + 4, pos + 8).toString('latin1')
      const data = input.subarray(pos + 8, pos + 8 + length)
      if (pos + 12 + length > input.length) return { buffer: input, converted: false, reason: 'PNG 被截断' }
      if (type === 'IHDR') {
        width = data.readUInt32BE(0); height = data.readUInt32BE(4)
        ok = data[8] === 8 && data[9] === 6 && data[10] === 0 && data[11] === 0 && data[12] === 0   // 8 位、RGBA、无隔行
        if (!ok) return { buffer: input, converted: false, reason: `只认 8 位 RGBA 不隔行（位深 ${data[8]} 颜色类型 ${data[9]} 隔行 ${data[12]}）` }
        if (!width || !height || width * height > MAX_PIXELS) return { buffer: input, converted: false, reason: '尺寸不合理' }
      } else if (type === 'IDAT') idat.push(data)
      else if (type === 'IEND') break
      else if (!idat.length && type !== 'PLTE' && type !== 'tRNS' && type !== 'IHDR' && /^[a-z]/.test(type)) others.push(chunk(type, data))
      pos += 12 + length
    }
    if (!ok || !idat.length) return { buffer: input, converted: false, reason: '没有 IHDR / IDAT' }
    const raw = inflateSync(Buffer.concat(idat))
    if (raw.length !== (width * 4 + 1) * height) return { buffer: input, converted: false, reason: '像素数据长度对不上' }
    const pixels = unfilter(raw, width, height)
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3]
      if (a === 255) continue
      if (a === 0) { pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; continue }
      pixels[i] = Math.min(255, Math.round((pixels[i] * 255) / a))
      pixels[i + 1] = Math.min(255, Math.round((pixels[i + 1] * 255) / a))
      pixels[i + 2] = Math.min(255, Math.round((pixels[i + 2] * 255) / a))
    }
    const stride = width * 4
    const filtered = Buffer.alloc((stride + 1) * height)   // 滤波类型 0（不滤）：不省空间，但简单可靠
    for (let y = 0; y < height; y++) pixels.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
    return { buffer: Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), ...others, chunk('IDAT', deflateSync(filtered, { level: 4 })), chunk('IEND', Buffer.alloc(0))]), converted: true }
  } catch (error) {
    return { buffer: input, converted: false, reason: String(error?.message || error) }
  }
}
