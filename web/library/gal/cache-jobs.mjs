// One rebuild lane for all Gal indexes. Nested context builds run in the owning
// job rather than queueing behind themselves. This is scheduling, not a worker.
import { AsyncLocalStorage } from 'node:async_hooks'
const scope = new AsyncLocalStorage(),
  pending = new Map(),
  queue = []
let running = null
export const inGalCacheBuild = () => Boolean(scope.getStore()?.active)
export const galCachePhase = (phase) => {
  if (inGalCacheBuild()) scope.getStore().phase?.(phase)
}
export function galCacheQueueStatus() {
  return { concurrency: 1, running: running ? 1 : 0, queued: queue.length }
}
export function queueGalCacheBuild(key, build, { phase } = {}) {
  if (inGalCacheBuild()) return Promise.resolve().then(build)
  if (pending.has(key)) return pending.get(key)
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  pending.set(key, promise)
  queue.push({ key, build, phase, resolve, reject })
  pump()
  return promise
}
function pump() {
  if (running || !queue.length) return
  running = queue.shift()
  const job = running
  const context = { phase: job.phase, active: true }
  setImmediate(() =>
    scope.run(context, async () => {
      try {
        job.resolve(await job.build())
      } catch (error) {
        job.reject(error)
      } finally {
        context.active = false
        pending.delete(job.key)
        running = null
        pump()
      }
    }),
  )
}
