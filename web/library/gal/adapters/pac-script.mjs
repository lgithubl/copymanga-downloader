// Debonosu plain #COMMAND scripts. Resource names/placement remain configurable.
import {createOptionsReader,fillTemplate} from './options-merge.mjs'
import {createIndexResolver} from '../resolve.mjs'
export const ADAPTER_ID='pac::script'
export const DEFAULT_OPTIONS={resDir:'arc/res',scriptDir:'data/Script',additionalScriptDir:'data/AdditionalScript',stage:[1280,720],fps:60,maxCommands:100000,images:{bg:['data/Graphics/BG/{id4}.png'],cg:['data/Graphics/CG/{id3}_{variant2}.png','data/Graphics/CG/{id2}_{variant2}.png'],bust:['data/Graphics/BU/{id3}_{variant2}.png']},audio:{bgse:'data/Sound/BGM/{id3}.ogg',bgm:'data/Sound/BGM/{id3}.ogg',se:'data/Sound/SE/{id3}.wav',voice:'data/Sound/voice/{name}.ogg'},special:{enabled:true,label:'特殊场景'}}
const readOptions=createOptionsReader(DEFAULT_OPTIONS)
export const sniff=text=>/^\s*#(?:MSG|MSGVOICE|BGSET|BUSET[23]?|BGMPLAY|CG|FADE)(?:,|\s*$)/m.test(String(text))
export const contextDirs=o=>[readOptions(o).resDir,readOptions(o).scriptDir,readOptions(o).additionalScriptDir]
export const contextWalkLimit=800000
export const contextSampleLimit=8000
export const contextTextFilter=()=>rel=>/\.(txt)$/i.test(rel)
export function prepare({options,files=[],texts={},toResourcePath}){
 const o=readOptions(options),resolver=createIndexResolver({index:new Set(files.map(p=>toResourcePath?toResourcePath(p):p)),cfg:{caseInsensitive:true}})
 const special=[],all=[]
 for(const[rel,text]of Object.entries(texts))if([o.scriptDir,o.additionalScriptDir].some(dir=>rel.startsWith(dir+'/'))&&sniff(text)){const node={id:rel,title:rel.split('/').at(-1).replace(/\.txt$/i,''),script:rel};all.push(node);if(o.special.enabled&&/^#CG\s*,/m.test(text))special.push(node)}
 return{o,resolver,hasIndex:files.length>0,catalogTree:all.length?{children:[...(special.length?[{id:'special',title:o.special.label,children:special}]:[]),{id:'story',title:'剧情',children:all}]}:null}
}
export const catalog=ctx=>ctx?.catalogTree
export function parse(text,ctx={},meta={}){
 const o=ctx.o||readOptions(meta.options),steps=[],stats={messages:0,raw:{},unresolved:{},notes:['仅阅读原始剧情脚本；战斗/奖励/地图操控不模拟。未识别指令保留raw。']};let pending=[],serial=0,background='',cgActive=false
 const emit=c=>pending.push(c),flush=()=>{if(pending.length){steps.push({index:steps.length,commands:pending});pending=[]}},raw=(cmd,args)=>{stats.raw[cmd]=(stats.raw[cmd]||0)+1;emit({op:'raw',cmd,args})}
 const values=(id,variant=0)=>({id:String(id),id2:String(id).padStart(2,'0'),id3:String(id).padStart(3,'0'),id4:String(id).padStart(4,'0'),variant:String(variant),variant2:String(variant).padStart(2,'0')})
 const resolve=candidates=>{for(const name of candidates){const found=ctx.resolver?.resolve(name);if(found)return found}if(!ctx.hasIndex)return candidates[0]||'';const key=candidates[0]||'empty';stats.unresolved[key]=(stats.unresolved[key]||0)+1;return''}
 const image=(kind,id,variant=0)=>resolve((o.images[kind]||[]).map(t=>fillTemplate(t,values(id,variant))))
 const audio=(kind,id)=>resolve([fillTemplate(o.audio[kind],{...values(id),name:id})])
 const voice=(name,slot='main')=>{const src=audio('voice',name);if(src)emit(slot==='main'?{op:'voice',src,kind:'voice'}:{op:'bgvoice',slot:'pac-voice-'+slot,src,kind:'voice',loop:false,token:String(serial),volume:1})}
 const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/)
 for(let i=0;i<lines.length;i++){
  if(++serial>o.maxCommands)throw Error('PAC 剧情指令超过上限')
  const line=lines[i].trim();if(!line||line.startsWith('//')||line.startsWith('['))continue
  const m=/^#([A-Z0-9_]+)\s*(?:,(.*))?$/.exec(line)
  if(!m){raw('unbound-text',line);continue}
  const code=m[1],args=(m[2]||'').split(',').map(v=>v.trim()).filter(Boolean),number=k=>Number(args[k])||0
  const block=()=>{const out=[];while(i+1<lines.length&&!/^\s*#/.test(lines[i+1])){const value=lines[++i].trim();if(value&&!value.startsWith('//'))out.push(value)}return out}
  if(code==='MSG'||code==='MSGVOICE'){
   const body=block();if(code==='MSGVOICE')voice(body.shift()||'')
   const speaker=body.shift()||'';emit({op:'speaker',segments:[{text:speaker}]});emit({op:'text',segments:[{text:body.join('\n')}]});stats.messages++;flush()
  }else if(['VOICE','VOICE2'].includes(code)){
   const body=block(),name=body.at(-1)||args.at(-1);if(name)voice(name,code==='VOICE2'?String(parseInt(body[0])||0):'main')
  }else if(code==='BGSET'||code==='CG'){
   const src=image(code==='CG'?'cg':'bg',args[0],args[1]);if(code==='BGSET'){background=src;if(src&&!cgActive)emit({op:'bg',src})}else if(src){cgActive=true;emit({op:'bg',src,cg:true})}
  }else if(code==='CGOUT'){cgActive=false;emit(background?{op:'bg',src:background}:{op:'bgoff'})}
  else if(code==='BGOUT'){background='';if(!cgActive)emit({op:'bgoff'})}
  else if(/^BUSET[23]?$/.test(code)){
   const slot='pac-bust-'+(code.slice(5)||'1'),src=image('bust',args[0],args[1]);if(src)emit({op:'overlay',slot,kind:'stand',src,stage:o.stage,x:(number(2)-1)*o.stage[0]*.3,y:0,anchor:[.5,.5],fit:'contain',z:10})
  }else if(code==='BUOUT')emit({op:'overlayOff',slot:'pac-bust-'+String(number(0)+1)})
  else if(['BGMPLAY','SEPLAY','BGSPLAY'].includes(code)){
   const kind=code==='BGMPLAY'?'bgm':code==='SEPLAY'?'se':'bgse',src=audio(kind,args[0]);if(src)emit({op:kind,src,...(kind==='bgse'?{loop:true}:{})})
  }else if(code==='VOICESTOP')emit({op:'bgvoiceOff',prefix:'pac-voice-'})
  else if(code==='BGMSTOP')emit({op:'bgmStop'})
  else if(code==='BGSSTOP')emit({op:'bgseStop'})
  else if(code==='MSGWINDOW_ON'||code==='MSGWINDOW_OFF')emit({op:'ui',visible:code==='MSGWINDOW_ON'})
  else if(code==='WAIT')emit({op:'wait',seconds:Math.min(60,number(0)/o.fps)})
  else if(code==='FADE'&&args.length>=4)emit({op:'fade',to:number(3)?'black':'clear',seconds:Math.min(60,number(4)/o.fps)})
  else if(['END','EVENTEND','KEYWAIT','MSGCLEAR'].includes(code)){if(code==='END'||code==='EVENTEND')break;flush()}
  else if(code==='LABELJUMP'){if(args.length===2&&args.every(x=>/^[0-9]+$/.test(x)))emit({op:'goto',script:String(number(0)).padStart(2,'0')+'_'+String(number(1)).padStart(4,'0')});else raw(code,args);break}
  else raw(code,args)
 }
 flush();if(!steps.length)steps.push({index:0,commands:[]});return{steps,stats}
}
export const pacScriptAdapter={id:ADAPTER_ID,label:'Debonosu PAC 剧情（#MSG）',sniff,parse,prepare,contextDirs,contextWalkLimit,contextSampleLimit,contextTextFilter,catalog}
