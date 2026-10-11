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
  // 括号 tag 先算：它来自文件名，和 AniDB 匹配成不成功没关系。放在成功分支里的话，
  // 匹配不上的条目一个标签都拿不到——而那恰恰是最需要人工靠文件名辨认的那批。
  // 用的是【原始】标题：titleRewrite 那套规则第一件事就是把括号删掉，用重写后的串提不到。
  const units = Array.isArray(ctx.units) ? ctx.units : []
  // 章节各提各的；条目提「自己的标题 + 所有章节标题」的并集，跨标题去重。
  //
  // 条目这里用并集而不是只看 item.title，是因为 titleFromJa 会把条目标题换成日文
  // （括号随之消失）。重跑时只看 item.title 会提到空数组，而 mergeGeneratedTags
  // 把「本脚本上次产出、这次没有」的 tag 当作要删除的——括号 tag 会在第二次运行时
  // 自己消失。章节标题取自文件名且永不改写，并集能把它们重新提回来。
  // 合并后的条目下，章节来自不同源文件、括号各不相同，并集也正是想要的结果。
  const unitBracketTags = options.bracketTags
    ? units
      .map((unit) => ({
        unitId: unit.unitId,
        tags: bracketTagsOf(String(unit.title || ''), options.bracketTagPrefix),
      }))
      .filter((entry) => entry.unitId && entry.tags.length)
    : []
  const fileTags = options.bracketTags
    ? [...new Set([
      ...bracketTagsOf(String(item.title || ''), options.bracketTagPrefix),
      ...unitBracketTags.flatMap((entry) => entry.tags),
    ])]
    : []
  if (options.bracketTags) {
    logs.push(fileTags.length
      ? `括号 tag：条目 ${fileTags.length} 个（${fileTags.join('、')}）；${unitBracketTags.length}/${units.length} 个章节有产出`
      : '文件名和章节名里都没有括号内容可提取')
  }
  const index = await loadDumpIndex(options.dumpDir)
  logs.push(`dump：${index.entries.length} 部（${index.source}）`)

  // 已经匹配过就不再重新匹配。aid 一旦定下来就该稳定：重跑让它漂移会把已合并的组打散，
  // 而短标题（实测 "rj" 能满分撞上「ロミオ×ジュリエット」）每次重算都是一次赌博。
  // forceRematch 打开才强制重走 dump。
  //
  // 跳过的只是「打分」，不是「取数据」——这里仍按 aid 回查 dump 拿标题。不回查的话
  // 这一轮产不出 AniDB标题，而服务端把「上次产出、这次没有」的 tag 当作要删除的
  // （server.mjs mergeGeneratedTags，实测验证过），复用路径反而会把标题 tag 抹掉。
  const knownAid = options.forceRematch ? 0 : aidFromTags(item.tags)
  let hit
  if (knownAid) {
    const entry = index.entries.find((e) => e.aid === knownAid)
    hit = {
      aid: knownAid,
      title: entry?.main || '',
      ja: entry?.ja || '',
      score: null,
      reused: true,
      // 上次如果是退化命中，那个标记现在仍然成立。不带上的话服务端会把它当成
      // 「本脚本上次产出、这次没有」删掉——而它恰恰是标记「需要人工复核」的 tag，
      // 静默消失最危险（这条是被测试抓出来的，不是预想到的）。
      keptMatchNote: (item.tags || []).map(String).find((t) => t.startsWith('AniDB匹配: ')) || '',
    }
    logs.push(entry
      ? `tag 里已有 aid=${knownAid}，跳过 dump 匹配（标题：${entry.ja || entry.main}）`
      : `tag 里已有 aid=${knownAid}，跳过 dump 匹配；但该 aid 不在当前 dump 里，这次拿不到标题`)
  } else {
    const query = matchQueryOf(item, options, logs)
    logs.push(`匹配输入：${JSON.stringify(query)}`)
    hit = searchWithMode(index, query, options, logs)
    if (!hit) {
      logs.push('dump 里没有任何候选')
      return {
        ...empty(logs, { matched: false }, unitBracketTags),
        itemTags: [...fileTags, 'AniDB: 待确认'],
      }
    }
    logs.push(`最佳匹配 aid=${hit.aid} 分=${hit.score.toFixed(3)} 标题=${hit.title}`)
    if (hit.runnerUp) logs.push(`次优 aid=${hit.runnerUp.aid} 分=${hit.runnerUp.score.toFixed(3)}`)
  }

  // —— 2. 低分就停 ——
  // 复用路径没有分数（score=null），不参与阈值判断——那个 aid 是上次已经过了阈值才写下的。
  if (!hit.reused && hit.score < options.matchThreshold) {
    logs.push(`低于阈值 ${options.matchThreshold}，只记待确认，不写 workKey`)
    return {
      ...empty(logs, { matched: false, aid: hit.aid, score: hit.score }, unitBracketTags),
      itemTags: [...fileTags, 'AniDB: 待确认'],
    }
  }

  const workKey = `anidb:${hit.aid}`
  const existing = String(item.workKey || '')
  if (existing && existing !== workKey && !options.force) {
    // 已经分过组又算出不同的键：默认不动，否则重跑一次可能把已合并的组打散
    logs.push(`已有 workKey=${existing}，与本次 ${workKey} 不同；force 未开启，保持原值`)
    return {
      ...empty(logs, { matched: true, aid: hit.aid, score: hit.score, kept: existing }, unitBracketTags),
      itemTags: [...fileTags, 'AniDB: 待确认'],
    }
  }

  // tag 用日文标题。dump 实测 17046 部里 15108 部（88.6%）有 ja，剩下 11.4%
  // 回退罗马字 main，不额外标记——混着也能接受，总比没有强。
  const itemTags = [...fileTags, `AniDB: ${hit.aid}`, `AniDB标题: ${hit.ja || hit.title}`]
  // 退化命中单独标出来。和精确命中混在一起的话，你没法把需要人工复核的那批挑出来，
  // 而退化命中恰恰是最可能错的那批（短前缀撞上同名作品，还是满分撞上）。
  if (hit.viaPrefix) {
    itemTags.push(`AniDB匹配: 前缀 ${hit.viaPrefix} 段`)
    logs.push(`注意：本次是前缀退化命中（用「${hit.prefixQuery}」匹配上的），建议复核`)
  } else if (hit.keptMatchNote) {
    itemTags.push(hit.keptMatchNote)
    logs.push(`沿用上次的匹配标记「${hit.keptMatchNote}」（本次未重新匹配）`)
  }
  const itemPatch = { workKey }
  // 日文标题改条目标题。dump 里没有 ja 就什么都不做——宁可保持原标题，
  // 也不要把它换成罗马字（那等于把一个可读的名字换成另一种写法，没有收益）。
  if (options.titleFromJa) {
    if (hit.ja) {
      itemPatch.title = hit.ja
      logs.push(`条目标题改为日文官方标题：${JSON.stringify(hit.ja)}`)
    } else {
      logs.push(`titleFromJa 开着，但 aid=${hit.aid} 在 dump 里没有日文标题，保持原标题`)
    }
  }
  logs.push(`写入 workKey=${workKey}${existing === workKey ? '（与原值相同）' : ''}`)

  // —— 3. API 开关 ——
  if (!options.apiEnabled) {
    logs.push('apiEnabled=false，不调用 API')
    return {
      itemTags: [...itemTags, 'AniDBAPI: 未触发'],
      unitTags: unitBracketTags, unitPatches: [], itemPatch, logs,
      details: { aid: hit.aid, score: hit.score, workKey, api: 'disabled' },
    }
  }

  // —— 4. 先查本地缓存，miss 才发请求 ——
  const detail = await loadDetail({ ctx, aid: hit.aid, options, logs })
  if (!detail.ok) {
    return {
      itemTags: [...itemTags, detail.banned ? 'AniDBAPI: 被封' : 'AniDBAPI: 失败'],
      unitTags: unitBracketTags, unitPatches: [], itemPatch, logs,
      details: { aid: hit.aid, score: hit.score, workKey, api: detail.banned ? 'banned' : 'failed', error: detail.error, request: detail.request, response: detail.response },
    }
  }

  const parsed = parseAnimeXml(detail.xml)
  logs.push(`解析出：type=${parsed.type} 集数=${parsed.episodeCount} 年份=${parsed.year} tag=${parsed.tags.length} 个`)
  return {
    itemTags: [...itemTags, `AniDBAPI: ${detail.fromCache ? '缓存' : '成功'}`, ...metadataTags(parsed)],
    unitTags: unitBracketTags, unitPatches: [], itemPatch, logs,
    details: { aid: hit.aid, score: hit.score, workKey, api: detail.fromCache ? 'cache' : 'fetched', parsed },
  }
}

function empty(logs, details, unitTags = []) {
  return { itemTags: [], unitTags, unitPatches: [], logs, details }
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
    // 匹配上之后，把条目标题改成 dump 里的日文官方标题。默认关：改标题是看得见的
    // 破坏性动作，不该因为装了新版脚本就自动发生。章节标题不受影响。
    titleFromJa: raw.titleFromJa === true,
    // 从原始文件名的各类括号里提 tag（[] 【】 （） () 〔〕 {}）。默认关，同上。
    // 注意用的是原始标题，不是 titleRewrite 之后的——那一步正是把括号删掉的。
    bracketTags: raw.bracketTags === true,
    // 提出来的 tag 前缀。
    bracketTagPrefix: String(raw.bracketTagPrefix ?? '标签'),
    // 强制重新走 dump 匹配。默认关：tag 里已有 AniDB: <aid> 就直接复用那个 aid，
    // 不重新打分。匹配一次定下来比每次重算稳——重算可能换成另一个作品，把已合并的组打散。
    forceRematch: raw.forceRematch === true,
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
    // 服务端会把 manifest 默认值合进来（mergePlainObject），老配置缺这项也拿得到；
    // 这里再兜一层，免得绕过合并的调用路径算出 NaN 的 until
    banCooldownMs: raw.banCooldownMs === null || raw.banCooldownMs === undefined || raw.banCooldownMs === ''
      ? 1800000
      : num('banCooldownMs'),
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

// 从原始文件名的各类括号里提 tag。中英文括号都认，嵌套不处理（真实片源里没见过，
// 为它加复杂度不值）。不做去重以外的任何过滤——纯数字的 [140404] 也要，
// 先保证完整性，看着不对再加规则。
const BRACKET_RE = /\[([^\]]*)\]|【([^】]*)】|（([^）]*)）|\(([^)]*)\)|〔([^〕]*)〕|\{([^}]*)\}/g
function bracketTagsOf(title, prefix) {
  const out = []
  const seen = new Set()
  for (const m of String(title).matchAll(BRACKET_RE)) {
    const text = (m.slice(1).find((g) => g !== undefined) || '').trim()
    // 空括号跳过；tag 里带冒号会和「前缀: 值」的格式打架，一并跳过
    if (!text || text.includes(':') || text.includes('：')) continue
    const tag = `${prefix}: ${text}`
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
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

// —— 熔断 ——
// 和 anidb-udp-v1 各记各的：UDP client 与 HTTP client 在 AniDB 是分开注册的，
// HTTP 被封不代表 UDP 也被封。（AniDB 同时也按 IP 封，两者是否连带没有实测证据，
// 所以不替用户合并。）
// 维度是脚本全局，不是 per-aid。内存当快路径，真相落 ctx.cacheDir：
// 服务端按脚本 id 给的目录，不受用户 apiCacheDir 配置影响；文件名带目标主机。
let breaker = null

function breakerFile(ctx, options) {
  const dir = String(ctx?.cacheDir || '')
  if (!dir) return ''
  let host = options.apiBaseUrl
  try { host = new URL(options.apiBaseUrl).host } catch { /* 配了非法 URL 就用原串 */ }
  return path.join(dir, `ban-${String(host).replace(/[^\w.-]/g, '_')}.json`)
}

function breakerKey(options) {
  return `${options.apiBaseUrl}|${options.apiClient}|${options.apiClientVer}`
}

// 以文件为准，内存只在没有落盘位置时兜底——见 anidb-udp-v1 里的同名函数
async function readBreaker(ctx, options) {
  const key = breakerKey(options)
  const valid = (rec) => rec && rec.key === key && rec.until > Date.now()
  const file = breakerFile(ctx, options)
  if (!file) return valid(breaker) ? breaker : null
  try {
    const rec = JSON.parse(await readFile(file, 'utf8'))
    breaker = rec
    return valid(rec) ? rec : null
  } catch {
    breaker = null
    return null
  }
}

async function tripBreaker(ctx, options, reason, logs) {
  const rec = { until: Date.now() + options.banCooldownMs, reason: String(reason).slice(0, 200), key: breakerKey(options) }
  breaker = rec
  logs.push(`触发熔断，冷却 ${Math.round(options.banCooldownMs / 60000)} 分钟：${rec.reason}`)
  const file = breakerFile(ctx, options)
  if (!file) {
    logs.push('没有 ctx.cacheDir，熔断只在内存生效，重启后失效')
    return
  }
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(rec), 'utf8')
  } catch (error) {
    logs.push(`熔断状态落盘失败（仅内存生效）：${error.message}`)
  }
}

// AniDB 用 HTTP 200 返回业务错误，ban 只能从 body 文本认。没有实测过真实的
// 封禁响应长什么样，所以同时认 <error> 里的关键词和 403/503 状态码，
// 并把原文写进日志——真撞上了可以照着把判定收紧。
function looksBanned(status, body) {
  if (status === 403 || status === 503) return true
  return /ban|too many|rate.?limit|flood/i.test(String(body || ''))
}
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
    let ja = ''
    for (const t of m[2].matchAll(/<title([^>]*)>([\s\S]*?)<\/title>/g)) {
      const text = decodeXml(t[2])
      titles.push(text)
      // 展示用优先 main，其次 official，避免列候选时蹦出法语/韩语标题
      const type = /type="([^"]+)"/.exec(t[1])?.[1] || ''
      if (type === 'main' || (!main && type === 'official')) main = text
      // 日文标题单独留一份：type="main" 往往是 x-jat 罗马字（实测 aid=10459 的 main
      // 是 Yariman Fudousan，而 ja/official 才是「やりマン不動産」）。
      const lang = /xml:lang="([^"]+)"/.exec(t[1])?.[1] || ''
      if (lang === 'ja' && (type === 'official' || !ja)) ja = text
    }
    if (titles.length) entries.push({ aid: Number(m[1]), titles, main: main || titles[0], ja })
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
    if (!best || s > best.score) { second = best; best = { aid: e.aid, title: e.main, ja: e.ja || '', score: s } }
    else if (!second || s > second.score) second = { aid: e.aid, title: e.main, ja: e.ja || '', score: s }
  }
  if (!best || best.score <= 0) return null
  return { ...best, runnerUp: second }
}

// —— 详情：本地缓存优先，miss 才发请求 ——
async function loadDetail({ ctx, aid, options, logs }) {
  const cacheFile = path.join(options.apiCacheDir, `${aid}.xml`)
  try {
    const xml = await readFile(cacheFile, 'utf8')
    logs.push(`缓存命中 ${cacheFile}，不发请求`)
    return { ok: true, xml, fromCache: true }
  } catch (error) {
    if (error?.code !== 'ENOENT') logs.push(`读缓存失败（当作未命中）：${error.message}`)
  }

  // 熔断检查放在缓存之后：命中缓存不发包，没理由被挡
  const ban = await readBreaker(ctx, options)
  if (ban) {
    const mins = Math.ceil((ban.until - Date.now()) / 60000)
    logs.push(`处于熔断冷却中（还剩 ${mins} 分钟），本次不发请求：${ban.reason}`)
    return { ok: false, banned: true, error: `熔断冷却中，还剩 ${mins} 分钟`, request: null, response: null }
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
      if (looksBanned(res.status, body)) {
        await tripBreaker(ctx, options, `HTTP ${res.status}`, logs)
        return { ok: false, banned: true, error: `HTTP ${res.status}`, request, response }
      }
      return { ok: false, error: `HTTP ${res.status}`, request, response }
    }
    // AniDB 用 200 返回业务错误，必须看 body 而不是状态码
    const err = /<error[^>]*>([\s\S]*?)<\/error>/.exec(body)
    if (err) {
      logs.push(`接口返回错误：${err[0].slice(0, 160)}`)
      // 只有像封禁的才熔断。"aid 不存在"这类是正常业务错误，熔断了会把
      // 后面所有条目一起挡住。
      if (looksBanned(res.status, err[0])) {
        await tripBreaker(ctx, options, err[1].trim(), logs)
        return { ok: false, banned: true, error: err[1].trim(), request, response }
      }
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
  // AniDB 的 restricted 是布尔（成人内容标记），不带分级数字，所以固定写 18。
  // 前缀必须是 restricted:，UI 按这个挑出来渲染成红色小标识（app.js MEDIA_INFO_RESTRICTED）。
  // 只有调了 API 才有这个信息——dump 里只有标题，没有 restricted。
  if (parsed.restricted) out.push('restricted: 18')
  return out
}

// 从 tag 里读已经写过的 aid。"AniDB: 待确认" 不是数字，自然不会命中。
function aidFromTags(tags) {
  for (const tag of tags || []) {
    const m = /^AniDB:\s*(\d+)\s*$/.exec(String(tag))
    if (m) return Number(m[1])
  }
  return 0
}
