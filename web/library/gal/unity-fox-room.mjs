import path from'node:path'
import{monoHeader}from'./unity-io.mjs'
import{unityTransformPrefix,unityUiImagePrefix}from'./unity-scene.mjs'
import{readUnityOdin,odinValues}from'./unity-odin.mjs'
import{unityUtageBook}from'./unity-utage-data.mjs'

export async function foxDialogue(api){
 const{store,object}=api,dialogue={},voices={},warnings=[],voiceNames=new Map()
 // Original room controllers call these labels in the shared Story books.
 for(const name of ['resources.assets','sharedassets2.assets']){
  if(!store.files.has(name))continue;const a=await store.asset(name)
  for(const o of a.objects){
   if(o.classId===83){const d=await store.decode(o),key=d.m_Name;if(!voiceNames.has(key))voiceNames.set(key,[]);voiceNames.get(key).push(o)}
   if(o.classId!==114)continue;let type;try{type=await store.type(o)}catch(e){warnings.push({file:name,object:o.pathId,error:e.message});continue}if(type!=='AdvImportBook')continue
   const book=unityUtageBook(await store.data(o));for(const g of book.importGridList){const head=g.rows.find(r=>r.strings.includes('Command'))?.strings;if(!head)continue;let rows=null
    for(const row of g.rows){if(row.strings===head||row.isEmpty||row.isCommentOut)continue;const d={...Object.fromEntries(head.map((k,i)=>[k,row.strings[i]||''])),source:g.name+':'+(row.rowIndex+1)};if(d.Command.startsWith('*')){const label=d.Command.slice(1);if(dialogue[label])throw Error('Fox duplicate dialogue label: '+label);rows=dialogue[label]=[]}else if(rows)rows.push(d)}
   }
  }
 }
 for(const[key,hits]of voiceNames)if(hits.length===1)voices[key]=object('RoomAudio/'+key+'.ogg',hits[0]);else warnings.push({name:key,reason:'ambiguous-audio-name',count:hits.length});return{dialogue,voices,warnings}
}

export async function foxRoom(api,scene,skeleton,main){
 const{store,object}=api,managers=[],registered=api.foxAudio||(api.foxAudio=new Map()),audioResource=clip=>{const key=path.basename(clip.asset.file)+'-'+clip.pathId;if(!registered.has(key))registered.set(key,object('RoomAudio/'+key+'.ogg',clip));return registered.get(key)}
 for(const o of scene.objects.filter(o=>o.classId===114))if(await store.type(o)==='SexRoomManager')managers.push(o)
 if(managers.length!==1)throw Error('Fox room manager absent/ambiguous: '+scene.file)
 const manager=readUnityOdin(await store.data(managers[0])),values=odinValues(manager.entries),r=manager.r
 const equip=r.str(),shot=r.str(),skin=r.str();r.ptr();const mainPtr=r.ptr(),logic=await store.ptr(scene,r.ptr());if(!logic||await store.type(logic)!=='InteractiveLogicSO')throw Error('Fox native interactive logic reference missing')
 const data=readUnityOdin(await store.data(logic)),refs=data.r.list(()=>data.r.ptr(),1000),functions={}
 for(const ref of refs){const o=await store.ptr(logic.asset,ref);if(!o||await store.type(o)!=='InteractiveLogicSOBlock')throw Error('Fox native interactive block absent');const d=readUnityOdin(await store.data(o)),blocks=odinValues(d.entries).interactiveBlocks||{};for(const[key,block]of Object.entries(blocks)){if(Object.hasOwn(functions,key))throw Error('Fox duplicate function '+key);block.$source=path.basename(o.asset.file)+':'+o.pathId;functions[key]=block}}
 const models={'':main.id},interactions=[],gameObjects={},warnings=[],audioSources=new Map(),byName=new Map(),visualObjects=new Set(),unsupportedVisuals=new Set()
 for(const o of scene.objects.filter(o=>o.classId===1)){const d=await store.decode(o);if(!byName.has(d.m_Name))byName.set(d.m_Name,[]);byName.get(d.m_Name).push(o)}
 for(const[key,ref]of Object.entries(values.nameToSpine||{})){if(!Number.isInteger(ref?.external)||!manager.references[ref.external])throw Error('Fox named skeleton reference invalid');const graphic=await store.ptr(scene,manager.references[ref.external]),ui=unityUiImagePrefix(await store.data(graphic)),asset=await store.ptr(graphic.asset,ui.sprite);if(asset)models[key]=(await skeleton(asset)).id;else warnings.push({name:key,reason:'native-skeleton-unassigned'})}
  // Screen-space Canvas layout, resolved from the captured RectTransforms.
 const graphics={},objectStates={},layoutCache=new Map(),reference=[]
 for(const o of scene.objects.filter(o=>o.classId===114))if(await store.type(o)==='CanvasScaler'){const r=monoHeader(await store.data(o)).r,mode=r.i();r.f();r.f();const size=[r.f(),r.f()];if(mode!==1||size.some(v=>!Number.isFinite(v)||v<=0))throw Error('Fox canvas scaling mode unsupported');if(reference.length&&reference.some((v,i)=>Math.abs(v-size[i])>.01))throw Error('Fox canvas reference mismatch');reference.splice(0,2,...size)}
 if(!reference.length)throw Error('Fox canvas reference absent')
 const hierarchy=async(go,seen=new Set())=>{if(seen.has(go.pathId))throw Error('Fox cyclic layout hierarchy');seen=new Set(seen);seen.add(go.pathId);if(layoutCache.has(go.pathId))return layoutCache.get(go.pathId);const d=await store.decode(go);objectStates[go.pathId]=!!d.m_IsActive;const components=await Promise.all(d.m_Component.map(c=>store.ptr(scene,c.component))),tr=components.find(c=>c?.classId===224);if(!tr)throw Error('Fox graphic requires RectTransform');const t=await store.decode(tr),parent=await store.ptr(scene,t.m_Father);let p
  if(components.some(c=>c?.classId===223)){p={x:0,y:0,sx:1,sy:1,size:reference,pivot:{x:.5,y:.5},chain:[go.pathId]}}
  else{if(!parent)throw Error('Fox graphic canvas absent');const pg=await store.ptr(scene,unityTransformPrefix(await store.data(parent)).m_GameObject),a=await hierarchy(pg,seen),amin=t.m_AnchorMin,amax=t.m_AnchorMax,pivot=t.m_Pivot,size=[a.size[0]*(amax.x-amin.x)+t.m_SizeDelta.x,a.size[1]*(amax.y-amin.y)+t.m_SizeDelta.y],rotation=t.m_LocalRotation;if(Math.abs(rotation.x)+Math.abs(rotation.y)+Math.abs(rotation.z)>1e-5)throw Error('Fox rotated graphic layout not supported');p={x:a.x+((amin.x+(amax.x-amin.x)*pivot.x-a.pivot.x)*a.size[0]+t.m_AnchoredPosition.x)*a.sx,y:a.y+((amin.y+(amax.y-amin.y)*pivot.y-a.pivot.y)*a.size[1]+t.m_AnchoredPosition.y)*a.sy,sx:a.sx*t.m_LocalScale.x,sy:a.sy*t.m_LocalScale.y,size,pivot,chain:[...a.chain,go.pathId]}}
  layoutCache.set(go.pathId,p);return p
 }
 const graphic=async(ref,key)=>{const o=await store.ptr(scene,ref);if(!o||await store.type(o)!=='SkeletonGraphic')return;const ui=unityUiImagePrefix(await store.data(o)),asset=await store.ptr(scene,ui.sprite);if(!asset)return;const model=await skeleton(asset),r=ui.r;for(let i=0;i<3;i++)r.ptr();for(let i=0;i<4;i++)r.f();const skin=r.str(),flipX=r.bool(),flipY=r.bool(),animation=r.str(),loop=r.bool(),timeScale=r.f();r.bool();const mode=r.i(),refSize=[r.f(),r.f()],refScale=r.f();if(mode!==0){warnings.push({name:key,reason:'native-graphic-layout-scale-mode',mode});return}const go=await store.ptr(scene,monoHeader(await store.data(o)).gameObject),layout=await hierarchy(go);if(!Number.isFinite(layout.sx)||Math.abs(layout.sx)<1e-8||!Number.isFinite(layout.sy))throw Error('Fox graphic scale invalid');models[key]=model.id;graphics[key]={object:go.pathId,chain:layout.chain,stage:reference,place:{x:layout.x,y:layout.y,scale:Math.abs(layout.sx)*model.scale*100,scaleX:(flipX?-1:1)*Math.sign(layout.sx),scaleY:(flipY?-1:1)*layout.sy/Math.abs(layout.sx)},skin,animation,loop,timeScale,refSize,refScale}}
 await graphic(mainPtr,'')
 for(const[key,ref]of Object.entries(values.nameToSpine||{}))await graphic(manager.references[ref.external],key)

 const sources=async(go,seen=new Set())=>{const id=go.pathId;if(seen.has(id))throw Error('Fox cyclic native hierarchy');seen=new Set(seen);seen.add(id);const out=[],d=await store.decode(go)
  for(const c of d.m_Component){const o=await store.ptr(scene,c.component);if(!o)continue
   if(o.classId===114&&['Image','SkeletonGraphic'].includes(await store.type(o))){visualObjects.add(id);if(await store.type(o)==='Image')unsupportedVisuals.add(id)}if(o.classId===82){let info=audioSources.get(o.pathId);if(!info){const d=await store.decode(o),clip=await store.ptr(o.asset,d.m_audioClip);if(clip?.classId!==83)continue;info={src:audioResource(clip),loop:!!d.Loop,volume:d.m_Volume,playOnAwake:!!d.m_PlayOnAwake};audioSources.set(o.pathId,info)}out.push(info)}
   if(o.classId===4||o.classId===224)for(const p of unityTransformPrefix(await store.data(o)).m_Children){const t=await store.ptr(scene,p),child=await store.ptr(t.asset,unityTransformPrefix(await store.data(t)).m_GameObject);out.push(...await sources(child,seen));if(visualObjects.has(child.pathId))visualObjects.add(id);if(unsupportedVisuals.has(child.pathId))unsupportedVisuals.add(id)}
  }return out
 }
 // Resolve only exact names used by native flow commands. A name collision is
 // reported rather than choosing an unrelated scene object.
 const used=new Set(),visit=v=>{if(!v||typeof v!=='object')return;if(v.GOName)used.add(v.GOName);for(const x of Object.values(v))visit(x)};visit(functions)
 for(const name of used){const hits=byName.get(name)||[];if(hits.length!==1){warnings.push({name,reason:'native-object-absent-or-ambiguous',count:hits.length});continue}const go=hits[0],d=await store.decode(go);const audio=await sources(go);gameObjects[name]={object:go.pathId,active:!!d.m_IsActive,audio,visual:visualObjects.has(go.pathId),unmappedImages:unsupportedVisuals.has(go.pathId)}}
 for(const o of scene.objects.filter(o=>o.classId===114)){if(await store.type(o)!=='SexInteractiveArea_色色互動區塊')continue;const h=monoHeader(await store.data(o)),r=h.r;for(let i=0;i<4;i++)r.ptr();const calls=r.list(()=>({name:r.str(),icon:r.ptr()}),128);for(const c of calls)if(c.name&&Object.hasOwn(functions,c.name)&&!interactions.includes(c.name))interactions.push(c.name)}
 return{functions,models,graphics,objectStates,interactions,gameObjects,initial:{equip,shot,skin},warnings,source:path.basename(scene.file)+':'+managers[0].pathId}
}
