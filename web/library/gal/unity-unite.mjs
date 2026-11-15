// RPG Maker Unite stores UUID references and string parameters, not MV/MZ JSON.
// Convert only commands whose native processor layout has been checked. Keep
// other commands verbatim for diagnostics in the shared RPG reading compiler.
const number=(v,label)=>{const n=Number(v);if(!Number.isFinite(n))throw Error('Unite invalid number '+label+': '+v);return n}
const bare=s=>String(s||'').replace(/\.[^.]+$/,'')
export function normalizeUnite(data,strings={}){
 const localize=value=>strings[value]??value
 const values=Object.values(data),named=n=>{const d=values.find(v=>v.m_Name===n);if(!d)throw Error('Unite database missing: '+n);return d.dataModel??d.dataModels},flags=named('flags'),commonIndex=named('eventCommon'),eventIndex=named('eventMap'),systemNative=named('system'),actorNative=named('characterActor'),idMap=rows=>new Map(rows.map((r,i)=>[r.id||r.eventId,i+1])),switches=idMap(flags.switches),variables=idMap(flags.variables),commonIds=idMap(commonIndex),actorIds=idMap(actorNative),mapIds=new Map(),eventIds=new Map(),mapNames=new Map(),sourceEvents=new Map()
 for(const e of eventIndex){if(!mapIds.has(e.mapId))mapIds.set(e.mapId,mapIds.size+1);const key=e.mapId;if(!eventIds.has(key))eventIds.set(key,new Map());eventIds.get(key).set(e.eventId,eventIds.get(key).size+1)}
 for(const d of values)if(d.dataModel?.eventCommands){const e=d.dataModel;sourceEvents.set(e.id+':'+e.page,e)}
 for(const e of sourceEvents.values())for(const r of e.eventCommands)if(r.code===201&&r.parameters[2]&&!mapIds.has(r.parameters[2]))mapIds.set(r.parameters[2],mapIds.size+1)
 const get=(map,id,kind)=>{const n=map.get(id);if(!n)throw Error('Unite '+kind+' UUID absent: '+id);return n},v=id=>get(variables,id,'variable'),s=id=>get(switches,id,'switch'),native=(r,kind='command')=>({code:90707,indent:r.indent,parameters:[kind,r]})
 const convert=list=>list.flatMap((r,i)=>{
  const p=r.parameters||[],n=i=>number(p[i],r.code+':'+i),out=parameters=>({...r,parameters,route:undefined})
  if(r.code===101){const actor=actorNative[(actorIds.get(p[9])||0)-1];return out([p[7]||actor?.image?.face||'',0,n(2),n(1),localize(p[6]||actor?.basic?.memo||actor?.basic?.name||'')])}
  if(r.code===401)return out([p[0]])
  if(r.code===117)return out([get(commonIds,p[0],'common event')])
  if(r.code===121)return out(p[0]==='0'?[s(p[1]),s(p[1]),n(3)]:[n(1),n(2),n(3)])
  if(r.code===122){const first=p[8]==='1'?n(0):v(p[0]),last=p[8]==='1'?n(1):first;if(p[3]==='0')return out([first,last,n(2),0,n(4)]);if(p[3]==='1')return out([first,last,n(2),1,v(p[4])]);return native(r)}
  if(r.code===111){if(p[3]==='1')return out([0,s(p[4]),n(5)]);if(p[6]==='1')return out([1,v(p[7]),p[9]==='1'?0:1,p[9]==='1'?n(10):v(p[11]),n(8)]);if(p[12]==='1')return out([2,['A','B','C','D'][n(13)],n(14)]);return[native(r,'condition'),out([1,variables.size+1,0,1,0])]}
  if(r.code===123)return out([p[0],n(1)])
  if(r.code===201){const id=get(mapIds,p[2],'map');mapNames.set(id,p[1]);if(p[0]==='1')return native(r,'variable-map-transfer');return out([0,id,n(3),-n(4),[2,4,6,8][n(5)]||2,n(6)])}
  if(r.code===231||r.code===232){const q=p.slice(0,r.code===231?10:12).map((x,j)=>j===1?x:p[3]==='1'&&[4,5].includes(j)?v(x):number(x,r.code+':'+j));return out(q)}
  if([241,245,249,250].includes(r.code))return out([{name:bare(p[0]),volume:n(1),pitch:n(2),pan:n(3)}])
  if(r.code===707)return native(r,'plugin')
  if(r.code===102){const branches=[];for(let k=i+1;k<list.length;k++){const x=list[k];if(x.indent===r.indent&&x.code===404)break;if(x.indent===r.indent&&x.code===402)branches.push(x.parameters[2])}return out([branches,n(2),n(3),n(1),n(4)])}
  if(r.code===402)return out([n(0)-1,p[2]])
  if([0,115,118,119,221,222,230,235,242,243,244,246,247,248,251,411,412,404].includes(r.code))return out(p.map(x=>/^[-+]?\d+(?:\.\d+)?$/.test(x)?Number(x):x))
  return native(r)
 })
 const common=[null,...commonIndex.map((e,i)=>({id:i+1,name:e.name,trigger:0,switchId:0,list:convert(sourceEvents.get(e.eventId+':0')?.eventCommands||[])}))],maps=[]
 for(const[id,num]of mapIds){const events=[null];for(const e of eventIndex.filter(e=>e.mapId===id))events.push({id:eventIds.get(id).get(e.eventId),name:e.name,x:e.x,y:-e.y,pages:e.pages.map((p,i)=>{
  const c=p.condition||{},one=c.switchOne||{},two=c.switchTwo||{},vr=c.variables||{},self=c.selfSwitch||{}
  return{trigger:p.eventTrigger,conditions:{switch1Valid:!!one.enabled,switch1Id:one.enabled?s(one.switchId):0,switch2Valid:!!two.enabled,switch2Id:two.enabled?s(two.switchId):0,variableValid:!!vr.enabled,variableId:vr.enabled?v(vr.variableId):0,variableValue:vr.value||0,selfSwitchValid:!!self.enabled,selfSwitchCh:self.selfSwitch||'A'},list:convert(sourceEvents.get(e.eventId+':'+i)?.eventCommands||[])}
 })});maps.push({id:num,sourceId:id,autoplayBgm:false,parallaxName:'',scrollType:0,width:1,height:1,tilesetId:0,data:[],events})}
 const size=systemNative.DisplaySize[systemNative.displaySize],system={gameTitle:'RPG Maker Unite',advanced:{screenWidth:size.x,screenHeight:size.y},switches:['',...flags.switches.map(s=>s.name)],variables:['',...flags.variables.map(v=>v.name),'未读取的原生条件'],partyMembers:[]},actors=[null,...actorNative.map((a,i)=>({id:i+1,name:a.basic.memo||a.basic.name}))]
 return{common,maps,system,actors,mapInfo:[null,...maps.map(m=>({id:m.id,name:mapNames.get(m.id)||m.sourceId}))],selectionVariable:flags.variables.findIndex(v=>v.name==='選択肢結果')+1,unknownConditionVariable:variables.size+1}
}
export async function indexUnite(api){
 const{store,catalog,catalogResource,cfg,scripts}=api,raw={}
 for(const file of store.files.keys())if(/^others_assets_(?:event_|so_|map_[0-9a-f-]+\.asset_)/.test(file)){const b=await store.bundle(file);for(const a of b.assets)for(const o of a.objects.filter(o=>o.classId===114))raw[file]=await store.decode(o)}
 const files=[],seen=new Map(),folders={Pictures:'img/pictures',Faces:'img/faces',Parallaxes:'img/parallaxes',BGM:'audio/bgm',BGS:'audio/bgs',SE:'audio/se',ME:'audio/me',VOICE:'audio/voice'},strings={}
 const locale=catalog.find(l=>l.key==='SystemTable_ja')
 if(locale){const o=await store.catalogAsset(locale),d=await store.decode(o),sharedLocation=catalog.find(l=>l.internal.endsWith('/SystemTable Shared Data.asset'));if(!sharedLocation)throw Error('Unite SystemTable shared keys missing');const shared=await store.catalogAsset(sharedLocation),table=await store.decode(shared),keys=new Map(table.m_Entries.map(e=>[String(e.m_Id),e.m_Key]));for(const e of d.m_TableData){const key=keys.get(String(e.m_Id));if(key)strings[key]=e.m_Localized}}
 const normalized=normalizeUnite(raw,strings)
 const definitions=new Map(Object.values(raw).filter(v=>v.dataModel?.width&&v.dataModel?.height&&v.dataModel?.layerJsons).map(v=>[v.dataModel.id,v.dataModel]))
 let nativeMaps=false
 for(const map of normalized.maps){
  const definition=definitions.get(map.sourceId),location=catalog.find(l=>l.key==='SavedMaps/'+map.sourceId+'.prefab')
  if(!definition||!location)continue
  const width=Number(definition.width),height=Number(definition.height)
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>65536)throw Error('Unite native map dimensions invalid: '+map.sourceId)
  Object.assign(map,{width,height,data:Array(width*height*4).fill(0),nativeImage:'img/maps/'+map.sourceId+'.png'})
  files.push(api.add(map.nativeImage,{file:store.files.get(location.bundles[0].toLowerCase())},async()=>{const{renderUniteMap}=await import('./unity-unite-map.mjs');return renderUniteMap(store,location,{id:map.sourceId,width,height})}))
  nativeMaps=true
 }
 if(nativeMaps){normalized.system.tileSize=96;for(const map of normalized.maps)if(!map.data.length)map.data=[0,0,0,0]}
 for(const loc of catalog){const split=loc.key.indexOf('/'),kind=loc.key.slice(0,split),folder=folders[kind];if(!folder||! /\.(?:png|ogg|mp3|wav)$/i.test(loc.internal))continue;const name=folder+'/'+loc.key.slice(split+1).replace(/\.(?:mp3|wav)$/i,'.ogg');if(seen.has(name)){if(seen.get(name)!==loc.internal)throw Error('Unite ambiguous resource '+name);continue}seen.set(name,loc.internal);files.push(catalogResource(name,loc))}
 const root=cfg.dir+'/res',texts={},packets=[];const add=(rel,data)=>{const key=root+'/'+rel;texts[key]=JSON.stringify(data);files.push(key);packets.push({rel:key,data});scripts.push({name:rel.replace(/\.json$/,'.unite'),data:{format:'rpgmaker-unite/1',rel:key}})}
 add('data/CommonEvents.json',normalized.common);for(const m of normalized.maps)add('data/Map'+String(m.id).padStart(3,'0')+'.json',m)
 for(const[name,data]of Object.entries({'System':normalized.system,'Actors':normalized.actors,'MapInfos':normalized.mapInfo,'Tilesets':nativeMaps?[{tilesetNames:[],flags:[]}]:[]}))texts[root+'/data/'+name+'.json']=JSON.stringify(data)
 texts[root+'/js/plugins.js']='var $plugins=[{"name":"SimpleVoice","status":true,"parameters":{"FolderName":"voice"}}];'
 api.context={format:'rpgmaker-unite-context/1',root,texts,files,nativeMaps,selectionVariable:normalized.selectionVariable,unknownConditionVariable:normalized.unknownConditionVariable,strings,packetMap:Object.fromEntries(packets.map(p=>[p.rel,cfg.dir+'/script/'+p.rel.slice(root.length+1).replace(/\.json$/,'.unite')]))}
}
