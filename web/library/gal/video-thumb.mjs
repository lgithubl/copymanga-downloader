// 视频缩略图：从视频里截一帧 JPEG，缓存在 <DATA_DIR>/cache/gal-thumbs/<前两位>/<sha1>.jpg。
//   键 = sha1(真实路径, mtime, size, 参数版本)：视频改了 / 参数变了就是新文件；命中缓存 = 直接给文件（调用方用 sendCachedFile 发，带长缓存头）
//   并发有上限（排队），同一个视频同时来多次只截一次；ffmpeg 有超时；失败短时间内不重试（ffmpeg 没装 / 视频坏了时不会被卡片列表反复拖慢）
//   截图位置：视频时长的 10%（最多 30 秒），读不到时长用 1 秒；视频比这个位置短就退回第 0 秒
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export const FRAME_VERSION = 'v1-w640-q4'
const FAIL_TTL_MS = 30000

export function createFrameCache({ dir, concurrency = 2, timeoutMs = 20000, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', run = execFileAsync }) {
  const inflight = new Map()   // 缓存键 → Promise<文件路径>
  const failed = new Map()     // 缓存键 → { at, error }
  const waiting = []
  let active = 0
  const slot = () => new Promise((resolve) => { if (active < concurrency) { active += 1; resolve() } else waiting.push(resolve) })
  const release = () => { const next = waiting.shift(); if (next) next(); else active -= 1 }

  const fail = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode })

  async function durationOf(file) {
    try {
      const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: 10000 })
      const seconds = Number(String(stdout).trim())
      return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
    } catch { return 0 }
  }
  async function extract(file, out) {
    const duration = await durationOf(file)
    const at = duration ? Math.min(duration * 0.1, 30) : 1
    const tmp = `${out}.${process.pid}-${Date.now()}.tmp.jpg`
    const args = (seconds) => ['-y', '-v', 'error', '-ss', seconds.toFixed(3), '-i', file, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', tmp]
    try {
      try { await run(ffmpeg, args(at), { timeout: timeoutMs }); await stat(tmp) } catch (error) {
        if (error?.code === 'ENOENT' && !error?.stderr) throw error   // ffmpeg 本身不存在：不用再试
        await run(ffmpeg, args(0), { timeout: timeoutMs })            // 位置超出视频：从头截
      }
      await rename(tmp, out)
    } finally { await rm(tmp, { force: true }).catch(() => {}) }
  }

  return {
    // file：真实视频路径（调用方已经用 resolveAsset 做过「只认媒体目录内」的检查）。返回缓存里的 JPEG 路径；失败抛 { statusCode }
    async frameOf(file) {
      const info = await stat(file)
      const key = createHash('sha1').update(JSON.stringify([file, info.mtimeMs, info.size, FRAME_VERSION])).digest('hex')
      const out = path.join(dir, key.slice(0, 2), `${key}.jpg`)
      try { if ((await stat(out)).size > 0) return out } catch { /* 还没有 */ }
      const bad = failed.get(key)
      if (bad && Date.now() - bad.at < FAIL_TTL_MS) throw bad.error
      let pending = inflight.get(key)
      if (!pending) {
        pending = (async () => {
          await slot()
          try {
            await mkdir(path.dirname(out), { recursive: true })
            await extract(file, out)
            return out
          } catch (error) {
            const reason = error?.code === 'ENOENT' ? 'ffmpeg 不可用（没有安装？）' : error?.killed ? `ffmpeg 超时（${Math.round(timeoutMs / 1000)} 秒）` : `ffmpeg 截帧失败：${String(error?.stderr || error?.message || error).trim().split('\n').pop().slice(0, 200)}`
            const wrapped = fail(`视频缩略图生成失败：${reason}`)
            failed.set(key, { at: Date.now(), error: wrapped })
            throw wrapped
          } finally { release(); inflight.delete(key) }
        })()
        inflight.set(key, pending)
      }
      return pending
    },
  }
}
