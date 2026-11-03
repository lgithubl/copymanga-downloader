#!/usr/bin/env node
// 从 MahotanArchive 前端（extract_tauri_assets_v2.mjs 从 exe 里提出来的 index-*.js）取立绘的「头部框」表，写成 web/library/gal/adapters/mahotan-heads.json。
// 前端的故事播放器（Qd / Su / Q8）靠这张表把立绘按头对齐：头框的长边 = 舞台高度的 20%，头框中心在舞台高度的 25% 处、水平居中；表里没有的立绘退回「整个人的 bounds 撑满舞台高度、脚对齐底边」。
//   用法：node scripts/dev/extract-mahotan-heads.mjs <index-CVif2I86.js> [输出]
import { readFileSync, writeFileSync } from 'node:fs'

const [src, out = new URL('../../web/library/gal/adapters/mahotan-heads.json', import.meta.url).pathname] = process.argv.slice(2)
const js = readFileSync(src, 'utf8')
// By：{ "<立绘路径>": { box: [l, t, r, b], sourceWidth, sourceHeight } }（只有源图尺寸一致才用）
const byStart = js.indexOf('By={') + 3
let depth = 0
let end = byStart
for (let i = byStart; i < js.length; i++) { if (js[i] === '{') depth++; else if (js[i] === '}') { depth--; if (!depth) { end = i + 1; break } } }
const by = Function(`return (${js.slice(byStart, end)})`)()
// gH：头像匹配结果，source.standingAsset + source.naturalCropBox（立绘上的头框）
const k = js.indexOf('const gH=JSON.parse(`') + 'const gH=JSON.parse(`'.length
const items = JSON.parse(js.slice(k, js.indexOf('`)', k)))
const heads = {}
for (const item of items) if (item.source?.standingAsset && item.source.naturalCropBox) heads[item.source.standingAsset] = item.source.naturalCropBox
const result = { note: '来自 MahotanArchive 前端 index-*.js 的 By（带源图尺寸）/ gH.items[].source.naturalCropBox；box = [left, top, right, bottom]（源图像素）', by, heads, constants: { headFraction: 0.2, headCenterY: 0.25 } }
writeFileSync(out, `${JSON.stringify(result)}\n`)
console.log(`By ${Object.keys(by).length} 个，heads ${Object.keys(heads).length} 个 → ${out}`)
