// E-mote PSB → FreeMote WebGL SDK 能直接加载的「纯 PSB」（规格 common、贴图 RGBA）。纯函数，不碰磁盘；结果由 containers 的虚拟资源缓存落盘。
//   1) 头加密（emotedriver.dll 的 StructCryptFilter，见 psb.mjs 的 decryptPsbHeader）：解开，加密标志清零；种子每个游戏自己的
//   2) 规格：SDK 只认 `spec: "common"`（其它 = 「has not adaptive spec」），这个游戏是 "win"：字符串表里把它改成 "common"（字符串数据区变长，后面的段整体后移，头里的绝对偏移同步改）
//   3) 贴图字节序：win 规格的 RGBA8 贴图实际存的是 B G R A，common 要 R G B A：整张对调 R / B。order = 文件里存的顺序（'bgra' | 'rgba' | 'argb' | 'abgr'）；'auto' = win → bgra，其它 → rgba
//      （只在一个模型上验证过：kae_2 对调后颜色对了——粉头发、米色开衫；别的规格 / 游戏的字节序没看过，所以可以在 config.containers.emote.textureOrder 里改）
//   只支持未压缩的 RGBA8 贴图（texture.type === 'RGBA8'）；别的格式（RL 压缩 …）直接报错，不猜。
import { Psb, decryptPsbHeader } from './psb.mjs'

const ORDERS = { rgba: [0, 1, 2, 3], bgra: [2, 1, 0, 3], argb: [1, 2, 3, 0], abgr: [3, 2, 1, 0] }   // 目标 R G B A 各取存储里的第几个字节
export const EMOTE_TEXTURE_ORDERS = Object.keys(ORDERS)

function patchPsbString(buf, oldStr, newStr) {
  const p = new Psb(buf)
  const h = (i) => buf.readUInt32LE(8 + i * 4)
  const [offs] = p.uintArray(h(2))
  const idx = p.strings.indexOf(oldStr)
  if (idx < 0) throw new Error(`PSB 字符串表里没有「${oldStr}」`)
  const dataStart = h(3)
  const start = dataStart + offs[idx]
  const oldLen = Buffer.byteLength(oldStr) + 1
  const next = Buffer.concat([Buffer.from(newStr, 'utf8'), Buffer.from([0])])
  const delta = next.length - oldLen
  const out = Buffer.concat([buf.subarray(0, start), next, buf.subarray(start + oldLen)])
  const arrPos = h(2)
  const cn = buf[arrPos] - 0x0c
  const count = buf.readUIntLE(arrPos + 1, cn)
  const es = buf[arrPos + 1 + cn] - 0x0c
  const base = arrPos + 2 + cn
  for (let i = 0; i < count; i += 1) {
    if (offs[i] <= offs[idx]) continue
    const value = buf.readUIntLE(base + i * es, es) + delta
    if (value >= 2 ** (8 * es)) throw new Error('PSB 字符串偏移表的元素宽度不够（改规格会溢出）')
    out.writeUIntLE(value, base + i * es, es)
  }
  for (const i of [4, 5, 6, 9, 10, 11]) {   // resources / extra 的偏移表 + 数据的绝对位置
    const value = out.readUInt32LE(8 + i * 4)
    if (value > start) out.writeUInt32LE(value + delta, 8 + i * 4)
  }
  return out
}

function textureResources(root) {
  const out = []
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return
    if (node.pixel && typeof node.pixel === 'object' && 'resource' in node.pixel && typeof node.type === 'string') out.push(node)
    else for (const value of Object.values(node)) walk(value, depth + 1)
  }
  walk(root.source, 0)
  return out
}

// buf = pf8 解密后的 PSB；→ 纯 PSB（Buffer）
export function convertEmotePsb(buf, { seed = null, order = 'auto' } = {}) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'PSB\0') throw new Error('不是 PSB')
  let data = buf
  if (data.readUInt16LE(6) !== 0) {
    if (seed === null || seed === undefined) throw new Error('这个 PSB 的头是加密的：需要 config.containers.emote.seed（或放 emotedriver.dll 让它自动找）')
    data = decryptPsbHeader(data, seed)
  }
  const psb = new Psb(data)
  const root = psb.root()
  const spec = root.spec
  const textures = textureResources(root)
  for (const t of textures) if (t.type !== 'RGBA8') throw new Error(`贴图格式 ${t.type} 没做（只做了未压缩的 RGBA8）`)
  const stored = order === 'auto' ? (spec === 'win' ? 'bgra' : 'rgba') : order
  const map = ORDERS[stored]
  if (!map) throw new Error(`textureOrder 只能是 auto / ${EMOTE_TEXTURE_ORDERS.join(' / ')}`)
  if (map.join() !== '0,1,2,3') {
    const resources = psb.resources()   // 子数组，直接改 data（已经是拷贝：decryptPsbHeader 拷了；没加密时 data === buf，下面先拷）
    if (data === buf) data = Buffer.from(buf)
    const fresh = new Psb(data)
    const res = fresh.resources()
    void resources
    for (const t of textures) {
      const r = res[t.pixel.resource]
      if (!r) throw new Error('贴图资源缺失')
      const tmp = Buffer.alloc(4)
      for (let i = 0; i + 3 < r.length; i += 4) {
        tmp[0] = r[i + map[0]]; tmp[1] = r[i + map[1]]; tmp[2] = r[i + map[2]]; tmp[3] = r[i + map[3]]
        r[i] = tmp[0]; r[i + 1] = tmp[1]; r[i + 2] = tmp[2]; r[i + 3] = tmp[3]
      }
    }
  }
  return spec === 'common' ? data : patchPsbString(data, spec, 'common')
}

// 在游戏自带的 emotedriver.dll 里找头加密的种子：十进制数字串（5~10 位，后面是 NUL），逐个用第一个加密 PSB 的头验证（解出的头长度合理 + 名字表紧跟头、字符串表在名字表之后）；前后不要求 NUL（相邻的字符串可能紧挨着）
export function findEmoteSeed(dll, psbHead) {
  const text = dll.toString('latin1')
  const seen = new Set()
  for (const m of text.matchAll(/(?<![0-9])\d{5,10}(?=\0)/g)) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    const seed = Number(m[0])
    if (!Number.isSafeInteger(seed) || seed > 0xffffffff) continue
    try {
      const plain = decryptPsbHeader(psbHead, seed)
      if (plain.readUInt32LE(12) === plain.readUInt32LE(8) && plain.readUInt32LE(16) > plain.readUInt32LE(12)) return seed   // 名字表紧跟在头后面；字符串表在它之后
    } catch { /* 不是它 */ }
  }
  return null
}
