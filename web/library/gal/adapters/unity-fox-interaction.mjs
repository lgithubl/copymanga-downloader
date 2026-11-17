import{parseFoxRoom}from'./unity-fox-room.mjs'
export function foxInteraction(d,ctx){
 const commands=r=>r.steps.flatMap(s=>s.commands),rooms=[d],roles=[],diagnostics=[]
 for(const room of rooms){if(!room.room?.interactions?.length)continue;const character=/^(Ch\d+)_/i.exec(room.name)?.[1]||'其他',initial=commands(parseFoxRoom(room,ctx,{scene:'cover'})),areas=room.room.interactions.map((name,i)=>({id:String(i),title:name,buttonOnly:true,replies:[],commands:commands(parseFoxRoom(room,ctx,{interactionAction:name}))}))
  const meter=room.room.meter?{...room.room.meter,events:Object.fromEntries(['iku','riku'].filter(name=>room.room.functions[name]).map(name=>[name,commands(parseFoxRoom(room,ctx,{interactionAction:name}))]))}:null;
  roles.push({visuals:Object.entries(room.room.graphics||{}).filter(([name])=>!!name).map(([name])=>({id:'fox:'+name,title:name})),id:room.name,title:room.name.replace(/^Ch\d+_/i,''),characterId:character,characterTitle:character,model:{commandModel:room.name,meter,nativeBranches:room.room.branchStates||[],nativeObjects:room.room.objectStates||{},nativeGraphics:Object.fromEntries(Object.entries(room.room.graphics||{}).map(([key,g])=>['fox:'+key,g.chain])),initialCommands:initial},outfits:[],faces:[],hitAreas:[],tools:[{id:'native',title:'原作互动',areas}]})
 }
 const selected=roles.find(r=>r.id===d.name)||roles[0];if(!selected)throw Error('Native room interaction controls missing')
 return{steps:[{index:0,commands:selected.model.initialCommands}],stats:{notes:['按原生房间区分人物、场景及姿势；动作执行原作函数；未知存档条件由用户选择，不伪造存档'],unresolved:{}},interaction:{format:'gal-interaction/1',initialRole:selected.id,roles,destinations:ctx.scenes.filter(s=>s.interactions?.length).map(s=>({id:s.name,title:s.name.replace(/^Ch\d+_/i,''),characterId:/^(Ch\d+)_/i.exec(s.name)?.[1]||'其他',characterTitle:/^(Ch\d+)_/i.exec(s.name)?.[1]||'其他',node:'s:'+s.script.split('/').at(-1)+'::touch'})),diagnostics}}
}
