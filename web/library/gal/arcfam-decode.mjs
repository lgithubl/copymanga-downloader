// 自有 arc 家族（eomaia 引擎）的剧本 SCRE → 事件流（arcfam-scre/1，适配器 arcfam::scre 吃它）。
// 依据：g06 あざとカワイイ綾瀬ちゃん！ / g10 ギャル×オタ 的 script.arc（Encode:false，剧本是明文 SCRE）。不是把字节码完整解释一遍，而是认字节模式（和 bgi 不同，没有逆出全部操作码）：
//   SCRE 头：'SCRE' u32 0、u32 行数、u32 20、(行数 + 1) 个 u32 偏移（第一个 = 字节码起点）；字节码是栈机，整数一律大端：0x32 + i32 = 压整数，0x33 + 字符串\0 = 压字符串，0x17 = 调用，0x14 + 字符串\0 = 文本，0x18 + 8 字节 = 行号（u32，u32）
//   资源调用：`33 文件名\0  32 方法号  33 对象名\0  …  17`——对象 eomaia_audio（129 = 语音 .ogg，102 = BGM .wav，117 = 音效 .wav）、eomaia_image（102 = 底图：bg* / BG_* / EV*S* / h* / e*，105 / 106 = 叠加层：face / moji / karada / eff / cutin）等
//   说话人：`33 【名字】\0` 在文本之前压栈，只用一次
//   脚本引用：`33 xxx.script\0`（下一个脚本 / 分支去的脚本 / 回想场景）→ ['j', 名字]。真实脚本里：g06 的 ADV_KOHAI02 末尾只有一个（adv_kohai03.script）= 接着播；ADV_KOHAI08 末尾并排两个（adv_kohai08a / 08b）= 路线分支；中间出现的（adv_kohai_h01 等）是 H 场景，也在列表里，这里只记 links
// 没做：脚本内的选择（g06 / g10 的剧本里没有选项文字，路线分支靠脚本引用）、条件判断、叠加层的位置、立绘（这个引擎的样本里没看到立绘调用）、操作码的完整语义。
const AUDIO_METHODS = { 129: 'v', 102: 'b', 117: 's' }   // eomaia_audio

export function isScre(buf) { return buf.length > 20 && buf.subarray(0, 4).toString('latin1') === 'SCRE' }

export function decodeScre(buf) {
  if (!isScre(buf)) throw new Error('不是 SCRE 剧本')
  const count = buf.readUInt32LE(8)
  if (count > 1_000_000 || 16 + (count + 1) * 4 > buf.length) throw new Error('SCRE 行数不合理')
  const start = buf.readUInt32LE(16)
  if (start < 16 || start > buf.length) throw new Error('SCRE 字节码起点不合理')
  const s = buf.toString('latin1')
  const events = []
  const utf8 = (latin) => Buffer.from(latin, 'latin1').toString('utf8')
  // 资源调用
  const res = /3([\x21-\x7e]{1,60}\.[A-Za-z0-9]{2,4})\x002([\s\S]{4})3([a-z_]{3,20})\x00/g
  for (let m = res.exec(s); m; m = res.exec(s)) {
    if (m.index < start) continue
    const method = Buffer.from(m[2], 'latin1').readUInt32BE(0)
    const file = m[1]
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
    if (m[3] === 'eomaia_audio' && AUDIO_METHODS[method] && (ext === 'ogg' || ext === 'wav')) events.push({ at: m.index, e: [AUDIO_METHODS[method], file] })
    else if (m[3] === 'eomaia_image' && (method === 102 || method === 105 || method === 106) && ext === 'png') events.push({ at: m.index, e: ['i', method, file] })
  }
  // 脚本引用
  const ref = /3([\x20-\x7e]{3,40}\.script)\x00/g
  for (let m = ref.exec(s); m; m = ref.exec(s)) if (m.index >= start) events.push({ at: m.index, e: ['j', m[1].toLowerCase()] })
  // 说话人：【名字】
  const who = /3(\xe3\x80\x90[^\x00]{1,80}?\xe3\x80\x91)\x00/g
  for (let m = who.exec(s); m; m = who.exec(s)) if (m.index >= start) events.push({ at: m.index, e: ['w', utf8(m[1]).replace(/^【|】$/g, '')] })
  // 文本：0x14 + utf-8 + \0（至少 2 个字符；前面是「32 00 00 00」整数的最后一个字节不算）
  const text = /\x14((?:[\x20-\x7e]|[\xc2-\xdf][\x80-\xbf]|[\xe0-\xef][\x80-\xbf]{2}|[\xf0-\xf4][\x80-\xbf]{3}){2,})\x00/g
  for (let m = text.exec(s); m; m = text.exec(s)) {
    if (m.index < start) continue
    if (m.index >= 4 && buf[m.index - 4] === 0x32 && buf[m.index - 3] === 0 && buf[m.index - 2] === 0 && buf[m.index - 1] === 0) continue   // 整数 0x14 的低字节
    let line = null
    if (m.index >= 9 && buf[m.index - 9] === 0x18) line = buf.readUInt32BE(m.index - 8)
    events.push({ at: m.index, e: ['t', utf8(m[1]), line] })
  }
  events.sort((a, b) => a.at - b.at)
  return events.map((x) => x.e)
}
