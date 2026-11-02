import { crc32, deflateRawSync } from 'node:zlib'
// 合成一个很小的 moc3（版本 3 = 4.00）给 gal-live2d-selftest 用：一个参数 ParamA（-1 / 0 / 1 三个关键点）、一个旋转变形器（角度 -90 / 0 / 90）带一个三角形网格、一个弯曲变形器（1×1，格点放大 2 倍）带一个三角形网格、一个部件、一个绘制顺序组。
// 字段位置和 web/static/gal-moc3.js 里的 OFF 表一一对应（段指针 = 文件头 64 字节之后的偏移表里按字段排）。
export function buildTinyMoc3() {
  const sections = []   // { slot（偏移表里的字节位置）, data: Buffer }
  const f32 = (a) => Buffer.from(new Float32Array(a).buffer)
  const u32 = (a) => Buffer.from(new Uint32Array(a).buffer)
  const i32 = (a) => Buffer.from(new Int32Array(a).buffer)
  const u16 = (a) => Buffer.from(new Uint16Array(a).buffer)
  const u8 = (a) => Buffer.from(Uint8Array.from(a))
  const id = (name) => { const b = Buffer.alloc(64); b.write(name); return b }
  const ids = (names) => Buffer.concat(names.map(id))
  const put = (slot, data) => sections.push({ slot, data })
  // ---- 数据 ----
  // 参数
  const OFF = { parts: 72, deformers: 104, warp: 140, rot: 164, mesh: 180, params: 260, partKf: 296, warpKf: 300, rotKf: 308, meshKf: 336, pos: 348, pbIdx: 352, kb: 356, pb: 364, keys: 372, uvs: 376, vidx: 380, masks: 384, dog: 388, doo: 408, warpV303: 468 }
  // 计数（23 项）
  const counts = new Uint32Array(23)
  counts[0] = 1   // parts
  counts[1] = 2   // deformers（0 = 旋转，1 = 弯曲）
  counts[2] = 1   // warp
  counts[3] = 1   // rotation
  counts[4] = 2   // art meshes（0 在旋转下，1 在弯曲下）
  counts[5] = 1   // parameters
  counts[6] = 1   // part keyforms
  counts[7] = 1   // warp keyforms
  counts[8] = 3   // rotation keyforms
  counts[9] = 6   // art mesh keyforms（每个网格 3 个）
  counts[10] = 2 * (3 * 3 * 2 + 3 * 2 * 0) + 0   // 占位，下面按实际 positions 重新算
  const positions = []
  // 旋转变形器的 3 个关键形态（原点 (0,0)）不进 positions；网格 0 的三个关键形态：三角形 (1,0) (0,1) (-1,0) 不随参数变（3 份一样）
  const meshPos = [1, 0, 0, 1, -1, 0]
  for (let k = 0; k < 3; k++) positions.push(...meshPos)   // mesh 0：起点 0 / 6 / 12
  // 弯曲变形器的格点（1×1 → 4 个点 (0,0) (2,0) (0,2) (2,2)，行优先：先 x 方向）
  const warpGridStart = positions.length
  positions.push(0, 0, 2, 0, 0, 2, 2, 2)
  // mesh 1：局部空间 (0.5,0.5) (0.25,0.25) (0.75,0.25)（都在格子 [0,1) 里）；三个关键形态一样（挂在空 binding 上其实只要 1 个，这里给 3 个以便共用同一个 binding 0）
  const mesh1Start = positions.length
  for (let k = 0; k < 3; k++) positions.push(0.5, 0.5, 0.25, 0.25, 0.75, 0.25)
  counts[10] = positions.length
  counts[11] = 1   // parameterBindingIndices
  counts[12] = 2   // keyform bindings：0 = 绑 ParamA；1 = 空（一个关键形态）
  counts[13] = 1   // parameter bindings
  counts[14] = 3   // keys
  counts[15] = 12  // uvs（f32 个数）：两个网格各 3 个点
  counts[16] = 6   // vertex indices
  counts[17] = 0   // masks
  counts[18] = 1   // draw order groups
  counts[19] = 3   // draw order group objects：part、mesh0、mesh1
  // ---- 偏移表和段 ----
  const countsBuf = u32([...counts])
  const canvas = f32([1000, 500, 500, 1000, 1000])   // ppu / 原点 / 画布宽高（后面补 flags 一个字节的位置）
  put(64, countsBuf)
  put(68, Buffer.concat([canvas, Buffer.alloc(4)]))
  // parts
  put(OFF.parts + 4, ids(['Part0']))
  put(OFF.parts + 8, u32([1]))   // binding = 1（空）
  put(OFF.parts + 12, u32([0]))
  put(OFF.parts + 16, u32([1]))
  put(OFF.parts + 20, u32([1]))   // visible
  put(OFF.parts + 24, u32([1]))   // enabled
  put(OFF.parts + 28, i32([-1]))
  // deformers
  put(OFF.deformers + 4, ids(['Rot0', 'Warp0']))
  put(OFF.deformers + 8, u32([0, 1]))
  put(OFF.deformers + 12, u32([1, 1]))
  put(OFF.deformers + 16, u32([1, 1]))
  put(OFF.deformers + 20, i32([-1, -1]))
  put(OFF.deformers + 24, i32([-1, -1]))
  put(OFF.deformers + 28, u32([1, 0]))   // 1 = 旋转、0 = 弯曲
  put(OFF.deformers + 32, u32([0, 0]))   // 各自类别里的序号
  // warp deformers
  put(OFF.warp, u32([1]))   // binding（空）
  put(OFF.warp + 4, u32([0]))
  put(OFF.warp + 8, u32([1]))
  put(OFF.warp + 12, u32([4]))
  put(OFF.warp + 16, u32([1]))   // rows
  put(OFF.warp + 20, u32([1]))   // columns
  put(OFF.warpV303, u32([1]))   // is_new_deformer = 双线性
  // rotation deformers
  put(OFF.rot, u32([0]))
  put(OFF.rot + 4, u32([0]))
  put(OFF.rot + 8, u32([3]))
  put(OFF.rot + 12, f32([0]))
  // art meshes
  put(OFF.mesh + 16, ids(['Mesh0', 'Mesh1']))
  put(OFF.mesh + 20, u32([0, 0]))      // binding 0（ParamA）
  put(OFF.mesh + 24, u32([0, 3]))      // keyform 起点
  put(OFF.mesh + 28, u32([3, 3]))
  put(OFF.mesh + 32, u32([1, 1]))
  put(OFF.mesh + 36, u32([1, 1]))
  put(OFF.mesh + 40, i32([-1, -1]))
  put(OFF.mesh + 44, i32([0, 1]))      // 父变形器：0 = 旋转、1 = 弯曲
  put(OFF.mesh + 48, u32([0, 0]))
  put(OFF.mesh + 52, u8([4, 4]))       // flags：双面
  put(OFF.mesh + 56, u32([3, 3]))
  put(OFF.mesh + 60, u32([0, 6]))      // uv 起点（f32 单位）
  put(OFF.mesh + 64, u32([0, 3]))
  put(OFF.mesh + 68, u32([3, 3]))
  put(OFF.mesh + 72, u32([0, 0]))
  put(OFF.mesh + 76, u32([0, 0]))
  // parameters
  put(OFF.params + 4, ids(['ParamA']))
  put(OFF.params + 8, f32([1]))    // max
  put(OFF.params + 12, f32([-1]))  // min
  put(OFF.params + 16, f32([0]))   // default
  put(OFF.params + 20, u32([0]))
  put(OFF.params + 24, u32([3]))   // decimals
  put(OFF.params + 28, u32([0]))   // 绑定起点
  put(OFF.params + 32, u32([1]))   // 绑定个数
  // keyforms
  put(OFF.partKf, f32([500]))
  put(OFF.warpKf, f32([1]))
  put(OFF.warpKf + 4, u32([warpGridStart]))
  put(OFF.rotKf, f32([1, 1, 1]))            // 不透明度
  put(OFF.rotKf + 4, f32([-90, 0, 90]))     // 角度
  put(OFF.rotKf + 8, f32([0, 0, 0]))        // 原点 x
  put(OFF.rotKf + 12, f32([0, 0, 0]))       // 原点 y
  put(OFF.rotKf + 16, f32([1, 1, 1]))       // 缩放
  put(OFF.rotKf + 20, u32([0, 0, 0]))
  put(OFF.rotKf + 24, u32([0, 0, 0]))
  put(OFF.meshKf, f32([1, 1, 1, 1, 1, 1]))
  put(OFF.meshKf + 4, f32([500, 500, 500, 500, 500, 500]))
  put(OFF.meshKf + 8, u32([0, 6, 12, mesh1Start, mesh1Start + 6, mesh1Start + 12]))
  put(OFF.pos, f32(positions))
  put(OFF.pbIdx, u32([0]))
  put(OFF.kb, u32([0, 1]))          // 起点
  put(OFF.kb + 4, u32([1, 0]))      // 个数
  put(OFF.pb, u32([0]))
  put(OFF.pb + 4, u32([3]))
  put(OFF.keys, f32([-1, 0, 1]))
  put(OFF.uvs, f32([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
  put(OFF.vidx, u16([0, 1, 2, 0, 1, 2]))
  // draw order：1 组，3 个对象（part 0 拥有第 0 组？这里只有一组：part 和两个网格都在组 0，part 不拥有子组）
  put(OFF.dog, u32([0]))
  put(OFF.dog + 4, u32([3]))
  put(OFF.dog + 8, u32([2]))
  put(OFF.dog + 12, u32([1000]))
  put(OFF.dog + 16, u32([0]))
  put(OFF.doo, u32([1, 0, 0]))        // 类型：1 = 部件、0 = 网格
  put(OFF.doo + 4, u32([0, 0, 1]))
  put(OFF.doo + 8, i32([-1, -1, -1]))
  // ---- 拼文件 ----
  let cursor = 64 + 160 * 4   // 表 160 项
  cursor = Math.ceil(cursor / 64) * 64
  const table = Buffer.alloc(160 * 4)
  const bodies = []
  for (const { slot, data } of sections) {
    table.writeUInt32LE(cursor, slot - 64)
    bodies.push({ at: cursor, data })
    cursor = Math.ceil((cursor + data.length) / 64) * 64
  }
  const out = Buffer.alloc(cursor + 64)
  out.write('MOC3', 0)
  out[4] = 3
  table.copy(out, 64)
  for (const { at, data } of bodies) data.copy(out, at)
  return out
}

// 手搓 ZIP（files = [[名字, 内容, 方法 0 stored / 8 deflate]]）
export function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, data, method] of files) {
    const nameBuf = Buffer.from(name)
    const raw = method === 8 ? deflateRawSync(data) : data
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(raw.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, raw)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + raw.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
// KTX 1.1（单级 mip）
export function buildKtx(width, height, internalFormat, glFormat, payload) {
  const head = Buffer.alloc(64)
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head)
  head.writeUInt32LE(0x04030201, 12); head.writeUInt32LE(glFormat, 24); head.writeUInt32LE(internalFormat, 28); head.writeUInt32LE(width, 36); head.writeUInt32LE(height, 40); head.writeUInt32LE(1, 52); head.writeUInt32LE(1, 56)
  const size = Buffer.alloc(4)
  size.writeUInt32LE(payload.length)
  return Buffer.concat([head, size, payload])
}
