import { parentPort, workerData } from 'node:worker_threads'
import { planTsk, extractTsk } from './tsk.mjs'
try {
  const operation = { plan: planTsk, extract: extractTsk }[workerData.operation]
  if (!operation) throw new Error('未知解码操作')
  parentPort.postMessage({ result: await operation(workerData.request) })
} catch (error) { parentPort.postMessage({ error: error.stack || error.message }) }
