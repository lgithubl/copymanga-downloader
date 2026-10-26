#!/usr/bin/env node
// Gal 适配器参数自测（只用 node，不要浏览器）：tenkeiprdx-json / misttrain-json / artwhirl-json / girlscreation-tag(+line) 的 adapterOptions。
// 每个参数：不写 = 以前的行为（默认值整份显式写出来结果也不变）、改了 = 结果按文档变；每个适配器再走一条完整链路
// （config.adapterOptions → loadAdapterContext（文件索引 + prepare）→ buildScene（meta.options / meta.config））。
//   node scripts/dev/gal-adapter-options-selftest.mjs
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { galAdapter } from '../../web/library/gal/adapters/index.mjs'
import * as aw from '../../web/library/gal/adapters/artwhirl-json.mjs'
import * as gc from '../../web/library/gal/adapters/girlscreation-tag.mjs'
import { girlsOptions } from '../../web/library/gal/adapters/girlscreation-line.mjs'
import * as mt from '../../web/library/gal/adapters/misttrain-json.mjs'
import { mergeOptions } from '../../web/library/gal/adapters/options-merge.mjs'
import * as tk from '../../web/library/gal/adapters/tenkeiprdx-json.mjs'
import { galConfigView, normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gal-adapter-opts-')))
let seq = 0

// 完整链路：磁盘上造文件 → config.adapterOptions → loadAdapterContext → buildScene
async function e2e(adapterId, tree, adapterOptions, scriptRel, extraConfig = {}, metaRel = scriptRel) {
  const dir = path.join(work, `e${seq += 1}`)
  for (const [rel, content] of Object.entries(tree)) { await mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await writeFile(path.join(dir, rel), content) }
  const config = normalizeGalConfig({ adapterOptions: { [adapterId]: adapterOptions }, ...extraConfig })
  const ctx = await loadAdapterContext({ adapter: galAdapter(adapterId), mediaDir: dir, config })
  const meta = { rel: metaRel, stem: path.basename(scriptRel).replace(/\.[^.]+$/, ''), options: config.adapterOptions[adapterId] || {}, config: galConfigView(config) }
  return { scene: buildScene(adapterId, tree[scriptRel], ctx, meta), ctx, config }
}
const cmds = (scene) => scene.steps.flatMap((s) => s.commands)
const ofOp = (scene, op) => cmds(scene).filter((c) => c.op === op)

// ================= 0. mergeOptions =================
{
  const defaults = { a: 1, s: 'x', b: true, list: [1, 2], o: { k: 1 }, free: null, map: { 0: 0.5 } }
  const m = mergeOptions(defaults, { a: 'bad', s: 5, b: 'no', list: [9], o: { k: 2, extra: 3 }, free: { any: 1 }, map: { 1: 0.1 }, unknown: 7 })
  check('mergeOptions：类型不符用默认值；数组整体替换；对象逐项合并并保留新键；null 默认值（可选项）给什么收什么；未知键保留', J(m) === J({ a: 1, s: 'x', b: true, list: [9], o: { k: 2, extra: 3 }, free: { any: 1 }, map: { 0: 0.5, 1: 0.1 }, unknown: 7 }), J(m))
  check('mergeOptions：不改默认表；给 undefined / 非对象 = 默认', J(mergeOptions(defaults, undefined)) === J(defaults) && J(mergeOptions(defaults, 5)) === J(defaults) && defaults.list.length === 2)
}

// ================= 1. tenkeiprdx-json =================
{
  const D = tk.DEFAULT_OPTIONS
  const files = [
    'Spines/1001/1001_01.skel.bytes', 'Stills/s/1_a.skel.bytes', 'Stills/s/2_b.skel.bytes',
    'Backgrounds/adventure/bg_a.png', 'Backgrounds/still/bg_a.png', 'Backgrounds/still/s_still_02.png', 'BGM/m_loop.ogg', 'BGM/n.ogg', 'BGM/n_loop.ogg',
  ]
  const mk = (options = {}, f = files) => tk.prepare({ options, texts: { 'Masterdata/username.txt': 'U' }, files: f, toResourcePath: (r) => r })
  const J2 = (frames, id = '5') => J({ result: { sceneDetails: [{ assetId: id, sceneFrameDetails: frames }] } })
  const run = (frames, options, f) => tk.parse(J2(frames), mk(options, f), { stem: '5' })
  const frames = [
    { speakerName: '%username%', phraseContents: 'a', phraseVoice: 'v1', backgroundImage: 'bg_a', backgroundMusic: 'm', soundEffect: 'click', adventureCharacters: [{ characterMasterId: 1001, characterAppearance: 1, characterPosition: 1, characterFacialExpression: 1 }] },
    { backgroundImage: 'bg_x_still_02', backgroundMusic: 'n' },
    { still: 's', stillAnimation: 'animation3', phraseContents: 'b' }, { stillAnimation: 'animation4', animationSpeed: 500, phraseContents: 'c' }, { stillAnimation: 'animation5', phraseContents: 'd' },
    { sceneCameraEndPositionX: 5, phraseContents: 'cam' },
  ]
  const base = run(frames, {})
  check('tenkeiprdx 默认：默认值表整份显式写出来，结果不变', J(run(frames, D)) === J(base))
  check('tenkeiprdx 默认：背景 adventure 优先于 still、BGM 退到 _loop、站位 1 → 0.3、语音按场景 id', cmds(base).find((c) => c.op === 'bg').src === 'Backgrounds/adventure/bg_a.png' && cmds(base).find((c) => c.op === 'bgm').src === 'BGM/m_loop.ogg' && cmds(base).find((c) => c.op === 'spine').x === 0.3 && cmds(base).find((c) => c.op === 'voice').src === 'AdventureVoice/5/v1.ogg')

  // paths：模板数组
  const pathsOpt = run(frames, { paths: { background: ['Backgrounds/still/{name}.png', 'Backgrounds/adventure/{name}.png'], bgm: ['BGM/{name}.mp3'], se: ['Audio/{name}.wav'], voice: ['V/{scene}-{name}.ogg'] } })
  check('tenkeiprdx paths：背景模板顺序（still 先）、bgm / se / voice 模板', cmds(pathsOpt).find((c) => c.op === 'bg').src === 'Backgrounds/still/bg_a.png' && cmds(pathsOpt).find((c) => c.op === 'bgm').src === 'BGM/m.mp3' && cmds(pathsOpt).find((c) => c.op === 'se').src === 'Audio/click.wav' && cmds(pathsOpt).find((c) => c.op === 'voice').src === 'V/5-v1.ogg')
  check('tenkeiprdx paths.backgroundMissing：索引里没有的背景按规则拼（_still_ → still，其余 adventure；可改）', run([{ backgroundImage: 'zz_still_9' }, { backgroundImage: 'zz' }]).steps.map((s) => s.commands.find((c) => c.op === 'bg').src).join() === 'Backgrounds/still/zz_still_9.png,Backgrounds/adventure/zz.png' && run([{ backgroundImage: 'zz_still_9' }], { paths: { backgroundMissing: [{ path: 'Other/{name}.png' }] } }).steps[0].commands.find((c) => c.op === 'bg').src === 'Other/zz_still_9.png')

  // positions / facial
  const posOpt = run(frames, { positions: { 1: 0.11 }, facial: ['a', 'b'] })
  check('tenkeiprdx positions / facial：站位 1 → 0.11；表情 1 → b', cmds(posOpt).find((c) => c.op === 'spine').x === 0.11 && cmds(posOpt).find((c) => c.op === 'spine').anim === 'b')
  check('tenkeiprdx positionX（旧名）仍合并进 positions', run(frames, { positionX: { 1: 0.22 } }).steps[0].commands.find((c) => c.op === 'spine').x === 0.22)

  // hse：背景名触发的效果
  const hseOpt = run(frames, { hse: { stillRe: 'still_0([2-5])', effects: { 2: [{ op: 'bgse', src: 'BgSe/Custom.ogg', loop: true }] } } })
  check('tenkeiprdx hse：_still_02 默认 Hse5 不循环，覆盖后用自定义指令', cmds(base).find((c) => c.op === 'bgse').src === 'BgSe/Hse5.ogg' && cmds(hseOpt).find((c) => c.op === 'bgse').src === 'BgSe/Custom.ogg' && cmds(hseOpt).find((c) => c.op === 'bgse').loop === true)
  const hseOff = run(frames, { hse: { stillRe: 'never-matches-(\\d)' } })
  check('tenkeiprdx hse.stillRe 不匹配 = 不触发背景音效', !cmds(hseOff).some((c) => c.op === 'bgse' && c.src === 'BgSe/Hse5.ogg'))

  // animations / animationSpeed
  const sp = (r, i) => r.steps[i].commands.find((c) => c.op === 'spine')
  check('tenkeiprdx animations 默认：animation3 倍速 1.5 + Hse3；animation4 不循环 + slow + 闪白；animation5 白屏 1.5', sp(base, 2).speed === 1.5 && sp(base, 3).loop === false && sp(base, 3).slow === true && base.steps[3].commands.some((c) => c.op === 'flash' && c.count === 2) && base.steps[4].commands.find((c) => c.op === 'wash').seconds === 1.5)
  const animOpt = run(frames, { animations: { speed: { animation3: 2 }, noLoop: [], slow: [], flash: { color: 'white', count: 5, seconds: 0.1 }, wash: { animation5: { color: 'black', seconds: 9 } } } })
  check('tenkeiprdx animations 覆盖：倍速 / noLoop / slow / flash / wash 都按表走', sp(animOpt, 2).speed === 2 && sp(animOpt, 3).loop === true && !('slow' in sp(animOpt, 3)) && animOpt.steps[3].commands.find((c) => c.op === 'flash').count === 5 && animOpt.steps[4].commands.find((c) => c.op === 'wash').color === 'black')
  check('tenkeiprdx animationSpeed.msThreshold：500 默认当千分比 → 0.5；阈值 1000 时当原值 500', sp(base, 3).speed === 0.5 && sp(run(frames, { animationSpeed: { msThreshold: 1000 } }), 3).speed === 500)
  check('tenkeiprdx camera.durationMs：没写时长默认 2.5 秒；可改', base.steps[5].commands.find((c) => c.op === 'camera').seconds === 2.5 && run(frames, { camera: { durationMs: 1000 } }).steps[5].commands.find((c) => c.op === 'camera').seconds === 1)

  // fieldMap（数组形）
  const arr = (extra) => { const f = new Array(33).fill(null); f[3] = 'bg_a'; f[12] = 'hello'; for (const [k, v] of Object.entries(extra)) f[k] = v; return J([['2200000320', 1, 1, true, [f]]]) }
  const arrDefault = tk.parse(arr({}), mk(), { stem: 'x' })
  check('tenkeiprdx fieldMap 默认：位置 3 = 背景、12 = 台词', arrDefault.steps[0].commands.find((c) => c.op === 'bg').src === 'Backgrounds/adventure/bg_a.png' && arrDefault.steps[0].commands.find((c) => c.op === 'text').segments[0].text === 'hello')
  const moved = arr({ 3: null, 12: null, 5: 'bg_a', 7: 'hello' })
  const movedDefault = tk.parse(moved, mk(), { stem: 'x' })
  const movedOpt = tk.parse(moved, mk({ fieldMap: { frame: { backgroundImage: 5, phraseContents: 7 } } }), { stem: 'x' })
  check('tenkeiprdx fieldMap：版本变了、字段挪了位置，只改配置：默认下认不出（记 arrayUnknown），改位置后背景 / 台词正确', !movedDefault.steps[0].commands.some((c) => c.op === 'bg') && Boolean(movedDefault.stats.arrayUnknown) && movedOpt.steps[0].commands.find((c) => c.op === 'bg').src === 'Backgrounds/adventure/bg_a.png' && movedOpt.steps[0].commands.find((c) => c.op === 'text').segments[0].text === 'hello', J(movedDefault.stats))
  const charArr = (pos) => { const f = new Array(33).fill(null); const c = [10010101, 0, 3, 0, 0, 2]; const o = new Array(8).fill(null); c.forEach((v, i) => { o[pos[i]] = v }); f[31] = [o]; return J([['2200000320', 1, 1, true, [f]]]) }
  const swapped = charArr([1, 0, 2, 3, 4, 5])   // 角色号在 [1]、外观在 [0]
  const swappedOpt = tk.parse(swapped, mk({ fieldMap: { character: { characterMasterId: 1, characterAppearance: 0 } } }, ['Spines/10010101/10010101_00.skel.bytes']), { stem: 'x' })
  check('tenkeiprdx fieldMap.character：角色字段位置可改（角色号 [1]）', swappedOpt.steps[0].commands.find((c) => c.op === 'spine')?.skel === 'Spines/10010101/10010101_00.skel.bytes', J(swappedOpt.steps[0].commands))
  const withSe = tk.parse(arr({ 20: 'sfx' }), mk({ fieldMap: { frame: { soundEffect: 20 } } }), { stem: 'x' })
  check('tenkeiprdx fieldMap：默认没有位置的字段（soundEffect）可以补上', withSe.steps[0].commands.find((c) => c.op === 'se')?.src === 'Se/sfx.ogg' && !arrDefault.steps[0].commands.some((c) => c.op === 'se'))

  // idRules / kinds / catalog
  const cf = ['scenes/21234.json', 'scenes/21232.json', 'scenes/21231.json', 'scenes/31234.json', 'EpisodeThumbnails/event/ep_eventstill_12_34.png', 'EpisodeThumbnails/extra/ep_eventstill_12_31.png', 'EpisodeThumbnails/special/ep_eventstill_12_33.png']
  const cat = (options) => tk.catalog(mk(options, cf))
  const ids = (tree, kind) => tree.children.find((n) => n.id === kind)?.children.map((c) => c.id)
  const defTree = cat({})
  check('tenkeiprdx idRules 默认：event = 2+第 3、4 段；extra 末位 1 → 2；special 依次试 原样 / 末位 2 / 末位 1（21233 没有 → 21232）', J(ids(defTree, 'event')) === J(['event/21234']) && J(ids(defTree, 'extra')) === J(['extra/21232']) && J(ids(defTree, 'special')) === J(['special/21232']), J(defTree.children.map((n) => [n.id, n.children.map((c) => c.id)])))
  const ruleOpt = cat({ idRules: [{ kind: 'event', segments: [2, 3], prefix: '3' }, { kind: 'extra', segments: [2, 3], prefix: '2', lastDigit: {} }, { kind: 'special', segments: [2, 3], prefix: '2', forms: ['1'] }] })
  check('tenkeiprdx idRules 覆盖：前缀 3 → 31234；extra 不换末位 → 21231；special 只试末位 1 → 21231', J(ids(ruleOpt, 'event')) === J(['event/31234']) && J(ids(ruleOpt, 'extra')) === J(['extra/21231']) && J(ids(ruleOpt, 'special')) === J(['special/21231']), J(ruleOpt.children.map((n) => [n.id, n.children.map((c) => c.id)])))
  const kindOpt = cat({ kinds: [{ id: 'event', label: 'EV', dir: 'event' }] })
  check('tenkeiprdx kinds：只列配置里的分类、标题可改（没列的 extra / special 不出现）', kindOpt.children[0].title === 'EV' && !kindOpt.children.some((n) => n.id === 'extra' || n.id === 'special'), J(kindOpt.children.map((n) => n.id)))
  const labelOpt = cat({ catalog: { labels: { all: 'ALL' } } })
  check('tenkeiprdx catalog.labels：「全部剧情」标题可改', labelOpt.children.at(-1).title === 'ALL' && defTree.children.at(-1).title === '全部剧情')

  // 完整链路
  const tree = {
    'X/scenes/5.json': J2([{ backgroundImage: 'bg_a', backgroundMusic: 'm', phraseContents: 'hi', phraseVoice: 'v' }]),
    'X/Backgrounds/adventure/bg_a.png': 'x', 'X/Backgrounds/still/bg_a.png': 'x', 'X/BGM/m_loop.ogg': 'x', 'X/BGM/m.mp3': 'x',
  }
  const plain = await e2e('tenkeiprdx-json', tree, { root: 'X' }, 'X/scenes/5.json', { resourceRoots: ['X'] })
  const custom = await e2e('tenkeiprdx-json', tree, { root: 'X', paths: { background: ['Backgrounds/still/{name}.png'], bgm: ['BGM/{name}.mp3'], voice: ['AV/{scene}/{name}.ogg'] } }, 'X/scenes/5.json', { resourceRoots: ['X'] })
  check('tenkeiprdx 端到端（config.adapterOptions → 文件索引 → buildScene）：默认 adventure + _loop；覆盖路径模板后 still + .mp3 + 自定义语音目录', ofOp(plain.scene, 'bg')[0].src === 'Backgrounds/adventure/bg_a.png' && ofOp(plain.scene, 'bgm')[0].src === 'BGM/m_loop.ogg' && ofOp(custom.scene, 'bg')[0].src === 'Backgrounds/still/bg_a.png' && ofOp(custom.scene, 'bgm')[0].src === 'BGM/m.mp3' && ofOp(custom.scene, 'voice')[0].src === 'AV/5/v.ogg', J([ofOp(plain.scene, 'bg'), ofOp(custom.scene, 'bgm')]))
  // resourceResolve 现在传给 prepare：背景名大小写不一致也能在索引里找到
  const ci = await e2e('tenkeiprdx-json', { 'scenes/5.json': J2([{ backgroundImage: 'BG_A', phraseContents: 'x' }]), 'Backgrounds/adventure/bg_a.png': 'x' }, {}, 'scenes/5.json')
  const cs = await e2e('tenkeiprdx-json', { 'scenes/5.json': J2([{ backgroundImage: 'BG_A', phraseContents: 'x' }]), 'Backgrounds/adventure/bg_a.png': 'x' }, {}, 'scenes/5.json', { resourceResolve: { caseInsensitive: false } })
  check('tenkeiprdx 用 createIndexResolver：背景名大小写不同也找得到（以前精确匹配），resourceResolve.caseInsensitive=false 回到精确匹配', ofOp(ci.scene, 'bg')[0].src === 'Backgrounds/adventure/bg_a.png' && ofOp(cs.scene, 'bg')[0].src === 'Backgrounds/adventure/BG_A.png' && cs.scene.stats.unresolved['background:BG_A'] === 1, J([ofOp(ci.scene, 'bg'), ofOp(cs.scene, 'bg'), cs.scene.stats]))
}

// ================= 2. misttrain-json =================
{
  const row = (o = {}) => [1, 1, o.speaker ?? '', o.text ?? '', 2, 3, false, null, 0, 0, o.voice ?? '', o.bg ?? '', o.bgm ?? '', o.se ?? '', '', o.effect ?? null, 0, [], o.detail ?? ['', null, null, null, null, null, null]]
  const scene = (rows, id = 224920105) => J([null, [id, rows, [[], [], []], false]])
  const spineFiles = (n, id = '224920105') => Array.from({ length: n }, (_, i) => `Spines/Stills/249/${id}/${i + 1}.skel.bytes`)
  const prep = (options, files, texts = {}) => mt.prepare({ options, texts, files, toResourcePath: (r) => r })
  const run = (rows, options = {}, files = [...spineFiles(5), 'Sounds/Voices/a/v1.ogg', 'Sounds/Voices/b/v1.ogg', 'BackGrounds/bg.png']) => mt.parse(scene(rows), prep(options, files), { stem: '224920105' })
  const rows = [
    row({ text: 'a', effect: '1', voice: 'v1', bg: 'bg.png' }),
    row({ text: 'b', effect: '3', detail: ['animation3', null, 0.5, 100, -50, 2, 15] }),
    row({ text: 'c', effect: '2', detail: ['animation2', 2, null, null, null, null, null] }),
  ]
  const base = run(rows)
  check('misttrain 默认：默认值表整份显式写出来，结果不变', J(run(rows, mt.DEFAULT_OPTIONS)) === J(base))
  const cam = (r) => r.steps[1].commands.find((c) => c.op === 'camera')
  check('misttrain camera 默认：位置 ×0.84、缩放 = 值 + 0.03', cam(base).to[0] === 84 && Math.abs(1 + (cam(base).to[2] / 1000) * 1.3 - 0.53) < 1e-9)
  const camOpt = run(rows, { camera: { positionScale: 1, zoomAdd: 0, zoomUnit: 1, maxSeconds: 1 } })
  check('misttrain camera 覆盖：positionScale 1 → 100；zoomAdd 0 / zoomUnit 1 → 缩放码 -500；maxSeconds 1 → 时长夹到 1', cam(camOpt).to[0] === 100 && cam(camOpt).to[2] === -500 && cam(camOpt).seconds === 1, J(cam(camOpt)))
  const fx = (r, i, op) => r.steps[i].commands.find((c) => c.op === op)
  check('misttrain effects 默认：effect 1 → wash 1 秒；effect 3 → flash 两次 0.3 秒；effect 2 记 stats.raw', fx(base, 0, 'wash').seconds === 1 && fx(base, 1, 'flash').count === 2 && fx(base, 1, 'flash').seconds === 0.3 && base.stats.raw['effect:2'] === 1)
  const fxOpt = run(rows, { effects: { fadeSeconds: 4, flashSeconds: 0.9, flashCount: 5, map: { 1: '', 2: 'wash' } } })
  check('misttrain effects 覆盖：fade / flash 时长和次数；map 里加上 effect 2 → wash；effect 1 写成 \'\' = 关掉（记 raw）', fx(fxOpt, 0, 'wash') === undefined && fxOpt.stats.raw['effect:1'] === 1 && fx(fxOpt, 1, 'flash').count === 5 && fx(fxOpt, 1, 'flash').seconds === 0.9 && fx(fxOpt, 2, 'wash').seconds === 4 && !fxOpt.stats.raw['effect:2'])
  const shot = (r) => r.steps[1].commands.find((c) => c.op === 'spine' && c.anim === 'animation3')
  check('misttrain effects.oneShotRule 默认：总层数 5 的 animation3 = 不循环 + slow；覆盖成空后循环', shot(base).loop === false && shot(base).slow === true && shot(run(rows, { effects: { oneShotRule: { 5: [] } } })).loop === true)
  const bgseOf = (r, i) => r.steps[i].commands.filter((c) => c.op === 'bgse').map((c) => `${c.src.split('/').pop()}:${c.loop}`).join()
  check('misttrain effects.linkedBgSe / loopExcept / fastSpeed：默认 animation3 → Hse4 不循环、animation2 速度 2 → Hse3', bgseOf(base, 1) === 'Hse4.ogg:false' && bgseOf(base, 2) === 'Hse3.ogg:true', bgseOf(base, 1))
  const linkOpt = run(rows, { effects: { linkedBgSe: { 5: { animation3: ['Hse9', 'Hse9'], animation2: ['', ''] } }, loopExcept: [], fastSpeed: 3 } })
  check('misttrain effects 覆盖：animation3 → Hse9、animation2 写成两个空串关掉联动（停掉）、loopExcept 空 → 循环', bgseOf(linkOpt, 1) === 'Hse9.ogg:true' && linkOpt.steps[2].commands.some((c) => c.op === 'bgseStop'), bgseOf(linkOpt, 1))
  check('misttrain 导出的 isOneShot / linkedBgSe 默认行为不变，可传表覆盖', mt.isOneShot(8, 'animation7') && !mt.isOneShot(3, 'animation3') && mt.linkedBgSe(5, 'animation2', 2) === 'Hse3' && mt.linkedBgSe(5, 'animation2', 1, { linkedBgSe: { 5: { animation2: ['A', 'B'] } }, fastSpeed: 1 }) === 'B')

  // voice
  const voiceSrc = (r) => r.steps[0].commands.find((c) => c.op === 'voice')?.src
  check('misttrain voice 默认：同名语音取字典序第一个（a/）；preferDirs 指定目录优先（b/）', voiceSrc(base) === 'Sounds/Voices/a/v1.ogg' && voiceSrc(run(rows, { voice: { preferDirs: ['Sounds/Voices/b'] } })) === 'Sounds/Voices/b/v1.ogg', voiceSrc(base))
  const skip = run(rows, { voice: { duplicates: 'skip' } })
  check('misttrain voice.duplicates = skip：同名不止一个就不播（记未解析）；只有一个时照常', voiceSrc(skip) === undefined && skip.stats.unresolved['voice:v1'] === 1 && voiceSrc(run(rows, { voice: { duplicates: 'skip' } }, [...spineFiles(5), 'Sounds/Voices/a/v1.ogg'])) === 'Sounds/Voices/a/v1.ogg')
  check('misttrain voice.ext / voice.dir：扩展名与目录可改', voiceSrc(run(rows, { voice: { ext: ['wav'] } }, [...spineFiles(5), 'Sounds/Voices/a/v1.wav'])) === 'Sounds/Voices/a/v1.wav' && voiceSrc(run(rows, { voice: { dir: 'Snd' } }, [...spineFiles(5), 'Snd/x/v1.ogg'])) === 'Snd/x/v1.ogg')
  check('misttrain paths：bgm / se / background / 没有索引时的语音路径可改', (() => {
    const r = mt.parse(scene([row({ text: 'x', bgm: 'b1', se: 's1', voice: 'v9', bg: 'bgx' })]), null, { stem: '1' })
    const o = mt.parse(scene([row({ text: 'x', bgm: 'b1', se: 's1', voice: 'v9', bg: 'bgx' })]), prep({ paths: { bgm: 'B/{name}.mp3', se: 'S/{name}.mp3', background: 'G/{name}.jpg', voiceFallback: 'V/{name}.mp3' } }, []), { stem: '1' })
    const g = (x, op) => x.steps[0].commands.find((c) => c.op === op)
    return g(r, 'bgm').src === 'Sounds/Bgms/Adv/b1.ogg' && g(r, 'se').src === 'Sounds/Se/s1.ogg' && g(r, 'bg').src === 'BackGrounds/bgx.png' && g(o, 'bgm').src === 'B/b1.mp3' && g(o, 'se').src === 'S/s1.mp3' && g(o, 'bg').src === 'G/bgx.jpg' && g(o, 'voice').src === 'V/v9.mp3'
  })())

  // titleLookup / scenes
  const sceneFiles = ['UScenes/Stills/249/224920105.json', 'UScenes/55000405/55000405.json']
  const texts = { 'MasterData/MSceneViewModel.json': J([{ Id: 2249201, Title: 'T1' }, { Id: 55000404, Title: 'T2' }]) }
  const titles = (options) => { const tree = mt.catalog(prep(options, sceneFiles, texts)); const all = tree.children.find((n) => n.id === 'all').children; return all.map((c) => c.title).join() }
  check('misttrain titleLookup 默认：去末 2 位 / 原样 / 末位减 1 都试', titles({}) === 'T2,T1', titles({}))
  check('misttrain titleLookup 覆盖：tryMinusOne 关 → 技能场景没有标题；trim 0 → 第一个没有标题', titles({ titleLookup: { tryMinusOne: false } }) === '55000405,T1' && titles({ titleLookup: { trim: 0 } }) === 'T2,224920105', titles({ titleLookup: { trim: 0 } }))
  const dup = ['UScenes/Stills/1/500.json', 'UScenes/500/500.json']
  const baseOf = (options) => prep(options, dup).scenes.get('500').base
  check('misttrain scenes.collision：默认后收到的赢（UScenes/500 → base 空），first 先收到的赢（Stills/1 → base 1）', baseOf({}) === '' && baseOf({ scenes: { collision: 'first' } }) === '1')
  check('misttrain scenes.dirs / stillsDir：目录名可改、可多个（只认列出的）', prep({ scenes: { dirs: ['Scn', 'More'], stillsDir: 'S' } }, ['Scn/S/7/70.json', 'More/80.json', 'UScenes/90.json']).scenes.size === 2 && prep({ scenes: { dirs: ['Scn'], stillsDir: 'S' } }, ['Scn/S/7/70.json']).scenes.get('70').base === '7' && mt.contextDirs({ scenes: { dirs: ['Scn', 'More'] } }).slice(0, 2).join() === 'Scn,More')
  check('misttrain fieldMap.row：行内字段位置可改（text 挪到 [4]）', (() => {
    const r = row({ text: 'moved' }); r[4] = r[3]; r[3] = ''
    const out = mt.parse(scene([r]), prep({ fieldMap: { row: { text: 4 } } }, []), { stem: '1' })
    return out.steps[0]?.commands.find((c) => c.op === 'text').segments[0].text === 'moved' && mt.parse(scene([r]), prep({}, []), { stem: '1' }).steps.length === 0
  })())
  check('misttrain still.defaultAnimation / emoji：可改', run([row({ text: 'x<emoji=heart01>' })], { still: { defaultAnimation: 'animation9' }, emoji: { heart01: '❤' } }).steps[0].commands.some((c) => c.op === 'spine' && c.anim === 'animation9') && run([row({ text: 'x<emoji=heart01>' })], { emoji: { heart01: '❤' } }).steps[0].commands.find((c) => c.op === 'text').segments[0].text === 'x❤')

  // 完整链路
  const tree = {
    'G/UScenes/Stills/249/224920105.json': scene(rows),
    ...Object.fromEntries(spineFiles(5).map((f) => [`G/${f}`, 'x'])),
    'G/Sounds/Voices/a/v1.ogg': 'x', 'G/Sounds/Voices/b/v1.ogg': 'x', 'G/BackGrounds/bg.png': 'x',
  }
  const plain = await e2e('misttrain-json', tree, { root: 'G' }, 'G/UScenes/Stills/249/224920105.json', { resourceRoots: ['G'] })
  const custom = await e2e('misttrain-json', tree, { root: 'G', voice: { preferDirs: ['Sounds/Voices/b'] }, camera: { positionScale: 2 }, effects: { flashCount: 7 } }, 'G/UScenes/Stills/249/224920105.json', { resourceRoots: ['G'] })
  check('misttrain 端到端：默认语音 a/、镜头 ×0.84、闪两次；adapterOptions 覆盖 → 语音 b/、镜头 ×2、闪 7 次', ofOp(plain.scene, 'voice')[0].src === 'Sounds/Voices/a/v1.ogg' && ofOp(custom.scene, 'voice')[0].src === 'Sounds/Voices/b/v1.ogg' && ofOp(plain.scene, 'camera')[0].to[0] === 84 && ofOp(custom.scene, 'camera')[0].to[0] === 200 && ofOp(plain.scene, 'flash')[0].count === 2 && ofOp(custom.scene, 'flash')[0].count === 7, J(ofOp(custom.scene, 'camera')))
  const cfgVoice = await e2e('misttrain-json', tree, { root: 'G' }, 'G/UScenes/Stills/249/224920105.json', { resourceRoots: ['G'], resourceResolve: { preferDirs: ['Sounds/Voices/b'] } })
  check('misttrain 语音走 createIndexResolver：config.resourceResolve.preferDirs 也能挑目录（voice.preferDirs 没写时）', ofOp(cfgVoice.scene, 'voice')[0].src === 'Sounds/Voices/b/v1.ogg', J(ofOp(cfgVoice.scene, 'voice')))
}

// ================= 3. artwhirl-json =================
{
  const rels = ['images/bg/school.jpg', 'images/hcg/ABC/h1/2.webm', 'images/hcg/ABC/h1/2.png', 'images/hcg/ABC/h1/1.mp4', 'images/hcg/ABC/h1/1.png', 'images/stands/ABC/b1/ABC_b1_b_e_r.png', 'images/stands/ABC/b1/ABC_b1_b_e_r_h.png', 'audio/bgm/theme.ogg', 'audio/bgm/theme.mp3', 'audio/voice/g1/ABC_01.ogg', 'audio/voice/g2/ABC_01.ogg']
  const prep = (options, files = rels) => aw.prepare({ options, files: files.map((r) => `game/${r}`), toResourcePath: (r) => r.replace(/^game\//, '') })
  const story = {
    bgms: [null, 1, 1], bgs: [2, 2, 3], voices: [null, 'ABC_01.mp3', null], texts: [null, 'hello', 'h'], names: [null, 4, null], colors: [null, null, null], charas: [null, [5], [6]],
    others: [[], [], []], effects: [null, null, null], waits: [null, null, null], chara_keys: ['ABC'],
    dic: [null, 'bgm/theme.mp3', 'bg/school.jpg', 'chara/ABC/h1/2', 'Alice', { key: 'ABC', body: 'b1', brow: 'x', eye: 'y', lip: 'r', h: true, pos: 0.3 }, { key: 'ABC', body: 'b1', pos: 0 }],
  }
  const text = J(story)
  const run = (options, s = text) => aw.parse(s, prep(options), { stem: 'ep1' })
  const base = run({})
  check('artwhirl 默认：默认值表整份显式写出来，结果不变', J(run(aw.DEFAULT_OPTIONS)) === J(base))
  check('artwhirl 默认：bg/ → images/bg/、bgm .mp3 → .ogg、立绘退回 b/e + 带 h、语音按文件名（g1 字典序第一）、dic 名字、pos 0 保留', cmds(base).find((c) => c.op === 'bg').src === 'images/bg/school.jpg' && cmds(base).find((c) => c.op === 'bgm').src === 'audio/bgm/theme.ogg' && cmds(base).find((c) => c.op === 'stand').parts[0].src === 'images/stands/ABC/b1/ABC_b1_b_e_r_h.png' && cmds(base).find((c) => c.op === 'voice').src === 'audio/voice/g1/ABC_01.ogg' && cmds(base).find((c) => c.op === 'speaker').segments[0].text === 'Alice' && cmds(base).filter((c) => c.op === 'stand')[1].parts[0].xalign === 0, J(cmds(base)))

  // dic.indexFields
  const noNames = run({ dic: { indexFields: ['bgs', 'bgms', 'charas', 'colors'] } })
  check('artwhirl dic.indexFields：names 不再当 dic 下标（名字是整数 4 本身）', cmds(noNames).find((c) => c.op === 'speaker').segments[0].text === '4')
  const noBgs = run({ dic: { indexFields: ['bgms', 'charas', 'names', 'colors'] } })
  check('artwhirl dic.indexFields：bgs 不解 dic → 背景是整数、找不到资源，记 unresolved', !cmds(noBgs).some((c) => c.op === 'bg') && Object.keys(noBgs.stats.unresolved).some((k) => k.startsWith('bg:')), J(noBgs.stats.unresolved))

  // stand.fallback / path / fields
  const noFallback = run({ stand: { fallback: [] } })
  check('artwhirl stand.fallback：清空后 brow/eye 不对就找不到立绘（unresolved）；默认会退回', !cmds(noFallback).some((c) => c.op === 'stand' && c.parts.some((p) => p.src.includes('_h'))) && Object.keys(noFallback.stats.unresolved).some((k) => k.startsWith('stand:')) && base.stats.stands === 2)
  const noH = run({ stand: { fallback: [['brow->b', 'eye->e']] } })
  check('artwhirl stand.fallback：自定义顺序（只退 brow/eye 并保留 h）→ 仍找到 _h', cmds(noH).find((c) => c.op === 'stand').parts[0].src.endsWith('_r_h.png'))
  const pathOpt = run({ stand: { path: 'S/{key}-{body}-{brow}{h}.png' } }, text)
  check('artwhirl stand.path / hSuffix：模板可改', Object.keys(pathOpt.stats.unresolved).some((k) => k.startsWith('stand:')) && aw.parse(text, aw.prepare({ options: { stand: { path: 'S/{key}-{body}-{brow}{h}.png', hSuffix: '+' } }, files: ['game/S/ABC-b1-x+.png', 'game/S/ABC-b1-b.png'], toResourcePath: (r) => r.replace(/^game\//, '') }), { stem: 'e' }).steps.flatMap((s) => s.commands).find((c) => c.op === 'stand').parts[0].src === 'S/ABC-b1-x+.png')
  const fieldOpt = aw.parse(J({ ...story, dic: [null, null, null, null, null, { id: 'ABC', body_x: 'b1', pos: 0.6 }, null] }), prep({ stand: { fields: { key: ['id'], body: ['body_x'] } } }), { stem: 'e' })
  check('artwhirl stand.fields：立绘字典的键名可改（id / body_x）', cmds(fieldOpt).find((c) => c.op === 'stand')?.parts[0].src === 'images/stands/ABC/b1/ABC_b1_b_e_r.png' && cmds(fieldOpt).find((c) => c.op === 'stand').parts[0].xalign === 0.6, J(cmds(fieldOpt)))

  // assets / extPrefer
  const assetsOpt = run({ assets: [{ match: '^bg/(.*)$', replace: 'images/bg/pre_$1' }, ...aw.DEFAULT_OPTIONS.assets] })
  check('artwhirl assets：规则表第一条命中的生效（bg/x → images/bg/pre_x，索引里没有 → unresolved）；默认不变', Object.keys(assetsOpt.stats.unresolved).includes('bg:bg/school.jpg') && cmds(base).some((c) => c.op === 'bg'))
  check('artwhirl extPrefer：.mp3 的偏好写成空数组后 不换 .ogg；默认 .mp3 → 同名 .ogg', cmds(run({ extPrefer: { '.mp3': [] } })).find((c) => c.op === 'bgm').src === 'audio/bgm/theme.mp3' && cmds(base).find((c) => c.op === 'bgm').src === 'audio/bgm/theme.ogg')
  const flip = run({ extPrefer: { '.mp3': ['.flac', '.ogg'] } })
  check('artwhirl extPrefer：偏好列表按顺序试（.flac 没有 → .ogg）', cmds(flip).find((c) => c.op === 'bgm').src === 'audio/bgm/theme.ogg')

  // hcg / video
  const hcgStory = (frame) => J({ ...story, dic: [null, null, null, `chara/ABC/h1/${frame}`], bgs: [3], bgms: [null], voices: [null], texts: ['x'], names: [null], colors: [null], charas: [null], others: [[]], effects: [null], waits: [null] })
  const movie = (options, frame = '2') => cmds(aw.parse(hcgStory(frame), prep(options), { stem: 'e' })).find((c) => c.op === 'movie')
  check('artwhirl video 默认：HCG 同名 .webm → movie 循环；帧名 1 / 4 不循环', movie({}).srcs[0] === 'images/hcg/ABC/h1/2.webm' && movie({}).loop === true && movie({}, '1') === undefined)
  check('artwhirl video.ext / noLoopFrames：.mp4 当视频（帧 1 → 不循环）；noLoopFrames 改成 ["2"] → 帧 2 不循环', movie({ video: { ext: ['mp4'] } }, '1').srcs[0] === 'images/hcg/ABC/h1/1.mp4' && movie({ video: { ext: ['mp4'] } }, '1').loop === false && movie({ video: { noLoopFrames: ['2'] } }).loop === false && movie({ video: { ext: ['webm', 'mp4'] } }).srcs.length === 1)
  const hcgMatch = cmds(aw.parse(hcgStory('2'), prep({ hcg: { match: '^never$' } }), { stem: 'e' }))
  check('artwhirl hcg.match：不当 HCG 时走普通资源规则（不查视频）', !hcgMatch.some((c) => c.op === 'movie'))

  // voice
  const voiceOf = (options) => cmds(run(options)).find((c) => c.op === 'voice')?.src
  check('artwhirl voice.preferDirs：同名语音挑目录（g2 优先）；voice.ext 的 .mp3 写成空串后名字不换扩展名、找不到（unresolved）；voice.dir 可改', voiceOf({ voice: { preferDirs: ['audio/voice/g2'] } }) === 'audio/voice/g2/ABC_01.ogg' && voiceOf({ voice: { ext: { '.mp3': '' } } }) === undefined && voiceOf({ voice: { dir: 'audio/other' } }) === undefined)
  const bare = aw.parse(text, aw.prepare({ options: { voice: { fallback: 'v/{stem}/{name}' } }, files: [], toResourcePath: (r) => r }), { stem: 'ep1' })
  check('artwhirl voice.fallback：没有索引时的路径模板', cmds(bare).find((c) => c.op === 'voice').src === 'v/ep1/ABC_01.ogg')
  check('artwhirl standZoom / root / dirs', cmds(run({ standZoom: 2 })).find((c) => c.op === 'stand').parts[0].zoom === 2 && aw.contextDirs({}).join() === 'game/images,game/audio' && aw.contextDirs({ root: 'R', dirs: ['pics'] }).join() === 'R/pics' && aw.contextDirs({ root: '' }).join() === 'images,audio')

  // 完整链路
  const tree = Object.fromEntries([...rels.map((r) => [`game/${r}`, 'x']), ['game/story/ep1.json', text]])
  const plain = await e2e('artwhirl-json', tree, {}, 'game/story/ep1.json', { resourceRoots: ['game'] })
  const custom = await e2e('artwhirl-json', tree, { voice: { preferDirs: ['audio/voice/g2'] }, extPrefer: { '.mp3': [] }, dic: { indexFields: ['bgs', 'bgms', 'charas', 'colors'] } }, 'game/story/ep1.json', { resourceRoots: ['game'] })
  check('artwhirl 端到端：默认 g1 语音 + .ogg + 名字 Alice；adapterOptions 覆盖 → g2 语音、.mp3、名字 4', ofOp(plain.scene, 'voice')[0].src === 'audio/voice/g1/ABC_01.ogg' && ofOp(plain.scene, 'bgm')[0].src === 'audio/bgm/theme.ogg' && ofOp(plain.scene, 'speaker')[0].segments[0].text === 'Alice' && ofOp(custom.scene, 'voice')[0].src === 'audio/voice/g2/ABC_01.ogg' && ofOp(custom.scene, 'bgm')[0].src === 'audio/bgm/theme.mp3' && ofOp(custom.scene, 'speaker')[0].segments[0].text === '4', J(ofOp(custom.scene, 'voice')))
  const ciTree = { ...tree, 'game/story/ep1.json': text.replace('theme.mp3', 'THEME.mp3') }
  const ci = await e2e('artwhirl-json', ciTree, {}, 'game/story/ep1.json', { resourceRoots: ['game'] })
  const cs = await e2e('artwhirl-json', ciTree, {}, 'game/story/ep1.json', { resourceRoots: ['game'], resourceResolve: { caseInsensitive: false } })
  check('artwhirl 用 createIndexResolver：bgm 名大小写不同也找得到（以前精确匹配）；resourceResolve.caseInsensitive=false 回到精确匹配（记 unresolved）', ofOp(ci.scene, 'bgm')[0]?.src === 'audio/bgm/theme.ogg' && ofOp(cs.scene, 'bgm').length === 0 && Object.keys(cs.scene.stats.unresolved).some((k) => k.startsWith('bgm:')), J([ofOp(ci.scene, 'bgm'), cs.scene.stats.unresolved]))
}

// ================= 4. girlscreation-tag（+ line）=================
{
  const files = ['pk/scenes/c1/script.txt', 'pk/scenes/c1/output_script.txt', 'pk/scenes/c1/script_original.txt', 'pk/scenes/c1/thumbnail.png', 'pk/scenes/c1/images/bg1.png', 'pk/scenes/c1/images/f_0000.webp', 'pk/scenes/c1/images/f_0001.webp', 'pk/scenes/c1/images/f_0002.webp', 'pk/scenes/c1/animations/f_0.jpg', 'pk/scenes/c1/animations/f_1.jpg', 'pk/scenes/c1/animations/f_2.jpg', 'pk/scenes/c1/spines/cast1/x.skel', 'pk/scenes/c1/spines/cast1/x.atlas',
    'pk/scenes/9z/output_script.txt', 'pk/scenes/ab_2/hmr_ab_2.txt', 'pk/data/audio/bgm/b1.m4a']
  const texts = {
    'pk/scenes/c1/script.txt': '<NAME_PLATE>館長\nhi\n<PAUSE>\n<NAME_PLATE>アリス（オルタ）\nyo\n<PAUSE>\n<NAME_PLATE>アリス\nyo2\n<PAUSE>\n<NAME_PLATE>ボブ\nx\n<PAUSE>\n',
    'pk/scenes/c1/script_original.txt': 'title,第一話,\n', 'pk/scenes/9z/output_script.txt': '<NAME_PLATE>館長\nhi\n<PAUSE>\n', 'pk/scenes/ab_2/hmr_ab_2.txt': 'title,行式の題,\nmessage,甲,こんにちは,\n',
  }
  const prep = (options, f = files, t = texts) => gc.prepare({ options: { root: 'pk', ...options }, texts: t, files: f, toResourcePath: (r) => r.replace(/^pk\//, '') })
  const speakers = (options) => { const ctx = prep(options); return [...ctx.info].map(([id, i]) => `${id}:${i.speaker}`).join() }
  const base = speakers({})
  check('girlscreation 默认：館長不当主要说话人、（オルタ）后缀合并（アリス 2 次）、行式脚本的说话人也统计', base === 'c1:アリス,9z:,ab_2:甲', base)
  check('girlscreation 默认：默认值表整份显式写出来，结果不变', speakers({ ...gc.DEFAULT_OPTIONS, root: 'pk' }) === base)
  check('girlscreation player：旧写法字符串 / 新写法数组 / { names }；館長改成别人后館長算说话人', speakers({ player: '館長' }) === base && speakers({ player: { names: ['館長', 'アリス'] } }) === 'c1:ボブ,9z:,ab_2:甲' && speakers({ player: ['館長', 'アリス'] }) === 'c1:ボブ,9z:,ab_2:甲' && speakers({ player: { names: ['x'] } }).includes('9z:館長'), speakers({ player: { names: ['x'] } }))
  check('girlscreation speaker.suffixRe：清空后「アリス（オルタ）」单独算一人（1 次对 1 次，字典序/次数先到先得）', prep({ speaker: { suffixRe: '(?!)' } }).info.get('c1').speaker !== '' && girlsOptions({ speaker: { suffixRe: 'x' } }).speaker.suffixRe === 'x')
  check('girlscreation titleLines：标题来自原始脚本的 title 行；改正则后取别的行', prep({}).info.get('c1').title === '第一話' && prep({ titleLines: ['^題,([^,]+),'] }).info.get('c1').title === '' && prep({ titleLines: ['^title,([^,\\r\\n]+),', '^題,([^,]+),'] }, files, { ...texts, 'pk/scenes/9z/script_original.txt': '題,別名,\n' }).info.get('9z').title === '別名')
  const scriptOf = (options) => prep(options).scenes.get('c1').script
  check('girlscreation scenes.script：script.txt > output_script.txt > 行式脚本（可改优先级）；lineScript 正则可改', scriptOf({}) === 'pk/scenes/c1/script.txt' && scriptOf({ scenes: { script: ['output_script.txt', 'script.txt'] } }) === 'pk/scenes/c1/output_script.txt' && prep({}).scenes.get('ab_2').script.endsWith('hmr_ab_2.txt') && !prep({ scenes: { lineScript: '^nothing$' } }).scenes.has('ab_2'))
  check('girlscreation scenes.thumb / dirs / sceneDirs / audioKinds', prep({}).scenes.get('c1').thumb === 'scenes/c1/thumbnail.png' && prep({ scenes: { thumb: '^cover' } }).scenes.get('c1').thumb === '' && prep({ sceneDirs: { images: 'pics' } }, files.map((f) => f.replace('/images/', '/pics/'))).scenes.get('c1').images.has('bg1') && prep({ audioKinds: ['se'] }).audio.bgm === undefined && gc.contextDirs({ root: 'pk', dirs: { scenes: 'sc' } }).join() === 'pk/sc,pk/data/audio,pk/data/spine')
  const sampled = (options, rel) => gc.contextTextFilter({ root: 'pk', ...options })(rel)
  check('girlscreation sample.files：哪些文件开头要读进来（默认 script / output_script / script_original / hmr_…）可改', sampled({}, 'pk/scenes/c1/script_original.txt') && !sampled({}, 'pk/scenes/c1/notes.txt') && sampled({ sample: { files: ['/notes\\.txt$'] } }, 'pk/scenes/c1/notes.txt') && !sampled({ sample: { files: ['/notes\\.txt$'] } }, 'pk/scenes/c1/script.txt'))
  const catOf = (options) => gc.catalog(prep(options)).children.map((n) => `${n.id}[${n.children.map((c) => c.title).join('|')}]`).join()
  check('girlscreation category：默认分类 = 开头字母（c / ab / 数字开头 → 其他）；未识别说话人分组；re / other / unknownSpeaker 可改', catOf({}) === 'c/ab[甲],c/c[アリス],c/其他[（未识别）]' && catOf({ category: { re: '^[a-z]', other: 'OTHER', unknownSpeaker: '?' } }) === 'c/a[甲],c/c[アリス],c/OTHER[?]', catOf({ category: { re: '^[a-z]', other: 'OTHER', unknownSpeaker: '?' } }))

  // 解析：方言 / 站位 / 帧数
  const ctx = prep({})
  const run = (text, options = {}, rel = 'c1/script.txt') => gc.parse(text, prep(options), { rel })
  const aku = ['<GROUP><FADE_IN>black,0', '<SPINE_ACTOR>1,cast1/x,,CENTER,LEFT,NONE,linear,0', '<SPINE_ACTOR_DISPLAY>1,SHOW', '<NAME_PLATE>甲', 'x', '<PAUSE>'].join('\n')
  const akuOut = run(aku)
  check('girlscreation dialect 默认：出现 <GROUP> 等标记 = Aku 写法（stats.dialect = aku；横向 LEFT → -450）', akuOut.stats.dialect === 'aku' && akuOut.steps.flatMap((s) => s.commands).find((c) => c.op === 'spine').x === -450, J(akuOut.stats))
  const akuAlt = run(aku, { dialect: { markers: { aku: ['<NEVER>'] } } })
  check('girlscreation dialect.markers.aku：改标记后这份脚本不再按 Aku 处理（FADE_IN 按标签式含义）', akuAlt.stats.dialect === undefined)
  check('girlscreation dialect.window：只看开头这么多字符（标记在窗口外 = 认不出）', run(`${'\n'.repeat(50)}${aku}`, { dialect: { window: 20 } }).stats.dialect === undefined && run(`${'\n'.repeat(50)}${aku}`).stats.dialect === 'aku')
  const akuOffset = run(aku, { stand: { akuOffset: 100 } })
  check('girlscreation stand.akuOffset / akuDirections：偏移 100 → -100；LEFT 方向改成 1 → +450', akuOffset.steps.flatMap((s) => s.commands).find((c) => c.op === 'spine').x === -100 && run(aku, { stand: { akuDirections: { LEFT: 1 } } }).steps.flatMap((s) => s.commands).find((c) => c.op === 'spine').x === 450)
  const far = aku.replace('LEFT', 'FAR')
  check('girlscreation stand.akuDirections：没列出的横向取值（FAR）记 raw、x = 0；加上 FAR: 1 → +450 且不再记 raw', run(far).stats.raw['SPINE_ACTOR(横向 FAR)'] === 1 && run(far).steps.flatMap((s) => s.commands).find((c) => c.op === 'spine').x === 0 && run(far, { stand: { akuDirections: { FAR: 1 } } }).steps.flatMap((s) => s.commands).find((c) => c.op === 'spine').x === 450 && !run(far, { stand: { akuDirections: { FAR: 1 } } }).stats.raw['SPINE_ACTOR(横向 FAR)'])
  const fruit = ['<ACTOR>1,B_00,CENTER,CENTER,NONE,linear,0,1,,,0,0,0,0,0,0', '<ACTOR_COLOR_FILTER>1,dark', '<NAME_PLATE>甲', 'x', '<PAUSE>'].join('\n')
  const fruitFiles = [...files, 'pk/scenes/c1/images/B_00.png']
  const fruitDim = (options) => gc.parse(fruit, gc.prepare({ options: { root: 'pk', ...options }, texts, files: fruitFiles, toResourcePath: (r) => r.replace(/^pk\//, '') }), { rel: 'c1/script.txt' }).steps.flatMap((s) => s.commands).filter((c) => c.op === 'stand').at(-1).parts[0].dim
  check('girlscreation stand.fruitsDim：ACTOR_COLOR_FILTER dark 的压暗值 0.6 → 可改', fruitDim({}) === 0.6 && fruitDim({ stand: { fruitsDim: 0.3 } }) === 0.3)
  const anim = '<ANIM_PLAY>0,f_,4,0,3,1,1,17\n<NAME_PLATE>甲\nx\n<PAUSE>'
  const frames = (options) => run(anim, options).steps.flatMap((s) => s.commands).find((c) => c.op === 'bg')?.frames?.length
  check('girlscreation animation.maxFrames：ANIM_PLAY 最多收 600 帧 → 改成 2 只收 2 帧', frames({}) === 3 && frames({ animation: { maxFrames: 2 } }) === 2)
  const fa = (options) => run('<FRAME_ANIM>f,0,2,1\n<NAME_PLATE>甲\nx\n<PAUSE>', options).steps.flatMap((s) => s.commands).find((c) => c.op === 'bg')?.frames?.length
  check('girlscreation animation.maxFrames：FRAME_ANIM 同一个上限', fa({}) === 3 && fa({ animation: { maxFrames: 2 } }) === 2)
  const dialect = run('<LABEL>A\n<NAME_PLATE>甲\nx\n<PAUSE>', { dialect: { markers: { branch: ['<NOPE>'] } } })
  check('girlscreation dialect.markers.branch：没有这些标签时 <LABEL> 不当分支（记 raw）', dialect.stats.raw.LABEL === 1 && !run('<LABEL>A\n<NAME_PLATE>甲\nx\n<PAUSE>').stats.raw.LABEL)
  const lineHead = 'message,甲,こんにちは,\nmessage,甲,二,\nchara,cast1/x,chara_1,0,0,0,1,1,0,on\nwait,1'
  check('girlscreation dialect.headWindow：标签式 / 行式的区分只看开头这么多字符；默认认出行式，窗口太小就认不出（按标签式解析）', run(lineHead, {}, 'ab_2/hmr_ab_2.txt').stats.form === 'line' && run(lineHead, { dialect: { headWindow: 5 } }, 'ab_2/hmr_ab_2.txt').stats.form === undefined)
  const lineText = ['chara,cast1/x,chara_1,0,0,0,1,1,0,on', 'charamotion,1,joy,on', 'message,甲,台词,iab4020078', 'message,乙,台词2,xyz'].join('\n')
  const lineRun = (options) => gc.parse(lineText, prep(options), { rel: 'c1/hmr_c1.txt' })
  const track1 = (r) => r.steps.flatMap((s) => s.commands).filter((c) => c.op === 'spine').at(-1).tracks.find((t) => t.track === 1)?.anim
  check('girlscreation line.expressionPrefix：charamotion 的表情动画 ex_joy → 可改', track1(lineRun({})) === 'ex_joy' && track1(lineRun({ line: { expressionPrefix: 'face_' } })) === 'face_joy', track1(lineRun({})))
  const texts2 = (r) => r.steps.map((s) => s.commands.find((c) => c.op === 'text').segments[0]?.text)
  check('girlscreation line.imageIdRe：message 末尾头像 id 的写法可改（默认 iab4020078 被去掉，xyz 不是头像 id 留在台词里）', J(texts2(lineRun({}))) === J(['台词', '台词2,xyz']) && J(texts2(lineRun({ line: { imageIdRe: '^xyz$' } }))) === J(['台词,iab4020078', '台词2']), J(texts2(lineRun({}))))
  void ctx

  // 完整链路
  const tree = {
    'pk/scenes/c1/script.txt': texts['pk/scenes/c1/script.txt'], 'pk/scenes/c1/script_original.txt': texts['pk/scenes/c1/script_original.txt'], 'pk/scenes/c1/thumbnail.png': 'x',
    'pk/scenes/c1/images/f_0000.webp': 'x', 'pk/scenes/c1/images/f_0001.webp': 'x', 'pk/scenes/c1/images/f_0002.webp': 'x',
    'pk/scenes/c1/spines/cast1/x.skel': 'x', 'pk/scenes/c1/spines/cast1/x.atlas': 'x',
  }
  const akuTree = { ...tree, 'pk/scenes/c1/script.txt': aku }
  const g = (t, options) => e2e('girlscreation-tag', t, { root: 'pk', ...options }, 'pk/scenes/c1/script.txt', { resourceRoots: ['pk'] }, 'c1/script.txt')
  const plain = await g(akuTree, {})
  const custom = await g(akuTree, { stand: { akuOffset: 200 }, player: { names: ['x'] } })
  const off = await g(akuTree, { dialect: { markers: { aku: ['<NEVER>'] } } })
  check('girlscreation 端到端（config.adapterOptions → 文件索引 → buildScene）：Aku 偏移 -450 / -200；换掉 aku 标记后不再是 Aku 写法', ofOp(plain.scene, 'spine')[0].x === -450 && ofOp(custom.scene, 'spine')[0].x === -200 && plain.scene.stats.dialect === 'aku' && off.scene.stats.dialect === undefined, J(plain.scene.stats))
  const who = async (options) => gc.catalog((await g(tree, options)).ctx).children[0].children[0].title
  check('girlscreation 端到端：目录树里的主要说话人受 player.names 影响（默认 アリス；把アリス当主角后换成 ボブ）', (await who({})) === 'アリス' && (await who({ player: { names: ['館長', 'アリス'] } })) === 'ボブ', `${await who({})} ${await who({ player: { names: ['館長', 'アリス'] } })}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
