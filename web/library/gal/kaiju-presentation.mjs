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
