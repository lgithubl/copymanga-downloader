import { tilePieces } from './gal-rpgmaker-tiles.js'

export function createRpgMakerMapLayer({parent,url,onMissing=()=>{}}){
 const canvas=document.createElement('canvas');canvas.className='gal-rpgmaker-map';parent.append(canvas)
 const context=canvas.getContext('2d'),images=new Map(),tracks=new Map();let map=null,raf=0,destroyed=false,paused=false,ready=Promise.resolve(),live=false,lastFrame=0
 const image=src=>{
  if(!src)return Promise.resolve(null)
  if(images.has(src))return images.get(src).promise
  const record={value:null,promise:null};record.promise=new Promise(resolve=>{const img=new Image();img.onload=()=>{record.value=img;resolve(img);draw(performance.now())};img.onerror=()=>{onMissing(src);resolve(null)};img.src=url(src)});images.set(src,record);return record.promise
 }
 const value=src=>images.get(src)?.value
 function actorAt(actor,now){
  const track=tracks.get(String(actor.id));if(!track||!live)return actor
  const elapsed=(now-track.started)/1000,points=track.value.points
  if(elapsed>=track.value.seconds)return actor
  let i=1;while(i<points.length&&points[i].at<=elapsed)i++
  const a=points[Math.max(0,i-1)],b=points[i]||a,span=b.at-a.at,t=span?Math.max(0,Math.min(1,(elapsed-a.at)/span)):1
  return {...a,direction:b.direction,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,pattern:actor.walkAnime!==false&&(a.x!==b.x||a.y!==b.y)?[0,1,2,1][Math.floor(elapsed*10)%4]:a.pattern}
 }
 function draw(now){
  if(destroyed||!context||!map)return
  const stage=map.stage||[816,624],scale=Math.min(parent.clientWidth/stage[0]||1,parent.clientHeight/stage[1]||1),dpr=Math.min(2,globalThis.devicePixelRatio||1),w=Math.max(1,Math.round(stage[0]*scale*dpr)),h=Math.max(1,Math.round(stage[1]*scale*dpr))
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  context.setTransform(w/stage[0],0,0,h/stage[1],0,0);context.clearRect(0,0,stage[0],stage[1]);context.imageSmoothingEnabled=false
  const tile=map.tileSize,actors=Object.values(map.events).map(a=>({...actorAt(a,now)})),focus=actors.find(a=>String(a.id)===String(map.focus))||actors.find(a=>a.id===-1)||{x:map.width/2,y:map.height/2},loopX=map.scrollType===2||map.scrollType===3,loopY=map.scrollType===1||map.scrollType===3
  const limit=(v,max)=>max<0?max/2:Math.max(0,Math.min(max,v)),left=loopX?(focus.x+.5)*tile-stage[0]/2:limit((focus.x+0.5)*tile-stage[0]/2,map.width*tile-stage[0]),top=loopY?(focus.y+.5)*tile-stage[1]/2:limit((focus.y+0.5)*tile-stage[1]/2,map.height*tile-stage[1]),frame=Math.floor(now/500)%12
  for(const actor of actors){if(loopX)actor.x=focus.x+(((actor.x-focus.x+map.width/2)%map.width+map.width)%map.width)-map.width/2;if(loopY)actor.y=focus.y+(((actor.y-focus.y+map.height/2)%map.height+map.height)%map.height)-map.height/2}
  const at=(x,y,z)=>{if(map.scrollType===2||map.scrollType===3)x=((x%map.width)+map.width)%map.width;if(map.scrollType===1||map.scrollType===3)y=((y%map.height)+map.height)%map.height;return x<0||y<0||x>=map.width||y>=map.height?0:map.data[(z*map.height+y)*map.width+x]||0}
  const pieces=(id,x,y,edge=false)=>{for(const p of tilePieces(id,tile,frame,map.flags[id]||0,edge)){const bitmap=value(map.tileset[p.set]);if(bitmap)context.drawImage(bitmap,p.sx,p.sy,p.w,p.h,x+p.x,y+p.y,p.w,p.h)}}
  const cells=[];for(let y=Math.floor(top/tile)-1;y<=Math.ceil((top+stage[1])/tile);y++)for(let x=Math.floor(left/tile)-1;x<=Math.ceil((left+stage[0])/tile);x++)cells.push([x,y])
  const layer=upper=>{for(const [x,y]of cells)for(let z=0;z<4;z++){
   const id=at(x,y,z),dx=x*tile-left,dy=y*tile-top
   if(!!(map.flags[id]&0x10)===upper)pieces(id,dx,dy)
   if(!upper&&z===1){const shadows=at(x,y,4);context.fillStyle='rgba(0,0,0,.5)';for(let q=0;q<4;q++)if(shadows&(1<<q))context.fillRect(dx+(q%2)*tile/2,dy+Math.floor(q/2)*tile/2,tile/2,tile/2)
    const above=at(x,y-1,1);if((map.flags[above]&0x80)&&!(map.flags[id]&0x80)&&!(at(x,y,0)>=4352))pieces(above,dx,dy,true)
   }
  }}
  const actor=a=>{
   if(a.visible===false||a.opacity===0)return
   context.save();context.globalAlpha=Math.max(0,Math.min(1,(a.opacity??255)/255));context.globalCompositeOperation=a.blend===1?'lighter':a.blend===2?'multiply':'source-over'
   if(a.tileId)pieces(a.tileId,a.x*tile-left,a.y*tile-top)
   else{const bitmap=value(a.src);if(bitmap){const prefix=/^[!$]+/.exec(a.characterName||'')?.[0]||'',big=prefix.includes('$'),pw=bitmap.width/(big?3:12),ph=bitmap.height/(big?4:8),index=big?0:a.characterIndex||0,pattern=a.stepAnime?[0,1,2,1][Math.floor(now/150)%4]:Math.min(2,a.pattern??1),sx=((index%4)*3+pattern)*pw,sy=(Math.floor(index/4)*4+Math.max(0,Math.min(3,(a.direction-2)/2)))*ph;context.drawImage(bitmap,sx,sy,pw,ph,(a.x+.5)*tile-left-pw/2,(a.y+1)*tile-top-ph-(prefix.includes('!')?0:6),pw,ph)}}
   context.restore()
  }
  layer(false);actors.filter(a=>a.priority===0).sort((a,b)=>a.y-b.y).forEach(actor);actors.filter(a=>a.priority!==0&&a.priority!==2).sort((a,b)=>a.y-b.y||a.id-b.id).forEach(actor);layer(true);actors.filter(a=>a.priority===2).forEach(actor)
  canvas.dataset.map=String(map.id);canvas.dataset.events=String(actors.filter(a=>a.visible!==false&&(a.src||a.tileId)).length)
 }
 function tick(now){raf=0;if(destroyed||paused||!map)return;if(now-lastFrame>=32){draw(now);lastFrame=now}raf=requestAnimationFrame(tick)}
 function kick(){if(!raf&&!paused&&!destroyed&&map)raf=requestAnimationFrame(tick)}
 const observer=new ResizeObserver(()=>draw(performance.now()));observer.observe(parent)
 return {
  async set(next,{live:animate=false}={}){
   live=animate;map=next;canvas.hidden=!map;if(!map){context.clearRect(0,0,canvas.width,canvas.height);tracks.clear();return}
   for(const [id,track]of Object.entries(map.tracks||{}))if(tracks.get(id)?.value.serial!==track.serial)tracks.set(id,{value:track,started:performance.now()})
   for(const key of tracks.keys())if(!map.tracks?.[key])tracks.delete(key)
   const sources=[...map.tileset,...Object.values(map.events).map(a=>a.src)];ready=Promise.all([...new Set(sources.filter(Boolean))].map(image));await ready;draw(performance.now());kick()
  },ready:()=>ready,setPaused(value){paused=!!value;if(paused){cancelAnimationFrame(raf);raf=0}else kick()},destroy(){destroyed=true;cancelAnimationFrame(raf);observer.disconnect();images.clear();tracks.clear();canvas.remove()},canvas
 }
}
