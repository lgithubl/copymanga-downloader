#!/usr/bin/env node
// 自测（只用 node，不需要浏览器 / 服务 / 端口）：本轮新增的适配器选项
//   1. renpy-legeclo 的裸 `voice "路径"` 语句（bareVoice）：单元 + fixture 端到端（导入 → 取场景 → 取资源）
//   2. tyrano-ks（Kamihime）：layer 3 上的角色（layers.stand / layers.effect / effects.animSlide）、Memorial 剧情（memorial.*）
//   node scripts/dev/gal-adapter-options-d-selftest.mjs
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_OPTIONS as LEG_DEFAULTS, parse as legParse, prepare as legPrepare } from '../../web/library/gal/adapters/renpy-legeclo.mjs'
import { parse as mgParse } from '../../web/library/gal/adapters/renpy-minashigo.mjs'
import { parse as mmParse } from '../../web/library/gal/adapters/renpy-monmusu.mjs'
import { DEFAULT_OPTIONS as TY_DEFAULTS, parse as tyParse } from '../../web/library/gal/adapters/tyrano-ks.mjs'
import { galAdapter } from '../../web/library/gal/adapters/index.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'
import { buildLegecloFixture } from './make-legeclo-fixture.mjs'
import { LAYER3, LAYER3_REL, MEMORIAL, MEMORIAL_REL, RD3, buildKamihimeExtraFixture, buildKamihimeFixture, hashed, memIntro, memMain } from './make-kamihime-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const all = (r) => r.steps.flatMap((s) => s.commands)
const meta = (options, extra = {}) => ({ options, ...extra })
const textOf = (c) => c.segments.map((x) => x.text).join('')

// ================= legeclo：裸 voice 语句 =================
{
  const script = (lines) => `label H_x_01:\n    $ enable_skip()\n${lines.map((l) => `    ${l}`).join('\n')}\n`
  const voices = (r) => all(r).filter((c) => c.op === 'voice').map((c) => c.src)
  const rawOf = (r) => J(r.stats.raw)

  const basic = legParse(script(['voice "audio/voice/a/v_0001.wav"', '"Hero" "First."', 'stop voice', 'voice "audio/voice/a/v_0002.wav"', '"Hero" "Second."', 'stop voice']))
  check('legeclo 默认：裸 voice "路径" → voice 指令，和后面那句台词同一步（顺序 voice → speaker → text）；stop voice 忽略；没有 raw', J(voices(basic)) === J(['audio/voice/a/v_0001.wav', 'audio/voice/a/v_0002.wav']) && basic.steps.length === 2 && J(basic.steps[0].commands.map((c) => c.op)) === J(['voice', 'speaker', 'text']) && J(basic.steps[1].commands.map((c) => c.op)) === J(['voice', 'text']) && rawOf(basic) === '{}', J(basic))

  const extra = legParse(script(['voice "a/1.wav" sustain', 'voice "a/2.wav" "ignored.wav"', 'voice   "a/3.wav"   ', "voice 'a/4.wav'", '"t"']))
  check('legeclo voice 带 sustain / 额外参数 / 多余空白：只取第一个引号串；单引号写法不认（和 play voice 一样，Q = 双引号）→ raw', J(voices(extra)) === J(['a/1.wav', 'a/2.wav', 'a/3.wav']) && extra.stats.raw.voice === 1, J([voices(extra), extra.stats.raw]))

  const odd = legParse(script(['voice [vid]', 'voice vname', 'voice sustain', 'voice', 'voice None', '"t"']))
  check('legeclo voice 的变量 / 无引号 / 空写法保持 raw（stats.raw.voice = 5，没有 voice 指令）；台词照出', voices(odd).length === 0 && odd.stats.raw.voice === 5 && all(odd).some((c) => c.op === 'text'), rawOf(odd))
  const table = legParse(script(['voice [vid]', 'voice vname', 'voice sustain', '"t"']), null, meta({ voiceNoQuote: { variables: { vid: 'v/id.wav', vname: 'v/name.wav' } } }))
  check('legeclo voice [变量] / 裸变量名：voiceNoQuote.variables 里有的按表替换成路径（同 play voice），表里没有的仍 raw', J(voices(table)) === J(['v/id.wav', 'v/name.wav']) && table.stats.raw.voice === 1, J([voices(table), table.stats.raw]))

  const play = legParse(script(['play voice "p/1.wav"', 'queue voice "p/2.wav"', 'voice "p/3.wav"', '"t"']))
  check('legeclo play voice / queue voice 照旧可用，和裸 voice 可以混用', J(voices(play)) === J(['p/1.wav', 'p/2.wav', 'p/3.wav']) && rawOf(play) === '{}', J(play.stats))

  const off = legParse(script(['voice "a/1.wav"', 'play voice "a/2.wav"', '"t"']), null, meta({ bareVoice: [] }))
  check('legeclo bareVoice [] = 关掉：裸 voice 记 raw（以前的行为），play voice 不受影响', J(voices(off)) === J(['a/2.wav']) && off.stats.raw.voice === 1, J([voices(off), off.stats.raw]))
  const custom = legParse(script(['vo "a/1.wav"', 'voice "a/2.wav"', '"t"']), null, meta({ bareVoice: ['vo'] }))
  check('legeclo bareVoice [vo]：自定义语句名；voice 不在表里 → raw', J(voices(custom)) === J(['a/1.wav']) && custom.stats.raw.voice === 1 && !custom.stats.raw.vo, J(custom.stats.raw))
  const bad = (value) => J(legParse(script(['voice "a/1.wav"', '"t"']), null, meta({ bareVoice: value })).steps)
  check('legeclo bareVoice 非法值（字符串 / 数字 / 含空格或符号的词 / 空串）→ 丢掉非法项；不是数组 = 默认 [voice]', bad('voice') === bad(undefined) && bad(5) === bad(undefined) && bad(null) === bad(undefined) && bad(['', 'a b', 'x-y', 3]) !== bad(undefined) && bad(['voice', 'a b']) === bad(undefined), '')
  const same = (options) => J(legParse(script(['scene black', '"A" "x"', 'play voice "p.wav"', '"A" "y"']), null, meta(options)).steps)
  check('legeclo 默认不变：显式写出 DEFAULT_OPTIONS（含 bareVoice）/ bareVoice [] 对没有裸 voice 的脚本结果逐字节一样', same(undefined) === same(structuredClone(LEG_DEFAULTS)) && same({ bareVoice: [] }) === same(undefined) && J(LEG_DEFAULTS.bareVoice) === J(['voice']), '')

  const noVoiceIn = legParse(script(['"A" "x"', 'voice_volume = 3', 'voices "z"', 'voicex "z"', '"t"']))
  check('legeclo：不是 voice 语句的词（voicex / voices）不被当裸 voice；仍按原来的方式记 raw', voices(noVoiceIn).length === 0 && noVoiceIn.stats.raw.voicex === 1 && noVoiceIn.stats.raw.voices === 1, rawOf(noVoiceIn))

  // monmusu / minashigo 不受影响（monmusu 本来就认裸 voice；minashigo 没有证据，保持 raw）
  check('monmusu 的 voice "路径" 照旧；minashigo 的裸 voice 不变（raw，没有 bareVoice 选项生效）', all(mmParse('label a:\n    voice "m/1.ogg"\n    "t"\n')).some((c) => c.op === 'voice' && c.src === 'm/1.ogg') && !all(mgParse("label a:\n    voice 'm/1.ogg'\n    xyz \"t\"\n", null, meta({ bareVoice: ['voice'] }))).some((c) => c.op === 'voice'), '')

  // 端到端：fixture + 追加一个带裸 voice 的脚本 → 导入（gal-layout 写的全表）→ 取场景 → 取资源
  const work = await mkdtemp(path.join(os.tmpdir(), 'gal-d-'))
  try {
    const root = path.join(work, 'legeclo演示')
    await buildLegecloFixture(root)
    const bare = [
      'label H_demo_hero_04:', '    $ enable_skip()', '    scene ab_007_room', '    voice "audio/voice/demo_hero/voice_demo_0001.mp3"', '    "Hero" "Bare voice one."', '    stop voice',
      '    voice "audio/voice/demo_hero/voice_demo_0002.mp3" sustain', '    voice "audio/voice/demo_hero/voice_demo_0001.mp3"', '    "Hero" "Bare voice two."', '    stop voice', '    voice "audio/voice/demo_hero/voice_demo_gone.mp3"', '    "Hero" "Missing file."', '    return', '',
    ].join('\n')
    await writeFile(path.join(root, 'game', 'script', 'hscene', 'demo_hero_04.rpy'), bare)
    const layout = await galLayoutScript({ item: { itemId: 'lg', title: 'lg', config: {}, source: { path: root }, adapters: ['renpy-legeclo'] }, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
    const cfg = layout.itemPatch?.gal?.config
    check('gal-layout 写的 renpy-legeclo 全表含 bareVoice [voice]（和适配器 DEFAULT_OPTIONS 一致）', J(cfg?.adapterOptions?.['renpy-legeclo']?.bareVoice) === J(['voice']), J(cfg?.adapterOptions?.['renpy-legeclo']))
    const handler = createGalHandler({ dataDir: path.join(work, 'data'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
    const sceneOf = async (config, title) => {
      const imported = await handler.importFromSource({ sourcePath: root, options: { adapters: ['renpy-legeclo'], config: { ...config, game: { id: 'legeclo', title: 'legeclo' } } } })
      const itemId = imported.items[0].itemId
      const node = async (sectionId) => (await handler.getReaderContent(itemId, 'main', { sectionId })).node
      let cur = await node('')
      for (let depth = 0; depth < 4; depth++) {
        const hit = cur.items?.find((x) => x.title === title || x.title?.includes?.(title))
        if (hit && /demo_hero_04/.test(`${hit.title}${hit.node}`)) { const played = await handler.getReaderContent(itemId, 'main', { sectionId: hit.node }); return { itemId, scene: played.scene || played.node?.scene } }
        const next = cur.items?.find((x) => x.type === 'dir' || x.kind === 'dir' || x.node)
        if (!next) break
        cur = await node(next.node)
      }
      return { itemId, scene: null }
    }
    const got = await sceneOf(cfg, 'demo_hero_04')
    const scene = got.scene
    const sv = scene ? scene.steps.flatMap((s) => s.commands).filter((c) => c.op === 'voice').map((c) => c.src) : []
    check('端到端：裸 voice 行 → 场景里的 voice 指令（路径相对 game/，和 play voice 一样）；stop voice 不产生指令；缺文件的路径也照出（播放器处理）', scene?.adapter === 'renpy-legeclo' && J(sv) === J(['audio/voice/demo_hero/voice_demo_0001.mp3', 'audio/voice/demo_hero/voice_demo_0002.mp3', 'audio/voice/demo_hero/voice_demo_0001.mp3', 'audio/voice/demo_hero/voice_demo_gone.mp3']) && scene.steps.length === 3 && !scene.stats?.raw?.voice, J([scene?.adapter, sv, scene?.steps?.length, scene?.stats]))
    const bytes = await handler.getResource(got.itemId, sv[0]).catch((e) => e)
    check('端到端：voice src 能被资源接口取到（audio/voice/… 相对 game/）', bytes?.body?.toString?.() === 'mp3', String(bytes?.message))
    const off2 = await sceneOf({ ...cfg, adapterOptions: { ...cfg.adapterOptions, 'renpy-legeclo': { ...cfg.adapterOptions['renpy-legeclo'], bareVoice: [] } } }, 'demo_hero_04')
    check('端到端（覆盖）：adapterOptions.renpy-legeclo.bareVoice [] → 没有 voice 指令，stats.raw.voice = 4', off2.scene && !off2.scene.steps.flatMap((s) => s.commands).some((c) => c.op === 'voice') && off2.scene.stats?.raw?.voice === 4, J(off2.scene?.stats))
  } finally { await rm(work, { recursive: true, force: true }) }
}

// ================= Kamihime：layer 3 / Memorial =================
{
  const work = await mkdtemp(path.join(os.tmpdir(), 'gal-d2-'))
  try {
    const media = path.join(work, 'kamihime演示')
    await buildKamihimeFixture(media)
    await buildKamihimeExtraFixture(media)
    const adapter = galAdapter('tyrano-ks')
    const config = normalizeGalConfig({ resourceRoots: ['game/dmm/assets'], adapterOptions: { 'tyrano-ks': { root: 'game/dmm' } } })
    const ctx = await loadAdapterContext({ adapter, mediaDir: media, config })
    const L3 = { rel: LAYER3_REL, stem: '9103_harem-layer3_script' }
    const MEM = { rel: MEMORIAL_REL, stem: '1022_harem-memorial_script' }
    const run = (text, m, options, useCtx = ctx) => tyParse(text, useCtx, { ...m, options })
    const stands = (r) => all(r).filter((c) => c.op === 'stand' || c.op === 'standOff').map((c) => (c.op === 'standOff' ? 'off' : c.parts.map((p) => `${p.src.split('-')[0]}:${p.align}`).join('+')))
    const rawOf = (r, cmd) => all(r).filter((c) => c.op === 'raw' && c.cmd === cmd).length
    const hana = 'hana_00'
    const rina = 'rina_00'

    // ---- layer 3 ----
    const def = run(LAYER3, L3)
    check('layer 3 默认：滑入的 anim / layopt（true / false）/ freeimage 全部吃掉：stats.raw 里没有 anim / layopt / freeimage', !def.stats.raw.anim && !def.stats.raw.layopt && !def.stats.raw.freeimage && rawOf(def, 'anim') === 0, J(def.stats.raw))
    check('chara_show layer=3 照常是立绘：hana 居中 → hana 左 + rina 右（出场顺序）', J(stands(def).slice(0, 2)) === J([`${hana}:center`, `${hana}:left+${rina}:right`]), J(stands(def)))
    check('[freeimage layer=3]：去掉 shown 在 layer 3 的 rina，保留 layer 0 的 hana（重发 stand hana 居中）；再 show rina（layer 3）→ hana + rina；hide hana + freeimage → 空了：standOff', J(stands(def)) === J([`${hana}:center`, `${hana}:left+${rina}:right`, `${hana}:center`, `${hana}:left+${rina}:right`, 'off']), J(stands(def)))
    check('步数不变：5 句台词 5 步，每步都有 text', def.steps.length === 5 && def.steps.every((s) => s.commands.some((c) => c.op === 'text')), String(def.steps.length))
    const raw = run(LAYER3, L3, { effects: { animSlide: 'raw' } })
    check('effects.animSlide raw：layer 3 的 anim 2 + layopt 2 + freeimage 2 记 raw；立绘行为不变（freeimage 仍然去掉 layer 3 的角色）', rawOf(raw, 'anim') === 2 && rawOf(raw, 'layopt') === 2 && rawOf(raw, 'freeimage') === 2 && J(stands(raw)) === J(stands(def)), J(raw.stats.raw))
    const noStand = run(LAYER3, L3, { layers: { stand: [] } })
    check('layers.stand []：freeimage 不再去掉角色（layer 3 在 effect 里所以仍然吃掉、没有 raw）：freeimage 之后 rina 还在，最后一个 stand 里仍有 rina_00', all(noStand).filter((c) => c.op === 'stand').at(-1).parts.some((p) => p.src.startsWith(rina)) && !noStand.stats.raw.freeimage, J(stands(noStand)))
    const noEffect = run(LAYER3, L3, { layers: { effect: [] } })
    check('layers.effect []：anim 2 / layopt 2 记 raw（不再吃）；freeimage 在 stand 层仍去掉角色且不记 raw', rawOf(noEffect, 'anim') === 2 && rawOf(noEffect, 'layopt') === 2 && rawOf(noEffect, 'freeimage') === 0 && J(stands(noEffect)) === J(stands(def)), J(noEffect.stats.raw))
    const other = run(LAYER3, L3, { layers: { effect: [], stand: ['5'] } })
    check('layers.stand [5]（layer 3 不在里面）：layer 3 的 freeimage 记 raw，不去掉角色（角色在 layer 3）', rawOf(other, 'freeimage') === 2 && all(other).filter((c) => c.op === 'stand').at(-1).parts.some((p) => p.src.startsWith(rina)), J(other.stats.raw))
    const layerOf = run('*start\n[chara_new name="a" storage="a.png" jname="甲"]\n[chara_new name="b" storage="b.png" jname="乙"]\n#a\n[chara_show name="a" layer=1]\n[chara_show name="b" layer=2]\n一[l][cm]\n[freeimage layer=2]\n二[l][cm]\n[freeimage layer=9]\n三[l]', {}, { layers: { stand: ['1', '2'] } }, null)
    check('layers.stand 可以列多层：freeimage layer=2 只去掉 b（留下 a）；没有角色的 layer 9 的 freeimage 记 raw（不在 stand / effect 里）', J(stands(layerOf)) === J(['a.png:left+b.png:right', 'a.png:center']) && layerOf.stats.raw.freeimage === 1, J([stands(layerOf), layerOf.stats.raw]))
    const noLayer = run('*start\n[chara_new name="a" storage="a.png" jname="甲"]\n[chara_show name="a"]\n一[l][cm]\n[freeimage layer=3]\n二[l]', {}, undefined, null)
    check('没写 layer 的 chara_show 在 0 层：freeimage layer=3 不动它', J(stands(noLayer)) === J(['a.png:center']) && !noLayer.stats.raw.freeimage, J(stands(noLayer)))
    const bogus = (options) => J(run(LAYER3, L3, options).steps)
    check('layers.stand / effects.animSlide 非法值 → 默认；显式写出默认值结果不变', bogus({ layers: { stand: 'x' } }) === bogus(undefined) && bogus({ effects: { animSlide: 7 } }) === bogus(undefined) && bogus({ layers: { stand: ['3'], effect: ['3'], overlay: ['4'] }, effects: { animSlide: 'ignore' } }) === bogus(undefined) && bogus(structuredClone(TY_DEFAULTS)) === bogus(undefined), '')

    // ---- Memorial ----
    const mem = run(MEMORIAL, MEM)
    const cmds = all(mem)
    const bgs = cmds.filter((c) => c.op === 'bg' && c.src)
    const memBgs = bgs.filter((c) => /memorial_item/.test(c.src))
    check('mem_img → bg（hash 名在 assets 平铺层照抄解析）：intro 4 张 + main 4 张，每张渐变 0.5 秒；缺的图（mem_gone）只记 stats.unresolved', memBgs.length === 8 && memBgs.slice(0, 4).every((c, i) => c.src === memIntro(i) && c.fade === 0.5) && memBgs.slice(4).every((c, i) => c.src === memMain(i)) && mem.stats.unresolved[`mem_img:${hashed('mem_gone', 'png')}`] === 1, J([memBgs.map((c) => c.src), mem.stats.unresolved]))
    const imgSteps = mem.steps.filter((s) => s.commands.some((c) => c.op === 'bg' && /memorial_item/.test(c.src || '')))
    check('连着的 mem_img 每张一步（幻灯片）：8 步，每步 [bg, text（空）]，说话人清空', imgSteps.length === 8 && imgSteps.every((s) => s.commands.filter((c) => c.op === 'bg').length === 1 && s.commands.some((c) => c.op === 'text' && !textOf(c))), J(imgSteps.slice(0, 2)))
    const voiceSteps = mem.steps.filter((s) => s.commands.some((c) => c.op === 'voice') && s.commands.some((c) => c.op === 'text' && textOf(c)))
    const first = voiceSteps.find((s) => s.commands.some((c) => c.op === 'voice' && c.src === `${RD3}/intro_mem_v1.mp3`) && s.commands.some((c) => c.op === 'text' && /二行目/.test(textOf(c))))
    check('mem_voice → 一步：voice（取本剧情 resource_directory 里的文件）+ 台词；text 里字面的 \\n（反斜杠 n）→ 换行；{{主人公}} 默认原样；说话人空', Boolean(first) && textOf(first.commands.find((c) => c.op === 'text')) === '一行目。\n二行目、{{主人公}}さん。' && !first.commands.some((c) => c.op === 'speaker' && textOf(c)), J(first))
    const goneStep = mem.steps.find((s) => s.commands.some((c) => c.op === 'text' && textOf(c) === '音声ファイルなし。'))
    const noText = mem.steps.find((s) => s.commands.some((c) => c.op === 'voice') && s.commands.every((c) => c.op !== 'text' || !textOf(c)) && s.commands.some((c) => c.op === 'voice' && c.src === `${RD3}/intro_mem_v1.mp3`) && s.index > (goneStep?.index ?? 0))
    check('mem_voice 的语音缺：只记 stats.missing，台词照出（没有 voice）；没有 text 属性：只有 voice + 空台词', goneStep && !goneStep.commands.some((c) => c.op === 'voice') && mem.stats.missing['se:gone_voice.mp3'] === 1 && Boolean(noText), J([goneStep, mem.stats.missing]))
    check('memorial 标记不记 raw，mem_img / mem_voice 也不记 raw；stats.memorial 记 sections [intro, main] / images 8 / voices 3', !mem.stats.raw.memorial && !mem.stats.raw.mem_img && !mem.stats.raw.mem_voice && J(mem.stats.memorial) === J({ sections: ['intro', 'main'], images: 8, voices: 3 }), J([mem.stats.raw, mem.stats.memorial]))
    const texts = mem.steps.map((s) => s.commands.filter((c) => c.op === 'text').map(textOf).join(''))
    check('普通台词不受影响：memorial 之前的台词、之后的 #hana 台词各一步，说话人 花', texts[0] === '前置きの台詞。' && texts.at(-1) === '後ろの台詞。' && J(mem.steps.at(-1).commands.filter((c) => c.op === 'speaker').map(textOf)) === J(['花']), J([texts[0], texts.at(-1)]))
    const sectionAt = (r) => r.steps.findIndex((s) => s.commands.some((c) => c.op === 'bg' && /intro_mypage/.test(c.src || '')))
    check('memorial 是段落标记：它之后的第一张图是新的一步（不和前置台词的步合并）；前置台词在它前面成一步', sectionAt(mem) === 1 && mem.steps[0].commands.some((c) => c.op === 'text' && /前置き/.test(textOf(c))), String(sectionAt(mem)))

    const prot = run(MEMORIAL, MEM, { memorial: { protagonist: '勇者' } })
    check('memorial.protagonist 非空：{{主人公}} 替换成它；空串 = 原样保留', all(prot).some((c) => c.op === 'text' && textOf(c) === '一行目。\n二行目、勇者さん。') && all(mem).some((c) => textOf(c.op === 'text' ? c : { segments: [] }).includes('{{主人公}}')) && !all(prot).some((c) => c.op === 'text' && textOf(c).includes('{{主人公}}')), '')
    const ph = run('*start\n[mem_voice storage="a.mp3" text="@@名@@ x {{主人公}}"]', {}, { memorial: { protagonist: 'Z', placeholder: '@@名@@' } }, null)
    check('memorial.placeholder：占位符可改（字面串）；只替换这个，别的写法原样', textOf(all(ph).find((c) => c.op === 'text')) === 'Z x {{主人公}}', J(all(ph)))
    const fade = run(MEMORIAL, MEM, { memorial: { imageFade: 0 } })
    const fade2 = run(MEMORIAL, MEM, { memorial: { imageFade: 2 } })
    check('memorial.imageFade：0 → 立刻切；2 → 渐变 2 秒；非法值 → 0.5', all(fade).filter((c) => c.op === 'bg' && /memorial_item/.test(c.src || '')).every((c) => c.fade === 0) && all(fade2).filter((c) => c.op === 'bg' && /memorial_item/.test(c.src || '')).every((c) => c.fade === 2) && J(run(MEMORIAL, MEM, { memorial: { imageFade: 'x' } }).steps) === J(mem.steps), '')
    const noStep = run(MEMORIAL, MEM, { memorial: { imageStep: false } })
    check('memorial.imageStep false：图不单独成步（跟着后面的 mem_voice / 台词走），步数减少', noStep.steps.length < mem.steps.length && all(noStep).filter((c) => c.op === 'bg' && /memorial_item/.test(c.src || '')).length === 8, `${noStep.steps.length} vs ${mem.steps.length}`)
    const disabled = run(MEMORIAL, MEM, { memorial: { enabled: false } })
    check('memorial.enabled false：memorial 2 / mem_img 9 / mem_voice 3 记 raw（以前的行为），没有 bg / voice 指令来自它们', disabled.stats.raw.memorial === 2 && disabled.stats.raw.mem_img === 9 && disabled.stats.raw.mem_voice === 3 && !disabled.stats.memorial && !all(disabled).some((c) => c.op === 'bg' && /memorial_item/.test(c.src || '')), J(disabled.stats.raw))
    check('默认不变：显式写出 memorial 默认值 / 非法类型（memorial: 5、enabled: undefined）结果和默认一样；没有 memorial 标签的剧情 stats 里没有 memorial 键', J(run(MEMORIAL, MEM, { memorial: { enabled: true, imageFade: 0.5, imageStep: true, protagonist: '', placeholder: '{{主人公}}' } }).steps) === J(mem.steps) && J(run(MEMORIAL, MEM, { memorial: 5 }).steps) === J(mem.steps) && J(run(MEMORIAL, MEM, { memorial: { placeholder: 5, protagonist: 5 } }).steps) === J(mem.steps) && !('memorial' in def.stats), '')
    // 没有 ctx（没有文件索引）：路径按名字原样，不炸
    const bare = run('*start\n[memorial name="intro"]\n[mem_img for="intro" storage="x.jpg"]\n[mem_voice storage="v.mp3" text="a\\nb"]', {}, undefined, null)
    check('没有 ctx：mem_img 的 storage 原样当 src、mem_voice 的语音原样；\\n 换行', J(all(bare).filter((c) => c.op === 'bg').map((c) => c.src)) === J(['x.jpg']) && textOf(all(bare).filter((c) => c.op === 'text').at(-1)) === 'a\nb', J(all(bare)))
    let threw = ''
    for (const input of ['[memorial]', '[mem_img]', '[mem_voice]', '[mem_img storage=]', '[mem_voice text=]', '[mem_voice storage="a" text="\\n\\n"]', '[memorial name=a][memorial name=b]', '一[mem_img storage="a.png"]二[l]']) {
      try { tyParse(input, null, {}); tyParse(input, ctx, MEM) } catch (error) { threw = `${J(input)}: ${error.message}` }
    }
    check('容错：残缺的 memorial 标签 / 没有属性 / 夹在文字中间，都不抛', !threw, threw)

    // 端到端：gal-layout 写的全表 + 取场景（Memorial 和 layer 3 剧情经 handler 播放）
    const layout = await galLayoutScript({ item: { itemId: 'kh', title: 'kh', config: {}, source: { path: media }, adapters: ['tyrano-ks'] }, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
    const cfg = layout.itemPatch?.gal?.config
    const table = cfg?.adapterOptions?.['tyrano-ks']
    check('gal-layout 写的 tyrano-ks 全表：layers.stand [3]、effects.animSlide ignore、memorial 默认值（和适配器 DEFAULT_OPTIONS 一致）', J(table?.layers?.stand) === J(['3']) && table?.effects?.animSlide === 'ignore' && J(table?.memorial) === J(TY_DEFAULTS.memorial), J(table))
    const handler = createGalHandler({ dataDir: path.join(work, 'data'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
    const imported = await handler.importFromSource({ sourcePath: media, options: { adapters: ['tyrano-ks'], config: { ...cfg, game: { id: 'kamihime', title: 'kamihime' }, adapterOptions: { 'tyrano-ks': { ...table, memorial: { ...table.memorial, protagonist: '勇者' } } } } } })
    const itemId = imported.items[0].itemId
    const node = async (sectionId) => (await handler.getReaderContent(itemId, 'main', { sectionId })).node
    const walk = async (cur, want) => {   // 深度优先找标题带 want 的剧情
      for (const item of cur.items || []) {
        if (item.title?.includes?.(want)) return item
        if (item.node && !/^s:/.test(item.node)) { const hit = await walk(await node(item.node), want); if (hit) return hit }
      }
      return null
    }
    const home = await node('')
    const memItem = await walk(home, 'Memorial 合成')
    const layerItem = await walk(home, 'layer3 合成')
    const memScene = memItem && (await handler.getReaderContent(itemId, 'main', { sectionId: memItem.node })).scene
    const memScene2 = memItem && (await handler.getReaderContent(itemId, 'main', { sectionId: memItem.node })).node?.scene
    const ms = memScene || memScene2
    const lsRes = layerItem && (await handler.getReaderContent(itemId, 'main', { sectionId: layerItem.node }))
    const ls = lsRes?.scene || lsRes?.node?.scene
    const msCmds = ms ? ms.steps.flatMap((s) => s.commands) : []
    check('端到端：Memorial 剧情经 handler 播放——8 张幻灯片 bg、voice 取 RD3、protagonist 配置生效（勇者）、没有 raw memorial', ms?.adapter === 'tyrano-ks' && msCmds.filter((c) => c.op === 'bg' && /memorial_item/.test(c.src || '')).length === 8 && msCmds.some((c) => c.op === 'voice' && c.src === `${RD3}/intro_mem_v1.mp3`) && msCmds.some((c) => c.op === 'text' && textOf(c).includes('勇者さん')) && !ms.stats?.raw?.memorial, J(ms?.stats))
    const slide = msCmds.find((c) => c.op === 'bg' && /memorial_item/.test(c.src || ''))
    const png = slide && (await handler.getResource(itemId, slide.src).catch((e) => e))
    check('端到端：mem_img 的 bg src 能被资源接口取到（PNG / JPEG 字节）', Boolean(png?.body?.length) && png.body.length > 8, String(png?.message || slide?.src))
    check('端到端：layer 3 剧情——没有 raw anim / layopt / freeimage，5 步，最后一步 standOff', ls?.adapter === 'tyrano-ks' && !ls.stats?.raw?.anim && !ls.stats?.raw?.layopt && !ls.stats?.raw?.freeimage && ls.steps.length === 5 && ls.steps.at(-1).commands.some((c) => c.op === 'standOff'), J(ls?.stats))
  } finally { await rm(work, { recursive: true, force: true }) }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
