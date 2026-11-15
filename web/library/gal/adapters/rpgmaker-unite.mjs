import * as rpg from './rpgmaker-json.mjs'
export const ADAPTER_ID='rpgmaker-unite',DEFAULT_OPTIONS={dir:'arc'}
export const sniff=t=>/^\s*\{\s*"format"\s*:\s*"rpgmaker-unite\/1"/.test(String(t).slice(0,128))
export const contextFiles=o=>[(o?.dir||'arc')+'/native.json'],contextDirs=o=>[(o?.dir||'arc')+'/res'],contextTextFilter=()=>()=>false
export async function prepare({texts={},options}){
 const d=JSON.parse(texts[contextFiles(options)[0]]||'null');if(d?.format!=='rpgmaker-unite-context/1')throw Error('Unite native context missing')
 const o=rpg.optionsOf({root:d.root,maps:{enabled:false}}),ctx=await rpg.prepare({texts:d.texts,files:d.files,options:o,toResourcePath:p=>p.startsWith(d.root+'/')?p.slice(d.root.length+1):p})
 ctx.unite=d;ctx.commandCompiler=(c,{emit,flush,variable,raw,stats,serial})=>{
  if(c.code!==90707)return false
  const[kind,r]=c.parameters,p=r.parameters||[],diag=()=>raw('unite:'+r.code,{source:r,kind})
  if(kind==='condition'){
   const id=variable(d.unknownConditionVariable);diag();emit({op:'choice',id:'unite-condition:'+serial(),var:id,options:[{value:1,segments:[{text:'原生条件成立（未读取游戏存档）'}]},{value:0,segments:[{text:'原生条件不成立'}]}]});stats.choices++;flush();return true
  }
  if(kind!=='plugin'){diag();return true}
  let args;try{args=Object.fromEntries(JSON.parse(p[2]||'[]').map(x=>[x.key,x.value.replace(/^\\?"|\\?"$/g,'')]))}catch{diag();return true}
  if(p[0]==='VoiceEvent'){
   const name=String(args.clipName||'').replace(/\.[^.]+$/,'')
   if(['PlayVoice','PlayBgv'].includes(p[1])){const src='audio/voice/'+name+'.ogg';if(!ctx.files.has(src)){raw('unite:missing-voice',src);return true}emit(p[1]==='PlayVoice'?{op:'voiceStop'}:{op:'bgvoiceOff',slot:'unite-bgv'});emit({op:p[1]==='PlayVoice'?'voice':'bgvoice',src,...(p[1]==='PlayBgv'?{slot:'unite-bgv',loop:true}:{})});return true}
   if(p[1]==='StopBgv'){emit({op:'bgvoiceOff',slot:'unite-bgv'});return true}diag();return true
  }
  if(p[0]==='CustomSelectInputEvent'&&p[1]==='Call'&&d.selectionVariable){
   const title=d.strings[args.strTitle]||args.strTitle||'',yes=d.strings[args.strYes]||d.strings.sys18||'はい',no=d.strings[args.strNo]||d.strings.sys19||'いいえ'
   if(title){emit({op:'speaker',segments:[]});emit({op:'text',segments:[{text:title}]})}
   emit({op:'choice',id:'unite-select:'+serial(),var:variable(d.selectionVariable),options:[{value:1,segments:[{text:yes}]},{value:2,segments:[{text:no}]}]});stats.choices++;flush();return true
  }
  diag();return true
 }
 const rewrite=node=>{if(node.script){const[rel,scope]=node.script.split('::');if(d.packetMap[rel])node.script=d.packetMap[rel]+(scope?'::'+scope:'')}for(const child of node.children||[])rewrite(child)};rewrite(ctx.catalogTree)
 return ctx
}
export function parse(text,ctx,meta={}){const d=JSON.parse(text);if(d.format!=='rpgmaker-unite/1')throw Error('Not native Unite event');return rpg.parse('',ctx,{...meta,rel:d.rel,sourceRel:d.rel,options:ctx.options})}
export const catalog=ctx=>ctx.catalogTree
export const rpgmakerUniteAdapter={id:ADAPTER_ID,label:'RPG Maker Unite 原生事件',sniff,parse,prepare,catalog,contextFiles,contextDirs,contextTextFilter,sceneInPath:true,sceneThumbs:true}
