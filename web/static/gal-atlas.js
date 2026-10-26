// 图集（Cocos2d / TexturePacker 的 plist）：解析 + 取帧的纯逻辑。不碰 DOM，Node 里直接单测（scripts/dev/gal-sprites-selftest.mjs）。
// 播放器（gal-stand.js）拉到 plist 文本后调 parsePlist → atlasFrames，再用 resolveAtlasFrames / framePlacement 算出每一帧在贴图里的裁剪区和在「原图画布」里的位置。
//
// plist 是 Apple 的 XML 属性列表。这里只实现够用的一小块：dict / array / key / string / integer / real / true / false / data / date，
// 不依赖外部库、不展开实体以外的任何东西（没有 DOCTYPE 解析 / 外部实体），大小和嵌套深度都有上限——输入是服务端资源（半可信），解析失败直接抛错，调用方当「缺资源」处理。
//
// 帧（frame）= { name, rect: [x, y, w, h], rotated, offset: [ox, oy], size: [w, h], source: [w, h] }
//   rect     帧在贴图里占的区域（已经考虑旋转：rotated 时占 h×w）；size 是帧还原（转回正）之后的宽高；
//   source   原图画布大小（spriteSourceSize）：同一个图集里的帧（身体 / 各个表情）共用同一块画布，各自按 offset 摆放；
//   offset   Cocos2d 约定：帧（裁掉透明边之后）的中心相对画布中心的偏移，y 向上为正。
// 支持格式 3（spriteOffset / spriteSize / spriteSourceSize / textureRect / textureRotated）和格式 2（frame / offset / sourceSize / rotated）。
// textureRotated = true：TexturePacker 把帧顺时针转了 90° 存进贴图，还原要逆时针转 90°。（这是按 TexturePacker 文档的约定，没有真实旋转帧样本验证。）

export const PLIST_MAX_BYTES = 4 * 1024 * 1024
const MAX_DEPTH = 16
const MAX_NODES = 200000
const MAX_FRAMES = 20000

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  }
  return ENTITIES[e.toLowerCase()] ?? m
})

// XML plist → JS 值（dict → 无原型对象，array → 数组，integer / real → 数字，true / false → 布尔，string / key / date / data → 字符串）
export function parsePlist(text) {
  const source = String(text ?? '')
  if (source.length > PLIST_MAX_BYTES) throw new Error('plist 太大')
  const tokenRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z][\w-]*)\s*(\/?)>|([^<]+)/g
  const stack = []   // { type: 'dict'|'array', value, key }
  let root
  let rootSet = false
  let nodes = 0
  let pending = null   // 当前叶子元素 { tag, text }
  const put = (value) => {
    nodes += 1
    if (nodes > MAX_NODES) throw new Error('plist 节点太多')
    const top = stack[stack.length - 1]
    if (!top) { if (!rootSet) { root = value; rootSet = true } return }
    if (top.type === 'array') { top.value.push(value); return }
    if (top.key === null) throw new Error('plist dict 缺 key')
    top.value[top.key] = value
    top.key = null
  }
  const leaf = (tag, body) => {
    switch (tag) {
      case 'integer': case 'real': { const n = Number(body.trim()); if (!Number.isFinite(n)) throw new Error('plist 数字不合法'); put(n); break }
      case 'string': case 'date': case 'data': put(decode(body)); break
      case 'true': put(true); break
      case 'false': put(false); break
      default: throw new Error(`plist 不认识的元素 ${tag}`)
    }
  }
  let match
  while ((match = tokenRe.exec(source))) {
    const [whole, closing, rawTag, selfClosing, chars] = match
    if (chars !== undefined) { if (pending) pending.text += chars; continue }
    if (!rawTag) continue   // 注释 / 声明
    const tag = rawTag.toLowerCase()
    if (tag === 'plist') continue
    if (closing) {
      if (pending) {
        const { tag: leafTag, text: body } = pending
        pending = null
        if (leafTag !== tag) throw new Error('plist 标签不配对')
        if (tag === 'key') {
          const top = stack[stack.length - 1]
          if (!top || top.type !== 'dict') throw new Error('plist key 不在 dict 里')
          top.key = decode(body)
        } else leaf(tag, body)
        continue
      }
      const top = stack.pop()
      if (!top || top.type !== tag) throw new Error('plist 标签不配对')
      put(top.value)
      continue
    }
    if (tag === 'dict' || tag === 'array') {
      if (selfClosing) { put(tag === 'dict' ? Object.create(null) : []); continue }
      if (stack.length >= MAX_DEPTH) throw new Error('plist 嵌套太深')
      stack.push({ type: tag, value: tag === 'dict' ? Object.create(null) : [], key: null })
      continue
    }
    if (selfClosing) {
      if (tag === 'true' || tag === 'false') leaf(tag, '')
      else if (tag === 'string' || tag === 'data' || tag === 'date') leaf(tag, '')
      else if (tag === 'key') throw new Error('plist 空 key')
      else throw new Error(`plist 元素 ${tag} 不能自闭合`)
      continue
    }
    pending = { tag, text: '' }
  }
  if (stack.length || pending) throw new Error('plist 没有闭合')
  if (!rootSet) throw new Error('plist 是空的')
  return root
}

const numbersOf = (value) => (typeof value === 'string' ? (value.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) || []).map(Number) : [])
const pair = (value) => { const n = numbersOf(value); return n.length >= 2 ? [n[0], n[1]] : null }
const rectOf = (value) => { const n = numbersOf(value); return n.length >= 4 ? [n[0], n[1], n[2], n[3]] : null }
const positive = (a) => a && a[0] > 0 && a[1] > 0 && a[0] <= 16384 && a[1] <= 16384

// plist → { frames: Map<名字, 帧>, texture: 贴图文件名（相对 plist 目录；没写 = ''）, size: [w, h] | null }
export function atlasFrames(plist) {
  const frames = new Map()
  const table = plist && typeof plist === 'object' ? plist.frames : null
  if (!table || typeof table !== 'object' || Array.isArray(table)) return { frames, texture: '', size: null }
  const meta = plist.metadata && typeof plist.metadata === 'object' ? plist.metadata : {}
  for (const [name, raw] of Object.entries(table)) {
    if (frames.size >= MAX_FRAMES) break
    if (!raw || typeof raw !== 'object') continue
    let rect
    let size
    let offset
    let source
    let rotated
    if (raw.textureRect !== undefined) {   // 格式 3
      rect = rectOf(raw.textureRect)
      size = pair(raw.spriteSize) || (rect && [rect[2], rect[3]])
      offset = pair(raw.spriteOffset) || [0, 0]
      source = pair(raw.spriteSourceSize) || size
      rotated = raw.textureRotated === true
    } else if (raw.frame !== undefined) {   // 格式 2
      rect = rectOf(raw.frame)
      size = rect && [rect[2], rect[3]]
      offset = pair(raw.offset) || [0, 0]
      source = pair(raw.sourceSize) || size
      rotated = raw.rotated === true
    } else continue
    if (!rect || !positive(size) || !positive(source)) continue
    frames.set(name, { name, rect: [rect[0], rect[1], rotated ? size[1] : size[0], rotated ? size[0] : size[1]], rotated, offset, size, source })
  }
  return { frames, texture: String(meta.realTextureFileName || meta.textureFileName || ''), size: pair(meta.size) }
}

// 候选名（按顺序）里第一个存在的帧；都没有 = null
export function findFrame(frames, names) {
  for (const name of Array.isArray(names) ? names : [names]) if (typeof name === 'string' && frames.has(name)) return frames.get(name)
  return null
}

// atlas = { frame?|frames?: 候选帧名, base?: 底图帧名（存在才画，先画） }：返回要画的帧列表（底图 → 主帧）；主帧找不到 = null
export function resolveAtlasFrames(frames, atlas) {
  const main = findFrame(frames, atlas?.frames ?? atlas?.frame)
  if (!main) return null
  const out = []
  for (const name of Array.isArray(atlas.base) ? atlas.base : []) {
    const base = typeof name === 'string' ? frames.get(name) : null
    if (base && base !== main && !out.includes(base)) out.push(base)
  }
  out.push(main)
  return out
}

// 一帧在「画布中心为原点、y 向下」的坐标系里的位置和贴图裁剪区。
//   { sx, sy, sw, sh }：从贴图里取的区域；{ dx, dy }：帧中心相对画布中心的偏移（y 向下，已经把 plist 的 y 向上取反）；{ w, h }：还原后的宽高；rotated：画的时候要逆时针转 90°
export function framePlacement(frame) {
  const [sx, sy, sw, sh] = frame.rect
  return { sx, sy, sw, sh, dx: frame.offset[0], dy: -frame.offset[1], w: frame.size[0], h: frame.size[1], rotated: frame.rotated }
}
