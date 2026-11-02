// Gal 翻译服务（web/library/gal-translate.mjs）：缓存 / 去重 / 优先级 / 并发上限 / 取消 / 拆批 / 失败 / waitMs——用一个假的 OpenAI 兼容模型服务
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cleanPlain, createGalTranslator, parseJsonArray } from '../../web/library/gal-translate.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = (v) => JSON.stringify(v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 纯函数 ----
check('parseJsonArray：容忍 ```json 围栏和前后废话；数字转字符串；不是数组 / 解析不了 = null', J(parseJsonArray('好的：\n```json\n["甲","乙",3]\n```')) === J(['甲', '乙', '3']) && parseJsonArray('没有数组') === null && parseJsonArray('[bad') === null && parseJsonArray('{"a":1}') === null)
check('cleanPlain：去围栏 / 外层引号（引号里还有引号就不剥）', cleanPlain('「你好」') === '你好' && cleanPlain('```\n译文\n```') === '译文' && cleanPlain('「他说「好」」') === '「他说「好」」')

// ---- 假模型 ----
const behavior = { delayMs: 0, mode: 'ok', failTimes: 0 }
const calls = []   // { texts, ctx, at, doneAt }
let inFlight = 0
let peak = 0
const llm = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', async () => {
    const payload = JSON.parse(body)
    const user = payload.messages.at(-1).content
    const lines = user.split('\n')
    const last = lines.at(-1)
    const batch = last.startsWith('[')
    const texts = batch ? JSON.parse(last) : [last]
    const ctxLines = user.includes('上文') ? lines.filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, '')) : []
    const call = { texts, ctx: ctxLines, at: Date.now() }
    calls.push(call)
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await sleep(behavior.delayMs)
    inFlight -= 1
    call.doneAt = Date.now()
    if (behavior.failTimes > 0) { behavior.failTimes -= 1; res.statusCode = 500; res.end('boom'); return }
    let content
    if (behavior.mode === 'short' && batch && texts.length > 1) content = JSON.stringify(texts.slice(1).map((t) => `译:${t}`))   // 少一句
    else content = batch ? JSON.stringify(texts.map((t) => `译:${t}`)) : `译:${texts[0]}`
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
})
await new Promise((resolve) => llm.listen(0, '127.0.0.1', resolve))
const apiBase = `http://127.0.0.1:${llm.address().port}`
const dir = await mkdtemp(path.join(os.tmpdir(), 'gal-translate-'))
const baseCfg = { galTranslateEnabled: true, galTranslateApiBase: apiBase, galTranslateModel: 'm', galTranslateBatchSize: 5, galTranslateContextSize: 2, galTranslateMaxConcurrency: 1, galTranslateRetryCount: 1, galTranslateRetrySleepMs: 10 }
const lines = (n, from = 0) => Array.from({ length: n }, (_, i) => `台词${from + i}`)
const reset = () => { calls.length = 0; peak = 0; behavior.delayMs = 0; behavior.mode = 'ok'; behavior.failTimes = 0 }

try {
  // ---- 基本：批量 + 缓存（内存 + 磁盘）----
  {
    reset()
    const cfg = { ...baseCfg }
    const tr = createGalTranslator({ getConfig: () => cfg, cacheDir: path.join(dir, 'c1') })
    const r = await tr.handle({ lines: lines(12), priority: 'now', waitMs: 5000 })
    check('批量：12 句、batchSize 5 → 3 次模型调用（5 / 5 / 2），每句都有译文，顺序对', r.status === 200 && r.body.results.every((x, i) => x.state === 'ok' && x.t === `译:台词${i}`) && calls.length === 3 && J(calls.map((c) => c.texts.length)) === J([5, 5, 2]), J([r.status, calls.map((c) => c.texts.length)]))
    const again = await tr.handle({ lines: lines(12), priority: 'now' })
    check('内存缓存：同样的句子再要 = 不再打模型', again.body.results.every((x) => x.state === 'ok') && calls.length === 3)
    const tr2 = createGalTranslator({ getConfig: () => cfg, cacheDir: path.join(dir, 'c1') })
    const disk = await tr2.handle({ lines: lines(12), priority: 'now' })
    check('磁盘缓存：换一个翻译器实例（重启服务）也直接命中', disk.body.results.every((x) => x.state === 'ok') && calls.length === 3)
    const changed = await createGalTranslator({ getConfig: () => ({ ...cfg, galTranslateModel: 'other' }), cacheDir: path.join(dir, 'c1') }).handle({ lines: lines(1), priority: 'now', waitMs: 2000 })
    check('换模型 = 缓存 key 变了，重新翻译', changed.body.results[0].state === 'ok' && calls.length === 4)
  }
  // ---- 并发上限 ----
  for (const limit of [1, 2]) {
    reset()
    behavior.delayMs = 60
    const tr = createGalTranslator({ getConfig: () => ({ ...baseCfg, galTranslateMaxConcurrency: limit }), cacheDir: path.join(dir, `conc${limit}`) })
    const r = await tr.handle({ lines: lines(40), priority: 'ahead', waitMs: 20000 })
    check(`并发上限 ${limit}：40 句 / 8 批，同时在打模型的请求峰值 = ${limit}（服务端观测 ${peak}，翻译器内部 ${tr.stats().maxRunning}）`, r.body.results.every((x) => x.state === 'ok') && peak === limit && tr.stats().maxRunning === limit, J([peak, tr.stats()]))
  }
  // ---- 优先级：now 插队 ----
  {
    reset()
    behavior.delayMs = 80
    const tr = createGalTranslator({ getConfig: () => baseCfg, cacheDir: path.join(dir, 'prio') })
    const ahead = tr.handle({ lines: lines(30), priority: 'ahead', waitMs: 20000 })   // 6 批，一批 80ms，并发 1
    await sleep(30)   // 第一批已经在打
    const nowStarted = Date.now()
    const now = await tr.handle({ lines: [{ text: '玩家现在看的这一句' }], priority: 'now', waitMs: 20000 })
    const nowDone = Date.now() - nowStarted
    await ahead
    const order = calls.map((c) => c.texts[0])
    check('优先级：预加载排着队（6 批）时，玩家这一句（now）只等当前这批打完就轮到它（约 2 批的时间，不是 6 批）', now.body.results[0].state === 'ok' && nowDone < 80 * 3 + 100 && order.indexOf('玩家现在看的这一句') === 1, J([nowDone, order]))
  }
  // ---- 去重 ----
  {
    reset()
    behavior.delayMs = 50
    const tr = createGalTranslator({ getConfig: () => baseCfg, cacheDir: path.join(dir, 'dedup') })
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => tr.handle({ lines: ['同一句话', '另一句'], priority: 'now', waitMs: 5000 })))
    check('去重：3 个请求同时要同样的两句 = 只打一次模型（一批两句），三个请求都拿到译文', calls.length === 1 && [a, b, c].every((r) => r.body.results.every((x) => x.state === 'ok')), J(calls.length))
  }
  // ---- 取消 ----
  {
    reset()
    behavior.delayMs = 80
    const tr = createGalTranslator({ getConfig: () => baseCfg, cacheDir: path.join(dir, 'abort') })
    const controller = new AbortController()
    const pending = tr.handle({ lines: lines(30), priority: 'ahead', waitMs: 20000 }, { signal: controller.signal })
    await sleep(30)
    controller.abort()
    await pending
    await sleep(250)
    check('取消：预加载请求中途取消，还没开始的批不再打模型（只打了已经开始的第一批）', calls.length === 1 && tr.stats().queued === 0 && tr.stats().inflight === 0, J([calls.length, tr.stats()]))
    const later = await tr.handle({ lines: lines(5), priority: 'now', waitMs: 5000 })
    check('取消之后：已经打完的第一批进了缓存，同样的句子直接用（没有新调用）；翻译器仍然可用', later.body.results.every((x) => x.state === 'ok') && calls.length === 1, J(calls.length))
  }
  // ---- 模型答非所问：拆批 ----
  {
    reset()
    behavior.mode = 'short'
    const tr = createGalTranslator({ getConfig: () => baseCfg, cacheDir: path.join(dir, 'split') })
    const r = await tr.handle({ lines: lines(4), priority: 'now', waitMs: 5000 })
    check('整批数量对不上：对半拆开重试，最后单句走纯文本——4 句全部翻出来', r.body.results.every((x, i) => x.state === 'ok' && x.t === `译:台词${i}`), J(r.body.results))
  }
  // ---- 失败 / 重试 / 负缓存 ----
  {
    reset()
    behavior.failTimes = 1
    const tr = createGalTranslator({ getConfig: () => baseCfg, cacheDir: path.join(dir, 'retry') })
    const ok = await tr.handle({ lines: ['重试一次就好'], priority: 'now', waitMs: 5000 })
    check('网络 / 5xx 失败：重试 retryCount 次后成功', ok.body.results[0].state === 'ok' && calls.length === 2, J([ok.body, calls.length]))
    reset()
    behavior.failTimes = 99
    const bad = await tr.handle({ lines: ['一直失败'], priority: 'now', waitMs: 5000 })
    const callsAfterFail = calls.length
    const again = await tr.handle({ lines: ['一直失败'], priority: 'now', waitMs: 5000 })
    check('一直失败：回 error；30 秒内再要同一句不再打模型（负缓存，避免把坏掉的后端打满）', bad.body.results[0].state === 'error' && again.body.results[0].state === 'error' && calls.length === callsAfterFail && callsAfterFail === 2, J([callsAfterFail, calls.length]))
  }
  // ---- waitMs ----
  {
    reset()
    behavior.delayMs = 300
    const tr = createGalTranslator({ getConfig: () => baseCfg, cacheDir: path.join(dir, 'wait') })
    const t0 = Date.now()
    const first = await tr.handle({ lines: ['慢一点的句子'], priority: 'now', waitMs: 80 })
    const waited = Date.now() - t0
    check('waitMs：到点还没好就先回 pending（约 80ms），翻译继续在后台做', first.body.results[0].state === 'pending' && waited < 250, J([first.body, waited]))
    await sleep(400)
    const second = await tr.handle({ lines: ['慢一点的句子'], priority: 'now' })
    check('后台做完后再要：直接拿到译文（缓存），没有再打模型', second.body.results[0].state === 'ok' && calls.length === 1)
  }
  // ---- 校验 / 开关 ----
  {
    const off = createGalTranslator({ getConfig: () => ({ ...baseCfg, galTranslateEnabled: false }), cacheDir: path.join(dir, 'off') })
    const tr = createGalTranslator({ getConfig: () => baseCfg, cacheDir: path.join(dir, 'val') })
    check('没启用 = 503（available: false）；lines 不是数组 / 空 / 太多 / 太长 = 400', (await off.handle({ lines: ['a'] })).status === 503 && (await tr.handle({ lines: 'x' })).status === 400 && (await tr.handle({ lines: [] })).status === 400 && (await tr.handle({ lines: lines(81) })).status === 400 && (await tr.handle({ lines: ['x'.repeat(2001)] })).status === 400)
    reset()
    const blank = await tr.handle({ lines: ['  ', '有字'], priority: 'now', waitMs: 3000 })
    check('空白句子不发给模型，原样回空字符串', blank.body.results[0].t === '' && blank.body.results[1].t === '译:有字' && calls.length === 1 && calls[0].texts.length === 1)
  }
} finally {
  llm.close()
  await rm(dir, { recursive: true, force: true })
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
