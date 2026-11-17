// Optional normalized animation sounds. Original assemblies/scripts never execute.
export function createSpineEventAudio({url,gain=()=>1,onError=()=>{},onVoice=()=>{},canAmbient=()=>true}){
 const nodes=new Map(),sounds=new Set(),reported=new Set();let paused=false,destroyed=false,played=0
 const signature=s=>JSON.stringify([s.skel,s.anim,s.tracks,s.skin,s.skins,s.eventToken,s.voiceLoop?.id]),valid=n=>!destroyed&&!paused&&nodes.get(n.slot)===n
 function report(key,message){if(destroyed)return;if(!reported.has(key)){reported.add(key);onError(Error(message))}}
 function request(n,key,voices,ambient=false){if(!voices?.length||n.pending.has(key)||!valid(n))return;const src=voices[Math.floor(Math.random()*voices.length)];n.pending.add(key);let finished=false;const done=()=>{if(finished)return;finished=true;n.pending.delete(key);n.cancellations.delete(key);if(ambient)n.nextAmbient=performance.now()+100};const cancel=onVoice({key:'spine-audio:'+n.slot+':'+key,src,valid:()=>valid(n),done});if(typeof cancel==='function'&&!finished)n.cancellations.set(key,cancel);played++}
 function effect(n,src){if(!valid(n))return;if(sounds.size>=32){const first=sounds.values().next().value;first.audio.pause();sounds.delete(first)}const audio=new Audio(url(src)),entry={audio,node:n};audio.interactionVolume=1;audio.volume=gain('sfx');sounds.add(entry);const done=()=>sounds.delete(entry);audio.addEventListener('ended',done,{once:true});audio.addEventListener('error',()=>{done();report(src,'动画音效无法播放：'+src)},{once:true});audio.play().catch(()=>{done();report(src,'动画音效未开始：'+src)});played++}
 function stop(n){for(const cancel of [...n.cancellations.values()])cancel();n.cancellations.clear();n.pending.clear();for(const e of sounds)if(e.node===n){e.audio.pause();sounds.delete(e)}}
 return{
  sync(specs={}){for(const[slot,n]of nodes)if(!specs[slot]||specs[slot].visible===false||signature(specs[slot])!==n.signature){stop(n);nodes.delete(slot)}for(const[slot,spec]of Object.entries(specs))if(spec.visible!==false&&(spec.eventAudio||spec.voiceLoop)){let n=nodes.get(slot);if(!n){n={slot,signature:signature(spec),pending:new Set(),cancellations:new Map(),nextAmbient:performance.now()+100};nodes.set(slot,n)}n.spec=spec}},
  event({slot,name}){const n=nodes.get(slot),mapping=n?.spec.eventAudio?.[name];if(!n||!mapping||!valid(n))return;for(const ref of mapping.missing||[])report(n.spec.skel+name+ref,'动画事件声音未匹配：'+name+' / '+ref);if(mapping.sounds?.length)effect(n,mapping.sounds[Math.floor(Math.random()*mapping.sounds.length)]);request(n,'event:'+name,mapping.voices)},
  tick(){if(paused||destroyed||!canAmbient())return;for(const n of nodes.values())if(n.spec.voiceLoop?.voices?.length&&performance.now()>=n.nextAmbient)request(n,'ambient',n.spec.voiceLoop.voices,true)},
  setPaused(value){paused=!!value;if(paused)for(const n of nodes.values())stop(n)},setVolume(){for(const e of sounds)e.audio.volume=gain('sfx')},
  info:()=>({played,slots:nodes.size,pending:[...nodes.values()].reduce((sum,n)=>sum+n.pending.size,0)}),
  destroy(){destroyed=true;for(const n of nodes.values())stop(n);nodes.clear()}
 }
}
