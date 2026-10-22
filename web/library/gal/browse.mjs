// Gal 的「浏览节点」：一个 Gal 媒体（= 一个目录）里，用户从首页一层层点进去，最后到播放页。
// 前端不知道目录长什么样，只认节点：每个节点是 { id, kind, title, parent, breadcrumb, items… }，
// 选项自带下一个节点的 id；点了就用那个 id 再取一次（走通用的 reader?sectionId=<节点 id>）：
// 取到的是文本（kind=player）就按文本渲染，取到的是选项（kind=cards）就继续按选项渲染。
//
// 节点就是真实目录树（脚本根下的每个目录一个节点，目录里的脚本是叶子），层级、标签、头像、合并这些都由条目元数据里的
// config 决定（见 config.mjs）——引擎不内置任何游戏的目录知识。
//
// 节点 kind：
//   cards   卡片（目录卡片和脚本卡片混排：目录在前；每张卡片可带来源标记 badge、缩略图、一行摘要）
//   player  播放页（叶子，带规范场景）
//
// 节点 id（不透明字符串，前端原样传回）：
//   ''                          默认脚本根（首页）
//   d:<相对路径>[#页码]          目录                s:<相对路径>   脚本（播放页）
//   @<脚本根 id>|d:…  /  @<脚本根 id>|s:…            非默认的脚本根（比如另一种语言的文本）
// 路径都相对「脚本根」。合并目录（config.merge）：列某个目录时，把它指定的几个子目录的内容合进同一个列表，
// 这几个子目录本身不再出现；脚本节点 id 仍是真实路径，所以进度/历史不受影响。
// 大目录靠翻页和按需读取：只列当前目录，读脚本头/内容只对当前页做，并按 mtime 缓存。
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { sniffGalAdapter } from './adapters/index.mjs'
import { expandTemplate, globToRegExp, normalizeGalConfig } from './config.mjs'
import { safeRelPath } from './paths.mjs'
import { buildScene, firstBackgroundSrc } from './scene.mjs'
import { decodeTextFile } from '../text-decode.mjs'

const naturalCompare = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
const extOf = (file) => path.extname(file).slice(1).toLowerCase()
const stemOf = (file) => path.basename(file, path.extname(file))
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const hidden = (name) => name.startsWith('.')
const parentRel = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1)
export const MAX_SCRIPT_BYTES = 4 * 1024 * 1024

// 台词摘要：第一句有字的台词，去掉标记，截断
const excerptOf = (scene) => {
  for (const step of scene.steps) {
    for (const command of step.commands) {
      if (command.op !== 'text') continue
      const text = (command.segments || []).map((s) => s.text).join('').replace(/\s+/g, ' ').trim()
      if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text
    }
  }
  return ''
}

// mediaDir：媒体目录（绝对路径）。config：条目元数据里的 config（原样传，这里规整）。
// resolveAsset(rel) → 磁盘真实路径（找不到抛错）；用来确认缩略图存在。
export function createBrowseProvider({ mediaDir, config: rawConfig, adapters, maxScriptBytes = MAX_SCRIPT_BYTES, resolveAsset }) {
  const config = normalizeGalConfig(rawConfig)
  const scriptExtensions = config.scriptExtensions
  const pageSize = config.pageSize
  const sets = config.scriptRoots
  const defaultSet = sets[0]
  const setById = (id) => sets.find((s) => s.id === id)
  const mergeRules = config.merge.map((rule) => ({ ...rule, test: globToRegExp(rule.parent) }))
  const dirThumbRules = config.dirThumbs.map((rule) => ({ ...rule, nameRe: rule.name ? new RegExp(rule.name) : null }))
  const infoCache = new Map()   // 脚本 → { adapterId, thumb, excerpt, hasMovie }，按 mtime+size 失效
  let namesCache = null

  const absOf = (set, rel) => path.join(mediaDir, ...(set.dir ? set.dir.split('/') : []), ...(rel ? rel.split('/') : []))
  const mergeRuleAt = (dirRel) => mergeRules.find((rule) => rule.test.test(dirRel)) || null
  // d 是不是某个合并规则里被合并掉的子目录（返回规则；不是返回 null）
  const mergedSourceRule = (dirRel) => {
    if (!dirRel) return null
    const rule = mergeRuleAt(parentRel(dirRel))
    return rule && rule.dirs.includes(baseName(dirRel)) ? rule : null
  }
  // 一个路径（目录或脚本）在界面上的「父节点目录」：在被合并掉的子目录里的，父节点是合并它们的那个目录
  const effectiveParentDir = (rel) => {
    const dir = parentRel(rel)
    return mergedSourceRule(dir) ? parentRel(dir) : dir
  }

  // ---------- 节点 id ----------
  function parseNodeId(raw) {
    const textId = String(raw ?? '')
    const m = /^(.*?)(?:#(\d{1,6}))?$/s.exec(textId)
    let body = m[1]
    const page = Math.max(1, Number(m[2]) || 1)
    let set = defaultSet
    if (body.startsWith('@')) {
      const bar = body.indexOf('|')
      if (bar < 0) throw fail(`无效的节点：${textId.slice(0, 80)}`)
      set = setById(body.slice(1, bar))
      if (!set) throw fail('没有这个文本版本', 404)
      body = body.slice(bar + 1)
    }
    if (!body) return { set, kind: 'dir', rel: '', page }
    const colon = body.indexOf(':')
    const tag = colon < 0 ? body : body.slice(0, colon)
    const arg = colon < 0 ? '' : body.slice(colon + 1)
    if (tag !== 'd' && tag !== 's') throw fail(`无效的节点：${textId.slice(0, 80)}`)
    const rel = safeRelPath(arg)
    if (rel === null) throw fail('无效的路径', 400)
    return { set, kind: tag === 'd' ? 'dir' : 'script', rel, page: tag === 'd' ? page : 1 }
  }
  const idOf = (set, _kind, rel) => `${set === defaultSet ? '' : `@${set.id}|`}s:${rel}`
  // 页码总是写出来（列表节点的 id 固定带 #页码），好和「回到第几页」对得上
  const dirNodeId = (set, rel, page) => {
    if (!rel && set === defaultSet) return page > 1 ? `#${page}` : ''
    return `${set === defaultSet ? '' : `@${set.id}|`}d:${rel}${page > 1 ? `#${page}` : ''}`
  }

  // ---------- 读目录 / 脚本 ----------
  async function readNames() {
    if (namesCache) return namesCache
    const merged = {}
    for (const file of [...config.namesFiles].reverse()) {   // 前面的文件优先
      try {
        const abs = path.join(mediaDir, ...file.split('/'))
        if ((await stat(abs)).size > 1024 * 1024) continue
        const data = JSON.parse(decodeTextFile(await readFile(abs)).text)
        if (data && typeof data === 'object' && !Array.isArray(data)) Object.assign(merged, data)
      } catch { /* 没有这个文件 */ }
    }
    namesCache = merged
    return merged
  }
  const labelOf = async (name) => config.labels[name] || String((await readNames())[name] || '') || name

  async function scriptAdapterOf(abs) {
    let info
    try { info = await stat(abs) } catch { return '' }
    if (!info.isFile() || !info.size || info.size > maxScriptBytes || !scriptExtensions.includes(extOf(abs))) return ''
    const key = `${abs}|${info.mtimeMs}|${info.size}`
    const cached = infoCache.get(key)
    if (cached) return cached.adapterId
    let id = ''
    const handle = await open(abs, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(8192, info.size))
      await handle.read(buffer, 0, buffer.length, 0)
      id = sniffGalAdapter(decodeTextFile(buffer).text, adapters)
    } finally { await handle.close() }
    if (infoCache.size > 30000) infoCache.clear()
    infoCache.set(key, { adapterId: id })
    return id
  }

  async function readEntries(set, rel, origin = '') {
    let entries
    try { entries = await readdir(absOf(set, rel), { withFileTypes: true }) } catch { return null }
    const dirs = []
    const scripts = []
    for (const entry of entries) {
      if (hidden(entry.name) || entry.name.includes('|') || entry.name.includes('#')) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) dirs.push({ type: 'dir', name: entry.name, rel: childRel, origin })
      else if (entry.isFile() && scriptExtensions.includes(extOf(entry.name)) && (await scriptAdapterOf(absOf(set, childRel)))) scripts.push({ type: 'script', name: entry.name, stem: stemOf(entry.name), rel: childRel, origin })
    }
    return { dirs, scripts }
  }

  // 一个目录里的内容：目录在前、脚本在后，自然序（合并目录时，几个来源的内容混在一起排）。
  // 脚本要被适配器认得才算（读 8KB 头，缓存）
  async function listDir(set, rel) {
    const own = await readEntries(set, rel)
    if (!own) throw fail('目录不存在', 404)
    const rule = mergeRuleAt(rel)
    let dirs = own.dirs
    let scripts = own.scripts
    if (rule) {
      dirs = dirs.filter((d) => !rule.dirs.includes(d.name))
      for (const sourceName of rule.dirs) {
        const sourceRel = rel ? `${rel}/${sourceName}` : sourceName
        const got = await readEntries(set, sourceRel, rule.badges[sourceName] || sourceName)
        if (!got) continue
        dirs = dirs.concat(got.dirs)
        scripts = scripts.concat(got.scripts)
      }
    }
    dirs.sort((a, b) => naturalCompare(a.name, b.name))
    scripts.sort((a, b) => naturalCompare(a.name, b.name))
    return { dirs, scripts, all: [...dirs, ...scripts] }
  }

  // 脚本摘要：缩略图候选（config 里的模板 → 脚本里第一张存在的背景图）、台词摘要、是不是带视频。按 mtime 缓存
  async function scriptInfo(set, rel) {
    const abs = absOf(set, rel)
    const info = await stat(abs)
    const key = `${abs}|${info.mtimeMs}|${info.size}`
    const cached = infoCache.get(key)
    if (cached?.excerpt !== undefined) return cached
    const adapterId = await scriptAdapterOf(abs)
    let thumb = ''
    let excerpt = ''
    let hasMovie = false
    let scene = null
    try {
      scene = buildScene(adapterId, decodeTextFile(await readFile(abs)).text)
      excerpt = excerptOf(scene)
      hasMovie = scene.steps.some((step) => step.commands.some((c) => c.op === 'movie'))
    } catch { /* 解析失败：照样列出来，打开时再报错 */ }
    const candidates = []
    for (const template of config.scriptThumbs) {
      if (template.includes('{thumbsDir}')) {
        for (const thumbsDir of config.thumbsDirs) candidates.push(expandTemplate(template, { stem: stemOf(rel), thumbsDir }))
      } else candidates.push(expandTemplate(template, { stem: stemOf(rel) }))
    }
    if (scene) { const bg = firstBackgroundSrc(scene); if (bg) candidates.push(bg) }
    for (const candidate of candidates) {
      if (!candidate) continue
      try { await resolveAsset(candidate); thumb = candidate; break } catch { /* 下一个 */ }
    }
    const result = { adapterId, thumb, excerpt, hasMovie }
    infoCache.set(key, result)
    return result
  }

  async function dirThumb(entry) {
    const parentName = entry.rel.includes('/') ? entry.rel.split('/').slice(-2, -1)[0] : ''
    for (const rule of dirThumbRules) {
      if (rule.parent !== '*' && rule.parent !== parentName) continue
      if (rule.nameRe && !rule.nameRe.test(entry.name)) continue
      for (const template of rule.paths) {
        const candidate = expandTemplate(template, { name: entry.name, parent: parentName })
        if (!candidate) continue
        try { await resolveAsset(candidate); return candidate } catch { /* 下一个 */ }
      }
    }
    return ''
  }

  // 目录卡片上的数量：直接子项数（合并目录时 = 合并后的数量），不递归
  async function countChildren(set, rel) {
    const names = async (r) => { try { return (await readdir(absOf(set, r))).filter((n) => !hidden(n)) } catch { return [] } }
    const rule = mergeRuleAt(rel)
    let all = await names(rel)
    if (rule) {
      all = all.filter((n) => !rule.dirs.includes(n))
      for (const sourceName of rule.dirs) all = all.concat(await names(rel ? `${rel}/${sourceName}` : sourceName))
    }
    return all.length
  }

  // ---------- 父级 / 面包屑 ----------
  async function pageOfChild(set, dirRel, childRel) {
    const { all } = await listDir(set, dirRel)
    const index = all.findIndex((e) => e.rel === childRel)
    return Math.floor(Math.max(0, index) / pageSize) + 1
  }
  async function parentOf(set, kind, rel) {
    if (kind === 'dir' && !rel) return null
    const dir = effectiveParentDir(rel)
    // 被合并掉的子目录本身（用链接直接进来的）不在父目录的列表里，回到父目录第 1 页
    const page = mergedSourceRule(rel) ? 1 : await pageOfChild(set, dir, rel)
    return dirNodeId(set, dir, page)
  }
  async function breadcrumbOf(set, kind, rel) {
    const crumbs = [{ id: dirNodeId(set, '', 1), title: sets.length > 1 && set !== defaultSet ? `首页（${set.label || set.id}）` : '首页' }]
    const parts = rel ? rel.split('/') : []
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      const last = i === parts.length - 1
      const isScript = kind === 'script' && last
      if (!isScript && !last && mergedSourceRule(acc)) continue   // 被合并掉的目录不出现在路径里
      crumbs.push({ id: isScript ? idOf(set, 'script', acc) : dirNodeId(set, acc, 1), title: isScript ? stemOf(parts[i]) : await labelOf(parts[i]) })
    }
    return crumbs
  }
  const setChoices = (active) => (sets.length > 1 ? sets.map((s) => ({ id: s.id, label: s.label || s.id || '默认', node: dirNodeId(s, '', 1), active: s === active })) : [])

  // ---------- 取节点 ----------
  async function getNode(nodeId) {
    const { set, kind, rel, page } = parseNodeId(nodeId)
    const breadcrumb = await breadcrumbOf(set, kind, rel)
    const base = { parent: await parentOf(set, kind, rel).catch(() => null), breadcrumb, sets: setChoices(set), pageSize }

    if (kind === 'dir') {
      // 脚本根本身读不到（目录没按标准结构放、config 还没调对）：不报错，给一个空的首页 + 提示，让人知道该去跑脚本/改 config
      let listing
      try { listing = await listDir(set, rel) } catch (error) {
        if (rel || error.statusCode !== 404) throw error
        return { node: { id: dirNodeId(set, '', 1), kind: 'cards', title: '首页', ...base, page: 1, pageCount: 1, total: 0, items: [], notice: `脚本根「${set.dir || '.'}」读不到：这个目录没有按标准结构放，请运行元数据脚本 gal-layout-v1 探测并调整配置（或手动改 config）。` } }
      }
      const { all } = listing
      const total = all.length
      const pageCount = Math.max(1, Math.ceil(total / pageSize))
      const current = Math.min(page, pageCount)
      const slice = all.slice((current - 1) * pageSize, current * pageSize)
      const items = []
      for (const entry of slice) {
        if (entry.type === 'dir') {
          const label = await labelOf(entry.name)
          const n = await countChildren(set, entry.rel)
          items.push({ type: 'dir', id: entry.name, title: label, subtitle: `${label !== entry.name ? `${entry.name} · ` : ''}${n} 项`, thumb: await dirThumb(entry), badge: entry.origin, node: dirNodeId(set, entry.rel, 1) })
        } else {
          const info = await scriptInfo(set, entry.rel)
          items.push({ type: 'script', id: entry.rel, title: entry.stem, subtitle: [info.hasMovie ? '含视频' : '', info.excerpt].filter(Boolean).join(' · '), thumb: info.thumb, badge: entry.origin, node: idOf(set, 'script', entry.rel) })
        }
      }
      const id = dirNodeId(set, rel, current)
      const title = rel ? await labelOf(baseName(rel)) : '首页'
      return { node: { id, kind: 'cards', title, ...base, page: current, pageCount, total, items } }
    }

    // script
    if (!scriptExtensions.includes(extOf(rel))) throw fail('无效的脚本路径', 400)
    const abs = absOf(set, rel)
    let real
    try {
      real = await realpath(abs)
      const realMedia = await realpath(mediaDir)
      if (!real.startsWith(realMedia + path.sep) || !(await stat(real)).isFile()) throw new Error('x')
    } catch { throw fail('脚本不存在', 404) }
    const adapterId = await scriptAdapterOf(abs)
    if (!adapterId) throw fail('不是可识别的脚本', 400)
    const scene = buildScene(adapterId, decodeTextFile(await readFile(real)).text)

    // 上一话/下一话：同一个列表里（合并目录时跨来源）相邻的脚本
    const dir = effectiveParentDir(rel)
    const { scripts } = await listDir(set, dir).catch(() => ({ scripts: [] }))
    const at = scripts.findIndex((s) => s.rel === rel)
    const neighbour = (entry) => (entry ? { sectionId: idOf(set, 'script', entry.rel), title: entry.stem } : null)
    return {
      node: { id: idOf(set, 'script', rel), kind: 'player', title: stemOf(rel), ...base, page: 1, pageCount: 1, total: scene.steps.length, items: [] },
      scene,
      sectionNavigation: { prev: at > 0 ? neighbour(scripts[at - 1]) : null, next: at >= 0 && at < scripts.length - 1 ? neighbour(scripts[at + 1]) : null },
    }
  }

  return { config, getNode, internals: { parseNodeId, listDir, scriptInfo, idOf, dirNodeId, effectiveParentDir } }
}
