// tenkeiprdx（Unity 剧情查看器素材）的 Gal 配置脚本。和 gal-layout-v1 / gal-layout-monmusu 一样，只通过条目的 config 和引擎交互（字段见 web/library/gal/config.mjs）。
// 谁归它管：config.game.id === 'tenkeiprdx'；或者还没有 game 且目录里探测到 scenes/ + Backgrounds|Spines|Stills|Masterdata（素材根 = 放这些目录的那一层，一般是 Imported/）。
// 写入的 config：
//   game {id:'tenkeiprdx'}   scriptRoots [{dir:'<素材根>/scenes'}]   resourceRoots ['<素材根>']   scriptExtensions ['json']
//   scriptIndex：EpisodeThumbnails/event、extra 里 ep_eventstill_<a>_<b>… → 剧情 id '2'+a+b，缩略图 + 角标 event / extra
//   adapterOptions['tenkeiprdx-json'] { root }（适配器要的资源目录索引、username.txt 都从它出发）
// 选项：dryRun / replace / countCap / overrides（同 gal-layout-v1：[{ path, config?, cover?, title? }]）
// 状态 tag：Gal配置: tenkeiprdx / 自定义    Gal配置version: <脚本版本>    Gal游戏: tenkeiprdx

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const GAME_ID = 'tenkeiprdx'
const TAG_GROUPS = ['Gal配置', 'Gal配置version', 'Gal游戏']
const SIBLINGS = ['Backgrounds', 'Spines', 'Stills', 'Masterdata']
const THUMB_RULES = [['event', 'event'], ['extra', 'extra']]
const THUMB_RE = /^ep_eventstill_([^_]+)_([^_]+)/

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const media = String(ctx.item?.source?.path || '')
  if (!media) throw new Error('条目没有记录来源目录（source.path）')
  const logs = [`探测 tenkeiprdx 目录：${media}`]
  const game = ctx.item?.config?.game
  if (game?.id && game.id !== GAME_ID) {
    logs.push(`这个媒体的 config.game.id 是「${game.id}」，不归本脚本管：跳过`)
    return keepOwn(ctx, logs)
  }
  if (!(await isDir(media))) {
    logs.push('目录不存在或不可读：不改任何配置')
    return keepOwn(ctx, logs)
  }

  const found = await findRoot(media, 6)
  if (found === null) {
    logs.push('没找到 scenes/ 加 Backgrounds|Spines|Stills|Masterdata：这不像 tenkeiprdx 的素材目录，跳过（可以在 config.game 里写 {"id":"tenkeiprdx"} 后用 overrides 指定路径）')
    return keepOwn(ctx, logs)
  }
  const root = found
  logs.push(`素材根：${root || '.'}${root ? '（目录里多了一层）' : ''}`)
  const abs = (...rels) => path.join(media, ...splitRel(join(root, ...rels)))

  const config = {
    game: { id: GAME_ID, title: game?.title || '' },
    scriptRoots: [{ id: 'scenes', dir: join(root, 'scenes'), label: 'scenes' }],
    resourceRoots: [root],
    namesFiles: [],
    thumbsDirs: [],
    scriptExtensions: ['json'],
    labels: {},
    merge: [],
    groups: [],
    dirThumbs: [],
    scriptThumbs: [],
    scriptIndex: [],
    adapterOptions: { 'tenkeiprdx-json': { root } },
  }

  let cover = ''
  for (const [dirName, badge] of THUMB_RULES) {
    const dir = join('EpisodeThumbnails', dirName)
    const names = await listNames(abs(dir))
    const thumbs = names.filter((name) => THUMB_RE.test(name))
    if (!thumbs.length) { logs.push(`没有 ${dir}/ep_eventstill_*：这一类剧情没有缩略图`); continue }
    config.scriptIndex.push({ dir: join(root, dir), pattern: '^ep_eventstill_([^_]+)_([^_]+)', key: '2{1}{2}', badge })
    logs.push(`缩略图 ${dir}：${thumbs.length} 个，角标 ${badge}`)
    if (!cover) cover = `${dir}/${thumbs[0]}`
  }
  for (const missing of ['Backgrounds', 'Spines', 'Stills', 'BGM', 'AdventureVoice']) {
    if (!(await isDir(abs(missing)))) logs.push(`提示：没有 ${missing}/（用到它的剧情会缺资源）`)
  }

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

  const count = await countFiles(abs('scenes'), '.json', options.countCap)
  config.scriptCount = count
  logs.push(`剧情 JSON ${count} 个${count ? '' : '——结构可能不对，可以用 overrides 覆盖 scriptRoots'}`)
  if (coverOverride || cover) config.cover = coverOverride || cover
  logs.push(config.cover ? `封面：${config.cover}` : '没有封面')

  const version = String(ctx.script?.version || 'unknown')
  config.script = { id: ctx.script?.id || 'gal-layout-tenkeiprdx', version, ranAt: new Date().toISOString() }
  if (options.dryRun) {
    logs.push('【dryRun】只探测，不写配置；用完请关闭 dryRun 选项')
    logs.push(`将写入：${JSON.stringify(config).slice(0, 1500)}`)
    return keepOwn(ctx, logs)
  }
  return {
    itemTags: [`Gal配置: ${applied.length ? '自定义' : GAME_ID}`, `Gal配置version: ${version}`, `Gal游戏: ${GAME_ID}`],
    unitTags: [],
    unitPatches: [],
    itemPatch: { gal: { config, replace: options.replace }, ...(title ? { title } : {}) },
    logs,
    details: { game: GAME_ID, root, scripts: count, cover: config.cover || '', overrides: applied, version },
  }
}

// ---------- 小工具 ----------

async function isDir(p) { try { return (await stat(p)).isDirectory() } catch { return false } }
const splitRel = (rel) => String(rel || '').split('/').filter(Boolean)
const join = (...parts) => parts.filter(Boolean).join('/')
const sortName = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })

async function listNames(dirAbs) {
  try { return (await readdir(dirAbs)).filter((name) => !name.startsWith('.')).sort(sortName) } catch { return [] }
}

async function countFiles(rootAbs, ext, cap) {
  let count = 0
  async function walk(dir, depth) {
    if (depth > 4 || count >= cap) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || count >= cap) continue
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), depth + 1)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) count++
    }
  }
  await walk(rootAbs, 0)
  return count
}

// 广度优先找「有 scenes/，并且同级有 Backgrounds|Spines|Stills|Masterdata」的目录；返回相对 media 的路径（'' = media 本身），没有返回 null
async function findRoot(media, maxDepth) {
  const queue = [{ rel: '', depth: 0 }]
  while (queue.length) {
    const { rel, depth } = queue.shift()
    const abs = path.join(media, ...splitRel(rel))
    let entries
    try { entries = await readdir(abs, { withFileTypes: true }) } catch { continue }
    const dirs = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    if (dirs.has('scenes') && SIBLINGS.some((name) => dirs.has(name))) return rel
    if (depth >= maxDepth) continue
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) queue.push({ rel: join(rel, entry.name), depth: depth + 1 })
    }
  }
  return null
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
    countCap: Math.max(1, Math.floor(Number(raw.countCap) || 200000)),
    overrides: (Array.isArray(raw.overrides) ? raw.overrides : []).filter((r) => r && typeof r === 'object' && typeof r.path === 'string'),
  }
}

// dryRun / 跳过时：服务端会先删掉本脚本上次生成的 tag 再写这次返回的，所以把现有的本脚本 tag 原样回传，保证什么都不变
function keepOwn(ctx, logs) {
  const own = (Array.isArray(ctx.item?.tags) ? ctx.item.tags : [])
    .map((tag) => (typeof tag === 'string' ? tag : String(tag?.name ?? tag?.tag ?? '')).trim())
    .filter((tag) => TAG_GROUPS.includes(tag.slice(0, Math.max(0, tag.indexOf(':'))).trim()))
  return { itemTags: own, unitTags: [], unitPatches: [], logs }
}
