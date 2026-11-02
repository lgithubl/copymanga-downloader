// Gal 播放器的翻译客户端：用 gal-preload.js 的通用调度（当前句优先 / 预加载 / 跳走撤请求 / 失败退避），条目 = 台词文本。
//   focus({ texts, at })：texts = 这个脚本按播放顺序每步的台词（没台词的步是 ''）；每句带前 contextSize 句当上文（服务端合批时用）。
//   get(text) → { state: 'ok', t } | { state: 'error', error } | null；ready(text)；whenReady(text, maxMs)；pause / destroy / available / stats，见 gal-preload.js。
import { createPreloadClient } from './gal-preload.js'

export function createTranslateClient({ contextSize = 2, endpoint = '/api/gal/translate', ...options } = {}) {
  const client = createPreloadClient({
    ...options,
    endpoint,
    keyOf: (text) => text,
    lineOf: (text, texts, i) => ({ text, ctx: texts.slice(Math.max(0, i - contextSize), i).filter(Boolean) }),
  })
  return { ...client, focus: ({ texts, at }) => client.focus({ items: texts, at }), get available() { return client.available } }
}
