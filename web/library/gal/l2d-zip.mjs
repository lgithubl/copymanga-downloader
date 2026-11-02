// Live2D 的 .l2d（KiriKiri Z 里的 Live2D 模型包）= 一个普通 ZIP：<名字>.moc3 / .model3.json / .cdi3.json / .userdata3.json / motions/*.motion3.json / <名字>.4096/texture_00.ktx（g08 的 14 个 ev_cg*.l2d 看过）。
// 这里只做三件事：读 ZIP 目录（只读尾部）、取一个成员（stored / deflate）、把 KTX 1.1 纹理解成 RGBA（BC7 / 未压缩 RGBA8）。
import { inflateRawSync } from 'node:zlib'
import { decodeBc7 } from './bc7.mjs'

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

// 尾部（至少含 EOCD，最多 64KB + 22）→ { count, cdSize, cdOffset }；找不到 = null
export function parseZipEnd(tail) {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue
    const count = tail.readUInt16LE(i + 10)
    const cdSize = tail.readUInt32LE(i + 12)
    const cdOffset = tail.readUInt32LE(i + 16)
    if (count === 0xffff || cdOffset === 0xffffffff) return null   // zip64：这些包用不到
    return { count, cdSize, cdOffset }
  }
  return null
}
// 中央目录 → [{ name, method, csize, usize, lho }]（目录项 / 空名字跳过）
export function parseZipCentral(buf, count) {
  const out = []
  let p = 0
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (name && !name.endsWith('/')) out.push({ name, method, csize, usize, lho })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
// 整个 ZIP 在内存里时取一个成员
export function extractZipMember(zip, entry) {
  const p = entry.lho
  if (p + 30 > zip.length || zip.readUInt32LE(p) !== LOC_SIG) throw new Error('ZIP 本地头不对')
  const start = p + 30 + zip.readUInt16LE(p + 26) + zip.readUInt16LE(p + 28)
  const raw = zip.subarray(start, start + entry.csize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`ZIP 压缩方式 ${entry.method} 不支持`)
}

// KTX 1.1：第一级 mip → { width, height, data（RGBA8，第一行在上——Live2D 的 UV 就是按这个方向算的） }
const KTX_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])
export function ktxToRgba(buf) {
  if (buf.length < 68 || !buf.subarray(0, 12).equals(KTX_MAGIC)) throw new Error('不是 KTX 1.1')
  if (buf.readUInt32LE(12) !== 0x04030201) throw new Error('KTX 不是小端')
  const glFormat = buf.readUInt32LE(24)
  const glInternalFormat = buf.readUInt32LE(28)
  const width = buf.readUInt32LE(36)
  const height = buf.readUInt32LE(40)
  const kv = buf.readUInt32LE(60)
  const at = 64 + kv
  const imageSize = buf.readUInt32LE(at)
  const start = at + 4
  if (glInternalFormat === 0x8e8c || glInternalFormat === 0x8e8d) return { width, height, data: decodeBc7(buf, width, height, start) }   // RGBA_BPTC_UNORM / SRGB_ALPHA_BPTC_UNORM
  if (glFormat === 0x1908 && imageSize >= width * height * 4) return { width, height, data: Buffer.from(buf.subarray(start, start + width * height * 4)) }   // 未压缩 RGBA
  throw new Error(`KTX 格式 0x${glInternalFormat.toString(16)} 不支持（只认 BC7 / RGBA8）`)
}
