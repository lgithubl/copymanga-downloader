import{readFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{createContext,Script}from'node:vm'
import path from'node:path'
let runtime;const cache=new Map(),HASH='ed59374359cf9217a87723124f5e87665492b06dae04a7b5e83af0fd18b12db2'
// Reuse the pinned Spine4.2 parser already shipped with the player. This sandbox
// receives only skeleton/atlas bytes: no game JavaScript, modules, files or network.
export async function spineMetadata(bytes,atlas){
 if(bytes.length>32*1024*1024||Buffer.byteLength(atlas)>2*1024*1024)throw Error('Spine metadata input exceeds bounds')
 const key=createHash('sha256').update(bytes).update(atlas).digest('hex');if(cache.has(key))return cache.get(key)
 if(!runtime){const file=process.env.GAL_SPINE_RUNTIME_DIR?path.join(process.env.GAL_SPINE_RUNTIME_DIR,'spine-webgl-4.2.js'):new URL('../../static/vendor/spine-webgl-4.2.js',import.meta.url),source=await readFile(file,'utf8');if(createHash('sha256').update(source).digest('hex')!==HASH)throw Error('Pinned Spine4.2 runtime hash mismatch');const context=createContext({Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,TextDecoder});new Script(source,{filename:'pinned-spine-4.2.js'}).runInContext(context,{timeout:5000});runtime=context}
 runtime.inputBytes=Uint8Array.from(bytes);runtime.inputAtlas=atlas
 try{new Script(`{
 const atlas=new spine.TextureAtlas(inputAtlas);
 for(const page of atlas.pages)page.setTexture({getImage(){return{width:page.width,height:page.height}},setFilters(){},setWraps(){},dispose(){}});
 const loader=new spine.AtlasAttachmentLoader(atlas),parser=inputBytes[0]===123?new spine.SkeletonJson(loader):new spine.SkeletonBinary(loader);
 const data=parser.readSkeletonData(inputBytes[0]===123?JSON.parse(new TextDecoder().decode(inputBytes)):inputBytes);
 output={version:data.version,animations:data.animations.map(a=>({name:a.name,duration:a.duration})),skins:data.skins.map(s=>s.name),width:data.width,height:data.height};
 }`).runInContext(runtime,{timeout:8000});const result=JSON.parse(JSON.stringify(runtime.output));if(!String(result.version).startsWith('4.2.'))throw Error('Spine metadata build is not4.2');cache.set(key,result);while(cache.size>64)cache.delete(cache.keys().next().value);return result}finally{delete runtime.inputBytes;delete runtime.inputAtlas;delete runtime.output}
}
