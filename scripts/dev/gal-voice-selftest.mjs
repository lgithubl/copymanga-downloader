#!/usr/bin/env node
// Gal「随机语音」自测（不需要浏览器 / 服务）：各适配器的语音收集、白 / 黑名单正则（含安全拒绝）、LRU 缓存、目录节点多脚本尝试、错误。
//   node scripts/dev/gal-voice-selftest.mjs       需要 ImageMagick（造 fixture）
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'
import { createBrowseProvider, invalidateBrowseCaches } from '../../web/library/gal/browse.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { MAX_REGEX_LENGTH, collectVoices, compileVoiceRegex, filterVoices, hasNestedQuantifier, parseVoiceTargets, voiceCacheClear, voiceCacheSize, voiceStats, VOICE_CACHE_MAX, voiceCacheGet, voiceCacheSet } from '../../web/library/gal/voice.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { buildGirlsCreationFixture } from './make-girlscreation-fixture.mjs'
import { buildGrenzeFixture } from './make-grenze-fixture.mjs'
import { buildKamihimeFixture } from './make-kamihime-fixture.mjs'
import { buildLegecloFixture } from './make-legeclo-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const rejects = (fn) => { try { fn(); return null } catch (error) { return error } }
// 可复现的伪随机（mulberry32）
const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

const work = await mkdtemp(path.join(os.tmpdir(), 'gal-voice-'))
const dataDir = path.join(work, 'data')

// ================= 正则：安全检查 =================
{
  check('空 = 没有过滤；合法的编译成不分大小写的 RegExp', compileVoiceRegex('') === null && compileVoiceRegex('  ') === null && compileVoiceRegex('A_\\d+').test('xa_12'))
  const bad = rejects(() => compileVoiceRegex('(unclosed'))
  check('编译不过：400 + invalid-regex + 说明里有原因', bad?.statusCode === 400 && bad.code === 'invalid-regex' && /白名单|正则/.test(bad.message) && /Unterminated|group|parenthes/i.test(bad.message), bad?.message)
  const long = rejects(() => compileVoiceRegex('a'.repeat(MAX_REGEX_LENGTH + 1), '黑名单'))
  check(`太长（> ${MAX_REGEX_LENGTH}）：拒绝，说明带标签；刚好 ${MAX_REGEX_LENGTH} 通过`, long?.code === 'invalid-regex' && /黑名单太长/.test(long.message) && compileVoiceRegex('a'.repeat(MAX_REGEX_LENGTH)) instanceof RegExp, long?.message)
  const nested = ['(a+)+', '(a+)+$', '(\\w*)*', '(a|b+)*', '((a+)b)+', '(a{1,9}){1,9}', '(a*){2,}', '(?:x+)*y', '([a-z]+)+', '(a+?)+']
  check('量词套量词一律拒绝（(a+)+ / (\\w*)* / (a{1,9}){1,9} / 非捕获 / 惰性 / 多层）', nested.every((p) => hasNestedQuantifier(p) && rejects(() => compileVoiceRegex(p))?.code === 'invalid-regex'), J(nested.filter((p) => !hasNestedQuantifier(p))))
  const fine = ['voice_\\d+', '(ab)+', '(a|b)+', '(abc)?x+', 'a+b+', '[(]a+[)]+', '\\(a+\\)+', '(a{2})+', '(a+)?', '^(?:foo|bar)_\\d{2,3}$', '(x)(y+)']
  check('正常写法不误杀（(ab)+ / (a|b)+ / 字符类和转义里的括号 / (a+)? / {2}）', fine.every((p) => !hasNestedQuantifier(p) && compileVoiceRegex(p) instanceof RegExp), J(fine.filter((p) => hasNestedQuantifier(p))))
  check('反向引用拒绝（\\1 / \\k<n>）', rejects(() => compileVoiceRegex('(a)\\1'))?.code === 'invalid-regex' && rejects(() => compileVoiceRegex('(?<n>a)\\k<n>'))?.code === 'invalid-regex')
  const started = Date.now()
  const attack = rejects(() => compileVoiceRegex('(a+)+$'))
  check('灾难性回溯的经典写法在编译阶段就被拒、没有真的去匹配（耗时 < 50ms）', attack && Date.now() - started < 50)
  check('target：默认 path；可逗号连写；未知值 / 空组拒绝', J(parseVoiceTargets('')) === J(['path']) && J(parseVoiceTargets('speaker,text')) === J(['speaker', 'text']) && rejects(() => parseVoiceTargets('file'))?.code === 'invalid-target' && rejects(() => parseVoiceTargets('path,path,path,path'))?.code === 'invalid-target')
  const long300 = filterVoices([{ src: `${'x'.repeat(400)}tail`, speaker: '', text: '' }], { include: /tail$/i, targets: ['path'] })
  check('匹配的输入截到 300 字符（结尾在 300 之外的匹配不上）', long300.length === 0)
}

// ================= 过滤 / 收集（合成场景）=================
const scene = {
  steps: [
    { index: 0, commands: [{ op: 'speaker', segments: [{ text: 'Alice' }] }, { op: 'voice', src: 'voice/a/001.ogg' }, { op: 'text', segments: [{ text: 'Hello' }, { text: ' world' }] }] },
    { index: 1, commands: [{ op: 'text', segments: [{ text: 'No voice here' }] }, { op: 'se', src: 'se/x.ogg' }] },
    { index: 2, commands: [{ op: 'voice', src: 'voice/a/001.ogg' }, { op: 'voice', src: 'voice/b/002.ogg' }, { op: 'bgvoice', slot: 1, src: 'voice/bg/loop.ogg', volume: 1 }, { op: 'speaker', segments: [{ text: 'Bob' }] }, { op: 'text', segments: [{ text: 'Second' }] }] },
    { index: 3, commands: [{ op: 'voice', src: 'voice/c/003.ogg' }, { op: 'text', segments: [{ text: 'x'.repeat(200) }] }] },
  ],
}
{
  const v = collectVoices(scene)
  check('收集：只收 voice（默认不含 bgvoice）；同一个 src 去重留第一次；带 step / 说话人（往后带）/ 台词（第一句有字的）', J(v.map((x) => [x.src, x.step, x.speaker])) === J([['voice/a/001.ogg', 0, 'Alice'], ['voice/b/002.ogg', 2, 'Bob'], ['voice/c/003.ogg', 3, 'Bob']]) && v[0].text === 'Hello world', J(v))
  check('台词摘要截到 80 字 + …', v[2].text.length === 81 && v[2].text.endsWith('…'))
  check('bgvoice 要 withBg 才收（kind = bgvoice）', collectVoices(scene, { withBg: true }).filter((x) => x.kind === 'bgvoice').length === 1 && v.every((x) => x.kind === 'voice'))
  check('没有语音 / 空场景 = 空表', collectVoices({ steps: [] }).length === 0 && collectVoices(null).length === 0)
  const f = (opts) => filterVoices(v, { targets: ['path'], ...opts }).map((x) => x.src)
  check('白名单：只留路径匹配的（不分大小写）', J(f({ include: compileVoiceRegex('VOICE/[ab]/') })) === J(['voice/a/001.ogg', 'voice/b/002.ogg']))
  check('黑名单：去掉匹配的；两个都给时先白后黑', J(f({ exclude: compileVoiceRegex('/b/') })) === J(['voice/a/001.ogg', 'voice/c/003.ogg']) && J(f({ include: compileVoiceRegex('voice'), exclude: compileVoiceRegex('00[12]') })) === J(['voice/c/003.ogg']))
  check('全被过滤 = 空表', f({ include: compileVoiceRegex('nothing') }).length === 0 && f({ exclude: compileVoiceRegex('.') }).length === 0)
  check('target = speaker / text / 连写：匹配的是说话人 / 台词', J(f({ include: compileVoiceRegex('^bob$'), targets: ['speaker'] })) === J(['voice/b/002.ogg', 'voice/c/003.ogg']) && J(f({ include: compileVoiceRegex('hello'), targets: ['text'] })) === J(['voice/a/001.ogg']) && f({ include: compileVoiceRegex('alice|003'), targets: ['speaker', 'path'] }).length === 2)
}

// ================= LRU 缓存 =================
{
  voiceCacheClear()
  for (let i = 0; i < VOICE_CACHE_MAX + 50; i += 1) voiceCacheSet(`k${i}`, { i })
  check(`LRU 有上限（${VOICE_CACHE_MAX}），先淘汰最久没用的`, voiceCacheSize() === VOICE_CACHE_MAX && !voiceCacheGet('k0') && voiceCacheGet('k60')?.i === 60)
  voiceCacheSet('k60b', { i: 0 })
  voiceCacheGet('k51')   // 刚用过的不先被淘汰
  for (let i = 0; i < 10; i += 1) voiceCacheSet(`n${i}`, {})
  check('命中会刷新最近使用', voiceCacheGet('k51') !== undefined)
  check('按前缀清缓存（刷新索引用）', voiceCacheClear('n') === 10 && voiceCacheClear() > 0 && voiceCacheSize() === 0)
}

// ================= 各适配器的真 fixture：随机语音覆盖全部语音，并和播放页读到的场景一致 =================
const mkHandler = () => createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
const handler = mkHandler()
async function setup(dir, adapters, gameId) {
  const imp = await handler.importFromSource({ sourcePath: dir, options: { adapters, config: { game: { id: gameId, title: gameId } }, defaultMetadataActions: ['gal-layout'] } })
  const item = imp.items[0]
  const out = await galLayoutScript({ item, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
  await handler.patchItemMetadata(item.itemId, { gal: out.itemPatch.gal })
  return item.itemId
}
// 播放页路径读出来的全部语音（真值）：从首页递归走所有节点，读每个脚本的场景，收 voice 指令
async function groundTruth(itemId) {
  const voices = new Set()
  let scripts = 0
  const seen = new Set()
  const visit = async (nodeId) => {
    if (seen.has(nodeId)) return
    seen.add(nodeId)
    const { node, scene } = await handler.getReaderContent(itemId, 'main', { sectionId: nodeId })
    if (node.kind === 'player') {
      scripts += 1
      for (const step of scene.steps) for (const c of step.commands) if (c.op === 'voice') voices.add(c.src)
      return
    }
    for (let page = 1; page <= node.pageCount; page += 1) {
      const pageNode = page === 1 ? node : (await handler.getReaderContent(itemId, 'main', { sectionId: `${node.viewBase}#${page}` })).node
      for (const item of pageNode.items) await visit(item.node)
    }
  }
  await visit('')
  return { voices, scripts }
}
async function coverage(name, itemId, expectAtLeast, extra = () => true) {
  const truth = await groundTruth(itemId)
  const rand = seeded(7)
  const got = new Map()
  let bad = ''
  for (let i = 0; i < 150; i += 1) {
    const r = await handler.getRandomVoice(itemId, { node: '', tries: 30, rand })
    if (!r.ok) { bad = J(r); break }
    got.set(r.resource, r)
  }
  const missing = [...truth.voices].filter((v) => !got.has(v))
  const stray = [...got.keys()].filter((v) => !truth.voices.has(v))
  check(`${name}：播放页场景里共 ${truth.voices.size} 条语音（${truth.scripts} 个脚本），随机语音能取到每一条、没有多的`, truth.voices.size >= expectAtLeast && !bad && !missing.length && !stray.length, J({ bad, missing, stray, size: truth.voices.size }))
  const sample = [...got.values()][0]
  const base = `/api/library/items/gal/${itemId}/resource`
  check(`${name}：结果带可播的资源地址（${base}?path=…）、脚本节点 id、step`, sample?.src === `${base}?path=${encodeURIComponent(sample.resource)}` && /^s:/.test(sample.scriptId) && Number.isInteger(sample.step) && sample.total >= 1 && sample.index >= 1 && sample.ms >= 0, J(sample))
  check(`${name}：额外断言`, extra(got), J([...got.values()].slice(0, 3)))
  return { truth, got }
}

{
  const lg = path.join(work, 'legeclo')
  await buildLegecloFixture(lg)
  const id = await setup(lg, ['renpy-legeclo'], 'legeclo')
  await coverage('legeclo（play voice）', id, 1, (got) => [...got.values()].some((r) => r.speaker === 'Hero' && r.text))
}
{
  const gc = path.join(work, 'girlscreation')
  await buildGirlsCreationFixture(gc)
  const id = await setup(gc, ['girlscreation-tag'], 'girlscreation')
  await coverage('girlscreation（voice 标签）', id, 1)
}
{
  const kh = path.join(work, 'kamihime')
  await buildKamihimeFixture(kh)
  const id = await setup(kh, ['tyrano-ks'], 'kamihime')
  await coverage('kamihime（资源目录里的 playse 当语音）', id, 1)
}
{
  const gz = path.join(work, 'grenze')
  await buildGrenzeFixture(gz)
  const id = await setup(gz, ['grenze-xml'], 'grenze')
  await coverage('grenze（voice_pack + voice；场景路径 <文件>::<起点>）', id, 1, (g) => [...g.values()].every((r) => r.scriptId.includes('::')))
}
{
  // 大文件（几万行 / 几 MB 的单个 xml，里面几百个场景）：随机语音走 <文件>::<起点> 路径，冷 = 读 + 解析整个文件一次，热 = 缓存
  const gz = path.join(work, 'grenze-big')
  await buildGrenzeFixture(gz)
  const rows = []
  const ROWS = 60000
  for (let i = 0; i < ROWS; i += 1) {
    const last = i % 100 === 99 || i === ROWS - 1
    const attrs = [`id="${5000000 + i}"`, ...(last ? [] : [`next_id="${5000001 + i}"`]), `name="Name"`, `text="Line ${i}. ${'x'.repeat(40 + (i % 50))}"`, ...(i % 10 === 0 ? ['voice_pack="Main11"', 'voice="MainVoice_00_01_001"'] : []), ...(i % 5 < 3 ? ['hero_group_id="101011"', 'pic_pos="2"', `pic_face="${1 + (i % 6)}"`] : [])]
    rows.push(`  <easy_dialog-99 ${attrs.join(' ')}/>`)
  }
  await writeFile(path.join(gz, 'TextAsset', 'easy_dialog-99.xml'), `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<easy_dialog-99_list>\n${rows.join('\n')}\n</easy_dialog-99_list>\n`)
  const id = await setup(gz, ['grenze-xml'], 'grenze')
  const home = (await handler.getReaderContent(id, 'main', { sectionId: '' })).node
  const dir99 = (await handler.getReaderContent(id, 'main', { sectionId: home.items.find((i) => i.title === 'easy_dialog-99').node })).node
  const scene = dir99.items[7]
  const size = (await import('node:fs')).statSync(path.join(gz, 'TextAsset', 'easy_dialog-99.xml')).size
  const parses = voiceStats.parses
  const cold = await handler.getRandomVoice(id, { node: scene.node, rand: seeded(1) })
  const warm = await handler.getRandomVoice(id, { node: scene.node, rand: seeded(2) })
  console.log(`INFO 大文件 ${(size / 1048576).toFixed(1)}MB / ${dir99.total} 个场景：冷 ${cold.ms}ms、热 ${warm.ms}ms（${cold.total} 条语音）`)
  check('大文件里的场景（<文件>::<起点>，超过普通脚本 4MB 上限也行）：取得到语音、属于这个场景（同名语音去重后 1 条）；冷解析 1 次、热命中缓存', cold.ok && cold.total === 1 && cold.scriptId.includes('easy_dialog-99.xml::') && cold.cached === false && warm.cached === true && voiceStats.parses === parses + 1, J([cold, warm]))
  // 不同场景是不同的缓存项（键里有场景号）
  const other = await handler.getRandomVoice(id, { node: dir99.items[8].node })
  check('同一个大文件里的另一个场景是另一个缓存项：重新解析，语音属于它自己', other.ok && other.cached === false && other.scriptId !== cold.scriptId && other.step < 100, J(other))
  // 目录节点（一个文件的几百个场景）：只试 tries 个场景，所以最坏 8 次解析
  const t0 = Date.now()
  const viaDir = await handler.getRandomVoice(id, { node: home.items.find((i) => i.title === 'easy_dialog-99').node, rand: seeded(3) })
  console.log(`INFO 目录节点（${dir99.total} 个场景）：${Date.now() - t0}ms，试了 ${viaDir.tried} 个、候选 ${viaDir.scripts} 个`)
  check('目录节点（600 个场景）：候选脚本数封顶 500；只试 tried 个就拿到语音', viaDir.ok && viaDir.scripts === 500 && viaDir.tried <= 8, J(viaDir))
}
{
  // artwhirl：并行数组 JSON，语音按文件名在索引里找
  const root = path.join(work, 'artwhirl')
  const game = path.join(root, 'game')
  const rels = ['audio/voice/g1/ABC_01.ogg', 'audio/voice/g2/ABC_02.ogg', 'audio/bgm/theme.ogg']
  for (const rel of rels) { await mkdir(path.dirname(path.join(game, rel)), { recursive: true }); await writeFile(path.join(game, rel), 'x') }
  const story = (voices) => JSON.stringify({ bgms: [null, null], bgs: [null, null], voices, texts: ['{n1}你好', '再见'], names: [null, null], colors: [null, null], charas: [null, null], others: [[], []], effects: [null, null], waits: [null, null], chara_keys: ['ABC'], dic: [null] })
  await mkdir(path.join(game, 'episode_scripts'), { recursive: true })
  await writeFile(path.join(game, 'episode_scripts', 'ep1.json'), story(['ABC_01.mp3', 'ABC_02.mp3']))
  await writeFile(path.join(game, 'episode_scripts', 'ep2.json'), story([null, null]))
  const config = { scriptRoots: [{ id: 'e', dir: 'game/episode_scripts' }], resourceRoots: ['game'], scriptExtensions: ['json'], merge: [], groups: [], dirThumbs: [], scriptThumbs: [] }
  const provider = createBrowseProvider({ mediaDir: root, adapters: ['artwhirl-json'], config, resolveAsset: async (rel) => { if (!existsSync(path.join(game, rel))) throw new Error('none'); return path.join(game, rel) } })
  const seen = new Set()
  for (let i = 0; i < 20; i += 1) { const r = await provider.randomVoice({ node: 's:ep1.json', resourceBase: '/r', rand: seeded(i + 1) }); if (r.ok) seen.add(r.resource) }
  check('artwhirl：语音 mp3 → ogg、按文件名在整个索引里找（别的组的目录也行）：两条都能取到', J([...seen].sort()) === J(['audio/voice/g1/ABC_01.ogg', 'audio/voice/g2/ABC_02.ogg']), J([...seen]))
  const none = await provider.randomVoice({ node: 's:ep2.json', resourceBase: '/r' })
  check('脚本没有语音：404 no-voice + 原因', none.ok === false && none.status === 404 && none.error === 'no-voice' && /没有语音/.test(none.reason), J(none))
  const filtered = await provider.randomVoice({ node: 's:ep1.json', include: 'nomatch', resourceBase: '/r' })
  check('有语音但都被白名单滤掉：404 all-filtered（和 no-voice 分开）', filtered.ok === false && filtered.error === 'all-filtered' && /过滤/.test(filtered.reason), J(filtered))
  const excl = await provider.randomVoice({ node: 's:ep1.json', exclude: 'ABC', resourceBase: '/r' })
  check('黑名单滤光：all-filtered', excl.error === 'all-filtered', J(excl))
  const badRe = await provider.randomVoice({ node: 's:ep1.json', include: '(a+)+', resourceBase: '/r' }).then(() => null, (e) => e)
  check('危险 / 非法正则：抛 400 invalid-regex（不会去匹配）', badRe?.code === 'invalid-regex' && badRe.statusCode === 400, badRe?.message)
  const badTarget = await provider.randomVoice({ node: 's:ep1.json', target: 'nope', resourceBase: '/r' }).then(() => null, (e) => e)
  check('非法 target：400 invalid-target', badTarget?.code === 'invalid-target')
  // 语音文件在索引里但磁盘上已经没了：不放不存在的，全都缺时报 no-voice（缺几个）
  const stubborn = createBrowseProvider({ mediaDir: root, adapters: ['artwhirl-json'], config, resolveAsset: async (rel) => { if (/ABC_0/.test(rel)) throw new Error('none'); return path.join(game, rel) } })
  const lost = await stubborn.randomVoice({ node: 's:ep1.json', resourceBase: '/r' })
  check('语音文件找不到（resolveAsset 抛错）：丢掉再取，全缺时 no-voice 并说明缺几个，不把不存在的地址交给前端', lost.ok === false && lost.error === 'no-voice' && /找不到/.test(lost.reason), J(lost))
}

// ================= 缓存 / 目录节点（自己造一棵 UViewer 目录：一个有语音的脚本混在一堆没语音的里）=================
{
  const media = path.join(work, 'uv')
  const textDir = path.join(media, 'resources/download/adv/text')
  const res = (rel) => path.join(media, 'resources', rel)
  const script = (voices) => ['bg,download/bg/a.jpg,0', 'name,甲', 'msg,0,台词一', ...voices.map((v) => `playvoice,0,${v}`), 'clickwait', 'name,乙', 'msg,0,台词二', 'clickwait'].join('\n')
  await mkdir(path.join(textDir, 'solo'), { recursive: true })
  await mkdir(path.join(textDir, 'many'), { recursive: true })
  await mkdir(path.join(textDir, 'empty'), { recursive: true })
  await mkdir(path.dirname(res('download/voice/x')), { recursive: true })
  for (const f of ['download/voice/ch_a_1.wav', 'download/voice/ch_a_2.wav', 'download/voice/ch_b_1.wav']) await writeFile(res(f), 'x')
  await writeFile(path.join(textDir, 'solo', 'one.txt'), script(['download/voice/ch_a_1.wav', 'download/voice/ch_a_2.wav', 'download/voice/ch_b_1.wav']))
  for (let i = 0; i < 9; i += 1) await writeFile(path.join(textDir, 'many', `m${i}.txt`), script([]))
  await writeFile(path.join(textDir, 'many', 'withvoice.txt'), script(['download/voice/ch_b_1.wav']))
  for (let i = 0; i < 3; i += 1) await writeFile(path.join(textDir, 'empty', `e${i}.txt`), script([]))
  const mk = () => createBrowseProvider({ mediaDir: media, adapters: ['uviewer-csv'], config: {}, resolveAsset: async (rel) => { const p = res(rel); if (!existsSync(p)) throw new Error('none'); return p } })
  const rb = '/api/library/items/gal/X/resource'
  const rv = (provider, params) => provider.randomVoice({ resourceBase: rb, ...params })

  voiceCacheClear()
  const p1 = mk()
  const before = { ...voiceStats }
  const cold = await rv(p1, { node: 's:solo/one.txt', rand: seeded(1) })
  check('脚本节点：冷调用解析 1 次（缓存没命中）；结果在这个脚本的 3 条里、total = 3、说话人 / 台词是语音所在步的', cold.ok && voiceStats.parses === before.parses + 1 && cold.cached === false && cold.total === 3 && cold.scriptId === 's:solo/one.txt' && cold.scriptTitle === 'one' && cold.speaker === '甲' && cold.text === '台词一' && cold.src.startsWith(`${rb}?path=download%2Fvoice%2F`), J(cold))
  const warm = await rv(mk(), { node: 's:solo/one.txt', rand: seeded(2) })
  check('第二次点同一个脚本（新建 provider = 新的请求）：命中缓存、不再解析（parses 计数不变，cached = true）', warm.ok && warm.cached === true && voiceStats.parses === before.parses + 1 && voiceStats.hits > before.hits, J([warm, voiceStats]))
  const seenWarm = new Set()
  for (let i = 0; i < 40; i += 1) seenWarm.add((await rv(mk(), { node: 's:solo/one.txt', rand: seeded(100 + i) })).resource)
  check('随机取遍 3 条（均匀随机，不是总取同一条）；整个过程仍只解析过 1 次', seenWarm.size === 3 && voiceStats.parses === before.parses + 1, J([...seenWarm]))
  // 改文件（mtime/size 变）→ 缓存键变 → 重新解析
  await writeFile(path.join(textDir, 'solo', 'one.txt'), script(['download/voice/ch_a_1.wav']))
  await utimes(path.join(textDir, 'solo', 'one.txt'), new Date(), new Date(Date.now() + 5000))
  const edited = await rv(mk(), { node: 's:solo/one.txt' })
  check('脚本改过（mtime / size 变）：重新解析，total 跟着变', edited.ok && edited.cached === false && edited.total === 1 && edited.resource === 'download/voice/ch_a_1.wav', J(edited))
  const f1 = await rv(mk(), { node: 's:solo/one.txt', include: 'ch_b' })
  check('同一份缓存换过滤条件不用重新解析，直接按新条件筛：白名单 ch_b → 滤光 = all-filtered', f1.error === 'all-filtered')
  // 刷新索引清缓存
  await rv(mk(), { node: 's:solo/one.txt' })
  invalidateBrowseCaches(media)
  const afterInvalidate = await rv(mk(), { node: 's:solo/one.txt' })
  check('刷新索引（invalidateBrowseCaches）会清掉语音缓存', afterInvalidate.cached === false)
  // config 默认过滤：配置里的 voiceExclude 生效、请求里的 include 覆盖
  await writeFile(path.join(textDir, 'solo', 'one.txt'), script(['download/voice/ch_a_1.wav', 'download/voice/ch_b_1.wav']))
  const pc = createBrowseProvider({ mediaDir: media, adapters: ['uviewer-csv'], config: { voiceExclude: 'ch_a' }, resolveAsset: async (rel) => res(rel) })
  const cfgOnly = await rv(pc, { node: 's:solo/one.txt' })
  check('config.voiceExclude 当默认黑名单（只剩 ch_b）；请求里写了 exclude 就用请求的', cfgOnly.total === 1 && cfgOnly.resource.includes('ch_b') && (await rv(pc, { node: 's:solo/one.txt', exclude: 'ch_b' })).resource.includes('ch_a'), J(cfgOnly))
  check('config 里非法 / 危险的 voiceInclude 被规整掉（置空）', normalizeGalConfig({ voiceInclude: '(a+)+', voiceExclude: '(' }).voiceInclude === '' && normalizeGalConfig({ voiceInclude: '(a+)+', voiceExclude: '(' }).voiceExclude === '' && normalizeGalConfig({ voiceInclude: 'ch_a' }).voiceInclude === 'ch_a')

  // 目录节点：多个脚本里只有一个有语音，试够次数就能找到；tried / scripts 如实报告
  const dirAll = await rv(mk(), { node: 'd:many', tries: 30, rand: seeded(5) })
  check('目录节点：10 个脚本里只有 1 个有语音，tries=30 全试一遍必能找到它；报告 scripts = 10、tried ≥ 1', dirAll.ok && dirAll.scriptId === 's:many/withvoice.txt' && dirAll.scripts === 10 && dirAll.tried >= 1 && dirAll.tried <= 10, J(dirAll))
  let triedMore = 0
  for (let i = 0; i < 20; i += 1) { const r = await rv(mk(), { node: 'd:many', tries: 30, rand: seeded(i + 11) }); if (r.tried > 1) triedMore += 1 }
  check('目录节点会连试多个脚本（跳过没有语音的）', triedMore > 10, String(triedMore))
  const one = await rv(mk(), { node: 'd:many', tries: 1, rand: seeded(1) })
  check('tries = 1 只试 1 个脚本，没命中就如实报 no-voice（带 tried = 1 和「再点一次」的提示）', (one.ok && one.tried === 1) || (one.error === 'no-voice' && one.tried === 1 && /再点一次/.test(one.reason)), J(one))
  const capped = await rv(mk(), { node: 'd:many', tries: 99999, rand: seeded(1) })
  check('tries 有上限（30）', capped.tried <= 30)
  const none = await rv(mk(), { node: 'd:empty', tries: 30 })
  check('目录里没有任何语音：404 no-voice，tried = 3（全试过）', none.ok === false && none.status === 404 && none.error === 'no-voice' && none.tried === 3 && none.scripts === 3, J(none))
  const filt = await rv(mk(), { node: 'd:many', include: 'zzz', tries: 30 })
  check('目录里有语音但都被过滤：all-filtered', filt.error === 'all-filtered', J(filt))
  const home = await rv(mk(), { node: '', tries: 30, rand: seeded(9) })
  const seenHome = new Set()
  for (let i = 0; i < 60; i += 1) { const r = await rv(mk(), { node: '', tries: 30, rand: seeded(i + 50) }); if (r.ok) seenHome.add(r.scriptId) }
  check('整个列表（首页节点）：往子目录展开，能取到不同目录里的脚本', home.ok && seenHome.has('s:many/withvoice.txt') && seenHome.has('s:solo/one.txt'), J([...seenHome]))
  const q = await rv(mk(), { node: '|q=many', tries: 30, rand: seeded(4) })
  check('当前列表带筛选词（|q=many）：只在筛出来的目录里取', q.ok && q.scriptId === 's:many/withvoice.txt', J(q))
  const bare = await rv(mk(), { node: 'solo/one.txt' })
  check('node 也可以直接写脚本路径', bare.ok && bare.scriptId === 's:solo/one.txt')
  const gone = await rv(mk(), { node: 's:solo/nope.txt' }).then(() => null, (e) => e)
  check('脚本不存在：404；路径穿越：400', gone?.statusCode === 404 && (await rv(mk(), { node: 's:../x.txt' }).then(() => null, (e) => e))?.statusCode === 400)
  const none2 = await rv(mk(), { node: 's:empty/e0.txt' })
  check('单个没语音的脚本：no-voice（tried = 1）', none2.error === 'no-voice' && none2.tried === 1)
  // bgvoice 开关
  const bg = { steps: [{ index: 0, commands: [{ op: 'bgvoice', slot: 1, src: 'download/voice/ch_a_1.wav', volume: 1 }] }] }
  check('bgvoice 默认不当候选、withBg 才算', collectVoices(bg).length === 0 && collectVoices(bg, { withBg: true }).length === 1)
}

await rm(work, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
