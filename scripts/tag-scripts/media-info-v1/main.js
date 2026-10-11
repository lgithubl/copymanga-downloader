// 用 ffprobe 读媒体技术信息，写成 tag。
//
// 为什么不存成字段：那要改 mergeUnitPatch 的白名单（服务端有两道，少改一道就静默
// 丢弃），而目前只需要显示。tag 是现成的渲染通道，服务端一行不用改。代价是没法按
// 数值排序筛选——真要筛「时长 > 30 分」时再升级成字段。
//
// 不自己做缓存：任务框架已经有「同版本 + tag 还在 = 跳过」（server.mjs
// isCompletedSameVersionRun），改版本号或 force 就重跑。再造一层只会多一个失效源。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function generateTags(ctx) {
  const logs = []
  const options = normalizeOptions(ctx.script?.options || {})
  const units = (ctx.units || []).filter((unit) => unit.managedPath
    && (unit.mediaKind === 'video' || unit.mediaKind === 'audio'))
  if (!units.length) {
    logs.push('没有音视频单元，跳过')
    return { itemTags: [], unitTags: [], unitPatches: [], logs, details: { probed: 0 } }
  }

  const unitTags = []
  const resolutions = []
  let failed = 0
  for (const unit of units) {
    let info
    try {
      info = await probe(unit.managedPath, options)
    } catch (error) {
      failed += 1
      logs.push(`${unit.title || unit.unitId}: ffprobe 失败 ${error.message}`)
      continue
    }
    const tags = tagsOf(info, options)
    if (!tags.length) {
      logs.push(`${unit.title || unit.unitId}: ffprobe 没给出可用信息`)
      continue
    }
    unitTags.push({ unitId: unit.unitId, tags })
    if (info.resolution) resolutions.push(info.resolution)
    logs.push(`${unit.title || unit.unitId}: ${tags.join(' / ')}`)
  }

  // 媒体维度汇总所有不同的分辨率。混装的合集（1080p + 720p）两个都要，
  // 只留一个会让人以为整套都是那个规格。按像素数从大到小，顺序稳定。
  const itemTags = [...new Set(resolutions)]
    .sort((a, b) => pixels(b) - pixels(a))
    .map((value) => `${options.resolutionPrefix}: ${value}`)
  if (failed) logs.push(`${failed} 个单元探测失败`)
  return {
    itemTags,
    unitTags,
    unitPatches: [],
    logs,
    details: { probed: units.length - failed, failed, resolutions: [...new Set(resolutions)] },
  }
}

async function probe(filePath, options) {
  const { stdout } = await execFileAsync(options.ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration,bit_rate',
    '-show_entries', 'stream=codec_type,codec_name,width,height,channels,r_frame_rate',
    '-of', 'json',
    filePath,
  ], { timeout: options.timeoutMs, maxBuffer: 4 * 1024 * 1024 })
  const data = JSON.parse(stdout)
  const streams = Array.isArray(data.streams) ? data.streams : []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  const duration = Number(data.format?.duration)
  return {
    // 封面图会被 ffprobe 当成一条 video 流（mjpeg/png），宽高是封面的尺寸不是视频的。
    // 音频文件带内嵌封面时尤其明显，所以这里排掉这几种编码。
    resolution: video && !COVER_CODECS.includes(video.codec_name) && video.width && video.height
      ? `${video.width}x${video.height}` : '',
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    videoCodec: video && !COVER_CODECS.includes(video.codec_name) ? String(video.codec_name || '') : '',
    audioCodec: String(audio?.codec_name || ''),
    channels: Number(audio?.channels) || 0,
    bitrate: Number(data.format?.bit_rate) || 0,
    fps: video ? parseFps(video.r_frame_rate) : 0,
  }
}

// 这几种编码出现在 video 流里时，几乎都是内嵌封面而不是真视频轨
const COVER_CODECS = ['mjpeg', 'png', 'bmp', 'gif', 'webp']

function tagsOf(info, options) {
  const out = []
  // 「没有就不用」：音频没有分辨率、损坏文件读不到时长，都不产出对应 tag，
  // 而不是写一个 "未知" 占位——占位 tag 会让人以为探测过且结果就是未知。
  if (info.resolution) out.push(`${options.resolutionPrefix}: ${info.resolution}`)
  if (info.duration) out.push(`${options.durationPrefix}: ${formatDuration(info.duration)}`)
  if (!options.extraTags) return out
  if (info.videoCodec) out.push(`视频编码: ${info.videoCodec}`)
  if (info.audioCodec) out.push(`音频编码: ${info.audioCodec}`)
  if (info.channels) out.push(`声道: ${info.channels}`)
  if (info.bitrate) out.push(`码率: ${Math.round(info.bitrate / 1000)} kbps`)
  if (info.fps) out.push(`帧率: ${info.fps}`)
  return out
}

function formatDuration(seconds) {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function parseFps(value) {
  const [num, den] = String(value || '').split('/').map(Number)
  if (!Number.isFinite(num) || !Number.isFinite(den) || !den) return 0
  return Math.round((num / den) * 100) / 100
}

function pixels(resolution) {
  const [w, h] = String(resolution).split('x').map(Number)
  return (Number(w) || 0) * (Number(h) || 0)
}

function normalizeOptions(raw) {
  const num = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`不是合法数值：${JSON.stringify(value)}`)
    return n
  }
  return {
    ffprobePath: String(raw.ffprobePath || 'ffprobe').trim() || 'ffprobe',
    timeoutMs: num(raw.timeoutMs, 20000),
    // 分辨率和时长是主信息，前缀可配是因为 UI 要按前缀把它们挑出来单独渲染，
    // 改了这里就得同步改 mediaInfoTagKeys 配置，否则页面上找不到。
    resolutionPrefix: String(raw.resolutionPrefix || '分辨率').trim() || '分辨率',
    durationPrefix: String(raw.durationPrefix || '时长').trim() || '时长',
    // 编码/码率/帧率这些先存着，显示与否你自己定
    extraTags: raw.extraTags !== false,
  }
}
