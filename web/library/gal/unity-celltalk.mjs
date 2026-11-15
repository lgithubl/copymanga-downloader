import{readFile,stat}from'node:fs/promises'
import{readFileSync}from'node:fs'
import{createHash}from'node:crypto'
import path from'node:path'
import{monoHeader}from'./unity-io.mjs'
const PROFILE=JSON.parse(readFileSync(new URL('./celltalk-native-profiles.json',import.meta.url)))
const fieldList=t=>PROFILE.fields[t]?[...fieldList(PROFILE.fields[t].base),...PROFILE.fields[t].fields]:[]
export function cellTalkTable(text){
 const rows=String(text).replace(/^\uFEFF/,'').split('|行端端|').map(r=>r.split('|セル|').map(x=>x.trim())),head=rows.shift()
 if(!head?.includes('ID')||!head.includes('日本語'))throw Error('CellTalk native table header absent')
 return rows.filter(r=>r.some(Boolean)).map((row,i)=>({...Object.fromEntries(head.map((h,j)=>[h,row[j]||''])),source:i+2}))
}
export async function indexCellTalk(api){
 const{store,scripts}=api,metadata=path.join(api.root,'il2cpp_data','Metadata','global-metadata.dat'),st=await stat(metadata)
 if(st.size>64*1024*1024||createHash('sha256').update(await readFile(metadata)).digest('hex')!==PROFILE.metadataSha256)throw Error('CellTalk native build is not verified; collect its metadata and scene controllers first')
 const binary=path.join(api.root,'..','GameAssembly.dll'),binaryStat=await stat(binary)
 if(binaryStat.size>128*1024*1024||createHash('sha256').update(await readFile(binary)).digest('hex')!==PROFILE.binarySha256)throw Error('CellTalk controller binary is not verified; collect this build before playing its native scene order')
 const controllers=[],diagnostics=[],texts=new Map(),media={audio:{},cg:{}},seen=new Set()
 for(const name of store.files.keys())if(/^level\d+$/.test(name)){
  const a=await store.asset(name)
  for(const o of a.objects.filter(o=>o.classId===114)){
   const type=await store.type(o);if(PROFILE.fields[type]?.base!=='ReplayScene'||seen.has(type))continue;seen.add(type)
   const profile=PROFILE.scenes[type];if(!profile){diagnostics.push({type,reason:'native-controller-not-lifted'});continue}
   const h=monoHeader(await store.data(o)),fields={}
   for(const f of fieldList(type))fields[f.name]=f.type==='string'?h.r.str():f.type==='float'?h.r.f():f.type==='int'?h.r.i():f.type==='bool'?h.r.bool():f.type.endsWith('[]')||f.type.startsWith('List<')?h.r.list(()=>f.type.includes('String')||f.type==='string[]'?h.r.str():h.r.ptr()):h.r.ptr()
   h.r.end();const text=await store.ptr(a,fields.script_txtdata);if(!text)throw Error('CellTalk scene has no declared text table: '+type)
   const key=text.asset.file+':'+text.pathId;if(!texts.has(key))texts.set(key,cellTalkTable((await store.decode(text)).text))
   const audioFields={}
   for(const f of fieldList(type).filter(f=>f.type==='AudioData')){
    const source=await store.ptr(a,fields[f.name]);if(!source)continue
    const r=monoHeader(await store.data(source)).r;r.f();r.f();r.f();r.bool();const clip=await store.ptr(source.asset,r.ptr());r.f();r.end()
    if(clip){const key='native-'+path.basename(source.asset.file)+'-'+source.pathId;let src=media.audio[key];if(!src)src=media.audio[key]=api.object('Audio/'+key+'.ogg',clip);audioFields[f.name]=src}
   }
   controllers.push({type,fields,audioFields,rows:texts.get(key),profile,source:name+':'+o.pathId})
  }
 }
 for(const loc of api.catalog){
  const key=loc.key.replace(/\\/g,'/'),voice=/^Assets\/Voice\/(.+)\.(?:wav|ogg)$/i.exec(key)
  if(voice&&!media.audio[voice[1]])media.audio[voice[1]]=api.catalogResource('Audio/'+voice[1]+'.ogg',loc)
 }
 const cgPaths=new Set();const scan=(node,fields)=>{for(const c of node.commands||[])if(c.method==='ReplayScene.CGLoad'){let p=c.args[1];if(p?.field)p=fields[p.field];if(typeof p==='string'&&p)cgPaths.add(p)}if(node.no)scan(node.no,fields);if(node.yes)scan(node.yes,fields)}
 for(const c of controllers)scan(c.profile,c.fields)
 for(const name of cgPaths){const loc=api.catalog.find(l=>l.internal.toLowerCase()===('Assets/'+name+'.prefab').toLowerCase());if(!loc){diagnostics.push({cg:name,reason:'native-prefab-reference-absent'});continue}try{media.cg[name]=await cellTalkCg(api,loc)}catch(e){diagnostics.push({cg:name,reason:e.message})}}
 for(const c of controllers)scripts.push({name:c.type+'.cell',data:{format:'celltalk-script/1',...c}})
 api.context={format:'celltalk-context/1',media,diagnostics,scenes:scripts.map(s=>({name:s.data.type,script:api.cfg.dir+'/script/'+s.name}))}
}
export async function cellTalkCg(api,location){
 const{store}=api,root=await store.catalogAsset(location),rootData=await store.decode(root)
 const components=await Promise.all(rootData.m_Component.map(c=>store.ptr(root.asset,c.component))),cgObject=(await Promise.all(components.filter(o=>o?.classId===114).map(async o=>({o,type:await store.type(o)})))).find(x=>x.type==='CG')?.o
 if(!cgObject)throw Error('CellTalk CG component absent: '+location.internal)
 const cg=await store.decode(cgObject),sprites=new Map(),faces={},faceGroups={},poses={},visited=new Set()
 const sprite=async o=>{if(!o||o.classId!==213)return null;const key=o.asset.file+':'+o.pathId;if(sprites.has(key))return sprites.get(key);const d=await store.decode(o),src=api.object('CG/'+cgObject.pathId+'/'+o.pathId+'.png',o),s={src,anchor:[d.m_Pivot.x,1-d.m_Pivot.y],name:d.m_Name};sprites.set(key,s);return s}
 // StandLayerInfo.Init indexes the substring after "face"; SetFace performs
 // an exact match within that component. Keep separate actors' face lists.
 for(const ptr of cg.faces){const info=await store.ptr(cgObject.asset,ptr),d=await store.decode(info),group=faceGroups[String(d.m_GameObject.m_PathID)]={};for(const p of d.sprites||[]){const o=await store.ptr(info.asset,p),s=await sprite(o);if(s){const at=s.name.indexOf('face'),key=at<0?s.name:s.name.slice(at+4);if(group[key])throw Error('CellTalk duplicate expression within face component: '+key);group[key]=s;faces[s.name]=s}}}

 const walk=async(go,chain,geometry)=>{
  const identity=go.asset.file+':'+go.pathId;if(visited.has(identity)||visited.size>=10000||chain.length>64)throw Error('CellTalk CG hierarchy is cyclic or exceeds bounds');visited.add(identity)
  const d=await store.decode(go),objs=await Promise.all(d.m_Component.map(c=>store.ptr(go.asset,c.component))),tr=objs.find(o=>o?.classId===224||o?.classId===4),td=tr?await store.decode(tr):null,scale=td?.m_LocalScale||{x:1,y:1},pos=td?.m_AnchoredPosition||td?.m_LocalPosition||{x:0,y:0},g=chain.length?{x:geometry.x+pos.x*geometry.sx,y:geometry.y+pos.y*geometry.sy,sx:geometry.sx*scale.x,sy:geometry.sy*scale.y}:geometry,names=[...chain,d.m_Name]
  const poseAt=names.findIndex(n=>cg.poses.includes(n));g.faceGroup=faceGroups[go.pathId]?go.pathId:geometry.faceGroup;g.active=(geometry.active??true)&&(poseAt>=0&&names.length>poseAt+2?d.m_IsActive!==0:true)
  for(const o of objs.filter(o=>o?.classId===212)){const rd=await store.decode(o),so=await store.ptr(o.asset,rd.m_Sprite),s=await sprite(so);if(s){const at=names.findIndex(n=>cg.poses.includes(n));if(at<0)continue;const pose=names[at],part=names[at+1]||d.m_Name;(poses[pose]||=[]).push({...s,part,path:names.slice(at+1).join('/'),x:g.x,y:-g.y,scaleX:g.sx,scaleY:g.sy,z:rd.m_SortingOrder,faceGroup:g.faceGroup,active:g.active&&rd.m_Enabled!==0,alpha:rd.m_Color?.a??1,flipX:!!rd.m_FlipX,flipY:!!rd.m_FlipY})}}
  for(const p of td?.m_Children||[]){const child=await store.ptr(tr.asset,p),cd=await store.decode(child),next=await store.ptr(child.asset,cd.m_GameObject);await walk(next,names,g)}
 }
 await walk(root,[],{x:0,y:0,sx:1,sy:1})
 return{defaultparts:cg.defaultparts,saveinfo:cg.saveinfo,subinfo:cg.subinfo,rules:cg.rules,poses,faces,faceGroups}
}
