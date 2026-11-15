import {readFileSync} from 'node:fs'
import {monoHeader} from './unity-io.mjs'
import {decodeTree} from './unity-type-tree.mjs'
// Static SerializeField layouts from the collected Naninovel Runtime assembly.
// No managed code is loaded. A layout mismatch fails requireEnd, never guesses.
const TYPES=JSON.parse(readFileSync(new URL('./unity-naninovel-types.json',import.meta.url)))
const RESOURCE_TYPES=JSON.parse(readFileSync(new URL('./unity-naninovel-resources-types.json',import.meta.url)))
const scalar=p=>p&&typeof p==='object'&&'hasValue'in p?(p.hasValue?flatten(p.value):undefined):flatten(p)
function flatten(v){if(Array.isArray(v))return v.map(scalar);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.entries(v).filter(([k])=>!['raw','spot'].includes(k)).map(([k,x])=>[k,scalar(x)]).filter(([,x])=>x!==undefined))}
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
 const appendScript=(d,name)=>{
  if(!d.playlist?.commands||!d.references?.RefIds)throw Error('Naninovel script lacks playlist/registry: '+name)
  const refs=new Map(d.references.RefIds.map(r=>[String(r.rid),r])),commands=d.playlist.commands.map(p=>{
   const r=refs.get(String(p?.rid??p));if(!r)throw Error('Naninovel command reference missing: '+JSON.stringify(p))
   return{type:r.type.class,data:flatten(r.data),source:r.data.playbackSpot?.lineIndex??0}
  }),labels=(d.lines||[]).map(p=>refs.get(String(p?.rid??p))).filter(r=>r?.type.class==='LabelLine').map(r=>({type:'Label',data:flatten(r.data),source:r.data.lineIndex}))
  const texts=Object.fromEntries(d.textMap.idToText.keys.map((k,i)=>[k,d.textMap.idToText.values[i]]))
  scripts.push({name:name+'.nani',data:{format:'naninovel-script/1',name,commands:labels.length?[...commands,...labels].sort((a,b)=>a.source-b.source):commands,texts}})
 }
 const seen=new Set();let resourcesBuild=false
 for(const loc of catalog.filter(l=>l.key.startsWith('Naninovel/Scripts/'))){
  if(seen.has(loc.key))continue;seen.add(loc.key)
  const o=await store.catalogAsset(loc),d=await store.decode(o)
  appendScript(d,loc.key.slice('Naninovel/Scripts/'.length))
 }
 // Resources builds publish lowercase Unity paths and canonical case in Assets.
 // Prefer the Sprite subasset to its Texture2D so cropped sprites retain pivots.
 if(!scripts.length){
  resourcesBuild=true
  const paths=await store.resourcePaths(),table=paths.find(p=>p.name==='naninovel/assets'&&p.object.classId===49)
  if(!table)throw Error('Naninovel Resources asset registry missing')
  const registry=JSON.parse((await store.decode(table.object)).text),canonical=new Map()
  for(const row of registry.Assets||[]){const key='Naninovel/'+row.prefix+'/'+row.path;canonical.set(key.toLowerCase(),key)}
  for(const row of paths.filter(p=>p.object.classId===114)){
   const raw=await store.data(row.object),h=monoHeader(raw);if(h.name!=='ProjectResources')continue
   const d=decodeTree(raw.subarray(h.r.p),RESOURCE_TYPES.schemas.ProjectResources,{requireEnd:true})
   for(const name of d.paths){const key='Naninovel/'+name;canonical.set(key.toLowerCase(),key)}
  }
  const gallery=[]
  for(const o of resources.objects.filter(o=>o.classId===114)){
   if(await store.type(o).catch(()=>null)!=='RecollectionButton')continue
   const raw=await store.data(o),h=monoHeader(raw)
   gallery.push(decodeTree(raw.subarray(h.r.p),RESOURCE_TYPES.schemas.RecollectionButton,{requireEnd:true}))
  }
  for(const row of paths){
   const key=canonical.get(row.name.toLowerCase()),o=row.object;if(!key)continue
   if(/^Naninovel\/(?:Characters|Backgrounds|Audio|Voice)\//.test(key)&&[28,213,83].includes(o.classId)){
    const ext=o.classId===83?'.ogg':'.png',prior=assets.get(key)
    if(!prior||o.classId===213)assets.set(key,{src:object(key+(prior?'.sprite':'')+ext,o)})
   }
   if(key.startsWith('Naninovel/Scripts/')){
    if(o.classId!==114)throw Error('Naninovel Resources script is not MonoBehaviour: '+key)
    const raw=await store.data(o),h=monoHeader(raw),d=decodeTree(raw.subarray(h.r.p),RESOURCE_TYPES.schemas.Script,{references:new Map(RESOURCE_TYPES.refs),requireEnd:true})
    appendScript(d,key.slice('Naninovel/Scripts/'.length))
   }
  }
  const original=new Map(scripts.map(s=>[s.data.name,s]))
  for(const row of gallery){
   const source=original.get(row.scriptName);if(!source)throw Error('Naninovel replay script missing: '+row.scriptName)
   if(!source.data.commands.some(c=>c.type==='Label'&&c.data.labelText===row.labelName))throw Error('Naninovel replay label missing: '+row.scriptName+'#'+row.labelName)
   scripts.push({name:'replay/'+row.unlockableId+'.nani',data:{...source.data,entryLabel:row.labelName,replay:true,title:row.unlockableId}})
  }
  // Materialize real cross-script label destinations, not a literal '#label.nani'.
  const targets=new Set([...original.values()].flatMap(s=>s.data.commands.filter(c=>c.type==='Goto').map(c=>c.data.Path)).filter(p=>p?.includes('#')&&!p.startsWith('#')&&!p.endsWith('#start')))
  for(const target of targets){const[name,label]=target.split('#'),source=original.get(name);if(!source||!source.data.commands.some(c=>c.type==='Label'&&c.data.labelText===label))throw Error('Naninovel cross-script label missing: '+target);scripts.push({name:'label--'+name+'--'+label+'.nani',data:{...source.data,entryLabel:label,title:target}})}
 }
 api.context={format:'naninovel-context/1',...(resourcesBuild?{resourcesBuild:true}:{}),assets:Object.fromEntries([...assets].map(([k,v])=>[k,v.src])),configs,scenes:scripts.map(s=>({name:s.data.title||s.data.name,script:cfg.dir+'/script/'+s.name,cg:s.data.replay||!resourcesBuild&&s.data.commands.some(c=>c.type==='ModifyBackground'&&c.data.Id&&c.data.Id!=='MainBackground')}))}
}
