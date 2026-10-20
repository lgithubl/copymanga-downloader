#!/usr/bin/env node
// 压缩包图集 / LANraragi 迁移的接口级自测。对本地服务或线上 demo 都能跑：
//   BASE=http://127.0.0.1:8091 FIXTURE=/tmp/lrr-fx [AUTH=user:pass] [DATA_DIR=/data] [INPUT_DIR=/input] \
//     [LRR_CONTENT=/data/library/lrr/content] [LRR_THUMB=/data/library/lrr/thumb] [REDIS_URL=redis://host:6379] \
//     node archive-selftest.mjs
// FIXTURE 是 make_lrr_fixture.py 的输出目录（用它的 expect.json 做断言）。
// zip 文件名编码、试运行、限量、覆盖、Redis 地址、目录、路径前缀都通过导入方案的 JSON 配置（profileOptions）传，和页面一致。
// DATA_DIR / INPUT_DIR 是服务端看到的目录在**本机**上的路径，给了才会检查分片文件和 mv 之后源文件是否消失。

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const BASE = process.env.BASE || 'http://127.0.0.1:8091'
const FIXTURE = process.env.FIXTURE || '/tmp/lrr-fx'
const DATA_DIR = process.env.DATA_DIR || ''
const INPUT_DIR = process.env.INPUT_DIR || ''
const headers = process.env.AUTH ? { authorization: `Basic ${Buffer.from(process.env.AUTH).toString('base64')}` } : {}
const expect = JSON.parse(readFileSync(path.join(FIXTURE, 'expect.json'), 'utf8'))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(pathname, init = {}) {
  const res = await fetch(BASE + pathname, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, ok: res.ok, body, res }
}
const getJson = async (pathname) => (await request(pathname)).body
const postJson = (pathname, value) => request(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })

const opts = (value) => JSON.stringify(value)

async function startJob(fields, files = []) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  for (const file of files) form.append('file', new Blob([await readFile(file)]), path.basename(file))
  const res = await request('/api/library/items?type=archive', { method: 'POST', body: form })
  return res
}

async function waitJob(timeoutMs = 120000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const { job } = await getJson('/api/archive-gallery/job')
    if (job && job.status !== 'running') return job
    await sleep(500)
  }
  throw new Error('任务超时')
}

async function waitIndex(minItems) {
  await request('/api/library/index/rebuild', { method: 'POST' })
  const end = Date.now() + 120000
  let last
  while (Date.now() < end) {
    const page = await getJson('/api/library/items?type=archive&page=1&limit=1000')
    last = page
    if (page?.index?.status === 'ready' && page.total >= minItems) return page
    await sleep(700)
  }
  throw new Error(`索引没有就绪：${JSON.stringify({ index: last?.index, total: last?.total })}`)
}

const archivePage = async (query = '') => getJson(`/api/library/items?type=archive&page=1&limit=1000${query}`)

// ---------------------------------------------------------------------------
console.log(`== 目标 ${BASE}，fixture ${FIXTURE}`)

// 0. 导入方案的 JSON 配置：迁移用的 Redis 地址、目录、路径前缀都在 lrr-init 的 JSON 里（页面上同一个框）
const cfgBefore = await getJson('/api/config')
const lrrDefaults = cfgBefore.mediaImportProfiles?.['lrr-init'] || {}
check('lrr-init 默认 JSON 带 Redis 地址/目录/前缀，且 dryRun 默认开着', lrrDefaults.dryRun === true && !!lrrDefaults.redisUrl && !!lrrDefaults.contentDir && !!lrrDefaults.thumbDir && !!lrrDefaults.pathFrom, JSON.stringify(lrrDefaults))
check('archive-gallery 默认 JSON 带 managedDir', !!cfgBefore.mediaImportProfiles?.['archive-gallery']?.managedDir, JSON.stringify(cfgBefore.mediaImportProfiles?.['archive-gallery']))
const lrrBase = {
  redisUrl: process.env.REDIS_URL || lrrDefaults.redisUrl,
  contentDir: process.env.LRR_CONTENT || lrrDefaults.contentDir,
  thumbDir: process.env.LRR_THUMB || lrrDefaults.thumbDir,
  pathFrom: expect.prefix,
  zipFilenameEncoding: 'gbk',
}
const lrr = (value) => JSON.stringify({ ...lrrBase, ...value })
if (process.env.INPUT_IN_SERVER) await postJson('/api/config', { mediaImportSourceRoots: process.env.INPUT_IN_SERVER })
const types = await getJson('/api/library/types')
check('库类型里有「压缩包图集」', types.some((t) => t.type === 'archive' && t.importable), JSON.stringify(types))

// 1. 试运行
let res = await startJob({ importProfile: 'lrr-init', profileOptions: lrr({ dryRun: true, zipFilenameEncoding: 'gbk' }) })
check('迁移任务以后台任务启动（202 + job）', res.status === 202 && res.body.job?.status === 'running', JSON.stringify(res.body).slice(0, 200))
let job = await waitJob()
let report = job.report
check('试运行完成', job.status === 'completed', job.error)
check('试运行：档案总数', report.archives === expect.total_hashes, `${report.archives} vs ${expect.total_hashes}`)
check('试运行：将导入数', report.imported === expect.importable, `${report.imported} vs ${expect.importable}`)
check('试运行：非 zip 跳过 rar', report.skippedExtension.rar === 1, JSON.stringify(report.skippedExtension))
check('试运行：缺失文件（missing.zip + 非 UTF-8 且确实不存在的 1 个）', report.missingFile === expect.missing, String(report.missingFile))
const nu = report.nonUtf8 || {}
check('试运行：识别出非 UTF-8 文件名（总数/能找到/仍缺失）', nu.total === expect.legacy.nonUtf8Total && nu.found === expect.legacy.nonUtf8Found && nu.stillMissing === expect.legacy.nonUtf8StillMissing, JSON.stringify(nu))
check('试运行：按编码统计（euc-jp 2：含那个不存在的、shift_jis 1），1 个任何编码都解不出', nu.byEncoding?.['euc-jp'] === 2 && nu.byEncoding?.shift_jis === 1 && nu.undecodable === expect.legacy.undecodable, JSON.stringify(nu))
check('试运行：给出非 UTF-8 文件名的例子（解出的显示名、编码、存在与否）', (nu.examples || []).some((e) => e.encoding === 'euc-jp' && e.exists && e.display.includes('フルーツジャム')) && (nu.examples || []).some((e) => e.encoding === 'shift_jis' && e.display.includes('ふぇちこれ画集')) && (nu.examples || []).some((e) => !e.exists), JSON.stringify(nu.examples))
check('试运行：LRR 里是乱码的标题会被替换（2 个能解码的，解不出的不动）', nu.titleReplaced === 2, String(nu.titleReplaced))
check('试运行：给出标签命名空间分布（用来设计 tagMap）', (report.namespaces || []).some((n) => n.namespace === 'artist') && (report.namespaces || []).some((n) => n.namespace === 'date_added'), JSON.stringify(report.namespaces))
check('试运行：前缀不匹配 1', report.pathMismatch === 1, String(report.pathMismatch))
check('试运行：ID 抽样一致', report.idCheck.sampled > 0 && report.idCheck.mismatched === 0, JSON.stringify(report.idCheck))
check('试运行：没有标签库/元数据副作用', (await archivePage()).items?.length === 0 || (await archivePage()).total === 0)
if (DATA_DIR) check('试运行：没有写任何元数据文件', !existsSync(path.join(DATA_DIR, 'library-meta', 'archive')) || readdirSync(path.join(DATA_DIR, 'library-meta', 'archive')).length === 0)

// 1b. 限量：先迁 3 个，再迁下一批 3 个（已存在的不占名额）
res = await startJob({ importProfile: 'lrr-init', profileOptions: lrr({ dryRun: true, limit: 3 }) })
job = await waitJob()
check('限量试运行：只统计 3 个且标记已达上限', job.report.imported === 3 && job.report.limited === true && job.report.limit === 3, JSON.stringify([job.report.imported, job.report.limited]))
check('限量试运行：提前结束，没有扫完全库', job.report.archives < expect.total_hashes, String(job.report.archives))
res = await startJob({ importProfile: 'lrr-init', profileOptions: lrr({ dryRun: true, limit: 20, tagMap: { artist: '作者', language: '' } }) })
job = await waitJob()
check('试运行：tagMap 效果示例（artist:x → 作者:x，language:chinese → chinese）', (job.report.tagMapExamples || []).some((e) => /^artist:/.test(e.from) && e.to === `作者:${e.from.slice(7)}`) && (job.report.tagMapExamples || []).some((e) => e.from === 'language:chinese' && e.to === 'chinese'), JSON.stringify(job.report.tagMapExamples))
res = await startJob({ importProfile: 'lrr-init', profileOptions: lrr({ dryRun: false, limit: 3, zipFilenameEncoding: 'gbk' }) })
job = await waitJob()
check('限量迁移：刚好迁 3 个', job.status === 'completed' && job.report.imported === 3 && job.report.limited === true && job.report.failed === 0, JSON.stringify(job.report).slice(0, 300))
if (DATA_DIR) {
  const count = (() => { let n = 0; const root = path.join(DATA_DIR, 'library-meta', 'archive'); const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(dir, e.name)); else if (e.name.endsWith('.json')) n++ } }; walk(root); return n })()
  check('限量迁移：磁盘上只有 3 个元数据文件', count === 3, String(count))
}
res = await startJob({ importProfile: 'lrr-init', profileOptions: lrr({ dryRun: false, limit: 3, zipFilenameEncoding: 'gbk' }) })
job = await waitJob()
check('再限量 3：迁下一批 3 个，前面的已存在跳过且不占名额', job.report.imported === 3 && job.report.skippedExisting >= 3, JSON.stringify([job.report.imported, job.report.skippedExisting]))

// 2. 正式迁移（不限量）：剩下的全部迁完
res = await startJob({ importProfile: 'lrr-init', profileOptions: lrr({ dryRun: false, zipFilenameEncoding: 'gbk' }) })
job = await waitJob()
report = job.report
check('迁移完成', job.status === 'completed', job.error)
check('迁移：导入剩余的', report.imported === expect.importable - 6 && report.failed === 0 && report.limited === false, `${report.imported} failed=${report.failed} ${JSON.stringify(report.examples.failed)}`)
check('迁移：封面已复制', report.coverCopied > 0, String(report.coverCopied))
if (DATA_DIR) {
  const metaRoot = path.join(DATA_DIR, 'library-meta', 'archive')
  const sample = expect.archives[0].id
  check('元数据按 ab/cd 分片落盘', existsSync(path.join(metaRoot, sample.slice(0, 2), sample.slice(2, 4), `${sample}.json`)))
  const stored = JSON.parse(readFileSync(path.join(metaRoot, sample.slice(0, 2), sample.slice(2, 4), `${sample}.json`), 'utf8'))
  check('元数据：zip 外部引用且路径已映射到挂载目录', stored.zip.external === true && stored.zip.path.startsWith(lrrBase.contentDir), JSON.stringify(stored.zip))
  // 早期迁移写过 sourceProfile=lrr-init：读取时统一成 archive-gallery（不用重写文件）
  const aliasFile = path.join(metaRoot, sample.slice(0, 2), sample.slice(2, 4), `${sample}.json`)
  const aliasJson = JSON.parse(readFileSync(aliasFile, 'utf8'))
  aliasJson.sourceProfile = 'lrr-init'
  writeFileSync(aliasFile, JSON.stringify(aliasJson))
  check('老条目 sourceProfile=lrr-init 读取时统一成 archive-gallery', (await getJson(`/api/library/items/archive/${sample}`)).sourceProfile === 'archive-gallery')
  check('元数据：保留 LRR 原始字段', stored.origin?.lrr?.id === sample && stored.origin.lrr.file.startsWith(expect.prefix), JSON.stringify(stored.origin))
}

// 2b. 非 UTF-8 文件名的条目：按字节找到文件、标题换成解出的文件名、能阅读
const legacyEuc = await getJson(`/api/library/items/archive/${expect.legacy.eucjp.id}`)
const legacySjis = await getJson(`/api/library/items/archive/${expect.legacy.sjis.id}`)
const legacyBad = await getJson(`/api/library/items/archive/${expect.legacy.bad.id}`)
check('EUC-JP 文件名：标题换成解码后的文件名（LRR 里是乱码）', legacyEuc.title === expect.legacy.eucjp.title, legacyEuc.title)
check('Shift-JIS 文件名：标题换成解码后的文件名', legacySjis.title === expect.legacy.sjis.title, legacySjis.title)
check('任何编码都解不出的文件名：仍然迁移（按字节访问），标题保持 LRR 里的', !!legacyBad.zip?.pathB64 && legacyBad.title === 'bad', JSON.stringify(legacyBad.zip))
check('非 UTF-8 条目记了字节路径 zip.pathB64；正常条目没有', !!legacyEuc.zip?.pathB64 && !(await getJson(`/api/library/items/archive/${expect.archives[0].id}`)).zip?.pathB64)
for (const [label, id] of [['EUC-JP', expect.legacy.eucjp.id], ['Shift-JIS', expect.legacy.sjis.id], ['无法解码', expect.legacy.bad.id]]) {
  const legacyReader = await request(`/api/library/items/archive/${id}/reader/zip`)
  const legacyPage = legacyReader.body.images?.[0] ? await request(legacyReader.body.images[0].url) : { status: 0 }
  check(`${label} 文件名的压缩包能阅读（按字节路径打开 zip、解压到缓存）`, legacyReader.body.type === 'images' && legacyReader.body.images?.length === 2 && legacyPage.status === 200, JSON.stringify(legacyReader.body).slice(0, 160))
}
const legacyCover = await request(`/api/library/items/archive/${expect.legacy.eucjp.id}/thumbnail/zip/cover`)
check('非 UTF-8 条目的封面也复制了（封面按 ID 找，和文件名无关）', legacyCover.status === 200, String(legacyCover.status))
// 状态标签和脚本对齐：封面有/无、页数
const statusBook = await getJson(`/api/library/items/archive/${expect.archives[0].id}`)
const statusNoThumb = await getJson(`/api/library/items/archive/${expect.nothumb.id}`)
check('迁移产出状态标签：有封面 → 压缩包封面: 有，页数: 3（来自 Redis pagecount）', statusBook.tags.includes('压缩包封面: 有') && statusBook.tags.includes('页数: 3'), JSON.stringify(statusBook.tags))
check('迁移产出状态标签：没有封面 → 压缩包封面: 无', statusNoThumb.tags.includes('压缩包封面: 无') && !statusNoThumb.tags.includes('压缩包封面: 有'), JSON.stringify(statusNoThumb.tags))
// 3. 重跑：跳过
res = await startJob({ importProfile: 'lrr-init', profileOptions: lrr({ dryRun: false, zipFilenameEncoding: 'gbk' }) })
job = await waitJob()
check('重跑：全部已存在跳过', job.report.imported === 0 && job.report.skippedExisting === expect.importable, `${job.report.imported}/${job.report.skippedExisting}`)

// 4. 索引与列表
const page = await waitIndex(expect.importable)
check('索引：条目数', page.total === expect.importable, `${page.total}`)
const byId = new Map(page.items.map((item) => [item.itemId, item]))
const noCoverSearch = await archivePage('&tag=' + encodeURIComponent('tag:"压缩包封面: 无"'))
check('能按「压缩包封面: 无」搜出没有封面的条目（之后批量跑缩略图脚本）', noCoverSearch.total >= 1 && noCoverSearch.items.some((i) => i.itemId === expect.nothumb.id), String(noCoverSearch.total))
const notTagged = await archivePage('&tag=' + encodeURIComponent('-tag:"tag:*" -tag:"group:*"'))
check('搜「没有 tag:/group: 命名空间标签」的条目：-tag:"tag:*" -tag:"group:*" 可用（迁移来的这批没有 tag:/group:，所以全部命中）', notTagged.total >= expect.importable - 6, String(notTagged.total))

const first = expect.archives[0]
check('列表：标题和 primaryKind', byId.get(first.id)?.title === first.title && byId.get(first.id)?.primaryKind === 'image-gallery', JSON.stringify(byId.get(first.id)))
check('迁移来的条目和新导入的用同一个 sourceProfile（archive-gallery），迁移方案本身不是条目的方案值', byId.get(first.id)?.sourceProfile === 'archive-gallery' && [...byId.values()].every((item) => item.sourceProfile === 'archive-gallery'), JSON.stringify([...new Set([...byId.values()].map((item) => item.sourceProfile))]))
const bySource = await archivePage('&sourceProfile=archive-gallery')
check('按导入方案 archive-gallery 筛选：迁移来的全部在内（算一种）', bySource.total === page.total && bySource.total >= expect.importable, `${bySource.total} vs ${page.total}`)
const byOldSource = await archivePage('&sourceProfile=lrr-init')
check('lrr-init 不再是任何条目的方案值', byOldSource.total === 0, String(byOldSource.total))
check('列表：封面 URL 指向缩略图接口', /thumbnail\/zip\/cover$/.test(byId.get(first.id)?.cover || ''), byId.get(first.id)?.cover)
check('双重编码的标题被解开', byId.get(expect.double.id)?.title === expect.double.title, byId.get(expect.double.id)?.title)
check('空标题退回 name', byId.get(expect.notitle.id)?.title === expect.notitle.title, byId.get(expect.notitle.id)?.title)
const detail = await getJson(`/api/library/items/archive/${first.id}`)
check('条目详情：标签完整保留（命名空间、date_added、source）', first.tags.every((tag) => detail.tags.includes(tag)), JSON.stringify(detail.tags))
const tagged = await archivePage('&tag=' + encodeURIComponent('artist:artist3'))
check('按标签筛选', tagged.total === expect.archives.filter((a) => a.tags.includes('artist:artist3')).length && tagged.total > 0, String(tagged.total))
const sorted = await archivePage('&sort=title_asc')
check('标题升序排序可用', sorted.items.length === expect.importable)
const cover = await request(`/api/library/items/archive/${first.id}/thumbnail/zip/cover`)
check('封面接口返回图片', cover.status === 200 && /image\//.test(cover.res.headers.get('content-type') || ''), String(cover.status))
const noCover = await request(`/api/library/items/archive/${expect.nothumb.id}/thumbnail/zip/cover`)
check('没有封面的条目：封面接口 4xx/5xx 而不是挂起', noCover.status >= 400, String(noCover.status))

// 5. 阅读（解压到缓存，GBK 文件名 + 自然序）
const reader = await request(`/api/library/items/archive/${expect.gbk.id}/reader/zip`)
check('阅读：返回 images 类型', reader.body.type === 'images' && reader.body.images?.length === 3, JSON.stringify(reader.body).slice(0, 200))
check('阅读：GBK 文件名按导入方案配置的 zipFilenameEncoding 解码且页序自然', reader.body.images?.map((img) => img.title).join() === expect.gbk.order.join(), reader.body.images?.map((img) => img.title).join())
const pageResp = await request(reader.body.images[0].url)
check('阅读：页面图片可取', pageResp.status === 200 && /image\//.test(pageResp.res.headers.get('content-type') || ''), String(pageResp.status))
const nested = await request(`/api/library/items/archive/${expect.nested.id}/reader/zip`)
check('阅读：目录层级/资源叉/非图片被正确过滤', nested.body.images?.length === expect.nested.pages, JSON.stringify(nested.body.images?.length))
const none = await request(`/api/library/items/archive/${expect.noimages.id}/reader/zip`)
check('阅读：没有图片的包报错而不是空白', none.status >= 400, String(none.status))
const outside = await request(`/api/library/items/archive/${expect.gbk.id}/resource?path=${encodeURIComponent('../../../etc/passwd')}`)
check('资源接口拒绝越界路径', outside.status >= 400, String(outside.status))
const progress = await postJson(`/api/library/items/archive/${first.id}/progress`, { unitId: 'zip', scrollRatio: 0.5, title: '第一本' })
const prog = await getJson(`/api/library/items/archive/${first.id}/progress`)
check('阅读进度可保存', prog.lastUnitId === 'zip', JSON.stringify([progress.status, prog]).slice(0, 200))

// 6. 标签脚本
async function runScript(itemId, scriptId, options) {
  if (options) await postJson(`/api/tag-scripts/${scriptId}/config`, { options })
  const created = await postJson(`/api/library/items/archive/${itemId}/tag-scripts`, { actionIds: [scriptId], force: true })
  const jobId = created.body.job?.id
  if (!jobId) return { error: JSON.stringify(created.body) }
  for (let i = 0; i < 200; i++) {
    const current = await getJson(`/api/tag-jobs/${jobId}`)
    if (['completed', 'failed'].includes(current.status)) return current
    await sleep(300)
  }
  return { error: '脚本超时' }
}
let result = await runScript(expect.info.id, 'archive-gallery-tags-v1')
check('标签脚本：完成', result.status === 'completed', JSON.stringify(result.results || result).slice(0, 1500))
const infoItem = await getJson(`/api/library/items/archive/${expect.info.id}`)
for (const tag of ['页数: 2', 'artist:作者甲', 'series:某系列', 'genre:冒险']) {
  check(`标签脚本产出 ${tag}`, infoItem.tags.includes(tag), JSON.stringify(infoItem.tags))
}
check('迁移来的条目：文件名解析只用 LRR 里的原始路径（info.zip 没有括号），不再从标题猜标签', !infoItem.tags.some((t) => /^(group|tag):/.test(t)), JSON.stringify(infoItem.tags))
check('标签脚本回写页数', infoItem.pageCount === 2 && infoItem.mediaUnits?.[0]?.imageCount === 2, JSON.stringify([infoItem.pageCount, infoItem.mediaUnits?.[0]?.imageCount]))
result = await runScript(expect.nothumb.id, 'archive-gallery-thumbnail-v1')
check('封面脚本：给没有封面的条目生成封面', result.status === 'completed', JSON.stringify(result.results || result).slice(0, 1500))
const nothumbItem = await getJson(`/api/library/items/archive/${expect.nothumb.id}`)
const newCover = await request(`/api/library/items/archive/${expect.nothumb.id}/thumbnail/zip/cover`)
check('封面脚本：封面接口可取、条目 cover 已设置', newCover.status === 200 && /thumbnail\/zip\/cover$/.test(nothumbItem.cover), `${newCover.status} ${nothumbItem.cover}`)
check('封面脚本：状态标签 有 替换了迁移时的 无（互斥标签组）', nothumbItem.tags.includes('压缩包封面: 有') && !nothumbItem.tags.includes('压缩包封面: 无'), JSON.stringify(nothumbItem.tags))
result = await runScript(expect.noimages.id, 'archive-gallery-thumbnail-v1')
const noImgItem = await getJson(`/api/library/items/archive/${expect.noimages.id}`)
check('封面脚本：没有图片的包标记失败而不是整体崩溃', noImgItem.tags.includes('压缩包封面: 失败'), JSON.stringify([result.status, noImgItem.tags]))
const preserved = await request(`/api/library/items/archive/${first.id}/thumbnail/zip/cover`)
check('封面脚本不覆盖迁移带来的封面（未 force）', preserved.status === 200)

// 6c. 预览动图：第一页 + 随机/均匀 N 页（以条目 ID 为种子），配置全在脚本的 JSON 选项里
const seven = expect.archives[4]            // book0004：3 + 4 = 7 页
const detailsOf = (job) => job.results?.[0]?.details || {}
result = await runScript(seven.id, 'archive-gallery-thumbnail-v1', { previewCount: 3, previewMode: 'random', previewWidth: 200, force: true })
check('预览脚本：完成并标记「压缩包预览: 有」', result.status === 'completed' && (await getJson(`/api/library/items/archive/${seven.id}`)).tags.includes('压缩包预览: 有'), JSON.stringify(result.results || result).slice(0, 600))
const frames1 = detailsOf(result).frames || []
check('预览：第一页 + 3 个其余页，升序且不重复', frames1.length === 4 && frames1[0] === 0 && frames1.every((n, i) => i === 0 || n > frames1[i - 1]) && frames1.at(-1) <= 6, JSON.stringify(frames1))
const prev = await fetch(`${BASE}/api/library/items/archive/${seven.id}/thumbnail/zip/preview`, { headers })
const prevBuf = Buffer.from(await prev.arrayBuffer())
check('预览接口返回动图 WebP', prev.status === 200 && /image\/webp/.test(prev.headers.get('content-type') || '') && prevBuf.toString('latin1', 0, 4) === 'RIFF' && prevBuf.includes(Buffer.from('ANIM')), `${prev.status} ${prevBuf.length}`)
const sevenItem = await getJson(`/api/library/items/archive/${seven.id}`)
check('章节单元带 thumbnail.previewUrl（章节列表悬停用）', /thumbnail\/zip\/preview$/.test(sevenItem.mediaUnits?.[0]?.thumbnail?.previewUrl || ''), JSON.stringify(sevenItem.mediaUnits?.[0]?.thumbnail))
result = await runScript(seven.id, 'archive-gallery-thumbnail-v1', { previewCount: 3, previewMode: 'random', previewWidth: 200, force: true })
check('随机选页以条目 ID 为种子：重跑选的页一样', JSON.stringify(detailsOf(result).frames) === JSON.stringify(frames1), JSON.stringify([detailsOf(result).frames, frames1]))
result = await runScript(seven.id, 'archive-gallery-thumbnail-v1', { previewCount: 3, previewMode: 'even', previewWidth: 200, force: true })
check('均匀模式：7 页取 3 个 → 第 1、3、5、6 页（下标 0,2,4,5）', JSON.stringify(detailsOf(result).frames) === JSON.stringify([0, 2, 4, 5]), JSON.stringify(detailsOf(result).frames))
const three = expect.archives[0]            // book0000：3 页
result = await runScript(three.id, 'archive-gallery-thumbnail-v1', { previewCount: 10, previewMode: 'random', previewWidth: 200, force: true })
check('N 超过页数：全部页都进预览', JSON.stringify(detailsOf(result).frames) === JSON.stringify([0, 1, 2]), JSON.stringify(detailsOf(result).frames))
result = await runScript(expect.single.id, 'archive-gallery-thumbnail-v1', { previewCount: 3, force: true })
const singleItem = await getJson(`/api/library/items/archive/${expect.single.id}`)
const singlePrev = await request(`/api/library/items/archive/${expect.single.id}/thumbnail/zip/preview`)
check('单页压缩包：不生成预览，标记「压缩包预览: 无」，预览接口 4xx/5xx', singleItem.tags.includes('压缩包预览: 无') && singlePrev.status >= 400, JSON.stringify([singleItem.tags, singlePrev.status]))
result = await runScript(expect.noimages.id, 'archive-gallery-thumbnail-v1', { previewCount: 3, force: true })
check('没有图片的包：封面和预览都标记失败，任务不崩', (await getJson(`/api/library/items/archive/${expect.noimages.id}`)).tags.filter((t) => /^压缩包(封面|预览): 失败$/.test(t)).length === 2, JSON.stringify(result.results || result).slice(0, 400))
await postJson('/api/tag-scripts/archive-gallery-thumbnail-v1/config', { options: { previewCount: 0, previewMode: 'random', previewWidth: 320, force: false } })

// 7. 覆盖模式
res = await startJob({ importProfile: 'lrr-init', profileOptions: lrr({ dryRun: false, overwrite: true, zipFilenameEncoding: 'gbk', tagMap: { artist: '作者', language: '' } }) })
job = await waitJob()
check('覆盖模式：全部重新导入', job.report.imported === expect.importable && job.report.skippedExisting === 0, `${job.report.imported}/${job.report.skippedExisting}`)
const mapped = await getJson(`/api/library/items/archive/${expect.archives[0].id}`)
check('tagMap 生效（覆盖模式重写）：artist:artist0 → 作者:artist0，language:chinese → chinese', mapped.tags.includes('作者:artist0') && !mapped.tags.includes('artist:artist0') && mapped.tags.includes('chinese') && !mapped.tags.includes('language:chinese'), JSON.stringify(mapped.tags))
check('tagMap 不影响其它命名空间（parody、date_added）和状态标签', mapped.tags.some((t) => t.startsWith('parody:')) && mapped.tags.some((t) => t.startsWith('date_added:')) && mapped.tags.includes('压缩包封面: 有') && mapped.tags.includes('页数: 3'), JSON.stringify(mapped.tags))

// 8. 新导入：路径导入（mv）+ 上传
const newZips = []
if (INPUT_DIR) {
  const code = `
import zipfile, struct, zlib, sys, os
def png(w,h,c):
    raw=b''.join(b'\\x00'+bytes(c)*w for _ in range(h))
    def ch(k,d):
        b=k+d; return struct.pack('>I',len(d))+b+struct.pack('>I',zlib.crc32(b)&0xffffffff)
    return b'\\x89PNG\\r\\n\\x1a\\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
base=sys.argv[1]
os.makedirs(base+'/[目录作者]',exist_ok=True)
for i,rel in enumerate(['fresh1.zip','[目录作者]/[社团 (作者)] 新书 (某原作) [中国翻訳].zip']):
    with zipfile.ZipFile(base+'/'+rel,'w',zipfile.ZIP_DEFLATED) as z:
        for p in range(1,4): z.writestr('%03d.png'%p, png(30+p+i,40,(i*90,p*60,40)))
        z.writestr('uniq.txt','new-%d'%i)
`
  await execFileAsync('python3', ['-c', code, INPUT_DIR])
  newZips.push(path.join(INPUT_DIR, 'fresh1.zip'), path.join(INPUT_DIR, '[目录作者]', '[社团 (作者)] 新书 (某原作) [中国翻訳].zip'))
  const source = process.env.INPUT_IN_SERVER || '/input'
  res = await startJob({ importProfile: 'archive-gallery', sourcePath: source, profileOptions: opts({ dryRun: true }) })
  job = await waitJob()
  check('路径导入试运行：只统计 2 个，源文件没动', job.report.imported === 2 && job.report.dryRun === true && newZips.every((file) => existsSync(file)), JSON.stringify(job.report).slice(0, 200))
  res = await startJob({ importProfile: 'archive-gallery', sourcePath: source, tags: '测试批次', metadataActionIds: 'archive-gallery-thumbnail-v1,archive-gallery-tags-v1', profileOptions: opts({ limit: 1, zipFilenameEncoding: 'gbk' }) })
  check('路径导入：后台任务', res.status === 202, JSON.stringify(res.body).slice(0, 200))
  job = await waitJob()
  check('路径导入限量 1：只导入并 mv 走 1 个', job.status === 'completed' && job.report.imported === 1 && job.report.limited === true && newZips.filter((file) => existsSync(file)).length === 1, JSON.stringify(job.report).slice(0, 300))
  res = await startJob({ importProfile: 'archive-gallery', sourcePath: source, tags: '测试批次', metadataActionIds: 'archive-gallery-thumbnail-v1,archive-gallery-tags-v1', profileOptions: opts({ zipFilenameEncoding: 'gbk' }) })
  job = await waitJob()
  check('路径导入：再导入剩下的 1 个', job.status === 'completed' && job.report.imported === 1 && job.report.failed === 0, JSON.stringify(job).slice(0, 300))
  check('路径导入：源文件已被 mv 走', newZips.every((file) => !existsSync(file)))
  const refreshed = await waitIndex(expect.importable + 2)
  const fresh = refreshed.items.find((item) => item.title === 'fresh1')
  check('路径导入：新条目在索引里且带批次标签', !!fresh && fresh.tags.includes('测试批次'), JSON.stringify(fresh))
  if (DATA_DIR) {
    check('路径导入：zip 进了受管目录分片', existsSync(path.join(DATA_DIR, 'library', 'archive', fresh.itemId.slice(0, 2), fresh.itemId.slice(2, 4), `${fresh.itemId}.zip`)))
  }
  // 导入脚本是排队异步跑的，等一会儿看产出
  let freshDetail
  for (let i = 0; i < 40; i++) {
    freshDetail = await getJson(`/api/library/items/archive/${fresh.itemId}`)
    if (freshDetail.tags.includes('页数: 3') && freshDetail.cover) break
    await sleep(500)
  }
  check('路径导入：导入时勾选的脚本自动跑了（页数 + 封面）', freshDetail.tags.includes('页数: 3') && /thumbnail/.test(freshDetail.cover), JSON.stringify([freshDetail.tags, freshDetail.cover]))
  const parsed = refreshed.items.find((item) => item.title.includes('新书'))
  const parsedDetail = parsed ? await getJson(`/api/library/items/archive/${parsed.itemId}`) : null
  check('路径导入：记下了导入前的完整路径（目录 + 文件名）', !!parsedDetail && parsedDetail.origin?.sourceFile?.endsWith('/[目录作者]/[社团 (作者)] 新书 (某原作) [中国翻訳].zip'), JSON.stringify(parsedDetail?.origin))
  check('路径导入：按 ARegexParse 规则解析目录 + 文件名 → tag:目录作者、group:社团、tag:作者、tag:中国翻訳、tag:某原作', !!parsedDetail && ['tag:目录作者', 'group:社团', 'tag:作者', 'tag:中国翻訳', 'tag:某原作'].every((t) => parsedDetail.tags.includes(t)), JSON.stringify(parsedDetail?.tags))
  check('路径导入：标题保持原文件名（saveTitle 默认关）', parsedDetail?.title === '[社团 (作者)] 新书 (某原作) [中国翻訳]', parsedDetail?.title)
  // 命名空间映射 + saveTitle：都是脚本 JSON 选项
  result = await runScript(parsed.itemId, 'archive-gallery-tags-v1', { saveTitle: true, namespaces: { group: 'circle', tag: 'artist' } })
  const remapped = await getJson(`/api/library/items/archive/${parsed.itemId}`)
  check('namespaces 选项：group/tag 换成 circle/artist', ['artist:目录作者', 'circle:社团', 'artist:作者', 'artist:中国翻訳', 'artist:某原作'].every((t) => remapped.tags.includes(t)), JSON.stringify([result.status, remapped.tags]))
  check('namespaces 选项：脚本上次产出而这次没产出的 group:/tag: 标签被替换掉', !remapped.tags.some((t) => /^(group|tag):/.test(t)), JSON.stringify(remapped.tags))
  check('saveTitle：标题改成去掉括号后的文件名', remapped.title === '新书', remapped.title)
  await postJson('/api/tag-scripts/archive-gallery-tags-v1/config', { options: { parseFilename: true, usePath: true, saveTitle: false, namespaces: { group: 'group', tag: 'tag' }, readComicInfo: true, pageCountTag: true } })
  res = await startJob({ importProfile: 'archive-gallery', sourcePath: '/etc', profileOptions: '{}' })
  check('路径导入：不在允许目录内的路径被拒绝（任务失败）', res.status >= 400 || (await waitJob()).status === 'failed')
}
const uploadZip = path.join(FIXTURE, 'content', 'comic.cbz')
// cbz 上传：已存在（同 id）→ 不重复建条目
res = await startJob({ importProfile: 'archive-gallery' }, [uploadZip])
check('上传导入：同一个压缩包不会重复建条目（id 去重）', res.status === 201 && res.body.items?.[0]?.itemId === expect.cbz.id, JSON.stringify(res.body).slice(0, 200))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
