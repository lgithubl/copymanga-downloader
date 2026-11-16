const segments=text=>[{text:String(text||'')}]
export function parseFoxRoom(d,ctx,meta={}){
 const thumbnail=meta.scene==='cover',room=d.room,steps=[],stats={messages:0,voices:0,raw:{},unresolved:{},notes:ctx.notes},guards=[],stateNames=new Set(),UNKNOWN='__fox_unknown__';let pending=[],serial=0,emitted=0,bootstrap=thumbnail;const deferredDialogue=[]
 const emit=c=>{if(++emitted>ctx.options.maxCommands)throw Error('Fox room command limit exceeded');pending.push(guards.length?{...c,when:[...guards,...c.when||[]]}:c)},flush=()=>{if(pending.length){steps.push({index:steps.length,flow:true,commands:pending});pending=[]}},raw=(reason,source,args)=>{stats.raw[reason]=(stats.raw[reason]||0)+1;emit({op:'raw',cmd:reason,args:[room.source,source,args]})}
 const stateKey=(girl,name)=>{const key='fox-state:'+girl+':'+name;stateNames.add(key);return key},guardMany=(conditions,fn)=>{guards.push(...conditions);try{fn()}finally{guards.splice(guards.length-conditions.length,conditions.length)}}
 const guarded=(key,value,fn)=>{guards.push({var:key,op:'===',value});try{fn()}finally{guards.pop()}},select=(label,options,source,menu=false,random=false)=>{const key='fox-choice:'+serial++;emit({op:'speaker',segments:[]});if(menu)emit({op:'ui',visible:false});else emit({op:'text',segments:segments(label)});emit({op:'choice',id:steps.length+':'+pending.length,var:key,...(random?{random:true}:{}),options:options.map((s,i)=>({value:i,segments:segments(s)}))});flush();return key}
 const modelFor=target=>ctx.models[room.models[target||'']],paint=(target,changes={})=>{const model=modelFor(target);if(!model){raw('native-skeleton-target-missing',target);return}emit({op:'spine',slot:'fox:'+target,kind:target?'actor':'still',skel:model.skel,atlas:model.atlas,textureMap:model.textureMap,patchTracks:true,...(room.graphics?.[target]?{stage:room.graphics[target].stage,place:room.graphics[target].place,nativePlace:true}:{}),...changes})}
 const track=(c,source)=>{const model=modelFor(c.target),anim=model?.animations.find(a=>a.name===c.animationName);if(!model||c.animationName&&!anim){raw('native-animation-missing',source,{target:c.target,anim:c.animationName});return}if(c.add){raw('native-animation-queue-not-lifted',source,c.animationName);return}paint(c.target,{tracks:[{track:c.trackIndex||0,anim:c.animationName||'',loop:!!c.loop,timeScale:c.timeScale,trackTime:c.startTime||0,mix:c.mixDuration,token:serial++}]});if(c.wait&&anim){emit({op:'wait',seconds:anim.duration/Math.max(.01,c.timeScale||1)});flush()}}
 const voice=id=>{const src=ctx.voices[id];if(src){emit({op:'voice',src});stats.voices++}else{stats.unresolved['voice:'+id]=(stats.unresolved['voice:'+id]||0)+1;raw('native-voice-missing',id)}}
 const dialogue=(label,stack=[])=>{
  label=String(label||'').replace(/^\*/,'');if(stack.includes(label)||stack.length>24){raw('native-dialogue-call-cycle',label);return}const rows=ctx.dialogue[label];if(!rows){raw('native-dialogue-label-missing',label);return}stack=[...stack,label]
  for(let i=0;i<rows.length;i++){const row=rows[i],cmd=row.Command
   if(cmd==='EndScenario')return
   if(cmd==='JumpRandom'){const variants=[row];while(rows[i+1]?.Command==='JumpRandom')variants.push(rows[++i]);const key=select('原生随机对话（选择一个分支）',variants.map(v=>v.Arg1),row.source,false,true);variants.forEach((v,j)=>guarded(key,j,()=>dialogue(v.Arg1,stack)));return}
   if(cmd==='Jump'){dialogue(row.Arg1,stack);return}
   if(cmd==='StopVoice')emit({op:'voiceStop'})
   else if(cmd==='Wait')emit({op:'wait',seconds:Math.max(0,Number(row.Arg6)||0)})
   else if(cmd&&cmd!=='小說話'&&cmd!=='CP')raw('native-dialogue-command:'+cmd,row.source,{args:[row.Arg1,row.Arg2,row.Arg3]})
   const text=(ctx.options.language==='zh-CN'?row['Chinese (Simplified)']:ctx.options.language==='ja'?row.Japanese:ctx.options.language==='en'?row.English:'')||row.Text
   if(text){emit({op:'voiceStop'});if(row.Voice)voice(row.Voice);emit({op:'ui',visible:true});emit({op:'speaker',segments:segments(row.Arg1)});emit({op:'text',segments:segments(text)});stats.messages++;flush()}
  }
 }
 // Native CallAVG(wait=false) starts dialogue without blocking the following visual/state commands.
 const drainDialogue=()=>{for(const task of deferredDialogue.splice(0))guardMany(task.guards,()=>dialogue(task.label))}
 const audio=(name,on,source,force=false)=>{const go=room.gameObjects[name];if(!go){raw('native-object-missing',source,name);return}if(go.unmappedImages)raw('native-object-image-toggle-not-lifted',source,{name,on});if(go.visual){if(go.object&&room.graphics&&Object.values(room.graphics).some(g=>g.chain.includes(go.object))){emit({op:'set',var:'fox-active:'+go.object,value:Number(on)});for(const[target,g]of Object.entries(room.graphics)){emit({op:'set',var:'fox-visible:'+target,value:1});for(const id of g.chain)guarded('fox-active:'+id,0,()=>emit({op:'set',var:'fox-visible:'+target,value:0}));guarded('fox-visible:'+target,1,()=>paint(target,{visible:true}));guarded('fox-visible:'+target,0,()=>paint(target,{visible:false}))}}else raw('native-object-visual-toggle-not-lifted',source,{name,on})}emit({op:'bgvoiceOff',slot:'fox-audio:'+name});if(!on)return;const sounds=go.audio.filter(a=>force||a.playOnAwake);if(sounds.length===1){const s=sounds[0];emit({op:s.loop?'bgvoice':'se',slot:'fox-audio:'+name,src:s.src,volume:s.volume,loop:s.loop})}else if(sounds.length>1)raw('native-state-audio-selection-required',source,{name,variants:sounds.length})}
 const call=(name,stack=[])=>{if(stack.includes(name)||stack.length>24){raw('native-call-cycle',name);return}const block=room.functions[name];if(!block){raw('native-function-missing',name);return}blockRun(block,[...stack,name])}
 const branch=(c,source,stack)=>{
  // The native coroutine falls back to falseBlock when trueBlock is absent.
  if(!c.trueBlock){blockRun(c.falseBlock,stack);return}
  const conditions=c.condition?.valueConditionals||[],key=stateKey(c.girlName,c.girlInfomation),result='fox-cond:'+serial++,needsState=conditions.some(x=>x.compareOperator<6),known=needsState?[{var:key,op:'!==',value:UNKNOWN}]:[]
  if(conditions.length>128)throw Error('Fox native condition group exceeds bounds')
  const testSequence=conditions.map(row=>{if(!Number.isInteger(row.compareOperator)||row.compareOperator<0||row.compareOperator>7||![0,1].includes(row.logicOperator))throw Error('Fox native condition enum not supported: '+source);return{join:row.logicOperator===0?'and':'or',...(row.compareOperator>=6?{value:row.compareOperator===6}:{test:{var:key,op:['>','<','>=','<=','===','!=='][row.compareOperator],value:row.b}})}})
  guardMany(known,()=>emit({op:'set',var:result,testSequence}))
  if(needsState)guarded(key,UNKNOWN,()=>{raw('native-state-condition-manual',source,{girl:c.girlName,state:c.girlInfomation,condition:c.condition});const description=conditions.map(r=>(r.logicOperator===0?'AND ':'OR ')+(r.compareOperator>=6?String(r.compareOperator===6):['>','<','>=','<=','==','!='][r.compareOperator]+' '+r.b)).join(' ');if(thumbnail)return;const choice=select(c.girlName+' / '+c.girlInfomation+' '+description+'（未读取此原生状态；这是预览判断，并非原作选项）',['条件成立：执行分支 A','条件不成立：执行分支 B'],source);guarded(choice,0,()=>emit({op:'set',var:result,value:1}));guarded(choice,1,()=>emit({op:'set',var:result,value:0}))})
  guarded(result,1,()=>blockRun(c.trueBlock,stack));guarded(result,0,()=>blockRun(c.falseBlock,stack))
 }
 const blockRun=(block,stack)=>{
  if(!block)return;for(const c of block.interactiveFlows||[]){if(c.disable)continue;const source=(block.$source||room.source)+'@'+c.$offset
   if(c.$type==='ChangeSpine')track(c,source)
   else if(c.$type==='ChangeSkin'){const model=modelFor(c.target);if(model?.skins.includes(c.skinName))paint(c.target,{skin:c.skinName});else raw('native-skin-missing',source,c.skinName)}
   else if(c.$type==='CallFunction')call(c.key,stack)
   else if(c.$type==='CallFunctions'){if(c.async)raw('native-parallel-calls-serialized',source,c.keyz);for(const key of c.keyz||[])call(key,stack)}
   else if(c.$type==='CallAVG'){if(bootstrap)continue;if(c.wait===false)deferredDialogue.push({label:c.label,guards:[...guards]});else{drainDialogue();dialogue(c.label)}}
   else if(c.$type==='SetActive')audio(c.GOName,!!c.active,source)
   else if(c.$type==='PlaySound')audio(c.GOName,true,source,true)
   else if(c.$type==='GrilInfomationBranch')branch(c,source,stack)
   else if(c.$type==='InteractiveWait'){emit({op:'wait',seconds:Math.max(0,c.waitSecond_停止秒數||0)});flush()}
   else if(['SetIntState','SetFloatState','AddIntState'].includes(c.$type)){const key=stateKey(c.girlName,c.stateName),command={op:'set',var:key,value:c.intValue??c.floatValue??c.value??0,calc:c.$type==='AddIntState'?'add':'set'};if(c.$type==='AddIntState')guardMany([{var:key,op:'!==',value:UNKNOWN}],()=>emit(command));else emit(command)}
   else if(c.$type==='AddStateTo'){const target=stateKey(c.girlName,c.targetStateName),inputs=(c.addFromStateArray||[]).map(n=>stateKey(c.girlName,n));guardMany(inputs.map(varName=>({var:varName,op:'!==',value:UNKNOWN})),()=>{emit({op:'set',var:target,value:0});for(const valueVar of inputs)emit({op:'set',var:target,valueVar,calc:'add'})});for(const key of inputs)guarded(key,UNKNOWN,()=>emit({op:'set',var:target,value:UNKNOWN}))}
   else raw('native-flow-command:'+c.$type,source,Object.fromEntries(Object.entries(c).filter(([k])=>!['error','notOk'].includes(k))))
  }
 }
 const actionOnly=typeof meta.interactionAction==='string',functions=Object.keys(room.functions),selected=/^flow-(\d+)$/.exec(meta.scene||''),name=actionOnly?meta.interactionAction:selected?functions[Number(selected[1])]:'init';if(!name||!room.functions[name])throw Error('Fox native scene entry missing')
 if(!actionOnly){
 for(const warning of room.warnings||[])raw(warning.reason,room.source,warning)
 for(const[id,active]of Object.entries(room.objectStates||{}))emit({op:'set',var:'fox-active:'+id,value:Number(active)})
 for(const[target,g]of Object.entries(room.graphics||{})){const model=modelFor(target);paint(target,{visible:g.chain.every(id=>room.objectStates[id]),...(g.skin?{skin:g.skin}:{}),tracks:g.animation&&model.animations.some(a=>a.name===g.animation)?[{track:0,anim:g.animation,loop:g.loop,timeScale:g.timeScale}]:[]})}
 const main=modelFor('');paint('',{skin:room.initial.skin||ctx.options.skin,tracks:!room.graphics?.['']&&main.animations.some(a=>a.name==='view')?[{track:0,anim:'view',loop:true}]:[]})
 }
 if(selected&&name!=='init'&&room.functions.init){bootstrap=true;try{call('init')}finally{bootstrap=false}}
 emit({op:'label',name});call(name);drainDialogue();flush();
 if(meta.scene==='interactive'){
  const actions=room.interactions||[];if(!actions.length)throw Error('Fox native interaction buttons absent');const running='fox-interactive-running',limit=Math.max(1,Math.min(16,Math.floor(ctx.options.interactionLimit)||8));emit({op:'set',var:running,value:1})
  for(let round=0;round<limit;round++)guarded(running,1,()=>{const choice=select('原生互动 · '+(round+1)+'/'+limit,[...actions,'结束互动'],room.source,true);actions.forEach((action,i)=>guarded(choice,i,()=>{emit({op:'label',name:action});call(action);drainDialogue();flush()}));guarded(choice,actions.length,()=>emit({op:'set',var:running,value:0}));flush()})
  guarded(running,1,()=>{raw('native-interaction-limit',room.source,limit);emit({op:'ui',visible:true});emit({op:'text',segments:segments('本次互动预览已达到 '+limit+' 轮；可重播，或调整 interactionLimit。')})});guarded(running,0,()=>{emit({op:'ui',visible:true});emit({op:'text',segments:segments('互动结束')})});flush()
 }
 if(thumbnail){const commands=steps.flatMap(s=>s.commands).filter(c=>!['wait','text','speaker','choice','ui'].includes(c.op));steps.splice(0,steps.length,{index:0,commands})}if(!steps.length)steps.push({index:0,commands:[]});steps[0].commands.unshift(...[...stateNames].map(varName=>({op:'set',var:varName,value:UNKNOWN,...(actionOnly?{ifAbsent:true}:{})})));stats.commands=emitted;return{steps,stats}
}
