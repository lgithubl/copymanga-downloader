#!/usr/bin/env node
// 自测（纯 node，不需要浏览器）：
//   · utage-book（TSK）：catalog.groups 按角色分组、nameOnlyRow（只有角色名的行把角色摆出来）、tween.targetSlots（Tween / Shake 的 Arg1 是槽名）、没有语音目录的诊断
//   · girlscreation-line：commands.cgmode / asyncjump / asyncmoveobject / crossfade（TransitionCrossFade）及 line.* 子选项；每条命令：默认新映射、'raw' 回到以前
//   node scripts/dev/gal-utage-gc-selftest.mjs
import * as gc from '../../web/library/gal/adapters/girlscreation-tag.mjs'
import { DEFAULT_OPTIONS as GC_DEFAULTS, parseLine, sniffLine } from '../../web/library/gal/adapters/girlscreation-line.mjs'
import * as utage from '../../web/library/gal/adapters/utage-book.mjs'
import { R, T } from './make-tsk-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const same = (a, b) => J(a) === J(b)

// ================= utage-book 共用 fixture =================
const HEADER = ['Command', 'Arg1', 'Arg2', 'Arg3', 'Arg4', 'Arg5', 'Arg6', 'Skin', 'SpineAnim', 'SpineSubAnim', 'AnimCompType', 'AnimSpd', 'WaitType', 'Text', 'PageCtrl', 'Voice', 'WindowType']
const B = (rows) => JSON.stringify({ importGridList: [{ name: 'g', rows: [{ strings: HEADER }, ...rows].map((row, i) => ({ rowIndex: i, isEmpty: 0, isCommentOut: 0, ...row })) }] })
const table = (name, header, rows) => ({ name, rows: [{ strings: header }, ...rows.map((strings) => ({ strings }))] })
const charRow = (key, name, id) => ['', key, name, `Characters/ch_${id}/ch_${id}_m0_SkeletonData.asset`, 'Spine']
const master = (rows) => JSON.stringify({ settingList: [table('Master.chapter:Character', ['', 'CharacterName', 'NameText', 'FileName', 'FileType'], rows)] })
const prep = (options, masterText, files) => utage.prepare({ options, texts: { 'Adventure/Master.chapter.json': masterText }, files })
const stand = (a1, a3, a4 = '') => T({ a1, a3, a4, anim: 'wait' })

// ================= 1. catalog.groups =================
{
  const M = master([
    charRow('サシャ-制服', '莎夏', '1002001'), charRow('サシャ-水着', '莎夏改', '1002002'),   // 同一角色 1002 的两套：第一行的 NameText 当组名
    charRow('アナ-制服', '<6字>', '1008001'),                                              // 样本里被遮罩的名字：原样当组名
    charRow('ノア-制服', '', '1012002'),                                                   // NameText 空：组名 = 角色 id
  ])
  const FILES = [
    'Adventure/Master.chapter.json', 'Adventure/MainScenario/M1.book.json',
    ...['1008001', '1002002', '1002001', '1012002', '1099001', '9020005', '9010003', '9060001', '907011', 'Extra'].map((n) => `Adventure/CharaScenario/CharaScenario${n}.book.json`),
  ]
  const tree = (options, masterText = M) => prep(options, masterText, FILES).catalogTree
  const chara = (options, masterText) => tree(options, masterText).children.find((n) => n.id === 'c/CharaScenario')
  const dflt = chara({})
  check('catalog.groups 默认：角色剧情按剧情号前 4 位（角色 id）分组，组按 id 排，组内按剧情号排；组名 = Master Character 的 NameText（第一个匹配 ch_<id> 的行）；NameText 空 = id；遮罩名原样',
    same(dflt.children.slice(0, 3).map((g) => [g.id, g.title, g.children.map((c) => c.title.replace('CharaScenario', ''))]), [
      ['c/CharaScenario/@1002', '莎夏', ['1002001', '1002002']], ['c/CharaScenario/@1008', '<6字>', ['1008001']], ['c/CharaScenario/@1012', '1012', ['1012002']],
    ]), J(dflt.children.map((g) => [g.id, g.title])))
  check('catalog.groups 默认：Master 里没有这个角色的（1099 / 9xxx）和剧情号不是 4+3 位的（6 位的 907011、Extra）统一进 1 个「特别 / 其他」组，排最后、组内按剧情号排',
    same(dflt.children.length, 4) && dflt.children[3].id === 'c/CharaScenario/@other' && dflt.children[3].title === '特别 / 其他'
    && same(dflt.children[3].children.map((c) => c.title.replace('CharaScenario', '')), ['907011', '1099001', '9010003', '9020005', '9060001', 'Extra']), J(dflt.children[3]))
  check('catalog.groups：剧情节点 id / script 不变（c/CharaScenario/<剧情名>），组节点只多一层；其它文件夹和「全部剧情」不变；文件夹节点的 id / 副标题不变',
    dflt.children[0].children[0].id === 'c/CharaScenario/CharaScenario1002001' && dflt.children[0].children[0].script === 'Adventure/CharaScenario/CharaScenario1002001.book.json'
    && dflt.id === 'c/CharaScenario' && dflt.subtitle === 'CharaScenario · 10 个' && tree({}).children.find((n) => n.id === 'c/MainScenario').children.length === 1 && tree({}).children.find((n) => n.id === 'all').children.length === 11, J(dflt.subtitle))
  const flatRef = chara({ catalog: { groups: [] } })
  check('catalog.groups = []（空数组）→ 回到平铺（按剧情名排），和以前一样；写了不合法的正则的规则丢掉（也平铺）',
    flatRef.children.length === 10 && flatRef.children.every((c) => c.script) && same(chara({ catalog: { groups: [{ folder: '^CharaScenario$', idRe: '(a+)+$' }] } }).children.map((c) => c.id), flatRef.children.map((c) => c.id)), J(flatRef.children.map((c) => c.id)))
  const noFallback = chara({ catalog: { groups: [{ folder: '^CharaScenario$', idRe: '^CharaScenario(\\d{4})\\d{3}$', nameFrom: 'masterCharacter', charFile: '(?:^|/)ch_{id}', fallback: '' }] } })
  check('catalog.groups fallback = \'\'：没有这个角色的剧情不设组，直接平铺在文件夹下（排在各组后面）；fallback 改名生效',
    noFallback.children.slice(0, 3).every((c) => c.children) && noFallback.children.slice(3).every((c) => c.script) && noFallback.children.length === 9
    && chara({ catalog: { groups: [{ folder: '^CharaScenario$', idRe: '^CharaScenario(\\d{4})\\d{3}$', nameFrom: 'masterCharacter', charFile: '(?:^|/)ch_{id}', fallback: 'Misc' }] } }).children[3].title === 'Misc', J(noFallback.children.map((c) => c.id)))
  const byId = chara({ catalog: { groups: [{ folder: '^CharaScenario$', idRe: '^CharaScenario(\\d{4})\\d{3}$', nameFrom: 'id' }] } })
  check('catalog.groups nameFrom = id：组名直接用角色 id，不看 Master（9xxx 也各自成组；不匹配 idRe 的 907011 / Extra 没写 fallback → 平铺在后面）', same(byId.children.slice(0, 7).map((g) => g.title), ['1002', '1008', '1012', '1099', '9010', '9020', '9060']) && byId.children.length === 9 && byId.children.slice(7).every((c) => c.script), J(byId.children.map((g) => g.title)))
  const noMaster = chara({}, '{}')
  check('catalog.groups：Master 一个角色都没读到（没法判断有没有这个角色）→ 全部按 id 分组、组名 = id；规则按顺序第一条匹配文件夹的生效，别的文件夹不受影响',
    same(noMaster.children.slice(0, 2).map((g) => g.title), ['1002', '1008']) && same(chara({ catalog: { groups: [{ folder: '^Nope$', idRe: '(\\d+)' }, { folder: 'Chara', idRe: '^CharaScenario(\\d{4})\\d{3}$' }] } }).children.slice(0, 2).map((g) => g.title), ['莎夏', '<6字>']), J(noMaster.children.map((g) => g.title)))
  check('catalog.groups：charFile 可换（按 Master 的 NameText 以外的文件名规则匹配）；用户值类型不对的丢掉用默认',
    chara({ catalog: { groups: [{ folder: '^CharaScenario$', idRe: '^CharaScenario(\\d{4})\\d{3}$', charFile: '/ch_{id}002/' }] } }).children.find((g) => g.id.endsWith('@1002'))?.title === '莎夏改'
    && same(chara({ catalog: { groups: 5 } }).children.map((g) => g.id), dflt.children.map((g) => g.id)), '')
}

// ================= 2. nameOnlyRow / tween.targetSlots / 语音诊断 =================
{
  const M = master([charRow('ミナ-制服', 'ミナ', '100'), charRow('ルカ-私服', 'ルカ', '200')])
  const FILES = ['Adventure/Master.chapter.json', 'Adventure/MainScenario/M1.book.json', 'Characters/ch_100/ch_100_m0.skel.bytes', 'Characters/ch_200/ch_200_m0.skel.bytes', 'Sound/Voice/ImportChara/100/v1.ogg']
  const run = (rows, options = {}) => { const ctx = prep(options, M, FILES); return utage.parse(B(rows), ctx, { options }) }
  const flat = (out) => out.steps.flatMap((s) => s.commands)
  const ofOp = (out, op) => flat(out).filter((c) => c.op === op)
  const MIRA = 'ミナ-制服'
  const mina = (extra = {}) => T({ a1: MIRA, ...extra })
  // 真实数据里的写法：CharacterOff 之后出现只有角色名的行，后面的 Tween 指着这个名字
  const seqRows = [stand(MIRA, 'Chara2', '250'), R('CharacterOff'), mina(), R('Tween', { a1: MIRA, a2: 'MoveBy', a3: 'time=.3 y=-30', a5: 'pingPong=2' }), T({ text: 'x' })]
  const shown = run(seqRows)
  const sp = ofOp(shown, 'spine')
  check('nameOnlyRow（默认 show）：CharacterOff 之后只有角色名的行把角色摆回来（槽 = 上次的 Chara2，横向位置 = 上次的），后面的 Tween（Arg1 = 角色名）能找到它，不再记「角色不在场」',
    sp.length === 3 && sp[1].slot === 'Chara2' && sp[1].x === 0.5 + 250 / 1280 && sp[2].slot === 'Chara2' && sp[2].bounce?.y === -30 && sp[2].bounce.count === 2 && !Object.keys(shown.stats.raw).some((k) => k.startsWith('Tween')), J(sp) + J(shown.stats.raw))
  const faceOnly = run(seqRows, { nameOnlyRow: 'faceOnly' })
  check('nameOnlyRow = faceOnly：回到以前的行为（不摆；Tween 记「角色不在场」）；写错的值回到默认 show', ofOp(faceOnly, 'spine').length === 1 && faceOnly.stats.raw['Tween:MoveBy（角色不在场）'] === 1 && ofOp(run(seqRows, { nameOnlyRow: 'bogus' }), 'spine').length === 3, J(faceOnly.stats.raw))
  const firstFree = run([stand('ルカ-私服', 'Chara1'), mina({ text: 'x' })])
  check('nameOnlyRow：没有上次的槽 → 取第一个空槽（Chara1 被别人占着就是 Chara2，居中）；带台词的行一样；<Off> 行不受影响（不摆）；已在场的角色只更新表情',
    ofOp(firstFree, 'spine').map((c) => c.slot).join() === 'Chara1,Chara2' && ofOp(firstFree, 'spine')[1].x === 0.5
    && ofOp(run([mina({ a2: '<Off>', text: 'x' })]), 'spine').length === 0 && ofOp(run([stand(MIRA, 'Chara1'), mina({ text: 'y' })]), 'spine').length === 1
    && ofOp(run([stand(MIRA, 'Chara1'), mina({ skin: 'face2' })]), 'spine').length === 2, J(ofOp(firstFree, 'spine')))
  check('nameOnlyRow：槽被 slots 映射成 \'\'（丢掉）的角色，只有角色名的行也不把它摆到别的槽；槽全满时不摆（不崩）',
    ofOp(run([stand(MIRA, 'Chara1'), R('CharacterOff'), mina({ text: 'x' })], { slots: { Chara1: '' } }), 'spine').length === 0
    && ofOp(run([stand('ルカ-私服', 'Chara1'), mina({ text: 'x' })], { slots: { Chara1: 'A', Chara2: 'A', Chara3: 'A' } }), 'spine').length === 1, '')
  // Tween / Shake 的 Arg1 = 站位槽名
  const slotRows = [stand(MIRA, 'Chara1'), R('Tween', { a1: 'Chara1', a2: 'MoveBy', a3: 'time=.3 y=-30', a5: 'pingPong=2' }), R('Shake', { a1: 'Chara1', a3: 'x=15 y=0 time=0.6' }), R('Tween', { a1: 'Chara1', a2: 'MoveTo', a3: 'x=-250 time=1' }), R('Tween', { a1: 'Chara3', a2: 'MoveBy', a3: 'x=30', a5: 'pingPong=2' }), T({ text: 'x' })]
  const bySlot = run(slotRows)
  const sps = ofOp(bySlot, 'spine')
  check('tween.targetSlots（默认 true）：Tween / Shake 的 Arg1 是槽名（Chara1）→ 指现在站在这个槽里的角色（pingPong 的 bounce / Shake 的 shake / MoveTo 的 move = time / 2）；空槽（Chara3）仍记「角色不在场」',
    sps.length === 4 && sps[1].bounce?.y === -30 && sps[2].shake?.x === 15 && sps[3].x === 0.5 - 250 / 1280 && sps[3].move === 0.5 && bySlot.stats.raw['Tween:MoveBy（角色不在场）'] === 1, J(sps) + J(bySlot.stats.raw))
  const noSlots = run(slotRows, { tween: { targetSlots: false } })
  check('tween.targetSlots = false：只认角色名（以前的行为）：槽名的 Tween / Shake 全记 raw', ofOp(noSlots, 'spine').length === 1 && noSlots.stats.raw['Tween:MoveBy（角色不在场）'] === 2 && noSlots.stats.raw['Shake:角色不在场'] === 1, J(noSlots.stats.raw))
  // 自定义槽映射：Chara1 → Left，Tween 的 Arg1 仍写 Utage 的 Chara1
  check('tween.targetSlots 按 slots 表映射（Utage 槽名 Chara1 → spine 槽 Left）', ofOp(run(slotRows, { slots: { Chara1: 'Left' } }), 'spine')[1]?.slot === 'Left', '')
  // 语音诊断
  const noVoice = run([mina({ text: 'a', voice: 'x1' }), mina({ text: 'b', voice: 'x2' })])
  const someVoice = run([mina({ text: 'a', voice: 'v1' }), mina({ text: 'b', voice: 'x2' })])
  check('语音诊断：整个剧情的语音一条都没找到（TSK 9xxxxxx 没有语音目录）→ 合并成一条「该剧情没有语音目录」（计数 = 语音行数），不再逐条列；有找到的 → 照旧逐条列没找到的',
    same(Object.entries(noVoice.stats.unresolved), [['voice:该剧情没有语音目录（2 条语音一条也没找到）', 2]]) && same(someVoice.stats.unresolved, { 'voice:x2': 1 }), J(noVoice.stats.unresolved) + J(someVoice.stats.unresolved))
  check('utage 新选项默认值（schema）：nameOnlyRow show、tween.targetSlots true、catalog.groups 一条；整份显式写默认值结果不变',
    utage.DEFAULT_OPTIONS.nameOnlyRow === 'show' && utage.DEFAULT_OPTIONS.tween.targetSlots === true && utage.DEFAULT_OPTIONS.catalog.groups.length === 1
    && same(run(seqRows, JSON.parse(J(utage.DEFAULT_OPTIONS))).steps, shown.steps), '')
}

// ================= 3. girlscreation-line =================
{
  const FILES = ['scenes/chmr_1/hmr_1.txt', 'scenes/chmr_1/images/abg1.png', 'scenes/chmr_1/images/abg2.png', 'scenes/chmr_1/spines/st1.skel', 'scenes/chmr_1/spines/st1.atlas']
  const run = (lines, options = {}) => {
    const text = lines.join('\n')
    const ctx = gc.prepare({ options, texts: { 'scenes/chmr_1/hmr_1.txt': text }, files: FILES, toResourcePath: (r) => r })
    return parseLine(text, ctx, { rel: 'chmr_1/hmr_1.txt', stem: 'hmr_1', options })
  }
  const flat = (out) => out.steps.flatMap((s) => s.commands)
  const ofOp = (out, op) => flat(out).filter((c) => c.op === op)
  const ACTOR = ['chara,st1,chara_1,10,20,0,1,1,0,on']
  const cmd = (extra) => [...ACTOR, ...extra, 'message,甲,台词,']

  check('GC 新选项默认值（schema）：commands { cgmode: actors, asyncjump: hop, asyncmoveobject: move, crossfade: bg }；line.objectKind / jumpAction / moveBase / crossfadeScale',
    same(GC_DEFAULTS.commands, { cgmode: 'actors', asyncjump: 'hop', asyncmoveobject: 'move', crossfade: 'bg' }) && GC_DEFAULTS.line.jumpAction === 1 && GC_DEFAULTS.line.moveBase === 'offset' && GC_DEFAULTS.line.crossfadeScale === 'bgScale' && GC_DEFAULTS.line.objectKind === '^character$', J(GC_DEFAULTS.commands))

  // cgmode
  const cg = run(['cgmode,on', 'message,甲,a,', 'cgmode,off', 'message,甲,b,'], { commands: { cgmode: 'ui' } })
  check("commands.cgmode = 'ui'（旧默认）：cgmode,on → ui 隐藏、off → ui 显示（秒 0）；不再记 raw", same(ofOp(cg, 'ui').map((c) => c.visible), [false, true]) && !cg.stats.raw.cgmode, J(ofOp(cg, 'ui')))
  const cgRaw = run(['cgmode,on', 'message,甲,a,', 'cgmode,off', 'message,甲,b,'], { commands: { cgmode: 'raw' } })
  check('commands.cgmode = raw：回到以前（没有 ui 指令，stats.raw.cgmode = 2）', ofOp(cgRaw, 'ui').length === 0 && cgRaw.stats.raw.cgmode === 2 && same(run(['cgmode,on', 'message,甲,a,'], { commands: { cgmode: 'bogus' } }).steps, run(['cgmode,on', 'message,甲,a,']).steps), J(cgRaw.stats.raw))

  // asyncjump
  const jump = run(cmd(['asyncjump,character,chara_1,-30,0.5,1']))
  const jumpOps = ofOp(jump, 'spine')
  check('asyncjump,character,chara_1,dy,秒,次数 → 同一个槽的 spine 指令带 action = 1（跳两下），位置 / 动画不变；不记 raw',
    jumpOps.length === 2 && jumpOps[1].slot === 'Actor1' && jumpOps[1].action === 1 && jumpOps[0].action === undefined && jumpOps[1].x === 10 && jumpOps[1].y === 20 && !jump.stats.raw.asyncjump, J(jumpOps))
  check('line.jumpAction 换动作码；commands.asyncjump = raw 回到以前（记 raw）；槽里没有角色 / 目标不是 character → raw，不崩',
    ofOp(run(cmd(['asyncjump,character,chara_1,-30,0.5,1']), { line: { jumpAction: 3 } }), 'spine')[1].action === 3
    && run(cmd(['asyncjump,character,chara_1,-30,0.5,1']), { commands: { asyncjump: 'raw' } }).stats.raw.asyncjump === 1
    && run(cmd(['asyncjump,character,chara_9,-30,0.5,1'])).stats.raw['asyncjump(槽里没有角色)'] === 1 && run(cmd(['asyncjump,subimage,chara_1,-30,0.5,1'])).stats.raw.asyncjump === 1, '')

  // asyncmoveobject
  const move = run(cmd(['asyncmoveobject,character,chara_1,0.4,0,0,10,easeoutcubic', 'asyncmoveobject,character,chara_1,0.5,0,-40,10,linear', 'asyncmoveobject,character,chara_1,0.4,0,0,10,easeoutcubic']))
  const moveOps = ofOp(move, 'spine')
  check('asyncmoveobject（offset，默认）：dx / dy 是相对 chara 摆放位置的偏移 → x / y + move 秒；在原位的 0,0 不出指令；回 0,0 = 回到摆放位置；缓动名 / n 忽略',
    moveOps.length === 3 && moveOps[1].x === 10 && moveOps[1].y === -20 && moveOps[1].move === 0.5 && moveOps[2].x === 10 && moveOps[2].y === 20 && moveOps[2].move === 0.4 && !move.stats.raw.asyncmoveobject, J(moveOps.map((c) => [c.x, c.y, c.move])))
  const moveRel = run(cmd(['asyncmoveobject,character,chara_1,0.5,5,-40,10,linear', 'asyncmoveobject,character,chara_1,0.5,5,-40,10,linear']), { line: { moveBase: 'relative' } })
  check('line.moveBase = relative：dx / dy 在当前位置上累加（连发两次 = 位移两倍）', same(ofOp(moveRel, 'spine').slice(1).map((c) => [c.x, c.y]), [[15, -20], [20, -60]]), J(ofOp(moveRel, 'spine').map((c) => [c.x, c.y])))
  check('asyncmoveobject：秒 = 0 → 一步到位（没有 move 字段）；commands.asyncmoveobject = raw（旧名 x 等于 move）；槽里没有角色 / 目标不是 character → raw',
    ofOp(run(cmd(['asyncmoveobject,character,chara_1,0,5,0,10,linear'])), 'spine')[1].move === undefined
    && run(cmd(['asyncmoveobject,character,chara_1,0.5,5,0,10,linear']), { commands: { asyncmoveobject: 'raw' } }).stats.raw.asyncmoveobject === 1
    && ofOp(run(cmd(['asyncmoveobject,character,chara_1,0.5,5,0,10,linear']), { commands: { asyncmoveobject: 'x' } }), 'spine')[1].move === 0.5
    && run(cmd(['asyncmoveobject,character,chara_7,0.5,5,0,10,linear'])).stats.raw['asyncmoveobject(槽里没有角色)'] === 1 && run(cmd(['asyncmoveobject,object,chara_1,0.5,5,0,10,linear'])).stats.raw.asyncmoveobject === 1, '')
  const hidden = run(['chara,st1,chara_1,10,20,0,1,1,0,off', 'asyncmoveobject,character,chara_1,0.5,5,0,10,linear', 'charafade,chara_1,in,0.3', 'message,甲,x,'])
  check('asyncmoveobject：角色还没显示（chara … off）时只记下位置，之后 charafade in 直接出现在新位置', ofOp(hidden, 'spine').length === 1 && ofOp(hidden, 'spine')[0].x === 15 && ofOp(hidden, 'spine')[0].fade === 0.3, J(ofOp(hidden, 'spine')))

  // CrossFade / TransitionCrossFade
  const cross = run(['CrossFadeReady', 'CrossFade,abg1,1,0,0,1.3,1.3', 'TransitionCrossFadeReady', 'TransitionCrossFade,abg2,tra11a,0.6,0,0,1.3,1.3', 'message,甲,x,'], { line: { bgTransform: 'legacy' } })
  check('line.bgTransform = legacy：CrossFade / TransitionCrossFade → bg + 渐变秒（过渡名 tra11a 忽略）；缩放 ≠ 1 跟一条 bgScale（seconds 0）；Ready 忽略；没有 raw',
    same(flat(cross).filter((c) => ['bg', 'bgScale'].includes(c.op)).map((c) => [c.op, c.src?.replace(/^.*\//, ''), c.fade, c.scale]), [['bg', 'abg1.png', 1, undefined], ['bgScale', undefined, undefined, 1.3], ['bg', 'abg2.png', 0.6, undefined], ['bgScale', undefined, undefined, 1.3]])
    && Object.keys(cross.stats.raw).length === 0, J(flat(cross)) + J(cross.stats.raw))
  const crossPos = run(['CrossFade,abg1,0.6,300,0,1,1', 'TransitionCrossFade,abg2,tra01a,1,300,0,1.3,1.3'], { line: { bgTransform: 'legacy' } })
  check('CrossFade：缩放 = 1 不出 bgScale；x / y 位移没法表示 → raw「CrossFade(位移)」/「TransitionCrossFade(位移)」', ofOp(crossPos, 'bgScale').length === 1 && crossPos.stats.raw['CrossFade(位移)'] === 1 && crossPos.stats.raw['TransitionCrossFade(位移)'] === 1, J(crossPos.stats.raw))
  const crossIgnore = run(['CrossFade,abg1,1,0,0,1.3,1.3'], { line: { bgTransform: 'legacy', crossfadeScale: 'ignore' } })
  check('line.crossfadeScale = ignore：不出 bgScale，记 raw「CrossFade(缩放/位移)」（和以前一样）', ofOp(crossIgnore, 'bgScale').length === 0 && crossIgnore.stats.raw['CrossFade(缩放/位移)'] === 1, J(crossIgnore.stats.raw))
  // 默认（bgZoom）：脚本坐标 1920×1080、y 向上 → 场景像素 ×0.6667、y 取反；回到 0,0,1 补复位
  const zoomed = run(['CrossFade,abg1,0.5,-300,100,1.3,1.3', 'message,甲,x,', 'CrossFade,abg2,0,0,0,1,1', 'CrossFade,abg1,0,0,0,1,1', 'message,甲,y,'])
  const zooms = flat(zoomed).filter((c) => c.op === 'bgZoom')
  check('CrossFade 默认：位移 + 缩放 → 一条 bgZoom（x −300 → −200、y 100 → −66.7、scale 1.3）；回到 0,0,1 补一条复位，之后再 0,0,1 不重复', zooms.length === 2 && zooms[0].scale === 1.3 && Math.abs(zooms[0].x + 200.01) < 0.1 && Math.abs(zooms[0].y + 66.67) < 0.1 && zooms[1].scale === 1 && zooms[1].x === 0 && !Object.keys(zoomed.stats.raw).length, J(zooms) + J(zoomed.stats.raw))
  // subimage / subimagedelete / bgblur / bgcolor / shakeall / asyncshake
  const misc = run(['subimage,abg1,subimage_1,0,-800,1.5,0.5,1,1', 'bgblur,3,2', 'bgcolor,1,0,0.5,1,0', 'shakeall,10,10,0.3,0.01', 'chara,st1,chara_1,0,0,10,1,1,1,on', 'asyncshake,character,chara_1,15,0.4,1', 'textsize,48,2', 'subimagedelete,subimage_1', 'message,甲,x,'])
  const m = flat(misc)
  check('subimage → overlay（脚本坐标 stage 1920×1080、y 取反、缩放 / 层序）；subimagedelete → overlayOff；bgblur → bgBlur（等级 × 3）；bgcolor → bg 纯色；shakeall → shake；asyncshake 角色 → spine 带 shake；textsize 不记 raw',
    m.some((c) => c.op === 'overlay' && c.slot === 'subimage_1' && c.y === 800 && c.scaleX === 1.5 && c.scaleY === 0.5 && c.stage?.[0] === 1920) && m.some((c) => c.op === 'overlayOff' && c.slot === 'subimage_1') && m.some((c) => c.op === 'bgBlur' && c.radius === 9)
    && m.some((c) => c.op === 'bg' && c.color?.join() === '255,0,128') && m.some((c) => c.op === 'shake' && c.axis === 'overall') && m.some((c) => c.op === 'spine' && c.shake?.x === 15) && !Object.keys(misc.stats.raw).length, J(m.map((c) => c.op)) + J(misc.stats.raw))
  const crossRaw = run(['CrossFadeReady', 'CrossFade,abg1,1,0,0,1.3,1.3', 'TransitionCrossFadeReady', 'TransitionCrossFade,abg2,tra11a,0.6,0,0,1.3,1.3', 'message,甲,x,'], { commands: { crossfade: 'raw' } })
  check('commands.crossfade = raw：回到以前（CrossFade 照旧 bg + 渐变、缩放记 raw、没有 bgScale；TransitionCrossFade / Ready 记 raw）',
    same(ofOp(crossRaw, 'bg').map((c) => c.fade), [1]) && ofOp(crossRaw, 'bgScale').length === 0 && same(crossRaw.stats.raw, { 'CrossFade(缩放/位移)': 1, TransitionCrossFadeReady: 1, TransitionCrossFade: 1 }), J(crossRaw.stats.raw))
  check('CrossFade 图找不到 → unresolved，不出指令（两种命令都一样）', run(['CrossFade,nope,1,0,0,1,1', 'TransitionCrossFade,nope2,tra,1,0,0,1,1']).stats.unresolved['bg:nope'] === 1 && run(['TransitionCrossFade,nope2,tra,1,0,0,1,1']).stats.unresolved['bg:nope2'] === 1, '')

  // 不碰的命令不变 / sniff
  const base = ['fade,out,black,0.5', 'bg,abg1,0,0,1,1', 'window,on,0.25', 'message,,旁白,', ...ACTOR, 'charamotion,chara_1,loop,on', 'message,甲,x,']
  check('没有新命令的脚本：默认选项和全部 commands = raw 的结果完全一样（新映射不碰别的命令）', same(run(base).steps, run(base, { commands: { cgmode: 'raw', asyncjump: 'raw', asyncmoveobject: 'raw', crossfade: 'raw' } }).steps), '')
  check('sniffLine：asyncmoveobject / TransitionCrossFade 算行式命令（识别率更高）；标签式脚本仍不认', sniffLine('title,a,\nmessage,甲,x,\nasyncmoveobject,character,chara_1,0.4,0,0,10,linear\nTransitionCrossFade,abg1,tra,1,0,0,1,1\n') && !sniffLine('<NAME_PLATE>a\nx\n'), '')
}

// ================= 4. TSK 按原版代码（gal-samples21 反编译的 DialogueSystem）：摆放 / Tween / 表情图标 =================
{
  const charHeader = ['', 'CharacterName', 'NameText', 'Pattern', 'X', 'Y', 'Z', 'Pivot', 'Scale', 'Conditional', 'FileName', 'SubFileName', 'FileType']
  const texHeader = ['', 'Label', 'Type', 'X', 'Y', 'Z', 'Pivot', 'Scale', 'Conditional', 'FileName', 'FileType']
  const M2 = JSON.stringify({ settingList: [
    table('Master.xls:Character', charHeader, [['', 'ミナ', 'ミナ', '', '40', '150', '', '', '1.5', '', 'Characters/ch_100/ch_100_m0_SkeletonData.asset', '', 'Spine']]),
    table('Master.xls:Texture', texHeader, [['', 'EM_007', 'Sprite', '', '', '', '', '', '', 'Adventure/Textures/Spines/Emote/EM_007_SkeletonData.asset', 'Spine']]),
  ] })
  const FILES2 = ['Adventure/Master.chapter.json', 'Adventure/Textures/Spines/Emote/EM_007.skel.bytes', 'Adventure/Textures/Spines/Emote/EM_007.atlas.txt', 'Characters/ch_100/ch_100_m0.skel.bytes', 'Characters/ch_100/ch_100_m0.atlas.txt']
  const ctx2 = prep({}, M2, FILES2)
  const go = (rows) => utage.parse(B(rows), ctx2, { stem: 't', config: {} })
  const spinesOf = (out) => out.steps.flatMap((st) => st.commands).filter((c) => c.op === 'spine')
  const out = go([
    stand('ミナ', 'Chara1', '100'), T({ a1: 'ミナ', text: 'a' }),
    R('Tween', { a1: 'ミナ', a2: 'MoveBy', a3: 'time=.4 x=-50 y=30', a4: 'easeOutQuad', wait: 'NoWait' }), T({ a1: 'ミナ', text: 'b' }),
    R('Tween', { a1: 'ミナ', a2: 'MoveBy', a3: 'time=.3 y=-30', a4: 'easeOutQuad', a5: 'pingPong=2', wait: 'NoWait' }), T({ text: 'c' }),
    R('Sprite', { a1: 'EM_007', a3: 'Chara1', a4: '-25', a5: '170', anim: 'emotion', comp: 'Delete' }), T({ text: 'd' }),
    T({ text: 'e' }),
  ])
  const sp = spinesOf(out)
  check('TSK 摆放：place = (Master X + Arg4, Master Y − 10)，缩放 = Master Scale；舞台 1280×720（Master X 40 / Y 150 / Scale 1.5，Arg4 = 100）', sp[0].place.x === 140 && sp[0].place.y === 140 && sp[0].place.scale === 1.5 && same(sp[0].stage, [1280, 720]), J(sp[0]))
  const moved = sp.find((c) => c.move)
  check('TSK Tween MoveBy（非 pingPong）：时长 = time / 2、缓动原样带上、x 偏移记下来（后面的台词沿用）、y 偏移只到这个角色的下一句台词', moved.move === 0.2 && moved.ease === 'easeOutQuad' && moved.place.x === 90 && moved.place.y === 170, J(moved))
  const afterSpeak = sp[sp.indexOf(moved) + 1]
  check('TSK：这个角色再说话 → 重新摆一次（纵向偏移回到 0，横向偏移保留 = 原版 SetCharacterSpineAnimation）', afterSpeak && afterSpeak.place.x === 90 && afterSpeak.place.y === 140, J(afterSpeak))
  const bounce = sp.find((c) => c.bounce)
  check('TSK Tween pingPong=2：bounce { x:0, y:-30, 每段 0.3 秒，共 2 段 }，位置不变', bounce.bounce.y === -30 && bounce.bounce.seconds === 0.3 && bounce.bounce.count === 2 && bounce.place.x === 90, J(bounce))
  const emote = sp.find((c) => c.slot === 'Chara1Emote')
  check('TSK Sprite EM_xxx：Emotion 子物体（骨架 Adventure/Textures/Spines/Emote/EM_007），y = max(0, Arg5 − 130) 再加 Characters 轴心 120，ttl 1 秒（原版 1 秒后销毁）；下一步开头补 spineOff', emote && emote.skel === 'Adventure/Textures/Spines/Emote/EM_007.skel.bytes' && emote.place.x === -25 && emote.place.y === 160 && emote.place.scale === 1 && emote.ttl === 1 && emote.anim === 'emotion' && out.steps.some((st) => st.commands[0]?.op === 'spineOff' && st.commands[0].slot === 'Chara1Emote'), J(emote))
  const noEmote = go([T({ text: 'x' }), R('Sprite', { a1: 'EM_999', a3: 'Chara1' }), T({ text: 'y' })])
  check('TSK Sprite：骨架不在索引里 → 记「缺资源」不崩；AE_ / BE_ 在 Master 里没有 Spine 定义（原版什么都不做）→ raw', noEmote.stats.unresolved['effect:EM_999'] === 1 && go([R('Sprite', { a1: 'AE_0030', a3: 'EffectF' }), T({ text: 'z' })]).stats.raw['Sprite:AE'] === 1, J(noEmote.stats))
}

// ================= 5. Aku / Fruits：sceneImageData（EV / BG 图的底图 = 差分图要叠在底图上）=================
{
  const imageData = 'sceneImageData = {\n "./scenes/c1/images/still_a_02.webp": null,\n "./scenes/c1/images/still_a_01.webp": "./scenes/c1/images/still_a_02.webp",\n "./scenes/c1/images/still_a_04.webp": "./scenes/c1/images/still_a_02.webp"\n}'
  const dataFile = 'data/scripts/data/sceneImageData.js'
  const text = ['<EV>still_a_02,0', '<NAME_PLATE>甲', 'a', '<PAUSE>', '<EV>still_a_01,0', '<NAME_PLATE>甲', 'b', '<PAUSE>', '<BG>still_a_04,0,0,1,1', '<NAME_PLATE>甲', 'c', '<PAUSE>'].join('\n')
  const files = ['scenes/c1/script.txt', 'scenes/c1/images/still_a_02.png', 'scenes/c1/images/still_a_01.png', 'scenes/c1/images/still_a_04.png']
  const ctx = gc.prepare({ options: {}, texts: { [dataFile]: imageData }, files, toResourcePath: (r) => r })
  const out = gc.parse(text, ctx, { rel: 'c1/script.txt', stem: 'script' })
  const bgs = out.steps.flatMap((st) => st.commands).filter((c) => c.op === 'bg').map((c) => [c.src.replace(/^.*\//, ''), c.over?.replace(/^.*\//, '')])
  check('Aku sceneImageData：底图（值 null）的 EV 单独画；有底图的 EV / BG（差分图）→ bg { src: 底图, over: 这张 }（原版 preloader 先画底图再叠这张）', J(bgs) === J([['still_a_02.png', undefined], ['still_a_02.png', 'still_a_01.png'], ['still_a_02.png', 'still_a_04.png']]), J(bgs))
  check('contextFiles：默认读 <root>/data/scripts/data/sceneImageData.js；sceneImageData 写空串 = 不读', J(gc.contextFiles({ root: 'pk' })) === J(['pk/data/scripts/data/sceneImageData.js']) && gc.contextFiles({ sceneImageData: '' }).length === 0, J(gc.contextFiles({ root: 'pk' })))
}

// ================= 6. 魔法学园：语音按原版的目录规则（剧情文件名目录优先；同名文件在别的目录里不会抢）=================
{
  const aw = await import('../../web/library/gal/adapters/artwhirl-json.mjs')
  const files = ['audio/voice/AKUKAGUYA_ca1_00/AKUKAGUYA_ca1_AKUKAGUYA_003.ogg', 'audio/voice/AKUKAGUYA_ca1_h2/AKUKAGUYA_ca1_AKUKAGUYA_003.ogg', 'audio/voice/VANESSA_ep5_h/VANESSA_ep5_h_GINA_001.ogg']
  const ctx = aw.prepare({ options: {}, files, toResourcePath: (r) => r })
  const story = (voice) => JSON.stringify({ texts: ['a'], voices: [voice], names: [null], colors: [null], charas: [null], bgs: [null], bgms: [null], others: [null], dic: [] })
  const voiceOf = (voice, stem) => aw.parse(story(voice), ctx, { stem }).steps.flatMap((st) => st.commands).find((c) => c.op === 'voice')?.src
  check('artwhirl 语音：音频名 .mp3 → .ogg，先找 audio/voice/<剧情文件名>/（AKUKAGUYA_ca1_h2 的 003 不会被 AKUKAGUYA_ca1_00 里同名的抢走）', voiceOf('AKUKAGUYA_ca1_AKUKAGUYA_003.mp3', 'AKUKAGUYA_ca1_h2') === 'audio/voice/AKUKAGUYA_ca1_h2/AKUKAGUYA_ca1_AKUKAGUYA_003.ogg' && voiceOf('AKUKAGUYA_ca1_AKUKAGUYA_003.mp3', 'AKUKAGUYA_ca1_00') === 'audio/voice/AKUKAGUYA_ca1_00/AKUKAGUYA_ca1_AKUKAGUYA_003.ogg', J([voiceOf('AKUKAGUYA_ca1_AKUKAGUYA_003.mp3', 'AKUKAGUYA_ca1_h2')]))
  check('artwhirl 语音：复用别的剧情组的语音（语音名里 _h<数字> 之前的部分是目录）也找得到', voiceOf('VANESSA_ep5_h_GINA_001.mp3', 'VANESSA_ep6_h') === 'audio/voice/VANESSA_ep5_h/VANESSA_ep5_h_GINA_001.ogg', J(voiceOf('VANESSA_ep5_h_GINA_001.mp3', 'VANESSA_ep6_h')))
  const truncated = aw.prepare({ options: {}, files: Object.assign([], { truncated: true }), toResourcePath: (r) => r })
  const guess = aw.parse(story('X_ca1_X_001.mp3'), truncated, { stem: 'X_ca1_h2' }).steps.flatMap((st) => st.commands).find((c) => c.op === 'voice')?.src
  check('artwhirl 语音：文件索引被截断时按原版第一个候选目录直接给路径（不再静默没声音）', guess === 'audio/voice/X_ca1_h2/X_ca1_X_001.ogg', J(guess))
}

// ================= 7. TSK：章拆分 / 盖黑后台词自动淡入 / BgEvent 播放规则（原版 Line_RunDialogue / ProcessBgEventAnimation）=================
{
  const charHeader = ['', 'CharacterName', 'NameText', 'Pattern', 'X', 'Y', 'Z', 'Pivot', 'Scale', 'Conditional', 'FileName', 'SubFileName', 'FileType']
  const M3 = JSON.stringify({ settingList: [table('Master.xls:Character', charHeader, [['', 'ミナ', 'ミナ', '', '0', '130', '', '', '1', '', 'Characters/ch_100/ch_100_m0_SkeletonData.asset', '', 'Spine']])] })
  const ctx3 = prep({}, M3, ['Adventure/Master.chapter.json', 'Characters/ch_100/ch_100_m0.skel.bytes', 'Characters/ch_100/ch_100_m0.atlas.txt', 'Stills/st_9/st_9.skel.bytes', 'Stills/st_9/st_9.atlas.txt'])
  const grid = (rows) => ({ rows: [{ strings: HEADER }, ...rows].map((row, i) => ({ rowIndex: i, isEmpty: 0, isCommentOut: 0, ...row })) })
  const book = JSON.stringify({ importGridList: [grid([R('FadeOut', { a6: '1' }), T({ text: 'g1' })]), grid([T({ text: 'g2' })])] })
  const all = utage.parse(book, ctx3, { stem: 'b', config: {} })
  const ops = (out) => out.steps.flatMap((st) => st.commands)
  check('TSK：FadeOut 盖黑后第一句台词前自动补 fade clear 0（原版：画面全黑时台词出现就瞬间淡入）', same(ops(all).filter((c) => c.op === 'fade').map((c) => [c.to, c.seconds]), [['black', 1], ['clear', 0]]), J(ops(all).filter((c) => c.op === 'fade')))
  check('TSK：多章（多个 grid）接起来播时章与章之间插一步「第 2 章」；带 scene（::2）只播第 2 章，超出报错', all.steps.length === 3 && all.steps[1].commands.some((c) => c.op === 'text' && /第 2 章/.test(c.segments[0].text)) && utage.parse(book, ctx3, { stem: 'b', scene: '2', config: {} }).steps.length === 1 && (() => { try { utage.parse(book, ctx3, { scene: '3', config: {} }); return false } catch { return true } })(), J(all.steps.length))
  const still = (extra) => utage.parse(B([R('BgEvent', { a1: 'st_9', anim: 'cut_1', ...extra }), T({ text: 'x' })]), ctx3, { config: {} }).steps.flatMap((st) => st.commands).find((c) => c.op === 'spine')
  const rows = [[{}, false, true], [{ anim: 'cut_2_loop' }, true, false], [{ comp: 'stop', anim: 'cut_2_loop' }, false, true], [{ comp: 'start' }, true, false], [{ speed: '0.5' }, true, false], [{ speed: '0' }, false, true]]
  check('TSK BgEvent 播放规则：AnimSpd > 0 循环 / 0 冻结；stop 冻结、start 循环；没有时动画名带 loop 循环，否则冻结（速度 0）', rows.every(([extra, loop, freeze]) => { const c = still(extra); return c.loop === loop && Boolean(c.freeze) === freeze }), J(rows.map(([e]) => J(still(e)))))
}

// 多章的剧情文件：列表里展开成「第 N 章（路径 ::N）」；单章的还是一个场景
{
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'utage-ch-'))
  await mkdir(path.join(dir, 'Adventure/CharaScenario'), { recursive: true })
  const grid = (name) => ({ name, rows: [] })
  await writeFile(path.join(dir, 'Adventure/CharaScenario/CharaScenario1001001.book.json'), JSON.stringify({ importGridList: [grid('x.xlsx:Ch1'), grid('x.xlsx:Ch2'), grid('x.xlsx:Ch3')] }))
  await writeFile(path.join(dir, 'Adventure/CharaScenario/CharaScenario1001002.book.json'), JSON.stringify({ importGridList: [grid('y.xlsx:Ch1')] }))
  const ctx = await utage.prepare({ options: {}, texts: {}, files: ['Adventure/CharaScenario/CharaScenario1001001.book.json', 'Adventure/CharaScenario/CharaScenario1001002.book.json'], mediaDir: dir })
  const find = (node, id) => (node.id === id ? node : (node.children || []).map((c) => find(c, id)).find(Boolean))
  const multi = find(ctx.catalogTree, 'all/CharaScenario1001001')
  const single = find(ctx.catalogTree, 'all/CharaScenario1001002')
  check('多章文件展开：第 1～3 章（::N）；单章文件还是一个场景', multi?.children?.length === 3 && multi.children[1].script.endsWith('.book.json::2') && !multi.script && single?.script && !single.children, J([multi, single]))
  await rm(dir, { recursive: true, force: true })
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
