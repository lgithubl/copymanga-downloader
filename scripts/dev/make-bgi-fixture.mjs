// BGI（BURIKO ARC20 / DSC / CompressedBG / BW / BurikoCompiledScriptVer1.00）的合成样本：只有测试用的编码器，没有任何游戏内容。
//   buildArc20(entries)          [{ name, data }] → BURIKO ARC20 档案
//   dscEncode(buf, { key })      DSC FORMAT 1.00：255 个 8 位字面码 + 255 / 256 两个 9 位码（256 = 长度 2 的回指，重复的两个字节用回指编）
//   cbgEncode({ width, height, bpp, pixels })  CompressedBG version 1（平均预测 + 零段 + 哈夫曼，和解码器同一套建树）
//   bwWrap(ogg)                  头 0x40 + 'bw  ' + Ogg
//   BgiScript                    token 流汇编器：push / str / args / call / msg / select / label / jmp / jcc …
import { buildTree, FILL_ORDER } from '../../web/library/gal/bgi-cbg2.mjs'
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

// ---------- ARC20 ----------
export function buildArc20(entries) {
  const table = Buffer.alloc(entries.length * 0x80)
  let offset = 0
  const datas = []
  entries.forEach((e, i) => {
    table.write(e.name, i * 0x80, 'latin1')
    table.writeUInt32LE(offset, i * 0x80 + 0x60)
    table.writeUInt32LE(e.data.length, i * 0x80 + 0x64)
    offset += e.data.length
    datas.push(e.data)
  })
  return Buffer.concat([Buffer.from('BURIKO ARC20', 'latin1'), u32(entries.length), table, ...datas])
}

// ---------- DSC ----------
const keyStream = (key, magic) => () => {
  const v0 = Math.imul(20021, key & 0xffff) >>> 0
  let v1 = (magic | (key >>> 16)) >>> 0
  v1 = (Math.imul(v1, 20021) + Math.imul(key, 346)) >>> 0
  v1 = (v1 + (v0 >>> 16)) & 0xffff
  key = ((v1 << 16) + (v0 & 0xffff) + 1) >>> 0
  return v1 & 0xff
}
export function dscEncode(buf, { key = 0x12345678, useBackrefs = true } = {}) {
  const magic = (0x44 | (0x53 << 8)) << 16 >>> 0   // 'D' 'S'（头两个字节 u16 LE）
  const bits = []
  const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1) }
  let count = 0
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    if (useBackrefs && i >= 2 && i + 1 < buf.length && buf[i] === buf[i - 2] && buf[i + 1] === buf[i - 1]) {   // 长度 2 的回指：距离 = i - (i - 2) = 2 → 存 距离 - 2 = 0
      put(511, 9); put(0, 12); i++; count++; continue
    }
    if (v < 255) put(v, 8); else put(510, 9)
    count++
  }
  while (bits.length % 8) bits.push(0)
  const stream = Buffer.alloc(bits.length / 8)
  for (let i = 0; i < bits.length; i++) stream[i >> 3] |= bits[i] << (7 - (i & 7))
  const next = keyStream(key, magic)
  const table = Buffer.alloc(512)
  for (let i = 0; i < 512; i++) { const depth = i < 255 ? 8 : i < 257 ? 9 : 0; table[i] = (depth + next()) & 0xff }
  const head = Buffer.alloc(0x20)
  head.write('DSC FORMAT 1.00', 0, 'latin1')
  head.writeUInt32LE(key >>> 0, 0x10); head.writeUInt32LE(buf.length, 0x14); head.writeUInt32LE(count, 0x18)
  return Buffer.concat([head, table, stream])
}

// ---------- CompressedBG v1 ----------
export function cbgEncode({ width, height, bpp, pixels, key = 0x0badf00d }) {
  const pixel = bpp / 8
  const stride = width * pixel
  // 平均预测：残差 = 原值 - avg(左, 上)
  const res = Buffer.alloc(pixels.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < pixel; c++) {
    const p = y * stride + x * pixel + c
    let avg = 0
    if (x > 0) avg += pixels[p - pixel]
    if (y > 0) avg += pixels[p - stride]
    if (x > 0 && y > 0) avg >>= 1
    res[p] = (pixels[p] - avg) & 0xff
  }
  // 零段：交替的「字面段（非零 + 夹着的单个零不拆）/ 零段」，每段前面是变长长度；第一段是字面段
  const packed = []
  const varint = (n) => { while (n >= 0x80) { packed.push((n & 0x7f) | 0x80); n >>>= 7 } packed.push(n) }
  let i = 0
  let zero = false
  while (i < res.length) {
    let j = i
    while (j < res.length && (res[j] === 0) === zero) j++
    varint(j - i)
    if (!zero) for (let k = i; k < j; k++) packed.push(res[k])
    zero = !zero
    i = j
  }
  const packedBuf = Buffer.from(packed)
  const weights = new Array(256).fill(0)
  for (const b of packedBuf) weights[b]++
  if (weights.filter(Boolean).length < 2) throw new Error('cbgEncode：中间数据至少要有两种字节')
  // 和解码器同一套建树，得到每个叶子的码
  const nodes = weights.map((w) => ({ valid: w !== 0, weight: w, parent: false, l: -1, r: -1 }))
  const rootWeight = weights.reduce((a, b) => a + b, 0)
  for (;;) {
    let weight = 0
    const pick = [-1, -1]
    for (let k = 0; k < 2; k++) {
      let min = Infinity
      for (let n = 0; n < nodes.length; n++) if (nodes[n].valid && nodes[n].weight < min) { min = nodes[n].weight; pick[k] = n }
      if (pick[k] === -1) continue
      nodes[pick[k]].valid = false
      weight += nodes[pick[k]].weight
    }
    nodes.push({ valid: true, parent: true, weight, l: pick[0], r: pick[1] })
    if (weight >= rootWeight) break
  }
  const codes = new Map()
  const walk = (n, prefix) => { if (!nodes[n].parent) { codes.set(n, prefix); return } walk(nodes[n].l, [...prefix, 0]); walk(nodes[n].r, [...prefix, 1]) }
  walk(nodes.length - 1, [])
  const bits = []
  for (const b of packedBuf) bits.push(...codes.get(b))
  while (bits.length % 8) bits.push(0)
  const stream = Buffer.alloc(bits.length / 8)
  for (let k = 0; k < bits.length; k++) stream[k >> 3] |= bits[k] << (7 - (k & 7))
  // 权重表：变长整数，用 key 序列加密；sum / xor 是明文的
  const plain = []
  for (const w of weights) { let n = w; while (n >= 0x80) { plain.push((n & 0x7f) | 0x80); n >>>= 7 } plain.push(n) }
  const next = keyStream(key, 0)
  const enc = Buffer.from(plain.map((b) => (b + next()) & 0xff))
  let sum = 0
  let xor = 0
  for (const b of plain) { sum = (sum + b) & 0xff; xor ^= b }
  const head = Buffer.alloc(0x30)
  head.write('CompressedBG___', 0, 'latin1')
  head.writeUInt16LE(width, 0x10); head.writeUInt16LE(height, 0x12); head.writeInt32LE(bpp, 0x14)
  head.writeInt32LE(packedBuf.length, 0x20); head.writeUInt32LE(key >>> 0, 0x24); head.writeInt32LE(enc.length, 0x28)
  head[0x2c] = sum; head[0x2d] = xor; head.writeUInt16LE(1, 0x2e)
  return Buffer.concat([head, enc, stream])
}

// ---------- CompressedBG v2 ----------
// 输入的是量化后的系数（不做正向 DCT）：rows[blockRow] = Int16Array（通道 × 块 × 64，通道内按块排；每块第 0 个 = DC 绝对值，其余是自然顺序的 AC）；
// quant = 128 字节量化表；alpha = 可选，每个像素 1 字节（宽高按 8 对齐后的尺寸）。和解码器共用建树 / 顺序表，比特流部分是独立写的。
export function cbgV2Encode({ width, height, bpp, rows, quant, alpha = null, key = 0x0badf00d }) {
  const W = (width + 7) & -8
  const channels = bpp === 8 ? 1 : 3
  const bitLen = (n) => { let c = 0; while (n) { c++; n >>>= 1 } return c }
  // 每个 8 行块 → { dcTokens, … } 先收集符号再建树
  const symbols1 = new Array(16).fill(0)
  const symbols2 = new Array(0xb0).fill(0)
  const plan = rows.map((coefs) => {
    const dc = []
    let acc = 0
    for (let k = 0; k < coefs.length; k += 64) {
      const diff = coefs[k] - acc
      acc = coefs[k]
      const size = bitLen(Math.abs(diff))
      symbols1[size]++
      dc.push({ size, value: diff > 0 ? diff : diff + (1 << size) - 1 })
    }
    const ac = []
    for (let k = 0; k < coefs.length; k += 64) {
      const list = []
      let index = 1
      for (let q = 1; q < 64; q++) {
        const v = coefs[k + FILL_ORDER[q]]
        if (!v) continue
        let gap = q - index
        while (gap >= 16) { list.push({ code: 0xf }); symbols2[0xf]++; gap -= 16 }
        const size = bitLen(Math.abs(v))
        const code = (size << 4) | gap   // 低 4 位 = 前面的 0 个数，高 4 位 = 位数（最多 10：0xAF）
        list.push({ code, size, value: v > 0 ? v : v + (1 << size) - 1 })
        symbols2[code]++
        index = q + 1
      }
      if (index <= 63) { list.push({ code: 0 }); symbols2[0]++ }
      ac.push(list)
    }
    return { dc, ac, size: coefs.length }
  })
  if (!symbols2.some(Boolean)) symbols2[0] = 1   // 没有 AC：树不能是空的
  const codesOf = (weights) => {
    const nodes = buildTree(weights, true)
    const codes = new Map()
    const walk = (n, prefix) => { if (n < 0) return; if (!nodes[n].parent) { codes.set(n, prefix); return } walk(nodes[n].l, [...prefix, 0]); walk(nodes[n].r, [...prefix, 1]) }
    walk(nodes.length - 1, [])
    return codes
  }
  const codes1 = codesOf(symbols1)
  const codes2 = codesOf(symbols2)
  const varint = (n) => { const out = []; while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7 } out.push(n); return out }
  const padSkip = ((W >> 3) + 7) >> 3
  const blocks = plan.map((row) => {
    const bits = []
    const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1) }
    for (const d of row.dc) { bits.push(...codes1.get(d.size)); if (d.size) put(d.value, d.size) }
    while (bits.length % 8) bits.push(0)
    for (const list of row.ac) for (const t of list) { bits.push(...codes2.get(t.code)); if (t.size) put(t.value, t.size) }
    while (bits.length % 8) bits.push(0)
    const stream = Buffer.alloc(bits.length / 8 + 1)   // 多留 1 个字节：解码器在「字节读完」时就停（GARbro 的行为）
    for (let i = 0; i < bits.length; i++) stream[i >> 3] |= bits[i] << (7 - (i & 7))
    return Buffer.concat([Buffer.alloc(padSkip), Buffer.from(varint(row.size)), stream])
  })
  const treeBytes = Buffer.from([...symbols1.flatMap(varint), ...symbols2.flatMap(varint)])
  const base = treeBytes.length + (rows.length + 1) * 4
  let alphaBuf = Buffer.alloc(0)
  if (alpha) {
    const parts = [u32(1)]
    const items = []
    for (let i = 0; i < alpha.length;) {   // 和前一个像素相同的一串（≥ 3）用回指（x = -1, y = 0），其余按字面
      let run = 0
      while (i > 0 && i + run < alpha.length && alpha[i + run] === alpha[i - 1] && run < 130) run++
      if (run >= 3) { items.push({ ref: run }); i += run } else { items.push({ lit: alpha[i] }); i++ }
    }
    const out = []
    let pending = []
    const flush = () => {
      if (!pending.length) return
      let c = 0
      pending.forEach((p, k) => { if (p.ref) c |= 1 << k })
      out.push(Buffer.from([c]))
      for (const p of pending) { if (p.ref) { const b = Buffer.alloc(2); b.writeUInt16LE(0x3f | ((p.ref - 3) << 9)); out.push(b) } else out.push(Buffer.from([p.lit])) }
      pending = []
    }
    for (const it of items) { pending.push(it); if (pending.length === 8) flush() }
    flush()
    alphaBuf = Buffer.concat([...parts, ...out])
  }
  const offsets = []
  let at = base
  for (const b of blocks) { offsets.push(at); at += b.length }
  offsets.push(at)
  const offsetBuf = Buffer.concat(offsets.map(u32))
  const body = Buffer.concat([treeBytes, offsetBuf, ...blocks, alphaBuf])
  // 加密段：量化表
  const plain = Buffer.from(quant)
  const next = keyStream(key, 0)
  const enc = Buffer.from(plain.map((b) => (b + next()) & 0xff))
  let sum = 0
  let xor = 0
  for (const b of plain) { sum = (sum + b) & 0xff; xor ^= b }
  const head = Buffer.alloc(0x30)
  head.write('CompressedBG___', 0, 'latin1')
  head.writeUInt16LE(width, 0x10); head.writeUInt16LE(height, 0x12); head.writeInt32LE(bpp, 0x14)
  head.writeUInt32LE(key >>> 0, 0x24); head.writeInt32LE(enc.length, 0x28)
  head[0x2c] = sum; head[0x2d] = xor; head.writeUInt16LE(2, 0x2e)
  return Buffer.concat([head, enc, body])
}

// ---------- BW ----------
export function bwWrap(ogg) {
  const head = Buffer.alloc(0x40)
  head.writeUInt32LE(0x40, 0)
  head.write('bw  ', 4, 'latin1')
  return Buffer.concat([head, ogg])
}

// ---------- 剧本汇编器 ----------
// 用法：const s = new BgiScript(); s.call('_PlayBGM', 0, 'bgm01', 0, 1, 100, 0); s.msg('text', 'name'); … ; s.build()
// 参数：number = push，string = str；token 流起点 = 头之后补齐到 16；字符串表紧跟在 token 流后面（按第一次出现的顺序）。
export class BgiScript {
  constructor({ imports = ['framework._bs'] } = {}) { this.imports = imports; this.t = []; this.labels = new Map() }
  op(token, operand) { this.t.push(operand === undefined ? [token] : [token, operand]); return this }
  // 字符串：JS 字符串按 latin1 写进字符串表；要写 Shift-JIS 的字节就传 Buffer（原样写）
  push(v) { return Buffer.isBuffer(v) ? this.op(3, { str: v.toString('latin1') }) : typeof v === 'string' ? this.op(3, { str: v }) : this.op(0, v) }
  label(name) { this.labels.set(name, this.t.length); this.t.push(['label', name]); return this }
  addr(name) { return this.op(1, { label: name }) }
  jmp(name) { return this.addr(name).op(0x18) }
  jcc(name, whenNonZero = 0) { return this.addr(name).op(0x19, whenNonZero) }   // 栈：值 → 弹出（值，目标）
  call(name, ...args) { for (const a of args) this.push(a); return this.op(3, { str: name }).op(0x1c) }
  // msg：直接形式，参数从左到右压栈，最后是文本（栈顶）：1, 1, 0, 说话人, 文本
  msg(text, name = '') { return this.push(1).push(1).push(0).push(name).push(text).op(0x140) }
  select(...options) { for (const o of options) this.push(o); this.push(1).push(1).push(1); return this.op(3, { str: 'SelectEx' }).op(0x1c) }
  // 选择之后的分发：lwork(0) == k → 跳到 labels[k]（不相等就看下一个）
  dispatch(labels) { labels.forEach((l, k) => { const next = `__d${this.t.length}_${k}`; this.push(0).op(0x3f, 1).op(0xe1).push(k).op(0x30).addr(next).op(0x19, 0).jmp(l).label(next) }); return this }
  setLwork(i, v) { return this.push(i).push(v).op(0x3f, 2).op(0xe0) }   // set_lwork(下标, 值)：第一个参数在栈顶（先压下标再压值，args 2 把顺序倒过来）
  jumpScenario(file) { return this.push(file).op(0x3f, 1).op(0xf3) }
  build() {
    // 指令 → 字：先排版算偏移
    const words = []
    const at = new Map()
    for (const item of this.t) {
      if (item[0] === 'label') { at.set(item[1], words.length * 4); continue }
      words.push(item)
      if (item.length === 2) words.push(null)
    }
    // 字符串表：按第一次出现的顺序
    const stringAt = new Map()
    const strings = []
    let pool = 0
    const codeLen = words.length * 4
    for (const item of this.t) if (item[1] && item[1].str !== undefined && !stringAt.has(item[1].str)) { stringAt.set(item[1].str, codeLen + pool); const b = Buffer.from(`${item[1].str}\0`, 'latin1'); strings.push(b); pool += b.length }
    const out = []
    for (let i = 0; i < words.length; i++) {
      const item = words[i]
      if (item === null) continue
      out.push(u32(item[0]))
      if (item.length === 2) {
        const operand = item[1]
        out.push(u32(operand && typeof operand === 'object' ? (operand.label !== undefined ? at.get(operand.label) : stringAt.get(operand.str)) : operand))
      }
    }
    const names = Buffer.concat(this.imports.map((n) => Buffer.from(`${n}\0`, 'latin1')))
    const head = Buffer.concat([u32(this.imports.length), names, u32(0)])   // 导入数 + 名字 + 导出数 0
    const headSize = 4 + head.length   // 从 0x1c 起算：自己（4）+ 内容
    let prefix = Buffer.concat([Buffer.from('BurikoCompiledScriptVer1.00\0', 'latin1'), u32(headSize), head])
    while (prefix.length % 16) prefix = Buffer.concat([prefix, Buffer.alloc(1)])
    return Buffer.concat([prefix, ...out, ...strings])
  }
}
