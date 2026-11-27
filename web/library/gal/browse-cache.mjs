// Browse snapshots are data only; adapter contexts contain functions and are not
// serialized. Keep a compatible old page until a complete replacement succeeds.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { queueGalCacheBuild, galCacheQueueStatus } from './cache-jobs.mjs'
const hash = (value) => createHash('sha256').update(value).digest('hex')
let revision
export function galBrowseRevision() {
  return (revision ??= (async () => {
    const base = path.dirname(fileURLToPath(import.meta.url)),
      parts = []
    async function walk(dir) {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(p)
        else if (/\.mjs$/.test(p)) parts.push(await readFile(p))
      }
    }
    await walk(base)
    parts.push(await readFile(path.join(base, '../types/gal.mjs')))
    return hash(Buffer.concat(parts))
  })())
}
// Match the existing shallow directory check, with TTL covering deeper changes.
// Generated container outputs must not invalidate their own source snapshot.
export async function browseSourceSignature(mediaDir, config, adapters = []) {
  const dirs = new Set(['', ...(config.scriptRoots || []).map((r) => r.dir), ...(config.resourceRoots || [])]),
    files = new Set(),
    parts = []
  for (const adapter of adapters) {
    const options = config.adapterOptions?.[adapter.id] || {}
    for (const f of adapter.contextFiles?.(options) || []) files.add(f)
    for (const d of adapter.contextDirs?.(options) || []) dirs.add(d)
  }
  const output = config.containers?.enabled ? config.containers.dir : ''
  const generated = (rel) => output && (rel === output || rel.startsWith(output + '/'))
  for (const rel of [...dirs].filter((r) => typeof r === 'string').sort()) {
    if (generated(rel)) continue
    const abs = path.resolve(mediaDir, rel || '.')
    if (abs !== mediaDir && !abs.startsWith(mediaDir + path.sep)) continue
    try {
      const info = await stat(abs)
      parts.push([rel, info.mtimeMs])
      for (const e of (await readdir(abs, { withFileTypes: true }))
        .filter((e) => !e.name.startsWith('.'))
        .slice(0, 5000)) {
        const child = rel ? rel + '/' + e.name : e.name
        if (generated(child)) continue
        if (e.isDirectory()) {
          try {
            parts.push([child, (await stat(path.join(abs, e.name))).mtimeMs])
          } catch {
            parts.push([child, null])
          }
        } else if (!rel || config.containers?.enabled) files.add(child)
      }
    } catch {
      parts.push([rel, null])
    }
  }
  for (const rel of [...files].sort()) {
    if (generated(rel)) continue
    const abs = path.resolve(mediaDir, rel)
    if (!abs.startsWith(mediaDir + path.sep)) continue
    try {
      const s = await stat(abs)
      parts.push([rel, s.mtimeMs, s.size])
    } catch {
      parts.push([rel, null])
    }
  }
  return hash(JSON.stringify(parts))
}
export function createGalBrowseCache({ dir, ttl = 300000, checkInterval = 10000, now = Date.now }) {
  const pages = new Map(),
    games = new Map(),
    instance = randomUUID()
  let totalBytes = 0
  function remember(key, entry) {
    totalBytes -= pages.get(key)?.bytes || 0
    pages.delete(key)
    entry.bytes = Buffer.byteLength(JSON.stringify(entry.value))
    pages.set(key, entry)
    totalBytes += entry.bytes
    while (pages.size > 256 || totalBytes > 64 * 1024 * 1024) {
      const oldest = pages.keys().next().value
      totalBytes -= pages.get(oldest).bytes || 0
      pages.delete(oldest)
    }
  }
  const game = (id) => {
    if (!games.has(id)) games.set(id, { status: 'empty', generation: 0, available: false })
    return games.get(id)
  }
  const status = (id) => {
    const { job, ...s } = game(id)
    return {
      ...s,
      ...galCacheQueueStatus(),
      elapsedMs: s.status === 'running' ? Math.max(0, now() - s.startedAt) : s.ms || 0,
    }
  }
  async function read(key, persist) {
    if (pages.has(key)) {
      const hit = pages.get(key)
      pages.delete(key)
      pages.set(key, hit)
      return hit
    }
    if (persist)
      try {
        const file = path.join(dir, key + '.json')
        if ((await stat(file)).size > 8 * 1024 * 1024) return null
        const hit = JSON.parse(await readFile(file, 'utf8'))
        if (hit.key === key && hit.value?.node?.kind === 'cards' && Number.isFinite(hit.builtAt)) {
          hit.restored = true
          remember(key, hit)
          return hit
        }
      } catch {
        /* missing/corrupt snapshot is a cold build */
      }
    return null
  }
  function schedule(request, hit, force = false) {
    const { id, key, build, signature, persist = false, invalidate = () => {} } = request,
      s = game(id)
    if (s.job) return s.job
    if (!force && hit && s.error && now() - (s.finishedAt || 0) < 30000) return Promise.resolve(hit)
    s.manual = force
    s.status = 'queued'
    s.reason = force ? '手动刷新' : hit?.restored ? '恢复快照，后台预热' : hit ? '检查更新 / 缓存到期' : '首次建立'
    s.queuedAt = now()
    s.error = ''
    let rebuilding = false
    s.job = queueGalCacheBuild(
      'browse:' + dir + ':' + instance + ':' + id,
      async () => {
        s.status = 'running'
        s.startedAt = now()
        s.phase = '检查文件变化'
        const source = !hit || force ? null : await signature()
        if (
          !force &&
          hit &&
          !hit.restored &&
          hit.generation === s.generation &&
          now() - hit.builtAt < ttl &&
          hit.signature === source
        ) {
          s.status = 'ready'
          return hit
        }
        s.reason = force
          ? '手动刷新'
          : !hit
            ? '首次建立'
            : hit.restored
              ? '恢复快照，后台预热'
              : hit.signature !== source
                ? '文件或目录发生变化'
                : '缓存到期'
        rebuilding = true
        s.lastBuildReason = s.reason
        s.phase = '重建索引与目录'
        if (force || (hit && hit.signature !== source)) await invalidate()
        const value = await build()
        const problem = value.node?.problems
          ?.filter((p) => p.level === 'error')
          .map((p) => p.message)
          .join('; ')
        if (problem && hit) throw Error(problem)
        const entry = {
          key,
          value,
          signature: await signature(),
          builtAt: Math.max(now(), (hit?.builtAt || 0) + 1),
          generation: s.generation,
        }
        // Playback scenes remain on the existing parsing path, never frozen to disk.
        if (!problem && value.node?.kind === 'cards') {
          if (persist) {
            await mkdir(dir, { recursive: true })
            const file = path.join(dir, key + '.json'),
              tmp = file + '.' + process.pid + '.' + randomUUID() + '.part'
            const json = JSON.stringify(entry)
            if (Buffer.byteLength(json) <= 8 * 1024 * 1024) {
              await writeFile(tmp, json)
              await rename(tmp, file)
              s.diskSnapshotAt = entry.builtAt
            }
          }
          remember(key, entry)
        }
        s.available = !problem
        s.builtAt = entry.builtAt
        s.index = value.node?.index || null
        s.status = problem ? 'error' : 'ready'
        s.error = problem || ''
        return entry
      },
      {
        phase: (phase) => {
          s.phase = phase
        },
      },
    )
      .catch((error) => {
        s.status = 'error'
        s.error = String(error?.message || error)
        if (!hit) throw error
        return hit
      })
      .finally(() => {
        s.finishedAt = now()
        s.ms = s.startedAt ? Math.max(0, s.finishedAt - s.startedAt) : 0
        if (rebuilding) s.lastBuildMs = s.ms
        else s.lastCheckMs = s.ms
        s.phase = ''
        s.job = null
        s.manual = false
      })
    return s.job
  }
  return {
    status,
    async get(request) {
      const hit = await read(request.key, request.persist),
        s = game(request.id)
      if (hit) {
        s.available = true
        if (hit.restored) s.diskSnapshotAt = hit.builtAt
        s.builtAt ??= hit.builtAt
        s.index ??= hit.value.node?.index || null
        if (s.status === 'empty') s.status = 'ready'
        if (
          hit.restored ||
          hit.generation !== s.generation ||
          !s.checkedAt ||
          now() - s.checkedAt >= checkInterval ||
          now() - hit.builtAt >= ttl
        ) {
          s.checkedAt = now()
          schedule(request, hit).catch(() => {})
        }
        return {
          value: hit.value,
          cache: { ...status(request.id), available: true, builtAt: hit.builtAt, persistent: Boolean(request.persist) },
        }
      }
      const entry = await schedule(request, null)
      // Another node of this game may have owned the merged job. Build this page
      // only after it completes, through the same serial lane.
      if (!entry || entry.key !== request.key) return this.get({ ...request })
      return { value: entry.value, cache: { ...status(request.id), persistent: Boolean(request.persist) } }
    },
    async refresh(request) {
      const hit = await read(request.key, request.persist),
        s = game(request.id)
      if (s.job) {
        if (!s.manual && !s.manualQueued) {
          s.manualQueued = true
          const next = () => {
            s.manualQueued = false
            s.generation++
            schedule(request, pages.get(request.key) || hit, true).catch(() => {})
          }
          s.job.then(next, next)
        }
      } else {
        s.generation++
        schedule(request, hit, true).catch(() => {})
      }
      return status(request.id)
    },
  }
}
