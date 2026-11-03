#!/usr/bin/env node
// MahotanArchive（まほろば妖女奇譚）：.mhp（ZIP）展开 / 虚拟索引（更新包覆盖、Deflate）+ mahotan::json 适配器（资源表、立绘头对齐、CG、转场、占位符）+ gal-layout 识别。纯 node（造 zip 用 python3）。
//   真实样本（可选）：MAHOTAN_SAMPLE=<含 assets/mahotan-data.mhp 的目录> 时再把真实 data 包的 1001 个脚本整份解析一遍
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import * as adapter from '../../web/library/gal/adapters/mahotan-json.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, virtualFiles } from '../../web/library/gal/containers.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = JSON.stringify

// 造 zip：entries = { 名字: [内容（字符串 / base64 前缀 b64:）, 'store' | 'deflate'] }
function makeZip(file, entries) {
  execFileSync('python3', ['-c', `
import zipfile,sys,json,base64
spec=json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1],'w') as z:
    for name,(data,mode) in spec.items():
        raw=base64.b64decode(data[4:]) if data.startswith('b64:') else data.encode('utf8')
        z.writestr(zipfile.ZipInfo(name), raw, zipfile.ZIP_STORED if mode=='store' else zipfile.ZIP_DEFLATED)
`, file, J(entries)])
}
const png1 = 'b64:iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// ---- 夹具脚本 ----
const sceneAssets = {
  visuals: { avt_1: 'images/characters/avt_1/standing/main.png', avt_1_1: 'images/characters/avt_1/cg/avt_1_1.png', avt_9: 'images/characters/avt_9/standing/main.png' },
  voices: { v1: 'media/voices/a/v1.mp3', v2: 'media/voices/a/v2.mp3' },
  backgrounds: { bg_3: 'images/backgrounds/background-001.jpg', bg_1: null },
  bgm: { bgm_1: 'media/bgm/bgm_1.mp3' },
  metadata: { avt_1: { kind: 'standing', bounds: { bottom: 1575, left: 770, right: 1337, sourceHeight: 2034, sourceWidth: 2034, top: 603 } }, avt_1_1: { kind: 'cg' }, avt_9: { kind: 'standing', bounds: { bottom: 1500, left: 800, right: 1300, sourceHeight: 2034, sourceWidth: 2034, top: 600 } } },
}
const cmd = (cmd, content = '', extra = {}) => ({ name: '', title: '', extraCmd: '', cmd, content, voice: '', ...extra })
const sceneCommands = [
  cmd('bgm', 'bgm_1'), cmd('background', 'bg_3', { title: '寝室' }), cmd('chara_show', 'avt_1'),
  cmd('text', '「ねぇ、\\nそれ、取って」'.replace(/\\n/g, '\n'), { name: '飯綱', voice: 'v1' }),
  cmd('text', '%player_nameは%player_nameさんに会った', { name: '飯綱' }),
  cmd('text', '%player_nameは笑った', { name: '' }),
  cmd('transition_out'), cmd('background', 'bg_1'), cmd('chara_show', 'avt_1_1'), cmd('transition_in', 'White'),
  cmd('text', 'CG の台詞', { voice: 'v2' }), cmd('chara_hide'), cmd('bgm', ''), cmd('emotion', 'scared|right'), cmd('text', '最後'),
]
const sceneGeneral = J({ sceneId: 'avt_1', commands: sceneCommands, storyAssets: sceneAssets, contentRating: 'general' })
const sceneAdult = J({ commands: sceneCommands.slice(0, 5), sceneId: 'avt_1', storyAssets: sceneAssets })   // 成人版：commands 在前，sceneId 在后
const story = J({ id: 'story_1', version: 'abc', frames: [{ text: 'x' }], commands: sceneCommands.slice(0, 4), terminalState: {}, playback: { sceneId: 'story_1', commands: sceneCommands.slice(0, 4), storyAssets: sceneAssets } })

// ---- 嗅探 ----
check('嗅探：三种开头都认（{"sceneId"… / {"commands":[{…"cmd"… / {"id":…,"version":…,"frames":[…）；别的 JSON 不认', adapter.sniff(sceneGeneral) && adapter.sniff(sceneAdult) && adapter.sniff(story) && !adapter.sniff('{"scenes":[]}') && !adapter.sniff('{"id":"x","name":"y"}') && !adapter.sniff('not json'))

// ---- 适配器 ----
const files = ['images/backgrounds/background-001.jpg', 'images/characters/avt_1/standing/main.png', 'images/characters/avt_1/cg/avt_1_1.png', 'images/characters/avt_9/standing/main.png', 'media/voices/a/v1.mp3', 'media/voices/a/v2.mp3', 'media/bgm/bgm_1.mp3'].map((n) => `arc/res/${n}`)
const toResourcePath = (rel) => rel.replace(/^arc\/res\//, '')
const ctx = adapter.prepare({ options: {}, files, toResourcePath })
const scene = buildScene('mahotan::json', sceneGeneral, ctx, { options: {} })
const all = scene.steps.flatMap((s) => s.commands)
check('资源表：bg_3 → 这个脚本自己的 background-001.jpg；bgm / 语音 / 立绘都按 storyAssets 找到（没有未解析的）', all.some((c) => c.op === 'bg' && c.src === 'images/backgrounds/background-001.jpg') && all.some((c) => c.op === 'bgm' && c.src === 'media/bgm/bgm_1.mp3') && all.some((c) => c.op === 'voice' && c.src === 'media/voices/a/v1.mp3') && Object.keys(scene.stats.unresolved).length === 0, J(scene.stats))
check('文字：多行去掉换行连起来；说话人；%player_name 在别人说话时 = 称呼「主様」、%player_nameさん 称呼已是「様」结尾就不再加さん；旁白里 = 名字「主人公」', J(scene.steps[0].commands.find((c) => c.op === 'text').segments) === J([{ text: '「ねぇ、それ、取って」' }]) && scene.steps[1].commands.find((c) => c.op === 'text').segments[0].text === '主様は主様に会った' && scene.steps[2].commands.find((c) => c.op === 'text').segments[0].text === '主人公は笑った' && scene.steps[0].commands.find((c) => c.op === 'speaker').segments[0].text === '飯綱', J(scene.steps.slice(0, 3)))
const stand = all.find((c) => c.op === 'stand')
const fallbackScale = 1080 / (1575 - 603)
check('立绘（avt_1 没有头框）：bounds 撑满舞台高度、脚对齐底边、水平居中（scale = 1080 / (bottom − top)；y = 底 − bottom×scale + 半高 − 540）', stand && Math.abs(stand.parts[0].scale - fallbackScale) < 1e-3 && stand.parts[0].x === Math.round((1017 - (770 + 1337) / 2) * fallbackScale) && stand.parts[0].y === Math.round(1080 - 1575 * fallbackScale + (2034 * fallbackScale) / 2 - 540) && J(stand.stage) === J([1920, 1080]), J(stand))
check('头对齐：有头框的立绘，头框长边 = 舞台高度的 20%、头框中心在高度的 25%（用真实的 avt_00004：头框 [881,639,1068,826]）', (() => {
  const part = adapter.standingPart('images/characters/avt_00004/standing/main.png', { sourceWidth: 2034, sourceHeight: 2034, left: 770, top: 603, right: 1337, bottom: 1575 }, { stage: [1920, 1080], headFraction: 0.2, headCenterY: 0.25 })
  const scale = (1080 * 0.2) / 187
  return Math.abs(part.scale - scale) < 1e-3 && part.x === Math.round((1017 - 974.5) * scale) && part.y === Math.round(270 - 732.5 * scale + (2034 * scale) / 2 - 540)
})(), J(adapter.standingPart('images/characters/avt_00004/standing/main.png', { sourceWidth: 2034, sourceHeight: 2034, left: 770, top: 603, right: 1337, bottom: 1575 }, { stage: [1920, 1080], headFraction: 0.2, headCenterY: 0.25 })))
check('头框表只在源图尺寸对得上才用（By 条目带 sourceWidth / sourceHeight）；表里没有的立绘 = 没有头框', adapter.headBoxOf('images/characters/cha_10001/standing/cha_10001.png', { sourceWidth: 2034, sourceHeight: 2034 })?.length === 4 && adapter.headBoxOf('images/characters/cha_10001/standing/cha_10001.png', { sourceWidth: 1000, sourceHeight: 1000 }) === null && adapter.headBoxOf('images/characters/nobody/standing/main.png', null) === null)
const cgOverlay = all.find((c) => c.op === 'overlay')
check('CG（kind = cg）：铺满舞台（overlay fit = contain），立绘撤掉；换回立绘时 CG 撤掉', cgOverlay?.slot === 'cg' && cgOverlay.fit === 'contain' && all.some((c) => c.op === 'standOff' && c.slot === 'chara') && all.some((c) => c.op === 'overlayOff' && c.slot === 'cg'), J(all.filter((c) => /overlay|stand/.test(c.op))))
check('转场：transition_out = 渐黑 1 秒、transition_in = 渐出 2 秒（White 也用黑）；背景表里是 null 的 bg_1 = 不画背景（bgoff）；bgm 清空 = bgmStop', all.some((c) => c.op === 'fade' && c.to === 'black' && c.seconds === 1) && all.some((c) => c.op === 'fade' && c.to === 'clear' && c.seconds === 2) && all.some((c) => c.op === 'bgoff') && all.some((c) => c.op === 'bgmStop'), J(all.filter((c) => /fade|bgoff|bgmStop/.test(c.op))))
check('特效没做的（emotion）记进 ignored，不影响文字；每个 text 一步', scene.stats.ignored.emotion === 1 && scene.stats.messages === 5 && scene.steps.filter((s) => s.commands.some((c) => c.op === 'text' && c.segments.length)).length === 5, J(scene.stats))
const st = buildScene('mahotan::json', story, ctx, { options: {} })
const ad = buildScene('mahotan::json', sceneAdult, ctx, { options: {} })
check('stories（storyAssets 在 playback 里）和 adult（commands 在前）都能解析', st.stats.messages === 1 && ad.stats.messages === 2 && Object.keys(st.stats.unresolved).length === 0, J([st.stats, ad.stats]))
const named = buildScene('mahotan::json', sceneGeneral, adapter.prepare({ options: { protagonistName: 'ユウ', protagonistAddress: 'ご主人様' }, files, toResourcePath }), { options: { protagonistName: 'ユウ', protagonistAddress: 'ご主人様' } })
check('名字 / 称呼可配（protagonistName / protagonistAddress）', named.steps[1].commands.find((c) => c.op === 'text').segments[0].text === 'ご主人様はご主人様に会った' && named.steps[2].commands.find((c) => c.op === 'text').segments[0].text === 'ユウは笑った')

// ---- containers + gal-layout ----
const work = await mkdtemp(path.join(os.tmpdir(), 'mahotan-'))
try {
  const root = path.join(work, 'MahotanArchive')
  await mkdir(path.join(root, 'assets'), { recursive: true })
  await mkdir(path.join(root, 'translations'), { recursive: true })
  await writeFile(path.join(root, 'MahotanArchive.exe'), 'MZ')
  await writeFile(path.join(root, 'userdata.json'), '{}')
  makeZip(path.join(root, 'assets', 'mahotan-data.mhp'), { 'metadata/packages/data.json': ['{}', 'deflate'], 'data/scripts/scene/general/avt_1.json': [sceneGeneral, 'deflate'], 'data/scripts/stories/main/story_1.json': [story, 'deflate'], 'data/catalogs/x.json': ['{}', 'store'] })
  makeZip(path.join(root, 'assets', 'mahotan-images.mhp'), { 'images/backgrounds/background-001.jpg': ['base-bg', 'store'], 'images/characters/avt_1/standing/main.png': [png1, 'deflate'], 'metadata/packages/images.json': ['{}', 'deflate'] })
  makeZip(path.join(root, 'assets', 'mahotan-update-received-1.mhp'), { 'images/backgrounds/background-001.jpg': ['update-bg', 'store'], 'media/bgm/bgm_1.mp3': ['mp3data', 'store'] })
  makeZip(path.join(root, 'translations', 'zh-Hant.mhp'), { 'data/catalog.json': ['{}', 'store'] })
  const layoutItem = { itemId: 'm', title: 'm', config: {}, source: { path: work }, adapters: ['mahotan::json'] }
  const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.37.0', options: {} } })
  const cfgRaw = tagOut.itemPatch?.gal?.config
  const norm = cfgRaw ? normalizeGalConfigWithWarnings(cfgRaw) : null
  const c = norm?.config
  check('gal-layout：认出 MahotanArchive（assets 里 .mhp 是 ZIP + MahotanArchive.exe），id = mahotan::mahotanarchive，containers = mhp / hybrid / 不 flat，只扫 assets（翻译包不是资源）；写出来的 config 规整后零警告', Boolean(c) && c.game.id === 'mahotan::mahotanarchive' && c.containers.format === 'mhp' && c.containers.mode === 'hybrid' && c.containers.flat === false && J(c.containers.scan) === J(['MahotanArchive/assets']) && c.containers.scriptDecoder === 'mahotan-json' && norm.warnings.length === 0, J([tagOut.logs, norm?.warnings, c?.containers]))
  const bad = path.join(work, 'Other'); await mkdir(path.join(bad, 'assets'), { recursive: true }); await writeFile(path.join(bad, 'MahotanArchive.exe'), 'MZ'); await writeFile(path.join(bad, 'assets', 'x.mhp'), 'not a zip')
  const none = await generateTags({ item: { ...layoutItem, config: { game: { id: 'mahotan::x' } }, source: { path: bad } }, script: { id: 'gal-layout', version: '2.37.0', options: {} } })
  check('gal-layout：.mhp 不是 ZIP = 不认', !none.itemPatch?.gal?.config?.containers, J(none.logs))
  const report = await ensureContainers({ mediaDir: work, config: c })
  const base = path.join(root)
  check('展开：data 包的 data/scripts/**.json 原样写到 arc/script/mahotan-data/（保留 scene/general/…、stories/main/… 的目录）；别的包 / 翻译不展开脚本', report.arcs['MahotanArchive/assets/mahotan-data.mhp']?.scripts === 2 && (await readFile(path.join(base, 'arc/script/mahotan-data/scene/general/avt_1.json'), 'utf8')) === sceneGeneral && report.arcs['MahotanArchive/assets/mahotan-images.mhp']?.scripts === 0 && !Object.values(report.arcs).some((r) => r.error), J(report))
  const vf = await virtualFiles({ mediaDir: work, config: c })
  check('虚拟索引：图 / 声音的路径 = 条目路径（arc/res/images/…）；data/ 和 metadata/ 不进；更新包里同路径的覆盖底包', J([...vf.files].sort()) === J(['MahotanArchive/arc/res/images/backgrounds/background-001.jpg', 'MahotanArchive/arc/res/images/characters/avt_1/standing/main.png', 'MahotanArchive/arc/res/media/bgm/bgm_1.mp3'].sort()), J(vf.files))
  const n = await materialize({ mediaDir: work, config: c, rels: vf.files })
  check('取资源：Store 原样、Deflate 解压（PNG 完整）；同路径取到的是更新包的内容', n === 3 && (await readFile(path.join(base, 'arc/res/images/backgrounds/background-001.jpg'), 'utf8')) === 'update-bg' && (await readFile(path.join(base, 'arc/res/images/characters/avt_1/standing/main.png'))).subarray(1, 4).toString() === 'PNG' && (await readFile(path.join(base, 'arc/res/media/bgm/bgm_1.mp3'), 'utf8')) === 'mp3data')
  // 展开出来的脚本 + 虚拟索引 → 适配器端到端
  const ctx2 = adapter.prepare({ options: {}, files: vf.files, toResourcePath: (rel) => rel.replace(/^MahotanArchive\/arc\/res\//, '') })
  const e2e = buildScene('mahotan::json', await readFile(path.join(base, 'arc/script/mahotan-data/scene/general/avt_1.json'), 'utf8'), ctx2, { options: {} })
  check('端到端：展开的脚本 + 虚拟索引 → 背景 / bgm / 立绘都解析到，没有缺资源（语音文件夹具里没造 = 记缺）', e2e.stats.images.unresolved === 1 && e2e.stats.bgm.unresolved === 0 && e2e.stats.voices.unresolved === 2 && Object.keys(e2e.stats.unresolved).every((k) => /^(voice:|image:images\/characters\/avt_1\/cg)/.test(k)), J(e2e.stats))
  const again = await ensureContainers({ mediaDir: work, config: c })
  check('再跑一遍：容器没变 = 命中缓存', again.arcs['MahotanArchive/assets/mahotan-data.mhp']?.cached === true)

  const sample = process.env.MAHOTAN_SAMPLE
  if (sample) {
    const { openZip } = await import('../../web/library/zip-reader.mjs')
    const zip = await openZip(path.join(sample, 'assets/mahotan-data.mhp'))
    let messages = 0; let bad2 = 0; let count = 0
    for (const entry of zip.entries.filter((e) => /^data\/scripts\/.+\.json$/.test(e.name))) {
      const text = (await zip.read(entry)).toString('utf8')
      count += 1
      if (!adapter.sniff(text)) { bad2 += 1; continue }
      messages += buildScene('mahotan::json', text, adapter.prepare({ options: {}, files: [] }), { options: {} }).stats.messages
    }
    await zip.close()
    check(`真实样本：data 包的 ${count} 个脚本全部嗅探 + 解析（${messages} 句台词）`, count === 1001 && bad2 === 0 && messages === 40252, J([count, bad2, messages]))
  } else console.log('SKIP 真实样本（MAHOTAN_SAMPLE=<目录> 才跑）')
} finally { await rm(work, { recursive: true, force: true }) }

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
