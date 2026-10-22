#!/usr/bin/env node
// 朗读规则（flag + 每个 flag 自己的 TTS 参数）自测：
//   1) 规则解析 / 清理 / 参数回落 / 缓存键（不需要服务）
//   2) 真实服务 + 模拟的 GSV-TTS-Lite（/tts/batched、/audio）：按 flag 取参数、混合 flag 按参数分批、缓存键、预生成脚本
//   node scripts/dev/epub-tts-rules-selftest.mjs        需要 python3（打 EPUB 的 zip）
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import http from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { annotateEpubSentences } from '../../web/library/epub-tts-sentences.mjs'
import { cleanTtsRules, parseTtsRules, ttsParamsFor, ttsVoiceKey } from '../../web/library/epub-tts-flags.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))   // 键顺序无关的比较
const sha1 = (v) => createHash('sha1').update(v).digest('hex')

// ================= 1) 纯逻辑 =================
const DEFAULTS = { speakerAudio: 'S.wav', promptAudio: 'P.wav', promptText: 'T', textLanguage: '', promptLanguage: 'zh' }
{
  const rules = [
    { match: 'p[style*="opacity"]', flag: 'ja', text_language: 'ja', prompt_audio: '/refs/ja.wav', prompt_text: 'あ' },
    { match: '*', flag: 'zh', text_language: 'zh' },
  ]
  const p = parseTtsRules(rules)
  check('解析：2 条有效（选择器 1 条 + 兜底 1 条），没有错误', p.rules.length === 1 && p.fallback?.flag === 'zh' && p.errors.length === 0 && !p.empty, J([p.rules.length, p.fallback, p.errors]))
  const ja = ttsParamsFor(DEFAULTS, p, 'ja')
  check('参数回落：写了 prompt_audio/prompt_text → 参考音频三件套整组取规则里的（speaker_audio 没写 = 空，不混用默认的 S.wav）', ja.speakerAudio === '' && ja.promptAudio === '/refs/ja.wav' && ja.promptText === 'あ', J(ja))
  check('参数回落：text_language 用规则的；prompt_language 没写 → 落回默认', ja.textLanguage === 'ja' && ja.promptLanguage === 'zh')
  const zh = ttsParamsFor(DEFAULTS, p, 'zh')
  check('只写了语言的规则：三件套全用默认；text_language 用规则的', zh.speakerAudio === 'S.wav' && zh.promptAudio === 'P.wav' && zh.promptText === 'T' && zh.textLanguage === 'zh' && zh.promptLanguage === 'zh', J(zh))
  check('没有规则的 flag / 空 flag / 不认识的 flag：全用默认', J(ttsParamsFor(DEFAULTS, p, 'xx')) === J(DEFAULTS) && J(ttsParamsFor(DEFAULTS, p, '')) === J(DEFAULTS) && J(ttsParamsFor(DEFAULTS, null, 'ja')) === J(DEFAULTS))
  const only = parseTtsRules([{ match: '@kana', flag: 'ja', speaker_audio: 'only-speaker.wav' }])
  const o = ttsParamsFor(DEFAULTS, only, 'ja')
  check('只写 speaker_audio 也算「写了三件套」：prompt_audio/prompt_text 留空（不拿默认的混进去）', o.speakerAudio === 'only-speaker.wav' && o.promptAudio === '' && o.promptText === '', J(o))
  const dup = parseTtsRules([{ match: 'a', flag: 'ja', prompt_audio: 'first.wav' }, { match: 'b', flag: 'ja', prompt_audio: 'second.wav' }])
  check('同一个 flag 多条规则：参数取第一条（不检查冲突）', ttsParamsFor(DEFAULTS, dup, 'ja').promptAudio === 'first.wav' && dup.errors.length === 0)
  check('flag 只出现在后面的 `*` 兜底规则上也能带参数', ttsParamsFor(DEFAULTS, parseTtsRules([{ match: 'a', flag: 'ja' }, { match: '*', flag: 'zh', prompt_audio: 'zh.wav' }]), 'zh').promptAudio === 'zh.wav')
}
{
  const bad = parseTtsRules([{ match: 'p', flag: 'ja' }, 'x', { flag: 'y' }, { match: 'p', flag: 'bad flag!' }, { match: 'p', flag: 'a', text_language: 'fr' }, { match: 'p', flag: 'b', prompt_audio: 5 }, { match: 'bad[', flag: 'c' }, { match: 'p', flag: 'ok', text_language: 'AUTO' }])
  check('解析错误按第几条报，非法的忽略、其余照常', J(bad.errors.map((e) => e.index)) === J([2, 3, 4, 5, 6, 7]) && bad.rules.length === 2, J(bad.errors))
  check('不是数组：报错', parseTtsRules({}).errors[0]?.error.includes('JSON 数组') && parseTtsRules(undefined).errors.length === 0)
  const cleaned = cleanTtsRules([{ match: ' p ', flag: ' ja ', text_language: 'JA', prompt_audio: ' /a.wav ', prompt_text: '  文字稿 ', extra: 'drop', speaker_audio: '' }, { match: 'x' }, null, { match: 'p', flag: 'zz', text_language: 'auto' }])
  check('清理（存进配置用）：只留合法字段、语言规整成小写、auto 去掉、多余字段丢、非法规则丢', canon(cleaned) === canon([{ match: 'p', flag: 'ja', text_language: 'ja', prompt_audio: '/a.wav', prompt_text: '  文字稿 ' }, { match: 'p', flag: 'zz' }]), J(cleaned))
  check('最多 50 条', cleanTtsRules(Array.from({ length: 80 }, (_, i) => ({ match: 'p', flag: `f${i}` }))).length === 50)
  check('参数太长 → 这条规则非法', parseTtsRules([{ match: 'p', flag: 'a', prompt_text: 'x'.repeat(2001) }]).errors.length === 1)
}
{
  check('缓存键：只有参考音频时和以前的公式完全一样（已有缓存继续命中）', ttsVoiceKey({ speakerAudio: 'S', promptAudio: 'P', promptText: '', textLanguage: '', promptLanguage: '' }) === 'S\nP')
  check('缓存键：加了语言时和以前一样的追加串', ttsVoiceKey({ speakerAudio: 'S', promptAudio: 'P', promptText: '', textLanguage: 'ja', promptLanguage: 'zh' }) === 'S\nP\nja|zh')
  const a = ttsVoiceKey({ ...DEFAULTS }), b = ttsVoiceKey({ ...DEFAULTS, promptText: 'U' }), c = ttsVoiceKey({ ...DEFAULTS, textLanguage: 'ja' })
  check('缓存键：参考文字稿、语言变了键就变（以前文字稿不进键，同一参考音频换文字稿会误命中旧缓存）', new Set([a, b, c]).size === 3)
}
{
  const html = '<p style="opacity:0.5">これは日本語。</p><p>这是中文。</p><p>第二句中文。</p><p style="opacity:0.5">二つ目。</p><p><span style="opacity:0.5">混在</span>的行</p>'
  const rules = parseTtsRules([{ match: '[style*="opacity"]', flag: 'ja' }, { match: '*', flag: 'zh' }])
  const { sentences } = annotateEpubSentences(html, { flagRules: rules })
  check('打 flag：淡色 p → ja，其余 → zh（兜底在有别的规则命中时生效）；一个句子一个 flag（混排的行在 flag 变处断句）', J(sentences.map((s) => [s.text, s.flag])) === J([['これは日本語。', 'ja'], ['这是中文。', 'zh'], ['第二句中文。', 'zh'], ['二つ目。', 'ja'], ['混在', 'ja'], ['的行', 'zh']]), J(sentences.map((s) => [s.text, s.flag])))
  const plain = annotateEpubSentences('<p>普通的书。</p><p>没有淡色。</p>', { flagRules: rules })
  check('普通的书（没有任何非兜底规则命中）：兜底不生效，没有 flag', plain.sentences.every((s) => s.flag === ''))
  const kana = annotateEpubSentences('<p>これは日本語。</p><p>中文。</p>', { flagRules: parseTtsRules([{ match: '@kana', flag: 'ja' }, { match: '*', flag: 'zh' }]) })
  check('@kana：段落里有假名就是 ja', J(kana.sentences.map((s) => s.flag)) === J(['ja', 'zh']))
  check('没有规则：全部没有 flag（和以前一样）', annotateEpubSentences(html, { flagRules: parseTtsRules([]) }).sentences.every((s) => s.flag === ''))
}

// ================= 2) 真实服务 + 模拟 GSV =================
const WAV = (() => {   // 0.1 秒静音 wav
  const samples = 2205
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(22050, 24); buf.writeUInt32LE(44100, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40)
  return buf
})()
const gsvCalls = []
let gsvFailText = ''
let fileCounter = 0
const gsv = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (req.method === 'POST' && req.url === '/tts/batched') {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    gsvCalls.push(body)
    if (gsvFailText && body.texts.some((t) => t.includes(gsvFailText))) { res.writeHead(500); res.end('bad content'); return }
    const names = body.texts.map(() => `f${++fileCounter}.wav`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ success: true, filenames: names, subtitles: body.texts.map((t) => [{ text: t, start: 0, end: 0.1 }]) }))
    return
  }
  if (req.method === 'GET' && req.url.startsWith('/audio/')) { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(WAV); return }
  res.writeHead(404); res.end()
})
await new Promise((r) => gsv.listen(8196, '127.0.0.1', r))

const work = await mkdtemp(path.join(os.tmpdir(), 'epub-tts-rules-'))
const dataDir = path.join(work, 'data')
await mkdir(dataDir, { recursive: true })
const port = 8105
const base = `http://127.0.0.1:${port}`
try { await fetch(`${base}/health`); console.error(`端口 ${port} 已被占用`); process.exit(2) } catch {}
const server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
for (let i = 0; i < 100; i++) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
const api = async (p, init = {}) => {
  const res = await fetch(base + p, init)
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: text } }
}
const postJson = (p, v) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })
const RULES = [
  { match: 'p[style*="opacity"]', flag: 'ja', text_language: 'ja', prompt_audio: '/refs/ja.wav', prompt_text: 'あ' },
  { match: '*', flag: 'zh', text_language: 'zh' },
]
const baseConfig = { epubTtsApiBase: 'http://127.0.0.1:8196', epubTtsSpeakerAudio: 'S.wav', epubTtsPromptAudio: 'P.wav', epubTtsPromptText: 'T', epubTtsTextLanguage: '', epubTtsPromptLanguage: 'zh', epubTtsRules: RULES, epubTtsBatchMaxSentences: 5, epubTtsBatchMaxChars: 400 }
const setConfig = (patch = {}) => postJson('/api/config', { ...baseConfig, ...patch })
await setConfig()

// 造一本中日对照的 EPUB
const epubDir = path.join(work, 'epub')
await mkdir(path.join(epubDir, 'META-INF'), { recursive: true })
await mkdir(path.join(epubDir, 'OEBPS'), { recursive: true })
await writeFile(path.join(epubDir, 'mimetype'), 'application/epub+zip')
await writeFile(path.join(epubDir, 'META-INF/container.xml'), '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
await writeFile(path.join(epubDir, 'OEBPS/content.opf'), '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">tts-rules-test</dc:identifier><dc:title>对照本</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>')
await writeFile(path.join(epubDir, 'OEBPS/nav.xhtml'), '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章</a></li></ol></nav></body></html>')
const JA1 = 'これは日本語の文です。', ZH1 = '这是中文的句子。', ZH2 = '第二句中文内容。', JA2 = '二つ目の文です。'
await writeFile(path.join(epubDir, 'OEBPS/c1.xhtml'), `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><h1>第一章</h1><p style="opacity:0.5">${JA1}</p><p>${ZH1}</p><p>${ZH2}</p><p style="opacity:0.5">${JA2}</p></body></html>`)
execFileSync('python3', ['-I', '-c', 'import sys,zipfile,os\nsrc,out=sys.argv[1],sys.argv[2]\nz=zipfile.ZipFile(out,"w")\nz.write(os.path.join(src,"mimetype"),"mimetype",zipfile.ZIP_STORED)\nfor d,_,fs in os.walk(src):\n  for f in fs:\n    p=os.path.join(d,f); r=os.path.relpath(p,src)\n    if r!="mimetype": z.write(p,r,zipfile.ZIP_DEFLATED)\nz.close()', epubDir, path.join(work, 'book.epub')])
const form = new FormData()
form.set('file', new Blob([await readFile(path.join(work, 'book.epub'))]), '对照本.epub')
const imported = await api('/api/library/items?type=epub', { method: 'POST', body: form })
const item = imported.body
check('造数据：EPUB 导入成功', imported.status < 300 && item.itemId, J(imported).slice(0, 200))
const ITEM = item.itemId
const unitId = item.mediaUnits[0].unitId
const chunk = (texts, flags) => postJson(`/api/epub/${ITEM}/tts-chunk`, flags === undefined ? { texts } : { texts, flags })

// 阅读器返回的句子带 flag
{
  const reader = (await api(`/api/library/items/epub/${ITEM}/reader/${encodeURIComponent(unitId)}`)).body
  const flags = Object.fromEntries((reader.sentences || []).map((s) => [s.text, s.flag]))
  check('阅读器接口：句子带上规则打的 flag（淡色 → ja，其余 → zh；标题也是 zh 兜底）', flags[JA1] === 'ja' && flags[JA2] === 'ja' && flags[ZH1] === 'zh' && flags[ZH2] === 'zh', J(flags))
  check('HTML 里每个句子 span 带 data-tts-flag', /data-tts-flag="ja"/.test(reader.content) && /data-tts-flag="zh"/.test(reader.content))
}

// 混合 flag：按参数分批，每批用各自的参数
{
  gsvCalls.length = 0
  const r = await chunk([JA1, ZH1, JA2, ZH2], ['ja', 'zh', 'ja', 'zh'])
  const chunks = r.body.chunks
  check('混合 flag 的一次请求：返回 4 句，顺序和输入一一对应（序号不乱）', r.status === 200 && chunks.length === 4 && chunks.every((c, i) => c.index === i && c.url), J(chunks))
  check('按「实际生效的参数」分成 2 批发给 GSV（ja 一批、zh 一批），而不是混成一批', gsvCalls.length === 2, J(gsvCalls.map((c) => c.texts)))
  const jaCall = gsvCalls.find((c) => c.texts.includes(JA1)), zhCall = gsvCalls.find((c) => c.texts.includes(ZH1))
  check('ja 这批：只含 ja 的两句；参考音频三件套取规则里的（speaker_audio 不传、prompt_audio=/refs/ja.wav、prompt_text=あ）；text_language=ja；prompt_language 落回默认 zh', J(jaCall.texts) === J([JA1, JA2]) && jaCall.speaker_audio === undefined && jaCall.prompt_audio === '/refs/ja.wav' && jaCall.prompt_text === 'あ' && jaCall.text_language === 'ja' && jaCall.prompt_language === 'zh', J(jaCall))
  check('zh 这批：只含 zh 的两句；三件套用默认（S/P/T）；text_language=zh（规则）；prompt_language=zh（默认）', J(zhCall.texts) === J([ZH1, ZH2]) && zhCall.speaker_audio === 'S.wav' && zhCall.prompt_audio === 'P.wav' && zhCall.prompt_text === 'T' && zhCall.text_language === 'zh' && zhCall.prompt_language === 'zh', J(zhCall))
  check('每句的缓存地址（hash）互不相同', new Set(chunks.map((c) => c.url)).size === 4)
  gsvCalls.length = 0
  const again = await chunk([JA1, ZH1, JA2, ZH2], ['ja', 'zh', 'ja', 'zh'])
  check('再请求一次：全部命中缓存，不再打 GSV；地址不变', gsvCalls.length === 0 && J(again.body.chunks.map((c) => c.url)) === J(chunks.map((c) => c.url)))
  const audio = await fetch(base + chunks[0].url)
  check('缓存的音频能取回（wav）', audio.status === 200 && (await audio.arrayBuffer()).byteLength === WAV.length)
}
// 同一句话在不同 flag（不同音色）下是两份缓存
{
  gsvCalls.length = 0
  const r = await chunk(['同一句话。', '同一句话。'], ['ja', 'zh'])
  check('同一句文字、不同 flag：两个不同的缓存地址，各打一次 GSV（参数各自不同）', r.body.chunks[0].url !== r.body.chunks[1].url && gsvCalls.length === 2 && gsvCalls.some((c) => c.prompt_audio === '/refs/ja.wav') && gsvCalls.some((c) => c.prompt_audio === 'P.wav'), J(gsvCalls))
}
// 没有 flag / 不认识的 flag / flags 比 texts 短：默认
{
  gsvCalls.length = 0
  const r = await chunk(['默认一。', '默认二。', '默认三。'], ['', 'nope'])
  check('没有 flag、不认识的 flag、flags 不够长：全用默认参数，合成一批', r.status === 200 && gsvCalls.length === 1 && gsvCalls[0].texts.length === 3 && gsvCalls[0].prompt_audio === 'P.wav' && gsvCalls[0].text_language === undefined, J(gsvCalls))
  gsvCalls.length = 0
  await chunk(['完全不带 flags。'])
  check('请求体不带 flags 字段（texts only）：用默认', gsvCalls.length === 1 && gsvCalls[0].speaker_audio === 'S.wav')
  const weird = await postJson(`/api/epub/${ITEM}/tts-chunk`, { texts: ['奇怪的 flag。'], flags: [{ a: 1 }] })
  check('flags 里有非字符串：不报错，当默认', weird.status === 200 && weird.body.chunks[0].url)
}
// 默认路径的缓存键没变（没有语言/文字稿时 = 旧公式）
{
  await setConfig({ epubTtsPromptText: '', epubTtsPromptLanguage: '', epubTtsRules: [] })
  const spoken = '旧公式的句子。'
  const r = await chunk([spoken])
  const expected = sha1(`${spoken}\nS.wav\nP.wav`)
  check('默认参数、没有语言和文字稿：缓存键 = sha1(文本\\n音色)，和改造前一模一样', r.body.chunks[0].url.endsWith(`/${expected}.wav`), r.body.chunks[0].url)
  await setConfig()
}
// 改一条规则的参数：只作废这个 flag 的缓存
{
  gsvCalls.length = 0
  await setConfig({ epubTtsRules: [{ ...RULES[0], prompt_audio: '/refs/ja-new.wav' }, RULES[1]] })
  const r = await chunk([JA1, ZH1], ['ja', 'zh'])
  check('改了 ja 的参考音频：ja 重新合成（用新参数），zh 仍命中缓存', gsvCalls.length === 1 && gsvCalls[0].texts[0] === JA1 && gsvCalls[0].prompt_audio === '/refs/ja-new.wav' && r.body.chunks.every((c) => c.url), J(gsvCalls))
  await setConfig()
}
// 同 flag 多条规则：取第一条参数
{
  gsvCalls.length = 0
  await setConfig({ epubTtsRules: [{ match: 'p', flag: 'ja', prompt_audio: '/first.wav' }, { match: 'a', flag: 'ja', prompt_audio: '/second.wav' }] })
  await chunk(['重复 flag 的句子。'], ['ja'])
  check('同一个 flag 写了两条规则：取第一条的参数', gsvCalls.length === 1 && gsvCalls[0].prompt_audio === '/first.wav', J(gsvCalls))
  await setConfig()
}
// GSV 内容错误：只在出错的那一组里逐句重试
{
  gsvCalls.length = 0
  gsvFailText = '坏句子'
  const r = await chunk(['好句子甲。', '坏句子。', 'いい文です。'], ['zh', 'zh', 'ja'])
  gsvFailText = ''
  const calls = gsvCalls.map((c) => c.texts.join('|'))
  check('一批里有内容错误：只在 zh 这一组里逐句重试（ja 那组不受影响）；好句子仍成功，坏句子标 error', r.body.chunks[0].url && r.body.chunks[1].error && r.body.chunks[2].url && calls.includes('好句子甲。|坏句子。') && calls.includes('好句子甲。') && calls.includes('坏句子。') && calls.includes('いい文です。') && !calls.includes('いい文です。|好句子甲。'), J(calls))
}
// 配置接口
{
  await postJson('/api/config', { ...baseConfig, epubTtsRules: [{ match: ' p ', flag: ' ja ', text_language: 'JA', prompt_audio: ' /a.wav ', x: 1 }, { match: 'p' }, { match: 'p', flag: 'z', text_language: 'fr' }, 'junk'] })
  const c = (await api('/api/config')).body
  check('配置保存：规则被清理（空白去掉、语言小写、多余字段/非法规则丢）', canon(c.epubTtsRules) === canon([{ match: 'p', flag: 'ja', text_language: 'ja', prompt_audio: '/a.wav' }]), J(c.epubTtsRules))
  check('旧的 epubTtsFlagRules 文本配置不再存在', !('epubTtsFlagRules' in c))
  await setConfig()
  const prev = await postJson('/api/epub/tts-preview', { texts: [], ttsRules: [...RULES, { match: 'p', flag: 'bad flag' }, { match: 'x[' , flag: 'q' }] })
  const f = prev.body.flag
  check('检查规则接口：有效条数、兜底 flag、每个 flag 实际生效的参数、第几条出错', f.ruleCount === 2 && f.fallback === 'zh' && f.flags.find((x) => x.flag === 'ja').params.promptAudio === '/refs/ja.wav' && f.flags.find((x) => x.flag === 'zh').params.speakerAudio === 'S.wav' && J(f.errors.map((e) => e.index)) === J([3, 4]), J(f))
}

// ================= 3) 预生成脚本（走真实的 metadata-actions） =================
{
  await setConfig({ epubTtsRules: RULES })
  gsvCalls.length = 0
  // 先清掉这本书的缓存，让预生成真的去合成
  await rm(path.join(dataDir, 'cache', 'epub-tts', ITEM), { recursive: true, force: true }).catch(() => {})
  const cacheRoot = async () => { try { return (await readdir(path.join(dataDir, 'cache'), { recursive: true })).filter((f) => String(f).endsWith('.wav')).length } catch { return 0 } }
  const scripts = (await api('/api/library/tag-scripts')).body
  const list = Array.isArray(scripts) ? scripts : scripts.scripts || scripts.items || []
  const scriptId = (list.find((s) => s.id === 'epub-tts-cache-v1') || {}).id || 'epub-tts-cache-v1'
  const job = await postJson(`/api/library/items/epub/${ITEM}/metadata-actions`, { actionIds: [scriptId], force: true })
  check('触发预生成脚本：任务已排队', job.status === 202, J(job))
  let tags = []
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    tags = ((await api(`/api/library/items/epub/${ITEM}`)).body.tags || [])
    if (tags.some((t) => String(t).startsWith('朗读缓存:'))) break
  }
  check('预生成：打上了缓存完成度 tag（全）和「音色」指纹', tags.includes('朗读缓存: 全') && tags.some((t) => /^朗读缓存音色: [0-9a-f]{6}$/.test(t)), J(tags))
  const jaCalls = gsvCalls.filter((c) => c.prompt_audio === '/refs/ja.wav'), zhCalls = gsvCalls.filter((c) => c.prompt_audio === 'P.wav')
  check('预生成：ja 句子用 ja 的参数、zh 句子用 zh 的参数，按参数分开发（一批里不混）', jaCalls.flatMap((c) => c.texts).sort().join('|') === [JA1, JA2].sort().join('|') && zhCalls.flatMap((c) => c.texts).includes(ZH1) && gsvCalls.every((c) => new Set(c.texts.map((t) => (t === JA1 || t === JA2 ? 'ja' : 'zh'))).size === 1), J(gsvCalls.map((c) => [c.prompt_audio, c.texts])))
  gsvCalls.length = 0
  const hit = await chunk([JA1, ZH1, JA2, ZH2], ['ja', 'zh', 'ja', 'zh'])
  check('预生成的缓存听书时一定命中：同样的请求不再打 GSV', gsvCalls.length === 0 && hit.body.chunks.every((c) => c.url))
  const fp1 = tags.find((t) => /^朗读缓存音色/.test(t))
  // 只改 ja 的参数后重跑：指纹变了；只重新合成 ja，zh 命中
  await setConfig({ epubTtsRules: [{ ...RULES[0], prompt_audio: '/refs/ja-v2.wav' }, RULES[1]] })
  gsvCalls.length = 0
  await postJson(`/api/library/items/epub/${ITEM}/metadata-actions`, { actionIds: [scriptId], force: true })
  let tags2 = []
  for (let i = 0; i < 60; i++) { await sleep(500); tags2 = ((await api(`/api/library/items/epub/${ITEM}`)).body.tags || []); const fp = tags2.find((t) => /^朗读缓存音色/.test(t)); if (fp && fp !== fp1) break }
  check('改了 ja 的参数再预生成：音色指纹变了；只重新合成 ja（用新参数），zh 命中缓存', tags2.find((t) => /^朗读缓存音色/.test(t)) !== fp1 && gsvCalls.length >= 1 && gsvCalls.every((c) => c.prompt_audio === '/refs/ja-v2.wav'), J([fp1, tags2, gsvCalls.map((c) => [c.prompt_audio, c.texts])]))
  void cacheRoot
}

// ================= 4) 浏览器：配置页的 JSON 规则 + 阅读页朗读带上 flag =================
let chromium = null
try {
  const { createRequire } = await import('node:module')
  ;({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '@playwright/test'))
} catch { console.log('（没有 @playwright/test：跳过浏览器部分；设置 PLAYWRIGHT_PATH 可以跑）') }
if (chromium) {
  await setConfig({ epubTtsRules: RULES })
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  const dialogs = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}) })
  const chunkBodies = []
  page.on('request', (r) => { if (r.method() === 'POST' && /\/tts-chunk$/.test(r.url())) { try { chunkBodies.push(JSON.parse(r.postData() || '{}')) } catch { /* ignore */ } } })

  // ---- 配置页 ----
  await page.goto(`${base}/`)
  await page.click('[data-view="settings-view"]')
  await page.waitForSelector('#config-epub-tts-rules')
  const shown = await page.inputValue('#config-epub-tts-rules')
  check('配置页：朗读规则以 JSON 数组显示，一条一行', shown.startsWith('[\n  {"match":"p[style*=\\"opacity\\"]","flag":"ja"') && shown.split('\n').length === 4, shown)
  await page.click('#config-epub-tts-flag-check')
  await page.waitForFunction(() => /有效规则 2 条/.test(document.querySelector('#config-epub-tts-flag-result')?.textContent || ''), null, { timeout: 5000 })
  const checkText = await page.$eval('#config-epub-tts-flag-result', (e) => e.textContent)
  check('「检查规则」：有效条数、兜底 flag、每个 flag 实际生效的参数（ja 用自己的参考音频，zh 用默认）', /兜底 flag：zh/.test(checkText) && /ja：参考音频 \/refs\/ja\.wav，文字稿 有，语言 ja\/zh/.test(checkText) && /zh：参考音频 P\.wav，文字稿 有，语言 zh\/zh/.test(checkText), checkText)
  await page.fill('#config-epub-tts-rules', '[{"match":"p","flag":"ja"},')
  await page.click('#config-save'); await sleep(700)
  check('配置页：JSON 写错 → 明确报错、不保存', dialogs.some((d) => /朗读规则.*不是合法的 JSON/.test(d)) && canon((await api('/api/config')).body.epubTtsRules) === canon(RULES))
  dialogs.length = 0
  await page.fill('#config-epub-tts-rules', '{"match":"p"}')
  await page.click('#config-save'); await sleep(700)
  check('配置页：不是数组 → 报错、不保存', dialogs.some((d) => /必须是 JSON 数组/.test(d)) && canon((await api('/api/config')).body.epubTtsRules) === canon(RULES))
  await page.fill('#config-epub-tts-rules', '[{"match":"@kana","flag":"ja","text_language":"ja"},{"match":"*","flag":"zh","prompt_audio":"/refs/zh.wav"}]')
  await page.click('#config-save'); await sleep(1000)
  check('配置页：改规则保存成功', canon((await api('/api/config')).body.epubTtsRules) === canon([{ match: '@kana', flag: 'ja', text_language: 'ja' }, { match: '*', flag: 'zh', prompt_audio: '/refs/zh.wav' }]))
  await setConfig({ epubTtsRules: RULES })

  // ---- 阅读页：朗读请求带上每句的 flag ----
  await page.goto(`${base}/#/media/epub/${ITEM}/${encodeURIComponent(unitId)}`)
  await page.waitForSelector('#media-reader-content [data-tts-flag]', { state: 'attached', timeout: 15000 }).catch(async () => { console.log('DEBUG', await page.evaluate(() => ({ hash: location.hash, meta: document.querySelector('#media-reader-meta')?.textContent, html: document.querySelector('#media-reader-content')?.innerHTML.slice(0, 600) }))) })
  await sleep(800)
  if (!(await page.$('.epub-tts-toggle'))) await page.click('#media-immersive').catch(() => {})
  await page.waitForSelector('.epub-tts-toggle', { timeout: 8000 })
  const options = await page.$$eval('.epub-tts-flag option', (os) => os.map((o) => o.value))
  check('阅读页：朗读范围下拉里有 全部 / ja / zh（flag 来自规则）', J([...options].sort()) === J(['all', 'ja', 'zh']), J(options))
  chunkBodies.length = 0
  await page.click('.epub-tts-toggle')
  await page.waitForFunction(() => document.querySelector('.epub-tts-toggle')?.classList.contains('active') || true, null, { timeout: 3000 })
  for (let i = 0; i < 40 && !chunkBodies.some((b) => b.flags?.includes('ja')) ; i++) await sleep(300)
  await page.click('.epub-tts-toggle'); await sleep(300)   // 再点 = 暂停
  const all = chunkBodies.flatMap((b) => (b.texts || []).map((t, i) => [t, (b.flags || [])[i]]))
  const flagOf = Object.fromEntries(all)
  check('朗读「全部」：请求体带 flags，和 texts 一一对应；日文句 → ja，中文句 → zh', all.length >= 2 && chunkBodies.every((b) => Array.isArray(b.flags) && b.flags.length === b.texts.length) && flagOf[JA1] === 'ja' && (flagOf[ZH1] === 'zh' || flagOf[ZH2] === 'zh'), J(all))
  // 只读 ja：选择会记在浏览器里；刷新（清掉页面里已经取好的朗读缓存状态）后再读，请求里应该只有 ja
  await page.selectOption('.epub-tts-flag', 'ja')
  await sleep(300)
  await page.reload()
  await page.waitForSelector('#media-reader-content [data-tts-flag]', { state: 'attached', timeout: 15000 })
  await sleep(800)
  if (!(await page.$('.epub-tts-toggle'))) await page.click('#media-immersive').catch(() => {})
  await page.waitForSelector('.epub-tts-toggle', { timeout: 8000 })
  check('朗读范围的选择记在浏览器里：刷新后下拉还是 ja', (await page.$eval('.epub-tts-flag', (e) => e.value)) === 'ja')
  chunkBodies.length = 0
  await page.click('.epub-tts-toggle')
  for (let i = 0; i < 25 && chunkBodies.length < 1; i++) await sleep(300)
  await sleep(1500)
  await page.click('.epub-tts-toggle'); await sleep(300)
  const jaOnly = chunkBodies.flatMap((b) => (b.texts || []).map((t, i) => (b.flags || [])[i]))
  check('选「朗读：ja」：只请求 ja 的句子（flags 全是 ja）', jaOnly.length >= 1 && jaOnly.every((f) => f === 'ja'), J(jaOnly))
  await page.selectOption('.epub-tts-flag', 'all')
  // 读选中：选中的是日文句 → flag = ja
  chunkBodies.length = 0
  await page.evaluate(() => {
    const el = document.querySelector('#media-reader-content [data-tts-flag="ja"]')
    const range = document.createRange(); range.selectNodeContents(el)
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range)
  })
  await page.click('.epub-tts-selection')
  for (let i = 0; i < 20 && !chunkBodies.length; i++) await sleep(250)
  check('「读选中」：选中日文句 → 请求的 flag 是 ja（按选区所在句子的 flag）', chunkBodies.length >= 1 && chunkBodies[0].flags?.[0] === 'ja', J(chunkBodies))
  check('浏览器部分没有页面错误', errors.length === 0, errors.join(' | '))
  await browser.close()
}

server.kill('SIGTERM')
gsv.close()
await rm(work, { recursive: true, force: true }).catch(() => {})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
