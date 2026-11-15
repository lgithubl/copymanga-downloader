import{compileReadGraph}from'../read-graph.mjs'
export const ADAPTER_ID='celltalk::native',DEFAULT_OPTIONS={dir:'arc',maxCommands:200000}
export const sniff=t=>/^\s*\{\s*"format"\s*:\s*"celltalk-script\/1"/.test(String(t).slice(0,128))
export const contextFiles=o=>[(o?.dir||'arc')+'/native.json'],contextDirs=o=>[(o?.dir||'arc')+'/res'],contextTextFilter=()=>()=>false
export function prepare({texts={},options}){const ctx=JSON.parse(texts[contextFiles(options)[0]]||'null');if(ctx?.format!=='celltalk-context/1')throw Error('CellTalk native context missing');return{...ctx,options}}
export function catalog(ctx){return{title:'CellTalk',children:[{id:'special',title:'特殊场景',children:ctx.scenes.map(s=>({id:s.script,script:s.script,title:s.name}))}]}}
const segments=t=>[{text:String(t||'').replace(/<br\s*\/?>/gi,'\n')}]
export function parse(text,ctx){
 const d=JSON.parse(text);if(d.format!=='celltalk-script/1'||!d.profile)throw Error('CellTalk native controller profile absent')
 const stats={messages:0,voices:0,raw:{},unresolved:{},notes:['静态原生控制器预览；存档条件由手动选择。未还原的立绘/动画/系统调用保留 native 地址诊断。']},nodes=[],ids=new Map(),max=Number(ctx.options?.maxCommands)||DEFAULT_OPTIONS.maxCommands
 // Native LanguageStock.FindIndex searches the first matching ID. End markers
 // in a running range are matched after its start, not globally.
 for(let i=0;i<d.rows.length;i++){const id=d.rows[i].ID;if(id){if(!ids.has(id))ids.set(id,[]);ids.get(id).push(i)}}
 let budget=0
 const build=(profile,state)=>{
  let pending=[],cursor=state?.cursor||0,cg=state?.cg?structuredClone(state.cg):null,start=nodes.length
  const push=(...cs)=>pending.push(...cs),raw=(source,key)=>{stats.raw[key]=(stats.raw[key]||0)+1;push({op:'raw',cmd:key,args:[d.type,source.address||source.source,source]})},flush=source=>{if(pending.length){nodes.push({commands:pending,source,endStep:true,next:nodes.length+1});pending=[]}}
  const render=()=>{
   if(!cg)return
   const data=ctx.media.cg[cg.path];if(!data)return
   push({op:'overlayOff',prefix:'celltalk:'})
   // Native CG keeps the selected pose root (body/background) active. Only
   // its child clothing/difference layers are selected by the parts list.
   for(const s of data.poses[cg.pose]||[]){const base=s.path===''&&s.part===cg.pose;if((!base&&!cg.parts.includes(s.part))||s.active===false)continue;let image=s;if(s.faceGroup){const exact=data.faceGroups[s.faceGroup]?.[cg.emotion];if(exact)image={...s,...exact}}
    push({op:'overlay',...image,slot:'celltalk:'+s.path,stage:[1920,1080],fit:'none',cg:true})}
  }
  const emotion=(value,source)=>{if(!value||!cg)return;const data=ctx.media.cg[cg.path];for(const item of value.split(',')){if(item.startsWith('On')){const part=item.slice(2);if(!cg.parts.includes(part))cg.parts.push(part)}else if(item.startsWith('Off'))cg.parts=cg.parts.filter(p=>p!==item.slice(3));else if(Object.values(data?.faceGroups||{}).some(g=>g[item]))cg.emotion=item;else raw(source,'CG animation/emotion:'+item)}render()}
  const line=(row,source)=>{
   emotion(row.Emotion,source);if(!row['日本語']||row['日本語'].startsWith('＞'))return
   push({op:'voiceStop'},{op:'ui',visible:true},{op:'speaker',segments:segments(row.Talker)},{op:'text',segments:segments(row['日本語'])})
   if(row.Data&&/^V[A-Z0-9]+$/i.test(row.Data)){const src=ctx.media.audio[row.Data];if(src){push({op:'voice',src});stats.voices++}else{stats.unresolved['voice:'+row.Data]=(stats.unresolved['voice:'+row.Data]||0)+1;raw(row,'missing-voice:'+row.Data)}}
   stats.messages++;flush(d.source+':'+row.source)
  }
  for(const c of profile.commands||[]){
   if(++budget>max)throw Error('CellTalk scene command limit exceeded: '+d.type)
   if(c.op==='unsupported'){raw(c,c.method);continue}
   const a=c.args.map(a=>a?.field?d.fields[a.field]:a),m=c.method
   if(m==='ReplayScene.CGLoad'){
    const data=ctx.media.cg[a[1]];if(!data){stats.unresolved['cg:'+a[1]]=1;raw(c,'missing-cg:'+a[1]);cg=null;continue}
    const preset=data.subinfo.find(x=>x.tag===a[2])?.saveinfo||data.saveinfo;cg={path:a[1],pose:preset.spose,parts:[...data.defaultparts,...preset.clothes.filter(Boolean)],emotion:a[3]||''};render();continue
   }
   if(m==='EventEngine.Text'){
    let from=cursor;const key=String(a[1]||'');if(key.startsWith('ID:')){from=ids.get(key.slice(3))?.[0];if(from===undefined){stats.unresolved['text-id:'+key]=1;raw(c,'missing-text-id:'+key);continue}}else if(key){raw(c,'text-mode:'+key);continue}
    let to=from
    if(typeof a[2]==='string'){const end=a[2].startsWith('++')?key.slice(3)+a[2].slice(2):a[2].replace(/^ID:/,'');to=ids.get(end)?.find(i=>i>=from);if(to===undefined){stats.unresolved['text-range:'+end]=1;raw(c,'missing-text-range:'+key+'/'+end);continue}}
    for(let i=from;i<=to;i++)line(d.rows[i],c);cursor=to+1;continue
   }
   if(m==='CG.ChangePose'){if(cg){cg.pose=String(a[1]||cg.pose);render()}continue}
   if(m==='ReplayScene.CGDestroy'){cg=null;push({op:'overlayOff',prefix:'celltalk:'});continue}
   if(m==='Music.Fadeout'){push({op:'bgmStop'});continue}
   if(m==='Music.Play'){const field=c.args[0]?.field,src=field&&d.audioFields?.[field];if(src)push({op:'bgm',src});else if(a[0])raw(c,m);continue}
   if(m==='Sound.StopVoice'){push({op:'voiceStop'});continue}
   if(m==='EventEngine.TextCloseWindow'){push({op:'ui',visible:false});continue}
   if(m==='EventEngine.Wait'){const b=Buffer.alloc(4);b.writeUInt32LE(Number(a[1])>>>0);const seconds=b.readFloatLE();if(Number.isFinite(seconds)&&seconds>=0&&seconds<60)push({op:'wait',seconds});continue}
   if(m.startsWith('EventEngine.Fadein')){push({op:'fade',to:'clear',seconds:.3});continue}
   if(m==='EventEngine.TextBackBG'||m==='EventEngine.TextFrontFG')continue
   raw(c,m)
  }
  flush(d.source)
  if(profile.condition){const key='celltalk-choice:'+nodes.length,at=nodes.length;nodes.push({commands:[{op:'choice',var:key,options:[{value:0,segments:segments('否 / '+profile.condition)},{value:1,segments:segments('是 / '+profile.condition)}]}],endStep:true,next:at+1});const test=nodes.length;nodes.push({commands:[],test:{var:key,op:'==',value:1},yes:-1,no:-1});nodes[test].no=build(profile.no,{cg,cursor});nodes[test].yes=build(profile.yes,{cg,cursor})}else{if(nodes.length===start)nodes.push({commands:[],next:-1});nodes.at(-1).next=-1}
  return start
 }
 build(d.profile);return compileReadGraph(nodes,{stats,maxCommands:max})
}
export const cellTalkNativeAdapter={id:ADAPTER_ID,label:'CellTalk 原生控制器（预览）',sniff,parse,prepare,contextFiles,contextDirs,contextTextFilter,catalog,sceneThumbs:true}
