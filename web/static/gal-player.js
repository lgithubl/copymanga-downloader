// Gal 播放器（DOM + 音频）。纯逻辑在 gal-engine.js。输入是服务端给的规范场景（见 web/library/gal/scene.mjs）。
// 目前渲染：背景（渐变/纯色）、说话人和台词（含描边/颜色等样式片段）、BGM/语音/音效、黑场、wait、视频。
// 立绘 / 遮罩 / Spine 等 raw 指令先忽略（脚本里保留着，后面接对应渲染方式时再用），播放器会在栏里提示忽略了多少条。
import { assetUrl, backlog, commandDuration, applyCommand, ratioOfStep, segmentsText, stateAt, stepOfRatio } from '/gal-engine.js'

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
    const span = el('span', '', segment.text)
    const style = segment.style || {}
    if (style.color && !plain) span.style.color = style.color
    if (style.bold) span.style.fontWeight = '700'
    if (style.italic) span.style.fontStyle = 'italic'
    if (style.outline && !plain) span.style.webkitTextStroke = `${Math.max(0.5, style.outline.width / 2)}px ${style.outline.color}`
    if (style.outline && !plain) span.style.paintOrder = 'stroke fill'
    target.append(span)
  }
}

// onToggleImmersive / onEscape / chapter 由页面传入：沉浸模式、上下一话、返回都属于页面层，播放器只负责放按钮和调用。
//   chapter: { canPrev(), canNext(), prev(), next(), back()（离开这个媒体）, up()（回到上一级列表，没有上一级就不传） }
export function createGalPlayer({ container, reader, startRatio = 0, onStep = () => {}, onToggleImmersive = null, onEscape = null, chapter = null }) {
  const scene = reader.scene
  const total = scene.steps.length
  const base = reader.resourceBase
  const url = (src) => assetUrl(base, src)
  const rawIgnored = Object.values(scene.stats?.raw || {}).reduce((a, b) => a + b, 0)
  const missing = new Set()

  // ---------- DOM ----------
  const root = el('div', 'gal-player')
  const stage = el('div', 'gal-stage')
  stage.tabIndex = 0
  const layers = [el('div', 'gal-bg'), el('div', 'gal-bg')]
  const movie = el('video', 'gal-movie')
  movie.hidden = true
  movie.playsInline = true
  const black = el('div', 'gal-black')
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
  const nextBtn = btn('下一句 ▶', '下一句（空格 / 回车 / →）', 'gal-next-btn')
  const autoBtn = btn('自动', '自动播放（A）', 'gal-auto')
  const logBtn = btn('记录', '台词记录（L）', 'gal-log-btn')
  const cfgBtn = btn('⚙', '设置：文本框透明度、音量、自动播放等待时间', 'gal-cfg')
  const chPrevBtn = btn('上话', '上一话', 'gal-ch-prev gal-imm-only')
  const chNextBtn = btn('下话', '下一话', 'gal-ch-next gal-imm-only')
  const immBtn = btn('沉浸', '沉浸模式（I）', 'gal-imm')
  const fsBtn = btn('全屏', '全屏（F）', 'gal-fs')
  const backBtn = btn('返回', '退出沉浸并离开这个媒体', 'gal-back gal-imm-only')
  const note = el('span', 'muted gal-note', '')
  bar.append(upBtn, prevBtn, count, nextBtn, autoBtn, logBtn, cfgBtn, chPrevBtn, chNextBtn, immBtn, fsBtn, backBtn, note)

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
  settings.append(
    row('文本框透明度', opacityRange, opacityValue),
    row('BGM 音量', bgmRange),
    row('语音/音效', seRange),
    row('自动：语音播完后等', delayInput, delayUnit),
  )
  hud.append(box, bar, settings)
  stage.append(...layers, movie, black, hud)
  const logPanel = el('div', 'gal-log')
  logPanel.hidden = true
  stage.append(logPanel)
  root.append(stage)
  container.replaceChildren(root)
  if (!total) stage.append(empty)

  // ---------- 音频 ----------
  let bgmVolume = loadVolume('bgm', 0.5)
  let seVolume = loadVolume('se', 1)
  bgmRange.value = String(bgmVolume)
  seRange.value = String(seVolume)
  let boxOpacity = loadNumber(GAL_SETTINGS.boxOpacityKey, GAL_SETTINGS.boxOpacityDefault, 0, 1)
  let voiceDelay = loadNumber(GAL_SETTINGS.autoVoiceDelayKey, GAL_SETTINGS.autoVoiceDelayDefault, 0, GAL_SETTINGS.autoVoiceDelayMax)
  opacityRange.value = String(Math.round(boxOpacity * 100))
  delayInput.value = String(voiceDelay)
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
  let state = stateAt(scene, -1)
  let frontLayer = 0
  let skipping = false
  let running = false
  let index = -1
  let destroyed = false
  let gen = 0   // 每次重绘/新一步 +1：被取代的 runStep 醒来后看到不一致就直接退出，不再改画面
  let autoTimer = 0
  let auto = false

  function paintBg(bg, fade, instant) {
    const next = layers[1 - frontLayer]
    const prev = layers[frontLayer]
    const seconds = instant ? 0 : fade
    const apply = (layer) => {
      layer.style.backgroundImage = bg?.src ? `url("${url(bg.src)}")` : 'none'
      layer.style.backgroundColor = bg?.color ? `rgb(${bg.color.join(',')})` : bg?.src ? '#0b0f17' : 'transparent'
    }
    if (bg?.src) {
      const probe = new Image()
      probe.onerror = () => markMissing(bg.src)
      probe.src = url(bg.src)
    }
    apply(next)
    next.style.transition = 'none'
    next.style.opacity = seconds ? '0' : bg ? '1' : '0'
    if (!seconds) {
      prev.style.transition = 'none'
      prev.style.opacity = '0'
      frontLayer = 1 - frontLayer
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
  }

  function paintText() {
    renderSegments(nameplate, state.speaker)
    nameplate.hidden = !segmentsText(state.speaker).trim()
    renderSegments(textEl, state.text)
    const hasText = Boolean(segmentsText(state.text).trim())
    box.hidden = !hasText
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

  // 一步到位渲染第 i 步之后的状态（后退 / 续播 / 开头）。不播语音和音效——那是一次性的
  function renderInstant(i) {
    gen += 1
    running = false
    skipping = false
    state = stateAt(scene, i)
    index = i
    paintBg(state.bg, 0, true)
    paintText()
    paintBlack(true)
    paintMovie(true)
    setBgm(state.bgm)
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
    skipping = false
    const mine = ++gen
    index = i
    onStep(i, total)
    updateCount()
    const step = scene.steps[i]
    for (const command of step.commands) {
      if (destroyed || mine !== gen) return
      const seconds = skipping ? 0 : commandDuration(command)
      applyCommand(state, command)
      switch (command.op) {
        case 'bg':
        case 'bgoff':
          paintBg(state.bg, seconds, false)
          await sleep(seconds)
          break
        case 'speaker':
        case 'text':
          paintText()
          break
        case 'fade':
          paintBlack(skipping, seconds)
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
        default:
      }
    }
    if (destroyed || mine !== gen) return
    // 跳过时动画被截断，收尾把画面对齐到这一步该有的状态
    if (skipping) {
      paintBg(state.bg, 0, true)
      paintBlack(true)
    }
    running = false
    skipping = false
    afterStep()
    preloadNext(i + 1)
  }

  function preloadNext(i) {
    const step = scene.steps[i]
    if (!step) return
    for (const command of step.commands) if (command.op === 'bg' && command.src) new Image().src = url(command.src)
  }

  function updateCount() {
    count.textContent = total ? `${Math.max(0, index) + 1} / ${total}` : '0 / 0'
    prevBtn.disabled = index <= 0
    nextBtn.disabled = !total || (index >= total - 1 && !running)
    if (!logPanel.hidden) renderLog()
  }
  function updateNote() {
    const parts = []
    if (rawIgnored) parts.push(`立绘/特效等 ${rawIgnored} 条指令暂未渲染`)
    if (missing.size) parts.push(`缺少资源 ${missing.size} 个`)
    note.textContent = parts.join(' · ')
    note.title = [...missing].slice(0, 30).join('\n')
    cfgBtn.classList.toggle('warn', missing.size > 0)   // 工具栏很小，缺资源时在 ⚙ 上点个红点，别被忽略
  }
  function updateChapterButtons() {
    chPrevBtn.disabled = !(chapter?.canPrev?.())
    chNextBtn.disabled = !(chapter?.canNext?.())
    chPrevBtn.hidden = chNextBtn.hidden = !chapter
    backBtn.hidden = !chapter
    upBtn.hidden = !chapter?.up
    immBtn.hidden = !onToggleImmersive
  }
  function setImmersive(active) {
    root.classList.toggle('is-immersive', Boolean(active))
    immBtn.textContent = active ? '退出沉浸' : '沉浸'
    immBtn.classList.toggle('active', Boolean(active))
    updateChapterButtons()
  }
  function afterStep() {
    updateCount()
    updateNote()
    marker.hidden = index >= total - 1
    scheduleAuto()
  }

  // ---------- 操作 ----------
  function stopAuto() { clearTimeout(autoTimer); autoTimer = 0 }
  function scheduleAuto() {
    stopAuto()
    if (!auto || running || index >= total - 1 || destroyed) return
    // 这一步有语音：等它播完，再多等 voiceDelay 秒。语音还在放时直接返回，播完（ended）会再调用本函数
    const voice = stepVoice && stepVoice.step === gen && !stepVoice.failed ? stepVoice : null
    if (voice) {
      if (!voice.endedAt) return
      const remaining = Math.max(0, voiceDelay * 1000 - (performance.now() - voice.endedAt))
      autoTimer = setTimeout(next, remaining)
      return
    }
    // 没有语音（或语音放不出来）：按台词长度估一个阅读时间
    const chars = segmentsText(state.text).length
    const wait = Math.max(1.2, Math.min(8, 0.8 + chars * 0.12))
    autoTimer = setTimeout(next, wait * 1000)
  }
  async function next() {
    if (destroyed || !total) return
    if (running) { skipping = true; return }
    if (index >= total - 1) return
    await runStep(index + 1)
  }
  function prev() {
    if (destroyed || !total) return
    const target = Math.max(0, index - 1)
    renderInstant(target)
    onStep(target, total)
  }
  function toggleAuto() {
    auto = !auto
    autoBtn.classList.toggle('active', auto)
    autoBtn.textContent = auto ? '自动中' : '自动'
    scheduleAuto()
  }
  function renderLog() {
    logPanel.replaceChildren()
    const lines = backlog(scene, Math.max(0, index))
    if (!lines.length) logPanel.append(el('div', 'muted', '还没有台词'))
    for (const line of lines) {
      const row = el('div', 'gal-log-row')
      const who = el('span', 'gal-log-who')
      renderSegments(who, line.speaker, { plain: true })
      const what = el('span', 'gal-log-text')
      renderSegments(what, line.text, { plain: true })
      row.append(who, what)
      row.addEventListener('click', () => { logPanel.hidden = true; renderInstant(line.step); onStep(line.step, total) })
      logPanel.append(row)
    }
    logPanel.scrollTop = logPanel.scrollHeight
  }
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
    if (!settings.hidden) { toggleSettings(false); return }
    logPanel.hidden = true
    next()
  })
  // 工具栏和设置弹层上的点击不能冒泡到舞台（否则点个按钮就翻页）
  // 记录面板也在舞台里：点记录里的一行（跳转）不能顺带触发舞台的「下一句」
  for (const part of [bar, settings, logPanel]) part.addEventListener('click', (event) => event.stopPropagation())
  nextBtn.addEventListener('click', next)
  prevBtn.addEventListener('click', prev)
  autoBtn.addEventListener('click', toggleAuto)
  logBtn.addEventListener('click', toggleLog)
  cfgBtn.addEventListener('click', () => toggleSettings())
  fsBtn.addEventListener('click', toggleFullscreen)
  immBtn.addEventListener('click', () => onToggleImmersive?.())
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
  delayInput.addEventListener('change', () => { delayInput.value = String(voiceDelay) })   // 越界/空的值收回到有效值
  bgmRange.addEventListener('input', () => { bgmVolume = Number(bgmRange.value); localStorage.setItem(VOL_KEY.bgm, String(bgmVolume)); if (bgmAudio) bgmAudio.volume = bgmVolume })
  seRange.addEventListener('input', () => { seVolume = Number(seRange.value); localStorage.setItem(VOL_KEY.se, String(seVolume)); movie.volume = seVolume })

  const onKey = (event) => {
    if (destroyed || !root.isConnected || event.ctrlKey || event.metaKey || event.altKey) return
    // 播放器不可见（切到别的页了）才忽略按键。不能用 offsetParent：全屏时根节点是 position:fixed，offsetParent 恒为 null，会把全屏里的按键全吞掉
    if (!root.getClientRects().length) return
    const tag = event.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return
    const key = event.key
    if (key === ' ' || key === 'Enter' || key === 'ArrowRight' || key === 'PageDown') next()
    else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'Backspace') prev()
    else if (key === 'a' || key === 'A') toggleAuto()
    else if (key === 'l' || key === 'L') toggleLog()
    else if (key === 'f' || key === 'F') toggleFullscreen()
    else if (key === 'i' || key === 'I') onToggleImmersive?.()
    else if (key === 'Escape') {
      // 先收面板；都没开才交给页面（退出沉浸）。全屏下的 Esc 浏览器自己会退全屏，不会到这里
      if (!settings.hidden) toggleSettings(false)
      else if (!logPanel.hidden) logPanel.hidden = true
      else if (onEscape) onEscape()
      else return
    } else return
    event.preventDefault()
  }
  document.addEventListener('keydown', onKey)

  // 播放器不在屏幕上（切走了 / 被隐藏）：BGM 和视频先停，回来再继续
  const visibility = new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting)
    wantBgm = visible
    if (visible) { bgmAudio?.play().catch(() => {}); if (!movie.hidden) movie.play().catch(() => {}); if (voiceAudio && !voiceAudio.ended && voiceAudio.paused) voiceAudio.play().catch(() => {}); scheduleAuto() }
    else { bgmAudio?.pause(); voiceAudio?.pause(); movie.pause(); stopAuto() }
  })
  visibility.observe(stage)

  function destroy() {
    destroyed = true
    stopAuto()
    document.removeEventListener('keydown', onKey)
    visibility.disconnect()
    bgmAudio?.pause()
    voiceAudio?.pause()
    movie.pause()
    movie.removeAttribute('src')
    if (document.fullscreenElement === root) document.exitFullscreen?.()
  }

  // ---------- 启动 ----------
  const start = stepOfRatio(startRatio, total)
  updateCount()
  updateNote()
  updateChapterButtons()
  if (total) {
    if (start > 0) { renderInstant(start); onStep(start, total) }
    else runStep(0)
  }
  return { destroy, next, prev, setImmersive, get index() { return index }, get total() { return total }, ratio: () => ratioOfStep(Math.max(0, index), total) }
}
