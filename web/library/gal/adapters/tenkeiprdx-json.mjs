// 适配器：tenkeiprdx（Unity 剧情查看器）的剧情 JSON → 规范场景（gal-scene/1）。语义照反编译出来的查看器（见 private-scripts/tenkeiprdx-x）。
// 输入形态：对象形 { result: { sceneDetails: [{ assetId, sceneFrameDetails: [帧…] }] } }（取 assetId = 脚本文件名那一项，没有就取第一项）。
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
// 资源目录来自 config.adapterOptions['tenkeiprdx-json']：{ root（Imported 目录，相对媒体目录，默认 ''）, positionX（站位 → 横向位置 0..1）, unknownName（%username% 的默认值） }

export const ADAPTER_ID = 'tenkeiprdx-json'
const DEFAULT_POSITION_X = { 0: 0.5, 1: 0.3, 2: 0.7 }
const FACIAL = ['idle_normal', 'idle_joy', 'idle_sad', 'idle_angry', 'idle_surprise', 'idle_shy', 'idle_unique']
const joinPath = (...parts) => parts.filter(Boolean).join('/')
const rootOf = (options) => String(options?.root || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

export function sniff(text) {
  return /"(?:sceneFrameDetails|sceneDetails)"\s*:/.test(String(text || '').slice(0, 16384))
}

// ---------- 上下文：资源目录索引 + username ----------
export const contextFiles = (options) => [joinPath(rootOf(options), 'Masterdata/username.txt')]
export const contextDirs = (options) => ['Spines', 'Stills', 'Backgrounds', 'BGM'].map((dir) => joinPath(rootOf(options), dir))

const numericPrefix = (name) => { const m = /^(\d+)/.exec(name); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER }

export function prepare({ options, texts, files, toResourcePath }) {
  const toRes = toResourcePath || ((rel) => rel)
  const spines = new Map()   // 'Spines/<id>' / 'Stills/<名>' → [基名…]
  const backgrounds = new Map()
  const bgm = new Set()
  for (const rel of files || []) {
    const res = toRes(rel)
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
  const username = Object.values(texts || {})[0]?.trim() || ''
  return { spines, backgrounds, bgm, username, hasIndex: Boolean(files?.length), positionX: options?.positionX, unknownName: options?.unknownName }
}

// ---------- 解析 ----------
const str = (value) => (value === null || value === undefined ? '' : String(value))
const numOrNull = (value) => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null }
const intOf = (value, fallback = 0) => { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? n : fallback }
const cleanName = (value) => str(value).trim().replace(/\\/g, '/').replace(/^\/+/, '')
const safeSeg = (value) => (/^[^/\\\0]+$/.test(value) && value !== '.' && value !== '..' ? value : '')

export function parse(text, ctx = null, meta = {}) {
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  const details = data?.result?.sceneDetails
  if (!Array.isArray(details) || !details.length) throw new Error('找不到 sceneDetails')
  const scene = details.find((item) => str(item?.assetId) === str(meta?.stem)) || details[0]
  const sceneId = safeSeg(str(scene?.assetId) || str(meta?.stem))
  const frames = Array.isArray(scene?.sceneFrameDetails) ? scene.sceneFrameDetails : []
  const positionX = { ...DEFAULT_POSITION_X, ...(ctx?.positionX || {}) }
  const stats = { frames: frames.length, commands: 0, raw: {}, unresolved: {}, frameEffects: {}, spines: 0 }
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
    if (bgm && bgm !== lastBgm) { emit({ op: 'bgm', src: resolveBgm(bgm) }); lastBgm = bgm }
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

export const tenkeiprdxJsonAdapter = { id: ADAPTER_ID, label: 'Tenkeiprdx 剧情 JSON', sniff, parse, contextFiles, contextDirs, prepare }
