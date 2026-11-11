// 从 Windows exe（PE）里取图标当封面：读资源目录里的 RT_GROUP_ICON / RT_ICON，取最大的一档，输出 PNG。
// 依据：自己在 4 个真实游戏 exe 上核对过（都是 256×256 的 32 位 PNG 图标，另有 128 / 64 / 48 / 32 / 24 / 16 几档）；老 exe 里是 BMP（DIB）格式的图标，这里也认（32 / 24 / 8 位，带 AND 掩码）。
// 只读头和 .rsrc 节（上限 48MB），不会把整个 exe 读进来。找不到资源 / 格式不认识返回 null。
import { open } from 'node:fs/promises'
import { encodePng } from './bgi.mjs'

const MAX_RSRC = 48 * 1024 * 1024
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function readAt(handle, offset, length) {
  const buffer = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, offset + done)
    if (!bytesRead) return buffer.subarray(0, done)
    done += bytesRead
  }
  return buffer
}

// DIB（ICO 里的位图）→ PNG：BITMAPINFOHEADER，高度 = 图 + AND 掩码的两倍；自下而上
function dibToPng(dib) {
  if (dib.length < 40 || dib.readUInt32LE(0) < 40) return null
  const width = dib.readInt32LE(4)
  const height = dib.readInt32LE(8) / 2
  const bpp = dib.readUInt16LE(14)
  const compression = dib.readUInt32LE(16)
  if (compression !== 0 || width <= 0 || width > 1024 || height <= 0 || height > 1024 || !Number.isInteger(height)) return null
  const headSize = dib.readUInt32LE(0)
  const colors = bpp <= 8 ? (dib.readUInt32LE(32) || 1 << bpp) : 0
  const palette = headSize + colors * 4
  const rowSize = (Math.ceil((width * bpp) / 32)) * 4
  const maskRow = (Math.ceil(width / 32)) * 4
  const pixelsAt = palette
  const maskAt = pixelsAt + rowSize * height
  if (![8, 24, 32].includes(bpp) || maskAt > dib.length) return null
  const out = Buffer.alloc(width * height * 4)
  let hasAlpha = false
  for (let y = 0; y < height; y++) {
    const src = pixelsAt + (height - 1 - y) * rowSize
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (bpp === 32) { out[o] = dib[src + x * 4 + 2]; out[o + 1] = dib[src + x * 4 + 1]; out[o + 2] = dib[src + x * 4]; out[o + 3] = dib[src + x * 4 + 3]; if (out[o + 3]) hasAlpha = true }
      else if (bpp === 24) { out[o] = dib[src + x * 3 + 2]; out[o + 1] = dib[src + x * 3 + 1]; out[o + 2] = dib[src + x * 3]; out[o + 3] = 255 }
      else { const p = headSize + dib[src + x] * 4; out[o] = dib[p + 2]; out[o + 1] = dib[p + 1]; out[o + 2] = dib[p]; out[o + 3] = 255 }
    }
  }
  if (!hasAlpha || bpp !== 32) {   // 没有 alpha 通道（或不是 32 位）：用 AND 掩码决定透明
    for (let y = 0; y < height; y++) {
      const m = maskAt + (height - 1 - y) * maskRow
      for (let x = 0; x < width; x++) if ((dib[m + (x >> 3)] >> (7 - (x & 7))) & 1) out[(y * width + x) * 4 + 3] = 0; else if (bpp === 32) out[(y * width + x) * 4 + 3] = 255
    }
  }
  return encodePng(width, height, 4, out)
}

// Standalone ICO uses the same PNG/DIB payloads as PE icon resources.
export function decodeIco(bytes){
 if(bytes.length<6||bytes.readUInt16LE(0)!==0||bytes.readUInt16LE(2)!==1)return null
 const count=bytes.readUInt16LE(4);if(!count||count>256||6+count*16>bytes.length)return null
 const entries=Array.from({length:count},(_,i)=>{const p=6+i*16;return{width:bytes[p]||256,height:bytes[p+1]||256,size:bytes.readUInt32LE(p+8),offset:bytes.readUInt32LE(p+12)}}).sort((a,b)=>b.width*b.height-a.width*a.height)
 for(const e of entries){if(e.offset<6+count*16||e.offset+e.size>bytes.length)continue;const b=bytes.subarray(e.offset,e.offset+e.size);if(b.subarray(0,8).equals(PNG_SIG))return b;const png=dibToPng(b);if(png)return png}
 return null
}
// → PNG Buffer | null
export async function extractExeIcon(file) {
  const handle = await open(file, 'r')
  try {
    const head = await readAt(handle, 0, 4096)
    if (head.length < 0x40 || head.readUInt16LE(0) !== 0x5a4d) return null
    const pe = head.readUInt32LE(0x3c)
    const peHead = await readAt(handle, pe, 0x200)
    if (peHead.length < 0x100 || peHead.readUInt32LE(0) !== 0x4550) return null
    const sections = peHead.readUInt16LE(6)
    const optSize = peHead.readUInt16LE(20)
    const magic = peHead.readUInt16LE(24)
    const dirAt = 24 + (magic === 0x20b ? 112 : 96) + 16
    const rsrcRva = peHead.readUInt32LE(dirAt)
    if (!rsrcRva) return null
    const table = await readAt(handle, pe + 24 + optSize, sections * 40)
    let sec = null
    for (let i = 0; i < sections; i++) {
      const row = table.subarray(i * 40, i * 40 + 40)
      const va = row.readUInt32LE(12)
      const vsize = row.readUInt32LE(8)
      const rawSize = row.readUInt32LE(16)
      const rawAt = row.readUInt32LE(20)
      if (rsrcRva >= va && rsrcRva < va + Math.max(vsize, rawSize)) { sec = { va, rawAt, rawSize }; break }
    }
    if (!sec || sec.rawSize > MAX_RSRC || sec.rawSize < 16) return null
    const data = await readAt(handle, sec.rawAt, sec.rawSize)
    const base = rsrcRva - sec.va
    const at = (rva) => rva - sec.va
    const entries = (o) => {
      if (o < 0 || o + 16 > data.length) return []
      const named = data.readUInt16LE(o + 12)
      const ids = data.readUInt16LE(o + 14)
      const out = []
      for (let i = 0; i < named + ids && o + 16 + i * 8 + 8 <= data.length; i++) out.push({ id: data.readUInt32LE(o + 16 + i * 8), next: data.readUInt32LE(o + 20 + i * 8) })
      return out
    }
    const leaf = (e) => {   // 目录项 → 数据 { bytes }
      let node = e
      for (let depth = 0; depth < 3 && node && (node.next & 0x80000000); depth++) {
        const sub = entries(base + (node.next & 0x7fffffff))
        node = sub[0]
      }
      if (!node || (node.next & 0x80000000)) return null
      const de = base + node.next
      if (de + 8 > data.length) return null
      const rva = data.readUInt32LE(de)
      const size = data.readUInt32LE(de + 4)
      const off = at(rva)
      return off >= 0 && off + size <= data.length ? data.subarray(off, off + size) : null
    }
    const types = entries(base)
    const groupType = types.find((e) => e.id === 14)
    const iconType = types.find((e) => e.id === 3)
    if (!groupType || !iconType) return null
    const icons = new Map()
    for (const e of entries(base + (iconType.next & 0x7fffffff))) { const bytes = leaf(e); if (bytes) icons.set(e.id, bytes) }
    // 第一个图标组（应用图标）：按尺寸从大到小试，认得的第一个就用
    const groups = entries(base + (groupType.next & 0x7fffffff))
    for (const g of groups) {
      const bytes = leaf(g)
      if (!bytes || bytes.length < 6) continue
      const count = bytes.readUInt16LE(4)
      const list = []
      for (let i = 0; i < count && 6 + i * 14 + 14 <= bytes.length; i++) {
        const row = bytes.subarray(6 + i * 14, 6 + i * 14 + 14)
        list.push({ w: row[0] || 256, bpp: row.readUInt16LE(6), id: row.readUInt16LE(12) })
      }
      list.sort((a, b) => b.w - a.w || b.bpp - a.bpp)
      for (const item of list) {
        const image = icons.get(item.id)
        if (!image) continue
        if (image.subarray(0, 8).equals(PNG_SIG)) return image
        const png = dibToPng(image)
        if (png) return png
      }
    }
    return null
  } finally { await handle.close() }
}
