// 压缩包图集：生成封面缩略图，可选再生成一张预览动图。真正的读 zip / 缩放 / 编码在服务端
// ctx.services.archiveGallery 里，脚本只负责按选项调用和产出状态 tag。
//   选项：force（重新生成已存在的）、previewCount（预览里除第一页外再放几页，0 = 不要预览）、
//        previewMode（random | even）、previewWidth（预览宽度，像素）

export async function generateTags(ctx) {
  const service = ctx.services?.archiveGallery
  if (!service) throw new Error('这个脚本只能用在压缩包图集条目上')
  const options = ctx.script?.options || {}
  const force = Boolean(options.force)
  const previewCount = Math.max(0, Math.floor(Number(options.previewCount) || 0))
  const itemTags = []
  const logs = []
  const details = {}

  try {
    const result = await service.generateCover({ force })
    itemTags.push('压缩包封面: 有')
    logs.push(result.status === 'exists' ? '封面已存在，跳过' : '已生成封面')
    details.cover = result.status
  } catch (error) {
    itemTags.push('压缩包封面: 失败')
    logs.push(`封面生成失败：${error.message}`)
    details.cover = 'failed'
  }

  // 预览和封面分开判断：迁移带来的 LRR 封面保留，只补预览
  if (previewCount > 0) {
    try {
      const result = await service.generatePreview({
        count: previewCount,
        mode: options.previewMode === 'even' ? 'even' : 'random',
        width: options.previewWidth,
        force,
      })
      if (result.status === 'skipped') {
        itemTags.push('压缩包预览: 无')
        logs.push(`没有预览：${result.reason}`)
      } else {
        itemTags.push('压缩包预览: 有')
        logs.push(result.status === 'exists' ? '预览已存在，跳过' : `已生成预览（第 ${result.frames.map((index) => index + 1).join('、')} 页）`)
      }
      details.preview = result.status
      if (result.frames) details.frames = result.frames
    } catch (error) {
      itemTags.push('压缩包预览: 失败')
      logs.push(`预览生成失败：${error.message}`)
      details.preview = 'failed'
    }
  }

  // 迁移时按 LRR 数据写过「压缩包封面: 有/无」：互斥组里不是脚本产出的标签会挡住新值，所以先清掉再返回
  await service.clearTagGroups(['压缩包封面'])
  return { itemTags, logs, details }
}
