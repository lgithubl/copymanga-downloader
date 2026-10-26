// 适配器注册表。新增原始格式：写一个 { id, label, sniff(text), parse(text, ctx, meta) → { steps, stats }（meta = { rel, stem }：这份脚本的路径和文件名） }，在这里登记即可。
// 需要查别的文件才能解析的格式（别名表、图片目录…）再实现 contextFiles / contextDirs / prepare，见 ../context.mjs。
import { artwhirlJsonAdapter } from './artwhirl-json.mjs'
import { bokusenJsonAdapter } from './bokusen-json.mjs'
import { girlsCreationTagAdapter } from './girlscreation-tag.mjs'
import { grenzeXmlAdapter } from './grenze-xml.mjs'
import { misttrainJsonAdapter } from './misttrain-json.mjs'
import { renpyLegecloAdapter } from './renpy-legeclo.mjs'
import { renpyMinashigoAdapter } from './renpy-minashigo.mjs'
import { renpyMonmusuAdapter } from './renpy-monmusu.mjs'
import { tenkeiprdxJsonAdapter } from './tenkeiprdx-json.mjs'
import { tyranoKsAdapter } from './tyrano-ks.mjs'
import { utageBookAdapter } from './utage-book.mjs'
import { uviewerCsvAdapter } from './uviewer-csv.mjs'

const adapters = new Map()
export function registerGalAdapter(adapter) {
  if (!adapter?.id || typeof adapter.parse !== 'function') throw new Error('gal adapter needs id and parse()')
  adapters.set(adapter.id, adapter)
}
registerGalAdapter(uviewerCsvAdapter)
registerGalAdapter(renpyLegecloAdapter)     // 先于 monmusu：它的 sniff 要求 label H_xxx + $ enable_skip() / play voice，monmusu 的 label 是 h<数字>
registerGalAdapter(renpyMinashigoAdapter)   // 先于 monmusu：它的 sniff 要求独有写法（$ name= / xyz "…"），monmusu 的脚本不会被它认走
registerGalAdapter(renpyMonmusuAdapter)
registerGalAdapter(tenkeiprdxJsonAdapter)
registerGalAdapter(misttrainJsonAdapter)     // [null,[<场景 id>,[行…]]] 位置数组，独有写法
registerGalAdapter(artwhirlJsonAdapter)       // {"bgms":[…],…,"chara_keys":…} 并行数组 JSON，独有写法
registerGalAdapter(bokusenJsonAdapter)        // {"data":{"code":{…images/sounds/articles/tags/commands…}}} 编译脚本表，独有写法（只认开头，不读全文）
registerGalAdapter(tyranoKsAdapter)           // TyranoScript .ks（*start + [chara_new] / [call … tyrano.ks]），独有写法；先于 girlscreation 登记
registerGalAdapter(girlsCreationTagAdapter)   // 标签式脚本（<NAME_PLATE> / <PAUSE>），独有写法，不会和别的格式抢
registerGalAdapter(grenzeXmlAdapter)          // <easy_dialog-N id= next_id= …/> 行，独有写法，不会和别的格式抢
registerGalAdapter(utageBookAdapter)          // Utage 工作簿 JSON（importGridList + Command/Arg1 表头），独有写法

export const galAdapterIds = () => [...adapters.keys()]
export function galAdapter(id) {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error(`未知的 Gal 脚本适配器：${id}`)
  return adapter
}
// 给一段文本找适配器：返回第一个认得它的适配器 id，没有就返回 ''
// adapterOptions（可选）：config.adapterOptions，嗅探规则可配的适配器按自己的 id 取参数（sniff(text, options)）
export function sniffGalAdapter(text, allowed = null, adapterOptions = null) {
  for (const adapter of adapters.values()) {
    if (allowed && !allowed.includes(adapter.id)) continue
    if (adapter.sniff?.(text, adapterOptions?.[adapter.id])) return adapter.id
  }
  return ''
}
