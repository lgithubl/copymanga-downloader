import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const VERSION_TAG_GROUP = 'AI翻译version'

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length
  const units = playableUnits(Array.isArray(ctx.units) ? ctx.units : [])
  // 上游字幕阶段失败的 unit：翻译帮不上忙，不能让合集 tag 声称翻译完成
  const blocked = units.filter((unit) => upstreamFailed(unit, options))
  const pending = units
    .map((unit) => ({ unit, source: sourceSubtitle(unit, options), existing: existingTranslation(unit, options) }))
    .filter((entry) => entry.source && (options.force || !entry.existing))
  // 多个 unit 共用同一份源字幕时只翻一次，结果挂给整组
  const jobs = groupBySource(pending)
  const existingTranslatedUnits = units.filter((unit) => existingTranslation(unit, options))
  const logs = [
    `AI 翻译候选 ${pending.length} 个 unit / ${jobs.length} 份源字幕`,
    `模型 ${options.model} · ${options.sourceLanguage}->${options.targetLanguage}`,
  ]
  if (blocked.length) {
    logs.push(`${blocked.length} 个 unit 处于 ${options.sourceTitlePrefix} 失败态，本次不改合集 tag`)
  }
  if (!jobs.length) {
    return {
      itemTags: fullRun && !blocked.length && existingTranslatedUnits.length
        ? translationTags(options, ctx.script?.version)
        : [],
      unitTags: fullRun
        ? existingTranslatedUnits.map((unit) => ({ unitId: unit.unitId, tags: translationTags(options, ctx.script?.version) }))
        : [],
      unitPatches: [],
      logs: [
        ...logs,
        existingTranslatedUnits.length
          ? `已有 ${options.targetTitle} 字幕 ${existingTranslatedUnits.length} 个 unit，刷新 tag`
          : `没有需要翻译的 ${options.sourceTitlePrefix} 字幕`,
      ],
    }
  }

  const unitTags = []
  const unitPatches = []
  const processed = []
  const failed = []
  for (const group of jobs) {
    const primary = group[0]
    let subtitle = null
    try {
      subtitle = await translateSubtitle({ ctx, options, unit: primary.unit, source: primary.source, logs })
    } catch (error) {
      // 单个源失败不中断整批：记失败 tag 后继续，已成功的 patch 才不会被丢掉
      failed.push(...group.map((entry) => entry.unit.unitId))
      logs.push(`${primary.unit.title || primary.unit.unitId}: AI 翻译失败 ${error.message}`)
      for (const entry of group) {
        unitTags.push({ unitId: entry.unit.unitId, tags: translationFailedTags(options, ctx.script?.version) })
      }
      continue
    }
    for (const entry of group) {
      processed.push(entry.unit.unitId)
      unitTags.push({ unitId: entry.unit.unitId, tags: translationTags(options, ctx.script?.version) })
      unitPatches.push({ unitId: entry.unit.unitId, subtitles: [subtitle] })
    }
  }
  if (fullRun) {
    const touched = new Set([...processed, ...failed])
    for (const unit of existingTranslatedUnits) {
      if (touched.has(unit.unitId)) continue
      unitTags.push({ unitId: unit.unitId, tags: translationTags(options, ctx.script?.version) })
    }
  }
  // 三态只看本次实际处理的 unit；有 unit 卡在上游失败态时完全不动合集 tag，
  // 留着字幕脚本写的失败态，等源字幕补齐后再切。
  const itemState = !failed.length ? '' : (processed.length ? '部分失败' : '失败')
  return {
    itemTags: (!fullRun || blocked.length)
      ? []
      : (itemState
        ? translationFailedTags(options, ctx.script?.version, itemState)
        : translationTags(options, ctx.script?.version)),
    unitTags,
    unitPatches,
    logs: [
      ...logs,
      `AI 翻译完成 ${processed.length}/${pending.length} 个 unit${failed.length ? `，失败 ${failed.length} 个` : ''}`,
    ],
    details: {
      processedUnitIds: processed,
      failedUnitIds: failed,
      blockedUnitIds: blocked.map((unit) => unit.unitId),
    },
  }
}

// 同一份源字幕被多个 unit 共用时合成一组，只发一次翻译请求
function groupBySource(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = normalizePath(entry.source?.relativePath || '').toLowerCase()
    const list = groups.get(key) || []
    list.push(entry)
    groups.set(key, list)
  }
  return [...groups.values()]
}

// 只认源标题的失败 tag。不能用泛化的「以失败结尾」，否则本脚本上一轮的
// AI.zh失败 也会算进来，导致重试成功后依然写不了合集 tag。
function upstreamFailed(unit, options) {
  const want = `AI字幕:${options.sourceTitlePrefix}失败`
  return (unit.tags || []).some((tag) => String(tag).replace(/\s+/g, '') === want)
}

function normalizeOptions(raw = {}) {
  const protocol = ['json', 'lines', 'plain'].includes(String(raw.protocol)) ? String(raw.protocol) : 'json'
  // plain 是一问一答，批量没有意义
  const batchSize = protocol === 'plain' ? 1 : Math.max(1, Math.trunc(finiteNumber(raw.batchSize, 15)))
  return {
    protocol,
    batchSize,
    promptRole: String(raw.promptRole) === 'system' ? 'system' : 'user',
    retryCount: Math.max(0, Math.trunc(finiteNumber(raw.retryCount, 2))),
    retrySleepMs: Math.max(0, Math.trunc(finiteNumber(raw.retrySleepMs, 3000))),
    apiBase: String(raw.apiBase || 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    model: String(raw.model || 'sakura'),
    sourceTitlePrefix: String(raw.sourceTitlePrefix || 'AI.jp'),
    targetTitle: String(raw.targetTitle || 'AI.zh'),
    sourceLanguage: String(raw.sourceLanguage || 'ja'),
    targetLanguage: String(raw.targetLanguage || 'zh'),
    outputFormat: safeOutputFormat(raw.outputFormat || 'srt'),
    outputDir: safePathSegment(raw.outputDir || 'ai-subtitles'),
    force: raw.force === true,
    contextSize: Math.max(0, Math.trunc(finiteNumber(raw.contextSize, 2))),
    maxLenRatio: Math.max(1, finiteNumber(raw.maxLenRatio, 3)),
    minLenCheckChars: Math.max(0, Math.trunc(finiteNumber(raw.minLenCheckChars, 20))),
    maxRequestFactor: Math.max(1, finiteNumber(raw.maxRequestFactor, 2)),
    retryOnSuspiciousLength: raw.retryOnSuspiciousLength !== false,
    reportMode: ['always', 'onIssue', 'never'].includes(String(raw.reportMode)) ? String(raw.reportMode) : 'onIssue',
    rawSnippetChars: Math.max(0, Math.trunc(finiteNumber(raw.rawSnippetChars, 300))),
    debugIo: raw.debugIo === true,
    debugIoChars: Math.max(0, Math.trunc(finiteNumber(raw.debugIoChars, 4000))),
    requestTimeoutMs: finiteNumber(raw.requestTimeoutMs, 3600000),
    prompt: String(raw.prompt || '将下面的日文字幕翻译成简体中文。保持口语化和角色语气，不要添加原文没有的解释或注释。'),
  }
}

function playableUnits(units) {
  return units.filter((unit) => unit?.mediaKind === 'audio' || unit?.mediaKind === 'video')
}

function sourceSubtitle(unit, options) {
  return (unit.subtitles || []).find((subtitle) => {
    const title = String(subtitle?.title || '')
    const rel = normalizePath(subtitle?.relativePath || '')
    return title === options.sourceTitlePrefix ||
      title.startsWith(`${options.sourceTitlePrefix}.`) ||
      (rel.startsWith('ai-subtitles/') && /\.ja\.(srt|vtt)$/i.test(rel))
  })
}

function existingTranslation(unit, options) {
  return (unit.subtitles || []).find((subtitle) => {
    const title = String(subtitle?.title || '')
    const rel = normalizePath(subtitle?.relativePath || '')
    return title === options.targetTitle ||
      title.startsWith(`${options.targetTitle}.`) ||
      (rel.startsWith('ai-subtitles/') && /\.zh\.(srt|vtt)$/i.test(rel))
  })
}

// 只负责 AI字幕 组；字幕v1 归 builtin-subtitles 管，这里不碰。
function translationTags(options, version) {
  return [
    `AI字幕: ${options.targetTitle}`,
    `${VERSION_TAG_GROUP}: ${version || 'unknown'}`,
  ]
}

// state: '失败' 表示本次处理的 unit 全部失败，'部分失败' 表示有成功也有失败。
function translationFailedTags(options, version, state = '失败') {
  return [
    `AI字幕: ${options.targetTitle}${state}`,
    `${VERSION_TAG_GROUP}: ${version || 'unknown'}`,
  ]
}

async function translateSubtitle({ ctx, options, unit, source, logs }) {
  const label = unit.title || unit.unitId
  const sourcePath = subtitlePath(unit, source)
  const sourceText = await readFile(sourcePath, 'utf8')
  const cues = parseCues(sourceText)
  const fileName = `tr-${timeStamp()}-${randomToken()}.${options.targetLanguage}.${options.outputFormat}`
  const relativePath = `${options.outputDir}/${fileName}`
  const filesRoot = filesRootForUnit(unit)
  // 事件在整条流水线里累积，成功和失败都要落报告——失败时磁盘上本来什么都不留，
  // 恰恰最需要追溯。
  const events = []
  const io = []
  const budget = { used: 0, max: Math.max(4, Math.ceil(Math.max(cues.length, 1) * options.maxRequestFactor)) }
  const report = { options, unit, source, cues, fileName, relativePath, filesRoot, events, io, budget, label, logs }

  if (!cues.length) {
    const message = '源字幕没有解析出任何 cue'
    events.push({ type: '解析失败', from: 0, to: 0, detail: message })
    await writeReport({ ...report, status: `失败：${message}`, ok: false })
    throw new Error(`${label}: ${message}`)
  }
  logs.push(`${label}: 开始翻译 ${source.relativePath}，共 ${cues.length} 条`)

  const texts = cues.map((cue) => cue.text)
  let translated = null
  try {
    translated = await translateAll({ options, texts, logs, label, budget, events, io })
    if (translated.length !== cues.length) {
      throw new Error(`译文条数 ${translated.length} 与源 ${cues.length} 不符`)
    }
  } catch (error) {
    // 报告里已有「章节」行，去掉错误信息里重复的 label 前缀
    const bare = error.message.startsWith(`${label}: `) ? error.message.slice(label.length + 2) : error.message
    await writeReport({ ...report, status: `失败：${bare}`, ok: false })
    throw error instanceof Error && error.message.startsWith(label) ? error : new Error(`${label}: ${error.message}`)
  }

  const targetPath = path.join(filesRoot, relativePath)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, buildSrt(cues, translated), 'utf8')
  await writeReport({ ...report, status: '成功', ok: true })
  logs.push(`${label}: 翻译完成 ${relativePath}，LLM 调用 ${budget.used} 次`)
  return {
    title: `${options.targetTitle}.${dateStamp()}`,
    relativePath,
    language: options.targetLanguage,
    contentType: 'text/vtt',
  }
}

async function translateAll({ options, texts, logs, label, budget, events, io }) {
  const out = []
  for (let i = 0; i < texts.length; i += options.batchSize) {
    const slice = texts.slice(i, i + options.batchSize)
    const context = options.contextSize > 0 ? texts.slice(Math.max(0, i - options.contextSize), i) : []
    out.push(...await translateBatch({ options, texts: slice, context, logs, label, budget, events, io, offset: i }))
  }
  return out
}

// 返回数量对不上就二分重试，分到单条仍失败则抛错（整个 unit 判失败）。
// offset 是本批在整条字幕里的起始下标，用来在报告里给出绝对 cue 编号。
async function translateBatch({ options, texts, context, logs, label, budget, events, io, offset }) {
  if (!texts.length) return []
  const from = offset + 1
  const to = offset + texts.length
  let result = null
  let reason = ''
  let raw = null
  try {
    const got = await requestJsonArray({ options, texts, context, budget, io })
    raw = got.raw
    if (got.texts.length !== texts.length) {
      reason = `返回 ${got.texts.length} 项、期望 ${texts.length} 项`
    } else {
      result = got.texts
      for (const i of got.cleanedIndexes) {
        events.push({ type: '格式清洗', from: offset + i + 1, to: offset + i + 1, detail: '译文含时间轴/序号/WEBVTT，已剥离' })
      }
    }
  } catch (error) {
    reason = error.message
    raw = error.raw
  }
  if (result) return refineLongCues({ options, texts, result, context, logs, label, budget, events, io, offset })
  // 原样附上模型返回的内容，否则「不是 JSON 数组」这类报错无从排查
  const snippet = options.rawSnippetChars > 0 ? ` | 原始响应: ${rawSnippet(raw, options.rawSnippetChars)}` : ''
  if (texts.length === 1) {
    events.push({ type: '单条失败', from, to, detail: `${reason}${snippet}` })
    events.push({ type: '失败原文', from, to, detail: rawSnippet(texts[0], options.rawSnippetChars || 200) })
    throw new Error(`${label}: cue ${from} 单条翻译失败（${reason}）`)
  }
  const mid = texts.length >> 1
  const head = texts.slice(0, mid)
  events.push({ type: '批次重试', from, to, detail: `${reason} → 二分为 ${from}-${offset + mid} / ${offset + mid + 1}-${to}${snippet}` })
  logs.push(`${label}: cue ${from}-${to} 批次失败（${reason}），二分重试`)
  return [
    ...await translateBatch({ options, texts: head, context, logs, label, budget, events, io, offset }),
    ...await translateBatch({
      options,
      texts: texts.slice(mid),
      context: options.contextSize > 0 ? head.slice(-options.contextSize) : [],
      logs,
      label,
      budget,
      events,
      io,
      offset: offset + mid,
    }),
  ]
}

// 译文显著偏长往往是模型在解释或幻觉，重试一次；仍偏长就保留较短的那个。
// 这是启发式，不判失败——否则一句拟声词就能把整章标红。
async function refineLongCues({ options, texts, result, context, logs, label, budget, events, io, offset }) {
  if (!options.retryOnSuspiciousLength) return result
  const out = [...result]
  for (let i = 0; i < out.length; i += 1) {
    if (!isSuspiciousLength(texts[i], out[i], options)) continue
    const no = offset + i + 1
    const srcLen = texts[i].trim().length
    const firstLen = out[i].trim().length
    logs.push(`${label}: cue ${no} 译文偏长（${srcLen} -> ${firstLen}），重试`)
    let detail = `${srcLen} 字 → ${firstLen} 字 (${(firstLen / srcLen).toFixed(1)}x)`
    try {
      const retry = await requestJsonArray({ options, texts: [texts[i]], context, budget, io })
      if (retry.texts.length === 1 && retry.texts[0] && retry.texts[0].length < out[i].length) {
        out[i] = retry.texts[0]
        detail += `，重试后 ${out[i].trim().length} 字，已采纳`
      } else {
        detail += '，重试未更短，保留首次结果'
      }
    } catch (error) {
      detail += `，重试失败（${error.message}），保留首次结果`
      logs.push(`${label}: cue ${no} 重试失败（${error.message}）`)
    }
    events.push({ type: '长度告警', from: no, to: no, detail })
  }
  return out
}

function isSuspiciousLength(sourceText, targetText, options) {
  const src = String(sourceText || '').trim().length
  const dst = String(targetText || '').trim().length
  if (!src || !dst) return false
  if (dst < options.minLenCheckChars) return false   // 短句豁免：「はい」→「好的」比例高但正常
  return dst > src * options.maxLenRatio
}

async function requestJsonArray({ options, texts, context, budget, io }) {
  if (budget.used >= budget.max) throw new Error(`LLM 调用次数超出上限 ${budget.max}`)
  budget.used += 1
  const seq = budget.used
  const prompt = buildBatchPrompt(options, texts, context)
  let raw = null
  try {
    raw = await callWithRetry(options, prompt)
  } finally {
    // debugIo 下无论成败都留一份请求/响应，排查模型行为时不用再猜
    if (options.debugIo && io) io.push({ seq, count: texts.length, prompt, raw })
  }
  const parsed = parseByProtocol(options, raw, texts.length)
  if (!parsed) throw rawError(protocolParseError(options), raw)
  if (!parsed.every((item) => typeof item === 'string')) throw rawError('响应含非字符串元素', raw)
  const cleanedIndexes = []
  const cleaned = parsed.map((item, index) => {
    const value = cleanCueText(item)
    if (value !== String(item || '').trim()) cleanedIndexes.push(index)
    return value
  })
  return { texts: cleaned, cleanedIndexes, raw }
}

// 传输层重试：网络抖动和超时值得等一会再试；格式问题交给二分，不在这里重试。
async function callWithRetry(options, content) {
  let lastError = null
  for (let attempt = 0; attempt <= options.retryCount; attempt += 1) {
    try {
      return await callLlmTranslate(options, content)
    } catch (error) {
      lastError = error
      if (attempt >= options.retryCount) break
      await sleep(options.retrySleepMs)
    }
  }
  throw lastError
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function parseByProtocol(options, raw, expected) {
  if (options.protocol === 'plain') {
    // 专用翻译模型（如 sakura）不遵循结构化输出指令，收到什么就当译文
    const text = cleanCueText(raw)
    return expected === 1 && text ? [text] : null
  }
  if (options.protocol === 'lines') {
    const lines = String(raw || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:\[\d+\]|\d+[.、)])\s*/, '').trim())
      .filter(Boolean)
    return lines.length ? lines : null
  }
  return extractJsonArray(raw)
}

function protocolParseError(options) {
  if (options.protocol === 'plain') return '响应为空'
  if (options.protocol === 'lines') return '响应没有可用行'
  return '返回内容不是 JSON 数组'
}

// 把原始响应挂在异常上，报告里才能说明「模型到底回了什么」
function rawError(message, raw) {
  const error = new Error(message)
  error.raw = raw
  return error
}

function rawSnippet(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return '(空响应)'
  return text.length > limit ? `${text.slice(0, limit)}…[共 ${text.length} 字符]` : text
}

function buildBatchPrompt(options, texts, context) {
  const systemRole = options.promptRole === 'system'
  // plain + system 时 user 消息里只剩原文，一个指令字都没有——
  // 这是专用翻译模型唯一可靠的喂法。
  if (options.protocol === 'plain') {
    return systemRole ? texts[0] : `${options.prompt}\n\n${texts[0]}`
  }
  const parts = systemRole ? [] : [options.prompt, '']
  parts.push('严格要求：')
  if (options.protocol === 'lines') {
    parts.push(
      `- 每条译文单独占一行，正好输出 ${texts.length} 行`,
      '- 行的顺序与输入一一对应',
      '- 不要加行号、不要空行、不要解释或前言',
      '- 原文内部的换行请用空格代替，保证一条译文只占一行',
    )
  } else {
    parts.push(
      `- 只返回一个 JSON 数组，长度必须正好是 ${texts.length}`,
      '- 元素为字符串，顺序与输入一一对应',
      '- 不要输出解释、前言或 markdown 代码块',
    )
  }
  parts.push('- 不要输出序号、时间轴等字幕格式，只要译文文本')
  if (context.length) {
    parts.push('', '上文参考（仅供理解语境，不要翻译、不要出现在返回中）：', renderPayload(options, context))
  }
  parts.push('', `待翻译（共 ${texts.length} 条）：`, renderPayload(options, texts))
  return parts.join('\n')
}

function renderPayload(options, texts) {
  if (options.protocol === 'lines') return texts.map((text) => String(text).replace(/\s*\n\s*/g, ' ')).join('\n')
  return JSON.stringify(texts, null, 0)
}

// 容忍前言和 markdown 围栏：截取首个 [ 到末个 ] 再解析
function extractJsonArray(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

// 模型偶尔会把时间轴/WEBVTT 头/序号混进译文，这里清掉
function cleanCueText(value) {
  return String(value || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*WEBVTT\b/i.test(line))
    .filter((line) => !/-->/.test(line))
    .filter((line) => !/^\s*\d+\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 同时吃 SRT 和 VTT：按空行切块，块内找含 --> 的那行，其后即文本。
// 时间轴行原样保留，重建时逐字写回，LLM 碰不到它。
function parseCues(text) {
  const normalized = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const cues = []
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (!lines.length) continue
    const timeIndex = lines.findIndex((line) => line.includes('-->'))
    if (timeIndex < 0) continue
    const body = lines.slice(timeIndex + 1).join('\n').trim()
    if (!body) continue
    cues.push({ timeLine: lines[timeIndex].trim(), text: body })
  }
  return cues
}

function buildSrt(cues, translated) {
  const blocks = cues.map((cue, index) => {
    const body = String(translated[index] || '').trim() || cue.text
    return `${index + 1}\n${toSrtTimeLine(cue.timeLine)}\n${body}`
  })
  return blocks.length ? `${blocks.join('\n\n')}\n` : ''
}

// 源可能是 VTT（毫秒用 .），输出统一成 SRT 的逗号形式
function toSrtTimeLine(line) {
  return String(line || '').replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')
}

async function callLlmTranslate(options, sourceText) {
  // promptRole=system：指令走 system 消息，user 只放待译文本。
  // 专用翻译模型（sakura 等）会把 user 消息里的一切都当成待翻译内容，
  // 指令混在里面会被一并「翻译」掉。
  const messages = options.promptRole === 'system'
    ? [{ role: 'system', content: options.prompt }, { role: 'user', content: sourceText }]
    : [{ role: 'user', content: `${options.prompt}\n\n${sourceText}` }]
  const payload = {
    model: options.model,
    stream: false,
    messages,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), options.requestTimeoutMs)
  const startedAt = Date.now()
  try {
    let res = null
    try {
      res = await fetch(`${options.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (error) {
      throw new Error(describeFetchError(error, Date.now() - startedAt))
    }
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { raw: text }
    }
    if (!res.ok) throw new Error(body?.error?.message || body?.error || text || `${res.status} ${res.statusText}`)
    return body?.choices?.[0]?.message?.content || body?.choices?.[0]?.text || body?.content || body?.raw || ''
  } finally {
    clearTimeout(timer)
  }
}

// reportMode: always 总是写 / onIssue 仅有事件或失败时写 / never 不写。
// 落在 <outputDir>/log/ 下，与输出共用同一个文件名 token，方便配对。
// 扩展名 .log 不在 DEFAULT_SUBTITLE_EXTENSIONS 里，不会被字幕扫描误认。
async function writeReport({ options, unit, source, cues, fileName, relativePath, filesRoot, events, io, budget, label, logs, status, ok }) {
  if (options.reportMode === 'never') return
  // debugIo 开着就一定落盘，否则一次顺利的调试跑什么都看不到
  if (options.reportMode !== 'always' && !options.debugIo && ok && !events.length) return
  if (!filesRoot) return
  const reportRelative = `${options.outputDir}/log/${fileName.replace(/\.[^.]+$/, '')}.log`
  try {
    const targetPath = path.join(filesRoot, reportRelative)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, renderReport({ options, unit, source, cues, relativePath, events, io, budget, status, ok }), 'utf8')
    logs.push(`${label}: 执行报告 ${reportRelative}`)
  } catch (error) {
    logs.push(`${label}: 执行报告写入失败（${error.message}）`)
  }
}

function renderReport({ options, unit, source, cues, relativePath, events, io, budget, status, ok }) {
  const lines = [
    '# AI 字幕翻译报告',
    `章节  ${unit.title || unit.unitId} (${unit.unitId})`,
    `源    ${source.relativePath}  (${cues.length} 条)`,
    `输出  ${ok ? relativePath : '未产出'}`,
    `结果  ${status}`,
    `调用  ${budget.used} 次 / 上限 ${budget.max}`,
    `协议  ${options.protocol}  batchSize=${options.batchSize} contextSize=${options.contextSize} retryCount=${options.retryCount} retrySleepMs=${options.retrySleepMs}`,
    `检查  maxLenRatio=${options.maxLenRatio} minLenCheckChars=${options.minLenCheckChars} maxRequestFactor=${options.maxRequestFactor}`,
    '',
    `## 事件 ${events.length} 条`,
  ]
  if (!events.length) {
    lines.push('（无）')
  } else {
    for (const event of events) {
      const range = event.from === event.to ? `cue ${event.from}` : `cue ${event.from}-${event.to}`
      lines.push(`[${event.type}] ${range.padEnd(14)} ${event.detail}`)
    }
  }
  if (options.debugIo && io?.length) {
    lines.push('', `## 调试：请求/响应 ${io.length} 次`)
    for (const entry of io) {
      lines.push('', `--- #${entry.seq}  ${entry.count} 条 ---`, '[请求]', truncate(entry.prompt, options.debugIoChars), '[响应]', truncate(entry.raw, options.debugIoChars))
    }
  }
  lines.push('', '## 后续操作')
  for (const hint of reportHints({ options, events, ok })) lines.push(`- ${hint}`)
  return `${lines.join('\n')}\n`
}

// 调试段保留原始换行，只截断长度——换行本身就是 lines 协议要排查的东西
function truncate(value, limit) {
  const text = String(value ?? '')
  if (!text) return '(空)'
  if (limit <= 0 || text.length <= limit) return text
  return `${text.slice(0, limit)}\n…[截断，共 ${text.length} 字符]`
}

function reportHints({ options, events, ok }) {
  const hints = []
  if (!ok) {
    hints.push(`本 unit 已标记「AI字幕: ${options.targetTitle}失败」，未产出译文文件`)
    hints.push('修复 LLM 服务后重跑本脚本即可，已成功的 unit 会自动跳过')
    hints.push(`批量排查：重建缓存后搜 tag:"AI字幕: ${options.targetTitle}失败"`)
  }
  const lengthWarnings = events.filter((event) => event.type === '长度告警').length
  if (lengthWarnings) {
    hints.push(`长度告警 ${lengthWarnings} 条；若频繁出现，考虑调大 maxLenRatio（当前 ${options.maxLenRatio}）或关闭 retryOnSuspiciousLength`)
  }
  const retry = events.filter((event) => event.type === '批次重试').length
  if (retry) {
    hints.push(`批次重试 ${retry} 次，说明模型未严格按 JSON 数组返回；可调小 batchSize（当前 ${options.batchSize}）降低单批难度`)
  }
  if (events.some((event) => event.type === '格式清洗')) {
    hints.push('模型把字幕格式混进了译文，已自动剥离；若大量出现可在 prompt 里再强调「只返回译文文本」')
  }
  if (!hints.length) hints.push('无需处理')
  return hints
}

function subtitlePath(unit, subtitle) {
  const filesRoot = filesRootForUnit(unit)
  const relative = normalizePath(subtitle?.relativePath || '')
  if (!filesRoot || !relative) throw new Error(`${unit.title || unit.unitId}: 字幕路径无效`)
  return path.join(filesRoot, relative)
}

function filesRootForUnit(unit) {
  const managed = normalizePath(unit.managedPath)
  const marker = '/files/'
  const index = managed.indexOf(marker)
  if (index < 0) return ''
  return managed.slice(0, index + '/files'.length)
}

function safeOutputFormat(value) {
  const format = String(value || 'srt').replace(/^\./, '').toLowerCase()
  return ['srt', 'vtt'].includes(format) ? format : 'srt'
}

// 文件名用到秒，便于按时间排序、区分同一天的多次生成
function timeStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function dateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function randomToken() {
  return randomBytes(3).toString('hex')
}

// Node 的 fetch 失败只给一句 "fetch failed"，真正原因埋在 error.cause 链里
// （UND_ERR_HEADERS_TIMEOUT / ECONNRESET / ENOTFOUND ...）。耗时也一并带上，
// 用来区分「立刻失败」和「卡到某个超时才失败」。
function describeFetchError(error, elapsedMs) {
  const parts = [String(error?.message || error)]
  let cause = error?.cause
  for (let depth = 0; cause && depth < 3; depth += 1) {
    const detail = [cause.code, cause.message].filter(Boolean).join(' ')
    if (detail) parts.push(`cause: ${detail}`)
    cause = cause.cause
  }
  parts.push(`耗时 ${(elapsedMs / 1000).toFixed(1)}s`)
  return parts.join(' | ')
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function safePathSegment(value) {
  return String(value || '')
    .replace(/[\\/]+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .replace(/[:*?"<>|]/g, '-')
    .slice(0, 180) || 'value'
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
