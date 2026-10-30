#!/usr/bin/env node
// 自测（纯 node）：PNAP（预乘 alpha）立绘帧的 PNG 还原成直通 alpha（png-unpremultiply.mjs）
//   · 手写的 RGBA 图：每个像素还原成 颜色 / alpha；alpha 255 / 0 的特殊处理；5 种行滤波（None / Sub / Up / Average / Paeth）都解得对
//   · 不认的格式（调色板 / 16 位 / 隔行 / 不是 PNG / 被截断）原样返回、converted = false、带原因
//   · 真实样本（有就跑）：LPSL 的腮红帧 ST_MEG_A_M #26——预乘后颜色 ≈ 粉色 × alpha，还原后各 alpha 档的颜色都是同一个粉色
//   node scripts/dev/gal-png-unpremultiply-selftest.mjs
import { existsSync, readFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { unpremultiplyPng } from '../../web/library/gal/png-unpremultiply.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body)); return Buffer.concat([len, body, tail]) }
// 把 w×h 的 RGBA 像素（数组）按指定滤波类型编码成 PNG
function encode(w, h, pixels, filterOf = () => 0, { depth = 8, color = 6, interlace = 0 } = {}) {
  const stride = w * 4
  const rows = []
  for (let y = 0; y < h; y++) {
    const type = filterOf(y)
    const row = Buffer.alloc(1 + stride)
    row[0] = type
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x]
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0
      const b = y ? pixels[(y - 1) * stride + x] : 0
      const c = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0
      let pred = 0
      if (type === 1) pred = a
      else if (type === 2) pred = b
      else if (type === 3) pred = (a + b) >> 1
      else if (type === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      row[1 + x] = (cur - pred) & 0xff
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = color; ihdr[12] = interlace
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
function decode(png) {   // 只给测试用：8 位 RGBA 不隔行 → 像素数组
  let pos = 8; let w = 0; let h = 0; const idat = []
  while (pos < png.length) { const len = png.readUInt32BE(pos); const type = png.subarray(pos + 4, pos + 8).toString(); const data = png.subarray(pos + 8, pos + 8 + len); if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) } if (type === 'IDAT') idat.push(data); pos += 12 + len }
  const raw = inflateSync(Buffer.concat(idat)); const out = []
  for (let y = 0; y < h; y++) { if (raw[y * (w * 4 + 1)] !== 0) throw new Error('测试解码只认滤波 0'); for (let x = 0; x < w * 4; x++) out.push(raw[y * (w * 4 + 1) + 1 + x]) }
  return { w, h, pixels: out }
}

const W = 4
const H = 5
// 预乘的像素：颜色 = round(原色 × alpha / 255)
const original = []
const premul = []
for (let i = 0; i < W * H; i++) {
  const a = [0, 255, 128, 64, 200][i % 5]
  const base = [250, 190, 192]
  original.push(...(a ? base : [0, 0, 0]), a)
  premul.push(...(a ? base.map((v) => Math.round((v * a) / 255)) : [0, 0, 0]), a)
}
for (const [name, filterOf] of [['无滤波', () => 0], ['Sub', () => 1], ['Up', () => 2], ['Average', () => 3], ['Paeth', () => 4], ['每行不同', (y) => y % 5]]) {
  const out = unpremultiplyPng(encode(W, H, premul, filterOf))
  const got = out.converted ? decode(out.buffer) : null
  const maxErr = got ? Math.max(...got.pixels.map((v, i) => (i % 4 === 3 ? Math.abs(v - original[i]) : (premul[i + (3 - (i % 4))] === 0 ? 0 : Math.abs(v - original[i]))))) : 99
  check(`还原（${name}）：converted、尺寸不变、alpha 不变、颜色 ≈ 原色（最大误差 ≤ 4：低 alpha 处 8 位预乘本来就丢精度）`, out.converted && got.w === W && got.h === H && got.pixels.filter((_, i) => i % 4 === 3).every((a, i) => a === original[i * 4 + 3]) && maxErr <= 4, J({ converted: out.converted, reason: out.reason, maxErr }))
}
{
  const out = decode(unpremultiplyPng(encode(W, H, premul)).buffer)
  const at = (i) => out.pixels.slice(i * 4, i * 4 + 4)
  check('具体像素：alpha 255 → (190, 192…) 不变；alpha 0 → (0, 0, 0, 0)；alpha 128 → 原色 ±2', J(at(1)) === J([250, 190, 192, 255]) && J(at(0)) === J([0, 0, 0, 0]) && at(2).slice(0, 3).every((v, k) => Math.abs(v - [250, 190, 192][k]) <= 2) && at(2)[3] === 128, J([at(0), at(1), at(2)]))
}
for (const [name, png] of [
  ['调色板（颜色类型 3）', encode(2, 2, new Array(16).fill(0), () => 0, { color: 3 })],
  ['16 位', encode(2, 2, new Array(16).fill(0), () => 0, { depth: 16 })],
  ['隔行', encode(2, 2, new Array(16).fill(0), () => 0, { interlace: 1 })],
  ['不是 PNG', Buffer.from('RIFF....WEBPVP8 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')],
  ['被截断', encode(2, 2, new Array(16).fill(0)).subarray(0, 40)],
  ['太短', Buffer.from([1, 2, 3])],
]) {
  const out = unpremultiplyPng(png)
  check(`不认的格式（${name}）：原样返回、converted = false、有原因`, out.converted === false && out.buffer === png && typeof out.reason === 'string' && out.reason.length > 0, J(out.reason))
}
{
  const sample = '/home/user/workspace/samples/arc2/st_meg_A_M.pna/26.png'
  if (existsSync(sample)) {
    const input = readFileSync(sample)
    const out = unpremultiplyPng(input)
    const { pixels, w, h } = decode(out.buffer)
    const byAlpha = new Map()
    for (let i = 0; i < w * h; i++) { const a = pixels[i * 4 + 3]; if (a < 40) continue; const k = Math.round(a / 64); const v = byAlpha.get(k) || [0, 0, 0, 0]; v[0] += pixels[i * 4]; v[1] += pixels[i * 4 + 1]; v[2] += pixels[i * 4 + 2]; v[3] += 1; byAlpha.set(k, v) }
    const means = [...byAlpha].map(([k, v]) => [k, [v[0] / v[3], v[1] / v[3], v[2] / v[3]].map(Math.round)])
    check('真实样本（LPSL ST_MEG_A_M 帧 26，腮红）：229×127；转过；各 alpha 档的颜色都是同一个粉色（≈ 255, 193, 194，档间差 ≤ 6）', out.converted && w === 229 && h === 127 && means.length >= 3 && means.every(([, c]) => Math.abs(c[0] - 255) <= 6 && Math.abs(c[1] - 193) <= 6 && Math.abs(c[2] - 194) <= 6), J(means))
  } else console.log('SKIP 没有 LPSL 腮红帧样本')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
