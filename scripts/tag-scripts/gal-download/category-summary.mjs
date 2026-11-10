// Count files separately from bundle URLs. Shared bundles are deduplicated within
// each category and globally; sums across categories may count a shared URL twice.
export function summarizeCategories(plan, prepared, rows) {
  const categories = Object.create(null), bundles = new Map(), assetCategories = new Map()
  const rowsByUrl = new Map(rows.map((row) => [row.url, row]))
  const ensure = (category) => {
    if (!categories[category]) {
      categories[category] = { missingFiles: 0, downloadBundles: 0, selectedDownloadBundles: 0, downloadedBundles: 0, cachedBundles: 0, limitedBundles: 0, failedBundles: 0, existingFiles: 0, categorySkippedFiles: 0, writtenFiles: 0 }
      bundles.set(category, new Set())
    }
    return categories[category]
  }
  for (const category of Object.keys(plan.classification || {})) ensure(category)
  for (const entry of plan.entries) for (const asset of entry.assets || []) assetCategories.set(asset.target, asset.category || 'other')
  for (const asset of plan.skippedAssets || []) ensure(asset.category || 'other').categorySkippedFiles++
  const allNeeded = new Set()
  for (const entry of prepared) {
    for (const asset of entry.assets || []) {
      const category = asset.category || 'other'
      ensure(category).missingFiles++
      for (const url of [entry.url, ...(asset.dependencies || entry.dependencies || [])]) {
        bundles.get(category).add(url); allNeeded.add(url)
      }
    }
  }
  const existing = new Set(), written = new Set()
  for (const row of rows) {
    for (const target of row.skipped || []) if (!existing.has(target)) {
      existing.add(target); ensure(assetCategories.get(target) || 'other').existingFiles++
    }
    for (const target of row.written || []) if (!written.has(target)) {
      written.add(target); ensure(assetCategories.get(target) || 'other').writtenFiles++
    }
  }
  const countBundles = (urls) => {
    const counts = { downloadBundles: 0, selectedDownloadBundles: 0, downloadedBundles: 0, cachedBundles: 0, limitedBundles: 0, failedBundles: 0 }
    for (const url of urls) {
      const row = rowsByUrl.get(url)
      if (!row || row.status === 'unneeded' || (row.status === 'skip-existing' && row.cacheAvailable === undefined)) continue
      if (row.cacheAvailable) counts.cachedBundles++
      else counts.downloadBundles++
      if (row.transfer === 'download') counts.selectedDownloadBundles++
      if (row.downloadStatus === 'downloaded') counts.downloadedBundles++
      if (row.status === 'limited') counts.limitedBundles++
      if (row.status === 'failed') counts.failedBundles++
    }
    return counts
  }
  for (const [category, urls] of bundles) Object.assign(ensure(category), countBundles(urls))
  const totals = { ...countBundles(allNeeded), missingFiles: Object.values(categories).reduce((sum, row) => sum + row.missingFiles, 0), existingFiles: existing.size, categorySkippedFiles: plan.skippedAssets?.length || 0, writtenFiles: written.size }
  return { categories, totals }
}
