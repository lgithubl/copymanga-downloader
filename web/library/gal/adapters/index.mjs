// 适配器注册表。新增原始格式：写一个 { id, label, sniff(text), parse(text) → { steps, stats } }，在这里登记即可。
import { uviewerCsvAdapter } from './uviewer-csv.mjs'

const adapters = new Map()
export function registerGalAdapter(adapter) {
  if (!adapter?.id || typeof adapter.parse !== 'function') throw new Error('gal adapter needs id and parse()')
  adapters.set(adapter.id, adapter)
}
registerGalAdapter(uviewerCsvAdapter)

export const galAdapterIds = () => [...adapters.keys()]
export function galAdapter(id) {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error(`未知的 Gal 脚本适配器：${id}`)
  return adapter
}
// 给一段文本找适配器：返回第一个认得它的适配器 id，没有就返回 ''
export function sniffGalAdapter(text, allowed = null) {
  for (const adapter of adapters.values()) {
    if (allowed && !allowed.includes(adapter.id)) continue
    if (adapter.sniff?.(text)) return adapter.id
  }
  return ''
}
