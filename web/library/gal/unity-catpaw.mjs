import{readFileSync}from'node:fs'
import{decodeTree}from'./unity-type-tree.mjs'
const ANIMATION_TYPES=JSON.parse(readFileSync(new URL('./unity-2022-animation-types.json',import.meta.url)))
import{unityTransformPrefix,unityUiImagePrefix}from'./unity-scene.mjs'
import path from'node:path'
import{UnityReader,readTextObject,monoHeader}from'./unity-io.mjs'
import{readI2Source}from'./unity-i2.mjs'
const lower=s=>String(s||'').replace(/\\/g,'/').toLowerCase(),join=(a,b)=>path.posix.normalize(path.posix.join(path.posix.dirname(a),b))
export async function indexCatpaw(api){
 const{store,object,add,json,scripts}=api,a=await store.asset('globalgamemanagers'),r=new UnityReader(await store.data(a.objects.find(o=>o.classId===147))),rows=r.list(()=>({name:r.str(),ptr:r.ptr()})),entries=new Map(),configs={},media={},models={},prefabs={},locales=[]
 for(const row of rows){if(!row.name.startsWith('future/'))continue;const o=await store.ptr(a,row.ptr);if(!o)continue;const key=lower(row.name);if(!entries.has(key))entries.set(key,[]);if(!entries.get(key).some(x=>x.o.asset===o.asset&&x.o.pathId===o.pathId))entries.get(key).push({name:row.name,o})}
 const pick=(key,classes)=>{const hits=(entries.get(lower(key))||[]).filter(x=>classes.includes(x.o.classId));return hits.find(x=>x.o.classId===213)||hits[0]},put=(key,src)=>{media[lower(key)]=src;return src}
 for(const[key,hits]of entries){
  const image=pick(key,[28,213]),audio=pick(key,[83]),text=pick(key,[49]);if(image)put(key,object('Media/'+key+'.png',image.o));if(audio)put(key,object('Audio/'+key+'.ogg',audio.o))
  if(text){const d=readTextObject(await store.data(text.o));if(/config$/i.test(d.name)){const table=JSON.parse(d.text.replace(/^\uFEFF/,''));if(configs[d.name])throw Error('CatPaw duplicate config: '+d.name);configs[d.name]=table}}
 }
 for(const key of ['talkConfig','recallConfig','eventConfig'])if(!configs[key])throw Error('CatPaw required native table absent: '+key)
 for(const[key,hits]of entries){if(!key.startsWith('future/talkbackground/'))continue;const go=hits.find(h=>h.o.classId===1)?.o;if(!go)continue;const d=await store.decode(go),images=[];for(const c of d.m_Component){const o=await store.ptr(go.asset,c.component);if(o?.classId!==114||await store.type(o)!=='Image')continue;const ui=unityUiImagePrefix(await store.data(o)),sprite=await store.ptr(o.asset,ui.sprite);if(sprite?.classId===213&&ui.color.a>0)images.push(sprite)}if(images.length===1)put(key,object('Backgrounds/'+key+'.png',images[0]))}
 // Original model3 files explicitly declare every atlas and motion. This also
 // handles multi-atlas models; no renderer-order or similar-name matching.
 const mocModels=new Map(),modelDocs=new Map(),virtualFiles=new Map(),clipPaths=new Map()
 for(const[key,hits]of entries)for(const hit of hits)if(hit.o.classId===74)clipPaths.set(hit.o.asset.file+':'+hit.o.pathId,key)
 for(const[key,hits]of entries){if(!key.endsWith('.model3'))continue;const text=pick(key,[49]);if(!text)continue;const d=JSON.parse(readTextObject(await store.data(text.o)).text),refs=d.FileReferences;if(!refs?.Moc||!Array.isArray(refs.Textures))throw Error('CatPaw model3 references missing: '+key)
  const file=(name,kind)=>{const native=join(key,name),without=native.replace(/\.(?:moc3|png|json)$/i,''),hit=pick(native,kind==='texture'?[28]:kind==='moc'?[114]:[49])||pick(without,kind==='texture'?[28]:kind==='moc'?[114]:[49]);if(!hit)throw Error('CatPaw model reference missing: '+native);let src
   if(virtualFiles.has(native))return virtualFiles.get(native)
   if(kind==='texture')src=object('ModelTextures/'+native.replace(/\.(?:png|jpe?g)$/i,'')+'.png',hit.o)
   else if(kind==='moc'){src=add('Native/'+native,{file:hit.o.asset.file,offset:hit.o.offset,size:hit.o.size},async()=>{const h=monoHeader(await store.data(hit.o));const bytes=h.r.bytes();h.r.end();return bytes});mocModels.set(hit.o.asset.file+':'+hit.o.pathId,key)}
   else src=add('Native/'+native,{file:hit.o.asset.file,offset:hit.o.offset,size:hit.o.size},async()=>readTextObject(await store.data(hit.o)).bytes)
   virtualFiles.set(native,src);return src
  }
  // References are relative to the virtual model file, including native case.
  const base=api.cfg.dir+'/res/',relative=src=>path.posix.relative(base,src)
  const clone=structuredClone(d);clone.FileReferences.Motions||={};clone.FileReferences.Moc=relative(file(refs.Moc,'moc'));clone.FileReferences.Textures=refs.Textures.map(n=>relative(file(n,'texture')))
  for(const[k,v]of Object.entries(refs.Motions||{}))clone.FileReferences.Motions[k]=v.map(m=>({...m,File:relative(file(m.File,'text'))}))
  if(refs.Physics)clone.FileReferences.Physics=relative(file(refs.Physics,'text'));if(refs.DisplayInfo)clone.FileReferences.DisplayInfo=relative(file(refs.DisplayInfo,'text'))
  if(refs.Expressions)clone.FileReferences.Expressions=refs.Expressions.map(e=>({...e,File:relative(file(e.File,'text'))}))
  const src=json('Model-'+path.posix.basename(key)+'.json',clone,text.o.asset.file);models[key]={src,motions:Object.keys(refs.Motions||{})};modelDocs.set(key,{clone,file,relative})
 }
 // Resolve declared prefab -> actual CubismMoc identity using native children.
 const controllerOf=async(o)=>decodeTree(await store.data(o),ANIMATION_TYPES[o.classId],{requireEnd:true})
 const modelOf=async(root)=>{
  const queue=[root],seen=new Set(),mocs=new Set(),controllers=[]
  for(let i=0;i<queue.length;i++){
   const go=queue[i],id=go.asset.file+':'+go.pathId;if(seen.has(id))continue;seen.add(id);if(seen.size>10000)throw Error('CatPaw prefab hierarchy exceeds bounds')
   const d=await store.decode(go)
   for(const c of d.m_Component){const o=await store.ptr(go.asset,c.component);if(!o)continue
    if(o.classId===114&&await store.type(o)==='CubismModel'){const h=monoHeader(await store.data(o)),moc=await store.ptr(o.asset,h.r.ptr());const model=mocModels.get(moc?.asset.file+':'+moc?.pathId);if(model)mocs.add(model)}
    if(o.classId===95){const d=await controllerOf(o),controller=await store.ptr(o.asset,d.m_Controller);if(controller)controllers.push(controller)}
    if(o.classId===4||o.classId===224){const td=unityTransformPrefix(await store.data(o));for(const p of td.m_Children){const tr=await store.ptr(o.asset,p),child=await store.ptr(tr.asset,unityTransformPrefix(await store.data(tr)).m_GameObject);if(child)queue.push(child)}}
   }
  }
  if(mocs.size!==1)return'';const model=[...mocs][0],doc=modelDocs.get(model)
  for(let controller of controllers){if(controller.classId!==91)continue;const data=await controllerOf(controller),names=new Map(data.m_TOS.map(p=>[p.first,p.second]))
   for(const machine of data.m_Controller.m_StateMachineArray)for(const entry of machine.data.m_StateConstantArray){const state=entry.data,alias=names.get(state.m_NameID);if(!alias)continue
    const nodes=state.m_BlendTreeConstantArray.flatMap(t=>t.data.m_NodeArray).map(n=>n.data).filter(n=>!n.m_ChildIndices.length&&Number.isInteger(n.m_ClipID)&&data.m_AnimationClips[n.m_ClipID]);if(nodes.length!==1)continue
    const clip=await store.ptr(controller.asset,data.m_AnimationClips[nodes[0].m_ClipID]),source=clipPaths.get(clip?.asset.file+':'+clip?.pathId);if(!source||!pick(source+'.motion3',[49])||!source.startsWith(path.posix.dirname(model)+'/'))continue
    const relative=doc.relative(doc.file(path.posix.relative(path.posix.dirname(model),source)+'.motion3','text'));const existing=doc.clone.FileReferences.Motions[alias];if(existing&&existing[0]?.File!==relative)throw Error('CatPaw ambiguous native motion state: '+model+'/'+alias);doc.clone.FileReferences.Motions[alias]=[{File:relative}]
   }
  }
  models[model].motions=Object.keys(doc.clone.FileReferences.Motions);return model
 }
 const names=new Set(Object.values(configs.recallConfig).map(c=>'future/recall/'+c.role));for(const c of Object.values(configs.talkConfig)){if(c.talkHeadLive2d)names.add('future/model/live2dhead/'+c.talkHeadLive2d);for(const a of c.fgimage||[])if(a.key)names.add('future/model/talkrole/'+a.key)}
 for(const name of names){const hits=entries.get(lower(name))?.filter(x=>x.o.classId===1)||[];if(hits.length!==1)continue;const model=await modelOf(hits[0].o);if(model){prefabs[lower(name)]=model;if(name.startsWith('future/recall/'))prefabs[name.slice('future/recall/'.length)]=model}}

 const native=await store.asset('resources.assets');for(const o of native.objects.filter(o=>o.classId===114)){const type=await store.type(o);if(['LanguageSourceAsset','LanguageSource'].includes(type))locales.push(readI2Source(await store.data(o),{legacy:type==='LanguageSource'}))}
 for(const row of Object.values(configs.eventConfig)){for(const[n,node]of(row.Node||row.node||[]).entries()){if(node.type!=='talkScene')continue;scripts.push({name:'story/'+row.id+'-'+n+'.catpaw',data:{format:'catpaw-script/1',kind:'story',id:row.id,title:node.name||row.desc||row.name||row.id,rows:node.process||[]}})}}
 for(const row of Object.values(configs.recallConfig))scripts.push({name:'replay/'+row.id+'.catpaw',data:{format:'catpaw-script/1',kind:'replay',id:row.id,title:row.name,rows:row.node||[]}})
 api.context={format:'catpaw-context/1',configs,media,models,prefabs,locales,notes:['本地剧情及CG回放；未执行经营/小游戏控制器；未还原演出保留源行诊断'],scenes:scripts.map(s=>({name:s.name,script:api.cfg.dir+'/script/'+s.name,...s.data}))}
}
