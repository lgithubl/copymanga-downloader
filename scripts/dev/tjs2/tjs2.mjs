// TJS2 字节码（KiriKiri 编译过的脚本，'TJS2100'）解析器：DATA（字符串 / 数字表）+ OBJS（函数对象 + 代码）。用法：node scripts/dev/tjs2/dis.mjs <文件> [函数名正则]（反汇编；常量按 CONST 追踪、属性名按 vdata 解出来）。立绘位置 / 缩放就是这样对出来的（README「立绘位置」）。
import { readFileSync } from 'node:fs'
export function parseTjs2(b) {
  if (b.toString('latin1', 0, 8) !== 'TJS2100\0') throw new Error('not TJS2')
  let p = 12
  const chunks = {}
  while (p + 8 <= b.length) { const id = b.toString('latin1', p, p + 4); const size = b.readUInt32LE(p + 4); chunks[id] = b.subarray(p + 8, p + size); p += size }
  const d = chunks.DATA; let q = 0
  const rd = () => { const v = d.readUInt32LE(q); q += 4; return v }
  const n8 = rd(); const bytes = []; for (let i = 0; i < n8; i++) bytes.push(d.readInt8(q + i)); q += (n8 + 3) & ~3
  const n16 = rd(); const shorts = []; for (let i = 0; i < n16; i++) shorts.push(d.readInt16LE(q + i * 2)); q += ((n16 * 2 + 3) & ~3)
  const n32 = rd(); const ints = []; for (let i = 0; i < n32; i++) ints.push(d.readInt32LE(q + i * 4)); q += n32 * 4
  const n64 = rd(); const longs = []; for (let i = 0; i < n64; i++) longs.push(Number(d.readBigInt64LE(q + i * 8))); q += n64 * 8
  const nd = rd(); const dbls = []; for (let i = 0; i < nd; i++) dbls.push(d.readDoubleLE(q + i * 8)); q += nd * 8
  const ns = rd(); const strs = []
  for (let i = 0; i < ns; i++) { const len = rd(); strs.push(d.toString('utf16le', q, q + len * 2)); q += (len * 2 + 3) & ~3 }
  const nz = rd(); const octs = []; for (let i = 0; i < nz; i++) { const len = rd(); octs.push(d.subarray(q, q + len)); q += (len + 3) & ~3 }
  // objects
  const o = chunks.OBJS; let r = 0
  const rr = () => { const v = o.readInt32LE(r); r += 4; return v }
  const top = rr(); const count = rr(); const objs = []
  for (let k = 0; k < count; k++) {
    const tag = o.toString('latin1', r, r + 4); r += 4; const size = o.readUInt32LE(r); r += 4
    const end = r + size - 8 + 0
    const ob = { idx: k }
    ob.parent = rr(); ob.name = rr(); ob.contextType = rr(); ob.maxVar = rr(); ob.reserve = rr(); ob.maxFrame = rr(); ob.argc = rr(); ob.unnamedBase = rr(); ob.collapseBase = rr(); ob.setter = rr(); ob.getter = rr(); ob.superGetter = rr()
    const nsrc = rr(); if (nsrc) { r += nsrc * 4 * 2 }
    const csize = rr(); ob.code = []; for (let i = 0; i < csize; i++) ob.code.push(o.readInt16LE(r + i * 2)); r += (csize * 2 + 3) & ~3
    const nv = rr(); ob.vdata = []; for (let i = 0; i < nv; i++) ob.vdata.push([o.readInt16LE(r + i * 4), o.readInt16LE(r + i * 4 + 2)]); r += nv * 4
    const nsd = rr(); ob.srcData = []; for (let i = 0; i < nsd; i++) ob.srcData.push(rr())
    const nprop = rr(); ob.props = []; for (let i = 0; i < nprop; i++) ob.props.push([rr(), rr()])
    ob.tag = tag; ob.endCheck = r - (end - 0)
    objs.push(ob)
  }
  return { strs, dbls, ints, longs, bytes, shorts, objs, chunks }
}
if (process.argv[1].endsWith('tjs2.mjs') && process.argv[2]) {
  const t = parseTjs2(readFileSync(process.argv[2]))
  console.log(t.objs.length, 'objects')
  for (const ob of t.objs.slice(0, 8)) console.log(ob.idx, 'name', t.strs[ob.name], 'parent', ob.parent, 'ctx', ob.contextType, 'argc', ob.argc, 'code', ob.code.length, 'vdata', ob.vdata.length, 'chk', ob.endCheck)
}
