import { randomUUID } from 'node:crypto'

const VERSION_TAG_GROUP = 'AI字幕version'

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  if (!Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length) options.fastMode = true
  const units = playableUnits(Array.isArray(ctx.units) ? ctx.units : [])
    .filter((unit) => options.overwriteExisting || !(Array.isArray(unit.subtitles) && unit.subtitles.length))
  const logs = [
    `AI 字幕候选 ${units.length} 个`,
    `模式 ${options.fastMode ? '快速' : '普通'} · ${options.language} · ${options.outputFormat} · ${options.segmenter}`,
  ]
  if (!units.length) {
    return {
      itemTags: [],
      unitTags: [],
      unitPatches: [],
      logs,
    }
  }

  const jobs = options.fastMode ? groupFastModeUnits(units) : units.map((unit) => [unit])
  const unitTags = []
  const unitPatches = []
  const processed = []

  for (const group of jobs) {
    const primary = group[0]
    const subtitle = await createSubtitle({ ctx, options, unit: primary, logs })
    processed.push(...group.map((unit) => unit.unitId))
    for (const unit of group) {
      unitTags.push({
        unitId: unit.unitId,
        tags: aiSubtitleTags(ctx.script?.version),
      })
      unitPatches.push({
        unitId: unit.unitId,
        subtitles: [subtitle],
      })
    }
  }

  return {
    itemTags: [],
    unitTags,
    unitPatches,
    logs: [
      ...logs,
      `AI 字幕完成 ${processed.length}/${units.length} 个 unit`,
    ],
    details: {
      processedUnitIds: processed,
      fastMode: options.fastMode,
    },
  }
}

function normalizeOptions(raw = {}) {
  return {
    apiBase: String(raw.apiBase || 'http://192.168.50.56:11594').replace(/\/+$/, ''),
    inputPathFrom: String(raw.inputPathFrom || ''),
    inputPathTo: String(raw.inputPathTo || ''),
    outputPathFrom: String(raw.outputPathFrom || ''),
    outputPathTo: String(raw.outputPathTo || ''),
    language: String(raw.language || 'ja'),
    outputFormat: String(raw.outputFormat || 'srt').replace(/^\./, '').toLowerCase(),
    segmenter: String(raw.segmenter || 'asmr-onnx'),
    vadFilter: raw.vadFilter === null || raw.vadFilter === undefined || raw.vadFilter === '' ? null : Boolean(raw.vadFilter),
    fastMode: raw.fastMode !== false,
    overwriteExisting: raw.overwriteExisting === true,
    outputDirTemplate: String(raw.outputDirTemplate || '{itemId}'),
    subtitleTitle: String(raw.subtitleTitle || 'AI.jp'),
    requestTimeoutMs: finiteNumber(raw.requestTimeoutMs, 3600000),
  }
}

function playableUnits(units) {
  return units.filter((unit) => unit?.mediaKind === 'audio' || unit?.mediaKind === 'video')
}

function aiSubtitleTags(version) {
  return [
    '字幕v1: 有',
    'AI字幕: AI.jp',
    `${VERSION_TAG_GROUP}: ${version || 'unknown'}`,
  ]
}

function groupFastModeUnits(units) {
  const groups = new Map()
  for (const unit of units) {
    const key = `${String(unit.groupPath || '').toLowerCase()}\u001f${stem(unit.relativePath || unit.fileName || unit.title || unit.unitId)}`
    const list = groups.get(key) || []
    list.push(unit)
    groups.set(key, list)
  }
  return [...groups.values()]
}

async function createSubtitle({ ctx, options, unit, logs }) {
  const outputFormat = safeOutputFormat(options.outputFormat)
  const fileName = `${randomUUID()}.${options.language}.${outputFormat}`
  const outputDir = renderTemplate(options.outputDirTemplate, { item: ctx.item, unit, fileName, options }, '{itemId}')
  const request = {
    input_path: mapPath(unit.managedPath, options.inputPathFrom, options.inputPathTo, { item: ctx.item, unit, fileName, options }),
    language: options.language,
    output_format: outputFormat,
    uniq_key_name: fileName,
    segmenter: options.segmenter,
    output_dir: outputDir,
  }
  if (options.vadFilter !== null) request.vad_filter = options.vadFilter
  logs.push(`${unit.title || unit.unitId}: 开始请求 ASR ${request.input_path} -> ${outputDir}/${fileName}`)
  const response = await postJson(`${options.apiBase}/v1/subtitles`, request, options.requestTimeoutMs)
  logs.push(`${unit.title || unit.unitId}: ASR 返回 ok=${response.ok !== false} accepted=${Boolean(response.accepted)} async=${Boolean(response.async)} segments=${response.segments ?? ''}`)
  const outputPath = mapPath(String(response.output_path || ''), options.outputPathFrom, options.outputPathTo, { item: ctx.item, unit, fileName, options })
  const relativePath = outputPathToRelativePath(outputPath, unit)
  if (!relativePath) throw new Error(`${unit.title || unit.unitId}: 无法把 ASR 输出路径映射到媒体 files 目录: ${response.output_path || ''}`)
  logs.push(`${unit.title || unit.unitId}: 结束请求 ASR，AI 字幕完成 ${relativePath}`)
  return {
    title: options.subtitleTitle,
    relativePath,
    language: options.language,
    contentType: 'text/vtt',
  }
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { raw: text }
    }
    if (!res.ok) throw new Error(payload?.detail || payload?.error || text || `${res.status} ${res.statusText}`)
    return payload || {}
  } finally {
    clearTimeout(timer)
  }
}

function outputPathToRelativePath(outputPath, unit) {
  const normalizedOutput = normalizePath(outputPath)
  const filesRoot = filesRootForUnit(unit)
  if (!normalizedOutput || !filesRoot) return ''
  if (normalizedOutput === filesRoot) return ''
  if (!normalizedOutput.startsWith(`${filesRoot}/`)) return ''
  return normalizedOutput.slice(filesRoot.length + 1)
}

function filesRootForUnit(unit) {
  const managed = normalizePath(unit.managedPath)
  const marker = '/files/'
  const index = managed.indexOf(marker)
  if (index < 0) return ''
  return managed.slice(0, index + '/files'.length)
}

function mapPath(value, from, to, context) {
  const input = normalizePath(value)
  const source = normalizePath(renderTemplate(from, context, ''))
  const target = normalizePath(renderTemplate(to, context, ''))
  if (!input || !source || !target) return input
  if (input === source) return target
  if (input.startsWith(`${source}/`)) return `${target}${input.slice(source.length)}`
  return input
}

function renderTemplate(template, { item, unit, fileName, options }, fallback = '') {
  const filesRoot = filesRootForUnit(unit)
  return String(template || fallback)
    .replaceAll('{itemId}', safePathSegment(item?.itemId || 'media'))
    .replaceAll('{unitId}', safePathSegment(unit?.unitId || 'unit'))
    .replaceAll('{language}', safePathSegment(options.language || 'ja'))
    .replaceAll('{format}', safePathSegment(options.outputFormat || 'srt'))
    .replaceAll('{fileName}', safePathSegment(fileName || 'subtitle.srt'))
    .replaceAll('{filesRoot}', filesRoot)
}

function safeOutputFormat(value) {
  const format = String(value || 'srt').replace(/^\./, '').toLowerCase()
  return ['srt', 'vtt', 'json', 'txt'].includes(format) ? format : 'srt'
}

function stem(value) {
  const name = String(value || '').split(/[\\/]/).pop() || ''
  return name.replace(/\.[^.]+$/, '').toLowerCase()
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
