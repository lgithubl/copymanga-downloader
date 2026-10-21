// 媒体库搜索路由：生成和解析。纯函数、不碰 DOM，app.js 和 Node 里的自测（scripts/dev/library-route-selftest.mjs）共用。
//   #/library?tab=new&tag=…&type=…&sourceProfile=…&seriesSubtitle=…&sort=…&limit=…&page=…
// 一个搜索条件一个参数（可读、可手改、以后加条件不破坏旧链接，坏了一个只忽略它）。字段和「搜索预设」是同一套。
// 参数缺省就是下面的缺省值，不去读 localStorage——这样同一个链接在任何浏览器里结果一致。
// tab=new：从「点标签用新标签页」开出来的标签页，它不保存搜索状态，不会冲掉主标签页的状态。
export const LIBRARY_ROUTE_PREFIX = '#/library'
export const LIBRARY_ROUTE_DEFAULTS = { tag: '', type: 'all', sourceProfile: '', seriesSubtitle: 'any', sort: 'imported_desc', limit: '20', page: '1' }

export function parseLibraryRoute(hash = globalThis.location?.hash || '') {
  if (!hash.startsWith(LIBRARY_ROUTE_PREFIX)) return null
  const rest = hash.slice(LIBRARY_ROUTE_PREFIX.length)
  if (rest && !rest.startsWith('?')) return null   // #/librarysomething 不是
  let query
  try {
    query = new URLSearchParams(rest.slice(1))
  } catch {
    return null
  }
  const fields = {}
  for (const [key, fallback] of Object.entries(LIBRARY_ROUTE_DEFAULTS)) fields[key] = query.has(key) ? String(query.get(key)) : fallback
  fields.page = String(Math.max(1, Math.floor(Number(fields.page)) || 1))
  return { fields, newTab: query.get('tab') === 'new' }
}

// fields：{ tagSearch, type, sourceProfile, seriesSubtitle, sort, limit }（就是 currentLibrarySearchPresetFields() 的形状）。
// 只写和缺省不同的值，URL 短一点；newTab 时总是带 tab=new。
export function libraryRouteHash(fields, { page = 1, newTab = true } = {}) {
  const query = new URLSearchParams()
  if (newTab) query.set('tab', 'new')
  const values = { tag: fields.tagSearch ?? fields.tag ?? '', type: fields.type, sourceProfile: fields.sourceProfile, seriesSubtitle: fields.seriesSubtitle, sort: fields.sort, limit: fields.limit, page: String(page) }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue
    if (String(value) !== LIBRARY_ROUTE_DEFAULTS[key]) query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `${LIBRARY_ROUTE_PREFIX}?${text}` : LIBRARY_ROUTE_PREFIX
}
