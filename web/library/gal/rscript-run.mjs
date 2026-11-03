// codeX RScript 的 GSC 脚本「执行」一遍 → 事件流（给适配器 rscript::gsc 吃）。思路和 BGI 的 runBurikoScript 一样：
//   · 解释器照 vn-web-engine 的 vm/interpreter.ts：u16 操作码、表达式族（高 4 位）、跳转 / 调用 / 返回 / 局部调用；变量和寄存器是带符号 16 位字，未知的值按 0
//   · 只认画面 / 声音 / 台词相关的操作码，别的忽略（动画 / 窗口 / 按钮 / 存档菜单这些和「看剧情」无关）
//   · 选择（0x0e）：每个选项走一遍到「汇合点」（所有分支都经过的第一条指令），汇合点之后只留一份
//   · 调用别的脚本（0x0f）记一个 ['c', 脚本号, 标签] 事件、当它返回了接着往下；goto（0x0c）= 这个脚本到此为止（['g', 脚本号, 标签]）
// 事件（紧凑数组）：
//   ['m', 语音号, 说话人, 文本, 文本框]   0x51 新的一页台词（文本里的 ^C 颜色 / | 和 [ ] 注音 / ^N 换行 等标记原样留着，适配器处理）
//   ['a', 文本]                          0x52 接在上一页后面的台词
//   ['bg', 图号, 目录]                   0x14 背景层（0 层）换图；图号 0 = 清空；目录 = 这一层当前的资源目录（0x79 设的，如 grpo_ex）
//   ['ev', 图号, 目录]                   0xe6 事件图（0 层，kind 2）
//   ['fill', 白?]                         0x15 0 层纯色（1 = 白，否则黑）
//   ['L', 层, 图号, x, y, 目录]          0x1e 在某一层放图（立绘 / 叠加 / 特效）；['H', 层] 0x24 / 0x25 隐藏这一层
//   ['P', 层, x, y]                      0x21 / 0x22 移动这一层到 (x, y)（只要落点，不要过程）
//   ['bgm', 曲号] / ['bgmStop']          0x3c / 0x3d；['se', 音效号, 重复] 0x3f（音效号来自 0x3e 在那个通道里装的）/ ['seStop', 通道]；['v', 语音号] 0x42；['w', 毫秒] 0x0d
//   ['g', 脚本号, 标签] / ['c', 脚本号, 标签]   goto / call
//   ['x', 问题, [选项文字…], [[分支事件…]…]]    选择（0x0e），汇合点之后的事件接在它后面
import { RSCRIPT_LAYOUTS, decodeInstruction, isExpression, parseGsc } from './rscript-gsc.mjs'

const sjis = new TextDecoder('shift-jis')
const VARIABLES = 16384
const REGISTERS = 64
const MAX_DEPTH = 9
const wrap16 = (v) => (v << 16) >> 16

function isLead(b) { return (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc) }
// 脚本字符串展开（0x424BE0）：@@12 = 变量值的十进制；$0..$9（字符串寄存器，这里都是空）。双字节字符的第二个字节不看
function expandText(bytes, variable) {
  const out = []
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    if (isLead(b) && i + 1 < bytes.length) { out.push(b, bytes[i + 1]); i += 2 } else if (b === 0x40) {
      const start = i
      while (i < bytes.length && (bytes[i] === 0x40 || bytes[i] === 0x2d || (bytes[i] >= 0x30 && bytes[i] <= 0x39))) i += 1
      let levels = 0
      let p = start
      while (bytes[p] === 0x40) { levels += 1; p += 1 }
      let neg = false
      if (bytes[p] === 0x2d) { neg = true; p += 1 }
      let value = 0
      while (p < i) { value = value * 10 + bytes[p] - 0x30; p += 1 }
      if (neg) value = -value
      out.push(...Buffer.from(String(variable(levels, wrap16(value)))))
    } else if (b === 0x24 && bytes[i + 1] >= 0x30 && bytes[i + 1] <= 0x39) i += 2
    else { out.push(b); i += 1 }
  }
  return Buffer.from(out)
}

class Truncated extends Error {}

// loadProgram(脚本号) → 解析好的 GSC 或 null：调用别的脚本（0x0f）时把被调用的脚本内联执行（立绘 / 特效这些常在被调用的库脚本里）；没有就只记 ['c'] 事件
export function runGsc(program, { maxSteps = 1500000, maxEvents = 100000, loadProgram = null, initial = null } = {}) {
  const budget = { steps: 0, events: 0, truncated: false }
  const progs = [program]   // 下标 = 程序号；state.prog 是当前在跑的程序号
  const progIndex = new Map([[program, 0]])
  const indexOf = (prog) => { let i = progIndex.get(prog); if (i === undefined) { i = progs.length; progs.push(prog); progIndex.set(prog, i) } return i }
  const loaded = new Map()
  const programOf = (num) => { if (!loadProgram) return null; if (!loaded.has(num)) { let prog = null; try { prog = loadProgram(num) } catch { prog = null } loaded.set(num, prog) } return loaded.get(num) }
  const newState = (pc = 0) => ({ pc, prog: 0, regs: new Int16Array(REGISTERS), vars: new Int16Array(VARIABLES), stack: [], dirs: new Map(), sounds: new Map(), anchors: new Map(), pos: new Map(), groups: new Map(), callDepth: 0 })
  const clone = (s, pc = s.pc) => ({ pc, prog: s.prog, regs: s.regs.slice(), vars: s.vars.slice(), stack: s.stack.slice(), dirs: new Map(s.dirs), sounds: new Map(s.sounds), anchors: new Map(s.anchors), pos: new Map(s.pos), groups: new Map(s.groups), callDepth: s.callDepth })
  const variable = (s, index) => (index >= 0 && index < VARIABLES ? s.vars[index] : 0)
  const value = (s, raw) => { let v = (raw << 16) >> 16; for (let l = raw >>> 16; l > 0; l -= 1) v = variable(s, v); return v }
  const text = (s, index) => sjis.decode(expandText(progs[s.prog].strings[index] || Buffer.alloc(0), (levels, v) => { for (; levels > 0; levels -= 1) v = variable(s, v); return v }))
  const labelOffset = (prog, name) => { if (!name) return 0; const labels = prog.labels; for (let i = 1; i < labels.length; i += 1) if (sjis.decode(labels[i].name) === name) return labels[i].offset; return 0 }
  const labelName = (s, idx) => (idx ? text(s, idx) : '')

  function operand(s, opcode, v, left) {
    const high = opcode >>> 8
    const mode = left ? (high >>> 2) & 3 : high & 3
    const levels = left ? (opcode >>> 4) & 0xf : opcode & 0xf
    if (mode === 0) return v
    if (mode === 1) return s.regs[v] ?? 0
    if (mode === 2) { let idx = v; for (let l = levels; l > 0; l -= 1) idx = variable(s, idx); return variable(s, idx) }
    return 0
  }
  function expression(s, opcode, ops) {
    const target = ops[0]
    const store = (v) => { if (target < REGISTERS) s.regs[target] = v }
    if ((opcode & 0xf000) === 0xf000) { store(operand(s, opcode, ops[1], false)); return }
    const a = ops[1]
    const b = ops[2]
    const right = () => operand(s, opcode, b, false)
    const left = () => operand(s, opcode, a, true)
    switch (opcode & 0xf000) {
      case 0x1000: { const v = right(); const mode = (opcode >>> 10) & 3; if (mode === 1) s.regs[a] = v; else if (mode === 2) { let idx = a; for (let l = (opcode >>> 4) & 0xf; l > 0; l -= 1) idx = variable(s, idx); if (idx >= 0 && idx < VARIABLES) s.vars[idx] = v } store(v); return }
      case 0x2000: store(left() || right() ? 1 : 0); return
      case 0x3000: store(left() && right() ? 1 : 0); return
      case 0x4000: store(left() === right() ? 1 : 0); return
      case 0x5000: store(left() >= right() ? 1 : 0); return
      case 0x6000: store(left() > right() ? 1 : 0); return
      case 0x7000: store(left() <= right() ? 1 : 0); return
      case 0x8000: store(left() < right() ? 1 : 0); return
      case 0x9000: store(left() !== right() ? 1 : 0); return
      case 0xa000: store(left() + right()); return
      case 0xb000: store(left() - right()); return
      case 0xc000: store(Math.imul(left(), right())); return
      case 0xd000: case 0xe000: { const d = left(); const q = right(); store(!q ? 0 : opcode & 0x1000 ? Math.trunc(d / q) : d % q); return }
      default: return
    }
  }

  const push = (sink, ev) => { budget.events += 1; if (budget.events > maxEvents) { budget.truncated = true; throw new Truncated() } sink.push(ev) }

  // 从 state 跑到 end / return / goto / 到达 stopPc；visited（可选）记走过的指令偏移（按先后）。→ { reason, state }
  function run(s, sink, { stopPc = null, visited = null } = {}) {
    for (;;) {
      if (stopPc !== null && s.prog * 0x4000000 + s.pc === stopPc) return { reason: 'stop', state: s }
      if (budget.steps >= maxSteps) { budget.truncated = true; throw new Truncated() }
      budget.steps += 1
      const code = progs[s.prog].code
      if (s.pc >= code.length) return { reason: 'eof', state: s }
      let ins
      try { ins = decodeInstruction(code, s.pc, RSCRIPT_LAYOUTS) } catch { return { reason: 'bad', state: s } }
      if (visited) visited.add(s.prog * 0x4000000 + s.pc)
      const opcode = ins.opcode
      const o = ins.operands
      s.pc = ins.next
      if (isExpression(opcode)) { expression(s, opcode, o); continue }
      switch (opcode) {
        case 0x03: if (!s.regs[0]) s.pc = o[0]; continue
        case 0x04: if (s.regs[0]) s.pc = o[0]; continue
        case 0x05: s.pc = o[0]; continue
        case 0x08: return { reason: 'end', state: s }
        case 0x09: s.regs[o[0] % REGISTERS] = 0; continue
        case 0x0c: {
          const num = value(s, o[0])
          const label = labelName(s, o[1])
          if (s.callDepth > 0) { const target = num === 0 ? progs[s.prog] : programOf(num); if (target) { s.prog = indexOf(target); s.pc = labelOffset(target, label); continue } }
          push(sink, ['g', num, label]); return { reason: 'goto', state: s }
        }
        case 0x0f: {
          const num = value(s, o[0])
          const label = labelName(s, o[1])
          const params = o.slice(2).map((r) => value(s, r))
          const target = programOf(num)
          if (!target || s.callDepth >= MAX_DEPTH) { push(sink, ['c', num, label]); s.vars[0] = 0; continue }
          s.stack.push({ pc: s.pc, prog: s.prog, script: true })
          s.callDepth += 1
          s.prog = indexOf(target); s.pc = labelOffset(target, label)
          for (let i = 0; i < 10; i += 1) s.vars[10 + i] = params[i] ?? 0
          continue
        }
        case 0x10: {
          if (!s.stack.length) return { reason: 'return', state: s }
          const frame = s.stack.pop()
          if (frame.script) s.callDepth -= 1
          s.pc = frame.pc; s.prog = frame.prog; s.vars[0] = wrap16(value(s, o[0])); continue
        }
        case 0xc8: { if (s.stack.length >= MAX_DEPTH + 8) return { reason: 'overflow', state: s }; const params = o.slice(1).map((r) => value(s, r)); s.stack.push({ pc: s.pc, prog: s.prog, script: false }); s.pc = o[0]; for (let i = 0; i < 10; i += 1) s.vars[10 + i] = params[i] ?? 0; continue }
        case 0x0d: push(sink, ['w', value(s, o[0]) * 100]); continue
        case 0x0e: {
          const count = Math.min(5, o[0] & 0xff)
          const targets = o.slice(2, 7).slice(0, count)
          const answers = o.slice(7, 12).slice(0, count).map((i) => text(s, i))
          const question = text(s, o[1])
          const results = targets.map((t) => { const visited = new Set(); const probe = []; const r = run(clone(s, t), probe, { visited }); return { visited, r } })
          // 汇合点：第一个分支走过的指令里，每个分支都走过的第一条
          let merge = null
          if (results.length > 1) for (const key of results[0].visited) if (results.every((x, i) => i === 0 || x.visited.has(key))) { merge = key; break }
          const branches = []
          let cont = null
          targets.forEach((t, i) => {
            const events = []
            const r = run(clone(s, t), events, merge === null ? {} : { stopPc: merge })
            branches.push(events)
            if (i === 0 && merge !== null && r.reason === 'stop') cont = r.state
          })
          push(sink, ['x', question, answers, branches])
          if (!cont) return { reason: 'choice', state: s }
          s.pc = cont.pc; s.prog = cont.prog; s.regs = cont.regs; s.vars = cont.vars; s.stack = cont.stack; s.dirs = cont.dirs; s.sounds = cont.sounds; s.anchors = cont.anchors; s.pos = cont.pos; s.groups = cont.groups; s.callDepth = cont.callDepth
          continue
        }
        case 0x51: push(sink, ['m', o[1] >>> 0, text(s, o[4]), text(s, o[5]), value(s, o[0])]); continue
        case 0x52: push(sink, ['a', text(s, o[4])]); continue
        case 0x79: s.dirs.set(value(s, o[0]) & 0xffff, text(s, o[1]).replace(/^[.\\/]+/, '').replace(/\\+/g, '/')); continue
        case 0x14: { const image = value(s, o[0]) & 0xffff; push(sink, ['bg', image, s.dirs.get(0) || '']); continue }
        case 0xe6: { const image = value(s, o[0]) & 0xffff; if (image) push(sink, ['ev', image, s.dirs.get(0) || '']); continue }
        case 0x15: push(sink, ['fill', value(s, o[0]) === 1 ? 1 : 0]); continue
        // 移动（0x21 绝对 / 0x22 相对；目标：0 = 所有层，≤ 100 = 一层，> 100 = 编组（0x29 设的）里的层）：只关心落点（动画不要），记 P 事件
        case 0x21: case 0x22: {
          const id = value(s, o[0]) & 0xffff
          const dx = value(s, o[1])
          const dy = value(s, o[2])
          const targets = id === 0 ? [...s.pos.keys()] : id <= 100 ? [id] : [...s.pos.keys()].filter((l) => s.groups.get(l) === id % 100)
          for (const layer of targets) {
            const cur = s.pos.get(layer) || [0, 0]
            const next = opcode === 0x22 ? [cur[0] + dx, cur[1] + dy] : [dx, dy]
            s.pos.set(layer, next)
            push(sink, ['P', layer, next[0], next[1]])
          }
          continue
        }
        case 0x29: { const id = value(s, o[0]) & 0xffff; if (id > 0 && id < 100) s.groups.set(id, value(s, o[1]) & 0xffff); continue }
        case 0x26: s.anchors.set(value(s, o[0]) & 0xffff, [value(s, o[1]) ? 1 : 0, value(s, o[2]) ? 1 : 0]); continue
        case 0x1e: { const id = value(s, o[0]) & 0xffff; if (id) { const a = s.anchors.get(id) || [0, 0]; const x = value(s, o[2]); const y = value(s, o[3]); s.pos.set(id, [x, y]); push(sink, ['L', id, value(s, o[1]) & 0xffff, x, y, s.dirs.get(id) || '', a[0], a[1]]) } continue }
        case 0x24: { const id = value(s, o[0]) & 0xffff; if (id) push(sink, ['H', id]); continue }
        case 0x25: { const id = value(s, o[0]) & 0xffff; if (id && !value(s, o[1])) push(sink, ['H', id]); continue }
        case 0x3c: push(sink, ['bgm', value(s, o[0]) & 0xffff]); continue
        case 0x3d: push(sink, ['bgmStop']); continue
        case 0x3e: s.sounds.set(value(s, o[0]) & 0xffff, value(s, o[1]) & 0xffff); continue
        case 0x3f: { const ch = value(s, o[0]) & 0xffff; const sound = s.sounds.get(ch) || 0; if (sound) push(sink, ['se', sound, value(s, o[1]) & 0xffff]); continue }
        case 0x40: push(sink, ['seStop', value(s, o[0]) & 0xffff]); continue
        case 0x42: { const voice = o[0] >>> 0; if (voice) push(sink, ['v', voice]); continue }
        case 0x12: { const arr = program.arrays[o[1]]; const at = value(s, o[0]) & 0xffff; if (arr) for (let i = 0; i < arr.length && at + i < VARIABLES; i += 1) s.vars[at + i] = arr[i]; continue }
        default: continue
      }
    }
  }

  const events = []
  const state = newState(0)
  if (initial) { for (const [k, v] of initial.dirs || []) state.dirs.set(k, v); for (const [k, v] of initial.anchors || []) state.anchors.set(k, v); if (initial.vars) state.vars.set(initial.vars) }
  let reason = ''
  try { reason = run(state, events).reason } catch (error) { if (!(error instanceof Truncated)) throw error; reason = 'truncated' }
  return { events, steps: budget.steps, truncated: budget.truncated, reason, final: { dirs: state.dirs, anchors: state.anchors, vars: state.vars } }
}

// GSC 字节 → 事件 JSON（containers 的脚本解码器用）
export function decodeGscScript(buffer, { arc = '', name = '', loadProgram = null, initial = null } = {}) {
  const program = parseGsc(buffer)
  const run = runGsc(program, { loadProgram, initial })
  return JSON.stringify({ format: 'rscript-gsc/1', arc, name, size: buffer.length, run: { steps: run.steps, truncated: run.truncated, reason: run.reason }, events: run.events })
}
