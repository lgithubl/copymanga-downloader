import{createKaijuState}from'./gal-kaiju-state.js'
import{createInteractionMeter}from'./gal-interaction-meters.js'
import{createInteractionSounds}from'./gal-interaction-sounds.js'
import{hakuboxAdventure}from'./gal-hakubox-adventure.js'
// Persistent native presentation state. Only normalized Gal commands run here.
import{initialState,applyCommand,condMet,visibleChoiceOptions}from'./gal-engine.js'
import{createSpineLayer}from'./gal-spine.js'
import{createOverlayLayer}from'./gal-stand.js'
export function createCommandInteractionLayers({parent,url,onMissing,onError,onUnavailable,onMessage,onChoice,onBusy,onAudio,conditionState=()=>true,onMeter=()=>{},onMeters=()=>{},onMeterReady=null,canAutoTrigger=()=>true,audioGain=()=>1}){
 const under=createOverlayLayer({parent,url,onMissing,under:true}),spine=createSpineLayer({parent,url,onMissing,onError,onUnavailable}),over=createOverlayLayer({parent,url,onMissing}),loops=new Map()
 let state=initialState(),modelKey='',actionKey='',configuration='',generation=0,waiting=null,waitingKind='',timer=0,paused=false,presentation=null,meter=null,model=null,running=false,visualOverrides={},lastTick=performance.now(),kaiju=null
 const clearWait=()=>{clearTimeout(timer);waiting?.();waiting=null;waitingKind=''},finishWait=()=>{const resolve=waiting;waiting=null;waitingKind='';clearTimeout(timer);resolve?.()},advance=()=>{if(waitingKind!=='choice')finishWait()}
 function cancel(){running=false;generation++;clearWait();onChoice(null);onBusy(false)}
 const wait=(ms,kind='delay')=>new Promise(resolve=>{waitingKind=kind;waiting=resolve;if(ms!==null)timer=setTimeout(advance,Math.min(120000,Math.max(0,ms)))})
 function kaijuPaint(f){const specs=[{op:'spine',slot:'kaiju:main',...model.kaiju.modelSpec,skins:f.skins,anim:f.anim,slotVisibility:f.slots,slotAttachments:model.kaiju.slotAttachments}];for(let i=1;i<=3;i++){const spread=f.spreads[i];specs.push(spread?{op:'spine',slot:'kaiju:spread:'+i,...spread,order:10+i,screenRect:{x:.02+(i-1)*.32,y:.02,w:.29,h:.27}}:{op:'spineOff',slot:'kaiju:spread:'+i})}return specs}
 function nativeBranches(){for(let i=0;i<4;i++){let changed=false;for(const b of model?.nativeBranches||[]){const value=state.vars[b.var];if(value==='__fox_unknown__'||!Number.isFinite(Number(value)))continue;const enabled=b.chain.every(id=>Number(state.vars['fox-active:'+id]??model.nativeObjects[id]??1)!==0);for(const c of b.cases){const on=Number(enabled&&c.judge!==null&&(Number(value)===c.judge||c.keep&&Number(value)>c.judge));if(state.vars['fox-active:'+c.object]!==on){state.vars['fox-active:'+c.object]=on;changed=true}}}if(!changed)break}}
 function meterState(){if(!meter)return;const snapshot=meter.snapshot();state.vars['fox-state:girl1:愛心']=snapshot.count;onMeter(snapshot)}
 async function paint(){nativeBranches();const specs=Object.fromEntries(Object.entries(state.spines).map(([id,s])=>{const chain=model?.nativeGraphics?.[id],visible=typeof visualOverrides[id]==='boolean'?visualOverrides[id]:chain?chain.every(o=>Number(state.vars['fox-active:'+o]??model.nativeObjects[o]??1)!==0):s.visible;return[id,{...s,visible}]}));await Promise.all([spine.set(specs,{live:true}),under.set(state.overlays.filter(o=>o.under),{live:true}),over.set(state.overlays.filter(o=>!o.under),{live:true})])}
 const sequences=createInteractionSounds({url,gain:audioGain,onError})
 function clearAudio(){sequences.clear();for(const a of loops.values())a.pause();loops.clear()}
 async function run(input,reset=false,selections={}){const commands=structuredClone(input||[]);cancel();const mine=generation;running=true;onBusy(true);let reply={};try{
  if(reset){state=initialState();clearAudio()}
  for(const [index,source] of (commands||[]).entries()){const c=structuredClone(source);if(c.tracks)c.tracks=c.tracks.map(t=>({...t,token:mine+':'+t.token}));if(mine!==generation)return;if(!condMet(c.when,state.vars)||c.ifAbsent&&Object.hasOwn(state.vars,c.var))continue
   if(c.op==='kaijuAction'||c.op==='kaijuCloth'){
    if(!kaiju)throw Error('Kaiju interaction state missing')
    const reply=c.op==='kaijuAction'?kaiju.action(c.id,c.on!==false):{frame:kaiju.cloth(c.id,c.on!==false),snapshot:kaiju.snapshot()},f=reply.frame,next=kaijuPaint(f)
    if(reply.voiceId){const key=reply.voiceId.replaceAll('{0}',model.kaiju.voiceLanguage),src=model.kaiju.media['sound/'+key.toLowerCase()]||model.kaiju.media['sound/'+model.kaiju.voiceLanguage+'/'+key.toLowerCase()];if(src)next.push({op:'voice',src});else onError(Error('Kaiju original voice missing: '+key))}
    if(reply.text||reply.voiceId)next.push({op:'text',segments:[{text:reply.text||''}]});commands.splice(index+1,0,...next);onMeters(reply.snapshot);continue
   }
   if(c.op==='interactionMeterRate'){meter?.rate(c.part,c.rate,c.scaled);continue}
   if(c.op==='interactionSoundGroups'){sequences.set(c.slot,c.groups,c.objectStates);continue}
   if(c.op==='interactionWaitAudio'){const audio=sequences.audio(c.slot)||loops.get(c.slot);if(audio&&!audio.loop&&!audio.ended){await new Promise(resolve=>{waiting=resolve;waitingKind='audio';const release=()=>{if(mine===generation&&waiting===resolve)finishWait()};audio.addEventListener('ended',release,{once:true});audio.addEventListener('error',release,{once:true});timer=setTimeout(release,120000)})}continue}
   if(c.interactionConditionPrompt)continue
   if(c.op==='choice'&&c.interactionCondition){const condition=c.interactionCondition,value=conditionState(condition)?condition.trueValue:condition.falseValue;applyCommand(state,c,{[c.id]:value});continue}
   if(c.op==='interactionSpineSource'){const m=/^SpineManager\.(setMotion|addMotion)\([^,]+,\s*['"]([^'"]+)['"],\s*(true|false),\s*(\d+)\);?$/.exec(c.source);if(m){applyCommand(state,{op:'spine',slot:'hakubox:interact',patchTracks:true,tracks:[{track:Number(m[4]),anim:m[2],loop:m[3]==='true',queue:m[1]==='addMotion',token:mine+':'+c.source}]})}else onError(Error('未支持原生动作：'+c.source));continue}
   if(c.op==='interactionPresentation'){presentation?.(c.source);continue}if(c.op==='interactionCondition'){state.vars[c.var]=Number(presentation?.condition(c.source));continue}
   if(c.op==='interactionVoiceChoice'){const picked=selections['choice:'+c.id],options=c.options||[],option=options.find(o=>String(o.value)===String(picked))||options[Math.floor(Math.random()*options.length)];if(option?.voice)onAudio('voice',{src:option.voice});continue}
   if(c.op==='choice'&&c.random){const picked=selections['choice:'+c.id],options=visibleChoiceOptions(c,state.vars),option=options.find(o=>String(o.value)===String(picked))||options[Math.floor(Math.random()*options.length)];if(option)applyCommand(state,c,{[c.id]:option.value});continue}
   if(c.op==='choice'){await paint();if(mine!==generation)return;let picked;await new Promise(resolve=>{waitingKind='choice';waiting=resolve;onChoice({options:visibleChoiceOptions(c,state.vars),select:value=>{picked=value;finishWait()}})});onChoice(null);if(mine!==generation)return;if(picked!==undefined)applyCommand(state,c,{[c.id]:picked});continue}
   if(c.op==='voice'){reply.voice=c.src;continue}if(c.op==='voiceStop'){reply.voice='';onAudio('voiceStop');continue}
   if(c.op==='se'){onAudio('se',c);continue}
   if(['bgvoice','bgm','bgse'].includes(c.op)){const key=c.slot||c.op;loops.get(key)?.pause();if(c.src){const a=new Audio(url(c.src));a.loop=c.loop!==false;a.interactionKind=c.op==='bgvoice'&&c.kind!=='bgse'?'voice':'sfx';a.interactionVolume=Math.max(0,Math.min(1,c.volume??.7));a.volume=a.interactionVolume*audioGain(a.interactionKind);loops.set(key,a);if(!paused)a.play().catch(()=>onError(Error('音频无法播放：'+c.src)))}continue}
   if(['bgvoiceOff','bgmStop','bgseStop'].includes(c.op)){const key=c.slot||({bgmStop:'bgm',bgseStop:'bgse'}[c.op]);if(key){sequences.stop(key);loops.get(key)?.pause();loops.delete(key)}continue}
   if(c.op==='wait'){await paint();if(mine!==generation)return;await wait(Math.max(0,c.seconds||0)*1000);continue}
   if(c.op==='raw'){onError(Error(c.cmd+(c.args?' · '+JSON.stringify(c.args).slice(0,500):'')));continue}
   applyCommand(state,c)
   if(c.op==='set'&&model?.nativeStateBounds?.[c.var]&&Number.isFinite(state.vars[c.var])){const b=model.nativeStateBounds[c.var];if(b.mode===2)state.vars[c.var]=Math.max(b.min,Math.min(b.max,state.vars[c.var]))}
   if(c.op==='text'){await paint();if(mine!==generation)return;const text=(c.segments||[]).map(s=>s.text||'').join('');const voiced=!!reply.voice;onMessage({...reply,text});reply={};if(commands[index+1]?.op!=='choice')await wait(voiced?null:Math.max(1500,text.length*55),'text')}
  }
  if(mine===generation){meterState();await paint()}
 }catch(e){onError(e)}finally{if(mine===generation){running=false;onChoice(null);onBusy(false)}}}
 const clock=setInterval(()=>{const now=performance.now(),dt=Math.min(.25,(now-lastTick)/1000);lastTick=now;if(paused||document.hidden||!model)return;const event=meter?.tick(dt,{busy:!!onMeterReady||running||!canAutoTrigger()});meterState();nativeBranches();sequences.tick(dt,state.vars);if(meter)void paint();if(onMeterReady&&meter?.pending())onMeterReady(meter.pending());else if(event&&model.meter.events?.[event]?.length)void run(model.meter.events[event])},100)
 return{async set(specs){const spec=specs.interaction;if(!spec){modelKey='';actionKey='';configuration='';meter=null;kaiju=null;model=null;cancel();clearAudio();state=initialState();await paint();return}
  const overrideChanged=JSON.stringify(visualOverrides)!==JSON.stringify(spec.visualOverrides||{});visualOverrides=spec.visualOverrides||{};
  const next=spec.commandModel,config=JSON.stringify(spec.configurationCommands||[])
  if(next!==modelKey){model=spec;kaiju=spec.kaiju?createKaijuState(spec.kaiju,spec.kaijuInitial||{}):null;if(kaiju)onMeters(kaiju.snapshot());meter=spec.meter?createInteractionMeter(spec.meter,spec.meterInitial||{}):null;presentation=spec.hakuboxAdventure?hakuboxAdventure({enabled:true,stage:spec.stage,resource:(folder,name)=>spec.resources[folder+'/'+name]||'',emit:c=>applyCommand(state,c),raw:(reason)=>onError(Error(reason))}):null;modelKey=next;actionKey='';configuration=config;void run([...(spec.initialCommands||[]),...(spec.configurationCommands||[])],true)}
  else if(config!==configuration){configuration=config;actionKey='';void run(spec.configurationCommands||[])}
  else if(spec.actionCommands&&actionKey!==String(spec.motionToken)){actionKey=String(spec.motionToken);void run(spec.actionCommands,false,spec.alternativeSelections)}else if(overrideChanged)void paint()
 },seekMeters(id,fraction){if(!kaiju)return;kaiju.seek(id,fraction);onMeters(kaiju.snapshot());const f=kaiju.frame();for(const c of kaijuPaint(f))applyCommand(state,c);void paint()},triggerMeter(event){if(!meter||meter.pending()!==event)return;const fired=meter.tick(0);meterState();if(fired&&model.meter.events?.[fired]?.length)void run(model.meter.events[fired])},audioBusy(){return !!sequences.audio()},seekMeter(fraction){meter?.seek(fraction);meterState()},advance,advanceVoice(){if(waitingKind==='text')finishWait()},cancel,setVolume(){sequences.setVolume();for(const a of loops.values())a.volume=a.interactionVolume*audioGain(a.interactionKind)},setPaused(v){paused=v;lastTick=performance.now();sequences.setPaused(v);spine.setPaused(v);under.setPaused(v);over.setPaused(v);if(v){cancel();for(const a of loops.values())a.pause()}else for(const a of loops.values())a.play().catch(()=>{})},hitTest(){return[]},regionShapes(){return[]},destroy(){clearInterval(clock);cancel();clearAudio();under.destroy();spine.destroy();over.destroy()}}
}
