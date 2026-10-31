// BGI / Ethornell（BURIKO ARC20 档案 + DSC 压缩 + CompressedBG 图 + BW 音频 + BurikoCompiledScriptVer1.00 剧本）的解码。
// 依据（都是公开资料；格式本身没有逆向 exe）：
//   · BURIKO ARC20 / DSC FORMAT 1.00 / CompressedBG v1 / BW：morkt/GARbro 的 ArcFormats/Ethornell（ArcBGI.cs、ImageCBG.cs、AudioBGI.cs）的解码流程，这里是 JS 重写；
//   · 剧本容器和 token 机：Cytlan/openbgi 的 docs/scenario.md（BurikoCompiledScriptVer1.00 不是引擎字节码，是游戏自己的 system 程序解释的 32 位 token 流）。
// 外来的二进制：所有长度 / 偏移都对着文件大小校验；解码出的大小有上限。
import { open } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { cbgV2Decode } from './bgi-cbg2.mjs'

export const BURIKO_ARC_MAGIC = 'BURIKO ARC20'
const MAX_ENTRIES = 200000
const MAX_DECODED = 256 * 1024 * 1024
const sjis = new TextDecoder('shift_jis')
const decodeSjis = (buf) => sjis.decode(buf)

// ---------- BURIKO ARC20 ----------
// 12 字节魔数 + u32 条目数；每条 0x80 字节：名字（0x60，Shift-JIS，NUL 结束）+ u32 偏移（相对数据区）+ u32 大小 + 填充；数据区从 16 + 条目数 * 0x80 开始
export async function readBurikoArcIndex(file) {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 16) throw new Error('文件太小，不是 BURIKO ARC20')
    const head = Buffer.alloc(16)
    await handle.read(head, 0, 16, 0)
    if (head.subarray(0, 12).toString('latin1') !== BURIKO_ARC_MAGIC) throw new Error('不是 BURIKO ARC20（魔数不对）')
    const count = head.readUInt32LE(12)
    if (count > MAX_ENTRIES || 16 + count * 0x80 > size) throw new Error(`条目数 ${count} 不合理（文件 ${size} 字节）`)
    const table = Buffer.alloc(count * 0x80)
    let done = 0
    while (done < table.length) {
      const { bytesRead } = await handle.read(table, done, table.length - done, 16 + done)
      if (!bytesRead) throw new Error('目录不完整')
      done += bytesRead
    }
    const dataStart = 16 + count * 0x80
    const entries = []
    for (let i = 0; i < count; i++) {
      const r = i * 0x80
      let end = r
      while (end < r + 0x60 && table[end] !== 0) end++
      const name = decodeSjis(table.subarray(r, end))
      const offset = dataStart + table.readUInt32LE(r + 0x60)
      const entrySize = table.readUInt32LE(r + 0x64)
      if (offset + entrySize > size) throw new Error(`条目 ${name.slice(0, 40)} 的数据（${offset}+${entrySize}）超出文件 ${size} 字节`)
      entries.push({ name, offset, size: entrySize })
    }
    return { size, entries }
  } finally { await handle.close() }
}

// ---------- 条目内容的类型（看开头几个字节）----------
//   dsc：DSC FORMAT 1.00（压缩；剧本 / 动画脚本 / 表）  cbg：CompressedBG（图）  bw：头 0x40 + 'bw  '（Ogg 音频）  ''：不认识
export function sniffEntry(head) {
  if (head.length >= 15 && head.subarray(0, 15).toString('latin1') === 'DSC FORMAT 1.00') return 'dsc'
  if (head.length >= 15 && head.subarray(0, 15).toString('latin1') === 'CompressedBG___') return 'cbg'
  if (head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'bw  ') return 'bw'
  return ''
}

// ---------- DSC FORMAT 1.00 ----------
// 头：魔数 16 字节 + u32 key + u32 解压后大小 + u32 要解的符号数 + 4 字节；后面 512 字节是（用 key 序列加密的）哈夫曼深度表，再后面是 MSB 先出的比特流。
// 符号 < 256 = 字面字节；>= 256 = 回指：长度 = (符号 & 0xff) + 2，距离 = 12 位 + 2
export function dscDecode(data) {
  if (data.length < 0x20 + 512 || sniffEntry(data) !== 'dsc') throw new Error('不是 DSC')
  let key = data.readUInt32LE(0x10)
  const outSize = data.readUInt32LE(0x14)
  const decCount = data.readUInt32LE(0x18)
  if (outSize > MAX_DECODED) throw new Error(`DSC 解压后大小 ${outSize} 不合理`)
  const magic = data.readUInt16LE(0) << 16 >>> 0
  const update = () => {
    const v0 = Math.imul(20021, key & 0xffff) >>> 0
    let v1 = (magic | (key >>> 16)) >>> 0
    v1 = (Math.imul(v1, 20021) + Math.imul(key, 346)) >>> 0
    v1 = (v1 + (v0 >>> 16)) & 0xffff
    key = ((v1 << 16) + (v0 & 0xffff) + 1) >>> 0
    return v1 & 0xff
  }
  let pos = 0x20
  const codes = []
  for (let i = 0; i < 512; i++) {
    const depth = (data[pos++] - update()) & 0xff
    if (depth) codes.push({ depth, code: i })
  }
  codes.sort((a, b) => a.depth - b.depth || a.code - b.code)
  // 哈夫曼树（按深度从浅到深建；和 GARbro 的 CreateHuffmanTree 一致）
  const isParent = new Uint8Array(1023)
  const symbol = new Int32Array(1023)
  const left = new Int32Array(1023)
  const right = new Int32Array(1023)
  const nodesIndex = [new Int32Array(512), new Int32Array(512)]
  let nextNode = 1
  let depthNodes = 1
  let depth = 0
  let child = 0
  let n = 0
  while (n < codes.length) {
    const cur = child
    child ^= 1
    let existed = 0
    while (n < codes.length && codes[n].depth === depth) {
      const at = nodesIndex[cur][existed]
      isParent[at] = 0
      symbol[at] = codes[n++].code
      existed++
    }
    const create = depthNodes - existed
    for (let i = 0; i < create; i++) {
      const at = nodesIndex[cur][existed + i]
      isParent[at] = 1
      nodesIndex[child][i * 2] = left[at] = nextNode++
      nodesIndex[child][i * 2 + 1] = right[at] = nextNode++
    }
    depth++
    depthNodes = create * 2
    if (nextNode > 1023) throw new Error('DSC 哈夫曼表不合法')
  }
  const out = Buffer.alloc(outSize)
  let dst = 0
  let bitPos = pos * 8
  const totalBits = data.length * 8
  const bit = () => {
    if (bitPos >= totalBits) throw new Error('DSC 数据不完整')
    const b = (data[bitPos >> 3] >> (7 - (bitPos & 7))) & 1
    bitPos++
    return b
  }
  for (let k = 0; k < decCount; k++) {
    let node = 0
    do { node = bit() === 0 ? left[node] : right[node] } while (isParent[node])
    const code = symbol[node]
    if (code >= 256) {
      let offset = 0
      for (let i = 0; i < 12; i++) offset = (offset << 1) | bit()
      offset += 2
      const count = (code & 0xff) + 2
      if (offset > dst || dst + count > outSize) throw new Error('DSC 回指越界')
      for (let i = 0; i < count; i++) out[dst + i] = out[dst - offset + i]
      dst += count
    } else {
      if (dst >= outSize) throw new Error('DSC 输出越界')
      out[dst++] = code
    }
  }
  return out
}

// ---------- CompressedBG（version 1；version 2 在 bgi-cbg2.mjs）→ 像素 / PNG ----------
// 头 0x30：魔数 16 + u16 宽 + u16 高 + u32 bpp + 8 字节 + u32 中间长度(0x20) + u32 key(0x24) + u32 加密长度(0x28) + u8 sum + u8 xor + u16 版本；
// 加密段（用 key 序列加密）是 256 个变长整数（哈夫曼权重）；后面是 MSB 先出的比特流 → 中间数据（交替的「字面段 / 零段」长度前缀）→ 像素 → 逆平均预测
export function cbgDecode(data) {
  if (data.length < 0x30 || sniffEntry(data) !== 'cbg') throw new Error('不是 CompressedBG')
  const width = data.readUInt16LE(0x10)
  const height = data.readUInt16LE(0x12)
  const bpp = data.readInt32LE(0x14)
  const interLen = data.readInt32LE(0x20)
  let key = data.readUInt32LE(0x24)
  const encLen = data.readInt32LE(0x28)
  const checkSum = data[0x2c]
  const checkXor = data[0x2d]
  const version = data.readUInt16LE(0x2e)
  if (version === 2) return cbgV2Decode(data, { width, height, bpp, key, encLen, checkSum, checkXor })
  if (version > 2) throw new Error(`CompressedBG version ${version} 暂不支持`)
  if (![8, 24, 32].includes(bpp)) throw new Error(`CompressedBG bpp ${bpp} 暂不支持`)
  if (!width || !height || width * height > 64 * 1024 * 1024) throw new Error('CompressedBG 宽高不合理')
  if (interLen < 0 || interLen > MAX_DECODED || encLen < 0 || 0x30 + encLen > data.length) throw new Error('CompressedBG 头不合理')
  const update = () => {
    const v0 = Math.imul(20021, key & 0xffff) >>> 0
    let v1 = key >>> 16
    v1 = (Math.imul(v1, 20021) + Math.imul(key, 346)) >>> 0
    v1 = (v1 + (v0 >>> 16)) & 0xffff
    key = ((v1 << 16) + (v0 & 0xffff) + 1) >>> 0
    return v1 & 0xff
  }
  const enc = Buffer.alloc(encLen)
  let sum = 0
  let xor = 0
  for (let i = 0; i < encLen; i++) {
    enc[i] = (data[0x30 + i] - update()) & 0xff
    sum = (sum + enc[i]) & 0xff
    xor ^= enc[i]
  }
  if (sum !== checkSum || xor !== checkXor) throw new Error('CompressedBG 校验失败')
  // 权重表：256 个变长整数
  const weights = new Array(256)
  let p = 0
  for (let i = 0; i < 256; i++) {
    let v = 0
    let shift = 0
    let b
    do {
      if (p >= enc.length || shift >= 32) throw new Error('CompressedBG 权重表不完整')
      b = enc[p++]
      v += (b & 0x7f) * 2 ** shift
      shift += 7
    } while (b & 0x80)
    weights[i] = v
  }
  // 哈夫曼树：反复取权重最小的两个合成一个，直到权重和 >= 总权重（GARbro HuffmanTree，v1）
  const nodes = weights.map((w) => ({ valid: w !== 0, weight: w, parent: false, l: -1, r: -1 }))
  const rootWeight = weights.reduce((a, b) => a + b, 0)
  if (!rootWeight) throw new Error('CompressedBG 权重全是 0')
  for (;;) {
    let weight = 0
    const pick = [-1, -1]
    for (let i = 0; i < 2; i++) {
      let min = Infinity
      for (let n = 0; n < nodes.length; n++) if (nodes[n].valid && nodes[n].weight < min) { min = nodes[n].weight; pick[i] = n }
      if (pick[i] === -1) continue
      nodes[pick[i]].valid = false
      weight += nodes[pick[i]].weight
    }
    nodes.push({ valid: true, parent: true, weight, l: pick[0], r: pick[1] })
    if (weight >= rootWeight) break
    if (nodes.length > 1024) throw new Error('CompressedBG 哈夫曼树不合法')
  }
  const root = nodes.length - 1
  // 比特流：从 0x30 + encLen 起，MSB 先出
  const start = 0x30 + encLen
  let bitPos = start * 8
  const totalBits = data.length * 8
  const packed = Buffer.alloc(interLen)
  for (let dst = 0; dst < interLen; dst++) {
    let node = root
    do {
      if (bitPos >= totalBits) throw new Error('CompressedBG 比特流不完整')
      const bit = (data[bitPos >> 3] >> (7 - (bitPos & 7))) & 1
      bitPos++
      node = bit === 0 ? nodes[node].l : nodes[node].r
      if (node < 0) throw new Error('CompressedBG 比特流和树对不上')
    } while (nodes[node].parent)
    packed[dst] = node
  }
  // 零段还原：交替的「字面段 / 零段」，每段前面是变长长度
  const pixel = bpp / 8
  const stride = width * pixel
  const out = Buffer.alloc(stride * height)
  let dst = 0
  let src = 0
  let zero = false
  while (dst < out.length) {
    let count = 0
    let shift = 0
    let code
    do {
      if (src >= packed.length) { dst = out.length; count = -1; break }
      code = packed[src++]
      count += (code & 0x7f) << shift
      shift += 7
    } while (code & 0x80)
    if (count < 0 || dst + count > out.length) break
    if (!zero) {
      if (src + count > packed.length) break
      packed.copy(out, dst, src, src + count)
      src += count
    }
    zero = !zero
    dst += count
  }
  // 逆平均预测
  for (let y = 0; y < height; y++) {
    const line = y * stride
    for (let x = 0; x < width; x++) {
      const px = line + x * pixel
      for (let c = 0; c < pixel; c++) {
        let avg = 0
        if (x > 0) avg += out[px + c - pixel]
        if (y > 0) avg += out[px + c - stride]
        if (x > 0 && y > 0) avg = avg >> 1
        if (avg) out[px + c] = (out[px + c] + avg) & 0xff
      }
    }
  }
  return { width, height, bpp, pixels: out }
}

// ---------- PNG 编码（只做 8 位灰度 / RGB / RGBA，滤波 0）----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, body) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, tail])
}
// channels：1 灰度 / 3 RGB / 4 RGBA；raw = 每行 width * channels 字节，行与行之间没有填充
export function encodePng(width, height, channels, raw, level = 6) {
  const colorType = { 1: 0, 3: 2, 4: 6 }[channels]
  if (colorType === undefined) throw new Error('PNG 通道数只支持 1 / 3 / 4')
  const stride = width * channels
  const rows = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) { rows[y * (stride + 1)] = 0; raw.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level })), chunk('IEND', Buffer.alloc(0))])
}
// CompressedBG 的像素是 BGR(A)：转成 RGB(A) 再编成 PNG
export function cbgToPng(data) {
  const { width, height, bpp, pixels } = cbgDecode(data)
  const channels = bpp / 8
  const raw = Buffer.from(pixels)
  if (channels >= 3) for (let i = 0; i < raw.length; i += channels) { const b = raw[i]; raw[i] = raw[i + 2]; raw[i + 2] = b }
  return encodePng(width, height, channels, raw)
}

// ---------- BW 音频：u32 偏移 + 'bw  ' + ...，从偏移起就是 Ogg ----------
export function bwToOgg(data) {
  if (sniffEntry(data) !== 'bw') throw new Error('不是 BW 音频')
  const offset = data.readUInt32LE(0)
  if (offset >= data.length) throw new Error('BW 偏移越界')
  return data.subarray(offset)
}

// ---------- 剧本（BurikoCompiledScriptVer1.00）----------
// 容器：28 字节魔数 + u32 头大小（从 0x1c 起算）+ 导入数 + 导入名 + 导出数 + (名字, u32 偏移)；token 流从 16 的整数倍起，后面是字符串表（Shift-JIS，NUL 结束）。
// 字符串 / 地址操作数 = 相对 token 流起点的字节偏移。token：带一个 u32 操作数的 = push(0) addr(1) local(2) str(3) load(8) store(9) store2(10) jcc(0x19) args(0x3f)，其余没有操作数。
const SCRIPT_MAGIC = 'BurikoCompiledScriptVer1.00'
const OPERAND_TOKENS = new Set([0x00, 0x01, 0x02, 0x03, 0x08, 0x09, 0x0a, 0x19, 0x3f])
const BINARY = { 0x20: (a, b) => (a + b) | 0, 0x21: (a, b) => (a - b) | 0, 0x22: (a, b) => Math.imul(a, b), 0x23: (a, b) => (b ? Math.trunc(a / b) | 0 : 0), 0x24: (a, b) => (b ? (a % b) | 0 : 0), 0x25: (a, b) => a & b, 0x26: (a, b) => a | b, 0x27: (a, b) => a ^ b, 0x29: (a, b) => a << b, 0x2a: (a, b) => a >>> b, 0x2b: (a, b) => a >> b, 0x30: (a, b) => (a === b ? 1 : 0), 0x31: (a, b) => (a !== b ? 1 : 0), 0x32: (a, b) => (a <= b ? 1 : 0), 0x33: (a, b) => (a >= b ? 1 : 0), 0x34: (a, b) => (a < b ? 1 : 0), 0x35: (a, b) => (a > b ? 1 : 0), 0x38: (a, b) => (a && b ? 1 : 0), 0x39: (a, b) => (a || b ? 1 : 0) }
const MAX_TOKENS = 4_000_000
const IDLE_STEPS = 60_000
// args n：把栈顶 n 个值的顺序倒过来（原地；n 很大时不能用展开 …spread，会爆调用栈）
function reverseTop(stack, n) {
  if (!(n > 1) || n > stack.length) return
  for (let i = stack.length - n, j = stack.length - 1; i < j; i++, j--) { const t = stack[i]; stack[i] = stack[j]; stack[j] = t }
}
const VAR_TOKENS = ['set_lwork', 'lwork', 'set_gwork', 'gwork', 'set_lflag', 'lflag', 'set_gflag', 'gflag', 'lstr', 'set_gflag2', 'gflag2']
const SYS_TOKENS = { 0xec: 'regstr', 0xf0: 'call_scenario', 0xf1: 'jump_alias', 0xf3: 'jump_scenario', 0xf4: 'quit', 0xf5: 'quit_if_idle', 0xf6: 'set_label', 0xf7: 'test_label', 0xf8: 'msgbox_num', 0xf9: 'msgbox', 0xfa: 'debug_dump', 0xfc: 'file_dialog', 0xff: 'debug_pc' }

export function isBurikoScript(buf) { return buf.length > 0x30 && buf.subarray(0, SCRIPT_MAGIC.length).toString('latin1') === SCRIPT_MAGIC }

// 解开容器：{ imports, exports: [{ name, offset }], base（token 流起点，文件偏移）, tokenEnd（token 流的结束 = 最小的字符串偏移）, string(off) }
export function parseBurikoScript(buf) {
  if (!isBurikoScript(buf)) throw new Error('不是 BurikoCompiledScript')
  const headSize = buf.readUInt32LE(0x1c)
  if (headSize > buf.length) throw new Error('剧本头大小不合理')
  let p = 0x20
  const readName = () => { const e = buf.indexOf(0, p); if (e < 0) throw new Error('名字没有结束符'); const s = decodeSjis(buf.subarray(p, e)); p = e + 1; return s }
  const nImports = buf.readUInt32LE(p); p += 4
  if (nImports > 4096) throw new Error('导入数不合理')
  const imports = []
  for (let i = 0; i < nImports; i++) imports.push(readName())
  const nExports = buf.readUInt32LE(p); p += 4
  if (nExports > 65536) throw new Error('导出数不合理')
  const exports = []
  for (let i = 0; i < nExports; i++) { const name = readName(); exports.push({ name, offset: buf.readUInt32LE(p) }); p += 4 }
  const base = (0x1c + headSize + 15) & ~15
  if (base >= buf.length) throw new Error('token 流起点越界')
  const string = (off) => {
    const a = base + off
    if (off < 0 || a >= buf.length) return ''
    const e = buf.indexOf(0, a)
    return decodeSjis(buf.subarray(a, e < 0 ? buf.length : e))
  }
  return { imports, exports, base, string }
}

// 把 token 流读成语句：
//   ['call', 函数名, [参数…]]   callfn：函数名在栈顶（字符串），栈里其余的值（自上一个语句边界起）是参数，从左到右
//   ['cmd', token, [参数…]]     >= 0x100 的游戏命令：参数顺序 = 栈顶在前（msg 的 [text, name, …]）
//   ['jmp', 目标]  ['jcc', 是否非零跳, 目标, 条件值]  ['label'…] 不单独出；目标是 token 偏移
// 值：数字 / 字符串（字符串 token 解出来的）/ { addr: 偏移 } / { local: n }。算术和比较 token（0x20–0x3a）在栈上按值求（两个都是数字时）。
// 返回 { stmts, tokens, truncated }；stmts 里每条带 at（token 偏移）。
export function readBurikoStatements(buf) {
  const info = parseBurikoScript(buf)
  const { base } = info
  // token 流终点：所有 str 操作数里最小的（字符串表从那里开始）。先粗扫一遍。
  const w = (pos) => buf.readUInt32LE(pos)
  let pool = buf.length - base
  for (let pos = base; pos + 8 <= buf.length && pos - base < pool; ) {
    const t = w(pos)
    if (OPERAND_TOKENS.has(t)) { if (t === 0x03) { const a = w(pos + 4); if (a > 0 && a < pool && a >= (pos - base)) pool = Math.min(pool, a) } pos += 8 } else pos += 4
  }
  const end = base + Math.max(0, pool)
  const stmts = []
  let stack = []
  let tokens = 0
  let truncated = false
  const push = (v) => stack.push(v)
  const num = (v) => (typeof v === 'number' ? v : null)
  for (let pos = base; pos + 4 <= end; ) {
    if (++tokens > MAX_TOKENS) { truncated = true; break }
    const at = pos - base
    const t = w(pos)
    const operand = OPERAND_TOKENS.has(t) ? (pos + 8 <= buf.length ? w(pos + 4) : 0) : null
    pos += operand === null ? 4 : 8
    if (t === 0x00) push(operand | 0)
    else if (t === 0x01) push({ addr: operand })
    else if (t === 0x02) push({ local: operand })
    else if (t === 0x03) push(info.string(operand))
    else if (t === 0x3f) reverseTop(stack, operand)
    else if (t === 0x1c) { const name = stack.pop(); stmts.push({ at, op: 'call', name: typeof name === 'string' ? name : '', args: stack }); stack = [] }
    else if (t >= 0x100) { stmts.push({ at, op: 'cmd', token: t, args: stack.slice().reverse() }); stack = [] }
    else if (t === 0x18) { const target = stack.pop(); stmts.push({ at, op: 'jmp', target: target?.addr ?? null }); stack = [] }
    else if (t === 0x19) { const target = stack.pop(); const value = stack.pop(); stmts.push({ at, op: 'jcc', when: operand ? 'nonzero' : 'zero', target: target?.addr ?? null, value: num(value) }); stack = [] }
    else if (t === 0x1a) { const target = stack.pop(); stmts.push({ at, op: 'callsub', target: target?.addr ?? null }); stack = [] }
    else if (t === 0x1b) { stmts.push({ at, op: 'ret' }); stack = [] }
    else if (t === 0xfe || t === 0xfb) stack = []   // lineinfo / 对象名标记：语句边界
    else if (BINARY[t]) { const b = stack.pop(); const a = stack.pop(); const x = num(a); const y = num(b); push(x !== null && y !== null ? BINARY[t](x, y) : null) }
    else if (t === 0x28) { const a = num(stack.pop()); push(a === null ? null : ~a) }
    else if (t === 0x3a) { const a = num(stack.pop()); push(a === null ? null : a ? 0 : 1) }
    // 其余 token（load / store / 0x10 / 0x11 / 0x16 / 0x1d–0x1f / 0xe0–0xff 等）：这一版不解释；store / 变量类按语句边界处理
    else if (t === 0x08 || t === 0x09 || t === 0x0a) { stack.pop(); if (t !== 0x08) stack.pop(); if (t === 0x08) push(null) }
    else if (t >= 0xe0 && t <= 0xea) {
      // 工作变量 / 标志：0xe0 set_lwork 0xe1 lwork 0xe2 set_gwork 0xe3 gwork 0xe4 set_lflag 0xe5 lflag 0xe6 set_gflag 0xe7 gflag 0xe8 lstr 0xe9 set_gflag2 0xea gflag2
      // 读（奇数号 + lstr）：弹 1 个下标、压一个「变量引用」；写：弹 下标 + 值（栈顶是下标），记一条 sys 语句，不清空栈（它可能夹在别的参数里）
      const name = VAR_TOKENS[t - 0xe0]
      if (name.startsWith('set_')) { const index = stack.pop(); const value = stack.pop(); stmts.push({ at, op: 'sys', token: t, name, args: [num(index), value] }) } else { const index = stack.pop(); push({ get: name, index: num(index) }) }
    } else if (t >= 0xec && t <= 0xff) { stmts.push({ at, op: 'sys', token: t, name: SYS_TOKENS[t] || '', args: stack.slice().reverse() }); stack = [] }
  }
  return { ...info, stmts, tokens, truncated, tokenEnd: pool }
}

// ---------- 剧本的执行：按 token 流跑一遍，得到「实际会发生的事」的事件序列 ----------
// 不是完整的 VM：栈 + 局部变量 / 工作变量 / 标志 + 跳转 / 子程序；游戏命令（>= 0x100）和库函数（callfn）不执行，只记成事件。
// 遇到选择（SelectEx）：每个选项各跑一遍（选择结果放在 lwork(0)，和脚本里 lwork(0) == n 的分发对得上），找它们都会经过的第一个地方（汇合点），
// 汇合点之前各分支的事件挂在 choice 事件的 branches 里，汇合点之后只有一份。分支里再遇到选择不再分叉（取第一个选项）——只有汇合点之后的选择会分叉，避免 3^n 爆炸。
// 条件跳转的值如果是未知（读了没设过的东西）按 0 处理。
const SELECT_NAME = /^_?SelectEx?$/
function instrsOf(info, buf) {
  const OPS = OPERAND_TOKENS
  const base = info.base
  let end = info.tokenEnd
  const instrs = []
  const indexOf = new Map()
  // 第一条是 addr X + 0x16：X 是代码之后的数据区起点
  const first = buf.readUInt32LE(base)
  if (first === 0x01 && base + 12 <= buf.length && buf.readUInt32LE(base + 8) === 0x16) end = Math.min(end, buf.readUInt32LE(base + 4))
  for (let pos = base; pos + 4 <= base + end && pos + 4 <= buf.length; ) {
    const t = buf.readUInt32LE(pos)
    const hasOperand = OPS.has(t)
    const a = hasOperand ? (pos + 8 <= buf.length ? buf.readUInt32LE(pos + 4) : 0) : null
    indexOf.set(pos - base, instrs.length)
    instrs.push({ at: pos - base, t, a })
    pos += hasOperand ? 8 : 4
  }
  return { instrs, indexOf }
}
const cloneState = (st) => ({ recent: st.recent.slice(), ip: st.ip, stack: st.stack.slice(), calls: st.calls.slice(), mem: new Map(st.mem), lwork: new Map(st.lwork), flags: new Map(st.flags), picks: new Map(st.picks), labelStrings: st.labelStrings.slice(), steps: st.steps, done: st.done })

export function runBurikoScript(buf, { maxSteps = 2_000_000, maxEvents = 100_000 } = {}) {
  const info = readBurikoStatements(buf)   // 只为了 token 流终点和字符串表
  const { instrs, indexOf } = instrsOf(info, buf)
  const total = { steps: 0, choices: 0, truncated: false, merged: 0, unmerged: 0 }
  const forked = new Set()
  // 跑一个状态，直到：结束 / 步数用完 / 遇到 stopAt / （允许分叉时）遇到选择。返回 { events, st, reason, choice }
  const run = (st, { stopAt = null, fork = true, trace = null } = {}) => {
    const events = []
    let lastCount = 0
    let idle = 0
    const { stack } = st
    const num = (v) => (typeof v === 'number' ? v : null)
    const truthy = (v) => (typeof v === 'number' ? v !== 0 : false)
    while (!st.done) {
      if (st.ip < 0 || st.ip >= instrs.length) { st.done = true; return { events, st, reason: 'end' } }
      const ins = instrs[st.ip]
      if (stopAt !== null && ins.at === stopAt && st.steps > 0) return { events, st, reason: 'stop' }
      if (++total.steps > maxSteps) { total.truncated = true; st.done = true; return { events, st, reason: 'limit' } }
      // 很久没有任何新事件还在转 = 等输入 / 空转的菜单循环：停下（标 truncated）。剧情脚本两次事件之间的指令数远远不到
      if (events.length !== lastCount) { lastCount = events.length; idle = 0 } else if (++idle > IDLE_STEPS) { total.truncated = true; st.done = true; return { events, st, reason: 'idle' } }
      if (events.length > maxEvents) { total.truncated = true; st.done = true; return { events, st, reason: 'events' } }   // 菜单循环之类一直在出事件：到上限就停
      st.steps++
      if (trace) trace.push(ins.at)
      const idx = trace ? trace.length - 1 : -1
      const { t, a } = ins
      let next = st.ip + 1
      const stk = st.stack
      if (t === 0x00) stk.push(a | 0)
      else if (t === 0x01) stk.push({ addr: a })
      else if (t === 0x02) stk.push({ local: a })
      else if (t === 0x03) stk.push(info.string(a))
      else if (t === 0x3f) reverseTop(stk, a)
      else if (t === 0x08) { const addr = stk.pop(); stk.push(addr && typeof addr === 'object' && 'local' in addr ? (st.mem.has(addr.local) ? st.mem.get(addr.local) : null) : null) }
      else if (t === 0x09 || t === 0x0a) { const first = stk.pop(); const second = stk.pop(); const [addr, value] = t === 0x09 ? [second, first] : [first, second]; if (addr && typeof addr === 'object' && 'local' in addr) st.mem.set(addr.local, value); if (typeof value === 'string') st.recent.push(value) }
      else if (t === 0x18) { const target = stk.pop(); next = target && typeof target === 'object' && 'addr' in target && indexOf.has(target.addr) ? indexOf.get(target.addr) : instrs.length; stk.length = 0 }
      else if (t === 0x19) {
        const target = stk.pop()
        const value = stk.pop()
        const jump = a ? truthy(value) : !truthy(value)
        if (jump) next = target && typeof target === 'object' && 'addr' in target && indexOf.has(target.addr) ? indexOf.get(target.addr) : instrs.length
        stk.length = 0
      } else if (t === 0x1a) { const target = stk.pop(); st.calls.push(st.ip + 1); next = target && typeof target === 'object' && 'addr' in target && indexOf.has(target.addr) ? indexOf.get(target.addr) : instrs.length; stk.length = 0 }
      else if (t === 0x1b) { if (st.calls.length) next = st.calls.pop(); else { st.done = true; return { events, st, reason: 'ret' } } }
      else if (t === 0x1c) {
        const name = stk.pop()
        const args = stk.slice()
        stk.length = 0
        const fn = typeof name === 'string' ? name : ''
        if (SELECT_NAME.test(fn)) {
          let count = 0
          while (count < args.length && typeof args[count] === 'string') count++
          let options = args.slice(0, count)
          // _SelectEx(n, …) 的选项文字是先存进栈帧里的数组（store），栈上只有个数：取这个语句之前存过的最后 n 个字符串
          if (!options.length && typeof args[0] === 'number' && args[0] > 1 && st.recent.length >= args[0]) options = st.recent.slice(-args[0])
          if (fork && options.length > 1) {
            if (forked.has(ins.at)) { st.done = true; return { events, st, reason: 'loop' } }   // 选择循环（选过的选项脚本里靠标志挡掉；这里不模拟标志）：同一个选择点不再分叉
            forked.add(ins.at)
            st.ip = next
            return { events, st, reason: 'choice', choice: { at: ins.at, name: fn, options, args } }
          }
          // 分支里再遇到选择点：依次取没取过的选项；都取过了就结束这一路（多半是「选完所有选项才继续」的循环）
          const seen = st.picks.get(ins.at) || 0
          if (seen >= Math.max(1, options.length)) { st.done = true; return { events, st, reason: 'loop' } }
          st.picks.set(ins.at, seen + 1)
          st.lwork.set(0, seen)
          stk.push(seen)
          events.push({ idx, k: 'choice', at: ins.at, name: fn, options, args, branches: null, picked: seen })
        } else events.push({ idx, k: 'call', at: ins.at, name: fn, args })
      } else if (t >= 0x100) { events.push({ idx, k: 'cmd', at: ins.at, token: t, args: stk.slice().reverse() }); stk.length = 0 }
      else if (t === 0xfe || t === 0xfb) { stk.length = 0; st.recent.length = 0 }
      else if (BINARY[t]) { const b = stk.pop(); const x = stk.pop(); const nx = num(x); const nb = num(b); stk.push(nx !== null && nb !== null ? BINARY[t](nx, nb) : null) }
      else if (t === 0x28) { const x = num(stk.pop()); stk.push(x === null ? null : ~x) }
      else if (t === 0x3a) { const x = num(stk.pop()); stk.push(x === null ? null : x ? 0 : 1) }
      else if (t >= 0xe0 && t <= 0xea) {
        const name = VAR_TOKENS[t - 0xe0]
        const index = num(stk.pop())
        if (name.startsWith('set_')) {
          const value = stk.pop()
          if (name === 'set_lwork') st.lwork.set(index, value)
          else if (name === 'set_lflag') st.flags.set(index, value)
          events.push({ idx, k: 'sys', at: ins.at, name, args: [index, value] })
        } else if (name === 'lwork') stk.push(st.lwork.has(index) ? st.lwork.get(index) : 0)
        else if (name === 'lflag') stk.push(st.flags.has(index) ? st.flags.get(index) : 0)
        else stk.push(name === 'lstr' ? '' : 0)
      } else if (t >= 0xec && t <= 0xff) {
        const name = SYS_TOKENS[t] || ''
        const args = stk.slice().reverse()
        stk.length = 0
        // set_label(名字…, 0)：把「要去的脚本 / 标签」记下来；后面的 jump_scenario / call_scenario 自己不带参数，目标就是最近一次 set_label 的字符串（文件名[, 标签名]）
        // test_label(名字)：当前设的标签里有这个名字 = 1（文件开头的标签分发用，正常从头播时一个都不中）
        if (name === 'test_label') stk.push(typeof args[0] === 'string' && st.labelStrings.includes(args[0]) ? 1 : 0)
        else if (name === 'set_label') st.labelStrings = args.filter((v) => typeof v === 'string')
        else events.push({ idx, k: 'sys', at: ins.at, name, args: (name === 'jump_scenario' || name === 'call_scenario') && !args.some((v) => typeof v === 'string') ? st.labelStrings.slice() : args })
        if (name === 'jump_scenario' || name === 'quit' || name === 'jump_alias') { st.done = true; return { events, st, reason: name } }
      }
      st.ip = next
    }
    return { events, st, reason: 'done' }
  }
  // 汇合点：先去掉各分支一开始相同的那一段（选择之后、真正分开之前的分发代码），再在剩下的部分里找第一个「每个分支都经过」的地方
  const divergence = (traces) => { const n = Math.min(...traces.map((t) => t.length)); let d = 0; while (d < n && traces.every((t) => t[d] === traces[0][d])) d++; return d }
  const mergeAt = (traces, d) => {
    const sets = traces.slice(1).map((tr) => new Set(tr.slice(d)))
    const seen = new Set()
    for (const at of traces[0].slice(d)) {
      if (seen.has(at)) continue
      seen.add(at)
      if (sets.every((set) => set.has(at))) return at
    }
    return null
  }
  const top = []
  let st = { recent: [], ip: 0, stack: [], calls: [], mem: new Map(), lwork: new Map(), flags: new Map(), picks: new Map(), labelStrings: [], steps: 0, done: false }
  for (let guard = 0; guard < 200; guard++) {
    const r = run(st)
    for (const e of r.events) top.push(e)   // 事件可能有几十万个：不能用 push(...) 展开（会爆调用栈）
    if (r.reason !== 'choice') break
    const { choice } = r
    total.choices++
    // 每个选项各跑到结束（分支内不再分叉），记执行轨迹，找汇合点
    const runs = choice.options.map((_, n) => {
      const s2 = cloneState(r.st)
      s2.lwork.set(0, n)
      s2.stack.push(n)
      const trace = []
      const out = run(s2, { fork: false, trace })
      return { n, trace, out }
    })
    const d = divergence(runs.map((x) => x.trace))
    const merge = mergeAt(runs.map((x) => x.trace), d)
    let after = null
    let common = []
    const branches = runs.map((x) => {
      const s2 = cloneState(r.st)
      s2.lwork.set(0, x.n)
      s2.stack.push(x.n)
      const out = run(s2, { fork: false, stopAt: merge, trace: [] })
      if (x.n === 0) { after = out; common = out.events.filter((e) => e.idx < d) }
      return out.events.filter((e) => e.idx >= d)
    })
    for (const e of common) top.push(e)
    top.push({ k: 'choice', at: choice.at, name: choice.name, options: choice.options, args: choice.args, branches, merge })
    if (merge === null || !after || after.reason !== 'stop') { total.unmerged++; break }
    total.merged++
    st = after.st
  }
  return { ...info, events: top, ...total }
}
