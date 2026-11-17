import{foxDefaultDatabase}from'./unity-fox-state.mjs'
import path from'node:path'
import{UnityReader,monoHeader,readTextObject}from'./unity-io.mjs'
import{unityUiImagePrefix}from'./unity-scene.mjs'
import{spineMetadata}from'./spine-metadata.mjs'
import{foxDialogue,foxRoom}from'./unity-fox-room.mjs'
// Native scene -> SkeletonGraphic -> SkeletonDataAsset -> atlas/material/texture.
// This is a CG/animation gallery; interactive game controllers are not executed.
export async function indexSpineGallery(api){
 const{store,scripts,add,object}=api,a=await store.asset('globalgamemanagers'),settings=a.objects.find(o=>o.classId===141);if(!settings)throw Error('Native Unity BuildSettings absent');const r=new UnityReader(await store.data(settings)),scenes=r.list(()=>r.str()),models=new Map(),story={...await foxDialogue(api),...await foxDefaultDatabase(store)}
 const skeleton=async(o)=>{
  const identity=path.basename(o.asset.file)+':'+o.pathId;if(models.has(identity))return models.get(identity)
  if(await store.type(o)!=='SkeletonDataAsset')throw Error('Native SkeletonGraphic data reference is not SkeletonDataAsset')
  const h=monoHeader(await store.data(o)),r=h.r,atlasRefs=r.list(()=>r.ptr(),64),scale=r.f(),data=await store.ptr(o.asset,r.ptr());if(data?.classId!==49||!atlasRefs.length)throw Error('Native Spine skeleton/atlas reference missing')
  const text=readTextObject(await store.data(data)),base='Spine/'+path.basename(o.asset.file)+'-'+o.pathId+'/',skel=add(base+'skeleton.skel',{file:data.asset.file,offset:data.offset,size:data.size},async()=>text.bytes),atlases=[],textureMap={}
  for(const ref of atlasRefs){const atlasObject=await store.ptr(o.asset,ref);if(!atlasObject)throw Error('Native Spine atlas missing');const {r}=monoHeader(await store.data(atlasObject));const mode=r.i();r.ptr();const atlasText=await store.ptr(atlasObject.asset,r.ptr()),materials=r.list(()=>r.ptr(),256);r.end();if(mode!==0)throw Error('Native Spine on-demand atlas not supported');if(atlasText?.classId!==49)throw Error('Native Spine atlas TextAsset missing');const atlas=readTextObject(await store.data(atlasText)).text,parts=[...atlas.replace(/\r/g,'').matchAll(/(?:^|\n\n)([^\n]+\.png)\n/g)].map(m=>m[1]);if(parts.length!==materials.length)throw Error('Native Spine atlas/material count mismatch')
   for(const[i,name]of parts.entries()){const material=await store.ptr(atlasObject.asset,materials[i]);if(material?.classId!==21)throw Error('Native Spine material missing');const d=await store.decode(material),ptr=d.m_SavedProperties?.m_TexEnvs?.find(t=>t.first==='_MainTex')?.second?.m_Texture,texture=ptr&&await store.ptr(material.asset,ptr);if(texture?.classId!==28)throw Error('Native Spine page texture missing: '+name);if(textureMap[name])throw Error('Native Spine duplicate page name: '+name);textureMap[name]=object(base+'Textures/'+name,texture)}atlases.push(atlas)
  }
  const atlasText=atlases.join('\n\n'),atlas=add(base+'skeleton.atlas',{file:o.asset.file,offset:o.offset,size:o.size,identity:identity+':atlas'},async()=>Buffer.from(atlasText)),metadata=await spineMetadata(text.bytes,atlasText),model={id:identity,name:h.name,scale,skel,atlas,textureMap,...metadata};models.set(identity,model);return model
 }
 for(const[i,source]of scenes.entries()){
  if(!/(?:^|_)Hcg\d+/i.test(path.posix.basename(source)))continue
  const file='level'+i;if(!store.files.has(file))throw Error('Native CG scene file absent: '+file);const scene=await store.asset(file),matches=[]
  for(const o of scene.objects.filter(o=>o.classId===114)){if(await store.type(o)!=='SkeletonGraphic')continue;const h=monoHeader(await store.data(o)),go=await store.ptr(o.asset,h.gameObject),d=await store.decode(go);if(d.m_Name!=='Main')continue;const ui=unityUiImagePrefix(await store.data(o)),asset=await store.ptr(o.asset,ui.sprite);if(!asset)continue;matches.push(await skeleton(asset))}
  if(matches.length!==1)throw Error('Native CG Main skeleton absent/ambiguous: '+source)
  const model=matches[0],name=path.posix.basename(source,'.unity')+'.uspine',room=await foxRoom(api,scene,skeleton,model);scripts.push({name,data:{format:'unity-spine-gallery/1',name:path.posix.basename(source,'.unity'),source:file,model:model.id,room}})
 }
 api.context={format:'unity-spine-gallery-context/1',models:Object.fromEntries(models),...story,scenes:scripts.map(s=>({name:s.data.name,script:api.cfg.dir+'/script/'+s.name,model:s.data.model,functions:Object.keys(s.data.room.functions),interactions:s.data.room.interactions})),notes:['原生CG互动片段：动作多轨道、原生对话/配音及声音开关；原生按钮支持连续互动和已知状态条件；未知存档数值需手动选，未模拟经营及触摸命中']}
}
