import {pluginData} from './rpgmaker-plugins.mjs'
export function loopAnimationCommands(ctx,{emit,raw,resource,variable,stage}) {
 const rows=new Map(pluginData(ctx,'LL_LoopAnimation','animations').map(r=>[r.id,r]))
 return (action,args)=>{
  const number=Number(args.number||1),slot=`rpg-ll-loop-${number}`
  if(!['playAnimation','clippingAnimation','stopAnimation','reserveAnimation'].includes(action))return false
  if(!Number.isInteger(number)||number<1||number>8){raw('loop-animation-slot',args);return true}
  if(action==='reserveAnimation')return true
  if(action==='stopAnimation'){emit({op:'overlayOff',slot});emit({op:'overlayOff',slot:slot+'-overlay'});return true}
  const row=rows.get(args.id),lines=String(row?.animationFrames||'').split(/\r?\n/).filter(Boolean)
  if(!row||!lines.length||lines.length>10000){raw('loop-animation-missing',args);return true}
  const frames=lines.map(line=>{
   const [name,se,gate,volume,pitch]=line.split(',')
   const src=resource('img/ll_loopanimation',name),event={}
   if(se&&!Number(gate))event.extraSounds=[{sounds:[resource('audio/se',se,'ogg')],volume:[Number(volume||90)/100,Number(volume||90)/100],pitch:[Number(pitch||100)/100,Number(pitch||100)/100]}]
   return {src,seconds:Math.max(1,Number(row.frame)||1)/60,...(Object.keys(event).length?{event}:{})}
  })
  if(frames.some(f=>!f.src)){raw('loop-animation-path',args);return true}
  const fixed=action==='clippingAnimation'?Number(args.fixedFrame||1)-1:null
  if(fixed!==null&&(!Number.isInteger(fixed)||!frames[fixed])){raw('loop-animation-frame',args);return true}
  const cmd={op:'overlay',slot,src:frames[fixed??0].src,stage,fit:'none',anchor:[0,0],x:Number(args.x||0)-stage[0]/2,y:Number(args.y||0)-stage[1]/2,scaleX:Math.abs(Number(args.scaleX||100))/100,scaleY:Math.abs(Number(args.scaleY||100))/100,flipX:Number(args.reverse||0)!==0,rotation:Number(args.rotation||0),z:-100+number,cg:true}
  for(const axis of ['x','y']){const m=/^\\V\[(\d+)\]$/i.exec(String(args[axis]||''));if(m){cmd[axis+'Var']=variable(m[1]);cmd[axis+'Offset']=-stage[axis==='x'?0:1]/2;cmd[axis]=0}}
  if(fixed===null)cmd.animation={key:`ll-loop:${number}:${row.id}`,frames,loopStart:0}
  emit(cmd)
  emit(args.overlayImage?{op:'overlay',slot:slot+'-overlay',src:resource('img/pictures',args.overlayImage),stage,fit:'none',anchor:[0,0],x:-stage[0]/2,y:-stage[1]/2,z:-90+number}:{op:'overlayOff',slot:slot+'-overlay'})
  if(lines.some(line=>Number(line.split(',')[2])))raw('loop-animation-conditional-audio',{id:row.id,reason:'native variable-gated frame sounds not simulated'})
  if(Number(args.hueFrame)||['toneR','toneG','toneB','toneC'].some(k=>Number(args[k])))raw('loop-animation-tone',args)
  return true
 }
}
