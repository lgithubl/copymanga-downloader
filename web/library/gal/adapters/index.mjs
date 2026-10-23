// 适配器注册表。新增原始格式：写一个 { id, label, sniff(text), parse(text, ctx, meta) → { steps, stats }（meta = { rel, stem }：这份脚本的路径和文件名） }，在这里登记即可。
// 需要查别的文件才能解析的格式（别名表、图片目录…）再实现 contextFiles / contextDirs / prepare，见 ../context.mjs。
import { renpyMinashigoAdapter } from './renpy-minashigo.mjs'
import { renpyMonmusuAdapter } from './renpy-monmusu.mjs'
import { tenkeiprdxJsonAdapter } from './tenkeiprdx-json.mjs'
import { uviewerCsvAdapter } from './uviewer-csv.mjs'

const adapters = new Map()
export function registerGalAdapter(adapter) {
  if (!adapter?.id || typeof adapter.parse !== 'function') throw new Error('gal adapter needs id and parse()')
  adapters.set(adapter.id, adapter)
}
registerGalAdapter(uviewerCsvAdapter)
registerGalAdapter(renpyMinashigoAdapter)   // 先于 monmusu：它的 sniff 要求独有写法（$ name= / xyz "…"），monmusu 的脚本不会被它认走
registerGalAdapter(renpyMonmusuAdapter)
registerGalAdapter(tenkeiprdxJsonAdapter)

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
