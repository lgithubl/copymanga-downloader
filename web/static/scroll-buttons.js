// 悬浮半透明 ▲▼ 滚动按钮：像看图软件那样分段滚动（每次点一下滚「可视高度的 80%」）。
// 可复用的小组件，不碰业务代码：createScrollButtons({ host, getTarget, … }) 往 host 里放两个按钮，位置跟着滚动容器走。
//   host        按钮挂在哪（fixed 定位，host 一般是所在视图；视图 display:none 时按钮自然跟着隐藏）
//   getTarget   返回要滚动的元素（可以是 document.scrollingElement）；布局变了（窄屏时整页滚动）返回值可以跟着变
//   step        每次滚可视高度的比例，默认 0.8
//   getAutoRate 可选：返回自动滚动的频率（每秒点几次「▼」；'max' = 持续滚动，等价于一直按着）。给了就在 ▲▼ 之间加一个「自动」按钮：
//               点一下开始（等价于按频率点 ▼），再点一下 / 手动滚轮 / 触摸 / 点 ▲▼ / 滚到底都会停。频率每次点击时现取，在「更多」里改了立即生效
// 只在目标「内容比可视区高」时显示；到顶 / 到底的那个按钮 aria-disabled 并变淡；prefers-reduced-motion 时瞬间滚动。
export function createScrollButtons({ host, getTarget, step = 0.8, label = '', getAutoRate = null }) {
  const box = document.createElement('div')
  box.className = 'scroll-btns'
  box.hidden = true
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', label || '分段滚动')
  const make = (dir, text, title) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `scroll-btn scroll-btn-${dir > 0 ? 'down' : 'up'}`
    button.textContent = text
    button.title = title
    button.setAttribute('aria-label', title)
    button.addEventListener('click', () => scrollStep(dir))
    return button
  }
  const up = make(-1, '▲', `向上 ${Math.round(step * 100)}%`)
  const down = make(1, '▼', `向下 ${Math.round(step * 100)}%`)
  let auto = null
  if (getAutoRate) {
    auto = document.createElement('button')
    auto.type = 'button'
    auto.className = 'scroll-btn scroll-btn-auto'
    auto.textContent = '自动'
    auto.title = '自动向下滚（频率在「更多」里设置）'
    auto.setAttribute('aria-label', '自动向下滚动')
    auto.addEventListener('click', () => (autoTimer || autoFrame ? stopAuto() : startAuto()))
    box.append(up, auto, down)
  } else box.append(up, down)
  host.append(box)

  const isRoot = (el) => el === document.scrollingElement || el === document.documentElement || el === document.body
  const viewport = (el) => (isRoot(el) ? window.innerHeight : el.clientHeight)

  function scrollStep(dir) {
    const el = getTarget()
    const button = dir > 0 ? down : up
    if (!el || button.getAttribute('aria-disabled') === 'true') return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const top = Math.round(viewport(el) * step) * dir
    ;(isRoot(el) ? window : el).scrollBy({ top, behavior: reduce ? 'instant' : 'smooth' })
  }

  // —— 自动滚动 ——
  let autoTimer = 0
  let autoFrame = 0
  const MAX_STEPS_PER_SECOND = 6   // 'max'（持续）：每秒滚 6 个「80% 可视高度」，连续滚动，不分段
  function stopAuto() {
    if (autoTimer) clearTimeout(autoTimer)
    if (autoFrame) cancelAnimationFrame(autoFrame)
    autoTimer = 0
    autoFrame = 0
    if (auto) { auto.classList.remove('active'); auto.textContent = '自动'; auto.setAttribute('aria-pressed', 'false') }
  }
  const atBottom = () => down.getAttribute('aria-disabled') === 'true'
  function startAuto() {
    if (!auto || atBottom()) return
    auto.classList.add('active'); auto.textContent = '停'; auto.setAttribute('aria-pressed', 'true')
    const rate = getAutoRate()
    if (rate === 'max') {
      let last = performance.now()
      const run = (now) => {
        const el = getTarget()
        if (!el || atBottom()) { stopAuto(); return }
        const dy = viewport(el) * step * MAX_STEPS_PER_SECOND * Math.min(0.1, (now - last) / 1000)
        last = now
        ;(isRoot(el) ? window : el).scrollBy({ top: dy, behavior: 'instant' })
        update()
        autoFrame = requestAnimationFrame(run)
      }
      autoFrame = requestAnimationFrame(run)
      return
    }
    const tick = () => {
      if (atBottom()) { stopAuto(); return }
      scrollStep(1)
      const per = Number(getAutoRate())
      autoTimer = setTimeout(tick, 1000 / (Number.isFinite(per) && per > 0 ? per : 1))   // 每次现取：改了频率下一次就生效
    }
    tick()
  }
  const userStops = ['wheel', 'touchstart', 'keydown']
  const stopOnUser = (event) => { if (box.contains(event.target)) return; if (autoTimer || autoFrame) { if (event.type === 'keydown' && !['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(event.key)) return; stopAuto() } }
  if (auto) {
    for (const type of userStops) window.addEventListener(type, stopOnUser, { passive: true, capture: true })
    up.addEventListener('click', stopAuto)
    down.addEventListener('click', stopAuto)
  }

  let frame = 0
  function update() {
    frame = 0
    const el = getTarget()
    const height = el ? viewport(el) : 0
    const max = el ? el.scrollHeight - height : 0
    box.hidden = !(el && height > 0 && max > 1)
    if (box.hidden) { if (auto) stopAuto(); return }
    const top = el.scrollTop
    up.setAttribute('aria-disabled', String(top <= 1))
    down.setAttribute('aria-disabled', String(top >= max - 1))
    if (auto && top >= max - 1 && (autoTimer || autoFrame)) stopAuto()
    // 位置：贴着滚动区右缘（留出滚动条宽度和一点边距），垂直居中在滚动区的可见部分；整页滚动时贴视口右缘
    const rect = isRoot(el) ? { right: window.innerWidth, top: 0, bottom: window.innerHeight } : el.getBoundingClientRect()
    const bar = isRoot(el) ? 0 : el.offsetWidth - el.clientWidth
    const visibleTop = Math.max(rect.top, 0)
    const visibleBottom = Math.min(rect.bottom, window.innerHeight)
    box.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right + bar + 14))}px`
    box.style.top = `${Math.round((visibleTop + visibleBottom) / 2)}px`
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }

  let observed = null
  const observers = []
  function watch() {
    const el = getTarget()
    if (el === observed) return
    observed = el
    observers.splice(0).forEach((o) => o.disconnect())
    if (!el) return
    const resize = new ResizeObserver(schedule)
    resize.observe(el)
    const mutation = new MutationObserver(schedule)
    mutation.observe(el, { childList: true })
    observers.push(resize, mutation)
  }
  const tick = () => { watch(); schedule() }
  window.addEventListener('resize', tick)
  window.addEventListener('scroll', schedule, true)   // 捕获：目标是内部元素时 scroll 不冒泡
  // 布局切换（窄屏整页滚动 / 详情浮动）不一定触发目标自身的尺寸变化，host 的 class 变化也重算一次
  const hostObserver = new MutationObserver(tick)
  hostObserver.observe(host, { attributes: true, attributeFilter: ['class'] })
  tick()
  return { update: tick, destroy() { stopAuto(); if (auto) for (const type of userStops) window.removeEventListener(type, stopOnUser, { capture: true }); window.removeEventListener('resize', tick); window.removeEventListener('scroll', schedule, true); hostObserver.disconnect(); observers.forEach((o) => o.disconnect()); box.remove() } }
}
