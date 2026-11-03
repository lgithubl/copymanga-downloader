// 合成的 Liar-soft codeX RScript 夹具（自测用）：XFL 档案、GSC 程序（带一个小汇编器）、带 Vorbis ACM 外壳的 WAVE
import { RSCRIPT_LAYOUTS } from '../../web/library/gal/rscript-gsc.mjs'

const SIZE = { u16: 2, i16: 2, u32: 4, value: 4, string: 4, label: 4, target: 4, array: 4 }
const cp932 = (text) => Buffer.from(new TextEncoder().encode(text))   // 夹具里的字符串都用 ASCII（CP932 的 ASCII 部分和 UTF-8 一样）；日文用 encodeSjis

// 小汇编器：prog = [{ op, args }]；args 的取值：数字 = 原样；{ str: '文本' } = 字符串表下标；{ label: '名字' } = 代码偏移（前向引用也行）；{ at: '名字' } 不是指令，是定义标签
export function assemble(items, { labels = [] } = {}) {
  const strings = ['']
  const strIndex = (text) => { let i = strings.indexOf(text); if (i < 0) { strings.push(text); i = strings.length - 1 } return i }
  const positions = new Map()
  const encode = (resolve) => {
    const out = []
    const push16 = (v) => { out.push(v & 0xff, (v >>> 8) & 0xff) }
    const push32 = (v) => { out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff) }
    for (const item of items) {
      if (item.at) { positions.set(item.at, out.length); continue }
      const { op, args = [] } = item
      push16(op)
      if ((op & 0xf000) !== 0) { push16(args[0]); push16(args[1] & 0xffff); if ((op & 0xf000) !== 0xf000) push16(args[2] & 0xffff); continue }
      const layout = RSCRIPT_LAYOUTS.get(op)
      layout.forEach((kind, i) => {
        const a = args[i] ?? 0
        let v = typeof a === 'object' ? (a.str !== undefined ? strIndex(a.str) : a.label !== undefined ? resolve(a.label) : 0) : a
        if (kind === 'value') v = (v & 0xffff) >>> 0
        if (SIZE[kind] === 2) push16(v); else push32(v)
      })
    }
    return Buffer.from(out)
  }
  encode(() => 0)   // 第一遍：算标签位置
  const code = encode((name) => positions.get(name) ?? 0)
  const stringBytes = strings.map((s) => Buffer.concat([cp932(s), Buffer.from([0])]))
  const stringIndex = Buffer.alloc(strings.length * 4)
  let off = 0
  stringBytes.forEach((b, i) => { stringIndex.writeUInt32LE(off, i * 4); off += b.length })
  const stringData = Buffer.concat(stringBytes)
  const labelList = [{ name: '', offset: 0 }, ...labels.map((name) => ({ name, offset: positions.get(name) ?? 0 }))]
  const labelNames = Buffer.alloc(labelList.length * 4)
  const labelOffsets = Buffer.alloc(labelList.length * 4)
  const labelBytes = labelList.map((l) => Buffer.concat([cp932(l.name), Buffer.from([0])]))
  let lo = 0
  labelList.forEach((l, i) => { labelNames.writeUInt32LE(lo, i * 4); labelOffsets.writeUInt32LE(l.offset, i * 4); lo += labelBytes[i].length })
  const labelData = Buffer.concat(labelBytes)
  const arrayIndex = Buffer.alloc(4)
  const arrayData = Buffer.alloc(0)
  const header = Buffer.alloc(36)
  const body = [code, stringIndex, stringData, arrayIndex, arrayData, labelNames, labelOffsets, labelData]
  const total = 36 + body.reduce((n, b) => n + b.length, 0)
  const sizes = [total, 36, code.length, stringIndex.length, stringData.length, arrayIndex.length, arrayData.length / 2, labelNames.length, labelData.length]
  sizes.forEach((v, i) => header.writeUInt32LE(v, i * 4))
  return Buffer.concat([header, ...body])
}

// LB 档案：entries = [[名字, Buffer]…]
export function buildXfl(entries) {
  const head = Buffer.alloc(12)
  head[0] = 0x4c; head[1] = 0x42; head[2] = 1
  head.writeUInt32LE(entries.length * 40, 4); head.writeUInt32LE(entries.length, 8)
  const table = Buffer.alloc(entries.length * 40)
  let off = 0
  entries.forEach(([name, data], i) => { Buffer.from(name, 'latin1').copy(table, i * 40); table.writeUInt32LE(off, i * 40 + 32); table.writeUInt32LE(data.length, i * 40 + 36); off += data.length })
  return Buffer.concat([head, table, ...entries.map(([, d]) => d)])
}

// 带 Vorbis ACM 外壳的 WAVE（fmt 标签 0x6771）：data 里放一段 "OggS…"；pcm = true 时做 PCM（标签 1）
export function buildRiff(payload, { pcm = false } = {}) {
  const fmt = Buffer.alloc(26)
  fmt.writeUInt16LE(pcm ? 1 : 0x6771, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(44100, 4)
  const chunk = (id, data) => { const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]) }
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('fact', Buffer.alloc(4)), chunk('data', payload)])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(body.length, 4)
  return Buffer.concat([riff, body])
}
