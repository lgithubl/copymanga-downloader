// Gal 播放器的朗读客户端：用 gal-preload.js 的通用调度，条目 = { text, speaker, lang }（要读的文本、说话人（服务端按它选音色）、文本语言）；没有要读的位置 = null。
//   focus({ items, at })；get(key) → { state: 'ok', url, subtitle } | { state: 'skipped' } | { state: 'error', error } | null；key = ttsKey(item)
import { createPreloadClient } from './gal-preload.js'

export const ttsKey = (item) => (item && item.text ? `${item.speaker || ''}\u0000${item.lang || ''}\u0000${item.text}` : '')

export function createTtsClient({ endpoint = '/api/gal/tts', lookahead = 6, chunk = 3, ...options } = {}) {
  return createPreloadClient({ ...options, endpoint, lookahead, chunk, keyOf: ttsKey, lineOf: (item) => ({ text: item.text, speaker: item.speaker || '', lang: item.lang || '' }) })
}
