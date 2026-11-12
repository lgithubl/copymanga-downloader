import{compileReadGraph}from'../read-graph.mjs'
export function krkrReadingGraph(data,parseSingle,entryLabel='*start'){
 const nodes=[],starts=new Map(),exits=[],stats={messages:0,choices:0,raw:{},notes:['跨场景条件依赖其他路线存档时，提供明确的路线选择；不顺序混播互斥分支。']}
 const merge=(to,from)=>{for(const[k,v]of Object.entries(from||{}))if(typeof v==='number')to[k]=(to[k]||0)+v;else if(v&&typeof v==='object'&&!Array.isArray(v)){if(!to[k]||typeof to[k]!=='object')to[k]={};merge(to[k],v)}}
 for(const scene of data.scenes){starts.set(scene.label,nodes.length);const result=parseSingle(scene);merge(stats,result.stats);for(const[i,s]of result.steps.entries())nodes.push({commands:[...(i===0?[{op:'bgoff'},{op:'standOff'},{op:'live2dOff'},{op:'bgmStop'}]:[]),...s.commands],endStep:true});const exit={commands:[],next:-1},nexts=scene.nexts||[];nodes.push(exit);const branches=[];if(nexts.length>1)for(let i=0;i<nexts.length;i++){branches.push(nodes.length);nodes.push({commands:[],next:-1})}exits.push({scene,exit,branches})}
 const isInternal=n=>!n.storage||n.storage.replace(/\.txt$/i,'')===data.name
 for(const{scene,exit,branches}of exits){const nexts=scene.nexts||[];if(!nexts.length)continue
  if(nexts.length===1){const n=nexts[0];if(isInternal(n))exit.next=starts.get(n.target)??-1;else if(n.storage&&!/^gameloop/i.test(n.storage)){exit.commands.push({op:'goto',script:n.storage.replace(/\.txt$/i,'')+(n.target?'::'+n.target.replace(/^\*/, ''):'')});exit.endStep=true}continue}
  const variable='krkr:route:'+scene.label;stats.choices++;exit.commands.push({op:'choice',var:variable,options:nexts.map((n,i)=>({value:i+1,segments:[{text:n.flag||data.scenes.find(s=>s.label===n.target)?.title||`路线 ${i+1}`}]}))});exit.endStep=true;exit.next=branches[0]
  for(const[i,n]of nexts.entries()){const branch=nodes[branches[i]],next=branches[i+1]??-1;if(isInternal(n)){branch.test={var:variable,op:'==',value:i+1};branch.yes=starts.get(n.target)??-1;branch.no=next}else{branch.commands.push({op:'goto',script:n.storage.replace(/\.txt$/i,'')+(n.target?'::'+n.target.replace(/^\*/, ''):''),when:[{var:variable,op:'==',value:i+1}]});branch.endStep=true;branch.next=next}}
 }
 if(entryLabel!=='*start'&&!starts.has(entryLabel))throw Error('KiriKiri场景标签不存在')
 return compileReadGraph(nodes,{entry:starts.get(entryLabel)??0,maxPasses:4,maxCommands:300000,stats})
}
