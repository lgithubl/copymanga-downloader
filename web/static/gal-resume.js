// Rebuilt script trees can invalidate saved browser nodes. Recover automatic
// resume once, leaving explicit links, non-Gal readers and genuine errors alone.
export async function loadReaderWithRecovery({ load, type, sectionId = '', resume = false }) {
  try { return { reader: await load(sectionId), recovered: false } }
  catch (error) {
    if (type !== 'gal' || !resume || !sectionId || error.status !== 404) throw error
    const reader = await load('')
    const notice = '上次阅读位置已失效，已返回首页，请重新选择章节。原阅读进度保留。'
    if (reader.node) reader.node.notice = [notice, reader.node.notice].filter(Boolean).join('\n')
    return { reader, recovered: true }
  }
}

// An empty sectionId is an intentional homepage response, not a missing value.
export const readerRouteSectionId = (reader, requested = '') => reader.section?.sectionId ?? requested ?? ''
