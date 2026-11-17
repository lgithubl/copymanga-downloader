import{alternativeKey}from'./gal-interaction-alternatives.js'
// Declarative UI state, kept outside ordinary dialogue progress.
export function roleState(role,saved={}){
 saved=saved&&typeof saved==='object'?saved:{}
 const enabledTools=[...new Set((Array.isArray(saved.enabledTools)?saved.enabledTools:[saved.tool]).filter(id=>role.tools.some(t=>t.id===id&&!t.disabled)))]
 const enabledAreas=(Array.isArray(saved.enabledAreas)?saved.enabledAreas:[]).filter((v,i,a)=>v&&enabledTools.includes(v.tool)&&role.tools.find(t=>t.id===v.tool)?.areas.some(x=>x.id===v.area&&!x.disabled)&&a.findIndex(x=>x.tool===v.tool&&x.area===v.area)===i).map(v=>({tool:v.tool,area:v.area}))
 const outfit=role.outfits.find(o=>o.id===saved.outfit)||role.outfits[0],values={}
 for(const g of outfit?.groups||[])values[g.id]=g.choices.some(c=>!c.disabled&&c.id===saved.values?.[g.id])?saved.values[g.id]:(g.choices.find(c=>!c.disabled&&c.id===g.default)||g.choices.find(c=>!c.disabled))?.id
 return{background:(role.backgrounds||[]).some(b=>b.id===saved.background)?saved.background:role.backgrounds?.[0]?.id||'',outfit:outfit?.id||'',values,face:role.faces.some(f=>f.id===saved.face)?saved.face:'',selectedArea:typeof saved.selectedArea==='string'?saved.selectedArea:'',alternatives:saved.alternatives&&typeof saved.alternatives==='object'?saved.alternatives:{},enabledTools,enabledAreas,tool:enabledTools.includes(saved.tool)?saved.tool:enabledTools.at(-1)||'',replies:{}}
}
export function interactionSpec(role,state,action=null,serial=0){
 const outfit=role.outfits.find(o=>o.id===state.outfit),variables={},motionGroups={...role.model.motionGroups},configurationCommands=[]
 for(const g of outfit?.groups||[]){const c=g.choices.find(c=>c.id===state.values[g.id]);Object.assign(variables,c?.variables||{});Object.assign(motionGroups,c?.motionGroups||{});configurationCommands.push(...c?.commands||[])}
 const face=role.faces.find(f=>f.id===state.face);if(face)motionGroups[face.layer]=face.id
 if(action?.motion)motionGroups[action.layer]=action.motion
 return{...role.model,variables,motionGroups,configurationCommands,actionCommands:action?.commands,alternativeSelections:state.alternatives?.[alternativeKey(action?.tool||state.tool,action?.id)]||{},motionToken:serial}
}
export function interactionFeedback(role,state,hits,toolId=state.tool){
 const tool=role.tools.find(t=>t.id===toolId);let action=null
 // Native dbsm iterates hit results then declared areas; the last match wins.
 for(const id of hits)for(const area of tool?.areas||[])if(area.id===id)action=area
 if(!action)return null
 const selected=state.alternatives?.[alternativeKey(tool.id,action.id)]||{},matches=tool.areas.filter(a=>a.id===action.id);if(selected.action!==undefined&&matches[Number(selected.action)])action=matches[Number(selected.action)]
 const index=selected.reply!==undefined&&action.replies[Number(selected.reply)]?Number(selected.reply):state.replies[tool.id]||0,reply=action.replies[index%Math.max(1,action.replies.length)]||null;state.replies[tool.id]=(index+1)%Math.max(1,action.replies.length)
 return{action,reply}
}

export function interactionRegions(role,state){
 const tool=role.tools.find(t=>t.id===state.tool),known=new Set(role.hitAreas.map(a=>a.id));return[...new Set((tool?.areas||[]).map(a=>a.id))].filter(id=>known.has(id)||tool.areas.some(a=>a.id===id&&a.buttonOnly)).map((id,i)=>({id,disabled:tool.areas.find(a=>a.id===id)?.disabled,title:role.hitAreas.find(a=>a.id===id)?.title||tool.areas.find(a=>a.id===id)?.title||'区域 '+(/(\d+)$/.exec(id)?.[1]||i+1)}))
}

// Activation order selects the current tool; turning one off keeps the others enabled.
export function toggleInteractionTool(role,state,id){
 if(!role.tools.some(t=>t.id===id&&!t.disabled))return false
 const previous=state.tool,enabled=state.enabledTools||(state.enabledTools=state.tool?[state.tool]:[]),index=enabled.indexOf(id)
 if(index>=0&&state.tool!==id){state.tool=id;state.selectedArea=[...(state.enabledAreas||[])].reverse().find(v=>v.tool===id)?.area||'';return true}
 if(index>=0){enabled.splice(index,1);state.enabledAreas=(state.enabledAreas||[]).filter(v=>v.tool!==id);state.tool=enabled.at(-1)||''}else{enabled.push(id);state.tool=id}
 state.selectedArea=[...(state.enabledAreas||[])].reverse().find(v=>v.tool===state.tool)?.area||'';return previous!==state.tool
}

export const interactionAreaEnabled=(state,tool,area)=>(state.enabledAreas||[]).some(v=>v.tool===tool&&v.area===area)
export function toggleInteractionArea(role,state,tool,area){
 if(!role.tools.find(t=>t.id===tool&&!t.disabled)?.areas.some(a=>a.id===area&&!a.disabled))return null
 const enabled=state.enabledAreas||(state.enabledAreas=[]),index=enabled.findIndex(v=>v.tool===tool&&v.area===area)
 if(index>=0&&!(state.tool===tool&&state.selectedArea===area)){state.tool=tool;state.selectedArea=area;return'focus'}
 if(index>=0){enabled.splice(index,1);const next=enabled.at(-1);state.tool=next?.tool||state.tool;state.selectedArea=next?.area||'';return'off'}
 if(!state.enabledTools.includes(tool))state.enabledTools.push(tool)
 enabled.push({tool,area});state.tool=tool;state.selectedArea=area;return'on'
}
