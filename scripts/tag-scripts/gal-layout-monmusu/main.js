// monmusu（Ren'Py 粉丝播放器）的 Gal 配置脚本。和 gal-layout-v1 一样，只通过条目的 config 和引擎交互（字段见 web/library/gal/config.mjs）。
// 谁归它管：config.game.id === 'monmusu'；或者还没有 game 且目录里探测到 script/hscene + script/movie.rpy。别的游戏跳过，不改任何东西。
// 写入的 config：
//   game {id:'monmusu'}          scriptRoots [{dir:'<游戏根>/script'}]   resourceRoots ['<游戏根>']（脚本里的 audio/…、images/… 从游戏根起算）
//   scriptExtensions ['rpy']     hiddenDirs ['sub_nav','tl'…]            merge：script 下的 hscene + hscene_still 混排，角标 anim / still
//   groups：按文件名前 5 位角色编号分组        dirThumbs：images 里找到的 icon_<编号>_0_idle 头像        scriptThumbs []
//   adapterOptions['renpy-monmusu']：{ aliasFiles（视频别名表）, imageDirs（图片目录） }
// 选项：dryRun / replace / countCap / overrides（同 gal-layout-v1：[{ path, config?, cover?, title? }]）
// 状态 tag：Gal配置: monmusu / 自定义    Gal配置version: <脚本版本>    Gal游戏: monmusu

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const GAME_ID = 'monmusu'
const TAG_GROUPS = ['Gal配置', 'Gal配置version', 'Gal游戏']
const SAFE_SEGMENT = /^[^/\\\0]+$/
const ICON_RE = /^icon_(\d{3,8})_0_idle\.(png|webp|jpe?g)$/i

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const media = String(ctx.item?.source?.path || '')
  if (!media) throw new Error('条目没有记录来源目录（source.path）')
  const logs = [`探测 monmusu 目录：${media}`]
  const game = ctx.item?.config?.game
  if (game?.id && game.id !== GAME_ID) {
    logs.push(`这个媒体的 config.game.id 是「${game.id}」，不归本脚本管：跳过`)
    return keepOwn(ctx, logs)
  }
  if (!(await isDir(media))) {
    logs.push('目录不存在或不可读：不改任何配置')
    return keepOwn(ctx, logs)
  }

  const hit = await findDir(media, ['script', 'hscene'], 6)
  const base = hit ? hit.split('/').slice(0, -2).join('/') : ''
  const hasMovie = hit ? await isFile(path.join(media, ...splitRel(join(base, 'script/movie.rpy')))) : false
  if (!hit || (!game?.id && !hasMovie)) {
    logs.push(hit ? '找到了 script/hscene，但没有 script/movie.rpy，也没有声明 game.id：不确定是 monmusu，跳过' : '没找到 script/hscene：这不像 monmusu 的目录结构，跳过（可以在 config.game 里写 {"id":"monmusu"} 后用 overrides 指定路径）')
    return keepOwn(ctx, logs)
  }
  logs.push(`游戏根：${base || '.'}${base ? '（目录里多了一层）' : ''}${hasMovie ? '' : '；没有 script/movie.rpy（视频别名表）'}`)

  const hasStill = await isDir(path.join(media, ...splitRel(join(base, 'script/hscene_still'))))
  const mergeDirs = ['hscene', ...(hasStill ? ['hscene_still'] : [])]
  const config = {
    game: { id: GAME_ID, title: game?.title || '' },
    scriptRoots: [{ id: 'script', dir: join(base, 'script'), label: '日文' }],
    resourceRoots: [base],
    namesFiles: [],
    thumbsDirs: [],
    scriptExtensions: ['rpy'],
    hiddenDirs: ['sub_nav', 'tl'],
    labels: { hscene: '动画', hscene_still: '静图' },
    merge: [{ parent: '.', dirs: mergeDirs, badges: { hscene: 'anim', hscene_still: 'still' } }],
    groups: [{ parent: '.', pattern: '^(\\d{5})[A-Za-z]\\d' }],
    scriptThumbs: [],
    adapterOptions: { 'renpy-monmusu': { aliasFiles: hasMovie ? [join(base, 'script/movie.rpy')] : [], imageDirs: [join(base, 'images')] } },
  }
  logs.push(`合并目录：${mergeDirs.join(' + ')}；按角色编号分组`)

  // 头像：images 里找 icon_<编号>_0_idle.*，据此生成模板（路径相对游戏根）
  const icon = await findIcon(path.join(media, ...splitRel(join(base, 'images'))), 30000)
  let cover = ''
  if (icon) {
    const dirRel = icon.dir ? `${join('images', icon.dir)}` : 'images'
    config.dirThumbs = [{ parent: '*', name: '^\\d{3,8}$', paths: [`${dirRel}/icon_{name}_0_idle.${icon.ext}`] }]
    cover = `${dirRel}/${icon.file}`
    logs.push(`头像模板：${config.dirThumbs[0].paths[0]}`)
  } else {
    config.dirThumbs = []
    logs.push('没找到 icon_<编号>_0_idle 头像图（images 目录里）：角色卡片没有头像')
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

  let count = 0
  for (const name of mergeDirs) count += await countFiles(path.join(media, ...splitRel(join(base, 'script', name))), '.rpy', options.countCap)
  config.scriptCount = count
  logs.push(`脚本 ${count} 个${count ? '' : '——结构可能不对，可以用 overrides 覆盖 scriptRoots'}`)
  if (coverOverride || cover) config.cover = coverOverride || cover
  logs.push(config.cover ? `封面：${config.cover}` : '没有封面')

  const version = String(ctx.script?.version || 'unknown')
  config.script = { id: ctx.script?.id || 'gal-layout-monmusu', version, ranAt: new Date().toISOString() }
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
    details: { game: GAME_ID, base, scripts: count, cover: config.cover || '', overrides: applied, version },
  }
}

// ---------- 小工具 ----------

async function isDir(p) { try { return (await stat(p)).isDirectory() } catch { return false } }
async function isFile(p) { try { return (await stat(p)).isFile() } catch { return false } }
const splitRel = (rel) => String(rel || '').split('/').filter(Boolean)
const join = (...parts) => parts.filter(Boolean).join('/')
const sortName = (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })

async function countFiles(rootAbs, ext, cap) {
  let count = 0
  async function walk(dir, depth) {
    if (depth > 8 || count >= cap) return
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

// images 下第一个 icon_<编号>_0_idle.*（按名字排序）：返回 { dir（相对 images）, file, ext }
async function findIcon(imagesAbs, cap) {
  let seen = 0
  async function walk(rel, depth) {
    if (depth > 6 || seen >= cap) return null
    let entries
    try { entries = (await readdir(path.join(imagesAbs, ...splitRel(rel)), { withFileTypes: true })).sort(sortName) } catch { return null }
    for (const entry of entries) {
      seen++
      if (entry.isFile()) {
        const m = ICON_RE.exec(entry.name)
        if (m) return { dir: rel, file: entry.name, ext: m[2] }
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && SAFE_SEGMENT.test(entry.name)) {
        const hit = await walk(join(rel, entry.name), depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  return walk('', 0)
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
