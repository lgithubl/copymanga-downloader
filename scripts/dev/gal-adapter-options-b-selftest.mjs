#!/usr/bin/env node
// 自测（纯 node，不需要浏览器）：utage-book / grenze-xml 的 adapterOptions —— 每个选项各一条：
//   默认值（不给选项 / 给空对象）的结果和以前一样，覆盖之后的结果按文档变化；最后各有一条端到端（loadAdapterContext + config.adapterOptions + meta.config）。
//   node scripts/dev/gal-adapter-options-b-selftest.mjs
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { galAdapter } from '../../web/library/gal/adapters/index.mjs'
import * as utage from '../../web/library/gal/adapters/utage-book.mjs'
import * as grenze from '../../web/library/gal/adapters/grenze-xml.mjs'
import { expandTemplate, mergeOptions } from '../../web/library/gal/adapters/path-templates.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { R, T } from './make-tsk-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const same = (a, b) => J(a) === J(b)

// ================= 共用模板 =================
check('路径模板：{x} / {x:ext} / 多值 {ext} 按数组顺序展开；缺值的候选整条丢掉；mergeOptions 对象逐层合并、数组整个替换、free 表逐条覆盖',
  same(expandTemplate('a/{n}.{ext}', { n: 'x', ext: ['webp', 'png'] }), ['a/x.webp', 'a/x.png']) && same(expandTemplate('{f:png}', { f: 'a/b' }), ['a/b.png']) && same(expandTemplate('{f:png}', { f: 'a/b.jpg' }), ['a/b.jpg']) && expandTemplate('{n}', {}).length === 0
  && same(mergeOptions({ a: { b: 1, c: [1] }, t: { x: 1 } }, { a: { c: [2] }, t: { y: 'z' } }, ['t']), { a: { b: 1, c: [2] }, t: { x: 1, y: 'z' } }), '')

// ================= utage-book =================
const B = (rows) => JSON.stringify({ importGridList: [{ name: 'g', rows: [{ strings: ['Command', 'Arg1', 'Arg2', 'Arg3', 'Arg4', 'Arg5', 'Arg6', 'Skin', 'SpineAnim', 'SpineSubAnim', 'AnimCompType', 'AnimSpd', 'WaitType', 'Text', 'PageCtrl', 'Voice', 'WindowType'] }, ...rows].map((row, i) => ({ rowIndex: i, isEmpty: 0, isCommentOut: 0, ...row })) }] })
const table = (name, header, rows) => ({ name, rows: [{ strings: header }, ...rows.map((strings) => ({ strings }))] })
const MASTER = JSON.stringify({ settingList: [
  table('Master.chapter:Character', ['', 'CharacterName', 'NameText', 'FileName', 'FileType'], [['', 'ミナ-制服', 'ミナ', 'Characters/ch_100/ch_100_m0_SkeletonData.asset', 'Spine'], ['', 'ルカ-私服-春', '', 'Characters/ch_200/ch_200_m0_SkeletonData.asset', 'Spine'], ['', 'ノア-制服', '', 'Characters/ch_300/ch_300_m0.asset', 'Spine']]),
  table('Master.chapter:Texture', ['', 'Label', 'Type', 'FileName'], [['', 'bgA', 'Bg', 'Adventure/BackGrounds/bgA_file']]),
  table('Master.chapter:Sound', ['', 'Label', 'Type', 'IntroFileName', 'FileName'], [['', 'BGM1', 'Bgm', 'Sound/Bgm/b1_intro.ogg', 'Sound/Bgm/b1_loop.ogg'], ['', 'SE1', 'Se', '', 'Sound/Se/se1_file.ogg']]),
] })
const FILES = [
  'Adventure/MainScenario/M1.book.json', 'Adventure/CharaScenario/C1.book.json', 'Adventure/OtherScenario/O1.book.json', 'Adventure/Master.chapter.json',
  'Adventure/BackGrounds/bgA_file.png', 'Adventure/BackGrounds/bgB.jpg', 'Adventure/Custom/bgC.png',
  'Characters/ch_100/ch_100_m0.skel.bytes', 'Characters/ch_200/ch_200_m0.skel.bytes', 'Characters/ch_300/ch_300_m0.skel.bytes', 'Characters/ch_300/ch_300_m0.atlas.txt', 'Characters/ch_300/ch_300_m0.alt.skel.bytes',
  'Stills/st_1/st_1_a.skel.bytes', 'Stills/st_1/st_1_b.skel.bytes', 'Stills/st_1/other.skel.bytes',
  'Sound/Voice/ImportChara/100/v1.ogg', 'Sound/BgVoice/v1.ogg', 'Sound/BgVoice/bv1.ogg', 'Sound/Voice/ImportChara/200/dup.ogg', 'Sound/Voice/Zeta/dup.ogg', 'Sound/Voice/Alpha/dup2.ogg', 'Sound/Voice/Beta/dup2.ogg',
  'Sound/Se/se1_file.ogg', 'Sound/Se/se2.ogg', 'Sound/BgSe/se3.ogg', 'Sound/Bgm/b1_intro.ogg', 'Sound/Bgm/b1_loop.ogg', 'Sound/Bgm/BGM9.ogg', 'Extra/x.ogg',
]
const uPrep = (options, files = FILES) => utage.prepare({ options, texts: { 'Adventure/Master.chapter.json': MASTER }, files })
const uRun = (rows, options = {}, config = undefined, files = FILES) => utage.parse(B(rows), uPrep(options, files), { options, config: config && { resourceResolve: config } })
const flat = (out) => out.steps.flatMap((s) => s.commands)
const opsOf = (out, op) => flat(out).filter((c) => c.op === op)
const seg = (c) => (c.segments || []).map((s) => s.text).join('')
const speakerOf = (out) => seg(opsOf(out, 'speaker')[0] || {})
const stand = (a1, a3, a4 = '', extra = {}) => T({ a1, a3, a4, anim: 'wait', ...extra })

{
  const dflt = utage.resolveOptions({})
  check('utage 默认选项 = 文档里的默认值（schema）；未知字段保留、类型不对的丢掉用默认', dflt.screenWidth === 1280 && same(dflt.standX, { slotBase: 0.5, argIndex: 4 }) && dflt.off.mode === 'speakerOnly' && utage.resolveOptions({ screenWidth: 'x', standX: { argIndex: 'q' }, speaker: 5 }).screenWidth === 1280 && utage.resolveOptions({ screenWidth: 'x', standX: { argIndex: 'q' }, speaker: 5 }).standX.argIndex === 4 && utage.resolveOptions({ foo: 1 }).foo === 1, J(dflt.standX))

  // standX / screenWidth
  const standRows = [stand('ミナ-制服', 'Chara1', '250', { a5: '100' }), T({ a1: 'ミナ-制服', text: 'x' })]
  const x0 = opsOf(uRun(standRows), 'spine')[0].x
  check('utage standX / screenWidth：默认 x = 0.5 + Arg4 / 1280；slotBase / argIndex / screenWidth 覆盖后按新的算', x0 === 0.5 + 250 / 1280 && opsOf(uRun(standRows, { standX: { slotBase: 0.25, argIndex: 5 }, screenWidth: 1000 }), 'spine')[0].x === 0.25 + 100 / 1000, String(x0))

  // slots / slotPrefix
  const slotOf = (options) => opsOf(uRun(standRows, options), 'spine')[0]?.slot
  check('utage slots：默认 Chara1 → Chara1；表里改名；映射成空 = 丢掉这个槽；表外的槽原样用；slotPrefix 管 CharacterOff 的整批前缀',
    slotOf({}) === 'Chara1' && slotOf({ slots: { Chara1: 'Left' } }) === 'Left' && slotOf({ slots: { Chara1: '' } }) === undefined && opsOf(uRun([stand('ミナ-制服', 'Chara9'), R('CharacterOff'), T({ text: 'x' })]), 'spine')[0].slot === 'Chara9'
    && opsOf(uRun([stand('ミナ-制服', 'Chara1'), R('CharacterOff'), T({ text: 'x' })]), 'spineOff')[0].prefix === 'Chara' && opsOf(uRun([stand('ミナ-制服', 'Chara1'), R('CharacterOff'), T({ text: 'x' })], { slotPrefix: 'Slot' }), 'spineOff')[0].prefix === 'Slot', '')

  // off
  const offRows = [stand('ミナ-制服', 'Chara1'), T({ a1: 'ミナ-制服', a2: '<Off>', text: 'x' })]
  const offHide = { off: { mode: 'hide' } }
  check('utage off：默认 <Off> = 只出名字和台词、立绘不动；mode hide = 同时 spineOff 这个角色的槽；off.arg 换成别的标记',
    opsOf(uRun(offRows), 'spineOff').length === 0 && same(opsOf(uRun(offRows, offHide), 'spineOff'), [{ op: 'spineOff', slot: 'Chara1' }])
    && opsOf(uRun([stand('ミナ-制服', 'Chara1'), T({ a1: 'ミナ-制服', a2: '<Hide>', a3: 'Chara1', text: 'x' })], { off: { mode: 'hide', arg: '^<Hide>$' } }), 'spineOff').length === 1
    && opsOf(uRun([T({ a1: 'ミナ-制服', a2: '<Off>', a3: 'Chara1', text: 'x' })], { off: { arg: '^<Other>$' } }), 'spine').length === 1, '')

  // speaker
  const who = (key, options, a2 = '') => speakerOf(uRun([T({ a1: key, a2, text: 'x' })], options))
  check('utage speaker：默认 NameText → 名字里最后一个 - 之前；source / splitOn / pick 改变取法；characterArg 的正则可换',
    who('ミナ-制服') === 'ミナ' && who('ルカ-私服-春') === 'ルカ-私服' && who('ルカ-私服-春', { speaker: { pick: 'first' } }) === 'ルカ' && who('ルカ-私服-春', { speaker: { pick: 'last' } }) === '春'
    && who('ミナ-制服', { speaker: { source: ['key'] } }) === 'ミナ' && who('ミナ-制服', { speaker: { source: ['raw'] } }) === 'ミナ-制服' && who('ルカ-私服-春', { speaker: { splitOn: '_' } }) === 'ルカ-私服-春' && who('ミナ-制服', { speaker: { source: [] } }) === '', '')
  check('utage speaker.characterArg：默认 <Character=名字> 改说话人（走同样的取名规则）；换正则后 [名字] 才算',
    who('ミナ-制服', {}, '<Character=ルカ-私服-春>') === 'ルカ-私服' && who('ミナ-制服', {}, '[ルカ-私服-春]') === 'ミナ' && who('ミナ-制服', { speaker: { characterArg: '^\\[(.*)\\]$' } }, '[ルカ-私服-春]') === 'ルカ-私服', '')

  // bgm
  const bgm = (options) => opsOf(uRun([R('Bgm', { a1: 'BGM1' }), T({ text: 'x' })], options), 'bgm')[0]
  check('utage bgm.play：默认 loop（intro 记在 intro 字段）；intro = 放 intro；intro+loop = 放 intro、loop 记在 loop 字段',
    same(bgm({}), { op: 'bgm', src: 'Sound/Bgm/b1_loop.ogg', intro: 'Sound/Bgm/b1_intro.ogg' }) && same(bgm({ bgm: { play: 'intro' } }), { op: 'bgm', src: 'Sound/Bgm/b1_intro.ogg' }) && same(bgm({ bgm: { play: 'intro+loop' } }), { op: 'bgm', src: 'Sound/Bgm/b1_intro.ogg', loop: 'Sound/Bgm/b1_loop.ogg' })
    && opsOf(uRun([R('Bgm', { a1: 'BGM9' }), T({ text: 'x' })]), 'bgm')[0].src === 'Sound/Bgm/BGM9.ogg', J(bgm({})))

  // tween
  const tweenRows = [stand('ミナ-制服', 'Chara1'), R('Tween', { a1: 'ミナ-制服', a2: 'MoveBy', a3: 'y=-30', a5: 'pingPong' }), R('Tween', { a1: 'ミナ-制服', a2: 'MoveBy', a3: 'x=128 time=1' }), R('Tween', { a1: 'ミナ-制服', a2: 'MoveTo', a3: 'x=-128' }), R('Tween', { a1: 'ミナ-制服', a2: 'ColorTo', a3: 'x=1' }), T({ text: 'x' })]
  const tw = (options) => { const out = uRun(tweenRows, options); return { actions: opsOf(out, 'spine').map((c) => c.action).filter(Boolean), xs: opsOf(out, 'spine').slice(1).filter((c) => !c.action).map((c) => c.x), raw: out.stats.raw } }
  check('utage tween：默认 MoveBy+pingPong → 动作 3、MoveBy → 改 x、MoveTo → 改 x、ColorTo → raw；kinds / actions / returnWhen 覆盖后改变',
    same(tw({}), { actions: [3], xs: [0.5 + 128 / 1280, 0.5 - 128 / 1280], raw: { 'Tween:ColorTo': 1 } })
    && same(tw({ tween: { kinds: { MoveBy: 'raw' } } }).raw, { 'Tween:MoveBy': 2, 'Tween:ColorTo': 1 }) && tw({ tween: { kinds: { MoveBy: 'raw' } } }).actions.length === 0
    && same(tw({ tween: { actions: { down: 9 } } }).actions, [9]) && tw({ tween: { returnWhen: 'never' } }).actions.length === 0 && tw({ tween: { kinds: { MoveBy: { returns: 'moveBy', else: 'action' } } } }).actions.length === 1 && tw({ tween: { kinds: { ColorTo: 'moveTo' } } }).xs.length === 3, J(tw({})))
  const shakeOut = (options) => opsOf(uRun([stand('ミナ-制服', 'Chara1'), R('Shake', { a1: 'ミナ-制服', a3: 'x=5' }), R('Shake', { a1: 'ミナ-制服', a3: 'y=5' }), T({ text: 'x' })], options), 'spine').map((c) => c.action).filter(Boolean)
  check('utage tween.actions 同样管 Shake 角色：默认 x → 2、y → 1', same(shakeOut({}), [2, 1]) && same(shakeOut({ tween: { actions: { x: 7, up: 8 } } }), [7, 8]), J(shakeOut({})))

  // selection
  const selRows = [R('Selection', { a1: '*S-a-1', text: 'A' }), R('Selection', { a1: '*S-a-2', text: 'B' }), R('Selection', { a1: '*plain', text: 'C' }), R('Selection', { a1: '*other', text: 'D' }), R('*S-a-1'), T({ text: '1' }), R('*S-a-2'), T({ text: '2' }), R('*plain'), T({ text: '3' }), R('*other'), T({ text: '4' })]
  const sel = (options) => opsOf(uRun(selRows, options), 'choice').map((c) => c.options.map((o) => seg(o)).join('|'))
  check('utage selection：默认按去掉 -数字 分组、没有后缀的相邻行算一组（A|B 和 C|D 两个 choice）；groupSuffix 换了 / adjacentGroups=false 后分组改变',
    same(sel({}), ['A|B', 'C|D']) && same(sel({ selection: { groupSuffix: '-x$' } }), ['A|B|C|D']) && same(sel({ selection: { adjacentGroups: false } }), ['A|B', 'C', 'D']), J(sel({})))

  // folderLabels
  const tree = (options) => uPrep(options).catalogTree.children.map((n) => [n.title, n.subtitle])
  check('utage folderLabels：默认 MainScenario → 主线 / CharaScenario → 角色剧情（按规则顺序排，没匹配的排最后；副标题带文件夹名）',
    same(tree({}).map((x) => x[0]), ['主线', '角色剧情', 'OtherScenario', '全部剧情']) && tree({})[0][1] === 'MainScenario · 1 个', J(tree({})))
  check('utage folderLabels（续）：覆盖后换名、换序、其它没匹配的保持原名',
    same(tree({ folderLabels: [['^Other', 'Other!'], ['^Main', 'Main!']] }).map((x) => x[0]), ['Other!', 'Main!', 'CharaScenario', '全部剧情']) && same(tree({ folderLabels: [] }).map((x) => x[0]), ['CharaScenario', 'MainScenario', 'OtherScenario', '全部剧情']), J(tree({ folderLabels: [['^Other', 'Other!'], ['^Main', 'Main!']] })))

  // paths
  const voiceOf = (options, config, key = 'ミナ-制服', name = 'v1') => opsOf(uRun([T({ a1: key, text: 'x', voice: name })], options, config), 'voice')[0]?.src
  check('utage paths.voice：默认按文件名找（Sound/Voice 优先于 BgVoice）；换模板 = 只认 BgVoice / 带 {charId} 的角色目录（charIdStrip 去掉 ch_）；找不到记 unresolved',
    voiceOf({}) === 'Sound/Voice/ImportChara/100/v1.ogg' && voiceOf({ paths: { voice: ['Sound/BgVoice/**/{name}.ogg'] } }) === 'Sound/BgVoice/v1.ogg'
    && voiceOf({ paths: { voice: ['Sound/Voice/ImportChara/{charId}/{name}.ogg'] } }) === 'Sound/Voice/ImportChara/100/v1.ogg' && voiceOf({ paths: { voice: ['Sound/Voice/ImportChara/{charId}/{name}.ogg'] } }, undefined, 'ルカ-私服-春') === undefined
    && voiceOf({ paths: { voice: ['Sound/Voice/{charId}/{name}.ogg'], charIdStrip: '' } }) === undefined && uRun([T({ a1: 'ミナ-制服', text: 'x', voice: 'v1' }), T({ a1: 'ミナ-制服', text: 'y', voice: 'nope' })]).stats.unresolved['voice:nope'] === 1, voiceOf({}))
  check('utage 同名语音 + config.resourceResolve.preferDirs：默认取字典序第一个；preferDirs 挑指定目录；extensionFallbacks 也生效（模板写 .wav，实际是 .ogg）',
    voiceOf({}, undefined, 'ミナ-制服', 'dup') === 'Sound/Voice/ImportChara/200/dup.ogg' && voiceOf({}, { preferDirs: ['Sound/Voice/Zeta'] }, 'ミナ-制服', 'dup') === 'Sound/Voice/Zeta/dup.ogg'
    && voiceOf({ paths: { voice: ['Sound/Voice/**/{name}.wav'] } }, { extensionFallbacks: { '.wav': ['.ogg'] } }) === 'Sound/Voice/ImportChara/100/v1.ogg' && voiceOf({ paths: { voice: ['Sound/Voice/**/{name}.wav'] } }) === undefined, String(voiceOf({}, { preferDirs: ['Sound/Voice/Zeta'] }, 'ミナ-制服', 'dup')))
  const bgOf = (options, label) => opsOf(uRun([R('Bg', { a1: label }), T({ text: 'x' })], options), 'bg')[0]?.src
  check('utage paths.bg：默认 Master 表的 FileName（补 .png）→ BackGrounds/<名>.png|jpg；模板换了就按新的找',
    bgOf({}, 'bgA') === 'Adventure/BackGrounds/bgA_file.png' && bgOf({}, 'bgB') === 'Adventure/BackGrounds/bgB.jpg' && bgOf({ paths: { bg: ['Adventure/Custom/{name}.png'] } }, 'bgC') === 'Adventure/Custom/bgC.png' && bgOf({ paths: { bg: ['Adventure/Custom/{name}.png'] } }, 'bgB') === undefined, '')
  const seOf = (op, options, label) => opsOf(uRun([R(op, { a1: label }), T({ text: 'x' })], options), op === 'Se' ? 'se' : 'bgse')[0]?.src
  check('utage paths.se / bgse：默认 Master 文件 → Se → BgSe（BgSe 反过来）；换模板',
    seOf('Se', {}, 'SE1') === 'Sound/Se/se1_file.ogg' && seOf('Se', {}, 'se3') === 'Sound/BgSe/se3.ogg' && seOf('BgSe', {}, 'se3') === 'Sound/BgSe/se3.ogg' && seOf('Se', { paths: { se: ['Extra/{name}.ogg'] } }, 'x') === 'Extra/x.ogg' && seOf('Se', { paths: { se: ['Extra/{name}.ogg'] } }, 'se2') === undefined, '')
  const bgvoiceOf = (options) => opsOf(uRun([R('BgVoice', { a1: 'v1' }), T({ text: 'x' })], options), 'bgvoice')[0]?.src
  check('utage paths.bgvoice：默认 BgVoice 优先；换成 Voice 优先', bgvoiceOf({}) === 'Sound/BgVoice/v1.ogg' && bgvoiceOf({ paths: { bgvoice: ['Sound/Voice/**/{name}.ogg'] } }) === 'Sound/Voice/ImportChara/100/v1.ogg', '')
  const charOf = (options, key = 'ミナ-制服') => { const out = uRun([stand(key, 'Chara1'), T({ text: 'x' })], options); return { skel: opsOf(out, 'spine')[0]?.skel, unresolved: out.stats.unresolved } }
  check('utage paths.characters / skeletonSuffixStrip：默认 FileName 去掉 .asset / _SkeletonData → <目录>/<基名>.skel.bytes；strip 改成别的后缀就找不到文件（记 character-file）；模板可换（.alt.skel.bytes）',
    charOf({}).skel === 'Characters/ch_100/ch_100_m0.skel.bytes' && charOf({}, 'ノア-制服').skel === 'Characters/ch_300/ch_300_m0.skel.bytes'
    && charOf({ paths: { skeletonSuffixStrip: ['_SkeletonData.asset'] } }, 'ノア-制服').skel === undefined && J(charOf({ paths: { skeletonSuffixStrip: ['_SkeletonData.asset'] } }, 'ノア-制服').unresolved).includes('character-file') && charOf({ paths: { skeletonSuffixStrip: ['_SkeletonData.asset'] } }).skel === 'Characters/ch_100/ch_100_m0.skel.bytes'
    && charOf({ paths: { characters: [{ skel: '{dir}/{base}.alt.skel.bytes', atlas: '{dir}/{base}.alt.atlas.txt' }] } }, 'ノア-制服').skel === 'Characters/ch_300/ch_300_m0.alt.skel.bytes', J(charOf({})))
  const stillOf = (options, id = 'st_1') => opsOf(uRun([R('BgEvent', { a1: id, a2: '', a3: '', anim: 'cut_1' }), T({ text: 'x' })], options), 'spine').map((c) => c.skel)
  check('utage paths.stills：默认 Stills/<id>/*.skel.bytes 全放出来（自然序）；模板里的 * 可换成固定名；atlas 跟着 {base}',
    same(stillOf({}), ['Stills/st_1/other.skel.bytes', 'Stills/st_1/st_1_a.skel.bytes', 'Stills/st_1/st_1_b.skel.bytes']) && same(stillOf({ paths: { stills: [{ skel: 'Stills/{id}/{id}_a.skel.bytes', atlas: 'Stills/{id}/{id}_a.atlas.txt' }] } }), ['Stills/st_1/st_1_a.skel.bytes']) && same(stillOf({ paths: { stills: [{ skel: 'Stills/{id}/st_1_*.skel.bytes', atlas: 'x/{base}.atlas' }] } }), ['Stills/st_1/st_1_a.skel.bytes', 'Stills/st_1/st_1_b.skel.bytes']) && stillOf({}, 'st_none').length === 0, J(stillOf({})))
  // index
  const prepared = (options) => uPrep(options)
  check('utage index：dirs / master / ext / books 可改（contextDirs / contextFiles 跟着变；ext 只收 png 时 ogg 不进索引；books 换正则）',
    same(utage.contextDirs({ root: 'R' }), ['R/Adventure', 'R/Characters', 'R/Stills', 'R/Sound']) && same(utage.contextDirs({ index: { dirs: ['A'] } }), ['A']) && same(utage.contextFiles({ root: 'R' }), ['R/Adventure/Master.chapter.json']) && same(utage.contextFiles({ index: { master: 'M/m.json' } }), ['M/m.json'])
    && prepared({}).index.has('Sound/Se/se2.ogg') && !prepared({ index: { ext: '\\.png$' } }).index.has('Sound/Se/se2.ogg') && prepared({ index: { books: ['^Adventure/(?<category>Main)Scenario/(?<stem>[^/]+)\\.book\\.json$'] } }).books.length === 1, '')
  const health = utage.health(prepared({}))
  check('utage health 不受影响', health.length === 0, J(health))
}

// ---- utage 端到端：loadAdapterContext + config.adapterOptions + meta.config
{
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opt-utage-'))
  const write = async (rel, text) => { await mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await writeFile(path.join(dir, rel), text) }
  await write('Data/Adventure/Master.chapter.json', MASTER)
  for (const rel of FILES) if (!rel.startsWith('Adventure/')) await write(`Data/${rel}`, 'x')
  await write('Data/Adventure/MainScenario/M1.book.json', B([stand('ミナ-制服', 'Chara1', '250'), T({ a1: 'ミナ-制服', text: 'こんにちは', voice: 'dup' })]))
  const adapter = galAdapter('utage-book')
  const run = async (adapterOptions, resourceResolve) => {
    const config = normalizeGalConfig({ resourceRoots: ['Data'], adapterOptions: { 'utage-book': { root: 'Data', ...adapterOptions } }, ...(resourceResolve ? { resourceResolve } : {}) })
    const ctx = await loadAdapterContext({ adapter, mediaDir: dir, config })
    const meta = { stem: 'M1.book', options: config.adapterOptions['utage-book'], config }
    return adapter.parse(await (await import('node:fs/promises')).readFile(path.join(dir, 'Data/Adventure/MainScenario/M1.book.json'), 'utf8'), ctx, meta)
  }
  const base = await run({})
  const over = await run({ standX: { slotBase: 0.2 }, slots: { Chara1: 'Left' }, speaker: { source: ['raw'] }, paths: { voice: ['Sound/Voice/Zeta/{name}.ogg'] } })
  const pref = await run({}, { preferDirs: ['Sound/Voice/Zeta'] })
  check('utage 端到端（引擎读 config.adapterOptions / resourceResolve）：默认行为不变；slotBase / slots / speaker.source / paths.voice 覆盖后改变；preferDirs 影响同名语音',
    opsOf(base, 'spine')[0].slot === 'Chara1' && opsOf(base, 'spine')[0].x === 0.5 + 250 / 1280 && speakerOf(base) === 'ミナ' && opsOf(base, 'voice')[0].src === 'Sound/Voice/ImportChara/200/dup.ogg'
    && opsOf(over, 'spine')[0].slot === 'Left' && opsOf(over, 'spine')[0].x === 0.2 + 250 / 1280 && speakerOf(over) === 'ミナ-制服' && opsOf(over, 'voice')[0].src === 'Sound/Voice/Zeta/dup.ogg' && opsOf(pref, 'voice')[0].src === 'Sound/Voice/Zeta/dup.ogg', J([opsOf(base, 'spine'), opsOf(over, 'voice'), opsOf(pref, 'voice')]))
}

// ================= grenze-xml =================
const X = (rows) => rows.map((row, i) => `<easy_dialog-1 ${Object.entries({ id: String(i + 1), ...(i + 1 < rows.length && !row._end ? { next_id: String(i + 2) } : {}), ...row }).filter(([k]) => k !== '_end').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('\n')
const GFILES = [
  'bg/battlebg/a/a.webp', 'bg/battlebg/p/p.png', 'bg/other/c/c.jpg', 'bg/extra/q.webp',
  'bgm/m1/M1.m4a', 'bgm/zz/M2.mp3', 'sound/s1/s1.m4a', 'sound/loose/s2.m4a',
  'voice/pk/v1.m4a', 'voice/pk/v3.mp3', 'voice/other/v2.m4a', 'voice/A/dup.m4a', 'voice/B/dup.m4a', 'voice/A/dup2.m4a', 'voice/A/v4.m4a',
  'merc/pic/7/body.webp', 'merc/pic/8/body.png', 'merc/pic/7/7.webp', 'merc/pic/9/full.png',
].map((f) => `assets/resources/patchres/${f}`)
const gPrep = (options, files = GFILES) => grenze.prepare({ options, files, toResourcePath: (rel) => rel.replace(/^assets\/resources\/patchres\//, 'R/'), mediaDir: '' })
const gRun = async (rows, options = {}, config = undefined, extra = {}) => grenze.parse(X(rows), await gPrep(options), { options, config: config && { resourceResolve: config }, ...extra })
const GC = (out) => out.steps.flatMap((s) => s.commands)
{
  const d = grenze.resolveOptions({})
  check('grenze 默认选项 = 文档里的默认值（schema）；textDir / resourceDir 跟着 root 走', d.standKeep === 'untilNewHero' && d.scene.forkPolicy === 'merge' && d.duplicates.voice === 'skip' && same(d.standFiles, ['body.webp', 'body.png']) && grenze.resolveOptions({ root: 'G' }).textDir === 'G/TextAsset' && same(grenze.contextDirs({ root: 'G' }), ['G/TextAsset', ...['bg', 'bgm', 'sound', 'voice', 'merc/pic'].map((x) => `G/assets/resources/patchres/${x}`)]) && same(grenze.contextDirs({ resourceDirs: ['bg'] }).slice(1), ['assets/resources/patchres/bg']), '')

  const bgOf = async (name, options, config) => GC(await gRun([{ background: name, text: 't' }], options, config)).find((c) => c.op === 'bg')
  check('grenze paths.bg：默认模板 bg/battlebg/<名>/<名>.webp → png → 再按文件名在 bg/ 下找；模板换了就只认新的（去掉后备 = 找不到）；没有索引按第一条模板猜',
    (await bgOf('a')).src === 'R/bg/battlebg/a/a.webp' && (await bgOf('p')).src === 'R/bg/battlebg/p/p.png' && (await bgOf('c')).src === 'R/bg/other/c/c.jpg' && (await bgOf('q')).src === 'R/bg/extra/q.webp'
    && (await bgOf('q', { paths: { bg: ['bg/battlebg/{name}/{name}.{ext}'] } })) === undefined && (await bgOf('q', { paths: { bg: ['bg/extra/{name}.webp'] } })).src === 'R/bg/extra/q.webp' && (await bgOf('a', { exts: { bg: ['png'] } })) === undefined
    && GC(grenze.parse(X([{ background: 'zz', text: 't' }]), null, {})).find((c) => c.op === 'bg').src === 'bg/battlebg/zz/zz.webp' && GC(grenze.parse(X([{ background: 'zz', text: 't' }]), null, { options: { paths: { bg: ['x/{name}.png'] } } })).find((c) => c.op === 'bg').src === 'x/zz.png', '')
  const bgb = async (options) => GC(await gRun([{ background: 'bg_b', text: 't' }], options)).find((c) => c.op === 'bg')
  check('grenze bgBlack：默认 bg_b 没有文件 = 黑底；改名单后 bg_b 记 unresolved、别的名字变黑；none 里的背景值不处理',
    same((await bgb({})).color, [0, 0, 0]) && (await bgb({ bgBlack: [] })) === undefined && same((await bgb({ bgBlack: ['bg_b'] })).color, [0, 0, 0]) && same(GC(await gRun([{ background: 'BG_X', text: 't' }], { bgBlack: ['bg_x'] })).find((c) => c.op === 'bg').color, [0, 0, 0])
    && GC(await gRun([{ background: 'none', text: 't' }], { none: ['none'] })).every((c) => c.op !== 'bg') && (await gRun([{ background: 'non', text: 't' }], { none: ['x'] })).stats.unresolved['bg:non'] === 1, '')
  const bgmRows = [{ bgm: 'M1' }, { bgm: 'non', text: 't' }]
  check('grenze none / paths.bgm：默认 non = 停（正在放才发）、bgm/<小写>/<名>.m4a；none 换了值就停；exts 顺序决定同名不同扩展名的优先；paths 换模板',
    same(GC(await gRun(bgmRows)).filter((c) => c.op.startsWith('bgm')).map((c) => c.op), ['bgm', 'bgmStop']) && GC(await gRun(bgmRows)).find((c) => c.op === 'bgm').src === 'R/bgm/m1/M1.m4a'
    && same(GC(await gRun([{ bgm: 'M1' }, { bgm: 'stop', text: 't' }], { none: ['stop'] })).filter((c) => c.op.startsWith('bgm')).map((c) => c.op), ['bgm', 'bgmStop']) && GC(await gRun([{ bgm: 'M2', text: 't' }])).find((c) => c.op === 'bgm').src === 'R/bgm/zz/M2.mp3'
    && (await gRun([{ bgm: 'M2', text: 't' }], { exts: { bgm: ['m4a'] } })).stats.unresolved['bgm:M2'] === 1 && GC(await gRun([{ bgm: 'M1', text: 't' }], { paths: { bgm: ['bgm/**/{name}.m4a'] } })).find((c) => c.op === 'bgm').src === 'R/bgm/m1/M1.m4a', '')
  const sounds = async (options, row = { sound1: 's1', bg_sound2: 's2', sound3: 'non', text: 't' }) => GC(await gRun([row], options)).filter((c) => c.op === 'se' || c.op === 'bgse')
  check('grenze bgSound / soundAttrs：默认 bg_sound 和 sound 都是一次性 se（bg_sound 先）；mode bgse → bg_sound 发循环 bgse；soundAttrs / attrs 改了属性名',
    same(await sounds({}), [{ op: 'se', src: 'R/sound/loose/s2.m4a' }, { op: 'se', src: 'R/sound/s1/s1.m4a' }]) && same(await sounds({ bgSound: { mode: 'bgse' } }), [{ op: 'bgse', src: 'R/sound/loose/s2.m4a', loop: true }, { op: 'se', src: 'R/sound/s1/s1.m4a' }])
    && same(await sounds({ soundAttrs: ['sound3'] }), [{ op: 'se', src: 'R/sound/loose/s2.m4a' }]) && same(await sounds({ bgSound: { attrs: ['ambient'] } }, { ambient: 's2', text: 't' }), [{ op: 'se', src: 'R/sound/loose/s2.m4a' }]), J(await sounds({})))
  const voices = async (options, config, row = { voice_pack: 'PK', voice: 'v1', text: 't' }) => GC(await gRun([row], options, config)).find((c) => c.op === 'voice')?.src
  check('grenze paths.voice：默认 voice/<包小写>/<语音名>.m4a，扩展名按 exts（v3 = mp3）；包里没有 → 按文件名在 voice/ 下找（唯一才取）；模板可换',
    await voices({}) === 'R/voice/pk/v1.m4a' && await voices({}, undefined, { voice_pack: 'PK', voice: 'v3', text: 't' }) === 'R/voice/pk/v3.mp3' && await voices({}, undefined, { voice_pack: 'PK', voice: 'v2', text: 't' }) === 'R/voice/other/v2.m4a'
    && await voices({ paths: { voice: ['voice/{pack}/{voice}.{ext}'] } }, undefined, { voice_pack: 'PK', voice: 'v2', text: 't' }) === undefined && await voices({ paths: { voice: ['voice/other/{voice}.m4a'] } }, undefined, { voice: 'v2', text: 't' }) === 'R/voice/other/v2.m4a', String(await voices({})))
  const dupRow = { voice_pack: 'ZZ', voice: 'dup', text: 't' }
  check('grenze duplicates：同名语音默认 skip（不猜，记 unresolved）；first = 字典序第一个；preferDirs = 按 config.resourceResolve.preferDirs 挑；包里能精确定位的不算重名',
    await voices({}, undefined, dupRow) === undefined && await voices({ duplicates: { voice: 'first' } }, undefined, dupRow) === 'R/voice/A/dup.m4a' && await voices({ duplicates: { voice: 'preferDirs' } }, { preferDirs: ['voice/B'] }, dupRow) === 'R/voice/B/dup.m4a'
    && await voices({ duplicates: { voice: 'preferDirs' } }, undefined, dupRow) === 'R/voice/A/dup.m4a' && await voices({}, undefined, { voice_pack: 'B', voice: 'dup', text: 't' }) === 'R/voice/B/dup.m4a' && (await gRun([dupRow], {})).stats.unresolved['voice:ZZ/dup'] === 1, String(await voices({ duplicates: { voice: 'preferDirs' } }, { preferDirs: ['voice/B'] }, dupRow)))
  const stands = async (rows, options) => GC(await gRun(rows, options)).filter((c) => c.op === 'stand' || c.op === 'standOff')
  const standRows = [{ hero_group_id: '7', pic_pos: '3', text: 'a' }, { text: 'b' }, { hero_group_id: '8', pic_pos: '9', text: 'c' }]
  check('grenze standFiles / standPos / standFit：默认 body.webp 优先、pic_pos 1/2/3 = 左/中/右（别的 = 中）、fit 1；standFiles 换顺序 / standPos 换名 / standFit 0 去掉 fit',
    same((await stands(standRows, {})).map((c) => c.op === 'stand' ? [c.parts[0].src, c.parts[0].align, c.parts[0].fit] : c.op), [['R/merc/pic/7/body.webp', 'right', 1], ['R/merc/pic/8/body.png', 'center', 1]])
    && (await stands([{ hero_group_id: '9', text: 'a' }], { standFiles: ['full.png'] }))[0].parts[0].src === 'R/merc/pic/9/full.png' && (await stands([{ hero_group_id: '7', text: 'a' }], { standFiles: ['7.webp', 'body.webp'] }))[0].parts[0].src === 'R/merc/pic/7/7.webp'
    && (await stands(standRows, { standPos: { 3: 'R', default: 'C' } })).map((c) => c.parts?.[0].align).filter(Boolean).join() === 'R,C' && !('fit' in (await stands(standRows, { standFit: 0 }))[0].parts[0]), J(await stands(standRows, {})))
  check('grenze standKeep：默认 untilNewHero = 旁白行沿用立绘（不重发）；perRow = 没有 hero_group_id 的行清掉立绘',
    same((await stands(standRows, {})).map((c) => c.op), ['stand', 'stand']) && same((await stands(standRows, { standKeep: 'perRow' })).map((c) => c.op), ['stand', 'standOff', 'stand']), J(await stands(standRows, { standKeep: 'perRow' })))
  const rawRow = [{ screen_effect: '8', pic_action: '1', effect: '3', effect_pos: '2', new_attr: 'x', text: 't' }]
  const raws = async (options) => GC(await gRun(rawRow, options)).filter((c) => c.op === 'raw').map((c) => [c.cmd, c.args])
  check('grenze rawAttrs：默认 screen_effect / pic_action / effect+effect_pos 记 raw（effect 带 effect_pos）；拿掉的属性不再记；新属性加进来就记；a+b 都有才带 b 的值',
    same(await raws({}), [['screen_effect', ['8']], ['pic_action', ['1']], ['effect', ['3', '2']]]) && same(await raws({ rawAttrs: ['pic_action'] }), [['pic_action', ['1']]]) && same(await raws({ rawAttrs: ['new_attr', 'effect'] }), [['new_attr', ['x']], ['effect', ['3']]]) && (await gRun(rawRow, { rawAttrs: [] })).stats.raw.screen_effect === undefined, J(await raws({})))
  // scene
  const forkRows = [{ id: '1', next_id: '3', text: 'a' }, { id: '2', next_id: '3', text: 'b' }, { id: '3', text: 'c' }]
  const forkXml = X(forkRows)
  const rowsF = grenze.readRows(forkXml)
  const sc = (policy) => grenze.splitScenes(rowsF, { forkPolicy: policy }).scenes.map((s) => s.rows.length)
  const playScene = async (start, options) => (await grenze.parse(forkXml, await gPrep(options), { options, scene: start })).steps.length
  check('grenze scene.forkPolicy：默认 merge = 每个场景各自走到底（2 + 2 行，共用的 c 两边都有）；first = 共用部分只属于最靠前的链（2 + 1 行）；打开场景也一致；split 只有 chains',
    same(sc('merge'), [2, 2]) && same(sc('first'), [2, 1]) && same(sc(undefined), [2, 2]) && await playScene('2', {}) === 2 && await playScene('2', { scene: { forkPolicy: 'first' } }) === 1 && await playScene('1', { scene: { forkPolicy: 'first' } }) === 2, J([sc('merge'), sc('first')]))
}

// ---- grenze 端到端
{
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opt-grenze-'))
  const write = async (rel, text) => { await mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await writeFile(path.join(dir, rel), text) }
  for (const f of GFILES) await write(`G/${f}`, 'x')
  const xml = X([{ background: 'a', hero_group_id: '7', pic_pos: '1', voice_pack: 'ZZ', voice: 'dup', screen_effect: '3', text: 'hi' }, { text: 'narr' }])
  await write('G/TextAsset/easy_dialog-1.xml', xml)
  const adapter = galAdapter('grenze-xml')
  const run = async (adapterOptions, resourceResolve) => {
    const config = normalizeGalConfig({ resourceRoots: ['G/assets/resources/patchres'], adapterOptions: { 'grenze-xml': { root: 'G', ...adapterOptions } }, ...(resourceResolve ? { resourceResolve } : {}) })
    const ctx = await loadAdapterContext({ adapter, mediaDir: dir, config })
    return { ctx, out: adapter.parse(xml, ctx, { stem: 'easy_dialog-1', options: config.adapterOptions['grenze-xml'], config }) }
  }
  const base = await run({})
  const over = await run({ standKeep: 'perRow', rawAttrs: [], standFit: 0, paths: { bg: ['bg/other/c/{name}.jpg'] }, duplicates: { voice: 'preferDirs' } }, { preferDirs: ['voice/B'] })
  const ops = (r) => GC(r.out)
  check('grenze 端到端（引擎读 config.adapterOptions / resourceResolve + 目录索引）：默认行为不变；paths.bg / standKeep / standFit / rawAttrs / duplicates 覆盖后改变',
    ops(base).find((c) => c.op === 'bg').src === 'bg/battlebg/a/a.webp' && !ops(base).some((c) => c.op === 'voice') && ops(base).some((c) => c.op === 'raw') && ops(base).filter((c) => c.op === 'stand' || c.op === 'standOff').length === 1 && ops(base).find((c) => c.op === 'stand').parts[0].fit === 1
    && over.out.stats.unresolved['bg:a'] === 1 && ops(over).find((c) => c.op === 'voice').src === 'voice/B/dup.m4a' && !ops(over).some((c) => c.op === 'raw') && same(ops(over).filter((c) => c.op === 'stand' || c.op === 'standOff').map((c) => c.op), ['stand', 'standOff']) && !('fit' in ops(over).find((c) => c.op === 'stand').parts[0]), J([ops(base), ops(over)]).slice(0, 600))
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
