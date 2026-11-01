// 合成的最小 PE（只有一个 .rsrc 节，里面是图标资源）：测试 pe-icon.mjs 用。
//   buildExe({ icons: [{ w, h, png?: Buffer, dib?: Buffer, bpp }], ... }) → Buffer
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

// 资源目录：{ type: [ { id, data } ] }；三层（类型 → 名字 → 语言）
function buildRsrc(types, rsrcRva) {
  // 先排版：根目录、每个类型目录、每个名字目录、每个数据项、数据
  const typeIds = Object.keys(types).map(Number).sort((a, b) => a - b)
  const sizes = { dir: (n) => 16 + n * 8 }
  let off = sizes.dir(typeIds.length)
  const typeDirAt = {}
  for (const t of typeIds) { typeDirAt[t] = off; off += sizes.dir(types[t].length) }
  const nameDirAt = {}
  for (const t of typeIds) for (const e of types[t]) { nameDirAt[`${t}:${e.id}`] = off; off += sizes.dir(1) }
  const dataEntryAt = {}
  for (const t of typeIds) for (const e of types[t]) { dataEntryAt[`${t}:${e.id}`] = off; off += 16 }
  const dataAt = {}
  const chunks = []
  for (const t of typeIds) for (const e of types[t]) { dataAt[`${t}:${e.id}`] = off; chunks.push(e.data); off += e.data.length; if (off % 4) { chunks.push(Buffer.alloc(4 - (off % 4))); off += 4 - (off % 4) } }
  const out = []
  const dir = (entries) => Buffer.concat([Buffer.alloc(12), u16(0), u16(entries.length), ...entries.map(([id, next, isDir]) => Buffer.concat([u32(id), u32(isDir ? (next | 0x80000000) >>> 0 : next)]))])
  out.push(dir(typeIds.map((t) => [t, typeDirAt[t], true])))
  for (const t of typeIds) out.push(dir(types[t].map((e) => [e.id, nameDirAt[`${t}:${e.id}`], true])))
  for (const t of typeIds) for (const e of types[t]) out.push(dir([[1033, dataEntryAt[`${t}:${e.id}`], false]]))
  for (const t of typeIds) for (const e of types[t]) out.push(Buffer.concat([u32(rsrcRva + dataAt[`${t}:${e.id}`]), u32(e.data.length), u32(0), u32(0)]))
  return Buffer.concat([...out, ...chunks])
}

export function buildExe({ icons = [], groupId = 101 } = {}) {
  const rsrcRva = 0x1000
  const rawAt = 0x400
  const iconEntries = icons.map((icon, i) => ({ id: i + 1, data: icon.png || icon.dib }))
  const groupHead = Buffer.concat([u16(0), u16(1), u16(icons.length)])
  const groupRows = icons.map((icon, i) => Buffer.concat([Buffer.from([icon.w >= 256 ? 0 : icon.w, icon.h >= 256 ? 0 : icon.h, 0, 0]), u16(1), u16(icon.bpp || 32), u32((icon.png || icon.dib).length), u16(i + 1)]))
  const rsrc = buildRsrc({ 3: iconEntries, 14: [{ id: groupId, data: Buffer.concat([groupHead, ...groupRows]) }] }, rsrcRva)
  const dos = Buffer.alloc(0x40); dos.write('MZ'); dos.writeUInt32LE(0x40, 0x3c)
  const coff = Buffer.concat([Buffer.from('PE\0\0'), u16(0x8664), u16(1), Buffer.alloc(12), u16(240), u16(0x22)])
  const opt = Buffer.alloc(240); opt.writeUInt16LE(0x20b, 0)
  opt.writeUInt32LE(rsrcRva, 112 + 16)   // 数据目录 [2] = 资源
  opt.writeUInt32LE(rsrc.length, 112 + 20)
  const section = Buffer.alloc(40); section.write('.rsrc'); section.writeUInt32LE(rsrc.length, 8); section.writeUInt32LE(rsrcRva, 12); section.writeUInt32LE(rsrc.length, 16); section.writeUInt32LE(rawAt, 20)
  const head = Buffer.concat([dos, coff, opt, section])
  return Buffer.concat([head, Buffer.alloc(rawAt - head.length), rsrc])
}

// 32 位 DIB（自下而上 BGRA + AND 掩码），w × h
export function dib32(w, h, rgba) {
  const header = Buffer.alloc(40); header.writeUInt32LE(40, 0); header.writeInt32LE(w, 4); header.writeInt32LE(h * 2, 8); header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14)
  const pixels = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4; const d = ((h - 1 - y) * w + x) * 4; pixels[d] = rgba[s + 2]; pixels[d + 1] = rgba[s + 1]; pixels[d + 2] = rgba[s]; pixels[d + 3] = rgba[s + 3] }
  const maskRow = Math.ceil(w / 32) * 4
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * h)])
}
// 24 位 DIB + AND 掩码（掩码 1 = 透明）
export function dib24(w, h, rgb, transparent = () => false) {
  const header = Buffer.alloc(40); header.writeUInt32LE(40, 0); header.writeInt32LE(w, 4); header.writeInt32LE(h * 2, 8); header.writeUInt16LE(1, 12); header.writeUInt16LE(24, 14)
  const row = Math.ceil((w * 24) / 32) * 4
  const pixels = Buffer.alloc(row * h)
  const maskRow = Math.ceil(w / 32) * 4
  const mask = Buffer.alloc(maskRow * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 3; const d = (h - 1 - y) * row + x * 3
    pixels[d] = rgb[s + 2]; pixels[d + 1] = rgb[s + 1]; pixels[d + 2] = rgb[s]
    if (transparent(x, y)) mask[(h - 1 - y) * maskRow + (x >> 3)] |= 0x80 >> (x & 7)
  }
  return Buffer.concat([header, pixels, mask])
}
