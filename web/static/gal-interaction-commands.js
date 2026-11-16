import{hakuboxAdventure}from'./gal-hakubox-adventure.js'
// Persistent native presentation state. Only normalized Gal commands run here.
import{initialState,applyCommand,condMet,visibleChoiceOptions}from'./gal-engine.js'
import{createSpineLayer}from'./gal-spine.js'
import{createOverlayLayer}from'./gal-stand.js'
export function createCommandInteractionLayers({parent,url,onMissing,onError,onUnavailable,onMessage,onChoice,onBusy,onAudio}){
 const under=createOverlayLayer({parent,url,onMissing,under:true}),spine=createSpineLayer({parent,url,onMissing,onError,onUnavailable}),over=createOverlayLayer({parent,url,onMissing}),loops=new Map()
 let state=initialState(),modelKey='',actionKey='',configuration='',generation=0,waiting=null,timer=0,paused=false,presentation=null
 const clearWait=()=>{clearTimeout(timer);waiting?.();waiting=null},advance=()=>{const resolve=waiting;waiting=null;clearTimeout(timer);resolve?.()}
 function cancel(){generation++;clearWait();onChoice(null);onBusy(false)}
 const wait=ms=>new Promise(resolve=>{waiting=resolve;if(ms!==null)timer=setTimeout(advance,Math.min(120000,Math.max(0,ms)))})
 async function paint(){await Promise.all([spine.set(state.spines,{live:true}),under.set(state.overlays.filter(o=>o.under),{live:true}),over.set(state.overlays.filter(o=>!o.under),{live:true})])}
 function clearAudio(){for(const a of loops.values())a.pause();loops.clear()}
 async function run(commands,reset=false){cancel();const mine=generation;onBusy(true);let reply={};try{
  if(reset){state=initialState();clearAudio()}
  for(const [index,source] of (commands||[]).entries()){const c=structuredClone(source);if(c.tracks)c.tracks=c.tracks.map(t=>({...t,token:mine+':'+t.token}));if(mine!==generation)return;if(!condMet(c.when,state.vars)||c.ifAbsent&&Object.hasOwn(state.vars,c.var))continue
   if(c.op==='interactionSpineSource'){const m=/^SpineManager\.(setMotion|addMotion)\([^,]+,\s*['"]([^'"]+)['"],\s*(true|false),\s*(\d+)\);?$/.exec(c.source);if(m){applyCommand(state,{op:'spine',slot:'hakubox:interact',patchTracks:true,tracks:[{track:Number(m[4]),anim:m[2],loop:m[3]==='true',queue:m[1]==='addMotion',token:mine+':'+c.source}]})}else onError(Error('未支持原生动作：'+c.source));continue}
   if(c.op==='interactionPresentation'){presentation?.(c.source);continue}if(c.op==='interactionCondition'){state.vars[c.var]=Number(presentation?.condition(c.source));continue}
   if(c.op==='choice'){await paint();if(mine!==generation)return;let picked;await new Promise(resolve=>{waiting=resolve;onChoice({options:visibleChoiceOptions(c,state.vars),select:value=>{picked=value;advance()}})});onChoice(null);if(mine!==generation)return;if(picked!==undefined)applyCommand(state,c,{[c.id]:picked});continue}
   if(c.op==='voice'){reply.voice=c.src;continue}if(c.op==='voiceStop'){reply.voice='';onAudio('voiceStop');continue}
   if(c.op==='se'){onAudio('se',c);continue}
   if(['bgvoice','bgm','bgse'].includes(c.op)){const key=c.slot||c.op;loops.get(key)?.pause();if(c.src){const a=new Audio(url(c.src));a.loop=c.loop!==false;a.volume=Math.max(0,Math.min(1,c.volume??.7));loops.set(key,a);if(!paused)a.play().catch(()=>onError(Error('音频无法播放：'+c.src)))}continue}
   if(['bgvoiceOff','bgmStop','bgseStop'].includes(c.op)){const key=c.slot||({bgmStop:'bgm',bgseStop:'bgse'}[c.op]);if(key){loops.get(key)?.pause();loops.delete(key)}continue}
   if(c.op==='wait'){await paint();if(mine!==generation)return;await wait(Math.max(0,c.seconds||0)*1000);continue}
   if(c.op==='raw'){onError(Error(c.cmd+(c.args?' · '+JSON.stringify(c.args).slice(0,500):'')));continue}
   applyCommand(state,c)
   if(c.op==='text'){await paint();if(mine!==generation)return;const text=(c.segments||[]).map(s=>s.text||'').join('');const voiced=!!reply.voice;onMessage({...reply,text});reply={};if(commands[index+1]?.op!=='choice')await wait(voiced?null:Math.max(1500,text.length*55))}
  }
  if(mine===generation)await paint()
 }catch(e){onError(e)}finally{if(mine===generation){onChoice(null);onBusy(false)}}}
 return{async set(specs){const spec=specs.interaction;if(!spec){modelKey='';actionKey='';configuration='';cancel();clearAudio();state=initialState();await paint();return}
  const next=spec.commandModel,config=JSON.stringify(spec.configurationCommands||[])
  if(next!==modelKey){presentation=spec.hakuboxAdventure?hakuboxAdventure({enabled:true,stage:spec.stage,resource:(folder,name)=>spec.resources[folder+'/'+name]||'',emit:c=>applyCommand(state,c),raw:(reason)=>onError(Error(reason))}):null;modelKey=next;actionKey='';configuration=config;void run([...(spec.initialCommands||[]),...(spec.configurationCommands||[])],true)}
  else if(config!==configuration){configuration=config;actionKey='';void run(spec.configurationCommands||[])}
  else if(spec.actionCommands&&actionKey!==String(spec.motionToken)){actionKey=String(spec.motionToken);void run(spec.actionCommands)}
 },advance,cancel,setPaused(v){paused=v;spine.setPaused(v);under.setPaused(v);over.setPaused(v);if(v){cancel();for(const a of loops.values())a.pause()}else for(const a of loops.values())a.play().catch(()=>{})},hitTest(){return[]},regionShapes(){return[]},destroy(){cancel();clearAudio();under.destroy();spine.destroy();over.destroy()}}
}
