// Live2D Cubism 的 .moc3（版本 1~4.02）读取 + 求值（参数 → 每个 ArtMesh 的顶点 / 不透明度 / 绘制顺序 / 颜色）+ motion3.json 播放。纯 JS、不碰 DOM（浏览器和 Node 都能用）。
// 不用官方 Cubism Core：移植自 MahouTechnologies/moc3-rs（MIT OR Apache-2.0，https://github.com/MahouTechnologies/moc3-rs）的 data.rs / puppet / deformer（偏移表、关键形态插值、变形器链、胶水、绘制顺序）；
// 渲染（WebGL）在 gal-live2d.js，这里只出数据。
// 不处理：混合形状（moc3 4.02 的 blend shape 参数，moc3-rs 也没做完）、物理（physics3.json）、姿势（pose3.json）、表情（exp3.json）。
//
// 用法：
//   const model = parseMoc3(bytes)                 // 静态数据
//   const frame = createFrame(model)               // 一帧的可变数据
//   updateModel(model, frame, params)              // params: Float32Array（参数个数；缺 = 默认值）
//   frame.renderOrder / frame.vertices[i] / frame.opacities[i] / frame.colors[i]
//   const motion = parseMotion(json); evaluateMotion(motion, time, model, params, frame)
const COUNT_FIELDS_BASE = 23
const COUNT_FIELDS_V402 = 32

// 段表里每个字段指针在 offset 表里的位置（字节，从文件头起）
const OFF = {
  countInfo: 64, canvasInfo: 68,
  parts: 72, deformers: 104, warpDeformers: 140, rotationDeformers: 164, artMeshes: 180, parameters: 260,
  partKeyforms: 296, warpDeformerKeyforms: 300, rotationDeformerKeyforms: 308, artMeshKeyforms: 336,
  keyformPositions: 348, parameterBindingIndices: 352, keyformBindings: 356, parameterBindings: 364, keys: 372, uvs: 376, vertexIndices: 380, artMeshMasks: 384,
  drawOrderGroups: 388, drawOrderGroupObjects: 408, glues: 420, glueInfos: 456, glueKeyforms: 464,
  warpDeformerKeyformsV303: 468,
  parameterExtensions: 472, warpDeformerKeyformsV402: 484, rotationDeformerKeyformsV402: 488, artMeshKeyformsV402: 492,
  keyformMultiplyColors: 496, keyformScreenColors: 508, parametersV402: 520,
  // 混合变形（blend shape，4.2 起）：每个字段一个指针，位置连着排
  bsParamBindings: 532, bsKeyformBindings: 544, bsWarpDeformers: 564, bsArtMeshes: 576, bsConstraints: 588,
}

const COUNT_NAMES = ['parts', 'deformers', 'warpDeformers', 'rotationDeformers', 'artMeshes', 'parameters', 'partKeyforms', 'warpDeformerKeyforms', 'rotationDeformerKeyforms', 'artMeshKeyforms',
  'keyformPositions', 'parameterBindingIndices', 'keyformBindings', 'parameterBindings', 'keys', 'uvs', 'vertexIndices', 'artMeshMasks', 'drawOrderGroups', 'drawOrderGroupObjects', 'glues', 'glueInfos', 'glueKeyforms',
  'keyformMultiplyColors', 'keyformScreenColors', 'blendShapeParameterBindings', 'blendShapeKeyformBindings', 'blendShapeWarpDeformers', 'blendShapeArtMeshes', 'blendShapeConstraintIndices', 'blendShapeConstraints', 'blendShapeConstraintValues']

const rescale = (t, lower, upper) => (t - lower) / (upper - lower)

export function parseMoc3(input) {
  // 拷到对齐的 ArrayBuffer（段数据要按 4 字节对齐才能直接当 Float32Array 看）
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const buf = copy.buffer
  const dv = new DataView(buf)
  if (copy.length < 64 + 8 || String.fromCharCode(copy[0], copy[1], copy[2], copy[3]) !== 'MOC3') throw new Error('不是 moc3')
  const version = copy[4]
  if (version < 1 || version > 4) throw new Error(`不支持的 moc3 版本 ${version}（支持 1~4）`)
  if (copy[5] !== 0) throw new Error('不支持大端 moc3')
  const u32 = (off) => dv.getUint32(off, true)
  const base = u32(OFF.countInfo)
  const nCounts = version >= 4 ? COUNT_FIELDS_V402 : COUNT_FIELDS_BASE
  const counts = {}
  COUNT_NAMES.forEach((name, i) => { counts[name] = i < nCounts ? u32(base + i * 4) : 0 })
  const arr = (Type, fieldOff, count) => {
    if (!count) return new Type(0)
    const ptr = u32(fieldOff)
    if (ptr + count * Type.BYTES_PER_ELEMENT > copy.length || ptr % Type.BYTES_PER_ELEMENT) throw new Error('moc3 段越界或没对齐')
    return new Type(buf, ptr, count)
  }
  const ids = (fieldOff, count) => {
    const out = new Array(count)
    if (!count) return out
    const ptr = u32(fieldOff)
    for (let i = 0; i < count; i++) {
      let end = ptr + i * 64
      const start = end
      while (end < start + 64 && copy[end] !== 0) end++
      out[i] = new TextDecoder().decode(copy.subarray(start, end))
    }
    return out
  }
  const c = counts
  const canvasPtr = u32(OFF.canvasInfo)
  const canvas = { pixelsPerUnit: dv.getFloat32(canvasPtr, true), originX: dv.getFloat32(canvasPtr + 4, true), originY: dv.getFloat32(canvasPtr + 8, true), width: dv.getFloat32(canvasPtr + 12, true), height: dv.getFloat32(canvasPtr + 16, true) }
  const has402 = version >= 4
  const m = {
    version, counts, canvas,
    // parts
    partIds: ids(OFF.parts + 4, c.parts),
    partBinding: arr(Uint32Array, OFF.parts + 8, c.parts),
    partKeyformStart: arr(Uint32Array, OFF.parts + 12, c.parts),
    partKeyformCount: arr(Uint32Array, OFF.parts + 16, c.parts),
    partVisible: arr(Uint32Array, OFF.parts + 20, c.parts),
    partEnabled: arr(Uint32Array, OFF.parts + 24, c.parts),
    partParent: arr(Int32Array, OFF.parts + 28, c.parts),
    // deformers
    deformerIds: ids(OFF.deformers + 4, c.deformers),
    deformerBinding: arr(Uint32Array, OFF.deformers + 8, c.deformers),
    deformerEnabled: arr(Uint32Array, OFF.deformers + 16, c.deformers),
    deformerParentPart: arr(Int32Array, OFF.deformers + 20, c.deformers),
    deformerParentDeformer: arr(Int32Array, OFF.deformers + 24, c.deformers),
    deformerType: arr(Uint32Array, OFF.deformers + 28, c.deformers),   // 0 = 弯曲（warp）、1 = 旋转
    deformerSpecific: arr(Uint32Array, OFF.deformers + 32, c.deformers),
    // warp deformers
    warpBinding: arr(Uint32Array, OFF.warpDeformers, c.warpDeformers),
    warpKeyformStart: arr(Uint32Array, OFF.warpDeformers + 4, c.warpDeformers),
    warpKeyformCount: arr(Uint32Array, OFF.warpDeformers + 8, c.warpDeformers),
    warpVertexCount: arr(Uint32Array, OFF.warpDeformers + 12, c.warpDeformers),
    warpRows: arr(Uint32Array, OFF.warpDeformers + 16, c.warpDeformers),
    warpColumns: arr(Uint32Array, OFF.warpDeformers + 20, c.warpDeformers),
    warpIsNew: version >= 2 ? arr(Uint32Array, OFF.warpDeformerKeyformsV303, c.warpDeformers) : new Uint32Array(c.warpDeformers),
    // rotation deformers
    rotBinding: arr(Uint32Array, OFF.rotationDeformers, c.rotationDeformers),
    rotKeyformStart: arr(Uint32Array, OFF.rotationDeformers + 4, c.rotationDeformers),
    rotKeyformCount: arr(Uint32Array, OFF.rotationDeformers + 8, c.rotationDeformers),
    rotBaseAngle: arr(Float32Array, OFF.rotationDeformers + 12, c.rotationDeformers),
    // art meshes
    artMeshIds: ids(OFF.artMeshes + 16, c.artMeshes),
    artBinding: arr(Uint32Array, OFF.artMeshes + 20, c.artMeshes),
    artKeyformStart: arr(Uint32Array, OFF.artMeshes + 24, c.artMeshes),
    artKeyformCount: arr(Uint32Array, OFF.artMeshes + 28, c.artMeshes),
    artEnabled: arr(Uint32Array, OFF.artMeshes + 36, c.artMeshes),
    artParentPart: arr(Int32Array, OFF.artMeshes + 40, c.artMeshes),
    artParentDeformer: arr(Int32Array, OFF.artMeshes + 44, c.artMeshes),
    artTexture: arr(Uint32Array, OFF.artMeshes + 48, c.artMeshes),
    artFlags: arr(Uint8Array, OFF.artMeshes + 52, c.artMeshes),   // bit0-1 混合（0 普通 / 1 加 / 2 乘）、bit2 双面、bit3 反转遮罩
    artVertexCount: arr(Uint32Array, OFF.artMeshes + 56, c.artMeshes),
    artUvStart: arr(Uint32Array, OFF.artMeshes + 60, c.artMeshes),
    artIndexStart: arr(Uint32Array, OFF.artMeshes + 64, c.artMeshes),
    artIndexCount: arr(Uint32Array, OFF.artMeshes + 68, c.artMeshes),
    artMaskStart: arr(Uint32Array, OFF.artMeshes + 72, c.artMeshes),
    artMaskCount: arr(Uint32Array, OFF.artMeshes + 76, c.artMeshes),
    // parameters
    paramIds: ids(OFF.parameters + 4, c.parameters),
    paramMax: arr(Float32Array, OFF.parameters + 8, c.parameters),
    paramMin: arr(Float32Array, OFF.parameters + 12, c.parameters),
    paramDefault: arr(Float32Array, OFF.parameters + 16, c.parameters),
    paramDecimals: arr(Uint32Array, OFF.parameters + 24, c.parameters),
    paramBindingStart: arr(Uint32Array, OFF.parameters + 28, c.parameters),
    paramBindingCount: arr(Uint32Array, OFF.parameters + 32, c.parameters),
    paramType: has402 ? arr(Uint32Array, OFF.parametersV402, c.parameters) : new Uint32Array(c.parameters),
    // 混合变形：参数 → 它的混合变形绑定（parametersV402 的第 2、3 组：绑定序号、是否有）
    paramBsBinding: has402 && c.blendShapeParameterBindings ? arr(Int32Array, OFF.parametersV402 + 4, c.parameters) : null,
    paramBsFlag: has402 && c.blendShapeParameterBindings ? arr(Uint32Array, OFF.parametersV402 + 8, c.parameters) : null,
    bsPbKeyStart: c.blendShapeParameterBindings ? arr(Uint32Array, OFF.bsParamBindings, c.blendShapeParameterBindings) : null,
    bsPbKeyCount: c.blendShapeParameterBindings ? arr(Uint32Array, OFF.bsParamBindings + 4, c.blendShapeParameterBindings) : null,
    bsKbBinding: c.blendShapeKeyformBindings ? arr(Uint32Array, OFF.bsKeyformBindings, c.blendShapeKeyformBindings) : null,
    bsKbKeyformStart: c.blendShapeKeyformBindings ? arr(Uint32Array, OFF.bsKeyformBindings + 4, c.blendShapeKeyformBindings) : null,
    bsKbKeyformCount: c.blendShapeKeyformBindings ? arr(Uint32Array, OFF.bsKeyformBindings + 8, c.blendShapeKeyformBindings) : null,
    bsKbConstraintStart: c.blendShapeKeyformBindings ? arr(Uint32Array, OFF.bsKeyformBindings + 12, c.blendShapeKeyformBindings) : null,
    bsKbConstraintCount: c.blendShapeKeyformBindings ? arr(Uint32Array, OFF.bsKeyformBindings + 16, c.blendShapeKeyformBindings) : null,
    // 约束：[序号表（每项 = 约束号）]、[约束：参数号 / 曲线起点 / 曲线点数]、[曲线：参数值 → 倍率]
    bsConstraintIndex: c.blendShapeConstraintIndices ? arr(Uint32Array, OFF.bsConstraints, c.blendShapeConstraintIndices) : null,
    bsConstraintParam: c.blendShapeConstraints ? arr(Uint32Array, OFF.bsConstraints + 4, c.blendShapeConstraints) : null,
    bsConstraintValueStart: c.blendShapeConstraints ? arr(Uint32Array, OFF.bsConstraints + 8, c.blendShapeConstraints) : null,
    bsConstraintValueCount: c.blendShapeConstraints ? arr(Uint32Array, OFF.bsConstraints + 12, c.blendShapeConstraints) : null,
    bsConstraintValueKey: c.blendShapeConstraintValues ? arr(Float32Array, OFF.bsConstraints + 16, c.blendShapeConstraintValues) : null,
    bsConstraintValueWeight: c.blendShapeConstraintValues ? arr(Float32Array, OFF.bsConstraints + 20, c.blendShapeConstraintValues) : null,
    bsWarpTarget: c.blendShapeWarpDeformers ? arr(Uint32Array, OFF.bsWarpDeformers, c.blendShapeWarpDeformers) : null,
    bsWarpStart: c.blendShapeWarpDeformers ? arr(Uint32Array, OFF.bsWarpDeformers + 4, c.blendShapeWarpDeformers) : null,
    bsWarpCount: c.blendShapeWarpDeformers ? arr(Uint32Array, OFF.bsWarpDeformers + 8, c.blendShapeWarpDeformers) : null,
    bsArtTarget: c.blendShapeArtMeshes ? arr(Uint32Array, OFF.bsArtMeshes, c.blendShapeArtMeshes) : null,
    bsArtStart: c.blendShapeArtMeshes ? arr(Uint32Array, OFF.bsArtMeshes + 4, c.blendShapeArtMeshes) : null,
    bsArtCount: c.blendShapeArtMeshes ? arr(Uint32Array, OFF.bsArtMeshes + 8, c.blendShapeArtMeshes) : null,
    // keyforms
    partKeyformDrawOrder: arr(Float32Array, OFF.partKeyforms, c.partKeyforms),
    warpKeyformOpacity: arr(Float32Array, OFF.warpDeformerKeyforms, c.warpDeformerKeyforms),
    warpKeyformPosStart: arr(Uint32Array, OFF.warpDeformerKeyforms + 4, c.warpDeformerKeyforms),
    rotKeyformOpacity: arr(Float32Array, OFF.rotationDeformerKeyforms, c.rotationDeformerKeyforms),
    rotKeyformAngle: arr(Float32Array, OFF.rotationDeformerKeyforms + 4, c.rotationDeformerKeyforms),
    rotKeyformX: arr(Float32Array, OFF.rotationDeformerKeyforms + 8, c.rotationDeformerKeyforms),
    rotKeyformY: arr(Float32Array, OFF.rotationDeformerKeyforms + 12, c.rotationDeformerKeyforms),
    rotKeyformScale: arr(Float32Array, OFF.rotationDeformerKeyforms + 16, c.rotationDeformerKeyforms),
    artKeyformOpacity: arr(Float32Array, OFF.artMeshKeyforms, c.artMeshKeyforms),
    artKeyformDrawOrder: arr(Float32Array, OFF.artMeshKeyforms + 4, c.artMeshKeyforms),
    artKeyformPosStart: arr(Uint32Array, OFF.artMeshKeyforms + 8, c.artMeshKeyforms),
    positions: arr(Float32Array, OFF.keyformPositions, c.keyformPositions),
    paramBindingIndices: arr(Uint32Array, OFF.parameterBindingIndices, c.parameterBindingIndices),
    kbStart: arr(Uint32Array, OFF.keyformBindings, c.keyformBindings),
    kbCount: arr(Uint32Array, OFF.keyformBindings + 4, c.keyformBindings),
    pbKeyStart: arr(Uint32Array, OFF.parameterBindings, c.parameterBindings),
    pbKeyCount: arr(Uint32Array, OFF.parameterBindings + 4, c.parameterBindings),
    keys: arr(Float32Array, OFF.keys, c.keys),
    uvs: arr(Float32Array, OFF.uvs, c.uvs),
    vertexIndices: arr(Uint16Array, OFF.vertexIndices, c.vertexIndices),
    maskIndices: arr(Uint32Array, OFF.artMeshMasks, c.artMeshMasks),
    // draw order
    dogObjectStart: arr(Uint32Array, OFF.drawOrderGroups, c.drawOrderGroups),
    dogObjectCount: arr(Uint32Array, OFF.drawOrderGroups + 4, c.drawOrderGroups),
    dogTotalCount: arr(Uint32Array, OFF.drawOrderGroups + 8, c.drawOrderGroups),
    dogMax: arr(Uint32Array, OFF.drawOrderGroups + 12, c.drawOrderGroups),
    dogMin: arr(Uint32Array, OFF.drawOrderGroups + 16, c.drawOrderGroups),
    dooType: arr(Uint32Array, OFF.drawOrderGroupObjects, c.drawOrderGroupObjects),
    dooIndex: arr(Uint32Array, OFF.drawOrderGroupObjects + 4, c.drawOrderGroupObjects),
    dooSelf: arr(Int32Array, OFF.drawOrderGroupObjects + 8, c.drawOrderGroupObjects),
    // glues
    glueBinding: arr(Uint32Array, OFF.glues + 8, c.glues),
    glueKeyformStart: arr(Uint32Array, OFF.glues + 12, c.glues),
    glueKeyformCount: arr(Uint32Array, OFF.glues + 16, c.glues),
    glueMeshA: arr(Uint32Array, OFF.glues + 20, c.glues),
    glueMeshB: arr(Uint32Array, OFF.glues + 24, c.glues),
    glueInfoStart: arr(Uint32Array, OFF.glues + 28, c.glues),
    glueInfoCount: arr(Uint32Array, OFF.glues + 32, c.glues),
    glueWeights: arr(Float32Array, OFF.glueInfos, c.glueInfos),
    glueVertexIndices: arr(Uint16Array, OFF.glueInfos + 4, c.glueInfos),
    glueIntensities: arr(Float32Array, OFF.glueKeyforms, c.glueKeyforms),
    // 4.02 颜色
    warpColorStart: has402 ? arr(Uint32Array, OFF.warpDeformerKeyformsV402, c.warpDeformers) : null,
    rotColorStart: has402 ? arr(Uint32Array, OFF.rotationDeformerKeyformsV402, c.rotationDeformers) : null,
    artColorStart: has402 ? arr(Uint32Array, OFF.artMeshKeyformsV402, c.artMeshes) : null,
    mulR: has402 ? arr(Float32Array, OFF.keyformMultiplyColors, c.keyformMultiplyColors) : null,
    mulG: has402 ? arr(Float32Array, OFF.keyformMultiplyColors + 4, c.keyformMultiplyColors) : null,
    mulB: has402 ? arr(Float32Array, OFF.keyformMultiplyColors + 8, c.keyformMultiplyColors) : null,
    scrR: has402 ? arr(Float32Array, OFF.keyformScreenColors, c.keyformScreenColors) : null,
    scrG: has402 ? arr(Float32Array, OFF.keyformScreenColors + 4, c.keyformScreenColors) : null,
    scrB: has402 ? arr(Float32Array, OFF.keyformScreenColors + 8, c.keyformScreenColors) : null,
  }
  buildPuppet(m)
  return m
}

// ---- 关键形态插值用的预处理 ----
// 一个 keyform binding = 若干 (参数号, 关键点表)；对象的关键形态按「第一个参数变化最快」的混合进制排
function buildPuppet(m) {
  const c = m.counts
  // 参数绑定 → 参数
  const pbToParam = new Int32Array(c.parameterBindings).fill(-1)
  for (let p = 0; p < c.parameters; p++) for (let a = m.paramBindingStart[p]; a < m.paramBindingStart[p] + m.paramBindingCount[p]; a++) pbToParam[a] = p
  // keyform binding → [{ keys, param }]
  m.bindingTables = new Array(c.keyformBindings)
  for (let b = 0; b < c.keyformBindings; b++) {
    const list = []
    for (let i = m.kbStart[b]; i < m.kbStart[b] + m.kbCount[b]; i++) {
      const pb = m.paramBindingIndices[i]
      list.push({ keys: m.keys.subarray(m.pbKeyStart[pb], m.pbKeyStart[pb] + m.pbKeyCount[pb]), param: pbToParam[pb], eps: 0.1 ** m.paramDecimals[pbToParam[pb]] })
    }
    m.bindingTables[b] = list
  }
  // 变形器 / 网格的树：父在前；roots 按「先变形器后网格」的顺序
  const dCount = c.deformers
  // 每个 deformer（broad 序号）对应的 specific 序号
  m.warpOf = new Int32Array(dCount).fill(-1)
  m.rotOf = new Int32Array(dCount).fill(-1)
  const nodes = []   // { kind: 'warp'|'rot'|'mesh', broad, specific, parent: node index | -1, children: [] }
  const deformerNode = new Array(dCount)
  for (let i = 0; i < dCount; i++) {
    const specific = m.deformerSpecific[i]
    const kind = m.deformerType[i] === 0 ? 'warp' : 'rot'
    if (kind === 'warp') m.warpOf[i] = specific; else m.rotOf[i] = specific
    const parentD = m.deformerParentDeformer[i]
    const node = { kind, broad: i, specific, parent: parentD === -1 ? -1 : nodes.indexOf(deformerNode[parentD]), children: [] }
    deformerNode[i] = node
    nodes.push(node)
    if (parentD !== -1) deformerNode[parentD].children.push(node)
  }
  const roots = nodes.filter((n) => n.parent === -1)
  for (let i = 0; i < c.artMeshes; i++) {
    const node = { kind: 'mesh', broad: i, specific: i, parent: -1, children: [] }
    const parentD = m.artParentDeformer[i]
    if (parentD !== -1) { deformerNode[parentD].children.push(node); node.parent = nodes.length } else roots.push(node)
    nodes.push(node)
  }
  // 先序展开：[ { node, parentNode } ]，根单独
  m.roots = roots
  m.order = []   // 非根节点的先序（父在前）
  const visit = (n) => { for (const ch of n.children) { m.order.push({ node: ch, parent: n }); visit(ch) } }
  for (const r of roots) visit(r)
  m.warpGridCount = new Uint32Array(c.warpDeformers)
  for (let i = 0; i < c.warpDeformers; i++) m.warpGridCount[i] = (m.warpRows[i] + 1) * (m.warpColumns[i] + 1)
  // 每个对象的 binding（enable 判定用）
  m.deformerBindingOf = new Uint32Array(dCount)
  for (let i = 0; i < dCount; i++) m.deformerBindingOf[i] = m.deformerType[i] === 0 ? m.warpBinding[m.deformerSpecific[i]] : m.rotBinding[m.deformerSpecific[i]]
  m.paramIndex = new Map(m.paramIds.map((id, i) => [id, i]))
  m.partIndex = new Map(m.partIds.map((id, i) => [id, i]))
}

export function createFrame(m) {
  const c = m.counts
  const frame = {
    params: Float32Array.from(m.paramDefault),
    binOut: new Uint8Array(c.keyformBindings),
    partEnabled: new Uint8Array(c.parts).fill(1),
    deformerEnabled: new Uint8Array(c.deformers).fill(1),
    artEnabled: new Uint8Array(c.artMeshes).fill(1),
    partOpacity: new Float32Array(c.parts),
    partCalcOpacity: new Float32Array(c.parts).fill(1),
    partDrawOrder: new Float32Array(c.parts),
    artDrawOrder: new Float32Array(c.artMeshes),
    renderOrder: [],
    vertices: [],
    opacities: new Float32Array(c.artMeshes),
    colors: new Float32Array(c.artMeshes * 6),   // 乘色 rgb + 屏幕色 rgb
    warpGrids: [],
    warpOpacity: new Float32Array(c.warpDeformers),
    warpColor: new Float32Array(c.warpDeformers * 6),
    rot: new Float32Array(c.rotationDeformers * 4),   // origin x, y, scale, angle
    rotOpacity: new Float32Array(c.rotationDeformers),
    rotColor: new Float32Array(c.rotationDeformers * 6),
    deformerScale: new Float32Array(c.deformers),
    glueIntensity: new Float32Array(c.glues),
    // 排序暂存
    cursors: new Uint32Array(c.drawOrderGroups),
    renderSeq: new Uint32Array(c.artMeshes),
  }
  for (let i = 0; i < c.artMeshes; i++) frame.vertices.push(new Float32Array(m.artVertexCount[i] * 2))
  for (let i = 0; i < c.warpDeformers; i++) frame.warpGrids.push(new Float32Array(m.warpGridCount[i] * 2))
  for (let i = 0; i < c.parts; i++) frame.partOpacity[i] = m.partVisible[i] ? 1 : 0
  return frame
}

// ---- 插值 ----
// 在有序关键点表里定位：返回 [下标, 到下一个点的比例 0..1]
// eps：参数值离关键点不到 eps（0.1 ^ 参数的小数位数）就当成正好在关键点上（Cubism Core 的行为，对着真正的 Core 核对过：差 0.0003 的不透明度是 0 而不是 0.0003）
export function keySegment(keys, value, out, eps = 0) {
  const last = keys.length - 1
  if (last <= 0 || value <= keys[0]) { out[0] = 0; out[1] = 0; return }
  if (value >= keys[last]) { out[0] = last - 1; out[1] = 1; return }
  let lo = 1
  let hi = last
  while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid] <= value) lo = mid + 1; else hi = mid }   // 第一个 > value 的下标
  const upper = Math.min(Math.max(lo, 1), last)
  out[0] = upper - 1
  out[1] = rescale(value, keys[upper - 1], keys[upper])
  if (eps > 0) {
    // Core 是 float32：边界上（正好差 0.001）的比较按 float32 来（v < k0 + eps、v > k1 - eps）
    const e32 = Math.fround(eps)
    const v32 = Math.fround(value)
    if (v32 < Math.fround(keys[upper - 1] + e32)) out[1] = 0
    else if (v32 > Math.fround(keys[upper] - e32)) out[1] = 1
  }
}
const seg = new Float64Array(2)
const scaledTmp = new Float64Array(32)

// 对 table（[{keys, param}]）算每个混合分量的权重，对每个非零权重的分量调用 add(index, weight)
function interpolate(table, params, add) {
  const n = table.length
  let baseIndex = 0
  let lastSize = 1
  for (let i = 0; i < n; i++) {
    keySegment(table[i].keys, params[table[i].param], seg, table[i].eps)
    scaledTmp[i] = seg[1]
    baseIndex += seg[0] * lastSize
    lastSize *= table[i].keys.length
  }
  const total = 1 << n
  for (let num = 0; num < total; num++) {
    let mult = 1
    let index = baseIndex
    let size = 1
    for (let i = 0; i < n; i++) {
      if (num & (1 << i)) { index += size; mult *= scaledTmp[i] } else mult *= 1 - scaledTmp[i]
      size *= table[i].keys.length
    }
    if (mult === 0) continue
    add(index, mult)
  }
}

function keyTableOutside(keys, value, eps) {
  const n = keys.length
  if (n === 0) return false
  if (n === 1) return value <= keys[0] - eps || value >= keys[0] + eps
  return value < keys[0] - eps || value >= keys[n - 1] + eps
}

// ---- 变形器 ----
const caseIndex = (x, y) => (x >= 1 ? 2 : x >= 0 ? 1 : 0) + (y >= 1 ? 2 : y >= 0 ? 1 : 0) * 3
// 三角 / 双线性插值：把结果写进 out[0..1]；四个角 = grid 里的下标（bl, br, tl, tr）
function interp(isBilinear, tx, ty, grid, bl, br, tl, tr, out) {
  const nx = 1 - tx
  const ny = 1 - ty
  if (isBilinear) {
    out[0] = grid[bl] * nx * ny + grid[br] * tx * ny + grid[tl] * nx * ty + grid[tr] * tx * ty
    out[1] = grid[bl + 1] * nx * ny + grid[br + 1] * tx * ny + grid[tl + 1] * nx * ty + grid[tr + 1] * tx * ty
  } else if (tx + ty > 1) {
    out[0] = grid[tr] + (grid[tl] - grid[tr]) * nx + (grid[br] - grid[tr]) * ny
    out[1] = grid[tr + 1] + (grid[tl + 1] - grid[tr + 1]) * nx + (grid[br + 1] - grid[tr + 1]) * ny
  } else {
    out[0] = grid[bl] + (grid[br] - grid[bl]) * tx + (grid[tl] - grid[bl]) * ty
    out[1] = grid[bl + 1] + (grid[br + 1] - grid[bl + 1]) * tx + (grid[tl + 1] - grid[bl + 1]) * ty
  }
}
// 点（x, y 在 [0,1]² 的格子空间）→ 弯曲后的点；points = Float32Array / 数组，原地改写（n = 点数，offset 起，xy 交错）
const tri = new Float64Array(2)
function applyWarp(grid, isNew, rows, columns, points, count) {
  const cp = columns + 1
  // 四个角 / 平行四边形（越界外推用）
  const g = (idx) => idx * 2
  const c00 = g(0)
  const c10 = g(columns)
  const c01 = g(rows * cp)
  const c11 = g(columns + rows * cp)
  const cx = (grid[c00] + grid[c10] + grid[c01] + grid[c11]) / 4
  const cy = (grid[c00 + 1] + grid[c10 + 1] + grid[c01 + 1] + grid[c11 + 1]) / 4
  const d1x = grid[c11] - grid[c00]
  const d1y = grid[c11 + 1] - grid[c00 + 1]
  const d2x = grid[c10] - grid[c01]
  const d2y = grid[c10 + 1] - grid[c01 + 1]
  const vxx = (d1x + d2x) / 2
  const vxy = (d1y + d2y) / 2
  const vyx = (d1x - d2x) / 2
  const vyy = (d1y - d2y) / 2
  const ox = cx - d1x * 0.5
  const oy = cy - d1y * 0.5
  const O = (a, b) => [ox + vxx * a + vyx * b, oy + vxy * a + vyy * b]   // origin + v_x * a + v_y * b
  for (let k = 0; k < count; k++) {
    const x = points[k * 2]
    const y = points[k * 2 + 1]
    const gx = x * columns
    const gy = y * rows
    const ix = gx | 0
    const iy = gy | 0
    if (x >= 0 && x < 1 && y >= 0 && y < 1) {
      const gi = ix + iy * cp
      interp(Boolean(isNew), gx - ix, gy - iy, grid, g(gi), g(gi + 1), g(gi + cp), g(gi + cp + 1), tri)
      points[k * 2] = tri[0]
      points[k * 2 + 1] = tri[1]
      continue
    }
    const transition = x >= -2 && x <= 3 && y >= -2 && y <= 3
    if (!transition) {
      points[k * 2] = ox + x * vxx + y * vyx
      points[k * 2 + 1] = oy + x * vxy + y * vyy
      continue
    }
    // 过渡区：用临时的小网格（四个角）三角插值；tmp = [bl, br, tl, tr] 各 xy
    const tmp = new Float64Array(8)
    const set = (slot, p) => { tmp[slot * 2] = p[0]; tmp[slot * 2 + 1] = p[1] }
    const fromGrid = (slot, idx) => { tmp[slot * 2] = grid[g(idx)]; tmp[slot * 2 + 1] = grid[g(idx) + 1] }
    let tx
    let ty
    switch (caseIndex(x, y)) {
      case 7: {
        const ax = Math.min(ix, columns - 1)
        const f1 = ax / columns
        const f2 = (ax + 1) / columns
        tx = gx - ax; ty = rescale(y, 1, 3)
        fromGrid(0, ax + rows * cp); fromGrid(1, ax + 1 + rows * cp); set(2, O(f1, 3)); set(3, O(f2, 3))
        break
      }
      case 1: {
        const ax = Math.min(ix, columns - 1)
        const f1 = ax / columns
        const f2 = (ax + 1) / columns
        tx = gx - ax; ty = rescale(y, -2, 0)
        set(0, O(f1, -2)); set(1, O(f2, -2)); fromGrid(2, ax); fromGrid(3, ax + 1)
        break
      }
      case 3: {
        const ay = Math.min(iy, rows - 1)
        const f1 = ay / rows
        const f2 = (ay + 1) / rows
        tx = rescale(x, -2, 0); ty = gy - ay
        set(0, O(-2, f1)); fromGrid(1, ay * cp); set(2, O(-2, f2)); fromGrid(3, (ay + 1) * cp)
        break
      }
      case 5: {
        const ay = Math.min(iy, rows - 1)
        const f1 = ay / rows
        const f2 = (ay + 1) / rows
        tx = rescale(x, 1, 3); ty = gy - ay
        fromGrid(0, columns + ay * cp); set(1, O(3, f1)); fromGrid(2, columns + (ay + 1) * cp); set(3, O(3, f2))
        break
      }
      case 6:
        tx = rescale(x, -2, 0); ty = rescale(y, 1, 3)
        set(0, O(-2, 1)); fromGrid(1, rows * cp); set(2, O(-2, 3)); set(3, O(0, 3))
        break
      case 8:
        tx = rescale(x, 1, 3); ty = rescale(y, 1, 3)
        fromGrid(0, columns + rows * cp); set(1, O(3, 1)); set(2, O(1, 3)); set(3, O(3, 3))
        break
      case 0:
        tx = rescale(x, -2, 0); ty = rescale(y, -2, 0)
        set(0, O(-2, -2)); set(1, O(0, -2)); set(2, O(-2, 0)); fromGrid(3, 0)
        break
      case 2:
        tx = rescale(x, 1, 3); ty = rescale(y, -2, 0)
        set(0, O(1, -2)); set(1, O(3, -2)); fromGrid(2, columns); set(3, O(3, 0))
        break
      default: continue   // 4 = 格子内，上面已经处理
    }
    interp(false, tx, ty, tmp, 0, 2, 4, 6, tri)
    points[k * 2] = tri[0]
    points[k * 2 + 1] = tri[1]
  }
}

// 旋转变形器：点（x, y）→ 缩放 + 旋转（度）+ 平移
function applyRotation(ox, oy, scale, angle, baseAngle, points, count) {
  const rad = ((baseAngle + angle) * Math.PI) / 180
  const cos = Math.cos(rad) * scale
  const sin = Math.sin(rad) * scale
  for (let k = 0; k < count; k++) {
    const x = points[k * 2]
    const y = points[k * 2 + 1]
    points[k * 2] = cos * x - sin * y + ox
    points[k * 2 + 1] = sin * x + cos * y + oy
  }
}
// 父变形器移动后，子旋转变形器的角度要跟着变：看「向上（0, -1）」方向在父变形里转了多少度
function rotationAngleDiff(origin, baseScale, transform) {
  const dir = [0, -baseScale]
  const t0 = transform(origin)
  for (let i = 0; i < 10; i++) {
    const f = 0.1 ** i
    const t1 = transform([origin[0] + dir[0] * f, origin[1] + dir[1] * f])
    const rx = t1[0] - t0[0]
    const ry = t1[1] - t0[1]
    if (Number.isFinite(rx) && Number.isFinite(ry) && (rx !== 0 || ry !== 0)) return (angleTo(dir, [rx, ry]) * 180) / Math.PI
    const t2 = transform([origin[0] - dir[0] * f, origin[1] - dir[1] * f])
    const ix = t2[0] - t0[0]
    const iy = t2[1] - t0[1]
    if (Number.isFinite(ix) && Number.isFinite(iy) && (ix !== 0 || iy !== 0)) return (angleTo([t2[0], t2[1]], [ix, iy]) * 180) / Math.PI
  }
  return 0
}
// glam 的 Vec2::angle_to：atan2(cross, dot)
const angleTo = (a, b) => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])

const blendColor = (pm, ps, cm, cs, out, oo) => {   // 父色 × 子色（乘色相乘，屏幕色 a + b - a*b）
  out[oo] = pm[0] * cm[0]; out[oo + 1] = pm[1] * cm[1]; out[oo + 2] = pm[2] * cm[2]
  out[oo + 3] = ps[0] + cs[0] - ps[0] * cs[0]; out[oo + 4] = ps[1] + cs[1] - ps[1] * cs[1]; out[oo + 5] = ps[2] + cs[2] - ps[2] * cs[2]
}

// ---- 一帧 ----
// params：长度 = 参数个数的数组（超出 [min, max] 的会夹住）；返回 frame（同一个对象，原地更新）
export function updateModel(m, frame, input) {
  const c = m.counts
  const params = frame.params
  for (let i = 0; i < c.parameters; i++) {
    const v = input && input[i] !== undefined ? input[i] : m.paramDefault[i]
    params[i] = Math.min(Math.max(v, m.paramMin[i]), m.paramMax[i])
  }
  // 绑定的参数是否出了关键点范围
  for (let b = 0; b < c.keyformBindings; b++) {
    let out = 0
    for (const { keys, param } of m.bindingTables[b]) if (keyTableOutside(keys, params[param], 0.1 ** m.paramDecimals[param])) { out = 1; break }
    frame.binOut[b] = out
  }
  for (let i = 0; i < c.parts; i++) {
    const parent = m.partParent[i]
    frame.partEnabled[i] = m.partEnabled[i] && !frame.binOut[m.partBinding[i]] && (parent === -1 || frame.partEnabled[parent]) ? 1 : 0
  }
  for (let i = 0; i < c.deformers; i++) {
    const part = m.deformerParentPart[i]
    const deformer = m.deformerParentDeformer[i]
    frame.deformerEnabled[i] = m.deformerEnabled[i] && !frame.binOut[m.deformerBindingOf[i]] && (part === -1 || frame.partEnabled[part]) && (deformer === -1 || frame.deformerEnabled[deformer]) ? 1 : 0
  }
  for (let i = 0; i < c.artMeshes; i++) {
    const part = m.artParentPart[i]
    const deformer = m.artParentDeformer[i]
    frame.artEnabled[i] = m.artEnabled[i] && !frame.binOut[m.artBinding[i]] && (part === -1 || frame.partEnabled[part]) && (deformer === -1 || frame.deformerEnabled[deformer]) ? 1 : 0
  }
  for (let i = 0; i < c.parts; i++) {
    const o = Math.min(Math.max(frame.partOpacity[i], 0), 1)
    frame.partOpacity[i] = o
    const parent = m.partParent[i]
    frame.partCalcOpacity[i] = parent === -1 ? o : o * frame.partCalcOpacity[parent]
  }
  applyKeyforms(m, frame)
  evaluateTree(m, frame)
  for (let i = 0; i < c.artMeshes; i++) {
    const part = m.artParentPart[i]
    if (part !== -1) frame.opacities[i] *= frame.partCalcOpacity[part]
  }
  for (let g = 0; g < c.glues; g++) applyGlue(m, frame, g)
  sortRenderOrder(m, frame)
  return frame
}


// 混合变形（blend shape）：4.2 的 moc3 里，弯曲变形器 / 网格可以再挂「参数 → 偏移量」：每个绑定 3 个关键点（如 -30 / 0 / 30，基准点的偏移是 0），
// 偏移量 = Σ 关键点权重 × 该关键点的位置表，直接加在平时的关键形态插值结果上（弯曲变形器加在控制点上，网格加在局部顶点上，之后照常过变形器）。
// 约束（blendShapeConstraints）：某些绑定的偏移量要再乘「约束参数 → 倍率」的折线。有「约束」的参数（parametersV402 的第 3 组 = 2）另有一个关键点更密的绑定（序号 + 1），也由同一个参数驱动。
// 对着引擎里真正的 Cubism Core（krkrlive2d.dll 里静态链接的那份，用模拟器跑）核对过顶点位置、绘制顺序、不透明度。
const bsSeg = new Float64Array(2)
function bsBindingParam(m) {
  if (m.bsParamOf) return m.bsParamOf
  const of = new Int32Array(m.counts.blendShapeParameterBindings || 0).fill(-1)
  if (m.paramBsBinding) for (let p = 0; p < m.counts.parameters; p++) if (m.paramBsFlag[p] >= 1 && m.paramBsBinding[p] >= 0 && m.paramBsBinding[p] < of.length) { of[m.paramBsBinding[p]] = p; if (m.paramBsFlag[p] === 2 && m.paramBsBinding[p] + 1 < of.length) of[m.paramBsBinding[p] + 1] = p }
  m.bsParamOf = of
  return of
}
function applyBlendShape(m, frame, first, count, posStartOf, target, vertexCount) {
  const paramOf = bsBindingParam(m)
  for (let j = 0; j < count; j++) {
    const kb = first + j
    const binding = m.bsKbBinding[kb]
    const param = paramOf[binding]
    if (param < 0) continue
    const keyStart = m.bsPbKeyStart[binding]
    const keyCount = m.bsPbKeyCount[binding]
    keySegment(m.keys.subarray(keyStart, keyStart + keyCount), frame.params[param], bsSeg, 0.1 ** m.paramDecimals[param])
    const k0 = bsSeg[0]
    const t = bsSeg[1]
    // 约束：这个绑定的偏移量再乘「约束参数值 → 倍率」的折线（如 Param58 从 0 到 1，倍率 1.0 → 0.5）
    let scale = 1
    if (m.bsKbConstraintCount) {
      for (let n = 0; n < m.bsKbConstraintCount[kb]; n++) {
        const cons = m.bsConstraintIndex[m.bsKbConstraintStart[kb] + n]
        const v = frame.params[m.bsConstraintParam[cons]]
        const from = m.bsConstraintValueStart[cons]
        const num = m.bsConstraintValueCount[cons]
        if (!num) continue
        let f = m.bsConstraintValueWeight[from + num - 1]
        if (v <= m.bsConstraintValueKey[from]) f = m.bsConstraintValueWeight[from]
        else for (let q = 1; q < num; q++) { const k1 = m.bsConstraintValueKey[from + q]; if (v <= k1) { const k0v = m.bsConstraintValueKey[from + q - 1]; const u = k1 === k0v ? 1 : (v - k0v) / (k1 - k0v); f = m.bsConstraintValueWeight[from + q - 1] * (1 - u) + m.bsConstraintValueWeight[from + q] * u; break } }
        scale *= f
      }
    }
    for (const [key, w0] of [[k0, 1 - t], [k0 + 1, t]]) {
      const w = w0 * scale
      if (!w || key >= keyCount) continue
      const p = posStartOf(m.bsKbKeyformStart[kb] + key) / 2
      for (let v = 0; v < vertexCount; v++) { target[v * 2] += m.positions[(p + v) * 2] * w; target[v * 2 + 1] += m.positions[(p + v) * 2 + 1] * w }
    }
  }
}

const ONE3 = [1, 1, 1]
const ZERO3 = [0, 0, 0]
function applyKeyforms(m, frame) {
  const params = frame.params
  const has = Boolean(m.mulR)
  const colorAt = (start, k, outArr, o) => { outArr[o] = m.mulR[start + k]; outArr[o + 1] = m.mulG[start + k]; outArr[o + 2] = m.mulB[start + k]; outArr[o + 3] = m.scrR[start + k]; outArr[o + 4] = m.scrG[start + k]; outArr[o + 5] = m.scrB[start + k] }
  const setDefaultColor = (arr, o) => { arr[o] = 1; arr[o + 1] = 1; arr[o + 2] = 1; arr[o + 3] = 0; arr[o + 4] = 0; arr[o + 5] = 0 }
  const accColor = (arr, o, start, index, w) => { arr[o] += m.mulR[start + index] * w; arr[o + 1] += m.mulG[start + index] * w; arr[o + 2] += m.mulB[start + index] * w; arr[o + 3] += m.scrR[start + index] * w; arr[o + 4] += m.scrG[start + index] * w; arr[o + 5] += m.scrB[start + index] * w }
  void colorAt
  // 弯曲变形器
  for (let s = 0; s < m.counts.warpDeformers; s++) {
    const table = m.bindingTables[m.warpBinding[s]]
    const grid = frame.warpGrids[s]
    const kStart = m.warpKeyformStart[s]
    const vc = m.warpVertexCount[s]
    grid.fill(0)
    frame.warpOpacity[s] = 0
    const colorCap = m.warpColorStart && has && m.counts.keyformMultiplyColors > 0
    if (colorCap) frame.warpColor.fill(0, s * 6, s * 6 + 6); else setDefaultColor(frame.warpColor, s * 6)
    interpolate(table, params, (index, w) => {
      const p = m.warpKeyformPosStart[kStart + index] / 2
      for (let v = 0; v < vc; v++) { grid[v * 2] += m.positions[(p + v) * 2] * w; grid[v * 2 + 1] += m.positions[(p + v) * 2 + 1] * w }
      frame.warpOpacity[s] += m.warpKeyformOpacity[kStart + index] * w
      if (colorCap) accColor(frame.warpColor, s * 6, m.warpColorStart[s], index, w)
    })
  }
  if (m.bsWarpTarget) {
    for (let e = 0; e < m.bsWarpTarget.length; e++) {
      const s = m.bsWarpTarget[e]   // 弯曲变形器的序号（不是变形器总表里的序号）
      applyBlendShape(m, frame, m.bsWarpStart[e], m.bsWarpCount[e], (k) => m.warpKeyformPosStart[k], frame.warpGrids[s], m.warpVertexCount[s])
    }
  }
  // 旋转变形器
  for (let s = 0; s < m.counts.rotationDeformers; s++) {
    const table = m.bindingTables[m.rotBinding[s]]
    const kStart = m.rotKeyformStart[s]
    frame.rot.fill(0, s * 4, s * 4 + 4)
    frame.rotOpacity[s] = 0
    const colorCap = m.rotColorStart && has && m.counts.keyformMultiplyColors > 0
    if (colorCap) frame.rotColor.fill(0, s * 6, s * 6 + 6); else setDefaultColor(frame.rotColor, s * 6)
    interpolate(table, params, (index, w) => {
      const k = kStart + index
      frame.rot[s * 4] += m.rotKeyformX[k] * w
      frame.rot[s * 4 + 1] += m.rotKeyformY[k] * w
      frame.rot[s * 4 + 2] += m.rotKeyformScale[k] * w
      frame.rot[s * 4 + 3] += m.rotKeyformAngle[k] * w
      frame.rotOpacity[s] += m.rotKeyformOpacity[k] * w
      if (colorCap) accColor(frame.rotColor, s * 6, m.rotColorStart[s], index, w)
    })
  }
  // 网格
  for (let i = 0; i < m.counts.artMeshes; i++) {
    const table = m.bindingTables[m.artBinding[i]]
    const verts = frame.vertices[i]
    const kStart = m.artKeyformStart[i]
    const vc = m.artVertexCount[i]
    verts.fill(0)
    frame.artDrawOrder[i] = 0
    frame.opacities[i] = 0
    const colorCap = m.artColorStart && has && m.counts.keyformMultiplyColors > 0
    if (colorCap) frame.colors.fill(0, i * 6, i * 6 + 6); else setDefaultColor(frame.colors, i * 6)
    interpolate(table, params, (index, w) => {
      const k = kStart + index
      const p = m.artKeyformPosStart[k] / 2
      for (let v = 0; v < vc; v++) { verts[v * 2] += m.positions[(p + v) * 2] * w; verts[v * 2 + 1] += m.positions[(p + v) * 2 + 1] * w }
      frame.artDrawOrder[i] += m.artKeyformDrawOrder[k] * w
      frame.opacities[i] += m.artKeyformOpacity[k] * w
      if (colorCap) accColor(frame.colors, i * 6, m.artColorStart[i], index, w)
    })
  }
  if (m.bsArtTarget) {
    for (let e = 0; e < m.bsArtTarget.length; e++) {
      const i = m.bsArtTarget[e]
      applyBlendShape(m, frame, m.bsArtStart[e], m.bsArtCount[e], (k) => m.artKeyformPosStart[k], frame.vertices[i], m.artVertexCount[i])
    }
  }
  // 胶水强度
  for (let g = 0; g < m.counts.glues; g++) {
    frame.glueIntensity[g] = 0
    interpolate(m.bindingTables[m.glueBinding[g]], params, (index, w) => { frame.glueIntensity[g] += m.glueIntensities[m.glueKeyformStart[g] + index] * w })
  }
  // 部件绘制顺序
  for (let p = 0; p < m.counts.parts; p++) {
    frame.partDrawOrder[p] = 0
    interpolate(m.bindingTables[m.partBinding[p]], params, (index, w) => { frame.partDrawOrder[p] += m.partKeyformDrawOrder[m.partKeyformStart[p] + index] * w })
  }
  void ONE3
  void ZERO3
}

// 沿树把父变形器作用到子上（先序，父已经被它的父变形过了）
function evaluateTree(m, frame) {
  const scaleOf = (node) => frame.deformerScale
  void scaleOf
  const opacityOf = (n) => (n.kind === 'warp' ? frame.warpOpacity[n.specific] : frame.rotOpacity[n.specific])
  const colorOf = (n) => (n.kind === 'warp' ? [frame.warpColor, n.specific * 6] : [frame.rotColor, n.specific * 6])
  for (const root of m.roots) {
    if (root.kind === 'rot') frame.deformerScale[root.broad] = frame.rot[root.specific * 4 + 2]
    else if (root.kind === 'warp') frame.deformerScale[root.broad] = 1
  }
  const one = new Float64Array(2)
  for (const { node: child, parent } of m.order) {
    // 子的「数据」：网格 = 全部顶点；旋转变形器 = 原点；弯曲变形器 = 网格点
    let target
    let count
    let opacityArr
    let opacityIdx
    let colorArr
    let colorIdx
    if (child.kind === 'mesh') { target = frame.vertices[child.specific]; count = m.artVertexCount[child.specific]; opacityArr = frame.opacities; opacityIdx = child.specific; colorArr = frame.colors; colorIdx = child.specific * 6 } else if (child.kind === 'warp') { target = frame.warpGrids[child.specific]; count = m.warpGridCount[child.specific]; opacityArr = frame.warpOpacity; opacityIdx = child.specific; colorArr = frame.warpColor; colorIdx = child.specific * 6 } else { target = null; count = 1; opacityArr = frame.rotOpacity; opacityIdx = child.specific; colorArr = frame.rotColor; colorIdx = child.specific * 6 }
    let childAngleDiffTarget = -1
    if (child.kind === 'rot') {
      one[0] = frame.rot[child.specific * 4]
      one[1] = frame.rot[child.specific * 4 + 1]
      target = one
      childAngleDiffTarget = child.specific
      frame.deformerScale[child.broad] = frame.rot[child.specific * 4 + 2]
    }
    let transformPoint
    if (parent.kind === 'warp') {
      const grid = frame.warpGrids[parent.specific]
      const rows = m.warpRows[parent.specific]
      const cols = m.warpColumns[parent.specific]
      const isNew = m.warpIsNew[parent.specific]
      transformPoint = (p) => { const t = new Float64Array([p[0], p[1]]); applyWarp(grid, isNew, rows, cols, t, 1); return [t[0], t[1]] }
      if (childAngleDiffTarget >= 0) {
        frame.rot[childAngleDiffTarget * 4 + 3] += rotationAngleDiff([target[0], target[1]], 0.1, transformPoint)
        const t = transformPoint([target[0], target[1]])
        target[0] = t[0]; target[1] = t[1]
      } else applyWarp(grid, isNew, rows, cols, target, count)
    } else {
      const s = parent.specific
      const scale = frame.deformerScale[parent.broad]
      const ox = frame.rot[s * 4]
      const oy = frame.rot[s * 4 + 1]
      const angle = frame.rot[s * 4 + 3]
      const base = m.rotBaseAngle[s]
      transformPoint = (p) => { const t = new Float64Array([p[0], p[1]]); applyRotation(ox, oy, scale, angle, base, t, 1); return [t[0], t[1]] }
      if (childAngleDiffTarget >= 0) {
        frame.rot[childAngleDiffTarget * 4 + 3] += rotationAngleDiff([target[0], target[1]], 10, transformPoint)
        const t = transformPoint([target[0], target[1]])
        target[0] = t[0]; target[1] = t[1]
      } else applyRotation(ox, oy, scale, angle, base, target, count)
    }
    if (childAngleDiffTarget >= 0) { frame.rot[childAngleDiffTarget * 4] = target[0]; frame.rot[childAngleDiffTarget * 4 + 1] = target[1] }
    // 不透明度 / 颜色向下传
    opacityArr[opacityIdx] *= opacityOf(parent)
    const [parr, pidx] = colorOf(parent)
    blendColor([parr[pidx], parr[pidx + 1], parr[pidx + 2]], [parr[pidx + 3], parr[pidx + 4], parr[pidx + 5]], [colorArr[colorIdx], colorArr[colorIdx + 1], colorArr[colorIdx + 2]], [colorArr[colorIdx + 3], colorArr[colorIdx + 4], colorArr[colorIdx + 5]], colorArr, colorIdx)
    if (child.kind === 'warp') frame.deformerScale[child.broad] = frame.deformerScale[parent.broad]
    else if (child.kind === 'rot') frame.deformerScale[child.broad] *= frame.deformerScale[parent.broad]
  }
}

function applyGlue(m, frame, g) {
  const a = frame.vertices[m.glueMeshA[g]]
  const b = frame.vertices[m.glueMeshB[g]]
  const intensity = frame.glueIntensity[g]
  const start = m.glueInfoStart[g]
  const count = m.glueInfoCount[g]
  for (let i = 0; i + 1 < count; i += 2) {
    const ia = m.glueVertexIndices[start + i]
    const ib = m.glueVertexIndices[start + i + 1]
    const wa = m.glueWeights[start + i]
    const wb = m.glueWeights[start + i + 1]
    const ax = a[ia * 2]
    const ay = a[ia * 2 + 1]
    const bx = b[ib * 2]
    const by = b[ib * 2 + 1]
    a[ia * 2] += (bx - ax) * wa * intensity
    a[ia * 2 + 1] += (by - ay) * wa * intensity
    b[ib * 2] += (ax - bx) * wb * intensity
    b[ib * 2 + 1] += (ay - by) * wb * intensity
  }
}

// 绘制顺序：每个绘制顺序组里的对象按 draw order 排（被禁用的沉到最前），属于部件的子组插在部件的位置
function sortRenderOrder(m, frame) {
  const c = m.counts
  frame.renderOrder.length = 0
  if (!c.drawOrderGroups) {   // 没有绘制顺序组：按 draw order 排所有网格
    const list = []
    for (let i = 0; i < c.artMeshes; i++) if (frame.artEnabled[i] && frame.opacities[i] !== 0) list.push(i)
    list.sort((a, b) => frame.artDrawOrder[a] - frame.artDrawOrder[b] || a - b)
    for (const i of list) frame.renderOrder.push(i)
    return
  }
  frame.renderSeq.fill(0xffffffff)
  frame.cursors.fill(0)
  for (let gi = 0; gi < c.drawOrderGroups; gi++) {
    const count = m.dogObjectCount[gi]
    if (!count) continue
    const start = m.dogObjectStart[gi]
    const min = m.dogMin[gi]
    const max = m.dogMax[gi]
    const items = new Array(count)
    for (let j = 0; j < count; j++) {
      const type = m.dooType[start + j]
      const idx = m.dooIndex[start + j]
      let order
      if (type === 1) order = frame.partEnabled[idx] ? Math.round(frame.partDrawOrder[idx]) : min
      else order = frame.artEnabled[idx] ? Math.round(frame.artDrawOrder[idx]) : min
      items[j] = { j, order: Math.min(Math.max(order, min), max) }
    }
    items.sort((p, q) => p.order - q.order || p.j - q.j)
    let pos = frame.cursors[gi]
    for (const { j } of items) {
      const type = m.dooType[start + j]
      const idx = m.dooIndex[start + j]
      if (type === 1) {
        const owned = m.dooSelf[start + j]
        if (owned >= 0) { frame.cursors[owned] = pos; pos += m.dogTotalCount[owned] }
      } else { frame.renderSeq[pos] = idx; pos += 1 }
    }
  }
  for (let k = 0; k < c.artMeshes; k++) {
    const mesh = frame.renderSeq[k]
    if (mesh === 0xffffffff) continue
    if (frame.artEnabled[mesh] && frame.opacities[mesh] !== 0) frame.renderOrder.push(mesh)
  }
}

// ---- motion3.json ----
export function parseMotion(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json
  const meta = data.Meta || {}
  const curves = (data.Curves || []).map((cv) => {
    const s = cv.Segments || []
    const segs = []
    let i = 2
    const first = { t: s[0], v: s[1] }
    while (i < s.length) {
      const type = s[i]
      if (type === 1) { segs.push({ type, p: [s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5], s[i + 6]] }); i += 7 } else { segs.push({ type, p: [s[i + 1], s[i + 2]] }); i += 3 }
    }
    return { target: cv.Target, id: cv.Id, first, segs }
  })
  return { duration: Number(meta.Duration) || 0, loop: Boolean(meta.Loop), restricted: meta.AreBeziersRestricted !== false, fadeIn: Number(data.FadeInTime ?? meta.FadeInTime ?? 0), fadeOut: Number(data.FadeOutTime ?? meta.FadeOutTime ?? 0), curves }
}

// 一条曲线在 time 的值
function evalCurve(curve, time, restricted) {
  let p0 = curve.first
  if (time <= p0.t) return p0.v
  for (const s of curve.segs) {
    if (s.type === 1) {
      const [c1t, c1v, c2t, c2v, t3, v3] = s.p
      if (time <= t3) {
        let u
        if (restricted) u = (time - p0.t) / (t3 - p0.t)
        else {   // x 也是贝塞尔：二分找 u 使 x(u) = time
          let lo = 0
          let hi = 1
          for (let k = 0; k < 24; k++) {
            const mid = (lo + hi) / 2
            const a = p0.t + (c1t - p0.t) * mid
            const b = c1t + (c2t - c1t) * mid
            const cc = c2t + (t3 - c2t) * mid
            const x = (a + (b - a) * mid) + ((b + (cc - b) * mid) - (a + (b - a) * mid)) * mid
            if (x < time) lo = mid; else hi = mid
          }
          u = (lo + hi) / 2
        }
        const lerp = (a, b) => a + (b - a) * u
        const a1 = lerp(p0.v, c1v)
        const b1 = lerp(c1v, c2v)
        const c1 = lerp(c2v, v3)
        return lerp(lerp(a1, b1), lerp(b1, c1))
      }
      p0 = { t: t3, v: v3 }
    } else {
      const [t1, v1] = s.p
      if (time <= t1) {
        if (s.type === 0) return p0.v + ((v1 - p0.v) * (time - p0.t)) / (t1 - p0.t)
        return s.type === 2 ? p0.v : v1
      }
      p0 = { t: t1, v: v1 }
    }
  }
  return p0.v
}

// motion 在 time 秒的参数值写进 params（Float32Array，按 model.paramIds 下标）/ frame.partOpacity；loop 时 time 取模；没有 Duration 的当静态
export function evaluateMotion(motion, time, m, params, frame, loop = motion.loop) {
  const t = loop && motion.duration > 0 ? time % motion.duration : Math.min(time, motion.duration)
  for (const cv of motion.curves) {
    const v = evalCurve(cv, t, motion.restricted)
    if (cv.target === 'Parameter') { const i = m.paramIndex.get(cv.id); if (i !== undefined) params[i] = v } else if (cv.target === 'PartOpacity' && frame) { const i = m.partIndex.get(cv.id); if (i !== undefined) frame.partOpacity[i] = v }
  }
}
