// Cocos stores each episode's introduction, main scene and epilogue separately.
// Keep assets and labels scoped to their original script when joining playback.
export function groupMeshiEpisodes(entries,execution=new Map()){
 const byPath=new Map(entries.map(e=>[e.name,e])),used=new Set(),out=[]
 for(const[id,names]of execution){const parts=names.map(name=>byPath.get(name.startsWith('json/')?name:'json/'+name)).filter(Boolean);if(!parts.length)continue;const name=parts[0].name.split('/').at(-1);out.push({name,key:'episode:'+id,episodeId:id,special:names.some(n=>/_H[23]?$/.test(n)),parts});for(const p of parts)used.add(p.name)}
 for(const entry of entries){if(used.has(entry.name))continue;const base=entry.name.split('/').at(-1),match=/^(.*_H)([23])?$/.exec(base)
  if(match){const directory=entry.name.slice(0,-base.length),first=byPath.get(directory+match[1]);if(first&&!used.has(first.name)){const parts=['','2','3'].map(s=>byPath.get(directory+match[1]+s)).filter(Boolean);for(const p of parts)used.add(p.name);out.push({name:match[1],key:directory+match[1],parts,special:true});continue}}
  used.add(entry.name);out.push({name:base,key:entry.name,parts:[entry],special:/_H[23]?$/.test(base)})
 }
 return out
}
const types={chara:0,bg:1,still:2,face:3,bgm:4,se:5,vo:6,particle:7,sprite:8,mask:9,comicMark:10,enemy:11}
export function mergeMeshiEpisodes(parts){
 if(!parts.length)throw Error('meshiagirl episode has no parts')
 const loadData=[],tokenData=[];let id=1000000
 for(const[partIndex,part]of parts.entries()){
  const scope='part'+partIndex+':',ids=new Map(),label=v=>scope+String(v),source=part.name
  for(const asset of part.json.loadData){const next={...asset,id:++id};ids.set(asset.type+':'+asset.id,next.id);loadData.push(next)}
  const remap=(type,value)=>typeof value==='number'?(ids.get(type+':'+value)??value):value
  tokenData.push({type:2,label:'meshi-part:'+(['前篇','主体','后篇'][partIndex]||String(partIndex+1)),part:true,_script:source})
  for(const[index,original]of part.json.tokenData.entries()){
   const t={...original,_script:source,_sourceToken:index}
   if(t.type===2)t.label=label(t.label)
   if(t.type===0&&typeof t.faceId==='number')t.faceId=remap(3,t.faceId)
   if(t.type===1){t.params=[...(t.params||[])];const p=t.params
    if([1,12,36,37].includes(t.commandIdx))p[3]=remap(types[p[2]],p[3])
    if(t.commandIdx===26)p[1]=remap(7,p[1])
    if(t.commandIdx===17||t.commandIdx===68)p[0]=label(p[0])
    if(t.commandIdx===16)for(let i=1;i<p.length;i+=3)p[i]=label(p[i])
   }
   tokenData.push(t)
  }
 }
 return{name:parts[0].name,json:{loadData,tokenData}}
}
