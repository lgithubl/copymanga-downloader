#!/usr/bin/env node
// 自测（不需要浏览器）：ぼくらの放課後戦争（bokusen-json，编译脚本 JSON）——适配器（交叉淡入背景 / 数字层立绘 + move / 多帧动画 / playse 下标 → .wav /
// 【说话人】「台词」拆分）、资源缺失和 JSON 解析失败都不炸、gal-layout 探测、导入 → 列表 → 取场景 → 取资源（走真实的 handler + 文件索引）。
//   node scripts/dev/fe-gal-bokusen-selftest.mjs
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { galAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { DEFAULT_OPTIONS, explainSniff, parse, prepare, sniff } from '../../web/library/gal/adapters/bokusen-json.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'
import { SCRIPT_1001, buildBokusenFixture, compileBokusen } from './make-bokusen-fixture.mjs'
import { readFile, writeFile } from 'node:fs/promises'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-bokusen-'))
const root = path.join(work, 'ぼくらの放課後戦争演示')
await buildBokusenFixture(root)
const STEM = '1001 テスト－初H'
const text1001 = await readFile(path.join(root, 'json', `${STEM}.json`), 'utf8')
const cmdsOf = (out) => out.steps.flatMap((st) => st.commands)

try {
  // ---------- sniff / 登记 ----------
  check('sniff：认 data.code（真实外壳 / BOM / 截断在 code 之后的文件也认），不认别的 JSON / 文本；对非 JSON、null、数字都不抛', sniff(text1001) && sniff(text1001.slice(0, 600)) && !sniff('{"data":{"x":1}}') && !sniff('{"bgms":[],"chara_keys":{}}') && !sniff('bg,a.jpg') && !sniff('') && !sniff(null) && !sniff(42), '')
  check('适配器登记，sniffGalAdapter 认得', galAdapter('bokusen-json').id === 'bokusen-json' && sniffGalAdapter(text1001) === 'bokusen-json', sniffGalAdapter(text1001))

  // ---------- sniff 的真实外壳 / 老外壳 / 键序 / 无效文件 ----------
  const codeObj = JSON.parse(text1001.replace(/^\uFEFF/, '')).data.code
  const realText = J({ error: { error_code: '00000', error_message: '', relogin_flag: 0 }, data: { user: { user_id: 0, fps: 15, url: '/' }, code: codeObj }, server_time: 1700000000 })
  const compactText = J({ data: { code: codeObj } })
  const codeFirst = J({ data: { code: codeObj, user: { fps: 15 } }, error: { error_code: '00000' } })
  const longUser = J({ error: { error_code: '00000' }, data: { user: { blob: 'x'.repeat(7000) }, code: codeObj } })
  const tooFar = J({ error: { error_code: '00000' }, data: { user: { blob: 'x'.repeat(9000) }, code: codeObj } })
  check('sniff：真实外壳（error + data.user + code + server_time）/ 老的紧凑外壳 / code 排在 user 前面 / 带 BOM / 7KB 的 user 后面的 code 都认', [realText, compactText, codeFirst, '\uFEFF' + realText, '  \n' + realText, longUser].every((t) => sniff(t) && sniffGalAdapter(t) === 'bokusen-json'), '')
  check('sniff：code 在 8KB 之后不认；"code" 后面不是已知子键不认；别的 data.code（没有 bokusen 子键）、别的 JSON 不认', !sniff(tooFar) && !sniff('{"data":{"user":{},"code":{"foo":1}}}') && !sniff('{"data":{"code":"x"}}') && !sniff('{"error":{"error_code":"00000"},"data":{"user":{}}}') && !sniff('{"code":{"images":[]}}'), '')
  check('sniff：code 的子键只要是已知的就行（tags / commands / parameters 打头也认）', ['images', 'sounds', 'articles', 'characters', 'tags', 'parameters', 'commands'].every((k) => sniff(`{"error":{},"data":{"user":{"a":1},"code":{"${k}":[]}}}`)), '')
  // explainSniff：认得 → ''；不认 → 一句中文原因
  check('explainSniff：认得的文件返回 ""；空文件 / 只有空白 / HTML / 错误响应 / 没有 data / 没有 code / code 子键不对 / code 超出 8KB 各有简短的中文原因；null / 数字不抛', explainSniff(realText) === '' && explainSniff(compactText, {}) === '' && /空/.test(explainSniff('')) && /空/.test(explainSniff(' \n ')) && /不是 JSON/.test(explainSniff('<html>x</html>')) && /error_code 123/.test(explainSniff('{"error":{"error_code":"123","error_message":"x"}}')) && /data/.test(explainSniff('{"a":1}')) && /code/.test(explainSniff('{"data":{"user":{}}}')) && /子键/.test(explainSniff('{"data":{"code":{"zzz":1}}}')) && /头 8KB 内没有 "data":\{…"code":\{/.test(explainSniff(tooFar)) && [null, undefined, 42].every((v) => typeof explainSniff(v) === 'string'), J([explainSniff(''), explainSniff(tooFar), explainSniff('{"a":1}')]))
  check('DEFAULT_OPTIONS 仍然导出（drift 守卫依赖）', DEFAULT_OPTIONS?.resourceDir === 'resource', '')

  // parse 在真实外壳 / 老外壳 / code 键序不同时给出同一份场景
  const refSteps = J(parse(compactText, null, { stem: 'k' }).steps)
  check('parse：真实外壳 / 老外壳 / code 排在 user 前面 / 带 BOM → 同一份 steps', [realText, codeFirst, '\uFEFF' + realText, longUser].every((t) => J(parse(t, null, { stem: 'k' }).steps) === refSteps) && parse(compactText, null, { stem: 'k' }).steps.length > 5, '')
  const nested = parse(J({ error: {}, data: { user: {}, payload: { code: codeObj } } }), null, { stem: 'k' })
  const topCode = parse(J({ error: {}, code: codeObj }), null, { stem: 'k' })
  check('parse：data.code 不在时退到顶层 code / data 下带 tags + commands 的对象', J(nested.steps) === refSteps && J(topCode.steps) === refSteps, '')
  const failures = [['', /空/], ['   \n', /空/], ['<html>', /JSON/], ['{"error":{"error_code":"777","error_message":"nope"},"server_time":1}', /error_code 777/], ['{"error":{"error_code":"00000"},"data":{"user":{}},"server_time":1}', /data\.code/], ['null', /data\.code/], ['[1,2]', /data\.code/], ['{"data":{"code":{"images":[]}}}', /data\.code/]].map(([t, re]) => { try { parse(t, null, {}); return `没抛：${t}` } catch (e) { return e instanceof Error && !(e instanceof TypeError) && re.test(e.message) ? '' : `${t} → ${e.message}` } })
  check('parse：空文件 / 空白 / 非 JSON / 错误响应 / 缺 data.code / null / 数组 → 带原因的 Error（不是 TypeError）', failures.every((x) => !x), J(failures))


  const config = normalizeGalConfig({ resourceRoots: ['resource'], adapterOptions: { 'bokusen-json': { root: '', resourceDir: 'resource' } } })
  const adapter = galAdapter('bokusen-json')
  const ctx = await loadAdapterContext({ adapter, mediaDir: root, config })
  check('文件索引：resource/<脚本名>/images|sounds 里的文件按资源根（resource）去前缀收进来', ctx.hasIndex && ctx.resources.has(`${STEM}/images/0.jpg`) && ctx.resources.has(`${STEM}/sounds/3.wav`) && !ctx.resources.has(`${STEM}/images/6.png`), J([...ctx.resources].slice(0, 4)))
  const out = parse(text1001, ctx, { stem: STEM })
  const cmds = cmdsOf(out)
  const res = (kind, n, ext) => `${STEM}/${kind}/${n}.${ext}`

  // 开场：base fore → 立刻显示，base back + trans cross 1000ms → 带 fade 1 的 bg
  const bgs = cmds.filter((c) => c.op === 'bg')
  check('开场背景：image base/fore 0 → bg（fade 0）；image base/back 1 + trans cross 1000 → bg（fade 1）', bgs[0]?.src === res('images', 0, 'jpg') && bgs[0].fade === 0 && bgs[1]?.src === res('images', 1, 'jpg') && bgs[1].fade === 1, J(bgs))
  check('bgm：playbgm 取 sounds 里路径带 /bgm/ 的那个（.m4a 在磁盘上是 .wav）；fadeoutbgm 1000 → bgmStop fade 1', cmds[0]?.op === 'bgm' && cmds[0].src === res('sounds', 0, 'wav') && cmds.some((c) => c.op === 'bgmStop' && c.fade === 1), J(cmds[0]))

  // 数字层：stand（x 偏移）+ move（终点）；opacity 0 去掉
  const stands = cmds.filter((c) => c.op === 'stand')
  check('数字层图 → stand（x 240 / y -10）；move (0 -10 255) → 同一层移到 x 0', stands[0]?.parts[0]?.src === res('images', 2, 'png') && stands[0].parts[0].x === 240 && stands[0].parts[0].y === -10 && stands[1]?.parts[0]?.x === 0, J(stands.slice(0, 2)))
  check('单帧 animstart 在数字层 3：显示 3 号图（x 145），和层 0 叠放；animstop 去掉；trans 提交层 0 的 back 图；move 不透明度 0 → standOff', stands.some((s) => s.parts.length === 2 && s.parts[1].x === 145 && s.parts[1].src === res('images', 3, 'png')) && stands.some((s) => s.parts.length === 1 && s.parts[0].src === res('images', 3, 'png')) && cmds.some((c) => c.op === 'standOff'), J(stands))

  // 多帧动画（base 层）→ bg + frames；缺的帧记 unresolved
  const anim = bgs.find((c) => c.frames)
  check('animstart base 层 3 帧（4 5 6）→ bg + frames，和 Aku 的帧动画一样；磁盘上没有的 6.png 跳过并记 unresolved', anim?.frames?.length === 2 && anim.src === res('images', 4, 'png') && out.stats.unresolved['anim-missing:1'] === 1, J([anim, out.stats.unresolved]))

  // 声音
  check('playse 下标 → sounds/<i>.wav：路径带 /voice/ → voice，其它 → se', cmds.some((c) => c.op === 'voice' && c.src === res('sounds', 1, 'wav')) && cmds.some((c) => c.op === 'se' && c.src === res('sounds', 2, 'wav')), J(cmds.filter((c) => c.op === 'voice' || c.op === 'se')))
  check('循环的 playse → bgse loop；stopse 同声道 → bgseStop；wait 500 → wait 0.5', cmds.some((c) => c.op === 'bgse' && c.loop === true && c.src === res('sounds', 3, 'wav')) && cmds.some((c) => c.op === 'bgseStop') && cmds.some((c) => c.op === 'wait' && c.seconds === 0.5), '')

  // 台词拆分
  const dialogue = out.steps.map((st) => ({ speaker: st.commands.find((c) => c.op === 'speaker')?.segments[0]?.text ?? null, text: st.commands.find((c) => c.op === 'text')?.segments[0]?.text }))
  check('【小春】标题行 → speaker 小春，「こんにちは」是台词（不含标题行）；cm 之后说话人清空', dialogue[0].text === 'ナレーション。' && dialogue[1].speaker === '小春' && dialogue[1].text === '「こんにちは」' && out.steps[2].commands.find((c) => c.op === 'speaker')?.segments.length === 0, J(dialogue))
  check('一页里中途出现【李】：先把前面的地の文出成一步，再换说话人', dialogue[3].text === '地の文' && dialogue[4].speaker === '李' && dialogue[4].text === '「やあ」', J(dialogue))
  check('结尾没有 p 的最后一句也会出（最后一步）', dialogue.at(-1).text === '最後の一行' && out.steps.every((st, i) => st.index === i), J(dialogue.at(-1)))

  // 未知 / 非法：不炸
  check('下标越界的 image、没见过的标签 → 不炸，记 stats.raw（image 带 raw 指令）', out.stats.raw.image === 1 && out.stats.raw['tag:mystery'] === 1 && cmds.some((c) => c.op === 'raw' && c.cmd === 'image'), J(out.stats))

  // 标签表是每个文件自己的：打乱顺序照样解析
  const reordered = compileBokusen({ images: ['a.jpg'], sounds: [], articles: ['【甲】', '「乙」'], script: [['p'], ['image', { 15: 'base', 23: 'fore', 28: 0 }], ['articles', { 0: 0 }], ['articles', { 0: 1 }], ['p']] })
  reordered.data.code.tags.reverse(); reordered.data.code.commands.forEach((c) => { c[0] = reordered.data.code.tags.length - 1 - c[0] })
  const re = parse(J(reordered), null, { stem: 'x' })
  check('标签下标不固定：标签表倒过来排，仍按 tags[下标] 取名字；没有文件索引时按约定拼路径', cmdsOf(re).some((c) => c.op === 'bg' && c.src === 'x/images/0.jpg') && cmdsOf(re).some((c) => c.op === 'text' && c.segments[0].text === '「乙」'), J(re.steps))

  // ---------- 资源缺失 / 解析失败 ----------
  const lacking = parse(await readFile(path.join(root, 'json', '1002 リソースなし.json'), 'utf8'), ctx, { stem: '1002 リソースなし' })
  check('没有资源目录的脚本（1002）：图 / 声音记 unresolved，台词照常出，不炸', Object.keys(lacking.stats.unresolved).length === 2 && !cmdsOf(lacking).some((c) => c.op === 'bg' || c.op === 'se') && lacking.steps.length === 1 && cmdsOf(lacking).some((c) => c.op === 'text' && c.segments[0].text === '「やあ」'), J(lacking))
  let error = ''
  try { parse(await readFile(path.join(root, 'json', '1003 壊れた.json'), 'utf8'), ctx, { stem: '1003' }) } catch (e) { error = e.message }
  check('被截断的 JSON：parse 抛一个明确的 Error（列表页当「解析失败」列出），sniff 不抛', /JSON/.test(error) && sniff(text1001.slice(0, 600)), error)
  let shape = ''
  try { parse('{"data":{"code":{"images":[]}}}', null, {}) } catch (e) { shape = e.message }
  check('形状不对（缺 tags / parameters / commands）：明确的错，不是 TypeError', /data\.code/.test(shape), shape)
  check('没有 ctx 也不炸（ctx = null，按约定拼路径）', parse(text1001, null, { stem: STEM }).steps.length === out.steps.length, '')

  // ---------- gal-layout：没写 game.id 也认出 bokusen ----------
  const layout = await galLayoutScript({ item: { itemId: 'bk', title: 'bk', config: {}, source: { path: root }, adapters: ['bokusen-json'] }, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
  const cfg = layout.itemPatch?.gal?.config
  check('gal-layout 认出 bokusen：game.id、脚本根 json、资源根 resource、扩展名 json、适配器参数、脚本数 3', cfg?.game?.id === 'bokusen' && cfg.scriptRoots?.[0]?.dir === 'json' && J(cfg.resourceRoots) === J(['resource']) && J(cfg.scriptExtensions) === J(['json']) && cfg.adapterOptions?.['bokusen-json']?.resourceDir === 'resource' && cfg.scriptCount === 3, J(cfg))
  const other = await galLayoutScript({ item: { itemId: 'no', title: 'no', config: {}, source: { path: path.join(work, 'empty') }, adapters: [] }, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
  check('gal-layout 不会把别的目录认成 bokusen（不存在的目录 → 不认领）', other.itemPatch?.gal?.config?.game?.id !== 'bokusen', J(other.logs))

  // ---------- 真实 handler：导入 → 列表 → 取场景 → 取资源 ----------
  const handler = createGalHandler({ dataDir: path.join(work, 'data'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
  const imported = await handler.importFromSource({ sourcePath: root, options: { adapters: ['bokusen-json'], config: { ...cfg, game: { id: 'bokusen', title: 'bokusen' } } } })
  const itemId = imported.items[0].itemId
  const node = async (sectionId) => (await handler.getReaderContent(itemId, 'main', { sectionId })).node
  const home = await node('')
  const titles = (home.items || []).map((x) => x.title)
  check('列表：标题 = 文件名（stem）；被截断的 JSON 也列出来（嗅探只看开头）', titles.includes(STEM) && titles.includes('1002 リソースなし') && titles.includes('1003 壊れた'), J(titles))
  const card = home.items.find((x) => x.title === STEM)
  const played = await handler.getReaderContent(itemId, 'main', { sectionId: card.node })
  const scene = played.scene || played.node?.scene
  check('播放页：取到 gal-scene/1，adapter bokusen-json，背景 src 能被资源接口取到（resource/<脚本名>/images/0.jpg）', scene?.adapter === 'bokusen-json' && scene.steps.length === out.steps.length, J(Object.keys(played)))
  const bg0 = scene.steps.flatMap((s) => s.commands).find((c) => c.op === 'bg')
  const png = await handler.getResource(itemId, bg0.src).catch((e) => e)
  check('资源接口：bg src → 图片字节（PNG 文件头）', png?.body?.subarray?.(1, 4).toString() === 'PNG', String(png?.message || bg0.src))
  const wav = await handler.getResource(itemId, res('sounds', 1, 'wav')).catch((e) => e)
  check('资源接口：sounds/<i>.wav → 音频字节（RIFF）', wav?.body?.subarray?.(0, 4).toString() === 'RIFF', String(wav?.message))
  const broken = home.items.find((x) => x.title === '1003 壊れた')
  const brokenRes = await handler.getReaderContent(itemId, 'main', { sectionId: broken.node }).then(() => '', (e) => e.message)
  check('打开解析失败的脚本：明确的错误，不是服务崩溃', brokenRes !== '', 'resolved without error')

  // ---------- 参数（adapterOptions['bokusen-json']）：默认不变 + 每项覆盖都按文档改变结果 ----------
  const withOptions = (options, extra = {}, useCtx = ctx) => parse(text1001, useCtx, { stem: STEM, options, ...extra })
  let seOpsBad
  const sameAsDefault = (options) => J(withOptions(options).steps) === J(out.steps)
  check('参数：不给 / 空对象 / 写出全部默认值 / 乱七八糟的类型 → 结果和以前逐字节一样，也不抛', sameAsDefault(undefined) && sameAsDefault({}) && sameAsDefault({ slotMap: { image: { layer: 15 } }, bgm: { patterns: ['/bgm/'], index: 0 }, voice: { patterns: ['/voice/'], loopAsBgse: true }, stand: { layers: [], overlayLayers: [], bgLayers: ['base'], xScale: 1, yScale: 1, origin: { x: 0, y: 0 }, moveMode: 'jump' }, animation: { singleFrameAsStatic: true, multiFrameLayers: ['base'] }, sound: { ext: ['.wav', '{entry}'] }, image: { ext: ['{entry}'], defaultExt: '.jpg' }, paths: { images: ['{stem}/images/{i}{ext}'], sounds: ['{stem}/sounds/{i}{ext}'], anyExt: true } }) && sameAsDefault(null) && sameAsDefault([1]) && sameAsDefault('x') && sameAsDefault({ slotMap: 5, bgm: 'x', voice: { patterns: 'x' }, stand: { xScale: 'abc', layers: 3 }, paths: { images: 7 } }), '')

  check('不合格的正则（量词套量词 / 语法错）被丢掉、不抛：voice.patterns 全是坏的 → 没有 voice（都当 se）', J(seOpsBad = cmdsOf(withOptions({ voice: { patterns: ['(a+)+', '('] } })).filter((c) => c.op === 'voice')) === '[]', J(seOpsBad))
  // slotMap：槽位猜错了改配置
  const slotWait = cmdsOf(withOptions({ slotMap: { wait: { ms: 3 } } })).some((c) => c.op === 'wait')
  const slotFade = cmdsOf(withOptions({ slotMap: { fadeoutbgm: { ms: null } } })).find((c) => c.op === 'bgmStop')
  const slotX = cmdsOf(withOptions({ slotMap: { image: { x: 29 } } })).find((c) => c.op === 'stand')
  const slotNoImage = withOptions({ slotMap: { image: { index: null } } })
  check('slotMap：wait.ms 改指向没设的槽 → 没有 wait；fadeoutbgm.ms = null → fade 0；image.x 改读 29 号槽 → 立绘 x = -10；image.index = null → 所有 image 记 raw（无效下标）', !slotWait && slotFade?.fade === 0 && slotX?.parts[0]?.x === -10 && slotNoImage.stats.raw.image >= 2, J([slotWait, slotFade, slotX, slotNoImage.stats.raw]))
  const slotLoop = cmdsOf(withOptions({ slotMap: { playse: { loop: 0 } } }))
  check('slotMap：playse.loop 改读 0 号槽（声道号，不是 true）→ 没有 bgse，循环声当普通 se；playse.index 同理可改', !slotLoop.some((c) => c.op === 'bgse') && slotLoop.some((c) => c.op === 'se' && c.src === res('sounds', 3, 'wav')) && Object.keys(withOptions({ slotMap: { playse: { index: 0 } } }).stats.unresolved).some((k) => k.startsWith('se:')), '')

  // bgm
  const bgmOf = (options) => cmdsOf(withOptions(options)).find((c) => c.op === 'bgm')?.src
  check('bgm：patterns 默认 /bgm/ → sounds/0.wav；patterns 改 /voice/ → sounds/1.wav；patterns [] + index 2 → sounds/2.wav；index 3（没有匹配时的兜底）；index "first" = 0', bgmOf({}) === res('sounds', 0, 'wav') && bgmOf({ bgm: { patterns: ['/voice/'] } }) === res('sounds', 1, 'wav') && bgmOf({ bgm: { patterns: [], index: 2 } }) === res('sounds', 2, 'wav') && bgmOf({ bgm: { patterns: ['nomatch'], index: 3 } }) === res('sounds', 3, 'wav') && bgmOf({ bgm: { patterns: [], index: 'first' } }) === res('sounds', 0, 'wav'), J([bgmOf({}), bgmOf({ bgm: { patterns: ['/voice/'] } })]))
  check('bgm：slotMap.playbgm.index 指向槽位时优先用槽位里的曲子下标（槽 1 = 0 → sounds/0.wav，槽 0 = true 非法 → 退回 patterns）', bgmOf({ slotMap: { playbgm: { index: 1 } }, bgm: { patterns: ['/voice/'] } }) === res('sounds', 0, 'wav') && bgmOf({ slotMap: { playbgm: { index: 0 } }, bgm: { patterns: ['/voice/'] } }) === res('sounds', 1, 'wav'), '')

  // voice
  const seOps = (options) => cmdsOf(withOptions(options)).filter((c) => ['voice', 'se', 'bgse'].includes(c.op)).map((c) => `${c.op}:${c.src.split('/').pop()}`)
  check('voice：默认 /voice/ → voice:1.wav、se:2.wav、bgse:3.wav；patterns 换成不匹配的 → 两个都是 se；patterns 换成 se2 → sounds/2 变 voice，1 变 se', J(seOps({})) === J(['voice:1.wav', 'se:2.wav', 'bgse:3.wav']) && J(seOps({ voice: { patterns: ['nomatch'] } })) === J(['se:1.wav', 'se:2.wav', 'bgse:3.wav']) && J(seOps({ voice: { patterns: ['se2'] } })) === J(['se:1.wav', 'voice:2.wav', 'bgse:3.wav']), J(seOps({})))
  const noLoop = withOptions({ voice: { loopAsBgse: false } })
  check('voice.loopAsBgse = false：循环的 playse 当普通 se（没有 bgse，stopse 也就没有 bgseStop）', J(seOps({ voice: { loopAsBgse: false } })) === J(['voice:1.wav', 'se:2.wav', 'se:3.wav']) && !cmdsOf(noLoop).some((c) => c.op === 'bgseStop'), '')

  // stand
  const standsOf = (options) => cmdsOf(withOptions(options)).filter((c) => c.op === 'stand')
  const scaled = standsOf({ stand: { xScale: 2, yScale: 0.5, origin: { x: 10, y: -5 } } })[0]?.parts[0]
  check('stand：xScale 2 / yScale 0.5 / origin (10, -5) → 立绘 x = 240×2+10 = 490，y = -10×0.5-5 = -10', scaled?.x === 490 && scaled?.y === -10, J(scaled))
  const onlyThree = withOptions({ stand: { layers: [3] } })
  check('stand.layers [3]：只有 3 层是立绘，层 0 变成叠加层（raw layer，没有 stand 指令里的 2 号图）；overlayLayers [0] 同效', cmdsOf(onlyThree).filter((c) => c.op === 'stand').every((c) => c.parts.every((p) => p.src === res('images', 3, 'png'))) && onlyThree.stats.raw.layer >= 1 && withOptions({ stand: { overlayLayers: [0] } }).stats.raw.layer >= 1 && !standsOf({ stand: { overlayLayers: ['0'] } }).some((c) => c.parts.some((p) => p.src === res('images', 2, 'png'))), J(onlyThree.stats.raw))
  const bgOff = cmdsOf(withOptions({ stand: { bgLayers: [] } }))
  check('stand.bgLayers []：base 层不再是背景（没有 bg 指令；base 层当立绘层，叠在 stand 里）', !bgOff.some((c) => c.op === 'bg') && bgOff.some((c) => c.op === 'stand' && c.parts.length > 0), '')
  check('stand.moveMode "tween"：场景格式没有立绘补间指令，不支持——按 jump 处理，结果和默认一样', J(withOptions({ stand: { moveMode: 'tween' } }).steps) === J(out.steps), '')

  // animation
  const noMulti = withOptions({ animation: { multiFrameLayers: [] } })
  const bg4 = cmdsOf(noMulti).filter((c) => c.op === 'bg')
  check('animation.multiFrameLayers []：base 层多帧不再合成 frames（只显示第一帧）+ raw 多帧动画；默认 [base] 才有 frames', !bg4.some((c) => c.frames) && cmdsOf(noMulti).some((c) => c.op === 'raw' && c.cmd === 'animstart') && cmdsOf(out).some((c) => c.op === 'bg' && c.frames), J(bg4))
  const noStatic = withOptions({ animation: { singleFrameAsStatic: false } })
  check('animation.singleFrameAsStatic = false：单帧 animstart 不再当静态图，记 raw（数字层 3 的立绘不出现）；默认出现', !cmdsOf(noStatic).some((c) => c.op === 'stand' && c.parts.some((p) => p.x === 145)) && cmdsOf(noStatic).some((c) => c.op === 'raw' && c.cmd === 'animstart' && /单帧/.test(c.args[0])) && cmdsOf(out).some((c) => c.op === 'stand' && c.parts.some((p) => p.x === 145)), '')

  // 路径模板 / 扩展名 / resourceResolve
  const unresolvedSounds = (options, cfg) => Object.keys(parse(text1001, ctx, { stem: STEM, options, config: cfg }).stats.unresolved).filter((k) => /^(se|bgm):/.test(k) || k === 'bgm').length
  check('sound.ext：默认先 .wav 再列表里的；改成 [.mp3] + anyExt:false → 声音全找不到（unresolved）；anyExt 默认 true 时仍按序号找到 .wav', unresolvedSounds({}) === 0 && unresolvedSounds({ sound: { ext: ['.mp3'] }, paths: { anyExt: false } }) >= 3 && unresolvedSounds({ sound: { ext: ['.mp3'] } }) === 0, '')
  const rr = normalizeGalConfig({ resourceRoots: ['resource'], resourceResolve: { extensionFallbacks: { '.mp3': ['.wav'] } } })
  check('sound.ext 交给 config.resourceResolve：ext [.mp3] + anyExt:false 找不到；加上 resourceResolve.extensionFallbacks {.mp3: [.wav]} → createIndexResolver 换扩展名找到 .wav', unresolvedSounds({ sound: { ext: ['.mp3'] }, paths: { anyExt: false } }, { resourceResolve: rr.resourceResolve }) === 0, J(rr.resourceResolve))
  const rrCase = normalizeGalConfig({ resourceRoots: ['resource'], resourceResolve: { caseInsensitive: true } })
  const upper = parse(text1001, ctx, { stem: STEM, options: { paths: { images: ['{stem}/IMAGES/{i}{ext}'], anyExt: false } }, config: { resourceResolve: rrCase.resourceResolve } })
  const strict = parse(text1001, ctx, { stem: STEM, options: { paths: { images: ['{stem}/IMAGES/{i}{ext}'], anyExt: false } }, config: { resourceResolve: { caseInsensitive: false } } })
  check('paths.images 模板 + resourceResolve.caseInsensitive：{stem}/IMAGES/… 在 caseInsensitive 时找到真实的 images/；关掉 → 找不到', cmdsOf(upper).some((c) => c.op === 'bg' && c.src === res('images', 0, 'jpg')) && !cmdsOf(strict).some((c) => c.op === 'bg') && strict.stats.unresolved[`bg:${'bg0000.jpg'}`] === 1, J(strict.stats.unresolved))
  const noIdx = (options) => cmdsOf(parse(text1001, null, { stem: 'x y', options })).find((c) => c.op === 'bg')?.src
  check('paths（没有文件索引时取第一个候选）：默认 x y/images/0.jpg；images 改 [{stem}/pics/{i}{ext}] → x y/pics/0.jpg；image.defaultExt / image.ext 改变扩展名；stem 含 $& 也不会被当替换符', noIdx({}) === 'x y/images/0.jpg' && noIdx({ paths: { images: ['{stem}/pics/{i}{ext}'] } }) === 'x y/pics/0.jpg' && noIdx({ image: { ext: ['.webp', '{entry}'] } }) === 'x y/images/0.webp' && noIdx({ paths: { images: ['{name}'] } }) === 'bg0000.jpg' && cmdsOf(parse(text1001, null, { stem: 'a$&b', options: {} })).find((c) => c.op === 'bg')?.src === 'a$&b/images/0.jpg', noIdx({}))
  const soundNoIdx = (options) => cmdsOf(parse(text1001, null, { stem: 'x', options })).find((c) => c.op === 'bgm')?.src
  check('paths.sounds（没有文件索引）：默认 x/sounds/0.wav（先 .wav）；sound.ext [.ogg] → .ogg；paths.sounds 两个模板按顺序试', soundNoIdx({}) === 'x/sounds/0.wav' && soundNoIdx({ sound: { ext: ['.ogg'] } }) === 'x/sounds/0.ogg' && soundNoIdx({ paths: { sounds: ['{stem}/snd/{i}.mp3', '{stem}/sounds/{i}.wav'] } }) === 'x/snd/0.mp3', soundNoIdx({}))
  const second = cmdsOf(parse(text1001, ctx, { stem: STEM, options: { paths: { sounds: ['{stem}/nope/{i}.wav', '{stem}/sounds/{i}.wav'], anyExt: false } } })).find((c) => c.op === 'bgm')
  check('paths.sounds（有文件索引）：第一个模板不存在就试第二个（真实存在的那个生效）', second?.src === res('sounds', 0, 'wav'), J(second))
  const idxFail = ['', 'a', 'x/y'].map((st) => { try { return parse(text1001, ctx, { stem: st, options: { paths: { images: ['{stem}/{i}'] } } }).steps.length } catch (error) { return error.message } })
  check('空 stem / 奇怪的 stem 不炸', idxFail.every((v) => typeof v === 'number'), J(idxFail))

  // ---------- 端到端：adapterOptions 手写进 config，走 导入 → 取场景 ----------
  const handler2 = createGalHandler({ dataDir: path.join(work, 'data2'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
  const tuned = { ...cfg, game: { id: 'bokusen', title: 'bokusen' }, adapterOptions: { 'bokusen-json': { ...cfg.adapterOptions['bokusen-json'], voice: { patterns: ['/nomatch/'], loopAsBgse: false }, bgm: { patterns: [], index: 2 }, stand: { xScale: 2 } } } }
  const imported2 = await handler2.importFromSource({ sourcePath: root, options: { adapters: ['bokusen-json'], config: tuned } })
  const itemId2 = imported2.items[0].itemId
  const list2 = (await handler2.getReaderContent(itemId2, 'main', { sectionId: '' })).node.items
  const played2 = await handler2.getReaderContent(itemId2, 'main', { sectionId: list2.find((x) => x.title === STEM).node })
  const cmds2 = (played2.scene || played2.node?.scene).steps.flatMap((s) => s.commands)
  check('端到端：adapterOptions 里的 voice / bgm / stand 覆盖经 normalizeGalConfig → 导入 → 取场景生效（没有 voice / bgse，bgm = sounds/2，立绘 x×2）；不覆盖的默认项（资源目录）照常', !cmds2.some((c) => c.op === 'voice' || c.op === 'bgse') && cmds2.find((c) => c.op === 'bgm')?.src === res('sounds', 2, 'wav') && cmds2.find((c) => c.op === 'stand')?.parts[0].x === 480 && cmds2.find((c) => c.op === 'bg')?.src === res('images', 0, 'jpg'), J(cmds2.slice(0, 4)))

  // ---------- 真实目录里有空文件 / 错误响应：列表照常出，其余脚本不受影响 ----------
  const root3 = path.join(work, 'ぼくら-with-bad')
  await buildBokusenFixture(root3)
  await writeFile(path.join(root3, 'json', '4235 空.json'), '')
  await writeFile(path.join(root3, 'json', '4311 空白.json'), '  \n')
  await writeFile(path.join(root3, 'json', '4331 エラー.json'), '{"error":{"error_code":"10001","error_message":"x"},"server_time":1}')
  const handler3 = createGalHandler({ dataDir: path.join(work, 'data3'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
  const imported3 = await handler3.importFromSource({ sourcePath: root3, options: { adapters: ['bokusen-json'], config: { ...cfg, game: { id: 'bokusen', title: 'bokusen' } } } })
  const list3 = (await handler3.getReaderContent(imported3.items[0].itemId, 'main', { sectionId: '' })).node.items.map((x) => x.title)
  check('空文件 / 空白文件 / 错误响应 JSON 混在 json/ 里：列表不炸，只列出真正的脚本（3 个），坏文件不显示', list3.length === 3 && list3.includes(STEM) && !list3.some((t) => /^4\d{3}/.test(t)), J(list3))
  check('这些坏文件的 explainSniff 各有原因：空 → "空"、错误响应 → error_code', /空/.test(explainSniff('')) && /error_code 10001/.test(explainSniff(await readFile(path.join(root3, 'json', '4331 エラー.json'), 'utf8'))), '')
} finally { await rm(work, { recursive: true, force: true }) }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
