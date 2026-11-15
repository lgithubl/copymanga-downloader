// Drill/Hshan's declarative picture animation gallery. Never execute plugin JS.
const json = (v, fallback = {}) => { try { return typeof v === 'string' ? JSON.parse(v) : v ?? fallback } catch { return fallback } }
const array = v => { const a=json(v,[]); return Array.isArray(a)?a:[] }
const rootPath = (_ctx,p) => p
const safeName = s => typeof s==='string' && !s.includes('\\') && !s.startsWith('/') && !s.split('/').includes('..')
const numbered = (data,prefix) => Object.entries(data).filter(([k,v])=>k.startsWith(prefix)&&v).sort(([a],[b])=>Number(a.slice(prefix.length))-Number(b.slice(prefix.length))).map(([k,v])=>({id:Number(k.slice(prefix.length)),...json(v)}))
export function galleryCalls(list,onUnsupported=()=>{}) {
  const calls=[]
  for(let i=0;i<(list||[]).length;i++){
    if(list[i].code!==355)continue
    let text=String(list[i].parameters?.[0]||'')
    while(list[i+1]?.code===655)text+='\n'+String(list[++i].parameters?.[0]||'')
    for(const m of text.matchAll(/Hshan\.GifGallery\.ShowGifGallery\(([^;]*?)\)\s*;?/g)){
      // Native call uses JSON literal strings/numbers/arrays. Reject expressions.
      const a=json('['+m[1]+']',null)
      if(!Array.isArray(a)||a.length<4||!a.slice(0,3).every(Number.isInteger)||typeof a[3]!=='string'||a[4]!=null&&(!Array.isArray(a[4])||!a[4].every(Number.isInteger))){onUnsupported();continue}
      calls.push({background:a[0],picture:a[1],sequence:a[2],node:a[3],blocked:a[4]||[]})
    }
  }
  return calls
}
export function prepareActionSequences(ctx) {
  ctx.actionGalleries=new Map()
  if(!ctx.options.plugins.structured||!ctx.plugins.some(p=>p.name==='Hshan_MapGifGallery'))return
  const core=ctx.plugins.find(p=>p.name==='Drill_CoreOfActionSequence')?.parameters
  if(!core)return
  const overrides=ctx.plugins.find(p=>p.name==='Hshan_CoreOfActionSequenceParameterOverrider')?.parameters||{}
  const loopTypes=new Map(array(overrides['节点循环方式']).map(x=>{const d=json(x);return[Number(d['动画序列ID']),array(d['例外的状态节点ID']).map(Number)]}))
  const triggers=new Map(array(overrides['触发器']).map(x=>{const d=json(x);return[Number(d['动画序列ID']),new Map(array(d['状态元和触发器']).map(x=>{const t=json(x);return[Number(t['状态元ID']),t]}))]}))
  const sequences=new Map(numbered(core,'动画序列-').map(d=>[d.id,d]))
  const seen=new Set()
  const entries=[]
  for(const [rel,map]of ctx.maps)for(const event of map.events.filter(Boolean))for(const [pageIndex,page]of(event.pages||[]).entries())for(const call of galleryCalls(page.list,()=>ctx.warnings.push(`动态图画廊调用不是受支持的字面量: ${rel} event ${event.id} page ${pageIndex+1}`))){
    const d=sequences.get(call.sequence);if(!d){ctx.warnings.push('动态图画廊缺少动画序列 '+call.sequence);continue}
    const key=JSON.stringify([call.sequence,call.node,[...call.blocked].sort((a,b)=>a-b)])
    if(seen.has(key))continue;seen.add(key)
    const states=new Map(numbered(d,'状态元-').filter(s=>s['状态元名称']).map(s=>[s['状态元名称'],{...s,...triggers.get(call.sequence)?.get(s.id)}]))
    const nodes=numbered(d,'状态节点-').filter(n=>n['节点名称']&&n['节点名称']!=='默认的状态元集合'&&!call.blocked.includes(n.id))
    const first=nodes.findIndex(n=>n['节点名称']===call.node)
    if(first<0){ctx.warnings.push('动态图画廊找不到起始节点 '+call.sequence+':'+call.node);continue}
    const ordered=[nodes[first],...nodes.filter((_,i)=>i!==first)],variants=[]
    for(const n of ordered){
      const frames=[],raw=[];let loopStart=0
      const names=array(n['顺序播放状态元'])
      if(n['播放方式']!=='顺序播放状态元'||array(n['顺序播放嵌套集合']).length){ctx.warnings.push(`动画序列 ${call.sequence} 节点 ${n['节点名称']} 尚不支持播放方式/嵌套集合`);raw.push('unsupported-action-sequence-node');continue}
      for(const [i,name]of names.entries()){
        const state=states.get(name);if(!state){raw.push('missing-state:'+name);continue}
        if(i===names.length-1)loopStart=frames.length
        const files=array(state['资源-状态元']),intervals=array(state['帧间隔-明细表'])
        const indexes=files.map((_,j)=>j);if(state['是否倒放']==='true')indexes.reverse()
        for(const [fi,j]of indexes.entries()){
          if(!safeName(files[j])){raw.push('invalid-frame-path');continue}
          const event={},triggerIndex=array(state['触发帧']).map(Number).indexOf(fi)
          if(triggerIndex>=0){
            const sounds=array(state['触发音效列表']).filter(safeName).map(s=>'audio/se/'+s+'.ogg')
            if(sounds.length){event.sounds=sounds;event.pitch=[Number(state['触发音效最低音高']||100)/100,Number(state['触发音效最高音高']||100)/100]}
            const scriptValue=array(state['触发脚本'])[triggerIndex],script=json(scriptValue,scriptValue||'')
            if(script){const flash=/^\s*\$gameScreen\.startFlash\(\s*(\[[0-9, ]+\])\s*,\s*(\d+)\s*\);?\s*$/.exec(script);if(flash){const c=json(flash[1],[]);if(c.length===4)event.flash={op:'wash',peak:Math.max(0,Math.min(255,c[3]))/255,color:'#'+c.slice(0,3).map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join(''),seconds:Number(flash[2])/60}}else {
              const se=/^\s*Hshan\.playSE\(([^()]*)\);?\s*$/.exec(script),args=se?json('['+se[1]+']',null):null
              if(Array.isArray(args)&&safeName(args[0])&&args.length<=6&&args.slice(1).every(Number.isFinite)&&(!args[5]))event.extraSounds=[{sounds:['audio/se/'+args[0]+'.ogg'],volume:[Number(args[1]??90)/100,Number(args[2]??90)/100],pitch:[Number(args[3]??100)/100,Number(args[4]??100)/100]}]
              else raw.push('action-sequence-script:'+name)
            }}
          }
          frames.push({src:rootPath(ctx,'img/Special__actionSeq/'+files[j]+'.png'),pixelated:state['图像-模糊边缘']!=='true',seconds:(Math.max(1,Number(intervals[j]??state['帧间隔'])||4)+1)/60,...(Object.keys(event).length?{event}:{})})
        }
      }
      const lastOnly=loopTypes.has(call.sequence)?!loopTypes.get(call.sequence).includes(n.id):n['顺序播放循环方式']==='仅最后状态循环'
      if(!frames.length||frames.length>10000){ctx.warnings.push(`动画序列 ${call.sequence} 节点 ${n['节点名称']} 帧数无效/超过10000`);continue}
      variants.push({name:n['节点名称'],animation:{key:`rpg-action-${call.sequence}-${n.id}`,frames,loopStart:lastOnly?loopStart:0},raw:[...new Set(raw)]})
    }
    if(!variants.length)continue
    const picture=[...(page.list||[])].reverse().find(c=>c.code===231&&c.parameters?.[0]===call.picture)?.parameters
    // Gallery changes the bitmap of an existing picture; preserve its native transform.
    const transform=picture&&picture[3]===0?{x:Number(picture[4])-ctx.stage[0]/2,y:Number(picture[5])-ctx.stage[1]/2,anchor:picture[2]===1?[.5,.5]:[0,0],scaleX:Number(picture[6])/100,scaleY:Number(picture[7])/100,alpha:Number(picture[8])/255}:{x:0,y:0,anchor:[.5,.5]}
    const scene=`event-${event.id}-${pageIndex+1}-action-${call.sequence}-${entries.length}`,script=rel+'::'+scene,title=String(d['标签']||`动画序列 ${call.sequence}`),backgroundName=ctx.plugins.find(p=>p.name==='Hshan_MapGifGallery')?.parameters?.['画廊背景图片']||'GifGalleryBackground'
    const entry={title,script,call,variants,transform,background:call.background>0&&safeName(backgroundName)?rootPath(ctx,'img/pictures/'+backgroundName+'.png'):''}
    ctx.actionGalleries.set(script,entry);entries.push({id:'action-'+entries.length,title,script,thumb:[ctx.options.root,variants[0].animation.frames[0].src].filter(Boolean).join('/'),subtitle:`像素动画 · ${variants.length} 个动作 · ${ctx.mapInfo[Number(/Map(\d+)/.exec(rel)?.[1])]?.name||rel}`})
  }
  if(entries.length){let special=ctx.catalogTree.children.find(n=>n.id==='special');if(ctx.options.special.enabled&&!special){special={id:'special',title:ctx.options.special.label,children:[]};ctx.catalogTree.children.unshift(special)}if(special)special.children.push({id:'action-gallery',title:'动态场景（像素动画）',children:entries})}
}
export function parseActionGallery(entry,ctx,meta) {
  const steps=entry.variants.map((v,i)=>({index:i,commands:[{op:'overlayOff',prefix:'rpg-action:'},...(entry.background?[{op:'overlay',slot:'rpg-action:bg',src:entry.background,stage:ctx.stage,fit:'none',anchor:[0,0],x:-ctx.stage[0]/2,y:-ctx.stage[1]/2,z:entry.call.background}]:[]),{op:'label',name:'rpg-action:'+v.name},{op:'overlay',slot:'rpg-action:picture',stage:ctx.stage,fit:'none',cg:true,z:entry.call.picture,...entry.transform,src:v.animation.frames[0].src,animation:v.animation},{op:'speaker',segments:[]},{op:'text',segments:[{text:entry.title+' · '+v.name}]},...v.raw.map(cmd=>({op:'raw',cmd,args:[meta.rel,meta.scene,i,entry.call]}))]}))
  return{steps,stats:{text:steps.length,commands:steps.reduce((n,s)=>n+s.commands.length,0),raw:Object.fromEntries([...new Set(entry.variants.flatMap(v=>v.raw))].map(k=>[k,entry.variants.filter(v=>v.raw.includes(k)).length])),warnings:ctx.warnings}}
}
