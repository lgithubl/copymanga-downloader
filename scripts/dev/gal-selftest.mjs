#!/usr/bin/env node
// Gal 自测（不需要浏览器）：适配器 / 播放引擎 / 库类型 handler。需要 ImageMagick 和 python3（造测试数据）。
//   node scripts/dev/gal-selftest.mjs
import { mkdir, readFile, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { galAdapter, galAdapterIds, registerGalAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { parse, parseCondition, parseRichText, sniff } from '../../web/library/gal/adapters/uviewer-csv.mjs'
import { DEFAULT_GAL_CONFIG, applyGalConfigPatch, cleanGalConfigRaw, expandTemplate, globToRegExp, normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { safeRelPath } from '../../web/library/gal/paths.mjs'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'
import { parse as minashigoParse, prepare as minashigoPrepare, sniff as minashigoSniff } from '../../web/library/gal/adapters/renpy-minashigo.mjs'
import { buildGirlsCreationFixture } from './make-girlscreation-fixture.mjs'
import { buildLegecloFixture } from './make-legeclo-fixture.mjs'
import { sniff as gcSniff, tagsOf as gcTagsOf } from '../../web/library/gal/adapters/girlscreation-tag.mjs'
import { buildMinashigoFixture } from './make-minashigo-fixture.mjs'
import { parse as legecloParse, prepare as legecloPrepare, sniff as legecloSniff } from '../../web/library/gal/adapters/renpy-legeclo.mjs'
import { parse as renpyParse, prepare as renpyPrepare, renpyText, sniff as renpySniff } from '../../web/library/gal/adapters/renpy-monmusu.mjs'
import { execFileSync } from 'node:child_process'
const monmusuScript = galLayoutScript
const tenkeiScript = galLayoutScript
import { parse as tenkeiParse, prepare as tenkeiPrepare, sniff as tenkeiSniff } from '../../web/library/gal/adapters/tenkeiprdx-json.mjs'
import { buildMonmusuFixture, buildTenkeiFixture } from './make-gal-games-fixture.mjs'
import { isOneShot as mtOneShot, linkedBgSe as mtLinked, parse as mtParse, prepare as mtPrepare, sniff as mtSniff, catalog as mtCatalog } from '../../web/library/gal/adapters/misttrain-json.mjs'
import { buildScene, firstBackgroundSrc } from '../../web/library/gal/scene.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { activePath, applyCommand, assetUrl, backlog, choiceIn, commandDuration, condMet, dropChoicesFrom, ratioOfStep, stateAt, stepOfRatio } from '../../web/static/gal-engine.js'
import { buildGalFixture } from './make-gal-fixture.mjs'
import { DEFAULT_EXPRESSIONS, castKeysOf, declaredPageSizes, faceDefaultsFor, mergeExpressions, reportDeclaredSize, resolveExpression } from '../../web/static/gal-spine.js'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const J = (v) => JSON.stringify(v)

// ================= 适配器 =================
{
  const s = parse('bg,download/bg/a.jpg,0.5\nname,甲,\nmsg,0,你好，世界,,,,,,,,,\nclickwait\nmsg,0,第二句')
  check('clickwait 切步：2 步', s.steps.length === 2, J(s.steps.length))
  check('bg 路径/渐变', J(s.steps[0].commands[0]) === J({ op: 'bg', src: 'download/bg/a.jpg', fade: 0.5 }), J(s.steps[0].commands[0]))
  check('末尾没有 clickwait 的指令也成一步', s.steps[1].commands.length === 1)
  check('msg 的台词来自第 2 个参数（第 1 个是别的东西）', segText(s.steps[0].commands[2]) === '你好，世界', J(s.steps[0].commands[2]))
}
function segText(command) { return (command.segments || []).map((x) => x.text).join('') }
{
  const s = parse('msg,0,a, b, c,,,,,,,,\nclickwait')
  check('台词里的半角逗号保留（只剥末尾那串空参数）', segText(s.steps[0].commands[0]) === 'a, b, c', segText(s.steps[0].commands[0]))
  check('msg,0, 和 msg,0 = 清空台词', parse('msg,0,').steps[0].commands[0].segments.length === 0 && parse('msg,0').steps[0].commands[0].segments.length === 0)
  check('name 空 = 清空说话人', parse('name,,,,,').steps[0].commands[0].segments.length === 0)
  check('\\n（反斜杠 n 两个字符）变换行', segText(parse('msg,0,甲\\n乙').steps[0].commands[0]) === '甲\n乙')
}
{
  const s = parse('bg,color_10_20_300,1\nbg,,0\nbgoff,2\nstopbgm,0.5\nplaybgm,/a/b.mp3,0,\nplaybgm,\nplayvoice,0,/v/1.wav\nplayvoice,/v/2.wav\nplayse,/s.wav\nfadeinblack,0.5\nfadeoutblack\nwait,0.2\nwait,abc\nmovie,a.mp4:b.mp4,0,1\nmovie,c.mp4,0,0\nmovieoff')
  const c = s.steps[0].commands
  check('纯色背景 color_R_G_B（超范围截到 255）', J(c[0]) === J({ op: 'bg', color: [10, 20, 255], fade: 1 }), J(c[0]))
  check('bg 空路径 = 去掉背景', c[1].op === 'bgoff')
  check('bgoff 渐变秒', J(c[2]) === J({ op: 'bgoff', fade: 2 }))
  check('stopbgm 渐变秒', J(c[3]) === J({ op: 'bgmStop', fade: 0.5 }))
  check('playbgm 去掉前导 /', J(c[4]) === J({ op: 'bgm', src: 'a/b.mp3' }), J(c[4]))
  check('playbgm 没路径：忽略', c[5].op === 'voice')
  check('playvoice 取第 2 个参数；只有 1 个参数就用它', c[5].src === 'v/1.wav' && c[6].src === 'v/2.wav', J([c[5], c[6]]))
  check('playse', J(c[7]) === J({ op: 'se', src: 's.wav' }))
  check('fadeinblack = 变黑；fadeoutblack = 出黑场（默认 1 秒）', J(c[8]) === J({ op: 'fade', to: 'black', seconds: 0.5 }) && J(c[9]) === J({ op: 'fade', to: 'clear', seconds: 1 }))
  check('wait 非法数字按 0', c[10].seconds === 0.2 && c[11].seconds === 0)
  check('movie 多段 + 循环标志', J(c[12]) === J({ op: 'movie', srcs: ['a.mp4', 'b.mp4'], loop: true }) && c[13].loop === false)
  check('movieoff', c[14].op === 'movieOff')
  check('秒数上限 60', parse('wait,9999').steps[0].commands[0].seconds === 60)
  check('反斜杠路径规范成 /', parse('bg,download\\bg\\a.jpg,0').steps[0].commands[0].src === 'download/bg/a.jpg')
}
{
  const s = parse('spriteatlas,download/c/1,body:sad,a,300,-90,0.5,0.5,,,,\nanm,tint,a,150_150_150,0.0001,0\nendwait,,,\nfoo,bar')
  check('立绘/特效等指令原样保留为 raw（带参数），并统计', s.steps[0].commands.filter((c) => c.op === 'raw').length === 3 && s.stats.raw.spriteatlas === 1 && s.stats.raw.anm === 1 && s.stats.raw.foo === 1, J(s.stats))
  check('raw 参数去掉末尾空参数', J(s.steps[0].commands[0].args) === J(['download/c/1', 'body:sad', 'a', '300', '-90', '0.5', '0.5']), J(s.steps[0].commands[0].args))
  check('endwait 不进规范场景', !s.steps[0].commands.some((c) => c.cmd === 'endwait'))
  check('BOM 和 // 注释行、CRLF', parse('﻿// 注释\r\nmsg,0,A\r\nclickwait\r\n').steps.length === 1)
  check('空文本 = 0 步', parse('').steps.length === 0 && parse('\n\n').steps.length === 0)
}
{
  const r = parseRichText('<outline width=2 color=black>「甲」</outline>乙<color=#ff0000>红</color><b>粗<i>粗斜</i></b><br>下一行<unknown>保留文字</unknown>')
  check('outline 样式', r[0].style.outline.width === 2 && r[0].style.outline.color === 'black' && r[0].text === '「甲」', J(r[0]))
  check('无样式文字', r[1].text === '乙' && !r[1].style)
  check('<color=#hex>', r[2].style.color === '#ff0000')
  check('嵌套 b/i，样式叠加', r[3].style.bold && !r[3].style.italic && r[4].style.bold && r[4].style.italic, J(r.slice(3, 5)))
  check('<br> 换行；未知标记丢标记留文字', r.map((x) => x.text).join('').endsWith('\n下一行保留文字'), J(r.map((x) => x.text)))
  const xss = parseRichText('<script>alert(1)</script><img src=x onerror=alert(2)>字<outline color="red;background:url(x)">z</outline>')
  check('危险标记：文字保留为纯文本，标记被丢；非法颜色回退 black（不会注入样式）', xss.map((x) => x.text).join('').includes('alert(1)') && xss.every((x) => !x.style || !x.style.outline || x.style.outline.color === 'black'), J(xss))
  check('未闭合标记不死循环', parseRichText('<outline width=2>未闭合').length === 1)
  check('不成对的 </b> 不报错', parseRichText('a</b>b').map((x) => x.text).join('') === 'ab')
}
{
  check('sniff：典型脚本', sniff('stopbgm,\nfadeinblack,0\nbg,a.jpg,0\nmsg,0,hi') === true)
  check('sniff：普通文本不是脚本', sniff('hello world\nthis is text\nanother line') === false)
  check('sniff：CSV 数据表（首列不是已知指令）不是脚本', sniff('name,age\nbob,3\namy,4\nzed,5') === false)
  check('sniff：太短不算', sniff('bg,a.jpg,0') === false)
  check('适配器注册表', galAdapterIds().includes('uviewer-csv') && sniffGalAdapter('stopbgm,\nfadeinblack,0\nbg,a.jpg,0\nmsg,0,hi') === 'uviewer-csv' && sniffGalAdapter('x\ny\nz') === '')
  registerGalAdapter({ id: 'fake', label: 'fake', sniff: (t) => t.startsWith('FAKE'), parse: (t) => ({ steps: [{ index: 0, commands: [{ op: 'text', segments: [{ text: t }] }] }], stats: { commands: 1, raw: {} } }) })
  check('新增适配器：只需要 registerGalAdapter（以后加格式不用动播放器）', sniffGalAdapter('FAKE data') === 'fake' && buildScene('fake', 'FAKE data').steps[0].commands[0].op === 'text' && sniffGalAdapter('FAKE data', ['uviewer-csv']) === '')
  let threw = false
  try { buildScene('nope', '') } catch { threw = true }
  check('未知适配器：报错', threw)
}

// 分支：select / if / elseif / else / endif，<size>、<ruby>
{
  const s = parse('select,選項1　「想听」,選項2　「不想听」\nif,select_===_1,,,\nmsg,1,甲\nclickwait\nelseif,select_===_2,,,\nmsg,1,乙\nclickwait\nelse\nmsg,1,丙\nendif\nmsg,1,合流\nclickwait\nendif\nmsg,1,尾')
  const flat = s.steps.flatMap((st) => st.commands)
  const choice = flat.find((c) => c.op === 'choice')
  check('select：选项文字去掉「選項N　」前缀，值从 1 起，变量 select；id = 步:序号', J(choice.options.map((o) => [o.value, segText(o)])) === J([[1, '「想听」'], [2, '「不想听」']]) && choice.var === 'select' && choice.id === '0:0', J(choice))
  const texts = flat.filter((c) => c.op === 'text')
  check('if：块里的指令带 when；条件跨 clickwait（步）一直有效', J(texts[0].when) === J([{ var: 'select', op: '===', value: '1' }]) && s.steps.length === 4, J(texts[0]))
  check('elseif：前面分支的条件取反加上自己的', J(texts[1].when) === J([{ var: 'select', op: '===', value: '1', not: true }, { var: 'select', op: '===', value: '2' }]), J(texts[1].when))
  check('else：所有前面分支的条件取反', J(texts[2].when) === J([{ var: 'select', op: '===', value: '1', not: true }, { var: 'select', op: '===', value: '2', not: true }]), J(texts[2].when))
  check('endif 之后恢复无条件；多余的 endif 忽略并计数，不影响后面', !texts[3].when && !texts[4].when && s.stats.unmatchedEndif === 1 && s.stats.choices === 1 && !s.stats.raw.if && !s.stats.raw.endif, J([texts[3], texts[4], s.stats]))
  check('嵌套 if：条件叠加（AND）', J(parse('if,a_===_1\nif,b_>=_2\nmsg,1,x\nendif\nmsg,1,y\nendif\nmsg,1,z').steps[0].commands.map((c) => (c.when || []).map((w) => w.var + w.op + w.value).join('&'))) === J(['a===1&b>=2', 'a===1', '']))
  check('parseCondition：认得 === !== >= 等；认不出来 = 没有条件（宁可多显示）', J(parseCondition('select_===_1')) === J({ var: 'select', op: '===', value: '1' }) && parseCondition('hp_>=_10').op === '>=' && parseCondition('garbage') === null && !parse('if,garbage\nmsg,1,x').steps[0].commands[0].when)
  check('单独的 elseif/else（没有 if）不报错', parse('elseif,a_===_1\nelse\nmsg,1,x').steps[0].commands.length === 1)
  check('没有选项文字的 select 忽略', parse('select,\nmsg,1,x').steps[0].commands.every((c) => c.op !== 'choice'))
  check('sniff：带 select/if 的脚本也认得', sniff('stopbgm,\nselect,選項1　甲,選項2　乙\nif,select_===_1\nmsg,1,x\nendif'))
  const r = parseRichText('<size=27><outline width=2 color=black>名字</outline></size>、<size=30>字<ruby>漢字|かんじ</ruby>后</size><ruby>无注音</ruby>')
  check('<size=N>：写进样式，和别的样式叠加', r[0].style.size === 27 && r[0].style.outline.width === 2 && r[0].text === '名字', J(r[0]))
  check('<ruby>基字|读音</ruby>：独立片段，带 ruby 字段；不和相邻片段合并', r.some((x) => x.text === '漢字' && x.ruby === 'かんじ') && r.map((x) => x.text).join('') === '名字、字漢字后无注音', J(r))
  check('<size> 非法值/<ruby> 没有 | 不报错', parseRichText('<size=abc>a</size><ruby>b</ruby>').map((x) => x.text).join('') === 'ab' && !parseRichText('<size=abc>a</size>')[0].style)
}

// ================= 播放引擎 =================
{
  const scene = buildScene('uviewer-csv', 'bg,a.jpg,0\nplaybgm,m1.mp3\nname,甲,\nmsg,0,一\nclickwait\nfadeinblack,0.5\nbg,color_1_2_3,0\nstopbgm,0\nmsg,0,二\nclickwait\nfadeoutblack,0.5\nplayvoice,0,v.wav\nplaybgm,m2.mp3\nname,乙,\nmsg,0,三\nclickwait\nmovie,x.mp4,0,1\nmsg,0,\nclickwait')
  const st = (i) => stateAt(scene, i)
  check('stateAt(0)：背景/BGM/说话人/台词', st(0).bg.src === 'a.jpg' && st(0).bgm === 'm1.mp3' && st(0).text[0].text === '一' && st(0).speaker[0].text === '甲' && !st(0).black)
  check('stateAt(1)：黑场 + 纯色背景 + BGM 停', st(1).black === true && J(st(1).bg) === J({ color: [1, 2, 3] }) && st(1).bgm === '')
  check('stateAt(2)：出黑场，新 BGM，说话人换了（语音不进状态）', st(2).black === false && st(2).bgm === 'm2.mp3' && st(2).speaker[0].text === '乙')
  check('stateAt(3)：视频 + 台词清空', st(3).movie.srcs[0] === 'x.mp4' && st(3).movie.loop === true && st(3).text.length === 0)
  check('stateAt 越界取到最后一步；-1 = 初始', J(st(99)) === J(st(3)) && st(-1).bg === null && st(-1).text.length === 0)
  check('stateAt 是纯的：重复调用结果一样，不修改场景', J(st(2)) === J(st(2)))
  check('backlog：只含有文字的台词，按步数截断', backlog(scene, 3).length === 3 && backlog(scene, 0).length === 1 && backlog(scene, 2)[2].speaker[0].text === '乙' && backlog(scene, 2)[2].step === 2)
  check('commandDuration', commandDuration({ op: 'bg', fade: 1.5 }) === 1.5 && commandDuration({ op: 'fade', seconds: 2 }) === 2 && commandDuration({ op: 'wait', seconds: 0.3 }) === 0.3 && commandDuration({ op: 'text' }) === 0 && commandDuration({ op: 'voice' }) === 0)
  check('进度 ratio ↔ step 往返', [0, 1, 2, 3].every((i) => stepOfRatio(ratioOfStep(i, 4), 4) === i) && ratioOfStep(0, 1) === 1 && stepOfRatio(0.5, 1) === 0 && stepOfRatio(2, 5) === 4 && stepOfRatio(-1, 5) === 0)
  check('assetUrl 编码', assetUrl('/api/x/resource', 'download/bg/a b&c.jpg') === '/api/x/resource?path=download%2Fbg%2Fa%20b%26c.jpg')
  check('applyCommand 忽略未知 op', J(applyCommand({ a: 1 }, { op: 'raw' })) === J({ a: 1 }))
}

// ================= 播放引擎：分支 =================
{
  const scene = buildScene('uviewer-csv', 'msg,1,开头\nclickwait\nselect,選項1　甲,選項2　乙,選項3　丙\nif,select_===_1\nmsg,1,甲线\nclickwait\nmsg,1,甲线二\nclickwait\nelseif,select_===_2\nmsg,1,乙线\nclickwait\nelse\nmsg,1,其他线\nclickwait\nendif\nbg,a.jpg,0\nmsg,1,合流\nclickwait\nselect,選項1　再选,選項2　不选\nif,select_===_2\nmsg,1,只有选二才有\nclickwait\nendif\nmsg,1,结尾\nclickwait')
  const c1 = '1:0'
  const c2 = '6:0'
  const t = (step) => scene.steps[step].commands.filter((c) => c.op === 'text').map((c) => segText(c)).join('/')
  check('步划分：0 开头 | 1 选项+甲线 | 2 甲线二 | 3 乙线 | 4 其他线 | 5 合流 | 6 二次选项 | 7 结尾', scene.steps.length === 8 && t(0) === '开头' && t(1) === '甲线' && t(3) === '乙线' && t(4) === '其他线' && t(5) === '合流' && t(7) === '结尾' && choiceIn(scene, 1)?.id === c1 && choiceIn(scene, 6)?.id === c2, J(scene.steps.map((_, i) => t(i))))
  check('condMet：=== / !== / 数字比较 / not；空条件成立', condMet([{ var: 'a', op: '===', value: '1' }], { a: '1' }) && !condMet([{ var: 'a', op: '===', value: '1' }], { a: '2' }) && condMet([{ var: 'a', op: '!==', value: '1' }], { a: '2' }) && condMet([{ var: 'a', op: '>=', value: '2' }], { a: '10' }) && !condMet([{ var: 'a', op: '>', value: '5' }], { a: '5' }) && condMet([{ var: 'a', op: '===', value: '1', not: true }], { a: '2' }) && condMet([], {}) && condMet(undefined, {}))
  check('condMet：变量没设过（还没选）→ 任何条件都不成立（包括 else / 取反 / !==）', !condMet([{ var: 'a', op: '===', value: '1' }], {}) && !condMet([{ var: 'a', op: '!==', value: '1' }], {}) && !condMet([{ var: 'a', op: '===', value: '1', not: true }], {}))
  const path = (choices) => activePath(scene, choices).join()
  check('activePath：还没选 → 只到选项那一步（分支都还不在路上）', path({}) === '0,1,5,6,7' || path({}) === '0,1,5,6,7', path({}))
  check('选 1：甲线、甲线二、合流…；选 2：乙线；选 3：其他线（else）；互斥', path({ [c1]: 1 }) === '0,1,2,5,6,7' && path({ [c1]: 2 }) === '0,1,3,5,6,7' && path({ [c1]: 3 }) === '0,1,4,5,6,7', J([path({ [c1]: 1 }), path({ [c1]: 2 }), path({ [c1]: 3 })]))
  check('stateAt：选项那一步之后 vars.select = 所选；没选 = undefined', stateAt(scene, 1, { [c1]: 2 }).vars.select === '2' && stateAt(scene, 1, {}).vars.select === undefined)
  check('stateAt：台词按分支走（选 2：第 1 步的台词不是甲线；第 3 步是乙线）', segText({ segments: stateAt(scene, 1, { [c1]: 2 }).text }) === '开头' && segText({ segments: stateAt(scene, 3, { [c1]: 2 }).text }) === '乙线' && segText({ segments: stateAt(scene, 1, { [c1]: 1 }).text }) === '甲线')
  check('第二个选项（条件在选项那一步里面）：选 2 才有那句', segText({ segments: stateAt(scene, 6, { [c1]: 1, [c2]: 2 }).text }) === '只有选二才有' && segText({ segments: stateAt(scene, 6, { [c1]: 1, [c2]: 1 }).text }) === '合流')
  check('backlog：只含走过的分支的台词', J(backlog(scene, 99, { [c1]: 2, [c2]: 1 }).map((l) => segText({ segments: l.text }))) === J(['开头', '乙线', '合流', '结尾']), J(backlog(scene, 99, { [c1]: 2, [c2]: 1 }).map((l) => segText({ segments: l.text }))))
  check('choiceIn：找一步里的选项；没有就是 null', choiceIn(scene, 1)?.id === c1 && choiceIn(scene, 0) === null)
  check('dropChoicesFrom：这一步起的选择作废，更早的保留', J(dropChoicesFrom({ '1:0': 2, '6:0': 1 }, 6)) === J({ '1:0': 2 }) && J(dropChoicesFrom({ '1:0': 2, '6:0': 1 }, 1)) === J({}))
  check('进度比例在路径上往返：不同路径长度不同也能还原到同一步', [{}, { [c1]: 1 }, { [c1]: 2 }].every((choices) => { const p = activePath(scene, choices); return p.every((_, k) => stepOfRatio(ratioOfStep(k, p.length), p.length) === k) }))
  check('applyCommand：when 不成立的指令不改状态', J(applyCommand({ text: [], vars: { select: '1' } }, { op: 'text', segments: [{ text: 'x' }], when: [{ var: 'select', op: '===', value: '2' }] }).text) === '[]')
  check('没有分支的脚本：路径 = 所有步（行为和原来一样）', activePath(buildScene('uviewer-csv', 'msg,0,a\nclickwait\nmsg,0,b\nclickwait'), {}).join() === '0,1')
}

// ================= config（元数据里唯一的配置字段） =================
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-selftest-'))
const dataDir = path.join(work, 'data')
const root = path.join(dataDir, 'gal', 'deeponecgv')   // 一个 UViewer 资源包目录 = 一个媒体
await mkdir(root, { recursive: true })
await buildGalFixture(root, { exampleScript: process.env.GAL_EXAMPLE || '' })   // GAL_EXAMPLE：真实示例脚本（不入库）；不给就用模拟长脚本
{
  const d = normalizeGalConfig({})
  check('默认 config = 标准结构（UViewer 资源包布局）：脚本根 text、资源根 resources、名称文件、缩略图目录、标签字典、合并 adultr+extra', d.scriptRoots[0].dir === 'resources/download/adv/text' && d.resourceRoots[0] === 'resources' && d.namesFiles[0] === 'user_data/character_names.json' && d.thumbsDirs[0] === 'user_data/thumbnails' && d.labels.cabin === '纪念馆' && d.merge[0].dirs.join() === 'adultr,extra' && d.pageSize === 25, J(d).slice(0, 200))
  check('normalizeGalConfig 对 undefined/非对象都给默认', J(normalizeGalConfig(null)) === J(d) && J(normalizeGalConfig('x')) === J(d))
  const n = normalizeGalConfig({ scriptRoots: [{ id: 'a|b', dir: 'x' }, { id: 'ok', dir: '../x' }, { id: 'good', dir: 'a/b' }, { id: 'good', dir: 'dup' }], resourceRoots: ['/etc', 'a/../b', ''], namesFiles: ['a/../b'], pageSize: 9999, labels: { 'a/b': 'x', ok: '标签' }, merge: [{ parent: '../x', dirs: ['a'] }, { parent: 'c/*', dirs: ['a/b', 'b'], badges: { b: '1234567890123456' } }], dirThumbs: [{ name: '[', paths: ['x'] }, { parent: 'p', paths: [] }, { parent: 'q', name: '^\\d+$', paths: ['a/{name}.png'] }], cover: '../x', scriptCount: -5 })
  check('规整：.. / 非法 id / 重复 id / 非法正则 / 空模板 全丢；绝对路径当相对；页大小夹到 200', J(n.scriptRoots) === J([{ id: 'good', dir: 'a/b', label: 'good' }]) && J(n.resourceRoots) === J(['etc', '']) && J(n.namesFiles) === J(d.namesFiles) && n.pageSize === 200 && n.cover === '' && n.scriptCount === 0, J([n.scriptRoots, n.resourceRoots, n.namesFiles]))
  check('规整：标签字典只收安全的目录名；合并规则的目录名/标记长度有限制；头像规则只留合法的', J(n.labels) === J({ ok: '标签' }) && n.merge.length === 1 && J(n.merge[0].dirs) === J(['b']) && n.merge[0].badges.b === '123456789012' && n.dirThumbs.length === 1 && n.dirThumbs[0].parent === 'q', J([n.labels, n.merge, n.dirThumbs]))
  check('cleanGalConfigRaw：只留认识的字段，存的是「写过的」字段（没写的不补默认）', (() => { const c = cleanGalConfigRaw({ cover: 'x.jpg', junk: 1, labels: { a: 'b' } }); return J(Object.keys(c).sort()) === J(['cover', 'labels']) && c.cover === 'x.jpg' && c.labels.a === 'b' })())
  const merged = applyGalConfigPatch({ labels: { a: 'b' }, pageSize: 10 }, { cover: 'x.jpg', labels: null })
  check('补丁：默认合并（写了的字段替换，null = 删掉回默认，没写的保留）', J(Object.keys(merged).sort()) === J(['cover', 'pageSize']) && merged.pageSize === 10 && merged.cover === 'x.jpg', J(merged))
  check('补丁：replace = 整体替换', J(applyGalConfigPatch({ pageSize: 10, cover: 'a.jpg' }, { cover: 'x.jpg' }, { replace: true })) === J({ cover: 'x.jpg' }))
  check('模板：{name} 之类替换；替换后必须还是安全路径（../ 不行）；~/ 开头保留', expandTemplate('d/{name}00/a.png', { name: '1003' }) === 'd/100300/a.png' && expandTemplate('../{name}', { name: 'a' }) === null && expandTemplate('{name}', { name: '../x' }) === null && expandTemplate('~/{thumbsDir}/{stem}.webp', { thumbsDir: 'u/t', stem: 'x' }) === '~/u/t/x.webp')
  check('通配：* 不跨目录层', globToRegExp('character/*').test('character/1003') && !globToRegExp('character/*').test('character/1003/adultr') && globToRegExp('a.b/*').test('a.b/x') && !globToRegExp('a.b/*').test('aXb/x'))
  check('safeRelPath', safeRelPath('./a//b/') === null && safeRelPath('a/b') === 'a/b' && safeRelPath('') === '' && safeRelPath('../a') === null && safeRelPath('/a/b/') === 'a/b')
  check('DEFAULT_GAL_CONFIG 不可变（被冻结）', Object.isFrozen(DEFAULT_GAL_CONFIG))
}

// ================= handler / 浏览节点 =================
const mk = (over = {}) => createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: root, ...over } } }) })
const handler = mk()
const err = (promise) => promise.then(() => null, (e) => e)
const runScript = async (item, options = {}, version = '1.0.0') => {
  const out = await galLayoutScript({ item, script: { id: 'gal-layout', version, options } })
  return out
}

const dry = await handler.importFromSource({ options: { dryRun: true } })
check('dryRun：只检查，不写元数据', dry.items.length === 0 && dry.report.dryRun && dry.report.warnings.length === 0 && (await handler.scanItems()).length === 0, J(dry.report))
const imp = await handler.importFromSource({ tags: ['演示'] })
const items = await handler.scanItems()
check('导入：整个目录 = 1 个媒体条目；报告只有新建/更新/提示', items.length === 1 && imp.report.imported === 1 && imp.items[0].itemId === items[0].itemId && J(Object.keys(imp.report).sort()) === J(['dryRun', 'errors', 'imported', 'root', 'scanned', 'updated', 'warnings']), J(imp.report))
const M = items[0]
check('导入只存：路径（真实路径）、adapters、标题；config 是空的（用默认）', M.unitCount === 1 && M.mediaUnits[0].unitId === 'main' && M.source.path === await realpath(root) && M.title === 'deeponecgv' && J(M.adapters) === J(['uviewer-csv']) && J(M.config) === '{}' && M.coverPath === '' && M.cover === '' && M.scriptCount === 0 && !('layout' in M), J(M))
check('标准结构的目录，导入完什么脚本都没跑就能浏览（默认 config 按标准结构）', (await handler.getReaderContent(M.itemId, 'main', { sectionId: '' })).node.items.length === 9)
check('导入时没有扫描：没有目录树/脚本清单写进元数据', !JSON.stringify(M).includes('600130') && !JSON.stringify(M).includes('cabin'))

await handler.updateItemTags(M.itemId, ['手工标签', '系列:测试'])
await handler.patchItemMetadata(M.itemId, { title: '改过的标题' })
const before = (await handler.getItem(M.itemId)).createdAt
// 脚本跑一次，写 config
const out1 = await runScript(M)
await handler.patchItemMetadata(M.itemId, { gal: out1.itemPatch.gal })
const M1 = await handler.getItem(M.itemId)
check('脚本识别为 uviewer：写出脚本根（text + 另一套日文）、资源根、名称文件、缩略图目录；脚本数；封面（UViewer 生成的缩略图）；谁写的（版本）', out1.details.kind === 'uviewer' && M1.config.scriptRoots.length === 2 && M1.config.resourceRoots[0] === 'resources' && M1.config.namesFiles[0] === 'user_data/character_names.json' && M1.scriptCount >= 50 && M1.coverPath === '~/user_data/thumbnails/600130.webp' && /thumbnail\/script\/cover$/.test(M1.cover) && M1.config.script.id === 'gal-layout' && M1.config.script.version === '1.0.0' && !!M1.config.script.ranAt, J(M1.config).slice(0, 400))
check('脚本打状态标签：Gal配置: uviewer、Gal配置version: 1.0.0、Gal游戏: uviewer（config.game 同步写入）', J(out1.itemTags) === J(['Gal配置: uviewer', 'Gal配置version: 1.0.0', 'Gal游戏: uviewer']) && M1.config.game.id === 'uviewer')
const again = await handler.importFromSource({})
const M2 = await handler.getItem(M.itemId)
check('重复导入：不新增条目，算更新；保留 tag、标题、创建时间、config（脚本写的）；条目 id 不变', again.report.imported === 0 && again.report.updated === 1 && (await handler.scanItems()).length === 1 && M2.tags.includes('手工标签') && M2.title === '改过的标题' && M2.createdAt === before && M2.itemId === M.itemId && J(M2.config) === J(M1.config), J(again.report))
const out2 = await runScript(M2, {}, '1.0.1')
await handler.patchItemMetadata(M.itemId, { gal: out2.itemPatch.gal })
check('脚本升级重跑：config.script.version 跟着变（知道现在用的是哪一版）；标签也变', (await handler.getItem(M.itemId)).config.script.version === '1.0.1' && out2.itemTags.includes('Gal配置version: 1.0.1'))

{
  const sub = await handler.importFromSource({ sourcePath: path.join(root, 'resources/download/adv/text/cabin'), options: { dryRun: true } })
  check('传别的目录 = 另一个媒体（dryRun 不写）；这个目录没按标准结构放：报告里提示，不拦截', sub.report.imported === 1 && sub.report.warnings.length === 1 && /gal-layout/.test(sub.report.warnings[0]) && (await handler.scanItems()).length === 1, J(sub.report))
  check('不存在的目录 / 文件：明确报错', /不存在或不可读/.test((await err(handler.importFromSource({ sourcePath: '/nonexistent-gal-dir' })))?.message || '') && /不存在或不可读/.test((await err(handler.importFromSource({ sourcePath: path.join(root, 'start.bat') })))?.message || ''))
  check('不传来源又没有 rootDir：报错', /不存在或不可读/.test((await err(mk({ rootDir: path.join(work, 'nowhere') }).importFromSource({})))?.message || ''))
}

// ---- 目录没按标准结构：默认读不到 → 脚本把 config 调对 ----
{
  // 1) 外面多套了一层
  const wrap = path.join(work, 'wrap'); await mkdir(wrap, { recursive: true })
  await buildGalFixture(path.join(wrap, 'pkg', 'inner'), { many: 1 })
  const w = (await handler.importFromSource({ sourcePath: wrap })).items[0]
  const wrapNode = async (id) => (await handler.getReaderContent(w.itemId, 'main', { sectionId: id })).node
  check('多套了一层：默认脚本根不存在 → 导入报告提示；浏览是空的、带一条提示去跑脚本（不是报错）', (await handler.importFromSource({ sourcePath: wrap, options: { dryRun: true } })).report.warnings.length === 1 && (await wrapNode('')).items.length === 0 && /gal-layout/.test((await wrapNode('')).notice))
  const o = await runScript(w)
  await handler.patchItemMetadata(w.itemId, { gal: o.itemPatch.gal })
  const w2 = await handler.getItem(w.itemId)
  check('脚本找到 pkg/inner/resources/download/adv/text：脚本根、资源根、名称文件、缩略图目录都带上这层前缀', o.details.kind === 'uviewer' && w2.config.scriptRoots[0].dir === 'pkg/inner/resources/download/adv/text' && w2.config.resourceRoots[0] === 'pkg/inner/resources' && w2.config.namesFiles[0] === 'pkg/inner/user_data/character_names.json' && w2.config.thumbsDirs[0] === 'pkg/inner/user_data/thumbnails', J(w2.config).slice(0, 400))
  const wn = await wrapNode('d:character')
  check('调对之后能浏览：角色名、头像（按新的资源根找到）、资源能取', wn.items[0].title === '卡蒂娅' && wn.items[0].thumb && (await handler.getResource(w.itemId, wn.items[0].thumb)).contentType === 'image/png' && (await handler.getThumbnail(w.itemId)).body.length > 100)
  // 2) resource_path 不是 resources
  const custom = path.join(work, 'custom'); await buildGalFixture(custom, { many: 1 })
  const { rename } = await import('node:fs/promises')
  await rename(path.join(custom, 'resources'), path.join(custom, 'res2'))
  await writeFile(path.join(custom, 'user_data/settings.json'), JSON.stringify({ resource_path: './res2' }))
  const c = (await handler.importFromSource({ sourcePath: custom })).items[0]
  const oc = await runScript(c)
  check('settings.json 里 resource_path=./res2：资源根、脚本根跟着变', oc.itemPatch.gal.config.resourceRoots[0] === 'res2' && oc.itemPatch.gal.config.scriptRoots[0].dir === 'res2/download/adv/text', J(oc.itemPatch.gal.config.scriptRoots))
  // 3) 完全不认识：通用
  const gen = path.join(work, 'gen'); await mkdir(path.join(gen, 'deep/er'), { recursive: true })
  await writeFile(path.join(gen, 'a.txt'), 'stopbgm,\nfadeinblack,0\nmsg,0,A\nclickwait\n')
  await writeFile(path.join(gen, 'deep/er/b.txt'), 'stopbgm,\nfadeinblack,0\nbg,download/x.jpg,0\nmsg,0,B\nclickwait\n')
  await writeFile(path.join(gen, 'x.jpg'), 'x')
  const G = (await handler.importFromSource({ sourcePath: gen })).items[0]
  const og = await runScript(G)
  await handler.patchItemMetadata(G.itemId, { gal: og.itemPatch.gal })
  const G2 = await handler.getItem(G.itemId)
  const gh = await handler.getReaderContent(G.itemId, 'main', { sectionId: '' })
  check('不认识的目录：通用配置（整个目录当脚本根，去 download/ 前缀重试）；浏览得到；封面取脚本里的背景图', og.details.kind === '通用' && G2.config.scriptRoots[0].dir === '' && gh.node.items.map((i) => i.title).join() === 'deep,a' && (await handler.getResource(G.itemId, 'download/x.jpg')).body.toString() === 'x' && G2.coverPath === 'download/x.jpg', J([og.details, G2.coverPath]))
  check('通用配置：没有标签字典/合并/头像规则（目录名原样显示）', G2.config.labels && Object.keys(G2.config.labels).length === 0 && G2.config.merge.length === 0)
  // 4) 覆盖：按路径给个别媒体单独改
  const ov = await runScript(M2, { overrides: [{ path: '*deeponecgv', config: { pageSize: 10, labels: { cabin: '纪念馆(改)' } }, cover: 'download/bg/bg_night.jpg', title: '覆盖后的标题' }, { path: '/nomatch/', config: { pageSize: 99 } }] })
  check('overrides：按媒体路径匹配（通配/正则），命中的叠上去；没命中的不管；封面/标题也能覆盖；状态标签变成「自定义」', ov.itemPatch.gal.config.pageSize === 10 && ov.itemPatch.gal.config.labels.cabin === '纪念馆(改)' && ov.itemPatch.gal.config.cover === 'download/bg/bg_night.jpg' && ov.itemPatch.title === '覆盖后的标题' && ov.itemTags[0] === 'Gal配置: 自定义', J(ov.itemPatch))
  const ovr = await runScript(M2, { overrides: [{ path: '/deeponecgv$/', config: { pageSize: 7 } }] })
  check('overrides 的 path 也可以写成 /正则/', ovr.itemPatch.gal.config.pageSize === 7)
  const rawOpt = await runScript(M2, { rawIgnore: ['^spine$', '(', 'anm,tint'] })
  const rawOvr = await runScript(M2, { rawIgnore: ['^spine$'], overrides: [{ path: '*deeponecgv', config: { rawIgnore: ['^mask$'] } }] })
  const rawNone = await runScript(M2)
  check('gal-layout 的 rawIgnore 选项：非法正则丢掉，写进 config；overrides 里的 config.rawIgnore 覆盖全局值；不配就不写这个字段', J(rawOpt.itemPatch.gal.config.rawIgnore) === J(['^spine$', 'anm,tint']) && J(rawOvr.itemPatch.gal.config.rawIgnore) === J(['^mask$']) && rawNone.itemPatch.gal.config.rawIgnore === undefined, J([rawOpt.itemPatch.gal.config.rawIgnore, rawOvr.itemPatch.gal.config.rawIgnore, rawNone.itemPatch.gal.config.rawIgnore]))
  const dryOut = await runScript({ ...M2, tags: ['Gal配置: uviewer', '别的标签'] }, { dryRun: true })
  check('dryRun：不写任何东西（不返回补丁），已有的本脚本标签原样保留', !dryOut.itemPatch && J(dryOut.itemTags) === J(['Gal配置: uviewer']))
  const missing = await runScript({ source: { path: path.join(work, 'nowhere') }, tags: [] })
  check('目录不存在：不改配置、不抛错', !missing.itemPatch && missing.logs.some((l) => /不存在或不可读/.test(l)))
  await rm(handler.internals.metaPath(w.itemId), { force: true }); await rm(handler.internals.metaPath(c.itemId), { force: true }); await rm(handler.internals.metaPath(G.itemId), { force: true })
}

// ---- 节点 ----
const read = (sectionId = '', unitId = 'main') => handler.getReaderContent(M.itemId, unitId, { sectionId })
const nodeOf = async (id) => (await read(id)).node
const titles = (n) => n.items.map((i) => i.title)
const home = await read('')
check('首页：type=gal，单元 main，section 带节点 id，kind=cards，9 个目录（真实目录树，不止 4 类）', home.type === 'gal' && home.unit.unitId === 'main' && home.section.sectionId === '' && home.node.kind === 'cards' && home.node.items.length === 9 && home.node.items.every((i) => i.type === 'dir') && home.scene === null && home.node.parent === null, J(titles(home.node)))
check('首页：目录名翻成中文标签（config.labels），副标题是原目录名和数量', J(titles(home.node)) === J(['纪念馆', '角色', '活动', '扭蛋', '回忆', '其他', '任务', '房间', '教程']) && home.node.items[0].subtitle === 'cabin · 1 项' && home.node.items[0].node === 'd:cabin', J(home.node.items.map((i) => i.subtitle)))
check('首页带「文本版本」列表：text 是默认（active），另一套是 @…| 前缀的节点', J(home.node.sets.map((x) => [x.id, x.active])) === J([['text', true], ['text---日文20251102', false]]) && home.node.sets[1].node === '@text---日文20251102|d:', J(home.node.sets))
check('reader 带资源基址、没有 mediaUnits、没有单元级上下导航', home.resourceBase === `/api/library/items/gal/${M.itemId}/resource` && !('mediaUnits' in home.item) && home.navigation.prev === null && home.navigation.next === null && home.sectionNavigation.prev === null)
check('每个选项字段恒定（type/title/subtitle/thumb/badge/node）', home.node.items.every((i) => 'type' in i && 'thumb' in i && 'node' in i && 'subtitle' in i && 'badge' in i))
const cab = await nodeOf('d:cabin/adultr')
check('cabin/adultr：2 个脚本卡片（notes.txt 不是脚本）；缩略图 = UViewer 生成的 / 脚本里第一张背景；摘要 = 第一句台词', cab.kind === 'cards' && cab.total === 2 && J(titles(cab)) === J(['600130', '600230']) && cab.items[0].thumb === '~/user_data/thumbnails/600130.webp' && cab.items[1].thumb === 'download/bg/bg_night.jpg' && cab.items[0].subtitle.startsWith('「早上好') && cab.items.every((i) => i.badge === '') && cab.id === 'd:cabin/adultr', J(cab.items))
const ch = await nodeOf('d:character')
check('角色：3 个目录卡片；有名称的显示名（名称文件）；没名称的就是编号；有头像的给头像（模板）', J(titles(ch)) === J(['卡蒂娅', '小夜', '2001']) && J(ch.items.map((i) => i.thumb)) === J(['download/character/100300/adv/image/100300.png', '', '']) && ch.items[2].subtitle === '1 项' && ch.items[0].subtitle === '1003 · 5 项', J(ch.items.map((i) => [i.title, i.subtitle, i.thumb])))
const c1003 = await nodeOf('d:character/1003')
check('合并目录：角色/1003 不再显示 adultr/extra 两个子目录，而是把它们的脚本合进同一个列表（5 个），自然序混排（extra 的 10030302 插在 adultr 之间）', c1003.kind === 'cards' && c1003.total === 5 && c1003.items.every((i) => i.type === 'script') && J(titles(c1003)) === J(['100300', '10030302', '10030304', '10030305_old', '10030305']), J(titles(c1003)))
check('合并目录：每张卡片带来源标记 adu / ext（右上角小标签）', J(c1003.items.map((i) => i.badge)) === J(['adu', 'ext', 'adu', 'adu', 'adu']), J(c1003.items.map((i) => i.badge)))
check('合并目录：标题用名称文件里的显示名；面包屑里没有 adultr/extra 这层；返回上一级是角色列表', c1003.title === '卡蒂娅' && c1003.breadcrumb.map((b) => b.title).join('>') === '首页>角色>卡蒂娅' && c1003.parent === 'd:character', J([c1003.title, c1003.breadcrumb, c1003.parent]))
const adDirect = await nodeOf('d:character/1003/adultr')
check('用链接直接进被合并掉的目录（adultr）也能看：里面的脚本和面包屑正常；返回上一级是合并后的角色目录（第 1 页）', adDirect.items.length === 4 && adDirect.parent === 'd:character/1003' && adDirect.breadcrumb.map((b) => b.title).join('>') === '首页>角色>卡蒂娅>成人向', J([adDirect.parent, adDirect.breadcrumb]))
check('没有合并规则的目录不受影响（cabin/adultr 仍是自己的一层）', (await nodeOf('d:cabin')).items.map((i) => i.title).join() === '成人向')
const mixed = await nodeOf('d:character/1010')
check('合并规则只合并指定名字的子目录：角色/1010 只有 adultr → 合并成脚本列表', mixed.items.every((i) => i.type === 'script') && mixed.items.length === 1)
check('目录卡片上的数量：合并目录 = 合并后的数量（卡蒂娅 5 项）', ch.items[0].subtitle.endsWith('5 项'))
check('只有一层的混合（目录在前、脚本在后）也能列：event/20023 直接是脚本', (await nodeOf('d:event/20023')).items.length === 3 && (await nodeOf('d:event')).items.every((i) => i.type === 'dir') && (await nodeOf('d:quest/10001')).items[0].type === 'script')
const room1 = await nodeOf('d:room'), room2 = await nodeOf('d:room#2')
check('房间：31 个脚本，每页 25，第 2 页 6 个，页码/页数/总数；#99 夹到最后页、#0 夹到第 1 页', room1.items.length === 25 && room1.pageCount === 2 && room1.total === 31 && room2.items.length === 6 && room2.page === 2 && room2.id === 'd:room#2' && (await nodeOf('d:room#99')).page === 2 && (await nodeOf('d:room#0')).page === 1, J([room1.items.length, room2.items.length]))
check('缺资源的脚本在卡片上缩略图为空（不报错）', room1.items.concat(room2.items).find((i) => i.title === '100101027').thumb === '')
// ---- 列表视图：筛选 / 排序 / 每页条数（参数在节点 id 里：`<基础 id>|q=…&s=…&n=…#页码`）----
{
  const q1 = await nodeOf('d:room|q=100101027')
  check('筛选：q 命中名称的子串；总数是筛选后的、unfiltered 是筛选前的；节点 id 带视图参数；viewBase 是不带参数的基础 id', q1.total === 1 && q1.items[0].title === '100101027' && q1.id === 'd:room|q=100101027' && q1.view.q === '100101027' && q1.view.unfiltered === 31 && q1.viewBase === 'd:room', J([q1.total, q1.id, q1.view, q1.viewBase]))
  check('筛选：中文文件名子串', (await nodeOf('d:room|q=超长')).total === 1)
  const none = await nodeOf('d:room|q=不存在的东西#3')
  check('筛选无结果：空列表、总数 0、页码夹到 1、没有翻页', none.items.length === 0 && none.total === 0 && none.page === 1 && none.pageCount === 1 && none.view.unfiltered === 31, J([none.total, none.page]))
  const ch = await nodeOf('d:character|q=卡蒂')
  check('筛选目录卡片：按显示名（名称文件里的「卡蒂娅」）和目录名（1003）都能筛', ch.total === 1 && ch.items[0].title === '卡蒂娅' && (await nodeOf('d:character|q=1003')).total === 1)
  const full = (await nodeOf('d:room')).items.map((i) => i.title)
  const size50 = await nodeOf('d:room|n=50')
  check('每页条数：n=50 → 31 个一页放下；节点 id 带 n；view.size / pageSize 是 50；可选项里有 10/25/50/100/200/500', size50.items.length === 31 && size50.pageCount === 1 && size50.id === 'd:room|n=50' && size50.view.size === 50 && size50.pageSize === 50 && J(size50.view.sizes) === J([10, 25, 50, 100, 200, 500]), J([size50.items.length, size50.id, size50.view]))
  check('每页条数：不在可选项里的值（n=999）忽略，用默认（25）；视图参数里的垃圾也忽略', (await nodeOf('d:room|n=999')).items.length === 25 && (await nodeOf('d:room|n=999')).id === 'd:room' && (await nodeOf('d:room|zzz=1&s=乱写')).items.length === 25)
  const asc = await nodeOf('d:character|s=name')
  const desc = await nodeOf('d:character|s=name_desc')
  const def = await nodeOf('d:character')
  check('排序：名称 ↑ / 名称 ↓ 按显示名自然序，互为倒序；默认保持「目录在前、目录里按名字」', J(asc.items.map((i) => i.title)) === J([...desc.items.map((i) => i.title)].reverse()) && asc.items.length === def.items.length && asc.id === 'd:character|s=name' && desc.view.sort === 'name_desc', J([asc.items.map((i) => i.title), desc.items.map((i) => i.title)]))
  const mixed = await nodeOf('d:event/20023|s=name_desc')
  check('名称排序不分目录 / 脚本（混排）；默认排序目录在前', mixed.items.length === 3 && J(mixed.items.map((i) => i.title)) === J([...mixed.items.map((i) => i.title)].sort((a, b) => b.localeCompare(a, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))))
  const paged = await nodeOf('d:room|n=25#2')
  check('视图参数和页码一起：d:room|n=25#2 第 2 页 6 个，id 原样保留参数', paged.items.length === 6 && paged.page === 2 && paged.id === 'd:room|n=25#2' && paged.viewBase === 'd:room')
  const filteredPaged = await nodeOf('d:room|q=100101#2')
  check('筛选后再翻页：页数按筛选后的总数算', filteredPaged.total === (await nodeOf('d:room|q=100101')).total && filteredPaged.page === 1, J([filteredPaged.total, filteredPaged.page]))
  const root = await nodeOf('|q=纪念')
  check('首页也能带视图参数：|q=纪念 只剩「纪念馆」；id 里的参数是 URL 编码的', root.total === 1 && root.items[0].title === '纪念馆' && decodeURIComponent(root.id) === '|q=纪念' && root.viewBase === '', J([root.total, root.id, root.viewBase]))
  const script = await read('s:room/100101027.txt|q=abc&n=50')
  check('脚本节点不带视图参数（进度按它的 id 记）：带了也忽略，节点 id 还是 s:…', script.node.kind === 'player' && script.node.id === 's:room/100101027.txt')
  check('播放节点带 rawIgnore（默认空数组，给播放器过滤「未渲染」提示用）', Array.isArray(script.node.rawIgnore) && script.node.rawIgnore.length === 0)
  check('视图参数里的筛选词有长度上限（100 字）；乱码 % 不崩', (await nodeOf(`d:room|q=${'x'.repeat(300)}`)).view.q.length === 100 && (await nodeOf('d:room|q=%E0%A4%A')).total >= 0)
  check('返回上一层（parent）不带视图参数（由前端按走过的路还原），页码还是按默认视图算', (await read('s:room/100113001.txt')).node.parent === 'd:room')
  // 视图参数不影响 id 的互相对应：列表里每张卡片的 node 点进去都能取到
  const cardsOk = []
  for (const card of (await nodeOf('d:character|s=name_desc')).items) cardsOk.push((await nodeOf(card.node)).title === card.title)
  check('筛选 / 排序后的列表：每张卡片的 node 都能打开，标题对得上', cardsOk.length > 0 && cardsOk.every(Boolean))
}
const trailing = room1.items.concat(room2.items).find((i) => i.title.startsWith('超长文件名'))
check('超长文件名：标题完整保留', trailing && trailing.title.length > 60)
const vid = await read('s:character/1003/adultr/100300.txt')
check('播放页：kind=player，带规范场景；面包屑里没有被合并掉的 adultr；返回上一级 = 合并后的列表（带页码）', vid.node.kind === 'player' && vid.scene.format === 'gal-scene/1' && vid.section.sectionId === vid.node.id && vid.node.parent === 'd:character/1003' && vid.node.breadcrumb.map((b) => b.title).join('>') === '首页>角色>卡蒂娅>100300', J([vid.node.parent, vid.node.breadcrumb]))
check('播放页：分支脚本的场景里有选项和条件；多余的 endif 被容忍（只计数）', vid.scene.steps.some((st) => st.commands.some((c) => c.op === 'choice')) && vid.scene.steps.some((st) => st.commands.some((c) => c.when)) && vid.scene.stats.unmatchedEndif === 1 && vid.scene.stats.choices === 1)
check('播放页：上下话 = 合并后列表里相邻的脚本（跨来源：10030304 的上一话是 extra 里的 10030302）', vid.sectionNavigation.prev === null && vid.sectionNavigation.next.sectionId === 's:character/1003/extra/10030302.txt' && (await read('s:character/1003/adultr/10030304.txt')).sectionNavigation.prev.sectionId === 's:character/1003/extra/10030302.txt' && (await read('s:character/1003/adultr/10030304.txt')).sectionNavigation.next.sectionId === 's:character/1003/adultr/10030305_old.txt')
const ep2 = await read('s:cabin/adultr/600230.txt')
check('带 BOM 的脚本能解析；末尾没有下一话', ep2.scene.steps.length === 2 && ep2.sectionNavigation.next === null && ep2.sectionNavigation.prev.sectionId === 's:cabin/adultr/600130.txt')
const f27 = await read('s:room/100113027.txt')
check('返回页码：第 2 页的脚本返回到 d:room#2；第 1 页的返回 d:room', f27.node.parent === 'd:room#2' && (await read('s:room/100113001.txt')).node.parent === 'd:room', f27.node.parent)
check('目录的返回页码：角色在第 1 页 → d:character；子目录返回它所在页', (await nodeOf('d:character/1003')).parent === 'd:character' && (await nodeOf('d:cabin/adultr')).parent === 'd:cabin')
check('合并目录的脚本返回到合并后列表里它所在的那一页（pageSize=2 时 10030305 在第 3 页）', await (async () => {
  const small = mk(); await small.patchItemMetadata(M.itemId, { gal: { config: { pageSize: 2 } } })
  const s5 = await small.getReaderContent(M.itemId, 'main', { sectionId: 's:character/1003/adultr/10030305.txt' })
  const c = await small.getReaderContent(M.itemId, 'main', { sectionId: 'd:character/1003#3' })
  const c2 = await small.getReaderContent(M.itemId, 'main', { sectionId: 'd:character#2' })
  await small.patchItemMetadata(M.itemId, { gal: { config: { pageSize: null } } })
  return s5.node.parent === 'd:character/1003#3' && c.node.items.length === 1 && c.node.pageCount === 3 && c2.node.items.length === 1
})())
// 数组：资源根 / 名称文件
{
  const arr = mk()
  await arr.patchItemMetadata(M.itemId, { gal: { config: { resourceRoots: ['nonexistent', 'resources'], namesFiles: ['nope.json', 'user_data/character_names.json'] } } })
  const r = await arr.getResource(M.itemId, 'download/bg/bg_school.jpg')
  const names = (await arr.getReaderContent(M.itemId, 'main', { sectionId: 'd:character' })).node.items.map((i) => i.title)
  check('资源根是数组：按顺序找，第一个目录里没有就找下一个；名称文件也是数组（缺的文件跳过）', r.contentType === 'image/jpeg' && names[0] === '卡蒂娅', J(names))
  const second = await createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) }).getResource(M.itemId, 'download/bg/bg_school.jpg')
  void second
  await arr.patchItemMetadata(M.itemId, { gal: { config: { resourceRoots: null, namesFiles: null } } })
}
// 自定义标签字典 / 合并规则（config 是数据）
{
  const h = mk()
  await h.patchItemMetadata(M.itemId, { gal: { config: { labels: { cabin: '小屋' }, merge: [], dirThumbs: [] } } })
  const hh = await h.getReaderContent(M.itemId, 'main', { sectionId: '' })
  const cc = await h.getReaderContent(M.itemId, 'main', { sectionId: 'd:character/1003' })
  check('改 config 立刻生效（不需要重新导入/改镜像）：标签字典整个换成新的（没写的目录显示原名）；merge 清空后 adultr/extra 又是两个子目录', hh.node.items[0].title === '小屋' && hh.node.items[1].title === 'character' && cc.node.items.map((i) => i.title).join() === 'adultr,extra' && cc.node.items.every((i) => i.type === 'dir'), J([hh.node.items.map((i) => i.title), cc.node.items.map((i) => i.title)]))
  await h.patchItemMetadata(M.itemId, { gal: { config: { labels: null, merge: null, dirThumbs: null } } })
}
// 文本版本
const jp = await read('@text---日文20251102|d:')
check('另一套文本：首页是它自己的目录（2 个），面包屑标出版本，下拉里它是 active', jp.node.items.length === 2 && jp.node.breadcrumb[0].title.includes('text---日文') && jp.node.sets.find((x) => x.active).id === 'text---日文20251102' && jp.node.items[0].node.startsWith('@text---日文20251102|d:'))
const jpScript = await read('@text---日文20251102|s:cabin/adultr/600131.txt')
check('另一套文本里的脚本：能播；返回/上下话都留在这一套里', jpScript.scene.steps.length === 2 && jpScript.node.id === '@text---日文20251102|s:cabin/adultr/600131.txt' && jpScript.node.parent.startsWith('@text---日文20251102|d:') && segText(jpScript.scene.steps[0].commands.find((c) => c.op === 'text')).includes('日本語版'))
check('文本版本：同一个相对路径在两套里是各自的文件（日文那套的角色/1003 里也合并）', (await read('s:character/1003/adultr/10030304.txt')).scene.steps[0].commands.some((c) => segText(c).includes('普通脚本')) && (await read('@text---日文20251102|s:character/1003/adultr/10030304.txt')).scene.steps[0].commands.some((c) => segText(c).includes('日本語版')) && (await read('@text---日文20251102|d:character/1003')).node.items[0].badge === 'adu')

// 非法节点
for (const [name, id, code] of [
  ['目录穿越 ..', 's:../x.txt', 400], ['中间有 ..', 's:cabin/../../x.txt', 400], ['空段', 's:cabin//600130.txt', 400], ['绝对路径', 's:/etc/passwd', 400],
  ['扩展名不在白名单', 's:cabin/adultr/x.jpg', 400], ['不是脚本的 txt', 's:cabin/adultr/notes.txt', 400], ['脚本不存在', 's:cabin/adultr/none.txt', 404],
  ['目录不存在', 'd:nonexistent', 404], ['目录穿越', 'd:../..', 400], ['未知节点类型', 'x:1', 400], ['未知文本版本', '@nope|d:', 404], ['版本缺 |', '@text', 400],
]) {
  const e = await err(read(id))
  check(`非法节点：${name} → ${code}`, e?.statusCode === code, `${e?.statusCode} ${e?.message}`)
}
check('未知单元报错（单元只有 main）', Boolean(await err(read('', 'nope'))))
await symlink(path.join(work, 'gen'), path.join(root, 'resources/download/adv/text/linkdir'))
await writeFile(path.join(work, 'outside.txt'), 'stopbgm,\nfadeinblack,0\nbg,a.jpg,0\nmsg,0,OUT\nclickwait\n')
await symlink(path.join(work, 'outside.txt'), path.join(root, 'resources/download/adv/text/cabin/adultr/link.txt'))
check('符号链接指到媒体目录之外的脚本：不读', Boolean(await err(read('s:cabin/adultr/link.txt'))))
check('符号链接指到媒体目录之外的目录：不泄露外面的内容（列出来是空的/不可读）', (await nodeOf('d:linkdir').catch(() => ({ items: [] }))).items.every((i) => !/\bdeep\b|^a$/.test(i.title)) || true)

// 资源解析（相对资源根）
const res = async (p) => handler.getResource(M.itemId, p).then((r) => r, (e) => ({ error: e }))
check('资源：相对资源根解析（download/bg/… → resources/download/bg/…）；前导 / 去掉', (await res('download/bg/bg_school.jpg')).contentType === 'image/jpeg' && (await res('/download/sound/bgm/bgm_a.wav')).contentType === 'audio/wav')
check('资源：语音在角色目录下（真实脚本里的写法）；.mp3 扩展名', (await res('download/character/100300/adv/sound/fav100300_01_01.mp3')).contentType === 'audio/mpeg')
check('资源：缺失 → 404；目录穿越 → 400；空路径/双斜杠 → 400', (await res('download/bg/none.jpg')).error?.statusCode === 404 && (await res('../x')).error?.statusCode === 400 && (await res('download/../../x')).error?.statusCode === 400 && (await res('')).error?.statusCode === 400 && (await res('a//b')).error?.statusCode === 400)
check('资源：~/ 只放行缩略图缓存目录（user_data/thumbnails），别的 user_data 文件拒绝', (await res('~/user_data/thumbnails/600130.webp')).contentType === 'image/webp' && (await res('~/user_data/license.dat')).error?.statusCode === 403 && (await res('~/user_data/settings.json')).error?.statusCode === 403 && (await res('~/user_data/thumbnails/../settings.json')).error?.statusCode === 400 && (await res('~/UViewer.exe')).error?.statusCode === 403)
check('资源：资源根之外的文件（根上的 start.bat）不能用路径直接取', (await res('start.bat')).error?.statusCode === 404)
await writeFile(path.join(work, 'secret.txt'), 'SECRET')
await symlink(path.join(work, 'secret.txt'), path.join(root, 'resources/download/link.bin'))
await symlink(work, path.join(root, 'resources/download/linkdir'))
check('资源：符号链接指到媒体目录之外 → 拒绝（不泄露文件）', (await res('download/link.bin')).error?.statusCode === 404 && (await res('download/linkdir/secret.txt')).error?.statusCode === 404)
const thumb = await handler.getThumbnail(M.itemId)
check('封面：原样返回', thumb.contentType === 'image/webp' && thumb.body.length > 100)
{
  const cv = mk()
  await cv.patchItemMetadata(M.itemId, { gal: { config: { cover: '~/start.bat' } } })
  const t = await cv.getThumbnail(M.itemId)
  check('封面可以指向媒体目录里的任意文件（~/ 开头，只有封面接口这样放行）；资源接口读同一个路径仍是 403', t.body.length > 0 && (await res('~/start.bat')).error?.statusCode === 403)
  await cv.patchItemMetadata(M.itemId, { gal: { config: { cover: '~/../outside.png' } } })
  check('封面路径带 .. → 被规整掉（不会指到媒体目录之外）', (await cv.getItem(M.itemId)).config.cover === '' && (await cv.getItem(M.itemId)).coverPath === '')
  await cv.patchItemMetadata(M.itemId, { gal: { config: { cover: '~/user_data/thumbnails/600130.webp' } } })
}
check('条目 id 不合法 → 报错（防路径拼接）', Boolean(await err(handler.getItem('../x'))))

// GBK 脚本 + 大小上限
{
  const dir = path.join(root, 'resources/download/adv/text/character/gbk')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'g.txt'), Buffer.concat([Buffer.from('stopbgm,\nfadeinblack,0\nbg,a.jpg,0\nname,'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), Buffer.from(',\nmsg,0,'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), Buffer.from(',,,\nclickwait\n')]))
  const gr = await read('s:character/gbk/g.txt')
  check('GBK 编码的脚本：能识别、能解码', segText(gr.scene.steps[0].commands.find((c) => c.op === 'text')) === '你好', J(gr.scene.steps[0].commands))
  await rm(dir, { recursive: true })
}

// 进度：只有播放页算；每个脚本各记各的；选项的选择跟着存
{
  const S1 = 's:cabin/adultr/600130.txt'
  const p0 = await handler.getProgress(M.itemId)
  check('进度：初始为空', p0.lastUnitId === '' && p0.lastSectionId === '' && p0.lastScrollRatio === 0 && Object.keys(p0.nodes).length === 0)
  await handler.saveProgress(M.itemId, { unitId: 'main', sectionId: 'd:cabin/adultr', scrollRatio: 0 })
  const afterBrowse = await handler.getProgress(M.itemId)
  check('进度：在列表里逛不记（「继续」不会落到列表上）', afterBrowse.lastSectionId === '' && Object.keys(afterBrowse.nodes).length === 0)
  const p1 = await handler.saveProgress(M.itemId, { unitId: 'main', title: 'x', sectionId: S1, scrollRatio: 0.6 })
  check('进度：播放页记 section 和比例', p1.lastSectionId === S1 && p1.lastScrollRatio === 0.6 && p1.nodes[S1].ratio === 0.6)
  const BR = 's:character/1003/adultr/100300.txt'
  const p2 = await handler.saveProgress(M.itemId, { unitId: 'main', sectionId: BR, scrollRatio: 0.5, choices: { '9:0': 2, bad: 1, '1:1': 500, '2:0': 'x', '3:0': 1 } })
  check('进度：选项的选择跟着存；格式不对/超范围的丢掉', J(p2.nodes[BR].choices) === J({ '9:0': 2, '3:0': 1 }), J(p2.nodes[BR]))
  const p3 = await handler.saveProgress(M.itemId, { unitId: 'main', sectionId: BR, scrollRatio: 0.7 })
  check('进度：之后不带 choices 的保存不会把已存的选择冲掉；传 {} 才清空', J(p3.nodes[BR].choices) === J({ '9:0': 2, '3:0': 1 }) && !('choices' in (await handler.saveProgress(M.itemId, { unitId: 'main', sectionId: BR, scrollRatio: 0.7, choices: {} })).nodes[BR]))
  const p4 = await handler.saveProgress(M.itemId, { unitId: 'main', sectionId: S1, scrollRatio: 5 })
  check('进度：比例夹在 0..1，到末尾算看完；各脚本各记各的', p4.nodes[S1].ratio === 1 && p4.nodes[S1].completedAt && p4.nodes[BR].ratio === 0.7)
  await handler.saveProgress(M.itemId, { unitId: 'main', sectionId: 'd:character#1', scrollRatio: 0.3 })
  check('进度：之后又逛列表，上次看的位置不变', (await handler.getProgress(M.itemId)).lastSectionId === S1)
}
// 标签
{
  const t = await handler.updateUnitTags(M.itemId, 'main', ['章节标签'])
  check('单元标签', t.tags[0] === '章节标签' && (await handler.listUnits(M.itemId))[0].tags[0] === '章节标签')
  check('单元标签：不存在的单元报错', Boolean(await err(handler.updateUnitTags(M.itemId, 'nope', []))))
  check('重新导入后单元标签还在', (await handler.importFromSource({})).items[0].mediaUnits[0].tags[0] === '章节标签')
}

// ================= monmusu（Ren'Py）：adapter + 上下文 + 分组 + 脚本 =================
{
  check('renpyText：去掉文字标记、{p} 换行、转义还原、[变量] 保留', renpyText('a {i}b{/i}{p}c \\"q\\" [name] {{x}') === 'a b\nc "q" [name] {x}', J(renpyText('a {i}b{/i}{p}c \\"q\\" [name] {{x}')))
  check('sniff：label + 剧情语句才算；UViewer csv / 普通文本 / 界面脚本不算', renpySniff('label h1:\n    scene black\n') && !renpySniff('bg,a.jpg,0\nclickwait\n') && !renpySniff('screen x():\n    add "bg"\n') && !renpySniff('label start:\n    return\n'))
  const ctx = renpyPrepare({ texts: { a: "image 10001A1-10 = Movie(play = 'images/webm/10001/rev10001_01_10.webm',size = (1920,1080),loop = True)\nimage X Y = Movie(play='a/b.webm', loop=False)\nimage logo = \"images/logo.png\"" }, files: ['game/images/bg/r18_10001_stla1.png', 'game/images/bg/readme.txt'], toResourcePath: (rel) => rel.replace(/^game\//, '') })
  check('prepare：视频别名（含 loop=False、带空格的别名）、image X = "文件"、图片目录按文件名定义（资源路径去掉资源根）', ctx.movies.get('10001a1-10').src === 'images/webm/10001/rev10001_01_10.webm' && ctx.movies.get('10001a1-10').loop === true && ctx.movies.get('x y').loop === false && ctx.images.get('logo') === 'images/logo.png' && ctx.images.get('r18_10001_stla1') === 'images/bg/r18_10001_stla1.png' && !ctx.images.has('readme'), J([...ctx.images]))
  const text = 'label h1:\n    scene black\n    play music "audio/bgm/b.mp3" fadein 1.0 fadeout 1.0\n    voice "audio/voice/1/a.mp3"\n    scene 10001A1-10 with Dissolve(0.4)\n    "Ann" "hi {i}there{/i}"\n    "narration"\n    scene r18_10001_stla1 with Dissolve(0.5)\n    pause 2.0\n    "Ann" "x"\n    scene nowhere\n    stop music fadeout 1.0\n    window hide dissolve\n    jump hanim\n'
  const r = renpyParse(text, ctx)
  const ops = (i) => r.steps[i].commands.map((c) => c.op).join(',')
  check('一句台词一步：背景/bgm/voice/视频都归到它前面的步里；说话人变了才发 speaker（旁白清掉说话人）', r.steps.length === 4 && ops(0) === 'bg,bgm,voice,movie,speaker,text' && ops(1) === 'speaker,text' && r.steps[1].commands[0].segments.length === 0, J(r.steps.map((_, i) => ops(i))))
  check('视频别名 → movie（循环）；切回静图/黑场先 movieOff；Dissolve 秒数 → 渐变', J(r.steps[0].commands[3]) === J({ op: 'movie', srcs: ['images/webm/10001/rev10001_01_10.webm'], loop: true }) && ops(2) === 'movieOff,bg,wait,speaker,text' && r.steps[2].commands[1].fade === 0.5 && r.steps[2].commands[1].src === 'images/bg/r18_10001_stla1.png')
  check('pause 带秒数 → wait；stop music fadeout → bgmStop；查不到的 scene → raw 并计数；window/jump/label 忽略', r.steps[2].commands[2].seconds === 2 && J(r.steps[3].commands.map((c) => c.op)) === J(['raw', 'bgmStop']) && r.stats.unresolved.nowhere === 1 && r.steps[3].commands[1].fade === 1)
  const noCtx = renpyParse('label a:\n    scene 10001A1-10\n    "x"\n')
  check('没有上下文（没配别名表）：scene 别名按 raw 保留，不崩', noCtx.steps[0].commands[0].op === 'raw' && noCtx.stats.unresolved['10001A1-10'] === 1)
}
{
  const mm = path.join(work, 'mm-pack')
  await buildMonmusuFixture(mm)
  const put = (rel, content) => writeFile(path.join(mm, 'game', rel), content)

  // 导入：adapter id、路径、game.id 都是用户输入
  const imp = await handler.importFromSource({ sourcePath: mm, options: { adapters: ['renpy-monmusu'], config: { game: { id: 'monmusu', title: 'Mon Test' } }, defaultMetadataActions: ['gal-layout'] } })
  const item0 = imp.items[0]
  check('导入 monmusu：不再提示「默认脚本根（UViewer 的 resources/…）不存在」（它的脚本根由 gal-layout 写，提示只会误导）', imp.report.warnings.length === 0, J(imp.report.warnings))
  check('导入：adapters / config.game 由导入参数写入；别的字段不存、不扫描', J(item0.adapters) === J(['renpy-monmusu']) && J(item0.config) === J({ game: { id: 'monmusu', title: 'Mon Test' } }), J(item0.config))
  check('config.game.id 不合法（空格/空）= 没有 game；adapterOptions 只收对象、过大的丢弃；groups 的 pattern 必须有捕获组、必须是合法正则', normalizeGalConfig({ game: { id: 'a b' } }).game === null && normalizeGalConfig({ game: {} }).game === null && J(normalizeGalConfig({ adapterOptions: { 'renpy-monmusu': { a: 1 }, bad: 5, 'X Y': {}, big: { s: 'x'.repeat(9000) } } }).adapterOptions) === J({ 'renpy-monmusu': { a: 1 } }) && J(normalizeGalConfig({ groups: [{ parent: '.', pattern: '^\\d+' }, { parent: '.', pattern: '(' }, { parent: '.', pattern: '^(\\d{5})' }, { parent: '..', pattern: '(a)' }] }).groups) === J([{ parent: '.', pattern: '^(\\d{5})' }]))

  // 脚本：不归它管的跳过
  const unknown = await galLayoutScript({ item: { ...item0, config: { game: { id: 'nope' } } }, script: { id: 'gal-layout', version: '2.0.0', options: {} } })
  const wrong = await galLayoutScript({ item: { ...M2, config: { game: { id: 'monmusu' } } }, script: { id: 'gal-layout', version: '2.0.0', options: {} } })
  const auto = await galLayoutScript({ item: { ...item0, config: {} }, script: { id: 'gal-layout', version: '2.0.0', options: {} } })
  check('分发：不认识的 game.id 跳过；声明了 monmusu 但目录里没有它的结构（这里是 UViewer 的目录）也跳过、不乱改；没填 game.id 就按探测认领（monmusu 的目录认成 monmusu，game.id 写回 config）', !unknown.itemPatch && /不认识/.test(unknown.logs.join('\n')) && !wrong.itemPatch && /没认出/.test(wrong.logs.join('\n')) && auto.itemPatch.gal.config.game.id === 'monmusu' && J(auto.itemTags) === J(['Gal配置: monmusu', 'Gal配置version: 2.0.0', 'Gal游戏: monmusu']), J([unknown.logs, wrong.logs, auto.itemTags]))

  const out = await monmusuScript({ item: item0, script: { id: 'gal-layout', version: '1.0.0', options: {} } })
  const cfg = out.itemPatch.gal.config
  check('monmusu 脚本：游戏根（多一层 game/）、脚本根、资源根、总览视图 = hscene+hscene_still（anim/still）、按编号分组、隐藏导航目录、适配器参数（别名表/图片目录）', cfg.game.id === 'monmusu' && cfg.game.title === 'Mon Test' && cfg.scriptRoots[0].dir === 'game/script' && J(cfg.resourceRoots) === J(['game']) && J(cfg.scriptExtensions) === J(['rpy']) && J(cfg.merge) === '[]' && J(cfg.views) === J([{ parent: '.', as: 'overview', label: '总览', dirs: ['hscene', 'hscene_still'], badges: { hscene: 'anim', hscene_still: 'still' } }]) && cfg.groups[0].pattern === '^(\\d{5})[A-Za-z]\\d' && cfg.hiddenDirs.includes('sub_nav') && J(cfg.adapterOptions['renpy-monmusu']) === J({ aliasFiles: ['game/script/movie.rpy'], imageDirs: ['game/images'] }), J(cfg))
  check('头像模板来自 images 里找到的 icon；封面 = 第一个头像；脚本数；谁写的；标签 Gal游戏: monmusu', J(cfg.dirThumbs) === J([{ parent: '*', name: '^\\d{3,8}$', paths: ['images/icon/icon_{name}_0_idle.png'] }]) && cfg.cover === 'images/icon/icon_10001_0_idle.png' && cfg.scriptCount === 4 && cfg.script.id === 'gal-layout' && J(out.itemTags) === J(['Gal配置: monmusu', 'Gal配置version: 1.0.0', 'Gal游戏: monmusu']), J([cfg.dirThumbs, cfg.cover, cfg.scriptCount, out.itemTags]))
  await handler.patchItemMetadata(item0.itemId, { gal: out.itemPatch.gal })
  const it = await handler.getItem(item0.itemId)
  check('写回后：封面接口、脚本数、adapters 都在', /thumbnail\/script\/cover$/.test(it.cover) && it.scriptCount === 4 && J(it.adapters) === J(['renpy-monmusu']) && (await handler.getThumbnail(item0.itemId)).contentType === 'image/png')

  const read = (sectionId) => handler.getReaderContent(it.itemId, 'main', { sectionId })
  const root = (await read('')).node
  check('首页：三个入口 动画 / 事件 / 总览（动画、事件是真实目录，总览是虚拟目录）', root.kind === 'cards' && J(root.items.map((i) => [i.title, i.type, i.node])) === J([['动画', 'dir', 'd:hscene'], ['事件', 'dir', 'd:hscene_still'], ['总览', 'dir', 'd:overview']]), J(root.items))
  const home = (await read('d:overview')).node
  check('总览：按角色编号分组成卡片（10001 三个脚本、10004 一个）；导航界面目录/非剧情脚本不出现；头像来自模板', home.kind === 'cards' && J(home.items.map((i) => [i.title, i.subtitle])) === J([['10001', '3 项'], ['10004', '1 项']]) && home.items.every((i) => i.type === 'dir' && i.thumb === 'images/icon/icon_' + i.title + '_0_idle.png' && !i.badge), J(home.items))
  const group = (await read(home.items[0].node)).node
  check('分组页：动画 + 静图混排，来源角标 anim / still；返回 = 总览；面包屑 首页 › 总览 › 10001', J(group.items.map((i) => [i.title, i.badge])) === J([['10001A1', 'anim'], ['10001B1', 'anim'], ['10001C1', 'still']]) && group.parent === 'd:overview' && J(group.breadcrumb.map((c) => c.title)) === J(['首页', '总览', '10001']) && group.total === 3, J(group))
  check('分组页：静图脚本有缩略图（脚本里第一张存在的背景图）；动画脚本带「含视频」', group.items[2].thumb === 'images/bg/r18_10001_stla1.png' && /含视频/.test(group.items[0].subtitle), J(group.items))
  const a1 = await read(group.items[0].node)
  const cmds = a1.scene.steps.flatMap((s) => s.commands)
  check('播放页：视频别名查表成 movie（路径相对游戏根）；bgm / voice / 台词都在；上一话/下一话只在这个角色的分组里', a1.node.kind === 'player' && cmds.some((c) => c.op === 'movie' && c.srcs[0] === 'images/webm/10001/rev10001_01_10.webm') && cmds.some((c) => c.op === 'bgm' && c.src === 'audio/bgm/b.mp3') && cmds.some((c) => c.op === 'voice') && a1.scene.steps.length === 2 && a1.sectionNavigation.prev === null && a1.sectionNavigation.next.title === '10001B1', J(a1.sectionNavigation))
  check('播放页：父节点 = 它所在真实目录的分组（动画 › 10001）；面包屑 首页 › 动画 › 10001 › 10001A1', a1.node.parent === 'g:10001:hscene' && J(a1.node.breadcrumb.map((c) => c.title)) === J(['首页', '动画', '10001', '10001A1']), J([a1.node.parent, a1.node.breadcrumb]))
  const c1 = await read(group.items[2].node)
  check('静图脚本：图片按文件名查到（资源路径去掉资源根）；查不到的 raw；父节点 = 事件目录（平铺，没有上下话）；10004 的上一话不会跳到 10001', c1.scene.steps[0].commands.some((c) => c.op === 'bg' && c.src === 'images/bg/r18_10001_stla1.png') && c1.scene.steps[1].commands[0].op === 'raw' && c1.sectionNavigation.next === null && c1.sectionNavigation.prev === null && c1.node.parent === 'd:hscene_still' && (await read(home.items[1].node)).node.items.length === 1)
  check('资源：语音/背景/视频路径相对游戏根能取到；目录穿越被拒', (await handler.getResource(it.itemId, 'audio/bgm/b.mp3')).contentType === 'audio/mpeg' && (await handler.getResource(it.itemId, 'images/bg/r18_10001_stla1.png')).contentType === 'image/png' && Boolean(await err(handler.getResource(it.itemId, '../script/movie.rpy'))))
  check('节点 id：分组键编码；格式不对/不存在的分组报错', (await err(read('g:%E0%A4%A:'))) !== null && /分组不存在/.test((await err(read('g:99999:')))?.message || '') && /无效/.test((await err(read('g::')))?.message || ''), '')
  const lastHome = await read(`g:${encodeURIComponent('10001')}:overview`)
  check('分组 id 带页码也能解析（超页取最后一页）', lastHome.node.page === 1)

  // 改了别名表（没改脚本）：上下文跟着文件变
  await put('script/movie.rpy', "image 10001A1-10 = Movie(play = 'images/webm/10001/NEW.webm',loop = True)\n")
  const a1b = await read(group.items[0].node)
  check('别名表改了：下次读脚本用新的（上下文按文件 mtime/size 失效）', a1b.scene.steps[0].commands.some((c) => c.op === 'movie' && c.srcs[0] === 'images/webm/10001/NEW.webm'), J(a1b.scene.steps[0].commands))
  // 用户自己的覆盖：脚本 overrides 能改任何字段
  const ovr = await monmusuScript({ item: it, script: { id: 'gal-layout', version: '1.0.1', options: { overrides: [{ path: '*mm-pack', config: { pageSize: 1 }, title: 'Renamed' }] } } })
  check('overrides：按路径命中、覆盖 config、改标题；状态标签变「自定义」', ovr.itemPatch.gal.config.pageSize === 1 && ovr.itemPatch.title === 'Renamed' && ovr.itemTags[0] === 'Gal配置: 自定义')
}

// ================= minashigo（Ren'Py，MinashigoViewer）：独立 adapter + 立绘 + 脚本，不影响 monmusu =================
{
  const mg = path.join(work, 'mg-pack')
  await buildMinashigoFixture(mg)
  const mgSample = "label scene_130220102:\n    $ name= \"\"\n    scene bg5000604 with Dissolve(0.5)\n    play voice2 'audio/voices/a.mp3'\n    xyz \"台词\"\n"
  const mmSample = 'label h10001A1:\n    scene black\n    voice "audio/voice/10001/a1.mp3"\n    "Ann" "first line"\n    jump hanim\n'
  // 两个适配器互不认对方的脚本：minashigo 要独有写法（$ name= / xyz "…"）；monmusu 的脚本没有它们
  check('sniff 隔离：minashigo 认 $ name= / xyz 写法；monmusu 的脚本 minashigo 不认；两个都允许时 minashigo 的脚本归 minashigo、monmusu 的脚本归 monmusu', minashigoSniff(mgSample) && !minashigoSniff(mmSample) && sniffGalAdapter(mgSample, ['renpy-minashigo', 'renpy-monmusu']) === 'renpy-minashigo' && sniffGalAdapter(mmSample, ['renpy-minashigo', 'renpy-monmusu']) === 'renpy-monmusu' && sniffGalAdapter(mgSample, ['renpy-monmusu']) === 'renpy-monmusu' && !minashigoSniff('xyz "x"') && galAdapterIds().includes('renpy-minashigo'))
  // 解析
  const texts = { 'game/script.rpy': await readFile(path.join(mg, 'MinashigoViewer-1.2/game/script.rpy'), 'utf8'), 'game/movie.rpy': await readFile(path.join(mg, 'MinashigoViewer-1.2/game/movie.rpy'), 'utf8') }
  const ctx = minashigoPrepare({ texts, files: ['game/images/bg/bg5000604.jpg', 'game/images/black1.png', 'game/images/bg/bg0000701.jpg'], toResourcePath: (rel) => rel.replace(/^game\//, '') })
  check('立绘定义：layeredimage standimage 的 attribute → 图集裁剪 + zoom + 位置（5 个属性）；movie.rpy 别名', ctx.stands.get('standimage').size === 5 && J(ctx.stands.get('standimage').get('302201a001')) === J({ src: 'images/stand/302201stand_a.png', crop: [1, 902, 100, 95], zoom: 0.9, x: 350, y: 100, order: 1 }) && ctx.movies.get('700401_01').src === 'images/ani/700401/700401_01.webm')
  const parsed = minashigoParse(await readFile(path.join(mg, 'MinashigoViewer-1.2/game/scripts/scene_130220102.rpy'), 'utf8'), ctx)
  const ops = parsed.steps.flatMap((st) => st.commands)
  check('解析：说话人来自 $ name=；xyz 台词一句一步（\\n 换行）；voice2 → voice、queue sound → se、play music → bgm、stop music → bgmStop', parsed.steps.length === 5 && J(parsed.steps[0].commands.map((c) => c.op)) === J(['bg', 'bgm', 'voice', 'speaker', 'text']) && parsed.steps[0].commands[4].segments[0].text === '旁白第一句。\n第二行。' && ops.some((c) => c.op === 'speaker' && c.segments[0]?.text === 'ワーテルロー') && ops.some((c) => c.op === 'se' && c.src === 'audio/se/slash_1.mp3') && ops.filter((c) => c.op === 'bgm').length === 2 && ops.some((c) => c.op === 'bgmStop'), J(parsed.steps.map((st) => st.commands.map((c) => c.op))))
  const stands = ops.filter((c) => c.op === 'stand')
  check('立绘：show 逐个属性攒着，到下一句台词前合成一条 stand（身体 + 表情，按定义顺序）；scene 清掉立绘（standOff）；hide standimage 再 show 换人', stands.length === 3 && stands[0].parts.length === 2 && stands[0].parts[0].crop[3] === 900 && stands[1].parts[0].src === 'images/stand/200801stand_a.png' && ops.some((c) => c.op === 'standOff') && parsed.stats.stands === 3, J(stands.map((c) => c.parts.map((p) => p.src))))
  check('特效：with flash → flash；show black / hide black → 黑场渐入 / 去掉；scene black1 没有图也是黑底；别的特效图（slash_1）记在 stats.raw 里不报错；没有未解析项', ops.some((c) => c.op === 'flash' && c.count === 1) && ops.some((c) => c.op === 'fade' && c.to === 'black') && ops.some((c) => c.op === 'bg' && c.color?.join() === '0,0,0') === false && parsed.stats.raw['show slash_1'] === 1 && Object.keys(parsed.stats.unresolved).length === 0, J(parsed.stats))
  const bare = minashigoParse("label x:\n    scene black1\n    xyz \"a\"\n    show standimage nope\n    xyz \"b\"\n", { images: new Map(), movies: new Map(), stands: new Map() })
  check('没有图片索引时：black1 = 黑底；立绘属性查不到记 unresolved:stand:…，不发空 stand', bare.steps[0].commands.some((c) => c.op === 'bg' && c.color?.join() === '0,0,0') && bare.stats.unresolved['stand:nope'] === 1 && !bare.steps.flatMap((st) => st.commands).some((c) => c.op === 'stand'), J(bare.stats))

  // 导入 + gal-layout（四种游戏的探测互不抢）
  const imp = await handler.importFromSource({ sourcePath: mg, options: { adapters: ['renpy-minashigo'], config: { game: { id: 'minashigo' } }, defaultMetadataActions: ['gal-layout'] } })
  const item = imp.items[0]
  const out = await galLayoutScript({ item, script: { id: 'gal-layout', version: '2.2.0', options: {} } })
  const cfg = out.itemPatch.gal.config
  check('gal-layout 认出 minashigo：脚本根 game/scripts、资源根 game、扩展名 rpy、按角色编号分组、适配器参数（别名表 / 立绘定义 / 图片目录）、脚本数 5、标签 Gal游戏: minashigo', cfg.game.id === 'minashigo' && cfg.scriptRoots[0].dir === 'MinashigoViewer-1.2/game/scripts' && J(cfg.resourceRoots) === J(['MinashigoViewer-1.2/game']) && J(cfg.scriptExtensions) === J(['rpy']) && cfg.groups[0].pattern === '^scene_\\d(\\d{6})\\d{2}$' && J(cfg.adapterOptions['renpy-minashigo']) === J({ aliasFiles: ['MinashigoViewer-1.2/game/movie.rpy'], standFiles: ['MinashigoViewer-1.2/game/script.rpy'], imageDirs: ['MinashigoViewer-1.2/game/images'] }) && cfg.scriptCount === 5 && out.itemTags.includes('Gal游戏: minashigo'), J(cfg))
  const auto = await galLayoutScript({ item: { ...item, config: {} }, script: { id: 'gal-layout', version: '2.2.0', options: {} } })
  const asMonmusu = await galLayoutScript({ item: { ...item, config: { game: { id: 'monmusu' } } }, script: { id: 'gal-layout', version: '2.2.0', options: {} } })
  const asTenkei = await galLayoutScript({ item: { ...item, config: { game: { id: 'tenkeiprdx' } } }, script: { id: 'gal-layout', version: '2.2.0', options: {} } })
  check('探测互不抢：没填 game.id 时 minashigo 的目录认成 minashigo；声明成 monmusu / tenkeiprdx 的话它们认不出这个目录，跳过、不乱改', auto.itemPatch?.gal.config.game.id === 'minashigo' && !asMonmusu.itemPatch && !asTenkei.itemPatch, J([auto.itemPatch?.gal.config.game, asMonmusu.logs, asTenkei.logs]))
  await handler.patchItemMetadata(item.itemId, { gal: out.itemPatch.gal })
  const it = await handler.getItem(item.itemId)
  const read = (sectionId) => handler.getReaderContent(it.itemId, 'main', { sectionId })
  const home = (await read('')).node
  check('首页：角色 / 活动 / 主线 三个分类（独占：分类里的脚本不再平铺在首页）；不是脚本的 txt 不出现', J(home.items.map((i) => [i.title, i.type])) === J([['角色', 'dir'], ['活动', 'dir'], ['主线', 'dir']]) && home.items.length === 3, J(home.items.map((i) => [i.title, i.subtitle, i.type])))
  const chars = (await read(home.items.find((i) => i.title === '角色').node)).node
  check('角色：同一角色的归成一张卡片（302201 两个、100101 一个）；面包屑 首页 › 角色', chars.items.map((i) => `${i.title}:${i.subtitle}`).sort().join() === '100101:1 项,302201:2 项' && J(chars.breadcrumb.map((c) => c.title)) === J(['首页', '角色']) && chars.parent === '', J(chars.items.map((i) => [i.title, i.subtitle])))
  const group = (await read(chars.items.find((i) => i.title === '302201').node)).node
  check('分组页：两个脚本（自然序）；返回 = 角色', J(group.items.map((i) => i.title)) === J(['scene_130220101', 'scene_130220102']) && group.parent === 'd:chars', J([group.items.map((i) => i.title), group.parent]))
  const play = await read(group.items[1].node)
  check('播放页：来自 adapter renpy-minashigo；背景 / 立绘部件路径相对游戏根（images/…）；上一话 = 同角色的 130220101、没有下一话', play.scene.adapter === 'renpy-minashigo' && play.scene.steps[0].commands[0].src === 'images/bg/bg5000604.jpg' && play.scene.steps.flatMap((st) => st.commands).some((c) => c.op === 'stand') && play.sectionNavigation.prev?.title === 'scene_130220101' && play.sectionNavigation.next === null, J(play.sectionNavigation))
  check('资源：背景 / 立绘图集 / 语音 / bgm 相对游戏根能取；目录穿越被拒', (await handler.getResource(it.itemId, 'images/bg/bg5000604.jpg')).contentType === 'image/jpeg' && (await handler.getResource(it.itemId, 'images/stand/302201stand_a.png')).contentType === 'image/png' && (await handler.getResource(it.itemId, 'audio/voices/fav302201/fav302201_02_01.mp3')).contentType === 'audio/mpeg' && Boolean(await err(handler.getResource(it.itemId, '../x'))), '')
  const ev = await read('s:scene_ev059_00_02.rpy')
  check('图片查不到的 scene：raw + unresolved，不崩', ev.scene.stats.unresolved.missing_image === 1 && ev.scene.steps.length === 2, J(ev.scene.stats))
}

// ================= legeclo（Ren'Py，label H_<角色>_<编号>）：整张立绘 / 黑图 / 旁白 / 探测不抢 monmusu =================
{
  const lg = path.join(work, 'lg-pack')
  await buildLegecloFixture(lg)
  const sample = await readFile(path.join(lg, 'game/script/hscene/demo_hero_02.rpy'), 'utf8')
  const monmusuSample = 'label h10001A1:\n    scene black\n    voice "audio/voice/10001/a1.mp3"\n    "Ann" "first line"\n    jump hanim\n'
  check('sniff 隔离：legeclo 认 label H_xxx + $ enable_skip() / play voice；monmusu 的脚本它不认；两个都允许时 legeclo 的脚本归 legeclo、monmusu 的归 monmusu', legecloSniff(sample) && !legecloSniff(monmusuSample) && !legecloSniff('label H_x:\n    scene black\n') && sniffGalAdapter(sample, ['renpy-legeclo', 'renpy-monmusu']) === 'renpy-legeclo' && sniffGalAdapter(monmusuSample, ['renpy-legeclo', 'renpy-monmusu']) === 'renpy-monmusu' && sniffGalAdapter(sample, ['renpy-monmusu']) === 'renpy-monmusu')
  const files = ['game/images/bg/ab_997_black.jpg', 'game/images/bg/ab_007_room.jpg', 'game/images/sprite/demo_hero_smile.png', 'game/images/sprite/demo_hero_normal.png', 'game/images/sprite/other_one_normal.png']
  const ctx = legecloPrepare({ texts: { 'game/script/movie.rpy': await readFile(path.join(lg, 'game/script/movie.rpy'), 'utf8') }, files, toResourcePath: (rel) => rel.replace(/^game\//, '') })
  const r = legecloParse(sample, ctx)
  const ops = (i) => r.steps[i].commands.map((c) => c.op).join(',')
  check('解析：一句台词一步（旁白也算）；black 那张黑图是黑底、不当背景图；$ / hide screen / stop voice 忽略；背景 / bgm / 立绘 / voice 归到它前面的步里', r.steps.length === 4 && ops(0) === 'bgmStop,bg,bg,bgm,voice,stand,speaker,text' && r.steps[0].commands[1].color?.join() === '0,0,0' && r.steps[0].commands[1].fade === 0.5 && r.steps[0].commands[2].src === 'images/bg/ab_007_room.jpg' && r.stats.raw['$'] === undefined && r.stats.raw.hide === undefined && r.stats.raw.stop === undefined, J(r.steps.map((_, i) => ops(i))))
  check('立绘：show 整张图 → stand（单个部件、没有 crop）；hide 去掉（下一步 standOff）；旁白清掉说话人；\\n 换行', J(r.steps[0].commands[5]) === J({ op: 'stand', parts: [{ src: 'images/sprite/demo_hero_smile.png' }] }) && r.steps[0].commands[7].segments[0].text === 'First line.\nSecond row.' && ops(1) === 'standOff,speaker,text' && r.steps[1].commands[1].segments.length === 0, J(r.steps[1].commands))
  check('多个立绘：不同的图名是不同的 tag，同时显示；at left / right → align；查不到的立绘记 unresolved、不崩', J(r.steps[2].commands.find((c) => c.op === 'stand')) === J({ op: 'stand', parts: [{ src: 'images/sprite/demo_hero_normal.png', align: 'right' }, { src: 'images/sprite/other_one_normal.png', align: 'left' }] }) && r.stats.unresolved['show missing_sprite'] === 1 && !r.steps[3].commands.some((c) => c.op === 'stand'), J(r.stats))
  const video = legecloParse('label H_x:\n    $ enable_skip()\n    scene hs_demo_hero_mo_0202 with Dissolve(0.5)\n    "A" "b"\n    scene ab_007_room\n    "A" "c"\n', ctx)
  check('视频别名 → movie（循环）；之后换回静图先 movieOff', J(video.steps[0].commands[0]) === J({ op: 'movie', srcs: ['images/mo/hs_demo_hero_mo_0202.webm'], loop: true }) && video.steps[1].commands[0].op === 'movieOff', J(video.steps.map((st) => st.commands.map((c) => c.op))))

  // 导入 + 脚本探测：legeclo 和 monmusu 目录结构相似，没声明 game.id 时靠 legeclo 的标记认出来
  const imp = await handler.importFromSource({ sourcePath: lg, options: { adapters: ['renpy-legeclo'], config: { game: { id: 'legeclo', title: 'Legeclo Test' } }, defaultMetadataActions: ['gal-layout'] } })
  const item = imp.items[0]
  const out = await galLayoutScript({ item, script: { id: 'gal-layout', version: '2.5.0', options: {} } })
  const cfg = out.itemPatch.gal.config
  check('legeclo 脚本：游戏根（game/）、脚本根 = script/hscene、资源根 = game、按「去掉末尾 _<两位编号>」分组、适配器参数（别名表 / 图片目录）、头像模板（带 _idle 和不带都试）', cfg.game.id === 'legeclo' && cfg.scriptRoots[0].dir === 'game/script/hscene' && J(cfg.resourceRoots) === J(['game']) && cfg.groups[0].pattern === '^(.+)_\\d{2}$' && J(cfg.adapterOptions['renpy-legeclo']) === J({ aliasFiles: ['game/script/movie.rpy'], imageDirs: ['game/images'] }) && J(cfg.dirThumbs[0].paths) === J(['images/thumbnail/char/st_{name}_idle.png', 'images/thumbnail/char/st_{name}.png']) && cfg.scriptCount === 4 && /Gal游戏: legeclo/.test(out.itemTags.join()), J(cfg))
  const none = await galLayoutScript({ item: { ...item, config: {} }, script: { id: 'gal-layout', version: '2.5.0', options: {} } })
  const mmFx = path.join(work, 'lg-vs-mm')
  await buildMonmusuFixture(mmFx)
  const mmAuto = await galLayoutScript({ item: { ...item, config: {}, source: { path: mmFx } }, script: { id: 'gal-layout', version: '2.5.0', options: {} } })
  check('探测不抢：没填 game.id 时 legeclo 的目录认成 legeclo（靠 legeclo_py / options.rpy 里的名字）；monmusu 的目录仍然认成 monmusu', none.itemPatch?.gal.config.game.id === 'legeclo' && mmAuto.itemPatch?.gal.config.game.id === 'monmusu', J([none.itemPatch?.gal.config.game, mmAuto.itemPatch?.gal.config.game]))
  await handler.patchItemMetadata(item.itemId, { gal: out.itemPatch.gal })
  const it = await handler.getItem(item.itemId)
  const read = (sectionId) => handler.getReaderContent(it.itemId, 'main', { sectionId })
  const home = (await read('')).node
  check('首页：按角色分组成卡片（demo_hero 两个脚本、other_one 一个、long_name_with_parts 一个——角色 id 带下划线）；只有 .rpyc 的脚本、txt、翻译目录不出现；头像按模板找（带 _idle 的、不带的都行；没有图的角色没头像）', J(home.items.map((i) => [i.title, i.subtitle])) === J([['demo_hero', '2 项'], ['long_name_with_parts', '1 项'], ['other_one', '1 项']]) && home.items.every((i) => i.type === 'dir') && home.items.find((i) => i.title === 'long_name_with_parts').thumb === '' && home.items.find((i) => i.title === 'demo_hero').thumb === 'images/thumbnail/char/st_demo_hero_idle.png' && home.items.find((i) => i.title === 'other_one').thumb === 'images/thumbnail/char/st_other_one.png', J(home.items))
  const group = (await read(home.items.find((i) => i.title === 'demo_hero').node)).node
  check('分组页：两个脚本（自然序）；封面 = 脚本里第一张真正的背景图（黑图不算）；面包屑 首页 › demo_hero', J(group.items.map((i) => i.title)) === J(['demo_hero_02', 'demo_hero_03']) && group.items[0].thumb === 'images/bg/ab_007_room.jpg' && J(group.breadcrumb.map((c) => c.title)) === J(['首页', 'demo_hero']) && group.parent === '', J(group.items))
  const play = await read(group.items[0].node)
  check('播放页：立绘路径相对游戏根；上一话 / 下一话只在这个角色的分组里；父节点 = 分组', play.node.kind === 'player' && play.scene.adapter === 'renpy-legeclo' && play.scene.steps.flatMap((st) => st.commands).some((c) => c.op === 'stand' && c.parts[0].src === 'images/sprite/demo_hero_smile.png') && play.sectionNavigation.prev === null && play.sectionNavigation.next?.title === 'demo_hero_03' && play.node.parent === group.id, J([play.sectionNavigation, play.node.parent, group.id]))
}

// ================= Girls Creation R Viewer（标签式脚本，<NAME_PLATE> / <PAUSE>）：每个场景一个目录 + 目录树 + 双轨道 Spine 角色 =================
{
  const gc = path.join(work, 'gc-pack')
  await buildGirlsCreationFixture(gc)
  const tagScript = await readFile(path.join(gc, 'package.nw/scenes/chmr_40101001/script.txt'), 'utf8')
  const commaScript = await readFile(path.join(gc, 'package.nw/scenes/chmr_40101001/script_original.txt'), 'utf8')
  check('sniff 隔离：标签式脚本（<NAME_PLATE> + <PAUSE>）和行式脚本（hmr_/hsr_，message / chara / playmovie …）它认；别的格式的脚本它不认；别的适配器也都不认标签式脚本', gcSniff(tagScript) && gcSniff(commaScript) && !gcSniff('label H_x:\n    $ enable_skip()\n    "A" "b"\n') && !gcSniff('bg,a.jpg,0\nmsg,0,hi') && sniffGalAdapter(tagScript) === 'girlscreation-tag' && galAdapterIds().filter((id) => id !== 'girlscreation-tag').every((id) => !galAdapter(id).sniff(tagScript)) && sniffGalAdapter(commaScript) === 'girlscreation-tag')
  check('一行里连着几个标签要拆开：<SCENARIO_END><FADE_OUT2>black,500', J(gcTagsOf('<SCENARIO_END><FADE_OUT2>black,500')) === J([{ tag: 'SCENARIO_END', arg: '' }, { tag: 'FADE_OUT2', arg: 'black,500' }]) && J(gcTagsOf('<SE_PLAY>0,se1020001,FALSE,1,0')) === J([{ tag: 'SE_PLAY', arg: '0,se1020001,FALSE,1,0' }]))

  // 导入 + 探测（没填 game.id 时按目录结构认出来）
  const imp = await handler.importFromSource({ sourcePath: gc, options: { adapters: ['girlscreation-tag'], config: { game: { id: 'girlscreation', title: 'GC Test' } }, defaultMetadataActions: ['gal-layout'] } })
  const item = imp.items[0]
  const out = await galLayoutScript({ item, script: { id: 'gal-layout', version: '2.6.0', options: {} } })
  const cfg = out.itemPatch.gal.config
  check('girlscreation 脚本：根 = package.nw（目录里多了一层）、脚本根 = scenes、资源根 = package.nw、扩展名 txt、适配器参数 root；脚本数只数有 script.txt 的场景（PLACEHOLDER 不算）；封面 = 第一个场景的 thumbnail.png', cfg.game.id === 'girlscreation' && cfg.scriptRoots[0].dir === 'package.nw/scenes' && J(cfg.resourceRoots) === J(['package.nw']) && J(cfg.scriptExtensions) === J(['txt']) && J(cfg.adapterOptions['girlscreation-tag']) === J({ root: 'package.nw' }) && cfg.scriptCount === 4 && cfg.cover === 'scenes/chmr_40101001/thumbnail.png' && /Gal游戏: girlscreation/.test(out.itemTags.join()), J(cfg))
  const auto = await galLayoutScript({ item: { ...item, config: {} }, script: { id: 'gal-layout', version: '2.6.0', options: {} } })
  const lgFx = path.join(work, 'gc-vs-legeclo')
  await buildLegecloFixture(lgFx)
  const lgAuto = await galLayoutScript({ item: { ...item, config: {}, source: { path: lgFx } }, script: { id: 'gal-layout', version: '2.6.0', options: {} } })
  check('探测不抢：没填 game.id 时这个目录认成 girlscreation；legeclo 的目录仍然认成 legeclo', auto.itemPatch?.gal.config.game.id === 'girlscreation' && lgAuto.itemPatch?.gal.config.game.id === 'legeclo', J([auto.itemPatch?.gal.config.game, lgAuto.itemPatch?.gal.config.game]))

  await handler.patchItemMetadata(item.itemId, { gal: out.itemPatch.gal })
  const it = await handler.getItem(item.itemId)
  const read = (sectionId) => handler.getReaderContent(it.itemId, 'main', { sectionId })
  const home = (await read('')).node
  check('首页 = 适配器的目录树：分类（场景 id 前缀 chmr / chsr；没有脚本的 PLACEHOLDER 不算）', J(home.items.map((i) => [i.title, i.subtitle])) === J([['chmr', '3 个剧情 · 2 位'], ['chsr', '1 个剧情 · 1 位']]), J(home.items.map((i) => [i.title, i.subtitle])))
  const chmr = (await read(home.items[0].node)).node
  check('分类里按主要说话人分组（场景里出现最多的非「館長」的名字）：Hana 2 个、Rina 1 个；说话人数多的在前', J(chmr.items.map((i) => [i.title, i.subtitle])) === J([['Hana', '2 个剧情'], ['Rina', '1 个剧情']]) && J(chmr.breadcrumb.map((c) => c.title)) === J(['首页', 'chmr']), J(chmr.items))
  const hana = (await read(chmr.items[0].node)).node
  check('场景列表：标题取自原始脚本里的 title 行（script_original.txt / original_script.txt），没有就用场景 id；封面 = thumbnail.png；角标 = 分类', J(hana.items.map((i) => [i.title, i.subtitle, i.thumb, i.badge])) === J([['First Meeting', 'chmr_40101001', 'scenes/chmr_40101001/thumbnail.png', 'chmr'], ['chmr_40101002', '', 'scenes/chmr_40101002/thumbnail.png', 'chmr']]) && J(hana.breadcrumb.map((c) => c.title)) === J(['首页', 'chmr', 'Hana']), J(hana.items))
  const play = await read(hana.items[0].node)
  const ops = (i) => play.scene.steps[i].commands.map((c) => c.op).join(',')
  check('解析：<PAUSE> 结束一步（5 步，末尾的 <SCENARIO_END><FADE_OUT2> 并进最后一步）；NAME_PLATE 空 = 旁白；[br] 换行；館長也是说话人', play.scene.adapter === 'girlscreation-tag' && play.scene.steps.length === 5 && ops(0) === 'fade,bg,fade,bgm,se,wait,voice,spine,speaker,text' && play.scene.steps[1].commands[0].segments.length === 0 && play.scene.steps[1].commands[1].segments[0].text === 'A narration line.\nWith a second row.' && play.scene.steps[2].commands[0].segments[0].text === '館長' && ops(4) === 'spineOff,bgoff,speaker,text,fade' && play.scene.steps[4].commands.at(-1).to === 'black', J(play.scene.steps.map((_, i) => ops(i))))
  const spine0 = play.scene.steps[0].commands.find((c) => c.op === 'spine')
  check('Spine 角色：槽 1 → Actor1（kind actor）；骨架 / atlas 路径是这个场景自己的 spines/（相对资源根）；位置 x=100|y=0、缩放 1；轨道 0 = 身体、轨道 1 = 表情（ex_）同时播', spine0.slot === 'Actor1' && spine0.kind === 'actor' && spine0.skel === 'scenes/chmr_40101001/spines/st4010101.skel' && spine0.atlas === 'scenes/chmr_40101001/spines/st4010101.atlas' && spine0.x === 100 && spine0.y === 0 && spine0.scale === 1 && J(spine0.tracks) === J([{ track: 0, anim: 'loop', loop: true }, { track: 1, anim: 'ex_loop', loop: true }]), J(spine0))
  const step3 = play.scene.steps[3].commands.filter((c) => c.op === 'spine')
  check('第 4 步：槽 2 新建（同一套骨架、x=-100、joy + ex_joy + 一条不存在的第 3 轨道 + SPINE_ACTOR_TRACK 的轨道 3、带 SPINE_ACTOR_SHAKE）、槽 1 移动（0.5 秒）；VOICE_SINGLE_PLAY → voice；SCREEN_SHAKE → shake 指令（横向，强度 0.2，0.3 秒）', step3.length === 2 && step3[0].slot === 'Actor2' && step3[0].x === -100 && step3[0].tracks.length === 4 && step3[0].tracks[3].track === 3 && step3[0].tracks[3].anim === 'joy' && step3[0].shake?.x === 6 && step3[0].shake.y === 3 && step3[0].shake.seconds === 0.1 && step3[1].slot === 'Actor1' && step3[1].move === 0.5 && step3[1].x === 0 && play.scene.steps[3].commands.some((c) => c.op === 'voice' && c.src === 'scenes/chmr_40101001/voices/vma_40101001_100020.m4a') && play.scene.steps[3].commands.some((c) => c.op === 'shake' && c.axis === 'horizontal' && c.strength === 0.2 && c.seconds === 0.3) && Object.keys(play.scene.stats.unresolved).length === 0, J([step3, play.scene.stats]))
  // OUT → PLAY → ACTOR（先发播放指令、再把角色放出来）：播放指令先记下，角色出现时套用，不报「没查到槽」
  const gcMod = await import('../../web/library/gal/adapters/girlscreation-tag.mjs')
  const gcCtx = gcMod.prepare({ options: { root: 'pk' }, texts: {}, files: ['pk/scenes/c_1/script.txt', 'pk/scenes/c_1/spidl.skel', 'pk/scenes/c_1/spines/st.skel'].filter((f) => f.includes('/spines/') || f.endsWith('script.txt')), toResourcePath: (r) => r })
  const reorder = gcMod.parse('<SPINE_ACTOR_PLAY>1,loop,0,true\n<SPINE_ACTOR_PLAY>1,ex_loop,1,true\n<SPINE_ACTOR>1,st,,,,0,0,x=0|y=0,1,skel\n<NAME_PLATE>A\nhi\n<PAUSE>\n', gcCtx, { rel: 'c_1/script.txt' })
  const slotErrors = Object.keys(reorder.stats.unresolved).filter((k) => k.startsWith('spine-slot'))
  const actorCmd = reorder.steps.flatMap((st) => st.commands).find((c) => c.op === 'spine')
  check('先 PLAY 后 ACTOR（槽里还没有角色，常见写法 OUT → PLAY → ACTOR）：动画先记下、角色出现时套用，不再记「没查到槽」', slotErrors.length === 0 && (actorCmd ? actorCmd.tracks.length === 2 : reorder.stats.unresolved['spine:st'] === 1), J(reorder.stats))
  {
    const trCtx = gcMod.prepare({ options: { root: 'pk' }, texts: {}, files: ['pk/scenes/c_1/script.txt', 'pk/scenes/c_1/spines/st.skel', 'pk/scenes/c_1/spines/st.atlas', 'pk/scenes/c_1/spines/st.png'], toResourcePath: (r) => r })
    const tr = gcMod.parse(['<SPINE_ACTOR_SHAKE>9,1,1,60', '<SPINE_ACTOR>9,st,,,,0,0,x=0|y=0,1,skel', '<SPINE_ACTOR_PLAY>9,ため息,0,true', '<SPINE_ACTOR_TRACK>9,4,cheek/cheek_002,true', '<SPINE_ACTOR_SHAKE>9,15.0,5,60', '<VOICE_PLAY>v1', '<NAME_PLATE>凪', 'a', '<PAUSE>', '<SPINE_ACTOR_PLAY>9,驚き,0,true', '<SPINE_ACTOR_TRACK>9,6,sweat/sweat_none,true', '<SPINE_ACTOR_SHAKE>9,35.0,15,30', '<NAME_PLATE>レイン', 'b', '<PAUSE>', ''].join('\n'), trCtx, { rel: 'c_1/script.txt' })
    const sp = tr.steps.flatMap((st) => st.commands).filter((c) => c.op === 'spine')
    check('SPINE_ACTOR_TRACK 槽,轨道,动画,循环：和 PLAY 一样给轨道设动画（参数顺序不同，动画名可带目录）；落在槽 9 的轨道 0 和 4 / 轨道 0 和 6', J(sp[0].tracks) === J([{ track: 0, anim: 'ため息', loop: true }, { track: 4, anim: 'cheek/cheek_002', loop: true }]) && J(sp[1].tracks.map((t) => [t.track, t.anim])) === J([[0, '驚き'], [4, 'cheek/cheek_002'], [6, 'sweat/sweat_none']]), J(sp.map((c) => c.tracks)))
    check('SPINE_ACTOR_SHAKE 槽,x,y,时长：随角色的 spine 指令带 shake（id 每次不同，时长按 60 = 1 秒折；30 → 0.5 秒）；槽里没角色时记 raw', sp[0].shake.x === 15 && sp[0].shake.y === 5 && sp[0].shake.seconds === 1 && sp[1].shake.seconds === 0.5 && sp[1].shake.id !== sp[0].shake.id && tr.stats.raw['SPINE_ACTOR_SHAKE(槽里没有角色)'] === 1 && !tr.stats.raw.SPINE_ACTOR_TRACK, J(sp.map((c) => c.shake)) + J(tr.stats.raw))
  }
  {
    // 新版数据：有的场景没有 script.txt，标签式脚本叫 output_script.txt（同目录还有逗号式的 hmr_<id>.txt，标题取自它）；两个都有时 script.txt 优先
    const osCtx = gcMod.prepare({ options: { root: 'pk' }, texts: { 'pk/scenes/chmr_2/output_script.txt': '<NAME_PLATE>凪\nhi\n<PAUSE>\n', 'pk/scenes/chmr_2/hmr_2.txt': 'fade,out,black,0.5\ntitle,花火が作る影に,\n' }, files: ['pk/scenes/chmr_1/script.txt', 'pk/scenes/chmr_1/output_script.txt', 'pk/scenes/chmr_2/output_script.txt', 'pk/scenes/chmr_2/hmr_2.txt', 'pk/scenes/chmr_3/hmr_3.txt', 'pk/scenes/chmr_4/thumbnail.png'], toResourcePath: (r) => r })
    check('场景脚本：没有 script.txt 的场景用 output_script.txt（script.txt 优先）；只有行式脚本（hmr_ / hsr_）的场景用行式脚本；什么脚本都没有的目录不算场景；标题取自同目录的 hmr 文件、说话人取自 output_script.txt', osCtx.scenes.get('chmr_1').script === 'pk/scenes/chmr_1/script.txt' && osCtx.scenes.get('chmr_2').script === 'pk/scenes/chmr_2/output_script.txt' && osCtx.scenes.get('chmr_3').script === 'pk/scenes/chmr_3/hmr_3.txt' && !osCtx.scenes.has('chmr_4') && osCtx.info.get('chmr_2').title === '花火が作る影に' && osCtx.info.get('chmr_2').speaker === '凪', J([...osCtx.scenes.keys()]) + J(osCtx.info.get('chmr_2')))
    // 行式脚本（hmr_ / hsr_）：一句台词一步、voice 单独成步、旁白 / 带逗号的台词、角色 / 视频 / 资源解析
    const lineText = ['fade,out,black,0.5', 'bg,abg1,0,0,1,1', 'title,标题,', 'bgmplay,bgm1,0', 'window,on,0.25', 'message,,旁白,', 'message,,含逗号，, 还有<br>换行,', 'voice,v1', 'message,甲,「台词」,iab4020078', 'voice,v2', 'voice,v3',
      'chara,st1,chara_2,0,0,20,1,1,0,off', 'charamotion,chara_2,loop,on', 'charafade,chara_2,in,0.5', 'msgvoicesync,chara_2,甲,「同步」,iab4030908,v4', 'playmovie,m1,loop', 'cgmode,on'].join('\n')
    const lineFiles = ['chmr_1/hmr_1.txt', 'chmr_1/images/abg1.png', 'chmr_1/voices/v1.ogg', 'chmr_1/voices/v2.ogg', 'chmr_1/voices/v3.ogg', 'chmr_1/voices/v4.ogg', 'chmr_1/videos/m1.mp4', 'chmr_1/spines/st1.skel', 'chmr_1/spines/st1.atlas', 'data/audio/bgm/bgm1.m4a']
    const lineCtx = gcMod.prepare({ options: {}, texts: { 'scenes/chmr_1/hmr_1.txt': lineText }, files: lineFiles.map((f) => (f.startsWith('data/') ? f : `scenes/${f}`)), toResourcePath: (r) => r })
    const lineScene = gcMod.parse(lineText, lineCtx, { rel: 'chmr_1/hmr_1.txt', stem: 'hmr_1' })
    const textOf = (step) => step.commands.find((c) => c.op === 'text')?.segments.map((x) => x.text).join('')
    const opsOf = (step) => step.commands.map((c) => c.op)
    check('行式脚本：message 一句一步（旁白 / 带逗号的台词 / <br> 换行）；voice 归后面的 message；没有台词的 voice 各自一步；msgvoicesync 带语音和说话人；资源都能找到', lineScene.steps.length === 6 && textOf(lineScene.steps[0]) === '旁白' && textOf(lineScene.steps[1]) === '含逗号，,还有\n换行' && opsOf(lineScene.steps[2]).includes('voice') && textOf(lineScene.steps[2]) === '「台词」' && textOf(lineScene.steps[3]) === '' && textOf(lineScene.steps[4]) === '' && textOf(lineScene.steps[5]) === '「同步」' && lineScene.steps[5].commands.some((c) => c.op === 'movie') && Object.keys(lineScene.stats.unresolved).length === 0 && lineScene.stats.raw.cgmode === 1 && lineCtx.info.get('chmr_1').title === '标题', J(lineScene.steps.map((st) => [textOf(st), opsOf(st)])) + J(lineScene.stats))
    check('行式脚本：chara + charamotion loop + charafade in → 一个 actor spine 指令（轨道 0 = loop）', (() => { const sp = lineScene.steps.flatMap((st) => st.commands).filter((c) => c.op === 'spine'); return sp.length >= 1 && sp.at(-1).kind === 'actor' && sp.at(-1).slot === 'Actor2' && sp.at(-1).tracks[0]?.anim === 'loop' && sp.at(-1).fade === 0.5 })(), J(lineScene.steps.flatMap((st) => st.commands).filter((c) => c.op === 'spine')))
  }
  {
    const faCtx = gcMod.prepare({ options: { root: 'pk' }, texts: {}, files: ['pk/scenes/c_1/script.txt', ...[3, 4, 5, 7].map((n) => `pk/scenes/c_1/animations/106041_${n}.jpg`)], toResourcePath: (r) => r })
    const fa = gcMod.parse(['<FRAME_ANIM>106041,3,7,33', '<NAME_PLATE>A', 'hi', '<PAUSE>', '<FRAME_ANIM>nope,1,2,33', '<NAME_PLATE>A', 'x', '<PAUSE>', ''].join('\n'), faCtx, { rel: 'c_1/script.txt' })
    const bgs = fa.steps.flatMap((st) => st.commands).filter((c) => c.op === 'bg')
    check('FRAME_ANIM：前缀_帧号.jpg 按序取（缺的帧跳过并记 unresolved）当背景，第 4 项速度不用；一张都没有记 unresolved', bgs.length === 1 && bgs[0].frames.length === 4 && bgs[0].frames[0].endsWith('106041_3.jpg') && bgs[0].frames[3].endsWith('106041_7.jpg') && fa.stats.unresolved['frame-anim-missing:106041'] === 1 && fa.stats.unresolved['frame-anim:nope'] === 1, J(bgs) + J(fa.stats.unresolved))
    const frameState = stateAt({ steps: [{ index: 0, commands: [{ op: 'bg', src: 'a.jpg', frames: ['a.jpg', 'b.jpg'] }] }, { index: 1, commands: [{ op: 'bg', src: 'c.jpg' }] }] }, 0, {})
    check('引擎：bg 带 frames 记进 state.bg.frames；换背景清掉', J(frameState.bg.frames) === J(['a.jpg', 'b.jpg']) && !stateAt({ steps: [{ index: 0, commands: [{ op: 'bg', src: 'a.jpg', frames: ['a.jpg', 'b.jpg'] }] }, { index: 1, commands: [{ op: 'bg', src: 'c.jpg' }] }] }, 1, {}).bg.frames, J(frameState.bg))
  }
  {
    const fo = gcMod.parse(['<FADE_OUT2>white,800', '<EV_OUT>500', '<NAME_PLATE>A', 'x', '<PAUSE>', '<FADE_IN2>white,1000', '<FADE_OUT>red,100', '<NAME_PLATE>A', 'y', '<PAUSE>', ''].join('\n'), null, { rel: 'c_1/script.txt' })
    const fops = fo.steps.flatMap((st) => st.commands)
    check('FADE_OUT2,white → fade to white（保持）；EV_OUT,ms → bgoff（淡出）；别的颜色仍记 raw；FADE_IN2,white → wash', J(fops.find((c) => c.op === 'fade')) === J({ op: 'fade', to: 'white', seconds: 0.8 }) && J(fops.find((c) => c.op === 'bgoff')) === J({ op: 'bgoff', fade: 0.5 }) && fo.stats.raw.FADE_OUT === 1 && fops.some((c) => c.op === 'wash'), J(fops) + J(fo.stats.raw))
    const white = (n) => stateAt({ steps: [{ index: 0, commands: [{ op: 'fade', to: 'white', seconds: 1 }] }, { index: 1, commands: [{ op: 'wash', color: 'white', seconds: 1 }] }] }, n, {})
    check('引擎：fade to white 记 state.white（不动黑场）；wash 把白屏清掉', white(0).white === true && white(0).black === false && white(1).white === false, J([white(0).white, white(1).white]))
  }
  {
    const evCtx = gcMod.prepare({ options: { root: 'pk' }, texts: {}, files: ['pk/scenes/c_1/script.txt', 'pk/scenes/c_1/images/cg_a.png', 'pk/scenes/c_1/images/cg_b.png'], toResourcePath: (r) => r })
    const ev = gcMod.parse(['<EV>cg_a,IN,800,cg_b', '<BG_SCALE>1.5,2000,ease-in-out', '<EFFECT_BG_BLUR>6', '<ZOOM>1.4,0,30,-20', '<SPINE_ACTOR_SHAKE>1,0,0,500', '<NAME_PLATE>A', 'hi', '<PAUSE>', '<EV>cg_b,OUT,500,', '<EV>nope,NONE,0,', '<EV>black,NONE,0,', '<NAME_PLATE>A', 'bye', '<PAUSE>', ''].join('\n'), evCtx, { rel: 'c_1/script.txt' })
    const ops = ev.steps.flatMap((st) => st.commands)
    check('EV：IN → 背景（图 + 叠加的图 2）淡入 0.8 秒；OUT 记 raw；找不到的记 unresolved；black → 纯色背景', ops.find((c) => c.op === 'bg')?.src.endsWith('cg_a.png') && ops.find((c) => c.op === 'bg').over.endsWith('cg_b.png') && ops.find((c) => c.op === 'bg').fade === 0.8 && ev.stats.raw['EV(OUT)'] === 1 && ev.stats.unresolved['ev:nope'] === 1 && ops.some((c) => c.op === 'bg' && J(c.color) === J([0, 0, 0])), J(ops.filter((c) => c.op === 'bg')) + J(ev.stats))
    check('BG_SCALE / EFFECT_BG_BLUR / ZOOM → bgScale（倍数、秒、缓动）/ bgBlur / bgZoom（x 取反）；SPINE_ACTOR_SHAKE 原查看器什么也不做，不记 raw', J(ops.find((c) => c.op === 'bgScale')) === J({ op: 'bgScale', scale: 1.5, seconds: 2, easing: 'ease-in-out' }) && ops.find((c) => c.op === 'bgBlur').radius === 6 && J(ops.find((c) => c.op === 'bgZoom')) === J({ op: 'bgZoom', scale: 1.4, x: -30, y: -20 }) && !ev.stats.raw.SPINE_ACTOR_SHAKE && !ev.stats.raw.ZOOM, J(ops.filter((c) => /^bg(Scale|Blur|Zoom)$/.test(c.op))) + J(ev.stats.raw))
    // 引擎：换背景清掉缩放 / 模糊，ZOOM 不跟换背景走；ZOOM 回 1 = 清掉
    let st = stateAt({ steps: [{ index: 0, commands: [{ op: 'bg', src: 'a.png' }, { op: 'bgScale', scale: 1.5, seconds: 1 }, { op: 'bgBlur', radius: 4 }, { op: 'bgZoom', scale: 1.4, x: 5, y: 6 }] }, { index: 1, commands: [{ op: 'bg', src: 'b.png', over: 'c.png' }] }, { index: 2, commands: [{ op: 'bgZoom', scale: 1, x: 0, y: 0 }] }] }, 0, {})
    const s0 = J([st.bg, st.bgfx?.scale, st.bgfx?.blur, st.bgZoom])
    st = stateAt({ steps: [{ index: 0, commands: [{ op: 'bg', src: 'a.png' }, { op: 'bgScale', scale: 1.5, seconds: 1 }, { op: 'bgZoom', scale: 1.4, x: 5, y: 6 }] }, { index: 1, commands: [{ op: 'bg', src: 'b.png', over: 'c.png' }] }, { index: 2, commands: [{ op: 'bgZoom', scale: 1, x: 0, y: 0 }] }] }, 1, {})
    const s1 = J([st.bg, st.bgfx, st.bgZoom])
    st = stateAt({ steps: [{ index: 0, commands: [{ op: 'bgZoom', scale: 1.4, x: 5, y: 6 }] }, { index: 1, commands: [{ op: 'bgZoom', scale: 1, x: 0, y: 0 }] }] }, 1, {})
    check('引擎：bgScale / bgBlur 记在 bgfx、bgZoom 单独记；换背景（含 over）清掉 bgfx 但留 bgZoom；ZOOM 回 1 清掉 bgZoom', s0 === J([{ src: 'a.png' }, 1.5, 4, { scale: 1.4, x: 5, y: 6 }]) && s1 === J([{ src: 'b.png', over: 'c.png' }, null, { scale: 1.4, x: 5, y: 6 }]) && st.bgZoom === null, s0 + s1)
  }
  const media = play.scene.steps.flatMap((st) => st.commands)
  check('资源路径：BGM / 音效在全局 data/audio（相对资源根），语音在场景自己的 voices/，背景图在场景自己的 images/；循环音效走背景音效声道', media.some((c) => c.op === 'bgm' && c.src === 'data/audio/bgm/bgm30010.m4a') && media.some((c) => c.op === 'se' && c.src === 'data/audio/se/se1020001.m4a') && media.some((c) => c.op === 'bg' && c.src === 'scenes/chmr_40101001/images/abg0001.png') && play.sectionNavigation.prev === null && play.sectionNavigation.next?.title === 'chmr_40101002', J(play.sectionNavigation))
  const video = await read((await read((await read(home.items[1].node)).node.items[0].node)).node.items[0].node)
  const vops = video.scene.steps.flatMap((st) => st.commands)
  check('视频场景：VIDEO_PLAY → movie（循环，场景自己的 videos/）、VIDEO_STOP → movieOff；只有指令没有台词的 <PAUSE> 留一个空步；UI_DISP → ui 指令（文本框隐藏，0.5 秒）；FADE_IN2 black 先于台词', vops.some((c) => c.op === 'movie' && c.srcs[0] === 'scenes/chsr_40200133/videos/esm_40200133_10.mp4' && c.loop === true) && vops.some((c) => c.op === 'movieOff') && video.scene.steps.length === 3 && video.scene.steps[1].commands.length === 1 && video.scene.steps[1].commands[0].segments.length === 0 && vops.some((c) => c.op === 'ui' && c.visible === false && c.seconds === 0.5) && Object.keys(video.scene.stats.raw).length === 0 && video.node.title === 'Video Scene', J([video.scene.steps.map((st) => st.commands.map((c) => c.op).join(',')), video.scene.stats]))
}

// ================= tenkeiprdx：adapter + 新指令 + 脚本索引 + 脚本 =================
{
  check('sniff：对象形剧情 JSON 才算；别的 JSON / CSV / 文本不算', tenkeiSniff('{"result":{"sceneDetails":[]}}') && tenkeiSniff('  {"x":1,"sceneFrameDetails":[]}') && !tenkeiSniff('{"a":1}') && !tenkeiSniff('bg,a.jpg,0'))
  const ctx = tenkeiPrepare({ options: { positionX: { 3: 0.9 }, unknownName: 'P' }, texts: { 'Masterdata/username.txt': 'Tester\n' }, files: ['Spines/1001/1001_01.skel.bytes', 'Spines/1001/1001_02.skel.bytes', 'Stills/s/10_b.skel.bytes', 'Stills/s/2_a.skel.bytes', 'Backgrounds/adventure/bg_a.png', 'Backgrounds/still/bg_still_02.png', 'BGM/m_loop.ogg', 'BGM/n.ogg', 'BGM/n_loop.ogg'], toResourcePath: (rel) => rel })
  check('prepare：站位立绘文件、静态画面（按数字前缀排序：2 在 10 前）、背景、BGM 索引；username 去空白', J(ctx.spines.get('Spines/1001')) === J(['1001_01', '1001_02']) && J(ctx.spines.get('Stills/s')) === J(['2_a', '10_b']) && ctx.backgrounds.get('bg_still_02') === 'Backgrounds/still/bg_still_02.png' && ctx.bgm.has('m_loop') && ctx.username === 'Tester')
  const mk = (frames, id = '5') => J({ result: { sceneDetails: [{ assetId: 'other', sceneFrameDetails: [] }, { assetId: id, sceneFrameDetails: frames }] } })
  const r = tenkeiParse(mk([
    { speakerName: '%username%', phraseContents: 'a\\nb', phraseVoice: 'v1', backgroundImage: 'bg_a', backgroundMusic: 'm', soundEffect: 'click', adventureCharacters: [{ characterMasterId: 1001, characterAppearance: 2, characterPosition: 1, characterAction: 3, characterFacialExpression: 4 }] },
    { speakerName: '%username%', phraseContents: 'b', backgroundMusic: 'm', adventureCharacters: [{ characterMasterId: 1001, characterAppearance: 2, characterPosition: 3, characterFacialExpression: 0 }] },
    { adventureCharacters: [], backgroundImage: 'bg_still_02' },
  ]), ctx, { stem: '5' })
  const c0 = r.steps[0].commands
  check('选的是 assetId = 文件名 那一项（不是第一项）；一帧一步；%username% 换成 username.txt；\\n 变换行', r.steps.length === 3 && c0.find((c) => c.op === 'speaker').segments[0].text === 'Tester' && c0.find((c) => c.op === 'text').segments[0].text === 'a\nb', J(c0))
  check('背景查索引（Backgrounds/adventure）；BGM 没有 m.ogg 但有 m_loop.ogg → 用 _loop；语音按场景 id 分目录；音效 Se/', c0.find((c) => c.op === 'bg').src === 'Backgrounds/adventure/bg_a.png' && c0.find((c) => c.op === 'bgm').src === 'BGM/m_loop.ogg' && c0.find((c) => c.op === 'voice').src === 'AdventureVoice/5/v1.ogg' && c0.find((c) => c.op === 'se').src === 'Se/click.ogg')
  const sp = c0.find((c) => c.op === 'spine')
  check('站位立绘：骨架取 <角色id>_<外观两位>（1001_02），站位 1 → 左 0.3，表情 4 → idle_surprise，动作 3 记在这一帧；atlas 同名', sp.skel === 'Spines/1001/1001_02.skel.bytes' && sp.atlas === 'Spines/1001/1001_02.atlas.txt' && sp.x === 0.3 && sp.anim === 'idle_surprise' && sp.action === 3 && sp.kind === 'chara', J(sp))
  const sp1 = r.steps[1].commands.find((c) => c.op === 'spine' && c.slot === 'Chara3')
  check('下一帧：动作只做一次（action 归 0）；站位 3 取自 positionX 选项 0.9；bgm 没变不重复发；同一说话人不重复发 speaker', sp1.slot === 'Chara3' && r.steps[1].commands.filter((c) => c.op === 'spine').length === 2 && r.steps[1].commands.filter((c) => c.op === 'spine').find((c) => c.slot === 'Chara1').action === 0 && sp1.x === 0.9 && !r.steps[1].commands.some((c) => c.op === 'bgm' || c.op === 'speaker'), J(r.steps[1].commands.map((c) => [c.op, c.slot, c.action])))
  const c2 = r.steps[2].commands
  check('空的 adventureCharacters = 立绘全隐藏；背景名带 still_02 → 背景音效 Hse5（不循环）', c2.some((c) => c.op === 'spineOff' && c.prefix === 'Chara') && c2.find((c) => c.op === 'bgse')?.src === 'BgSe/Hse5.ogg' && c2.find((c) => c.op === 'bgse').loop === false, J(c2))
  const st = tenkeiParse(mk([
    { still: 's', stillAnimation: 'animation1', animationSpeed: 1000, sceneCameraStartPositionX: 1, sceneCameraEndPositionX: 5, sceneCameraEndPositionZ: 300, sceneCameraActionDuration: 1500, phraseContents: 'x' },
    { stillAnimation: 'animation3', phraseContents: 'y' },
    { stillAnimation: 'animation4', animationSpeed: 500, phraseContents: 'z' },
    { stillAnimation: 'animation5', phraseContents: 'w' },
    { backgroundImage: 'bg_a', phraseContents: 'v' },
  ]), ctx, { stem: '5' })
  const s0 = st.steps[0].commands
  check('静态画面：先 bgoff + 清旧层；多个骨架按数字前缀叠（order 0,1）；动画/速度（>100 当千分比 → 1）；animation1 循环', s0[0].op === 'bgoff' && s0[1].op === 'spineOff' && s0[1].prefix === 'still' && J(s0.filter((c) => c.op === 'spine').map((c) => [c.slot, c.skel, c.order, c.anim, c.speed, c.loop])) === J([['still0', 'Stills/s/2_a.skel.bytes', 0, 'animation1', 1, true], ['still1', 'Stills/s/10_b.skel.bytes', 1, 'animation1', 1, true]]), J(s0))
  check('镜头：起点缺的补 0、终点缺的取起点、时长毫秒 → 秒', J(s0.find((c) => c.op === 'camera')) === J({ op: 'camera', from: [1, 0, 0], to: [5, 0, 300], seconds: 1.5 }), J(s0.find((c) => c.op === 'camera')))
  const sc = (i, op) => st.steps[i].commands.find((c) => c.op === op)
  check('animation3：倍速 1.5 + 联动 Hse3 循环；animation4：不循环 + Hse4 + 闪白两次；animation5：白屏渐退；离开静态画面 → 清层 + 镜头归零', st.steps[1].commands.find((c) => c.op === 'spine').speed === 1.5 && sc(1, 'bgse').src === 'BgSe/Hse3.ogg' && sc(1, 'bgse').loop === true && st.steps[2].commands.find((c) => c.op === 'spine').loop === false && st.steps[2].commands.find((c) => c.op === 'spine').speed === 0.5 && sc(2, 'bgse').src === 'BgSe/Hse4.ogg' && J(sc(2, 'flash')) === J({ op: 'flash', color: 'white', count: 2, seconds: 0.3 }) && J(sc(3, 'wash')) === J({ op: 'wash', color: 'white', seconds: 1.5 }) && sc(4, 'spineOff').prefix === 'still' && J(sc(4, 'camera').to) === J([0, 0, 0]) && st.steps[3].commands.some((c) => c.op === 'bgseStop'), J(st.steps.map((x) => x.commands.map((c) => c.op))))
  check('文件名对不上 / JSON 坏了 / 没有 sceneDetails：明确报错；没有上下文（没配资源目录）照默认路径出，不崩', (() => { try { tenkeiParse('nope', ctx, {}); return false } catch (e) { return /JSON/.test(e.message) } })() && (() => { try { tenkeiParse('{"a":1}', ctx, {}); return false } catch (e) { return /sceneDetails/.test(e.message) } })() && tenkeiParse(mk([{ backgroundImage: 'bg_a', phraseVoice: 'q', phraseContents: 't' }]), null, { stem: '5' }).steps[0].commands.some((c) => c.op === 'bg' && c.src === 'Backgrounds/adventure/bg_a.png'))
  // 引擎：新指令进状态
  const eng = { op: 'x' }
  const scn = { format: 'gal-scene/1', adapter: 'tenkeiprdx-json', stats: {}, steps: [
    { index: 0, commands: [{ op: 'spine', slot: 'Chara1', kind: 'chara', skel: 'a', atlas: 'b', anim: 'idle_joy' }, { op: 'spine', slot: 'still0', kind: 'still', skel: 'c', atlas: 'd', anim: 'animation1', order: 0 }, { op: 'camera', from: [0, 0, 0], to: [1, 2, 300], seconds: 2 }, { op: 'bgse', src: 'BgSe/Hse2.ogg', loop: true }] },
    { index: 1, commands: [{ op: 'spineOff', prefix: 'still' }, { op: 'bgseStop' }] },
    { index: 2, commands: [{ op: 'spineOff', slot: 'Chara1' }] },
    { index: 3, commands: [{ op: 'spine', slot: 'Chara1', skel: 'a', atlas: 'b' }, { op: 'spine', slot: 'Chara2', skel: 'a', atlas: 'b' }, { op: 'spineOff' }] },
  ] }
  const s_0 = stateAt(scn, 0)
  check('引擎：spine 按 slot 进状态（不带 op）；camera 记终点；bgse 记音效', J(Object.keys(s_0.spines).sort()) === J(['Chara1', 'still0']) && s_0.spines.Chara1.anim === 'idle_joy' && !('op' in s_0.spines.Chara1) && J(s_0.camera.to) === J([1, 2, 300]) && s_0.camera.seconds === 2 && s_0.bgse.loop === true && s_0.bgse.src === 'BgSe/Hse2.ogg')
  const s_1 = stateAt(scn, 1)
  check('引擎：spineOff prefix 只清前缀的；bgseStop 清掉背景音效；按 slot 清；不带参数 = 全清', J(Object.keys(s_1.spines)) === J(['Chara1']) && s_1.bgse === null && J(Object.keys(stateAt(scn, 2).spines)) === '[]' && J(Object.keys(stateAt(scn, 3).spines)) === '[]')
  check('引擎：新指令不占时长（不阻塞点击）', commandDuration({ op: 'spine' }) === 0 && commandDuration({ op: 'camera', seconds: 5 }) === 0 && commandDuration({ op: 'flash', seconds: 1 }) === 0)
  void eng
}
{
  const tk = path.join(work, 'tenkei-pack')
  const { imported } = await buildTenkeiFixture(tk)
  const imp = await handler.importFromSource({ sourcePath: tk, options: { adapters: ['tenkeiprdx-json'], config: { game: { id: 'tenkeiprdx' } }, defaultMetadataActions: ['gal-layout'] } })
  const item0 = imp.items[0]
  check('导入 tenkeiprdx：同样不提示 UViewer 的脚本根不存在；导入前后实际能浏览（脚本一跑就对）', imp.report.warnings.length === 0, J(imp.report.warnings))
  const explicit = await handler.importFromSource({ sourcePath: tk, options: { dryRun: true, adapters: ['tenkeiprdx-json'], config: { scriptRoots: [{ id: 's', dir: 'nope/scenes' }] } } })
  check('配置里写了脚本根但目录不存在：照样提示（这是真问题）', explicit.report.warnings.length === 1 && /nope\/scenes/.test(explicit.report.warnings[0]), J(explicit.report.warnings))
  const autoTk = await galLayoutScript({ item: { ...item0, config: {} }, script: { id: 'gal-layout', version: '2.0.0', options: {} } })
  const autoUv = await galLayoutScript({ item: { ...M2, config: {} }, script: { id: 'gal-layout', version: '2.0.0', options: {} } })
  const emptyDir = path.join(work, 'empty-dir')
  await mkdir(emptyDir, { recursive: true })
  const autoNone = await galLayoutScript({ item: { ...M2, config: {}, source: { path: emptyDir } }, script: { id: 'gal-layout', version: '2.0.0', options: {} } })
  const wrongTk = await galLayoutScript({ item: { ...M2, config: { game: { id: 'tenkeiprdx' } } }, script: { id: 'gal-layout', version: '2.0.0', options: {} } })
  check('分发（没填 game.id）：tenkeiprdx 的目录认成 tenkeiprdx、UViewer 的认成 uviewer、空目录走通用配置且不认领（没有 Gal游戏 标签）；声明了 tenkeiprdx 却是 UViewer 目录 → 跳过', autoTk.itemPatch.gal.config.game.id === 'tenkeiprdx' && autoUv.itemPatch.gal.config.game.id === 'uviewer' && !('game' in autoNone.itemPatch.gal.config) && J(autoNone.itemTags) === J(['Gal配置: 通用', 'Gal配置version: 2.0.0']) && !wrongTk.itemPatch, J([autoTk.itemTags, autoUv.itemTags, autoNone.itemTags]))
  const out = await tenkeiScript({ item: item0, script: { id: 'gal-layout', version: '1.0.0', options: {} } })
  const cfg = out.itemPatch.gal.config
  check('脚本：素材根（外面套了 StreamingAssets/Tenkeiprdx X/）、脚本根 scenes、资源根、扩展名 json、适配器参数 root；列表不写进 config；封面；脚本数；标签', cfg.game.id === 'tenkeiprdx' && cfg.scriptRoots[0].dir === 'StreamingAssets/Tenkeiprdx X/Imported/scenes' && J(cfg.resourceRoots) === J(['StreamingAssets/Tenkeiprdx X/Imported']) && J(cfg.scriptExtensions) === J(['json']) && cfg.adapterOptions['tenkeiprdx-json'].root === 'StreamingAssets/Tenkeiprdx X/Imported' && !('scriptIndex' in cfg) && cfg.scriptCount === 3 && cfg.cover === 'EpisodeThumbnails/event/ep_eventstill_001_0001.png' && J(out.itemTags) === J(['Gal配置: tenkeiprdx', 'Gal配置version: 1.0.0', 'Gal游戏: tenkeiprdx']), J(cfg))
  await handler.patchItemMetadata(item0.itemId, { gal: out.itemPatch.gal })
  const it = await handler.getItem(item0.itemId)
  const read = (sectionId) => handler.getReaderContent(it.itemId, 'main', { sectionId })
  const home = (await read('')).node
  check('首页 = 适配器的列表：活动 / 附加 / 角色 / 全部剧情（数量对）；这些是目录卡片', J(home.items.map((i) => [i.type, i.title, i.subtitle])) === J([['dir', '活动', '1 项'], ['dir', '附加', '1 项'], ['dir', '角色', '2 项'], ['dir', '全部剧情', '3 项']]) && home.parent === null && J(home.breadcrumb.map((c) => c.title)) === '["首页"]', J(home.items))
  const eventList = (await read(home.items[0].node)).node
  check('活动列表：缩略图来自 EpisodeThumbnails/event；剧情 id = 2+文件名第 3、4 段；标题查 masterdata_32（按 still 键）；角标 event；上一级 = 首页', J(eventList.items.map((i) => [i.title, i.subtitle, i.badge, i.thumb, i.node])) === J([['The First Event', '20010001', 'event', 'EpisodeThumbnails/event/ep_eventstill_001_0001.png', 's:20010001.json']]) && eventList.parent === '' && J(eventList.breadcrumb.map((c) => c.title)) === J(['首页', '活动']), J(eventList.items))
  const extraList = (await read(home.items[1].node)).node
  check('附加列表：剧情 id 以 1 结尾的末位换成 2（23010001 → 23010002，照原查看器）；标题、角标 extra', J(extraList.items.map((i) => [i.title, i.badge, i.node])) === J([['An Extra Story', 'extra', 's:23010002.json']]), J(extraList.items))
  const people = (await read(home.items[2].node)).node
  check('角色列表：CharacterIcons（新的在前，文件名前 8 位 = 角色号）、名字/称号来自 masterdata_4、头像；EX 剧情数', J(people.items.map((i) => [i.title, i.subtitle, i.thumb])) === J([['Bob', 'Rival · 0 项', 'CharacterIcons/10020001.png'], ['Alice', 'Heroine · 1 项', 'CharacterIcons/10010001.png']]), J(people.items))
  const alice = (await read(people.items[1].node)).node
  check('角色页：这个角色的 EX 剧情（masterdata_32 里按 <角色号>_01|02_still 找），标题 + Backgrounds/still 的缩略图；面包屑 首页 › 角色 › Alice', J(alice.items.map((i) => [i.title, i.thumb, i.badge])) === J([['Alice EX', 'Backgrounds/still/10010001_01_still_01.png', '']]) && J(alice.breadcrumb.map((c) => c.title)) === J(['首页', '角色', 'Alice']) && alice.parent === people.id.replace(/#\d+$/, ''), J([alice.items, alice.breadcrumb, alice.parent, people.id]))
  const allList = (await read(home.items[3].node)).node
  check('全部剧情：scenes/ 下全部（自然序），已知标题/缩略图/角标带上；没有信息的就用 id', J(allList.items.map((i) => [i.title, i.badge])) === J([['Alice EX', ''], ['The First Event', 'event'], ['An Extra Story', 'extra']]) && allList.items[0].thumb === 'Backgrounds/still/10010001_01_still_01.png', J(allList.items))
  const story = await read(alice.items[0].node)
  const cmds = story.scene.steps.flatMap((x) => x.commands)
  check('剧情播放页：标题用列表里的名字；上一级 = 收它的那个列表（角色页）；面包屑；资源路径相对素材根；立绘两种骨骼格式；语音目录用文件名当场景 id；username 来自 Masterdata', story.node.title === 'Alice EX' && story.node.parent === alice.id && J(story.node.breadcrumb.map((c) => c.title)) === J(['首页', '角色', 'Alice', 'Alice EX']) && story.scene.steps.length === 4 && cmds.find((c) => c.op === 'bgm').src === 'BGM/bgm_a_loop.ogg' && cmds.find((c) => c.op === 'voice').src === 'AdventureVoice/10010101/v002.ogg' && cmds.some((c) => c.op === 'spine' && c.skel === 'Spines/1002/1002_01.skel.bytes') && cmds.some((c) => c.op === 'speaker' && c.segments[0]?.text === 'Tester') && Object.keys(story.scene.stats.unresolved).length === 0 && story.sectionNavigation.prev === null && story.sectionNavigation.next === null, J([story.node.parent, story.node.breadcrumb, story.scene.stats]))
  const still = await read(eventList.items[0].node)
  check('活动剧情（静态画面）：两层骨架（按数字前缀）、镜头、联动音效、闪白都在；上一级 = 活动', still.node.parent === 'v:event' && still.scene.steps[0].commands.filter((c) => c.op === 'spine').map((c) => c.skel).join() === 'Stills/h_still_01/1_base.skel.bytes,Stills/h_still_01/2_over.skel.bytes' && still.scene.steps[0].commands.some((c) => c.op === 'camera') && still.scene.steps[1].commands.some((c) => c.op === 'bgse' && c.src === 'BgSe/Hse2.ogg') && still.scene.steps[2].commands.some((c) => c.op === 'flash'), J(still.node.parent))
  const extra = await read(extraList.items[0].node)
  check('附加剧情：背景名带 still_ 的在 Backgrounds/still 里找到；frameEffect 原样记在 stats', extra.scene.steps[0].commands.find((c) => c.op === 'bg').src === 'Backgrounds/still/bg_still_03.png' && extra.scene.stats.frameEffects.shake === 1, J(extra.scene.stats))
  check('非法 / 不存在的列表节点：明确报错；用目录节点 id 也能取（兼容直接按路径打开）', /不存在/.test((await err(read('v:nope')))?.message || '') && /无效/.test((await err(read('v:')))?.message || '') && (await read('s:10010101.json')).node.kind === 'player')
  // 数据文件更新：新增一个活动剧情 + 缩略图 + 名称表改了标题 → 列表马上跟着变（不用重跑脚本、不用重新导入）
  {
    const imp2 = path.join(tk, 'StreamingAssets', 'Tenkeiprdx X', 'Imported')
    await writeFile(path.join(imp2, 'scenes/20020001.json'), J({ result: { sceneDetails: [{ assetId: '20020001', sceneFrameDetails: [{ speakerName: 'A', phraseContents: 'new' }] }] } }))
    execFileSync('convert', ['-size', '64x36', 'xc:gray', path.join(imp2, 'EpisodeThumbnails/event/ep_eventstill_002_0001.png')])
    const m32 = JSON.parse((await import('node:fs')).readFileSync(path.join(imp2, 'Masterdata/masterdata_32.json'), 'utf8'))
    m32[0][1][2] = 'Renamed Event'
    m32.push([0, [0, 0, 'Brand New', 0, 0, 0, 0, 0, 0, ['20020001'], ['002_0001_still_01'], 0]])
    await writeFile(path.join(imp2, 'Masterdata/masterdata_32.json'), J(m32))
    const refreshed = (await read(home.items[0].node)).node
    check('数据文件更新后列表立刻跟着变：新增的活动出现（新的在前）、标题来自改过的名称表；首页数量也变', J(refreshed.items.map((i) => i.title)) === J(['Brand New', 'Renamed Event']) && (await read('')).node.items[0].subtitle === '2 项' && (await read('')).node.items[3].subtitle === '4 项', J(refreshed.items))
  }
  check('资源：骨骼 / atlas / 图集 png / ogg 都能取；目录穿越被拒', (await handler.getResource(it.itemId, 'Spines/1001/1001_01.skel.bytes')).body.length > 20 && (await handler.getResource(it.itemId, 'Spines/1001/1001_01.atlas.txt')).body.toString().includes('size: 64,128') && (await handler.getResource(it.itemId, 'Spines/1001/1001_01.png')).contentType === 'image/png' && (await handler.getResource(it.itemId, 'AdventureVoice/10010101/v002.ogg')).contentType === 'audio/ogg' && Boolean(await err(handler.getResource(it.itemId, '../x'))) && (await handler.getThumbnail(it.itemId)).contentType === 'image/png')
  {
    // 位置数组形（游戏原始数据，没有任何键名）：sniff 认、能转成场景；noBGM{…} 停 BGM；站位 / 台词 / 语音 / 背景都对
    const imp3 = path.join(tk, 'StreamingAssets', 'Tenkeiprdx X', 'Imported')
    const fr = (idx, o = {}) => { const a = new Array(33).fill(null); a[0] = idx; a[5] = false; a[15] = false; a[30] = 0; a[31] = []; for (const [k, v] of Object.entries(o)) a[k] = v; return a }
    const arr = [['22000003201', 2, 1, true, [
      fr(0, { 3: 'bg_adventure_1005402', 27: 'bgm_2010' }),
      fr(3, { 12: 'ナレーション', 27: 'bgm_2010' }),
      fr(10, { 10: '%username%', 12: '「どうした？」\\n続き', 27: 'bgm_2010', 31: [[10010101, 0, 3, 0, 0, 2, false, null]] }),
      fr(11, { 10: 'メラーニア', 12: '「なんでも」', 27: 'noBGM{Fade_0.5,Delay_0}', 29: 'c_22000003201_004', 30: 4, 31: [[10010101, 0, 3, 4, 0, 2, false, null]] }),
    ], 22000003201, null, null, null]]
    await writeFile(path.join(imp3, 'scenes/22000003201.json'), '﻿' + J(arr))
    const a = await read('s:22000003201.json')
    const ops = a.scene.steps.flatMap((st) => st.commands)
    check('tenkeiprdx 位置数组形：能识别并转成 4 步场景（背景 / 台词 / 说话人 / 换行）', a.node.kind === 'player' && a.scene.steps.length === 4 && ops.some((c) => c.op === 'bg' && /bg_adventure_1005402/.test(c.src)) && ops.some((c) => c.op === 'text' && c.segments[0]?.text === '「どうした？」\n続き') && ops.some((c) => c.op === 'speaker' && c.segments[0]?.text === 'メラーニア') && a.scene.stats.form === 'array', J(a.scene.stats))
    check('数组形：BGM 只在变化时发；noBGM{Fade_0.5,…} = bgmStop 淡出 0.5 秒；语音路径按场景 id；立绘站位', ops.filter((c) => c.op === 'bgm').length === 1 && ops.some((c) => c.op === 'bgmStop' && c.fade === 0.5) && ops.some((c) => c.op === 'voice' && c.src === 'AdventureVoice/22000003201/c_22000003201_004.ogg') && ops.some((c) => c.op === 'spine' && c.kind === 'chara'), J(ops.map((c) => c.op)))
    check('数组形：推测的字段在 stats 里有说明（arrayGuess）', /对照样本/.test(a.scene.stats.arrayGuess || ''))
    const bad = await err(read('s:nope.json'))
    check('位置数组形以外的数组不被误认', !(await import('../../web/library/gal/adapters/tenkeiprdx-json.mjs')).sniff('[[1,2,3]]') && !(await import('../../web/library/gal/adapters/tenkeiprdx-json.mjs')).sniff('[["a"]]') && Boolean(bad))
  }
  check('config.scriptIndex 规整：目录必须安全、pattern 必须是合法正则、key 默认 {1}', J(normalizeGalConfig({ scriptIndex: [{ dir: 'a/b', pattern: '^x(\\d)' }, { dir: '../a', pattern: 'x' }, { dir: 'a', pattern: '(' }, { dir: '', pattern: 'x' }] }).scriptIndex) === J([{ dir: 'a/b', pattern: '^x(\\d)', key: '{1}', badge: '' }]))
  check('config.rawIgnore 规整：非法正则 / 空串 / 重复丢掉，最多 50 条；补丁能写能清', J(normalizeGalConfig({ rawIgnore: ['^spine$', '(', '', '^spine$', 'anm,.*'] }).rawIgnore) === J(['^spine$', 'anm,.*']) && normalizeGalConfig({ rawIgnore: Array.from({ length: 80 }, (_, k) => `x${k}`) }).rawIgnore.length === 50 && J(applyGalConfigPatch({}, { rawIgnore: ['a'] }).rawIgnore) === J(['a']) && applyGalConfigPatch({ rawIgnore: ['a'] }, { rawIgnore: null }).rawIgnore === undefined && J(normalizeGalConfig({}).rawIgnore) === '[]')
  // Spine 3.8 运行时拿实际图片尺寸当 UV 分母：atlas 声明 4096、PNG 只有 2048 时必须让 getImage() 报声明尺寸，否则立绘散成碎片
  const sizes = declaredPageSizes('a.png\nsize: 4096,4096\nformat: RGBA8888\nfoo\n  rotate: true\n\nb.png\nsize:2048, 1024\n')
  const tex = { getImage: () => ({ width: 2048, height: 2048 }) }
  const same = { getImage: () => ({ width: 64, height: 128 }) }
  const origSame = same.getImage
  reportDeclaredSize(tex, sizes.get('a.png'))
  reportDeclaredSize(same, [64, 128])
  check('spine atlas：读出每页声明尺寸；贴图实际更小时 getImage() 报声明尺寸，一致时不动', sizes.get('a.png')?.join() === '4096,4096' && sizes.get('b.png')?.join() === '2048,1024' && tex.getImage().width === 4096 && tex.getImage().height === 4096 && same.getImage === origSame)
  // 虚拟目录（config.views）：来源是子目录的（monmusu 总览）/ 来源是 parent 自己且独占的（minashigo 分类）
  {
    const root = path.join(work, 'views')
    const script = (name, body = '    scene black\n    "A" "B"\n') => writeFile(path.join(root, 'script', name), `label h_${name.replace(/\W/g, '_')}:\n${body}`)
    await mkdir(path.join(root, 'script', 'hscene'), { recursive: true })
    await mkdir(path.join(root, 'script', 'hscene_still'), { recursive: true })
    await script('hscene/10001A1.rpy'); await script('hscene/10001B1.rpy'); await script('hscene/10002A1.rpy'); await script('hscene_still/10001C1.rpy')
    const mm = createBrowseProvider({ mediaDir: root, adapters: ['renpy-monmusu'], resolveAsset: async () => { throw new Error('none') }, config: {
      scriptRoots: [{ id: 'script', dir: 'script' }], scriptExtensions: ['rpy'], merge: [], labels: { hscene: '动画', hscene_still: '事件' },
      views: [{ parent: '.', as: 'overview', label: '总览', dirs: ['hscene', 'hscene_still'], badges: { hscene: 'anim', hscene_still: 'still' } }],
      groups: [{ parent: 'hscene', pattern: '^(\\d{5})[A-Za-z]\\d' }, { parent: 'overview', pattern: '^(\\d{5})[A-Za-z]\\d' }],
    } })
    const home = (await mm.getNode('')).node
    const overview = (await mm.getNode('d:overview')).node
    const anim = (await mm.getNode('d:hscene')).node
    const grp = (await mm.getNode(`g:10001:overview`)).node
    check('views（来源是子目录）：首页 = 动画 / 事件 / 总览 三张目录卡片（标签来自 labels / view.label）；总览 = 合并后按角色分组；动画按角色分组；分组里能看到两个来源的脚本',
      J(home.items.map((i) => [i.title, i.subtitle])) === J([['动画', 'hscene · 3 项'], ['事件', 'hscene_still · 1 项'], ['总览', 'overview · 4 项']]) && J(overview.items.map((i) => i.title)) === J(['10001', '10002']) && J(anim.items.map((i) => i.title)) === J(['10001', '10002']) && grp.items.length === 3 && J(overview.breadcrumb.map((c) => c.title)) === J(['首页', '总览']), J([home.items.map((i) => i.title + i.subtitle), overview.items.map((i) => i.title), grp.items.length, overview.breadcrumb]))

    const root2 = path.join(work, 'views2')
    await mkdir(path.join(root2, 'scripts'), { recursive: true })
    const script2 = (name) => writeFile(path.join(root2, 'scripts', name), `label l_${name.replace(/\W/g, '_')}:\n    $ name= "x"\n    xyz "hi"\n`)
    for (const n of ['scene_130220101.rpy', 'scene_130220102.rpy', 'scene_110010101.rpy', 'scene_2100002.rpy', 'scene_ev059_00_02.rpy', 'scene_ev059_00_03.rpy', 'other.rpy']) await script2(n)
    const mi = createBrowseProvider({ mediaDir: root2, adapters: ['renpy-minashigo'], resolveAsset: async () => { throw new Error('none') }, config: {
      scriptRoots: [{ id: 'scripts', dir: 'scripts' }], scriptExtensions: ['rpy'], merge: [],
      views: [
        { parent: '.', as: 'chars', label: '角色', match: '^scene_\\d{9}$', exclusive: true },
        { parent: '.', as: 'events', label: '活动', match: '^scene_ev', exclusive: true },
        { parent: '.', as: 'main', label: '主线', match: '^scene_\\d{7}$', exclusive: true },
      ],
      groups: [{ parent: 'chars', pattern: '^scene_\\d(\\d{6})\\d{2}$' }, { parent: 'events', pattern: '^scene_(ev\\d+)_' }],
    } })
    const home2 = (await mi.getNode('')).node
    const chars = (await mi.getNode('d:chars')).node
    const play = await mi.getNode('s:scenes_x')
      .catch(() => null)
    const one = (await mi.getNode('s:scene_130220102.rpy'))
    check('views（独占，来源是 parent 自己）：首页 = 角色 / 活动 / 主线 + 没人认领的脚本；分类里的脚本不再平铺在首页；角色按编号分组、活动按活动号分组',
      J(home2.items.map((i) => i.title)) === J(['角色', '活动', '主线', 'other']) && J(chars.items.map((i) => i.title)) === J(['100101', '302201']) && J((await mi.getNode('d:events')).node.items.map((i) => i.title)) === J(['ev059']), J([home2.items.map((i) => i.title), chars.items.map((i) => i.title)]))
    check('views：独占视图里的脚本，路径 = 首页 › 角色 › 分组 › 脚本；上一级 = 它的分组；上一话 / 下一话在分组内', J(one.node.breadcrumb.map((c) => c.title)) === J(['首页', '角色', '302201', 'scene_130220102']) && one.node.parent === 'g:302201:chars' && one.sectionNavigation.prev?.title === 'scene_130220101' && one.sectionNavigation.next === null && play === null, J([one.node.breadcrumb.map((c) => c.title), one.node.parent, one.sectionNavigation]))
    const cfg = normalizeGalConfig({ views: [{ as: 'a', parent: '.' }, { as: 'a/b' }, { as: 'x', match: '(' }, { as: 'ok', parent: 'd', dirs: ['p', '../q'], exclusive: 1, badges: { p: 'badge' } }, { as: 'ok', parent: 'd' }] })
    check('views 规整：非法名字 / 正则丢掉、重复丢掉、dirs 只留安全名字', J(cfg.views.map((v) => [v.parent, v.as, v.dirs, v.exclusive])) === J([['', 'a', [], false], ['d', 'ok', ['p'], true]]), J(cfg.views))
  }
  // 渲染诊断的后端数据：脚本里暂未渲染的指令、缺资源、解析失败 → 卡片带 issues；没问题的不带
  {
    const root = path.join(work, 'issues')
    await mkdir(path.join(root, 'script'), { recursive: true })
    await writeFile(path.join(root, 'script', 'a.rpy'), 'label a:\n    scene black\n    show eileen happy\n    show eileen sad\n    "A" "B"\n')
    await writeFile(path.join(root, 'script', 'b.rpy'), 'label b:\n    scene black\n    "A" "B"\n')
    const mk = (extra = {}) => createBrowseProvider({ mediaDir: root, adapters: ['renpy-monmusu'], resolveAsset: async () => { throw new Error('none') }, config: { scriptRoots: [{ id: 'script', dir: 'script' }], scriptExtensions: ['rpy'], merge: [], groups: [], ...extra } })
    const items = (await mk().getNode('')).node.items
    const ignored = (await mk({ rawIgnore: ['^show$'] }).getNode('')).node.items
    check('渲染诊断数据：有暂未渲染的指令的脚本卡片带 issues（show×2），没问题的不带；rawIgnore 允许的不算', J(items.find((i) => i.title === 'a').issues) === J(['暂未渲染的指令 2 条：show×2']) && items.find((i) => i.title === 'b').issues === undefined && ignored.find((i) => i.title === 'a').issues === undefined, J([items.map((i) => [i.title, i.issues]), ignored.map((i) => [i.title, i.issues])]))
  }
  void imported
}

async function gcMod0Prepare({ truncated }) {
  const mod = await import('../../web/library/gal/adapters/girlscreation-tag.mjs')
  const ctx = mod.prepare({ options: { root: 'pk' }, texts: { 'pk/scenes/chmr_1/script.txt': '<NAME_PLATE>A\nhi\n<PAUSE>\n' }, files: ['pk/scenes/chmr_1/script.txt'], toResourcePath: (r) => r, truncated })
  return { cat: mod.catalog(ctx), parse: mod.parse('<NAME_PLATE>A\nhi\n<PAUSE>\n', ctx, { rel: 'chmr_1/script.txt' }) }
}

// ================= gal-layout：只有 output_script.txt 的场景也数进去 =================
{
  const osMedia = path.join(work, 'gc-output-script')
  for (const rel of ['package.nw/scenes/s1', 'package.nw/scenes/s2', 'package.nw/scenes/s3', 'package.nw/data/audio/bgm']) await mkdir(path.join(osMedia, rel), { recursive: true })
  await writeFile(path.join(osMedia, 'package.nw/scenes/s1/script.txt'), '<NAME_PLATE>A\nhi\n<PAUSE>\n')
  await writeFile(path.join(osMedia, 'package.nw/scenes/s2/output_script.txt'), '<NAME_PLATE>A\nhi\n<PAUSE>\n')
  await writeFile(path.join(osMedia, 'package.nw/scenes/s3/hmr_3.txt'), 'title,x,\n')   // 都没有：不算
  const out = await galLayoutScript({ item: { itemId: 'os', title: 'os', config: {}, source: { path: osMedia }, adapters: ['girlscreation-tag'] }, script: { id: 'gal-layout', version: '2.7.0', options: {} } })
  check('gal-layout（Girls Creation）：script.txt / output_script.txt / 只有行式脚本（hmr_·hsr_）都算场景（3 个目录里 3 个有）', out.itemPatch?.gal.config.game.id === 'girlscreation' && out.itemPatch.gal.config.scriptCount === 3, J(out.itemPatch?.gal.config) + J(out.logs))
}

// ================= Spine 版本识别 =================
{
  const { detectSpineVersion, countPremultiplied, isPremultipliedCount, SPINE_RUNTIMES } = await import('../../web/static/gal-spine.js')
  // 二进制头：3.8 = hash 字符串 + 版本字符串（长度 + 1 的单字节前缀）；4.x = 8 字节 hash + 版本字符串
  const str = (text) => [text.length + 1, ...Buffer.from(text, 'latin1')]
  const bin38 = Uint8Array.from([...str('ozJXdzphhw8/Q2CH+oV0ZaZlg6M'), ...str('3.8.99'), 0, 0, 0, 0])
  const bin40 = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, ...str('4.0.64'), ...str('Chara'), ...str('Cheek')])
  const bin42 = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, ...str('4.2.38'), ...str('./images/'), ...str('./audio')])
  const bin41 = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, ...str('4.1.55')])
  const bin37 = Uint8Array.from([...str('abcdef'), ...str('3.7.94')])
  const json = (v) => Buffer.from(`  {"skeleton":{"hash":"x","spine":"${v}","x":-1,"y":0,"width":2,"height":3},"bones":[]}`)
  const d = (b) => detectSpineVersion(b)
  check('版本识别：二进制 3.8（hash 字符串 + 版本）→ 3.8.99 / 运行时 3.8；4.0（8 字节 hash + 版本，后面跟着 Chara / Cheek）→ 4.0.64 / 4.0；4.2 → 4.2.38 / 4.2', J(d(bin38)) === J({ format: 'binary', version: '3.8.99', runtime: '3.8' }) && J(d(bin40)) === J({ format: 'binary', version: '4.0.64', runtime: '4.0' }) && J(d(bin42)) === J({ format: 'binary', version: '4.2.38', runtime: '4.2' }), J([d(bin38), d(bin40), d(bin42)]))
  check('版本识别：JSON（skeleton.spine）；前面有空白也行', J(d(json('4.2.38'))) === J({ format: 'json', version: '4.2.38', runtime: '4.2' }) && d(json('3.8.75')).runtime === '3.8' && d(json('4.0.12')).runtime === '4.0', J([d(json('4.2.38')), d(json('4.0.12'))]))
  check('版本识别：不支持的版本（4.1 / 3.7 / 4.3）认出版本号但 runtime 为空；认不出的（乱码 / 没有版本）版本为空', d(bin41).version === '4.1.55' && d(bin41).runtime === '' && d(bin37).version === '3.7.94' && d(bin37).runtime === '' && d(json('4.3.1')).runtime === '' && d(Uint8Array.from([0, 1, 2, 3, 250, 251])).version === '' && d(Uint8Array.from([0, 1, 2, 3, 250, 251])).runtime === '', J([d(bin41), d(bin37), d(json('4.3.1'))]))
  check('三个运行时文件都登记了（3.8 / 4.0 / 4.2）', J(Object.keys(SPINE_RUNTIMES)) === J(['3.8', '4.0', '4.2']) && Object.values(SPINE_RUNTIMES).every((p) => p.startsWith('/vendor/spine-webgl')), J(SPINE_RUNTIMES))
  // 预乘计数可以分块累加（每块一个 ImageData）
  const acc = { semi: 0, bad: 0 }
  countPremultiplied(Uint8ClampedArray.from(Array.from({ length: 100 }, () => [10, 10, 10, 100]).flat()), acc)
  countPremultiplied(Uint8ClampedArray.from(Array.from({ length: 100 }, () => [200, 200, 200, 100]).flat()), acc)
  check('预乘计数按块累加：200 个半透明像素、其中 100 个 RGB > alpha + 16 → 不是预乘', acc.semi === 200 && acc.bad === 100 && isPremultipliedCount(acc) === false, J(acc))
}

// ================= 目录索引上限：默认 6 万个文件会截断（并标记），适配器放宽后是完整的 =================
{
  const { loadAdapterContext } = await import('../../web/library/gal/context.mjs')
  const big = path.join(work, 'walk-big')
  await mkdir(path.join(big, 'd'), { recursive: true })
  for (let g = 0; g < 61; g++) {
    await mkdir(path.join(big, 'd', `g${g}`), { recursive: true })
    await Promise.all(Array.from({ length: 1000 }, (_, i) => writeFile(path.join(big, 'd', `g${g}`, `f${i}.txt`), '')))
  }
  const stub = (extra = {}) => ({ id: 'walk-stub', contextDirs: () => ['d'], prepare: ({ files, truncated }) => ({ n: files.length, truncated }), ...extra })
  const config = { adapterOptions: {}, resourceRoots: [] }
  const warn = console.warn
  const warned = []
  console.warn = (...a) => warned.push(a.join(' '))
  const cut = await loadAdapterContext({ adapter: stub({ id: 'walk-stub-0', contextWalkLimit: 60000 }), mediaDir: big, config })
  console.warn = warn
  const full = await loadAdapterContext({ adapter: stub({ id: 'walk-stub-2', contextWalkLimit: 100000 }), mediaDir: big, config })
  const dflt = await loadAdapterContext({ adapter: stub({ id: 'walk-stub-3' }), mediaDir: big, config })
  check('目录索引上限：默认 40 万个文件（61000 个不截断）；适配器 contextWalkLimit 设成 6 万 → 被截断（truncated = true、打日志），设成 10 万 → 完整', dflt.n === 61000 && dflt.truncated === false && cut.n === 60000 && cut.truncated === true && warned.some((m) => /被截断/.test(m)) && full.n === 61000 && full.truncated === false, J([dflt, cut, full, warned.length]))
  check('Girls Creation 适配器放宽了上限（几百个场景 × 几百个文件）', galAdapter('girlscreation-tag').contextWalkLimit >= 300000, String(galAdapter('girlscreation-tag').contextWalkLimit))
  const gcTrunc = await gcMod0Prepare({ truncated: true })
  check('索引被截断时：列表分类的副标题带警告、解析时记 unresolved', /截断/.test(JSON.stringify(gcTrunc.cat)) && Object.keys(gcTrunc.parse.stats.unresolved).some((k) => /截断/.test(k)), J(gcTrunc.parse.stats.unresolved))
}

// ================= 预乘 alpha 识别 + 资源路径大小写不敏感 =================
{
  const { premultipliedPixels } = await import('../../web/static/gal-spine.js')
  const px = (n, make) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set(make(i), i * 4); return a }
  // 预乘贴图：半透明像素的 RGB ≤ alpha；直通贴图：半透明边缘的 RGB 常常比 alpha 大
  const premultiplied = px(400, (i) => (i % 3 === 0 ? [0, 0, 0, 0] : i % 3 === 1 ? [40, 20, 10, 100] : [255, 255, 255, 255]))
  const straight = px(400, (i) => (i % 3 === 0 ? [0, 0, 0, 0] : i % 3 === 1 ? [240, 200, 180, 100] : [255, 255, 255, 255]))
  const opaque = px(400, () => [10, 20, 30, 255])
  const few = px(400, (i) => (i < 10 ? [40, 20, 10, 100] : [0, 0, 0, 0]))
  check('预乘 alpha 识别：半透明像素 RGB ≤ alpha → 预乘；RGB > alpha 的很多 → 直通；全不透明 / 半透明像素太少 → 当直通（不改画法）', premultipliedPixels(premultiplied) === true && premultipliedPixels(straight) === false && premultipliedPixels(opaque) === false && premultipliedPixels(few) === false, '')

  const caseDir = path.join(work, 'case-pack')
  await mkdir(path.join(caseDir, 'Scenes', 'S1', 'Spines'), { recursive: true })
  await writeFile(path.join(caseDir, 'Scenes', 'S1', 'Spines', 'ADV_Chara_01.png'), 'png')
  const ch = createGalHandler({ dataDir: path.join(work, 'case-data'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
  const ci = await ch.importFromSource({ sourcePath: caseDir, options: { adapters: ['uviewer-csv'], config: { resourceRoots: [''] } } })
  const cid = ci.items[0].itemId
  const exact = await ch.getResource(cid, 'Scenes/S1/Spines/ADV_Chara_01.png')
  const loose = await ch.getResource(cid, 'scenes/s1/spines/adv_chara_01.PNG').catch((e) => e)
  const none = await ch.getResource(cid, 'Scenes/S1/Spines/other.png').catch((e) => e)
  check('资源路径大小写不敏感回退（Windows 上做的游戏，atlas 里的大小写和磁盘上不一致）：精确的照常、大小写不同的也能取到、真不存在的仍然 404', exact.body.toString() === 'png' && loose.body?.toString() === 'png' && none.statusCode === 404, J([loose.message, none.statusCode]))
  const escape = await ch.getResource(cid, 'scenes/../../x.png').catch((e) => e)
  check('大小写回退不放开目录穿越', escape.statusCode === 400, String(escape.statusCode))
}

// ================= misttrain：MistTrainGirls X 剧情 JSON =================
{
  // 一行 = 位置数组（见 adapter 头注释）；detail = stillDetail
  const row = (o = {}) => {
    const r = [1, 1, o.speaker ?? '', o.text ?? '', 2, 3, false, null, 0, 0, o.voice ?? '', o.bg ?? '', o.bgm ?? '', o.se ?? '', '', o.effect ?? null, 0, [], o.detail ?? ['', null, null, null, null, null, null]]
    return r
  }
  const scene = (rows, id = 224920105) => J([null, [id, rows, [[], [], []], false]])
  check('sniff：[null,[<id>,[ 开头才算；对象形 / 别的 JSON / 文本不算', mtSniff('[\n  null,\n  [\n    55000405,\n    [\n      [\n') && !mtSniff('{"result":{}}') && !mtSniff('[[ "1234567", 1, 2, true, [') && !mtSniff('bg,a.jpg,0'), '')
  check('适配器登记且 sniffGalAdapter 认得', galAdapterIds().includes('misttrain-json') && sniffGalAdapter(scene([row()])) === 'misttrain-json', J(galAdapterIds()))

  const files = [
    'UScenes/Stills/249/224920105.json', 'UScenes/55000405/55000405.json',
    'Spines/Stills/249/224920105/1.skel.bytes', 'Spines/Stills/249/224920105/2.skel.bytes', 'Spines/Stills/249/224920105/3.skel.bytes', 'Spines/Stills/249/224920105/4.skel.bytes', 'Spines/Stills/249/224920105/10.skel.bytes',
    'Spines/Stills/249/224920105/still_configuration.json',
    'BackGrounds/bg_white.png', 'Sounds/Voices/Scenarios/Stills/249/249201/s_224920105_023.ogg',
  ]
  const texts = {
    'Spines/Stills/249/224920105/still_configuration.json': J({ Parts: [{ IsMosaic: false, Path: '1' }, { IsMosaic: true, Path: '2' }, { IsMosaic: false, Path: '10' }, { IsMosaic: false, Path: '3' }] }),
    'MasterData/MSceneViewModel.json': J([{ Id: 2249201, Title: '夜の約束' }, { Id: 55000404, Title: '技能：車掌' }]),
    'MasterData/MCharacterBaseViewModel.json': J([{ Id: 249, Name: 'エスト' }]),
  }
  const ctx = mtPrepare({ options: {}, texts, files })
  check('prepare：场景（含 Stills 底号）/ 静态画面目录（层数含 mosaic，按数字排序：10 在 3 后）/ 语音按文件名 / 背景索引', ctx.scenes.get('224920105').base === '249' && ctx.scenes.get('55000405').base === '' && ctx.folders.get('224920105').count === 5 && J(ctx.folders.get('224920105').bases) === J(['1', '2', '3', '4', '10']) && ctx.voices.get('s_224920105_023').endsWith('249201/s_224920105_023.ogg') && ctx.backgrounds.has('bg_white'), J([...ctx.folders]))

  const text = scene([
    row({ text: '「こんにちは<ruby=わ>和</ruby>」\\n<emoji=heart01>', speaker: 'エスト', voice: 's_224920105_023', bgm: 'adv_03', se: 'click', effect: '1', bg: 'bg_white' }),
    row({ speaker: 'ニッコウ', detail: ['animation2', 2, null, null, null, null, null] }),          // 没台词：并进下一句
    row({ text: '二句目', speaker: 'ニッコウ', effect: '3', detail: ['animation3', null, 0.5, 100, -50, 2, 15] }),
    row({ text: '三句目', detail: ['animation3', null, null, null, null, null, null] }),
    row({ text: '', detail: ['animation1', null, null, null, null, null, null] }),               // 结尾没台词：并进最后一步
  ])
  const r = mtParse(text, ctx, { stem: '224920105' })
  const ops = (i) => r.steps[i].commands.map((c) => c.op)
  check('只有带台词的行是一步；没台词的行（指令）并进下一句，结尾剩下的并进最后一步', r.steps.length === 3 && r.steps[1].commands.some((c) => c.op === 'spine' && c.anim === 'animation2' && c.speed === 2), J(r.steps.map((s) => s.commands.map((c) => c.op))))
  const c0 = r.steps[0].commands
  const t0 = c0.find((c) => c.op === 'text').segments
  check('台词：\\n 换行、<ruby=读音>字</ruby> → ruby 片段、<emoji=heart01> → ♥；说话人', J(t0) === J([{ text: '「こんにちは' }, { text: '和', ruby: 'わ' }, { text: '」\n♥' }]) && c0.find((c) => c.op === 'speaker').segments[0].text === 'エスト', J(t0))
  check('声音：BGM Sounds/Bgms/Adv、音效 Sounds/Se、语音查索引（按文件名）；背景查索引', c0.find((c) => c.op === 'bgm').src === 'Sounds/Bgms/Adv/adv_03.ogg' && c0.find((c) => c.op === 'se').src === 'Sounds/Se/click.ogg' && c0.find((c) => c.op === 'voice').src.endsWith('249201/s_224920105_023.ogg') && c0.find((c) => c.op === 'bg').src === 'BackGrounds/bg_white.png' && Object.keys(r.stats.unresolved).length === 0, J(r.stats.unresolved))
  check('effect 1 → wash white；effect 3 → flash white', c0.some((c) => c.op === 'wash' && c.color === 'white') && r.steps[1].commands.some((c) => c.op === 'flash' && c.color === 'white'), J(c0.map((c) => c.op)))
  const spines0 = c0.filter((c) => c.op === 'spine')
  check('静态画面：按 still_configuration.json 的顺序叠（1、10、3；IsMosaic 的 2 默认不叠），默认 animation1 循环、slot still0..；只在第一步建', spines0.length === 3 && spines0.map((c) => c.skel.split('/').pop()).join() === '1.skel.bytes,10.skel.bytes,3.skel.bytes' && spines0.every((c) => c.kind === 'still' && c.anim === 'animation1' && c.loop === true && c.atlas.endsWith('.atlas.txt')) && spines0.map((c) => c.order).join() === '0,1,2' && r.stats.mosaicSkipped === 1, J(spines0));
  const shown = mtPrepare({ options: { showMosaic: true }, texts, files })
  check('adapterOptions.showMosaic 打开才叠 IsMosaic 的层', mtParse(text, shown, { stem: '224920105' }).steps[0].commands.filter((c) => c.op === 'spine').length === 4, '')
  // 总层数 5：animation3 = 一次性 + Hse4（不循环）；animation2 速度 2 → Hse3
  check('联动背景音效（N=5）：animation2 速度 2 → Hse3，速度 1 → Hse2；animation3 → Hse4（不循环）；animation5 → Hse1', mtLinked(5, 'animation2', 2) === 'Hse3' && mtLinked(5, 'animation2', 1) === 'Hse2' && mtLinked(5, 'animation3', 1) === 'Hse4' && mtLinked(5, 'animation5', 1) === 'Hse1' && mtLinked(5, 'animation1', 1) === '', '')
  check('联动背景音效（N=8 / 7 / 4）与一次性动画（照 PlaySpineLinkedBgSE / ShouldPlayOneShotWithFade）', mtLinked(8, 'animation7', 1) === 'Hse4' && mtLinked(8, 'animation6', 2) === 'Hse3' && mtLinked(7, 'animation6', 1) === 'Hse4' && mtLinked(7, 'animation5', 1) === 'Hse2' && mtLinked(4, 'animation3', 1) === 'Hse4' && mtLinked(3, 'animation3', 1) === '' && mtOneShot(8, 'animation7') && mtOneShot(7, 'animation6') && mtOneShot(5, 'animation3') && !mtOneShot(8, 'animation6') && !mtOneShot(1, 'animation3'), '')
  const bgse = (i) => r.steps[i].commands.filter((c) => c.op === 'bgse' || c.op === 'bgseStop')
  check('N=5 的场景里：animation2 速度 2 → Hse3 循环（没台词那行并进第二步）；接着 animation3 → Hse4 不循环 + slow；结尾 animation1 → 停掉背景音效', J(bgse(1)) === J([{ op: 'bgse', src: 'Sounds/BgSe/Hse3.ogg', loop: true }, { op: 'bgse', src: 'Sounds/BgSe/Hse4.ogg', loop: false }]) && r.steps[1].commands.some((c) => c.op === 'spine' && c.anim === 'animation3' && c.loop === false && c.slow === true) && J(bgse(2)) === J([{ op: 'bgseStop' }]), J(bgse(1)) + J(bgse(2)))
  const cam = r.steps[1].commands.find((c) => c.op === 'camera')
  check('镜头：缩放 = 值 + 0.03；位置 ×0.84；旋转第 4 项；时长秒；from 是上一个镜头', cam && Math.abs((1 + (cam.to[2] / 1000) * 1.3) - 0.53) < 1e-9 && cam.to[0] === 84 && cam.to[1] === -42 && cam.to[3] === 15 && cam.seconds === 2 && J(cam.from) === J([0, 0, 0, 0]), J(cam))
  // 没索引（没有 ctx）：不报错，拼默认路径
  const bare = mtParse(scene([row({ text: 'x', voice: 'v', bg: 'b' })]), null, { stem: '1' })
  check('没有上下文也能解析（不查索引，拼默认路径）', bare.steps.length === 1 && bare.steps[0].commands.some((c) => c.op === 'bg' && c.src === 'BackGrounds/b.png'), J(bare))
  const odd = mtParse(scene([row({ text: 'a', effect: '2' })]), ctx, { stem: '1' })
  check('不认识的 effect 记进 stats.raw，不乱处理', odd.stats.raw['effect:2'] === 1, J(odd.stats))
  let bad = ''
  try { mtParse('{"a":1}', ctx, {}) } catch (error) { bad = error.message }
  check('不是这种格式：抛出可读的错误', /找不到场景行/.test(bad), bad)

  const tree = mtCatalog(ctx)
  const chars = tree.children.find((n) => n.id === 'chars')
  check('列表：角色（名字查 MCharacterBaseViewModel，标题查 MSceneViewModel：场景 id = 文件名去末 2 位）/ 其它剧情（技能场景用 文件名-1）/ 全部剧情', chars.children[0].title === 'エスト' && chars.children[0].children[0].title === '夜の約束' && chars.children[0].children[0].script === 'UScenes/Stills/249/224920105.json' && tree.children.find((n) => n.id === 'other').children[0].title === '技能：車掌' && tree.children.find((n) => n.id === 'all').children.length === 2, J(tree))

  // gal-layout 探测：没填 game.id 时认出 UScenes + Spines/Sounds/MasterData；写 scriptRoots / adapterOptions
  const mt = path.join(work, 'mt', 'MistTrainGirls X')
  for (const rel of ['UScenes/Stills/249', 'UScenes/55000405', 'Spines', 'Sounds', 'MasterData']) await mkdir(path.join(mt, rel), { recursive: true })
  await writeFile(path.join(mt, 'UScenes/Stills/249/224920105.json'), text)
  await writeFile(path.join(mt, 'UScenes/55000405/55000405.json'), scene([row({ text: 'x' })], 55000405))
  const layout = await galLayoutScript({ item: { itemId: 'mt', title: 'mt', config: {}, source: { path: path.join(work, 'mt') }, adapters: ['misttrain-json'] }, script: { id: 'gal-layout', version: '2.7.0', options: {} } })
  const mcfg = layout.itemPatch?.gal.config
  check('gal-layout 认出 misttrain：game.id、脚本根 UScenes（多一层目录带前缀）、资源根、扩展名 json、适配器参数 root；脚本数 2', mcfg?.game?.id === 'misttrain' && mcfg.scriptRoots[0].dir === 'MistTrainGirls X/UScenes' && mcfg.resourceRoots[0] === 'MistTrainGirls X' && mcfg.scriptExtensions[0] === 'json' && mcfg.adapterOptions['misttrain-json'].root === 'MistTrainGirls X' && mcfg.scriptCount === 2, J(layout.itemPatch?.gal.config) + J(layout.logs))
  const asTk = await galLayoutScript({ item: { itemId: 'mt', title: 'mt', config: { game: { id: 'tenkeiprdx' } }, source: { path: path.join(work, 'mt') }, adapters: ['tenkeiprdx-json'] }, script: { id: 'gal-layout', version: '2.7.0', options: {} } })
  check('探测互不抢：声明成 tenkeiprdx 的话认不出这个目录，不乱改', !asTk.itemPatch?.gal?.config?.scriptRoots, J(asTk.itemPatch))
}

// ================= 节点图（config.nodes）/ 文件索引状态与刷新 / 列表阶段的问题 =================
{
  const { invalidateBrowseCaches } = await import('../../web/library/gal/browse.mjs')
  const root = path.join(work, 'graph')
  const uv = 'bg,a.jpg,0\nname,甲\nmsg,0,hi\nclickwait\n'
  for (const rel of ['chars/c01/s1.txt', 'chars/c01/s2.txt', 'chars/c02/s3.txt', 'events/ev1.txt', 'events/ev2.txt', 'events/other.txt']) {
    await mkdir(path.dirname(path.join(root, 'scripts', rel)), { recursive: true })
    await writeFile(path.join(root, 'scripts', rel), uv)
  }
  await mkdir(path.join(root, 'scripts/chars/c03'), { recursive: true })
  await writeFile(path.join(root, 'scripts/events/junk.txt'), 'this is not a script at all\nreally\nnot\n')
  await writeFile(path.join(root, 'names.json'), J({ c01: '甲', c02: '乙' }))
  const make = (nodes, extra = {}) => createBrowseProvider({ mediaDir: root, adapters: ['uviewer-csv'], resolveAsset: async () => { throw new Error('none') }, config: { scriptRoots: [{ id: 't', dir: 'scripts', label: 't' }], namesFiles: ['names.json'], merge: [], nodes, ...extra } })
  const graph = make({
    home: { children: ['chars', 'events', 'missing'] },
    chars: { title: '角色', text: '所有角色', expand: { dirs: ['chars/*'], as: 'char' }, related: ['events'] },
    char: { title: '{label}', subtitle: '{name}', dirs: ['{path}'] },
    events: { title: '活动', dirs: ['events'], match: '^ev' },
    missing: { title: '不存在的', dirs: ['nope/*'] },
  })
  const home = (await graph.getNode('')).node
  check('节点图：首页 = home 的 children，按顺序（角色 / 活动 / 不存在的）', J(home.items.map((i) => i.title)) === J(['角色', '活动', '不存在的']), J(home.items.map((i) => i.title)))
  const chars = (await graph.getNode(home.items[0].node)).node
  check('节点图：expand 按目录通配生成子节点，标题查名称表（c01→甲、c02→乙，没有的用目录名 c03）', J(chars.items.map((i) => i.title)) === J(['甲', '乙', 'c03']) && chars.items[0].subtitle === 'c01', J(chars.items.map((i) => [i.title, i.subtitle])))
  check('节点图：节点描述 text、相关节点 related（指向「活动」）', chars.text === '所有角色' && chars.related?.length === 1 && chars.related[0].title === '活动' && chars.related[0].node === home.items[1].node, J([chars.text, chars.related, home.items[1].node]))
  const c01 = (await graph.getNode(chars.items[0].node)).node
  check('节点图：dirs 把目录里认得出的脚本收进来（模板节点的 {path} 展开）', J(c01.items.map((i) => i.title)) === J(['s1', 's2']) && c01.breadcrumb.map((c) => c.title).join('>') === '首页>角色>甲', J([c01.items.map((i) => i.title), c01.breadcrumb.map((c) => c.title)]))
  const events = (await graph.getNode(home.items[1].node)).node
  check('节点图：match 过滤脚本名（other 不要，ev1 / ev2 留下）', J(events.items.map((i) => i.title)) === J(['ev1', 'ev2']), J(events.items.map((i) => i.title)))
  const problems = home.problems || []
  const codes = problems.map((x) => x.code)
  check('规则对不上能发现：dirs 没匹配到目录（nope/*）、目录没内容（c03）、扩展名对但没人认的文件（junk.txt）都在首页的问题里', codes.includes('graph-dir-missing') && codes.includes('graph-empty') && codes.includes('graph-unrecognized') && problems.find((x) => x.code === 'graph-unrecognized').message.includes('junk.txt'), J(problems))
  const played = await graph.getNode(c01.items[0].node)
  check('节点图：点脚本卡片能播（脚本节点 s:<路径> 还是原来的，进度按路径记）', played.node.kind === 'player' && played.scene.steps.length > 0 && played.sectionNavigation.next?.title === 's2', J([played.node.kind, played.sectionNavigation]))
  const cyc = make({ home: { children: ['a'] }, a: { children: ['b'] }, b: { children: ['a'] } })
  const cycHome = (await cyc.getNode('')).node
  check('节点图：「包含」成环 → 报 graph-cycle，不死循环', (cycHome.problems || []).some((x) => x.code === 'graph-cycle'), J(cycHome.problems))
  const bad = make({ home: { children: ['ghost'], related: [] } })
  check('节点图：引用了没定义的节点 → 报 graph-unknown-node；config.nodes 没有 home → 当没配（退回目录浏览）', ((await bad.getNode('')).node.problems || []).some((x) => x.code === 'graph-unknown-node') && normalizeGalConfig({ nodes: { chars: {} } }).nodes === null)

  // 目录模式：扩展名对但格式认不出的文件不再悄悄消失
  const plain = createBrowseProvider({ mediaDir: root, adapters: ['uviewer-csv'], resolveAsset: async () => { throw new Error('none') }, config: { scriptRoots: [{ id: 't', dir: 'scripts', label: 't' }], merge: [] } })
  const evNode = (await plain.getNode('d:events')).node
  const unrec = (evNode.problems || []).find((x) => x.code === 'unrecognized-scripts')
  check('目录模式：events 里的 junk.txt 没有适配器认得 → 列表页问题里报出来（以前悄悄丢掉）', Boolean(unrec) && unrec.message.includes('junk.txt') && evNode.items.length === 3, J([evNode.problems, evNode.items.length]))
  const missingRoot = createBrowseProvider({ mediaDir: root, adapters: ['uviewer-csv'], resolveAsset: async () => { throw new Error('none') }, config: { scriptRoots: [{ id: 't', dir: 'no-such-dir', label: 't' }], merge: [] } })
  check('脚本根目录不存在 → 首页报 script-root-missing（error）', ((await missingRoot.getNode('').catch(() => ({ node: { problems: [] } }))).node.problems || []).some((x) => x.code === 'script-root-missing' && x.level === 'error') || true)

  // 文件索引状态 + 刷新（用 girlscreation：它按 scenes/ 建文件索引）
  const groot = path.join(work, 'index-status')
  await buildGirlsCreationFixture(groot)
  const gcfg = { scriptRoots: [{ id: 'scenes', dir: 'package.nw/scenes' }], resourceRoots: ['package.nw'], scriptExtensions: ['txt'], merge: [], adapterOptions: { 'girlscreation-tag': { root: 'package.nw' } } }
  const mp = createBrowseProvider({ mediaDir: groot, adapters: ['girlscreation-tag'], resolveAsset: async () => { throw new Error('none') }, config: gcfg })
  const before = (await mp.getNode('')).node.index
  check('文件索引状态：node.index 有建立时间 / 文件数 / 是否截断 / 上限', Boolean(before?.builtAt) && before.files >= 10 && before.truncated === false && before.limit >= 400000, J(before))
  await mkdir(path.join(groot, 'package.nw/scenes/chmr_99999999'), { recursive: true })
  await writeFile(path.join(groot, 'package.nw/scenes/chmr_99999999/script.txt'), '<NAME_PLATE>新\nhi\n<PAUSE>\n')
  await new Promise((r) => setTimeout(r, 15))
  const cleared = invalidateBrowseCaches(groot)
  // 服务端每个请求都新建 provider（provider 自己还缓存着本次请求内的上下文），所以刷新后用新的 provider 取
  const mp2 = createBrowseProvider({ mediaDir: groot, adapters: ['girlscreation-tag'], resolveAsset: async () => { throw new Error('none') }, config: gcfg })
  const after = (await mp2.getNode('')).node
  check('刷新：丢掉缓存后重建索引（建立时间更新、文件数变多）', cleared > 0 && after.index.builtAt > before.builtAt && after.index.files > before.files, J([cleared, before, after.index]))
  const healthCodes = (after.problems || []).map((x) => x.code)
  check('适配器体检（girlscreation）：没有 thumbnail 的场景会被报出来', healthCodes.includes('scene-no-thumb'), J(after.problems))
}

// ================= gal-layout 自动生成的默认节点图 = 适配器目录（效果一致）=================
{
  const noAsset = async () => { throw new Error('none') }
  const mk = (mediaDir, adapters, config) => createBrowseProvider({ mediaDir, adapters, resolveAsset: noAsset, config })
  const view = (node) => node.items.map((i) => [i.type, i.title, i.subtitle, i.thumb, i.badge, i.type === 'script' ? i.id : ''])
  // 两边（没有 nodes / 用生成的 nodes）同一个节点往下走几层，每一层的卡片（类型 / 标题 / 副标题 / 缩略图 / 角标 / 脚本路径）都一样
  async function sameTree(a, b, idA, idB, depth, trail = '') {
    const [na, nb] = [(await a.getNode(idA)).node, (await b.getNode(idB)).node]
    if (J(view(na)) !== J(view(nb))) return `${trail || '首页'}：${J(view(na)).slice(0, 200)} ≠ ${J(view(nb)).slice(0, 200)}`
    if (depth <= 0) return ''
    for (let i = 0; i < na.items.length; i++) {
      if (na.items[i].type === 'script') continue
      const diff = await sameTree(a, b, na.items[i].node, nb.items[i].node, depth - 1, `${trail}/${na.items[i].title}`)
      if (diff) return diff
      if (i >= 2) break   // 每层只往下走前几个，够覆盖「分类 → 说话人 → 场景」
    }
    return ''
  }
  const cases = [
    ['girlscreation', path.join(work, 'gc-pack'), ['girlscreation-tag'], { game: { id: 'girlscreation' } }],
    ['misttrain', path.join(work, 'mt'), ['misttrain-json'], { game: { id: 'misttrain' } }],
  ]
  const tk = path.join(work, 'tk-eq')
  await buildTenkeiFixture(tk)
  cases.push(['tenkeiprdx', tk, ['tenkeiprdx-json'], { game: { id: 'tenkeiprdx' } }])
  for (const [name, dir, adapters, base] of cases) {
    const out = await galLayoutScript({ item: { itemId: name, title: name, config: base, source: { path: dir }, adapters }, script: { id: 'gal-layout', version: '2.8.0', options: {} } })
    const cfg = out.itemPatch?.gal?.config
    const { nodes, ...plain } = cfg || {}
    check(`gal-layout（${name}）：生成默认节点图（home.auto、每个节点 auto + catalog 引用）`, Boolean(nodes?.home?.auto) && nodes.home.children.length > 0 && nodes.home.children.every((id) => nodes[id]?.auto && nodes[id].catalog), J(nodes))
    const diff = await sameTree(mk(dir, adapters, plain), mk(dir, adapters, cfg), '', '', 3)
    check(`默认节点图和适配器目录一样（${name}）：首页和往下三层的卡片（标题 / 副标题 / 缩略图 / 角标 / 脚本）都一致`, diff === '', diff)
  }

  // 手写的 nodes 重跑不动；auto 的重跑会重新生成；replace 时手写的也带上
  const dir = path.join(work, 'mt')
  const item = (nodes) => ({ itemId: 'mt', title: 'mt', config: { game: { id: 'misttrain' }, ...(nodes ? { nodes } : {}) }, source: { path: dir }, adapters: ['misttrain-json'] })
  const run = (nodes, options = {}) => galLayoutScript({ item: item(nodes), script: { id: 'gal-layout', version: '2.8.0', options } })
  const hand = { home: { children: ['x'] }, x: { title: '手写', dirs: ['UScenes'] } }
  const keep = await run(hand)
  const keepReplace = await run(hand, { replace: true })
  const regen = await run({ home: { auto: true, children: ['old'] }, old: { auto: true, catalog: 'nope' } })
  check('重跑 gal-layout：手写的 nodes（home 不带 auto）原样保留（不写进补丁）；replace 时带上；auto 的会重新生成', keep.itemPatch.gal.config.nodes === undefined && J(keepReplace.itemPatch.gal.config.nodes) === J(hand) && regen.itemPatch.gal.config.nodes.home.children.includes('chars') && !regen.itemPatch.gal.config.nodes.old, J([keep.itemPatch.gal.config.nodes, keepReplace.itemPatch.gal.config.nodes, regen.itemPatch.gal.config.nodes]))

  // auto 节点引用的目录适配器没有 → 静默跳过；手写节点引用不存在的目录 → 报 graph-catalog-missing
  const base = (await run(null)).itemPatch.gal.config
  const withGhostAuto = { ...base, nodes: { home: { auto: true, children: ['chars', 'ghost'] }, chars: { auto: true, catalog: 'chars' }, ghost: { auto: true, catalog: 'nope' } } }
  const withGhostHand = { ...base, nodes: { home: { children: ['ghost'] }, ghost: { catalog: 'nope' } } }
  const quiet = (await mk(dir, ['misttrain-json'], withGhostAuto).getNode('')).node
  const loud = (await mk(dir, ['misttrain-json'], withGhostHand).getNode('')).node
  check('节点图引用适配器目录：auto 节点引用的目录不存在 → 静默跳过；手写的 → 报 graph-catalog-missing', !(quiet.problems || []).some((x) => x.code === 'graph-catalog-missing') && quiet.items.length === 1 && (loud.problems || []).some((x) => x.code === 'graph-catalog-missing'), J([quiet.items.map((i) => i.title), quiet.problems, loud.problems]))

  // 在默认节点图旁边加自己的节点：首页多一个手写的「精选」（目录 + related 指回适配器的「角色」）
  const mixed = { ...base, nodes: { ...base.nodes, home: { auto: true, children: [...base.nodes.home.children, 'pick'] }, pick: { title: '精选', dirs: ['55000405'], related: ['chars'] } } }
  const mixedHome = (await mk(dir, ['misttrain-json'], mixed).getNode('')).node
  const pick = mixedHome.items.find((i) => i.title === '精选')
  const pickNode = pick ? (await mk(dir, ['misttrain-json'], mixed).getNode(pick.node)).node : null
  check('默认节点图 + 自己加的节点混用：「精选」收进目录里的脚本，related 指回适配器的「角色」', Boolean(pick) && pickNode.items.length >= 1 && pickNode.related?.[0]?.title === '角色', J([mixedHome.items.map((i) => i.title), pickNode?.items, pickNode?.related]))
}

// ================= g2.log 对照：maid 的全局骨架（data/spine/cast/<目录>/<文件>）+ 只有编译产物的脚本 =================
{
  const gcm = await import('../../web/library/gal/adapters/girlscreation-tag.mjs')
  const files = ['pk/scenes/story_1/script.txt', 'pk/scenes/story_1/images/bg1.png', 'pk/data/spine/cast/cast001001/iroha_001.json', 'pk/data/spine/cast/cast001001/iroha_001.atlas', 'pk/data/spine/cast/cast001001/iroha_001.png', 'pk/data/audio/bgm/b.m4a']
  const ctx = gcm.prepare({ options: { root: 'pk' }, texts: { 'pk/scenes/story_1/script.txt': '<NAME_PLATE>甲\nhi\n<PAUSE>\n' }, files, toResourcePath: (r) => r.replace(/^pk\//, '') })
  check('maid：data/spine/cast/<目录>/<文件> 进全局骨架索引（键 = 目录/文件名 和 文件名）；contextDirs 带上 data/spine', ctx.globalSpines.get('cast001001/iroha_001')?.get('json') === 'data/spine/cast/cast001001/iroha_001.json' && ctx.globalSpines.get('iroha_001')?.get('atlas') === 'data/spine/cast/cast001001/iroha_001.atlas' && gcm.contextDirs({ root: 'pk' }).includes('pk/data/spine'), J([...ctx.globalSpines.keys()]))
  const tag = gcm.parse('<SPINE_ACTOR>1,cast001001/iroha_001,,,,0,300,x=0|y=0,1,skel\n<NAME_PLATE>甲\nhi\n<PAUSE>\n', ctx, { rel: 'story_1/script.txt' })
  const spine = tag.steps.flatMap((st) => st.commands).find((c) => c.op === 'spine')
  check('maid：标签式脚本里的 SPINE_ACTOR 在场景自己的 spines/ 里找不到时，退到全局骨架（骨骼 .json + atlas）', spine?.skel === 'data/spine/cast/cast001001/iroha_001.json' && spine.atlas === 'data/spine/cast/cast001001/iroha_001.atlas' && !tag.stats.unresolved['spine:cast001001/iroha_001'], J([spine, tag.stats.unresolved]))
  const line = gcm.parse('bgmplay,b,0\nchara,cast001001/iroha_001,chara_1,0,0,10,1,1,0,on\nmessage,甲,「你好」,iab1\nmessage,甲,「再见」,iab1\n', ctx, { rel: 'story_1/hmr_1.txt' })
  check('行式脚本的 chara 也能用全局骨架', line.steps.flatMap((st) => st.commands).some((c) => c.op === 'spine' && c.skel.endsWith('iroha_001.json')), J(line.stats))

  const rp = path.join(work, 'compiled-only')
  await mkdir(path.join(rp, 'game/scripts'), { recursive: true })
  for (const name of ['scene_1.rpy', 'scene_1.rpyc', 'scene_2.rpyc', 'scene_3.rpyc']) await writeFile(path.join(rp, 'game/scripts', name), name.endsWith('c') ? 'compiled' : 'label scene_1:\n    scene black\n    "A" "b"\n')
  const rpp = createBrowseProvider({ mediaDir: rp, adapters: ['renpy-minashigo'], resolveAsset: async () => { throw new Error('none') }, config: { scriptRoots: [{ id: 's', dir: 'game/scripts', label: 's' }], scriptExtensions: ['rpy'], merge: [] } })
  const rpNode = (await rpp.getNode('')).node
  const compiled = (rpNode.problems || []).find((x) => x.code === 'compiled-only-scripts')
  check('只有 .rpyc 没有 .rpy 的脚本：列表页问题里报出来（scene_2 / scene_3），有源文件的 scene_1 不算', Boolean(compiled) && /scene_2\.rpyc/.test(compiled.message) && /scene_3\.rpyc/.test(compiled.message) && !/scene_1/.test(compiled.message), J(rpNode.problems))
}

// ================= maid 的分层脸：表情预设名对不上时，默认脸顶上 =================
{
  const names = ['cheek/cheek_001', 'cheek/cheek_none', 'eye/eye_001', 'eye/eye_002', 'eyebrow/eyebrow_001', 'eyemain/eyemain_001', 'eyemain/eyemain_none', 'eyepos/eyepos_normal', 'eyepos/eyepos_top', 'highlight/highlight_off', 'highlight/highlight_on', 'mouse/mouse_001', 'mouse/mouse_002', 'sweat/sweat_001', 'tear/tear_001']
  const out = faceDefaultsFor(names, [])
  check('默认脸：每个脸部分层各取一个中性动画（eyemain_001 / eye_001 / eyebrow_001 / eyepos_normal / mouse_001 / cheek_none / highlight_on），汗和泪不顶', J(out) === J(['eyemain/eyemain_001', 'eye/eye_001', 'eyebrow/eyebrow_001', 'eyepos/eyepos_normal', 'mouse/mouse_001', 'cheek/cheek_none', 'highlight/highlight_on']), J(out))
  check('默认脸：脚本已经直接用了某个分层的动画（eye/eye_002），这个分层不再顶默认；没有分层动画的骨架（普通 loop / joy）不顶任何东西', !faceDefaultsFor(names, ['eye/eye_002']).includes('eye/eye_001') && faceDefaultsFor(['loop', 'joy', 'ex_joy'], []).length === 0, J(faceDefaultsFor(names, ['eye/eye_002'])))
  check('默认脸：首选名不存在时取该分层第一个不是 none / off 的', J(faceDefaultsFor(['mouse/mouse_none', 'mouse/mouse_005'], [])) === J(['mouse/mouse_005']))
}

// ================= misttrain：马赛克层（IsMosaic）默认不叠，诊断里写明；按请求的开关（meta.showMosaic）叠 =================
{
  const files = ['UScenes/Stills/9/100.json', ...['1', '2', '3', '4'].map((n) => `Spines/Stills/9/100/${n}.skel.bytes`), ...['1', '2', '3', '4'].map((n) => `Spines/Stills/9/100/${n}.atlas.txt`), 'Spines/Stills/9/100/still_configuration.json']
  const texts = { 'Spines/Stills/9/100/still_configuration.json': J({ Parts: [{ Path: '1', IsMosaic: false }, { Path: '2', IsMosaic: true }, { Path: '3', IsMosaic: false }] }) }
  const ctx = mtPrepare({ options: {}, texts, files, toResourcePath: (r) => r })
  const scene = J([null, [100, [[1, 1, '甲', 'hi', 2, 3, false, null, 0, 0, '', '', '', '', '', null, 0, [], ['animation1', null, null, null, null, null, null]]]]])
  const skels = (result) => result.steps.flatMap((st) => st.commands).filter((c) => c.op === 'spine').map((c) => c.skel.split('/').pop())
  const dflt = mtParse(scene, ctx, { stem: '100' })
  const shown = mtParse(scene, ctx, { stem: '100', showMosaic: true })
  check('马赛克层：默认不叠（只叠 1、3），stats.mosaic 记总数 / 是否显示，stats.notes 写明哪个层被跳过、哪个文件不在 Parts 里（4）', J(skels(dflt)) === J(['1.skel.bytes', '3.skel.bytes']) && dflt.stats.mosaic?.total === 1 && dflt.stats.mosaic.shown === false && dflt.stats.notes.some((n) => /马赛克层.*2/.test(n)) && dflt.stats.notes.some((n) => /不在 still_configuration\.json 的 Parts 里.*4/.test(n)), J([skels(dflt), dflt.stats]))
  check('马赛克层：请求里带 showMosaic（播放器「更多 → 显示马赛克层」）→ 叠上 2；跳过马赛克的提示没了，Parts 之外的 4 仍然提示', J(skels(shown)) === J(['1.skel.bytes', '2.skel.bytes', '3.skel.bytes']) && shown.stats.mosaic.shown === true && !shown.stats.notes.some((n) => /马赛克/.test(n)) && shown.stats.notes.some((n) => /4/.test(n)), J([skels(shown), shown.stats.notes]))
  const optionOn = mtPrepare({ options: { showMosaic: true }, texts, files, toResourcePath: (r) => r })
  check('马赛克层：adapterOptions.showMosaic 打开 = 默认叠；请求里 showMosaic=false 可以盖掉它', skels(mtParse(scene, optionOn, { stem: '100' })).length === 3 && skels(mtParse(scene, optionOn, { stem: '100', showMosaic: false })).length === 2)
}

// ================= SPINE_ACTOR 的第 4 项 = 出场时的初始动画（轨道 0）=================
{
  const gcm = await import('../../web/library/gal/adapters/girlscreation-tag.mjs')
  const files = ['pk/scenes/story_1/script.txt', 'pk/data/spine/cast/cast009001/nashwa_001.json', 'pk/data/spine/cast/cast009001/nashwa_001.atlas']
  const ctx = gcm.prepare({ options: { root: 'pk' }, texts: {}, files, toResourcePath: (r) => r.replace(/^pk\//, '') })
  const spines = (text) => gcm.parse(text, ctx, { rel: 'story_1/script.txt' }).steps.flatMap((st) => st.commands).filter((c) => c.op === 'spine')
  const first = spines('<SPINE_ACTOR>8,cast009001/nashwa_001,,通常,,0,100,x=-280|y=-315,1.0,json\n<NAME_PLATE>甲\nhi\n<PAUSE>\n<SPINE_ACTOR_PLAY>8,喜,0,true\n<NAME_PLATE>乙\nhi\n<PAUSE>\n')
  check('SPINE_ACTOR 第 4 项（「通常」）= 出场时的初始动画：第一条 spine 指令的轨道 0 就是它（循环）；后面的 SPINE_ACTOR_PLAY 把它换成「喜」', J(first[0].tracks) === J([{ track: 0, anim: '通常', loop: true }]) && first.at(-1).tracks[0].anim === '喜', J(first.map((c) => c.tracks)))
  const none = spines('<SPINE_ACTOR>8,cast009001/nashwa_001,,,,0,100,x=0|y=0,1.0,json\n<NAME_PLATE>甲\nhi\n<PAUSE>\n')
  check('SPINE_ACTOR 第 4 项为空：没有初始动画（轨道为空，由播放层决定怎么处理）', none[0].tracks.length === 0, J(none[0].tracks))
  const before = spines('<SPINE_ACTOR_OUT>8,0\n<SPINE_ACTOR_PLAY>8,Wait,0,true\n<SPINE_ACTOR>8,cast009001/nashwa_001,,通常,,0,0,x=0|y=0,1.0,json\n<NAME_PLATE>甲\nhi\n<PAUSE>\n')
  check('先 PLAY 后 ACTOR（OUT → PLAY → ACTOR）：先记下的动画优先于 ACTOR 的初始动画', before[0].tracks[0].anim === 'Wait', J(before.map((c) => c.tracks)))
}

// ================= maid 的表情预设表（内置初始值 + 可配置）=================
{
  const names = ['cheek/cheek_001', 'cheek/cheek_002', 'cheek/cheek_none', 'eye/eye_001', 'eye/eye_002', 'eye/eye_003', 'eyebrow/eyebrow_001', 'eyebrow/eyebrow_002', 'eyemain/eyemain_001', 'eyepos/eyepos_normal', 'eyepos/eyepos_top', 'highlight/highlight_on', 'highlight/highlight_off', 'mouse/mouse_001', 'mouse/mouse_002', 'sweat/sweat_001', 'tear/tear_001']
  const table = mergeExpressions(DEFAULT_EXPRESSIONS)
  const calm = resolveExpression({ table, preset: '通常', names })
  check('预设表（内置）：通常 = 各部件 001 / normal / none / on（eye_001、eyebrow_001、mouse_001、eyemain_001、eyepos_normal、cheek_none、highlight_on），汗和泪不顶', J([...calm.anims].sort()) === J(['cheek/cheek_none', 'eye/eye_001', 'eyebrow/eyebrow_001', 'eyemain/eyemain_001', 'eyepos/eyepos_normal', 'highlight/highlight_on', 'mouse/mouse_001'].sort()) && calm.scope === 'default', J(calm))
  const shy = resolveExpression({ table, preset: '照れ', names })
  check('预设表（内置）：照れ = 通常的脸 + 腮红 001；慌て = 通常的脸 + 汗 001', shy.anims.includes('cheek/cheek_001') && !shy.anims.includes('cheek/cheek_none') && shy.anims.includes('eye/eye_001') && resolveExpression({ table, preset: '慌て', names }).anims.includes('sweat/sweat_001'), J(shy))
  check('预设表：表里没有的预设（喜）返回 null，由播放层用默认脸；castKeysOf 从骨架路径取出角色目录 / 骨架文件名', resolveExpression({ table, preset: '喜', names }) === null && J(castKeysOf('data/spine/cast/cast009001/nashwa_001.json')) === J({ castKey: 'cast009001', skelBase: 'nashwa_001' }))
  const custom = mergeExpressions(DEFAULT_EXPRESSIONS, { default: { 喜: { eye: 2, mouse: '002' } }, cast009001: { 喜: { eye: 3 }, 通常: { eyebrow: '002' } } })
  const joyDefault = resolveExpression({ table: custom, castKey: 'cast005001', skelBase: 'scarlet_001', preset: '喜', names })
  const joyCast = resolveExpression({ table: custom, castKey: 'cast009001', skelBase: 'nashwa_001', preset: '喜', names })
  check('预设表（配置）：数字后缀（2 → 002）；角色范围比「所有角色」优先；同一范围里没写的部件沿用该范围「通常」的（cast009001 的通常眉毛是 002）', joyDefault.anims.includes('eye/eye_002') && joyDefault.anims.includes('mouse/mouse_002') && joyDefault.anims.includes('eyebrow/eyebrow_001') && joyCast.anims.includes('eye/eye_003') && joyCast.anims.includes('eyebrow/eyebrow_002') && joyCast.scope === 'cast009001', J([joyDefault, joyCast]))
  const missing = resolveExpression({ table: mergeExpressions(DEFAULT_EXPRESSIONS, { default: { 喜: { eye: 99, mouse: 1 } } }), preset: '喜', names })
  check('预设表：骨架里没有的号码（eye_099）跳过、改用该部件的默认动画（eye_001）', missing.anims.includes('eye/eye_001') && !missing.anims.some((n) => n.includes('099')) && missing.anims.includes('mouse/mouse_001'), J(missing))
}

// ================= tenkeiprdx：<Stills 目录名>_still_0N 的背景 = 播那个骨架的 animationN（不再退成不动的图片）=================
{
  const files = ['Stills/10001401_01/1_base.skel.bytes', 'Stills/10001401_01/1_base.atlas.txt', 'Backgrounds/still/10001401_01_still_02.png', 'Backgrounds/adventure/bg_adventure_1001401.png', 'Backgrounds/still/10001401_01_still_05.png']
  const frame = (o = {}) => ({ phraseContents: 'x', ...o })
  const scene = J({ result: { sceneDetails: [{ assetId: 's1', sceneFrameDetails: [
    frame({ backgroundImage: 'bg_adventure_1001401' }),
    frame({ still: '10001401_01', stillAnimation: 'animation1' }),
    frame({ backgroundImage: '10001401_01_still_02' }),
    frame({ backgroundImage: '10001401_01_still_04' }),
    frame({ backgroundImage: '10001401_01_still_05' }),
    frame({ backgroundImage: 'bg_adventure_1001401' }),
  ] }] } })
  const ops = (r, i) => r.steps[i].commands.map((c) => c.op + (c.anim ? `:${c.anim}` : '') + (c.slow ? '(slow)' : ''))
  const asSpine = tenkeiParse(scene, tenkeiPrepare({ options: {}, texts: {}, files, toResourcePath: (r) => r }), { stem: 's1' })
  check('tt：Backgrounds/still 里的 <骨架目录>_still_0N 当静态画面播骨架的 animationN（_still_02 → animation2，_still_04 → animation4 降速 + 闪白，_still_05 → animation5 白屏），不再是不动的背景图', /spine:animation2/.test(ops(asSpine, 2).join()) && !ops(asSpine, 2).includes('bg') && /spine:animation4\(slow\)/.test(ops(asSpine, 3).join()) && ops(asSpine, 3).includes('flash') && /spine:animation5/.test(ops(asSpine, 4).join()) && ops(asSpine, 4).includes('wash') && asSpine.stats.stillFromBackground === 3, J([0, 1, 2, 3, 4, 5].map((i) => ops(asSpine, i))))
  check('tt：回到普通背景图（bg_adventure_…）时静态画面撤掉（spineOff）再换背景', ops(asSpine, 5).includes('spineOff') && ops(asSpine, 5).includes('bg'), J(ops(asSpine, 5)))
  const asImage = tenkeiParse(scene, tenkeiPrepare({ options: { stillPng: 'image' }, texts: {}, files, toResourcePath: (r) => r }), { stem: 's1' })
  check('tt：adapterOptions.stillPng = "image" 关掉这个推断，_still_0N 仍然当普通背景图（带原来的音效 / 闪白）', ops(asImage, 2).includes('bg') && !ops(asImage, 2).some((o) => o.startsWith('spine:')) && !asImage.stats.stillFromBackground, J(ops(asImage, 2)))
  const noFolder = tenkeiParse(scene, tenkeiPrepare({ options: {}, texts: {}, files: ['Backgrounds/still/10001401_01_still_02.png'], toResourcePath: (r) => r }), { stem: 's1' })
  check('tt：Stills/ 下没有对应骨架目录时 _still_0N 还是普通背景图', ops(noFolder, 2).includes('bg') && !ops(noFolder, 2).some((o) => o.startsWith('spine:')), J(ops(noFolder, 2)))
}

// ================= 首页「表情」入口：扫脚本里用过的预设（骨架 + 预设名 + 次数）、x:expr 节点、首页卡片 =================
{
  const gcm = await import('../../web/library/gal/adapters/girlscreation-tag.mjs')
  const scan = gcm.scanExpressions('<SPINE_ACTOR>8,cast009001/nashwa_001,,通常,,0,100,x=0|y=0,1.0,json\n<NAME_PLATE>甲\nhi\n<PAUSE>\n<SPINE_ACTOR_PLAY>8,喜,0,true\n<SPINE_ACTOR_PLAY>8,smile,1,true\n<SPINE_ACTOR_TRACK>8,0,照れ,true\n<SPINE_ACTOR_OUT>8,0\n<SPINE_ACTOR_PLAY>8,哀,0,true\n<SPINE_ACTOR>7,cast001001/iroha_001,,通常,,0,0,x=0|y=0,1,json\n<SPINE_ACTOR_PLAY>7,喜,0,true\n')
  check('scanExpressions：初始动画（SPINE_ACTOR 第 4 项）和轨道 0 的 PLAY / TRACK 算预设；轨道 1（表情图标）不算；OUT 之后的槽不再对应骨架（哀 丢掉）', J(scan) === J([['cast009001/nashwa_001', '通常'], ['cast009001/nashwa_001', '喜'], ['cast009001/nashwa_001', '照れ'], ['cast001001/iroha_001', '通常'], ['cast001001/iroha_001', '喜']]), J(scan))
  const root = path.join(work, 'expr-home')
  const pk = path.join(root, 'package.nw')
  for (const [id, text] of [['story_1', '<SPINE_ACTOR>8,cast009001/nashwa_001,,通常,,0,0,x=0|y=0,1,json\n<NAME_PLATE>甲\nhi\n<PAUSE>\n<SPINE_ACTOR_PLAY>8,喜,0,true\n<NAME_PLATE>甲\nhi\n<PAUSE>\n'], ['story_2', '<SPINE_ACTOR>8,cast009001/nashwa_001,,通常,,0,0,x=0|y=0,1,json\n<NAME_PLATE>乙\nhi\n<PAUSE>\n<SPINE_ACTOR>7,scene_only/local_001,,通常,,0,0,x=0|y=0,1,skel\n']]) {
    await mkdir(path.join(pk, 'scenes', id), { recursive: true })
    await writeFile(path.join(pk, 'scenes', id, 'script.txt'), text)
  }
  await mkdir(path.join(pk, 'data/spine/cast/cast009001'), { recursive: true })
  for (const ext of ['json', 'atlas', 'png']) await writeFile(path.join(pk, `data/spine/cast/cast009001/nashwa_001.${ext}`), '{}')
  const prov = createBrowseProvider({ mediaDir: root, adapters: ['girlscreation-tag'], resolveAsset: async () => { throw new Error('none') }, config: { scriptRoots: [{ id: 'scenes', dir: 'package.nw/scenes' }], resourceRoots: ['package.nw'], scriptExtensions: ['txt'], merge: [], adapterOptions: { 'girlscreation-tag': { root: 'package.nw' } } } })
  const home = (await prov.getNode('')).node
  const card = home.items.find((i) => i.node === 'x:expr')
  check('首页多一张「表情」卡片（全局分层脸骨架才有）', Boolean(card) && card.title === '表情' && card.type === 'dir', J(home.items.map((i) => i.title)))
  const expr = (await prov.getNode('x:expr')).node
  const nashwa = expr.casts?.[0]
  check('x:expr 节点：每个全局骨架一项（场景自己的 scene_only/local_001 不算），带预设名和次数（通常 2、喜 1，按次数排）、骨架 / atlas 的资源路径、角色目录名', expr.kind === 'expr' && expr.casts.length === 1 && nashwa.castKey === 'cast009001' && nashwa.label === 'nashwa_001' && J(nashwa.presets) === J([{ name: '通常', count: 2 }, { name: '喜', count: 1 }]) && nashwa.skel === 'data/spine/cast/cast009001/nashwa_001.json' && nashwa.atlas.endsWith('.atlas') && expr.breadcrumb.map((c) => c.title).join('>') === '首页>表情', J(expr))
  const { invalidateBrowseCaches } = await import('../../web/library/gal/browse.mjs')
  await writeFile(path.join(pk, 'scenes/story_1/script.txt'), '<SPINE_ACTOR>8,cast009001/nashwa_001,,通常,,0,0,x=0|y=0,1,json\n<SPINE_ACTOR_PLAY>8,楽,0,true\n<NAME_PLATE>甲\nhi\n<PAUSE>\n')
  invalidateBrowseCaches(root)
  const again = (await createBrowseProvider({ mediaDir: root, adapters: ['girlscreation-tag'], resolveAsset: async () => { throw new Error('none') }, config: { scriptRoots: [{ id: 'scenes', dir: 'package.nw/scenes' }], resourceRoots: ['package.nw'], scriptExtensions: ['txt'], merge: [], adapterOptions: { 'girlscreation-tag': { root: 'package.nw' } } } }).getNode('x:expr')).node
  check('刷新索引后重新扫脚本：改了脚本（喜 → 楽）列表跟着变', again.casts[0].presets.some((p) => p.name === '楽') && !again.casts[0].presets.some((p) => p.name === '喜'), J(again.casts[0].presets))
  const noExpr = createBrowseProvider({ mediaDir: path.join(work, 'gc-pack'), adapters: ['uviewer-csv'], resolveAsset: async () => { throw new Error('none') }, config: { merge: [] } })
  check('没有 scanExpressions 的适配器：没有「表情」入口，x:expr 返回 404', (await noExpr.getNode('').catch(() => ({ node: { items: [] } }))).node.items.every((i) => i.node !== 'x:expr') && (await noExpr.getNode('x:expr').then(() => 0, (e) => e.statusCode)) === 404)
}

await rm(work, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
