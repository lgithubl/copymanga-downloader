// decode-pool.mjs 的 worker：收 { id, data, crop } → 回 { id, out } | { id, error }
import { parentPort } from 'node:worker_threads'
import { cbgToPng } from './bgi.mjs'

parentPort.on('message', ({ id, data, crop }) => {
  try {
    const out = cbgToPng(Buffer.from(data.buffer, data.byteOffset, data.byteLength), crop ? { cropHeight: crop } : {})
    parentPort.postMessage({ id, out: new Uint8Array(out.buffer, out.byteOffset, out.byteLength) })
  } catch (error) { parentPort.postMessage({ id, error: String(error?.message || error) }) }
})
