// Choice discovery is shared by the panel and native command playback.
export const alternativeKey=(tool,area)=>JSON.stringify([tool,area])
export function interactionAlternatives(role,state,areaId){
 const actions=role.tools.find(t=>t.id===state.tool)?.areas.filter(a=>a.id===areaId)||[],selection=state.alternatives?.[alternativeKey(state.tool,areaId)]||{},groups=[]
 if(actions.length>1)groups.push({id:'action',title:'动作分支',choices:actions.map((a,i)=>({id:String(i),title:a.title||a.motion||'动作 '+(i+1)}))})
 const action=actions[Number(Array.isArray(selection.action)?selection.action.at(-1):selection.action)]||actions.at(-1);if(!action)return[]
 if(action.replies?.length)groups.push({id:'reply',title:action.replyTitle||'语音 / 台词',choices:action.replies.map((r,i)=>({id:String(i),short:r.short,title:r.title||r.text||r.voice?.split('/').at(-1)||'反馈 '+(i+1)}))})
 for(const c of action.commands||[])if(c.random&&Array.isArray(c.options))groups.push({id:'choice:'+c.id,title:c.title||'随机分支',choices:c.options.map((o,i)=>({id:String(o.value),title:o.title||o.voice?.split('/').at(-1)||(o.segments||[]).map(s=>s.text||'').join('')||'分支 '+(i+1)}))})
 return groups
}

// Empty selection keeps native random/cycling behavior; legacy scalar choices remain valid.
export function alternativePool(options,selected,key=o=>String(o.value)){
 const values=(Array.isArray(selected)?selected:selected===undefined?[]:[selected]).map(String),pool=options.filter(o=>values.includes(key(o)));return pool.length?pool:options
}
export function pickAlternative(options,selected){const pool=alternativePool(options,selected);return pool[Math.floor(Math.random()*pool.length)]}
