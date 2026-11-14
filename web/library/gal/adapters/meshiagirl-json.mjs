// Native Cocos Creator2 JsonAssets, paired with the active bundle manifests.
// No game JS execution, external runtime, extraction or network access.
import{cocosBundleAssets,cocosJsonAsset,cocosUuid}from'../cocos2-assets.mjs'
import{completeJsonSamples}from'../context-complete-json.mjs'
import{createOptionsReader}from'./options-merge.mjs'
import{runMeshi}from'../meshiagirl-vm.mjs'
import{compileReadGraph}from'../read-graph.mjs'
export const ADAPTER_ID='meshiagirl-json'
export const DEFAULT_OPTIONS={root:'',excludeScripts:['test','testall'],protagonist:'主人公',tavern:'まんぷく亭',stage:[1170,640],spineScale:0.8,maxInstructions:200000,maxSteps:20000,maxBranches:64,maxCommands:300000}
const options=createOptionsReader(DEFAULT_OPTIONS),join=(...p)=>p.filter(Boolean).join('/')
export const contextDirs=o=>{const r=options(o).root;return[join(r,'assets'),join(r,'src')]}
export const contextFiles=o=>[join(options(o).root,'index.html')]
export const contextWalkLimit=500000,contextSampleLimit=6000
export const contextTextFilter=o=>{const root=options(o).root;return rel=>{const p=root?rel.slice(root.length+1):rel;return /^assets\/[^/]+\/config\.[a-z0-9]+\.json$/.test(p)||/^assets\/(?:spineChara|spineComicMark|spineAdventureEnemy)\/import\/.*\.json$/.test(p)||/^src\/settings\.[a-z0-9]+\.js$/.test(p)}}
export const sniff=text=>{const h=String(text).slice(0,16384);return h.includes('"cc.JsonAsset"')&&/"tokenData"\s*:/.test(h)}
export async function prepare({options:o,files=[],texts={},toResourcePath,mediaDir,truncated,sampleTruncated}){
 if(truncated||sampleTruncated)throw Error('meshiagirl 资源索引被截断，请提高 limits.walkFiles / sampleFiles')
 const cfg=options(o),root=cfg.root,toRes=toResourcePath||String,set=new Set(files),match=contextTextFilter(o)
 if(mediaDir)texts=await completeJsonSamples({texts,files,mediaDir},rel=>match(rel)&&rel.endsWith('.json'))
 const html=texts[join(root,'index.html')]||'',setting=/\bsettings\.[a-z0-9]+\.js\b/.exec(html)?.[0],settings=setting&&texts[join(root,'src',setting)]
 if(!settings)throw Error('缺少 index.html 指定的 Cocos settings；不猜测过期清单')
 const table=/bundleVers\s*:\s*\{([^}]+)\}/.exec(settings)?.[1];if(!table)throw Error('Cocos bundleVers 缺失')
 const versions=Object.fromEntries([...table.matchAll(/(?:"([^"\n]+)"|(\w+))\s*:\s*"([a-z0-9]+)"/g)].map(m=>[m[1]||m[2],m[3]])),bundles=new Map(),native=new Map(),byUuid=new Map()
 const needed=['adventure','spineChara','spineComicMark','spineAdventureEnemy','spriteBgCommon','audiosVoice','audiosBgm','audiosSe']
 for(const name of needed){const file=join(root,'assets',name,'config.'+versions[name]+'.json');if(!texts[file])throw Error('缺少当前 Cocos bundle 清单: '+file);const config=JSON.parse(texts[file]),entries=cocosBundleAssets(config,join(root,'assets',name));bundles.set(name,entries);for(const e of entries)byUuid.set(e.uuid,e)}
 for(const file of files){const m=/\/native\/[0-9a-f]{2}\/([0-9a-f-]{36})\.([a-z0-9]+)\.(png|jpg|webp|bin|atlas|mp3|ogg|wav)$/.exec(file);if(m)native.set(m[1]+':'+m[2]+':'+m[3],toRes(file))}
 const nativeOf=(e,ext)=>e&&native.get(e.uuid+':'+e.nativeVersion+':'+ext)||''
 // SpriteFrame rect/offset is needed for cropped CG facial layers (not just its PNG).
 const frameFiles=new Set([...bundles.values()].flat().filter(e=>e.type==='cc.SpriteFrame').map(e=>e.import))
 if(mediaDir)texts=await completeJsonSamples({texts,files,mediaDir},rel=>frameFiles.has(rel))
 const assets=new Map(),missing=[]
 for(const[name,entries]of bundles){for(const e of entries){let src='';if(e.type==='cc.Texture2D')src=nativeOf(e,'png')||nativeOf(e,'jpg')||nativeOf(e,'webp');if(e.type==='cc.AudioClip')src=nativeOf(e,'mp3')||nativeOf(e,'ogg')||nativeOf(e,'wav');if(src)assets.set(name+':'+e.name,{src,name:e.name})}
  for(const e of entries.filter(e=>e.type==='cc.SpriteFrame')){let d;try{d=JSON.parse(texts[e.import])}catch{}const f=d?.[5]?.[0];if(d?.[3]?.[0]!=='cc.SpriteFrame'||!Array.isArray(f?.rect)||!Array.isArray(f?.offset))continue;const texture=byUuid.get(cocosUuid(d[1][0])),src=nativeOf(texture,'png');if(src)assets.set(name+':'+e.name,{src,name:e.name,crop:f.rect,offset:f.offset,originalSize:f.originalSize})}
  for(const e of entries.filter(e=>e.type==='sp.SkeletonData')){const skel=nativeOf(e,'bin'),atlas=entries.find(x=>x.name===e.name&&x.type==='cc.Asset'),atlasPath=nativeOf(atlas,'atlas');if(!skel||!atlasPath)continue;let meta;try{meta=JSON.parse(texts[e.import])}catch{}const row=meta?.[5]?.find(x=>Array.isArray(x)&&x[1]===e.name),textureMap={};if(!row||!Array.isArray(row[4])){missing.push('Spine texture metadata: '+e.name);continue}
   // SkeletonData stores textureNames in declared order; dependency UUIDs are in the same order.
   for(let i=0;i<row[4].length;i++){const uuid=cocosUuid(meta[1][i]),texture=byUuid.get(uuid),src=nativeOf(texture,'png');if(src)textureMap[row[4][i]]=src;else missing.push('Spine atlas page: '+e.name+'/'+row[4][i])}
   if(Object.keys(textureMap).length===row[4].length)assets.set(name+':'+e.name,{name:e.name,skel,atlas:atlasPath,textureMap})
  }
 }
 const adventure=bundles.get('adventure'),story=adventure.filter(e=>e.type==='cc.JsonAsset'&&e.name.startsWith('json/')&&!cfg.excludeScripts.includes(e.name.split('/').at(-1))),all=story.filter(e=>set.has(e.import)).map(e=>({id:e.import,script:e.import,title:e.name.split('/').at(-1),viewName:e.name.slice(5)})).sort((a,b)=>a.title.localeCompare(b.title,'ja',{numeric:true}))
 let emotions={};const emotion=adventure.find(e=>e.type==='cc.JsonAsset'&&e.name==='scriptEngine/emotion');if(emotion&&mediaDir){const extra=await completeJsonSamples({texts:{},files:[emotion.import],mediaDir},()=>true);if(extra[emotion.import])emotions=cocosJsonAsset(extra[emotion.import]).json}
 return{cfg,assets,emotions,missing,storyCount:story.length,catalogTree:{children:[{id:'story',title:'全部剧情',children:all}]}}
}
export const catalog=ctx=>ctx?.catalogTree
export function parse(text,ctx={},meta={}){
 const d=cocosJsonAsset(text);if(!Array.isArray(d.json.tokenData)||!Array.isArray(d.json.loadData))throw Error('不是 meshiagirl 剧情 JsonAsset')
 const cfg=ctx.cfg||options(meta.options),nodes=[],stats={messages:0,choices:0,raw:{},unresolved:{},notes:['原生 Cocos 剧情；移动/缩放过渡采用终点；漫画情绪符号（Spine3.8.75）、原版人像窗皮肤、BGM前奏衔接及部分粒子/滤镜未还原；相关指令逐条记录脚本/行号。']};const sharedChoices=new Map();let branches=0
 const compile=(decisions,prefix=0)=>{
  const run=runMeshi(d,ctx,{...cfg,decisions});Object.assign(stats.raw,run.diagnostics)
  const start=nodes.length;for(const e of run.events.slice(prefix)){nodes.push({commands:e.commands,source:e.source,endStep:true,next:nodes.length+1});if(e.commands.some(c=>c.op==='text'))stats.messages++}
  if(run.pending&&sharedChoices.has(run.stateKey)){const target=sharedChoices.get(run.stateKey);if(nodes.length>start)nodes.at(-1).next=target;return nodes.length>start?start:target}
  if(++branches>Math.max(1,Math.min(256,cfg.maxBranches)))throw Error('meshiagirl 选项分支超过上限')
  if(run.pending){const c=run.pending,index=nodes.length;sharedChoices.set(run.stateKey,index);nodes.push({commands:[{op:'choice',var:c.key,options:c.options}],source:c.source,endStep:true,next:index+1});stats.choices++
   const tests=[];for(let i=0;i<c.options.length-1;i++){tests.push(nodes.length);nodes.push({commands:[],test:{var:c.key,op:'==',value:c.options[i].value},source:c.source,yes:-1,no:-1})}
   const targets=c.options.map(x=>compile([...decisions,x.value],run.events.length));for(let i=0;i<tests.length;i++){nodes[tests[i]].yes=targets[i];nodes[tests[i]].no=tests[i+1]??targets.at(-1)}if(!tests.length)nodes[index].next=targets[0]
  }else{if(nodes.length===start)nodes.push({commands:[],source:0,next:-1});nodes.at(-1).next=-1}return start
 }
 compile([])
 // Reconverging choices share their suffix. Sort an acyclic graph before the
 // forward-only reader compiler, so a join is not mistaken for a reading loop.
 const degree=nodes.map(()=>0),edges=nodes.map(n=>[...new Set([n.next,n.yes,n.no].filter(i=>Number.isInteger(i)&&i>=0&&i<nodes.length))]);for(const es of edges)for(const i of es)degree[i]++
 const ready=degree.flatMap((d,i)=>d===0?[i]:[]),order=[];for(let i=0;i<ready.length;i++){const at=ready[i];order.push(at);for(const next of edges[at])if(--degree[next]===0)ready.push(next)}
 let graph=nodes;if(order.length===nodes.length){const index=new Map(order.map((n,i)=>[n,i]));graph=order.map(i=>{const n={...nodes[i]};for(const key of ['next','yes','no'])if(Number.isInteger(n[key])&&n[key]>=0)n[key]=index.get(n[key]);return n})}
 return compileReadGraph(graph,{maxCommands:Math.max(1000,Math.min(1000000,cfg.maxCommands)),stats})
}
export const meshiagirlJsonAdapter={id:ADAPTER_ID,label:'meshiagirl / Cocos Creator',catalogViews:true,sniff,parse,prepare,contextDirs,contextFiles,contextTextFilter,contextWalkLimit,contextSampleLimit,catalog}
