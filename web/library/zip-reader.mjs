// 够用的 zip 读取：只读中央目录，按需取单个条目。
// 为什么不直接 shell 到 unzip：
//   - 压缩包图集要在「不解压」的前提下拿页数、封面（50 万个包，每个都解压一遍不现实）；
//   - 文件名编码要自己判断（zip 里常是 GBK / Shift-JIS 的裸字节），Node 里拿到的是原始字节，更好处理。
// 支持：存储(0) / deflate(8)，zip64；不支持加密和其它压缩方式（调用方回退到 unar）。

import { open } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const EOCD64_LOCATOR_SIG = 0x07064b50
const EOCD64_SIG = 0x06064b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const MAX_ENTRY_BYTES = 512 * 1024 * 1024

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'jfif', 'jpe'])

// 往返比较判断是不是合法 UTF-8（不能靠有没有 U+FFFD：原文件名里本来就可能有）
function isValidUtf8(buf) {
  return Buffer.compare(Buffer.from(buf.toString('utf8'), 'utf8'), buf) === 0
}

const ENCODING_ALIASES = {
  cp936: 'gbk', gb2312: 'gbk', cp932: 'shift_jis', sjis: 'shift_jis', 'shift-jis': 'shift_jis', eucjp: 'euc-jp', utf8: 'utf-8',
}

export function decodeZipName(nameBuf, flags = 0, fallbackEncoding = 'utf-8') {
  if (flags & 0x800) return nameBuf.toString('utf8')
  if (isValidUtf8(nameBuf)) return nameBuf.toString('utf8')
  const label = ENCODING_ALIASES[String(fallbackEncoding).toLowerCase()] || String(fallbackEncoding).toLowerCase()
  try {
    return new TextDecoder(label).decode(nameBuf)
  } catch {
    return nameBuf.toString('latin1')
  }
}

export function extensionOf(name) {
  const base = String(name).split('/').pop()
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase()
}

// 页面按自然序排：1.jpg < 2.jpg < 10.jpg，路径整体比较
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export function comparePageNames(a, b) {
  return collator.compare(a, b)
}

export async function openZip(filePath, { filenameEncoding = 'utf-8' } = {}) {
  const handle = await open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 22) throw new Error('不是有效的 zip（文件太小）')
    const entries = await readCentralDirectory(handle, size, filenameEncoding)
    return makeZip(handle, entries)
  } catch (error) {
    await handle.close().catch(() => {})
    throw error
  }
}

async function readAt(handle, position, length) {
  const buf = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await handle.read(buf, done, length - done, position + done)
    if (!bytesRead) break
    done += bytesRead
  }
  return done === length ? buf : buf.subarray(0, done)
}

async function readCentralDirectory(handle, size, filenameEncoding) {
  // EOCD 在文件尾部，最多带 64KB 注释
  const tailLength = Math.min(size, 22 + 65535)
  const tail = await readAt(handle, size - tailLength, tailLength)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到目录结尾）')
  let entryCount = tail.readUInt16LE(eocd + 10)
  let cdSize = tail.readUInt32LE(eocd + 12)
  let cdOffset = tail.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locatorPos = eocd - 20
    if (locatorPos >= 0 && tail.readUInt32LE(locatorPos) === EOCD64_LOCATOR_SIG) {
      const eocd64Offset = Number(tail.readBigUInt64LE(locatorPos + 8))
      const head = await readAt(handle, eocd64Offset, 56)
      if (head.length < 56 || head.readUInt32LE(0) !== EOCD64_SIG) throw new Error('zip64 目录结尾损坏')
      entryCount = Number(head.readBigUInt64LE(32))
      cdSize = Number(head.readBigUInt64LE(40))
      cdOffset = Number(head.readBigUInt64LE(48))
    }
  }
  const cd = await readAt(handle, cdOffset, cdSize)
  const entries = []
  let pos = 0
  while (pos + 46 <= cd.length && entries.length < entryCount) {
    if (cd.readUInt32LE(pos) !== CENTRAL_SIG) throw new Error('zip 中央目录损坏')
    const flags = cd.readUInt16LE(pos + 8)
    const method = cd.readUInt16LE(pos + 10)
    let compressedSize = cd.readUInt32LE(pos + 20)
    let uncompressedSize = cd.readUInt32LE(pos + 24)
    const nameLength = cd.readUInt16LE(pos + 28)
    const extraLength = cd.readUInt16LE(pos + 30)
    const commentLength = cd.readUInt16LE(pos + 32)
    let localOffset = cd.readUInt32LE(pos + 42)
    const nameBuf = Buffer.from(cd.subarray(pos + 46, pos + 46 + nameLength))
    // zip64 扩展字段：只有标准字段是 0xffffffff 的才在里面按顺序出现
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let ep = pos + 46 + nameLength
      const end = ep + extraLength
      while (ep + 4 <= end) {
        const id = cd.readUInt16LE(ep)
        const len = cd.readUInt16LE(ep + 2)
        if (id === 0x0001) {
          let o = ep + 4
          if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(cd.readBigUInt64LE(o)); o += 8 }
          if (compressedSize === 0xffffffff) { compressedSize = Number(cd.readBigUInt64LE(o)); o += 8 }
          if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(o)); o += 8 }
          break
        }
        ep += 4 + len
      }
    }
    const name = decodeZipName(nameBuf, flags, filenameEncoding)
    entries.push({
      name,
      nameBuf,
      flags,
      method,
      compressedSize,
      size: uncompressedSize,
      localOffset,
      isDirectory: name.endsWith('/'),
    })
    pos += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function makeZip(handle, entries) {
  return {
    entries,
    // 图片条目，按自然序。目录、隐藏的 __MACOSX 资源叉、非图片都剔掉
    imageEntries() {
      return entries
        .filter((entry) => !entry.isDirectory
          && !entry.name.startsWith('__MACOSX/')
          && !entry.name.split('/').pop().startsWith('._')
          && IMAGE_EXTENSIONS.has(extensionOf(entry.name)))
        .sort((a, b) => comparePageNames(a.name, b.name))
    },
    async read(entry) {
      if (entry.flags & 1) throw new Error('加密的 zip 条目暂不支持')
      if (entry.size > MAX_ENTRY_BYTES) throw new Error(`条目过大：${entry.name}`)
      const local = await readAt(handle, entry.localOffset, 30)
      if (local.length < 30 || local.readUInt32LE(0) !== LOCAL_SIG) throw new Error(`zip 本地头损坏：${entry.name}`)
      const dataStart = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      const raw = await readAt(handle, dataStart, entry.compressedSize)
      if (entry.method === 0) return raw
      if (entry.method === 8) return inflateRawSync(raw)
      throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`)
    },
    close() {
      return handle.close()
    },
  }
}
