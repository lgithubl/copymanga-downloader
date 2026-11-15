import {naninovelFlow} from '../naninovel-flow.mjs'
export const ADAPTER_ID='naninovel::script'
export const DEFAULT_OPTIONS={dir:'arc'}
export const sniff=text=>/^\s*\{\s*"format"\s*:\s*"naninovel-script\/1"/.test(String(text).slice(0,128))
export const contextFiles=o=>[(o?.dir||'arc')+'/native.json']
export const contextDirs=o=>[(o?.dir||'arc')+'/res']
export const contextTextFilter=()=>()=>false
export function prepare({texts={},options}){const file=contextFiles(options)[0];if(!texts[file])throw Error('Naninovel native context missing; refresh layout/list');const d=JSON.parse(texts[file]);if(d.format!=='naninovel-context/1')throw Error('Invalid Naninovel context');return d}
export function catalog(ctx){const nodes=(ctx.scenes||[]).map(s=>({id:s.script,script:s.script,title:s.name})),special=(ctx.scenes||[]).filter(s=>s.cg).map(s=>({id:'special:'+s.script,script:s.script,title:s.name}));return{title:'Naninovel',children:[...(special.length?[{id:'special',title:'特殊场景',children:special}]:[]),{id:'all',title:'全部剧情',children:nodes}]}}
const segments=text=>[{text:String(text??'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/?(?:b|i|size|color|ruby)(?:=[^>]*)?>/gi,'')}]
export function parse(text,ctx,meta={}){
 if(ctx?.resourcesBuild)return naninovelFlow(JSON.parse(text),ctx,meta,parseLinear)
 return parseLinear(text,ctx,meta)
}
function parseLinear(text,ctx,meta={}){
 const d=JSON.parse(text);if(d.format!=='naninovel-script/1'||!ctx)throw Error('Naninovel native script/context required')
 const{configs,assets}=ctx,camera=configs.CameraConfiguration,stage=[camera.ReferenceResolution.x,camera.ReferenceResolution.y],ppu=camera.ReferencePPU,steps=[],stats={messages:0,voices:0,raw:{},unresolved:{},notes:['Naninovel 原生 playlist；图片/语音使用原始资源引用。过渡使用终点，未还原命令按原行记录。']},actors=new Map(),variables=Object.fromEntries((configs.CustomVariablesConfiguration?.PredefinedVariables||[]).map(v=>{let value=v.value;try{value=JSON.parse(value)}catch{}return[v.name,String(value)]})),substitute=s=>String(s||'').replace(/\{(\w+)\}/g,(whole,k)=>variables[k]??whole);let commands=[],next
 const push=(...cs)=>commands.push(...cs),raw=(c,why=c.type)=>{stats.raw[why]=(stats.raw[why]||0)+1;push({op:'raw',cmd:why,args:[d.name,c.source+1,c.data]})},find=(key,c)=>{const src=assets[key];if(!src){stats.unresolved[key]=(stats.unresolved[key]||0)+1;raw(c,'missing:'+key)}return src}
 const flush=()=>{if(commands.length){steps.push({index:steps.length,commands});commands=[]}}
 const metadata=(kind,id)=>{const cfg=configs[kind==='character'?'CharactersConfiguration':'BackgroundsConfiguration'],i=cfg.Metadata.ids.findIndex(k=>k.toLowerCase()===id.toLowerCase());return[cfg,i<0?cfg.DefaultMetadata:cfg.Metadata.metas[i]]}
 for(const c of d.commands){
  const v=c.data||{},type=c.type
  if(type==='NativeBoundary'){flush();continue}
  if(type==='NativeGoto'){push({op:'goto',script:v.script});flush();continue}
  if(type==='HideAllActors'){for(const[k,s]of actors){s.visible=false;push({op:'overlayOff',slot:'nani:'+k})}continue}
  if(v.ConditionalExpression||v.InvertedConditionalExpression){raw(c,'conditional-command');continue}
  if(type==='PrintText'){
   push({op:'voiceStop'},{op:'ui',visible:true});const author=v.AuthorId||'',parts=v.Text?.parts||[],body=parts.map(p=>p.text||d.texts[p.id]||'').join('')
   const[,m]=metadata('character',author);let name=m.DisplayName||author
   if(!m.HasName)name='';name=substitute(name)
   if(v.AuthorLabel?.parts?.length)name=v.AuthorLabel.parts.map(p=>p.text||d.texts[p.id]||'').join('')
   push({op:'speaker',segments:segments(name)},{op:'text',segments:segments(substitute(body))})
   for(const p of parts){const voice=assets['Voice/'+p.id];if(voice&&configs.AudioConfiguration.EnableAutoVoicing){push({op:'voice',src:voice});stats.voices++;break}}
   stats.messages++;flush();continue
  }
  if(type==='ModifyBackground'||type==='ModifyCharacter'){
   const kind=type==='ModifyCharacter'?'character':'background',pair=v.IdAndAppearance||v.AppearanceAndTransition||{},id=(kind==='character'?pair.name:'')||v.Id||(kind==='background'?'MainBackground':''),[cfg,m]=metadata(kind,id),key=kind+':'+id,origin=ctx.resourcesBuild&&kind==='character'?cfg.SceneOrigin:null,old=actors.get(key)||{appearance:'',position:{x:origin?(origin.x-.5)*stage[0]/ppu:0,y:origin?(origin.y-.5)*stage[1]/ppu:0,z:0},scale:{x:1,y:1,z:1},alpha:1,visible:true},state=structuredClone(old)
   if(!actors.has(key)){const p=m.Poses?.find(p=>p.name==='');if(p)for(const k of p.overriddenProperties)state[k]=p.actorState[k]}
   if(cfg.AutoShowOnModify)state.visible=true
   if((kind==='background'?pair.name:pair.value)||v.Appearance)state.appearance=(kind==='background'?pair.name:pair.value)||v.Appearance
   if(v.Pose){const p=[...(m.Poses||[]),...(cfg.SharedPoses||[])].find(p=>p.name===v.Pose);if(!p)raw(c,'missing-pose:'+id+':'+v.Pose);else for(const k of p.overriddenProperties){if(k==='tintColor')state.alpha=p.actorState.tintColor.a;else state[k]=p.actorState[k]}}
   const position=v.Position||(ctx.resourcesBuild?v.ScenePosition:null)
   if(Array.isArray(position)){state.position={x:(position[0]/100-.5)*stage[0]/ppu,y:(position[1]/100-.5)*stage[1]/ppu,z:state.position.z}}
   if(Array.isArray(v.Scale)){const s=v.Scale;state.scale={x:s[0]??1,y:s[1]??s[0]??1,z:s[2]??1}}
   if(v.Visible!==undefined)state.visible=!!v.Visible
   actors.set(key,state);const slot='nani:'+key
   if(!state.visible){push({op:'overlayOff',slot});continue}
   let resource='Naninovel/'+(kind==='character'?'Characters/':'Backgrounds/')+id+(state.appearance?'/'+state.appearance:'')
   if(!assets[resource]){const candidates=Object.keys(assets).filter(k=>k.toLowerCase()===(resource.toLowerCase())||!state.appearance&&k.toLowerCase().startsWith(resource.toLowerCase()+'/'));if(candidates.length===1)resource=candidates[0]}
   const src=find(resource,c);if(!src)continue
   push({op:'overlay',slot,src,...(ctx.resourcesBuild?{kind:kind==='background'?(id==='MainBackground'?'background':'still'):'character'}:{}),...(kind==='background'&&id!=='MainBackground'?{cg:true}:{}),fit:kind==='background'?'cover':'none',stage,anchor:[m.Pivot.x,1-m.Pivot.y],x:state.position.x*ppu,y:-state.position.y*ppu,scaleX:state.scale.x*ppu/m.PixelsPerUnit,scaleY:state.scale.y*ppu/m.PixelsPerUnit,alpha:state.alpha,z:(kind==='background'?-1000:0)-state.position.z*100,fade:v.Duration||0});continue
  }
  if(type==='HideAllCharacters'||type==='HideActors'){
   const ids=typeof v.ActorIds==='string'?v.ActorIds.split(','):Array.isArray(v.ActorIds)?v.ActorIds:null
   if(type==='HideActors'&&!ids){raw(c);continue}
   for(const[k,s]of actors)if((type==='HideAllCharacters'?k.startsWith('character:'):ids.includes(k.slice(k.indexOf(':')+1)))){s.visible=false;push({op:'overlayOff',slot:'nani:'+k})}continue
  }
  if(type==='PlayBgm'||type==='PlaySfx'||type==='PlaySfxFast'){
   const key=v.BgmPath||v.SfxPath,src=find('Naninovel/Audio/'+key,c)
   if(src){
    if(type==='PlayBgm')push({op:'bgm',src,volume:v.Volume??1,loop:ctx.resourcesBuild?(v.Loop??true):!!v.Loop})
    else if(v.Loop||/^Bgv_/i.test(key)){const human=/^Bgv_/i.test(key)||ctx.resourcesBuild&&/(?:^|\/)Voice$/i.test(v.GroupPath||'');push({op:'bgvoice',slot:'nani-sfx:'+key,src,kind:human?'bgvoice':'bgse',volume:v.Volume??1,loop:!!v.Loop,token:d.name+':'+c.source});if(human)stats.backgroundVoices=(stats.backgroundVoices||0)+1}
    else push({op:'se',src,volume:v.Volume??1,loop:false})
   }continue
  }
  if(type==='StopBgm'){push({op:'bgmStop'});continue}
  if(type==='StopSfx'){push(v.SfxPath?{op:'bgvoiceOff',slot:'nani-sfx:'+v.SfxPath}:{op:'bgvoiceOff',prefix:'nani-sfx:'});continue}
  if(type==='Wait'){const seconds=Number(v.WaitMode);if(Number.isFinite(seconds))push({op:'wait',seconds});else raw(c);continue}
  if(type==='HidePrinter'){push({op:'ui',visible:false});continue}
  if(type==='ShowPrinter'){push({op:'ui',visible:true});continue}
  if(type==='Flash'&&ctx.resourcesBuild){push({op:'flash',color:v.Color||'#fff',count:1,seconds:v.Time??.2});continue}
  if(type==='FadeInCommand'){push({op:'fade',to:'clear',seconds:v.time??0});continue}
  if(type==='FadeOutCommand'||type==='FadeOutAllCommand'){push({op:'fade',to:v.isWhite?'white':'black',seconds:v.time??0});continue}
  if(type==='FlashCommand'||type==='OrgasmFlashCommand'){push({op:'flash',color:'#fff',count:1,seconds:v.time??.2});continue}
  if(type==='Goto'){next=v.Path;break}
  if(['BackToGameCommand','Stop','Return','ExitToTitle'].includes(type))break
  raw(c)
 }
 flush();return{steps,stats,...(next?{next:{script:next+'.nani'}}:{})}
}
export const naninovelScriptAdapter={id:ADAPTER_ID,label:'Naninovel 原生剧本',sniff,parse,prepare,contextFiles,contextDirs,contextTextFilter,catalog,sceneThumbs:true,sceneInPath:true}
