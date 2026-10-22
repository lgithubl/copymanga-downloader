#!/usr/bin/env node
// Gal 自测（不需要浏览器）：适配器 / 播放引擎 / 库类型 handler。需要 ImageMagick 和 python3（造测试数据）。
//   node scripts/dev/gal-selftest.mjs
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { galAdapterIds, registerGalAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { parse, parseCondition, parseRichText, sniff } from '../../web/library/gal/adapters/uviewer-csv.mjs'
import { DEFAULT_GAL_CONFIG, applyGalConfigPatch, cleanGalConfigRaw, expandTemplate, globToRegExp, normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { safeRelPath } from '../../web/library/gal/paths.mjs'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout-v1/main.js'
import { generateTags as monmusuScript } from '../../scripts/tag-scripts/gal-layout-monmusu/main.js'
import { parse as renpyParse, prepare as renpyPrepare, renpyText, sniff as renpySniff } from '../../web/library/gal/adapters/renpy-monmusu.mjs'
import { execFileSync } from 'node:child_process'
import { generateTags as tenkeiScript } from '../../scripts/tag-scripts/gal-layout-tenkeiprdx/main.js'
import { parse as tenkeiParse, prepare as tenkeiPrepare, sniff as tenkeiSniff } from '../../web/library/gal/adapters/tenkeiprdx-json.mjs'
import { buildMonmusuFixture, buildTenkeiFixture } from './make-gal-games-fixture.mjs'
import { buildScene, firstBackgroundSrc } from '../../web/library/gal/scene.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { activePath, applyCommand, assetUrl, backlog, choiceIn, commandDuration, condMet, dropChoicesFrom, ratioOfStep, stateAt, stepOfRatio } from '../../web/static/gal-engine.js'
import { buildGalFixture } from './make-gal-fixture.mjs'

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
  const out = await galLayoutScript({ item, script: { id: 'gal-layout-v1', version, options } })
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
check('脚本识别为 uviewer：写出脚本根（text + 另一套日文）、资源根、名称文件、缩略图目录；脚本数；封面（UViewer 生成的缩略图）；谁写的（版本）', out1.details.kind === 'uviewer' && M1.config.scriptRoots.length === 2 && M1.config.resourceRoots[0] === 'resources' && M1.config.namesFiles[0] === 'user_data/character_names.json' && M1.scriptCount >= 50 && M1.coverPath === '~/user_data/thumbnails/600130.webp' && /thumbnail\/script\/cover$/.test(M1.cover) && M1.config.script.id === 'gal-layout-v1' && M1.config.script.version === '1.0.0' && !!M1.config.script.ranAt, J(M1.config).slice(0, 400))
check('脚本打状态标签：Gal配置: uviewer、Gal配置version: 1.0.0、Gal游戏: uviewer（config.game 同步写入）', J(out1.itemTags) === J(['Gal配置: uviewer', 'Gal配置version: 1.0.0', 'Gal游戏: uviewer']) && M1.config.game.id === 'uviewer')
const again = await handler.importFromSource({})
const M2 = await handler.getItem(M.itemId)
check('重复导入：不新增条目，算更新；保留 tag、标题、创建时间、config（脚本写的）；条目 id 不变', again.report.imported === 0 && again.report.updated === 1 && (await handler.scanItems()).length === 1 && M2.tags.includes('手工标签') && M2.title === '改过的标题' && M2.createdAt === before && M2.itemId === M.itemId && J(M2.config) === J(M1.config), J(again.report))
const out2 = await runScript(M2, {}, '1.0.1')
await handler.patchItemMetadata(M.itemId, { gal: out2.itemPatch.gal })
check('脚本升级重跑：config.script.version 跟着变（知道现在用的是哪一版）；标签也变', (await handler.getItem(M.itemId)).config.script.version === '1.0.1' && out2.itemTags.includes('Gal配置version: 1.0.1'))

{
  const sub = await handler.importFromSource({ sourcePath: path.join(root, 'resources/download/adv/text/cabin'), options: { dryRun: true } })
  check('传别的目录 = 另一个媒体（dryRun 不写）；这个目录没按标准结构放：报告里提示，不拦截', sub.report.imported === 1 && sub.report.warnings.length === 1 && /gal-layout-v1/.test(sub.report.warnings[0]) && (await handler.scanItems()).length === 1, J(sub.report))
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
  check('多套了一层：默认脚本根不存在 → 导入报告提示；浏览是空的、带一条提示去跑脚本（不是报错）', (await handler.importFromSource({ sourcePath: wrap, options: { dryRun: true } })).report.warnings.length === 1 && (await wrapNode('')).items.length === 0 && /gal-layout-v1/.test((await wrapNode('')).notice))
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
  const imp = await handler.importFromSource({ sourcePath: mm, options: { adapters: ['renpy-monmusu'], config: { game: { id: 'monmusu', title: 'Mon Test' } }, defaultMetadataActions: ['gal-layout-monmusu'] } })
  const item0 = imp.items[0]
  check('导入：adapters / config.game 由导入参数写入；别的字段不存、不扫描', J(item0.adapters) === J(['renpy-monmusu']) && J(item0.config) === J({ game: { id: 'monmusu', title: 'Mon Test' } }), J(item0.config))
  check('config.game.id 不合法（空格/空）= 没有 game；adapterOptions 只收对象、过大的丢弃；groups 的 pattern 必须有捕获组、必须是合法正则', normalizeGalConfig({ game: { id: 'a b' } }).game === null && normalizeGalConfig({ game: {} }).game === null && J(normalizeGalConfig({ adapterOptions: { 'renpy-monmusu': { a: 1 }, bad: 5, 'X Y': {}, big: { s: 'x'.repeat(9000) } } }).adapterOptions) === J({ 'renpy-monmusu': { a: 1 } }) && J(normalizeGalConfig({ groups: [{ parent: '.', pattern: '^\\d+' }, { parent: '.', pattern: '(' }, { parent: '.', pattern: '^(\\d{5})' }, { parent: '..', pattern: '(a)' }] }).groups) === J([{ parent: '.', pattern: '^(\\d{5})' }]))

  // 脚本：不归它管的跳过
  const skipUv = await monmusuScript({ item: M2, script: { id: 'gal-layout-monmusu', version: '1.0.0', options: {} } })
  const skipV1 = await galLayoutScript({ item: item0, script: { id: 'gal-layout-v1', version: '1.1.0', options: {} } })
  check('不归它管的跳过：uviewer 的媒体不被 monmusu 脚本动；monmusu 的媒体不被 gal-layout-v1 动（都不返回 itemPatch）', !skipUv.itemPatch && !skipV1.itemPatch && /不归本脚本/.test(skipV1.logs.join('\n')) && /不归本脚本/.test(skipUv.logs.join('\n')), J([skipUv.logs, skipV1.logs]))
  const nothing = await monmusuScript({ item: { ...M2, config: {}, source: { path: root } }, script: { id: 'gal-layout-monmusu', version: '1.0.0', options: {} } })
  check('没有 game.id 又认不出结构：不认领', !nothing.itemPatch && /没找到 script\/hscene/.test(nothing.logs.join('\n')))

  const out = await monmusuScript({ item: item0, script: { id: 'gal-layout-monmusu', version: '1.0.0', options: {} } })
  const cfg = out.itemPatch.gal.config
  check('monmusu 脚本：游戏根（多一层 game/）、脚本根、资源根、合并 hscene+hscene_still（anim/still）、按编号分组、隐藏导航目录、适配器参数（别名表/图片目录）', cfg.game.id === 'monmusu' && cfg.game.title === 'Mon Test' && cfg.scriptRoots[0].dir === 'game/script' && J(cfg.resourceRoots) === J(['game']) && J(cfg.scriptExtensions) === J(['rpy']) && J(cfg.merge) === J([{ parent: '.', dirs: ['hscene', 'hscene_still'], badges: { hscene: 'anim', hscene_still: 'still' } }]) && cfg.groups[0].pattern === '^(\\d{5})[A-Za-z]\\d' && cfg.hiddenDirs.includes('sub_nav') && J(cfg.adapterOptions['renpy-monmusu']) === J({ aliasFiles: ['game/script/movie.rpy'], imageDirs: ['game/images'] }), J(cfg))
  check('头像模板来自 images 里找到的 icon；封面 = 第一个头像；脚本数；谁写的；标签 Gal游戏: monmusu', J(cfg.dirThumbs) === J([{ parent: '*', name: '^\\d{3,8}$', paths: ['images/icon/icon_{name}_0_idle.png'] }]) && cfg.cover === 'images/icon/icon_10001_0_idle.png' && cfg.scriptCount === 4 && cfg.script.id === 'gal-layout-monmusu' && J(out.itemTags) === J(['Gal配置: monmusu', 'Gal配置version: 1.0.0', 'Gal游戏: monmusu']), J([cfg.dirThumbs, cfg.cover, cfg.scriptCount, out.itemTags]))
  await handler.patchItemMetadata(item0.itemId, { gal: out.itemPatch.gal })
  const it = await handler.getItem(item0.itemId)
  check('写回后：封面接口、脚本数、adapters 都在', /thumbnail\/script\/cover$/.test(it.cover) && it.scriptCount === 4 && J(it.adapters) === J(['renpy-monmusu']) && (await handler.getThumbnail(item0.itemId)).contentType === 'image/png')

  const read = (sectionId) => handler.getReaderContent(it.itemId, 'main', { sectionId })
  const home = (await read('')).node
  check('首页：按角色编号分组成卡片（10001 三个脚本、10004 一个）；导航界面目录/非剧情脚本不出现；头像来自模板', home.kind === 'cards' && J(home.items.map((i) => [i.title, i.subtitle])) === J([['10001', '3 项'], ['10004', '1 项']]) && home.items.every((i) => i.type === 'dir' && i.thumb === 'images/icon/icon_' + i.title + '_0_idle.png' && !i.badge), J(home.items))
  const group = (await read(home.items[0].node)).node
  check('分组页：动画 + 静图混排，来源角标 anim / still；返回 = 首页；面包屑 首页 › 10001', J(group.items.map((i) => [i.title, i.badge])) === J([['10001A1', 'anim'], ['10001B1', 'anim'], ['10001C1', 'still']]) && group.parent === '' && J(group.breadcrumb.map((c) => c.title)) === J(['首页', '10001']) && group.total === 3, J(group))
  check('分组页：静图脚本有缩略图（脚本里第一张存在的背景图）；动画脚本带「含视频」', group.items[2].thumb === 'images/bg/r18_10001_stla1.png' && /含视频/.test(group.items[0].subtitle), J(group.items))
  const a1 = await read(group.items[0].node)
  const cmds = a1.scene.steps.flatMap((s) => s.commands)
  check('播放页：视频别名查表成 movie（路径相对游戏根）；bgm / voice / 台词都在；上一话/下一话只在这个角色的分组里', a1.node.kind === 'player' && cmds.some((c) => c.op === 'movie' && c.srcs[0] === 'images/webm/10001/rev10001_01_10.webm') && cmds.some((c) => c.op === 'bgm' && c.src === 'audio/bgm/b.mp3') && cmds.some((c) => c.op === 'voice') && a1.scene.steps.length === 2 && a1.sectionNavigation.prev === null && a1.sectionNavigation.next.title === '10001B1', J(a1.sectionNavigation))
  check('播放页：父节点 = 所在分组；面包屑 首页 › 10001 › 10001A1', a1.node.parent === group.items[0].node.replace(/^.*$/, group.node?.id || group.id) && J(a1.node.breadcrumb.map((c) => c.title)) === J(['首页', '10001', '10001A1']), J([a1.node.parent, group.id, a1.node.breadcrumb]))
  const c1 = await read(group.items[2].node)
  check('静图脚本：图片按文件名查到（资源路径去掉资源根）；查不到的 raw；分组里最后一个没有下一话；10004 的上一话不会跳到 10001', c1.scene.steps[0].commands.some((c) => c.op === 'bg' && c.src === 'images/bg/r18_10001_stla1.png') && c1.scene.steps[1].commands[0].op === 'raw' && c1.sectionNavigation.next === null && c1.sectionNavigation.prev.title === '10001B1' && (await read(home.items[1].node)).node.items.length === 1)
  check('资源：语音/背景/视频路径相对游戏根能取到；目录穿越被拒', (await handler.getResource(it.itemId, 'audio/bgm/b.mp3')).contentType === 'audio/mpeg' && (await handler.getResource(it.itemId, 'images/bg/r18_10001_stla1.png')).contentType === 'image/png' && Boolean(await err(handler.getResource(it.itemId, '../script/movie.rpy'))))
  check('节点 id：分组键编码；格式不对/不存在的分组报错', (await err(read('g:%E0%A4%A:'))) !== null && /分组不存在/.test((await err(read('g:99999:')))?.message || '') && /无效/.test((await err(read('g::')))?.message || ''), '')
  const lastHome = await read(`g:${encodeURIComponent('10001')}:`)
  check('分组 id 带页码也能解析（超页取最后一页）', lastHome.node.page === 1)

  // 改了别名表（没改脚本）：上下文跟着文件变
  await put('script/movie.rpy', "image 10001A1-10 = Movie(play = 'images/webm/10001/NEW.webm',loop = True)\n")
  const a1b = await read(group.items[0].node)
  check('别名表改了：下次读脚本用新的（上下文按文件 mtime/size 失效）', a1b.scene.steps[0].commands.some((c) => c.op === 'movie' && c.srcs[0] === 'images/webm/10001/NEW.webm'), J(a1b.scene.steps[0].commands))
  // 用户自己的覆盖：脚本 overrides 能改任何字段
  const ovr = await monmusuScript({ item: it, script: { id: 'gal-layout-monmusu', version: '1.0.1', options: { overrides: [{ path: '*mm-pack', config: { pageSize: 1 }, title: 'Renamed' }] } } })
  check('overrides：按路径命中、覆盖 config、改标题；状态标签变「自定义」', ovr.itemPatch.gal.config.pageSize === 1 && ovr.itemPatch.title === 'Renamed' && ovr.itemTags[0] === 'Gal配置: 自定义')
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
  const imp = await handler.importFromSource({ sourcePath: tk, options: { adapters: ['tenkeiprdx-json'], config: { game: { id: 'tenkeiprdx' } }, defaultMetadataActions: ['gal-layout-tenkeiprdx'] } })
  const item0 = imp.items[0]
  const skipV1 = await galLayoutScript({ item: item0, script: { id: 'gal-layout-v1', version: '1.1.0', options: {} } })
  const skipMm = await monmusuScript({ item: item0, script: { id: 'gal-layout-monmusu', version: '1.0.0', options: {} } })
  const skipTk = await tenkeiScript({ item: M2, script: { id: 'gal-layout-tenkeiprdx', version: '1.0.0', options: {} } })
  const none = await tenkeiScript({ item: { ...M2, config: {}, source: { path: root } }, script: { id: 'gal-layout-tenkeiprdx', version: '1.0.0', options: {} } })
  check('不归它管的跳过：v1 / monmusu 脚本不动 tenkeiprdx 的媒体；tenkeiprdx 脚本不动 uviewer 的；没有 game 又认不出结构不认领', !skipV1.itemPatch && !skipMm.itemPatch && !skipTk.itemPatch && !none.itemPatch && /没找到 scenes/.test(none.logs.join('\n')))
  const out = await tenkeiScript({ item: item0, script: { id: 'gal-layout-tenkeiprdx', version: '1.0.0', options: {} } })
  const cfg = out.itemPatch.gal.config
  check('脚本：素材根（外面套了 StreamingAssets/Tenkeiprdx X/）、脚本根 scenes、资源根、扩展名 json、适配器参数 root、脚本索引（event / extra，键 2{1}{2}）', cfg.game.id === 'tenkeiprdx' && cfg.scriptRoots[0].dir === 'StreamingAssets/Tenkeiprdx X/Imported/scenes' && J(cfg.resourceRoots) === J(['StreamingAssets/Tenkeiprdx X/Imported']) && J(cfg.scriptExtensions) === J(['json']) && cfg.adapterOptions['tenkeiprdx-json'].root === 'StreamingAssets/Tenkeiprdx X/Imported' && J(cfg.scriptIndex.map((r) => [r.dir.split('/').pop(), r.key, r.badge])) === J([['event', '2{1}{2}', 'event'], ['extra', '2{1}{2}', 'extra']]) && cfg.scriptCount === 3 && cfg.cover === 'EpisodeThumbnails/event/ep_eventstill_001_0001_thumb.png' && J(out.itemTags) === J(['Gal配置: tenkeiprdx', 'Gal配置version: 1.0.0', 'Gal游戏: tenkeiprdx']), J(cfg))
  await handler.patchItemMetadata(item0.itemId, { gal: out.itemPatch.gal })
  const it = await handler.getItem(item0.itemId)
  const read = (sectionId) => handler.getReaderContent(it.itemId, 'main', { sectionId })
  const home = (await read('')).node
  check('首页：三个剧情（自然序）；event / extra 角标和缩略图来自文件名推出的剧情 id（2+a+b）；没有缩略图的剧情没有角标（缩略图退回到脚本里第一张背景）', J(home.items.map((i) => [i.title, i.badge])) === J([['10010101', ''], ['20010001', 'event'], ['23010001', 'extra']]) && home.items[0].thumb === 'Backgrounds/adventure/bg_adventure_001.png' && home.items[1].thumb === 'EpisodeThumbnails/event/ep_eventstill_001_0001_thumb.png', J(home.items))
  const story = await read(home.items[0].node)
  const cmds = story.scene.steps.flatMap((x) => x.commands)
  check('剧情播放页：资源路径相对素材根；立绘两种骨骼格式的路径都查到；语音目录用文件名当场景 id；username 来自 Masterdata', story.scene.steps.length === 4 && cmds.find((c) => c.op === 'bgm').src === 'BGM/bgm_a_loop.ogg' && cmds.find((c) => c.op === 'voice').src === 'AdventureVoice/10010101/v002.ogg' && cmds.some((c) => c.op === 'spine' && c.skel === 'Spines/1002/1002_01.skel.bytes') && cmds.some((c) => c.op === 'speaker' && c.segments[0]?.text === 'Tester') && Object.keys(story.scene.stats.unresolved).length === 0 && story.sectionNavigation.next.title === '20010001', J(story.scene.stats))
  const still = await read(home.items[1].node)
  check('静态画面剧情：两层骨架（按数字前缀）、镜头、联动音效、闪白都在', still.scene.steps[0].commands.filter((c) => c.op === 'spine').map((c) => c.skel).join() === 'Stills/h_still_01/1_base.skel.bytes,Stills/h_still_01/2_over.skel.bytes' && still.scene.steps[0].commands.some((c) => c.op === 'camera') && still.scene.steps[1].commands.some((c) => c.op === 'bgse' && c.src === 'BgSe/Hse2.ogg') && still.scene.steps[2].commands.some((c) => c.op === 'flash'))
  const extra = await read(home.items[2].node)
  check('extra 剧情：背景名带 still_ 的在 Backgrounds/still 里找到；frameEffect 原样记在 stats', extra.scene.steps[0].commands.find((c) => c.op === 'bg').src === 'Backgrounds/still/bg_still_03.png' && extra.scene.stats.frameEffects.shake === 1, J(extra.scene.stats))
  check('资源：骨骼 / atlas / 图集 png / ogg 都能取；目录穿越被拒', (await handler.getResource(it.itemId, 'Spines/1001/1001_01.skel.bytes')).body.length > 20 && (await handler.getResource(it.itemId, 'Spines/1001/1001_01.atlas.txt')).body.toString().includes('size: 64,64') && (await handler.getResource(it.itemId, 'Spines/1001/1001_01.png')).contentType === 'image/png' && (await handler.getResource(it.itemId, 'AdventureVoice/10010101/v002.ogg')).contentType === 'audio/ogg' && Boolean(await err(handler.getResource(it.itemId, '../x'))) && (await handler.getThumbnail(it.itemId)).contentType === 'image/png')
  check('config.scriptIndex 规整：目录必须安全、pattern 必须是合法正则、key 默认 {1}', J(normalizeGalConfig({ scriptIndex: [{ dir: 'a/b', pattern: '^x(\\d)' }, { dir: '../a', pattern: 'x' }, { dir: 'a', pattern: '(' }, { dir: '', pattern: 'x' }] }).scriptIndex) === J([{ dir: 'a/b', pattern: '^x(\\d)', key: '{1}', badge: '' }]))
  void imported
}

await rm(work, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
