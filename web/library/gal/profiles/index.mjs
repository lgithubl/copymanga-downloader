// 目录方案（profile）：回答「一个 Gal 媒体目录里，东西在哪」。
//   脚本根（可以有几个，比如不同语言的文本）、资源根（脚本里 download/... 从这里起算）、名称文件、缩略图缓存目录。
// 元数据（条目的 layout）只存这几个路径 + 方案名；目录树、节点、标题、缩略图全部靠读真实目录和脚本内容现算，不落地。
// 新增一种游戏/客户端的目录布局 = 新写一个方案（id / label / detect / 几个小钩子），在这里登记，浏览和播放都不用改。
import { genericProfile } from './generic.mjs'
import { safeRelPath } from './paths.mjs'
import { uviewerProfile } from './uviewer.mjs'

const profiles = new Map()
export function registerGalProfile(profile) {
  if (!profile?.id || typeof profile.detect !== 'function') throw new Error('gal profile needs id and detect()')
  profiles.set(profile.id, profile)
}
registerGalProfile(uviewerProfile)
registerGalProfile(genericProfile)   // 最后：什么都没认出来时的兜底

export { safeRelPath }
export const galProfileIds = () => [...profiles.keys()]
export const galProfile = (id) => profiles.get(id) || genericProfile

export const DEFAULT_PAGE_SIZE = 25

// 元数据里的 layout → 规整后的 layout（页面/手改 JSON 传来的东西不能信）
export function normalizeGalLayout(raw) {
  const v = raw && typeof raw === 'object' ? raw : {}
  const profile = galProfile(String(v.profile || 'generic'))
  const roots = (Array.isArray(v.scriptRoots) ? v.scriptRoots : [])
    .map((r) => ({ id: String(r?.id ?? ''), dir: safeRelPath(r?.dir), label: String(r?.label ?? r?.id ?? '') }))
    .filter((r) => r.dir !== null && !r.id.includes('|') && !r.id.includes('#'))
  const seen = new Set()
  const scriptRoots = roots.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
  const rel = (value) => safeRelPath(value) ?? ''
  return {
    profile: profile.id,
    scriptRoots: scriptRoots.length ? scriptRoots : [{ id: '', dir: '', label: '' }],
    resourceRoot: rel(v.resourceRoot),
    namesFile: rel(v.namesFile),
    thumbsDir: rel(v.thumbsDir),
    stripPrefixes: (Array.isArray(v.stripPrefixes) ? v.stripPrefixes : profile.stripPrefixes || []).map(String).filter((p) => p && !p.includes('..')),
    pageSize: Math.max(1, Math.min(200, Math.floor(Number(v.pageSize ?? v.browse?.pageSize)) || DEFAULT_PAGE_SIZE)),
  }
}

// 探测：每个方案看一眼目录，认得就返回它要存的最小 layout。都不认就用兜底
export async function detectGalLayout(mediaDir, helpers) {
  for (const profile of profiles.values()) {
    if (profile.id === 'generic') continue
    const layout = await profile.detect(mediaDir, helpers)
    if (layout) return normalizeGalLayout({ ...layout, profile: profile.id })
  }
  return normalizeGalLayout({ ...(await genericProfile.detect(mediaDir, helpers)), profile: 'generic' })
}
