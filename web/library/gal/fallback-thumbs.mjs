// 脚本卡片的「兜底封面」：没有任何 thumbSources / scriptThumbs / scriptIndex 命中时，从场景（已经解析好的 scene）里收几张有代表性的图。
// 和适配器无关：只认规范场景（gal-scene/1）里的指令，不碰具体游戏的目录结构。
//   优先级（config.thumbFallback.prefer，默认 ['cg', 'stand', 'bg']）：
//     cg    事件图 / CG：bg 指令带 over（叠在 src 上的第二张图 = EV 图）；任何带 cg / still 标记的指令（cg: true、still: true、kind: 'cg' | 'still' | 'event'）的 src；
//           spine 指令（静态画面）上的 thumb 字段（png / jpg / webp）
//     stand 立绘：stand 指令的第一个有图片扩展名的 part（一个立绘指令只取一张，部件叠层的脸 / 表情不单独算）
//     bg    背景：bg 指令的 src（纯色背景没有 src，自然跳过）
//   每一类内部按出现顺序、去重；整体按 prefer 排好后截到 max * 3 个候选（调用方逐个验证文件存在，凑够 max 张为止）。
//   只扫前 scanSteps 步（默认 200）：大脚本也只花固定的时间；扫到够多就提前停。
//   skipBlack：文件名（无扩展名）命中 skip 里任一正则的丢掉（纯黑 / 纯白占位图，默认 black / white / blank 按单词边界）。
import { DEFAULT_THUMB_FALLBACK, FALLBACK_PREFER, THUMB_FALLBACK_LIMITS } from './config.mjs'

const MAX_THUMBS = THUMB_FALLBACK_LIMITS.max[1]

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i
const VIDEO_RE = /\.(mp4|mkv|webm|mov|m4v)$/i
// 能当缩略图的引用：字符串、不是视频；有扩展名的必须是图片扩展名（没有扩展名的交给 resolveAsset 去找）
const usable = (src) => typeof src === 'string' && src.length > 0 && src.length < 400 && !VIDEO_RE.test(src) && (!/\.[A-Za-z0-9]{2,5}$/.test(src) || IMAGE_RE.test(src))
const stemOfSrc = (src) => src.slice(src.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')

const compileSkip = (sources) => {
  const out = []
  for (const source of sources || []) { try { out.push(new RegExp(source, 'i')) } catch { /* 校验阶段已报；这里丢掉 */ } }
  return out
}

// scene → { images: [{ src, kind }]（按优先级排好、已去重 / 过滤）, scanned（扫了几步）, truncated（脚本比 scanSteps 长）, counts: { cg, stand, bg }（扫到的各类张数，过滤前）, skipped（被黑 / 白名字挡掉的张数）}
export function collectFallbackImages(scene, options = {}) {
  const cfg = { ...DEFAULT_THUMB_FALLBACK, ...options }
  const steps = Array.isArray(scene?.steps) ? scene.steps : []
  const limit = Math.max(1, Math.min(2000, Math.floor(Number(cfg.scanSteps)) || DEFAULT_THUMB_FALLBACK.scanSteps))
  const want = Math.max(1, Math.min(MAX_THUMBS, Math.floor(Number(cfg.max)) || DEFAULT_THUMB_FALLBACK.max)) * 3
  const prefer = (Array.isArray(cfg.prefer) ? cfg.prefer : FALLBACK_PREFER).map((k) => (k === 'bgOver' ? 'cg' : k)).filter((k, i, all) => FALLBACK_PREFER.includes(k) && all.indexOf(k) === i)
  const kinds = prefer.length ? prefer : FALLBACK_PREFER
  const skip = cfg.skipBlack === false ? [] : compileSkip(cfg.skip)
  const buckets = { cg: [], stand: [], bg: [] }
  const seen = new Set()
  const counts = { cg: 0, stand: 0, bg: 0 }
  let skipped = 0
  const add = (kind, src) => {
    if (!usable(src) || seen.has(src)) return
    seen.add(src)
    counts[kind] += 1
    if (skip.some((re) => re.test(stemOfSrc(src)))) { skipped += 1; return }
    buckets[kind].push(src)
  }
  const full = () => kinds.every((kind) => buckets[kind].length >= want) || kinds.reduce((n, kind) => n + buckets[kind].length, 0) >= want * 2
  let scanned = 0
  for (const step of steps.slice(0, limit)) {
    scanned += 1
    for (const command of step?.commands || []) {
      if (!command || typeof command !== 'object') continue
      const flagged = command.cg === true || command.still === true || ['cg', 'still', 'event'].includes(command.kind)
      switch (command.op) {
        case 'bg':
          if (command.over) { add('cg', command.over); add('cg', command.src) }   // EV：over 是图 2（前景图），src 是底图；都算事件图
          else if (flagged) add('cg', command.src)
          else add('bg', command.src)
          break
        case 'stand': {
          if (flagged) { add('cg', command.parts?.[0]?.src); break }
          const part = (command.parts || []).find((p) => typeof p?.src === 'string' && IMAGE_RE.test(p.src))
          if (part) add('stand', part.src)
          break
        }
        case 'spine':
          if (typeof command.thumb === 'string' && IMAGE_RE.test(command.thumb)) add(command.kind === 'still' || flagged ? 'cg' : 'stand', command.thumb)
          break
        default:
          if (flagged && command.src) add('cg', command.src)
      }
    }
    if (full()) break
  }
  const images = []
  for (const kind of kinds) for (const src of buckets[kind]) images.push({ src, kind })
  return { images: images.slice(0, want), scanned, truncated: steps.length > scanned, counts, skipped }
}
