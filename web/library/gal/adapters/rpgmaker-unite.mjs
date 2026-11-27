import * as rpg from './rpgmaker-json.mjs'
export const ADAPTER_ID='rpgmaker-unite',DEFAULT_OPTIONS={dir:'arc',special:{voiced:false}}
export const sniff=t=>/^\s*\{\s*"format"\s*:\s*"rpgmaker-unite\/1"/.test(String(t).slice(0,128))
export const contextFiles=o=>[(o?.dir||'arc')+'/native.json'],contextDirs=o=>[(o?.dir||'arc')+'/res'],contextTextFilter=()=>()=>false
export async function prepare({texts={},options}){
 const d=JSON.parse(texts[contextFiles(options)[0]]||'null');if(d?.format!=='rpgmaker-unite-context/1')throw Error('Unite native context missing')
 const o=rpg.optionsOf({root:d.root,maps:{enabled:!!d.nativeMaps}}),ctx=await rpg.prepare({texts:d.texts,files:d.files,options:o,toResourcePath:p=>p.startsWith(d.root+'/')?p.slice(d.root.length+1):p})
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
 // Native gallery events transfer to the authored map before calling the
 // common scene. Preserve that context even when opening its stable common ID.
 ctx.uniteReplayMaps=new Map()
 const replayIds=new Set((ctx.catalogTree.children.find(n=>n.id==='special')?.children||[]).map(n=>Number(/::common-(\d+)$/.exec(n.script||'')?.[1])))
 for(const [rel,map]of ctx.maps){
  const id=Number(/Map(\d+)\.json$/i.exec(rel)?.[1]);if(!/回想|recollection|replay/i.test(ctx.mapInfo[id]?.name||''))continue
  for(const event of map.events.filter(Boolean))for(const page of event.pages||[])for(let i=0;i<page.list.length;i++){
   const c=page.list[i];if(c.code!==117||!replayIds.has(Number(c.parameters[0])))continue
   let transfer
   for(let j=i-1;j>=0;j--){const before=page.list[j];if(before.indent<c.indent||before.code===411&&before.indent===c.indent)break;if(before.code===201&&before.parameters[0]===0&&before.indent===c.indent){transfer=before;break}}
   if(!transfer)continue
   const p=transfer.parameters,entry={id:Number(p[1]),player:{x:Number(p[2]),y:Number(p[3]),direction:Number(p[4])||2}},entries=ctx.uniteReplayMaps.get(Number(c.parameters[0]))||[]
   if(!entries.some(old=>JSON.stringify(old)===JSON.stringify(entry)))entries.push(entry)
   ctx.uniteReplayMaps.set(Number(c.parameters[0]),entries)
  }
 }
 ctx.options.special.voiced=options?.special?.voiced===true
 rpg.refreshVoicedCatalog(ctx,(node,context)=>{
  const [rel,scene]=node.script.split('::')
  const maps=ctx.uniteReplayMaps.get(Number(/^common-(\d+)$/.exec(scene)?.[1]))||[]
  if(maps.length>1)throw Error('回想地图上下文不唯一')
  return rpg.parse('',context,{rel,scene,...(maps.length?{initialMap:maps[0]}:{})})
 })
 const rewrite=node=>{if(node.script){const[rel,scope]=node.script.split('::');if(d.packetMap[rel])node.script=d.packetMap[rel]+(scope?'::'+scope:'')}for(const child of node.children||[])rewrite(child)};rewrite(ctx.catalogTree)
 return ctx
}
export function parse(text,ctx,meta={}){const d=JSON.parse(text);if(d.format!=='rpgmaker-unite/1')throw Error('Not native Unite event');const id=Number(/^common-(\d+)$/.exec(meta.scene||'')?.[1]),maps=ctx.uniteReplayMaps?.get(id)||[];if(maps.length>1)throw Error('Unite 回想地图上下文不唯一，请从原生地图事件进入: '+meta.scene);return rpg.parse('',ctx,{...meta,...(maps.length?{initialMap:maps[0]}:{}),rel:d.rel,sourceRel:d.rel,options:ctx.options})}
export const catalog=ctx=>ctx.catalogTree
export const rpgmakerUniteAdapter={id:ADAPTER_ID,label:'RPG Maker Unite 原生事件',sniff,parse,prepare,catalog,health:rpg.rpgMakerJsonAdapter.health,contextFiles,contextDirs,contextTextFilter,sceneInPath:true,sceneThumbs:true}
