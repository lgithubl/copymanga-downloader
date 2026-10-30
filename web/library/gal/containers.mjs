// 容器（打包格式）读取：服务端自己读 .arc，把里面的剧情脚本 / 图片 / 音频展开到媒体目录下的一个缓存目录（config.containers.dir，默认 arc/），
// 之后引擎、适配器、资源解析都按普通文件工作（不用用户在本机解包）。
//   arc/script/<容器名>/<脚本名>.<scriptExt>     脚本：二进制脚本按 config.containers.scriptDecoder 解成 JSON 文本（适配器吃文本）
//   arc/res/<容器名>/<条目名>                      图片 / 音频 / 视频：原样
//   arc/res/<容器名>/<条目名>.pna/{index.json,<帧序号>.png}   PNA 动画包：按帧拆成 PNG + 一份帧索引（位置 / 尺寸）
//   arc/.stamp.json                                每个容器的 大小 + mtime + 规则指纹：没变就不重新展开
// 什么容器、哪些条目要展开，全部由 config.containers 控制（rules：容器名正则 → skip / kinds / include / exclude / pna），见 config.mjs。
// WillPlus ARC（见 advhd-willplus/ARC_FORMAT.md）：u32 条目数、u32 目录大小、条目 { u32 大小, u32 相对偏移, UTF-16LE 名字 + NUL }，数据在 8 + 目录大小 + 相对偏移；不加密。
// 容器是外来的二进制：所有长度 / 偏移都要对着文件大小校验，条目名只认安全的相对路径，展开的数量 / 总大小有上限。
import { createHash } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decodeWs2, ror2 } from './adapters/advhd-ws2-decode.mjs'
import { compileSafeRegex } from './voice.mjs'

// 展开结果的格式版本（进缓存签名）：脚本解码器 / index.json / 文件命名一变就加一，否则已展开过的游戏会一直用旧结果（2→3：解码器改成引擎自己的操作数表、PNA 帧按序号命名并带 kind / alpha；3→4：展开方式 mode（hybrid / files）进签名）
export const CONTAINER_FORMAT_VERSION = 4
const MAX_DIR_BYTES = 64 * 1024 * 1024
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024
const MAX_NAME_CHARS = 200
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'])
const AUDIO_EXTS = new Set(['ogg', 'flac', 'wav', 'mp3', 'opus', 'm4a'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'm4v', 'mov'])
const SCRIPT_EXTS = new Set(['ws2'])

// 脚本解码器：id → { ext 的默认值, decode(buffer, { arc, name }) → 文本 }
export const SCRIPT_DECODERS = Object.freeze({
  'advhd-ws2': {
    ext: 'advhd',
    decode(buffer, { arc, name }) {
      const ins = decodeWs2(ror2(buffer), { tolerant: true })
      const rows = ins.map((i) => JSON.stringify(i.choices ? [i.at, i.name, i.args, i.choices] : [i.at, i.name, i.args]))
      return `{"format":"advhd-ws2/1","arc":${JSON.stringify(arc)},"name":${JSON.stringify(name)},"size":${buffer.length}${ins.truncated ? `,"truncated":${JSON.stringify(ins.truncated)}` : ''},"ins":[\n${rows.join(',\n')}\n]}\n`
    },
    // 画廊页（一长串 ExecuteFunction openCgBrowser(图)）按图名前缀拆成几组：组名 = 第一张图的名字（无扩展名）去掉 group 正则（默认末尾 _数字）之后的部分；
    // 每组一个脚本文件（只留这一组的 openCgBrowser 和它们前面的页码标记，适配器按画廊读，见 advhd-ws2.mjs 的 data.gallery）。不是画廊页（调用不够 minCalls）= 不拆
    split(buffer, { arc, name }, gallery) {
      const ins = decodeWs2(ror2(buffer), { tolerant: true })
      const fns = new Set(gallery.functions)
      const isCall = (i) => i.name === 'ExecuteFunction' && fns.has(String(i.args[0]))
      if (ins.filter(isCall).length < gallery.minCalls) return []
      const re = compileSafeRegex(gallery.group, { flags: 'i', label: 'containers.rules.gallery.group' })
      const flags = new Set(gallery.pageFlags)
      const groups = new Map()
      let marker = null
      let markerUsed = null
      for (const i of ins) {
        if (i.name === 'Condition' && i.args.length >= 5 && i.args[0] === 130 && flags.has(i.args[1])) { marker = i; continue }
        if (!isCall(i)) continue
        const first = String(i.args[1] || '').replace(/\\/g, '/').split('/').filter(Boolean)[0] || ''
        const stem = first.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
        const key = (re ? stem.replace(re, '') : stem).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '') || 'other'
        if (!groups.has(key)) groups.set(key, [])
        const rows = groups.get(key)
        if (marker && markerUsed !== marker) rows.push(marker)
        markerUsed = marker
        rows.push(i)
      }
      const rowOf = (i) => JSON.stringify([i.at, i.name, i.args])
      return [...groups].map(([key, list]) => ({ name: key, text: `{"format":"advhd-ws2/1","arc":${JSON.stringify(arc)},"name":${JSON.stringify(`${name}/${key}`)},"size":${buffer.length},"gallery":${JSON.stringify({ group: key })},"ins":[\n${[...new Set(list)].map(rowOf).join(',\n')}\n]}\n` }))
    },
  },
})
export const SCRIPT_DECODER_IDS = Object.freeze(Object.keys(SCRIPT_DECODERS))

// ---------- ARC 读取 ----------
// 返回 { size, entries: [{ name, offset, size }] }；格式不对抛 Error（带原因）
export async function readArcIndex(file) {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 8) throw new Error('文件太小，不是 ARC')
    const head = Buffer.alloc(8)
    await handle.read(head, 0, 8, 0)
    const count = head.readUInt32LE(0)
    const dirSize = head.readUInt32LE(4)
    if (dirSize > MAX_DIR_BYTES || 8 + dirSize > size) throw new Error(`目录大小 ${dirSize} 不合理（文件 ${size} 字节），不是 ARC`)
    if (count > dirSize / 10) throw new Error(`条目数 ${count} 与目录大小 ${dirSize} 对不上，不是 ARC`)   // 每条至少 10 字节（8 + NUL 的一个字符）
    const dir = Buffer.alloc(dirSize)
    await handle.read(dir, 0, dirSize, 8)
    const entries = []
    let p = 0
    for (let i = 0; i < count; i++) {
      if (p + 8 > dir.length) throw new Error(`第 ${i} 条的记录越过目录末尾`)
      const entrySize = dir.readUInt32LE(p)
      const rel = dir.readUInt32LE(p + 4)
      let end = p + 8
      while (end + 1 < dir.length && !(dir[end] === 0 && dir[end + 1] === 0)) end += 2
      if (end + 1 >= dir.length) throw new Error(`第 ${i} 条的名字没有结束符`)
      const name = dir.subarray(p + 8, end).toString('utf16le')
      p = end + 2
      const offset = 8 + dirSize + rel
      if (offset + entrySize > size) throw new Error(`条目 ${name.slice(0, 40)} 的数据（${offset}+${entrySize}）超出文件 ${size} 字节`)
      entries.push({ name, offset, size: entrySize })
    }
    return { size, entries }
  } finally { await handle.close() }
}

async function readRange(handle, offset, size) {
  const buffer = Buffer.alloc(size)
  let done = 0
  while (done < size) {
    const { bytesRead } = await handle.read(buffer, done, size - done, offset + done)
    if (!bytesRead) throw new Error('读到文件末尾了，数据不完整')
    done += bytesRead
  }
  return buffer
}

// ---------- PNA（WillPlus 动画包）----------
// 头：魔数（PNAP / PNAS / WPAP / WPAS）+ u32 + 宽 + 高 + 帧数；每帧 40 字节 { u32 type, i32 id, i32 x, i32 y, u32 w, u32 h, u32 ?, f64 scale, u32 size }，帧的 PNG 数据按顺序紧接在索引后面（size = 0 的帧没有图）。
// type 0 = 图片帧，1 / 2 = 组的开始 / 结束标记（没有图）——类型含义来自样本（SysGraphic 的 UI 包）观察，立绘包没有样本。
const PNA_MAGICS = new Set(['PNAP', 'PNAS', 'WPAP', 'WPAS'])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export function parsePna(buffer) {
  if (buffer.length < 20 || !PNA_MAGICS.has(buffer.subarray(0, 4).toString('latin1'))) throw new Error('不是 PNA（魔数不对）')
  const width = buffer.readUInt32LE(8)
  const height = buffer.readUInt32LE(12)
  const count = buffer.readUInt32LE(16)
  if (count > 100000 || 20 + count * 40 > buffer.length) throw new Error(`PNA 帧数 ${count} 不合理`)
  const frames = []
  let pos = 20 + count * 40
  for (let i = 0; i < count; i++) {
    const r = 20 + i * 40
    const frame = { mode: buffer.readUInt32LE(r + 24), type: buffer.readUInt32LE(r), id: buffer.readInt32LE(r + 4), x: buffer.readInt32LE(r + 8), y: buffer.readInt32LE(r + 12), w: buffer.readUInt32LE(r + 16), h: buffer.readUInt32LE(r + 20), scale: buffer.readDoubleLE(r + 28), size: buffer.readUInt32LE(r + 36) }
    if (pos + frame.size > buffer.length) throw new Error(`PNA 第 ${i} 帧的数据超出文件`)
    frame.data = buffer.subarray(pos, pos + frame.size)
    pos += frame.size
    frames.push(frame)
  }
  return { magic: buffer.subarray(0, 4).toString('latin1'), width, height, frames }
}

// ---------- 名字 / 路径 ----------
const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(name); return m ? m[1].toLowerCase() : '' }
const safeEntryName = (raw) => {
  const name = String(raw).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!name || name.length > MAX_NAME_CHARS || /[\0-\x1f]/.test(name)) return ''
  const parts = name.split('/')
  if (parts.length > 6 || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || /[|#]/.test(part))) return ''
  return name
}
const withoutExt = (name) => name.replace(/\.[^./]+$/, '')

// ---------- 规则 ----------
function compileRules(cfg) {
  return (cfg.rules || []).map((rule) => ({
    re: compileSafeRegex(rule.match, { flags: 'i', label: 'containers.rules.match' }),
    skip: rule.skip === true,
    kinds: new Set(rule.kinds?.length ? rule.kinds : ['script', 'res', 'pna']),
    include: (rule.include || []).map((s) => compileSafeRegex(s, { flags: 'i', label: 'containers.rules.include' })).filter(Boolean),
    exclude: (rule.exclude || []).map((s) => compileSafeRegex(s, { flags: 'i', label: 'containers.rules.exclude' })).filter(Boolean),
    pna: rule.pna || 'frames',
    gallery: rule.gallery || null,
  }))
}
const fingerprint = (cfg) => createHash('sha1').update(JSON.stringify([CONTAINER_FORMAT_VERSION, cfg.rules, cfg.scriptDecoder, cfg.scriptExt, cfg.dir, cfg.mode || 'hybrid', cfg.maxEntries, cfg.maxTotalMB])).digest('hex').slice(0, 16)
const kindOf = (name, scriptKinds) => {
  const ext = extOf(name)
  if (SCRIPT_EXTS.has(ext)) return scriptKinds
  if (ext === 'pna') return 'pna'
  if (IMAGE_EXTS.has(ext) || AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return 'res'
  return ''
}

// PNA 的一帧在 index.json 里的一行（两种展开方式共用）：png = 数据是 PNG；magic = 非 PNG 数据的开头 8 字节（十六进制）
function frameRow(i, f, { png, magic }) {
  const row = { n: i, type: f.type, id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, scale: f.scale, alpha: f.scale, ...(f.mode ? { mode: f.mode } : {}) }   // alpha = 记录里的 f64（引擎里是图层 +0x48，着色器的 alpha；以前叫 scale）；mode = 第 7 个 u32（3 / 8 / 10 / 0x15 = 特殊图层，其余 0）
  row.kind = f.type === 1 || f.type === 2 ? 'group' : f.size > 0 ? (png ? 'image' : 'unsupported') : 'empty'   // group = 组开始 / 结束标记；empty = 没有图像数据；unsupported = 有数据但不是 PNG
  if (f.size > 0 && png) row.file = `${i}.png`   // 按帧的序号（文件里的顺序）命名：DisplayCharacterImage 用的是这个序号（引擎里是数组下标，FUN_140115930），不是记录里的 id 字段
  else if (f.size > 0) { row.unsupported = true; row.magic = magic; row.size = f.size }
  return row
}
// 只读 PNA 的头、记录表和每帧开头 8 字节（不读像素数据）：hybrid 方式用它写 index.json、建虚拟索引。返回 { magic, width, height, frames: [{ ...记录, pos（帧数据在 .arc 里的绝对偏移）, png, magic }] }
async function readPnaLayout(handle, offset, size) {
  if (size < 20) throw new Error('PNA 太小')
  const head = await readRange(handle, offset, 20)
  const magic = head.subarray(0, 4).toString('latin1')
  if (!PNA_MAGICS.has(magic)) throw new Error('不是 PNA（魔数不对）')
  const count = head.readUInt32LE(16)
  if (count > 100000 || 20 + count * 40 > size) throw new Error(`PNA 帧数 ${count} 不合理`)
  const recs = await readRange(handle, offset + 20, count * 40)
  const frames = []
  let pos = 20 + count * 40
  for (let i = 0; i < count; i++) {
    const r = i * 40
    const f = { mode: recs.readUInt32LE(r + 24), type: recs.readUInt32LE(r), id: recs.readInt32LE(r + 4), x: recs.readInt32LE(r + 8), y: recs.readInt32LE(r + 12), w: recs.readUInt32LE(r + 16), h: recs.readUInt32LE(r + 20), scale: recs.readDoubleLE(r + 28), size: recs.readUInt32LE(r + 36) }
    if (pos + f.size > size) throw new Error(`PNA 第 ${i} 帧的数据超出文件`)
    f.pos = offset + pos
    pos += f.size
    if (f.size >= 8) { const m = await readRange(handle, f.pos, 8); f.png = m.equals(PNG_MAGIC); f.magic = m.toString('hex') } else { f.png = false; f.magic = '' }
    frames.push(f)
  }
  return { magic, width: head.readUInt32LE(8), height: head.readUInt32LE(12), frames }
}
const pnaIndexJson = (layout) => JSON.stringify({ magic: layout.magic, width: layout.width, height: layout.height, frames: layout.frames.map((f, i) => frameRow(i, f, { png: f.png, magic: f.magic })) })

// ---------- 展开一个容器 ----------
async function expandArc({ file, arcName, rule, cfg, outRoot, budget }) {
  const { entries } = await readArcIndex(file)
  const stem = withoutExt(arcName)
  const decoder = SCRIPT_DECODERS[cfg.scriptDecoder]
  const result = { entries: entries.length, scripts: 0, res: 0, pna: 0, pnaFrames: 0, skipped: 0, excluded: 0, bad: [], truncatedScripts: 0 }
  if (entries.length > cfg.maxEntries) throw new Error(`条目 ${entries.length} 个，超过上限 ${cfg.maxEntries}（config.containers.maxEntries）`)
  const handle = await open(file, 'r')
  try {
    for (const entry of entries) {
      const name = safeEntryName(entry.name)
      if (!name) { result.bad.push(entry.name.slice(0, 60)); continue }
      const kind = kindOf(name, 'script')
      if (!kind || !rule.kinds.has(kind) || (kind === 'pna' && rule.pna === 'skip')) { result.skipped += 1; continue }
      if ((rule.include.length && !rule.include.some((re) => re.test(name))) || rule.exclude.some((re) => re.test(name))) { result.excluded += 1; continue }
      if (entry.size > MAX_ENTRY_BYTES) { result.bad.push(`${name}（${entry.size} 字节太大）`); continue }
      // hybrid（默认）：图 / 声音 / 视频 / PNA 帧不展开（被请求时才从 .arc 读那一个条目，见 materialize）；PNA 只写 index.json（读头和记录表，不读像素）
      const lazy = cfg.mode !== 'files' && (kind === 'res' || kind === 'pna')
      if (lazy && (kind === 'res' || rule.pna === 'raw')) { result.res += 1; result.lazy = (result.lazy || 0) + 1; continue }
      if (lazy) {
        try {
          const layout = await readPnaLayout(handle, entry.offset, entry.size)
          const dir = path.join(outRoot, 'res', stem, ...name.split('/'))
          await mkdir(dir, { recursive: true })
          await writeFile(path.join(dir, 'index.json'), pnaIndexJson(layout))
          result.pna += 1
          result.pnaFrames += layout.frames.filter((f) => f.png).length
          result.lazy = (result.lazy || 0) + 1
        } catch (error) { result.bad.push(`${name}（${error.message}）`) }
        continue
      }
      budget.bytes += entry.size
      if (budget.bytes > budget.limit) throw new Error(`展开的总大小超过上限 ${cfg.maxTotalMB} MB（config.containers.maxTotalMB）`)
      const data = await readRange(handle, entry.offset, entry.size)
      if (kind === 'script') {
        if (!decoder) throw new Error(`没有脚本解码器 ${cfg.scriptDecoder}`)
        const base = withoutExt(name)
        const text = decoder.decode(data, { arc: stem, name: base })
        const target = path.join(outRoot, 'script', stem, ...`${base}.${cfg.scriptExt || decoder.ext}`.split('/'))
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, text)
        result.scripts += 1
        if (rule.gallery && decoder.split) {
          const parts = decoder.split(data, { arc: stem, name: base }, rule.gallery)
          for (const part of parts.slice(0, 2000)) {
            const partTarget = path.join(outRoot, 'script', stem, ...`${base}/${part.name}.${cfg.scriptExt || decoder.ext}`.split('/'))
            await mkdir(path.dirname(partTarget), { recursive: true })
            await writeFile(partTarget, part.text)
            result.scripts += 1
          }
          if (parts.length) result.galleryGroups = (result.galleryGroups || 0) + parts.length
        }
        if (text.includes('"truncated"')) result.truncatedScripts += 1
      } else if (kind === 'pna' && rule.pna !== 'raw') {
        const dir = path.join(outRoot, 'res', stem, ...name.split('/'))
        try {
          const pna = parsePna(data)
          await mkdir(dir, { recursive: true })
          const index = { magic: pna.magic, width: pna.width, height: pna.height, frames: [] }
          for (const [i, frame] of pna.frames.entries()) {
            const png = frame.size > 0 && frame.data.subarray(0, 8).equals(PNG_MAGIC)
            const row = frameRow(i, frame, { png, magic: frame.data.subarray(0, 8).toString('hex') })
            if (png) { await writeFile(path.join(dir, row.file), frame.data); result.pnaFrames += 1 } else if (frame.size > 0) await writeFile(path.join(dir, `${i}.bin`), frame.data)   // 非 PNG（样本里没见过）：原样写成 <序号>.bin
            index.frames.push(row)
          }
          await writeFile(path.join(dir, 'index.json'), JSON.stringify(index))
          result.pna += 1
        } catch (error) { result.bad.push(`${name}（${error.message}）`) }
      } else {
        const target = path.join(outRoot, 'res', stem, ...name.split('/'))
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, data)
        result.res += 1
      }
    }
  } finally { await handle.close() }
  return result
}

// ---------- hybrid：虚拟索引 + 按需取出 ----------
// 虚拟索引 = 没展开的资源（图 / 声音 / 视频 / PNA 帧）的「相对媒体目录的路径 → .arc 里的位置」：每个 .arc 只读目录（和 PNA 的头），内存里放几万条也就几 MB。
// 按 .arc 的 大小 + mtime 判断要不要重建；适配器的文件索引（context.mjs）把它的路径当成「磁盘上有这些文件」，资源接口（types/gal.mjs 的 resolveAsset）取到时先 materialize 再按普通文件走。
const virtuals = new Map()   // mediaDir|dir|指纹 → { sig, value: { map: Map(小写路径 → { rel, file, offset, size }), files: [rel], sig } } | Promise
const materializing = new Map()   // 目标文件 → Promise（同一个文件同时只取一次）
const isHybrid = (cfg) => Boolean(cfg?.enabled) && cfg.mode !== 'files'

async function listArcs(mediaDir, cfg) {
  const rules = compileRules(cfg)
  const out = []
  for (const scanDir of cfg.scan) {
    const dir = path.join(mediaDir, ...(scanDir && scanDir !== '.' ? scanDir.split('/') : []))
    let names = []
    try { names = (await readdir(dir)).sort() } catch { continue }
    for (const arcName of names) {
      if (!/\.arc$/i.test(arcName)) continue
      const rule = rules.find((r) => r.re.test(arcName))
      if (!rule || rule.skip) continue
      const file = path.join(dir, arcName)
      let info
      try { info = await stat(file) } catch { continue }
      if (info.isFile()) out.push({ arcName, file, rule, sig: `${arcName}:${info.size}:${Math.floor(info.mtimeMs)}` })
    }
  }
  return out
}

async function buildVirtual(mediaDir, cfg, arcs, sig) {
  const map = new Map()
  const files = []
  const add = (rel, hit) => { const key = rel.toLowerCase(); if (!map.has(key)) { map.set(key, { rel, ...hit }); files.push(rel) } }
  for (const { arcName, file, rule } of arcs) {
    let entries
    try { entries = (await readArcIndex(file)).entries } catch { continue }
    if (entries.length > cfg.maxEntries) continue
    const stem = withoutExt(arcName)
    const base = `${cfg.dir}/res/${stem}`
    let handle = null
    try {
      for (const entry of entries) {
        const name = safeEntryName(entry.name)
        if (!name) continue
        const kind = kindOf(name, 'script')
        if (!kind || kind === 'script' || !rule.kinds.has(kind) || (kind === 'pna' && rule.pna === 'skip')) continue
        if ((rule.include.length && !rule.include.some((re) => re.test(name))) || rule.exclude.some((re) => re.test(name))) continue
        if (entry.size > MAX_ENTRY_BYTES) continue
        if (kind === 'res' || rule.pna === 'raw') { add(`${base}/${name}`, { file, offset: entry.offset, size: entry.size }); continue }
        try {
          handle ||= await open(file, 'r')
          const layout = await readPnaLayout(handle, entry.offset, entry.size)
          layout.frames.forEach((f, i) => { if (f.size > 0) add(`${base}/${name}/${i}.${f.png ? 'png' : 'bin'}`, { file, offset: f.pos, size: f.size }) })
        } catch { /* 这个 PNA 坏了：当没有（展开时已经在报告里记了） */ }
      }
    } finally { await handle?.close().catch(() => {}) }
  }
  return { map, files, sig }
}

// 当前的虚拟索引（不是 hybrid / 没启用 = null）。.arc 没变就沿用；并发调用共用一次重建
export async function virtualIndex({ mediaDir, config }) {
  const cfg = config?.containers
  if (!isHybrid(cfg) || !mediaDir) return null
  const arcs = await listArcs(mediaDir, cfg)
  const sig = arcs.map((a) => a.sig).join('|')
  const key = `${mediaDir}|${cfg.dir}|${fingerprint(cfg)}`
  const hit = virtuals.get(key)
  if (hit?.sig === sig) return hit.promise
  const promise = buildVirtual(mediaDir, cfg, arcs, sig)
  virtuals.set(key, { sig, promise })
  promise.catch(() => { if (virtuals.get(key)?.promise === promise) virtuals.delete(key) })
  return promise
}
// 适配器文件索引用：hybrid 下「磁盘上看起来有」的资源路径（相对媒体目录）；cache 键用 sig
export async function virtualFiles({ mediaDir, config }) {
  const v = await virtualIndex({ mediaDir, config }).catch(() => null)
  return v ? { files: v.files, sig: v.sig } : { files: [], sig: '' }
}

// 把请求到的路径（相对媒体目录，可以有几个候选）里属于虚拟索引的、磁盘上还没有的，从 .arc 里读出来写成文件（先写临时文件再改名；同一个文件并发请求只取一次）。返回取出了几个
export async function materialize({ mediaDir, config, rels }) {
  const cfg = config?.containers
  if (!isHybrid(cfg) || !rels?.length) return 0
  const v = await virtualIndex({ mediaDir, config }).catch(() => null)
  if (!v) return 0
  let n = 0
  for (const rel of rels) {
    const hit = v.map.get(String(rel).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
    if (!hit) continue
    const target = path.join(mediaDir, ...hit.rel.split('/'))
    try { if ((await stat(target)).size === hit.size) continue } catch { /* 还没有 */ }
    let pending = materializing.get(target)
    if (!pending) {
      pending = (async () => {
        const handle = await open(hit.file, 'r')
        try {
          const data = await readRange(handle, hit.offset, hit.size)
          await mkdir(path.dirname(target), { recursive: true })
          const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
          await writeFile(tmp, data)
          await rename(tmp, target)
        } finally { await handle.close().catch(() => {}) }
      })().finally(() => materializing.delete(target))
      materializing.set(target, pending)
    }
    await pending
    n += 1
  }
  return n
}

const inflight = new Map()   // mediaDir|dir → Promise
const lastReport = new Map() // mediaDir → { at, arcs: { 名字: 结果 | { error } } }
export const containerReport = (mediaDir) => lastReport.get(mediaDir) || null
export function invalidateContainers(mediaDir) { for (const key of [...inflight.keys()]) if (key.startsWith(`${mediaDir}|`)) inflight.delete(key); for (const key of [...virtuals.keys()]) if (key.startsWith(`${mediaDir}|`)) virtuals.delete(key); lastReport.delete(mediaDir) }

// 保证容器已展开（没配置 / 没启用 = 什么都不做）。幂等：容器没变（大小 + mtime + 规则指纹）就跳过；同一个目录并发调用只做一次
export function ensureContainers({ mediaDir, config }) {
  const cfg = config?.containers
  if (!cfg?.enabled || !mediaDir) return Promise.resolve(null)
  const key = `${mediaDir}|${cfg.dir}|${fingerprint(cfg)}`
  let promise = inflight.get(key)
  if (!promise) {
    // 单飞：同一个目录 + 同一份规则同时只做一次；做完就清掉（下一次请求按 stamp 再检查——只是读一个小文件 + stat 每个容器，便宜；容器 / 规则变了就会重新展开）
    promise = run(mediaDir, cfg).finally(() => { if (inflight.get(key) === promise) inflight.delete(key) })
    inflight.set(key, promise)
  }
  return promise
}

async function run(mediaDir, cfg) {
  const rules = compileRules(cfg)
  const outRoot = path.join(mediaDir, ...cfg.dir.split('/'))
  const stampFile = path.join(outRoot, '.stamp.json')
  let stamp = { version: CONTAINER_FORMAT_VERSION, arcs: {} }
  try { const saved = JSON.parse(await readFile(stampFile, 'utf8')); if (saved?.version === CONTAINER_FORMAT_VERSION && saved.arcs) stamp = saved } catch { /* 第一次 */ }
  const fp = fingerprint(cfg)
  const report = { at: Date.now(), arcs: {} }
  const budget = { bytes: 0, limit: cfg.maxTotalMB * 1024 * 1024 }
  for (const scanDir of cfg.scan) {
    const dir = path.join(mediaDir, ...(scanDir && scanDir !== '.' ? scanDir.split('/') : []))
    let names = []
    try { names = (await readdir(dir)).sort() } catch { continue }
    for (const arcName of names) {
      if (!/\.arc$/i.test(arcName)) continue
      const rule = rules.find((r) => r.re.test(arcName))
      if (!rule) continue
      const key = `${scanDir}/${arcName}`
      if (rule.skip) { report.arcs[key] = { skipped: 'rule' }; continue }
      const file = path.join(dir, arcName)
      let info
      try { info = await stat(file) } catch { continue }
      if (!info.isFile()) continue
      const sig = `${info.size}:${Math.floor(info.mtimeMs)}:${fp}`
      if (stamp.arcs[key]?.sig === sig) { report.arcs[key] = { ...stamp.arcs[key].result, cached: true }; continue }
      const stem = withoutExt(arcName)
      const tmp = path.join(outRoot, `.tmp-${process.pid}-${Date.now()}`)
      try {
        const result = await expandArc({ file, arcName, rule, cfg, outRoot: tmp, budget })
        // 先展开到临时目录，再整体换掉这个容器的两个子目录（中途失败不会留下半截内容）
        for (const part of ['script', 'res']) {
          const from = path.join(tmp, part, stem)
          const to = path.join(outRoot, part, stem)
          await rm(to, { recursive: true, force: true })
          try { await stat(from) } catch { continue }
          await mkdir(path.dirname(to), { recursive: true })
          await rename(from, to)
        }
        stamp.arcs[key] = { sig, result }
        report.arcs[key] = result
        await mkdir(outRoot, { recursive: true })
        await writeFile(stampFile, JSON.stringify(stamp))
      } catch (error) {
        report.arcs[key] = { error: String(error.message || error).slice(0, 300) }
      } finally { await rm(tmp, { recursive: true, force: true }).catch(() => {}) }
    }
  }
  lastReport.set(mediaDir, report)
  return report
}
