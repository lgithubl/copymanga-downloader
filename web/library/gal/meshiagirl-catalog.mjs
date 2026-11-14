import{stat}from'node:fs/promises'
import path from'node:path'
import{DatabaseSync}from'node:sqlite'
// The offline cache includes the original menu responses. Read only the four
// public catalog endpoints; authentication/session data is never selected.
export async function readMeshiMetadata(mediaDir,relative='meshiamitm.db'){
 const out={characters:new Map(),costumes:new Map(),episodes:new Map(),exec:new Map(),warnings:[]}
 if(!relative||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid meshiagirl catalog database path')
 const file=path.join(mediaDir,relative);let info;try{info=await stat(file)}catch(e){if(e.code!=='ENOENT')throw e;out.warnings.push('未找到本地目录索引 '+relative+'；使用脚本编号分类');return out}if(info.size>64*1024*1024)throw Error('meshiagirl catalog database exceeds64MiB')
 const db=new DatabaseSync(file,{readOnly:true});try{
  const allowed=['/api/namelist/chara/index','/api/book/decolist','/api/namelist/episode/index','/api/namelist/episode/exec'],query=db.prepare('SELECT sid,apiData FROM apiinfo WHERE apiPath=? ORDER BY rowid')
  for(const endpoint of allowed){const rows=query.all(endpoint);if(rows.length>5000)throw Error('meshiagirl catalog row limit');for(const row of rows){if(Buffer.byteLength(row.apiData||'')>16*1024*1024)throw Error('meshiagirl catalog response too large');const d=JSON.parse(row.apiData||'null')?.result;if(!d)continue
   if(endpoint===allowed[0])for(const c of d.chara_list||[])out.characters.set(Number(c.chara_id),{id:Number(c.chara_id),name:c.chara_nm,icon:c.illust_url})
   if(endpoint===allowed[1])for(const c of d.deco_list||[])out.costumes.set(Number(c.deco_id),{id:Number(c.deco_id),character:Number(c.chara_id),name:c.deco_nm,icon:c.illust_url})
   if(endpoint===allowed[2])for(const[k,kind]of[['chara_episode_list','character'],['deco_episode_list','costume']])for(const e of d[k]||[])out.episodes.set(Number(e.episode_id),{id:Number(e.episode_id),character:Number(row.sid),title:e.episode_nm,kind,special:Boolean(e.is_sp),costume:kind==='costume'?Number(e.episode_id)-1000000:null})
   if(endpoint===allowed[3]&&row.sid&&Array.isArray(d.adventure_json_list)){const parts=d.adventure_json_list.slice().sort((a,b)=>(a.order_no||0)-(b.order_no||0)).flatMap(e=>[e.prev,...(e.main_list?.length?e.main_list:[e.main]),e.after]).filter(x=>typeof x==='string'&&x);if(parts.length)out.exec.set(Number(row.sid),parts)}
  }}
 }finally{db.close()}return out
}
export function buildMeshiCatalog(groups,metadata,assets){
 const sort=xs=>xs.sort((a,b)=>a.title.localeCompare(b.title,'ja',{numeric:true})),icon=(name,costume=false)=>{for(const bundle of costume?['spriteCharaThum_00','spriteCharaThum_10']:['spriteCharaThum_10','spriteCharaThum_00']){const src=assets.get(bundle+':'+name)?.src;if(src)return src}return''},characters=new Map(),chapters=new Map(),events=[],other=[],all=[]
 for(const group of groups){const first=group.parts[0],base=group.name,id=group.episodeId??Number(/^([0-9]+)/.exec(base)?.[1]),episode=metadata.episodes.get(id),deco=/^([0-9]+)_dekoEP/.exec(base),chara=/^01([0-9]{3})[0-9]+_charaEP/.exec(base),main=/^([0-9]{7})_(?:main|map|prologue)$/.exec(base)
  const character=episode?.character||(deco?Math.floor((Number(deco[1])-1000000)/1000):chara?Number(chara[1]):0),costumeId=episode?.costume??(deco?Number(deco[1])-1000000:null),costume=metadata.costumes.get(costumeId),title=episode?.title?(group.special?episode.title:base.endsWith('_N')?'通常版 · '+episode.title:episode.title):base
  const card={id:first.import+'::'+(group.parts.length>1?'episode':'single'),script:first.import+(group.parts.length>1?'::episode':''),title,viewName:group.special?base.replace(/_H[23]?$/,'_H'):base};group.card=card;all.push(card)
  if(character>0){if(!characters.has(character)){const c=metadata.characters.get(character),thumb=icon(c?.icon||'');characters.set(character,{id:'character/'+character,title:c?.name||'角色 '+character,...(thumb?{thumb}:{}),children:[],costumes:new Map()})}const parent=characters.get(character),key=costumeId??'story';if(!parent.costumes.has(key)){const thumb=costume?.icon?icon(costume.icon,true):'';parent.costumes.set(key,{id:'character/'+character+'/costume/'+key,title:costume?.name||(key==='story'?'角色剧情':'服装 '+key),...(thumb?{thumb}:{}),children:[]})}parent.costumes.get(key).children.push(card)
  }else if(main){const chapter=Math.floor(Number(main[1])/100);if(!chapters.has(chapter))chapters.set(chapter,{id:'main/'+chapter,title:chapter?'第 '+chapter+' 章':'序章',children:[]});chapters.get(chapter).children.push(card)}else if(/_event(?:_|$)/i.test(base))events.push(card);else other.push(card)
 }
 const role=sort([...characters.values()].map(c=>{const{costumes,...node}=c;return{...node,children:sort([...costumes.values()].map(d=>({...d,children:sort(d.children)})))}})),main=[...chapters].sort((a,b)=>a[0]-b[0]).map(([,c])=>({...c,children:sort(c.children)}))
 return{children:[{id:'characters',title:'角色',children:role},{id:'main-story',title:'主线',children:main},{id:'events',title:'活动',children:sort(events)},{id:'other',title:'其他剧情 / 未归类',children:sort(other)},{id:'story',title:'全部剧情',children:sort(all)}]}
}
