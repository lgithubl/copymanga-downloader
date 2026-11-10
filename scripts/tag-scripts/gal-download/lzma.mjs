// Unity's LZMA block: five property bytes followed by a raw LZMA1 range stream.
// Decode locally, with no native addon, executable, dictionary or network dependency.
export function lzmaBlock(input, outputSize) {
  if (!Number.isSafeInteger(outputSize) || outputSize < 0 || outputSize > 512 * 1024 * 1024 || input.length < 10) throw new Error('LZMA 大小无效')
  const props = input[0], lc = props % 9, lp = Math.floor(props / 9) % 5, pb = Math.floor(props / 45)
  if (lc > 8 || lp > 4 || pb > 4 || lc + lp > 12) throw new Error('LZMA 属性无效')
  let cursor = 5, range = 0xffffffff, code = 0
  const byte = () => { if (cursor >= input.length) throw new Error('LZMA 数据截断'); return input[cursor++] }
  if (byte() !== 0) throw new Error('LZMA range header 无效')
  for (let i = 0; i < 4; i++) code = (code * 256 + byte()) >>> 0
  const probs = (count) => new Uint16Array(count).fill(1024)
  const normalize = () => { if (range < 0x1000000) { range = (range * 256) >>> 0; code = (code * 256 + byte()) >>> 0 } }
  const bit = (model, index) => {
    const probability = model[index]
    if (probability === undefined) throw new Error('LZMA 概率索引无效')
    const bound = (range >>> 11) * probability
    let value
    if (code < bound) { range = bound; model[index] = probability + ((2048 - probability) >>> 5); value = 0 }
    else { range = (range - bound) >>> 0; code = (code - bound) >>> 0; model[index] = probability - (probability >>> 5); value = 1 }
    normalize()
    return value
  }
  const tree = (model, offset, bits, reverse = false) => {
    let symbol = 1, result = 0
    for (let i = 0; i < bits; i++) { const value = bit(model, offset + symbol); symbol = symbol * 2 + value; if (reverse) result += value * 2 ** i }
    return reverse ? result : symbol - 2 ** bits
  }
  const direct = (bits) => {
    let result = 0
    for (let i = 0; i < bits; i++) {
      range >>>= 1
      const value = code >= range ? 1 : 0
      if (value) code = (code - range) >>> 0
      result = result * 2 + value
      normalize()
    }
    return result
  }
  const lengthModel = () => ({ choice: probs(2), low: probs(16 * 8), mid: probs(16 * 8), high: probs(256) })
  const length = (model, posState) => !bit(model.choice, 0) ? tree(model.low, posState * 8, 3) : !bit(model.choice, 1) ? 8 + tree(model.mid, posState * 8, 3) : 16 + tree(model.high, 0, 8)
  const isMatch = probs(12 * 16), isRep = probs(12), g0 = probs(12), g1 = probs(12), g2 = probs(12), isShort = probs(12 * 16)
  const literals = probs(0x300 * 2 ** (lc + lp)), slots = probs(4 * 64), distances = probs(114), alignment = probs(16)
  const matchLen = lengthModel(), repLen = lengthModel()
  const output = Buffer.alloc(outputSize)
  const posMask = (1 << pb) - 1, literalMask = (1 << lp) - 1
  let pos = 0, state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0
  const back = (distance) => { if (distance >= pos) throw new Error('LZMA 回溯范围无效'); return output[pos - distance - 1] }
  while (pos < outputSize) {
    const posState = pos & posMask
    if (!bit(isMatch, (state << 4) + posState)) {
      const prev = pos ? output[pos - 1] : 0
      const offset = 0x300 * (((pos & literalMask) << lc) + (prev >>> (8 - lc)))
      let symbol = 1
      if (state >= 7) {
        let match = back(rep0)
        do {
          const matchBit = (match >>> 7) & 1; match <<= 1
          const value = bit(literals, offset + ((1 + matchBit) << 8) + symbol)
          symbol = symbol * 2 + value
          if (value !== matchBit) { while (symbol < 0x100) symbol = symbol * 2 + bit(literals, offset + symbol); break }
        } while (symbol < 0x100)
      } else while (symbol < 0x100) symbol = symbol * 2 + bit(literals, offset + symbol)
      output[pos++] = symbol - 0x100
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
      continue
    }
    let size
    if (bit(isRep, state)) {
      if (!bit(g0, state)) {
        if (!bit(isShort, (state << 4) + posState)) {
          output[pos] = back(rep0); pos++; state = state < 7 ? 9 : 11; continue
        }
      } else {
        let distance
        if (!bit(g1, state)) distance = rep1
        else { if (!bit(g2, state)) distance = rep2; else { distance = rep3; rep3 = rep2 }; rep2 = rep1 }
        rep1 = rep0; rep0 = distance
      }
      size = length(repLen, posState) + 2
      state = state < 7 ? 8 : 11
    } else {
      rep3 = rep2; rep2 = rep1; rep1 = rep0
      size = length(matchLen, posState) + 2
      state = state < 7 ? 7 : 10
      const slot = tree(slots, Math.min(size - 2, 3) * 64, 6)
      if (slot < 4) rep0 = slot
      else {
        const bits = (slot >>> 1) - 1
        rep0 = (2 + (slot & 1)) * 2 ** bits
        if (slot < 14) rep0 += tree(distances, rep0 - slot - 1, bits, true)
        else rep0 += direct(bits - 4) * 16 + tree(alignment, 0, 4, true)
      }
    }
    if (pos + size > outputSize || rep0 >= pos) throw new Error('LZMA 匹配范围无效')
    while (size--) { output[pos] = back(rep0); pos++ }
  }
  return output
}
