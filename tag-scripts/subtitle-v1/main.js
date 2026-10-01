export async function generateTags(ctx) {
  const units = Array.isArray(ctx.units) ? ctx.units : []
  const playable = units.filter((unit) => unit.mediaKind === 'audio' || unit.mediaKind === 'video')
  const matched = playable.filter((unit) => Array.isArray(unit.subtitles) && unit.subtitles.length > 0)
  const unmatched = units.filter((unit) => unit.mediaKind === 'subtitle')

  return {
    itemTags: [`字幕v1: ${matched.length || unmatched.length ? '有' : '无'}`],
    unitTags: units.map((unit) => ({
      unitId: unit.unitId,
      tags: [`字幕v1: ${unit.mediaKind === 'subtitle' ? '未匹配' : Array.isArray(unit.subtitles) && unit.subtitles.length ? '有' : '无'}`],
    })),
  }
}
