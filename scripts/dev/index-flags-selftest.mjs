#!/usr/bin/env node
// 单元测试：hasGeneratedPreview（媒体库索引摘要里的 hasPreview）。纯函数，不起服务。
// 用法：node scripts/dev/index-flags-selftest.mjs
import { hasGeneratedPreview } from '../../web/library/index-flags.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const thumbUrl = (type, id, unit, kind) => `/api/library/items/${type}/${id}/thumbnail/${encodeURIComponent(unit)}/${kind}`
const ready = (type, id, unit) => ({ status: 'ready', coverUrl: thumbUrl(type, id, unit, 'cover'), previewUrl: thumbUrl(type, id, unit, 'preview') })

check('视频条目：封面是第一个就绪章节的缩略图，章节有 previewUrl → 有', hasGeneratedPreview({
  cover: thumbUrl('media', 'v1', 'u1', 'cover'),
  mediaUnits: [{ unitId: 'u1', mediaKind: 'video', thumbnail: ready('media', 'v1', 'u1') }],
}) === true)
check('音频条目（内嵌封面的静态预览）→ 有', hasGeneratedPreview({
  cover: thumbUrl('media', 'a1', 'u1', 'cover'),
  mediaUnits: [{ unitId: 'u1', mediaKind: 'audio', thumbnail: ready('media', 'a1', 'u1') }],
}) === true)
check('多个章节：封面取自第 2 个章节，用它自己的缩略图判断（不是第一个）', hasGeneratedPreview({
  cover: thumbUrl('media', 'm1', 'u2', 'cover'),
  mediaUnits: [{ unitId: 'u1', mediaKind: 'video', thumbnail: { status: 'failed' } }, { unitId: 'u2', mediaKind: 'video', thumbnail: ready('media', 'm1', 'u2') }],
}) === true)
check('章节 id 带特殊字符（URL 编码）仍能对上', hasGeneratedPreview({
  cover: thumbUrl('media', 'm2', '第1集 [x]', 'cover'),
  mediaUnits: [{ unitId: '第1集 [x]', mediaKind: 'video', thumbnail: ready('media', 'm2', '第1集 [x]') }],
}) === true)
check('压缩包图集：跑过预览脚本（章节有 thumbnail.previewUrl）→ 有', hasGeneratedPreview({
  cover: thumbUrl('archive', 'z1', 'zip', 'cover'),
  mediaUnits: [{ unitId: 'zip', mediaKind: 'image-gallery', thumbnail: ready('archive', 'z1', 'zip') }],
}) === true)
check('压缩包图集：只有迁移带来的 LRR 封面（章节没有 thumbnail 记录）→ 没有', hasGeneratedPreview({
  cover: thumbUrl('archive', 'z2', 'zip', 'cover'),
  mediaUnits: [{ unitId: 'zip', mediaKind: 'image-gallery' }],
}) === false)
check('缩略图状态不是 ready（生成中/失败）→ 没有', hasGeneratedPreview({
  cover: thumbUrl('media', 'v2', 'u1', 'cover'),
  mediaUnits: [{ unitId: 'u1', thumbnail: { status: 'running', previewUrl: thumbUrl('media', 'v2', 'u1', 'preview') } }],
}) === false)
check('ready 但没有 previewUrl → 没有', hasGeneratedPreview({
  cover: thumbUrl('media', 'v3', 'u1', 'cover'),
  mediaUnits: [{ unitId: 'u1', thumbnail: { status: 'ready', coverUrl: thumbUrl('media', 'v3', 'u1', 'cover') } }],
}) === false)
check('外部封面（RJ 从 DLsite 拉的）→ 没有，即使章节有预览', hasGeneratedPreview({
  cover: 'https://img.dlsite.jp/modpub/images2/work/doujin/RJ01000000/RJ00000001_img_main.jpg',
  mediaUnits: [{ unitId: 'u1', thumbnail: ready('media', 'r1', 'u1') }],
}) === false)
check('封面指向的章节不存在 → 没有', hasGeneratedPreview({
  cover: thumbUrl('media', 'v4', 'gone', 'cover'),
  mediaUnits: [{ unitId: 'u1', thumbnail: ready('media', 'v4', 'u1') }],
}) === false)
check('封面是预览地址而不是 cover 地址 → 没有（只认 /cover 结尾）', hasGeneratedPreview({
  cover: thumbUrl('media', 'v5', 'u1', 'preview'),
  mediaUnits: [{ unitId: 'u1', thumbnail: ready('media', 'v5', 'u1') }],
}) === false)
check('EPUB / TXT（没有缩略图、封面是普通资源）→ 没有', hasGeneratedPreview({ cover: '/api/epub/b1/cover', mediaUnits: [{ unitId: 'u', mediaKind: 'epub' }] }) === false)
check('没有封面 / 没有章节 / 空对象 / undefined 都不抛错且为 false', [hasGeneratedPreview({}), hasGeneratedPreview({ cover: '' }), hasGeneratedPreview({ cover: thumbUrl('m', 'x', 'u', 'cover') }), hasGeneratedPreview(undefined), hasGeneratedPreview(null)].every((v) => v === false))
check('章节 id 是坏的百分号编码 → 不抛错，为 false', hasGeneratedPreview({ cover: '/api/library/items/m/x/thumbnail/%E0%A4%A/cover', mediaUnits: [{ unitId: 'u' }] }) === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
