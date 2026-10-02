import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PRODUCT_RE = /(?:^|[^A-Z0-9])((?:RJ|VJ|BJ|EJ)\d{6,8})(?=$|[^A-Z0-9])/gi
let lastRequestAt = 0

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options)
  const units = Array.isArray(ctx.units) ? ctx.units : []
  const itemProductIds = productIdsFromTexts([ctx.item?.productId, ctx.item?.title, ctx.item?.itemId, ctx.item?.path, ctx.item?.sourcePath])
  const unitIds = new Map(units.map((unit) => [unit.unitId, productIdsFromTexts(unitTexts(unit))]))
  const allProductIds = unique([...itemProductIds, ...[...unitIds.values()].flat()])

  const itemCandidates = [
    tag('product_status', `编号: ${allProductIds.length ? '有' : '无'}`),
    tag('product_multi', `多编号: ${allProductIds.length > 1 ? '是' : '否'}`),
    ...allProductIds.map((id) => tag('product_id', `DLID: ${id}`)),
    ...unique(allProductIds.map(productPrefix)).map((prefix) => tag('product_prefix', `DL类: ${prefix}`)),
  ]

  const detailsById = new Map()
  const logs = [`识别编号 ${allProductIds.length ? allProductIds.join(', ') : '无'}`]
  for (const productId of allProductIds) {
    const detail = await loadProductDetail(productId, options, ctx.cacheDir)
    detailsById.set(productId, detail)
    logs.push(...(detail.logs || []))
    logs.push(`${productId}: DL状态 ${detail.status}${detail.title ? ` · ${detail.title}` : ''}${detail.error ? ` · ${detail.error}` : ''}`)
    itemCandidates.push(...detailToTags(productId, detail))
  }
  itemCandidates.unshift(tag('rj_generation', `RJ生成: ${generationStatus(allProductIds, [...detailsById.values()])}`))

  return {
    itemTags: filterTags(itemCandidates, options),
    unitTags: [],
    logs,
  }
}

function normalizeOptions(value = {}) {
  return {
    site: String(value.site || 'auto').trim() || 'auto',
    cacheTtlHours: Number.isFinite(Number(value.cacheTtlHours)) ? Number(value.cacheTtlHours) : 168,
    cacheOnly: value.cacheOnly === true,
    fetchAjax: value.fetchAjax !== false,
    fetchHtml: value.fetchHtml !== false,
    requestMinIntervalMs: finiteNumber(value.requestMinIntervalMs, 800),
    requestJitterMs: finiteNumber(value.requestJitterMs, 400),
    requestTimeoutMs: finiteNumber(value.requestTimeoutMs, 20000),
    requestMaxRetries: Math.max(0, Math.floor(finiteNumber(value.requestMaxRetries, 2))),
    requestRetryBaseMs: finiteNumber(value.requestRetryBaseMs, 1500),
    requestRetryMaxMs: finiteNumber(value.requestRetryMaxMs, 60000),
    respectRetryAfter: value.respectRetryAfter !== false,
    includeKinds: stringSet(value.includeKinds),
    excludeKinds: stringSet(value.excludeKinds),
    includeTags: normalizedTagSet(value.includeTags),
    excludeTags: normalizedTagSet(value.excludeTags),
  }
}

async function loadProductDetail(productId, options, cacheDir) {
  const logs = []
  const cachePath = cacheDir ? path.join(cacheDir, `${productId}.json`) : ''
  const cached = cachePath ? await readCache(cachePath, options.cacheTtlHours) : null
  if (cached) return { ...cached, logs: [`${productId}: 使用缓存 ${cachePath}`] }
  const site = resolveSite(productId, options.site)
  const detail = {
    productId,
    site,
    status: 'fetch_failed',
    title: '',
    circle: '',
    workType: '',
    age: '',
    genres: [],
    creators: [],
    voiceActors: [],
    series: [],
    fetchedAt: new Date().toISOString(),
  }
  if (options.cacheOnly) {
    detail.status = 'skipped'
    detail.error = 'cacheOnly enabled and cache missing'
    detail.logs = [`${productId}: cacheOnly 开启且缓存不存在，跳过请求`]
    return detail
  }
  const errors = []
  if (options.fetchAjax) {
    try {
      logs.push(`${productId}: 请求 DLsite ajax ${site}`)
      const ajax = await fetchJson(`https://www.dlsite.com/${site}/product/info/ajax?product_id=${encodeURIComponent(productId)}`, options)
      const row = ajax?.[productId] || ajax?.[productId.toUpperCase()] || (Array.isArray(ajax) ? ajax[0] : null)
      mergeAjaxDetail(detail, row)
      logs.push(`${productId}: ajax ${row ? '命中' : '无数据'}`)
    } catch (error) {
      const message = String(error?.message || error)
      errors.push(message)
      logs.push(`${productId}: ajax 失败 ${message}`)
    }
  }
  if (options.fetchHtml) {
    try {
      logs.push(`${productId}: 请求 DLsite html ${site}`)
      const html = await fetchText(`https://www.dlsite.com/${site}/work/=/product_id/${encodeURIComponent(productId)}.html`, options)
      mergeHtmlDetail(detail, html)
      logs.push(`${productId}: html 获取成功 ${html.length} bytes`)
    } catch (error) {
      const message = String(error?.message || error)
      errors.push(message)
      logs.push(`${productId}: html 失败 ${message}`)
    }
  }
  const fetchCount = Number(options.fetchAjax !== false) + Number(options.fetchHtml !== false)
  detail.status = detail.title || detail.genres.length || detail.circle ? 'found' : errors.length >= fetchCount ? 'fetch_failed' : 'not_found'
  if (errors.length) detail.error = errors.join('; ')
  detail.logs = logs
  if (cachePath) await writeCache(cachePath, detail)
  return detail
}

function detailToTags(productId, detail = {}) {
  const status = detail.status === 'found' ? '有' : detail.status === 'not_found' ? '无' : detail.status === 'skipped' ? '跳过' : '获取失败'
  return compact([
    tag('dlsite_status', `DL状态: ${status}`),
    tag('dlsite_site', `DL站点: ${detail.site || resolveSite(productId, 'auto')}`),
    detail.title ? tag('title', `DL标题: ${detail.title}`) : null,
    detail.circle ? tag('circle', `DL社团: ${detail.circle}`) : null,
    detail.workType ? tag('work_type', `DL类型: ${detail.workType}`) : null,
    detail.age ? tag('age', `DL年龄: ${detail.age}`) : null,
    ...unique(detail.genres || []).map((value) => tag('genre', `DL标签: ${value}`)),
    ...unique(detail.creators || []).map((value) => tag('creator', `DL作者: ${value}`)),
    ...unique(detail.voiceActors || []).map((value) => tag('voice_actor', `DL声优: ${value}`)),
    ...unique(detail.series || []).map((value) => tag('series', `DL系列: ${value}`)),
  ])
}

function mergeAjaxDetail(detail, row) {
  if (!row || typeof row !== 'object') return
  detail.title ||= clean(row.work_name || row.title || row.name)
  detail.circle ||= clean(row.maker_name || row.circle_name || row.brand_name || row.maker?.name)
  detail.workType ||= clean(row.work_type || row.work_type_string || row.category_name || row.work_category)
  detail.age ||= clean(row.age_category_string || row.age_category || row.age_rating || row.rate)
  detail.genres = unique([...detail.genres, ...valuesFrom(row.genre), ...valuesFrom(row.genres), ...valuesFrom(row.genre_name)])
  const creaters = row.creaters || row.creators || {}
  detail.creators = unique([
    ...detail.creators,
    ...valuesFrom(row.creators),
    ...valuesFrom(row.creaters),
    ...valuesFrom(row.author),
    ...valuesFrom(row.scenario_by),
    ...valuesFrom(row.illust_by),
    ...valuesFrom(creaters.author),
    ...valuesFrom(creaters.scenario_by),
    ...valuesFrom(creaters.illust_by),
  ])
  detail.voiceActors = unique([
    ...detail.voiceActors,
    ...valuesFrom(row.voice_by),
    ...valuesFrom(row.voice_actor),
    ...valuesFrom(row.voice_actors),
    ...valuesFrom(creaters.voice_by),
    ...valuesFrom(creaters.voice_actor),
    ...valuesFrom(creaters.voice_actors),
  ])
  detail.series = unique([...detail.series, ...valuesFrom(row.series), ...valuesFrom(row.series_name)])
}

function mergeHtmlDetail(detail, html) {
  if (!html) return
  detail.title ||= clean(matchText(html, /<h1[^>]*(?:id=["']work_name["'][^>]*)?[^>]*>([\s\S]*?)<\/h1>/i))
  detail.circle ||= clean(matchText(html, /<[^>]+class=["'][^"']*(?:maker_name|maker_name_inner)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i))
  detail.workType ||= clean(labelValue(html, ['作品类型', 'Work type', 'Work Type']))
  detail.age ||= clean(labelValue(html, ['年龄指定', '年齢指定', 'Age']))
  detail.genres = unique([...detail.genres, ...anchorTexts(html, /\/(?:maniax|pro|books)\/fsr\/=\/genre\//i)])
  detail.creators = unique([...detail.creators, ...anchorTexts(html, /\/(?:maniax|pro|books)\/fsr\/=\/(?:creater|creator|author|scenario|illust)/i)])
  detail.voiceActors = unique([
    ...detail.voiceActors,
    ...anchorTexts(html, /\/(?:maniax|pro|books)\/fsr\/=\/(?:voice_actor|cv)/i),
    ...splitLabelValues(labelValue(html, ['声優', '声优', 'CV', 'Voice Actor', 'Voice actor'])),
  ])
  detail.series = unique([...detail.series, ...anchorTexts(html, /\/(?:maniax|pro|books)\/fsr\/=\/series/i)])

  const keywords = clean(matchText(html, /<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i))
  if (keywords) detail.genres = unique([...detail.genres, ...keywords.split(',').map(clean).filter((value) => value && !/^RJ|VJ|BJ|EJ/i.test(value))])
}

async function fetchJson(url, options) {
  const text = await fetchText(url, options)
  return JSON.parse(text)
}

async function fetchText(url, options) {
  let lastError
  for (let attempt = 0; attempt <= options.requestMaxRetries; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs(attempt, options, lastError?.retryAfterMs))
    await waitForRateLimit(options)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('request timeout')), options.requestTimeoutMs)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; copymanga-tag-script/1.0)',
          Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en;q=0.8,zh-CN;q=0.7',
        },
      })
      if (!res.ok) {
        const error = new Error(`${res.status} ${res.statusText}`)
        error.status = res.status
        error.retryAfterMs = retryAfterMs(res.headers.get('retry-after'))
        if (!shouldRetry(error, attempt, options)) throw error
        lastError = error
        continue
      }
      return await res.text()
    } catch (error) {
      lastError = error
      if (!shouldRetry(error, attempt, options)) throw error
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError || new Error('request failed')
}

async function readCache(filePath, ttlHours) {
  if (ttlHours <= 0) return null
  try {
    const cached = JSON.parse(await readFile(filePath, 'utf8'))
    const ageMs = Date.now() - Date.parse(cached.fetchedAt || cached.cachedAt || 0)
    if (ageMs <= ttlHours * 3600 * 1000) return cached
  } catch {
    return null
  }
  return null
}

async function writeCache(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

function filterTags(candidates, options) {
  return unique(candidates.filter((entry) => {
    if (!entry?.tag) return false
    const kind = normalize(entry.kind)
    const normalized = normalize(entry.tag)
    if (options.includeKinds.size && !options.includeKinds.has(kind)) return false
    if (options.excludeKinds.has(kind)) return false
    if (options.includeTags.size && !options.includeTags.has(normalized)) return false
    if (options.excludeTags.has(normalized)) return false
    return true
  }).map((entry) => entry.tag))
}

function generationStatus(productIds, details) {
  if (!productIds.length) return '无编号'
  const failed = details.filter((detail) => detail?.status === 'fetch_failed').length
  if (failed === 0) return '成功'
  return failed === details.length ? '失败' : '部分失败'
}

async function waitForRateLimit(options) {
  const now = Date.now()
  const minDelay = Math.max(0, options.requestMinIntervalMs || 0)
  const jitter = Math.max(0, Math.floor(Math.random() * (options.requestJitterMs || 0)))
  const waitMs = Math.max(0, lastRequestAt + minDelay + jitter - now)
  if (waitMs) await sleep(waitMs)
  lastRequestAt = Date.now()
}

function shouldRetry(error, attempt, options) {
  if (attempt >= options.requestMaxRetries) return false
  if (error?.name === 'AbortError') return true
  if (!error?.status) return true
  return error.status === 429 || error.status === 403 || error.status >= 500
}

function retryDelayMs(attempt, options, retryAfter) {
  if (options.respectRetryAfter && retryAfter) return Math.min(retryAfter, options.requestRetryMaxMs)
  const base = Math.max(0, options.requestRetryBaseMs)
  const jitter = Math.floor(Math.random() * Math.max(0, options.requestJitterMs))
  return Math.min(options.requestRetryMaxMs, base * (2 ** Math.max(0, attempt - 1)) + jitter)
}

function retryAfterMs(value) {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function productIdsFromTexts(values) {
  return unique(compact(values).flatMap((value) => [...String(value).matchAll(PRODUCT_RE)].map((match) => match[1].toUpperCase())))
}

function unitTexts(unit = {}) {
  return [unit.title, unit.fileName, unit.relativePath, unit.groupPath, unit.managedPath, unit.streamPath]
}

function resolveSite(productId, requested) {
  const explicit = String(requested || '').trim().toLowerCase()
  if (explicit && explicit !== 'auto') return explicit
  const prefix = productPrefix(productId)
  if (prefix === 'VJ') return 'pro'
  if (prefix === 'BJ') return 'books'
  return 'maniax'
}

function productPrefix(productId) {
  return String(productId || '').slice(0, 2).toUpperCase()
}

function valuesFrom(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(valuesFrom)
  if (typeof value === 'object') return compact([
    value.name,
    value.label,
    value.value,
    value.work_name,
    value.creater_name,
    value.creator_name,
    value.voice_actor_name,
  ])
  return compact(String(value).split(/[,/、，]/).map(clean))
}

function splitLabelValues(value) {
  return valuesFrom(clean(value).replace(/\s*[×x]\s*/gi, '/'))
}

function anchorTexts(html, hrefPattern) {
  const result = []
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(anchorRe)) {
    if (!hrefPattern.test(match[1] || '')) continue
    const text = clean(match[2])
    if (text) result.push(text)
  }
  return result
}

function labelValue(html, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const value = matchText(html, new RegExp(`<tr[^>]*>[\\s\\S]*?<th[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/th>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>[\\s\\S]*?<\\/tr>`, 'i'))
    if (value) return value
  }
  return ''
}

function matchText(text, re) {
  const match = re.exec(text || '')
  return match ? match[1] : ''
}

function clean(value) {
  return decodeEntities(stripTags(String(value || ''))).replace(/\s+/g, ' ').trim()
}

function stripTags(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

function tag(kind, value) {
  const text = clean(value)
  return text ? { kind, tag: text } : null
}

function stringSet(values) {
  return new Set((Array.isArray(values) ? values : String(values || '').split(/[,\n，]+/)).map(normalize).filter(Boolean))
}

function normalizedTagSet(values) {
  return new Set((Array.isArray(values) ? values : String(values || '').split(/[,\n，]+/)).map(clean).map(normalize).filter(Boolean))
}

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function unique(values) {
  return [...new Set(compact(values))]
}

function compact(values) {
  return values.map((value) => typeof value === 'string' ? value.trim() : value).filter(Boolean)
}
