// 复用仓库 UnityFS 读取，补充纯 Node LZMA 支持，无运行时下载。
import { lzmaBlock } from './lzma.mjs'
export function lz4Block(src, outSize) {
  const out = Buffer.allocUnsafe(outSize)
  let i = 0
  let o = 0
  while (i < src.length) {
    const token = src[i++]
    let lit = token >> 4
    if (lit === 15) { let b; do { b = src[i++]; lit += b } while (b === 255) }
    if (o + lit > outSize || i + lit > src.length) throw new Error('LZ4：字面量越界')
    src.copy(out, o, i, i + lit); i += lit; o += lit
    if (i >= src.length) break
    const offset = src[i] | (src[i + 1] << 8); i += 2
    let len = token & 15
    if (len === 15) { let b; do { b = src[i++]; len += b } while (b === 255) }
    len += 4
    if (offset === 0 || offset > o || o + len > outSize) throw new Error('LZ4：匹配越界')
    for (let k = 0; k < len; k++) { out[o] = out[o - offset]; o++ }
  }
  if (o !== outSize) throw new Error(`LZ4：解出 ${o} 字节，应为 ${outSize}`)
  return out
}

const align = (n, a) => (n + a - 1) & ~(a - 1)
const cstr = (buf, pos) => { const end = buf.indexOf(0, pos); return { text: buf.toString('utf8', pos, end), next: end + 1 } }

// → [{ name, data }]：bundle 里的每个文件（通常 1 个 CAB-…）
export function readUnityFS(buf) {
  if (buf.toString('latin1', 0, 7) !== 'UnityFS') throw new Error('不是 UnityFS')
  let p = 8
  const version = buf.readUInt32BE(p); p += 4
  p = cstr(buf, p).next
  p = cstr(buf, p).next
  p += 8   // 文件总大小
  const cs = buf.readUInt32BE(p); const us = buf.readUInt32BE(p + 4); const flags = buf.readUInt32BE(p + 8); p += 12
  if (version >= 7 && (flags & 0x200)) p = align(p, 16)
  const infoRaw = buf.subarray(flags & 0x80 ? buf.length - cs : p, (flags & 0x80 ? buf.length - cs : p) + cs)
  const comp = flags & 0x3f
  if (![0, 1, 2, 3].includes(comp)) throw new Error(`blocks info 压缩方式 ${comp} 不支持`)
  const info = comp === 0 ? infoRaw : comp === 1 ? lzmaBlock(infoRaw, us) : lz4Block(infoRaw, us)
  let q = 16
  const blockCount = info.readUInt32BE(q); q += 4
  const blocks = []
  for (let i = 0; i < blockCount; i++) { blocks.push({ u: info.readUInt32BE(q), c: info.readUInt32BE(q + 4), f: info.readUInt16BE(q + 8) }); q += 10 }
  const dirCount = info.readUInt32BE(q); q += 4
  const dirs = []
  for (let i = 0; i < dirCount; i++) {
    const offset = Number(info.readBigUInt64BE(q)); const size = Number(info.readBigUInt64BE(q + 8)); q += 20
    const s = cstr(info, q); q = s.next
    dirs.push({ offset, size, name: s.text })
  }
  let pos = flags & 0x80 ? p : p + cs
  if (version >= 7 && (flags & 0x200) && !(flags & 0x80)) pos = align(pos, 16)
  const parts = []
  for (const b of blocks) {
    const raw = buf.subarray(pos, pos + b.c); pos += b.c
    const t = b.f & 0x3f
    if (t === 0) parts.push(raw)
    else if (t === 1) parts.push(lzmaBlock(raw, b.u))
    else if (t === 2 || t === 3) parts.push(lz4Block(raw, b.u))
    else throw new Error(`数据块压缩方式 ${t} 不支持`)
  }
  const data = Buffer.concat(parts)
  return dirs.map((d) => ({ name: d.name, data: data.subarray(d.offset, d.offset + d.size) }))
}
