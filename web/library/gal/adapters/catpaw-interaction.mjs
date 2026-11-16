// Native data becomes a declarative interaction scene; no game assemblies run.
const lower=s=>String(s||'').toLowerCase()
const labels={Tentacle:'触手',Whip:'鞭子',Vibrator:'震动器',Hand:'手',Finger:'手指',candle:'蜡烛',jj:'互动 5',jjshoot:'互动 6',cloth:'服装',socks:'袜子'}
const label=(s,fallback)=>labels[String(s||'').replace(/[0-9_]+$/g,'')]||fallback||s
export function catpawInteraction(ctx,entry){
 if(ctx.variant==='future')return futureInteraction(ctx,entry)
 const missing=[],prefix=ctx.prefix+'/',media=k=>ctx.media[lower(prefix+k)]||'',tr=k=>ctx.translations[k]||String(k||''),roles=[]
 for(const r of Object.values(ctx.configs.roleConfig||{})){
  const key=ctx.prefabs[lower(prefix+'model/role/'+r.dreamBoxRole)],model=ctx.models[key]
  if(!model){missing.push('角色模型：'+r.id+'/'+r.dreamBoxRole);continue}
  const variables=name=>{const t=r.roleTool?.find(t=>t.name===name);if(!t){missing.push('服装参数：'+r.id+'/'+name);return null}return Object.fromEntries([[t.key1||t.key,t.value1??t.value],[t.key2,t.value2]].filter(([k,v])=>k&&Number.isFinite(v)))}
  const choice=(id,icon,title)=>{const v=variables(id);return{id,title:(title||id)+(v?'':'（原作参数缺失）'),icon:media('ui/clothesicon/'+icon),variables:v||{},...v?{}:{disabled:true}}}
  const outfits=(r.cloths||[]).map((id,index)=>{const c=ctx.configs.clothConfig?.[id];if(!c){missing.push('服装配置：'+id);return null}const groups=[],body=[choice(c.cloth1.key,c.cloth1.icon,'完整'),...(c.cloth1.key2?[choice(c.cloth1.key2,c.cloth1.icon3,'破损')]:[])].filter(Boolean);groups.push({id:'body',title:'服装状态',choices:body,default:c.defaultClothes?.broken&&body[1]?body[1].id:body[0]?.id})
   const socks=[...c.secondRow||[],...c.thirdRow||[]].map(v=>choice(v.key,v.icon,v.key.replace('socks','袜子 ').replace('_dam',' · 破损'))).filter(Boolean);if(socks.length)groups.push({id:'socks',title:'袜子',choices:socks,default:socks.some(x=>x.id===c.defaultClothes?.socks)?c.defaultClothes.socks:socks[0].id})
   for(const [index,a] of (c.fourthRow||[]).entries()){const choices=[choice(a.key+'_off',a.icon2,'关闭'),choice(a.key,a.icon,'开启')].filter(Boolean);if(choices.length===2)groups.push({id:a.key,title:'装饰 '+(index+1),choices,default:c.defaultClothes?.other?.find(x=>x.key===a.key)?.value?a.key:a.key+'_off'})}
   return{id,title:'服装 '+(index+1),icon:media('ui/clothesicon/'+c.cloth1.icon),groups}
  }).filter(Boolean)
  const tools=(r.dbsm||[]).map(id=>{const t=ctx.configs.dbsmConfig?.[id];if(!t){missing.push('互动配置：'+id);return null}return{id,title:label(t.icon,'互动 '+(Number(id)%100000+1)),icon:media('ui/dbsmIcon/'+t.icon),areas:(t.touchArea||[]).map(a=>{
   const group=model.motionLayers?.[a.key];if(!model.hitAreas?.some(h=>h.id===a.area))missing.push('命中区域：'+r.id+'/'+a.area);if(!model.motions.includes(a.key))missing.push('互动动作：'+r.id+'/'+a.key)
   const replies=(a.talks||[]).filter(id=>id!=null).map(id=>{const row=ctx.configs.simpleTalkConfig?.[id];if(!row){missing.push('互动台词：'+id);return null}const voice=row.voice?media('voice/'+row.voice):'',sound=row.sound?media('sound/'+row.sound):'';if(row.voice&&!voice)missing.push('互动语音：'+row.voice);return{id,text:tr(row.talk),voice,sound}}).filter(Boolean)
   return{id:a.area,motion:a.key,layer:group??0,replies}
  })}}).filter(Boolean)
  const background=media('ui/dreamboxbackground/'+r.dreamBoxBackground)
  roles.push({id:r.id,title:tr(r.nameKey),backgrounds:[...(background?[{id:'native',title:'原作背景',short:'原作',src:background}]:[]),{id:'plain',title:'纯色'}],model:{src:model.src,fit:'contain',kind:'actor',loop:true,variablesAfterMotion:true,motionGroups:{...model.defaultMotions}},hitAreas:model.hitAreas||[],outfits,faces:(r.faces||[]).map((f,i)=>({id:f.key,title:'表情 '+(i+1),layer:model.motionLayers?.[f.key]??1,icon:media('ui/faceIcon/'+f.icon)})),tools})
 }
 if(!roles.length)throw Error('Underworld character models are missing; run gal-layout')
 const selected=roles.find(r=>r.id===entry.id)||roles[0],initialVariables=Object.assign({},...(selected.outfits[0]?.groups||[]).map(g=>g.choices.find(c=>c.id===g.default)?.variables||{})),interaction={format:'gal-interaction/1',initialRole:selected.id,roles,diagnostics:[...new Set(missing)]}
 // The initial model also permits the existing card thumbnail renderer to work.
 return{steps:[{index:0,commands:[{op:'live2d',slot:'interaction',...selected.model,variables:initialVariables}]}],stats:{notes:['角色互动预览；选装状态单独保存在浏览器，不读写原作存档'],unresolved:Object.fromEntries(interaction.diagnostics.map(x=>[x,1]))},interaction}
}

// Future's standalone roles use Animator clothing states, not Underworld parameter tables.
function futureInteraction(ctx,entry){
 const roles=[],missing=[],prefix=ctx.prefix+'/',media=k=>ctx.media[lower(prefix+k)]||'',tr=k=>ctx.translations[k]||String(k||'')
 const replies=ids=>(ids||[]).filter(id=>id!=null).map(id=>{const row=ctx.configs.simpleTalkConfig?.[id];if(!row){missing.push('互动台词：'+id);return null}return{id,text:tr(row.talk),voice:media('voice/'+row.voice),sound:row.sound?media('sound/'+row.sound):''}}).filter(Boolean)
 for(const r of Object.values(ctx.configs.roleConfig||{})){
  if(!r.dreamBoxRole)continue
  const key=lower(r.dreamBoxRole),model=ctx.models[ctx.prefabs[key.startsWith(prefix)?key:prefix+'model/role/'+key]]
  if(!model){missing.push('角色模型：'+r.id);continue}
  const motion=(key,title,icon)=>{const supported=model.motions.includes(key);if(!supported)missing.push('服装动作：'+r.id+'/'+key);return{id:key,title,icon:media('ui/clothesicon/'+icon),motionGroups:{[model.motionLayers?.[key]??1]:key},disabled:!supported}}
  const outfits=(r.cloths||[]).map((id,i)=>{const c=ctx.configs.clothConfig?.[id];if(!c){missing.push('服装配置：'+id);return null}const choices=[]
   for(const [key,title] of [['cloth1','完整'],['clothDam1','破损'],...Array.from({length:4},(_,i)=>[['subCloth'+(i+1),'状态 '+(i+1)],['subCloth'+(i+1)+'Dam','状态 '+(i+1)+' · 破损']]).flat()])if(c[key]?.key&&!choices.some(x=>x.id===c[key].key))choices.push(motion(c[key].key,title,c[key].icon))
   const groups=[{id:'clothes',title:'服装状态',choices,default:choices.find(c=>!c.disabled)?.id}]
   for(const [j,t]of[...new Map([...(r.tools||[]),...(c.tools||[])].map(t=>[t.key,t])).values()].entries())groups.push({id:'tool-'+j,title:'装饰 '+(j+1),default:'on',choices:[{id:'on',title:'开启',icon:media('ui/clothesicon/'+t.openIcon),variables:{[t.key]:t.openValue}},{id:'off',title:'关闭',icon:media('ui/clothesicon/'+t.closeIcon),variables:{[t.key]:t.closeValue}}]})
   return{id,title:'服装 '+(i+1),icon:media('ui/clothesicon/'+c.cloth1?.icon),groups}
  }).filter(Boolean)
  const tools=(r.dbsm||[]).map((ids,i)=>{const areas=(Array.isArray(ids)?ids:[ids]).map(id=>{const a=ctx.configs.dbsmConfig?.[id];if(!a){missing.push('互动配置：'+id);return null}const motion=model.motions.includes(a.key)?a.key:model.motions.includes(a.key.trim())?a.key.trim():null;if(!motion)missing.push('互动动作：'+r.id+'/'+a.key);return{id,disabled:!motion,title:'动作 '+(i+1)+(ids.length>1?' · '+(ids.indexOf(id)+1):''),buttonOnly:true,motion,layer:model.motionLayers?.[motion]??0,icon:media('ui/dbsmicon/'+a.icon),replies:replies(a.talks)}}).filter(Boolean);return{id:String(i),title:label(ctx.configs.dbsmConfig?.[ids[0]]?.icon,'互动 '+(i+1)),icon:areas[0]?.icon,areas}}).filter(t=>t.areas.length)
  roles.push({id:r.id,title:tr(r.nameKey),model:{src:model.src,fit:'contain',kind:'actor',loop:true,variablesAfterMotion:true,motionGroups:{...model.defaultMotions}},hitAreas:[],outfits,faces:(r.faces||[]).filter(f=>model.motions.includes(f.key)).map((f,i)=>({id:f.key,title:'表情 '+(i+1),layer:model.motionLayers?.[f.key]??2,icon:media('ui/faceicon/'+f.icon)})),tools})
 }
 if(!roles.length)throw Error('Future character models are missing; run gal-layout')
 const selected=roles.find(r=>r.id===entry.id)||roles[0],outfit=selected.outfits[0],motionGroups={...selected.model.motionGroups};for(const g of outfit?.groups||[])Object.assign(motionGroups,g.choices.find(c=>c.id===g.default)?.motionGroups||{})
 const interaction={format:'gal-interaction/1',initialRole:selected.id,roles,diagnostics:[...new Set(missing)]}
 return{steps:[{index:0,commands:[{op:'live2d',slot:'interaction',...selected.model,motionGroups}]}],stats:{notes:['原作角色互动；动作由原生 dbsm 分组提供；未伪造模型触摸区域或姿势'],unresolved:Object.fromEntries(interaction.diagnostics.map(x=>[x,1]))},interaction}
}
