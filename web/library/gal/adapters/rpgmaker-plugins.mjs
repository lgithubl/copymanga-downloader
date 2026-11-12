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
   if(((plugin==='LogDisplayPlugin'&&['setNewText','addToText'].includes(action))||(plugin==='LogMessage'&&action==='add'))&&args.text)text++
   if(plugin==='PictureCallCommon'&&action==='ADD_PICTURE_EVENT'&&Number(args.commonEventId)>0)calls.push(Number(args.commonEventId))
  }
 }
 return {text,pictures,calls}
}

// Literal RX-T map-event calls; event pages are selected by their native conditions.
export function mapEventCall(command) {
  const p=command.parameters||[]
  if(command.code===356){const m=/^call_ev\s+(\d+)(?:\s|$)/.exec(String(p[0]||'').trim());return m?Number(m[1]):null}
  if(command.code===357&&String(p[0]).split('/').at(-1)==='RX_T_CallEvent_in_Map'&&p[1]==='callev'&&/^\d+$/.test(String(p[3]?.eventID)))return Number(p[3].eventID)
  return null
}

// A literal replay dispatcher: mutually exclusive ON-switch branches call one
// common event and jump to the same end label. Do not infer arbitrary game JS.
export function replayVariants(list,common){
 const rows=(list||[]).filter(c=>![0,108,408,657].includes(c.code));let at=0
 while(rows[at]?.code===121)at++
 const prelude=rows.slice(0,at),variants=[];let end=null
 while(rows[at]?.code===111){
  const [test,call,jump,close]=rows.slice(at,at+4),p=test.parameters||[]
  if(p[0]!==0||p[2]!==0||call?.code!==117||jump?.code!==119||close?.code!==412||close.indent!==test.indent||call.indent!==test.indent+1||jump.indent!==call.indent||!common?.[Number(call.parameters?.[0])]?.list)return[]
  const label=String(jump.parameters?.[0]||'');if(!label||end!==null&&label!==end)return[];end=label
  variants.push({switchId:Number(p[1]),eventId:Number(call.parameters[0])});at+=4
 }
 if(variants.length<2||variants.length>8||new Set(variants.map(x=>x.switchId)).size!==variants.length||rows[at]?.code!==118||rows[at].parameters?.[0]!==end||at!==rows.length-1)return[]
 if(prelude.some(c=>variants.some(v=>v.switchId>=Number(c.parameters?.[0])&&v.switchId<=Number(c.parameters?.[1]))))return[]
 return variants
}
