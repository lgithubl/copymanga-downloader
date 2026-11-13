// Fresh-run, static-graphics subset of AGE's update clock. Native timer setup
// (423f20) writes +5a1fc/+5a200; 21c enables the update barrier (419c30).
// 412fba -> 407b20 holds execution while the timer is pending. No wall-clock
// sleeping belongs in parsing: emit the existing sequential scene wait instead.
export function createAgeTimeline({ wait, blocking = () => 0 } = {}) {
  let pending = 0, elapsed = 0, barriers = 0
  return {
    instruction(i, machine) {
      if (i.opcode === 0x238) {
        const ms = machine.read(i.args[0])
        if (!Number.isInteger(ms) || ms < 0 || ms > 120000) throw Error('AGE update timer out of range')
        pending = ms; return true
      }
      if (i.opcode !== 0x21c) return false
      const duration = Math.max(pending, blocking())
      if (duration) wait?.(duration / 1000)
      elapsed += duration; pending = 0; barriers++
      if (elapsed > 24 * 3600 * 1000) throw Error('AGE timeline exceeds one day')
      return true
    },
    get pending() { return pending },
    get now() { return elapsed },
    snapshot: () => ({ elapsedMs: elapsed, pendingMs: pending, barriers }),
  }
}
