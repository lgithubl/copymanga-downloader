// 友恵の探偵物語（Cyberworks TinkerBell 引擎，tomoe.exe）：容器格式 + 剧本字节码的解码（逆向自真实文件，见 README「友恵の探偵物语」）。
//   Arc00–03（头 16 字节 = 两个 8 位十进制数，每个数字字节 = 数字 ^ 0x7f，0xff = 0：解压后大小 A / 压缩后大小 B；后面是 Okumura LZSS：N=4096 F=18 阈值 2 环初值 0 写指针 4078，标志位 LSB 先，1 = 原样字节，
//     0 = 引用 pos=a|((b&0xf0)<<4)、len=(b&0xf)+2、复制 len+1 个）；Arc03 解压后 = 声音表（每条 27 字节：[u32 len=0x17][u32 id][u32 size][u32 size][u32 offset][u16 type][u32 -1][u8 0]；第 k 条 = 声音 k，数据 = Arc06[offset, offset+size]）
//   Arc06：Ogg Vorbis，前 3615 字节加密（头 4 字节被换成 'Tink'，4..3614 与密钥流异或，密钥 = exe 里的版权字符串，周期 98）
//   Resources/Data00.dat：u32 文件数，每个 Data 文件 3 张表（u32 个数 + 16 字节记录 (解压大小, 存储大小, 偏移, 0)），只有第一张非空；解压大小 = 0 表示没压缩。全局图编号 = 按 Data000, 001, … 顺序连续编
//   图条目（解压后）：第 0 字节 0x61 = 位图（头 33 字节：w@9 h@13 标志@17；0 = BGR 24 位自上而下；7 = Alpha 平面（3 字节 / 像素取第一个）+ BGR；1 = 1 位遮罩（大小@25，LSB 先）+ 遮罩里为 1 的像素的 BGR = 差分 / 抠图补丁），0x62 = JPEG（找 ff d8 ff），0x63 = PNG（头 6 字节）
//   剧本 Arc04.dat（没压缩）：前面是记录流 [u32 长度（含自己）][正文][u32 9999]，正文 = 令牌：M# / M$ / ML + 若干项 N（i32）/ A（u32）/ T（u32 id, u32 n, n 个 UTF-16 单元各异或 n）；后面是对象表 + JS 源，不用
import { deflateSync } from 'node:zlib'

const N = 4096
const F = 18
const THRESHOLD = 2

// Okumura LZSS。outSize 给了就解到够为止
export function lzssDecode(src, outSize = 0) {
  const ring = new Uint8Array(N)
  let r = N - F
  const out = outSize > 0 ? Buffer.alloc(outSize) : []
  let o = 0
  const push = (c) => { if (outSize > 0) out[o] = c; else out.push(c); o += 1; ring[r] = c; r = (r + 1) & (N - 1) }
  let i = 0
  let flags = 0
  while (i < src.length) {
    flags >>= 1
    if (!(flags & 0x100)) {
      flags = src[i++] | 0xff00
      if (i >= src.length) break
    }
    if (flags & 1) push(src[i++])
    else {
      if (i + 1 >= src.length) break
      const a = src[i++]
      const b = src[i++]
      const pos = a | ((b & 0xf0) << 4)
      const len = (b & 0x0f) + THRESHOLD
      for (let k = 0; k <= len; k++) { if (outSize > 0 && o >= outSize) break; push(ring[(pos + k) & (N - 1)]) }
    }
    if (outSize > 0 && o >= outSize) break
  }
  return outSize > 0 ? out.subarray(0, o) : Buffer.from(out)
}

const dec8 = (buf, at) => { let v = 0; for (let i = 0; i < 8; i++) { const c = buf[at + i]; v = v * 10 + (c === 0xff ? 0 : c ^ 0x7f) }; return v }
// Arc0x.dat → 解压后的内容
export function decodeArc(buf) {
  if (buf.length < 16) throw new Error('文件太小，不是 Arc')
  const a = dec8(buf, 0)
  const b = dec8(buf, 8)
  if (!a || !b || 16 + b > buf.length + 8) throw new Error(`头里的大小不合理（${a} / ${b}）`)
  return lzssDecode(buf.subarray(16, 16 + b), a)
}

// Arc03 解压后 → 声音表 [{ id, size, offset }]（第 0 条是视频名，没有声音数据：size 很小时跳过由调用方判断）
export function parseSoundTable(table) {
  const out = []
  let p = 0
  let id = 0
  while (p + 27 <= table.length) {
    if (table.readUInt32LE(p) !== 0x17) break
    const size = table.readUInt32LE(p + 8)
    const offset = table.readUInt32LE(p + 16)
    out.push({ id, size, offset })
    id += 1
    p += 27
  }
  return out
}

// ---- Arc06 的 Ogg 解密 ----
const TINK_STRING = Buffer.concat([Buffer.from('DBB3206F-F171-4885-A131-EC7FBA6FF491 Copyright 2004 Cyberworks "TinkerBell"., all rights reserved.', 'latin1'), Buffer.from([0])])
const TINK_ENCRYPTED = 3615
const tinkKey = (i) => (i < TINK_STRING.length - 1 ? TINK_STRING[i] : TINK_STRING[1 + ((i - 1) % (TINK_STRING.length - 1))])
export function tinkDecrypt(data) {
  const out = Buffer.from(data)
  const end = Math.min(out.length, TINK_ENCRYPTED)
  if (out.length >= 4 && out.toString('latin1', 0, 4) === 'Tink') out.write('OggS', 0, 'latin1')
  for (let i = 4; i < end; i++) out[i] ^= tinkKey(i - 4)
  return out
}

// ---- Data00.dat：图索引 ----
// 返回 [{ file: Data 文件序号, k: 文件内序号, a: 解压大小（0 = 没压缩）, size, offset }]，下标 = 全局图编号
export function parseImageIndex(buf) {
  if (buf.length < 4) throw new Error('Data00.dat 太小')
  const files = buf.readUInt32LE(0)
  if (files < 1 || files > 4096) throw new Error(`Data00.dat 的文件数 ${files} 不合理`)
  let pos = 4
  const out = []
  for (let f = 0; f < files; f++) {
    for (let list = 0; list < 3; list++) {
      if (pos + 4 > buf.length) throw new Error('Data00.dat 被截断')
      const n = buf.readUInt32LE(pos)
      pos += 4
      if (pos + 16 * n > buf.length) throw new Error('Data00.dat 被截断')
      if (list === 0) for (let k = 0; k < n; k++) out.push({ file: f, k, a: buf.readUInt32LE(pos + 16 * k), size: buf.readUInt32LE(pos + 16 * k + 4), offset: buf.readUInt32LE(pos + 16 * k + 8) })
      pos += 16 * n
    }
  }
  return out
}

// 一个图条目（存储的字节）开头的类型：{ type: 'jpg'|'png'|'bmp'|'patch'|'' , w, h }。stored = 条目开头 64 字节左右（没压缩 = 原样，压缩 = LZSS）
export function probeImage(stored, compressed) {
  const head = compressed ? lzssDecode(stored, 64) : stored
  if (!head.length) return { type: '' }
  if (head[0] === 0x62) return { type: 'jpg' }
  if (head[0] === 0x63) return { type: 'png' }
  if (head[0] === 0x61 && head.length >= 21) {
    const flag = head.readUInt32LE(17)
    const w = head.readUInt32LE(9)
    const h = head.readUInt32LE(13)
    if (w < 1 || h < 1 || w > 16384 || h > 16384) return { type: '' }
    return { type: flag === 1 ? 'patch' : flag === 0 || flag === 7 ? 'bmp' : '', w, h, flag }
  }
  return { type: '' }
}

// ---- PNG 编码（只用 zlib） ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }; return t })()
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}
export function encodePng(w, h, pixels, channels) {
  const stride = w * channels
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))])
}

// 位图（0x61）→ { w, h, channels, pixels }
export function decodeBitmap(d) {
  const w = d.readUInt32LE(9)
  const h = d.readUInt32LE(13)
  const flag = d.readUInt32LE(17)
  const n = w * h
  if (n < 1 || n > 64 * 1024 * 1024) throw new Error('位图尺寸不合理')
  if (flag === 0) {
    if (d.length < 33 + n * 3) throw new Error('位图被截断')
    const rgb = Buffer.alloc(n * 3)
    for (let i = 0, s = 33; i < n; i++, s += 3) { rgb[i * 3] = d[s + 2]; rgb[i * 3 + 1] = d[s + 1]; rgb[i * 3 + 2] = d[s] }
    return { w, h, channels: 3, pixels: rgb }
  }
  if (flag === 7) {
    if (d.length < 33 + n * 6) throw new Error('位图被截断')
    const rgba = Buffer.alloc(n * 4)
    const col = 33 + n * 3
    for (let i = 0; i < n; i++) { rgba[i * 4] = d[col + i * 3 + 2]; rgba[i * 4 + 1] = d[col + i * 3 + 1]; rgba[i * 4 + 2] = d[col + i * 3]; rgba[i * 4 + 3] = d[33 + i * 3] }
    return { w, h, channels: 4, pixels: rgba }
  }
  if (flag === 1) {
    const maskSize = d.readUInt32LE(25)
    const colorAt = 33 + maskSize
    if (maskSize < Math.ceil(n / 8) || colorAt > d.length) throw new Error('补丁遮罩被截断')
    const rgba = Buffer.alloc(n * 4)
    let ci = colorAt
    for (let i = 0; i < n; i++) {
      if ((d[33 + (i >> 3)] >> (i & 7)) & 1 && ci + 3 <= d.length) { rgba[i * 4] = d[ci + 2]; rgba[i * 4 + 1] = d[ci + 1]; rgba[i * 4 + 2] = d[ci]; rgba[i * 4 + 3] = 255; ci += 3 }
    }
    return { w, h, channels: 4, pixels: rgba }
  }
  throw new Error(`不认识的位图标志 ${flag}`)
}

// 解压后的图条目 → PNG / JPEG 字节
export function imageToBytes(d) {
  if (d[0] === 0x63) return d.subarray(6)
  if (d[0] === 0x62) { const at = d.indexOf(Buffer.from([0xff, 0xd8, 0xff])); if (at < 0) throw new Error('JPEG 条目里没有 FF D8 FF'); return d.subarray(at) }
  if (d[0] === 0x61) { const bmp = decodeBitmap(d); return encodePng(bmp.w, bmp.h, bmp.pixels, bmp.channels) }
  throw new Error(`不认识的图类型 0x${(d[0] || 0).toString(16)}`)
}
// hit.transform = 'tomoe-img'：data = 存储的字节，hit.a = 解压大小（0 = 没压缩）
export const tomoeImageTransform = (data, hit) => imageToBytes(hit.a ? lzssDecode(data, hit.a) : data)

// ---- 剧本 Arc04.dat ----
// 记录流 → [{ at, items }]；items：{ m: '#'|'$'|'L' | 'T', v: [数字 | 字符串] }
export function parseScriptRecords(buf) {
  const records = []
  let pos = 0
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32LE(pos)
    if (len < 4 || pos + len + 4 > buf.length) break
    if (buf.readUInt32LE(pos + len) !== 9999) break
    records.push({ at: pos, body: buf.subarray(pos + 4, pos + len) })
    pos += len + 4
  }
  return records
}
function readText(b, i) {
  const n = b.readUInt32LE(i + 5)
  if (n > 100000 || i + 9 + 2 * n > b.length) throw new Error('文本令牌越界')
  let s = ''
  for (let k = 0; k < n; k++) s += String.fromCharCode(b.readUInt16LE(i + 9 + 2 * k) ^ (n & 0xffff))
  return { text: s, end: i + 9 + 2 * n }
}
// 一条记录的正文 → { kind: 'T', text } | { kind: '#'|'$'|'L', args: [数字 | 字符串] }
export function parseRecord(body) {
  if (!body.length) return null
  if (body[0] === 0x54) { const t = readText(body, 0); return { kind: 'T', text: t.text } }
  if (body[0] !== 0x4d) return null
  const kind = String.fromCharCode(body[1])
  const args = []
  let i = 2
  while (i < body.length) {
    const t = body[i]
    if (t === 0x4e && i + 5 <= body.length) { args.push(body.readInt32LE(i + 1)); i += 5 }
    else if (t === 0x41 && i + 5 <= body.length) { args.push(body.readUInt32LE(i + 1)); i += 5 }
    else if (t === 0x54 && i + 9 <= body.length) { const x = readText(body, i); args.push(x.text); i = x.end }
    else break
  }
  return { kind, args }
}

// 剧本 → 章节（按 ML 记录切开）→ 每章再按「场景」切成小节。每章 { index, start, events, texts, scenes: [{ index, texts, events }] }
//   events：['T', 文本] | ['#', 操作号, …] | ['$', 操作号, …]（章节的全部事件，没切的）；scenes[i].events 是这一小节的事件，开头带「接上一节的现场」（还在显示的图层 / BGM / 循环音效），所以每一小节单独解析也有对的画面
//   minTexts：文本行少于这个数的块（菜单 / 调试 / 子程序）不要
//   sceneTexts：一小节至少多少行文本才允许在场景切换处切开；sceneMax：超过这么多行之后，任何一次画面切换（不只是换背景层）都切
//   场景切换 = 画面切换（#29）之后紧跟着在背景层（132 / 120 / 127 / 117 / 121 / 9999）上显示一张真正的图（图号 < 816）
const BG_LAYERS = new Set([132, 120, 127, 117, 121, 9999])
const CLEAR_FROM = 816
const CG_LAYERS = new Set([2, 140, 141])   // H 场景的 CG 画在这几层（4 层多是标题 / 字幕）
const CG_MIN_DRAWS = 4                    // 一节里这几层上画了至少这么多张图才算「有 CG」
export function splitChapters(buf, { minTexts = 20, sceneTexts = 80, sceneMax = 300 } = {}) {
  const records = parseScriptRecords(buf)
  const chapters = []
  let cur = null
  const begin = (at) => { cur = { start: at, events: [], texts: 0 }; chapters.push(cur) }
  begin(0)
  records.forEach((rec, idx) => {
    let parsed = null
    try { parsed = parseRecord(rec.body) } catch { parsed = null }
    if (!parsed) return
    if (parsed.kind === 'L') { begin(idx); return }
    if (parsed.kind === 'T') { cur.events.push(['T', parsed.text]); cur.texts += 1 } else cur.events.push([parsed.kind, ...parsed.args])
  })
  const kept = chapters.filter((c) => c.texts >= minTexts)
  kept.forEach((c, i) => { c.index = i; c.scenes = splitScenes(c.events, { sceneTexts, sceneMax }) })
  return { records: records.length, chapters: kept, total: chapters.length }
}

export const splitScenesForTest = (events, opts) => splitScenes(events, opts)   // 自测用
const isDraw = (ev) => ev[0] === '$' && ev[1] === 204
function splitScenes(events, { sceneTexts, sceneMax }) {
  const scenes = []
  let list = []
  let texts = 0
  const live = []          // 各层里还留着的绘制（按时间顺序）：整张图 / 补丁都留着，清空（图号 >= 816）去掉这一层的；#35 只是把层藏起来（visible），内容还在
  const visible = new Set()   // 上一次 #35 之后画过的层
  let bgm = null
  let bgse = null
  const snapshot = () => {
    const out = live.map((ev) => ev.slice())
    for (const layer of new Set(live.map((ev) => Number(ev[6])))) if (!visible.has(layer)) out.push(['#', 35, layer])   // 留着但藏起来的层
    if (bgm !== null) out.push(['#', 131, bgm, -1])
    if (bgse !== null) out.push(['#', 114, bgse])
    return out
  }
  let snapLen = 0   // list 开头「接上一节的现场」的长度（不算这一节自己画的）
  const hasCg = () => list.slice(snapLen).filter((ev) => isDraw(ev) && CG_LAYERS.has(Number(ev[6])) && Number(ev[4]) < CLEAR_FROM).length >= CG_MIN_DRAWS
  const flush = () => { scenes.push({ index: scenes.length, texts, events: list, cg: hasCg() }) }
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev[0] === '#' && ev[1] === 29 && texts >= sceneTexts) {
      let bgDraw = false
      let anyDraw = false
      for (let j = i + 1; j < Math.min(events.length, i + 5); j++) {
        if (!isDraw(events[j])) continue
        anyDraw = true
        if (BG_LAYERS.has(Number(events[j][6])) && Number(events[j][4]) < CLEAR_FROM) bgDraw = true
      }
      if (bgDraw || (texts >= sceneMax && anyDraw)) {
        flush()
        list = snapshot()
        snapLen = list.length
        texts = 0
      }
    }
    list.push(ev)
    if (ev[0] === 'T') texts += 1
    else if (isDraw(ev)) {
      const layer = Number(ev[6])
      if (Number(ev[4]) >= CLEAR_FROM) { for (let k = live.length - 1; k >= 0; k--) if (Number(live[k][6]) === layer) live.splice(k, 1); visible.delete(layer) }
      else {
        live.push(ev)
        visible.add(layer)
        const same = live.filter((x) => Number(x[6]) === layer)
        if (same.length > 200) live.splice(live.indexOf(same[0]), 1)   // 防止无限增长（整张图一般很快把前面的盖掉，这里只管补丁连发）
      }
    } else if (ev[0] === '#' && ev[1] === 35) {   // #35 层：9999 = 全部层藏起来；内容不清
      if (Number(ev[2]) === 9999) visible.clear(); else visible.delete(Number(ev[2]))
    } else if (ev[0] === '#' && ev[1] === 131) bgm = Number(ev[2]) >= 0 ? Number(ev[2]) : null
    else if (ev[0] === '#' && ev[1] === 132) bgm = null   // #132 2000 = BGM 淡出（99 处全是 2000，紧跟换场景；整个剧本 #131 -1 只出现 1 次，游戏靠 #132 停音乐）：之后没有新的 #131 就是没有 BGM
    else if (ev[0] === '#' && ev[1] === 114) bgse = Number(ev[2]) >= 0 ? Number(ev[2]) : null
  }
  flush()
  return scenes
}
