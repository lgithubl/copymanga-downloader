#!/usr/bin/env node
// 自测（纯 node）：缩略图的视频 / 渲染两块配置——兜底收 movie、thumbFrame（视频截哪一帧）、thumbRender 校验、截帧缓存键 / 位置、渲染队列（并发 / 失败 / 销毁）
import { collectFallbackImages } from '../../web/library/gal/fallback-thumbs.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { createFrameCache } from '../../web/library/gal/video-thumb.mjs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

// 兜底收 movie
const scene = { steps: [{ commands: [{ op: 'bg', src: 'bg/a.png' }, { op: 'movie', srcs: ['v/one.mp4', 'v/two.webm'], loop: true }] }, { commands: [{ op: 'stand', parts: [{ src: 'st/x.png' }] }] }] }
const order = (cfg) => collectFallbackImages(scene, cfg).images.map((i) => `${i.kind}:${i.src}`)
check('兜底默认：事件图 → 立绘 → 视频 → 背景；movie 指令的 srcs 都收（视频），背景最后', J(order({})) === J(['stand:st/x.png', 'movie:v/one.mp4', 'movie:v/two.webm', 'bg:bg/a.png']), J(order({})))
check('prefer 里没写 movie = 不收视频（旧行为）；prefer 把 movie 放最前 = 视频帧优先', J(order({ prefer: ['cg', 'stand', 'bg'] })) === J(['stand:st/x.png', 'bg:bg/a.png']) && order({ prefer: ['movie', 'bg'] })[0] === 'movie:v/one.mp4', J(order({ prefer: ['movie', 'bg'] })))

// kindMax：立绘 / 表情差分很多时每类限张数
const many = { steps: [{ commands: [{ op: 'bg', src: 'bg/a.png' }, { op: 'bg', src: 'bg/b.png' }, ...['f1', 'f2', 'f3', 'f4'].map((n) => ({ op: 'stand', parts: [{ src: `st/${n}.png` }] }))] }] }
const many2 = collectFallbackImages(many, { prefer: ['cg', 'bg', 'stand'], kindMax: { stand: 1 } }).images.map((i) => `${i.kind}:${i.src}`)
check('kindMax { stand: 1 }：4 张表情差分的立绘只留 1 张，背景在前（prefer cg, bg, stand）', J(many2) === J(['bg:bg/a.png', 'bg:bg/b.png', 'stand:st/f1.png']), J(many2))
const kc = normalizeGalConfig({ thumbFallback: { kindMax: { stand: 1, zzz: 2, bg: 'x' } } }).thumbFallback.kindMax
check('kindMax 校验：不认识的类 / 非数字丢掉，默认空（不限）', J(kc) === J({ stand: 1 }) && J(normalizeGalConfig({}).thumbFallback.kindMax) === '{}', J(kc))

// 配置校验
const c = normalizeGalConfig({ thumbFrame: { percent: 2, seconds: 5, max: 0, zzz: 1 }, thumbRender: { enabled: 'x', width: 99999, scanSteps: 1, concurrency: 9, extra: 1 } })
check('thumbFrame 夹范围（percent ≤ 0.95、max ≥ 1）；thumbRender 夹范围、类型不对 / 不认识的字段丢掉', c.thumbFrame.percent === 0.95 && c.thumbFrame.seconds === 5 && c.thumbFrame.max === 1 && c.thumbRender.width === 1280 && c.thumbRender.scanSteps === 10 && c.thumbRender.concurrency === 3 && c.thumbRender.enabled === true, J([c.thumbFrame, c.thumbRender]))
const d = normalizeGalConfig({})
check('默认：thumbFrame { 0.5, 0, 3600, skipDark }；thumbRender 开、640、150 步、并发 1、seek 0.5、胶片中间帧最多 4 段', J(d.thumbFrame) === J({ percent: 0.5, seconds: 0, max: 3600, skipDark: true }) && J(d.thumbRender) === J({ enabled: true, width: 640, scanSteps: 150, concurrency: 1, seek: 0.5, film: true, filmFrame: 0.5, filmMax: 4 }), J([d.thumbFrame, d.thumbRender]))

// 截帧：位置按配置（ffmpeg 用假的记录参数）
{
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rt-'))
  const video = path.join(dir, 'v.mp4'); await writeFile(video, 'x')
  const calls = []
  const run = async (cmd, args) => {
    if (cmd === 'ffprobe') return { stdout: '100\n' }
    if (args.some((a) => String(a).includes('signalstats'))) return { stdout: '' }   // 亮度探测：取不到 = 不当黑屏
    calls.push(args[args.indexOf('-ss') + 1]); await writeFile(args.at(-1), Buffer.alloc(300, 1)); return { stdout: '' }
  }
  const cache = createFrameCache({ dir: path.join(dir, 'c'), run })
  await cache.frameOf(video)                                      // 默认：100 × 0.1 = 10 秒
  await cache.frameOf(video, { percent: 0.5, max: 30 })           // 50 秒，封顶 30
  await cache.frameOf(video, { seconds: 7 })                      // 固定 7 秒
  await cache.frameOf(video, { seconds: 7 })                      // 同一位置命中缓存，不再截
    await cache.frameOf(video, { percent: 0.1 })                    // 10 秒（和默认 50 秒不是同一个缓存）
  check('截帧位置：默认时长 × 0.5 = 50 秒；percent 0.5 且 max 30 → 30 秒；seconds 7 → 7 秒；同位置命中缓存', J(calls) === J(['50.000', '30.000', '7.000', '10.000']), J(calls))
  // 黑屏跳过：50% 处太黑 → 换 80%（亮度由 signalstats 报）
  const calls2 = []
  const bright = { '50.000': 3, '80.000': 90 }
  const run2 = async (cmd, args) => {
    if (cmd === 'ffprobe') return { stdout: '100\n' }
    const at = args[args.indexOf('-ss') + 1]
    if (args.some((a) => String(a).includes('signalstats'))) return { stdout: `lavfi.signalstats.YAVG=${bright[at] ?? 1}\n` }
    calls2.push(at); await writeFile(args.at(-1), Buffer.alloc(300, 1)); return { stdout: '' }
  }
  await createFrameCache({ dir: path.join(dir, 'c2'), run: run2 }).frameOf(video)
  check('50% 处是黑屏（YAVG 3）→ 换到 80% 处（YAVG 90）截帧；固定 seconds 不换', J(calls2) === J(['80.000']), J(calls2))
  await rm(dir, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
