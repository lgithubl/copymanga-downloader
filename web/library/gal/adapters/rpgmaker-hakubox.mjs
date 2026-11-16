import{hakuboxAdventure}from'./rpgmaker-hakubox-adventure.mjs'
export{hakuboxAdventure}from'./rpgmaker-hakubox-adventure.mjs'
import{readFile,stat}from'node:fs/promises'
import path from'node:path'
// Declarative Hakubox commands; never load or execute game plugin JavaScript.
const actors={kana:{file:'kana_tachie/kana-tachie',skins:['clothes-01','face-05'],scale:1},chinatsu:{file:'chinatsu_tachie/chinatsu-tachie',skins:['clothes-s-04','face-01'],scale:.55},yuki:{file:'yuki_tachie/yuki-tachie',skins:['clothes-01','face-02'],scale:.48},ere:{file:'ere_tachie/ere-tachie',skins:['clothes_01','clothes_a1','face_a0','face_01'],scale:.9}}
const spines={...Object.fromEntries(Object.entries(actors).map(([k,v])=>[k+'Tachie',v])),sleep:{file:'sleep/sleep',skins:[],scale:.4,anim:'sleep'},kanaInteract:{file:'kana_interact/jianai',skins:['01'],scale:.84,anim:'idle_xx'},kanaYobai:{file:'kana_yobai/kana-yobai',skins:[],scale:.84,anim:''},kanaBath:{file:'kana_bath/xizao',skins:['2'],scale:.67,anim:'idle1'},kanaBath_nobg:{file:'kana_bath_nobg/xizao_nobg',skins:['2'],scale:.67,anim:'idle1'}}
const array=v=>{if(Array.isArray(v))return v;try{const a=JSON.parse(v||'[]');return Array.isArray(a)?a:[]}catch{return[]}},first=v=>String(v||'').split(',')[0]
export async function prepareHakubox(ctx,{mediaDir,root=''}){
 ctx.hakuboxTextures={};if(!mediaDir||!ctx.plugins?.some(p=>p.name==='Hakubox_Core'))return
 for(const s of Object.values(spines)){
  const rel=[root,'spine',s.file+'.atlas'].filter(Boolean).join('/'),file=path.resolve(mediaDir,rel);let text
  try{const st=await stat(file);if(st.size>1024*1024)throw Error('Hakubox atlas metadata exceeds1MiB');text=await readFile(file,'utf8')}catch(e){if(e.code==='ENOENT')continue;throw e}
  const pages=[...text.replace(/\r/g,'').matchAll(/(?:^|\n\n)([^\n]+\.(?:png|jpe?g))\n/g)].map(m=>m[1]);const mapping={}
  for(const[i,page]of pages.entries()){const name=s.file+(i?'_'+(i+1):'')+'.png',src=[root,'spine',name].filter(Boolean).join('/');if(!ctx.files.has(src)){ctx.warnings.push('Hakubox native preload image absent: '+src);continue}mapping[page]=src}
  ctx.hakuboxTextures[s.file]=mapping
 }
}
export function hakuboxCommands({ctx,emit,raw,resource,audio,stage}){
 const enabled=ctx.plugins?.some(p=>p.name==='Hakubox_Core'),states=new Map(),bgLayers=new Map();let serial=0
 const picture=(name,layer='bg',fade=0)=>{emit({op:'overlayOff',prefix:'rpg-hakubox:'+layer+':'});const names=Array.isArray(name)?name:name?[name]:[];bgLayers.set(layer,names);for(const[n,item]of names.entries()){const src=resource('img/pictures',item);if(src)emit({op:'overlay',slot:'rpg-hakubox:'+layer+':'+n,kind:layer==='bg'?'background':'still',src,stage,under:true,z:(layer==='bg'?-1000:-900)+n,fit:'contain',fade,cg:!/^bg\//i.test(item)})}}
 const paint=(key,state,extra={})=>{if(!state.visible){emit({op:'spineOff',slot:'rpg-hakubox:'+key});return}emit({op:'spine',slot:'rpg-hakubox:'+key,skel:resource('spine',state.file,'json'),atlas:resource('spine',state.file,'atlas'),skins:state.skins,...(ctx.hakuboxTextures?.[state.file]?{textureMap:ctx.hakuboxTextures[state.file]}:{}),anim:state.anim||'idle',kind:key.endsWith('Tachie')?'actor':'still',nativePlace:true,place:{x:state.x-stage[0]/2,y:stage[1]/2-state.y,scale:state.scale},stage,loop:state.loop!==false,opacity:state.alpha??1,order:state.order||0,...extra})}
 const show=(key,args={})=>{const source=spines[key];if(!source){raw('hakubox-spine-unknown',{key,args});return}const actor=key.endsWith('Tachie'),location={left:400,center:650,right:900},state={...source,skins:array(args.skinList??args.skin).length?array(args.skinList??args.skin):[...source.skins],anim:args.motion??source.anim??'idle',visible:args.visible!=='false',alpha:Number(args.alpha??1),x:actor?location[args.location]??650:Number(args.x)||0,y:actor?1000:Number(args.y)||0,loop:args.loop!=='false',scale:Number(args.scale)||source.scale,order:Number(args.extraLevel)||0};states.set(key,state);paint(key,state)}
 const command=(name,action,a={})=>{
  if(!enabled||!name.startsWith('Hakubox_'))return false
  if(name==='Hakubox_Config'){
   if(action==='playCV'){audio('voice',{name:a.cvName,folder:'audio/cv',volume:Number(a.cvVolume||100)});return true}
   if(action==='stopCV'){emit({op:'voice',src:''});return true}
  }
  if(name==='Hakubox_Module_Scene'){
   const fade=(Number(a.duration)||0)/60
   if(action==='simpleChangeBackground'){picture(a.img);return true}
   if(action==='changeBackground'){picture(array(a.imgs),'bg',fade);return true}
   if(action==='changeForeground'){picture(array(a.imgs),'fg',fade);return true}
   if(action==='changeBgAndFg'){picture(a.backImg,'bg',fade);picture(a.foreImg,'fg',fade);return true}
   if(action==='loopChangeBackground'){const imgs=array(a.imgs),delay=(Number(a.delay)||30)/60;if(imgs.length){picture(imgs[0]);emit({op:'overlay',slot:'rpg-hakubox:bg:0',kind:'still',cg:true,src:resource('img/pictures',imgs[0]),under:true,z:-1000,stage,fit:'contain',animation:{loop:true,frames:imgs.map(img=>({src:resource('img/pictures',img),seconds:delay}))}})}else raw('hakubox-animation-empty',a);return true}
   if(action==='stopLoopChangeBackground'){const imgs=bgLayers.get('bg')||[];picture(imgs);return true}
   if(action==='resetAllground'||action==='resetBackground'||action==='resetForeground'){raw('hakubox-scene-default-required',{action,args:a});return true}
  }
  if(name==='Hakubox_Module_Spine'&&action==='loadSpine'){show(a.spineName,a);return true}
  if(name==='Hakubox_Module_Tachie'){
   if(action==='showTachie'){show(a.actor+'Tachie',a);return true}
   const face=/^changeFaceBy(Kana|Chinatsu|Yuki|Ere)$/.exec(action),clothes=/^changeClothesBy(Kana|Chinatsu|Yuki|Ere)$/.exec(action)
   if(face||clothes){const actor=(face||clothes)[1].toLowerCase(),key=actor+'Tachie',s=states.get(key);if(!s){raw('hakubox-character-not-on-stage',{actor,action});return true}const index=face?(actor==='ere'?3:1):0,prefix=actor==='ere'?'_':'-';s.skins=[...s.skins];s.skins[index]=(face?'face':'clothes')+prefix+first(a.face||a.clothes);if(actor==='chinatsu'&&clothes)s.skins[0]='clothes-s-'+first(a.clothes);if(face){s.skins.splice(index+1);if(first(a.attach))s.skins.push('face'+prefix+first(a.attach))}paint(key,s);return true}
   if(action==='action_move'){const key=a.actor+'Tachie',s=states.get(key),seconds=Math.max(0,Number(a.duration)||0)/60;if(s){s.x+=Number(a.rx)||0;s.y+=Number(a.ry)||0;paint(key,s,{move:seconds});if(a.isWait==='true'&&seconds)emit({op:'wait',seconds})}else raw('hakubox-character-not-on-stage',a);return true}
   if(action==='action_fadeIn'||action==='action_fadeOut'){const key=a.actor+'Tachie',s=states.get(key),seconds=Math.max(0,Number(a.duration)||0)/60;if(s){s.visible=true;s.alpha=action==='action_fadeIn'?1:0;if(action==='action_fadeOut'){s.x+=Number(a.rx)||0;s.y+=Number(a.ry)||0}paint(key,s,{opacitySeconds:seconds,move:seconds});if(a.isWait==='true'&&seconds)emit({op:'wait',seconds})}else raw('hakubox-character-not-on-stage',a);return true}
   if(action==='action_slideOut'||action==='action_slideIn'){const key=a.actor+'Tachie',s=states.get(key);if(s){s.visible=/In$/.test(action);s.alpha=s.visible?1:0;paint(key,s)}else raw('hakubox-character-not-on-stage',a);return true}
  }
  // Gameplay, gift/relationship bookkeeping, custom script hooks and visual
  // effects need distinct evidence. Preserve their original names and args.
  raw('hakubox-unhandled:'+name+':'+action,a);return true
 }
 const presentation=hakuboxAdventure({enabled,emit,raw,resource,stage})
 command.script=ctx.hakuboxInteraction?(text,active=true)=>{if(ctx.hakuboxInteraction&&/^SpineManager\.(?:setMotion|addMotion)\((?:SceneManager\._scene|_scene)\.spineInteract,\s*['"][^'"]+['"],\s*(?:true|false),\s*\d+\);?$/.test(text.trim())){if(active)emit({op:'interactionSpineSource',source:text.trim()});return true}if(!enabled||!/(?:_scene\.tachie|_scene\.(?:updateTachie|showSexAction)|Utils_Tachie\.startAction)/.test(text))return false;if(active)emit({op:'interactionPresentation',source:text});return true}:presentation
 command.condition=presentation.condition;return command
}
