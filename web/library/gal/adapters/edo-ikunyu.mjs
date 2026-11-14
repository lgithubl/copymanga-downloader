import{completeJsonSamples}from'../context-complete-json.mjs'
// Edoire DRAW_* profile. Isolated from older Lua games and their coordinate rules.
import{DEFAULT_OPTIONS as BASE,parse as parseLua,prepare as prepareLua,luaArgs,contextDirs,contextTextFilter,contextWalkLimit,contextSampleLimit,catalog,sniff}from'./edo-lua.mjs'
import{createOptionsReader}from'./options-merge.mjs'
export const ADAPTER_ID='edo::ikunyu'
export const DEFAULT_OPTIONS={...BASE,stage:[1920,1080],coordinates:'canvas',cgMatch:'(?:^|/)evcg/',specialMatch:'h$',maxPasses:8}
const options=createOptionsReader(DEFAULT_OPTIONS),quote=JSON.stringify
const positions={C8:[960,0],C6:[480,0],C4:[1440,0],C2:[960,0],B1:[960,0]}
export function expandIkunyu(text){
 const rendered=[],actors={};const png=s=>String(s).replace(/\.png$/i,'')+'.png',draw=(slot,name,x,y)=>[`set(${quote(slot)},${quote(png(name))})`,`setc(${quote(slot)},0.5,0)`,`setp(${quote(slot)},${x},${y})`,`sets(${quote(slot)},1,1)`]
 const character=(slot,name)=>{actors[slot]=String(name).slice(3,5);const[x,y]=positions[slot]||[960,0];return draw(slot,name,x,y)}
 for(const line of String(text).split(/\r?\n/)){
  const m=/^\s*(\w+)\s*\((.*)\)\s*(?:--.*)?$/.exec(line);if(!m){rendered.push(line);continue}const fn=m[1],args=luaArgs(m[2]),arg=i=>typeof args[i]==='object'?args[i]?.expr:args[i],a=arg(0),b=arg(1);let out=null
  if(fn==='setname'&&typeof args[0]==='number')out=[`setname(${quote(args[1])})`]
  else if(['DRAW_BG','DRAW_CG','DRAW_SD'].includes(fn)&&typeof a==='string')out=['clearVideo()','alldel()',`set(${quote(fn==='DRAW_BG'?'BG':fn==='DRAW_SD'?'B3':'EV')},${quote(png(a))})`]
  else if(fn==='DRAW_CHAR'&&typeof a==='string'&&typeof b==='string')out=character(a,b)
  else if(['DRAW_CHAR_W','DRAW_CHAR_T','DRAW_CHAR_4'].includes(fn)){const slots=fn==='DRAW_CHAR_W'?['C6','C4']:fn==='DRAW_CHAR_T'?['C6','C8','C4']:['C6','C8','C4','C2'];if(slots.every((_,i)=>typeof arg(i)==='string'))out=slots.flatMap((s,i)=>character(s,arg(i)))}
  else if(fn==='DRAW_CUT_IN'&&typeof a==='string'&&typeof b==='string')out=draw(a,b,a==='C6'?460:a==='C4'?1420:940,80)
  else if(fn==='DEL_CUT_IN'&&typeof a==='string')out=[`del(${quote(a)})`]
  else if(['DRAW_CP','DRAW_BGCP'].includes(fn)&&typeof a==='string'&&typeof b==='string'){
   if(fn==='DRAW_BGCP')out=[`set(${quote(a)},${quote(png(b))})`]
   else{const slot={C8:'C9',C6:'C7',C4:'C5',C2:'C3'}[a]||'B2',[x,y]=positions[a]||[960,0],adjust={mc:[20,0],me:[-30,0],mf:[-30,-30],mg:[-60,60],mh:[-40,60],mi:[-10,-80],mj:[30,60],sa:[-30,-40],sb:[20,-60],sc:[-45,60],sd:[-40,0],sf:[-15,15],sg:[-60,30],sh:[-60,30],sj:[-40,30],sk:[-60,-30],sl:[10,40],sm:[-35,-10]}[actors[a]]||[0,0];out=draw(slot,b,x-480+adjust[0],y+adjust[1])}
  }
  else if(fn==='DEL_CP'&&typeof a==='string')out=[`del(${quote({C8:'C9',C6:'C7',C4:'C5',C2:'C3',B1:'B2'}[a]||a)})`]
  else if(fn==='DEL_CHAR'&&typeof a==='string')out=[`del(${quote(a)})`,`del(${quote({C8:'C9',C6:'C7',C4:'C5',C2:'C3',B1:'B2'}[a]||a)})`]
  else if(fn==='DEL_ALLCHAR')out=['C1','C2','C3','C4','C5','C6','C7','C8','C9','B1','B2'].map(s=>`del(${quote(s)})`)
  else if(fn==='FREE_TWO_DRAW'&&typeof arg(0)==='string'&&typeof arg(1)==='string'&&typeof arg(4)==='string'&&typeof arg(5)==='string')out=[...draw(arg(0),arg(1),Number(arg(2))||0,Number(arg(3))||0),...draw(arg(4),arg(5),Number(arg(6))||0,Number(arg(7))||0)]
  else if(fn==='FREE_TWO_DEL')out=[`del(${quote(a)})`,`del(${quote(b)})`]
  else if(fn==='PLAY_MOVIE'&&typeof a==='string'&&typeof b==='string')out=['alldel()',`playVideoCg(${quote(b+'.mp4')},${quote(png(a))})`]
  else if(['main_menu_open','main_menu_close','SetWinCountdown','EYE_CATCH'].includes(fn))out=[]
  rendered.push(...(out||[line]))
 }
 return rendered.join('\n')
}
const transform=t=>{try{const d=JSON.parse(t);return d.format==='edo-lua/1'?JSON.stringify({...d,text:expandIkunyu(d.text)}):t}catch{return t}}
export async function prepare(args){const cfg=options(args.options);const texts=args.mediaDir?await completeJsonSamples(args,rel=>/\.edo$/i.test(rel)):args.texts||{};const base=await prepareLua({...args,options:cfg,texts:Object.fromEntries(Object.entries(texts).map(([p,t])=>[p,transform(t)])),_complete:true});return{...base,cfg,catalogTree:base.catalogTree?{children:base.catalogTree.children.filter(x=>x.id!=='special')}:null}}
export function parse(text,ctx,meta={}){const result=parseLua(transform(text),ctx||{cfg:options(meta.options)},meta);result.stats.notes.push('DRAW_* 封装按原始 SYSTEMEX 定义展开；默认立绘版本使用脚本指定图名。');return result}
export const edoIkunyuAdapter={id:ADAPTER_ID,label:'Edoire DRAW / 育乳',catalogViews:true,sniff,parse,prepare,contextDirs,contextTextFilter,contextWalkLimit,contextSampleLimit,catalog}
