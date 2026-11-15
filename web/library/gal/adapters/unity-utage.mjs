import {compileReadGraph} from '../read-graph.mjs'
import {utageExpression} from '../utage-expression.mjs'
export const ADAPTER_ID='utage::native',DEFAULT_OPTIONS={dir:'arc',maxInstructions:200000,maxBranches:64}
export const sniff=t=>/^\s*\{\s*"format"\s*:\s*"unity-utage\/1"/.test(String(t).slice(0,128))
export const contextFiles=o=>[(o?.dir||'arc')+'/native.json'],contextDirs=o=>[(o?.dir||'arc')+'/res'],contextTextFilter=()=>()=>false
export function prepare({texts={},options,files=[]}){const file=contextFiles(options)[0],d=JSON.parse(texts[file]||'null');if(d?.format!=='unity-utage-context/1')throw Error('Utage native context missing');return{...d,options,files}}
export function catalog(ctx){
 const scenes=ctx.scenes||[],scriptOf=(s,entry)=>s.script+(entry===s.entry?'':'::grid-'+entry),all=scenes.map(s=>s.entries.length>1?{id:s.script,title:s.entry,children:s.entries.map(entry=>({id:scriptOf(s,entry),script:scriptOf(s,entry),title:entry}))}:{id:s.script,script:s.script,title:s.entry}),special=[]
 for(const row of ctx.tables.SceneGallery||[]){const entry=row.ScenarioLabel?.replace(/^\*/,''),scene=scenes.find(s=>s.entries.includes(entry));if(!scene)continue;const name=String(row.Thumbnail||'').replace(/\.[^.]+$/,'').toLowerCase(),thumb=ctx.media.images['texture/thumbnail/'+name]||ctx.media.images['texture/event/'+name],script=scriptOf(scene,entry);special.push({id:'special:'+script,script,title:row.Title||entry,...(thumb?{thumb}:{})})}
 return{title:'Utage',children:[...(special.length?[{id:'special',title:'特殊场景',children:special}]:[]),{id:'all',title:'全部剧情',children:all}]}
}
const stem=f=>String(f||'').replace(/\\/g,'/').split('/').at(-1).replace(/(?:\.motion3)?\.[^.]+$/,''),segments=t=>[{text:String(t||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/?(?:size|color|b|i)(?:=[^>]*)?>/gi,'')}]
export function parse(text,ctx,meta={}){
 const d=JSON.parse(text);if(d.format!=='unity-utage/1')throw Error('Not native Utage')
 if(meta.scene){const entry=/^grid-(.+)$/.exec(meta.scene)?.[1];if(!entry||!d.ownGrids?.includes(entry))throw Error('Unknown native Utage grid: '+meta.scene);d.entry=entry}
 const options={...DEFAULT_OPTIONS,...ctx.options,...meta.options},stats={messages:0,choices:0,raw:{},unresolved:{},notes:['原生 Utage；分支/子程序按数据执行，Live2D 动作取原始曲线。未支持的游戏系统回调和特效按源行记录。']},nodes=[];let branches=0
 const run=decisions=>{
  const vars=Object.create(null),events=[],stack=[],actors={},labels=new Map();let grid=d.entry,pc=0,count=0,choice=0,pending=[],macro='',current=''
  for(const r of ctx.tables.Param||[])if(r.Label&&r.Value!==undefined)try{vars[r.Label]=utageExpression(r.Value,vars)}catch{vars[r.Label]=r.Value}
  for(const[name,rows]of Object.entries(d.grids)){labels.set('*'+name,{grid:name,pc:0});for(let i=0;i<rows.length;i++)if(rows[i].Command.startsWith('*'))labels.set(name+':'+rows[i].Command,{grid:name,pc:i+1})}
  const push=(...cs)=>pending.push(...cs),flush=source=>{if(pending.length){events.push({commands:pending,source});pending=[]}},raw=(r,key=r.Command)=>{stats.raw[key]=(stats.raw[key]||0)+1;push({op:'raw',cmd:key,args:[d.name,grid,r.source,r]})},expr=(v,r)=>{try{return utageExpression(v,vars,k=>{stats.unresolved['variable:'+k]=(stats.unresolved['variable:'+k]||0)+1})}catch{raw(r,'expression:'+v);return false}},jump=(target,r)=>{const to=labels.get(target.startsWith('**')?grid+':'+target:target);if(!to){raw(r,'missing-label:'+target);return false}grid=to.grid;pc=to.pc;return true},sound=(file,r,kind)=>{const clean=String(file).replace(/\.[^/.]+$/,'').toLowerCase(),prefix=kind==='voice'?'sound/voice/':kind==='bgm'?'sound/bgm/':'sound/se/',src=ctx.media.sounds[prefix+clean]||ctx.media.sounds['sound/ambience/'+clean];if(!src){stats.unresolved['sound:'+file]=(stats.unresolved['sound:'+file]||0)+1;raw(r,'missing-sound:'+file)}else push({op:kind,src})},image=(file,r)=>{const clean=String(file).replace(/\.[^/.]+$/,'').toLowerCase(),src=ctx.media.images['texture/event/'+clean]||ctx.media.images['texture/bg/'+clean]||ctx.media.images['texture/character/'+clean];if(!src){stats.unresolved['image:'+file]=(stats.unresolved['image:'+file]||0)+1;raw(r,'missing-image:'+file)}return src}
  const assign=(source,r)=>{const m=/^([\w.\[\]]+)\s*(\+=|-=|=)\s*(.*)$/.exec(source);if(!m){raw(r,'assignment:'+source);return}const val=expr(m[3],r);vars[m[1]]=m[2]==='+='?Number(vars[m[1]]||0)+Number(val):m[2]==='-='?Number(vars[m[1]]||0)-Number(val):val}
  const character=(id,pattern,layer,r)=>{
   const rows=(ctx.tables.Character||[]),m=rows.find(m=>m.CharacterName===id&&(!m.Pattern||m.Pattern===pattern)),model=ctx.models[id];if(!m)return
   current=id;const old=actors[id]||{slot:'utage:'+id,src:model?.src,stage:[1280,720],x:640,y:360,scaleX:.5,scaleY:.5,variables:{},nativeGeometry:true,visible:true},spec=structuredClone(old),l=(ctx.tables.Layer||[]).find(l=>l.LayerName===layer)
   if(l){spec.x=640+(Number(l.X)||0);spec.y=360-(Number(l.Y)||0);spec.scaleX=Number(l.ScaleX)||1;spec.scaleY=Number(l.ScaleY)||1;spec.nativeOrder=Number(l.Order)||0;spec.z=3}
   if(model){const motion=model.motions.find(x=>stem(x)===(pattern||macro||'wait'));if(motion){spec.motionGroup=motion;spec.motionIndex=0;spec.loop=true}else if(pattern)raw(r,'missing-motion:'+id+':'+pattern);actors[id]=spec;push({op:'live2d',...spec});return}
   if(!m.FileName)return
   const src=image(m.FileName,r);if(src)push({op:'overlay',slot:'utage:'+id,src,stage:[1280,720],x:Number(m.X)||0,y:-(Number(m.Y)||0),scaleX:Number(m.Scale)||1,scaleY:Number(m.Scale)||1})
  }
  while(++count<=options.maxInstructions){
   const rows=d.grids[grid];if(!rows)throw Error('Utage missing grid: '+grid);if(pc>=rows.length)break
   const r=rows[pc++],c=r.Command||'',a=r.Arg1||'',source=grid+':'+r.source
   if(c.startsWith('*'))continue
   if(c==='If'||c==='ElseIf'){
    if(c==='ElseIf'||!expr(a,r)){let depth=0;for(;pc<rows.length;pc++){const n=rows[pc];if(n.Command==='If')depth++;else if(n.Command==='EndIf'){if(!depth){pc++;break}depth--}else if(!depth&&(n.Command==='Else'||n.Command==='ElseIf')){if(n.Command==='Else'){pc++;break}if(expr(n.Arg1,r)){pc++;break}}}}continue
   }
   if(c==='Else'){let depth=0;for(;pc<rows.length;pc++){if(rows[pc].Command==='If')depth++;if(rows[pc].Command==='EndIf'){if(!depth){pc++;break}depth--}}continue}
   if(c==='EndIf')continue
   if(c==='Param'){assign(a,r);continue}
   if(c==='Jump'||c==='JumpSubroutine'){if(r.Arg2&&!expr(r.Arg2,r))continue;const back={grid,pc};if(c==='JumpSubroutine')stack.push(back);if(!jump(a,r)){if(c==='JumpSubroutine')stack.pop();break}continue}
   if(c==='EndSubroutine'||c==='SendMessage'&&a==='ReturnScript'){const to=stack.pop();if(!to)break;grid=to.grid;pc=to.pc;continue}
   if(c==='Selection'){
    const all=[r];while(rows[pc]?.Command==='Selection')all.push(rows[pc++]);const list=all.filter(v=>!v.Arg2||expr(v.Arg2,v));if(!list.length)continue
    const key='utage-choice:'+choice,opts=list.map((v,i)=>({value:i+1,segments:segments(v.Text)}));flush(source)
    if(decisions[choice]===undefined)return{events,pending:{key,options:opts},source}
    const picked=list[decisions[choice++]-1];if(!picked)throw Error('Invalid Utage choice');if(picked.Arg3)assign(picked.Arg3,picked);if(!jump(picked.Arg1,picked))break;continue
   }
   if(c==='SendMessage'){
    if(a==='CharacterMacroParamCheck'){macro=r.Arg2;continue}
    if(a==='Live2DParam'){const id=r.Arg2||current,spec=actors[id];if(!spec){raw(r,'Live2DParam-without-model');continue}const m=/^([\w]+)\s*=\s*(.+)$/.exec(r.Arg3);if(!m){raw(r);continue}spec.variables[m[1]]=Number(expr(m[2],r));push({op:'live2d',...structuredClone(spec)});continue}
    if(['MainGameOpen','ClubOpen','GameOver'].includes(a))break
    raw(r);continue
   }
   if(!c){
    if(a&&!/^<Off>$/i.test(r.Arg2))character(a,r.Arg2,r.Arg3,r)
    if(r.Text){const m=(ctx.tables.Character||[]).find(m=>m.CharacterName===a);push({op:'voiceStop'},{op:'ui',visible:true},{op:'speaker',segments:segments(m?.NameText||a)},{op:'text',segments:segments(r.Text)});if(r.Voice)sound(r.Voice,r,'voice');flush(source)}continue
   }
   if(c==='Bg'||c==='Sprite'||c==='BgEvent'){const t=(ctx.tables.Texture||[]).find(t=>t.Label===a),file=t?.FileName||a;if(/^(?:Black|White)$/i.test(a))push({op:'bg',color:a.toLowerCase()==='black'?[0,0,0]:[255,255,255]});else{const src=image(file,r);if(src)push(c==='Bg'?{op:'bg',src}:{op:'overlay',slot:c==='BgEvent'?'utage-cg':r.Arg2||'utage-sprite',src,fit:c==='BgEvent'?'contain':'none',stage:[1280,720]})}continue}
   if(c==='BgEventOff'){push({op:'overlayOff',slot:'utage-cg'});continue}
   if(['Bgm','Se','Ambience'].includes(c)){const t=(ctx.tables.Sound||[]).find(t=>t.Label===a);sound(t?.FileName||a,r,c==='Bgm'?'bgm':c==='Ambience'?'bgse':'se');continue}
   if(c==='StopBgm'||c==='StopAmbience'){push({op:c==='StopBgm'?'bgmStop':'bgseStop'});continue}
   if(c==='CharacterOff'){if(a){delete actors[a];push({op:'live2dOff',slot:'utage:'+a},{op:'overlayOff',slot:'utage:'+a})}else{for(const id of Object.keys(actors))delete actors[id];push({op:'live2dOff',all:true},{op:'overlayOff'})}continue}
   if(c==='SpriteOff'){push({op:'overlayOff',slot:a||undefined});continue}
   if(c==='BgOff'){push({op:'bgoff'});continue}
   if(c==='FadeIn'||c==='FadeOut'){push({op:'fade',to:c==='FadeIn'?'clear':a==='white'?'white':'black',seconds:Number(r.Arg6)||0});continue}
   if(c==='Wait'){push({op:'wait',seconds:Number(a)||0});continue}
   if(c==='HideMessageWindow'||c==='ShowMessageWindow'){push({op:'ui',visible:c==='ShowMessageWindow'});continue}
   if(c==='EndScenario')break
   raw(r)
  }
  if(count>options.maxInstructions)throw Error('Utage instruction limit reached: '+d.name+' '+grid+':'+pc)
  flush(grid+':'+pc);return{events}
 }
 const compile=(decisions,skip=0)=>{
  if(++branches>options.maxBranches)throw Error('Utage branch limit reached: '+d.name)
  const r=run(decisions),start=nodes.length;for(const e of r.events.slice(skip)){nodes.push({...e,endStep:true,next:nodes.length+1});stats.messages+=e.commands.filter(c=>c.op==='text').length}
  if(r.pending){const p=r.pending,at=nodes.length;nodes.push({commands:[{op:'choice',var:p.key,options:p.options}],source:r.source,endStep:true,next:at+1});stats.choices++;const tests=[];for(let i=0;i<p.options.length-1;i++){tests.push(nodes.length);nodes.push({commands:[],test:{var:p.key,op:'==',value:i+1},yes:-1,no:-1})}const targets=p.options.map(o=>compile([...decisions,o.value],r.events.length));for(let i=0;i<tests.length;i++){nodes[tests[i]].yes=targets[i];nodes[tests[i]].no=tests[i+1]??targets.at(-1)}if(!tests.length)nodes[at].next=targets[0]}
  else{if(nodes.length===start)nodes.push({commands:[],next:-1});nodes.at(-1).next=-1}return start
 }
 compile([]);return compileReadGraph(nodes,{stats,maxCommands:500000})
}
export const unityUtageAdapter={id:ADAPTER_ID,label:'Unity Utage 原生工作簿',sniff,parse,prepare,contextFiles,contextDirs,contextTextFilter,catalog,sceneInPath:true,sceneThumbs:true}
