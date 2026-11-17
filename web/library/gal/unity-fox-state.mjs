import path from'node:path'
export function foxStateDefaults(data){
 const refs=new Map((data.references?.RefIds||[]).map(r=>[String(r.rid),r])),defaultStates={},stateBounds={}
 for(const ptr of data.allGirlArray||[]){const girl=refs.get(String(ptr.rid))?.data;if(!girl?.name)throw Error('Fox default girl reference missing');for(const p of girl.informationList||[]){const row=refs.get(String(p.rid));if(!row)throw Error('Fox default information reference missing');const d=row.data,key='fox-state:'+girl.name+':'+d.label;if(row.type.class==='IntGirlInfomation'){if(!Number.isFinite(d.data))throw Error('Fox default int invalid');defaultStates[key]=d.data}else if(row.type.class==='ClampFloatGirlInfomation'){const v=d.data;if(![v.inside_v,v.min,v.max].every(Number.isFinite)||v.max<v.min)throw Error('Fox default float invalid');defaultStates[key]=Math.max(v.min,Math.min(v.max,v.inside_v));stateBounds[key]={min:v.min,max:v.max,mode:v.mode}}}}
 return{defaultStates,stateBounds}
}
export async function foxDefaultDatabase(store){
 const file=store.files.get('fox-default-database');if(!file)return{defaultStates:{},stateBounds:{},stateWarnings:['原生初始状态数据库缺失：StreamingAssets/AssetBundle/database/girl']}
 const bundle=await store.bundle(path.resolve(file)),rows=bundle.assets.flatMap(a=>a.objects.filter(o=>o.classId===114)),matches=[]
 for(const o of rows){const d=await store.decode(o);if(Array.isArray(d.allGirlArray)&&d.references)matches.push(d)}
 if(matches.length!==1)throw Error('Fox default state database absent/ambiguous')
 return foxStateDefaults(matches[0])
}
