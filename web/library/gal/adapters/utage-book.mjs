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
// 立绘 / 画面（没有真机对照，位置全是推的）：站位槽 → spine 指令的 slot（默认 Chara1…）、kind chara；x = standX.slotBase + 偏移 / 屏宽（默认 0.5 + Arg4 / 1280）；Skin / SpineSubAnim 带在指令的 skin / sub 字段里，播放器暂时不认。
//   角色骨架 = Master Character 的 FileName 去掉 paths.skeletonSuffixStrip（默认 .asset、_SkeletonData：Characters/ch_1001001/ch_1001001_m0 → .skel.bytes / .atlas.txt）。
// 适配器只「读配置、按配置匹配」：所有猜出来的路径 / 正则 / 命名规则 / 数字都在 DEFAULT_OPTIONS 里，由 config.adapterOptions['utage-book']（管理员脚本 gal-layout 写）逐项覆盖（对象逐层合并，数组 / 标量整个替换）；
// 没跑过脚本的条目用这份内置默认值，行为和以前完全一样。完整选项（括号里 = 默认值）：
//   root ('')                    StreamingAssets/<游戏名> 目录，相对媒体目录
//   screenWidth (1280)           Arg4 偏移的参照屏宽
//   standX { slotBase: 0.5, argIndex: 4 }       立绘 x = slotBase + Arg<argIndex> / screenWidth（Tween MoveTo / MoveBy 同一个基准）
//   slots { Chara1: 'Chara1', … }               Utage 站位槽 → spine slot 名；表里没有的槽原样用（合法字符才行）；映射成 '' = 丢掉这个槽的立绘
//   slotPrefix ('Chara')         CharacterOff 不带角色时按这个前缀整批收立绘（spineOff prefix）
//   off { mode: 'speakerOnly', arg: '^<Off>$' } Arg2 匹配 arg（不分大小写）时：speakerOnly = 只出名字 + 台词、立绘不动；hide = 同时收掉这个角色的立绘（没有真机对照）
//   speaker { source: ['NameText', 'key'], splitOn: '-', pick: 'beforeLast', characterArg: '^<Character=(.*)>$' }
//        显示名按 source 的顺序取第一个非空的：NameText = Master 的 NameText、key = 角色名（Arg1）按 splitOn 切后 pick（beforeLast = 最后一个 splitOn 之前的部分 / first = 第一段 / last = 最后一段 / 没有 splitOn 就是整个名字）、raw = 角色名原样；characterArg 的第 1 组 = 说话人改名
//   bgm { play: 'loop' }         loop = 放 loop 文件（只有 intro 时放 intro；两个都有时 intro 记在指令的 intro 字段）/ intro = 放 intro 文件（没有再放 loop）/ intro+loop = 放 intro 并把 loop 文件记在指令的 loop 字段（播放器暂不认接续）
//   tween { targetSlots: true }   Tween / Shake 的 Arg1 可以是站位槽名（见下一项）。Tween 本身按原版代码处理（pingPong → bounce，MoveBy / MoveTo → 位移，见 tween() 上面的注释），没有可调项
//   selection { groupSuffix: '-\\d+$', adjacentGroups: true }   Selection 标签（去掉开头 *）匹配 groupSuffix 的，去掉后缀相同的算一组；不匹配的：adjacentGroups = 连续的 Selection 行算一组，否则一行一组
//   nameOnlyRow ('show')         只有角色名（Arg1）、没有站位槽（Arg3）、也不是 <Off> 的行，而这个角色不在场：show = 把它摆出来（槽 = 它上次用过的槽，没有就取第一个空槽；横向位置 = 上次的，没有就居中）/ faceOnly = 不摆（以前的行为，只在已在场时更新表情）
//                                真实数据：CharacterOff 之后、Selection 标签之后常有这样的行，后面的 Tween / Shake 就指着这个名字；<Off> 行不受影响
//   tween.targetSlots (true)     Tween / Shake 的 Arg1 可以是站位槽名（Chara1 / Chara2…，按 slots 表映射）：指现在站在这个槽里的角色；false = 只认角色名（以前的行为）
//   catalog { groups: [{ folder: '^CharaScenario$', idRe: '^CharaScenario(\\d{4})\\d{3}$', nameFrom: 'masterCharacter', charFile: '(?:^|/)ch_{id}', fallback: '特别 / 其他' }] }
//        列表分组（数组，按顺序第一条 folder 匹配文件夹名的生效；没匹配的文件夹不变，平铺）：这个文件夹里的剧情按 idRe 的第 1 组（角色 id = 剧情号前 4 位）分组，每组一个目录节点（组内按剧情号排，组按 id 排）；
//        nameFrom：masterCharacter = 组名取 Master Character 表里 FileName 匹配 charFile（{id} = 角色 id）的第一行的 NameText（行在但 NameText 为空 = 用 id）/ id = 直接用 id；
//        表里没有这个角色（TSK 的 9xxx 号段：9010 / 9019 / 9020 / 9029 / 9030 / 9040 在 Character 表里都没有）或剧情号不匹配 idRe（比如 6 位的 907011）的统一进 fallback 这一组（排最后）；fallback 写 '' = 不设这一组，这些剧情直接平铺在文件夹下（排在各组后面）。
//        Master 表里一个角色都没读到时没法判断「有没有这个角色」，全部按 id 分组、组名 = id。节点 id：组 = <文件夹节点 id>/@<角色 id>（其它 = /@other），剧情节点 id 不变。9xxx 是不是「活动剧情」：样本里只有文件名（没有剧情内容 / 名字），没有依据，所以只做成可配置的 fallback 组。
//   folderLabels [['^MainScenario$', '主线'], …]   目录名 → 中文名（按顺序第一条匹配；列表里也按这个顺序排，没匹配的排最后）
//   index { dirs: ['Adventure', 'Characters', 'Stills', 'Sound'], master: 'Adventure/Master.chapter.json', ext: '\\.(?:skel\\.bytes|png|jpe?g|ogg)$', books: ['^Adventure/(?:(?<category>[^/]+)/)?(?:.*/)?(?<stem>[^/]+)\\.book\\.json$'] }
//        扫哪些目录（相对 root）/ 名称表文件 / 进索引的扩展名 / 剧情文件的路径正则（命名组 category = 文件夹、stem = 剧情名）
//   paths { characters: [{ skel, atlas }], stills: [{ skel, atlas }], bg, voice, bgvoice, se, bgse, bgm, bgmIntro, bgmFallback, skeletonSuffixStrip, charIdStrip }   候选路径模板（数组，按顺序试，第一个在索引里的为准）：
//        占位符 {name}（标签 / 语音名）{file:png}（Master 表里的 FileName，没有扩展名补 .png）{intro:ogg}（IntroFileName）{dir} {base}（角色骨架目录 / 基名）{charId}（角色目录名去掉 charIdStrip，默认 ^ch_）{id}（静态画面号）{base}（静态画面骨架基名）
//        **/ = 中间任意层目录（按文件名找，大小写 / 扩展名后备 / preferDirs 来自 config.resourceResolve）；stills 的 * = 骨架基名通配（按自然序全部放出来）
//        默认：characters [{ skel: '{dir}/{base}.skel.bytes', atlas: '{dir}/{base}.atlas.txt' }]、stills [{ skel: 'Stills/{id}/*.skel.bytes', atlas: 'Stills/{id}/{base}.atlas.txt' }]、
//        bg ['{file:png}', 'Adventure/BackGrounds/{name}.png', 'Adventure/BackGrounds/{name}.jpg']、voice ['Sound/Voice/**/{name}.ogg', 'Sound/BgVoice/**/{name}.ogg']、bgvoice（顺序反过来）、
//        se ['{file:ogg}', 'Sound/Se/{name}.ogg', 'Sound/BgSe/{name}.ogg']、bgse（Se / BgSe 反过来）、bgm ['{file:ogg}']、bgmIntro ['{intro:ogg}']、bgmFallback ['Sound/Bgm/{name}.ogg']（Master 表里没有 / 文件不在时才用）
//   没有文件索引时不查，按每个列表的第一条模板猜（**/ 去掉）。
// 列表（adapter.catalog）：Adventure/ 下每个剧情文件夹（MainScenario / CharaScenario …）→ 剧情文件（一个文件 = 一个场景）+ 全部剧情；每次从文件索引现读。CharaScenario 再按角色分组（catalog.groups，见上）。
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseRichText } from './uviewer-csv.mjs'
import { expandTemplate, guessTemplate, lookupFor, mergeOptions, safeRegex } from './path-templates.mjs'

export const ADAPTER_ID = 'utage-book'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const COLUMNS = ['Command', 'Arg1', 'Arg2', 'Arg3', 'Arg4', 'Arg5', 'Arg6', 'Skin', 'SpineAnim', 'SpineSubAnim', 'AnimCompType', 'AnimSpd', 'WaitType', 'Text', 'PageCtrl', 'Voice', 'WindowType']

export const DEFAULT_OPTIONS = Object.freeze({
  root: '',
  screenWidth: 1280,
  standX: { slotBase: 0.5, argIndex: 4 },
  slots: { Chara1: 'Chara1', Chara2: 'Chara2', Chara3: 'Chara3' },
  slotPrefix: 'Chara',
  off: { mode: 'speakerOnly', arg: '^<Off>$' },
  speaker: { source: ['NameText', 'key'], splitOn: '-', pick: 'beforeLast', characterArg: '^<Character=(.*)>$' },
  bgm: { play: 'loop' },
  tween: { targetSlots: true },
  nameOnlyRow: 'show',
  spriteImagesUnder: true,   // 这些图（背景的前景部件）画在角色 / 骨骼之下（场景里没有 BgParts 物体，原版是不是画、画在哪都没法对照；false = 盖在角色之上）
  spriteImages: true,   // Sprite 命令的普通图片（BgParts 前景等）叠在背景上。注意：反编译的原版 HandleSpriteCommand 只认 Spine / EM_ / ch_，这些图原版可能根本不画——false = 记 raw（以前的行为）
  selection: { groupSuffix: '-\\d+$', adjacentGroups: true, singleAsText: true },
  // 文件夹 → 中文名（猜的，卡片副标题里同时写着文件夹名）；顺序 = 列表顺序
  folderLabels: [['^MainScenario$', '主线'], ['^CharaScenario$', '角色剧情'], ['^StoryEventScenario$', '活动剧情'], ['^BossrushEventScenario$', 'Bossrush 活动'], ['^HomeEventScenario$', '家园事件'], ['^ItemEventScenario$', '道具事件'], ['^SpEventScenario$', '特别活动'], ['^SubjugationEventScenario$', '讨伐活动']],
  // 列表分组（见头部 catalog）：角色剧情按角色 id（剧情号前 4 位）分组
  catalog: { groups: [{ folder: '^CharaScenario$', idRe: '^CharaScenario(\\d{4})\\d{3}$', nameFrom: 'masterCharacter', charFile: '(?:^|/)ch_{id}', fallback: '特别 / 其他' }] },
  index: {
    dirs: ['Adventure', 'Characters', 'Stills', 'Sound'],
    master: 'Adventure/Master.chapter.json',
    ext: '\\.(?:skel\\.bytes|png|jpe?g|ogg)$',
    books: ['^Adventure/(?:(?<category>[^/]+)/)?(?:.*/)?(?<stem>[^/]+)\\.book\\.json$'],
  },
  paths: {
    characters: [{ skel: '{dir}/{base}.skel.bytes', atlas: '{dir}/{base}.atlas.txt' }],
    stills: [{ skel: 'Stills/{id}/*.skel.bytes', atlas: 'Stills/{id}/{base}.atlas.txt' }],
    bg: ['{file:png}', 'Adventure/BackGrounds/{name}.png', 'Adventure/BackGrounds/{name}.jpg'],
    voice: ['Sound/Voice/**/{name}.ogg', 'Sound/BgVoice/**/{name}.ogg'],
    bgvoice: ['Sound/BgVoice/**/{name}.ogg', 'Sound/Voice/**/{name}.ogg'],
    se: ['{file:ogg}', 'Sound/Se/{name}.ogg', 'Sound/BgSe/{name}.ogg'],
    bgse: ['{file:ogg}', 'Sound/BgSe/{name}.ogg', 'Sound/Se/{name}.ogg'],
    bgm: ['{file:ogg}'],
    bgmIntro: ['{intro:ogg}'],
    bgmFallback: ['Sound/Bgm/{name}.ogg'],
    skeletonSuffixStrip: ['.asset', '_SkeletonData'],
    charIdStrip: '^ch_',
  },
})
const FREE_TABLES = ['slots', 'kinds', 'actions']
// 用户选项 + 默认值（编译好的正则 / 数字校验缓存在 WeakMap 里；同一个 options 对象只算一次）
const resolved = new WeakMap()
export function resolveOptions(options) {
  const source = options && typeof options === 'object' ? options : null
  if (source && resolved.has(source)) return resolved.get(source)
  const o = mergeOptions(DEFAULT_OPTIONS, source, FREE_TABLES)
  o.root = String(o.root || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  o.screenWidth = Number(o.screenWidth) > 0 ? Number(o.screenWidth) : DEFAULT_OPTIONS.screenWidth
  const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : fallback)
  o.standX = { slotBase: num(o.standX.slotBase, 0.5), argIndex: Math.round(num(o.standX.argIndex, 4)) }
  const list = (value, fallback) => (Array.isArray(value) ? value.map(String) : fallback)
  o.nameOnlyRow = o.nameOnlyRow === 'faceOnly' ? 'faceOnly' : 'show'
  o.spriteImages = o.spriteImages !== false
  o.spriteImagesUnder = o.spriteImagesUnder !== false
  o.tween.targetSlots = o.tween.targetSlots !== false
  o.speaker.source = list(o.speaker.source, DEFAULT_OPTIONS.speaker.source)
  for (const key of ['dirs', 'books']) o.index[key] = list(o.index[key], DEFAULT_OPTIONS.index[key])
  for (const key of Object.keys(DEFAULT_OPTIONS.paths)) if (Array.isArray(DEFAULT_OPTIONS.paths[key])) o.paths[key] = Array.isArray(o.paths[key]) ? o.paths[key] : DEFAULT_OPTIONS.paths[key]
  o.re = {
    off: safeRegex(o.off.arg, 'i'),
    characterArg: safeRegex(o.speaker.characterArg, ''),
    group: safeRegex(o.selection.groupSuffix, ''),
    ext: safeRegex(o.index.ext, 'i'),
    books: o.index.books.map((source) => safeRegex(source, 'i')).filter(Boolean),
    charId: safeRegex(o.paths.charIdStrip, ''),
    groups: (Array.isArray(o.catalog?.groups) ? o.catalog.groups : DEFAULT_OPTIONS.catalog.groups).filter((rule) => rule && typeof rule === 'object').map((rule) => ({
      folder: safeRegex(rule.folder, ''), id: safeRegex(rule.idRe, ''), nameFrom: rule.nameFrom === 'id' ? 'id' : 'masterCharacter',
      charFile: typeof rule.charFile === 'string' ? rule.charFile : DEFAULT_OPTIONS.catalog.groups[0].charFile, fallback: typeof rule.fallback === 'string' ? rule.fallback : '',
    })).filter((rule) => rule.folder && rule.id),
    labels: (Array.isArray(o.folderLabels) ? o.folderLabels : []).map((rule) => [safeRegex(Array.isArray(rule) ? rule[0] : '', ''), Array.isArray(rule) ? String(rule[1] ?? '') : '']).filter(([re]) => re),
  }
  if (source) resolved.set(source, o)
  return o
}
const rootOf = (options) => resolveOptions(options).root

// 头 8KB 里要有 importGridList 和表头行的 Command / Arg1（Master.chapter.json 是 settingList，没有 importGridList，不会被认走）
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 8192)
  return /"importGridList"\s*:/.test(head) && /"Command"/.test(head) && /"Arg1"/.test(head)
}

// ---------- 上下文：Master.chapter.json + 资源目录索引 ----------
export const contextFiles = (options) => [joinPath(rootOf(options), resolveOptions(options).index.master)]
export const contextDirs = (options) => resolveOptions(options).index.dirs.map((dir) => joinPath(rootOf(options), dir))
export const contextWalkLimit = 800000   // 语音文件很多（Sound/Voice/ImportChara/<角色>/…），默认 40 万不一定够

const natAsc = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
const str = (value) => (value === null || value === undefined ? '' : String(value))
const numOrNull = (value) => { const text = str(value).trim(); if (!text) return null; const n = Number(text); return Number.isFinite(n) ? n : null }
const secOf = (value, fallback = 0) => { const n = numOrNull(value); return n !== null && n >= 0 ? Math.min(60, n) : fallback }
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

// FileName → { dir, base }：依次去掉 strip 里每个后缀（有就去），再按最后一个 / 切
const splitFile = (file, strip) => {
  let name = file
  for (const suffix of strip) if (suffix && name.toLowerCase().endsWith(String(suffix).toLowerCase())) name = name.slice(0, -String(suffix).length)
  const at = name.lastIndexOf('/')
  return { dir: at > 0 ? name.slice(0, at) : '', base: name.slice(at + 1) }
}

export function readMaster(text, strip = DEFAULT_OPTIONS.paths.skeletonSuffixStrip) {
  const chars = new Map()    // CharacterName → { name, file, dir, base, type }（dir / base 按 strip 切好的，parse 按选项重切 file）
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
        const file = cleanPath(row.get('FileName'))
        chars.set(key, { name: row.get('NameText'), file, ...splitFile(file, strip), type: row.get('FileType'), posX: Number(row.get('X')) || 0, posY: Number(row.get('Y')) || 0, scale: Number(row.get('Scale')) > 0 ? Number(row.get('Scale')) : 1 })
      }
    } else if (kind === 'Texture') {
      for (const row of readTable(setting)) { const label = row.get('Label'); if (label && !textures.has(label)) textures.set(label, { type: row.get('Type'), file: cleanPath(row.get('FileName')) }) }
    } else if (kind === 'Sound') {
      for (const row of readTable(setting)) { const label = row.get('Label'); if (label && !sounds.has(label)) sounds.set(label, { type: row.get('Type'), intro: cleanPath(row.get('IntroFileName')), file: cleanPath(row.get('FileName')) }) }
    }
  }
  return { chars, textures, sounds }
}

export function prepare({ options, texts, files, toResourcePath, mediaDir }) {
  const o = resolveOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const books = []                // { rel, category, stem }
  const index = new Set()         // 进索引的资源路径（扩展名 index.ext）；查找在 parse 里按模板做
  for (const rel of files || []) {
    const res = toRes(rel)
    let book = null
    for (const re of o.re.books) { const m = re.exec(res); if (m) { book = { rel, category: m.groups?.category || '', stem: m.groups?.stem || '' }; break } }
    if (book) { books.push(book); continue }
    if (!o.re.ext || o.re.ext.test(res)) index.add(res)
  }
  const masterName = o.index.master.replace(/^.*\//, '')
  const textOf = (name) => Object.entries(texts || {}).find(([key]) => key.endsWith(`/${name}`) || key === name)?.[1] || ''
  const master = readMaster(textOf(masterName), o.paths.skeletonSuffixStrip)
  const ctx = { books, index, master, hasIndex: Boolean(files?.length), options }
  ctx.catalogTree = buildCatalog(ctx, o)
  if (!mediaDir) return ctx
  // 有媒体目录：读一遍每个剧情文件有几章（grid），多章的文件在列表里展开成「第 N 章」（路径 <文件>::N），原版也是一章一章单独读的
  return chaptersOfBooks(ctx.books, mediaDir).then((found) => {
    if (!found) return ctx
    ctx.catalogTree = buildCatalog(ctx, o)
    return ctx
  })
}

const chapterCache = new Map()   // 绝对路径|mtime|size → [{ n, name, rows }] | null（一章 / 读不了）
const CHAPTER_CACHE_MAX = 5000
async function chaptersOfBook(abs) {
  let info
  try { info = await stat(abs) } catch { return null }
  const key = `${abs}|${info.mtimeMs}|${info.size}`
  if (chapterCache.has(key)) return chapterCache.get(key)
  let chapters = null
  try {
    const data = JSON.parse(String(await readFile(abs, 'utf8')).replace(/^\uFEFF/, ''))
    const grids = Array.isArray(data?.importGridList) ? data.importGridList : []
    if (grids.length > 1) chapters = grids.map((grid, i) => ({ n: i + 1, name: str(grid?.name).replace(/^.*:/, ''), rows: Array.isArray(grid?.rows) ? grid.rows.length : 0 }))
  } catch { /* 读不了 / 不是剧情文件：当一章 */ }
  if (chapterCache.size >= CHAPTER_CACHE_MAX) chapterCache.delete(chapterCache.keys().next().value)
  chapterCache.set(key, chapters)
  return chapters
}
async function chaptersOfBooks(books, mediaDir) {
  let any = false
  let next = 0
  const worker = async () => {
    while (next < books.length) {
      const book = books[next++]
      const chapters = await chaptersOfBook(path.join(mediaDir, ...book.rel.split('/')))
      if (chapters) { book.chapters = chapters; any = true } else delete book.chapters
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return any
}

// ---------- 列表 ----------
// 一个文件夹里的剧情按 rule.id 的第 1 组分组（见头部 catalog.groups）；books 已经按剧情号排好
function groupBooks(ctx, rule, folderId, books, node) {
  const chars = ctx.master?.chars
  const names = new Map()   // 角色 id → 组名（找不到 = null）
  const nameOf = (key) => {
    if (names.has(key)) return names.get(key)
    let name = null
    if (rule.nameFrom === 'id' || !chars?.size) name = key
    else {
      const re = rule.charFile.includes('{id}') ? safeRegex(rule.charFile.replace(/\{id\}/g, () => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'i') : null
      if (re) for (const info of chars.values()) if (re.test(info.file)) { name = info.name || key; break }
    }
    names.set(key, name)
    return name
  }
  const groups = new Map()   // 角色 id → [book]
  const rest = []
  for (const book of books) {
    const key = rule.id.exec(book.stem)?.[1]
    if (key && nameOf(key) !== null) { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(book) } else rest.push(book)
  }
  const out = [...groups].sort((a, b) => natAsc(a[0], b[0])).map(([key, list]) => {
    const gid = `${folderId}/@${key}`
    return { id: gid, title: nameOf(key), subtitle: `${key} · ${list.length} 个`, children: list.map((book) => node(folderId, book)) }
  })
  if (rest.length && rule.fallback) out.push({ id: `${folderId}/@other`, title: rule.fallback, subtitle: `${rest.length} 个`, children: rest.map((book) => node(folderId, book)) })
  else out.push(...rest.map((book) => node(folderId, book)))
  return out
}
function buildCatalog(ctx, o) {
  if (!ctx.books.length) return null
  const ruleOf = (category) => o.re.labels.findIndex(([re]) => re.test(category))
  const labelOf = (category) => { const i = ruleOf(category); return i < 0 ? '' : o.re.labels[i][1] }
  const byCategory = new Map()
  for (const book of ctx.books) { if (!byCategory.has(book.category)) byCategory.set(book.category, []); byCategory.get(book.category).push(book) }
  const node = (prefix, book) => {
    const base = { id: `${prefix}/${book.stem}`, title: book.stem, subtitle: labelOf(book.category) ? `${labelOf(book.category)} · ${book.category}` : book.category }
    if (!book.chapters?.length) return { ...base, script: book.rel }
    // 多章的文件：展开成一章一个场景（路径 <文件>::<章号>，原版也是一章一章单独读）；不带 ::N 的路径仍然是整个文件接起来播（上一话 / 下一话沿着章走，所以列表里不放这一项）
    return {
      ...base, subtitle: `${base.subtitle ? `${base.subtitle} · ` : ''}${book.chapters.length} 章`,
      children: [
        ...book.chapters.map((c) => ({ id: `${base.id}/${c.n}`, title: `第 ${c.n} 章`, subtitle: [c.name, c.rows ? `${c.rows} 行` : ''].filter(Boolean).join(' · '), script: `${book.rel}::${c.n}` })),
      ],
    }
  }
  const categories = [...byCategory].sort((a, b) => {
    const ia = ruleOf(a[0])
    const ib = ruleOf(b[0])
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || natAsc(a[0], b[0])
  })
  const lists = categories.map(([category, list]) => {
    const id = `c/${category || '-'}`
    const sorted = [...list].sort((a, b) => natAsc(a.stem, b.stem))
    const rule = o.re.groups.find((r) => r.folder.test(category))
    return {
      id,
      title: labelOf(category) || category || '其它',
      subtitle: `${category ? `${category} · ` : ''}${list.length} 个`,
      children: rule ? groupBooks(ctx, rule, id, sorted, node) : sorted.map((book) => node(id, book)),
    }
  })
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
      skin: cell('Skin'), anim: cell('SpineAnim'), sub: cell('SpineSubAnim'), speed: cell('AnimSpd'), compType: cell('AnimCompType'), waitType: cell('WaitType'),
      text: str(row.strings[columns.get('Text')]).replace(/\r/g, '').trim(), voice: cell('Voice'),
    })
  }
  return rows
}

// 'time=.3 y=-30' → { time: '.3', y: '-30' }
const keyValues = (text) => { const out = {}; for (const part of str(text).split(/\s+/)) { const m = /^([A-Za-z]+)=(.*)$/.exec(part); if (m) out[m[1].toLowerCase()] = m[2] } return out }
// Utage 的 <ruby=读音>字</ruby> → 通用富文本的 <ruby>字|读音</ruby>
const richText = (text) => parseRichText(str(text).replace(/<ruby=([^>]*)>(.*?)<\/ruby>/gs, (_all, reading, base) => `<ruby>${base}|${reading}</ruby>`))
const zoomCode = (scale) => ((scale - 1) / 1.3) * 1000   // 播放器 zoomOf(z) = 1 + z/1000×1.3 的反函数

export function parse(text, ctx = null, meta = {}) {
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
  const o = resolveOptions(meta?.options ?? ctx?.options)
  const screenWidth = o.screenWidth
  const { paths } = o
  const lookup = hasIndex ? lookupFor(ctx, ctx.index, meta?.config?.resourceResolve) : null
  // 模板 → 资源路径：有索引就在索引里找（没有 = ''），没有索引就按模板猜（第一条）
  const resolveWith = (templates, vars, dup) => (hasIndex ? lookup.find(templates, vars, dup) : guessTemplate(templates, vars))

  // --- 查名称表 / 资源索引 ---
  const keyName = (key) => {
    const { splitOn, pick } = o.speaker
    const parts = splitOn ? key.split(splitOn) : [key]
    if (parts.length < 2) return key
    return pick === 'first' ? parts[0] : pick === 'last' ? parts[parts.length - 1] : parts.slice(0, -1).join(splitOn)
  }
  const nameOf = (key) => {
    for (const source of o.speaker.source) {
      const name = source === 'NameText' ? master?.chars.get(key)?.name : source === 'key' ? keyName(key) : source === 'raw' ? key : ''
      if (name) return name
    }
    return ''
  }
  const charVars = (key) => {
    const info = master?.chars.get(key)
    if (!info?.file) return null
    const { dir, base } = splitFile(info.file, paths.skeletonSuffixStrip)
    const last = dir.slice(dir.lastIndexOf('/') + 1)
    return { dir, base, charId: o.re.charId ? last.replace(o.re.charId, '') : last }
  }
  const standFiles = (key) => {
    const info = master?.chars.get(key)
    const vars = charVars(key)
    if (!vars?.dir || !vars.base) { if (master) miss('character', key); return null }
    if (info.type && !/^spine$/i.test(info.type)) { raw(`character:${info.type}`); return null }
    for (const pair of paths.characters) {
      const guess = expandTemplate(pair?.skel, vars)[0]
      const skel = hasIndex ? lookup.find([pair?.skel], vars) : guess
      if (skel) return { skel, atlas: expandTemplate(pair.atlas, vars)[0] || '', master: { x: info.posX || 0, y: info.posY || 0, scale: info.scale > 0 ? info.scale : 1 } }
    }
    if (hasIndex) miss('character-file', `${vars.dir}/${vars.base}`)
    return null
  }
  const entryVars = (label, kind) => { const entry = master?.[kind].get(label); return { name: label, file: entry?.file, intro: entry?.intro } }
  const resolveBg = (label) => {
    const src = resolveWith(paths.bg, entryVars(label, 'textures'))
    if (hasIndex && !src) miss('background', label)
    return src
  }
  const soundFile = (label, list) => resolveWith(list, entryVars(label, 'sounds'))
  const resolveBgm = (label) => {
    const vars = entryVars(label, 'sounds')
    const loop = resolveWith(paths.bgm, vars)
    const intro = resolveWith(paths.bgmIntro, vars)
    const play = o.bgm.play
    if (loop || intro) {
      if (play === 'intro') return { src: intro || loop }
      if (play === 'intro+loop') return { src: intro || loop, ...(loop && intro ? { loop } : {}) }
      return { src: loop || intro, ...(loop && intro ? { intro } : {}) }
    }
    const guess = resolveWith(paths.bgmFallback, vars)
    return guess ? { src: guess } : null
  }
  // 静态画面：skel 模板里的 * = 骨架基名（通配，按自然序全放出来；没有索引时 * 当作静态画面号）
  const stillFiles = (id) => {
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const pair of paths.stills) {
      const [pattern] = expandTemplate(pair?.skel, { id })
      if (!pattern) continue
      const atlasOf = (base) => expandTemplate(pair.atlas, { id, base })[0] || ''
      if (!hasIndex) return [{ skel: pattern.replace('*', id), atlas: atlasOf(id) }]
      if (!pattern.includes('*')) { const skel = lookup.find([pattern], {}); if (skel) return [{ skel, atlas: atlasOf(skel.replace(/^.*\//, '').replace(/\..*$/, '')) }]; continue }
      const at = pattern.lastIndexOf('/')
      const dir = pattern.slice(0, at)
      const [pre, post] = pattern.slice(at + 1).split('*')
      const match = new RegExp(`^${escape(dir)}/${escape(pre)}(.+)${escape(post)}$`, 'i')
      const found = lookup.under(dir).map((key) => ({ key, base: match.exec(key)?.[1] })).filter((entry) => entry.base).sort((x, y) => natAsc(x.base, y.base))
      if (found.length) return found.map(({ key, base }) => ({ skel: key, atlas: atlasOf(base) }))
    }
    if (hasIndex) miss('still', id)
    return []
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
  // 表情图标（Sprite EM_xxx）原版 1 秒后销毁；播放器按 ttl 自己收，这里在这一步结束后补一条 spineOff，往回 / 重放时不会残留
  const liveEmotes = new Set()
  const pushStep = () => {
    stats.commands += pending.length
    steps.push({ index: steps.length, commands: pending })
    pending = []
    for (const slot of liveEmotes) pending.push({ op: 'spineOff', slot })
    liveEmotes.clear()
  }

  // --- 舞台状态（编译时的近似：分支开始时从弹选项那一刻的状态重来）---
  let stage = new Map()       // 槽 → { key, skel, atlas, anim, skin, sub, x }
  let slotOf = new Map()      // 角色名 → 槽
  const lastStand = new Map() // 角色名 → { slot, x }：上次摆过的槽和横向位置（只有角色名的行再把它摆出来时用；不随分支回滚）
  let voiceRows = 0           // 带 Voice 的台词行数 / 其中找到文件的行数（一条都没找到 = 这个剧情没有语音目录）
  let voiceFound = 0
  let stillId = ''
  let bgvoiceOn = false
  let blackOn = false         // 画面被 FadeOut 盖黑了（原版 Line_RunDialogue：台词出现时画面全黑就瞬间淡入）
  const snapshot = () => ({ stage: new Map([...stage].map(([slot, entry]) => [slot, { ...entry }])), slotOf: new Map(slotOf), stillId })
  const restore = (snap) => { stage = new Map([...snap.stage].map(([slot, entry]) => [slot, { ...entry }])); slotOf = new Map(snap.slotOf); stillId = snap.stillId }
  // 原版（gal-samples21 反编译的 DialogueSystem.SetCharacterSpineAnimation）：Chara 的本地坐标 = (Master X + Arg4 偏移, Master Y − 130)，缩放 = Master Scale × 100，骨架单位 0.01；
  // Characters 的 RectTransform 轴心在 (0.5, 1.7)，Chara1~4 都在轴心上，舞台 1280×720、原点在画面中心 → 骨架原点（y 向上）= (Master X + 偏移, Master Y − 10)，一个骨架单位 = Master Scale 个舞台像素
  const placeOf = (entry) => ({ x: (entry.master?.x || 0) + (entry.x - o.standX.slotBase) * screenWidth, y: (entry.master?.y || 0) - 10 + (entry.dy || 0), scale: entry.master?.scale || 1 })
  const standOp = (slot, entry, extra = {}) => ({
    op: 'spine', slot, kind: 'chara', skel: entry.skel, atlas: entry.atlas, anim: entry.anim, loop: true, speed: 1, x: entry.x, place: placeOf(entry), stage: [screenWidth, Math.round(screenWidth * 9 / 16)],
    ...(entry.skin ? { skin: entry.skin } : {}), ...(entry.sub ? { sub: entry.sub } : {}), ...extra,
  })
  const slotName = (utageSlot) => { const mapped = Object.hasOwn(o.slots, utageSlot) ? o.slots[utageSlot] : utageSlot; return mapped ? String(mapped) : '' }
  // forcedSlot / defaultX：只有角色名的行（nameOnlyRow）指定的槽和默认横向位置；平常槽取 Arg3、横向位置取 Arg4
  const showStand = (row, forcedSlot = '', defaultX = null) => {
    const slot = forcedSlot || slotName(row.a3)
    const files = standFiles(row.a1)
    if (!files) return
    if (!/^[A-Za-z0-9_]+$/.test(slot)) { lastStand.set(row.a1, { slot: '', x: null }); return }   // 这个槽被 slots 映射成 ''（丢掉）：只有角色名的行也别再把它摆到别的槽
    const before = slotOf.get(row.a1)
    if (before && before !== slot) { emit({ op: 'spineOff', slot: before }); stage.delete(before) }
    const offset = numOrNull(row[`a${o.standX.argIndex}`])
    const old = stage.get(slot)
    const entry = { key: row.a1, ...files, anim: row.anim || (old?.key === row.a1 ? old.anim : ''), skin: row.skin || (old?.key === row.a1 ? old.skin : ''), sub: row.sub, x: offset !== null ? o.standX.slotBase + offset / screenWidth : old?.x ?? defaultX ?? o.standX.slotBase }
    if (old && old.key !== row.a1) slotOf.delete(old.key)
    stage.set(slot, entry)
    slotOf.set(row.a1, slot)
    lastStand.set(row.a1, { slot, x: entry.x })
    stats.spines += 1
    const fade = secOf(row.a6)
    emit(standOp(slot, entry, fade ? { fade } : {}))
  }
  // 只有角色名（没有站位槽、不是 <Off>）而角色不在场：摆出来（槽 = 上次用的槽、被别人占了 / 没有就取第一个空槽；位置 = 上次的）
  const showNameOnly = (row) => {
    const last = lastStand.get(row.a1)
    if (last?.slot === '') return
    const slots = [...new Set(Object.values(o.slots).map(String).filter((name) => /^[A-Za-z0-9_]+$/.test(name)))]
    const slot = last && !stage.has(last.slot) ? last.slot : slots.find((name) => !stage.has(name))
    if (slot) showStand(row, slot, last?.x ?? null)
  }
  // 说话的角色已经在场：只在表情 / 动画变了时更新
  const updateStand = (row) => {
    const slot = slotOf.get(row.a1)
    const entry = slot ? stage.get(slot) : null
    if (!entry) return
    // 原版每个有说话人的台词行都重新摆一次（SetCharacterSpineAnimation：位置 = Master + 上次的横向偏移，纵向偏移回到 0）：Tween 的纵向位移到这一句为止
    const next = { ...entry, anim: row.anim || entry.anim, skin: row.skin || entry.skin, sub: row.sub || entry.sub, dy: 0 }
    if (next.anim === entry.anim && next.skin === entry.skin && next.sub === entry.sub && !entry.dy) return
    stage.set(slot, next)
    stats.spines += 1
    emit(standOp(slot, next))
  }
  // BgEvent（原版 ProcessBgEventAnimation）：只加载 Stills/<id>/<id> 一个骨架，1:1 像素画在舞台中心；播放方式：
  //   AnimSpd 有值 → 速度 = 它，> 0 循环；否则 AnimCompType stop = 冻结 / start = 速度 1 循环；再否则动画名带 loop = 循环，不带 = 速度 0（冻结在第一帧）
  //   每次 BgEvent 之后原版还会调 CharacterOff（淡出所有角色，时长 = Arg6）
  const playStill = (row) => {
    const files = stillFiles(row.a1)
    if (!files.length) return
    if (stillId !== row.a1) { emit({ op: 'bgoff', fade: 0 }); emit({ op: 'spineOff', prefix: 'still' }); stillId = row.a1 }
    const anim = row.anim
    const comp = String(row.compType || '').toLowerCase()
    const speedNum = row.speed !== '' ? Number(row.speed) : NaN
    let speed = 1
    let loop = false
    if (row.speed !== '' && Number.isFinite(speedNum)) { speed = speedNum; loop = speedNum > 0 }
    else if (comp === 'stop') { speed = 0 }
    else if (comp === 'start') { loop = true }
    else if (anim && /loop/i.test(anim)) { loop = true }
    else speed = 0
    const exact = files.filter((f) => new RegExp(`/${String(row.a1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.skel`).test(f.skel))   // 目录里有 <id>.skel 就只用它（原版只读这一个），没有就全放
    const chosen = exact.length ? exact : files
    chosen.forEach((file, order) => {
      stats.spines += 1
      emit({ op: 'spine', slot: `still${order}`, kind: 'still', skel: file.skel, atlas: file.atlas, anim, loop, speed: speed > 0 ? speed : 1, ...(speed === 0 ? { freeze: true } : {}), order, place: { x: 0, y: 0, scale: 1 }, stage: [screenWidth, Math.round(screenWidth * 9 / 16)] })
    })
    if (stage.size) { emit({ op: 'spineOff', prefix: o.slotPrefix || 'Chara', fade: secOf(row.a6, 0.5) }); stage.clear(); slotOf.clear() }
  }
  // Tween / Shake 的目标：Arg1 是角色名（在场）或站位槽名（Chara1…，tween.targetSlots）→ 槽；不在场 = ''
  const targetSlot = (a1) => {
    const slot = slotOf.get(a1)
    if (slot) return slot
    const named = o.tween.targetSlots ? slotName(a1) : ''
    return named && stage.has(named) ? named : ''
  }
  const hideStand = (key) => { const slot = slotOf.get(key); if (slot) { emit({ op: 'spineOff', slot }); stage.delete(slot); slotOf.delete(key) } }
  const stillOff = () => { if (stillId) { emit({ op: 'spineOff', prefix: 'still' }); stillId = '' } }

  // --- 一个 grid ---
  const compileGrid = (rows, gridIndex) => {
    stats.rows += rows.length
    // 开头清场：上一个 grid 留下的立绘 / 静态画面 / 背景人声 / 背景音效不带过来
    if (gridIndex > 0 && (stage.size || stillId || bgvoiceOn)) { emit({ op: 'spineOff' }); emit({ op: 'bgseStop' }); emit({ op: 'bgvoiceOff', slot: '1' }) }
    if (gridIndex > 0 && blackOn) emit({ op: 'fade', to: 'clear', seconds: 0 })   // 上一章结尾盖黑：新一章开头清掉
    stage = new Map(); slotOf = new Map(); stillId = ''; bgvoiceOn = false; blackOn = false
    guard = null; openBlock = null; speaker = null
    const labelAt = new Map()     // 标签 → 行号
    rows.forEach((row, i) => { if (row.command.startsWith('*') && !labelAt.has(row.command)) labelAt.set(row.command, i) })
    // Selection 分组：标签去掉 selection.groupSuffix 之后相同的是一组；没有这种后缀的，连续的 Selection 行算一组（selection.adjacentGroups）
    const groups = []
    const groupOfRow = new Map()
    const groupOfLabel = new Map()   // 标签 → { group, index }
    const byKey = new Map()
    let run = null
    let runId = 0       // 连续的 Selection 行算一次选择；中间隔着别的命令就是另一次
    let prevCmd = ''    // 上一个不是标签的命令
    const lastOfKey = new Map()
    // TSK 的 *S-ch10910021-1 … -5 标签前缀相同，但每个 Selection 前后都隔着剧情（上一个分支没有 Jump 收尾）：是 5 次单独的提示，不是 1 个 5 选项的选择。
    // 交错写法（Selection → 标签 → 分支 → Jump / EndScenario → 下一个 Selection）才是同一次选择的几个选项：上一个分支被 Jump / EndScenario 收尾了，才并进同一组
    rows.forEach((row, i) => {
      if (row.command !== 'Selection') { run = null; runId += 1; if (!row.command.startsWith('*')) prevCmd = row.command; return }
      const m = row.a1.startsWith('*') && o.re.group ? o.re.group.exec(row.a1.slice(1)) : null
      const key = m ? row.a1.slice(1, 1 + m.index) : null
      let group
      if (m) {
        const prior = lastOfKey.get(key)
        const interleaved = prior && !run && (prevCmd === 'Jump' || prevCmd === 'EndScenario')
        if (interleaved) group = prior
        else { group = byKey.get(`${key}#${runId}`) || (byKey.set(`${key}#${runId}`, { options: [] }), byKey.get(`${key}#${runId}`)) }
        lastOfKey.set(key, group)
        run = run || { options: [] }   // 同一行紧跟着的 Selection 仍算同一次（相邻）
      } else { if (!run || !o.selection.adjacentGroups) run = { options: [] }; group = run }
      if (!groups.includes(group)) groups.push(group)
      groupOfRow.set(i, group)
      if (!groupOfLabel.has(row.a1)) groupOfLabel.set(row.a1, { group, index: group.options.length })
      group.options.push({ label: row.a1, text: row.text })
      prevCmd = 'Selection'
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
        // 只有一个选项、而且它的标签就在下一行（没有分支可选 = 「点一下继续」的提示）：渲染成一行普通台词，不弹选择
        if (group && !group.var && !group.plain && o.selection.singleAsText && group.options.length === 1 && labelAt.get(group.options[0].label) === i + 1) {
          group.plain = true
          emit({ op: 'speaker', segments: [] })
          emit({ op: 'text', segments: richText(group.options[0].text) })
          pushStep()
          speaker = null
          stats.singleChoices = (stats.singleChoices || 0) + 1
          return
        }
        if (group && !group.var && !group.plain) {
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
          const asChar = o.re.characterArg?.exec(row.a2)
          const off = Boolean(o.re.off?.test(row.a2))
          // Arg1 在角色表里查不到、这一行又没有表情 / 动画 / 位置 = 只是「说话人」的名字（TSK：梨緒 / クロト / モンスター 的纯台词行，65 行），不去找立绘，也不记「缺角色」
          const speakerOnly = row.a1 && master && !master.chars.has(row.a1) && !row.a3 && !row.skin && !row.anim
          if (row.a1 && !off && !speakerOnly) { if (row.a3) showStand(row); else if (!slotOf.has(row.a1) && o.nameOnlyRow === 'show') showNameOnly(row); else updateStand(row) }
          else if (row.a1 && o.off.mode === 'hide') hideStand(row.a1)
          if (!row.text) { if (!row.a1 && !row.voice) ignore('空行'); break }
          if (blackOn) { emit({ op: 'fade', to: 'clear', seconds: 0 }); blackOn = false }   // 原版：fade.color.a >= 1 时 FadeInEffect(color, 0)
          const voice = row.voice
          if (voice) {
            const src = resolveWith(paths.voice, { name: voice, ...charVars(row.a1) })
            voiceRows += 1
            if (src) { emit({ op: 'voice', src }); voiceFound += 1 } else miss('voice', voice)
          }
          const who = row.a1 ? (asChar ? nameOf(str(asChar[1]).trim()) : nameOf(row.a1)) : ''
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
        case 'Se': { const src = soundFile(row.a1, paths.se); if (src) emit({ op: 'se', src }); else miss('se', row.a1); break }
        case 'BgSe': { const src = soundFile(row.a1, paths.bgse); if (src) emit({ op: 'bgse', src, loop: true }); else miss('bgse', row.a1); break }
        case 'StopBgSe': emit({ op: 'bgseStop' }); break
        case 'BgVoice': {
          const src = resolveWith(paths.bgvoice, { name: row.a1 })
          if (src) { emit({ op: 'bgvoice', slot: '1', src, volume: 1 }); bgvoiceOn = true } else miss('bgvoice', row.a1)
          break
        }
        case 'StopBgVoice': emit({ op: 'bgvoiceOff', slot: '1' }); bgvoiceOn = false; break
        case 'Wait': if (a6 > 0) emit({ op: 'wait', seconds: a6 }); break
        case 'FadeOut': emit({ op: 'fade', to: 'black', seconds: a6 }); blackOn = true; break
        case 'FadeIn': emit({ op: 'fade', to: 'clear', seconds: a6 }); blackOn = false; break
        case 'CharacterOff': {
          if (row.a1) {
            const slot = slotOf.get(row.a1)
            if (slot) { emit({ op: 'spineOff', slot }); stage.delete(slot); slotOf.delete(row.a1) }
          } else if (stage.size) { emit({ op: 'spineOff', prefix: o.slotPrefix }); stage.clear(); slotOf.clear() }
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
          if (/^(?:graphics|bg)$/i.test(row.a1)) emit({ op: 'shake', axis: x && y ? 'overall' : y ? 'vertical' : 'horizontal', strength: Math.max(x, y) / 40, seconds })
          else if (targetSlot(row.a1)) { const slot = targetSlot(row.a1); stats.spines += 1; emit(standOp(slot, stage.get(slot), { shake: { id: `s${bounceSeq++}`, x: x || 5, y: y || 5, seconds } })) }
          else raw(`Shake:${row.a1 ? '角色不在场' : '无目标'}`)
          break
        }
        case 'Sprite': sprite(row); break
        case 'SpriteOff': {
          if (o.spriteImages === false) { raw('SpriteOff'); break }   // 原版：目标为空什么都不做；有键 = 去掉它
          if (row.a1) emit({ op: 'overlayOff', slot: `spr_${row.a1}` })
          else ignore('SpriteOff(空)')
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
  // Sprite（原版 ApplyEffectSpineAnimation）：Arg1 = 键，Arg3 = 目标物体（Chara1~4），Arg4 / Arg5 = x / y（本地像素），SpineAnim = 动画，AnimCompType = Loop / Delete（1 秒后销毁）
  //   EM_xxx：目标的 Emotion 子物体（骨架 Adventure/Textures/Spines/Emote/EM_xxx），y = max(0, Arg5 − 130)，缩放 100（= 1 个骨架单位 1 像素）；ch_<id>_b / _f：目标的 b / f 子物体（骨架 Characters/ch_<id>/ch_<id>_b），不改 y
  //   其余（Title 之外）：键要在 Master 里是 Spine 才有效（AE_ 在这份 Master 里没有定义，BE_ 是图片 / 粒子）= 原版什么都不做，记 raw
  const effectFiles = (dir, base) => {
    const skel = `${dir}/${base}.skel.bytes`
    if (hasIndex) { const hit = lookup.find([skel], {}); return hit ? { skel: hit, atlas: `${dir}/${base}.atlas.txt` } : null }
    return { skel, atlas: `${dir}/${base}.atlas.txt` }
  }
  function sprite(row) {
    const key = row.a1
    if (key === 'Title') {   // 标题卡：Text = '标题,副标题,位置码'（原版交给 TitleManager）；这里显示成一句没有说话人的字
      const parts = row.text.split(',').map((part) => part.trim()).filter(Boolean)
      if (parts.length > 1 && /^[A-Za-z]$/.test(parts.at(-1))) parts.pop()
      if (parts.length) { emit({ op: 'speaker', segments: [] }); speaker = ''; emit({ op: 'text', segments: richText(parts.join('　')) }); pushStep() }
      return
    }
    if (!key) { raw('Sprite:(空)'); return }
    const target = /^Chara\d+$/.test(row.a3) ? row.a3 : slotOf.get(key) || ''
    const argX = numOrNull(row.a4)
    const argY = numOrNull(row.a5)
    const isEm = /^EM_/.test(key)
    const m = /^(ch_\d+)_([bf])$/.exec(key)
    // 普通图片（Master Texture 表里 Type = Sprite、FileName 是图片：BgParts / EffectF 层上的前景、遮挡图）：叠在背景之上（透明 png），SpriteOff <键> 去掉
    const tex = master?.textures.get(key)
    if (o.spriteImages !== false && !isEm && !m && tex && /\.(?:png|jpe?g|webp)$/i.test(tex.file || '')) {
      const src = resolveBg(key)
      if (!src) return
      stats.sprites = (stats.sprites || 0) + 1
      emit({ op: 'overlay', slot: `spr_${key}`, src, fit: 'cover', z: 1, ...(o.spriteImagesUnder === false ? {} : { under: true }), fade: secOf(row.a6) })
      return
    }
    if (!isEm && !m) { raw(`Sprite:${/^(AE|BE)_/.test(key) ? key.slice(0, 2) : key}`); return }
    if (!target) { raw(`Sprite:${key}（没有目标）`); return }
    const files = isEm ? effectFiles('Adventure/Textures/Spines/Emote', key) : effectFiles(`Characters/${m[1]}`, key)
    if (!files) { miss('effect', key); return }
    const localY = isEm ? Math.max(0, (argY ?? 130) - 130) : argY ?? 0
    const slot = isEm ? `${target}Emote` : `${target}${m[2]}`
    const loop = /^loop$/i.test(row.compType)
    const del = /^delete$/i.test(row.compType)
    stats.spines += 1
    emit({ op: 'spine', slot, kind: 'chara', skel: files.skel, atlas: files.atlas, anim: row.anim, loop: isEm ? true : loop || !del, speed: 1, place: { x: argX ?? 0, y: 120 + localY, scale: 1 }, stage: [screenWidth, Math.round(screenWidth * 9 / 16)], ...(del ? { ttl: 1 } : {}) })
    if (del) liveEmotes.add(slot)
  }

  // Tween（原版 DialogueSystem.HandleTweenCommand，gal-samples21 反编译）：目标角色的 Chara 子物体的本地坐标（舞台像素）
  //   Arg3 = 'time=秒 x=… y=…'，Arg4 = 缓动（easeOutQuad / easeInQuad，其余线性），Arg5 = 'pingPong=次数'，WaitType = NoWait 时不等它播完
  //   pingPong > 0：按 (x, y) 位移来回 次数 段（每段 time 秒，奇数次最后一段走完回原位），位置不变
  //   MoveBy / MoveTo（不是 pingPong）：时长 = time / 2；MoveBy = 相对位移，MoveTo = 绝对本地坐标；没写的轴不动；走完记下横向偏移（后面的台词行沿用），纵向偏移到该角色下一句台词为止
  //   ColorTo / ScaleTo / RotateTo 原版没有处理（记 raw）
  let bounceSeq = 0
  function tween(row) {
    const kv = keyValues(row.a3)
    const slot = targetSlot(row.a1)
    const mode = row.a2
    if (!slot) { raw(`Tween:${mode || '(空)'}（角色不在场）`); return }
    const entry = stage.get(slot)
    const x = numOrNull(kv.x)
    const y = numOrNull(kv.y)
    const time = secOf(kv.time, 0.5)
    const pingPong = /^pingPong=(\d+)/i.exec(row.a5)
    const waits = !/^nowait$/i.test(row.waitType)
    if (pingPong && Number(pingPong[1]) > 0) {
      const count = Number(pingPong[1])
      stats.spines += 1
      emit(standOp(slot, entry, { bounce: { id: `b${bounceSeq++}`, x: x ?? 0, y: y ?? 0, seconds: time, count, ease: row.a4 } }))
      if (waits) emit({ op: 'wait', seconds: time * count })
      return
    }
    if (!/^move(by|to)$/i.test(mode)) { raw(`Tween:${mode || '(空)'}`); return }
    const absolute = /^moveto$/i.test(mode)
    const cur = placeOf(entry)
    const baseY = (entry.master?.y || 0) - 10
    const baseX = entry.master?.x || 0
    // 本地坐标：x_local = cur.x，y_local = cur.y − 120（Characters 轴心在舞台中心上方 120）
    const targetX = x === null ? cur.x : absolute ? x : cur.x + x
    const targetLocalY = y === null ? cur.y - 120 : absolute ? y : cur.y - 120 + y
    const next = { ...entry, x: o.standX.slotBase + (targetX - baseX) / screenWidth, dy: (targetLocalY + 120) - baseY }
    stage.set(slot, next)
    lastStand.set(entry.key, { slot, x: next.x })
    stats.spines += 1
    const dur = time / 2
    emit(standOp(slot, next, dur > 0 ? { move: dur, ease: row.a4 } : {}))
    if (waits && dur > 0) emit({ op: 'wait', seconds: dur })
  }

  // 一个 book.json 里有几章（每个 grid = 一章，原版一章一章单独读）：
  //   脚本路径带 ::<章号>（从 1 数）= 只播这一章；不带 = 全部接起来播，章与章之间插一句「第 N 章」的分隔
  const only = Number(meta?.scene) >= 1 ? Math.floor(Number(meta.scene)) : 0
  if (only && !grids[only - 1]) throw new Error(`没有第 ${only} 章（这个文件有 ${grids.length} 章）`)
  grids.forEach((grid, gridIndex) => {
    if (only && gridIndex !== only - 1) return
    if (!only && gridIndex > 0 && grids.length > 1) { emit({ op: 'speaker', segments: [] }); emit({ op: 'text', segments: [{ text: `—— 第 ${gridIndex + 1} 章 ——` }] }); pushStep(); speaker = null }
    compileGrid(bookRows(grid), only ? 0 : gridIndex)
  })
  // 整个剧情的语音一条都没找到：逐条记「找不到」没有意义（TSK 的 9xxxxxx 角色剧情在磁盘上没有语音目录），合成一条说明
  if (hasIndex && voiceRows > 0 && voiceFound === 0) {
    for (const key of Object.keys(stats.unresolved)) if (key.startsWith('voice:')) delete stats.unresolved[key]
    stats.unresolved[`voice:该剧情没有语音目录（${voiceRows} 条语音一条也没找到）`] = voiceRows
  }
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
export const utageBookAdapter = { id: ADAPTER_ID, sceneInPath: true, health, label: 'Utage 剧情（*.book.json，Twinkle Star Knights X）', sniff, parse, contextFiles, contextDirs, contextWalkLimit, prepare, catalog }
