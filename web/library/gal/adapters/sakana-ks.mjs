import{completeJsonSamples}from'../context-complete-json.mjs'
import{createIndexResolver}from'../resolve.mjs'
import{createOptionsReader}from'./options-merge.mjs'
import{compileReadGraph}from'../read-graph.mjs'
import{sakanaParts}from'../sakana.mjs'
export const ADAPTER_ID='sakana::ks'
export const DEFAULT_OPTIONS={resDir:'arc/res',scriptDir:'arc/script',stage:[1280,720],maxWait:5,maxCommands:300000,maxPasses:4}
const options=createOptionsReader(DEFAULT_OPTIONS)
export const sniff=text=>/^\s*\{\s*"format"\s*:\s*"sakana-ks\/1"/.test(String(text))
export const contextDirs=o=>[options(o).resDir,options(o).scriptDir]
export const contextTextFilter=()=>rel=>/\.(?:json|sakana)$/i.test(rel)
export const contextWalkLimit=800000,contextSampleLimit=20000,sceneThumbs=true
const json=t=>{try{return JSON.parse(t)}catch{return null}}
export async function prepare({options:o,files=[],texts={},toResourcePath,resourceResolve,mediaDir}){
 if(mediaDir)texts=await completeJsonSamples({texts,files,mediaDir},rel=>/\.(?:sakana|ui\.json)$/.test(rel))
 const cfg=options(o),toRes=toResourcePath||String,resolver=createIndexResolver({index:new Set(files.map(toRes)),cfg:{...resourceResolve,caseInsensitive:true}}),uis=new Map(),maps={character:[],cg:[],scene:[],bgm:[]},scripts=[]
 for(const[rel,text]of Object.entries(texts)){const data=json(text);if(!data)continue;if(data.kind in maps)maps[data.kind]=data.entries;if(data.format==='sakana-ui/1')uis.set(toRes(rel),data.data);if(data.format==='sakana-ks/1')scripts.push({rel,data})}
 const ui=name=>{const path=resolver.resolveByName(name+'.json');return uis.get(path)||null},story=[],special=[]
 for(const{rel,data}of scripts){for(const m of data.text.matchAll(/^\*([^|\r\n]+)(?:\|([^\r\n]*))?$/gm)){const label=m[1].trim();if(/^(?:Ep\d+|root_)/i.test(label))story.push({id:label,title:m[2]||label,script:rel+'::'+label})}for(const s of maps.scene.filter(s=>s.ks===data.name.split('/').at(-1))){const label=s.label.replace(/^\*/,''),id=String(s.hidden??s.id);special.push({id:'special-'+id,title:'场景 '+String(Number(id)+1).padStart(2,'0'),script:rel+'::'+label,thumb:s.thumbnail?.replace(/^\//,'')})}}
 return{cfg,resolver,ui,hasIndex:files.length>0,maps,catalogTree:{children:[...(special.length?[{id:'special',title:'特殊场景',children:special}]:[]),{id:'story',title:'剧情',children:story.length?story:scripts.map(({rel,data})=>({id:rel,title:data.name,script:rel}))}]}}
}
export const catalog=ctx=>ctx?.catalogTree
export function sakanaLex(source){const lines=source.replace(/^\s*;[^\n]*$/gm,'').split(/\r?\n/),out=[];for(const line of lines){if(line.trim().startsWith('*')){const [label,title]=line.trim().split('|');out.push({label,title});continue}let start=0,p=0;while(p<line.length){if(line[p]!=='['){p++;continue}if(p>start)out.push({text:line.slice(start,p)});let q='',brace=0,i=p+1;for(;i<line.length;i++){const c=line[i];if(q){if(c==='\\')i++;else if(c===q)q=''}else if(c==='"'||c==="'")q=c;else if(c==='{')brace++;else if(c==='}')brace--;else if(c===']'&&!brace)break}if(i>=line.length)throw Error('Sakana 标签截断');const body=line.slice(p+1,i),m=/^(\w+)\s*([\s\S]*)$/.exec(body);if(m){const args={};for(const a of m[2].matchAll(/(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\{[^}]*\}|[^\s]+)/g)){const v=a[2];args[a[1]]=v[0]==='"'||v[0]==="'"?v.slice(1,-1).replace(/\\(["'\\])/g,'$1'):v}out.push({tag:m[1].toUpperCase(),args,raw:m[2]})}p=i+1;start=p}if(start<line.length)out.push({text:line.slice(start)});out.push({text:'\n'})}return out}
export function parse(text,ctx={},meta={}){
 const data=json(text);if(data?.format!=='sakana-ks/1')throw Error('不是Sakana剧情');const o=ctx?.cfg||options(meta.options),stats={messages:0,choices:0,raw:{},unresolved:{},notes:['静态UI使用原始图层及首帧表情；眼眨/抖动等SCP函数不执行。']};let source=data.text
 if(meta.scene){const start=new RegExp('^\\*'+String(meta.scene).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\||[\\r\\n])','m').exec(source);if(!start)throw Error('Sakana场景标签不存在');source=source.slice(start.index);if(!/^Scene/i.test(meta.scene)){const end=/\n\*Ep\d+/i.exec(source);if(end)source=source.slice(0,end.index)}}
 const events=sakanaLex(source),nodes=[],labels=new Map(),stack=[],initial={},fg=new Map();let body='',caseVar='',caseIndex=0
 const raw=(n,name,value='')=>{stats.raw[name]=(stats.raw[name]||0)+1;n.commands.push({op:'raw',cmd:name,args:String(value).slice(0,300)})}
 const find=name=>{if(!name)return'';const clean=String(name).replace(/^\//,''),hit=ctx.resolver?.resolve(clean)||ctx.resolver?.resolveByName(clean)||ctx.resolver?.resolveByName(clean+'.ogg');if(hit)return hit;if(!ctx.hasIndex)return clean;stats.unresolved[clean]=(stats.unresolved[clean]||0)+1;return''}
 const visual=(n,name,cg,slot,method,pos='1/1')=>{const ui=ctx.ui?.(name);if(!ui){stats.unresolved['ui:'+name]=(stats.unresolved['ui:'+name]||0)+1;return}let p;try{p=sakanaParts(ui,method)}catch(e){raw(n,'ui-static',e.message);return}const parts=p.parts.map(x=>({...x,src:find(x.src)})).filter(x=>x.src),fraction=pos.split('/').map(Number),x=(fraction[1]?((Math.abs(fraction[0])-.5)/fraction[1]-.5)*o.stage[0]:0)
  if(slot){n.commands.push({op:'stand',slot,stage:o.stage,parts:parts.map(p=>({src:p.src,x:p.x+x,y:p.y,scale:p.scaleX}))});return}
  n.commands.push({op:'overlayOff',prefix:'sakana:bg:'});if(parts.length===1)n.commands.push({op:'bg',src:parts[0].src,cg});else{n.commands.push({op:'bgoff'});parts.forEach((p,i)=>n.commands.push({op:'overlay',slot:'sakana:bg:'+i,src:p.src,cg,kind:cg?'cg':'bg',x:p.x,y:p.y,scaleX:p.scaleX,scaleY:p.scaleY,stage:p.stage||o.stage,fit:'none',under:true,z:i}))}}
 for(let at=0;at<events.length;at++){const e=events[at];if(e.label){labels.set(e.label,nodes.length);continue}if(e.text!==undefined){body+=e.text;continue}const n={commands:[]},i=nodes.length;nodes.push(n);const a=e.args||{},num=(k,d=0)=>Number.isFinite(Number(a[k]))?Number(a[k]):d
  switch(e.tag){case'CPG':if(body.trim()){n.commands.push({op:'text',segments:[{text:body.trim()}]});n.endStep=true;stats.messages++}body='';if(a.cn==='true')n.commands.push({op:'speaker',segments:[]});break
   case'ONNAME':{const name=ctx.maps?.character.find(x=>x.id===a.num)?.name??a.num??'';n.commands.push({op:'speaker',segments:name?[{text:name}]:[]});break}
   case'VOICE':case'SE':case'BGM':{const kind=e.tag.toLowerCase(),src=find(a.f);if(src)n.commands.push({op:kind,src});break}
   case'FADEOUTBGM':n.commands.push({op:'bgmStop',fade:1});break
   case'WINDOW':n.commands.push({op:'ui',visible:String(a.target??'true').replace(/[{}\s]/g,'')!=='false'});break
   case'WAIT':n.commands.push({op:'wait',seconds:Math.min(o.maxWait,Math.max(0,num('time')/1000))});break
   case'TRANSITION':n.commands.push({op:'fade',to:/true/.test(a.target)?'black':'clear',seconds:Math.min(o.maxWait,num('time')/1000)});break
   case'BG':visual(n,a.f,false);break
   case'CG':{const row=ctx.maps?.cg.find(x=>String(x.id)===String(a.id)),file=row?.graphics?.[a.index??0];if(file)visual(n,file,true);else raw(n,'cg-map-missing',a.id+':'+a.index);break}
   case'FG':{const pos=a.pos||'1/1',slot='sakana:fg:'+pos;if(!fg.has(pos))fg.set(pos,new Set());fg.get(pos).add(a.f);n.commands.push({op:'set',var:'sakana:fgfile:'+pos,value:a.f});visual(n,a.f,false,slot,a.method,pos);break}
   case'FACE':{const pos=a.pos||'1/1',old=fg.get(pos);if(old){for(const file of old){const start=n.commands.length;visual(n,file,false,'sakana:fg:'+pos,a.method,pos);for(let j=start;j<n.commands.length;j++)n.commands[j].when=[{var:'sakana:fgfile:'+pos,op:'==',value:file}]}}else raw(n,'face-without-fg',pos);break}
   case'FREE':for(const pos of fg.keys())n.commands.push({op:'set',var:'sakana:fgfile:'+pos,value:''});n.commands.push({op:'standOff'});break
   case'STFLAG':for(const[k,v]of Object.entries(a)){initial['sakana:'+k]??=0;n.commands.push({op:'set',var:'sakana:'+k,value:Number(v)})}break
   case'IF':{if(/isSystemFlagsEnabled\(/.test(a.exp||'')){const variable='sakana:ending-choice:'+i;n.commands.push({op:'choice',var:variable,options:[{value:1,segments:[{text:'附加剧情'}]},{value:2,segments:[{text:'普通结局'}]}]});n.endStep=true;n.test={var:variable,op:'==',value:1};n.yes=i+1;stack.push({kind:'if',at:i});stats.choices++;break}const m=/getFlagValue\("([^"]+)"\)\s*(==|!=|>=|<=|>|<)\s*(\d+)/.exec(a.exp||'');if(m){initial['sakana:'+m[1]]??=0;n.test={var:'sakana:'+m[1],op:m[2],value:Number(m[3])};n.yes=i+1;stack.push({kind:'if',at:i})}else{raw(n,'if-unresolved',a.exp);n.test={var:'sakana:unknown',op:'==',value:1};initial['sakana:unknown']=0;n.yes=i+1;stack.push({kind:'if',at:i})}break}
   case'ENDIF':{const s=stack.pop();if(s?.kind==='if')nodes[s.at].no=i+1;else raw(n,'endif-unmatched');break}
   case'SWITCH':{const choices=[];for(let j=at+1;j<events.length&&events[j].tag!=='ENDSWITCH';j++)if(events[j].tag==='CASE'){const m=/^"([^"]*)"/.exec(events[j].raw);choices.push({value:choices.length+1,segments:[{text:m?.[1]||'路线 '+(choices.length+1)}]})}caseVar='sakana:choice:'+i;caseIndex=0;n.commands.push({op:'choice',var:caseVar,options:choices});n.endStep=true;stack.push({kind:'switch',tests:[],variable:caseVar});stats.choices++;break}
   case'CASE':{const sw=stack.at(-1);if(sw?.kind!=='switch'){raw(n,'case-unmatched');break}if(sw.tests.length)nodes[sw.tests.at(-1)].no=i;n.test={var:sw.variable,op:'==',value:++caseIndex};n.yes=i+1;sw.tests.push(i);break}
   case'ENDSWITCH':{const sw=stack.pop();if(sw?.kind==='switch')for(const test of sw.tests)nodes[test].no??=i+1;break}
   case'JUMP':if(a.target&&!a.storage)n.nextLabel=a.target;else if(a.storage&&!/main|start/i.test(a.storage)){n.commands.push({op:'goto',script:a.storage.replace(/\.ks$/i,'')});n.endStep=true;n.next=-1}else n.next=-1;break
   case'ENDPARTIAL':if(meta.scene){n.next=-1;at=events.length}break
   case'SCENE':case'SWAP':case'SYSTEM':break
   default:raw(n,e.tag,e.raw)
  }
 }
 if(body.trim())nodes.push({commands:[{op:'text',segments:[{text:body.trim()}]}],endStep:true})
 for(const n of nodes)if(n.nextLabel){if(labels.has(n.nextLabel))n.next=labels.get(n.nextLabel);else{raw(n,'jump-label-missing',n.nextLabel);n.next=-1}}
 return compileReadGraph(nodes,{initial,maxPasses:o.maxPasses,maxCommands:o.maxCommands,stats})
}
export const sakanaKsAdapter={id:ADAPTER_ID,sceneInPath:true,label:'SakanaGL KAG',sniff,parse,prepare,catalog,sceneThumbs,contextDirs,contextTextFilter,contextWalkLimit,contextSampleLimit}
