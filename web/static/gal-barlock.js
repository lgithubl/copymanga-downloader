// Gal 底栏的「锁定」开关：列表页和播放页共用一份状态（localStorage）。
//   锁定（默认）：底栏常驻在最下面一行
//   没锁定：底栏收起（root 上加 .bar-auto），鼠标移到最下沿的热区 / 底栏上才滑出来；样式在 style.css 的「底栏锁定」一节
// 触屏（没有 hover）没法「移过去」，一律锁定，按钮禁用。
const KEY = 'copymanga.galBarLocked'

const hoverless = () => Boolean(window.matchMedia?.('(hover: none)').matches)

export function isBarLocked() {
  if (hoverless()) return true
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function attachBarLock({ root, button }) {
  const apply = () => {
    const locked = isBarLocked()
    root.classList.toggle('bar-auto', !locked)
    button.textContent = locked ? '🔒' : '🔓'
    button.setAttribute('aria-pressed', String(locked))
    button.disabled = hoverless()
    button.title = hoverless()
      ? '触屏设备没法悬停，底栏始终固定'
      : locked ? '底栏已固定在最下面（点击改为自动收起，鼠标移到底部再出来）' : '底栏自动收起，鼠标移到底部出来（点击固定）'
  }
  button.addEventListener('click', () => {
    try { localStorage.setItem(KEY, isBarLocked() ? '0' : '1') } catch { /* 存不了就只在这一页生效 */ }
    apply()
  })
  apply()
}
