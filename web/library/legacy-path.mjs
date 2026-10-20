// 非 UTF-8 的文件名：磁盘上有些 zip 的文件名是 EUC-JP / Shift-JIS / GBK 的原始字节（LANraragi 的 file 字段原样存着这些字节）。
// 路径当字节处理（Node 的 fs 接受 Buffer 路径），合法 UTF-8 的路径行为完全不变；
// 只有「显示」才需要把字节解成可读的文字：按编码列表严格解码，第一个能完整解出来的就用。

export const DEFAULT_FILENAME_ENCODINGS = ['euc-jp', 'shift_jis', 'gbk']

export function isValidUtf8(buf) {
  return Buffer.compare(Buffer.from(buf.toString('utf8'), 'utf8'), buf) === 0
}

// 严格解码：有任何非法字节就返回 null（EUC-JP 的字节用 Shift-JIS 严格解会失败，反之亦然，所以顺序能把两者分开；
// GBK 的范围很宽，放在最后兜底）
export function decodeStrict(bytes, encodings = DEFAULT_FILENAME_ENCODINGS) {
  for (const encoding of encodings) {
    try {
      return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding }
    } catch {
      // 这个编码解不了，试下一个
    }
  }
  return null
}

// 整条路径按 / 分段显示：合法 UTF-8 的段原样，非法的段按编码列表解；都解不了就用 � 占位（仍然可以用字节访问）
export function displayPath(buf, encodings = DEFAULT_FILENAME_ENCODINGS) {
  const encodingsUsed = new Set()
  let undecodable = false
  const parts = []
  let start = 0
  const pushSegment = (segment) => {
    if (isValidUtf8(segment)) {
      parts.push(segment.toString('utf8'))
      return
    }
    const decoded = decodeStrict(segment, encodings)
    if (decoded) {
      encodingsUsed.add(decoded.encoding)
      parts.push(decoded.text.normalize('NFC'))
    } else {
      undecodable = true
      parts.push(segment.toString('utf8'))
    }
  }
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x2f) {
      pushSegment(buf.subarray(start, i))
      start = i + 1
    }
  }
  return { text: parts.join('/'), encodings: [...encodingsUsed], undecodable }
}

// 最后一段的最后一个扩展名（小写，不含点），没有返回 ''。只认 ASCII 扩展名。
export function extensionOfBytes(buf) {
  const slash = buf.lastIndexOf(0x2f)
  const base = buf.subarray(slash + 1)
  const dot = base.lastIndexOf(0x2e)
  if (dot < 0 || dot === base.length - 1) return ''
  return base.subarray(dot + 1).toString('latin1').toLowerCase()
}

// 按字节替换路径前缀：prefix 必须是完整的目录前缀（后面是 / 或路径结束）
export function mapPathBytes(file, from, to) {
  const prefix = Buffer.from(String(from || '').replace(/\/+$/, ''), 'utf8')
  const target = Buffer.from(String(to || '').replace(/\/+$/, ''), 'utf8')
  if (!prefix.length || file.length < prefix.length) return null
  if (Buffer.compare(file.subarray(0, prefix.length), prefix) !== 0) return null
  const next = file[prefix.length]
  if (file.length > prefix.length && next !== 0x2f) return null
  return Buffer.concat([target, file.subarray(prefix.length)])
}

// LRR 里的标题是不是乱码：没有任何 CJK/假名/谚文，却有 U+0080–U+00FF 的拉丁字符或 U+FFFD
// （EUC-JP / Shift-JIS 的字节被当成 latin-1 字符存进 Redis 的典型样子）
export function looksMojibake(title) {
  const text = String(title || '')
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text)) return false
  const odd = (text.match(/[\u0080-\u00ff\ufffd]/g) || []).length
  return odd >= 2
}

// 标签命名空间映射：LRR 标签 "ns:值" 按第一个冒号拆开，命名空间（不区分大小写）按映射表换名；
// 映射成空字符串 = 去掉命名空间只留值；没命中、没有命名空间的原样保留。结果去重（不区分大小写，保留第一个）。
export function applyTagMap(tags, tagMap = {}) {
  const map = new Map(Object.entries(tagMap || {}).map(([from, to]) => [String(from).trim().toLowerCase(), String(to ?? '').trim()]))
  const seen = new Set()
  const out = []
  for (const tag of tags) {
    let next = tag
    const colon = tag.indexOf(':')
    if (map.size && colon > 0) {
      const namespace = tag.slice(0, colon).trim().toLowerCase()
      if (map.has(namespace)) {
        const target = map.get(namespace)
        const value = tag.slice(colon + 1).trim()
        next = target ? `${target}:${value}` : value
      }
    }
    const key = next.toLowerCase()
    if (!next || seen.has(key)) continue
    seen.add(key)
    out.push(next)
  }
  return out
}
