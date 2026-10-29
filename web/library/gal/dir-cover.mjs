// 目录卡片封面的挑选（纯函数，browse.mjs 用，见 DEFAULT_GAL_CONFIG.dirCover 的说明）：
//   cands = { render: [{ name, render }], image: [{ name, path }] }（name = 脚本路径 / 图片路径，给 match / skip / only 用）
//   dc    = config.dirCover（已规整：prefer 是 { source, match, take } 数组）
// 先 only（写了就只留命中的）→ skip（命中的丢）→ 按 prefer 的档位挑：第一档有候选就用它（take 限制这一档张数），没有才看下一档；merge: true = 各档候选按顺序合起来；最后最多 max 张
const reOf = (sources) => (sources || []).map((source) => { try { return new RegExp(source, 'i') } catch { return null } }).filter(Boolean)

export function pickDirCover(cands, dc) {
  const only = reOf(dc.only)
  const skip = reOf(dc.skip)
  const keep = (item) => (!only.length || only.some((re) => re.test(item.name))) && !skip.some((re) => re.test(item.name))
  const pools = { render: (cands.render || []).filter(keep), image: (cands.image || []).filter(keep) }
  const picked = []
  for (const tier of dc.prefer || []) {
    const re = tier.match ? reOf([tier.match])[0] : null
    let list = (pools[tier.source] || []).filter((item) => (!re || re.test(item.name)) && !picked.includes(item))
    if (tier.take) list = list.slice(0, tier.take)
    if (!list.length) continue
    picked.push(...list)
    if (!dc.merge || picked.length >= dc.max) break
  }
  const chosen = picked.slice(0, dc.max)
  return { thumbs: chosen.filter((c) => c.path).map((c) => c.path), renders: chosen.filter((c) => c.render).map((c) => c.render) }
}
