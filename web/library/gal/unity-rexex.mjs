import{readFile}from'node:fs/promises'
import path from'node:path'
import{UnityReader}from'./unity-io.mjs'
import{REX_TABLES}from'./rexex-tables.mjs'
const pad=(n,w=4)=>String(n).padStart(w,'0'),clean=v=>v&&v!=='-'?String(v):''
// Read only declarative Unity TextAssets and native bundle manifests. Assemblies
// supply the documented schema during development and are never executed here.
export async function indexRexex(api){
 const{store,cfg,add,scripts}=api,tables=Object.fromEntries(Object.keys(REX_TABLES).map(n=>[n,new Map()])),assets={},locations=new Map(),warnings=[]
 const objectIndexes=new Map(),mediaObject=async(name,stem,type)=>{if(!objectIndexes.has(name))objectIndexes.set(name,(async()=>{const out=new Map(),b=await store.bundle(name);for(const a of b.assets)for(const o of a.objects.filter(o=>[213,28,83].includes(o.classId))){const key=new UnityReader(await store.data(o)).str().toLowerCase(),old=out.get(key);if(!old||o.classId===213)out.set(key,o)}return out})());const object=(await objectIndexes.get(name)).get(stem.toLowerCase());if(!object||type==='audio'&&object.classId!==83)throw Error('RexEX native object missing: '+name+'/'+stem);return object}
 const bundles=[...store.files.keys()].filter(n=>/^asset_(?:\d+_(?:text|graphics|audio|chara|evcg_thumb)|evcg_\d+_\d+|voice_\d+)$/.test(n)).sort()
 if(!bundles.includes('asset_00_text'))throw Error('RexEX native text bundle missing')
 for(const name of bundles){
  if(name.endsWith('_text')){
   const b=await store.bundle(name)
   for(const a of b.assets)for(const o of a.objects.filter(o=>o.classId===49)){
    const d=await store.decode(o),key=(d.m_Name||d.name||'').replace(/^db_/,''),schema=REX_TABLES[key];if(!schema)continue
    const text=String(d.m_Script??d.text??'').replace(/^\uFEFF/,'');if(!text.trim())continue
    for(const line of text.replace(/\r/g,'').split('\n')){if(!line)continue;const cells=line.split('\t');if(cells.length<schema.length)throw Error(`RexEX ${name}/db_${key}: expected ${schema.length} columns, got ${cells.length}`);const row={};for(let i=0;i<schema.length;i++)if(!schema[i].startsWith('_unused'))row[schema[i]]=/^-?\d+$/.test(cells[i])?Number(cells[i]):cells[i];if(!Number.isSafeInteger(row.Seq)||row.Seq<0)throw Error('RexEX invalid table row');tables[key].set(row.Seq,row)}
   }continue
  }
  let manifest;try{manifest=await readFile(store.files.get(name)+'.manifest','utf8')}catch(e){if(e.code==='ENOENT'){warnings.push('Missing bundle manifest: '+name);continue}throw e}
  for(const line of manifest.split(/\r?\n/)){const match=/^- (Assets\/[^\r\n]+\.(png|jpe?g|wav|ogg|mp3))$/i.exec(line);if(!match)continue;const internal=match[1],stem=path.posix.basename(internal).replace(/\.[^.]+$/,''),type=/^(?:png|jpe?g)$/i.test(match[2])?'image':'audio',key=name+'/'+stem;if(type==='image'&&!/^(?:hcg_|chara_t_|bg_|sn_)/.test(stem))continue;if(locations.has(key))throw Error('RexEX duplicate resource: '+key)
   const rel=`${type}/${name}/${stem}.${type==='image'?'png':'ogg'}`;locations.set(key,internal);assets[key]=add(rel,{file:store.files.get(name),identity:internal},async()=>{const object=await mediaObject(name,stem,type);if(!object)throw Error('RexEX native asset absent: '+internal);return store.media(object)})
  }
 }
 const byEvent=new Map();for(const row of tables.EventInfo.values())if(row.EventSeq&&row.EventCmd&&row.MessageValue!=='DUMMY'){if(!byEvent.has(row.EventSeq))byEvent.set(row.EventSeq,[]);byEvent.get(row.EventSeq).push(row)}
 for(const rows of byEvent.values())rows.sort((a,b)=>a.EventNo-b.EventNo||a.Seq-b.Seq)
 const all=[],special=[];for(const[id,rows]of byEvent){const name='event-'+pad(id)+'.rex',rel=cfg.dir+'/script/'+name;scripts.push({name,data:{format:'rexex-event/1',event:id,rows}});all.push({event:id,script:rel,name:'Event '+id,text:rows.filter(r=>[21,55].includes(r.EventCmd)).length})}
 // IsExistGame is editor bookkeeping; the native gallery uses loaded IsEnable
 // rows. Filtering it would incorrectly hide almost all appended scenes.
 for(const row of tables.ScenarioHScene.values()){const event=all.find(e=>e.event===row.EventSeq);if(!row.Seq||!event)continue;const key='asset_'+pad(row.ReleaseKb,2)+'_evcg_thumb/sn_'+pad(row.Seq);special.push({...row,script:event.script,title:clean(row.Title)||event.name,thumb:assets[key]||''})}
 const data=Object.fromEntries(Object.entries(tables).filter(([key])=>key!=='EventInfo').map(([key,rows])=>[key,Object.fromEntries(rows)]));api.context={format:'rexex-context/1',assets,tables:data,scenes:all,special,warnings}
}
