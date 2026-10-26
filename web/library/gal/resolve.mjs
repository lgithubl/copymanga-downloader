// 资源路径解析规则（只写一份）：文件系统层（types/gal.mjs 的 resolveAsset）和内存索引层（适配器查文件索引）共用。
// 规则全部来自 config.resourceResolve（见 config.mjs / README「resourceResolve」），这里不认识任何游戏：
//   候选顺序：原路径 → rewrites（每条规则各自对原路径替换，按顺序）→ extensionFallbacks（对前面每个候选换扩展名）→ normalizeUnicode（对前面每个候选换 NFC / NFD）
//   找不到再：按路径段忽略大小写（caseInsensitive，默认 true = 以前的行为）。
//   候选必须是安全的相对路径（不许 .. / 绝对路径 / 空段）：规则替换出来的越界路径直接丢掉。
// 磁盘层的真实路径确认：必须在媒体目录内，或者在 allowedRoots（管理员脚本写的绝对目录）内。
import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { compileSafeRegex } from './voice.mjs'

export const RESOLVE_LIMITS = Object.freeze({ maxRewrites: 30, maxRoots: 20, maxDirs: 20, maxExtKeys: 30, maxExtTargets: 10 })

const UNICODE_FORMS = ['NFC', 'NFD']

// cfg（可以是不完整的 / 空 / undefined）→ 补满默认值的规则（编译好的正则缓存在 WeakMap 里，同一个 cfg 对象只编译一次）
const compiled = new WeakMap()
export function compileResolveRules(cfg) {
  const source = cfg && typeof cfg === 'object' ? cfg : {}
  if (compiled.has(source)) return compiled.get(source)
  const rewrites = []
  for (const rule of Array.isArray(source.rewrites) ? source.rewrites.slice(0, RESOLVE_LIMITS.maxRewrites) : []) {
    try {
      const re = compileSafeRegex(rule?.match, { flags: rule?.flags === 'i' ? 'i' : '', label: 'rewrite.match' })
      if (re && typeof rule.replace === 'string') rewrites.push({ re, replace: rule.replace })
    } catch { /* 不合格的规则丢掉（config 层已经报过了） */ }
  }
  const extensionFallbacks = new Map()
  if (source.extensionFallbacks && typeof source.extensionFallbacks === 'object') {
    for (const [from, list] of Object.entries(source.extensionFallbacks)) {
      if (Array.isArray(list)) extensionFallbacks.set(from.toLowerCase(), list.filter((e) => typeof e === 'string' && e))
    }
  }
  const rules = {
    rewrites,
    extensionFallbacks,
    unicode: (Array.isArray(source.normalizeUnicode) ? source.normalizeUnicode : []).filter((f) => UNICODE_FORMS.includes(f)),
    preferDirs: (Array.isArray(source.preferDirs) ? source.preferDirs : []).map((d) => String(d).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean),
    caseInsensitive: source.caseInsensitive !== false,
    allowedRoots: (Array.isArray(source.allowedRoots) ? source.allowedRoots : []).filter((d) => typeof d === 'string' && path.isAbsolute(d)).map((d) => path.resolve(d)),
  }
  if (cfg && typeof cfg === 'object') compiled.set(cfg, rules)
  return rules
}

const safeCandidate = (rel) => {
  if (typeof rel !== 'string') return ''
  const clean = rel.replace(/\\/g, '/')
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean)) return ''
  return clean.split('/').some((part) => !part || part === '.' || part === '..') ? '' : clean
}

const extOf = (rel) => {
  const slash = rel.lastIndexOf('/')
  const dot = rel.lastIndexOf('.')
  return dot > slash + 1 ? rel.slice(dot) : ''
}

// 一个相对路径 → 按顺序要试的候选（含原路径，去重，都是安全的相对路径）。没配任何规则 = [rel]
export function candidatePaths(rel, cfg) {
  const rules = compileResolveRules(cfg)
  const base = String(rel ?? '').replace(/\\/g, '/')
  const out = []
  const add = (value) => { if (value && !out.includes(value)) out.push(value) }
  add(base)
  for (const rule of rules.rewrites) {
    let next
    try { next = base.replace(rule.re, rule.replace) } catch { continue }
    if (next !== base) add(safeCandidate(next))
  }
  if (rules.extensionFallbacks.size) {
    for (const candidate of [...out]) {
      const ext = extOf(candidate)
      const targets = ext ? rules.extensionFallbacks.get(ext.toLowerCase()) : null
      for (const target of targets || []) add(safeCandidate(candidate.slice(0, candidate.length - ext.length) + target))
    }
  }
  if (rules.unicode.length) {
    for (const candidate of [...out]) for (const form of rules.unicode) add(candidate.normalize(form))
  }
  return out
}

// ---------- 文件系统层 ----------
// work：媒体目录（绝对）；rootRels：资源根（相对媒体目录，'' = 媒体目录本身）；variants：原路径 + stripPrefixes 去前缀后的路径（已由调用方算好，第一个是原路径）
// 返回磁盘上的真实路径（realpath，确认过是文件、在媒体目录或 allowedRoots 之内），找不到返回 ''
export async function resolveOnDisk({ work, rootRels, variants, cfg, caseInsensitiveFallback = true }) {
  const rules = compileResolveRules(cfg)
  const realWork = await realpath(work).catch(() => work)
  const realAllowed = []
  for (const dir of rules.allowedRoots) realAllowed.push(await realpath(dir).catch(() => ''))
  const confined = (real) => [realWork, ...realAllowed.filter(Boolean)].some((root) => real.startsWith(root + path.sep))
  const acceptable = async (candidate) => {
    try {
      const real = await realpath(candidate)
      if (confined(real) && (await stat(real)).isFile()) return real
    } catch { /* 下一个候选 */ }
    return ''
  }
  const rootDirOf = (root) => path.join(work, ...(root ? root.split('/') : []))
  const first = variants[0]
  // 1. 原路径（含 stripPrefixes 去前缀的变体）——和以前完全一样的顺序
  for (const root of rootRels) for (const variant of variants) { const hit = await acceptable(path.join(rootDirOf(root), variant)); if (hit) return hit }
  // 2. 规则生成的候选：rewrites → extensionFallbacks → unicode（对原路径；变体里的也各自展开）
  const extras = []
  for (const variant of variants) for (const candidate of candidatePaths(variant, cfg)) if (!variants.includes(candidate) && !extras.includes(candidate)) extras.push(candidate)
  for (const root of rootRels) for (const candidate of extras) { const hit = await acceptable(path.join(rootDirOf(root), candidate)); if (hit) return hit }
  // 3. 按路径段忽略大小写（只对原路径和规则候选，不对 stripPrefixes 变体——和以前一致）
  if (caseInsensitiveFallback && rules.caseInsensitive) {
    for (const root of rootRels) {
      for (const candidate of candidatePaths(first, cfg)) {
        const found = await caseInsensitivePath(rootDirOf(root), candidate.split('/'), rules.unicode.length > 0)
        const hit = found ? await acceptable(found) : ''
        if (hit) return hit
      }
    }
  }
  return ''
}

const foldName = (name, unicode) => (unicode ? name.normalize('NFC') : name).toLowerCase()
// 逐段按名字忽略大小写找（Windows 上做的游戏，脚本里的大小写和磁盘上不一致）
export async function caseInsensitivePath(base, parts, unicode = false) {
  let current = base
  for (const part of parts) {
    let names
    try { names = await readdir(current) } catch { return '' }
    const lower = foldName(part, unicode)
    const name = names.includes(part) ? part : names.find((n) => foldName(n, unicode) === lower)
    if (!name) return ''
    current = path.join(current, name)
  }
  return current
}

// ---------- 内存索引层（适配器用）----------
// index：已知路径的集合——Map / Set / 数组 / 普通对象（键 = 路径）/ 带 has()（和可选的 keys()）的对象。
//   只有 has() 的对象没法枚举，大小写 / 文件名查找会退化成只做精确匹配。
// cfg：config.resourceResolve（meta.config.resourceResolve）；preferDirs：覆盖 cfg.preferDirs（同名文件按这些目录前缀的顺序挑）
// 返回：
//   resolve(path)          → 索引里真实存在的那个路径（原样的键），没有返回 ''
//   resolveByName(name)    → 只知道文件名时：索引里所有 basename 匹配的路径中，按 preferDirs 顺序挑一个（都不在 preferDirs 下取字典序第一个），没有返回 ''
//   has(path)              → resolve(path) !== ''
export function createIndexResolver({ index, cfg = null, preferDirs = null } = {}) {
  const rules = compileResolveRules(cfg)
  const prefer = (Array.isArray(preferDirs) ? preferDirs : rules.preferDirs).map((d) => String(d).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean)
  const exact = (key) => {
    if (!index) return false
    if (typeof index.has === 'function') return Boolean(index.has(key))
    return Object.prototype.hasOwnProperty.call(index, key)
  }
  const keysOf = () => {
    if (!index) return []
    if (Array.isArray(index)) return index
    if (typeof index.keys === 'function') return [...index.keys()]
    if (typeof index[Symbol.iterator] === 'function') return [...index]
    if (typeof index.has === 'function') return null
    return Object.keys(index)
  }
  let folded = null     // 折叠后的路径 → [原键…]
  let byName = null     // 折叠后的 basename → [原键…]
  const unicode = rules.unicode.length > 0
  const build = () => {
    if (folded) return
    folded = new Map()
    byName = new Map()
    for (const key of keysOf() || []) {
      if (typeof key !== 'string') continue
      const f = foldName(key, unicode)
      if (!folded.has(f)) folded.set(f, [])
      folded.get(f).push(key)
      const name = foldName(key.slice(key.lastIndexOf('/') + 1), unicode)
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name).push(key)
    }
  }
  const pick = (list) => {
    if (list.length === 1 || !prefer.length) return [...list].sort()[0]
    for (const dir of prefer) {
      const under = list.filter((key) => key === dir || key.startsWith(`${dir}/`)).sort()
      if (under.length) return under[0]
    }
    return [...list].sort()[0]
  }
  const lookup = (rel, byBase) => {
    const candidates = candidatePaths(rel, cfg)
    // 路径查找：先精确（原样的键）；文件名查找：同名文件可能不止一个，一律走 byName 表按 preferDirs 挑
    if (!byBase) for (const candidate of candidates) if (exact(candidate)) return candidate
    if (!byBase && !rules.caseInsensitive) return ''
    build()
    const table = byBase ? byName : folded
    for (const candidate of candidates) {
      let hits = table.get(foldName(candidate, unicode))
      if (!hits) continue
      // 文件名查找：有大小写完全一致的就只在它们里面挑；不允许忽略大小写时只认完全一致的
      if (byBase) {
        const same = hits.filter((key) => key.slice(key.lastIndexOf('/') + 1) === candidate)
        if (same.length || !rules.caseInsensitive) hits = same
      }
      if (hits.length) return pick(hits)
    }
    return ''
  }
  return {
    resolve: (rel) => lookup(String(rel ?? '').replace(/\\/g, '/'), false),
    resolveByName: (name) => lookup(String(name ?? '').replace(/\\/g, '/').replace(/^.*\//, ''), true),
    has: (rel) => lookup(String(rel ?? '').replace(/\\/g, '/'), false) !== '',
  }
}
