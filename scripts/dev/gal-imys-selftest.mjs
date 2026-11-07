#!/usr/bin/env node
// Imys：AES 解密 + UnityFS（LZ4）+ SerializedFile v22 + TextAsset → 展开 → imys::adv 适配器；合成一个 bundle（不需要真实游戏文件）。
//   IMYS_SAMPLE=<含 bundles/scenarios 的目录> 时再把真实 bundle 全部解一遍。
import { createCipheriv } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IMYS_KEY, imysDecrypt, lz4Block, readTextAssets, readUnityFS } from '../../web/library/gal/unity-bundle.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { galAdapter } from '../../web/library/gal/adapters/index.mjs'
import { ensureContainers, invalidateContainers, virtualFiles } from '../../web/library/gal/containers.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

// —— 合成 bundle ——
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b }
const lz4Literal = (data) => { const len = data.length; const head = len < 15 ? Buffer.from([len << 4]) : Buffer.concat([Buffer.from([0xf0]), Buffer.from(Array(Math.floor((len - 15) / 255)).fill(255)), Buffer.from([(len - 15) % 255])]); return Buffer.concat([head, data]) }
const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)])
const str = (s) => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return pad4(Buffer.concat([l, b])) }
const align4 = (n) => (n + 3) & ~3
const align16 = (n) => (n + 15) & ~15

// SerializedFile v22：头 48 字节（0 / 0 / 版本 / 旧 dataOffset / 字节序 + 3 / 元数据大小 / 文件大小 / dataOffset / 8 字节），布局见 unity-bundle.mjs 的 readSerialized
function buildSerialized(texts) {
  const le32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b }
  const objs = texts.map((t) => Buffer.concat([str(t.name), str(t.text)]))
  const typeEntry = Buffer.concat([le32(49), Buffer.from([0]), Buffer.from([0, 0]), Buffer.alloc(16)])
  const front = Buffer.concat([Buffer.from('6000.0.68f1\0'), le32(19), Buffer.from([0]), le32(1), typeEntry, le32(objs.length)])
  let metaLen = 48 + front.length
  const entries = []
  let off = 0
  for (const o of objs) {
    while (metaLen % 4) metaLen += 1
    const e = Buffer.alloc(24); e.writeBigInt64LE(BigInt(entries.length + 1), 0); e.writeBigInt64LE(BigInt(off), 8); e.writeUInt32LE(o.length, 16); e.writeInt32LE(0, 20)
    entries.push({ at: metaLen, e }); metaLen += 24; off += align4(o.length)
  }
  const dataOffset = align16(metaLen)
  const out = Buffer.alloc(dataOffset + off)
  out.writeUInt32BE(22, 8)
  out.writeUInt32BE(metaLen - 48, 20)
  out.writeBigInt64BE(BigInt(out.length), 24)
  out.writeBigInt64BE(BigInt(dataOffset), 32)
  front.copy(out, 48)
  for (const { at, e } of entries) e.copy(out, at)
  let p = dataOffset
  for (const o of objs) { o.copy(out, p); p += align4(o.length) }
  return out
}
function buildBundle(texts) {
  const sf = buildSerialized(texts)
  const block = lz4Literal(sf)
  const info = Buffer.concat([Buffer.alloc(16), u32(1), u32(sf.length), u32(block.length), Buffer.from([0, 3]), u32(1), u64(0), u64(sf.length), u32(4), Buffer.from('CAB-test\0')])
  const infoC = lz4Literal(info)
  const hdrStr = Buffer.concat([Buffer.from('UnityFS\0'), u32(8), Buffer.from('5.x.x\0'), Buffer.from('6000.0.68f1\0')])
  const flags = 0x203
  let head = Buffer.concat([hdrStr, u64(0), u32(infoC.length), u32(info.length), u32(flags)])
  const pad = (b) => Buffer.concat([b, Buffer.alloc(align16(b.length) - b.length)])
  head = pad(head)
  return pad(Buffer.concat([head, infoC])).length && Buffer.concat([pad(Buffer.concat([head, infoC])), block])
}
const encrypt = (plain) => { const iv = Buffer.from('0123456789abcdef'); const c = createCipheriv('aes-256-cbc', IMYS_KEY, iv); c.setAutoPadding(false); const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]); return Buffer.concat([iv, c.update(padded), c.final()]) }

const SCRIPT = [
  '//=======================================交流AVG（t1）', '//--背景：鍛練場', '\tBGDraw\t("bg_tra_301");', '\tRefresh\t(FADE);', '\tBGMPlay\t(01,b1100,100);', '',
  '\tTati\t(01,028,00,01,+0);', '\tRefresh\t(SUDDEN);', '\tVoice\t("amv028_a70_00010",02801);', 'オリヴィエ「『白銀の疾風』の高名は<R こうみょう>高名</R>でした」', '旁白一行。', '',
  '\tTimeWait\t(1500,CLICK_ENABLE);', '\tFadeoutBlack\t(FADE);', '\tScreenEffect\t(QUAKE,0);', '\tFadeinBlack\t(FADE);', 'ユー「おしまい」',
].join('\r\n')

check('LZ4：字面量 + 重叠匹配（offset 5 → 再来一遍 hello）', lz4Block(Buffer.concat([Buffer.from([0x51]), Buffer.from('hello'), Buffer.from([5, 0, 0x00])]), 10).toString() === 'hellohello')
check('LZ4：越界的匹配 → 抛错', (() => { try { lz4Block(Buffer.from([0x11, 0x41, 9, 0, 0x00]), 6); return false } catch { return true } })())
const bundle = buildBundle([{ name: 't1', text: SCRIPT }])
const roundtrip = readTextAssets(imysDecrypt(encrypt(bundle)))
check('AES → UnityFS → SerializedFile v22 → TextAsset：名字和文本原样取出', roundtrip.length === 1 && roundtrip[0].name === 't1' && roundtrip[0].text === SCRIPT, J(roundtrip).slice(0, 200))
check('密钥不对 / 不是 bundle → 抛错（不静默）', (() => { try { imysDecrypt(Buffer.alloc(64, 7)); return false } catch { return true } })())
check('readUnityFS：目录里有 CAB-test', readUnityFS(bundle)[0]?.name === 'CAB-test')

// —— 适配器 ——
const adapter = galAdapter('imys::adv')
const text = J({ format: 'imys-adv/1', category: 'combo', name: 't1', text: SCRIPT })
check('sniff：认 imys-adv/1，不认别的', adapter.sniff(text) && !adapter.sniff('{"format":"x"}'))
const sc = buildScene('imys::adv', text, adapter.prepare({ options: {}, files: [] }), { options: {} })
const cmds = sc.steps.flatMap((s) => s.commands)
const speakers = sc.steps.map((s) => s.commands.find((c) => c.op === 'speaker')?.segments?.[0]?.text || '')
check('台词：说话人 / 旁白 / 注音（<R こうみょう>）；每行一步', J(speakers) === J(['オリヴィエ', '', 'ユー']) && cmds.some((c) => c.op === 'text' && c.segments.some((x) => x.ruby === 'こうみょう')), J(speakers))
check('统计：3 句台词、1 个语音名、1 个 BGM 名、1 个背景名、1 个立绘；ScreenEffect 记 ignored', sc.stats.messages === 3 && sc.stats.voices.referenced === 1 && sc.stats.bgm.referenced === 1 && sc.stats.images.referenced === 1 && sc.stats.stands === 1 && sc.stats.ignored.ScreenEffect === 1, J(sc.stats))
check('TimeWait → wait 1.5 秒；FadeoutBlack / FadeinBlack → 黑场再回背景', cmds.some((c) => c.op === 'wait' && c.seconds === 1.5) && cmds.some((c) => c.op === 'bg' && Array.isArray(c.color)), J(cmds.map((c) => c.op)))
const withRes = buildScene('imys::adv', text, adapter.prepare({ options: {}, files: ['arc/res/bg_tra_301.png', 'arc/res/amv028_a70_00010.ogg', 'arc/res/bgm_1100.ogg'] }), { options: {} })
check('资源索引里有同名文件 → bg / voice / bgm 指令（名字 → 文件）', withRes.steps.flatMap((s) => s.commands).some((c) => c.op === 'bg' && /bg_tra_301\.png$/.test(c.src)) && withRes.steps.flatMap((s) => s.commands).some((c) => c.op === 'voice') && withRes.steps.flatMap((s) => s.commands).some((c) => c.op === 'bgm' && /bgm_1100/.test(c.src)))

// —— Select + switch / case（cloth_001_0702 的「触摸」小游戏）：选项 → 分支（case 里的指令带 when），不再把 switch / { / case / break 当旁白 ——
{
  const body = '\tSelect\t2,020:180,-60:000,070:-160\n\n\tswitch( %0 )\n\t{\n\n//--タッチ①結果\n\tcase\t0:\n\n頬に触れる。\n\tTati\t(01,001,07,03,+0);\nアシュリー「暖かい」\n\tbreak\n\n//--タッチ②結果\n\tcase\t1:\nアシュリー「んっ」\n\tbreak\n\t}\n続き。\n'
  const sc = buildScene('imys::adv', J({ format: 'imys-adv/1', category: 'dress', name: 't', text: body }), adapter.prepare({ options: {}, files: [] }), { options: {} })
  const texts = sc.steps.map((s) => ({ text: s.commands.find((c) => c.op === 'text')?.segments?.map((x) => x.text).join('') || '', when: s.commands[0].when?.[0], choice: s.commands.find((c) => c.op === 'choice') }))
  const choice = texts.find((x) => x.choice)?.choice
  check('Select n → 选项（标签 = case 前面的「//--タッチ①結果」去掉「結果」）；switch / case / break / { } 不当旁白', J(choice?.options.map((o) => o.segments[0].text)) === J(['タッチ①', 'タッチ②']) && !texts.some((x) => /switch|case|break|^\{|^\}/.test(x.text)), J(texts))
  check('case 里的步骤带 when（var == 选项号）；break 之后的「続き。」不带 when', texts.filter((x) => x.when).every((x) => x.when.var === choice.var) && J(texts.filter((x) => x.when).map((x) => [x.text, x.when.value])) === J([['頬に触れる。', 1], ['暖かい', 1], ['んっ', 2]]) && texts.at(-1).text === '続き。' && !texts.at(-1).when, J(texts))
}

// —— containers 展开 ——
const tmp = await mkdtemp(path.join(os.tmpdir(), 'imys-'))
try {
  for (const [cat, name] of [['combo', 'ik001_1'], ['dress', 'cloth_1'], ['quest', 'main_1']]) {
    await mkdir(path.join(tmp, 'bundles/scenarios', cat), { recursive: true })
    await writeFile(path.join(tmp, 'bundles/scenarios', cat, `${name}.jp.encrypted`), encrypt(buildBundle([{ name, text: SCRIPT }])))
  }
  await writeFile(path.join(tmp, 'bundles/scenarios/default_chars.jp.encrypted'), encrypt(buildBundle([{ name: 'default_chars', text: 'abc' }])))
  const config = normalizeGalConfig({ containers: { enabled: true, dir: 'arc', scan: ['bundles/scenarios'], scriptDecoder: 'imys-adv', scriptExt: 'imys', mode: 'hybrid', format: 'imys', rules: [{ match: '\\.encrypted$', kinds: ['script'] }] } })
  const rep = await ensureContainers({ mediaDir: tmp, config })
  const list = async (d) => (await readdir(path.join(tmp, 'arc/script', d)).catch(() => [])).sort()
  check('展开：3 个类别各一份 .imys，default_chars（字库）不展开', rep.arcs.scenarios?.scripts === 3 && J(await list('combo')) === J(['ik001_1.imys']) && J(await list('dress')) === J(['cloth_1.imys']) && !(await readdir(path.join(tmp, 'arc/script'))).includes('scenarios'), J(rep))
  const one = JSON.parse(await readFile(path.join(tmp, 'arc/script/quest/main_1.imys'), 'utf8'))
  check('展开出来的 JSON：imys-adv/1，带类别、名字和剧本文本', one.format === 'imys-adv/1' && one.category === 'quest' && one.text === SCRIPT)
  const again = await ensureContainers({ mediaDir: tmp, config })
  check('再跑一遍：没变就跳过（cached）', again.arcs.scenarios?.cached === true)
  // 背景虚拟索引：backgrounds 下一层 + r18（H CG，BGDraw("R18/hcg_…")）；剧本里的带目录名字按文件名对上
  await mkdir(path.join(tmp, 'bundles/backgrounds/r18'), { recursive: true })
  await writeFile(path.join(tmp, 'bundles/backgrounds/bg_avg_001.jp.encrypted'), Buffer.alloc(32))
  await writeFile(path.join(tmp, 'bundles/backgrounds/r18/hcg_0270301.jp.encrypted'), Buffer.alloc(32))
  invalidateContainers(tmp)
  const vfiles = (await virtualFiles({ mediaDir: tmp, config })).files
  check('背景索引：bg_avg_001 + r18/hcg_0270301（res/bg/R18/…png）', vfiles.includes('arc/res/bg/bg_avg_001.png') && vfiles.includes('arc/res/bg/R18/hcg_0270301.png'), J(vfiles.filter((f) => /\/bg\//.test(f))))
  const cgScene = buildScene('imys::adv', J({ format: 'imys-adv/1', category: 'dress', name: 'c', text: '\tBGDraw\t("R18/hcg_0270301");\n\tRefresh\t(FADE);\nフリッカ「あ」\n' }), adapter.prepare({ options: {}, files: vfiles, toResourcePath: (r) => r.replace(/^arc\/res\//, '') }), { options: {} })
  check('剧本 BGDraw("R18/hcg_0270301") → bg 指令（H CG 不再缺）', cgScene.steps.flatMap((s) => s.commands).some((c) => c.op === 'bg' && /R18\/hcg_0270301\.png$/.test(c.src)), J(cgScene.steps))
} finally { await rm(tmp, { recursive: true, force: true }) }

// —— 真实样本 ——
if (process.env.IMYS_SAMPLE) {
  let ok = 0
  let bad = 0
  const walk = async (dir) => { for (const e of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else if (/\.encrypted$/.test(e.name)) { try { const t = readTextAssets(imysDecrypt(await readFile(p))); if (t[0]?.text) ok += 1; else bad += 1 } catch { bad += 1 } } } }
  await walk(path.join(process.env.IMYS_SAMPLE, 'bundles', 'scenarios'))
  check(`真实剧本 bundle 全部解得开（${ok} 个）`, ok > 0 && bad === 0, `bad=${bad}`)
  // 图：背景（Texture2D → PNG）、立绘（图集 + Sprite + setting → 舞台大小的 PNG）
  const { backgroundPng, tatiBundle, tatiComposePng } = await import('../../web/library/gal/unity-assets.mjs')
  const bgDir = path.join(process.env.IMYS_SAMPLE, 'bundles', 'backgrounds')
  const tatiDir = path.join(process.env.IMYS_SAMPLE, 'bundles', 'characters', 'tati')
  const bgs = await readdir(bgDir).catch(() => [])
  if (bgs.length) {
    const png = backgroundPng(await readFile(path.join(bgDir, bgs[0])))
    check(`背景：${bgs[0]} → PNG（签名 + 1280×720）`, png.readUInt32BE(0) === 0x89504e47 && png.readUInt32BE(16) === 1280 && png.readUInt32BE(20) === 720, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`)
  }
  const tatis = (await readdir(tatiDir).catch(() => [])).filter((n) => /^\d{5}\.encrypted$/.test(n) && n !== '00001.encrypted')
  if (tatis.length) {
    const buf = await readFile(path.join(tatiDir, tatis[0]))
    const b = tatiBundle(buf)
    check(`立绘 ${tatis[0]}：有 stand + default / smile / shy / ang / gag，setting 有 stand / face`, ['stand', 'default', 'smile', 'shy', 'ang', 'gag'].every((k) => b.sprites.has(k)) && Boolean(b.setting.stand) && Boolean(b.setting.face), JSON.stringify([...b.sprites.keys()]))
    const r1 = tatiComposePng(buf, 1)
    const r3 = tatiComposePng(buf, 3)
    check('立绘合成：表情 1 = default、3 = shy，舞台 1280×720，两张不一样', r1.faceName === 'default' && r3.faceName === 'shy' && r1.png.readUInt32BE(16) === 1280 && r1.png.readUInt32BE(20) === 720 && !r1.png.equals(r3.png))
  }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
