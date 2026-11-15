// Static TRP Skit actors/expressions. Read native config and atlas data; never game JS.
import {open,readFile} from 'node:fs/promises'
import path from 'node:path'
import {structValue} from './rpgmaker-plugins.mjs'
import {decryptRpgMaker} from '../rpgmaker.mjs'
export async function prepareSkit(ctx,{mediaDir,files,root=''}){
 const plugin=ctx.plugins.find(p=>p.name.split('/').at(-1)==='TRP_SkitMZ_Config');if(!plugin)return null
 const cfg=plugin.parameters||{},actors=structValue(cfg.SkitActorSettings||'[]'),positions=structValue(cfg.xPosition||'[]'),index=new Map(files.map(f=>[f.toLowerCase(),f])),map=new Map();if(!Array.isArray(actors))throw Error('TRP Skit actor config must be an array')
 const prefix=root?root+'/':''
 for(const actor of actors){if(!actor?.fileName||/[\\/]|\.\./.test(actor.fileName))continue;const poses=structValue(actor.pose||'[]'),item={...actor,poses:Array.isArray(poses)?poses:[],frames:null,sizes:new Map(),looseFaces:new Map()};
  if(cfg.useMultiLayer==='false'&&cfg.useSpritesheets==='false')for(const pose of item.poses){
   const prefix=(root?root+'/':'')+'img/pictures/busts/'+actor.fileName+'/'+pose.name+'_',faces=new Map()
   for(const f of files)if(f.startsWith(prefix)&&/\.(?:png_|png|rpgmvp)$/i.test(f)){const exp=f.slice(prefix.length).replace(/\.(?:png_|png|rpgmvp)$/i,'');if(exp&&!exp.includes('/'))faces.set(exp,'img/pictures/busts/'+actor.fileName+'/'+pose.name+'_'+exp+'.png')}
   item.looseFaces.set(pose.name,faces)
  }
  if(mediaDir){const rel=index.get((prefix+'img/pictures/busts/'+actor.fileName+'/texture.json').toLowerCase());if(rel){const f=await open(path.join(mediaDir,...rel.split('/')),'r');try{if((await f.stat()).size>1024*1024)throw Error('Skit atlas metadata exceeds1MB');item.frames=JSON.parse(await f.readFile('utf8'));if(Array.isArray(item.frames.frames))item.frames={...item.frames,frames:Object.fromEntries(item.frames.frames.map(frame=>{if(!frame||typeof frame.filename!=='string')throw Error('Skit atlas frame missing filename');return[frame.filename,frame]}))}}finally{await f.close()}}
   for(const pose of item.poses){const base=prefix+'img/pictures/busts/'+actor.fileName+'/'+pose.name,rel=index.get((base+'.png').toLowerCase())||index.get((base+'.png_').toLowerCase())||index.get((base+'.rpgmvp').toLowerCase());if(!rel)continue;const f=await open(path.join(mediaDir,...rel.split('/')),'r');try{const b=Buffer.alloc(64),{bytesRead}=await f.read(b,0,b.length,0);let data=b.subarray(0,bytesRead);if(/\.(?:png_|rpgmvp)$/i.test(rel))data=decryptRpgMaker(data,ctx.system.encryptionKey);if(data.length>=24&&data.subarray(0,8).toString('hex')==='89504e470d0a1a0a')item.sizes.set(pose.name,[data.readUInt32BE(16),data.readUInt32BE(20)])}finally{await f.close()}}
  }
  for(const key of [actor.fileName,actor.name,actor.inputName])if(key)map.set(key,item)
 }
 return{cfg,singleLayer:cfg.useMultiLayer==='false'&&cfg.useSpritesheets==='false',actors:map,positions:new Map(Array.isArray(positions)?positions.map(p=>[p.name,Number(p.position)]):[])}
}
export function skitCommands(ctx,{emit,raw,initial,stage}){
 const skit=ctx.skit;if(!skit)return()=>false
 const records=[...new Set(skit.actors.values())],root='img/pictures/busts/',key=(a,k)=>`rpg:skit:${a.fileName}:${k}`,slots=a=>['rpg-skit-body:'+a.fileName,'rpg-skit-face:'+a.fileName]
 const position=value=>{const n=Number(value);return Number.isFinite(n)&&value!==''?n:(skit.positions.get(value)??skit.positions.get(skit.cfg.defaultPositionX)??7.5)}
 const draw=a=>{const [body,face]=slots(a),poses=a.poses.length?a.poses:[{name:'normal'}];for(const pose of poses){const when=[{var:key(a,'visible'),op:'===',value:1},{var:key(a,'pose'),op:'===',value:pose.name}],xVar=key(a,'x'),yVar=key(a,'y'),src=root+a.fileName+'/'+pose.name+'.png';emit({op:'overlay',slot:body,src,kind:'stand',stage,xVar,yVar,anchor:[0.5,1],fit:'none',scaleX:Number(skit.cfg.bustsScale||100)/100,scaleY:Number(skit.cfg.bustsScale||100)/100,z:10,when});emit({op:'overlayOff',slot:face,when});const faces=a.looseFaces.get(pose.name);if(faces?.size){
    const size=a.sizes.get(pose.name),scale=Number(skit.cfg.bustsScale||100)/100
    if(!size){raw('skit-body-dimensions-missing',a.fileName+':'+pose.name);continue}
    for(const [exp,faceSrc]of faces)emit({op:'overlay',slot:face,src:faceSrc,anchor:[.5,0],kind:'stand',stage,xVar,yVar,yOffset:-size[1]*scale,scaleX:scale,scaleY:scale,fit:'none',z:11,when:[...when,{var:key(a,'expression'),op:'===',value:exp}]})
    continue
   }const frames=a.frames?.frames;if(!frames){raw('skit-atlas-metadata-missing',a.fileName);continue}const size=a.sizes.get(pose.name);if(!size){raw('skit-body-dimensions-missing',a.fileName+':'+pose.name);continue}
   const expressionPose=ctx.options.skit?.expressionPoses?.[a.fileName]?.[pose.name]||'normal';for(const[name,frame]of Object.entries(frames)){if(!name.startsWith(expressionPose+'_'))continue;if(frame.rotated){raw('skit-rotated-atlas-frame',name);continue}const rect=frame.frame,trim=frame.spriteSourceSize||{x:0,y:0};if(!rect||![rect.x,rect.y,rect.w,rect.h].every(Number.isFinite))continue;const scale=Number(skit.cfg.bustsScale||100)/100;emit({op:'overlay',slot:face,src:root+a.fileName+'/'+(a.frames.meta?.image||'texture.png').replace(/\.png$/i,'.png'),crop:[rect.x,rect.y,rect.w,rect.h],anchor:[0,0],kind:'stand',stage,xVar,yVar,xOffset:(Number(trim.x)-size[0]/2)*scale,yOffset:(Number(trim.y)-size[1])*scale,scaleX:scale,scaleY:scale,fit:'none',z:11,when:[...when,{var:key(a,'expression'),op:'===',value:name.replace(/\.png$/i,'').slice(expressionPose.length+1)}]})}
  }}
 const autoKey='rpg:skit:auto',onKey='rpg:skit:on',nextKey='rpg:skit:auto-next';initial.set(autoKey,skit.singleLayer&&skit.cfg.defaultAutoMode==='true'?1:0);initial.set(onKey,1);initial.set(nextKey,0)
 for(const a of records){initial.set(key(a,'visible'),0);initial.set(key(a,'pose'),'normal');initial.set(key(a,'expression'),'default');initial.set(key(a,'x'),(position('')/10-.5)*stage[0]);initial.set(key(a,'y'),stage[1]/2-Number(skit.cfg.baseOffsetY||0)+Number(a.poses.find(p=>p.name==='normal')?.displayOffsetY||0))}
 const move=(a,args)=>{
  if(args.positionVar){const named=[...skit.positions];emit({op:'set',var:key(a,'x'),valueVar:args.positionVar});emit({op:'set',var:key(a,'x'),calc:'mul',value:stage[0]/10});emit({op:'set',var:key(a,'x'),calc:'sub',value:stage[0]/2});for(const[name,pos]of named)emit({op:'set',var:key(a,'x'),value:(pos/10-.5)*stage[0],when:[{var:args.positionVar,op:'===',value:name}]})}
  else if(args.position!==undefined&&args.position!==''&&args.position!=='def')emit({op:'set',var:key(a,'x'),value:(position(args.position)/10-.5)*stage[0]})
 }
 return(action,args={})=>{action=({fadein:'fadeIn',movein:'moveIn',slidein:'slideIn',fadeout:'fadeOut',moveout:'moveOut',slideout:'slideOut'})[String(action).toLowerCase()]||action;if(['start','on','off'].includes(action)){emit({op:'set',var:onKey,value:action==='off'?0:1});return true}if(action==='auto'){emit({op:'set',var:autoKey,value:['true','on','1',true].includes(args.flag??args.value??args.auto)?1:0});return true}if(['clear','end'].includes(action)){emit({op:'set',var:nextKey,value:0});for(const a of records){emit({op:'set',var:key(a,'visible'),value:0});for(const slot of slots(a))emit({op:'overlayOff',slot})}return true}const a=skit.actors.get(String(args.name||''));if(!a)return false
  if(action==='speaker'){
   const gate=[{var:autoKey,op:'===',value:1},{var:onKey,op:'===',value:1}],fresh=[...gate,{var:key(a,'visible'),op:'===',value:0}],positions=structValue(skit.cfg.autoModePositions||'["right","left"]')
   for(let i=0;i<2;i++)emit({op:'set',var:key(a,'x'),value:(position(positions[i]||'center')/10-.5)*stage[0],when:[...fresh,{var:nextKey,op:'===',value:i}]})
   // Native auto mode replaces the oldest occupant of the selected position.
   for(const other of records)if(other!==a){const same=[...fresh,{var:key(other,'x'),op:'===',valueVar:key(a,'x')}];for(const slot of slots(other))emit({op:'overlayOff',slot,when:same});emit({op:'set',var:key(other,'visible'),value:0,when:same})}
   emit({op:'set',var:nextKey,calc:'add',value:1,when:fresh});emit({op:'set',var:nextKey,calc:'mod',value:2,when:fresh});emit({op:'set',var:key(a,'visible'),value:1,when:gate});draw(a);return true
  }
  if(['hide','fadeOut','moveOut','slideOut'].includes(action)){emit({op:'set',var:key(a,'visible'),value:0});for(const slot of slots(a))emit({op:'overlayOff',slot});return true}
  if(['show','fadeIn','moveIn','slideIn'].includes(action)){emit({op:'set',var:key(a,'visible'),value:1});move(a,args);if(args.expression&&args.expression!=='def')emit({op:'set',var:key(a,'expression'),value:String(args.expression)});draw(a);return true}
  if(['expression','exp'].includes(action)){emit({op:'set',var:key(a,'expression'),value:String(args.expression||'default')});draw(a);return true}
  if(action==='pose'){if(args.expression&&args.expression!=='def')emit({op:'set',var:key(a,'expression'),value:String(args.expression)});const name=String(args.pose||'normal'),pose=a.poses.find(p=>p.name===name);emit({op:'set',var:key(a,'pose'),...(args.poseVar?{valueVar:args.poseVar}:{value:name})});emit({op:'set',var:key(a,'y'),value:stage[1]/2-Number(skit.cfg.baseOffsetY||0)+Number(pose?.displayOffsetY||0)});if(args.poseVar)for(const p of a.poses)emit({op:'set',var:key(a,'y'),value:stage[1]/2-Number(skit.cfg.baseOffsetY||0)+Number(p.displayOffsetY||0),when:[{var:args.poseVar,op:'===',value:p.name}]});draw(a);return true}
  if(['move','position'].includes(action)){move(a,args);draw(a);return true}
  return false
 }
}
