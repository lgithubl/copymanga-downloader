// WillPlus ADVPlayerHD 的 .ws2 脚本解码（引擎 2.1.0.0）。
//   · 文件逐字节循环右移 2 位（ROR 2；exe 里是 OpenMP 并行的 ror 循环，FUN_140324e60）解开后是「1 字节 opcode + 操作数」的指令流，文件最后 8 字节是尾巴（两个 u32）
//   · **操作数布局来自 exe 本身**：解释器主循环（FUN_14008ce80）读一个 opcode，用 PTR_DAT_1403ea420[opcode] 这张「操作数类型表」读操作数，再调 LegacyGame+0x1bb0+opcode*8 处注册的处理函数（FUN_140061fb0 里注册，161 个）。
//     类型码：00 = u8、01 = u16、04 = u32、05 = f32、06 08 = 名字字符串、0a 08 = 文件名字符串、09 08 = 字符串、07 X = 数组（先一个 u8 个数，再 X 型元素）；字符串 = UTF-16LE + 00 00；全部小端
//     （06 / 0a 型字符串以 @ 开头 = 脚本变量引用，运行时替换，见 FUN_140127fb0）。下面的 OPCODE_LAYOUTS 就是从 exe 里导出来的整张表（254 项里有布局的 <built-in function len> 项）。
//   · 比社区工具（DarthFly/advhd_ws2_tools，针对 2.11）准：社区表里 SetBackground 少 2 个字节、Condition 的变长是猜的——以前的解码器把 SetBackground 后面的 (1, 1) 当成了一条假的 Condition(kind 1)。用这张表 LPSL 的 201 个脚本全部正好读到 FF（FileEnd）+ 8 字节尾巴，没有一个例外。
//   · ShowChoice（0x0f）表里只有选项个数，选项本身由处理函数读：{u16 id, 文字, 3 个 u8, 跳转类型 u8 (6 = u32 偏移 / 7 = 脚本名)}
//   · 只做解码（指令 + 参数），不做语义；语义（背景 / 立绘 / 语音 / 选项 …）在 advhd-ws2.mjs
export const ror2 = (buffer) => { const out = Buffer.allocUnsafe(buffer.length); for (let i = 0; i < buffer.length; i++) { const x = buffer[i]; out[i] = ((x >> 2) | ((x & 3) << 6)) & 0xff } return out }

class Reader {
  constructor(buffer) { this.b = buffer; this.p = 0 }
  get left() { return this.b.length - this.p }
  u8() { if (this.p >= this.b.length) throw new Error('eof'); return this.b[this.p++] }
  u16() { if (this.p + 2 > this.b.length) throw new Error('eof'); const v = this.b.readUInt16LE(this.p); this.p += 2; return v }
  u32() { if (this.p + 4 > this.b.length) throw new Error('eof'); const v = this.b.readUInt32LE(this.p); this.p += 4; return v }
  f32() { if (this.p + 4 > this.b.length) throw new Error('eof'); const v = this.b.readFloatLE(this.p); this.p += 4; return Math.round(v * 1e6) / 1e6 }
  str() {
    let q = this.p
    while (q + 1 < this.b.length && !(this.b[q] === 0 && this.b[q + 1] === 0)) q += 2
    if (q + 1 >= this.b.length) throw new Error('eof')
    const s = this.b.toString('utf16le', this.p, q)
    this.p = q + 2
    return s
  }
}

// 操作数布局（opcode → 类型表）：b u8 / w u16 / d u32 / f f32 / s 名字 / S 文件名 / T 字符串 / a<类型> = 个数(u8) + 元素。从 AdvHD.exe 的 PTR_DAT_1403ea420 导出（见文件头）
export const OPCODE_LAYOUTS = {
  0x00: [],
  0x01: ["b", "w", "f", "d", "d"],
  0x02: ["d"],
  0x04: ["S"],
  0x05: [],
  0x06: ["d"],
  0x07: ["S"],
  0x08: ["b"],
  0x09: ["b", "w", "f"],
  0x0a: ["w", "f"],
  0x0b: ["w", "b"],
  0x0c: ["w", "b", "aw"],
  0x0d: ["w", "w", "f"],
  0x0e: ["w", "w", "b"],
  0x0f: ["b"],
  0x11: ["s", "b", "f"],
  0x12: ["s", "b", "S"],
  0x13: [],
  0x14: ["d", "s", "s", "b"],
  0x15: ["s", "b"],
  0x16: ["b", "b"],
  0x17: [],
  0x18: ["b", "s"],
  0x19: [],
  0x1a: ["s"],
  0x1b: ["b"],
  0x1c: ["s", "s", "w", "b"],
  0x1d: ["w"],
  0x1e: ["s", "S", "f", "f", "w", "w", "b", "f"],
  0x1f: ["s", "f"],
  0x20: ["s", "f", "w"],
  0x21: ["s", "w", "w", "w"],
  0x22: ["s", "b"],
  0x28: ["s", "S", "f", "f", "w", "w", "b", "w", "w", "b", "f"],
  0x29: ["s", "f"],
  0x2a: ["s", "f", "w"],
  0x2b: ["s"],
  0x2c: ["s"],
  0x2d: ["s", "b"],
  0x2e: [],
  0x2f: ["s", "w", "f"],
  0x30: ["s", "f"],
  0x32: ["S"],
  0x33: ["s", "S", "b", "b"],
  0x34: ["s", "S", "b", "b"],
  0x35: ["s", "S", "b", "b", "b"],
  0x36: ["s", "f", "f", "f", "f", "f", "f", "f", "b", "b"],
  0x37: ["s"],
  0x38: ["s", "b"],
  0x39: ["s", "b", "b", "aw"],
  0x3a: ["s", "b", "b"],
  0x3b: ["s", "s", "w", "w", "w", "f", "f", "f", "f", "f", "f", "f", "f"],
  0x3c: ["s"],
  0x3d: ["w"],
  0x3e: [],
  0x3f: ["as"],
  0x40: ["s", "S", "b"],
  0x41: ["s", "b"],
  0x42: ["s", "w"],
  0x43: ["s"],
  0x44: ["s", "s", "b"],
  0x45: ["s", "w", "f", "f", "f", "f"],
  0x46: ["s", "w", "b", "f", "f", "f", "f"],
  0x47: ["s", "s", "w", "b", "b", "f", "f", "f", "f", "f", "w", "f"],
  0x48: ["s", "s", "w", "b", "b", "S"],
  0x49: ["s", "s", "S"],
  0x4a: ["s", "s"],
  0x4b: ["s", "w", "w", "f", "f", "f", "f"],
  0x4c: ["s", "w", "w", "b", "f", "f", "f", "f"],
  0x4d: ["s", "s", "w", "w", "b", "b", "f", "f", "f", "f", "f", "w", "f"],
  0x4e: ["s", "s", "w", "w", "b", "b", "S"],
  0x4f: ["s", "s", "w", "S"],
  0x50: ["s", "s", "w"],
  0x51: ["s", "s", "w", "f", "b"],
  0x52: ["s", "s", "f", "w", "f", "b", "S"],
  0x53: ["s", "s"],
  0x54: ["s", "s", "S"],
  0x55: ["s", "s"],
  0x56: ["s", "b", "w", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "f", "b", "f", "f", "f", "f", "b", "w", "s", "w", "s", "S", "f"],
  0x57: ["s", "w"],
  0x58: ["s", "s"],
  0x59: ["s", "s", "w"],
  0x5a: ["s", "aw"],
  0x5b: ["s", "w", "b"],
  0x5c: ["s"],
  0x5d: ["s", "s", "b"],
  0x5e: ["s", "f", "f"],
  0x5f: ["S"],
  0x60: ["w", "w", "w", "w"],
  0x61: ["b", "f", "f", "f", "f"],
  0x62: ["s"],
  0x63: ["s", "b"],
  0x64: ["b"],
  0x65: ["w", "b", "f", "f", "b", "S"],
  0x66: ["S"],
  0x67: ["b", "b", "w", "f", "f", "f", "f", "f", "b"],
  0x68: ["b"],
  0x69: ["s", "b", "b", "f", "f", "f", "f", "f", "w", "f"],
  0x6a: ["s", "w", "b", "b", "S"],
  0x6b: ["s", "s"],
  0x6c: ["s", "f", "f"],
  0x6d: ["s", "f", "f", "b", "b", "b"],
  0x6e: ["T", "s"],
  0x6f: ["T"],
  0x70: ["T", "w"],
  0x71: [],
  0x72: ["T", "w", "w", "T"],
  0x73: ["T", "T", "w"],
  0x74: ["T", "T"],
  0x75: ["T", "s"],
  0x78: ["s", "S", "b", "b", "b"],
  0x79: ["s", "s", "f"],
  0x7a: ["s", "S", "f", "b", "b", "S"],
  0x7b: ["s", "S"],
  0x7c: ["s", "s", "f"],
  0x7d: ["s", "f"],
  0x7e: ["s"],
  0x7f: ["s", "f", "f", "f", "f", "f"],
  0x80: ["s"],
  0x81: ["s", "b", "S", "f", "f", "b"],
  0x82: ["s", "S", "f"],
  0x83: ["s", "s", "f", "f"],
  0x84: ["s", "s", "s", "f", "w", "f"],
  0x85: ["s", "s", "b", "f"],
  0x86: ["s", "f", "f", "f"],
  0x87: ["s", "f"],
  0x88: ["s", "s", "s", "f", "w", "f"],
  0x89: ["s", "f", "f"],
  0x8a: ["s", "s", "b", "b", "b"],
  0x8c: ["s", "S", "s", "b", "b", "s", "S"],
  0x8d: ["d", "s", "s", "b", "b", "w", "S"],
  0x8e: ["d", "s", "s", "b", "b", "w", "S"],
  0x8f: ["s", "S"],
  0x90: ["s"],
  0x91: [],
  0x96: ["w", "f", "f", "f", "f"],
  0x97: ["w", "b", "f", "f", "f", "f"],
  0x98: ["s", "w", "b", "b", "f", "f", "f", "f", "f", "w", "f"],
  0x99: ["s", "w", "b", "b", "S"],
  0x9a: [],
  0x9b: ["s"],
  0x9c: ["s", "S"],
  0x9d: ["s"],
  0x9e: ["s", "b"],
  0x9f: ["s", "b"],
  0xa0: ["f", "f", "f", "f"],
  0xa1: [],
  0xa5: ["s", "f", "f", "S", "S", "f", "b", "b"],
  0xa6: ["s", "w", "w", "b", "b", "f", "f", "f", "f", "f", "w", "f"],
  0xa7: ["s", "w", "w", "b", "b", "S"],
  0xa8: ["s", "s", "w", "w", "b", "b", "f", "f", "f", "f", "f", "w", "f"],
  0xa9: ["s", "s", "w", "w", "b", "b", "S"],
  0xaa: ["w", "b", "b", "f", "f", "f", "f", "f", "w", "f"],
  0xab: ["w", "b", "b"],
  0xac: [],
  0xad: ["w"],
  0xae: ["s", "w"],
  0xaf: ["w", "w", "f", "f", "f", "f"],
  0xb0: ["s", "w", "w", "f", "f", "f", "f"],
  0xb4: ["s", "S", "b", "b"],
  0xb5: ["s", "s", "b", "b", "f", "f", "f", "b", "b", "S"],
  0xb6: ["s", "f"],
  0xb7: ["s", "f"],
  0xb8: ["s"],
  0xb9: ["s", "s"],
  0xba: ["s", "s", "s"],
  0xbb: ["s", "b"],
  0xbe: ["s", "S", "b", "b"],
  0xbf: ["s", "s"],
  0xc0: ["s", "s", "b", "b", "b", "b", "S"],
  0xc1: ["s"],
  0xc2: ["s", "s", "w", "w", "b", "b", "b"],
  0xc3: ["s", "w", "w", "s"],
  0xc8: [],
  0xc9: ["s", "s", "w", "w", "w", "w"],
  0xca: ["s", "s"],
  0xcb: ["s", "b", "b"],
  0xcc: [],
  0xcd: ["s", "s", "s", "s", "s", "f", "b"],
  0xce: ["b"],
  0xcf: ["s", "s", "f"],
  0xd0: ["s", "w"],
  0xd1: ["s", "w"],
  0xd2: ["s"],
  0xd3: ["s"],
  0xd4: ["S", "w", "w"],
  0xd5: ["s", "f"],
  0xd6: ["s", "S"],
  0xdc: ["s", "S", "b", "b", "f", "f", "f", "b"],
  0xdd: ["s", "f", "f", "f", "b", "f", "b", "S"],
  0xde: ["s", "w", "f", "f", "f", "b", "f", "b", "S"],
  0xdf: ["s"],
  0xe0: ["s", "w"],
  0xe6: ["d", "d"],
  0xe7: [],
  0xe8: [],
  0xe9: ["b"],
  0xf0: ["b"],
  0xf8: [],
  0xf9: ["b", "S"],
  0xfa: [],
  0xfb: ["b"],
  0xfc: ["w"],
  0xfd: [],
  0xfe: ["s"]
}

// 指令名（社区叫法，只为可读；没有名字的叫 Op<十六进制>）。0x09 在引擎里是「浮点寄存器运算」（见 advhd-ws2.mjs），所以不叫 LayerConfig
export const OPCODE_NAMES = {
  0x01: 'Condition',
  0x02: 'Jump2',
  0x04: 'RunFile',
  0x05: 'Unk05',
  0x06: 'Jump',
  0x07: 'NextFile',
  0x08: 'Unk08',
  0x09: 'SetRegister',
  0x0a: 'Unk0A',
  0x0b: 'SetFlag',
  0x0d: 'Unk0D',
  0x0e: 'Unk0E',
  0x0f: 'ShowChoice',
  0x11: 'SetTimer',
  0x12: 'StartTimer',
  0x13: 'Unk13',
  0x14: 'DisplayMessage',
  0x15: 'SetDisplayName',
  0x16: 'Unk16',
  0x17: 'Unk17',
  0x18: 'AddMessageToLog',
  0x19: 'Unk19',
  0x1a: 'OpenTitle',
  0x1b: 'Unk1B',
  0x1c: 'ExecuteFunction',
  0x1d: 'Unk1D',
  0x1e: 'PlayMusic',
  0x1f: 'StopMusic',
  0x20: 'MusicUnk1',
  0x28: 'SoundEffect',
  0x29: 'SoundUnk1',
  0x2a: 'SoundUnk2',
  0x2e: 'CharMessageStart',
  0x30: 'SoundEffectUnk30',
  0x32: 'VariableUnk32',
  0x33: 'SetBackground',
  0x34: 'UsePnaPackage',
  0x35: 'PlayMovie',
  0x36: 'PrepareBackgroundArea',
  0x37: 'ClearLayer',
  0x38: 'VariableUnk3',
  0x39: 'DisplayCharacterImage',
  0x3a: 'UnkBackground2',
  0x3b: 'BackgroundMessage',
  0x3d: 'Unk3D',
  0x3e: 'Unk3E',
  0x3f: 'LayersList',
  0x40: 'SetMask',
  0x41: 'UnkBackground3',
  0x42: 'Unk42',
  0x43: 'Unk43',
  0x44: 'Effect44',
  0x45: 'DragBackground',
  0x46: 'MoveBackground',
  0x47: 'Effect1',
  0x48: 'Effect2',
  0x4a: 'Unk4A',
  0x51: 'VariableUnk51',
  0x52: 'VariableUnk2',
  0x53: 'VariableUnk4',
  0x56: 'RainStart',
  0x57: 'UnkBackground1',
  0x58: 'Effect3',
  0x5b: 'InitKeyName',
  0x5c: 'RainEnd',
  0x64: 'Unk64',
  0x65: 'Unk65',
  0x66: 'ShowGraphic',
  0x67: 'Unk67',
  0x68: 'Unk68',
  0x6e: 'SetVariable',
  0x6f: 'VariableUnk',
  0x73: 'SetPnaFile',
  0x75: 'Unk75',
  0x78: 'Unk78',
  0x7a: 'Unk7A',
  0x7b: 'Unk7B',
  0x84: 'Unk84',
  0x97: 'Unk97',
  0xaf: 'UnkAF',
  0xb0: 'UnkB0',
  0xe6: 'ConditionalJump',
  0xf0: 'UnkScreen',
  0xfb: 'UnkFB',
  0xfc: 'UnkFC',
  0xfd: 'UnkFD',
  0xff: 'FileEnd'
}
export const opcodeName = (op) => OPCODE_NAMES[op] || `Op${op.toString(16).toUpperCase().padStart(2, '0')}`

function readItem(r, kind) {
  switch (kind) {
    case 'b': return r.u8()
    case 'w': return r.u16()
    case 'd': return r.u32()
    case 'f': return r.f32()
    default: return r.str()   // s / S / T
  }
}

// 解码一个已经解开 ROR2 的脚本 → [{ at, op, name, args, choices? }]；读不懂的指令抛 Error（带偏移）。
// tolerant = true：读到不认识 / 读不完的指令就停下，返回已解出的部分（out.truncated 记原因）。到 0xFF（FileEnd）就结束（后面是 8 字节尾巴）
export function decodeWs2(plain, { tolerant = false } = {}) {
  const r = new Reader(plain)
  const out = []
  while (r.left > 0) {
    const at = r.p
    const op = r.u8()
    try {
      if (op === 0xff) { out.push({ at, op, name: 'FileEnd', args: [] }); break }
      if (op === 0x0f) {   // ShowChoice：个数 + 每项 { u16 id, 文字, 3 个 u8, 跳转类型 (6 = u32 偏移, 7 = 脚本名) }
        const count = r.u8()
        const choices = []
        for (let i = 0; i < count; i++) {
          const id = r.u16()
          const text = r.str()
          const flags = [r.u8(), r.u8(), r.u8()]
          const jump = r.u8()
          let target
          if (jump === 6) target = r.u32()
          else if (jump === 7) target = r.str()
          else throw new Error(`ShowChoice 的跳转类型 ${jump} 不认识`)
          choices.push({ id, text, flags, jump, target })
        }
        out.push({ at, op, name: 'ShowChoice', args: [count], choices })
        continue
      }
      const layout = OPCODE_LAYOUTS[op]
      if (!layout) throw new Error(`opcode 0x${op.toString(16)} 不在引擎的操作数表里`)
      const args = []
      for (const kind of layout) {
        if (kind[0] === 'a') {
          const n = r.u8()
          args.push(n)
          for (let i = 0; i < n; i++) args.push(readItem(r, kind[1]))
        } else args.push(readItem(r, kind))
      }
      out.push({ at, op, name: opcodeName(op), args })
    } catch (error) {
      const message = `ws2 偏移 ${at}（opcode 0x${op.toString(16)}）：${error.message}`
      if (tolerant) { out.truncated = message; break }
      throw new Error(message)
    }
  }
  return out
}
