// 给 WAV 末尾补一段静音。
// 为什么要补：<audio> 倍速 != 1 时浏览器走变速不变调（Chromium 是 WSOLA），算法按窗口吃数据，
// 到流末尾不满一个窗口的那截会被丢掉，倍速越高丢得越多。GSV 合成的句子在最后一个音之后
// 几乎不留白，被丢的正好是句尾的真实语音 —— 表现就是「倍速朗读经常最后几个字没读完」。
// 补一小段静音后，被吃掉的只是静音。
//
// 只处理 PCM（整数）和 IEEE float，以及它们的 WAVE_FORMAT_EXTENSIBLE 包装；认不出的格式
// 原样返回 null，调用方照发原文件，不至于因为补静音把能播的音频弄坏。

const WAVE_FORMAT_PCM = 1
const WAVE_FORMAT_IEEE_FLOAT = 3
const WAVE_FORMAT_EXTENSIBLE = 0xfffe

export function padWavSilence(buffer, ms) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || !(ms > 0)) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null
  let fmt = null
  let dataOffset = -1
  let dataSize = 0
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      let format = buffer.readUInt16LE(body)
      if (format === WAVE_FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= buffer.length) format = buffer.readUInt16LE(body + 24)   // SubFormat GUID 的前两个字节
      fmt = {
        format,
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      dataOffset = body
      // 流式写出的 WAV 常把长度写成 0 或 0xFFFFFFFF：以文件里实际剩下的字节为准
      const remaining = buffer.length - body
      dataSize = size > 0 && size <= remaining ? size : remaining
      break
    }
    offset = body + size + (size % 2)   // RIFF 块按偶数字节对齐
  }
  if (!fmt || dataOffset < 0) return null
  if (fmt.format !== WAVE_FORMAT_PCM && fmt.format !== WAVE_FORMAT_IEEE_FLOAT) return null
  if (!fmt.blockAlign || !fmt.sampleRate || !fmt.channels) return null
  const frames = Math.round((fmt.sampleRate * ms) / 1000)
  const padBytes = frames * fmt.blockAlign
  if (!padBytes) return null
  // data 块之后可能还跟着 LIST 之类的块：静音必须紧贴在样本后面，后面的块原样接上
  const dataEnd = dataOffset + dataSize
  const tail = buffer.subarray(dataEnd + (dataSize % 2))
  // 8 位 PCM 是无符号的，静音是 0x80；其它位深（有符号整数 / float）静音都是 0
  const silence = Buffer.alloc(padBytes, fmt.format === WAVE_FORMAT_PCM && fmt.bitsPerSample === 8 ? 0x80 : 0)
  const newDataSize = dataSize + padBytes
  const out = Buffer.concat([
    buffer.subarray(0, dataEnd),
    silence,
    newDataSize % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
    tail,
  ])
  out.writeUInt32LE(newDataSize, dataOffset - 4)
  out.writeUInt32LE(out.length - 8, 4)
  return out
}
