import{createOptionsReader,safeRegex}from'./options-merge.mjs'
import{completeJsonSamples}from'../context-complete-json.mjs'
import{createIndexResolver}from'../resolve.mjs'
import{runSilky}from'../silky-vm.mjs'
import{compileReadGraph}from'../read-graph.mjs'
export const ADAPTER_ID='silky::mes'
export const DEFAULT_OPTIONS={resDir:'arc/res',scriptDir:'arc/script',library:'LIBLARY',entryFrom:{},maxInstructions:2000000,maxSteps:20000,maxBranches:8,maxPasses:8,maxCommands:200000,cgMatch:'(?:^|/)EV[0-9]'}
const options=createOptionsReader(DEFAULT_OPTIONS)
export const sniff=t=>/^\s*\{\s*"format"\s*:\s*"silky-mes\/1"/.test(String(t))
const data=t=>{try{const d=JSON.parse(t);return d.format==='silky-mes/1'&&Array.isArray(d.ops)?d:null}catch{return null}}
export const contextDirs=o=>[options(o).resDir,options(o).scriptDir]
export const contextTextFilter=o=>{const cfg=options(o),names=new Set([cfg.library,...Object.values(cfg.entryFrom||{}).map(x=>x.script)].map(x=>String(x).toUpperCase()+'.SMES'));return rel=>names.has(rel.split('/').at(-1)?.toUpperCase())}
export const contextWalkLimit=800000,contextSampleLimit=10000
export async function prepare({options:o,files=[],texts={},toResourcePath,resourceResolve,mediaDir}){
 const cfg=options(o);if(mediaDir)texts=await completeJsonSamples({texts,files,mediaDir},contextTextFilter(o))
 const scripts=Object.entries(texts).map(([rel,t])=>({rel,data:data(t)})).filter(x=>x.data),library=scripts.find(x=>x.data.name.toUpperCase()===cfg.library.toUpperCase())?.data
 const resolver=createIndexResolver({index:new Set(files.map(x=>toResourcePath?toResourcePath(x):x)),cfg:{...resourceResolve,caseInsensitive:true}}),all=[]
 for(const rel of files.filter(x=>/\.smes$/i.test(x))){const name=rel.split('/').at(-1).replace(/\.smes$/i,'');if(!/^FK[0-9_]/i.test(name))continue;const node={id:rel,script:rel,title:name};all.push(node)}
 const entries={};if(library)for(const[name,entry]of Object.entries(cfg.entryFrom||{})){const source=scripts.find(x=>x.data.name.toUpperCase()===String(entry.script).toUpperCase())?.data;if(!source)throw Error('Silky entry source missing: '+entry.script);const previous=runSilky(source,library,{decisions:entry.decisions||[],resolve:(name)=>resolver.resolve(name.replace(/\.akb$/i,'.png'))||name.replace(/\.akb$/i,'.png'),maxInstructions:cfg.maxInstructions,maxSteps:cfg.maxSteps});if(previous.pending||previous.next.toUpperCase()!==name.toUpperCase())throw Error('Silky entry source does not reach '+name);entries[name.toUpperCase()]=previous.context}
 const sort=a=>a.sort((x,y)=>x.title.localeCompare(y.title,'ja',{numeric:true}));sort(all)
 return{cfg,library,entries,resolver,hasIndex:files.length>0,catalogTree:{children:[{id:'story',title:'剧情',children:all}]}}
}
export const catalog=ctx=>ctx?.catalogTree
export function parse(text,ctx={},meta={}){
 const d=data(text);if(!d)throw Error('不是 Silky MES 剧情');if(!ctx.library)throw Error('缺少 Silky LIBLARY.LIB，请执行 gal-layout 并检查 script.arc')
 const cfg=ctx.cfg||options(meta.options),nodes=[],stats={messages:0,choices:0,raw:{},unresolved:{},notes:['Silky MES 只读解释；随机数固定为0，输入/计时查询取阅读模式值；原生过渡、遮罩与动画暂不模拟。']};const leaves=[];let branches=0
 const resolve=(name,kind)=>{const target=name.replace(/\.akb$/i,'.png');return ctx.resolver?.resolve(target)||(!ctx.hasIndex?target:'')}
 const cg=safeRegex(cfg.cgMatch)
 const compile=(decisions,prefix=0)=>{
  if(++branches>cfg.maxBranches)throw Error('Silky choice branch limit')
  const run=runSilky(d,ctx.library,{decisions,maxInstructions:cfg.maxInstructions,maxSteps:cfg.maxSteps,resolve,initialContext:ctx.entries?.[d.name.toUpperCase()],isCg:name=>Boolean(cg?.test(name))});Object.assign(stats.raw,run.diagnostics)
  const start=nodes.length
  for(const e of run.events.slice(prefix)){nodes.push({commands:e.commands,source:e.source,endStep:e.commands.some(c=>c.op==='text'),next:nodes.length+1});for(const c of e.commands)if(c.op==='text')stats.messages++}
  if(run.pending){const c=run.pending,choiceNode=nodes.length;stats.choices++;nodes.push({commands:[{op:'choice',var:c.key,options:c.options}],source:c.source,endStep:true,next:choiceNode+1})
   let test=nodes.length;nodes.push({test:{var:c.key,op:'==',value:c.options[0].value},yes:-1,no:-1,commands:[],source:c.source})
   const children=c.options.map(option=>compile([...decisions,option.value],run.events.length))
   if(c.options.length!==2)throw Error('Silky reader currently requires binary native choices')
   nodes[test].yes=children[0];nodes[test].no=children[1]
  }else{if(nodes.length===start)nodes.push({commands:[],source:0,next:-1});nodes.at(-1).next=-1;leaves.push({node:nodes.length-1,script:run.next})}
  return nodes.length===start?-1:start
 }
 compile([]);const next=leaves.length&&leaves[0].script&&leaves.every(x=>x.script===leaves[0].script)?leaves[0].script:'';if(!next)for(const leaf of leaves)if(leaf.script)nodes[leaf.node].commands.push({op:'goto',script:leaf.script});const result=compileReadGraph(nodes,{maxPasses:cfg.maxPasses,maxCommands:cfg.maxCommands,stats});if(next)result.next={script:next};return result
}
export const silkyMesAdapter={id:ADAPTER_ID,label:'Silky / Azurite MES',catalogViews:true,sniff,parse,prepare,contextDirs,contextTextFilter,contextWalkLimit,contextSampleLimit,catalog}
