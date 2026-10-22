// 适配器的「媒体上下文」：有些原始格式的脚本里只写别名/名字（比如 Ren'Py 的 scene 10001A1-10），要查别的文件才知道指向哪个资源。
// 适配器可选实现：
//   contextFiles(options) → [相对媒体目录的文件]   要读的文本文件（变了就重新生成上下文）
//   contextDirs(options)  → [相对媒体目录的目录]   要递归列文件名的目录
//   prepare({ options, texts, files, toResourcePath }) → ctx    texts = { 相对路径: 文本 }，files = 目录里的文件相对路径数组
// parse(text, ctx) 拿到 ctx。options 来自 config.adapterOptions[适配器 id]，路径类参数在这里统一过 safeRelPath。
// 上下文按（文本文件 mtime+size）缓存；目录列表最多缓存 5 分钟（目录里新增文件几分钟内会被发现）。
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { safeRelPath } from './paths.mjs'
import { decodeTextFile } from '../text-decode.mjs'

const MAX_CONTEXT_TEXT = 8 * 1024 * 1024
const MAX_WALK_FILES = 60000
const MAX_WALK_DEPTH = 6
const DIR_TTL_MS = 5 * 60 * 1000
const cache = new Map()   // key → { fileKey, builtAt, ctx }

const cleanRels = (list) => (Array.isArray(list) ? list : []).map(safeRelPath).filter((rel) => rel).slice(0, 10)

async function walk(mediaDir, rel, depth, out) {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_WALK_FILES) return
  let entries
  try { entries = await readdir(path.join(mediaDir, ...rel.split('/')), { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.includes('|') || entry.name.includes('#')) continue
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) await walk(mediaDir, child, depth + 1, out)
    else if (entry.isFile() && out.length < MAX_WALK_FILES) out.push(child)
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
  for (const rel of dirRels) await walk(mediaDir, rel, 0, files)
  // 磁盘上的相对路径（相对媒体目录）→ 脚本/资源接口认的路径（相对第一个匹配的资源根）
  const roots = [...config.resourceRoots].filter(Boolean).sort((a, b) => b.length - a.length)
  const toResourcePath = (rel) => {
    for (const root of roots) if (rel.startsWith(`${root}/`)) return rel.slice(root.length + 1)
    return rel
  }
  const ctx = await adapter.prepare({ options, texts, files, toResourcePath })
  if (cache.size > 200) cache.clear()
  cache.set(key, { fileKey, builtAt: Date.now(), ctx })
  return ctx
}
