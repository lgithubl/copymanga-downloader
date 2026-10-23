#!/usr/bin/env node
// 造一批「样式压力」媒体库条目（压缩包图集类型，直接写进数据目录，不需要真的 zip）：
//   node scripts/dev/make-style-stress-fixture.mjs <数据目录> [数量=120]
// 覆盖：极长标题（中日文无空格 / 长 ASCII 无空格 / URL / emoji / 带 HTML 字符）、很多标签（最多 60 个）+ 很长的标签（150 字无空格）、
// 各种尺寸比例的封面（1x1、16x16、超宽 1600x200、超高 200x2400、大图 3000x2000…）、没有封面、标题为空。
// 用来看卡片 / 详情 / 标签条 / 悬停预览 / 左右收缩箭头 在各种极端内容下会不会撑破布局。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { createArchiveGalleryHandler } from '../../web/library/types/archive-gallery.mjs'

export const COVER_SIZES = [[160, 220], [1, 1], [16, 16], [100, 100], [400, 566], [1600, 200], [200, 2400], [3000, 2000], [800, 800], [566, 400], [60, 1200], [2400, 60]]
const han = '拷贝漫画下载器媒体库标题压力测试超长文本没有空格的情况下也不能撑破卡片布局和详情面板'
const long = (n, unit = han) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
export const TITLES = [
  (i) => `第${i}本 短标题`,
  (i) => `[社团${i % 9} (作者${i % 5})] ${long(60)} (原作${i % 7}) [中国翻訳]`,
  (i) => `${i}-${long(250)}`,
  (i) => `${i}_${'VeryLongAsciiTitleWithoutAnySpaceOrBreakOpportunity'.repeat(5)}`,
  (i) => `https://example.com/very/long/path/${'segment/'.repeat(25)}${i}.zip?token=${'a1b2c3'.repeat(20)}`,
  (i) => `🎉🔥 emoji 标题 ${i} ✨ ${'ひらがなカタカナ漢字'.repeat(12)} 🚀`,
  (i) => `<b>HTML</b> & "quotes" 'single' <script>alert(${i})</script> ${long(40)}`,
  (i) => `نص عربي طويل جدا ${i} ${'مرحبا بالعالم '.repeat(10)} mixed English`,
  () => '',
  (i) => `${long(18)} ${i}`,
]
export function tagsFor(i) {
  const count = [0, 1, 3, 8, 15, 30, 60][i % 7]
  const tags = []
  for (let k = 0; k < count; k++) {
    const kind = k % 6
    if (kind === 0) tags.push(`系列:系列${k % 5}`)
    else if (kind === 1) tags.push(`作者:作者${(i + k) % 11}`)
    else if (kind === 2) tags.push(`标签${k}`)
    else if (kind === 3) tags.push(`社团:${long(20 + (k % 4) * 6)}${k}`)
    else if (kind === 4) tags.push(`language:chinese`)
    else tags.push(`event:${long(12)}${k}`)
  }
  if (i % 11 === 0) tags.push(`超长标签:${long(150)}`)
  if (i % 13 === 0) tags.push(`very_long_ascii_tag_without_spaces_${'x'.repeat(120)}`)
  return [...new Set(tags)]
}

// 封面：有 ImageMagick 就生成带尺寸文字的真 JPEG，没有就写纯色 PNG 字节（浏览器照样能显示）
function solidPng(w, h, [r, g, b]) {
  const crc = (buf) => { let c; const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } let x = 0xffffffff; for (const byte of buf) x = t[(x ^ byte) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b }
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
let haveConvert = null
async function writeCover(file, w, h, color, label) {
  if (haveConvert === null) { try { execFileSync('convert', ['-version'], { stdio: 'ignore' }); haveConvert = true } catch { haveConvert = false } }
  await mkdir(path.dirname(file), { recursive: true })
  if (haveConvert) {
    const hex = `#${color.map((c) => c.toString(16).padStart(2, '0')).join('')}`
    const args = ['-size', `${w}x${h}`, `xc:${hex}`]
    if (w >= 60 && h >= 30) args.push('-gravity', 'center', '-fill', 'white', '-pointsize', String(Math.max(10, Math.min(w, h) / 6 | 0)), '-annotate', '0', label)
    args.push('-quality', '80', `jpg:${file}`)
    try { execFileSync('convert', args, { stdio: 'ignore' }); return } catch { /* 退回纯色 PNG */ }
  }
  await writeFile(file, solidPng(w, h, color))
}

export async function buildStyleStressFixture(dataDir, count = 120) {
  const cfg = { archiveCacheDir: path.join(dataDir, 'cache'), mediaImportProfiles: { 'archive-gallery': { managedDir: path.join(dataDir, 'managed') } }, mediaImportSourceRoots: '/input' }
  const handler = createArchiveGalleryHandler({ type: 'archive', dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async () => false, getConfig: () => cfg })
  const { internals } = handler
  const made = []
  for (let i = 0; i < count; i++) {
    const title = TITLES[i % TITLES.length](i)
    const id = createHash('sha1').update(`style-stress-${i}`).digest('hex')
    const noCover = i % 17 === 5
    const item = internals.buildItem({ itemId: id, title, tags: tagsFor(i), zipPath: `/x/stress-${i}.zip`, external: true, size: 1024 * (i + 1), mtimeMs: 1, pageCount: 1 + (i % 40), sourceProfile: 'archive-gallery', createdAt: new Date(1.7e12 + i * 3600e3).toISOString(), cover: noCover ? '' : internals.thumbnailUrl(id) })
    await internals.writeItem(item)
    if (!noCover) {
      const [w, h] = COVER_SIZES[i % COVER_SIZES.length]
      await writeCover(internals.paths.thumbPath(id), w, h, [(i * 37) % 200 + 30, (i * 71) % 180 + 40, (i * 53) % 200 + 30], `#${i}  ${w}x${h}`)
    }
    made.push({ id, title, tags: item.tags?.length ?? 0 })
  }
  return made
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]
  if (!dir) { console.error('用法：node make-style-stress-fixture.mjs <数据目录> [数量]'); process.exit(2) }
  const made = await buildStyleStressFixture(path.resolve(dir), Number(process.argv[3]) || 120)
  console.log(`style stress fixture: ${made.length} items → ${dir}`)
}
