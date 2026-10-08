import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const VERSION_TAG_GROUP = 'AI翻译version'

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length
  const units = playableUnits(Array.isArray(ctx.units) ? ctx.units : [])
  const candidates = units
    .map((unit) => ({ unit, source: sourceSubtitle(unit, options), existing: existingTranslation(unit, options) }))
    .filter((entry) => entry.source && (options.force || !entry.existing))
  const existingTranslatedUnits = units.filter((unit) => existingTranslation(unit, options))
  const logs = [
    `AI 翻译候选 ${candidates.length} 个`,
    `模型 ${options.model} · ${options.sourceLanguage}->${options.targetLanguage}`,
  ]
  if (!candidates.length) {
    return {
      itemTags: fullRun && existingTranslatedUnits.length ? translationTags(options, ctx.script?.version) : [],
      unitTags: fullRun
        ? existingTranslatedUnits.map((unit) => ({ unitId: unit.unitId, tags: translationTags(options, ctx.script?.version) }))
        : [],
      unitPatches: [],
      logs: [
        ...logs,
        existingTranslatedUnits.length ? `已有 AI.zh 字幕 ${existingTranslatedUnits.length} 个 unit，刷新 tag` : '没有需要翻译的 AI.jp 字幕',
      ],
    }
  }

  const unitTags = []
  const unitPatches = []
  const processed = []
  const failed = []
  for (const { unit, source } of candidates) {
    let subtitle = null
    try {
      subtitle = await translateSubtitle({ ctx, options, unit, source, logs })
    } catch (error) {
      // 单个 unit 失败不中断整批：记失败 tag 后继续，已成功的 patch 才不会被丢掉
      failed.push(unit.unitId)
      logs.push(`${unit.title || unit.unitId}: AI 翻译失败 ${error.message}`)
      unitTags.push({ unitId: unit.unitId, tags: translationFailedTags(options, ctx.script?.version) })
      continue
    }
    processed.push(unit.unitId)
    unitTags.push({ unitId: unit.unitId, tags: translationTags(options, ctx.script?.version) })
    unitPatches.push({ unitId: unit.unitId, subtitles: [subtitle] })
  }
  if (fullRun) {
    const processedSet = new Set(processed)
    const failedSet = new Set(failed)
    for (const unit of existingTranslatedUnits) {
      if (processedSet.has(unit.unitId) || failedSet.has(unit.unitId)) continue
      unitTags.push({ unitId: unit.unitId, tags: translationTags(options, ctx.script?.version) })
    }
  }
  // item 三态只看本次实际处理的 unit，不含因已有译文而跳过的
  const itemState = !failed.length ? '' : (processed.length ? '部分失败' : '失败')
  return {
    itemTags: fullRun
      ? (itemState ? translationFailedTags(options, ctx.script?.version, itemState) : translationTags(options, ctx.script?.version))
      : [],
    unitTags,
    unitPatches,
    logs: [
      ...logs,
      `AI 翻译完成 ${processed.length}/${candidates.length} 个 unit${failed.length ? `，失败 ${failed.length} 个` : ''}`,
    ],
    details: { processedUnitIds: processed, failedUnitIds: failed },
  }
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

function translationTags(options, version) {
  return [
    '字幕v1: 有',
    `AI字幕: ${options.targetTitle}`,
    `${VERSION_TAG_GROUP}: ${version || 'unknown'}`,
  ]
}

// state: '失败' 表示本次处理的 unit 全部失败，'部分失败' 表示有成功也有失败。
// 字幕v1 归 builtin-subtitles 管：全失败时不碰它，部分成功时如实标「有」。
function translationFailedTags(options, version, state = '失败') {
  return [
    ...(state === '部分失败' ? ['字幕v1: 有'] : []),
    `AI字幕: ${options.targetTitle}${state}`,
    `${VERSION_TAG_GROUP}: ${version || 'unknown'}`,
  ]
}

async function translateSubtitle({ ctx, options, unit, source, logs }) {
  const sourcePath = subtitlePath(unit, source)
  const sourceText = await readFile(sourcePath, 'utf8')
  logs.push(`${unit.title || unit.unitId}: 开始请求 LLM 翻译 ${source.relativePath}`)
  const translated = await callLlmTranslate(options, sourceText)
  const fileName = `tr-${dateStamp()}-${randomToken()}.${options.targetLanguage}.${options.outputFormat}`
  const filesRoot = filesRootForUnit(unit)
  const relativePath = `${options.outputDir}/${fileName}`
  const targetPath = path.join(filesRoot, relativePath)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, normalizeSubtitleText(translated), 'utf8')
  logs.push(`${unit.title || unit.unitId}: 结束请求 LLM，AI 翻译完成 ${relativePath}`)
  return {
    title: `${options.targetTitle}.${dateStamp()}`,
    relativePath,
    language: options.targetLanguage,
    contentType: 'text/vtt',
  }
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

function normalizeSubtitleText(value) {
  const text = String(value || '').trim()
  return text ? `${text}\n` : ''
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
