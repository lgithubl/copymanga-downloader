#!/usr/bin/env node
// 往一个正在跑的压缩包图集站点上传「样式测试数据」：各种首页宽高比、超长标题/文件名、超长/很多 tag、系列。
//   node scripts/dev/upload-visual-demo-data.mjs <站点地址，如 https://xxx.trycloudflare.com> [认证头，如 "Authorization: Bearer xxx"]
// 需要 ImageMagick（magick）和 python3（打 zip）。上传后跑缩略图脚本（含预览动图）并补 tag。
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = (process.argv[2] || '').replace(/\/$/, '')
if (!BASE) { console.error('用法: upload-visual-demo-data.mjs <站点地址> [认证头]'); process.exit(2) }
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

const work = await mkdtemp(path.join(os.tmpdir(), 'visual-demo-'))
const LONG_LATIN = 'Extraordinarily-Long-Unbroken-Title-Without-Any-Spaces-To-Wrap-' + 'x'.repeat(60)
const LONG_CJK = '这是一个非常非常长的标题用来测试卡片在标题超过两行的时候会不会把卡片撑坏或者把按钮挤出卡片之外'
const manyTags = Array.from({ length: 60 }, (_, i) => `标签${i}:取值${i}`)
const longTags = ['作者:' + 'a'.repeat(150), '社团:' + '很长的社团名'.repeat(20), 'x'.repeat(200), '语言:中文', '字幕:有']
const S = '系列:样式测试系列'
// [文件名(不含 .zip), 首页宽x高, 页数, 额外 tag]
const specs = [
  ['样式-漫画 3:4 正常', [800, 1132], 6, ['作者:甲', '语言:中文']],
  ['样式-超高封面 0.5', [600, 1200], 5, ['作者:甲']],
  ['样式-超宽封面 3:1', [1800, 600], 5, ['作者:甲']],
  ['样式-视频比例 16:9', [1280, 720], 6, ['语言:日语']],
  ['样式-4:3 封面', [1200, 900], 5, []],
  ['样式-方形封面', [800, 800], 5, ['作者:甲']],
  ['样式-极小封面 40x40', [40, 40], 3, ['作者:甲']],
  ['样式-超大封面 2400x3600', [2400, 3600], 4, ['作者:甲']],
  ['样式-' + LONG_CJK + LONG_CJK, [800, 1132], 4, ['作者:甲']],
  ['样式-' + LONG_LATIN, [800, 1132], 4, ['作者:甲']],
  ['样式-60个标签', [800, 1132], 4, manyTags],
  ['样式-超长标签', [800, 1132], 4, longTags],
  ['样式-特殊字符 [社团 (作者)] 标题 (原作) [中国翻訳] & \'单引\' ＂全角＂', [800, 1132], 4, ['作者:<i>x</i>', 'a&b"c']],
  ['样式-最坏情况 ' + LONG_LATIN + LONG_CJK.slice(0, 20), [1800, 600], 4, [...manyTags, ...longTags]],
  ['样式-系列成员1', [800, 1132], 5, [S, '字幕:有', '作者:甲']],
  ['样式-系列成员2 ' + LONG_LATIN, [1800, 600], 5, [S, ...manyTags.slice(0, 20)]],
  ['样式-系列成员3', [600, 1200], 5, [S, ...longTags]],
  ['样式-系列成员4', [1280, 720], 5, [S]],
  ['样式-单页压缩包（无预览）', [800, 1132], 1, ['作者:甲']],
]
const colors = ['#2b6cb0', '#2f855a', '#c05621', '#6b46c1', '#b83280', '#2c7a7b', '#975a16', '#744210']
const makeZip = (name, [w, h], pages, idx) => {
  const dir = path.join(work, `z${idx}`)
  execFileSync('mkdir', ['-p', dir])
  for (let p = 1; p <= pages; p++) {
    const ww = p === 1 ? w : Math.max(40, Math.round(w * (p % 2 ? 1 : 0.9)))
    const hh = p === 1 ? h : Math.max(40, Math.round(h * (p % 2 ? 1 : 1.1)))
    execFileSync('magick', ['-size', `${ww}x${hh}`, `xc:${colors[(idx + p) % colors.length]}`, '-fill', 'none', '-stroke', 'white', '-strokewidth', '4',
      '-draw', `rectangle 2,2 ${ww - 3},${hh - 3}`, '-draw', `line 0,0 ${ww},${hh}`, '-draw', `line 0,${hh} ${ww},0`,
      '-fill', 'white', '-stroke', 'none', '-gravity', 'center', '-pointsize', String(Math.max(14, Math.min(ww, hh) / 6)), '-annotate', '0', `p${p} ${ww}x${hh}`,
      '-quality', '80', path.join(dir, `${String(p).padStart(3, '0')}.jpg`)])
  }
  const zip = path.join(work, `${name}.zip`)
  execFileSync('python3', ['-I', '-c', 'import sys,zipfile,os\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_STORED)\nfor f in sorted(os.listdir(sys.argv[2])): z.write(os.path.join(sys.argv[2],f),f)\nz.close()', zip, dir])
  return zip
}

console.log('准备预览脚本配置（previewCount=6, width=400）…')
console.log((await postJson('/api/tag-scripts/archive-gallery-thumbnail-v1/config', { options: { previewCount: 6, previewMode: 'even', previewWidth: 400, force: false } })).status)

const uploaded = []
for (const [i, [name, size, pages, tags]] of specs.entries()) {
  const zip = makeZip(name.slice(0, 200), size, pages, i)
  const form = new FormData()
  form.set('importProfile', 'archive-gallery')
  form.set('metadataActionIds', 'archive-gallery-thumbnail-v1,archive-gallery-tags-v1')
  form.append('file', new Blob([await readFile(zip)]), path.basename(zip))
  const res = await api('/api/library/items?type=archive', { method: 'POST', body: form })
  const item = res.body?.job ? null : (res.body?.items?.[0] || res.body?.item || res.body)
  console.log(`${res.status} ${name.slice(0, 30)} → ${res.body?.job?.id || item?.itemId || JSON.stringify(res.body).slice(0, 120)}`)
  uploaded.push({ name, tags, item, res })
}
// 后台任务型响应：等任务做完再按标题找条目
for (let i = 0; i < 120; i++) {
  const { body } = await api('/api/archive-gallery/job')
  if (!body?.job || body.job.status !== 'running') break
  await sleep(1000)
}
await api('/api/library/index/rebuild', { method: 'POST' })
for (let i = 0; i < 120; i++) { const p = (await api('/api/library/items?type=archive&page=1&limit=1')).body; if (p?.index?.status === 'ready') break; await sleep(1000) }
await sleep(1500)
const list = (await api('/api/library/items?type=archive&keyword=' + encodeURIComponent('样式-') + '&page=1&limit=100')).body
const byTitle = new Map((list.items || []).map((it) => [it.title, it]))
console.log(`站点上找到 ${byTitle.size} 个「样式-」条目（期望 ${specs.length}）`)
// 补 tag（与已有 tag 合并）；再跑一遍缩略图脚本确保封面/预览都在
for (const { name, tags } of uploaded) {
  const it = [...byTitle.values()].find((x) => x.title === name || x.title === name.slice(0, 200))
  if (!it) { console.log('找不到条目', name.slice(0, 30)); continue }
  if (tags.length) {
    const full = (await api(`/api/library/items/archive/${it.itemId}`)).body
    const r = await postJson(`/api/library/items/archive/${it.itemId}/tags`, { tags: [...new Set([...(full.tags || []), ...tags])] })
    if (r.status !== 200) console.log('补 tag 失败', name.slice(0, 20), r.status, JSON.stringify(r.body).slice(0, 100))
  }
  await postJson(`/api/library/items/archive/${it.itemId}/tag-scripts`, { actionIds: ['archive-gallery-thumbnail-v1'], force: true })
}
await sleep(15000)
await api('/api/library/index/rebuild', { method: 'POST' })
await rm(work, { recursive: true, force: true })
console.log('完成')
