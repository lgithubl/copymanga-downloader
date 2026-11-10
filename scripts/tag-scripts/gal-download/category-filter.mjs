// Filter assets before download planning, while preserving dependencies of retained assets.
export function filterCategories(plan, skipCategories = []) {
  if (!Array.isArray(skipCategories) || skipCategories.some((c) => typeof c !== 'string' || !c)) throw new Error('skipCategories 必须是分类字符串数组')
  const skip = new Set(skipCategories), classification = Object.create(null), skippedAssets = []
  const entries = plan.entries.map((entry) => {
    const assets = []
    for (const asset of entry.assets || []) {
      const category = asset.category ?? 'other'
      if (typeof category !== 'string' || !category) throw new Error('资源 category 必须是非空字符串')
      const counts = classification[category] ||= { total: 0, selected: 0, skipped: 0 }
      counts.total++
      if (skip.has(category)) {
        counts.skipped++
        skippedAssets.push({ source: asset.source, target: asset.target, category, reason: 'skip-category' })
      } else { counts.selected++; assets.push({ ...asset, category }) }
    }
    const dependencies = assets.every((asset) => Array.isArray(asset.dependencies))
      ? [...new Set(assets.flatMap((asset) => asset.dependencies))]
      : entry.dependencies || []
    return { ...entry, assets, dependencies }
  })
  const byUrl = new Map(entries.map((entry) => [entry.url, entry])), needed = new Set()
  const visit = (url) => {
    if (needed.has(url)) return
    needed.add(url)
    for (const dependency of byUrl.get(url)?.dependencies || []) visit(dependency)
  }
  for (const entry of entries) if (entry.assets.length) visit(entry.url)
  return { ...plan, entries: entries.filter((entry) => needed.has(entry.url)), classification, skippedAssets, skipCategories: [...skip].sort() }
}
