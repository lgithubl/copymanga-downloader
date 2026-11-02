// BC7（BPTC）纹理块解码 → RGBA8。移植自 bcdec（iOrange，MIT / 公有领域，https://github.com/iOrange/bcdec）的 bcdec_bc7；分区表原样搬过来（每个条目 = 子集号，+128 = 该子集的 fix-up 下标，3 子集表里 129 / 130 = 子集 1 / 2 的 fix-up）。
// Live2D（KiriKiri 的 .l2d 里的 .ktx）的纹理是 BC7；用 texture2ddecoder（pip）逐块对过。
// 用法：decodeBc7(Uint8Array 数据, 宽, 高) → Buffer RGBA（宽 × 高 × 4，左上角起，宽高不是 4 的倍数的话多余的块边缘被裁掉）
const PART2 = Uint8Array.from([
  128,0,1,1,0,0,1,1,0,0,1,1,0,0,1,129,
  128,0,0,1,0,0,0,1,0,0,0,1,0,0,0,129,
  128,1,1,1,0,1,1,1,0,1,1,1,0,1,1,129,
  128,0,0,1,0,0,1,1,0,0,1,1,0,1,1,129,
  128,0,0,0,0,0,0,1,0,0,0,1,0,0,1,129,
  128,0,1,1,0,1,1,1,0,1,1,1,1,1,1,129,
  128,0,0,1,0,0,1,1,0,1,1,1,1,1,1,129,
  128,0,0,0,0,0,0,1,0,0,1,1,0,1,1,129,
  128,0,0,0,0,0,0,0,0,0,0,1,0,0,1,129,
  128,0,1,1,0,1,1,1,1,1,1,1,1,1,1,129,
  128,0,0,0,0,0,0,1,0,1,1,1,1,1,1,129,
  128,0,0,0,0,0,0,0,0,0,0,1,0,1,1,129,
  128,0,0,1,0,1,1,1,1,1,1,1,1,1,1,129,
  128,0,0,0,0,0,0,0,1,1,1,1,1,1,1,129,
  128,0,0,0,1,1,1,1,1,1,1,1,1,1,1,129,
  128,0,0,0,0,0,0,0,0,0,0,0,1,1,1,129,
  128,0,0,0,1,0,0,0,1,1,1,0,1,1,1,129,
  128,1,129,1,0,0,0,1,0,0,0,0,0,0,0,0,
  128,0,0,0,0,0,0,0,129,0,0,0,1,1,1,0,
  128,1,129,1,0,0,1,1,0,0,0,1,0,0,0,0,
  128,0,129,1,0,0,0,1,0,0,0,0,0,0,0,0,
  128,0,0,0,1,0,0,0,129,1,0,0,1,1,1,0,
  128,0,0,0,0,0,0,0,129,0,0,0,1,1,0,0,
  128,1,1,1,0,0,1,1,0,0,1,1,0,0,0,129,
  128,0,129,1,0,0,0,1,0,0,0,1,0,0,0,0,
  128,0,0,0,1,0,0,0,129,0,0,0,1,1,0,0,
  128,1,129,0,0,1,1,0,0,1,1,0,0,1,1,0,
  128,0,129,1,0,1,1,0,0,1,1,0,1,1,0,0,
  128,0,0,1,0,1,1,1,129,1,1,0,1,0,0,0,
  128,0,0,0,1,1,1,1,129,1,1,1,0,0,0,0,
  128,1,129,1,0,0,0,1,1,0,0,0,1,1,1,0,
  128,0,129,1,1,0,0,1,1,0,0,1,1,1,0,0,
  128,1,0,1,0,1,0,1,0,1,0,1,0,1,0,129,
  128,0,0,0,1,1,1,1,0,0,0,0,1,1,1,129,
  128,1,0,1,1,0,129,0,0,1,0,1,1,0,1,0,
  128,0,1,1,0,0,1,1,129,1,0,0,1,1,0,0,
  128,0,129,1,1,1,0,0,0,0,1,1,1,1,0,0,
  128,1,0,1,0,1,0,1,129,0,1,0,1,0,1,0,
  128,1,1,0,1,0,0,1,0,1,1,0,1,0,0,129,
  128,1,0,1,1,0,1,0,1,0,1,0,0,1,0,129,
  128,1,129,1,0,0,1,1,1,1,0,0,1,1,1,0,
  128,0,0,1,0,0,1,1,129,1,0,0,1,0,0,0,
  128,0,129,1,0,0,1,0,0,1,0,0,1,1,0,0,
  128,0,129,1,1,0,1,1,1,1,0,1,1,1,0,0,
  128,1,129,0,1,0,0,1,1,0,0,1,0,1,1,0,
  128,0,1,1,1,1,0,0,1,1,0,0,0,0,1,129,
  128,1,1,0,0,1,1,0,1,0,0,1,1,0,0,129,
  128,0,0,0,0,1,129,0,0,1,1,0,0,0,0,0,
  128,1,0,0,1,1,129,0,0,1,0,0,0,0,0,0,
  128,0,129,0,0,1,1,1,0,0,1,0,0,0,0,0,
  128,0,0,0,0,0,129,0,0,1,1,1,0,0,1,0,
  128,0,0,0,0,1,0,0,129,1,1,0,0,1,0,0,
  128,1,1,0,1,1,0,0,1,0,0,1,0,0,1,129,
  128,0,1,1,0,1,1,0,1,1,0,0,1,0,0,129,
  128,1,129,0,0,0,1,1,1,0,0,1,1,1,0,0,
  128,0,129,1,1,0,0,1,1,1,0,0,0,1,1,0,
  128,1,1,0,1,1,0,0,1,1,0,0,1,0,0,129,
  128,1,1,0,0,0,1,1,0,0,1,1,1,0,0,129,
  128,1,1,1,1,1,1,0,1,0,0,0,0,0,0,129,
  128,0,0,1,1,0,0,0,1,1,1,0,0,1,1,129,
  128,0,0,0,1,1,1,1,0,0,1,1,0,0,1,129,
  128,0,129,1,0,0,1,1,1,1,1,1,0,0,0,0,
  128,0,129,0,0,0,1,0,1,1,1,0,1,1,1,0,
  128,1,0,0,0,1,0,0,0,1,1,1,0,1,1,129,
])
const PART3 = Uint8Array.from([
  128,0,1,129,0,0,1,1,0,2,2,1,2,2,2,130,
  128,0,0,129,0,0,1,1,130,2,1,1,2,2,2,1,
  128,0,0,0,2,0,0,1,130,2,1,1,2,2,1,129,
  128,2,2,130,0,0,2,2,0,0,1,1,0,1,1,129,
  128,0,0,0,0,0,0,0,129,1,2,2,1,1,2,130,
  128,0,1,129,0,0,1,1,0,0,2,2,0,0,2,130,
  128,0,2,130,0,0,2,2,1,1,1,1,1,1,1,129,
  128,0,1,1,0,0,1,1,130,2,1,1,2,2,1,129,
  128,0,0,0,0,0,0,0,129,1,1,1,2,2,2,130,
  128,0,0,0,1,1,1,1,129,1,1,1,2,2,2,130,
  128,0,0,0,1,1,129,1,2,2,2,2,2,2,2,130,
  128,0,1,2,0,0,129,2,0,0,1,2,0,0,1,130,
  128,1,1,2,0,1,129,2,0,1,1,2,0,1,1,130,
  128,1,2,2,0,129,2,2,0,1,2,2,0,1,2,130,
  128,0,1,129,0,1,1,2,1,1,2,2,1,2,2,130,
  128,0,1,129,2,0,0,1,130,2,0,0,2,2,2,0,
  128,0,0,129,0,0,1,1,0,1,1,2,1,1,2,130,
  128,1,1,129,0,0,1,1,130,0,0,1,2,2,0,0,
  128,0,0,0,1,1,2,2,129,1,2,2,1,1,2,130,
  128,0,2,130,0,0,2,2,0,0,2,2,1,1,1,129,
  128,1,1,129,0,1,1,1,0,2,2,2,0,2,2,130,
  128,0,0,129,0,0,0,1,130,2,2,1,2,2,2,1,
  128,0,0,0,0,0,129,1,0,1,2,2,0,1,2,130,
  128,0,0,0,1,1,0,0,130,2,129,0,2,2,1,0,
  128,1,2,130,0,129,2,2,0,0,1,1,0,0,0,0,
  128,0,1,2,0,0,1,2,129,1,2,2,2,2,2,130,
  128,1,1,0,1,2,130,1,129,2,2,1,0,1,1,0,
  128,0,0,0,0,1,129,0,1,2,130,1,1,2,2,1,
  128,0,2,2,1,1,0,2,129,1,0,2,0,0,2,130,
  128,1,1,0,0,129,1,0,2,0,0,2,2,2,2,130,
  128,0,1,1,0,1,2,2,0,1,130,2,0,0,1,129,
  128,0,0,0,2,0,0,0,130,2,1,1,2,2,2,129,
  128,0,0,0,0,0,0,2,129,1,2,2,1,2,2,130,
  128,2,2,130,0,0,2,2,0,0,1,2,0,0,1,129,
  128,0,1,129,0,0,1,2,0,0,2,2,0,2,2,130,
  128,1,2,0,0,129,2,0,0,1,130,0,0,1,2,0,
  128,0,0,0,1,1,129,1,2,2,130,2,0,0,0,0,
  128,1,2,0,1,2,0,1,130,0,129,2,0,1,2,0,
  128,1,2,0,2,0,1,2,129,130,0,1,0,1,2,0,
  128,0,1,1,2,2,0,0,1,1,130,2,0,0,1,129,
  128,0,1,1,1,1,130,2,2,2,0,0,0,0,1,129,
  128,1,0,129,0,1,0,1,2,2,2,2,2,2,2,130,
  128,0,0,0,0,0,0,0,130,1,2,1,2,1,2,129,
  128,0,2,2,1,129,2,2,0,0,2,2,1,1,2,130,
  128,0,2,130,0,0,1,1,0,0,2,2,0,0,1,129,
  128,2,2,0,1,2,130,1,0,2,2,0,1,2,2,129,
  128,1,0,1,2,2,130,2,2,2,2,2,0,1,0,129,
  128,0,0,0,2,1,2,1,130,1,2,1,2,1,2,129,
  128,1,0,129,0,1,0,1,0,1,0,1,2,2,2,130,
  128,2,2,130,0,1,1,1,0,2,2,2,0,1,1,129,
  128,0,0,2,1,129,1,2,0,0,0,2,1,1,1,130,
  128,0,0,0,2,129,1,2,2,1,1,2,2,1,1,130,
  128,2,2,2,0,129,1,1,0,1,1,1,0,2,2,130,
  128,0,0,2,1,1,1,2,129,1,1,2,0,0,0,130,
  128,1,1,0,0,129,1,0,0,1,1,0,2,2,2,130,
  128,0,0,0,0,0,0,0,2,1,129,2,2,1,1,130,
  128,1,1,0,0,129,1,0,2,2,2,2,2,2,2,130,
  128,0,2,2,0,0,1,1,0,0,129,1,0,0,2,130,
  128,0,2,2,1,1,2,2,129,1,2,2,0,0,2,130,
  128,0,0,0,0,0,0,0,0,0,0,0,2,129,1,130,
  128,0,0,130,0,0,0,1,0,0,0,2,0,0,0,129,
  128,2,2,2,1,2,2,2,0,2,2,2,129,2,2,130,
  128,1,0,129,2,2,2,2,2,2,2,2,2,2,2,130,
  128,1,1,129,2,0,1,1,130,2,0,1,2,2,2,0,
])
const ACTUAL_BITS = [[4, 6, 5, 7, 5, 7, 7, 5], [0, 0, 0, 0, 6, 8, 7, 5]]   // [RGB 位数, alpha 位数]
const WEIGHT2 = [0, 21, 43, 64]
const WEIGHT3 = [0, 9, 18, 27, 37, 46, 55, 64]
const WEIGHT4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]
const HAS_PBITS = 0b11001011

const interpolate = (a, b, weights, index) => (a * (64 - weights[index]) + b * weights[index] + 32) >> 6

// 128 位的位流（低 64 + 高 64，用 BigInt 太慢：拆成 4 个 32 位）
function reader(data, offset) {
  const w = [data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24), data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24), data[offset + 8] | (data[offset + 9] << 8) | (data[offset + 10] << 16) | (data[offset + 11] << 24), data[offset + 12] | (data[offset + 13] << 8) | (data[offset + 14] << 16) | (data[offset + 15] << 24)]
  let pos = 0
  return (n) => {
    // 读 n（≤ 8）位：可能跨两个 32 位字
    const word = pos >> 5
    const shift = pos & 31
    let v = w[word] >>> shift
    if (shift + n > 32 && word < 3) v |= w[word + 1] << (32 - shift)
    pos += n
    return v & ((1 << n) - 1)
  }
}

function decodeBlock(data, offset, out, outOffset, stride) {
  const read = reader(data, offset)
  let mode = 0
  while (mode < 8 && read(1) === 0) mode++
  if (mode >= 8) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const o = outOffset + i * stride + j * 4; out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0 }
    return
  }
  let partition = 0
  let numPartitions = 1
  let rotation = 0
  let indexSelectionBit = 0
  if (mode === 0 || mode === 1 || mode === 2 || mode === 3 || mode === 7) {
    numPartitions = mode === 0 || mode === 2 ? 3 : 2
    partition = read(mode === 0 ? 4 : 6)
  }
  const numEndpoints = numPartitions * 2
  if (mode === 4 || mode === 5) {
    rotation = read(2)
    if (mode === 4) indexSelectionBit = read(1)
  }
  const endpoints = Array.from({ length: 6 }, () => [0, 0, 0, 0])
  for (let i = 0; i < 3; i++) for (let j = 0; j < numEndpoints; j++) endpoints[j][i] = read(ACTUAL_BITS[0][mode])
  if (ACTUAL_BITS[1][mode] > 0) for (let j = 0; j < numEndpoints; j++) endpoints[j][3] = read(ACTUAL_BITS[1][mode])
  if (mode === 0 || mode === 1 || mode === 3 || mode === 6 || mode === 7) {
    for (let i = 0; i < numEndpoints; i++) for (let j = 0; j < 4; j++) endpoints[i][j] <<= 1
    if (mode === 1) {
      const i = read(1)
      const j = read(1)
      for (let k = 0; k < 3; k++) { endpoints[0][k] |= i; endpoints[1][k] |= i; endpoints[2][k] |= j; endpoints[3][k] |= j }
    } else if (HAS_PBITS & (1 << mode)) {
      for (let i = 0; i < numEndpoints; i++) { const j = read(1); for (let k = 0; k < 4; k++) endpoints[i][k] |= j }
    }
  }
  for (let i = 0; i < numEndpoints; i++) {
    let j = ACTUAL_BITS[0][mode] + ((HAS_PBITS >> mode) & 1)
    for (let k = 0; k < 3; k++) { endpoints[i][k] <<= 8 - j; endpoints[i][k] |= endpoints[i][k] >> j }
    j = ACTUAL_BITS[1][mode] + ((HAS_PBITS >> mode) & 1)
    endpoints[i][3] <<= 8 - j
    endpoints[i][3] |= endpoints[i][3] >> j
  }
  if (!ACTUAL_BITS[1][mode]) for (let j = 0; j < numEndpoints; j++) endpoints[j][3] = 0xff
  const indexBits0 = mode === 0 || mode === 1 ? 3 : mode === 6 ? 4 : 2
  const indexBits2 = mode === 4 ? 3 : mode === 5 ? 2 : 0
  const weights = indexBits0 === 2 ? WEIGHT2 : indexBits0 === 3 ? WEIGHT3 : WEIGHT4
  const weights2 = indexBits2 === 2 ? WEIGHT2 : WEIGHT3
  const table = numPartitions === 3 ? PART3 : PART2
  const setOf = (i, j) => (numPartitions === 1 ? (i | j ? 0 : 128) : table[partition * 16 + i * 4 + j])
  const indices = new Uint8Array(16)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let bits = indexBits0
    if (setOf(i, j) & 0x80) bits--
    indices[i * 4 + j] = read(bits)
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const set = setOf(i, j) & 0x03
    const index = indices[i * 4 + j]
    const e0 = endpoints[set * 2]
    const e1 = endpoints[set * 2 + 1]
    let r
    let g
    let b
    let a
    if (!indexBits2) {
      r = interpolate(e0[0], e1[0], weights, index); g = interpolate(e0[1], e1[1], weights, index); b = interpolate(e0[2], e1[2], weights, index); a = interpolate(e0[3], e1[3], weights, index)
    } else {
      const index2 = read(i | j ? indexBits2 : indexBits2 - 1)
      if (!indexSelectionBit) {
        r = interpolate(e0[0], e1[0], weights, index); g = interpolate(e0[1], e1[1], weights, index); b = interpolate(e0[2], e1[2], weights, index); a = interpolate(e0[3], e1[3], weights2, index2)
      } else {
        r = interpolate(e0[0], e1[0], weights2, index2); g = interpolate(e0[1], e1[1], weights2, index2); b = interpolate(e0[2], e1[2], weights2, index2); a = interpolate(e0[3], e1[3], weights, index)
      }
    }
    let t
    if (rotation === 1) { t = a; a = r; r = t } else if (rotation === 2) { t = a; a = g; g = t } else if (rotation === 3) { t = a; a = b; b = t }
    const o = outOffset + i * stride + j * 4
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
  }
}

export function decodeBc7(data, width, height, offset = 0) {
  const bw = Math.ceil(width / 4)
  const bh = Math.ceil(height / 4)
  if (data.length - offset < bw * bh * 16) throw new Error('BC7 数据不够')
  const out = Buffer.alloc(width * height * 4)
  const stride = width * 4
  const block = new Uint8Array(64)
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const full = bx * 4 + 4 <= width && by * 4 + 4 <= height
    if (full) decodeBlock(data, offset + (by * bw + bx) * 16, out, by * 4 * stride + bx * 16, stride)
    else {
      decodeBlock(data, offset + (by * bw + bx) * 16, block, 0, 16)
      for (let y = 0; y < 4 && by * 4 + y < height; y++) for (let x = 0; x < 4 && bx * 4 + x < width; x++) { const o = (by * 4 + y) * stride + (bx * 4 + x) * 4; const s = y * 16 + x * 4; out[o] = block[s]; out[o + 1] = block[s + 1]; out[o + 2] = block[s + 2]; out[o + 3] = block[s + 3] }
    }
  }
  return out
}
