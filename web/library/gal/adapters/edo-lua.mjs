import {createOptionsReader,safeRegex} from './options-merge.mjs'
import {createIndexResolver} from '../resolve.mjs'
import {compileReadGraph} from '../read-graph.mjs'
export const ADAPTER_ID='edo::lua'
export const DEFAULT_OPTIONS={resDir:'arc/res',scriptDir:'arc/script',stage:[1920,1080],maxPasses:4,maxCommands:150000,initialVariables:{IS_GALLERY:1,IS_BEGIN_ADV_ENDLIST:0},cgMatch:'(?:^|/)(?:ev-|ev_|eventcg/)',specialMatch:'(?:H-|H_|アダルト|エンディング)',maxWait:5}
const options=createOptionsReader(DEFAULT_OPTIONS)
export const sniff=text=>/^\s*\{\s*"format"\s*:\s*"edo-lua\/1"/.test(String(text))
export const contextDirs=o=>[options(o).resDir,options(o).scriptDir]
export const contextTextFilter=()=>rel=>/\.edo$/i.test(rel)
export const contextWalkLimit=800000
export const contextSampleLimit=20000
// Literal arguments only: unknown expressions stay as data, never eval.
export function luaArgs(text){
 const parts=[];let start=0,quote='',depth=0,escape=false
 for(let i=0;i<text.length;i++){let c=text[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue}if(c==='"'||c==="'")quote=c;else if('({['.includes(c))depth++;else if(')}]'.includes(c))depth--;else if(c===','&&depth===0){parts.push(text.slice(start,i));start=i+1}}
 parts.push(text.slice(start));return parts.map(p=>{p=p.trim();if(/^[-+]?\d+(?:\.\d+)?$/.test(p))return Number(p);if(p==='true'||p==='false')return p==='true';if(p==='nil')return null;if(/^(["'])[\s\S]*\1$/.test(p))return p.slice(1,-1).replace(/\\(\d{1,3}|x[\da-fA-F]{2}|[\s\S])/g,(_,c)=>/^\d/.test(c)?String.fromCharCode(Number(c)):c[0]==='x'?String.fromCharCode(parseInt(c.slice(1),16)):({n:'\n',r:'\r',t:'\t'})[c]??c);return{expr:p}})
}
const value=(x)=>typeof x==='object'&&x?.expr?x.expr:x
const data=text=>{try{const d=JSON.parse(text);return d.format==='edo-lua/1'?d:null}catch{return null}}
export function prepare({options:o,files=[],texts={},toResourcePath,resourceResolve}){
 const cfg=options(o),resolver=createIndexResolver({index:new Set(files.map(x=>toResourcePath?toResourcePath(x):x)),cfg:{...resourceResolve,caseInsensitive:true}}),all=[],special=[],sp=safeRegex(cfg.specialMatch),cg=safeRegex(cfg.cgMatch)
 for(const[rel,t]of Object.entries(texts)){const d=data(t);if(!d||!/^src\/game\//i.test(d.name)||!/(?:^|\n)\s*text\(/.test(d.text))continue;const node={id:rel,script:rel,title:d.name.split('/').at(-1).replace(/\.txt$/i,'')};all.push(node);if(sp?.test(node.title)||[...d.text.matchAll(/"([^"\n]+\.png)"/g)].some(m=>cg?.test(m[1])))special.push(node)}
 all.sort((a,b)=>a.title.localeCompare(b.title,'ja',{numeric:true}));special.sort((a,b)=>a.title.localeCompare(b.title,'ja',{numeric:true}));return{cfg,resolver,hasIndex:files.length>0,catalogTree:all.length?{children:[...(special.length?[{id:'special',title:'特殊场景',children:special}]:[]),{id:'story',title:'剧情',children:all}]}:null}
}
export const catalog=ctx=>ctx?.catalogTree
export function parse(text,ctx={},meta={}){
 const d=data(text);if(!d)throw Error('不是 Edoire Lua 剧情');const o=ctx?.cfg||options(meta.options),stats={messages:0,choices:0,raw:{},unresolved:{},externalVariables:[],notes:['只读静态剧情调用；原游戏的养成、地图操控及动态Lua函数不执行。']},nodes=[],labels=new Map(),stack=[],tables=new Map(),initial={...o.initialVariables},vars=new Set(),cg=safeRegex(o.cgMatch)
 const variable=s=>'edo:'+s.replace(/\s/g,'');for(const[k,v]of Object.entries(initial)){delete initial[k];initial[variable(k)]=v}
 const ensure=(name)=>{const key=variable(name);if(!vars.has(key)){vars.add(key);if(!(key in initial)){initial[key]=0;stats.externalVariables.push(name)}}return key}
 const literal=s=>{const v=luaArgs(s)[0];return v&&typeof v==='object'?{valueVar:ensure(v.expr)}:{value:v??0}}
 const test=s=>{s=s.trim().replace(/^\((.*)\)$/,'$1');let m=/^([\w\[\]"'.]+)\s*(==|~=|>=|<=|>|<)\s*(.+)$/.exec(s);if(m)return{var:ensure(m[1]),op:m[2]==='~='?'!=':m[2],...literal(m[3])};m=/^(not\s+)?([\w\[\]"'.]+)$/.exec(s);return m?{var:ensure(m[2]),op:m[1]?'==':'!=',value:0}:null}
 const find=(name,kind='image')=>{if(typeof name!=='string'||!name||name==='non.png')return'';const dirs=kind==='voice'?['ogg/voice']:kind==='bgm'?['ogg/bgm']:kind==='se'?['ogg/se','ogg/bgv']:['img'];let hit=ctx?.resolver?.resolve(name)||ctx?.resolver?.resolveByName(name);if(hit)return hit;if(!ctx?.hasIndex)return dirs[0]+'/'+name;stats.unresolved[name]=(stats.unresolved[name]||0)+1;return''}
 const raw=(n,cmd,args)=>{stats.raw[cmd]=(stats.raw[cmd]||0)+1;n.commands.push({op:'raw',cmd,args:String(args).slice(0,400)})}
 const layerId=x=>String(value(x)||'BG'),slot=x=>'edo:'+layerId(x),layerCmd=(n,l,file)=>{const id=layerId(l),src=find(file);if(file==='non.png'){n.commands.push(id==='BG'?{op:'bgoff'}:{op:'overlayOff',slot:slot(l)});return}if(!src)return;if(id==='BG')n.commands.push({op:'bg',src,cg:Boolean(cg?.test(src))});else n.commands.push({op:'overlay',slot:slot(l),src,cg:id==='EV'||Boolean(cg?.test(src)),z:id==='EV'?5:id==='EF'?100:10+(Number(id.slice(1))||0),stage:o.stage,fit:'none',...(id.startsWith('C')?{kind:'stand'}:{})})}
 initial['edo:lineName']='对方'
 const lines=d.text.replace(/--\[\[[\s\S]*?\]\]/g,'').split(/\r?\n/)
 let tableName='',lastChoice='edo:choice',nextScript=''
 for(let at=0;at<lines.length;at++){
  let line=lines[at].trim();if(!line||line.startsWith('--')||line==='return function()')continue
  // Strip comments outside string literals.
  let q='',esc=false;for(let i=0;i+1<line.length;i++){let c=line[i];if(q){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===q)q=''}else if(c==='"'||c==="'")q=c;else if(line.slice(i,i+2)==='--'){line=line.slice(0,i).trim();break}}
  if(!line)continue
  let m=/^::([\w]+)::$/.exec(line);if(m){labels.set(m[1],nodes.length);continue}
  const n={commands:[],source:at};const i=nodes.length;nodes.push(n)
  m=/^if\s*\(?([\s\S]*?)\)?\s+then\s+goto\s+(\w+)\s+end\s*$/.exec(line)
  if(m){n.test=test(m[1]);if(n.test)n.yesLabel=m[2];else{raw(n,'condition-unresolved',m[1]);n.test={var:ensure('unknown:'+at),op:'==',value:1};n.yesLabel=m[2]}continue}
  m=/^goto\s+(\w+)$/.exec(line);if(m){n.nextLabel=m[1];continue}
  m=/^(?:if|elseif)\s*\(?([\s\S]*?)\)?\s+then\s*$/.exec(line)
  if(m){if(line.startsWith('elseif')){let prev=stack.at(-1);if(prev?.kind==='if'){const jump={commands:[]};nodes.splice(nodes.length-1,0,jump);prev.ends.push(nodes.length-2);nodes[prev.test].no=nodes.length-1;prev.test=nodes.length-1}else raw(n,'elseif-unmatched',line)}else stack.push({kind:'if',test:i,ends:[]});n.test=test(m[1]);if(!n.test){const key=ensure('unknown:'+at);n.test={var:key,op:'==',value:1};raw(n,'condition-unresolved',m[1])}n.yes=nodes.length;continue}
  if(line==='else'){const prev=stack.at(-1);if(prev?.kind==='if'){nodes[prev.test].no=i+1;prev.ends.push(i)}else raw(n,'else-unmatched',line);continue}
  m=/^while\s*\(?([\s\S]*?)\)?\s+do$/.exec(line);if(m){stack.push({kind:'while',start:i});n.test=test(m[1]);if(!n.test){n.test={var:ensure('unknown:'+at),op:'==',value:1};raw(n,'loop-unresolved',m[1])}n.yes=i+1;continue}
  if(line==='end'||line==='end;'){const b=stack.pop();if(b?.kind==='if'){if(nodes[b.test].no===undefined)nodes[b.test].no=i+1;for(let j of b.ends)nodes[j].next=i+1}else if(b?.kind==='while'){n.next=b.start;nodes[b.start].no=i+1}else n.next=-1;continue}
  if(/^return(?:\s|$)/.test(line)){n.next=-1;continue}
  m=/^(?:local\s+)?([\w]+)\s*=\s*\{\}$/.exec(line);if(m){tables.set(m[1],new Map());tableName=m[1];continue}
  m=/^(\w+)\[(\d+)\]\s*=\s*([\s\S]+)$/.exec(line);if(m&&tables.has(m[1])){const v=luaArgs(m[3])[0];if(typeof v==='string')tables.get(m[1]).set(Number(m[2]),v);else raw(n,'choice-text',m[3]);continue}
  m=/^(?:local\s+)?([\w]+)\s*=\s*get_sel_result\(\)\s*$/.exec(line);if(m){n.commands.push({op:'set',var:ensure(m[1]),valueVar:lastChoice});continue}
  m=/^(?:local\s+)?([\w]+)\s*=\s*([\s\S]+)$/.exec(line);if(m){const v=luaArgs(m[2])[0];if(v===null||['string','number','boolean'].includes(typeof v))n.commands.push({op:'set',var:ensure(m[1]),value:v??0});else{const sum=/^(\w+)\s*([+-])\s*(\d+)$/.exec(m[2]);if(sum&&sum[1]===m[1])n.commands.push({op:'set',var:ensure(m[1]),calc:sum[2]==='+'?'add':'sub',value:Number(sum[3])});else raw(n,'assignment',line)}continue}
  m=/^([\w]+)\s*\(([\s\S]*)\)\s*;?$/.exec(line);if(!m){raw(n,'lua-unhandled',line);continue}
  const fn=m[1],args=luaArgs(m[2]),arg=k=>value(args[k]),num=(k,def=0)=>Number.isFinite(Number(arg(k)))?Number(arg(k)):def
  if(['text','textl','textr'].includes(fn)){if(fn!=='text')n.commands.push({op:'speaker',segments:fn==='textl'?[{var:'edo:lineName'}]:[{text:'我'}]},{op:'ui',visible:true});if(typeof args[0]!=='string'){raw(n,'dynamic-text',m[2]);continue}n.commands.push({op:'text',segments:[{text:args[0]}]});n.endStep=true;stats.messages++}
  else if(fn==='seticon'||fn==='setnoicon')n.commands.push({op:'set',var:'edo:lineName',value:fn==='seticon'&&typeof args[0]==='string'?args[0]:'对方'})
  else if(fn==='setname')n.commands.push({op:'speaker',segments:typeof args[0]==='string'?[{text:args[0]}]:[]})
  else if(fn==='noname')n.commands.push({op:'speaker',segments:[]})
  else if(['sel','selEx','selMap'].includes(fn)){const items=tables.get(arg(1))||tables.get(tableName);if(!items?.size){raw(n,'choice-empty',m[2]);continue}lastChoice='edo:choice:'+i;n.commands.push({op:'choice',var:lastChoice,options:[...items].sort((a,b)=>a[0]-b[0]).map(([value,text])=>({value,segments:[{text}]}))});n.endStep=true;stats.choices++}
  else if(['set','set2','drawImage','drawImage2','set_colscl'].includes(fn))layerCmd(n,args[0],args[1])
  else if(fn==='fade_set'){layerCmd(n,args[0],args[1]);n.commands.push({op:'wait',seconds:Math.min(o.maxWait,num(2))})}
  else if(['setEx','setEx2','setExCol'].includes(fn)){const start=(num(0,1)-1)*3+1;for(let k=0;k<3;k++){const l='C'+(start+k);layerCmd(n,l,args[k+1]);let shift=fn==='setExCol'?1:0;n.commands.push({op:'overlay',slot:slot(l),scaleX:num(4+shift,1),scaleY:num(4+shift,1),x:num(5+shift),y:num(6+shift),stage:o.stage})}}
  else if(['setp','setmove','sets','setms','setme','setma','setml'].includes(fn)){n.commands.push(layerId(args[0])==='BG'?{op:'bgZoom',merge:true,relative:!['sets','setp'].includes(fn),...(fn==='sets'?{scale:num(1,1)}:{x:num(1)*720/o.stage[1],y:num(2)*720/o.stage[1]})}:{op:'overlay',slot:slot(args[0]),relative:!['sets','setp'].includes(fn),...(fn==='sets'?{scaleX:num(1,1),scaleY:num(2,1)}:{x:num(1),y:num(2)}),stage:o.stage})}
  else if(fn==='clear')n.commands.push({op:'overlayOff',slot:'edo:EF'})
  else if(fn==='black'||fn==='white')n.commands.push({op:'overlay',slot:'edo:EF',color:fn==='black'?'#000000':'#ffffff',z:100,stage:o.stage})
  else if(['setmsEx','setmaEx','alpha_dispEx','alpha_hidenEx','fade_delEx'].includes(fn)){for(let k=1;k<=3;k++){const id='C'+((num(0,1)-1)*3+k);n.commands.push(fn==='fade_delEx'?{op:'overlayOff',slot:slot(id)}:{op:'overlay',slot:slot(id),...(fn.startsWith('alpha_')?{alpha:fn==='alpha_dispEx'?1:0}:{x:num(2),y:num(3),relative:true}),stage:o.stage})}}
  else if(fn==='slides')n.commands.push(layerId(args[0])==='BG'?{op:'bgZoom',merge:true,scale:num(2,1)}:{op:'overlay',slot:slot(args[0]),scaleX:num(2,1),scaleY:num(3,1)})
  else if(fn==='slidea'){const hex=String(arg(2)||'');if(/^[0-9a-f]{8}$/i.test(hex)&&layerId(args[0])!=='BG')n.commands.push({op:'overlay',slot:slot(args[0]),alpha:parseInt(hex.slice(6),16)/255});else raw(n,fn,m[2])}
  else if(fn==='set_gblur'&&layerId(args[0])==='BG')n.commands.push({op:'bgBlur',radius:Math.max(0,Math.min(100,num(1)))})
  else if(fn==='del'||fn==='fade_del')n.commands.push(layerId(args[0])==='BG'?{op:'bgoff'}:{op:'overlayOff',slot:slot(args[0])})
  else if(fn==='alldel')n.commands.push({op:'bgoff'},{op:'bgZoom',scale:1,x:0,y:0},{op:'overlayOff'},{op:'standOff'})
  else if(['playVoice','playBgm','playSe','playBgv'].includes(fn)){const kind=fn==='playVoice'?'voice':fn==='playBgm'?'bgm':fn==='playBgv'?'bgvoice':'se',src=find(args[0],kind==='bgvoice'?'se':kind);if(src)n.commands.push({op:kind,src,...(kind==='bgvoice'?{slot:'edo:bgv',loop:args[1]!==false,volume:1}:{})})}
  else if(['stopVoice','stopBgm','stopSe','stopBgv','fadeBgm'].includes(fn))n.commands.push(fn==='stopBgm'||fn==='fadeBgm'?{op:'bgmStop',fade:num(0)}:fn==='stopBgv'?{op:'bgvoiceOff'}:{op:'raw',cmd:fn,args:''})
  else if(['winopen','winclose','lineopen','lineclose'].includes(fn))n.commands.push({op:'ui',visible:fn==='winopen'||fn==='lineopen',seconds:Math.min(o.maxWait,num(0))})
  else if(fn==='wait')n.commands.push({op:'wait',seconds:Math.min(o.maxWait,Math.max(0,num(0)))})
  else if(fn==='goscript'){if(typeof args[0]==='string'){nextScript=args[0].replace(/\.lua$/i,'');n.commands.push({op:'goto',script:nextScript});n.next=-1}else raw(n,'dynamic-script',m[2])}
  else if(['cls1','linecls1','capture','fade','SetStatusButton','DebugLog','wait_use_subproc'].includes(fn)){}
  else raw(n,fn,m[2])
 }
 for(let i=0;i<nodes.length;i++){const n=nodes[i];if(n.nextLabel){if(labels.has(n.nextLabel))n.next=labels.get(n.nextLabel);else{raw(n,'label-missing',n.nextLabel);n.next=-1}}if(n.yesLabel){if(labels.has(n.yesLabel))n.yes=labels.get(n.yesLabel);else{raw(n,'label-missing',n.yesLabel);n.yes=-1}}if(n.test){n.yes??=i+1;n.no??=i+1}for(const key of['next','yes','no'])if(n[key]>=nodes.length)n[key]=-1}
 const result=compileReadGraph(nodes,{initial,maxPasses:o.maxPasses,maxCommands:o.maxCommands,stats});return result
}
export const edoLuaAdapter={id:ADAPTER_ID,label:'Edoire Lua 剧情',sniff,parse,prepare,contextDirs,contextTextFilter,contextWalkLimit,contextSampleLimit,catalog}
