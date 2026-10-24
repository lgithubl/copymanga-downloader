// 适配器的「媒体上下文」：有些原始格式的脚本里只写别名/名字（比如 Ren'Py 的 scene 10001A1-10），要查别的文件才知道指向哪个资源。
// 适配器可选实现：
//   contextFiles(options) → [相对媒体目录的文件]   要读的文本文件（变了就重新生成上下文）
//   contextDirs(options)  → [相对媒体目录的目录]   要递归列文件名的目录
//   contextTextFilter(options) → (rel) => boolean   可选：files 里匹配的文件读开头 24KB 放进 texts（最多 3000 个）
//   contextWalkLimit（数字，适配器属性）  目录索引最多收多少个文件，默认 6 万、封顶 50 万；超了会被截断（truncated = true 传给 prepare，并打日志）
//   prepare({ options, texts, files, toResourcePath, truncated }) → ctx    texts = { 相对路径: 文本 }，files = 目录里的文件相对路径数组
// parse(text, ctx) 拿到 ctx。options 来自 config.adapterOptions[适配器 id]，路径类参数在这里统一过 safeRelPath。
// 上下文按（文本文件 mtime+size）缓存；目录：自己和下一层子目录的 mtime 一变就重建（新增文件马上能看到），更深的最多缓存 5 分钟。
import { open, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { safeRelPath } from './paths.mjs'
import { decodeTextFile } from '../text-decode.mjs'

const MAX_CONTEXT_TEXT = 32 * 1024 * 1024
const MAX_WALK_FILES = 60000
const MAX_WALK_FILES_CEILING = 500000   // 适配器用 contextWalkLimit 要更多时的封顶
const MAX_WALK_DEPTH = 6
const MAX_SAMPLE_FILES = 3000
const SAMPLE_BYTES = 24 * 1024
const DIR_TTL_MS = 5 * 60 * 1000
const cache = new Map()   // key → { fileKey, builtAt, ctx }

const cleanRels = (list) => (Array.isArray(list) ? list : []).map(safeRelPath).filter((rel) => rel).slice(0, 10)

// out = 文件数组；limit = 最多收多少个文件；超过的丢掉，并把 out.truncated 置 true（让适配器 / 日志知道索引不全，不是默默少几个场景）
async function walk(mediaDir, rel, depth, out, limit = MAX_WALK_FILES) {
  if (depth > MAX_WALK_DEPTH) return
  if (out.length >= limit) { out.truncated = true; return }
  let entries
  try { entries = await readdir(path.join(mediaDir, ...rel.split('/')), { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.includes('|') || entry.name.includes('#')) continue
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) await walk(mediaDir, child, depth + 1, out, limit)
    else if (entry.isFile()) { if (out.length < limit) out.push(child); else out.truncated = true }
  }
}

// adapter：适配器对象；返回 ctx（适配器没有 prepare 就返回 null）
export async function loadAdapterContext({ adapter, mediaDir, config }) {
  if (typeof adapter?.prepare !== 'function') return null
  const options = config.adapterOptions?.[adapter.id] || {}
  const fileRels = cleanRels(adapter.contextFiles?.(options))
  const dirRels = cleanRels(adapter.contextDirs?.(options))
  const key = `${mediaDir}|${adapter.id}|${JSON.stringify(options)}|${config.resourceRoots.join(',')}`
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

  const texts = {}
  for (const rel of fileRels) {
    try {
      const abs = path.join(mediaDir, ...rel.split('/'))
      if ((await stat(abs)).size > MAX_CONTEXT_TEXT) continue
      texts[rel] = decodeTextFile(await readFile(abs)).text
    } catch { /* 没有这个文件：适配器按没有处理 */ }
  }
  const files = []
  const walkLimit = Math.min(MAX_WALK_FILES_CEILING, Math.max(MAX_WALK_FILES, Number(adapter.contextWalkLimit) || 0))
  for (const rel of dirRels) await walk(mediaDir, rel, 0, files, walkLimit)
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
  if (typeof sampleFilter === 'function') {
    let n = 0
    for (const rel of files) {
      if (n >= MAX_SAMPLE_FILES) break
      if (!sampleFilter(rel)) continue
      n += 1
      try {
        const handle = await open(path.join(mediaDir, ...rel.split('/')), 'r')
        try {
          const buffer = Buffer.alloc(SAMPLE_BYTES)
          const { bytesRead } = await handle.read(buffer, 0, SAMPLE_BYTES, 0)
          texts[rel] = decodeTextFile(buffer.subarray(0, bytesRead)).text
        } finally { await handle.close() }
      } catch { /* 读不了就当没有 */ }
    }
  }
  const ctx = await adapter.prepare({ options, texts, files, toResourcePath, truncated: Boolean(files.truncated) })
  if (cache.size > 200) cache.clear()
  cache.set(key, { fileKey, builtAt: Date.now(), ctx })
  return ctx
}
