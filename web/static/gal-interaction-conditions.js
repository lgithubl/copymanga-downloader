// Semantic identities survive recompilation and differ between characters.
export const conditionKey=(role,condition)=>JSON.stringify([role.characterId||role.id,condition.key])
export function interactionConditions(role){
 const found=new Map();for(const c of [...role.model.initialCommands||[],...role.tools.flatMap(t=>t.areas.flatMap(a=>a.commands||[]))])if(c.interactionCondition){const condition=c.interactionCondition,key=conditionKey(role,condition);if(!found.has(key))found.set(key,{...condition,id:key})}
 return[...found.values()]
}
export function conditionValue(role,condition,preferences={}){const key=conditionKey(role,condition),value=preferences.values?.[key];return typeof value==='boolean'?value:preferences.default!==false}
