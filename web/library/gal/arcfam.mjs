// 自有 arc 家族（コンフィチュールソフト / シルキーズプラス 等，script.arc / data.arc / image.arc / voice.arc / music.arc / effect.arc …）的档案读取。
// 依据：自己在采集的真实游戏上核对（g06 あざとカワイイ綾瀬ちゃん！ / g10 ギャル×オタ / g11 fuyukuru，共 17 个档案，条目表长度和头里的大小逐字节吻合）。
//   u32 LE 头大小 hs；条目表 = 文件 [4, 4 + hs)；条目 = u8 名字长 + 名字（混淆）+ u32 BE 大小 + u32 BE 原大小 + u32 BE 偏移（从文件头起）。大小 ≠ 原大小 = 压缩（g11 的 script / data；算法没识别，跳过）
//   名字混淆：c' = toupper(c) − 名字长度 + i（i = 字符下标）——不是每个游戏一个 K，而是「K = 这个名字的长度」（用 startup.script（14 个字）、adv_kohai01.script（18 个字）、kirara####.ogg 核对；g11 的 00.BIN 也对）。名字大小写丢失（只剩大写）
import { open } from 'node:fs/promises'

const MAX_HEAD = 64 * 1024 * 1024
const MAX_ENTRIES = 500000
const PRINTABLE = /^[\x20-\x7e]+$/

// raw 名字字节 → 名字（大写）：c = raw + 长度 − 下标
const decodeName = (raw) => {
  let out = ''
  for (let i = 0; i < raw.length; i++) out += String.fromCharCode((raw[i] + raw.length - i) & 0xff)
  return out
}

// → { size, entries: [{ name（大写）, offset, size, origSize }] }；格式不对抛 Error
export async function readArcfamIndex(file) {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 8) throw new Error('文件太小，不是自有 arc')
    const head = Buffer.alloc(4)
    await handle.read(head, 0, 4, 0)
    const hs = head.readUInt32LE(0)
    if (hs < 4 || hs > MAX_HEAD || 4 + hs > size) throw new Error(`自有 arc 头大小 ${hs} 不合理（文件 ${size} 字节）`)
    const table = Buffer.alloc(hs)
    let done = 0
    while (done < hs) {
      const r = await handle.read(table, done, hs - done, 4 + done)
      if (!r.bytesRead) throw new Error('条目表读不全')
      done += r.bytesRead
    }
    const raws = []
    const rows = []
    let p = 0
    while (p < table.length) {
      const n = table[p]
      if (n === 0 || p + 1 + n + 12 > table.length) throw new Error('条目表和头里的大小对不上，不是自有 arc')
      const raw = table.subarray(p + 1, p + 1 + n)
      p += 1 + n
      rows.push({ raw, size: table.readUInt32BE(p), origSize: table.readUInt32BE(p + 4), offset: table.readUInt32BE(p + 8) })
      p += 12
      if (rows.length > MAX_ENTRIES) throw new Error('条目太多')
    }
    if (!rows.length) throw new Error('没有条目')
    const sample = rows.length > 400 ? rows.filter((_, i) => i % Math.ceil(rows.length / 400) === 0) : rows
    const good = sample.filter((r) => PRINTABLE.test(decodeName(r.raw))).length
    if (good < sample.length * 0.8) throw new Error('名字解出来不是可打印字符：不是已知的自有 arc')
    const entries = []
    for (const r of rows) {
      if (r.offset + r.size > size) continue   // 超出文件（被截断 / 损坏）的条目不要
      entries.push({ name: decodeName(r.raw), offset: r.offset, size: r.size, origSize: r.origSize })
    }
    return { size, entries }
  } finally { await handle.close() }
}
