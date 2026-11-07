// E-mote 立绘层（Artemis 的 image/fg/*.psb）：用 FreeMote SDK 的 WebGL 引擎（vendor/FreeMoteDriver.js + vendor/emoteplayer.js，构建时下载，见 scripts/fetch-emote-runtime.sh）播放。
//   模型 = 服务端转好的纯 PSB（containers 的 image/fg/<名>.emote.psb：头解密 + 规格改 common + 贴图字节序，见 web/library/gal/emote-psb.mjs）。
//   spec = { slot, src, main（主时间线，如「通常待机」）, diff（差分时间线，如「笑顔Ａ」= 表情）, x（设计像素的水平偏移）, view: 'bust' | 'full', zoom, top }
//   引擎要求：同一页面只有一个共用的渲染画布（EmotePlayer.createRenderCanvas，这里 1920×1080 = 设计坐标）；每个 EmotePlayer 把画面画进自己指定的 canvas，多个角色画进同一个 canvas。
//   运行时没下载到 / 加载失败：layer.available() = false，播放器退回静态立绘；单个模型加载失败：这个槽位不在 live() 里，播放器继续画它的静态图。
const DESIGN_W = 1920
const DESIGN_H = 1080
let runtime = null   // Promise<boolean>
// emoteplayer.js 里 EmotePlayer 是顶层 class 声明：不是 window 的属性（globalThis.EmotePlayer 取不到），只能按全局词法作用域取
let EmotePlayerClass = null
const findEmotePlayer = () => { try { return new Function('return typeof EmotePlayer === "function" ? EmotePlayer : null')() } catch { return null } }

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script')
  s.src = src
  s.onload = () => resolve()
  s.onerror = () => reject(new Error(`加载 ${src} 失败`))
  document.head.append(s)
})

export function loadEmoteRuntime() {
  if (!runtime) {
    runtime = (async () => {
      try {
        // 引擎（asm.js）的堆写死 96MB 不能增长：一个模型（PSB 34MB + 贴图 32MB）就占掉大半，两个角色同屏 / 重新加载会报「Cannot enlarge memory arrays」。
        // 预先定义 Module.TOTAL_MEMORY 就能放大（引擎读 Module["TOTAL_MEMORY"]||100663296）：按能不能分配到试 384 / 192MB；都不行就用它自己的默认值
        if (!globalThis.Module || !globalThis.Module.TOTAL_MEMORY) {
          for (const mb of [384, 192]) {
            try { new ArrayBuffer(mb * 1024 * 1024); globalThis.Module = { ...(globalThis.Module || {}), TOTAL_MEMORY: mb * 1024 * 1024 }; break } catch { /* 分配不到：试小一点 */ }
          }
        }
        await loadScript('/vendor/FreeMoteDriver.js')
        await loadScript('/vendor/emoteplayer.js')
        for (let i = 0; i < 100 && !(globalThis.Module?.calledRun || globalThis.EmoteDriver_Initialized); i += 1) await new Promise((r) => setTimeout(r, 50))
        EmotePlayerClass = findEmotePlayer()
        if (!EmotePlayerClass) return false
        if (!EmotePlayerClass.renderCanvas) EmotePlayerClass.createRenderCanvas(DESIGN_W, DESIGN_H)
        return true
      } catch (error) {
        console.warn('[gal-emote]', error.message)
        return false
      }
    })()
  }
  return runtime
}

export function createEmoteLayer({ parent, url, onChange = () => {} }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'gal-emote'
  canvas.width = DESIGN_W
  canvas.height = DESIGN_H
  parent.append(canvas)
  const players = new Map()   // slot → { src, player, state: 'loading' | 'ready' | 'failed', spec }
  let ok = null               // 运行时能不能用（null = 还没知道）
  let seq = 0

  const place = (entry) => {
    const { player, spec } = entry
    const b = player.charaBounds || {}
    const top = Number.isFinite(b.top) ? b.top : -1320
    const bottom = Number.isFinite(b.bottom) ? b.bottom : 1958
    const mid = Number.isFinite(b.left) && Number.isFinite(b.right) ? (b.left + b.right) / 2 : 0
    const margin = Math.max(0, Math.min(0.4, Number(spec.top) || 0.04))
    const scale = spec.view === 'full' ? (DESIGN_H * (1 - 2 * margin)) / (bottom - top) : Math.max(0.05, Number(spec.zoom) || 0.72)
    const y = margin * DESIGN_H - DESIGN_H / 2 - top * scale
    player.setScale(scale)
    player.setCoord((Number(spec.x) || 0) - mid * scale, y)
  }
  const apply = (entry) => {
    const { player, spec } = entry
    place(entry)
    if (spec.main && player.mainTimelineLabel !== spec.main) player.mainTimelineLabel = spec.main
    if ((player.diffTimelineSlot1 || '') !== (spec.diff || '')) player.diffTimelineSlot1 = spec.diff || ''
  }

  async function set(specs) {
    const mine = ++seq
    if (ok === null) {
      ok = await loadEmoteRuntime()
      if (!ok) onChange()   // 只在第一次发现不能用时通知一次（播放器重画静态立绘），不然 onChange → set → onChange 会转圈
    }
    if (mine !== seq) return
    if (!ok) return
    const want = new Map((specs || []).filter((s) => s && s.slot && s.src).map((s) => [String(s.slot), s]))
    for (const [slot, entry] of players) {
      if (want.has(slot) && want.get(slot).src === entry.src) continue
      try { entry.player.hide = true; entry.player.unloadData() } catch { /* 已经不在了 */ }
      players.delete(slot)
    }
    for (const [slot, spec] of want) {
      const have = players.get(slot)
      if (have) { have.spec = spec; if (have.state === 'ready') apply(have); continue }
      const player = new EmotePlayerClass(canvas)
      const entry = { src: spec.src, player, state: 'loading', spec }
      players.set(slot, entry)
      player.promiseLoadDataFromURL(url(spec.src)).then(() => {
        if (players.get(slot) !== entry) { try { player.unloadData() } catch { /* 换掉了 */ } return }
        entry.state = 'ready'
        apply(entry)
        onChange()
      }).catch((error) => {
        console.warn('[gal-emote] 加载失败', spec.src, error?.message || error)
        entry.state = 'failed'
        onChange()
      })
    }
    canvas.hidden = players.size === 0
    if (!players.size) canvas.getContext('2d').clearRect(0, 0, DESIGN_W, DESIGN_H)   // 最后一个走了：引擎不再画，上一帧会留在画布上
  }

  return {
    set,
    available: () => ok !== false,
    live: () => new Set([...players].filter(([, e]) => e.state === 'ready').map(([slot]) => slot)),
    clear() { seq += 1; for (const [, e] of players) { try { e.player.hide = true; e.player.unloadData() } catch { /* 忽略 */ } } players.clear(); canvas.hidden = true; canvas.getContext('2d').clearRect(0, 0, DESIGN_W, DESIGN_H) },
    destroy() { this.clear(); canvas.remove() },
    canvas,
  }
}
