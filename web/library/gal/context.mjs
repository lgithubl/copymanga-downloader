// 适配器的「媒体上下文」：有些原始格式的脚本里只写别名/名字（比如 Ren'Py 的 scene 10001A1-10），要查别的文件才知道指向哪个资源。
// 适配器可选实现：
//   contextFiles(options) → [相对媒体目录的文件]   要读的文本文件（变了就重新生成上下文）
//   contextDirs(options)  → [相对媒体目录的目录]   要递归列文件名的目录
//   contextTextFilter(options) → (rel) => boolean   可选：files 里匹配的文件读开头 24KB 放进 texts（最多 3000 个）
//   config.limits / config.indexSkip（见 config.mjs）：{ walkFiles, sampleFiles, sampleBytes, walkDepth } 覆盖下面这些默认 / 适配器自己的上限；indexSkip（正则源码数组）决定遍历时跳过哪些文件 / 目录名
//   contextSampleLimit（数字，适配器属性）  contextTextFilter 最多读多少个文件，默认 3000、封顶 20000（一个剧情一个 json 的格式要超过 3000）
//   contextWalkLimit（数字，适配器属性）  目录索引最多收多少个文件，默认 40 万、封顶 200 万；超了会被截断（truncated = true 传给 prepare，并打日志）
//   prepare({ options, texts, files, toResourcePath, truncated, mediaDir, resourceResolve }) → ctx    texts = { 相对路径: 文本 }，files = 目录里的文件相对路径数组，mediaDir = 媒体目录绝对路径（单个文件特别大、不适合整份塞进 texts 时，适配器自己按需读，比如 grenze-xml 的对话 XML）
// parse(text, ctx) 拿到 ctx。options 来自 config.adapterOptions[适配器 id]，路径类参数在这里统一过 safeRelPath。
// 上下文按（文本文件 mtime+size）缓存；目录：自己和下一层子目录的 mtime 一变就重建（新增文件马上能看到），更深的最多缓存 5 分钟。
import { open, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_INDEX_SKIP } from './config.mjs'
import { safeRelPath } from './paths.mjs'
import { decodeTextFile } from '../text-decode.mjs'

const MAX_CONTEXT_TEXT = 32 * 1024 * 1024
const MAX_WALK_FILES = 400000            // 40 万个文件的索引约 76MB 内存，放内存里没压力；超过会被截断并在界面上提示
const MAX_WALK_FILES_CEILING = 2000000   // 适配器用 contextWalkLimit 要更多时的封顶
const MAX_WALK_DEPTH = 6
const MAX_SAMPLE_FILES = 3000
const MAX_SAMPLE_FILES_CEILING = 20000   // 适配器用 contextSampleLimit 要更多时的封顶
const SAMPLE_BYTES = 24 * 1024
const SAMPLE_BYTES_CEILING = 256 * 1024
const DIR_TTL_MS = 5 * 60 * 1000
const cache = new Map()   // key → { fileKey, builtAt, ctx, stats }
const building = new Map()   // key → 正在重建的 Promise（单飞）

// 文件索引的状态（给界面显示 + 刷新按钮用）：这个媒体目录下各适配器上下文的建立时间 / 文件数 / 有没有被截断
export function contextStats(mediaDir) {
  const out = []
  for (const [key, entry] of cache) if (key.startsWith(`${mediaDir}|`) && entry.stats) out.push(entry.stats)
  return out
}
// 手动刷新：丢掉这个媒体目录的全部上下文缓存，下一次浏览会重新遍历目录、重新读名称表
export function invalidateContexts(mediaDir) {
  let n = 0
  for (const key of [...cache.keys()]) if (key.startsWith(`${mediaDir}|`)) { cache.delete(key); n += 1 }
  return n
}

const cleanRels = (list) => (Array.isArray(list) ? list : []).map(safeRelPath).filter((rel) => rel).slice(0, 10)

// out = 文件数组；limit = 最多收多少个文件；超过的丢掉，并把 out.truncated 置 true（让适配器 / 日志知道索引不全，不是默默少几个场景）
// skip：名字正则数组（config.indexSkip，编译好的），任一个匹配「文件 / 目录名」就跳过
async function walk(mediaDir, rel, depth, out, limit = MAX_WALK_FILES, maxDepth = MAX_WALK_DEPTH, skip = []) {
  if (depth > maxDepth) return
  if (out.length >= limit) { out.truncated = true; return }
  let entries
  try { entries = await readdir(path.join(mediaDir, ...rel.split('/')), { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (skip.some((re) => re.test(entry.name))) continue
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) await walk(mediaDir, child, depth + 1, out, limit, maxDepth, skip)
    else if (entry.isFile()) { if (out.length < limit) out.push(child); else out.truncated = true }
  }
}

// config.indexSkip → 编译好的正则数组（没写 = 默认规则：. 开头 / 含 | / 含 #）；config 层已经验证过，这里还是容错
function compileSkip(config) {
  const sources = Array.isArray(config?.indexSkip) ? config.indexSkip : DEFAULT_INDEX_SKIP
  const out = []
  for (const source of sources) { try { out.push(new RegExp(source)) } catch { /* 丢掉 */ } }
  return out
}
const clampInt = (value, min, max, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback)

// adapter：适配器对象；返回 ctx（适配器没有 prepare 就返回 null）
export async function loadAdapterContext({ adapter, mediaDir, config }) {
  if (typeof adapter?.prepare !== 'function') return null
  const options = config.adapterOptions?.[adapter.id] || {}
  const fileRels = cleanRels(adapter.contextFiles?.(options))
  const dirRels = cleanRels(adapter.contextDirs?.(options))
  const skip = compileSkip(config)
  const limits = config.limits || {}
  const key = `${mediaDir}|${adapter.id}|${JSON.stringify(options)}|${config.resourceRoots.join(',')}|${JSON.stringify([skip.map((re) => re.source), limits, config.resourceResolve || null])}`
  const parts = []
  for (const rel of fileRels) {
    try {
      const info = await stat(path.join(mediaDir, ...rel.split('/')))
      parts.push(`${rel}:${info.mtimeMs}:${info.size}`)
    } catch { parts.push(`${rel}:-`) }
  }
  // 目录：自己和下一层子目录的 mtime（里面新增/删除文件、子目录就会变），所以新增剧情、缩略图、立绘马上能看到；更深层的靠 TTL
  for (const rel of dirRels) {
    try {
      const abs = path.join(mediaDir, ...rel.split('/'))
      parts.push(`${rel}/:${(await stat(abs)).mtimeMs}`)
      for (const entry of (await readdir(abs, { withFileTypes: true })).slice(0, 5000)) {
        if (entry.isDirectory()) parts.push(`${rel}/${entry.name}/:${(await stat(path.join(abs, entry.name))).mtimeMs}`)
      }
    } catch { parts.push(`${rel}/:-`) }
  }
  const fileKey = parts.join('|')
  const cached = cache.get(key)
  if (cached && cached.fileKey === fileKey && (!dirRels.length || Date.now() - cached.builtAt < DIR_TTL_MS)) return cached.ctx

  // 重建（遍历目录 + 适配器 prepare，大游戏要好几秒）：同一个 key 同时只做一次（并发请求共用一个 Promise）；
  // 过了 TTL 但目录 mtime 没变（fileKey 一样）= 旧索引大概率还对：先把旧的给调用方，后台重建，下次请求用新的（不让用户为「缓存到期」等几秒）
  async function build() {

  const texts = {}
  for (const rel of fileRels) {
    try {
      const abs = path.join(mediaDir, ...rel.split('/'))
      if ((await stat(abs)).size > MAX_CONTEXT_TEXT) continue
      texts[rel] = decodeTextFile(await readFile(abs)).text
    } catch { /* 没有这个文件：适配器按没有处理 */ }
  }
  const startedAt = Date.now()
  const files = []
  // 上限：config.limits 覆盖适配器自己的 contextWalkLimit，适配器的又覆盖引擎默认
  const walkLimit = clampInt(limits.walkFiles, 1, MAX_WALK_FILES_CEILING, Number(adapter.contextWalkLimit) > 0 ? Math.min(MAX_WALK_FILES_CEILING, Number(adapter.contextWalkLimit)) : MAX_WALK_FILES)
  const walkDepth = clampInt(limits.walkDepth, 1, 12, MAX_WALK_DEPTH)
  for (const rel of dirRels) await walk(mediaDir, rel, 0, files, walkLimit, walkDepth, skip)
  if (files.truncated) console.warn(`[gal] ${adapter.id}：${mediaDir} 的文件索引超过上限 ${walkLimit} 个，被截断（部分场景 / 资源会找不到）`)
  // 磁盘上的相对路径（相对媒体目录）→ 脚本/资源接口认的路径（相对第一个匹配的资源根）
  const roots = [...config.resourceRoots].filter(Boolean).sort((a, b) => b.length - a.length)
  const toResourcePath = (rel) => {
    for (const root of roots) if (rel.startsWith(`${root}/`)) return rel.slice(root.length + 1)
    return rel
  }
  // 适配器还可以要「目录里一批小文本文件的开头」（比如每个场景一个脚本，要从里面取标题 / 说话人来建列表）：
  // contextTextFilter(options) → (相对媒体目录的路径) => boolean；最多读 MAX_SAMPLE_FILES 个，每个只读开头 SAMPLE_BYTES 字节，放进 texts（键 = 相对路径）
  const sampleFilter = adapter.contextTextFilter?.(options)
  let sampleLimit = 0
  let sampleTruncated = false
  if (typeof sampleFilter === 'function') {
    sampleLimit = clampInt(limits.sampleFiles, 1, MAX_SAMPLE_FILES_CEILING, Number(adapter.contextSampleLimit) > 0 ? Math.min(MAX_SAMPLE_FILES_CEILING, Number(adapter.contextSampleLimit)) : MAX_SAMPLE_FILES)
    const sampleBytes = clampInt(limits.sampleBytes, 256, SAMPLE_BYTES_CEILING, SAMPLE_BYTES)
    let n = 0
    for (const rel of files) {
      if (!sampleFilter(rel)) continue
      if (n >= sampleLimit) { sampleTruncated = true; break }   // 还有匹配的文件没读：以前这里悄悄丢掉，现在记下来
      n += 1
      try {
        const handle = await open(path.join(mediaDir, ...rel.split('/')), 'r')
        try {
          const buffer = Buffer.alloc(sampleBytes)
          const { bytesRead } = await handle.read(buffer, 0, sampleBytes, 0)
          texts[rel] = decodeTextFile(buffer.subarray(0, bytesRead)).text
        } finally { await handle.close() }
      } catch { /* 读不了就当没有 */ }
    }
  }
  if (sampleTruncated) console.warn(`[gal] ${adapter.id}：${mediaDir} 的脚本抽样超过上限 ${sampleLimit} 个，只读了前 ${sampleLimit} 个（列表 / 标题可能不全）`)
  const ctx = await adapter.prepare({ options, resourceResolve: config.resourceResolve, texts, files, toResourcePath, truncated: Boolean(files.truncated), sampleTruncated, mediaDir })
  if (cache.size > 200) cache.clear()
  const stats = { adapter: adapter.id, builtAt: new Date().toISOString(), files: files.length, truncated: Boolean(files.truncated), sampleTruncated, sampleLimit, limit: walkLimit, ms: Date.now() - startedAt, dirs: dirRels }
  cache.set(key, { fileKey, builtAt: Date.now(), ctx, stats })
    return ctx
  }
  const pending = building.get(key)
  const stale = cached && cached.fileKey === fileKey
  if (stale && cached.ctx) {
    if (!pending) { const job = build().catch((error) => console.warn(`[gal] ${adapter.id} 后台重建索引失败：${error?.message || error}`)).finally(() => building.delete(key)); building.set(key, job) }
    return cached.ctx
  }
  if (pending) return pending
  const job = build().finally(() => building.delete(key))
  building.set(key, job)
  return job
}
