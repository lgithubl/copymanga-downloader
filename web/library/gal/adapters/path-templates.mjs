// 适配器共用的小工具：路径模板 + 内存索引查找 + 选项合并（utage-book / grenze-xml 用；没有任何游戏知识）。
// 路径模板（管理员脚本写在 adapterOptions 里的字符串）：
//   {名字}           占位符，值来自适配器给的 vars；值为空 → 这个候选整条丢掉
//   {名字:ext}       值没有扩展名时补 .ext（{file:png}）
//   {ext} / {file}   「多值」占位符：vars 里给数组，按数组顺序各展开一条候选（扩展名 webp > png > jpg 这类优先级就是数组顺序）
//   **/              中间任意层目录：`voice/**/{voice}.m4a` = 在 voice/ 之下按文件名找（走 createIndexResolver.resolveByName，extensionFallbacks / preferDirs / 大小写都来自引擎配置）
// 没有索引时（没扫到文件）按模板「猜」：第一条候选，**/ 去掉。
import { createIndexResolver } from '../resolve.mjs'
import { compileSafeRegex } from '../voice.mjs'

export const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
// 默认值 + 用户值：对象逐层合并，数组 / 标量整个替换；用户值类型不对的字段丢掉用默认
export function mergeOptions(defaults, user, free = []) {
  if (!isPlain(defaults)) return user === undefined || user === null || typeof user !== typeof defaults || Array.isArray(user) !== Array.isArray(defaults) ? defaults : user
  const out = {}
  for (const key of Object.keys(defaults)) {
    const given = isPlain(user) ? user[key] : undefined
    // free：整张「名字 → 值」的表，用户给的条目逐条覆盖 / 追加（值可以是任意类型），不按默认值的类型卡
    out[key] = free.includes(key) ? { ...defaults[key], ...(isPlain(given) ? given : {}) } : mergeOptions(defaults[key], given, free)
  }
  if (isPlain(user)) for (const key of Object.keys(user)) if (!(key in defaults) && key !== '__proto__') out[key] = user[key]
  return out
}
// 正则源码 → RegExp；不合法 / 太长 / 有回溯风险就返回 null（调用方按「没有这条规则」处理）
export function safeRegex(source, flags = '') {
  try { return compileSafeRegex(source, { flags, label: 'adapterOptions' }) } catch { return null }
}
export const withExt = (file, ext) => (/\.[A-Za-z0-9]{2,4}$/.test(file) ? file : `${file}.${ext}`)

const PLACEHOLDER = /\{(\w+)(?::(\w+))?\}/g
// 模板 → 候选路径数组（占位符缺值 = 空数组）
export function expandTemplate(template, vars = {}) {
  const pieces = []
  let at = 0
  const source = String(template ?? '')
  for (const m of source.matchAll(PLACEHOLDER)) {
    pieces.push([source.slice(at, m.index)])
    const raw = Array.isArray(vars[m[1]]) ? vars[m[1]] : [vars[m[1]]]
    const values = raw.map((v) => (v === undefined || v === null ? '' : String(v))).filter(Boolean).map((v) => (m[2] ? withExt(v, m[2]) : v))
    if (!values.length) return []
    pieces.push(values)
    at = m.index + m[0].length
  }
  pieces.push([source.slice(at)])
  return pieces.reduce((acc, list) => acc.flatMap((a) => list.map((b) => a + b)), [''])
}
export const guessTemplate = (templates, vars) => {
  for (const template of templates) { const first = expandTemplate(template, vars)[0]; if (first) return first.replace(/\*\*\//g, '') }
  return ''
}

const stemOf = (name) => name.replace(/\.[^./]+$/, '').toLowerCase()
const lowerDir = (dir) => String(dir).toLowerCase()
// keys：已知路径（Set / Map / 数组）；cfg：meta.config.resourceResolve。dup：'skip' | 'first' | 'preferDirs'（**/ 候选里同名文件不止一个时怎么办）
export function createTemplateLookup({ keys, cfg = null }) {
  const all = Array.isArray(keys) ? keys : [...keys.keys?.() ?? keys]
  const scopes = new Map()
  let groups = null   // 前两段目录（小写）→ 键：目录前缀有 ≥ 2 段时不用扫全部键（Stills/<id> 这种几千个目录要各查一次）
  const underOf = (prefix) => {
    if (!prefix) return all
    const want = lowerDir(prefix)
    const segs = want.split('/')
    let pool = all
    if (segs.length >= 2) {
      if (!groups) { groups = new Map(); for (const key of all) { const g = lowerDir(key.split('/', 2).join('/')); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(key) } }
      pool = groups.get(segs.slice(0, 2).join('/')) || []
      if (segs.length === 2) return pool
    }
    return pool.filter((key) => lowerDir(key).startsWith(`${want}/`))
  }
  const scopeOf = (prefix, first) => {
    const id = `${first ? 'f' : 'p'}|${prefix}`
    if (!scopes.has(id)) {
      const under = underOf(prefix)
      scopes.set(id, { under, resolver: createIndexResolver({ index: under, cfg, ...(first ? { preferDirs: [] } : {}) }), stems: null })
    }
    return scopes.get(id)
  }
  const stemCount = (prefix, stem) => {
    const scope = scopeOf(prefix, false)
    if (!scope.stems) { scope.stems = new Map(); for (const key of scope.under) { const s = stemOf(key.slice(key.lastIndexOf('/') + 1)); scope.stems.set(s, (scope.stems.get(s) || 0) + 1) } }
    return scope.stems.get(stem.toLowerCase()) || 0
  }
  const one = (candidate, dup) => {
    const i = candidate.indexOf('**/')
    if (i < 0) return scopeOf('', false).resolver.resolve(candidate)
    const prefix = candidate.slice(0, i).replace(/\/$/, '')
    const name = candidate.slice(i + 3).replace(/^.*\//, '')
    if (dup === 'skip' && stemCount(prefix, stemOf(name)) > 1) return ''
    return scopeOf(prefix, dup === 'first').resolver.resolveByName(name)
  }
  return {
    // 第一个命中的真实路径（索引里的键），没有 ''
    find(templates, vars, dup = 'preferDirs') {
      for (const template of templates) for (const candidate of expandTemplate(template, vars)) { const hit = one(candidate, dup); if (hit) return hit }
      return ''
    },
    // 某个目录之下的全部键（大小写不敏感的目录前缀）
    under: (prefix) => scopeOf(prefix, false).under,
  }
}

// 同一个 ctx + 同一份 resourceResolve 只建一次（索引折叠表很大）
const lookups = new WeakMap()
const NO_CFG = {}
export function lookupFor(ctx, keys, cfg) {
  if (!lookups.has(ctx)) lookups.set(ctx, new WeakMap())
  const byCfg = lookups.get(ctx)
  const slot = cfg && typeof cfg === 'object' ? cfg : NO_CFG
  if (!byCfg.has(slot)) byCfg.set(slot, createTemplateLookup({ keys, cfg }))
  return byCfg.get(slot)
}
