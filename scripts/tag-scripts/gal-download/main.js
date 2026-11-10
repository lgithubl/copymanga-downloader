import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, stat, realpath, utimes } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { nativeTask } from './worker-runner.mjs'
import { archiveToTmp } from './archive.mjs'

const sha = (v) => createHash('sha256').update(v).digest('hex')
const safe = (v) => String(v || 'gal-download').replace(/[^\w.-]/g, '_').slice(0, 70).replace(/^\.+$/, '_')
const exists = async (p) => { try { await stat(p); return true } catch { return false } }
const json = async (p, v) => {
  await mkdir(path.dirname(p), { recursive: true })
  const temp = `${p}.${randomUUID()}.part`
  await writeFile(temp, JSON.stringify(v, null, 2))
  await rename(temp, p)
}

export async function targetPath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative) || relative.split('/').some((s) => s === '..' || s === '.' || !s)) throw new Error(`不合法的目标路径: ${relative}`)
  const target = path.resolve(root, relative)
  // Existing parent symlinks must stay inside the actual media directory.
  let parent = path.dirname(target)
  while (!await exists(parent)) parent = path.dirname(parent)
  const resolved = await realpath(parent)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`目标目录越界: ${relative}`)
  if (await exists(target)) {
    const resolvedTarget = await realpath(target)
    if (!resolvedTarget.startsWith(root + path.sep)) throw new Error(`目标文件越界: ${relative}`)
  }
  return target
}

async function download(entry, cache, signal, timeout) {
  const key = sha(entry.url)
  const file = path.join(cache, key)
  const metadata = `${file}.json`
  const valid = async () => {
    try {
      const record = JSON.parse(await readFile(metadata, 'utf8'))
      const bytes = await readFile(file)
      return record.url === entry.url && record.sha256 === sha(bytes) && (!entry.bundle || bytes.subarray(0, 7).toString() === 'UnityFS') && (!entry.sha256 || entry.sha256 === record.sha256) && (!entry.size || entry.size === bytes.length)
    } catch { return false }
  }
  if (!entry.refresh && await valid()) return { file, status: 'cached' }
  if (entry.cachedOnly) throw new Error('缓存不存在或校验失败')
  if (!/^https?:\/\//.test(entry.url)) throw new Error('下载 URL 必须是 HTTP(S)')
  await mkdir(cache, { recursive: true })
  const part = `${file}.${randomUUID()}.part`
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        const response = await fetch(entry.url, { signal: requestSignal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        await pipeline(response.body, createWriteStream(part), { signal: requestSignal })
        const bytes = await readFile(part)
        if (!bytes.length || (entry.size && bytes.length !== entry.size)) throw new Error('下载长度不符')
        const digest = sha(bytes)
        if (entry.sha256 && digest !== entry.sha256) throw new Error('SHA-256 不符')
        if (entry.bundle && bytes.subarray(0, 7).toString() !== 'UnityFS') throw new Error('下载结果不是 UnityFS bundle')
        await rename(part, file)
        await json(metadata, { url: entry.url, sha256: digest, size: bytes.length })
        return { file, status: 'downloaded' }
      } catch (error) {
        if (attempt >= 2 || signal.aborted) throw error
      }
    }
  } finally { await archiveToTmp(part) }
}

async function inventory(root, output, signal, options = {}) {
  const limit = Math.max(1, Number(options.collectLimit) || 100000)
  const patterns = options.collectPatterns || []
  if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== 'string')) throw new Error('collectPatterns 必须是 glob 字符串数组')
  const matchers = patterns.map((pattern) => new RegExp('^' + pattern.split('/').map((part) => part === '**' ? '.*' : part.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('/') + '$'))
  const sampleLimit = Math.max(0, Number(options.collectSampleLimit ?? 10))
  const maxBytes = Math.max(1, Number(options.collectMaxBytes) || 16 * 1024 * 1024)
  const samples = []
  let count = 0
  const rows = []
  async function visit(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      signal.throwIfAborted()
      if (count >= limit) return
      if (entry.isSymbolicLink() || /^(?:save|savedata|userdata)$/i.test(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(full)
      else if (entry.isFile()) {
        const info = await stat(full)
        rows.push({ path: path.relative(root, full), size: info.size, mtime: info.mtime.toISOString() })
        const relative = path.relative(root, full).split(path.sep).join('/')
        if (samples.length < sampleLimit && info.size <= maxBytes && matchers.some((re) => re.test(relative))) {
          const destination = path.join(path.dirname(output), 'samples', relative)
          await mkdir(path.dirname(destination), { recursive: true })
          await writeFile(destination, await readFile(full))
          samples.push(relative)
        }
        count++
      }
    }
  }
  await visit(root)
  await json(output, { root, files: rows, truncated: count >= limit, samples })
  return { count, samples }
}

export async function generateTags(ctx) {
  const options = ctx.script?.options || {}
  if (ctx.type !== 'gal') throw new Error('gal-download 只支持 Gal 媒体')
  if (ctx.scope === 'units' || ctx.selectedUnitIds?.length) throw new Error('gal-download 只支持条目级执行')
  if (!Array.isArray(options.tasks)) throw new Error('tasks 必须是数组')
  if (!ctx.item?.source?.path) throw new Error('条目缺少 source.path')
  const root = await realpath(ctx.item.source.path)
  const mediaRoot = root
  const cache = path.resolve(ctx.cacheDir)
  if (cache === root || cache.startsWith(root + path.sep)) throw new Error('cacheDir 必须在媒体目录外')
  const prefix = safe(options.logPrefix)
  const runId = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const runDir = path.join(cache, 'runs', runId)
  await mkdir(runDir, { recursive: true })
  const logFile = path.join(runDir, 'run.log')
  const logs = [`日志: ${logFile}`, `完整列表: ${path.join(runDir, 'result.json')}`]
  const allLogs = []
  const log = (line) => { if (line) allLogs.push(`[${new Date().toISOString()}] ${line}`) }
  const results = []
  const timeoutMs = Math.max(1000, Number(options.runTimeoutMs) || 1500000)
  if (timeoutMs + 5000 >= (Number(options.scriptTimeoutMs) || 1560000)) throw new Error('scriptTimeoutMs 必须比 runTimeoutMs 多至少 5 秒')
  const signal = AbortSignal.timeout(timeoutMs)
  const lock = path.join(cache, `lock-${sha(root)}`)
  let locked = false
  let changed = false
  const changedRoots = new Set()
  try {
    try { await mkdir(lock); locked = true } catch { throw new Error(`媒体正在同步，或上次进程异常退出留下锁: ${lock}`) }
    await json(path.join(lock, 'owner.json'), { pid: process.pid, runId, root })
    for (const [index, task] of options.tasks.entries()) {
      signal.throwIfAborted()
      const result = { index, game: task?.game, entries: [], status: 'completed' }
      results.push(result)
      try {
        if (!task || task.enabled === false || (task.game && ctx.item?.config?.game?.id !== task.game)) {
          result.status = 'skipped'; result.message = '已禁用或 game.id 不匹配'; continue
        }
        const opts = { ...options, ...task }
        const relativeRoot = task.targetDir ?? ((task.provider || task.game) === 'tsk' ? ctx.item?.config?.resourceRoots?.[0] : '')
        const root = relativeRoot && relativeRoot !== '.' ? await realpath(await targetPath(mediaRoot, relativeRoot)) : mediaRoot
        if (!(await stat(root)).isDirectory()) throw new Error('目标必须是目录')
        const dryRun = options.dryRun === true || task.dryRun === true
        const actions = task.actions || ['collect', 'download', 'extract', 'verify']
        if (!Array.isArray(actions) || actions.some((x) => !['collect', 'plan', 'download', 'extract', 'verify'].includes(x))) throw new Error('actions 不合法')
        const taskDir = path.join(runDir, String(index))
        await mkdir(taskDir, { recursive: true })
        if (actions.includes('collect')) {
          result.inventory = path.join(taskDir, 'inventory.json')
          const collected = await inventory(root, result.inventory, signal, opts)
          result.collected = collected.count
          result.samples = collected.samples
        }
        if (actions.length && actions.every((action) => action === 'collect')) {
          logs.push(`任务 ${index}: 本地采集 ${result.collected} 个文件，${result.inventory}`)
          continue
        }
        let plan
        const statePath = path.join(cache, 'state', `${sha(root)}-${safe(task.provider || task.game)}.json`)
        const state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'))
        const ownedPaths = new Set(Object.values(state).flatMap((s) => (s.files || []).map((f) => f.path)))
        const context = { signal, log }
        if ((task.provider || task.game) === 'tsk') {
          const source = task.source || {}
          const request = { source, root, include: task.include, state, dryRun }
          plan = await nativeTask('plan', request, context)
        } else if (task.provider === 'files') {
          const entries = task.source?.entries || JSON.parse(await readFile(task.source?.path, 'utf8')).entries
          if (!Array.isArray(entries)) throw new Error('files 输入必须包含 entries 数组')
          plan = { entries: entries.map((entry) => ({ ...entry, assets: [{ target: entry.target, kind: 'file' }] })) }
        } else throw new Error(`不支持 provider: ${task.provider || task.game}`)
        if (!Array.isArray(plan.entries)) throw new Error('计划缺少 entries')
        // Validate the whole plan before any requests or writes.
        const targets = new Set()
        const urls = new Set()
        for (const entry of plan.entries) {
          if (typeof entry.url !== 'string') throw new Error('清单缺少 URL')
          if (urls.has(entry.url)) throw new Error(`重复 URL: ${entry.url}`)
          urls.add(entry.url)
          for (const asset of entry.assets || []) {
            await targetPath(root, asset.target)
            if (targets.has(asset.target)) throw new Error(`重复目标文件: ${asset.target}`)
            targets.add(asset.target)
          }
        }
        await json(path.join(taskDir, 'plan.json'), plan)
        result.plan = path.join(taskDir, 'plan.json')
        result.warnings = plan.warnings || []
        const limit = Number(opts.downloadLimit ?? 0)
        if (!Number.isInteger(limit) || limit < 0) throw new Error('downloadLimit 必须是非负整数')
        let used = 0
        const queue = []
        const prepared = []
        for (const planned of [...plan.entries].sort((a, b) => a.url.localeCompare(b.url))) {
          const entry = { ...planned, assets: [] }
          const preserved = []
          for (const asset of planned.assets || []) {
            if (!opts.overwriteExisting && !ownedPaths.has(asset.target) && await exists(await targetPath(root, asset.target))) preserved.push(asset.target)
            else entry.assets.push(asset)
          }
          const fingerprint = sha(JSON.stringify([entry.url, entry.sha256 || '', entry.assets, entry.dependencies || []]))
          const previous = state[fingerprint]
          let unchanged = false
          if (!opts.force && !opts.refreshDownloads && entry.assets?.length && previous && (await Promise.all((previous.files || []).map(async (f) => {
            const target = await targetPath(root, f.path)
            return await exists(target) && sha(await readFile(target)) === f.sha256
          }))).every(Boolean) && previous.files?.length === entry.assets?.length) {
            unchanged = true
          }
          prepared.push({ ...entry, preserved, fingerprint, unchanged })
        }
        const requiredDependencies = new Set(prepared.filter((entry) => entry.assets.length && !entry.unchanged).flatMap((entry) => entry.dependencies || []))
        for (const entry of prepared) {
          const preserved = entry.preserved
          const item = { url: entry.url, assets: entry.assets, preserved, fingerprint: entry.fingerprint, status: 'planned' }
          result.entries.push(item)
          if (!entry.assets.length && !requiredDependencies.has(entry.url)) { item.status = preserved.length ? 'preserved' : 'unneeded'; continue }
          if (entry.unchanged && !requiredDependencies.has(entry.url)) { item.status = 'unchanged'; continue }
          let cached = false
          try { if (!opts.refreshDownloads) { await download({ ...entry, cachedOnly: true }, path.join(cache, 'bundles'), signal, 1000); cached = true } } catch {}
          if (!cached && limit && used >= limit) { item.status = 'limited'; continue }
          if (!cached) used++
          if (dryRun || !actions.some((a) => a === 'download' || a === 'extract')) { item.status = cached ? 'would-use-cache' : 'would-download'; continue }
          if (!actions.includes('download') && !cached) { item.status = 'missing-cache'; continue }
          queue.push({ entry, item })
        }
        const work = async () => {
          while (queue.length) {
            signal.throwIfAborted()
            const { entry, item } = queue.shift()
            try {
              const got = await download({ ...entry, refresh: opts.refreshDownloads, cachedOnly: !actions.includes('download') }, path.join(cache, 'bundles'), signal, Math.max(1000, Number(opts.requestTimeoutMs) || 120000))
              item.cache = got.file; item.status = got.status
            } catch (error) { item.status = 'failed'; item.error = error.message; result.status = 'failed' }
          }
        }
        const workers = await Promise.allSettled(Array.from({ length: Math.min(8, Math.max(1, Math.floor(Number(opts.concurrency) || 2))) }, work))
        if (workers.some((worker) => worker.status === 'rejected')) {
          for (const item of result.entries) if (item.status === 'planned') { item.status = 'failed'; item.error = '运行超时或下载任务中断' }
          result.status = 'failed'
        }
        const plannedByUrl = new Map(plan.entries.map((entry) => [entry.url, entry]))
        const resultByUrl = new Map(result.entries.map((entry) => [entry.url, entry]))
        // Wait for all downloads before extraction: a book or texture can refer to another dependency bundle.
        for (const item of result.entries) {
          if (!actions.includes('extract') || !['downloaded', 'cached'].includes(item.status) || !item.assets.length) continue
          const entry = { ...plannedByUrl.get(item.url), assets: item.assets }
          try {
              const dependencies = []
              let blocked = false
              for (const url of entry.dependencies || []) {
                const dependency = resultByUrl.get(url)
                if (!dependency?.cache) {
                  item.status = dependency?.status === 'failed' ? 'failed' : 'dependency-skipped'
                  item.error = `依赖不可用: ${url} (${dependency?.status || 'missing'})`
                  blocked = true
                  if (item.status === 'failed') result.status = 'failed'
                  break
                }
                dependencies.push(dependency.cache)
              }
              if (blocked) continue
              // Do not replace unrelated existing files without an explicit request.
              for (const asset of entry.assets) {
                const target = await targetPath(root, asset.target)
                const owned = ownedPaths.has(asset.target)
                if (await exists(target) && !owned && !opts.overwriteExisting) throw new Error(`已有未托管文件，保留: ${asset.target}；确认替换时设置 overwriteExisting`)
              }
              const exports = entry.bundle
                ? (await nativeTask('extract', { bundle: item.cache, dependencies, assets: entry.assets }, context)).exports
                : [{ target: entry.assets[0].target, data: await readFile(item.cache) }]
              item.files = []
              for (const exported of exports) {
                signal.throwIfAborted()
                const bytes = Buffer.from(exported.data)
                const target = await targetPath(root, exported.target)
                await mkdir(path.dirname(target), { recursive: true })
                const temp = `${target}.${runId}.part`
                try { await writeFile(temp, bytes); signal.throwIfAborted(); await rename(temp, target) } finally { await archiveToTmp(temp) }
                item.files.push({ path: exported.target, sha256: sha(bytes) })
              }
              changed = true
              changedRoots.add(root)
              changedRoots.add(mediaRoot)
              for (const file of item.files) {
                const bytes = await readFile(await targetPath(root, file.path))
                if (!bytes.length || sha(bytes) !== file.sha256) throw new Error(`写入校验失败: ${file.path}`)
              }
              state[item.fingerprint] = { url: entry.url, files: item.files }
              for (const file of item.files) ownedPaths.add(file.path)
              await json(statePath, state)
              item.status = 'written'
            } catch (error) { item.status = 'failed'; item.error = error.message; result.status = 'failed' }
            log(`${index} ${item.status} ${entry.assets.map((a) => a.target).join(', ')}`)
        }
        if (!dryRun) await json(statePath, state)
        result.dryRun = dryRun
        result.summary = result.entries.reduce((counts, e) => ({ ...counts, [e.status]: (counts[e.status] || 0) + 1 }), {})
        if (!dryRun && result.status !== 'failed' && (plan.unresolved?.length || result.entries.some((e) => ['limited', 'missing-cache', 'dependency-skipped'].includes(e.status)))) result.status = 'partial'
        logs.push(`任务 ${index} (${task.game || task.provider}): ${JSON.stringify(result.summary)}`)
        for (const item of result.entries.slice(0, 30)) logs.push(`${item.status}: ${[...item.assets.map((a) => a.target), ...(item.preserved || []).map((p) => `${p} (保留已有)`)].join(', ')}${item.error ? ` — ${item.error}` : ''}`)
        if (result.entries.length > 30) logs.push(`另 ${result.entries.length - 30} 条见 ${result.plan} / result.json`)
      } catch (error) { result.status = 'failed'; result.error = error.message; logs.push(`任务 ${index} 失败: ${error.message}`) }
    }
    if (changed) {
      // Context caches include root and immediate child mtimes; touching root invalidates deep resource additions.
      const now = new Date()
      for (const root of changedRoots) await utimes(root, now, now)
    }
  } catch (error) { results.push({ status: 'failed', error: error.message }); logs.push(`失败: ${error.message}`) }
  finally {
    try {
      await json(path.join(runDir, 'result.json'), { runId, root, results })
      await writeFile(logFile, [...logs, ...allLogs].join('\n') + '\n')
    } finally { if (locked) await archiveToTmp(lock) }
  }
  // Empty generated tags deliberately bypass the host's same-version tag skip.
  const status = results.some((r) => r.status === 'failed') ? 'failed' : results.some((r) => r.status === 'partial') ? 'partial' : 'completed'
  return { itemTags: [], logs, details: { status, runDir, logFile, results: results.map(({ entries, ...r }) => ({ ...r, entryCount: entries?.length || 0 })) } }
}
