// Spine 3.6 二进制骨骼 → 3.6 JSON 骨骼（对象）。
// 为什么要有这个文件：官方 3.6 的 Web 运行时（spine-runtimes 的 3.6 分支，spine-ts/build/spine-webgl.js）只有 SkeletonJson，没有 SkeletonBinary
// （二进制加载器是 3.7 才加进 spine-ts 的）；但 3.6 的 libgdx / C / C# 运行时都有，二进制格式是公开的、固定的。
// 所以这里按 3.6 二进制格式把字节流读成 3.6 的 JSON 结构，再交给官方 3.6 运行时的 SkeletonJson 去建 SkeletonData
// （附件、网格、UV、约束都由官方运行时建，这里只做「格式转换」，不碰任何渲染逻辑）。
// 读取顺序对照的是 spine-runtimes 3.6 分支的 SkeletonBinary（libgdx 版）；用官方 3.6 示例里成对的 .skel / .json 逐项比对过（见 scripts/dev/fe-gal-spine36-selftest.mjs）。
// 已知取舍：转成 JSON 对象后，对象键序遵循 JS 规则——纯整数的名字（皮肤 / 动画 / 附件名叫 "1"、"2" 这种）会被排到最前面，动画列表顺序因此可能和文件里不同；不影响播放。

const TRANSFORM_MODES = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection']
const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen']
const ATTACHMENT_TYPES = ['region', 'boundingbox', 'mesh', 'linkedmesh', 'path', 'point', 'clipping']
const POSITION_MODES = ['fixed', 'percent']
const SPACING_MODES = ['length', 'fixed', 'percent']
const ROTATE_MODES = ['tangent', 'chain', 'chainScale']

const hex = (value, digits) => (value >>> 0).toString(16).padStart(8, '0').slice(8 - digits)
const rgba = (value) => hex(value, 8)
const rgb = (value) => hex(value & 0xffffff, 6)

class Reader {
  constructor(bytes) {
    this.u8 = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.pos = 0
    this.decoder = new TextDecoder('utf-8')
  }
  need(n) { if (this.pos + n > this.u8.length) throw new Error(`Spine 3.6 二进制骨骼读到文件末尾之外（偏移 ${this.pos}）`) }
  byte() { this.need(1); return this.view.getInt8(this.pos++) }
  bool() { return this.byte() !== 0 }
  short() { this.need(2); const v = this.view.getInt16(this.pos); this.pos += 2; return v }
  int() { this.need(4); const v = this.view.getInt32(this.pos); this.pos += 4; return v }
  float() { this.need(4); const v = this.view.getFloat32(this.pos); this.pos += 4; return v }
  varint(optimizePositive = true) {
    let result = 0
    for (let shift = 0, i = 0; i < 5; i++, shift += 7) {
      this.need(1)
      const b = this.u8[this.pos++]
      result |= (b & 0x7f) << shift
      if (!(b & 0x80)) break
    }
    return optimizePositive ? result >>> 0 : (result >>> 1) ^ -(result & 1)
  }
  string() {
    const count = this.varint()
    if (count === 0) return null
    if (count === 1) return ''
    this.need(count - 1)
    const text = this.decoder.decode(this.u8.subarray(this.pos, this.pos + count - 1))
    this.pos += count - 1
    return text
  }
  floats(n) { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = this.float(); return out }
  shorts() { const n = this.varint(); const out = new Array(n); for (let i = 0; i < n; i++) out[i] = this.short(); return out }
}

const pick = (list, index, what) => { if (index < 0 || index >= list.length) throw new Error(`Spine 3.6 二进制骨骼里的${what}序号 ${index} 越界`); return list[index] }

// 顶点：未绑定 = 2 个浮点一个顶点；绑定 = 每个顶点 boneCount + (bone, x, y, weight) × boneCount（和 3.6 JSON 的 vertices 数组同一个排法）
function readVertices(r, vertexCount) {
  if (!r.bool()) return r.floats(vertexCount << 1)
  const out = []
  for (let i = 0; i < vertexCount; i++) {
    const boneCount = r.varint()
    out.push(boneCount)
    for (let b = 0; b < boneCount; b++) out.push(r.varint(), r.float(), r.float(), r.float())
  }
  return out
}

function readAttachment(r, key, nonessential, slotNames) {
  const name = r.string()
  const type = pick(ATTACHMENT_TYPES, r.byte(), '附件类型')
  const out = { type }
  if (name !== null) out.name = name
  switch (type) {
    case 'region': {
      const path = r.string()
      if (path !== null) out.path = path
      out.rotation = r.float(); out.x = r.float(); out.y = r.float(); out.scaleX = r.float(); out.scaleY = r.float()
      out.width = r.float(); out.height = r.float()
      out.color = rgba(r.int())
      break
    }
    case 'boundingbox': {
      out.vertexCount = r.varint()
      out.vertices = readVertices(r, out.vertexCount)
      const color = nonessential ? r.int() : 0
      if (nonessential) out.color = rgba(color)
      break
    }
    case 'mesh': {
      const path = r.string()
      if (path !== null) out.path = path
      out.color = rgba(r.int())
      const vertexCount = r.varint()
      out.uvs = r.floats(vertexCount << 1)
      out.triangles = r.shorts()
      out.vertices = readVertices(r, vertexCount)
      out.hull = r.varint()
      if (nonessential) { out.edges = r.shorts(); out.width = r.float(); out.height = r.float() }
      break
    }
    case 'linkedmesh': {
      const path = r.string()
      if (path !== null) out.path = path
      out.color = rgba(r.int())
      const skin = r.string()
      if (skin !== null) out.skin = skin
      out.parent = r.string()
      out.deform = r.bool()
      if (nonessential) { out.width = r.float(); out.height = r.float() }
      break
    }
    case 'path': {
      out.closed = r.bool()
      out.constantSpeed = r.bool()
      out.vertexCount = r.varint()
      out.vertices = readVertices(r, out.vertexCount)
      out.lengths = r.floats(Math.floor(out.vertexCount / 3))
      if (nonessential) out.color = rgba(r.int())
      break
    }
    case 'point': {
      out.rotation = r.float(); out.x = r.float(); out.y = r.float()
      if (nonessential) out.color = rgba(r.int())
      break
    }
    case 'clipping': {
      out.end = pick(slotNames, r.varint(), '插槽')
      out.vertexCount = r.varint()
      out.vertices = readVertices(r, out.vertexCount)
      if (nonessential) out.color = rgba(r.int())
      break
    }
    default: break
  }
  return out
}

// 返回 null = 空皮肤（没有任何插槽）
function readSkin(r, nonessential, slotNames) {
  const slotCount = r.varint()
  if (slotCount === 0) return null
  const skin = {}
  for (let i = 0; i < slotCount; i++) {
    const slotName = pick(slotNames, r.varint(), '插槽')
    const entries = (skin[slotName] = skin[slotName] || {})
    for (let n = r.varint(), j = 0; j < n; j++) {
      const key = r.string()
      entries[key] = readAttachment(r, key, nonessential, slotNames)
    }
  }
  return skin
}

// 每一帧后面的曲线（最后一帧没有）：0 线性、1 阶梯、2 贝塞尔（4 个浮点）
function readCurve(r, frame) {
  const type = r.byte()
  if (type === 1) frame.curve = 'stepped'
  else if (type === 2) frame.curve = [r.float(), r.float(), r.float(), r.float()]
}
function frames(r, count, readFrame) {
  const out = []
  for (let i = 0; i < count; i++) { const frame = readFrame(); if (i < count - 1) readCurve(r, frame); out.push(frame) }
  return out
}

function readAnimation(r, skeleton, skinNames, slotNames, boneNames, ikNames, transformNames, pathNames) {
  const animation = {}
  // 插槽时间线
  for (let i = 0, n = r.varint(); i < n; i++) {
    const slot = (animation.slots = animation.slots || {})
    const entry = (slot[pick(slotNames, r.varint(), '插槽')] = {})
    for (let j = 0, m = r.varint(); j < m; j++) {
      const type = r.byte()
      const count = r.varint()
      if (type === 0) entry.attachment = Array.from({ length: count }, () => ({ time: r.float(), name: r.string() }))
      else if (type === 1) entry.color = frames(r, count, () => ({ time: r.float(), color: rgba(r.int()) }))
      else if (type === 2) entry.twoColor = frames(r, count, () => ({ time: r.float(), light: rgba(r.int()), dark: rgb(r.int()) }))
      else throw new Error(`Spine 3.6 二进制骨骼里有未知的插槽时间线类型 ${type}`)
    }
  }
  // 骨骼时间线
  for (let i = 0, n = r.varint(); i < n; i++) {
    const bones = (animation.bones = animation.bones || {})
    const entry = (bones[pick(boneNames, r.varint(), '骨骼')] = {})
    for (let j = 0, m = r.varint(); j < m; j++) {
      const type = r.byte()
      const count = r.varint()
      if (type === 0) entry.rotate = frames(r, count, () => ({ time: r.float(), angle: r.float() }))
      else if (type === 1 || type === 2 || type === 3) entry[['translate', 'scale', 'shear'][type - 1]] = frames(r, count, () => ({ time: r.float(), x: r.float(), y: r.float() }))
      else throw new Error(`Spine 3.6 二进制骨骼里有未知的骨骼时间线类型 ${type}`)
    }
  }
  // IK / 变换约束
  for (let i = 0, n = r.varint(); i < n; i++) {
    const ik = (animation.ik = animation.ik || {})
    const name = pick(ikNames, r.varint(), 'IK 约束')
    ik[name] = frames(r, r.varint(), () => ({ time: r.float(), mix: r.float(), bendPositive: r.byte() > 0 }))
  }
  for (let i = 0, n = r.varint(); i < n; i++) {
    const transform = (animation.transform = animation.transform || {})
    const name = pick(transformNames, r.varint(), '变换约束')
    transform[name] = frames(r, r.varint(), () => ({ time: r.float(), rotateMix: r.float(), translateMix: r.float(), scaleMix: r.float(), shearMix: r.float() }))
  }
  // 路径约束
  for (let i = 0, n = r.varint(); i < n; i++) {
    const paths = (animation.paths = animation.paths || {})
    const entry = (paths[pick(pathNames, r.varint(), '路径约束')] = {})
    for (let j = 0, m = r.varint(); j < m; j++) {
      const type = r.byte()
      const count = r.varint()
      if (type === 0) entry.position = frames(r, count, () => ({ time: r.float(), position: r.float() }))
      else if (type === 1) entry.spacing = frames(r, count, () => ({ time: r.float(), spacing: r.float() }))
      else if (type === 2) entry.mix = frames(r, count, () => ({ time: r.float(), rotateMix: r.float(), translateMix: r.float() }))
      else throw new Error(`Spine 3.6 二进制骨骼里有未知的路径时间线类型 ${type}`)
    }
  }
  // 网格变形：皮肤序号 → 插槽 → 附件名 → 帧（end = 0 表示这一帧没有偏移；否则读 start，再读 end 个浮点，offset = start）
  for (let i = 0, n = r.varint(); i < n; i++) {
    const deform = (animation.deform = animation.deform || {})
    const skinName = pick(skinNames, r.varint(), '皮肤')
    const bySlot = (deform[skinName] = deform[skinName] || {})
    for (let j = 0, m = r.varint(); j < m; j++) {
      const slotName = pick(slotNames, r.varint(), '插槽')
      const byAttachment = (bySlot[slotName] = bySlot[slotName] || {})
      for (let k = 0, o = r.varint(); k < o; k++) {
        const attachment = r.string()
        byAttachment[attachment] = frames(r, r.varint(), () => {
          const frame = { time: r.float() }
          const count = r.varint()
          if (count > 0) { frame.offset = r.varint(); frame.vertices = r.floats(count) }
          return frame
        })
      }
    }
  }
  // 绘制顺序
  const drawOrderCount = r.varint()
  if (drawOrderCount > 0) {
    animation.drawOrder = []
    for (let i = 0; i < drawOrderCount; i++) {
      const frame = { time: r.float() }
      for (let j = 0, m = r.varint(); j < m; j++) (frame.offsets = frame.offsets || []).push({ slot: pick(slotNames, r.varint(), '插槽'), offset: r.varint() })   // 没有偏移 = 回到初始顺序（JSON 里不写 offsets）
      animation.drawOrder.push(frame)
    }
  }
  // 事件
  const eventCount = r.varint()
  if (eventCount > 0) {
    animation.events = []
    for (let i = 0; i < eventCount; i++) {
      const time = r.float()
      const event = { time, name: pick(skeleton.eventNames, r.varint(), '事件'), int: r.varint(false), float: r.float() }
      if (r.bool()) event.string = r.string()
      animation.events.push(event)
    }
  }
  return animation
}

// bytes → 3.6 JSON 骨骼对象（SkeletonJson.readSkeletonData 直接吃对象）。读不对就抛错，由调用方报「解析失败」
export function spine36BinaryToJson(input) {
  const r = new Reader(input instanceof Uint8Array ? input : new Uint8Array(input))
  const root = { skeleton: {} }
  root.skeleton.hash = r.string() || undefined
  root.skeleton.spine = r.string() || undefined
  root.skeleton.width = r.float()
  root.skeleton.height = r.float()
  const nonessential = r.bool()
  if (nonessential) { root.skeleton.fps = r.float(); root.skeleton.images = r.string() || undefined }
  if (!/^3\.6\./.test(root.skeleton.spine || '')) throw new Error(`不是 Spine 3.6 的二进制骨骼（版本 ${root.skeleton.spine || '未知'}）`)

  const boneNames = []
  root.bones = []
  for (let i = 0, n = r.varint(); i < n; i++) {
    const name = r.string()
    const bone = { name }
    if (i > 0) bone.parent = pick(boneNames, r.varint(), '父骨骼')
    bone.rotation = r.float(); bone.x = r.float(); bone.y = r.float(); bone.scaleX = r.float(); bone.scaleY = r.float()
    bone.shearX = r.float(); bone.shearY = r.float(); bone.length = r.float()
    bone.transform = pick(TRANSFORM_MODES, r.varint(), '骨骼变换模式')
    if (nonessential) r.int()
    boneNames.push(name)
    root.bones.push(bone)
  }
  const slotNames = []
  root.slots = []
  for (let i = 0, n = r.varint(); i < n; i++) {
    const slot = { name: r.string(), bone: pick(boneNames, r.varint(), '骨骼'), color: rgba(r.int()) }
    const dark = r.int()
    if (dark !== -1) slot.dark = rgb(dark)
    const attachment = r.string()
    if (attachment !== null) slot.attachment = attachment
    slot.blend = pick(BLEND_MODES, r.varint(), '混合模式')
    slotNames.push(slot.name)
    root.slots.push(slot)
  }
  const boneList = () => Array.from({ length: r.varint() }, () => pick(boneNames, r.varint(), '骨骼'))
  const ikNames = []
  root.ik = []
  for (let i = 0, n = r.varint(); i < n; i++) {
    const c = { name: r.string(), order: r.varint() }
    c.bones = boneList()
    c.target = pick(boneNames, r.varint(), '骨骼')
    c.mix = r.float()
    c.bendPositive = r.byte() > 0
    ikNames.push(c.name)
    root.ik.push(c)
  }
  const transformNames = []
  root.transform = []
  for (let i = 0, n = r.varint(); i < n; i++) {
    const c = { name: r.string(), order: r.varint() }
    c.bones = boneList()
    c.target = pick(boneNames, r.varint(), '骨骼')
    c.local = r.bool(); c.relative = r.bool()
    c.rotation = r.float(); c.x = r.float(); c.y = r.float(); c.scaleX = r.float(); c.scaleY = r.float(); c.shearY = r.float()
    c.rotateMix = r.float(); c.translateMix = r.float(); c.scaleMix = r.float(); c.shearMix = r.float()
    transformNames.push(c.name)
    root.transform.push(c)
  }
  const pathNames = []
  root.path = []
  for (let i = 0, n = r.varint(); i < n; i++) {
    const c = { name: r.string(), order: r.varint() }
    c.bones = boneList()
    c.target = pick(slotNames, r.varint(), '插槽')
    c.positionMode = pick(POSITION_MODES, r.varint(), '路径位置模式')
    c.spacingMode = pick(SPACING_MODES, r.varint(), '路径间距模式')
    c.rotateMode = pick(ROTATE_MODES, r.varint(), '路径旋转模式')
    c.rotation = r.float(); c.position = r.float(); c.spacing = r.float(); c.rotateMix = r.float(); c.translateMix = r.float()
    pathNames.push(c.name)
    root.path.push(c)
  }
  // 皮肤：默认皮肤（可能是空的 = 没有）+ 命名皮肤。deform 时间线按「skeletonData.skins 里的序号」引用皮肤，空的默认皮肤不占位
  root.skins = {}
  const skinNames = []
  const defaultSkin = readSkin(r, nonessential, slotNames)
  if (defaultSkin) { root.skins.default = defaultSkin; skinNames.push('default') }
  for (let i = 0, n = r.varint(); i < n; i++) {
    const name = r.string()
    const skin = readSkin(r, nonessential, slotNames)
    if (!skin) continue
    root.skins[name] = skin
    skinNames.push(name)
  }
  root.events = {}
  const eventNames = []
  for (let i = 0, n = r.varint(); i < n; i++) {
    const name = r.string()
    root.events[name] = { int: r.varint(false), float: r.float(), string: r.string() }
    eventNames.push(name)
  }
  const skeleton = { eventNames }
  root.animations = {}
  for (let i = 0, n = r.varint(); i < n; i++) {
    const name = r.string()
    root.animations[name] = readAnimation(r, skeleton, skinNames, slotNames, boneNames, ikNames, transformNames, pathNames)
  }
  return root
}
