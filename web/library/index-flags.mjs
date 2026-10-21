// 媒体库索引摘要里的派生标志。放在单独的纯函数模块里，方便不起服务就测。

// 条目有没有「卡片悬停预览」：卡片封面是某个章节生成的缩略图（地址形如 …/thumbnail/<章节>/cover），
// 并且那个章节的缩略图是 ready、带 previewUrl。
// 为什么这样定义：
//   - 视频/音频：封面和预览在同一步一起生成并一起写入，章节缩略图 ready 就一定有预览；
//   - 压缩包图集：只有跑过 previewCount > 0 的缩略图脚本才会在章节上记 thumbnail.previewUrl；
//     只有迁移带来的 LANraragi 封面的条目章节没有 thumbnail 记录 → false，悬停不会发无谓的请求；
//   - 封面是外部图片（比如 RJ 从 DLsite 拉的）或没有封面 → false：预览和封面不是同一章节生成的，悬停换图没有意义；
//   - EPUB / TXT 没有缩略图 → false。
// 它是从元数据结构推出来的，不依赖标签，手动改标签影响不到它。
const GENERATED_COVER = /\/thumbnail\/([^/]+)\/cover$/

export function hasGeneratedPreview(item) {
  const cover = String(item?.cover || '')
  const match = GENERATED_COVER.exec(cover)
  if (!match) return false
  let unitId
  try {
    unitId = decodeURIComponent(match[1])
  } catch {
    return false
  }
  const units = Array.isArray(item?.mediaUnits) ? item.mediaUnits : []
  const unit = units.find((candidate) => candidate?.unitId === unitId)
  return Boolean(unit?.thumbnail?.status === 'ready' && unit.thumbnail.previewUrl)
}
