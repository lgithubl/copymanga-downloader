// 极小的 Redis 客户端（RESP2），只为读 LANraragi 的数据：不引入新的 npm 依赖。
// 支持：AUTH / SELECT、任意命令、管道（一次发一批命令再按顺序收回复）。
// 批量字符串以 Buffer 返回（二进制安全），由调用方决定怎么解码。

import net from 'node:net'

export function parseRedisUrl(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'redis:') throw new Error(`Redis 地址必须是 redis://host:port[/db]：${url}`)
  return {
    host: parsed.hostname || '127.0.0.1',
    port: Number(parsed.port) || 6379,
    password: decodeURIComponent(parsed.password || ''),
    db: Number(String(parsed.pathname || '').replace('/', '')) || 0,
  }
}

function encodeCommand(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`)]
  for (const arg of args) {
    const buf = Buffer.isBuffer(arg) ? arg : Buffer.from(String(arg))
    parts.push(Buffer.from(`$${buf.length}\r\n`), buf, Buffer.from('\r\n'))
  }
  return Buffer.concat(parts)
}

// 从 buf 的 pos 开始解析一个回复；数据不够返回 null
function parseReply(buf, pos) {
  if (pos >= buf.length) return null
  const type = String.fromCharCode(buf[pos])
  const lineEnd = buf.indexOf('\r\n', pos)
  if (lineEnd < 0) return null
  const line = buf.toString('utf8', pos + 1, lineEnd)
  const next = lineEnd + 2
  if (type === '+') return { value: line, next }
  if (type === '-') return { value: new Error(line), next }
  if (type === ':') return { value: Number(line), next }
  if (type === '$') {
    const length = Number(line)
    if (length < 0) return { value: null, next }
    if (buf.length < next + length + 2) return null
    return { value: Buffer.from(buf.subarray(next, next + length)), next: next + length + 2 }
  }
  if (type === '*') {
    const count = Number(line)
    if (count < 0) return { value: null, next }
    const items = []
    let cursor = next
    for (let i = 0; i < count; i++) {
      const item = parseReply(buf, cursor)
      if (!item) return null
      items.push(item.value)
      cursor = item.next
    }
    return { value: items, next: cursor }
  }
  throw new Error(`无法识别的 Redis 回复：${type}`)
}

export class RespClient {
  constructor(options) {
    this.options = options
    this.socket = null
    this.buffer = Buffer.alloc(0)
    this.waiting = []   // { resolve, reject, remaining, replies }
    this.closed = false
  }

  static async connect(url, { timeoutMs = 10000 } = {}) {
    const client = new RespClient(parseRedisUrl(url))
    await client.open(timeoutMs)
    if (client.options.password) await client.command('AUTH', client.options.password)
    if (client.options.db) await client.command('SELECT', client.options.db)
    return client
  }

  open(timeoutMs) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.options.host, port: this.options.port })
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`连接 Redis 超时：${this.options.host}:${this.options.port}`))
      }, timeoutMs)
      socket.once('connect', () => {
        clearTimeout(timer)
        socket.setNoDelay(true)
        this.socket = socket
        resolve()
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`连接 Redis 失败（${this.options.host}:${this.options.port}）：${error.message}`))
      })
      socket.on('data', (chunk) => this.onData(chunk))
      socket.on('close', () => {
        this.closed = true
        for (const entry of this.waiting.splice(0)) entry.reject(new Error('Redis 连接已断开'))
      })
    })
  }

  onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    let pos = 0
    while (this.waiting.length) {
      const parsed = parseReply(this.buffer, pos)
      if (!parsed) break
      pos = parsed.next
      const entry = this.waiting[0]
      entry.replies.push(parsed.value)
      if (entry.replies.length >= entry.remaining) {
        this.waiting.shift()
        entry.resolve(entry.replies)
      }
    }
    this.buffer = pos ? this.buffer.subarray(pos) : this.buffer
  }

  // commands: [[ 'HGETALL', key ], ...]；返回等长的回复数组（出错的位置是 Error 对象）
  pipeline(commands) {
    if (this.closed) return Promise.reject(new Error('Redis 连接已断开'))
    if (!commands.length) return Promise.resolve([])
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject, remaining: commands.length, replies: [] })
      this.socket.write(Buffer.concat(commands.map(encodeCommand)))
    })
  }

  async command(...args) {
    const [reply] = await this.pipeline([args])
    if (reply instanceof Error) throw reply
    return reply
  }

  close() {
    this.socket?.destroy()
  }
}

// HGETALL 的回复 [k1, v1, k2, v2 ...] → { k1: Buffer, ... }
export function pairsToObject(reply) {
  const out = {}
  if (!Array.isArray(reply)) return out
  for (let i = 0; i + 1 < reply.length; i += 2) out[reply[i].toString('utf8')] = reply[i + 1]
  return out
}
