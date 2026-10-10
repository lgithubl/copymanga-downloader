// 给月度 ANI 导入的合集打上来源 tag。
//
// 目前只做一件事：产出「导入: 月度ani」。之所以单独占一个脚本而不是导入时直接写死 tag，
// 是为了后续在这里接番剧元数据（标题归一化、AniDB 匹配等）时不用再动导入流程。
//
// exclusiveTagGroups 声明了「导入」组，所以重跑会替换掉同组旧值，不会堆叠。

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length
  const tag = `${options.tagPrefix}: ${options.tagValue}`
  const logs = []

  // scope 是 item，选中部分章节执行时服务端会把 itemTags 清空，这里顺带说明原因
  if (!fullRun) {
    logs.push('选中了部分章节，本脚本只在合集维度产出，本次不写 tag')
    return { itemTags: [], unitTags: [], unitPatches: [], logs, details: { tag: '', scope: 'unit' } }
  }
  if (options.dryRun) {
    logs.push(`dryRun 开启，未写入 ${tag}`)
    return { itemTags: [], unitTags: [], unitPatches: [], logs, details: { tag, dryRun: true } }
  }

  logs.push(`写入 ${tag}`)
  return { itemTags: [tag], unitTags: [], unitPatches: [], logs, details: { tag } }
}

function normalizeOptions(raw = {}) {
  return {
    tagPrefix: String(raw.tagPrefix || '导入').trim() || '导入',
    tagValue: String(raw.tagValue || '月度ani').trim() || '月度ani',
    dryRun: raw.dryRun === true,
  }
}
