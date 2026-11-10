import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, stat, realpath, utimes } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
// The host versions main.js on upload; version helper imports too, so a running server cannot reuse v1 helpers.
import { nativeTask } from './worker-runner.mjs?v=2.1.0'
import { archiveToTmp } from './archive.mjs?v=2.1.0'
import { createPathInspector, relativeTarget } from './path-inspector.mjs?v=2.1.0'
import { createTaskLog } from './task-log.mjs?v=2.1.0'
import { filterCategories } from './category-filter.mjs?v=2.1.0'
import { TSK_CATEGORIES } from './tsk-categories.mjs?v=2.1.0'

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
  const target = relativeTarget(root, relative)
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

const taskStatus = (entries, unresolved = []) => entries.some((e) => e.status === 'failed') ? 'failed' : unresolved.length || entries.some((e) => ['limited', 'missing-cache', 'dependency-skipped'].includes(e.status)) ? 'partial' : 'completed'

async function sourceStamp(task, root) {
  const provider = task.provider || task.game
  if (!['tsk', 'files'].includes(provider)) throw new Error(`不支持 provider: ${provider}`)
  const source = task.source || {}
  const files = provider === 'tsk' ? (source.type === 'catalog' ? source.paths || [source.path] : [source.path]) : source.entries ? [] : [source.path]
  const sources = []
  for (const filename of files) {
    if (typeof filename !== 'string' || !filename) throw new Error('source 必须指定本地 APK/catalog/清单路径')
    const absolute = await realpath(filename), info = await stat(absolute)
    sources.push({ path: absolute, size: info.size, mtimeMs: info.mtimeMs })
  }
  return sha(JSON.stringify({ root, provider, source, sources, include: task.include || null, skipCategories: [...new Set(task.skipCategories || [])].sort(), categoryPolicy: 1, game: task.game || null, adapters: [...task.adapters].sort() }))
}

async function executeTask(ctx, task, index, timeoutMs) {
  const id = task.id || `task-${index}`
  const rootMedia = await realpath(ctx.item?.source?.path || '')
  const relativeRoot = task.targetDir ?? ((task.provider || task.game) === 'tsk' ? ctx.item?.config?.resourceRoots?.[0] : '')
  const root = relativeRoot && relativeRoot !== '.' ? await realpath(await targetPath(rootMedia, relativeRoot)) : rootMedia
  if (!(await stat(root)).isDirectory()) throw new Error('目标必须是目录')
  const cache = path.resolve(ctx.cacheDir)
  if (cache === rootMedia || cache.startsWith(rootMedia + path.sep)) throw new Error('cacheDir 必须在媒体目录外')
  const dryRun = task.dryRun !== false
  const prefix = safe(task.logPrefix || id)
  const runId = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const runDir = path.join(cache, 'runs', runId)
  const logger = await createTaskLog(runDir, id)
  const signal = AbortSignal.timeout(timeoutMs)
  const planDir = path.join(cache, 'plans', `${sha(root).slice(0, 20)}-${sha(id).slice(0, 12)}`)
  const planPath = path.join(planDir, 'plan.json')
  const logs = [`任务 ${id} 日志: ${logger.logFile}`, `进度: ${logger.progressFile}`, `完整 plan: ${planPath}`]
  const result = { index, id, dryRun, status: 'completed', entries: [], plan: planPath, runDir, logFile: logger.logFile, progressFile: logger.progressFile }
  const report = (line) => { logs.push(line); logger.log(line) }
  const phase = async (name, values = {}) => { signal.throwIfAborted(); await logger.progress(name, values) }
  const lock = path.join(cache, `lock-${sha(rootMedia)}`)
  let locked = false, changed = false
  try {
    await json(path.join(planDir, 'current.json'), { id, runDir, logFile: logger.logFile, progressFile: logger.progressFile, planPath })
    try { await mkdir(lock); locked = true } catch (error) { if (error.code !== 'EEXIST') throw error; throw new Error(`媒体正在同步或有遗留锁: ${lock}`) }
    await json(path.join(lock, 'owner.json'), { pid: process.pid, id, runId })
    const actions = task.actions || ['download', 'extract', 'verify']
    if (!Array.isArray(actions) || actions.some((a) => !['collect', 'plan', 'download', 'extract', 'verify'].includes(a))) throw new Error('actions 不合法')
    if (actions.includes('collect')) {
      await phase('本地采集')
      result.inventory = path.join(runDir, 'inventory.json')
      const inventoryResult = await inventory(root, result.inventory, signal, task)
      result.collected = inventoryResult.count; result.samples = inventoryResult.samples
      report(`采集 ${result.collected} 个文件，样本 ${result.samples.length} 个: ${result.inventory}`)
    }
    if (actions.length && actions.every((a) => a === 'collect')) return { logs, result }
    if (task.skipCategories !== undefined && (!Array.isArray(task.skipCategories) || task.skipCategories.some((c) => typeof c !== 'string' || !c))) throw new Error('skipCategories 必须是分类字符串数组')
    if ((task.provider || task.game) === 'tsk') for (const category of task.skipCategories || []) {
      if (!Object.hasOwn(TSK_CATEGORIES, category)) throw new Error(`未知 TSK 分类 ${category}，可用分类: ${Object.keys(TSK_CATEGORIES).join(', ')}`)
    }
    const stamp = await sourceStamp(task, root)
    let plan
    if (dryRun) {
      await phase('生成 plan：解析 APK / 资源目录')
      if ((task.provider || task.game) === 'tsk') plan = await nativeTask('plan', { source: task.source, include: task.include }, { signal, log: logger.log })
      else {
        const entries = task.source?.entries || JSON.parse(await readFile(task.source.path, 'utf8')).entries
        if (!Array.isArray(entries)) throw new Error('files 输入缺少 entries 数组')
        plan = { entries: entries.map((e) => ({ ...e, assets: [{ target: e.target, kind: 'file', category: e.category ?? 'other' }] })) }
      }
      if (stamp !== await sourceStamp(task, root)) throw new Error('规划期间源文件变化，请重新 dryRun')
      plan = { ...filterCategories(plan, task.skipCategories), schema: 'gal-download-plan/2', taskId: id, root, sourceStamp: stamp, createdAt: new Date().toISOString() }
    } else {
      await phase('读取此 task 已保存的 plan')
      try { plan = JSON.parse(await readFile(planPath, 'utf8')) } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`没有 plan，请先为此 task 执行 dryRun:true: ${planPath}`)
        throw error
      }
      if (plan.schema !== 'gal-download-plan/2' || plan.taskId !== id || plan.root !== root || plan.sourceStamp !== stamp) throw new Error('plan 与 APK/关键配置不一致，请先重新 dryRun:true')
      logger.log(`使用已有 plan: ${planPath}；不再解压 APK、重新生成目录`)
    }
    if (!Array.isArray(plan.entries)) throw new Error('plan 缺少 entries 数组')
    result.warnings = plan.warnings || []
    for (const warning of result.warnings) logger.log(`提示: ${warning}`)
    result.classification = plan.classification || {}
    result.categorySkipped = plan.skippedAssets?.length || 0
    for (const [category, counts] of Object.entries(result.classification)) {
      const label = Object.hasOwn(TSK_CATEGORIES, category) ? TSK_CATEGORIES[category] : ''
      report(`分类 ${category}${label ? `（${label}）` : ''}: 文件 ${counts.total}，保留 ${counts.selected}，skip-category ${counts.skipped}`)
    }
    for (const asset of plan.skippedAssets || []) logger.log(`skip-category [${asset.category}]: ${asset.target}`)
    if (result.categorySkipped) report(`分类跳过 ${result.categorySkipped} 个文件；完整列表见 plan.json.skippedAssets`)
    const inspector = createPathInspector(root, signal)
    const urls = new Set(), targets = new Set(), prepared = []
    const total = plan.entries.reduce((n, e) => n + (e.assets?.length || 0), 0)
    let compared = 0, skipped = 0
    await phase(dryRun ? '对比目录并完善完整 plan' : '执行 plan：检查存在文件并 skip', { compared: 0, total })
    for (const entry of plan.entries) {
      signal.throwIfAborted()
      if (typeof entry.url !== 'string' || !/^https?:\/\//.test(entry.url) || urls.has(entry.url)) throw new Error(`plan URL 无效或重复: ${entry.url}`)
      urls.add(entry.url)
      const assets = [], preserved = []
      for (const asset of entry.assets || []) {
        if (targets.has(asset.target)) throw new Error(`重复目标文件: ${asset.target}`)
        targets.add(asset.target)
        const current = await inspector.inspect(asset.target)
        if (current.exists) { preserved.push(asset.target); skipped++; logger.log(`skip-existing: ${asset.target}`) }
        else assets.push(asset)
        if (++compared % 5000 === 0) await phase('对比目录', { compared, total, skipped, current: asset.target })
      }
      prepared.push({ ...entry, assets, preserved })
    }
    result.preflight = inspector.stats
    report(`目录对比完成: ${compared}/${total}，已存在 skip=${skipped}，读取目录 ${inspector.stats.directoriesRead} 个`)
    if (dryRun) {
      await phase('保存完整 plan（不受 downloadLimit 截断）', { compared, total, skipped })
      await json(planPath, plan)
      report(`已保存完整 plan: ${planPath}`)
    }
    const limit = Number(task.downloadLimit ?? 0)
    if (!Number.isInteger(limit) || limit < 0) throw new Error('downloadLimit 必须是非负整数')
    const required = new Set(prepared.filter((e) => e.assets.length).flatMap((e) => e.dependencies || []))
    const bundleCache = path.join(cache, 'bundles')
    const cacheNames = new Set(await readdir(bundleCache).catch((error) => { if (error.code === 'ENOENT') return []; throw error }))
    const queue = []
    let used = 0, checked = 0
    await phase('检查缓存 / 应用本次下载 limit', { checked: 0, total: prepared.length })
    for (const entry of prepared.sort((a, b) => a.url.localeCompare(b.url))) {
      if (++checked % 1000 === 0) await phase('检查缓存 / 应用本次下载 limit', { checked, total: prepared.length })
      const row = { url: entry.url, files: entry.assets.map((a) => a.target), skipped: entry.preserved, status: 'planned' }
      result.entries.push(row)
      if (!entry.assets.length && !required.has(entry.url)) { row.status = entry.preserved.length ? 'skip-existing' : 'unneeded'; continue }
      const key = sha(entry.url)
      let cached
      if (cacheNames.has(key) && cacheNames.has(`${key}.json`)) try { cached = await download({ ...entry, cachedOnly: true }, bundleCache, signal, 1000) } catch {}
      if (!cached && limit && used >= limit) { row.status = 'limited'; continue }
      if (!cached) used++
      if (dryRun) { row.status = cached ? 'would-use-cache' : 'would-download'; logger.log(`${row.status}: ${entry.url}，缺失文件 ${entry.assets.length} 个`); continue }
      if (!actions.includes('download') && !cached) { row.status = 'missing-cache'; logger.log(`missing-cache: ${entry.url}`); continue }
      queue.push({ entry, row, cached })
    }
    if (!dryRun) {
      let completed = 0
      const selected = queue.length
      await phase('下载 bundle / 读取缓存', { completed, total: selected })
      const work = async () => {
        while (queue.length) {
          signal.throwIfAborted()
          const { entry, row, cached } = queue.shift()
          try {
            logger.log(`下载/读取缓存: ${entry.url}`)
            const got = cached || await download(entry, bundleCache, signal, Math.max(1000, Number(task.requestTimeoutMs) || 120000))
            row.cache = got.file; row.status = got.status
            logger.log(`${row.status}: ${entry.url}`)
          } catch (error) { row.status = 'failed'; row.error = error.message; logger.log(`failed: ${entry.url} ${error.message}`) }
          completed++
          await phase('下载 bundle / 读取缓存', { completed, total: selected, current: entry.url })
        }
      }
      const workers = await Promise.allSettled(Array.from({ length: Math.min(8, Math.max(1, Math.floor(Number(task.concurrency) || 2))) }, work))
      if (workers.some((w) => w.status === 'rejected')) throw new Error('运行超时或下载中断')
      const preparedByUrl = new Map(prepared.map((e) => [e.url, e]))
      const resultsByUrl = new Map(result.entries.map((r) => [r.url, r]))
      for (const row of result.entries) {
        if (!actions.includes('extract') || !row.cache || !row.files.length) continue
        const entry = preparedByUrl.get(row.url)
        try {
          const dependencies = [], remaining = []
          for (const asset of entry.assets) {
            const target = await targetPath(root, asset.target)
            if (await exists(target)) { logger.log(`skip-existing（写入前复查）: ${asset.target}`); row.skipped.push(asset.target) }
            else remaining.push(asset)
          }
          if (!remaining.length) { row.status = 'skip-existing'; continue }
          let blocked = false
          for (const url of entry.dependencies || []) {
            const dependency = resultsByUrl.get(url)
            if (!dependency?.cache) { row.status = dependency?.status === 'failed' ? 'failed' : 'dependency-skipped'; row.error = `依赖不可用: ${url} (${dependency?.status})`; logger.log(`${row.status}: ${row.error}`); blocked = true; break }
            dependencies.push(dependency.cache)
          }
          if (blocked) continue
          await phase('解包 / 校验 / 原子写入', { bundle: row.url, files: remaining.length })
          const exported = entry.bundle ? (await nativeTask('extract', { bundle: row.cache, dependencies, assets: remaining }, { signal, log: logger.log })).exports : [{ target: remaining[0].target, data: await readFile(row.cache) }]
          row.written = []
          for (const file of exported) {
            signal.throwIfAborted()
            const target = await targetPath(root, file.target)
            if (await exists(target)) { row.skipped.push(file.target); logger.log(`skip-existing（写入前复查）: ${file.target}`); continue }
            const bytes = Buffer.from(file.data)
            if (!bytes.length) throw new Error(`导出结果为空: ${file.target}`)
            await mkdir(path.dirname(target), { recursive: true })
            const temp = `${target}.${runId}.part`
            try { await writeFile(temp, bytes); signal.throwIfAborted(); await rename(temp, target) } finally { await archiveToTmp(temp) }
            changed = true
            if (sha(await readFile(target)) !== sha(bytes)) throw new Error(`写入校验失败: ${file.target}`)
            row.written.push(file.target); logger.log(`written: ${file.target}`)
          }
          row.status = row.written.length ? 'written' : 'skip-existing'
        } catch (error) { row.status = 'failed'; row.error = error.message; logger.log(`failed: ${row.url} ${error.message}`) }
      }
    }
    if (changed) { const now = new Date(); await utimes(root, now, now); if (root !== rootMedia) await utimes(rootMedia, now, now) }
    result.summary = result.entries.reduce((counts, e) => ({ ...counts, [e.status]: (counts[e.status] || 0) + 1 }), {})
    result.status = dryRun ? 'completed' : taskStatus(result.entries, plan.unresolved)
    report(`任务 ${id}: ${JSON.stringify(result.summary)}`)
    for (const row of result.entries.slice(0, 30)) report(`${row.status}: ${[...row.files, ...row.skipped.map((f) => `${f} (skip-existing)`)].join(', ')}${row.error ? ` — ${row.error}` : ''}`)
    if (result.entries.length > 30) report(`另 ${result.entries.length - 30} 项见完整 plan / result.json`)
  } catch (error) { result.status = 'failed'; result.error = error.message; report(`任务 ${id} 失败: ${error.message}`) }
  finally {
    try { await json(path.join(runDir, 'result.json'), { runId, root, results: [result] }); await logger.close(result.status, result.summary) }
    finally { if (locked) await archiveToTmp(lock) }
  }
  return { logs, result }
}

export async function generateTags(ctx) {
  const options = ctx.script?.options || {}
  if (ctx.type !== 'gal') throw new Error('gal-download 只支持 Gal 媒体')
  if (ctx.scope === 'units' || ctx.selectedUnitIds?.length) throw new Error('gal-download 只支持条目级执行')
  if (!Array.isArray(options.tasks)) throw new Error('tasks 必须是数组')
  const moved = Object.keys(options).filter((key) => !['tasks', 'scriptTimeoutMs'].includes(key))
  if (moved.length) throw new Error(`${moved.join(', ')} 请移入各 tasks 配置；每个 task 独立管理`)
  const adapters = new Set(ctx.item?.adapters || [])
  const logs = [], tasks = [], results = [], ids = new Set()
  const deadline = Date.now() + (Number(options.scriptTimeoutMs) || 1560000) - 10000
  for (const [index, task] of options.tasks.entries()) { const id = task?.id || `task-${index}`; if (ids.has(id)) throw new Error(`task id 重复: ${id}`); ids.add(id) }
  for (const [index, task] of options.tasks.entries()) {
    const id = task?.id || `task-${index}`
    try {
      if (!task || typeof task !== 'object') throw new Error('task 必须是对象')
      if (task.enabled === false) { tasks.push({ index, id, status: 'skipped', message: '任务已禁用' }); continue }
      if (!Array.isArray(task.adapters) || !task.adapters.length || task.adapters.some((v) => typeof v !== 'string' || !v)) throw new Error('task.adapters 必须显式配置非空数组，例如 ["utage-book"]')
      if (!task.adapters.some((adapter) => adapters.has(adapter)) || (task.game && task.game !== ctx.item?.config?.game?.id)) {
        const message = `skip ${id}：adapters/game 不匹配，当前 adapters=${[...adapters].join(',')}`
        logs.push(message); tasks.push({ index, id, status: 'skipped', message }); continue
      }
      const remaining = deadline - Date.now()
      if (remaining < 1000) throw new Error('宿主任务剩余时间不足，未启动此 task')
      if (!ctx.item?.source?.path) throw new Error('条目缺少 source.path')
      const out = await executeTask(ctx, task, index, Math.max(1000, Math.min(Number(task.runTimeoutMs) || 1500000, remaining)))
      results.push(out.result); logs.push(...out.logs)
      tasks.push({ index, id, status: out.result.status, runDir: out.result.runDir, logFile: out.result.logFile, progressFile: out.result.progressFile, planPath: out.result.plan })
    } catch (error) { tasks.push({ index, id, status: 'failed', error: error.message }); logs.push(`任务 ${id} 失败: ${error.message}`) }
  }
  const status = tasks.some((r) => r.status === 'failed') ? 'failed' : tasks.some((r) => r.status === 'partial') ? 'partial' : 'completed'
  return { itemTags: [], logs, details: { status, runDir: tasks.find((t) => t.runDir)?.runDir, logFile: tasks.find((t) => t.logFile)?.logFile, tasks, results: results.map(({ entries, ...r }) => ({ ...r, entryCount: entries.length })) } }
}
