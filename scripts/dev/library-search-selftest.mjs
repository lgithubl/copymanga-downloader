#!/usr/bin/env node
// 媒体库列表 / 搜索接口自测（起真实服务 + 合成的 4000 条索引）：
//   · 标签倒排索引 / 线性扫描（tagIndex=off）/ 独立写的参考实现，三者在随机查询 × 排序 × 其它筛选下结果完全一致
//   · 列表项瘦身（series.primary 代替 series.members）、sort=series、按条目附带进度（history）
//   · ETag / 304、gzip；启动接口 /api/library/boot；静态文件的 ETag + br / gzip；缩略图的 ETag / 304 / 流式
//   · 新配置项的规整；线程池大小来自配置
//   node scripts/dev/library-search-selftest.mjs
import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { shardedPath } from '../../web/library/meta-shard.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 合成数据 ----------
const N = 4000
const BASE = Date.UTC(2025, 0, 1)
const TYPES = ['archive', 'media', 'gal']
const items = []
for (let i = 0; i < N; i++) {
  const type = i % 5 === 0 ? 'gal' : i % 3 === 0 ? 'media' : 'archive'
  const tags = [`作者:作者${i % 40}`, `社团:社团${i % 25}`, `语言:${['中文', '日语', '英语'][i % 3]}`, '评级:R18']
  if (i % 4 !== 0) tags.push(`系列: S${Math.floor(i / 6)}`)
  if (i % 7 === 0) tags.push('字幕v1: 有')
  if (i % 13 === 0) tags.push(`作者:作者${i % 40}`)   // 重复
  const unitTags = i % 10 === 0 ? [`集数:${i % 5}`, '字幕:有'] : []
  const title = `Title ${i}${i % 17 === 0 ? ' 特别篇' : ''}`
  items.push({
    type,
    itemId: `x${i}`,
    title,
    displayTitle: title,
    cover: `/api/library/items/${type}/x${i}/thumbnail/cover`,
    sourceProfile: i % 2 ? 'archive-gallery' : 'rj-media',
    workKey: i % 11 === 0 ? `w${i % 50}` : '',
    productId: i % 3 === 0 ? `RJ${String(100000 + ((i * 37) % 9000))}` : '',
    unitCount: i % 9,
    tags,
    unitTags,
    dlsite: {},
    hasSubtitle: i % 7 === 0,
    createdAt: new Date(BASE + i * 60000).toISOString(),
    importedAt: new Date(BASE + i * 60000).toISOString(),
    publishedAt: new Date(BASE + ((i * 7919) % N) * 60000).toISOString(),
    searchText: `${type} x${i} ${title} ${tags.join(' ')} ${unitTags.join(' ')}`.toLowerCase(),
  })
}

const work = await mkdtemp(path.join(os.tmpdir(), 'lib-search-'))
const dataDir = path.join(work, 'data')
await mkdir(path.join(dataDir, 'cache', 'library-index'), { recursive: true })
await new Promise((resolve, reject) => {
  const out = createWriteStream(path.join(dataDir, 'cache', 'library-index', 'media-items.0.ndjson'))
  out.on('error', reject)
  out.write(`${J({ schema: 4, itemCount: N, sourceCount: N, builtAt: new Date().toISOString() })}\n`)
  for (const item of items) out.write(`${J({ k: 'i', v: item })}\n`)
  out.end(resolve)
})
// 历史（内存索引来自这个文件）：3 条
const HIST = [['archive', 'x1'], ['gal', 'x5'], ['media', 'x3']]
await mkdir(path.join(dataDir, 'cache', 'library', 'history'), { recursive: true })
await writeFile(path.join(dataDir, 'cache', 'library', 'history', 'index.json'), J(HIST.map(([type, itemId], k) => ({
  type, itemId, title: `H${k}`, cover: '/c.jpg', tags: ['不该出现在列表项里'], sourceProfile: 'archive-gallery', lastUnitId: `u${k}`, lastUnitKind: 'video', lastUnitTitle: `第${k}集`,
  lastSectionId: `s${k}`, lastSectionTitle: `节${k}`, position: { kind: 'video', seconds: 30 + k, duration: 100, ratio: 0.3 }, enteredAt: '2025-02-01T00:00:00.000Z', updatedAt: `2025-02-0${k + 1}T00:00:00.000Z`, visits: 2,
}))))
// 缩略图（archive 类型：文件路径由条目 id 算出来，不需要元数据）
const thumbFile = shardedPath(path.join(dataDir, 'cache', 'library-thumbnails', 'archive'), 'x1', '.jpg')
await mkdir(path.dirname(thumbFile), { recursive: true })
const thumbBytes = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 31) % 251))
await writeFile(thumbFile, thumbBytes)
await utimes(thumbFile, new Date('2025-03-01T00:00:00Z'), new Date('2025-03-01T00:00:00Z'))

const port = 8114
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
for (let i = 0; i < 200; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(100) } }

const rawGet = (p, headers = {}) => new Promise((resolve, reject) => {
  http.get(`${base}${p}`, { headers, agent: false }, (res) => {
    const chunks = []
    res.on('data', (d) => chunks.push(d))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
  }).on('error', reject)
})
const getJson = async (p, headers = {}) => { const r = await rawGet(p, { 'accept-encoding': 'identity', ...headers }); return { ...r, json: r.body.length ? JSON.parse(r.body.toString('utf8')) : null } }
const post = async (p, body) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J(body) }); return { status: r.status, json: await r.json() } }

try {
  // 等标签倒排索引建好
  let status = null
  for (let i = 0; i < 100; i++) { status = (await getJson('/api/library/index/status')).json; if (status.tagIndex) break; await sleep(100) }
  check('服务起来：索引 ready，条目数对，标签倒排索引分批建好（status.tagIndex）', status.status === 'ready' && status.itemCount === N && status.tagIndex === true, J(status))

  // ---------- 参考实现 ----------
  const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
  const collator = new Intl.Collator(undefined, { numeric: true })
  const tagsOf = (item) => item.tags.map(norm)
  const unitOf = (item) => item.unitTags.map(norm)
  const tokenMatches = (item, t) => {
    const a = tagsOf(item)
    const u = unitOf(item)
    if (t.prefix) return (!t.unitOnly && a.some((x) => x.startsWith(t.name))) || u.some((x) => x.startsWith(t.name))
    return (!t.unitOnly && a.includes(t.name)) || u.includes(t.name)
  }
  const seriesKeyRef = (item) => { for (const tag of item.tags) { const n = norm(tag); if (n.startsWith('系列:')) { const v = n.slice(3).trim(); if (v) return v } } return `\0${item.type}\u001f${item.itemId}` }
  const seriesGroups = new Map()
  for (const item of items) { const k = seriesKeyRef(item); if (!seriesGroups.has(k)) seriesGroups.set(k, []); seriesGroups.get(k).push(item) }
  const seriesHasSubtitle = (item) => seriesGroups.get(seriesKeyRef(item)).some((m) => m.hasSubtitle)
  const cmp = {
    imported_asc: (a, b) => (a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : 0),
    published_asc: (a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : 0),
    title_asc: (a, b) => collator.compare(norm(a.displayTitle), norm(b.displayTitle)),
    product_id_asc: (a, b) => collator.compare(norm(a.productId || a.itemId), norm(b.productId || b.itemId)),
    unit_count_asc: (a, b) => a.unitCount - b.unitCount,
  }
  const sorters = {}
  for (const [name, fn] of Object.entries(cmp)) { sorters[name] = fn; sorters[name.replace('_asc', '_desc')] = (a, b) => fn(b, a) }
  const reference = ({ tokens = [], type = 'all', sourceProfile = '', keyword = '', seriesSubtitle = 'any', sort, page, limit }) => {
    let list = [...items]
    if (type !== 'all') list = list.filter((i) => i.type === type)
    if (sourceProfile) list = list.filter((i) => i.sourceProfile === sourceProfile)
    if (keyword) list = list.filter((i) => i.searchText.includes(norm(keyword)))
    if (seriesSubtitle === 'has' || seriesSubtitle === 'none') list = list.filter((i) => seriesHasSubtitle(i) === (seriesSubtitle === 'has'))
    for (const t of tokens) list = list.filter((i) => (t.exclude ? !tokenMatches(i, t) : tokenMatches(i, t)))
    if (sort !== 'random') list.sort(sorters[sort])
    return { total: list.length, ids: list.slice((page - 1) * limit, page * limit).map((i) => i.itemId), all: list }
  }
  // 查询语法：带空格的值必须写成 tag:"…"（或 unitTag:"…"）；其它直接写
  const tokenText = (t) => {
    const body = `${t.name}${t.prefix ? '*' : ''}`
    const spaced = body.includes(' ')
    return `${t.exclude ? '-' : ''}${t.unitOnly ? 'unitTag:' : spaced ? 'tag:' : ''}${spaced ? `"${body}"` : body}`
  }
  let seed = 4242
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  const vocab = ['作者:作者3', '作者:作者17', '作者:作者', '社团:社团5', '社团:社团', '语言:中文', '语言:日语', '评级:r18', '系列: s12', '系列:', '字幕v1: 有', '集数:1', '集数:', '字幕:有', '不存在:x']
  const sortsAll = Object.keys(sorters)

  // ---------- 三方对照 ----------
  let bad = 0
  let firstBad = ''
  let withHits = 0
  const QUERIES = 220
  for (let n = 0; n < QUERIES; n++) {
    const tokens = Array.from({ length: Math.floor(rnd() * 4) }, () => {
      const name = norm(pick(vocab))
      const prefix = rnd() < 0.25 || name.endsWith(':')
      return { name: prefix && !name.endsWith(':') ? name.slice(0, Math.max(2, Math.floor(rnd() * name.length))) : name, prefix, exclude: rnd() < 0.3, unitOnly: rnd() < 0.15 }
    })
    const spec = {
      tokens,
      type: rnd() < 0.3 ? pick(TYPES) : 'all',
      sourceProfile: rnd() < 0.2 ? pick(['archive-gallery', 'rj-media']) : '',
      keyword: rnd() < 0.1 ? pick(['title 1', '特别篇', 'x2']) : '',
      seriesSubtitle: rnd() < 0.15 ? pick(['has', 'none']) : 'any',
      sort: rnd() < 0.08 ? 'random' : pick(sortsAll),
      limit: pick([20, 100, 500]),
      page: 1 + Math.floor(rnd() * 3),
    }
    const qs = new URLSearchParams({ type: spec.type, page: String(spec.page), limit: String(spec.limit), sort: spec.sort })
    if (tokens.length) qs.set('tag', tokens.map(tokenText).join(' '))
    if (spec.sourceProfile) qs.set('sourceProfile', spec.sourceProfile)
    if (spec.keyword) qs.set('keyword', spec.keyword)
    if (spec.seriesSubtitle !== 'any') qs.set('seriesSubtitle', spec.seriesSubtitle)
    const ref = reference(spec)
    if (ref.total) withHits++
    const indexed = (await getJson(`/api/library/items?${qs}`)).json
    const linear = (await getJson(`/api/library/items?${qs}&tagIndex=off`)).json
    const ids = (r) => r.items.map((i) => i.itemId)
    let ok
    if (spec.sort === 'random') {
      // 随机排序：总数一致、每一条都确实命中
      const set = new Set(ref.all.map((i) => i.itemId))
      ok = indexed.total === ref.total && linear.total === ref.total && ids(indexed).every((id) => set.has(id)) && ids(linear).every((id) => set.has(id)) && ids(indexed).length === Math.min(spec.limit, Math.max(0, ref.total - (spec.page - 1) * spec.limit))
    } else {
      ok = indexed.total === ref.total && linear.total === ref.total && J(ids(indexed)) === J(ref.ids) && J(ids(linear)) === J(ref.ids)
    }
    if (!ok) { bad++; if (!firstBad) firstBad = `${qs} → 倒排 ${indexed.total}/${ids(indexed).slice(0, 4)} 线性 ${linear.total}/${ids(linear).slice(0, 4)} 参考 ${ref.total}/${ref.ids.slice(0, 4)}` }
  }
  check(`随机 ${QUERIES} 个查询（${withHits} 个有命中；标签 / 类型 / 方案 / 关键词 / 有无字幕 / 10 种排序 + random / 每页 20·100·500 / 翻页）：倒排索引、线性扫描、参考实现三者完全一致`, bad === 0, `${bad} 个不一致，例：${firstBad}`)

  // ---------- 列表项瘦身 ----------
  const sample = (await getJson(`/api/library/items?type=all&tag=${encodeURIComponent('作者:作者3')}&limit=500`)).json.items
  const withSeries = sample.filter((i) => i.series)
  check('列表项：有系列的带摘要 series{key,count,hasSubtitle,primaryItemId,selfHasSubtitle,primary}；没有 members', withSeries.length > 0 && withSeries.every((i) => !('members' in i.series) && i.series.count > 1 && i.series.primary?.itemId === i.series.primaryItemId && ['type', 'itemId', 'sourceProfile', 'unitCount'].every((k) => k in i.series.primary) && typeof i.series.selfHasSubtitle === 'boolean'), J(withSeries[0]?.series))
  const sizeKb = Buffer.byteLength(J(sample)) / 1024 / sample.length
  check(`列表项体积：每条 < 1.2KB（以前系列成员塞满每一条，约 3~4KB）；实测 ${sizeKb.toFixed(2)}KB/条`, sizeKb < 1.2, sizeKb.toFixed(2))
  const oneSeries = withSeries[0].series
  const members = (await getJson(`/api/library/items?type=all&seriesKey=${encodeURIComponent(oneSeries.key)}&sort=series&limit=1000`)).json.items
  check('sort=series：按系列内优先级排，第一个就是主条目（和卡片「快速进入」同一套）；成员数 = series.count', members.length === oneSeries.count && members[0].itemId === oneSeries.primaryItemId && members.every((m) => m.series?.primary?.itemId === oneSeries.primaryItemId), J(members.map((m) => m.itemId)))
  // 每个系列都满足这条（抽 30 个）
  let seriesBad = 0
  for (const entry of [...seriesGroups.entries()].filter(([, list]) => list.length > 1).slice(0, 30)) {
    const r = (await getJson(`/api/library/items?type=all&seriesKey=${encodeURIComponent(entry[0])}&sort=series&limit=1000`)).json.items
    if (r.length !== entry[1].length || r[0].itemId !== r[0].series.primaryItemId) seriesBad++
  }
  check('抽 30 个系列：sort=series 的第一个都是它自己的主条目、成员数都对', seriesBad === 0, String(seriesBad))
  check('乱写的 sort 值按默认排序（不会为每个陌生值在缓存里放一份全库数组）', J((await getJson('/api/library/items?type=all&sort=whatever&limit=5')).json.items.map((i) => i.itemId)) === J((await getJson('/api/library/items?type=all&sort=imported_desc&limit=5')).json.items.map((i) => i.itemId)))

  // ---------- 进度（history）----------
  const hist = (await getJson(`/api/library/items?type=all&limit=1000&sort=imported_asc`)).json.items.filter((i) => i.history)
  check('按条目附带进度：只有有历史的 3 个条目带 history', hist.map((i) => i.itemId).sort().join() === 'x1,x3,x5', hist.map((i) => i.itemId).join())
  const h1 = hist.find((i) => i.itemId === 'x1').history
  check('history 只带卡片和续读要用的字段（lastUnit* / lastSection* / position / updatedAt），不带 title / cover / tags', J(Object.keys(h1).sort()) === J(['lastSectionId', 'lastSectionTitle', 'lastUnitId', 'lastUnitKind', 'lastUnitTitle', 'position', 'updatedAt']) && h1.lastUnitTitle === '第0集' && h1.position.seconds === 30, J(h1))

  // ---------- ETag / 304 / gzip ----------
  const q1 = `/api/library/items?type=all&tag=${encodeURIComponent('作者:作者5')}&limit=100`
  const r1 = await rawGet(q1, { 'accept-encoding': 'identity' })
  const etag = r1.headers.etag
  check('列表响应带 ETag 和 Cache-Control: no-cache（每次校验）', Boolean(etag) && r1.headers['cache-control'] === 'no-cache', J(r1.headers))
  const r2 = await rawGet(q1, { 'if-none-match': etag })
  check('带 If-None-Match 再取同一个查询：304、没有响应体', r2.status === 304 && r2.body.length === 0)
  const r3 = await rawGet(`${q1}&page=2`, { 'if-none-match': etag })
  check('换了查询（翻页）：ETag 不同，照常 200', r3.status === 200 && r3.headers.etag !== etag)
  const rr = await rawGet('/api/library/items?type=all&sort=random&limit=5')
  check('随机排序没有 ETag（每次结果不一样）', !rr.headers.etag)
  const g = await rawGet(q1, { 'accept-encoding': 'gzip' })
  check('接受 gzip 时响应被压缩，解压后和不压缩的内容一致，体积明显更小', g.headers['content-encoding'] === 'gzip' && gunzipSync(g.body).equals(r1.body) && g.body.length * 4 < r1.body.length, `${g.body.length} vs ${r1.body.length}`)
  check('小响应（<1KB）不压缩', (await rawGet('/health', { 'accept-encoding': 'gzip' })).headers['content-encoding'] === undefined)
  // 历史一变，ETag 跟着变（清空历史）
  await fetch(`${base}/api/library/history?type=all`, { method: 'DELETE' })
  const r4 = await rawGet(q1, { 'if-none-match': etag })
  check('历史变了（清空）后同一个查询不再是 304，列表项也不再带 history', r4.status === 200 && r4.headers.etag !== etag && !(await getJson('/api/library/items?type=all&limit=1000')).json.items.some((i) => i.history))

  // ---------- 启动接口 ----------
  const boot = (await getJson(`/api/library/boot?type=all&page=1&limit=20&sort=imported_desc&tag=${encodeURIComponent('作者:作者5')}`)).json
  const sep = (await getJson(`/api/library/items?type=all&page=1&limit=20&sort=imported_desc&tag=${encodeURIComponent('作者:作者5')}`)).json
  check('启动接口 /api/library/boot：一次取回 配置 + 类型 + 列表 + 元数据脚本；列表和单独取的完全一样', boot.config && typeof boot.config.libraryThumbBatch === 'number' && Array.isArray(boot.types) && boot.items && J(boot.items) === J(sep) && boot.tagScripts && Array.isArray(boot.tagScripts.items), J(Object.keys(boot)))

  // ---------- 静态文件 ----------
  const file = await readFile(path.join(root, 'web/static/app.js'))
  const s0 = await rawGet('/app.js', { 'accept-encoding': 'identity' })
  const sBr = await rawGet('/app.js', { 'accept-encoding': 'br, gzip' })
  const sGz = await rawGet('/app.js', { 'accept-encoding': 'gzip' })
  check('静态文件 app.js：ETag + no-cache；不压缩时就是原文件', Boolean(s0.headers.etag) && s0.headers['cache-control'] === 'no-cache' && s0.body.equals(file))
  check(`静态文件：接受 br 就给 br（解压后和原文件一致，${(file.length / 1024).toFixed(0)}KB → ${(sBr.body.length / 1024).toFixed(0)}KB）；只接受 gzip 给 gzip`, sBr.headers['content-encoding'] === 'br' && brotliDecompressSync(sBr.body).equals(file) && sBr.body.length * 3 < file.length && sGz.headers['content-encoding'] === 'gzip' && gunzipSync(sGz.body).equals(file))
  check('静态文件：If-None-Match 命中 → 304；三种编码用同一个 ETag', (await rawGet('/app.js', { 'if-none-match': s0.headers.etag })).status === 304 && sBr.headers.etag === s0.headers.etag && sGz.headers.etag === s0.headers.etag)
  check('静态文件：Vary: Accept-Encoding；首页 / 样式也一样走压缩 + ETag', /accept-encoding/i.test(sBr.headers.vary || '') && (await rawGet('/', { 'accept-encoding': 'br' })).headers['content-encoding'] === 'br' && Boolean((await rawGet('/style.css')).headers.etag))
  check('静态文件：不存在 → 404；目录穿越 → 不泄露', (await rawGet('/nope.js')).status === 404 && (await rawGet('/..%2fserver.mjs')).status !== 200)

  // ---------- 缩略图 ----------
  const t1 = await rawGet('/api/library/items/archive/x1/thumbnail/cover')
  check('缩略图：200、内容和磁盘文件一致、image/jpeg、Content-Length 对', t1.status === 200 && t1.body.equals(thumbBytes) && t1.headers['content-type'] === 'image/jpeg' && Number(t1.headers['content-length']) === thumbBytes.length)
  check('缩略图：ETag + Last-Modified + 缓存一天 + stale-while-revalidate', Boolean(t1.headers.etag) && Boolean(t1.headers['last-modified']) && /max-age=86400/.test(t1.headers['cache-control']) && /stale-while-revalidate/.test(t1.headers['cache-control']), J(t1.headers))
  const t2 = await rawGet('/api/library/items/archive/x1/thumbnail/cover', { 'if-none-match': t1.headers.etag })
  const t3 = await rawGet('/api/library/items/archive/x1/thumbnail/cover', { 'if-modified-since': t1.headers['last-modified'] })
  check('缩略图：If-None-Match 命中 304；只带 If-Modified-Since 且没改过也 304', t2.status === 304 && t2.body.length === 0 && t3.status === 304)
  await writeFile(thumbFile, Buffer.concat([thumbBytes, Buffer.from('more')]))
  const t4 = await rawGet('/api/library/items/archive/x1/thumbnail/cover', { 'if-none-match': t1.headers.etag })
  check('缩略图被重新生成（大小 / 时间变了）：ETag 变了，旧 ETag 不再 304，拿到新内容', t4.status === 200 && t4.headers.etag !== t1.headers.etag && t4.body.length === thumbBytes.length + 4)
  check('缩略图不存在 → 404（不是 500、不是空 200）', (await rawGet('/api/library/items/archive/x2/thumbnail/cover')).status === 404)

  // ---------- 配置项 ----------
  const defaults = (await getJson('/api/config')).json
  check('新配置项的默认值：首批 30 / 每批 60 / 并发 6 / 后台并发 2 / 线程池 16', defaults.libraryThumbFirstBatch === 30 && defaults.libraryThumbBatch === 60 && defaults.libraryThumbConcurrency === 6 && defaults.libraryThumbConcurrencyHidden === 2 && defaults.threadPoolSize === 16, J(defaults))
  const saved = (await post('/api/config', { libraryThumbFirstBatch: 9999, libraryThumbBatch: 0, libraryThumbConcurrency: 'abc', libraryThumbConcurrencyHidden: 99, threadPoolSize: 1 })).json
  check('配置项规整：超出范围夹到范围（首批 ≤500、每批 ≥1、并发 ≤32、线程池 ≥4）；不是数字用默认值', saved.libraryThumbFirstBatch === 500 && saved.libraryThumbBatch === 1 && saved.libraryThumbConcurrency === 6 && saved.libraryThumbConcurrencyHidden === 32 && saved.threadPoolSize === 4, J(saved))
  check('0 是合法的首批数量（= 页面第一次可见才开始请求）', (await post('/api/config', { libraryThumbFirstBatch: 0 })).json.libraryThumbFirstBatch === 0)
  await post('/api/config', { libraryThumbFirstBatch: 30, libraryThumbBatch: 60, libraryThumbConcurrency: 6, libraryThumbConcurrencyHidden: 2, threadPoolSize: 16 })

  // ---------- 线程池大小：来自配置，不用环境变量 ----------
  const poolOf = async (config, env = {}) => {
    const dir = await mkdtemp(path.join(work, 'tp-'))
    if (config !== null) await writeFile(path.join(dir, 'config.json'), typeof config === 'string' ? config : J(config))
    const out = execFileSync('node', ['-e', "import('./web/threadpool.mjs').then((m) => console.log(process.env.UV_THREADPOOL_SIZE, m.threadPoolSize))"], { cwd: root, env: { ...process.env, DATA_DIR: dir, ...env }, encoding: 'utf8' })
    return out.trim()
  }
  check('线程池：config.json 的 threadPoolSize 生效（设成 24 就是 24）', (await poolOf({ threadPoolSize: 24 })) === '24 24')
  check('线程池：没有配置文件 / 没写 / 配置文件坏了 → 默认 16', (await poolOf(null)) === '16 16' && (await poolOf({})) === '16 16' && (await poolOf('{坏的')) === '16 16')
  check('线程池：超出范围夹到 4~128；不理会环境变量里的 UV_THREADPOOL_SIZE（只认配置）', (await poolOf({ threadPoolSize: 1 })) === '4 4' && (await poolOf({ threadPoolSize: 9999 })) === '128 128' && (await poolOf({ threadPoolSize: 32 }, { UV_THREADPOOL_SIZE: '2' })) === '32 32')
} catch (error) {
  fail++
  console.log(`FAIL 测试中断：${error.stack?.split('\n').slice(0, 3).join(' | ')}`)
} finally {
  server.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
