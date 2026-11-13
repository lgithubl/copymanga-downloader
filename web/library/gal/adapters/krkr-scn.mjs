import{completeJsonSamples}from'../context-complete-json.mjs'
// 适配器：KiriKiri Z（Wamsoft，Hxv4 加密的 xp3）的场景脚本（scn.xp3 里的 PSB，由 containers.mjs 解密 + krkr-scn.mjs 压成 JSON）→ 规范场景（gal-scene/1）。
// id = krkr::scn：引擎家族 krkr 的脚本适配器，家族里所有游戏（game.id = krkr::<游戏>）共用。
//
// 输入：{"format":"krkr-scn/1","arc","name","scenes":[{label,title,nexts,steps:[{t,n,v,l,b,pre}]}]}
//   步：t = 台词（\n 换行）、n = 说话人、v = 语音名、l = 图层 [名字, 类别, 文件, options, posName, showmode(3 显示 / 0 隐藏), actions]、b = [bgm 文件, 状态(1 = 在放), 音量, 循环]、pre = [[命令, 参数…]]
// 映射：
//   台词 → speaker + text；语音 → voice；bgm 文件变了 / 状态 0 → 1 → bgm，状态变 0 → bgmStop；
//   图层 bg（stage，showmode 3）→ bg（文件 = 图名，图在 image.xp3 / data.xp3 里是 .png / .jpg；`width,1,height,1,color,0xff000000` 这种是纯色）；
//   图层 ev（event，showmode 3）= 事件 CG → 盖在 bg 上（当成 bg 换掉，去掉后回到背景；ev 的图取不到——mpg 视频、没采到——就退回背景）；
//     ev 是 .l2d（Live2D 模型包）→ live2d 指令（src = 虚拟的 <名字>.l2d/<名字>.model3.json；options 的 motion / loop / variables 原样带上），底下的背景照常显示；模型取不到记 unresolved；
//   pre 里的 wait → wait（秒，最多 10）；playvoice（背景语音 type 2）/ quake / stopvoice 不渲染，记 stats.ignored
//   多个 scene（脚本里的 *start / *dummy1 …）按顺序接在一起；最后一个 scene 的 nexts 指向别的脚本（不是 gameloop.txt 的菜单）→ scene.next
// 没做 / 推断：
//   立绘（class character，imageFile.file = cha001.stand + options { dress, face, pose, add }，showmode 3 = 显示）→ 每个角色一个槽位（slot = 角色名）的 stand：PIMG（cha001.pimg，分层 PSB，每层一张 TLG）按 options 选图层
//     （dress + pose → 身体、face、add 用 ':' 隔开的各项；映射表 = <名字>.sinfo.json，没有就按层名猜，见 krkr-pimg.mjs），每层一个部件，部件的位置 = 层在画布里的位置；containers 把 PIMG 虚拟成 <名字>.pimg.json（层表）和 <名字>.pimg/<层 id>.png（每层转好的 PNG）。
//     位置 / 缩放（照引擎的 TJS 字节码 + 脚本数据推的，见 krkrStandGeometry；没有对照截图，只做过统计验证）：画布中心 = 舞台中心 + f × (xpos + xoffset, ypos + yoffset) + (leveloffset 的 x, −y)，缩放 = f，
//     f = 100 ÷ (100 + zpos)（zpos −50 = 手前 = 2 倍，+51.5 = 奥 = 0.66 倍，0 = 前 = 1 倍；引擎里是透视投影，CAMERAOFFSETZ = −100）；xoffset / yoffset 来自 <名字>.stand；leveloffset = 脚本动作里的 `#x0,y0,x1,y1,…`（每个层级一对，按 zorder = 100 × f 在 [66, 100, 200, 225] 之间插值），没有就用 .stand 里的。
//     没有 zpos 时用 posName 的层级（奥 66 / 前 100 / 手前 200 / 目前 225），水平位置没有 xpos 就按 posName（左 −480 / 右 480 / 左中 −240 / 右中 240 / 左奥 −720 / 右奥 720 / 左外 −960 / 右外 960 / 中 0）。
//     没对过的：y 方向的符号（leveloffset 的 y 取负、ypos 取正是统计出来的：8 个角色的头顶落点最集中）、图是 1:1 贴到舞台（1920×1080）上的；order 只是绘制顺序。想调就用播放器「设置 → 画面 → 立绘」。
//   · 每步的图层是脚本自带的「此刻的环境快照」（texts[i][4].data），不重放 envupdate；没有台词也没有等待的画面变化会并进下一句
//   · 转场：envupdate 的 trans（crossfade / universal 遮罩擦除 / mosaic / ripple / rotateswap，时长毫秒）→ 换背景 / 事件图时的 fade 秒数（全部近似成淡入淡出，方式记 stats.transitions）；没写时长的转场不淡
//   · 镜头动作（xpos / ypos / zpos / zoom）不渲染：真实脚本里背景 / 事件图上没有 MoveAction（只有立绘上的 RandomAction / SinAction 抖动），静态的偏移 / 缩放量的原点和单位没法对照验证
import {krkrReadingGraph} from './krkr-reading-graph.mjs'
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'
import { pickPimgLayers } from '../krkr-pimg.mjs'

// 立绘几何（引擎 data.xp3 里的 TJS：KAGEnvImage / EnvGraphicBase.calcAffineMatrix / calcLevel / interlvoffset）
const KRKR_LEVELS = [66, 100, 200, 225]   // base.stage 同目录的配置里的 "levels"：层级号 ↔ zorder
export const KRKR_POS_X = Object.freeze({ 左外: -960, 左奥: -720, 左: -480, 左中: -240, 中: 0, 右中: 240, 右: 480, 右奥: 720, 右外: 960 })
const KRKR_POS_Z = Object.freeze({ 奥: 66, 前: 100, 手前: 200, 目前: 225 })
// 引擎的 calcLevel：zorder → { lv（上界层级号）, w（往下一层插值的权重）}
function krkrCalcLevel(z) {
  for (let i = 0; i < KRKR_LEVELS.length; i += 1) {
    if (z > KRKR_LEVELS[i]) continue
    if (i === 0) return { lv: 0, w: 0 }
    return { lv: i, w: 1 - (z - KRKR_LEVELS[i - 1]) / (KRKR_LEVELS[i] - KRKR_LEVELS[i - 1]) }
  }
  return { lv: KRKR_LEVELS.length + Math.trunc((z - KRKR_LEVELS[KRKR_LEVELS.length - 1]) / 50), w: 0 }
}
// 引擎的 interlvoffset：每个层级一对 (x, y)，按 zorder 在相邻两层之间插值
function krkrLevelOffset(pairs, z) {
  if (!pairs.length) return [0, 0]
  let { lv, w } = krkrCalcLevel(z)
  if (lv >= pairs.length) lv = pairs.length - 1
  let [x, y] = pairs[lv]
  if (w > 0 && lv > 0) { x = x * (1 - w) + pairs[lv - 1][0] * w; y = y * (1 - w) + pairs[lv - 1][1] * w }
  return [x, y]
}
// act = 脚本里这个角色的动作表（{ leveloffset: '#0,0,0,111,0,-10', xpos, ypos, zpos }）；stand = parseStandInfo 的结果（可空）；返回 { f（缩放）, cx, cy（画布中心，舞台坐标，左上角为原点）}
export function krkrStandGeometry({ act = {}, posName = null, stand = null, stage = [1920, 1080] }) {
  const zpos = Number(act.zpos)
  let f = Number.isFinite(zpos) && zpos > -99 ? 100 / (100 + zpos) : (KRKR_POS_Z[posName] ?? 100) / 100
  f = Math.max(0.2, Math.min(5, f))
  const z = 100 * f
  const text = String(act.leveloffset ?? '').replace(/^#/, '')
  const nums = text ? text.split(',').map(Number).filter((n) => Number.isFinite(n)) : []
  const pairs = nums.length >= 2 ? Array.from({ length: Math.floor(nums.length / 2) }, (_, i) => [nums[i * 2], nums[i * 2 + 1]]) : (stand?.leveloffset || [])
  const [lx, ly] = krkrLevelOffset(pairs, z)
  const xpos = Number(act.xpos)
  const x = Number.isFinite(xpos) ? xpos : KRKR_POS_X[posName] ?? 0
  const y = Number(act.ypos) || 0
  return { f, cx: stage[0] / 2 + f * (x + (stand?.xoffset || 0)) + lx, cy: stage[1] / 2 + f * (y + (stand?.yoffset || 0)) - ly }
}

export const ADAPTER_ID = 'krkr::scn'
export const DEFAULT_OPTIONS = {
  followGraph:false,
  eventClasses: ['event'],
  scriptDir:'',
  resDir: 'arc/res',
  stage: [1920, 1080],
  imageExts: ['png', 'jpg'],
  audioExts: ['ogg', 'opus', 'wav', 'mp3'],
  wait: { enabled: true, max: 10 },
  transitionMax: 3,   // 转场淡入淡出最多几秒（0 = 不要转场）
  menuScripts: ['^gameloop'],   // nexts 指向这些脚本（返回菜单）= 播完了，不接着播
  extraDirs: [],
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"krkr-scn\/1"/
// 台词里的行内控制码（g07 / g08 的剧本里统计出来的，一共这几种）：
//   %f<字体名>;  切字体（%fuser; 切回用户字体）——字体名只是为了显示 ♥ 之类的符号，网页里忽略
//   #00RRGGBB; / #RRGGBB;  设颜色，#;  恢复（♥ 是 #00ff80c0; = 粉色 #ff80c0）
//   %<数字>;  行首的 %150; 之类（含义没对过引擎，按文字速度处理：忽略）
//   [读音]汉字  注音，读音在前、只对后面那一个字（[う]宇[さ]佐[み]美 = 宇佐美 うさみ；[ちち]乳 = 乳 ちち）；读音只认假名，别的方括号原样保留
const KRKR_CODE = /%f[^;\n]*;|%\d+;|#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})?;|\[([\u3041-\u3096\u30a1-\u30fa\u30fcー]{1,12})\](?=([^\[\]\n]))/g
// ev_mv001_02r5s（g08）/ mv002_02_00 / mv001_02r1（g09，没有 ev_ 前缀）/ mvx01_01_01：→ 候选模型包名（ev_cgNNN_MM，g09 里多数带 s：ev_cgNNN_MMs）+ 动作名（统一成 ev_ 开头）
export function krkrMvOf(file) {
  const m = /^(?:ev_)?mv(\w+?_\d+)(?:_?[a-z]?\d*)*$/i.exec(String(file))
  return m ? { stem: `ev_cg${m[1]}`, stems: [`ev_cg${m[1]}`, `ev_cg${m[1]}s`], motion: /^ev_/i.test(file) ? String(file) : `ev_${file}` } : null
}
export function krkrSegments(text, stats = null) {
  const segments = []
  let color = ''
  let last = 0
  const push = (value, extra = {}) => {
    if (!value) return
    const prev = segments[segments.length - 1]
    const style = color ? { color } : null
    if (!extra.ruby && prev && !prev.ruby && JSON.stringify(prev.style || null) === JSON.stringify(style)) { prev.text += value; return }
    segments.push({ text: value, ...(extra.ruby ? { ruby: extra.ruby } : {}), ...(style ? { style } : {}) })
  }
  const src = String(text)
  for (const m of src.matchAll(KRKR_CODE)) {
    push(src.slice(last, m.index))
    last = m.index + m[0].length
    const code = m[0]
    if (m[1] !== undefined) { push(m[2], { ruby: m[1] }); last += m[2].length; if (stats) stats.ruby = (stats.ruby || 0) + 1 }
    else if (code[0] === '#') color = code.length > 2 ? `#${code.slice(1, -1).slice(-6).toLowerCase()}` : ''
  }
  push(src.slice(last))
  return segments
}

export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 512))
export const explainSniff = () => '开头不是 {"format":"krkr-scn/1"…（这个适配器吃 containers 从 KiriKiri 的 scn.xp3 里解出来的场景 JSON，不是原始 PSB）'

export const contextFiles = () => []
export const contextDirs = (options) => { const opt = readOptions(options); return [opt.resDir,opt.scriptDir, ...opt.extraDirs].map((dir) => String(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean) }
export const contextTextFilter = () => (rel) => /\.(pimg|sinfo|stand)\.json$|\.krkr$/i.test(rel)   // 立绘的层表 / 选项表 / 位置配置（containers 虚拟出来的，很小）
export const contextWalkLimit = 800000
export const contextSampleLimit = 2000

export function prepare(args) {
 if(args.options?.followGraph&&args.mediaDir&&!args.full)return completeJsonSamples(args,rel=>rel.endsWith('.krkr')).then(texts=>prepare({...args,texts,full:true}))
 const{options,files,texts,toResourcePath,resourceResolve,truncated}=args
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  for (const rel of files || []) resources.add(toRes(rel))
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  const lowerTexts = new Map()   // 资源路径（小写）→ 文本
  for (const [rel, text] of Object.entries(texts || {})) lowerTexts.set(toRes(rel).toLowerCase(), text)
  const json = new Map()
  const readJson = (resPath) => {
    const key = String(resPath || '').toLowerCase()
    if (!key) return null
    if (!json.has(key)) { try { json.set(key, JSON.parse(lowerTexts.get(key) || 'null')) } catch { json.set(key, null) } }
    return json.get(key)
  }
  let catalogTree
  if(opt.followGraph){const chosen=new Map();for(const[rel,text]of Object.entries(texts||{})){if(!rel.endsWith('.krkr'))continue;let d;try{d=JSON.parse(text)}catch{continue}if(d.format!=='krkr-scn/1')continue;const old=chosen.get(d.name);if(!old||/\/patch\d*\//i.test(rel))chosen.set(d.name,{rel,data:d})}const all=[...chosen.values()].map(({rel,data})=>({id:data.name,title:data.scenes.find(s=>s.title)?.title||data.name,script:rel})),special=[...chosen.values()].filter(({data})=>data.scenes.some(s=>s.steps.some(t=>t.l?.some(l=>opt.eventClasses.includes(l[1])&&l[5]===3)))).map(({rel,data})=>({id:data.name,title:data.scenes.find(s=>s.title)?.title||data.name,script:rel}));catalogTree={children:[...(special.length?[{id:'special',title:'特殊场景',children:special}]:[]),{id:'story',title:'剧情',children:all}]}}
  return {catalogTree, opts: opt, resources, resolver, hasIndex: Boolean(files?.length), truncated: Boolean(truncated), readJson }
}

const str = (v) => (typeof v === 'string' ? v : '')
// width,1,height,1,color,0xff000000 → [r, g, b]
const COLOR_FILE = /^width,\d+,height,\d+,color,0x([0-9a-f]{8})$/i
const colorOf = (file) => { const m = COLOR_FILE.exec(file); if (!m) return null; const v = parseInt(m[1], 16); return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255] }

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || data.format !== 'krkr-scn/1' || !Array.isArray(data.scenes)) throw new Error('不是 krkr-scn/1 场景')
  if(opt.followGraph||meta.scene)return krkrReadingGraph(data,scene=>parse(JSON.stringify({...data,scenes:[scene]}),{...ctx,opts:{...opt,followGraph:false}},{...meta,scene:undefined}),meta.scene?'*'+String(meta.scene).replace(/^\*/, ''):'*start')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { events: 0, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, live2d: 0, raw: {}, ignored: {}, unresolved: {}, links: {}, transitions: {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const find = (name, exts) => {
    const wanted = String(name || '').replace(/\\/g, '/').replace(/^.*\//, '')
    if (!wanted || !hasIndex) return ''
    let hit = ctx.resolver.resolveByName(wanted)
    if (hit) return hit
    for (const ext of exts) { hit = ctx.resolver.resolveByName(`${wanted}.${ext}`); if (hit) return hit }
    return ''
  }
  const menus = (opt.menuScripts || []).map((s) => { try { return new RegExp(s, 'i') } catch { return null } }).filter(Boolean)
  const steps = []
  let commands = []
  const emit = (command) => commands.push(command)
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  // 当前显示：背景（bg）+ 事件 CG（ev）；变了才发
  let shown = ''
  let bgm = { file: null, playing: false }
  const imageCache = new Map()   // 图名 → 解析结果（同一张图只算一次，统计也只计一次）
  const imageOf = (file) => {
    if (imageCache.has(file)) return imageCache.get(file)
    const color = colorOf(file)
    let result
    if (color) result = { color }
    else {
      const src = find(file, opt.imageExts)
      stats.images.referenced += 1
      if (src) { stats.images.resolved += 1; result = { src } } else {
        stats.images.unresolved += 1
        if (hasIndex) count('unresolved', `image:${file}`)
        result = null
      }
    }
    imageCache.set(file, result)
    return result
  }
  // 立绘：槽位（角色名）→ 上次发出去的签名；变了才发
  const shownStands = new Map()
  const stageW = opt.stage[0]
  const stageH = opt.stage[1]
  function standOf(layer) {
    const [name, , file, options, posName, , actions] = layer
    const rootStem = String(file || '').replace(/\.[^.]+$/, '')
    if (!rootStem) return null
    const standPath = ctx.resolver.resolveByName(`${rootStem}.stand.json`)
    const config = standPath ? ctx.readJson?.(standPath) : null
    const variant=config?.variants?.find(v=>v.name===options?.pose)||config?.variants?.[0]
    const stem=variant?.filename||rootStem
    const infoPath = hasIndex ? ctx.resolver.resolveByName(`${stem}.pimg.json`) : ''
    const info = infoPath ? ctx.readJson?.(infoPath) : null
    if (!info?.layers) { if (hasIndex) count('unresolved', `pimg:${stem}`); return null }
    const act = Object.fromEntries((actions || []).map((a) => [a[0], a[1]]))
    const standInfo=variant||config
    const geo = krkrStandGeometry({ act, posName, stand: standInfo, stage: [stageW, stageH] })
    const sinfoPath = ctx.resolver.resolveByName(`${rootStem}.sinfo.json`)
    const { ids, missing } = pickPimgLayers(info, options || {}, sinfoPath ? ctx.readJson?.(sinfoPath) : null)
    for (const m of missing) count('ignored', `pimg-layer:${m}`)
    if (!ids.length) return null
    const byId = new Map(info.layers.map((l) => [l[0], l]))   // 层 = [id, 名, 组, left, top, w, h, 可见, 类别, 资源号]
    const parts = ids.map((id) => {
      const l = byId.get(id)
      return { src: `${stem}.pimg/${id}.png`, x: Math.round(geo.cx - stageW / 2 + (l[3] + l[5] / 2 - info.width / 2) * geo.f), y: Math.round(geo.cy - stageH / 2 + (l[4] + l[6] / 2 - info.height / 2) * geo.f), scale: Math.round(geo.f * 10000) / 10000 }
    })
    return { slot: String(name), parts }
  }
  let shownL2d = ''
  // g07 的 ev 层叫 ev_mv001_02r5s（没有 .l2d，带 variables）：模型包是 live2d.xp3 里的 ev_cg001_02.l2d，动作文件就叫 ev_mv001_02r5s（目前只在 g07 对过）
  const mvOf = krkrMvOf
  function l2dOf({ file, options, motion: mvMotion }) {
    const stem = String(file).replace(/\.l2d$/i, '')
    const src = hasIndex ? ctx.resolver.resolveByName(`${stem}.model3.json`) : ''
    if (!src) { if (hasIndex) count('unresolved', `l2d:${stem}`); return null }
    // g09 的 .l2d 层：options.motions = [{ name: 'main.ev_mv001_02_01', loop: 1 }]（组名.动作名）→ 取第一个
    const first = options && Array.isArray(options.motions) ? options.motions[0] : null
    const fromList = first && typeof first.name === 'string' ? { motion: first.name.replace(/^[^.]*\./, ''), loop: Boolean(first.loop) } : null
    const base = options && typeof options === 'object' ? { ...options, ...(fromList || {}) } : (fromList || {})
    const o = mvMotion ? { ...base, motion: mvMotion, loop: true } : base
    const variables = o.variables && typeof o.variables === 'object' && Object.keys(o.variables).length ? o.variables : null
    return { src, ...(typeof o.exp === 'string' && o.exp ? { expression: o.exp } : {}), ...(typeof o.motion === 'string' && o.motion ? { motion: o.motion } : {}), ...(o.loop === true || o.loop === 'true' ? { loop: true } : {}), ...(variables ? { variables } : {}) }
  }
  function applyLayers(layers, tr) {
    let bg = null
    let ev = null
    let l2d = null
    for (const l of layers || []) {
      if (!Array.isArray(l)) continue
      const [name, cls, file, options, , showmode] = l
      if (showmode !== 3) continue
      if (cls === 'stage' && name === 'bg' && file) bg = file
      else if (opt.eventClasses.includes(cls) && ['ev','evx'].includes(name) && file) {
        const mv = options && typeof options === 'object' && options.variables && typeof options.variables === 'object' ? mvOf(file) : null
        if (/\.l2d$/i.test(file)) l2d = { file, options }
        else if (mv && hasIndex && mv.stems.find((st) => ctx.resolver.resolveByName(`${st}.model3.json`))) l2d = { file: mv.stems.find((st) => ctx.resolver.resolveByName(`${st}.model3.json`)), options, motion: mv.motion }
        else ev = file
      }
    }
    // 事件 CG（ev）盖在背景上；ev 的图取不到（Live2D 的 .l2d、mpg 视频、没采到）= 退回背景，不要黑屏
    let img = ev ? imageOf(ev) : null
    let want = img ? ev : ''
    if (!img && bg) { img = imageOf(bg); want = img ? bg : '' }
    if (want !== shown) {
      shown = want
      // 转场（envupdate 的 trans）：不管 crossfade / universal（遮罩擦除）/ mosaic / ripple / rotateswap，都近似成同样时长的淡入淡出；方式记进 stats.transitions（看得出哪些是近似的）
      const fade = Array.isArray(tr) && tr[1] > 0 ? Math.min(opt.transitionMax, tr[1] / 1000) : 0
      if (Array.isArray(tr)) count('transitions', `${tr[0]}${tr[2] ? `:${tr[2]}` : ''}`)
      if (!img) emit({ op: 'bgoff', ...(fade ? { fade } : {}) }); else emit({ op: 'bg', ...img, ...(fade ? { fade } : {}) })
    }
    // Live2D（ev 层的 .l2d）：model3.json 在虚拟索引里（containers 把 .l2d ZIP 展开成 <名字>.l2d/<成员>）；底下的背景照常显示
    const spec = l2d ? l2dOf(l2d) : null
    const l2dSig = spec ? JSON.stringify(spec) : ''
    if (l2dSig !== shownL2d) { shownL2d = l2dSig; emit(spec ? { op: 'live2d', ...spec } : { op: 'live2dOff' }); if (spec) stats.live2d += 1 }
    // 立绘：每个显示着的角色一个槽位；没了的去掉
    const now = new Map()
    for (const l of layers || []) {
      if (!Array.isArray(l) || l[1] !== 'character' || l[5] !== 3) continue
      const stand = standOf(l)
      if (stand) now.set(stand.slot, stand)
      else if (l[2]) count('ignored', 'character')
    }
    for (const slot of [...shownStands.keys()]) if (!now.has(slot)) { emit({ op: 'standOff', slot }); shownStands.delete(slot) }
    for (const [slot, stand] of now) {
      const sig = JSON.stringify(stand.parts)
      if (shownStands.get(slot) === sig) continue
      emit({ op: 'stand', slot, parts: stand.parts, stage: [stageW, stageH], ...(shownStands.has(slot) ? {} : { fade: 0.25 }) })
      shownStands.set(slot, sig)
      stats.stands += 1
    }
  }
  function applyBgm(b) {
    if (!Array.isArray(b)) return
    const [file, state] = b
    const playing = state === 1
    if (playing && file && (file !== bgm.file || !bgm.playing)) {
      stats.bgm.referenced += 1
      const hit = find(file, opt.audioExts)
      if (hit) { stats.bgm.resolved += 1; emit({ op: 'bgm', src: hit }) } else { stats.bgm.unresolved += 1; if (hasIndex) count('unresolved', `bgm:${file}`) }
      bgm = { file, playing: true }
    } else if (!playing && bgm.playing && (state === 0)) { emit({ op: 'bgmStop', fade: 1 }); bgm = { file, playing: false } }
  }

  let next = null
  for (const scene of data.scenes) {
    for (const step of scene.steps || []) {
      stats.events += 1
      for (const pre of step.pre || []) {
        if (pre[0] === 'wait') { if (opt.wait.enabled) { const seconds = Math.min(opt.wait.max, Number(pre[1]) / 1000); if (seconds > 0) emit({ op: 'wait', seconds }) } } else count('ignored', pre[0])
      }
      applyLayers(step.l, step.tr)
      applyBgm(step.b)
      if (typeof step.v === 'string') {
        stats.voices.referenced += 1
        const hit = find(step.v, opt.audioExts)
        if (hit) { stats.voices.resolved += 1; emit({ op: 'voice', src: hit }) } else { stats.voices.unresolved += 1; if (hasIndex) count('unresolved', `voice:${step.v}`) }
      }
      if (typeof step.t === 'string') {
        emit({ op: 'speaker', segments: step.n ? krkrSegments(step.n, stats) : [] })
        emit({ op: 'text', segments: step.t ? krkrSegments(step.t, stats) : [] })
        stats.messages += 1
      } else emit({ op: 'text', segments: [] })
      endStep()
    }
  }
  const lastScene = data.scenes[data.scenes.length - 1]
  const storage = str((lastScene?.nexts || [])[0]?.storage).replace(/\.txt$/i, '')
  if (storage && storage !== data.name && !menus.some((re) => re.test(storage))) { next = { script: storage }; count('links', `script:${storage}`) }
  if (commands.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((n, step) => n + step.commands.length, 0)
  return { steps, stats, ...(next ? { next } : {}) }
}

export const catalog=ctx=>ctx?.catalogTree
export const krkrScnAdapter = { sceneInPath:true, sceneThumbs:true, catalog, id: ADAPTER_ID, label: 'KiriKiri Z（Hxv4，经 containers 解密）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
