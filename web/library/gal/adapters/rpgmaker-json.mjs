import{hakuboxInteraction}from'./rpgmaker-hakubox-interaction.mjs'
import{prepareHakubox}from'./rpgmaker-hakubox.mjs'
import {prepareKoakumaAnimation,parseKoakumaGallery} from './rpgmaker-koakuma-animation.mjs'
import {prepareLocalization} from './rpgmaker-localization.mjs'
import {prepareActionSequences,parseActionGallery} from './rpgmaker-action-sequence.mjs'
import {prepareRecollection,recollectionCatalog} from './rpgmaker-recollection.mjs'
import {prepareRpgLive2d} from './rpgmaker-live2d.mjs'
import {memoryEntries,memoryTargets} from './rpgmaker-memory.mjs'
import {prepareSkit} from './rpgmaker-skit.mjs'
import {prepareTemplates} from './rpgmaker-templates.mjs'
import { completeJsonSamples } from '../context-complete-json.mjs'
import { pluginData, eventEvidence, mapEventCall } from './rpgmaker-plugins.mjs'
// RPG Maker MV/MZ event JSON -> gal-scene. Engine mechanics live here; each
// game's naming, gallery/image matching and plugin overrides live in options.
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createOptionsReader, safeRegex, cleanDir } from './options-merge.mjs'
import { compileRpgEvents } from './rpgmaker-events.mjs'

export const ADAPTER_ID = 'rpgmaker-json'
export const DEFAULT_OPTIONS = {
  root: '', packedExe: '', extraDirs: [], stage: [816, 624], maxCommands: 100000, maxCallDepth: 32,
  initialVariables: {}, initialSwitches: {},
  effects: { shake: true },
  localization: { language: '' },
  party: { mode: 'initial', members: null },
  actors: { states: {} },
  skit: { expressionPoses: {}, wrapperScripts: false },
  maps: { enabled: true, tileSize: 48, player: true, follow: 'event', maxBytes: 134217728 },
  catalog: { common: true, maps: true, minText: 2, skipNames: '^$' },
  special: { enabled: true, label: '特殊场景', voiced: false, minText: 4, deduplicateCalls: true, preferMapCallers: false, nameMatch: '回想|回憶|recollection|replay|h[-_ ]?scene|(?:エロ|エッチ|お触り).*?(?:イベント|シーン)|シーン再生', skipNameMatch: '削除|初期化|準備|非表示|エフェクト|並列|吐息|擬音|判断|UI|ボタン', mapNameMatch: '回想|回憶|recollection|replay', imageMatch: '(^|/)(?:[0-9]+_)?(?:hcg|cg|ev|event|ero_event|ero_scene|touching_scene)[_/-]' },
  pictures: { folder: 'img/pictures', cgMatch: '(^|/)(?:[0-9]+_)?(?:hcg|cg|ev|event|ero_event|ero_scene|touching_scene)[_/-]', backgroundMatch: '(^|/)(bg|background)[_-]', thumbnailMatch: '.', thumbnailSkip: '(^|/)(button|btn|cursor|icon|window|balloon|loading)([_./]|$)' },
  plugins: { memoryReplay: false, skipCommonEventNames: '', simpleVoice: true, standingPicture: true, pictureCalls: true, structured: true, pictureActions: true, maxPictureActions: 16, seVoiceMatch: '', meVoiceMatch: '', koakumaAnimation: {enabled:false,data:'js/plugins/fm001_Koakuma_Data.js'}, trnVoice: { enabled: false, list: 'audio/voice/voice_list.json', folder: 'audio/voice/unique' }, commands: [] },
}
export const optionsOf = createOptionsReader(DEFAULT_OPTIONS)
const join = (...s) => s.filter(Boolean).join('/')
const rootOf = o => cleanDir(o?.root)
const decodeJson = s => JSON.parse(String(s).replace(/^\uFEFF/, ''))
export const contextFiles = o => ['data/System.json', 'data/Actors.json', 'data/CommonEvents.json', 'data/MapInfos.json', 'data/Tilesets.json', 'js/plugins.js', ...(o?.plugins?.trnVoice?.enabled ? [o.plugins.trnVoice.list] : []), ...(o?.plugins?.koakumaAnimation?.enabled ? [o.plugins.koakumaAnimation.data] : [])].map(p => join(rootOf(o), p))
export const contextDirs = o => [...new Set(['data', 'img', 'audio', 'Audio', 'locales', 'Assets', 'assets', ...(o?.extraDirs || [])])].map(p => join(rootOf(o), p))
export const contextWalkLimit = 400000

export function sniff(text) {
  const head = String(text).replace(/^\uFEFF/, '').slice(0, 8192)
  return /^\s*\[\s*null\s*,\s*\{\s*"id"/.test(head) && /"list"\s*:\s*\[/.test(head)
    || /^\s*\{/.test(head) && /"autoplayBgm"\s*:/.test(head) && /"(?:parallaxName|scrollType)"\s*:/.test(head)
}

export async function prepare({ options, texts, files, toResourcePath, mediaDir, assetDir = mediaDir, truncated }) {
  const o = optionsOf(options), root = rootOf(o)
  if (mediaDir) { const wanted = new Set(contextFiles(o).filter(p => p.endsWith('.json'))); texts = await completeJsonSamples({texts, files: [...new Set([...(files || []), ...wanted])], mediaDir}, rel => wanted.has(rel)) }
  const get = rel => texts[join(root, rel)] || ''
  const read = (rel, fallback) => { const value=get(rel); if(!value)return fallback; try { return decodeJson(value) } catch { throw Error('RPG Maker JSON无法完整解析: '+join(root,rel)) } }
  const common = read('data/CommonEvents.json', []), system = read('data/System.json', {}), actors = read('data/Actors.json', []), mapInfo = read('data/MapInfos.json', [])
  let plugins = []
  try { const txt = get('js/plugins.js'); plugins = decodeJson(txt.slice(txt.indexOf('[')).trim().replace(/;\s*$/, '')) } catch { /* diagnose below */ }
  if (!Array.isArray(plugins)) plugins = []
  if (!Array.isArray(common)) throw new Error('RPG Maker CommonEvents.json 必须是公共事件数组')
  const enabled = plugins.filter(p => p?.status === true)
  const ctx = { options: o, common, system, actors, mapInfo, tilesets: read('data/Tilesets.json', []), plugins: enabled, maps: new Map(), files: new Set((files || []).map(toResourcePath || (x => x))), warnings: [], evidenceCache: new WeakMap(), evidenceBusy: new Set() }
  if (truncated) ctx.warnings.push('资源索引达到上限，部分资源未收录')
  if (get('js/plugins.js') && !plugins.length) ctx.warnings.push('plugins.js 不是可解析的插件 JSON 配置；没有执行游戏 JS')
  await prepareHakubox(ctx,{mediaDir:assetDir||mediaDir,root})
  ctx.localize=await prepareLocalization({plugins:enabled,options:o,files:files||[],texts,mediaDir,root,warnings:ctx.warnings})
  for(const row of [system,...actors,...mapInfo,...common].filter(Boolean))for(const key of ['name','gameTitle','displayName'])if(typeof row[key]==='string')row[key]=ctx.localize(row[key])
  ctx.skipCommonEvent=safeRegex(o.plugins.skipCommonEventNames)
  ctx.meVoiceMatch=safeRegex(o.plugins.meVoiceMatch)
  ctx.standing = new Map()
  const voice = enabled.find(p => p.name === 'SimpleVoice')
  ctx.voiceFolder = 'audio/' + String(voice?.parameters?.FolderName || voice?.parameters?.['フォルダ名'] || (Boolean(system.advanced) ? 'se' : 'voice')).replace(/^\/+|\/+$/g, '')
  const standing = enabled.find(p => ['LL_StandingPictureMV','MIP_StandingPicture'].includes(p.name))
  if(standing&&o.plugins.standingPicture){
    const rows=pluginData(ctx,standing.name,'sPictures')
    if(!rows.length&&standing.parameters.sPictures&&!/^\s*\[\s*\]\s*$/.test(standing.parameters.sPictures))ctx.warnings.push(standing.name+' 的 sPictures 配置无法解析或为空')
    for(const item of rows)if(item?.id)ctx.standing.set(String(item.id),item)
  }
  const sizePlugin = [...enabled].reverse().map(p => {
    if(p.name==='YEP_CoreEngine')return [p.parameters?.['Screen Width']||p.parameters?.['屏幕宽度'],p.parameters?.['Screen Height']||p.parameters?.['屏幕高度']]
    return [p.parameters?.screenWidth,p.parameters?.screenHeight]
  }).find(a=>a.every(v=>Number(v)>0))
  ctx.stage = [Number(system.advanced?.screenWidth || sizePlugin?.[0] || o.stage[0]), Number(system.advanced?.screenHeight || sizePlugin?.[1] || o.stage[1])]
  ctx.stage = ctx.stage.map((n, i) => Math.max(1, Math.min(8192, Number.isFinite(n) && n > 0 ? n : DEFAULT_OPTIONS.stage[i])))
  ctx.trnVoiceIds=new Set(o.plugins.trnVoice.enabled?(read(o.plugins.trnVoice.list,{}).uniqueIds||[]).map(Number):[])
  ctx.skit=await prepareSkit(ctx,{mediaDir:assetDir,files:files||[],root})
  let bytes = 0
  const maxMapBytes=Math.min(256*1024*1024,Math.max(16*1024*1024,Number(o.maps.maxBytes)||134217728))
  for (const rel of files || []) {
    if (!rel.startsWith(join(root, 'data') + '/') || !/\/Map\d+\.json$/i.test(rel)) continue
    try {
      if (mediaDir && (await stat(path.join(mediaDir, ...rel.split('/')))).size > 16 * 1024 * 1024) { ctx.warnings.push(`地图超过16MB上限: ${rel}`); continue }
      const text = texts[rel] || (mediaDir ? await readFile(path.join(mediaDir, ...rel.split('/')), 'utf8') : '')
      bytes += Buffer.byteLength(text)
      if (bytes > maxMapBytes) { ctx.warnings.push('地图 JSON 超过'+Math.round(maxMapBytes/1024/1024)+'MB上下文上限，后续地图未读取'); break }
      const map = decodeJson(text)
      if (Array.isArray(map.events)) ctx.maps.set(rel, map)
    } catch { ctx.warnings.push(`地图无法读取: ${rel}`) }
  }
  await prepareRecollection(ctx,{texts,mediaDir,root})
  ctx.loopAnimations=new Map(pluginData(ctx,'LL_LoopAnimation','animations').map(r=>[r.id,r]))
  prepareRpgLive2d(ctx)
  prepareTemplates(ctx)
  ctx.memoryReplays = new Map()
  ctx.catalogTree = buildCatalog(ctx)
  if(ctx.plugins?.some(p=>p.name==='Hakubox_Core')&&ctx.common[302]?.name?.startsWith('涩涩动作:'))ctx.catalogTree.children.push({id:'interaction',title:'角色互动',children:[{id:'hakubox',title:'加奈 · 房间 / 冒险互动',script:join(root,'data/CommonEvents.json')+'::hakubox-interaction'}]})
  const recollection=recollectionCatalog(ctx)
  if(recollection&&o.special.enabled)ctx.catalogTree.children=[recollection,...ctx.catalogTree.children.filter(n=>n.id!=='special')]
  prepareActionSequences(ctx)
  ctx.koakumaAnimation=await prepareKoakumaAnimation(ctx,{texts,mediaDir,root})
  await refreshVoicedCatalog(ctx)
  return ctx
}

function evidence(list, ctx, seen = new Set(), mapId = 0) {
  const pluginEvidence = eventEvidence(list)
  let text = pluginEvidence.text; const pictures = [...pluginEvidence.pictures], calls = new Set(pluginEvidence.calls)
  if (!Array.isArray(list)) return { text, pictures, calls }
  if (ctx.evidenceCache.get(list)?.has(mapId)) return ctx.evidenceCache.get(list).get(mapId)
  if (ctx.evidenceBusy.has(list)) return { text, pictures, calls }
  if (seen.size > 32) return { text, pictures, calls }
  ctx.evidenceBusy.add(list)
  let activeMap=mapId
  const merge=inner=>{text+=inner.text;pictures.push(...inner.pictures);for(const id of inner.calls)calls.add(id)}
  for (const c of list || []) {
    if(c.code===201&&c.parameters?.[0]===0){
      activeMap=Number(c.parameters[1]);const key=`autorun:${activeMap}`,target=ctx.maps.get(join(rootOf(ctx.options),'data',`Map${String(activeMap).padStart(3,'0')}.json`))
      const events=(target?.events||[]).filter(Boolean)
      if(!seen.has(key)&&events.length===1&&events[0].pages?.length===1&&events[0].pages[0].trigger===3)merge(evidence(events[0].pages[0].list,ctx,new Set([...seen,key]),activeMap))
    }
    const mapCall=mapEventCall(c)
    if(mapCall!==null){const key=`map:${activeMap}:${mapCall}`,target=ctx.maps.get(join(rootOf(ctx.options),'data',`Map${String(activeMap).padStart(3,'0')}.json`))?.events?.find(e=>e?.id===mapCall);if(!seen.has(key))for(const page of target?.pages||[])merge(evidence(page.list,ctx,new Set([...seen,key]),activeMap))}
    if(c.code===357&&c.parameters?.[0]==='LL_LoopAnimation'&&['playAnimation','clippingAnimation'].includes(c.parameters?.[1])){const row=ctx.loopAnimations.get(c.parameters?.[3]?.id),name=String(row?.animationFrames||'').split(/\r?\n/).find(Boolean)?.split(',')[0];if(name)pictures.push('img/ll_loopanimation/'+name+'.png')}
    if (c.code === 401) text++
    if (c.code === 231) pictures.push(String(c.parameters?.[1] || ''))
    if(c.code===284&&c.parameters?.[0])pictures.push('img/parallaxes/'+String(c.parameters[0])+'.png')
    if (c.code === 355 || c.code === 655) for (const m of String(c.parameters?.[0] || '').matchAll(/\$gameScreen\.showPicture\(\s*\d+\s*,\s*["']([^"']+)["']/g)) pictures.push(m[1])
    if (c.code === 117) {
      const id = Number(c.parameters?.[0]);if(ctx.skipCommonEvent?.test(String(ctx.common[id]?.name||''))){calls.delete(id);continue} calls.add(id)
      if (seen.has(id)) continue
      const inner = evidence(ctx.common[id]?.list, ctx, new Set([...seen, id]),activeMap)
      text += inner.text; pictures.push(...inner.pictures); for (const v of inner.calls) calls.add(v)
    }
  }
  const result = { text, pictures: [...new Set(pictures)], calls }
  ctx.evidenceBusy.delete(list);if(!ctx.evidenceCache.has(list))ctx.evidenceCache.set(list,new Map());ctx.evidenceCache.get(list).set(mapId,result)
  return result
}

function buildCatalog(ctx) {
  const o = ctx.options, commonNodes = [], mapNodes = [], specials = new Map(), galleryCalls = new Set(), contextualCalls = new Set()
  const nameMatch = safeRegex(o.special.nameMatch), mapMatch = safeRegex(o.special.mapNameMatch), imageMatch = safeRegex(o.special.imageMatch), skip = safeRegex(o.catalog.skipNames)
  const specialSkip = safeRegex(o.special.skipNameMatch)
  const special = (name, ev) => !specialSkip?.test(name) && Boolean(nameMatch?.test(name) || ev.pictures.some(p => imageMatch?.test(p) || imageMatch?.test(`img/pictures/${p}`)))
  if (o.catalog.maps) for (const [rel, map] of ctx.maps) {
    const id = Number(/Map(\d+)\.json$/i.exec(rel)?.[1]), title = ctx.mapInfo[id]?.name || `Map ${id}`, children = []
    for (const event of map.events.filter(Boolean)) for (const [pi, page] of (event.pages || []).entries()) {
      const ev = evidence(page.list, ctx, new Set(),id), titleEvent = event.name || `Event ${event.id}`
      if(o.plugins.memoryReplay&&ctx.plugins.some(p=>p.name==='inazuma/Memory'))for(const entry of memoryEntries(page.list)){
        const script=`${rel}::event-${event.id}-${pi+1}-replay-${entry.index}`,targets=memoryTargets(ctx,entry)
        const label=entry.label.replace(/\\TRN\[\d+\]/g,'').replace(/if\(s\[\d+\]\)/g,'').replace(/\\n\[(\d+)\]/gi,(_,id)=>ctx.actors[id]?.name||`Actor ${id}`)
        const node={id:`memory-${id}-${event.id}-${pi+1}-${entry.index}`,title:`${titleEvent}${label?' · '+label:''}`,subtitle:targets.length?`${targets.map(e=>e.name).join(' / ')} · 回想入口`:'回想入口（接续待诊断）',script}
        ctx.memoryReplays.set(script,entry);children.push(node);specials.set(script,{...node,id:'special-'+node.id})
      }
      if (ev.text < o.catalog.minText || skip?.test(titleEvent)) continue
      const node = { id: `map-${id}-event-${event.id}-page-${pi + 1}`, title: `${titleEvent}${event.pages.length > 1 ? ` · 页${pi + 1}` : ''}`, subtitle: `${ev.text} 文本行`, script: `${rel}::event-${event.id}-${pi + 1}` }
      children.push(node)
      if (ev.text >= o.special.minText && (mapMatch?.test(title) || special(titleEvent, ev))) {
        const directPictures=page.list.some(c=>c.code===231)
        const wrapper = !directPictures && !page.list.some(c=>mapEventCall(c)!==null) && o.special.deduplicateCalls && o.catalog.common && page.list.filter(c => c.code === 401).length <= 3 && [...ev.calls].some(id => {
          const target = ctx.common[id]
          return target && !skip?.test(target.name || '') && evidence(target.list, ctx).text >= Math.max(o.special.minText, o.catalog.minText)
        })
        if (!wrapper) {specials.set(node.script, { ...node, id: `special-${node.id}`, subtitle: `${title} · ${node.subtitle}` });if(directPictures&&o.special.preferMapCallers)for(const call of ev.calls)contextualCalls.add(call)}
        if (mapMatch?.test(title)) for (const call of ev.calls) galleryCalls.add(call)
      }
    }
    if (children.length) mapNodes.push({ id: `map-${id}`, title, children })
  }
  if (o.catalog.common) for (const event of ctx.common.filter(Boolean)) {
    if(ctx.skipCommonEvent?.test(String(event.name||'')))continue
    const ev = evidence(event.list, ctx, new Set([event.id])), name = event.name || `Common ${event.id}`
    if (ev.text < o.catalog.minText || skip?.test(name)) continue
    const node = { id: `common-${event.id}`, title: name, subtitle: `${ev.text} 文本行`, script: `${join(rootOf(o), 'data/CommonEvents.json')}::common-${event.id}` }
    commonNodes.push(node)
    const wrapper = o.special.deduplicateCalls && event.list.filter(c=>c.code===401||c.code===357&&((c.parameters?.[0]==='LogDisplayPlugin'&&['setNewText','addToText'].includes(c.parameters?.[1]))||(c.parameters?.[0]==='LogMessage'&&c.parameters?.[1]==='add'))).length < o.special.minText && [...ev.calls].some(id=>ctx.common[id]&&evidence(ctx.common[id].list,ctx).text>=o.special.minText)
    if (!wrapper && !contextualCalls.has(event.id) && ev.text >= o.special.minText && (galleryCalls.has(event.id) || special(name, ev))) specials.set(node.script, { ...node, id: `special-${node.id}` })
  }
  return { title: ctx.system.gameTitle || 'RPG Maker', children: [
    ...(o.special.enabled && specials.size ? [{ id: 'special', title: o.special.label, children: [...specials.values()] }] : []),
    ...(commonNodes.length ? [{ id: 'common', title: '公共事件', children: commonNodes }] : []),
    ...(mapNodes.length ? [{ id: 'maps', title: '地图事件', children: mapNodes }] : []),
  ] }
}

// Use the playback compiler's own audio routing and call expansion. This keeps
// native plugins, conditional branches and configured gameplay exclusions aligned
// with the scene instead of maintaining a second plugin parser for card counts.
// Unite calls this after installing its native command compiler, before packet paths
// replace the normalized RPG paths. The optional resolver restores replay context.
export async function refreshVoicedCatalog(ctx, parseScene = (node, context) => {
  const [rel, scene] = node.script.split('::')
  return parse('', context, {rel, scene})
}) {
  const tree = ctx.catalogTree
  if (!tree) return
  tree.children = tree.children.filter(node => node.id !== 'special-voiced')
  if (!ctx.options.special.enabled || !ctx.options.special.voiced) return
  // Map painting is irrelevant to dialogue counts; logical transfers/calls still run.
  const context = {...ctx, options: {...ctx.options, maps: {...ctx.options.maps, enabled: false}}}
  const voiced = []
  let visited = 0
  const visit = async node => {
    if (++visited % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    if (node.script) {
      try {
        const scene = parseScene(node, context), resources = new Set()
        for (const step of scene.steps) for (const command of step.commands) {
          if (command.op !== 'voice' && !(command.op === 'bgvoice' && command.loop === false && command.kind === 'voice')) continue
          const src = command.src
          if (typeof src !== 'string') continue
          const candidates = [src, src.replace(/\.ogg$/i, '.rpgmvo'), src.replace(/\.ogg$/i, '.ogg_')]
          if (candidates.some(file => ctx.files.has(file) || ctx.files.has(join(rootOf(ctx.options), file)))) resources.add(src)
        }
        if (resources.size) voiced.push({...node, id: 'voiced-' + node.id, subtitle: `${node.subtitle || ''} · 全分支去重：${resources.size} 个对白配音资源`})
      } catch (error) {
        ctx.warnings.push(`对白配音资源统计失败: ${node.script}: ${error.message}`)
      }
    }
    for (const child of node.children || []) await visit(child)
  }
  for (const node of tree.children.filter(node => node.id === 'special')) await visit(node)
  if (voiced.length) tree.children.unshift({id: 'special-voiced', title: '特殊场景（有配音）', children: voiced})
}

export function parse(text, ctx, meta = {}) {
  const data = /(^|\/)CommonEvents\.json$/i.test(meta.rel || '') && ctx?.common?.length ? ctx.common : (ctx?.maps?.get(meta.sourceRel || meta.rel) || decodeJson(text)), o = optionsOf(meta.options || ctx?.options)
  const scene = String(meta.scene || '')
  if(scene==='hakubox-interaction')return hakuboxInteraction(ctx)
  const nativeAnimation=/^koakuma-animation-(\d{4})$/.exec(scene),koakuma=nativeAnimation&&ctx?.koakumaAnimation?.families.get(nativeAnimation[1])
  if(koakuma)return parseKoakumaGallery(koakuma,ctx)
  const action=ctx?.actionGalleries?.get(`${meta.sourceRel||meta.rel}::${scene}`)
  if(action)return parseActionGallery(action,ctx,meta)
  const replay=ctx?.memoryReplays?.get(`${meta.sourceRel||meta.rel}::${scene}`)
  if(replay){
    const selected=/^event-(\d+)-(\d+)-replay-/.exec(scene)
    return compileRpgEvents(replay.commands,ctx,{...meta,options:o,eventId:Number(selected[1]),pageIndex:Number(selected[2])-1,memoryReplay:replay})
  }

  let list, pageConditions = null, eventId = 0, map = null, pageIndex = -1
  if (Array.isArray(data)) {
    const id = /^common-(\d+)$/.exec(scene)?.[1]
    if (!id || !Array.isArray(data[Number(id)]?.list)) throw new Error('请选择一个公共事件，不能将全部事件按ID串联')
    list = data[Number(id)].list; eventId = Number(id)
  } else if (Array.isArray(data.events)) {
    const selected = /^event-(\d+)-(\d+)$/.exec(scene)
    const event = selected && data.events.find(e => e?.id === Number(selected[1])), page = event?.pages?.[Number(selected[2]) - 1]
    if (!page?.list) throw new Error('请选择具体地图事件及页码')
    list = page.list; pageConditions = page.conditions; eventId = event.id; pageIndex = Number(selected[2]) - 1
    map = data
  } else throw new Error('不是 RPG Maker 事件文件')
  return compileRpgEvents(list, ctx || { common: data, actors: [], standing: new Map(), options: o, stage: o.stage, warnings: [] }, { ...meta, options: o, nativeRecollection:Boolean(ctx?.recollection?.has(eventId)&&Array.isArray(data)), pageConditions, eventId, pageIndex, map })
}

// The context already owns the decoded event database, keyed by file mtime.
// A scene card need not reread/decode the same38MB file for every event.
export function contextScriptText(ctx,meta){return (/CommonEvents\.json$/i.test(meta.rel||'')&&/^(?:common-[0-9]+|koakuma-animation-[0-9]{4})$/.test(meta.scene||'')&&ctx?.common?.length)||ctx?.maps?.has(meta.sourceRel || meta.rel)?'':null}
export const rpgMakerJsonAdapter = { id: ADAPTER_ID, label: 'RPG Maker MV/MZ 事件', sniff, parse, prepare, contextScriptText, contextFiles, contextDirs, contextWalkLimit, sceneInPath: true, sceneThumbs: true, catalog: ctx => ctx?.catalogTree, health: ctx => (ctx?.warnings || []).map(message => ({ level: 'warn', code: 'rpgmaker-context', message })) }
