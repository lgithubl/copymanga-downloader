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
  const o=cycle?.offset
  if(o?.duration>0){
    const total=o.duration*Math.max(1,Math.min(16,o.loops||1));let x=0,y=0
    if(seconds<total){const p=Math.max(0,seconds)%o.duration/o.duration,power=Math.max(0,Math.min(100,Number(o.power)||0))
      if(o.kind==='shake'){const amplitude=power*(p<.5?1-(1-p)**2:1-(p-.5)*2),d=Math.sin(p*Math.PI*2*(o.frequency||1))*amplitude;if(o.dir==='vertical')y=d;else x=d}
      else if(o.kind==='rumble'){const frames=o.duration*60,step=Math.max(1,o.frequency||1),at=p*frames/step,index=Math.floor(at),u=at-index,ease=u<.5?2*u*u:1-(-2*u+2)**2/2,point=i=>{if(i<1)return[0,0];const r=n=>{const f=Math.sin(n*127.1+31.7)*43758.5453;return f-Math.floor(f)},angle=r(i)*Math.PI*2,strength=(.7+.3*r(i+59))*power*Math.max(0,1-i*step/frames);return[Math.cos(angle)*strength,Math.sin(angle)*strength]},a=point(index),b=point(index+1);x=a[0]+(b[0]-a[0])*ease;y=a[1]+(b[1]-a[1])*ease}
    }
    return{scale,alpha,x,y}
  }
  return { scale, alpha }
}
