import {readFileSync} from 'node:fs'
import {monoHeader} from './unity-io.mjs'
import {decodeTree} from './unity-type-tree.mjs'
// Static SerializeField layouts from the collected Naninovel Runtime assembly.
// No managed code is loaded. A layout mismatch fails requireEnd, never guesses.
const TYPES=JSON.parse(readFileSync(new URL('./unity-naninovel-types.json',import.meta.url)))
const scalar=p=>p&&typeof p==='object'&&'hasValue'in p?(p.hasValue?flatten(p.value):undefined):flatten(p)
function flatten(v){if(Array.isArray(v))return v.map(flatten);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.entries(v).filter(([k])=>!['raw','spot'].includes(k)).map(([k,x])=>[k,scalar(x)]).filter(([,x])=>x!==undefined))}
export async function indexNaninovel(api){
 const{store,catalog,cfg,object,catalogResource,scripts}=api,assets=new Map(),configs={}
 for(const loc of catalog){
  if(!/^Naninovel\/(?:Characters|Backgrounds|Audio)\//.test(loc.key)||! /\.(?:png|jpe?g|ogg|mp3|wav)$/i.test(loc.internal))continue
  const ext=/\.(?:ogg|mp3|wav)$/i.test(loc.internal)?'.ogg':'.png',name=loc.key+ext,old=assets.get(loc.key)
  if(old){if(old.internal!==loc.internal)throw Error('Ambiguous Naninovel catalog key: '+loc.key);continue}
  assets.set(loc.key,{internal:loc.internal,src:catalogResource(name,loc)})
 }
 const resources=await store.asset('resources.assets')
 for(const o of resources.objects){
  if(o.classId===83){const d=await store.decode(o),name='Voice/'+d.m_Name+'.ogg';assets.set('Voice/'+d.m_Name,{src:object(name,o)});continue}
  if(o.classId!==114)continue
  const raw=await store.data(o),h=monoHeader(raw),schema=TYPES.schemas[h.name]
  if(schema)configs[h.name]=decodeTree(raw.subarray(h.r.p),schema,{references:new Map(TYPES.refs),requireEnd:true})
 }
 for(const k of Object.keys(TYPES.schemas))if(!configs[k])throw Error('Naninovel configuration missing: '+k)
 const seen=new Set()
 for(const loc of catalog.filter(l=>l.key.startsWith('Naninovel/Scripts/'))){
  if(seen.has(loc.key))continue;seen.add(loc.key)
  const o=await store.catalogAsset(loc),d=await store.decode(o)
  if(!d.playlist?.commands||!d.references?.RefIds)throw Error('Naninovel script lacks playlist/registry: '+loc.key)
  const refs=new Map(d.references.RefIds.map(r=>[String(r.rid),r])),commands=d.playlist.commands.map(p=>{
   const r=refs.get(String(p.rid));if(!r)throw Error('Naninovel command reference missing: '+p.rid)
   return{type:r.type.class,data:flatten(r.data),source:r.data.playbackSpot?.lineIndex??0}
  })
  const texts=Object.fromEntries(d.textMap.idToText.keys.map((k,i)=>[k,d.textMap.idToText.values[i]])),name=loc.key.slice('Naninovel/Scripts/'.length)
  scripts.push({name:name+'.nani',data:{format:'naninovel-script/1',name,commands,texts}})
 }
 api.context={format:'naninovel-context/1',assets:Object.fromEntries([...assets].map(([k,v])=>[k,v.src])),configs,scenes:scripts.map(s=>({name:s.data.name,script:cfg.dir+'/script/'+s.name,cg:s.data.commands.some(c=>c.type==='ModifyBackground'&&c.data.Id&&c.data.Id!=='MainBackground')}))}
}
