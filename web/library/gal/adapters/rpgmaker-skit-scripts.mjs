// A finite translator for CommonEventExtend + TRP Skit presentation wrappers.
// It recognizes complete statements only. No eval, JS interpreter, or game code.
export function skitScriptScope({id,arguments:input,emit,initial,conditional,skit,actors}) {
 const locals=new Map(),args=[...input]
 const local=name=>{if(!locals.has(name)){const item={var:`${id}:${name}`,values:new Set()};locals.set(name,item);initial.set(item.var,'')}return locals.get(name)}
 const literal=text=>{try{const value=JSON.parse(text);return ['string','number','boolean'].includes(typeof value)?{value}:null}catch{return null}}
 const reference=text=>{const m=/^this\._(\w+)$/.exec(text.trim());return m?local(m[1]):null}
 const assignment=(name,value,when=[])=>{const item=local(name);item.values.add(value);emit({op:'set',var:item.var,value,when})}
 return text=>{
  text=String(text).trim()
  if(/^this\._arguments\.shift\(\)\s*;?$/.test(text)){args.shift();return true}
  const assignments=[...text.matchAll(/this\._(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)\s*;/g)]
  if(assignments.length&&text.replace(/this\._(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)\s*;/g,'').trim()===''){
   for(const m of assignments)assignment(m[1],JSON.parse(m[2]));return true
  }
  const select=/^switch\s*\(this\._arguments\[(\d+)\]\)\s*\{([\s\S]*)\}$/.exec(text)
  if(select){
   const source=args[Number(select[1])];if(!source)return false
   const cases=[...select[2].matchAll(/case\s+(-?\d+):\s*this\._(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?);\s*break;/g)]
   const fallback=/default:\s*this\._(\w+)\s*=\s*this\._arguments\[(\d+)\]\s*\/\s*(\d+(?:\.\d+)?)\s*;?/.exec(select[2])
   let rest=select[2].replace(/case\s+(-?\d+):\s*this\._(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?);\s*break;/g,'')
   if(fallback)rest=rest.replace(fallback[0],'')
   if(rest.trim()||!cases.length||cases.length>32||fallback&&(!args[Number(fallback[2])]||Number(fallback[3])<=0))return false
   for(const m of cases)assignment(m[2],JSON.parse(m[3]),[{var:source,op:'===',value:Number(m[1])}])
   if(fallback){const target=local(fallback[1]),when=cases.map(m=>({var:source,op:'!==',value:Number(m[1])}));emit({op:'set',var:target.var,valueVar:args[Number(fallback[2])],when});emit({op:'set',var:target.var,calc:'mul',value:1/Number(fallback[3]),when})}
   return true
  }
  const command=/^\$gameSkit\.processCommand\(\[([^\]]*)\]\)\s*;?$/.exec(text)
  if(!command)return false
  const tokens=command[1].split(',').map(t=>t.trim());if(tokens.length<2||tokens.length>4)return false
  const values=tokens.map(t=>literal(t)||reference(t));if(values.some(v=>!v))return false
  const candidates=(value,allowed)=>value.var?[...value.values].filter(x=>allowed(x)):allowed(value.value)?[value.value]:[]
  const actions=candidates(values[0],x=>['pose','fadein','movein','slidein','show','hide','fadeout','moveout','slideout','clear','end'].includes(String(x).toLowerCase()))
  const names=candidates(values[1],x=>actors.has(String(x)))
  if(!actions.length||!names.length)return false
  for(const action of actions)for(const name of names){
   const when=[...(values[0].var?[{var:values[0].var,op:'===',value:action}]:[]),...(values[1].var?[{var:values[1].var,op:'===',value:name}]:[])]
   const value=values[3],args={name,...(action==='pose'?(value?.var?{poseVar:value.var}:{pose:value?.value}):(value?.var?{positionVar:value.var}:{position:value?.value}))}
   conditional(when,()=>skit(action,args))
  }
  return true
 }
}
