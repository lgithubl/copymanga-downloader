// Native fm001 voice/BGV routing, from its declarative command arguments.
// Interactive touching/minigame state is intentionally left as diagnosed raw.
export function koakumaCommands({audio,emit,raw}){
 let chara=0,type='',tension=0
 const names=['かりん','静音','優花菜','本屋','けもみみ','カラオケ','聖音','暴食'],tags=['k','s','y','b','km','kr','se','bs']
 const stop=()=>emit({op:'bgvoiceOff',slot:'rpg-koakuma-bgv'})
 const play=number=>{if(!chara)return;audio('bgvoice',{name:`${String(chara).padStart(2,'0')}/mc_${tags[chara-1]}_${number}`,folder:'audio/se/voice',volume:25,loop:true,slot:'rpg-koakuma-bgv',token:`koakuma:${chara}:${number}`})}
 const update=()=>{if(!chara||!type)return;const base=({'羞恥':901,'身体触り':903,'キス':906,'フェラ':908,'性器弄り':910,'セックス':921})[type];if(!base){raw('koakuma-bgv-type',type);return}play(base+tension)}
 return(name,action,args)=>{
  if(name==='fm001_Koakuma'&&action==='PlayVoice'){audio('voice',{name:args.voiceFile,folder:'audio/se/voice',volume:25});return true}
  if(name!=='fm001_Koakuma_Touch')return false
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
