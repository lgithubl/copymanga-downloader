#!/usr/bin/env node
// 往一个正在跑的演示站点灌「今天几个改动」要试的数据和配置：
//   node scripts/dev/seed-demo.mjs <站点地址，如 http://127.0.0.1:8080> [认证头]
//   - 朗读规则：一本中日对照的 EPUB（淡色段落是日文）+ 配置里的 ja / zh 规则（每个 flag 自己的参考音频/语言）+ 模拟 TTS 地址
//     （模拟 TTS 见 mock-gsv.py：不同参数合成不同音高，耳朵能分出 ja 和 zh 用了不同的参数）
//   - 新页面规则：三种导入方案的条目（Gal 导入、文本媒体、压缩包图集），配置里预置了一套规则（见下），可以到配置页改 JSON 试
//   - 打标签，方便试「点标签是否开新页」
// 需要 python3（打 EPUB 的 zip）。Gal 演示媒体由工作流另行导入（这里只检查它在不在）。
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = (process.argv[2] || '').replace(/\/$/, '')
if (!BASE) { console.error('用法: seed-demo.mjs <站点地址> [认证头]'); process.exit(2) }
const headers = {}
if (process.argv[3]) { const [k, ...v] = process.argv[3].split(':'); headers[k.trim()] = v.join(':').trim() }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (p, init = {}) => {
  const res = await fetch(BASE + p, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const postJson = (p, v) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })

const TTS_API = process.env.DEMO_TTS_API || 'http://host.docker.internal:8196'
const TTS_RULES = [
  { match: 'p[style*="opacity"]', flag: 'ja', text_language: 'ja', prompt_language: 'ja', prompt_audio: 'demo-ja.wav', prompt_text: '日本語の参考音声です。' },
  { match: '*', flag: 'zh', text_language: 'zh' },
]
// 打开媒体：Gal 和文本媒体开新页，其余当前页；点标签：压缩包图集的标签开新页，其余当前页（Ctrl/⌘ 点击任何都开新页）
const OPEN_RULES = [{ profile: 'gal-import' }, { profile: 'text-media' }]
const TAG_RULES = [{ profile: 'archive-gallery' }]

const work = await mkdtemp(path.join(os.tmpdir(), 'seed-demo-'))
try {
  // ---- 配置 ----
  const cfg = await postJson('/api/config', {
    epubTtsApiBase: TTS_API,
    epubTtsSpeakerAudio: 'demo-speaker.wav',
    epubTtsPromptAudio: 'demo-default.wav',
    epubTtsPromptText: '默认参考音频的文字稿。',
    epubTtsPromptLanguage: 'zh',
    epubTtsRules: TTS_RULES,
    mediaOpenInNewTabRules: OPEN_RULES,
    tagSearchOpenInNewTabRules: TAG_RULES,
  })
  console.log('config', cfg.status)

  // ---- 中日对照 EPUB ----
  const dir = path.join(work, 'epub')
  await mkdir(path.join(dir, 'META-INF'), { recursive: true })
  await mkdir(path.join(dir, 'OEBPS'), { recursive: true })
  await writeFile(path.join(dir, 'mimetype'), 'application/epub+zip')
  await writeFile(path.join(dir, 'META-INF/container.xml'), '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  await writeFile(path.join(dir, 'OEBPS/content.opf'), '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">demo-bilingual</dc:identifier><dc:title>朗读规则演示（中日对照）</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>')
  await writeFile(path.join(dir, 'OEBPS/nav.xhtml'), '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章</a></li><li><a href="c2.xhtml">第二章</a></li></ol></nav></body></html>')
  const pairs = [
    ['今日はいい天気ですね。', '今天天气真好。'], ['散歩に行きましょうか。', '我们去散步吧。'], ['桜がきれいに咲いています。', '樱花开得很漂亮。'],
    ['お茶でも飲みませんか。', '要不要喝杯茶？'], ['少し休んでから帰りましょう。', '稍微休息一下再回去吧。'], ['また明日、ここで会いましょう。', '明天再在这里见面吧。'],
  ]
  const chapter = (title, list) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${list.map(([ja, zh]) => `<p style="opacity:0.5">${ja}</p><p>${zh}</p>`).join('')}</body></html>`
  await writeFile(path.join(dir, 'OEBPS/c1.xhtml'), chapter('第一章 散步', pairs.slice(0, 3)))
  await writeFile(path.join(dir, 'OEBPS/c2.xhtml'), chapter('第二章 喝茶', pairs.slice(3)))
  execFileSync('python3', ['-I', '-c', 'import sys,zipfile,os\nsrc,out=sys.argv[1],sys.argv[2]\nz=zipfile.ZipFile(out,"w")\nz.write(os.path.join(src,"mimetype"),"mimetype",zipfile.ZIP_STORED)\nfor d,_,fs in os.walk(src):\n  for f in fs:\n    p=os.path.join(d,f); r=os.path.relpath(p,src)\n    if r!="mimetype": z.write(p,r,zipfile.ZIP_DEFLATED)\nz.close()', dir, path.join(work, 'bilingual.epub')])
  const ef = new FormData()
  ef.set('file', new Blob([await readFile(path.join(work, 'bilingual.epub'))]), '朗读规则演示（中日对照）.epub')
  const epub = await api('/api/library/items?type=epub', { method: 'POST', body: ef })
  console.log('epub', epub.status, epub.body?.itemId || '')

  // ---- 文本媒体（TXT）----
  const tf = new FormData()
  tf.set('importProfile', 'text-media')
  tf.set('file', new Blob([`第一章 开始\n${Array.from({ length: 40 }, (_, i) => `这是第 ${i + 1} 句演示文字，用来试文本媒体的阅读和朗读。`).join('\n')}\n`]), '文本媒体演示.txt')
  const txt = await api('/api/library/items?type=media', { method: 'POST', body: tf })
  console.log('txt', txt.status, txt.body?.itemId || '')

  // ---- 标签（试「点标签是否开新页」）----
  // 列表接口读的是索引：刚导入的条目要先重建索引才看得到
  const rebuild = async () => {
    await postJson('/api/library/index/rebuild', {})
    for (let i = 0; i < 40; i++) {
      const st = (await api('/api/library/index/status')).body
      if (st?.status === 'ready' && !st?.dirty && !st?.rebuildQueued) break
      await sleep(500)
    }
  }
  await rebuild()
  if (epub.body?.itemId) await postJson(`/api/library/items/epub/${epub.body.itemId}/tags`, { tags: ['演示:朗读规则', '语言:中日对照'] })
  if (txt.body?.itemId) await postJson(`/api/library/items/media/${txt.body.itemId}/tags`, { tags: ['演示:文本媒体'] })
  const gal = (await api('/api/library/items?type=gal&page=1&limit=5')).body?.items?.[0]
  if (gal) await postJson(`/api/library/items/gal/${gal.itemId}/tags`, { tags: ['演示:Gal'] })
  await rebuild()
  console.log(`seed done: gal=${gal ? gal.itemId : '（没有）'} epub=${epub.body?.itemId || '-'} txt=${txt.body?.itemId || '-'}`)
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => {})
}
