#!/usr/bin/env node
// ミナシゴノシゴトR 立绘 / 叠加层自测（不需要浏览器）：plist 解析（含旋转帧）、帧定位、uviewer-csv 指令翻译（sprites 选项）、引擎状态（stand 槽位 / overlay）、
// 导入 → 列表分组 → 场景的端到端（gal-layout 的 minashigo_r 配置）。需要 ImageMagick（造 fixture 里的 jpg）。
//   node scripts/dev/gal-sprites-selftest.mjs
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_OPTIONS, parse } from '../../web/library/gal/adapters/uviewer-csv.mjs'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { generateTags as galLayoutScript, LAYOUTS } from '../../scripts/tag-scripts/gal-layout/main.js'
import { atlasFrames, findFrame, framePlacement, parsePlist, resolveAtlasFrames } from '../../web/static/gal-atlas.js'
import { applyCommand, initialState, stateAt } from '../../web/static/gal-engine.js'
import { ATLAS_PLIST, buildMinashigoRFixture } from './make-minashigo-r-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-sprites-'))

// ================= plist 解析 =================
{
  // 真实样本（gal-samples8 F 段，data/adv/image/character/230601/atlas/stand_a.plist 开头）
  const real = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
    <dict>
        <key>frames</key>
        <dict>
            <key>000.png</key>
            <dict>
                <key>aliases</key>
                <array/>
                <key>spriteOffset</key>
                <string>{12,520}</string>
                <key>spriteSize</key>
                <string>{344,294}</string>
                <key>spriteSourceSize</key>
                <string>{2048,2048}</string>
                <key>textureRect</key>
                <string>{{1,1213},{344,294}}</string>
                <key>textureRotated</key>
                <false/>
            </dict>
        </dict>
        <key>metadata</key>
        <dict>
            <key>format</key><integer>3</integer>
            <key>realTextureFileName</key><string>stand_a.png</string>
            <key>size</key><string>{2048,1162}</string>
        </dict>
    </dict>
</plist>`
  const parsed = parsePlist(real)
  const atlas = atlasFrames(parsed)
  const f = atlas.frames.get('000.png')
  check('plist：真实样本解析：帧 000.png 的偏移 / 大小 / 画布 / 贴图区域 / 不旋转', f && J(f.offset) === J([12, 520]) && J(f.size) === J([344, 294]) && J(f.source) === J([2048, 2048]) && J(f.rect) === J([1, 1213, 344, 294]) && f.rotated === false, J(f))
  check('plist：metadata（贴图名 stand_a.png、size 2048x1162 非方形）；format 3', atlas.texture === 'stand_a.png' && J(atlas.size) === J([2048, 1162]) && parsed.metadata.format === 3)
  const p = atlasFrames(parsePlist(ATLAS_PLIST))
  check('plist：fixture 的 3 个帧（000 / 001 / body）', J([...p.frames.keys()].sort()) === J(['000.png', '001.png', 'body.png']))
  const rot = p.frames.get('001.png')
  check('旋转帧：rotated = true、还原后 30x10，在贴图里占 10x30', rot.rotated === true && J(rot.size) === J([30, 10]) && J(rot.rect) === J([95, 1, 10, 30]), J(rot))
  const place = framePlacement(rot)
  check('framePlacement：贴图区域 sx,sy,sw,sh = 占的区域；中心偏移 y 取反（plist 向上 → 画布向下）', J([place.sx, place.sy, place.sw, place.sh, place.dx, place.dy, place.w, place.h, place.rotated]) === J([95, 1, 10, 30, 0, -40, 30, 10, true]), J(place))
  const frames = p.frames
  check('findFrame：候选里第一个存在的（000.png 不在时试 body:000.png / 000）；都没有 = null', findFrame(frames, ['x.png', '000.png']).name === '000.png' && findFrame(new Map([['000', { name: '000' }]]), ['000.png', 'body:000.png', '000']).name === '000' && findFrame(frames, ['nope']) === null)
  const seq = resolveAtlasFrames(frames, { frames: ['001.png'], base: ['body.png', 'nope.png'] })
  check('resolveAtlasFrames：底图（存在的）先、主帧后；主帧不存在 = null；frame（单个名）也行', J(seq.map((x) => x.name)) === J(['body.png', '001.png']) && resolveAtlasFrames(frames, { frames: ['zzz'], base: ['body.png'] }) === null && resolveAtlasFrames(frames, { frame: '000.png' })[0].name === '000.png')
  // 格式 2
  const v2 = atlasFrames(parsePlist(`<plist><dict><key>frames</key><dict><key>a.png</key><dict><key>frame</key><string>{{2,3},{40,20}}</string><key>offset</key><string>{1,-2}</string><key>rotated</key><true/><key>sourceColorRect</key><string>{{0,0},{40,20}}</string><key>sourceSize</key><string>{64,64}</string></dict></dict></dict></plist>`)).frames.get('a.png')
  check('格式 2（frame / offset / sourceSize / rotated）也认', J([v2.rect, v2.offset, v2.source, v2.rotated]) === J([[2, 3, 20, 40], [1, -2], [64, 64], true]), J(v2))
  check('实体 / 注释 / 自闭合 / 浮点 / 整数', J(parsePlist('<plist><!-- c --><dict><key>a&amp;b</key><string>x &lt;y&gt; &#65;&#x42;</string><key>n</key><real>1.5</real><key>i</key><integer>-3</integer><key>e</key><array/><key>t</key><true/><key>f</key><false/></dict></plist>')) === J({ 'a&b': 'x <y> AB', n: 1.5, i: -3, e: [], t: true, f: false }))
  const throws = (text) => { try { parsePlist(text); return false } catch { return true } }
  check('坏输入全部抛错（不闭合 / 标签不配对 / dict 缺 key / 数字不合法 / 空 / 嵌套太深 / 太大 / 未知元素）', throws('<plist><dict><key>a</key>') && throws('<plist><dict></array></plist>') && throws('<plist><dict><string>x</string></dict></plist>') && throws('<plist><integer>zz</integer></plist>') && throws('') && throws(`<plist>${'<array>'.repeat(40)}${'</array>'.repeat(40)}</plist>`) && throws(`<plist><string>${'x'.repeat(4 * 1024 * 1024 + 1)}</string></plist>`) && throws('<plist><script/></plist>'))
  check('__proto__ 之类的 key 不会污染原型；没有 frames 的 plist = 空表', ({}).polluted === undefined && parsePlist('<plist><dict><key>__proto__</key><dict><key>polluted</key><true/></dict></dict></plist>') && ({}).polluted === undefined && atlasFrames(parsePlist('<plist><dict/></plist>')).frames.size === 0 && atlasFrames(null).frames.size === 0)
  check('不合法的帧（大小 <= 0 / 缺字段）被跳过，不影响别的帧', atlasFrames(parsePlist('<plist><dict><key>frames</key><dict><key>bad.png</key><dict><key>textureRect</key><string>{{0,0},{0,0}}</string></dict><key>ok.png</key><dict><key>textureRect</key><string>{{0,0},{5,5}}</string></dict><key>junk.png</key><string>x</string></dict></dict></plist>')).frames.size === 1)
}

// ================= uviewer-csv：sprites 选项 =================
const SCRIPT = [
  'bg,/adv/image/bg/bg5002505.jpg,0',
  'sprite,adv/image/ef/black.jpg,black,0,0,0,0,,,,', 'mask,black1,0,0,1280,200,0.5,,,,', 'imgconf,black,black1,0,0,,,0,1,1,0.5',
  'spriteatlas,adv/image/character/600201/atlas/stand_a,body:003,dan,0,-320,0.7,0.5,,,,',
  'spriteatlas,adv/image/character/600201/atlas/stand_a,body:002,dan2,0,0,0,0,,,,',
  'sprite,adv/image/character/200903/image/201.jpg,still1,0,0,1,0.5',
  'imgconf,still1,dan1,5,-10,,,0,2,2,0.5', 'imgconf,dan2,dan1,0,-1360,,,0,2,2,0.5',
  'shake,0.1,3,10,10,dan', 'shake,0.2,4,15,0,still915', 'shake,0.2,4,0,8', 'shake,0.2,4,0,0',
  'anm,tint,dan,150_150_150,0.0001,0', 'flash,255,255,255,4,0.3,1.0', 'endwmsg,', 'endwmsg, ',
  'spriteoff,dan,0.2', 'spriteoff,still1,0', 'spriteoff,never,0', 'spriteoff,all,0.5,,,,,,,,,',
  'clickwait',
].join('\n')
const run = (options) => parse(SCRIPT, null, { options })
const ops = (r) => r.steps.flatMap((s) => s.commands)
{
  const baseline = ops(run({})).map((c) => (c.op === 'raw' ? `raw:${c.cmd}` : c.op)).join()
  check('默认（没写 sprites / enabled = false）：行为和以前一样：立绘 / 叠加层指令全是 raw、flash 渲染、endwmsg / spriteoff 丢弃、shake 是 raw', baseline === 'bg,raw:sprite,raw:mask,raw:imgconf,raw:spriteatlas,raw:spriteatlas,raw:sprite,raw:imgconf,raw:imgconf,raw:shake,raw:shake,raw:shake,raw:shake,raw:anm,flash', baseline)
  check('sprites.enabled = false 明写 / 写了别的子键但没开：同样不变', J(run({ sprites: { enabled: false, fit: 'cover' } })) === J(run({})) && J(run({ sprites: { enabled: 'yes' } })) === J(run({})))
  check('DEFAULT_OPTIONS.sprites.enabled 默认 false；commands 表覆盖全部 9 条指令', DEFAULT_OPTIONS.sprites.enabled === false && Object.keys(DEFAULT_OPTIONS.sprites.commands).length === 9)

  const on = ops(run({ sprites: { enabled: true } }))
  const kinds = on.map((c) => (c.op === 'raw' ? `raw:${c.cmd}` : c.op === 'overlay' || c.op === 'stand' ? `${c.op}:${c.slot}` : c.op))
  check('enabled：全部按表翻译（默认表）：sprite → overlay、mask → overlay（矩形）、imgconf → overlay（只对建过的叠加层）、spriteatlas → stand、shake / flash、spriteoff → standOff / overlayOff；anm 保留 raw；endwmsg 丢弃', J(kinds) === J(['bg', 'overlay:black', 'overlay:black1', 'overlay:black', 'stand:dan', 'stand:dan2', 'overlay:still1', 'overlay:still1', 'raw:imgconf', 'shake', 'shake', 'shake', 'raw:anm', 'flash', 'standOff', 'overlayOff', 'standOff']), J(kinds))
  const stand = on.find((c) => c.op === 'stand')
  check('spriteatlas → stand：槽位 dan、舞台 1280x720、图集路径 + .plist / .png、候选帧名 003.png / body:003.png / 003、x=0、y=320（脚本 y 向上 -320 → 向下 320）、scale 0.7、fade 0.5', J(stand) === J({ op: 'stand', slot: 'dan', stage: [1280, 720], parts: [{ atlas: { plist: 'adv/image/character/600201/atlas/stand_a.plist', texture: 'adv/image/character/600201/atlas/stand_a.png', frames: ['003.png', 'body:003.png', '003'] }, x: 0, y: 320, scale: 0.7 }], fade: 0.5 }), J(stand))
  check('开头斜杠的资源路径被规范化（bg /adv/…）；y = 0 不会变成 -0', on[0].src === 'adv/image/bg/bg5002505.jpg' && Object.is(on.find((c) => c.slot === 'dan2').parts[0].y, 0))
  const sprite = on.find((c) => c.op === 'overlay' && c.slot === 'still1' && c.src)
  check('sprite → overlay：src、x / y（取反）、scaleX = scaleY = 第 5 个参数、fade = 第 6 个；默认不带 fit', J(sprite) === J({ op: 'overlay', slot: 'still1', src: 'adv/image/character/200903/image/201.jpg', x: 0, y: 0, scaleX: 1, scaleY: 1, fade: 0.5, stage: [1280, 720] }), J(sprite))
  const rect = on.find((c) => c.slot === 'black1')
  check('mask → overlay 矩形：rect [x, y（从底边往上数 → 左上角向下）, w, h]、color #000000、alpha', J(rect) === J({ op: 'overlay', slot: 'black1', rect: [0, 520, 1280, 200], color: '#000000', alpha: 0.5, stage: [1280, 720] }), J(rect))
  const layout = on.filter((c) => c.op === 'overlay' && c.slot === 'still1')[1]
  check('imgconf → overlay 布局更新（只有布局字段，没有 src / rect）：x / y（取反）/ scaleX / scaleY / fade；旋转 / mask 名不用', J(layout) === J({ op: 'overlay', slot: 'still1', x: 5, y: 10, scaleX: 2, scaleY: 2, fade: 0.5 }), J(layout))
  const shakes = on.filter((c) => c.op === 'shake')
  check('shake：x 和 y 都有 = overall、只有 x = horizontal、只有 y = vertical；strength = 振幅 / 40；两个都是 0 = 不输出；槽位参数忽略（整屏抖）', J(shakes) === J([{ op: 'shake', axis: 'overall', strength: 0.25, seconds: 0.1 }, { op: 'shake', axis: 'horizontal', strength: 0.375, seconds: 0.2 }, { op: 'shake', axis: 'vertical', strength: 0.2, seconds: 0.2 }]), J(shakes))
  const offs = on.filter((c) => c.op === 'standOff' || c.op === 'overlayOff')
  check('spriteoff：dan（建过的立绘）→ standOff{slot}；still1（建过的叠加层）→ overlayOff{slot}；没建过的槽位 = 不输出；all → 只清立绘（offAll 默认 [stand]）', J(offs) === J([{ op: 'standOff', slot: 'dan', fade: 0.2 }, { op: 'overlayOff', slot: 'still1', fade: 0 }, { op: 'standOff', fade: 0.5 }]), J(offs))
  check('flash 输出和关着 sprites 时完全一样', J(on.find((c) => c.op === 'flash')) === J(ops(run({})).find((c) => c.op === 'flash')))
  check('stats.raw 只数保留成 raw 的（anm 1 + 一条没建过的 imgconf dan2 = 2）', J(run({ sprites: { enabled: true } }).stats.raw) === J({ imgconf: 1, anm: 1 }), J(run({ sprites: { enabled: true } }).stats.raw))

  // 选项：commands 表 / slotRules / fit / stage / yUp / numbers / atlas / offAll / maskColor
  const tuned = ops(run({ sprites: { enabled: true, fit: 'contain', stage: { width: 1920, height: 1080 }, yUp: false, maskColor: '#112233', offAll: ['stand', 'overlay'], atlas: { baseKeys: ['{name}.png'], frameKeys: ['{name}:{n}.png'], plistExt: '.xml' } } }))
  const tStand = tuned.find((c) => c.op === 'stand')
  check('选项：atlas.frameKeys / baseKeys / plistExt、stage、yUp = false（y 不取反）', J(tStand.parts[0].atlas) === J({ plist: 'adv/image/character/600201/atlas/stand_a.xml', texture: 'adv/image/character/600201/atlas/stand_a.png', frames: ['body:003.png'], base: ['body.png'] }) && tStand.parts[0].y === -320 && J(tStand.stage) === J([1920, 1080]), J(tStand))
  check('选项：fit = contain 写进 overlay；maskColor；yUp = false 时矩形 y 不换算；offAll 两类都清（standOff + overlayOff）', tuned.find((c) => c.slot === 'still1' && c.src).fit === 'contain' && tuned.find((c) => c.slot === 'black1').color === '#112233' && J(tuned.find((c) => c.slot === 'black1').rect) === J([0, 0, 1280, 200]) && J(tuned.filter((c) => /Off$/.test(c.op)).slice(-2).map((c) => c.op)) === J(['standOff', 'overlayOff']))
  const raws = ops(run({ sprites: { enabled: true, commands: { mask: 'raw', imgconf: 'raw', spriteatlas: 'ignore', anm: 'ignore', shake: 'raw', flash: 'raw', endwmsg: 'raw' } } }))
  check('commands 表：raw / ignore 可选（mask / imgconf / shake / flash / endwmsg = raw、spriteatlas / anm = ignore）；非法值回到默认', raws.filter((c) => c.op === 'raw').map((c) => c.cmd).join() === 'mask,imgconf,imgconf,imgconf,shake,shake,shake,shake,flash,endwmsg,endwmsg' && !raws.some((c) => c.op === 'stand') && J(ops(run({ sprites: { enabled: true, commands: { sprite: 'bogus', anm: 'stand' } } }))) === J(on))
  const rules = ops(run({ sprites: { enabled: true, slotRules: [{ cmds: ['sprite'], match: '^black\\d*$', as: 'raw' }, { cmds: ['mask', 'imgconf'], match: '^(?:black|dan)\\d*$', as: 'ignore' }, { match: '^still\\d*$', as: 'ignore' }, { match: '[', as: 'ignore' }, { match: 'x', as: 'nonsense' }] } }))
  check('slotRules：按槽位名 / mask 名 / imgconf 目标覆盖（第一条命中；cmds 过滤；坏正则 / 坏动作丢弃）：black 的 sprite 保留 raw，black / dan 的 mask / imgconf 丢弃，still* 全丢（含 spriteoff）', J(rules.filter((c) => c.op === 'raw').map((c) => `${c.cmd}:${c.args[0]}`)) === J(['sprite:adv/image/ef/black.jpg', 'anm:tint']) && !rules.some((c) => c.slot === 'still1' || c.slot === 'black1') && !rules.some((c) => c.op === 'overlayOff') && rules.some((c) => c.op === 'stand' && c.slot === 'dan'), J(rules.map((c) => c.op + ':' + (c.slot || c.cmd || ''))))
  const nums = ops(parse('spriteatlas,a/b,body:1,s,9,9,1,1,10,20,0.5,0.6', null, { meta: null, options: { sprites: { enabled: true, numbers: { x: 4, y: 5, scale: 6, fade: 7 } } } }))
  check('numbers：槽位之后第几个参数是 x / y / 缩放 / 淡入（spriteatlas 的槽位是第 3 个参数）', nums[0].parts[0].x === 10 && nums[0].parts[0].y === -20 && nums[0].parts[0].scale === 0.5 && nums[0].fade === 0.6, J(nums[0]))
  check('坏选项一律回到默认（stage 为负 / numbers 越界 / fit 乱写 / frameKeys 不是数组 / maskColor 乱写）', J(ops(run({ sprites: { enabled: true, stage: { width: -1, height: 'x' }, numbers: { x: 99 }, fit: 'zoom', atlas: { frameKeys: 'x', baseKeys: 5 }, maskColor: 'url(x)', offAll: 'all', slotRules: 'x' } }))) === J(on))
  const cond = ops(parse(['select,選項1　甲,選項2　乙', 'if,select_===_1', 'spriteatlas,a/b,body:1,s,0,0,1,0', 'else', 'sprite,c/d.jpg,k,0,0,1,0', 'endif', 'clickwait'].join('\n'), null, { options: { sprites: { enabled: true } } }))
  check('if / else 里的立绘 / 叠加层带 when 条件（和别的指令一样）', J(cond.find((c) => c.op === 'stand').when) === J([{ var: 'select', op: '===', value: '1' }]) && cond.find((c) => c.op === 'overlay').when[0].not === true)
  check('没有 colon 的帧参数（body003 / 003）：frameKeys 里带 {name} 的跳过、{n} 的用整段', J(ops(parse('spriteatlas,a/b,003,s,0,0,1,0', null, { options: { sprites: { enabled: true } } }))[0].parts[0].atlas.frames) === J(['003.png', '003']))
  check('坏指令（没槽位 / 没路径 / 矩形缺数）保留成 raw，不抛', J(ops(parse(['spriteatlas,,body:1,s', 'spriteatlas,a/b,body:1', 'sprite,,s', 'mask,m,0,0,0,0', 'mask,m,x'].join('\n'), null, { options: { sprites: { enabled: true } } })).map((c) => c.op)) === J(['raw', 'raw', 'raw', 'raw', 'raw']))
}

// ================= 引擎状态：stand 槽位 / overlay =================
{
  const run = (...commands) => { const s = initialState(); for (const c of commands) applyCommand(s, c); return s }
  const part = (frame) => ({ atlas: { plist: 'a.plist', frames: [frame] }, x: 0, y: 0, scale: 1 })
  const s1 = run({ op: 'stand', slot: 'a', parts: [part('1')] }, { op: 'stand', slot: 'b', parts: [part('2')] }, { op: 'stand', slot: 'a', parts: [part('3')], fade: 1 })
  check('stand 槽位：同槽位再来一条 = 替换且位置不变（a 仍在 b 前面）；旧的整体立绘（stand）不受影响', J(s1.stands.map((s) => [s.slot, s.parts[0].atlas.frames[0]])) === J([['a', '3'], ['b', '2']]) && s1.stand === null && s1.stands[0].fade === 1)
  check('stand 不带 slot = 旧行为（state.stand），带 slot 的不碰它', J(run({ op: 'stand', parts: [{ src: 'x.png' }] }, { op: 'stand', slot: 'a', parts: [part('1')] }).stand) === J({ parts: [{ src: 'x.png' }] }))
  check('standOff 带 slot = 只去掉这个槽位；不带 = 整体立绘 + 全部槽位', J(run({ op: 'stand', slot: 'a', parts: [] }, { op: 'stand', slot: 'b', parts: [] }, { op: 'standOff', slot: 'a' }).stands.map((s) => s.slot)) === J(['b']) && run({ op: 'stand', parts: [{ src: 'x' }] }, { op: 'stand', slot: 'b', parts: [] }, { op: 'standOff' }).stands.length === 0 && run({ op: 'stand', parts: [{ src: 'x' }] }, { op: 'standOff' }).stand === null)
  const o = run({ op: 'overlay', slot: 'k', src: 'a.jpg', x: 1, scaleX: 1 }, { op: 'overlay', slot: 'm', rect: [0, 0, 5, 5] }, { op: 'overlay', slot: 'k', x: 9, alpha: 0.5 })
  check('overlay：同 slot 再来一条（没带 src）= 合并（x 改了、alpha 新增、src 保留）、位置不变', J(o.overlays) === J([{ slot: 'k', src: 'a.jpg', x: 9, scaleX: 1, alpha: 0.5 }, { slot: 'm', rect: [0, 0, 5, 5] }]), J(o.overlays))
  check('overlay 带新 src = 整条替换（老的 x / alpha 不留）', J(run({ op: 'overlay', slot: 'k', src: 'a.jpg', x: 1, alpha: 0.2 }, { op: 'overlay', slot: 'k', src: 'b.jpg' }).overlays) === J([{ slot: 'k', src: 'b.jpg' }]))
  check('overlayOff：带 slot 去一个、不带清空；没 slot 的 overlay 忽略；overlay 上的 when 不成立不执行', run({ op: 'overlay', slot: 'a', src: 'x' }, { op: 'overlay', slot: 'b', src: 'y' }, { op: 'overlayOff', slot: 'a' }).overlays.length === 1 && run({ op: 'overlay', slot: 'a', src: 'x' }, { op: 'overlayOff' }).overlays.length === 0 && run({ op: 'overlay', src: 'x' }).overlays.length === 0 && run({ op: 'overlay', slot: 'a', src: 'x', when: [{ var: 'v', op: '===', value: '1' }] }).overlays.length === 0)
  const scene = { steps: [{ index: 0, commands: [{ op: 'stand', slot: 'a', parts: [part('1')] }] }, { index: 1, commands: [{ op: 'overlay', slot: 'k', src: 'a.jpg' }] }, { index: 2, commands: [{ op: 'standOff' }, { op: 'overlayOff' }] }] }
  check('stateAt：回看 / 跳转一步到位（第 1 步 1 个槽位、第 2 步再加叠加层、第 3 步清空）', [stateAt(scene, 0), stateAt(scene, 1), stateAt(scene, 2)].map((s) => `${s.stands.length}${s.overlays.length}`).join() === '10,11,00')
  check('initialState 里有 stands / overlays（空数组），旧字段不变', J(initialState().stands) === '[]' && J(initialState().overlays) === '[]' && initialState().stand === null)
}

// ================= 端到端：导入（gal-layout 的 minashigo_r 配置）→ 列表分组 → 场景 =================
{
  const root = path.join(work, 'mr')
  await buildMinashigoRFixture(root)
  const out = await galLayoutScript({ item: { itemId: 'mr', title: 'mr', config: { game: { id: 'minashigo_r' } }, source: { path: root }, adapters: ['uviewer-csv'] }, script: { id: 'gal-layout', version: '2.13.0', options: {} } })
  const cfg = out.itemPatch?.gal?.config
  const sp = cfg?.adapterOptions?.['uviewer-csv']?.sprites
  check('gal-layout（minashigo_r）：sprites 打开，fit contain、baseKeys [{name}.png]、mask / imgconf 保留 raw、黑底图 sprite 保留 raw；其余用全表默认', sp?.enabled === true && sp.fit === 'contain' && J(sp.atlas) === J({ plistExt: '.plist', textureExt: '.png', frameKeys: ['{n}.png', '{name}:{n}.png', '{n}'], baseKeys: ['{name}.png'] }) && sp.commands.mask === 'raw' && sp.commands.imgconf === 'raw' && sp.commands.spriteatlas === 'stand' && J(sp.slotRules) === J([{ cmds: ['sprite'], match: '^(?:black|bg)\\d*$', as: 'raw' }]) && J(sp.stage) === J({ width: 1280, height: 720 }), J(sp))
  check('gal-layout（minashigo_r）：groups = [{ parent: ".", pattern: ^1(\\d{6})\\d{2}$ }]（按脚本编号里的 6 位角色编号分组）；配置能通过引擎校验', J(cfg.groups) === J([{ parent: '.', pattern: '^1(\\d{6})\\d{2}$' }]) && normalizeGalConfig(cfg).groups.length === 1 && normalizeGalConfig(cfg).adapterOptions['uviewer-csv'].sprites.enabled === true)
  check('LAYOUTS.minashigo_r 的分组规则对真实编号：120090312 → 200903、130230301 → 302303、121850102 → 218501；6 位 / 6 开头的编号不匹配', (() => { const re = new RegExp(LAYOUTS.minashigo_r.config.groups[0].pattern); return re.exec('120090312')?.[1] === '200903' && re.exec('130230301')?.[1] === '302303' && re.exec('121850102')?.[1] === '218501' && !re.test('100042') && !re.test('630000001') })())
  const prov = createBrowseProvider({ mediaDir: root, adapters: ['uviewer-csv'], resolveAsset: async () => { throw new Error('none') }, config: cfg })
  const home = (await prov.getNode('')).node
  check('列表：角色 200903 的两个脚本成一张分组卡片（标题 200903），100042 照常列出', home.items.length === 2 && home.items.some((i) => i.title === '200903' && i.type === 'dir') && home.items.some((i) => i.title === '100042' && i.type === 'script'), J(home.items.map((i) => [i.type, i.title])))
  const group = (await prov.getNode(home.items.find((i) => i.title === '200903').node)).node
  check('分组里：120090301 / 120090302', J(group.items.map((i) => i.title)) === J(['120090301', '120090302']), J(group.items.map((i) => i.title)))
  const played = await prov.getNode(group.items[0].node)
  const steps = played.scene.steps
  const cmds = steps.map((s) => s.commands.filter((c) => c.op !== 'speaker' && c.op !== 'text').map((c) => (c.op === 'stand' ? `stand:${c.slot}` : c.op === 'overlay' ? `overlay:${c.slot}` : c.op === 'standOff' || c.op === 'overlayOff' ? `${c.op}:${c.slot || 'all'}` : c.op)))
  check('场景：5 步；立绘 dan → dan2 → （去掉 dan + CG still1）→ （去掉 still1 + 清立绘 + 抖动 + 闪屏）→ 缺图集的立绘；全程没有 raw', J(cmds) === J([['bg', 'stand:dan'], ['stand:dan2'], ['standOff:dan', 'overlay:still1'], ['overlayOff:still1', 'standOff:all', 'shake', 'flash'], ['stand:gone']]) && !played.scene.stats.raw.sprite, J(cmds) + J(played.scene.stats))
  const at = (i) => stateAt(played.scene, i)
  check('状态：第 1 步 dan；第 2 步 dan + dan2；第 3 步 dan2 + CG；第 4 步全清；回看第 2 步还是 dan + dan2', J([at(0), at(1), at(2), at(3), at(1)].map((s) => `${s.stands.map((x) => x.slot).join('+')}|${s.overlays.map((x) => x.slot).join('+')}`)) === J(['dan|', 'dan+dan2|', 'dan2|still1', '|', 'dan+dan2|']), J([0, 1, 2, 3].map((i) => at(i).stands.map((x) => x.slot))))
  const raw5 = buildScene('uviewer-csv', 'msg,0,hi\nspriteatlas,a/b,body:0,s,0,0,1,0\n', null, { options: {} })
  check('buildScene 默认（没开 sprites）：spriteatlas 仍是 raw（deepone / uviewer 通用行为不变）', raw5.steps[0].commands.some((c) => c.op === 'raw' && c.cmd === 'spriteatlas'))
}

await rm(work, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
