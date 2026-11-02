// Gal 台词翻译服务（服务端）：调 OpenAI 兼容的 /v1/chat/completions（和 ai-translate-subtitle-v1 同一类后端，默认 sakura），带缓存 / 去重 / 优先级 / 并发上限 / 取消。
//
// 设计（预加载 + 并发）：
//   · 缓存：句子 → 译文，key = sha1([模型, 目标语言, 提示词, 原文])；内存 LRU（5000 条）+ 磁盘（<cacheDir>/<前两位>/<hash>.txt，写临时文件再改名）。改模型 / 提示词 / 语言 key 自然变，不会读到旧译文。
//   · 去重：同一句同时被多个请求要 = 只打一次模型（在途表 inflight，后来的加入等待者）。
//   · 优先级两档：now（玩家正看着的这一句）/ ahead（预加载）。worker 先取 now 队列；已经排在 ahead 里的句子被 now 要到会被提到 now 队列。
//   · 并发上限 galTranslateMaxConcurrency（本地模型 / GPU 扛不住乱打，默认 1）：最多这么多个批在同时打模型；批 = 队列头部最多 batchSize 句（同一档、按入队顺序），每批带前 contextSize 句当上文。
//   · 取消：请求带 AbortSignal（客户端断开 / 翻页跳走）：这个请求独占、还没开始打模型的句子从队列里撤掉；已经在打的继续打完（结果进缓存，下次直接用）。
//   · 失败：整批答非所问（数量不对 / 解析不了）就对半拆、最后单句纯文本；网络 / 5xx 重试 retryCount 次；仍失败的句子记一个短时间的负缓存（30 秒），避免客户端反复请求把坏掉的后端打满。
//   · 队列上限 MAX_QUEUE：超了先丢最老的 ahead。
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MAX_QUEUE = 4000
export const MAX_LINES_PER_REQUEST = 80
export const MAX_LINE_CHARS = 2000
const MEM_MAX = 5000
const NEG_TTL_MS = 30000
const MAX_WAIT_MS = 30000

const sha1 = (value) => createHash('sha1').update(value).digest('hex')
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 从模型回复里取 JSON 数组（容忍 ```json 围栏 / 前后废话）；取不到 = null
export function parseJsonArray(content) {
  const text = String(content || '').replace(/```(?:json)?/gi, '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(value)) return null
    return value.map((item) => (typeof item === 'string' ? item : item == null ? '' : String(item)))
  } catch { return null }
}
// 单句纯文本回复：去掉围栏 / 外层引号
export function cleanPlain(content) {
  let text = String(content || '').replace(/```[a-z]*/gi, '').trim()
  const quoted = /^["「『“](.*)["」』”]$/s.exec(text)
  if (quoted && !/["「『“」』”]/.test(quoted[1])) text = quoted[1]
  return text.trim()
}

export function createGalTranslator({ getConfig, cacheDir, fetchImpl = fetch }) {
  const mem = new Map()          // key → 译文（插入序 = LRU 序）
  const neg = new Map()          // key → { until, error }
  const inflight = new Map()     // key → entry
  const nowQ = []
  const aheadQ = []
  let running = 0
  let maxRunning = 0             // 观测用：同时在打的批数峰值
  let modelCalls = 0
  let seq = 0

  const cfg = () => {
    const c = getConfig() || {}
    return {
      enabled: Boolean(c.galTranslateEnabled),
      apiBase: String(c.galTranslateApiBase || '').replace(/\/+$/, ''),
      apiKey: String(c.galTranslateApiKey || ''),
      model: String(c.galTranslateModel || 'sakura'),
      prompt: String(c.galTranslatePrompt || ''),
      source: String(c.galTranslateSourceLanguage || 'ja'),
      target: String(c.galTranslateTargetLanguage || 'zh'),
      batchSize: Math.max(1, Math.min(50, Math.floor(Number(c.galTranslateBatchSize) || 15))),
      contextSize: Math.max(0, Math.min(10, Math.floor(Number(c.galTranslateContextSize ?? 2)))),
      maxConcurrency: Math.max(1, Math.min(8, Math.floor(Number(c.galTranslateMaxConcurrency) || 1))),
      timeoutMs: Math.max(1000, Number(c.galTranslateTimeoutMs) || 120000),
      retryCount: Math.max(0, Math.min(5, Math.floor(Number(c.galTranslateRetryCount ?? 2)))),
      retrySleepMs: Math.max(0, Number(c.galTranslateRetrySleepMs ?? 1000)),
    }
  }
  const keyOf = (c, text) => sha1(JSON.stringify([c.model, c.target, c.prompt, text]))
  const diskPath = (key) => path.join(cacheDir, key.slice(0, 2), `${key}.txt`)

  function remember(key, value) {
    mem.delete(key)
    mem.set(key, value)
    while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value)
  }
  async function readDisk(key) {
    try { return await readFile(diskPath(key), 'utf8') } catch { return null }
  }
  async function writeDisk(key, value) {
    const file = diskPath(key)
    try {
      await mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, value, 'utf8')
      await rename(tmp, file)
    } catch { /* 写不了缓存不影响这次结果 */ }
  }

  // ---- 打模型 ----
  function messages(c, texts, ctx) {
    const context = ctx.length ? `上文（仅供理解语境，不要翻译）：\n${ctx.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n` : ''
    const head = `${c.prompt || `将下面的${c.source === 'ja' ? '日文' : c.source}台词翻译成${c.target === 'zh' ? '简体中文' : c.target}。保持口语化和角色语气，不要添加原文没有的解释或注释。`}`
    if (texts.length === 1) return [{ role: 'system', content: head }, { role: 'user', content: `${context}翻译下面这一句，只输出译文，不要加引号或说明：\n${texts[0]}` }]
    return [{ role: 'system', content: head }, { role: 'user', content: `${context}下面有 ${texts.length} 句台词，按顺序逐句翻译。只输出一个 JSON 数组，元素是对应的译文字符串，数量必须正好是 ${texts.length}：\n${JSON.stringify(texts)}` }]
  }
  async function chat(c, texts, ctx) {
    modelCalls += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), c.timeoutMs)
    try {
      const res = await fetchImpl(`${c.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
        body: JSON.stringify({ model: c.model, messages: messages(c, texts, ctx), temperature: 0.2, stream: false }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`模型返回 ${res.status}`)
      const data = await res.json()
      return String(data?.choices?.[0]?.message?.content ?? '')
    } finally { clearTimeout(timer) }
  }
  async function chatRetry(c, texts, ctx) {
    let last
    for (let attempt = 0; attempt <= c.retryCount; attempt++) {
      try { return await chat(c, texts, ctx) } catch (error) { last = error; if (attempt < c.retryCount) await sleepMs(c.retrySleepMs) }
    }
    throw last
  }
  // texts → 译文数组（长度一致）；整批对不上就对半拆，单句走纯文本
  async function translateTexts(c, texts, ctx) {
    if (texts.length === 1) {
      const out = cleanPlain(await chatRetry(c, texts, ctx))
      if (!out) throw new Error('模型返回空译文')
      return [out]
    }
    const parsed = parseJsonArray(await chatRetry(c, texts, ctx))
    if (parsed && parsed.length === texts.length && parsed.every((t, i) => t.trim() || !texts[i].trim())) return parsed
    const mid = Math.ceil(texts.length / 2)
    const left = await translateTexts(c, texts.slice(0, mid), ctx)
    const right = await translateTexts(c, texts.slice(mid), [...ctx, ...texts.slice(0, mid)].slice(-c.contextSize))
    return [...left, ...right]
  }

  async function runBatch(entries) {
    const c = cfg()
    const texts = entries.map((e) => e.text)
    const ctx = entries[0].ctx.slice(-c.contextSize)
    try {
      const out = await translateTexts(c, texts, c.contextSize ? ctx : [])
      entries.forEach((entry, i) => finish(entry, { state: 'ok', t: out[i] }, true))
    } catch (error) {
      for (const entry of entries) { neg.set(entry.key, { until: Date.now() + NEG_TTL_MS, error: String(error?.message || error) }); finish(entry, { state: 'error', error: String(error?.message || error) }, false) }
    }
  }
  function finish(entry, result, store) {
    if (store) { remember(entry.key, result.t); writeDisk(entry.key, result.t) }
    inflight.delete(entry.key)
    entry.result = result
    for (const resolve of entry.resolvers) resolve(result)
    entry.resolvers.length = 0
  }

  function pump() {
    const { maxConcurrency, batchSize } = cfg()
    while (running < maxConcurrency && (nowQ.length || aheadQ.length)) {
      const queue = nowQ.length ? nowQ : aheadQ
      const batch = queue.splice(0, batchSize)
      for (const entry of batch) entry.started = true
      running += 1
      maxRunning = Math.max(maxRunning, running)
      runBatch(batch).finally(() => { running -= 1; pump() })
    }
  }
  function dropOldestAhead() {
    const dropped = aheadQ.shift()
    if (!dropped) return
    inflight.delete(dropped.key)
    const result = { state: 'cancelled' }
    dropped.result = result
    for (const resolve of dropped.resolvers) resolve(result)
  }

  // lines: [{ text, ctx?: string[] }]；返回每句一个 { peek(), promise }：peek() 现在的状态（ok / pending / error / cancelled），promise 在出结果时 resolve
  async function request(lines, { priority = 'ahead', signal = null } = {}) {
    const c = cfg()
    const owner = ++seq
    const handles = []
    const owned = []
    for (const line of lines) {
      const text = String(line?.text ?? '').trim()
      if (!text) { handles.push(settled({ state: 'ok', t: '' })); continue }
      const key = keyOf(c, text)
      if (mem.has(key)) { const t = mem.get(key); remember(key, t); handles.push(settled({ state: 'ok', t })); continue }
      const failed = neg.get(key)
      if (failed && failed.until > Date.now()) { handles.push(settled({ state: 'error', error: failed.error })); continue }
      let entry = inflight.get(key)
      if (!entry) {
        const disk = await readDisk(key)
        if (disk !== null) { remember(key, disk); handles.push(settled({ state: 'ok', t: disk })); continue }
        entry = inflight.get(key)   // 读盘期间别的请求可能已经排上了
      }
      if (!entry) {
        entry = { key, text, ctx: (Array.isArray(line.ctx) ? line.ctx : []).map((t) => String(t).slice(0, MAX_LINE_CHARS)), started: false, owners: new Set(), resolvers: [], result: null, order: ++seq }
        inflight.set(key, entry)
        ;(priority === 'now' ? nowQ : aheadQ).push(entry)
        while (nowQ.length + aheadQ.length > MAX_QUEUE) dropOldestAhead()
      } else if (priority === 'now' && !entry.started) {
        const at = aheadQ.indexOf(entry)
        if (at >= 0) { aheadQ.splice(at, 1); nowQ.push(entry) }   // 预加载里排着的，玩家现在就要：提到 now
      }
      entry.owners.add(owner)
      owned.push(entry)
      handles.push(handleOf(entry))
    }
    if (signal) {
      const onAbort = () => {
        for (const entry of owned) {
          entry.owners.delete(owner)
          if (!entry.started && !entry.owners.size && !entry.result) {   // 只有这个请求要它、还没开始打：撤掉
            for (const queue of [nowQ, aheadQ]) { const at = queue.indexOf(entry); if (at >= 0) queue.splice(at, 1) }
            inflight.delete(entry.key)
            entry.result = { state: 'cancelled' }
            for (const resolve of entry.resolvers) resolve(entry.result)
          }
        }
      }
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true })
    }
    pump()
    return handles
  }
  const settled = (result) => ({ peek: () => result, promise: Promise.resolve(result) })
  const handleOf = (entry) => ({
    peek: () => entry.result || { state: 'pending' },
    promise: entry.result ? Promise.resolve(entry.result) : new Promise((resolve) => entry.resolvers.push(resolve)),
  })

  // HTTP 层：body { lines: [string | { text, ctx }], priority: 'now' | 'ahead', waitMs }；返回 { results: [{ state, t?, error? }] }
  // waitMs：最多等这么久（毫秒，上限 30s），到点还没好的句子回 pending（翻译继续在后台做，缓存里有了下次直接取）
  async function handle(body, { signal = null } = {}) {
    const c = cfg()
    if (!c.enabled) return { status: 503, body: { error: '翻译没有启用（设置里打开 galTranslateEnabled 并填模型地址）', available: false } }
    if (!c.apiBase) return { status: 503, body: { error: '没有配置翻译模型地址（galTranslateApiBase）', available: false } }
    const raw = Array.isArray(body?.lines) ? body.lines : null
    if (!raw || !raw.length) return { status: 400, body: { error: 'lines 必须是非空数组' } }
    if (raw.length > MAX_LINES_PER_REQUEST) return { status: 400, body: { error: `一次最多 ${MAX_LINES_PER_REQUEST} 句` } }
    const lines = raw.map((item) => (typeof item === 'string' ? { text: item } : { text: item?.text, ctx: item?.ctx }))
    if (lines.some((l) => typeof l.text !== 'string' || l.text.length > MAX_LINE_CHARS)) return { status: 400, body: { error: `每句必须是字符串且不超过 ${MAX_LINE_CHARS} 字` } }
    const priority = body.priority === 'now' ? 'now' : 'ahead'
    const waitMs = Math.max(0, Math.min(MAX_WAIT_MS, Math.floor(Number(body.waitMs) || 0)))
    const handles = await request(lines, { priority, signal })
    if (waitMs > 0 && handles.some((h) => h.peek().state === 'pending')) {
      let timer
      await Promise.race([Promise.all(handles.map((h) => h.promise)), new Promise((resolve) => { timer = setTimeout(resolve, waitMs) })])
      clearTimeout(timer)
    }
    return { status: 200, body: { available: true, results: handles.map((h) => { const r = h.peek(); return r.state === 'ok' ? { state: 'ok', t: r.t } : r.state === 'error' ? { state: 'error', error: r.error } : { state: 'pending' } }) } }
  }

  return { request, handle, stats: () => ({ queued: nowQ.length + aheadQ.length, running, maxRunning, modelCalls, cached: mem.size, inflight: inflight.size }), resetStats() { maxRunning = 0; modelCalls = 0 } }
}
