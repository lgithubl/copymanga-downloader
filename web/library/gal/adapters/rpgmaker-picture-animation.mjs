// Native PictureAnimation numbered cells -> explicit, guarded image changes.
// The original plugin's SET_CELL0 increments; positive cell numbers are1-based.
export function pictureAnimation({emit,raw,initial,guard}){
 let pending=null,serial=0;const records=new Map(),current=id=>`rpg:pa:${id}:current`
 const redraw=(r)=>{for(let i=0;i<r.count;i++){const width=String(r.count).length,src=r.src.slice(0,-4-width)+String(i).padStart(width,'0')+'.png';emit({op:'overlay',slot:`rpg-picture-${r.id}`,src,merge:true,when:[{var:r.cell,op:'===',value:i}]})}}
 return{
  show(id,src){if(!initial.has(current(id)))initial.set(current(id),0);emit({op:'set',var:current(id),value:0});if(!pending)return;const meta=pending;pending=null;if(meta.direction!=='number'){raw('picture-animation-direction-unhandled',meta);return}const r={id,src,count:meta.count,token:++serial,cell:`rpg:pa:cell:${serial}`};initial.set(r.cell,0);emit({op:'set',var:r.cell,value:0});emit({op:'set',var:current(id),value:r.token});if(!records.has(id))records.set(id,[]);records.get(id).push(r)},
  erase(id){emit({op:'set',var:current(id),value:0})},
  command(action,args){
   if(action==='INIT'){const count=Number(args.cellNumber);if(!Number.isInteger(count)||count<1||count>256){raw('picture-animation-count-unhandled',args);pending=null;return true}pending={count,direction:args.direction};return true}
   if(action!=='SET_CELL')return false
   const id=Number(args.pictureNumber),cell=Number(args.cellNumber),list=records.get(id)||[]
   if(!Number.isInteger(cell)||cell<0||cell>256){raw('picture-animation-cell-unhandled',args);return true}
   if(!list.length){raw('picture-animation-without-source',id);return true}
   for(const r of list)guard([{var:current(id),op:'===',value:r.token}],()=>{emit(cell>0?{op:'set',var:r.cell,value:cell-1}:{op:'set',var:r.cell,calc:'add',value:1});emit({op:'set',var:r.cell,calc:'mod',value:r.count});redraw(r)})
   return true
  }
 }
}
