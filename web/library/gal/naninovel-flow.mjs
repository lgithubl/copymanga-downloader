import {compileReadGraph} from './read-graph.mjs'
import {utageExpression} from './utage-expression.mjs'

// Native Resources playlists keep labels in the managed line registry, separate
// from commands. Replay each authored choice with independent actor/variable state.
export function naninovelFlow(d,ctx,meta,render){
 const nodes=[],stats={messages:0,choices:0,raw:{},unresolved:{}},labels=new Map()
 d.commands.forEach((c,i)=>{if(c.type==='Label')labels.set(c.data.labelText,i+1)})
 let branches=0
 const run=decisions=>{
  let pc=d.entryLabel?labels.get(d.entryLabel):0,choice=0,count=0;const commands=[],vars={}
  if(pc===undefined)throw Error('Naninovel entry label missing: '+d.entryLabel)
  for(const v of ctx.configs.CustomVariablesConfiguration?.PredefinedVariables||[]){try{vars[v.name]=JSON.parse(v.value)}catch{vars[v.name]=v.value}}
  if(d.replay)vars.is_replay=true
  const raw=(c,why)=>commands.push({...c,type:why,data:{...c.data,ConditionalExpression:undefined,InvertedConditionalExpression:undefined}})
  const expr=(text,c)=>utageExpression(text,vars,k=>{throw Error('Naninovel unknown variable '+k+' at '+d.name+':'+(c.source+1))})
  const jump=(target,c)=>{
   const[name,label]=String(target||'').split('#')
   if(name&&name!==d.name){commands.push({...c,type:'NativeGoto',data:{script:label&&label!=='start'?'label--'+name+'--'+label+'.nani':name+'.nani'}});return false}
   if(!labels.has(label)){raw(c,'missing-label:'+target);return false}pc=labels.get(label);return true
  }
  const finish=pending=>({scene:render(JSON.stringify({...d,commands}),ctx,meta),pending})
  while(pc<d.commands.length){
   if(++count>50000)throw Error('Naninovel instruction limit: '+d.name+':'+pc)
   const c=d.commands[pc++],v=c.data||{},type=c.type
   if(type==='Label'||type==='EndIf')continue
   try{
    if(v.ConditionalExpression&&!expr(v.ConditionalExpression,c)||v.InvertedConditionalExpression&&expr(v.InvertedConditionalExpression,c))continue
    if(type==='BeginIf'){
     if(!expr(v.Expression,c)){let depth=0;for(;pc<d.commands.length;pc++){const t=d.commands[pc].type;if(t==='BeginIf')depth++;if(t==='EndIf'){if(!depth){pc++;break}depth--}}}continue
    }
    if(type==='SetCustomVariable'){
     const m=/^([\w]+)\s*=\s*(.+)$/.exec(v.Expression||'');if(!m)throw Error('unsupported assignment');vars[m[1]]=expr(m[2],c);continue
    }
   }catch(e){raw(c,'condition-error:'+e.message);if(type==='BeginIf')throw e;continue}
   if(type==='RequireChoice'||type==='AddChoice'){
    commands.push({type:'NativeBoundary',data:{},source:c.source})
    const options=[c];while(d.commands[pc]?.type===type)options.push(d.commands[pc++])
    if(type==='AddChoice'&&d.commands[pc]?.type==='Stop')pc++
    const key='nani-choice:'+choice,items=options.map((o,i)=>({value:i+1,segments:[{text:(o.data.ChoiceSummary?.parts||[]).map(p=>p.text||d.texts[p.id]||'').join('')||'选项 '+(i+1)}]}))
    if(decisions[choice]===undefined)return finish({key,options:items,source:c.source})
    const selected=options[decisions[choice++]-1];if(!selected)throw Error('Invalid Naninovel choice')
    if(selected.data.GotoPath){if(!jump(selected.data.GotoPath,selected))break}else raw(selected,'unsupported-choice-target')
    continue
   }
   if(type==='Goto'){if(!jump(v.Path,c))break;continue}
   if(['Stop','Return','ExitToTitle'].includes(type)){if(type==='Stop'&&commands.some(c=>c.type==='ShowUI'))raw(c,'native-ui-stop');break}
   commands.push({...c,data:{...v,ConditionalExpression:undefined,InvertedConditionalExpression:undefined}})
  }
  return finish()
 }
 const compile=(decisions,skip=0)=>{
  if(++branches>128)throw Error('Naninovel branch limit: '+d.name)
  const{scene,pending}=run(decisions),start=nodes.length
  for(const step of scene.steps.slice(skip))nodes.push({commands:step.commands,endStep:true,next:nodes.length+1})
  for(const kind of ['raw','unresolved'])Object.assign(stats[kind],scene.stats[kind])
  if(pending){
   const at=nodes.length;nodes.push({commands:[{op:'choice',var:pending.key,options:pending.options}],source:pending.source,endStep:true,next:at+1});stats.choices++
   const tests=[];for(let i=0;i<pending.options.length-1;i++){tests.push(nodes.length);nodes.push({commands:[],test:{var:pending.key,op:'==',value:i+1},yes:-1,no:-1})}
   const targets=pending.options.map(o=>compile([...decisions,o.value],scene.steps.length))
   tests.forEach((n,i)=>{nodes[n].yes=targets[i];nodes[n].no=tests[i+1]??targets.at(-1)})
   if(!tests.length)nodes[at].next=targets[0]
  }else{if(nodes.length===start)nodes.push({commands:[],next:-1});nodes.at(-1).next=-1}
  return start
 }
 compile([]);stats.messages=nodes.reduce((n,s)=>n+s.commands.filter(c=>c.op==='text').length,0)
 stats.voices=nodes.reduce((n,s)=>n+s.commands.filter(c=>c.op==='voice').length,0)
 stats.backgroundVoices=nodes.reduce((n,s)=>n+s.commands.filter(c=>c.op==='bgvoice'&&c.kind==='bgvoice').length,0)
 return compileReadGraph(nodes,{stats,maxCommands:500000})
}
