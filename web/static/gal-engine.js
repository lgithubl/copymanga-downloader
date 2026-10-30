// Gal 播放器的纯逻辑（不碰 DOM / Audio，Node 里直接单测：scripts/dev/gal-selftest.mjs）。
// 输入是规范场景（见 web/library/gal/scene.mjs）。状态 = 播放到某一步之后画面/声音「应该是什么样」，
// 前进时按指令逐条动画执行，后退/续播/跳转时直接 stateAt() 一步到位。

export function initialState() {
  return { bg: null, speaker: [], text: [], bgm: '', black: false, movie: null, spines: {}, stand: null, stands: [], overlays: [], camera: null, bgse: null, bgvoices: {}, ui: true, bgfx: null, bgZoom: null, bgPan: null, white: false, vars: {} }
}

// ---------- 分支：选项 + 条件 ----------
// 指令可以带 when: [{ var, op, value, not? }]（全部成立才执行）；choice 指令让玩家选，选的序号（1 起）记进变量。
// 变量没设过（还没选）时，带这个变量条件的指令一律不执行（包括 else / 取反）。
// 选了哪个按 choice.id 存在 choices 里（{ [id]: 序号 }），所以回看 / 续播 / 重选都能重放出同一条路。
const numeric = (v) => v !== '' && v !== null && Number.isFinite(Number(v))
export function condMet(when, vars = {}) {
  for (const cond of when || []) {
    // 变量还没设过（选项还没选）：所有条件都不成立——分支只有在选了之后才出现
    if (vars[cond.var] === undefined) return false
    const left = String(vars[cond.var])
    const right = String(cond.value)
    const both = numeric(left) && numeric(right)
    let ok
    switch (cond.op) {
      case '===': case '==': ok = both ? Number(left) === Number(right) : left === right; break
      case '!==': case '!=': ok = both ? Number(left) !== Number(right) : left !== right; break
      case '>': ok = both && Number(left) > Number(right); break
      case '<': ok = both && Number(left) < Number(right); break
      case '>=': ok = both && Number(left) >= Number(right); break
      case '<=': ok = both && Number(left) <= Number(right); break
      default: ok = true
    }
    if (cond.not ? ok : !ok) return false
  }
  return true
}

const recordChoice = (vars, command, choices) => {
  const picked = choices?.[command.id]
  if (picked !== undefined && picked !== null) vars[command.var] = String(picked)
}

// 按当前选择走一遍：visit(step, command, active, vars)；返回每一步是否有指令会执行
function walk(scene, last, choices, visit) {
  const vars = {}
  const active = []
  const end = Math.min(last, (scene?.steps?.length || 0) - 1)
  for (let i = 0; i <= end; i++) {
    let any = false
    for (const command of scene.steps[i].commands) {
      const on = condMet(command.when, vars)
      if (on) {
        any = true
        if (command.op === 'choice') recordChoice(vars, command, choices)
      }
      visit?.(i, command, on, vars)
    }
    active[i] = any
  }
  return active
}

// 当前选择下实际会走到的步（下标升序）。没选过的分支（条件不成立）不在里面
export function activePath(scene, choices = {}) {
  const active = walk(scene, Infinity, choices)
  const path = []
  active.forEach((on, i) => { if (on) path.push(i) })
  return path
}

// 这一步里的选项（没有就是 null）
export const choiceIn = (scene, stepIndex) => scene?.steps?.[stepIndex]?.commands.find((c) => c.op === 'choice') || null

// 从第 fromStep 步起（含）的所有选择作废——回到选项那一步重选时用
export function dropChoicesFrom(choices, fromStep) {
  const next = {}
  for (const [id, value] of Object.entries(choices || {})) if (Number(id.split(':')[0]) < fromStep) next[id] = value
  return next
}

// 把一条指令作用到状态上（不含时长/动画）。voice / se 是一次性事件，不进状态。
export function applyCommand(state, command, choices = null) {
  if (command.when && !condMet(command.when, state.vars)) return state
  switch (command.op) {
    case 'choice':
      recordChoice(state.vars, command, choices)
      break
    case 'bg':
      state.bg = command.src ? { src: command.src, ...(command.over ? { over: command.over } : {}), ...(command.film && typeof command.film === 'object' ? { film: command.film } : {}), ...(Array.isArray(command.frames) && command.frames.length > 1 ? { frames: command.frames } : {}), ...(Array.isArray(command.pos) && command.pos.length === 2 ? { pos: [Number(command.pos[0]) || 0, Number(command.pos[1]) || 0] } : {}) } : { color: command.color }
      state.bgfx = null   // 换了背景，缩放 / 模糊跟着旧背景走
      state.bgPan = null
      break
    case 'bgoff':
      state.bg = null
      state.bgfx = null
      state.bgPan = null
      break
    case 'standMove': {   // 槽位立绘的位置偏移动画（AdvHD 的 Effect1 kind 1 用在立绘上：晃动 / 抖动）：to = [dx, dy] 舞台像素；offset = 累计偏移（留着，+10 再 -10 回到原位）；moves = 这一步里新开的动画（实时播放时一起动，播完由播放器清掉）
      const slot = String(command.slot ?? '')
      const to = [Number(command.to?.[0]) || 0, Number(command.to?.[1]) || 0]
      const move = { to, seconds: Math.max(0, Number(command.seconds) || 0), ease: Math.trunc(Number(command.ease) || 0), delay: Math.max(0, Number(command.delay) || 0) }
      state.stands = state.stands.map((s) => (String(s.slot) !== slot ? s : { ...s, offset: [(s.offset?.[0] || 0) + to[0], (s.offset?.[1] || 0) + to[1]], moves: [...(s.moves || []), move] }))
      break
    }
    case 'bgPan': {   // 背景平移（AdvHD 的 Effect1 kind 1：位置偏移 (dx, dy)，舞台像素；ease = 缓动编号，见 easeOf）：背景按原尺寸摆（bg.pos = 左上角，缺省 [0, 0]），offset = 平移完成后的累计偏移；bgPan = 这一次的动画（实时播放用）
      if (!state.bg?.src) break
      const from = state.bg.offset || [0, 0]
      const to = [from[0] + (Number(command.to?.[0]) || 0), from[1] + (Number(command.to?.[1]) || 0)]
      state.bg = { ...state.bg, offset: to }
      state.bgPan = { from, to, seconds: Math.max(0, Number(command.seconds) || 0), ease: Math.trunc(Number(command.ease) || 0), delay: Math.max(0, Number(command.delay) || 0) }
      break
    }
    case 'speaker':
      state.speaker = command.segments || []
      break
    case 'text':
      state.text = command.segments || []
      break
    case 'bgm':
      state.bgm = command.src
      break
    case 'bgmStop':
      state.bgm = ''
      break
    case 'fade':   // to: black（黑场）/ clear（去掉黑场）/ white（淡到白屏并保持，FADE_OUT2,white）
      // 原查看器里黑场和白屏是同一层遮罩：FADE_OUT2,white 之后接 FADE_OUT2,black / FADE_IN2,black，白屏就被取代了（换成黑场、再淡出），
      // 不会再有「FADE_IN2,white」来关它。所以淡到黑 / 去掉黑场时要把白屏一起关掉——以前只关黑场，白屏永远留着，整个画面（包括骨骼）被白色盖住
      if (command.to === 'white') state.white = true
      else { state.black = command.to === 'black'; state.white = false }
      break
    case 'wash':   // 白屏渐退成透明：白屏没了
      state.white = false
      break
    case 'movie':
      state.movie = { srcs: command.srcs, loop: Boolean(command.loop), ...(command.rate > 0 && command.rate !== 1 ? { rate: command.rate } : {}) }
      break
    case 'movieOff':
      state.movie = null
      break
    case 'spine': {
      const { op: _op, when: _when, ...spec } = command
      state.spines[command.slot] = spec
      break
    }
    case 'spineOff':
      if (command.slot) delete state.spines[command.slot]
      else if (command.prefix) { for (const slot of Object.keys(state.spines)) if (slot.startsWith(command.prefix)) delete state.spines[slot] }
      else state.spines = {}
      break
    case 'stand':   // 带 slot = 按槽位的立绘（同 slot 再来一条 = 替换，位置不变）；不带 = 整体立绘（旧行为）
      if (typeof command.slot === 'string' && command.slot) {
        const { op: _op, when: _when, ...spec } = command
        spec.parts = Array.isArray(command.parts) ? command.parts : []
        const at = state.stands.findIndex((s) => s.slot === command.slot)
        state.stands = at < 0 ? [...state.stands, spec] : state.stands.map((s, i) => (i === at ? spec : s))
      } else state.stand = { parts: command.parts || [] }
      break
    case 'standOff':   // 带 slot = 去掉这个槽位；不带 = 全部（整体立绘 + 所有槽位）
      if (typeof command.slot === 'string' && command.slot) state.stands = state.stands.filter((s) => s.slot !== command.slot)
      else { state.stand = null; state.stands = [] }
      break
    case 'overlay': {   // 叠加层（静态图 / 矩形）：同 slot 再来一条 = 合并（后写的字段覆盖，没写的保留；imgconf 这类只改布局的指令靠它；带 src 的 = 换了一张图，整条替换），位置不变
      if (typeof command.slot !== 'string' || !command.slot) break
      const { op: _op, when: _when, ...spec } = command
      const at = state.overlays.findIndex((o) => o.slot === command.slot)
      state.overlays = at < 0 ? [...state.overlays, spec] : state.overlays.map((o, i) => (i === at ? (command.src ? spec : { ...o, ...spec }) : o))
      break
    }
    case 'overlayOff':   // 带 slot = 去掉这个叠加层；不带 = 全部
      state.overlays = typeof command.slot === 'string' && command.slot ? state.overlays.filter((o) => o.slot !== command.slot) : []
      break
    case 'camera':
      state.camera = { to: command.to, from: command.from || null, seconds: command.seconds || 0 }
      break
    case 'bgse':
      state.bgse = command.src ? { src: command.src, loop: Boolean(command.loop) } : null
      break
    case 'bgScale':   // 当前背景缩放（倍数，seconds 渐变，easing 是 CSS 缓动名）
      state.bgfx = { ...(state.bgfx || {}), scale: command.scale, seconds: command.seconds || 0, easing: command.easing || 'linear' }
      break
    case 'bgBlur':    // 当前背景模糊（半径，场景像素）
      state.bgfx = { ...(state.bgfx || {}), blur: command.radius }
      break
    case 'bgZoom':    // 整个背景区域缩放 + 平移（ZOOM）：不跟换背景走；角色缩放另算
      state.bgZoom = command.scale === 1 && !command.x && !command.y ? null : { scale: command.scale, x: command.x || 0, y: command.y || 0 }
      break
    case 'bgvoice':   // 循环的背景人声（多个槽同时播）：{ slot, src, volume }
      state.bgvoices = { ...state.bgvoices, [command.slot]: { src: command.src, volume: command.volume ?? 1 } }
      break
    case 'bgvoiceOff': {
      const next = { ...state.bgvoices }
      delete next[command.slot]
      state.bgvoices = next
      break
    }
    case 'ui':        // 文本框显示 / 隐藏（看 CG 时）
      state.ui = Boolean(command.visible)
      break
    case 'bgseStop':
      state.bgse = null
      break
    default:
  }
  return state
}

// 播放完 0..index 步之后的状态
export function stateAt(scene, index, choices = {}) {
  const state = initialState()
  const last = Math.min(index, (scene?.steps?.length || 0) - 1)
  for (let i = 0; i <= last; i++) for (const command of scene.steps[i].commands) applyCommand(state, command, choices)
  return state
}

// 缓动函数（AdvHD 的 Effect1 的 mode：0..30，引擎里是 FUN_140132370 的 switch，按 In / Out / InOut 三个一组：0 线性、1-3 sine、4-6 quad、7-9 cubic、10-12 quart、13-15 quint、16-18 expo、19-21 circ、22-24 back、25-27 elastic、28-30 bounce）。t ∈ [0, 1] → [0, 1]（back / elastic 会越界）。
// 0-21 对着反编译的公式核对过（pow 的指数 2 / 3 / 4 / 5、sin(t·π/2)、sqrt(1 - t²) …）；22-30 是同一族的标准公式，没逐个核对
const BACK = 1.70158
const bounceOut = (t) => { const n = 7.5625; const d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) { const u = t - 1.5 / d; return n * u * u + 0.75 } if (t < 2.5 / d) { const u = t - 2.25 / d; return n * u * u + 0.9375 } const u = t - 2.625 / d; return n * u * u + 0.984375 }
const power = (n) => ({ in: (t) => t ** n, out: (t) => 1 - (1 - t) ** n, inOut: (t) => (t < 0.5 ? 2 ** (n - 1) * t ** n : 1 - ((-2 * t + 2) ** n) / 2) })
const FAMILIES = [
  { in: (t) => t, out: (t) => t, inOut: (t) => t },
  { in: (t) => 1 - Math.cos((t * Math.PI) / 2), out: (t) => Math.sin((t * Math.PI) / 2), inOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2 },
  power(2), power(3), power(4), power(5),
  { in: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)), out: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)), inOut: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2) },
  { in: (t) => 1 - Math.sqrt(1 - t * t), out: (t) => Math.sqrt(1 - (t - 1) ** 2), inOut: (t) => (t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2) },
  { in: (t) => (BACK + 1) * t ** 3 - BACK * t * t, out: (t) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2, inOut: (t) => { const c = BACK * 1.525; return t < 0.5 ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2 : ((2 * t - 2) ** 2 * ((c + 1) * (t * 2 - 2) + c) + 2) / 2 } },
  { in: (t) => (t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3))), out: (t) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1), inOut: (t) => { const c = (2 * Math.PI) / 4.5; return t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * c)) / 2 : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * c)) / 2 + 1 } },
  { in: (t) => 1 - bounceOut(1 - t), out: bounceOut, inOut: (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2) },
]
export function easeOf(mode, t) {
  const m = Math.trunc(Number(mode))
  const x = Math.max(0, Math.min(1, Number(t) || 0))
  if (!(m >= 0 && m <= 30)) return x
  if (m === 0) return x
  const family = FAMILIES[Math.floor((m - 1) / 3) + 1]
  return family[['in', 'out', 'inOut'][(m - 1) % 3]](x)
}

// 一条指令动画执行时要等多久（秒）：渐变背景、黑场、wait；其余立即
export function commandDuration(command) {
  if (command.op === 'bg' || command.op === 'bgoff') return command.fade || 0
  if (command.op === 'fade') return command.seconds || 0
  if (command.op === 'wait') return command.seconds || 0
  if (command.op === 'ui' || command.op === 'bgScale') return 0   // 文本框淡入淡出、背景缩放都不等它
  return 0
}

export const segmentsText = (segments) => (segments || []).map((segment) => segment.text).join('')

// 回看记录：到某一步为止出现过的台词（说话人 + 内容）
export function backlog(scene, index, choices = {}) {
  const lines = []
  let speaker = []
  walk(scene, index, choices, (i, command, on) => {
    if (!on) return
    if (command.op === 'speaker') speaker = command.segments || []
    else if (command.op === 'text' && segmentsText(command.segments).trim()) lines.push({ step: i, speaker, text: command.segments })
  })
  return lines
}

// 进度 ↔ 步数。ratio 0..1（和别的类型一样存成 scrollRatio）
export const ratioOfStep = (index, total) => (total <= 1 ? 1 : Math.max(0, Math.min(1, index / (total - 1))))
export const stepOfRatio = (ratio, total) => (total <= 1 ? 0 : Math.max(0, Math.min(total - 1, Math.round(Number(ratio || 0) * (total - 1)))))

// 资源路径 → URL。路径已经被适配器规范成相对路径（无前导斜杠）
export function assetUrl(base, src) {
  return `${base}?path=${encodeURIComponent(src)}`
}

// 音量感知曲线：滑块位置 p（0..1，浏览器里存的就是它）→ 实际增益 p²。左端不会一下子就听不见，右端也不那么吵
export const volumeGain = (p) => { const n = Number(p); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) ** 2 : 0 }

// 服务端下发的这个游戏的播放器默认值（config.player → node.player）：白名单 + 夹范围（不信下发的值）。
// 只在浏览器里没存过对应设置时才用（存过的优先）。范围和 gal-player.js 的 GAL_SETTINGS 一致（这里是纯函数，node 里也能测）。键：fontScale textOpacity autoDelay cameraMode('auto'|'fixed') zoom minFitScale fastInterval(ms)
export function galPlayerDefaults(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const num = (key, min, max, round = false) => {
    const n = Number(raw[key])
    if (raw[key] === undefined || raw[key] === null || raw[key] === '' || typeof raw[key] === 'boolean' || !Number.isFinite(n)) return
    out[key] = round ? Math.round(Math.max(min, Math.min(max, n))) : Math.max(min, Math.min(max, n))
  }
  num('fontScale', 0.6, 2)
  num('textOpacity', 0, 1)
  num('autoDelay', 0, 30)
  num('zoom', 0.5, 4)
  num('minFitScale', 0.3, 1)
  num('fastInterval', 20, 500, true)
  if (raw.cameraMode === 'auto' || raw.cameraMode === 'fixed') out.cameraMode = raw.cameraMode
  return out
}
