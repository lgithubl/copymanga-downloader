// 用 AniDB 标题 dump 匹配作品身份，可选调用 HTTP API 补元数据。
//
// 设计前提（都是实测出来的，不是假设）：
//   - dump 只有标题和 aid，没有年份/集数/tag，那些只能靠 API
//   - API 响应没有任何缓存头（无 etag / last-modified），条件请求用不上，
//     必须自己按 aid 落盘缓存
//   - API 不返回限流信息（无 Retry-After / X-RateLimit-*），被封之前收不到
//     任何预警，所以调用间隔只能自己硬控
//   - 标题在各来源里写法差异很大：撇号有 ' ` ’ 三种，装饰符有 ~~ -- : -，
//     集数标记有 Act.2 / 第一話（汉字数字）/ S01E01，CJK 还没有词边界
//
// 所有参数必须显式配置，不设默认值——配错了宁可直接失败，也不要用一个
// 猜出来的值去打外部接口。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'

export async function generateTags(ctx) {
  const logs = []
  let options
  try {
    options = requireOptions(ctx.script?.options || {})
  } catch (error) {
    // 配置缺失是硬失败：抛出去让任务显示失败，而不是静默跳过
    throw new Error(`配置不完整：${error.message}`)
  }

  const item = ctx.item || {}
  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length
  if (!fullRun) {
    logs.push('选中了部分章节，本脚本只在合集维度产出，本次不写')
    return empty(logs, { scope: 'unit' })
  }

  // —— 1. dump 匹配 ——
  const query = matchQueryOf(item)
  logs.push(`匹配输入：${JSON.stringify(query)}`)
  const index = await loadDumpIndex(options.dumpDir)
  logs.push(`dump：${index.entries.length} 部（${index.source}）`)
  const hit = searchDump(index, query)
  if (!hit) {
    logs.push('dump 里没有任何候选')
    return {
      ...empty(logs, { matched: false }),
      itemTags: ['AniDB: 待确认'],
    }
  }
  logs.push(`最佳匹配 aid=${hit.aid} 分=${hit.score.toFixed(3)} 标题=${hit.title}`)
  if (hit.runnerUp) logs.push(`次优 aid=${hit.runnerUp.aid} 分=${hit.runnerUp.score.toFixed(3)}`)

  // —— 2. 低分就停 ——
  if (hit.score < options.matchThreshold) {
    logs.push(`低于阈值 ${options.matchThreshold}，只记待确认，不写 workKey`)
    return {
      ...empty(logs, { matched: false, aid: hit.aid, score: hit.score }),
      itemTags: ['AniDB: 待确认'],
    }
  }

  const workKey = `anidb:${hit.aid}`
  const existing = String(item.workKey || '')
  if (existing && existing !== workKey && !options.force) {
    // 已经分过组又算出不同的键：默认不动，否则重跑一次可能把已合并的组打散
    logs.push(`已有 workKey=${existing}，与本次 ${workKey} 不同；force 未开启，保持原值`)
    return {
      ...empty(logs, { matched: true, aid: hit.aid, score: hit.score, kept: existing }),
      itemTags: ['AniDB: 待确认'],
    }
  }

  const itemTags = [`AniDB: ${hit.aid}`, `AniDB标题: ${hit.title}`]
  const itemPatch = { workKey }
  logs.push(`写入 workKey=${workKey}${existing === workKey ? '（与原值相同）' : ''}`)

  // —— 3. API 开关 ——
  if (!options.apiEnabled) {
    logs.push('apiEnabled=false，不调用 API')
    return {
      itemTags: [...itemTags, 'AniDBAPI: 未触发'],
      unitTags: [], unitPatches: [], itemPatch, logs,
      details: { aid: hit.aid, score: hit.score, workKey, api: 'disabled' },
    }
  }

  // —— 4. 先查本地缓存，miss 才发请求 ——
  const detail = await loadDetail({ aid: hit.aid, options, logs })
  if (!detail.ok) {
    return {
      itemTags: [...itemTags, 'AniDBAPI: 失败'],
      unitTags: [], unitPatches: [], itemPatch, logs,
      details: { aid: hit.aid, score: hit.score, workKey, api: 'failed', error: detail.error, request: detail.request, response: detail.response },
    }
  }

  const parsed = parseAnimeXml(detail.xml)
  logs.push(`解析出：type=${parsed.type} 集数=${parsed.episodeCount} 年份=${parsed.year} tag=${parsed.tags.length} 个`)
  return {
    itemTags: [...itemTags, `AniDBAPI: ${detail.fromCache ? '缓存' : '成功'}`, ...metadataTags(parsed)],
    unitTags: [], unitPatches: [], itemPatch, logs,
    details: { aid: hit.aid, score: hit.score, workKey, api: detail.fromCache ? 'cache' : 'fetched', parsed },
  }
}

function empty(logs, details) {
  return { itemTags: [], unitTags: [], unitPatches: [], logs, details }
}

// —— 配置：一个都不许缺 ——
function requireOptions(raw) {
  const str = (key) => {
    const v = String(raw[key] ?? '').trim()
    if (!v) throw new Error(`${key} 未配置`)
    return v
  }
  const num = (key) => {
    const v = raw[key]
    if (v === null || v === undefined || v === '') throw new Error(`${key} 未配置`)
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw new Error(`${key} 不是合法数值：${JSON.stringify(v)}`)
    return n
  }
  const options = {
    dumpDir: str('dumpDir'),
    matchThreshold: num('matchThreshold'),
    force: raw.force === true,
    apiEnabled: raw.apiEnabled === true,
  }
  if (!options.apiEnabled) return options
  // 只有开了 API 才校验这批，否则不调用 API 的人被迫填一堆没用的
  return {
    ...options,
    apiBaseUrl: str('apiBaseUrl'),
    apiClient: str('apiClient'),
    apiClientVer: str('apiClientVer'),
    apiCacheDir: str('apiCacheDir'),
    apiSleepBaseMs: num('apiSleepBaseMs'),
    apiSleepJitterMs: num('apiSleepJitterMs'),
    apiTimeoutMs: num('apiTimeoutMs'),
  }
}

// —— dump 载入：目录里找 anime-titles.xml(.gz)，解析成 aid -> 标题数组 ——
let dumpCache = null
async function loadDumpIndex(dir) {
  const candidates = ['anime-titles.xml.gz', 'anime-titles.xml']
  for (const name of candidates) {
    const file = path.join(dir, name)
    try {
      const stat = await import('node:fs/promises').then((m) => m.stat(file))
      const key = `${file}:${stat.mtimeMs}:${stat.size}`
      if (dumpCache?.key === key) return dumpCache.index
      const raw = readFileSync(file)
      const xml = name.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
      const index = buildIndex(xml, name)
      dumpCache = { key, index }
      return index
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`dumpDir 里找不到 anime-titles.xml(.gz)：${dir}`)
}

function buildIndex(xml, source) {
  const entries = []
  for (const m of xml.matchAll(/<anime aid="(\d+)">([\s\S]*?)<\/anime>/g)) {
    const titles = []
    let main = ''
    for (const t of m[2].matchAll(/<title([^>]*)>([\s\S]*?)<\/title>/g)) {
      const text = decodeXml(t[2])
      titles.push(text)
      // 展示用优先 main，其次 official，避免列候选时蹦出法语/韩语标题
      const type = /type="([^"]+)"/.exec(t[1])?.[1] || ''
      if (type === 'main' || (!main && type === 'official')) main = text
    }
    if (titles.length) entries.push({ aid: Number(m[1]), titles, main: main || titles[0] })
  }
  return { entries, source, idf: buildIdf(entries) }
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

// —— 归一化：把各来源标题里真实存在的差异抹平 ——
function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// 集数标记在 AniDB 里属于 episode，不会是独立条目，匹配前必须摘掉。
// 别用 \b 卡「第」：JS 的 \b 只认 ASCII 词字符。数字要同时认阿拉伯和汉字。
const CJK_NUM = '一二三四五六七八九十百千〇零壱弐参'
const EPISODE_TAIL = new RegExp(
  '(?:^|\\s)(?:act|ep|episode|part|vol|volume|chapter|disc)\\s*\\.?\\s*\\d+\\s*$'
  + `|(?:^|\\s)?第\\s*[${CJK_NUM}\\d]+\\s*[話话巻卷部章]\\s*$`
  + '|\\s\\d+\\s*$',
  'iu',
)
function stripEpisodeTail(value) {
  let out = value
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(EPISODE_TAIL, '').trim()
    if (next === out) break
    out = next
  }
  return out
}

// CJK 没有词边界：「茜ハ摘マレ染メラレル」按空格切只有一个 token，
// 而查询写成「茜ハ摘マレ 染メラレル」就成了两个，交集直接为 0（实测）。
// 所以 CJK 去空格取字符 bigram，拉丁仍按词切。数字不进 bigram——
// 英文标题里的「01」会产生无意义 bigram 稀释评分。
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々ー]/u
function tokens(value) {
  const text = normalize(value)
  const out = new Set()
  for (const word of text.split(' ')) if (word && !CJK_RE.test(word)) out.add(word)
  const cjk = [...text].filter((ch) => CJK_RE.test(ch)).join('')
  if (cjk.length === 1) out.add(cjk)
  for (let i = 0; i + 1 < cjk.length; i += 1) out.add(cjk.slice(i, i + 2))
  return out
}

// 纯 Dice 把 a/the/night/dream 和 sleepless 同等对待，「只差一个专有名词」
// 的两条分数几乎一样（实测 0.857 vs 0.833），生产里这种薄分差就是静默误匹配。
// 按 token 在整个语料里的稀有度加权后拉开到 0.18。
function buildIdf(entries) {
  const df = new Map()
  for (const e of entries) {
    const seen = new Set()
    for (const t of e.titles) for (const tok of tokens(t)) seen.add(tok)
    for (const tok of seen) df.set(tok, (df.get(tok) || 0) + 1)
  }
  const n = entries.length || 1
  const idf = new Map()
  for (const [tok, c] of df) idf.set(tok, Math.log(n / (1 + c)))
  idf.set(' fallback', Math.log(n))
  return idf
}

function scoreIdf(a, b, idf) {
  const A = tokens(a); const B = tokens(b)
  if (!A.size || !B.size) return 0
  const w = (t) => idf.get(t) ?? idf.get(' fallback') ?? 1
  let inter = 0; let total = 0
  for (const t of A) { total += w(t); if (B.has(t)) inter += w(t) }
  for (const t of B) total += w(t)
  return total ? (2 * inter) / total : 0
}

function matchQueryOf(item) {
  // 条目标题就是导入时取的文件名词干，是最贴近片源命名的那个
  return String(item.title || item.itemId || '')
}

function searchDump(index, query) {
  const q = stripEpisodeTail(normalize(query))
  if (!q) return null
  let best = null; let second = null
  for (const e of index.entries) {
    let s = 0
    for (const t of e.titles) {
      const v = scoreIdf(q, stripEpisodeTail(normalize(t)), index.idf)
      if (v > s) s = v
    }
    if (!best || s > best.score) { second = best; best = { aid: e.aid, title: e.main, score: s } }
    else if (!second || s > second.score) second = { aid: e.aid, title: e.main, score: s }
  }
  if (!best || best.score <= 0) return null
  return { ...best, runnerUp: second }
}

// —— 详情：本地缓存优先，miss 才发请求 ——
async function loadDetail({ aid, options, logs }) {
  const cacheFile = path.join(options.apiCacheDir, `${aid}.xml`)
  try {
    const xml = await readFile(cacheFile, 'utf8')
    logs.push(`缓存命中 ${cacheFile}，不发请求`)
    return { ok: true, xml, fromCache: true }
  } catch (error) {
    if (error?.code !== 'ENOENT') logs.push(`读缓存失败（当作未命中）：${error.message}`)
  }

  // 没有任何限流反馈，间隔只能自己控。加随机抖动避免多条目同时撞上。
  const wait = options.apiSleepBaseMs + Math.floor(Math.random() * (options.apiSleepJitterMs + 1))
  logs.push(`缓存未命中，等待 ${wait}ms 后请求`)
  await sleep(wait)

  const url = `${options.apiBaseUrl}?request=anime`
    + `&client=${encodeURIComponent(options.apiClient)}`
    + `&clientver=${encodeURIComponent(options.apiClientVer)}`
    + `&protover=1&aid=${aid}`
  const request = { url, method: 'GET', timeoutMs: options.apiTimeoutMs }
  let response = null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.apiTimeoutMs)
    let res
    try {
      res = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    const body = await res.text()
    response = { status: res.status, headers: Object.fromEntries(res.headers), bodyPreview: body.slice(0, 2000) }
    if (!res.ok) {
      logs.push(`HTTP ${res.status}`)
      return { ok: false, error: `HTTP ${res.status}`, request, response }
    }
    // AniDB 用 200 返回业务错误，必须看 body 而不是状态码
    const err = /<error[^>]*>([\s\S]*?)<\/error>/.exec(body)
    if (err) {
      logs.push(`接口返回错误：${err[0].slice(0, 160)}`)
      return { ok: false, error: err[1].trim(), request, response }
    }
    if (!/<anime\b/.test(body)) {
      return { ok: false, error: '响应里没有 <anime> 节点', request, response }
    }
    await mkdir(options.apiCacheDir, { recursive: true })
    await writeFile(cacheFile, body)
    logs.push(`请求成功，已写入缓存 ${cacheFile}`)
    return { ok: true, xml: body, fromCache: false }
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `超时（${options.apiTimeoutMs}ms）` : error.message
    logs.push(`请求失败：${reason}`)
    return { ok: false, error: reason, request, response }
  }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// —— 解析 ——
function parseAnimeXml(xml) {
  const pick = (tag) => decodeXml((new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] || '').trim())
  const startdate = pick('startdate')
  const tags = []
  for (const m of xml.matchAll(/<tag\b[^>]*>([\s\S]*?)<\/tag>/g)) {
    const name = decodeXml(/<name>([\s\S]*?)<\/name>/.exec(m[1])?.[1] || '').trim()
    if (name) tags.push(name)
  }
  return {
    type: pick('type'),
    episodeCount: pick('episodecount'),
    startdate,
    year: startdate.slice(0, 4),
    picture: pick('picture'),
    restricted: /restricted="true"/.test(xml),
    tags,
  }
}

function metadataTags(parsed) {
  const out = []
  if (parsed.type) out.push(`ANI类型: ${parsed.type}`)
  if (parsed.episodeCount) out.push(`ANI集数: ${parsed.episodeCount}`)
  if (parsed.year) out.push(`ANI年份: ${parsed.year}`)
  return out
}
