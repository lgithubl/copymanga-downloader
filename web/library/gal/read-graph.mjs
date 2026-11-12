// Compile a bounded reading CFG to guarded commands. No source-language runtime.
export function compileReadGraph(nodes,{entry=0,initial={},maxPasses=4,maxCommands=150000,stats={}}={}){
 const steps=[],pc='read:pc',pending=[],initialCommands=Object.entries(initial).map(([key,value])=>({op:'set',var:key,value}));let emitted=0
 const flush=()=>{if(pending.length){emitted+=pending.length;if(emitted>maxCommands)throw Error('剧情导出指令超过上限');steps.push({index:steps.length,flow:true,commands:pending.splice(0)})}}
 pending.push(...initialCommands,{op:'set',var:pc,value:entry})
 const backward=nodes.some((n,i)=>[n.next,n.yes,n.no].some(x=>Number.isInteger(x)&&x>=0&&x<=i)),passes=backward?Math.max(1,Math.min(8,maxPasses)):1
 for(let pass=0;pass<passes;pass++)for(let i=0;i<nodes.length;i++){
  const n=nodes[i],guard={var:pc,op:'==',value:i}
  for(const c of n.commands||[]){const command={...c,when:[guard,...(c.when||[])]};if(c.op==='choice'){pending.push({op:'set',var:c.var,value:'__unselected__',when:[guard]});command.id=`${steps.length}:${pending.length}`}pending.push(command)}
  if(n.test){pending.push({op:'set',var:pc,value:n.yes??-1,when:[guard,n.test]},{op:'set',var:pc,value:n.no??-1,when:[guard,{...n.test,not:!n.test.not}]})}
  else {const choice=(n.commands||[]).find(c=>c.op==='choice');pending.push({op:'set',var:pc,value:n.next??(i+1<nodes.length?i+1:-1),when:[guard,...(choice?[{var:choice.var,op:'!=',value:'__unselected__'}]:[])]})}
  if(n.endStep)flush()
 }
 flush();if(backward){stats.loopPasses=passes;steps.push({index:steps.length,flow:true,commands:[{op:'raw',cmd:'reading-loop-limit',args:String(passes),when:[{var:pc,op:'!=',value:-1}]}]})}
 if(!steps.length)steps.push({index:0,commands:[]});stats.commands=emitted
 return{steps,stats}
}
