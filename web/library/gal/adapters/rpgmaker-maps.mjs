// Static map snapshots: native data only, no plugin/game JavaScript execution.
const imagePath = (folder, name) => {
  const value=String(name||'').replace(/\\/g,'/').replace(/^\/+/, '')
  return value&&!value.split('/').includes('..')?`${folder}/${value.replace(/\.png$/i,'')}.png`:''
}
export function mapSnapshot(ctx, mapId, selectedEvent=0, selectedPage=-1, player=null) {
 const options=ctx.options,settings=options.maps||{},root=options.root?options.root+'/':'',rel=`${root}data/Map${String(mapId).padStart(3,'0')}.json`,map=ctx.maps?.get(rel)
 if(!map||settings.enabled===false)return null
 const width=Number(map.width),height=Number(map.height)
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>262144||!Array.isArray(map.data)||map.data.length<width*height*4)throw Error('RPG Maker 地图尺寸或瓦片数据无效')
 const tile=ctx.tilesets?.[map.tilesetId]
 if(!tile?.tilesetNames)throw Error(`RPG Maker 地图${mapId}缺少Tilesets.json映射 ${map.tilesetId}`)
 const variables=options.initialVariables||{},switches=options.initialSwitches||{}
 const active=conditions=>!(conditions?.switch1Valid&&!switches[conditions.switch1Id]||conditions?.switch2Valid&&!switches[conditions.switch2Id]||conditions?.variableValid&&Number(variables[conditions.variableId]||0)<conditions.variableValue||conditions?.selfSwitchValid||conditions?.itemValid||conditions?.actorValid&&!ctx.system.partyMembers?.includes(conditions.actorId))
 const events={}
 for(const event of map.events||[]){
  if(!event)continue
  const pages=(event.pages||[]).map(page=>({conditions:page.conditions||{},src:imagePath('img/characters',page.image?.characterName),characterName:page.image?.characterName||'',characterIndex:page.image?.characterIndex||0,tileId:page.image?.tileId||0,direction:page.image?.direction||2,pattern:page.image?.pattern??1,priority:page.priorityType??1,speed:page.moveSpeed||4,directionFix:!!page.directionFix,stepAnime:!!page.stepAnime,walkAnime:page.walkAnime!==false}))
  const pageIndex=event.id===selectedEvent&&selectedPage>=0?selectedPage:pages.findLastIndex(p=>active(p.conditions))
  events[event.id]={id:event.id,x:event.x,y:event.y,...pages[pageIndex],pages,pageIndex,selectedPage:event.id===selectedEvent?selectedPage:-1,opacity:255,visible:pageIndex>=0}
 }
 const focus=events[selectedEvent]||{x:Math.floor(width/2),y:Math.floor(height/2)},actor=ctx.actors?.[ctx.system?.partyMembers?.[0]||1]
 const start=player||(Number(ctx.system?.startMapId)===mapId?{x:ctx.system.startX,y:ctx.system.startY}:{x:focus.x,y:Math.min(height-1,focus.y+1)})
 events[-1]={id:-1,...start,direction:start.direction||2,src:imagePath('img/characters',actor?.characterName),characterName:actor?.characterName||'',characterIndex:actor?.characterIndex||0,pattern:1,priority:1,speed:4,opacity:255,visible:settings.player!==false,walkAnime:true}
 return {id:mapId,width,height,data:map.data,scrollType:map.scrollType||0,tileSize:Math.max(8,Math.min(128,Number(ctx.system?.tileSize||settings.tileSize)||48)),stage:ctx.stage,tileset:tile.tilesetNames.map(n=>imagePath('img/tilesets',n)),flags:tile.flags||[],events,party:ctx.system?.partyMembers||[1],focus:settings.follow==='player'?-1:selectedEvent||-1,balloonSrc:'img/system/Balloon.png'}
}
