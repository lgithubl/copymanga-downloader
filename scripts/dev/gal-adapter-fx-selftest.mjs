#!/usr/bin/env node
// 自测（纯 node，不需要浏览器）：魔法学园（artwhirl-json）的换场景清立绘 / others 表 / bg_change 表 / 语音（字符串 + dic 下标）/ BGM 端到端，
// 以及 Grenze（grenze-xml）的 screen_effect / pic_action / effect / pic_size 映射表 + back_voice。
//   node scripts/dev/gal-adapter-fx-selftest.mjs
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { galAdapter } from '../../web/library/gal/adapters/index.mjs'
import * as aw from '../../web/library/gal/adapters/artwhirl-json.mjs'
import * as grenze from '../../web/library/gal/adapters/grenze-xml.mjs'
import { galConfigView, normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const same = (a, b) => J(a) === J(b)
const cmds = (out) => out.steps.flatMap((s) => s.commands)
const ops = (out, ...names) => cmds(out).filter((c) => names.includes(c.op))
const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gal-fx-')))
let seq = 0

async function e2e(adapterId, tree, adapterOptions, scriptRel, extraConfig = {}) {
  const dir = path.join(work, `e${seq += 1}`)
  for (const [rel, content] of Object.entries(tree)) { await mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await writeFile(path.join(dir, rel), content) }
  const config = normalizeGalConfig({ adapterOptions: { [adapterId]: adapterOptions }, ...extraConfig })
  const ctx = await loadAdapterContext({ adapter: galAdapter(adapterId), mediaDir: dir, config })
  const meta = { rel: scriptRel, stem: path.basename(scriptRel).replace(/\.[^.]+$/, ''), options: config.adapterOptions[adapterId] || {}, config: galConfigView(config) }
  return { scene: buildScene(adapterId, tree[scriptRel], ctx, meta), ctx }
}

// ================= 魔法学园 =================
{
  const rels = ['images/bg/a.jpg', 'images/bg/b.jpg', 'images/stands/ABC/b1/ABC_b1_b_e_r.png', 'audio/bgm/theme.ogg', 'audio/voice/g1/ABC_01.ogg', 'audio/voice/g1/ABC_02.ogg', 'audio/voice/g1/ABC_03.ogg']
  const prep = (options, files = rels) => aw.prepare({ options, files: files.map((r) => `game/${r}`), toResourcePath: (r) => r.replace(/^game\//, '') })
  const base = (rows) => {
    const n = rows.length
    const col = (key, dflt = null) => rows.map((r) => (key in r ? r[key] : dflt))
    return JSON.stringify({ bgms: col('bgm'), bgs: col('bg', 1), voices: col('voice'), texts: col('text', 't'), names: Array(n).fill(null), colors: Array(n).fill(null), charas: col('charas'), others: col('others', []), effects: Array(n).fill(null), waits: Array(n).fill(null), chara_keys: ['ABC'],
      dic: [null, 'bg/a.jpg', 'bg/b.jpg', { key: 'ABC', body: 'b1', pos: 0.5 }, 'ABC_02.mp3', null, 'bgm/theme.mp3', { file: 'ABC_03.mp3' }] })
  }
  const run = (rows, options = {}, files) => aw.parse(base(rows), prep(options, files), { stem: 'e', options })

  // --- 换场景清立绘（原版 json_story_player.rpy：背景变了就 renpy.scene() 清掉所有层，之后只有这一行带 charas 才重新摆）---
  const bgChange = [{ cmd: 'bg_change', val: 'c' }]
  const kinds = (out) => ops(out, 'stand', 'standOff', 'bg').map((c) => c.op)
  const noCmd = run([{ charas: [3] }, { bg: 2 }, { bg: 2 }])
  check('魔法学园 背景换了（没有 bg_change 指令）而没有新 charas 也收立绘；之后同一个背景不重复收', same(kinds(noCmd), ['bg', 'stand', 'bg', 'standOff']), J(kinds(noCmd)))
  const viaCmd = run([{ others: bgChange, text: null }, { charas: [3] }, { charas: null }, { bg: 2, others: bgChange, text: null }, { bg: 2 }, { bg: 2 }])
  check('魔法学园 第 0 行 bg_change 时还没有立绘 = 无害；新场景（bg_change）charas=null → 收一次', same(kinds(viaCmd), ['bg', 'stand', 'bg', 'standOff']) || same(kinds(viaCmd), ['bg', 'stand', 'standOff']) || kinds(viaCmd).filter((o) => o === 'standOff').length === 1, J(kinds(viaCmd)))
  const withNew = run([{ charas: [3] }, { bg: 2, others: bgChange, charas: [3] }])
  check('魔法学园 新场景的这一行自带 charas：整组替换，不先 standOff', same(kinds(withNew), ['bg', 'stand', 'bg', 'stand']), J(kinds(withNew)))
  const sameBg = run([{ charas: [3] }, { others: bgChange, bg: 1 }])
  check('魔法学园 bg_change 但背景值没变（同一张图再来一次）也算换场景：清立绘（原版 background_changed）', same(kinds(sameBg), ['bg', 'stand', 'bg', 'standOff']), J(kinds(sameBg)))
  check('魔法学园 stand.clearOnBgChange false = 不收：立绘一直留着', same(kinds(run([{ charas: [3] }, { bg: 2 }, { bg: 2 }], { stand: { clearOnBgChange: false } })), ['bg', 'stand', 'bg']), J(kinds(run([{ charas: [3] }, { bg: 2 }, { bg: 2 }], { stand: { clearOnBgChange: false } }))))

  // --- others 表 ---
  const act = (type, extra = {}) => ({ cmd: 'action', val: { type, target: [{ body_file: 'body10', chara_id: 'PAULY' }] }, ...extra })
  const emo = (type) => ({ cmd: 'emotion', val: { type, target: [{ body_file: 'body10', chara_id: 'PAULY' }] } })
  const types = { action: ['bow', 'jump', 'swing', 'vibe', 'avoid', 'slideinR', 'slideinL', 'slideinD', 'attackR', 'attackL', 'attackD'], emotion: ['shock', 'sweat', 'question', 'donyori', 'exclamation', 'anger', 'paa', 'kirakira'] }
  const all = run([{ others: [...types.action.map((t) => act(t)), ...types.emotion.map(emo)] }, { text: 't' }])
  check('魔法学园 others 默认表：bow/jump/swing/vibe/avoid → 整屏 shake（5 条）；slidein* / attack* → raw（stats.raw 里按 others:<cmd>:<type> 分开记）；全部 emotion → drop（原版 json_story_player 根本不处理 emotion，不是缺口，不记）', ops(all, 'shake').length === 5 && same(Object.keys(all.stats.raw).sort(), types.action.slice(5).map((t) => `others:action:${t}`).sort()) && !Object.keys(all.stats.mapped).some((k) => k.startsWith('others:emotion')) && all.stats.mapped['others:action:bow'] === 1, J([all.stats.raw, all.stats.mapped]))
  check('魔法学园 others 默认：swing → 横向轻抖、jump / bow → 纵向', same(ops(run([{ others: [act('swing')] }]), 'shake')[0], { op: 'shake', axis: 'horizontal', strength: 0.1, seconds: 0.4 }) && ops(run([{ others: [act('jump')] }]), 'shake')[0].axis === 'vertical')
  const unknown = run([{ others: [act('flyaway'), { cmd: 'action', val: 'x' }, { cmd: 'zzz', val: { type: 'q' } }, { cmd: 'bg_change', val: 'f' }] }])
  check('魔法学园 others：没见过的类型记 others:action:flyaway；没有 type 记 others:action；没有表的 cmd 也 raw（带类型）；bg_change 不进 raw', same(unknown.stats.raw, { 'others:action:flyaway': 1, 'others:action': 1, 'others:zzz:q': 1 }) && ops(unknown, 'shake').length === 0, J(unknown.stats.raw))
  const custom = run([{ others: [act('swing'), act('jump'), emo('shock'), emo('anger'), act('flyaway')] }], { others: { action: { swing: 'raw', jump: 'drop', flyaway: [{ op: 'flash', color: 'white', count: 1, seconds: 0.2 }] }, emotion: { shock: { op: 'wash', color: 'white', seconds: 1 } } } })
  check('魔法学园 others 覆盖：swing 改 raw、jump 改 drop（不记）、新类型 flyaway → flash、emotion.shock → wash；没动的项（anger 默认 drop = 不记）保持', ops(custom, 'shake').length === 0 && ops(custom, 'flash').length === 1 && ops(custom, 'wash').length === 1 && same(custom.stats.raw, { 'others:action:swing': 1 }), J(custom.stats))
  const dflt = run([{ others: [act('zzz'), emo('zzz')] }], { others: { action: { default: [{ op: 'shake', axis: 'overall', strength: 0.1, seconds: 0.2 }] } } })
  check('魔法学园 others.<cmd>.default：没列出的类型走 default（action 改成 shake，emotion 仍 drop）', ops(dflt, 'shake').length === 1 && !('others:emotion:zzz' in dflt.stats.raw))
  check('魔法学园 others 表只收对象：整张写成别的 / 单项 null 不炸，用默认', run([{ others: [act('swing')] }], { others: 5 }).stats.mapped['others:action:swing'] === 1 && run([{ others: [act('swing')] }], { others: { action: 7 } }).stats.mapped['others:action:swing'] === 1)

  // --- bg_change 表 ---
  const fadeOf = (val, options) => ops(run([{ others: [{ cmd: 'bg_change', ...(val === undefined ? {} : { val }) }], text: null }, { text: 't' }], options), 'bg')[0].fade
  check('魔法学园 bgChange 默认：f → 渐变 0.5 秒、c → 0（切）、s → 0.5（当 fade）、没有 val / 没见过的值 → 0（以前的行为）', fadeOf('f') === 0.5 && fadeOf('c') === 0 && fadeOf('s') === 0.5 && fadeOf(undefined) === 0 && fadeOf('x') === 0)
  check('魔法学园 bgChange 覆盖：f 改 1.5、新值 x、default 改 0.2；非法秒数 = 0', fadeOf('f', { bgChange: { f: { fade: 1.5 } } }) === 1.5 && fadeOf('x', { bgChange: { x: { fade: 2 } } }) === 2 && fadeOf(undefined, { bgChange: { default: { fade: 0.2 } } }) === 0.2 && fadeOf('f', { bgChange: { f: { fade: -3 } } }) === 0)
  check('魔法学园 没有 bg_change 指令的背景切换 fade 仍是 0（只有 bg_change.val 决定渐变）', ops(run([{ bg: 1 }, { bg: 2 }]), 'bg').every((c) => c.fade === 0))

  // --- 语音：字符串 / dic 下标 / 字典 ---
  const v = (voice, options) => run([{ voice }], options)
  const vsrc = (voice, options) => ops(v(voice, options), 'voice').map((c) => c.src)
  check('魔法学园 语音：字符串 = 文件名（mp3 → ogg）；整数 = dic 下标（dic[4] = ABC_02.mp3）；dic 里是字典 → 取 file（dic[7] = { file: ABC_03.mp3 }）', same(vsrc('ABC_01.mp3'), ['audio/voice/g1/ABC_01.ogg']) && same(vsrc(4), ['audio/voice/g1/ABC_02.ogg']) && same(vsrc(7), ['audio/voice/g1/ABC_03.ogg']))
  const vn = v(5)
  check('魔法学园 语音：整数指向 null（dic[5] = null）= 没有语音，不记 unresolved；null / 空串 / 空白 = 没有', vsrc(5).length === 0 && vsrc(null).length === 0 && vsrc('  ').length === 0 && vn.stats.voices.referenced === 0 && Object.keys(vn.stats.unresolved).length === 0)
  const oob = v(99)
  check('魔法学园 语音：dic 下标越界记 unresolved voice:#99，计入 stats.voices.unresolved', oob.stats.unresolved['voice:#99'] === 1 && oob.stats.voices.unresolved === 1 && oob.stats.voices.referenced === 1)
  const mixed = run([{ voice: 'ABC_01.mp3' }, { voice: 4 }, { voice: 'NOPE.mp3' }, { voice: null }])
  check('魔法学园 stats.voices = { referenced, resolved, unresolved, guessed }：3 次引用、2 个找到、1 个没找到（unresolved 里按名字记）', same(mixed.stats.voices, { referenced: 3, resolved: 2, unresolved: 1, guessed: 0 }) && mixed.stats.unresolved['voice:NOPE.ogg'] === 1, J(mixed.stats))
  const noIdx = aw.parse(base([{ voice: 'ABC_01.mp3' }, { voice: 4 }]), aw.prepare({ options: {}, files: [], toResourcePath: (r) => r }), { stem: 'ep' })
  check('魔法学园 没有索引：整数下标也解成名字，按 voice.fallback 拼路径，计入 guessed', same(ops(noIdx, 'voice').map((c) => c.src), ['audio/voice/ep/ABC_01.ogg', 'audio/voice/ep/ABC_02.ogg']) && noIdx.stats.voices.guessed === 2)
  const literal = v(4, { dic: { indexFields: ['bgs', 'bgms', 'charas', 'names', 'colors'] } })
  check('魔法学园 dic.indexFields 不含 voices：整数就是文件名本身（以前的行为，名字 "4" 找不到）', literal.stats.unresolved['voice:4'] === 1 && ops(literal, 'voice').length === 0, J(literal.stats))
  const mp3Only = (voice) => ops(run([{ voice }], {}, [...rels.filter((r) => !r.includes('audio/voice')), 'audio/voice/g1/ABC_01.mp3']), 'voice').map((c) => c.src)
  check('魔法学园 语音：脚本写 .mp3、磁盘上只有 .mp3（没有 .ogg）→ 换算后的 .ogg 找不到，再试原名，找到 .mp3（以前记 unresolved）', same(mp3Only('ABC_01.mp3'), ['audio/voice/g1/ABC_01.mp3']))
  check('魔法学园 voice.extFallback 默认 []（.mp3 写成空串后找不到不换扩展名）；写了就按顺序试', ops(v('ABC_01.mp3', { voice: { ext: { '.mp3': '' }, extFallback: [] } }), 'voice').length === 0 && same(vsrc('ABC_01.mp3', { voice: { ext: { '.mp3': '' }, extFallback: ['.wav', '.ogg'] } }), ['audio/voice/g1/ABC_01.ogg']))

  // --- BGM 端到端（真实布局：resources 里是 "bgm/battle05.mp3" 这类字符串，bgms 是 dic 下标；磁盘上 game/audio/bgm/<名>.mp3，同名 .ogg 优先）---
  const bgmStory = JSON.stringify({ bgms: [0, 2, 2, 3, 0], bgs: [1, 1, 1, 1, 1], voices: [null, null, null, null, null], texts: ['a', 'b', 'c', 'd', 'e'], names: [null, null, null, null, null], colors: [null, null, null, null, null], charas: [null, null, null, null, null], others: [[], [], [], [], []], effects: [null, null, null, null, null], waits: [null, null, null, null, null], chara_keys: ['ABC'],
    resources: ['bgm/battle05.mp3', 'bgm/kanashimi04.mp3', 'bg/a.jpg'], dic: [null, 'bg/a.jpg', 'bgm/battle05.mp3', 'bgm/kanashimi04.mp3'] })
  const bgmRun = async (files, options = {}, extra = {}) => {
    const tree = Object.fromEntries([...files.map((f) => [`game/${f}`, 'x']), ['game/episode_scripts/G/s.json', bgmStory]])
    return (await e2e('artwhirl-json', tree, options, 'game/episode_scripts/G/s.json', { resourceRoots: ['game'], ...extra })).scene
  }
  const only = await bgmRun(['images/bg/a.jpg', 'audio/bgm/battle05.mp3', 'audio/bgm/kanashimi04.mp3'])
  check('魔法学园 BGM 端到端：磁盘上只有 .mp3（game/audio/bgm/<名>.mp3）→ bgm 指令 src = audio/bgm/<名>.mp3，换曲 / 停止顺序对（battle05 → kanashimi04 → 停）', same(ops(only, 'bgm', 'bgmStop').map((c) => c.op === 'bgm' ? c.src : c.op), ['audio/bgm/battle05.mp3', 'audio/bgm/kanashimi04.mp3', 'bgmStop']) && same(only.stats.bgm, { referenced: 2, resolved: 2, unresolved: 0 }), J([ops(only, 'bgm', 'bgmStop'), only.stats]))
  const both = await bgmRun(['images/bg/a.jpg', 'audio/bgm/battle05.mp3', 'audio/bgm/battle05.ogg', 'audio/bgm/kanashimi04.mp3'])
  check('魔法学园 BGM 端到端：同名 .ogg 和 .mp3 都在 → 优先 .ogg（extPrefer）；只有 .mp3 的那首仍是 .mp3', same(ops(both, 'bgm').map((c) => c.src), ['audio/bgm/battle05.ogg', 'audio/bgm/kanashimi04.mp3']))
  const wav = await bgmRun(['images/bg/a.jpg', 'audio/bgm/battle05.wav', 'audio/bgm/kanashimi04.m4a'])
  check('魔法学园 audioExtFallback（防御性，没有证据磁盘上是别的扩展名）：名字 .mp3 磁盘上是 .wav / .m4a → 按顺序换扩展名找到；[] = 不试（记 unresolved，stats.bgm.unresolved）', same(ops(wav, 'bgm').map((c) => c.src), ['audio/bgm/battle05.wav', 'audio/bgm/kanashimi04.m4a']) && (await bgmRun(['audio/bgm/battle05.wav'], { audioExtFallback: [] })).stats.bgm.unresolved === 2)
  const ci = await bgmRun(['audio/bgm/Battle05.MP3', 'audio/bgm/Kanashimi04.mp3'])
  check('魔法学园 BGM 大小写不同：createIndexResolver 忽略大小写找到（以前精确匹配的回归检查）；resourceResolve.caseInsensitive false → 精确匹配（找不到）', ops(ci, 'bgm').length === 2 && (await bgmRun(['audio/bgm/Battle05.MP3'], {}, { resourceResolve: { caseInsensitive: false } })).stats.bgm.resolved === 0)
  const offsetRoot = await bgmRun(['audio/bgm/battle05.mp3'], {}, { resourceRoots: ['game', 'other'] })
  check('魔法学园 BGM：多个资源根时路径仍相对 game（回归）', ops(offsetRoot, 'bgm')[0]?.src === 'audio/bgm/battle05.mp3')
}

// ================= Grenze =================
{
  const X = (rows) => rows.map((row, i) => `<easy_dialog-1 ${Object.entries({ id: String(i + 1), ...(i + 1 < rows.length ? { next_id: String(i + 2) } : {}), ...row }).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('\n')
  const FILES = ['bg/battlebg/a/a.webp', 'bg/battlebg/b/b.webp', 'merc/pic/7/body.webp', 'merc/pic/8/body.webp', 'voice/101072_bk/ade9_0005.m4a', 'voice/101072_bk/ade9_0006.m4a', 'voice/pk/v1.m4a', 'sound/s1/s1.m4a'].map((f) => `assets/resources/patchres/${f}`)
  const prep = (options) => grenze.prepare({ options, files: FILES, toResourcePath: (rel) => rel.replace(/^assets\/resources\/patchres\//, 'R/'), mediaDir: '' })
  const run = async (rows, options = {}) => grenze.parse(X(rows), await prep(options), { options })
  const T = { text: 't' }

  // --- screen_effect ---
  const fx = async (value, options) => ops(await run([{ screen_effect: value, ...T }], options), 'shake', 'fade', 'flash', 'wash', 'raw').map((c) => ({ ...c }))
  check('grenze screenEffects：速い画面揺れ / 画面シェイク → overall shake；溶明_黒幕 → fade clear；溶暗_黒幕 → fade black；フラッシュ → flash×1；フラッシュ2回 → flash×2；光エフェクト → wash（at 不进场景指令）',
    same(await fx('速い画面揺れ'), [{ op: 'shake', axis: 'overall', strength: 0.15, seconds: 0.4 }]) && (await fx('画面シェイク'))[0].strength === 0.25 && same(await fx('溶明_黒幕'), [{ op: 'fade', to: 'clear', seconds: 1 }]) && same(await fx('溶暗_黒幕'), [{ op: 'fade', to: 'black', seconds: 1 }])
    && same(await fx('フラッシュ'), [{ op: 'flash', color: 'white', count: 1, seconds: 0.3 }]) && (await fx('フラッシュ2回'))[0].count === 2 && same(await fx('光エフェクト'), [{ op: 'wash', color: 'white', seconds: 1 }]), J(await fx('溶暗_黒幕')))
  const numerics = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '13', '99']
  const rawOut = await run(numerics.map((n) => ({ screen_effect: n, ...T })))
  check('grenze screenEffects：数字 id 默认 raw（含没见过的 99）；raw 指令 {cmd, args} 照旧；stats.raw 按 screen_effect:<值> 分开记', ops(rawOut, 'raw').length === numerics.length && same(ops(rawOut, 'raw')[0], { op: 'raw', cmd: 'screen_effect', args: ['1'] }) && numerics.every((n) => rawOut.stats.raw[`screen_effect:${n}`] === 1) && ops(rawOut, 'shake', 'fade', 'flash', 'wash').length === 0, J(rawOut.stats.raw))
  const ov = async (value, table) => run([{ screen_effect: value, ...T }], { screenEffects: table })
  check('grenze screenEffects 覆盖：数字 8 → shake（表里追加）、フラッシュ 改 null → raw、画面シェイク 改 drop → 什么都不记；没动的保持',
    ops(await ov('8', { 8: { op: 'shake', axis: 'vertical', strength: 0.1, seconds: 0.3 } }), 'shake').length === 1 && (await ov('フラッシュ', { フラッシュ: null })).stats.raw['screen_effect:フラッシュ'] === 1
    && Object.keys((await ov('画面シェイク', { 画面シェイク: 'drop' })).stats.raw).length === 0 && ops(await ov('画面シェイク', { 画面シェイク: 'drop' }), 'shake', 'raw').length === 0 && ops(await ov('溶明_黒幕', { 8: null }), 'fade').length === 1)
  const multi = await ov('X', { X: [{ op: 'flash', color: 'red', count: 1, seconds: 0.1 }, { op: 'shake', axis: 'overall', strength: 0.2, seconds: 0.3 }] })
  check('grenze 映射可以是指令数组（按顺序发）', same(ops(multi, 'flash', 'shake').map((c) => c.op), ['flash', 'shake']))
  const entity = await run([{ screen_effect: ' フラッシュ ', ...T }])
  check('grenze 属性值去首尾空白后查表', ops(entity, 'flash').length === 1)

  // --- 时机（at）---
  const order = async (rows, options) => cmds(await run(rows, options)).map((c) => c.op === 'raw' ? `raw:${c.cmd}` : c.op)
  check('grenze 溶暗_黒幕（at start）：先淡黑再换背景；溶明_黒幕：背景换好之后再淡出黑场；フラッシュ在立绘之后', same(await order([{ screen_effect: '溶暗_黒幕', background: 'a', ...T }]), ['fade', 'bg', 'speaker', 'text']) && same(await order([{ screen_effect: '溶明_黒幕', background: 'a', ...T }]), ['bg', 'fade', 'speaker', 'text'])
    && same(await order([{ screen_effect: 'フラッシュ', hero_group_id: '7', ...T }]), ['stand', 'flash', 'speaker', 'text']), J(await order([{ screen_effect: 'フラッシュ', hero_group_id: '7', ...T }])))

  // --- pic_action ---
  const pa = (rows, options) => run(rows, options)
  const clear = await pa([{ hero_group_id: '7', pic_pos: '2', ...T }, { pic_action: '立ち絵全消え', ...T }, { pic_action: '立ち絵全消え', ...T }, { ...T }])
  check('grenze picActions 立ち絵全消え → standOff（只在有立绘时发一次；之后沿用逻辑不再出现立绘）', same(ops(clear, 'stand', 'standOff', 'raw').map((c) => c.op), ['stand', 'standOff']) && same(clear.stats.mapped, { 'pic_action:立ち絵全消え': 2 }), J(clear.stats))
  const swap = await pa([{ hero_group_id: '7', ...T }, { pic_action: '立ち絵全消え', hero_group_id: '7', ...T }, { pic_action: '立ち絵全消え', hero_group_id: '8', ...T }])
  check('grenze picActions 立ち絵全消え 和新立绘同一行：先清再出（standOff 在前，同一个 hero 也重新发 stand）', same(ops(swap, 'stand', 'standOff').map((c) => c.op), ['stand', 'standOff', 'stand', 'standOff', 'stand']), J(ops(swap, 'stand', 'standOff').map((c) => c.op)))
  const dip = await pa([{ pic_action: '溶明溶暗', ...T }])
  check('grenze picActions 溶明溶暗 → 淡到黑再淡回（两条 fade）', same(ops(dip, 'fade').map((c) => c.to), ['black', 'clear']))
  const picRaw = await pa(['下から_全身', '右側現れ消え', '左側現れ消え', 'マスク', '5', '4'].map((v) => ({ pic_action: v, ...T })))
  check('grenze picActions：下から_全身 / 右側現れ消え / 左側現れ消え / マスク / 数字 id 默认 raw，按值分开记', ops(picRaw, 'raw').length === 6 && ['下から_全身', '右側現れ消え', '左側現れ消え', 'マスク', '5', '4'].every((v) => picRaw.stats.raw[`pic_action:${v}`] === 1), J(picRaw.stats.raw))

  // --- effect / effect_pos ---
  const eff = await run([{ effect: 'ダメージエフェクト', effect_pos: '中', ...T }, { effect: '斬撃1', effect_pos: '2', ...T }, { effect: '17', effect_pos: '左', ...T }, { effect: '斬撃3', ...T }, { effect: 'ハンマー', effect_pos: '9', ...T }])
  check('grenze effects 默认全 raw（没有渲染器）：raw 的 args = [effect, effect_pos]（指令本身不变）；stats.raw 按 effect:<值>', same(ops(eff, 'raw'), [['ダメージエフェクト', '中'], ['斬撃1', '2'], ['17', '左'], ['斬撃3', ''], ['ハンマー', '9']].map((args) => ({ op: 'raw', cmd: 'effect', args }))) && eff.stats.raw['effect:斬撃1'] === 1, J(ops(eff, 'raw')))
  const effMap = await run([{ effect: '斬撃1', effect_pos: '右', ...T }], { effects: { 斬撃1: { op: 'flash', color: 'white', count: 1, seconds: 0.2 } } })
  check('grenze effects 填表就生效：斬撃1 → flash，不再记 raw', ops(effMap, 'flash').length === 1 && ops(effMap, 'raw').length === 0 && effMap.stats.mapped['effect:斬撃1'] === 1)
  const effPos = await run([{ effect: '波動', effect_pos: '右', ...T }], { effects: { 波動: { op: 'flash', color: '{pos}', count: 1, seconds: 0.2 } }, effectPos: { 右: 'RIGHT' } })
  check('grenze effectPos：映射出的指令里 {pos} 换成归一化的位置名（默认 右 → right）；表可改', ops(effPos, 'flash')[0].color === 'RIGHT' && ops(await run([{ effect: '波動', effect_pos: '1', ...T }], { effects: { 波動: { op: 'flash', color: '{pos}', count: 1, seconds: 0.2 } } }), 'flash')[0].color === 'left')

  // --- pic_size ---
  const sizeRows = [{ hero_group_id: '7', pic_pos: '2', ...T }, { pic_size: '拡大', ...T }, { ...T }, { pic_size: '通常', ...T }]
  const sizeDef = await run(sizeRows)
  check('grenze picSize 默认全 raw（拡大 / 通常 / 2 / 立ち絵全消え）：立绘不重发、记 pic_size:<值>', ops(sizeDef, 'stand').length === 1 && sizeDef.stats.raw['pic_size:拡大'] === 1 && sizeDef.stats.raw['pic_size:通常'] === 1)
  const sizeOn = await run(sizeRows, { picSize: { 拡大: { zoom: 1.2, fit: 0 }, 通常: { zoom: 1 } } })
  check('grenze picSize 填成 { zoom, fit }：拡大 → 用新大小重发当前立绘（zoom 1.2、不带 fit）并一直生效；通常 → 还原；没有 raw', same(ops(sizeOn, 'stand').map((c) => [c.parts[0].zoom, c.parts[0].fit]), [[undefined, 1], [1.2, undefined], [undefined, 1]]) && Object.keys(sizeOn.stats.raw).length === 0, J(ops(sizeOn, 'stand')))

  // --- back_voice ---
  const bv = async (rows, options) => ops(await run(rows, options), 'bgvoice', 'bgvoiceOff', 'voice', 'raw').map((c) => (c.op === 'bgvoice' ? [c.op, c.slot, c.src, c.volume] : [c.op, c.slot ?? c.src ?? c.cmd]))
  const bvOut = await bv([{ back_voice_pack: '101072_BK', back_voice: 'ade9_0005#0.5', ...T }, { ...T }, { back_voice: 'ade9_0006#0.6', ...T }, { back_voice: 'ade9_0006#0.6', ...T }, { back_voice: 'non', ...T }, { back_voice: 'non', ...T }])
  check('grenze back_voice：<名>#<音量> → bgvoice（slot back、volume 取 # 后面；资源 voice/<包小写>/<名>.m4a）；没有这个属性的行沿用（不重发）；同一个值不重发；non → bgvoiceOff（只在正在放时发一次）',
    same(bvOut, [['bgvoice', 'back', 'R/voice/101072_bk/ade9_0005.m4a', 0.5], ['bgvoice', 'back', 'R/voice/101072_bk/ade9_0006.m4a', 0.6], ['bgvoiceOff', 'back']]), J(bvOut))
  const bvNoRaw = await run([{ back_voice_pack: '101072_BK', back_voice: 'ade9_0005#0.5', ...T }])
  check('grenze back_voice 不再记 raw（默认 rawAttrs 里没有 back_voice）', ops(bvNoRaw, 'raw').length === 0 && Object.keys(bvNoRaw.stats.raw).length === 0)
  check('grenze back_voice：没有 # → volume 取 backVoice.volume（默认 1）；音量夹到 0–1；包没写 → 用 voice_pack 兜底；找不到文件记 unresolved backVoice:<包>/<名>', same(await bv([{ back_voice_pack: '101072_BK', back_voice: 'ade9_0005', ...T }]), [['bgvoice', 'back', 'R/voice/101072_bk/ade9_0005.m4a', 1]]) && (await bv([{ back_voice_pack: '101072_BK', back_voice: 'ade9_0005#7', ...T }]))[0][3] === 1
    && (await bv([{ back_voice_pack: '101072_BK', back_voice: 'ade9_0005', ...T }], { backVoice: { volume: 0.3 } }))[0][3] === 0.3 && same(await bv([{ voice_pack: '101072_BK', back_voice: 'ade9_0006#0.5', ...T }]), [['bgvoice', 'back', 'R/voice/101072_bk/ade9_0006.m4a', 0.5]])
    && (await run([{ back_voice_pack: 'ZZ', back_voice: 'nope#0.5', ...T }])).stats.unresolved['backVoice:ZZ/nope'] === 1)
  check('grenze backVoice.onMissing：默认 keep；stop = 没有这个属性的行就停；slot / attr / sep 可改', same(await bv([{ back_voice_pack: '101072_BK', back_voice: 'ade9_0005#0.5', ...T }, { ...T }], { backVoice: { onMissing: 'stop' } }), [['bgvoice', 'back', 'R/voice/101072_bk/ade9_0005.m4a', 0.5], ['bgvoiceOff', 'back']])
    && same(await bv([{ back_voice_pack: '101072_BK', bv: 'ade9_0005@0.4', ...T }], { backVoice: { attr: 'bv', sep: '@', slot: 's2' } }), [['bgvoice', 's2', 'R/voice/101072_bk/ade9_0005.m4a', 0.4]]))
  check('grenze back_voice 的 none 值 / rawAttrs 里写回 back_voice 仍能记 raw（兼容旧配置）', same(await bv([{ back_voice: 'non', ...T }]), []) && (await run([{ back_voice: 'x#1', ...T }], { rawAttrs: ['back_voice'] })).stats.raw['back_voice:x#1'] === 1)

  // --- 兼容：以前的 rawAttrs 语义 ---
  const legacy = await run([{ pic_action_val: '5', screen_effect: '8', new_attr: 'x', ...T }], { rawAttrs: ['pic_action_val', 'new_attr', 'screen_effect'] })
  check('grenze rawAttrs 语义不变：没有表的属性（pic_action_val / 新属性）照旧只记 raw（按 属性:值 分开）；rawAttrs 里没有的属性不处理', same(ops(legacy, 'raw').map((c) => c.cmd), ['pic_action_val', 'new_attr', 'screen_effect']) && legacy.stats.raw['pic_action_val:5'] === 1 && legacy.stats.raw['new_attr:x'] === 1 && (await run([{ screen_effect: 'フラッシュ', ...T }], { rawAttrs: [] })).steps.flatMap((s) => s.commands).every((c) => c.op !== 'flash'))
  const d = grenze.resolveOptions({})
  check('grenze 默认选项：映射表就位（screenEffects 7 个名字 + 12 个数字 null；picActions 6 个名字；effects 7 个名字）', Object.keys(d.screenEffects).length === 19 && Object.keys(d.picActions).length === 14 && ['ダメージエフェクト', '斬撃1', '斬撃2', '斬撃3', 'ハンマー', '波動', 'エナジードレイン'].every((k) => k in d.effects) && d.attrTables.screen_effect === 'screenEffects' && d.backVoice.slot === 'back' && !d.rawAttrs.includes('back_voice'), J(Object.keys(d.picActions)))
  check('grenze resolveOptions 同一份参数只合并一次，且表里的默认映射不被运行时改动（解析两次结果一样）', same(J(await run([{ screen_effect: '溶暗_黒幕', background: 'a', ...T }])), J(await run([{ screen_effect: '溶暗_黒幕', background: 'a', ...T }]))) && grenze.DEFAULT_OPTIONS.screenEffects['溶暗_黒幕'].at === 'start')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
