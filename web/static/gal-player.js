// Gal 播放器（DOM + 音频）。纯逻辑在 gal-engine.js。输入是服务端给的规范场景（见 web/library/gal/scene.mjs）。
// 目前渲染：背景（渐变/纯色）、说话人和台词（含描边/颜色等样式片段）、BGM/语音/音效、黑场、wait、视频。
// 另外：Spine 骨骼动画（站位立绘、整幅静态画面，gal-spine.js）、镜头（整个画面一起平移/缩放）、背景音效声道、闪屏。
// 立绘 / 遮罩等 raw 指令先忽略（脚本里保留着，后面接对应渲染方式时再用），播放器会在栏里提示忽略了多少条。
import { createSpineLayer } from '/gal-spine.js'
import { createStandLayer } from '/gal-stand.js'
import { attachBarLock } from '/gal-barlock.js'
import { activePath, applyCommand, assetUrl, backlog, choiceIn, commandDuration, condMet, dropChoicesFrom, ratioOfStep, segmentsText, stateAt, stepOfRatio } from '/gal-engine.js'

const VOL_KEY = { bgm: 'copymanga.gal.bgmVolume', se: 'copymanga.gal.seVolume' }
const loadVolume = (key, fallback) => {
  const n = Number(localStorage.getItem(VOL_KEY[key]))
  return Number.isFinite(n) && localStorage.getItem(VOL_KEY[key]) !== null ? Math.max(0, Math.min(1, n)) : fallback
}

// 其它界面设置，都按浏览器存（和音量、阅读速度这些一样，不进服务端配置）
export const GAL_SETTINGS = {
  boxOpacityKey: 'copymanga.gal.boxOpacity',        // 文本框背景不透明度 0..1
  boxOpacityDefault: 0.74,                          // 原来写死的值
  autoVoiceDelayKey: 'copymanga.gal.autoVoiceDelay', // 自动播放：语音播完后再等多少秒下一句
  autoVoiceDelayDefault: 1,
  autoVoiceDelayMax: 30,
  fontScaleKey: 'copymanga.gal.fontScale',          // 台词字体大小倍数（脚本里 <size=N> 的相对大小跟着一起缩放）
  fontScaleDefault: 1,
  fontScaleMin: 0.6,
  fontScaleMax: 2,
  frameFpsKey: 'copymanga.gal.frameFps',            // 帧动画（FRAME_ANIM）每秒几帧：脚本里的速度参数不用，统一在这里设
  frameFpsDefault: 30,
  frameFpsMax: 60,
  slowKey: 'copymanga.gal.slow',                    // 静态画面 animation4 的降速倍率（1 = 不降速）
  slowDefault: 0.2,                                 // 原查看器写死的值
  slowMin: 0.05,
  autoChoiceKey: 'copymanga.gal.autoChoice',        // 自动选择：-1 关；0 随机；1/2/3… 选对应项（没有该项就随机）
  autoChoiceDefault: -1,
  autoChoiceMax: 9,
  autoChoiceDelayMs: 700,                           // 选项出现后等一下再自动选，别闪过去
}
const loadNumber = (key, fallback, min, max) => {
  const raw = localStorage.getItem(key)
  const n = Number(raw)
  return raw !== null && raw !== '' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// 片段 → DOM（只用 textContent + 内联样式，没有 innerHTML）
export function renderSegments(target, segments, { plain = false } = {}) {
  target.replaceChildren()
  for (const segment of segments || []) {
    // 注音：<ruby>基字<rt>读音</rt></ruby>
    let span
    if (segment.ruby) {
      span = el('ruby', '')
      span.append(document.createTextNode(segment.text), el('rt', '', segment.ruby))
    } else span = el('span', '', segment.text)
    const style = segment.style || {}
    // <size=N>：N 以正文 30 为基准按比例缩放，再乘上界面里的字体大小设置（用 em，所以跟着一起变）
    if (style.size && !plain) span.style.fontSize = `${Math.max(0.6, Math.min(1.8, style.size / 30))}em`
    if (style.color && !plain) span.style.color = style.color
    if (style.bold) span.style.fontWeight = '700'
    if (style.italic) span.style.fontStyle = 'italic'
    if (style.outline && !plain) span.style.webkitTextStroke = `${Math.max(0.5, style.outline.width / 2)}px ${style.outline.color}`
    if (style.outline && !plain) span.style.paintOrder = 'stroke fill'
    target.append(span)
  }
}

// onToggleImmersive / onEscape / chapter 由页面传入：沉浸模式、上下一话、返回都属于页面层，播放器只负责放按钮和调用。
//   chapter: { canPrev(), canNext(), prev(), next(), back()（离开这个媒体）, up()（回到上一级列表，没有上一级就不传）, finish()（可选：最后一句看完——存「已看完」再回上一级列表；不传就直接 up()） }
export function createGalPlayer({ container, reader, startRatio = 0, startChoices = {}, onStep = () => {}, onChoices = () => {}, onToggleImmersive = null, onEscape = null, chapter = null }) {
  const scene = reader.scene
  // 选择 + 当前实际会走到的步（没选过的分支不在里面）。步数、进度比例、上一句/下一句都按这条路算
  let choices = { ...(startChoices || {}) }
  let path = activePath(scene, choices)
  const hasSteps = scene.steps.length > 0
  const base = reader.resourceBase
  const url = (src) => assetUrl(base, src)
  // 暂未渲染的指令：按指令名汇总（数量、样例参数）；config.rawIgnore（node.rawIgnore，正则列表）里匹配的算「已允许」，不计入提示
  const rawAllow = (Array.isArray(reader.node?.rawIgnore) ? reader.node.rawIgnore : []).map((source) => { try { return new RegExp(source, 'i') } catch { return null } }).filter(Boolean)
  const rawGroups = new Map()   // cmd -> { cmd, count, allowed, samples: [{ step, args }] }
  const rawKey = (cmd, args) => `${cmd}${(Array.isArray(args) ? args : args == null ? [] : [args]).map((a) => `,${a}`).join('')}`
  for (const step of scene.steps) {
    for (const command of step.commands || []) {
      if (command?.op !== 'raw') continue
      const group = rawGroups.get(command.cmd) || { cmd: command.cmd, count: 0, allowed: 0, samples: [] }
      group.count += 1
      const key = rawKey(command.cmd, command.args)
      if (rawAllow.some((re) => re.test(command.cmd) || re.test(key))) group.allowed += 1
      else if (group.samples.length < 3) group.samples.push({ step: step.index, args: key })
      rawGroups.set(command.cmd, group)
    }
  }
  if (!rawGroups.size) {   // 没扫到（指令藏在别处）：退回适配器的统计，只能按指令名判断
    for (const [cmd, count] of Object.entries(scene.stats?.raw || {})) rawGroups.set(cmd, { cmd, count, allowed: rawAllow.some((re) => re.test(cmd)) ? count : 0, samples: [] })
  }
  const rawTotal = [...rawGroups.values()].reduce((sum, g) => sum + g.count, 0)
  const rawIgnored = [...rawGroups.values()].reduce((sum, g) => sum + g.count - g.allowed, 0)
  const missing = new Set()

  // ---------- DOM ----------
  const root = el('div', 'gal-player')
  const stage = el('div', 'gal-stage')
  stage.tabIndex = 0
  const layers = [el('div', 'gal-bg'), el('div', 'gal-bg')]
  const movie = el('video', 'gal-movie')
  movie.hidden = true
  movie.playsInline = true
  const world = el('div', 'gal-world')   // 背景 + 视频 + Spine：镜头（平移/缩放）作用在它上面
  const black = el('div', 'gal-black')
  const flashEl = el('div', 'gal-flash')
  const hud = el('div', 'gal-hud')
  const box = el('div', 'gal-box')
  const nameplate = el('div', 'gal-name')
  const textEl = el('div', 'gal-text')
  const marker = el('div', 'gal-next', '▼')
  box.append(nameplate, textEl, marker)
  const empty = el('div', 'gal-empty', '没有可播放的内容')
  // 工具栏在文本框底部（同一块半透明背景里），按钮都是小号的；没有台词时文本框收起，工具栏仍留在原位
  const bar = el('div', 'gal-bar')
  const btn = (text, title, extra = '') => {
    const b = el('button', `gal-btn ${extra}`.trim(), text)
    b.type = 'button'
    b.title = title
    return b
  }
  const upBtn = btn('↑ 列表', '回到上一级列表（选其它脚本）', 'gal-up')
  const prevBtn = btn('◀ 上一句', '上一句（← / Backspace）', 'gal-prev')
  const count = el('span', 'gal-count', '')
  const nextBtn = btn('下一句 ▶', '下一句（空格 / 回车 / →；按住 Ctrl 快进）', 'gal-next-btn')
  const autoBtn = btn('自动', '自动播放（A / 单按 Alt）', 'gal-auto')
  const logBtn = btn('记录', '台词记录（L）', 'gal-log-btn')
  const autoSelBtn = btn('自选', '自动选择选项开关（具体选第几个在 ⚙ 里设置）', 'gal-autosel')
  const cfgBtn = btn('⚙', '设置：字体大小、文本框透明度、音量、自动播放、自动选择', 'gal-cfg')
  const chPrevBtn = btn('上话', '上一话', 'gal-ch-prev gal-imm-only')
  const chNextBtn = btn('下话', '下一话', 'gal-ch-next gal-imm-only')
  const contBtn = btn('继续下一章 ▶', '这一章看完了，继续下一章', 'gal-continue')
  contBtn.hidden = true
  const moreBtn = btn('更多 ▾', '沉浸 / 全屏', 'gal-more-btn')
  const immBtn = btn('沉浸', '沉浸模式（I）', 'gal-imm')
  const fsBtn = btn('全屏', '全屏（F）', 'gal-fs')
  const moreMenu = el('div', 'gal-more')
  moreMenu.hidden = true
  // 静态画面（Spine）的 animation4 播放时会降速，降到原速度的多少在这里改（1 = 不降速）
  const slowInput = el('input', 'gal-more-number')
  slowInput.type = 'number'
  slowInput.min = '0.05'
  slowInput.max = '1'
  slowInput.step = '0.05'
  slowInput.title = '动画 4 开始后 1 秒内降速到原速度的多少倍（1 = 不降速，原查看器是 0.2）'
  const slowRow = el('label', 'gal-more-field')
  slowRow.append(el('span', '', '动画4降速'), slowInput, el('span', '', '倍'))
  const fpsInput = el('input', 'gal-more-number')
  fpsInput.type = 'number'
  fpsInput.min = '1'
  fpsInput.max = String(GAL_SETTINGS.frameFpsMax)
  fpsInput.step = '1'
  fpsInput.title = '逐帧动画（FRAME_ANIM）每秒播放几帧，循环播放；脚本里写的速度不用'
  const fpsRow = el('label', 'gal-more-field')
  fpsRow.append(el('span', '', '帧动画速度'), fpsInput, el('span', '', '帧/秒'))
  moreMenu.append(immBtn, fsBtn, slowRow, fpsRow)
  const backBtn = btn('返回', '退出沉浸并离开这个媒体', 'gal-back gal-imm-only')
  const lockBtn = btn('🔒', '', 'gal-lock')
  const note = el('span', 'muted gal-note', '')
  note.setAttribute('role', 'button')
  note.tabIndex = 0
  bar.append(upBtn, prevBtn, count, nextBtn, contBtn, autoBtn, autoSelBtn, logBtn, cfgBtn, chPrevBtn, chNextBtn, moreBtn, lockBtn, backBtn, note)

  // 设置弹层：文本框透明度 / 音量 / 自动播放等待时间
  const settings = el('div', 'gal-settings')
  settings.hidden = true
  const range = (min, max, step, title) => { const r = el('input'); r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step); r.title = title; return r }
  const row = (label, control, valueEl) => { const r = el('label', 'gal-set-row'); r.append(el('span', 'gal-set-label', label), control); if (valueEl) r.append(valueEl); return r }
  const opacityRange = range(0, 100, 5, '文本框背景不透明度')
  const opacityValue = el('span', 'gal-set-value', '')
  const bgmRange = range(0, 1, 0.05, 'BGM 音量')
  const seRange = range(0, 1, 0.05, '语音/音效音量')
  const delayInput = el('input')
  delayInput.type = 'number'
  delayInput.min = '0'
  delayInput.max = String(GAL_SETTINGS.autoVoiceDelayMax)
  delayInput.step = '0.5'
  delayInput.title = '自动播放时，语音播完后再等多少秒进入下一句（没有语音的句子按台词长度估算）'
  delayInput.className = 'gal-set-number'
  const delayUnit = el('span', 'gal-set-value', '秒')
  const fontRange = range(Math.round(GAL_SETTINGS.fontScaleMin * 100), Math.round(GAL_SETTINGS.fontScaleMax * 100), 5, '台词字体大小')
  const fontValue = el('span', 'gal-set-value', '')
  const autoChoiceInput = el('input')
  autoChoiceInput.type = 'number'
  autoChoiceInput.min = '-1'
  autoChoiceInput.max = String(GAL_SETTINGS.autoChoiceMax)
  autoChoiceInput.step = '1'
  autoChoiceInput.title = '遇到选项时自动选：-1 不开启；0 随机选一个；1/2/3… 选对应的项（没有这一项就随机）'
  autoChoiceInput.className = 'gal-set-number gal-set-autochoice'
  settings.append(
    row('字体大小', fontRange, fontValue),
    row('文本框透明度', opacityRange, opacityValue),
    row('BGM 音量', bgmRange),
    row('语音/音效', seRange),
    row('自动：语音播完后等', delayInput, delayUnit),
    row('自动选择（-1 关 / 0 随机 / 1 2 3）', autoChoiceInput),
  )
  hud.append(box)
  // 工具栏不再叠在舞台里：放在舞台下面、播放器最底部，和列表页底部固定条同一个位置、同一个顺序（↑ 在最左）
  const barWrap = el('div', 'gal-bar-wrap')
  barWrap.append(bar, settings, moreMenu)
  world.append(...layers, movie)
  stage.append(world, black, flashEl, hud)
  const logPanel = el('div', 'gal-log')
  logPanel.hidden = true
  const choiceBox = el('div', 'gal-choices')   // 选项：画面正中，竖排
  choiceBox.hidden = true
  const diagPanel = el('div', 'gal-log gal-diag')   // 点右下角提示展开：未渲染的指令 / 缺资源 / Spine 状态，可复制
  diagPanel.hidden = true
  stage.append(logPanel, diagPanel, choiceBox)
  // 舞台外面包一层：沉浸 / 全屏时靠它按「去掉底栏后剩下的高度」定舞台大小（舞台 16:9，宽高都不超过这一层），底栏永远不会被挤出屏幕
  const stageArea = el('div', 'gal-stage-area')
  stageArea.append(stage)
  const barHot = el('div', 'gal-bar-hot')   // 底栏没锁定时：鼠标移到最下沿，底栏滑出来
  root.append(stageArea, barHot, barWrap)
  attachBarLock({ root, button: lockBtn })
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => root.style.setProperty('--gal-bar-h', `${Math.ceil(barWrap.getBoundingClientRect().height)}px`)).observe(barWrap)
  container.replaceChildren(root)
  if (!hasSteps) stage.append(empty)

  // ---------- 音频 ----------
  let bgmVolume = loadVolume('bgm', 0.5)
  let seVolume = loadVolume('se', 1)
  bgmRange.value = String(bgmVolume)
  seRange.value = String(seVolume)
  let slowFactor = loadNumber(GAL_SETTINGS.slowKey, GAL_SETTINGS.slowDefault, GAL_SETTINGS.slowMin, 1)
  slowInput.value = String(slowFactor)
  slowInput.addEventListener('change', () => {
    const n = Number(slowInput.value)
    slowFactor = Number.isFinite(n) ? Math.max(GAL_SETTINGS.slowMin, Math.min(1, n)) : GAL_SETTINGS.slowDefault
    slowInput.value = String(slowFactor)
    try { localStorage.setItem(GAL_SETTINGS.slowKey, String(slowFactor)) } catch { /* 存不了就只在这一页生效 */ }
    if (spineLayer) paintSpines(false)
  })
  let frameFps = Math.round(loadNumber(GAL_SETTINGS.frameFpsKey, GAL_SETTINGS.frameFpsDefault, 1, GAL_SETTINGS.frameFpsMax))
  fpsInput.value = String(frameFps)
  fpsInput.addEventListener('change', () => {
    const n = Math.round(Number(fpsInput.value))
    frameFps = Number.isFinite(n) ? Math.max(1, Math.min(GAL_SETTINGS.frameFpsMax, n)) : GAL_SETTINGS.frameFpsDefault
    fpsInput.value = String(frameFps)
    try { localStorage.setItem(GAL_SETTINGS.frameFpsKey, String(frameFps)) } catch { /* 存不了就只在这一页生效 */ }
    startFrames(state.bg?.frames ? layers[frontLayer] : null)
  })
  let boxOpacity = loadNumber(GAL_SETTINGS.boxOpacityKey, GAL_SETTINGS.boxOpacityDefault, 0, 1)
  let voiceDelay = loadNumber(GAL_SETTINGS.autoVoiceDelayKey, GAL_SETTINGS.autoVoiceDelayDefault, 0, GAL_SETTINGS.autoVoiceDelayMax)
  let fontScale = loadNumber(GAL_SETTINGS.fontScaleKey, GAL_SETTINGS.fontScaleDefault, GAL_SETTINGS.fontScaleMin, GAL_SETTINGS.fontScaleMax)
  let autoChoice = Math.round(loadNumber(GAL_SETTINGS.autoChoiceKey, GAL_SETTINGS.autoChoiceDefault, -1, GAL_SETTINGS.autoChoiceMax))
  let autoChoiceLast = autoChoice >= 0 ? autoChoice : 0
  opacityRange.value = String(Math.round(boxOpacity * 100))
  delayInput.value = String(voiceDelay)
  autoChoiceInput.value = String(autoChoice)
  fontRange.value = String(Math.round(fontScale * 100))
  const applyFont = () => {
    root.style.setProperty('--gal-font-scale', String(fontScale))
    fontValue.textContent = `${Math.round(fontScale * 100)}%`
  }
  applyFont()
  const applyAutoChoiceButton = () => {
    autoSelBtn.classList.toggle('active', autoChoice >= 0)
    autoSelBtn.textContent = autoChoice < 0 ? '自选' : autoChoice === 0 ? '自选:随机' : `自选:${autoChoice}`
  }
  applyAutoChoiceButton()
  const applyOpacity = () => {
    root.style.setProperty('--gal-box-alpha', String(boxOpacity))
    opacityValue.textContent = `${Math.round(boxOpacity * 100)}%`
    // 背景很透明时文字直接压在画面上：加一层深色字影保证能读
    root.classList.toggle('gal-clear', boxOpacity < 0.45)
  }
  applyOpacity()
  let bgmAudio = null
  let bgmSrc = ''
  let voiceAudio = null
  let wantBgm = true   // 播放器不可见时暂停，可见了再恢复

  const markMissing = (src) => { missing.add(src); updateNote() }
  let bgseAudio = null
  let bgseSrc = ''
  function setBgse(spec) {
    const src = spec?.src || ''
    if (src === bgseSrc && (!spec || bgseAudio?.loop === Boolean(spec.loop))) return
    bgseAudio?.pause()
    bgseAudio = null
    bgseSrc = src
    if (!src) return
    const audio = new Audio(url(src))
    audio.loop = Boolean(spec.loop)
    audio.volume = seVolume
    audio.addEventListener('error', () => markMissing(src))
    bgseAudio = audio
    if (wantBgm) audio.play().catch(() => {})
  }
  // 背景人声：多个槽同时循环播放（BG_VOICE / BG_VOICE_STOP）；状态里是 { 槽: { src, volume } }，这里让实际在播的和状态一致
  const bgVoices = new Map()   // 槽 → { src, audio, volume }
  function setBgVoices(spec = {}) {
    for (const [slot, voice] of [...bgVoices]) {
      if (spec[slot]?.src === voice.src) continue
      voice.audio.pause()
      bgVoices.delete(slot)
    }
    for (const [slot, want] of Object.entries(spec)) {
      if (bgVoices.has(slot) || !want?.src) continue
      const audio = new Audio(url(want.src))
      audio.loop = true
      audio.volume = Math.max(0, Math.min(1, seVolume * (Number.isFinite(Number(want.volume)) ? Number(want.volume) : 1)))
      audio.addEventListener('error', () => markMissing(want.src))
      bgVoices.set(slot, { src: want.src, audio, volume: want.volume })
      if (wantBgm) audio.play().catch(() => {})
    }
  }
  // 文本框显示 / 隐藏（UI_DISP）：隐藏时文本框透明且不挡点击
  function paintUi(instant, seconds = 0) {
    box.style.transition = instant || !seconds ? 'none' : `opacity ${seconds}s linear`
    box.style.opacity = state.ui ? '' : '0'
    box.style.pointerEvents = state.ui ? '' : 'none'
  }
  // 画面抖动（EFFECT_QUAKE / SCREEN_SHAKE）：纯装饰，不进状态
  function playShake(command) {
    if (typeof world.animate !== 'function') return
    const ms = Math.max(100, Math.min(5000, (command.seconds || 0.5) * 1000))
    const amp = Math.max(1, Math.min(30, (Number(command.strength) || 0.2) * 40))
    const axis = command.axis || 'horizontal'
    const frames = []
    for (let k = 0; k <= 10; k++) {
      const d = k === 10 ? 0 : (k % 2 ? -amp : amp) * (1 - k / 10)
      frames.push({ transform: axis === 'vertical' ? `translateY(${d}px)` : axis === 'overall' ? `translate(${d}px, ${-d}px)` : `translateX(${d}px)` })
    }
    world.animate(frames, { duration: ms, easing: 'steps(1)' })
  }
  function setBgm(src, fade = 0) {
    if (src === bgmSrc) return
    const old = bgmAudio
    bgmSrc = src
    bgmAudio = null
    if (old) fadeOut(old, fade)
    if (!src) return
    const audio = new Audio(url(src))
    audio.loop = true
    audio.volume = bgmVolume
    audio.addEventListener('error', () => markMissing(src))
    bgmAudio = audio
    if (wantBgm) audio.play().catch(() => {})   // 没有用户手势时浏览器会拒绝，第一次点击后下一次切换就能响
  }
  function fadeOut(audio, seconds) {
    if (!seconds) { audio.pause(); return }
    const start = audio.volume
    const began = performance.now()
    const tick = () => {
      const t = Math.min(1, (performance.now() - began) / (seconds * 1000))
      audio.volume = start * (1 - t)
      if (t < 1 && !destroyed) requestAnimationFrame(tick)
      else audio.pause()
    }
    tick()
  }
  // 这一步触发的语音。自动播放要等它播完（再多等 voiceDelay 秒）；放不出来（缺文件 / 浏览器拒绝自动播放）就按没有语音处理
  let stepVoice = null   // { step, endedAt, failed }
  function playOnce(src, kind) {
    const audio = new Audio(url(src))
    audio.volume = seVolume
    audio.addEventListener('error', () => markMissing(src))
    let record = null
    if (kind === 'voice') {
      voiceAudio?.pause()
      voiceAudio = audio
      record = { step: gen, endedAt: 0, failed: false }
      stepVoice = record
      audio.addEventListener('ended', () => { record.endedAt = performance.now(); if (stepVoice === record) scheduleAuto() })
      audio.addEventListener('error', () => { record.failed = true; if (stepVoice === record) scheduleAuto() })
    }
    audio.play().catch(() => { if (record) { record.failed = true; if (stepVoice === record) scheduleAuto() } })
  }

  // ---------- 画面 ----------
  let state = stateAt(scene, -1, choices)
  let frontLayer = 0
  let skipping = false
  let running = false
  let index = -1
  let destroyed = false
  let gen = 0   // 每次重绘/新一步 +1：被取代的 runStep 醒来后看到不一致就直接退出，不再改画面
  let autoTimer = 0
  let auto = false

  // 背景缩放 / 模糊 / 整体缩放平移（BG_SCALE / EFFECT_BG_BLUR / ZOOM）：缩放平移的单位是场景像素（1280×720），按舞台高度折算
  function paintBgFx(live) {
    const k = stage.clientHeight / 720
    const zoom = state.bgZoom
    const fx = state.bgfx
    layers.forEach((layer, index) => {
      const front = index === frontLayer
      const scale = (zoom?.scale || 1) * (front && fx?.scale ? fx.scale : 1)
      const tx = zoom ? zoom.x * k : 0
      const ty = zoom ? zoom.y * k : 0
      const before = layer.style.transform || 'none'
      const after = scale !== 1 || tx || ty ? `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(4)})` : 'none'
      layer.style.transform = after === 'none' ? '' : after
      layer.style.filter = front && fx?.blur ? `blur(${(fx.blur * k).toFixed(2)}px)` : ''
      if (live && front && fx?.scale && fx.seconds > 0 && typeof layer.animate === 'function' && before !== after) {
        layer.animate([{ transform: before }, { transform: after }], { duration: Math.min(60, fx.seconds) * 1000, easing: /^[a-z-]+$/i.test(fx.easing || '') ? fx.easing : 'linear' })
      }
    })
  }
  // 逐帧背景（FRAME_ANIM）：在当前前台层上循环换图，换背景 / 退出时停掉
  let frameTimer = 0
  function stopFrames() { clearInterval(frameTimer); frameTimer = 0 }
  function startFrames(layer) {
    stopFrames()
    const frames = state.bg?.frames
    if (!layer || !frames?.length) return
    for (const src of frames) { const image = new Image(); image.src = url(src) }   // 预载，播放时不卡
    let index = 0
    frameTimer = setInterval(() => {
      index = (index + 1) % frames.length
      layer.style.backgroundImage = `url("${url(frames[index])}")`
    }, 1000 / frameFps)
  }
  function paintBg(bg, fade, instant) {
    stopFrames()
    const next = layers[1 - frontLayer]
    const prev = layers[frontLayer]
    const seconds = instant ? 0 : fade
    const apply = (layer) => {
      layer.style.backgroundImage = bg?.src ? (bg.over ? `url("${url(bg.over)}"), url("${url(bg.src)}")` : `url("${url(bg.src)}")`) : 'none'
      layer.style.backgroundColor = bg?.color ? `rgb(${bg.color.join(',')})` : bg?.src ? '#0b0f17' : 'transparent'
    }
    for (const src of [bg?.src, bg?.over]) {
      if (!src) continue
      const probe = new Image()
      probe.onerror = () => markMissing(src)
      probe.src = url(src)
    }
    apply(next)
    next.style.transition = 'none'
    next.style.opacity = seconds ? '0' : bg ? '1' : '0'
    if (!seconds) {
      prev.style.transition = 'none'
      prev.style.opacity = '0'
      frontLayer = 1 - frontLayer
      if (bg?.frames) startFrames(layers[frontLayer])
      return
    }
    void next.offsetWidth
    next.style.transition = `opacity ${seconds}s linear`
    next.style.opacity = bg ? '1' : '0'
    prev.style.transition = `opacity ${seconds}s linear`
    if (bg) prev.style.opacity = '0'
    // bgoff 时旧层淡出、新层本来就是透明
    else prev.style.opacity = '0'
    frontLayer = 1 - frontLayer
    if (bg?.frames) startFrames(layers[frontLayer])
  }

  function paintText() {
    renderSegments(nameplate, state.speaker)
    nameplate.hidden = !segmentsText(state.speaker).trim()
    renderSegments(textEl, state.text)
    const hasText = Boolean(segmentsText(state.text).trim())
    box.hidden = !hasText
  }

  // 白屏（FADE_OUT2,white 淡到白并保持）：用闪屏那一层，保持时 opacity = 1；wash（白屏渐退）开始时先清掉它，让动画接手
  function paintWhite(instant, seconds = 0) {
    flashEl.style.backgroundColor = 'white'
    flashEl.style.transition = instant || !seconds ? 'none' : `opacity ${seconds}s linear`
    flashEl.style.opacity = state.white ? '1' : '0'
  }
  function paintBlack(instant, seconds = 0) {
    black.style.transition = instant || !seconds ? 'none' : `opacity ${seconds}s linear`
    black.style.opacity = state.black ? '1' : '0'
  }

  function paintMovie(instant) {
    if (!state.movie) { movie.pause(); movie.hidden = true; movie.removeAttribute('src'); return }
    const { srcs, loop } = state.movie
    let i = 0
    movie.hidden = false
    movie.volume = seVolume
    movie.loop = srcs.length === 1 && loop
    movie.src = url(srcs[0])
    movie.onerror = () => markMissing(srcs[i])
    movie.onended = () => {
      i += 1
      if (i < srcs.length) { movie.src = url(srcs[i]); movie.loop = i === srcs.length - 1 && loop; movie.play().catch(() => {}) }
    }
    movie.play().catch(() => {})
  }

  // Spine：第一次要画骨骼时才建 canvas / 加载运行时；运行时不在就提示，不影响别的
  let spineLayer = null
  let spineUnavailable = false
  function paintSpines(live) {
    const any = Object.keys(state.spines).length > 0
    if (!spineLayer && !any) return
    if (!spineLayer) {
      spineLayer = createSpineLayer({ parent: world, url, onMissing: markMissing, onUnavailable: () => { spineUnavailable = true; updateNote() } })
      if (!wantBgm) spineLayer.setPaused(true)
    }
    spineLayer.set(state.spines, { live, slow: slowFactor }).then(() => { if (!destroyed) updateNote() })
  }
  // 立绘（stand 指令，renpy-minashigo）：第一次要画时才建 canvas；放在背景和视频之上、Spine 之下
  let standLayer = null
  function paintStand() {
    if (!standLayer && !state.stand) return
    if (!standLayer) standLayer = createStandLayer({ parent: world, url, onMissing: markMissing })
    standLayer.set(state.stand)
  }
  // 镜头：位置（x,y 取反，按舞台高度换算）+ 缩放（z 是千分比，放大系数 1.3）。live 且有时长：从 from 平滑移到 to
  const zoomOf = (z) => (z ? 1 + (z / 1000) * 1.3 : 1)
  const cameraTransform = (pos) => {
    const unit = stage.clientHeight * 0.00165
    const turn = Number(pos?.[3]) ? ` rotate(${(-Number(pos[3])).toFixed(2)}deg)` : ''   // 第 4 项 = 旋转度数（逆时针为正，CSS 顺时针为正所以取反）；没有就不转
    return `translate(${(-(pos?.[0] || 0) * unit).toFixed(2)}px, ${((pos?.[1] || 0) * unit).toFixed(2)}px) scale(${zoomOf(pos?.[2]).toFixed(4)})${turn}`
  }
  function paintCamera(live) {
    const cam = state.camera
    world.dataset.camera = cam ? JSON.stringify(cam.to) : ''
    if (live && cam?.seconds > 0 && cam.from) {
      world.style.transition = 'none'
      world.style.transform = cameraTransform(cam.from)
      void world.offsetWidth
      world.style.transition = `transform ${cam.seconds}s linear`
    } else world.style.transition = 'none'
    world.style.transform = cam ? cameraTransform(cam.to) : 'none'
  }
  // 闪屏 / 整屏纯色渐退：纯装饰，不进状态
  function playFlash(command) {
    if (typeof flashEl.animate !== 'function') return
    flashEl.style.backgroundColor = /^[a-z]{3,20}$|^#[0-9a-f]{3,8}$/i.test(command.color || '') ? command.color : 'white'
    const ms = Math.max(50, Math.min(10000, (command.seconds || 0.3) * 1000))
    if (command.op === 'wash') { flashEl.style.transition = 'none'; flashEl.style.opacity = '0' }
    if (command.op === 'wash') flashEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'linear' })
    else flashEl.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], { duration: ms, iterations: Math.max(1, Math.min(5, command.count || 1)) })
  }

  // 一步到位渲染第 i 步之后的状态（后退 / 续播 / 开头）。不播语音和音效——那是一次性的
  function renderInstant(i) {
    gen += 1
    cancelChoice()
    running = false
    skipping = false
    state = stateAt(scene, i, choices)
    index = i
    paintBg(state.bg, 0, true)
    paintBgFx(false)
    paintText()
    paintBlack(true)
    paintWhite(true)
    paintMovie(true)
    paintSpines(false)
    paintStand()
    paintCamera(false)
    setBgm(state.bgm)
    setBgse(state.bgse)
    setBgVoices(state.bgvoices)
    paintUi(true)
    afterStep()
  }

  const sleep = (seconds) => new Promise((resolve) => {
    if (skipping || destroyed || !seconds) return resolve()
    const timer = setTimeout(done, seconds * 1000)
    const poll = setInterval(() => { if (skipping || destroyed) done() }, 30)
    function done() { clearTimeout(timer); clearInterval(poll); resolve() }
  })

  // 前进一步：指令按顺序执行，渐变/黑场/wait 会等够时间；点击（skipping）则直接跳到这一步结束
  async function runStep(i) {
    running = true
    skipping = fast   // 快进时每一步都按「已点击跳过」处理：渐变 / 等待 / 语音 / 音效都跳过
    const mine = ++gen
    stopAuto()
    cancelChoice()
    index = i
    reportStep()
    updateCount()
    const step = scene.steps[i]
    for (const command of step.commands) {
      if (destroyed || mine !== gen) return
      if (!condMet(command.when, state.vars)) continue   // 没选中的分支：整条跳过
      if (command.op === 'choice') {
        let picked = choices[command.id]
        if (picked === undefined) {
          skipping = false
          picked = await askChoice(command)
          if (destroyed || mine !== gen || picked == null) return   // 等选择的时候用户后退/跳走了
          choices = { ...choices, [command.id]: picked }
          path = activePath(scene, choices)
          onChoices({ ...choices })
          reportStep()
          updateCount()
        }
        applyCommand(state, command, choices)
        continue
      }
      const seconds = skipping ? 0 : commandDuration(command)
      applyCommand(state, command, choices)
      switch (command.op) {
        case 'bg':
        case 'bgoff':
          paintBg(state.bg, seconds, false)
          paintBgFx(false)
          await sleep(seconds)
          break
        case 'bgScale':
        case 'bgBlur':
        case 'bgZoom':
          paintBgFx(!skipping)
          break
        case 'speaker':
        case 'text':
          paintText()
          break
        case 'fade':
          paintBlack(skipping, seconds)
          paintWhite(skipping, seconds)
          await sleep(seconds)
          break
        case 'wait':
          await sleep(seconds)
          break
        case 'bgm':
          setBgm(command.src)
          break
        case 'bgmStop':
          setBgm('', command.fade)
          break
        case 'voice':
          if (!skipping) playOnce(command.src, 'voice')
          break
        case 'se':
          if (!skipping) playOnce(command.src, 'se')
          break
        case 'movie':
        case 'movieOff':
          paintMovie(false)
          break
        case 'spine':
        case 'spineOff':
          paintSpines(true)
          break
        case 'stand':
        case 'standOff':
          paintStand()
          break
        case 'camera':
          paintCamera(!skipping)
          break
        case 'bgse':
        case 'bgseStop':
          setBgse(state.bgse)
          break
        case 'bgvoice':
        case 'bgvoiceOff':
          setBgVoices(state.bgvoices)
          break
        case 'ui':
          paintUi(skipping, command.seconds || 0)
          break
        case 'shake':
          if (!skipping) playShake(command)
          break
        case 'flash':
        case 'wash':
          if (!skipping) playFlash(command)
          break
        default:
      }
    }
    if (destroyed || mine !== gen) return
    // 跳过时动画被截断，收尾把画面对齐到这一步该有的状态
    if (skipping) {
      paintBg(state.bg, 0, true)
      paintBgFx(false)
      paintBlack(true)
      paintWhite(true)
      paintCamera(false)
    }
    running = false
    skipping = false
    afterStep()
    preloadNext(path[path.indexOf(i) + 1])
  }

  function preloadNext(i) {
    const step = scene.steps[i]
    if (!step) return
    for (const command of step.commands) if (command.op === 'bg' && command.src) new Image().src = url(command.src)
  }

  const posNow = () => path.indexOf(index)
  // 进度按「第几步 / 当前会走到的总步数」报给页面（存成 scrollRatio）
  function reportStep() { onStep(Math.max(0, posNow()), path.length) }
  function updateCount() {
    const pos = posNow()
    count.textContent = path.length ? `${Math.max(0, pos) + 1} / ${path.length}` : '0 / 0'
    prevBtn.disabled = pos <= 0
    updateContinue()
    nextBtn.disabled = !path.length || (pos >= path.length - 1 && !running)
    if (!logPanel.hidden) renderLog()
  }
  function updateNote() {
    const parts = []
    if (rawIgnored) parts.push(`立绘/特效等 ${rawIgnored} 条指令暂未渲染`)
    if (spineUnavailable) parts.push('Spine 运行时缺失：立绘/动画未渲染')
    if (missing.size) parts.push(`缺少资源 ${missing.size} 个`)
    if (!parts.length && spineLayer?.info?.().length) parts.push(`骨骼 ${spineLayer.info().length} 个（点开看明细 / 复制日志）`)
    note.textContent = parts.join(' · ')
    note.title = parts.length ? '点击查看详情 / 复制日志' : ''
    note.classList.toggle('clickable', parts.length > 0)
    if (!diagPanel.hidden) renderDiag()
    cfgBtn.classList.toggle('warn', missing.size > 0)   // 工具栏很小，缺资源时在 ⚙ 上点个红点，别被忽略
  }
  // 看到这一章最后一句且有下一章：工具栏出现「继续下一章」（不管沉浸与否）
  function updateContinue() {
    contBtn.hidden = !(chapter?.canNext?.() && path.length && posNow() >= path.length - 1)
  }
  function updateChapterButtons() {
    chPrevBtn.disabled = !(chapter?.canPrev?.())
    chNextBtn.disabled = !(chapter?.canNext?.())
    chPrevBtn.hidden = chNextBtn.hidden = !chapter
    backBtn.hidden = !chapter
    upBtn.hidden = false   // 位置固定：没有上一级时禁用，不消失（别的按钮不会跟着左移）
    upBtn.disabled = !chapter?.up
    immBtn.hidden = !onToggleImmersive
    updateContinue()
  }
  function setImmersive(active) {
    root.classList.toggle('is-immersive', Boolean(active))
    immBtn.textContent = active ? '退出沉浸' : '沉浸'
    updateChapterButtons()
  }
  function afterStep() {
    updateCount()
    updateNote()
    marker.hidden = posNow() >= path.length - 1
    updateContinue()
    scheduleAuto()
  }

  // ---------- 操作 ----------
  function stopAuto() { clearTimeout(autoTimer); autoTimer = 0 }
  function scheduleAuto() {
    stopAuto()
    if (!auto || running || choiceState || destroyed) return
    // 最后一句：自动播放也要走完——一律回列表（想连着看下一章，在最后一句出现「继续下一章」时点它）
    const atEnd = posNow() >= path.length - 1
    if (atEnd && !path.length) return
    const advance = atEnd ? finish : next
    // 这一步有语音：等它播完，再多等 voiceDelay 秒。语音还在放时直接返回，播完（ended）会再调用本函数
    const voice = stepVoice && stepVoice.step === gen && !stepVoice.failed ? stepVoice : null
    if (voice) {
      if (!voice.endedAt) return
      const remaining = Math.max(0, voiceDelay * 1000 - (performance.now() - voice.endedAt))
      autoTimer = setTimeout(advance, remaining)
      return
    }
    // 没有语音（或语音放不出来）：按台词长度估一个阅读时间
    const chars = segmentsText(state.text).length
    const wait = Math.max(1.2, Math.min(8, 0.8 + chars * 0.12))
    autoTimer = setTimeout(advance, wait * 1000)
  }
  // 快进：按住 Ctrl（约 0.25 秒后进入，避免 Ctrl+F / Ctrl+C 误触）连续翻页——动画和语音 / 音效都跳过；遇到选项暂停（选完接着快进），到最后一步或松开 Ctrl 就停
  let fast = false
  let fastTimer = 0
  let fastLoop = 0
  const fastBadge = el('div', 'gal-fast-badge', '⏩ 快进中')
  fastBadge.hidden = true
  stage.append(fastBadge)
  function setFast(on) {
    if (on === fast || destroyed) return
    fast = on
    fastBadge.hidden = !on
    root.classList.toggle('is-fast', on)
    if (on) {
      stopAuto()
      voiceAudio?.pause()
      fastLoop = setInterval(fastTick, 70)
    } else {
      clearInterval(fastLoop)
      fastLoop = 0
      scheduleAuto()
    }
  }
  function fastTick() {
    if (destroyed || choiceState) return
    if (posNow() >= path.length - 1) {   // 快进到头：不是停在最后一句，而是和「看完」一样回列表（有下一章就停在「继续下一章」）
      setFast(false)
      if (!running || !fastLastKick) { fastLastKick = true; finishOrWait() }
      return
    }
    if (running) { skipping = true; return }
    next()
  }
  let fastLastKick = false
  // 在最后一步：这一步还在跑（渐变 / 等待）就先让它跳过，跑完（running 变 false）再收尾；别的情况直接收尾
  function finishOrWait() {
    if (!path.length) return
    if (running) { skipping = true; setTimeout(() => { if (running) { gen += 1; running = false; skipping = false } finish() }, 400); return }
    finish()
  }
  async function next() {
    if (destroyed || !hasSteps || choiceState) return   // 选项开着：只能选，不能翻页
    if (posNow() >= path.length - 1 && path.length) { finishOrWait(); return }   // 最后一步上点击 / 按键 = 看完（running 卡住也不会吞掉）
    if (running) { skipping = true; return }
    const target = path[posNow() + 1]
    if (target === undefined) {   // 最后一句之后再「下一句」：没有下一章就回列表，不停在原地
      if (path.length) finish()
      return
    }
    await runStep(target)
  }
  // 整个脚本看完：交给页面层存进度（已看完）并回到上一级列表；没有页面层的 finish 就直接 up()
  let finishing = false
  async function finish() {
    if (destroyed || finishing || choiceState) return
    finishing = true
    stopAuto()
    setFast(false)
    try { await (chapter?.finish ? chapter.finish() : chapter?.up?.()) } finally { finishing = false }
  }
  // 跳到某一步（后退 / 回看记录 / 续播）。回到一个已经选过的选项那一步 = 重选：这一步起的选择全部作废，从选项开始重新走
  function enterStep(target, { backward = false } = {}) {
    if (target === undefined) return
    const pending = choiceIn(scene, target)
    if (pending && backward && choices[pending.id] !== undefined) {
      choices = dropChoicesFrom(choices, target)
      path = activePath(scene, choices)
      onChoices({ ...choices })
    }
    if (pending && choices[pending.id] === undefined) {
      const k = path.indexOf(target)
      renderInstant(k > 0 ? path[k - 1] : -1)
      runStep(target)
    } else renderInstant(target)
    reportStep()
  }
  function prev() {
    if (destroyed || !hasSteps) return
    enterStep(path[Math.max(0, posNow() - 1)], { backward: true })
  }

  // ---------- 选项（画面正中、竖排；可以自动选） ----------
  let choiceState = null   // { resolve, command }
  let autoChoiceTimer = 0
  function askChoice(command) {
    return new Promise((resolve) => {
      cancelChoice()
      choiceBox.replaceChildren()
      for (const option of command.options) {
        const button = el('button', 'gal-choice')
        button.type = 'button'
        button.dataset.value = String(option.value)
        const text = el('span', 'gal-choice-text')
        renderSegments(text, option.segments)
        button.append(el('span', 'gal-choice-num', String(option.value)), text)
        button.addEventListener('click', () => pickChoice(option.value))
        choiceBox.append(button)
      }
      choiceBox.hidden = false
      choiceState = { resolve, command }
      maybeAutoChoose()
    })
  }
  function pickChoice(value) {
    if (!choiceState) return
    const state_ = choiceState
    choiceState = null
    clearTimeout(autoChoiceTimer)
    choiceBox.hidden = true
    state_.resolve(value)
  }
  function cancelChoice() {
    if (!choiceState) return
    const state_ = choiceState
    choiceState = null
    clearTimeout(autoChoiceTimer)
    choiceBox.hidden = true
    state_.resolve(null)
  }
  // 自动选择：-1 关；0 随机；n 选第 n 项（没有就随机）。选项出现后稍等一下再选
  function maybeAutoChoose() {
    clearTimeout(autoChoiceTimer)
    if (!choiceState || autoChoice < 0) return
    autoChoiceTimer = setTimeout(() => {
      if (!choiceState) return
      const options = choiceState.command.options
      const chosen = options.find((option) => option.value === autoChoice) || options[Math.floor(Math.random() * options.length)]
      pickChoice(chosen.value)
    }, GAL_SETTINGS.autoChoiceDelayMs)
  }
  function toggleAuto() {
    auto = !auto
    autoBtn.classList.toggle('active', auto)
    autoBtn.textContent = auto ? '自动中' : '自动'
    scheduleAuto()
  }
  function renderLog() {
    logPanel.replaceChildren()
    const lines = backlog(scene, Math.max(0, index), choices)
    if (!lines.length) logPanel.append(el('div', 'muted', '还没有台词'))
    for (const line of lines) {
      const row = el('div', 'gal-log-row')
      const who = el('span', 'gal-log-who')
      renderSegments(who, line.speaker, { plain: true })
      const what = el('span', 'gal-log-text')
      renderSegments(what, line.text, { plain: true })
      row.append(who, what)
      row.addEventListener('click', () => { logPanel.hidden = true; enterStep(line.step, { backward: true }) })
      logPanel.append(row)
    }
    logPanel.scrollTop = logPanel.scrollHeight
  }
  // 诊断文本：面板里显示的就是它，「复制日志」复制的也是它
  function diagText() {
    const lines = [`脚本：${reader.node?.title || ''}（${reader.node?.id || ''}）`, `适配器：${scene.adapter || ''}，${scene.steps.length} 步`]
    lines.push(`未渲染指令：共 ${rawTotal} 条，其中 ${rawTotal - rawIgnored} 条已被 rawIgnore 允许，${rawIgnored} 条计入提示`)
    for (const g of [...rawGroups.values()].sort((a, b) => b.count - a.count)) {
      lines.push(`  ${g.cmd} ×${g.count}${g.allowed ? `（允许 ${g.allowed}）` : ''}`)
      for (const sample of g.samples) lines.push(`    步 ${sample.step}：${sample.args}`)
    }
    if (rawAllow.length) lines.push(`rawIgnore：${(reader.node.rawIgnore || []).join('  |  ')}`)
    if (spineUnavailable) lines.push('Spine 运行时缺失：立绘/动画未渲染')
    const spineInfo = spineLayer?.info?.() || []
    if (spineInfo.length) {
      lines.push(`Spine 骨架 ${spineInfo.length} 个（当前画面）：`)
      for (const item of spineInfo) {
        lines.push(`  [${item.slot}] ${item.kind} ${item.skel}${item.loaded ? '' : '（还没加载好 / 加载失败）'}`)
        if (item.loaded) {
          lines.push(`    动画：要 ${item.requested || '（未指定）'} → 实际 ${item.used || '（无）'}${item.requested && item.requested !== item.used ? '  ← 名字对不上，退到了别的' : ''}`)
          if (item.missingAnimations?.length) lines.push(`    骨架里没有这些动画（脚本要的）：${item.missingAnimations.join(', ')}  ← 这些轨道没播`)
          lines.push(`    骨架里的动画（${item.animations.length}）：${item.animations.slice(0, 40).join(', ')}${item.animations.length > 40 ? ' …' : ''}`)
          lines.push(`    皮肤：${item.skins.join(', ') || '（无）'}${item.skin ? `；默认皮肤是空的，改用 ${item.skin}` : ''}；版本 ${item.version || '?'}；边界 ${item.bounds ? item.bounds.join(' ') : '?'}`)
        }
      }
    }
    const extra = scene.stats || {}
    if (extra.arrayGuess) lines.push(`数组形剧情：${extra.arrayGuess}`)
    if (extra.arrayUnknown) lines.push(`数组形里认不出的字符串位置：${JSON.stringify(extra.arrayUnknown).slice(0, 600)}`)
    if (extra.unresolved && Object.keys(extra.unresolved).length) lines.push(`没查到的资源名：${JSON.stringify(extra.unresolved).slice(0, 800)}`)
    if (missing.size) { lines.push(`缺少资源 ${missing.size} 个：`); for (const src of [...missing].slice(0, 100)) lines.push(`  ${src}`) }
    return lines.join('\n')
  }
  function renderDiag() {
    diagPanel.replaceChildren()
    const head = el('div', 'gal-diag-head')
    const copyBtn = el('button', 'gal-btn gal-diag-copy', '复制日志')
    copyBtn.type = 'button'
    copyBtn.addEventListener('click', async () => {
      const text = diagText()
      try { await navigator.clipboard.writeText(text) } catch {
        const area = el('textarea')
        area.value = text
        area.style.cssText = 'position:fixed;opacity:0'
        document.body.append(area)
        area.select()
        try { document.execCommand('copy') } catch { /* 剪贴板不可用：面板里的文字还能手动选 */ }
        area.remove()
      }
      copyBtn.textContent = '已复制'
      setTimeout(() => { copyBtn.textContent = '复制日志' }, 1500)
    })
    const closeBtn = el('button', 'gal-btn', '关闭')
    closeBtn.type = 'button'
    closeBtn.addEventListener('click', () => { diagPanel.hidden = true })
    head.append(el('strong', '', '渲染诊断'), copyBtn, closeBtn)
    const pre = el('pre', 'gal-diag-text', diagText())
    diagPanel.append(head, pre)
  }
  function toggleDiag() {
    if (!note.classList.contains('clickable') && diagPanel.hidden) return
    diagPanel.hidden = !diagPanel.hidden
    if (!diagPanel.hidden) { logPanel.hidden = true; renderDiag() }
  }
  const toggleMore = (open = moreMenu.hidden) => { moreMenu.hidden = !open }
  function toggleLog() {
    logPanel.hidden = !logPanel.hidden
    if (!logPanel.hidden) renderLog()
  }
  // 全屏的是整个播放器（root）而不是舞台：这样工具栏、设置弹层在全屏里也在，16:9 的舞台在里面居中留黑边
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else root.requestFullscreen?.().catch(() => {})
  }
  const toggleSettings = (open = settings.hidden) => {
    settings.hidden = !open
    cfgBtn.classList.toggle('active', open)
  }

  // 点舞台 = 下一句；设置弹层开着时，第一下只收弹层（不前进）
  stage.addEventListener('click', () => {
    if (choiceState) return
    if (!settings.hidden) { toggleSettings(false); return }
    if (!moreMenu.hidden) { toggleMore(false); return }
    if (!diagPanel.hidden) { diagPanel.hidden = true; return }
    logPanel.hidden = true
    next()
  })
  // 工具栏和设置弹层上的点击不能冒泡到舞台（否则点个按钮就翻页）
  // 记录面板也在舞台里：点记录里的一行（跳转）不能顺带触发舞台的「下一句」
  for (const part of [barWrap, logPanel, diagPanel, choiceBox]) part.addEventListener('click', (event) => event.stopPropagation())
  nextBtn.addEventListener('click', next)
  prevBtn.addEventListener('click', prev)
  autoBtn.addEventListener('click', toggleAuto)
  logBtn.addEventListener('click', toggleLog)
  cfgBtn.addEventListener('click', () => toggleSettings())
  fsBtn.addEventListener('click', () => { toggleMore(false); toggleFullscreen() })
  immBtn.addEventListener('click', () => { toggleMore(false); onToggleImmersive?.() })
  moreBtn.addEventListener('click', () => toggleMore())
  contBtn.addEventListener('click', () => chapter?.next?.())
  note.addEventListener('click', toggleDiag)
  note.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleDiag() } })
  chPrevBtn.addEventListener('click', () => chapter?.prev?.())
  chNextBtn.addEventListener('click', () => chapter?.next?.())
  backBtn.addEventListener('click', () => chapter?.back?.())
  upBtn.addEventListener('click', () => chapter?.up?.())
  opacityRange.addEventListener('input', () => {
    boxOpacity = Math.max(0, Math.min(1, Number(opacityRange.value) / 100))
    localStorage.setItem(GAL_SETTINGS.boxOpacityKey, String(boxOpacity))
    applyOpacity()
  })
  delayInput.addEventListener('input', () => {
    const n = Number(delayInput.value)
    if (!Number.isFinite(n) || delayInput.value === '') return   // 输入到一半（空/负号）先不动
    voiceDelay = Math.max(0, Math.min(GAL_SETTINGS.autoVoiceDelayMax, n))
    localStorage.setItem(GAL_SETTINGS.autoVoiceDelayKey, String(voiceDelay))
    scheduleAuto()   // 正在等的话按新的时间重新算
  })
  delayInput.addEventListener('change', () => { delayInput.value = String(voiceDelay) })
  fontRange.addEventListener('input', () => {
    fontScale = Math.max(GAL_SETTINGS.fontScaleMin, Math.min(GAL_SETTINGS.fontScaleMax, Number(fontRange.value) / 100))
    localStorage.setItem(GAL_SETTINGS.fontScaleKey, String(fontScale))
    applyFont()
  })
  const setAutoChoice = (value) => {
    autoChoice = Math.max(-1, Math.min(GAL_SETTINGS.autoChoiceMax, Math.round(value)))
    if (autoChoice >= 0) autoChoiceLast = autoChoice
    localStorage.setItem(GAL_SETTINGS.autoChoiceKey, String(autoChoice))
    autoChoiceInput.value = String(autoChoice)
    applyAutoChoiceButton()
    maybeAutoChoose()   // 选项正开着的话，按新的设置立刻生效
  }
  autoChoiceInput.addEventListener('input', () => {
    const n = Number(autoChoiceInput.value)
    if (!Number.isFinite(n) || autoChoiceInput.value === '' || autoChoiceInput.value === '-') return
    autoChoice = Math.max(-1, Math.min(GAL_SETTINGS.autoChoiceMax, Math.round(n)))
    if (autoChoice >= 0) autoChoiceLast = autoChoice
    localStorage.setItem(GAL_SETTINGS.autoChoiceKey, String(autoChoice))
    applyAutoChoiceButton()
    maybeAutoChoose()
  })
  autoChoiceInput.addEventListener('change', () => { autoChoiceInput.value = String(autoChoice) })
  autoSelBtn.addEventListener('click', () => setAutoChoice(autoChoice >= 0 ? -1 : autoChoiceLast))   // 越界/空的值收回到有效值
  bgmRange.addEventListener('input', () => { bgmVolume = Number(bgmRange.value); localStorage.setItem(VOL_KEY.bgm, String(bgmVolume)); if (bgmAudio) bgmAudio.volume = bgmVolume })
  seRange.addEventListener('input', () => { seVolume = Number(seRange.value); localStorage.setItem(VOL_KEY.se, String(seVolume)); movie.volume = seVolume; if (bgseAudio) bgseAudio.volume = seVolume })

  const onKey = (event) => {
    if (destroyed || !root.isConnected || event.ctrlKey || event.metaKey || event.altKey) return
    // 播放器不可见（切到别的页了）才忽略按键。不能用 offsetParent：全屏时根节点是 position:fixed，offsetParent 恒为 null，会把全屏里的按键全吞掉
    if (!root.getClientRects().length) return
    const tag = event.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return
    const key = event.key
    if (choiceState && /^[1-9]$/.test(key)) {
      const option = choiceState.command.options.find((o) => o.value === Number(key))
      if (option) { pickChoice(option.value); event.preventDefault() }
      return
    }
    if (key === ' ' || key === 'Enter' || key === 'ArrowRight' || key === 'PageDown') next()
    else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'Backspace') prev()
    else if (key === 'a' || key === 'A') toggleAuto()
    else if (key === 'l' || key === 'L') toggleLog()
    else if (key === 'f' || key === 'F') toggleFullscreen()
    else if (key === 'i' || key === 'I') onToggleImmersive?.()
    else if (key === 'Escape') {
      // 先收面板；都没开才交给页面（退出沉浸）。全屏下的 Esc 浏览器自己会退全屏，不会到这里
      if (!settings.hidden) toggleSettings(false)
      else if (!moreMenu.hidden) toggleMore(false)
      else if (!diagPanel.hidden) diagPanel.hidden = true
      else if (!logPanel.hidden) logPanel.hidden = true
      else if (onEscape) onEscape()
      else return
    } else return
    event.preventDefault()
  }
  document.addEventListener('keydown', onKey)
  // 修饰键：Ctrl 按住 = 快进；Alt（单按一下）= 切换自动播放。onKey 对带修饰键的组合键一律忽略，所以单独处理
  let altPure = false
  const typing = (event) => { const tag = event.target?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable }
  const onModDown = (event) => {
    if (destroyed || !root.isConnected || !root.getClientRects().length || typing(event)) return
    if (event.key === 'Control') {
      if (!event.repeat) { clearTimeout(fastTimer); fastTimer = setTimeout(() => setFast(true), 250) }
    } else {
      clearTimeout(fastTimer)   // Ctrl + 别的键（查找 / 复制…）：不是快进
      if (event.key === 'Alt') { if (!event.repeat) altPure = true } else altPure = false
    }
  }
  const onModUp = (event) => {
    if (event.key === 'Control') { clearTimeout(fastTimer); setFast(false) }
    else if (event.key === 'Alt') {
      if (altPure && !destroyed && root.isConnected && root.getClientRects().length && !typing(event)) toggleAuto()
      altPure = false
      event.preventDefault()   // Windows 上单按 Alt 会把焦点给浏览器菜单栏
    }
  }
  const onBlur = () => { clearTimeout(fastTimer); setFast(false); altPure = false }
  document.addEventListener('keydown', onModDown)
  document.addEventListener('keyup', onModUp)
  window.addEventListener('blur', onBlur)

  // 播放器不在屏幕上（切走了 / 被隐藏）：BGM 和视频先停，回来再继续
  const visibility = new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting)
    wantBgm = visible
    if (visible) { spineLayer?.setPaused(false); for (const v of bgVoices.values()) v.audio.play().catch(() => {}); bgseAudio?.play().catch(() => {}); bgmAudio?.play().catch(() => {}); if (!movie.hidden) movie.play().catch(() => {}); if (voiceAudio && !voiceAudio.ended && voiceAudio.paused) voiceAudio.play().catch(() => {}); scheduleAuto() }
    else { spineLayer?.setPaused(true); for (const v of bgVoices.values()) v.audio.pause(); bgseAudio?.pause(); bgmAudio?.pause(); voiceAudio?.pause(); movie.pause(); stopAuto() }
  })
  visibility.observe(stage)

  function destroy() {
    destroyed = true
    stopAuto()
    cancelChoice()
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('keydown', onModDown)
    document.removeEventListener('keyup', onModUp)
    window.removeEventListener('blur', onBlur)
    clearTimeout(fastTimer)
    stopFrames()
    clearInterval(fastLoop)
    visibility.disconnect()
    bgmAudio?.pause()
    bgseAudio?.pause()
    for (const v of bgVoices.values()) v.audio.pause()
    voiceAudio?.pause()
    movie.pause()
    movie.removeAttribute('src')
    spineLayer?.destroy()
    standLayer?.destroy()
    if (document.fullscreenElement === root) document.exitFullscreen?.()
  }

  // ---------- 启动 ----------
  const startPos = stepOfRatio(startRatio, path.length)
  updateCount()
  updateNote()
  updateChapterButtons()
  if (hasSteps && path.length) {
    if (startPos > 0) enterStep(path[startPos])
    else runStep(path[0])
  }
  return { destroy, next, prev, setImmersive, get index() { return index }, get total() { return path.length }, get choices() { return { ...choices } }, ratio: () => ratioOfStep(Math.max(0, posNow()), path.length) }
}
