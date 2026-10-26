// 适配器注册表。新增原始格式：写一个 { id, label, sniff(text), explainSniff?(text, options) → string（可选：sniff 没认时一句话说明原因）, parse(text, ctx, meta) → { steps, stats }（meta = { rel, stem }：这份脚本的路径和文件名） }，在这里登记即可。
// 需要查别的文件才能解析的格式（别名表、图片目录…）再实现 contextFiles / contextDirs / prepare，见 ../context.mjs。
import { artwhirlJsonAdapter } from './artwhirl-json.mjs'
import { bokusenJsonAdapter } from './bokusen-json.mjs'
import { girlsCreationTagAdapter } from './girlscreation-tag.mjs'
import { grenzeXmlAdapter } from './grenze-xml.mjs'
import { misttrainJsonAdapter } from './misttrain-json.mjs'
import { otogiJsonAdapter } from './otogi-json.mjs'
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
registerGalAdapter(otogiJsonAdapter)          // Otogi Frontier R：{"Id":N,"Title":…,"MSceneDetails":[ / {"Id":N,"Description":…,"MAdultDetails":[（无扩展名的 JSON），独有写法

export const galAdapterIds = () => [...adapters.keys()]
export function galAdapter(id) {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error(`未知的 Gal 脚本适配器：${id}`)
  return adapter
}
// 适配器可选的钩子 explainSniff(text, options) → string：sniff 返回 false 时，用一句话说明「为什么不认」（比如「头 8KB 内没有 "data":{"code":…」）；
// 给列表页的 unrecognized-scripts 诊断用。没实现 = 通用的「没有匹配 sniff」；实现抛错 / 返回非字符串也退回通用说明。返回 [{ id, reason }]（只含 allowed 里的、sniff 确实没认的适配器）
export const DEFAULT_SNIFF_REASON = '没有匹配 sniff'
export function explainSniffGalAdapters(text, allowed = null, adapterOptions = null) {
  const out = []
  for (const adapter of adapters.values()) {
    if (allowed && !allowed.includes(adapter.id)) continue
    let sniffed = false
    try { sniffed = Boolean(adapter.sniff?.(text, adapterOptions?.[adapter.id])) } catch { sniffed = false }
    if (sniffed) continue
    let reason = ''
    try { reason = typeof adapter.explainSniff === 'function' ? adapter.explainSniff(text, adapterOptions?.[adapter.id]) : '' } catch { reason = '' }
    out.push({ id: adapter.id, reason: typeof reason === 'string' && reason.trim() ? reason.trim() : DEFAULT_SNIFF_REASON })
  }
  return out
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
