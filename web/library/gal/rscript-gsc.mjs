// Liar-soft codeX RScript 的容器和脚本格式（移植自 vn-web-engine 的 src/formats/rscript，MIT）：
//   · XFL（.xfl，'LB' 档案）：'LB' 01 00 + u32 目录字节数 + u32 条目数 + 条目 × 40（名字 32 字节 CP932 + u32 偏移（从目录之后起算）+ u32 大小）
//   · GSC（.gsc，编译过的脚本）：9 个 dword 的头 + 代码 / 字符串索引 / 字符串 / 数组索引 / 数组 / 标签名索引 / 标签偏移 / 标签名
//   · 指令：u16 操作码；高 4 位非 0 = 表达式（目的寄存器 + 1~2 个 16 位操作数）；其余按操作码表（RSCRIPT_LAYOUTS）读操作数
// 操作数种类：u16 / i16 / u32 / value（32 位：低 16 位带符号值，高 16 位 = 经变量间接几次）/ string（字符串表下标）/ label（字符串表下标，指向标签名）/ target（代码绝对偏移）/ array
const V = 'value'
const rep = (kind, n) => Array.from({ length: n }, () => kind)
const vals = (n) => rep(V, n)
// RScript 1.11.0.3 的分派表（0x422FD0）；1.9 少几个、几个不同（见下面的 RSCRIPT_1_9_LAYOUTS）
export const RSCRIPT_LAYOUTS = new Map([
  [0x03, ['target']], [0x04, ['target']], [0x05, ['target']], [0x08, []], [0x09, ['u16']], [0x0a, []], [0x0b, []],
  [0x0c, [V, 'label']], [0x0d, [V]],
  [0x0e, ['u16', 'string', ...rep('target', 5), ...rep('string', 5), ...vals(3)]],
  [0x0f, [V, 'label', ...vals(10)]], [0x10, [V]], [0x11, []], [0x12, [V, 'array']], [0x13, [V]],
  [0x14, vals(2)], [0x15, vals(1)], [0x16, vals(4)], [0x17, vals(4)], [0x18, vals(2)], [0x19, ['string', V]], [0x1a, []], [0x1b, []],
  [0x1c, vals(3)], [0x1d, vals(2)], [0x1e, vals(6)], [0x20, [...vals(5), 'string']], [0x21, vals(5)], [0x22, vals(5)],
  [0x23, vals(2)], [0x24, vals(2)], [0x25, vals(2)], [0x26, vals(4)], [0x27, vals(3)], [0x28, vals(2)], [0x29, vals(2)],
  [0x2a, vals(2)], [0x2b, vals(2)], [0x2c, vals(1)], [0x2d, vals(2)], [0x2e, vals(1)], [0x2f, vals(2)], [0x30, vals(3)], [0x31, vals(2)],
  [0x32, []], [0x33, []], [0x34, []], [0x35, vals(1)], [0x37, []], [0x38, vals(5)], [0x39, []], [0x3a, []],
  [0x3b, vals(4)], [0x3c, vals(3)], [0x3d, vals(2)], [0x3e, vals(2)], [0x3f, vals(4)], [0x40, vals(2)], [0x41, vals(1)],
  [0x42, ['u32', V, V, V]], [0x43, vals(1)], [0x44, []], [0x45, []], [0x46, vals(4)], [0x47, vals(4)], [0x48, vals(1)], [0x49, vals(3)],
  [0x4a, vals(1)], [0x4b, vals(5)], [0x4d, vals(4)], [0x50, vals(1)],
  [0x51, [V, 'u32', V, V, 'u32', 'u32', V]], [0x52, [V, V, V, V, 'u32', V]], [0x53, vals(1)], [0x54, [V, 'string']],
  [0x5a, vals(3)], [0x5b, vals(5)], [0x5c, vals(2)], [0x5d, vals(2)], [0x5e, vals(1)], [0x5f, vals(2)], [0x60, vals(2)], [0x61, vals(2)], [0x62, vals(2)],
  [0x63, vals(3)], [0x64, vals(3)], [0x65, vals(2)], [0x66, vals(1)], [0x67, vals(2)], [0x68, vals(4)], [0x69, vals(2)], [0x6a, vals(5)], [0x6b, vals(3)], [0x6c, vals(4)],
  [0x6e, vals(3)], [0x6f, vals(3)], [0x70, vals(1)], [0x71, vals(2)], [0x72, vals(2)], [0x73, vals(2)], [0x74, vals(2)], [0x75, vals(2)], [0x78, vals(2)], [0x79, [V, 'string']],
  [0x82, vals(4)], [0x83, vals(5)], [0x84, vals(2)], [0x86, vals(3)], [0x87, vals(5)], [0x88, vals(3)], [0x8c, vals(2)], [0x8d, vals(2)], [0x8e, vals(2)],
  [0x96, [V, 'string']], [0x97, [V, 'string']], [0x98, vals(2)], [0x99, vals(2)], [0x9a, vals(2)], [0x9b, vals(2)], [0x9c, vals(3)], [0x9d, vals(5)], [0x9e, vals(2)], [0x9f, vals(2)],
  [0xc8, ['target', ...vals(10)]], [0xc9, vals(5)], [0xca, vals(3)], [0xd2, ['target', V]], [0xd3, ['target', V, V, V]], [0xd4, ['target']], [0xd5, vals(3)],
  [0xdc, vals(3)], [0xdd, vals(2)], [0xde, []], [0xdf, vals(2)], [0xe1, vals(5)], [0xe6, vals(1)], [0xe7, vals(1)], [0xff, vals(5)],
])
export const RSCRIPT_1_9_LAYOUTS = new Map([
  ...[...RSCRIPT_LAYOUTS].filter(([op]) => ![0x54, 0x6a, 0x6b, 0x6c, 0x8c, 0x8d, 0x8e].includes(op)),
  [0x3e, vals(1)], [0x3f, vals(3)], [0x40, vals(1)], [0x42, vals(4)],
])
const SIZE = { u16: 2, i16: 2, u32: 4, value: 4, string: 4, label: 4, target: 4, array: 4 }
export const isExpression = (opcode) => (opcode & 0xf000) !== 0

// ---- XFL ----
export function parseXfl(buf) {
  if (buf.length < 12 || buf[0] !== 0x4c || buf[1] !== 0x42 || buf[2] !== 1) throw new Error('不是 XFL 档案')
  const count = buf.readUInt32LE(8)
  const base = 12 + count * 40
  if (base > buf.length) throw new Error('XFL 目录超出文件')
  const decoder = new TextDecoder('shift-jis')
  const entries = []
  for (let i = 0; i < count; i += 1) {
    const p = 12 + i * 40
    const field = buf.subarray(p, p + 32)
    const end = field.indexOf(0)
    if (end <= 0) throw new Error(`XFL 条目 ${i}：名字无效`)
    entries.push({ index: i, name: decoder.decode(field.subarray(0, end)), offset: base + buf.readUInt32LE(p + 32), size: buf.readUInt32LE(p + 36) })
  }
  return { entries, base }
}

// ---- GSC ----
export function parseGsc(buf) {
  if (buf.length < 36) throw new Error('GSC 太短')
  const h = Array.from({ length: 9 }, (_, i) => buf.readUInt32LE(i * 4))
  const [fileSize, headerSize, codeSize, stringIndexSize, stringSize, arrayIndexSize, arrayWords, labelIndexSize, labelSize] = h
  if (headerSize !== 36 || fileSize !== buf.length) throw new Error('GSC 头不对')
  if (stringIndexSize % 4 || arrayIndexSize % 4 || labelIndexSize % 4) throw new Error('GSC 索引没对齐')
  let cursor = headerSize
  const section = (size) => { if (cursor + size > buf.length) throw new Error('GSC 节超出文件'); const r = buf.subarray(cursor, cursor + size); cursor += size; return r }
  const code = section(codeSize)
  const stringIndex = section(stringIndexSize)
  const stringData = section(stringSize)
  const arrayIndex = section(arrayIndexSize)
  const arrayData = section(arrayWords * 2)
  const labelNames = section(labelIndexSize)
  const labelOffsets = section(labelIndexSize)
  const labelData = section(labelSize)
  if (cursor !== buf.length) throw new Error('GSC 节大小和文件对不上')
  const cstr = (data, off) => { if (off >= data.length) throw new Error('GSC 字符串偏移超出'); const end = data.indexOf(0, off); if (end < 0) throw new Error('GSC 字符串没结尾'); return data.subarray(off, end) }
  const u32 = (data, i) => data.readUInt32LE(i * 4)
  const strings = Array.from({ length: stringIndexSize / 4 }, (_, i) => cstr(stringData, u32(stringIndex, i)))
  const arrays = Array.from({ length: arrayIndexSize / 4 }, (_, i) => {
    const start = u32(arrayIndex, i)
    if (start >= arrayWords) return []
    const length = arrayData.readInt16LE(start * 2)
    if (length < 0 || start + 1 + length > arrayWords) throw new Error('GSC 数组无效')
    return Array.from({ length }, (_, j) => arrayData.readInt16LE((start + 1 + j) * 2))
  })
  const labels = Array.from({ length: labelIndexSize / 4 }, (_, i) => ({ name: i ? cstr(labelData, u32(labelNames, i)) : Buffer.alloc(0), offset: u32(labelOffsets, i) }))
  return { code, strings, arrays, labels }
}

// 解一条指令 → { offset, opcode, operands, next }；未知操作码抛错
export function decodeInstruction(code, offset, layouts = RSCRIPT_LAYOUTS) {
  if (offset + 2 > code.length) throw new Error('GSC 指令超出代码')
  const opcode = code.readUInt16LE(offset)
  let cursor = offset + 2
  const operands = []
  const take = (kind) => {
    const size = SIZE[kind]
    if (cursor + size > code.length) throw new Error('GSC 操作数超出代码')
    operands.push(kind === 'i16' ? code.readInt16LE(cursor) : size === 2 ? code.readUInt16LE(cursor) : code.readUInt32LE(cursor))
    cursor += size
  }
  if (isExpression(opcode)) { take('u16'); take('i16'); if ((opcode & 0xf000) !== 0xf000) take('i16') } else {
    const layout = layouts.get(opcode)
    if (!layout) throw new Error(`未知 GSC 操作码 0x${opcode.toString(16)}（偏移 0x${offset.toString(16)}）`)
    for (const kind of layout) take(kind)
  }
  return { offset, opcode, operands, next: cursor }
}

// 读 XFL 的目录（只读头 + 目录，不读数据）→ { size, entries: [{ name, offset, size }] }（offset 已经是文件里的绝对偏移）
export async function readXflIndex(file, { offset = 0, length = 0 } = {}) {
  const { open } = await import('node:fs/promises')
  const handle = await open(file, 'r')
  try {
    const { size: fileSize } = await handle.stat()
    const size = length || fileSize - offset   // 嵌套的 xfl（voice.xfl 里的 1.xfl / 2.xfl 是语音分库）：offset / length 指它在外层文件里的位置
    const head = Buffer.alloc(12)
    await handle.read(head, 0, 12, offset)
    if (head[0] !== 0x4c || head[1] !== 0x42 || head[2] !== 1) throw new Error('不是 XFL 档案')
    const count = head.readUInt32LE(8)
    if (count > 1000000 || 12 + count * 40 > size) throw new Error(`XFL 条目数 ${count} 不合理`)
    const table = Buffer.alloc(count * 40)
    let done = 0
    while (done < table.length) { const r = await handle.read(table, done, table.length - done, offset + 12 + done); if (!r.bytesRead) throw new Error('XFL 目录读不全'); done += r.bytesRead }
    const decoder = new TextDecoder('shift-jis')
    const base = offset + 12 + count * 40
    const entries = []
    for (let i = 0; i < count; i += 1) {
      const p = i * 40
      const end = table.subarray(p, p + 32).indexOf(0)
      if (end <= 0) continue
      entries.push({ name: decoder.decode(table.subarray(p, p + end)), offset: base + table.readUInt32LE(p + 32), size: table.readUInt32LE(p + 36) })
    }
    return { size, entries, key: null }
  } finally { await handle.close() }
}

// 带 Vorbis ACM 外壳的 WAVE（fmt 标签 0x674f / 0x6750 / 0x6751 / 0x676f / 0x6770 / 0x6771）：data 块里就是完整的 Ogg Vorbis 流，取出来就能播；别的（PCM 等）原样返回
const VORBIS_TAGS = new Set([0x674f, 0x6750, 0x6751, 0x676f, 0x6770, 0x6771])
export function riffVorbisToOgg(data) {
  if (data.length < 12 || data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 12) !== 'WAVE') return data
  let tag = 0
  for (let p = 12; p + 8 <= data.length;) {
    const id = data.toString('latin1', p, p + 4)
    const size = data.readUInt32LE(p + 4)
    if (id === 'fmt ' && size >= 2) tag = data.readUInt16LE(p + 8)
    if (id === 'data') return VORBIS_TAGS.has(tag) && data.toString('latin1', p + 8, p + 12) === 'OggS' ? data.subarray(p + 8, Math.min(data.length, p + 8 + size)) : data
    p += 8 + size + (size & 1)
  }
  return data
}
export const isVorbisRiff = (head) => head.length >= 24 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE' && head.toString('latin1', 12, 16) === 'fmt ' && VORBIS_TAGS.has(head.readUInt16LE(20))
