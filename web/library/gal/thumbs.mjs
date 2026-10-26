// Gal 卡片缩略图的「提取引擎」：一张卡片 → 一组图（thumbs 数组，第一张 = 旧的 thumb）。
// 图的来源（顺序 = 数组顺序）：config.scriptThumbs / dirThumbs 的模板（路径里的 * ? 通配会匹配到全部）→ config.thumbSources（按文件名规律建索引）。
// 每个候选都要过 resolveAsset（存在 + 只认媒体目录内的真实路径），按真实文件去重，最多 MAX_THUMBS 张。
// 视频（mp4 / mkv / webm / mov）也可以是候选：数组里还是它的路径，前端取图时带 frame=1，服务端给一帧 JPEG（见 video-thumb.mjs）。
// 扩展点：骨架（spine / live2d）截图暂不做——以后可以在 thumbSources 里加 kind: 'skeleton'，在这里的 collectSources 里接渲染器。
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { expandTemplate } from './config.mjs'

export const MAX_THUMBS = 12
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'])
export const VIDEO_EXTS = new Set(['mp4', 'mkv', 'webm', 'mov', 'm4v'])
const MAX_DIR_NAMES = 20000      // 一个目录最多读这么多项（再多的截断）
const MAX_GLOB_RESULTS = 400     // 一次通配展开最多这么多个路径
const MAX_PER_KEY = 64           // 索引里一个键最多收这么多个文件
const RECHECK_MS = 2000          // 目录 mtime 复查间隔（间隔内直接用缓存）

const extOf = (file) => path.extname(file).slice(1).toLowerCase()
export const isVideoPath = (file) => VIDEO_EXTS.has(extOf(file))
const natural = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
export const hasWild = (text) => /[*?]/.test(text)
// 一段路径的通配：* = 段内任意字符，? = 单个字符，别的按字面
export function segmentRegExp(segment) {
  return new RegExp(`^${[...segment].map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`)
}

// 键模板：{1}{2} = 捕获组，{名字} = 命名捕获组，其余从 vars 取（卡片侧的 stem / name / parent）
export function fillKey(template, match, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, name) => {
    if (/^\d+$/.test(name)) return match?.[Number(name)] ?? ''
    return String(match?.groups?.[name] ?? vars[name] ?? '')
  })
}

// 规则 + 文件列表 → 索引：键 → 路径[]（文件名自然序）。files：[{ dir, name }]
export function buildSourceIndex(rule, files) {
  const re = new RegExp(rule.match)
  const exts = rule.kind === 'video' ? VIDEO_EXTS : IMAGE_EXTS
  const map = new Map()
  for (const { dir, name } of files) {
    if (name.startsWith('.') || !exts.has(extOf(name))) continue
    const m = re.exec(name)
    if (!m) continue
    const key = fillKey(rule.key, m)
    if (!key) continue
    const list = map.get(key) || []
    if (list.length < MAX_PER_KEY) { list.push(dir ? `${dir}/${name}` : name); map.set(key, list) }
  }
  return map
}

// 卡片（script：stem；dir：name / parent）→ 在索引里要查的键；规则不适用（for 不对 / forMatch 不匹配）返回 null
export function subjectKey(rule, subject) {
  if (rule.for !== 'both' && rule.for !== subject.kind) return null
  const own = subject.kind === 'script' ? subject.stem : subject.name
  const m = rule.forMatch ? new RegExp(rule.forMatch).exec(own) : null
  if (rule.forMatch && !m) return null
  const key = fillKey(rule.forKey || (subject.kind === 'script' ? '{stem}' : '{name}'), m, { stem: own, name: own, parent: subject.parent || '' })
  return key || null
}

// 去重 + 封顶（纯函数，测试用）：按先后顺序保留第一次出现的
export const dedupeCap = (list, cap = MAX_THUMBS) => [...new Set(list.filter(Boolean))].slice(0, cap)

const whyOf = (error) => (error?.code === 'ENOENT' || /not found|不存在|ENOENT/i.test(error?.message || '') ? '文件不存在' : (error?.message || '读不到'))

// 目录列表缓存（模块级：浏览每次请求都新建 provider）：键 = 目录绝对路径，按 mtime 复查
const listCache = new Map()
const indexCache = new Map()
export function invalidateThumbCaches(mediaDir) {
  let n = 0
  for (const map of [listCache, indexCache]) for (const key of [...map.keys()]) if (String(key).startsWith(`${mediaDir}${path.sep}`) || String(key).startsWith(`${mediaDir}|`)) { map.delete(key); n += 1 }
  return n
}
const trim = (map, max) => { while (map.size > max) map.delete(map.keys().next().value) }

export function createThumbEngine({ mediaDir, config, resolveAsset }) {
  const roots = config.resourceRoots
  const split = (rel) => (rel ? rel.split('/') : [])
  // 资源路径（相对资源根 / ~/ 相对媒体目录）→ 可能的磁盘目录（和 resolveAsset 同样的查找顺序：每个资源根 + 去掉 stripPrefixes）
  function absDirs(rel) {
    if (rel === '~' || rel.startsWith('~/')) return [path.join(mediaDir, ...split(rel.slice(2)))]
    const out = []
    for (const root of roots) {
      out.push(path.join(mediaDir, ...split(root), ...split(rel)))
      for (const prefix of config.stripPrefixes) if (rel.startsWith(prefix)) out.push(path.join(mediaDir, ...split(root), ...split(rel.slice(prefix.length))))
    }
    return out
  }
  // 目录里有什么（各资源根的并集，自然序）→ { names, sig }；sig = 各目录 mtime，索引缓存用它判断过没过期
  async function listNames(rel) {
    const names = new Set()
    const sigs = []
    for (const abs of absDirs(rel)) {
      let hit = listCache.get(abs)
      if (!hit || Date.now() - hit.at > RECHECK_MS) {
        let info = null
        try { info = await stat(abs) } catch { /* 没有这个目录 */ }
        if (!info?.isDirectory()) hit = { at: Date.now(), mtimeMs: 0, names: [] }
        else if (hit && hit.mtimeMs === info.mtimeMs) hit.at = Date.now()
        else { let list = []; try { list = (await readdir(abs)).slice(0, MAX_DIR_NAMES) } catch { /* 读不了 */ } hit = { at: Date.now(), mtimeMs: info.mtimeMs, names: list } }
        listCache.delete(abs); listCache.set(abs, hit); trim(listCache, 500)
      }
      sigs.push(`${abs}@${hit.mtimeMs}`)
      for (const name of hit.names) names.add(name)
    }
    return { names: [...names].sort(natural), sig: sigs.join(';') }
  }
  // 带 * ? 的路径 → 匹配到的全部路径（自然序，不检查是不是文件，交给 resolveAsset）；没有通配 = 原样
  async function expandGlob(pattern) {
    const segments = split(pattern)
    let current = [segments[0] === '~' ? '~' : '']
    for (const segment of segments[0] === '~' ? segments.slice(1) : segments) {
      if (!hasWild(segment)) { current = current.map((c) => (c ? `${c}/${segment}` : segment)); continue }
      const re = segmentRegExp(segment)
      const next = []
      for (const c of current) {
        for (const name of (await listNames(c)).names) {
          if (name.startsWith('.') || !re.test(name)) continue
          next.push(c ? `${c}/${name}` : name)
          if (next.length >= MAX_GLOB_RESULTS) break
        }
      }
      current = next
    }
    return current
  }
  // 一条 thumbSources 规则的索引（目录列表没变就复用）
  async function indexOf(rule, ruleKey) {
    const dirs = hasWild(rule.dir) ? await expandGlob(rule.dir) : [rule.dir]
    const listed = []
    for (const dir of dirs.slice(0, 50)) listed.push({ dir, ...(await listNames(dir)) })
    const cacheKey = `${mediaDir}|${ruleKey}|${listed.map((l) => l.sig).join('|')}`
    const hit = indexCache.get(cacheKey)
    if (hit) return hit
    const files = listed.flatMap(({ dir, names }) => names.map((name) => ({ dir, name })))
    const value = { map: buildSourceIndex(rule, files), dirs: dirs.length }
    indexCache.set(cacheKey, value); trim(indexCache, 100)
    return value
  }

  // 把一批候选路径按顺序验证，存在的放进 out（真实路径 → 候选路径，已有的不重复）。why：没成的原因（诊断面板用）
  async function addPaths(out, paths, from, why) {
    for (const candidate of paths) {
      if (out.size >= MAX_THUMBS) return
      if (!candidate) { why.push(`${from}：路径展开失败（含不安全字符？）`); continue }
      const wild = hasWild(candidate)
      const found = wild ? await expandGlob(candidate) : [candidate]
      if (wild && !found.length) { why.push(`${from}：${candidate} → 没有匹配的文件`); continue }
      for (const one of found) {
        if (out.size >= MAX_THUMBS) return
        try { const real = await resolveAsset(one); const key = typeof real === 'string' ? real : one; if (!out.has(key)) out.set(key, one) } catch (error) { if (!wild) why.push(`${from}：${one} → ${whyOf(error)}`) }
      }
    }
  }
  // thumbSources：按卡片的键从各规则的索引里取文件
  async function collectSources(out, subject, why) {
    for (const [i, rule] of config.thumbSources.entries()) {
      if (rule.fallback && out.size) continue
      const key = subjectKey(rule, subject)
      if (key === null) continue
      const { map, dirs } = await indexOf(rule, `${i}:${JSON.stringify(rule)}`)
      const files = map.get(key)
      if (!files?.length) { why.push(`thumbSources[${i}]：目录「${rule.dir}」（${dirs} 个）里按 /${rule.match}/ 索引了 ${map.size} 个键，没有「${key}」`); continue }
      await addPaths(out, files.slice(0, rule.limit), `thumbSources[${i}]`, why)
    }
  }

  return {
    addPaths,
    collectSources,
    // 脚本卡片：scriptThumbs 模板 + thumbSources（scriptIndex / 脚本里的背景图由调用方接在后面）
    async forScript(stem, { why = [] } = {}) {
      const out = new Map()
      const templates = []
      for (const template of config.scriptThumbs) {
        if (template.includes('{thumbsDir}')) {
          if (!config.thumbsDirs.length) why.push(`scriptThumbs「${template}」：thumbsDirs 为空，模板展开不了`)
          for (const thumbsDir of config.thumbsDirs) templates.push(expandTemplate(template, { stem, thumbsDir }))
        } else templates.push(expandTemplate(template, { stem }))
      }
      if (!config.scriptThumbs.length) why.push('scriptThumbs：未配置')
      await addPaths(out, templates, 'scriptThumbs', why)
      await collectSources(out, { kind: 'script', stem }, why)
      return out
    },
    // 目录 / 分组卡片：dirThumbs 里 parent、name 匹配的规则（全部），再加 thumbSources
    async forDir(entry, { why = [] } = {}) {
      const out = new Map()
      const parentName = entry.parentName ?? (entry.rel?.includes('/') ? entry.rel.split('/').slice(-2, -1)[0] : '')
      let matched = 0
      for (const rule of config.dirThumbs) {
        if (rule.parent !== '*' && rule.parent !== parentName) continue
        if (rule.name && !new RegExp(rule.name).test(entry.name)) continue
        matched += 1
        const paths = rule.paths.map((template) => {
          const candidate = expandTemplate(template, { name: entry.name, parent: parentName })
          if (!candidate) why.push(`dirThumbs「${template}」：路径展开失败`)
          return candidate
        })
        await addPaths(out, paths.filter(Boolean), 'dirThumbs', why)
      }
      if (!matched) why.push(config.dirThumbs.length ? `dirThumbs：${config.dirThumbs.length} 条规则里没有匹配（父目录「${parentName || '根'}」、名字「${entry.name}」）` : 'dirThumbs：未配置')
      await collectSources(out, { kind: 'dir', name: entry.name, parent: parentName }, why)
      return out
    },
  }
}
