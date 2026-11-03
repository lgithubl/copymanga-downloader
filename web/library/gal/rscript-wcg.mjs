// Liar-soft codeX RScript 的 WCG 图片（移植自 vn-web-engine 的 src/formats/rscript/wcg.ts，MIT；对照 GARbro 的 ImageWCG.cs）
//   头 16 字节：'WG' + u16 标志（低 4 位 = 版本，必须是 1）+ u16 位深 + u16 保留 + u32 宽 + u32 高
//   像素 = B, G, R, 透明字节（0 = 不透明，255 = 全透明）的 4 字节布局；标志 & 0x1C0 == 0x40：两个交错的 16 位平面（高半 = R + 透明，低半 = B + G），否则 4 个字节平面（透明在最前，标志有 0x10 才有颜色三个平面）
//   每个平面：u32 个数 + u32 压缩后字节数 + u16 调色板项数 + u16 保留 + 调色板（16 位平面每项 2 字节）+ MSB 优先的位流：前缀码 + 游程（2~17 个相同值）
//   这里多一个 wcgToPng（RGBA，A = 255 - 透明字节）给 containers 的虚拟资源用；encodeWcg 只给自测造样本
import { deflateSync } from 'node:zlib'

const SIGNATURE = 0x4757   // 'WG'

export function readWcgHeader(bytes) {
  if (bytes.length < 16) throw new Error('WCG 图片太短')
  if (bytes.readUInt16LE(0) !== SIGNATURE) throw new Error('不是 WCG 图片')
  const flags = bytes.readUInt16LE(2)
  const width = bytes.readUInt32LE(8)
  const height = bytes.readUInt32LE(12)
  if (width < 1 || height < 1 || width * height > 0x4000000) throw new Error(`WCG 尺寸不对 ${width}x${height}`)
  return { flags, width, height }
}

class Bits {
  constructor(bytes, start, end) { this.bytes = bytes; this.position = start; this.end = end; this.remaining = 8 }
  read(count) {
    let value = 0
    while (count) {
      if (this.position >= this.end) throw new Error('WCG 位流被截断')
      const available = this.remaining
      const byte = this.bytes[this.position] & ((1 << available) - 1)
      if (available <= count) { count -= available; value += byte * 2 ** count; this.position += 1; this.remaining = 8 } else { this.remaining = available - count; value += byte >>> this.remaining; count = 0 }
    }
    return value
  }
}

// 调色板下标的前缀码：前缀 1 = 读 1 位；小于 escape 的前缀读 (前缀 - 1) 位（隐含最高位 1）；escape 前缀每个前导 1 多读 1 位（最多 extensions 个）
function readIndex(bits, prefix, escape, extensions) {
  if (prefix === 1) return bits.read(1)
  let width = prefix - 1
  if (prefix === escape) {
    let extra = 0
    while (bits.read(1)) { extra += 1; if (extra > extensions) throw new Error('WCG 转义码无效') }
    width += extra
  }
  return bits.read(width) + 2 ** width
}

function decodePlane(bytes, cursor, pixels, start, wide) {
  if (cursor + 12 > bytes.length) throw new Error('WCG 平面头被截断')
  const packed = bytes.readUInt32LE(cursor + 4)
  const entries = bytes.readUInt16LE(cursor + 8)
  cursor += 12
  const tableSize = entries * (wide ? 2 : 1)
  if (cursor + tableSize + packed > bytes.length) throw new Error('WCG 平面数据被截断')
  const table = new Uint16Array(entries)
  for (let i = 0; i < entries; i += 1) table[i] = wide ? bytes.readUInt16LE(cursor + i * 2) : bytes[cursor + i]
  cursor += tableSize
  const bits = new Bits(bytes, cursor, cursor + packed)
  const prefixBits = wide && entries > 0x1000 ? 4 : 3
  const escape = prefixBits === 4 ? 15 : 7
  const extensions = !wide || prefixBits === 4 ? 1 : 5
  const end = pixels.length
  let position = start
  while (position < end) {
    let prefix = bits.read(prefixBits)
    let run = 1
    if (!prefix) { run = bits.read(4) + 2; prefix = bits.read(prefixBits) }
    const index = readIndex(bits, prefix, escape, extensions)
    if (index >= entries) throw new Error('WCG 调色板下标越界')
    const value = table[index]
    for (let i = 0; i < run; i += 1) {
      if (position >= end) throw new Error('WCG 游程超出图片')
      pixels[position] = value
      if (wide) pixels[position + 1] = value >>> 8
      position += 4
    }
  }
  return cursor + packed
}

// → { width, height, pixels: Uint8Array（B, G, R, 透明字节）}
export function decodeWcg(bytes) {
  const { flags, width, height } = readWcgHeader(bytes)
  if ((flags & 0xf) !== 1) throw new Error(`不支持的 WCG 版本 ${flags & 0xf}`)
  const pixels = new Uint8Array(width * height * 4)
  let cursor = 16
  if ((flags & 0x1c0) === 0x40) {
    cursor = decodePlane(bytes, cursor, pixels, 2, true)
    decodePlane(bytes, cursor, pixels, 0, true)
  } else {
    cursor = decodePlane(bytes, cursor, pixels, 3, false)
    if (flags & 0x10) for (const channel of [2, 1, 0]) cursor = decodePlane(bytes, cursor, pixels, channel, false)
  }
  return { width, height, pixels }
}

// ---- PNG ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
// RGBA（直通 alpha）→ PNG；A = 255 - 透明字节
export function wcgToPng(bytes) {
  const { width, height, pixels } = decodeWcg(bytes)
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const s = y * stride + x * 4
      const d = row + 1 + x * 4
      raw[d] = pixels[s + 2]; raw[d + 1] = pixels[s + 1]; raw[d + 2] = pixels[s]; raw[d + 3] = 255 - pixels[s + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))])
}

// ---- 编码（只给自测造样本：和游戏存档缩略图一样的两个 16 位平面，标志 0x271）----
class BitWriter {
  constructor() { this.bytes = []; this.current = 0; this.used = 0 }
  write(value, count) {
    for (let bit = count - 1; bit >= 0; bit -= 1) {
      this.current = (this.current << 1) | (Math.floor(value / 2 ** bit) & 1)
      this.used += 1
      if (this.used === 8) { this.bytes.push(this.current); this.current = 0; this.used = 0 }
    }
  }
  finish() { if (this.used) this.bytes.push(this.current << (8 - this.used)); return Uint8Array.from(this.bytes) }
}
function encodeWidePlane(pixels, start) {
  const values = []
  for (let i = start; i < pixels.length; i += 4) values.push(pixels[i] | (pixels[i + 1] << 8))
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const table = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))
  if (table.length > 0xffff) throw new Error('WCG 平面里不同的值太多')
  const index = new Map(table.map((value, i) => [value, i]))
  const prefixBits = table.length > 0x1000 ? 4 : 3
  const escape = prefixBits === 4 ? 15 : 7
  const bits = new BitWriter()
  const writeIndex = (i) => {
    if (i < 2) { bits.write(1, prefixBits); bits.write(i, 1); return }
    const width = Math.floor(Math.log2(i))
    if (width + 1 < escape) bits.write(width + 1, prefixBits)
    else { bits.write(escape, prefixBits); for (let extra = width - (escape - 1); extra > 0; extra -= 1) bits.write(1, 1); bits.write(0, 1) }
    bits.write(i - 2 ** width, width)
  }
  for (let i = 0; i < values.length;) {
    let run = 1
    while (run < 17 && values[i + run] === values[i]) run += 1
    if (run >= 2) { bits.write(0, prefixBits); bits.write(run - 2, 4) } else run = 1
    writeIndex(index.get(values[i]))
    i += run
  }
  const packed = bits.finish()
  const plane = Buffer.alloc(12 + table.length * 2 + packed.length)
  plane.writeUInt32LE(values.length, 0); plane.writeUInt32LE(packed.length, 4); plane.writeUInt16LE(table.length, 8)
  table.forEach((value, i) => plane.writeUInt16LE(value, 12 + i * 2))
  Buffer.from(packed).copy(plane, 12 + table.length * 2)
  return plane
}
export function encodeWcg({ width, height, pixels }) {
  if (pixels.length !== width * height * 4) throw new Error('WCG 像素数据和尺寸对不上')
  const high = encodeWidePlane(pixels, 2)
  const low = encodeWidePlane(pixels, 0)
  const head = Buffer.alloc(16)
  head.writeUInt16LE(SIGNATURE, 0); head.writeUInt16LE(0x271, 2); head.writeUInt16LE(32, 4); head.writeUInt32LE(width, 8); head.writeUInt32LE(height, 12)
  return Buffer.concat([head, high, low])
}
