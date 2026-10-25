// 节点图（config.nodes）→ catalog 树。
// 配置里是一张图：节点之间有「包含」（children，浏览用的树，返回上一级就沿着它）和「关联」（related，只做跳转链接，不当父子）；
// 这里把它按「包含」展开成适配器 catalog 同样的树 { children: [{ id, title, subtitle, thumb, badge, children | script, text, related }] }，
// 之后的翻页 / 筛选 / 面包屑 / 上一级 / 上一话下一话都沿用 browse.mjs 里 catalog 的那一套，节点 id 是 v:<编码后的位置>。
// 节点来源：
//   children   别的节点（按 id 引用，同一个节点可以挂在几处，每处各是一个位置）
//   dirs       目录通配（相对脚本根）：把这些目录里认得出的脚本收进来（match 过滤脚本名）
//   expand     { dirs, as }：每个匹配的目录生成一个子节点，用 as 指的节点当模板（{name} {path} {label} 可以写在 title / subtitle / thumb / dirs 里）
// 规则对不上的地方一律记进 problems（目录不存在 / 通配没匹配到 / 有文件没人认 / 节点没定义 / 成环 / 没有内容），列表页的「渲染诊断」里看得到。

const MAX_DEPTH = 6
const MAX_CHILDREN = 5000
const natural = (a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
// 适配器目录的节点挂到图里的某个位置：目录节点 id 加位置前缀，脚本节点保持原来的脚本路径
// 节点 id 尽量沿用适配器原来的（和不用节点图时一样，已有的链接 / 进度不受影响）；整张图里已经被占用了才加位置前缀
function placeAdapterNode(node, placement, used) {
  const claim = (id, fallback) => { const pick = used.has(id) ? fallback : id; used.add(pick); return pick }
  if (node.script !== undefined) return { ...node, id: claim(node.id, `${placement}|${node.script}`) }
  const id = claim(node.id, `${placement}/${node.id}`)
  return { ...node, id, children: (node.children || []).map((child) => placeAdapterNode(child, id, used)) }
}
const joinPlace = (parent, id) => (parent ? `${parent}/${id}` : id)
const fill = (template, vars) => String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''))

// nodes：config.nodes；prefix：脚本根相对媒体目录的前缀（'' 或 'dir/'），catalog 里的脚本路径要带上
// helpers：
//   expandGlob(glob) → { dirs: [脚本根下的相对目录], exists }       listScripts(rel) → { scripts: [{ rel, stem }], rejected: [rel], exists }
//   labelOf(name) → 显示名（名称表 / labels，没有就是 name）        thumbOf(template, vars) → 存在的缩略图路径或 ''      scriptThumb(stem) → 缩略图路径或 ''
//   adapterCatalog：{ top: [适配器目录的顶层节点], find(id) → 适配器目录里 id 对应的节点 | null }（给 spec.catalog 用；没有适配器目录就是 null）
export async function buildGraphCatalog({ nodes, prefix = '', expandGlob, listScripts, labelOf, thumbOf, scriptThumb, adapterCatalog = null }) {
  const problems = []
  const problem = (code, message) => { if (problems.length < 200) problems.push({ level: 'warn', code, message }) }
  const home = nodes?.home
  if (!home) return { tree: null, problems: [{ level: 'error', code: 'graph-no-home', message: 'config.nodes 里没有 home 节点' }] }
  const firstPlacement = new Map()   // 节点 id → 第一个位置（related 跳转用）
  const pending = []                 // { node, related: [节点 id] }
  const rejectedSeen = new Set()
  const used = new Set()             // 已经用过的节点 id（适配器节点沿用原 id，撞了才加前缀）

  async function build(specId, placement, vars, trail) {
    const spec = nodes[specId]
    if (!spec) { problem('graph-unknown-node', `节点「${specId}」没有定义（被「${trail.at(-1) || 'home'}」引用）`); return null }
    if (trail.includes(specId)) { problem('graph-cycle', `节点关系成环：${[...trail, specId].join(' → ')}（「包含」不能成环，要互相跳转请用 related）`); return null }
    if (trail.length >= MAX_DEPTH) { problem('graph-too-deep', `节点嵌套超过 ${MAX_DEPTH} 层：${[...trail, specId].join(' → ')}`); return null }
    const next = [...trail, specId]
    // spec.catalog：引用适配器目录里的节点；适配器没有这个目录：手写的节点报问题，gal-layout 生成的（auto）静默跳过
    let inherited = null
    if (spec.catalog) {
      inherited = spec.catalog === '*' ? { children: adapterCatalog?.top || [] } : adapterCatalog?.find(spec.catalog) || null
      if (!inherited) {
        if (!spec.auto) problem('graph-catalog-missing', `节点「${specId}」引用的适配器目录「${spec.catalog}」不存在（适配器${adapterCatalog ? '的目录里没有这一项' : '没有目录 / 没读到数据'}）`)
        return null
      }
    }
    const own = inherited && spec.catalog !== '*' && !used.has(inherited.id) ? inherited.id : placement
    used.add(own)
    const subtitle = fill(spec.subtitle, vars) || (spec.catalog !== '*' ? inherited?.subtitle || '' : '')
    const node = { id: own, title: fill(spec.title, vars) || inherited?.title || vars.label || specId, ...(subtitle ? { subtitle } : {}), text: fill(spec.text, vars), badge: spec.badge || (spec.catalog !== '*' ? inherited?.badge || '' : ''), thumb: '', children: [] }
    if (!firstPlacement.has(specId)) firstPlacement.set(specId, { placement, title: node.title })
    if (spec.thumb) node.thumb = await thumbOf(fill(spec.thumb, vars), vars)
    else if (inherited?.thumb && spec.catalog !== '*') node.thumb = inherited.thumb
    if (spec.related.length) pending.push({ node, related: spec.related })

    for (const childId of spec.children) {
      const child = await build(childId, joinPlace(placement, childId), vars, next)
      if (child) node.children.push(child)
    }

    if (spec.expand) {
      const re = spec.expand.match ? new RegExp(spec.expand.match) : null
      for (const glob of spec.expand.dirs) {
        const found = await expandGlob(fill(glob, vars))
        if (!found.dirs.length) problem('graph-glob-empty', `节点「${specId}」expand.dirs「${glob}」没有匹配到任何目录${found.exists ? '' : '（上级目录不存在）'}——规则和目录结构对不上`)
        for (const rel of found.dirs.slice(0, MAX_CHILDREN)) {
          const name = rel.slice(rel.lastIndexOf('/') + 1)
          if (re && !re.test(name)) continue
          const child = await build(spec.expand.as, joinPlace(placement, name), { name, path: rel, label: await labelOf(name) }, next)
          if (child) node.children.push(child)
        }
      }
    }

    const scripts = new Map()
    const re = spec.match ? new RegExp(spec.match) : null
    for (const glob of spec.dirs) {
      const found = await expandGlob(fill(glob, vars))
      if (!found.dirs.length) problem('graph-dir-missing', `节点「${specId}」dirs「${fill(glob, vars)}」没有匹配到任何目录${found.exists ? '' : '（上级目录不存在）'}——规则和目录结构对不上`)
      for (const rel of found.dirs) {
        const got = await listScripts(rel)
        if (got.rejected.length && !rejectedSeen.has(rel)) {
          rejectedSeen.add(rel)
          problem('graph-unrecognized', `目录「${rel}」里有 ${got.rejected.length} 个扩展名对的文件没有适配器认得，没有显示：${got.rejected.slice(0, 5).map((r) => r.slice(r.lastIndexOf('/') + 1)).join('、')}${got.rejected.length > 5 ? ' 等' : ''}`)
        }
        for (const script of got.scripts) if ((!re || re.test(script.stem)) && !scripts.has(script.rel)) scripts.set(script.rel, script)
      }
    }
    const ordered = [...scripts.values()].sort((a, b) => natural(a.stem, b.stem)).slice(0, MAX_CHILDREN)
    for (const script of ordered) {
      node.children.push({ id: `${node.id}|${script.rel}`, title: await labelOf(script.stem), subtitle: '', thumb: await scriptThumb(script.stem), badge: '', script: `${prefix}${script.rel}` })
    }
    // 适配器目录的内容原样挂进来（节点 id 加上当前位置做前缀，保证整张图里唯一）
    if (inherited) for (const child of inherited.children || []) node.children.push(placeAdapterNode(child, node.id, used))
    if (!node.children.length && (spec.dirs.length || spec.expand || spec.children.length || spec.catalog)) problem('graph-empty', `节点「${specId}」${vars.name ? `（${vars.name}）` : ''}没有任何内容`)
    return node
  }

  const root = await build('home', '', {}, [])
  for (const { node, related } of pending) {
    node.related = related.map((id) => firstPlacement.get(id)).filter(Boolean).map((hit) => ({ id: hit.placement, title: hit.title }))
    for (const id of related) if (!firstPlacement.has(id)) problem('graph-related-missing', `节点「${node.title}」的 related「${id}」不在图里（没有被任何 children / expand 引用，或没有定义）`)
  }
  return { tree: root ? { children: root.children } : null, problems }
}
