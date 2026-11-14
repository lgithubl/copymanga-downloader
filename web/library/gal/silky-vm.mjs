import{initialState,applyCommand}from '../../static/gal-engine.js'
// Bounded MES stack interpreter. Executes data instructions, never Windows code.
export function silkyFunctions(lib){const result=new Map();for(let i=2;i<lib.ops.length;i++){const x=lib.ops[i];if(x.op!==22)continue;const id=lib.ops[i-1],argc=lib.ops[i-2];if(id.op!==50||argc.op!==50||argc.arg<0||argc.arg>32)throw Error('Silky library registration invalid');result.set(id.arg,{argc:argc.arg,start:i+1,end:x.arg})}return result}
export function runSilky(data,library,{decisions=[],maxInstructions=2000000,maxSteps=20000,resolve=x=>x,isCg=name=>/^EV[0-9]/i.test(name),initialContext=null,onNative=null}={}){
 const seed=initialContext?structuredClone(initialContext):null,display=seed?.display||initialState(),funcs=silkyFunctions(library),globals=new Map(seed?.globals||[]),events=[],diagnostics={},calls={},stackMaps=new WeakMap();let instructions=0,commands=[],source=0,message=-1,choiceIndex=0,options=[],pending=null,next='',actors=new Map(seed?.actors||[]),actorMemory=new Map(seed?.actorMemory||[])
 if(seed){if(display.bg)commands.push({op:'bg',...display.bg});if(display.bgZoom)commands.push({op:'bgZoom',...display.bgZoom});for(const overlay of display.overlays||[])commands.push({op:'overlay',...overlay});if(display.bgm)commands.push({op:'bgm',src:display.bgm})}
 const get=(type,k)=>globals.get(type+':'+k)??0,set=(type,k,v)=>globals.set(type+':'+k,v)
 const emit=c=>{commands.push(c);applyCommand(display,c)},flush=()=>{if(commands.length){events.push({source,commands});commands=[];if(events.length>maxSteps)throw Error('Silky scene step limit')}}
 const diag=(op,at,args)=>{const key=op;diagnostics[key]=(diagnostics[key]||0)+1;emit({op:'raw',cmd:key,args:JSON.stringify({script:data.name,offset:at,message,args}).slice(0,700)})}
 const resource=(name,kind)=>{const hit=resolve(name,kind);if(!hit)diag('unresolved-'+kind,source,name);return hit}
 const arithmetic=(op,a,b)=>{switch(op){case 52:return typeof a==='string'||typeof b==='string'?String(a)+String(b):(a+b)|0;case 53:return(a-b)|0;case 54:return Math.imul(a,b);case 55:return b?Math.trunc(a/b):0;case 56:return b?a%b:0;case 57:return 0;case 58:return +(!!a&&!!b);case 59:return +(!!a||!!b);case 60:return a&b;case 61:return a|b;case 62:return +(a<b);case 63:return +(a>b);case 64:return +(a<=b);case 65:return +(a>=b);case 66:return +(a===b);case 67:return +(a!==b)}}
 const native=(id,args,at)=>{
  onNative?.({id,args,at,source,message});calls[id]=(calls[id]||0)+1;const sub=args.at(-1),name=args.find(v=>typeof v==='string'),image=name&&/\.akb$/i.test(name)
  if(id===29&&image){
   const inner=args.at(-2),nums=args.slice(0,-2).filter(v=>typeof v==='number');let target=name
   if(sub===10)target=name.replace(/\.akb$/i,'.ui.png')
   const src=resource(target,'image');if(!src)return undefined
   if(sub===12){if(inner===0){emit({op:'overlayOff',slot:'silky:cg-diff'});emit({op:'bgZoom',scale:1,x:0,y:0});emit({op:'bg',src,cg:isCg(name)})}else if(inner===1)emit({op:'overlay',slot:'silky:cg-diff',src,stage:[1280,720],fit:'none',anchor:[0,0],x:(nums.at(-1)||0)-640,y:(nums.at(-2)||0)-360,z:1,cg:true});else diag('image-12-'+inner,at,args);return undefined}
   if(sub===10){if([6,7,8].includes(inner))emit({op:'overlay',slot:'silky:ui:'+inner,src,stage:[1280,720],fit:'none',anchor:[0,0],x:-720,y:-40,scaleX:0.4,scaleY:0.4,z:100+inner});else diag('portrait-10-'+inner,at,args);return undefined}
   if(sub===13&&[0,1,14].includes(inner)){
    if(inner===0||inner===14){let scale,pos,flags=16,x=0,y=null;const values=nums.slice(-3);if(inner===14&&nums.length>=5){const n=nums.slice(-5);x=n[0];y=n[1];flags=n[2];scale=n[3]/100;pos=n[4]}else if(values.length===3&&args.indexOf(name)===args.length-3){scale=values[0]/100;pos=values[1];flags=values[2]}else if(values.length===3){scale=values[2]/100;pos=values[0];flags=values[1]}else{diag('actor-layout-13',at,args);return undefined}
     if(!(scale>0&&scale<=4)||!Number.isInteger(pos)||pos<0||pos>7){diag('actor-layout-13',at,args);return undefined}
     x+=pos===0?0:pos===1?-300:pos===2?300:0;const geometry={stage:[1280,720],fit:'none',anchor:[0.5,0],x,y:(y??300-700*scale)-360,scaleX:scale,scaleY:scale,z:10+pos*2};actors.set(pos,geometry);actorMemory.set(pos,{geometry,src,name,flags});emit({op:'overlayOff',slot:'silky:actor:'+pos+':face'});emit({op:'overlay',slot:'silky:actor:'+pos+':body',src,...geometry,kind:'stand'})
    }else{const pos=nums.at(-1)||0,previous=actorMemory.get(pos);let geometry=actors.get(pos);if(!geometry&&previous&&previous.name.toUpperCase()===name.replace(/_H[0-9]+(?=\.AKB$)/i,'').toUpperCase()){geometry=previous.geometry;actors.set(pos,geometry);emit({op:'overlay',slot:'silky:actor:'+pos+':body',src:previous.src,...geometry,kind:'stand'})}if(geometry){if(previous)previous.faceSrc=src;emit({op:'overlay',slot:'silky:actor:'+pos+':face',src,...geometry,z:geometry.z+1,kind:'stand'})}else diag('actor-face-without-body',at,args)}return undefined
   }
   diag('image-'+sub+'-'+inner,at,args);return undefined
  }
  if(id===29&&sub===10&&[11,12].includes(args.at(-2))){for(const slot of[6,7,8])emit({op:'overlayOff',slot:'silky:ui:'+slot});return undefined}
  if(id===29&&sub===13&&args.at(-2)===4){const mask=args.at(-3);for(const pos of actors.keys()){if(Number.isInteger(mask)&&!(actorMemory.get(pos)?.flags&mask))continue;emit({op:'overlayOff',slot:'silky:actor:'+pos+':body'});emit({op:'overlayOff',slot:'silky:actor:'+pos+':face'});actors.delete(pos)}return undefined}
  if(id===29&&sub===13&&args.at(-2)===10){const n=args.slice(-5,-2),from=n[2],to=n[1],previous=actorMemory.get(from);if(!previous){diag('actor-move-without-body',at,args);return undefined}const position=i=>i===1?-300:i===2||i===3?300:0,geometry={...previous.geometry,x:previous.geometry.x+position(to)-position(from),z:10+to*2};for(const part of['body','face'])emit({op:'overlayOff',slot:'silky:actor:'+from+':'+part});actors.delete(from);actorMemory.delete(from);actors.set(to,geometry);actorMemory.set(to,{...previous,geometry});emit({op:'overlay',slot:'silky:actor:'+to+':body',src:previous.src,...geometry,kind:'stand'});if(previous.faceSrc)emit({op:'overlay',slot:'silky:actor:'+to+':face',src:previous.faceSrc,...geometry,z:geometry.z+1,kind:'stand'});return undefined}
  if(id===29&&sub===13&&args.at(-2)===2)return undefined // publish the prepared character set
  if(id===29&&sub===12&&args.at(-2)===11){emit({op:'overlayOff',slot:'silky:cg-diff'});return undefined}
  if(id===29&&sub===12&&args.at(-2)===4){emit({op:'bgZoom',merge:true,x:Number(args.at(-4))||0,y:Number(args.at(-3))||0});return undefined}
  if(id===29&&sub===12&&args.at(-2)===5){emit({op:'bgZoom',merge:true,scale:(Number(args.at(-3))||100)/100});return undefined}
  if(id===29&&sub===11){emit({op:'speaker',segments:name?[{text:name.replace(/^【|】$/g,'')}]:[]});return undefined}
  if(id===29&&sub===20&&options.length){
   flush();const key='silky:choice:'+choiceIndex,selected=decisions[choiceIndex++];if(selected===undefined){pending={key,options:options.map(x=>({...x})),source:at};throw STOP}
   if(!options.some(o=>o.value===selected))throw Error('Silky choice value invalid');options=[];return selected
  }
  if((id===15||id===16||id===18)&&name&&/\.(ogg|wav|mp3)$/i.test(name)){const kind=id===15?'bgm':id===16?'se':/\.ogg$/i.test(name)?'voice':'se',src=resource(name,kind);if(src)emit({op:kind,src});return undefined}
  if(id===21&&name&&/\.mes$/i.test(name)){next=name.replace(/\.mes$/i,'');return undefined}
  if(id===22){if(sub===3)flush();return undefined}
  // Engine query defaults are deterministic reader values; no mouse/timer/main-menu loops.
  if(id===25)return 0
  if(id===2)return 0
  if(id===20||id===19||id===23||id===24||id===26)return 0
  if(id===15||id===16||id===18)return sub===7?0:undefined
  if(id===27)return sub===2?0:undefined
  if(id===3)return 0
  if(id===29){if(sub===990)return 0;if(![10,11,12,13,20,1006].includes(sub))diag('native-29-'+sub,at,args);else if(sub===13&&![2,3,4].includes(args.at(-2)))diag('actor-operation-'+args.at(-2),at,args);return undefined}
  if(id===1)return undefined
  diag('syscall-'+id,at,args);return 0
 }
 const STOP=Symbol('choice')
 function run(program,locals=[],start=0,end=Infinity,depth=0){
  if(depth>32)throw Error('Silky library call depth limit');let map=stackMaps.get(program);if(!map){map=new Map(program.ops.map((x,i)=>[x.at,i]));stackMaps.set(program,map)}
  const stack=[];let i=start
  const pop=()=>{if(!stack.length)throw Error(`Silky ${program.name} stack underflow @${program.ops[i-1]?.at}`);return stack.pop()}
  while(i<program.ops.length&&program.ops[i].at<end){if(++instructions>maxInstructions)throw Error(`Silky ${data.name} instruction limit @${program.ops[i].at}`)
   const x=program.ops[i++],op=x.op,v=x.arg;if(program===data)source=x.at
   if(op===50||op===51)stack.push(v)
   else if([2,3,4,5,7,8,9].includes(op))stack.push(get(op,pop()))
   else if(op===6){const k=pop();if(!Number.isInteger(k)||k<0||k>=locals.length)throw Error('Silky library parameter out of bounds');stack.push(locals[k])}
   else if(op>=12&&op<=19){const k=pop(),value=pop(),type=({12:2,13:3,14:4,15:5,17:7,18:8,19:9})[op];if(op===16)locals[k]=value;else set(type,k,value)}
   else if(op>=52&&op<=67){const b=pop(),a=pop();stack.push(arithmetic(op,a,b))}
   else if(op===20||op===21){if(op===21||!pop()){const target=map.get(v);if(target===undefined){if(v===end)return stack;throw Error(`Silky ${program.name} bad jump @${x.at}`)}i=target}}
   else if(op===22)i=map.get(v)??program.ops.length
   else if(op===23){const id=pop(),f=funcs.get(id);if(!f)throw Error(`Silky ${data.name} @${source} missing library ${id}`);const args=Array.from({length:f.argc},pop).reverse(),returned=run(library,args,f.start,f.end,depth+1);stack.push(...returned)}
   else if(op===24){const id=pop(),args=stack.splice(0),returned=native(id,args,x.at);if(returned!==undefined)stack.push(returned)}
   else if(op===25){flush();message=v;emit({op:'speaker',segments:[]})}
   else if(op===26)options=[]
   else if(op===27){const value=pop();let text='';for(let j=i;j<program.ops.length&&program.ops[j].at<v;j++){const o=program.ops[j];if(o.op===10||o.op===11)text+=o.arg;else if(o.op===28)text+='\n'}options.push({value:Number(value)+1,segments:[{text}]});i=map.get(v)??program.ops.length}
   else if(op===10||op===11){const last=commands.at(-1);if(last?.op==='text')last.segments[0].text+=v;else emit({op:'text',segments:[{text:v}]})}
   else if(op===28){const last=commands.at(-1);if(last?.op==='text')last.segments[0].text+='\n'}
   else if(op===1)return stack
   else if(op!==0)diag('opcode-'+op,x.at,v)
  }
  return stack
 }
 try{run(data)}catch(e){if(e!==STOP)throw e}flush()
 return{events,pending,next,instructions,diagnostics,calls,context:{globals:[...globals],actors:[...actors],actorMemory:[...actorMemory],display}}
}
