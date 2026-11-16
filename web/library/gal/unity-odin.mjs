import{UnityReader,monoHeader}from'./unity-io.mjs'

// Data-only reader for Odin's published binary wire format. Never instantiate
// serialized types or run their formatters/callbacks. Format reference:
// github.com/TeamSirenix/odin-serializer (BinaryEntryType/BinaryDataReader).
export function readOdinBinary(bytes){
 const r=new UnityReader(bytes),types=new Map(),u8=()=>{r.need(1);return r.b[r.p++]},i64=()=>{r.need(8);const n=Number(r.b.readBigInt64LE(r.p));r.p+=8;if(!Number.isSafeInteger(n))throw Error('Odin integer precision');return n};let count=0
 const error=message=>Error('Odin @0x'+r.p.toString(16)+': '+message)
 const str=()=>{const wide=u8(),length=r.i();if(wide>1||length<0||length>1048576)throw error('string bounds');const n=length*(wide+1);r.need(n);const value=r.b.toString(wide?'utf16le':'latin1',r.p,r.p+n);r.p+=n;return value}
 const type=()=>{const tag=u8();if(tag===0x2e)return null;if(tag===0x30){const id=r.i();if(!types.has(id))throw error('unknown type ID '+id);return types.get(id)}if(tag!==0x2f)throw error('invalid type tag '+tag);const id=r.i(),name=str();if(types.has(id))throw error('duplicate type ID');types.set(id,name);return name}
 const entry=(depth=0)=>{
  if(depth>96||++count>1000000)throw error('node bounds');const offset=r.p,tag=u8();let name=null,value
  if([1,3].includes(tag)||tag>=9&&tag<=0x2d&&tag%2)name=str()
  if(tag>=1&&tag<=4){const node={type:type(),id:tag<3?r.i():null,fields:{},items:[],offset};while(r.p<r.b.length&&r.b[r.p]!==5){const e=entry(depth+1);if(e.name===null)node.items.push(e.value);else{if(Object.hasOwn(node.fields,e.name))throw error('duplicate field '+e.name);Object.defineProperty(node.fields,e.name,{value:e.value,enumerable:true})}}if(u8()!==5)throw error('missing node end');value=node}
  else if(tag===6){const length=i64();if(length<0||length>200000)throw error('array bounds');value=[];for(let i=0;i<length;i++){const e=entry(depth+1);if(e.name!==null)throw error('named array item');value.push(e.value)}if(u8()!==7)throw error('missing array end')}
  else if(tag===8){const n=r.i(),width=r.i();if(n<0||![1,2,4,8,16].includes(width)||n*width>16*1024*1024)throw error('primitive array bounds');r.need(n*width);value={primitive:width,data:r.b.subarray(r.p,r.p+n*width).toString('hex')};r.p+=n*width}
  else if([9,10].includes(tag))value={reference:r.i()}
  else if([11,12].includes(tag))value={external:r.i()}
  else if([13,14,0x29,0x2a].includes(tag)){r.need(16);value={guid:r.b.subarray(r.p,r.p+16).toString('hex')};r.p+=16}
  else if([15,16].includes(tag)){r.need(1);value=r.b.readInt8(r.p++)}
  else if([17,18].includes(tag))value=u8()
  else if([19,20,21,22,0x25,0x26].includes(tag)){r.need(2);value=tag<21?r.b.readInt16LE(r.p):r.b.readUInt16LE(r.p);r.p+=2}
  else if([23,24].includes(tag))value=r.i()
  else if([25,26].includes(tag))value=r.u()
  else if([27,28].includes(tag))value=i64()
  else if([29,30].includes(tag)){r.need(8);value=Number(r.b.readBigUInt64LE(r.p));r.p+=8;if(!Number.isSafeInteger(value))throw error('integer precision')}
  else if([31,32].includes(tag))value=r.f()
  else if([33,34].includes(tag)){r.need(8);value=r.b.readDoubleLE(r.p);r.p+=8}
  else if([0x27,0x28].includes(tag))value=str()
  else if([0x2b,0x2c].includes(tag)){const b=u8();if(b>1)throw error('boolean bounds');value=!!b}
  else if([0x2d,0x2e].includes(tag))value=null
  else throw error('unsupported entry '+tag)
  return{name,value,offset}
 }
 const out=[];while(r.p<r.b.length&&r.b[r.p]!==0x31)out.push(entry());if(r.p<r.b.length)r.p++;r.end();return out
}
export function readUnityOdin(bytes){
 const h=monoHeader(bytes),r=h.r,format=r.i(),data=r.bytes(),references=r.list(()=>r.ptr(),100000),string=r.str(),prefab=r.ptr(),prefabReferences=r.list(()=>r.ptr()),modifications=r.list(()=>r.str()),nodes=r.list(()=>({name:r.str(),entry:r.i(),data:r.str()}))
 if(format!==0||string||modifications.length||nodes.length||String(prefab.m_PathID)!=='0'||prefabReferences.length)throw Error('Odin non-binary/prefab overrides require explicit support')
 return{...h,r,references,entries:readOdinBinary(data)}
}
export function odinValues(entries){
 const ids=new Map(),scan=v=>{if(!v||typeof v!=='object')return;if(v.id!==null&&v.id!==undefined){if(ids.has(v.id))throw Error('Odin duplicate reference ID');ids.set(v.id,v)}for(const x of Array.isArray(v)?v:Object.values(v))scan(x)};scan(entries)
 const convert=(v,seen=new Set())=>{if(!v||typeof v!=='object')return v;if(Array.isArray(v))return v.map(x=>convert(x,seen));if(Object.hasOwn(v,'external'))return{external:v.external};if(Object.hasOwn(v,'reference')){const n=ids.get(v.reference);if(!n)throw Error('Odin missing internal reference '+v.reference);if(seen.has(n))return{reference:v.reference};return convert(n,seen)}if(!Object.hasOwn(v,'fields'))return v
  const next=new Set(seen);next.add(v);if(/(?:\[\]|Generic\.(?:List|HashSet)`)/.test(v.type||''))return convert(v.items[0]||[],next)
  if(/Generic\.Dictionary`/.test(v.type||''))return Object.fromEntries((v.items[0]||[]).map(pair=>[convert(pair.fields.$k,next),convert(pair.fields.$v,next)]))
  return{$type:String(v.type||'').split(',')[0],$offset:v.offset,...Object.fromEntries(Object.entries(v.fields).map(([k,x])=>[k,convert(x,next)]))}
 }
 return Object.fromEntries(entries.map(e=>[e.name,convert(e.value)]))
}
