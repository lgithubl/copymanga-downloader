// 适配器：自有 arc 家族（eomaia 引擎：コンフィチュールソフト 等）的剧情脚本（SCRE，由 containers.mjs 从 script.arc 里读出来、arcfam-decode.mjs 认字节模式解成 JSON 事件流）→ 规范场景（gal-scene/1）。
// id = arcfam::scre：引擎家族 arcfam 的脚本适配器，家族里所有游戏（game.id = arcfam::<游戏>）共用；游戏之间的差别只在 config（adapterOptions['arcfam::scre'] + containers 规则）。
//
// 输入：{"format":"arcfam-scre/1","arc","name","size","events":[事件…]}；事件：["t", 文本, 行号] ["w", 说话人] ["v", 语音文件] ["b", BGM 文件] ["s", 音效文件] ["i", 方法号, 图文件]
// 映射：
//   t（+ 前面最近一个 w）→ speaker + text；v → voice；b → bgm；s → se
//   i 102（底图：bg* / BG_* / EV*S* / h* / e*）→ bg，同时清掉叠加层；i 105 / 106（叠加层：face / moji / karada / eff / cutin …）→ overlay（按文件名里「_种类」分槽，同种类再来一张 = 替换；整张铺满，真实样本里 EV 的底图和叠加层都是 1280×720）
//   j（脚本引用）：最后一句文本之后出现的 = 这个脚本的去向——只有 1 个 → scene.next（接着播）；≥ 2 个 → choice（选项文字 = 目标脚本名）+ 带 when 的 goto（真实样本：ADV_KOHAI08 末尾并排 adv_kohai08a / 08b = 路线分支，ADV_KOHAI09A 末尾并排 3 个）；前面出现的（H 场景 adv_kohai_h01 等）只记 stats.links
//   m（eomaia_char 立绘，g10 ギャル×オタ）：101 加载角色（`xxx.char` = 一个 JSON：画布大小、底图 base[序号]、部件 sub[名字] 的位置 / 图集文件、sub_map）、102 选部件序号（brow / eye-open / eye-close / mouth-open / mouth-close / cheek / tear）、
//     103（含义没弄清，忽略）、104 显示、105 去掉、106 清空；底图序号 = 101 的第 2 个参数（0~11：g10 的 KIRARA_ST_00_L 实测 0~3 裸体、4~5 校服、6~7 荷叶边上衣、8~9 黑色内衣、10~11 白衬衫，每个衣服两个手势；脚本里 4 / 5 最常见 = 校服） → stand：底图 + 各部件（部件是图集 PNG + 同名 JSON（frames[<文件>_<序号>] = 裁剪框）里的一帧，摆在 sub[部件] 的 x / y 上）。样本核对：g10 的 KIRARA_ST_00_L 合成出来表情位置对（eye / brow / mouth 落在脸上）
// 没做 / 推断：
//   · 立绘位置：101 前面的 `x, y, 19` 和缩放 % —— 按「图的中心 = 画面中心 + (x, 0) 横向、竖向中心 = y」放（最常见的 -200 / 640 / 100% 算出来脚底在 1100，只超出画面底 20px，说明竖向这样放合理；横向没有对照），缩放 = 缩放 % ÷ 100；同一时刻只显示一个角色（脚本里的槽 4 / 5 / 6 是同一个角色的不同状态，新的 101 + 104 就是换掉），位置可以在「设置 → 画面 → 立绘」里调
//   · 107（弹跳 / 抖动）、109（效果）不渲染
//   · 脚本内的选择 / 条件判断（字节码没有逆全；g06 / g10 的剧本里没有选项文字，路线靠脚本引用）：「≥ 2 个去向 = 选择」是按位置猜的，选项文字只能用脚本名
//   · 叠加层的层序：按出现顺序叠；分槽方式是按文件名猜的；底图每句台词前都会重新发一次（引擎的习惯），重复的会被去掉
//   · 说话人：`【名字】` 压栈后下一句文本用它，用一次就清；没有 = 旁白
//   · 压缩的剧本（g11 的 .MES，算法没识别）不展开
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'arcfam::scre'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  stage: [1280, 720],
  imageExts: ['png', 'jpg'],
  audioExts: ['ogg', 'wav', 'mp3'],
  overlay: { enabled: true, fit: 'cover' },
  speaker: { strip: [] },
  extraDirs: [],
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"arcfam-scre\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 512))
export const explainSniff = () => '开头不是 {"format":"arcfam-scre/1"…（这个适配器吃 containers 从自有 arc 的 script.arc 里解出来的剧本事件流，不是原始二进制）'

export const contextFiles = () => []
export const contextDirs = (options) => { const opt = readOptions(options); return [opt.resDir, ...opt.extraDirs].map((dir) => String(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean) }
export const contextTextFilter = () => (rel) => /\.(char|json)$/i.test(rel)   // 立绘的 .CHAR 和图集 JSON（很小）；从容器里的虚拟文件也能读
export const contextWalkLimit = 800000
export const contextSampleLimit = 8000

export function prepare({ options, files, texts, toResourcePath, resourceResolve, truncated }) {
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
  return { opts: opt, resources, resolver, hasIndex: Boolean(files?.length), truncated: Boolean(truncated), readJson }
}

const str = (v) => (typeof v === 'string' ? v : '')

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (!data || data.format !== 'arcfam-scre/1' || !Array.isArray(data.events)) throw new Error('不是 arcfam-scre/1 事件流')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { events: 0, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, raw: {}, ignored: {}, unresolved: {}, links: {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const find = (name, exts) => {
    const wanted = String(name || '').replace(/\\/g, '/').replace(/^.*\//, '')
    if (!wanted || !hasIndex) return ''
    let hit = ctx.resolver.resolveByName(wanted)
    if (hit) return hit
    const stem = wanted.replace(/\.[^.]+$/, '')
    for (const ext of exts) { hit = ctx.resolver.resolveByName(`${stem}.${ext}`); if (hit) return hit }
    return ''
  }
  const steps = []
  let commands = []
  const emit = (command) => commands.push(command)
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  // ---- eomaia_char 立绘：当前角色 + 是否显示 ----
  let char = null              // { stem, scale, x, y, base, brow, cheek, tear, eye: { part, idx }, mouth: { part, idx } }
  const modernChars=new Map(),modernShown=new Map()
  let charShown = false
  let shownChar = ''
  const stemOf2 = (name) => String(name || '').replace(/\\/g, '/').replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase()
  const frameOf = (def, part, idx) => {
    const sub = def.sub?.[part]
    if (!sub?.fileid) return null
    const jsonPath = ctx?.resolver?.resolveByName?.(`${sub.fileid}.json`)
    const atlas = jsonPath ? ctx.readJson?.(jsonPath) : null
    const frame = atlas?.frames?.[`${sub.fileid}_${idx}`]?.frame
    const sheet = find(`${sub.fileid}.png`, opt.imageExts)
    if (!frame || !sheet) return null
    return { sheet, crop: [frame.x, frame.y, frame.w, frame.h], x: Number(sub.x) || 0, y: Number(sub.y) || 0 }
  }
  // 当前角色 → stand 部件（底图 + 各部件的一帧）；缺描述 / 缺图 = null（记 stats）
  function charParts() {
    if (!char || !charShown) return null
    const defPath = ctx?.resolver?.resolveByName?.(`${char.stem}.char`)
    const def = defPath ? ctx.readJson?.(defPath) : null
    if (!def?.base) { if (hasIndex) count('unresolved', `char:${char.stem}`); return null }
    const baseEntry = def.base[String(char.base)] || def.base['0'] || Object.values(def.base)[0]
    const baseSrc = baseEntry?.fileid ? find(`${baseEntry.fileid}.png`, opt.imageExts) : ''
    if (!baseSrc) { if (hasIndex) count('unresolved', `char-base:${baseEntry?.fileid || char.stem}`); return null }
    const zoom = Math.max(0.05, char.scale / 100)
    const place = { zoom, vcenter: true, shiftX: char.x, shiftY: char.y - 540 }
    const parts = [{ src: baseSrc, x: 0, y: 0, ...place }]
    const wanted = [['cheek', char.cheek], ['eye', char.eye], ['brow', char.brow], ['mouth', char.mouth], ['tear', char.tear], ...Object.entries(char.extra || {})]
    for (const [kind, value] of wanted) {
      if (value === undefined || value === null) continue
      const part = kind === 'eye' || kind === 'mouth' ? value.part : kind
      const idx = kind === 'eye' || kind === 'mouth' ? value.idx : value
      const frame = frameOf(def, part, idx)
      if (!frame) { count('ignored', `char-part:${part}`); continue }
      parts.push({ src: frame.sheet, crop: frame.crop, x: frame.x * zoom, y: frame.y * zoom, ...place })
    }
    if(char.modern){const stage=opt.stage,canvas=def.size||{width:stage[0],height:stage[1]},cx=char.y,top=char.x;return parts.map((p,i)=>{const frame=i===0?{x:Number(baseEntry.x)||0,y:Number(baseEntry.y)||0,w:Number(baseEntry.width)||canvas.width,h:Number(baseEntry.height)||canvas.height}:{x:p.x/zoom,y:p.y/zoom,w:p.crop[2],h:p.crop[3]};return{src:p.src,...(p.crop?{crop:p.crop}:{}),x:cx-stage[0]/2+(frame.x+frame.w/2-canvas.width/2)*zoom,y:top-stage[1]/2+(frame.y+frame.h/2)*zoom,scale:zoom}})}
    return parts
  }

  let base = null              // { src }：i 102
  let overlays = new Map()     // 种类 → src
  let shown = { base: null, overlays: new Map() }
  let dirty = false
  function commit() {
    if (!dirty) return
    dirty = false
    const sig = base ? JSON.stringify(base) : ''
    if (sig !== (shown.base ?? '')) {   // 换底图 = 先收掉旧的叠加层
      if (shown.overlays.size) emit({ op: 'overlayOff' })
      shown.overlays = new Map()
      if (base) emit({ op: 'bg', ...base }); else emit({ op: 'bgoff' })
      shown.base = sig
    }
    for (const slot of [...shown.overlays.keys()]) if (!overlays.has(slot)) { emit({ op: 'overlayOff', slot }); shown.overlays.delete(slot) }
    for (const [slot, src] of overlays) if (shown.overlays.get(slot) !== src) { emit({ op: 'overlay', slot, src, fit: opt.overlay.fit }); shown.overlays.set(slot, src) }
    const legacy=char;const legacyShown=charShown
    for(const[slot,c]of modernChars){char=c;charShown=Boolean(c.shown);const parts=charParts(),sig=JSON.stringify(parts);if(sig!==modernShown.get(slot)){emit(parts?{op:'stand',slot:'eomaia:'+slot,parts,stage:opt.stage}:{op:'standOff',slot:'eomaia:'+slot});modernShown.set(slot,sig)}}
    char=legacy;charShown=legacyShown
    const charPartList = char?.modern?null:charParts()
    const charSig = charPartList ? JSON.stringify(charPartList) : ''
    if (charSig !== shownChar) { if (charPartList) { emit({ op: 'stand', parts: charPartList }); stats.stands += 1 } else if (shownChar) emit({ op: 'standOff' }); shownChar = charSig }
  }
  const imageRef = (file) => {
    const src = find(file, opt.imageExts)
    stats.images.referenced += 1
    if (src) { stats.images.resolved += 1; return src }
    stats.images.unresolved += 1
    if (hasIndex) count('unresolved', `image:${file}`)
    return ''
  }

  // 去向：最后一句文本之后的脚本引用
  let lastText = -1
  data.events.forEach((ev, i) => { if (Array.isArray(ev) && ev[0] === 't') lastText = i })
  const stemOf = (file) => str(file).replace(/\.script$/i, '')
  const endRefs = []
  data.events.forEach((ev, i) => { if (Array.isArray(ev) && ev[0] === 'j') { count('links', `script:${stemOf(ev[1])}`); if (i > lastText && !endRefs.includes(stemOf(ev[1]))) endRefs.push(stemOf(ev[1])) } })

  let speaker = ''
  for (const ev of data.events) {
    if (!Array.isArray(ev)) continue
    stats.events += 1
    const kind = ev[0]
    if (kind === 'i') {
      const method = Number(ev[1])
      const file = str(ev[2])
      if (method === 102) {
        const src = imageRef(file)
        base = src ? { src } : null
        overlays = new Map()
        dirty = true
      } else if (opt.overlay.enabled) {
        const src = imageRef(file)
        if (src) { const slot = (/_([a-z]+)\d*\.[a-z]+$/i.exec(file)?.[1] || 'layer').toLowerCase(); overlays.set(slot, src); dirty = true }
      } else count('ignored', `image:${method}`)
    } else if (kind === 'v') {
      stats.voices.referenced += 1
      const hit = find(str(ev[1]), opt.audioExts)
      if (hit) { stats.voices.resolved += 1; emit({ op: 'voice', src: hit }) } else { stats.voices.unresolved += 1; if (hasIndex) count('unresolved', `voice:${str(ev[1])}`) }
    } else if (kind === 'b') {
      stats.bgm.referenced += 1
      const hit = find(str(ev[1]), opt.audioExts)
      if (hit) { stats.bgm.resolved += 1; emit({ op: 'bgm', src: hit }) } else { stats.bgm.unresolved += 1; if (hasIndex) count('unresolved', `bgm:${str(ev[1])}`) }
    } else if (kind === 's') {
      const hit = find(str(ev[1]), opt.audioExts)
      if (hit) emit({ op: 'se', src: hit }); else if (hasIndex) count('unresolved', `se:${str(ev[1])}`)
    } else if (kind === 'w') speaker = str(ev[1])
    else if (kind === 't') {
      commit()
      let who = speaker
      speaker = ''
      for (const re of (Array.isArray(opt.speaker.strip) ? opt.speaker.strip : [])) { try { who = who.replace(new RegExp(re), '') } catch { /* 坏正则不管 */ } }
      emit({ op: 'speaker', segments: who ? [{ text: who }] : [] })
      emit({ op: 'text', segments: str(ev[1]) ? [{ text: str(ev[1]) }] : [] })
      stats.messages += 1
      endStep()
    } else if (kind === 'm') {
      const method = Number(ev[1])
      const args = Array.isArray(ev[2]) ? ev[2] : []
      if (method === 101) {
        const triple = Array.isArray(ev[3]) ? ev[3] : []
        char = { stem: stemOf2(args[2]), scale: Number(args[0]) || 100, x: Number(triple[0]) || 0, y: Number.isFinite(Number(triple[1])) ? Number(triple[1]) : 640, base: Number(args[1]) || 0, brow: 0, eye: { part: 'eye-open', idx: 0 }, mouth: { part: 'mouth-close', idx: 0 }, cheek: undefined, tear: undefined }
        char.modern=ev[4]?.coordMode==='canvas-top-center';char.slot=ev[4]?.slot??0;if(char.modern)modernChars.set(char.slot,char)
        charShown = false
      } else if (char && method === 102 && typeof args[2] === 'string') {
        if(modernChars.has(args[0]))char=modernChars.get(args[0])
        const idx = Number(args[1]) || 0
        if (args[2] === 'brow') char.brow = idx
        else if (args[2] === 'eye-open' || args[2] === 'eye-close') char.eye = { part: args[2], idx }
        else if (args[2] === 'mouth-open' || args[2] === 'mouth-close') char.mouth = { part: args[2], idx }
        else if (args[2] === 'cheek') char.cheek = idx
        else if (args[2] === 'tear') char.tear = idx
        else { char.extra ||= {}; char.extra[args[2]]=idx }
      } else if (method === 103) count('ignored', 'char:103')
      else if (method === 104) {charShown=Boolean(char);if(modernChars.size)for(const[slot,c]of modernChars)if(args[0]===-1||args[0]===slot)c.shown=true}
      else if (method === 105 || method === 106) {if(modernChars.size)for(const[slot,c]of modernChars)if(method===106||args[0]===-1||args[0]===slot)c.shown=false; charShown = false; if (method === 106) char = null }
      else count('ignored', `char:${method}`)
      dirty = true
    } else if(kind==='u')count('ignored',`unhandled:${ev[1]}`)
    else count('ignored', String(kind))
  }
  commit()
  let next = null
  if (endRefs.length === 1) next = { script: endRefs[0] }
  else if (endRefs.length >= 2) {
    // 路线分支：选项挂在最后一句台词的步里（没有就自己一步）
    const last = !commands.length && steps.length ? steps[steps.length - 1] : null
    const host = last && last.commands.some((c) => c.op === 'text' && c.segments.length) ? last : null
    const stepIndex = host ? host.index : steps.length
    const variable = `sel${stepIndex}`
    const into = host ? host.commands : commands
    into.push({ op: 'choice', id: `${stepIndex}:${into.length}`, var: variable, options: endRefs.map((name, n) => ({ value: n + 1, segments: [{ text: name.toUpperCase() }] })) })
    stats.choices += 1
    if (!host) { into.push({ op: 'text', segments: [] }); endStep() }
    endRefs.forEach((script, n) => emit({ op: 'goto', script, when: [{ var: variable, op: '==', value: n + 1 }] }))
  }
  if (commands.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((n, step) => n + step.commands.length, 0)
  return { steps, stats, ...(next ? { next } : {}) }
}

export const arcfamScreAdapter = { id: ADAPTER_ID, label: '自有 arc / eomaia（SCRE，经 containers 展开）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
