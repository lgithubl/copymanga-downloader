// CompressedBG → PNG、Live2D 纹理（KTX / BC7）→ RGBA 的解码放到 worker 线程里做（一张 v2 的大图要 1~4 秒，4096² 的 BC7 要 2 秒，在主线程同步做会卡住所有别的请求）。
//   runCbg(data, { cropHeight }) → Promise<Buffer>；runKtx(data) → Promise<{ width, height, data }>：最多 GAL_DECODE_WORKERS（默认 2）个 worker，排队；worker 起不来 / 崩了就退回主线程同步做
import { Worker } from 'node:worker_threads'
import { cbgToPng } from './bgi.mjs'
import { ktxToRgba } from './l2d-zip.mjs'

const runSync = (task) => (task.kind === 'ktx' ? ktxToRgba(task.data) : cbgToPng(task.data, task.crop ? { cropHeight: task.crop } : {}))

const SIZE = Math.max(0, Number(process.env.GAL_DECODE_WORKERS ?? 2) || 0)
const workers = []   // { worker, busy, task }
const queue = []
let broken = false
let nextId = 1

function spawn() {
  const worker = new Worker(new URL('./decode-worker.mjs', import.meta.url))
  const slot = { worker, task: null }
  worker.on('message', (msg) => {
    const task = slot.task
    slot.task = null
    slot.worker.unref()   // 空闲时不拦着进程退出
    if (task) {
      if (msg.error) task.reject(new Error(msg.error))
      else if (task.kind === 'ktx') task.resolve({ width: msg.width, height: msg.height, data: Buffer.from(msg.out.buffer, msg.out.byteOffset, msg.out.byteLength) })
      else task.resolve(Buffer.from(msg.out.buffer, msg.out.byteOffset, msg.out.byteLength))
    }
    pump()
  })
  const die = (error) => {
    const task = slot.task
    slot.task = null
    const at = workers.indexOf(slot)
    if (at >= 0) workers.splice(at, 1)
    if (task) { try { task.resolve(runSync(task)) } catch (e) { task.reject(e) } }   // 这一张退回主线程做
    if (error) broken = true   // worker 自己出错（起不来）：以后都不用了
    pump()
  }
  worker.on('error', die)
  worker.on('exit', (code) => { if (code !== 0 || slot.task) die(null) })
  worker.unref()
  workers.push(slot)
  return slot
}

function pump() {
  while (queue.length) {
    let slot = workers.find((w) => !w.task)
    if (!slot && workers.length < SIZE && !broken) { try { slot = spawn() } catch { broken = true } }
    if (!slot) break
    const task = queue.shift()
    slot.task = task
    slot.worker.ref()   // 有任务在跑：进程不能退
    slot.worker.postMessage({ id: task.id, kind: task.kind, data: task.data, crop: task.crop })
  }
  if (broken && !workers.length) while (queue.length) { const t = queue.shift(); try { t.resolve(runSync(t)) } catch (e) { t.reject(e) } }
}

export function runCbg(data, { cropHeight = 0 } = {}) {
  if (!SIZE || broken) return Promise.resolve().then(() => cbgToPng(data, cropHeight ? { cropHeight } : {}))
  return new Promise((resolve, reject) => { queue.push({ id: nextId++, kind: 'cbg', data, crop: cropHeight, resolve, reject }); pump() })
}
export function runKtx(data) {
  if (!SIZE || broken) return Promise.resolve().then(() => ktxToRgba(data))
  return new Promise((resolve, reject) => { queue.push({ id: nextId++, kind: 'ktx', data, resolve, reject }); pump() })
}
