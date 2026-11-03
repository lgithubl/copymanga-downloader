// decode-pool.mjs 的 worker：收 { id, kind, data, crop } → 回 { id, out } | { id, out, width, height }（ktx）| { id, error }
import { parentPort } from 'node:worker_threads'
import { cbgToPng } from './bgi.mjs'
import { ktxToRgba } from './l2d-zip.mjs'
import { wcgToPng } from './rscript-wcg.mjs'

parentPort.on('message', ({ id, kind, data, crop }) => {
  try {
    if (kind === 'ktx') {
      const { width, height, data: rgba } = ktxToRgba(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
      parentPort.postMessage({ id, width, height, out: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength) })
      return
    }
    if (kind === 'wcg') {
      const png = wcgToPng(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
      parentPort.postMessage({ id, out: new Uint8Array(png.buffer, png.byteOffset, png.byteLength) })
      return
    }
    const out = cbgToPng(Buffer.from(data.buffer, data.byteOffset, data.byteLength), crop ? { cropHeight: crop } : {})
    parentPort.postMessage({ id, out: new Uint8Array(out.buffer, out.byteOffset, out.byteLength) })
  } catch (error) { parentPort.postMessage({ id, error: String(error?.message || error) }) }
})
