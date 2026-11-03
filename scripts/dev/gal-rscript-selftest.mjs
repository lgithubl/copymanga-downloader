#!/usr/bin/env node
// Liar-soft codeX RScript：XFL / GSC / WCG / Vorbis ACM wav + 执行（选择汇合 / 内联调用 / 锚点 / 目录）+ 适配器 + containers（展开 / 虚拟索引 / 取资源）+ gal-layout 识别。纯 node；
//   真实样本（可选）：RSCRIPT_SAMPLE=<游戏根目录，里面有 scr.xfl> 时额外把所有 .gsc 过一遍解码 + 执行
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import * as adapter from '../../web/library/gal/adapters/rscript-gsc.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, virtualEntry, virtualFiles } from '../../web/library/gal/containers.mjs'
import { cleanOggPages, decodeInstruction, isVorbisRiff, parseGsc, parseXfl, readXflIndex, riffVorbisToOgg } from '../../web/library/gal/rscript-gsc.mjs'
import { decodeGscScript, runGsc } from '../../web/library/gal/rscript-run.mjs'
import { decodeWcg, encodeWcg, readWcgHeader, wcgToPng } from '../../web/library/gal/rscript-wcg.mjs'
import { assemble, buildRiff, buildXfl } from './make-rscript-fixture.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = JSON.stringify

// ---- 夹具程序 ----
// 0001：bgm / 目录 + 锚点 / 背景 / 立绘 / 台词（注音 + 换行）/ 条件跳转 / 选择（A、B 汇合）/ 调用 0002 / goto 0003#start
const s1 = assemble([
  { op: 0x79, args: [14, { str: 'grpo_bu1' }] },
  { op: 0x26, args: [14, 1, 1, 0] },
  { op: 0x3c, args: [5, 0, 0] },
  { op: 0x14, args: [2022, 0] },
  { op: 0x1e, args: [14, 3400, 1350, 540, 0, 0] },
  { op: 0x51, args: [0, 701, 0, 0, { str: 'Kage' }, { str: 'Hello^Nworld |ab[ruby]!' }, 1] },
  { op: 0xf000, args: [0, 0] },                       // r0 = 0
  { op: 0x03, args: [{ label: 'skip' }] },            // r0 == 0 → 跳过下一句
  { op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'never' }, 1] },
  { at: 'skip' },
  { op: 0x0e, args: [2, { str: 'Pick one' }, { label: 'a' }, { label: 'b' }, { label: 'a' }, { label: 'a' }, { label: 'a' }, { str: 'Left' }, { str: 'Right' }, { str: '' }, { str: '' }, { str: '' }, 0, 0, 0] },
  { at: 'a' },
  { op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'A-branch' }, 1] },
  { op: 0x05, args: [{ label: 'merge' }] },
  { at: 'b' },
  { op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'B-branch' }, 1] },
  { at: 'merge' },
  { op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'after' }, 1] },
  { op: 0x0f, args: [2, { str: '' }] },
  { op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'back' }, 1] },
  { op: 0x0c, args: [3, { str: 'start' }] },
])
const s2 = assemble([
  { op: 0x1e, args: [15, 3402, 1350, 540, 0, 0] },
  { op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'in-call' }, 1] },
  { op: 0x52, args: [0, 0, 0, 0, { str: ' more' }, 0] },
  { op: 0x10, args: [0] },
])
const s3 = assemble([{ op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'third' }, 1] }, { op: 0x08 }], { labels: [] })

// ---- 格式 ----
{
  const buf = buildXfl([['0001.gsc', s1], ['0002.gsc', s2]])
  const { entries } = parseXfl(buf)
  check('XFL：LB 档案目录（名字 / 偏移 / 大小）读对，数据对得上', entries.length === 2 && entries[0].name === '0001.gsc' && buf.subarray(entries[1].offset, entries[1].offset + entries[1].size).equals(s2), J(entries))
  const prog = parseGsc(s1)
  check('GSC：九个 dword 的头 + 字符串表 / 标签表读对（字符串 "Kage" 在表里，标签 0 是占位）', prog.strings.some((x) => x.toString() === 'Kage') && prog.strings[0].length === 0 && prog.labels.length === 1 && prog.code.length > 100)
  let n = 0
  for (let pc = 0; pc < prog.code.length;) { const ins = decodeInstruction(prog.code, pc); pc = ins.next; n += 1 }
  check('GSC：全部指令解得出来（没有未知操作码）', n === 17, String(n))
  let bad = false
  try { parseGsc(Buffer.from(s1.subarray(0, s1.length - 3))) } catch { bad = true }
  check('GSC：被截断 / 大小对不上 → 抛错', bad)
}
{
  const px = Uint8Array.from({ length: 4 * 6 * 4 }, (_, i) => (i * 13 + 5) & 255)
  const wcg = encodeWcg({ width: 6, height: 4, pixels: px })
  const back = decodeWcg(wcg)
  check('WCG：编码 → 解码逐字节一致（B、G、R、透明字节）；头里的宽高对', Buffer.from(back.pixels).equals(Buffer.from(px)) && J(readWcgHeader(wcg)) === J({ flags: 0x271, width: 6, height: 4 }))
  const png = wcgToPng(wcg)
  check('WCG → PNG：PNG 头 + IHDR 宽高；alpha = 255 − 透明字节', png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 6 && png.readUInt32BE(20) === 4, png.subarray(0, 24).toString('hex'))
  let bad = false
  try { decodeWcg(Buffer.from('not a wcg image, definitely')) } catch { bad = true }
  check('WCG：不是 WCG → 抛错', bad)
}
{
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40, 3)])
  const riff = buildRiff(ogg)
  check('Vorbis ACM 的 WAVE：认得出（fmt 标签 0x6771），取出 data 里的 Ogg；PCM 的 WAVE 原样返回', isVorbisRiff(riff) && Buffer.from(riffVorbisToOgg(riff)).equals(ogg) && !isVorbisRiff(buildRiff(Buffer.alloc(10), { pcm: true })) && riffVorbisToOgg(buildRiff(Buffer.alloc(10), { pcm: true })).length > 10)
  // 真实的 Vorbis ACM wav：Vorbis 的页之间夹着 28 字节的空页（序列号 0xffffffff、页号从 0 递增，带 BOS），EOS 页后面还有；浏览器会当成「链接」，在第 4 页就当播完（语音「直接中断」）
  {
    const page = (serial, no, flags, granule, payload) => {
      const h = Buffer.alloc(27 + 1); h.write('OggS', 0, 'latin1'); h[5] = flags; h.writeBigInt64LE(BigInt(granule), 6); h.writeUInt32LE(serial, 14); h.writeUInt32LE(no, 18); h[26] = 1; h[27] = payload.length
      return Buffer.concat([h, payload])
    }
    const junk = (no) => { const h = Buffer.alloc(28); h.write('OggS', 0, 'latin1'); h.writeUInt32LE(0xffffffff, 14); h.writeUInt32LE(no, 18); h[26] = 1; h[27] = 0; return h }
    const real = [page(0, 0, 2, 0, Buffer.from('head')), page(0, 1, 0, 0, Buffer.from('setup')), page(0, 2, 0, 1000, Buffer.from('aaaa')), page(0, 3, 4, 2000, Buffer.from('bbbb'))]
    const dirty = Buffer.concat([real[0], junk(0), junk(1), real[1], junk(2), real[2], junk(3), real[3], junk(4), junk(5)])
    const cleaned = cleanOggPages(dirty)
    check('Vorbis ACM 的 Ogg：夹在里面的空页（序列号不同）和 EOS 之后的填充都去掉，只剩 Vorbis 自己的页（顺序不变）；干净的原样返回', cleaned.equals(Buffer.concat(real)) && cleanOggPages(Buffer.concat(real)).equals(Buffer.concat(real)) && Buffer.from(riffVorbisToOgg(buildRiff(dirty))).equals(Buffer.concat(real)) && cleanOggPages(Buffer.from('not ogg')).toString() === 'not ogg')
  }
}

// ---- 执行 ----
const programs = new Map([[2, parseGsc(s2)], [3, parseGsc(s3)]])
const loadProgram = (n) => programs.get(n) || null
{
  const run = runGsc(parseGsc(s1), { loadProgram })
  const kinds = (events) => events.map((e) => e[0])
  const top = run.events
  const x = top.find((e) => e[0] === 'x')
  check('执行：bgm / 背景 / 立绘（带 0x79 设的目录 + 0x26 的锚点）/ 台词（说话人、语音号、文本）按顺序出来', J(top.slice(0, 4)) === J([['bgm', 5], ['bg', 2022, ''], ['L', 14, 3400, 1350, 540, 'grpo_bu1', 1, 1], ['m', 701, 'Kage', 'Hello^Nworld |ab[ruby]!', 0]]), J(top.slice(0, 4)))
  check('执行：条件跳转（r0 = 0 → 跳过 "never"）按寄存器走；"never" 不出现', !J(top).includes('never'))
  check('执行：选择 = 一个 x 事件，问题 / 选项文字对，每个选项一段分支（A、B）', x && x[1] === 'Pick one' && J(x[2]) === J(['Left', 'Right']) && x[3].length === 2 && J(x[3][0].map((e) => e[3])) === J(['A-branch']) && J(x[3][1].map((e) => e[3])) === J(['B-branch']), J(x))
  const after = top.slice(top.indexOf(x) + 1)
  check('执行：汇合点之后只有一份（after → 内联调用 0002 里的立绘 / 台词 / 追加 → back → goto）', J(kinds(after)) === J(['m', 'L', 'm', 'a', 'm', 'g']) && after[0][3] === 'after' && after[2][3] === 'in-call' && after[3][1] === ' more' && after[4][3] === 'back' && J(after[5]) === J(['g', 3, 'start']) && run.reason === 'goto', J(after))
  const noLoad = runGsc(parseGsc(s1))
  check('不给被调用脚本的加载器：调用只记 c 事件，接着往下', noLoad.events.some((e) => e[0] === 'c' && e[1] === 2) && !J(noLoad.events).includes('in-call'))
  const boot = runGsc(parseGsc(s1), { loadProgram, initial: { dirs: [[0, 'grpe']], anchors: [] } })
  check('初始状态（引擎启动时设好的目录）：bootstrap 里 0 层的目录带进 bg 事件', J(boot.events.find((e) => e[0] === 'bg')) === J(['bg', 2022, 'grpe']))
  const text = decodeGscScript(s1, { arc: 'scr', name: '0001', loadProgram })
  const parsed = JSON.parse(text)
  const viaDecode = JSON.parse(decodeGscScript(s1, { arc: 'scr', name: '0001', loadProgram, initial: { dirs: [[0, 'grpe']], anchors: [[14, [0, 1]]] } }))
  check('decodeGscScript 也带初始状态（containers 的 bootstrap 走这条）：0 层目录 grpe；14 层锚点被脚本自己的 0x26 覆盖成 (1, 1)', J(viaDecode.events.find((e) => e[0] === 'bg')) === J(['bg', 2022, 'grpe']) && J(viaDecode.events.find((e) => e[0] === 'L')?.slice(6)) === J([1, 1]))
  check('decodeGscScript：输出 rscript-gsc/1 JSON（format / arc / name / run / events）', parsed.format === 'rscript-gsc/1' && parsed.arc === 'scr' && parsed.name === '0001' && parsed.run.reason === 'goto' && parsed.events.length === top.length)
  // 步数上限：死循环脚本 → 截断，不卡死
  const loop = assemble([{ at: 'top' }, { op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'x' }, 1] }, { op: 0x05, args: [{ label: 'top' }] }])
  const looped = runGsc(parseGsc(loop), { maxSteps: 5000, maxEvents: 100 })
  check('死循环：到事件 / 步数上限就截断（truncated），不卡死', looped.truncated && looped.events.length <= 100)
}

// ---- 层移动：0x21 绝对 / 0x22 相对 / 编组（0x29）——只要落点 ----
{
  const mv = assemble([
    { op: 0x79, args: [17, { str: 'grpo_bu0' }] }, { op: 0x26, args: [17, 1, 1, 0] }, { op: 0x26, args: [18, 1, 1, 0] }, { op: 0x79, args: [18, { str: 'grpo_bu0' }] },
    { op: 0x1e, args: [17, 1000, 100, 200, 0, 0] }, { op: 0x1e, args: [18, 1001, 50, 60, 0, 0] },
    { op: 0x21, args: [17, 300, 400, 0, 0] },                 // 17 层移到 (300, 400)
    { op: 0x29, args: [18, 5] }, { op: 0x22, args: [105, 10, 20, 0, 0] },   // 18 层编进组 5；组 105 相对移动 (+10, +20)
    { op: 0x22, args: [0, 1, 1, 0, 0] },                    // 0 = 所有层再 (+1, +1)
    { op: 0x51, args: [0, 0, 0, 0, { str: '' }, { str: 'moved' }, 1] },
  ])
  const run = runGsc(parseGsc(mv))
  const moves = run.events.filter((e) => e[0] === 'P').map((e) => e.join(','))
  check('执行：0x21 移到绝对位置、0x22 相对移动（目标 > 100 = 编组里的层，0 = 所有层）→ P 事件，坐标累计对', J(moves) === J(['P,17,300,400', 'P,18,60,80', 'P,17,301,401', 'P,18,61,81']), J(moves))
  const ctx = adapter.prepare({ options: {}, files: ['arc/res/grpo_bu0/1000.png', 'arc/res/grpo_bu0/1001.png'], toResourcePath: (rel) => rel.replace(/^arc\/res\//, '') })
  const scene = adapter.parse(JSON.stringify({ format: 'rscript-gsc/1', events: run.events }), ctx)
  const stands = scene.steps.flatMap((st) => st.commands).filter((c) => c.op === 'stand')
  check('适配器：立绘只发落点（17 层 = (301, 401) → 相对舞台中心 (−659, −139)；18 层 = (61, 81) → (−899, −459)），不发过程中的位置', stands.length === 2 && stands[0].parts[0].x === 301 - 960 && stands[0].parts[0].y === 401 - 540 && stands[1].parts[0].x === 61 - 960 && stands[1].parts[0].y === 81 - 540, J(stands))
}

// ---- 适配器 ----
const files = ['arc/res/grpe/2022.png', 'arc/res/grpo_bu1/3400.png', 'arc/res/grpo_bu1/3402.png', 'arc/res/voice/0701.ogg', 'arc/res/bgm/Track05.wav']
{
  const ctx = adapter.prepare({ options: {}, files, toResourcePath: (rel) => rel.replace(/^arc\/res\//, '') })
  const text = decodeGscScript(s1, { arc: 'scr', name: '0001', loadProgram })
  const scene = adapter.parse(text, ctx)
  const cmds = scene.steps.flatMap((s) => s.commands)
  const bg = cmds.find((c) => c.op === 'bg')
  const stand = cmds.find((c) => c.op === 'stand')
  const texts = cmds.filter((c) => c.op === 'text')
  check('适配器：背景 → bg grpe/2022.png（目录默认 grpe）；bgm → bgm/Track05.wav；语音 701 → voice/0701.ogg', bg?.src?.endsWith('grpe/2022.png') && cmds.some((c) => c.op === 'bgm' && /Track05\.wav$/.test(c.src)) && cmds.some((c) => c.op === 'voice' && /0701\.ogg$/.test(c.src)), J(cmds.slice(0, 6)))
  check('适配器：立绘 = 槽位 L14，锚点（1, 1）→ 画布中心 = (1350, 540) → 相对舞台中心 (390, 0)，scale 1', stand?.slot === 'L14' && stand.parts[0].x === 390 && stand.parts[0].y === 0 && stand.parts[0].scale === 1 && J(stand.stage) === J([1920, 1080]), J(stand))
  check('适配器：台词里的 ^N = 换行、|ab[ruby] = ruby 片段；说话人 Kage', J(texts[0].segments) === J([{ text: 'Hello\nworld ' }, { text: 'ab', ruby: 'ruby' }, { text: '!' }]) && cmds.some((c) => c.op === 'speaker' && c.segments[0]?.text === 'Kage'), J(texts[0]))
  const choice = cmds.find((c) => c.op === 'choice')
  const guarded = cmds.filter((c) => c.when)
  check('适配器：choice 两个选项，两个分支的台词带 when 条件（sel == 1 / 2）；汇合之后的没有条件', choice?.options.length === 2 && guarded.some((c) => c.op === 'text' && c.segments[0]?.text === 'A-branch' && c.when[0].value === 1) && guarded.some((c) => c.op === 'text' && c.segments[0]?.text === 'B-branch' && c.when[0].value === 2) && !guarded.some((c) => c.segments?.[0]?.text === 'after'), J(guarded.map((c) => [c.op, c.when])))
  check('适配器：追加的台词（0x52）接到「in-call」那一页的文本后面；goto 脚本 3 = scene.next（脚本名 0003）', texts.find((c) => c.segments.map((s) => s.text).join('').startsWith('in-call'))?.segments.map((s) => s.text).join('') === 'in-call more' && scene.next?.script === '0003', J([texts.map((c) => c.segments.map((s) => s.text).join('')), scene.next]))
  check('适配器：统计里 images 全解析、语音 1 个解析；没有 raw', scene.stats.images.unresolved === 0 && scene.stats.voices.resolved === 1 && J(scene.stats.raw) === '{}', J(scene.stats))
  check('sniff：rscript-gsc/1 认；别的 JSON 不认', adapter.sniff(text) && !adapter.sniff('{"format":"krkr-scn/1"}'))
  const segs = adapter.rscriptSegments('^C1赤^L|漢字[かんじ]と前[ぜん]^S2x^D3y', {})
  check('文本标记：^C / ^L / ^S / ^D 去掉；|漢字[かんじ] = 两个字的 ruby；没有 | 的 [ぜん] 只注前一个字', J(segs) === J([{ text: '赤' }, { text: '漢字', ruby: 'かんじ' }, { text: 'と' }, { text: '前', ruby: 'ぜん' }, { text: 'xy' }]), J(segs))
}

// ---- containers + gal-layout ----
const work = await mkdtemp(path.join(os.tmpdir(), 'rscript-'))
try {
  const media = path.join(work, 'Game')
  await mkdir(media, { recursive: true })
  const wcg = encodeWcg({ width: 4, height: 3, pixels: Uint8Array.from({ length: 48 }, (_, i) => i * 5 & 255) })
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(30, 7)])
  const nestedVoice = buildXfl([['0301.wav', buildRiff(ogg)], ['0302.wav', buildRiff(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(8, 1)]))]])
  await writeFile(path.join(media, 'scr.xfl'), buildXfl([['0001.gsc', s1], ['0002.gsc', s2], ['0003.gsc', s3]]))
  await writeFile(path.join(media, 'grpe.xfl'), buildXfl([['2022.wcg', wcg], ['0020.wcg', wcg]]))
  await writeFile(path.join(media, 'grpo_bu1.xfl'), buildXfl([['3400.wcg', wcg], ['3402.wcg', wcg]]))
  await writeFile(path.join(media, 'voice.xfl'), buildXfl([['0701.wav', buildRiff(ogg)], ['1.xfl', nestedVoice]]))
  await writeFile(path.join(media, 'wav.xfl'), buildXfl([['0001.wav', buildRiff(ogg)], ['0002.wav', buildRiff(Buffer.alloc(64, 3), { pcm: true })]]))   // 同一个档案里有 Vorbis ACM 也有 PCM
  await writeFile(path.join(media, 'bgm.xfl'), buildXfl([['Track05.wav', buildRiff(Buffer.alloc(64, 2), { pcm: true })]]))
  await writeFile(path.join(media, 'game.exe'), 'MZ')
  const layoutItem = { itemId: 'r', title: 'r', config: {}, source: { path: media }, adapters: ['rscript::gsc'] }
  const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
  const cfgRaw = tagOut.itemPatch?.gal?.config
  const norm = cfgRaw ? normalizeGalConfigWithWarnings(cfgRaw) : null
  check('gal-layout：认出 RScript（scr.xfl 是 LB 档案 + grpe.xfl），id = rscript::game，containers = xfl / hybrid / 不 flat，scr.xfl = 脚本、别的 xfl = 资源；写出来的 config 规整后零警告', Boolean(norm) && norm.config.game.id === 'rscript::game' && norm.config.containers.format === 'xfl' && norm.config.containers.mode === 'hybrid' && norm.config.containers.flat === false && norm.config.containers.scriptDecoder === 'rscript-gsc' && norm.warnings.length === 0, J([tagOut.logs, norm?.warnings, norm?.config?.containers]))
  const notLb = path.join(work, 'Plain')
  await mkdir(notLb, { recursive: true })
  await writeFile(path.join(notLb, 'scr.xfl'), 'not an xfl')
  await writeFile(path.join(notLb, 'grpe.xfl'), 'x')
  const none = await generateTags({ item: { ...layoutItem, config: { game: { id: 'rscript::x' } }, source: { path: notLb } }, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
  check('gal-layout：scr.xfl 不是 LB 档案 = 不认', !none.itemPatch?.gal?.config?.containers, J(none.logs))
  const config = norm.config
  const report = await ensureContainers({ mediaDir: media, config })
  check('展开：scr.xfl 里的 .gsc 执行一遍 → arc/script/scr/<号>.rscript（rscript-gsc/1，调用 0002 已内联）；资源 xfl 不展开', report.arcs['./scr.xfl']?.scripts === 3 && !report.arcs['./grpe.xfl']?.error && JSON.parse(await readFile(path.join(media, 'arc/script/scr/0001.rscript'), 'utf8')).events.some((e) => e[0] === 'm' && e[3] === 'in-call'), J(report))
  const vf = await virtualFiles({ mediaDir: media, config })
  const want = ['arc/res/grpe/2022.png', 'arc/res/grpe/0020.png', 'arc/res/grpo_bu1/3400.png', 'arc/res/grpo_bu1/3402.png', 'arc/res/voice/0701.ogg', 'arc/res/voice/1/0301.ogg', 'arc/res/voice/1/0302.ogg', 'arc/res/wav/0001.ogg', 'arc/res/wav/0002.wav', 'arc/res/bgm/Track05.wav']
  check('虚拟索引：.wcg → .png；Vorbis ACM 的 wav → .ogg（一个一个看，同一个档案里的 PCM 保持 .wav）（含嵌套的 voice.xfl 里的 1.xfl 分库：voice/1/0301.ogg）；PCM 的 bgm 保持 .wav；路径带档案名', J([...vf.files].sort()) === J([...want].sort()), J([...vf.files].sort()))
  const n = await materialize({ mediaDir: media, config, rels: ['arc/res/grpe/2022.png', 'arc/res/voice/1/0301.ogg', 'arc/res/bgm/Track05.wav'] })
  const png = await readFile(path.join(media, 'arc/res/grpe/2022.png'))
  check('取资源：WCG 转成 PNG（头 + 宽高 4×3）；Vorbis ACM 去外壳 = 就是那段 Ogg；PCM 的 wav 原样', n === 3 && png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 4 && (await readFile(path.join(media, 'arc/res/voice/1/0301.ogg'))).equals(ogg) && (await readFile(path.join(media, 'arc/res/bgm/Track05.wav'))).subarray(0, 4).toString() === 'RIFF')
  const entry = await virtualEntry({ mediaDir: media, config, rels: ['arc/res/grpe/0020.png'] })
  check('virtualEntry.read：同样转成 PNG；size = 容器里的原始大小（WCG 字节数）', (await entry.read()).subarray(1, 4).toString() === 'PNG' && entry.size === wcg.length, J([entry.size, wcg.length]))
  const index = await readXflIndex(path.join(media, 'voice.xfl'), {})
  const nested = index.entries.find((e) => e.name === '1.xfl')
  const inner = await readXflIndex(path.join(media, 'voice.xfl'), { offset: nested.offset, length: nested.size })
  check('嵌套 XFL：readXflIndex(offset, length) 读出里面的条目，偏移是外层文件里的绝对偏移', inner.entries.length === 2 && (await readFile(path.join(media, 'voice.xfl'))).subarray(inner.entries[0].offset, inner.entries[0].offset + 4).toString() === 'RIFF', J(inner.entries))
  // 真实样本
  const sample = process.env.RSCRIPT_SAMPLE
  if (sample) {
    const buf = await readFile(path.join(sample, 'scr.xfl'))
    const { entries } = parseXfl(buf)
    const all = new Map(entries.map((e) => [Number(e.name.replace(/\D/g, '')), parseGsc(buf.subarray(e.offset, e.offset + e.size))]))
    let messages = 0
    let crashed = 0
    for (const prog of all.values()) { try { messages += runGsc(prog, { loadProgram: (k) => all.get(k) || null }).events.filter((e) => e[0] === 'm').length } catch { crashed += 1 } }
    check(`真实样本：${entries.length} 个 .gsc 全部解码 + 执行（${messages} 句台词），没有出错`, crashed === 0 && messages > 0, `crashed ${crashed}`)
  } else console.log('SKIP 真实样本（RSCRIPT_SAMPLE=<目录> 才跑）')
} finally { await rm(work, { recursive: true, force: true }) }

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
