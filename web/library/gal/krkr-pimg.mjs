// PIMG（KiriKiri Z 的立绘 = 分层 PSB）：{ width, height, layers: [{ layer_id, name, left, top, width, height, visible, layer_type（0 图 / 2 组）, group_layer_id, opacity }], '<layer_id>.tlg': { resource } }，每层一张 TLG（TLG5）。
// 脚本里立绘 = { file: 'cha001.stand', options: { dress: '制服', face: '微笑', pose: '基本', add: '頬:眼鏡' } }：按层名选层，叠出一张完整立绘。
// 从 g07 采集的 12 个真实 PIMG（立绘的分层）合成对过：先画 dress（身体，没有五官），再 pose、face（在「表情差分」组里）、add 的各项（腮红 / 眼镜 / 刀…），表情落在脸上。
//   层名对不上的不报错（那一类不画）：add 的名字和 PIMG 里的层名写法不完全一样（脚本全角括号「頬（照れ）」、PIMG 里是「頬(照れ)」），按 NFKC 规整后比；脚本里的「頬」= PIMG 里的「頬」或「頬(通常)」；「xxxなし」= 不画。
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '')

// .sinfo（立绘的选项表，KiriKiri 文本外壳里的 TSV；每个立绘一份，和 .pimg 配套）：脚本里的选项值 → PIMG 里的层名。行：
//   dress <服装名> diff <差分名 = pose> <层名 | ダミー>      脚本 options.dress + options.pose → 身体层（pose「基本」一行、「弓」「HG」…各一行；ダミー = 这个组合没有图）
//   face  <表情名> <组/层名>                                脚本 options.face → 「表情差分/微笑」这样的路径（取最后一段）
//   addgroup <组名> / add <值> <层名 | ダミー>               脚本 options.add（: 隔开的各项）→ 层
// 例（g07 cha001）：face 困惑 = 表情差分/困惑・呆れ，face 恥じらい = 表情差分/恥じらい、照れ，add 頬 = 頬（通常），add 頬なし = ダミー。
// → { dress: [[服装, pose, 层名|null]], face: [[表情, 路径]], add: [[值, 层名|null]] }
export function parseSinfo(text) {
  const out = { dress: [], face: [], add: [] }
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const c = line.split('\t')
    const layer = (v) => (v === undefined || v === '' || v === 'ダミー' ? null : v)
    if (c[0] === 'dress' && c.length >= 5) out.dress.push([c[1], c[3], layer(c[4])])
    else if (c[0] === 'face' && c.length >= 3) out.face.push([c[1], c[2]])
    else if (c[0] === 'add' && c.length >= 3) out.add.push([c[1], layer(c[2])])
  }
  return out
}

// .stand（立绘的配置，KiriKiri 文本里的 TJS 字典数组 [%["xoffset"=>48, "yoffset"=>392, "leveloffset"=>[[0,0],[0,0],[-40,-237]], "facexoff"=>-270, …]]）：
//   xoffset / yoffset = 这个立绘的基准位置偏移（画布中心相对舞台中心，px，y 向下）；leveloffset = 每个「层级」（奥 / 前 / 手前…）的 (x, y)；face* = 脸窗位置（不用）。只取数字字段。
export function parseStandInfo(text) {
  const src = String(text)
  const num = (key) => { const m = new RegExp(`"${key}"\\s*=>\\s*(-?\\d+(?:\\.\\d+)?)`).exec(src); return m ? Number(m[1]) : 0 }
  const lo = /"leveloffset"\s*=>\s*\[((?:\s*\[[^\]]*\]\s*,?)*)\]/.exec(src)
  const levelOffset = lo ? [...lo[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]) : []
  return { xoffset: num('xoffset'), yoffset: num('yoffset'), facexoff: num('facexoff'), faceyoff: num('faceyoff'), leveloffset: levelOffset }
}

// → { width, height, layers: [[id, name, group, left, top, w, h, visible, kind, res]], }（紧凑：写进虚拟的 .pimg.json）
export function pimgInfo(root) {
  if (!root || !Array.isArray(root.layers)) throw new Error('不是 PIMG（没有 layers）')
  return {
    width: Number(root.width) || 0,
    height: Number(root.height) || 0,
    layers: root.layers.map((l) => [l.layer_id, String(l.name ?? ''), l.group_layer_id ?? null, l.left | 0, l.top | 0, l.width | 0, l.height | 0, l.visible ? 1 : 0, l.layer_type === 2 ? 'group' : 'image', root[`${l.layer_id}.tlg`]?.resource ?? null]),
  }
}

// options → 要画的层 id（按画的先后）；info = pimgInfo 的结果；sinfo = parseSinfo 的结果（有就按它的映射，没有 / 对不上就按层名猜）。返回 { ids, missing: [类别:值] }
export function pickPimgLayers(info, options = {}, sinfo = null) {
  const images = info.layers.filter((l) => l[8] === 'image' && l[9] !== null)
  const byName = new Map()
  for (const l of images) { const k = norm(l[1]); if (!byName.has(k)) byName.set(k, l) }
  const exact = (value) => byName.get(norm(value)) || null
  const ids = []
  const missing = []
  const push = (kind, value, layer) => { if (layer) { if (!ids.includes(layer[0])) ids.push(layer[0]) } else missing.push(`${kind}:${value}`) }
  const lower = (v) => norm(v).toLowerCase()
  // dress：sinfo 里按（服装, pose）找；没有这一行 = 回到「服装名就是层名」
  if (options?.dress) {
    const row = sinfo?.dress.find(([d, p]) => norm(d) === norm(options.dress) && lower(p) === lower(options.pose || '基本'))
    if (row) { if (row[2]) push('dress', options.dress, exact(row[2])) } else push('dress', options.dress, exact(options.dress))
  }
  if (options?.pose && !sinfo) { const layer = exact(options.pose); if (layer) push('pose', options.pose, layer) }   // 没有 sinfo 时 pose 可能是单独的层；pose 没有对应的层很常见，不算缺
  if (options?.face) {
    const row = sinfo?.face.find(([f]) => norm(f) === norm(options.face))
    const name = row ? row[1].split('/').pop() : options.face
    push('face', options.face, exact(name) || exact(options.face))
  }
  const adds = String(options?.add ?? '').split(':').map((x) => x.trim()).filter(Boolean)
  for (const token of adds) {
    const row = sinfo?.add.find(([v]) => norm(v) === norm(token))
    if (row) { if (row[1]) push('add', token, exact(row[1])); continue }   // ダミー = 不画（頬なし / 手裏剣なし）
    if (/なし$/.test(norm(token))) continue
    let layer = exact(token)
    if (!layer && norm(token) === '頬') layer = exact('頬(通常)')
    push('add', token, layer)
  }
  return { ids, missing }
}
