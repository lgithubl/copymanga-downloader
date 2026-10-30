// 测试用：WillPlus AdvHD 的合成数据（不含任何真实游戏资源）——ws2 编码器（decodeWs2 的逆）、ARC / PNA 打包、一个能放进媒体目录的小游戏。
//   ws2Encode([['SetBackground', ['bg01', 'BG_01.PNG']], { label: 'a' }, ['Jump', [{ ref: 'a' }]], …]) → 已 ROR2 加密的 .ws2 字节
//   指令的 args = 解码器给出的那个扁平数组（数组型操作数 = 个数 + 元素，如 DisplayCharacterImage 的 [图层, u8, u8, 个数, ...图片 id]）；ShowChoice 的选项放第 3 项；{ ref: '标签' } = 指向标签偏移的 u32 指针
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { OPCODE_LAYOUTS, OPCODE_NAMES } from '../../web/library/gal/adapters/advhd-ws2-decode.mjs'

// 指令名 → opcode（编码器用解码器导出的引擎操作数表，保证和引擎的布局一致）
const OP_OF = Object.fromEntries(Object.entries(OPCODE_NAMES).map(([op, name]) => [name, Number(op)]))
const rol2 = (buffer) => Buffer.from(buffer.map((x) => ((x << 2) | (x >> 6)) & 0xff))
const str = (text) => Buffer.concat([Buffer.from(String(text), 'utf16le'), Buffer.from([0, 0])])
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
const f32 = (n) => { const b = Buffer.alloc(4); b.writeFloatLE(n); return b }

function encodeOne(item, labels) {
  const [name, args = [], extra] = item
  const op = OP_OF[name] ?? (/^Op[0-9A-F]{2}$/.test(name) ? parseInt(name.slice(2), 16) : undefined)
  if (op === undefined) throw new Error(`encoder: unknown op ${name}`)
  const ptr = (value) => (value && typeof value === 'object' ? (labels ? labels.get(value.ref) ?? 0 : 0) : Number(value))
  const parts = [Buffer.from([op])]
  if (name === 'FileEnd') return Buffer.concat([parts[0]])
  if (name === 'ShowChoice') {
    parts.push(Buffer.from([extra.length]))
    for (const c of extra) {
      parts.push(u16(c.id), str(c.text), Buffer.from([...c.flags, c.jump]))
      parts.push(c.jump === 6 ? u32(ptr(c.target)) : str(c.target))
    }
    return Buffer.concat(parts)
  }
  const layout = OPCODE_LAYOUTS[op]
  if (!layout) throw new Error(`encoder: no layout for ${name}`)
  let i = 0
  const put = (kind, v) => parts.push(kind === 'b' ? Buffer.from([v]) : kind === 'w' ? u16(v) : kind === 'd' ? u32(ptr(v)) : kind === 'f' ? f32(v) : str(v))
  for (const kind of layout) {
    if (kind[0] === 'a') { const n = args[i++]; parts.push(Buffer.from([n])); for (let k = 0; k < n; k++) put(kind[1], args[i++]) } else put(kind, args[i++])
  }
  if (i !== args.length) throw new Error(`encoder: ${name} takes ${i} args, got ${args.length}`)
  return Buffer.concat(parts)
}

export function ws2Plain(items) {
  const labels = new Map()
  const run = (resolve) => {
    let pos = 0
    const chunks = []
    for (const item of items) {
      if (!Array.isArray(item)) { labels.set(item.label, pos); continue }
      const chunk = encodeOne(item, resolve ? labels : null)
      chunks.push(chunk)
      pos += chunk.length
    }
    return Buffer.concat(chunks)
  }
  run(false)
  return Buffer.concat([run(true), Buffer.alloc(8)])   // 文件尾 8 字节（两个 u32）
}
export const ws2Encode = (items) => rol2(ws2Plain(items))

// ---- ARC：u32 条目数、u32 目录大小、{ u32 大小, u32 相对偏移, UTF-16LE 名字 + NUL }…，数据在 8 + 目录大小 + 相对偏移
export function arcBuild(entries) {
  let rel = 0
  const dir = []
  for (const entry of entries) {
    dir.push(u32(entry.data.length), u32(rel), str(entry.name))
    rel += entry.data.length
  }
  const dirBuf = Buffer.concat(dir)
  return Buffer.concat([u32(entries.length), u32(dirBuf.length), dirBuf, ...entries.map((e) => e.data)])
}

// 1×1 的合法 PNG（给 PNA 帧 / 图片用）；tag 不同内容不同（测试里区分是哪一帧）
export function pngBytes(tag = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([u32be(data.length), body, u32be(crc(body))]) }
  const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
  const ihdr = Buffer.concat([u32be(1), u32be(1), Buffer.from([8, 6, 0, 0, 0])])
  const raw = Buffer.from([0, tag & 0xff, 0x80, 0x40, 0xff])   // 过滤字节 + RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- PNA：魔数 + u32 + 宽 + 高 + 帧数，每帧 40 字节 { u32 type, i32 id, i32 x, i32 y, u32 w, u32 h, u32 0, f64 scale, u32 size }，PNG 数据按顺序跟在索引后面
export function pnaBuild({ magic = 'PNAP', width = 100, height = 200, frames }) {
  const head = Buffer.concat([Buffer.from(magic, 'latin1'), u32(width + height), u32(width), u32(height), u32(frames.length)])
  const recs = []
  const bodies = []
  for (const frame of frames) {
    const rec = Buffer.alloc(40)
    rec.writeUInt32LE(frame.type ?? 0, 0)
    rec.writeInt32LE(frame.id ?? -1, 4)
    rec.writeInt32LE(frame.x ?? 0, 8)
    rec.writeInt32LE(frame.y ?? 0, 12)
    rec.writeUInt32LE(frame.w ?? 0, 16)
    rec.writeUInt32LE(frame.h ?? 0, 20)
    rec.writeDoubleLE(frame.scale ?? 1, 28)
    const body = frame.data || Buffer.alloc(0)
    rec.writeUInt32LE(body.length, 36)
    recs.push(rec)
    bodies.push(body)
  }
  return Buffer.concat([head, ...recs, ...bodies])
}

// ---- 一个小游戏：<dir>/{Script2.arc, Rio.arc（UI / 辅助脚本）, Rio1.arc（剧情）, Chip3.arc（图 + 立绘 PNA）, Voice.arc, Bgm.arc, Se.arc, AdvHD.exe}
const z = (n) => new Array(n).fill(0)
export const sfx = (channel, file) => ['SoundEffect', [channel, file, 0, 0, 0, 0, 0, 0, 0, 0, 0]]
export const msg = (id, text) => ['DisplayMessage', [id, 'char', text, 0]]
export const name = (who) => ['SetDisplayName', [who, 0]]
export const bg = (layer, file) => ['SetBackground', [layer, file, 1, 1]]
export const commit = (fade = 0, mask = '') => ['Unk65', [0, 0, fade, 0, 0, mask]]
export const music = (file) => ['PlayMusic', ['bgm01', file, 0, 0, 0, 0, 0, 0]]

export const STORY_001 = [
  ['ClearLayer', ['*']], bg('bg01', 'BG_01.PNG'), commit(0.5), music('BGM01.OGG'),
  sfx('charTOW', 'TW_0001.OGG'), name('%LC透羽'), msg(0, '「{應賀:おうが}です。\\nよろしく」%K%P'),
  name(''), msg(1, 'ナレーション%K%P'),
  ['UsePnaPackage', ['st01', 'ST_TOW_A_M.PNA', 1, 1]], ['DisplayCharacterImage', ['st01', 2, 1, 2, 1, 3]], ['RunFile', ['LAYER_ORDER']], ['MoveBackground', ['st01', 0, 0, 100, 50, 0, 0]], commit(0.2),
  sfx('charTOW', 'TW_0002.OGG'), name('%LC透羽'), msg(2, '立ち絵あり%K%P'),
  ['ClearLayer', ['ev01']], bg('ev01', 'EV_01.PNG'), commit(0), msg(3, 'CG%K%P'),
  sfx('bgvtow', 'SV_TOW_01.OGG'), sfx('se01', 'SE_01.OGG'), msg(4, '背景人声と効果音%K%P'),
  ['ExecuteFunction', ['GetMsgSkip', '', 999, 1]], ['ExecuteFunction', ['playSpecialEffect', 'x', 0, 0]],
  ['Effect1', ['bg01', 'effect01', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], ['Effect3', ['bg01', 'effect01']], ['UnkAF', [255, 255, 0, 0, 1, 0]],
  ['StopMusic', ['bgm01', 1]], msg(5, '終わり%K%P'),
  ['NextFile', ['002_00_H']], ['FileEnd', []],
]

// 分支：第一个选项 → 本脚本里的标签（汇合点 merge），第二个选项 → 另一个标签；两个分支各有台词，汇合后共用一句；还有一个跳到别的脚本的选项（jump 7）
export const STORY_BRANCH = [
  ['ClearLayer', ['*']], bg('bg01', 'BG_01.PNG'), commit(0),
  msg(0, '選んでください%K%P'),
  ['ShowChoice', [3], [
    { id: 1, text: '左へ', flags: [0, 1, 0], jump: 6, target: { ref: 'left' } },
    { id: 2, text: '右へ', flags: [0, 2, 0], jump: 6, target: { ref: 'right' } },
    { id: 3, text: '別の話へ', flags: [0, 3, 0], jump: 7, target: 'OTHER_00' },
  ]],
  { label: 'left' }, msg(1, '左の道%K%P'), ['Jump', [{ ref: 'merge' }]],
  { label: 'right' }, msg(2, '右の道%K%P'),
  { label: 'merge' }, msg(3, '合流%K%P'),
  ['FileEnd', []],
]

// 条件 + 标志：SetFlag(10,1) 后 Condition(==, 10, 1) 真 → 继续；Condition(==, 11, 1)（没设过的变量）按 flags.unknown（默认真）；127 默认 0（flags.values）
export const STORY_COND = [
  ['SetFlag', [10, 1]],
  ['Condition', [2, 10, 1, 0, { ref: 'else1' }]], msg(0, 'flag10 = 1 の道%K%P'), ['Jump', [{ ref: 'after1' }]],
  { label: 'else1' }, msg(1, 'あり得ない道%K%P'),
  { label: 'after1' },
  ['Condition', [2, 127, 1, 0, { ref: 'normal' }]], msg(2, '127 = 1 の道（既定では通らない）%K%P'),
  { label: 'normal' }, msg(3, '通常%K%P'),
  ['ConditionalJump', [{ ref: 'skipA' }, { ref: 'skipB' }]], msg(4, 'アニメ A%K%P'),
  { label: 'skipA' }, msg(5, 'アニメ B%K%P'),
  { label: 'skipB' }, msg(6, '終端%K%P'),
  ['FileEnd', []],
]

// GetMsgSkip 之后的版式（样本里 253 处）：Condition(==, 999, 1, p1 = else 块, p2 = 结尾)；真块 StopMusic(0) + Jump2 p2；假块（p1 起）StopMusic(1)
export const STORY_SKIP = [
  ['ExecuteFunction', ['GetMsgSkip', '', 999, 1]],
  ['Condition', [2, 999, 1, { ref: 'else' }, { ref: 'end' }]],
  ['StopMusic', ['bgm01', 0]], ['Jump2', [{ ref: 'end' }]],
  { label: 'else' }, ['StopMusic', ['bgm01', 1]],
  { label: 'end' }, msg(0, '終わり%K%P'),
  ['FileEnd', []],
]

// CG 画廊页（Rio.arc 的 CG_PAGE.ws2）：一长串「页码 / 选中格」Condition + openCgBrowser(图) 的查表；前 3 个能解析（BG_01、EV_01、BG_01/EV_01 两层），后面 17 个图不存在
export const STORY_GALLERY = [
  ['SetVariable', ['@GALLERYBG', '']],
  ['Condition', [130, 105, 1, 0, 0]],
  ...Array.from({ length: 20 }, (_, i) => [
    ['Condition', [2, 1620 + i, 1, 0, 0]],
    ['ExecuteFunction', ['openCgBrowser', i === 0 ? 'BG_01.png' : i === 1 ? 'EV_01.png' : i === 2 ? 'BG_01.png/EV_01.png' : `NOPE_${i}.png`, 0, 0]],
    ...(i === 9 ? [['Condition', [130, 105, 2, 0, 0]]] : []),
  ]).flat(),
  ['FileEnd', []],
]

// 长背景图平移：MoveBackground 组 0 = 基准位置 (0, -250)；DragBackground 把位置读进寄存器 1 / 2 / 3；SetRegister 写 5 = 0、6 = -400，再 6 += 寄存器 2（-250）= -650；Effect1 种类 1（位置偏移），位掩码 0xC0（f0 / f1 是寄存器 5 / 6）、缓动 3、时长 40 秒、延迟 0.5 秒
export const STORY_PAN = [
  ['ClearLayer', ['*']], bg('bg01', 'BG_01.PNG'), ['MoveBackground', ['bg01', 0, 0, 0, -250, 0, 0]], commit(0),
  ['DragBackground', ['bg01', 0, 1, 2, 3, 0]], ['SetRegister', [0, 5, 0]], ['SetRegister', [0, 6, -400]], ['SetRegister', [0x81, 6, 2]],
  ['Effect1', ['bg01', 'effect01', 1, 3, 0xc0, 5, 6, 0, 0, 40, 0, 0.5]], ['Effect2', ['bg01', 'effect01', 0, 0, 0, '']],
  msg(0, '平移%K%P'),
  ['FileEnd', []],
]

// 立绘位置偏移（Effect1 种类 1 用在立绘上）：寄存器 5 = 0、6 = 10；两个同时跑的动画：+10 再 -10（净偏移 0）+ 一个 +4
export const STORY_BOB = [
  ['ClearLayer', ['*']], bg('bg01', 'BG_01.PNG'),
  ['UsePnaPackage', ['st01', 'ST_TOW_A_M.PNA', 1, 1]], ['DisplayCharacterImage', ['st01', 2, 1, 1, 1]], ['MoveBackground', ['st01', 0, 0, 100, 50, 0, 0]], commit(0),
  ['SetRegister', [0, 5, 0]], ['SetRegister', [0, 6, 10]],
  ['Effect1', ['st01', 'effect01', 1, 3, 0xc0, 5, 6, 0, 0, 0.3, 0, 0]],
  ['SetRegister', [0, 6, -10]],
  ['Effect1', ['st01', 'effect01', 1, 3, 0xc0, 5, 6, 0, 0, 0.3, 0, 0.1]],
  ['Effect1', ['st01', 'ST_QUAKE', 1, 1, 0, 2, 2, 0, 0, 0.025, 0, 0]],
  msg(0, '晃动%K%P'),
  ['FileEnd', []],
]

// 计时器 + 遮罩过渡（Unk65 的最后一个参数是遮罩图）+ 电影
export const STORY_TIMER = [
  ['ClearLayer', ['*']], bg('bg01', 'BG_01.PNG'), ['SetTimer', ['timer01', 0, 2]], ['StartTimer', ['timer01', 1, '']], commit(0.5),
  ['SetTimer', ['timer02', 0, 99]], ['StartTimer', ['timer02', 1, '']], ['StartTimer', ['timer03', 1, '']],
  ['ShowGraphic', ['EFMSK_12.PNG']], ['ClearLayer', ['*']], bg('ev01', 'EV_01.PNG'), ['Unk65', [0, 100, 0.7, 0, 2, 'EFMSK_12.PNG']],
  ['PlayMovie', ['movie', 'OP.DAT', 1, 1, 1]], ['PlayMovie', ['movie', 'GONE.DAT', 1, 1, 1]],
  msg(0, '終わり%K%P'),
  ['FileEnd', []],
]

export async function buildAdvhdFixture(dir, { voices = true, brokenArc = false } = {}) {
  await mkdir(dir, { recursive: true })
  const put = (rel, data) => writeFile(path.join(dir, rel), data)
  await put('Script2.arc', arcBuild([{ name: 'ArcFileName.lua', data: Buffer.from('-- lua') }]))
  await put('Rio.arc', arcBuild([{ name: 'LAYER_ORDER.ws2', data: ws2Encode([['FileEnd', []]]) }, { name: 'title.ws2', data: ws2Encode([['FileEnd', []]]) }, { name: 'CG_PAGE.ws2', data: ws2Encode(STORY_GALLERY) }]))
  await mkdir(path.join(dir, 'movie'), { recursive: true })
  await put('movie/OP.DAT', 'movie-bytes')
  await put('Rio1.arc', arcBuild([
    { name: '001_00.ws2', data: ws2Encode(STORY_001) },
    { name: '002_00_H.ws2', data: ws2Encode(STORY_BRANCH) },
    { name: '003_00.ws2', data: ws2Encode(STORY_COND) },
    { name: 'readme.txt', data: Buffer.from('not a script') },
  ]))
  await put('Chip3.arc', arcBuild([
    { name: 'BG_01.png', data: pngBytes(1) },
    { name: 'EV_01.png', data: pngBytes(2) },
    { name: 'ST_TOW_A_M.pna', data: pnaBuild({ width: 600, height: 800, frames: [
      { type: 1 }, { type: 0, id: 3, x: 100, y: 200, w: 300, h: 400, data: pngBytes(11) }, { type: 0, id: 2, x: 0, y: 0, w: 10, h: 10, data: pngBytes(12) },
      { type: 0, id: 1, x: 50, y: 60, w: 20, h: 30, data: pngBytes(13) }, { type: 2 },   // 记录里的 id 字段是倒序的（真实 UI 包就是 (帧数 - 1) - 序号）；脚本用的是序号
    ] }) },
  ]))
  if (voices) await put('Voice.arc', arcBuild([{ name: 'TW_0001.ogg', data: Buffer.from('OggS-1') }, { name: 'TW_0002.ogg', data: Buffer.from('OggS-2') }, { name: 'SV_TOW_01.ogg', data: Buffer.from('OggS-3') }]))
  await put('Bgm.arc', arcBuild([{ name: 'BGM01.ogg', data: Buffer.from('OggS-bgm') }]))
  await put('Se.arc', arcBuild([{ name: 'SE_01.ogg', data: Buffer.from('OggS-se') }]))
  if (brokenArc) await put('Chip9.arc', Buffer.from('this is not an arc at all, just text........'))
  await put('AdvHD.exe', 'MZ')
}
