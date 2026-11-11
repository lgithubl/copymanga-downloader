// RPG plugin text windows: safe canvas drawing, never HTML/game JS evaluation.
import { segmentsText } from './gal-engine.js'
export function createRpgUiLayer(parent){
 const canvas=document.createElement('canvas');canvas.className='gal-rpg-ui';parent.append(canvas);const context=canvas.getContext('2d');let state={},stage=[816,624]
 function draw(){
  const ratio=Math.min(2,globalThis.devicePixelRatio||1);canvas.width=Math.max(1,Math.round(parent.clientWidth*ratio));canvas.height=Math.max(1,Math.round(parent.clientHeight*ratio))
  context.setTransform(canvas.width/stage[0],0,0,canvas.height/stage[1],0,0);context.clearRect(0,0,...stage)
  for(const spec of Object.values(state.rpgUi||{})){
   if(spec.visible===false)continue
   const x=Number(spec.x)||0,y=Number(spec.y)||0,w=Math.max(1,Math.min(stage[0],Number(spec.width)||stage[0])),h=Math.max(1,Math.min(stage[1],Number(spec.height)||120)),size=Math.max(8,Math.min(96,Number(spec.fontSize)||20))
   context.save();context.beginPath();context.rect(x,y,w,h);context.clip();context.font=`${size}px sans-serif`;context.textBaseline='top';context.fillStyle=/^#[0-9a-f]{3,8}$/i.test(spec.color||'')?spec.color:'#fff';context.strokeStyle='rgba(0,0,0,.8)';context.lineWidth=3
   if(Number(spec.opacity)>0){context.save();context.fillStyle=`rgba(0,0,0,${Math.min(.8,Number(spec.opacity)/255)})`;context.fillRect(x,y,w,h);context.restore()}
   const text=segmentsText((spec.segments||[]).map(s=>s.var?{...s,text:String(state.vars?.[s.var]??0)}:s)),lines=[];let line=''
   for(const char of text){if(char==='\n'){lines.push(line);line='';continue}if(line&&context.measureText(line+char).width>w-8){lines.push(line);line=''}line+=char}lines.push(line)
   lines.slice(0,Math.ceil(h/(size+4))).forEach((line,i)=>{context.strokeText(line,x+4,y+i*(size+4));context.fillText(line,x+4,y+i*(size+4))});context.restore()
  }
 }
 const observer=new ResizeObserver(draw);observer.observe(parent)
 return {set(next,size){state=next;stage=size||stage;draw()},destroy(){observer.disconnect();canvas.remove()}}
}
