// 自有 arc（eomaia 引擎）的合成样本：只有测试用的编码器，没有任何游戏内容。
//   buildArcfam(entries)   [{ name, data, origSize? }] → 档案（u32 LE 头大小 + 条目表 + 数据；名字按「c' = toupper(c) − 长度 + 下标」混淆；origSize ≠ data.length = 压缩）
//   Scre                   SCRE 剧本汇编器：bg / overlay / bgm / se / voice / speaker / text
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }

export function buildArcfam(entries) {
  const raws = entries.map((e) => { const name = e.name.toUpperCase(); return Buffer.from([...name].map((c, i) => (c.charCodeAt(0) - name.length + i) & 0xff)) })
  const hs = raws.reduce((n, r) => n + 1 + r.length + 12, 0)
  let offset = 4 + hs
  const table = []
  const datas = []
  entries.forEach((e, i) => {
    table.push(Buffer.from([raws[i].length]), raws[i], u32be(e.data.length), u32be(e.origSize ?? e.data.length), u32be(offset))
    offset += e.data.length
    datas.push(e.data)
  })
  return Buffer.concat([u32le(hs), ...table, ...datas])
}

export class Scre {
  constructor() { this.code = []; this.lines = 0 }
  int(n) { this.code.push(Buffer.from([0x32]), u32be(n)); return this }
  str(s) { this.code.push(Buffer.from([0x33]), Buffer.from(`${s}\0`, 'utf8')); return this }
  call() { this.code.push(Buffer.from([0x17])); return this }
  res(obj, method, file) { return this.str(file).int(method).str(obj).int(2).int(0x0b).call() }
  bg(file) { return this.int(1).res('eomaia_image', 102, file) }
  overlay(file, method = 105) { return this.int(1).int(0).res('eomaia_image', method, file) }
  bgm(file) { return this.int(1).res('eomaia_audio', 102, file) }
  se(file) { return this.int(1).res('eomaia_audio', 117, file) }
  voice(file) { return this.int(0).res('eomaia_audio', 129, file) }
  speaker(name) { return this.str(`【${name}】`).int(0).int(0).int(7).int(0x17).call() }
  ref(file) { return this.str(file) }   // 脚本引用（下一个脚本 / 分支 / 回想）：压一个字符串 xxx.script
  // eomaia_char 立绘调用（g10）：前面 `x, y, 19` + 0x34 = 位置；每个调用 = 参数 + 方法号 + 对象名 + 2 + 11 + CALL
  charCall(method, ...args) { for (const a of args) typeof a === 'string' ? this.str(a) : this.int(a); return this.int(method).str('eomaia_char').int(2).int(11).call() }
  charLoad(name, { scale = 100, slot = 4, x = -200, y = 640 } = {}) { this.int(x).int(y).int(19); this.code.push(Buffer.from([0x34])); return this.charCall(101, scale, slot, name, 1) }
  charPart(part, idx) { return this.charCall(102, 0, idx, part, 1) }
  charBase(n) { return this.charCall(103, n) }
  charShow(fade = 500) { return this.charCall(104, fade, 0) }
  charHide(fade = 500) { return this.charCall(105, fade, 0, 1) }
  charClear() { return this.charCall(106, -1, 1) }
  narration(text) { this.code.push(Buffer.from([0x18]), u32be(this.lines++), u32be(0), Buffer.from([0x14]), Buffer.from(`${text}\0`, 'utf8')); return this }
  say(text) { this.code.push(Buffer.from([0x14]), Buffer.from(`${text}\0`, 'utf8')); return this }
  build() {
    const body = Buffer.concat(this.code)
    const count = 1
    const start = 16 + (count + 1) * 4
    return Buffer.concat([Buffer.from('SCRE', 'latin1'), u32le(0), u32le(count), u32le(20), u32le(start), u32le(start + body.length), body])
  }
}
