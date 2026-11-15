// Local Addressables v2 catalogs only. Binary layout follows Unity's
// BinaryContentCatalogData / BinaryStorageBuffer serializers (needle-mirror).
const NONE=0xffffffff
export function jsonCatalog(source){
 const c=typeof source==='string'?JSON.parse(source):source,bucket=Buffer.from(c.m_BucketDataString||'','base64'),keys=Buffer.from(c.m_KeyDataString||'','base64'),data=Buffer.from(c.m_EntryDataString||'','base64'),keyAt=offset=>{
  const tag=keys[offset++];if(tag===0||tag===1){const n=keys.readInt32LE(offset);offset+=4;if(n<0||offset+n>keys.length)throw Error('Addressables JSON key bounds');return keys.toString(tag?'utf16le':'ascii',offset,offset+n)}
  if(tag===2)return keys.readUInt16LE(offset);if(tag===3)return keys.readUInt32LE(offset);if(tag===4)return keys.readInt32LE(offset);if(tag===5){const n=keys[offset];if(offset+1+n>keys.length)throw Error('Addressables JSON hash bounds');return keys.toString('ascii',offset+1,offset+1+n)}throw Error('Addressables JSON key type '+tag)
 }
 const count=bucket.readInt32LE(0),decoded=[],refs=[];if(count<0||count>bucket.length/8)throw Error('Addressables bucket count invalid');let p=4
 for(let i=0;i<count;i++){const at=bucket.readInt32LE(p),n=bucket.readInt32LE(p+4);p+=8;if(n<0||p+n*4>bucket.length)throw Error('Addressables bucket bounds');decoded.push(keyAt(at));refs.push(Array.from({length:n},()=>{const v=bucket.readInt32LE(p);p+=4;return v}))}
 const n=data.readInt32LE(0);if(n<0||4+n*28>data.length)throw Error('Addressables entry bounds');const locations=new Map()
 for(let i=0;i<n;i++){const q=4+i*28,internal=data.readInt32LE(q),dep=data.readInt32LE(q+8),primary=data.readInt32LE(q+20);let identifier=c.m_InternalIds[internal];if(typeof identifier!=='string'||primary<0||primary>=decoded.length||dep>=refs.length)throw Error('Addressables JSON reference bounds');identifier=identifier.replace(/^(\d+)#(.*)$/,(_,i,suffix)=>{if(typeof c.m_InternalIdPrefixes?.[i]!=='string')throw Error('Addressables prefix absent');return c.m_InternalIdPrefixes[i]+suffix});locations.set(i,{id:i,key:decoded[primary],internal:identifier,deps:dep<0?[]:refs[dep]})}
 return{locations}
}
export function binaryCatalog(buffer){
 const u=p=>{if(!Number.isSafeInteger(p)||p<0||p+4>buffer.length)throw Error('Addressables offset out of bounds');return buffer.readUInt32LE(p)},cache=new Map()
 if(u(0)!==0x0de38942||u(4)!==2)throw Error('Unsupported Addressables binary catalog version')
 const string=(id,sep='')=>{if(id===NONE)return'';const ck=id+':'+sep;if(cache.has(ck))return cache.get(ck);let out
  if(sep&&(id&0x40000000)){let at=id,parts=[],seen=new Set();while(at!==NONE){at=at>>>0;if(seen.has(at)||parts.length>10000)throw Error('Addressables dynamic-string cycle');seen.add(at);const p=at&0x3fffffff;parts.push(string(u(p)));at=u(p+4)}out=parts.reverse().join(sep)}
  else{const p=id&0x3fffffff,n=u(p-4);if(n>16*1024*1024||p+n>buffer.length)throw Error('Addressables string size invalid');out=buffer.toString(id&0x80000000?'utf16le':'ascii',p,p+n)}cache.set(ck,out);return out
 }
 const array=(id,stride)=>{if(id===NONE)return[];const bytes=u(id-4);if(bytes%stride||id+bytes>buffer.length||bytes>32*1024*1024)throw Error('Addressables array bounds');return Array.from({length:bytes/stride},(_,i)=>id+i*stride)}
 const locations=new Map(),aliases=new Map()
 const readLocation=id=>{if(locations.has(id))return locations.get(id);const v={id,key:string(u(id),'/'),internal:string(u(id+4),'/'),provider:string(u(id+8),'.'),deps:[]};locations.set(id,v);v.deps=array(u(id+12),4).map(p=>u(p));return v}
 for(const p of array(u(8),8)){
  const keyObject=u(p),set=u(p+4),keys=[]
  try{const remap=u(keyObject+4),sep=String.fromCharCode(buffer.readUInt16LE(remap+4));keys.push(string(u(remap),sep==='\0'?'':sep))}catch{/* Hash128 keys are not filesystem paths. */}
  const refs=array(set,4).map(p=>u(p));for(const id of refs)readLocation(id)
  for(const key of keys)if(key)aliases.set(key,refs)
 }
 for(const v of locations.values())for(const id of v.deps)readLocation(id)
 return {locations,aliases,string}
}
export function catalogBundleRefs(catalog){
 const out=[]
 for(const v of catalog.locations.values()){
  const visited=new Set(),bundles=[];const visit=id=>{if(visited.has(id))return;visited.add(id);const e=catalog.locations.get(id);if(!e)return;if(/\.bundle(?:$|[?#])/i.test(e.internal))bundles.push(e.internal.replace(/\\/g,'/').split('/').at(-1));for(const d of e.deps)visit(d)};visit(v.id)
  out.push({...v,bundles:[...new Set(bundles)]})
 }
 return out
}
