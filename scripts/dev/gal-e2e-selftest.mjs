#!/usr/bin/env node
// 端到端（起真的服务端、走真的导入 → gal-layout → 浏览 → 资源接口）：虚拟索引里的资源要真的取得出来，音频要支持 Range（206）。
//   覆盖以前单元自测漏掉的几类问题：gal-layout 写出的资源根没带虚拟目录（Unity GameMaterial 的图一张都取不到）、mhp 的深路径（7 段）语音没进虚拟索引、资源接口不带 Range。
//   需要空闲端口 8121。不需要浏览器。
import http from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encryptDsm } from '../../web/library/gal/unity-dsm.mjs'
import { assemble, buildRiff, buildXfl } from './make-rscript-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const work = await mkdtemp(path.join(os.tmpdir(), 'gal-e2e-'))
const dataDir = path.join(work, 'data')
const galRoot = path.join(dataDir, 'gal')
const port = 8121
const base = `http://127.0.0.1:${port}`
let server
try {
  // ---- 夹具：三个游戏各一个目录 ----
  const unity = path.join(galRoot, 'U')
  await mkdir(path.join(unity, 'g', 'GameMaterial', 'bgimage'), { recursive: true }); await mkdir(path.join(unity, 'g', 'GameMaterial', 'voice'), { recursive: true })
  await writeFile(path.join(unity, 'g', 'GameMaterial', 'data.dsm'), encryptDsm('*start\n*Ep000\n[BG g="b_01"]\n[pv f="Yume001]\n[OnName num="ゆめ"]\nこんにちは\n[cpg]\n'))
  await writeFile(path.join(unity, 'g', 'GameMaterial', 'env.cof'), 'x')
  const psm = Buffer.from(PNG); psm[0] = 0xed
  await writeFile(path.join(unity, 'g', 'GameMaterial', 'bgimage', 'b_01.psm'), psm)
  await writeFile(path.join(unity, 'g', 'GameMaterial', 'voice', 'Yume001.ogg'), 'OggS-voice')
  await writeFile(path.join(unity, 'g', 'g.exe'), 'MZ')

  const mh = path.join(galRoot, 'M', 'MahotanArchive')
  await mkdir(path.join(mh, 'assets'), { recursive: true })
  await writeFile(path.join(mh, 'MahotanArchive.exe'), 'MZ'); await writeFile(path.join(mh, 'userdata.json'), '{}')
  const script = J({ sceneId: 's1', commands: [{ cmd: 'background', content: 'bg_1', name: '', title: '', extraCmd: '', voice: '' }, { cmd: 'text', content: 'hi', name: 'A', title: '', extraCmd: '', voice: 'v1' }], storyAssets: { visuals: {}, voices: { v1: 'media/voices/characters/c1/scene/general/v1.mp3' }, backgrounds: { bg_1: 'images/backgrounds/background-001.jpg' }, bgm: {}, metadata: {} } })
  execFileSync('python3', ['-c', `
import zipfile,sys,json
spec=json.loads(sys.argv[1])
for f,entries in spec.items():
    with zipfile.ZipFile(f,'w') as z:
        for n,(d,m) in entries.items(): z.writestr(zipfile.ZipInfo(n), d.encode('utf8'), zipfile.ZIP_STORED if m=='s' else zipfile.ZIP_DEFLATED)
`, J({ [path.join(mh, 'assets', 'mahotan-data.mhp')]: { 'data/scripts/scene/general/s1.json': [script, 'd'] }, [path.join(mh, 'assets', 'mahotan-audio.mhp')]: { 'media/voices/characters/c1/scene/general/v1.mp3': ['ID3' + 'x'.repeat(5000), 's'] }, [path.join(mh, 'assets', 'mahotan-images.mhp')]: { 'images/backgrounds/background-001.jpg': ['jpgdata', 's'] } })])

  const rs = path.join(galRoot, 'R', 'Game')
  await mkdir(rs, { recursive: true })
  // Vorbis ACM 的 Ogg 里夹着空页（序列号 0xffffffff）：服务端取出来必须是干净的
  const page = (serial, no, flags, payload) => { const h = Buffer.alloc(28); h.write('OggS', 0, 'latin1'); h[5] = flags; h.writeUInt32LE(serial, 14); h.writeUInt32LE(no, 18); h[26] = 1; h[27] = payload.length; return Buffer.concat([h, payload]) }
  const junk = (no) => { const h = Buffer.alloc(28); h.write('OggS', 0, 'latin1'); h.writeUInt32LE(0xffffffff, 14); h.writeUInt32LE(no, 18); h[26] = 1; return h }
  const cleanOgg = Buffer.concat([page(0, 0, 2, Buffer.from('head')), page(0, 1, 0, Buffer.from('body')), page(0, 2, 4, Buffer.from('tail'))])
  const dirtyOgg = Buffer.concat([page(0, 0, 2, Buffer.from('head')), junk(0), page(0, 1, 0, Buffer.from('body')), junk(1), page(0, 2, 4, Buffer.from('tail')), junk(2)])
  const gsc = assemble([{ op: 0x79, args: [14, { str: 'grpo_bu1' }] }, { op: 0x14, args: [2022, 0] }, { op: 0x51, args: [0, 701, 0, 0, { str: 'K' }, { str: 'Hello' }, 1] }])
  await writeFile(path.join(rs, 'scr.xfl'), buildXfl([['0001.gsc', gsc]]))
  await writeFile(path.join(rs, 'grpe.xfl'), buildXfl([['2022.wcg', Buffer.alloc(8)]]))
  await writeFile(path.join(rs, 'voice.xfl'), buildXfl([['0701.wav', buildRiff(dirtyOgg)], ['0702.wav', buildRiff(Buffer.alloc(64, 1), { pcm: true })]]))
  await writeFile(path.join(rs, 'game.exe'), 'MZ')

  // ---- 起服务 ----
  server = spawn('node', ['web/server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TAG_SCRIPTS_DIR: path.join(root, 'scripts', 'tag-scripts') }, stdio: 'ignore' })
  for (let i = 0; i < 150; i += 1) { try { await fetch(`${base}/health`); break } catch { await sleep(200) } }
  const api = async (p, init) => { const res = await fetch(base + p, init); const t = await res.text(); try { return { status: res.status, body: JSON.parse(t), res } } catch { return { status: res.status, body: t, res } } }
  const importGame = async (dir, adapter, id) => {
    const form = new FormData()
    form.set('title', dir); form.set('importProfile', 'gal-import'); form.set('metadataActionIds', 'gal-layout')
    form.set('profileOptions', J({ rootDir: path.join(galRoot, dir), adapters: [adapter], defaultMetadataActions: ['gal-layout'], dryRun: false, config: { game: { id } } }))
    const r = await api('/api/library/items?type=gal', { method: 'POST', body: form })
    await sleep(3500)
    return r.body.items[0].itemId
  }
  const scene = async (itemId, section) => (await api(`/api/library/items/gal/${itemId}/reader/main?sectionId=${encodeURIComponent(section)}`)).body.scene
  const res = (itemId, rel, headers = {}) => fetch(`${base}/api/library/items/gal/${itemId}/resource?path=${encodeURIComponent(rel)}`, { headers })

  // ---- Unity GameMaterial ----
  const u = await importGame('U', 'unity::dsm', 'unity::game')
  const uItem = (await api(`/api/library/items/gal/${u}`)).body
  check('Unity：资源根 = arc/res（虚拟的 .psm → png）+ GameMaterial（voice / sound / se 的普通文件）', uItem.config.resourceRoots.length === 2 && /arc\/res$/.test(uItem.config.resourceRoots[0]), J(uItem.config.resourceRoots))
  const us = await scene(u, 's:data/00_Ep000.dsm')
  const bg = us?.steps.flatMap((s) => s.commands).find((c) => c.op === 'bg')
  const voice = us?.steps.flatMap((s) => s.commands).find((c) => c.op === 'voice')
  const png = bg ? await res(u, bg.src) : null
  check('Unity：场景里背景 / 语音都解析到资源；.psm 取出来是合法 PNG（首字节改回 0x89）', Boolean(bg && voice) && png?.status === 200 && Buffer.from(await png.arrayBuffer()).equals(PNG), J(us?.stats))
  const uv = voice ? await res(u, voice.src) : null
  check('Unity：磁盘上的语音文件能取（200）', uv?.status === 200 && (await uv.text()) === 'OggS-voice')

  // ---- MahotanArchive ----
  const m = await importGame('M', 'mahotan::json', 'mahotan::game')
  const ms = await scene(m, 's:mahotan-data/scene/general/s1.json')
  const mv = ms?.steps.flatMap((s) => s.commands).find((c) => c.op === 'voice')
  check('Mahotan：7 段深的语音路径（media/voices/characters/<角色>/scene/general/…）进了虚拟索引、场景里有语音', Boolean(mv) && ms.stats.voices.resolved === 1, J(ms?.stats))
  const mvr = mv ? await res(m, mv.src) : null
  check('Mahotan：语音从 mhp 里取出来（200，音频类型）', mvr?.status === 200 && /audio\/mpeg/.test(mvr.headers.get('content-type')) && (await mvr.arrayBuffer()).byteLength === 5003)

  // ---- RScript ----
  const r = await importGame('R', 'rscript::gsc', 'rscript::game')
  const rscene = await scene(r, 's:scr/0001.rscript')
  const rv = rscene?.steps.flatMap((s) => s.commands).find((c) => c.op === 'voice')
  check('RScript：场景里有语音（voice/0701.ogg）', rv?.src === 'voice/0701.ogg', J(rscene?.stats))
  const full = rv ? await res(r, rv.src) : null
  const body = full ? Buffer.from(await full.arrayBuffer()) : Buffer.alloc(0)
  check('RScript：Vorbis ACM 的语音取出来是干净的 Ogg（夹在里面的空页和结尾的填充都去掉了）', body.equals(cleanOgg), `${body.length} / ${cleanOgg.length}`)
  check('资源接口带 Accept-Ranges、ETag', full?.headers.get('accept-ranges') === 'bytes' && Boolean(full.headers.get('etag')), J([...full.headers.entries()]))
  const part = await res(r, rv.src, { Range: 'bytes=4-' })
  const partBody = Buffer.from(await part.arrayBuffer())
  check('Range: bytes=4- → 206，Content-Range 精确，内容是从第 4 字节起的', part.status === 206 && part.headers.get('content-range') === `bytes 4-${cleanOgg.length - 1}/${cleanOgg.length}` && partBody.equals(cleanOgg.subarray(4)), J([part.status, part.headers.get('content-range')]))
  const suffix = await res(r, rv.src, { Range: 'bytes=-6' })
  check('Range: bytes=-6（最后 6 字节）→ 206；越界 → 416', suffix.status === 206 && Buffer.from(await suffix.arrayBuffer()).equals(cleanOgg.subarray(cleanOgg.length - 6)) && (await res(r, rv.src, { Range: `bytes=${cleanOgg.length + 10}-` })).status === 416)
  const cond = await new Promise((ok) => http.get(`${base}/api/library/items/gal/${r}/resource?path=${encodeURIComponent(rv.src)}`, { headers: { 'If-None-Match': full.headers.get('etag') } }, (x) => { x.resume(); ok({ status: x.statusCode }) }))
  check('If-None-Match 命中 → 304', cond.status === 304, String(cond.status) + ' ' + full.headers.get('etag') + ' vs ' + part.headers.get('etag'))
  const pcm = await res(r, 'voice/0702.wav')
  check('同一个档案里的 PCM wav 保持 .wav（不被当成 Vorbis 转 ogg）', pcm.status === 200 && /wav/.test(pcm.headers.get('content-type')))
} finally {
  server?.kill()
  await rm(work, { recursive: true, force: true })
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
