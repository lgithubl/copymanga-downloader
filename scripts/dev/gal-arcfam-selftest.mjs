#!/usr/bin/env node
// 自测（纯 node）：自有 arc（eomaia 引擎）—— 档案条目表（名字混淆 / 压缩 / 截断）、SCRE 事件抽取、适配器 arcfam::scre、容器展开（hybrid）、整条链。全是合成数据。
//   node scripts/dev/gal-arcfam-selftest.mjs
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../../scripts/tag-scripts/gal-layout/main.js'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, virtualEntry, virtualFiles } from '../../web/library/gal/containers.mjs'
import { galAdapterIds, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { readArcfamIndex } from '../../web/library/gal/arcfam.mjs'
import { decodeScre, isScre } from '../../web/library/gal/arcfam-decode.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { Scre, buildArcfam } from './make-arcfam-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const exists = (p) => stat(p).then(() => true, () => false)
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-arcfam-'))

// ---- 档案 ----
{
  const f = path.join(work, 't.arc')
  const entries = [{ name: 'startup.script', data: Buffer.from('SCRE-x') }, { name: 'adv_kohai01.script', data: Buffer.from('abc') }, { name: 'kirara0174.ogg', data: Buffer.from('OggS1') }, { name: '00.bin', data: Buffer.alloc(10, 1), origSize: 100 }, { name: 'Mixed_Case-01.PNG', data: Buffer.from('png') }]
  await writeFile(f, buildArcfam(entries))
  const idx = await readArcfamIndex(f)
  check('自有 arc：条目表（名字按「toupper(c) − 长度 + 下标」还原成大写、大小 / 原大小 / 偏移）；大小 ≠ 原大小可见', J(idx.entries.map((e) => e.name)) === J(['STARTUP.SCRIPT', 'ADV_KOHAI01.SCRIPT', 'KIRARA0174.OGG', '00.BIN', 'MIXED_CASE-01.PNG']) && idx.entries[3].origSize === 100 && idx.entries[3].size === 10 && idx.entries[0].offset > 0, J(idx.entries))
  const whole = await readFile(f)
  check('自有 arc：偏移 / 大小指到的内容对', idx.entries.every((e, i) => whole.subarray(e.offset, e.offset + e.size).equals(entries[i].data)))
  const cut = path.join(work, 'cut.arc'); await writeFile(cut, whole.subarray(0, whole.length - 2))
  const idxCut = await readArcfamIndex(cut)
  check('自有 arc：被截断时超出文件的条目不要（不抛错、不崩）', idxCut.entries.length === 4, J(idxCut.entries.length))
  const bad = async (buf) => { const g = path.join(work, 'bad.arc'); await writeFile(g, buf); return readArcfamIndex(g).then(() => '', (e) => e.message) }
  check('自有 arc：头大小不对 / 条目表对不上 / 名字不是可打印字符 → 抛错', /不合理/.test(await bad(Buffer.from([0xff, 0xff, 0xff, 0x7f, 1, 2, 3, 4, 5, 6, 7, 8]))) && /对不上|不合理/.test(await bad(Buffer.concat([Buffer.from([20, 0, 0, 0]), Buffer.alloc(20, 3)]))) && /可打印|对不上/.test(await bad(Buffer.concat([Buffer.from([18, 0, 0, 0, 5]), Buffer.alloc(5, 0x01), Buffer.alloc(12)]))))
}

// ---- SCRE → 事件 ----
const scre = new Scre()
scre.bg('BG_09A_S.png').bgm('bgm_05.wav').se('se_1_005.wav').narration('地の文その一。').narration('地の文その二。')
  .bg('EV02S1.png').overlay('EV02S_face11.png').overlay('EV02S_moji1.png', 106).voice('rico_0011.ogg').speaker('莉子').say('「こんにちは」')
  .bg('EV02S1.png').overlay('EV02S_face12.png').voice('rico_0012.ogg').say('「二言目」')
  .bg('bg03.png').narration('場面転換。')
const script = scre.build()
{
  const ev = decodeScre(script)
  check('SCRE：isScre / 事件按出现顺序——底图 / bgm / se / 文本 / 底图 + 叠加层 / 语音 / 说话人 / 文本', isScre(script) && ev.map((e) => e[0]).join('') === 'ibsttiiivwtiivtit', ev.map((e) => e[0]).join(''))
  check('SCRE：文本带行号（0x18 的 u32）；说话人去掉【】；资源的方法号 / 文件名对', J(ev[3]) === J(['t', '地の文その一。', 0]) && J(ev.find((e) => e[0] === 'w')) === J(['w', '莉子']) && J(ev[0]) === J(['i', 102, 'BG_09A_S.png']) && J(ev[1]) === J(['b', 'bgm_05.wav']) && J(ev[2]) === J(['s', 'se_1_005.wav']) && J(ev[7]) === J(['i', 106, 'EV02S_moji1.png']), J(ev.slice(0, 9)))
  const bad = (() => { try { decodeScre(Buffer.from('XXXXXXXXXXXXXXXXXXXXXXXXX')); return '' } catch (e) { return e.message } })()
  check('SCRE：魔数不对抛错', /不是 SCRE/.test(bad))
}

// ---- 适配器 ----
const adapter = await import('../../web/library/gal/adapters/arcfam-scre.mjs')
const files = ['arc/res/BG_09A_S.PNG', 'arc/res/EV02S1.PNG', 'arc/res/EV02S_FACE11.PNG', 'arc/res/EV02S_FACE12.PNG', 'arc/res/EV02S_MOJI1.PNG', 'arc/res/BG03.PNG', 'arc/res/BGM_05.WAV', 'arc/res/SE_1_005.WAV', 'arc/res/RICO_0011.OGG', 'arc/res/RICO_0012.OGG']
const json = JSON.stringify({ format: 'arcfam-scre/1', arc: 'script', name: 'ADV01', size: script.length, events: decodeScre(script) })
{
  const ctx = adapter.prepare({ options: {}, files, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
  check('适配器认领：sniff 认 {"format":"arcfam-scre/1"…}；已注册；别的格式不认', adapter.sniff(json) && galAdapterIds().includes('arcfam::scre') && sniffGalAdapter(json) === 'arcfam::scre' && !adapter.sniff('{"format":"bgi-bs/1"}'))
  const scene = adapter.parse(json, ctx)
  const st = scene.steps
  const ops = (i) => st[i].commands.map((c) => c.op)
  check('场景：开头两句旁白——第一步 = bgm + se + bg（视觉变化在台词那一刻提交）+ speaker（空）+ text；资源名大小写忽略（文件名全大写）', J(ops(0)) === J(['bgm', 'se', 'bg', 'speaker', 'text']) && st[0].commands[2].src === 'BG_09A_S.PNG' && st[0].commands[0].src === 'BGM_05.WAV' && J(st[0].commands[3].segments) === J([]) && J(ops(1)) === J(['speaker', 'text']), J(st.slice(0, 2)))
  check('场景：EV 底图 + face + moji 叠加层 → bg + 分槽的 overlay（fit: cover）；语音按出现顺序在前（视觉变化在台词那一刻提交）；说话人只用一次', J(ops(2)) === J(['voice', 'bg', 'overlay', 'overlay', 'speaker', 'text']) && st[2].commands[2].slot === 'face' && st[2].commands[3].slot === 'moji' && st[2].commands[2].fit === 'cover' && J(st[2].commands[4].segments) === J([{ text: '莉子' }]) && J(st[3].commands.find((c) => c.op === 'speaker').segments) === J([]), J(st[2]))
  check('场景：同一张底图再发一次（引擎每句都发）不重复出 bg；同种类的叠加层（face11 → face12）= 换一张，moji 没再发 = 因底图重发被收掉', st[3].commands.filter((c) => c.op === 'bg').length === 0 && st[3].commands.some((c) => c.op === 'overlay' && c.slot === 'face' && c.src === 'EV02S_FACE12.PNG'), J(st[3]))
  check('场景：换底图（bg03）= 先 overlayOff 再 bg；stats —— 台词 4（含 2 句旁白 + 1 句转场）/ 语音 2 / 都解析出来', st.at(-1).commands.slice(0, 2).map((c) => c.op).join() === 'overlayOff,bg' && scene.stats.messages === 5 && scene.stats.voices.resolved === 2 && scene.stats.images.unresolved === 0 && scene.stats.bgm.resolved === 1, J([st.at(-1), scene.stats]))
  const partial = adapter.parse(json, adapter.prepare({ options: {}, files: ['arc/res/BG03.PNG'], toResourcePath: (r) => r.replace(/^arc\/res\//, '') }))
  check('缺资源：索引里没有的图 / 声音记进 stats.unresolved，场景照常出', partial.stats.unresolved['image:EV02S1.png'] >= 1 && partial.stats.unresolved['voice:rico_0011.ogg'] === 1 && partial.steps.length === st.length, J(partial.stats.unresolved))
}

// ---- 脚本去向：末尾 1 个引用 = next；末尾并排多个 = 选择；中间的只记 links ----
{
  const ctx = adapter.prepare({ options: {}, files, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
  const run = (sc) => adapter.parse(JSON.stringify({ format: 'arcfam-scre/1', arc: 'script', name: 'X', size: 0, events: decodeScre(sc.build()) }), ctx)
  const one = run(new Scre().narration('一つ目の文。').ref('adv_kohai_h01.script').narration('二つ目の文。').ref('adv_kohai03.script'))
  check('脚本去向：末尾只有一个引用 = scene.next（中间的 H 场景引用只记 stats.links，不影响）', J(one.next) === J({ script: 'adv_kohai03' }) && one.stats.links['script:adv_kohai_h01'] === 1 && !one.steps.flatMap((s) => s.commands).some((c) => c.op === 'goto'), J([one.next, one.stats.links]))
  const two = run(new Scre().narration('分かれ道').ref('adv_kohai08a.script').ref('adv_kohai08b.script'))
  const ch = two.steps.flatMap((s) => s.commands).find((c) => c.op === 'choice')
  const gotos = two.steps.flatMap((s) => s.commands).filter((c) => c.op === 'goto')
  check('脚本去向：末尾并排两个引用 = 路线分支：choice（选项文字 = 脚本名大写，挂在最后一句台词的步里）+ 带 when 的 goto；没有 scene.next', Boolean(ch) && J(ch.options.map((o) => o.segments[0].text)) === J(['ADV_KOHAI08A', 'ADV_KOHAI08B']) && gotos.length === 2 && gotos[0].script === 'adv_kohai08a' && J(gotos[1].when) === J([{ var: ch.var, op: '==', value: 2 }]) && two.next === undefined && J(two.steps[0].commands.at(-1).op) === J('choice'), J(two.steps))
  const none = run(new Scre().narration('終わりの文。'))
  check('脚本去向：没有引用 = 没有 next', none.next === undefined)
}

// ---- 容器 + 整条链 ----
const media = path.join(work, 'game')
await mkdir(media, { recursive: true })
await writeFile(path.join(media, 'game.exe'), 'MZ')
await writeFile(path.join(media, 'systeminfo.json'), '{}')
await writeFile(path.join(media, 'script.arc'), buildArcfam([{ name: 'startup.script', data: Buffer.from('not a scre but fine') }, { name: 'adv01.script', data: script }, { name: 'adv02.script', data: new Scre().narration('二つ目の脚本。').build() }, { name: 'fk001.mes', data: Buffer.alloc(8, 1), origSize: 80 }, { name: 'setting.lib', data: Buffer.from('lib') }]))
await writeFile(path.join(media, 'image.arc'), buildArcfam(files.filter((f) => /PNG$/.test(f)).map((f) => ({ name: f.replace('arc/res/', ''), data: Buffer.from(`PNG:${f}`) }))))
await writeFile(path.join(media, 'voice.arc'), buildArcfam([{ name: 'rico_0011.ogg', data: Buffer.from('OggS-v11') }, { name: 'rico_0012.ogg', data: Buffer.from('OggS-v12') }]))
await writeFile(path.join(media, 'music.arc'), buildArcfam([{ name: 'bgm_05.wav', data: Buffer.from('RIFF-bgm') }]))
await writeFile(path.join(media, 'effect.arc'), buildArcfam([{ name: 'se_1_005.wav', data: Buffer.from('RIFF-se') }]))
await writeFile(path.join(media, 'data.arc'), buildArcfam([{ name: 'adv_cgmode.json', data: Buffer.from('{}') }]))
const layoutItem = { itemId: 'a', title: 'a', config: { game: { id: 'arcfam::test' } }, source: { path: media }, adapters: ['arcfam::scre'] }
const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.30.0', options: {} } })
const cfgRaw = tagOut.itemPatch.gal.config
const cfg = normalizeGalConfig(cfgRaw)
check('gal-layout：认出 arcfam（id = arcfam::test），containers = arcfam / flat / hybrid / arcfam-scre；脚本根 arc/script、资源根 arc/res；适配器 arcfam::scre', cfg.containers.enabled && cfg.containers.format === 'arcfam' && cfg.containers.flat === true && cfg.containers.mode === 'hybrid' && cfg.containers.scriptDecoder === 'arcfam-scre' && cfg.containers.scriptExt === 'arcfam' && cfg.scriptRoots[0].dir === 'arc/script' && J(cfg.resourceRoots) === J(['arc/res']) && cfg.adapterOptions['arcfam::scre']?.resDir === 'arc/res', J(cfg.containers))
{
  const other = path.join(work, 'other'); await mkdir(other); await writeFile(path.join(other, 'x.exe'), 'MZ'); await writeFile(path.join(other, 'systeminfo.json'), '{}'); await writeFile(path.join(other, 'image.arc'), 'x'); await writeFile(path.join(other, 'script.arc'), Buffer.concat([Buffer.from([9, 0, 0, 0]), Buffer.alloc(40, 0x30)]))
  const none = await generateTags({ item: { itemId: 'n', title: 'n', config: {}, source: { path: other } }, script: { id: 'gal-layout', version: '2.30.0', options: {} } })
  check('gal-layout：没声明 game.id 且 script.arc 的条目表对不上 → 不认领', !JSON.stringify(none.itemPatch?.gal?.config || {}).includes('arcfam'), J(none.itemPatch?.gal?.config?.game))
}
{
  const again = await generateTags({ item: { ...layoutItem, config: cfgRaw }, script: { id: 'gal-layout', version: '2.30.0', options: {} } })
  check('gal-layout：存进条目再跑一次 = 没有改动', /新增 0 项 \/ 修改 0 项 \/ 删除 0 项/.test(again.logs.join('\n')), again.logs.filter((l) => /本次改动/.test(l)).join(' | '))
}
{
  const report = await ensureContainers({ mediaDir: media, config: cfg })
  const rep = report.arcs
  const text = await readFile(path.join(media, 'arc/script/script/ADV01.arcfam'), 'utf8')
  check('展开：.SCRIPT 解成事件流 JSON 展开到 arc/script/<arc 名>/<脚本>.arcfam；压缩的（.MES）数进 unsupported；lib / json 不展开；图 / 声音一个都没落盘', JSON.parse(text).format === 'arcfam-scre/1' && (await exists(path.join(media, 'arc/script/script/ADV02.arcfam'))) && !(await exists(path.join(media, 'arc/script/script/SETTING.arcfam'))) && !(await exists(path.join(media, 'arc/res'))) && Object.values(rep).some((r) => r.unsupported === 1), J(rep))
  const vf = await virtualFiles({ mediaDir: media, config: cfg })
  check('虚拟索引（flat）：png / ogg / wav 在 arc/res/<名字>（大写）；脚本 / json 不在', J([...vf.files].sort()) === J([...files.filter((f) => /PNG$/.test(f)), 'arc/res/RICO_0011.OGG', 'arc/res/RICO_0012.OGG', 'arc/res/BGM_05.WAV', 'arc/res/SE_1_005.WAV'].sort()), J(vf.files))
  const entry = await virtualEntry({ mediaDir: media, config: cfg, rels: ['arc/res/RICO_0011.OGG'] })
  check('virtualEntry.read()：原样给出（自有 arc 的资源没有加密）', (await entry.read()).toString() === 'OggS-v11')
  const n = await materialize({ mediaDir: media, config: cfg, rels: ['arc/res/BGM_05.WAV'] })
  check('取出（materialize）', n === 1 && (await readFile(path.join(media, 'arc/res/BGM_05.WAV'), 'utf8')) === 'RIFF-bgm')
}
{
  const dataDir = path.join(work, 'data')
  const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => exists(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media, adapters: ['arcfam::scre'] } } }) })
  const imported = await handler.importFromSource({ options: { adapters: ['arcfam::scre'], config: { game: { id: 'arcfam::test' } } } })
  const item = imported.items[0]
  const out = await generateTags({ item, script: { id: 'gal-layout', version: '2.30.0', options: {} } })
  await handler.internals.updateItem(item.itemId, (it) => ({ ...it, config: { ...it.config, ...out.itemPatch.gal.config } }))
  const id = item.itemId
  const home = (await handler.getReaderContent(id, 'main', { sectionId: '' })).node
  const dir = (await handler.getReaderContent(id, 'main', { sectionId: home.items[0].node || home.items[0].id })).node
  check('列表：首页 = arc 目录卡片（script），里面是剧本 ADV01 / ADV02（STARTUP 里没有文本也列出来）', home.items.map((i) => i.title).join() === 'script' && dir.items.some((i) => i.title === 'ADV01') && dir.items.some((i) => i.title === 'ADV02'), J([home.items.map((i) => i.title), dir.items.map((i) => i.title)]))
  const adv = dir.items.find((i) => i.title === 'ADV01')
  const play = await handler.getReaderContent(id, 'main', { sectionId: adv.node || adv.id })
  check('播放：scene 来自适配器 arcfam::scre；5 句台词', play.node.kind === 'player' && play.scene.adapter === 'arcfam::scre' && play.scene.stats.messages === 5, J([play.node?.kind, play.scene?.adapter, play.scene?.stats?.messages]))
  const bg = play.scene.steps[0].commands.find((c) => c.op === 'bg')
  const res = await handler.getResource(id, bg.src)
  const cacheFiles = (await readdir(path.join(dataDir, 'cache', 'gal-arc-res'), { recursive: true }).catch(() => [])).filter((f) => /\.png$/i.test(f))
  check('取资源：背景 = 档案里的字节，放进缓存目录 gal-arc-res（媒体目录 arc/res 里没有这张）', (res.body ? res.body : await readFile(res.file)).toString() === 'PNG:arc/res/BG_09A_S.PNG' && cacheFiles.length >= 1 && !(await exists(path.join(media, 'arc/res/BG_09A_S.PNG'))), J(cacheFiles))
  const voice = play.scene.steps[2].commands.find((c) => c.op === 'voice')
  check('取资源：语音（大小写不同的名字 rico_0011.ogg → RICO_0011.OGG）能取到', (await handler.getResource(id, voice.src)).body.toString() === 'OggS-v11', J(voice))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
