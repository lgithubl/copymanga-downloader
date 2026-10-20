// 压缩包图集：生成封面缩略图。真正的读 zip / 缩放在服务端 ctx.services.archiveGallery 里，
// 脚本只负责调用和产出状态 tag。

export async function generateTags(ctx) {
  const service = ctx.services?.archiveGallery
  if (!service) throw new Error('这个脚本只能用在压缩包图集条目上')
  const force = Boolean(ctx.script?.options?.force)
  try {
    const result = await service.generateCover({ force })
    return {
      itemTags: ['压缩包封面: 有'],
      logs: [result.status === 'exists' ? '封面已存在，跳过' : '已生成封面'],
      details: { status: result.status },
    }
  } catch (error) {
    return {
      itemTags: ['压缩包封面: 失败'],
      logs: [`封面生成失败：${error.message}`],
      details: { status: 'failed' },
    }
  }
}
