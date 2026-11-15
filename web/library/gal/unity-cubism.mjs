import {UnityReader,monoHeader} from './unity-io.mjs'

function gameObject(data){const r=new UnityReader(data),components=r.list(()=>r.ptr());r.i();return{components,name:r.str()}}
function transform(data){const r=new UnityReader(data),gameObject=r.ptr();for(let i=0;i<10;i++)r.f();const children=r.list(()=>r.ptr()),parent=r.ptr();return{gameObject,children,parent}}
function curve(r){const keys=r.list(()=>({time:r.f(),value:r.f(),inSlope:r.f(),outSlope:r.f(),weightedMode:r.i(),inWeight:r.f(),outWeight:r.f()}),100000);r.i();r.i();r.i();return keys}
function fadeMotion(data){const{r}=monoHeader(data),name=r.str(),fadeIn=r.f(),fadeOut=r.f();r.f();r.f();const ids=r.list(()=>r.str()),curves=r.list(()=>curve(r));r.list(()=>r.f());r.list(()=>r.f());const duration=r.f();r.end();if(ids.length!==curves.length)throw Error('Cubism motion curve count mismatch');return{name,duration,fadeIn,fadeOut,ids,curves}}
function motion3(m){return{Version:3,Meta:{Duration:m.duration,Loop:true,Fps:30,FadeInTime:m.fadeIn,FadeOutTime:m.fadeOut},Curves:m.ids.map((id,i)=>{
 const keys=m.curves[i],segments=keys.length?[keys[0].time,keys[0].value]:[0,0]
 for(let j=1;j<keys.length;j++){const a=keys[j-1],b=keys[j],dt=(b.time-a.time)/3;if(!Number.isFinite(a.outSlope)||!Number.isFinite(b.inSlope))segments.push(2,b.time,b.value);else segments.push(1,a.time+dt,a.value+a.outSlope*dt,b.time-dt,b.value-b.inSlope*dt,b.time,b.value)}
 return{Target:'Parameter',Id:id,Segments:segments}
})}}
// Unity Cubism SDK serialized layouts. Associate renderers by their actual
// Transform ancestors; repeated texture_00 names are not an ordering heuristic.
export async function indexUnityCubism(api){
 const{store,add,json,object}=api,models=new Map(),gos=new Map(),transforms=new Map(),components=new Map(),renderers=[],motions=[],lists=[]
 for(const file of store.files.keys()){
  if(!file.endsWith('.assets'))continue
  const a=await store.asset(file)
  const key=o=>a.file+':'+o.pathId
  for(const o of a.objects){
   if(o.classId===1){gos.set(key(o),{o,...gameObject(await store.data(o))});continue}
   if(o.classId===4){const t=transform(await store.data(o)),go=await store.ptr(a,t.gameObject);transforms.set(key(o),{...t,o,go:go&&key(go)});if(go)components.set(key(go),key(o));continue}
   if(o.classId!==114)continue
   const type=await store.type(o);if(!['CubismMoc','CubismModel','CubismRenderer','CubismFadeMotionData','CubismFadeMotionList'].includes(type))continue
   const data=await store.data(o),h=monoHeader(data),r=h.r
   if(type==='CubismMoc'){const bytes=r.bytes();r.end();models.set(key(o),{name:h.name,o,bytes,textures:new Map()})}
   if(type==='CubismModel'){const moc=await store.ptr(a,r.ptr());r.bool();r.end();const go=await store.ptr(a,h.gameObject);if(moc&&go)components.set('model:'+key(go),key(moc))}
   if(type==='CubismRenderer'){
    r.i();for(let i=0;i<4;i++)r.f();r.bool();r.bool();for(let i=0;i<8;i++)r.f();const tex=await store.ptr(a,r.ptr()),go=await store.ptr(a,h.gameObject);renderers.push({go:go&&key(go),tex})
   }
   if(type==='CubismFadeMotionData')motions.push({o,motion:fadeMotion(data)})
   if(type==='CubismFadeMotionList'){r.list(()=>r.i());const refs=r.list(()=>r.ptr());r.end();lists.push({name:h.name,a,refs})}
  }
 }
 for(const renderer of renderers){
  let go=renderer.go,seen=new Set()
  while(go&&!seen.has(go)){seen.add(go);const model=models.get(components.get('model:'+go));if(model){if(renderer.tex)model.textures.set(renderer.tex.pathId,renderer.tex);break}const t=transforms.get(components.get(go));if(!t||String(t.parent.m_PathID)==='0')break;const parent=await store.ptr(t.o.asset,t.parent);go=parent&&transforms.get(parent.asset.file+':'+parent.pathId)?.go}
 }
 const output={}
 for(const model of models.values()){
  if(!model.textures.size)throw Error('Cubism model has no associated renderer texture: '+model.name)
  const base='Live2D/'+model.name+'/',moc=base+model.name+'.moc3';add(moc,{file:model.o.asset.file,offset:model.o.offset,size:model.o.size},async()=>model.bytes)
  // Drawables reference texture slots by index. This game uses one atlas per
  // model; reject an ambiguous multi-atlas layout until its indices are read.
  if(model.textures.size!==1)throw Error('Cubism multiple texture indices need explicit native mapping: '+model.name)
  const texture=base+'texture_00.png';object(texture,[...model.textures.values()][0])
  const list=lists.find(l=>l.name===model.name+'.fadeMotionList'),modelMotions=[]
  if(list)for(const ptr of list.refs){const o=await store.ptr(list.a,ptr),m=motions.find(m=>m.o.asset===o?.asset&&m.o.pathId===o.pathId);if(!m)throw Error('Cubism fade motion reference missing');modelMotions.push(m.motion)}
  const refs={Moc:model.name+'.moc3',Textures:['texture_00.png'],Motions:{}}
  for(let i=0;i<modelMotions.length;i++){const m=modelMotions[i],file='motion-'+i+'.motion3.json';json(base+file,motion3(m),model.o.asset.file);refs.Motions[m.name]=[{File:file}]}
  const src=json(base+model.name+'.model3.json',{Version:3,FileReferences:refs},model.o.asset.file);output[model.name]={src,motions:modelMotions.map(m=>m.name)}
 }
 return output
}
