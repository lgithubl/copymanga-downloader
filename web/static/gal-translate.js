// Gal 播放器的翻译客户端：预加载 + 当前句优先 + 跳走就撤 + 失败退避。不碰 DOM（Node 里也能测）。
// 和服务端（library/gal-translate.mjs）一起保证「不拖慢原文」：原文先显示，这里在后台要译文，好了通过 onChange 通知界面。
//
// 流程：
//   · focus({ texts, at })：玩家看到第 at 句（texts = 这个脚本按播放顺序每步的台词，没台词的步是 ''）。
//       当前句：马上发一个 priority = now 的请求（服务端长轮询：最多等 nowWaitMs，没好回 pending，这里接着再要，直到好了 / 玩家离开这句）。
//       往后 lookahead 句：按 chunk 句一组，priority = ahead，同时在途的预加载请求不超过 maxAhead 个（服务端自己还有并发上限，这里不灌满它）。
//       玩家跳走（新窗口和在途的预加载请求没有交集）：撤掉那些请求（AbortController，服务端把还没开始的批丢掉）。
//   · 每句带前 contextSize 句当上文（服务端合批时用）。
//   · 已经有译文 / 在途的句子不重复要；失败的句子 retryAfterMs 内不再要；后端整体不通：退避（1s、2s、4s…最多 30s），连续 3 次不通 = available false（界面显示「翻译不可用」，阻塞自动播放的等待立刻放行）；503（服务端没启用）= 永久不可用。
//   · pause(true)（页面隐藏 / 快进中）：不再发预加载请求（当前句照常要）；pause(false) 接着来。
//   · whenReady(text, maxMs)：auto 翻页等译文用——ok / error（译文失败或不可用，不再等）/ timeout（maxMs > 0 且到点）；maxMs = 0 = 一直等。
export function createTranslateClient({
  fetchFn = (...args) => fetch(...args),
  endpoint = '/api/gal/translate',
  lookahead = 40,
  chunk = 15,
  maxAhead = 1,
  contextSize = 2,
  nowWaitMs = 20000,
  aheadWaitMs = 20000,
  retryAfterMs = 30000,
  repollMs = 1000,
  onChange = () => {},
  clock = () => Date.now(),
} = {}) {
  const store = new Map()   // 文本 → { state: 'ok' | 'error', t?, error?, retryAt? }
  const STORE_MAX = 3000
  const waiters = new Set() // { text, resolve }
  let texts = []
  let at = 0
  let epoch = 0
  let paused = false
  let destroyed = false
  let available = true
  let failures = 0
  let backoffUntil = 0
  const ahead = new Set()      // 在途的预加载任务 { texts: Set, controller }
  const nowBusy = new Set()    // 正在为它发 now 请求的文本
  let queue = []               // 还没发出去的预加载组：[{ lines: [{ text, ctx }] }]
  let timer = null

  const remember = (text, value) => { store.delete(text); store.set(text, value); while (store.size > STORE_MAX) store.delete(store.keys().next().value) }
  const wake = () => { for (const w of [...waiters]) check(w) }
  function check(w) {   // 到了结论就 done 并返回 true
    const v = store.get(w.text)
    if (v?.state === 'ok') { w.done('ok'); return true }
    if (v?.state === 'error' || !available) { w.done('error'); return true }
    return false
  }
  const changed = () => { wake(); try { onChange() } catch { /* 界面回调出错不影响调度 */ } }

  const ctxOf = (i) => texts.slice(Math.max(0, i - contextSize), i).filter(Boolean)
  const needs = (text) => {
    if (!text) return false
    const v = store.get(text)
    if (v?.state === 'ok') return false
    if (v?.state === 'error' && (v.retryAt || 0) > clock()) return false
    return true
  }

  async function post(lines, priority, waitMs, signal) {
    if (clock() < backoffUntil) throw new Error('backoff')
    let res
    try {
      res = await fetchFn(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines, priority, waitMs }), signal })
    } catch (error) {
      if (signal?.aborted) throw error
      noteFailure(false)
      throw error
    }
    if (res.status === 503) { available = false; failures = 3; changed(); throw new Error('unavailable') }
    if (!res.ok) { noteFailure(false); throw new Error(`HTTP ${res.status}`) }
    failures = 0
    backoffUntil = 0
    if (!available) { available = true; changed() }
    return (await res.json()).results || []
  }
  function noteFailure() {
    failures += 1
    backoffUntil = clock() + Math.min(30000, 1000 * 2 ** (failures - 1))
    if (failures >= 3 && available) { available = false; changed() }
  }
  function apply(lines, results) {
    let any = false
    lines.forEach((line, i) => {
      const r = results[i]
      if (!r) return
      if (r.state === 'ok') { remember(line.text, { state: 'ok', t: r.t }); any = true } else if (r.state === 'error') { remember(line.text, { state: 'error', error: r.error, retryAt: clock() + retryAfterMs }); any = true }
    })
    if (any) changed()
  }

  // 当前句：一直要到好 / 失败 / 玩家离开这句（epoch 变了）
  async function pursueNow(text, ctx, myEpoch) {
    if (nowBusy.has(text)) return
    nowBusy.add(text)
    try {
      while (!destroyed && myEpoch === epoch && needs(text) && available) {
        try {
          const results = await post([{ text, ctx }], 'now', nowWaitMs)
          apply([{ text }], results)
          if (!needs(text)) break
        } catch { await sleep(Math.max(300, backoffUntil - clock())) }
      }
    } finally { nowBusy.delete(text) }
  }
  const sleep = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms) })

  function pumpAhead() {
    if (destroyed || paused || !available) return
    while (ahead.size < maxAhead && queue.length) {
      const group = queue.shift()
      const lines = group.lines.filter((l) => needs(l.text))
      if (!lines.length) continue
      const controller = new AbortController()
      const job = { texts: new Set(lines.map((l) => l.text)), controller }
      ahead.add(job)
      const myEpoch = epoch
      ;(async () => {
        try {
          const results = await post(lines, 'ahead', aheadWaitMs, controller.signal)
          apply(lines, results)
          const stillPending = lines.filter((l) => needs(l.text))
          if (stillPending.length && myEpoch === epoch && !controller.signal.aborted) { await sleep(repollMs); queue.push({ lines: stillPending }) }   // 还在服务端排队 / 在打：稍后再来要（会加入在途，不会重复打模型）
        } catch { /* 被撤 / 后端不通：退避由 post 记；这一组丢掉，下次 focus 会重新排 */ } finally {
          ahead.delete(job)
          pumpAhead()
        }
      })()
    }
  }

  function focus({ texts: nextTexts, at: nextAt }) {
    if (destroyed) return
    texts = nextTexts
    at = nextAt
    epoch += 1
    const current = texts[at] || ''
    const windowEnd = Math.min(texts.length, at + 1 + lookahead)
    const windowTexts = new Set()
    for (let i = at + 1; i < windowEnd; i++) if (texts[i]) windowTexts.add(texts[i])
    // 跳走了：在途的预加载请求和新窗口一句都不沾 → 撤
    for (const job of [...ahead]) if (![...job.texts].some((t) => windowTexts.has(t))) { job.controller.abort(); ahead.delete(job) }
    const keepTexts = new Set([...ahead].flatMap((j) => [...j.texts]))
    // 重新排预加载队列：窗口里还需要的、不在在途请求里的句子，按顺序切成组
    queue = []
    let lines = []
    for (let i = at + 1; i < windowEnd; i++) {
      const text = texts[i]
      if (!needs(text) || keepTexts.has(text) || text === current) continue
      if (lines.some((l) => l.text === text)) continue
      lines.push({ text, ctx: ctxOf(i) })
      if (lines.length >= chunk) { queue.push({ lines }); lines = [] }
    }
    if (lines.length) queue.push({ lines })
    if (current && needs(current)) pursueNow(current, ctxOf(at), epoch)
    pumpAhead()
    wake()
  }

  return {
    focus,
    get: (text) => store.get(text) || null,
    ready: (text) => store.get(text)?.state === 'ok',
    get available() { return available },
    // 等这句的译文：'ok' | 'error' | 'timeout'；maxMs = 0 一直等
    whenReady(text, maxMs = 0) {
      return new Promise((resolve) => {
        let tm = null
        const w = { text, done: (value) => { clearTimeout(tm); waiters.delete(w); resolve(value) } }
        if (!text) return resolve('ok')
        if (check(w)) return undefined
        waiters.add(w)
        if (maxMs > 0) tm = setTimeout(() => w.done('timeout'), maxMs)
        return undefined
      })
    },
    pause(value) { paused = Boolean(value); if (!paused) pumpAhead() },
    stats: () => ({ ahead: ahead.size, queued: queue.reduce((n, g) => n + g.lines.length, 0), cached: store.size, available, failures }),
    destroy() { destroyed = true; clearTimeout(timer); for (const job of ahead) job.controller.abort(); ahead.clear(); queue = []; for (const w of [...waiters]) w.done('error') },
  }
}
