// 适配器：GrenzeViewer（Grenze）的对话 XML（TextAsset/easy_dialog-N.xml）→ 规范场景（gal-scene/1）。只做静态立绘（整张 body 图），Spine 动画不在这里。
// 一份文件（1~10MB、最多约 5 万行）里装着几百个场景，所以：
//   · 行是 <easy_dialog-N id="" next_id="" name="" text="" …/>，用正则逐行扫（不建 DOM）；流程 = next_id 串成的链表（没有 next_id 的行 = 一条链的末尾）
//   · 场景 = 一条链：没有任何行指向它的行是起点；脚本路径带场景号 `TextAsset/easy_dialog-1.xml::<起点行 id>`（`::` 之后的部分引擎会拆出来放进 meta.scene，打开的还是那个文件）
//   · 列表（catalog）= 每个文件一个目录（easy_dialog-N），里面是它的场景（起点 id + 句数 + 说话人 + 首句）；文件在 prepare 里读一次，按 文件 mtime+size 缓存扫描结果
//   · 链可能在中间汇合（几行的 next_id 相同）：每个场景各自沿 next_id 走到底（共用的后半段在每个场景里都有）；有环 / 指向不存在的 id 就在那里结束；没人指向的环也算一个场景（从文件里最靠前的行起）
// 行的属性（文件 1 里的出现次数见 README）：
//   name（'-' 或没有 = 旁白）、text（XML 转义：&#xA; 换行、&amp; …；《俺》这类心声记号原样保留）
//   hero_group_id + pic_pos（1/2/3 = 左/中/右）→ stand（merc/pic/<hero_group_id>/body.webp|png 一整张）；pic_face 是头像图标的序号，不是表情叠层，不用
//     没有 hero_group_id 的行（旁白 / 只放指令）沿用上一个立绘，直到换了 hero_group_id / pic_pos、或换背景（background）才清掉；一次只显示一个立绘；找不到 body 图的 hero 记 unresolved 并清掉立绘
//   background → bg（bg/battlebg/<名>/<名>.webp；名字查文件名索引，找不到记 unresolved；bg_b 找不到文件时当黑底——没有对照样本，推测）
//   bgm（non = 停）→ bgm / bgmStop；sound1..3、bg_sound1..3 → se（一次性；bg_sound 是不是循环没有对照样本，按一次性放；non = 无）；voice_pack + voice → voice
//   screen_effect / pic_action / pic_action_val / pic_size / effect + effect_pos / back_voice：含义未知 → raw {cmd, args}，记在 stats.raw
// 资源（相对资源根 assets/resources/patchres/）：bg/battlebg/<名>/<名>.webp、bgm/<名小写>/<名>.m4a、sound/<名>/<名>.m4a、voice/<包小写>/<语音名>.m4a、merc/pic/<id>/body.webp|png；
//   全部按「文件名（无扩展名，小写）」查索引（contextDirs 的目录递归列出来），不写死目录层级；merc/pic 下的 N.webp / <id>.webp 是头像图标 / 图集，不是立绘
// 资源目录来自 config.adapterOptions['grenze-xml']：{ root（游戏根，相对媒体目录，默认 ''）, textDir（默认 <root>/TextAsset）, resourceDir（默认 <root>/assets/resources/patchres）}

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { decodeTextFile } from '../../text-decode.mjs'

export const ADAPTER_ID = 'grenze-xml'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const cleanDir = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
const rootOf = (options) => cleanDir(options?.root)
const textDirOf = (options) => cleanDir(options?.textDir) || joinPath(rootOf(options), 'TextAsset')
const resourceDirOf = (options) => cleanDir(options?.resourceDir) || joinPath(rootOf(options), 'assets/resources/patchres')
const RESOURCE_SUBDIRS = ['bg', 'bgm', 'sound', 'voice', 'merc/pic']

export function sniff(text) {
  return /<easy_dialog-\d+(?:\s[^>]*)?\sid\s*=\s*"/.test(String(text || '').slice(0, 8192))
}

// ---------- XML 行 ----------
const ROW_RE = /<easy_dialog-\d+((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g
const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function unescapeXml(value) {
  const s = String(value ?? '')
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity.toLowerCase()] ?? whole
  })
}

// 文本 → 行数组：每行 = 属性对象（值是没有解转义的原文，text / name 用到时再 unescapeXml）
export function readRows(text) {
  const rows = []
  const source = String(text || '')
  ROW_RE.lastIndex = 0
  let m
  while ((m = ROW_RE.exec(source))) {
    const row = {}
    ATTR_RE.lastIndex = 0
    let a
    const attrs = m[1]
    while ((a = ATTR_RE.exec(attrs))) row[a[1]] = a[2] ?? a[3]
    rows.push(row)
  }
  return rows
}

const MAX_CHAIN_ROWS = 200000
// 行数组 → 场景（链）：{ start: 起点行 id, rows: [行下标…] }；forks = 有几行指向同一个 id（汇合点）的个数
export function splitScenes(rows) {
  const indexOf = new Map()
  rows.forEach((row, i) => { if (row.id !== undefined && !indexOf.has(row.id)) indexOf.set(row.id, i) })
  const incoming = new Set()
  let merges = 0
  const pointed = new Map()
  for (const [i, row] of rows.entries()) {
    const next = row.next_id
    if (next === undefined || next === '' || !indexOf.has(next) || indexOf.get(next) === i) continue
    incoming.add(next)
    pointed.set(next, (pointed.get(next) || 0) + 1)
  }
  for (const n of pointed.values()) if (n > 1) merges += 1
  const walk = (from) => {
    const chain = []
    const seen = new Set()
    let i = from
    while (i !== undefined && !seen.has(i) && chain.length < MAX_CHAIN_ROWS) {
      seen.add(i)
      chain.push(i)
      const next = rows[i].next_id
      i = next === undefined || next === '' ? undefined : indexOf.get(next)
    }
    return chain
  }
  const scenes = []
  const claimed = new Uint8Array(rows.length)
  const take = (i) => {
    const chain = walk(i)
    for (const r of chain) claimed[r] = 1
    scenes.push({ start: rows[i].id, rows: chain })
  }
  for (const [i, row] of rows.entries()) {
    if (row.id === undefined || indexOf.get(row.id) !== i || incoming.has(row.id)) continue
    take(i)
  }
  let cycles = 0
  for (const [i, row] of rows.entries()) {   // 没人指向的环（和环尾巴）：没被任何起点走到的行，从最靠前的开始
    if (claimed[i] || row.id === undefined || indexOf.get(row.id) !== i) continue
    take(i)
    cycles += 1
  }
  return { scenes, indexOf, stats: { rows: rows.length, merges, cycles, duplicateIds: rows.filter((row, i) => row.id !== undefined && indexOf.get(row.id) !== i).length } }
}

// ---------- 上下文：场景索引 + 资源文件名索引 ----------
export const contextFiles = () => []
export const contextDirs = (options) => [textDirOf(options), ...RESOURCE_SUBDIRS.map((dir) => joinPath(resourceDirOf(options), dir))]
export const contextWalkLimit = 2000000   // voice 一个目录就十万级文件，索引绝不能被默认的 40 万上限悄悄截断

const AUDIO = /\.(?:m4a|mp3|ogg|wav)$/i
const IMAGE_RANK = { webp: 0, png: 1, jpg: 2, jpeg: 2 }
const SCENE_CACHE_MAX = 200
const sceneCache = new Map()   // 绝对路径|mtime|size → { scenes, stats }（一个文件的场景列表；文件没变就不再扫描）
const stripMarks = (text) => String(text).replace(/\s+/g, ' ').trim()

// 一个文件 → 场景列表（给列表用：起点 id、行数、句数、前几个说话人、首句）
function summarize(rows) {
  const { scenes, stats } = splitScenes(rows)
  const out = scenes.map((scene) => {
    const names = []
    let lines = 0
    let excerpt = ''
    for (const i of scene.rows) {
      const row = rows[i]
      if (row.text === undefined || row.text === '') continue
      lines += 1
      const name = unescapeXml(row.name ?? '')
      if (name && name !== '-' && names.length < 3 && !names.includes(name)) names.push(name)
      if (!excerpt) excerpt = stripMarks(unescapeXml(row.text)).slice(0, 24)
    }
    return { start: scene.start, rows: scene.rows.length, lines, names, excerpt }
  })
  return { scenes: out, stats }
}

async function scenesOfFile(abs) {
  let info
  try { info = await stat(abs) } catch { return null }
  const key = `${abs}|${info.mtimeMs}|${info.size}`
  const hit = sceneCache.get(key)
  if (hit) return hit
  let text
  try { text = decodeTextFile(await readFile(abs)).text } catch { return null }
  const summary = summarize(readRows(text))
  if (sceneCache.size >= SCENE_CACHE_MAX) sceneCache.delete(sceneCache.keys().next().value)
  sceneCache.set(key, summary)
  return summary
}

export async function prepare({ options, files, toResourcePath, truncated, mediaDir }) {
  const toRes = toResourcePath || ((rel) => rel)
  const textDir = textDirOf(options)
  const resourceDir = resourceDirOf(options)
  const bg = new Map()        // 文件名（无扩展名，小写）→ 资源路径（webp > png > jpg）
  const bgm = new Map()
  const sound = new Map()
  const voices = new Map()    // <上一级目录小写>/<文件名小写> → 资源路径
  const voiceByName = new Map()   // 文件名小写 → 资源路径（只收唯一的；撞名的记 null，不乱猜）
  const stands = new Map()    // hero_group_id → 资源路径（merc/pic/<id>/body.webp|png）
  const ranks = new Map([bg, bgm, sound, stands].map((map) => [map, new Map()]))   // 同名的图选 webp > png > jpg
  const put = (map, key, res, rel) => {
    const r = IMAGE_RANK[/\.([^./]+)$/.exec(rel)?.[1]?.toLowerCase()] ?? 3
    const rank = ranks.get(map)
    if (!map.has(key) || r < rank.get(key)) { map.set(key, res); rank.set(key, r) }
  }
  const dialogFiles = []
  for (const rel of files || []) {
    const inText = rel.startsWith(`${textDir}/`) ? rel.slice(textDir.length + 1) : ''
    if (inText) {
      const m = /^easy_dialog-(\d+)\.xml$/i.exec(inText)
      if (m) dialogFiles.push({ rel, n: Number(m[1]), name: inText })
      continue
    }
    if (!rel.startsWith(`${resourceDir}/`)) continue
    const sub = rel.slice(resourceDir.length + 1)
    const parts = sub.split('/')
    const file = parts[parts.length - 1]
    const stem = file.replace(/\.[^./]+$/, '').toLowerCase()
    const res = toRes(rel)
    switch (parts[0]) {
      case 'bg': if (IMAGE_RANK[/\.([^./]+)$/.exec(file)?.[1]?.toLowerCase()] !== undefined) put(bg, stem, res, file); break
      case 'bgm': if (AUDIO.test(file)) put(bgm, stem, res, file); break
      case 'sound': if (AUDIO.test(file)) put(sound, stem, res, file); break
      case 'voice':
        if (AUDIO.test(file) && parts.length >= 3) {
          voices.set(`${parts[parts.length - 2].toLowerCase()}/${stem}`, res)
          voiceByName.set(stem, voiceByName.has(stem) ? null : res)
        }
        break
      case 'merc': {
        const m = /^merc\/pic\/([^/]+)\/body\.(webp|png)$/i.exec(sub)
        if (m) put(stands, m[1], res, file)
        break
      }
      default:
    }
  }
  dialogFiles.sort((a, b) => a.n - b.n)
  const catalogFiles = []
  for (const file of dialogFiles) {
    const got = mediaDir ? await scenesOfFile(path.join(mediaDir, ...file.rel.split('/'))) : null
    if (got?.scenes.length) catalogFiles.push({ ...file, ...got })
  }
  const ctx = { bg, bgm, sound, voices, voiceByName, stands, hasIndex: Boolean(files?.length), truncated: Boolean(truncated), resourceDir }
  ctx.catalogTree = buildCatalog(catalogFiles)
  return ctx
}

function buildCatalog(catalogFiles) {
  if (!catalogFiles.length) return null
  return {
    children: catalogFiles.map((file) => {
      const id = `f${file.n}`
      return {
        id,
        title: `easy_dialog-${file.n}`,
        subtitle: `${file.scenes.length} 个场景`,
        children: file.scenes.map((scene) => ({
          id: `${id}/${scene.start}`,
          title: scene.start,
          subtitle: [`${scene.lines} 句`, scene.names.join('、'), scene.excerpt].filter(Boolean).join(' · '),
          script: `${file.rel}::${scene.start}`,
        })),
      }
    }),
  }
}

export const catalog = (ctx) => ctx?.catalogTree || null

// ---------- 解析 ----------
const POS = { 1: 'left', 2: 'center', 3: 'right' }
const NON = (value) => String(value ?? '').trim().toLowerCase() === 'non'
const RAW_KEYS = ['screen_effect', 'pic_action', 'pic_action_val', 'pic_size', 'back_voice']

export function parse(text, ctx = null, meta = {}) {
  const rows = readRows(text)
  if (!rows.length) throw new Error('找不到 easy_dialog 行（不是 Grenze 的对话 XML）')
  const { scenes, indexOf, stats: graph } = splitScenes(rows)
  const want = meta?.scene !== undefined && meta?.scene !== '' ? String(meta.scene) : ''
  let chain
  let start
  if (want) {
    if (!indexOf.has(want)) throw Object.assign(new Error(`文件里没有场景 ${want}（起点行 id 不存在）`), { statusCode: 404 })
    start = want
    chain = []
    const seen = new Set()
    for (let i = indexOf.get(want); i !== undefined && !seen.has(i) && chain.length < MAX_CHAIN_ROWS; ) {
      seen.add(i)
      chain.push(i)
      const next = rows[i].next_id
      i = next === undefined || next === '' ? undefined : indexOf.get(next)
    }
  } else {   // 没指定场景（直接打开整份文件）：播第一个场景
    start = scenes[0]?.start ?? rows[0].id
    chain = scenes[0]?.rows || [0]
  }
  const stats = { rows: chain.length, scene: start, scenes: scenes.length, commands: 0, raw: {}, unresolved: {}, stands: 0, ...(ctx?.truncated ? { indexTruncated: true } : {}), ...(graph.merges ? { merges: graph.merges } : {}), ...(graph.cycles ? { cycles: graph.cycles } : {}) }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const indexed = Boolean(ctx?.hasIndex)
  const lower = (value) => String(value).trim().toLowerCase()

  // 名字 → 资源路径：有索引就查索引（找不到 = ''），没有索引就按约定的路径猜
  const bgOf = (name) => (indexed ? ctx.bg.get(lower(name)) || '' : `bg/battlebg/${name}/${name}.webp`)
  const bgmOf = (name) => (indexed ? ctx.bgm.get(lower(name)) || '' : `bgm/${lower(name)}/${name}.m4a`)
  const soundOf = (name) => (indexed ? ctx.sound.get(lower(name)) || '' : `sound/${name}/${name}.m4a`)
  const voiceOf = (pack, name) => {
    if (!indexed) return `voice/${lower(pack)}/${name}.m4a`
    return ctx.voices.get(`${lower(pack)}/${lower(name)}`) || ctx.voiceByName.get(lower(name)) || ''
  }
  const standOf = (id) => (indexed ? ctx.stands.get(String(id).trim()) || '' : `merc/pic/${String(id).trim()}/body.webp`)

  const steps = []
  let commands = []
  let speaker = null
  let curBgm = ''
  let pack = ''
  let stand = ''        // 当前立绘的 hero_group_id|pic_pos（空 = 没有）
  const emit = (command) => commands.push(command)
  const standOff = () => { if (stand) { emit({ op: 'standOff' }); stand = '' } }

  for (const i of chain) {
    const row = rows[i]
    // --- 背景（换背景 = 换场景，立绘清掉）---
    if (row.background !== undefined && row.background !== '' && !NON(row.background)) {
      const src = bgOf(row.background)
      standOff()
      if (src) emit({ op: 'bg', src, fade: 0 })
      else if (lower(row.background) === 'bg_b') emit({ op: 'bg', color: [0, 0, 0], fade: 0 })
      else count('unresolved', `bg:${row.background}`)
    }
    // --- BGM（non = 停）---
    if (row.bgm !== undefined && row.bgm !== '') {
      if (NON(row.bgm)) { if (curBgm) emit({ op: 'bgmStop', fade: 0 }); curBgm = '' } else if (row.bgm !== curBgm) {
        const src = bgmOf(row.bgm)
        if (src) { emit({ op: 'bgm', src }); curBgm = row.bgm } else count('unresolved', `bgm:${row.bgm}`)
      }
    }
    // --- 音效（non = 无）---
    for (const key of ['bg_sound1', 'bg_sound2', 'bg_sound3', 'sound1', 'sound2', 'sound3']) {
      const name = row[key]
      if (name === undefined || name === '' || NON(name)) continue
      const src = soundOf(name)
      if (src) emit({ op: 'se', src }); else count('unresolved', `sound:${name}`)
    }
    // --- 立绘（没有 hero_group_id 的行沿用上一个）---
    if (row.voice_pack !== undefined && row.voice_pack !== '') pack = row.voice_pack
    if (row.hero_group_id !== undefined && row.hero_group_id !== '') {
      const align = POS[Number(row.pic_pos)] || 'center'
      const key = `${String(row.hero_group_id).trim()}|${align}`
      if (key !== stand) {
        const src = standOf(row.hero_group_id)
        if (src) { emit({ op: 'stand', parts: [{ src, align, fit: 1 }] }); stand = key; stats.stands += 1 } else { count('unresolved', `stand:${row.hero_group_id}`); standOff() }
      }
    }
    // --- 语音 ---
    if (row.voice !== undefined && row.voice !== '' && !NON(row.voice)) {
      const src = voiceOf(row.voice_pack || pack, row.voice)
      if (src) emit({ op: 'voice', src }); else count('unresolved', `voice:${row.voice_pack || pack}/${row.voice}`)
    }
    // --- 含义未知的：raw ---
    for (const key of RAW_KEYS) if (row[key] !== undefined && row[key] !== '') { emit({ op: 'raw', cmd: key, args: [row[key]] }); count('raw', key) }
    if (row.effect !== undefined && row.effect !== '') { emit({ op: 'raw', cmd: 'effect', args: [row.effect, row.effect_pos ?? ''] }); count('raw', 'effect') }

    // --- 台词：没有 text 的行只放指令（并进下一句）---
    if (row.text === undefined || row.text === '') continue
    const name = unescapeXml(row.name ?? '')
    const who = name === '-' ? '' : name
    if (who !== speaker) { emit({ op: 'speaker', segments: who ? [{ text: who }] : [] }); speaker = who }
    const body = unescapeXml(row.text)
    emit({ op: 'text', segments: body ? [{ text: body }] : [] })
    stats.commands += commands.length
    steps.push({ index: steps.length, commands })
    commands = []
  }
  if (commands.length) {
    stats.commands += commands.length
    if (steps.length) steps[steps.length - 1].commands.push(...commands)
    else steps.push({ index: 0, commands: [...commands, { op: 'text', segments: [] }] })
  }
  return { steps, stats }
}

export const grenzeXmlAdapter = { id: ADAPTER_ID, label: 'Grenze（GrenzeViewer）对话 XML', sceneInPath: true, sniff, parse, contextFiles, contextDirs, contextWalkLimit, prepare, catalog }
