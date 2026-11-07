#!/usr/bin/env node
// PSB：E-mote 头解密（xorshift128，逆向自 emotedriver.dll 的 StructCryptFilter）+ 读取。合成一个最小 v4 PSB 加密后读回；PSB_SAMPLE=<已解开 pf8 外层的 .psb> + PSB_SEED 时再读真实文件。
import { readFileSync } from 'node:fs'
import { EMOTE_SEED_YUGAMASE, Psb, decryptPsbHeader, xorshiftKeystream } from '../../web/library/gal/psb.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }

const next = xorshiftKeystream(EMOTE_SEED_YUGAMASE)
const first = [next(), next(), next(), next()]
// 真实 dummy.psb 头前 4 字节加密后是 22 f9 1a db，明文 = 0x38（头长度）→ 密钥流前 4 字节 = 1a f9 1a db
check('密钥流（种子 49327924）前 4 字节 = 1a f9 1a db（对真实文件：22f91adb ^ 38000000）', first.join(',') === [0x1a, 0xf9, 0x1a, 0xdb].join(','), first.map((x) => x.toString(16)).join(' '))

// 合成：头 56 字节（14 个 u32 里前 12 个有效），names / strings 都指向一个空数组 0x0d 0x00 0x0d（count 0、元素大小 1）
const buf = Buffer.alloc(96)
buf.write('PSB\0', 0, 'latin1')
buf.writeUInt16LE(4, 4)
buf.writeUInt16LE(0, 6)
buf.writeUInt32LE(56, 8)
for (let k = 0; k < 4; k++) { buf[56 + k * 3] = 0x0d; buf[57 + k * 3] = 0; buf[58 + k * 3] = 0x0d }   // 三个空整数数组（names 的 a / b / c）+ 一个（strings）
for (const at of [12, 20]) buf.writeUInt32LE(56, at)   // names 起点；strings 数据（不读）
buf.writeUInt32LE(65, 16)
buf.writeUInt32LE(65, 24); buf.writeUInt32LE(65, 28); buf.writeUInt32LE(65, 32)
buf.writeUInt32LE(68, 36)   // entries：空对象 0x21 + 两个空数组（keys / offsets）
buf[68] = 0x21
for (let k = 0; k < 2; k++) { buf[69 + k * 3] = 0x0d; buf[70 + k * 3] = 0; buf[71 + k * 3] = 0x0d }
const plain = Buffer.from(buf)
const enc = Buffer.from(buf)
enc.writeUInt16LE(1, 6)
const ks = xorshiftKeystream(EMOTE_SEED_YUGAMASE)
for (let i = 8; i < 56; i++) enc[i] ^= ks()
check('加密后头 ≠ 明文', !enc.subarray(8, 56).equals(plain.subarray(8, 56)))
const back = decryptPsbHeader(enc, EMOTE_SEED_YUGAMASE)
check('解密还原（头 48 字节）并把标志清零', back.subarray(8, 56).equals(plain.subarray(8, 56)) && back.readUInt16LE(6) === 0)
let err = ''
try { new Psb(enc) } catch (e) { err = e.message }
check('加密的 PSB 没传种子 = 报错并说明要 options.seed', /seed/.test(err), err)
let err2 = ''
try { decryptPsbHeader(enc, 12345) } catch (e) { err2 = e.message }
check('种子不对 = 头长度不合理，报错', /不合理/.test(err2), err2)
const p = new Psb(enc, { seed: EMOTE_SEED_YUGAMASE })
check('传种子后能读（空根对象）', p.version === 4 && JSON.stringify(p.root()) === '{}', JSON.stringify(p.root?.()))

if (process.env.PSB_SAMPLE) {
  const real = new Psb(readFileSync(process.env.PSB_SAMPLE), { seed: Number(process.env.PSB_SEED || EMOTE_SEED_YUGAMASE) })
  const root = real.root()
  check('真实 PSB：根有 source / object / metadata', Boolean(root.source && root.object && root.metadata), Object.keys(root).join())
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
