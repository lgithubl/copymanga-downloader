// WillPlus ADVPlayerHD 的 .ws2 脚本解码（引擎 2.x，脚本版本 2.11）。
//   · 文件逐字节循环右移 2 位（ROR 2）加密；解开后是「1 字节 opcode + 参数」的指令流，字符串是 UTF-16LE + 00 00 结尾；u16 / u32 / f32 小端
//   · 指令表来自社区工具 DarthFly/advhd_ws2_tools（Ws2/Opcodes，PHP）逐条翻译，版本分支按 2.11 取（v > 2.1 / > 1.4 / > 1.06 / > 1.0 全成立）；
//     0xAF（b4 + f4）是 LPSL 里多出来的一条（社区表里没有，从 5 个剧情脚本里的固定形状推出：后面紧跟着认得的 Unk65 / SetDisplayName）
//     用 LPSL（ensemble SWEET，AdvHD 2.1.0.0）的 Rio / Rio1 的 .ws2 验证：每个剧情文件正好读到 FF 指令，不多不少
//   · ExecuteFunction(Lua 函数名, 字符串参数, u16, byte)：社区表写成 b3；GetMsgSkip 的 (231, 3, 1) = u16 999（LegacyGame.lua 里 GetMsgSkip(_, 标志号) 把结果写进这个标志，脚本随后 Condition 的变量正是 999）+ byte 1，所以按 w + b 读
//   · 只做解码（指令 + 参数），不做语义；语义（背景 / 立绘 / 语音 / 选项 …）在 advhd-ws2.mjs
export const ror2 = (buffer) => { const out = Buffer.allocUnsafe(buffer.length); for (let i = 0; i < buffer.length; i++) { const x = buffer[i]; out[i] = ((x >> 2) | ((x & 3) << 6)) & 0xff } return out }

class Reader {
  constructor(buffer) { this.b = buffer; this.p = 0 }
  get left() { return this.b.length - this.p }
  u8() { if (this.p >= this.b.length) throw new Error('eof'); return this.b[this.p++] }
  bytes(n) { if (this.p + n > this.b.length) throw new Error('eof'); const out = [...this.b.subarray(this.p, this.p + n)]; this.p += n; return out }
  u16() { if (this.p + 2 > this.b.length) throw new Error('eof'); const v = this.b.readUInt16LE(this.p); this.p += 2; return v }
  u32() { if (this.p + 4 > this.b.length) throw new Error('eof'); const v = this.b.readUInt32LE(this.p); this.p += 4; return v }
  f32() { if (this.p + 4 > this.b.length) throw new Error('eof'); const v = this.b.readFloatLE(this.p); this.p += 4; return Math.round(v * 1e6) / 1e6 }
  peek() { return this.b[this.p] }
  str() {
    let q = this.p
    while (q + 1 < this.b.length && !(this.b[q] === 0 && this.b[q + 1] === 0)) q += 2
    if (q + 1 >= this.b.length) throw new Error('eof')
    const s = this.b.toString('utf16le', this.p, q)
    this.p = q + 2
    return s
  }
}

// 参数规格：'s' 字符串、'b' 字节、'w' u16、'd' u32、'f' f32；后面的数字 = 个数
// name = 社区工具里的名字（有的是猜的）。特殊指令（变长）单独处理
const FIXED = {
  0x05: ['Unk05', []], 0x08: ['Unk08', ['b']], 0x0a: ['Unk0A', ['b22']], 0x0d: ['Unk0D', ['b8']], 0x0e: ['Unk0E', ['b5']], 0x13: ['Unk13', ['b9']],
  0x17: ['Unk17', ['b']], 0x1b: ['Unk1B', ['b']], 0x1d: ['Unk1D', ['b2']], 0x3d: ['Unk3D', ['b2']], 0x3e: ['Unk3E', []], 0x64: ['Unk64', ['b']], 0x68: ['Unk68', ['b']],
  0xfb: ['UnkFB', ['b']], 0xfc: ['UnkFC', ['b2']], 0xfd: ['UnkFD', []],
  0x02: ['Jump2', ['d']], 0x06: ['Jump', ['d']], 0x09: ['LayerConfig', ['b3', 'f']], 0x0b: ['SetFlag', ['w', 'b']],
  0x04: ['RunFile', ['s']], 0x07: ['NextFile', ['s']], 0x1a: ['OpenTitle', ['s']], 0x37: ['ClearLayer', ['s']], 0x5c: ['RainEnd', ['s']], 0x66: ['ShowGraphic', ['s']], 0x43: ['Unk43', ['s']], 0x6f: ['VariableUnk', ['s']], 0x32: ['VariableUnk32', ['s']],
  0x11: ['SetTimer', ['s', 'b', 'f']], 0x12: ['StartTimer', ['s', 'b3']], 0x14: ['DisplayMessage', ['d', 's', 's', 'b']], 0x15: ['SetDisplayName', ['s', 'b']],
  0x16: ['Unk16', ['b2']], 0x18: ['AddMessageToLog', ['b', 's']], 0x19: ['Unk19', ['b4']], 0x1c: ['ExecuteFunction', ['s', 's', 'w', 'b']],
  0x1e: ['PlayMusic', ['s', 's', 'b17']], 0x1f: ['StopMusic', ['s', 'f']], 0x20: ['MusicUnk1', ['s', 'f', 'w']],
  0x28: ['SoundEffect', ['s', 's', 'f', 'f', 'b14']], 0x29: ['SoundUnk1', ['s', 'f']], 0x2a: ['SoundUnk2', ['s', 'f', 'b2']], 0x2e: ['CharMessageStart', []], 0x30: ['SoundEffectUnk30', ['s', 'f']],
  0x33: ['SetBackground', ['s', 's']], 0x34: ['UsePnaPackage', ['s', 's', 'b2']], 0x35: ['PlayMovie', ['s', 's', 'b3']],
  0x36: ['PrepareBackgroundArea', ['s', 'f7', 'b2']], 0x38: ['VariableUnk3', ['s', 'b']], 0x3a: ['UnkBackground2', ['s', 'b2']],
  0x3b: ['BackgroundMessage', ['s', 's', 'w', 'd', 'f8']], 0x40: ['SetMask', ['s', 's', 'b']], 0x41: ['UnkBackground3', ['s', 'b']], 0x42: ['Unk42', ['s', 'b2']],
  0x44: ['Effect44', ['s', 's', 'b']], 0x45: ['DragBackground', ['s', 'b2', 'f4']], 0x46: ['MoveBackground', ['s', 'b3', 'f4']],
  0x47: ['Effect1', ['s', 's', 'b4', 'f6', 'b2']], 0x48: ['Effect2', ['s', 's', 'b6']], 0x4a: ['Unk4A', ['s', 's']],
  0x51: ['VariableUnk51', ['s', 's', 'b7']], 0x52: ['VariableUnk2', ['s', 's', 'f', 'b7', 's']], 0x53: ['VariableUnk4', ['s', 's']],
  0x56: ['RainStart', ['s', 'b7', 'f10', 'd5', 's', 'b2', 's', 's', 'b4']], 0x57: ['UnkBackground1', ['s', 'b2']], 0x58: ['Effect3', ['s', 's']],
  0x5b: ['InitKeyName', ['s', 'w', 'b']], 0x65: ['Unk65', ['b3', 'f', 'f', 'b3']], 0x67: ['Unk67', ['b4', 'f5', 'b']],
  0x6e: ['SetVariable', ['s', 's']], 0x73: ['SetPnaFile', ['s', 's', 'b2']], 0x75: ['Unk75', ['s', 's']], 0x78: ['Unk78', ['s', 's', 'b3']],
  0x7a: ['Unk7A', ['s', 's', 'f', 'b3']], 0x7b: ['Unk7B', ['s', 's']], 0x84: ['Unk84', ['s', 's', 's', 'f', 'b2', 'f']],
  0x97: ['Unk97', ['b3', 'f4']], 0xaf: ['UnkAF', ['b4', 'f4']], 0xb0: ['UnkB0', ['s', 'b4', 'f4']], 0xe6: ['ConditionalJump', ['d', 'd']], 0xf0: ['UnkScreen', ['b']], 0xff: ['FileEnd', ['d', 'b4']],
}
export const OPCODE_TABLE = FIXED
export const OPCODE_NAMES = Object.fromEntries(Object.entries(FIXED).map(([op, [name]]) => [op, name]))
OPCODE_NAMES[0x01] = 'Condition'; OPCODE_NAMES[0x0f] = 'ShowChoice'; OPCODE_NAMES[0x39] = 'DisplayCharacterImage'; OPCODE_NAMES[0x3f] = 'LayersList'

function readSpec(r, spec) {
  const out = []
  for (const item of spec) {
    const kind = item[0]
    const n = item.length > 1 ? Number(item.slice(1)) : 1
    for (let i = 0; i < n; i++) out.push(kind === 's' ? r.str() : kind === 'b' ? r.u8() : kind === 'w' ? r.u16() : kind === 'd' ? r.u32() : r.f32())
  }
  return out
}

// 解码一个已经解开 ROR2 的脚本 → [{ at, op, name, args }]；读不懂的指令抛 Error（带偏移）
// tolerant=true：读到不认识的指令就停下，返回已解出的部分（out.truncated 记原因）——菜单/标题这类 UI 脚本不影响剧情
export function decodeWs2(plain, { tolerant = false } = {}) {
  const r = new Reader(plain)
  const out = []
  while (r.left > 0) {
    const at = r.p
    const op = r.u8()
    try {
      if (op === 0x01) {   // Condition：类型 + （某些类型）u16 变量 + f32 + 两个跳转目标
        const kind = r.u8()
        const args = [kind]
        if ([2, 128, 129, 130, 192].includes(kind) || (kind === 3 && [50, 51, 125, 127, 128].includes(r.peek()))) { args.push(r.u16(), r.f32(), r.u32(), r.u32()) }
        out.push({ at, op, name: 'Condition', args })
      } else if (op === 0x0f) {   // ShowChoice：个数 + 每项 { u16 id, 文字, 3 字节, 跳转类型 (6 = u32 指针, 7 = 文件名) }
        const count = r.u8()
        const choices = []
        for (let i = 0; i < count; i++) {
          const id = r.u16()
          const text = r.str()
          const [a, b, c, jump] = r.bytes(4)
          let target
          if (jump === 6) target = r.u32()
          else if (jump === 7) target = r.str()
          else throw new Error(`ShowChoice 的跳转类型 ${jump} 不认识`)
          choices.push({ id, text, flags: [a, b, c], jump, target })
        }
        out.push({ at, op, name: 'ShowChoice', args: [count], choices })
      } else if (op === 0x39) {   // DisplayCharacterImage：通道 + 3 字节（第 3 个 = 图片 id 个数）+ 个数个 u16
        const channel = r.str()
        const cfg = r.bytes(3)
        const ids = []
        for (let i = 0; i < cfg[2]; i++) ids.push(r.u16())
        out.push({ at, op, name: 'DisplayCharacterImage', args: [channel, ...cfg], ids })
      } else if (op === 0x3f) {   // LayersList：个数 + 字符串
        const n = r.u8()
        const layers = []
        for (let i = 0; i < n; i++) layers.push(r.str())
        out.push({ at, op, name: 'LayersList', args: [n, ...layers] })
      } else if (FIXED[op]) {
        out.push({ at, op, name: FIXED[op][0], args: readSpec(r, FIXED[op][1]) })
      } else throw new Error(`opcode 0x${op.toString(16)} 不认识`)
    } catch (error) {
      const message = `ws2 偏移 ${at}（opcode 0x${op.toString(16)}）：${error.message}`
      if (tolerant) { out.truncated = message; break }
      throw new Error(message)
    }
  }
  return out
}
