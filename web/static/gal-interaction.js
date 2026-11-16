import {createInteractionHighlight} from './gal-interaction-highlight.js'
import {createLive2dLayers} from './gal-live2d.js'
import {assetUrl,volumeGain} from './gal-engine.js'
import {roleState,interactionSpec,interactionFeedback,interactionRegions} from './gal-interaction-state.js'
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n}
const icon=(kind)=>{const n=document.createElementNS('http://www.w3.org/2000/svg','svg');n.setAttribute('viewBox','0 0 24 24');n.setAttribute('aria-hidden','true');n.innerHTML=kind==='regions'?'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>':'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>';return n}
export function shortInteractionLabel(title){return String(title).replace(/^(服装|表情|区域|互动|袜子)\s*/,'').replace(/\s*·\s*破损/,'破').replace('完整','整').replace('关闭','关').replace('开启','开').slice(0,3)||'—'}
export function createGalInteraction({container,reader,chapter,onEscape,onToggleImmersive,onDetails,viewKey=''}){
 const data=reader.scene.interaction,root=el('div','gal-player gal-interaction'),viewport=el('div','gal-interaction-view'),stage=el('div','gal-interaction-stage'),backdrop=el('div','gal-interaction-background'),world=el('div','gal-interaction-world'),speech=el('div','gal-interaction-speech'),rail=el('div','gal-interaction-rail'),panel=el('div','gal-interaction-controls'),status=el('div','gal-interaction-status'),bar=el('div','gal-bar'),errors=new Set(data.diagnostics||[])
 const key='copymanga.gal.interaction.'+(viewKey||reader.node?.id||'default')
 let saved={},role,state,action=null,serial=0,destroyed=false,loading=false,visible=true,renderToken=0,audioToken=0,voice=null,sound=null,lastReply=null,pendingPaint=null
 let hoverRegion='',focusRegion='',flashRegion='',flashTimer=0
 try{saved=JSON.parse(localStorage.getItem(key)||'{}');if(!saved||typeof saved!=='object')saved={}}catch{saved={}}
 const persist=()=>{try{localStorage.setItem(key,JSON.stringify(saved))}catch{}}
 const url=src=>assetUrl(reader.resourceBase,src,reader.resourceVersion)
 const save=()=>{saved.role=role.id;saved[role.id]={background:state.background,outfit:state.outfit,values:state.values,face:state.face,tool:state.tool};persist()}
 const report=message=>{errors.add(message);paintStatus()}
 function paintStatus(){status.textContent=loading?'模型加载中…':errors.size?'诊断 '+errors.size+' 项':'选择互动方式，然后点击角色或右侧区域';status.title=[...errors].join('\n')}
 const button=(title,fn)=>{const b=el('button','gal-btn',title);b.type='button';b.addEventListener('click',fn);return b}
 function dock(kind,title,body,openKey){
  const details=el('details','gal-interaction-'+kind),summary=el('summary');summary.title=title;summary.setAttribute('aria-label',title);summary.append(icon(kind));details.append(summary,body)
  details.open=typeof saved[openKey]==='boolean'?saved[openKey]:window.innerWidth>640
  details.addEventListener('toggle',()=>{saved[openKey]=details.open;persist();if(kind==='regions'&&!details.open){hoverRegion=focusRegion='';paintHighlight()}})
  return details
 }
 const regionsBody=el('div','gal-interaction-region-list'),settingsPanel=dock('settings','角色与互动设置',panel,'settingsOpen'),regionsPanel=dock('regions','可触发区域',regionsBody,'regionsOpen');rail.append(settingsPanel,regionsPanel)
 const layers=createLive2dLayers({parent:world,url,onMissing:src=>report('资源缺失：'+src),onError:e=>report('模型解析：'+e.message),onUnavailable:()=>report('WebGL 不可用')})
 const highlight=createInteractionHighlight({parent:world,layers})
 function paintHighlight(){const id=hoverRegion||focusRegion||flashRegion;highlight.set(role?.hitAreas.filter(a=>a.id===id)||[],{pulse:!!flashRegion&&flashRegion===id})}
 function resetRegions(){hoverRegion=focusRegion=flashRegion='';clearTimeout(flashTimer);paintHighlight();stage.style.cursor='default';delete stage.dataset.hit;delete stage.dataset.motion}
 function regions(){
  regionsBody.replaceChildren();const list=interactionRegions(role,state);regionsPanel.querySelector('summary').title='可触发区域'+(list.length?' · '+list.length:'')
  if(!list.length)regionsBody.append(el('p','','选择互动方式后显示触发点'))
  for(const area of list){const b=button(shortInteractionLabel(area.title),()=>trigger([area.id]));b.title=area.title;b.setAttribute('aria-label',area.title);b.dataset.region=area.id;b.disabled=loading
   b.addEventListener('pointerenter',()=>{hoverRegion=area.id;paintHighlight()});b.addEventListener('pointerleave',()=>{if(hoverRegion===area.id){hoverRegion='';paintHighlight()}})
   b.addEventListener('focus',()=>{focusRegion=area.id;paintHighlight()});b.addEventListener('blur',()=>{if(focusRegion===area.id){focusRegion='';paintHighlight()}});regionsBody.append(b)
  }
 }
 function regionBusy(){for(const b of regionsBody.querySelectorAll('button'))b.disabled=loading}
 function choiceGrid(name,choices,value,change){
  const field=el('fieldset','gal-interaction-group'),legend=el('legend','',name),grid=el('div','gal-interaction-options');field.dataset.control=name;field.append(legend,grid)
  for(const c of choices){
   const b=button('',()=>{change(c.id);for(const item of grid.querySelectorAll('button'))item.setAttribute('aria-pressed',String(item.dataset.value===c.id))});b.dataset.value=c.id;b.title=c.title;b.setAttribute('aria-label',c.title);b.setAttribute('aria-pressed',String(c.id===value));b.disabled=!!c.disabled
   const text=el('span','gal-interaction-choice-text',shortInteractionLabel(c.short||c.title));b.append(text)
   if(c.icon){const image=el('img');image.alt='';image.loading='lazy';image.addEventListener('load',()=>{text.hidden=true;b.classList.add('has-icon')});image.addEventListener('error',()=>{image.remove();text.hidden=false;report('图标无法加载：'+c.title)},{once:true});image.src=url(c.icon);b.prepend(image);if(c.title.includes('破损'))b.append(el('span','gal-interaction-choice-badge','破'))}
   grid.append(b)
  }
  return field
 }
 const stopAudio=()=>{audioToken++;for(const a of[voice,sound])if(a){a.pause();a.removeAttribute('src');a.load()}voice=sound=null}
 const volume=kind=>{try{return volumeGain(localStorage.getItem('copymanga.gal.'+kind+'Volume')??.8)}catch{return .64}}
 function play(reply){stopAudio();const mine=audioToken;lastReply=reply;for(const[kind,src]of[['voice',reply?.voice],['sfx',reply?.sound]])if(src){const a=new Audio(url(src));a.volume=volume(kind);a.addEventListener('error',()=>{if(mine===audioToken&&!destroyed)report('音频失败：'+src)});a.play().catch(()=>{if(mine===audioToken&&!destroyed&&visible)report('声音未开始；可点击重播重试')});if(kind==='voice')voice=a;else sound=a}}
 function paintBackground(){const src=(role.backgrounds||[]).find(b=>b.id===state.background)?.src;backdrop.style.backgroundImage=src?`url("${url(src)}")`:''}
 async function paint(){
  const token=++renderToken,spec={interaction:interactionSpec(role,state,action,serial)},sig=JSON.stringify(spec);loading=true;regionBusy();paintStatus();paintBackground()
  const task=pendingPaint?.sig===sig?pendingPaint:{sig,promise:layers.set(spec)};pendingPaint=task
  try{await task.promise}catch(e){report(String(e.message||e))}finally{if(pendingPaint===task)pendingPaint=null;if(token===renderToken&&!destroyed){loading=false;regionBusy();paintStatus()}}
 }
 function chooseRole(id){layers.set({});stopAudio();role=data.roles.find(r=>r.id===id)||data.roles[0];state=roleState(role,saved[role.id]);resetRegions();action=null;serial++;speech.textContent='';lastReply=null;controls();save();paint()}
 function controls(){
  regions();panel.replaceChildren(choiceGrid('角色',data.roles,role.id,chooseRole))
  if(role.outfits.length)panel.append(choiceGrid('服装',role.outfits,state.outfit,id=>{stopAudio();speech.textContent='';lastReply=null;state=roleState(role,{...state,outfit:id,values:{}});resetRegions();action=null;serial++;controls();save();paint()}))
  const outfit=role.outfits.find(o=>o.id===state.outfit)
  for(const g of outfit?.groups||[])panel.append(choiceGrid(g.title,g.choices,state.values[g.id],id=>{state.values[g.id]=id;save();paint()}))
  if(role.faces.length)panel.append(choiceGrid('表情',[{id:'',title:'默认'},...role.faces],state.face,id=>{state.face=id;save();paint()}))
  if(role.backgrounds?.length)panel.append(choiceGrid('背景',role.backgrounds,state.background,id=>{state.background=id;save();paintBackground()}))
  panel.append(choiceGrid('互动方式',[{id:'',title:'不选择'},...role.tools],state.tool,id=>{state.tool=id;resetRegions();regions();action=null;serial++;stopAudio();lastReply=null;speech.textContent='';save();paint()}))
 }
 function trigger(hits){if(loading||destroyed||!visible||!state.tool)return;const feedback=interactionFeedback(role,state,hits);if(!feedback)return;action=feedback.action;serial++;speech.textContent=feedback.reply?.text||'';speech.dataset.reply=feedback.reply?.id||'';stage.dataset.hit=action.id;stage.dataset.motion=action.motion;play(feedback.reply);flashRegion=action.id;clearTimeout(flashTimer);paintHighlight();flashTimer=setTimeout(()=>{flashRegion='';paintHighlight()},650);paint()}
 stage.addEventListener('click',e=>trigger(layers.hitTest('interaction',e.clientX,e.clientY,role.hitAreas)))
 stage.addEventListener('pointermove',e=>{stage.style.cursor=!loading&&role.tools.find(t=>t.id===state.tool)?.areas.some(a=>layers.hitTest('interaction',e.clientX,e.clientY,role.hitAreas).includes(a.id))?'pointer':'default'})
 const up=button('↑ 列表',()=>chapter?.up?.()),back=button('返回',()=>chapter?.back?.()),settings=button('设置',()=>{settingsPanel.open=!settingsPanel.open}),replay=button('重播',()=>play(lastReply)),reset=button('重置角色',()=>{saved[role.id]={};chooseRole(role.id)}),diag=el('details','gal-interaction-diag'),summary=el('summary','','诊断'),details=el('pre');diag.append(summary,details);diag.addEventListener('toggle',()=>{details.textContent=[...errors].join('\n')||'无错误'})
 up.disabled=!chapter?.up;back.disabled=!chapter?.back;bar.append(up,back,settings,replay,reset)
 if(onDetails)bar.append(button('详情',()=>onDetails()))
 if(onToggleImmersive)bar.append(button('沉浸',()=>onToggleImmersive()))
 bar.append(button('全屏',()=>{if(document.fullscreenElement===root)document.exitFullscreen?.();else root.requestFullscreen?.().catch(()=>{})}))
 for(const[kind,title]of[['voice','语音'],['sfx','音效']]){const label=el('label','gal-interaction-field',title),v=el('input');v.type='range';v.min=0;v.max=1;v.step=.05;try{v.value=localStorage.getItem('copymanga.gal.'+kind+'Volume')??.8}catch{v.value=.8}v.setAttribute('aria-label',title+'音量');v.addEventListener('input',()=>{try{localStorage.setItem('copymanga.gal.'+kind+'Volume',v.value)}catch{}const a=kind==='voice'?voice:sound;if(a)a.volume=volumeGain(v.value)});label.append(v);bar.append(label)}
 stage.append(backdrop,world,speech);viewport.append(stage,rail);root.append(viewport,bar,status,diag);container.replaceChildren(root)
 const observer=new ResizeObserver(()=>{viewport.style.setProperty('--gal-interaction-height',stage.clientHeight+'px');if(role&&!destroyed)paint()});observer.observe(stage)
 const visibility=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);layers.setPaused(!visible);if(!visible){voice?.pause();sound?.pause()}});visibility.observe(root)
 root.tabIndex=0;root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.fullscreenElement)onEscape?.()})
 chooseRole(data.initialRole||saved.role)
 return{destroy(){destroyed=true;clearTimeout(flashTimer);highlight.destroy();renderToken++;observer.disconnect();visibility.disconnect();stopAudio();layers.destroy();root.remove()},next(){},prev(){},setImmersive(v){root.classList.toggle('is-immersive',!!v)},get index(){return 0},get total(){return 1},get choices(){return{}},ratio:()=>0}
}
