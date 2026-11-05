// CRI ACB（@UTF 表 + 内嵌/外置 AFS2 AWB）解析：cue 名 → 波形 → HCA 数据
export function readUtf(buf, base = 0) {
  if (buf.toString('latin1', base, base + 4) !== '@UTF') throw new Error('不是 @UTF 表')
  const t = base + 8
  const rowOff = buf.readUInt16BE(t + 2), strOff = buf.readUInt32BE(t + 4), dataOff = buf.readUInt32BE(t + 8)
  const nameOff = buf.readUInt32BE(t + 12), nFields = buf.readUInt16BE(t + 16), rowSize = buf.readUInt16BE(t + 18), nRows = buf.readUInt32BE(t + 20)
  const str = (o) => { const s = t + strOff + o; let e = s; while (buf[e]) e++; return buf.toString('utf8', s, e) }
  let p = t + 24
  const fields = []
  for (let i = 0; i < nFields; i++) {
    const flag = buf[p++]; const name = str(buf.readUInt32BE(p)); p += 4
    const f = { type: flag & 15, storage: flag >> 4, name }
    if (f.storage === 3) { const r = readVal(f.type); f.value = r.v; p += r.n }
    fields.push(f)
  }
  function readVal(type, at = p) {
    switch (type) {
      case 0: return { v: buf[at], n: 1 }
      case 1: return { v: buf.readInt8(at), n: 1 }
      case 2: return { v: buf.readUInt16BE(at), n: 2 }
      case 3: return { v: buf.readInt16BE(at), n: 2 }
      case 4: return { v: buf.readUInt32BE(at), n: 4 }
      case 5: return { v: buf.readInt32BE(at), n: 4 }
      case 6: return { v: Number(buf.readBigUInt64BE(at)), n: 8 }
      case 7: return { v: Number(buf.readBigInt64BE(at)), n: 8 }
      case 8: return { v: buf.readFloatBE(at), n: 4 }
      case 9: return { v: buf.readDoubleBE(at), n: 8 }
      case 0xa: return { v: str(buf.readUInt32BE(at)), n: 4 }
      case 0xb: { const o = buf.readUInt32BE(at), s = buf.readUInt32BE(at + 4); return { v: buf.subarray(t + dataOff + o, t + dataOff + o + s), n: 8 } }
      default: throw new Error(`UTF 字段类型 ${type}`)
    }
  }
  const rows = []
  for (let r = 0; r < nRows; r++) {
    let q = t + rowOff + r * rowSize
    const row = {}
    for (const f of fields) {
      if (f.storage === 5) { const x = readVal(f.type, q); row[f.name] = x.v; q += x.n }
      else if (f.storage === 3) row[f.name] = f.value
      else row[f.name] = f.type === 0xa ? '' : 0
    }
    rows.push(row)
  }
  return { name: str(nameOff), rows }
}

export function readAfs2(buf, base = 0) {
  if (buf.toString('latin1', base, base + 4) !== 'AFS2') throw new Error('不是 AFS2')
  const offSize = buf[base + 5], count = buf.readUInt32LE(base + 8), align = buf.readUInt16LE(base + 12)
  let p = base + 16
  const ids = []
  for (let i = 0; i < count; i++) { ids.push(buf.readUInt16LE(p)); p += 2 }
  const offs = []
  for (let i = 0; i <= count; i++) { offs.push(buf.readUIntLE(p, offSize)); p += offSize }
  return ids.map((id, i) => {
    const s = Math.ceil(offs[i] / align) * align
    return { id, data: buf.subarray(base + s, base + offs[i + 1]) }
  })
}

// → { cues: [{ name, index, waveIds }], waves: Map<id, Buffer(HCA)> }
export function readAcb(buf, extAwb = null) {
  const top = readUtf(buf).rows[0]
  const tbl = (k) => (top[k] && top[k].length ? readUtf(top[k]).rows : [])
  const nameRows = tbl('CueNameTable'), cueRows = tbl('CueTable'), synthRows = tbl('SynthTable'), waveRows = tbl('WaveformTable')
  const awbBuf = top.AwbFile && top.AwbFile.length ? top.AwbFile : extAwb
  const waves = new Map()
  if (awbBuf) for (const e of readAfs2(awbBuf)) waves.set(e.id, e.data)
  const waveId = (w) => (w.Streaming ? w.StreamAwbId : w.MemoryAwbId)
  const cues = nameRows.map((n) => {
    const cue = cueRows[n.CueIndex] || {}
    const ids = []
    const visitSynth = (si) => {
      const items = synthRows[si]?.ReferenceItems
      if (!items) return
      for (let p = 0; p + 4 <= items.length; p += 4) {
        const type = items.readUInt16BE(p), idx = items.readUInt16BE(p + 2)
        if (type === 1) { const w = waveRows[idx]; if (w) ids.push(waveId(w)) }
        else if (type === 2 || type === 3) visitSynth(idx)
      }
    }
    if (cue.ReferenceType === 1 && waveRows[cue.ReferenceIndex]) ids.push(waveId(waveRows[cue.ReferenceIndex]))
    else if (cue.ReferenceType === 3 || cue.ReferenceType === 2) visitSynth(cue.ReferenceIndex)
    return { name: n.CueName, index: n.CueIndex, waveIds: ids }
  })
  return { cues, waves }
}
