// Declarative timelines only: no game JS is executed. Time is seconds.
export function animationFrame(animation, seconds) {
  const frames = animation?.frames
  if (!Array.isArray(frames) || !frames.length || frames.length > 10000) return null
  let total = 0, loopAt = 0
  const ends = frames.map((f, i) => { if (i === animation.loopStart) loopAt = total; total += Math.max(1 / 60, Math.min(120, Number(f.seconds) || 1 / 60)); return total })
  let time = Math.max(0, seconds), iteration = 0
  if (time >= total) { iteration = Math.floor((time-loopAt)/(total-loopAt)); time = animation.loop === false ? total - 1e-9 : loopAt + (time - loopAt) % (total - loopAt) }
  const index = ends.findIndex(end => time < end)
  return { ...frames[Math.max(0, index)], index: Math.max(0, index), token: `${iteration}:${Math.max(0,index)}` }
}
export function cyclePose(cycle, seconds) {
  let scale = 1, alpha = 1
  const s = cycle?.scale
  if (s && s.rise > 0 && s.fall > 0 && s.max >= s.min) {
    const t = Math.max(0, seconds) % (s.rise + s.fall)
    // Native Rex starts at1 descending, then rises from1 to1.01.
    scale = t < s.rise ? s.min + (s.max - s.min) * t / s.rise : s.max - (s.max - s.min) * (t - s.rise) / s.fall
  }
  const v = cycle?.visibility
  if (v?.period > 0 && Array.isArray(v.windows)) {
    const t = Math.max(0, seconds) % v.period
    const inside = v.windows.some(([a,b]) => t >= a && t < b)
    alpha = (v.invert ? !inside : inside) ? 1 : 0
  }
  return { scale, alpha }
}
