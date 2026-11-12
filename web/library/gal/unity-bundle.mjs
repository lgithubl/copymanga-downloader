// Unity AssetBundle（UnityFS）的最小读取：只为取出 TextAsset 的文字（Imys 的剧本 / 文案 bundle）。不碰贴图 / 网格。
//   · UnityFS 头 → blocks info（LZ4 / 不压缩；LZMA 没做）→ 数据块 → 目录（CAB-… = SerializedFile）
//   · SerializedFile v17+（Unity 6 = v22）：类型表（带 typetree 也认，只为跳过）+ 对象表（pathID / byteStart / byteSize / 类型号）
//   · TextAsset（classID 49）：name（u32 长度 + 字节，4 对齐）+ script（同）
// Imys 的 .encrypted = AES-256-CBC：key = HMAC-SHA256(密钥 'dB3aqcLtAmBd', 消息 'RWd3NusabzRc')，IV = 文件前 16 字节，密文 = 其后的全部；解出来是 UnityFS（对着 84 个真实 bundle 验证过，全部解得开）。
import { createDecipheriv, createHmac } from 'node:crypto'

export const IMYS_KEY = createHmac('sha256', 'dB3aqcLtAmBd').update('RWd3NusabzRc').digest()

export function imysDecrypt(buffer) {
  const n = buffer.length - 16 - ((buffer.length - 16) % 16)
  if (n < 16) throw new Error('太短，不是 Imys 的 .encrypted')
  const decipher = createDecipheriv('aes-256-cbc', IMYS_KEY, buffer.subarray(0, 16))
  decipher.setAutoPadding(false)
  const plain = Buffer.concat([decipher.update(buffer.subarray(16, 16 + n)), decipher.final()])
  if (plain.subarray(0, 7).toString('latin1') !== 'UnityFS') throw new Error('解密后不是 UnityFS（密钥不对，或不是 Imys 的 bundle）')
  return plain
}

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
export function readUnityFS(buf, {maxOutputBytes=512*1024*1024}={}) {
  if (buf.toString('latin1', 0, 7) !== 'UnityFS') throw new Error('不是 UnityFS')
  let p = 8
  const version = buf.readUInt32BE(p); p += 4
  p = cstr(buf, p).next
  p = cstr(buf, p).next
  p += 8   // 文件总大小
  const cs = buf.readUInt32BE(p); const us = buf.readUInt32BE(p + 4); const flags = buf.readUInt32BE(p + 8); p += 12
  if (version >= 7 && (flags & 0x200)) p = align(p, 16)
  if(us>Math.min(maxOutputBytes,32*1024*1024)||cs>buf.length)throw Error('UnityFS 索引超过读取上限')
  const infoRaw = buf.subarray(flags & 0x80 ? buf.length - cs : p, (flags & 0x80 ? buf.length - cs : p) + cs)
  const comp = flags & 0x3f
  if (comp !== 0 && comp !== 2 && comp !== 3) throw new Error(`blocks info 压缩方式 ${comp} 没做（只做了 LZ4 / 不压缩）`)
  const info = comp === 0 ? infoRaw : lz4Block(infoRaw, us)
  let q = 16
  const blockCount = info.readUInt32BE(q); q += 4
  const blocks = []
  for (let i = 0; i < blockCount; i++) { blocks.push({ u: info.readUInt32BE(q), c: info.readUInt32BE(q + 4), f: info.readUInt16BE(q + 8) }); q += 10 }
  if(blocks.reduce((n,b)=>n+b.u,0)>maxOutputBytes)throw Error('UnityFS 解压数据超过读取上限')
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
    if(pos+b.c>buf.length)throw Error('UnityFS 数据块截断')
    const raw = buf.subarray(pos, pos + b.c); pos += b.c
    const t = b.f & 0x3f
    if (t === 0) {if(raw.length!==b.u)throw Error('UnityFS 未压缩块长度不符');parts.push(raw)}
    else if (t === 2 || t === 3) parts.push(lz4Block(raw, b.u))
    else throw new Error(`数据块压缩方式 ${t} 没做（只做了 LZ4 / 不压缩）`)
  }
  const data = Buffer.concat(parts)
  return dirs.map((d) => {if(!Number.isSafeInteger(d.offset)||!Number.isSafeInteger(d.size)||d.offset<0||d.size<0||d.offset+d.size>data.length)throw Error('UnityFS 文件范围无效');return { name: d.name, data: data.subarray(d.offset, d.offset + d.size) }})
}

// SerializedFile → 对象表 [{ pathId, start, size, classId }]（v >= 17；Unity 6 = v22）
export function readSerialized(sf) {
  let p = 0
  let metaSize = sf.readUInt32BE(p); p += 4
  let fileSize = sf.readUInt32BE(p); p += 4
  const version = sf.readUInt32BE(p); p += 4
  let dataOffset = sf.readUInt32BE(p); p += 4
  if (version < 17) throw new Error(`SerializedFile v${version} 没做（只做了 17+）`)
  let big = false
  const endian = sf[p]; p += 4   // 字节序 + 3 保留
  if (version >= 22) { metaSize = sf.readUInt32BE(p); p += 4; fileSize = Number(sf.readBigInt64BE(p)); p += 8; dataOffset = Number(sf.readBigInt64BE(p)); p += 8; p += 8 }
  void metaSize; void fileSize; big = endian === 1
  const rd = big
    ? { i32: () => { const v = sf.readInt32BE(p); p += 4; return v }, u32: () => { const v = sf.readUInt32BE(p); p += 4; return v }, i64: () => { const v = Number(sf.readBigInt64BE(p)); p += 8; return v }, i16: () => { const v = sf.readInt16BE(p); p += 2; return v } }
    : { i32: () => { const v = sf.readInt32LE(p); p += 4; return v }, u32: () => { const v = sf.readUInt32LE(p); p += 4; return v }, i64: () => { const v = Number(sf.readBigInt64LE(p)); p += 8; return v }, i16: () => { const v = sf.readInt16LE(p); p += 2; return v } }
  const unity = cstr(sf, p); p = unity.next
  rd.i32()   // target platform
  const hasTree = sf[p++] !== 0
  const typeCount = rd.i32()
  const types = []
  for (let t = 0; t < typeCount; t++) {
    const classId = rd.i32()
    p += 1   // isStripped
    rd.i16()  // scriptTypeIndex
    if (classId === 114) p += 16
    p += 16   // old type hash
    if (hasTree) {
      const nodeCount = rd.i32(); const strSize = rd.i32()
      p += nodeCount * 32 + strSize   // v19+ 的节点 = 32 字节（u16 版本 / u8 层级 / u8 标志 / u32 type 偏移 / u32 name 偏移 / i32 字节数 / i32 序号 / u32 元标志 / u64 ref hash）
      if (version >= 21) { const n = rd.i32(); p += n * 4 }
    }
    types.push(classId)
  }
  const objCount = rd.i32()
  const objects = []
  for (let i = 0; i < objCount; i++) {
    p = align(p, 4)
    const pathId = rd.i64()
    const start = version >= 22 ? rd.i64() : rd.u32()
    const size = rd.u32()
    const typeIdx = rd.i32()
    objects.push({ pathId, start: dataOffset + start, size, classId: types[typeIdx] ?? -1 })
  }
  return objects
}

// bundle（解密后）→ [{ name, text }]（TextAsset）
export function readTextAssets(plain) {
  const out = []
  for (const file of readUnityFS(plain)) {
    if (file.name.endsWith('.resS') || file.name.endsWith('.resource')) continue
    let objects
    try { objects = readSerialized(file.data) } catch { continue }
    for (const o of objects) {
      if (o.classId !== 49) continue
      let q = o.start
      const nameLen = file.data.readUInt32LE(q); q += 4
      const name = file.data.toString('utf8', q, q + nameLen); q = align(q + nameLen, 4)
      const textLen = file.data.readUInt32LE(q); q += 4
      out.push({ name, text: file.data.toString('utf8', q, q + textLen) })
    }
  }
  return out
}
