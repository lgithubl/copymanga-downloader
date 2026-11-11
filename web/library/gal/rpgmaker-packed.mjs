import {mkdir,writeFile,rename,stat,realpath} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import path from 'node:path'
import {findPackedRpg} from '../../../scripts/tag-scripts/gal-layout/evb.mjs'
const views=new Map()
export async function packedRpgView(source,exe,cacheDir){
 const index=await findPackedRpg(source,exe);if(!index)throw Error('Packed RPG Maker filesystem not found')
 const key=createHash('sha256').update(index.sig).digest('hex'),root=path.join(cacheDir,key)
 if(views.has(root))return views.get(root)
 const pending=(async()=>{
  const inflight=new Map(),materialize=async rel=>{
   const entry=index.files.get(String(rel).toLowerCase());if(!entry)throw Object.assign(Error('Packed resource missing'),{statusCode:404})
   const target=path.join(root,...entry.rel.split('/'))
   if((await stat(target).catch(()=>null))?.size===entry.size)return target
   if(!inflight.has(target))inflight.set(target,(async()=>{const b=await index.read(entry.rel);await mkdir(path.dirname(target),{recursive:true});const tmp=target+'.'+randomUUID()+'.part';await writeFile(tmp,b);await rename(tmp,target);return target})().finally(()=>inflight.delete(target)))
   return inflight.get(target)
  }
  let bytes=0
  for(const entry of index.files.values())if(/(^|\/)data\/[^/]+\.json$/i.test(entry.rel)||/(^|\/)js\/plugins\.js$/i.test(entry.rel)){
   bytes+=entry.size;if(entry.size>32*1048576||bytes>64*1048576)throw Error('Packed RPG context exceeds limit')
   await materialize(entry.rel)
  }
  await mkdir(root,{recursive:true})
  const real=await realpath(root),find=rels=>{for(const rel of rels){const hit=index.files.get(rel.toLowerCase());if(hit)return hit.rel}return''}
  return {root:real,files:[...index.files.values()].map(e=>e.rel),find,materialize,index}
 })()
 views.set(root,pending);pending.catch(()=>views.delete(root));if(views.size>20)views.delete(views.keys().next().value)
 return pending
}
