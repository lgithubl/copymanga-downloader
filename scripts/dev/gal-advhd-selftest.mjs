#!/usr/bin/env node
// WillPlus AdvHD 自测（不需要浏览器）：ws2 解码、ARC / PNA 读取、容器展开（config.containers）、advhd::ws2 适配器、
// 引擎家族（game.id = advhd::<游戏>）的布局 / 浏览 / 取资源。全部用合成数据（scripts/dev/make-advhd-fixture.mjs），不含任何真实游戏资源。
//   node scripts/dev/gal-advhd-selftest.mjs
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../../scripts/tag-scripts/gal-layout/main.js'
import { decodeWs2, OPCODE_LAYOUTS, OPCODE_NAMES, ror2 } from '../../web/library/gal/adapters/advhd-ws2-decode.mjs'
import { galAdapter, galAdapterIds, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { applyGalConfigPatch, normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { containerReport, ensureContainers, invalidateContainers, materialize, parsePna, readArcIndex, SCRIPT_DECODERS, virtualFiles } from '../../web/library/gal/containers.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { resolveOnDisk } from '../../web/library/gal/resolve.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { activePath, applyCommand, easeOf, initialState, stateAt } from '../../web/static/gal-engine.js'
import { STORY_001, STORY_BRANCH, STORY_COND, STORY_BOB, STORY_GALLERY, STORY_PAN, STORY_SKIP, STORY_TIMER, arcBuild, buildAdvhdFixture, commit, msg, pnaBuild, pngBytes, ws2Encode, ws2Plain } from './make-advhd-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const J = (v) => JSON.stringify(v)
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-advhd-'))
const exists = (p) => stat(p).then(() => true, () => false)
const list = async (dir) => { try { return (await readdir(dir)).sort() } catch { return [] } }
const decodeText = (buffer, arc = 'Rio1', name = 'x') => SCRIPT_DECODERS['advhd-ws2'].decode(buffer, { arc, name })
const FAMILY_CONTAINERS = { enabled: true, dir: 'arc', scan: ['.'], scriptDecoder: 'advhd-ws2', scriptExt: 'advhd', mode: 'files', rules: [{ match: '^(?:Script\\d*|DX11Effect|Model)\\.arc$', skip: true }, { match: '^Rio\\.arc$', kinds: ['script'], include: ['^CG_PAGE\\.ws2$'], gallery: { functions: ['openCgBrowser'], pageFlags: [105], minCalls: 20, group: '_\\d+$' } }, { match: '\\.arc$' }] }
const cfgWith = (containers, extra = {}) => normalizeGalConfig({ scriptRoots: [{ id: 'story', dir: 'arc/script', label: '剧情' }], resourceRoots: ['arc/res'], scriptExtensions: ['advhd'], containers, limits: { sampleFiles: 20000, sampleBytes: 262144 }, ...extra })

// ================= ws2 解码 =================
{
  const buf = Buffer.from([0, 1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255])
  check('ror2：逐字节循环右移 2 位，再循环左移 2 位（测试编码器的 rol2）= 原样', ror2(buf).equals(Buffer.from(buf.map((x) => ((x >> 2) | ((x & 3) << 6)) & 0xff))) && ror2(Buffer.from([0x01]))[0] === 0x40)
  const items = [['SetBackground', ['bg01', '背景.PNG', 1, 1]], ['Unk65', [3, 22, 0.5, 0.25, 2, 'EFMSK_12.PNG']], ['UnkAF', [255, 255, 0.5, 0, 1, 0]], ['FileEnd', []]]
  const out = decodeWs2(ror2(ws2Encode(items)))
  check('解码：指令名 / 参数（UTF-16LE 字符串、u8 / u16 / f32）和编码前一致；SetBackground = (图层, 文件, u8, u8)（社区表少这 2 个字节）；0xAF = (u16, u16, f32 × 4)；Unk65 = 过渡（u16 层组, u8 类型, f 时长, f, u8, 遮罩文件名）', J(out.map((i) => i.name)) === J(items.map((i) => i[0])) && J(out.map((i) => i.args)) === J(items.map((i) => i[1])), J(out))
  check('解码：每条指令带它在文件里的偏移 at，且单调递增；到 FileEnd 就结束（后面的 8 字节尾巴不当指令）', out.every((i, k) => k === 0 || i.at > out[k - 1].at) && out[0].at === 0 && decodeWs2(ws2Plain(items)).length === 4)
  const withCond = decodeWs2(ror2(ws2Encode([['Condition', [0, 1, 1, 0, 0]], ['Condition', [2, 127, 1, 0, 40]], ['Condition', [130, 99, -1, 0, 40]], ['FileEnd', []]])))
  check('Condition 永远是 5 个操作数（类型 u8、变量 u16、值 f32、p1 u32、p2 u32）——没有「类型 1 不带参数」这回事', J(withCond.map((i) => i.args.length)) === J([5, 5, 5, 0]), J(withCond.map((i) => i.args)))
  const choice = decodeWs2(ror2(ws2Encode(STORY_BRANCH))).find((i) => i.name === 'ShowChoice')
  check('ShowChoice：选项（id、文字、3 个标志字节、跳转类型 6 = 本脚本偏移 / 7 = 文件名）', choice.choices.length === 3 && choice.choices[0].jump === 6 && typeof choice.choices[0].target === 'number' && choice.choices[2].target === 'OTHER_00' && choice.choices[1].text === '右へ', J(choice))
  const fn = decodeWs2(ror2(ws2Encode(STORY_SKIP))).find((i) => i.name === 'ExecuteFunction')
  check('ExecuteFunction：函数名 / 字符串参数 / u16 标志号（999）/ byte', J(fn.args) === J(['GetMsgSkip', '', 999, 1]), J(fn))
  const stand = decodeWs2(ror2(ws2Encode(STORY_001))).find((i) => i.name === 'DisplayCharacterImage')
  check('DisplayCharacterImage：数组型操作数 = 个数（u8）+ 元素（u16）：[图层, u8, u8, 个数, ...图片 id]', J(stand.args) === J(['st01', 2, 1, 2, 1, 3]), J(stand))
  const gallery = decodeWs2(ror2(ws2Encode([['LayersList', [2, 'a', 'b']], ['FileEnd', []]])))
  check('字符串数组（LayersList）= 个数 + 字符串', J(gallery[0].args) === J([2, 'a', 'b']))
  let err = null
  try { decodeWs2(Buffer.from([0x7e, 0x00])) } catch (e) { err = e }
  check('不在引擎操作数表里的 opcode：抛错，带偏移和 opcode；tolerant 模式停在那里、返回已解出的部分、truncated 记原因', /偏移 0（opcode 0x7e）/.test(err?.message || '') && decodeWs2(Buffer.concat([ws2Plain([['ClearLayer', ['*']]]).subarray(0, 14), Buffer.from([0x7e])]), { tolerant: true }).truncated?.includes('0x7e'), err?.message)
  let err2 = null
  try { decodeWs2(ws2Plain([['SetBackground', ['bg01', 'x', 1, 1]]]).subarray(0, 9)) } catch (e) { err2 = e }
  check('文件被截断（字符串没有结束）：报 eof，带偏移', /偏移 0.*eof/.test(err2?.message || ''), err2?.message)
  check('操作数表：来自 exe 的 PTR_DAT_1403ea420（205 项有布局）；0xAF / 0x47（Effect1）/ 0x09（寄存器运算）都在；名字没有重复', Object.keys(OPCODE_LAYOUTS).length === 205 && J(OPCODE_LAYOUTS[0xaf]) === J(['w', 'w', 'f', 'f', 'f', 'f']) && OPCODE_LAYOUTS[0x47].length === 12 && J(OPCODE_LAYOUTS[0x09]) === J(['b', 'w', 'f']) && new Set(Object.values(OPCODE_NAMES)).size === Object.keys(OPCODE_NAMES).length)
}

// ================= ARC / PNA 读取 =================
{
  const dir = path.join(work, 'arc-read')
  await mkdir(dir, { recursive: true })
  const good = arcBuild([{ name: 'a.png', data: pngBytes(1) }, { name: '日本語.ogg', data: Buffer.from('OggS') }, { name: 'empty.bin', data: Buffer.alloc(0) }])
  await writeFile(path.join(dir, 'good.arc'), good)
  const idx = await readArcIndex(path.join(dir, 'good.arc'))
  check('ARC 索引：条目数、UTF-16 名字（含中日文）、数据偏移 / 大小', idx.entries.length === 3 && idx.entries[1].name === '日本語.ogg' && good.subarray(idx.entries[1].offset, idx.entries[1].offset + idx.entries[1].size).toString() === 'OggS' && idx.entries[2].size === 0, J(idx))
  const bad = {
    'tiny.arc': Buffer.from([1, 2, 3]),
    'dirbig.arc': (() => { const b = Buffer.from(good); b.writeUInt32LE(0x7fffffff, 4); return b })(),
    'count.arc': (() => { const b = Buffer.from(good); b.writeUInt32LE(1000000, 0); return b })(),
    'beyond.arc': good.subarray(0, good.length - 3),
    'noterm.arc': (() => { const b = Buffer.from(good); const dirSize = b.readUInt32LE(4); b.fill(0x41, 8 + 8, 8 + dirSize); return b })(),
  }
  const results = {}
  for (const [name, data] of Object.entries(bad)) { await writeFile(path.join(dir, name), data); results[name] = await readArcIndex(path.join(dir, name)).then(() => 'ok', (e) => e.message) }
  check('损坏的 ARC：太小 / 目录大小不合理 / 条目数和目录对不上 / 数据超出文件 / 名字没有结束符，都明确报错（不崩、不读超界）', Object.values(results).every((r) => r !== 'ok'), J(results))

  const png = pngBytes(5)
  const pna = parsePna(pnaBuild({ magic: 'WPAS', width: 10, height: 20, frames: [{ type: 1 }, { type: 0, id: 7, x: 1, y: 2, w: 3, h: 4, scale: 0.5, data: png }, { type: 2 }] }))
  check('PNA：魔数 / 宽高 / 帧（type、id、位置、尺寸、缩放、数据）；type 1 / 2 的组标记帧没有数据', pna.magic === 'WPAS' && pna.width === 10 && pna.height === 20 && pna.frames.length === 3 && pna.frames[1].id === 7 && pna.frames[1].w === 3 && pna.frames[1].scale === 0.5 && pna.frames[1].data.equals(png) && pna.frames[0].size === 0, J(pna.frames.map((f) => [f.type, f.id, f.size])))
  let e1 = null
  try { parsePna(Buffer.from('NOPE000000000000000000000')) } catch (e) { e1 = e }
  let e2 = null
  try { const b = pnaBuild({ frames: [{ type: 0, id: 1, data: png }] }); parsePna(b.subarray(0, b.length - 5)) } catch (e) { e2 = e }
  check('PNA 损坏：魔数不对 / 帧数据超出文件，报错', /魔数/.test(e1?.message || '') && /超出/.test(e2?.message || ''), `${e1?.message} | ${e2?.message}`)
}

// ================= 容器展开（config.containers）=================
const game = path.join(work, 'game')
await buildAdvhdFixture(game, { brokenArc: true })
{
  const cfg = cfgWith(FAMILY_CONTAINERS)
  const report = await ensureContainers({ mediaDir: game, config: cfg })
  const arcs = report.arcs
  check('规则：Script2 在黑名单（skip）里不展开；Rio.arc 只收 CG_PAGE（kinds / include）；坏的 Chip9.arc 报错但不影响别的容器', arcs['./Script2.arc']?.skipped === 'rule' && arcs['./Rio.arc']?.scripts === 4 && arcs['./Rio.arc']?.galleryGroups === 3 && arcs['./Rio.arc']?.excluded === 2 && /不是 ARC|不合理|太小/.test(arcs['./Chip9.arc']?.error || '') && arcs['./Rio1.arc']?.scripts === 3, J(arcs))
  check('展开：剧情 = arc/script/<容器>/<脚本>.advhd（readme.txt 这种不认识的类型不展开）；图 / 声音 = arc/res/<容器>/<条目名> 原样', J(await list(path.join(game, 'arc/script/Rio1'))) === J(['001_00.advhd', '002_00_H.advhd', '003_00.advhd']) && J(await list(path.join(game, 'arc/res/Voice'))) === J(['SV_TOW_01.ogg', 'TW_0001.ogg', 'TW_0002.ogg']) && (await readFile(path.join(game, 'arc/res/Bgm/BGM01.ogg'), 'utf8')) === 'OggS-bgm' && J(await list(path.join(game, 'arc/script/Rio'))) === J(['CG_PAGE', 'CG_PAGE.advhd']) && J(await list(path.join(game, 'arc/script/Rio/CG_PAGE'))) === J(['BG.advhd', 'EV.advhd', 'NOPE.advhd']) && !(await exists(path.join(game, 'arc/res/Chip9'))), J(await list(path.join(game, 'arc'))))
  const text = await readFile(path.join(game, 'arc/script/Rio1/001_00.advhd'), 'utf8')
  const parsed = JSON.parse(text)
  check('脚本被解成 JSON 指令流：format / arc / name / size / ins[[偏移, 指令名, 参数]]；sniff 认得', parsed.format === 'advhd-ws2/1' && parsed.arc === 'Rio1' && parsed.name === '001_00' && parsed.ins.length === STORY_001.length && parsed.ins[0][1] === 'ClearLayer' && galAdapter('advhd::ws2').sniff(text) && sniffGalAdapter(text) === 'advhd::ws2', J(parsed.ins.slice(0, 2)))
  const pnaDir = path.join(game, 'arc/res/Chip3/ST_TOW_A_M.pna')
  const index = JSON.parse(await readFile(path.join(pnaDir, 'index.json'), 'utf8'))
  check('PNA 展开成目录：index.json（宽 / 高 / 帧：n（序号）type id x y w h scale file）+ <帧序号>.png；组标记帧没有文件；记录里的 id 字段（倒序）照记但不用来命名', J(await list(pnaDir)) === J(['1.png', '2.png', '3.png', 'index.json']) && index.width === 600 && index.height === 800 && index.frames.length === 5 && index.frames[1].file === '1.png' && index.frames[1].id === 3 && index.frames[1].n === 1 && index.frames[0].file === undefined && (await readFile(path.join(pnaDir, '3.png'))).equals(pngBytes(13)), J(index))
  let bumpN = 0
  const stampFile = path.join(game, 'arc/.stamp.json')
  const mtime1 = (await stat(path.join(game, 'arc/res/Bgm/BGM01.ogg'))).mtimeMs
  invalidateContainers(game)
  const again = await ensureContainers({ mediaDir: game, config: cfg })
  check('幂等：容器没变（大小 + mtime + 规则指纹）→ 不重新展开（文件 mtime 不变，报告 cached）', again.arcs['./Bgm.arc'].cached === true && (await stat(path.join(game, 'arc/res/Bgm/BGM01.ogg'))).mtimeMs === mtime1 && (await exists(stampFile)))
  // 容器换了内容 → 重新展开，旧文件清掉
  await writeFile(path.join(game, 'Bgm.arc'), arcBuild([{ name: 'BGM02.ogg', data: Buffer.from('OggS-new') }]))
  { const t = new Date(Date.now() + (bumpN += 5) * 1000); await utimes(path.join(game, 'Bgm.arc'), t, t) }   // 同样大小的改写：mtime 粗（同一刻）时签名一样，测试里显式错开 mtime（容器签名 = 大小 + mtime）
  invalidateContainers(game)
  const changed = await ensureContainers({ mediaDir: game, config: cfg })
  check('容器变了 → 重新展开，旧条目不残留', !changed.arcs['./Bgm.arc'].cached && J(await list(path.join(game, 'arc/res/Bgm'))) === J(['BGM02.ogg']), J(await list(path.join(game, 'arc/res/Bgm'))))
  await writeFile(path.join(game, 'Bgm.arc'), arcBuild([{ name: 'BGM01.ogg', data: Buffer.from('OggS-bgm') }]))
  { const t = new Date(Date.now() + (bumpN += 5) * 1000); await utimes(path.join(game, 'Bgm.arc'), t, t) }   // 同样大小的改写：mtime 粗（同一刻）时签名一样，测试里显式错开 mtime（容器签名 = 大小 + mtime）
  // 规则指纹变了（改了 include）→ 重新展开
  invalidateContainers(game)
  const narrowed = await ensureContainers({ mediaDir: game, config: cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '^Rio1\\.arc$', kinds: ['script'], exclude: ['^003'] }, { match: '^Chip3\\.arc$', kinds: ['res'], include: ['^BG_'] }, { match: '\\.arc$', skip: true }] }) })
  check('规则可配：kinds / include / exclude / skip（黑名单）——003 被 exclude、Chip3 只收 BG_*、PNA 不在 kinds 里、别的容器 skip', J(await list(path.join(game, 'arc/script/Rio1'))) === J(['001_00.advhd', '002_00_H.advhd']) && J(await list(path.join(game, 'arc/res/Chip3'))) === J(['BG_01.png']) && narrowed.arcs['./Bgm.arc'].skipped === 'rule' && narrowed.arcs['./Rio1.arc'].excluded === 1, J(narrowed.arcs['./Chip3.arc']))
  const noPna = path.join(work, 'game-nopna')
  await buildAdvhdFixture(noPna)
  await ensureContainers({ mediaDir: noPna, config: cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '^Chip3\\.arc$', pna: 'raw' }] }) })
  check('pna: raw = .pna 原样放（不拆帧）；pna: skip = 不要', (await exists(path.join(noPna, 'arc/res/Chip3/ST_TOW_A_M.pna'))) && !(await stat(path.join(noPna, 'arc/res/Chip3/ST_TOW_A_M.pna'))).isDirectory())
  const noPna2 = path.join(work, 'game-skippna')
  await buildAdvhdFixture(noPna2)
  await ensureContainers({ mediaDir: noPna2, config: cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '^Chip3\\.arc$', pna: 'skip' }] }) })
  check('pna: skip：Chip3 里只剩普通图片', J(await list(path.join(noPna2, 'arc/res/Chip3'))) === J(['BG_01.png', 'EV_01.png']))
  check('没启用（默认）：什么都不做、不建目录、返回 null', (await ensureContainers({ mediaDir: path.join(work, 'x'), config: normalizeGalConfig({}) })) === null && !(await exists(path.join(work, 'x'))))
}
{
  // 条目名安全：越界 / 绝对路径 / 隐藏文件 / 特殊字符 / 太长 / 层数太多 都不展开，不会写到 arc 目录外面
  const dir = path.join(work, 'evil')
  await mkdir(dir, { recursive: true })
  const names = ['../evil.png', 'a/../../evil2.png', '/abs.png', '.hidden.png', 'a|b.png', 'x#y.png', `${'n'.repeat(250)}.png`, 'a/b/c/d/e/f/g.png', 'dir/ok.png', 'ok2.png']
  await writeFile(path.join(dir, 'Evil.arc'), arcBuild(names.map((name) => ({ name, data: pngBytes(3) }))))
  const report = await ensureContainers({ mediaDir: dir, config: cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '\\.arc$' }] }) })
  const r = report.arcs['./Evil.arc']
  check('条目名只认安全的相对路径：越界 / 隐藏 / 特殊字符 / 太长 / 层数太多的 7 个名字被拒（记在 bad），开头的 / 去掉当相对路径（abs.png）；展开的只有 abs.png、dir/ok.png、ok2.png；arc 目录外没有任何新文件', r.res === 3 && r.bad.length === 7 && J(await list(path.join(dir, 'arc/res/Evil'))) === J(['abs.png', 'dir', 'ok2.png']) && !(await exists(path.join(dir, 'evil.png'))) && !(await exists(path.join(work, 'evil.png'))) && !(await exists(path.join(dir, 'arc/evil.png'))), J(r))
  const small = path.join(work, 'budget')
  await mkdir(small, { recursive: true })
  await writeFile(path.join(small, 'Big.arc'), arcBuild([{ name: 'a.ogg', data: Buffer.alloc(1100 * 1024) }, { name: 'b.ogg', data: Buffer.alloc(1100 * 1024) }]))
  const budget = await ensureContainers({ mediaDir: small, config: { ...cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '\\.arc$' }] }), containers: { ...cfgWith(FAMILY_CONTAINERS).containers, rules: [{ match: '\\.arc$' }], maxTotalMB: 1 } } })
  check('展开总大小有上限（containers.maxTotalMB）：超了这个容器报错、半截内容不留下', /总大小超过上限/.test(budget.arcs['./Big.arc'].error || '') && !(await exists(path.join(small, 'arc/res/Big'))), J(budget.arcs))
  const many = path.join(work, 'many')
  await mkdir(many, { recursive: true })
  await writeFile(path.join(many, 'Many.arc'), arcBuild([1, 2, 3].map((n) => ({ name: `f${n}.png`, data: pngBytes(n) }))))
  const limited = await ensureContainers({ mediaDir: many, config: { ...cfgWith(FAMILY_CONTAINERS), containers: { ...cfgWith(FAMILY_CONTAINERS).containers, rules: [{ match: '\\.arc$' }], maxEntries: 2 } } })
  check('单个容器条目数上限（containers.maxEntries）', /条目 3 个，超过上限 2/.test(limited.arcs['./Many.arc'].error || ''), J(limited.arcs))
  const concurrent = path.join(work, 'concurrent')
  await buildAdvhdFixture(concurrent)
  const cfg = cfgWith(FAMILY_CONTAINERS)
  const [p1, p2, p3] = [ensureContainers({ mediaDir: concurrent, config: cfg }), ensureContainers({ mediaDir: concurrent, config: cfg }), ensureContainers({ mediaDir: concurrent, config: cfg })]
  check('并发调用共用同一次展开（单飞）：三个调用拿到同一个 Promise 的结果', p1 === p2 && p2 === p3 && (await p1).arcs['./Rio1.arc'].scripts === 3 && containerReport(concurrent)?.arcs['./Rio1.arc'].scripts === 3)
}

// ================= config：containers 规整 =================
{
  const { config, warnings } = normalizeGalConfigWithWarnings({ containers: { enabled: true, dir: '../x', scan: ['a/../b', '.'], scriptDecoder: 'nope', scriptExt: 'A B', maxEntries: 'many', maxTotalMB: 999999, rules: [{ match: '(a+)+' }, { match: '\\.arc$', kinds: ['res', 'bogus'], include: ['ok', '(b+)+'], pna: 'weird' }, 'x', { match: 'Rio', skip: true, extra: 1 }], bogus: 1 } })
  check('containers 规整：不安全目录 / 不认识的解码器 / 坏正则 / 越界数字 都丢掉或夹住并报告，合法的保留', config.containers.dir === 'arc' && J(config.containers.scan) === J(['.']) && config.containers.scriptDecoder === 'advhd-ws2' && config.containers.scriptExt === 'advhd' && config.containers.maxEntries === 200000 && config.containers.maxTotalMB === 65536 && config.containers.rules.length === 2 && J(config.containers.rules[0]) === J({ match: '\\.arc$', kinds: ['res'], include: ['ok'] }) && config.containers.rules[1].skip === true && warnings.length >= 8, J([config.containers, warnings.map((w) => w.field)]))
  check('containers 默认关闭；game.id / 适配器 id 允许 :: 分段（advhd::lpsl / advhd::ws2），不合格的丢掉', normalizeGalConfig({}).containers.enabled === false && normalizeGalConfig({ game: { id: 'advhd::lpsl' } }).game.id === 'advhd::lpsl' && normalizeGalConfig({ game: { id: 'a::b::c' } }).game?.id === 'a::b::c' && normalizeGalConfig({ game: { id: 'a::b::c::d' } }).game === null && normalizeGalConfig({ game: { id: 'a:b' } }).game === null && normalizeGalConfig({ game: { id: '::a' } }).game === null && !!normalizeGalConfig({ adapterOptions: { 'advhd::ws2': { a: 1 } } }).adapterOptions['advhd::ws2'] && !normalizeGalConfig({ adapterOptions: { 'Advhd::ws2': { a: 1 } } }).adapterOptions['Advhd::ws2'])
  check('适配器注册：advhd::ws2', galAdapterIds().includes('advhd::ws2'))
}

// ================= 适配器 advhd::ws2 =================
const parseGame = async (mediaDir, story, options = {}, configExtra = {}) => {
  const config = cfgWith(FAMILY_CONTAINERS, configExtra)
  await ensureContainers({ mediaDir, config })
  const adapter = galAdapter('advhd::ws2')
  const ctxConfig = { ...config, adapterOptions: { 'advhd::ws2': options } }
  const ctx = await loadAdapterContext({ adapter, mediaDir, config: ctxConfig })
  return buildScene('advhd::ws2', decodeText(ws2Encode(story)), ctx, { rel: 'arc/script/Rio1/x.advhd', stem: 'x', options, config: {} })
}
const cmdsOf = (scene, step) => scene.steps[step].commands
const textOf = (scene) => scene.steps.flatMap((s) => s.commands).filter((c) => c.op === 'text').map((c) => c.segments.map((x) => x.text).join(''))
{
  const scene = await parseGame(game, STORY_001)
  const [s0, s1, s2, s3, s4, s5] = scene.steps.map((s) => s.commands)
  check('剧情脚本 → 6 步（每句台词一步）；图层变更在「提交」（Unk65）时才生效，渐变秒数取 Unk65 的 f32', scene.steps.length === 6 && scene.stats.messages === 6 && s0[0].op === 'bg' && s0[0].src === 'Chip3/BG_01.png' && s0[0].fade === 0.5, J(s0))
  check('第 1 步：bgm（Bgm 容器）→ voice（char* 通道，Voice 容器）→ speaker（%LC 去掉）→ text（\\n = 换行，{汉字:ふりがな} = ruby，%K %P 去掉）', J(s0.slice(1).map((c) => c.op)) === J(['bgm', 'voice', 'speaker', 'text']) && s0[1].src === 'Bgm/BGM01.ogg' && s0[2].src === 'Voice/TW_0001.ogg' && s0[3].segments[0].text === '透羽' && J(s0[4].segments) === J([{ text: '「' }, { text: '應賀', ruby: 'おうが' }, { text: 'です。\nよろしく」' }]), J(s0))
  check('说话人换了才发 speaker：空名 = 旁白（segments: []），同一个人连续不重复发', s1[0].op === 'speaker' && s1[0].segments.length === 0 && s1[1].op === 'text' && !s3.some((c) => c.op === 'speaker'), J([s1, s3]))
  const stand = s2.find((c) => c.op === 'stand')
  check('立绘：UsePnaPackage + DisplayCharacterImage(帧序号表 [1, 3]；记录里的 id 字段是倒序的，不看) + MoveBackground(x, y) → stand（slot = 图层名，parts = PNA 里序号 1 和 3 的两帧的 PNG，舞台 1280×720，位置 = 图层位置 + 帧位置，换算成「中心相对舞台中心」）', stand?.slot === 'st01' && J(stand.stage) === J([1280, 720]) && stand.fade === 0.2 && J(stand.parts) === J([{ src: 'Chip3/ST_TOW_A_M.pna/3.png', x: -480, y: -235 }, { src: 'Chip3/ST_TOW_A_M.pna/1.png', x: -290, y: 90 }]), J(stand))
  check('事件图：ev 图层有图时 bg = { src: bg 的图, over: ev 的图 }', J(s3.find((c) => c.op === 'bg')) === J({ op: 'bg', src: 'Chip3/BG_01.png', over: 'Chip3/EV_01.png' }), J(s3))
  check('声音通道：char* = voice，bgv* = bgvoice（槽位 = 通道名，音量 1），se* = se；StopMusic = bgmStop（带淡出秒数）', J(s4.slice(0, 2)) === J([{ op: 'bgvoice', slot: 'bgvtow', src: 'Voice/SV_TOW_01.ogg', volume: 1 }, { op: 'se', src: 'Se/SE_01.ogg' }]) && s5.some((c) => c.op === 'bgmStop' && c.fade === 1), J([s4, s5]))
  check('stats：语音引用 / 解析（3 / 3）、bgm、图片、choices 等计数；没走到的指令（NextFile 后面的 FileEnd）计 unvisited', scene.stats.voices.referenced === 3 && scene.stats.voices.resolved === 3 && scene.stats.voices.unresolved === 0 && scene.stats.bgm.resolved === 1 && scene.stats.images.referenced === 2 && scene.stats.images.resolved === 2 && scene.stats.stands === 1 && scene.stats.choices === 0 && scene.stats.unvisited === 1, J(scene.stats))
  check('没做的功能看得见：未知函数 playSpecialEffect → raw（ExecuteFunction:playSpecialEffect）+ stats.skippedFunctions；GetMsgSkip 在 drop 表里不记；种类 0（颜色）的 Effect1 → raw（Effect1:kind0）、Effect3 → raw；UnkAF 在 ignoreOps 里只计数', J(scene.stats.skippedFunctions) === J({ playSpecialEffect: 1 }) && scene.stats.raw['ExecuteFunction:playSpecialEffect'] === 1 && scene.stats.raw['Effect1:kind0'] === 1 && scene.stats.raw.Effect3 === 1 && !scene.stats.raw['ExecuteFunction:GetMsgSkip'] && scene.stats.ignored.UnkAF === 1 && s5.some((c) => c.op === 'raw' && c.cmd === 'ExecuteFunction:playSpecialEffect') && s5.some((c) => c.op === 'raw' && c.cmd === 'Effect3'), J([scene.stats.raw, scene.stats.ignored]))
  check('NextFile 的目标记进 stats.links（播放器没有换脚本）；脚本在 FileEnd / NextFile 结束', scene.stats.links['next:002_00_H'] === 1)

  const opt = await parseGame(game, STORY_001, { functions: { default: 'drop' }, channels: [{ match: '^char', as: 'se' }], ignoreOps: ['Effect3'], fade: { max: 0.1 } })
  check('options 可改：functions.default = drop（不记 raw）/ channels（char* 当 se）/ ignoreOps（Effect3 不再 raw）/ fade.max 夹渐变秒数', !opt.stats.raw['ExecuteFunction:playSpecialEffect'] && !opt.stats.raw.Effect3 && opt.stats.ignored.Effect3 === 1 && opt.steps[0].commands.find((c) => c.op === 'se')?.src === 'Voice/TW_0001.ogg' && opt.steps[0].commands[0].fade === 0.1, J(opt.steps[0].commands.slice(0, 3)))
  const noIndex = buildScene('advhd::ws2', decodeText(ws2Encode(STORY_001)), null, { rel: 'x', stem: 'x', options: {}, config: {} })
  check('没有资源索引（ctx 为空）：台词照常，资源不发指令也不报缺（不是缺资源，是没法查）', noIndex.stats.messages === 6 && !noIndex.steps.flatMap((s) => s.commands).some((c) => ['voice', 'bgm', 'bg', 'stand'].includes(c.op)) && J(noIndex.stats.unresolved) === '{}')
  // 缺资源：删掉 Voice 容器
  const noVoice = path.join(work, 'game-novoice')
  await buildAdvhdFixture(noVoice, { voices: false })
  const missing = await parseGame(noVoice, STORY_001)
  check('缺容器（没有 Voice.arc）：语音 3 个都记 unresolved（stats.unresolved["voice:TW_0001.OGG"]），不发 voice 指令，台词 / 别的资源不受影响', missing.stats.voices.unresolved === 3 && missing.stats.unresolved['voice:TW_0001.OGG'] === 1 && !missing.steps.flatMap((s) => s.commands).some((c) => c.op === 'voice') && missing.stats.bgm.resolved === 1 && missing.stats.messages === 6, J(missing.stats.unresolved))
}
{
  const scene = await parseGame(game, STORY_BRANCH)
  const c1 = scene.steps[0].commands.at(-1)
  check('选项：choice（id = 步序号:指令序号、var、options 值 1..3）挂在问题那句台词的步里（问题留在文本框里）；本脚本跳转的两个选项 → 带 when 的分支，汇合点之后不带 when', scene.steps.length === 5 && c1.op === 'choice' && c1.id === '0:3' && c1.var === 'sel0' && c1.options.length === 3 && c1.options[2].value === 3 && J(textOf(scene)) === J(['選んでください', '（「別の話へ」→ 脚本 OTHER_00 へ続く）', '左の道', '右の道', '合流']), J(textOf(scene)))
  const guardOf = (i) => J([...new Set(scene.steps[i].commands.map((c) => J(c.when)))])
  const g = (op, value) => J([J([{ var: 'sel0', op, value }])])
  check('分支的 when：左 = sel0 == 1，右 = sel0 == 2，别的脚本的选项 = sel0 == 3，汇合之后 = sel0 != 3（选了「跳到别的脚本」就在提示那里结束）；问题那一步没有 when', guardOf(2) === g('==', 1) && guardOf(3) === g('==', 2) && guardOf(1) === g('==', 3) && guardOf(4) === g('!=', 3) && scene.steps[0].commands.every((c) => !c.when), J([0, 1, 2, 3, 4].map(guardOf)))
  const path1 = activePath(scene, { '0:3': 1 })
  const path2 = activePath(scene, { '0:3': 2 })
  const path3 = activePath(scene, { '0:3': 3 })
  const said = (p) => J(p.map((i) => scene.steps[i].commands.filter((c) => c.op === 'text').map((c) => c.segments.map((x) => x.text).join('')).join('')))
  check('播放器按选择走：选 1 = 左 → 合流；选 2 = 右 → 合流；选 3 = 提示 → 结束（没有合流）', said(path1) === J(['選んでください', '左の道', '合流']) && said(path2) === J(['選んでください', '右の道', '合流']) && said(path3) === J(['選んでください', '（「別の話へ」→ 脚本 OTHER_00 へ続く）']), J([path1, path2, path3]))
  check('stats：choices = 1，别的脚本的选项记进 links', scene.stats.choices === 1 && Object.keys(scene.stats.links).some((k) => /choice 3 「別の話へ」→ OTHER_00/.test(k)), J(scene.stats.links))
}
{
  const scene = await parseGame(game, STORY_COND)
  check('条件：SetFlag 设的变量按设的值求值（==1 为真 → 走真的那条）；127 默认 0（flags.values）→ 「127 == 1」为假 → 跳过；ConditionalJump 默认取第二个目标（跳过动画）', J(textOf(scene)) === J(['flag10 = 1 の道', '通常', '終端']) && scene.stats.unvisited === 4, J(textOf(scene)))
  const none = await parseGame(game, STORY_COND, { conditionalJump: 'none' })
  const first = await parseGame(game, STORY_COND, { conditionalJump: 'first' })
  check('options.conditionalJump：none = 不跳（动画 A、B 都走）/ first = 取第一个目标', J(textOf(none)) === J(['flag10 = 1 の道', '通常', 'アニメ A', 'アニメ B', '終端']) && J(textOf(first)) === J(['flag10 = 1 の道', '通常', 'アニメ B', '終端']), J([textOf(none), textOf(first)]))
  const flag = await parseGame(game, STORY_COND, { flags: { values: { 127: 1 } } })
  check('options.flags.values：127 = 1 → 「127 == 1」为真，多出那一句', J(textOf(flag)) === J(['flag10 = 1 の道', '127 = 1 の道（既定では通らない）', '通常', '終端']), J(textOf(flag)))
  const unknown = [['Condition', [2, 55, 1, 0, { ref: 'skip' }]], msg(0, '未知の変数は真'), ['Jump', [{ ref: 'end' }]], { label: 'skip' }, msg(1, '未知の変数は偽'), { label: 'end' }, ['FileEnd', []]]
  const t = await parseGame(game, unknown)
  const f = await parseGame(game, unknown, { flags: { unknown: false } })
  check('没设过的变量：flags.unknown（默认 = 真 → 走 p1（0 = 继续往下）；false = 走 p2）；stats.ignored 记一笔 Condition:unknown-flag', J(textOf(t)) === J(['未知の変数は真']) && J(textOf(f)) === J(['未知の変数は偽']) && t.stats.ignored['Condition:unknown-flag'] === 1, J([textOf(t), textOf(f)]))
  // GetMsgSkip 之后的 if / else 版式：成立 = 往下（StopMusic 0），不成立 = else 块（p1，StopMusic 1）；GetMsgSkip 把 999 写成 0（没在快进）→ 走 else
  const stopsOf = (scene) => scene.steps.flatMap((st) => st.commands).filter((c) => c.op === 'bgmStop').map((c) => c.fade)
  const skipNormal = await parseGame(game, STORY_SKIP)
  const skipOn = await parseGame(game, STORY_SKIP, { functions: { GetMsgSkip: { setFlag: 1 } } })
  const skipUnknown = await parseGame(game, STORY_SKIP.slice(1).map((i) => (i[0] === 'Condition' ? ['Condition', [2, 998, 1, i[1][3], i[1][4]]] : i)))   // 998：没有默认值也没人写过 → flags.unknown（真）→ 往下
  check('Condition 的跳转：成立 = 顺着往下，不成立 = p1（else 块）；GetMsgSkip（functions.GetMsgSkip = { setFlag: 0 }）把 999 写成 0 → 走 else = StopMusic 淡出 1 秒；改成 { setFlag: 1 } → 往下 = StopMusic 0；两种都只走一个块；没有值的变量 998 按 flags.unknown（真）往下', J(stopsOf(skipNormal)) === J([1]) && J(stopsOf(skipOn)) === J([0]) && J(textOf(skipNormal)) === J(['終わり']) && J(stopsOf(skipUnknown)) === J([0]), J([stopsOf(skipNormal), stopsOf(skipOn), stopsOf(skipUnknown)]))
  check('ExecuteFunction 的 setFlag 模式不记 raw（只计 stats.ignored）；没有 p1 的 Condition（只有 p2）= 没有 else：不成立直接跳到结尾', !skipNormal.stats.raw['ExecuteFunction:GetMsgSkip'] && skipNormal.stats.ignored['ExecuteFunction:GetMsgSkip'] === 1)
  const loop = [{ label: 'top' }, msg(0, '一度だけ'), ['Jump', [{ ref: 'top' }]]]
  const looped = await parseGame(game, loop)
  check('死循环的脚本（Jump 回自己）：每条指令只走一次，不会卡死', J(textOf(looped)) === J(['一度だけ']))
  const broken = buildScene('advhd::ws2', '{"format":"advhd-ws2/1","arc":"x","name":"y","truncated":"ws2 偏移 5（opcode 0x7e）：不认识","ins":[]}', null, { rel: 'x', stem: 'x', options: {}, config: {} })
  check('解码被截断的脚本（truncated）：stats.truncated 带原因，不崩，至少有一步', broken.stats.truncated.includes('0x7e') && broken.steps.length === 1)
  let bad = null
  try { buildScene('advhd::ws2', 'not json', null, { rel: 'x', stem: 'x', options: {}, config: {} }) } catch (e) { bad = e }
  check('不是 JSON：报「不是有效的 JSON」', /不是有效的 JSON/.test(bad?.message || ''))
}

// ================= 播放器引擎：bg.pos / bgPan / 缓动 =================
{
  const state = initialState()
  applyCommand(state, { op: 'bg', src: 'a.png', pos: [0, -250] })
  check('engine：bg 带 pos 就记在 state.bg.pos（播放器按原尺寸摆）；没有就没有这个键', J(state.bg) === J({ src: 'a.png', pos: [0, -250] }) && J((() => { const t = initialState(); applyCommand(t, { op: 'bg', src: 'a.png' }); return t.bg })()) === J({ src: 'a.png' }))
  applyCommand(state, { op: 'bgPan', to: [0, -400], seconds: 40, ease: 3, delay: 0.5 })
  check('engine：bgPan → state.bg.offset = 累计偏移，state.bgPan = 这一次的动画 { from, to, seconds, ease, delay }', J(state.bg.offset) === J([0, -400]) && J(state.bgPan) === J({ from: [0, 0], to: [0, -400], seconds: 40, ease: 3, delay: 0.5 }), J(state.bgPan))
  applyCommand(state, { op: 'bgPan', to: [10, 100], seconds: 1, ease: 0 })
  check('engine：再来一次 bgPan 累加（偏移留着：+10 再 -10 回到原位的写法也成立）', J(state.bg.offset) === J([10, -300]) && J(state.bgPan.from) === J([0, -400]))
  applyCommand(state, { op: 'bg', src: 'b.png' })
  check('engine：换背景清掉 offset / bgPan', !state.bg.offset && state.bgPan === null)
  const scene = { steps: [{ commands: [{ op: 'bg', src: 'a.png', pos: [0, -250] }, { op: 'bgPan', to: [0, -400], seconds: 2, ease: 0 }] }] }
  check('engine：stateAt（后退 / 续播的一步到位渲染）= 平移完成后的偏移', J(stateAt(scene, 0).bg.offset) === J([0, -400]))
  applyCommand(initialState(), { op: 'bgPan', to: [1, 1] })   // 没有背景：不炸
  {
    const t = initialState()
    applyCommand(t, { op: 'stand', slot: 'st01', parts: [{ src: 'a.png', x: 0, y: 0 }] })
    applyCommand(t, { op: 'standMove', slot: 'st01', to: [0, 10], seconds: 0.3, ease: 3 })
    applyCommand(t, { op: 'standMove', slot: 'st01', to: [0, -10], seconds: 0.3, ease: 3, delay: 0.1 })
    applyCommand(t, { op: 'standMove', slot: 'nope', to: [5, 5] })
    check('engine：standMove → 槽位的 offset 累计（+10 再 -10 回到 [0, 0]）、moves 记这一步新开的两个动画；没有这个槽位的忽略；再来一次 stand 重置', J(t.stands[0].offset) === J([0, 0]) && t.stands[0].moves.length === 2 && J(t.stands[0].moves[1]) === J({ to: [0, -10], seconds: 0.3, ease: 3, delay: 0.1 }) && (() => { applyCommand(t, { op: 'stand', slot: 'st01', parts: [{ src: 'b.png' }] }); return !t.stands[0].offset && !t.stands[0].moves })())
  }
  const f = (mode) => [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(easeOf(mode, t) * 1000) / 1000)
  check('easeOf：0 线性；1 / 2 / 3 = sine 的 In / Out / InOut；4 / 7 = quad / cubic In；6 = quad InOut；端点 0 → 0、1 → 1（back / elastic 过冲也一样）；超范围的编号按线性', J(f(0)) === J([0, 0.25, 0.5, 0.75, 1]) && J(f(1)) === J([0, 0.076, 0.293, 0.617, 1]) && J(f(2)) === J([0, 0.383, 0.707, 0.924, 1]) && J(f(3)) === J([0, 0.146, 0.5, 0.854, 1]) && J(f(4)) === J([0, 0.063, 0.25, 0.563, 1]) && J(f(7)) === J([0, 0.016, 0.125, 0.422, 1]) && J(f(6)) === J([0, 0.125, 0.5, 0.875, 1]) && [...Array(31).keys()].every((m) => easeOf(m, 0) === 0 || m >= 22) && [...Array(31).keys()].every((m) => Math.abs(easeOf(m, 1) - 1) < 1e-9) && easeOf(99, 0.3) === 0.3, J([f(1), f(4), f(7)]))
}

// ================= 容器展开方式：hybrid（默认）/ files =================
{
  const hyb = { ...FAMILY_CONTAINERS, mode: 'hybrid' }
  const dirH = path.join(work, 'game-hybrid')
  const dirF = path.join(work, 'game-files2')
  await buildAdvhdFixture(dirH)
  await buildAdvhdFixture(dirF)
  const cfgH = cfgWith(hyb)
  const cfgF = cfgWith(FAMILY_CONTAINERS)
  check('containers.mode：默认 hybrid；只认 hybrid / files，别的退回默认并警告', normalizeGalConfig({ containers: { enabled: true } }).containers.mode === 'hybrid' && normalizeGalConfig({ containers: { mode: 'files' } }).containers.mode === 'files' && normalizeGalConfigWithWarnings({ containers: { mode: 'ram' } }).warnings.some((w) => w.field === 'containers.mode'))
  const rep = await ensureContainers({ mediaDir: dirH, config: cfgH })
  await ensureContainers({ mediaDir: dirF, config: cfgF })
  check('hybrid 展开：脚本照常写成 .advhd；PNA 只写 index.json（没有帧 PNG）；图 / 声音 / 视频一个都不写；报告里记 lazy', (await exists(path.join(dirH, 'arc/script/Rio1/001_00.advhd'))) && (await exists(path.join(dirH, 'arc/res/Chip3/ST_TOW_A_M.pna/index.json'))) && !(await exists(path.join(dirH, 'arc/res/Chip3/ST_TOW_A_M.pna/1.png'))) && !(await exists(path.join(dirH, 'arc/res/Chip3/BG_01.png'))) && !(await exists(path.join(dirH, 'arc/res/Voice'))) && rep.arcs['./Chip3.arc'].lazy === 3 && rep.arcs['./Voice.arc'].res === 3, J(rep.arcs['./Chip3.arc']))
  check('files 展开（旧方式）：图 / 声音 / PNA 帧都在磁盘上；两种方式的 PNA index.json 一模一样', (await exists(path.join(dirF, 'arc/res/Chip3/BG_01.png'))) && (await exists(path.join(dirF, 'arc/res/Chip3/ST_TOW_A_M.pna/1.png'))) && (await readFile(path.join(dirH, 'arc/res/Chip3/ST_TOW_A_M.pna/index.json'), 'utf8')) === (await readFile(path.join(dirF, 'arc/res/Chip3/ST_TOW_A_M.pna/index.json'), 'utf8')))
  const v = await virtualFiles({ mediaDir: dirH, config: cfgH })
  check('虚拟索引：列出没展开的资源（图 / 声音 / PNA 帧，含 index.json 没有的帧），files 方式 / 没启用 = 空', ['arc/res/Chip3/BG_01.png', 'arc/res/Chip3/ST_TOW_A_M.pna/1.png', 'arc/res/Voice/TW_0001.ogg', 'arc/res/Bgm/BGM01.ogg', 'arc/res/Se/SE_01.ogg'].every((r) => v.files.includes(r)) && !(await virtualFiles({ mediaDir: dirF, config: cfgF })).files.length && !(await virtualFiles({ mediaDir: dirH, config: normalizeGalConfig({}) })).files.length, J(v.files.slice(0, 12)))
  const n = await materialize({ mediaDir: dirH, config: cfgH, rels: ['arc/res/chip3/bg_01.PNG', 'arc/res/Nope/x.png'] })
  check('materialize：按路径（不分大小写）把那一个条目从 .arc 取出来写成文件（用条目原来的名字）；不在索引里的跳过；取过的不再取', n === 1 && (await readFile(path.join(dirH, 'arc/res/Chip3/BG_01.png'))).equals(pngBytes(1)) && (await materialize({ mediaDir: dirH, config: cfgH, rels: ['arc/res/Chip3/BG_01.png'] })) === 0 && !(await exists(path.join(dirH, 'arc/res/Chip3/EV_01.png'))))
  const both = await Promise.all([1, 2, 3].map(() => materialize({ mediaDir: dirH, config: cfgH, rels: ['arc/res/Voice/TW_0001.ogg'] })))
  check('同一个文件并发请求：只取一次，内容完整', both.every((x) => x === 1) && (await readFile(path.join(dirH, 'arc/res/Voice/TW_0001.ogg'), 'utf8')) === 'OggS-1')
  // 两种方式解析出来的场景完全一样（适配器只认索引里的路径）
  const parseIn = async (dir, cfg, story) => {
    const ctx = await loadAdapterContext({ adapter: galAdapter('advhd::ws2'), mediaDir: dir, config: { ...cfg, adapterOptions: { 'advhd::ws2': {} } } })
    return buildScene('advhd::ws2', decodeText(ws2Encode(story)), ctx, { rel: 'arc/script/Rio1/x.advhd', stem: 'x', options: {}, config: {} })
  }
  let same = true
  for (const story of [STORY_001, STORY_BRANCH, STORY_BOB, STORY_PAN]) {
    const a = await parseIn(dirH, cfgH, story)
    const b = await parseIn(dirF, cfgF, story)
    if (J(a.steps) !== J(b.steps) || J(a.stats) !== J(b.stats)) same = false
  }
  check('同一份脚本在 hybrid 和 files 下解析出来的场景（steps + stats，含立绘帧 / 语音 / 背景 / 缺的资源）逐字节一样', same)
  // 切换方式：hybrid → files 把所有东西展开；files → hybrid 把展开的资源清掉（只剩脚本和 index.json），取出过的缓存也一起清
  await ensureContainers({ mediaDir: dirH, config: cfgWith({ ...FAMILY_CONTAINERS }) })
  check('hybrid → files（回退）：重新展开，图 / 声音 / 帧都在磁盘上', (await exists(path.join(dirH, 'arc/res/Chip3/EV_01.png'))) && (await exists(path.join(dirH, 'arc/res/Chip3/ST_TOW_A_M.pna/2.png'))) && (await exists(path.join(dirH, 'arc/res/Voice/TW_0002.ogg'))))
  invalidateContainers(dirH)
  await ensureContainers({ mediaDir: dirH, config: cfgH })
  check('files → hybrid：重新展开，磁盘上的资源清掉（省空间），脚本和 index.json 还在', !(await exists(path.join(dirH, 'arc/res/Chip3/EV_01.png'))) && !(await exists(path.join(dirH, 'arc/res/Voice'))) && (await exists(path.join(dirH, 'arc/res/Chip3/ST_TOW_A_M.pna/index.json'))) && (await exists(path.join(dirH, 'arc/script/Rio1/001_00.advhd'))))
  // .arc 换了内容：虚拟索引跟着变（签名 = 大小 + mtime）
  await writeFile(path.join(dirH, 'Bgm.arc'), arcBuild([{ name: 'BGM09.ogg', data: Buffer.from('OggS-new9') }]))
  { const t = new Date(Date.now() + 60000); await utimes(path.join(dirH, 'Bgm.arc'), t, t) }
  const v2 = await virtualFiles({ mediaDir: dirH, config: cfgH })
  check('.arc 变了：虚拟索引重建（新条目在、旧条目没了）', v2.files.includes('arc/res/Bgm/BGM09.ogg') && !v2.files.includes('arc/res/Bgm/BGM01.ogg'), J(v2.files.filter((f) => /Bgm/.test(f))))
}

// ================= PNA 帧的种类（image / empty / group / unsupported）=================
{
  const dir = path.join(work, 'game-kinds')
  await buildAdvhdFixture(dir)
  await writeFile(path.join(dir, 'Chip4.arc'), arcBuild([{ name: 'ST_KIND.pna', data: pnaBuild({ width: 600, height: 800, frames: [
    { type: 0, id: 0, x: 10, y: 20, w: 100, h: 200, data: pngBytes(21) },        // 0 图
    { type: 0, id: -1 },                                                          // 1 空帧（没有图像数据）
    { type: 1 }, { type: 2 },                                                     // 2 / 3 组开始 / 结束
    { type: 0, id: 4, x: 0, y: 0, w: 5, h: 5, data: Buffer.from('RIFF\x10\0\0\0WEBPVP8 ') },   // 4 有数据但不是 PNG
    { type: 0, id: 5, x: 5, y: 5, w: 5, h: 5, scale: 0.5, data: pngBytes(22) },    // 5 图（记录里的 f64 = 透明度 0.5）
  ] }) }]))
  const scene = await parseGame(dir, [['ClearLayer', ['*']], ['UsePnaPackage', ['st01', 'ST_KIND.PNA', 1, 1]], ['DisplayCharacterImage', ['st01', 2, 1, 6, 0, 1, 2, 4, 5, 9]], commit(0), msg(0, 'x%K%P'), ['FileEnd', []]])
  const index = JSON.parse(await readFile(path.join(dir, 'arc/res/Chip4/ST_KIND.pna/index.json'), 'utf8'))
  check('PNA 索引每帧带 kind：image / empty / group / unsupported（非 PNG：写成 <序号>.bin，记开头 8 字节 magic 和大小）', J(index.frames.map((f) => f.kind)) === J(['image', 'empty', 'group', 'group', 'unsupported', 'image']) && index.frames[4].magic === '52494646' + '10000000' && (await exists(path.join(dir, 'arc/res/Chip4/ST_KIND.pna/4.bin'))) && !index.frames[4].file, J(index.frames))
  const stand = scene.steps[0].commands.find((c) => c.op === 'stand')
  check('立绘只画有图的帧（0 和 5；按序号从大到小画，和引擎的绘制循环一样，小的在上面）；空帧 / 组标记 / 非 PNG 不画，也不算「没查到」；超出帧数的序号（9）才算没查到；stats.pnaFrames 按种类计数', stand?.parts.length === 2 && stand.parts[0].alpha === 0.5 && stand.parts[1].alpha === undefined && /5\.png$/.test(stand.parts[0].src) && /0\.png$/.test(stand.parts[1].src) && scene.stats.pnaFrames.empty === 1 && scene.stats.pnaFrames.group === 1 && scene.stats.pnaFrames.unsupported === 1 && scene.stats.unresolved['pna-frame:ST_KIND.PNA#9'] === 1 && Object.keys(scene.stats.unresolved).some((k) => /^pna-frame-format:ST_KIND\.PNA#4\(52494646/.test(k)), J([stand, scene.stats.pnaFrames, scene.stats.unresolved]))
}

// ================= 计时器 / 遮罩过渡 / 电影 / CG 画廊 =================
{
  const res = await parseGame(game, STORY_TIMER, { extraDirs: ['movie'] }, { resourceRoots: ['arc/res', 'movie'] })
  const waits = res.steps.flatMap((st) => st.commands).filter((c) => c.op === 'wait').map((c) => c.seconds)
  check('计时器：SetTimer(名, _, 秒) + StartTimer(名) → wait（秒数封顶 timers.max = 10）；没有 SetTimer 的计时器不等', J(waits) === J([2, 10]), J(waits))
  const off = await parseGame(game, STORY_TIMER, { timers: { wait: false } })
  check('options.timers.wait = false：不等', !off.steps.flatMap((st) => st.commands).some((c) => c.op === 'wait'))
  check('过渡类型和遮罩进 stats（都近似成淡入淡出）：Unk65 的类型 0 / 100 各一次，类型 100 前面的 ShowGraphic 遮罩图（EFMSK_12.PNG）记 stats.masks；渐变秒数照用', res.stats.transitions.type0 === 1 && res.stats.transitions.type100 === 1 && res.stats.masks['EFMSK_12.PNG'] === 1 && res.steps[0].commands.find((c) => c.op === 'bg').fade === 0.5 && res.steps[0].commands.filter((c) => c.op === 'bg').at(-1).fade === 0.7, J([res.stats.transitions, res.stats.masks, res.steps[0].commands.filter((c) => c.op === 'bg')]))
  const movies = res.steps.flatMap((st) => st.commands).filter((c) => c.op === 'movie')
  check('电影：extraDirs（游戏目录里的 movie）索引进来，OP.DAT 按名字找到 → movie 指令（资源根里是 OP.DAT）；找不到的 GONE.DAT 记 raw PlayMovie + unresolved', J(movies.map((m) => m.srcs)) === J([['OP.DAT']]) && res.stats.raw.PlayMovie === 1 && res.stats.unresolved['movie:GONE.DAT'] === 1, J([movies, res.stats.raw, res.stats.unresolved]))
  const pan = await parseGame(game, STORY_PAN)
  const panOps = pan.steps.flatMap((st) => st.commands).filter((c) => c.op === 'bg' || c.op === 'bgPan')
  check('长背景图平移：MoveBackground 组 0 = 基准位置 → bg.pos = [0, -250]；DragBackground 把位置读进寄存器；SetRegister（赋值 / 从另一个寄存器加）算出 dy = -400 + (-250) = -650；Effect1 种类 1（位置偏移）→ bgPan { to: [0, -650], seconds: 40, ease: 3, delay: 0.5 }；Effect2（停止）只计数', J(panOps) === J([{ op: 'bg', src: 'Chip3/BG_01.png', pos: [0, -250] }, { op: 'bgPan', to: [0, -650], seconds: 40, ease: 3, delay: 0.5 }]) && pan.stats.effects.pan === 1 && pan.stats.ignored.Effect2 === 1 && !pan.stats.raw.Effect1 && !pan.stats.raw.DragBackground, J([panOps, pan.stats.effects, pan.stats.raw]))
  const addMode = await parseGame(game, [['ClearLayer', ['*']], ['UsePnaPackage', ['st01', 'ST_TOW_A_M.PNA', 1, 1]], ['DisplayCharacterImage', ['st01', 2, 1, 1, 1]], ['DisplayCharacterImage', ['st01', 0, 1, 1, 3]], commit(0), msg(0, 'x'), ['FileEnd', []]])
  const onlyOne = await parseGame(game, [['ClearLayer', ['*']], ['UsePnaPackage', ['st01', 'ST_TOW_A_M.PNA', 1, 1]], ['DisplayCharacterImage', ['st01', 2, 1, 1, 1]], ['DisplayCharacterImage', ['st01', 2, 1, 1, 3]], commit(0), msg(0, 'x'), ['FileEnd', []]])
  const partsOf = (scene) => scene.steps.flatMap((st) => st.commands).find((c) => c.op === 'stand')?.parts.map((p) => p.src.split('/').pop())
  check('DisplayCharacterImage 的第一个 u8：非 0 = 先藏起别的帧（只剩列出来的）；0 = 在已显示的帧上再加', J(partsOf(addMode)) === J(['3.png', '1.png']) && J(partsOf(onlyOne)) === J(['3.png']), J([partsOf(addMode), partsOf(onlyOne)]))
  const bob = await parseGame(game, STORY_BOB)
  const bobOps = bob.steps.flatMap((st) => st.commands).filter((c) => c.op === 'stand' || c.op === 'standMove')
  check('立绘上的 Effect1 种类 1（位置偏移）→ standMove（slot = 图层名；目标 = 寄存器 5 / 6 或立即数；时长 f4 秒；缓动 mode；延迟）；ST_QUAKE 这种带立即数的也一样；一串小动画各一条', J(bobOps.map((c) => c.op)) === J(['stand', 'standMove', 'standMove', 'standMove']) && J(bobOps[1]) === J({ op: 'standMove', slot: 'st01', to: [0, 10], seconds: 0.3, ease: 3 }) && J(bobOps[2]) === J({ op: 'standMove', slot: 'st01', to: [0, -10], seconds: 0.3, ease: 3, delay: 0.1 }) && J(bobOps[3]) === J({ op: 'standMove', slot: 'st01', to: [2, 2], seconds: 0.025, ease: 1 }) && bob.stats.effects.standMove === 3 && !bob.stats.raw['Effect1:kind1'], J(bobOps))
  const flat = await parseGame(game, STORY_001)
  check('基准位置是 (0, 0) 的背景不带 pos（走播放器原来的铺满），别的图层 / 特效种类不变', J(flat.steps[0].commands.find((c) => c.op === 'bg')) === J({ op: 'bg', src: 'Chip3/BG_01.png', fade: 0.5 }))
  const gallery = await parseGame(game, STORY_GALLERY)
  const gTexts = textOf(gallery)
  check('CG 画廊页（CG_PAGE）：不是剧情，按「画廊」读——每个 openCgBrowser 一步（图 + 名字），页码（var 105 的 Condition 值）当说话人；两层图 a/b = bg + over；找不到的图记 unresolved', gallery.stats.gallery.calls === 20 && gallery.steps.length === 20 && gTexts[0] === 'BG_01' && gallery.steps[0].commands.some((c) => c.op === 'speaker' && c.segments[0].text === 'ページ 1') && gallery.steps[0].commands[0].src === 'Chip3/BG_01.png' && J(gallery.steps[2].commands[0]) === J({ op: 'bg', src: 'Chip3/BG_01.png', over: 'Chip3/EV_01.png' }) && gallery.steps[10].commands.some((c) => c.op === 'speaker' && c.segments[0].text === 'ページ 2') && gallery.stats.images.unresolved === 17, J([gallery.stats, gallery.steps.slice(0, 3)]))
  {
    // 画廊按图名前缀拆组（containers.rules[].gallery，末尾 _数字 去掉）：BG_01 / BG_01+EV_01 → BG，EV_01 → EV，NOPE_3…19 → NOPE；每组一个脚本文件，适配器按画廊读（组里只有 1 张也是）
    const adapter = galAdapter('advhd::ws2')
    const ctx = await loadAdapterContext({ adapter, mediaDir: game, config: { ...cfgWith(FAMILY_CONTAINERS), adapterOptions: { 'advhd::ws2': {} } } })
    const groupScene = async (key) => buildScene('advhd::ws2', await readFile(path.join(game, 'arc/script/Rio/CG_PAGE', `${key}.advhd`), 'utf8'), ctx, { rel: `arc/script/Rio/CG_PAGE/${key}.advhd`, stem: key, options: {}, config: {} })
    const bgG = await groupScene('BG')
    const evG = await groupScene('EV')
    const noG = await groupScene('NOPE')
    check('CG 画廊分组：BG 组 2 张（BG_01、BG_01 + EV_01 叠加）、EV 组 1 张、NOPE 组 17 张（图不存在）；每组都按画廊读（1 张的也是）', bgG.steps.length === 2 && J(textOf(bgG)) === J(['BG_01', 'BG_01']) && bgG.steps[1].commands[0].over && evG.steps.length === 1 && evG.steps[0].commands[0].src === 'Chip3/EV_01.png' && noG.steps.length === 17 && bgG.stats.gallery && evG.stats.gallery, J([bgG.steps.length, textOf(bgG), evG.steps.length, noG.steps.length]))
    check('分组里没有别组的图；页码（标记）跟着留下', !textOf(bgG).some((t) => /EV|NOPE/.test(t) && !/BG/.test(t)) && bgG.steps[0].commands.some((c) => c.op === 'speaker'), J(bgG.steps[0].commands))
  }
  const few = await parseGame(game, STORY_GALLERY, { gallery: { minCalls: 99 } })
  check('openCgBrowser 少于 gallery.minCalls：按剧情读（函数在 drop 表里，不记）；gallery.functions = [] 也是', few.stats.gallery === undefined && (await parseGame(game, STORY_GALLERY, { gallery: { functions: [] } })).stats.gallery === undefined)
}

// ================= 家族布局（gal-layout）+ handler 端到端 =================
{
  const media = path.join(work, 'lpsl')
  await buildAdvhdFixture(media)
  const run = (config, options = {}) => generateTags({ item: { itemId: 'x', title: 'x', config, source: { path: media }, adapters: ['advhd::ws2'] }, script: { id: 'gal-layout', version: '2.24.0', options } })
  const out = await run({ game: { id: 'advhd::lpsl' } })
  const cfg = out.itemPatch.gal.config
  check('家族布局：game.id「advhd::lpsl」不在表里 → 按家族 advhd 处理（日志说明），写 脚本根 / 资源根 / 脚本扩展名 / adapterOptions.resDir / containers / limits，game.id 原样写回', cfg.game.id === 'advhd::lpsl' && cfg.scriptRoots[0].dir === 'arc/script' && cfg.resourceRoots[0] === 'arc/res' && J(cfg.scriptExtensions) === J(['advhd']) && cfg.adapterOptions['advhd::ws2'].resDir === 'arc/res' && cfg.containers.enabled === true && cfg.containers.rules.some((r) => r.skip) && cfg.limits.sampleBytes === 262144 && out.logs.some((l) => /按家族「advhd」/.test(l)) && out.details.kind === 'advhd' && out.itemTags.includes('Gal游戏: advhd::lpsl'), J([out.logs.slice(0, 5), cfg.game]))
  check('游戏目录里有 movie 目录：加进资源根（arc/res 之后），适配器 extraDirs 指向它（PlayMovie 的 .DAT 不在 arc 里）', J(cfg.resourceRoots) === J(['arc/res', 'movie']) && J(cfg.adapterOptions['advhd::ws2'].extraDirs) === J(['movie']) && cfg.labels.Rio === 'CG 画廊' && cfg.containers.rules.some((r) => r.include?.includes('^CG_PAGE\\.ws2$')), J([cfg.resourceRoots, cfg.adapterOptions, cfg.labels]))
  const auto = await run({})
  check('没声明 game.id：自动探测（Script*.arc + AdvHD.exe + Rio*.arc），认领成 advhd::<目录名>', auto.itemPatch.gal.config.game.id === 'advhd::lpsl', J(auto.itemPatch.gal.config.game))
  const emptyDir = path.join(work, 'not-advhd')
  await mkdir(emptyDir, { recursive: true })
  await writeFile(path.join(emptyDir, 'Script2.arc'), 'x')
  const noMarkers = await generateTags({ item: { itemId: 'x', title: 'x', config: {}, source: { path: emptyDir } }, script: { id: 'gal-layout', version: '2.24.0', options: {} } })
  check('只有 Script2.arc、没有 AdvHD.exe / Rio*.arc：自动探测不认领（markers 不满足）；声明了 id 才按锚点认', noMarkers.itemPatch?.gal?.config?.game?.id !== 'advhd::lpsl' && !String(noMarkers.itemPatch?.gal?.config?.game?.id || '').startsWith('advhd'))
  const declared = await generateTags({ item: { itemId: 'x', title: 'x', config: { game: { id: 'advhd::other' } }, source: { path: emptyDir } }, script: { id: 'gal-layout', version: '2.24.0', options: {} } })
  check('声明了 advhd::other、目录里有 Script2.arc → 认（锚点够了）', declared.itemPatch?.gal?.config?.game?.id === 'advhd::other')
  const over = await run({ game: { id: 'advhd::lpsl' } }, { layouts: { 'advhd::lpsl': { scriptRoots: [{ id: 'main', dir: 'arc/script/Rio1', label: '本篇' }] } } })
  check('这个游戏自己的差异：选项 layouts["advhd::lpsl"] 叠在家族项之上（只覆盖写了的字段），别的游戏不受影响', over.itemPatch.gal.config.scriptRoots[0].id === 'main' && over.itemPatch.gal.config.containers.enabled === true && (await run({ game: { id: 'advhd::lpsl2' } })).itemPatch.gal.config.scriptRoots[0].id === 'story')
  const overFamily = await run({ game: { id: 'advhd::lpsl' } }, { layouts: { advhd: { notes: [], engine: { containers: { enabled: true, rules: [{ match: '\\.arc$' }] } } } } })
  check('选项 layouts.advhd（家族 key）对家族下所有游戏生效：这里把 containers 规则换成「全收」', overFamily.itemPatch.gal.config.containers.rules.length === 1)
  const again = await generateTags({ item: { itemId: 'x', title: 'x', config: cfg, source: { path: media }, adapters: ['advhd::ws2'] }, script: { id: 'gal-layout', version: '2.24.0', options: {} } })
  check('存进条目再跑一次 = 没有改动（containers 的默认值字段和引擎规整一致，不会被当成改动）', /新增 0 项 \/ 修改 0 项 \/ 删除 0 项/.test(again.logs.join('\n')), again.logs.filter((l) => /本次改动|^[+~-]/.test(l)).join(' | '))
  const { warnings } = normalizeGalConfigWithWarnings(applyGalConfigPatch({}, cfg))
  check('写出来的 config 经引擎规整没有任何警告', warnings.length === 0, J(warnings))

  // handler：导入 → 脚本 → 浏览 → 播放 → 取资源（第一次浏览时服务端读 arc）
  const dataDir = path.join(work, 'data')
  const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => exists(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media, adapters: ['advhd::ws2'] } } }) })
  const imported = await handler.importFromSource({ options: { adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' } } } })
  const item = imported.items[0]
  check('导入：adapters 里的 advhd::ws2 被认；game.id 带 :: 能存', J(item.adapters) === J(['advhd::ws2']) && item.config.game.id === 'advhd::lpsl', J([item.adapters, item.config.game]))
  check('导入本身不碰 arc（只建元数据）', !(await exists(path.join(media, 'arc'))))
  const tagOut = await generateTags({ item, script: { id: 'gal-layout', version: '2.24.0', options: {} } })
  await handler.patchItemMetadata(item.itemId, { gal: tagOut.itemPatch.gal })
  const I = await handler.getItem(item.itemId)
  let warmed = false
  for (let i = 0; i < 100 && !warmed; i++) { warmed = await exists(path.join(media, 'arc/script/Rio1/001_00.advhd')); if (!warmed) await new Promise((r) => setTimeout(r, 50)) }
  check('gal-layout 写好 config（containers 已启用，默认 hybrid）后服务端在后台马上展开 arc 的脚本——不用等第一次打开列表；图 / 声音没有展开（被请求时才取）', I.config.containers?.enabled === true && I.config.containers?.mode === 'hybrid' && warmed && !(await exists(path.join(media, 'arc/res/Chip3/BG_01.png'))))
  const home = (await handler.getReaderContent(I.itemId, 'main', { sectionId: '' })).node
  check('第一次浏览：服务端读 arc 展开，首页 = 容器目录卡片（Rio = CG 画廊、Rio1），不是空的；没有 problems', home.items.map((i) => i.title).join() === 'CG 画廊,Rio1' && !home.problems?.some((p) => p.level === 'error'), J(home.items.map((i) => i.title)))
  const dirNode = (await handler.getReaderContent(I.itemId, 'main', { sectionId: home.items[1].node || home.items[1].id })).node
  const dirScripts = dirNode.items.filter((i) => i.type === 'script')
  check('目录：3 个脚本（readme.txt / Rio.arc 里的辅助脚本不在）；另有一个虚拟目录「特殊场景」（默认规则：脚本名以 _H 结尾），排在最前', dirScripts.map((i) => i.title).join() === '001_00,002_00_H,003_00' && dirNode.items[0].title === '特殊场景' && dirNode.items[0].type === 'dir', J(dirNode.items.map((i) => i.title)))
  const special = (await handler.getReaderContent(I.itemId, 'main', { sectionId: dirNode.items[0].node || dirNode.items[0].id })).node
  check('「特殊场景」里只有 _H 的脚本（002_00_H）；全量列表（上面那个目录）仍有全部 3 个；Rio（CG 画廊）里没有 _H 脚本 = 不出现这个视图', special.items.map((i) => i.title).join() === '002_00_H', J(special.items.map((i) => i.title)))
  const play = await handler.getReaderContent(I.itemId, 'main', { sectionId: dirScripts[0].node || dirScripts[0].id })
  check('播放：scene 来自适配器 advhd::ws2，台词 / 语音 / 背景资源都解析到了 arc 展开的文件；脚本卡片有封面（兜底封面优先 cg：事件图 EV_01）', play.node.kind === 'player' && play.scene.adapter === 'advhd::ws2' && play.scene.stats.voices.resolved === 3 && play.scene.steps[0].commands[0].src === 'Chip3/BG_01.png' && dirScripts[0].thumb === 'Chip3/EV_01.png', J([play.scene.adapter, play.scene.stats.voices, dirScripts[0].thumb]))
  const res = await handler.getResource(I.itemId, play.scene.steps[0].commands[0].src)
  const voice = await handler.getResource(I.itemId, 'Voice/TW_0001.ogg')
  const frame = await handler.getResource(I.itemId, 'Chip3/ST_TOW_A_M.pna/1.png')
  check('取资源：图（image/png）、语音、PNA 的帧 PNG 都能取（路径按资源根 arc/res、名字忽略大小写）；大小写不一致也行', res.body.equals(pngBytes(1)) && res.contentType === 'image/png' && voice.body.toString() === 'OggS-1' && frame.body.equals(pngBytes(11)) && (await handler.getResource(I.itemId, 'chip3/bg_01.PNG')).body.equals(pngBytes(1)))
  const evil = await handler.getResource(I.itemId, '../Rio1.arc').then(() => 'ok', (e) => e.statusCode)
  check('取资源：../ 越界挡住（400）', evil === 400, String(evil))
  // 直接取资源（没经过浏览）也能展开
  const fresh = path.join(work, 'lpsl2')
  await buildAdvhdFixture(fresh)
  const handler2 = createGalHandler({ dataDir: path.join(work, 'data2'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => exists(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: fresh, adapters: ['advhd::ws2'] } } }) })
  const imp2 = (await handler2.importFromSource({ options: { adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' } } } })).items[0]
  const tag2 = await generateTags({ item: imp2, script: { id: 'gal-layout', version: '2.24.0', options: {} } })
  await handler2.internals.updateItem(imp2.itemId, (it) => ({ ...it, config: applyGalConfigPatch(it.config, tag2.itemPatch.gal.config) }))   // 绕过 patchItemMetadata（它会在后台预热展开）
  check('没浏览、也没预热，直接取资源也会先展开 arc（resolveAsset 自己保证；不依赖谁先打开列表页）', !(await exists(path.join(fresh, 'arc'))) && (await handler2.getResource(imp2.itemId, 'Bgm/BGM01.ogg')).body.toString() === 'OggS-bgm')
}
{
  // 容器出问题时列表页的渲染诊断（problems）说清楚；浏览本身不被挡住
  const media = path.join(work, 'broken')
  await buildAdvhdFixture(media, { brokenArc: true })
  const cfg = cfgWith(FAMILY_CONTAINERS)
  const provider = createBrowseProvider({ mediaDir: media, config: cfg, adapters: ['advhd::ws2'], resolveAsset: async () => '' })
  const home = (await provider.getNode('')).node
  const problems = home.problems || []
  check('坏容器：problems 里有 container-failed（指名是哪个容器）；其余容器照常展开、能浏览', problems.some((p) => p.code === 'container-failed' && /Chip9\.arc/.test(p.message)) && home.items.map((i) => i.title).join() === 'Rio,Rio1', J(problems))
  const empty = path.join(work, 'nothing')
  await mkdir(empty, { recursive: true })
  const provider2 = createBrowseProvider({ mediaDir: empty, config: cfgWith(FAMILY_CONTAINERS), adapters: ['advhd::ws2'], resolveAsset: async () => '' })
  const home2 = (await provider2.getNode('')).node
  check('启用了容器但目录里没有 .arc：problems 里 container-empty 提示检查 scan / rules（不是静默空）', (home2.problems || []).some((p) => p.code === 'container-empty'), J(home2.problems))
}

console.log(`\n${pass} passed, ${fail} failed`)
await rm(work, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
