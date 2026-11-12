// KiriKiri Z（Wamsoft）Hxv4 加密的 XP3：读档案、解「特殊索引」、按逻辑名取条目并解密。
// 依据：xp3-brute 0.3.7（crates.io，MIT）的源码（xp3.rs / hxv4.rs / hxv4_native.rs）移植；g08 / g09 两个游戏的 scn.xp3 上逐条核对（条目的 adlr 校验和全部对上）。
// 范围：只做「已经有密钥包」的那一半——密钥包（key bundle）放配置，不从 exe 里取（取密钥是另一件事，见 README）。
//
// 密钥包（hex）：{ params(22B), material(64B), key(32B), nonce0(24B), nonce1(24B) }
//   · 特殊索引 = XChaCha20-Poly1305(key, nonce) 加密 + zlib；nonce 由档案里 Hxv4 描述符的 kind 低位选（0 → nonce0，1 → nonce1）
//   · 条目内容 = XOR：params + 1024 个 u32 的控制表（SHAKE256(material, 0x2000) 取出；params[17] 低位 = 1 取第一块、= 2 第一块 ^ 第二块）生成 128 个小虚拟机程序，
//     按条目的 entry_key 算出前 16 字节的掩码 + 分界点两侧各一个重复字节 + 两个边界修正字节；holder 字 = nonce0 的前两个 u32，entry 的 open 标志为 0 时异或进 entry_key
//   · 条目的文件名 = 哈希：名字 = BLAKE2s-256(UTF-16LE(名字 + "xp3hnp"))，目录 = SipHash-2-4(零密钥, UTF-16LE(目录 + "xp3hnp"))（小端 8 字节）；目录不带首尾斜杠（'/' = 根）
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

const M64 = (1n << 64n) - 1n
const SALT = 'xp3hnp'
const XP3_MAGIC = Buffer.from([0x58, 0x50, 0x33, 0x0d, 0x0a, 0x20, 0x0a, 0x1a, 0x8b, 0x67, 0x01])
const TAG = { file: 0x656c6946, info: 0x6f666e69, segm: 0x6d676573, adlr: 0x726c6461, hxv4: 0x34767848 }
const u64 = (x) => x & M64
const rotl64 = (x, n) => u64((x << BigInt(n)) | (x >> BigInt(64 - n)))

// ---------- 控制表 + 虚拟机（hxv4_native.rs） ----------
const OP = { AddParam: 0, EnterBlock: 1, AddScratch: 2, MulScratch: 3, ScratchMinusResult: 4, ShlScratch: 5, ShrScratch: 6, SubScratch: 7, BitShuffle: 8, LoadImmediate: 9, LoadSeed: 10, Dec: 11, Inc: 12, Neg: 13, Not: 14, LoadTableImmediate: 15, LoadTableMasked: 16, SubParam: 17, StoreScratch: 18, XorParam: 19, Stop: 20 }

function splitmix64Final(value) {
  let v = u64(value)
  v = u64((v ^ (v >> 30n)) * 0xbf58476d1ce4e5b9n)
  v = u64((v ^ (v >> 27n)) * 0x94d049bb133111ebn)
  return v ^ (v >> 31n)
}
class Rng {
  constructor(lane, randomType) {
    const GAMMA = 0x9e3779b97f4a7c15n
    const l = BigInt(lane)
    const base = (u64(~l & 0xffffffffn) << 32n) | l
    this.s0 = splitmix64Final(u64(base + GAMMA))
    this.s1 = splitmix64Final(u64(base + u64(GAMMA * 2n)))
    this.type = randomType
  }
  nextU64() {
    if (this.type === 0) {
      const result = u64(rotl64(u64(this.s0 + this.s1), 17) + this.s0)
      this.s1 ^= this.s0
      this.s0 = rotl64(this.s0, 49) ^ this.s1 ^ u64(this.s1 << 21n)
      this.s1 = rotl64(this.s1, 28)
      return result
    }
    const result = u64(rotl64(u64(this.s0 * 5n), 7) * 9n)
    this.s1 ^= this.s0
    this.s0 = rotl64(this.s0, 24) ^ this.s1 ^ u64(this.s1 << 16n)
    this.s1 = rotl64(this.s1, 37)
    return result
  }
  nextU32() { return Number(this.nextU64() & 0xffffffffn) }
}

class Generator {
  constructor(params, rng) { this.params = params; this.rng = rng; this.codeLen = 0; this.ins = [] }
  addLen(n) { const next = this.codeLen + n; if (next > 128) return false; this.codeLen = next; return true }
  emit(op, param = 0) { this.ins.push({ op, param }) }
  genBinary(depth) {
    if (depth <= 1) return this.genLeaf()
    const child = depth - 1
    if (!this.addLen(1)) return false
    this.emit(OP.EnterBlock)
    if (!((this.rng.nextU32() & 1) ? this.genBinary(child) : this.genUnary(child))) return false
    if (!this.addLen(2)) return false
    this.emit(OP.StoreScratch)
    if (!((this.rng.nextU32() & 1) ? this.genBinary(child) : this.genUnary(child))) return false
    const choice = this.rng.nextU32() % 6
    const p = this.params
    let op
    let len
    if (choice === p[8]) { op = OP.AddScratch; len = 2 } else if (choice === p[9]) { op = OP.SubScratch; len = 2 } else if (choice === p[10]) { op = OP.ScratchMinusResult; len = 4 } else if (choice === p[11]) { op = OP.MulScratch; len = 3 } else if (choice === p[12]) { op = OP.ShlScratch; len = 9 } else if (choice === p[13]) { op = OP.ShrScratch; len = 9 } else return false
    if (!this.addLen(len) || !this.addLen(1)) return false
    this.emit(op)
    this.emit(OP.Stop)
    return true
  }
  genUnary(depth) {
    if (depth <= 1) return this.genLeaf()
    const child = depth - 1
    if (!((this.rng.nextU32() & 1) ? this.genBinary(child) : this.genUnary(child))) return false
    const choice = this.rng.nextU32() & 7
    const p = this.params
    if (choice === p[0]) { if (!this.addLen(2)) return false; this.emit(OP.Not) } else if (choice === p[1]) { if (!this.addLen(2)) return false; this.emit(OP.Neg) } else if (choice === p[2]) { if (!this.addLen(1)) return false; this.emit(OP.Inc) } else if (choice === p[3]) { if (!this.addLen(1)) return false; this.emit(OP.Dec) } else if (choice === p[4]) { if (!this.addLen(21)) return false; this.emit(OP.BitShuffle, 0xaaaaaaaa) } else if (choice === p[5]) {
      if (!this.addLen(1)) return false
      const imm = this.rng.nextU32()
      if (!this.addLen(4)) return false
      this.emit(OP.XorParam, imm)
    } else if (choice === p[6]) {
      const add = (this.rng.nextU32() & 1) !== 0
      if (!this.addLen(1)) return false
      const imm = this.rng.nextU32()
      if (!this.addLen(4)) return false
      this.emit(add ? OP.AddParam : OP.SubParam, imm)
    } else if (choice === p[7]) { if (!this.addLen(13)) return false; this.emit(OP.LoadTableMasked, 1023) } else return false
    return true
  }
  genLeaf() {
    const choice = this.rng.nextU32() % 3
    const p = this.params
    if (choice === p[14]) {
      if (!this.addLen(1)) return false
      const imm = this.rng.nextU32()
      if (!this.addLen(4)) return false
      this.emit(OP.LoadImmediate, imm)
    } else if (choice === p[15]) { if (!this.addLen(2)) return false; this.emit(OP.LoadSeed) } else if (choice === p[16]) {
      if (!this.addLen(7)) return false
      const index = this.rng.nextU32() & 0x3ff
      if (!this.addLen(4)) return false
      this.emit(OP.LoadTableImmediate, index)
    } else return false
    return true
  }
}

// 随机数不回绕地重试：深度 5、4、3、2、1（和原实现一样，原实现里 x86 形式超过 128 字节就降一级）
function buildLane(params, rng) {
  for (let depth = 5; depth >= 1; depth--) {
    const g = new Generator(params, rng)
    if (!g.addLen(9)) continue
    if (!g.genBinary(depth)) continue
    if (!g.addLen(6)) continue
    g.emit(OP.Stop)
    return g.ins
  }
  return null
}

const permutationValid = (data, n) => { if (data.length !== n) return false; const seen = new Set(); for (const v of data) { if (v >= n || seen.has(v)) return false; seen.add(v) } return true }

export class Hxv4Filter {
  // params：22 字节；table：1024 个 u32；holder：[低, 高]（nonce0 的前两个 u32）
  constructor(params, table, holder = [0, 0]) {
    if (params.length < 0x16) throw new Error(`HXV4 PARAMS 只有 ${params.length} 字节`)
    if (table.length !== 1024) throw new Error('HXV4 控制表不是 1024 个字')
    if (!permutationValid(params.subarray(0, 8), 8) || !permutationValid(params.subarray(8, 14), 6) || !permutationValid(params.subarray(14, 17), 3)) throw new Error('HXV4 PARAMS 的操作码映射不是排列')
    this.randomType = params[17] >> 7
    this.mask = params.readUInt16LE(18)
    this.offset = params.readUInt16LE(20)
    this.table = table
    this.holder = holder
    this.lanes = []
    for (let lane = 0; lane < 128; lane++) {
      const program = buildLane(params, new Rng(lane, this.randomType))
      if (!program) throw new Error(`HXV4 虚拟机程序 ${lane} 超出 128 字节预算`)
      this.lanes.push(program)
    }
  }

  static fromBundle(bundle) {
    const params = Buffer.from(bundle.params, 'hex')
    const material = Buffer.from(bundle.material, 'hex')
    const shake = createHash('shake256', { outputLength: 0x2000 }).update(material).digest()
    const mode = (params[17] & 1) + 1
    const table = new Array(1024)
    for (let i = 0; i < 1024; i++) {
      let w = shake.readUInt32LE(i * 4)
      if (mode === 2) w = (w ^ shake.readUInt32LE(0x1000 + i * 4)) >>> 0
      table[i] = w
    }
    const nonce0 = Buffer.from(bundle.nonce0, 'hex')
    return new Hxv4Filter(params, table, [nonce0.readUInt32LE(0), nonce0.readUInt32LE(4)])
  }

  run(ins, seed) {
    const table = this.table
    // 返回 [pc, result]；scratch 在嵌套块里按值传递（块结束后还原）
    const exec = (start, scratchIn, resultIn) => {
      let pc = start
      let scratch = scratchIn
      let result = resultIn
      for (;;) {
        const it = ins[pc++]
        if (!it) throw new Error('HXV4 程序没有 STOP')
        switch (it.op) {
          case OP.AddParam: result = (result + it.param) >>> 0; break
          case OP.EnterBlock: { const r = exec(pc, scratch, result); pc = r[0]; result = r[1]; break }
          case OP.AddScratch: result = (result + scratch) >>> 0; break
          case OP.MulScratch: result = Math.imul(result, scratch) >>> 0; break
          case OP.ScratchMinusResult: result = (scratch - result) >>> 0; break
          case OP.ShlScratch: result = (result << (scratch & 15)) >>> 0; break
          case OP.ShrScratch: result >>>= (scratch & 15); break
          case OP.SubScratch: result = (result - scratch) >>> 0; break
          case OP.BitShuffle: { const m = it.param; result = ((((result & ~m) >>> 0) << 1) | ((m >>> 1) & (result >>> 1))) >>> 0; break }
          case OP.LoadImmediate: result = it.param >>> 0; break
          case OP.LoadSeed: result = seed >>> 0; break
          case OP.Dec: result = (result - 1) >>> 0; break
          case OP.Inc: result = (result + 1) >>> 0; break
          case OP.Neg: result = (0 - result) >>> 0; break
          case OP.Not: result = (~result) >>> 0; break
          case OP.LoadTableImmediate: result = table[it.param]; break
          case OP.LoadTableMasked: result = table[(it.param & result) >>> 0]; break
          case OP.SubParam: result = (result - it.param) >>> 0; break
          case OP.StoreScratch: scratch = result; break
          case OP.XorParam: result = (result ^ it.param) >>> 0; break
          case OP.Stop: return [pc, result]
          default: throw new Error('HXV4 未知操作')
        }
      }
    }
    return exec(0, 0, 0)[1]
  }

  drip64(value) {
    const v = value >>> 0
    const prog = this.lanes[v & 0x7f]
    const seed = v >>> 7
    const lo = this.run(prog, seed)
    const hi = this.run(prog, (~seed) >>> 0)
    return (BigInt(hi) << 32n) | BigInt(lo)
  }

  // 一个条目的运行状态（entryKey：u64 的 BigInt；localFlag：u16）
  stateFor(entryKey, localFlag) {
    const openFlag = (localFlag & 1) !== 0
    let lo = Number(entryKey & 0xffffffffn)
    let hi = Number((entryKey >> 32n) & 0xffffffffn)
    if (!openFlag) { lo = (lo ^ this.holder[0]) >>> 0; hi = (hi ^ this.holder[1]) >>> 0 }
    const key = (BigInt(hi) << 32n) | BigInt(lo)
    const leftDrip = this.drip64(lo)
    const rightDrip = this.drip64(hi)
    const split = (this.offset + (this.mask & Number((key >> 16n) & 0xffffffffn))) >>> 0
    const prefix = Buffer.alloc(16)
    let cursor = u64(~key)
    for (let c = 0; c < 2; c++) {
      cursor = u64(~this.drip64(Number(cursor & 0xffffffffn)))
      prefix.writeBigUInt64BE(cursor, c * 8)
    }
    return { split, prefix, left: boundary(leftDrip), right: boundary(rightDrip) }
  }
}

function boundary(value) {
  const position0 = Number((value >> 48n) & 0xffffn)
  let position1 = Number((value >> 32n) & 0xffffn)
  if (position0 === position1) position1 += 1
  let xor = Number(value & 0xffn)
  if (xor === 0) xor = 0xa5
  return { position0, position1, xor, correction0: Number((value >> 8n) & 0xffn), correction1: Number((value >> 16n) & 0xffn) }
}

// 对 data（逻辑偏移 start）原地做对称 XOR
export function applyState(state, start, data) {
  if (!data.length) return data
  const end = start + data.length
  const ps = Math.min(start, 16)
  const pe = Math.min(end, 16)
  for (let p = ps; p < pe; p++) data[p - start] ^= state.prefix[p]
  const xorRange = (from, to, key) => { if (key === 0 || from >= to) return; for (let i = from - start; i < to - start; i++) data[i] ^= key }
  if (start < state.split) xorRange(start, Math.min(end, state.split), state.left.xor)
  if (end > state.split) xorRange(Math.max(start, state.split), end, state.right.xor)
  const corrections = (b, leftSide) => {
    for (const [pos, value] of [[b.position0, b.correction0], [b.position1, b.correction1]]) {
      if (value === 0 || pos < start || pos >= end) continue
      if (leftSide && pos >= state.split) continue
      if (!leftSide && pos < state.split) continue
      data[pos - start] ^= value
    }
  }
  corrections(state.left, true)
  corrections(state.right, false)
  return data
}

// ---------- 名字哈希 ----------
const utf16le = (text) => Buffer.from(text, 'utf16le')
// 32 字节。原实现的「自定义 BLAKE2s」和标准 BLAKE2s-256 一致（初始状态 IV0 ^ 0x01010020 = 0x6B08E647，末块置终止标志）
export const nameHash = (name) => createHash('blake2s256').update(utf16le(name + SALT)).digest()
function sipRound(v) {
  v[0] = u64(v[0] + v[1]); v[1] = rotl64(v[1], 13) ^ v[0]; v[0] = rotl64(v[0], 32)
  v[2] = u64(v[2] + v[3]); v[3] = rotl64(v[3], 16) ^ v[2]
  v[0] = u64(v[0] + v[3]); v[3] = rotl64(v[3], 21) ^ v[0]
  v[2] = u64(v[2] + v[1]); v[1] = rotl64(v[1], 17) ^ v[2]; v[2] = rotl64(v[2], 32)
}
// 8 字节：SipHash-2-4（零密钥）；'/' = 根目录。按小端写出 = 特殊索引里存的字节序（xp3-brute 的测试向量用大端显示，是它的反过来：'/' 在这里是 94D4A97C61498621，它那边是 218649617CA9D494）
export function pathHash(path) {
  const data = utf16le((path === '/' ? '' : path) + SALT)
  const v = [0x736f6d6570736575n, 0x646f72616e646f6dn, 0x6c7967656e657261n, 0x7465646279746573n]
  const full = Math.floor(data.length / 8) * 8
  for (let i = 0; i < full; i += 8) {
    const m = data.readBigUInt64LE(i)
    v[3] ^= m; sipRound(v); sipRound(v); v[0] ^= m
  }
  let b = BigInt(data.length) << 56n
  for (let i = full; i < data.length; i++) b |= BigInt(data[i]) << BigInt(8 * (i - full))
  b = u64(b)
  v[3] ^= b; sipRound(v); sipRound(v); v[0] ^= b
  v[2] ^= 0xffn
  for (let i = 0; i < 4; i++) sipRound(v)
  const out = Buffer.alloc(8)
  out.writeBigUInt64LE(v[0] ^ v[1] ^ v[2] ^ v[3])
  return out
}

// ---------- XChaCha20-Poly1305（特殊索引） ----------
function hchacha20(key, nonce16) {
  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0
  const s = new Uint32Array(16)
  s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574
  for (let i = 0; i < 8; i++) s[4 + i] = key.readUInt32LE(i * 4)
  for (let i = 0; i < 4; i++) s[12 + i] = nonce16.readUInt32LE(i * 4)
  const q = (a, b, c, d) => {
    s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 16)
    s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 12)
    s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 8)
    s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 7)
  }
  for (let i = 0; i < 10; i++) { q(0, 4, 8, 12); q(1, 5, 9, 13); q(2, 6, 10, 14); q(3, 7, 11, 15); q(0, 5, 10, 15); q(1, 6, 11, 12); q(2, 7, 8, 13); q(3, 4, 9, 14) }
  const out = Buffer.alloc(32)
  for (let i = 0; i < 4; i++) out.writeUInt32LE(s[i], i * 4)
  for (let i = 0; i < 4; i++) out.writeUInt32LE(s[12 + i], 16 + i * 4)
  return out
}
function xchacha20poly1305Open(key, nonce24, sealed) {   // sealed = 密文 + 16 字节标签
  const subkey = hchacha20(key, nonce24.subarray(0, 16))
  const nonce12 = Buffer.concat([Buffer.alloc(4), nonce24.subarray(16, 24)])
  const decipher = createDecipheriv('chacha20-poly1305', subkey, nonce12, { authTagLength: 16 })
  decipher.setAuthTag(sealed.subarray(sealed.length - 16))
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
}

export function xchacha20poly1305Seal(key, nonce24, plain) {   // 自测造档案用；返回 密文 + 16 字节标签
  const subkey = hchacha20(key, nonce24.subarray(0, 16))
  const cipher = createCipheriv('chacha20-poly1305', subkey, Buffer.concat([Buffer.alloc(4), nonce24.subarray(16, 24)]), { authTagLength: 16 })
  const ct = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([ct, cipher.getAuthTag()])
}

// ---------- 特殊索引（序列化对象，整数 / 长度都是大端） ----------
function readHx(buf) {
  let pos = 0
  const take = (n) => { if (pos + n > buf.length) throw new Error('Hxv4 索引被截断'); const s = buf.subarray(pos, pos + n); pos += n; return s }
  const count = () => { const v = take(4).readInt32BE(0); if (v < 0) throw new Error('Hxv4 索引长度为负'); return v }
  const str = () => { const n = count(); const raw = take(n * 2); const b = Buffer.alloc(n * 2); for (let i = 0; i < n * 2; i += 2) { b[i] = raw[i + 1]; b[i + 1] = raw[i] } return b.toString('utf16le') }
  const obj = (depth) => {
    if (depth > 128) throw new Error('Hxv4 索引嵌套太深')
    const t = take(1)[0]
    if (t === 0 || t === 1) return null
    if (t === 2) return str()
    if (t === 3) return Buffer.from(take(count()))
    if (t === 4) return take(8).readBigInt64BE(0)
    if (t === 5) return take(8).readDoubleBE(0)
    if (t === 0x81) { const n = count(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = obj(depth + 1); return a }
    if (t === 0xc1) { const n = count(); const d = {}; for (let i = 0; i < n; i++) { const k = str(); d[k] = obj(depth + 1) } return d }
    throw new Error(`Hxv4 索引里有不认识的对象类型 0x${t.toString(16)}`)
  }
  const root = obj(0)
  if (pos !== buf.length) throw new Error('Hxv4 索引末尾有多余字节')
  return root
}

// → [{ pathHash / nameHash（hex 大写）, id, archiveSlot, filterFlag, entryKey(BigInt) }]
function parseSpecial(root) {
  if (!Array.isArray(root) || root.length % 2) throw new Error('Hxv4 索引根不是成对数组')
  const out = []
  for (let i = 0; i < root.length; i += 2) {
    const ph = root[i]
    const dir = root[i + 1]
    if (!Buffer.isBuffer(ph) || ph.length !== 8 || !Array.isArray(dir) || dir.length % 2) throw new Error('Hxv4 路径组格式不对')
    for (let j = 0; j < dir.length; j += 2) {
      const nh = dir[j]
      const info = dir[j + 1]
      if (!Buffer.isBuffer(nh) || nh.length !== 32 || !Array.isArray(info) || info.length !== 2 || typeof info[0] !== 'bigint' || typeof info[1] !== 'bigint') throw new Error('Hxv4 记录格式不对')
      const packed = BigInt.asUintN(64, info[0])
      const locator = Number(packed >> 32n)
      out.push({ pathHash: ph.toString('hex').toUpperCase(), nameHash: nh.toString('hex').toUpperCase(), id: Number(packed & 0xffffffffn), archiveSlot: locator >>> 16, filterFlag: locator & 0xffff, entryKey: BigInt.asUintN(64, info[1]) })
    }
  }
  if (!out.length) throw new Error('Hxv4 索引没有记录')
  return out
}

// ---------- XP3 ----------
function fakeId(name) {   // info 里的名字是 id 的 14 位一组编码（0x5000 + 14 位）
  if (!name || name.length > 5) return null
  let id = 0n
  for (let i = 0; i < name.length; i++) {
    const w = name.charCodeAt(i)
    if (w < 0x5000 || w > 0x8fff) return null
    id |= BigInt(w - 0x5000) << BigInt(i * 14)
  }
  return Number(id)
}
export const adler32 = (buf) => { let a = 1; let b = 0; for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521 } return ((b << 16) | a) >>> 0 }

async function readAt(handle, offset, length) {
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||length>256*1024*1024)throw Error('XP3读取范围无效或超过256MB')
  const buf = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await handle.read(buf, done, length - done, offset + done)
    if (!bytesRead) throw new Error(`读不到 ${length} 字节（偏移 ${offset}）：文件被截断`)
    done += bytesRead
  }
  return buf
}

function parseFileChunk(body) {
  const e = { segments: [], name: '', adler: null, flags: 0, originalSize: 0, archiveSize: 0 }
  let pos = 0
  let haveInfo = false
  while (pos + 12 <= body.length) {
    const tag = body.readUInt32LE(pos)
    const len = Number(body.readBigUInt64LE(pos + 4))
    const start = pos + 12
    if (start + len > body.length) return null
    const c = body.subarray(start, start + len)
    if (tag === TAG.info && c.length >= 22) {
      e.flags = c.readUInt32LE(0); e.originalSize = Number(c.readBigUInt64LE(4)); e.archiveSize = Number(c.readBigUInt64LE(12))
      const chars = c.readUInt16LE(20)
      if (22 + chars * 2 <= c.length) { e.name = c.subarray(22, 22 + chars * 2).toString('utf16le'); haveInfo = true }
    } else if (tag === TAG.segm && c.length && c.length % 28 === 0) {
      for (let i = 0; i < c.length; i += 28) e.segments.push({ flags: c.readUInt32LE(i), offset: Number(c.readBigUInt64LE(i + 4)), originalSize: Number(c.readBigUInt64LE(i + 12)), archiveSize: Number(c.readBigUInt64LE(i + 20)) })
    } else if (tag === TAG.adlr && c.length >= 4) e.adler = c.readUInt32LE(0)
    pos = start + len
  }
  return haveInfo && e.segments.length ? e : null
}

// 打开 Hxv4 档案 → { size, kind, entries, special, find(目录, 名字), readEntry(条目), close() }
export async function openHxv4Archive(file, bundle, { filter = null, allowPlain = false } = {}) {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const head = await readAt(handle, 0, Math.min(64, size))
    if (!head.subarray(0, XP3_MAGIC.length).equals(XP3_MAGIC)) throw new Error('不是 XP3（魔数不对）')
    // 索引块（可以有多块，0x80 = 后面还有）
    let pointerPos = XP3_MAGIC.length
    const entries = []
    let hxv4 = null
    for (let block = 0; block < 100000; block++) {
      const relative = Number((await readAt(handle, pointerPos, 8)).readBigUInt64LE(0))
      const flags = (await readAt(handle, relative, 1))[0]
      let pos = relative + 1
      let decoded
      if ((flags & 7) === 0) {
        const n = Number((await readAt(handle, pos, 8)).readBigUInt64LE(0)); pos += 8
        decoded = await readAt(handle, pos, n); pos += n
      } else if ((flags & 7) === 1) {
        const sizes = await readAt(handle, pos, 16); pos += 16
        const stored = Number(sizes.readBigUInt64LE(0))
        const original = Number(sizes.readBigUInt64LE(8))
        decoded = inflateSync(await readAt(handle, pos, stored)); pos += stored
        if (decoded.length !== original) throw new Error('XP3 索引解压后大小对不上')
      } else throw new Error(`不支持的 XP3 索引编码 ${flags & 7}`)
      let p = 0
      while (p + 12 <= decoded.length) {
        const tag = decoded.readUInt32LE(p)
        const len = Number(decoded.readBigUInt64LE(p + 4))
        const start = p + 12
        if (start + len > decoded.length) throw new Error('XP3 根块长度不对')
        const body = decoded.subarray(start, start + len)
        if (tag === TAG.hxv4 && body.length === 14 && !hxv4) hxv4 = { offset: Number(body.readBigUInt64LE(0)), stored: body.readUInt32LE(8), kind: body.readUInt16LE(12) }
        else if (tag === TAG.file) { const entry = parseFileChunk(body); if (entry) entries.push(entry) }
        p = start + len
      }
      if (!(flags & 0x80)) break
      pointerPos = pos
    }
    if(!hxv4&&allowPlain){
      for(const [id,e] of entries.entries()){
        if(!e.name||e.name.split(/[\\/]/).some(x=>x==='..')||e.originalSize>256*1024*1024||e.segments.some(s=>!Number.isSafeInteger(s.offset)||!Number.isSafeInteger(s.archiveSize)||s.offset<19||s.offset+s.archiveSize>size))throw Error('XP3 明文条目范围无效')
        e.hxv4Id=id+1;e.meta={plain:true,entryKey:0n,filterFlag:0,archiveSlot:0,id:id+1,nameHash:nameHash(e.name.split('/').at(-1)).toString('hex').toUpperCase()}
      }
      const readEntry=async e=>{const parts=[];for(const s of e.segments){const raw=await readAt(handle,s.offset,s.archiveSize);if((s.flags&7)===0)parts.push(raw);else if((s.flags&7)===1)parts.push(inflateSync(raw,{maxOutputLength:256*1024*1024}));else throw Error('XP3 明文段编码不支持')}const data=Buffer.concat(parts);if(data.length!==e.originalSize||e.adler!==null&&adler32(data)!==e.adler)throw Error('XP3 明文条目长度/校验不符');return data}
      return{size,kind:'plain',entries,special:entries.map(e=>e.meta),find:(_dir,name)=>entries.find(e=>e.name===name),readEntry,readEntryRange:async(e,start,length)=>{if(start<0||length<0||start+length>e.originalSize)throw Error('XP3 范围无效');if(e.segments.length===1&&!(e.segments[0].flags&7))return readAt(handle,e.segments[0].offset+start,length);return(await readEntry(e)).subarray(start,start+length)},close:()=>handle.close()}
    }
    if (!hxv4) throw new Error('这个 XP3 没有 Hxv4 描述符（不是 Hxv4 加密档案）')
    const key = Buffer.from(bundle.key, 'hex')
    const nonce = Buffer.from((hxv4.kind & 1) ? bundle.nonce1 : bundle.nonce0, 'hex')
    const blob = await readAt(handle, hxv4.offset, hxv4.stored)
    let inflated
    try {
      const sealed = Buffer.concat([blob.subarray(16), blob.subarray(0, 16)])
      const plain = xchacha20poly1305Open(key, nonce, sealed)
      const expected = plain.readUInt32LE(0)
      inflated = inflateSync(plain.subarray(4))
      if (inflated.length !== expected) throw new Error('特殊索引解压后大小对不上')
    } catch (error) { throw new Error(`特殊索引解不开（密钥包不对，或这个档案用了别的密钥）：${error.message}`) }
    const special = parseSpecial(readHx(inflated))
    const byId = new Map()
    for (const r of special) if (r.archiveSlot === 0 && !byId.has(r.id)) byId.set(r.id, r)
    const byName = new Map()
    for (const r of special) byName.set(`${r.pathHash}/${r.nameHash}`, r)
    const fx = filter || Hxv4Filter.fromBundle(bundle)
    for (const e of entries) { e.hxv4Id = fakeId(e.name); e.meta = e.hxv4Id === null ? null : byId.get(e.hxv4Id) || null }
    const byRecord = new Map()
    for (const e of entries) if (e.meta) byRecord.set(e.meta, e)
    const hashOf = (dirPath, fileName) => `${pathHash(dirPath).toString('hex').toUpperCase()}/${nameHash(fileName).toString('hex').toUpperCase()}`
    // 取一个条目的明文：段拼起来（zlib 段先解压）再整体做 XOR；有 adlr 就校验（verify 默认开），对不上抛错
    const readEntry = async (entry, { verify = true } = {}) => {
      if (!entry.meta) throw new Error('这个条目在特殊索引里没有记录（没法解密）')
      const parts = []
      for (const s of entry.segments) {
        const raw = await readAt(handle, s.offset, s.archiveSize)
        if ((s.flags & 7) === 1) { const d = inflateSync(raw); if (d.length !== s.originalSize) throw new Error('段解压后大小对不上'); parts.push(d) } else if ((s.flags & 7) === 0) parts.push(raw)
        else throw new Error(`不支持的段编码 ${s.flags & 7}`)
      }
      let data = Buffer.concat(parts)
      if (data.length !== entry.originalSize && data.length === entry.archiveSize) data = inflateSync(data)
      applyState(fx.stateFor(entry.meta.entryKey, entry.meta.filterFlag), 0, data)
      if (verify && entry.adler !== null && adler32(data) !== entry.adler) throw new Error('解密后校验和（adlr）对不上：密钥包或移植有误')
      return data
    }
    // 取一个条目明文的一段 [start, start + length)：段都是原样存的（没压缩）时只读这一段再按偏移解密（XOR 只和逻辑偏移有关）；有压缩段就整条读出来再切
    const readEntryRange = async (entry, start, length) => {
      if (!entry.meta) throw new Error('这个条目在特殊索引里没有记录（没法解密）')
      const end = Math.min(entry.originalSize, start + length)
      if (start >= end) return Buffer.alloc(0)
      if (entry.segments.some((s) => (s.flags & 7) !== 0)) return (await readEntry(entry, { verify: false })).subarray(start, end)
      const parts = []
      let at = 0
      for (const sg of entry.segments) {
        const from = Math.max(start, at)
        const to = Math.min(end, at + sg.originalSize)
        if (from < to) parts.push(await readAt(handle, sg.offset + (from - at), to - from))
        at += sg.originalSize
      }
      const data = Buffer.concat(parts)
      applyState(fx.stateFor(entry.meta.entryKey, entry.meta.filterFlag), start, data)
      return data
    }
    return {
      size,
      kind: hxv4.kind,
      entries,
      special,
      byId,
      // 按逻辑目录 + 文件名找条目：目录 '/' = 根，其它写法同引擎里的（如 'bgimage/'）；找不到 = null
      find(dirPath, fileName) { const r = byName.get(hashOf(dirPath, fileName)); return r ? byRecord.get(r) || null : null },
      readEntry,
      readEntryRange,
      async close() { await handle.close() },
    }
  } catch (error) { await handle.close().catch(() => {}); throw error }
}

// KiriKiri 的 FE FE 文本外壳（.stand / .ks / .tjs 之类的文本文件）：FE FE <模式> FF FE + 载荷。
// 模式 0：字符 ≥ 0x20 时 ch ^= ((ch & 0xfe) << 8) ^ 1；模式 1：相邻位互换；模式 2：zlib（8 字节压缩长度 + 8 字节原长度 + zlib），BOM 在压缩流外面。
// → 字符串；不是这种外壳返回 null
export function decodeKirikiriText(buf) {
  if (buf.length < 5 || buf[0] !== 0xfe || buf[1] !== 0xfe || buf[3] !== 0xff || buf[4] !== 0xfe) return null
  const mode = buf[2]
  let body
  if (mode === 0 || mode === 1) {
    if ((buf.length - 5) % 2) return null
    body = Buffer.alloc(buf.length - 5)
    for (let i = 5; i < buf.length; i += 2) {
      let ch = buf.readUInt16LE(i)
      if (mode === 1) ch = (((ch & 0xaaaa) >> 1) | ((ch & 0x5555) << 1)) & 0xffff
      else if (ch >= 0x20) ch = (ch ^ (((ch & 0x00fe) << 8) ^ 1)) & 0xffff
      body.writeUInt16LE(ch, i - 5)
    }
  } else if (mode === 2) {
    if (buf.length < 21) return null
    const compressed = Number(buf.readBigUInt64LE(5))
    const original = Number(buf.readBigUInt64LE(13))
    if (21 + compressed !== buf.length || original > 1 << 30) return null
    body = inflateSync(buf.subarray(21))
    if (body.length !== original) return null
  } else return null
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) body = body.subarray(2)
  return body.toString('utf16le')
}
