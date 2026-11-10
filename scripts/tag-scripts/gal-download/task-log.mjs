import { mkdir, writeFile, appendFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export async function createTaskLog(directory, id) {
  await mkdir(directory, { recursive: true })
  const logFile = path.join(directory, 'run.log'), progressFile = path.join(directory, 'progress.json')
  await writeFile(logFile, `[${new Date().toISOString()}] task=${id} 启动\n日志: ${logFile}\n进度: ${progressFile}\n`)
  console.info(`[gal-download] task=${id} 日志: ${logFile}`)
  let queue = Promise.resolve(), pending = [], scheduled = false, error
  let phase = '启动', counters = {}, closed = false
  const started = Date.now()
  const enqueue = (operation) => { queue = queue.then(operation).catch((e) => { error ||= e }); return queue }
  const flush = () => {
    if (pending.length) { const text = pending.join(''); pending = []; enqueue(() => appendFile(logFile, text)) }
    return queue
  }
  const log = (message) => {
    pending.push(`[${new Date().toISOString()}] ${message}\n`)
    if (pending.length >= 256) flush()
    else if (!scheduled) { scheduled = true; setImmediate(() => { scheduled = false; flush() }) }
  }
  const progress = async (name, values = {}, heartbeat = false) => {
    phase = name; counters = values
    log(`${heartbeat ? '进行中' : '阶段'}: ${name} ${JSON.stringify(values)}`)
    flush()
    const snapshot = { taskId: id, phase, ...values, elapsedMs: Date.now() - started, updatedAt: new Date().toISOString(), logFile }
    await enqueue(async () => {
      const temp = `${progressFile}.${randomUUID()}.part`
      await writeFile(temp, JSON.stringify(snapshot)); await rename(temp, progressFile)
    })
    if (error) throw error
  }
  const timer = setInterval(() => { if (!closed) void progress(phase, counters, true).catch((e) => { error ||= e }) }, 5000)
  timer.unref()
  return {
    logFile, progressFile, log, progress,
    async close(status, summary) {
      closed = true; clearInterval(timer)
      await progress('结束', { status, summary })
      await flush()
      if (error) throw error
    }
  }
}
