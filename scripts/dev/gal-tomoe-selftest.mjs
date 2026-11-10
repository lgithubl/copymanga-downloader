#!/usr/bin/env node
// 友恵の探偵物語（TinkerBell，tomoe.exe）：LZSS / Arc / 声音表 / Ogg 解密 / 图条目 → PNG / JPEG + Arc04 剧本切章 + tomoe::arc04 适配器 + containers（hybrid 虚拟索引）
//   真实样本（可选）：TOMOE_SAMPLE=<游戏目录（里面有 Arc04.dat / Arc03.dat）> 时额外把真实剧本整份切章 + 解析一遍
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'
import os from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import * as adapter from '../../web/library/gal/adapters/tomoe-arc04.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, virtualFiles } from '../../web/library/gal/containers.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { decodeArc, encodePng, lzssDecode, parseImageIndex, parseSoundTable, probeImage, splitChapters, splitScenesForTest, tinkDecrypt } from '../../web/library/gal/tomoe.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = JSON.stringify
const u32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32LE(x >>> 0, 4 * i)); return b }

// ---- 夹具编码器（和真实文件同样的格式）----
// LZSS：全部原样字节（每 8 个一个 0xff 标志）+ 一段引用（测引用解码）：先放 'ABCABC…' 再引用
const lzssLiteral = (buf) => { const out = []; for (let i = 0; i < buf.length; i += 8) { const n = Math.min(8, buf.length - i); out.push((1 << n) - 1, ...buf.subarray(i, i + n)) } return Buffer.from(out) }
const dec8 = (n) => Buffer.from(String(n).padStart(8, '0').split('').map((d) => Number(d) ^ 0x7f))
const arcFile = (plain) => { const packed = lzssLiteral(plain); return Buffer.concat([dec8(plain.length), dec8(packed.length), packed]) }
const tinkEncrypt = (ogg) => { const x = tinkDecrypt(ogg); x.write('Tink', 0, 'latin1'); return x }
const bitmap = (w, h, flag, extra) => { const head = Buffer.alloc(33); head[0] = 0x61; head.writeUInt32LE(w, 9); head.writeUInt32LE(h, 13); head.writeUInt32LE(flag, 17); if (flag === 1) { head.writeUInt32LE(extra.mask.length, 25); head.writeUInt32LE(10000001, 1) }; return flag === 1 ? Buffer.concat([head.subarray(0,29), extra.mask, u32(extra.color.length), extra.color]) : Buffer.concat([head, extra.color]) }
const ogg = (n) => { const b = Buffer.alloc(40 + n, 7); b.write('OggS', 0, 'latin1'); b[26] = 1; b[27] = 4 + n; return b }   // 一页：1 个段，段长 = 4 + n ... 只用来比对字节
const tok = { N: (v) => { const b = Buffer.alloc(5); b[0] = 0x4e; b.writeInt32LE(v, 1); return b }, T: (s) => { const n = s.length; const b = Buffer.alloc(9 + 2 * n); b[0] = 0x54; b.writeUInt32LE(1, 1); b.writeUInt32LE(n, 5); for (let i = 0; i < n; i++) b.writeUInt16LE(s.charCodeAt(i) ^ n, 9 + 2 * i); return b } }
const rec = (body) => Buffer.concat([u32(body.length + 4), body, u32(9999)])
const op = (m, ...args) => rec(Buffer.concat([Buffer.from(`M${m}`, 'latin1'), ...args.map(tok.N)]))
const line = (s) => rec(tok.T(s))
const imgOp = (id, layer) => op('$', 204, 1, 0, id, 0, layer, 1)

// ---- 纯函数 ----
{
  const plain = Buffer.from('hello hello hello world')
  check('lzss：原样字节解码', lzssDecode(lzssLiteral(plain)).equals(plain))
  // 引用：标志位 0b111 = 三个原样字节 'ABC'（写在环的 4078..4080），再一个引用 pos = 4078、len = (1 & 0xf) + 2 = 3、复制 len + 1 = 4 个 → 'ABCABCA'
  const ring = Buffer.from([0b00000111, 0x41, 0x42, 0x43, 4078 & 0xff, ((4078 >> 4) & 0xf0) | 1])
  check('lzss：引用（位置 4078 起、长度 3，复制 4 个）', lzssDecode(ring).toString() === 'ABCABCA', lzssDecode(ring).toString())
  const arc = arcFile(Buffer.from('payload-1234'))
  check('Arc：头 16 字节两个 8 位数（数字 ^ 0x7f）+ LZSS', decodeArc(arc).toString() === 'payload-1234')
  const key = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251))
  key.write('OggS', 0, 'latin1')
  check('Ogg 解密：加密再解密 = 原文；头 4 字节 Tink → OggS；3615 字节之后原样', tinkDecrypt(tinkEncrypt(key)).equals(key) && tinkEncrypt(key).subarray(3615).equals(key.subarray(3615)) && tinkEncrypt(key).toString('latin1', 0, 4) === 'Tink')
  const table = Buffer.concat([[0, 24, 0], [1, 100, 68], [2, 50, 212]].map(([id, size, offset]) => Buffer.concat([u32(0x17, 388 + id, size, size, offset), Buffer.alloc(7)])))
  check('声音表：27 字节一条（id = 序号，size / offset）', J(parseSoundTable(table)) === J([{ id: 0, size: 24, offset: 0 }, { id: 1, size: 100, offset: 68 }, { id: 2, size: 50, offset: 212 }]), J(parseSoundTable(table)))
  const index = Buffer.concat([u32(2), u32(2), u32(10, 20, 30, 0), u32(0, 5, 60, 0), u32(0), u32(0), u32(1), u32(7, 8, 9, 0), u32(0), u32(0)])
  const idx = parseImageIndex(index)
  check('图索引：全局编号按 Data 文件顺序连续', J(idx.map((e) => [e.file, e.k, e.a, e.size, e.offset])) === J([[0, 0, 10, 20, 30], [0, 1, 0, 5, 60], [1, 0, 7, 8, 9]]), J(idx))
  check('图类型：位图标志 0/7 = bmp、1 = patch、0x62 = jpg、0x63 = png', probeImage(bitmap(2, 2, 0, { color: Buffer.alloc(12) }), false).type === 'bmp' && probeImage(bitmap(2, 2, 1, { mask: Buffer.alloc(1), color: Buffer.alloc(0) }), false).type === 'patch' && probeImage(Buffer.from([0x62, 0, 0, 0, 0, 0xff, 0xd8, 0xff]), false).type === 'jpg' && probeImage(Buffer.from([0x63, 1, 2, 3, 4, 5, 0x89]), false).type === 'png')
}

// ---- 剧本切章 + 适配器 ----
const SCRIPT = Buffer.concat([
  op('L', 0), line('菜单\n'), op('#', 87),   // 文本太少的块不要
  op('L', 0),
  ...Array.from({ length: 3 }, (_, i) => Buffer.concat([line(`序の${i}行目\n`), op('#', 87)])),
  imgOp(817, 132), imgOp(1, 132), op('#', 13, 2),
  op('#', 131, 2, -1),
  op('#', 43, 0, 1), line('「声のある行」\n'), op('#', 87),
  line('ruby ÿÿ\u0003かんじ\u0002漢字 です\n'), op('#', 70),
  op('#', 29, 2), imgOp(817, 132), imgOp(0, 132), imgOp(2, 2), imgOp(3, 140), op('#', 13, 2),
  op('#', 46, 1), op('#', 114, 1), line('折り返しの\n'), line('行です\n'), op('#', 87),
  op('#', 114, -1), op('#', 131, -1, -1), imgOp(817, 2), imgOp(817, 140), line('最後\n'), op('#', 70),
])
{
  // 文本不够 20 行的块被丢掉；这里把 minTexts 降到 3 测切章
  const split = splitChapters(SCRIPT, { minTexts: 3 })
  check('切章：按 ML 记录切，文本太少的块不要', split.total === 3 && split.chapters.length === 1 && split.chapters[0].texts === 8, J([split.total, split.chapters.map((c) => c.texts)]))
  const split20 = splitChapters(SCRIPT)
  check('切章：默认至少 20 行，夹具不够 = 没有章', split20.chapters.length === 0)
}

// ---- containers + 适配器（夹具文件）----
const work = await mkdtemp(path.join(os.tmpdir(), 'tomoe-'))
try {
  const root = path.join(work, 'tomoe')
  await mkdir(path.join(root, 'Resources'), { recursive: true })
  const jpg = Buffer.concat([Buffer.from([0x62, 0, 0, 0, 0]), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])])
  const bmp = bitmap(2, 1, 0, { color: Buffer.from([1, 2, 3, 4, 5, 6]) })    // BGR → RGB (3,2,1) (6,5,4)
  const mask = Buffer.from([0b00000010])                                        // 只有第 1 个像素有内容
  const patch = bitmap(2, 1, 1, { mask, color: Buffer.from([9, 8, 7]) })
  const pngEntry = Buffer.concat([Buffer.from([0x63, 0, 0, 0, 0, 0]), encodePng(1, 1, Buffer.from([255, 0, 0]), 3)])
  const blobs = [jpg, bmp, patch, pngEntry]
  // Data000：0 = jpg（没压缩）、1 = bmp（压缩）、2 = patch（压缩）、3 = png（没压缩）
  const stored = [jpg, lzssLiteral(bmp), lzssLiteral(patch), pngEntry]
  const decoded = [0, bmp.length, patch.length, 0]
  let offset = 0
  const records = stored.map((s, i) => { const r = u32(decoded[i], s.length, offset, 0); offset += s.length; return r })
  const data00 = Buffer.concat([u32(1), u32(stored.length), ...records, u32(0), u32(0)])
  await writeFile(path.join(root, 'Resources', 'Data00.dat'), data00)
  await writeFile(path.join(root, 'Resources', 'Data000.dat'), Buffer.concat(stored))
  // 声音：Arc06 = [wav 头 44 字节 + 加密 ogg] 连着放；表里的 offset 指向 ogg
  const voice = ogg(3700)
  const bgm = ogg(50)
  const se = ogg(70)
  const sounds = [voice, bgm, se]
  const table = [[0, 24, 0]]
  let at = 24
  const parts = []
  sounds.forEach((s, i) => { const enc = tinkEncrypt(s); parts.push(Buffer.alloc(44), enc); table.push([i + 1, enc.length, at + 44]); at += 44 + enc.length })
  // 声音号 1 = 语音、2 = 音效、3 = BGM（脚本里 #131 3 → 6018 + 3，这里夹具用选项 bgmBase 改成 0 → 声音号 3）
  const tableBuf = Buffer.concat(table.map(([id, size, off]) => Buffer.concat([u32(0x17, 388 + id, size, size, off), Buffer.alloc(7)])))
  await writeFile(path.join(root, 'Arc03.dat'), arcFile(tableBuf))
  await writeFile(path.join(root, 'Arc06.dat'), Buffer.concat([Buffer.alloc(24), ...parts]))
  await writeFile(path.join(root, 'Arc04.dat'), Buffer.concat([SCRIPT, Buffer.alloc(100, 1)]))
  const scriptIndex = Buffer.concat([u32(23, 0, SCRIPT.length, SCRIPT.length, 0), Buffer.from([97,48,0,0,0,0,0])])
  await writeFile(path.join(root, 'Arc01.dat'), arcFile(scriptIndex))
  await writeFile(path.join(root, 'tomoe.exe'), 'MZ')
  const containers = { enabled: true, dir: 'arc', scan: ['.', 'Resources'], scriptDecoder: 'tomoe-arc04', scriptExt: 'tomoe', mode: 'hybrid', format: 'tomoe', rules: [{ match: '^Arc04\\.dat$', kinds: ['script'] }, { match: '^(Arc03|Arc06|Data\\d+)\\.dat$', kinds: ['res'] }], maxEntries: 200000, maxTotalMB: 8192 }
  const norm = normalizeGalConfigWithWarnings({ game: { id: 'tomoe::fixture' }, containers, scriptExtensions: ['tomoe'] })
  const c = norm.config
  check('config：containers.format = tomoe 被接受（hybrid），没有警告', c.containers.format === 'tomoe' && c.containers.mode === 'hybrid' && !norm.warnings?.length, J(norm.warnings))
  const media = path.join(work, 'tomoe')
  const report = await ensureContainers({ mediaDir: media, config: c })
  // Arc04 里夹具只有 8 行 < 20：展开 0 章（默认阈值）
  check('展开：Arc01 指定的短剧情也保留，别的文件算虚拟资源', report.arcs['./Arc04.dat']?.scripts === 1 && report.arcs['./Arc03.dat']?.lazy === 1 && report.arcs['Resources/Data000.dat']?.lazy === 1, J(report.arcs))
  const vf = await virtualFiles({ mediaDir: media, config: c })
  const expected = ['arc/res/img/0.jpg', 'arc/res/img/1.png', 'arc/res/img/2.p.png', 'arc/res/img/2.png', 'arc/res/img/3.png', 'arc/res/snd/0.ogg', 'arc/res/snd/1.ogg', 'arc/res/snd/2.ogg']
  check('虚拟索引：图按类型分 .jpg / .png / .p.png（补丁），声音 snd/<声音号>.ogg（声音号 = 表里的序号 - 1：表的第 0 条是文件头）', J([...vf.files].sort()) === J(expected), J(vf.files))
  const n = await materialize({ mediaDir: media, config: c, rels: expected })
  check('取资源：全部落盘', n === expected.length, String(n))
  const read = (rel) => readFile(path.join(root, ...rel.split('/')))
  check('取资源：JPEG = 去掉 5 字节头', (await read('arc/res/img/0.jpg')).equals(jpg.subarray(5)))
  const png1 = inflateSync((await read('arc/res/img/1.png')).subarray(41, -12))
  check('取资源：位图 → PNG（BGR → RGB；压缩条目先 LZSS 解压）', (await read('arc/res/img/1.png')).toString('latin1', 1, 4) === 'PNG' && png1.equals(Buffer.from([0, 3, 2, 1, 6, 5, 4])), J([...png1]))
  const png2 = inflateSync((await read('arc/res/img/2.p.png')).subarray(41, -12))
  check('取资源：差分按声明底图重建完整 RGBA PNG', png2.equals(Buffer.from([0, 3, 2, 1, 255, 7, 8, 9, 255])), J([...png2]))
  check('取资源：PNG = 去掉 6 字节头', (await read('arc/res/img/3.png')).equals(pngEntry.subarray(6)))
  check('取资源：声音解密成 Ogg（前 3615 字节），后面原样', (await read('arc/res/snd/0.ogg')).equals(voice) && (await read('arc/res/snd/1.ogg')).equals(bgm) && (await read('arc/res/snd/2.ogg')).equals(se))

  // 适配器：用夹具脚本（minTexts = 3 切章）+ 虚拟索引的文件表
  const chapter = splitChapters(SCRIPT, { minTexts: 3 }).chapters[0]
  const text = J({ format: 'tomoe-arc04/1', arc: 'Arc04.dat', name: '01', events: chapter.events })
  check('sniff：认 tomoe-arc04/1', adapter.sniff(text) && !adapter.sniff('{"format":"other"}'))
  const ctx = adapter.prepare({ options: { bgmBase: 0, seBase: 0, imageMode: 'legacy' }, files: vf.files, toResourcePath: (rel) => rel.replace(/^arc\/res\//, '') })
  const scene = buildScene('tomoe::arc04', text, ctx, { options: { bgmBase: 0, seBase: 0, imageMode: 'legacy' } })
  const flat = scene.steps.flatMap((s) => s.commands.map((cmd) => ({ ...cmd, step: s.index })))
  const textOf = (cmd) => cmd.segments.map((s) => s.text).join('')
  const texts = flat.filter((x) => x.op === 'text')
  check('适配器：每个点击一步；默认一句句（只显示这一次点击的那一段，不累计整页）', texts.length === 7 && textOf(texts[0]) === '序の0行目' && textOf(texts[1]) === '序の1行目', J(texts.map(textOf)))
  {
    const pageScene = buildScene('tomoe::arc04', text, adapter.prepare({ options: { bgmBase: 0, seBase: 0, imageMode: 'legacy', pageMode: 'page' }, files: vf.files, toResourcePath: (rel) => rel.replace(/^arc\/res\//, '') }), { options: { bgmBase: 0, seBase: 0, imageMode: 'legacy', pageMode: 'page' } })
    const pageTexts = pageScene.steps.flatMap((st) => st.commands).filter((x) => x.op === 'text').map(textOf)
    check('适配器：pageMode = page 还是游戏原样（同一页的行累计到页末）', pageTexts[1] === '序の0行目\n序の1行目', J(pageTexts))
  }
  const voiced = flat.filter((x) => x.op === 'text').find((x) => textOf(x).includes('声のある行'))
  const speakerCmd = flat.filter((x) => x.op === 'speaker' && x.step === voiced.step)[0]
  check('语音：#43 的声道 → 说话人（友恵），语音只管下一行；下一行没有说话人', speakerCmd?.segments?.[0]?.text === '友恵' && flat.some((x) => x.op === 'voice' && x.src === 'snd/0.ogg') && flat.filter((x) => x.op === 'speaker').find((x) => x.step === voiced.step + 1)?.segments?.length === 0)
  const ruby = flat.filter((x) => x.op === 'text').find((x) => textOf(x).includes('漢字'))
  check('注音：ÿÿ<注音长度><注音><正文长度><正文> → { text, ruby }', ruby?.segments?.some((s) => s.text === '漢字' && s.ruby === 'かんじ') && textOf(ruby).includes('ruby '), J(ruby))
  check('BGM / SE / 循环 SE：#131 n → 声音号 bgmBase + n；#46；#114（-1 停）', flat.some((x) => x.op === 'bgm' && x.src === 'snd/2.ogg') && flat.some((x) => x.op === 'se' && x.src === 'snd/1.ogg') && flat.some((x) => x.op === 'bgse' && x.src === 'snd/1.ogg' && x.loop) && flat.some((x) => x.op === 'bgseStop') && flat.some((x) => x.op === 'bgmStop'))
  const bgs = flat.filter((x) => x.op === 'bg')
  check('背景：开头黑底；同一层「清空 + 显示」合成一次切换（不闪黑），切换提交时才发', bgs.length === 3 && bgs[0].color && bgs[1].src === 'img/1.png' && bgs[2].src === 'img/0.jpg', J(bgs))
  check('背景：在 #29 … #13 里的切换带淡入淡出', bgs[2].fade === 0.5 && bgs[1].fade === 0, J(bgs))
  const ov = flat.filter((x) => x.op === 'overlay')
  check('叠加层：层 2 = 整张图，层 140 的补丁（.p.png）在补丁槽；按层给 z', ov.some((o) => o.slot === 'L2' && o.src === 'img/2.p.png') === false && ov.some((o) => o.slot === 'L2p0' && o.src === 'img/2.p.png') && ov.every((o) => o.stage?.[0] === 1920), J(ov))
  check('清空：图号 ≥ 816 去掉这一层的叠加层', flat.filter((x) => x.op === 'overlayOff').length === 1 && flat.find((x) => x.op === 'overlayOff').slot === 'L2p0', J(flat.filter((x) => x.op === 'overlayOff')))
  check('统计：图 / 声音全部找到', scene.stats.images.unresolved === 0 && scene.stats.voices.unresolved === 0 && scene.stats.sounds.unresolved === 0 && scene.stats.bgm.unresolved === 0, J(scene.stats))

  // gal-layout：认出 TinkerBell 目录（Arc04.dat 是记录流）、写出 containers / 资源根 / 适配器；Arc04.dat 不是记录流 = 不认
  const layoutItem = { itemId: 't', title: 't', config: {}, source: { path: work }, adapters: ['tomoe::arc04'] }
  const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.40.0', options: {} } })
  const lc = normalizeGalConfigWithWarnings(tagOut.itemPatch?.gal?.config || {}).config
  check('gal-layout：认出 TinkerBell（Arc04.dat 记录流 + Data00.dat），id = tomoe::tomoe，containers = tomoe / hybrid，扫 . 和 Resources', lc.game?.id === 'tomoe::tomoe' && lc.containers?.format === 'tomoe' && lc.containers?.mode === 'hybrid' && J(lc.containers?.scan) === J(['tomoe', 'tomoe/Resources']), J([lc.game, lc.containers]))
  check('gal-layout：资源根 = arc/res（虚拟索引，磁盘上还没有也要写）；适配器 resDir 带上 base', J(lc.resourceRoots) === J(['tomoe/arc/res']) && lc.adapterOptions?.['tomoe::arc04']?.resDir === 'tomoe/arc/res', J([lc.resourceRoots, lc.adapterOptions]))
  const bad = path.join(work, 'Bad')
  await mkdir(path.join(bad, 'Resources'), { recursive: true })
  await writeFile(path.join(bad, 'Arc04.dat'), Buffer.alloc(64, 1))
  await writeFile(path.join(bad, 'Arc03.dat'), 'x')
  await writeFile(path.join(bad, 'Arc06.dat'), 'x')
  await writeFile(path.join(bad, 'Resources', 'Data00.dat'), 'x')
  const none = await generateTags({ item: { ...layoutItem, source: { path: bad } }, script: { id: 'gal-layout', version: '2.40.0', options: {} } })
  check('gal-layout：Arc04.dat 不是记录流 = 不认', !none.itemPatch?.gal?.config?.containers || none.itemPatch.gal.config.game?.id?.startsWith('tomoe::') === false, J(none.itemPatch?.gal?.config?.game))

  // 真实样本
  const sample = process.env.TOMOE_SAMPLE
  if (sample) {
    const real = splitChapters(await readFile(path.join(sample, 'Arc04.dat')))
    let messages = 0
    for (const ch of real.chapters) {
      const t = J({ format: 'tomoe-arc04/1', arc: 'Arc04.dat', name: String(ch.index), events: ch.events })
      messages += buildScene('tomoe::arc04', t, adapter.prepare({ options: {}, files: [] }), { options: {} }).stats.messages
    }
    check(`真实样本：Arc04.dat 切成 ${real.chapters.length} 章（${real.records} 条记录）、解析出 ${messages} 页`, real.records > 60000 && real.chapters.length >= 10 && messages > 15000, J([real.records, real.chapters.length, messages]))
  } else console.log('SKIP 真实样本（TOMOE_SAMPLE=<游戏目录> 才跑）')
} finally { await archiveToTmp(work) }

// —— #132 毫秒 = BGM 淡出（真实剧本里 99 处，后面跟换场景；#131 -1 只有 1 处）——
{
  const fadeEvents = [['#', 131, 3, -1], ['T', 'あ'], ['T', 'い'], ['#', 132, 2000], ['#', 29, 2], ['#', 35, 9999], ['$', 204, 1, 0, 5, 0, 132, 1], ['#', 13, 2], ['T', 'う'], ['#', 87]]
  const scenes = splitScenesForTest(fadeEvents, { sceneTexts: 2, sceneMax: 300 })
  check('分节：#132 之后的下一节开头不带上一节的 BGM（淡出了）；没有 #132 才带', scenes.length === 2 && !scenes[1].events.some((ev) => ev[0] === '#' && ev[1] === 131) && splitScenesForTest(fadeEvents.filter((ev) => ev[1] !== 132), { sceneTexts: 2, sceneMax: 300 })[1].events.some((ev) => ev[0] === '#' && ev[1] === 131), J(scenes.map((s) => s.events.slice(0, 2))))
  const sc = buildScene('tomoe::arc04', J({ format: 'tomoe-arc04/1', arc: 'Arc04.dat', name: 'x', events: [['T', 'あ'], ['#', 87], ['#', 132, 2000], ['T', 'い'], ['#', 87]] }), adapter.prepare({ options: {}, files: [] }), { options: {} })
  const stop = sc.steps.flatMap((s) => s.commands).find((c) => c.op === 'bgmStop')
  check('适配器：#132 2000 → bgmStop（淡出 2 秒），不再记 ignored', stop?.fade === 2 && !sc.stats.ignored['#132'], J([stop, sc.stats.ignored]))
}

// —— 引擎的图层（tomoe.exe 逆向 + 数据核对）：#35 是转场效果选择（不隐藏）；每层留着整张图 + 累计补丁；号小的在前，前面第一张整图盖住后面所有层 ——
//    核对：ch12 s3 的 H-CG = 2 层的 685 + 补丁；140 层里留着上一个 CG（772 + 683）——前面的 2 层盖住它才和台词对得上；140 在前就是另一个女孩
{
  const files = ['arc/res/img/1.jpg', 'arc/res/img/2.p.png', 'arc/res/img/3.png', 'arc/res/img/4.png', 'arc/res/img/5.p.png']
  const run = (ev, options = {}) => {
    const sc = buildScene('tomoe::arc04', J({ format: 'tomoe-arc04/1', arc: 'Arc04.dat', name: 'x', events: [...ev, ['T', 'x'], ['#', 87]] }), adapter.prepare({ options: {imageMode:'legacy',...options}, files, toResourcePath: (r) => r.replace(/^arc\/res\//, '') }), { options })
    let bg = null; const ov = new Map()
    for (const c of sc.steps.flatMap((st) => st.commands)) { if (c.op === 'bg') bg = c.src || null; else if (c.op === 'overlay') ov.set(c.slot, c); else if (c.op === 'overlayOff') ov.delete(c.slot) }
    return { bg, ov: [...ov.keys()].sort(), z: Object.fromEntries([...ov].map(([k, v]) => [k, v.z])) }
  }
  const d = (id, layer) => ['$', 204, 1, 0, id, 0, layer, 1]
  // 140 层留着上一个 CG（3.png），132 层是背景（1.jpg）：132 号小、在前，盖住 140 → 只显示背景，140 不发
  const stale = run([d(3, 140), d(1, 132)])
  check('引擎图层：140 层的旧 CG 在 132 层的背景后面（号大的在后）→ 只有背景，没有碎片 / 旧 CG', stale.bg === 'img/1.jpg' && stale.ov.length === 0, J(stale))
  // 2 层画新 CG（4.png）：最前，盖住后面所有层（140 / 132 都不发）
  const front = run([d(3, 140), d(1, 132), d(4, 2)])
  check('引擎图层：2 层的整张图在最前 → 它是背景，后面的层都不发', front.bg === 'img/4.png' && front.ov.length === 0, J(front))
  // 2 层上再画补丁（2.p.png）→ 叠加层，z 比后面的层大
  const patched = run([d(3, 140), d(1, 132), d(4, 2), d(2, 2)])
  check('引擎图层：补丁累计盖在这一层的整张图上（槽 L2p0）', patched.bg === 'img/4.png' && J(patched.ov) === J(['L2p0']), J(patched))
  // 只有补丁的前层（4 层里只有 5.p.png）：补丁叠在后面最前的整图（132 的 1.jpg）上
  const onlyPatch = run([d(3, 140), d(1, 132), d(5, 4)])
  check('引擎图层：前层只有补丁 → 叠在后面第一张整图（背景）上；z 比背景层的补丁大', onlyPatch.bg === 'img/1.jpg' && J(onlyPatch.ov) === J(['L4p0']), J(onlyPatch))
  // #35 不隐藏
  const withEffect = run([d(1, 132), ['#', 29, 2], ['#', 35, 9999], d(3, 140), ['#', 13, 2]])
  check('#35 清理旧对象：新画面没有上一场景的 132 层背景', withEffect.bg === 'img/3.png', J(withEffect))
  // 清空
  const cleared = run([d(1, 132), d(3, 140), d(817, 132)])
  check('清空（图号 ≥ 816）去掉这一层；后面的 140 层的整图露出来', cleared.bg === 'img/3.png', J(cleared))
  const legacy = run([d(3, 140), ['#', 29, 2], ['#', 35, 9999], d(2, 140)], { layerModel: 'legacy' })
  check('layerModel: legacy 还是旧行为（#35 9999 藏起来，之后的补丁叠在保留的整图上）', J(legacy.ov) === J(['L140', 'L140p0']), J(legacy))
  const sp = splitScenesForTest([['$', 204, 1, 0, 1, 0, 120, 1], ['$', 204, 1, 0, 3, 0, 140, 1], ['T', 'a'], ['T', 'b'], ['#', 35, 9999], ['#', 29, 2], ['$', 204, 1, 0, 5, 0, 132, 1], ['T', 'c']], { sceneTexts: 2, sceneMax: 300 })
  check('分节：#35 之后的快照不带旧场景 120 / 140 层', sp.length === 2 && !sp[1].events.some(ev => ev[0] === '$' && [1,3].includes(ev[4])), J(sp.map((x) => x.events.slice(0, 5))))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
