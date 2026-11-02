// TLG（KiriKiri 的图片格式）解码：TLG5（LZSS + 行预测）/ TLG6（Golomb + MED / 平均预测）/ TLG0.0 sds 外壳（里面是 TLG5 或 TLG6，后面跟 tags 块）→ RGBA。
// 移植自 libtlg-rs 0.2.4（MIT，https://crates.io/crates/libtlg-rs）的 load_tlg.rs / tvpgl.rs；g07 / g08 采集里的真实 TLG5（立绘分层）和 TLG6（事件 CG，1920×1080）上核对。
// 不支持：XXXYYY / XXXZZZ / JKMXE8 这几种带异或的变体、TLG6 的「外部 Golomb 表」、压缩方式 ≠ 0（和 libtlg-rs 一样）。
import { encodePng } from './bgi.mjs'

const W_BLOCK = 8
const H_BLOCK = 8
const LEADING_ZERO_BITS = 12
const GOLOMB_N = 4
const GOLOMB_COMPRESSED = [
  [3, 7, 15, 27, 63, 108, 223, 448, 130],
  [3, 5, 13, 24, 51, 95, 192, 384, 257],
  [2, 5, 12, 21, 39, 86, 155, 320, 384],
  [2, 3, 9, 18, 33, 61, 129, 258, 511],
]
const GOLOMB_TABLE_SIZE = GOLOMB_N * 2 * 128
const leadingZeroTable = (() => {
  const size = 1 << LEADING_ZERO_BITS
  const table = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    let cnt = 0
    let j = 1
    while (j !== size && (i & j) === 0) { j <<= 1; cnt += 1 }
    cnt += 1
    if (j === size) cnt = 0
    table[i] = cnt
  }
  return table
})()
const golombTable = (() => {   // [a * 4 + n] → 位长
  const table = new Int8Array(GOLOMB_TABLE_SIZE * GOLOMB_N)
  for (let n = 0; n < GOLOMB_N; n++) {
    let a = 0
    for (let i = 0; i < 9; i++) for (let k = 0; k < GOLOMB_COMPRESSED[n][i]; k++) { table[a * GOLOMB_N + n] = i; a += 1 }
  }
  return table
})()

class Reader {
  constructor(buf, pos = 0) { this.buf = buf; this.pos = pos }
  u8() { return this.buf[this.pos++] }
  u32() { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v }
  bytes(n) { if (this.pos + n > this.buf.length) throw new Error('TLG 数据被截断'); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b }
}

// LZSS（滑动窗口 4096）：返回新的 r
function decompressSlide(out, inp, text, rIn) {
  let r = rIn
  let flags = 0
  let inpos = 0
  let outpos = 0
  while (inpos < inp.length) {
    flags >>>= 1
    if ((flags & 256) === 0) { flags = inp[inpos++] | 0xff00 }
    if (flags & 1) {
      let mpos = inp[inpos] | ((inp[inpos + 1] & 0xf) << 8)
      let mlen = (inp[inpos + 1] & 0xf0) >> 4
      inpos += 2
      mlen += 3
      if (mlen === 18) mlen += inp[inpos++]
      while (mlen > 0) { const c = text[mpos]; out[outpos++] = c; text[r] = c; r = (r + 1) & 4095; mpos = (mpos + 1) & 4095; mlen-- }
    } else {
      const c = inp[inpos++]
      out[outpos++] = c
      text[r] = c
      r = (r + 1) & 4095
    }
  }
  return r
}

function loadTlg5(rd) {
  const colors = rd.u8()
  const width = rd.u32()
  const height = rd.u32()
  const blockHeight = rd.u32()
  if (![1, 3, 4].includes(colors) || !width || !height || !blockHeight || width * height > 200_000_000) throw new Error('TLG5 头不合理')
  const blockCount = Math.floor((height - 1) / blockHeight) + 1
  rd.pos += blockCount * 4
  const stride = width * colors
  const out = Buffer.alloc(stride * height)
  const text = new Uint8Array(4096)
  const outbuf = Array.from({ length: colors }, () => new Uint8Array(blockHeight * width + 10))
  let r = 0
  let prev = null
  for (let yBlk = 0; yBlk < height; yBlk += blockHeight) {
    for (let c = 0; c < colors; c++) {
      const mark = rd.u8()
      const size = rd.u32()
      const data = rd.bytes(size)
      if (mark === 0) r = decompressSlide(outbuf[c], data, text, r)
      else outbuf[c].set(data.subarray(0, Math.min(size, outbuf[c].length)))
    }
    const yLim = Math.min(yBlk + blockHeight, height)
    for (let y = yBlk; y < yLim; y++) {
      const o = (y - yBlk) * width
      const cur = y * stride
      let pb = 0, pg = 0, pr = 0, pa = 0
      for (let x = 0; x < width; x++) {
        const i = o + x
        const p = cur + x * colors
        const u = prev === null ? 0 : prev + x * colors
        if (colors === 1) { pb = (pb + outbuf[0][i]) & 255; out[p] = (pb + (prev === null ? 0 : out[u])) & 255; continue }
        let b = outbuf[0][i]
        const g = outbuf[1][i]
        let rr = outbuf[2][i]
        b = (b + g) & 255
        rr = (rr + g) & 255
        pb = (pb + b) & 255; pg = (pg + g) & 255; pr = (pr + rr) & 255
        out[p] = (pb + (prev === null ? 0 : out[u])) & 255
        out[p + 1] = (pg + (prev === null ? 0 : out[u + 1])) & 255
        out[p + 2] = (pr + (prev === null ? 0 : out[u + 2])) & 255
        if (colors === 4) { pa = (pa + outbuf[3][i]) & 255; out[p + 3] = (pa + (prev === null ? 0 : out[u + 3])) & 255 }
      }
      prev = cur
    }
  }
  return { width, height, colors, data: out }   // BGR(A) / 灰度
}

// ---- TLG6 ----
function fetch32(data, loc) {
  if (loc + 4 > data.length) throw new Error('TLG6 位池越界')
  return (data[loc] | (data[loc + 1] << 8) | (data[loc + 2] << 16) | (data[loc + 3] << 24)) >>> 0
}
function decodeGolomb(pixelbuf, bytes, pixelCount, pool, isFirst, c) {
  let n = GOLOMB_N - 1
  let a = 0
  let bitPos = 1
  let zero = (pool[0] & 1) ? 0 : 1
  let index = 0
  let poolIndex = 0
  while (index < pixelCount) {
    let count
    {
      let t = fetch32(pool, poolIndex) >>> bitPos
      let b = leadingZeroTable[t & ((1 << LEADING_ZERO_BITS) - 1)]
      let bitCount = b
      while (b === 0) {
        bitCount += LEADING_ZERO_BITS
        bitPos += LEADING_ZERO_BITS
        poolIndex += bitPos >> 3
        bitPos &= 7
        t = fetch32(pool, poolIndex) >>> bitPos
        b = leadingZeroTable[t & ((1 << LEADING_ZERO_BITS) - 1)]
        bitCount += b
      }
      bitPos += b
      poolIndex += bitPos >> 3
      bitPos &= 7
      bitCount -= 1
      count = 1 << bitCount
      count += (fetch32(pool, poolIndex) >>> bitPos) & (count - 1)
      bitPos += bitCount
      poolIndex += bitPos >> 3
      bitPos &= 7
    }
    if (zero) {
      do {
        if (isFirst) pixelbuf[index] = 0
        else bytes[index * 4 + c] = 0
        index += 1
        count -= 1
      } while (count !== 0)
      zero ^= 1
    } else {
      do {
        const k = golombTable[a * GOLOMB_N + n]
        let t = fetch32(pool, poolIndex) >>> bitPos
        let bitCount
        let b
        if (t !== 0) {
          b = leadingZeroTable[t & ((1 << LEADING_ZERO_BITS) - 1)]
          bitCount = b
          while (b === 0) {
            bitCount += LEADING_ZERO_BITS
            bitPos += LEADING_ZERO_BITS
            poolIndex += bitPos >> 3
            bitPos &= 7
            t = fetch32(pool, poolIndex) >>> bitPos
            b = leadingZeroTable[t & ((1 << LEADING_ZERO_BITS) - 1)]
            bitCount += b
          }
          bitCount -= 1
        } else {
          poolIndex += 5
          bitCount = pool[poolIndex - 1]
          bitPos = 0
          t = fetch32(pool, poolIndex)
          b = 0
        }
        let v = (bitCount << k) + (((t | 0) >> b) & ((1 << k) - 1))
        const sign = (v & 1) - 1
        v >>= 1
        a += v
        const value = (((v ^ sign) + sign + 1) | 0)
        if (isFirst) pixelbuf[index] = value & 0xff
        else bytes[index * 4 + c] = value & 0xff
        index += 1
        bitPos += b + k
        poolIndex += bitPos >> 3
        bitPos &= 7
        if (n === 0) { n = GOLOMB_N - 1; a >>= 1 } else n -= 1
        count -= 1
      } while (count !== 0)
      zero ^= 1
    }
  }
}
const gtMask = (a, b) => {
  const t2 = ~b
  const tmp = ((((a & t2) + (((a ^ t2) >>> 1) & 0x7f7f7f7f)) >>> 0) & 0x80808080) >>> 0
  return ((((tmp >>> 7) + 0x7f7f7f7f) >>> 0) ^ 0x7f7f7f7f) >>> 0
}
const packedAdd = (a, b) => {
  const tmp = (((((a & b) << 1) >>> 0) + ((a ^ b) & 0xfefefefe)) >>> 0) & 0x01010100
  return (a + b - tmp) >>> 0
}
const med2 = (a, b, c) => {
  const agtb = gtMask(a, b)
  const x = ((a ^ b) & agtb) >>> 0
  const aa = (x ^ a) >>> 0
  const bb = (x ^ b) >>> 0
  const n = gtMask(c, bb)
  const nn = gtMask(aa, c)
  const m = (~(n | nn)) >>> 0
  return (((n & aa) | (nn & bb) | ((((bb & m) >>> 0) - ((c & m) >>> 0) + ((aa & m) >>> 0)) >>> 0)) >>> 0)
}
const med = (a, b, c, v) => packedAdd(med2(a, b, c), v)
const avgPacked = (x, y) => (((x & y) + ((((x ^ y) & 0xfefefefe) >>> 0) >>> 1) + ((x ^ y) & 0x01010101)) >>> 0)
const avg = (a, b, v) => packedAdd(avgPacked(a, b), v)
const calV = (b, g, r, a) => ((((r & 255) << 16) + ((g & 255) << 8) + (b & 255) + ((a & 255) << 24)) >>> 0)
const u8 = (x) => x & 255
// 32 种滤波：[是否用 med（否则 avg）, 通道变换]
function filtered(type, ib, ig, ir, ia) {
  switch (type >> 1) {
    case 0: return calV(ib, ig, ir, ia)
    case 1: return calV(ib + ig, ig, ir + ig, ia)
    case 2: return calV(ib, ig + ib, ir + ib + ig, ia)
    case 3: return calV(ib + ir + ig, ig + ir, ir, ia)
    case 4: return calV(ib + ir, ig + ib + ir, ir + ib + ir + ig, ia)
    case 5: return calV(ib + ir, ig + ib + ir, ir, ia)
    case 6: return calV(ib + ig, ig, ir, ia)
    case 7: return calV(ib, ig + ib, ir, ia)
    case 8: return calV(ib, ig, ir + ig, ia)
    case 9: return calV(ib + ig + ir + ib, ig + ir + ib, ir + ib, ia)
    case 10: return calV(ib + ir, ig + ir, ir, ia)
    case 11: return calV(ib, ig + ib, ir + ib, ia)
    case 12: return calV(ib, ig + ir + ib, ir + ib, ia)
    case 13: return calV(ib + ig, ig + ir + ib + ig, ir + ib + ig, ia)
    case 14: return calV(ib + ig + ir, ig + ir, ir + ib + ig + ir, ia)
    default: return calV(ib, ig + (ib << 1), ir + (ib << 1), ia)
  }
}
function decodeLine(prevline, curline, width, startBlock, blockLimit, filterTypes, ftOffset, skipBlockBytes, inp, inpPosIn, initialp, oddskip, dir) {
  let p
  let up
  let prevPos = 0
  let curPos = 0
  let inpPos = inpPosIn
  if (startBlock !== 0) {
    prevPos += startBlock * W_BLOCK
    curPos += startBlock * W_BLOCK
    p = curline[curPos - 1]
    up = prevline[prevPos - 1]
  } else { p = initialp; up = initialp }
  inpPos += skipBlockBytes * startBlock
  const step = dir ? 1 : -1
  for (let i = startBlock; i < blockLimit; i++) {
    let w = Math.min(width - i * W_BLOCK, W_BLOCK)
    const ww = w
    if (step === -1) inpPos += ww - 1
    if (i & 1) inpPos += oddskip * ww
    const type = filterTypes[ftOffset + i]
    if (type > 31) throw new Error(`TLG6 不认识的滤波类型 ${type}`)
    do {
      const inpt = inp[inpPos]
      const ia = (inpt >>> 24) & 255
      const ir = (inpt >>> 16) & 255
      const ig = (inpt >>> 8) & 255
      const ib = inpt & 255
      const u = prevline[prevPos]
      const v = filtered(type, ib, ig, ir, ia)
      p = (type & 1) ? avg(p, u, v) : med(p, u, up, v)
      up = u
      curline[curPos++] = p
      prevPos += 1
      inpPos += step
      w -= 1
    } while (w !== 0)
    if (step === 1) inpPos += skipBlockBytes - ww
    else inpPos += skipBlockBytes + 1
    if (i & 1) inpPos -= oddskip * ww
  }
}
function loadTlg6(rd) {
  const colors = rd.u8()
  const flags = rd.u8()
  const colorType = rd.u8()
  const external = rd.u8()
  if (![1, 3, 4].includes(colors)) throw new Error('TLG6 颜色数不支持')
  if (flags !== 0 || colorType !== 0) throw new Error('TLG6 的数据标志 / 颜色类型不是 0（不支持）')
  if (external !== 0) throw new Error('TLG6 的外部 Golomb 位长表（不支持）')
  const width = rd.u32()
  const height = rd.u32()
  const maxBitLength = rd.u32()
  if (!width || !height || width * height > 200_000_000) throw new Error('TLG6 头不合理')
  const xBlocks = Math.floor((width - 1) / W_BLOCK) + 1
  const yBlocks = Math.floor((height - 1) / H_BLOCK) + 1
  const mainCount = Math.floor(width / W_BLOCK)
  const fraction = width - mainCount * W_BLOCK
  const bitPool = new Uint8Array(Math.floor(maxBitLength / 8) + 5)
  const pixelbuf = new Uint32Array(width * H_BLOCK + 1)
  const pixelBytes = new Uint8Array(pixelbuf.buffer)
  const filterTypes = new Uint8Array(xBlocks * yBlocks)
  const text = new Uint8Array(4096)
  const zero = colors === 3 ? 0xff000000 : 0
  let prevline = new Uint32Array(width).fill(zero)
  {
    let p = 0
    for (let i = 0; i < 0x20; i++) for (let j = 0; j < 0x10; j++) { text[p++] = i; text[p++] = i; text[p++] = i; text[p++] = i; text[p++] = j; text[p++] = j; text[p++] = j; text[p++] = j }
    const size = rd.u32()
    decompressSlide(filterTypes, rd.bytes(size), text, 0)
  }
  const outbuf = new Uint32Array(width * height)
  for (let y = 0; y < height; y += H_BLOCK) {
    const yLim = Math.min(y + H_BLOCK, height)
    const pixelCount = (yLim - y) * width
    for (let c = 0; c < colors; c++) {
      let bitLength = rd.u32()
      const method = (bitLength >>> 30) & 3
      bitLength &= 0x3fffffff
      const byteLength = Math.floor((bitLength + 7) / 8)
      if (byteLength >= bitPool.length) throw new Error('TLG6 位池太小')
      bitPool.set(rd.bytes(byteLength))
      if (method !== 0) throw new Error(`TLG6 压缩方式 ${method}（不支持）`)
      decodeGolomb(pixelbuf, pixelBytes, pixelCount, bitPool, c === 0 && colors !== 1, c)
    }
    const ftOffset = Math.floor(y / H_BLOCK) * xBlocks
    const skipBytes = (yLim - y) * W_BLOCK
    for (let yy = y; yy < yLim; yy++) {
      const curline = outbuf.subarray(yy * width, (yy + 1) * width)
      const dir = ((yy & 1) ^ 1) !== 0
      const oddskip = (yLim - yy - 1) - (yy - y)
      if (mainCount !== 0) decodeLine(prevline, curline, width, 0, mainCount, filterTypes, ftOffset, skipBytes, pixelbuf, Math.min(W_BLOCK, width) * (yy - y), zero, oddskip, dir)
      if (mainCount !== xBlocks) decodeLine(prevline, curline, width, mainCount, xBlocks, filterTypes, ftOffset, skipBytes, pixelbuf, Math.min(W_BLOCK, fraction) * (yy - y), zero, oddskip, dir)
      prevline = curline.slice()
    }
  }
  const data = Buffer.alloc(width * height * colors)
  for (let i = 0; i < outbuf.length; i++) {
    const v = outbuf[i]
    const o = i * colors
    if (colors === 1) data[o] = v & 255
    else { data[o] = v & 255; data[o + 1] = (v >>> 8) & 255; data[o + 2] = (v >>> 16) & 255; if (colors === 4) data[o + 3] = (v >>> 24) & 255 }
  }
  return { width, height, colors, data }
}

const MARK5 = Buffer.from('TLG5.0\0raw\x1a', 'latin1')
const MARK6 = Buffer.from('TLG6.0\0raw\x1a', 'latin1')
const MARK0 = Buffer.from('TLG0.0\0sds\x1a', 'latin1')
export const isTlg = (buf) => buf.length > 16 && (buf.subarray(0, 11).equals(MARK0) || buf.subarray(0, 11).equals(MARK5) || buf.subarray(0, 11).equals(MARK6))

// → { width, height, channels（1 / 3 / 4）, data（RGB(A) / 灰度，每行 width × channels 字节） }
export function decodeTlg(buf) {
  let start = 0
  if (buf.subarray(0, 11).equals(MARK0)) start = 15   // 11 魔数 + u32 原始 TLG 的长度
  const mark = buf.subarray(start, start + 11)
  let decoded
  if (mark.equals(MARK5)) decoded = loadTlg5(new Reader(buf, start + 11))
  else if (mark.equals(MARK6)) decoded = loadTlg6(new Reader(buf, start + 11))
  else throw new Error('不是 TLG5 / TLG6（或是带异或的变体，不支持）')
  const { width, height, colors, data } = decoded
  if (colors >= 3) for (let i = 0; i < data.length; i += colors) { const b = data[i]; data[i] = data[i + 2]; data[i + 2] = b }   // BGR(A) → RGB(A)
  return { width, height, channels: colors, data }
}
export function tlgToPng(buf) {
  const { width, height, channels, data } = decodeTlg(buf)
  return encodePng(width, height, channels, data)
}
