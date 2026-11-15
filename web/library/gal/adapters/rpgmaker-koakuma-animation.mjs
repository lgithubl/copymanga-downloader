// Native Koakuma frame tables, read as data; never evaluate game JavaScript.
import {readFile,stat} from 'node:fs/promises'
import path from 'node:path'
const definitions=[['0001','k_loveh',7],['0002','s_loveh',18],['0003','y_loveh',26],['0004','bs_lovehotel',67],['0005','se_seizyoh',66],['0024','b_loveh',63],['0025','km_loveh',64],['0026','kr_loveh',65]]
const counts={1:20,2:20,3:20,4:20,5:20,6:15,7:15,8:15,9:15,10:15,11:15,12:15,13:15,14:15,15:15,16:15,17:15,18:15,19:40,20:40,21:40,22:60,23:60,24:30,25:60,26:40,27:40,28:40,29:30,30:30,31:30,32:20,33:15}
const pairs={6:7,8:9,10:11,12:13,14:15},names=['かりん','静音','優花菜','本屋','けもみみ','カラオケ','聖音','暴食'],tags=['k','s','y','b','km','kr','se','bs']
function literals(text){
 const values=[];let at=0
 while(at<text.length){
  while(/\s/.test(text[at]||'')&&at<text.length)at++
  const quote=text[at];let value
  if(quote==='"'||quote==="'"){
   at++;let out='',closed=false
   while(at<text.length){let ch=text[at++];if(ch===quote){closed=true;break}if(ch==='\\'){
    const escaped=text[at++],simple={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0',"'":"'",'"':'"','\\':'\\','/':'/'}
    if(Object.hasOwn(simple,escaped))ch=simple[escaped]
    else if(escaped==='u'||escaped==='x'){const n=escaped==='u'?4:2,s=text.slice(at,at+n);if(!new RegExp(`^[0-9a-f]{${n}}$`,'i').test(s))return null;ch=String.fromCharCode(parseInt(s,16));at+=n}
    else return null
   }out+=ch}if(!closed)return null;value=out
  }else{const m=/^(?:-?\d+(?:\.\d+)?|true|false|null)(?=\s*(?:,|$))/.exec(text.slice(at));if(!m)return null;value=JSON.parse(m[0]);at+=m[0].length}
  values.push(value);if(values.length>16)return null
  while(at<text.length&&/\s/.test(text[at]))at++
  if(at===text.length)break;if(text[at++]!==',')return null
 }
 return values
}
export function koakumaDataRows(text,list,ctor){
 const rows=new Map(),pattern=new RegExp(`^\\s*${list}\\[(\\d+)\\]\\s*=\\s*new\\s+${ctor}\\(([^\\r\\n]*)\\);\\s*$`,'gm')
 for(const m of String(text).matchAll(pattern)){const values=literals(m[2]);if(!values)throw Error(`Koakuma data is not literal: ${list}[${m[1]}]`);if(rows.size>=10000)throw Error('Koakuma data row limit');rows.set(Number(m[1]),values)}
 return rows
}
const framePath=(family,pattern,frame)=>`img/pictures/HCG_anime/${family}_${String(pattern).padStart(2,'0')}_${String(frame).padStart(2,'0')}.png`
export async function prepareKoakumaAnimation(ctx,{texts,mediaDir,root}){
 const option=ctx.options.plugins.koakumaAnimation
 if(!option.enabled)return null
 if(!ctx.plugins.some(p=>p.name==='fm001_Koakuma_Touch')){ctx.warnings.push('Koakuma animation enabled but native plugin is absent');return null}
 if(typeof option.data!=='string'||!option.data||option.data.startsWith('/')||option.data.includes('\\')||option.data.split('/').includes('..'))throw Error('Koakuma data path invalid')
 const rel=[root,option.data].filter(Boolean).join('/');let text=texts[rel]
 if(text===undefined&&mediaDir){const file=path.join(mediaDir,...rel.split('/'));if((await stat(file)).size>8*1048576)throw Error('Koakuma data exceeds8MB');text=await readFile(file,'utf8')}
 if(!text)throw Error('Koakuma animation data missing: '+rel)
 if(Buffer.byteLength(text)>8*1048576)throw Error('Koakuma data exceeds8MB')
 const missions=koakumaDataRows(text,'ListTouchMission','Fm001_TouchMission'),memory=koakumaDataRows(text,'ListMemory','Fm001_Memory'),families=new Map(),byMission=new Map(),index=new Set([...ctx.files].map(f=>f.toLowerCase()))
 const exists=src=>[src,src+'_',src.replace(/\.png$/,'.rpgmvp')].some(f=>index.has(f.toLowerCase()))
 for(const[id,cg,memoryId]of definitions){
  const mission=[...missions].find(([,m])=>m[3]===cg);if(!mission){if([...index].some(f=>f.includes('/hcg_anime/'+id+'_')))ctx.warnings.push(`Koakuma ${id}: native mission mapping missing`);continue}
  const [missionId,m]=mission,mem=memory.get(memoryId),patterns=new Map(),missing=[]
  for(const[pattern,count]of Object.entries(counts)){const p=Number(pattern),frames=Array.from({length:count},(_,i)=>framePath(id,p,i));if(frames.every(exists))patterns.set(p,frames);else if(frames.some(exists))missing.push(p)}
  if(missing.length)ctx.warnings.push(`Koakuma ${id}: incomplete native frame patterns ${missing.join(',')}`)
  if(!patterns.has(1)||!patterns.has(32)){ctx.warnings.push(`Koakuma ${id}: missing base actor/background sequence`);continue}
  const nativeThumb=mem&&mem[8]===m[0]&&typeof mem[6]==='string'?`img/pictures/HCG/${mem[6]}.png`:''
  const entry={id,cg,missionId,title:m[1],heroine:m[0],patterns,thumbnail:nativeThumb&&exists(nativeThumb)?nativeThumb:patterns.get(1)[0],stage:ctx.stage,source:rel}
  families.set(id,entry);byMission.set(missionId,entry)
 }
 const unknown=new Set();for(const file of index){const m=/\/hcg_anime\/(\d+)_(\d+)_\d+\.(?:png_?|rpgmvp)$/i.exec(file);if(m&&(!definitions.some(d=>d[0]===m[1])||!counts[Number(m[2])]))unknown.add(m[1]+'_'+m[2])}if(unknown.size)ctx.warnings.push('Koakuma unmapped native animation patterns: '+[...unknown].join(','))
 if(!families.size)ctx.warnings.push('Koakuma: no complete native animation family indexed')
 const model={families,byMission}
 const children=[...families.values()].map(e=>({id:'koakuma-'+e.id,title:e.title,script:[root,'data/CommonEvents.json'].filter(Boolean).join('/')+'::koakuma-animation-'+e.id,thumb:e.thumbnail,subtitle:`${e.heroine} · 30fps · 原生动作模式切换`}))
 if(children.length&&ctx.options.special.enabled){let special=ctx.catalogTree.children.find(n=>n.id==='special');if(!special){special={id:'special',title:ctx.options.special.label,children:[]};ctx.catalogTree.children.unshift(special)}special.children.unshift({id:'koakuma-animation',title:'动态CG',children})}
 return model
}
export function koakumaAnimationOverlays(entry,pattern,{key='',slot='rpg-koakuma'}={}){
 const source=entry.patterns.get(pattern);if(!source)return[]
 const pair=pairs[pattern],frames=pair&&entry.patterns.has(pair)?[...source,...entry.patterns.get(pair)]:source
 const backgroundPattern=pattern>=6&&pattern<=18?33:32,background=entry.patterns.get(backgroundPattern)
 if(!background)return[]
 const animatedBackground=pattern<=18,stage=entry.stage
 const overlays=[{op:'overlay',slot:slot+'-bg',src:background[0],stage,anchor:[0,0],x:-stage[0]/2,y:-stage[1]/2,fit:'none',z:7,cg:false},
  {op:'overlay',slot:slot+'-body',src:frames[0],stage,anchor:[0,0],x:-stage[0]/2,y:-stage[1]/2,fit:'none',z:8,cg:true,animation:{key:`${slot}:${entry.id}:${pattern}:${key}`,frames:frames.map(src=>({src,seconds:1/30})),loopStart:0}}]
 if(animatedBackground)overlays[0].animation={key:`${slot}:bg:${entry.id}:${pattern}:${key}`,frames:Array.from({length:frames.length},(_,i)=>({src:background[i%background.length],seconds:1/30})),loopStart:0}
 return overlays
}
export function parseKoakumaGallery(entry,ctx){
 const patterns=[...entry.patterns.keys()].filter(p=>p<32&&![7,9,11,13,15].includes(p)),steps=[]
 for(const pattern of patterns){const commands=koakumaAnimationOverlays(entry,pattern,{key:'gallery'});if(!commands.length)continue
  const index=names.indexOf(entry.heroine),src=index>=0?`audio/se/voice/${String(index+1).padStart(2,'0')}/mc_${tags[index]}_921.ogg`:''
  steps.push({index:steps.length,commands:[{op:'overlayOff',prefix:'rpg-koakuma'},{op:'bgvoiceOff',slot:'rpg-koakuma-bgv'},{op:'label',name:`动作 ${String(pattern).padStart(2,'0')}`},...commands,...((src&&[src,src+'_',src.replace(/\.ogg$/,'.rpgmvo')].some(f=>ctx.files.has(f)))?[{op:'bgvoice',slot:'rpg-koakuma-bgv',kind:'bgvoice',loop:true,src,volume:.25,token:`koakuma-gallery:${entry.id}:${pattern}`}]:[]),{op:'speaker',segments:[]},{op:'text',segments:[{text:`${entry.title} · 动作 ${String(pattern).padStart(2,'0')}`}]}]})
 }
 return {steps,stats:{commands:steps.reduce((n,s)=>n+s.commands.length,0),text:steps.length,raw:{},warnings:[...ctx.warnings,'原生动作模式预览：上下句切换动作；不模拟触摸小游戏或将预览循环当作剧情自动结局。']}}
}
