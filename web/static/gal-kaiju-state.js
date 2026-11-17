// Data-only preview of the original H-mode tables; never executes game assemblies.
const list=v=>String(v||'').split(':').filter(Boolean),yes=v=>String(v).toLowerCase()==='true',num=v=>Number(v)||0
const partOf={Mouth:'M',Breast:'B',LeftBreast:'B',RightBreast:'B',Clitoris:'C',Vagina:'V',Ass:'A'}
const attributes={Item_Attr_Lubricating:'Smooth',Item_Attr_Favorability:'Favorability',Item_Attr_Dislike:'Hate'}
export function createKaijuState(config,saved={}){
 const values={...Object.fromEntries(config.meters.map(m=>[m.id,0])),...saved.values},active=new Set(),locks=Object.fromEntries(config.meters.map(m=>[m.id,saved.locks?.[m.id]===true])),clothes={},flags={...saved.flags},sticky=new Set(saved.sticky||[]);let last='',family=config.clothing.find(r=>r.SkinHModeClothe==='Clothe')?.SkinType||''
 const level=id=>Math.max(0,...config.levels.filter(r=>r.HModeLevelType===id&&num(r.TotalExp)<=num(values[id])).map(r=>num(r.Lv))),cap=(id,v)=>Math.max(0,Math.min(1e9,v)),pick=a=>a.length?a[Math.floor(Math.random()*a.length)]:null
 const valueOf=name=>num(values[attributes[name]||name]),isWearing=name=>config.clothing.some(r=>r.SkinType===family&&r.SkinHModeClothe===({InitPanty:'Panty',Bra:'Underwear',Pants:'Panty'}[name]||name)&&clothes[r.SkinID]!==false)
 function cond(row,current,visible){
  const currentLevel=level(partOf[current?.ClickPlace]||'M'),currentIds=new Set(visible.map(r=>r.ActionID))
  if(row.Condi_ClickPlaceLevelOver!==''&&row.Condi_ClickPlaceLevelOver!==undefined&&currentLevel<num(row.Condi_ClickPlaceLevelOver))return false
  if(row.Condi_ClickPlaceLevelUnder!==''&&row.Condi_ClickPlaceLevelUnder!==undefined&&currentLevel>num(row.Condi_ClickPlaceLevelUnder))return false
  if(row.Condi_CurrentAction&&!list(row.Condi_CurrentAction).some(id=>currentIds.has(id)))return false
  if(row.Condi_NotCurrentAction&&list(row.Condi_NotCurrentAction).some(id=>currentIds.has(id)))return false
  if(row.Condi_HasThisEquip&&!visible.some(a=>list(row.Condi_HasThisEquip).some(id=>list(a.NeedEquip).includes(id))))return false
  for(const[key,name]of [['Condi_HasBeenClimax','climax'],['Condi_HasCumed','cum'],['Condi_IsSuperSpermShroom','mushroom'],['Condi_Has2xClimax','double'],['Condi_Has4xClimax','quadruple'],['Condi_Has8xClimax','octuple'],['Condi_Has16xClimax','mega']])if(row[key]!==''&&row[key]!==undefined&&yes(row[key])!==!!flags[name])return false
  for(const key of['Condi_GeneralLevelOver','Condi_GeneralLevelUnder'])if(row[key]){const[name,n]=list(row[key]),actual=valueOf(name);if(key.endsWith('Over')?actual<num(n):actual>num(n))return false}
  if(row.Condi_HasThisCloth){const[name,on]=list(row.Condi_HasThisCloth);if(isWearing(name)!==yes(on))return false}
  if(row.Condi_CumPlace&&!list(row.Condi_CumPlace).some(p=>flags['cum:'+p]))return false
  return true
 }
 function frame(){
  const current=config.actions.find(r=>r.ActionID===last),visible=[...active].map(id=>config.actions.find(r=>r.ActionID===id)).filter(Boolean).filter(a=>a===current||list(a.MultipleActions).includes(current?.ActionID)),hard=visible.some(r=>yes(r.IsHardMode)),skins=new Set(['default','HairStyle/Hair_B_Long']),slots={...config.defaultSlots}
  for(const r of config.clothing.filter(r=>r.SkinType===family)){
   const on=clothes[r.SkinID]!==false,mode=hard?'Lv2':'Lv1'
   for(const name of list(on?r.OpenSkinName:r.CloseOpenSkinName))skins.add(name)
   for(const name of list(r[(on?'Open_':'Close_')+mode+'_Skins']||r[(on?'Open_':'Close_')+'Lv1_Skins']))skins.add(name)
  }
  for(const a of visible){for(const name of list(a.OpenSkins))skins.add(name);for(const name of list(a.CloseSkins))skins.delete(name);for(const name of list(a.OpenSlots))slots[name]=true}
  let emotion=null
  for(const e of config.emotions)if(e.BelongFlag===config.pose&&['Emotion','Special'].includes(e.EmotionFlag)&&cond(e,current,visible)){
   if(e.EmotionFlag==='Emotion')emotion=e
   else{for(const n of list(e.OpenSlots)){slots[n]=true;if(yes(e.SwitchFlag))sticky.add(n)}for(const n of list(e.OpenSkins))skins.add(n)}
  }
  for(const n of sticky)slots[n]=true
  if(emotion){for(const n of list(emotion.OpenSlots))slots[n]=true;for(const n of list(emotion.OpenSkins))skins.add(n)}
  const priority=a=>num(config.priorities?.find(p=>p.ActionMode===config.pose&&p.AnimationID===a.AnimationID)?.Priority),anim=visible.toSorted((a,b)=>priority(a)-priority(b)).at(-1)?.AnimationID||'Act_Idle',spreads={}
  for(const a of visible)for(let i=1;i<=3;i++)if(a['OpenSpread_'+i]){const animation=a['OpenSpread_'+i],model=config.spreads?.find(m=>m.animations.some(v=>v.name===animation));if(model)spreads[i]={...model.spec,anim:animation}}
  return{current,emotion,visible,skins:[...skins].filter(n=>config.modelSkins.includes(n)),slots,anim,spreads}
 }
 function snapshot(){return{locks:{...locks},values:{...values},flags:{...flags},sticky:[...sticky],meters:config.meters.map(m=>({...m,value:num(values[m.id]),level:level(m.id)}))}}
 return{snapshot,frame,lock(id,on){if(Object.hasOwn(locks,id))locks[id]=on===true;return snapshot()},seek(id,fraction){const m=config.meters.find(m=>m.id===id);if(m)values[id]=cap(id,Math.max(0,Math.min(1,Number(fraction)||0))*m.max);return snapshot()},cloth(id,on){const row=config.clothing.find(r=>r.SkinID===id);if(row)family=row.SkinType;clothes[id]=!!on;return frame()},action(id,on=true){
  const row=config.actions.find(r=>r.ActionID===id);if(!row)throw Error('Kaiju original action missing: '+id)
  if(!on){active.delete(id);if(last===id)last=[...active].at(-1)||'';return{frame:frame(),snapshot:snapshot()}}
  active.add(id);last=id
  const before={...values},f0=frame(),currentPart=partOf[row.ClickPlace]||'M',local=config.levels.find(r=>r.HModeLevelType===currentPart&&num(r.Lv)===level(currentPart));let crossings=0
  // The original click GOP applies every compatible active action, including local multipliers.
  for(const a of f0.visible)for(const part of['M','B','C','V','A','Hate','Smooth','Cum']){
   if(locks[part])continue
   const key={Hate:'DislikeExp',Smooth:'LubricatingExp',Cum:'CumExp'}[part]||part+'Exp',rate=config.levels.find(r=>r.HModeLevelType===part&&num(r.Lv)===level(part)),multi=(num(rate?.ValueMultiRate)||100)/100*(part==='Smooth'?(num(local?.LocalSmoothMultiRate)||100)/100:1)
   values[part]=cap(part,num(values[part])+Math.trunc(num(a[key])*multi))
  }
  for(const part of['M','B','C','V','A'])if(Math.floor(num(values[part])/10000)>Math.floor(num(before[part])/10000))crossings++
  if(crossings){flags.climax=true;flags.climaxCount=num(flags.climaxCount)+crossings;for(const[n,k]of[[2,'double'],[3,'quadruple'],[4,'octuple'],[5,'mega']])if(crossings>=n)flags[k]=true}
  let cum=false
  if(!locks.Cum&&num(values.Cum)>=config.cumMax){values.Cum=0;flags.cum=true;flags['cum:'+row.ClickPlace]=true;cum=true}
  const f=frame();if(crossings&&config.modelAnimations.includes('Act_Orgasm'))f.anim='Act_Orgasm'
  const direct=row.ClickPlace==='Mouth'?(list(row.NeedEquip).includes('Tongue')?'Sound_Shallow_Kiss':list(row.NeedEquip).some(id=>id.startsWith('Dick'))?'Sound_BlowJob':list(row.NeedEquip).some(id=>id.startsWith('Hand'))?'Mouth_Hand_Sound':null):['Vagina','Ass'].includes(row.ClickPlace)?list(row.NeedEquip).includes('LoveEgg')?'Sound_Shallow_Egg':list(row.NeedEquip).includes('Vibrator')?'Sound_Shallow_Vibrator':list(row.NeedEquip).some(id=>id.startsWith('Hand'))?'Sound_Shallow_Hand':list(row.NeedEquip).some(id=>id.startsWith('Dick'))?'Sound_Shallow_Dick':null:null,soundFlag=crossings?'Sound_Climax_'+(flags.double?'2x':'1x'):direct,sound=config.sounds?.find(r=>r.ID===soundFlag),voiceId=pick(list(sound?.VoiceID||f.emotion?.SoundIDs)),logs=String(row.LogList||'').split(';'),log=pick(list(logs[Math.min(logs.length-1,level(currentPart))])),text=config.logs[log]||''
  return{frame:f,snapshot:snapshot(),voiceId,soundId:pick(list(sound?.SoundID)),text,crossings,cum}
 }}
}
