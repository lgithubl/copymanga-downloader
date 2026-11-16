const segments=text=>[{text:String(text||'')}]
export function parseFoxRoom(d,ctx,meta={}){
 const room=d.room,steps=[],stats={messages:0,voices:0,raw:{},unresolved:{},notes:ctx.notes},guards=[];let pending=[],serial=0,emitted=0
 const emit=c=>{if(++emitted>ctx.options.maxCommands)throw Error('Fox room command limit exceeded');pending.push(guards.length?{...c,when:[...guards,...c.when||[]]}:c)},flush=()=>{if(pending.length){steps.push({index:steps.length,flow:true,commands:pending});pending=[]}},raw=(reason,source,args)=>{stats.raw[reason]=(stats.raw[reason]||0)+1;emit({op:'raw',cmd:reason,args:[room.source,source,args]})}
 const guarded=(key,value,fn)=>{guards.push({var:key,op:'===',value});try{fn()}finally{guards.pop()}},select=(label,options,source)=>{const key='fox-choice:'+serial++;emit({op:'speaker',segments:[]});emit({op:'text',segments:segments(label)});emit({op:'choice',id:steps.length+':'+pending.length,var:key,options:options.map((s,i)=>({value:i,segments:segments(s)}))});flush();return key}
 const modelFor=target=>ctx.models[room.models[target||'']],paint=(target,changes={})=>{const model=modelFor(target);if(!model){raw('native-skeleton-target-missing',target);return}emit({op:'spine',slot:'fox:'+target,kind:target?'actor':'still',skel:model.skel,atlas:model.atlas,textureMap:model.textureMap,patchTracks:true,...changes})}
 const track=(c,source)=>{const model=modelFor(c.target),anim=model?.animations.find(a=>a.name===c.animationName);if(!model||c.animationName&&!anim){raw('native-animation-missing',source,{target:c.target,anim:c.animationName});return}if(c.add){raw('native-animation-queue-not-lifted',source,c.animationName);return}paint(c.target,{tracks:[{track:c.trackIndex||0,anim:c.animationName||'',loop:!!c.loop,timeScale:c.timeScale,trackTime:c.startTime||0,mix:c.mixDuration,token:serial++}]});if(c.wait&&anim){emit({op:'wait',seconds:anim.duration/Math.max(.01,c.timeScale||1)});flush()}}
 const voice=id=>{const src=ctx.voices[id];if(src){emit({op:'voice',src});stats.voices++}else{stats.unresolved['voice:'+id]=(stats.unresolved['voice:'+id]||0)+1;raw('native-voice-missing',id)}}
 const dialogue=(label,stack=[])=>{
  label=String(label||'').replace(/^\*/,'');if(stack.includes(label)||stack.length>24){raw('native-dialogue-call-cycle',label);return}const rows=ctx.dialogue[label];if(!rows){raw('native-dialogue-label-missing',label);return}stack=[...stack,label]
  for(let i=0;i<rows.length;i++){const row=rows[i],cmd=row.Command
   if(cmd==='EndScenario')return
   if(cmd==='JumpRandom'){const variants=[row];while(rows[i+1]?.Command==='JumpRandom')variants.push(rows[++i]);const key=select('原生随机对话（选择一个分支）',variants.map(v=>v.Arg1),row.source);variants.forEach((v,j)=>guarded(key,j,()=>dialogue(v.Arg1,stack)));return}
   if(cmd==='Jump'){dialogue(row.Arg1,stack);return}
   if(cmd==='StopVoice')emit({op:'voiceStop'})
   else if(cmd==='Wait')emit({op:'wait',seconds:Math.max(0,Number(row.Arg6)||0)})
   else if(cmd&&cmd!=='小說話'&&cmd!=='CP')raw('native-dialogue-command:'+cmd,row.source,{args:[row.Arg1,row.Arg2,row.Arg3]})
   const text=(ctx.options.language==='zh-CN'?row['Chinese (Simplified)']:ctx.options.language==='ja'?row.Japanese:ctx.options.language==='en'?row.English:'')||row.Text
   if(text){emit({op:'voiceStop'});if(row.Voice)voice(row.Voice);emit({op:'ui',visible:true});emit({op:'speaker',segments:segments(row.Arg1)});emit({op:'text',segments:segments(text)});stats.messages++;flush()}
  }
 }
 const audio=(name,on,source,force=false)=>{const go=room.gameObjects[name];if(!go){raw('native-object-missing',source,name);return}if(go.visual)raw('native-object-visual-toggle-not-lifted',source,{name,on});emit({op:'bgvoiceOff',slot:'fox-audio:'+name});if(!on)return;const sounds=go.audio.filter(a=>force||a.playOnAwake);if(sounds.length===1){const s=sounds[0];emit({op:s.loop?'bgvoice':'se',slot:'fox-audio:'+name,src:s.src,volume:s.volume,loop:s.loop})}else if(sounds.length>1)raw('native-state-audio-selection-required',source,{name,variants:sounds.length})}
 const call=(name,stack=[])=>{if(stack.includes(name)||stack.length>24){raw('native-call-cycle',name);return}const block=room.functions[name];if(!block){raw('native-function-missing',name);return}blockRun(block,[...stack,name])}
 const blockRun=(block,stack)=>{
  if(!block)return;for(const c of block.interactiveFlows||[]){if(c.disable)continue;const source=(block.$source||room.source)+'@'+c.$offset
   if(c.$type==='ChangeSpine')track(c,source)
   else if(c.$type==='ChangeSkin'){const model=modelFor(c.target);if(model?.skins.includes(c.skinName))paint(c.target,{skin:c.skinName});else raw('native-skin-missing',source,c.skinName)}
   else if(c.$type==='CallFunction')call(c.key,stack)
   else if(c.$type==='CallFunctions'){if(c.async)raw('native-parallel-calls-serialized',source,c.keyz);for(const key of c.keyz||[])call(key,stack)}
   else if(c.$type==='CallAVG')dialogue(c.label)
   else if(c.$type==='SetActive')audio(c.GOName,!!c.active,source)
   else if(c.$type==='PlaySound')audio(c.GOName,true,source,true)
   else if(c.$type==='GrilInfomationBranch'){raw('native-state-condition-manual',source,{girl:c.girlName,state:c.girlInfomation,condition:c.condition});const key=select(c.girlName+' / '+c.girlInfomation+'（原生数值条件，手动选择）',['满足条件','不满足条件'],source);guarded(key,0,()=>blockRun(c.trueBlock,stack));guarded(key,1,()=>blockRun(c.falseBlock,stack))}
   else if(c.$type==='InteractiveWait'){emit({op:'wait',seconds:Math.max(0,c.waitSecond_停止秒數||0)});flush()}
   else if(['SetIntState','SetFloatState','AddIntState'].includes(c.$type)){emit({op:'set',var:'fox-state:'+c.girlName+':'+c.stateName,value:c.intValue??c.floatValue??0,calc:c.$type==='AddIntState'?'add':'set'})}
   else raw('native-flow-command:'+c.$type,source,Object.fromEntries(Object.entries(c).filter(([k])=>!['error','notOk'].includes(k))))
  }
 }
 const functions=Object.keys(room.functions),selected=/^flow-(\d+)$/.exec(meta.scene||''),name=selected?functions[Number(selected[1])]:'init';if(!name||!room.functions[name])throw Error('Fox native scene entry missing')
 const main=modelFor('');paint('',{skin:room.initial.skin||ctx.options.skin,tracks:main.animations.some(a=>a.name==='view')?[{track:0,anim:'view',loop:true}]:[]})
 emit({op:'label',name});call(name);flush();if(!steps.length)steps.push({index:0,commands:[]});stats.commands=emitted;return{steps,stats}
}
