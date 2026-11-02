// 「当前句优先 + 往后预加载 + 跳走就撤 + 失败退避」的通用客户端调度（翻译 gal-translate.js / 朗读 gal-tts-client.js 共用）。不碰 DOM（Node 里也能测）。
// 服务端（library/gal-translate.mjs / gal-tts.mjs）有缓存 / 去重 / 优先级 / 并发上限；这里只管「什么时候要什么」，保证不灌满服务端、不重复要、跳走了不白做。
//
// 条目（item）：脚本里每个播放位置要处理的东西（翻译 = 台词文本，朗读 = { text, speaker, lang }；没有 = null / ''）。key = keyOf(item)，同一个 key 只处理一次。
//   focus({ items, at })：玩家到了第 at 个位置。
//     · 当前条目马上发 priority = now 的请求（服务端长轮询：最多等 nowWaitMs，没好回 pending，这里接着再要，直到好了 / 玩家离开这一条 / 后端不可用）。
//     · 往后 lookahead 个位置，按 chunk 个一组发 priority = ahead，客户端在途的预加载请求最多 maxAhead 个（服务端自己还有并发上限）。
//     · 跳走（新窗口和在途的预加载请求没有交集）：撤掉那些请求（AbortController，服务端把没开始的批丢掉）。
//     · 重复 focus 同一个位置是安全的（比如依赖的东西变了，要重新算窗口）：已经好的 / 在途的不重复要。
//   失败：error 的条目 retryAfterMs 内不再要；后端不通退避（1s、2s、4s…≤ 30s），连续 3 次 = available false；503 = 永久不可用。
//   pause(true)：不发预加载（当前条目照常要）。
//   whenReady(key, maxMs)：'ok'（好了 / skipped）| 'error'（失败 / 不可用，不再等）| 'timeout'（maxMs > 0 且到点）；maxMs = 0 一直等。
export function createPreloadClient({
  keyOf,
  lineOf = (item) => item,
  endpoint,
  fetchFn = (...args) => fetch(...args),
  lookahead = 40,
  chunk = 15,
  maxAhead = 1,
  nowWaitMs = 20000,
  aheadWaitMs = 20000,
  retryAfterMs = 30000,
  repollMs = 1000,
  storeMax = 3000,
  onChange = () => {},
  clock = () => Date.now(),
} = {}) {
  const store = new Map()   // key → { state: 'ok' | 'error' | 'skipped', ...result, retryAt? }
  const waiters = new Set()
  let items = []
  let at = 0
  let currentKey = ''
  let windowKeys = new Set()
  let paused = false
  let destroyed = false
  let available = true
  let failures = 0
  let backoffUntil = 0
  const ahead = new Set()
  const nowBusy = new Set()
  let queue = []
  let timer = null

  const sleep = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms) })
  const remember = (key, value) => { store.delete(key); store.set(key, value); while (store.size > storeMax) store.delete(store.keys().next().value) }
  function check(w) {
    const v = store.get(w.key)
    if (v?.state === 'ok' || v?.state === 'skipped') { w.done('ok'); return true }
    if (v?.state === 'error' || !available) { w.done('error'); return true }
    return false
  }
  const changed = () => { for (const w of [...waiters]) check(w); try { onChange() } catch { /* 界面回调出错不影响调度 */ } }
  const needs = (key) => {
    if (!key) return false
    const v = store.get(key)
    if (v?.state === 'ok' || v?.state === 'skipped') return false
    if (v?.state === 'error' && (v.retryAt || 0) > clock()) return false
    return true
  }
  const keyAt = (i) => { const item = items[i]; return item ? keyOf(item) : '' }

  function noteFailure() {
    failures += 1
    backoffUntil = clock() + Math.min(30000, 1000 * 2 ** (failures - 1))
    if (failures >= 3 && available) { available = false; changed() }
  }
  async function post(lines, priority, waitMs, signal) {
    if (clock() < backoffUntil) throw new Error('backoff')
    let res
    try {
      res = await fetchFn(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines, priority, waitMs }), signal })
    } catch (error) {
      if (signal?.aborted) throw error
      noteFailure()
      throw error
    }
    if (res.status === 503) { available = false; failures = 3; changed(); throw new Error('unavailable') }
    if (!res.ok) { noteFailure(); throw new Error(`HTTP ${res.status}`) }
    failures = 0
    backoffUntil = 0
    if (!available) { available = true; changed() }
    return (await res.json()).results || []
  }
  function apply(entries, results) {
    let any = false
    entries.forEach((entry, i) => {
      const r = results[i]
      if (!r) return
      if (r.state === 'ok' || r.state === 'skipped') { const { state, ...rest } = r; remember(entry.key, { state, ...rest }); any = true } else if (r.state === 'error') { remember(entry.key, { state: 'error', error: r.error, retryAt: clock() + retryAfterMs }); any = true }
    })
    if (any) changed()
  }

  // 当前条目：一直要到好 / 失败 / 玩家离开这一条（currentKey 变了）/ 后端不可用
  async function pursueNow(entry) {
    if (nowBusy.has(entry.key)) return
    nowBusy.add(entry.key)
    try {
      while (!destroyed && currentKey === entry.key && needs(entry.key) && available) {
        try {
          const results = await post([entry.line], 'now', nowWaitMs)
          apply([entry], results)
          if (!needs(entry.key)) break
        } catch { await sleep(Math.max(300, backoffUntil - clock())) }
      }
    } finally { nowBusy.delete(entry.key) }
  }

  function pumpAhead() {
    if (destroyed || paused || !available) return
    while (ahead.size < maxAhead && queue.length) {
      const group = queue.shift()
      const entries = group.filter((e) => needs(e.key) && windowKeys.has(e.key))
      if (!entries.length) continue
      const controller = new AbortController()
      const job = { keys: new Set(entries.map((e) => e.key)), controller }
      ahead.add(job)
      ;(async () => {
        try {
          const results = await post(entries.map((e) => e.line), 'ahead', aheadWaitMs, controller.signal)
          apply(entries, results)
          const still = entries.filter((e) => needs(e.key) && windowKeys.has(e.key))
          if (still.length && !controller.signal.aborted) { await sleep(repollMs); queue.push(still) }   // 还在服务端排队 / 在做：稍后再来要（会加入在途，不会重复做）
        } catch { /* 被撤 / 后端不通：退避由 post 记；这一组丢掉，下次 focus 会重新排 */ } finally {
          ahead.delete(job)
          pumpAhead()
        }
      })()
    }
  }

  function focus({ items: nextItems, at: nextAt }) {
    if (destroyed) return
    items = nextItems
    at = nextAt
    currentKey = keyAt(at)
    const end = Math.min(items.length, at + 1 + lookahead)
    windowKeys = new Set()
    for (let i = at + 1; i < end; i++) { const k = keyAt(i); if (k) windowKeys.add(k) }
    for (const job of [...ahead]) if (![...job.keys].some((k) => windowKeys.has(k))) { job.controller.abort(); ahead.delete(job) }   // 跳走了：撤
    const inflightKeys = new Set([...ahead].flatMap((j) => [...j.keys]))
    queue = []
    let group = []
    const seen = new Set()
    for (let i = at + 1; i < end; i++) {
      const key = keyAt(i)
      if (!key || key === currentKey || seen.has(key) || inflightKeys.has(key) || !needs(key)) continue
      seen.add(key)
      group.push({ key, line: lineOf(items[i], items, i) })
      if (group.length >= chunk) { queue.push(group); group = [] }
    }
    if (group.length) queue.push(group)
    if (currentKey && needs(currentKey)) pursueNow({ key: currentKey, line: lineOf(items[at], items, at) })
    pumpAhead()
    for (const w of [...waiters]) check(w)
  }

  return {
    focus,
    get: (key) => store.get(key) || null,
    ready: (key) => { const s = store.get(key)?.state; return s === 'ok' || s === 'skipped' },
    get available() { return available },
    whenReady(key, maxMs = 0) {
      return new Promise((resolve) => {
        let tm = null
        const w = { key, done: (value) => { clearTimeout(tm); waiters.delete(w); resolve(value) } }
        if (!key) return resolve('ok')
        if (check(w)) return undefined
        waiters.add(w)
        if (maxMs > 0) tm = setTimeout(() => w.done('timeout'), maxMs)
        return undefined
      })
    },
    pause(value) { paused = Boolean(value); if (!paused) pumpAhead() },
    stats: () => ({ ahead: ahead.size, queued: queue.reduce((n, g) => n + g.length, 0), cached: store.size, available, failures }),
    destroy() { destroyed = true; clearTimeout(timer); for (const job of ahead) job.controller.abort(); ahead.clear(); queue = []; for (const w of [...waiters]) w.done('error') },
  }
}
