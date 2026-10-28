// 骨骼 / 立绘场景的「渲染缩略图」：列表页里卡片没有规则给的图、脚本里却有骨骼（spine 指令）时，浏览器离屏渲染一帧（背景 + 骨骼），
// 传回服务器按 key 缓存（PUT …/render-thumb?key=）；之后所有人 / 下次进列表直接取缓存图（GET，命中 200，没有 404）。
//   · 并发：全局队列，同时最多 concurrency 张（默认 1，一次一个 WebGL 上下文，渲染完就销毁）；只渲染滚到可见附近的卡片（调用方在图加载失败时才入队）
//   · 失败：不缓存、不写任何标记——渲染失败 / 超时 / 骨骼加载失败 / 画面是空的都只是这一次没有图，下次重建列表页还会再试（同一个页面里同一张最多试一次，免得循环）
//   · 页面销毁（destroy）：排队的任务丢掉，正在渲染的做完就丢结果
// 选哪一帧：CG 优先（bg.over / 静态画面骨骼 / 铺满的叠加图），其次有立绘 / 骨骼角色的画面（见 pickRenderStep）；整个画面（背景 + 立绘 + 骨骼 + 叠加层）都画，和播放页同一套摆放。
import { assetUrl, stateAt } from '/gal-engine.js'
import { createSpineLayer } from '/gal-spine.js'
import { createOverlayLayer, createStageMedia, createStandLayer } from '/gal-stand.js'

const loadImage = (url) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`图片加载失败：${url}`)); img.src = url })
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
const withTimeout = (promise, ms, what) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`${what}超时（${Math.round(ms / 1000)} 秒）`)), ms); promise.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) }) })

// 画面选哪一步：要「真正的场景」——CG（bg 带 over / 静态画面骨骼 still / 铺满的叠加图）优先，其次有立绘 / 骨骼角色的画面，最后才是纯背景。
//   分数：CG 100（bg.over）/ 90（spine kind still）/ 60（overlay 带 src）；角色 30（spine / stand）；纯背景 1。取分数最高的，同分取最早的；
//   角色画面往后推 2 步（表情通常紧跟着出来），CG 就用它出现的那一步。只在有画面指令的步重新算状态（台词步状态不变）
const VISUAL_OPS = new Set(['bg', 'spine', 'spineOff', 'stand', 'standOff', 'overlay', 'overlayOff', 'movie', 'movieOff'])
export function scoreState(state) {
  if (state.bg?.over) return 100
  if (Object.values(state.spines || {}).some((spec) => spec?.kind === 'still')) return 90
  if ((state.overlays || []).some((o) => o?.src)) return 60
  if (Object.keys(state.spines || {}).length || state.stand?.parts?.length || (state.stands || []).length) return 30
  return state.bg?.src ? 1 : 0
}
export function pickRenderStep(scene, scanSteps = 150, after = 2) {
  const steps = Array.isArray(scene?.steps) ? scene.steps : []
  const limit = Math.min(steps.length, Math.max(scanSteps * 4, 600))
  let best = null
  for (let i = 0; i < limit; i++) {
    if (!steps[i].commands?.some((c) => VISUAL_OPS.has(c.op))) continue
    const state = stateAt(scene, i)
    const score = scoreState(state)
    if (score > (best?.score ?? 0)) best = { index: i, score }
    if (score >= 100) break
  }
  if (!best || best.score < 30) return null   // 只有背景（或什么都没有）：这种卡片用普通的图片缩略图就行
  const index = best.score >= 60 ? best.index : Math.min(steps.length - 1, best.index + after)
  return { index, score: best.score, state: stateAt(scene, index) }
}

// 缩略图的骨骼：每个角色动画从 seek（0~1）处取一帧
function seekAll(spines, seek) {
  const f = Number(seek)
  if (!(f > 0)) return spines
  return Object.fromEntries(Object.entries(spines).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, seek: f } : v]))
}

// cfg：{ apiBase（…/api/library/items/gal/<id>）, resourceBase, node, key, width, cameraMode, scanSteps }
export async function renderSceneThumb(cfg, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const width = Math.max(160, Math.min(1280, Number(cfg.width) || 640))
  const height = Math.round((width * 9) / 16)
  const res = await fetchImpl(`${cfg.apiBase}/reader/main?sectionId=${encodeURIComponent(cfg.node)}`)
  if (!res.ok) throw new Error(`取脚本失败：HTTP ${res.status}`)
  const data = await res.json()
  const scene = data.scene || data.node?.scene
  const picked = pickRenderStep(scene, cfg.scanSteps)
  if (!picked) throw new Error('脚本里没有 CG / 立绘 / 骨骼画面')
  const { state } = picked
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  const cover = (img) => {
    const k = Math.max(width / img.naturalWidth, height / img.naturalHeight)
    ctx.drawImage(img, (width - img.naturalWidth * k) / 2, (height - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k)
  }
  if (Array.isArray(state.bg?.color)) { ctx.fillStyle = `rgb(${state.bg.color.join(',')})`; ctx.fillRect(0, 0, width, height) }
  const url = (src) => assetUrl(cfg.resourceBase, src)
  for (const src of [state.bg?.src, state.bg?.over]) {
    if (!src) continue
    try { cover(await loadImage(url(src))) } catch { /* 背景缺了：别的层照画 */ }
  }
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;pointer-events:none;overflow:hidden`
  const style = document.createElement('style')
  style.textContent = '.gal-thumb-host canvas{position:absolute;left:0;top:0;width:100%;height:100%}'
  host.className = 'gal-thumb-host'
  host.append(style)
  document.body.append(host)
  const errors = []
  const media = createStageMedia({ url, onMissing: (s) => errors.push(`缺 ${s}`) })
  const standLayer = createStandLayer({ parent: host, url, onMissing: (s) => errors.push(`缺 ${s}`), media })
  const overlayLayer = createOverlayLayer({ parent: host, url, onMissing: (s) => errors.push(`缺 ${s}`), media })
  const underLayer = createOverlayLayer({ parent: host, url, onMissing: (s) => errors.push(`缺 ${s}`), media, under: true })
  const hasSpines = Object.keys(state.spines || {}).length > 0
  const spineLayer = hasSpines ? createSpineLayer({ parent: host, url, onMissing: (s) => errors.push(`缺 ${s}`), onUnavailable: (v) => errors.push(`运行时 ${v}`), onError: (e) => errors.push(String(e)) }) : null
  try {
    await withTimeout((async () => {
      await standLayer.set(state.stand, state.stands, { live: false })
      await overlayLayer.set(state.overlays.filter((o) => !o.under), { live: false })
      await underLayer.set(state.overlays.filter((o) => o.under), { live: false })
      if (spineLayer) { await spineLayer.set(seekAll(state.spines, cfg.seek), { live: false, view: { camera: { mode: cfg.cameraMode === 'fixed' || cfg.cameraMode === 'widget' ? cfg.cameraMode : 'fit' } } }); await spineLayer.ready() }
      await frame(); await frame()
    })(), timeoutMs, '渲染画面')
    if (spineLayer) {
      const info = spineLayer.info()
      if (!info.length || info.some((r) => !r.loaded || r.error)) throw new Error(`骨骼没加载好：${errors.concat(info.map((r) => r.error?.message || r.error || '')).filter(Boolean).join('；') || '未知原因'}`)
    }
    // 叠放顺序和播放页一致：立绘 → 骨骼 → 叠加层
    const order = [underLayer.canvas, standLayer.canvas, ...(spineLayer ? [...host.querySelectorAll('canvas.gal-spine')] : []), overlayLayer.canvas]
    let drew = 0
    for (const cv of order) { if (cv?.width && cv?.height) { ctx.drawImage(cv, 0, 0, width, height); drew += 1 } }
    if (!drew) throw new Error('没有可画的层')
  } finally { spineLayer?.destroy(); standLayer.destroy(); overlayLayer.destroy(); underLayer.destroy(); host.remove() }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob || blob.size < 200) throw new Error('导出图片失败')
  return blob
}

// 全局渲染队列（所有列表页共用一个：快速翻页 / 换节点时旧页面的排队任务被丢掉，不会叠出很多个 WebGL 上下文）
// enqueue(task) → Promise<Blob>（失败 reject，调用方吞掉就行）；task = renderSceneThumb 的 cfg
const shared = { active: 0, waiting: [] }
export function createThumbRenderer({ concurrency = 1, render = renderSceneThumb, upload = null } = {}) {
  let destroyed = false
  const attempted = new Set()   // 这个页面里已经试过的 key：同一张最多试一次（失败后下次重建页面再试）
  const pump = () => {
    while (shared.active < Math.max(1, concurrency) && shared.waiting.length) {
      const job = shared.waiting.shift()
      if (job.owner.destroyed()) { job.reject(new Error('已销毁')); continue }
      shared.active += 1
      Promise.resolve()
        .then(() => render(job.task))
        .then(async (blob) => {
          if (upload) { try { await upload(job.task, blob) } catch { /* 传不上去：这一页照样用，下次进来再渲染一次 */ } }
          job.resolve(blob)
        }, (error) => job.reject(error))
        .finally(() => { shared.active -= 1; pump() })
    }
  }
  const owner = { destroyed: () => destroyed }
  return {
    enqueue(task) {
      if (destroyed) return Promise.reject(new Error('已销毁'))
      if (attempted.has(task.key)) return Promise.reject(new Error('这个页面里已经试过了'))
      attempted.add(task.key)
      return new Promise((resolve, reject) => { shared.waiting.push({ task, resolve, reject, owner }); pump() })
    },
    get pending() { return shared.waiting.filter((j) => j.owner === owner).length },
    destroy() { destroyed = true; for (let i = shared.waiting.length - 1; i >= 0; i--) if (shared.waiting[i].owner === owner) shared.waiting.splice(i, 1)[0].reject(new Error('已销毁')) },
  }
}
export const _sharedForTest = shared
