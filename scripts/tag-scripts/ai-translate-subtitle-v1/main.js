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
  return {
    apiBase: String(raw.apiBase || 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    model: String(raw.model || 'sakura'),
    sourceTitlePrefix: String(raw.sourceTitlePrefix || 'AI.jp'),
    targetTitle: String(raw.targetTitle || 'AI.zh'),
    sourceLanguage: String(raw.sourceLanguage || 'ja'),
    targetLanguage: String(raw.targetLanguage || 'zh'),
    outputFormat: safeOutputFormat(raw.outputFormat || 'srt'),
    outputDir: safePathSegment(raw.outputDir || 'ai-subtitles'),
    force: raw.force === true,
    batchSize: Math.max(1, Math.trunc(finiteNumber(raw.batchSize, 15))),
    contextSize: Math.max(0, Math.trunc(finiteNumber(raw.contextSize, 2))),
    maxLenRatio: Math.max(1, finiteNumber(raw.maxLenRatio, 3)),
    minLenCheckChars: Math.max(0, Math.trunc(finiteNumber(raw.minLenCheckChars, 20))),
    maxRequestFactor: Math.max(1, finiteNumber(raw.maxRequestFactor, 2)),
    retryOnSuspiciousLength: raw.retryOnSuspiciousLength !== false,
    requestTimeoutMs: finiteNumber(raw.requestTimeoutMs, 3600000),
    prompt: String(raw.prompt || '将下面日文字幕翻译成简体中文。保持 SRT 序号和时间轴不变，只翻译字幕文本，不要添加解释。'),
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
  if (!cues.length) throw new Error(`${label}: 源字幕没有解析出任何 cue`)
  logs.push(`${label}: 开始翻译 ${source.relativePath}，共 ${cues.length} 条`)

  // 调用次数上限：LLM 持续返回坏数据时二分会退化成 2N-1 次，必须封顶
  const budget = { used: 0, max: Math.max(4, Math.ceil(cues.length * options.maxRequestFactor)) }
  const texts = cues.map((cue) => cue.text)
  const translated = await translateAll({ options, texts, logs, label, budget })
  if (translated.length !== cues.length) {
    throw new Error(`${label}: 译文条数 ${translated.length} 与源 ${cues.length} 不符`)
  }

  const fileName = `tr-${dateStamp()}-${randomToken()}.${options.targetLanguage}.${options.outputFormat}`
  const filesRoot = filesRootForUnit(unit)
  const relativePath = `${options.outputDir}/${fileName}`
  const targetPath = path.join(filesRoot, relativePath)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, buildSrt(cues, translated), 'utf8')
  logs.push(`${label}: 翻译完成 ${relativePath}，LLM 调用 ${budget.used} 次`)
  return {
    title: `${options.targetTitle}.${dateStamp()}`,
    relativePath,
    language: options.targetLanguage,
    contentType: 'text/vtt',
  }
}

async function translateAll({ options, texts, logs, label, budget }) {
  const out = []
  for (let i = 0; i < texts.length; i += options.batchSize) {
    const slice = texts.slice(i, i + options.batchSize)
    const context = options.contextSize > 0 ? texts.slice(Math.max(0, i - options.contextSize), i) : []
    out.push(...await translateBatch({ options, texts: slice, context, logs, label, budget }))
  }
  return out
}

// 返回数量对不上就二分重试，分到单条仍失败则抛错（整个 unit 判失败）
async function translateBatch({ options, texts, context, logs, label, budget }) {
  if (!texts.length) return []
  let result = null
  let reason = ''
  try {
    result = await requestJsonArray({ options, texts, context, budget })
    if (result.length !== texts.length) {
      reason = `返回 ${result.length} 项、期望 ${texts.length} 项`
      result = null
    }
  } catch (error) {
    reason = error.message
  }
  if (result) return refineLongCues({ options, texts, result, context, logs, label, budget })
  if (texts.length === 1) throw new Error(`${label}: 单条翻译失败（${reason}）`)
  logs.push(`${label}: ${texts.length} 条批次失败（${reason}），二分重试`)
  const mid = texts.length >> 1
  const head = texts.slice(0, mid)
  return [
    ...await translateBatch({ options, texts: head, context, logs, label, budget }),
    ...await translateBatch({
      options,
      texts: texts.slice(mid),
      context: options.contextSize > 0 ? head.slice(-options.contextSize) : [],
      logs,
      label,
      budget,
    }),
  ]
}

// 译文显著偏长往往是模型在解释或幻觉，重试一次；仍偏长就保留较短的那个。
// 这是启发式，不判失败——否则一句拟声词就能把整章标红。
async function refineLongCues({ options, texts, result, context, logs, label, budget }) {
  if (!options.retryOnSuspiciousLength) return result
  const out = [...result]
  for (let i = 0; i < out.length; i += 1) {
    if (!isSuspiciousLength(texts[i], out[i], options)) continue
    logs.push(`${label}: 第 ${i + 1} 条译文偏长（${texts[i].trim().length} -> ${out[i].trim().length}），重试`)
    try {
      const retry = await requestJsonArray({ options, texts: [texts[i]], context, budget })
      if (retry.length === 1 && retry[0] && retry[0].length < out[i].length) out[i] = retry[0]
    } catch (error) {
      logs.push(`${label}: 第 ${i + 1} 条重试失败（${error.message}），保留首次结果`)
    }
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

async function requestJsonArray({ options, texts, context, budget }) {
  if (budget.used >= budget.max) throw new Error(`LLM 调用次数超出上限 ${budget.max}`)
  budget.used += 1
  const raw = await callLlmTranslate(options, buildBatchPrompt(options, texts, context))
  const parsed = extractJsonArray(raw)
  if (!parsed) throw new Error('返回内容不是 JSON 数组')
  if (!parsed.every((item) => typeof item === 'string')) throw new Error('JSON 数组含非字符串元素')
  return parsed.map(cleanCueText)
}

function buildBatchPrompt(options, texts, context) {
  const parts = [options.prompt, '', '严格要求：', `- 只返回一个 JSON 数组，长度必须正好是 ${texts.length}`, '- 元素为字符串，顺序与输入一一对应', '- 不要输出解释、前言或 markdown 代码块', '- 不要输出序号、时间轴等字幕格式，只要译文文本']
  if (context.length) {
    parts.push('', '上文参考（仅供理解语境，不要翻译、不要出现在返回中）：', JSON.stringify(context, null, 0))
  }
  parts.push('', `待翻译（共 ${texts.length} 条）：`, JSON.stringify(texts, null, 0))
  return parts.join('\n')
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
  const payload = {
    model: options.model,
    stream: false,
    messages: [{
      role: 'user',
      content: `${options.prompt}\n\n${sourceText}`,
    }],
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), options.requestTimeoutMs)
  try {
    const res = await fetch(`${options.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
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

function dateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function randomToken() {
  return randomBytes(3).toString('hex')
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
