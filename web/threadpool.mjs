// libuv 线程池大小（Node 里 fs 读写、zlib 压缩、crypto 等异步操作都排在这个池里，默认只有 4 个线程）。
// 几十上百个页面同时拉缩略图 / 静态文件 / 压缩响应时，4 个线程会让这些排队，互相拖慢。
// 大小在配置里（config.json 的 threadPoolSize，默认 16，范围 4~128，改了要重启）；不用环境变量。
// libuv 只在线程池第一次被用到时读 UV_THREADPOOL_SIZE，所以这个文件必须是 server.mjs 里第一个被 import 的模块
// （ESM 的 import 先于模块自己的代码执行；这里只做同步读配置，不碰任何异步 fs / zlib / crypto）。
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const THREAD_POOL_DEFAULT = 16
export const THREAD_POOL_MIN = 4
export const THREAD_POOL_MAX = 128

export function clampThreadPoolSize(value, fallback = THREAD_POOL_DEFAULT) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? Math.max(THREAD_POOL_MIN, Math.min(THREAD_POOL_MAX, n)) : fallback
}

let size = THREAD_POOL_DEFAULT
try {
  const config = JSON.parse(readFileSync(path.join(process.env.DATA_DIR || '/data', 'config.json'), 'utf8'))
  size = clampThreadPoolSize(config?.threadPoolSize)
} catch { /* 没有配置文件：默认值 */ }
process.env.UV_THREADPOOL_SIZE = String(size)
export const threadPoolSize = size
