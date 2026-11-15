// Game_Screen.updateShake: native pixels sampled at 60 Hz.
export function rpgShakeFrames(power, speed, duration) {
  power = Math.max(0, Math.min(9, Number(power) || 0))
  speed = Math.max(0, Math.min(9, Number(speed) || 0))
  duration = Math.max(0, Math.min(3600, Math.round(Number(duration) || 0)))
  const frames = [0]
  let shake = 0, direction = 1
  if (!power || !speed) return frames
  for (let i = 0; i < 3700 && (duration > 0 || shake !== 0); i++) {
    const delta = power * speed * direction / 10
    if (duration <= 1 && shake * (shake + delta) < 0) shake = 0
    else shake += delta
    if (shake > power * 2) direction = -1
    if (shake < -power * 2) direction = 1
    duration--
    frames.push(shake)
  }
  if (frames.at(-1) !== 0) frames.push(0)
  return frames
}
