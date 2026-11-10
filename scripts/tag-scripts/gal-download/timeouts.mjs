// Node timers support finite millisecond durations up to 2^31-1.
export function readTimeoutMs(value, fallback, name) {
  const ms = Number(value ?? fallback)
  if (!Number.isSafeInteger(ms) || ms < 1000 || ms > 2147483647) throw new Error(`${name} 必须是 1000–2147483647 的整数（毫秒）`)
  return ms
}
export function taskTimeoutMs(task, remaining) {
  return Math.min(readTimeoutMs(task.runTimeoutMs, remaining, 'runTimeoutMs'), remaining)
}
