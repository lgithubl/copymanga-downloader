// PSB（KiriKiri / E-mote 的二进制树，魔数 "PSB\0"）读取：只读，转成普通 JS 值（对象 / 数组 / 数字 / 字符串 / null）。
// 版本 2~4 的头：u16 版本 + u16 加密标志，后面是 u32 头长、名字表偏移、字符串表偏移、字符串数据偏移、资源块偏移 / 长度 / 数据偏移、根偏移。
// 名字存成「双数组 trie」：三个无符号整数数组 a（base）、b（check）、c（每个名字的叶子节点）；叶子 idx 往上走 par = b[idx]，字符 = idx - a[par]，直到根（0），反过来就是名字（末尾有一个 0 终止符）。
// 类型：0 null、1 null、2 false、3 true、4 = 0、5~12 = 1~8 字节有符号整数、13~20 = 无符号整数数组、21~24 = 字符串引用、25~28 = 资源引用、29 = 0.0、30 = f32、31 = f64、32 = 数组、33 = 对象。
// 在 g08 / g09 的 scn.xp3 解出来的 PSB（全部约 520 个）上读通；不处理加密过的 PSB（头里加密标志 ≠ 0）和资源块内容（只返回引用）。
const MAX_DEPTH = 64

// E-mote 的头加密（emotedriver.dll 的 StructCryptFilter，逆向自「妹(姉)は兄(弟)の性癖を歪ませたい！」的 emotedriver.dll）：
// 头里加密标志 = 1 时，魔数 + 版本 + 标志 之后 headerLength - 8 字节（v4 = 48 字节）与 xorshift128 密钥流异或；
// xorshift128：x = 123456789、y = 362436069、z = 521288629、w = 种子（十进制字符串经 strtol，这个游戏 = "49327924"）；每 4 字节取一个 w（低字节在前）。
// 头长度（第一个 u32）自己也是加密的：先解 4 字节读出来，再接着解剩下的。种子是每个游戏自己的（在 emotedriver.dll 里），用 options.seed 传。
export const EMOTE_SEED_YUGAMASE = 49327924
export function xorshiftKeystream(seed) {
  let x = 123456789 >>> 0
  let y = 362436069 >>> 0
  let z = 521288629 >>> 0
  let w = seed >>> 0
  let buf = 0
  let left = 0
  return () => {
    if (!left) { const t = (x ^ (x << 11)) >>> 0; x = y; y = z; z = w; w = ((w ^ (w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0; buf = w; left = 4 }
    const b = buf & 255
    buf >>>= 8
    left -= 1
    return b
  }
}
export function decryptPsbHeader(buf, seed) {
  const out = Buffer.from(buf)
  const next = xorshiftKeystream(seed)
  for (let i = 8; i < 12; i++) out[i] ^= next()
  const headerLength = out.readUInt32LE(8)
  if (headerLength < 44 || headerLength > 4096 || headerLength > out.length) throw new Error(`PSB 头解密后头长度 ${headerLength} 不合理（密钥种子不对？）`)
  for (let i = 12; i < headerLength; i++) out[i] ^= next()
  out.writeUInt16LE(0, 6)
  return out
}

export class Psb {
  constructor(buf, { seed = null } = {}) {
    if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'PSB\0') throw new Error('不是 PSB')
    if (buf.readUInt16LE(6) !== 0) {
      if (seed === null) throw new Error('这个 PSB 的头是加密的：要传 options.seed（E-mote 的密钥种子，见 EMOTE_SEED_YUGAMASE）')
      buf = decryptPsbHeader(buf, seed)
    }
    this.d = buf
    this.version = buf.readUInt16LE(4)
    this.encrypt = buf.readUInt16LE(6)
    this.oNames = buf.readUInt32LE(12)
    this.oStrings = buf.readUInt32LE(16)
    this.oStringData = buf.readUInt32LE(20)
    this.oEntries = buf.readUInt32LE(36)
    this.names = this.loadNames()
    this.strings = this.loadStrings()
  }

  uintArray(pos) {
    const d = this.d
    const t = d[pos]
    if (t < 0x0d || t > 0x14) throw new Error(`PSB：期望整数数组，实际类型 0x${t.toString(16)}（偏移 ${pos}）`)
    pos += 1
    const cn = t - 0x0c
    const count = d.readUIntLE(pos, cn)
    pos += cn
    const es = d[pos] - 0x0c
    pos += 1
    if (es < 1 || es > 6 || count > 0x4000000) throw new Error('PSB：整数数组头不合理')
    const out = new Array(count)
    for (let i = 0; i < count; i++) out[i] = d.readUIntLE(pos + i * es, es)
    return [out, pos + count * es]
  }

  loadNames() {
    const [a, p1] = this.uintArray(this.oNames)
    const [b, p2] = this.uintArray(p1)
    const [c] = this.uintArray(p2)
    const names = new Array(c.length)
    for (let k = 0; k < c.length; k++) {
      let idx = c[k]
      const chars = []
      for (let guard = 0; idx !== 0 && idx < b.length && guard < 4096; guard++) {
        const par = b[idx]
        chars.push(idx - a[par])
        idx = par
      }
      chars.reverse()
      names[k] = Buffer.from(chars).toString('utf8').replace(/\0+$/, '')
    }
    return names
  }

  loadStrings() {
    const [offs] = this.uintArray(this.oStrings)
    const out = new Array(offs.length)
    for (let i = 0; i < offs.length; i++) {
      const start = this.oStringData + offs[i]
      let end = this.d.indexOf(0, start)
      if (end < 0) end = this.d.length
      out[i] = this.d.toString('utf8', start, end)
    }
    return out
  }

  // → [值, 下一个位置]
  value(pos, depth = 0) {
    if (depth > MAX_DEPTH) throw new Error('PSB 嵌套太深')
    const d = this.d
    const t = d[pos]
    pos += 1
    if (t === 0 || t === 1) return [null, pos]
    if (t === 2) return [false, pos]
    if (t === 3) return [true, pos]
    if (t === 4) return [0, pos]
    if (t >= 5 && t <= 12) { const n = t - 4; return [n <= 6 ? d.readIntLE(pos, n) : Number(readBigSigned(d, pos, n)), pos + n] }
    if (t >= 0x0d && t <= 0x14) return this.uintArray(pos - 1)
    if (t >= 0x15 && t <= 0x18) { const n = t - 0x14; return [this.strings[d.readUIntLE(pos, n)] ?? '', pos + n] }
    if (t >= 0x19 && t <= 0x1c) { const n = t - 0x18; return [{ resource: d.readUIntLE(pos, n) }, pos + n] }
    if (t >= 0x22 && t <= 0x25) { const n = t - 0x21; return [{ extra: d.readUIntLE(pos, n) }, pos + n] }   // v4 的 extra 资源（E-mote 的 src 贴图在这里）
    if (t === 0x1d) return [0, pos]
    if (t === 0x1e) return [d.readFloatLE(pos), pos + 4]
    if (t === 0x1f) return [d.readDoubleLE(pos), pos + 8]
    if (t === 0x20) {
      const [offs, p] = this.uintArray(pos)
      const out = new Array(offs.length)
      for (let i = 0; i < offs.length; i++) out[i] = this.value(p + offs[i], depth + 1)[0]
      return [out, p]
    }
    if (t === 0x21) {
      const [keys, p1] = this.uintArray(pos)
      const [offs, p2] = this.uintArray(p1)
      const out = {}
      for (let i = 0; i < keys.length; i++) out[this.names[keys[i]] ?? `?${keys[i]}`] = this.value(p2 + offs[i], depth + 1)[0]
      return [out, p2]
    }
    throw new Error(`PSB：不认识的类型 0x${t.toString(16)}（偏移 ${pos - 1}）`)
  }

  root() { return this.value(this.oEntries)[0] }

  // v4 头 = 14 个 u32：长度、names、strings 偏移表、strings 数据、resources 偏移 / 长度 / 数据、entries、校验和、extra 偏移 / 长度 / 数据（索引 9..11）
  // 这里按头里的位置读，位置对不上就返回空
  extras() {
    const h = (i) => this.d.readUInt32LE(8 + i * 4)
    try {
      const [offs] = this.uintArray(h(9))
      const [lens] = this.uintArray(h(10))
      const base = h(11)
      return offs.map((o, i) => this.d.subarray(base + o, base + o + lens[i]))
    } catch { return [] }
  }

  // 资源块（图 / 声音等的原始字节）：偏移表 / 长度表 / 数据区在头里（24 / 28 / 32）；root 里的 { resource: n } = 这里的第 n 个
  resources() {
    const [offs] = this.uintArray(this.d.readUInt32LE(24))
    const [lens] = this.uintArray(this.d.readUInt32LE(28))
    const base = this.d.readUInt32LE(32)
    return offs.map((o, i) => this.d.subarray(base + o, base + o + lens[i]))
  }
}

function readBigSigned(buf, pos, n) {
  let v = 0n
  for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[pos + i])
  return BigInt.asIntN(n * 8, v)
}

export const isPsb = (buf) => buf.length >= 44 && buf.toString('latin1', 0, 4) === 'PSB\0'
export const readPsb = (buf) => new Psb(buf).root()
