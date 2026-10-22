// Gal 布局配置脚本：探测目录的实际结构，把条目 config 里的参数调到「真的能读到」，再挑封面、数脚本。
// 引擎和这个脚本之间只通过条目的 config 交互（字段见 web/library/gal/config.mjs）：
//   引擎缺的字段用默认（标准结构 = UViewer 资源包的布局）；这里只负责写「实际探测到的 / 你覆盖的」字段。
// 和别的 tag 脚本一样：改了就上传新版本（manifest.version 加一）重跑，不用改镜像。
//
// 选项：
//   dryRun          只探测和打日志，不写任何东西
//   replace         true = 整体替换 config（默认 false = 合并：只改写了的字段，别的保留）
//   coverScanLimit  挑封面最多看几个脚本（默认 40）
//   countCap        数脚本数的上限（默认 200000）
//   overrides       [{ path, config?, cover?, title? }]：按媒体目录的真实路径给个别媒体单独覆盖。
//                   path 是通配（* 匹配任意字符，包括 /）或 /正则/；按顺序全部命中的依次叠上去（后面的覆盖前面的）。
//                   config 是要覆盖的字段（和探测结果合并，顶层字段整个替换）；cover 是封面路径（相对资源根；~/ 开头 = 相对媒体目录）。
// 状态 tag：Gal配置: uviewer / 自定义 / 通用    Gal配置version: <脚本版本>

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const TAG_GROUPS = ['Gal配置', 'Gal配置version', 'Gal游戏']
const SCRIPT_EXT = 'txt'
const SAFE_SEGMENT = /^[^/\\\0]+$/

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const media = String(ctx.item?.source?.path || '')
  if (!media) throw new Error('条目没有记录来源目录（source.path）')
  const logs = [`探测 Gal 目录：${media}`]
  const game = ctx.item?.config?.game
  if (game?.id && game.id !== 'uviewer') {
    logs.push(`这个媒体的 config.game.id 是「${game.id}」，不归本脚本（UViewer 布局）管：跳过`)
    return keepOwn(ctx, logs)
  }
  if (!(await isDir(media))) {
    logs.push('目录不存在或不可读：不改任何配置')
    return keepOwn(ctx, logs)
  }

  // 1) 探测结构
  const found = (await detectUviewer(media)) || (await searchUviewer(media)) || genericLayout()
  const config = { ...found.config }
  logs.push(`识别为：${found.kind}${found.note ? `（${found.note}）` : ''}`)

  // 2) 覆盖（按媒体路径匹配）
  let title = ''
  let coverOverride = ''
  const applied = []
  options.overrides.forEach((rule, i) => {
    if (!matchesPath(rule.path, media)) return
    applied.push(i + 1)
    if (rule.config && typeof rule.config === 'object') Object.assign(config, rule.config)
    if (typeof rule.cover === 'string' && rule.cover) coverOverride = rule.cover
    if (typeof rule.title === 'string' && rule.title.trim()) title = rule.title.trim()
  })
  if (applied.length) logs.push(`命中覆盖项：第 ${applied.join('、')} 条`)

  // 3) 脚本数、封面
  const scriptRoot = (config.scriptRoots || [])[0]
  const rootAbs = scriptRoot ? path.join(media, ...splitRel(scriptRoot.dir)) : media
  const walked = await walkScripts(rootAbs, options.countCap)
  config.scriptCount = walked.count
  logs.push(`脚本根「${scriptRoot?.dir || '.'}」下有 ${walked.count} 个 .${SCRIPT_EXT} 文件${walked.capped ? '（达到上限）' : ''}`)
  if (!walked.count) logs.push('警告：脚本根下一个脚本都没有——目录结构可能不对，可以用 overrides 覆盖 scriptRoots')
  const cover = coverOverride || (await pickCover(media, config, walked.files.slice(0, options.coverScanLimit)))
  if (cover) config.cover = cover
  logs.push(cover ? `封面：${cover}` : '没找到合适的封面（脚本里没有存在的背景图，也没有缩略图缓存）')

  // 4) 记下是谁写的
  const version = String(ctx.script?.version || 'unknown')
  config.script = { id: ctx.script?.id || 'gal-layout-v1', version, ranAt: new Date().toISOString() }
  if (found.kind === 'uviewer') config.game = { id: 'uviewer', title: game?.title || '' }

  if (options.dryRun) {
    logs.push('【dryRun】只探测，不写配置；用完请关闭 dryRun 选项')
    logs.push(`将写入：${JSON.stringify(config).slice(0, 1500)}`)
    return keepOwn(ctx, logs)
  }
  const state = applied.length ? '自定义' : found.kind
  return {
    itemTags: [`Gal配置: ${state}`, `Gal配置version: ${version}`, ...(found.kind === 'uviewer' ? ['Gal游戏: uviewer'] : [])],
    unitTags: [],
    unitPatches: [],
    itemPatch: { gal: { config, replace: options.replace }, ...(title ? { title } : {}) },
    logs,
    details: { kind: found.kind, scripts: walked.count, cover, overrides: applied, version },
  }
}

// ---------- 探测 ----------

// UViewer 资源包：user_data/settings.json 里的 resource_path（默认 ./resources）下有 download/adv/text
async function detectUviewer(media, prefix = '') {
  const base = prefix ? path.join(media, ...splitRel(prefix)) : media
  let resourceRoot = 'resources'
  try {
    const settings = JSON.parse(await readFile(path.join(base, 'user_data', 'settings.json'), 'utf8'))
    const configured = cleanRel(settings?.resource_path)
    if (configured) resourceRoot = configured
  } catch { /* 没有 settings.json：用默认 */ }
  const textDir = `${resourceRoot}/download/adv/text`
  if (!(await isDir(path.join(base, ...splitRel(textDir))))) return null
  return uviewerConfig(base, media, prefix, resourceRoot, prefix ? '在子目录里找到' : '')
}

// 路径多了一层（用户传的是外面的目录）：往下找 download/adv/text
async function searchUviewer(media) {
  const hit = await findDir(media, ['download', 'adv', 'text'], 6)
  if (!hit) return null
  // hit = 相对媒体目录的路径，形如 a/b/resources/download/adv/text → 资源根 = a/b/resources
  const parts = hit.split('/')
  const resourceRoot = parts.slice(0, -3).join('/')
  const prefix = parts.slice(0, -4).join('/')   // 资源根的上一层（user_data 通常在那里）
  const config = await uviewerConfig(path.join(media, ...splitRel(prefix)), media, prefix, resourceRoot.slice(prefix ? prefix.length + 1 : 0), `目录里多了一层「${prefix || '.'}」`)
  return config
}

async function uviewerConfig(base, media, prefix, resourceRootRel, note) {
  const join = (...rels) => rels.filter(Boolean).join('/')
  const resourceRoot = join(prefix, resourceRootRel)
  const advDir = path.join(media, ...splitRel(join(resourceRoot, 'download', 'adv')))
  const roots = [{ id: 'text', dir: join(resourceRoot, 'download/adv/text'), label: 'text' }]
  try {
    for (const entry of (await readdir(advDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && entry.name !== 'text' && entry.name.startsWith('text') && !entry.name.includes('|') && !entry.name.includes('#')) {
        roots.push({ id: entry.name, dir: join(resourceRoot, 'download/adv', entry.name), label: entry.name })
      }
    }
  } catch { /* 没有同级目录 */ }
  return {
    kind: 'uviewer',
    note,
    config: {
      scriptRoots: roots,
      resourceRoots: [resourceRoot],
      namesFiles: [join(prefix, 'user_data/character_names.json')],
      thumbsDirs: [join(prefix, 'user_data/thumbnails')],
    },
  }
}

// 认不出的目录：整个目录当脚本根，脚本里的路径按媒体目录解析（再试一次去掉 download/ 前缀）
function genericLayout() {
  return {
    kind: '通用',
    note: '没有认出已知布局：整个目录当脚本根',
    config: { scriptRoots: [{ id: '', dir: '', label: '' }], resourceRoots: [''], stripPrefixes: ['download/'], namesFiles: [], thumbsDirs: [], labels: {}, merge: [], dirThumbs: [], scriptThumbs: [] },
  }
}

// ---------- 封面 / 统计 ----------

async function walkScripts(rootAbs, cap) {
  const files = []
  let count = 0
  async function walk(dir, depth) {
    if (depth > 12 || count >= cap) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || count >= cap) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(`.${SCRIPT_EXT}`)) { count++; if (files.length < 400) files.push(full) }
    }
  }
  await walk(rootAbs, 0)
  return { count, files, capped: count >= cap }
}

// 封面：前几个脚本里，先看有没有 UViewer 自己生成的缩略图（user_data/thumbnails/<脚本名>.webp），再看脚本里第一张存在的背景图
async function pickCover(media, config, files) {
  const roots = config.resourceRoots?.length ? config.resourceRoots : ['']
  const prefixes = config.stripPrefixes || []
  const exists = async (rel) => {
    for (const root of roots) {
      const candidates = [rel, ...prefixes.filter((p) => rel.startsWith(p)).map((p) => rel.slice(p.length))]
      for (const candidate of candidates) if (await isFile(path.join(media, ...splitRel(root), ...splitRel(candidate)))) return true
    }
    return false
  }
  for (const file of files) {
    const stem = path.basename(file, path.extname(file))
    for (const dir of config.thumbsDirs || []) {
      for (const rel of [`${dir}/${stem}.webp`, `${dir}/scripts/${stem}.webp`]) if (await isFile(path.join(media, ...splitRel(rel)))) return `~/${rel}`
    }
    let text = ''
    try { text = (await readFile(file)).toString('utf8') } catch { continue }
    for (const match of text.matchAll(/^bg,([^,\r\n]+),/gm)) {
      const src = cleanRel(match[1].trim())
      if (!src || /^color_/i.test(src)) continue
      if (await exists(src)) return src
    }
  }
  return ''
}

// ---------- 小工具 ----------

async function isDir(p) { try { return (await stat(p)).isDirectory() } catch { return false } }
async function isFile(p) { try { return (await stat(p)).isFile() } catch { return false } }
const splitRel = (rel) => String(rel || '').split('/').filter(Boolean)
function cleanRel(value) {
  const rel = String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  if (!rel) return ''
  return rel.split('/').some((part) => !SAFE_SEGMENT.test(part) || part === '.' || part === '..') ? '' : rel
}

// 在 root 下（深度 ≤ maxDepth）找依次是 names 的目录链，返回相对 root 的路径
async function findDir(root, names, maxDepth) {
  const queue = [{ rel: '', depth: 0 }]
  while (queue.length) {
    const { rel, depth } = queue.shift()
    const abs = path.join(root, ...splitRel(rel))
    let chain = abs
    let ok = true
    for (const name of names) { chain = path.join(chain, name); if (!(await isDir(chain))) { ok = false; break } }
    if (ok) return [rel, ...names].filter(Boolean).join('/')
    if (depth >= maxDepth) continue
    let entries
    try { entries = await readdir(abs, { withFileTypes: true }) } catch { continue }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) queue.push({ rel: rel ? `${rel}/${entry.name}` : entry.name, depth: depth + 1 })
    }
  }
  return ''
}

function matchesPath(pattern, target) {
  const text = String(pattern || '')
  if (!text) return false
  const regexForm = /^\/(.+)\/([a-z]*)$/.exec(text)
  try {
    if (regexForm) return new RegExp(regexForm[1], regexForm[2].replace(/[^gimsuy]/g, '')).test(target)
    const escaped = text.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    return new RegExp(`^${escaped}$`).test(target)
  } catch { return false }
}

function normalizeOptions(raw = {}) {
  return {
    dryRun: raw.dryRun === true,
    replace: raw.replace === true,
    coverScanLimit: Math.max(1, Math.min(400, Math.floor(Number(raw.coverScanLimit) || 40))),
    countCap: Math.max(1, Math.floor(Number(raw.countCap) || 200000)),
    overrides: (Array.isArray(raw.overrides) ? raw.overrides : []).filter((r) => r && typeof r === 'object' && typeof r.path === 'string'),
  }
}

// dryRun / 目录不可读时：服务端会先删掉本脚本上次生成的 tag 再写这次返回的，所以把现有的本脚本 tag 原样回传，保证什么都不变
function keepOwn(ctx, logs) {
  const own = (Array.isArray(ctx.item?.tags) ? ctx.item.tags : [])
    .map((tag) => (typeof tag === 'string' ? tag : String(tag?.name ?? tag?.tag ?? '')).trim())
    .filter((tag) => TAG_GROUPS.includes(tag.slice(0, Math.max(0, tag.indexOf(':'))).trim()))
  return { itemTags: own, unitTags: [], unitPatches: [], logs }
}
