// Gal 播放器的纯逻辑（不碰 DOM / Audio，Node 里直接单测：scripts/dev/gal-selftest.mjs）。
// 输入是规范场景（见 web/library/gal/scene.mjs）。状态 = 播放到某一步之后画面/声音「应该是什么样」，
// 前进时按指令逐条动画执行，后退/续播/跳转时直接 stateAt() 一步到位。

export function initialState() {
  return { bg: null, speaker: [], text: [], bgm: '', black: false, movie: null }
}

// 把一条指令作用到状态上（不含时长/动画）。voice / se 是一次性事件，不进状态。
export function applyCommand(state, command) {
  switch (command.op) {
    case 'bg':
      state.bg = command.src ? { src: command.src } : { color: command.color }
      break
    case 'bgoff':
      state.bg = null
      break
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
    case 'fade':
      state.black = command.to === 'black'
      break
    case 'movie':
      state.movie = { srcs: command.srcs, loop: Boolean(command.loop) }
      break
    case 'movieOff':
      state.movie = null
      break
    default:
  }
  return state
}

// 播放完 0..index 步之后的状态
export function stateAt(scene, index) {
  const state = initialState()
  const last = Math.min(index, (scene?.steps?.length || 0) - 1)
  for (let i = 0; i <= last; i++) for (const command of scene.steps[i].commands) applyCommand(state, command)
  return state
}

// 一条指令动画执行时要等多久（秒）：渐变背景、黑场、wait；其余立即
export function commandDuration(command) {
  if (command.op === 'bg' || command.op === 'bgoff') return command.fade || 0
  if (command.op === 'fade') return command.seconds || 0
  if (command.op === 'wait') return command.seconds || 0
  return 0
}

export const segmentsText = (segments) => (segments || []).map((segment) => segment.text).join('')

// 回看记录：到某一步为止出现过的台词（说话人 + 内容）
export function backlog(scene, index) {
  const lines = []
  let speaker = []
  for (let i = 0; i <= Math.min(index, (scene?.steps?.length || 0) - 1); i++) {
    for (const command of scene.steps[i].commands) {
      if (command.op === 'speaker') speaker = command.segments || []
      else if (command.op === 'text' && segmentsText(command.segments).trim()) lines.push({ step: i, speaker, text: command.segments })
    }
  }
  return lines
}

// 进度 ↔ 步数。ratio 0..1（和别的类型一样存成 scrollRatio）
export const ratioOfStep = (index, total) => (total <= 1 ? 1 : Math.max(0, Math.min(1, index / (total - 1))))
export const stepOfRatio = (ratio, total) => (total <= 1 ? 0 : Math.max(0, Math.min(total - 1, Math.round(Number(ratio || 0) * (total - 1)))))

// 资源路径 → URL。路径已经被适配器规范成相对路径（无前导斜杠）
export function assetUrl(base, src) {
  return `${base}?path=${encodeURIComponent(src)}`
}
