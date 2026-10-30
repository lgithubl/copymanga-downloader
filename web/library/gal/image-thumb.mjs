// 图片缩略图（卡片 / 画廊用）：原图缩到指定宽度（sharp），WebP 缓存在 <DATA_DIR>/cache/gal-img-thumbs/<前两位>/<sha1>.webp。
//   · 键 = sha1(来源标识, 宽度, 版本)：来源改了 / 参数变了就是新文件；命中缓存 = 直接给文件（调用方用 sendCachedFile 发，带长缓存头）
//   · 来源可以是磁盘文件（标识 = 真实路径 + 大小 + 修改时间），也可以是 .arc 里的条目（标识见 containers.virtualEntry）——后者不需要先把原图写到磁盘
//   · 并发有上限：同时最多 concurrency 张在缩（排队，读原图也在槽位里，所以同时在内存里的原图也是这么多张）；同一张同时来多次只缩一次；
//     libvips 自己的线程数（threads）和内存缓存（cacheMB）也压低，不然 concurrency 张 × 每张 N 个线程会把 CPU 占满、拖慢播放 / 列表；缩不了（sharp 没装 / 图坏了 / 不是图片格式）= 返回 null，调用方退回原图
//   · 宽度：取整到 BUCKETS 里不小于它的那一档（缓存文件数有限），不放大小图
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

export const IMAGE_THUMB_VERSION = 'v2-webp80-top'
export const THUMB_BUCKETS = Object.freeze([160, 240, 320, 480, 640, 960, 1280])
export const TALL_RATIO = 2.4   // 高 / 宽超过它算超长图
export const TALL_TOP_RATIO = 0.6   // 超长图取顶部 宽 × 0.6 高的一段：按 Manual.jpg（2616×14696，最上面的封面插画高约 0.58 倍宽）定的，别的超长图也取最上面这一段
export const IMAGE_THUMB_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i

export const bucketOf = (width) => {
  const w = Math.floor(Number(width))
  if (!Number.isFinite(w) || w <= 0) return 0
  return THUMB_BUCKETS.find((b) => b >= w) || THUMB_BUCKETS[THUMB_BUCKETS.length - 1]
}

// loadSharp：返回 sharp 函数或 null（默认动态 import，没装 / 加载失败 = null，只试一次）
export function createImageThumbCache({ dir, concurrency = Math.max(1, Number(process.env.GAL_THUMB_CONCURRENCY) || 2), threads = 1, cacheMB = 32, loadSharp = null, quality = 80, maxInputPixels = 100_000_000 }) {
  let sharpPromise = null
  const getSharp = () => {
    if (!sharpPromise) {
      sharpPromise = Promise.resolve().then(() => (loadSharp ? loadSharp() : import('sharp').then((m) => m.default || m))).then((sharp) => {
        try { sharp?.concurrency?.(threads); sharp?.cache?.({ memory: cacheMB, files: 0, items: 50 }) } catch { /* 调不了就用默认 */ }
        return sharp
      }).catch(() => null)
    }
    return sharpPromise
  }
  const inflight = new Map()
  const waiting = []
  let active = 0
  const slot = () => new Promise((resolve) => { if (active < concurrency) { active += 1; resolve() } else waiting.push(resolve) })
  const release = () => { const next = waiting.shift(); if (next) next(); else active -= 1 }

  // source：{ id（字符串，来源标识）, read()（Buffer）}；返回缓存文件路径，缩不了 = null
  async function thumbOf(source, width, { top = null } = {}) {
    const bucket = bucketOf(width)
    if (!bucket) return null
    const key = createHash('sha1').update(JSON.stringify([source.id, bucket, IMAGE_THUMB_VERSION])).digest('hex')
    const out = path.join(dir, key.slice(0, 2), `${key}.webp`)
    try { if ((await stat(out)).size > 0) return out } catch { /* 还没有 */ }
    let pending = inflight.get(key)
    if (!pending) {
      pending = (async () => {
        const sharp = await getSharp()
        if (!sharp) return null
        await slot()
        const tmp = `${out}.${process.pid}-${Date.now()}.tmp`
        try {
          const input = await source.read()
          await mkdir(path.dirname(out), { recursive: true })
          const base = sharp(input, { limitInputPixels: maxInputPixels, failOn: 'none' })
          const picked = top ? base.extract({ left: 0, top: 0, width: top.width, height: top.height }) : base.rotate()
          await picked.resize({ width: bucket, withoutEnlargement: true }).webp({ quality }).toFile(tmp)
          await rename(tmp, out)
          return out
        } catch {
          await rm(tmp, { force: true }).catch(() => {})
          return null
        } finally { release() }
      })().finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    return pending
  }

  // 超长图（长条漫画 / 整本说明书拼成一张：高 / 宽 > TALL_RATIO）：卡片按 3:4 居中裁，中心落在内容中段，封面变成说明书正文。取顶部那一段（宽 × TALL_TOP_RATIO）缩成 WebP；
  // 不是超长图 / sharp 没装 / 读不了 = null（调用方用原图）。只读文件头判断高宽，不解码
  async function tallTopOf(file, width = 960) {
    const sharp = await getSharp()
    if (!sharp) return null
    let meta
    try { meta = await sharp(file, { limitInputPixels: maxInputPixels }).metadata() } catch { return null }
    if (!meta.width || !meta.height || meta.height / meta.width <= TALL_RATIO) return null
    const source = await fileSource(file)
    return thumbOf({ ...source, id: `top:${source.id}` }, width, { top: { width: meta.width, height: Math.round(meta.width * TALL_TOP_RATIO) } })
  }

  // 磁盘文件的来源标识（真实路径 + 大小 + 修改时间）
  async function fileSource(file) {
    const st = await stat(file)
    return { id: `file:${file}:${st.size}:${Math.round(st.mtimeMs)}`, read: () => readFile(file) }
  }
  return { thumbOf, tallTopOf, fileSource, available: async () => Boolean(await getSharp()) }
}
