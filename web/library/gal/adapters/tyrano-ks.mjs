// 适配器：TyranoScript（.ks）脚本（Kamihime Player：game/dmm/raw_scenario/<类别>/<目录>/<id>_script.ks）→ 规范场景（gal-scene/1）。
// 这个格式的特点（照 Kamihime 的 3067 份脚本）：
//   *start / [call target=*start storage="tyrano.ks"]   脚本开头（sniff 认 *start + Tyrano 标签）；[position] [ptext] [chara_config] [call] [preload] 等界面设置不碰
//   [chara_new name= storage= jname=]                  声明角色：storage = 基础立绘（带 -<sha1>），jname = 显示名
//   [chara_face name= face= storage=]                  声明表情：一整张图（每个表情一个文件）；第一个带 hash，后面常常不带（fureafuarukon_01.png）
//   #<角色 key>                                        说话人标记（key → chara_new 的 jname；没声明的 key 原样当名字；单独一个 # = 旁白）
//   [chara_show name=] / [chara_mod name= face=] / [chara_hide name=]   立绘 = 一整张图 → stand 指令（和 legeclo 一样，部件带 align）；
//                                                      在场的角色按出场顺序摆：1 个居中，2 个左 / 右，3 个以上 左 / 中 / 右（脚本里的 left= / top= 不用，没有对照）
//   文字行 + [r]（换行）[l]（等点击）[cm]（清文本框）  非标签、非 # 行都是台词；[l] 结束一步，文本框内容 = 上次 [cm] 之后攒的全部文字；[cm] 前没有 [l] 的文字也算一步
//   [bg storage= time=]                                背景（black-<hash>.png / white-<hash>.png 直接当纯色，不查文件）；time（毫秒）→ 渐变
//   [playbgm storage=] / [stopbgm] / [fadeoutbgm]       bgm / bgmStop
//   [playse storage= loop=]                            loop=true → 背景音效声道（bgse），[stopse] 停它；否则：在 <resource_directory>/ 里的（h_get_* 这类语音）→ voice，别的 → se
//   [wait time=]                                       wait（毫秒 → 秒）
//   [quake count= time= hmax=|vmax=]                   shake（hmax 横 / vmax 竖，幅度按 1 像素 = 1/40）
//   [anim name=… top=|left=…]                          角色的跳 / 抖：连着的几条合成一个 shake（整个画面抖，不是只抖那个角色——没有单个立绘的动作指令）
//   [image storage="sepia_filter-<hash>.png" layer=4] / [freeimage layer=4] / [layopt layer=4 visible=]   整屏滤镜 → 当前背景的 over（再发一条 bg）；换背景时带着走
//   layer 3 上的角色（真实数据：[chara_show name= layer=3] → [chara_mod] → [anim layer=3 left="+=640" time=0] 跳到右边屏外 → [layopt layer=3 visible=true] → [anim layer=3 left="-=640" time=600] 0.6 秒滑入 → … → [freeimage layer=3] + [layopt layer=3 visible=false] 移除）：
//                                                      chara_show layer=3 照常是立绘；effect 层（layers.effect，默认 3）上的 [anim layer=3] / [layopt layer=3] 默认静默吃掉（effects.animSlide: 'ignore'，没有场景指令表达滑入；改 'raw' 记 raw）；
//                                                      [freeimage layer=N]（N 在 layers.stand 里，默认 3）去掉 shown 在这一层的角色（standOff / 重发剩下的立绘），其它层的立绘不动
//   Memorial 剧情（[mem_img] [mem_voice] [memorial]，options.memorial.enabled 默认开）：
//                                                      [mem_img for= storage= play_count=] → bg（带 memorial.imageFade 渐变），连着的几张每张一步（memorial.imageStep；4 张 = 幻灯片）；storage 走和 [bg] 一样的资源查找（带 hash / 不带）；
//                                                      [mem_voice for= storage= text=] → 一步：voice + 台词（说话人空；text 里字面的 \n（反斜杠 n）→ 换行；{{主人公}} 默认原样保留，memorial.protagonist 非空时替换）；语音缺 → 只记 stats.missing，台词照出；
//                                                      [memorial name=intro|main auto_next= random_voice=] → 段落标记：没写完的文本框先成一步、说话人清空，不记 raw（auto_next / random_voice 播放器没有对应，忽略）；用过的会在 stats.memorial 里记 sections / images / voices
//   其余的（[anim layer=…] 滑入 / 滑出（animSlide 为 raw 时）、[kanim] [keyframe] [frame]、[iscript] 块、没见过的标签）→ raw 原样保留，stats.raw 里有次数
//   [wa] [stopse] [cm] [position] [ptext] [chara_config] [call] [preload] [resetfont] [delay] 以及标签行外的注释（; 开头）静默忽略；[if] / [jump] / [glink] 等流程标签当 raw、脚本按顺序一路播下去
// 资源（相对资源根 game/dmm/assets）：
//   带 hash 的文件在 assets 平铺层，名字照抄（-<sha1>.<扩展名>）；找不到整名时按 stem（去掉 -<sha1>）再找一次
//   不带 hash 的：图片按「stem + 扩展名」在平铺层找 <stem>-<sha1>.<扩展名>；语音 / 音效先查这个脚本自己的 assets/<resource_directory>/<文件名>（resource_directory 在同目录的 <id>.json 里，不带 _script），
//   再按文件名在所有 resource_directory 里找（第一个）；都没有就算缺
//   缺文件都不致命：表情缺 → 退回这个角色的基础立绘；背景 / BGM 缺 → stats.unresolved（渲染诊断里能看到）；表情 / 语音 / 音效 / 滤镜缺 → 只记 stats.missing，不提示
// 列表（catalog）：raw_scenario 下的 类别 → 目录 → 剧情，剧情标题取同目录 json 的 title，is_r18 的带角标 R18。
// 参数全部来自 config.adapterOptions['tyrano-ks']（meta.options / prepare 的 options）；下面是完整的结构和默认值（默认 = 上面写的行为，不配就和以前一样）。
// 适配器只读配置、按配置匹配；路径 / 正则 / 命名规则 / 猜的摆放都放在这里（管理员脚本 gal-layout 的 LAYOUTS 表写这些），猜错了改配置，不改代码：
//   root: 'game/dmm'                       含 assets / raw_scenario 的目录（相对媒体目录）
//   resourceDirKey: { from: 'json', field: 'resource_directory', segments: 3 }
//                                          每个剧情的语音目录从哪取：同目录 json 的 field 字段；剧情和 json 用路径最后 segments 段（类别/目录/文件）对上
//   voice: { dirs: ['{rd}'], patterns: [], loopAsBgse: true }
//                                          dirs：这些 assets 下的目录里的 playse = voice（'{rd}' = 本剧情的 resource_directory，别的字符串 = 字面目录名）；也是按文件名找语音时的优先目录；
//                                          patterns：路径匹配任一正则（不分大小写）也算 voice；loopAsBgse：loop=true → bgse（false = 当普通 se / voice）
//   stand: { slots: { '1': [0.5], '2': [0.25, 0.75], '3+': [0.2, 0.5, 0.8] }, useScriptCoords: false }
//                                          slots：在场 n 个角色时每个的水平位置（0..1，按出场顺序；'N' = 恰好 N 个，按位置取；'N+' = N 个及以上，[第一个, 中间的, 最后一个]）；< 1/3 = left，> 2/3 = right，其余 center（部件的 align）
//                                          useScriptCoords：true = 用 [chara_show left= top=] 当部件的 x / y（没有 left= 的角色仍按 slots）。没有对照图，默认 false
//   layers: { overlay: ['4'], effect: ['3'], stand: ['3'] }
//                                          overlay：整屏滤镜层（[image] / [freeimage] / [layopt visible=] → 当前背景的 over）；effect：滑入滑出之类的效果层（见 effects.animSlide）；
//                                          stand：放角色的层（[chara_show layer=N] 记下角色在哪层；缺省是 0 层）。[freeimage layer=N] 对 stand 里的层 = 去掉 shown 在这层的角色（[] = 不处理，freeimage 照旧）。chara_show 在任何层上都是立绘，这个表只管 freeimage
//   effects: { quakeMap: { hmax: 'horizontal', vmax: 'vertical' }, shakeDivisor: 40, animHop: { top: 'vertical', left: 'horizontal' }, sepia: { matchImage: 'sepia' }, animSlide: 'ignore' }
//                                          quakeMap：[quake] 的属性 → shake 轴（按顺序，第一个出现的属性决定；都没有取第一项，幅度 0）；shakeDivisor：幅度像素 / 这个数 = strength（封顶 1）；
//                                          animHop：[anim name= top|left=] 的属性 → 抖动轴；sepia.matchImage：overlay 层上哪些图当滤镜（正则，空 = 都算）；
//                                          animSlide：'ignore'（默认）= [anim layer=…] 和 effect 层的 layopt / freeimage 静默吃掉（只对 effect 层；layer 3 的滑入 0.6 秒场景里没有对应指令）；'raw' = 记 raw（stats.raw 里有次数）；其它值 = 默认
//   fallback: { faceToBase: true }         表情图缺失 → 退回基础立绘（false = 这个角色这一次不出图）
//   index: { hashPattern: '^(.+)-[0-9a-f]{40}(\\.[^.]+)?$', stemFallback: true }
//                                          hashPattern：平铺层 <stem>-<sha1>.<ext> 的拆法（第 1 组 stem、第 2 组扩展名）；stemFallback：找不到整名时按 stem（去掉 hash）再找
//   memorial: { enabled: true, imageFade: 0.5, imageStep: true, protagonist: '', placeholder: '{{主人公}}' }
//                                          enabled：false = [mem_img] [mem_voice] [memorial] 记 raw（以前的行为）；imageFade：[mem_img] 的背景渐变秒数；imageStep：true = 每张图一步，false = 图都放进同一步（只有最后一张看得见）；
//                                          protagonist / placeholder：[mem_voice] 的 text 里的占位符（字面串）→ 替换成 protagonist（空串 = 不替换）
//   text: { lineBreakTags: ['r'], clickWaitTags: ['l'], pageTags: ['p'], clearTags: ['cm'] }
//                                          换行 / 等点击（结束一步）/ 翻页（结束一步并清框）/ 清文本框 的标签名
// 文件索引的查找走 createIndexResolver：config.resourceResolve（扩展名回退 / 改写 / unicode / 大小写 / preferDirs）自动生效，同名文件按 preferDirs 挑。

import { createIndexResolver } from '../resolve.mjs'
import { compileSafeRegex } from '../voice.mjs'

export const ADAPTER_ID = 'tyrano-ks'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => String(options?.root ?? 'game/dmm').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

// 独有写法：*start 标签 + Tyrano 的标签（chara_new / call tyrano.ks / position / ptext …）
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 8192)
  // 胶片剧情（_script.json）：JSON 数组，每段有 film / fps / talk（只读了开头 8KB，不能整个 parse，按字段名认）
  if (/^\s*\[\s*\{/.test(head) && /"film"\s*:/.test(head) && /"fps"\s*:/.test(head) && /"talk"\s*:/.test(head)) return true
  return /^\s*\*start\b/m.test(head) && /\[(?:chara_new|chara_config|chara_show|ptext|position|playbgm|bg|call)\b/.test(head)
}

// ---------- 上下文：assets 文件索引 + 每个剧情 json 里的 resource_directory / 标题 ----------
export const contextFiles = () => []
export const contextDirs = (options) => [joinPath(rootOf(options), 'assets'), joinPath(rootOf(options), 'raw_scenario'), joinPath(rootOf(options), 'portrait')]
export const contextTextFilter = (options) => {
  const prefix = `${joinPath(rootOf(options), 'raw_scenario')}/`
  return (rel) => rel.startsWith(prefix) && /\.json$/i.test(rel)
}
export const contextWalkLimit = 800000    // assets 平铺 1.1 万个 + 5000 多个 resource_directory 子目录，比默认的 40 万个文件多一点余量
export const contextSampleLimit = 20000   // 3067 个剧情各一个 json，超过默认的 3000

// ---------- 参数（只读配置，补满默认值；同一个 options 对象只算一次）----------
const isObj = (value) => value && typeof value === 'object' && !Array.isArray(value)
const strList = (value, fallback) => (Array.isArray(value) ? value.map(String).filter(Boolean) : fallback)
const tagSet = (value, fallback) => new Set(strList(value, fallback).map((tag) => tag.toLowerCase()))
const regexOf = (source, fallback, flags = 'i') => { try { return compileSafeRegex(source, { flags, label: 'tyrano pattern' }) } catch { return fallback } }
const DEFAULT_HASH = '^(.+)-[0-9a-f]{40}(\\.[^.]+)?$'
const DEFAULT_SLOTS = { 1: [0.5], 2: [0.25, 0.75], '3+': [0.2, 0.5, 0.8] }
// 完整的默认参数表（= 上面注释里的结构 + 不配时的行为）。gal-layout 的 ADAPTER_RULES 抄一份写进条目 config；scripts/dev/gal-layout-rules-selftest.mjs 保证两边一致
export const DEFAULT_OPTIONS = {
  root: 'game/dmm',
  resourceDirKey: { from: 'json', field: 'resource_directory', segments: 3 },
  voice: { dirs: ['{rd}'], patterns: [], loopAsBgse: true },
  stand: { slots: structuredClone(DEFAULT_SLOTS), useScriptCoords: false },
  layers: { overlay: ['4'], effect: ['3'], stand: ['3'] },
  effects: { quakeMap: { hmax: 'horizontal', vmax: 'vertical' }, shakeDivisor: 40, animHop: { top: 'vertical', left: 'horizontal' }, sepia: { matchImage: 'sepia' }, animSlide: 'ignore' },
  fallback: { faceToBase: true },
  index: { hashPattern: DEFAULT_HASH, stemFallback: true },
  memorial: { enabled: true, imageFade: 0.5, imageStep: true, protagonist: '', placeholder: '{{主人公}}' },
  text: { lineBreakTags: ['r'], clickWaitTags: ['l'], pageTags: ['p'], clearTags: ['cm'] },
  film: { enabled: true, frameRatio: 1.40625, rotate: 90, autoFrames: 16, transitions: { whiteout2s: { op: 'wash', color: 'white', seconds: 2 } } },
}
// 胶片剧情（<id>_harem-character_script.json）的参数：frameRatio = 胶片一帧的高 / 宽（文件里每帧 640×900）；rotate = 90：胶片是逆时针转了 90° 存的（作者的 2_build_rpy.py：Rotozoom(文件, 90)，Filmstrip 一帧 900×640、16×1），显示时转回来；0 = 不转；autoFrames = 不循环的自动段按几帧算时长（帧数要看图的高度，适配器读不到图，样本里都是 16 帧）；
// transitions = 段里 transition 字段的名字 → 一条指令（wash / fade / flash）；没列出的名字记 raw
const FILM_OPS = new Set(['wash', 'fade', 'flash'])
function filmSettings(value) {
  const o = isObj(value) ? value : {}
  const ratio = Number(o.frameRatio)
  const frames = Math.floor(Number(o.autoFrames))
  const given = isObj(o.transitions) ? o.transitions : DEFAULT_OPTIONS.film.transitions
  const transitions = {}
  for (const [name, command] of Object.entries(given)) if (isObj(command) && FILM_OPS.has(command.op)) transitions[name] = command
  return { enabled: o.enabled !== false, frameRatio: ratio > 0 ? ratio : 1.40625, rotate: Number(o.rotate) === 0 ? 0 : 90, autoFrames: frames > 0 ? frames : 16, transitions }
}
const settingsCache = new WeakMap()
function settingsOf(options) {
  const o = isObj(options) ? options : {}
  if (settingsCache.has(o)) return settingsCache.get(o)
  const key = isObj(o.resourceDirKey) ? o.resourceDirKey : {}
  const slots = {}
  for (const [name, list] of Object.entries(isObj(o.stand?.slots) ? o.stand.slots : DEFAULT_SLOTS)) {
    const fractions = Array.isArray(list) ? list.map(Number).filter(Number.isFinite) : []
    if (/^\d+\+?$/.test(name) && fractions.length) slots[name] = fractions
  }
  const quake = isObj(o.effects?.quakeMap) && Object.keys(o.effects.quakeMap).length ? o.effects.quakeMap : { hmax: 'horizontal', vmax: 'vertical' }
  const hop = isObj(o.effects?.animHop) && Object.keys(o.effects.animHop).length ? o.effects.animHop : { top: 'vertical', left: 'horizontal' }
  const out = {
    keyField: String(key.field || 'resource_directory'),
    keySegments: Math.max(1, Math.min(8, Math.floor(Number(key.segments)) || 3)),
    voice: { dirs: strList(o.voice?.dirs, ['{rd}']), patterns: strList(o.voice?.patterns, []).map((p) => regexOf(p, null)).filter(Boolean), loopAsBgse: o.voice?.loopAsBgse !== false },
    slots: Object.keys(slots).length ? slots : DEFAULT_SLOTS,
    useScriptCoords: o.stand?.useScriptCoords === true,
    overlayLayers: new Set(strList(o.layers?.overlay, ['4'])),
    effectLayers: new Set(strList(o.layers?.effect, ['3'])),
    standLayers: new Set(strList(o.layers?.stand, ['3'])),
    quakeMap: Object.entries(quake),
    shakeDivisor: Number(o.effects?.shakeDivisor) > 0 ? Number(o.effects.shakeDivisor) : 40,
    animHop: hop,
    sepia: regexOf(o.effects?.sepia?.matchImage ?? 'sepia', /sepia/i) || /(?:)/,   // 空串 = overlay 层上的图都算
    ignoreSlide: o.effects?.animSlide !== 'raw',   // 默认 'ignore'；只有 'raw' 才记 raw
    memorial: { enabled: o.memorial?.enabled !== false, imageFade: Number.isFinite(Number(o.memorial?.imageFade)) && o.memorial?.imageFade !== null && o.memorial?.imageFade !== '' ? Math.max(0, Math.min(10, Number(o.memorial.imageFade))) : 0.5, imageStep: o.memorial?.imageStep !== false, protagonist: typeof o.memorial?.protagonist === 'string' ? o.memorial.protagonist : '', placeholder: typeof o.memorial?.placeholder === 'string' ? o.memorial.placeholder : '{{主人公}}' },
    faceToBase: o.fallback?.faceToBase !== false,
    hash: regexOf(o.index?.hashPattern ?? DEFAULT_HASH, regexOf(DEFAULT_HASH, null, 'i'), 'i'),
    stemFallback: o.index?.stemFallback !== false,
    film: filmSettings(o.film),
    lineBreak: tagSet(o.text?.lineBreakTags, ['r']), clickWait: tagSet(o.text?.clickWaitTags, ['l']), page: tagSet(o.text?.pageTags, ['p']), clear: tagSet(o.text?.clearTags, ['cm']),
  }
  settingsCache.set(o, out)
  return out
}
// 在场 n 个角色时第 i 个的水平位置（0..1）：'n' 精确（按位置取）→ 最大的 'N+'（N ≤ n；[第一个, 中间的, 最后一个]）
function slotFraction(slots, n, i) {
  const exact = slots[String(n)]
  if (exact) return exact[i] ?? exact[exact.length - 1]
  const more = Object.keys(slots).filter((k) => k.endsWith('+') && Number.parseInt(k, 10) <= n).sort((x, y) => Number.parseInt(y, 10) - Number.parseInt(x, 10))[0]
  const list = more ? slots[more] : [0.5]
  return i === n - 1 ? list[list.length - 1] : list[Math.min(i, Math.max(0, list.length - 2))]
}
const alignOf = (fraction) => (fraction < 1 / 3 ? 'left' : fraction > 2 / 3 ? 'right' : 'center')

const lower = (text) => String(text).toLowerCase()
// 剧情脚本 / json 的键：路径最后 N 段（类别 / 目录 / 文件），去掉 _script 和扩展名——脚本和 json 的前缀不一样（相对脚本根 / 相对媒体目录），只看最后几段
const scriptKey = (rel, segments = 3) => String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-segments).join('/').replace(/(?:_script)?\.[^./]+$/, '')

// 胶片剧情：JSON 数组、元素里有 film 字段（<id>_harem-character_script.json）；不是就 null
function filmOf(text) {
  const head = String(text || '').replace(/^﻿/, '').trimStart()
  if (!head.startsWith('[')) return null
  try {
    const data = JSON.parse(head)
    return Array.isArray(data) && data.length && data.every(isObj) && data.some((seg) => 'film' in seg) ? data : null
  } catch { return null }
}

function readMeta(text, field) {
  try {
    const data = JSON.parse(String(text || '').replace(/^﻿/, ''))
    return { rd: String(data?.[field] || ''), title: String(data?.title || ''), r18: Boolean(data?.is_r18), summary: String(data?.summary || '') }
  } catch {   // 只读了开头 24KB 被截断：退回用正则取 resource_directory / title
    const t = String(text || '')
    const fieldRe = new RegExp(`"${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"([^"]*)"`)
    return { rd: fieldRe.exec(t)?.[1] || '', title: /"title"\s*:\s*"([^"]*)"/.exec(t)?.[1] || '', r18: /"is_r18"\s*:\s*true/.test(t), summary: '' }
  }
}

export function prepare({ options, texts, files, toResourcePath }) {
  const toRes = toResourcePath || ((rel) => rel)
  const st = settingsOf(options)
  const assets = `${joinPath(rootOf(options), 'assets')}/`
  const scenarioDir = `${joinPath(rootOf(options), 'raw_scenario')}/`
  const flat = new Map()        // 文件名 → 资源路径（assets 平铺层）
  const stems = new Map()       // <stem><扩展名>（去掉 -<sha1>）→ 资源路径
  const stemsAny = new Map()    // <stem>（不要扩展名）→ 资源路径
  const rdFiles = new Map()     // <resource_directory>/<文件名> → 资源路径
  const portraitDir = `${joinPath(rootOf(options), 'portrait')}/`
  const portraits = new Map()   // 角色头像：<portrait/ 下的文件名，无扩展名> → 资源路径（目录卡片的缩略图，按目录名找）
  const scripts = []            // raw_scenario 下的 .ks（相对媒体目录）
  for (const rel of files || []) {
    if (rel.startsWith(assets)) {
      const rest = rel.slice(assets.length)
      const slash = rest.indexOf('/')
      if (slash < 0) {
        flat.set(rest, toRes(rel))
        const m = st.hash.exec(rest)
        if (m) {
          if (!stemsAny.has(m[1])) stemsAny.set(m[1], toRes(rel))
          const name = m[1] + (m[2] || '')
          if (!stems.has(name)) stems.set(name, toRes(rel))
        }
      } else if (!rdFiles.has(`${rest.slice(0, slash)}/${rest.slice(rest.lastIndexOf('/') + 1)}`)) rdFiles.set(`${rest.slice(0, slash)}/${rest.slice(rest.lastIndexOf('/') + 1)}`, toRes(rel))
    } else if (rel.startsWith(portraitDir) && /\.(?:png|jpe?g|webp)$/i.test(rel) && !rel.slice(portraitDir.length).includes('/')) {
      const name = rel.slice(portraitDir.length).replace(/\.[^.]+$/, '')
      if (!portraits.has(name)) portraits.set(name, toRes(rel))
    } else if (rel.startsWith(scenarioDir) && /(?:\.ks|_script\.json)$/i.test(rel)) scripts.push(rel)   // .ks = 开场 / 对话；_script.json = 后面的 H 场景（胶片剧情）
  }
  const meta = new Map()   // 剧情键 → { rd, title, r18, summary }
  for (const [rel, text] of Object.entries(texts || {})) if (rel.startsWith(scenarioDir) && !/_script\.json$/i.test(rel)) meta.set(scriptKey(rel, st.keySegments), readMeta(text, st.keyField))
  return { flat, stems, stemsAny, rdFiles, scripts, portraits, meta, scenarioDir, keySegments: st.keySegments, hash: st.hash, hasIndex: Boolean(files?.length) }
}

// 内存索引的查找器（ctx 重建 / config.resourceResolve 变了就换新的）
const resolverCache = new WeakMap()
function resolversOf(ctx, cfg) {
  let hit = resolverCache.get(ctx)
  if (!hit || hit.cfg !== cfg) {
    const make = (index) => createIndexResolver({ index, cfg })
    hit = { cfg, flat: make(ctx.flat), stems: make(ctx.stems), stemsAny: make(ctx.stemsAny), rd: make(ctx.rdFiles) }
    resolverCache.set(ctx, hit)
  }
  return hit
}

// ---------- 列表（catalog）：类别 → 目录 → 剧情 ----------
const natural = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
const catalogCache = new WeakMap()   // ctx → 目录树（3000 多个剧情，建一次够了；ctx 在文件变化时会重建）
export function catalog(ctx) {
  if (!ctx?.scripts?.length) return null
  if (!catalogCache.has(ctx)) catalogCache.set(ctx, buildCatalog(ctx))
  return catalogCache.get(ctx)
}
// 角色目录名（[愛運ぶ天使]サマエル / ソル[神化覚醒] / 名字）→ portrait/ 里的头像：名字原样 → 去掉开头的 [称号] → 去掉结尾的 [称号] → 两头都去掉（gal-samples16：348 个目录里 303 个能对上）
function portraitOf(ctx, name) {
  if (!ctx.portraits?.size) return ''
  const stripped = name.replace(/^\[[^\]]*\]/, '')
  // 目录名 [称号]名 / 名[称号]，头像文件名是 (称号)名.png / 名(称号).png / 名.png（真实清单 3658 个，括号是半角圆括号）：原样、去掉称号、方括号换成圆括号都试
  const round = (text) => text.replace(/^\[([^\]]*)\]/, '($1)').replace(/\[([^\]]*)\]$/, '($1)')
  for (const candidate of [name, round(name), stripped, name.replace(/\[[^\]]*\]$/, ''), stripped.replace(/\[[^\]]*\]$/, '')]) if (candidate && ctx.portraits.has(candidate)) return ctx.portraits.get(candidate)
  return ''
}
function buildCatalog(ctx) {
  const root = { children: [] }
  const dirs = new Map()   // 目录 id → 节点
  for (const rel of [...ctx.scripts].sort(natural)) {
    const parts = rel.slice(ctx.scenarioDir.length).split('/')
    const file = parts.pop()
    let holder = root
    let id = ''
    for (const part of parts) {
      id = id ? `${id}/${part}` : part
      let node = dirs.get(id)
      if (!node) {
        node = { id, title: part, children: [] }
        const portrait = portraitOf(ctx, part)
        if (portrait) node.thumb = portrait
        dirs.set(id, node); holder.children.push(node)
      }
      holder = node
    }
    const info = ctx.meta.get(scriptKey(rel, ctx.keySegments))
    const stem = file.replace(/(?:_script)?\.(?:ks|json)$/i, '')
    holder.children.push({ id: `s:${rel}`, title: info?.title || stem, subtitle: info?.title ? stem : '', badge: info?.r18 ? 'R18' : '', script: rel })
  }
  for (const node of dirs.values()) node.subtitle = `${node.children.length} 项`
  return root
}

// 体检（列表页的渲染诊断）：没读到 assets 索引 / 没有剧情 json
export function health(ctx) {
  const out = []
  if (!ctx?.hasIndex || !ctx.flat.size) out.push({ level: 'warn', code: 'tyrano-assets-empty', message: '没读到 assets 下的文件（检查 adapterOptions[\'tyrano-ks\'].root，默认 game/dmm）：背景 / 立绘 / 语音都会找不到' })
  if (ctx?.scripts?.length && !ctx.meta.size) out.push({ level: 'warn', code: 'tyrano-json-empty', message: '剧情脚本旁边没有读到 .json（resource_directory / 标题）：语音只能按文件名找，标题用脚本名' })
  return out
}

// ---------- 标签解析 ----------
// 一行拆成 [{ tag, attrs, raw }] 和文字片段 { text }；引号里的 ] 不算结束；没有 ] 的标签（[stopse）吃到行尾；标签里再遇到 [ 就在那里结束（[stopbgm[[playbgm …]）
function tokenize(line) {
  const out = []
  let i = 0
  let buf = ''
  const pushText = () => { if (buf) { out.push({ text: buf }); buf = '' } }
  while (i < line.length) {
    const ch = line[i]
    if (ch !== '[') { buf += ch; i += 1; continue }
    if (line[i + 1] === '[' && !/^\[\[\s*[A-Za-z_]/.test(line.slice(i))) { buf += '['; i += 2; continue }   // [[ = 文字里的 [（后面不是标签名的时候）
    pushText()
    i += 1
    while (line[i] === '[') i += 1
    let inner = ''
    let quote = false
    while (i < line.length) {
      const c = line[i]
      if (c === '"') quote = !quote
      if (!quote && (c === ']' || c === '[')) break
      inner += c
      i += 1
    }
    if (line[i] === ']') i += 1
    const m = /^\s*(;|[\w.-]+)\s*([\s\S]*)$/.exec(inner)
    if (!m) continue
    out.push({ tag: m[1].toLowerCase(), raw: m[2].trim(), attrs: attrsOf(m[2]) })
  }
  pushText()
  return out
}

function attrsOf(text) {
  const attrs = {}
  const re = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g
  let m
  while ((m = re.exec(String(text || '')))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return attrs
}

const secs = (ms, fallback = 0, max = 60) => { const n = Number.parseFloat(ms); return Number.isFinite(n) ? Math.max(0, Math.min(max, n / 1000)) : fallback }
const delta = (value) => { const n = Number.parseFloat(String(value ?? '').replace(/^[+-]=/, '')); return Number.isFinite(n) ? n : 0 }
const baseName = (storage) => String(storage ?? '').replace(/\\/g, '/').split('/').pop().trim()
const SILENT = new Set(['wa', 'wb', 'ws', 'cm', 'clearfix', 'er', 'nolog', 'endnolog', 'position', 'ptext', 'chara_config', 'call', 'preload', 'resetfont', 'delay', 'font', 'ct', 'trans', 'hidemessage', 'showmessage', 'chara_layer', 'chara_part', 'macro', 'endmacro', ';'])

export function parse(text, ctx = null, meta = {}) {
  const steps = []
  let current = []
  const stats = { commands: 0, raw: {}, unresolved: {}, missing: {}, fallbacks: {}, stands: 0 }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const emit = (command) => { current.push(command) }
  const st = settingsOf(meta?.options)
  const info = ctx?.meta?.get(scriptKey(meta?.rel || '', ctx.keySegments || st.keySegments))   // 同目录 json：resource_directory / 标题
  const index = Boolean(ctx?.hasIndex)
  const hashRe = ctx?.hash || st.hash
  const rdDirs = st.voice.dirs.map((dir) => dir.replace(/\{rd\}/g, info?.rd || '')).map((dir) => dir.replace(/^\/+|\/+$/g, '')).filter(Boolean)   // 语音目录（'{rd}' 没有 json 时为空，被丢掉）
  const resolvers = index ? resolversOf(ctx, meta?.config?.resourceResolve) : null
  const via = (resolver, map, key) => { const hit = resolver.resolve(key); return hit ? map.get(hit) : '' }

  // ---- 资源查找（返回相对资源根的路径，找不到返回 ''）----
  // kind：'image'（带 hash 的整名 → stem 退一步；不带的按 stem + 扩展名）/ 'audio'（先查本剧情的语音目录，再按文件名查所有 resource_directory）
  const find = (storage, kind = 'image') => {
    const name = baseName(storage)
    if (!name) return ''
    if (!index) return kind === 'audio' && rdDirs.length && !hashRe.test(name) ? `${rdDirs[0]}/${name}` : name
    const whole = via(resolvers.flat, ctx.flat, name)
    if (whole) return whole
    const m = hashRe.exec(name)
    if (m) return st.stemFallback ? via(resolvers.stems, ctx.stems, m[1] + (m[2] || '')) : ''
    if (kind === 'audio') {
      for (const dir of rdDirs) { const hit = via(resolvers.rd, ctx.rdFiles, `${dir}/${name}`); if (hit) return hit }
      const byName = resolvers.rd.resolveByName(name)
      return (byName && ctx.rdFiles.get(byName)) || (st.stemFallback ? via(resolvers.stems, ctx.stems, name) : '')
    }
    return st.stemFallback ? via(resolvers.stems, ctx.stems, name) || via(resolvers.stemsAny, ctx.stemsAny, name.replace(/\.[^.]+$/, '')) : ''
  }
  const isVoice = (path) => { const low = lower(path); return rdDirs.some((dir) => low.startsWith(`${lower(dir)}/`)) || st.voice.patterns.some((re) => re.test(path)) }

  // ---- 胶片剧情（<id>_harem-character_script.json）：数组，每段 { fps, auto, film, talk: [{ chara, words, voice? }], bgm?, repeat?, stay?, transition? } ----
  // film = 一张竖排的胶片图（样本：640×14400 = 16 帧 640×900；640×900 = 单帧），在 resource_directory 目录里；fps 是播放帧率（1 = 静图）；每句 talk = 一步（点一下）。
  // auto = true 且没有台词的段：不等点击，播完（repeat = false 时按 autoFrames / fps，再加 stay）自动进下一段——这些指令并进下一步的开头；transition 按表（whiteout2s = 白场渐出）。
  const filmSegments = filmOf(text)
  if (filmSegments) {
    if (!st.film.enabled) { count('raw', 'film-script'); return { steps: [{ index: 0, commands: [{ op: 'text', segments: [] }] }], stats } }
    const toSeconds = (value) => { const m = /^\s*([0-9.]+)\s*(ms|s)?\s*$/i.exec(String(value ?? '')); return m ? (m[2]?.toLowerCase() === 'ms' ? Number(m[1]) / 1000 : Number(m[1])) : 0 }
    let curSpeaker = ''
    for (const seg of filmSegments) {
      const src = seg.film ? find(String(seg.film), 'audio') : ''
      const fps = Number(seg.fps) > 0 ? Number(seg.fps) : 1
      const loop = seg.repeat !== false
      if (seg.bgm) { const bgm = find(String(seg.bgm), 'audio'); if (bgm) emit({ op: 'bgm', src: bgm }); else count('missing', `bgm:${seg.bgm}`) }
      if (src) emit({ op: 'bg', src, fade: 0, film: { ratio: st.film.frameRatio, fps, loop, ...(st.film.rotate ? { rotate: st.film.rotate } : {}) } })
      else if (seg.film) count('unresolved', `film:${seg.film}`)
      if (seg.transition) {
        const transition = st.film.transitions[seg.transition]
        if (transition) emit({ ...transition })
        else count('raw', `film:transition:${seg.transition}`)
      }
      const lines = (Array.isArray(seg.talk) ? seg.talk : []).filter((t) => isObj(t) && (String(t.words || '').trim() || String(t.chara || '').trim() || t.voice))
      for (const t of lines) {
        const voice = t.voice ? find(String(t.voice), 'audio') : ''
        if (voice) emit({ op: 'voice', src: voice }); else if (t.voice) count('missing', `voice:${t.voice}`)
        const who = String(t.chara || '')
        if (who !== curSpeaker) { emit({ op: 'speaker', segments: who ? [{ text: who }] : [] }); curSpeaker = who }
        emit({ op: 'text', segments: String(t.words || '') ? [{ text: String(t.words) }] : [] })
        stats.commands += current.length
        steps.push({ index: steps.length, commands: current })
        current = []
      }
      if (!lines.length) {
        const seconds = (loop ? 0 : st.film.autoFrames / fps) + toSeconds(seg.stay)
        emit({ op: 'wait', seconds: Math.min(60, seconds > 0 ? seconds : 1) })
      }
    }
    if (current.length) { if (steps.length) { steps[steps.length - 1].commands.push(...current); stats.commands += current.length } else steps.push({ index: 0, commands: [...current, { op: 'text', segments: [] }] }) }
    stats.film = filmSegments.length
    return { steps, stats }
  }

  // ---- 状态 ----
  const chars = new Map()        // key → { jname, base（基础立绘路径或 ''）, faces: Map(face → storage), face（当前表情的路径） }
  const shown = []               // 在场角色 key（出场顺序）
  const charLayer = new Map()    // 角色 key → [chara_show layer=] 的层（缺省 '0'）
  let standOn = false
  let standDirty = false
  let speaker = ''               // 当前 # 说话人的显示名
  let emittedSpeaker = ''
  let windowText = ''            // 文本框里现在的文字（[cm] 清掉）
  let unclicked = false          // 文本框里有还没成一步（没遇到 [l]）的新文字
  let curBg = null               // 当前背景指令（{ src } 或 { color }），滤镜 over 要重发它
  let overlay = ''               // 整屏滤镜（layer 4）的图
  let overlayVisible = true
  let looping = false            // 背景音效声道在响
  let hop = null                 // 连着的 [anim name=…] 攒成一个 shake
  let inScript = false

  const charOf = (key) => {
    const k = lower(key)
    if (!chars.has(k)) chars.set(k, { jname: '', base: '', faces: new Map(), face: '' })
    return chars.get(k)
  }
  const flushStand = () => {
    if (!standDirty) return
    standDirty = false
    const parts = []
    shown.forEach((key, i) => {
      const c = chars.get(key)
      const src = st.faceToBase ? c?.face || c?.base : c?.face
      if (!src) return
      const at = st.useScriptCoords ? c.pos : null
      parts.push(at ? { src, x: at.x, y: at.y } : { src, align: alignOf(slotFraction(st.slots, shown.length, i)) })
    })
    if (parts.length) { emit({ op: 'stand', parts }); standOn = true; stats.stands += 1 } else if (standOn) { emit({ op: 'standOff' }); standOn = false }
  }
  const flushHop = () => {
    if (!hop) return
    emit({ op: 'shake', axis: hop.axis, strength: Math.min(1, Math.max(0.05, hop.amp / 40)), seconds: Math.max(0.1, Math.min(3, hop.ms / 1000)) })
    hop = null
  }
  const emitBg = (fade = 0) => {
    if (!curBg) return
    emit({ op: 'bg', ...curBg, ...(overlay && overlayVisible ? { over: overlay } : {}), fade })
  }
  const raw = (cmd, attrsText) => { count('raw', cmd); emit({ op: 'raw', cmd, args: attrsText ? [attrsText] : [] }) }
  // 结束一步（[l]）：立绘 → 说话人 → 台词 → 切步
  const clickStep = () => {
    flushHop()
    const body = windowText.replace(/^\n+|\n+$/g, '')
    if (!body && !current.length) return
    flushStand()
    if (speaker !== emittedSpeaker) { emit({ op: 'speaker', segments: speaker ? [{ text: speaker }] : [] }); emittedSpeaker = speaker }
    emit({ op: 'text', segments: body ? [{ text: body }] : [] })
    unclicked = false
    stats.commands += current.length
    steps.push({ index: steps.length, commands: current })
    current = []
  }
  const clearWindow = () => {   // [cm]：文本框里还有没等点击的文字就先成一步，再清
    if (unclicked && windowText.replace(/\n/g, '').trim()) clickStep()
    windowText = ''
  }

  const handleTag = ({ tag, attrs, raw: rawText }) => {
    if (tag !== 'anim') flushHop()
    switch (tag) {
      case 'chara_new': {
        const c = charOf(attrs.name || '')
        c.jname = attrs.jname || ''
        const src = find(attrs.storage)
        c.base = src
        c.face = src
        if (!src && attrs.storage) count(index ? 'unresolved' : 'missing', `chara:${baseName(attrs.storage)}`)
        break
      }
      case 'chara_face': {
        const c = charOf(attrs.name || '')
        if (attrs.face) c.faces.set(attrs.face, attrs.storage || '')
        break
      }
      case 'chara_show': {
        const key = lower(attrs.name || '')
        if (!key) break
        if (!shown.includes(key)) shown.push(key)
        charLayer.set(key, String(attrs.layer ?? '0'))
        if (Number.isFinite(Number.parseFloat(attrs.left))) charOf(key).pos = { x: Number.parseFloat(attrs.left), y: Number.parseFloat(attrs.top) || 0 }
        standDirty = true
        break
      }
      case 'chara_hide': case 'chara_delete': {
        const at = shown.indexOf(lower(attrs.name || ''))
        if (at >= 0) { shown.splice(at, 1); standDirty = true }
        break
      }
      case 'chara_hide_all': if (shown.length) { shown.length = 0; standDirty = true } break
      case 'chara_mod': {
        const c = chars.get(lower(attrs.name || ''))
        if (!c || !attrs.face) break
        const storage = c.faces.get(attrs.face)
        let src = storage ? find(storage) : ''
        if (!src) {   // 表情文件缺（或没声明这个表情）：退回基础立绘（fallback.faceToBase）
          src = st.faceToBase ? c.base : ''
          count('fallbacks', `face:${storage ? baseName(storage) : attrs.face}`)
          if (storage) count('missing', `face:${baseName(storage)}`)
        }
        if (src !== c.face) { c.face = src; if (shown.includes(lower(attrs.name))) standDirty = true }
        break
      }
      case 'bg': {
        flushStand()
        const name = baseName(attrs.storage)
        const fade = secs(attrs.time)
        const colorOf = /^(black|white)-[0-9a-f]{40}\.\w+$/i.exec(name) || /^(black|white)\.\w+$/i.exec(name)
        if (colorOf) curBg = { color: lower(colorOf[1]) === 'black' ? [0, 0, 0] : [255, 255, 255] }
        else {
          const src = find(attrs.storage)
          if (src) curBg = { src }
          else { count('unresolved', `bg:${name}`); break }
        }
        emitBg(fade)
        break
      }
      case 'playbgm': case 'fadeinbgm': {
        const src = find(attrs.storage, 'audio')
        if (src) emit({ op: 'bgm', src })
        else count('unresolved', `bgm:${baseName(attrs.storage)}`)
        break
      }
      case 'stopbgm': case 'fadeoutbgm': emit({ op: 'bgmStop', fade: secs(attrs.time) }); break
      case 'playse': {
        const src = find(attrs.storage, 'audio')
        if (!src) { count('missing', `se:${baseName(attrs.storage)}`); break }
        if (st.voice.loopAsBgse && /^true$/i.test(attrs.loop || '')) { emit({ op: 'bgse', src, loop: true }); looping = true } else emit({ op: isVoice(src) ? 'voice' : 'se', src })
        break
      }
      case 'stopse': if (looping) { emit({ op: 'bgseStop' }); looping = false } break
      case 'wait': { const seconds = secs(attrs.time, 0, 30); if (seconds > 0) { flushStand(); emit({ op: 'wait', seconds }) } break }
      case 'quake': {
        flushStand()
        const [attr, axis] = st.quakeMap.find(([name]) => attrs[name] !== undefined) || [st.quakeMap[0][0], st.quakeMap[0][1]]
        emit({ op: 'shake', axis, strength: Math.min(1, Math.max(0.05, delta(attrs[attr]) / st.shakeDivisor)), seconds: Math.max(0.1, Math.min(5, secs(attrs.time, 0.3))) })
        break
      }
      case 'anim': {
        const move = Object.keys(st.animHop).find((name) => attrs[name] !== undefined) || ''
        if (attrs.name && !attrs.layer && move) {   // 角色的跳 / 抖：连着的合成一个 shake
          const amp = Math.abs(delta(attrs[move]))
          if (!hop) hop = { axis: st.animHop[move], amp: 0, ms: 0 }
          hop.amp = Math.max(hop.amp, amp)
          hop.ms += Number.parseFloat(attrs.time) || 0
        } else { flushHop(); if (!(st.ignoreSlide && st.effectLayers.has(String(attrs.layer)))) raw('anim', rawText) }   // layer 的滑入 / 滑出等
        break
      }
      case 'image': {
        if (st.overlayLayers.has(String(attrs.layer)) && st.sepia.test(attrs.storage || '')) {
          const src = find(attrs.storage)
          if (!src) { count('missing', `image:${baseName(attrs.storage)}`); break }
          overlay = src
          overlayVisible = true
          if (curBg) { flushStand(); emitBg(secs(attrs.time)) } else raw('image', rawText)
        } else raw('image', rawText)
        break
      }
      case 'freeimage': {
        const layer = String(attrs.layer)
        if (st.overlayLayers.has(layer)) { if (overlay) { overlay = ''; flushStand(); emitBg(secs(attrs.time)) } break }
        const onStand = st.standLayers.has(layer)
        if (onStand) {   // 这一层上的角色被清掉（别的层的立绘不动）
          const gone = shown.filter((key) => charLayer.get(key) === layer)
          if (gone.length) { for (const key of gone) shown.splice(shown.indexOf(key), 1); standDirty = true }
        }
        if (!(st.effectLayers.has(layer) ? st.ignoreSlide : onStand)) raw('freeimage', rawText)   // effect 层：animSlide 决定；否则 stand 层吃掉、别的层 raw
        break
      }
      case 'layopt': {
        if (st.overlayLayers.has(String(attrs.layer)) && attrs.visible !== undefined) {
          const visible = !/^false$/i.test(attrs.visible)
          if (visible !== overlayVisible) { overlayVisible = visible; if (overlay) emitBg(0) }
        } else if (!(st.ignoreSlide && st.effectLayers.has(String(attrs.layer)))) raw('layopt', rawText)
        break
      }
      case 'mem_img': case 'mem_voice': case 'memorial': {
        const mem = st.memorial
        if (!mem.enabled) { raw(tag, rawText); break }
        const sums = (stats.memorial ||= { sections: [], images: 0, voices: 0 })
        clearWindow()   // 没写完的文本框先成一步
        if (tag === 'memorial') { sums.sections.push(attrs.name || ''); speaker = ''; break }
        if (tag === 'mem_img') {
          const src = find(attrs.storage)
          if (!src) { count('unresolved', `mem_img:${baseName(attrs.storage)}`); break }
          flushStand()
          curBg = { src }
          emitBg(mem.imageFade)
          sums.images += 1
          if (mem.imageStep) { speaker = ''; windowText = ''; clickStep() }
          break
        }
        const src = find(attrs.storage, 'audio')
        flushStand()
        if (src) emit({ op: 'voice', src }); else if (attrs.storage) count('missing', `se:${baseName(attrs.storage)}`)
        let body = String(attrs.text ?? '').replace(/\\n/g, '\n')
        if (mem.protagonist && mem.placeholder) body = body.split(mem.placeholder).join(mem.protagonist)
        speaker = ''
        windowText = body
        clickStep()
        windowText = ''
        sums.voices += 1
        break
      }
      case 'iscript': inScript = true; raw('iscript', ''); break
      default:
        if (SILENT.has(tag)) break
        raw(tag, rawText)   // 流程标签（if / jump / glink …）、kanim / keyframe / frame / mem_* / 没见过的标签：原样保留，不丢也不炸
    }
  }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.replace(/^﻿/, '').trim()
    if (!line) continue
    if (inScript) { if (/\[endscript\]|^@endscript/i.test(line)) inScript = false; continue }   // [iscript] 块里是 JS
    if (line.startsWith(';') || line.startsWith('*')) continue   // 注释 / 标签（*start）
    if (line.startsWith('@')) line = `[${line.slice(1)}]`        // @tag 属性 = [tag 属性]
    if (line.startsWith('#')) {
      const key = line.slice(1).split(':')[0].trim()
      speaker = key ? chars.get(lower(key))?.jname || key : ''
      continue
    }
    for (const token of tokenize(line)) {
      if (token.text !== undefined) { windowText += token.text; if (token.text.trim()) unclicked = true; continue }
      const tag = token.tag
      if (st.lineBreak.has(tag)) windowText += '\n'
      else if (st.clickWait.has(tag)) clickStep()
      else if (st.page.has(tag)) { clickStep(); windowText = '' }
      else if (st.clear.has(tag)) clearWindow()
      else if (tag === 'endscript') inScript = false
      else handleTag(token)
      if (inScript) break
    }
  }
  flushHop()
  clearWindow()
  flushStand()
  // 最后一次点击之后剩下的指令并进最后一步，不单独成一步（否则末尾多一个空白的「点一下」）
  if (current.length) {
    if (steps.length) { steps[steps.length - 1].commands.push(...current); stats.commands += current.length } else steps.push({ index: 0, commands: [...current, { op: 'text', segments: [] }] })
  }
  return { steps, stats }
}

export const tyranoKsAdapter = { id: ADAPTER_ID, label: 'TyranoScript（Kamihime Player）', sniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare, catalog, health }
