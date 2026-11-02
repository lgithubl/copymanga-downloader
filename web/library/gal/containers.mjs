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
import { readFileSync, statSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decodeWs2, ror2 } from './adapters/advhd-ws2-decode.mjs'
import { bwToOgg, cbgToPng, dscDecode, encodePng, isBurikoScript, parseBgiFaceSet, readBurikoArcIndex, runBurikoScript, sniffEntry } from './bgi.mjs'
import { decodeScre } from './arcfam-decode.mjs'
import { runCbg, runKtx } from './decode-pool.mjs'
import { readArcfamIndex } from './arcfam.mjs'
import { normalizeKeyBundles } from './config.mjs'
import { Hxv4Filter, applyState, decodeKirikiriText, nameHash, openHxv4Archive } from './krkr-hxv4.mjs'
import { parseSinfo, pimgInfo } from './krkr-pimg.mjs'
import { decodeTlg, isTlg, tlgToPng } from './tlg.mjs'
import { inflateSync } from 'node:zlib'
import { decodeKrkrScnBuffer } from './krkr-scn.mjs'
import { extractZipMember, parseZipCentral, parseZipEnd } from './l2d-zip.mjs'
import { Psb, isPsb } from './psb.mjs'
import { pf8Decrypt, readPf8Index } from './pf8.mjs'
import { unpremultiplyPng } from './png-unpremultiply.mjs'
import { compileSafeRegex } from './voice.mjs'

// 展开结果的格式版本（进缓存签名）：脚本解码器 / index.json / 文件命名一变就加一，否则已展开过的游戏会一直用旧结果（2→3：解码器改成引擎自己的操作数表、PNA 帧按序号命名并带 kind / alpha；3→4：展开方式 mode（hybrid / files）进签名；4→5：PNAP 的帧还原成直通 alpha、WebP 帧也认、index.json 带 format / premultiplied；6→7：BGI 剧本的执行结果变了（jump_scenario 目标取 set_label 的字符串、事件数上限），已展开的要重新展开）
export const CONTAINER_FORMAT_VERSION = 10
const MAX_DIR_BYTES = 64 * 1024 * 1024
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024
const MAX_NAME_CHARS = 200
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'])
const AUDIO_EXTS = new Set(['ogg', 'flac', 'wav', 'mp3', 'opus', 'm4a'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'm4v', 'mov'])
const SCRIPT_EXTS = new Set(['ws2'])
const ARCFAM_RES_EXTS = new Set(['png', 'jpg', 'jpeg', 'ogg', 'wav', 'mp3', 'char', 'json'])   // char / json：eomaia 立绘的描述（.CHAR = 角色定义 JSON，部件图集的 JSON），适配器要读，都很小
const PF8_RES_EXTS = new Set([...IMAGE_EXTS, ...AUDIO_EXTS, 'ogv'])   // ogv：Artemis 的动态事件图（浏览器能直接播 Theora）

// BGI（BURIKO ARC20 里的 DSC 压缩剧本）：解压 → 把 token 流「执行」一遍 → 事件流（bgi-bs/1，适配器 bgi::bs 吃它）。不是剧本的 DSC（动画表之类）抛错，调用方当跳过
const compactEvent = (ev) => {
  const trim = (args) => { const list = args.map((v) => (typeof v === 'number' || typeof v === 'string' ? v : null)); let end = list.length; while (end > 0 && (list[end - 1] === 0 || list[end - 1] === null)) end--; return list.slice(0, end) }
  if (ev.k === 'call') return ['c', ev.name, ev.at, trim(ev.args)]
  if (ev.k === 'cmd') return ev.token === 0x140 ? ['k', ev.token, ev.at, trim(ev.args)] : null
  if (ev.k === 'sys') return ev.name === 'call_scenario' || ev.name === 'jump_scenario' ? ['s', ev.name, ev.at, trim(ev.args)] : null
  if (ev.k === 'choice') return ev.branches ? ['x', ev.at, ev.name, ev.options, ev.branches.map((b) => b.map(compactEvent).filter(Boolean)), ev.merge ?? null] : null
  return null
}
const MAX_BGI_EVENTS = 100000
const BGI_BS_DECODER = {
  ext: 'bgi',
  decode(buffer, { arc, name }) {
    const raw = sniffEntry(buffer.subarray(0, 16)) === 'dsc' ? dscDecode(buffer) : buffer
    if (!isBurikoScript(raw)) throw new Error('不是 BurikoCompiledScript')
    const run = runBurikoScript(raw)
    const events = run.events.map(compactEvent).filter(Boolean)
    // 系统 / 库脚本（菜单循环之类）可能一跑就是几十万个事件：只留前 MAX_BGI_EVENTS 个，标 truncated（剧情脚本远远不到）
    let truncated = run.truncated
    if (events.length > MAX_BGI_EVENTS) { events.length = MAX_BGI_EVENTS; truncated = true }
    return JSON.stringify({ format: 'bgi-bs/1', arc, name, size: raw.length, imports: run.imports, run: { steps: run.steps, choices: run.choices, merged: run.merged, unmerged: run.unmerged, truncated }, events })
  },
}
// Artemis（pf8 里的 .ast = Lua 表脚本）：调用方已经把条目解密成明文，这里只检查是不是 ast 并原样输出（适配器 artemis::ast 吃文本）
const ARTEMIS_AST_DECODER = {
  ext: 'ast',
  decode(buffer) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
    if (!/^\s*astver\s*=/.test(text.slice(0, 64))) throw new Error('不是 Artemis ast')
    return text
  },
}
// 自有 arc（eomaia 的 SCRE 剧本）：认字节模式抽出事件流（arcfam-scre/1，适配器 arcfam::scre 吃它）
const ARCFAM_SCRE_DECODER = {
  ext: 'arcfam',
  decode(buffer, { arc, name }) {
    const events = decodeScre(buffer)
    return JSON.stringify({ format: 'arcfam-scre/1', arc, name, size: buffer.length, events })
  },
}
// KiriKiri Z（Hxv4 加密 xp3 里的 PSB 场景脚本）：调用方已经解密成明文 PSB，这里压成 krkr-scn/1（适配器 krkr::scn 吃它）
const KRKR_SCN_DECODER = {
  ext: 'krkr',
  decode(buffer, { arc }) { return decodeKrkrScnBuffer(buffer, { arc }).text },
}
// 脚本解码器：id → { ext 的默认值, decode(buffer, { arc, name }) → 文本 }
export const SCRIPT_DECODERS = Object.freeze({
  'bgi-bs': BGI_BS_DECODER,
  'artemis-ast': ARTEMIS_AST_DECODER,
  'arcfam-scre': ARCFAM_SCRE_DECODER,
  'krkr-scn': KRKR_SCN_DECODER,
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
// 按 config.containers.format：willplus（默认）/ buriko（BGI 的 BURIKO ARC20）。两种都返回 { size, entries: [{ name, offset, size }] }
const readIndexFor = (file, cfg) => (cfg?.format === 'buriko' ? readBurikoArcIndex(file) : cfg?.format === 'pf8' ? readPf8Index(file) : cfg?.format === 'arcfam' ? readArcfamIndex(file) : readArcIndex(file))
// pf8（Artemis）：按扩展名分——.ast = 脚本（解密后交给解码器），图 / 声音 = 资源（取出来时解密），别的（lua / csv / psb …）跳过
function classifyPf8(name) {
  const ext = extOf(name)
  if (ext === 'ast') return { kind: 'script' }
  if (PF8_RES_EXTS.has(ext)) return { kind: 'res', transform: 'pf8' }
  return { kind: '' }
}
// 自有 arc：名字（大写）按扩展名分——.SCRIPT = 剧本，图 / 声音 = 资源；大小 ≠ 原大小 = 压缩（算法没识别）跳过；别的（json / lib / bin / mes …）跳过
function classifyArcfam(name, entry) {
  if (entry.origSize !== entry.size) return { kind: '', compressed: true }
  const ext = extOf(name)
  if (ext === 'script') return { kind: 'script' }
  if (ARCFAM_RES_EXTS.has(ext)) return { kind: 'res' }
  return { kind: '' }
}
// pf8 容器的名字：.pfs / .pfs.000 → pfs 的主名（脚本展开到 script/<主名>/…）
const pf8Stem = (arcName) => arcName.replace(/\.pfs(?:\.(\d+))?$/i, (_m, n) => (n ? `_${n}` : ''))   // yugamase.pfs → yugamase，yugamase.pfs.000 → yugamase_000（各自一个目录，互不覆盖）
// buriko 的条目没有扩展名：看内容开头 → { kind, ext, transform }（kind：script / res；''= 不认识，跳过）。res 的 transform 在取出来时做（cbg → png、bw → ogg）
async function classifyBuriko(handle, entry) {
  if (entry.size < 8) return { kind: '' }
  const head = await readRange(handle, entry.offset, Math.min(0x18, entry.size))
  const sniff = sniffEntry(head)
  if (sniff === 'dsc') return /^animationset/i.test(entry.name || '') ? { kind: 'res', ext: 'json', transform: 'bgi-faceset' } : { kind: 'script', ext: '', transform: '' }   // 表情编号表（animationset***）当成资源：虚拟的 <名字>.json
  if (sniff === 'cbg') return { kind: 'res', ext: 'png', transform: 'cbg-png', ...(head.length >= 0x14 ? { w: head.readUInt16LE(0x10), h: head.readUInt16LE(0x12) } : {}) }
  if (sniff === 'bw') return { kind: 'res', ext: 'ogg', transform: 'bw-ogg' }
  return { kind: '' }
}
// 取出来的字节要不要转：cbg-png（CompressedBG → PNG）/ bw-ogg（去掉 BW 头）；PNAP 的预乘 → 直通另算（unpremultiply）
// 异步版：CompressedBG → PNG 放 worker 线程（不卡主线程），别的转换还是同步做
async function transformDataAsync(data, hit) {
  if (hit.transform === 'cbg-png') return runCbg(data, hit.crop ? { cropHeight: hit.crop } : {})
  return transformData(data, hit)
}
function transformData(data, hit) {
  if (hit.transform === 'cbg-png') return cbgToPng(data, hit.crop ? { cropHeight: hit.crop } : {})
  if (hit.transform === 'bw-ogg') return bwToOgg(data)
  if (hit.transform === 'bgi-faceset') return Buffer.from(JSON.stringify(parseBgiFaceSet(dscDecode(data))))
  if (hit.transform === 'pf8') return pf8Decrypt(data, hit.key)
  return hit.unpremultiply ? unpremultiplyPng(data).buffer : data
}
// 资源（图 / 声音）展开后的相对路径（相对容器目录 cfg.dir）：flat = 所有容器的资源放同一个目录（BGI：脚本按名字引用，不带容器名）
const resRel = (cfg, stem, name) => (cfg.flat ? `res/${name}` : `res/${stem}/${name}`)

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
const fingerprint = (cfg) => createHash('sha1').update(JSON.stringify([CONTAINER_FORMAT_VERSION, cfg.rules, cfg.scriptDecoder, cfg.scriptExt, cfg.dir, cfg.mode || 'hybrid', cfg.format || 'willplus', Boolean(cfg.flat), cfg.maxEntries, cfg.maxTotalMB, createHash('sha1').update(JSON.stringify(effectiveKeys(cfg))).digest('hex')])).digest('hex').slice(0, 16)
const kindOf = (name, scriptKinds) => {
  const ext = extOf(name)
  if (SCRIPT_EXTS.has(ext)) return scriptKinds
  if (ext === 'pna') return 'pna'
  if (IMAGE_EXTS.has(ext) || AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return 'res'
  return ''
}

// 帧数据的图片格式：PNG / WebP（WPAP / WPAS 的帧是 WebP）/ 别的（''）
const imageFormatOf = (head) => (head.length >= 8 && head.subarray(0, 8).equals(PNG_MAGIC) ? 'png' : head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : '')
// 魔数 PNAP / PNAS / WPAP / WPAS：第 4 个字母 P = 预乘 alpha（引擎读取函数 FUN_14011bdc0 里 …P → 标志 1，…S → 0），S = 直通；第 1 个字母 P = PNG、W = WebP（标志 +0x7c）
const pnaKind = (magic) => ({ premultiplied: magic[3] === 'P', webp: magic[0] === 'W' })
// PNA 的一帧在 index.json 里的一行（两种展开方式共用）：png = 数据是 PNG；magic = 非 PNG 数据的开头 8 字节（十六进制）
function frameRow(i, f, { fmt, magic }) {
  const row = { n: i, type: f.type, id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, scale: f.scale, alpha: f.scale, ...(f.mode ? { mode: f.mode } : {}) }   // alpha = 记录里的 f64（引擎里是图层 +0x48，着色器的 alpha；以前叫 scale）；mode = 第 7 个 u32（3 / 8 / 10 / 0x15 = 特殊图层，其余 0）
  row.kind = f.type === 1 || f.type === 2 ? 'group' : f.size > 0 ? (fmt ? 'image' : 'unsupported') : 'empty'   // group = 组开始 / 结束标记；empty = 没有图像数据；unsupported = 有数据但不是 PNG / WebP
  if (f.size > 0 && fmt) row.file = `${i}.${fmt}`   // 按帧的序号（文件里的顺序）命名：DisplayCharacterImage 用的是这个序号（引擎里是数组下标，FUN_140115930），不是记录里的 id 字段
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
    if (f.size >= 8) { const m = await readRange(handle, f.pos, Math.min(12, f.size)); f.fmt = imageFormatOf(m); f.magic = m.subarray(0, 8).toString('hex') } else { f.fmt = ''; f.magic = '' }
    frames.push(f)
  }
  return { magic, width: head.readUInt32LE(8), height: head.readUInt32LE(12), frames }
}
const pnaIndexJson = (layout, converted = false) => JSON.stringify({ magic: layout.magic, format: pnaKind(layout.magic).webp ? 'webp' : 'png', premultiplied: pnaKind(layout.magic).premultiplied, unpremultiplied: converted, width: layout.width, height: layout.height, frames: layout.frames.map((f, i) => frameRow(i, f, { fmt: f.fmt, magic: f.magic })) })   // premultiplied = 源数据是预乘 alpha；unpremultiplied = 展开出来的 PNG 已经还原成直通 alpha（浏览器直接能用）

// ---------- 展开一个容器 ----------
async function expandArc({ file, arcName, rule, cfg, outRoot, budget }) {
  const { entries, key } = await readIndexFor(file, cfg)
  const buriko = cfg.format === 'buriko'
  const pf8 = cfg.format === 'pf8'
  const arcfam = cfg.format === 'arcfam'
  const stem = pf8 ? pf8Stem(arcName) : withoutExt(arcName)
  const decoder = SCRIPT_DECODERS[cfg.scriptDecoder]
  const result = { entries: entries.length, scripts: 0, res: 0, pna: 0, pnaFrames: 0, skipped: 0, excluded: 0, bad: [], truncatedScripts: 0 }
  if (entries.length > cfg.maxEntries) throw new Error(`条目 ${entries.length} 个，超过上限 ${cfg.maxEntries}（config.containers.maxEntries）`)
  const handle = await open(file, 'r')
  try {
    for (const entry of entries) {
      const name = safeEntryName(entry.name)
      if (!name) { result.bad.push(entry.name.slice(0, 60)); continue }
      // buriko（BGI）的条目没有扩展名，按内容分：DSC = 剧本、CompressedBG = 图、BW = 声音（图 / 声音只在 hybrid 的虚拟索引里，取出来时才转）
      const cls = buriko ? await classifyBuriko(handle, entry) : pf8 ? classifyPf8(name) : arcfam ? classifyArcfam(name, entry) : null
      const kind = buriko || pf8 || arcfam ? cls.kind : kindOf(name, 'script')
      if (arcfam && cls.compressed) { result.unsupported = (result.unsupported || 0) + 1 }
      if (!kind || !rule.kinds.has(kind) || (kind === 'pna' && rule.pna === 'skip')) { result.skipped += 1; continue }
      if ((rule.include.length && !rule.include.some((re) => re.test(name))) || rule.exclude.some((re) => re.test(name))) { result.excluded += 1; continue }
      if (entry.size > MAX_ENTRY_BYTES) { result.bad.push(`${name}（${entry.size} 字节太大）`); continue }
      // hybrid（默认）：图 / 声音 / 视频 / PNA 帧不展开（被请求时才从 .arc 读那一个条目，见 materialize）；PNA 只写 index.json（读头和记录表，不读像素）
      const lazy = (cfg.mode !== 'files' || buriko || pf8 || arcfam) && (kind === 'res' || kind === 'pna')
      if (lazy && (kind === 'res' || rule.pna === 'raw')) { result.res += 1; result.lazy = (result.lazy || 0) + 1; continue }
      if (lazy) {
        try {
          const layout = await readPnaLayout(handle, entry.offset, entry.size)
          const dir = path.join(outRoot, 'res', stem, ...name.split('/'))
          await mkdir(dir, { recursive: true })
          await writeFile(path.join(dir, 'index.json'), pnaIndexJson(layout, pnaKind(layout.magic).premultiplied))
          result.pna += 1
          result.pnaFrames += layout.frames.filter((f) => f.fmt).length
          result.lazy = (result.lazy || 0) + 1
        } catch (error) { result.bad.push(`${name}（${error.message}）`) }
        continue
      }
      budget.bytes += entry.size
      if (budget.bytes > budget.limit) throw new Error(`展开的总大小超过上限 ${cfg.maxTotalMB} MB（config.containers.maxTotalMB）`)
      let data = await readRange(handle, entry.offset, entry.size)
      if (pf8) data = pf8Decrypt(data, key)
      if (kind === 'script') {
        if (!decoder) throw new Error(`没有脚本解码器 ${cfg.scriptDecoder}`)
        const base = buriko ? name : pf8 ? withoutExt(name.replace(/^script\//i, '')) : withoutExt(name)   // arcfam 同 willplus：去扩展名
        let text
        try { text = decoder.decode(data, { arc: stem, name: base }) } catch (error) {
          if (!buriko && !pf8 && !arcfam) throw error
          result.skipped += 1; result.notScript = (result.notScript || 0) + 1   // DSC 里不是剧本的（动画表之类）
          continue
        }
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
          const kind = pnaKind(pna.magic)
          const index = { magic: pna.magic, format: kind.webp ? 'webp' : 'png', premultiplied: kind.premultiplied, unpremultiplied: kind.premultiplied && !kind.webp, width: pna.width, height: pna.height, frames: [] }
          for (const [i, frame] of pna.frames.entries()) {
            const fmt = frame.size > 0 ? imageFormatOf(frame.data) : ''
            const row = frameRow(i, frame, { fmt, magic: frame.data.subarray(0, 8).toString('hex') })
            if (fmt) {
              let out = frame.data
              if (kind.premultiplied && fmt === 'png') { const conv = unpremultiplyPng(frame.data); out = conv.buffer; if (!conv.converted) { index.unpremultiplied = false; row.unconverted = conv.reason } }   // 预乘 → 直通（WebP 帧不转：服务端没有 WebP 解码）
              await writeFile(path.join(dir, row.file), out)
              result.pnaFrames += 1
            } else if (frame.size > 0) await writeFile(path.join(dir, `${i}.bin`), frame.data)   // 不是 PNG / WebP（样本里没见过）：原样写成 <序号>.bin
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


// ---------- KiriKiri Z（Hxv4 加密的 xp3）----------
// 文件名是哈希：脚本（scn.xp3 里的 PSB）解密后展开成 script/<容器>/<名字>.krkr，同时把脚本里引用的资源名（图 / bgm / 语音）写进 refs/<容器>.json；
// 虚拟索引 = 这些名字 × 常见扩展名算名字哈希，在每个 xp3 的特殊索引里命中的条目（refs 以外的文件没有名字，列不出来）。取出来时才解密。
const KRKR_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp']
const KRKR_AUDIO_EXTS = ['ogg', 'opus', 'wav', 'mp3']
const krkrFilters = new Map()   // 密钥包 JSON → Hxv4Filter（128 个小程序，建一次）
const krkrFilterFor = (bundle) => { const k = JSON.stringify(bundle); let f = krkrFilters.get(k); if (!f) { f = Hxv4Filter.fromBundle(bundle); krkrFilters.set(k, f); if (krkrFilters.size > 16) krkrFilters.delete(krkrFilters.keys().next().value) } return f }
// 密钥包：config.containers.keys 优先，没有就用服务端的密钥文件（<DATA_DIR>/gal-krkr-keys.json = 密钥包数组；setKeysFile 指定；按 mtime 重读）。
// 密钥是凭据，放服务端文件里不会被 gal-layout 重跑冲掉、也不跟着条目的配置走
let keysFile = ''
let keysCache = { mtime: -1, list: [] }
export function setKeysFile(file) { keysFile = file || ''; keysCache = { mtime: -1, list: [] } }
function fileKeys() {
  if (!keysFile) return []
  try {
    const mtime = statSync(keysFile).mtimeMs
    if (mtime !== keysCache.mtime) keysCache = { mtime, list: normalizeKeyBundles(JSON.parse(readFileSync(keysFile, 'utf8'))) }
  } catch { keysCache = { mtime: -1, list: [] } }
  return keysCache.list
}
const effectiveKeys = (cfg) => (cfg?.keys?.length ? cfg.keys : fileKeys())
// 用密钥包里第一套能打开这个 xp3 的打开它 → { arc, bundle, index }
async function openKrkr(file, cfg) {
  const keys = effectiveKeys(cfg)
  if (!keys.length) throw new Error('没有密钥包（config.containers.keys 或服务端密钥文件 gal-krkr-keys.json）')
  let last = null
  for (const [index, bundle] of keys.entries()) {
    try { return { arc: await openHxv4Archive(file, bundle, { filter: krkrFilterFor(bundle) }), bundle, index } } catch (error) { last = error }
  }
  throw new Error(`密钥包里没有一套能打开 ${path.basename(file)}：${last?.message || last}`)
}
async function expandKrkr({ file, arcName, rule, cfg, outRoot, budget }) {
  const stem = withoutExt(arcName)
  const result = { entries: 0, scripts: 0, res: 0, skipped: 0, excluded: 0, bad: [], truncatedScripts: 0 }
  if (!rule.kinds.has('script')) { result.skipped = 1; return result }   // 只有资源的 xp3：虚拟索引里处理
  const { arc } = await openKrkr(file, cfg)
  try {
    result.entries = arc.entries.length
    if (arc.entries.length > cfg.maxEntries) throw new Error(`条目 ${arc.entries.length} 个，超过上限 ${cfg.maxEntries}（config.containers.maxEntries）`)
    const refs = { img: new Set(), bgm: new Set(), voice: new Set() }
    for (const entry of arc.entries) {
      if (!entry.meta || entry.hxv4Id === 0) { result.skipped += 1; continue }   // id 0 = 「禁止解包」的警告占位条目
      budget.bytes += entry.originalSize
      if (budget.bytes > budget.limit) throw new Error(`展开的总大小超过上限 ${cfg.maxTotalMB} MB（config.containers.maxTotalMB）`)
      let data
      try { data = await arc.readEntry(entry) } catch (error) { result.bad.push(`#${entry.hxv4Id}（${error.message}）`); continue }
      if (!isPsb(data)) { result.skipped += 1; result.notScript = (result.notScript || 0) + 1; continue }
      let decoded
      try { decoded = decodeKrkrScnBuffer(data, { arc: stem }) } catch (error) { result.skipped += 1; result.notScript = (result.notScript || 0) + 1; continue }
      const name = safeEntryName(decoded.name)
      if (!name) { result.bad.push(decoded.name.slice(0, 60)); continue }
      const target = path.join(outRoot, 'script', stem, ...`${name}.${cfg.scriptExt || 'krkr'}`.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, decoded.text)
      result.scripts += 1
      for (const kind of Object.keys(refs)) for (const n of decoded.refs[kind]) refs[kind].add(n)
    }
    const refsFile = path.join(outRoot, 'refs', stem, 'names.json')
    await mkdir(path.dirname(refsFile), { recursive: true })
    await writeFile(refsFile, JSON.stringify({ img: [...refs.img], bgm: [...refs.bgm], voice: [...refs.voice] }))
  } finally { await arc.close() }
  return result
}
// refs 目录的状态（进虚拟索引的签名：脚本展开完 / 变了，虚拟索引要重建）
async function krkrRefsSig(mediaDir, cfg) {
  const dir = path.join(mediaDir, ...cfg.dir.split('/'), 'refs')
  let sig = ''
  try { for (const stemDir of (await readdir(dir)).sort()) { const st = await stat(path.join(dir, stemDir, 'names.json')).catch(() => null); if (st) sig += `|${stemDir}:${st.size}:${Math.floor(st.mtimeMs)}` } } catch { /* 还没展开 */ }
  return `|refs${sig}`
}
// 图 / 立绘 / CG 的候选文件名（名字哈希要用）：逻辑名 n →
//   n.<png|jpg|…>（直接是图）、n.tlg（TLG，转成 PNG）、去掉 ev 前缀的 cg…（事件 CG 在 evimage.xp3 里叫 cg001_03u1.tlg，脚本里叫 evcg001_03u1）、
//   n.pimg（立绘：分层 PSB；虚拟成 <n>.pimg.json + <n>.pimg/<层 id>.png + <n>.pimg/canvas.png）
const KRKR_PLAIN_IMAGE = ['png', 'jpg', 'jpeg', 'webp', 'bmp']
const KRKR_REDIRECT_MAX = 2048   // 重定向文本（psb://X.dpak/成员）很小：只读 ≤ 这么大的条目来找
const hashHex = (name) => nameHash(name).toString('hex').toUpperCase()
// Live2D 的 .l2d（ZIP）：只读目录（尾部），每个成员一个虚拟文件 <名字>.l2d/<成员>（纹理 .ktx 虚拟成 .png，model3.json 里写的就是 .png）
async function addL2dMembers({ arc, entry, record, file, bundle, base, add, entryHit, dir }) {
  try {
    const size = entry.originalSize
    const tailLen = Math.min(size, 65536 + 22)
    const tail = await arc.readEntryRange(entry, size - tailLen, tailLen)
    const end = parseZipEnd(tail)
    if (!end || end.cdOffset + end.cdSize > size) return
    const central = end.cdOffset >= size - tailLen ? tail.subarray(end.cdOffset - (size - tailLen), end.cdOffset - (size - tailLen) + end.cdSize) : await arc.readEntryRange(entry, end.cdOffset, end.cdSize)
    for (const member of parseZipCentral(central, end.count)) {
      const texture = /\.ktx$/i.test(member.name)
      const rel = `${dir}/res/${base}/${texture ? member.name.replace(/\.ktx$/i, '.png') : member.name}`
      const hit = entryHit(entry, record, file, { mode: texture ? 'l2d-texture' : 'l2d-member', member: member.name, zip: member })
      hit.bundleJson = bundle
      add(rel, hit)
    }
  } catch { /* 这个包读不了（采集没收全 / 不是 ZIP）：没有这个模型 */ }
}
const l2dZips = new Map()   // 解密好的 .l2d（几十 MB）：同一个模型的 moc3 / 纹理 / 动作连着取，最近 2 个留着
async function buildKrkrVirtual(mediaDir, cfg, arcs, sig) {
  const map = new Map()
  const files = []
  const add = (rel, hit) => { const key = rel.toLowerCase(); if (!map.has(key)) { map.set(key, { rel, ...hit }); files.push(rel) } }
  const names = { img: new Set(), bgm: new Set(), voice: new Set() }
  const refsDir = path.join(mediaDir, ...cfg.dir.split('/'), 'refs')
  try {
    for (const stemDir of await readdir(refsDir)) {
      let data
      try { data = JSON.parse(await readFile(path.join(refsDir, stemDir, 'names.json'), 'utf8')) } catch { continue }
      for (const kind of Object.keys(names)) for (const n of Array.isArray(data[kind]) ? data[kind] : []) if (typeof n === 'string' && n && n.length <= 80) names[kind].add(n)
    }
  } catch { /* 还没展开：没有名字 = 空索引（refs 出现后签名变了会重建） */ }
  // 名字哈希 → [{ rel（虚拟路径里的文件名）, mode }]
  const candidates = new Map()
  const addCandidate = (file, rel, mode, extra = {}) => { const h = hashHex(file); if (!candidates.has(h)) candidates.set(h, []); candidates.get(h).push({ rel, mode, ...extra }) }
  for (const n of names.img) {
    for (const ext of KRKR_PLAIN_IMAGE) addCandidate(`${n}.${ext}`, `${n}.${ext}`, 'raw')
    addCandidate(`${n}.tlg`, `${n}.png`, 'tlg-png')
    if (/^ev/.test(n)) addCandidate(`${n.replace(/^ev/, '')}.tlg`, `${n}.png`, 'tlg-png')
    addCandidate(`${n}.pimg`, `${n}.pimg.json`, 'pimg-json', { pimg: n })
    addCandidate(`${n}.sinfo`, `${n}.sinfo.json`, 'sinfo-json')
    addCandidate(`${n}.l2d`, `${n}.l2d`, 'l2d')   // Live2D 模型包（ZIP）：展开成 <名字>.l2d/<成员>
  }
  for (const kind of ['bgm', 'voice']) for (const n of names[kind]) for (const ext of KRKR_AUDIO_EXTS) addCandidate(`${n}.${ext}`, `${n}.${ext}`, 'raw')
  if (!candidates.size) return { map, files, sig }
  const entryHit = (entry, record, file, extra) => ({ file, offset: 0, size: entry.originalSize, transform: 'krkr', krkr: { id: entry.hxv4Id, segments: entry.segments, entryKey: record.entryKey.toString(), filterFlag: record.filterFlag, originalSize: entry.originalSize, archiveSize: entry.archiveSize, adler: entry.adler, ...extra } })
  const redirects = new Map()   // 成员名（无扩展名）→ { dpak 文件名, 成员文件名, 所在 xp3 }
  const redirectEntries = []    // 每个重定向条目：{ id, dpak, member（底图 TLG）, overlays（叠加层 PNG 成员名）, … }（变体按 id 顺序对名字用）
  const pending = []            // 稍后处理的 { archive, byName }
  for (const { file, rule } of arcs) {
    if (!rule.kinds.has('res')) continue
    let opened
    try { opened = await openKrkr(file, cfg) } catch { continue }
    try {
      const { arc, bundle } = opened
      const byRecord = new Map(arc.entries.filter((e) => e.meta).map((e) => [e.meta, e]))
      const byHash = new Map()
      for (const record of arc.special) {
        if (record.archiveSlot !== 0) continue
        byHash.set(record.nameHash, record)
        const list = candidates.get(record.nameHash)
        if (!list) continue
        const entry = byRecord.get(record)
        if (!entry || entry.originalSize > MAX_ENTRY_BYTES) continue
        for (const c of list) {
          if (c.mode === 'l2d') { await addL2dMembers({ arc, entry, record, file, bundle, base: c.rel, add, entryHit, dir: cfg.dir }); continue }
          const hit = entryHit(entry, record, file, { mode: c.mode })
          hit.bundleJson = bundle
          add(`${cfg.dir}/res/${c.rel}`, hit)
        }
      }
      // 事件 CG：evimage.xp3 里大部分条目是小文本 psb://<包>.dpak/<成员>.tlg（重定向），真正的图在 .dpak（PSB）里；成员名 = 去掉 ev 的逻辑名
      for (const entry of arc.entries) {
        if (!entry.meta || entry.originalSize > KRKR_REDIRECT_MAX || entry.hxv4Id === 0) continue
        let text = null
        try { text = decodeKirikiriText(await arc.readEntry(entry, { verify: false })) } catch { continue }
        if (!text || !text.includes('psb://')) continue
        let first = null
        const overlays = []
        for (const line of text.split(/\r?\n/)) {
          const m = /^psb:\/\/([^/]+\.dpak)\/(.+\.tlg)$/i.exec(line.trim())
          if (m) {
            redirects.set(m[2].replace(/\.tlg$/i, '').toLowerCase(), { dpak: m[1], member: m[2], file, bundle, byHash, byRecord })
            if (!first) first = { dpak: m[1], member: m[2] }
            continue
          }
          const p = /^psb:\/\/([^/]+\.dpak)\/(.+\.png)$/i.exec(line.trim())
          if (p && first && p[1] === first.dpak) overlays.push(p[2])
        }
        if (first) redirectEntries.push({ id: entry.hxv4Id, dpak: first.dpak, member: first.member, overlays, file, bundle, byHash, byRecord })
      }
      pending.push({ file, bundle, arc })
      opened.keep = true   // 先别关：事件 CG 的 dpak 要在同一个档案里按名字哈希找，最后统一关
    } finally { if (!opened.keep) await opened.arc.close() }
  }
  // dpak 的成员表：每个重定向指向的 dpak 打开头部（PSB 的名字 / 字符串 / 根，不碰资源）列出所有 .tlg 成员（一个 dpak = 一组 CG：cg005_06 / cg005_06r1 / …）；成员名 = 去掉 ev 的逻辑名
  const memberIndex = new Map()   // 成员 stem（小写）→ { member, record, entry, file, bundle }
  try {
    const dpaks = new Map()
    for (const r of redirects.values()) { const record = r.byHash.get(hashHex(r.dpak)); const entry = record && r.byRecord.get(record); if (entry && !dpaks.has(record)) dpaks.set(record, { r, record, entry }) }
    for (const { r, record, entry } of dpaks.values()) {
      const archive = pending.find((p) => p.file === r.file)?.arc
      if (!archive) continue
      try {
        const head = await archive.readEntryRange(entry, 0, 64)
        if (!isPsb(head) || head.length < 44) continue
        const dataStart = head.readUInt32LE(32)   // 资源数据区起点：在它之前的是名字 / 字符串 / 根
        if (!(dataStart > 44 && dataStart <= 1 << 20)) continue
        const prefix = await archive.readEntryRange(entry, 0, dataStart)
        for (const member of Object.keys(new Psb(prefix).root())) if (/\.tlg$/i.test(member)) memberIndex.set(member.replace(/\.tlg$/i, '').toLowerCase(), { member, record, entry, file: r.file, bundle: r.bundle })
      } catch { /* 这个 dpak 读不了：跳过 */ }
    }
    for (const n of names.img) {
      const key = n.replace(/^ev/, '').toLowerCase()
      let hitm = memberIndex.get(key) || memberIndex.get(n.toLowerCase())
      if (!hitm) {   // dpak 头读不出来（档案被截断之类）：用重定向文本里直接写的那一个成员
        const r = redirects.get(key) || redirects.get(n.toLowerCase())
        const record = r && r.byHash.get(hashHex(r.dpak))
        const entry = record && r.byRecord.get(record)
        if (entry) hitm = { member: r.member, record, entry, file: r.file, bundle: r.bundle }
      }
      if (!hitm || map.has(`${cfg.dir}/res/${n}.png`.toLowerCase())) continue
      const hit = entryHit(hitm.entry, hitm.record, hitm.file, { mode: 'dpak-member', member: hitm.member })
      hit.bundleJson = hitm.bundle
      add(`${cfg.dir}/res/${n}.png`, hit)
    }
  } finally { for (const { arc } of pending) await arc.close().catch(() => {}) }
  // 事件 CG 的变体（evcg001_01r1 … r4）：每个变体是 evimage.xp3 里的一个重定向条目（底图 TLG + 0~n 张 PNG 叠加层），条目的名字是哈希猜不出来，
  // 但同一个 dpak 的条目 id 按变体名排序连续排：base（无后缀）、r1、r2…。按「rN = 这一组第一个 id + N」对（有缺号的组用最近的锚点校准：
  // 锚点 = 没有叠加层、底图就是 <组>rN 自己的条目，名字对得上）。真实数据 g07 / g08：174 + 148 个锚点里 170 + 146 个和这个规则一致（其余是组里缺了某个 rN，用最近的锚点校准就对上）
  try {
    const groups = new Map()   // 档案|组（dpak 名去掉 __随机后缀）→ 按 id 排好的条目
    for (const r of redirectEntries) {
      const stem = r.dpak.replace(/\.dpak$/i, '').replace(/__[^_]+$/, '').toLowerCase()
      const key = `${r.file}|${stem}`
      if (!groups.has(key)) groups.set(key, { stem, list: [] })
      groups.get(key).list.push(r)
    }
    const byStem = new Map()
    for (const g of groups.values()) {
      g.list.sort((a, b) => a.id - b.id)
      g.anchors = []
      g.list.forEach((r, index) => {
        if (r.overlays.length) return
        const m = new RegExp(`^${g.stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:r(\\d+))?$`, 'i').exec(r.member.replace(/\.tlg$/i, ''))
        if (m) g.anchors.push({ index, rank: m[1] ? Number(m[1]) : 0 })
      })
      if (!byStem.has(g.stem)) byStem.set(g.stem, [])
      byStem.get(g.stem).push(g)
    }
    for (const n of names.img) {
      const key = `${cfg.dir}/res/${n}.png`.toLowerCase()
      if (map.has(key)) continue
      const m = /^ev(.+?)(?:r(\d+))?$/i.exec(n)
      if (!m) continue
      const g = (byStem.get(m[1].toLowerCase()) || [])[0]
      if (!g) continue
      const rank = m[2] ? Number(m[2]) : 0
      const ref = g.anchors.length ? g.anchors.reduce((best, a) => (Math.abs(a.rank - rank) < Math.abs(best.rank - rank) ? a : best)) : { index: 0, rank: 0 }
      const r = g.list[ref.index + (rank - ref.rank)]
      if (!r) continue
      const record = r.byHash.get(hashHex(r.dpak))
      const entry = record && r.byRecord.get(record)
      if (!entry) continue
      const hit = entryHit(entry, record, r.file, { mode: r.overlays.length ? 'ev-composite' : 'dpak-member', member: r.member, ...(r.overlays.length ? { overlays: r.overlays } : {}), byRank: true })
      hit.bundleJson = r.bundle
      add(`${cfg.dir}/res/${n}.png`, hit)
    }
  } catch { /* 对不上就走下面的顶替 */ }
  // 事件 CG 的变体（evcg001_01r1 … r4 = 同一张底图 + 叠加层的不同阶段；ev_mv001_02… = 同一个 CG 的动态版）：每个变体是一个重定向条目（底图 TLG + 一张 PNG 叠加层），
  // 条目自己的名字猜不出来（只知道 id 按名字排序），所以变体没法一一对上。退一步：找不到的变体用「同一个 CG 编号（001_02）里已经对上的」图顶替（底图，没有叠加层）
  try {
    const groupOf = (n) => /^ev(?:_mv|cg|ed)?(x?\d+_\d+)/.exec(n)?.[1] || ''
    const byGroup = new Map()   // CG 编号 → [已对上的 { n, hit }]，底图（名字没有 r / u / w 后缀）排前面
    for (const n of names.img) {
      const g = groupOf(n)
      const hit = g && map.get(`${cfg.dir}/res/${n}.png`.toLowerCase())
      if (!hit || !hit.krkr || !['tlg-png', 'dpak-member'].includes(hit.krkr.mode)) continue
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g).push({ n, hit })
    }
    for (const list of byGroup.values()) list.sort((a, b) => (/^ev(?:cg)?\d+_\d+$/.test(a.n) ? 0 : 1) - (/^ev(?:cg)?\d+_\d+$/.test(b.n) ? 0 : 1) || a.n.length - b.n.length)
    for (const n of names.img) {
      if (!/^ev(?:_mv|cg)\d+_\d+/.test(n) || map.has(`${cfg.dir}/res/${n}.png`.toLowerCase())) continue
      const stand = byGroup.get(groupOf(n))?.[0]
      if (stand) add(`${cfg.dir}/res/${n}.png`, { ...stand.hit, krkr: { ...stand.hit.krkr, fallbackFor: stand.n } })
    }
  } catch { /* 顶替不了就算了 */ }
  // 立绘的层：<名字>.pimg/<层 id>.png / canvas.png 现算（不列进 files：适配器按 .pimg.json 里的层 id 直接引用）
  const dynamic = (key, rel) => {
    const m = /^(.*\.pimg)\/(canvas|\d+)\.png$/i.exec(key)
    if (!m) return null
    const base = map.get(`${m[1]}.json`)
    if (!base || base.krkr?.mode !== 'pimg-json') return null
    return { ...base, rel, krkr: { ...base.krkr, mode: 'pimg-layer', layer: m[2] } }
  }
  return { map, files, sig, dynamic }
}
async function readKrkrHit(hit) {
  const k = hit.krkr
  const isL2d = k.mode === 'l2d-member' || k.mode === 'l2d-texture'
  const l2dKey = isL2d ? `${hit.file}:${k.id}` : ''
  let cached = isL2d ? l2dZips.get(l2dKey) : null
  if (cached) { l2dZips.delete(l2dKey); l2dZips.set(l2dKey, cached) }   // 最近用过
  const handle = cached ? null : await open(hit.file, 'r')
  let data = cached
  try {
    if (!cached) {
    const parts = []
    for (const s of k.segments) {
      const raw = await readRange(handle, s.offset, s.archiveSize)
      const method = s.flags & 7
      if (method === 1) parts.push(inflateSync(raw)); else if (method === 0) parts.push(raw); else throw new Error(`不支持的段编码 ${method}`)
    }
    data = Buffer.concat(parts)
    if (data.length !== k.originalSize && data.length === k.archiveSize) data = inflateSync(data)
    applyState(krkrFilterFor(hit.bundleJson).stateFor(BigInt(k.entryKey), k.filterFlag), 0, data)
    }
  } finally { await handle?.close().catch(() => {}) }
  if (isL2d && !cached) { l2dZips.set(l2dKey, data); while (l2dZips.size > 2) l2dZips.delete(l2dZips.keys().next().value) }
  switch (k.mode || 'raw') {
    case 'l2d-member': return Buffer.from(extractZipMember(data, k.zip))
    case 'l2d-texture': return rgbaToPng(await runKtx(Buffer.from(extractZipMember(data, k.zip))))   // BC7 解码在 worker 线程里做（4096² 要 2 秒）
    case 'tlg-png': return tlgToPng(data)
    case 'pimg-json': return Buffer.from(JSON.stringify(pimgInfo(new Psb(data).root())))
    case 'sinfo-json': return Buffer.from(JSON.stringify(parseSinfo(decodeKirikiriText(data) ?? data.toString('utf8'))))
    case 'pimg-layer': {
      const psb = new Psb(data)
      const root = psb.root()
      if (k.layer === 'canvas') return encodePng(Number(root.width), Number(root.height), 4, Buffer.alloc(Number(root.width) * Number(root.height) * 4), 1)
      const ref = root[`${k.layer}.tlg`]
      if (!ref) throw new Error(`PIMG 里没有层 ${k.layer}`)
      return tlgToPng(psb.resources()[ref.resource])
    }
    case 'dpak-member': {
      const psb = new Psb(data)
      const ref = psb.root()[k.member]
      if (!ref) throw new Error(`dpak 里没有成员 ${k.member}`)
      const bytes = psb.resources()[ref.resource]
      return isTlg(bytes) ? tlgToPng(bytes) : bytes
    }
    case 'ev-composite': return composeEvVariant(new Psb(data), k)
    default: return data
  }
}
// PNG 的 oFFs 块（KiriKiri 的叠加层 PNG 自带摆放位置：x / y 是左上角在 1920×1080 页里的位置，vpAg = 页大小）
function pngOffset(buf) {
  let p = 8
  while (p + 12 <= buf.length) {
    const n = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    if (type === 'oFFs' && n >= 8) return { x: buf.readInt32BE(p + 8), y: buf.readInt32BE(p + 12) }
    if (type === 'IDAT' || type === 'IEND') break
    p += 12 + n
  }
  return { x: 0, y: 0 }
}
let sharpPromise = null
const loadSharp = () => (sharpPromise ||= import('sharp').then((m) => m.default || m).catch(() => null))
// RGBA → PNG（大纹理走 sharp，低压缩等级；没有 sharp 退回自带的编码器）
async function rgbaToPng({ width, height, data }) {
  const sharp = await loadSharp()
  if (sharp) return sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 2 }).toBuffer()
  return encodePng(width, height, 4, data)
}
// 底图（TLG）+ 叠加层（PNG，按 oFFs 摆）→ 一张 PNG；没有 sharp / 叠加层坏了 = 只返回底图
async function composeEvVariant(psb, k) {
  const root = psb.root()
  const res = psb.resources()
  const baseRef = root[k.member]
  if (!baseRef) throw new Error(`dpak 里没有成员 ${k.member}`)
  const baseBytes = res[baseRef.resource]
  const sharp = isTlg(baseBytes) && k.overlays?.length ? await loadSharp() : null
  if (!sharp) return isTlg(baseBytes) ? tlgToPng(baseBytes) : baseBytes
  const base = decodeTlg(baseBytes)
  const layers = []
  for (const name of k.overlays) {
    const ref = root[name]
    if (!ref) continue
    const buf = res[ref.resource]
    const { x, y } = pngOffset(buf)
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // 叠加层超出底图的部分裁掉（sharp 的 composite 不接受越界）
    const left = Math.max(0, -x)
    const top = Math.max(0, -y)
    const width = Math.min(info.width - left, base.width - Math.max(0, x))
    const height = Math.min(info.height - top, base.height - Math.max(0, y))
    if (width <= 0 || height <= 0) continue
    const cropped = Buffer.alloc(width * height * 4)
    for (let row = 0; row < height; row++) data.copy(cropped, row * width * 4, ((top + row) * info.width + left) * 4, ((top + row) * info.width + left + width) * 4)
    layers.push({ input: cropped, raw: { width, height, channels: 4 }, left: Math.max(0, x), top: Math.max(0, y) })
  }
  if (!layers.length) return tlgToPng(baseBytes)
  return sharp(base.data, { raw: { width: base.width, height: base.height, channels: base.channels } }).ensureAlpha().composite(layers).png().toBuffer()
}
// 虚拟索引里按路径找条目（krkr：立绘的层是现算的，不在表里）
function hitFor(v, rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '')
  const key = clean.toLowerCase()
  return v.map.get(key) || v.dynamic?.(key, clean) || null
}
// 取一个虚拟条目的字节（转好格式 / 解好密的）
async function readHit(hit) {
  if (hit.krkr) return readKrkrHit(hit)
  const handle = await open(hit.file, 'r')
  try {
    const data = await readRange(handle, hit.offset, hit.size)
    return await transformDataAsync(data, hit)
  } finally { await handle.close().catch(() => {}) }
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
      if (!(cfg.format === 'pf8' ? /\.pfs(\.\d+)?$/i : cfg.format === 'krkr' ? /\.xp3$/i : /\.arc$/i).test(arcName)) continue
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
  if (cfg.format === 'krkr') return buildKrkrVirtual(mediaDir, cfg, arcs, sig)
  const map = new Map()
  const files = []
  const add = (rel, hit) => { const key = rel.toLowerCase(); if (!map.has(key)) { map.set(key, { rel, ...hit }); files.push(rel) } }
  for (const { arcName, file, rule } of arcs) {
    let entries
    let key = null
    try { ({ entries, key } = await readIndexFor(file, cfg)) } catch { continue }
    if (entries.length > cfg.maxEntries) continue
    const stem = cfg.format === 'pf8' ? pf8Stem(arcName) : withoutExt(arcName)
    const base = `${cfg.dir}/res/${stem}`
    let handle = null
    try {
      for (const entry of entries) {
        const name = safeEntryName(entry.name)
        if (!name) continue
        if (cfg.format === 'buriko') {
          // BGI：图 / 声音按内容认（CompressedBG → .png、BW → .ogg），虚拟路径 = <dir>/res/<名字>.<扩展名>（flat：不带容器名）；取出来时才转格式
          if (entry.size > MAX_ENTRY_BYTES || !rule.kinds.has('res')) continue
          if ((rule.include.length && !rule.include.some((re) => re.test(name))) || rule.exclude.some((re) => re.test(name))) continue
          handle ||= await open(file, 'r')
          const cls = await classifyBuriko(handle, entry).catch(() => ({ kind: '' }))
          if (cls.kind === 'res') add(`${cfg.dir}/${resRel(cfg, stem, `${name}.${cls.ext}`)}`, { file, offset: entry.offset, size: entry.size, transform: cls.transform, ...(cls.w ? { w: cls.w, h: cls.h } : {}) })
          continue
        }
        if (cfg.format === 'arcfam') {
          // 自有 arc：图 / 声音（没压缩的），虚拟路径 = <dir>/res/<名字（大写）>（flat：不带容器名）
          if (entry.size > MAX_ENTRY_BYTES || !rule.kinds.has('res') || classifyArcfam(name, entry).kind !== 'res') continue
          if ((rule.include.length && !rule.include.some((re) => re.test(name))) || rule.exclude.some((re) => re.test(name))) continue
          add(`${cfg.dir}/${resRel(cfg, stem, name)}`, { file, offset: entry.offset, size: entry.size })
          continue
        }
        if (cfg.format === 'pf8') {
          // Artemis：图 / 声音，虚拟路径 = <dir>/res/<条目路径>（flat：不带容器名）；取出来时才解密
          if (entry.size > MAX_ENTRY_BYTES || !rule.kinds.has('res') || classifyPf8(name).kind !== 'res') continue
          if ((rule.include.length && !rule.include.some((re) => re.test(name))) || rule.exclude.some((re) => re.test(name))) continue
          add(`${cfg.dir}/${resRel(cfg, stem, name)}`, { file, offset: entry.offset, size: entry.size, transform: 'pf8', key })
          continue
        }
        const kind = kindOf(name, 'script')
        if (!kind || kind === 'script' || !rule.kinds.has(kind) || (kind === 'pna' && rule.pna === 'skip')) continue
        if ((rule.include.length && !rule.include.some((re) => re.test(name))) || rule.exclude.some((re) => re.test(name))) continue
        if (entry.size > MAX_ENTRY_BYTES) continue
        if (kind === 'res' || rule.pna === 'raw') { add(`${base}/${name}`, { file, offset: entry.offset, size: entry.size }); continue }
        try {
          handle ||= await open(file, 'r')
          const layout = await readPnaLayout(handle, entry.offset, entry.size)
          { const kind = pnaKind(layout.magic); layout.frames.forEach((f, i) => { if (f.size > 0) add(`${base}/${name}/${i}.${f.fmt || 'bin'}`, { file, offset: f.pos, size: f.size, ...(kind.premultiplied && f.fmt === 'png' ? { unpremultiply: true } : {}) }) }) }
        } catch { /* 这个 PNA 坏了：当没有（展开时已经在报告里记了） */ }
      }
    } finally { await handle?.close().catch(() => {}) }
  }
  if (cfg.format === 'buriko') markFrameSheets(map)
  return { map, files, sig }
}

// BGI 的立绘部件（表情 / 嘴 / 眼：<角色>_<尺寸>_<种类>_<编号>，如 no01_m_e_a01）：眨眼 / 说话的几帧竖着拼在一张图里（真实样本：no01_m 的眼 1330×2550 = 3 × 850，嘴 1330×850 = 1 帧；ai01_m 的 1620×3840 = 3 × 1280、1620×5120 = 4 × 1280）。
// 同一组（<角色>_<尺寸>）里同宽的部件，最矮的高度 = 一帧；比它高 1.5 倍以上而且正好是整数倍的 = 多帧的图，取出来时只留第一帧（hit.crop = 一帧的高度）
function markFrameSheets(map) {
  const groups = new Map()
  for (const hit of map.values()) {
    if (hit.transform !== 'cbg-png' || !hit.w) continue
    const m = /^([a-z0-9]+_[a-z0-9]+)_[a-z]+_[^/]*\.png$/i.exec(hit.rel.replace(/^.*\//, ''))
    if (!m) continue
    const key = m[1].toLowerCase()
    const g = groups.get(key)
    if (g) g.push(hit); else groups.set(key, [hit])
  }
  for (const list of groups.values()) {
    for (const hit of list) {
      const frame = Math.min(...list.filter((o) => Math.abs(o.w - hit.w) <= hit.w * 0.03).map((o) => o.h))   // 宽度差 3% 以内算同一种窗口（no04_m 的眼 1260 宽、嘴 1270 宽）
      if (hit.h >= frame * 1.5 && hit.h % frame === 0) hit.crop = frame
      else if (hit.h >= frame * 1.4) for (const n of [3, 4]) if (hit.h % n === 0 && Math.abs(hit.h / n - frame) <= frame * 0.06) { hit.crop = hit.h / n; break }   // 4650 = 3 × 1550，同组最矮是 1490（no04_l）：差 6% 以内也按 3 / 4 帧算
    }
  }
}

// 当前的虚拟索引（不是 hybrid / 没启用 = null）。.arc 没变就沿用；并发调用共用一次重建
export async function virtualIndex({ mediaDir, config }) {
  const cfg = config?.containers
  if (!isHybrid(cfg) || !mediaDir) return null
  const arcs = await listArcs(mediaDir, cfg)
  const sig = arcs.map((a) => a.sig).join('|') + (cfg.format === 'krkr' ? await krkrRefsSig(mediaDir, cfg) : '')
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

// 只问「有没有」：路径（候选几个）里第一个属于虚拟索引的条目，返回它将来落盘的相对路径（不读 .arc 里的内容、不写文件）；没有 = ''。
// 列表阶段的存在性检查（封面 / 语音有没有）用它，不然每检查一张图就得把原图解压出来
export async function virtualHas({ mediaDir, config, rels }) {
  const cfg = config?.containers
  if (!isHybrid(cfg) || !rels?.length) return ''
  const v = await virtualIndex({ mediaDir, config }).catch(() => null)
  if (!v) return ''
  for (const rel of rels) {
    const hit = hitFor(v, rel)
    if (hit) return hit.rel
  }
  return ''
}

// 缩略图用：路径（候选几个）里第一个属于虚拟索引的条目，不落盘——返回 { key（同一份内容同一个 key：.arc 的路径 / 大小 / 修改时间 + 条目位置 + 是否转直通）, read()（取出字节；PNAP 帧已转直通） }；没有 = null
export async function virtualEntry({ mediaDir, config, rels }) {
  const cfg = config?.containers
  if (!isHybrid(cfg) || !rels?.length) return null
  const v = await virtualIndex({ mediaDir, config }).catch(() => null)
  if (!v) return null
  for (const rel of rels) {
    const hit = hitFor(v, rel)
    if (!hit) continue
    const st = await stat(hit.file).catch(() => null)
    if (!st) continue
    const key = createHash('sha1').update(JSON.stringify([hit.file, st.size, Math.round(st.mtimeMs), hit.offset, hit.size, Boolean(hit.unpremultiply), hit.transform || '', hit.crop || 0, hit.krkr ? [hit.krkr.id, hit.krkr.mode || '', hit.krkr.layer || '', hit.krkr.member || '', hit.krkr.overlays || ''] : 0, CONTAINER_FORMAT_VERSION])).digest('hex')
    return {
      key,
      rel: hit.rel,
      read() { return readHit(hit) },
    }
  }
  return null
}

// 把请求到的路径（相对媒体目录，可以有几个候选）里属于虚拟索引的、磁盘上还没有的，从 .arc 里读出来写成文件（先写临时文件再改名；同一个文件并发请求只取一次）。返回取出了几个
export async function materialize({ mediaDir, config, rels }) {
  const cfg = config?.containers
  if (!isHybrid(cfg) || !rels?.length) return 0
  const v = await virtualIndex({ mediaDir, config }).catch(() => null)
  if (!v) return 0
  let n = 0
  for (const rel of rels) {
    const hit = hitFor(v, rel)
    if (!hit) continue
    const target = path.join(mediaDir, ...hit.rel.split('/'))
    try { const have = await stat(target); if (hit.unpremultiply || hit.transform ? have.size > 0 : have.size === hit.size) continue } catch { /* 还没有 */ }   // 转过的（预乘 → 直通）大小和 .arc 里的不一样：只看有没有
    let pending = materializing.get(target)
    if (!pending) {
      pending = (async () => {
        const data = await readHit(hit)   // PNAP 的帧：预乘 → 直通（转不了就原样）；BGI：CompressedBG → PNG、BW → Ogg；KiriKiri：段拼起来 + 解密
        await mkdir(path.dirname(target), { recursive: true })
        const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
        await writeFile(tmp, data)
        await rename(tmp, target)
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
      if (!(cfg.format === 'pf8' ? /\.pfs(\.\d+)?$/i : cfg.format === 'krkr' ? /\.xp3$/i : /\.arc$/i).test(arcName)) continue
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
      const stem = cfg.format === 'pf8' ? pf8Stem(arcName) : withoutExt(arcName)
      const tmp = path.join(outRoot, `.tmp-${process.pid}-${Date.now()}`)
      try {
        const result = await (cfg.format === 'krkr' ? expandKrkr({ file, arcName, rule, cfg, outRoot: tmp, budget }) : expandArc({ file, arcName, rule, cfg, outRoot: tmp, budget }))
        // 先展开到临时目录，再整体换掉这个容器的两个子目录（中途失败不会留下半截内容）
        for (const part of ['script', 'res', 'refs']) {
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
