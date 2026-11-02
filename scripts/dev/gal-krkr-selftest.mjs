// KiriKiri Z（Hxv4）整条链（合成数据）：脚本解码（PSB 根 → krkr-scn/1）→ 适配器（场景）→ 容器（xp3 解密展开 / 虚拟索引 / 取资源）→ gal-layout 认出 krkr
// 真实样本（可选）：KRKR_SAMPLE=<含 scn.xp3 的目录>:<密钥包.json>：解整个 scn.xp3，每个剧本都过解码器 + 适配器
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { inflateSync } from 'node:zlib'
import path from 'node:path'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import * as adapter from '../../web/library/gal/adapters/krkr-scn.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, setKeysFile, virtualEntry, virtualFiles } from '../../web/library/gal/containers.mjs'
import { decodeKrkrScn } from '../../web/library/gal/krkr-scn.mjs'
import { galAdapterIds, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { parseSinfo, parseStandInfo, pickPimgLayers, pimgInfo } from '../../web/library/gal/krkr-pimg.mjs'
import { decodeTlg, tlgToPng } from '../../web/library/gal/tlg.mjs'
import { Psb } from '../../web/library/gal/psb.mjs'
import { encodePng } from '../../web/library/gal/bgi.mjs'
import { createRequire } from 'node:module'
import { crc32 } from 'node:zlib'
import { buildHxv4Xp3, buildPsb, encodeKirikiriText, encodeTlg5, makeBundle } from './make-krkr-fixture.mjs'
import { buildKtx, buildTinyMoc3, buildZip } from './make-moc3-fixture.mjs'

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

// 带 oFFs 块（左上角位置）的 PNG：KiriKiri 的叠加层 PNG 就是这样自带摆放位置
function pngWithOffset(width, height, rgba, x, y) {
  const png = encodePng(width, height, 4, rgba)
  const data = Buffer.alloc(9)
  data.writeInt32BE(x, 0)
  data.writeInt32BE(y, 4)
  const type = Buffer.from('oFFs')
  const chunk = Buffer.alloc(12 + 9)
  chunk.writeUInt32BE(9, 0)
  type.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 17)
  const at = 8 + 12 + 13   // 签名 + IHDR 块
  return Buffer.concat([png.subarray(0, at), chunk, png.subarray(at)])
}
const sharpLib = (() => { try { return createRequire(new URL('../../web/package.json', import.meta.url))('sharp') } catch { return null } })()

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
        ['envupdate', 'update', [], 'wait', { list: [null, { mode: 0, name: 'ev' }] }, 'trans', { method: 'crossfade', time: 1000 }],
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
check('脚本解码：envupdate 里 "trans" 后面的转场（方式 / 毫秒 / 遮罩）挂在下一个台词步上（tr），用掉就清', J(steps[1].tr) === J(['crossfade', 1000, '']) && steps[0].tr === undefined && steps[2].tr === undefined, J(steps.map((s) => s.tr)))
check('脚本解码：refs = 引用的图（去掉扩展名；纯色 width,1,height,1,color,… 不是文件名，不算）/ bgm / 语音', J(decoded.refs.img.sort()) === J(['bg01', 'black', 'cha001', 'ev01']) && J(decoded.refs.bgm) === J(['bgm1']) && J(decoded.refs.voice.sort()) === J(['bgv_a', 'v001', 'v002']), J(decoded.refs))

// ---- 适配器 ----
const files = ['arc/res/bg01.png', 'arc/res/ev01.jpg', 'arc/res/black.png', 'arc/res/v001.ogg', 'arc/res/bgm1.ogg']
const ctx = adapter.prepare({ options: {}, files, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
const scene = adapter.parse(decoded.text, ctx)
const cmds = (i) => scene.steps[i].commands
check('适配器认领：sniff 认 {"format":"krkr-scn/1"…}；已注册', adapter.sniff(decoded.text) && galAdapterIds().includes('krkr::scn') && sniffGalAdapter(decoded.text) === 'krkr::scn' && !adapter.sniff('{"format":"bgi-bs/1"}'))
check('适配器：第一步 = bg + bgm + speaker（旁白清空）+ text；立绘这一版不渲染（记 stats.ignored.character）', J(cmds(0).map((c) => c.op)) === J(['bg', 'bgm', 'speaker', 'text']) && cmds(0)[0].src === 'bg01.png' && cmds(0)[1].src === 'bgm1.ogg' && scene.stats.ignored.character === 1, J(cmds(0)))
check('适配器：事件 CG（ev）盖在背景上 = 换 bg；语音 = voice；同样的 bgm 不重复发', J(cmds(1).map((c) => c.op)) === J(['bg', 'voice', 'speaker', 'text']) && cmds(1)[0].src === 'ev01.jpg' && cmds(1)[1].src === 'v001.ogg', J(cmds(1)))
check('适配器：转场 = 换背景 / 事件图时的 fade 秒数（crossfade 1000ms → fade 1；没有转场的步不带 fade）；方式记 stats.transitions；transitionMax 封顶', cmds(1)[0].fade === 1 && cmds(0)[0].fade === undefined && scene.stats.transitions.crossfade === 1 && adapter.parse(decoded.text, adapter.prepare({ options: { transitionMax: 0.4 }, files, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })).steps[1].commands[0].fade === 0.4, J(cmds(1)))
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
  const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
  const cfgRaw = tagOut.itemPatch?.gal?.config
  const norm = cfgRaw ? normalizeGalConfigWithWarnings(cfgRaw) : null
  check('gal-layout：认出 krkr（id = krkr::chain），containers = krkr / hybrid / flat，scn.xp3 = 脚本、别的 xp3 = 资源；资源根 arc/res；写出来的 config 规整后零警告', Boolean(norm) && norm.config.containers.format === 'krkr' && norm.config.containers.scriptDecoder === 'krkr-scn' && norm.config.containers.mode === 'hybrid' && J(norm.config.resourceRoots) === J(['arc/res']) && norm.warnings.length === 0 && !('keys' in norm.config.containers), J([norm?.warnings, norm?.config?.containers]))
  const noHx = await generateTags({ item: { ...layoutItem, source: { path: (await (async () => { const d = path.join(work, 'Plain'); await mkdir(d, { recursive: true }); await writeFile(path.join(d, 'scn.xp3'), 'not an xp3'); await writeFile(path.join(d, 'data.xp3'), 'x'); return d })()) } }, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
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


// ---- TLG5（合成：编码器按解码器的逆写，真实的 TLG5 / TLG6 在 KRKR_SAMPLE 里另外核对）----
{
  const w = 13
  const h = 9
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + 11) & 255
  const d = decodeTlg(encodeTlg5(w, h, 4, rgba))
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 91 + 3) & 255
  const d3 = decodeTlg(encodeTlg5(w, h, 3, rgb))
  const png = tlgToPng(encodeTlg5(w, h, 4, rgba))
  check('TLG5 解码：RGBA / RGB 逐字节还原（编码器是解码器的逆）；转 PNG 的 IHDR 宽高对', d.width === w && d.height === h && d.channels === 4 && Buffer.from(d.data).equals(rgba) && d3.channels === 3 && Buffer.from(d3.data).equals(rgb) && png.readUInt32BE(16) === w && png.readUInt32BE(20) === h)
  check('TLG：不是 TLG（或带异或的变体）抛错，不返回乱数据', (() => { try { decodeTlg(Buffer.from('not a tlg file at all, really')); return false } catch { return true } })())
}

// ---- PIMG 选层 ----
const pimgRoot = {
  width: 200, height: 400,
  layers: [
    { layer_id: 1, name: '頬(照れ)', left: 90, top: 90, width: 20, height: 10, visible: 0, layer_type: 0, opacity: 255 },
    { layer_id: 2, name: '頬(通常)', left: 90, top: 90, width: 20, height: 10, visible: 1, layer_type: 0, opacity: 255 },
    { layer_id: 3, name: '眼鏡', left: 80, top: 70, width: 40, height: 15, visible: 1, layer_type: 0, opacity: 255 },
    { layer_id: 4, name: '制服', left: 50, top: 20, width: 100, height: 350, visible: 1, layer_type: 0, opacity: 255 },
    { layer_id: 5, name: '裸', left: 50, top: 20, width: 100, height: 350, visible: 0, layer_type: 0, opacity: 255 },
    { layer_id: 6, name: '表情差分', left: 0, top: 0, width: 0, height: 0, visible: 1, layer_type: 2, opacity: 255 },
    { layer_id: 7, name: '微笑', left: 85, top: 60, width: 30, height: 20, visible: 1, layer_type: 0, group_layer_id: 6, opacity: 255 },
    { layer_id: 8, name: '怒り', left: 85, top: 60, width: 30, height: 20, visible: 0, layer_type: 0, group_layer_id: 6, opacity: 255 },
  ],
}
const px = (n) => encodeTlg5(2, 2, 4, Buffer.alloc(16, n))
for (const l of pimgRoot.layers) if (l.layer_type === 0) pimgRoot[`${l.layer_id}.tlg`] = { resource: px(l.layer_id * 10) }
const pimgBuffer = buildPsb(pimgRoot)
const info = pimgInfo(new Psb(pimgBuffer).root())
{
  const a = pickPimgLayers(info, { dress: '制服', face: '微笑', pose: '基本', add: '頬' })
  const b = pickPimgLayers(info, { dress: '制服', face: '怒り', add: '頬（照れ）:眼鏡' })
  const c = pickPimgLayers(info, { dress: '水着', face: '微笑', add: '頬:眼鏡なし:ナイフ' })
  check('PIMG 选层：dress → pose → face → add 的顺序；全角括号按 NFKC 对上；脚本的「頬」= 层「頬(通常)」；pose「基本」没有对应的层不算缺', J(a.ids) === J([4, 7, 2]) && a.missing.length === 0, J(a))
  check('PIMG 选层：add 用 : 隔开、可以多项（頬（照れ）:眼鏡）；「xxxなし」不画；找不到的层记进 missing（不报错）', J(b.ids) === J([4, 8, 1, 3]) && J(c.ids) === J([7, 2]) && J(c.missing) === J(['dress:水着', 'add:ナイフ']), J([b, c]))
  const sinfo = parseSinfo('#dress\t服装名\t種別\t差分名\tレイヤ名\ndress\t制服\tdiff\t基本\t制服\ndress\t制服\tdiff\t弓\t裸\ndress\t水着\tdiff\t弓\tダミー\nface\t微笑\t表情差分/微笑\nface\t怒り\t表情差分/怒り\naddgroup\t頬\nadd\t頬\t頬（通常）\nadd\t頬（照れ）\t頬(照れ)\nadd\t頬なし\tダミー\nadd\t眼鏡\t眼鏡\n')
  const d1 = pickPimgLayers(info, { dress: '制服', pose: '弓', face: '怒り', add: '頬なし:眼鏡' }, sinfo)
  const d2 = pickPimgLayers(info, { dress: '水着', pose: '弓', face: '微笑', add: '頬' }, sinfo)
  check('.sinfo（立绘的选项表）：dress + pose → 身体层（制服 / 弓 → 裸），ダミー = 这个组合没有图；face 取路径最后一段；add 的各项（頬なし = ダミー = 不画；頬 = 頬（通常））', sinfo.dress.length === 3 && sinfo.face.length === 2 && sinfo.add.length === 4 && J(d1.ids) === J([5, 8, 3]) && J(d2.ids) === J([7, 2]) && J(d2.missing) === '[]', J([d1, d2, sinfo]))
  check('PIMG 信息：画布 / 层的位置（left top w h）/ 类别 / 资源号', info.width === 200 && info.height === 400 && J(info.layers[3]) === J([4, '制服', null, 50, 20, 100, 350, 1, 'image', 3]) && info.layers[5][8] === 'group', J(info.layers))
}

// ---- 立绘 + 事件 CG（合成 xp3）----
{
  const bundle = makeBundle('stand')
  const work3 = await mkdtemp(path.join(os.tmpdir(), 'krkr-stand-'))
  try {
    const media = path.join(work3, 'Game')
    await mkdir(media, { recursive: true })
    const char = (name, file, options, pos, actions, show = 3) => [name, 'character', { class: 'character', name, showmode: show, redraw: { imageFile: { file, options }, posName: pos }, action: actions }]
    const lines = (n) => Array.from({ length: n }, (_, i) => [['startline', 'vflag', 0, 'name', '', 'text', 1], i + 1, [i + 3, i + 1, null, null, 34, 192, null, null]]).flat()
    const root3 = {
      name: 'p1.txt',
      scenes: [{
        label: '*main', title: '', nexts: [], lines: lines(5),
        texts: [
          text(null, '立绘出场', null, [layer('ev', 'event', 'evcg005_06'), char('A', 'cha001.stand', { dress: '制服', face: '微笑', pose: '基本', add: '頬' }, '前', [['leveloffset', '#0,0,0,111,0,-10'], ['zpos', 0]])]),
          text('A', '换表情（sinfo 把「怒り」映射到「表情差分/微笑」）+ 右边', null, [layer('ev', 'event', 'evcg001_03u1'), char('A', 'cha001.stand', { dress: '制服', face: '怒り', add: '頬（照れ）:眼鏡' }, '右', [['leveloffset', '#0,0,0,111,0,-10']])]),
          text('A', '特写', null, [layer('ev', 'event', 'evcg005_06r2'), char('A', 'cha001.stand', { dress: '制服', face: '微笑', add: '頬' }, '前', [['leveloffset', '#0,0,0,228,0,200'], ['xpos', -480]]), char('B', 'cha002.stand', {}, '前', [])]),
          text('A', '变体 r1（底图 + 叠加层）', null, [layer('ev', 'event', 'evcg005_06r1')]),
          text('A', 'Live2D', null, [layer('ev', 'event', 'ev_demo.l2d', 3, { motion: 'r1', loop: 'true', variables: { 甲: 1 } })]),
        ],
      }],
    }
    const tlg = (v) => encodeTlg5(4, 3, 4, Buffer.alloc(48, v))
    await writeFile(path.join(media, 'scn.xp3'), buildHxv4Xp3([['/', 'p1.txt.scn', buildPsb(root3)]], bundle))
    await writeFile(path.join(media, 'fgimage.xp3'), buildHxv4Xp3([['/', 'cha001.pimg', pimgBuffer], ['/', 'cha001.sinfo', encodeKirikiriText('dress\t制服\tdiff\t基本\t制服\nface\t怒り\t表情差分/微笑\nadd\t頬\t頬（通常）\n')]], bundle))
    // evimage：cg001_03u1.tlg = 直接的 TLG；cg005_06 = 重定向文本（名字不是 cg005_06.tlg，只能靠内容找）→ cg005_06__zzzzzz.dpak（PSB，成员 cg005_06.tlg + 一张 PNG 叠加）
    // 变体 = 同一个 dpak 的重定向条目按 id 顺序排：base（只有底图，没有叠加层 = 锚点）、r1（底图 + 一张叠加 PNG，2×2、左上角在 (1, 1)）
    const overlayRgba = Buffer.alloc(16)
    for (let i = 0; i < 4; i++) overlayRgba.set([200, 100, 50, 255], i * 4)
    const dpak = buildPsb({ 'cg005_06.tlg': { resource: tlg(77) }, 'deadbeef.png': { resource: pngWithOffset(2, 2, overlayRgba, 1, 1) } })
    // Live2D 模型包（.l2d = ZIP）：model3.json / moc3 / cdi3 / 一个动作 / KTX 纹理（2×2 RGBA8）
    const l2dZip = buildZip([
      ['ev_demo.model3.json', Buffer.from(J({ Version: 3, FileReferences: { Moc: 'ev_demo.moc3', Textures: ['ev_demo.4096/texture_00.png'], DisplayInfo: 'ev_demo.cdi3.json', Motions: { '': [{ File: 'motions/ev_mv_01.motion3.json' }] } } })), 8],
      ['ev_demo.moc3', buildTinyMoc3(), 8],
      ['ev_demo.cdi3.json', Buffer.from(J({ Version: 3, Parameters: [{ Id: 'ParamA', GroupId: '', Name: '甲' }], Parts: [] })), 8],
      ['motions/ev_mv_01.motion3.json', Buffer.from(J({ Version: 3, Meta: { Duration: 1, Loop: true }, Curves: [] })), 8],
      ['ev_demo.4096/texture_00.ktx', buildKtx(2, 2, 0x8058, 0x1908, Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 9])), 0],
    ])
    await writeFile(path.join(media, 'evimage.xp3'), buildHxv4Xp3([['/', 'cg001_03u1.tlg', tlg(55)], ['/', 'some_random_name.bin', encodeKirikiriText('psb://cg005_06__zzzzzz.dpak/cg005_06.tlg\n')], ['/', 'another_random.bin', encodeKirikiriText('psb://cg005_06__zzzzzz.dpak/cg005_06.tlg\npsb://cg005_06__zzzzzz.dpak/deadbeef.png\n')], ['/', 'cg005_06__zzzzzz.dpak', dpak], ['/', 'ev_demo.l2d', l2dZip]], bundle))
    await writeFile(path.join(media, 'game.exe'), 'MZ')
    const keysFile = path.join(work3, 'gal-krkr-keys.json')
    await writeFile(keysFile, J([bundle]), { mode: 0o600 })
    setKeysFile(keysFile)
    const cfgRaw = (await generateTags({ item: { itemId: 's', title: 's', config: { game: { id: 'krkr::stand' } }, source: { path: media }, adapters: ['krkr::scn'] }, script: { id: 'gal-layout', version: '2.35.0', options: {} } })).itemPatch.gal.config
    const config = normalizeGalConfigWithWarnings(cfgRaw).config
    await ensureContainers({ mediaDir: media, config })
    const vf = await virtualFiles({ mediaDir: media, config })
    check('虚拟索引：立绘 = <名字>.pimg.json；直接的 TLG 事件 CG（去 ev 前缀找 cg001_03u1.tlg）= evcg001_03u1.png；重定向 → dpak 的成员 = evcg005_06.png（不靠名字，靠重定向文本的内容）', vf.files.includes('arc/res/cha001.pimg.json') && vf.files.includes('arc/res/evcg001_03u1.png') && vf.files.includes('arc/res/evcg005_06.png'), J(vf.files))
    const read = async (rel) => (await virtualEntry({ mediaDir: media, config, rels: [rel] })).read()
    const infoJson = JSON.parse((await read('arc/res/cha001.pimg.json')).toString('utf8'))
    const sinfoJson = JSON.parse((await read('arc/res/cha001.sinfo.json')).toString('utf8'))
    const layer4 = await read('arc/res/cha001.pimg/4.png')
    const layer7 = await read('arc/res/cha001.pimg/7.png')
    const canvas = await read('arc/res/cha001.pimg/canvas.png')
    const keyOf = async (rel) => (await virtualEntry({ mediaDir: media, config, rels: [rel] })).key
    check('立绘的层：每层转好的 PNG（取资源时才解密 + 解 TLG）；canvas.png = 整张画布大小的透明图；不同的层缓存键不同（以前同一个 PIMG 的所有层共用一个键，取到的全是第一层）', infoJson.width === 200 && layer4.readUInt32BE(16) === 2 && layer4.readUInt32BE(20) === 2 && layer4.length > 40 && !layer4.equals(layer7) && canvas.readUInt32BE(16) === 200 && canvas.readUInt32BE(20) === 400 && (await keyOf('arc/res/cha001.pimg/4.png')) !== (await keyOf('arc/res/cha001.pimg/7.png')) && (await keyOf('arc/res/cha001.pimg/7.png')) !== (await keyOf('arc/res/cha001.pimg.json')), J([layer4.length, layer7.length]))
    const cg1 = decodePng(await read('arc/res/evcg001_03u1.png'))
    const cg5 = decodePng(await read('arc/res/evcg005_06.png'))
    check('事件 CG：直接的 TLG 和 dpak 里的 TLG 都转成 PNG，像素对（55 / 77）', cg1.width === 4 && cg1.height === 3 && cg1.raw.every((v) => v === 55) && cg5.raw.every((v) => v === 77), J([cg1.width, cg5.width]))
    const cg5r2 = vf.files.includes('arc/res/evcg005_06r2.png') ? decodePng(await read('arc/res/evcg005_06r2.png')) : null
    check('事件 CG 的变体按重定向条目的 id 顺序对名字（rN = 这一组第一个 id + N；没有叠加层、底图就是 <组>rN 的条目当锚点）：evcg005_06r1 = 第二个条目 = 底图 + 叠加 PNG，按 oFFs 摆到 (1, 1)', vf.files.includes('arc/res/evcg005_06r1.png') && (sharpLib ? await (async () => {
      const raw = await sharpLib(await read('arc/res/evcg005_06r1.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const px = (x, y) => [...raw.data.subarray((y * raw.info.width + x) * 4, (y * raw.info.width + x) * 4 + 3)]
      return raw.info.width === 4 && raw.info.height === 3 && J(px(0, 0)) === J([77, 77, 77]) && J(px(1, 1)) === J([200, 100, 50]) && J(px(2, 2)) === J([200, 100, 50]) && J(px(3, 2)) === J([77, 77, 77])
    })() : true), sharpLib ? '' : 'sharp 没装：只核对了条目存在')
    check('事件 CG 的变体（evcg005_06r2：重定向条目的名字猜不出来，没法一一对上）= 用同一个 CG 编号（005_06）里已经对上的底图顶替', Boolean(cg5r2) && cg5r2.raw.every((v) => v === 77), J(vf.files))
    // 适配器：从展开的剧本 + 虚拟索引读出的层表
    const texts3 = { 'arc/res/cha001.pimg.json': J(infoJson), 'arc/res/cha001.sinfo.json': J(sinfoJson) }
    const ctx3 = adapter.prepare({ options: {}, files: vf.files, texts: texts3, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
    const script3 = await readFile(path.join(media, 'arc/script/scn/p1.krkr'), 'utf8')
    const scene3 = adapter.parse(script3, ctx3)
    const stands = scene3.steps.flatMap((st) => st.commands.filter((c) => c.op === 'stand' || c.op === 'standOff'))
    check('适配器：立绘 = 每个角色一个槽位（slot = 角色名）的 stand，部件 = 选中的层（身体 / 脸 / 腮红）；第一次出现带 fade；换表情只发 stand，不发 standOff；缩放 f = 1（zpos 0），中心 = 舞台中心 − (0, leveloffset 层级 1 的 y = 111)', stands[0].op === 'stand' && stands[0].slot === 'A' && stands[0].fade === 0.25 && stands[0].parts.length === 3 && stands[0].parts[0].src === 'cha001.pimg/4.png' && stands[0].parts[0].scale === 1 && stands[0].parts[0].x === 0 && stands[0].parts[0].y === -111 + (20 + 175 - 200) && J(stands[0].stage) === J([1920, 1080]), J(stands[0]))
    check('适配器：位置——xpos / posName（右 = +480）；没有 xpos 时按 posName', stands[1].op === 'stand' && !stands[1].fade && stands[1].parts[0].x === 480 + (50 + 100 / 2 - 100) && stands[1].parts[0].y === -111 + (20 + 350 / 2 - 200) && J(stands[1].parts.map((p) => p.src)) === J(['cha001.pimg/4.png', 'cha001.pimg/7.png', 'cha001.pimg/1.png', 'cha001.pimg/3.png']), J(stands[1]))
    check('适配器：xpos = -480、leveloffset y = 228；缺的立绘（cha002 没有 PIMG）记 unresolved、不报错', stands[2].parts[0].x === -480 + (50 + 50 - 100) && stands[2].parts[0].y === -228 + (20 + 175 - 200) && scene3.stats.unresolved['pimg:cha002'] >= 1 && scene3.stats.stands === 3, J([stands[2], scene3.stats]))
    check('适配器：事件 CG（ev）= bg（evcg005_06.png / evcg001_03u1.png）', J(scene3.steps[0].commands.filter((c) => c.op === 'bg')) === J([{ op: 'bg', src: 'evcg005_06.png' }]) && scene3.steps[1].commands.some((c) => c.op === 'bg' && c.src === 'evcg001_03u1.png'), J(scene3.steps[0].commands))
    // Live2D：虚拟索引里 <名字>.l2d/<成员>（纹理 .ktx 虚拟成 .png），取资源时才解 ZIP / KTX
    const l2dFiles = ['ev_demo.model3.json', 'ev_demo.moc3', 'ev_demo.cdi3.json', 'motions/ev_mv_01.motion3.json', 'ev_demo.4096/texture_00.png'].map((f) => `arc/res/ev_demo.l2d/${f}`)
    check('Live2D：.l2d（ZIP）按目录展开成虚拟文件 <名字>.l2d/<成员>（只读 ZIP 尾部目录；纹理 .ktx 虚拟成 .png——model3.json 里写的就是 .png）', l2dFiles.every((f) => vf.files.includes(f)) && !vf.files.some((f) => /\.ktx$/.test(f)), J(vf.files.filter((f) => /l2d/.test(f))))
    const l2dModel = JSON.parse((await read(l2dFiles[0])).toString('utf8'))
    const l2dMoc = await read(l2dFiles[1])
    const l2dTex = await read(l2dFiles[4])
    check('Live2D：取成员 = 解密 + 解 ZIP（model3.json / moc3 原样）；纹理 KTX → PNG（像素对）；不同成员缓存键不同', l2dModel.FileReferences.Moc === 'ev_demo.moc3' && l2dMoc.subarray(0, 4).toString() === 'MOC3' && l2dTex.readUInt32BE(16) === 2 && decodePng(l2dTex).raw[0] === 255 && (await keyOf(l2dFiles[1])) !== (await keyOf(l2dFiles[4])), J([l2dMoc.length, l2dTex.length]))
    const l2dCmd = scene3.steps[4].commands.find((c) => c.op === 'live2d')
    check('适配器：ev 是 .l2d = live2d 指令（src = 虚拟的 model3.json；motion / loop / variables 原样带上），模型没了 = live2dOff；统计 live2d 计数', Boolean(l2dCmd) && l2dCmd.src === 'ev_demo.l2d/ev_demo.model3.json' && l2dCmd.motion === 'r1' && l2dCmd.loop === true && J(l2dCmd.variables) === J({ 甲: 1 }) && scene3.stats.live2d === 1 && !scene3.steps[4].commands.some((c) => c.op === 'bg' && /l2d/.test(c.src || '')), J(scene3.steps[4].commands.map((c) => c.op)))
    const engine = await import('../../web/static/gal-engine.js')
    const st = engine.stateAt(scene3, 4, {})
    const st2 = engine.applyCommand(engine.applyCommand({ ...st }, { op: 'live2dOff' }), { op: 'bgoff' })
    check('engine：live2d 指令进状态（state.live2d = { src, motion, loop, variables }），live2dOff 清掉', st.live2d?.src === 'ev_demo.l2d/ev_demo.model3.json' && st.live2d.motion === 'r1' && st2.live2d === null, J(st.live2d))
  } finally { await rm(work3, { recursive: true, force: true }) }
}

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

{
  const st = parseStandInfo('[%[\n "facexoff"=>-270,\n "faceyoff"=>-360,\n "filename"=>"cha001",\n "leveloffset"=>[[0,0],[0,0],[-40,-237]],\n "xoffset"=>48,\n "yoffset"=>392\n]]\n')
  check('.stand 解析：xoffset / yoffset / facexoff / faceyoff + leveloffset 每层一对', JSON.stringify(st) === JSON.stringify({ xoffset: 48, yoffset: 392, facexoff: -270, faceyoff: -360, leveloffset: [[0, 0], [0, 0], [-40, -237]] }), JSON.stringify(st))
}

// ---- 立绘几何（引擎 TJS 推的：zpos 透视 + leveloffset 插值 + .stand 偏移）----
{
  const g = (o) => adapter.krkrStandGeometry({ stage: [1920, 1080], ...o })
  const j = JSON.stringify
  check('立绘几何：前（zpos 0）f = 1；中心 = 舞台中心 + (xpos + xoffset, yoffset) − (0, leveloffset 层级 1 的 y)', j(g({ act: { zpos: 0, xpos: 480, leveloffset: '#0,0,0,111,0,-10' }, stand: { xoffset: 48, yoffset: 392 } })) === j({ f: 1, cx: 960 + 480 + 48, cy: 540 + 392 - 111 }), j(g({ act: { zpos: 0, xpos: 480, leveloffset: '#0,0,0,111,0,-10' }, stand: { xoffset: 48, yoffset: 392 } })))
  const near = g({ act: { zpos: -50, leveloffset: '#0,0,0,111,0,-10' }, stand: { xoffset: 48, yoffset: 392 } })
  check('立绘几何：手前（zpos −50）f = 2；偏移 × f，leveloffset 层级 2 的 y（−10）不被 f 放大', near.f === 2 && near.cx === 960 + 2 * 48 && near.cy === 540 + 2 * 392 + 10, j(near))
  check('立绘几何：奥（zpos 51.5151…）f ≈ 0.66；目前（zpos −55.55…）f = 2.25', Math.abs(g({ act: { zpos: 51.51515151515151 } }).f - 0.66) < 0.001 && Math.abs(g({ act: { zpos: -55.55555555555556 } }).f - 2.25) < 0.001)
  check('立绘几何：层级之间插值（zorder 150 = 前和手前正中，y 取 111 与 −10 的平均）；超出层级数的取最后一对', Math.abs(g({ act: { zpos: -33.333333333333336, leveloffset: '#0,0,0,111,0,-10' } }).cy - (540 - 50.5)) < 0.01 && g({ act: { zpos: -55.55555555555556, leveloffset: '#0,0,0,111,0,-10' } }).cy === 540 + 10, j(g({ act: { zpos: -33.333333333333336, leveloffset: '#0,0,0,111,0,-10' } })))
  check('立绘几何：没有 zpos 按 posName 层级（手前 = 2 倍），没有 xpos 按 posName（左 = −480），没有 leveloffset 用 .stand 的', g({ posName: '手前' }).f === 2 && g({ posName: '左' }).cx === 960 - 480 && g({ posName: '手前', stand: { leveloffset: [[0, 0], [0, 0], [-40, -237]] } }).cx === 960 - 40 && g({ posName: '手前', stand: { leveloffset: [[0, 0], [0, 0], [-40, -237]] } }).cy === 540 + 237)
}

// ---- g07 的 Live2D：脚本里 ev_mv001_02r5s ↔ live2d.xp3 的 ev_cg001_02.l2d（动作文件名 = 图层名）----
{
  const j = JSON.stringify
  check('Live2D 名字：ev_mv001_02r5s → 模型 ev_cg001_02、动作 ev_mv001_02r5s；r1 / r4h / 41s 也认', j(adapter.krkrMvOf('ev_mv001_02r5s')) === j({ stem: 'ev_cg001_02', motion: 'ev_mv001_02r5s' }) && adapter.krkrMvOf('ev_mv001_02r4h').stem === 'ev_cg001_02' && adapter.krkrMvOf('ev_mv002_41s').stem === 'ev_cg002_41' && adapter.krkrMvOf('ev_mvx03_01r1').stem === 'ev_cgx03_01', j(adapter.krkrMvOf('ev_mv001_02r5s')))
  check('Live2D 名字：不是 ev_mv 的（evcg001_01 / bg01）不认', adapter.krkrMvOf('evcg001_01') === null && adapter.krkrMvOf('bg01') === null)
}

// ---- 台词行内控制码（%f字体; / #颜色; / %数字; / [读音]汉字）----
{
  const seg = (t) => adapter.krkrSegments(t, {})
  const j = JSON.stringify
  check('控制码：行首 %150; 去掉、正文不带它', j(seg('%150;「だーー！」')) === j([{ text: '「だーー！」' }]), j(seg('%150;「だーー！」')))
  check('控制码：%f字体;#00ff80c0;♥%fuser;#; → ♥ 单独一段、粉色 #ff80c0，前后文字原样', j(seg('あっ%f源ノ角ゴシックB;#00ff80c0;♥%fuser;#;」')) === j([{ text: 'あっ' }, { text: '♥', style: { color: '#ff80c0' } }, { text: '」' }]), j(seg('あっ%f源ノ角ゴシックB;#00ff80c0;♥%fuser;#;」')))
  check('控制码：6 位 #RRGGBB; 也认，#; 恢复默认色', j(seg('#ff0000;赤#;白')) === j([{ text: '赤', style: { color: '#ff0000' } }, { text: '白' }]), j(seg('#ff0000;赤#;白')))
  check('控制码：[う]宇[さ]佐[み]美 = 三个单字注音（读音在前）', j(seg('[う]宇[さ]佐[み]美')) === j([{ text: '宇', ruby: 'う' }, { text: '佐', ruby: 'さ' }, { text: '美', ruby: 'み' }]), j(seg('[う]宇[さ]佐[み]美')))
  check('控制码：非假名的方括号 / 没有分号的 % # 原样保留', j(seg('[A]と100%と#1')) === j([{ text: '[A]と100%と#1' }]), j(seg('[A]と100%と#1')))
  check('控制码：换行保留，无控制码的文本是一整段', j(seg('一行目\n二行目')) === j([{ text: '一行目\n二行目' }]), j(seg('一行目\n二行目')))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
