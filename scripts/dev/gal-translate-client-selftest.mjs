// Gal 翻译客户端（web/static/gal-translate.js）：当前句优先 / 预加载窗口 + 分组 + 在途上限 / 跳走撤请求 / 不重复要 / 错误与退避 / 暂停 / whenReady
import { createTranslateClient } from '../../web/static/gal-translate.js'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = (v) => JSON.stringify(v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 假服务端：每次请求记录一下；delay 毫秒后给结果；支持 abort；mode 控制行为
function fakeServer(opts = {}) {
  const s = { calls: [], aborted: 0, inFlight: 0, peak: 0, delay: opts.delay ?? 30, mode: 'ok', pendingOnce: new Set(), failNext: 0 }
  s.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    const call = { priority: body.priority, texts: body.lines.map((l) => l.text), ctx: body.lines.map((l) => l.ctx), waitMs: body.waitMs, signal: init.signal }
    s.calls.push(call)
    s.inFlight += 1
    s.peak = Math.max(s.peak, s.inFlight)
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, s.delay)
        init.signal?.addEventListener('abort', () => { clearTimeout(t); s.aborted += 1; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
      })
    } finally { s.inFlight -= 1 }
    if (s.failNext > 0) { s.failNext -= 1; throw new Error('network') }
    if (s.mode === '503') return { ok: false, status: 503, json: async () => ({}) }
    if (s.mode === '500') return { ok: false, status: 500, json: async () => ({}) }
    const results = body.lines.map((l) => {
      if (s.mode === 'error') return { state: 'error', error: 'bad' }
      if (s.pendingOnce.has(l.text)) { s.pendingOnce.delete(l.text); return { state: 'pending' } }
      return { state: 'ok', t: `译:${l.text}` }
    })
    return { ok: true, status: 200, json: async () => ({ available: true, results }) }
  }
  return s
}
const script = (n) => Array.from({ length: n }, (_, i) => `句${i}`)
const mk = (server, extra = {}) => createTranslateClient({ fetchFn: server.fetch, lookahead: 40, chunk: 15, maxAhead: 1, repollMs: 20, retryAfterMs: 200, ...extra })

// ---- 当前句优先 + 预加载窗口 + 分组 + 在途上限 ----
{
  const server = fakeServer({ delay: 40 })
  const tr = mk(server)
  const texts = script(200)
  tr.focus({ texts, at: 10 })
  await sleep(10)
  check('当前句优先：第一个请求是 priority = now、只含当前这一句，带前 2 句当上文', server.calls[0].priority === 'now' && J(server.calls[0].texts) === J(['句10']) && J(server.calls[0].ctx[0]) === J(['句8', '句9']), J(server.calls[0]))
  await sleep(400)
  const aheadCalls = server.calls.filter((c) => c.priority === 'ahead')
  const asked = aheadCalls.flatMap((c) => c.texts)
  check('预加载：窗口 = 当前句后面 40 句（句11…句50），按 15 句一组 → 3 组（15 / 15 / 10），没有窗口外的句子', J(aheadCalls.map((c) => c.texts.length)) === J([15, 15, 10]) && asked[0] === '句11' && asked.at(-1) === '句50' && !asked.includes('句51'), J(aheadCalls.map((c) => c.texts.length)))
  check('在途上限：同时在途的预加载请求（客户端）最多 1 个（now + ahead 同时最多 2 个在途）', server.peak <= 2, server.peak)
  check('译文进了缓存：当前句和窗口里的句子都 ready', tr.ready('句10') && tr.ready('句11') && tr.ready('句50') && !tr.ready('句51'))
  // 正常往后翻一句：窗口右移一格，只多要一句（句51），已经有的不重复要
  const before = server.calls.length
  tr.focus({ texts, at: 11 })
  await sleep(150)
  const fresh = server.calls.slice(before).flatMap((c) => c.texts)
  check('往后翻一句：窗口右移，只补新进窗口的一句（句51），已有的句子不重复请求', J(fresh) === J(['句51']), J(fresh))
  tr.destroy()
}
// ---- 跳走：撤掉在途的预加载 ----
{
  const server = fakeServer({ delay: 300 })
  const tr = mk(server)
  const texts = script(300)
  tr.focus({ texts, at: 0 })
  await sleep(380)   // now 完成，第一组预加载在途
  const inflightBefore = server.calls.filter((c) => c.priority === 'ahead').length
  tr.focus({ texts, at: 200 })
  await sleep(20)
  check('跳走（新窗口和在途的预加载请求没有交集）：撤掉在途的请求（AbortController），服务端据此丢掉没开始的批', inflightBefore >= 1 && server.aborted >= 1, J([inflightBefore, server.aborted]))
  await sleep(1200)
  const askedAfter = server.calls.slice(inflightBefore + 1).flatMap((c) => c.texts)
  check('跳走之后只要新窗口（句201…句240）的句子，不再要旧窗口里没做完的', askedAfter.includes('句201') && !askedAfter.some((t) => Number(t.slice(1)) > 0 && Number(t.slice(1)) < 100), J(askedAfter.slice(0, 5)))
  tr.destroy()
}
// ---- pending 重新要 ----
{
  const server = fakeServer({ delay: 20 })
  server.pendingOnce.add('句3')
  const tr = mk(server)
  tr.focus({ texts: script(10), at: 0 })
  await sleep(500)
  check('服务端回 pending（还在排队 / 在打）：客户端稍后再要，最后拿到译文', tr.ready('句3') && server.calls.flatMap((c) => c.texts).filter((t) => t === '句3').length === 2, J(server.calls.map((c) => c.texts)))
  tr.destroy()
}
// ---- 错误：不立刻重试 ----
{
  const server = fakeServer({ delay: 10 })
  server.mode = 'error'
  const tr = mk(server)
  tr.focus({ texts: script(4), at: 0 })
  await sleep(150)
  const n1 = server.calls.length
  tr.focus({ texts: script(4), at: 0 })
  await sleep(100)
  check('译文失败（error）：状态 error，retryAfter 内再 focus 也不重复要', tr.get('句0')?.state === 'error' && server.calls.length === n1, J([tr.get('句0'), n1, server.calls.length]))
  await sleep(250)
  tr.focus({ texts: script(4), at: 0 })
  await sleep(100)
  check('过了 retryAfter 之后再 focus：重新要一次', server.calls.length > n1)
  tr.destroy()
}
// ---- whenReady ----
{
  const server = fakeServer({ delay: 120 })
  const tr = mk(server)
  tr.focus({ texts: script(5), at: 0 })
  const t0 = Date.now()
  const r1 = await tr.whenReady('句0', 5000)
  check('whenReady：译文到了就返回 ok（约 120ms，没等满上限）', r1 === 'ok' && Date.now() - t0 < 400, [r1, Date.now() - t0])
  const server2 = fakeServer({ delay: 400 })
  const tr2 = mk(server2)
  tr2.focus({ texts: script(5), at: 0 })
  const r2 = await tr2.whenReady('句0', 100)
  check('whenReady：maxMs 到了还没好 = timeout（不再强等）', r2 === 'timeout')
  const r3 = await tr2.whenReady('句0', 0)
  check('whenReady(maxMs = 0)：一直等到好（译文后来到了 = ok）', r3 === 'ok')
  check('空句子 = 直接 ok；已经 ready 的句子立刻 ok', (await tr2.whenReady('', 10)) === 'ok' && (await tr2.whenReady('句0', 10)) === 'ok')
  tr.destroy(); tr2.destroy()
}
// ---- 503 / 后端不通 ----
{
  const server = fakeServer({ delay: 5 })
  server.mode = '503'
  const tr = mk(server)
  tr.focus({ texts: script(5), at: 0 })
  await sleep(100)
  check('服务端没启用翻译（503）：available = false，whenReady 立刻放行（error），不再请求', tr.available === false && (await tr.whenReady('句0', 0)) === 'error', J(tr.stats()))
  tr.destroy()
  const server2 = fakeServer({ delay: 5 })
  server2.failNext = 99
  const tr2 = createTranslateClient({ fetchFn: server2.fetch, repollMs: 20, clock: (() => { let t = 0; return () => (t += 5000) })() })   // 假时钟：每次 +5s，让退避窗口立刻过去
  tr2.focus({ texts: script(5), at: 0 })
  await sleep(1500)
  check('后端不通（网络错）：连续 3 次失败 = available false（退避），译文等待放行', tr2.available === false && server2.calls.length >= 3 && server2.calls.length < 30, J([server2.calls.length, tr2.stats()]))
  tr2.destroy()
}
// ---- 暂停 ----
{
  const server = fakeServer({ delay: 10 })
  const tr = mk(server)
  tr.pause(true)
  tr.focus({ texts: script(60), at: 0 })
  await sleep(200)
  check('暂停（页面隐藏 / 快进）：当前句照常要，预加载一个都不发', server.calls.length === 1 && server.calls[0].priority === 'now' && tr.ready('句0'), J(server.calls.map((c) => c.priority)))
  tr.pause(false)
  await sleep(400)
  check('恢复：接着预加载', server.calls.some((c) => c.priority === 'ahead') && tr.ready('句1'))
  tr.destroy()
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
