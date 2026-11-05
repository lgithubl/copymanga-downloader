#!/usr/bin/env node
// CRI HCA / ACB：合成数据（不需要真实游戏文件）+ 可选真实样本。
//   CRI_SAMPLE=<含 .acb 的目录> 时：每个 ACB 的每个波形都解一遍（0 坏帧、有声音）；
//   CRI_REF=<clhca 参考解码器 drv 可执行文件> 时再逐样本对比（允许 ±1 LSB 的浮点差）。
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readAcb, readAfs2, readUtf } from '../../web/library/gal/cri-acb.mjs'
import { HcaDecoder, IMYS_HCA_KEY, decodeHca, pcmToWav } from '../../web/library/gal/cri-hca.mjs'

let pass = 0
let fail = 0
const J = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? String(x) : x))
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }

// —— CRC16（HCA：多项式 0x8005，大端，初值 0）——
const crc16 = (b) => { let c = 0; for (const x of b) { c ^= x << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff } return c }
const sealCrc = (b) => { const c = crc16(b.subarray(0, b.length - 2)); b.writeUInt16BE(c, b.length - 2); return b }

// —— 合成 HCA：1 声道 / 44100 / v2.00 / 帧长 128 / 全静音帧；cipher 56 时头部标签位 0x80 置位（真实文件就是这样）——
function makeHca({ frames = 4, cipher = 0, delay = 128, padding = 100, frameSize = 128 } = {}) {
  const parts = []
  const tag = (name, body) => { const t = Buffer.from(name.padEnd(4, '\0'), 'latin1'); if (cipher) for (let i = 0; i < 4; i++) t[i] |= 0x80; parts.push(Buffer.concat([t, body])) }
  const fmt = Buffer.alloc(12); fmt[0] = 1; fmt.writeUIntBE(44100, 1, 3); fmt.writeUInt32BE(frames, 4); fmt.writeUInt16BE(delay, 8); fmt.writeUInt16BE(padding, 10)
  tag('fmt', fmt)
  const comp = Buffer.alloc(12); comp.writeUInt16BE(frameSize, 0); comp[2] = 1; comp[3] = 15; comp[4] = 1; comp[5] = 0; comp[6] = 128; comp[7] = 128; comp[8] = 0; comp[9] = 0; comp[10] = 0
  tag('comp', comp)
  const ciph = Buffer.alloc(2); ciph.writeUInt16BE(cipher); tag('ciph', ciph)
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8); head.write('HCA\0', 0, 'latin1'); if (cipher) for (let i = 0; i < 3; i++) head[i] |= 0x80
  head.writeUInt16BE(0x200, 4)
  const total = 8 + body.length + 2
  head.writeUInt16BE(total, 6)
  const header = sealCrc(Buffer.concat([head, body, Buffer.alloc(2)]))
  const fr = []
  for (let i = 0; i < frames; i++) { const f = Buffer.alloc(frameSize); f.writeUInt16BE(0xffff, 0); fr.push(sealCrc(f)) }
  return Buffer.concat([header, ...fr])
}

for (const cipher of [0, 56]) {
  const buf = makeHca({ cipher })
  const dec = new HcaDecoder(buf, cipher ? IMYS_HCA_KEY : 0n)
  check(`合成 HCA 头解析（cipher ${cipher}）`, dec.h.channels === 1 && dec.h.sampleRate === 44100 && dec.h.frameCount === 4 && dec.h.frameSize === 128 && dec.h.cipherType === cipher, J(dec.h))
  const r = decodeHca(buf, cipher ? IMYS_HCA_KEY : 0n)
  check(`静音帧解出全 0、长度 = 帧数×1024−首尾 padding（cipher ${cipher}）`, r.badFrames === 0 && r.pcm.length === 4 * 1024 - 128 - 100 && r.pcm.every((v) => v === 0), `${r.pcm.length} bad=${r.badFrames}`)
}
{
  const bad = makeHca({ cipher: 0 }); bad[bad.length - 3] ^= 0xff
  const r = decodeHca(bad)
  check('帧 CRC 坏了 → 计为坏帧并补静音（不抛）', r.badFrames === 1 && r.pcm.length === 4 * 1024 - 228, `bad=${r.badFrames}`)
  const hdr = makeHca(); hdr[20] ^= 1
  let err = ''; try { new HcaDecoder(hdr) } catch (e) { err = e.message }
  check('头 CRC 坏了 → 报错', /校验/.test(err), err)
  const wav = pcmToWav({ sampleRate: 44100, channels: 1, pcm: new Int16Array([1, -2, 3]) })
  check('pcmToWav：RIFF/WAVE 头 + 数据', wav.toString('latin1', 0, 4) === 'RIFF' && wav.readUInt32LE(40) === 6 && wav.readInt16LE(46) === -2 && wav.length === 50)
}

// —— 密钥表：不同密钥给出不同的置换，0 和 255 固定 ——
{
  const tableOf = (key) => { const d = new HcaDecoder(makeHca({ cipher: 56 }), key); return d.cipher }
  const a = tableOf(IMYS_HCA_KEY), b = tableOf(IMYS_HCA_KEY + 1n)
  check('cipher56 表：0→0、255→255、是 0..255 的置换', a[0] === 0 && a[255] === 255 && new Set(a).size === 256)
  check('cipher56 表：密钥差 1 → 表不同', a.some((v, i) => v !== b[i]))
}

// —— 合成 ACB（@UTF 表 + 内嵌 AFS2）——
function utfTable(name, fields, rows) {
  // 字段全按「每行存储」；类型：u8 0 / u16 2 / u32 4 / string 0xA / data 0xB
  const strs = ['<NULL>', name]
  const sIndex = (s) => { let off = 0; for (const x of strs) { if (x === s) return off; off += Buffer.byteLength(x) + 1 } strs.push(s); return off }
  const datas = []
  const dOff = () => datas.reduce((n, d) => n + d.length, 0)
  const rowSize = fields.reduce((n, f) => n + ({ 0: 1, 2: 2, 4: 4, 0xa: 4, 0xb: 8 })[f.type], 0)
  const defs = Buffer.concat(fields.map((f) => { const b = Buffer.alloc(5); b[0] = 0x50 | f.type; b.writeUInt32BE(sIndex(f.name), 1); return b }))
  const rowBufs = rows.map((row) => Buffer.concat(fields.map((f) => {
    const v = row[f.name]; let b
    if (f.type === 0) b = Buffer.from([v]); else if (f.type === 2) { b = Buffer.alloc(2); b.writeUInt16BE(v) } else if (f.type === 4) { b = Buffer.alloc(4); b.writeUInt32BE(v) }
    else if (f.type === 0xa) { b = Buffer.alloc(4); b.writeUInt32BE(sIndex(v)) }
    else { b = Buffer.alloc(8); b.writeUInt32BE(dOff(), 0); b.writeUInt32BE(v.length, 4); datas.push(v) }
    return b
  })))
  const nameOff = sIndex(name)
  const strBuf = Buffer.concat(strs.map((s) => Buffer.concat([Buffer.from(s), Buffer.from([0])])))
  const rowsBuf = Buffer.concat(rowBufs), dataBuf = Buffer.concat(datas)
  const hdrLen = 24
  const rowOff = hdrLen + defs.length, strOff = rowOff + rowsBuf.length, dataOff = strOff + strBuf.length
  const h = Buffer.alloc(hdrLen)
  h.writeUInt16BE(1, 0); h.writeUInt16BE(rowOff, 2); h.writeUInt32BE(strOff, 4); h.writeUInt32BE(dataOff, 8); h.writeUInt32BE(nameOff, 12)
  h.writeUInt16BE(fields.length, 16); h.writeUInt16BE(rowSize, 18); h.writeUInt32BE(rows.length, 20)
  const body = Buffer.concat([h, defs, rowsBuf, strBuf, dataBuf])
  const head = Buffer.alloc(8); head.write('@UTF', 0); head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}
function afs2(entries) {
  const count = entries.length, align = 32
  const head = Buffer.alloc(16); head.write('AFS2', 0); head[4] = 1; head[5] = 4; head.writeUInt32LE(count, 8); head.writeUInt16LE(align, 12)
  const ids = Buffer.alloc(count * 2); entries.forEach((e, i) => ids.writeUInt16LE(e.id, i * 2))
  let pos = 16 + count * 2 + (count + 1) * 4
  const offs = []; const blobs = []
  for (const e of entries) { const s = Math.ceil(pos / align) * align; blobs.push(Buffer.concat([Buffer.alloc(s - pos), e.data])); offs.push(s); pos = s + e.data.length }
  offs.push(pos)
  const offBuf = Buffer.alloc((count + 1) * 4); offs.forEach((o, i) => offBuf.writeUInt32LE(o, i * 4))
  return Buffer.concat([head, ids, offBuf, ...blobs])
}
{
  const hcaA = makeHca({ cipher: 56, frames: 2 }), hcaB = makeHca({ cipher: 56, frames: 3 })
  const awb = afs2([{ id: 0, data: hcaA }, { id: 1, data: hcaB }])
  const synthItems = (idx) => { const b = Buffer.alloc(4); b.writeUInt16BE(1, 0); b.writeUInt16BE(idx, 2); return b }
  const top = utfTable('Header', [
    { name: 'CueNameTable', type: 0xb }, { name: 'CueTable', type: 0xb }, { name: 'SynthTable', type: 0xb }, { name: 'WaveformTable', type: 0xb }, { name: 'AwbFile', type: 0xb },
  ], [{
    CueNameTable: utfTable('CueName', [{ name: 'CueName', type: 0xa }, { name: 'CueIndex', type: 2 }], [{ CueName: 'amv001_x_00010', CueIndex: 1 }, { CueName: 'amv001_x_00020', CueIndex: 0 }]),
    CueTable: utfTable('Cue', [{ name: 'ReferenceType', type: 0 }, { name: 'ReferenceIndex', type: 2 }], [{ ReferenceType: 3, ReferenceIndex: 0 }, { ReferenceType: 3, ReferenceIndex: 1 }]),
    SynthTable: utfTable('Synth', [{ name: 'ReferenceItems', type: 0xb }], [{ ReferenceItems: synthItems(0) }, { ReferenceItems: synthItems(1) }]),
    WaveformTable: utfTable('Waveform', [{ name: 'MemoryAwbId', type: 2 }, { name: 'Streaming', type: 0 }], [{ MemoryAwbId: 0, Streaming: 0 }, { MemoryAwbId: 1, Streaming: 0 }]),
    AwbFile: awb,
  }])
  const utf = readUtf(top)
  check('@UTF 表解析：表名 / 行数 / data 字段', utf.name === 'Header' && utf.rows.length === 1 && Buffer.isBuffer(utf.rows[0].AwbFile))
  check('AFS2：id / 内容', readAfs2(awb).length === 2 && readAfs2(awb)[1].data.equals(hcaB))
  const acb = readAcb(top)
  const byName = Object.fromEntries(acb.cues.map((c) => [c.name, c.waveIds]))
  check('ACB：cue 名 → 波形 id（CueIndex 反过来对应）', J(byName) === J({ amv001_x_00010: [1], amv001_x_00020: [0] }), J(byName))
  check('ACB：波形取到 HCA 且能解', decodeHca(acb.waves.get(1), IMYS_HCA_KEY).pcm.length === 3 * 1024 - 228)
}

// —— 真实样本（可选）——
if (process.env.CRI_SAMPLE) {
  const acbs = []
  const walk = async (d) => { for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (/\.acb$/i.test(e.name)) acbs.push(p) } }
  await walk(process.env.CRI_SAMPLE)
  let waves = 0, bad = 0, silent = 0, refDiff = 0, refChecked = 0
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cri-'))
  for (const f of acbs) {
    const acb = readAcb(await readFile(f))
    for (const [id, hca] of acb.waves) {
      waves += 1
      const t = new HcaDecoder(hca, IMYS_HCA_KEY).testKey()
      if (t.bad || !t.good) bad += 1
      const r = decodeHca(hca, IMYS_HCA_KEY)
      if (r.badFrames || !r.pcm.some((v) => Math.abs(v) > 500)) silent += 1
      if (process.env.CRI_REF) {
        const hf = path.join(tmp, 'x.hca'), of = path.join(tmp, 'x.pcm')
        await writeFile(hf, hca)
        execFileSync(process.env.CRI_REF, [hf, String(IMYS_HCA_KEY), of], { stdio: 'ignore' })
        const ref = await readFile(of); const refPcm = new Int16Array(ref.buffer, ref.byteOffset, ref.length >> 1)
        const off = new HcaDecoder(hca, IMYS_HCA_KEY).h.encoderDelay
        let max = 0; for (let i = 0; i < r.pcm.length; i++) max = Math.max(max, Math.abs(r.pcm[i] - refPcm[off + i]))
        refChecked += 1; if (max > 1) refDiff += 1
      }
    }
  }
  await rm(tmp, { recursive: true, force: true })
  check(`真实样本：${acbs.length} 个 ACB / ${waves} 个波形，密钥校验全通过（TestBlock 等价：好帧 > 0、坏帧 = 0）`, waves > 0 && bad === 0, `bad=${bad}`)
  check('真实样本：0 坏帧、有可闻信号', silent === 0, `silent=${silent}`)
  if (process.env.CRI_REF) check(`真实样本对照参考实现（${refChecked} 个，最大差 ≤ 1 LSB）`, refChecked > 0 && refDiff === 0, `diff=${refDiff}`)
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
