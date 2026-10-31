// Artemis 引擎的 pf8 档案（.pfs / .pfs.000 …）。依据：自己在采集的真实游戏数据上核对（g13 的 yugamase.pfs / .pfs.000，索引解析后条目数、偏移、大小都吻合；脚本解密后是可读的 Lua 表）。
//   头：'pf8' + u32 索引大小 isz + u32 条目数；索引块 = 文件 [7, 7 + isz)（从条目数字段起）
//   条目：u32 名字长 + 名字（utf-8，\ 分隔） + u32 0 + u32 偏移（从文件头起）+ u32 大小
//   加密：条目内容逐字节 XOR key[i % 20]，i = 条目内的下标，key = SHA1(索引块)（20 字节）
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

const MAX_INDEX = 64 * 1024 * 1024
const MAX_ENTRIES = 2_000_000

// → { size, key（Buffer 20 字节）, entries: [{ name, offset, size }] }；格式不对抛 Error
export async function readPf8Index(file) {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const head = Buffer.alloc(11)
    const { bytesRead } = await handle.read(head, 0, 11, 0)
    if (bytesRead < 11 || head.subarray(0, 3).toString('latin1') !== 'pf8') throw new Error('不是 pf8（魔数不对）')
    const isz = head.readUInt32LE(3)
    const count = head.readUInt32LE(7)
    if (isz < 4 || isz > MAX_INDEX || 7 + isz > size) throw new Error(`pf8 索引大小 ${isz} 不合理（文件 ${size} 字节）`)
    if (count > MAX_ENTRIES || count * 16 > isz) throw new Error(`pf8 条目数 ${count} 与索引大小 ${isz} 对不上`)
    const block = Buffer.alloc(isz)
    let done = 0
    while (done < isz) {
      const r = await handle.read(block, done, isz - done, 7 + done)
      if (!r.bytesRead) throw new Error('pf8 索引读不全')
      done += r.bytesRead
    }
    const key = createHash('sha1').update(block).digest()
    const entries = []
    let p = 4   // block[0..4) = 条目数
    for (let i = 0; i < count; i++) {
      if (p + 4 > block.length) throw new Error(`pf8 第 ${i} 条越过索引末尾`)
      const len = block.readUInt32LE(p)
      if (len <= 0 || len > 1024 || p + 4 + len + 12 > block.length) throw new Error(`pf8 第 ${i} 条的名字长度 ${len} 不合理`)
      const name = block.subarray(p + 4, p + 4 + len).toString('utf8')
      p += 4 + len
      const offset = block.readUInt32LE(p + 4)
      const entrySize = block.readUInt32LE(p + 8)
      p += 12
      if (offset + entrySize > size) throw new Error(`pf8 条目 ${name.slice(0, 40)} 的数据（${offset}+${entrySize}）超出文件 ${size} 字节`)
      entries.push({ name, offset, size: entrySize })
    }
    return { size, key, entries }
  } finally { await handle.close() }
}

export function pf8Decrypt(data, key) {
  const out = Buffer.allocUnsafe(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % 20]
  return out
}
