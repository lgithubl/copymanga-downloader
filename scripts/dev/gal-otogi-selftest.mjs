#!/usr/bin/env node
// 纯 node 自测（不需要浏览器 / 服务）：Otogi Frontier R（离线网页版的剧情 JSON，没有扩展名，otogi-json）——
//   适配器：sniff / explainSniff（普通 / 成人 / 缩进 + BOM / 数组 / 不认的）、参数规整（默认值 = DEFAULT_OPTIONS，表类逐项覆盖，写坏回退）、
//   普通剧情：背景 / BGM / SE / 语音 / 特效 / 左右立绘（body + 表情叠层、同一角色在另一边就收掉、旁白保留立绘、IsBackgroundOnly 收掉）/ 空 Phrase 并入下一句 / 未知特效 raw / 缺语音不发指令只计数；
//   成人剧情：spine still（x / y / scale 来自 list.json）、CharaAnimation / Motion / 特效、没有骨架记 unresolved、缺语音；顶层是数组的 TW 文件；列表（主线 / 角色 / 全部）+ 语言选择（jp / cn / tw，缺的退回日文）；
//   引擎：config.scriptExtensions 的 ''（没有扩展名）、目录浏览能列出没有扩展名的脚本、catalog 节点 / 播放页、gal-layout 探测（含多一层目录 / decoy）。
//   node scripts/dev/gal-otogi-selftest.mjs     需要 ImageMagick（造 fixture）。浏览器部分见 fe-gal-otogi-selftest.mjs
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'
import { galAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { DEFAULT_OPTIONS, catalog, contextDirs, contextFiles, explainSniff, health, parse, resolveOptions, sniff } from '../../web/library/gal/adapters/otogi-json.mjs'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { buildOtogiFixture } from './make-otogi-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'otogi-node-'))
const media = path.join(dataDir, 'gal', 'Otogi演示')
await buildOtogiFixture(media)
const at = (rel) => path.join(media, ...rel.split('/'))
const read = (rel) => readFile(at(rel), 'utf8')

// ---------- (1) 适配器 ----------
const adapter = galAdapter('otogi-json')
const configOf = (options = {}, extra = {}) => normalizeGalConfig({ resourceRoots: [''], scriptExtensions: [''], adapterOptions: { 'otogi-json': options }, ...extra })
const ctxOf = (options = {}) => loadAdapterContext({ adapter, mediaDir: media, config: configOf(options) })
const flat = (out) => out.steps.flatMap((s) => s.commands)
const textsOf = (out) => out.steps.map((s) => s.commands.find((c) => c.op === 'text')?.segments?.[0]?.text)
let ctx
{
  const normalText = await read('typeadv/MScenes/3')
  const prettyText = await read('typeadv/MScenes/4')
  const adultText = await read('json/1200051')
  ctx = await ctxOf()
  const play = (text, stem, c = ctx, extra = {}) => parse(text, c, { stem, options: {}, ...extra })

  // -- sniff
  check('sniff：普通 / 成人 / 缩进 + BOM 的都认；注册表里按内容认出 otogi-json', sniff(normalText) && sniff(adultText) && sniff(prettyText) && sniff(await read('jsoncn/1200051')) && [normalText, adultText, prettyText].every((t) => sniffGalAdapter(t) === 'otogi-json'), J(explainSniff(prettyText)))
  check('explainSniff：kind normal / adult，BOM / 缩进不影响；数组 = array: true', explainSniff(normalText).kind === 'normal' && explainSniff(adultText).kind === 'adult' && explainSniff(prettyText).ok && explainSniff(await read('typeadv/MScenes_TW/3')).array === true && explainSniff(normalText).array === false, J(explainSniff(await read('typeadv/MScenes_TW/3'))))
  const rejects = ['', '   ', 'this is not a scene', '[1,2,3]', '"just a string"', '42', 'null', '{"a":1}', '[]', '{"Id":1,"Title":"x"}', '{"Id":1,"Title":"x","Other":[]}', '[{"a":1}]', '{"Title":"x","Id":1,"MSceneDetails":[]}', '<easy_dialog-1 id="1"/>', '{"data":{"code":{}}}']
  check('sniff：空 / 非 JSON / 顶层不是剧情对象的 JSON（数字、字符串、没有 Id…行数组头的对象、别的格式）都不认', rejects.every((t) => !sniff(t) && sniffGalAdapter(t) !== 'otogi-json'), J(rejects.filter((t) => sniff(t))))
  check('sniff：行数组键名 / 读取字节数可配（options.sniff）', sniff('{"Id":1,"Title":"x","Lines":[]}', { sniff: { normal: 'Lines' } }) && !sniff('{"Id":1,"Title":"x","Lines":[]}') && !sniff(`{"Id":1,"Title":"${'x'.repeat(300)}","MSceneDetails":[]}`, { sniff: { bytes: 256 } }), '')
  check('sniff：别的游戏的脚本不会被 otogi 认走（grenze xml / 带 MSceneDetails 字样但不在开头）', !sniff(`{"x":"a","Id":1,"MSceneDetails":[]}`) && sniffGalAdapter('<easy_dialog-1 id="1" text="a"/>') === 'grenze-xml', '')

  // -- 参数
  const defaults = resolveOptions(null)
  check('参数：不写 = DEFAULT_OPTIONS（纯 JSON 数据、可序列化）；resolveOptions 对同一个对象只算一次', J(JSON.parse(J(DEFAULT_OPTIONS))) === J(DEFAULT_OPTIONS) && defaults.lang === 'jp' && defaults.protagonist === '人間' && defaults.positions['2'] === 'left' && defaults.positions['3'] === 'right' && defaults.emotions['8'] === 'violent' && defaults.anim['3'].loop === false && defaults.effects.Flash[0].op === 'wash' && (() => { const o = {}; return resolveOptions(o) === resolveOptions(o) })(), J(defaults).slice(0, 300))
  const custom = resolveOptions({ lang: 'TW', protagonist: '主人', positions: { 4: 'center' }, emotions: { 9: 'cry' }, anim: { 5: { anim: 'animation5', loop: false } }, effects: { Blur: [{ op: 'shake', axis: 'overall', strength: 0.2, seconds: 0.4 }, { op: 'evil' }] }, stand: { narration: 'hide', dim: 0.4, layers: ['{emotion}'] }, langs: { fr: { normal: ['x'], adult: ['y'] } }, paths: { bgm: ['music/{name}.{ext}'] } })
  check('参数：表类逐项覆盖 / 追加（positions / emotions / anim / effects / langs 不丢默认项）；lang 不分大小写；非法的 effect op 丢掉；列表整个替换', custom.lang === 'tw' && custom.protagonist === '主人' && custom.positions['4'] === 'center' && custom.positions['2'] === 'left' && custom.emotions['9'] === 'cry' && custom.emotions['1'] === 'idle' && custom.anim['5'].anim === 'animation5' && custom.anim['1'].anim === 'animation1' && J(custom.effects.Blur) === J([{ op: 'shake', axis: 'overall', strength: 0.2, seconds: 0.4 }]) && custom.effects.Flash.length === 1 && custom.stand.narration === 'hide' && custom.stand.dim === 0.4 && J(custom.stand.layers) === J(['{emotion}']) && J(custom.langs.fr) === J({ normal: ['x'], adult: ['y'] }) && custom.langs.cn.adult[0] === 'jsoncn' && J(custom.paths.bgm) === J(['music/{name}.{ext}']), J(custom).slice(0, 400))
  const broken = resolveOptions({ lang: 'klingon', protagonist: 5, positions: 'x', stand: { fit: 'x', dim: 7 }, anim: { 1: 'oops', 6: { loop: false } }, motion: { fastFactor: -1, zero: 'a' }, paths: { bg: 'not an array', voice: [] }, idPattern: '(a+)+$', arrayScenes: 'weird', sniff: { bytes: 5 } })
  check('参数：写坏了的字段退回默认（lang 不认识 → jp、类型不对、危险正则 → 默认 ^\\d+$、arrayScenes 只认 first / all、sniff.bytes 夹在 256..65536）', broken.lang === 'jp' && broken.positions['2'] === 'left' && broken.stand.dim === 0 && broken.anim['1'].anim === 'animation1' && !('6' in broken.anim) && broken.motion.fastFactor === 0.75 && broken.motion.zero === 0.01 && J(broken.paths.bg) === J(DEFAULT_OPTIONS.paths.bg) && J(broken.paths.voice) === J([]) && broken.idRe.test('123') && !broken.idRe.test('12a') && broken.arrayScenes === 'first' && broken.sniff.bytes === 256, J(broken).slice(0, 300))
  check('适配器的上下文参数：contextDirs ≤ 10 个（引擎的上限）、contextFiles = list.json + MMonsters.json；根目录前缀；遍历上限 ≥ 40 万、抽样上限 20000；抽样过滤只读 MScenes / VieableEpisodeList / Episode/Main', contextDirs(null).length <= 10 && J(contextFiles({ root: 'G' })) === J(['G/list.json', 'G/MasterData/MMonsters.json']) && contextDirs({ root: 'G' })[0] === 'G/typeadv' && adapter.contextWalkLimit >= 400000 && adapter.contextSampleLimit === 20000 && (() => { const f = adapter.contextTextFilter({}); return f('typeadv/MScenes/3') && f('VieableEpisodeList/1') && f('Episode/Main/1001') && !f('typeadv/MScenes_TW/3') && !f('json/1') })(), '')

  // -- 普通剧情（scene 3）
  const s3 = play(normalText, '3')
  const all = flat(s3)
  check('普通剧情 3：9 行 → 8 步（行 6 是空 Phrase，并进下一句）；统计：行 9、场景 1', s3.steps.length === 8 && s3.stats.rows === 9 && s3.stats.scenes === 1 && J(s3.steps.map((s) => s.index)) === J([0, 1, 2, 3, 4, 5, 6, 7]), J(s3.stats))
  check('文字：%user_name → protagonist（默认 人間）；Position 1 = 旁白（说话人空）；Position 2 / 3 = Name；说话人变了才发 speaker；<br> → 换行', textsOf(s3)[0] === '人間 arrives at the little island.' && J(s3.steps[0].commands.find((c) => c.op === 'speaker')) === J({ op: 'speaker', segments: [] }) && J(s3.steps[1].commands.find((c) => c.op === 'speaker')) === J({ op: 'speaker', segments: [{ text: 'Alice' }] }) && textsOf(s3)[2] === 'Hi, 人間.' && !s3.steps[3].commands.some((c) => c.op === 'speaker') && textsOf(s3)[6] === 'The end\nsecond line for 人間.', J(textsOf(s3)))
  check('背景 / BGM：bg 先试 typeadv/bg/adventure/<名>.png 再试平铺的 typeadv/bg/<名>.png；bgm/<名>.m4a；同一个值不重复发', J(s3.steps[0].commands.filter((c) => ['bg', 'bgm'].includes(c.op))) === J([{ op: 'bg', src: 'typeadv/bg/adventure/bg_adventure_0001.png', fade: 0 }, { op: 'bgm', src: 'bgm/bgm_adv_03.m4a' }]) && all.filter((c) => c.op === 'bg').length === 2 && all.some((c) => c.op === 'bg' && c.src === 'typeadv/bg/bg_adventure_0002.png') && all.filter((c) => c.op === 'bgm').length === 1, J(all.filter((c) => c.op === 'bg')))
  check('SE / 语音：typeadv/voice/adventure/voice_adventure_<MSceneId>/<名>.m4a；找不到的语音不发指令（不会请求 404），记 stats.missing.voice，不算 unresolved', J(s3.steps[1].commands.filter((c) => ['se', 'voice'].includes(c.op))) === J([{ op: 'se', src: 'typeadv/voice/adventure/voice_adventure_3/se_adv_09.m4a' }, { op: 'voice', src: 'typeadv/voice/adventure/voice_adventure_3/m1_001.m4a' }]) && all.filter((c) => c.op === 'voice').length === 1 && s3.stats.missing.voice === 1 && J(s3.stats.voices) === J({ total: 2, found: 1, missing: 1 }) && Object.keys(s3.stats.unresolved).length === 0, J([s3.stats.missing, s3.stats.voices, s3.stats.unresolved]))
  check('Effect：Flash → wash 白（1.04 秒）、Damage → wash 红；不认识的值（Weird）→ raw {cmd: Effect} + stats.raw；空的不发', J(all.filter((c) => c.op === 'wash')) === J([{ op: 'wash', color: 'white', seconds: 1.04 }, { op: 'wash', color: 'red', seconds: 1.04 }]) && J(all.filter((c) => c.op === 'raw')) === J([{ op: 'raw', cmd: 'Effect', args: ['Weird'] }]) && J(s3.stats.raw) === J({ 'Effect:Weird': 1 }), J(s3.stats.raw))
  const standOf = (step) => s3.steps[step].commands.find((c) => c.op === 'stand')?.parts
  const stand = (id, name, align) => ({ src: `typeadv/CharaStand/Adventure/${id}/${name}.png`, align, fit: 1 })
  check('立绘（Position 2 = 左）：body + 表情叠层，顺序 body → <表情>_c → <表情>（原页面的 CSS 背景层 emo.png 在 emo_c.png 上面）', J(standOf(1)) === J([stand(10011, 'body', 'left'), stand(10011, 'idle_c', 'left'), stand(10011, 'idle', 'left')]), J(standOf(1)))
  check('立绘（Position 3 = 右）：两边都在时说话的一边最后画（在上面）；EmotionId 4 = angry', J(standOf(2)) === J([stand(10011, 'body', 'left'), stand(10011, 'idle_c', 'left'), stand(10011, 'idle', 'left'), stand(10021, 'body', 'right'), stand(10021, 'angry_c', 'right'), stand(10021, 'angry', 'right')]), J(standOf(2)))
  check('立绘：同一个角色（10021）又出现在 Position 2 → 右边那个收掉，只剩左边', J(standOf(3)) === J([stand(10021, 'body', 'left'), stand(10021, 'angry_c', 'left'), stand(10021, 'angry', 'left')]), J(standOf(3)))
  check('立绘：Position 1 的旁白行不特殊处理（既不收也不换立绘，完全看脚本）', !s3.steps[4].commands.some((c) => c.op === 'stand' || c.op === 'standOff'), J(s3.steps[4].commands))
  check('立绘：表情文件不存在（violent）→ 只剩 body，记 stats.missing（face:…），不进 unresolved；IsBackgroundOnly → standOff', J(standOf(5)) === J([stand(10011, 'body', 'left')]) && s3.stats.missing['face:10011/violent'] === 1 && s3.stats.missing['face:10011/violent_c'] === 1 && s3.steps[6].commands[0].op === 'standOff' && s3.stats.stands === 4, J([standOf(5), s3.stats.missing]))
  const dimmed = play(normalText, '3', ctx, { options: { stand: { dim: 0.5 } } })
  check('stand.dim：不说话的一边压暗（两边都在时才有）；fit = 0 不带 fit', dimmed.steps[2].commands.find((c) => c.op === 'stand').parts.filter((p) => p.dim === 0.5).length === 3 && dimmed.steps[1].commands.find((c) => c.op === 'stand').parts.every((p) => p.dim === undefined) && !play(normalText, '3', ctx, { options: { stand: { fit: 0 } } }).steps[1].commands.find((c) => c.op === 'stand').parts[0].fit, '')
  const custom3 = play(normalText, '3', ctx, { options: { protagonist: '主人', positions: { 2: 'right', 3: 'left' }, emotions: { 1: 'joy' }, text: { breakPattern: '' }, effects: { Flash: [] } } })
  check('参数生效：protagonist、positions（2 → 右）、emotions（1 → joy，文件不存在 → 只有 body）、text.breakPattern 空 = 不处理 <br>、effects 的 Flash 清空', textsOf(custom3)[0].startsWith('主人 ') && custom3.steps[1].commands.find((c) => c.op === 'stand').parts[0].align === 'right' && custom3.stats.missing['face:10011/joy'] === 1 && textsOf(custom3)[6].includes('<br>') && !flat(custom3).some((c) => c.op === 'wash' && c.color === 'white'), J(custom3.stats))
  const sized = play(normalText, '3', ctx, { options: { text: { sizeMap: { 2: 36 } } } })
  check('text.sizeMap：PhraseFontSize 2 → style.size 36（只有带 PhraseFontSize 的行）', sized.steps[1].commands.find((c) => c.op === 'text').segments[0].style?.size === 36 && !sized.steps[0].commands.find((c) => c.op === 'text').segments[0].style, '')
  const bare = flat(play(normalText, '3', null))
  check('没有文件索引（ctx 为空）：按每个列表的第一条模板猜，不过滤（缺的语音也发指令）', bare.some((c) => c.op === 'voice' && c.src.endsWith('/m1_missing.m4a')) && bare.some((c) => c.op === 'bg' && c.src === 'typeadv/bg/adventure/bg_adventure_0002.png') && bare.find((c) => c.op === 'stand').parts.length === 3, J(bare.filter((c) => c.op === 'voice')))
  check('表驱动：paths 换模板（bgm 放别的目录）→ 找不到记 unresolved:bgm:…；positions 里没有的 Position 当旁白', Object.keys(play(normalText, '3', ctx, { options: { paths: { bgm: ['music/{name}.{ext}'] } } }).stats.unresolved).join() === 'bgm:bgm_adv_03' && !play(normalText, '3', ctx, { options: { positions: { 2: 'narration' } } }).steps[1].commands.some((c) => c.op === 'stand'), '')
  const pretty = play(prettyText, '4')
  check('缩进 + BOM 的剧情：照常解析（2 句）', pretty.steps.length === 2 && textsOf(pretty)[1] === 'Second scene, line two.', J(textsOf(pretty)))

  // -- 数组 / 坏输入 / 富文本
  const tw3 = await read('typeadv/MScenes_TW/3')
  const twFirst = play(tw3, '3')
  const twAll = play(tw3, '3', ctx, { options: { arrayScenes: 'all' } })
  check('顶层是数组（MScenes_TW/3）：默认只播第一个场景（2 句），arrayScenes = all 依次全播（3 句）；TW 文字、stats.arrayTop = 2', twFirst.steps.length === 2 && textsOf(twFirst)[0].startsWith('[TW]') && twAll.steps.length === 3 && textsOf(twAll)[2] === 'Only if arrayScenes is all.' && twAll.stats.scenes === 2 && twFirst.stats.arrayTop === 2, J([textsOf(twFirst), textsOf(twAll)]))
  const thrown = (text) => { try { parse(text, ctx, { options: {} }); return '' } catch (error) { return error.message } }
  check('坏输入：不是 JSON / 不是剧情对象都抛错并说明原因（不崩）', /合法的 JSON/.test(thrown('{not json')) && /不是 Otogi 的剧情/.test(thrown('{"a":1}')) && /不是 Otogi 的剧情/.test(thrown('[1,2]')), J([thrown('{not json'), thrown('{"a":1}')]))
  const rich = parse('{"Id":9,"Title":"r","MSceneDetails":[],"MRichSceneDetails":[{"Bgm":"x"}]}', ctx, { options: {} })
  check('MRichSceneDetails（原页面的另一种剧情，没有样本）：不崩，记 raw + stats.raw；空剧情也给一步', J(rich.stats.raw) === J({ MRichSceneDetails: 1 }) && rich.steps.length === 1 && parse('{"Id":9,"Title":"e","MSceneDetails":[]}', ctx, { options: {} }).steps.length === 1, J(rich))

  // -- 成人剧情
  const a1 = play(adultText, '1200051')
  const spines = flat(a1).filter((c) => c.op === 'spine')
  const SKEL = 'chara/still/1200051/1200051.json'
  const ATLAS = 'chara/still/1200051/1200051.atlas.txt'
  const spineOp = (anim, loop, speed) => ({ op: 'spine', slot: 'still1', kind: 'still', skel: SKEL, atlas: ATLAS, anim, loop, speed, order: 1, x: 10, y: -20, scale: 1.25 })
  check('成人剧情：6 行 → 6 步；文字 / 说话人（%user_name 也换）；spine still（chara/still/<Id>/<Id>.json + .atlas.txt），x / y / scale 来自 list.json data[<Id>]["1"]', a1.steps.length === 6 && textsOf(a1)[0] === '人間, hello.' && J(a1.steps[0].commands.find((c) => c.op === 'spine')) === J(spineOp('animation1', true, 1)) && J(a1.steps[1].commands.find((c) => c.op === 'speaker')) === J({ op: 'speaker', segments: [] }), J(a1.steps[0].commands))
  check('CharaAnimation：1 → animation1 循环；2 → animation2；3 → animation3 播一次、速度 0.5；4 → animation4；null 不变（只在变了才发 spine）', J(spines.map((c) => [c.anim, c.loop])) === J([['animation1', true], ['animation2', true], ['animation3', false], ['animation4', true]]) && spines[2].speed === 0.5, J(spines.map((c) => [c.anim, c.loop, c.speed])))
  check('Motion → speed：1 = 1；2 > 1 → 2 × 0.75 = 1.5；CharaAnimation 3 的行不看 Motion（0.5）；Motion 0 → motion.zero（0.01，spine 指令不认 0）', J(spines.map((c) => c.speed)) === J([1, 1.5, 0.5, 0.01]), J(spines.map((c) => c.speed)))
  check('特效：Effect "2" → 黑场渐退 0.52 秒（wash black）；CharaAnimation 3 → 白闪（flash 3 秒）；Effect "1" 原页面不处理，认得但没有指令', J(a1.steps[2].commands.filter((c) => ['wash', 'flash'].includes(c.op))) === J([{ op: 'wash', color: 'black', seconds: 0.52 }, { op: 'flash', color: 'white', count: 1, seconds: 3 }]) && !a1.steps[4].commands.some((c) => c.op === 'wash') && !('Effect:1' in a1.stats.raw), J(a1.steps[2].commands))
  check('成人剧情的声音：BGM bgm_10；Voice 在 othersounds/still/<Id>/<名>.m4a（缺的不发指令、记 missing.voice）；SE 非空 → raw（原页面不处理）；StillPath 忽略（stats.ignored）；Serif null 不动文字、"" 清空', J(a1.steps[0].commands.filter((c) => c.op === 'bgm' || c.op === 'voice')) === J([{ op: 'bgm', src: 'bgm/bgm_10.m4a' }, { op: 'voice', src: 'othersounds/still/1200051/h_v1.m4a' }]) && a1.stats.missing.voice === 1 && J(a1.steps[4].commands) === J([{ op: 'raw', cmd: 'SE', args: ['se_x'] }]) && a1.stats.ignored.StillPath === 1 && textsOf(a1)[4] === undefined && textsOf(a1)[5] === '', J([a1.stats, a1.steps[4].commands]))
  const a2 = play(await read('json/1200052'), '1200052')
  check('没有骨架的成人剧情：只出台词，记 unresolved:still:<Id>（一次），不发 spine', !flat(a2).some((c) => c.op === 'spine') && a2.steps.length === 2 && J(a2.stats.unresolved) === J({ 'still:1200052': 1 }) && J(textsOf(a2)) === J(['No skeleton for me.', 'Second.']), J(a2.stats))
  const aUnknown = play(adultText.replace('"CharaAnimation":2', '"CharaAnimation":9'), '1200051')
  check('CharaAnimation 的值不在 anim 表里（9）：不猜，记 raw {cmd: CharaAnimation} + stats.raw，动画不变', J(flat(aUnknown).filter((c) => c.op === 'raw' && c.cmd === 'CharaAnimation')) === J([{ op: 'raw', cmd: 'CharaAnimation', args: ['9'] }]) && aUnknown.stats.raw['CharaAnimation:9'] === 1 && flat(aUnknown).filter((c) => c.op === 'spine').map((c) => c.anim).join() === 'animation1,animation1,animation3,animation4', J(aUnknown.stats.raw))   // 第 2 行的 Motion 2 仍然把速度改成 1.5（同一个动画只更新速度）
  const aCn = play(await read('jsoncn/1200051'), '1200051')
  check('jsoncn（缩进的中文版）和 json 同一个适配器：文字是中文版，画面 / 动画一样', textsOf(aCn)[1] === '[CN] Narration line.' && flat(aCn).filter((c) => c.op === 'spine').length === 4, J(textsOf(aCn)))
  check('stats 的 voices 汇总：普通剧情 2 个（1 找到）、成人 2 个（1 找到）；indexTruncated 只在索引被截断时出现', J(a1.stats.voices) === J({ total: 2, found: 1, missing: 1 }) && !('indexTruncated' in a1.stats) && parse(adultText, { ...ctx, truncated: true }, { options: {} }).stats.indexTruncated === true, '')

  // -- 列表（catalog）+ 语言
  const tree = catalog(ctx)
  const top = tree.children.map((c) => [c.id, c.title, c.children.length])
  check('列表：顶层 main / chars / all / adult（主线、角色、全部普通剧情、全部成人剧情），节点 id 稳定', J(top) === J([['main', '主线', 2], ['chars', '角色', 3], ['all', '全部普通剧情', 5], ['adult', '全部成人剧情', 2]]), J(top))
  const main = tree.children[0]
  check('主线：每章一个目录 main/<章 id>，章名 = list.json worldmap 里同 Id 的名字（没有就用章 id）；里面是 MStoryId 对应的场景，标题 = 数组里的 Title；没有脚本文件的 MStoryId（777）不列', J(main.children.map((c) => [c.id, c.title, c.children.length])) === J([['main/1001', '1.Small Island', 2], ['main/25001', '25001', 1]]) && J(main.children[0].children.map((c) => [c.id, c.title, c.script, c.subtitle])) === J([['main/1001/3', '1 Arrival', 'typeadv/MScenes/3', '1-1 clear'], ['main/1001/4', '2 Second', 'typeadv/MScenes/4', '1-2 clear']]), J(main.children))
  const chars = tree.children[1]
  check('角色：VieableEpisodeList 按 MMonsterId 分组（c/<id>），名字取 MMonsters.json 的 n，没有就取 list.json chara[floor(id/10)]；子项 = 普通剧情（MSceneId）+ 成人剧情（MAdultId，角标 R18），标题 = 条目的 Title；指到不存在文件的条目不列；有图标就带 thumb',
    J(chars.children.map((c) => [c.id, c.title, c.children.length])) === J([['c/10011', 'Alice', 2], ['c/10021', 'Bob', 2], ['c/10031', 'Fallback Name', 1]]) && J(chars.children[0].children.map((c) => [c.id, c.title, c.script, c.badge])) === J([['c/10011/n210011', 'Alice story one', 'typeadv/MScenes/210011', ''], ['c/10011/a1200051', 'Alice story one', 'json/1200051', 'R18']]) && chars.children[0].thumb === 'icon/chara/icon/png/10011.png' && !chars.children[1].thumb, J(chars.children[0]))
  check('VieableEpisodeList 超过 24KB 被截断：照样读出前面完整的条目（10031 的第一条），不崩', chars.children[2].children[0].title === 'Big list first' && ctx.counts.episodes > 3, J(ctx.counts))
  const normalAll = tree.children[2].children
  const adultAll = tree.children[3].children
  check('全部普通剧情：typeadv/MScenes 里每个 id 文件（notes 这种不是 id 的不收），标题 = 文件里的 Title；全部成人剧情：json/ 里每个，标题取 VieableEpisodeList 的 Title，没有就是 id，角标 R18', J(normalAll.map((c) => c.id)) === J(['all/3', 'all/4', 'all/210011', 'all/210021', 'all/210031']) && normalAll[0].title === '1-1 Arrival' && normalAll[2].title === 'Alice private scene' && J(adultAll.map((c) => [c.id, c.title, c.script, c.badge])) === J([['adult/1200051', 'Alice story one', 'json/1200051', 'R18'], ['adult/1200052', 'Bob story', 'json/1200052', 'R18']]), J(normalAll.map((c) => c.title)))
  const cn = catalog(await ctxOf({ lang: 'cn' }))
  check('lang = cn：成人剧情的脚本路径换成 jsoncn（有这个文件的），没有的退回 json；普通剧情用 MScenes_TW（有的）否则退回 MScenes', J(cn.children[3].children.map((c) => c.script)) === J(['jsoncn/1200051', 'json/1200052']) && cn.children[2].children.find((c) => c.id === 'all/3').script === 'typeadv/MScenes_TW/3' && cn.children[2].children.find((c) => c.id === 'all/210011').script === 'typeadv/MScenes/210011', J(cn.children[3].children.map((c) => c.script)))
  const tw = catalog(await ctxOf({ lang: 'tw' }))
  check('lang = tw：只有 TW 有的剧情（5）才出现在列表里（jp 不列）；langs 表可改（把 cn 的成人剧情指回 json）', tw.children[2].children.some((c) => c.id === 'all/5' && c.script === 'typeadv/MScenes_TW/5') && !catalog(ctx).children[2].children.some((c) => c.id === 'all/5') && catalog(await ctxOf({ lang: 'cn', langs: { cn: { normal: [], adult: ['json'] } } })).children[3].children[0].script === 'json/1200051', '')
  const enough = await loadAdapterContext({ adapter, mediaDir: media, config: configOf({}, { limits: { sampleFiles: 2 } }) })
  check('抽样被限制（config.limits.sampleFiles）：ctx.sampleTruncated = true，health 报「标题会显示成 id」；没读到索引 / list.json 也各报一条', enough.sampleTruncated === true && health(enough).some((h) => h.code === 'otogi-sample-truncated') && health({ hasIndex: false, index: new Map(), hasList: false, scriptDirs: new Map() }).map((h) => h.code).join() === 'otogi-index-empty,otogi-list-missing' && health(ctx).length === 0, J(health(enough)))
  check('指到不存在的根（root 配错）：catalog 为空（引擎退回按目录浏览并报 catalog-empty），parse 照样不崩', catalog(await loadAdapterContext({ adapter, mediaDir: media, config: configOf({ root: 'nowhere' }) })) === null, '')
}

// ---------- 引擎：没有扩展名 ----------
{
  const warnings = (value) => normalizeGalConfigWithWarnings({ scriptExtensions: value }).warnings
  check("config.scriptExtensions: [''] = 没有扩展名的文件；['', 'json'] 两种都认；'.' / 空白也当 ''；默认值不变（txt）；不合法的（带符号 / 太长）仍然丢掉", J(normalizeGalConfig({ scriptExtensions: [''] }).scriptExtensions) === J(['']) && J(normalizeGalConfig({ scriptExtensions: ['', '.JSON', 'json'] }).scriptExtensions) === J(['', 'json']) && J(normalizeGalConfig({ scriptExtensions: ['.', ' '] }).scriptExtensions) === J(['']) && J(normalizeGalConfig({}).scriptExtensions) === J(['txt']) && J(normalizeGalConfig({ scriptExtensions: ['a-b', 'x'.repeat(11), 'ok'] }).scriptExtensions) === J(['ok']) && warnings(['']).length === 0 && warnings(['a-b']).length === 1, J(warnings(['a-b'])))
  // 目录浏览（不走 catalog）：没有扩展名的脚本进列表，被适配器认得的才算，认不得的记 rejected
  const resolveAsset = async (rel) => { if (!existsSync(at(rel))) throw new Error('none'); return at(rel) }
  const plain = createBrowseProvider({ mediaDir: media, adapters: ['otogi-json'], resolveAsset, config: { scriptRoots: [{ id: 'g', dir: 'typeadv/MScenes', label: 'g' }], resourceRoots: [''], scriptExtensions: [''], merge: [], groups: [], dirThumbs: [], scriptThumbs: [], adapterOptions: { 'otogi-json': { index: { dirs: ['nowhere'] } } } } })
  const listed = await plain.internals.listDir(plain.config.scriptRoots[0], '')
  check('目录浏览：scriptExtensions [""] 时 typeadv/MScenes 里没有扩展名的剧情都列出来（3 / 4 / 210011 / 210021 / 210031），notes（不是剧情）被嗅探挡掉并进 rejected；stem = 文件名', J(listed.scripts.map((s) => s.stem).sort()) === J(['210011', '210021', '210031', '3', '4']) && J((listed.rejected || []).map((r) => r.split('/').pop())) === J(['notes']), J([listed.scripts.map((s) => s.stem), listed.rejected]))
  const withTxt = createBrowseProvider({ mediaDir: media, adapters: ['otogi-json'], resolveAsset, config: { scriptRoots: [{ id: 'g', dir: 'typeadv/MScenes', label: 'g' }], resourceRoots: [''], merge: [], groups: [], dirThumbs: [], scriptThumbs: [], adapterOptions: { 'otogi-json': { index: { dirs: ['nowhere'] } } } } })
  check('默认 scriptExtensions（txt）时没有扩展名的文件不列（行为不变）', (await withTxt.internals.listDir(withTxt.config.scriptRoots[0], '')).scripts.length === 0, '')
  // catalog 节点：用 provider 走一遍（语言切换 / 脚本节点 / 上一话下一话）
  const providerFor = (options) => createBrowseProvider({ mediaDir: media, adapters: ['otogi-json'], resolveAsset, config: { scriptRoots: [{ id: 'g', dir: '', label: 'g' }], resourceRoots: [''], scriptExtensions: [''], merge: [], groups: [], dirThumbs: [], scriptThumbs: [], limits: { walkFiles: 800000, sampleFiles: 20000 }, adapterOptions: { 'otogi-json': options } } })
  const p = providerFor({})
  const home = (await p.getNode('')).node
  check('provider：首页 = catalog 的 4 个顶层目录；打开 s:typeadv/MScenes/3 = 播放页，上一话 / 下一话在它所在的章里（3 → 4）', J(home.items.map((i) => i.title)) === J(['主线', '角色', '全部普通剧情', '全部成人剧情']) && (await (async () => { const n = await p.getNode('s:typeadv/MScenes/3'); return n.node.kind === 'player' && n.scene.steps.length === 8 && n.sectionNavigation.next?.title === '2 Second' && n.node.breadcrumb.map((b) => b.title).join('>') === '首页>主线>1.Small Island>1 Arrival' })()), J(home.items.map((i) => i.title)))
  const pcn = providerFor({ lang: 'cn' })
  const cnNode = await pcn.getNode('s:jsoncn/1200051')
  check('provider（lang = cn）：catalog 里给的脚本路径 jsoncn/1200051 能打开，文字是中文版', cnNode.node.kind === 'player' && textsOf(cnNode.scene)[1] === '[CN] Narration line.', J(textsOf(cnNode.scene || { steps: [] })))
  const issues = (await p.getNode('s:json/1200052').catch((e) => ({ error: e.message })))
  check('provider：没有骨架的成人剧情照样能打开（只有台词）', issues.node?.kind === 'player' && issues.scene.steps.length === 2, J(issues.error))
}

// ---------- gal-layout ----------
{
  const nested = path.join(dataDir, 'nested')
  await buildOtogiFixture(path.join(nested, 'Wrapper', 'Otogi Frontier R'))
  const layout = await galLayoutScript({ item: { itemId: 'og', title: 'og', config: {}, source: { path: nested }, adapters: ['otogi-json'] }, script: { id: 'gal-layout', version: '2.13.0', options: {} } })
  const cfg = layout.itemPatch?.gal?.config
  check('gal-layout：没写 game.id 也认出 otogi（多一层目录照样找到）；脚本根 = 游戏目录、资源根同、scriptExtensions [""]、适配器参数 root、脚本数 7（5 个普通 + 2 个成人）、封面、limits', cfg?.game?.id === 'otogi' && cfg.scriptRoots[0].dir === 'Wrapper/Otogi Frontier R' && J(cfg.resourceRoots) === J(['Wrapper/Otogi Frontier R']) && J(cfg.scriptExtensions) === J(['']) && cfg.adapterOptions['otogi-json'].root === 'Wrapper/Otogi Frontier R' && cfg.scriptCount === 7 && cfg.cover === 'typeadv/bg/adventure/bg_adventure_0001.png' && cfg.limits.walkFiles === 800000 && cfg.limits.sampleFiles === 20000, J(cfg) + J(layout.logs))
  check('gal-layout：规则表写进 adapterOptions（lang jp、positions、anim、effects…和 DEFAULT_OPTIONS 一致）；默认节点图 main / chars / all / adult', J(cfg.adapterOptions['otogi-json'].anim) === J(DEFAULT_OPTIONS.anim) && cfg.adapterOptions['otogi-json'].lang === 'jp' && J(Object.keys(cfg.nodes).sort()) === J(['adult', 'all', 'chars', 'home', 'main']) && J(cfg.nodes.home.children) === J(['main', 'chars', 'all', 'adult']), J(cfg.nodes))
  const flatLayout = await galLayoutScript({ item: { itemId: 'og2', title: 'og2', config: { game: { id: 'otogi' } }, source: { path: media }, adapters: ['otogi-json'] }, script: { id: 'gal-layout', version: '2.13.0', options: {} } })
  check('gal-layout：游戏根就是媒体目录时 root 为空；没有 typeadv/MScenes 的目录不认领（声明了 game.id 也不改配置）', flatLayout.itemPatch?.gal?.config?.adapterOptions?.['otogi-json']?.root === '' && flatLayout.itemPatch.gal.config.scriptRoots[0].dir === '' && (await galLayoutScript({ item: { itemId: 'og3', title: 'og3', config: { game: { id: 'otogi' } }, source: { path: path.join(media, 'bgm') }, adapters: [] }, script: { id: 'gal-layout', version: '2.13.0', options: {} } })).itemPatch === undefined, J(flatLayout.logs))
  const decoy = path.join(dataDir, 'decoy')
  await mkdir(path.join(decoy, 'typeadv', 'MScenes'), { recursive: true }); await mkdir(path.join(decoy, 'json'), { recursive: true })
  await (await import('node:fs/promises')).writeFile(path.join(decoy, 'list.json'), '{}'); await (await import('node:fs/promises')).writeFile(path.join(decoy, 'typeadv', 'MScenes', '1'), 'plain text')
  const guess = await galLayoutScript({ item: { itemId: 'og4', title: 'og4', config: {}, source: { path: decoy }, adapters: [] }, script: { id: 'gal-layout', version: '2.13.0', options: {} } })
  check('gal-layout：没声明 game.id 时要求立绘 + VieableEpisodeList + MScenes 里有 MSceneDetails 开头的文件：只有 list.json / typeadv/MScenes / json 的 decoy 不被认领', guess.itemPatch?.gal?.config?.game?.id !== 'otogi', J(guess.itemPatch?.gal?.config?.game))
}

await rm(dataDir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
