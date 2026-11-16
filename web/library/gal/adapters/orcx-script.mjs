import {createOptionsReader} from './options-merge.mjs'
export const ADAPTER_ID='orcx::script'
export const DEFAULT_OPTIONS={dir:'arc',stage:[1280,720],maxCommands:200000}
// Verified against ScenarioScript.LoadData (Unity 6000.3, original GameAssembly).
export const ORCX_NATIVE_MACROS={射精:'[効果音 f=se_903射精音][背景 f=白 t=100][スチルx1][待時間 t=500][背景 f=白 t=100][スチルx2]',ぶっかけ:'[効果音 f=se_904ぶっかけ][背景 f=白 t=100][スチルy1][待時間 t=500][背景 f=白 t=100][スチルy2]',潮吹:'[効果音 f=se_905潮噴き][背景 f=白 t=100][スチルz1][待時間 t=500][背景 f=白 t=100][スチルz2]',白フラッシュ:'[背景エフェクト f=白 t=10][背景エフェクト消 t=400]'}
const optionsOf=createOptionsReader(DEFAULT_OPTIONS),segments=text=>text?[{text}]:[]
export const contextFiles=o=>[(o?.dir||'arc')+'/native.json']
export const contextDirs=o=>[(o?.dir||'arc')+'/res']
export const contextTextFilter=()=>()=>false
export const sniff=text=>/^\s*\{\s*"format"\s*:\s*"orcx-script\/1"/.test(String(text).slice(0,128))
export function prepare({texts={},options}){const o=optionsOf(options),d=JSON.parse(texts[contextFiles(o)[0]]||'null');if(d?.format!=='orcx-context/1')throw Error('OrcX context missing; run gal-layout');return{...d,options:o}}
export function catalog(ctx){
 const node=s=>({id:s.name,script:s.script,title:s.name,thumb:ctx.assets[s.pack+'/'+s.name+'_A.png']||''}),groups=new Map()
 for(const s of ctx.scenes){const match=/^50_ap_(\d+)_/.exec(s.name);if(!match)continue;const key=match[1];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node(s))}
 return{title:'OrcX',children:[{id:'special',title:'特殊场景',children:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,children])=>({id:'character-'+key,title:'角色 '+key,children}))},{id:'opening',title:'开场剧情',children:ctx.scenes.filter(s=>/^00_op_/.test(s.name)).map(node)},{id:'ending',title:'结局',children:ctx.scenes.filter(s=>/^01_ed_/.test(s.name)).map(node)},{id:'all',title:'全部剧情',children:ctx.scenes.map(node)}]}
}

export function parse(text,ctx,meta={}){
 const d=JSON.parse(text);if(d.format!=='orcx-script/1'||typeof d.text!=='string')throw Error('OrcX scenario invalid')
 const {assets,options:{stage,maxCommands}}=ctx,steps=[],stats={messages:0,voices:0,raw:{},unresolved:{}},pos={'左左':-480,'左':-320,'中':0,'右':320,'右右':480};let commands=[],body='',line=0,choices=[],cg=false
 const emit=c=>{if(++stats.commands>maxCommands)throw Error('OrcX command limit exceeded');commands.push(c)},raw=(tag,reason='unsupported')=>{const key=reason+':'+tag;stats.raw[key]=(stats.raw[key]||0)+1;emit({op:'raw',cmd:key,args:[meta.rel||d.name,line,tag]})},resource=(name,kind='image')=>{const packs=[d.pack||'main','common'];const src=packs.map(pack=>assets[pack+'/'+name]).find(Boolean);if(src)return src;if(name&&!/\.[^./]+$/.test(name)){for(const pack of [...new Set(packs)]){const candidates=[...new Set((kind==='audio'?['.ogg','.wav']:['.png','.jpg','.jpeg']).map(ext=>assets[pack+'/'+name+ext]).filter(Boolean))];if(candidates.length===1){stats.resolvedExtensionless=(stats.resolvedExtensionless||0)+1;return candidates[0]}if(candidates.length>1)break}}stats.unresolved[name]=(stats.unresolved[name]||0)+1;raw(name,'missing-resource');return''},flush=()=>{if(body.trim()){let who='',m=/^【([^】]+)】/.exec(body);if(m){who=m[1];body=body.slice(m[0].length)}emit({op:'speaker',segments:segments(who)});emit({op:'text',segments:segments(body.trim())});stats.messages++}if(commands.length){steps.push({index:steps.length,commands});commands=[]}body=''}
 stats.commands=0
 for(const [i,source]of d.text.replace(/\r/g,'').split('\n').entries()){
  line=i+1;const row=source.trim().replace(/\[([^\]\s]+)(?:\s[^\]]*)?\]/g,(tag,name)=>ORCX_NATIVE_MACROS[name]||tag);if(!row||row.startsWith(';'))continue
  if(row.startsWith('*')){flush();emit({op:'label',name:row.slice(1)});continue}
  let at=0;for(const m of row.matchAll(/\[([^\]]*)\]/g)){
   body+=row.slice(at,m.index);at=m.index+m[0].length
   const name=/^\S+/.exec(m[1])?.[0]||'',a=Object.fromEntries([...m[1].matchAll(/(\w+)=(?:"([^"]*)"|([^\s]+))/g)].map(v=>[v[1],v[2]??v[3]])),fade=Math.max(0,Number(a.t)||0)/1000
   if(name==='待'){flush();continue}
   if(name==='落'||name==='r'){if(name==='r')body+='\n';continue}
   if(name==='背景'||/^スチル(?:[A-Za-z][0-9]?)?$/.test(name)){
    const still=name!=='背景',file=still?d.name+(name==='スチル'?'':'_'+name.slice(3))+'.png':a.f;cg=still
    emit({op:'standOff',prefix:'orcx:'});if(!file){emit({op:'overlayOff',slot:'orcx:bg'});emit({op:'bgoff'});continue}
    const src=file==='白'?'':resource(file),seconds=a.t===undefined?.5:fade;if(src||file==='白'){if(!src)emit({op:'overlayOff',slot:'orcx:bg'});emit({op:'overlay',slot:'orcx:bg',kind:still?'still':'background',cg:still,under:true,...(src?{src}:{color:'#fff'}),fit:'contain',stage,z:-1000,fade:seconds});if(seconds)emit({op:'wait',seconds})}continue
   }
   if(name==='背景エフェクト'){const src=a.f==='白'?'':resource(a.f);if(src||a.f==='白'){emit({op:'overlayOff',slot:'orcx:effect'});emit({op:'overlay',slot:'orcx:effect',kind:'effect',...(src?{src}:{color:'#fff'}),fit:'contain',stage,z:1000,fade});if(fade)emit({op:'wait',seconds:fade})}continue}
   if(name==='背景エフェクト消'){emit({op:'overlayOff',slot:'orcx:effect',fade});if(fade)emit({op:'wait',seconds:fade});continue}
   if(name==='振動'){emit({op:'shake',seconds:a.t===undefined?.5:Math.max(0,Number(a.t)||0)/1000,axis:!Number(a.h??20)?'vertical':!Number(a.v??20)?'horizontal':'overall',strength:Math.max(Math.abs(Number(a.h??20)),Math.abs(Number(a.v??20)))/40});continue}
   if(name==='立絵'){const f=(a.f||'')+(/\.[^.]+$/.test(a.f||'')?'':'.png'),src=resource(f),position=a.p||'中';if(src)emit({op:'stand',slot:'orcx:'+position,parts:[{src,x:pos[position]??0,y:0}],stage,fade});continue}
   if(name==='退場'){emit(a.p?{op:'standOff',slot:'orcx:'+a.p,fade}:{op:'standOff',prefix:'orcx:',fade});continue}
   const sound={音楽:'bgm',声:'voice',効果音:'se',ループ声:'bgvoice',ループ効果音:'bgse'}[name];if(sound){const src=resource(a.f||'','audio');if(src){emit({op:sound,src,...(sound==='bgvoice'?{slot:'orcx:voice'}:{}),loop:!['voice','se'].includes(sound)});if(sound==='voice')stats.voices++}continue}
   const stop={音楽停止:'bgmStop',声停止:'voiceStop',効果音停止:'seStop',ループ声停止:'bgvoiceOff',ループ効果音停止:'bgseStop'}[name];if(stop){emit({op:stop,...(stop==='bgvoiceOff'?{slot:'orcx:voice'}:{})});continue}
   if(name==='メッセージ枠off'||name==='メッセージ枠on'){emit({op:'ui',visible:name.endsWith('on')});continue}
   if(name==='待時間'){emit({op:'wait',seconds:(Number(a.t)||0)/1000});continue}
   if(name==='選択肢'){choices.push({text:a.t||'',label:(a.l||'').replace(/^\*/,''),value:choices.length});if(a.exp)raw(m[1],'choice-side-effect');continue}
   if(name==='選択待'){raw(JSON.stringify(choices),'choice-control-flow-not-lifted');choices=[];continue}
   if(name==='終了'){flush();return{steps,stats}}
   // Native game-state counters and visual variants remain explicit diagnostics
   // until their execution semantics are verified; never guess CG suffixes.
   raw(m[1])
  }
  body+=row.slice(at)
 }
 flush();return{steps,stats}
}
export const orcxScriptAdapter={id:ADAPTER_ID,label:'OrcX 剧情（部分演出待核对）',sniff,prepare,parse,catalog,contextFiles,contextDirs,contextTextFilter,sceneInPath:true,sceneThumbs:true}
