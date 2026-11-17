// Resolve authored inverse functions only. Similar names alone never create commands.
export function foxToggleEntries(room){
 const names=room.interactions||[],claimed=new Set(),pairs=new Map()
 const candidates=name=>[name+'解除',name+'結束',name+'拔出插入',name.replace(/^揉_?/,'放開_'),name.replace(/^揉_?/,'放開'),name==='摸陰'?'放開_摸陰':'',name.startsWith('舔')?'不'+name:'',...(/插入$/.test(name)?[name.replace(/插入$/,'拔出插入'),name.replace(/插入$/,'插入拔出'),name.replace(/插入$/,'拔出')]:[]),name==='鞭打'?'鞭打2':''].filter(n=>n&&n!==name&&names.includes(n))
 for(const name of names){if(claimed.has(name))continue;const inverse=candidates(name).find(n=>!claimed.has(n));if(inverse&&room.functions[name]&&room.functions[inverse]){pairs.set(name,inverse);claimed.add(name);claimed.add(inverse)}}
 return names.filter(name=>!claimed.has(name)||pairs.has(name)).map(name=>({name,off:pairs.get(name)}))
}
