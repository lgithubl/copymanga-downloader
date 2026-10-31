// Gal 卡片缩略图：一张卡片有多张图（item.thumbs）时的「随机封面 + 悬停轮播」。纯 DOM 逻辑，浏览器自测见 scripts/dev/fe-gal-thumbs-selftest.mjs。
//   · 封面：thumbCover = random（默认）每次渲染随机选一张 | first | last | { index: N }（旧的 thumbMode：first / hover = 第一张，first 同时不轮播）
//   · 轮播（thumbHover：enabled / count / order / intervalMs）：鼠标悬停才开始（没悬停的卡片零开销）；封面 + 最多 count-1 张其余图，random 随机顺序 / sequential 按原顺序，每张 intervalMs（默认 700–900ms）；下一张先预加载好再换（不闪、不空白）；
//     移开立刻停并还原封面；触摸、标签页在后台、封面还没加载好（thumbLoader 还没放行 / 加载失败）都不轮播
//   · 封面 <img> 的首次加载仍由 thumbLoader 管（data-src）；这里只在它加载完之后改 src，不碰 data-src
const VIDEO_EXT = /\.(mp4|mkv|webm|mov|m4v)$/i
export const isVideoSrc = (path) => VIDEO_EXT.test(String(path))
export const INTERVAL_MS = [700, 900]
export const DEFAULT_HOVER = { enabled: true, mode: 'hover', count: 4, order: 'random', intervalMs: INTERVAL_MS }

// 图的地址：视频带 frame=1，服务端给一帧 JPEG（video-thumb.mjs）
// 图片带 w=<宽度>：服务端给缩小后的 WebP（卡片用，不要几 MB 的原图）；width 传 0 / 不传 = 原图
export const thumbUrl = (base, path, width = 0) => `${base}?path=${encodeURIComponent(path)}${isVideoSrc(path) ? '&frame=1' : width > 0 ? `&w=${Math.round(width)}` : ''}`
export const CARD_THUMB_WIDTH = 480   // 卡片缩略图的宽度（3:4 / 16:9 的卡片最宽约 300 CSS 像素，留 HiDPI 余量）

export function shuffled(list, rand = Math.random) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}
// 封面选哪张。cover：random（多张时随机）| first | last | { index: N }（超出取最后一张）；旧的 thumbMode 字符串（first / hover）按第一张
export function pickCover(count, cover = 'random', rand = Math.random) {
  if (count <= 1) return 0
  if (cover === 'random') return Math.min(count - 1, Math.floor(rand() * count))
  if (cover === 'last') return count - 1
  if (cover && typeof cover === 'object' && Number.isFinite(Number(cover.index))) return Math.max(0, Math.min(count - 1, Math.floor(Number(cover.index))))
  return 0
}

// 悬停轮播用哪几张、什么顺序（不含封面本身）：总共最多 count 张（含封面）。random = 随机挑 count-1 张其余的、随机顺序；sequential = 封面之后按原顺序（到头绕回开头）
export function hoverPlan(total, coverAt, hover = DEFAULT_HOVER, rand = Math.random) {
  const count = Math.max(1, Math.min(total, Math.floor(Number(hover.count)) || DEFAULT_HOVER.count))
  const others = Array.from({ length: total }, (_, i) => i).filter((i) => i !== coverAt)
  if (hover.order === 'sequential') {
    const after = [...others.filter((i) => i > coverAt), ...others.filter((i) => i < coverAt)]
    return after.slice(0, count - 1)
  }
  return shuffled(others, rand).slice(0, count - 1)
}

// hover.mode：hover（默认，鼠标悬停才轮播）| auto（在屏幕里的卡片自己轮播）
// target：接收 hover 的元素（卡片）；img：封面 <img>；urls：全部图的地址；coverAt：封面是第几张
export function attachThumbCycle({ target, img, urls, coverAt = 0, hover = DEFAULT_HOVER, isEnabled = () => true, onStart = null, win = window, rand = Math.random }) {
  if (urls.length < 2) return null
  const range = Array.isArray(hover.intervalMs) && hover.intervalMs.length === 2 ? hover.intervalMs : INTERVAL_MS
  let onMiss = () => {}
  let timer = 0
  let token = 0
  let active = false
  let home = ''
  // 系统「减少动态效果」：只挡 auto（不用悬停、自己一直在换图）；悬停轮播是用户主动触发的、只是换一张图（没有动画），不挡——
  // 不然 Windows 关了「动画效果」的机器上轮播永远不动，还没有任何提示
  // 「更多」里用户明确选了「自动」（hover.explicit）= 用户要它动，不挡；只有跟随配置的 auto 才让路
  const reduced = () => hover.mode === 'auto' && !hover.explicit && Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const delay = () => range[0] + rand() * (range[1] - range[0])
  const preload = (url) => new Promise((resolve) => { const probe = new win.Image(); probe.onload = () => resolve(true); probe.onerror = () => resolve(false); probe.src = url })

  function stop() {
    if (!active) return
    active = false
    token += 1
    win.clearTimeout(timer)
    if (home && img.getAttribute('src') !== home) img.src = home
  }
  function start(event) {
    if (active || !hover.enabled || !isEnabled() || (event?.pointerType && event.pointerType !== 'mouse') || reduced()) return
    if (!img.isConnected || !img.complete || !img.naturalWidth) return
    active = true
    try { onStart?.() } catch { /* 钩子出错不影响轮播 */ }
    const mine = ++token
    home = img.getAttribute('src') || ''
    let last = coverAt
    let queue = []
    // 这次悬停用的图：封面 + hoverPlan 挑出的（总共最多 count 张），一轮轮着来：random = 每轮洗牌（不含当前这张，不和上一张连着重复）；sequential = 按原顺序接着当前这张往后
    const set = [coverAt, ...hoverPlan(urls.length, coverAt, hover, rand)]
    const nextIndex = () => {
      if (!queue.length) {
        const rest = set.filter((i) => i !== last)
        if (hover.order === 'sequential') { const order = [...set].sort((a, b) => a - b); const at = order.indexOf(last); queue = [...order.slice(at + 1), ...order.slice(0, at)].filter((i) => i !== last) }
        else queue = shuffled(rest, rand)
      }
      return queue.shift()
    }
    let upcoming = nextIndex()
    let misses = 0
    preload(urls[upcoming])
    const step = async () => {
      const index = upcoming
      const ok = await preload(urls[index])
      if (token !== mine || !active) return
      if (reduced() || win.document.hidden || !img.isConnected) { stop(); return }
      if (ok) { img.src = urls[index]; last = index; misses = 0 } else if (++misses >= urls.length) { stop(); onMiss(); return }
      upcoming = nextIndex()
      preload(urls[upcoming])   // 预热下一张，到点直接换
      timer = win.setTimeout(step, delay())
    }
    timer = win.setTimeout(step, delay())
  }
  // auto：不用悬停，在屏幕里的卡片自己轮播（IntersectionObserver：滚出屏幕就停；标签页在后台停；错开启动，别一起换图）。触摸设备也能用
  const auto = hover.mode === 'auto' && typeof win.IntersectionObserver === 'function'
  let visible = false
  let kick = 0
  let retries = 0
  const tryStart = (wait = 200 + rand() * 1000) => {
    win.clearTimeout(kick)
    kick = win.setTimeout(() => { if (visible && !active && !win.document.hidden) start() }, wait)
  }
  // 有的图还没好（渲染缩略图要现渲）：这一轮全 miss 停了，屏幕里还在就隔几秒再试，最多 3 次
  onMiss = () => { if (auto && visible && retries++ < 3) tryStart(4000) }
  const onVisibility = () => { if (win.document.hidden) { win.clearTimeout(kick); stop() } else if (visible) tryStart() }
  const onLoad = () => { if (visible && !active) tryStart() }
  let observer = null
  const onEnter = (event) => start(event)
  if (auto) {
    observer = new win.IntersectionObserver((entries) => {
      for (const entry of entries) {
        visible = entry.isIntersecting
        if (visible) { retries = 0; tryStart() } else { win.clearTimeout(kick); stop() }
      }
    }, { threshold: 0.2 })
    observer.observe(target)
    img.addEventListener('load', onLoad)
    win.document.addEventListener('visibilitychange', onVisibility)
  } else {
    target.addEventListener('pointerenter', onEnter)
    target.addEventListener('pointerleave', stop)
    target.addEventListener('pointercancel', stop)
  }
  return {
    stop,
    destroy: () => {
      stop()
      win.clearTimeout(kick)
      observer?.disconnect()
      img.removeEventListener('load', onLoad)
      win.document.removeEventListener('visibilitychange', onVisibility)
      target.removeEventListener('pointerenter', onEnter); target.removeEventListener('pointerleave', stop); target.removeEventListener('pointercancel', stop)
    },
  }
}
