// CompressedBG version 2（DCT 块 + 哈夫曼 + 可选 alpha 通道）→ 像素。移植自 GARbro（ArcFormats/Ethornell/ImageCBG.cs：CbgReader.UnpackV2 / ParallelCbgDecoder / HuffmanTree(v2)）。
// 注意：采集的样本里没有 version 2，这份只和自带的编码器（scripts/dev/make-bgi-fixture.mjs，系数级往返）+ 平坦块的数值对过，没有对真实文件验证过。
// 文件布局（头 0x30 同 version 1）：
//   0x30：加密段（encLen 字节，用 key 序列解密）：前 0x80 字节 = 两张量化表（亮度 64 + 色度 64）
//   然后：Tree1 权重（0x10 个变长整数）、Tree2 权重（0xB0 个）、(高 / 8 + 1) 个 u32 偏移（相对加密段之后）、每个 8 行块一段数据（先 pad_skip 字节跳过，
//   再一个变长整数 = 系数个数，MSB 先出的比特流：全部 DC 差分（Tree1 的类别 + 附加位），对齐到字节，再每块的 AC（Tree2：低 4 位 = 前面的 0 个数，高 4 位 = 位数；0 = 结束，0xF = 跳 16 个）），
//   最后一个偏移起是 alpha（32 位时）：u32 1 + 控制位 LZ（x、y 回指）
export const DCT_TABLE = new Float32Array([
  1.0, 1.3870399, 1.30656302, 1.17587554, 1.0, 0.78569496, 0.54119611, 0.27589938,
  1.3870399, 1.9238795, 1.81225491, 1.63098633, 1.3870399, 1.08979023, 0.75066054, 0.38268343,
  1.30656302, 1.81225491, 1.70710683, 1.5363555, 1.30656302, 1.02655995, 0.70710677, 0.36047992,
  1.17587554, 1.63098633, 1.5363555, 1.3826834, 1.17587554, 0.9238795, 0.6363793, 0.32442334,
  1.0, 1.3870399, 1.30656302, 1.17587554, 1.0, 0.78569496, 0.54119611, 0.27589938,
  0.78569496, 1.08979023, 1.02655995, 0.9238795, 0.78569496, 0.61731654, 0.42521504, 0.21677275,
  0.54119611, 0.75066054, 0.70710677, 0.6363793, 0.54119611, 0.42521504, 0.29289323, 0.14931567,
  0.27589938, 0.38268343, 0.36047992, 0.32442334, 0.27589938, 0.21677275, 0.14931567, 0.07612047,
])
export const FILL_ORDER = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
])
const MAX_PIXELS = 64 * 1024 * 1024

// 哈夫曼树（GARbro HuffmanTree，v2 = true：每轮先取第一个有效节点当基准再找更小的）
export function buildTree(weights, v2 = false) {
  const nodes = []
  let root = 0
  for (const w of weights) { nodes.push({ valid: w !== 0, weight: w, parent: false, l: -1, r: -1 }); root += w }
  if (!root) throw new Error('CompressedBG 权重全是 0')
  for (;;) {
    let weight = 0
    const pick = [-1, -1]
    for (let i = 0; i < 2; i++) {
      let min = Infinity
      let n = 0
      if (v2) {
        for (; n < nodes.length; n++) if (nodes[n].valid) { min = nodes[n].weight; pick[i] = n++; break }
        n = Math.max(n, i + 1)
      }
      for (; n < nodes.length; n++) if (nodes[n].valid && nodes[n].weight < min) { min = nodes[n].weight; pick[i] = n }
      if (pick[i] === -1) continue
      nodes[pick[i]].valid = false
      weight += nodes[pick[i]].weight
    }
    nodes.push({ valid: true, parent: true, weight, l: pick[0], r: pick[1] })
    if (weight >= root) break
    if (nodes.length > 4096) throw new Error('CompressedBG 哈夫曼树不合法')
  }
  return nodes
}

// 解密（key 序列）+ 校验和 / 异或
export function decryptEncoded(data, start, length, key, checkSum, checkXor) {
  const out = Buffer.alloc(length)
  let sum = 0
  let xor = 0
  for (let i = 0; i < length; i++) {
    const v0 = Math.imul(20021, key & 0xffff) >>> 0
    let v1 = key >>> 16
    v1 = (Math.imul(v1, 20021) + Math.imul(key, 346)) >>> 0
    v1 = (v1 + (v0 >>> 16)) & 0xffff
    key = ((v1 << 16) + (v0 & 0xffff) + 1) >>> 0
    out[i] = (data[start + i] - (v1 & 0xff)) & 0xff
    sum = (sum + out[i]) & 0xff
    xor ^= out[i]
  }
  if (sum !== checkSum || xor !== checkXor) throw new Error('CompressedBG 校验失败')
  return out
}

// 比特读取（MSB 先出，和 GARbro MsbBitStream 一样：按需一次读一个字节；pos = 已经读进来的字节数）
class Bits {
  constructor(buf, start, end) { this.buf = buf; this.pos = start; this.end = end; this.bits = 0; this.cached = 0 }
  get(count) {
    while (this.cached < count) {
      if (this.pos >= this.end) return 0
      this.bits = ((this.bits << 8) | this.buf[this.pos++]) >>> 0
      this.cached += 8
    }
    this.cached -= count
    return count ? (this.bits >>> this.cached) & ((1 << count) - 1) : 0
  }
  token(nodes) {
    let n = nodes.length - 1
    do {
      if (this.cached === 0 && this.pos >= this.end) throw new Error('CompressedBG 比特流不完整')
      n = this.get(1) === 0 ? nodes[n].l : nodes[n].r
      if (n < 0) throw new Error('CompressedBG 比特流和树对不上')
    } while (nodes[n].parent)
    return n
  }
}

function readVarint(buf, p, end) {
  let v = 0
  let shift = 0
  let b
  do {
    if (p.at >= end || shift >= 32) throw new Error('CompressedBG 变长整数不完整')
    b = buf[p.at++]
    v += (b & 0x7f) * 2 ** shift
    shift += 7
  } while (b & 0x80)
  return v
}

// 只解到量化后的系数：返回 { rows: [每个 8 行块一个 Int16Array（通道 × 块 × 64）], alphaAt, ... }
export function parseV2(data, { width, height, bpp, key, encLen, checkSum, checkXor }) {
  if (encLen < 0x80 || 0x30 + encLen > data.length) throw new Error('CompressedBG v2 头不合理')
  const W = (width + 7) & -8
  const H = (height + 7) & -8
  const enc = decryptEncoded(data, 0x30, encLen, key, checkSum, checkXor)
  const baseOffset = 0x30 + encLen
  const p = { at: baseOffset }
  const weights1 = []
  for (let i = 0; i < 0x10; i++) weights1.push(readVarint(data, p, data.length))
  const weights2 = []
  for (let i = 0; i < 0xb0; i++) weights2.push(readVarint(data, p, data.length))
  const tree1 = buildTree(weights1, true)
  const tree2 = buildTree(weights2, true)
  const yBlocks = H / 8
  const offsets = []
  const inputBase = p.at + (yBlocks + 1) * 4 - baseOffset
  if (p.at + (yBlocks + 1) * 4 > data.length) throw new Error('CompressedBG v2 偏移表不完整')
  for (let i = 0; i <= yBlocks; i++) { offsets.push(data.readInt32LE(p.at) - inputBase); p.at += 4 }
  const inputStart = p.at   // decoder.Input = 偏移表之后的全部
  const inputLen = data.length - inputStart
  const padSkip = ((W >> 3) + 7) >> 3
  const channels = bpp === 8 ? 1 : 3
  const rows = []
  for (let i = 0; i < yBlocks; i++) {
    const blockOffset = offsets[i] + padSkip
    const nextOffset = i + 1 === yBlocks ? inputLen : offsets[i + 1]
    if (blockOffset < 0 || nextOffset > inputLen || blockOffset > nextOffset) throw new Error('CompressedBG v2 块偏移越界')
    const q = { at: inputStart + blockOffset }
    const end = inputStart + nextOffset
    const blockSize = readVarint(data, q, end)
    if (blockSize > W * 8 * channels + 64) throw new Error('CompressedBG v2 块大小不合理')
    const bits = new Bits(data, q.at, end)
    const coefs = new Int16Array(blockSize)
    let acc = 0
    for (let k = 0; k < blockSize && bits.pos < end; k += 64) {
      const count = bits.token(tree1)
      if (count !== 0) {
        let v = bits.get(count)
        if ((v >> (count - 1)) === 0) v = ((-1 << count) | v) + 1
        acc += v
      }
      coefs[k] = acc
    }
    if (bits.cached & 7) bits.get(bits.cached & 7)
    for (let k = 0; k < blockSize && bits.pos < end; k += 64) {
      let index = 1
      while (index < 64 && bits.pos < end) {
        let code = bits.token(tree2)
        if (code === 0) break
        if (code === 0xf) { index += 0x10; continue }
        index += code & 0xf
        if (index >= FILL_ORDER.length) break
        code >>= 4
        let v = bits.get(code)
        if (code !== 0 && (v >> (code - 1)) === 0) v = ((-1 << code) | v) + 1
        coefs[k + FILL_ORDER[index]] = v
        index++
      }
    }
    rows.push(coefs)
  }
  return { rows, enc, W, H, channels, alphaStart: inputStart + offsets[yBlocks], inputStart, inputLen }
}

const f2s = (f) => { const a = 0x80 + (Math.trunc(f) >> 3); return a <= 0 ? 0 : a <= 0xff ? a : a < 0x180 ? 0xff : 0 }
const f2b = (f) => (f >= 255 ? 255 : f <= 0 ? 0 : Math.trunc(f))

// 8×8 逆 DCT（GARbro DecodeDCT）：data 里 src 起 64 个量化系数，out = 64 个 0–255 的采样（行优先）
function inverseDct(quant, data, src, out) {
  const tmp = new Float32Array(64)
  for (let i = 0; i < 8; i++) {
    if (!data[src + 8 + i] && !data[src + 16 + i] && !data[src + 24 + i] && !data[src + 32 + i] && !data[src + 40 + i] && !data[src + 48 + i] && !data[src + 56 + i]) {
      const t = data[src + i] * quant[i]
      for (let k = 0; k < 8; k++) tmp[k * 8 + i] = t
      continue
    }
    let v1 = data[src + i] * quant[i]
    let v2 = data[src + 8 + i] * quant[8 + i]
    let v3 = data[src + 16 + i] * quant[16 + i]
    let v4 = data[src + 24 + i] * quant[24 + i]
    let v5 = data[src + 32 + i] * quant[32 + i]
    let v6 = data[src + 40 + i] * quant[40 + i]
    let v7 = data[src + 48 + i] * quant[48 + i]
    let v8 = data[src + 56 + i] * quant[56 + i]
    let v10 = v1 + v5
    let v11 = v1 - v5
    const v12 = v3 + v7
    let v13 = (v3 - v7) * 1.414213562 - v12
    v1 = v10 + v12
    v7 = v10 - v12
    v3 = v11 + v13
    v5 = v11 - v13
    const v14 = v2 + v8
    const v15 = v2 - v8
    const v16 = v6 + v4
    const v17 = v6 - v4
    v8 = v14 + v16
    v11 = (v14 - v16) * 1.414213562
    const v9 = (v17 + v15) * 1.847759065
    v10 = 1.0823922 * v15 - v9
    v13 = -2.61312593 * v17 + v9
    v6 = v13 - v8
    v4 = v11 - v6
    v2 = v10 + v4
    tmp[i] = v1 + v8
    tmp[8 + i] = v3 + v6
    tmp[16 + i] = v5 + v4
    tmp[24 + i] = v7 - v2
    tmp[32 + i] = v7 + v2
    tmp[40 + i] = v5 - v4
    tmp[48 + i] = v3 - v6
    tmp[56 + i] = v1 - v8
  }
  let dst = 0
  for (let i = 0; i < 8; i++) {
    const t = i * 8
    let v10 = tmp[t] + tmp[t + 4]
    let v11 = tmp[t] - tmp[t + 4]
    const v12 = tmp[t + 2] + tmp[t + 6]
    let v13 = tmp[t + 2] - tmp[t + 6]
    const v14 = tmp[t + 1] + tmp[t + 7]
    const v15 = tmp[t + 1] - tmp[t + 7]
    const v16 = tmp[t + 5] + tmp[t + 3]
    const v17 = tmp[t + 5] - tmp[t + 3]
    v13 = 1.414213562 * v13 - v12
    const v1 = v10 + v12
    const v7 = v10 - v12
    const v3 = v11 + v13
    const v5 = v11 - v13
    const v8 = v14 + v16
    v11 = (v14 - v16) * 1.414213562
    const v9 = (v17 + v15) * 1.847759065
    v10 = v9 - v15 * 1.0823922
    v13 = v9 - v17 * 2.61312593
    const v6 = v13 - v8
    const v4 = v11 - v6
    const v2 = v10 - v4
    out[dst++] = f2s(v1 + v8)
    out[dst++] = f2s(v3 + v6)
    out[dst++] = f2s(v5 + v4)
    out[dst++] = f2s(v7 + v2)
    out[dst++] = f2s(v7 - v2)
    out[dst++] = f2s(v5 - v4)
    out[dst++] = f2s(v3 - v6)
    out[dst++] = f2s(v1 - v8)
  }
}

// → { width, height, bpp: 8 | 24 | 32, pixels: 灰度 / BGR / BGRA }
export function cbgV2Decode(data, hdr) {
  const { width, height, bpp } = hdr
  if (![8, 24, 32].includes(bpp)) throw new Error(`CompressedBG v2 bpp ${bpp} 不支持`)
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('CompressedBG 宽高不合理')
  const parsed = parseV2(data, hdr)
  const { rows, enc, W, H, channels } = parsed
  const quant = [new Float32Array(64), new Float32Array(64)]
  for (let i = 0; i < 0x80; i++) quant[i >> 6][i & 0x3f] = Math.fround(enc[i] * DCT_TABLE[i & 0x3f])
  const out = new Uint8Array(W * H * 4)
  const sample = new Uint8Array(64 * 3)
  const one = new Uint8Array(64)
  rows.forEach((coefs, row) => {
    let dst = row * W * 32
    for (let b = 0; b < W / 8; b++) {
      if (channels === 1) {
        if (b * 64 + 64 > coefs.length) { dst += 32; continue }
        inverseDct(quant[0], coefs, b * 64, one)
        for (let j = 0; j < 64; j++) { const p = dst + ((j >> 3) * W + (j & 7)) * 4; out[p] = out[p + 1] = out[p + 2] = one[j] }
      } else {
        for (let c = 0; c < 3; c++) {
          const src = b * 64 + c * W * 8
          if (src + 64 > coefs.length) { one.fill(0); } else inverseDct(quant[c > 0 ? 1 : 0], coefs, src, one)
          for (let j = 0; j < 64; j++) sample[j * 3 + c] = one[j]
        }
        for (let j = 0; j < 64; j++) {
          const cy = sample[j * 3]
          const cb = sample[j * 3 + 1]
          const cr = sample[j * 3 + 2]
          const p = dst + ((j >> 3) * W + (j & 7)) * 4
          out[p] = f2b(cy + 1.772 * cb - 226.316)
          out[p + 1] = f2b(cy - 0.34414 * cb - 0.71414 * cr + 135.95984)
          out[p + 2] = f2b(cy + 1.402 * cr - 178.956)
        }
      }
      dst += 32
    }
  })
  // alpha（32 位）
  let hasAlpha = false
  if (bpp === 32 && parsed.alphaStart >= parsed.inputStart && parsed.alphaStart + 4 <= data.length) {
    let at = parsed.alphaStart
    const end = data.length
    if (data.readInt32LE(at) === 1) {
      at += 4
      let dst = 3
      let ctl = 2
      alpha: while (dst < out.length) {
        ctl >>= 1
        if (ctl === 1) { if (at >= end) break; ctl = data[at++] | 0x100 }
        if (ctl & 1) {
          if (at + 2 > end) break
          const v = data.readUInt16LE(at)
          at += 2
          let x = v & 0x3f
          if (x > 0x1f) x |= -0x40
          let y = (v >> 6) & 7
          if (y !== 0) y |= -8
          const count = ((v >> 9) & 0x7f) + 3
          let src = dst + (x + y * W) * 4
          if (src < 0 || src >= dst) break
          for (let i = 0; i < count; i++) { if (dst >= out.length) break alpha; out[dst] = out[src]; src += 4; dst += 4 }
        } else {
          if (at >= end) break
          out[dst] = data[at++]
          dst += 4
        }
      }
      hasAlpha = true
    }
  }
  // 裁掉 8 对齐的填充
  const channelsOut = bpp === 8 ? 1 : hasAlpha ? 4 : 3
  const pixels = Buffer.alloc(width * height * channelsOut)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = (y * W + x) * 4
    const d = (y * width + x) * channelsOut
    if (channelsOut === 1) pixels[d] = out[s]
    else { pixels[d] = out[s]; pixels[d + 1] = out[s + 1]; pixels[d + 2] = out[s + 2]; if (channelsOut === 4) pixels[d + 3] = out[s + 3] }
  }
  return { width, height, bpp: channelsOut * 8, pixels }
}
