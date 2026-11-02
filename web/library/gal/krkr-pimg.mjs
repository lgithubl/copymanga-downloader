// PIMG（KiriKiri Z 的立绘 = 分层 PSB）：{ width, height, layers: [{ layer_id, name, left, top, width, height, visible, layer_type（0 图 / 2 组）, group_layer_id, opacity }], '<layer_id>.tlg': { resource } }，每层一张 TLG（TLG5）。
// 脚本里立绘 = { file: 'cha001.stand', options: { dress: '制服', face: '微笑', pose: '基本', add: '頬:眼鏡' } }：按层名选层，叠出一张完整立绘。
// 从 g07 采集的 12 个真实 PIMG（立绘的分层）合成对过：先画 dress（身体，没有五官），再 pose、face（在「表情差分」组里）、add 的各项（腮红 / 眼镜 / 刀…），表情落在脸上。
//   层名对不上的不报错（那一类不画）：add 的名字和 PIMG 里的层名写法不完全一样（脚本全角括号「頬（照れ）」、PIMG 里是「頬(照れ)」），按 NFKC 规整后比；脚本里的「頬」= PIMG 里的「頬」或「頬(通常)」；「xxxなし」= 不画。
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '')

// → { width, height, layers: [[id, name, group, left, top, w, h, visible, kind, res]], }（紧凑：写进虚拟的 .pimg.json）
export function pimgInfo(root) {
  if (!root || !Array.isArray(root.layers)) throw new Error('不是 PIMG（没有 layers）')
  return {
    width: Number(root.width) || 0,
    height: Number(root.height) || 0,
    layers: root.layers.map((l) => [l.layer_id, String(l.name ?? ''), l.group_layer_id ?? null, l.left | 0, l.top | 0, l.width | 0, l.height | 0, l.visible ? 1 : 0, l.layer_type === 2 ? 'group' : 'image', root[`${l.layer_id}.tlg`]?.resource ?? null]),
  }
}

// options → 要画的层 id（按画的先后）；info = pimgInfo 的结果。返回 { ids, missing: [类别:值] }
export function pickPimgLayers(info, options = {}) {
  const images = info.layers.filter((l) => l[8] === 'image' && l[9] !== null)
  const byName = new Map()
  for (const l of images) { const k = norm(l[1]); if (!byName.has(k)) byName.set(k, l) }
  const exact = (value) => byName.get(norm(value)) || null
  const ids = []
  const missing = []
  const push = (kind, value, layer) => { if (layer) { if (!ids.includes(layer[0])) ids.push(layer[0]) } else missing.push(`${kind}:${value}`) }
  for (const kind of ['dress', 'pose', 'face']) {
    const value = options?.[kind]
    if (!value) continue
    const layer = exact(value)
    if (layer || kind !== 'pose') push(kind, value, layer)   // pose 没有对应的层很常见（「基本」= 没有额外的层）：不算缺
  }
  const adds = String(options?.add ?? '').split(':').map((s) => s.trim()).filter(Boolean)
  for (const token of adds) {
    if (/なし$/.test(norm(token))) continue
    let layer = exact(token)
    if (!layer && norm(token) === '頬') layer = exact('頬(通常)')
    push('add', token, layer)
  }
  return { ids, missing }
}
