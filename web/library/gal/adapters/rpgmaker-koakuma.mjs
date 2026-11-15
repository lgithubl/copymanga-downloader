import {koakumaAnimationOverlays} from './rpgmaker-koakuma-animation.mjs'
// Native fm001 voice/BGV routing, from its declarative command arguments.
// Native frame playback is separate from the diagnosed touching/minigame input.
export function koakumaCommands({audio,emit,raw,ctx,variable,initial,pause}){
 let chara=0,type='',tension=0
 const names=['かりん','静音','優花菜','本屋','けもみみ','カラオケ','聖音','暴食'],tags=['k','s','y','b','km','kr','se','bs']
 const stop=()=>emit({op:'bgvoiceOff',slot:'rpg-koakuma-bgv'})
 const play=number=>{if(!chara)return;audio('bgvoice',{name:`${String(chara).padStart(2,'0')}/mc_${tags[chara-1]}_${number}`,folder:'audio/se/voice',volume:25,loop:true,slot:'rpg-koakuma-bgv',token:`koakuma:${chara}:${number}`})}
 let animationSerial=0
 const model=ctx?.koakumaAnimation,active='rpg:koakuma:animation-active'
 if(model)initial.set(active,0)
 const clearAnimation=()=>emit({op:'overlayOff',prefix:'rpg-koakuma'})
 const activation=()=>{
  emit({op:'set',var:active,value:0})
  for(const entry of model.families.values())emit({op:'set',var:active,value:1,when:[{var:variable(400),op:'===',value:entry.missionId}]})
  return [{var:active,op:'===',value:1}]
 }
 const animate=()=>{
  const when=activation(),token=animationSerial++
  // Clear the same picture range as ClearTouchMode, preserving its previous
  // picture and picture52 exceptions. Do this once, rather than per family.
  for(let id=6;id<=100;id++)if(id!==52){const conditions=[...when,{var:variable(411),op:'!==',value:id}];emit({op:'overlayOff',slot:`rpg-picture-${id}`,when:conditions});emit({op:'set',var:`rpg:picture:${id}`,value:0,when:conditions});emit({op:'overlay',slot:`rpg-picture-${id}`,alpha:0,when:[...when,{var:variable(411),op:'===',value:id}]})}
  emit({op:'overlay',slot:'rpg-picture-52',alpha:0,when})
  for(const entry of model.families.values()){
   const gate=[...when,{var:variable(400),op:'===',value:entry.missionId}]
   for(const pattern of [1,2])for(const command of koakumaAnimationOverlays(entry,pattern,{key:token}))emit({...command,when:[...gate,{var:variable(555,'s'),op:'===',value:pattern===2?1:0}]})
   const i=names.indexOf(entry.heroine)
   if(i>=0)emit({op:'bgvoice',slot:'rpg-koakuma-touch-bgv',kind:'bgvoice',src:`audio/se/voice/${String(i+1).padStart(2,'0')}/mc_${tags[i]}_921.ogg`,loop:true,volume:.25,token:`koakuma-touch:${entry.missionId}:${token}`,when:gate})
  }
  emit({op:'fade',to:'clear',seconds:1,when})
  pause(when)
  raw('koakuma-touch-interaction',{reason:'native base animation; touch/minigame input not simulated'})
 }
 const update=()=>{if(!chara||!type)return;const base=({'羞恥':901,'身体触り':903,'キス':906,'フェラ':908,'性器弄り':910,'セックス':921})[type];if(!base){raw('koakuma-bgv-type',type);return}play(base+tension)}
 return(name,action,args)=>{
  if(name==='fm001_Koakuma'&&action==='PlayVoice'){audio('voice',{name:args.voiceFile,folder:'audio/se/voice',volume:25});return true}
  if(name!=='fm001_Koakuma_Touch')return false
  if(model){
   if(action==='ExecuteTouchModeReset'){clearAnimation();animate();return true}
   if(action==='ExecuteTouchMode'){raw('koakuma-touch-result',{reason:'native minigame result is not synthesized'});return true}
   if(['ExecuteTouchModeCgErase','ExecuteTouchModeEnd'].includes(action)){clearAnimation();emit({op:'bgvoiceOff',slot:'rpg-koakuma-touch-bgv'});if(action==='ExecuteTouchModeEnd')for(let id=6;id<=100;id++)emit({op:'overlay',slot:`rpg-picture-${id}`,alpha:1,when:[{var:active,op:'===',value:1},{var:variable(411),op:'===',value:id}]});return true}
  }
  if(action==='PlaySceneBgvSetup'){stop();chara=0;type='';tension=0;return true}
  if(action==='PlaySceneBgvStop'){stop();tension=0;return true}
  if(action==='PlaySceneBgvChangeChara'){const at=names.indexOf(String(args.Chara).trim());chara=at<0?1:at+1;update();return true}
  if(action==='PlaySceneBgvChangeType'){type=String(args.BgvType);update();return true}
  if(action==='PlaySceneBgvStart'){tension=0;update();return true}
  if(action==='PlaySceneBgvTensionUp'||action==='PlaySceneBgvTensionDown'){tension=action.endsWith('Up')?1:0;update();return true}
  if(action==='PlaySceneBgvAfterZettyouYes'||action==='PlaySceneBgvAfterZettyouNo'){play(action.endsWith('Yes')?931:932);return true}
  return false
 }
}
