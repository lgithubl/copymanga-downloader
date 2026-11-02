// Gal 朗读客户端（gal-tts-client.js + gal-preload.js）：条目 = { text, speaker, lang }；预加载窗口更小；skipped 算好了；重复 focus 同一位置安全；窗口里的条目后来才有（译文到了才能读译文）
import { createTtsClient, ttsKey } from '../../web/static/gal-tts-client.js'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = (v) => JSON.stringify(v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = { calls: [], delay: 30, skip: new Set(), pendingOnce: new Set() }
const fetchFn = async (url, init) => {
  const body = JSON.parse(init.body)
  server.calls.push({ priority: body.priority, lines: body.lines })
  await new Promise((resolve, reject) => { const t = setTimeout(resolve, server.delay); init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }) })
  const results = body.lines.map((l) => (server.skip.has(l.text) ? { state: 'skipped' } : server.pendingOnce.delete(l.text) ? { state: 'pending' } : { state: 'ok', url: `/api/gal/tts/${l.text}.wav` }))
  return { ok: true, status: 200, json: async () => ({ available: true, results }) }
}
const item = (i, speaker = '小夜') => ({ text: `句${i}`, speaker, lang: 'ja' })
const items = (n) => Array.from({ length: n }, (_, i) => item(i))
const mk = (extra = {}) => createTtsClient({ fetchFn, repollMs: 20, ...extra })

{
  const tts = mk()
  tts.focus({ items: items(50), at: 0 })
  await sleep(300)
  const aheadTexts = server.calls.filter((c) => c.priority === 'ahead').flatMap((c) => c.lines.map((l) => l.text))
  check('朗读预加载窗口默认 6 句、每组 3 句：当前句 now，句1…句6 分 2 组 ahead，句7 以后不要', server.calls[0].priority === 'now' && server.calls[0].lines[0].text === '句0' && J(aheadTexts) === J(['句1', '句2', '句3', '句4', '句5', '句6']) && server.calls.filter((c) => c.priority === 'ahead').length === 2, J(server.calls.map((c) => [c.priority, c.lines.map((l) => l.text)])))
  check('请求里带说话人和语言（服务端按它选音色）', server.calls[0].lines[0].speaker === '小夜' && server.calls[0].lines[0].lang === 'ja')
  check('好了：get(key) 带 url；ready 为真', tts.get(ttsKey(item(0)))?.url === '/api/gal/tts/句0.wav' && tts.ready(ttsKey(item(6))) && !tts.ready(ttsKey(item(7))))
  tts.destroy()
}
// 同一句话不同说话人 / 语言 = 不同条目
check('key：同样的文字，说话人 / 语言不同就是不同条目；没有文字 = 空 key', ttsKey(item(1, 'A')) !== ttsKey(item(1, 'B')) && ttsKey({ ...item(1), lang: 'zh' }) !== ttsKey(item(1)) && ttsKey(null) === '' && ttsKey({ text: '' }) === '')
// skipped
{
  server.calls.length = 0
  server.skip = new Set(['句0'])
  const tts = mk()
  tts.focus({ items: items(3), at: 0 })
  const r = await tts.whenReady(ttsKey(item(0)), 2000)
  check('服务端回 skipped（没有可读内容）：算好了，whenReady 立刻 ok，没有 url', r === 'ok' && tts.get(ttsKey(item(0))).state === 'skipped' && tts.ready(ttsKey(item(0))))
  server.skip.clear()
  tts.destroy()
}
// 重复 focus 同一个位置不会卡死（以前当前句的追踪循环会因为 epoch 变了退出，新 focus 又因为「已经在追」直接返回 → 一直 pending）
{
  server.calls.length = 0
  server.delay = 120
  const tts = mk()
  tts.focus({ items: items(10), at: 2 })
  tts.focus({ items: items(10), at: 2 })
  tts.focus({ items: items(10), at: 2 })
  const r = await tts.whenReady(ttsKey(item(2)), 3000)
  check('同一个位置连续 focus 3 次：当前句照样拿到结果（不会因为重复 focus 卡在 pending），当前句只请求 1 次', r === 'ok' && server.calls.filter((c) => c.priority === 'now').length === 1, J(server.calls.map((c) => c.priority)))
  tts.destroy()
}
// 窗口里的条目后来才有：先是 null，再 focus 一次变成有
{
  server.calls.length = 0
  server.delay = 20
  const tts = mk()
  const list = items(8).map((x, i) => (i >= 3 ? null : x))   // 句3 以后还不能读（比如读译文、译文没到）
  tts.focus({ items: list, at: 0 })
  await sleep(150)
  const first = server.calls.flatMap((c) => c.lines.map((l) => l.text))
  list[3] = item(3); list[4] = item(4)
  tts.focus({ items: list, at: 0 })
  await sleep(200)
  const all = server.calls.flatMap((c) => c.lines.map((l) => l.text))
  check('窗口里还不能读的位置（null）不请求；条目后来有了（再 focus）才请求，已经好的不重复要', J(first) === J(['句0', '句1', '句2']) && all.includes('句3') && all.includes('句4') && all.filter((t) => t === '句1').length === 1, J([first, all]))
  tts.destroy()
}
// pending 重要
{
  server.calls.length = 0
  server.pendingOnce.add('句1')
  const tts = mk()
  tts.focus({ items: items(4), at: 0 })
  await sleep(400)
  check('服务端回 pending：稍后再要，最后拿到', tts.ready(ttsKey(item(1))) && server.calls.flatMap((c) => c.lines.map((l) => l.text)).filter((t) => t === '句1').length === 2)
  tts.destroy()
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
