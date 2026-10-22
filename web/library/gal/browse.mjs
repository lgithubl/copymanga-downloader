// Gal 的「浏览节点」：一个 Gal 媒体（= 一个目录）里，用户从首页一层层点进去，最后到播放页。
// 前端不知道目录长什么样，只认节点：每个节点是 { id, kind, title, parent, breadcrumb, items… }，
// 选项自带下一个节点的 id；点了就用那个 id 再取一次（走通用的 reader?sectionId=<节点 id>）。
//
// 节点就是真实目录树（脚本根下的每个目录一个节点，目录里的脚本是叶子），不写死分类/层级——
// 目录名的中文标签、头像、缩略图去哪找由「目录方案」(profiles/*.mjs) 给；元数据里只存几个路径（layout）。
//
// 节点 kind：
//   grid    卡片网格（这一层全是目录：分类、角色…）
//   list    列表（有脚本，目录和脚本混排：目录在前）；每项带缩略图和一行摘要
//   player  播放页（叶子，带规范场景）
// 以后要「文本+图片」「文本+视频」之类，新增 kind 和一个前端渲染函数即可，取数接口不变。
//
// 节点 id（不透明字符串，前端原样传回）：
//   ''                          默认脚本根（首页）
//   d:<相对路径>[#页码]          目录                s:<相对路径>   脚本（播放页）
//   @<脚本根 id>|d:…  /  @<脚本根 id>|s:…            非默认的脚本根（比如另一种语言的文本）
// 路径都相对「脚本根」。大目录靠翻页和按需读取：只列当前目录，读脚本头/内容只对当前页做，并按 mtime 缓存。
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { sniffGalAdapter } from './adapters/index.mjs'
import { galProfile, safeRelPath } from './profiles/index.mjs'
import { buildScene, firstBackgroundSrc } from './scene.mjs'
import { decodeTextFile } from '../text-decode.mjs'

const naturalCompare = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
const extOf = (file) => path.extname(file).slice(1).toLowerCase()
const stemOf = (file) => path.basename(file, path.extname(file))
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const hidden = (name) => name.startsWith('.')

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

// mediaDir：媒体目录（绝对路径）。layout：条目元数据里的 layout（见 profiles/index.mjs normalizeGalLayout）。
// resolveAsset(rel) → 磁盘真实路径（找不到抛错）；用来确认缩略图存在。
export function createBrowseProvider({ mediaDir, layout, adapters, scriptExtensions, maxScriptBytes, maxDepth = 12, resolveAsset }) {
  const profile = galProfile(layout.profile)
  const pageSize = layout.pageSize
  const sets = layout.scriptRoots
  const defaultSet = sets[0]
  const setById = (id) => sets.find((s) => s.id === id)
  const infoCache = new Map()   // 脚本 → { adapterId, thumb, excerpt, hasMovie }，按 mtime+size 失效
  let namesCache = null

  const absOf = (set, rel) => path.join(mediaDir, ...(set.dir ? set.dir.split('/') : []), ...(rel ? rel.split('/') : []))

  // ---------- 节点 id ----------
  function parseNodeId(raw) {
    const text = String(raw ?? '')
    const m = /^(.*?)(?:#(\d{1,6}))?$/s.exec(text)
    let body = m[1]
    const page = Math.max(1, Number(m[2]) || 1)
    let set = defaultSet
    if (body.startsWith('@')) {
      const bar = body.indexOf('|')
      if (bar < 0) throw fail(`无效的节点：${text.slice(0, 80)}`)
      set = setById(body.slice(1, bar))
      if (!set) throw fail('没有这个文本版本', 404)
      body = body.slice(bar + 1)
    }
    if (!body) return { set, kind: 'dir', rel: '', page }
    const colon = body.indexOf(':')
    const tag = colon < 0 ? body : body.slice(0, colon)
    const arg = colon < 0 ? '' : body.slice(colon + 1)
    if (tag !== 'd' && tag !== 's') throw fail(`无效的节点：${text.slice(0, 80)}`)
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
    let data = {}
    if (layout.namesFile) {
      try {
        const file = path.join(mediaDir, ...layout.namesFile.split('/'))
        if ((await stat(file)).size <= 1024 * 1024) data = JSON.parse(decodeTextFile(await readFile(file)).text)
      } catch { data = {} }
    }
    namesCache = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    return namesCache
  }
  const labelOf = async (name) => profile.dirLabel(name) || String((await readNames())[name] || '') || name

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

  // 一个目录里的内容：目录在前、脚本在后，自然序。脚本要被适配器认得才算（读 8KB 头，缓存）
  async function listDir(set, rel) {
    let entries
    try { entries = await readdir(absOf(set, rel), { withFileTypes: true }) } catch { throw fail('目录不存在', 404) }
    entries.sort((a, b) => naturalCompare(a.name, b.name))
    const dirs = []
    const scripts = []
    for (const entry of entries) {
      if (hidden(entry.name) || entry.name.includes('|') || entry.name.includes('#')) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) dirs.push({ type: 'dir', name: entry.name, rel: childRel })
      else if (entry.isFile() && scriptExtensions.includes(extOf(entry.name)) && (await scriptAdapterOf(absOf(set, childRel)))) scripts.push({ type: 'script', name: entry.name, stem: stemOf(entry.name), rel: childRel })
    }
    return { dirs, scripts, all: [...dirs, ...scripts] }
  }

  // 脚本摘要：缩略图候选（方案给的 → 脚本里第一张存在的背景图）、台词摘要、是不是带视频。按 mtime 缓存
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
    const candidates = profile.scriptThumbs({ stem: stemOf(rel), thumbsDir: layout.thumbsDir })
    if (scene) { const bg = firstBackgroundSrc(scene); if (bg) candidates.push(bg) }
    for (const candidate of candidates) {
      try { await resolveAsset(candidate); thumb = candidate; break } catch { /* 下一个 */ }
    }
    const result = { adapterId, thumb, excerpt, hasMovie }
    infoCache.set(key, result)
    return result
  }

  async function dirThumb(set, entry) {
    const parentName = entry.rel.includes('/') ? entry.rel.split('/').slice(-2, -1)[0] : ''
    for (const candidate of profile.dirThumbs({ name: entry.name, parentName, rel: entry.rel })) {
      try { await resolveAsset(candidate); return candidate } catch { /* 下一个 */ }
    }
    return ''
  }

  async function countChildren(set, rel) {
    try { return (await readdir(absOf(set, rel))).filter((n) => !hidden(n)).length } catch { return 0 }
  }

  // ---------- 父级 / 面包屑 ----------
  const parentRel = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
  async function pageOfChild(set, parentDir, childRel) {
    const { all } = await listDir(set, parentDir)
    const index = all.findIndex((e) => e.rel === childRel)
    return Math.floor(Math.max(0, index) / pageSize) + 1
  }
  async function parentOf(set, kind, rel) {
    if (kind === 'dir' && !rel) return null
    const dir = parentRel(rel)
    return dirNodeId(set, dir, await pageOfChild(set, dir, rel))
  }
  async function breadcrumbOf(set, kind, rel) {
    const crumbs = [{ id: dirNodeId(set, '', 1), title: sets.length > 1 && set !== defaultSet ? `首页（${set.label || set.id}）` : '首页' }]
    const parts = rel ? rel.split('/') : []
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      const last = i === parts.length - 1
      const isScript = kind === 'script' && last
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
      const { all } = await listDir(set, rel)
      const total = all.length
      const pageCount = Math.max(1, Math.ceil(total / pageSize))
      const current = Math.min(page, pageCount)
      const slice = all.slice((current - 1) * pageSize, current * pageSize)
      const items = []
      for (const entry of slice) {
        if (entry.type === 'dir') {
          const label = await labelOf(entry.name)
          const n = await countChildren(set, entry.rel)
          items.push({ type: 'dir', id: entry.name, title: label, subtitle: `${label !== entry.name ? `${entry.name} · ` : ''}${n} 项`, thumb: await dirThumb(set, entry), node: dirNodeId(set, entry.rel, 1) })
        } else {
          const info = await scriptInfo(set, entry.rel)
          items.push({ type: 'script', id: entry.rel, title: entry.stem, subtitle: [info.hasMovie ? '含视频' : '', info.excerpt].filter(Boolean).join(' · '), thumb: info.thumb, node: idOf(set, 'script', entry.rel) })
        }
      }
      const id = dirNodeId(set, rel, current)
      const title = rel ? await labelOf(rel.split('/').pop()) : '首页'
      return { node: { id, kind: items.length && items.every((i) => i.type === 'dir') ? 'grid' : 'list', title, ...base, page: current, pageCount, total, items } }
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

    // 上一话/下一话：同一目录里的相邻脚本
    const dir = parentRel(rel)
    const { scripts } = await listDir(set, dir)
    const at = scripts.findIndex((s) => s.rel === rel)
    const neighbour = (entry) => (entry ? { sectionId: idOf(set, 'script', entry.rel), title: entry.stem } : null)
    return {
      node: { id: idOf(set, 'script', rel), kind: 'player', title: stemOf(rel), ...base, page: 1, pageCount: 1, total: scene.steps.length, items: [] },
      scene,
      sectionNavigation: { prev: at > 0 ? neighbour(scripts[at - 1]) : null, next: at >= 0 && at < scripts.length - 1 ? neighbour(scripts[at + 1]) : null },
    }
  }

  // 导入时用：默认脚本根下一共多少脚本（只按扩展名数，不读文件）、第一张能用的背景图（封面候选）
  async function summarize({ coverScanLimit = 40, countCap = 200000 } = {}) {
    let scripts = 0
    const found = []
    const walk = async (rel, depth) => {
      let entries
      try { entries = await readdir(absOf(defaultSet, rel), { withFileTypes: true }) } catch { return }
      entries.sort((a, b) => naturalCompare(a.name, b.name))
      for (const entry of entries) {
        if (hidden(entry.name) || scripts >= countCap) continue
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) { if (depth < maxDepth) await walk(childRel, depth + 1) } else if (entry.isFile() && scriptExtensions.includes(extOf(entry.name))) {
          scripts += 1
          if (found.length < coverScanLimit) found.push(childRel)
        }
      }
    }
    await walk('', 0)
    let cover = ''
    for (const rel of found) {
      if (!(await scriptAdapterOf(absOf(defaultSet, rel)))) continue
      cover = (await scriptInfo(defaultSet, rel)).thumb
      if (cover) break
    }
    return { scripts, cover }
  }

  return { layout, getNode, summarize, internals: { parseNodeId, listDir, scriptInfo, idOf, dirNodeId } }
}
