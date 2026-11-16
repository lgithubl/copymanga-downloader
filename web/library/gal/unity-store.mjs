import {readFile,readdir,stat}from'node:fs/promises'
import {readFileSync}from'node:fs'
import path from'node:path'
import {openUnityAsset,openUnityBundle,readRange,readTextObject,readMonoScript,monoHeader,UnityReader}from'./unity-io.mjs'
import {decodeTree}from'./unity-type-tree.mjs'
import {unityTexturePng,unityAudio,unitySpritePng}from'./unity-media.mjs'
const BUILTINS=JSON.parse(readFileSync(new URL('./unity-builtin-types.json',import.meta.url)))
const BUILTINS_2021=JSON.parse(readFileSync(new URL('./unity-2021-types.json',import.meta.url)))
const BUILTINS_2022=JSON.parse(readFileSync(new URL('./unity-2022-types.json',import.meta.url)))
const safeName=p=>typeof p==='string'&&p&&!p.includes('\\')&&!p.split('/').some(s=>s==='..')&&!path.isAbsolute(p)
export class UnityStore{
 constructor(root){this.root=path.resolve(root);this.assets=new Map();this.bundles=new Map();this.cabs=new Map();this.files=new Map();this.objects=new Map();this.mediaCache=new Map();this.mediaBytes=0}
 async init({extensionlessBundles=false}={}){
  const walk=async(dir,depth)=>{for(const d of await readdir(dir,{withFileTypes:true})){if(d.isDirectory()){if(depth<4&&['StreamingAssets','aa','StandaloneWindows','StandaloneWindows64','Windows'].includes(d.name))await walk(path.join(dir,d.name),depth+1)}else if(extensionlessBundles&&/^(?:asset_[a-z0-9_]+(?:\.manifest)?|data\.unity3d)$/.test(d.name)||d.name==='globalgamemanagers'||/^level\d+$/.test(d.name)||/\.(?:assets|resS|resource|bundle|bin|json)$/.test(d.name)){const f=path.join(dir,d.name),key=d.name.toLowerCase();if(this.files.has(key)&&this.files.get(key)!==f)throw Error('Unity duplicate native filename: '+d.name);this.files.set(key,f)}}};await walk(this.root,0);return this
 }
 async asset(file){if(!path.isAbsolute(file))file=this.files.get(file.toLowerCase());if(!file)throw Error('Unity asset file missing');if(!this.assets.has(file))this.assets.set(file,openUnityAsset(file).then(async a=>{a.kind='plain';if(a.size<=32*1024*1024){const b=await readRange(file,0,a.size);a.object=o=>Promise.resolve(b.subarray(o.offset,o.offset+o.size))}this.attach(a);return a}));return this.assets.get(file)}
 attach(a){a.byId=new Map(a.objects.map(o=>[o.pathId,o]));for(const o of a.objects)o.asset=a;return a}
 async bundle(name){let file=path.isAbsolute(name)?name:this.files.get(name.toLowerCase());if(!file)throw Error('Unity bundle missing: '+name);if(!this.bundles.has(file))this.bundles.set(file,openUnityBundle(file).then(async b=>{b.assets=[];for(const e of b.entries.filter(e=>! /\.(?:resS|resource)$/.test(e.name))){const a=await b.asset(e);a.kind='bundle';a.archive=b;this.attach(a);b.assets.push(a);this.cabs.set(e.name.toLowerCase(),a)}return b}));return this.bundles.get(file)}
 async ptr(asset,ptr){if(!ptr||String(ptr.m_PathID)==='0')return null;let target=asset;if(Number(ptr.m_FileID)!==0){const name=asset.externals[Number(ptr.m_FileID)-1]?.replace(/\\/g,'/').split('/').at(-1);if(!name)throw Error('Unity external reference index invalid');target=this.cabs.get(name.toLowerCase());if(!target&&asset.archive){for(const dep of asset.archive.dependencies||[]){if(this.files.has(dep.toLowerCase()))await this.bundle(dep);target=this.cabs.get(name.toLowerCase());if(target)break}}target ||=await this.asset(name)}const o=target.byId.get(String(ptr.m_PathID));if(!o)throw Error('Unity referenced object absent: '+ptr.m_PathID);return o}
 async data(o){const key=o.asset.file+':'+(o.asset.entry?.name||'')+':'+o.pathId;if(!this.objects.has(key))this.objects.set(key,o.asset.object(o));return this.objects.get(key)}
 async type(o){if(o.classId!==114)return'';const h=monoHeader(await this.data(o)),script=await this.ptr(o.asset,h.script);if(!script)return'';if(script.classId!==115)throw Error('Unity MonoScript reference missing');const t=readMonoScript(await this.data(script));return t.className}
 async decode(o){const data=await this.data(o);if(o.tree)return decodeTree(data,o.tree,{references:o.asset.objects.references,requireEnd:true});if(o.classId===49)return readTextObject(data);if(o.classId===115)return readMonoScript(data);const tree=(o.asset.version.startsWith('2021.')?BUILTINS_2021:o.asset.version.startsWith('2022.')?BUILTINS_2022:o.asset.version.startsWith('6000.')?BUILTINS:{})[o.classId];if(!tree)throw Error('Unity schema missing for class '+o.classId+' version '+o.asset.version);return decodeTree(data,tree,{requireEnd:true})}
 async namedMedia(){const out=[];for(const f of this.files.values()){if(!f.endsWith('.assets'))continue;const a=await this.asset(f);for(const o of a.objects){if(![28,83].includes(o.classId))continue;const d=await this.decode(o);out.push({object:o,name:d.m_Name,data:d,kind:o.classId===28?'image':'audio'})}}return out}
 async resourcePaths(){const a=await this.asset('globalgamemanagers'),manager=a.objects.find(o=>o.classId===147);if(!manager)throw Error('Unity ResourceManager missing');const r=new UnityReader(await this.data(manager)),rows=r.list(()=>({name:r.str(),ptr:r.ptr()}));r.list(()=>{r.ptr();r.list(()=>r.ptr())});r.end();const out=[];for(const row of rows){if(!safeName(row.name))throw Error('Unsafe Unity ResourceManager path');const o=await this.ptr(a,row.ptr);if(o)out.push({name:row.name,object:o})}return out}
 async stream(o,stream){const source=String(stream.path??stream.m_Source??'').replace(/\\/g,'/'),offset=Number(stream.offset??stream.m_Offset),size=Number(stream.size??stream.m_Size);if(!source||source.split('/').includes('..'))throw Error('Unity stream source invalid');const leaf=source.split('/').at(-1)
  if(o.asset.archive){const e=o.asset.archive.entries.find(e=>e.name.toLowerCase()===leaf.toLowerCase());if(!e||offset<0||offset+size>e.size)throw Error('Unity bundle stream missing/outside entry');return o.asset.archive.read(e.offset+offset,size)}
  const file=this.files.get(leaf.toLowerCase());if(!file)throw Error('Unity stream file missing: '+leaf);return readRange(file,offset,size)
 }
 media(o){
  const key=o.asset.file+':'+(o.asset.entry?.name||'')+':'+o.pathId,hit=this.mediaCache.get(key)
  if(hit){this.mediaCache.delete(key);this.mediaCache.set(key,hit);return hit.promise}
  const entry={bytes:0,promise:null};entry.promise=this.decodeMedia(o).then(bytes=>{if(this.mediaCache.get(key)===entry){entry.bytes=bytes.length;this.mediaBytes+=bytes.length;while(this.mediaBytes>64*1024*1024&&this.mediaCache.size){const[k,v]=this.mediaCache.entries().next().value;this.mediaCache.delete(k);this.mediaBytes-=v.bytes}}return bytes},e=>{if(this.mediaCache.get(key)===entry)this.mediaCache.delete(key);throw e});this.mediaCache.set(key,entry)
  while(this.mediaCache.size>64){const[k,v]=this.mediaCache.entries().next().value;this.mediaCache.delete(k);this.mediaBytes-=v.bytes}return entry.promise
 }
 async decodeMedia(o){
  if(o.classId===49){const d=await this.decode(o);return d.bytes||Buffer.from(d.m_Script||'')}
  if(o.classId===28){const t=await this.decode(o),raw=t['image data']?.length?t['image data']:await this.stream(o,t.m_StreamData);return unityTexturePng(t,raw)}
  if(o.classId===83){const t=await this.decode(o);return unityAudio(await this.stream(o,t.m_Resource))}
  if(o.classId===213){const s=await this.decode(o),texture=await this.ptr(o.asset,s.m_RD?.texture);if(!texture)throw Error('Unity sprite texture missing');return unitySpritePng(s,await this.decode(texture),await this.media(texture))}
  throw Error('Unity object is not supported media: '+o.classId)
 }
 async catalogAsset(location){
  if(!location.bundles?.length)throw Error('Unity catalog asset has no local bundle: '+location.key)
  const archive=await this.bundle(location.bundles[0]),wanted=String(location.internal).replace(/\\/g,'/').toLowerCase();archive.dependencies ||=new Set();for(const dep of location.bundles.slice(1))archive.dependencies.add(dep)
  for(const a of archive.assets)for(const o of a.objects.filter(o=>o.classId===142)){
   const d=await this.decode(o),rows=d.m_Container||[];for(const row of rows){if(String(row.first).replace(/\\/g,'/').toLowerCase()!==wanted)continue;try{return await this.ptr(a,row.second.asset)}catch(e){for(const dep of location.bundles.slice(1))await this.bundle(dep);return this.ptr(a,row.second.asset)}}
  }
  throw Error('Unity catalog internal object missing: '+location.internal)
 }
}
