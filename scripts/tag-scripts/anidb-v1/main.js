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
  const query = matchQueryOf(item, options, logs)
  logs.push(`匹配输入：${JSON.stringify(query)}`)
  const index = await loadDumpIndex(options.dumpDir)
  logs.push(`dump：${index.entries.length} 部（${index.source}）`)
  const hit = searchWithMode(index, query, options, logs)
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
  // 退化命中单独标出来。和精确命中混在一起的话，你没法把需要人工复核的那批挑出来，
  // 而退化命中恰恰是最可能错的那批（短前缀撞上同名作品，还是满分撞上）。
  if (hit.viaPrefix) {
    itemTags.push(`AniDB匹配: 前缀 ${hit.viaPrefix} 段`)
    logs.push(`注意：本次是前缀退化命中（用「${hit.prefixQuery}」匹配上的），建议复核`)
  }
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
    // 这两项和本脚本「所有参数必填」的惯例相反，是可选的：不配就完全不做预处理，
    // 行为和没有这个功能时一模一样。故意如此——它们是纯增强，不该强迫所有人填。
    titleEncoding: titleEncodingOf(raw.titleEncoding),
    titleRewrite: compileRewrite(raw.titleRewrite),
    // 匹配模式。同样可选，不配就是 exact——和没有这个功能时逐字节一致。
    // prefix 的存在理由：dump 里存的是作品名，片源文件名常是「作品名 副标题 话数」，
    // 对称相似度被长度差拖垮（实测 やりマン不動産：全名 0.313，只留作品名 1.000）。
    matchMode: matchModeOf(raw.matchMode),
    // 退化到比这更短就停。dump 里 ≤4 字的标题有 6530 条，退到那个长度几乎必然
    // 撞上不相干的作品，而且是满分撞上——比「不确定就不写」危险得多。
    prefixMinChars: optionalNum(raw.prefixMinChars, 5),
    // 原标题不足这么多段就不退化：没有噪声可削，退化只会削掉正文。
    prefixMinSegments: optionalNum(raw.prefixMinSegments, 2),
    // 退化命中要求 最佳分 ≥ 次优分 × 它。0 = 关闭。撞同名作品时次优分通常也高，
    // 这条能挡一部分；但同系列多部作品次优分天然高，开太大会误杀。
    prefixRunnerUpRatio: optionalNum(raw.prefixRunnerUpRatio, 0),
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

// 允许的编码。顺序即 auto 模式下的尝试顺序，也是分数打平时的优先级。
const TITLE_ENCODINGS = ['utf-8', 'euc-jp', 'shift_jis', 'cp932', 'gb18030']

function titleEncodingOf(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return ''                      // 不配 = 不解码
  if (v === 'auto') return 'auto'
  if (TITLE_ENCODINGS.includes(v)) return v
  throw new Error(`titleEncoding 不支持：${JSON.stringify(value)}（可选 auto / ${TITLE_ENCODINGS.join(' / ')}）`)
}

function matchModeOf(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return 'exact'                 // 不配 = 现在的行为
  if (v === 'exact' || v === 'prefix') return v
  throw new Error(`matchMode 不支持：${JSON.stringify(value)}（可选 exact / prefix）`)
}

// 和 num() 不同：这批是可选项，不配用默认值，配了就必须合法——
// 静默忽略一个写错的阈值，比报错危险得多。
function optionalNum(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`不是合法数值：${JSON.stringify(value)}`)
  return n
}

// 正则在这里就编译掉：配错了当场报「配置不完整」，而不是等跑到一半才炸。
function compileRewrite(value) {
  if (value === null || value === undefined || value === '') return []
  if (!Array.isArray(value)) throw new Error('titleRewrite 必须是数组')
  return value.map((rule, i) => {
    const pattern = String(rule?.pattern ?? '')
    if (!pattern) throw new Error(`titleRewrite[${i}].pattern 不能为空`)
    const flags = String(rule?.flags ?? 'g')
    let re
    try {
      re = new RegExp(pattern, flags)
    } catch (error) {
      throw new Error(`titleRewrite[${i}] 正则非法：${error.message}`)
    }
    return { re, replace: String(rule?.replace ?? ''), pattern, flags }
  })
}

// 合理性打分：解对了会是成片的假名和常用汉字；解错了会蹦出私用区和生僻字。
// 这招分不开 GB18030 和 EUC-JP 互相误读的情况（实测 4/17 会判错，且分数打平），
// 所以 auto 只是省事，真有歧义得靠 titleEncoding 显式指定。
function plausibility(text) {
  if (!text) return -Infinity
  let kana = 0; let cjk = 0; let ascii = 0; let junk = 0; let rare = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)
    if (c >= 0x3040 && c <= 0x30ff) kana += 1
    else if (c >= 0x4e00 && c <= 0x9fff) cjk += 1
    else if (c < 128) ascii += 1
    if ((c >= 0xe000 && c <= 0xf8ff) || ch === '\uFFFD') junk += 1
    else if (c > 0x9fff && c < 0xf900) rare += 1
  }
  return (kana * 3 + cjk * 2 + ascii * 0.5 - junk * 20 - rare * 5) / text.length
}

function decodeTitle(text, encoding, logs) {
  // 闸门：没有 %XX 就完全不碰。正常标题一个字符都不会动，零回归面。
  if (!encoding || !/%[0-9a-fA-F]{2}/.test(text)) return text
  let bytes
  try {
    bytes = Uint8Array.from(
      text.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
      (ch) => ch.charCodeAt(0) & 0xff,
    )
  } catch (error) {
    logs.push(`百分号解码失败，按原文匹配：${error.message}`)
    return text
  }
  const candidates = []
  for (const enc of encoding === 'auto' ? TITLE_ENCODINGS : [encoding]) {
    try {
      const decoded = new TextDecoder(enc, { fatal: true }).decode(bytes)
      candidates.push({ enc, decoded, score: plausibility(decoded) })
    } catch {
      // 解不出就是淘汰，不记噪声日志
    }
  }
  if (!candidates.length) {
    logs.push(`${encoding} 下没有任何编码解得出，按原文匹配`)
    return text
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  logs.push(`编码候选：${candidates.map((c) => `${c.enc}(${c.score.toFixed(2)})`).join(' ')} -> 选 ${best.enc}`)
  // 分数贴得太近就是没把握，明说出来，别让人以为判定是确定的
  if (candidates[1] && best.score - candidates[1].score < 0.3) {
    logs.push(`⚠ 前两名分差 ${(best.score - candidates[1].score).toFixed(2)} < 0.3，可能判错；建议把 titleEncoding 写死`)
  }
  return best.decoded
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

function matchQueryOf(item, options, logs) {
  // 条目标题就是导入时取的文件名词干，是最贴近片源命名的那个
  const raw = String(item.title || item.itemId || '')
  // 下面两步只改「喂给 dump 的那个串」。item.title 本身、dump 侧、API 调用、
  // 产出的 tag——全都不受影响。
  const decoded = decodeTitle(raw, options.titleEncoding, logs)
  if (decoded !== raw) logs.push(`解码后：${JSON.stringify(decoded)}`)
  let rewritten = decoded
  for (const rule of options.titleRewrite) {
    rewritten = rewritten.replace(rule.re, rule.replace)
  }
  rewritten = rewritten.trim()
  if (rewritten !== decoded) logs.push(`重写后：${JSON.stringify(rewritten)}`)
  // 规则吃光了就退回解码前的串，宁可匹配不准也不要拿空串去搜
  return rewritten || decoded || raw
}

// 按 matchMode 分派。exact 就是原来那条路，一个字节都没变。
// prefix 按空格从右往左逐段削：「A B C」→「A B」→「A」，第一个过阈值的就收。
// 这么做的原因是 dump 存作品名、文件名带副标题和话数，对称相似度被长度差拖垮；
// 削掉尾巴不需要知道噪声长什么样，所以不像正则那样「匹配不完」。
function searchWithMode(index, query, options, logs) {
  const first = searchDump(index, query)
  if (options.matchMode !== 'prefix') return first
  if (first && first.score >= options.matchThreshold) return first

  const segments = String(query).split(/\s+/).filter(Boolean)
  if (segments.length < options.prefixMinSegments) {
    logs.push(`prefix：只有 ${segments.length} 段，不足 ${options.prefixMinSegments} 段，不退化`)
    return first
  }
  for (let n = segments.length - 1; n >= 1; n -= 1) {
    const candidate = segments.slice(0, n).join(' ')
    if (candidate.length < options.prefixMinChars) {
      logs.push(`prefix：退到「${candidate}」已短于 ${options.prefixMinChars} 字，停止`)
      break
    }
    const hit = searchDump(index, candidate)
    if (!hit) continue
    logs.push(`prefix：${n}/${segments.length} 段「${candidate}」→ aid=${hit.aid} 分=${hit.score.toFixed(3)}`)
    if (hit.score < options.matchThreshold) continue
    // 撞同名作品时次优分通常也高，这条用来挡一部分。0 = 关闭。
    const runnerUp = hit.runnerUp?.score || 0
    if (options.prefixRunnerUpRatio > 0 && runnerUp > 0
        && hit.score < runnerUp * options.prefixRunnerUpRatio) {
      logs.push(`prefix：与次优 ${runnerUp.toFixed(3)} 差距不足 ${options.prefixRunnerUpRatio} 倍，不采信`)
      continue
    }
    // 标出来是退化命中的：和精确命中混在一起的话，你没法挑出需要复核的那批
    return { ...hit, viaPrefix: `${n}/${segments.length}`, prefixQuery: candidate }
  }
  logs.push('prefix：逐级退化后仍无命中')
  return first
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
