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
    sp.length === 3 && sp[1].slot === 'Chara2' && sp[1].x === 0.5 + 250 / 1280 && sp[2].slot === 'Chara2' && sp[2].action === 3 && !Object.keys(shown.stats.raw).some((k) => k.startsWith('Tween')), J(sp) + J(shown.stats.raw))
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
  check('tween.targetSlots（默认 true）：Tween / Shake 的 Arg1 是槽名（Chara1）→ 指现在站在这个槽里的角色（动作 3 / 动作 2 / MoveTo 的 move）；空槽（Chara3）仍记「角色不在场」',
    sps.length === 4 && sps[1].action === 3 && sps[2].action === 2 && sps[3].x === 0.5 - 250 / 1280 && sps[3].move === 1 && bySlot.stats.raw['Tween:MoveBy（角色不在场）'] === 1, J(sps) + J(bySlot.stats.raw))
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

  check('GC 新选项默认值（schema）：commands { cgmode: ui, asyncjump: hop, asyncmoveobject: move, crossfade: bg }；line.objectKind / jumpAction / moveBase / crossfadeScale',
    same(GC_DEFAULTS.commands, { cgmode: 'ui', asyncjump: 'hop', asyncmoveobject: 'move', crossfade: 'bg' }) && GC_DEFAULTS.line.jumpAction === 1 && GC_DEFAULTS.line.moveBase === 'offset' && GC_DEFAULTS.line.crossfadeScale === 'bgScale' && GC_DEFAULTS.line.objectKind === '^character$', J(GC_DEFAULTS.commands))

  // cgmode
  const cg = run(['cgmode,on', 'message,甲,a,', 'cgmode,off', 'message,甲,b,'])
  check('cgmode,on → ui 隐藏、off → ui 显示（秒 0）；不再记 raw', same(ofOp(cg, 'ui').map((c) => c.visible), [false, true]) && !cg.stats.raw.cgmode, J(ofOp(cg, 'ui')))
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
  const cross = run(['CrossFadeReady', 'CrossFade,abg1,1,0,0,1.3,1.3', 'TransitionCrossFadeReady', 'TransitionCrossFade,abg2,tra11a,0.6,0,0,1.3,1.3', 'message,甲,x,'])
  check('CrossFade / TransitionCrossFade → bg + 渐变秒（过渡名 tra11a 忽略）；缩放 ≠ 1 跟一条 bgScale（seconds 0）；Ready 忽略；没有 raw',
    same(flat(cross).filter((c) => ['bg', 'bgScale'].includes(c.op)).map((c) => [c.op, c.src?.replace(/^.*\//, ''), c.fade, c.scale]), [['bg', 'abg1.png', 1, undefined], ['bgScale', undefined, undefined, 1.3], ['bg', 'abg2.png', 0.6, undefined], ['bgScale', undefined, undefined, 1.3]])
    && Object.keys(cross.stats.raw).length === 0, J(flat(cross)) + J(cross.stats.raw))
  const crossPos = run(['CrossFade,abg1,0.6,300,0,1,1', 'TransitionCrossFade,abg2,tra01a,1,300,0,1.3,1.3'])
  check('CrossFade：缩放 = 1 不出 bgScale；x / y 位移没法表示 → raw「CrossFade(位移)」/「TransitionCrossFade(位移)」', ofOp(crossPos, 'bgScale').length === 1 && crossPos.stats.raw['CrossFade(位移)'] === 1 && crossPos.stats.raw['TransitionCrossFade(位移)'] === 1, J(crossPos.stats.raw))
  const crossIgnore = run(['CrossFade,abg1,1,0,0,1.3,1.3'], { line: { crossfadeScale: 'ignore' } })
  check('line.crossfadeScale = ignore：不出 bgScale，记 raw「CrossFade(缩放/位移)」（和以前一样）', ofOp(crossIgnore, 'bgScale').length === 0 && crossIgnore.stats.raw['CrossFade(缩放/位移)'] === 1, J(crossIgnore.stats.raw))
  const crossRaw = run(['CrossFadeReady', 'CrossFade,abg1,1,0,0,1.3,1.3', 'TransitionCrossFadeReady', 'TransitionCrossFade,abg2,tra11a,0.6,0,0,1.3,1.3', 'message,甲,x,'], { commands: { crossfade: 'raw' } })
  check('commands.crossfade = raw：回到以前（CrossFade 照旧 bg + 渐变、缩放记 raw、没有 bgScale；TransitionCrossFade / Ready 记 raw）',
    same(ofOp(crossRaw, 'bg').map((c) => c.fade), [1]) && ofOp(crossRaw, 'bgScale').length === 0 && same(crossRaw.stats.raw, { 'CrossFade(缩放/位移)': 1, TransitionCrossFadeReady: 1, TransitionCrossFade: 1 }), J(crossRaw.stats.raw))
  check('CrossFade 图找不到 → unresolved，不出指令（两种命令都一样）', run(['CrossFade,nope,1,0,0,1,1', 'TransitionCrossFade,nope2,tra,1,0,0,1,1']).stats.unresolved['bg:nope'] === 1 && run(['TransitionCrossFade,nope2,tra,1,0,0,1,1']).stats.unresolved['bg:nope2'] === 1, '')

  // 不碰的命令不变 / sniff
  const base = ['fade,out,black,0.5', 'bg,abg1,0,0,1,1', 'window,on,0.25', 'message,,旁白,', ...ACTOR, 'charamotion,chara_1,loop,on', 'message,甲,x,']
  // 换背景 = 下一个场景：台上的演员收掉（用户反馈：场景切换了人物没消失）
  const sceneChange = run([...ACTOR, 'message,甲,a,', 'CrossFadeReady', 'CrossFade,abg1,1,0,0,1,1', 'message,甲,b,', 'bg,abg2,0,0,1', 'message,甲,c,'])
  const offAt = (out) => out.steps.map((st) => st.commands.filter((c) => c.op === 'spineOff' || c.op === 'bg').map((c) => c.op))
  check('换背景（CrossFade / bg）：台上的演员 spineOff（先收人再换背景）；背景之前没有演员时不发', same(offAt(sceneChange).flat(), ['spineOff', 'bg', 'bg']) && ofOp(sceneChange, 'spineOff').length === 1, J(offAt(sceneChange)))
  const keepActors = run([...ACTOR, 'message,甲,a,', 'CrossFade,abg1,1,0,0,1,1', 'message,甲,b,'], { line: { clearActorsOnBg: false } })
  check('line.clearActorsOnBg = false：回到旧行为（换背景不收演员，只有 charafade out / charadelete 才收）', ofOp(keepActors, 'spineOff').length === 0, J(ofOp(keepActors, 'spineOff')))
  const reshow = run([...ACTOR, 'message,甲,a,', 'CrossFade,abg1,1,0,0,1,1', 'charafade,chara_1,in,0.3', 'message,甲,b,'])
  check('收掉之后脚本再 charafade in：演员重新摆出来（演员记录没删）', ofOp(reshow, 'spine').length >= 2 && ofOp(reshow, 'spineOff').length === 1, J(reshow.steps.map((st) => st.commands.map((c) => c.op))))
  check('没有新命令的脚本：默认选项和全部 commands = raw 的结果完全一样（新映射不碰别的命令）', same(run(base).steps, run(base, { commands: { cgmode: 'raw', asyncjump: 'raw', asyncmoveobject: 'raw', crossfade: 'raw' } }).steps), '')
  check('sniffLine：asyncmoveobject / TransitionCrossFade 算行式命令（识别率更高）；标签式脚本仍不认', sniffLine('title,a,\nmessage,甲,x,\nasyncmoveobject,character,chara_1,0.4,0,0,10,linear\nTransitionCrossFade,abg1,tra,1,0,0,1,1\n') && !sniffLine('<NAME_PLATE>a\nx\n'), '')
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
