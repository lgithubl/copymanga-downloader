#!/usr/bin/env node
// 自测（纯 node）：BGI / Ethornell —— BURIKO ARC20、DSC、CompressedBG、BW、剧本 token 流的执行（选择分支 / 汇合 / 循环保护）、
// 容器展开（hybrid：剧本展开、图 / 声音虚拟索引 + 取出时转格式）、适配器 bgi::bs、整条链（导入 → gal-layout → 列表 → 场景）。全是合成数据。
//   node scripts/dev/gal-bgi-selftest.mjs
//   BGI_SAMPLE_DIR=<有 data*.arc 的目录> node …   再多跑一段「真实样本」的检查（没设就跳过；样本不进仓库）
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { generateTags } from '../../scripts/tag-scripts/gal-layout/main.js'
import { bwToOgg, cbgDecode, cbgToPng, dscDecode, encodePng, isBurikoScript, readBurikoArcIndex, readBurikoStatements, runBurikoScript, sniffEntry } from '../../web/library/gal/bgi.mjs'
import { normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, virtualEntry, virtualFiles } from '../../web/library/gal/containers.mjs'
import { galAdapterIds, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { BgiScript, buildArc20, bwWrap, cbgEncode, dscEncode } from './make-bgi-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const exists = (p) => stat(p).then(() => true, () => false)
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-bgi-'))

// PNG（滤波 0、8 位、非隔行）读回像素：只认 encodePng 出的
function decodePng(png) {
  let pos = 8
  const idat = []
  let ihdr = null
  while (pos < png.length) {
    const len = png.readUInt32BE(pos)
    const type = png.subarray(pos + 4, pos + 8).toString('latin1')
    if (type === 'IHDR') ihdr = png.subarray(pos + 8, pos + 8 + len)
    if (type === 'IDAT') idat.push(png.subarray(pos + 8, pos + 8 + len))
    pos += 12 + len
  }
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const channels = { 0: 1, 2: 3, 6: 4 }[ihdr[9]]
  const rows = inflateSync(Buffer.concat(idat))
  const raw = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y++) rows.copy(raw, y * width * channels, y * (width * channels + 1) + 1, (y + 1) * (width * channels + 1))
  return { width, height, channels, raw }
}

// ================= DSC =================
{
  const text = Buffer.from('ABCABCABC-hello hello hello-' + 'z'.repeat(40) + 'ÿÿÿ', 'latin1')
  const withRef = dscEncode(text)
  const noRef = dscEncode(text, { useBackrefs: false })
  check('DSC：编码（含长度 2 的回指）→ 解码 = 原文；不用回指也一样；头认得 dsc', dscDecode(withRef).equals(text) && dscDecode(noRef).equals(text) && sniffEntry(withRef) === 'dsc', J([withRef.length, noRef.length]))
  const bytes = Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 37 + (i >> 3)) & 0xff))
  check('DSC：0–255 全部字节值（含 255 的 9 位码）都能还原', dscDecode(dscEncode(bytes, { key: 0xdeadbeef })).equals(bytes))
  const bad = (fn) => { try { fn(); return 'no-throw' } catch (e) { return e.message } }
  check('DSC：魔数不对 / 数据被截断 / 回指越界 都抛错（不崩、不死循环）', /不是 DSC/.test(bad(() => dscDecode(Buffer.alloc(600)))) && /不完整|越界/.test(bad(() => dscDecode(withRef.subarray(0, withRef.length - 6)))) && /不合理/.test(bad(() => { const b = Buffer.from(withRef); b.writeUInt32LE(0x7fffffff, 0x14); return dscDecode(b) })), J([bad(() => dscDecode(withRef.subarray(0, withRef.length - 6)))]))
}

// ================= CompressedBG =================
{
  const mk = (width, height, bpp) => { const pixels = Buffer.alloc(width * height * (bpp / 8)); for (let i = 0; i < pixels.length; i++) pixels[i] = ((i * 7) ^ (i >> 2)) & 0xff; return { width, height, bpp, pixels } }
  const cases = [mk(5, 4, 32), mk(6, 3, 24), mk(7, 5, 8)]
  const ok = cases.map((c) => { const r = cbgDecode(cbgEncode(c)); return r.width === c.width && r.height === c.height && r.bpp === c.bpp && r.pixels.equals(c.pixels) })
  check('CompressedBG v1：32 / 24 / 8 位编码 → 解码，像素逐字节一致', ok.every(Boolean), J(ok))
  const flat = { width: 16, height: 16, bpp: 32, pixels: Buffer.concat(Array.from({ length: 256 }, (_, i) => Buffer.from(i === 5 ? [1, 2, 3, 255] : [0, 0, 0, 0]))) }
  check('CompressedBG：大片零（零段）也对', cbgDecode(cbgEncode(flat)).pixels.equals(flat.pixels))
  const rgba = cases[0]
  const png = decodePng(cbgToPng(cbgEncode(rgba)))
  const first = [...png.raw.subarray(0, 4)]
  check('CBG → PNG：RGBA 8 位，宽高对；颜色通道从 BGR(A) 换成 RGB(A)（第一个像素 B/R 对调）', png.width === 5 && png.height === 4 && png.channels === 4 && first[0] === rgba.pixels[2] && first[2] === rgba.pixels[0] && first[1] === rgba.pixels[1] && first[3] === rgba.pixels[3], J([first, [...rgba.pixels.subarray(0, 4)]]))
  const enc = cbgEncode(rgba)
  const broken = Buffer.from(enc); broken[0x32] ^= 0xff
  const v2 = Buffer.from(enc); v2.writeUInt16LE(2, 0x2e)
  const err = (b) => { try { cbgDecode(b); return '' } catch (e) { return e.message } }
  check('CompressedBG：加密段校验失败 / version 2（没做）→ 抛错，说明原因', /校验失败/.test(err(broken)) && /version 2/.test(err(v2)), J([err(broken), err(v2)]))
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(30, 7)])
  check('BW：头 0x40 + bw → 去头得到 Ogg；不是 BW 抛错', bwToOgg(bwWrap(ogg)).equals(ogg) && sniffEntry(bwWrap(ogg)) === 'bw' && (() => { try { bwToOgg(ogg); return false } catch { return true } })())
}

// ================= ARC20 =================
{
  const f = path.join(work, 'a.arc')
  await writeFile(f, buildArc20([{ name: 'one', data: Buffer.from('1111') }, { name: 'two_2', data: Buffer.from('22') }, { name: 'empty', data: Buffer.alloc(0) }]))
  const idx = await readBurikoArcIndex(f)
  check('ARC20：条目名 / 大小 / 偏移', J(idx.entries.map((e) => [e.name, e.size])) === J([['one', 4], ['two_2', 2], ['empty', 0]]) && (await readFile(f)).subarray(idx.entries[1].offset, idx.entries[1].offset + 2).toString() === '22', J(idx))
  const rej = async (buf) => { const g = path.join(work, 'b.arc'); await writeFile(g, buf); try { await readBurikoArcIndex(g); return '' } catch (e) { return e.message } }
  const good = await readFile(f)
  const hugeCount = Buffer.from(good); hugeCount.writeUInt32LE(0x7fffffff, 12)
  const outOf = Buffer.from(good); outOf.writeUInt32LE(9999, 16 + 0x64)
  check('ARC20：魔数不对 / 条目数不合理 / 条目超出文件 / 太小 → 抛错', /魔数/.test(await rej(Buffer.concat([Buffer.from('NOT AN ARC FILE'), Buffer.alloc(40)]))) && /不合理/.test(await rej(hugeCount)) && /超出/.test(await rej(outOf)) && /太小/.test(await rej(Buffer.alloc(8))))
}

// ================= 剧本：token 流的执行 =================
const runOf = (script, opts) => runBurikoScript(script.build(), opts)
const flat = (events) => events.flatMap((e) => (e.branches ? [e, ...e.branches.flatMap(flat)] : [e]))
const msgs = (events) => flat(events).filter((e) => e.k === 'cmd' && e.token === 0x140).map((e) => e.args[0])
{
  const s = new BgiScript()
  s.call('_PlayBGM', 0, 'bgm01', 0, 1, 100, 0).msg('hello', 'Alice').push(10).push(3).op(0x21).push(2).op(0x22).op(3, { str: 'calc' }).op(0x1c)
  const buf = s.build()
  check('容器：魔数 / 导入表 / token 流起点；isBurikoScript', isBurikoScript(buf) && runBurikoScript(buf).imports[0] === 'framework._bs')
  const run = runBurikoScript(buf)
  const [a, b, c] = run.events
  check('执行：库函数（callfn）= 名字 + 参数从左到右；msg（0x140）= [文本, 说话人, 0, 1, 1]（栈顶在前）', a.k === 'call' && a.name === '_PlayBGM' && J(a.args) === J([0, 'bgm01', 0, 1, 100, 0]) && b.k === 'cmd' && b.token === 0x140 && J(b.args) === J(['hello', 'Alice', 0, 1, 1]), J([a, b]))
  check('执行：算术在栈上求值（(10 - 3) * 2 = 14）', c.k === 'call' && c.name === 'calc' && J(c.args) === J([14]), J(c))
  const lin = readBurikoStatements(buf)
  check('线性读（readBurikoStatements）也给出同样的语句：call / cmd / call', J(lin.stmts.map((x) => x.op)) === J(['call', 'cmd', 'call']))
}
{
  const s = new BgiScript()
  s.msg('start', 'A').jmp('end').msg('skipped', 'A').label('end').msg('shown', 'A')
  check('跳转：jmp 跳过中间一段，没跳过的才执行', J(msgs(runOf(s).events)) === J(['start', 'shown']))
  const t = new BgiScript()
  t.setLwork(0, 2).dispatch(['a', 'b', 'c']).label('a').msg('in a', 'A').jmp('m').label('b').msg('in b', 'A').jmp('m').label('c').msg('in c', 'A').label('m').msg('after', 'A')
  check('条件跳转：lwork(0) == 2 → 只走第三个标签（读 / 写工作变量、比较、jcc 都按值算）', J(msgs(runOf(t).events)) === J(['in c', 'after']), J(msgs(runOf(t).events)))
  const sub = new BgiScript()
  sub.msg('before', 'A').addr('fn').op(0x1a).msg('after', 'A').jmp('end').label('fn').msg('in fn', 'A').op(0x1b).label('end')
  check('子程序：call（0x1a）/ ret（0x1b）回到调用点之后', J(msgs(runOf(sub).events)) === J(['before', 'in fn', 'after']), J(msgs(runOf(sub).events)))
  const loop = new BgiScript()
  loop.label('l').jmp('l')
  const r = runOf(loop, { maxSteps: 5000 })
  check('死循环：步数用完就停（truncated），不挂住', r.truncated === true && r.steps <= 5001, J([r.truncated, r.steps]))
  const bye = new BgiScript()
  bye.msg('last', 'A').jumpScenario('next_scene').msg('never', 'A')
  const rb = runOf(bye)
  check('jump_scenario：记成 sys 事件（文件名），脚本到此结束；后面的不执行', J(msgs(rb.events)) === J(['last']) && rb.events.at(-1).k === 'sys' && rb.events.at(-1).name === 'jump_scenario' && rb.events.at(-1).args[0] === 'next_scene', J(rb.events.at(-1)))
}
{
  // 选择：3 个选项各一段，汇合点之后只有一份；分发代码（选择之后、分开之前）不算进分支
  const s = new BgiScript()
  s.msg('question', 'A').select('opt A', 'opt B', 'opt C').dispatch(['la', 'lb', 'lc'])
    .label('la').msg('in A', 'A').jmp('m')
    .label('lb').msg('in B1', 'A').msg('in B2', 'A').jmp('m')
    .label('lc').msg('in C', 'A').label('m').msg('after', 'A')
  const run = runOf(s)
  const choice = run.events.find((e) => e.k === 'choice')
  check('选择：一个 choice 事件，3 个选项文字 + 3 段分支，汇合点在「after」那条之前；汇合之后的内容只有一份在顶层', choice && J(choice.options) === J(['opt A', 'opt B', 'opt C']) && choice.branches.length === 3 && J(choice.branches.map((b) => msgs(b))) === J([['in A'], ['in B1', 'in B2'], ['in C']]) && J(msgs(run.events.filter((e) => e.k !== 'choice'))) === J(['question', 'after']) && run.merged === 1 && run.unmerged === 0, J(run))
  // 选择在循环里（选完所有选项才继续的菜单）：同一个选择点不再分叉，不爆炸、不挂住
  const m = new BgiScript()
  m.label('menu').select('x', 'y').dispatch(['lx', 'ly']).label('lx').msg('x', 'A').jmp('menu').label('ly').msg('y', 'A').jmp('menu')
  const rm = runOf(m)
  check('选择在循环里：同一个选择点只分叉一次，分支里再遇到就依次取没取过的选项、都取过就结束这一路；整体停得下来', rm.choices === 1 && rm.truncated === false && rm.steps < 100000, J([rm.choices, rm.truncated, rm.steps]))
  // _SelectEx：选项文字先存进栈帧里（store），栈上只有个数
  const e = new BgiScript()
  e.op(2, 4).push('first').op(9, 2).op(2, 8).push('second').op(9, 2).call('_SelectEx', 2).dispatch(['p', 'q']).label('p').msg('P', 'A').jmp('m').label('q').msg('Q', 'A').label('m').msg('end', 'A')
  const re = runOf(e)
  const ce = re.events.find((x) => x.k === 'choice')
  check('_SelectEx(n)：选项文字取这条语句之前存进栈帧的最后 n 个字符串', ce && J(ce.options) === J(['first', 'second']) && J(ce.branches.map((b) => msgs(b))) === J([['P'], ['Q']]), J(ce))
  // 分支各走各的（一个分支跳到别的脚本）：没有汇合点
  const u = new BgiScript()
  u.select('go', 'stay').dispatch(['lg', 'ls']).label('lg').msg('going', 'A').jumpScenario('other').label('ls').msg('staying', 'A').jmp('m').label('m').msg('tail', 'A')
  const ru = runOf(u)
  const cu = ru.events.find((x) => x.k === 'choice')
  check('分支里有 jump_scenario：没有共同的汇合点 → merge = null、unmerged 记一次，分支各自带到结束', cu && cu.merge === null && ru.unmerged === 1 && J(cu.branches.map((b) => msgs(b))) === J([['going'], ['staying', 'tail']]), J(cu))
}

// ================= 容器 + 适配器 + 整条链 =================
const FILM = Buffer.from(Array.from({ length: 4 * 4 * 4 }, (_, i) => (i * 5 + 3) & 0xff))
const px = (n, bpp) => ({ width: 4, height: 4, bpp, pixels: Buffer.from(Array.from({ length: 16 * (bpp / 8) }, (_, i) => ((i * n) ^ (i >> 1)) & 0xff)) })
const media = path.join(work, 'Triple Game')
await mkdir(path.join(media, 'Archive'), { recursive: true })
{
  const scene1 = new BgiScript()
  scene1.call('_PlayBGM', 0, 'bgm01', 0, 1, 100, 0)
    .call('_DrawScene', 'bg01', 0, 2, 0, 32767, 32767, 100, 0, 32767, 32767, 100, 1, 0, 700, 0)
    .call('_DrawBS', 4, 'ST01', 0, 0, 0, 0, 2, 268435456, 300, 268435456, 0, 0, 0, 100, -1, -1, 0, 0, 0, 0, -1, 200, 1, -256, 'ST01_F')
    .call('_PlayVoice', 0, 'v001', 100, 64, 1, 0, 1, 0)
    .msg('Hello <Rruby>kanji</R> world', 'Alice')
    .call('_Wait', 1500, 1)
    .msg('narration', '')
    .select('Left', 'Right').dispatch(['L', 'R'])
    .label('L').call('_PlaySE', 0, 'se01', 100, 64, 0, 500).msg('left path', 'Alice').jmp('M')
    .label('R').msg('right path', 'Bob')
    .label('M').call('_DrawScene', 'BLACK', 0, 2).msg('merged', 'Alice').jumpScenario('scene2')
  const scene2 = new BgiScript()
  scene2.select('go', 'stay').dispatch(['G', 'S']).label('G').msg('going', 'A').jumpScenario('scene1').label('S').msg('staying', 'A')
  const anim = Buffer.concat([Buffer.from('BurikoAnimation1.00\0'), Buffer.alloc(40, 1)])
  await writeFile(path.join(media, 'Archive', 'data01000.arc'), buildArc20([
    { name: 'scene1', data: dscEncode(scene1.build()) },
    { name: 'scene2', data: dscEncode(scene2.build()) },
    { name: 'animation000', data: dscEncode(anim) },
  ]))
  await writeFile(path.join(media, 'Archive', 'data02000.arc'), buildArc20([
    { name: 'bg01', data: cbgEncode(px(3, 24)) },
    { name: 'ST01', data: cbgEncode(px(5, 32)) },
    { name: 'ST01_F', data: cbgEncode(px(7, 32)) },
    { name: 'weird', data: Buffer.from('not an image or sound at all, no magic') },
  ]))
  await writeFile(path.join(media, 'Archive', 'data03000.arc'), buildArc20([{ name: 'bgm01', data: bwWrap(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20, 9)])) }, { name: 'v001', data: bwWrap(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20, 8)])) }, { name: 'se01', data: bwWrap(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20, 6)])) }]))
  await writeFile(path.join(media, 'sysprg.arc'), buildArc20([{ name: 'sys._bp', data: Buffer.from('program bytes') }]))
  await writeFile(path.join(media, 'sysgrp.arc'), buildArc20([{ name: 'sysimg', data: cbgEncode(px(11, 32)) }]))
  await writeFile(path.join(media, 'BGI.gdb'), 'SDC FORMAT 1.00')
}
const layoutItem = { itemId: 'b', title: 'b', config: { game: { id: 'bgi::test' } }, source: { path: media }, adapters: ['bgi::bs'] }
const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.27.0', options: {} } })
const cfgRaw = tagOut.itemPatch.gal.config
const cfg = normalizeGalConfig(cfgRaw)
check('gal-layout：认出 bgi（id = bgi::test），containers = buriko / flat / hybrid / bgi-bs，扫 Archive 和根；系统程序（sysprg / system）规则里跳过；资源根 arc/res；适配器 bgi::bs；写出来的 config 引擎规整后零警告', cfg.game.id === 'bgi::test' && cfg.containers.format === 'buriko' && cfg.containers.flat === true && cfg.containers.mode === 'hybrid' && cfg.containers.scriptDecoder === 'bgi-bs' && J(cfg.containers.scan) === J(['Archive', '.']) && cfg.containers.rules[0].skip === true && J(cfg.resourceRoots) === J(['arc/res']) && J(tagOut.itemPatch.gal.adapters ?? layoutItem.adapters) !== '[]' && normalizeGalConfigWithWarnings(cfgRaw).warnings.length === 0, J([cfg.containers, normalizeGalConfigWithWarnings(cfgRaw).warnings]))
{
  const again = await generateTags({ item: { ...layoutItem, config: cfgRaw }, script: { id: 'gal-layout', version: '2.27.0', options: {} } })
  check('gal-layout：存进条目再跑一次 = 没有改动', /新增 0 项 \/ 修改 0 项 \/ 删除 0 项/.test(again.logs.join('\n')), again.logs.filter((l) => /本次改动/.test(l)).join(' | '))
}
{
  const report = await ensureContainers({ mediaDir: media, config: cfg })
  const rep = report.arcs
  check('展开：剧本（DSC → 事件流 JSON）展开到 arc/script/<容器>/<名>.bgi；不是剧本的 DSC（动画表）和不认识的条目跳过；sysprg / system 按规则不展开；图 / 声音一个都没落盘', (await exists(path.join(media, 'arc/script/data01000/scene1.bgi'))) && (await exists(path.join(media, 'arc/script/data01000/scene2.bgi'))) && !(await exists(path.join(media, 'arc/script/data01000/animation000.bgi'))) && !(await exists(path.join(media, 'arc/res/bg01.png'))) && rep['Archive/data01000.arc'].scripts === 2 && rep['Archive/data01000.arc'].notScript === 1 && rep['./sysprg.arc']?.skipped === 'rule', J(rep))
  const vf = await virtualFiles({ mediaDir: media, config: cfg })
  check('虚拟索引（flat，不带容器名）：图 = arc/res/<名>.png、声音 = arc/res/<名>.ogg；不认识的条目没有；sysgrp 的图也在', J([...vf.files].sort()) === J(['arc/res/ST01.png', 'arc/res/ST01_F.png', 'arc/res/bg01.png', 'arc/res/bgm01.ogg', 'arc/res/se01.ogg', 'arc/res/sysimg.png', 'arc/res/v001.ogg']), J(vf.files))
  const n1 = await materialize({ mediaDir: media, config: cfg, rels: ['arc/res/bg01.png', 'arc/res/BGM01.ogg'] })
  const png = decodePng(await readFile(path.join(media, 'arc/res/bg01.png')))
  const src = px(3, 24)
  const want = Buffer.from(src.pixels); for (let i = 0; i < want.length; i += 3) { const t = want[i]; want[i] = want[i + 2]; want[i + 2] = t }
  check('取出（materialize）：CBG → PNG（像素 = 原图 BGR→RGB）、BW → Ogg（去头）；路径大小写忽略；第二次不重复取', n1 === 2 && png.width === 4 && png.channels === 3 && png.raw.equals(want) && (await readFile(path.join(media, 'arc/res/bgm01.ogg'))).subarray(0, 4).toString() === 'OggS' && (await materialize({ mediaDir: media, config: cfg, rels: ['arc/res/bg01.png'] })) === 0, J([n1, png.width]))
  const entry = await virtualEntry({ mediaDir: media, config: cfg, rels: ['arc/res/ST01.png'] })
  const read = await entry.read()
  check('缩略图用的 virtualEntry.read()：不落盘也给出转好的 PNG（RGBA 4×4）', decodePng(read).channels === 4 && !(await exists(path.join(media, 'arc/res/ST01.png'))))
}
{
  const files = ['arc/res/ST01.png', 'arc/res/ST01_F.png', 'arc/res/bg01.png', 'arc/res/bgm01.ogg', 'arc/res/se01.ogg', 'arc/res/v001.ogg']
  const adapter = (await import('../../web/library/gal/adapters/bgi-bs.mjs'))
  const ctx = adapter.prepare({ options: {}, files, texts: {}, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
  const text = await readFile(path.join(media, 'arc/script/data01000/scene1.bgi'), 'utf8')
  check('适配器认领：sniff 认 {"format":"bgi-bs/1"…}；已注册；别的格式不认', adapter.sniff(text) && galAdapterIds().includes('bgi::bs') && sniffGalAdapter(text) === 'bgi::bs' && !adapter.sniff('{"format":"advhd-ws2/1"}'))
  const scene = adapter.parse(text, ctx)
  const st = scene.steps
  const cmdsOf = (i) => st[i].commands.map((c) => c.op)
  check('场景：开头一步 = bgm + voice（按事件顺序）+ bg + 立绘（本体 + 表情叠在一起，x 居中 = center；视觉变化在台词那一刻提交）+ speaker + text（ruby 片段）', J(cmdsOf(0)) === J(['bgm', 'voice', 'bg', 'stand', 'speaker', 'text']) && st[0].commands[0].src === 'bgm01.ogg' && st[0].commands[1].src === 'v001.ogg' && st[0].commands[2].src === 'bg01.png' && J(st[0].commands[3].parts) === J([{ src: 'ST01.png', align: 'center' }, { src: 'ST01_F.png', align: 'center' }]) && J(st[0].commands[4].segments) === J([{ text: 'Alice' }]) && J(st[0].commands[5].segments) === J([{ text: 'Hello ' }, { text: 'kanji', ruby: 'ruby' }, { text: ' world' }]), J(st[0]))
  check('场景：_Wait = wait（秒）；旁白（说话人空）= speaker 清空；选项挂在问题那句台词的步里', st[1].commands.some((c) => c.op === 'wait' && c.seconds === 1.5) && J(st[1].commands.find((c) => c.op === 'speaker').segments) === J([]) && st[1].commands.some((c) => c.op === 'choice' && c.options.length === 2 && c.options[1].segments[0].text === 'Right'), J(st[1]))
  const choice = st[1].commands.find((c) => c.op === 'choice')
  const g = (n) => J([{ var: choice.var, op: '==', value: n }])
  const left = st.filter((s) => s.commands.some((c) => J(c.when) === g(1)))
  const right = st.filter((s) => s.commands.some((c) => J(c.when) === g(2)))
  check('场景：每个选项一段带 when（selN == 选项）的分支；左 = se + 台词，右 = 台词', left.length === 1 && right.length === 1 && left[0].commands.some((c) => c.op === 'se' && c.src === 'se01.ogg') && J(left[0].commands.find((c) => c.op === 'text').segments) === J([{ text: 'left path' }]) && J(right[0].commands.find((c) => c.op === 'text').segments) === J([{ text: 'right path' }]), J([left, right]))
  const merged = st.at(-1)
  check('场景：汇合之后的台词不带 when，换背景到纯色 BLACK = bg.color；脚本末尾的 jump_scenario = scene.next', merged.commands.every((c) => !c.when) && merged.commands.some((c) => c.op === 'bg' && J(c.color) === J([0, 0, 0])) && J(merged.commands.find((c) => c.op === 'text').segments) === J([{ text: 'merged' }]) && J(scene.next) === J({ script: 'scene2' }), J(merged))
  check('场景：stats —— 台词 / 选择 / 语音 / 图 / 立绘计数；BLACK 不算缺资源；call_scenario / jump_scenario 记进 links', scene.stats.messages === 5 && scene.stats.choices === 1 && scene.stats.voices.resolved === 1 && scene.stats.images.unresolved === 0 && scene.stats.stands >= 1 && Object.keys(scene.stats.unresolved).length === 0 && scene.stats.links['jump_scenario:scene2'] === 1, J(scene.stats))
  // 缺资源：没有索引（hasIndex 假）不报缺；有索引但没有这个名字才报
  const partial = adapter.prepare({ options: {}, files: ['arc/res/bg01.png'], toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
  const miss = adapter.parse(text, partial)
  check('缺资源：索引里没有的图 / 声音记进 stats.unresolved（不会让整个场景失败）', miss.stats.unresolved['image:ST01'] === 1 && miss.stats.unresolved['voice:v001'] === 1 && miss.stats.unresolved['bgm:bgm01'] === 1 && miss.steps.length === st.length, J(miss.stats.unresolved))
  const s2 = adapter.parse(await readFile(path.join(media, 'arc/script/data01000/scene2.bgi'), 'utf8'), ctx)
  const gotos = s2.steps.flatMap((s) => s.commands).filter((c) => c.op === 'goto')
  check('场景：分支里的 jump_scenario = 带 when 的 goto { script }（播放器直接接着播）；没有汇合点的分支各自带到结束', gotos.length === 1 && gotos[0].script === 'scene1' && Array.isArray(gotos[0].when) && s2.next === undefined, J(gotos))
}
{
  // 整条链：导入 → gal-layout → 列表 → 场景 → 资源（hybrid 取出时转格式）→ 缩略图（?w=，不落盘）
  const dataDir = path.join(work, 'data')
  const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => exists(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media, adapters: ['bgi::bs'] } } }) })
  const imported = await handler.importFromSource({ options: { adapters: ['bgi::bs'], config: { game: { id: 'bgi::test' } } } })
  const item = imported.items[0]
  const out = await generateTags({ item, script: { id: 'gal-layout', version: '2.27.0', options: {} } })
  await handler.internals.updateItem(item.itemId, (it) => ({ ...it, config: { ...it.config, ...out.itemPatch.gal.config } }))   // 绕过 patchItemMetadata（它会在后台预热展开）
  const id = item.itemId
  const home = (await handler.getReaderContent(id, 'main', { sectionId: '' })).node
  check('列表：首页 = 容器目录卡片（data01000，里面 2 个脚本）；没有 problems', home.items.map((i) => i.title).join() === 'data01000' && !home.problems?.some((p) => p.level === 'error'), J(home))
  const dir = (await handler.getReaderContent(id, 'main', { sectionId: home.items[0].node || home.items[0].id })).node
  check('目录：两个脚本（scene1 / scene2），脚本卡片有台词摘要', dir.items.map((i) => i.title).join() === 'scene1,scene2' && /Hello|kanji/.test(dir.items[0].subtitle || ''), J(dir.items.map((i) => [i.title, i.subtitle])))
  const play = await handler.getReaderContent(id, 'main', { sectionId: dir.items[0].node || dir.items[0].id })
  check('播放：scene 来自适配器 bgi::bs；脚本末尾 jump_scenario → scene.next.node = scene2 的节点（服务端按名字补）', play.node.kind === 'player' && play.scene.adapter === 'bgi::bs' && play.scene.next?.node === (dir.items[1].node || dir.items[1].id), J([play.scene.adapter, play.scene.next]))
  const play2 = await handler.getReaderContent(id, 'main', { sectionId: dir.items[1].node || dir.items[1].id })
  const goto = play2.scene.steps.flatMap((s) => s.commands).find((c) => c.op === 'goto')
  check('播放：分支里的 goto 也补上了 node（scene1 的节点）', goto?.node === (dir.items[0].node || dir.items[0].id), J(goto))
  const bg = play.scene.steps[0].commands.find((c) => c.op === 'bg')
  const res = await handler.getResource(id, bg.src)
  const resPng = decodePng(res.body)
  check('取资源：背景（CBG）= PNG、声音（BW）= Ogg；取资源时才落盘', res.contentType === 'image/png' && resPng.width === 4 && (await handler.getResource(id, 'v001.ogg')).body.subarray(0, 4).toString() === 'OggS', J(res.contentType))
  const thumb = await handler.getResource(id, 'ST01.png', { width: 160 })
  check('缩略图（?w=）：容器里的图直接缩成 WebP 缓存', thumb.contentType === 'image/webp' && Boolean(thumb.file), J(thumb))
}

// ================= 真实样本（可选）=================
if (process.env.BGI_SAMPLE_DIR) {
  const dir = process.env.BGI_SAMPLE_DIR
  const files = (await readdir(dir)).filter((f) => /\.arc$/i.test(f)).sort()
  let scripts = 0
  let errors = 0
  let images = 0
  for (const f of files) {
    let entries
    try { entries = (await readBurikoArcIndex(path.join(dir, f))).entries } catch { continue }
    const whole = await readFile(path.join(dir, f))
    for (const e of entries.slice(0, 40)) {
      const buf = whole.subarray(e.offset, e.offset + e.size)
      const kind = sniffEntry(buf)
      try {
        if (kind === 'dsc') { const raw = dscDecode(buf); if (isBurikoScript(raw)) { runBurikoScript(raw); scripts++ } }
        else if (kind === 'cbg') { cbgToPng(buf); images++ }
      } catch { errors++ }
    }
  }
  check(`真实样本（${dir}）：每个 arc 的前 40 个条目：剧本能解压 + 执行、图能转 PNG，没有出错`, errors === 0 && scripts + images > 0, J({ scripts, images, errors }))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
