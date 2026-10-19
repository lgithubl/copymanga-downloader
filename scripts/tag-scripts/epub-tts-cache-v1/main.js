// 预生成 EPUB 朗读缓存。分句、缓存键、批量与并发队列都由服务端经 ctx.services.epubTts 提供，
// 和阅读器里点「朗读」走的是同一条路，所以这里生成的音频听书时一定命中。
//
// 状态 tag：
//   合集  朗读缓存: 全 / 部分 / 无      朗读缓存version: <脚本版本>      朗读缓存音色: <参考音频短指纹>
//   unit  朗读缓存: 全 / 部分 / 无 / 失败
// tag 只代表「这次运行结束时」的缓存完成度：缓存目录被清、参考音频换了（键变了），tag 不会自动变，
// 重跑一次才会刷新；「朗读缓存音色」就是用来一眼看出这批缓存是不是用当前音色生成的。

const TAG_GROUPS = ['朗读缓存', '朗读缓存version', '朗读缓存音色']

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const svc = ctx.services?.epubTts
  if (!svc) throw new Error('服务端不支持 ctx.services.epubTts，请升级服务端')
  if (!svc.configured) throw new Error('未配置 EPUB 朗读服务地址（epubTtsApiBase），请先到配置页填写')

  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length
  const units = (Array.isArray(ctx.units) ? ctx.units : []).filter((unit) => Array.isArray(unit.sections) && unit.sections.length)
  const logs = [options.dryRun
    ? '【dryRun】只统计，不调用 TTS，不改缓存；用完请关闭 dryRun 选项'
    : `预生成朗读缓存：${units.length} 个 unit${options.maxSentences ? `，本次最多生成 ${options.maxSentences} 句` : ''}`]
  if (!units.length) {
    logs.push('没有带章节的 EPUB unit')
    return keepOwn(ctx, fullRun, logs)
  }

  // 1) 分句 + 查缓存。身份用「真正发给 TTS 的文本」(spoken)：服务端会先过替换规则、并剔除没有可读内容的句子
  //    （分隔线、省略号、纯数字…，spoken 为 null，不合成也不算失败），缓存键也是 spoken 的哈希。
  //    不同原文替换后变成同一句，只生成一份。
  const info = new Map()      // 原文 -> { spoken, cached }
  const plans = []
  for (const unit of units) {
    const sections = await svc.sections(unit)
    const originals = [...new Set(sections.flatMap((section) => section.texts))]
    const fresh = originals.filter((text) => !info.has(text))
    if (fresh.length) {
      const planned = await svc.plan(fresh)
      fresh.forEach((text, i) => info.set(text, planned[i]))
    }
    const spokenOf = new Map()   // spoken -> 该 unit 里的第一个原文
    let skipped = 0
    for (const text of originals) {
      const { spoken } = info.get(text)
      if (spoken === null) { skipped++; continue }
      if (!spokenOf.has(spoken)) spokenOf.set(spoken, text)
    }
    plans.push({ unit, sections, sentenceCount: sections.reduce((sum, section) => sum + section.texts.length, 0), spokenOf, skipped })
  }
  const cachedSpoken = new Set()
  const missing = []           // [{ spoken, original }]，全合集按 spoken 去重
  const missingSeen = new Set()
  for (const plan of plans) {
    for (const [spoken, original] of plan.spokenOf) {
      if (info.get(original).cached) cachedSpoken.add(spoken)
      else if (!missingSeen.has(spoken)) { missingSeen.add(spoken); missing.push({ spoken, original }) }
    }
  }
  const missingChars = missing.reduce((sum, entry) => sum + entry.spoken.length, 0)
  const skippedTotal = plans.reduce((sum, plan) => sum + plan.skipped, 0)

  if (options.dryRun) {
    for (const plan of plans) {
      const todo = [...plan.spokenOf.keys()].filter((spoken) => !cachedSpoken.has(spoken)).length
      logs.push(`${plan.unit.title || plan.unit.unitId}: ${plan.sections.length} 章 ${plan.sentenceCount} 句（可读 ${plan.spokenOf.size}，跳过 ${plan.skipped}），未缓存 ${todo}`)
    }
    logs.push(`合计未缓存 ${missing.length} 句 / ${missingChars} 字，约需生成 ${Math.ceil(missing.length / Math.max(1, svc.batchMaxSentences))}+ 批`
      + `（音频体积粗估 ${Math.round(missingChars * 14 / 1024)} MB，按每字约 14KB，实际取决于采样率与语速）`)
    if (skippedTotal) logs.push(`另有 ${skippedTotal} 句没有可读内容（分隔线、省略号、纯数字或被替换规则删空），不会合成`)
    for (const plan of plans) {
      for (const section of plan.sections) {
        const todo = new Set(section.texts.map((text) => info.get(text)).filter((entry) => entry && entry.spoken !== null && !entry.cached).map((entry) => entry.spoken)).size
        if (todo) logs.push(`  · ${plan.unit.title || plan.unit.unitId} / ${section.title || section.sectionId}: ${section.texts.length} 句，未缓存 ${todo}`)
      }
    }
    const out = keepOwn(ctx, fullRun, logs)
    out.details = { dryRun: true, missingSentences: missing.length, missingChars, skippedSentences: skippedTotal }
    return out
  }

  // 2) 生成：按和听书预加载一致的规则攒批（句数 ≤ batchMaxSentences，累计字数 ≤ batchMaxChars）
  const batchMaxSentences = Math.max(1, Number(svc.batchMaxSentences) || 5)
  const batchMaxChars = Math.max(20, Number(svc.batchMaxChars) || 200)
  const budget = options.maxSentences > 0 ? options.maxSentences : Infinity
  const ok = new Set()
  const failed = new Map()   // spoken -> error
  let cursor = 0
  let consecutiveFailures = 0
  let stopped = ''
  while (cursor < missing.length) {
    if (ok.size + failed.size >= budget) { stopped = `已达本次上限 ${options.maxSentences} 句`; break }
    const batch = []
    let chars = 0
    while (cursor < missing.length && batch.length < batchMaxSentences && ok.size + failed.size + batch.length < budget) {
      const entry = missing[cursor]
      if (batch.length && chars + entry.spoken.length > batchMaxChars) break
      batch.push(entry)
      chars += entry.spoken.length
      cursor++
    }
    // 服务端对内容类错误已经逐句重试过，所以这里「整批都失败」才说明是服务本身的问题
    const results = await svc.generate(batch.map((entry) => entry.original))
    let batchFailed = 0
    batch.forEach((entry, i) => {
      if (results[i]?.ok) ok.add(entry.spoken)
      else { failed.set(entry.spoken, results[i]?.error || '未知错误'); batchFailed++ }
    })
    consecutiveFailures = batchFailed === batch.length ? consecutiveFailures + 1 : 0
    if (options.maxConsecutiveFailures > 0 && consecutiveFailures >= options.maxConsecutiveFailures) {
      stopped = `连续 ${consecutiveFailures} 批全部失败，TTS 服务可能不可用，已停止（最后错误：${[...failed.values()].pop()}）`
      break
    }
  }
  if (stopped) logs.push(stopped)

  // 3) 汇总状态（只看可读句子；跳过的不算缺）
  const isCached = (spoken) => cachedSpoken.has(spoken) || ok.has(spoken)
  const unitTags = []
  let total = 0
  let done = 0
  for (const plan of plans) {
    const spokenList = [...plan.spokenOf.keys()]
    if (!spokenList.length) continue
    const cachedCount = spokenList.filter(isCached).length
    const failCount = spokenList.filter((spoken) => failed.has(spoken)).length
    total += spokenList.length
    done += cachedCount
    const state = cachedCount === spokenList.length ? '全' : (cachedCount > 0 ? '部分' : (failCount > 0 ? '失败' : '无'))
    unitTags.push({ unitId: plan.unit.unitId, tags: [`朗读缓存: ${state}`] })
    logs.push(`${plan.unit.title || plan.unit.unitId}: ${spokenList.length} 句可读${plan.skipped ? `（另跳过 ${plan.skipped} 句无可读内容）` : ''}，已缓存 ${cachedCount}，失败 ${failCount} → ${state}`)
  }
  logs.push(`本次生成 ${ok.size} 句，失败 ${failed.size} 句，剩余未缓存 ${total - done} 句${skippedTotal ? `，跳过 ${skippedTotal} 句无可读内容` : ''}`)
  if (failed.size) {
    for (const [spoken, error] of [...failed].slice(0, 5)) logs.push(`  失败：${spoken.slice(0, 30)} → ${error}`)
  }
  const itemState = total && done === total ? '全' : (done > 0 ? '部分' : '无')
  return {
    itemTags: fullRun
      ? [`朗读缓存: ${itemState}`, `朗读缓存version: ${ctx.script?.version || 'unknown'}`, `朗读缓存音色: ${svc.fingerprint}`]
      : [],
    unitTags,
    unitPatches: [],
    logs,
    details: { generated: ok.size, failed: failed.size, remaining: total - done, skipped: skippedTotal, stopped: stopped || null },
  }
}

// dryRun / 没有可处理 unit 时用：服务端会先删掉本脚本上次生成的 tag 再写这次返回的，
// 返回空 = 清空。所以把对象上现有的本脚本 tag 原样回传，保证什么都不变。
function keepOwn(ctx, fullRun, logs) {
  const own = (tags) => (Array.isArray(tags) ? tags : [])
    .map((tag) => (typeof tag === 'string' ? tag : String(tag?.name ?? tag?.tag ?? '')).trim())
    .filter((tag) => TAG_GROUPS.includes(tag.slice(0, Math.max(0, tag.indexOf(':'))).trim()))
  const itemTags = fullRun ? own(ctx.item?.tags) : []
  const unitTags = []
  if (fullRun) {
    for (const unit of Array.isArray(ctx.units) ? ctx.units : []) {
      const tags = own(unit.tags)
      if (tags.length) unitTags.push({ unitId: unit.unitId, tags })
    }
  }
  logs.push(`收到合集 tag: ${(Array.isArray(ctx.item?.tags) ? ctx.item.tags : []).join(' | ') || '(无)'}`)
  return { itemTags, unitTags, unitPatches: [], logs }
}

function normalizeOptions(raw = {}) {
  return {
    dryRun: raw.dryRun === true,
    maxSentences: Math.max(0, Math.floor(Number(raw.maxSentences) || 0)),
    maxConsecutiveFailures: Math.max(0, Math.floor(Number(raw.maxConsecutiveFailures ?? 3))),
  }
}
