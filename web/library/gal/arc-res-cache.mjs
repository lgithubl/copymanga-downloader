// 容器（.arc）里的资源取原图 / 原音频时的磁盘缓存：<DATA_DIR>/cache/gal-arc-res/<前两位>/<key>.<扩展名>，有总量上限（LRU，按 atime；命中只 touch atime，mtime 不动——ETag 靠 mtime，不然每次请求 ETag 都变、304 永远命中不了）。
//   · 以前 hybrid 方式取资源是把条目写进媒体目录的 arc/res/…，永久留着、只增不减；现在写到缓存目录，超过上限淘汰最久没用的，媒体目录不再增长
//   · key 来自 containers.virtualEntry（.arc 路径 / 大小 / 修改时间 + 条目位置 + 转格式 + 格式版本）：.arc 不变就一直命中，变了就是新文件
//   · 同一个条目并发请求只取一次；先写临时文件再改名；刚写出来的文件（FRESH_MS 内）不淘汰；写失败 = 抛错（调用方当取不到）
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FRESH_MS = 60_000
const PRUNE_EVERY_MS = 30_000

export function createArcResCache({ dir, maxBytes = (Number(process.env.GAL_ARC_CACHE_MB) || 2048) * 1024 * 1024 } = {}) {
  const inflight = new Map()
  let lastPrune = 0
  let pruning = null
  const fileOf = (entry) => {
    const ext = path.extname(entry.rel || '').replace(/[^.\w]/g, '') || ''
    return path.join(dir, entry.key.slice(0, 2), `${entry.key}${ext}`)
  }
  async function prune(force = false) {
    if (!maxBytes || maxBytes <= 0) return
    const now = Date.now()
    if (!force && now - lastPrune < PRUNE_EVERY_MS) return
    if (pruning) return pruning
    lastPrune = now
    pruning = (async () => {
      const files = []
      let total = 0
      for (const shard of await readdir(dir).catch(() => [])) {
        for (const name of await readdir(path.join(dir, shard)).catch(() => [])) {
          const file = path.join(dir, shard, name)
          const st = await stat(file).catch(() => null)
          if (!st?.isFile()) continue
          total += st.size
          files.push({ file, size: st.size, at: Math.max(st.atimeMs, st.mtimeMs) })
        }
      }
      if (total <= maxBytes) return
      files.sort((a, b) => a.at - b.at)
      for (const f of files) {
        if (total <= maxBytes) break
        if (Date.now() - f.at < FRESH_MS) continue
        if (await rm(f.file, { force: true }).then(() => true, () => false)) total -= f.size
      }
    })().catch(() => {}).finally(() => { pruning = null })
    return pruning
  }
  // 返回缓存文件的真实路径（没有就从 .arc 取出来写好）
  async function get(entry) {
    const file = fileOf(entry)
    const have = await stat(file).catch(() => null)
    if (have?.size > 0) { const t = new Date(); utimes(file, t, new Date(Math.floor(have.mtimeMs))).catch(() => {}); return file }
    let pending = inflight.get(file)
    if (!pending) {
      pending = (async () => {
        const data = await entry.read()
        await mkdir(path.dirname(file), { recursive: true })
        const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
        await writeFile(tmp, data)
        await rename(tmp, file)
        prune().catch(() => {})
        return file
      })().finally(() => inflight.delete(file))
      inflight.set(file, pending)
    }
    return pending
  }
  return { get, prune, fileOf, dir, maxBytes }
}
