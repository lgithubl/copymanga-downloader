import{kaijuList}from'./kaiju-data.mjs'
// Only normalize references against this skeleton. No fuzzy search across actors/models.
export function resolveKaijuSlots(model,input){
 const names=model.slots.map(s=>s.name),exact=new Set(names),folded=new Map();for(const n of names){const k=n.toLowerCase();folded.set(k,[...(folded.get(k)||[]),n])}
 const one=n=>exact.has(n)?n:folded.get(n.toLowerCase())?.length===1?folded.get(n.toLowerCase())[0]:null,result=[],missing=[],normalized=[]
 for(const source of kaijuList(input)){
  let resolved=one(source),parts
  if(resolved)parts=[resolved]
  else{const split=source.split(/[\s/]+/).filter(Boolean);if(split.length>1&&split.every(n=>one(n)))parts=split.map(one)}
  if(!parts){const tokens=source.toLowerCase().split('_').sort().join('_'),matches=names.filter(n=>n.toLowerCase().split('_').sort().join('_')===tokens);if(matches.length===1)parts=matches}
  if(parts){result.push(...parts);if(parts.length!==1||parts[0]!==source)normalized.push({source,names:parts})}else missing.push(source)
 }
 return{names:[...new Set(result)],missing,normalized}
}
export function kaijuAudioPath(media,name,language='ja'){
 const key=String(name||'').replaceAll('{0}',language).toLowerCase();return media['sound/'+key]||media['sound/'+language+'/'+key]||''
}
export function kaijuEventSounds(model,ctx,mode='hcgsoundexcelentity'){
 if(mode==='hcgsoundexcelentity'&&!model.hcgSoundEvents)return{}
 const result={},rows=ctx.tables[mode]||[],language=ctx.options?.voiceLanguage||ctx.voiceLanguage||'ja'
 for(const name of model.events||[]){const row=rows.find(r=>r.EventName===name&&!r.SoundFlag);if(!row)continue
  const missing=[],resolve=value=>kaijuList(value).map(n=>{const src=kaijuAudioPath(ctx.media,n,language);if(!src)missing.push(n);return src}).filter(Boolean),sounds=resolve(row.SoundID),voices=resolve(row.VoiceID)
  result[name]={sounds,voices,...(missing.length?{missing}:{})}
 }
 return result
}
// Keep small facial/hair details readable without loading every outfit atlas at CG resolution.
export function kaijuPageTextureSize(modelName,pageText){
 if(/hcg/i.test(modelName))return 4096
 if(/stand/i.test(modelName))return 2048
 return /\n[^:\n]*(?:Hair|Head|Face)[^:\n]*\n/i.test(pageText)?2048:1024
}

// DramaAction.PlayerChangeSkinList uses DEFAULT_SKIN_STRING when no save is loaded.
// Keep table order and native combination replacements, then intersect this model.
export function kaijuDefaultStandSkins(tables,model){
 const rows=tables.dressstandexcelentity||[],items=['Hair_Long','Clothe_Kaiju','Underwear_Kaiju'],selected=items.map(item=>rows.find(r=>r.ItemName===item&&r.IsInside!=='TRUE')).filter(Boolean),clothed=selected.some(r=>r.Type==='Clothe'&&r.SkinType!=='None');
 let skins=selected.flatMap(r=>kaijuList((clothed&&r.Type==='Underwear'?rows.find(i=>i.IsInside==='TRUE'&&i.SkinType===r.SkinType):null)?.OpenSkinNames||r.OpenSkinNames));
 const combinations=(tables.spineskincombinexcelentity||[]).filter(r=>r.SpineType==='Stand'&&kaijuList(r.ConditionSkins).length&&kaijuList(r.ConditionSkins).every(n=>skins.includes(n)));
 for(const row of combinations)skins=[...skins.filter(n=>!kaijuList(row.ConditionSkins).includes(n)),...kaijuList(row.CombinedSkin)];
 if(!skins.some(n=>n==='HairStyle/Hair_B_Long'||n==='HairStyle/Hair_B_Short'))skins.push('HairStyle/Hair_B_Long');
 return['default',...new Set(skins.filter(n=>model.skins.includes(n)))];
}

// The loading pose can be offscreen or a close-up, so it is not the full-frame
// camera reference. Prefer the authored neutral overview within this CG instance.
export function kaijuCgOverview(events,index){
 const first=events[index],initial=(first.args[6]||100)/100,candidates=[];let turn=0
 if(Math.abs(first.args[4]||0)<=10000&&Math.abs(first.args[5]||0)<=10000)candidates.push(initial)
 for(let i=index+1;i<events.length&&events[i].op!==43;i++){
  const e=events[i],p=e.args;if(e.op===45)turn=(p[2]||0)/100
  if(e.op===46&&Math.abs(turn)<1&&Math.abs(p[0]||0)<=100&&Math.abs(p[1]||0)<=100&&p[2]>0)candidates.push(p[2]/100)
 }
 return candidates.length?Math.min(...candidates):initial
}
