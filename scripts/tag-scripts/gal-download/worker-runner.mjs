import { Worker } from 'node:worker_threads'

// Decode locally with Node only. Workers cannot install dependencies or write media files.
export async function nativeTask(operation, request, { signal } = {}) {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { operation, request }, execArgv: [] })
  let abort
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason)
      signal?.addEventListener('abort', abort, { once: true })
      worker.once('message', (message) => message.error ? reject(new Error(message.error)) : resolve(message.result))
      worker.once('error', reject)
      worker.once('exit', (code) => reject(new Error(`解码线程退出: ${code}`)))
      if (signal?.aborted) abort()
    })
  } finally {
    signal?.removeEventListener('abort', abort)
    await worker.terminate()
  }
}
