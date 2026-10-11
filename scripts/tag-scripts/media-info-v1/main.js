// 用 ffprobe 读媒体技术信息，写成 tag。
//
// 为什么不存成字段：那要改 mergeUnitPatch 的白名单（服务端有两道，少改一道就静默
// 丢弃），而目前只需要显示。tag 是现成的渲染通道，服务端一行不用改。代价是没法按
// 数值排序筛选——真要筛「时长 > 30 分」时再升级成字段。
//
// 不自己做任务级缓存：任务框架已经有「同版本 + tag 还在 = 跳过」（server.mjs
// isCompletedSameVersionRun），改版本号或 force 就重跑。再造一层只会多一个失效源。
// 但在单个章节这一层会复用已有 tag——跑过的库重跑时 ffprobe 调用数为 0，
// 只有新导入或上次失败的章节才真正读文件。要强制重读用 forceProbe。

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
  let totalSeconds = 0
  let noDuration = 0
  let failed = 0
  let reused = 0
  let probeMs = 0
  let probeCount = 0
  for (const unit of units) {
    // 已经有本脚本产出的 tag 就直接复用，不再调 ffprobe。
    //
    // 注意复用不等于「不产出」：server.mjs:4152 把本脚本上次产出、这次没有的 tag
    // 当作要删除的，不产出等于把整条章节的分辨率/时长/编码全抹掉。所以这里是
    // 原样读回来重新产出一遍，而不是跳过。
    const kept = options.forceProbe ? null : reusableTags(unit.tags, options)
    if (kept) {
      unitTags.push({ unitId: unit.unitId, tags: kept.tags })
      if (kept.resolution) resolutions.push(kept.resolution)
      if (kept.seconds) totalSeconds += kept.seconds
      else noDuration += 1
      reused += 1
      continue
    }

    let info
    const startedAt = Date.now()
    try {
      info = await probe(unit.managedPath, options)
    } catch (error) {
      probeMs += Date.now() - startedAt
      probeCount += 1
      failed += 1
      noDuration += 1
      logs.push(`${unit.title || unit.unitId}: ffprobe 失败（${Date.now() - startedAt}ms）${error.message}`)
      continue
    }
    const elapsed = Date.now() - startedAt
    probeMs += elapsed
    probeCount += 1
    const tags = tagsOf(info, options)
    if (!tags.length) {
      noDuration += 1
      logs.push(`${unit.title || unit.unitId}: ffprobe 没给出可用信息（${elapsed}ms）`)
      continue
    }
    unitTags.push({ unitId: unit.unitId, tags })
    if (info.resolution) resolutions.push(info.resolution)
    if (info.duration) totalSeconds += info.duration
    else noDuration += 1
    logs.push(`${unit.title || unit.unitId}: ${tags.join(' / ')}（ffprobe ${elapsed}ms）`)
  }

  logs.push(probeCount
    ? `ffprobe 调用 ${probeCount} 次，总耗时 ${probeMs}ms，平均 ${Math.round(probeMs / probeCount)}ms；另有 ${reused} 个章节复用已有 tag 未调用`
    : `全部 ${reused} 个章节复用已有 tag，ffprobe 调用 0 次`)

  // 媒体维度汇总所有不同的分辨率。混装的合集（1080p + 720p）两个都要，
  // 只留一个会让人以为整套都是那个规格。按像素数从大到小，顺序稳定。
  const itemTags = [...new Set(resolutions)]
    .sort((a, b) => resolutionRank(b) - resolutionRank(a))
    .map((value) => `${options.resolutionPrefix}: ${value}`)
  // 章节时长求和。有章节没读出时长时加 "+"：部分和和完整时长长得一模一样，
  // 不标出来就是一个永远不会被发现的错误。
  if (totalSeconds) {
    itemTags.push(`${options.durationPrefix}: ${formatDuration(totalSeconds)}${noDuration ? '+' : ''}`)
    if (noDuration) logs.push(`时长总和不完整：${noDuration}/${units.length} 个章节没有时长，已标 "+"`)
  }
  if (failed) logs.push(`${failed} 个单元探测失败`)
  return {
    itemTags,
    unitTags,
    unitPatches: [],
    logs,
    details: {
      probed: probeCount - failed,
      failed,
      reused,
      probeMs,
      totalSeconds,
      partialDuration: Boolean(noDuration),
      resolutions: [...new Set(resolutions)],
    },
  }
}

// 把章节已有 tag 里属于本脚本的那部分挑回来。分辨率和时长都挑不到就返回 null，
// 说明这个章节没跑过或上次失败，交给 ffprobe。
// 只认当前配置会产出的前缀：extraTags 关掉之后，上次写的「像素/码率」就不该再留着。
function reusableTags(tags, options) {
  const prefixes = ownedPrefixes(options)
  const kept = (tags || []).map(String).filter((tag) => prefixes.some((p) => tag.startsWith(p)))
  const valueOf = (prefix) => {
    const hit = kept.find((tag) => tag.startsWith(prefix))
    return hit ? hit.slice(prefix.length).trim() : ''
  }
  const resolution = valueOf(`${options.resolutionPrefix}: `)
  const duration = valueOf(`${options.durationPrefix}: `)
  if (!resolution && !duration) return null
  return { tags: kept, resolution, seconds: parseDuration(duration) }
}

function ownedPrefixes(options) {
  const base = [`${options.resolutionPrefix}: `, `${options.durationPrefix}: `]
  if (!options.extraTags) return base
  return [...base, '像素: ', '视频编码: ', '音频编码: ', '声道: ', '码率: ', '帧率: ']
}

// formatDuration 的逆运算：2 段是 m:s，3 段是 h:m:s，没有歧义。
// 秒以下的精度是 formatDuration 写入时就丢掉的，N 个章节累加最多差 N/2 秒。
function parseDuration(text) {
  const parts = String(text || '').replace(/\+$/, '').split(':').map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
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
      ? resolutionLabel(video.width, video.height) : '',
    pixels: video && !COVER_CODECS.includes(video.codec_name) && video.width && video.height
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
  if (info.pixels && info.pixels !== info.resolution) out.push(`像素: ${info.pixels}`)
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

// 主流档位简化成 1080P 这种写法；非主流保留 WxH，不硬塞进最近的档。
// 判定用 max(高, 宽*9/16)：2.35:1 的片源是 1920x816，只看高会判成 720P；
// 只看宽又会让 4:3 的 640x480 判成 360P。竖屏按短边（1080x1920 就是 1080P）。
const RESOLUTION_TABLE = [[2000, '4K'], [1300, '1440P'], [950, '1080P'], [620, '720P'],
  [520, '576P'], [440, '480P'], [330, '360P']]

function resolutionLabel(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w || !h) return ''
  const nominal = h > w ? w : Math.max(h, Math.round((w * 9) / 16))
  for (const [floor, label] of RESOLUTION_TABLE) {
    if (nominal >= floor) return label
  }
  return `${w}x${h}`
}

// 媒体维度排序用：1080P 这种标签没法直接比大小，按档位表的位置排。
function resolutionRank(label) {
  const index = RESOLUTION_TABLE.findIndex(([, name]) => name === label)
  if (index >= 0) return RESOLUTION_TABLE.length - index
  const [w, h] = String(label).split('x').map(Number)
  return -((Number(w) || 0) * (Number(h) || 0))   // 非主流排在主流之后
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
    // 分辨率和时长是主信息。前缀可配是因为 UI 要按前缀把它们挑出来单独渲染，
    // 但那两个前缀在 app.js 里是写死的（MEDIA_INFO_RESOLUTION / MEDIA_INFO_DURATION），
    // 改了这里页面上就找不到了——所以默认值别动。
    resolutionPrefix: String(raw.resolutionPrefix || '分辨率').trim() || '分辨率',
    durationPrefix: String(raw.durationPrefix || '时长').trim() || '时长',
    // 编码/码率/帧率这些先存着，显示与否你自己定
    extraTags: raw.extraTags !== false,
    // 强制重新探测。平时章节已有 tag 就直接复用（跑过的库重跑不会调 ffprobe），
    // 所以上次探测结果不对时，只有靠这个开关才能重新读文件。
    forceProbe: raw.forceProbe === true,
  }
}
