import { FLOOR, WALL, WATERFALL } from './gal-rpgmaker-autotiles.js'
// Source/destination rectangles for native MV/MZ tile sheets.
export function tilePieces(id,size=48,frame=0,flags=0,edge=false){
 if(!id||id<0||id>=8192)return []
 if(id<2048){if(edge)return [];return[{set:id>=1536?4:5+Math.floor(id/256),sx:(Math.floor(id/128)%2*8+id%8)*size,sy:(Math.floor(id%256/8)%16)*size,w:size,h:size,x:0,y:0}]}
 const kind=Math.floor((id-2048)/48),shape=(id-2048)%48,tx=kind%8,ty=Math.floor(kind/8),half=size/2
 let table=FLOOR,bx=0,by=0,set=0,isTable=false
 if(id<2816){const water=[0,1,2,1][frame%4];if(kind===0){bx=water*2;by=0}else if(kind===1){bx=water*2;by=3}else if(kind===2){bx=6;by=0}else if(kind===3){bx=6;by=3}else{bx=Math.floor(tx/4)*8;by=ty*6+Math.floor(tx/2)%2*3;if(kind%2===0)bx+=water*2;else{bx+=6;by+=frame%3;table=WATERFALL}}}
 else if(id<4352){set=1;bx=tx*2;by=(ty-2)*3;isTable=!!(flags&0x80)}
 else if(id<5888){set=2;bx=tx*2;by=(ty-6)*2;table=WALL}
 else{set=3;bx=tx*2;by=Math.floor((ty-10)*2.5+(ty%2?0.5:0));if(ty%2)table=WALL}
 const quads=table[shape];if(!quads)return []
 if(edge){if(id<2816||id>=4352)return [];return quads.slice(2).map(([x,y],i)=>({set,sx:(bx*2+x)*half,sy:(by*2+y)*half+half/2,w:half,h:half/2,x:i*half,y:0}))}
 return quads.flatMap(([qx,qy],i)=>{
  const piece={set,sx:(bx*2+qx)*half,sy:(by*2+qy)*half,w:half,h:half,x:(i%2)*half,y:Math.floor(i/2)*half}
  if(!isTable||![1,5].includes(qy))return[piece]
  return[{...piece,sx:(bx*2+(qy===1?[0,3,2,1][qx]:qx))*half,sy:(by*2+3)*half},{...piece,y:piece.y+half/2,h:half/2}]
 })
}
