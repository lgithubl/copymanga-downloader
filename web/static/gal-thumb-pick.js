// 渲染缩略图选哪一步（纯函数，只依赖 gal-engine.js 的 stateAt：浏览器渲染（gal-thumb-render.js）和服务端（browse.mjs 算轮播里有几张）共用）
import { stateAt } from './gal-engine.js'

// 画面选哪一步：要「真正的场景」——CG（bg 带 over / 静态画面骨骼 still / 铺满的叠加图）优先，其次有立绘 / 骨骼角色的画面，最后才是纯背景。
//   分数：CG 100（bg.over）/ 90（spine kind still）/ 60（overlay 带 src）；角色 30（spine / stand）；纯背景 1。取分数最高的，同分取最早的；
//   角色画面往后推 2 步（表情通常紧跟着出来），CG 就用它出现的那一步。只在有画面指令的步重新算状态（台词步状态不变）
const VISUAL_OPS = new Set(['bg', 'spine', 'spineOff', 'stand', 'standOff', 'overlay', 'overlayOff', 'movie', 'movieOff'])
export function scoreState(state) {
  if (state.bg?.over) return 100
  if (Object.values(state.spines || {}).some((spec) => spec?.kind === 'still')) return 90
  if ((state.overlays || []).some((o) => o?.src)) return 60
  if (Object.keys(state.spines || {}).length || state.stand?.parts?.length || (state.stands || []).length) return 30
  return state.bg?.src ? 1 : 0
}
export function pickRenderStep(scene, scanSteps = 150, after = 2) {
  const steps = Array.isArray(scene?.steps) ? scene.steps : []
  const limit = Math.min(steps.length, Math.max(scanSteps * 4, 600))
  let best = null
  for (let i = 0; i < limit; i++) {
    if (!steps[i].commands?.some((c) => VISUAL_OPS.has(c.op))) continue
    const state = stateAt(scene, i)
    const score = scoreState(state)
    if (score > (best?.score ?? 0)) best = { index: i, score }
    if (score >= 100) break
  }
  if (!best || best.score < 30) return null   // 只有背景（或什么都没有）：这种卡片用普通的图片缩略图就行
  const index = best.score >= 60 ? best.index : Math.min(steps.length - 1, best.index + after)
  return { index, score: best.score, state: stateAt(scene, index) }
}


// 轮播用：从场景里挑最多 count 个**画面不同**的步（骨骼 / 立绘 / CG 都算，纯背景不要）。第 0 个 = pickRenderStep 的结果（缓存 key 不变），
// 后面的按分数从高到低（同分取先出现的），画面签名（骨骼名 + 动画 / 叠加图 / 立绘部件 / bg.over）和已选的相同就跳过。
// 角色画面同样往后推 after 步（表情通常紧跟着出来）
function signatureOf(state) {
  return JSON.stringify([
    Object.entries(state.spines || {}).map(([slot, spec]) => [slot, spec?.kind || '', spec?.name || spec?.skel || spec?.src || '', spec?.anim || spec?.animation || '']),
    state.bg?.over || '',
    (state.overlays || []).map((o) => o?.src || ''),
    state.stand?.parts?.map((p) => p?.src || '') || [],
    (state.stands || []).map((st) => (st?.parts || []).map((p) => p?.src || '')),
  ])
}
export function pickRenderSteps(scene, scanSteps = 150, count = 3, after = 2) {
  const first = pickRenderStep(scene, scanSteps, after)
  if (!first || count < 2) return first ? [first] : []
  const steps = Array.isArray(scene?.steps) ? scene.steps : []
  const limit = Math.min(steps.length, Math.max(scanSteps * 4, 600))
  const seen = new Set([signatureOf(first.state)])
  const found = []
  for (let i = 0; i < limit; i++) {
    if (!steps[i].commands?.some((c) => VISUAL_OPS.has(c.op))) continue
    const state = stateAt(scene, i)
    const score = scoreState(state)
    if (score < 30) continue
    const index = score >= 60 ? i : Math.min(steps.length - 1, i + after)
    const sig = signatureOf(state)
    if (seen.has(sig)) continue
    seen.add(sig)
    found.push({ index, score, at: i })
  }
  found.sort((x, y) => y.score - x.score || x.at - y.at)
  const out = [first]
  for (const item of found) {
    if (out.length >= count) break
    out.push({ index: item.index, score: item.score, state: stateAt(scene, item.index) })
  }
  return out
}

// 胶片场景（bg.film）：找第一个用这条胶片（bg.src = film）的画面。胶片没有骨骼 / 立绘，不走上面的打分
export function pickFilmStep(scene, film) {
  const steps = Array.isArray(scene?.steps) ? scene.steps : []
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].commands?.some((c) => c.op === 'bg' && c.film && c.src === film)) return { index: i, score: 100, state: stateAt(scene, i) }
  }
  return null
}
