// Structured plugin data is decoded as JSON; embedded game JavaScript never runs.
export function structValue(value, depth=0){
 if(depth>8)return value
 if(typeof value==='string'){
  let text=value.trim();if(!text)return value
  for(let i=0;i<3;i++){try{const decoded=JSON.parse(text);return structValue(decoded,depth+1)}catch{if(text.includes('\\"'))text=text.replace(/\\"/g,'"');else break}}
  return value
 }
 if(Array.isArray(value))return value.slice(0,10000).map(v=>structValue(v,depth+1))
 return value
}
export function pluginData(ctx,name,key){const p=ctx.plugins?.find(p=>p.name===name);const value=structValue(p?.parameters?.[key]||'[]');return Array.isArray(value)?value:[]}
export function eventEvidence(list){
 let text=0;const pictures=[],calls=[]
 for(const c of list||[]){const p=c.parameters||[]
  if(c.code===357){
   const [plugin,action,,args={}]=p
   if(plugin==='LogDisplayPlugin'&&['setNewText','addToText'].includes(action)&&args.text)text++
   if(plugin==='PictureCallCommon'&&action==='ADD_PICTURE_EVENT'&&Number(args.commonEventId)>0)calls.push(Number(args.commonEventId))
  }
 }
 return {text,pictures,calls}
}
