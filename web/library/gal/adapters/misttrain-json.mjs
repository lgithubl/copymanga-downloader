// 适配器：MistTrainGirls X（Unity 剧情查看器）的剧情 JSON → 规范场景（gal-scene/1）。语义照反编译出来的查看器 Assembly-CSharp.dll
// （DIALOGUE_LINE.FromRowArray / ConversationManager / DialogueSystem / ProcessBgEventAnimation；见 private-scripts 里的 mmm.zip）。
// 输入形态：位置数组 [null, [<场景 id>, [行…], …]]（UScenes/<id>/<id>.json 或 UScenes/Stills/<角色底号>/<id>.json），一行的字段位置：
//   0 GroupOrder  1 ViewOrder  2 说话人  3 台词（\n 换行；<ruby=读音>字</ruby> / <emoji=heart01> 标签）  4 字号  5 语速  6 居中  7 说话角色 id  8 说话标志
//   9 frameImage（样本里恒为 0，不处理）  10 语音  11 背景  12 BGM  13 音效  14 soundTag（样本里恒空）  15 effect  16 背景效果类型（样本里恒 0）
//   17 立绘数组（样本里恒空，不处理）  18 stillDetail = [动画名, 动画速度, 镜头缩放, 镜头 x, 镜头 y, 镜头时长, 镜头旋转]
// 播放规则（照查看器）：
//   · 只有带台词的行才停下来等点击；没台词的行（只放指令）并进下一句的这一步，结尾剩下的并进最后一步。
//   · effect '1' = 白屏淡入（wash white）；'3' = 白色闪烁（flash white）；其它取值不处理，记在 stats.raw。时长查看器里没读到常量，按 1 秒 / 0.3 秒×2 估的。
//   · 静态画面 = Spines/**/<场景 id>/ 目录：still_configuration.json 的 Parts[].Path 决定叠哪几层（<Path>.skel.bytes / .atlas.txt / .png，按顺序叠），
//     IsMosaic 的层默认不叠（adapterOptions.showMosaic 打开才叠）；没有 still_configuration.json 就按文件名数字顺序叠全部。默认放 animation1，stillDetail 里写了动画名就切。
//   · 一次性动画（ShouldPlayOneShotWithFade）：总层数 8 的 animation3/7、7 的 animation3/6、4 或 5 的 animation3 → 不循环 + 降速（spine 指令带 slow:true）。
//   · 联动背景音效（PlaySpineLinkedBgSE，按总层数 N + 动画名 + 速度选 Hse1~4，没有匹配就停掉）：
//       N=8  animation3/7 → Hse4；animation2/6 → 速度 2 用 Hse3，否则 Hse2
//       N=7  animation3/6 → Hse4；animation2/5 → 同上
//       N=5  animation5 → Hse1；animation3 → Hse4；animation2 → 同上
//       N=4  animation3 → Hse4；animation2 → 同上
//     Hse4 不循环，其余循环（循环标志查看器里是局部变量，没读全，这是推的）。文件 Sounds/BgSe/<名>.ogg。
//   · 镜头：缩放 = 值 + 0.03（|值| > 0.0001 才改），位置 = (-x, -y) × 0.015 世界单位，旋转直接设；时长 > 0 是线性插值（单位按秒）。
//     换算成播放器的 camera 单位：位置 ×0.84（0.015 世界单位按 100 像素/单位、播放器 1 单位 = 屏高的 1.65‰ 折的，没法在真机上对，可能有偏差），
//     第 4 项 = 旋转度数（播放器 CSS 转，逆时针为正取反）。
//   · 声音：BGM Sounds/Bgms/Adv/<名>.ogg · 音效 Sounds/Se/<名>.ogg · 语音在 Sounds/Voices 下按文件名找（查看器拼 Sounds/Voices/Scenarios/Stills/<底号>/<数字>/<名>.ogg，
//     目录层级里的数字不是行里能直接看出来的，所以靠索引按文件名找；索引超过 6 万个文件会漏）。
// 列表（adapter.catalog）：角色（Stills/<底号>/ 下的剧情，名字查 MasterData/MCharacterBaseViewModel.json、剧情标题查 MSceneViewModel.json，场景 id = 文件名去掉末 2 位）/
// 其它剧情（UScenes/<id>/）/ 全部剧情。列表每次从文件现读。
// 资源目录来自 config.adapterOptions['misttrain-json']：{ root（游戏数据目录，相对媒体目录，默认 ''）, showMosaic（默认 false） }

export const ADAPTER_ID = 'misttrain-json'
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => String(options?.root || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

// 1 = 数组形：[null, [<id>, [[…行], …], …]]
const HEAD = /^\s*\[\s*null\s*,\s*\[\s*"?\d{5,}"?\s*,\s*\[/
// 2 = 对象形：{"r":{"MSceneId":…,"MSceneDetailViewModel":[{"GroupOrder":…,"Name":…,"Phrase":…}, …]}}（Stills 里有的剧情是这种）
const OBJECT_HEAD = /^\s*\{\s*"r"\s*:\s*\{\s*"MSceneId"\s*:\s*"?\d{5,}"?\s*,\s*"MSceneDetailViewModel"\s*:\s*\[/
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 2048)
  return HEAD.test(head) || OBJECT_HEAD.test(head)
}

// 对象形的一行 → 位置数组（和数组形同一套字段位置）。键名只有 GroupOrder / ViewOrder / Name / Phrase 有样本，其余按常见写法不分大小写猜；
// 没认出的键记进 stats.raw（field:<键名>），在「渲染诊断」里能看到，照着补
const ROW_KEYS = [
  ['GroupOrder'], ['ViewOrder'], ['Name'], ['Phrase'], ['PhraseFontSize', 'FontSize'], ['PhraseSpeed', 'Speed'], ['IsPhraseCenter', 'IsCenter'], ['SpeechMCharacterId', 'MCharacterId'], ['IsSpeakingFlags', 'SpeakFlag'],
  ['FrameImage', 'FrameImageName'], ['VoiceFileName', 'Voice', 'VoiceName'], ['BackgroundImage', 'BackGround', 'Background', 'BackgroundName'], ['BGM', 'Bgm', 'BgmName'],
  ['SE', 'Se', 'SeName'], ['SoundTag'], ['Effect'], ['BackgroundEffectType'], ['StandCharacters'], ['StillDetail'],
]
function objectRowToArray(row, unknown) {
  const lower = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]))
  const used = new Set()
  const out = ROW_KEYS.map((names) => {
    for (const name of names) { const key = lower.get(name.toLowerCase()); if (key !== undefined) { used.add(key); return row[key] } }
    return null
  })
  for (const key of Object.keys(row)) if (!used.has(key)) unknown.add(key)
  // stillDetail 写成对象的话按常见键名转成 [动画名, 速度, 缩放, x, y, 时长, 旋转]
  const detail = out[18]
  if (detail && !Array.isArray(detail) && typeof detail === 'object') {
    // 键名（样本确认）：AnimationName / AnimationSpeed / CameraPositionX / CameraPositionY / CameraRotation / CameraWorkDuration / CameraZoomRatio；后面的正则只是兜底
    const entries = Object.entries(detail)
    const pick = (...patterns) => { for (const re of patterns) { const hit = entries.find(([key]) => re.test(key)); if (hit) return hit[1] } return null }
    out[18] = [pick(/^AnimationName$/i, /anim.*name/i), pick(/^AnimationSpeed$/i, /anim.*speed/i), pick(/^CameraZoomRatio$/i, /zoom|scale/i), pick(/^CameraPositionX$/i, /position.*x/i), pick(/^CameraPositionY$/i, /position.*y/i), pick(/^CameraWorkDuration$/i, /duration|second/i), pick(/^CameraRotation$/i, /rotat|angle/i)]
  }
  return out
}

// ---------- 上下文：资源目录索引 + 名称表 ----------
export const contextFiles = (options) => ['MSceneViewModel.json', 'MCharacterBaseViewModel.json'].map((name) => joinPath(rootOf(options), 'MasterData', name))
export const contextDirs = (options) => ['UScenes', 'Spines', 'BackGrounds', 'Sounds'].map((dir) => joinPath(rootOf(options), dir))
export const contextTextFilter = () => (rel) => /\/still_configuration\.json$/i.test(rel)

const numericPrefix = (name) => { const m = /^(\d+)/.exec(name); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER }
const natAsc = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
const jsonArray = (text) => { try { const v = JSON.parse(String(text || '').replace(/^﻿/, '')); return Array.isArray(v) ? v : [] } catch { return [] } }

export function prepare({ options, texts, files, toResourcePath }) {
  const toRes = toResourcePath || ((rel) => rel)
  const scenes = new Map()    // 剧情 id → { rel, base }（base = Stills 下的角色底号，其它 ''）
  const folders = new Map()   // 场景 id → { dir, count, bases: [<基名>…按数字排序] }（含 *.skel.bytes 的目录，目录名 = 场景 id）
  const backgrounds = new Map()
  const voices = new Map()    // 语音名（无扩展名）→ 相对资源根的路径
  for (const rel of files || []) {
    const res = toRes(rel)
    let m = /^UScenes\/(?:Stills\/([^/]+)\/)?(?:[^/]+\/)?([^/]+)\.json$/i.exec(res)
    if (m) { scenes.set(m[2], { rel, base: m[1] || '' }); continue }
    m = /^Spines\/(.+)\/([^/]+)\/([^/]+)\.skel\.bytes$/i.exec(res)
    if (m) {
      const key = m[2]
      const dir = `Spines/${m[1]}/${m[2]}`
      if (!folders.has(key)) folders.set(key, { dir, bases: [] })
      folders.get(key).bases.push(m[3])
      continue
    }
    m = /^BackGrounds\/(.+)\.(?:png|jpg)$/i.exec(res)
    if (m) { backgrounds.set(m[1].toLowerCase(), res); continue }
    m = /^Sounds\/Voices\/(.+\/)?([^/]+)\.ogg$/i.exec(res)
    if (m && !voices.has(m[2])) voices.set(m[2], res)
  }
  for (const folder of folders.values()) { folder.bases.sort((a, b) => numericPrefix(a) - numericPrefix(b) || a.localeCompare(b)); folder.count = folder.bases.length }
  const textOf = (name) => Object.entries(texts || {}).find(([key]) => key.endsWith(`/${name}`) || key === name)?.[1] || ''
  const stillConfigs = new Map()
  for (const [key, value] of Object.entries(texts || {})) {
    const m = /(?:^|\/)([^/]+)\/still_configuration\.json$/i.exec(toRes(key))
    if (m) stillConfigs.set(m[1], value)
  }
  const master = readMasterdata(textOf('MSceneViewModel.json'), textOf('MCharacterBaseViewModel.json'))
  const ctx = { scenes, folders, backgrounds, voices, stillConfigs, master, hasIndex: Boolean(files?.length), showMosaic: Boolean(options?.showMosaic) }
  ctx.catalogTree = buildCatalog(ctx)
  return ctx
}

function readMasterdata(sceneText, baseText) {
  const titles = new Map()
  for (const row of jsonArray(sceneText)) if (row && row.Id !== undefined) titles.set(String(row.Id), str(row.Title))
  const bases = new Map()
  for (const row of jsonArray(baseText)) if (row && row.Id !== undefined) bases.set(String(row.Id), str(row.Name))
  return { titles, bases }
}

// 剧情文件名 → 标题：场景 id = 文件名去掉末 2 位；找不到再试原样、末位减 1（技能场景 55000405 对应 55000404）
function titleOf(master, stem) {
  const tries = [stem.slice(0, -2), stem, String(Number(stem) - 1)]
  for (const key of tries) { const title = master.titles.get(key); if (title) return title }
  return ''
}

function buildCatalog(ctx) {
  const { scenes, master } = ctx
  if (!scenes.size) return null
  const node = (id, stem, entry, prefix) => {
    const title = titleOf(master, stem)
    return { id: `${prefix}/${id}`, title: title || stem, subtitle: title ? stem : '', script: entry.rel }
  }
  const lists = []
  const byBase = new Map()
  const others = []
  for (const [stem, entry] of [...scenes].sort((a, b) => natAsc(a[0], b[0]))) {
    if (entry.base) { if (!byBase.has(entry.base)) byBase.set(entry.base, []); byBase.get(entry.base).push([stem, entry]) } else others.push([stem, entry])
  }
  const people = [...byBase].sort((a, b) => natAsc(a[0], b[0])).map(([base, list]) => ({
    id: `chars/${base}`,
    title: master.bases.get(base) || `角色 ${base}`,
    subtitle: `${list.length} 项`,
    children: list.map(([stem, entry]) => node(stem, stem, entry, `chars/${base}`)),
  }))
  if (people.length) lists.push({ id: 'chars', title: '角色', children: people })
  if (others.length) lists.push({ id: 'other', title: '其它剧情', children: others.map(([stem, entry]) => node(stem, stem, entry, 'other')) })
  lists.push({ id: 'all', title: '全部剧情', children: [...scenes].sort((a, b) => natAsc(a[0], b[0])).map(([stem, entry]) => node(stem, stem, entry, 'all')) })
  return { children: lists }
}

export const catalog = (ctx) => ctx?.catalogTree || null

// ---------- 解析 ----------
const str = (value) => (value === null || value === undefined ? '' : String(value))
const numOrNull = (value) => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null }
const cleanName = (value) => str(value).trim().replace(/\\/g, '/').replace(/^\/+/, '')
const EMOJI = { heart01: '♥', heart02: '♥', heart03: '♥', heart04: '♥', smile: '☺', star: '★' }

// 一句台词的片段：<ruby=读音>字</ruby> → { text, ruby }；<emoji=名字> → 一个符号；其余原样
function segmentsOf(raw) {
  const text = str(raw).replace(/\\n/g, '\n').replace(/<emoji=(.*?)>/g, (_all, name) => EMOJI[name] || '')
  const segments = []
  let last = 0
  for (const m of text.matchAll(/<ruby=(.*?)>(.*?)<\/ruby>/g)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) })
    segments.push({ text: m[2], ruby: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments.filter((segment) => segment.text)
}

// 总层数 N + 动画名 + 速度 → 联动背景音效（照 PlaySpineLinkedBgSE）
export function linkedBgSe(n, anim, speed) {
  const fast = Math.abs(speed - 2) < 1e-6
  const slow23 = fast ? 'Hse3' : 'Hse2'
  if (n === 8) return anim === 'animation3' || anim === 'animation7' ? 'Hse4' : anim === 'animation2' || anim === 'animation6' ? slow23 : ''
  if (n === 7) return anim === 'animation3' || anim === 'animation6' ? 'Hse4' : anim === 'animation2' || anim === 'animation5' ? slow23 : ''
  if (n === 5) return anim === 'animation5' ? 'Hse1' : anim === 'animation3' ? 'Hse4' : anim === 'animation2' ? slow23 : ''
  if (n === 4) return anim === 'animation3' ? 'Hse4' : anim === 'animation2' ? slow23 : ''
  return ''
}
export const isOneShot = (n, anim) => (n === 8 ? anim === 'animation3' || anim === 'animation7' : n === 7 ? anim === 'animation3' || anim === 'animation6' : n === 4 || n === 5 ? anim === 'animation3' : false)

const CAMERA_POS_UNIT = 0.84
const zoomCode = (scale) => ((scale - 1) / 1.3) * 1000   // 播放器 zoomOf(z) = 1 + z/1000×1.3 的反函数

export function parse(text, ctx = null, meta = {}) {
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  const unknownKeys = new Set()
  let scene = Array.isArray(data) ? data[1] : null
  if (!Array.isArray(scene) && data?.r && Array.isArray(data.r.MSceneDetailViewModel)) {   // 对象形
    scene = [data.r.MSceneId, data.r.MSceneDetailViewModel.filter((row) => row && typeof row === 'object').map((row) => objectRowToArray(row, unknownKeys))]
  }
  if (!Array.isArray(scene) || !Array.isArray(scene[1])) throw new Error('找不到场景行（[null, [<id>, [行…]]] 或 {"r":{"MSceneDetailViewModel":[…]}}）')
  const sceneId = str(scene[0]) || str(meta?.stem)
  const rows = scene[1].filter((row) => Array.isArray(row))
  const stats = { rows: rows.length, commands: 0, raw: {}, unresolved: {}, spines: 0, mosaicSkipped: 0 }
  for (const key of unknownKeys) stats.raw[`field:${key}`] = 1
  const miss = (kind, name) => { const key = `${kind}:${name}`; stats.unresolved[key] = (stats.unresolved[key] || 0) + 1 }
  const raw = (key) => { stats.raw[key] = (stats.raw[key] || 0) + 1 }

  // --- 静态画面的层 ---
  const folder = ctx?.folders?.get(sceneId)
  let parts = []
  if (folder) {
    let order = folder.bases
    const config = ctx.stillConfigs?.get(sceneId)
    if (config) {
      try {
        const list = JSON.parse(config.replace(/^﻿/, ''))?.Parts
        if (Array.isArray(list) && list.length) {
          const wanted = []
          for (const part of list) {
            if (part?.IsMosaic && !ctx.showMosaic) { stats.mosaicSkipped += 1; continue }
            const name = str(part?.Path)
            if (name && folder.bases.includes(name)) wanted.push(name)
          }
          if (wanted.length) order = wanted
        }
      } catch { /* 配置坏了就按全部层 */ }
    }
    parts = order.map((base) => ({ skel: `${folder.dir}/${base}.skel.bytes`, atlas: `${folder.dir}/${base}.atlas.txt` }))
  } else if (ctx?.folders) miss('spines', sceneId)
  const total = folder?.count || 0

  const resolveBg = (name) => {
    const key = name.toLowerCase().replace(/\.(png|jpg)$/, '')
    if (ctx?.backgrounds?.has(key)) return ctx.backgrounds.get(key)
    if (ctx?.hasIndex) miss('background', name)
    return `BackGrounds/${name.replace(/\.(png|jpg)$/i, '')}.png`
  }

  const steps = []
  let pending = []            // 还没有台词的行攒下来的指令
  let speaker = null
  let lastBgm = ''
  let stillOn = false
  let anim = ''
  let speed = 1
  let bgSeNow = ''
  let camera = [0, 0, 0, 0]   // 播放器单位：[x, y, zoomCode, 旋转]
  let scale = 1

  const playStill = (command, animName) => {
    const name = animName || anim || 'animation1'
    const oneShot = isOneShot(total, name)
    anim = name
    parts.forEach((part, order) => {
      stats.spines += 1
      command({ op: 'spine', slot: `still${order}`, kind: 'still', skel: part.skel, atlas: part.atlas, anim: name, loop: !oneShot, speed, order, ...(oneShot ? { slow: true } : {}) })
    })
    const linked = linkedBgSe(total, name, speed)
    if (linked) {
      if (bgSeNow !== linked) { command({ op: 'bgse', src: `Sounds/BgSe/${linked}.ogg`, loop: linked !== 'Hse4' }); bgSeNow = linked }
    } else if (bgSeNow) { command({ op: 'bgseStop' }); bgSeNow = '' }
  }

  rows.forEach((row, rowIndex) => {
    const commands = pending
    pending = []
    const emit = (command) => { commands.push(command) }
    const background = cleanName(row[11])
    const detail = Array.isArray(row[18]) ? row[18] : []
    const animName = str(detail[0]).trim()
    const effect = str(row[15]).trim()

    if (background) emit({ op: 'bg', src: resolveBg(background), fade: 0.5 })
    if (row[9]) raw('frameImage')
    if (str(row[14]).trim()) raw('soundTag')
    if (Array.isArray(row[17]) && row[17].length) raw('standCharacters')
    if (numOrNull(row[16])) raw('backgroundEffectType')

    // --- 静态画面 + 动画 + 镜头 ---
    const nextSpeed = numOrNull(detail[1])
    if (nextSpeed !== null && nextSpeed > 0) speed = nextSpeed
    if (parts.length && (!stillOn || animName)) {
      stillOn = true
      playStill(emit, animName)
    }
    const camValues = detail.slice(2, 7).map(numOrNull)
    if (camValues.some((v) => v !== null)) {
      const [zoom, px, py, seconds, rotation] = camValues
      const from = [...camera]
      if (zoom !== null && Math.abs(zoom) > 1e-4) scale = zoom + 0.03
      const next = [px !== null ? px * CAMERA_POS_UNIT : camera[0], py !== null ? py * CAMERA_POS_UNIT : camera[1], zoom !== null && Math.abs(zoom) > 1e-4 ? zoomCode(scale) : camera[2], rotation !== null ? rotation : camera[3]]
      camera = next
      emit({ op: 'camera', from, to: [...next], seconds: Math.max(0, Math.min(60, seconds && seconds > 0 ? seconds : 0)) })
    }

    // --- 屏幕效果 ---
    if (effect === '1') emit({ op: 'wash', color: 'white', seconds: 1 })
    else if (effect === '3') emit({ op: 'flash', color: 'white', count: 2, seconds: 0.3 })
    else if (effect && effect !== '0') raw(`effect:${effect}`)

    // --- 声音 ---
    const bgm = cleanName(row[12])
    if (bgm && bgm !== lastBgm) { emit({ op: 'bgm', src: `Sounds/Bgms/Adv/${bgm}.ogg` }); lastBgm = bgm }
    const se = cleanName(row[13])
    if (se) emit({ op: 'se', src: `Sounds/Se/${se}.ogg` })
    const voice = cleanName(row[10])
    if (voice) {
      const src = ctx?.voices?.get(voice)
      if (src) emit({ op: 'voice', src })
      else if (ctx?.hasIndex) miss('voice', voice)
      else emit({ op: 'voice', src: `Sounds/Voices/Scenarios/Stills/${voice}.ogg` })
    }

    // --- 台词：没有台词的行不停（指令并进下一句） ---
    const segments = segmentsOf(row[3])
    const hasText = segments.some((segment) => segment.text.trim())
    if (!hasText) { pending = commands; return }
    const name = str(row[2]).trim()
    if (name !== speaker) { emit({ op: 'speaker', segments: name ? [{ text: name }] : [] }); speaker = name }
    emit({ op: 'text', segments })
    stats.commands += commands.length
    steps.push({ index: steps.length, commands, row: rowIndex })
  })
  if (pending.length) {
    if (steps.length) { steps[steps.length - 1].commands.push(...pending); stats.commands += pending.length } else { steps.push({ index: 0, commands: pending }); stats.commands += pending.length }
  }
  for (const step of steps) delete step.row
  return { steps, stats }
}

export const misttrainJsonAdapter = { id: ADAPTER_ID, label: 'MistTrainGirls X 剧情 JSON', sniff, parse, contextFiles, contextDirs, contextTextFilter, prepare, catalog }
