// Scene labels are paired with the script's own equality/jump dispatcher.
// Select the authored chapter through that scalar argument; don't start at an
// arbitrary text opcode or concatenate unrelated code blocks into one scene.
export function ageSceneEntries(program){
 const code=program.instructions,markers=[]
 for(let n=0;n<code.length;n++){
  const i=code[n],m=i.opcode===0x1a7&&/^▼([A-Z]+\d+)\s*(.*)$/.exec(i.args?.[0]?.text||'')
  if(!m)continue
  const start=code[n-1]?.opcode===0x55?code[n-1].offset:i.offset
  let selector=null
  for(let k=1;k<code.length;k++){
   const test=code[k-1],jump=code[k]
   if(jump.opcode!==0xa0||test.opcode!==0x5a||jump.args[1]?.type!==0||jump.args[1].value!==start||jump.args[2]?.type!==0||jump.args[2].value!==0xffffffff)continue
   if(test.args[0]?.type!==jump.args[0]?.type||test.args[0]?.value!==jump.args[0]?.value||test.args[1]?.type!==3||test.args[2]?.type!==0)continue
   selector={variable:test.args[1].value,value:test.args[2].value};break
  }
  if(selector)markers.push({id:m[1],title:m[1]+(m[2].trim()?' · '+m[2].trim():''),offset:start,index:n,selector})
 }
 return markers.filter((m,k)=>{
  // Reserved/metadata-only chapter arms return without displaying a line.
  const limit=markers[k+1]?.index??code.findIndex((i,n)=>n>m.index&&i.opcode===5)
  return code.slice(m.index,limit>=0?limit:code.length).some(i=>i.opcode===0x6e)
 }).map(({index,...entry})=>entry)
}
