// 适配器：tenkeiprdx（Unity 剧情查看器）的剧情 JSON → 规范场景（gal-scene/1）。语义照反编译出来的查看器（见 private-scripts/tenkeiprdx-x）。
// 输入形态：对象形 { result: { sceneDetails: [{ assetId, sceneFrameDetails: [帧…] }] } }（取 assetId = 脚本文件名那一项，没有就取第一项）；
// 或位置数组形（游戏原始数据，没有键名：[[ "<场景 id>", n, n, bool, [帧…], … ]]）——先转成对象形再走同一套解析，字段位置见 arrayFrameToObject。
// 一帧 = 一步（点一下）。每帧的字段 → 指令：
//   backgroundImage          bg（查 Backgrounds/adventure|still|eventstill）；名字里带 still_02..05 还会触发音效/闪白（照查看器）
//   still + stillAnimation   整幅静态画面 = Stills/<名>/ 下所有 *.skel.bytes（按数字前缀排序叠起来），播放 stillAnimation；
//                            animation2/3/4 联动背景音效 Hse2/Hse3/Hse4，animation4 闪白两次，animation5 白屏淡出，animation3 倍速 1.5
//   sceneCamera*             camera：起止位置 + Z（缩放，千分比）+ 时长（毫秒）
//   adventureCharacters[]    站位立绘 = Spines/<角色id>/ 下的 *.skel.bytes；表情 0..6 → idle_normal/joy/sad/angry/surprise/shy/unique；
//                            站位 1 左 / 2 右 / 其余居中；动作 1 跳两下 / 2 左右抖 / 3 下沉；空数组 = 立绘全部隐藏
//   phraseVoice / backgroundMusic / soundEffect   AdventureVoice/<场景id>/<名>.ogg · BGM/<名>.ogg（没有就找 <名>_loop.ogg）· Se/<名>.ogg
//   speakerName（%username% → Masterdata/username.txt） / phraseContents（\n 换行）   speaker / text
// 对象形里没有「谁在说话」的站位字段，所以不做说话人高亮（数组形才有，暂不支持）；frameEffect 的取值不明，原样记在 stats.frameEffects 里。
// 列表（adapter.catalog，照原查看器的三个列表页）：活动 = EpisodeThumbnails/event（新的在前，剧情 id = '2'+文件名第 3、4 段）、
// 附加 = EpisodeThumbnails/extra（同上，id 以 1 结尾的末位换成 2；标题查 Masterdata/masterdata_32.json）、
// 角色 = CharacterIcons/<8 位角色号>*.png（名字、称号查 masterdata_4.json）→ 点进去是这个角色的 EX 剧情（masterdata_32.json 里按 <角色号>_01|02_still 找，
// 缩略图 Backgrounds/still/<key>.png）、全部剧情 = scenes/ 下所有剧情 JSON。列表都是每次从文件现读的：数据文件更新了，列表跟着变。
// 资源目录来自 config.adapterOptions['tenkeiprdx-json']：{ root（Imported 目录，相对媒体目录，默认 ''）, positionX（站位 → 横向位置 0..1）, unknownName（%username% 的默认值） }

export const ADAPTER_ID = 'tenkeiprdx-json'
const DEFAULT_POSITION_X = { 0: 0.5, 1: 0.3, 2: 0.7 }
const FACIAL = ['idle_normal', 'idle_joy', 'idle_sad', 'idle_angry', 'idle_surprise', 'idle_shy', 'idle_unique']
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => String(options?.root || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

// 两种形状：对象形（带键名 sceneDetails / sceneFrameDetails）、位置数组形（游戏原始数据：[[ "<场景 id>", n, n, bool, [帧…], … ]]，没有任何键名）
const ARRAY_HEAD = /^\s*\[\s*\[\s*"\d{6,}"\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*(?:true|false)\s*,\s*\[/
export function sniff(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 16384)
  return /"(?:sceneFrameDetails|sceneDetails)"\s*:/.test(head) || ARRAY_HEAD.test(head)
}

// 数组形 → 对象形（之后复用同一套解析）。位置来自样本对照：
//   场景  [0] 场景 id  [4] 帧数组
//   帧    [3] backgroundImage  [10] speakerName  [12] phraseContents  [27] backgroundMusic  [29] phraseVoice  [31] adventureCharacters
//   角色  [0] characterMasterId  [1] characterPosition  [2] characterAppearance  [3] characterFacialExpression  [4] characterAction（后四项是按样本值猜的，stats.arrayGuess 里标明）
// 其余位置没有样本：字符串值按内容认——名字是 Stills 目录里的 → still；animationN → stillAnimation（认不出的记在 stats.arrayUnknown）
const ARRAY_KNOWN = new Set([0, 3, 10, 12, 27, 29, 30, 31])
function arrayFrameToObject(frame, ctx) {
  const at = (i) => (frame[i] === null || frame[i] === undefined ? '' : frame[i])
  const out = {
    backgroundImage: at(3), speakerName: at(10), phraseContents: at(12), backgroundMusic: at(27), phraseVoice: at(29),
    adventureCharacters: Array.isArray(frame[31]) ? frame[31].map((c) => (Array.isArray(c)
      ? { characterMasterId: c[0], characterPosition: c[1], characterAppearance: c[2], characterFacialExpression: c[3], characterAction: c[4] }
      : null)).filter(Boolean) : null,
  }
  const unknown = []
  frame.forEach((value, i) => {
    if (ARRAY_KNOWN.has(i) || typeof value !== 'string' || !value.trim()) return
    const v = value.trim()
    if (/^animation\d+$/i.test(v)) out.stillAnimation = v
    else if (ctx?.spines?.has(`Stills/${v}`)) out.still = v
    else unknown.push(`[${i}]=${v.slice(0, 40)}`)
  })
  return { frame: out, unknown }
}
function readArrayScenes(data, wantedId, ctx) {
  const scenes = data.filter((item) => Array.isArray(item) && Array.isArray(item[4]))
  if (!scenes.length) throw new Error('找不到场景（数组形）')
  const scene = scenes.find((item) => str(item[0]) === str(wantedId)) || scenes[0]
  const unknown = {}
  const frames = scene[4].map((frame) => {
    if (!Array.isArray(frame)) return {}
    const { frame: obj, unknown: extra } = arrayFrameToObject(frame, ctx)
    for (const key of extra) unknown[key] = (unknown[key] || 0) + 1
    return obj
  })
  return { assetId: str(scene[0]), frames, unknown }
}

// ---------- 上下文：资源目录索引 + username ----------
export const contextFiles = (options) => ['username.txt', 'masterdata_4.json', 'masterdata_32.json'].map((name) => joinPath(rootOf(options), 'Masterdata', name))
export const contextDirs = (options) => ['Spines', 'Stills', 'Backgrounds', 'BGM', 'scenes', 'CharacterIcons', 'EpisodeThumbnails'].map((dir) => joinPath(rootOf(options), dir))

const numericPrefix = (name) => { const m = /^(\d+)/.exec(name); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER }

export function prepare({ options, texts, files, toResourcePath }) {
  const toRes = toResourcePath || ((rel) => rel)
  const spines = new Map()   // 'Spines/<id>' / 'Stills/<名>' → [基名…]
  const backgrounds = new Map()
  const bgm = new Set()
  const scenes = new Map()   // 剧情 id → 相对媒体目录的路径
  const thumbs = { event: [], extra: [], special: [] }
  const icons = []
  for (const rel of files || []) {
    const res = toRes(rel)
    let t = /^scenes\/([^/]+)\.json$/i.exec(res)
    if (t) { scenes.set(t[1], rel); continue }
    t = /^EpisodeThumbnails\/(event|extra|special)\/(ep_eventstill_[^/]+)\.png$/i.exec(res)
    if (t) { thumbs[t[1].toLowerCase()].push({ name: t[2], res }); continue }
    t = /^CharacterIcons\/([^/]+)\.png$/i.exec(res)
    if (t) { icons.push({ name: t[1], res }); continue }
    let m = /^(Spines|Stills)\/([^/]+)\/(.+)\.skel\.bytes$/i.exec(res)
    if (m) {
      const key = `${m[1]}/${m[2]}`
      if (!spines.has(key)) spines.set(key, [])
      spines.get(key).push(m[3])
      continue
    }
    m = /^Backgrounds\/(adventure|still|eventstill)\/(.+)\.png$/i.exec(res)
    if (m) { const name = m[2].toLowerCase(); if (!backgrounds.has(name) || m[1].toLowerCase() === 'adventure') backgrounds.set(name, res); continue }
    m = /^BGM\/(.+)\.ogg$/i.exec(res)
    if (m) bgm.add(m[1])
  }
  for (const list of spines.values()) list.sort((a, b) => numericPrefix(a) - numericPrefix(b) || a.localeCompare(b))
  const textOf = (name) => Object.entries(texts || {}).find(([key]) => key.endsWith(`/${name}`) || key === name)?.[1] || ''
  const username = textOf('username.txt').trim()
  const master = readMasterdata(textOf('masterdata_4.json'), textOf('masterdata_32.json'))
  const ctx = { spines, backgrounds, bgm, username, hasIndex: Boolean(files?.length), positionX: options?.positionX, unknownName: options?.unknownName, scenes, thumbs, icons, master }
  ctx.catalogTree = buildCatalog(ctx)
  return ctx
}

// ---------- 名称表 / 列表 ----------
const jsonArray = (text) => { try { const v = JSON.parse(String(text || '').replace(/^﻿/, '')); return Array.isArray(v) ? v : [] } catch { return [] } }
// masterdata_4：[ ?, [角色号, ?, ?, 名字, 称号, …, 第 10 项分组号] ]；masterdata_32：[ ?, [?, ?, 标题, …, 第 9 项 [剧情 id…], 第 10 项 [still 键…]] ]
function readMasterdata(text4, text32) {
  const chars = new Map()
  for (const row of jsonArray(text4)) {
    const data = Array.isArray(row) ? row[1] : null
    if (!Array.isArray(data) || data.length < 4) continue
    const id = Number(data[0])
    if (Number.isFinite(id) && !chars.has(id)) chars.set(id, { name: str(data[3]), title: str(data[4]) })
  }
  const scenarios = []
  const byStill = new Map()
  for (const row of jsonArray(text32)) {
    const data = Array.isArray(row) ? row[1] : null
    if (!Array.isArray(data) || data.length < 11) continue
    const stills = Array.isArray(data[10]) ? data[10].map(str).filter(Boolean) : []
    const entry = { title: str(data[2]), jsonId: Array.isArray(data[9]) ? str(data[9][0]) : '', stills }
    scenarios.push(entry)
    for (const key of stills) if (!byStill.has(key)) byStill.set(key, entry)
  }
  return { chars, scenarios, byStill }
}

const natDesc = (a, b) => b.localeCompare(a, 'en', { numeric: true })
const natAsc = (a, b) => a.localeCompare(b, 'en', { numeric: true })

function buildCatalog(ctx) {
  const { scenes, thumbs, icons, master } = ctx
  if (!scenes.size) return null
  const info = new Map()   // 剧情 id → { title, thumb, badge }（先收到的为准）
  const note = (id, entry) => { if (!info.has(id)) info.set(id, entry) }
  const lists = []
  const stillThumb = (key) => {
    const res = `Backgrounds/still/${key}.png`
    return ctx.backgrounds.get(key.toLowerCase()) || (ctx.hasIndex ? '' : res)
  }

  for (const [kind, label] of [['event', '活动'], ['extra', '附加'], ['special', '特别']]) {
    const children = []
    for (const thumb of [...thumbs[kind]].sort((a, b) => natDesc(a.name, b.name))) {
      const parts = thumb.name.split('_')
      if (parts.length < 4) continue
      let id = `2${parts[2]}${parts[3]}`
      if (kind === 'extra' && id.endsWith('1')) id = `${id.slice(0, -1)}2`
      // 特别：没有样本说明编号规则，按「原样 / 末位 2 / 末位 1」依次找第一个存在的剧情
      if (kind === 'special') id = [id, `${id.slice(0, -1)}2`, `${id.slice(0, -1)}1`].find((candidate) => scenes.has(candidate)) || id
      const script = scenes.get(id)
      if (!script) continue
      const title = master.byStill.get(`${thumb.name.replace(/^ep_eventstill_/, '')}_still_01`)?.title || ''
      note(id, { title: title || id, thumb: thumb.res, badge: kind })
      children.push({ id: `${kind}/${id}`, title: title || id, subtitle: title ? id : '', thumb: thumb.res, badge: kind, script })
    }
    if (children.length) lists.push({ id: kind, title: label, children })
  }

  const people = []
  for (const icon of [...icons].sort((a, b) => natDesc(a.name, b.name))) {
    const code = /^\d{8}/.exec(icon.name)?.[0]
    const id = code ? Number(code) : -1
    const person = master.chars.get(id)
    const children = []
    for (const row of master.scenarios) {
      if (!row.jsonId || !row.stills.some((key) => key.startsWith(`${id}_01_still`) || key.startsWith(`${id}_02_still`))) continue
      const script = scenes.get(row.jsonId)
      if (!script) continue
      const key = row.stills.find((k) => k.includes('_still_01')) || row.stills[0]
      const thumb = stillThumb(key)
      const title = row.title || row.jsonId
      note(row.jsonId, { title, thumb, badge: '' })
      children.push({ id: `chars/${code || icon.name}/${row.jsonId}`, title, thumb, script })
    }
    people.push({ id: `chars/${code || icon.name}`, title: person?.name || '???', subtitle: [person?.title, `${children.length} 项`].filter(Boolean).join(' · '), thumb: icon.res, children })
  }
  if (people.length) lists.push({ id: 'chars', title: '角色', children: people })

  const all = [...scenes.keys()].sort(natAsc).map((id) => {
    const known = info.get(id)
    return { id: `all/${id}`, title: known?.title || id, subtitle: known && known.title !== id ? id : '', thumb: known?.thumb || '', badge: known?.badge || '', script: scenes.get(id) }
  })
  lists.push({ id: 'all', title: '全部剧情', children: all })
  return { children: lists }
}

// 适配器的列表（见 ../browse.mjs 的 catalog）：没有可用的数据（没有剧情文件）就返回 null，浏览退回按目录
export const catalog = (ctx) => ctx?.catalogTree || null

// ---------- 解析 ----------
const str = (value) => (value === null || value === undefined ? '' : String(value))
const numOrNull = (value) => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null }
const intOf = (value, fallback = 0) => { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? n : fallback }
const cleanName = (value) => str(value).trim().replace(/\\/g, '/').replace(/^\/+/, '')
const safeSeg = (value) => (/^[^/\\\0]+$/.test(value) && value !== '.' && value !== '..' ? value : '')

export function parse(text, ctx = null, meta = {}) {
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  let sceneId
  let frames
  let arrayForm = null
  if (Array.isArray(data)) {
    arrayForm = readArrayScenes(data, meta?.stem, ctx)
    sceneId = safeSeg(arrayForm.assetId || str(meta?.stem))
    frames = arrayForm.frames
  } else {
    const details = data?.result?.sceneDetails
    if (!Array.isArray(details) || !details.length) throw new Error('找不到 sceneDetails')
    const scene = details.find((item) => str(item?.assetId) === str(meta?.stem)) || details[0]
    sceneId = safeSeg(str(scene?.assetId) || str(meta?.stem))
    frames = Array.isArray(scene?.sceneFrameDetails) ? scene.sceneFrameDetails : []
  }
  const positionX = { ...DEFAULT_POSITION_X, ...(ctx?.positionX || {}) }
  const stats = { frames: frames.length, commands: 0, raw: {}, unresolved: {}, frameEffects: {}, spines: 0 }
  if (arrayForm) { stats.form = 'array'; stats.arrayGuess = '角色项的站位 / 外观 / 表情 / 动作位置是按样本猜的'; if (Object.keys(arrayForm.unknown).length) stats.arrayUnknown = arrayForm.unknown }
  const miss = (kind, name) => { const key = `${kind}:${name}`; stats.unresolved[key] = (stats.unresolved[key] || 0) + 1 }

  const username = ctx?.username || str(ctx?.unknownName) || '플레이어'
  const steps = []
  let speaker = null
  let lastBgm = ''
  let lastStill = ''
  let stillAnim = ''
  let lastSpeed = 1
  let bgSeNow = ''
  const chars = new Map()   // slot → 上一次的 spine 指令（后面的帧里没提到的站位保留）

  const resolveBg = (name) => {
    const key = name.toLowerCase()
    if (ctx?.backgrounds?.has(key)) return ctx.backgrounds.get(key)
    if (ctx?.hasIndex) miss('background', name)
    return name.includes('_still_') ? `Backgrounds/still/${name}.png` : `Backgrounds/adventure/${name}.png`
  }
  const resolveBgm = (name) => (ctx?.bgm && !ctx.bgm.has(name) && ctx.bgm.has(`${name}_loop`) ? `BGM/${name}_loop.ogg` : `BGM/${name}.ogg`)
  const skelOf = (kind, folder, preferred) => {
    const dir = `${kind}/${folder}`
    const bases = ctx?.spines?.get(dir)
    if (!bases?.length) {
      if (ctx?.spines) miss(kind.toLowerCase(), folder)
      return preferred ? [{ skel: `${dir}/${preferred}.skel.bytes`, atlas: `${dir}/${preferred}.atlas.txt` }] : []
    }
    const picked = kind === 'Spines' ? [bases.includes(preferred) ? preferred : bases[0]] : bases
    return picked.map((base) => ({ skel: `${dir}/${base}.skel.bytes`, atlas: `${dir}/${base}.atlas.txt` }))
  }

  frames.forEach((frame, frameIndex) => {
    const commands = []
    const emit = (command) => { commands.push(command) }
    const background = cleanName(frame?.backgroundImage)
    const stillName = safeSeg(cleanName(frame?.still))
    const anim = str(frame?.stillAnimation).trim()
    const effect = str(frame?.frameEffect).trim()
    if (effect) stats.frameEffects[effect] = (stats.frameEffects[effect] || 0) + 1

    // --- 背景 / 静态画面 ---
    if (stillName) {
      if (stillName !== lastStill) {
        emit({ op: 'bgoff', fade: 0 })
        emit({ op: 'spineOff', prefix: 'still' })
        lastStill = stillName
      }
    } else if (background) {
      if (lastStill) { emit({ op: 'spineOff', prefix: 'still' }); emit({ op: 'camera', to: [0, 0, 0], seconds: 0 }); lastStill = ''; stillAnim = '' }
      emit({ op: 'bg', src: resolveBg(background), fade: 0.5 })
      const effectOf = /still_0([2-5])/.exec(background)?.[1]
      if (effectOf === '2') { emit({ op: 'bgse', src: 'BgSe/Hse5.ogg', loop: false }); bgSeNow = 'Hse5' }
      else if (effectOf === '3') { emit({ op: 'bgse', src: 'BgSe/Hse2.ogg', loop: true }); bgSeNow = 'Hse2' }
      else if (effectOf === '4') { emit({ op: 'flash', color: 'white', count: 2, seconds: 0.3 }); emit({ op: 'bgse', src: 'BgSe/Hse4.ogg', loop: false }); bgSeNow = 'Hse4' }
      else if (effectOf === '5') emit({ op: 'wash', color: 'white', seconds: 2 })
    }
    if (lastStill && (stillName || anim)) {
      const name = anim || stillAnim || 'animation1'
      let speed = numOrNull(frame?.animationSpeed)
      speed = speed === null ? lastSpeed : speed > 100 ? speed / 1000 : speed
      lastSpeed = speed || 1
      if (name === 'animation3') speed = 1.5
      stillAnim = name
      skelOf('Stills', lastStill).forEach((part, order) => {
        stats.spines += 1
        emit({ op: 'spine', slot: `still${order}`, kind: 'still', skel: part.skel, atlas: part.atlas, anim: name, loop: name !== 'animation4', speed, order })
      })
      const linked = { animation2: ['Hse2', true], animation3: ['Hse3', true], animation4: ['Hse4', false] }[name]
      if (linked) {
        if (bgSeNow !== linked[0]) { emit({ op: 'bgse', src: `BgSe/${linked[0]}.ogg`, loop: linked[1] }); bgSeNow = linked[0] }
        if (name === 'animation4') emit({ op: 'flash', color: 'white', count: 2, seconds: 0.3 })
      } else if (bgSeNow) { emit({ op: 'bgseStop' }); bgSeNow = '' }
      if (name === 'animation5') emit({ op: 'wash', color: 'white', seconds: 1.5 })
    }

    // --- 镜头 ---
    const cam = [frame?.sceneCameraStartPositionX, frame?.sceneCameraStartPositionY, frame?.sceneCameraStartPositionZ, frame?.sceneCameraEndPositionX, frame?.sceneCameraEndPositionY, frame?.sceneCameraEndPositionZ].map(numOrNull)
    if (cam.some((v) => v !== null) && lastStill) {
      const from = [cam[0] ?? 0, cam[1] ?? 0, cam[2] ?? 0]
      emit({ op: 'camera', from, to: [cam[3] ?? from[0], cam[4] ?? from[1], cam[5] ?? from[2]], seconds: Math.max(0, Math.min(60, (numOrNull(frame?.sceneCameraActionDuration) ?? 2500) / 1000)) })
    }

    // --- 站位立绘 ---
    const stand = frame?.adventureCharacters
    if (Array.isArray(stand)) {
      if (!stand.length) {
        if (chars.size) { emit({ op: 'spineOff', prefix: 'Chara' }); chars.clear() }
      } else {
        for (const entry of stand) {
          const id = safeSeg(str(entry?.characterMasterId))
          if (!id) continue
          const position = intOf(entry?.characterPosition)
          const preferred = `${id}_${String(intOf(entry?.characterAppearance)).padStart(2, '0')}`
          const part = skelOf('Spines', id, preferred)[0]
          if (!part) continue
          const face = intOf(entry?.characterFacialExpression)
          const slot = `Chara${position}`
          chars.set(slot, { op: 'spine', slot, kind: 'chara', skel: part.skel, atlas: part.atlas, anim: FACIAL[face] || '', loop: true, speed: 1, x: positionX[position] ?? 0.5, action: intOf(entry?.characterAction) })
        }
        for (const [slot, spec] of chars) {
          emit({ ...spec })
          stats.spines += 1
          chars.set(slot, { ...spec, action: 0 })   // 动作只在这一帧做一次
        }
      }
    }

    // --- 声音 ---
    const bgm = cleanName(frame?.backgroundMusic)
    // noBGM{Fade_0.5,Delay_0}：停掉 BGM（花括号里是淡出秒数）
    const stop = /^noBGM(?:\{([^}]*)\})?$/i.exec(bgm)
    if (stop) {
      if (lastBgm) { emit({ op: 'bgmStop', fade: numOrNull(/Fade_([\d.]+)/i.exec(stop[1] || '')?.[1]) ?? 0 }); lastBgm = '' }
    } else if (bgm && bgm !== lastBgm) { emit({ op: 'bgm', src: resolveBgm(bgm) }); lastBgm = bgm }
    const se = cleanName(frame?.soundEffect)
    if (se) emit({ op: 'se', src: `Se/${se}.ogg` })
    const voice = cleanName(frame?.phraseVoice)
    if (voice && sceneId) emit({ op: 'voice', src: `AdventureVoice/${sceneId}/${voice}.ogg` })

    // --- 说话人 / 台词 ---
    const rawName = str(frame?.speakerName)
    const name = (rawName === '%username%' ? username : rawName).trim()
    if (name !== speaker) { emit({ op: 'speaker', segments: name ? [{ text: name }] : [] }); speaker = name }
    const line = str(frame?.phraseContents).replace(/\\n/g, '\n').trim()
    emit({ op: 'text', segments: line ? [{ text: line }] : [] })

    stats.commands += commands.length
    steps.push({ index: frameIndex, commands })
  })
  return { steps, stats }
}

export const tenkeiprdxJsonAdapter = { id: ADAPTER_ID, label: 'Tenkeiprdx 剧情 JSON', sniff, parse, contextFiles, contextDirs, prepare, catalog }
