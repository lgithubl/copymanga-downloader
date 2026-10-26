// Gal 卡片缩略图：一张卡片有多张图（item.thumbs）时的「随机封面 + 悬停轮播」。纯 DOM 逻辑，浏览器自测见 scripts/dev/fe-gal-thumbs-selftest.mjs。
//   · 封面：thumbMode = random（默认）每次渲染随机选一张；first / hover 固定第一张（first 不轮播，hover 悬停才轮播）
//   · 轮播：鼠标悬停才开始（没悬停的卡片零开销）；其余图随机顺序、每张 700–900ms；下一张先预加载好再换（不闪、不空白）；
//     移开立刻停并还原封面；prefers-reduced-motion、触摸、标签页在后台、封面还没加载好（thumbLoader 还没放行 / 加载失败）都不轮播
//   · 封面 <img> 的首次加载仍由 thumbLoader 管（data-src）；这里只在它加载完之后改 src，不碰 data-src
const VIDEO_EXT = /\.(mp4|mkv|webm|mov|m4v)$/i
export const isVideoSrc = (path) => VIDEO_EXT.test(String(path))
export const INTERVAL_MS = [700, 900]

// 图的地址：视频带 frame=1，服务端给一帧 JPEG（video-thumb.mjs）
export const thumbUrl = (base, path) => `${base}?path=${encodeURIComponent(path)}${isVideoSrc(path) ? '&frame=1' : ''}`

export function shuffled(list, rand = Math.random) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}
// 封面选哪张：random 且有多张 = 随机，其余 = 第一张
export const pickCover = (count, mode = 'random', rand = Math.random) => (mode === 'random' && count > 1 ? Math.min(count - 1, Math.floor(rand() * count)) : 0)

// target：接收 hover 的元素（卡片）；img：封面 <img>；urls：全部图的地址；coverAt：封面是第几张
export function attachThumbCycle({ target, img, urls, coverAt = 0, win = window, rand = Math.random }) {
  if (urls.length < 2) return null
  let timer = 0
  let token = 0
  let active = false
  let home = ''
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const delay = () => INTERVAL_MS[0] + rand() * (INTERVAL_MS[1] - INTERVAL_MS[0])
  const preload = (url) => new Promise((resolve) => { const probe = new win.Image(); probe.onload = () => resolve(true); probe.onerror = () => resolve(false); probe.src = url })

  function stop() {
    if (!active) return
    active = false
    token += 1
    win.clearTimeout(timer)
    if (home && img.getAttribute('src') !== home) img.src = home
  }
  function start(event) {
    if (active || (event?.pointerType && event.pointerType !== 'mouse') || reduced()) return
    if (!img.isConnected || !img.complete || !img.naturalWidth) return
    active = true
    const mine = ++token
    home = img.getAttribute('src') || ''
    let last = coverAt
    let queue = []
    const nextIndex = () => {
      if (!queue.length) queue = shuffled(urls.map((_, i) => i).filter((i) => i !== last), rand)
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
      if (ok) { img.src = urls[index]; last = index; misses = 0 } else if (++misses >= urls.length) { stop(); return }
      upcoming = nextIndex()
      preload(urls[upcoming])   // 预热下一张，到点直接换
      timer = win.setTimeout(step, delay())
    }
    timer = win.setTimeout(step, delay())
  }
  const onEnter = (event) => start(event)
  target.addEventListener('pointerenter', onEnter)
  target.addEventListener('pointerleave', stop)
  target.addEventListener('pointercancel', stop)
  return { stop, destroy: () => { stop(); target.removeEventListener('pointerenter', onEnter); target.removeEventListener('pointerleave', stop); target.removeEventListener('pointercancel', stop) } }
}
