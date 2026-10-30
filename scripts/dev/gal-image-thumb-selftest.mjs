#!/usr/bin/env node
// 自测（纯 node，需要 web/node_modules 里的 sharp）：卡片 / 画廊的图片缩略图（?w=）——容器（.arc）里的大图缩成 WebP 缓存，原图不落盘；
//   磁盘上已有的文件、PNA 的帧、不是图片的资源、sharp 缺失时的退回，都按预期走。
//   node scripts/dev/gal-image-thumb-selftest.mjs
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../../scripts/tag-scripts/gal-layout/main.js'
import { applyGalConfigPatch } from '../../web/library/gal/config.mjs'
import { bucketOf, createImageThumbCache } from '../../web/library/gal/image-thumb.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { arcBuild, buildAdvhdFixture, pnaBuild } from './make-advhd-fixture.mjs'

const sharp = createRequire(new URL('../../web/package.json', import.meta.url))('sharp')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const exists = (p) => stat(p).then(() => true, () => false)

// ---- 缓存单元 ----
check('宽度取整到档位：1 → 160；300 → 320；480 → 480；5000 → 1280；0 / 非数字 → 0（不缩）', J([1, 300, 480, 5000, 0, 'x'].map(bucketOf)) === J([160, 320, 480, 1280, 0, 0]), J([1, 300, 480, 5000, 0, 'x'].map(bucketOf)))
const work = await mkdtemp(path.join(os.tmpdir(), 'img-thumb-'))
{
  const noSharp = createImageThumbCache({ dir: path.join(work, 'c0'), loadSharp: () => null })
  check('sharp 加载不出来：thumbOf 返回 null（调用方退回原图），available = false', (await noSharp.thumbOf({ id: 'x', read: async () => Buffer.alloc(1) }, 320)) === null && (await noSharp.available()) === false)
  const bad = createImageThumbCache({ dir: path.join(work, 'c1') })
  check('图坏了 / 不是图片：返回 null，不留临时文件', (await bad.thumbOf({ id: 'bad', read: async () => Buffer.from('not an image') }, 320)) === null && !(await exists(path.join(work, 'c1'))) || (await readdir(path.join(work, 'c1'), { recursive: true })).every((f) => !f.endsWith('.tmp')))
}

// 并发控制：20 张不同的图同时来，同时在缩的不超过 concurrency（2）；同一张图来 8 次只读 / 缩一次；libvips 线程 / 缓存被压低
{
  let active = 0
  let peak = 0
  let reads = 0
  const calls = []
  const fake = Object.assign(() => ({ rotate() { return this }, resize() { return this }, webp() { return this }, async toFile(file) { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 15)); await writeFile(file, 'x'); active -= 1 } }), { concurrency: (n) => calls.push(['threads', n]), cache: (o) => calls.push(['cache', o.memory]) })
  const dir = path.join(work, 'conc')
  const cache = createImageThumbCache({ dir, concurrency: 2, loadSharp: () => fake })
  const src = (i) => ({ id: `s${i}`, read: async () => { reads += 1; return Buffer.from('img') } })
  const many = await Promise.all(Array.from({ length: 20 }, (_, i) => cache.thumbOf(src(i), 320)))
  check('20 张不同的图同时来：同时在缩的最多 2 张（concurrency），全部成功', peak <= 2 && peak >= 1 && many.every(Boolean), J({ peak, ok: many.filter(Boolean).length }))
  reads = 0
  const same = await Promise.all(Array.from({ length: 8 }, () => cache.thumbOf(src('same'), 320)))
  check('同一张图同时来 8 次：只读一次、只缩一次，8 个都拿到同一个文件', reads === 1 && new Set(same).size === 1 && Boolean(same[0]), J({ reads, n: new Set(same).size }))
  check('libvips 的线程数 = 1、内存缓存 = 32MB 被设置（只设一次）', J(calls) === J([['threads', 1], ['cache', 32]]), J(calls))
  const slow = createImageThumbCache({ dir: path.join(work, 'conc2'), concurrency: 1, loadSharp: () => fake })
  let readFail = 0
  const mixed = await Promise.all([slow.thumbOf({ id: 'bad', read: async () => { readFail += 1; throw new Error('读失败') } }, 320), slow.thumbOf(src('ok'), 320)])
  check('某张读失败：返回 null，槽位被释放，后面排队的照常完成（不会卡死）', mixed[0] === null && Boolean(mixed[1]) && readFail === 1, J(mixed))
}

// ---- 走真实 handler：arc 里的大图 ----
const media = path.join(work, 'lpsl')
await buildAdvhdFixture(media)
const noise = (w, h) => sharp(randomBytes(w * h * 4), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()   // 噪声 = 压不动的大 PNG
const big = await noise(1600, 1200)
const half = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 127, g: 96, b: 97, alpha: 0.5 } } }).png().toBuffer()
await writeFile(path.join(media, 'Chip4.arc'), arcBuild([
  { name: 'BIG.png', data: big },
  { name: 'ST_P.pna', data: pnaBuild({ magic: 'PNAP', width: 400, height: 300, frames: [{ type: 0, id: 0, x: 0, y: 0, w: 400, h: 300, mode: 3, data: half }] }) },
]))
const dataDir = path.join(work, 'data')
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => exists(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media, adapters: ['advhd::ws2'] } } }) })
const imp = (await handler.importFromSource({ options: { adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' } } } })).items[0]
const tag = await generateTags({ item: imp, script: { id: 'gal-layout', version: '2.26.0', options: {} } })
await handler.internals.updateItem(imp.itemId, (it) => ({ ...it, config: applyGalConfigPatch(it.config, tag.itemPatch.gal.config) }))   // 绕过 patchItemMetadata（它会在后台预热展开）
const id = imp.itemId
const meta = async (file) => sharp(file).metadata()

// 列表阶段（封面 / 语音的存在性检查）不能把原图从 .arc 里解压出来
const home = (await handler.getReaderContent(id, 'main', { sectionId: '' })).node
const dirCard = home.items.find((i) => i.title === 'Rio1')
const dirNode = (await handler.getReaderContent(id, 'main', { sectionId: dirCard.node || dirCard.id })).node
const scripts = dirNode.items.filter((i) => i.type === 'script')
const play = await handler.getReaderContent(id, 'main', { sectionId: scripts[0].node || scripts[0].id })
const files = (await readdir(path.join(media, 'arc/res'), { recursive: true }).catch(() => [])).filter((f) => /\.(png|webp|ogg|jpg)$/i.test(f))
check('浏览列表 + 打开脚本卡片后：卡片有封面（thumbs 里有 Chip3/EV_01.png），但 arc/res 下没有任何图 / 语音被解压出来', scripts.length === 3 && scripts[0].thumbs?.some((t) => /EV_01\.png$/i.test(t)) && files.length === 0, J([scripts[0].thumbs, files]))
const t1 = await handler.getResource(id, 'Chip4/BIG.png', { width: 320 })
const m1 = t1.file ? await meta(t1.file) : null
check('?w=320：arc 里的 1600×1200 大图 → WebP 文件（cache/gal-img-thumbs 下），宽 320、高 240；contentType image/webp；带长缓存头', Boolean(t1.file) && t1.contentType === 'image/webp' && m1.format === 'webp' && m1.width === 320 && m1.height === 240 && t1.file.includes(path.join('cache', 'gal-img-thumbs')) && /max-age=604800/.test(t1.cacheControl), J([t1.file, t1.contentType, m1]))
check('缩略图比原图小得多（原图噪声 PNG 几 MB，缩略图 < 原图的 1/10）', (await stat(t1.file)).size * 10 < big.length, J([(await stat(t1.file)).size, big.length]))
check('原图没有落盘：arc/res/Chip4/BIG.png 不存在', !(await exists(path.join(media, 'arc/res/Chip4/BIG.png'))))
const mtime1 = (await stat(t1.file)).mtimeMs
await new Promise((r) => setTimeout(r, 30))
const t2 = await handler.getResource(id, 'chip4/big.png', { width: 300 })   // 名字大小写不同 + 宽度落在同一档
check('同一张图同一档再取 = 命中缓存（同一个文件、没重写）；资源路径忽略大小写', t2.file === t1.file && (await stat(t2.file)).mtimeMs === mtime1, J([t2.file, t1.file]))
const t3 = await handler.getResource(id, 'Chip4/BIG.png', { width: 160 })
check('另一档宽度 = 另一个缓存文件（160 宽）', t3.file !== t1.file && (await meta(t3.file)).width === 160)
const frame = await handler.getResource(id, 'Chip4/ST_P.pna/0.png', { width: 160 })
const fm = await meta(frame.file)
const fpx = await sharp(frame.file).ensureAlpha().raw().toBuffer()
check('PNA 的帧（PNAP）也能缩：WebP、宽 160，保留透明；颜色是还原过预乘的（直通）', frame.contentType === 'image/webp' && fm.width === 160 && fm.hasAlpha && fpx[3] > 100 && fpx[3] < 160, J([fm, [...fpx.subarray(0, 4)]]))
const onDisk = (await readdir(path.join(media, 'arc/res'), { recursive: true }).catch(() => [])).filter((f) => /^Chip4.*\.(png|webp)$/i.test(f))
check('缩略图请求一圈下来，arc/res/Chip4 下没有任何图片落盘（只有 PNA 的 index.json）', onDisk.length === 0, J(onDisk))

// 磁盘上已有的文件（比如播放时取过原图）：缩略图直接从文件缩
const orig = await handler.getResource(id, 'Chip4/BIG.png')   // 不带 w = 原图（会落盘）
check('不带 w：原图（image/png，字节和 arc 里的一样），并落盘', orig.body.equals(big) && (await exists(path.join(media, 'arc/res/Chip4/BIG.png'))))
const t4 = await handler.getResource(id, 'Chip4/BIG.png', { width: 640 })
check('磁盘上已有的文件：?w=640 从文件缩（宽 640）', (await meta(t4.file)).width === 640)
// 不是图片 / 视频 frame / 小图不放大
const ogg = await handler.getResource(id, 'Bgm/BGM01.ogg', { width: 320 })
check('不是图片（ogg）带 w：忽略 w，照常给原内容', Buffer.isBuffer(ogg.body) && ogg.body.toString() === 'OggS-bgm')
const small = await handler.getResource(id, 'Chip3/BG_01.png', { width: 320 })
check('比档位还小的图（1×1）不放大：宽仍是 1', (await meta(small.file)).width === 1)
const missing = await handler.getResource(id, 'Chip4/nope.png', { width: 320 }).then(() => 'ok', (e) => e.statusCode)
check('不存在的图带 w：404', missing === 404, String(missing))
const evil = await handler.getResource(id, '../Rio1.arc', { width: 320 }).then(() => 'ok', (e) => e.statusCode)
check('带 w 也挡住 ../ 越界（400）', evil === 400, String(evil))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
