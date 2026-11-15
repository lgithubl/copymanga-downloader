// RecollectionModeMZ's data file is a catalog, not executable plugin code.
import {readFile,stat} from 'node:fs/promises'
import path from 'node:path'
const safe=p=>typeof p==='string'&&!p.includes('\\')&&!p.split('/').some(s=>s==='..')&&!path.isAbsolute(p)
export async function prepareRecollection(ctx,{texts,mediaDir,root=''}){
 const plugin=ctx.plugins.find(p=>p.name.split('/').at(-1)==='RecollectionModeMZ');if(!plugin)return
 const filename=plugin.parameters?.recoCgSettingList||'RecollectionModeMZData.json'
 if(!safe(filename)){ctx.warnings.push('RecollectionModeMZ 回想表路径无效');return}
 const rel=[root,'img/system',filename].filter(Boolean).join('/');let text=texts[rel]
 if(!text&&mediaDir){try{const f=path.join(mediaDir,...rel.split('/'));if((await stat(f)).size>2*1024*1024)throw Error('回想表超过2MiB');text=await readFile(f,'utf8')}catch(e){ctx.warnings.push('RecollectionModeMZ 回想表不可读: '+rel+' ('+e.message+')');return}}
 if(!text){ctx.warnings.push('RecollectionModeMZ 缺少回想表: '+rel);return}
 let rows;try{rows=JSON.parse(String(text).replace(/^\uFEFF/,''))}catch{ctx.warnings.push('RecollectionModeMZ 回想表 JSON 无效: '+rel);return}
 if(!Array.isArray(rows)||rows.length>5000)throw Error('RecollectionModeMZ 回想表必须是最多5000项的数组')
 ctx.recollection=new Map();ctx.recollectionMaps=new Set()
 for(const [i,row]of rows.entries()){
  const id=Number(row?.common_event_id);if(!Number.isInteger(id)||!ctx.common[id]?.list){ctx.warnings.push('回想表第'+(i+1)+'项缺少公共事件 '+row?.common_event_id);continue}
  const thumb=String(row.thumbnail||row.pictures?.[0]||'');if(thumb&&!safe(thumb)){ctx.warnings.push('回想表缩略图路径无效: '+i);continue}
  const entry={id,title:String(row.title||`回想 ${i+1}`),thumb:thumb?'img/pictures/'+thumb.replace(/\.png$/i,'')+'.png':''};ctx.recollection.set(id,entry)
  for(const c of ctx.common[id].list)if(c.code===201&&c.parameters?.[0]===0)ctx.recollectionMaps.add(Number(c.parameters[1]))
 }
}
export function recollectionCatalog(ctx){
 if(!ctx.recollection?.size)return null
 const root=ctx.options.root?ctx.options.root+'/':''
 return{id:'special',title:ctx.options.special.label,children:[...ctx.recollection.values()].map(e=>({id:'recollection-'+e.id,title:e.title,thumb:e.thumb?root+e.thumb:'',script:root+'data/CommonEvents.json::common-'+e.id}))}
}
