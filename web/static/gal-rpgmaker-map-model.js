// Deterministic native event movement. No input, collisions or autonomous events.
const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback
const directionOf=(dx,dy,old)=>Math.abs(dx)>Math.abs(dy)?(dx>0?6:4):dy?(dy>0?2:8):old
export function refreshRpgMapPages(state){
 if(!state.rpgMap)return
 const map=state.rpgMap,events={...map.events};let changed=false
 for(const [key,event]of Object.entries(events)){
  if(!event.pages||event.erased)continue
  const page=event.pages.findLastIndex((p,i)=>{
   const c=p.conditions||{},v=state.vars||{}
   return !(c.switch1Valid&&!v[`rpg:s:${c.switch1Id}`]||c.switch2Valid&&!v[`rpg:s:${c.switch2Id}`]||c.variableValid&&number(v[`rpg:v:${c.variableId}`])<c.variableValue||c.selfSwitchValid&&!v[`rpg:self:${map.id}:${key}:${c.selfSwitchCh}`]||c.itemValid&&event.selectedPage!==i||c.actorValid&&!map.party?.includes(c.actorId)&&event.selectedPage!==i)
  })
  if(page!==event.pageIndex){events[key]={...event,...event.pages[page],pageIndex:page,visible:page>=0};changed=true}
 }
 if(changed)state.rpgMap={...map,events}
}
export function applyRpgMapCommand(state,command){
 if(command.op==='rpgMap'){state.rpgMap=command.map?{...command.map,events:Object.fromEntries(Object.entries(command.map.events).map(([k,e])=>[k,{...e}])),tracks:{}}:null;refreshRpgMapPages(state);return}
 if(!state.rpgMap)return
 const map={...state.rpgMap,events:{...state.rpgMap.events},tracks:{...state.rpgMap.tracks}},key=String(command.id),old=map.events[key]
 state.rpgMap=map
 if(command.op==='rpgFocus'){map.focus=command.id;return}
 if(!old)return
 const actor={...old};map.events[key]=actor
 if(command.op==='rpgEvent'){
  const patch={...command.patch}
  if(patch.xVar!==undefined)patch.x=number(state.vars[`rpg:v:${patch.xVar}`])
  if(patch.yVar!==undefined)patch.y=number(state.vars[`rpg:v:${patch.yVar}`])
  if(command.exchange!==undefined){const other=map.events[command.exchange];if(other){map.events[command.exchange]={...other,x:actor.x,y:actor.y};actor.x=other.x;actor.y=other.y}}
  Object.assign(actor,patch);delete map.tracks[key];return
 }
 if(command.op!=='rpgRoute')return
 let time=0;const points=[{at:0,...actor}],player=map.events[-1]||actor
 for(const item of command.actions||[]){
  const p=item.parameters||[],code=item.code;let dx=0,dy=0,wait=0
  const moves={1:[0,1],2:[-1,0],3:[1,0],4:[0,-1],5:[-1,1],6:[1,1],7:[-1,-1],8:[1,-1]}
  if(moves[code])[dx,dy]=moves[code]
  if(code===10||code===11){const x=player.x-actor.x,y=player.y-actor.y,sign=code===10?1:-1;if(Math.abs(x)>Math.abs(y))dx=Math.sign(x)*sign;else dy=Math.sign(y)*sign}
  if(code===12||code===13){const sign=code===12?1:-1;[dx,dy]=({2:[0,sign],4:[-sign,0],6:[sign,0],8:[0,-sign]})[actor.direction]||[0,0]}
  if(code===14){dx=number(p[0]);dy=number(p[1])}
  if(dx||dy){if(!actor.directionFix&&code!==13)actor.direction=directionOf(dx,dy,actor.direction);actor.x+=dx;actor.y+=dy;wait=Math.max(Math.abs(dx),Math.abs(dy))*256/(2**(actor.speed||4)*60)}
  if(code===15)wait=Math.max(0,number(p[0])/60)
  if(code>=16&&code<=19&&!actor.directionFix)actor.direction=({16:2,17:4,18:6,19:8})[code]
  if(code===20&&!actor.directionFix)actor.direction=({2:4,4:8,8:6,6:2})[actor.direction]||2
  if(code===21&&!actor.directionFix)actor.direction=({2:6,6:8,8:4,4:2})[actor.direction]||2
  if(code===22&&!actor.directionFix)actor.direction=10-actor.direction
  if((code===25||code===26)&&!actor.directionFix){actor.direction=directionOf(player.x-actor.x,player.y-actor.y,actor.direction);if(code===26)actor.direction=10-actor.direction}
  if(code===27||code===28)state.vars[`rpg:s:${number(p[0])}`]=code===27?1:0
  if(code===29)actor.speed=Math.max(1,Math.min(6,number(p[0],4)))
  if(code===31||code===32)actor.walkAnime=code===31
  if(code===33||code===34)actor.stepAnime=code===33
  if(code===35||code===36)actor.directionFix=code===35
  if(code===39||code===40)actor.visible=code===40
  if(code===41){actor.src=item.src||'';actor.characterName=String(p[0]||'');actor.characterIndex=number(p[1]);actor.tileId=0}
  if(code===42)actor.opacity=Math.max(0,Math.min(255,number(p[0],255)))
  if(code===43)actor.blend=number(p[0])
  time+=wait;points.push({at:time,...actor})
 }
 map.lastDuration=time;map.tracks[key]={serial:command.serial,points,seconds:time}
 refreshRpgMapPages(state)
}
