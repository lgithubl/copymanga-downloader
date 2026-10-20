#!/usr/bin/env node
// 压缩包图集 / LANraragi 迁移的接口级自测。对本地服务或线上 demo 都能跑：
//   BASE=http://127.0.0.1:8091 FIXTURE=/tmp/lrr-fx [AUTH=user:pass] [DATA_DIR=/data] [INPUT_DIR=/input] \
//     [LRR_CONTENT=/data/library/lrr/content] [LRR_THUMB=/data/library/lrr/thumb] [REDIS_URL=redis://host:6379] \
//     node archive-selftest.mjs
// FIXTURE 是 make_lrr_fixture.py 的输出目录（用它的 expect.json 做断言）。
// DATA_DIR / INPUT_DIR 是服务端看到的目录在**本机**上的路径，给了才会检查分片文件和 mv 之后源文件是否消失。

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

// 0. 配置
const cfgBefore = await getJson('/api/config')
const config = {
  lrrContentDir: process.env.LRR_CONTENT || cfgBefore.lrrContentDir,
  lrrThumbDir: process.env.LRR_THUMB || cfgBefore.lrrThumbDir,
  lrrRedisUrl: process.env.REDIS_URL || cfgBefore.lrrRedisUrl,
  lrrPathFrom: expect.prefix,
  ...(process.env.INPUT_IN_SERVER ? { mediaImportSourceRoots: process.env.INPUT_IN_SERVER } : {}),
}
const saved = await postJson('/api/config', config)
check('配置保存：LRR 参数生效', saved.body.lrrPathFrom === expect.prefix && saved.body.lrrContentDir === config.lrrContentDir, JSON.stringify(saved.body).slice(0, 200))
const types = await getJson('/api/library/types')
check('库类型里有「压缩包图集」', types.some((t) => t.type === 'archive' && t.importable), JSON.stringify(types))

// 1. 试运行
let res = await startJob({ importProfile: 'lrr-init', dryRun: 'true' })
check('迁移任务以后台任务启动（202 + job）', res.status === 202 && res.body.job?.status === 'running', JSON.stringify(res.body).slice(0, 200))
let job = await waitJob()
let report = job.report
check('试运行完成', job.status === 'completed', job.error)
check('试运行：档案总数', report.archives === expect.total_hashes, `${report.archives} vs ${expect.total_hashes}`)
check('试运行：将导入数', report.imported === expect.importable, `${report.imported} vs ${expect.importable}`)
check('试运行：非 zip 跳过 rar', report.skippedExtension.rar === 1, JSON.stringify(report.skippedExtension))
check('试运行：缺失文件 1', report.missingFile === 1, String(report.missingFile))
check('试运行：前缀不匹配 1', report.pathMismatch === 1, String(report.pathMismatch))
check('试运行：ID 抽样一致', report.idCheck.sampled > 0 && report.idCheck.mismatched === 0, JSON.stringify(report.idCheck))
check('试运行：没有标签库/元数据副作用', (await archivePage()).items?.length === 0 || (await archivePage()).total === 0)
if (DATA_DIR) check('试运行：没有写任何元数据文件', !existsSync(path.join(DATA_DIR, 'library-meta', 'archive')) || readdirSync(path.join(DATA_DIR, 'library-meta', 'archive')).length === 0)

// 2. 正式迁移
res = await startJob({ importProfile: 'lrr-init', dryRun: 'false' })
job = await waitJob()
report = job.report
check('迁移完成', job.status === 'completed', job.error)
check('迁移：导入数', report.imported === expect.importable && report.failed === 0, `${report.imported} failed=${report.failed} ${JSON.stringify(report.examples.failed)}`)
check('迁移：封面已复制', report.coverCopied > 0, String(report.coverCopied))
if (DATA_DIR) {
  const metaRoot = path.join(DATA_DIR, 'library-meta', 'archive')
  const sample = expect.archives[0].id
  check('元数据按 ab/cd 分片落盘', existsSync(path.join(metaRoot, sample.slice(0, 2), sample.slice(2, 4), `${sample}.json`)))
  const stored = JSON.parse(readFileSync(path.join(metaRoot, sample.slice(0, 2), sample.slice(2, 4), `${sample}.json`), 'utf8'))
  check('元数据：zip 外部引用且路径已映射到挂载目录', stored.zip.external === true && stored.zip.path.startsWith(config.lrrContentDir), JSON.stringify(stored.zip))
  check('元数据：保留 LRR 原始字段', stored.origin?.lrr?.id === sample && stored.origin.lrr.file.startsWith(expect.prefix), JSON.stringify(stored.origin))
}

// 3. 重跑：跳过
res = await startJob({ importProfile: 'lrr-init', dryRun: 'false' })
job = await waitJob()
check('重跑：全部已存在跳过', job.report.imported === 0 && job.report.skippedExisting === expect.importable, `${job.report.imported}/${job.report.skippedExisting}`)

// 4. 索引与列表
const page = await waitIndex(expect.importable)
check('索引：条目数', page.total === expect.importable, `${page.total}`)
const byId = new Map(page.items.map((item) => [item.itemId, item]))
const first = expect.archives[0]
check('列表：标题和 primaryKind', byId.get(first.id)?.title === first.title && byId.get(first.id)?.primaryKind === 'image-gallery', JSON.stringify(byId.get(first.id)))
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
const gbkEncodingNote = process.env.ZIP_FILENAME_ENCODING || '(服务端未设 ZIP_FILENAME_ENCODING)'
const reader = await request(`/api/library/items/archive/${expect.gbk.id}/reader/zip`)
check('阅读：返回 images 类型', reader.body.type === 'images' && reader.body.images?.length === 3, JSON.stringify(reader.body).slice(0, 200))
if (process.env.ZIP_FILENAME_ENCODING) check(`阅读：GBK 文件名按 ${gbkEncodingNote} 解码且页序自然`, reader.body.images?.map((img) => img.title).join() === expect.gbk.order.join(), reader.body.images?.map((img) => img.title).join())
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
check('标签脚本：完成', result.status === 'completed', JSON.stringify(result).slice(0, 300))
const infoItem = await getJson(`/api/library/items/archive/${expect.info.id}`)
for (const tag of ['页数: 2', 'artist:作者乙', 'circle:社团甲', 'parody:某原作', 'language:chinese', 'artist:作者甲', 'series:某系列', 'genre:冒险']) {
  check(`标签脚本产出 ${tag}`, infoItem.tags.includes(tag), JSON.stringify(infoItem.tags))
}
check('标签脚本回写页数', infoItem.pageCount === 2 && infoItem.mediaUnits?.[0]?.imageCount === 2, JSON.stringify([infoItem.pageCount, infoItem.mediaUnits?.[0]?.imageCount]))
result = await runScript(expect.nothumb.id, 'archive-gallery-thumbnail-v1')
check('封面脚本：给没有封面的条目生成封面', result.status === 'completed', JSON.stringify(result).slice(0, 300))
const nothumbItem = await getJson(`/api/library/items/archive/${expect.nothumb.id}`)
const newCover = await request(`/api/library/items/archive/${expect.nothumb.id}/thumbnail/zip/cover`)
check('封面脚本：封面接口可取、条目 cover 已设置', newCover.status === 200 && /thumbnail\/zip\/cover$/.test(nothumbItem.cover), `${newCover.status} ${nothumbItem.cover}`)
check('封面脚本：状态标签', nothumbItem.tags.includes('压缩包封面: 有'), JSON.stringify(nothumbItem.tags))
result = await runScript(expect.noimages.id, 'archive-gallery-thumbnail-v1')
const noImgItem = await getJson(`/api/library/items/archive/${expect.noimages.id}`)
check('封面脚本：没有图片的包标记失败而不是整体崩溃', noImgItem.tags.includes('压缩包封面: 失败'), JSON.stringify([result.status, noImgItem.tags]))
const preserved = await request(`/api/library/items/archive/${first.id}/thumbnail/zip/cover`)
check('封面脚本不覆盖迁移带来的封面（未 force）', preserved.status === 200)

// 7. 覆盖模式
res = await startJob({ importProfile: 'lrr-init', dryRun: 'false', overwrite: 'true' })
job = await waitJob()
check('覆盖模式：全部重新导入', job.report.imported === expect.importable && job.report.skippedExisting === 0, `${job.report.imported}/${job.report.skippedExisting}`)

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
os.makedirs(base+'/sub',exist_ok=True)
for i,rel in enumerate(['fresh1.zip','sub/[社团 (作者)] 新书 (某原作) [中国翻訳].zip']):
    with zipfile.ZipFile(base+'/'+rel,'w',zipfile.ZIP_DEFLATED) as z:
        for p in range(1,4): z.writestr('%03d.png'%p, png(30+p+i,40,(i*90,p*60,40)))
        z.writestr('uniq.txt','new-%d'%i)
`
  await execFileAsync('python3', ['-c', code, INPUT_DIR])
  newZips.push(path.join(INPUT_DIR, 'fresh1.zip'), path.join(INPUT_DIR, 'sub', '[社团 (作者)] 新书 (某原作) [中国翻訳].zip'))
  res = await startJob({ importProfile: 'archive-gallery', sourcePath: process.env.INPUT_IN_SERVER || '/input', tags: '测试批次', metadataActionIds: 'archive-gallery-thumbnail-v1,archive-gallery-tags-v1' })
  check('路径导入：后台任务', res.status === 202, JSON.stringify(res.body).slice(0, 200))
  job = await waitJob()
  check('路径导入：完成且导入 2 个', job.status === 'completed' && job.report.imported === 2 && job.report.failed === 0, JSON.stringify(job).slice(0, 300))
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
  check('路径导入：文件名约定解析出 circle/artist/parody/language', !!parsedDetail && ['circle:社团', 'artist:作者', 'parody:某原作', 'language:chinese'].every((t) => parsedDetail.tags.includes(t)), JSON.stringify(parsedDetail?.tags))
  res = await startJob({ importProfile: 'archive-gallery', sourcePath: '/etc' })
  check('路径导入：不在允许目录内的路径被拒绝（任务失败）', res.status >= 400 || (await waitJob()).status === 'failed')
}
const uploadZip = path.join(FIXTURE, 'content', 'comic.cbz')
// cbz 上传：已存在（同 id）→ 不重复建条目
res = await startJob({ importProfile: 'archive-gallery' }, [uploadZip])
check('上传导入：同一个压缩包不会重复建条目（id 去重）', res.status === 201 && res.body.items?.[0]?.itemId === expect.cbz.id, JSON.stringify(res.body).slice(0, 200))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
