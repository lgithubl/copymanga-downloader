// ETC2 RGBA8 port of mikunyan/Texture2DDecoder (MIT).
// See THIRD_PARTY_NOTICES.txt. Returns RGBA, in source row order.
const ORDER = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15]
const MOD = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]]
const DIST = [3, 6, 11, 16, 23, 32, 41, 64]
const ALPHA = [
  [-3,-6,-9,-15,2,5,8,14],[-3,-7,-10,-13,2,6,9,12],[-2,-5,-8,-13,1,4,7,12],[-2,-4,-6,-13,1,3,5,12],
  [-3,-6,-8,-12,2,5,7,11],[-3,-7,-9,-11,2,6,8,10],[-4,-7,-8,-11,3,6,7,10],[-3,-5,-8,-11,2,4,7,10],
  [-2,-6,-8,-10,1,5,7,9],[-2,-5,-8,-10,1,4,7,9],[-2,-4,-8,-10,1,3,7,9],[-2,-5,-7,-10,1,4,6,9],
  [-3,-4,-7,-10,2,3,6,9],[-1,-2,-3,-10,0,1,2,9],[-4,-6,-8,-9,3,5,7,8],[-3,-5,-7,-9,2,4,6,8]
]
const clamp = (v) => Math.max(0, Math.min(255, v))
const tint = (c, d = 0) => c.map((v) => clamp(v + d))

function colorBlock(d, out) {
  let low = d[6] << 8 | d[7], high = d[4] << 8 | d[5]
  const c = [[0,0,0], [0,0,0], [0,0,0]]
  const put = (i, rgb) => { const p = i * 4; out[p] = rgb[0]; out[p+1] = rgb[1]; out[p+2] = rgb[2]; out[p+3] = 255 }
  const palette = (colors) => {
    high <<= 1
    for (let i = 0; i < 16; i++, low >>= 1, high >>= 1) put(ORDER[i], colors[(high & 2) | (low & 1)])
  }
  if (d[3] & 2) {
    const bases = [d[0] & 248, d[1] & 248, d[2] & 248]
    const delta = [0,1,2].map((i) => (d[i] << 3 & 24) - (d[i] << 3 & 32))
    if (bases[0] + delta[0] < 0 || bases[0] + delta[0] > 255) {
      c[0] = [(d[0] << 3 & 192) | (d[0] << 4 & 48) | (d[0] >> 1 & 12) | (d[0] & 3), (d[1] & 240) | (d[1] >> 4), (d[1] & 15) | (d[1] << 4 & 255)]
      c[1] = [(d[2] & 240) | (d[2] >> 4), (d[2] & 15) | (d[2] << 4 & 255), (d[3] & 240) | (d[3] >> 4)]
      const distance = DIST[(d[3] >> 1 & 6) | (d[3] & 1)]
      palette([c[0], tint(c[1], distance), c[1], tint(c[1], -distance)])
      return
    }
    if (bases[1] + delta[1] < 0 || bases[1] + delta[1] > 255) {
      c[0][0] = (d[0] << 1 & 240) | (d[0] >> 3 & 15)
      c[0][1] = (d[0] << 5 & 224) | (d[1] & 16); c[0][1] |= c[0][1] >> 4
      c[0][2] = (d[1] & 8) | (d[1] << 1 & 6) | (d[2] >> 7); c[0][2] |= c[0][2] << 4
      c[1][0] = (d[2] << 1 & 240) | (d[2] >> 3 & 15)
      c[1][1] = (d[2] << 5 & 224) | (d[3] >> 3 & 16); c[1][1] |= c[1][1] >> 4
      c[1][2] = (d[3] << 1 & 240) | (d[3] >> 3 & 15)
      let distance = (d[3] & 4) | (d[3] << 1 & 2)
      if (c[0][0] > c[1][0] || (c[0][0] === c[1][0] && (c[0][1] > c[1][1] || (c[0][1] === c[1][1] && c[0][2] >= c[1][2])))) distance++
      distance = DIST[distance]
      palette([tint(c[0], distance), tint(c[0], -distance), tint(c[1], distance), tint(c[1], -distance)])
      return
    }
    if (bases[2] + delta[2] < 0 || bases[2] + delta[2] > 255) {
      c[0][0] = (d[0] << 1 & 252) | (d[0] >> 5 & 3)
      c[0][1] = (d[0] << 7 & 128) | (d[1] & 126) | (d[0] & 1)
      c[0][2] = (d[1] << 7 & 128) | (d[2] << 2 & 96) | (d[2] << 3 & 24) | (d[3] >> 5 & 4); c[0][2] |= c[0][2] >> 6
      c[1][0] = (d[3] << 1 & 248) | (d[3] << 2 & 4) | (d[3] >> 5 & 3)
      c[1][1] = (d[4] & 254) | (d[4] >> 7)
      c[1][2] = (d[4] << 7 & 128) | (d[5] >> 1 & 124); c[1][2] |= c[1][2] >> 6
      c[2][0] = (d[5] << 5 & 224) | (d[6] >> 3 & 28) | (d[5] >> 1 & 3)
      c[2][1] = (d[6] << 3 & 248) | (d[7] >> 5 & 6) | (d[6] >> 4 & 1)
      c[2][2] = (d[7] << 2 & 255) | (d[7] >> 4 & 3)
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) put(y * 4 + x, c[0].map((v, i) => clamp((x * (c[1][i] - v) + y * (c[2][i] - v) + 4 * v + 2) >> 2)))
      return
    }
    for (let i = 0; i < 3; i++) { c[0][i] = bases[i] | bases[i] >> 5; const v = bases[i] + delta[i]; c[1][i] = v | v >> 5 }
  } else {
    for (let i = 0; i < 3; i++) { c[0][i] = (d[i] & 240) | d[i] >> 4; c[1][i] = (d[i] & 15) | (d[i] << 4 & 255) }
  }
  const codes = [d[3] >> 5, d[3] >> 2 & 7], flip = d[3] & 1
  for (let i = 0; i < 16; i++, low >>= 1, high >>= 1) {
    const sub = flip ? (i & 3) >> 1 : i >> 3
    put(ORDER[i], tint(c[sub], MOD[codes[sub]][low & 1] * (high & 1 ? -1 : 1)))
  }
}

export function decodeETC2RGBA8(data, width, height) {
  const columns = Math.ceil(width / 4), rows = Math.ceil(height / 4)
  if (data.length < columns * rows * 16) throw new Error('ETC2 纹理数据截断')
  const pixels = Buffer.alloc(width * height * 4), block = Buffer.alloc(64)
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < columns; bx++) {
    const p = (by * columns + bx) * 16
    colorBlock(data.subarray(p + 8, p + 16), block)
    const multiplier = data[p + 1] >> 4, table = ALPHA[data[p + 1] & 15]
    let indices = data.readBigUInt64BE(p)
    for (let i = 0; i < 16; i++, indices >>= 3n) block[ORDER[15 - i] * 4 + 3] = clamp(data[p] + multiplier * table[Number(indices & 7n)])
    for (let y = 0; y < 4 && by * 4 + y < height; y++) block.copy(pixels, ((by * 4 + y) * width + bx * 4) * 4, y * 16, y * 16 + Math.min(4, width - bx * 4) * 4)
  }
  return pixels
}
