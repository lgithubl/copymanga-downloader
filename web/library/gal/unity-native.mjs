import {readFile,writeFile,mkdir,rename,stat,readdir} from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {UnityStore} from './unity-store.mjs'
import {binaryCatalog,jsonCatalog,catalogBundleRefs} from './unity-addressables.mjs'

// Native Unity files stay read-only. Only small scripts are exported; image and
// audio ranges are decoded on demand through the normal container resource API.
export const UNITY_NATIVE_VERSION=11
const runs=new Map(),recent=new Map(),safe=p=>typeof p==='string'&&p&&!path.isAbsolute(p)&&!p.split(/[\\/]/).some(s=>s==='..')
export function invalidateUnityNative(mediaDir){for(const cache of[runs,recent])for(const k of cache.keys())if(k.startsWith(mediaDir+'|'))cache.delete(k)}
export async function unityNativeIndex(mediaDir,cfg){
 const scope=mediaDir+'|'+cfg.dir+'|'+JSON.stringify(cfg),cached=recent.get(scope);if(cached&&Date.now()-cached.at<20000)return cached.promise
 if(cfg.scan?.length!==1)throw Error('Unity native containers require one Data directory')
 const scan=cfg.scan[0];if(scan!=='.'&&!safe(scan))throw Error('Invalid Unity Data directory')
 const root=path.join(mediaDir,scan),store=await new UnityStore(root).init({extensionlessBundles:cfg.scriptDecoder==='rexex'}),source=[]
 if(cfg.scriptDecoder==='orcx')for(const dir of ['Common','Main'])for(const e of await readdir(path.join(root,'StreamingAssets',dir),{withFileTypes:true}))if((e.isFile()||e.isSymbolicLink())&&e.name.endsWith('.bundle'))store.files.set(dir.toLowerCase()+'/'+e.name.toLowerCase(),path.join(root,'StreamingAssets',dir,e.name))
 const names=[...store.files.values(),...(cfg.scriptDecoder==='celltalk'?[path.join(root,'il2cpp_data','Metadata','global-metadata.dat'),path.join(root,'..','GameAssembly.dll')]:[])].sort();let cursor=0
 await Promise.all(Array.from({length:16},async()=>{for(;;){const i=cursor++;if(i>=names.length)return;const f=names[i],s=await stat(f);source[i]=[f,s.size,s.mtimeMs]}}))
 const sig=createHash('sha256').update(JSON.stringify([UNITY_NATIVE_VERSION,cfg,source])).digest('hex'),key=mediaDir+'|'+cfg.dir+'|'+sig
 if(runs.has(key)){const promise=runs.get(key);recent.set(scope,{at:Date.now(),promise});return promise}
 const promise=(async()=>{
  const map=new Map(),files=[],scripts=[],prefix=cfg.dir+'/res/',resources=new Map()
  const add=(name,descriptor,read)=>{
   if(!safe(name))throw Error('Invalid Unity virtual resource: '+name)
   if(files.length>=(Number(cfg.maxEntries)||200000))throw Error('Unity virtual resource count exceeds configured limit')
   const rel=prefix+name,key=rel.toLowerCase();if(map.has(key))throw Error('Unity resource collision: '+name)
   // Manifest-backed media resolve their real object lazily. Their names must
   // distinguish cache entries even when no physical object offset is known yet.
   const file=descriptor.file||[...store.files.values()][0],hit={rel,file,offset:descriptor.offset||0,size:descriptor.size||0,version:descriptor.identity?sig+':'+createHash('sha256').update(descriptor.identity).digest('hex'):sig,transform:'unity-native',readNative:read};map.set(key,hit);files.push(rel);resources.set(name,rel);return rel
  }
  const object=(name,o)=>add(name,{file:o.asset.file,offset:o.offset,size:o.size},()=>store.media(o))
  const json=(name,data,file)=>add(name,{file},async()=>Buffer.from(JSON.stringify(data)))
  const catalogFile=store.files.get('catalog.bin')||store.files.get('catalog.json')
  const catalog=catalogFile?catalogBundleRefs(catalogFile.endsWith('.bin')?binaryCatalog(await readFile(catalogFile)):jsonCatalog(await readFile(catalogFile,'utf8'))):[]
  const catalogResource=(name,location)=>add(name,{file:store.files.get(location.bundles[0]?.toLowerCase())||catalogFile},async()=>store.media(await store.catalogAsset(location)))
  const api={store,cfg,root,prefix,resources,add,object,json,catalog,catalogResource,scripts}
  if(cfg.scriptDecoder==='naninovel')await (await import('./unity-naninovel.mjs')).indexNaninovel(api)
  else if(cfg.scriptDecoder==='unity-utage')await (await import('./unity-utage.mjs')).indexUtage(api)
  else if(cfg.scriptDecoder==='rpgmaker-unite')await (await import('./unity-unite.mjs')).indexUnite(api)
  else if(cfg.scriptDecoder==='unity-spine-gallery')await (await import('./unity-spine-gallery.mjs')).indexSpineGallery(api)
  else if(cfg.scriptDecoder==='catpaw')await (await import('./unity-catpaw.mjs')).indexCatpaw(api)
  else if(cfg.scriptDecoder==='orcx')await (await import('./unity-orcx.mjs')).indexOrcx(api)
  else if(cfg.scriptDecoder==='rexex')await (await import('./unity-rexex.mjs')).indexRexex(api)
  else if(cfg.scriptDecoder==='celltalk')await (await import('./unity-celltalk.mjs')).indexCellTalk(api)
  else throw Error('Unknown native Unity decoder: '+cfg.scriptDecoder)
  if(!scripts.length)throw Error('Native Unity scene index is empty')
  return{map,files,scripts,sig,store,context:api.context||null}
 })()
 runs.set(key,promise);while(runs.size>8)runs.delete(runs.keys().next().value);promise.catch(()=>runs.delete(key))
 recent.set(scope,{at:Date.now(),promise});while(recent.size>8)recent.delete(recent.keys().next().value);promise.catch(()=>recent.delete(scope))
 // Keep at most one generation per game/config, without evicting other games.
 for(const k of runs.keys())if(k!==key&&k.startsWith(mediaDir+'|'+cfg.dir+'|'))runs.delete(k)
 return promise
}
export async function expandUnityNative(mediaDir,cfg){
 const index=await unityNativeIndex(mediaDir,cfg),out=path.join(mediaDir,cfg.dir),stampFile=path.join(out,'.unity-stamp.json'),report={at:Date.now(),arcs:{native:{scripts:index.scripts.length,res:index.files.length}}}
 let stamp;try{stamp=JSON.parse(await readFile(stampFile,'utf8'))}catch{}
 if(stamp?.sig===index.sig)return report
 const tmp=path.join(out,'.scripts-'+randomUUID());await mkdir(tmp,{recursive:true});let total=0
 try{
  for(const s of index.scripts){if(!safe(s.name))throw Error('Invalid Unity script name');const text=JSON.stringify(s.data);total+=Buffer.byteLength(text);if(total>cfg.maxTotalMB*1024*1024)throw Error('Unity script export budget exceeded');const f=path.join(tmp,s.name);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,text)}
  const target=path.join(out,'script');try{await stat(target);const archive=path.join(out,'cache','script-backups',Date.now()+'-'+randomUUID());await mkdir(path.dirname(archive),{recursive:true});await rename(target,archive)}catch(e){if(e.code!=='ENOENT')throw e}
  await rename(tmp,target)
  if(index.context){const f=path.join(out,'native.json'),t=f+'.'+randomUUID()+'.part';await writeFile(t,JSON.stringify(index.context));await rename(t,f)}
  const st=stampFile+'.'+randomUUID()+'.part';await writeFile(st,JSON.stringify({sig:index.sig,...report}));await rename(st,stampFile)
 }catch(e){e.message='Unity export: '+e.message;throw e}
 return report
}
