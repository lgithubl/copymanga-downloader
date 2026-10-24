// 媒体库卡片缩略图的分批加载器。卡片的 <img> 只带 data-src，由它决定什么时候真正请求：
//   · 第一批（firstBatch 张）：列表一渲染完就请求，哪怕标签页在后台——这样切过去时第一屏已经有图，不用再等
//   · 之后每批（batch 张）：滚动到附近（视口外 600px 内）时才请求；标签页在后台时不请求，第一次可见时才开始
//   · 并发：同时在飞的请求数有上限（前台 concurrency，后台 concurrencyHidden）。浏览器对同一主机最多 6 个连接、所有标签页共用，
//     一个页面一口气发几十上百个请求会把连接占满，别的页面的接口请求（点标签、翻页、打开阅读器）要等它们
//   · 页面重新渲染 / 离开：没发出去的丢掉，已经在飞的中止（removeAttribute('src')），不残留
// 设置来自服务端配置（libraryThumbFirstBatch / libraryThumbBatch / libraryThumbConcurrency / libraryThumbConcurrencyHidden），
// 用函数取，配置改了下一次渲染就生效。纯 DOM 逻辑、不依赖 app.js，浏览器自测见 scripts/dev/fe-thumbs-selftest.mjs。

const DEFAULTS = { firstBatch: 30, batch: 60, concurrency: 6, concurrencyHidden: 2 }
const ROOT_MARGIN = '600px 0px'

const intOr = (value, fallback, min) => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && value !== '' && value !== null && value !== undefined ? Math.max(min, n) : fallback
}

export function thumbSettingsFromConfig(config = {}) {
  return {
    firstBatch: intOr(config.libraryThumbFirstBatch, DEFAULTS.firstBatch, 0),
    batch: intOr(config.libraryThumbBatch, DEFAULTS.batch, 1),
    concurrency: intOr(config.libraryThumbConcurrency, DEFAULTS.concurrency, 1),
    concurrencyHidden: intOr(config.libraryThumbConcurrencyHidden, DEFAULTS.concurrencyHidden, 1),
  }
}

export function createThumbLoader({ getSettings = () => DEFAULTS, doc = document } = {}) {
  let pending = []            // 还没放行的 <img>（DOM 顺序）
  let queue = []              // 已放行、等并发名额的
  const inflight = new Set()  // 正在加载的
  let observer = null
  let generation = 0          // attach 一次 +1；旧一轮的回调看到不一致就忽略
  let scrollRoot = null       // 列表放在带滚动条的容器里时，要以这个容器为观察根（视口外的 margin 穿不过容器的裁剪）

  const settings = () => ({ ...DEFAULTS, ...getSettings() })
  const isVisible = () => doc.visibilityState !== 'hidden' && !doc.hidden

  function pump() {
    const { concurrency, concurrencyHidden } = settings()
    const limit = isVisible() ? concurrency : concurrencyHidden
    while (inflight.size < limit && queue.length) {
      const img = queue.shift()
      if (!img.isConnected || !img.dataset.src) continue
      inflight.add(img)
      const done = () => {
        img.removeEventListener('load', done)
        img.removeEventListener('error', done)
        inflight.delete(img)
        pump()
      }
      img.addEventListener('load', done)
      img.addEventListener('error', done)
      img.decoding = 'async'
      img.src = img.dataset.src
      img.dataset.thumb = 'loading'
    }
  }

  function release(images) {
    for (const img of images) {
      if (img.dataset.thumb) continue   // 已经放行过
      img.dataset.thumb = 'queued'
      observer?.unobserve(img)
      queue.push(img)
    }
    pending = pending.filter((img) => !img.dataset.thumb)
    pump()
  }

  // 滚动到附近的图：放行它和它后面的 batch-1 张（后面的是预取，前面没进视口的不管——滚回去时它们自己的观察还在）
  function onIntersect(entries, myGeneration) {
    if (myGeneration !== generation || !isVisible()) return
    const hits = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target)
    if (!hits.length) return
    const first = Math.min(...hits.map((img) => pending.indexOf(img)).filter((i) => i >= 0))
    if (!Number.isFinite(first)) return
    release(pending.slice(first, first + settings().batch))
  }

  function observePending() {
    observer?.disconnect()
    if (typeof IntersectionObserver !== 'function') {
      // 老浏览器：没有观察能力就只按批放行（滚动时不会追加，所以直接全放行，退回普通加载）
      if (isVisible()) release([...pending])
      return
    }
    const myGeneration = generation
    observer = new IntersectionObserver((entries) => onIntersect(entries, myGeneration), { root: scrollRoot, rootMargin: ROOT_MARGIN })
    for (const img of pending) observer.observe(img)
  }

  const onVisibility = () => {
    if (!pending.length && !queue.length) return
    // 变成可见：重新观察一遍，让正好在视口里的图触发回调；并按前台并发继续发队列里的
    if (isVisible()) observePending()
    pump()
  }
  doc.addEventListener('visibilitychange', onVisibility)

  // 页面重新渲染：丢掉没发出去的、中止在飞的，然后从头来
  function reset() {
    generation += 1
    observer?.disconnect()
    observer = null
    for (const img of inflight) { if (!img.complete) img.removeAttribute('src') }
    inflight.clear()
    queue = []
    pending = []
  }

  return {
    // images：这一页所有带 data-src 的 <img>（DOM 顺序）；root：它们所在的滚动容器（页面本身滚动就不传）
    attach(images, { root = null } = {}) {
      reset()
      scrollRoot = root
      pending = [...images].filter((img) => img.dataset.src && !img.dataset.thumb)
      const { firstBatch } = settings()
      release(pending.slice(0, firstBatch))   // 第一批：不等可见，直接放行
      observePending()
    },
    // 分批渲染时后续几批的卡片：接在已有的队列后面，不重置（attach 会中止在飞的请求、丢掉排队的）。第一批用 attach
    append(images) {
      const fresh = [...images].filter((img) => img.dataset.src && !img.dataset.thumb && !pending.includes(img))
      if (!fresh.length) return
      pending = pending.concat(fresh)
      if (observer) for (const img of fresh) observer.observe(img)
      else observePending()
    },
    reset,
    destroy() {
      reset()
      doc.removeEventListener('visibilitychange', onVisibility)
    },
    // 测试 / 诊断用
    stats: () => ({ pending: pending.length, queued: queue.length, inflight: inflight.size }),
  }
}
