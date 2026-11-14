// Cocos Creator 2.x exported asset metadata; data only, never evaluate game JS.
// Asset UUID spelling and JsonAsset envelopes are checked against native captures.
const MAX_JSON=32*1024*1024
export function cocosUuid(value){
 const s=String(value??'');if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))return s.toLowerCase()
 if(!/^[0-9a-f]{2}[A-Za-z0-9+/]{20}$/i.test(s))throw Error('Invalid Cocos asset UUID')
 const raw=s.slice(0,2).toLowerCase()+Buffer.from(s.slice(2),'base64').toString('hex');if(raw.length!==32)throw Error('Invalid Cocos compressed UUID')
 return[raw.slice(0,8),raw.slice(8,12),raw.slice(12,16),raw.slice(16,20),raw.slice(20)].join('-')
}
export function cocosJson(value){if(typeof value==='string'){if(Buffer.byteLength(value)>MAX_JSON)throw Error('Cocos JSON exceeds32MiB');return JSON.parse(value.replace(/^\uFEFF/,''))}return value}
export function cocosJsonAsset(value){
 const d=cocosJson(value)
 if(d?.__type__==='cc.JsonAsset'&&typeof d._name==='string'&&d.json&&typeof d.json==='object')return{name:d._name,json:d.json}
 if(!Array.isArray(d)||d.length!==11||!Array.isArray(d[3])||!Array.isArray(d[4])||!Array.isArray(d[5]))throw Error('Unsupported Cocos JsonAsset envelope')
 const matches=[]
 for(const row of d[5]){if(!Array.isArray(row)||!Number.isInteger(row[0]))continue;const layout=d[4][row[0]],type=layout&&d[3][layout[0]];if(type?.[0]!=='cc.JsonAsset')continue
  if(type[1]?.join(',')!=='_name,json'||layout[1]!==0||layout[2]!==1||typeof row[1]!=='string'||!row[2]||typeof row[2]!=='object')throw Error('Unsupported Cocos JsonAsset layout')
  matches.push({name:row[1],json:row[2]})
 }
 if(matches.length!==1)throw Error('Cocos JsonAsset is missing or ambiguous');return matches[0]
}
export function cocosBundleAssets(config,root=''){
 if(!config||!Array.isArray(config.types)||!Array.isArray(config.uuids)||!config.paths||typeof config.paths!=='object')throw Error('Invalid Cocos bundle config')
 const versions={};for(const[k,list]of Object.entries(config.versions||{})){if(!Array.isArray(list)||list.length%2)throw Error('Invalid Cocos version pairs');versions[k]=new Map();for(let i=0;i<list.length;i+=2){if(!/^[a-z0-9]+$/i.test(String(list[i+1])))throw Error('Invalid Cocos version');versions[k].set(String(list[i]),String(list[i+1]))}}
 for(const key of ['importBase','nativeBase'])if(config[key]!==undefined&&!/^[a-zA-Z0-9_-]+$/.test(config[key]))throw Error('Invalid Cocos asset base')
 const entries=[],base=root?root.replace(/\/$/,'')+'/':''
 for(const[index,path]of Object.entries(config.paths)){if(!Array.isArray(path)||typeof path[0]!=='string'||path[0].split('/').some(x=>!x||x==='.'||x==='..')||path[0].includes('\\'))throw Error('Invalid Cocos asset path');const uuid=cocosUuid(config.uuids[index]),revision=versions.import?.get(index);entries.push({index:Number(index),name:path[0],type:config.types[path[1]],uuid,import:base+(config.importBase||'import')+'/'+uuid.slice(0,2)+'/'+uuid+(revision?'.'+revision:'')+'.json',nativeVersion:versions.native?.get(index)||''})}
 return entries
}
