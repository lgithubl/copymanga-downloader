// inazuma/Memory's authored replay entries. Read literal event data only; never
// execute the game's JavaScript or enumerate arbitrary gameplay as a scene.
export function memoryEntries(list) {
  const entries=[];let label=''
  for(let i=0;i<(list||[]).length;i++){
    const c=list[i]
    if(c.code===402)label=String(c.parameters?.[1]||'')
    if(c.code!==355||!/^\s*Iz\.Life\.MemoryUtil\.start\(\)\s*;?\s*$/.test(c.parameters?.[0]||''))continue
    const end=list.findIndex((x,n)=>n>i&&x.code===201&&x.indent===c.indent&&x.parameters?.[0]===0)
    if(end<0)continue
    const commands=list.slice(i,end+1).map(x=>({...x,indent:x.indent-c.indent})),switches=new Set(),variables=new Set(),selves=[]
    for(const x of commands){const p=x.parameters||[]
      if(x.code===121&&p[2]===0)for(let n=p[0];n<=Math.min(p[1],p[0]+10000);n++)switches.add(n)
      if(x.code===122)for(let n=p[0];n<=Math.min(p[1],p[0]+10000);n++)variables.add(n)
      if(x.code===357&&String(p[0]).split('/').at(-1)==='SelfSwitchesEx'&&p[1]==='set')selves.push(p[3])
    }
    entries.push({index:i,label,commands,switches:[...switches],variables:[...variables],selves,mapId:Number(list[end].parameters[1])})
    i=end
  }
  return entries
}
export function memoryTargets(ctx,entry,mapId=entry.mapId,continuation=false){
 const map=ctx.maps.get(`${ctx.options.root?ctx.options.root+'/':''}data/Map${String(mapId).padStart(3,'0')}.json`)
 const switches={1004:1,1054:1,...ctx.options.initialSwitches},variables={...ctx.options.initialVariables},selves={},party=new Set(ctx.options.party?.members||ctx.system?.partyMembers||[])
 for(const c of entry.commands){const p=c.parameters||[]
   if(c.code===121)for(let i=p[0];i<=Math.min(p[1],p[0]+10000);i++)switches[i]=p[2]===0?1:0
   if(c.code===122&&p[2]===0&&p[3]===0)for(let i=p[0];i<=Math.min(p[1],p[0]+10000);i++)variables[i]=p[4]
   if(c.code===129){if(p[1]===0)party.add(Number(p[0]));else party.delete(Number(p[0]))}
 }
 for(const x of entry.selves)selves[`${x.mapId}:${x.eventId}:${x.name}`]=x.value===true||x.value==='true'
 const matches=(p,e)=>{const c=p.conditions||{};return(!c.switch1Valid||switches[c.switch1Id])&&(!c.switch2Valid||switches[c.switch2Id])&&(!c.variableValid||(variables[c.variableId]||0)>=c.variableValue)&&(!c.actorValid||party.has(c.actorId))&&(!c.selfSwitchValid||selves[`${mapId}:${e.id}:${c.selfSwitchCh}`])&&!c.itemValid}
 return(map?.events||[]).filter(Boolean).filter(e=>{
   const related=e.pages?.some(p=>{const c=p.conditions||{},ids=[c.switch1Valid&&c.switch1Id,c.switch2Valid&&c.switch2Id].filter(Boolean)
     return p.trigger===3&&(ids.some(id=>entry.switches.includes(id))||continuation&&!ids.length)&&(c.variableValid&&entry.variables.includes(c.variableId)||continuation&&ids.some(id=>entry.switches.includes(id))&&(!c.variableValid||c.variableValue===0)||entry.selves.some(x=>Number(x.mapId)===mapId&&Number(x.eventId)===e.id))})
   if(!related)return false
   if(continuation)return true
   return [...e.pages].reverse().find(p=>matches(p,e))?.trigger===3
 })
}
