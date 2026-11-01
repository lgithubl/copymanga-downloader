// KiriKiri Z（Hxv4）整条链（合成数据）：脚本解码（PSB 根 → krkr-scn/1）→ 适配器（场景）→ 容器（xp3 解密展开 / 虚拟索引 / 取资源）→ gal-layout 认出 krkr
// 真实样本（可选）：KRKR_SAMPLE=<含 scn.xp3 的目录>:<密钥包.json>：解整个 scn.xp3，每个剧本都过解码器 + 适配器
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import * as adapter from '../../web/library/gal/adapters/krkr-scn.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, setKeysFile, virtualEntry, virtualFiles } from '../../web/library/gal/containers.mjs'
import { decodeKrkrScn } from '../../web/library/gal/krkr-scn.mjs'
import { galAdapterIds, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { buildHxv4Xp3, buildPsb, makeBundle } from './make-krkr-fixture.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = (v) => JSON.stringify(v)

// ---- 合成剧本（PSB 的根）----
const layer = (name, cls, file, show = 3, options) => [name, cls, { class: cls, name, redraw: { imageFile: { file, ...(options ? { options } : {}) }, posName: null }, showmode: show, action: [['ypos', 10], ['bogus', 1]] }]
const bgm = (file, state) => ['bgm', 'bgm', { name: 'bgm', replay: { filename: file, state, volume: 100, loop: 1 } }]
const text = (speaker, line, voice, data) => [speaker, [[null, line, 20]], voice ? [{ name: speaker, pan: 0, type: 0, voice }] : null, 192, { data }]
const root = {
  name: 's1.txt',
  scenes: [
    { label: '*init', title: '', nexts: [{ storage: 's1.txt', target: '*main', type: 0 }], lines: [], texts: [] },
    {
      label: '*main', title: '',
      nexts: [{ storage: 's2.txt', target: '*start', type: 0 }],
      texts: [
        text(null, '第一行\\n第二行', null, [layer('bg', 'stage', 'bg01'), bgm('bgm1', 1), layer('A', 'character', 'cha001.stand', 3, { face: '微笑' }), layer('fill', 'udmask', 'x')]),
        text('A', '「你好」', 'v001', [layer('bg', 'stage', 'bg01'), bgm('bgm1', 1), layer('ev', 'event', 'ev01')]),
        text('A', '「再见」', 'v002', [layer('bg', 'stage', 'width,1,height,1,color,0xff102030'), layer('ev', 'event', 'ev01', 0), bgm('bgm1', 0)]),
      ],
      lines: [
        ['startline', 'vflag', 0, 'name', '', 'text', 1], 1, [3, 1, 2, null, 34, 192, null, null],
        ['playvoice', 'loop', 1, 'name', 'A', 'type', 2, 'voice', 'bgv_a'],
        ['startline', 'vflag', 0, 'name', 'A', 'text', 1], 2, [4, 2, 3, null, 36, 192, null, null],
        ['wait', 'time', '500'],
        ['startline', 'vflag', 0, 'name', 'A', 'text', 1], 3, [5, 3, null, null, 36],
        ['startline'],
        [9, { data: [layer('bg', 'stage', 'black')] }],
        ['wait', 'time', '1200'],
      ],
    },
  ],
}
const decoded = decodeKrkrScn(root, { arc: 'scn' })
const out = JSON.parse(decoded.text)
const steps = out.scenes[1].steps
check('脚本解码：一句台词一步（n - 1 取 texts）；说话人 / 语音 / 文字（\\n 换行）；只留 stage / character / event 这类图层', decoded.name === 's1' && steps.length === 4 && steps[0].t === '第一行\n第二行' && !steps[0].n && steps[1].n === 'A' && steps[1].v === 'v001' && steps[0].l.length === 2 && steps[0].l.every((l) => ['stage', 'character'].includes(l[1])) && J(steps[0].l[1].slice(0, 4)) === J(['A', 'character', 'cha001.stand', { face: '微笑' }]), J(steps))
check('脚本解码：图层的动作只留认识的（ypos），未知的丢掉；bgm = [文件, 状态, 音量, 循环]', J(steps[0].l[0][6]) === J([['ypos', 10]]) && J(steps[0].b) === J(['bgm1', 1, 100, 1]), J(steps[0]))
check('脚本解码：没有台词的「等待 + 画面变了」出一个无台词的步（pre 带 wait）；背景语音 playvoice 记进 pre', steps[3].t === undefined && J(steps[3].pre.at(-1)) === J(['wait', 1200]) && J(steps[1].pre) === J([['bgv', 'bgv_a', 1]]) && J(steps[2].pre) === J([['wait', 500]]), J(steps.map((s) => s.pre)))
check('脚本解码：refs = 引用的图（去掉扩展名；纯色 width,1,height,1,color,… 不是文件名，不算）/ bgm / 语音', J(decoded.refs.img.sort()) === J(['bg01', 'black', 'cha001', 'ev01']) && J(decoded.refs.bgm) === J(['bgm1']) && J(decoded.refs.voice.sort()) === J(['bgv_a', 'v001', 'v002']), J(decoded.refs))

// ---- 适配器 ----
const files = ['arc/res/bg01.png', 'arc/res/ev01.jpg', 'arc/res/black.png', 'arc/res/v001.ogg', 'arc/res/bgm1.ogg']
const ctx = adapter.prepare({ options: {}, files, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
const scene = adapter.parse(decoded.text, ctx)
const cmds = (i) => scene.steps[i].commands
check('适配器认领：sniff 认 {"format":"krkr-scn/1"…}；已注册', adapter.sniff(decoded.text) && galAdapterIds().includes('krkr::scn') && sniffGalAdapter(decoded.text) === 'krkr::scn' && !adapter.sniff('{"format":"bgi-bs/1"}'))
check('适配器：第一步 = bg + bgm + speaker（旁白清空）+ text；立绘这一版不渲染（记 stats.ignored.character）', J(cmds(0).map((c) => c.op)) === J(['bg', 'bgm', 'speaker', 'text']) && cmds(0)[0].src === 'bg01.png' && cmds(0)[1].src === 'bgm1.ogg' && scene.stats.ignored.character === 1, J(cmds(0)))
check('适配器：事件 CG（ev）盖在背景上 = 换 bg；语音 = voice；同样的 bgm 不重复发', J(cmds(1).map((c) => c.op)) === J(['bg', 'voice', 'speaker', 'text']) && cmds(1)[0].src === 'ev01.jpg' && cmds(1)[1].src === 'v001.ogg', J(cmds(1)))
check('适配器：纯色背景（width,1,height,1,color,0xff102030）= bg.color；ev 隐藏 = 回到背景；bgm 状态 0 = bgmStop；pre 的 wait = wait；缺的语音记 unresolved', J(cmds(2).slice(0, 3)) === J([{ op: 'wait', seconds: 0.5 }, { op: 'bg', color: [16, 32, 48] }, { op: 'bgmStop', fade: 1 }]) && scene.stats.unresolved['voice:v002'] === 1, J(cmds(2)))
check('适配器：无台词的步（黑屏 + 等待）= bg + wait + 空文本；末尾 nexts 指向别的脚本 = scene.next', scene.steps.length === 4 && cmds(3).some((c) => c.op === 'bg') && cmds(3).some((c) => c.op === 'wait') && J(scene.next) === J({ script: 's2' }), J([cmds(3), scene.next]))
check('适配器：nexts 指回菜单（gameloop）= 没有 next', adapter.parse(JSON.stringify({ ...out, scenes: [{ ...out.scenes[1], nexts: [{ storage: 'gameloop.txt', target: '*home', type: 0 }] }] }), ctx).next === undefined)

// ---- 容器（合成 xp3）----
const work = await mkdtemp(path.join(os.tmpdir(), 'krkr-chain-'))
try {
  const bundle = makeBundle('chain')
  const media = path.join(work, 'Game')
  await mkdir(media, { recursive: true })
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 5)])
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200, 9)])
  await writeFile(path.join(media, 'scn.xp3'), buildHxv4Xp3([['/', 's1.txt.scn', buildPsb(root)]], bundle))
  await writeFile(path.join(media, 'data.xp3'), buildHxv4Xp3([['/', 'bg01.png', png], ['/', 'black.png', png], ['/', 'unused.png', png]], bundle))
  await writeFile(path.join(media, 'voice.xp3'), buildHxv4Xp3([['/', 'v001.ogg', ogg], ['/', 'bgm1.ogg', ogg]], bundle))
  await writeFile(path.join(media, 'game.exe'), 'MZ')
  const keysFile = path.join(work, 'gal-krkr-keys.json')
  await writeFile(keysFile, J([bundle]), { mode: 0o600 })
  setKeysFile(keysFile)
  // gal-layout 认出 krkr（scn.xp3 里有 Hxv4 描述符 + data.xp3 在）
  const layoutItem = { itemId: 'k', title: 'k', config: { game: { id: 'krkr::chain' } }, source: { path: media }, adapters: ['krkr::scn'] }
  const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.34.0', options: {} } })
  const cfgRaw = tagOut.itemPatch?.gal?.config
  const norm = cfgRaw ? normalizeGalConfigWithWarnings(cfgRaw) : null
  check('gal-layout：认出 krkr（id = krkr::chain），containers = krkr / hybrid / flat，scn.xp3 = 脚本、别的 xp3 = 资源；资源根 arc/res；写出来的 config 规整后零警告', Boolean(norm) && norm.config.containers.format === 'krkr' && norm.config.containers.scriptDecoder === 'krkr-scn' && norm.config.containers.mode === 'hybrid' && J(norm.config.resourceRoots) === J(['arc/res']) && norm.warnings.length === 0 && !('keys' in norm.config.containers), J([norm?.warnings, norm?.config?.containers]))
  const noHx = await generateTags({ item: { ...layoutItem, source: { path: (await (async () => { const d = path.join(work, 'Plain'); await mkdir(d, { recursive: true }); await writeFile(path.join(d, 'scn.xp3'), 'not an xp3'); await writeFile(path.join(d, 'data.xp3'), 'x'); return d })()) } }, script: { id: 'gal-layout', version: '2.34.0', options: {} } })
  check('gal-layout：scn.xp3 不是 Hxv4 加密的 xp3 = 不认', !noHx.itemPatch?.gal?.config?.containers, J(noHx.logs))
  const config = norm.config
  const report = await ensureContainers({ mediaDir: media, config })
  check('展开：scn.xp3 里的 PSB 解密 → 压成 krkr-scn/1 展开到 arc/script/scn/<名字>.krkr；资源 xp3 不展开；refs 写进 arc/refs/scn/names.json', report.arcs['./scn.xp3']?.scripts === 1 && !report.arcs['./data.xp3']?.error && JSON.parse(await readFile(path.join(media, 'arc/script/scn/s1.krkr'), 'utf8')).format === 'krkr-scn/1' && JSON.parse(await readFile(path.join(media, 'arc/refs/scn/names.json'), 'utf8')).img.includes('bg01'), J(report.arcs))
  const vf = await virtualFiles({ mediaDir: media, config })
  check('虚拟索引：refs 里的名字 × 扩展名算哈希，在 xp3 的特殊索引里命中的才有（bg01.png / black.png / v001.ogg / bgm1.ogg；没被引用的 unused.png 没有）', J([...vf.files].sort()) === J(['arc/res/bg01.png', 'arc/res/bgm1.ogg', 'arc/res/black.png', 'arc/res/v001.ogg']), J(vf.files))
  const n = await materialize({ mediaDir: media, config, rels: ['arc/res/bg01.png'] })
  check('取资源：解密后逐字节一致（materialize 落盘）；virtualEntry.read 同样', n === 1 && (await readFile(path.join(media, 'arc/res/bg01.png'))).equals(png) && (await (await virtualEntry({ mediaDir: media, config, rels: ['arc/res/v001.ogg'] })).read()).equals(ogg))
  // 没有密钥 = 报告里有原因、不抛
  setKeysFile(path.join(work, 'nope.json'))
  const media2 = path.join(work, 'Game2')
  await mkdir(media2, { recursive: true })
  await writeFile(path.join(media2, 'scn.xp3'), buildHxv4Xp3([['/', 's1.txt.scn', buildPsb(root)]], bundle))
  const report2 = await ensureContainers({ mediaDir: media2, config })
  check('没有密钥包：报告里写原因（没有密钥包…），不抛', /没有密钥包/.test(report2.arcs['./scn.xp3']?.error || ''), J(report2.arcs))
  // config.containers.keys 优先、规整（大写 hex 变小写；不完整的丢掉并警告，不显示内容）
  const w = normalizeGalConfigWithWarnings({ containers: { enabled: true, format: 'krkr', scriptDecoder: 'krkr-scn', keys: [{ ...bundle, key: bundle.key.toUpperCase() }, { params: 'zz' }] } })
  check('config.containers.keys：规整成小写 hex；不完整的丢掉并警告（警告里不带密钥内容）', w.config.containers.keys?.length === 1 && w.config.containers.keys[0].key === bundle.key && w.warnings.some((x) => x.field === 'containers.keys' && !String(x.snippet).includes(bundle.key)), J(w.warnings))
} finally { await rm(work, { recursive: true, force: true }) }

// ---- 真实样本（可选）----
if (process.env.KRKR_SAMPLE) {
  const [dir, bundlePath] = process.env.KRKR_SAMPLE.split(':')
  const { openHxv4Archive } = await import('../../web/library/gal/krkr-hxv4.mjs')
  const { decodeKrkrScnBuffer } = await import('../../web/library/gal/krkr-scn.mjs')
  const { isPsb } = await import('../../web/library/gal/psb.mjs')
  const arc = await openHxv4Archive(path.join(dir, 'scn.xp3'), JSON.parse(await readFile(bundlePath, 'utf8')))
  let scripts = 0
  let messages = 0
  let crashed = 0
  for (const e of arc.entries) {
    if (!e.meta || e.hxv4Id === 0) continue
    const data = await arc.readEntry(e)
    if (!isPsb(data)) continue
    try { const r = decodeKrkrScnBuffer(data, { arc: 'scn' }); const s = adapter.parse(r.text, null); scripts += 1; messages += s.stats.messages } catch { crashed += 1 }
  }
  await arc.close()
  check(`真实样本 ${dir}：${scripts} 个剧本全部过解码器 + 适配器（${messages} 句台词），没有出错`, crashed === 0 && scripts > 0, `crashed ${crashed}`)
} else console.log('SKIP 真实样本（KRKR_SAMPLE=<目录>:<密钥包.json> 才跑）')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
