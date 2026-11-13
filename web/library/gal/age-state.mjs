// Data-only SYS4 state writes, checked against the native handlers in the
// reference executable and the current SYS4485 instruction streams.
// The two flag fields are modelled without guessing that they mean visibility,
// keyboard input, or any other unverified consumer-facing behavior.
export function createAgeState() {
  const flagsA = new Uint8Array(1000), flagsB = new Uint8Array(1000), callbacks = new Map(), regions = []
  let resets = 0, writes = 0
  function instruction(i, machine) {
    const read = k => machine.read(i.args[k])
    const targetsValid = targets => {
      for (const target of targets) if (target !== -1 && (!Number.isInteger(target) || !machine.isCodeOffset?.(target))) throw Error('AGE callback is not an instruction boundary')
    }
    if (i.opcode === 0x259) {
      // 419d70: clear fields +0/+4 in two 1000-element, 20-byte-stride tables.
      flagsA.fill(0); flagsB.fill(0); resets++; return true
    }
    if (i.opcode === 0x258) {
      // 4252d0 -> 417c40: mask bits 0 and 1 are written to both tables.
      const slot = read(0), mask = read(1)
      if (!Number.isInteger(slot) || slot < 0 || slot >= flagsA.length || !Number.isInteger(mask)) throw Error('AGE state flag slot/mask invalid')
      flagsA[slot] = flagsB[slot] = mask & 3; writes++; return true
    }
    if (i.opcode === 0x7b) {
      // 41eca0 only registers two code addresses for the current script
      // instance. It does not jump to either target immediately.
      const targets = [read(0), read(1)]
      targetsValid(targets)
      if (!Number.isInteger(machine.scriptInstance)) throw Error('AGE callback script instance missing')
      if (targets.every(target => target === -1)) callbacks.delete(machine.scriptInstance)
      else {
        if (callbacks.size >= 256 && !callbacks.has(machine.scriptInstance)) throw Error('AGE callback instance limit')
        callbacks.set(machine.scriptInstance, { script: machine.script, instance: machine.scriptInstance, registeredAt: i.offset, targets })
      }
      return true
    }
    if (i.opcode === 0x90 || i.opcode === 0x97) {
      // 41fd40 -> 403ad0: append a rectangle and three code addresses; no
      // callback executes here. 403c65 subsequently tests the rectangle.
      // The native table has 100 entries. Event dispatch remains unsupported.
      const [x, y, width, height] = [0, 1, 2, 3].map(read)
      if (![x, y, width, height].every(Number.isInteger)) throw Error('AGE input rectangle invalid')
      const rect = [x, y, (x + width) | 0, (y + height) | 0]
      if (i.opcode === 0x97) {
        // 420010 -> 403ca0: first exact rectangle match gets a bit index.
        // No match leaves the table unchanged; it does not create a region.
        const bit = read(4)
        if (!Number.isInteger(bit)) throw Error('AGE input bit invalid')
        const region = regions.find(row => row.rect.every((value, k) => value === rect[k]))
        if (region) region.inputBit = bit
        return true
      }
      const targets = [4, 5, 6].map(read)
      targetsValid(targets)
      if (regions.length >= 100) throw Error('AGE input rectangle limit')
      regions.push({ script: machine.script, instance: machine.scriptInstance, registeredAt: i.offset,
        rect, targets, inputBit: -1 })
      return true
    }
    return false
  }
  return { instruction,
    hasCallbacks: () => callbacks.size > 0 || regions.length > 0,
    snapshot: () => ({ resets, writes, flags: Array.from(flagsA).flatMap((mask, slot) => mask ? [{ slot, mask }] : []),
      // Callback dispatch still needs native event/exit semantics. Keep these
      // visible and prevent a scene from being reported complete with them.
      pendingCallbacks: [...callbacks.values()].map(value => ({ ...value, targets: [...value.targets] })),
      inputRegions: regions.map(value => ({ ...value, rect: [...value.rect], targets: [...value.targets] })) }),
  }
}
