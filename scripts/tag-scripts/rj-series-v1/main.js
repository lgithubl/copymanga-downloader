// 生成媒体维度的「系列」关联键。
//
// 规则：有原档用原档 ID，没有就用自己的 ID。这样原档和它的各语言版本会落到
// 同一个键下，自然成为一组；没有原档关系的作品则各自独立成组。
//
// 键全部来自 ctx.item.dlsite，由 RJ / DLsite 脚本写入并持久化，不去解析
// DL原作ID: 之类的 tag 文本——字段比字符串可靠，也不受多编号、前缀冲突影响。
// 因此本脚本必须排在 RJ / DLsite 之后执行。

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const item = ctx.item || {}
  const dlsite = item.dlsite && typeof item.dlsite === 'object' ? item.dlsite : {}
  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length

  const picked = pickSeriesKey({ item, dlsite, options })
  const logs = [`系列键来源 ${picked.source}${picked.key ? `：${picked.key}` : '：未找到可用编号'}`]

  if (!picked.key) {
    // 没有编号就不打 tag：留空好过编一个键，否则所有无编号的作品会被归成一组
    logs.push('未产出 系列 tag；该合集不参与系列分组')
    return { itemTags: [], unitTags: [], unitPatches: [], logs, details: { seriesKey: '', source: picked.source } }
  }
  if (options.dryRun) {
    logs.push(`dryRun 开启，未写入 系列: ${picked.key}`)
    return { itemTags: [], unitTags: [], unitPatches: [], logs, details: { seriesKey: picked.key, source: picked.source, dryRun: true } }
  }
  // 只在合集作用域产出；选中部分章节执行时服务端会把 itemTags 清空，不必多此一举
  return {
    itemTags: fullRun ? [`${options.tagPrefix}: ${picked.key}`] : [],
    unitTags: [],
    unitPatches: [],
    logs,
    details: { seriesKey: picked.key, source: picked.source },
  }
}

// 优先级：原档 > 自身（dlsite 确认过的）> 导入时从目录名提取的
function pickSeriesKey({ item, dlsite, options }) {
  if (options.preferOriginal) {
    const original = cleanId(dlsite.originalProductId)
    if (original) return { key: original, source: '原档' }
  }
  const own = cleanId(dlsite.productId)
  if (own) return { key: own, source: '自身' }
  const imported = cleanId(item.productId)
  if (imported) return { key: imported, source: '导入编号' }
  return { key: '', source: '无' }
}

function cleanId(value) {
  return String(value || '').trim().toUpperCase()
}

function normalizeOptions(raw = {}) {
  return {
    tagPrefix: String(raw.tagPrefix || '系列').trim() || '系列',
    preferOriginal: raw.preferOriginal !== false,
    dryRun: raw.dryRun === true,
  }
}
