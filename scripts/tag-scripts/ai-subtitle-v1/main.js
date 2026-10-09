import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const VERSION_TAG_GROUP = 'AI字幕version'

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length
  if (fullRun) options.fastMode = true
  const allPlayableUnits = playableUnits(Array.isArray(ctx.units) ? ctx.units : [])
  const existingAiUnits = allPlayableUnits.filter((unit) => hasAiSubtitle(unit, options))
  const units = allPlayableUnits
    .filter((unit) => options.overwriteExisting || !(Array.isArray(unit.subtitles) && unit.subtitles.length))
  const logs = [
    `AI 字幕候选 ${units.length} 个`,
    `模式 ${options.fastMode ? '快速' : '普通'} · ${options.language} · ${options.outputFormat} · ${options.segmenter}`,
  ]
  if (!units.length) {
    return {
      itemTags: fullRun && existingAiUnits.length ? aiSubtitleTags(options, ctx.script?.version) : [],
      unitTags: fullRun
        ? existingAiUnits.map((unit) => ({
          unitId: unit.unitId,
          tags: aiSubtitleTags(options, ctx.script?.version),
        }))
        : [],
      unitPatches: [],
      logs: [
        ...logs,
        existingAiUnits.length ? `已有 AI 字幕 ${existingAiUnits.length} 个 unit，刷新 tag` : '没有需要生成的 AI 字幕',
      ],
    }
  }

  const jobs = options.fastMode ? groupFastModeUnits(units) : units.map((unit) => [unit])
  const unitTags = []
  const unitPatches = []
  const processed = []
  const failed = []
  const failures = []

  const io = []
  const results = options.asyncMode
    ? await runAsyncJobs({ ctx, options, jobs, logs, io })
    : await runSyncJobs({ ctx, options, jobs, logs, io })

  for (const result of results) {
    const group = result.group
    if (result.error) {
      // 单个 unit 失败不中断整批：记失败 tag 后继续，已成功的 patch 才不会被丢掉
      failed.push(...group.map((unit) => unit.unitId))
      failures.push({ units: group, message: result.error })
      logs.push(`${group[0].title || group[0].unitId}: AI 字幕失败 ${result.error}`)
      for (const unit of group) {
        unitTags.push({ unitId: unit.unitId, tags: aiSubtitleFailedTags(options, ctx.script?.version) })
      }
      continue
    }
    processed.push(...group.map((unit) => unit.unitId))
    for (const unit of group) {
      unitTags.push({ unitId: unit.unitId, tags: aiSubtitleTags(options, ctx.script?.version) })
      unitPatches.push({ unitId: unit.unitId, subtitles: [result.subtitle] })
    }
  }

  const generated = new Set(processed)
  if (fullRun) {
    for (const unit of existingAiUnits) {
      if (generated.has(unit.unitId)) continue
      unitTags.push({
        unitId: unit.unitId,
        tags: aiSubtitleTags(options, ctx.script?.version),
      })
    }
  }

  // item 三态只看本次实际处理的 unit，不含因已有字幕而跳过的
  const itemState = !failed.length ? '' : (processed.length ? '部分失败' : '失败')
  await writeFailureReport({ ctx, options, units, failures, processed, logs, io })

  return {
    itemTags: fullRun
      ? (itemState ? aiSubtitleFailedTags(options, ctx.script?.version, itemState) : aiSubtitleTags(options, ctx.script?.version))
      : [],
    unitTags,
    unitPatches,
    logs: [
      ...logs,
      `AI 字幕完成 ${processed.length}/${units.length} 个 unit${failed.length ? `，失败 ${failed.length} 个` : ''}`,
    ],
    details: {
      processedUnitIds: processed,
      failedUnitIds: failed,
      fastMode: options.fastMode,
    },
  }
}

// 失败时在 <logDir> 下留一份报告。成功的 unit 有字幕文件可查，失败的什么都不留，
// 而 job 记录是每个 (item, 脚本) 一份、重跑即覆盖，所以这里补一份跟着媒体走的痕迹。
async function writeFailureReport({ ctx, options, units, failures, processed, logs, io }) {
  if (options.reportMode === 'never') return
  // debugIo 开着时即使全成功也落盘，否则调试跑什么都看不到
  if (!failures.length && !options.debugIo) return
  const filesRoot = filesRootForUnit(units.find((unit) => filesRootForUnit(unit)) || {})
  if (!filesRoot) return
  const relative = `${options.logDir}/asr-${timeStamp()}-${randomToken()}.log`
  const failedCount = failures.reduce((sum, entry) => sum + entry.units.length, 0)
  const lines = [
    '# AI 字幕生成报告',
    `合集  ${ctx.item?.title || ctx.item?.itemId || ''} (${ctx.item?.itemId || ''})`,
    `结果  ${processed.length ? '部分失败' : '失败'}：成功 ${processed.length} / 失败 ${failedCount}，共 ${units.length} 个候选 unit`,
    `配置  apiBase=${options.apiBase} language=${options.language} segmenter=${options.segmenter} fastMode=${options.fastMode}`,
    '',
    `## 失败明细 ${failures.length} 组`,
  ]
  for (const entry of failures) {
    const names = entry.units.map((unit) => `${unit.title || unit.unitId} (${unit.unitId})`).join('、')
    lines.push(`[失败] ${names}`)
    lines.push(`       ${entry.message}`)
  }
  if (options.debugIo && io?.length) {
    lines.push('', `## 调试：HTTP 请求/响应 ${io.length} 次`)
    for (const entry of io) {
      lines.push('', `--- ${entry.method} ${entry.url}  → ${entry.status}  ${(entry.elapsedMs / 1000).toFixed(1)}s ---`)
      if (entry.request) lines.push('[请求]', truncate(entry.request, options.debugIoChars))
      lines.push('[响应]', truncate(entry.response, options.debugIoChars))
    }
  }
  lines.push('', '## 后续操作')
  if (!failures.length) lines.push('- 本次全部成功，这份报告由 debugIo 生成，调试完请关掉它')
  lines.push(`- 失败的 unit 已标记「AI字幕: ${options.subtitleTitle}失败」，未产出字幕`)
  lines.push('- 修复 ASR 服务后重跑本脚本即可，已有字幕的 unit 会自动跳过')
  lines.push(`- 批量排查：重建缓存后搜 tag:"AI字幕: ${options.subtitleTitle}失败"`)
  if (failures.some((entry) => /fetch failed|timeout|ECONN/i.test(entry.message))) {
    lines.push(`- 错误指向网络或超时，先确认 ${options.apiBase} 可达，再看 requestTimeoutMs（当前 ${options.requestTimeoutMs} ms）是否够`)
  }
  if (failures.some((entry) => /无法把 ASR 输出路径映射/.test(entry.message))) {
    lines.push('- 路径映射失败：核对 outputPathFrom / outputPathTo 与 ASR 服务实际写盘位置是否一致')
  }
  try {
    const targetPath = path.join(filesRoot, relative)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, `${lines.join('\n')}\n`, 'utf8')
    logs.push(`执行报告 ${relative}`)
  } catch (error) {
    logs.push(`执行报告写入失败（${error.message}）`)
  }
}

function truncate(value, limit) {
  const text = String(value ?? '')
  if (!text) return '(空)'
  if (limit <= 0 || text.length <= limit) return text
  return `${text.slice(0, limit)}\n…[截断，共 ${text.length} 字符]`
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
    overwriteExisting: raw.force === true || raw.overwriteExisting === true,
    force: raw.force === true || raw.overwriteExisting === true,
    outputDirTemplate: String(raw.outputDirTemplate || '{itemId}'),
    subtitleTitle: String(raw.subtitleTitle || 'AI.jp'),
    logDir: String(raw.logDir || 'ai-subtitles/log').replace(/^[/\\]+|[/\\]+$/g, ''),
    reportMode: ['onFailure', 'never'].includes(String(raw.reportMode)) ? String(raw.reportMode) : 'onFailure',
    asyncMode: raw.asyncMode === true,
    pollIntervalMs: Math.max(500, Math.trunc(finiteNumber(raw.pollIntervalMs, 5000))),
    pollTimeoutMs: Math.max(1000, Math.trunc(finiteNumber(raw.pollTimeoutMs, 7200000))),
    debugIo: raw.debugIo === true,
    debugIoChars: Math.max(0, Math.trunc(finiteNumber(raw.debugIoChars, 4000))),
    requestTimeoutMs: finiteNumber(raw.requestTimeoutMs, 3600000),
  }
}

function playableUnits(units) {
  return units.filter((unit) => unit?.mediaKind === 'audio' || unit?.mediaKind === 'video')
}

function aiSubtitleTags(options, version) {
  return [
    '字幕v1: 有',
    `AI字幕: ${options.subtitleTitle}`,
    `${VERSION_TAG_GROUP}: ${version || 'unknown'}`,
  ]
}

// state: '失败' 表示本次处理的 unit 全部失败，'部分失败' 表示有成功也有失败。
// 字幕v1 归 builtin-subtitles 管：全失败时不碰它，部分成功时如实标「有」。
function aiSubtitleFailedTags(options, version, state = '失败') {
  return [
    ...(state === '部分失败' ? ['字幕v1: 有'] : []),
    `AI字幕: ${options.subtitleTitle}${state}`,
    `${VERSION_TAG_GROUP}: ${version || 'unknown'}`,
  ]
}

function hasAiSubtitle(unit, options) {
  const titlePrefix = `${options.subtitleTitle}.`
  return (unit.subtitles || []).some((subtitle) => (
    String(subtitle?.title || '') === options.subtitleTitle ||
    String(subtitle?.title || '').startsWith(titlePrefix) ||
    String(subtitle?.relativePath || '').replace(/\\/g, '/').startsWith('ai-subtitles/')
  ))
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

// 拆成「构造请求」「提交」「把响应落成字幕对象」三段，同步和异步两条路都复用。
function buildSubtitleRequest({ ctx, options, unit }) {
  const outputFormat = safeOutputFormat(options.outputFormat)
  const fileName = `asr-${timeStamp()}-${randomToken()}.${options.language}.${outputFormat}`
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
  return { request, fileName, outputDir }
}

function subtitleFromResponse({ ctx, options, unit, response, fileName }) {
  const outputPath = mapPath(String(response.output_path || ''), options.outputPathFrom, options.outputPathTo, { item: ctx.item, unit, fileName, options })
  const relativePath = outputPathToRelativePath(outputPath, unit)
  if (!relativePath) throw new Error(`${unit.title || unit.unitId}: 无法把 ASR 输出路径映射到媒体 files 目录: ${response.output_path || ''}`)
  return {
    title: `${options.subtitleTitle}.${dateStamp()}`,
    relativePath,
    language: options.language,
    contentType: 'text/vtt',
  }
}

async function createSubtitle({ ctx, options, unit, logs, io }) {
  const { request, fileName, outputDir } = buildSubtitleRequest({ ctx, options, unit })
  logs.push(`${unit.title || unit.unitId}: 开始请求 ASR ${request.input_path} -> ${outputDir}/${fileName}`)
  const response = await postJson(`${options.apiBase}/v1/subtitles`, request, options, io)
  logs.push(`${unit.title || unit.unitId}: ASR 返回 ok=${response.ok !== false} accepted=${Boolean(response.accepted)} async=${Boolean(response.async)} segments=${response.segments ?? ''}`)
  const subtitle = subtitleFromResponse({ ctx, options, unit, response, fileName })
  logs.push(`${unit.title || unit.unitId}: 结束请求 ASR，AI 字幕完成 ${subtitle.relativePath}`)
  return subtitle
}

// 同步：一个一个发，每次都占着长连接直到转写结束
async function runSyncJobs({ ctx, options, jobs, logs, io }) {
  const out = []
  for (const group of jobs) {
    try {
      out.push({ group, subtitle: await createSubtitle({ ctx, options, unit: group[0], logs, io }) })
    } catch (error) {
      out.push({ group, error: error.message })
    }
  }
  return out
}

// 异步：先把所有任务提交完，再统一轮询。提交是秒回的，不会撞上底层的
// headersTimeout——长音频被连接层掐断的问题就是这么来的。
async function runAsyncJobs({ ctx, options, jobs, logs, io }) {
  const out = []
  const pending = new Map()
  for (const group of jobs) {
    const unit = group[0]
    try {
      const { request, fileName, outputDir } = buildSubtitleRequest({ ctx, options, unit })
      const response = await postJson(`${options.apiBase}/v1/subtitles`, { ...request, async: true }, options, io)
      const jobId = String(response.job_id || response.trace_id || '')
      if (!jobId) throw new Error(`ASR 未返回 job_id: ${JSON.stringify(response).slice(0, 200)}`)
      pending.set(jobId, { group, unit, fileName, response })
      logs.push(`${unit.title || unit.unitId}: 已提交异步任务 ${jobId} -> ${outputDir}/${fileName}`)
    } catch (error) {
      out.push({ group, error: `提交失败 ${error.message}` })
    }
  }
  if (!pending.size) return out
  logs.push(`已提交 ${pending.size} 个异步任务，开始轮询（间隔 ${options.pollIntervalMs}ms，上限 ${options.pollTimeoutMs}ms）`)

  const deadline = Date.now() + options.pollTimeoutMs
  while (pending.size && Date.now() < deadline) {
    await sleep(options.pollIntervalMs)
    let queued = null
    try {
      queued = await fetchQueuedJobIds({ options, io })
    } catch (error) {
      logs.push(`查询任务队列失败（${error.message}），本轮按 trace 判定`)
    }
    for (const [jobId, entry] of [...pending]) {
      // 还在队列里（pending 或 doing）就继续等，不用查 trace
      if (queued && queued.has(jobId)) continue
      let trace = null
      try {
        trace = await fetchTrace({ options, jobId, io })
      } catch (error) {
        logs.push(`${entry.unit.title || entry.unit.unitId}: 查询 trace 失败（${error.message}）`)
        continue
      }
      // 队列里没有、trace 也查不到 —— 按约定当失败处理
      if (!trace) {
        out.push({ group: entry.group, error: `任务 ${jobId} 不在队列中且查不到 trace` })
        pending.delete(jobId)
        continue
      }
      if (trace.status === 'error') {
        out.push({ group: entry.group, error: trace.error || `ASR 任务 ${jobId} 失败` })
        pending.delete(jobId)
        continue
      }
      if (trace.status === 'done') {
        try {
          const response = { ...entry.response, output_path: trace.output_path || entry.response.output_path }
          out.push({ group: entry.group, subtitle: subtitleFromResponse({ ctx, options, unit: entry.unit, response, fileName: entry.fileName }) })
          logs.push(`${entry.unit.title || entry.unit.unitId}: 异步任务 ${jobId} 完成`)
        } catch (error) {
          out.push({ group: entry.group, error: error.message })
        }
        pending.delete(jobId)
      }
      // 其它状态（doing 等）继续等下一轮
    }
  }
  for (const [jobId, entry] of pending) {
    out.push({ group: entry.group, error: `轮询超时：任务 ${jobId} 在 ${options.pollTimeoutMs}ms 内未结束` })
  }
  return out
}

async function fetchQueuedJobIds({ options, io }) {
  const snapshot = await getJson(`${options.apiBase}/v1/jobs`, options, io)
  const ids = new Set()
  if (snapshot?.doing?.job_id) ids.add(String(snapshot.doing.job_id))
  for (const job of snapshot?.pending || []) {
    if (job?.job_id) ids.add(String(job.job_id))
  }
  return ids
}

async function fetchTrace({ options, jobId, io }) {
  try {
    return await getJson(`${options.apiBase}/v1/traces/${encodeURIComponent(jobId)}`, options, io)
  } catch (error) {
    if (/\b404\b/.test(error.message)) return null
    throw error
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

async function postJson(url, body, options, io) {
  return httpJson({ url, method: 'POST', body, options, io })
}

async function getJson(url, options, io) {
  return httpJson({ url, method: 'GET', options, io })
}

async function httpJson({ url, method, body, options, io }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), options.requestTimeoutMs)
  const startedAt = Date.now()
  let raw = ''
  let status = 0
  try {
    let res = null
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      throw new Error(describeFetchError(error, Date.now() - startedAt))
    }
    status = res.status
    raw = await res.text()
    let payload = null
    try {
      payload = raw ? JSON.parse(raw) : null
    } catch {
      payload = { raw }
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${payload?.detail || payload?.error || raw}`)
    return payload || {}
  } finally {
    clearTimeout(timer)
    if (options.debugIo && io) {
      io.push({
        method,
        url,
        status,
        elapsedMs: Date.now() - startedAt,
        request: body === undefined ? '' : JSON.stringify(body),
        response: raw,
      })
    }
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

function stem(value) {
  const name = String(value || '').split(/[\\/]/).pop() || ''
  return name.replace(/\.[^.]+$/, '').toLowerCase()
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
