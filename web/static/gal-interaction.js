import{interactionConditions,conditionValue}from'./gal-interaction-conditions.js'
import{interactionAlternatives,alternativeKey}from'./gal-interaction-alternatives.js'
import{createCommandInteractionLayers}from'./gal-interaction-commands.js'
import {interactionPreferences,interactionTriggerMode,toolModeKey,areaModeKey,TRIGGER_MODES,TRIGGER_LABELS,createInteractionTriggers,bindInteractionTrigger} from './gal-interaction-triggers.js'
import {createInteractionHighlight} from './gal-interaction-highlight.js'
import {createLive2dLayers} from './gal-live2d.js'
import {assetUrl,volumeGain,galPlayerDefaults} from './gal-engine.js'
import {roleState,interactionSpec,interactionFeedback,interactionRegions,toggleInteractionTool,toggleInteractionArea,interactionAreaEnabled} from './gal-interaction-state.js'
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n}
const icon=(kind)=>{const n=document.createElementNS('http://www.w3.org/2000/svg','svg');n.setAttribute('viewBox','0 0 24 24');n.setAttribute('aria-hidden','true');n.innerHTML=kind==='regions'?'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>':'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>';return n}
export function shortInteractionLabel(title){return String(title).replace(/^(服装|表情|区域|互动|袜子)\s*/,'').replace(/\s*·\s*破损/,'破').replace('完整','整').replace('关闭','关').replace('开启','开').slice(0,3)||'—'}
export function createGalInteraction({container,reader,chapter,onEscape,onToggleImmersive,onDetails,viewKey=''}){
 const data=reader.scene.interaction,root=el('div','gal-player gal-interaction'),viewport=el('div','gal-interaction-view'),stage=el('div','gal-interaction-stage'),backdrop=el('div','gal-interaction-background'),world=el('div','gal-interaction-world'),speech=el('div','gal-interaction-speech'),rail=el('div','gal-interaction-rail'),panel=el('div','gal-interaction-controls'),bar=el('div','gal-bar'),errors=new Set(data.diagnostics||[])
 const audioEffects=new Set()
 const key='copymanga.gal.interaction.'+(viewKey||reader.itemId||reader.resourceBase||reader.node?.id||'default')
 let saved={},role,state,action=null,serial=0,destroyed=false,loading=false,visible=true,renderToken=0,audioToken=0,voice=null,sound=null,lastReply=null,pendingPaint=null,voiceBusy=false,voiceDone=null,eventVoice=null,commandBusy=false,nativeChoice=false,meterView=null,lastMeterSave=0,meterViews=new Map()
 let hoverRegion='',focusRegion='',flashRegion='',flashTimer=0
 try{saved=JSON.parse(localStorage.getItem(key)||'{}');if(!saved||typeof saved!=='object')saved={}}catch{saved={}}
 root.dataset.commandInteraction=String(data.roles.some(r=>r.model.commandModel));
 const defaults=galPlayerDefaults(reader.node?.player),legacy=(k,f)=>{try{const v=localStorage.getItem('copymanga.gal.'+k);return v!==null&&Number.isFinite(Number(v))?Number(v):f}catch{return f}}
 const preferences=interactionPreferences(saved.preferences,{textOpacity:legacy('boxOpacity',defaults.textOpacity??.74),fontScale:legacy('fontScale',defaults.fontScale??1),voiceVolume:legacy('voiceVolume',.8),sfxVolume:legacy('sfxVolume',.8)});saved.preferences=preferences;saved.conditions=saved.conditions&&typeof saved.conditions==='object'?saved.conditions:{default:true,values:{}};saved.conditions.values=saved.conditions.values&&typeof saved.conditions.values==='object'?saved.conditions.values:{};saved.visuals||={};saved.meters||={};saved.kaijuStates||={}
 const persist=()=>{try{localStorage.setItem(key,JSON.stringify(saved))}catch{}}
 const url=src=>assetUrl(reader.resourceBase,src,reader.resourceVersion)
 const save=()=>{saved.role=role.id;saved[role.id]={background:state.background,outfit:state.outfit,values:state.values,face:state.face,tool:state.tool,enabledTools:state.enabledTools,enabledAreas:state.enabledAreas,selectedArea:state.selectedArea,alternatives:state.alternatives};persist()}
 const report=message=>{errors.add(message);paintStatus()}
 function paintStatus(){root.dataset.loading=String(loading);if(root.querySelector('.gal-interaction-diag summary'))root.querySelector('.gal-interaction-diag summary').textContent='诊断'+(errors.size?'（'+errors.size+'）':'');if(root.querySelector('.gal-interaction-diag[open] pre'))root.querySelector('.gal-interaction-diag pre').textContent=[...errors].join('\n')||'无错误'}
 const button=(title,fn)=>{const b=el('button','gal-btn',title);b.type='button';b.addEventListener('click',fn);return b}
 function dock(kind,title,body,openKey){
  const details=el('details','gal-interaction-'+kind),summary=el('summary');summary.title=title;summary.setAttribute('aria-label',title);summary.append(icon(kind));details.append(summary,body)
  details.open=typeof saved[openKey]==='boolean'?saved[openKey]:window.innerWidth>640
  details.addEventListener('toggle',()=>{saved[openKey]=details.open;persist();if(kind==='regions'&&!details.open){hoverRegion=focusRegion='';paintHighlight()}})
  return details
 }
 const regionsBody=el('div','gal-interaction-region-list'),settingsPanel=dock('settings','角色与互动设置',panel,'settingsOpen'),regionsPanel=dock('regions','可触发区域',regionsBody,'regionsOpen');const alternativesBody=el('div','gal-interaction-alternative-list'),alternativesPanel=dock('alternatives','随机语音与动作分支',alternativesBody,'alternativesOpen');const conditionsBody=el('div','gal-interaction-condition-list'),conditionsPanel=dock('conditions','互动状态',conditionsBody,'conditionsOpen');rail.append(settingsPanel,regionsPanel,alternativesPanel,conditionsPanel)
 const triggers=createInteractionTriggers({fire:perform,blocked:()=>destroyed||!visible||loading||nativeChoice||(preferences.waitVoice&&(voiceBusy||commandBusy||commands?.audioBusy())),interval:()=>preferences.interval,onChange:updateModeIndicators})
 function modeFor(tool,area){return interactionTriggerMode(preferences,role.id,tool,area)}
 function updateModeIndicators(){root.dataset.activeTriggers=String(triggers.size);root.dataset.queuedTriggers=String(triggers.pending);for(const b of root.querySelectorAll('[data-mode-kind]')){const m=modeFor(b.dataset.tool,b.dataset.modeKind==='area'?b.dataset.area:undefined);b.textContent={single:'1',repeat:'↻',hold:'▥'}[m];b.dataset.mode=m;b.title=(b.dataset.modeKind==='tool'?'此互动的默认模式：':'此区域的模式：')+TRIGGER_LABELS[m]+'；点击切换';b.setAttribute('aria-label',b.title)}for(const b of regionsBody.querySelectorAll('[data-region]'))b.classList.toggle('is-repeating',triggers.has(areaModeKey(role.id,b.dataset.tool,b.dataset.region)));if(typeof stopTriggers!=='undefined')stopTriggers.disabled=!triggers.size&&!triggers.pending}
 function modeButton(kind,tool,area){const b=button('',e=>{});b.className='gal-interaction-mode';b.dataset.modeKind=kind;b.dataset.tool=tool;if(area!==undefined)b.dataset.area=area;b.addEventListener('click',e=>{e.stopPropagation();const current=modeFor(tool,area),next=TRIGGER_MODES[(TRIGGER_MODES.indexOf(current)+1)%TRIGGER_MODES.length];if(kind==='tool'){preferences.toolModes[toolModeKey(role.id,tool)]=next;for(const a of role.tools.find(t=>t.id===tool)?.areas||[]){const key=areaModeKey(role.id,tool,a.id);if(!Object.hasOwn(preferences.areaModes,key))triggers.stop(key)}}else{preferences.areaModes[areaModeKey(role.id,tool,area)]=next;triggers.stop(areaModeKey(role.id,tool,area))}persist();updateModeIndicators()});return b}
 function payload(area,tool=state.tool,selected=false){return area?{key:areaModeKey(role.id,tool,area),role:role.id,tool,area,selected}:null}
 const triggerBinding=element=>bindInteractionTrigger(element,{controller:triggers,mode:p=>modeFor(p.tool,p.area),resolve:e=>{if(!state.tool||destroyed||!visible)return null;if(nativeChoice)commands?.cancel();return payload(element.dataset.region||resolveHit(layers.hitTest('interaction',e.clientX,e.clientY,role.hitAreas)))}})
 const layerOptions={parent:world,url,onMissing:src=>report('资源缺失：'+src),onError:e=>report('演出诊断：'+e.message),onUnavailable:()=>report('WebGL 不可用')}
 const choices=el('div','gal-interaction-native-choices');speech.after(choices)
 const commands=data.roles.some(r=>r.model.commandModel)?createCommandInteractionLayers({...layerOptions,onEventVoice:request=>{triggers.request(request.key,{kind:'event-voice',role:role.id,request});return()=>{triggers.stop(request.key);if(eventVoice===request)stopAudio()}},canAmbientVoice:()=>!voiceBusy&&!commandBusy&&!triggers.pending,onAudioIdle:()=>triggers.notify(),waitForVoice:()=>preferences.waitVoice,onMeters:snapshot=>{if(!role)return;saved.kaijuStates[role.characterId||role.id]={values:snapshot.values,flags:snapshot.flags,sticky:snapshot.sticky,locks:snapshot.locks};for(const m of snapshot.meters){const view=meterViews.get(m.id);if(view){view.range.value=String(m.value/m.max*100);view.lock.update(snapshot.locks?.[m.id]===true);view.value.textContent='Lv.'+m.level+' · '+(m.value/m.max*100).toFixed(0)+'%'}}persist()},onMeterReady:event=>triggers.request('native-meter',{kind:'meter',role:role.id,event}),canAutoTrigger:()=>!triggers.pending&&(!preferences.waitVoice||!voiceBusy),onMeter:snapshot=>{if(!role)return;saved.meters[role.id]=snapshot;if(meterView){meterView.lock.update(snapshot.locked===true);meterView.range.value=String(snapshot.value/snapshot.max*100);meterView.value.textContent=(snapshot.value/snapshot.max*100).toFixed(0)+'% · 次数 '+snapshot.count}if(performance.now()-lastMeterSave>1000){lastMeterSave=performance.now();persist()}},conditionState:c=>conditionValue(role,c,saved.conditions),audioGain:kind=>volume(kind),onBusy:value=>{commandBusy=value;triggers.notify()},onChoice:c=>{nativeChoice=!!c;choices.replaceChildren();if(c)for(const option of c.options)choices.append(button((option.segments||[]).map(s=>s.text||'').join(''),()=>c.select(option.value)))},onMessage:reply=>{speech.textContent=reply.text;play(reply,{keepVoice:true})},onAudio:(kind,c)=>{if(kind==='voiceStop')stopAudio();else if(kind==='voice')play({voice:c.src});else if(kind==='se'){const a=new Audio(url(c.src));audioEffects.add(a);a.addEventListener('ended',()=>audioEffects.delete(a));a.volume=volume('sfx');a.play().catch(()=>report('音效失败：'+c.src))}}}):null
 const layers=commands||createLive2dLayers(layerOptions)
 speech.addEventListener('click',()=>commands?.advance())
 const highlight=createInteractionHighlight({parent:world,layers})
 function paintHighlight(){const id=hoverRegion||focusRegion||flashRegion;highlight.set(role?.hitAreas.filter(a=>a.id===id)||[],{pulse:!!flashRegion&&flashRegion===id})}
 function resetRegions(){hoverRegion=focusRegion=flashRegion='';clearTimeout(flashTimer);paintHighlight();stage.style.cursor='default';delete stage.dataset.hit;delete stage.dataset.motion}
 function selectionIndicators(){
  for(const b of root.querySelectorAll('[data-control="互动方式"] button[data-value]')){b.setAttribute('aria-pressed',String(state.enabledTools.includes(b.dataset.value)));b.dataset.current=String(state.tool===b.dataset.value)}
  for(const b of regionsBody.querySelectorAll('[data-region]')){b.setAttribute('aria-pressed',String(interactionAreaEnabled(state,b.dataset.tool,b.dataset.region)));b.dataset.current=String(state.tool===b.dataset.tool&&state.selectedArea===b.dataset.region)}
  updateModeIndicators()
 }
 function closeTarget(tool,area){
  triggers.stop(areaModeKey(role.id,tool,area));const native=role.tools.find(t=>t.id===tool)?.areas.find(a=>a.id===area)
  if(native?.offCommands?.length)triggers.request('off:'+areaModeKey(role.id,tool,area),{...payload(area,tool),kind:'off',commands:native.offCommands})
  else if(!commands&&action?.tool===tool&&action?.id===area){action=null;serial++;paint()}
 }
 function selectTarget(tool,area){
  const result=toggleInteractionArea(role,state,tool,area);if(!result)return
  if(result==='off')closeTarget(tool,area)
  if(result==='on'){const p=payload(area,tool,true),mode=modeFor(tool,area);if(mode==='single')triggers.request(p.key,p);else triggers.start(p.key,p,mode)}
  save();selectionIndicators();alternatives()
 }
 function regions(){
  regionsBody.replaceChildren();let count=0
  for(const tool of role.tools.filter(t=>state.enabledTools.includes(t.id)))for(const [i,area]of interactionRegions(role,{...state,tool:tool.id}).entries()){
   count++;const b=button('',()=>{});b.title=tool.title+' · '+area.title;b.setAttribute('aria-label',b.title);b.dataset.region=area.id;b.dataset.tool=tool.id;b.disabled=!!area.disabled
   if(tool.icon){const image=el('img');image.alt='';image.src=url(tool.icon);image.loading='lazy';image.addEventListener('error',()=>image.remove(),{once:true});b.append(image)}else b.append(el('span','gal-interaction-target-icon',shortInteractionLabel(tool.title)))
   b.append(el('span','gal-interaction-target-number',String(i+1)))
   b.addEventListener('pointerenter',()=>{hoverRegion=area.id;paintHighlight()});b.addEventListener('pointerleave',()=>{if(hoverRegion===area.id){hoverRegion='';paintHighlight()}})
   b.addEventListener('focus',()=>{focusRegion=area.id;paintHighlight()});b.addEventListener('blur',()=>{if(focusRegion===area.id){focusRegion='';paintHighlight()}})
   let held=false;b.addEventListener('pointerdown',e=>{if(e.button===0&&modeFor(tool.id,area.id)==='hold'){held=true;selectTarget(tool.id,area.id)}});b.addEventListener('click',()=>{if(held){held=false;return}selectTarget(tool.id,area.id)})
   const shell=el('span','gal-interaction-choice-shell');shell.append(b,modeButton('area',tool.id,area.id));regionsBody.append(shell)
  }
  regionsPanel.querySelector('summary').title='可触发区域'+(count?' · '+count:'');selectionIndicators()
 }
 function meterLock(title,locked,change){
  const b=button('',()=>change(b.getAttribute('aria-pressed')!=='true'));b.classList.add('gal-interaction-meter-lock');b.setAttribute('aria-label','锁定'+title+'累积值')
  const update=value=>{b.textContent=value?'🔒':'🔓';b.setAttribute('aria-pressed',String(value));b.title=value?'已锁定：只允许手动调整百分比':'未锁定：随互动自动增减'};update(locked)
  return{button:b,update}
 }
 function conditionControls(){
  const list=interactionConditions(role),visuals=role.visuals||[];conditionsPanel.hidden=!list.length&&!visuals.length&&!role.model.meter&&!role.model.meters?.length;conditionsBody.replaceChildren();meterView=null;meterViews=new Map();if(conditionsPanel.hidden)return
  const update=()=>{triggers.stopAll();commands?.cancel();persist();conditionControls()}
  if(role.model.meter){const field=el('div','gal-interaction-meter'),title=el('div','','累积条'),range=el('input'),value=el('output'),points=el('div','gal-interaction-meter-points');range.type='range';range.min=0;range.max=100;range.step=1;range.setAttribute('aria-label','当前累积值');range.value=String((saved.meters[role.id]?.value||0)/(role.model.meter.bars.girl.max||1)*100);const seek=fraction=>{commands?.seekMeter(fraction);persist()};range.addEventListener('input',()=>seek(Number(range.value)/100));for(const p of[0,25,50,75,100])points.append(button(p+'%',()=>seek(p/100)));const lock=meterLock('',saved.meters[role.id]?.locked===true,v=>{commands?.lockMeter(v);persist()}),heading=el('div','gal-interaction-meter-heading');heading.append(title,lock.button);meterView={range,value,lock};field.append(heading,range,value,points,el('p','','锁定后仅手动调整百分比；解锁后继续随互动增减。'));conditionsBody.append(field)}
  for(const m of role.model.meters||[]){const field=el('div','gal-interaction-meter'),range=el('input'),value=el('output'),points=el('div','gal-interaction-meter-points');range.type='range';range.min=0;range.max=100;range.step=1;range.value=String((saved.kaijuStates[role.characterId||role.id]?.values?.[m.id]||0)/m.max*100);range.setAttribute('aria-label',m.title+'累积值');range.addEventListener('input',()=>commands?.seekMeters(m.id,Number(range.value)/100));for(const p of[0,25,50,75,100])points.append(button(p+'%',()=>commands?.seekMeters(m.id,p/100)));const lock=meterLock(m.title,saved.kaijuStates[role.characterId||role.id]?.locks?.[m.id]===true,v=>commands?.lockMeters(m.id,v)),heading=el('div','gal-interaction-meter-heading');heading.append(el('div','',m.title),lock.button);meterViews.set(m.id,{range,value,lock});field.append(heading,range,value,points);conditionsBody.append(field)}
  for(const visual of visuals){const field=el('label','gal-interaction-condition'),title=el('span','',visual.title),select=el('select');select.setAttribute('aria-label',visual.title);for(const [id,text]of[['','自动'],['true','显示'],['false','隐藏']]){const option=el('option','',text);option.value=id;select.append(option)}const current=saved.visuals[role.id]?.[visual.id];select.value=typeof current==='boolean'?String(current):'';select.addEventListener('change',()=>{saved.visuals[role.id]||={};if(select.value==='')delete saved.visuals[role.id][visual.id];else saved.visuals[role.id][visual.id]=select.value==='true';persist();paint()});field.append(title,select);conditionsBody.append(field)}
  if(!list.length)return
  conditionsBody.append(choiceGrid('默认分支',[{id:'true',title:'成立'},{id:'false',title:'不成立'}],String(saved.conditions.default!==false),id=>{saved.conditions.default=id==='true';update()}),el('p','','预览状态，不读取原作存档；未单独设置的条件使用默认分支。'))
  for(const c of list){const field=el('label','gal-interaction-condition'),title=el('span','',c.label),select=el('select');select.setAttribute('aria-label',c.label);title.title=c.label
   for(const [value,text]of[['','跟随默认'],['true','成立'],['false','不成立']]){const option=el('option','',text);option.value=value;select.append(option)}select.value=typeof saved.conditions.values[c.id]==='boolean'?String(saved.conditions.values[c.id]):''
   select.addEventListener('change',()=>{if(select.value==='')delete saved.conditions.values[c.id];else saved.conditions.values[c.id]=select.value==='true';update()});field.append(title,select);conditionsBody.append(field)
  }
 }
 function alternatives(){
  alternativesBody.replaceChildren();const groups=interactionAlternatives(role,state,state.selectedArea)
  if(!state.selectedArea){alternativesBody.append(el('p','','选择触发点后显示分支'));return}
  const key=alternativeKey(state.tool,state.selectedArea),selected=state.alternatives[key]||{}
  for(const g of groups)alternativesBody.append(choiceGrid(g.title,[{id:'',title:'自动'},...g.choices],selected[g.id]??'',id=>{state.alternatives[key]||={};if(id==='')delete state.alternatives[key][g.id];else state.alternatives[key][g.id]=id;save();alternatives()}))
  if(!groups.length)alternativesBody.append(el('p','','此触发点没有额外随机分支'))
  alternativesBody.append(button('触发',()=>triggers.request('selected-alternative',payload(state.selectedArea))))
 }
 function regionBusy(){for(const b of regionsBody.querySelectorAll('[data-region]'))b.disabled=!!role.tools.find(t=>t.id===b.dataset.tool)?.areas.find(a=>a.id===b.dataset.region)?.disabled}
 function choiceGrid(name,choices,value,change){
  const field=el('fieldset','gal-interaction-group'),legend=el('legend','',name),grid=el('div','gal-interaction-options');field.dataset.control=name;field.append(legend,grid)
  for(const c of choices){
   const b=button('',()=>{change(c.id);for(const item of grid.querySelectorAll('button[data-value]')){item.setAttribute('aria-pressed',String(name==='互动方式'?state.enabledTools.includes(item.dataset.value):item.dataset.value===c.id));if(name==='互动方式')item.dataset.current=String(item.dataset.value===state.tool)}});b.dataset.value=c.id;b.title=c.title;b.setAttribute('aria-label',c.title);b.setAttribute('aria-pressed',String(name==='互动方式'?state.enabledTools.includes(c.id):c.id===value));if(name==='互动方式')b.dataset.current=String(c.id===state.tool);b.disabled=!!c.disabled
   const text=el('span','gal-interaction-choice-text',shortInteractionLabel(c.short||c.title));b.append(text)
   if(c.icon){const image=el('img');image.alt='';image.loading='lazy';image.addEventListener('load',()=>{text.hidden=true;b.classList.add('has-icon')});image.addEventListener('error',()=>{image.remove();text.hidden=false;report('图标无法加载：'+c.title)},{once:true});image.src=url(c.icon);b.prepend(image);if(c.title.includes('破损'))b.append(el('span','gal-interaction-choice-badge','破'))}
   if(name==='互动方式'&&c.id){const shell=el('span','gal-interaction-choice-shell');shell.append(b,modeButton('tool',c.id));grid.append(shell)}else grid.append(b)
  }
  return field
 }
 const stopAudio=()=>{const done=voiceDone;voiceDone=null;voiceBusy=false;audioToken++;for(const a of[voice,sound])if(a){a.pause();a.removeAttribute('src');a.load()}voice=sound=null;for(const a of audioEffects)a.pause();audioEffects.clear();done?.()}
 const volume=kind=>volumeGain(kind==='voice'?preferences.voiceVolume:preferences.sfxVolume)
 function paintTextSettings(){speech.style.backgroundColor=`rgba(17,17,17,${preferences.textOpacity})`;speech.style.fontSize=preferences.fontScale+'em'}
 function play(reply,{keepVoice=false}={}){if(keepVoice&&!reply?.voice){lastReply={...reply,voice:voice?lastReply?.voice:undefined};return}stopAudio();const mine=audioToken;lastReply=reply?{...reply,onEnd:undefined}:reply;voiceDone=reply?.onEnd||null;for(const[kind,src]of[['voice',reply?.voice],['sfx',reply?.sound]])if(src){const a=new Audio(url(src));a.volume=volume(kind);if(kind==='voice'){voice=a;voiceBusy=true}else sound=a;const release=()=>{if(kind==='voice'&&mine===audioToken){voiceBusy=false;const done=voiceDone;voiceDone=null;done?.();commands?.advanceVoice();triggers.notify()}};a.addEventListener('ended',release);a.addEventListener('error',()=>{if(mine===audioToken&&!destroyed){report('音频失败：'+src);release()}});a.play().catch(()=>{if(mine===audioToken&&!destroyed){if(visible)report('声音未开始；可点击重播重试');release()}})}}
 function paintBackground(){const src=(role.backgrounds||[]).find(b=>b.id===state.background)?.src;backdrop.style.backgroundImage=src?`url("${url(src)}")`:''}
 async function paint(){
  const token=++renderToken,spec={interaction:{...interactionSpec(role,state,action,serial),visualOverrides:saved.visuals[role.id]||{},meterInitial:saved.meters[role.id]||{},kaijuInitial:saved.kaijuStates[role.characterId||role.id]||{}}},sig=JSON.stringify(spec);loading=true;regionBusy();paintStatus();paintBackground()
  const task=pendingPaint?.sig===sig?pendingPaint:{sig,promise:layers.set(spec)};pendingPaint=task
  try{await task.promise}catch(e){report(String(e.message||e))}finally{if(pendingPaint===task)pendingPaint=null;if(token===renderToken&&!destroyed){loading=false;regionBusy();paintStatus();triggers.notify()}}
 }
 function chooseRole(id){const destination=data.destinations?.find(r=>r.id===id);if(role&&destination&&id!==role.id&&chapter?.select){triggers.stopAll();stopAudio();chapter.select(destination.node);return}triggers.stopAll();layers.set({});stopAudio();role=data.roles.find(r=>r.id===id)||data.roles[0];state=roleState(role,saved[role.id]);resetRegions();action=null;serial++;speech.textContent='';lastReply=null;controls();save();paint()}
 function controls(){
  regions();alternatives();conditionControls();panel.replaceChildren();const allRoles=data.destinations||data.roles,people=[...new Map(allRoles.map(r=>[r.characterId||r.id,{id:r.characterId||r.id,title:r.characterTitle||r.title}])).values()];panel.append(choiceGrid('角色',people,role.characterId||role.id,id=>chooseRole(allRoles.find(r=>(r.characterId||r.id)===id)?.id)));const siblings=allRoles.filter(r=>(r.characterId||r.id)===(role.characterId||role.id)),scenes=[...new Map(siblings.map(r=>[r.sceneId||r.id,{id:r.sceneId||r.id,title:r.sceneTitle||r.title}])).values()];if(scenes.length>1)panel.append(choiceGrid('场景',scenes,role.sceneId||role.id,id=>chooseRole(siblings.find(r=>(r.sceneId||r.id)===id)?.id)));const variants=siblings.filter(r=>(r.sceneId||r.id)===(role.sceneId||role.id));if(variants.length>1)panel.append(choiceGrid(role.variantControl||'姿势',variants,role.id,chooseRole))
  if(role.outfits.length)panel.append(choiceGrid('服装',role.outfits,state.outfit,id=>{triggers.stopAll();stopAudio();speech.textContent='';lastReply=null;state=roleState(role,{...state,outfit:id,values:{}});resetRegions();action=null;serial++;controls();save();paint()}))
  const outfit=role.outfits.find(o=>o.id===state.outfit)
  for(const g of outfit?.groups||[])panel.append(choiceGrid(g.title,g.choices,state.values[g.id],id=>{triggers.stopAll();stopAudio();state.values[g.id]=id;action=null;serial++;save();paint()}))
  if(role.faces.length)panel.append(choiceGrid('表情',[{id:'',title:'默认'},...role.faces],state.face,id=>{state.face=id;save();paint()}))
  if(role.backgrounds?.length)panel.append(choiceGrid('背景',role.backgrounds,state.background,id=>{state.background=id;save();paintBackground()}))
  panel.append(choiceGrid('互动方式',role.tools,state.tool,id=>{const previous=[...(state.enabledAreas||[])];toggleInteractionTool(role,state,id);if(!state.enabledTools.includes(id))for(const t of previous.filter(t=>t.tool===id))closeTarget(t.tool,t.area);resetRegions();regions();alternatives();save();selectionIndicators()}))
  updateModeIndicators()
 }
 function resolveHit(hits){let found=null;const tool=role.tools.find(t=>t.id===state.tool);for(const hit of hits)for(const a of tool?.areas||[])if(a.id===hit)found=hit;return found}
 function perform(p){
  if(p.kind==='replay'){play(p.reply);return}if(p.role!==role.id)return
  if(p.kind==='event-voice'){const request=p.request;if(!request.valid()){request.done();return}eventVoice=request;play({voice:request.src,onEnd:()=>{if(eventVoice===request)eventVoice=null;request.done()}});return}
  if(p.kind==='meter'){commands?.triggerMeter(p.event);return}
  if(p.kind==='off'){action={id:p.area,tool:p.tool,commands:p.commands};serial++;paint();return}
  if(!state.enabledTools.includes(p.tool)||p.selected&&!interactionAreaEnabled(state,p.tool,p.area))return
  const feedback=interactionFeedback(role,state,[p.area],p.tool);if(!feedback||feedback.action.disabled)return
  action={...feedback.action,tool:p.tool};save();serial++;speech.textContent=feedback.reply?.text||'';speech.dataset.reply=feedback.reply?.id||'';stage.dataset.hit=action.id;stage.dataset.tool=p.tool;stage.dataset.motion=action.motion
  if(!commands)play(feedback.reply);flashRegion=action.id;clearTimeout(flashTimer);paintHighlight();flashTimer=setTimeout(()=>{flashRegion='';paintHighlight()},650);paint()
 }
 const stageBinding=triggerBinding(stage),releaseHolds=()=>triggers.stopHolds(),releaseKeys=e=>{if([' ','Enter'].includes(e.key))releaseHolds()},stopForBlur=()=>{triggers.stopAll();commands?.cancel()},stopForHidden=()=>{if(document.hidden){triggers.stopAll();layers.setPaused(true);commands?.cancel();stopAudio()}else layers.setPaused(!visible)};window.addEventListener('keyup',releaseKeys);document.addEventListener('visibilitychange',stopForHidden);window.addEventListener('pointerup',releaseHolds);window.addEventListener('pointercancel',releaseHolds);window.addEventListener('blur',stopForBlur)
 stage.addEventListener('pointermove',e=>{stage.style.cursor=!loading&&role.tools.find(t=>t.id===state.tool)?.areas.some(a=>layers.hitTest('interaction',e.clientX,e.clientY,role.hitAreas).includes(a.id))?'pointer':'default'})
 const up=button('↑ 列表',()=>chapter?.up?.()),back=button('返回',()=>chapter?.back?.()),settings=button('设置',()=>{settingsPanel.open=!settingsPanel.open}),replay=button('重播',()=>{if(lastReply)triggers.request('replay',{kind:'replay',reply:lastReply})}),reset=button('重置角色',()=>{saved[role.id]={};chooseRole(role.id)}),diag=el('details','gal-interaction-diag'),summary=el('summary','','诊断'),details=el('pre');diag.append(summary,details);diag.addEventListener('toggle',()=>{details.textContent=[...errors].join('\n')||'无错误'})
 up.disabled=!chapter?.up;back.disabled=!chapter?.back;bar.append(up,back,settings,replay,reset)
 if(onDetails)bar.append(button('详情',()=>onDetails()))
 if(onToggleImmersive)bar.append(button('沉浸',()=>onToggleImmersive()))
 bar.append(button('全屏',()=>{if(document.fullscreenElement===root)document.exitFullscreen?.();else root.requestFullscreen?.().catch(()=>{})}))
 const more=el('details','gal-interaction-more'),moreTitle=el('summary','','更多'),moreBody=el('div','gal-interaction-more-body');more.append(moreTitle,moreBody);bar.append(more)
 const stopTriggers=button('停止触发',()=>triggers.stopAll());stopTriggers.disabled=true;bar.append(stopTriggers)
 function slider(title,key,min,max,step,scale=1,unit=''){const label=el('label','gal-interaction-more-field'),text=el('span','',title),range=el('input'),value=el('output');range.type='range';range.min=min;range.max=max;range.step=step;range.value=preferences[key]*scale;range.setAttribute('aria-label',title);const update=()=>{value.textContent=Number(range.value).toFixed(step<1?1:0)+unit};update();range.addEventListener('input',()=>{preferences[key]=Number(range.value)/scale;persist();update();paintTextSettings();if(voice)voice.volume=volume('voice');if(sound)sound.volume=volume('sfx');for(const a of audioEffects)a.volume=volume('sfx');commands?.setVolume();triggers.reschedule()});label.append(text,range,value);moreBody.append(label)}
 slider('触发间隔','interval',.2,10,.1,.001,' 秒');slider('文本背景不透明度','textOpacity',0,100,1,100,'%');slider('文字大小','fontScale',60,200,1,100,'%');slider('语音音量','voiceVolume',0,100,1,100,'%');slider('音效音量','sfxVolume',0,100,1,100,'%')
 const waitLabel=el('label','gal-interaction-more-field'),wait=el('input');wait.type='checkbox';wait.checked=preferences.waitVoice;wait.setAttribute('aria-label','语音结束再触发');wait.addEventListener('change',()=>{preferences.waitVoice=wait.checked;persist();triggers.notify()});waitLabel.append(wait,el('span','','语音结束再触发'));moreBody.append(waitLabel,el('p','','模式：1 单次；↻ 点击后重复，再点停止；▥ 按住重复。区域模式可覆盖当前互动的默认模式。'))
 paintTextSettings()
 stage.append(backdrop,world,speech,choices);viewport.append(stage,rail);moreBody.append(diag);root.append(viewport,bar);container.replaceChildren(root)
 const observer=new ResizeObserver(()=>{viewport.style.setProperty('--gal-interaction-height',stage.clientHeight+'px');if(role&&!destroyed)paint()});observer.observe(stage)
 const visibility=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);layers.setPaused(!visible);if(!visible){triggers.stopAll();stopAudio()}});visibility.observe(root)
 root.tabIndex=0;root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.fullscreenElement)onEscape?.()})
 chooseRole(data.initialRole||saved.role)
 return{destroy(){persist();destroyed=true;triggers.destroy();stageBinding();window.removeEventListener('keyup',releaseKeys);document.removeEventListener('visibilitychange',stopForHidden);window.removeEventListener('pointerup',releaseHolds);window.removeEventListener('pointercancel',releaseHolds);window.removeEventListener('blur',stopForBlur);clearTimeout(flashTimer);highlight.destroy();renderToken++;observer.disconnect();visibility.disconnect();stopAudio();layers.destroy();root.remove()},next(){},prev(){},setImmersive(v){root.classList.toggle('is-immersive',!!v)},get index(){return 0},get total(){return 1},get choices(){return{}},ratio:()=>0}
}
