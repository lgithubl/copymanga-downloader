// Gal 播放器（DOM + 音频）。纯逻辑在 gal-engine.js。输入是服务端给的规范场景（见 web/library/gal/scene.mjs）。
// 目前渲染：背景（渐变/纯色）、说话人和台词（含描边/颜色等样式片段）、BGM/语音/音效、黑场、wait、视频。
// 立绘 / 遮罩 / Spine 等 raw 指令先忽略（脚本里保留着，后面接对应渲染方式时再用），播放器会在栏里提示忽略了多少条。
import { assetUrl, backlog, commandDuration, applyCommand, ratioOfStep, segmentsText, stateAt, stepOfRatio } from '/gal-engine.js'

const VOL_KEY = { bgm: 'copymanga.gal.bgmVolume', se: 'copymanga.gal.seVolume' }
const loadVolume = (key, fallback) => {
  const n = Number(localStorage.getItem(VOL_KEY[key]))
  return Number.isFinite(n) && localStorage.getItem(VOL_KEY[key]) !== null ? Math.max(0, Math.min(1, n)) : fallback
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

export function createGalPlayer({ container, reader, startRatio = 0, onStep = () => {} }) {
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
  const box = el('div', 'gal-box')
  const nameplate = el('div', 'gal-name')
  const textEl = el('div', 'gal-text')
  const marker = el('div', 'gal-next', '▼')
  box.append(nameplate, textEl, marker)
  const empty = el('div', 'gal-empty', '没有可播放的内容')
  stage.append(...layers, movie, black, box)
  const bar = el('div', 'gal-bar')
  const prevBtn = el('button', 'secondary', '◀ 上一句')
  const nextBtn = el('button', 'secondary', '下一句 ▶')
  const count = el('span', 'gal-count', '')
  const autoBtn = el('button', 'secondary', '自动')
  const logBtn = el('button', 'secondary', '记录')
  const fsBtn = el('button', 'secondary', '全屏')
  const bgmRange = el('input'); bgmRange.type = 'range'; bgmRange.min = '0'; bgmRange.max = '1'; bgmRange.step = '0.05'; bgmRange.title = 'BGM 音量'
  const seRange = el('input'); seRange.type = 'range'; seRange.min = '0'; seRange.max = '1'; seRange.step = '0.05'; seRange.title = '语音/音效音量'
  const bgmLabel = el('label', 'gal-vol', 'BGM '); bgmLabel.append(bgmRange)
  const seLabel = el('label', 'gal-vol', '语音 '); seLabel.append(seRange)
  const note = el('span', 'muted gal-note', '')
  bar.append(prevBtn, count, nextBtn, autoBtn, logBtn, bgmLabel, seLabel, fsBtn, note)
  const logPanel = el('div', 'gal-log')
  logPanel.hidden = true
  root.append(stage, bar, logPanel)
  container.replaceChildren(root)
  if (!total) stage.append(empty)

  // ---------- 音频 ----------
  let bgmVolume = loadVolume('bgm', 0.5)
  let seVolume = loadVolume('se', 1)
  bgmRange.value = String(bgmVolume)
  seRange.value = String(seVolume)
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
  function playOnce(src, kind) {
    const audio = new Audio(url(src))
    audio.volume = seVolume
    audio.addEventListener('error', () => markMissing(src))
    if (kind === 'voice') { voiceAudio?.pause(); voiceAudio = audio }
    audio.play().catch(() => {})
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
    const chars = segmentsText(state.text).length
    const wait = Math.max(1.2, Math.min(8, 0.8 + chars * 0.12))
    autoTimer = setTimeout(() => {
      // 语音还在放就等它放完
      if (voiceAudio && !voiceAudio.paused && !voiceAudio.ended) { scheduleAuto(); return }
      next()
    }, wait * 1000)
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
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else stage.requestFullscreen?.().catch(() => {})
  }

  stage.addEventListener('click', () => { logPanel.hidden = true; next() })
  nextBtn.addEventListener('click', next)
  prevBtn.addEventListener('click', prev)
  autoBtn.addEventListener('click', toggleAuto)
  logBtn.addEventListener('click', toggleLog)
  fsBtn.addEventListener('click', toggleFullscreen)
  bgmRange.addEventListener('input', () => { bgmVolume = Number(bgmRange.value); localStorage.setItem(VOL_KEY.bgm, String(bgmVolume)); if (bgmAudio) bgmAudio.volume = bgmVolume })
  seRange.addEventListener('input', () => { seVolume = Number(seRange.value); localStorage.setItem(VOL_KEY.se, String(seVolume)); movie.volume = seVolume })

  const onKey = (event) => {
    if (destroyed || !root.isConnected || event.ctrlKey || event.metaKey || event.altKey) return
    if (root.offsetParent === null) return   // 播放器不可见（切到别的页了）
    const tag = event.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return
    const key = event.key
    if (key === ' ' || key === 'Enter' || key === 'ArrowRight' || key === 'PageDown') next()
    else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'Backspace') prev()
    else if (key === 'a' || key === 'A') toggleAuto()
    else if (key === 'l' || key === 'L') toggleLog()
    else if (key === 'f' || key === 'F') toggleFullscreen()
    else if (key === 'Escape' && !logPanel.hidden) logPanel.hidden = true
    else return
    event.preventDefault()
  }
  document.addEventListener('keydown', onKey)

  // 播放器不在屏幕上（切走了 / 被隐藏）：BGM 和视频先停，回来再继续
  const visibility = new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting)
    wantBgm = visible
    if (visible) { bgmAudio?.play().catch(() => {}); if (!movie.hidden) movie.play().catch(() => {}) }
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
    if (document.fullscreenElement === stage) document.exitFullscreen?.()
  }

  // ---------- 启动 ----------
  const start = stepOfRatio(startRatio, total)
  updateCount()
  updateNote()
  if (total) {
    if (start > 0) { renderInstant(start); onStep(start, total) }
    else runStep(0)
  }
  return { destroy, next, prev, get index() { return index }, get total() { return total }, ratio: () => ratioOfStep(Math.max(0, index), total) }
}
