// 适配器：Utage（Unity 剧情引擎）的 *.book.json（Twinkle Star Knights X）→ 规范场景（gal-scene/1）。
// 输入：Unity 导出的 Utage 工作簿 { importGridList: [{ name, headerRow, rows: [{ rowIndex, strings: [格…], isEmpty, isCommentOut }] }], _tsk_zh }，
// 一个 grid = 一张剧情表（一个章节）；配套的 Master.chapter.json（settingList：…:Character / :Texture / :Sound 三张名称表）给角色 / 背景 / 声音的别名查文件。
// 列（按表头行的列名找，表头没有就按这个顺序）：Command Arg1 Arg2 Arg3 Arg4 Arg5 Arg6 Skin SpineAnim SpineSubAnim AnimCompType AnimSpd WaitType Text PageCtrl Voice WindowType
// 一个 book.json = 一个场景：所有 grid 按顺序接起来（脚本节点是文件路径，播放页里没法再指到某个 grid），每个 grid 开头清掉立绘 / 静态画面 / 背景人声 / 背景音效（Utage 里它们是各自独立启动的剧情）。
// 行的种类：
//   Command 为空 + 有 Text   台词：Arg1 = 角色名（Master Character 的 CharacterName；显示名取 NameText，没有就取名字里最后一个 '-' 之前的部分）；没有 Arg1 = 旁白。
//                            Arg2 = <Off>：只出名字和台词，不（重新）显示立绘；Arg2 = <Character=名字>：说话人显示成这个名字（立绘仍按 Arg1）；有 Arg3（Chara1|2|3）就同时摆立绘。
//   Command 为空 + 没有 Text  立绘行：Arg1 角色名、Arg3 站位槽、Arg4 横向偏移（像素，0 = 居中，正 = 右）、Arg6 淡入秒、Skin 表情（face1…）、SpineAnim 动画（wait）、SpineSubAnim 副动画
//   *标签                    Utage 的标签行（Selection / Jump 的目标）
//   Bg / BgOff · BgEvent / BgEventOff（静态画面 = Stills/<id>/ 的 Spine，动画名 cut_N，_loop 结尾循环）· Bgm（Master Sound 的 intro + loop 两个文件，播放器的 bgm 指令不能接续，只放 loop）/ StopBgm
//   Se / BgSe / StopBgSe · BgVoice / StopBgVoice · 台词的 Voice（按文件名在 Sound/Voice、Sound/BgVoice 的索引里找，不推角色目录）
//   Wait → wait · FadeOut / FadeIn → fade · Tween（MoveBy / PunchPosition / ShakePosition 折成立绘动作，MoveTo 改横向位置）· Shake（Graphics = 整屏抖动，角色 = 立绘动作）· ZoomCamera → camera
//   CharacterOff → spineOff · HideMessageWindow / ShowMessageWindow → ui · Selection / Jump / EndScenario（见下）
//   其余（Sprite / SpriteOff / Param / ChangeSoundVolume / ImageEffectOff / StopSe …）记成 raw，写进 stats.raw；WaitCustom / WaitInput 不处理（没有对应的画面效果）。不认识的命令同样 raw，不会崩。
// 分支（Selection / 标签 / Jump）：Selection 的 Arg1 是跳转标签（*S-<剧情>-<序号>），Text 是选项文字。标签前缀相同（去掉末尾 -数字）的 Selection 算一组：
//   在这一组第一个 Selection 的位置弹一次选项（选的序号 = 这一组里出现的顺序，记进 sel<n>）；每个选项的分支 = 从它的标签行到下一个 Selection / 同组标签 / 别的标签 / Jump / EndScenario，
//   分支里每条指令带 when（选了才执行），分支结束后汇合（不再带条件）。每个分支从选项出现时的立绘状态重新开始。
//   Jump（没有 Arg2）：向后跳到后面的标签 → 中间的行不会走到（丢掉），到那个标签恢复；跳回前面的标签（循环）没法表示，当作这一段结束。带 Arg2 条件（flag）的 Jump 没有运行时变量可判断，记 raw 并当作没跳。
//   EndScenario：到下一个标签之前的行不会走到；分支的最后一个分支没有任何结束标记（碰到 grid 末尾）就不加条件（宁可多放一段，也别把后面的剧情藏掉）。这些都是照数据推的，没有真机对照。
// 立绘 / 画面（没有真机对照，位置全是推的）：站位槽 → spine 指令的 slot（Chara1…）、kind chara；x = 0.5 + 偏移 / 屏宽（adapterOptions.screenWidth，默认 1280）；Skin / SpineSubAnim 带在指令的 skin / sub 字段里，播放器暂时不认。
//   角色骨架 = Master Character 的 FileName 去掉 _SkeletonData.asset（Characters/ch_1001001/ch_1001001_m0 → .skel.bytes / .atlas.txt）。
// 资源目录来自 config.adapterOptions['utage-book']：{ root（StreamingAssets/<游戏名> 目录，相对媒体目录，默认 ''）, screenWidth（Arg4 偏移的参照屏宽，默认 1280） }
// 列表（adapter.catalog）：Adventure/ 下每个剧情文件夹（MainScenario / CharaScenario …）→ 剧情文件（一个文件 = 一个场景）+ 全部剧情；每次从文件索引现读。
import { parseRichText } from './uviewer-csv.mjs'

export const ADAPTER_ID = 'utage-book'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => String(options?.root || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
const DEFAULT_SCREEN_WIDTH = 1280
const COLUMNS = ['Command', 'Arg1', 'Arg2', 'Arg3', 'Arg4', 'Arg5', 'Arg6', 'Skin', 'SpineAnim', 'SpineSubAnim', 'AnimCompType', 'AnimSpd', 'WaitType', 'Text', 'PageCtrl', 'Voice', 'WindowType']
// 文件夹 → 中文名（猜的，卡片副标题里同时写着文件夹名）
const CATEGORY_LABELS = { MainScenario: '主线', CharaScenario: '角色剧情', StoryEventScenario: '活动剧情', BossrushEventScenario: 'Bossrush 活动', HomeEventScenario: '家园事件', ItemEventScenario: '道具事件', SpEventScenario: '特别活动', SubjugationEventScenario: '讨伐活动' }
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS)

// 头 8KB 里要有 importGridList 和表头行的 Command / Arg1（Master.chapter.json 是 settingList，没有 importGridList，不会被认走）
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 8192)
  return /"importGridList"\s*:/.test(head) && /"Command"/.test(head) && /"Arg1"/.test(head)
}

// ---------- 上下文：Master.chapter.json + 资源目录索引 ----------
export const contextFiles = (options) => [joinPath(rootOf(options), 'Adventure', 'Master.chapter.json')]
export const contextDirs = (options) => ['Adventure', 'Characters', 'Stills', 'Sound'].map((dir) => joinPath(rootOf(options), dir))
export const contextWalkLimit = 800000   // 语音文件很多（Sound/Voice/ImportChara/<角色>/…），默认 40 万不一定够

const natAsc = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
const str = (value) => (value === null || value === undefined ? '' : String(value))
const numOrNull = (value) => { const text = str(value).trim(); if (!text) return null; const n = Number(text); return Number.isFinite(n) ? n : null }
const secOf = (value, fallback = 0) => { const n = numOrNull(value); return n !== null && n >= 0 ? Math.min(60, n) : fallback }
const withExt = (file, ext) => (/\.[A-Za-z0-9]{2,4}$/.test(file) ? file : `${file}.${ext}`)
const cleanPath = (value) => str(value).trim().replace(/\\/g, '/').replace(/^\/+/, '')

// 名称表的一行：strings 按列下标放（有的表第 0 列是空的，所以列名一律按表头行找）
function readTable(setting) {
  const rows = (Array.isArray(setting?.rows) ? setting.rows : []).filter((row) => row && Array.isArray(row.strings) && !row.isCommentOut && !row.isEmpty)
  const header = rows.find((row) => row.strings.some((cell) => str(cell).trim()))
  if (!header) return []
  const index = new Map()
  header.strings.forEach((cell, i) => { const name = str(cell).trim(); if (name && !index.has(name)) index.set(name, i) })
  return rows.slice(rows.indexOf(header) + 1).map((row) => {
    const get = (name) => (index.has(name) ? str(row.strings[index.get(name)]).trim() : '')
    return { get }
  })
}

export function readMaster(text) {
  const chars = new Map()    // CharacterName → { name, dir, base, type }
  const textures = new Map() // Label → { type, file }
  const sounds = new Map()   // Label → { type, intro, file }
  let data = null
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { /* 没有名称表：按没有处理 */ }
  for (const setting of Array.isArray(data?.settingList) ? data.settingList : []) {
    const kind = /:([A-Za-z]+)\s*$/.exec(str(setting?.name))?.[1]
    if (kind === 'Character') {
      for (const row of readTable(setting)) {
        const key = row.get('CharacterName')
        if (!key || chars.has(key)) continue
        const file = cleanPath(row.get('FileName')).replace(/\.asset$/i, '').replace(/_SkeletonData$/i, '')
        const at = file.lastIndexOf('/')
        chars.set(key, { name: row.get('NameText'), dir: at > 0 ? file.slice(0, at) : '', base: file.slice(at + 1), type: row.get('FileType') })
      }
    } else if (kind === 'Texture') {
      for (const row of readTable(setting)) { const label = row.get('Label'); if (label && !textures.has(label)) textures.set(label, { type: row.get('Type'), file: cleanPath(row.get('FileName')) }) }
    } else if (kind === 'Sound') {
      for (const row of readTable(setting)) { const label = row.get('Label'); if (label && !sounds.has(label)) sounds.set(label, { type: row.get('Type'), intro: cleanPath(row.get('IntroFileName')), file: cleanPath(row.get('FileName')) }) }
    }
  }
  return { chars, textures, sounds }
}

export function prepare({ options, texts, files, toResourcePath }) {
  const toRes = toResourcePath || ((rel) => rel)
  const lower = (map, res, key) => { map.set(String(key).toLowerCase(), res) }
  const books = []                // { rel, category, stem }
  const images = new Map()        // Adventure/ 下的图片：小写路径 → 路径
  const sounds = new Map()        // Sound/ 下除 Voice 外的 ogg：小写路径 → 路径
  const voices = new Map()        // 语音名（无扩展名）→ 路径（Sound/Voice 优先）
  const bgVoices = new Map()      // 背景语音名 → 路径（Sound/BgVoice 优先）
  const voiceOwned = new Set()    // 已经是优先目录里的文件的名字（后面的同名文件不再覆盖）
  const bgVoiceOwned = new Set()
  const skeletons = new Set()     // 'Characters/<目录>/<基名>'（有 .skel.bytes 的）
  const stills = new Map()        // 'Stills/<id>' → [基名…]
  for (const rel of files || []) {
    const res = toRes(rel)
    let m = /^Adventure\/(?:([^/]+)\/)?(?:.*\/)?([^/]+)\.book\.json$/i.exec(res)
    if (m) { books.push({ rel, category: m[1] || '', stem: `${m[2]}` }); continue }
    m = /^Characters\/([^/]+)\/(.+)\.skel\.bytes$/i.exec(res)
    if (m) { skeletons.add(`Characters/${m[1]}/${m[2]}`); continue }
    m = /^Stills\/([^/]+)\/(.+)\.skel\.bytes$/i.exec(res)
    if (m) { const key = `Stills/${m[1]}`; if (!stills.has(key)) stills.set(key, []); stills.get(key).push(m[2]); continue }
    m = /^Adventure\/.+\.(?:png|jpe?g)$/i.exec(res)
    if (m) { lower(images, res, res); continue }
    m = /^Sound\/(Voice|BgVoice)\/(?:.+\/)?([^/]+)\.ogg$/i.exec(res)
    if (m) {
      const isVoice = m[1].toLowerCase() === 'voice'
      // 台词语音：Sound/Voice 优先；背景语音：Sound/BgVoice 优先（同名文件两边都有）；同一类里先收到的为准
      const put = (map, owned, isPreferred, name) => { if (!map.has(name) || (isPreferred && !owned.has(name))) { map.set(name, res); if (isPreferred) owned.add(name) } }
      put(voices, voiceOwned, isVoice, m[2])
      put(bgVoices, bgVoiceOwned, !isVoice, m[2])
      continue
    }
    if (/^Sound\/.+\.ogg$/i.test(res)) lower(sounds, res, res)
  }
  for (const bases of stills.values()) bases.sort((a, b) => natAsc(a, b))
  const textOf = (name) => Object.entries(texts || {}).find(([key]) => key.endsWith(`/${name}`) || key === name)?.[1] || ''
  const master = readMaster(textOf('Master.chapter.json'))
  const ctx = { books, images, sounds, voices, bgVoices, skeletons, stills, master, hasIndex: Boolean(files?.length), screenWidth: Number(options?.screenWidth) > 0 ? Number(options.screenWidth) : DEFAULT_SCREEN_WIDTH }
  ctx.catalogTree = buildCatalog(ctx)
  return ctx
}

// ---------- 列表 ----------
function buildCatalog(ctx) {
  if (!ctx.books.length) return null
  const byCategory = new Map()
  for (const book of ctx.books) { if (!byCategory.has(book.category)) byCategory.set(book.category, []); byCategory.get(book.category).push(book) }
  const node = (prefix, book) => ({ id: `${prefix}/${book.stem}`, title: book.stem, subtitle: CATEGORY_LABELS[book.category] ? `${CATEGORY_LABELS[book.category]} · ${book.category}` : book.category, script: book.rel })
  const categories = [...byCategory].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a[0])
    const ib = CATEGORY_ORDER.indexOf(b[0])
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || natAsc(a[0], b[0])
  })
  const lists = categories.map(([category, list]) => ({
    id: `c/${category || '-'}`,
    title: CATEGORY_LABELS[category] || category || '其它',
    subtitle: `${category ? `${category} · ` : ''}${list.length} 个`,
    children: [...list].sort((a, b) => natAsc(a.stem, b.stem)).map((book) => node(`c/${category || '-'}`, book)),
  }))
  lists.push({ id: 'all', title: '全部剧情', children: [...ctx.books].sort((a, b) => natAsc(a.rel, b.rel)).map((book) => node('all', book)) })
  return { children: lists }
}
export const catalog = (ctx) => ctx?.catalogTree || null

// ---------- 解析 ----------
const bookRows = (grid) => {
  const columns = new Map(COLUMNS.map((name, i) => [name, i]))
  const rows = []
  for (const row of Array.isArray(grid?.rows) ? grid.rows : []) {
    if (!row || !Array.isArray(row.strings) || row.isEmpty || row.isCommentOut) continue
    const cell = (name) => str(row.strings[columns.get(name)]).trim()
    if (cell('Command') === 'Command' && cell('Arg1') === 'Arg1') {   // 表头行（每个 grid 开头 / 中途重复出现）：按它重排列
      row.strings.forEach((value, i) => { const name = str(value).trim(); if (COLUMNS.includes(name)) columns.set(name, i) })
      continue
    }
    const command = cell('Command')
    if (command.startsWith('//')) continue
    rows.push({
      command, a1: cell('Arg1'), a2: cell('Arg2'), a3: cell('Arg3'), a4: cell('Arg4'), a5: cell('Arg5'), a6: cell('Arg6'),
      skin: cell('Skin'), anim: cell('SpineAnim'), sub: cell('SpineSubAnim'), speed: cell('AnimSpd'),
      text: str(row.strings[columns.get('Text')]).replace(/\r/g, '').trim(), voice: cell('Voice'),
    })
  }
  return rows
}

// 'time=.3 y=-30' → { time: '.3', y: '-30' }
const keyValues = (text) => { const out = {}; for (const part of str(text).split(/\s+/)) { const m = /^([A-Za-z]+)=(.*)$/.exec(part); if (m) out[m[1].toLowerCase()] = m[2] } return out }
// Utage 的 <ruby=读音>字</ruby> → 通用富文本的 <ruby>字|读音</ruby>
const richText = (text) => parseRichText(str(text).replace(/<ruby=([^>]*)>(.*?)<\/ruby>/gs, (_all, reading, base) => `<ruby>${base}|${reading}</ruby>`))
const nameOfKey = (key) => key.replace(/-[^-]*$/, '')
const zoomCode = (scale) => ((scale - 1) / 1.3) * 1000   // 播放器 zoomOf(z) = 1 + z/1000×1.3 的反函数

export function parse(text, ctx = null) {
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  const grids = Array.isArray(data?.importGridList) ? data.importGridList : null
  if (!grids) throw new Error('找不到 importGridList')
  const stats = { grids: grids.length, rows: 0, commands: 0, raw: {}, unresolved: {}, spines: 0, ignored: {}, notes: [] }
  if (data?._tsk_zh) stats.translated = true
  const raw = (key) => { stats.raw[key] = (stats.raw[key] || 0) + 1 }
  const miss = (kind, name) => { const key = `${kind}:${name}`; stats.unresolved[key] = (stats.unresolved[key] || 0) + 1 }
  const ignore = (key) => { stats.ignored[key] = (stats.ignored[key] || 0) + 1 }
  const master = ctx?.master
  const hasIndex = Boolean(ctx?.hasIndex)
  const screenWidth = ctx?.screenWidth || DEFAULT_SCREEN_WIDTH

  // --- 查名称表 / 资源索引 ---
  const nameOf = (key) => master?.chars.get(key)?.name || nameOfKey(key)
  const standFiles = (key) => {
    const info = master?.chars.get(key)
    if (!info?.dir || !info.base) { if (master) miss('character', key); return null }
    if (info.type && !/^spine$/i.test(info.type)) { raw(`character:${info.type}`); return null }
    const base = `${info.dir}/${info.base}`
    if (hasIndex && !ctx.skeletons.has(base)) { miss('character-file', base); return null }
    return { skel: `${base}.skel.bytes`, atlas: `${base}.atlas.txt` }
  }
  const findIn = (map, path) => map?.get(path.toLowerCase()) || ''
  const resolveBg = (label) => {
    const entry = master?.textures.get(label)
    const guess = entry?.file ? withExt(entry.file, 'png') : `Adventure/BackGrounds/${label}.png`
    if (!hasIndex) return guess
    const hit = findIn(ctx.images, guess) || findIn(ctx.images, `Adventure/BackGrounds/${label}.png`) || findIn(ctx.images, `Adventure/BackGrounds/${label}.jpg`)
    if (!hit) miss('background', label)
    return hit
  }
  const soundFile = (label, dirs) => {
    const entry = master?.sounds.get(label)
    const tried = [entry?.file ? withExt(entry.file, 'ogg') : '', ...dirs.map((dir) => `Sound/${dir}/${label}.ogg`)].filter(Boolean)
    if (!hasIndex) return tried[0] || ''
    for (const path of tried) { const hit = findIn(ctx.sounds, path); if (hit) return hit }
    return ''
  }
  const resolveBgm = (label) => {
    const entry = master?.sounds.get(label)
    const pick = (file) => (file ? (hasIndex ? findIn(ctx.sounds, withExt(file, 'ogg')) : withExt(file, 'ogg')) : '')
    const loop = pick(entry?.file)
    const intro = pick(entry?.intro)
    if (loop || intro) return { src: loop || intro, ...(loop && intro ? { intro } : {}) }
    const guess = soundFile(label, ['Bgm'])
    return guess ? { src: guess } : null
  }
  const stillFiles = (id) => {
    const bases = ctx?.stills?.get(`Stills/${id}`)
    if (bases?.length) return bases.map((base) => ({ skel: `Stills/${id}/${base}.skel.bytes`, atlas: `Stills/${id}/${base}.atlas.txt` }))
    if (hasIndex) { miss('still', id); return [] }
    return [{ skel: `Stills/${id}/${id}.skel.bytes`, atlas: `Stills/${id}/${id}.atlas.txt` }]
  }

  // --- 输出 ---
  const steps = []
  let pending = []            // 还没有台词的行攒下来的指令（并进下一句）
  let guard = null            // 当前 when（分支里才有）
  let openBlock = null        // 当前分支 { group, outer, cmds }
  let speaker = null
  let choiceCount = 0
  let camera = [0, 0, 0]
  const emit = (command) => {
    if (guard) command.when = guard
    if (openBlock) openBlock.cmds.push(command)
    pending.push(command)
  }
  const pushStep = () => {
    stats.commands += pending.length
    steps.push({ index: steps.length, commands: pending })
    pending = []
  }

  // --- 舞台状态（编译时的近似：分支开始时从弹选项那一刻的状态重来）---
  let stage = new Map()       // 槽 → { key, skel, atlas, anim, skin, sub, x }
  let slotOf = new Map()      // 角色名 → 槽
  let stillId = ''
  let bgvoiceOn = false
  const snapshot = () => ({ stage: new Map([...stage].map(([slot, entry]) => [slot, { ...entry }])), slotOf: new Map(slotOf), stillId })
  const restore = (snap) => { stage = new Map([...snap.stage].map(([slot, entry]) => [slot, { ...entry }])); slotOf = new Map(snap.slotOf); stillId = snap.stillId }
  const standOp = (slot, entry, extra = {}) => ({
    op: 'spine', slot, kind: 'chara', skel: entry.skel, atlas: entry.atlas, anim: entry.anim, loop: true, speed: 1, x: entry.x,
    ...(entry.skin ? { skin: entry.skin } : {}), ...(entry.sub ? { sub: entry.sub } : {}), ...extra,
  })
  const showStand = (row) => {
    const slot = row.a3
    const files = standFiles(row.a1)
    if (!files || !/^[A-Za-z0-9_]+$/.test(slot)) return
    const before = slotOf.get(row.a1)
    if (before && before !== slot) { emit({ op: 'spineOff', slot: before }); stage.delete(before) }
    const offset = numOrNull(row.a4)
    const old = stage.get(slot)
    const entry = { key: row.a1, ...files, anim: row.anim || (old?.key === row.a1 ? old.anim : ''), skin: row.skin || (old?.key === row.a1 ? old.skin : ''), sub: row.sub, x: offset !== null ? 0.5 + offset / screenWidth : old?.x ?? 0.5 }
    if (old && old.key !== row.a1) slotOf.delete(old.key)
    stage.set(slot, entry)
    slotOf.set(row.a1, slot)
    stats.spines += 1
    const fade = secOf(row.a6)
    emit(standOp(slot, entry, fade ? { fade } : {}))
  }
  // 说话的角色已经在场：只在表情 / 动画变了时更新
  const updateStand = (row) => {
    const slot = slotOf.get(row.a1)
    const entry = slot ? stage.get(slot) : null
    if (!entry || (!row.skin && !row.anim && !row.sub)) return
    const next = { ...entry, anim: row.anim || entry.anim, skin: row.skin || entry.skin, sub: row.sub || entry.sub }
    if (next.anim === entry.anim && next.skin === entry.skin && next.sub === entry.sub) return
    stage.set(slot, next)
    stats.spines += 1
    emit(standOp(slot, next))
  }
  const playStill = (row) => {
    const files = stillFiles(row.a1)
    if (!files.length) return
    if (stillId !== row.a1) { emit({ op: 'bgoff', fade: 0 }); emit({ op: 'spineOff', prefix: 'still' }); stillId = row.a1 }
    const anim = row.anim
    const speed = numOrNull(row.speed)
    files.forEach((file, order) => {
      stats.spines += 1
      emit({ op: 'spine', slot: `still${order}`, kind: 'still', skel: file.skel, atlas: file.atlas, anim, loop: /_loop$/i.test(anim), speed: speed && speed > 0 ? speed : 1, order })
    })
  }
  const stillOff = () => { if (stillId) { emit({ op: 'spineOff', prefix: 'still' }); stillId = '' } }

  // --- 一个 grid ---
  const compileGrid = (rows, gridIndex) => {
    stats.rows += rows.length
    // 开头清场：上一个 grid 留下的立绘 / 静态画面 / 背景人声 / 背景音效不带过来
    if (gridIndex > 0 && (stage.size || stillId || bgvoiceOn)) { emit({ op: 'spineOff' }); emit({ op: 'bgseStop' }); emit({ op: 'bgvoiceOff', slot: '1' }) }
    stage = new Map(); slotOf = new Map(); stillId = ''; bgvoiceOn = false
    guard = null; openBlock = null; speaker = null
    const labelAt = new Map()     // 标签 → 行号
    rows.forEach((row, i) => { if (row.command.startsWith('*') && !labelAt.has(row.command)) labelAt.set(row.command, i) })
    // Selection 分组：标签去掉末尾 -数字 相同的是一组；没有这种后缀的，连续的 Selection 行算一组
    const groups = []
    const groupOfRow = new Map()
    const groupOfLabel = new Map()   // 标签 → { group, index }
    const byKey = new Map()
    let run = null
    rows.forEach((row, i) => {
      if (row.command !== 'Selection') { run = null; return }
      const m = /^\*(.*)-\d+$/.exec(row.a1)
      let group
      if (m) group = byKey.get(m[1]) || (byKey.set(m[1], { options: [] }), byKey.get(m[1]))
      else { if (!run) run = { options: [] }; group = run }
      if (!groups.includes(group)) groups.push(group)
      groupOfRow.set(i, group)
      if (!groupOfLabel.has(row.a1)) groupOfLabel.set(row.a1, { group, index: group.options.length })
      group.options.push({ label: row.a1, text: row.text })
    })
    let dead = false
    let deadUntil = null          // null = 到下一个标签；否则到这个标签
    let resumeGuard = null
    let resumeSnap = null
    const closeBlock = () => { if (openBlock) { guard = openBlock.outer; openBlock = null; speaker = null } }

    rows.forEach((row, i) => {
      const { command } = row
      // --- 标签：分支开始 / 汇合 / 跳转到达 ---
      if (command.startsWith('*')) {
        const option = groupOfLabel.get(command)
        const opens = Boolean(option && option.group.var)   // 选项的分支标签：Jump / EndScenario 跳过的区域里也要进（选了它就是直接跳过来的）
        if (dead && !opens && deadUntil !== null && command !== deadUntil) return
        if (dead) { dead = false; guard = resumeGuard; speaker = null }
        closeBlock()
        if (opens) {
          openBlock = { group: option.group, outer: option.group.outer, cmds: [] }
          guard = [...(option.group.outer || []), { var: option.group.var, op: '===', value: String(option.index + 1) }]
          if (option.group.snap) restore(option.group.snap)
          speaker = null
        }
        return
      }
      if (dead) return
      if (command === 'Selection') {
        const group = groupOfRow.get(i)
        closeBlock()
        if (group && !group.var) {
          choiceCount += 1
          group.var = `sel${choiceCount}`
          group.outer = guard
          group.snap = snapshot()
          emit({ op: 'choice', id: `${steps.length}:${pending.length}`, var: group.var, options: group.options.map((option, n) => ({ value: n + 1, segments: richText(option.text) })) })
          emit({ op: 'text', segments: [] })
          pushStep()
          speaker = null
          stats.choices = (stats.choices || 0) + 1
        }
        return
      }
      const a6 = secOf(row.a6)
      switch (command) {
        case '': {
          const asChar = /^<Character=(.*)>$/.exec(row.a2)
          const off = /^<Off>$/i.test(row.a2)
          if (row.a1 && !off) { if (row.a3) showStand(row); else updateStand(row) }
          if (!row.text) { if (!row.a1 && !row.voice) ignore('空行'); break }
          const voice = row.voice
          if (voice) {
            const src = hasIndex ? ctx.voices.get(voice) : `Sound/Voice/${voice}.ogg`
            if (src) emit({ op: 'voice', src }); else miss('voice', voice)
          }
          const who = row.a1 ? (asChar ? nameOf(asChar[1].trim()) : nameOf(row.a1)) : ''
          if (who !== speaker) { emit({ op: 'speaker', segments: who ? [{ text: who }] : [] }); speaker = who }
          emit({ op: 'text', segments: richText(row.text) })
          pushStep()
          break
        }
        case 'Bg': {
          const src = resolveBg(row.a1)
          stillOff()
          if (src) emit({ op: 'bg', src, fade: a6 })
          break
        }
        case 'BgOff': stillOff(); emit({ op: 'bgoff', fade: a6 }); break
        case 'BgEvent': playStill(row); break
        case 'BgEventOff': stillOff(); break
        case 'Bgm': {
          const bgm = resolveBgm(row.a1)
          if (bgm) emit({ op: 'bgm', ...bgm }); else miss('bgm', row.a1)
          break
        }
        case 'StopBgm': emit({ op: 'bgmStop', fade: a6 }); break
        case 'Se': { const src = soundFile(row.a1, ['Se', 'BgSe']); if (src) emit({ op: 'se', src }); else miss('se', row.a1); break }
        case 'BgSe': { const src = soundFile(row.a1, ['BgSe', 'Se']); if (src) emit({ op: 'bgse', src, loop: true }); else miss('bgse', row.a1); break }
        case 'StopBgSe': emit({ op: 'bgseStop' }); break
        case 'BgVoice': {
          const src = hasIndex ? ctx.bgVoices.get(row.a1) : `Sound/BgVoice/${row.a1}.ogg`
          if (src) { emit({ op: 'bgvoice', slot: '1', src, volume: 1 }); bgvoiceOn = true } else miss('bgvoice', row.a1)
          break
        }
        case 'StopBgVoice': emit({ op: 'bgvoiceOff', slot: '1' }); bgvoiceOn = false; break
        case 'Wait': if (a6 > 0) emit({ op: 'wait', seconds: a6 }); break
        case 'FadeOut': emit({ op: 'fade', to: 'black', seconds: a6 }); break
        case 'FadeIn': emit({ op: 'fade', to: 'clear', seconds: a6 }); break
        case 'CharacterOff': {
          if (row.a1) {
            const slot = slotOf.get(row.a1)
            if (slot) { emit({ op: 'spineOff', slot }); stage.delete(slot); slotOf.delete(row.a1) }
          } else if (stage.size) { emit({ op: 'spineOff', prefix: 'Chara' }); stage.clear(); slotOf.clear() }
          break
        }
        case 'HideMessageWindow': emit({ op: 'ui', visible: false, seconds: 0 }); break
        case 'ShowMessageWindow': emit({ op: 'ui', visible: true, seconds: 0 }); break
        case 'ZoomCamera': {
          const mode = numOrNull(row.a2)
          const percent = numOrNull(row.a4)
          let to = null
          if (mode === 1) to = [0, 0, 0]
          else if (percent !== null && percent > 0) to = [0, 0, zoomCode(percent / 100)]
          if (!to) { raw('ZoomCamera'); break }
          emit({ op: 'camera', from: [...camera], to, seconds: a6 })
          camera = to
          break
        }
        case 'Shake': {
          const kv = keyValues(row.a3)
          const x = Math.abs(numOrNull(kv.x) ?? 0)
          const y = Math.abs(numOrNull(kv.y) ?? 0)
          const seconds = secOf(kv.time, 0.5)
          if (/^graphics$/i.test(row.a1)) emit({ op: 'shake', axis: x && y ? 'overall' : y ? 'vertical' : 'horizontal', strength: Math.max(x, y) / 40, seconds })
          else if (slotOf.has(row.a1)) emitAction(slotOf.get(row.a1), x ? 2 : 1)
          else raw(`Shake:${row.a1 ? '角色不在场' : '无目标'}`)
          break
        }
        case 'Tween': tween(row); break
        case 'EndScenario': {
          resumeGuard = openBlock ? openBlock.outer : guard
          openBlock = null
          dead = true; deadUntil = null
          break
        }
        case 'Jump': {
          if (row.a2) { raw('Jump:带条件（flag，没有运行时变量，当作没跳）'); break }
          const target = labelAt.get(row.a1)
          resumeGuard = openBlock ? openBlock.outer : guard
          if (target === undefined || target <= i) { if (target !== undefined) raw('Jump:跳回前面的标签（循环）'); else raw('Jump:找不到标签'); openBlock = null; dead = true; deadUntil = null; break }
          openBlock = null
          dead = true; deadUntil = row.a1
          break
        }
        case 'WaitCustom': case 'WaitInput': ignore(command); break
        default: raw(command || '(空)')
      }
    })
    // 最后一个分支一直到 grid 末尾都没有结束标记：不加条件（宁可多放一段，也别把后面的剧情藏掉）
    if (openBlock && !dead) {
      for (const command of openBlock.cmds) { if (openBlock.outer) command.when = openBlock.outer; else delete command.when }
      stats.notes.push(`第 ${gridIndex + 1} 个 grid 的最后一个选项分支没有结束标记（标签 / Jump / EndScenario），分支里的指令没有加条件`)
    }
    openBlock = null
  }
  // Tween 折成立绘动作：MoveBy / PunchPosition / ShakePosition（带 pingPong = 来回，不是搬家）→ 动作 1 跳 / 2 左右抖 / 3 下沉；
  // MoveTo x（像素偏移）/ 不带 pingPong 的 MoveBy x → 改横向位置；ColorTo / ScaleTo / RotateTo / y 方向的搬家没有对应的立绘字段，记 raw
  function emitAction(slot, action) {
    const entry = stage.get(slot)
    if (!entry) return
    stats.spines += 1
    emit(standOp(slot, entry, { action }))
  }
  function tween(row) {
    const kv = keyValues(row.a3)
    const slot = slotOf.get(row.a1)
    const mode = row.a2
    if (!slot) { raw(`Tween:${mode || '(空)'}（角色不在场）`); return }
    const x = numOrNull(kv.x)
    const y = numOrNull(kv.y)
    const returns = /pingpong/i.test(row.a5)
    if (mode === 'PunchPosition' || mode === 'ShakePosition' || (mode === 'MoveBy' && returns)) {
      if (x) emitAction(slot, 2)
      else if (y) emitAction(slot, y < 0 ? 3 : 1)
      else raw(`Tween:${mode}（没有 x / y）`)
    } else if ((mode === 'MoveTo' || mode === 'MoveBy') && x !== null) {
      const entry = stage.get(slot)
      const next = { ...entry, x: mode === 'MoveTo' ? 0.5 + x / screenWidth : entry.x + x / screenWidth }
      stage.set(slot, next)
      stats.spines += 1
      emit(standOp(slot, next, secOf(kv.time) ? { move: secOf(kv.time) } : {}))
    } else raw(`Tween:${mode || '(空)'}`)
  }

  grids.forEach((grid, gridIndex) => compileGrid(bookRows(grid), gridIndex))
  if (pending.length) {
    if (steps.length) { steps[steps.length - 1].commands.push(...pending); stats.commands += pending.length; pending = [] }
    else { pending.push({ op: 'text', segments: [] }); pushStep() }
  }
  return { steps, stats }
}

// 体检：没读到名称表 / 没有角色骨架索引 / 没有剧情
export function health(ctx) {
  const out = []
  if (!ctx.master.chars.size) out.push({ code: 'master-chars-missing', message: '没读到 Adventure/Master.chapter.json 的 Character 表：立绘出不来、说话人显示角色名里 - 前面的部分（检查 adapterOptions.root 是不是 StreamingAssets/<游戏名> 目录）' })
  if (!ctx.master.textures.size) out.push({ code: 'master-textures-missing', message: 'Master.chapter.json 里没有 Texture 表：背景按 Adventure/BackGrounds/<名>.png 猜' })
  if (!ctx.master.sounds.size) out.push({ code: 'master-sounds-missing', message: 'Master.chapter.json 里没有 Sound 表：BGM / 音效按文件夹和名字猜' })
  if (!ctx.books.length) out.push({ code: 'no-books', message: 'Adventure/ 下没有 *.book.json' })
  return out
}
export const utageBookAdapter = { id: ADAPTER_ID, health, label: 'Utage 剧情（*.book.json，Twinkle Star Knights X）', sniff, parse, contextFiles, contextDirs, contextWalkLimit, prepare, catalog }
