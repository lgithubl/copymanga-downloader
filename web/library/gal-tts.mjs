// Gal 台词朗读（TTS）服务（服务端）：复用 EPUB 朗读的 GSV-TTS-Lite 接口（callGsvTtsBatched）和配置（epubTts*：服务地址 / 默认参考音频 / 最大并发 / 每批句数 / 每批字数 / 文本替换规则），
// 再加 Gal 自己的：按「说话人」选音色的规则 galTtsRules、启用开关 galTtsEnabled。
//
// 和 gal-translate.mjs 同一套「预加载 + 并发」设计（GPU 推理比翻译更扛不住乱打）：
//   · 缓存：wav + 字幕 json 落盘（<cacheDir>/<前两位>/<hash>.wav），hash = sha1(朗读文本 + 音色参数)；同一句同一个音色只合成一次，重启也命中。
//   · 去重：同一个 hash 同时被多个请求要 = 只合成一次。
//   · 两档优先级：now（玩家正在听 / 马上要听的）永远排在 ahead（预加载）前面；排在预加载里的被 now 要到会被提到前面。
//   · 并发上限 epubTtsMaxConcurrency：同时打到 GSV 的批数（默认 1）。
//   · 批：/tts/batched 一批只能用一套参考音频和语言，所以同一批只装「音色相同」的句子（队列里往后找），受每批句数 / 每批字数上限约束；
//     整批成败，批里有内容类错误（GSV 返回 400/422/500）就逐句重试，把失败收窄到真正有问题的那句。
//   · 取消：请求带 AbortSignal（客户端断开 / 翻页跳走）：这个请求独占、还没开始合成的句子撤掉；已经在合成的做完进缓存。
//   · 失败：记 30 秒负缓存；没有可读内容的句子（只有符号 / 数字）直接 skipped，不发给 GSV（它一定失败，还会连累同批）。
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ttsParamsFor, ttsVoiceKey } from './epub-tts-flags.mjs'

export const MAX_QUEUE = 2000
export const MAX_LINES_PER_REQUEST = 40
export const MAX_LINE_CHARS = 1000
const NEG_TTL_MS = 30000
const MAX_WAIT_MS = 60000
const MAX_RULES = 50
const PARAM_FIELDS = ['speaker_audio', 'prompt_audio', 'prompt_text', 'text_language', 'prompt_language']
const LANGUAGES = ['ja', 'zh', 'en']
const CONTENT_ERROR = /GSV-TTS-Lite 返回 (?:400|422|500)\b/

// 规则：[{ match（正则字符串，不分大小写）, on?: 'speaker'（默认）| 'text', speaker_audio?, prompt_audio?, prompt_text?, text_language?, prompt_language? }]
// 第一条命中的生效；参数的回落规则和 EPUB 朗读一样（参考音频三件套整组取规则里的，两个语言各自回落）。非法的丢掉；返回 { rules, errors }
export function parseGalTtsRules(value) {
  const rules = []
  const errors = []
  if (value === undefined || value === null || value === '') return { rules, errors }
  if (!Array.isArray(value)) return { rules, errors: [{ index: 0, error: '规则必须是 JSON 数组' }] }
  value.slice(0, MAX_RULES).forEach((raw, i) => {
    const index = i + 1
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push({ index, error: '每条规则必须是对象' }); return }
    const match = typeof raw.match === 'string' ? raw.match.trim() : ''
    if (!match || match.length > 200) { errors.push({ index, error: 'match 要是 1~200 字的正则' }); return }
    let re
    try { re = new RegExp(match, 'i') } catch (error) { errors.push({ index, error: `match 不是合法正则：${error.message}` }); return }
    const on = raw.on === undefined || raw.on === 'speaker' ? 'speaker' : raw.on === 'text' ? 'text' : null
    if (!on) { errors.push({ index, error: "on 只能是 'speaker' 或 'text'" }); return }
    const own = {}
    for (const field of PARAM_FIELDS) {
      const v = raw[field]
      if (v === undefined || v === null || v === '') continue
      if (typeof v !== 'string' || v.length > 2000) { errors.push({ index, error: `${field} 必须是不超过 2000 字的字符串` }); return }
      if (field === 'text_language' || field === 'prompt_language') {
        const language = v.trim().toLowerCase()
        if (language === 'auto') continue
        if (!LANGUAGES.includes(language)) { errors.push({ index, error: `${field} 只能是 ${LANGUAGES.join(' / ')}（或留空）` }); return }
        own[field] = language
      } else own[field] = field === 'prompt_text' ? v : v.trim()
    }
    rules.push({ index, match, re, on, own })
  })
  if (value.length > MAX_RULES) errors.push({ index: MAX_RULES + 1, error: `最多 ${MAX_RULES} 条规则，后面的忽略` })
  return { rules, errors }
}
export function cleanGalTtsRules(value) {
  return parseGalTtsRules(value).rules.map(({ match, on, own }) => ({ match, ...(on === 'text' ? { on } : {}), ...own }))
}

const sha1 = (value) => createHash('sha1').update(value).digest('hex')

export function createGalTts({ getConfig, cacheDir, synth, spoken = (t) => (String(t).trim() || null) }) {
  const neg = new Map()
  const inflight = new Map()
  const nowQ = []
  const aheadQ = []
  let running = 0
  let maxRunning = 0
  let synthCalls = 0
  let seq = 0
  let rulesSource = null
  let rulesParsed = { rules: [], errors: [] }

  const cfg = () => {
    const c = getConfig() || {}
    return {
      enabled: Boolean(c.galTtsEnabled),
      apiBase: String(c.epubTtsApiBase || ''),
      defaults: { speakerAudio: c.epubTtsSpeakerAudio || '', promptAudio: c.epubTtsPromptAudio || '', promptText: c.epubTtsPromptText || '', textLanguage: c.epubTtsTextLanguage || '', promptLanguage: c.epubTtsPromptLanguage || '' },
      maxConcurrency: Math.max(1, Math.min(8, Math.floor(Number(c.epubTtsMaxConcurrency) || 1))),
      batchSentences: Math.max(1, Math.min(20, Math.floor(Number(c.epubTtsBatchMaxSentences) || 5))),
      batchChars: Math.max(20, Math.min(2000, Math.floor(Number(c.epubTtsBatchMaxChars) || 200))),
      rules: c.galTtsRules,
    }
  }
  function rulesOf(c) {
    const source = JSON.stringify(c.rules ?? null)
    if (source !== rulesSource) { rulesSource = source; rulesParsed = parseGalTtsRules(c.rules) }
    return rulesParsed.rules
  }
  // 这句实际用的音色参数：说话人 / 台词命中的第一条规则；lang（朗读的是原文还是译文）覆盖文本语言
  function paramsFor(c, line) {
    const rule = rulesOf(c).find((r) => r.re.test(r.on === 'text' ? line.text : line.speaker || ''))
    const params = rule ? ttsParamsFor(c.defaults, { params: new Map([['r', rule.own]]) }, 'r') : { ...c.defaults }
    if (LANGUAGES.includes(line.lang)) params.textLanguage = line.lang
    return params
  }
  const hashOf = (text, params) => sha1(`${text}\n${ttsVoiceKey(params)}`)
  const fileOf = (hash, ext) => path.join(cacheDir, hash.slice(0, 2), `${hash}.${ext}`)
  const exists = async (file) => { try { await stat(file); return true } catch { return false } }

  async function writeAtomic(file, data) {
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, data)
    await rename(tmp, file)
  }
  const urlOf = (hash) => `/api/gal/tts/${hash}.wav`

  function finish(entry, result) {
    inflight.delete(entry.key)
    entry.result = result
    for (const resolve of entry.resolvers) resolve(result)
    entry.resolvers.length = 0
  }

  async function runBatch(entries) {
    const c = cfg()
    const params = entries[0].params
    const callSynth = (list) => { synthCalls += 1; return synth({ apiBase: c.apiBase, speakerAudio: params.speakerAudio, promptAudio: params.promptAudio, promptText: params.promptText, textLanguage: params.textLanguage, promptLanguage: params.promptLanguage, texts: list.map((e) => e.spoken) }) }
    let results
    try {
      results = await callSynth(entries)
      if (entries.length > 1 && results.some((r) => r.error && CONTENT_ERROR.test(r.error))) {   // 整批成败：逐句重试，把失败收窄到真正有问题的那句
        results = []
        for (const entry of entries) results.push((await callSynth([entry]))[0])
      }
    } catch (error) {
      results = entries.map(() => ({ error: String(error?.message || error) }))
    }
    await Promise.all(entries.map(async (entry, i) => {
      const r = results[i]
      if (!r || r.error) {
        const error = r?.error || '没有返回音频'
        neg.set(entry.key, { until: Date.now() + NEG_TTL_MS, error })
        finish(entry, { state: 'error', error })
        return
      }
      try {
        await writeAtomic(fileOf(entry.key, 'wav'), r.buffer)
        await writeAtomic(fileOf(entry.key, 'json'), JSON.stringify(r.subtitle || null))
        finish(entry, { state: 'ok', url: urlOf(entry.key), subtitle: r.subtitle || null })
      } catch (error) { finish(entry, { state: 'error', error: `写缓存失败：${error.message}` }) }
    }))
  }

  function takeBatch(queue, c) {
    const first = queue.shift()
    const voice = ttsVoiceKey(first.params)
    const batch = [first]
    let chars = first.spoken.length
    for (let i = 0; i < queue.length && batch.length < c.batchSentences;) {
      const e = queue[i]
      if (ttsVoiceKey(e.params) === voice && chars + e.spoken.length <= c.batchChars) { batch.push(e); chars += e.spoken.length; queue.splice(i, 1) } else i += 1
    }
    return batch
  }
  function pump() {
    const c = cfg()
    while (running < c.maxConcurrency && (nowQ.length || aheadQ.length)) {
      const batch = takeBatch(nowQ.length ? nowQ : aheadQ, c)
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
    dropped.result = { state: 'cancelled' }
    for (const resolve of dropped.resolvers) resolve(dropped.result)
  }
  const settled = (result) => ({ peek: () => result, promise: Promise.resolve(result) })
  const handleOf = (entry) => ({ peek: () => entry.result || { state: 'pending' }, promise: entry.result ? Promise.resolve(entry.result) : new Promise((resolve) => entry.resolvers.push(resolve)) })

  // lines: [{ text, speaker?, lang? }]
  async function request(lines, { priority = 'ahead', signal = null } = {}) {
    const c = cfg()
    const owner = ++seq
    const handles = []
    const owned = []
    for (const line of lines) {
      const text = spoken(String(line?.text ?? ''))
      if (text === null) { handles.push(settled({ state: 'skipped' })); continue }
      const params = paramsFor(c, { text, speaker: String(line.speaker || ''), lang: line.lang })
      const key = hashOf(text, params)
      if (!inflight.has(key) && await exists(fileOf(key, 'wav'))) {
        const subtitle = await readFile(fileOf(key, 'json'), 'utf8').then(JSON.parse).catch(() => null)
        handles.push(settled({ state: 'ok', url: urlOf(key), subtitle }))
        continue
      }
      const failed = neg.get(key)
      if (failed && failed.until > Date.now()) { handles.push(settled({ state: 'error', error: failed.error })); continue }
      let entry = inflight.get(key)
      if (!entry) {
        entry = { key, spoken: text, params, started: false, owners: new Set(), resolvers: [], result: null }
        inflight.set(key, entry)
        ;(priority === 'now' ? nowQ : aheadQ).push(entry)
        while (nowQ.length + aheadQ.length > MAX_QUEUE) dropOldestAhead()
      } else if (priority === 'now' && !entry.started) {
        const at = aheadQ.indexOf(entry)
        if (at >= 0) { aheadQ.splice(at, 1); nowQ.push(entry) }
      }
      entry.owners.add(owner)
      owned.push(entry)
      handles.push(handleOf(entry))
    }
    if (signal) {
      const onAbort = () => {
        for (const entry of owned) {
          entry.owners.delete(owner)
          if (!entry.started && !entry.owners.size && !entry.result) {
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

  // HTTP：body { lines: [{ text, speaker?, lang? }], priority, waitMs } → { results: [{ state: ok（url, subtitle）| pending | error | skipped }] }
  async function handle(body, { signal = null } = {}) {
    const c = cfg()
    if (!c.enabled) return { status: 503, body: { error: 'Gal 朗读没有启用（设置里打开 galTtsEnabled，并配好 TTS 服务地址）', available: false } }
    if (!c.apiBase) return { status: 503, body: { error: '没有配置 TTS 服务地址（epubTtsApiBase）', available: false } }
    const raw = Array.isArray(body?.lines) ? body.lines : null
    if (!raw || !raw.length) return { status: 400, body: { error: 'lines 必须是非空数组' } }
    if (raw.length > MAX_LINES_PER_REQUEST) return { status: 400, body: { error: `一次最多 ${MAX_LINES_PER_REQUEST} 句` } }
    const lines = raw.map((item) => ({ text: item?.text, speaker: item?.speaker, lang: item?.lang }))
    if (lines.some((l) => typeof l.text !== 'string' || l.text.length > MAX_LINE_CHARS)) return { status: 400, body: { error: `每句必须是字符串且不超过 ${MAX_LINE_CHARS} 字` } }
    const priority = body.priority === 'now' ? 'now' : 'ahead'
    const waitMs = Math.max(0, Math.min(MAX_WAIT_MS, Math.floor(Number(body.waitMs) || 0)))
    const handles = await request(lines, { priority, signal })
    if (waitMs > 0 && handles.some((h) => h.peek().state === 'pending')) {
      let timer
      await Promise.race([Promise.all(handles.map((h) => h.promise)), new Promise((resolve) => { timer = setTimeout(resolve, waitMs) })])
      clearTimeout(timer)
    }
    return { status: 200, body: { available: true, results: handles.map((h) => { const r = h.peek(); return r.state === 'ok' ? { state: 'ok', url: r.url, subtitle: r.subtitle } : r.state === 'error' ? { state: 'error', error: r.error } : r.state === 'skipped' ? { state: 'skipped' } : { state: 'pending' } }) } }
  }

  return { request, handle, wavPath: (hash) => (/^[0-9a-f]{40}$/.test(hash) ? fileOf(hash, 'wav') : null), rulesErrors: () => rulesParsed.errors, stats: () => ({ queued: nowQ.length + aheadQ.length, running, maxRunning, synthCalls, inflight: inflight.size }) }
}
