import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

// FSB5 layout and Vorbis header lookup: python-fsb5, MIT.
// Only data is vendored; no Python, native library, or network access.
const frequencies = [0, 8000, 11000, 11025, 16000, 22050, 24000, 32000, 44100, 48000]
let headers
function setupHeader(crc) {
  if (!headers) {
    const bytes = gunzipSync(readFileSync(new URL('./vendor/vorbis-headers.bin.gz', import.meta.url)))
    if (bytes.toString('ascii', 0, 4) !== 'GVC1') throw new Error('Vorbis 静态头部表无效')
    headers = new Map()
    for (let p = 4; p < bytes.length;) {
      const key = bytes.readUInt32LE(p), size = bytes.readUInt32LE(p + 4); p += 8
      if (p + size > bytes.length) throw new Error('Vorbis 静态头部表截断')
      headers.set(key, bytes.subarray(p, p + size)); p += size
    }
  }
  const setup = headers.get(crc)
  if (!setup) throw new Error(`FSB5 Vorbis 缺少静态头部 CRC=${crc}；保留缓存，不联网补取`)
  return setup
}

const ilog = (n) => n ? Math.floor(Math.log2(n)) + 1 : 0
class Bits {
  constructor(bytes) { this.bytes = bytes; this.position = 0 }
  skip(count) {
    if (!Number.isSafeInteger(count) || count < 0 || this.position + count > this.bytes.length * 8) throw new Error('Vorbis 位流截断')
    this.position += count
  }
  read(count) {
    if (count > 32) throw new Error('Vorbis 字段过长')
    const start = this.position; this.skip(count)
    let out = 0
    for (let i = 0; i < count; i++) out += ((this.bytes[(start + i) >> 3] >> ((start + i) & 7)) & 1) * 2 ** i
    return out
  }
}

// Parse setup modes to calculate each packet's block size and exact Ogg granules.
// No audio decoding is required for lossless FSB5 Vorbis -> Ogg remuxing.
export function vorbisModes(setup, channels) {
  if (setup.subarray(0, 7).toString('hex') !== '05766f72626973') throw new Error('Vorbis setup 无效')
  const b = new Bits(setup.subarray(7))
  const books = b.read(8) + 1
  for (let i = 0; i < books; i++) {
    if (b.read(24) !== 0x564342) throw new Error('Vorbis codebook 同步错误')
    const dimensions = b.read(16), entries = b.read(24)
    if (!dimensions || !entries) throw new Error('Vorbis codebook 尺寸无效')
    if (b.read(1)) {
      b.read(5)
      for (let current = 0, lengths = 0; current < entries; lengths++) {
        if (lengths > 32) throw new Error('Vorbis codebook 长度无效')
        const n = b.read(ilog(entries - current)); current += n
        if (current > entries) throw new Error('Vorbis codebook 计数无效')
      }
    } else {
      const sparse = b.read(1)
      for (let j = 0; j < entries; j++) if (!sparse || b.read(1)) b.skip(5)
    }
    const lookup = b.read(4)
    if (lookup > 2) throw new Error('Vorbis lookup 类型无效')
    if (lookup) {
      b.skip(64); const bits = b.read(4) + 1; b.skip(1)
      let values = entries * dimensions
      if (lookup === 1) {
        values = Math.floor(entries ** (1 / dimensions))
        while ((values + 1) ** dimensions <= entries) values++
        while (values ** dimensions > entries) values--
      }
      b.skip(values * bits)
    }
  }
  const times = b.read(6) + 1
  for (let i = 0; i < times; i++) if (b.read(16)) throw new Error('Vorbis time 类型无效')
  const floors = b.read(6) + 1
  for (let i = 0; i < floors; i++) {
    const type = b.read(16)
    if (type === 0) { b.skip(8 + 16 + 16 + 6 + 8); const books = b.read(4) + 1; b.skip(books * 8) }
    else if (type === 1) {
      const partitions = Array.from({ length: b.read(5) }, () => b.read(4))
      const dimensions = []
      for (let j = 0; j <= Math.max(-1, ...partitions); j++) {
        dimensions.push(b.read(3) + 1); const subclasses = b.read(2)
        if (subclasses) b.skip(8)
        b.skip((1 << subclasses) * 8)
      }
      b.skip(2); const range = b.read(4)
      for (const index of partitions) b.skip(dimensions[index] * range)
    } else throw new Error('Vorbis floor 类型无效')
  }
  const residues = b.read(6) + 1
  for (let i = 0; i < residues; i++) {
    if (b.read(16) > 2) throw new Error('Vorbis residue 类型无效')
    b.skip(72); const classifications = b.read(6) + 1; b.skip(8)
    const cascade = []
    for (let j = 0; j < classifications; j++) { const low = b.read(3); cascade.push(low | (b.read(1) ? b.read(5) << 3 : 0)) }
    for (const value of cascade) for (let j = 0; j < 8; j++) if (value & (1 << j)) b.skip(8)
  }
  const mappings = b.read(6) + 1
  for (let i = 0; i < mappings; i++) {
    if (b.read(16)) throw new Error('Vorbis mapping 类型无效')
    const submaps = b.read(1) ? b.read(4) + 1 : 1
    if (b.read(1)) { const steps = b.read(8) + 1; b.skip(steps * 2 * ilog(channels - 1)) }
    if (b.read(2)) throw new Error('Vorbis mapping 保留位无效')
    if (submaps > 1) b.skip(channels * 4)
    b.skip(submaps * 24)
  }
  const modes = Array.from({ length: b.read(6) + 1 }, () => {
    const long = b.read(1)
    if (b.read(16) || b.read(16)) throw new Error('Vorbis mode 类型无效')
    if (b.read(8) >= mappings) throw new Error('Vorbis mode mapping 越界')
    return long ? 2048 : 256
  })
  if (!b.read(1)) throw new Error('Vorbis framing 位无效')
  return modes
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n << 24
  for (let i = 0; i < 8; i++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1
  return value >>> 0
})
const crc32 = (bytes) => { let crc = 0; for (const value of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ value) & 255]) >>> 0; return crc }

function oggPackets(packets) {
  const pages = []; let sequence = 0
  for (let index = 0; index < packets.length; index++) {
    const { bytes, granule } = packets[index], lacing = []
    for (let remaining = bytes.length; remaining >= 255; remaining -= 255) lacing.push(255)
    lacing.push(bytes.length % 255)
    let offset = 0
    for (let start = 0; start < lacing.length; start += 255) {
      const segments = lacing.slice(start, start + 255), last = start + 255 >= lacing.length
      const size = segments.reduce((sum, n) => sum + n, 0), head = Buffer.alloc(27 + segments.length)
      head.write('OggS'); head[5] = (start ? 1 : 0) | (index === 0 && !start ? 2 : 0) | (index === packets.length - 1 && last ? 4 : 0)
      head.writeBigUInt64LE(last ? BigInt(granule) : 0xffffffffffffffffn, 6)
      head.writeUInt32LE(1, 14); head.writeUInt32LE(sequence++, 18); head[26] = segments.length
      head.set(segments, 27)
      const page = Buffer.concat([head, bytes.subarray(offset, offset + size)])
      page.writeUInt32LE(crc32(page), 22); pages.push(page); offset += size
    }
  }
  return Buffer.concat(pages)
}

function rebuildVorbis(sample) {
  if (sample.crc === undefined) throw new Error('FSB5 Vorbis 缺少头部标识')
  const setup = setupHeader(sample.crc), modes = vorbisModes(setup, sample.channels)
  const id = Buffer.alloc(30); id[0] = 1; id.write('vorbis', 1); id[11] = sample.channels; id.writeUInt32LE(sample.frequency, 12); id[28] = 0xb8; id[29] = 1
  const vendor = Buffer.from('gal-download'), comment = Buffer.alloc(16 + vendor.length)
  comment[0] = 3; comment.write('vorbis', 1); comment.writeUInt32LE(vendor.length, 7); vendor.copy(comment, 11); comment[comment.length - 1] = 1
  const packets = [{ bytes: id, granule: 0 }, { bytes: comment, granule: 0 }, { bytes: setup, granule: 0 }]
  let previous = 0, granule = 0
  for (let p = 0; p + 2 <= sample.data.length;) {
    const size = sample.data.readUInt16LE(p); p += 2
    if (!size) break
    if (p + size > sample.data.length) throw new Error('FSB5 Vorbis 音频包截断')
    const packet = sample.data.subarray(p, p + size); p += size
    const bits = new Bits(packet)
    if (bits.read(1)) throw new Error('FSB5 Vorbis 音频包类型无效')
    const block = modes[bits.read(ilog(modes.length - 1))]
    if (!block) throw new Error('FSB5 Vorbis 音频 mode 越界')
    if (previous) granule += (previous + block) / 4
    packets.push({ bytes: packet, granule }); previous = block
  }
  if (packets.length === 3 || !sample.samples || sample.samples > granule) throw new Error('FSB5 Vorbis 音频长度无效')
  packets.at(-1).granule = sample.samples
  return oggPackets(packets)
}

function rebuildPcm(sample, mode) {
  const widths = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 }, width = widths[mode]
  const length = sample.samples * sample.channels * width
  if (!Number.isSafeInteger(length) || !length || length > sample.data.length) throw new Error('FSB5 PCM 数据截断')
  const head = Buffer.alloc(44)
  head.write('RIFF'); head.writeUInt32LE(36 + length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16)
  head.writeUInt16LE(mode === 5 ? 3 : 1, 20); head.writeUInt16LE(sample.channels, 22); head.writeUInt32LE(sample.frequency, 24)
  head.writeUInt32LE(sample.frequency * sample.channels * width, 28); head.writeUInt16LE(sample.channels * width, 32); head.writeUInt16LE(width * 8, 34)
  head.write('data', 36); head.writeUInt32LE(length, 40)
  // FSB PCM8 is signed, whereas RIFF PCM8 is unsigned.
  const data = Buffer.from(sample.data.subarray(0, length))
  if (mode === 1) for (let i = 0; i < data.length; i++) data[i] ^= 128
  return Buffer.concat([head, data])
}

export function unpackFsb5(bytes) {
  if (bytes.length < 60 || bytes.toString('ascii', 0, 4) !== 'FSB5') throw new Error('FSB5 头部无效')
  const version = bytes.readUInt32LE(4), count = bytes.readUInt32LE(8), headerBytes = bytes.readUInt32LE(12), namesBytes = bytes.readUInt32LE(16), dataBytes = bytes.readUInt32LE(20), mode = bytes.readUInt32LE(24)
  if (version > 1 || count !== 1) throw new Error(`不支持 FSB5 version=${version}, samples=${count}；AudioClip 必须唯一`)
  const base = version === 0 ? 64 : 60, dataStart = base + headerBytes + namesBytes
  if (base + headerBytes > bytes.length || dataStart + dataBytes > bytes.length || headerBytes < 8) throw new Error('FSB5 数据范围无效')
  const packed = bytes.readBigUInt64LE(base)
  let next = Number(packed & 1n), p = base + 8
  const sample = { frequency: frequencies[Number(packed >> 1n & 15n)], channels: Number(packed >> 5n & 1n) + 1, samples: Number(packed >> 34n), offset: Number(packed >> 6n & 0xfffffffn) * 16 }
  while (next) {
    if (p + 4 > base + headerBytes) throw new Error('FSB5 metadata 截断')
    const chunk = bytes.readUInt32LE(p); p += 4
    next = chunk & 1; const size = chunk >>> 1 & 0xffffff, type = chunk >>> 25
    if (p + size > base + headerBytes) throw new Error('FSB5 metadata 越界')
    if (type === 1 && size === 1) sample.channels = bytes[p]
    if (type === 2 && size === 4) sample.frequency = bytes.readUInt32LE(p)
    if (type === 11 && size >= 4) sample.crc = bytes.readUInt32LE(p)
    p += size
  }
  if (!sample.frequency || !sample.channels || sample.channels > 8 || sample.offset >= dataBytes) throw new Error('FSB5 音频参数无效')
  sample.data = bytes.subarray(dataStart + sample.offset, dataStart + dataBytes)
  if (mode === 15) return { bytes: rebuildVorbis(sample), format: 'ogg', mode, channels: sample.channels, frequency: sample.frequency, samples: sample.samples }
  if (mode >= 1 && mode <= 5) return { bytes: rebuildPcm(sample, mode), format: 'wav', mode, channels: sample.channels, frequency: sample.frequency, samples: sample.samples }
  if (mode === 11) return { bytes: sample.data, format: 'mp3', mode, channels: sample.channels, frequency: sample.frequency, samples: sample.samples }
  throw new Error(`尚未支持 FSB5 编码 ${mode}；保留缓存，不下载解码器`)
}
