// CRI HCA 解码（含 cipher type 0/1/56 解密）。
// 算法与表格移植自 vgmstream 的 clhca.c（源自 nyaga / kode54 / bnnm；表见 cri-hca-data.mjs）。
// 只做 PCM 输出所需的部分；用 `scripts/dev/gal-cri-selftest.mjs` 对着 C 参考实现核对过。
import {
  CRC_TABLE, ATH_BASE_CURVE, INVERT_TABLE, SCALING_TABLE, RANGE_TABLE, MAX_BIT_TABLE, READ_BIT_TABLE,
  READ_VAL_TABLE, SCALE_CONVERSION_TABLE, INTENSITY_RATIO_TABLE, SIN_TABLES, COS_TABLES, IMDCT_WINDOW,
} from './cri-hca-data.mjs'

// Imys 的 CRI 64 位密钥（取自 imys_r_Data/level0 里 HachirokuCri 的 CriWareInitializer 序列化数据；用 clhca 的 TestBlock 校验过）
export const IMYS_HCA_KEY = 62049655719861786n

const SUBFRAMES = 8
const SAMPLES = 128
const FRAME_SAMPLES = SUBFRAMES * SAMPLES
const DISCRETE = 0, STEREO_PRIMARY = 1, STEREO_SECONDARY = 2

function crc16(buf, start, size) {
  let sum = 0
  for (let i = 0; i < size; i++) sum = ((sum << 8) ^ CRC_TABLE[((sum >> 8) ^ buf[start + i]) & 0xff]) & 0xffff
  return sum
}

class Bits {
  constructor(buf, start, size) { this.buf = buf; this.start = start; this.size = size * 8; this.bit = 0 }
  peek(n) {
    if (n === 0 || this.bit + n > this.size) return 0
    let v = 0
    const p = this.start + (this.bit >> 3), rem = this.bit & 7
    const need = rem + n
    // 最多 32+7 位，用乘法避免 32 位溢出
    const bytes = (need + 7) >> 3
    for (let i = 0; i < bytes; i++) v = v * 256 + this.buf[p + i]
    const total = bytes * 8
    v = Math.floor(v / 2 ** (total - need))
    return v % 2 ** n
  }
  read(n) { const v = this.peek(n); this.bit += n; return v }
  skip(n) { this.bit += n }
}

function cipherTable56(keycode) {
  let key = BigInt.asUintN(64, BigInt(keycode))
  if (key !== 0n) key -= 1n
  const kc = []
  for (let r = 0; r < 7; r++) { kc.push(Number(key & 0xffn)); key >>= 8n }
  const make = (k) => {
    const mul = ((k & 1) << 3) | 5, add = (k & 0xe) | 1
    k >>= 4
    const r = []
    for (let i = 0; i < 16; i++) { k = (k * mul + add) & 0xf; r.push(k) }
    return r
  }
  const seed = [kc[1], kc[1] ^ kc[6], kc[2] ^ kc[3], kc[2], kc[2] ^ kc[1], kc[3] ^ kc[4], kc[3], kc[3] ^ kc[2],
    kc[4] ^ kc[5], kc[4], kc[4] ^ kc[3], kc[5] ^ kc[6], kc[5], kc[5] ^ kc[4], kc[6] ^ kc[1], kc[6]]
  const baseR = make(kc[0])
  const base = new Uint8Array(256)
  for (let r = 0; r < 16; r++) {
    const baseC = make(seed[r])
    const nb = (baseR[r] << 4) & 0xff
    for (let c = 0; c < 16; c++) base[r * 16 + c] = nb | baseC[c]
  }
  const t = new Uint8Array(256)
  let x = 0, pos = 1
  for (let i = 0; i < 256; i++) {
    x = (x + 17) & 0xff
    if (base[x] !== 0 && base[x] !== 0xff) t[pos++] = base[x]
  }
  t[0] = 0; t[255] = 255
  return t
}

function cipherTable(type, keycode) {
  if (type === 56 && BigInt(keycode) === 0n) type = 0
  if (type === 0) return Uint8Array.from({ length: 256 }, (_, i) => i)
  if (type === 1) {
    const t = new Uint8Array(256); let v = 0
    for (let i = 1; i < 255; i++) {
      v = (v * 13 + 11) & 0xff
      if (v === 0 || v === 0xff) v = (v * 13 + 11) & 0xff
      t[i] = v
    }
    t[255] = 255
    return t
  }
  if (type === 56) return cipherTable56(keycode)
  throw new Error(`HCA 加密类型 ${type} 不支持`)
}

function channelTypes(channels, tracks, config, stereoBands) {
  const out = new Array(channels).fill(DISCRETE)
  const per = Math.floor(channels / tracks)
  if (stereoBands > 0 && per > 1) {
    const P = STEREO_PRIMARY, S = STEREO_SECONDARY, D = DISCRETE
    for (let i = 0; i < tracks; i++) {
      const o = i * per
      let pat
      switch (per) {
        case 2: pat = [P, S]; break
        case 3: pat = [P, S, D]; break
        case 4: pat = config === 0 ? [P, S, P, S] : [P, S, D, D]; break
        case 5: pat = config <= 2 ? [P, S, D, P, S] : [P, S, D, D, D]; break
        case 6: pat = [P, S, D, D, P, S]; break
        case 7: pat = [P, S, D, D, P, S, D]; break
        case 8: pat = [P, S, D, D, P, S, P, S]; break
        default: pat = []
      }
      pat.forEach((t, k) => { out[o + k] = t })
    }
  }
  return out
}

function newChannel(type, codedCount) {
  return {
    type, codedCount,
    intensity: new Uint8Array(SUBFRAMES), scalefactors: new Uint8Array(SAMPLES), resolution: new Uint8Array(SAMPLES),
    noises: new Uint8Array(SAMPLES), noiseCount: 0, validCount: 0,
    gain: new Float32Array(SAMPLES),
    spectra: Array.from({ length: SUBFRAMES }, () => new Float32Array(SAMPLES)),
    temp: new Float32Array(SAMPLES), prev: new Float32Array(SAMPLES),
    wave: Array.from({ length: SUBFRAMES }, () => new Float32Array(SAMPLES)),
  }
}

export function parseHcaHeader(buf, keycode = 0n) {
  const tag = (p) => (buf.readUInt32BE(p) & 0x7f7f7f7f) >>> 0
  if (buf.length < 8 || tag(0) !== 0x48434100) throw new Error('不是 HCA')
  const h = { keycode: BigInt(keycode) }
  h.version = buf.readUInt16BE(4)
  h.headerSize = buf.readUInt16BE(6)
  if (![0x101, 0x102, 0x103, 0x200, 0x300].includes(h.version)) throw new Error(`HCA 版本 0x${h.version.toString(16)} 不支持`)
  if (buf.length < h.headerSize) throw new Error('HCA 头不完整')
  if (crc16(buf, 0, h.headerSize) !== 0) throw new Error('HCA 头校验失败')
  let p = 8
  if (tag(p) !== 0x666d7400) throw new Error('HCA 缺 fmt')
  h.channels = buf[p + 4]
  h.sampleRate = buf.readUIntBE(p + 5, 3)
  h.frameCount = buf.readUInt32BE(p + 8)
  h.encoderDelay = buf.readUInt16BE(p + 12)
  h.encoderPadding = buf.readUInt16BE(p + 14)
  p += 16
  if (tag(p) === 0x636f6d70) { // comp
    h.frameSize = buf.readUInt16BE(p + 4)
    h.minRes = buf[p + 6]; h.maxRes = buf[p + 7]; h.trackCount = buf[p + 8]; h.channelConfig = buf[p + 9]
    h.totalBands = buf[p + 10]; h.baseBands = buf[p + 11]; h.stereoBands = buf[p + 12]; h.bandsPerHfr = buf[p + 13]
    h.msStereo = buf[p + 14]
    p += 16
  } else if (tag(p) === 0x64656300) { // dec
    h.frameSize = buf.readUInt16BE(p + 4)
    h.minRes = buf[p + 6]; h.maxRes = buf[p + 7]
    h.totalBands = buf[p + 8] + 1; h.baseBands = buf[p + 9] + 1
    h.trackCount = buf[p + 10] >> 4; h.channelConfig = buf[p + 10] & 15
    const stereoType = buf[p + 11]
    if (stereoType === 0) h.baseBands = h.totalBands
    h.stereoBands = h.totalBands - h.baseBands
    h.bandsPerHfr = 0; h.msStereo = 0
    p += 12
  } else throw new Error('HCA 缺 comp/dec')
  if (tag(p) === 0x76627200) p += 8 // vbr（不支持 VBR，仅跳过）
  h.athType = h.version < 0x200 ? 1 : 0
  if (tag(p) === 0x61746800) { h.athType = buf.readUInt16BE(p + 4); p += 6 }
  h.loop = null
  if (tag(p) === 0x6c6f6f70) {
    h.loop = { startFrame: buf.readUInt32BE(p + 4), endFrame: buf.readUInt32BE(p + 8), startDelay: buf.readUInt16BE(p + 12), endPadding: buf.readUInt16BE(p + 14) }
    p += 16
  }
  h.cipherType = 0
  if (tag(p) === 0x63697068) { h.cipherType = buf.readUInt16BE(p + 4); p += 6 }
  if (![0, 1, 56].includes(h.cipherType)) throw new Error(`HCA 加密类型 ${h.cipherType} 不支持`)
  if (tag(p) === 0x72766100) p += 8
  if (!(h.frameSize >= 8)) throw new Error('HCA frame 大小非法')
  if (h.msStereo) throw new Error('HCA ms_stereo 未实现')
  if (h.trackCount === 0) h.trackCount = 1
  if (h.totalBands > SAMPLES || h.totalBands === 0 || h.baseBands + h.stereoBands > h.totalBands ||
      h.baseBands + h.stereoBands === 0 || h.stereoBands > h.baseBands || h.bandsPerHfr > SAMPLES) throw new Error('HCA 频段参数非法')
  h.hfrGroupCount = h.bandsPerHfr < 1 ? 0 : Math.ceil((h.totalBands - h.baseBands - h.stereoBands) / h.bandsPerHfr)
  return h
}

export class HcaDecoder {
  constructor(buf, keycode = 0n) {
    this.buf = buf
    this.h = parseHcaHeader(buf, keycode)
    const h = this.h
    this.cipher = cipherTable(h.cipherType, h.keycode)
    this.ath = new Uint8Array(SAMPLES)
    if (h.athType === 1) {
      let acc = 0
      for (let i = 0; i < SAMPLES; i++) {
        acc += h.sampleRate
        const idx = acc >>> 13
        if (idx >= 654) { this.ath.fill(0xff, i); break }
        this.ath[i] = ATH_BASE_CURVE[idx]
      }
    } else if (h.athType !== 0) throw new Error('HCA ath 类型不支持')
    const types = channelTypes(h.channels, h.trackCount, h.channelConfig, h.stereoBands)
    this.ch = types.map((t) => newChannel(t, h.baseBands + (t === STEREO_SECONDARY ? 0 : h.stereoBands)))
    this.random = 1
  }

  reset() { this.random = 1; for (const c of this.ch) c.prev.fill(0) }

  // 解出一帧；返回读取的 bit 数，失败返回 <0（多半是密钥错）
  unpack(frame) {
    const h = this.h
    if (frame.length < h.frameSize) return -1
    const br = new Bits(frame, 0, h.frameSize)
    if (br.read(16) !== 0xffff) return -4
    if (crc16(frame, 0, h.frameSize) !== 0) return -3
    const d = Buffer.from(frame.subarray(0, h.frameSize))
    for (let i = 0; i < d.length; i++) d[i] = this.cipher[d[i]]
    const b = new Bits(d, 0, h.frameSize); b.bit = 16
    const noiseLevel = b.read(9), evalBoundary = b.read(7)
    const packedNoise = (noiseLevel << 8) - evalBoundary
    for (const ch of this.ch) {
      if (this.unpackScalefactors(ch, b) < 0) return -5
      this.unpackIntensity(ch, b)
      this.calcResolution(ch, packedNoise)
      for (let i = 0; i < ch.codedCount; i++) ch.gain[i] = Math.fround(SCALING_TABLE[ch.scalefactors[i]] * RANGE_TABLE[ch.resolution[i]])
    }
    for (let sf = 0; sf < SUBFRAMES; sf++) for (const ch of this.ch) this.dequantize(ch, b, sf)
    this.lastBits = b.bit
    this.lastData = d
    return b.bit
  }

  unpackScalefactors(ch, br) {
    const h = this.h
    const cs = ch.codedCount
    const deltaBits = br.read(3)
    const hs = (ch.type === STEREO_SECONDARY || h.hfrGroupCount === 0 || h.version <= 0x200) ? 0 : h.hfrGroupCount
    const sfCount = cs + hs
    const sf = ch.scalefactors
    if (deltaBits >= 6) {
      for (let i = 0; i < sfCount; i++) sf[i] = br.read(6)
    } else if (deltaBits > 0) {
      const expected = (1 << deltaBits) - 1
      let value = br.read(6)
      sf[0] = value
      for (let i = 1; i < sfCount; i++) {
        const delta = br.read(deltaBits)
        if (delta === expected) value = br.read(6)
        else {
          const test = value + (delta - (expected >> 1))
          if (test < 0 || test >= 64) return -5
          value = (value - (expected >> 1) + delta) & 0x3f
        }
        sf[i] = value
      }
    } else sf.fill(0)
    for (let i = hs; i > 0; i--) sf[SAMPLES - 1 - hs + i] = sf[cs - 1 + i]
    return 0
  }

  unpackIntensity(ch, br) {
    const h = this.h
    if (ch.type === STEREO_SECONDARY) {
      if (h.version <= 0x200) {
        const value = br.peek(4)
        ch.intensity[0] = value
        if (value < 15) {
          br.skip(4)
          for (let i = 1; i < SUBFRAMES; i++) ch.intensity[i] = br.read(4)
        }
      } else {
        let value = br.peek(4)
        if (value < 15) {
          br.skip(4)
          const deltaBits = br.read(2)
          ch.intensity[0] = value
          if (deltaBits === 3) for (let i = 1; i < SUBFRAMES; i++) ch.intensity[i] = br.read(4)
          else {
            const bmax = (2 << deltaBits) - 1, bits = deltaBits + 1
            for (let i = 1; i < SUBFRAMES; i++) {
              const delta = br.read(bits)
              if (delta === bmax) value = br.read(4)
              else { value = (value - (bmax >> 1) + delta) & 0xff; if (value > 15) return -5 }
              ch.intensity[i] = value
            }
          }
        } else { br.skip(4); ch.intensity.fill(7) }
      }
    } else if (h.version <= 0x200) {
      const base = SAMPLES - h.hfrGroupCount
      for (let i = 0; i < h.hfrGroupCount; i++) ch.scalefactors[base + i] = br.read(6)
    }
    return 0
  }

  calcResolution(ch, packedNoise) {
    const h = this.h
    let noiseCount = 0, validCount = 0
    for (let i = 0; i < ch.codedCount; i++) {
      let res = 0
      const sf = ch.scalefactors[i]
      if (sf > 0) {
        const noiseLevel = this.ath[i] + ((packedNoise + i) >> 8)
        const pos = noiseLevel + 1 - ((5 * sf) >> 1)
        if (pos < 0) res = 15
        else if (pos <= 65) res = INVERT_TABLE[pos]
        else res = 0
        if (res > h.maxRes) res = h.maxRes
        else if (res < h.minRes) res = h.minRes
        if (res < 1) ch.noises[noiseCount++] = i
        else ch.noises[SAMPLES - 1 - validCount++] = i
      }
      ch.resolution[i] = res
    }
    ch.noiseCount = noiseCount; ch.validCount = validCount
    ch.resolution.fill(0, ch.codedCount)
  }

  dequantize(ch, br, sf) {
    const sp = ch.spectra[sf]
    for (let i = 0; i < ch.codedCount; i++) {
      const res = ch.resolution[i]
      const bits = MAX_BIT_TABLE[res]
      const code = br.read(bits)
      let qc
      if (res > 7) {
        const signed = (1 - ((code & 1) << 1)) * (code >> 1)
        if (signed === 0) br.skip(-1)
        qc = signed
      } else {
        const idx = (res << 4) + code
        br.skip(READ_BIT_TABLE[idx] - bits)
        qc = READ_VAL_TABLE[idx]
      }
      sp[i] = ch.gain[i] * qc
    }
    sp.fill(0, ch.codedCount)
  }

  transform() {
    const h = this.h
    for (let sf = 0; sf < SUBFRAMES; sf++) {
      for (const ch of this.ch) {
        this.reconstructNoise(ch, sf)
        this.reconstructHigh(ch, sf)
      }
      if (h.stereoBands > 0) for (let c = 0; c < this.ch.length - 1; c++) this.intensityStereo(this.ch[c], this.ch[c + 1], sf)
      for (const ch of this.ch) this.imdct(ch, sf)
    }
  }

  reconstructNoise(ch, sf) {
    const h = this.h
    if (h.minRes > 0 || ch.validCount === 0 || ch.noiseCount === 0) return
    const sp = ch.spectra[sf]
    let random = this.random
    for (let i = 0; i < ch.noiseCount; i++) {
      random = (Math.imul(0x343fd, random) + 0x269ec3) >>> 0
      const out = (random >>> 16) & 0x7fff
      const ri = SAMPLES - ch.validCount + ((out * ch.validCount) >> 15)
      const target = ch.noises[i], source = ch.noises[ri]
      const diff = ch.scalefactors[target] - ch.scalefactors[source] + 62
      const sc = diff < 0 ? 0 : diff
      sp[target] = SCALE_CONVERSION_TABLE[sc] * sp[source]
    }
    this.random = random
  }

  reconstructHigh(ch, sf) {
    const h = this.h
    if (h.bandsPerHfr === 0 || ch.type === STEREO_SECONDARY) return
    const sp = ch.spectra[sf]
    const start = h.stereoBands + h.baseBands
    let high = start, low = start - 1
    const hfrBase = SAMPLES - h.hfrGroupCount
    const limit = h.version <= 0x200 ? h.hfrGroupCount : (h.hfrGroupCount >> 1)
    for (let g = 0; g < h.hfrGroupCount; g++) {
      const adjust = g < limit ? -1 : 1
      if (high >= h.totalBands || low < 0) break
      for (let i = 0; i < h.bandsPerHfr; i++) {
        if (high >= h.totalBands || low < 0) break
        let sc = ch.scalefactors[hfrBase + g] - ch.scalefactors[low] + 63
        if (sc < 0) sc = 0
        sp[high] = SCALE_CONVERSION_TABLE[sc] * sp[low]
        high++; low += adjust
      }
    }
    sp[high - 1] = 0
  }

  intensityStereo(a, b, sf) {
    const h = this.h
    if (a.type !== STEREO_PRIMARY) return
    const rl = INTENSITY_RATIO_TABLE[b.intensity[sf]], rr = Math.fround(2 - rl)
    const L = a.spectra[sf], R = b.spectra[sf]
    for (let band = h.baseBands; band < h.totalBands; band++) {
      const cl = L[band] * rl, cr = L[band] * rr
      L[band] = cl; R[band] = cr
    }
  }

  imdct(ch, sf) {
    const half = SAMPLES >> 1
    let t1 = ch.spectra[sf], t2 = ch.temp
    let count1 = 1, count2 = half
    for (let i = 0; i < 7; i++) {
      let p = 0, d1 = 0, d2 = count2
      for (let j = 0; j < count1; j++) {
        for (let k = 0; k < count2; k++) {
          const a = t1[p++], b = t1[p++]
          t2[d1++] = a + b
          t2[d2++] = a - b
        }
        d1 += count2; d2 += count2
      }
      const sw = t1; t1 = t2; t2 = sw
      count1 <<= 1; count2 >>= 1
    }
    // 此时 t1 = temp, t2 = spectra
    count1 = half; count2 = 1
    for (let i = 0; i < 7; i++) {
      const sin = SIN_TABLES[i], cos = COS_TABLES[i]
      let ti = 0, d1 = 0, d2 = count2 * 2 - 1, s1 = 0, s2 = count2
      for (let j = 0; j < count1; j++) {
        for (let k = 0; k < count2; k++) {
          const a = t1[s1++], b = t1[s2++]
          const sn = sin[ti], cs = cos[ti]; ti++
          t2[d1++] = a * sn - b * cs
          t2[d2--] = a * cs + b * sn
        }
        s1 += count2; s2 += count2; d1 += count2; d2 += count2 * 3
      }
      const sw = t1; t1 = t2; t2 = sw
      count1 >>= 1; count2 <<= 1
    }
    const dct = ch.spectra[sf], prev = ch.prev, w = ch.wave[sf]
    for (let i = 0; i < half; i++) {
      w[i] = IMDCT_WINDOW[i] * dct[i + half] + prev[i]
      w[i + half] = IMDCT_WINDOW[i + half] * dct[SAMPLES - 1 - i] - prev[i + half]
      prev[i] = IMDCT_WINDOW[SAMPLES - 1 - i] * dct[half - i - 1]
      prev[i + half] = IMDCT_WINDOW[half - i - 1] * dct[i]
    }
  }

  // 解一帧并写入 interleaved float（长度 channels*1024）；失败返回 false
  decodeFrame(frame, out) {
    if (this.unpack(frame) < 0) return false
    this.transform()
    const n = this.ch.length
    let o = 0
    for (let sf = 0; sf < SUBFRAMES; sf++) for (let j = 0; j < SAMPLES; j++) for (let k = 0; k < n; k++) out[o++] = this.ch[k].wave[sf][j]
    return true
  }

  // 校验密钥：前若干个非静音帧里，解包失败数 / 末尾应为 0 的数据是否真的为 0
  testKey(maxFrames = 64) {
    const h = this.h
    let good = 0, bad = 0
    for (let f = 0; f < Math.min(h.frameCount, maxFrames); f++) {
      const frame = this.frameAt(f)
      let empty = true
      for (let i = 2; i < frame.length - 2; i++) if (frame[i]) { empty = false; break }
      if (empty) continue
      const bits = this.unpack(frame)
      if (bits < 0 || bits + 14 > h.frameSize * 8) { bad++; continue }
      const start = Math.ceil(bits / 8)
      let ok = true
      for (let i = start; i < h.frameSize - 2; i++) if (this.lastData[i] !== 0) { ok = false; break }
      if (ok) good++; else bad++
    }
    return { good, bad }
  }

  frameAt(i) {
    const s = this.h.headerSize + i * this.h.frameSize
    return this.buf.subarray(s, s + this.h.frameSize)
  }
}

// HCA → { sampleRate, channels, pcm: Int16Array(interleaved，已去掉编码器首尾 padding), loop }
export function decodeHca(buf, keycode = 0n) {
  const dec = new HcaDecoder(buf, keycode)
  const h = dec.h
  const n = h.channels
  const total = h.frameCount * FRAME_SAMPLES
  const pcm = new Int16Array(total * n)
  const tmp = new Float32Array(FRAME_SAMPLES * n)
  let bad = 0
  for (let f = 0; f < h.frameCount; f++) {
    if (!dec.decodeFrame(dec.frameAt(f), tmp)) { bad++; tmp.fill(0) }
    for (let i = 0; i < tmp.length; i++) {
      const s = Math.trunc(tmp[i] * 32768)
      pcm[f * tmp.length + i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s
    }
  }
  const from = h.encoderDelay * n, to = (total - h.encoderPadding) * n
  const loop = h.loop && {
    start: h.loop.startFrame * FRAME_SAMPLES - h.encoderDelay + h.loop.startDelay,
    end: h.loop.endFrame * FRAME_SAMPLES - h.encoderDelay + (FRAME_SAMPLES - h.loop.endPadding),
  }
  return { sampleRate: h.sampleRate, channels: n, pcm: pcm.subarray(from, to), loop, badFrames: bad }
}

export function pcmToWav({ sampleRate, channels, pcm }) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(channels, 22)
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * channels * 2, 28)
  head.writeUInt16LE(channels * 2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}
