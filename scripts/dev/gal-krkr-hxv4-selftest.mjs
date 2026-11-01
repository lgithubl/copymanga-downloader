// KiriKiri Z Hxv4：哈希向量 / 虚拟机向量（xp3-brute 的测试）+ 合成档案整条链（造一个 Hxv4 XP3 → 打开 → 找 → 解）；
// 真实样本（可选）：KRKR_SAMPLE=<含 scn.xp3 的目录>:<密钥包 json>，把目录里的 scn.xp3 全部解一遍，核对 adlr 和 PSB 逻辑名
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { Hxv4Filter, applyState, nameHash, openHxv4Archive, pathHash } from '../../web/library/gal/krkr-hxv4.mjs'
import { buildHxv4Xp3, makeBundle } from './make-krkr-fixture.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const hex = (b) => Buffer.from(b).toString('hex').toUpperCase()

// ---- 向量（xp3-brute 源码里的单元测试）----
check('哈希向量：目录（小端存放，xp3-brute 显示的是大端 = 反过来）/ 文件名（BLAKE2s-256）', hex(pathHash('/')) === '94D4A97C61498621' && hex(Buffer.from(pathHash('/')).reverse()) === '218649617CA9D494' && hex(Buffer.from(pathHash('scenario')).reverse()) === '4EFCD0B6AF3787F6' && hex(nameHash('macro_1.ks')) === '8977D1C51B104017B9E9B8917878C781B6334A679973F290C60C6B674EC54243' && hex(nameHash('startup.tjs')) === 'D9FB4859A254D7B9EDA6621CFBE7DFD9D428082090CA08E32A9314E7116548E9')
const PARAMS = Buffer.from([2, 0, 6, 5, 1, 4, 3, 7, 1, 5, 3, 2, 0, 4, 1, 0, 2, 1, 0xe2, 0x02, 0x83, 0x02])
const table = Array.from({ length: 1024 }, (_, i) => Math.imul(i, 0x9e3779b9) >>> 0)
const fx = new Hxv4Filter(PARAMS, table)
const vectors = [[0x00000000, 0xa9f83ae40417f785n], [0x00000001, 0xffcf1e06ffcf1e07n], [0x12345678, 0x01a037fc83dea20en], [0x55667788, 0x8a628ff1453147f8n], [0x11223344, 0x00019035_0004376en], [0xffffffff, 0x000a9f00153e0077n]]
check('虚拟机向量：128 个程序的 drip64 和原实现的回归值一致（6 个输入）', vectors.every(([input, want]) => fx.drip64(input) === want), vectors.map(([i]) => fx.drip64(i).toString(16)).join(' '))
{
  const table2 = Array.from({ length: 1024 }, (_, i) => (((i << 11) | (i >>> 21)) ^ 0xa5a55a5a) >>> 0)
  const f2 = new Hxv4Filter(PARAMS, table2)
  const st = f2.stateFor(0x1122334455667788n, 1)
  const original = Buffer.from(Array.from({ length: 200 }, (_, i) => i & 0xff))
  const data = Buffer.from(original)
  applyState(st, 7, data)
  const changed = !data.equals(original)
  applyState(st, 7, data)
  check('流过滤器对称：同一偏移加两次还原；分段取（0..90 / 90..200）和整段取一样', changed && data.equals(original) && (() => { const whole = Buffer.from(original); applyState(st, 0, whole); const a = Buffer.from(original.subarray(0, 90)); const b = Buffer.from(original.subarray(90)); applyState(st, 0, a); applyState(st, 90, b); return Buffer.concat([a, b]).equals(whole) })())
}

// ---- 合成档案 ----
const work = await mkdtemp(path.join(os.tmpdir(), 'krkr-hxv4-'))
try {
  const bundle = {
    params: PARAMS.toString('hex'),
    material: createHash('sha512').update('material').digest().toString('hex'),
    key: createHash('sha256').update('key').digest().toString('hex'),
    nonce0: createHash('sha256').update('n0').digest().subarray(0, 24).toString('hex'),
    nonce1: createHash('sha256').update('n1').digest().subarray(0, 24).toString('hex'),
  }
  const filter = Hxv4Filter.fromBundle(bundle)
  const files = [['/', 'a.scn', Buffer.from('PSB\0hello world, scene a'.repeat(30))], ['/', 'b.scn', Buffer.from('second file '.repeat(200))], ['sub', 'c.png', Buffer.alloc(5000, 7)]]
  const xp3 = buildHxv4Xp3(files, bundle)
  const file = path.join(work, 'synthetic.xp3')
  await writeFile(file, xp3)
  const arc = await openHxv4Archive(file, bundle)
  check('合成档案：打开 → 特殊索引（XChaCha20-Poly1305 + zlib + 序列化对象）解开，3 个条目都有记录', arc.entries.length === 3 && arc.special.length === 3 && arc.entries.every((e) => e.meta), `${arc.entries.length}/${arc.special.length}`)
  const outputs = []
  for (const [dir, name, plain] of files) { const e = arc.find(dir, name); outputs.push(e ? (await arc.readEntry(e)).equals(plain) : false) }
  check('合成档案：按（目录, 名字）哈希找到条目，解出明文逐字节一致（原样段 / zlib 段 / 子目录；两种 open 标志）', outputs.every(Boolean) && !arc.find('/', 'nope.scn') && !arc.find('sub', 'a.scn'), J(outputs))
  let rejected = false
  try { const e = arc.find('/', 'a.scn'); e.adler = (e.adler + 1) >>> 0; await arc.readEntry(e) } catch { rejected = true }
  check('校验和（adlr）对不上要报错，不返回错数据', rejected)
  await arc.close()
  let wrongKey = ''
  try { await openHxv4Archive(file, { ...bundle, key: '00'.repeat(32) }) } catch (error) { wrongKey = error.message }
  check('密钥包不对：特殊索引认证失败，报「解不开」而不是返回乱数据', /解不开/.test(wrongKey), wrongKey)
} finally { await rm(work, { recursive: true, force: true }) }

// ---- 真实样本（可选）----
if (process.env.KRKR_SAMPLE) {
  const [dir, bundlePath] = process.env.KRKR_SAMPLE.split(':')
  const { readFileSync } = await import('node:fs')
  const { Psb, isPsb } = await import('../../web/library/gal/psb.mjs')
  const real = JSON.parse(readFileSync(bundlePath, 'utf8'))
  const arc = await openHxv4Archive(path.join(dir, 'scn.xp3'), real)
  let ok = 0
  let named = 0
  let total = 0
  for (const e of arc.entries) {
    if (!e.meta || e.hxv4Id === 0) continue
    total += 1
    const data = await arc.readEntry(e)   // adlr 对不上会抛
    ok += 1
    if (isPsb(data) && arc.find('/', `${new Psb(data).root().name}.scn`) === e) named += 1
  }
  await arc.close()
  check(`真实样本 ${dir}：${total} 个条目全部解密并通过 adlr，PSB 自带的逻辑名都能用名字哈希找回来`, ok === total && named === total, `${ok}/${named}/${total}`)
} else console.log('SKIP 真实样本（KRKR_SAMPLE=<目录>:<密钥包.json> 才跑）')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
function J(v) { return JSON.stringify(v) }
