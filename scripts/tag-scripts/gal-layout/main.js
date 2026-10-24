// Gal 布局配置脚本（四种游戏合一）：探测目录的实际结构，把条目 config 里的参数调到「真的能读到」，再挑封面、数脚本。
// 引擎和这个脚本之间只通过条目的 config 交互（字段见 web/library/gal/config.mjs）；引擎缺的字段用默认（标准结构 = UViewer 资源包的布局），
// 这里只写「实际探测到的 / 你覆盖的」字段。和别的 tag 脚本一样：改了就上传新版本（manifest.version 加一）重跑，不用改镜像。
//
// 分发：
//   config.game.id 已经填了（导入时写的）  → 只走那个游戏的探测：uviewer / monmusu / tenkeiprdx / minashigo。认不出结构：uviewer 退回通用配置，别的跳过；不认识的 id 跳过
//   没填 game.id                          → 按 monmusu → tenkeiprdx → minashigo → uviewer 的顺序探测，谁认出来谁认领（把 game.id 写回 config）；都认不出 → 通用配置，不认领
// 各游戏写什么：
//   uviewer     脚本根（text + 同级 text* 另一套）、资源根、名称文件、缩略图目录；封面 = UViewer 自己生成的缩略图 / 脚本里第一张存在的背景
//   monmusu     脚本根 <游戏根>/script、资源根 <游戏根>、合并 hscene + hscene_still（角标 anim / still）、按角色编号分组、隐藏 sub_nav / tl、适配器参数（别名表、图片目录）、头像模板（images 里的 icon_<编号>_0_idle.*）
//   minashigo   脚本根 <游戏根>/game/scripts、资源根 <游戏根>/game、扩展名 rpy、按角色编号分组（scene_<类别><6 位角色><序号>）、适配器参数（别名表 game/movie.rpy、立绘定义 game/script.rpy、图片目录 game/images）
//   tenkeiprdx  脚本根 <素材根>/scenes、资源根 <素材根>、扩展名 json、适配器参数 root（活动 / 附加 / 角色 / 全部剧情这些列表由适配器每次从数据文件现读，不写进 config）
// 选项：
//   dryRun          只探测和打日志，不写任何东西
//   replace         true = 整体替换 config（默认 false = 合并：只改写了的字段，别的保留）
//   coverScanLimit  挑封面最多看几个脚本（uviewer / 通用，默认 40）
//   countCap        数脚本数的上限（默认 200000）
//   rawIgnore       正则字符串列表：播放器里「N 条指令暂未渲染」跳过匹配的指令（匹配指令名和「指令名,参数…」，不分大小写；匹配 = 我允许了）。
//                   写进每个被认领媒体的 config.rawIgnore；某个媒体要单独的，在 overrides 里写 config: { rawIgnore: [...] }（覆盖这里的全局值）
//   overrides       [{ path, config?, cover?, title? }]：按媒体目录的真实路径给个别媒体单独覆盖。
//                   path 是通配（* 匹配任意字符，包括 /）或 /正则/；按顺序全部命中的依次叠上去（后面的覆盖前面的）。
//                   config 是要覆盖的字段（和探测结果合并，顶层字段整个替换）；cover 是封面路径（相对资源根；~/ 开头 = 相对媒体目录）。
// 状态 tag：Gal配置: uviewer / monmusu / tenkeiprdx / minashigo / 通用 / 自定义    Gal配置version: <脚本版本>    Gal游戏: <game.id>

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const TAG_GROUPS = ['Gal配置', 'Gal配置version', 'Gal游戏']
const SAFE_SEGMENT = /^[^/\\\0]+$/

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const media = String(ctx.item?.source?.path || '')
  if (!media) throw new Error('条目没有记录来源目录（source.path）')
  const logs = [`探测 Gal 目录：${media}`]
  if (!(await isDir(media))) {
    logs.push('目录不存在或不可读：不改任何配置')
    return keepOwn(ctx, logs)
  }
  const game = ctx.item?.config?.game

  // 1) 认游戏、探测结构
  let found = null
  if (game?.id) {
    const handler = GAMES.find((g) => g.id === game.id)
    if (!handler) {
      logs.push(`这个媒体的 config.game.id 是「${game.id}」，本脚本不认识这个游戏（认识：${GAMES.map((g) => g.id).join(' / ')}）：跳过`)
      return keepOwn(ctx, logs)
    }
    found = await handler.detect(media, { declared: true, game, logs })
    if (!found && game.id === 'uviewer') found = genericLayout()
    if (!found) {
      logs.push(`config.game.id 是「${game.id}」，但目录里没认出它的结构：不改任何配置（可以用 overrides 指定路径，或检查 rootDir）`)
      return keepOwn(ctx, logs)
    }
  } else {
    for (const handler of GAMES) {
      found = await handler.detect(media, { declared: false, game, logs })
      if (found) break
    }
    if (!found) found = genericLayout()
  }
  const config = { ...found.config }
  logs.push(`识别为：${found.kind}${found.note ? `（${found.note}）` : ''}`)
  if (found.id) config.game = { id: found.id, title: game?.title || '' }

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

  if (options.rawIgnore.length && config.rawIgnore === undefined) config.rawIgnore = options.rawIgnore.slice()

  // 3) 脚本数、封面
  const result = await (found.finish ? found.finish(media, config, options, logs) : { count: 0, cover: '' })
  config.scriptCount = result.count
  const cover = coverOverride || result.cover
  if (cover) config.cover = cover
  logs.push(cover ? `封面：${cover}` : '没找到合适的封面')

  // 4) 记下是谁写的
  const version = String(ctx.script?.version || 'unknown')
  config.script = { id: ctx.script?.id || 'gal-layout', version, ranAt: new Date().toISOString() }

  if (options.dryRun) {
    logs.push('【dryRun】只探测，不写配置；用完请关闭 dryRun 选项')
    logs.push(`将写入：${JSON.stringify(config).slice(0, 1500)}`)
    return keepOwn(ctx, logs)
  }
  const state = applied.length ? '自定义' : found.id || found.kind
  return {
    itemTags: [`Gal配置: ${state}`, `Gal配置version: ${version}`, ...(found.id ? [`Gal游戏: ${found.id}`] : [])],
    unitTags: [],
    unitPatches: [],
    itemPatch: { gal: { config, replace: options.replace }, ...(title ? { title } : {}) },
    logs,
    details: { game: found.id || '', kind: found.kind, scripts: result.count, cover, overrides: applied, version },
  }
}

// ======================================================================
// monmusu（Ren'Py）
// ======================================================================
const MONMUSU_ICON_RE = /^icon_(\d{3,8})_0_idle\.(png|webp|jpe?g)$/i

async function detectMonmusu(media, { declared, game, logs }) {
  const hit = await findDir(media, ['script', 'hscene'], 6)
  if (!hit) {
    if (declared) logs.push('没找到 script/hscene')
    return null
  }
  const base = hit.split('/').slice(0, -2).join('/')
  const hasMovie = await isFile(path.join(media, ...splitRel(join(base, 'script/movie.rpy'))))
  if (!declared && !hasMovie) return null   // 没声明又没有视频别名表：不确定是 monmusu
  const hasStill = await isDir(path.join(media, ...splitRel(join(base, 'script/hscene_still'))))
  const mergeDirs = ['hscene', ...(hasStill ? ['hscene_still'] : [])]
  const config = {
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
  logs.push(`monmusu 游戏根：${base || '.'}${base ? '（目录里多了一层）' : ''}${hasMovie ? '' : '；没有 script/movie.rpy（视频别名表）'}`)
  logs.push(`合并目录：${mergeDirs.join(' + ')}；按角色编号分组`)
  // 头像：images 里找 icon_<编号>_0_idle.*，据此生成模板（路径相对游戏根）
  const icon = await findFirstFile(path.join(media, ...splitRel(join(base, 'images'))), MONMUSU_ICON_RE, 30000)
  let cover = ''
  if (icon) {
    const dirRel = icon.dir ? join('images', icon.dir) : 'images'
    config.dirThumbs = [{ parent: '*', name: '^\\d{3,8}$', paths: [`${dirRel}/icon_{name}_0_idle.${icon.ext}`] }]
    cover = `${dirRel}/${icon.file}`
    logs.push(`头像模板：${config.dirThumbs[0].paths[0]}`)
  } else {
    config.dirThumbs = []
    logs.push('没找到 icon_<编号>_0_idle 头像图（images 目录里）：角色卡片没有头像')
  }
  // 脚本卡片封面：动画（webm）脚本里没有背景图，封面用游戏菜单按钮的图——script/sub_nav 里 `imagebutton auto "<编号>_01_%s"` 跳到 h<编号>A1、`_02_` 跳 B1；
  // 事件（静图）菜单 event_nav 里 `r18_<编号>_stla1_%s` 跳 C1、stlb1 → D1、stlc1 → E1、stld1 → F1（%s = idle）。图在 images 里（可能再套一层目录）
  const coverRules = [
    ['^(\\d{5})_01_idle\\.(?:png|webp|jpe?g)$', '{1}A1'], ['^(\\d{5})_02_idle\\.(?:png|webp|jpe?g)$', '{1}B1'],
    ['^r18_(\\d{5})_stla1_idle\\.(?:png|webp|jpe?g)$', '{1}C1'], ['^r18_(\\d{5})_stlb1_idle\\.(?:png|webp|jpe?g)$', '{1}D1'],
    ['^r18_(\\d{5})_stlc1_idle\\.(?:png|webp|jpe?g)$', '{1}E1'], ['^r18_(\\d{5})_stld1_idle\\.(?:png|webp|jpe?g)$', '{1}F1'],
  ]
  // 菜单按钮图可能分散在 images 的几个子目录里（icon / thumbnail / event …）：整棵树扫一遍，每条规则对每个含匹配文件的目录各配一条 scriptIndex
  config.scriptIndex = []
  const hits = await findDirsWithFiles(path.join(media, ...splitRel(join(base, 'images'))), coverRules.map(([pattern]) => new RegExp(pattern)), 30000)
  coverRules.forEach(([pattern, key], i) => {
    for (const dir of hits[i]) config.scriptIndex.push({ dir: join(base, 'images', dir), pattern, key, badge: '' })
  })
  logs.push(config.scriptIndex.length ? `脚本封面：${config.scriptIndex.length} 条规则（动画 / 静图卡片用菜单按钮图）` : '没找到菜单按钮图（<编号>_01_idle / r18_<编号>_stla1_idle）：动画 / 静图卡片没有封面')
  return {
    id: 'monmusu',
    kind: 'monmusu',
    note: '',
    config,
    async finish(m, _config, options) {
      let count = 0
      for (const name of mergeDirs) count += await countFiles(path.join(m, ...splitRel(join(base, 'script', name))), '.rpy', options.countCap, 8)
      logs.push(`脚本 ${count} 个${count ? '' : '——结构可能不对，可以用 overrides 覆盖 scriptRoots'}`)
      return { count, cover }
    },
  }
}

// ======================================================================
// tenkeiprdx（Unity 剧情查看器素材）
// ======================================================================
const TENKEI_SIBLINGS = ['Backgrounds', 'Spines', 'Stills', 'Masterdata']

// ======================================================================
// minashigo（Ren'Py，MinashigoViewer：game/scripts/scene_*.rpy）
// ======================================================================
async function detectMinashigo(media, { declared, logs }) {
  const hit = await findDir(media, ['game', 'scripts'], 6)
  if (!hit) {
    if (declared) logs.push('没找到 game/scripts')
    return null
  }
  const gameRel = hit.split('/').slice(0, -1).join('/')   // …/game
  const mainScript = path.join(media, ...splitRel(join(gameRel, 'script.rpy')))
  // 没声明时靠 script.rpy 开头的 DynamicCharacter("name") 认（monmusu 没有 game/scripts，也没有它）
  let marker = false
  try { marker = /DynamicCharacter\s*\(\s*["']name["']/.test((await readFile(mainScript)).subarray(0, 16384).toString('utf8')) } catch { /* 没有 script.rpy */ }
  if (!declared && !marker) return null
  const config = {
    scriptRoots: [{ id: 'scripts', dir: hit, label: '日文' }],
    resourceRoots: [gameRel],
    namesFiles: [],
    thumbsDirs: [],
    scriptExtensions: ['rpy'],
    hiddenDirs: [],
    labels: {},
    merge: [],
    // scene_<1 位类别><6 位角色编号><2 位序号>：同一个角色的归成一张卡片；主线 / 活动（scene_2100002、scene_ev059_00_02）不匹配，照常列出
    groups: [{ parent: '.', pattern: '^scene_\\d(\\d{6})\\d{2}$' }],
    dirThumbs: [],
    scriptThumbs: [],
    adapterOptions: { 'renpy-minashigo': { aliasFiles: [join(gameRel, 'movie.rpy')], standFiles: [join(gameRel, 'script.rpy')], imageDirs: [join(gameRel, 'images')] } },
  }
  logs.push(`minashigo 游戏根：${gameRel || '.'}；脚本 ${hit}${marker ? '' : '（没有认出 script.rpy 里的 DynamicCharacter("name")）'}`)
  logs.push('按角色编号分组（scene_<类别><6 位角色><序号>）；立绘定义读 game/script.rpy；路径不对用 overrides 覆盖 adapterOptions / resourceRoots')
  return {
    id: 'minashigo',
    kind: 'minashigo',
    note: '',
    config,
    async finish(m, _config, options) {
      const count = await countFiles(path.join(m, ...splitRel(hit)), '.rpy', options.countCap, 3)
      logs.push(`脚本 ${count} 个${count ? '' : '——结构可能不对，可以用 overrides 覆盖 scriptRoots'}`)
      return { count, cover: '' }
    },
  }
}

async function detectTenkeiprdx(media, { declared, logs }) {
  const root = await findTenkeiRoot(media, 6)
  if (root === null) {
    if (declared) logs.push('没找到 scenes/ 加 Backgrounds|Spines|Stills|Masterdata')
    return null
  }
  const abs = (...rels) => path.join(media, ...splitRel(join(root, ...rels)))
  logs.push(`tenkeiprdx 素材根：${root || '.'}${root ? '（目录里多了一层）' : ''}`)
  const config = {
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
    adapterOptions: { 'tenkeiprdx-json': { root } },
  }
  // 列表（活动 / 附加 / 角色 / 全部剧情）由适配器每次从数据文件现读（EpisodeThumbnails、CharacterIcons、Masterdata、scenes/），这里不写列表
  let cover = ''
  for (const dirName of ['event', 'extra']) {
    const dir = join('EpisodeThumbnails', dirName)
    const thumbs = (await listNames(abs(dir))).filter((name) => /^ep_eventstill_([^_]+)_([^_]+)/.test(name))
    logs.push(thumbs.length ? `缩略图 ${dir}：${thumbs.length} 个` : `没有 ${dir}/ep_eventstill_*：这一类剧情没有缩略图`)
    if (!cover && thumbs.length) cover = `${dir}/${thumbs[thumbs.length - 1]}`
  }
  for (const name of ['CharacterIcons', 'Masterdata']) logs.push((await isDir(abs(name))) ? `${name}/ 在：角色列表${name === 'Masterdata' ? '的名字、标题、EX 剧情' : '的头像'}可用` : `提示：没有 ${name}/（角色列表会缺${name === 'Masterdata' ? '名字和 EX 剧情' : '头像'}）`)
  for (const missing of ['Backgrounds', 'Spines', 'Stills', 'BGM', 'AdventureVoice']) {
    if (!(await isDir(abs(missing)))) logs.push(`提示：没有 ${missing}/（用到它的剧情会缺资源）`)
  }
  return {
    id: 'tenkeiprdx',
    kind: 'tenkeiprdx',
    note: '',
    config,
    async finish(m, _config, options) {
      const count = await countFiles(abs('scenes'), '.json', options.countCap, 4)
      logs.push(`剧情 JSON ${count} 个${count ? '' : '——结构可能不对，可以用 overrides 覆盖 scriptRoots'}`)
      return { count, cover }
    },
  }
}

// 广度优先找「有 scenes/，并且同级有 Backgrounds|Spines|Stills|Masterdata」的目录；返回相对 media 的路径（'' = media 本身），没有返回 null
async function findTenkeiRoot(media, maxDepth) {
  const queue = [{ rel: '', depth: 0 }]
  while (queue.length) {
    const { rel, depth } = queue.shift()
    let entries
    try { entries = await readdir(path.join(media, ...splitRel(rel)), { withFileTypes: true }) } catch { continue }
    const dirs = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    if (dirs.has('scenes') && TENKEI_SIBLINGS.some((name) => dirs.has(name))) return rel
    if (depth >= maxDepth) continue
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) queue.push({ rel: join(rel, entry.name), depth: depth + 1 })
    }
  }
  return null
}

// ======================================================================
// UViewer（txt 脚本）和通用布局
// ======================================================================
const UV_EXT = 'txt'

async function detectUviewerGame(media, { declared, logs }) {
  const found = (await detectUviewer(media)) || (await searchUviewer(media))
  if (!found && declared) logs.push('没找到 download/adv/text')
  return found
}

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
  return uviewerConfig(media, prefix, resourceRoot, prefix ? '在子目录里找到' : '')
}

// 路径多了一层（用户传的是外面的目录）：往下找 download/adv/text
async function searchUviewer(media) {
  const hit = await findDir(media, ['download', 'adv', 'text'], 6)
  if (!hit) return null
  // hit = 相对媒体目录的路径，形如 a/b/resources/download/adv/text → 资源根 = a/b/resources
  const parts = hit.split('/')
  const resourceRoot = parts.slice(0, -3).join('/')
  const prefix = parts.slice(0, -4).join('/')   // 资源根的上一层（user_data 通常在那里）
  return uviewerConfig(media, prefix, resourceRoot.slice(prefix ? prefix.length + 1 : 0), `目录里多了一层「${prefix || '.'}」`)
}

async function uviewerConfig(media, prefix, resourceRootRel, note) {
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
    id: 'uviewer',
    kind: 'uviewer',
    note,
    config: {
      scriptRoots: roots,
      resourceRoots: [resourceRoot],
      namesFiles: [join(prefix, 'user_data/character_names.json')],
      thumbsDirs: [join(prefix, 'user_data/thumbnails')],
    },
    finish: uviewerFinish,
  }
}

// 认不出的目录：整个目录当脚本根，脚本里的路径按媒体目录解析（再试一次去掉 download/ 前缀）；不认领（不写 game.id）
function genericLayout() {
  return {
    id: '',
    kind: '通用',
    note: '没有认出已知布局：整个目录当脚本根',
    config: { scriptRoots: [{ id: '', dir: '', label: '' }], resourceRoots: [''], stripPrefixes: ['download/'], namesFiles: [], thumbsDirs: [], labels: {}, merge: [], dirThumbs: [], scriptThumbs: [] },
    finish: uviewerFinish,
  }
}

async function uviewerFinish(media, config, options, logs) {
  const scriptRoot = (config.scriptRoots || [])[0]
  const rootAbs = scriptRoot ? path.join(media, ...splitRel(scriptRoot.dir)) : media
  const walked = await walkScripts(rootAbs, options.countCap)
  logs.push(`脚本根「${scriptRoot?.dir || '.'}」下有 ${walked.count} 个 .${UV_EXT} 文件${walked.capped ? '（达到上限）' : ''}`)
  if (!walked.count) logs.push('警告：脚本根下一个脚本都没有——目录结构可能不对，可以用 overrides 覆盖 scriptRoots')
  const cover = await pickCover(media, config, walked.files.slice(0, options.coverScanLimit))
  if (!cover) logs.push('（脚本里没有存在的背景图，也没有缩略图缓存）')
  return { count: walked.count, cover }
}

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
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(`.${UV_EXT}`)) { count++; if (files.length < 400) files.push(full) }
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

// 探测顺序：monmusu → tenkeiprdx → minashigo → uviewer（没填 game.id 时按这个顺序认领）
const GAMES = [
  { id: 'monmusu', detect: detectMonmusu },
  { id: 'tenkeiprdx', detect: detectTenkeiprdx },
  { id: 'minashigo', detect: detectMinashigo },
  { id: 'uviewer', detect: detectUviewerGame },
]

// ======================================================================
// 小工具
// ======================================================================
async function isDir(p) { try { return (await stat(p)).isDirectory() } catch { return false } }
async function isFile(p) { try { return (await stat(p)).isFile() } catch { return false } }
const splitRel = (rel) => String(rel || '').split('/').filter(Boolean)
const join = (...parts) => parts.filter(Boolean).join('/')
const sortName = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
function cleanRel(value) {
  const rel = String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  if (!rel) return ''
  return rel.split('/').some((part) => !SAFE_SEGMENT.test(part) || part === '.' || part === '..') ? '' : rel
}

async function listNames(dirAbs) {
  try { return (await readdir(dirAbs)).filter((name) => !name.startsWith('.')).sort(sortName) } catch { return [] }
}

async function countFiles(rootAbs, ext, cap, maxDepth) {
  let count = 0
  async function walk(dir, depth) {
    if (depth > maxDepth || count >= cap) return
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

// 目录下（递归，按名字排序）第一个匹配 re 的文件：返回 { dir（相对 rootAbs）, file, ext }
async function findFirstFile(rootAbs, re, cap) {
  let seen = 0
  async function walk(rel, depth) {
    if (depth > 6 || seen >= cap) return null
    let entries
    try { entries = (await readdir(path.join(rootAbs, ...splitRel(rel)), { withFileTypes: true })).sort(sortName2) } catch { return null }
    for (const entry of entries) {
      seen++
      if (entry.isFile()) {
        const m = re.exec(entry.name)
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
const sortName2 = (a, b) => sortName(a.name, b.name)

// 在 rootAbs 下（深度 ≤ 4）扫文件名，返回每个正则各自命中的目录（相对 rootAbs，根 = ''）。最多看 cap 个条目
async function findDirsWithFiles(rootAbs, regexes, cap) {
  const hits = regexes.map(() => new Set())
  let seen = 0
  async function walk(rel, depth) {
    if (depth > 4 || seen >= cap) return
    let entries
    try { entries = await readdir(path.join(rootAbs, ...splitRel(rel)), { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (++seen > cap) return
      if (entry.isFile()) regexes.forEach((re, i) => { if (re.test(entry.name)) hits[i].add(rel) })
      else if (entry.isDirectory() && !entry.name.startsWith('.') && SAFE_SEGMENT.test(entry.name)) await walk(join(rel, entry.name), depth + 1)
    }
  }
  await walk('', 0)
  return hits.map((set) => [...set].sort())
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
    rawIgnore: (Array.isArray(raw.rawIgnore) ? raw.rawIgnore : []).map((p) => String(p ?? '').trim()).filter((p) => { if (!p) return false; try { new RegExp(p, 'i'); return true } catch { return false } }).slice(0, 50),
    overrides: (Array.isArray(raw.overrides) ? raw.overrides : []).filter((r) => r && typeof r === 'object' && typeof r.path === 'string'),
  }
}

// dryRun / 目录不可读 / 跳过时：服务端会先删掉本脚本上次生成的 tag 再写这次返回的，所以把现有的本脚本 tag 原样回传，保证什么都不变
function keepOwn(ctx, logs) {
  const own = (Array.isArray(ctx.item?.tags) ? ctx.item.tags : [])
    .map((tag) => (typeof tag === 'string' ? tag : String(tag?.name ?? tag?.tag ?? '')).trim())
    .filter((tag) => TAG_GROUPS.includes(tag.slice(0, Math.max(0, tag.indexOf(':'))).trim()))
  return { itemTags: own, unitTags: [], unitPatches: [], logs }
}
