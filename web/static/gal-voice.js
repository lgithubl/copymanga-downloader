// Gal 列表上的「随机语音」：卡片 / 工具栏上的 🎲 按钮，不打开脚本就随机放一条属于它的语音（后端 random-voice 接口，见 web/library/gal/README.md）。
// 整个页面只有一个 Audio（放新的先停旧的）；点正在放的那张卡片的按钮 = 停止；放完 / 出错都会把按钮状态复位。
// 过滤（白名单 / 黑名单正则 + 匹配路径 / 说话人 / 台词）存 localStorage，发请求前先在这里校验（规则和后端 voice.mjs 一致，后端还会再校验）。
// 全部用 textContent 写入后端给的文字，不拼 innerHTML。

const KEYS = { include: 'copymanga.gal.voiceInclude', exclude: 'copymanga.gal.voiceExclude', target: 'copymanga.gal.voiceTarget' }
const SE_VOLUME_KEY = 'copymanga.gal.seVolume'   // 和播放器共用的音效 / 语音音量（0–1 的滑块值）
export const MAX_REGEX_LENGTH = 200
const TARGETS = [{ id: 'path', label: '路径' }, { id: 'speaker', label: '说话人' }, { id: 'text', label: '台词' }]

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}
const read = (key, fallback = '') => { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } }
const write = (key, value) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key) } catch { /* 隐私模式 */ } }

// 感知音量曲线：滑块值 p（0–1）→ 增益 p²（人耳对响度近似对数，线性滑块在低端太灵敏）。播放器里是同一个公式，这里单独写一份，不从 gal-player.js 引
export const voiceGain = (p) => { const v = Number(p); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) ** 2 : 1 }
const savedVolume = () => { const raw = read(SE_VOLUME_KEY, ''); return raw === '' ? 1 : voiceGain(raw) }

// ---------- 正则校验（和 web/library/gal/voice.mjs 的 compileVoiceRegex 同一套规则）----------
// 量词：返回 { end, repeat }；{n} 固定次数不算重复
function quantifierAt(pattern, i) {
  const c = pattern[i]
  let end
  let repeat
  if (c === '*' || c === '+') { end = i + 1; repeat = true }
  else if (c === '?') { end = i + 1; repeat = false }
  else if (c === '{') {
    const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(i, i + 24))
    if (!m) return null
    end = i + m[0].length
    repeat = m[2] ? (m[3] === '' || Number(m[3]) > 1) : false
  } else return null
  if (pattern[end] === '?') end += 1
  return { end, repeat }
}
function hasNestedQuantifier(pattern) {
  const stack = []
  let inClass = false
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]
    if (c === '\\') { i += 1; continue }
    if (inClass) { if (c === ']') inClass = false; continue }
    if (c === '[') { inClass = true; continue }
    if (c === '(') { stack.push(false); continue }
    if (c === ')') {
      const inner = stack.length ? stack.pop() : false
      const q = quantifierAt(pattern, i + 1)
      if (q?.repeat && inner) return true
      if (stack.length) stack[stack.length - 1] = stack[stack.length - 1] || inner || Boolean(q?.repeat)
      continue
    }
    const q = quantifierAt(pattern, i)
    if (q) {
      if (q.repeat && stack.length) stack[stack.length - 1] = true
      i = q.end - 1
    }
  }
  return false
}
// 返回错误说明；合法（或为空）返回 ''
export function regexProblem(source) {
  const text = String(source ?? '').trim()
  if (!text) return ''
  if (text.length > MAX_REGEX_LENGTH) return `太长（${text.length} > ${MAX_REGEX_LENGTH} 个字符）`
  if (/\\[1-9]|\\k</.test(text)) return '不允许反向引用（\\1 / \\k<名字>）'
  if (hasNestedQuantifier(text)) return '有量词套量词（如 (a+)+ / (\\w*)*），容易卡死，请改写'
  try { new RegExp(text, 'i') } catch (error) { return `不是合法的正则：${String(error.message).replace(/^Invalid regular expression: /, '')}` }
  return ''
}

export const loadVoiceFilter = () => {
  const target = read(KEYS.target, 'path')
  return { include: read(KEYS.include), exclude: read(KEYS.exclude), target: TARGETS.some((t) => t.id === target) ? target : 'path' }
}
const hasFilter = (f) => Boolean(f.include || f.exclude || f.target !== 'path')

// ---------- 页面级状态：一个 Audio、一条提示 ----------
let audio = null
let playingKey = ''          // 正在放（或正在取）的那个按钮的 key（卡片的 node id；工具栏 = ':list'）
let token = 0                // 每次点击 +1：旧请求回来时发现 token 变了就丢掉
let aborter = null
const listeners = new Set()  // 每个浏览器实例登记一个「按钮状态刷新」函数
const notify = () => { for (const fn of listeners) fn() }
let toastTimer = 0
let state = 'idle'           // idle | loading | playing

function stop() {
  token += 1
  aborter?.abort()
  aborter = null
  if (audio) { audio.pause(); audio.onended = null; audio.onerror = null; audio = null }
  playingKey = ''
  state = 'idle'
  notify()
}
export const stopVoice = stop

// reader：浏览节点那一层的 reader（取 resourceBase 推出接口地址）；host：提示条挂在哪（浏览根元素）
export function createGalVoice({ reader, host }) {
  const endpoint = `${String(reader.resourceBase || '').replace(/\/resource$/, '')}/random-voice`
  const buttons = new Map()    // key → Set<button>
  let toast = null

  const showToast = (text, { error = false, keep = false } = {}) => {
    if (!toast) {
      toast = el('div', 'gal-voice-toast')
      toast.setAttribute('role', 'status')
      toast.setAttribute('aria-live', 'polite')
      host.append(toast)
    }
    toast.textContent = text
    toast.classList.toggle('is-error', error)
    toast.hidden = false
    clearTimeout(toastTimer)
    if (!keep) toastTimer = setTimeout(() => { if (toast) toast.hidden = true }, error ? 5000 : 3000)
  }

  const refresh = () => {
    for (const [key, set] of buttons) {
      for (const button of set) {
        const on = key === playingKey && state !== 'idle'
        button.classList.toggle('is-playing', on && state === 'playing')
        button.classList.toggle('is-loading', on && state === 'loading')
        button.setAttribute('aria-pressed', on ? 'true' : 'false')
        button.setAttribute('aria-busy', on && state === 'loading' ? 'true' : 'false')
        const label = on ? (state === 'loading' ? '取一条语音…（再点取消）' : '停止播放') : button.dataset.idleTitle
        button.title = label
        button.setAttribute('aria-label', label)
        const glyph = on && state === 'playing' ? '⏹' : '🎲'
        button.textContent = button.dataset.text ? `${glyph} ${button.dataset.text}` : glyph
      }
    }
  }
  listeners.add(refresh)

  async function play(key, nodeId) {
    // 点的是正在放 / 正在取的这个按钮：停止
    if (playingKey === key && state !== 'idle') { stop(); if (toast) toast.hidden = true; return }
    stop()
    const filter = loadVoiceFilter()
    for (const [label, source] of [['白名单', filter.include], ['黑名单', filter.exclude]]) {
      const problem = regexProblem(source)
      if (problem) { showToast(`${label}${problem}（在 🎲 过滤里改）`, { error: true }); return }
    }
    const mine = ++token
    playingKey = key
    state = 'loading'
    aborter = new AbortController()
    notify()
    const query = new URLSearchParams({ node: nodeId })
    if (filter.include) query.set('include', filter.include)
    if (filter.exclude) query.set('exclude', filter.exclude)
    if (filter.target !== 'path') query.set('target', filter.target)
    let data = null
    let status = 0
    try {
      const response = await fetch(`${endpoint}?${query}`, { signal: aborter.signal })
      status = response.status
      data = await response.json().catch(() => null)
    } catch (error) {
      if (mine !== token) return
      stop()
      showToast(`取语音失败：${error?.message || error}`, { error: true })
      return
    }
    if (mine !== token) return   // 期间点了别的 / 停止
    if (status < 200 || status >= 300 || !data?.src) {
      stop()
      const hint = data?.error === 'all-filtered' && hasFilter(filter) ? '（在 🎲 过滤里放宽条件）' : ''
      showToast(`${data?.reason || data?.error || `请求失败（${status}）`}${hint}`, { error: true })
      return
    }
    const next = new Audio(data.src)
    next.volume = savedVolume()
    audio = next
    const finish = () => { if (audio === next && mine === token) { audio = null; playingKey = ''; state = 'idle'; notify(); setTimeout(() => { if (toast && !playingKey) toast.hidden = true }, 2500) } }
    next.onended = finish
    next.onerror = () => { if (audio === next) { stop(); showToast('这条语音放不出来（文件缺失或格式不支持）', { error: true }) } }
    const line = data.text ? `${data.speaker ? `${data.speaker}：` : ''}${data.text.length > 40 ? `${data.text.slice(0, 40)}…` : data.text}` : ''
    showToast([`🎲 ${data.scriptTitle || ''}`, line, `${data.index} / ${data.total}`].filter(Boolean).join(' · '), { keep: true })
    state = 'playing'
    notify()
    try { await next.play() } catch (error) {
      if (audio === next) { stop(); showToast(`浏览器不让自动播放：${error?.message || error}`, { error: true }) }
    }
  }

  // 卡片 / 工具栏上的按钮。不用 <button>：卡片本身就是 <button>，按钮里不能再套按钮；用 role=button + tabindex，回车 / 空格也能触发
  function attach(key, nodeId, { title, className = 'gal-card-voice', text = '' } = {}) {
    const button = el(text ? 'button' : 'span', className)
    if (text) button.type = 'button'
    else { button.setAttribute('role', 'button'); button.tabIndex = 0 }
    button.dataset.idleTitle = title
    if (text) button.dataset.text = text
    button.dataset.voiceKey = key
    const run = (event) => { event.preventDefault(); event.stopPropagation(); play(key, nodeId) }
    button.addEventListener('click', run)
    button.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') run(event); else event.stopPropagation() })
    button.addEventListener('dblclick', (event) => event.stopPropagation())
    if (!buttons.has(key)) buttons.set(key, new Set())
    buttons.get(key).add(button)
    refresh()
    return button
  }

  // 过滤设置弹层：白名单 / 黑名单 / 匹配对象；改了立刻校验、合法的才存
  function filterPopover() {
    const box = el('div', 'gal-voice-filter')
    box.hidden = true
    const filter = loadVoiceFilter()
    const row = (label, control) => { const r = el('label', 'gal-more-row'); r.append(el('span', 'gal-more-label', label), control); return r }
    const input = (value, placeholder) => {
      const node = el('input', 'gal-voice-input')
      node.type = 'text'
      node.value = value
      node.placeholder = placeholder
      node.maxLength = MAX_REGEX_LENGTH + 50   // 允许多输入一点好显示「太长」的提示
      node.spellcheck = false
      node.autocomplete = 'off'
      return node
    }
    const include = input(filter.include, '白名单（正则，空 = 全部），如 _h\\d+')
    const exclude = input(filter.exclude, '黑名单（正则，空 = 不排除），如 breath|moan')
    include.setAttribute('aria-label', '白名单正则')
    exclude.setAttribute('aria-label', '黑名单正则')
    const target = el('select', 'gal-voice-target')
    target.setAttribute('aria-label', '过滤匹配的对象')
    for (const entry of TARGETS) { const option = el('option', '', entry.label); option.value = entry.id; option.selected = entry.id === filter.target; target.append(option) }
    const status = el('div', 'gal-voice-status')
    status.setAttribute('role', 'status')
    const hint = el('div', 'gal-voice-hint', '正则不分大小写，匹配语音文件路径（或所选对象）；只放过滤后还剩的语音。')
    const clear = el('button', 'gal-pager-btn', '清空')
    clear.type = 'button'
    const validate = () => {
      const problems = [['白名单', include], ['黑名单', exclude]].map(([label, node]) => { const p = regexProblem(node.value); node.classList.toggle('is-invalid', Boolean(p)); node.setAttribute('aria-invalid', p ? 'true' : 'false'); return p ? `${label}${p}` : '' }).filter(Boolean)
      status.textContent = problems.length ? problems.join('；') : (include.value.trim() || exclude.value.trim() ? '正则有效，已保存' : '')
      status.classList.toggle('is-error', problems.length > 0)
      return problems.length === 0
    }
    const save = () => {
      if (!validate()) return   // 不合法的不存（保留上一次合法的）
      write(KEYS.include, include.value.trim())
      write(KEYS.exclude, exclude.value.trim())
      write(KEYS.target, target.value === 'path' ? '' : target.value)
      notify()
    }
    for (const node of [include, exclude]) node.addEventListener('input', save)
    target.addEventListener('change', save)
    clear.addEventListener('click', () => { include.value = ''; exclude.value = ''; target.value = 'path'; save(); status.textContent = '已清空' })
    box.append(row('白名单', include), row('黑名单', exclude), row('匹配', target), status, hint, clear)
    validate()
    if (!include.value && !exclude.value) status.textContent = ''
    return box
  }

  return { attach, filterPopover, stop, destroy: () => { listeners.delete(refresh); toast?.remove(); toast = null; stop() } }
}
