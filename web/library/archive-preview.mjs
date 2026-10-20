// 压缩包图集的预览动图：第一页 + 随机/均匀挑的 N 页，拼成一张动图 WebP（章节列表和媒体库卡片悬停时显示）。
// 选页是确定性的（以条目 ID 为种子）：同一个条目每次选的页都一样，重跑结果稳定。

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'

// 返回要放进预览的页下标（升序）：始终含第 0 页，再从其余页里挑 count 个。
// mode: 'random'（以 seed 为种子的伪随机、不重复）| 'even'（在其余页里均匀取点）
export function pickPreviewPages(total, count, mode = 'random', seed = '') {
  if (total < 2 || count < 1) return []
  const others = Array.from({ length: total - 1 }, (_, index) => index + 1)
  if (count >= others.length) return [0, ...others]
  let chosen
  if (mode === 'even') {
    chosen = Array.from({ length: count }, (_, k) => others[Math.floor(((k + 1) * others.length) / (count + 1))])
  } else {
    // mulberry32：32 位种子的小型伪随机数发生器
    let state = createHash('sha1').update(String(seed)).digest().readUInt32LE(0)
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pool = [...others]
    chosen = []
    for (let k = 0; k < count; k++) {
      const pick = Math.floor(next() * pool.length)
      chosen.push(pool.splice(pick, 1)[0])
    }
  }
  return [0, ...[...new Set(chosen)].sort((a, b) => a - b)]
}

// 用 ImageMagick 处理一张图：stdin 进、stdout 出。magick（IM7）不行就退回 convert（IM6）。
export async function runMagick(args, input) {
  const errors = []
  for (const command of ['magick', 'convert']) {
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(command, args)
        const chunks = []
        const errChunks = []
        child.stdout.on('data', (chunk) => chunks.push(chunk))
        child.stderr.on('data', (chunk) => errChunks.push(chunk))
        child.on('error', reject)
        child.on('close', (code) => code === 0 && chunks.length
          ? resolve(Buffer.concat(chunks))
          : reject(new Error(Buffer.concat(errChunks).toString().slice(0, 300) || `exit ${code}`)))
        child.stdin.on('error', () => {})
        child.stdin.end(input)
      })
    } catch (error) {
      errors.push(`${command}: ${error.message}`)
    }
  }
  throw new Error(`ImageMagick 处理失败：${errors.join('；')}`)
}

// 把每页缩放并裁成同一个画布（动图的每一帧必须同尺寸）。画布宽 = width，高取第一页缩放后的高度（最高 2 倍宽）。
export async function normalizeFrames(buffers, width) {
  const first = await runMagick(['-', '-auto-orient', '-resize', `${width}x`, '-quality', '80', 'jpg:-'], buffers[0])
  const dims = (await runMagick(['jpg:-', '-format', '%w %h', 'info:'], first)).toString().trim().split(/\s+/).map(Number)
  const canvasWidth = dims[0] || width
  const canvasHeight = Math.min(dims[1] || Math.round(width * 1.4), canvasWidth * 2)
  const size = `${canvasWidth}x${canvasHeight}`
  const frames = [await runMagick(['-', '-auto-orient', '-resize', `${size}^`, '-gravity', 'center', '-extent', size, '-quality', '80', 'jpg:-'], buffers[0])]
  for (const buffer of buffers.slice(1)) {
    frames.push(await runMagick(['-', '-auto-orient', '-resize', `${size}^`, '-gravity', 'center', '-extent', size, '-quality', '80', 'jpg:-'], buffer))
  }
  return frames
}

// 是不是动图 WebP：RIFF....WEBP 头 + ANIM 块
export function isAnimatedWebp(buffer) {
  return buffer.length > 30 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP' && buffer.includes(Buffer.from('ANIM'))
}
