// 合成的 Hxv4 加密 XP3（自测用）：files = [[目录, 名字, 明文 Buffer]…]（目录 '/' = 根）；bundle = 密钥包（hex）。
// 条目 id 从 1 开始，第 2 个条目用 zlib 段，open 标志按奇偶交替；返回 XP3 的 Buffer。
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { Hxv4Filter, adler32, applyState, nameHash, pathHash, xchacha20poly1305Seal } from '../../web/library/gal/krkr-hxv4.mjs'

export const makeBundle = (seed = 'fixture') => ({
  params: Buffer.from([2, 0, 6, 5, 1, 4, 3, 7, 1, 5, 3, 2, 0, 4, 1, 0, 2, 1, 0xe2, 0x02, 0x83, 0x02]).toString('hex'),
  material: createHash('sha512').update(`${seed}-material`).digest().toString('hex'),
  key: createHash('sha256').update(`${seed}-key`).digest().toString('hex'),
  nonce0: createHash('sha256').update(`${seed}-n0`).digest().subarray(0, 24).toString('hex'),
  nonce1: createHash('sha256').update(`${seed}-n1`).digest().subarray(0, 24).toString('hex'),
})

export function buildHxv4Xp3(files, bundle) {
  const filter = Hxv4Filter.fromBundle(bundle)
  const fakeName = (id) => { const w = []; let v = BigInt(id); do { w.push(0x5000 + Number(v & 0x3fffn)); v >>= 14n } while (v > 0n); return Buffer.from(String.fromCharCode(...w), 'utf16le') }
  // 先排数据：[魔数 11][索引指针 8] 之后是各条目的（zlib 或原样）段，再是特殊索引，再是索引块
  const chunks = []
  let cursor = 19
  const records = []
  const fileChunks = []
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
  const chunk = (tag, body) => Buffer.concat([Buffer.from(tag, 'latin1'), u64(body.length), body])
  files.forEach(([dir, name, plain], i) => {
    const id = i + 1
    const entryKey = BigInt.asUintN(64, 0x1234567890abcdefn + BigInt(i) * 0x1111111111n)
    const flag = i % 2
    const enc = Buffer.from(plain)
    applyState(filter.stateFor(entryKey, flag), 0, enc)
    const compress = i === 1
    const stored = compress ? deflateSync(enc) : enc
    const offset = cursor
    chunks.push(stored)
    cursor += stored.length
    const nm = fakeName(id)
    const info = Buffer.concat([u32(0), u64(plain.length), u64(stored.length), Buffer.from([nm.length / 2 & 0xff, 0]), nm])
    const segm = Buffer.concat([u32(compress ? 1 : 0), u64(offset), u64(plain.length), u64(stored.length)])
    fileChunks.push(chunk('File', Buffer.concat([chunk('info', info), chunk('segm', segm), chunk('adlr', u32(adler32(plain)))])))
    records.push({ dir, name, id, entryKey, flag })
  })
  // 特殊索引：[路径哈希(8)、[名字哈希(32)、[打包定位, entry_key]]…]… 的序列化
  const be32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }
  const hxBytes = (b) => Buffer.concat([Buffer.from([3]), be32(b.length), b])
  const hxInt = (v) => { const b = Buffer.alloc(9); b[0] = 4; b.writeBigInt64BE(BigInt.asIntN(64, v), 1); return b }
  const hxArr = (items) => Buffer.concat([Buffer.from([0x81]), be32(items.length), ...items])
  const byDir = new Map()
  for (const r of records) { if (!byDir.has(r.dir)) byDir.set(r.dir, []); byDir.get(r.dir).push(r) }
  const rootItems = []
  for (const [dir, rs] of byDir) {
    rootItems.push(hxBytes(pathHash(dir)))
    rootItems.push(hxArr(rs.flatMap((r) => [hxBytes(nameHash(r.name)), hxArr([hxInt((BigInt(r.flag) << 32n) | BigInt(r.id)), hxInt(r.entryKey)])])))
  }
  const serialized = hxArr(rootItems)
  const compressed = deflateSync(serialized)
  const plainSpecial = Buffer.concat([u32(serialized.length), compressed])
  const sealed = xchacha20poly1305Seal(Buffer.from(bundle.key, 'hex'), Buffer.from(bundle.nonce0, 'hex'), plainSpecial)
  const blob = Buffer.concat([sealed.subarray(sealed.length - 16), sealed.subarray(0, sealed.length - 16)])   // 标签在前
  const specialOffset = cursor
  chunks.push(blob)
  cursor += blob.length
  const hxDesc = chunk('Hxv4', Buffer.concat([u64(specialOffset), u32(blob.length), Buffer.from([0, 0])]))
  const indexRaw = Buffer.concat([hxDesc, ...fileChunks])
  const indexOffset = cursor
  const indexBlock = Buffer.concat([Buffer.from([1]), u64(deflateSync(indexRaw).length), u64(indexRaw.length), deflateSync(indexRaw)])
  const xp3 = Buffer.concat([Buffer.from([0x58, 0x50, 0x33, 0x0d, 0x0a, 0x20, 0x0a, 0x1a, 0x8b, 0x67, 0x01]), u64(indexOffset), ...chunks, indexBlock])
  return xp3
}

// 合成的 PSB（v3，自测用）：root = 普通 JS 值（对象 / 数组 / 数字 / 字符串 / null / 布尔）。名字表用「退化的双数组 trie」：每个名字一条互不相交的链，解析器按通用的 base / check / 叶子数组读得出来。
export function buildPsb(root) {
  const names = []
  const strings = []
  const nameIndex = (n) => { let i = names.indexOf(n); if (i < 0) { i = names.length; names.push(n) } return i }
  const stringIndex = (s) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s) } return i }
  const uintBytes = (v) => (v < 0x100 ? 1 : v < 0x10000 ? 2 : v < 0x1000000 ? 3 : 4)
  const le = (v, n) => { const b = Buffer.alloc(n); b.writeUIntLE(v, 0, n); return b }
  const uintArray = (list) => { const es = Math.max(1, ...list.map(uintBytes)); const cn = uintBytes(list.length); return Buffer.concat([Buffer.from([0x0c + cn]), le(list.length, cn), Buffer.from([0x0c + es]), ...list.map((v) => le(v, es))]) }
  const value = (v) => {
    if (v === null || v === undefined) return Buffer.from([1])
    if (v === false) return Buffer.from([2])
    if (v === true) return Buffer.from([3])
    if (typeof v === 'number') {
      if (v === 0) return Buffer.from([4])
      let n = 1
      while (n < 8 && (v < -(2 ** (8 * n - 1)) || v >= 2 ** (8 * n - 1))) n++
      const b = Buffer.alloc(n); b.writeIntLE(v, 0, Math.min(n, 6)); return Buffer.concat([Buffer.from([4 + n]), b])
    }
    if (typeof v === 'string') { const i = stringIndex(v); const n = uintBytes(i); return Buffer.concat([Buffer.from([0x14 + n]), le(i, n)]) }
    if (Array.isArray(v)) { const items = v.map(value); let off = 0; const offs = items.map((b) => { const o = off; off += b.length; return o }); return Buffer.concat([Buffer.from([0x20]), uintArray(offs), ...items]) }
    const keys = Object.keys(v)
    const idx = keys.map(nameIndex)
    const order = idx.map((_, i) => i).sort((x, y) => idx[x] - idx[y])
    const items = order.map((i) => value(v[keys[i]]))
    let off = 0
    const offs = items.map((b) => { const o = off; off += b.length; return o })
    return Buffer.concat([Buffer.from([0x21]), uintArray(order.map((i) => idx[i])), uintArray(offs), ...items])
  }
  const entries = value(root)
  // 名字表（真·trie：同前缀共用节点；每个内部节点的 base 取 512 的整数倍，子节点 = base + 字节，互不相交）
  const base = []
  const check = []
  const leaves = []
  const ensure = (i) => { while (base.length <= i) { base.push(0); check.push(0) } }
  const prefixNode = new Map([['', 0]])
  let baseCounter = 1
  names.forEach((name) => {
    const bytes = [...Buffer.from(name, 'utf8'), 0]
    let parent = 0
    let prefix = ''
    for (const byte of bytes) {
      prefix += String.fromCharCode(byte) + '|'
      ensure(parent)
      if (!base[parent]) base[parent] = 512 * baseCounter++
      let node = prefixNode.get(prefix)
      if (node === undefined) { node = base[parent] + byte; prefixNode.set(prefix, node); ensure(node); check[node] = parent }
      parent = node
    }
    leaves.push(parent)
  })
  ensure(0)
  const namesBlock = Buffer.concat([uintArray(base), uintArray(check), uintArray(leaves)])
  const strOffs = []
  const strData = []
  let so = 0
  for (const s of strings) { strOffs.push(so); const b = Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]); strData.push(b); so += b.length }
  const stringsBlock = uintArray(strOffs)
  const dataBlock = Buffer.concat(strData)
  const header = Buffer.alloc(44)
  header.write('PSB\0', 0, 'latin1'); header.writeUInt16LE(3, 4); header.writeUInt16LE(0, 6); header.writeUInt32LE(44, 8)
  const oNames = 44
  const oStrings = oNames + namesBlock.length
  const oStringData = oStrings + stringsBlock.length
  const oEntries = oStringData + dataBlock.length
  header.writeUInt32LE(oNames, 12); header.writeUInt32LE(oStrings, 16); header.writeUInt32LE(oStringData, 20); header.writeUInt32LE(oEntries, 36)
  return Buffer.concat([header, namesBlock, stringsBlock, dataBlock, entries])
}
