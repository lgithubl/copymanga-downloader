#!/usr/bin/env node
// 自测（纯 node）：exe 图标提取（pe-icon.mjs）——合成的最小 PE：PNG 图标取最大一档、32 位 DIB（带 alpha）、24 位 DIB + AND 掩码、没有资源 / 不是 PE → null。
//   node scripts/dev/gal-pe-icon-selftest.mjs
//   PE_SAMPLE_EXE=<真实 exe> node …   再多检查一个真实 exe 能取出图标
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { encodePng } from '../../web/library/gal/bgi.mjs'
import { extractExeIcon } from '../../web/library/gal/pe-icon.mjs'
import { buildExe, dib24, dib32 } from './make-pe-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-pe-'))
const J = JSON.stringify
const solid = (w, h, [r, g, b, a = 255]) => { const px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = a } return px }
const decode = (png) => {
  const w = png.readUInt32BE(16); const h = png.readUInt32BE(20); const ct = png[25]
  const idat = []; let p = 8
  while (p < png.length) { const len = png.readUInt32BE(p); if (png.subarray(p + 4, p + 8).toString() === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len)); p += 12 + len }
  const raw = inflateSync(Buffer.concat(idat)); const ch = { 2: 3, 6: 4 }[ct]
  const out = Buffer.alloc(w * h * ch); for (let y = 0; y < h; y++) raw.copy(out, y * w * ch, y * (w * ch + 1) + 1, (y + 1) * (w * ch + 1))
  return { w, h, ch, out }
}
const file = async (name, buf) => { const f = path.join(work, name); await writeFile(f, buf); return f }

{
  const big = encodePng(256, 256, 4, solid(256, 256, [200, 30, 30]))
  const small = encodePng(16, 16, 4, solid(16, 16, [30, 30, 200]))
  const png = await extractExeIcon(await file('png.exe', buildExe({ icons: [{ w: 16, h: 16, png: small }, { w: 256, h: 256, png: big }] })))
  check('PNG 图标：多档里取最大的（256 的那张，原样输出）', png && png.equals(big), png && J([png.readUInt32BE(16), png.length]))
}
{
  const rgba = solid(32, 32, [10, 200, 10, 255]); for (let x = 0; x < 32; x++) rgba[(0 * 32 + x) * 4 + 3] = 0   // 第一行全透明
  const png = await extractExeIcon(await file('dib32.exe', buildExe({ icons: [{ w: 32, h: 32, dib: dib32(32, 32, rgba), bpp: 32 }] })))
  const d = png && decode(png)
  check('32 位 DIB 图标（带 alpha）→ PNG：尺寸对、颜色（BGRA → RGBA）对、第一行透明（自下而上翻回来了）', d && d.w === 32 && d.h === 32 && d.out[(5 * 32 + 5) * 4] === 10 && d.out[(5 * 32 + 5) * 4 + 1] === 200 && d.out[(5 * 32 + 5) * 4 + 3] === 255 && d.out[3] === 0, d && J([d.w, d.h, [...d.out.subarray(0, 4)], [...d.out.subarray((5 * 32 + 5) * 4, (5 * 32 + 5) * 4 + 4)]]))
}
{
  const rgb = Buffer.alloc(16 * 16 * 3); for (let i = 0; i < 16 * 16; i++) { rgb[i * 3] = 250; rgb[i * 3 + 1] = 100; rgb[i * 3 + 2] = 20 }
  const png = await extractExeIcon(await file('dib24.exe', buildExe({ icons: [{ w: 16, h: 16, dib: dib24(16, 16, rgb, (x) => x < 8), bpp: 24 }] })))
  const d = png && decode(png)
  check('24 位 DIB + AND 掩码：左半透明、右半不透明（颜色 RGB 对）', d && d.out[(3 * 16 + 2) * 4 + 3] === 0 && d.out[(3 * 16 + 12) * 4 + 3] === 255 && d.out[(3 * 16 + 12) * 4] === 250 && d.out[(3 * 16 + 12) * 4 + 2] === 20, d && J([...d.out.subarray((3 * 16 + 2) * 4, (3 * 16 + 2) * 4 + 4), ...d.out.subarray((3 * 16 + 12) * 4, (3 * 16 + 12) * 4 + 4)]))
}
check('没有图标资源的 PE / 不是 PE / 太小的文件 → null（不抛错）', (await extractExeIcon(await file('none.exe', buildExe({ icons: [] })))) === null && (await extractExeIcon(await file('notpe.exe', Buffer.from('hello world, not a pe file at all....')))) === null && (await extractExeIcon(await file('tiny.exe', Buffer.from('MZ')))) === null)
if (process.env.PE_SAMPLE_EXE) { const png = await extractExeIcon(process.env.PE_SAMPLE_EXE); check(`真实 exe（${process.env.PE_SAMPLE_EXE}）能取出图标`, Boolean(png), String(png)) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
