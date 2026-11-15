import {open,stat}from'node:fs/promises'
import path from'node:path'
import {lz4Block}from'./unity-bundle.mjs'
import {serializedObjects,decodeTree}from'./unity-type-tree.mjs'
const MAX=128*1024*1024
export async function readRange(file,offset,size){if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||size>MAX)throw Error('Unity read range invalid');const f=await open(file,'r');try{const st=await f.stat();if(offset+size>st.size)throw Error('Unity range exceeds source');const b=Buffer.alloc(size);let n=0;while(n<size){const r=await f.read(b,n,size-n,offset+n);if(!r.bytesRead)throw Error('Unity source truncated');n+=r.bytesRead}return b}finally{await f.close()}}
export class UnityReader{
 constructor(b,p=0){this.b=b;this.p=p}
 need(n){if(!Number.isSafeInteger(n)||n<0||this.p+n>this.b.length)throw Error('Unity field truncated at '+this.p)}
 i(){this.need(4);const n=this.b.readInt32LE(this.p);this.p+=4;return n}
 u(){return this.i()>>>0}
 f(){this.need(4);const n=this.b.readFloatLE(this.p);this.p+=4;return n}
 align(){this.p=(this.p+3)&~3;this.need(0)}
 bool(){this.need(1);const n=this.b[this.p++];if(n>1)throw Error('Unity boolean invalid');this.align();return !!n}
 str(){const n=this.i();this.need(n);const v=this.b.toString('utf8',this.p,this.p+n);this.p+=n;this.align();return v}
 bytes(){const n=this.i();this.need(n);const v=this.b.subarray(this.p,this.p+n);this.p+=n;this.align();return v}
 ptr(){const m_FileID=this.i();this.need(8);const m_PathID=String(this.b.readBigInt64LE(this.p));this.p+=8;return{m_FileID,m_PathID}}
 list(fn,max=1000000){const n=this.i();if(n<0||n>max)throw Error('Unity array count invalid '+n);return Array.from({length:n},()=>fn(this))}
 end(){if(this.p!==this.b.length)throw Error('Unity unexplained object tail: '+(this.b.length-this.p))}
}
export function monoHeader(data){const r=new UnityReader(data);const gameObject=r.ptr();r.bool();const script=r.ptr(),name=r.str();return{r,gameObject,script,name}}
export function readTextObject(data){const r=new UnityReader(data),name=r.str(),bytes=r.bytes();r.end();return{name,bytes,text:bytes.toString('utf8')}}
export function readMonoScript(data){const r=new UnityReader(data),name=r.str();r.i();r.need(16);r.p+=16;return{name,className:r.str(),namespace:r.str(),assembly:r.str()}}
export async function assetIndex(source,size){const h=await source(0,Math.min(48,size)),v=h.readUInt32BE(8),offset=v>=22?Number(h.readBigUInt64BE(32)):h.readUInt32BE(12);if(!Number.isSafeInteger(offset)||offset<20||offset>64*1024*1024||offset>size)throw Error('Unity metadata bounds invalid');return serializedObjects(await source(0,offset),{fileSize:size,indexOnly:true})}
export async function openUnityAsset(file){const st=await stat(file),read=(offset,size)=>readRange(file,offset,size),objects=await assetIndex(read,st.size);return{file,size:st.size,version:objects.unityVersion,objects,externals:objects.externals,read,object:o=>read(o.offset,o.size)}}
// CABs can share a 100MB+ bundle with streamed media. Read only overlapping LZ4
// blocks; neither startup nor requesting one voice reads every texture/audio blob.
export async function openUnityBundle(file){
 const st=await stat(file),h=await readRange(file,0,Math.min(256,st.size));if(h.toString('ascii',0,7)!=='UnityFS')throw Error('Not UnityFS')
 let p=8;const version=h.readUInt32BE(p);p+=4;for(let i=0;i<2;i++){const end=h.indexOf(0,p);if(end<0)throw Error('UnityFS version string bounds');p=end+1}p+=8;const cs=h.readUInt32BE(p),us=h.readUInt32BE(p+4),flags=h.readUInt32BE(p+8);p+=12;if(version>=7&&(flags&0x200))p=(p+15)&~15
 if(cs>32*1024*1024||us>32*1024*1024)throw Error('UnityFS index exceeds32MiB')
 const compressed=await readRange(file,flags&0x80?st.size-cs:p,cs),compression=flags&63,info=compression===0?compressed:[2,3].includes(compression)?lz4Block(compressed,us):null;if(!info)throw Error('UnityFS index compression '+compression+' unsupported')
 let q=16,n=info.readUInt32BE(q);q+=4;if(n>1000000)throw Error('UnityFS block count exceeds bounds');const blocks=[];let disk=flags&0x80?p:p+cs;if(version>=7&&(flags&0x200)&&!(flags&0x80))disk=(disk+15)&~15;let logical=0
 for(let i=0;i<n;i++){const size=info.readUInt32BE(q),bytes=info.readUInt32BE(q+4),mode=info.readUInt16BE(q+8)&63;q+=10;if(size>32*1024*1024||disk+bytes>st.size)throw Error('UnityFS block bounds invalid');blocks.push({offset:disk,bytes,size,mode,start:logical});disk+=bytes;logical+=size}
 n=info.readUInt32BE(q);q+=4;if(n>200000)throw Error('UnityFS node count exceeds bounds');const entries=[]
 for(let i=0;i<n;i++){const offset=Number(info.readBigUInt64BE(q)),size=Number(info.readBigUInt64BE(q+8));q+=20;const end=info.indexOf(0,q);if(end<0||!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset+size>logical)throw Error('UnityFS directory bounds invalid');const name=info.toString('utf8',q,end);q=end+1;entries.push({offset,size,name})}
 const cache=new Map();const block=async i=>{if(cache.has(i))return cache.get(i);const b=blocks[i],promise=readRange(file,b.offset,b.bytes).then(raw=>b.mode===0?raw:[2,3].includes(b.mode)?lz4Block(raw,b.size):Promise.reject(Error('UnityFS block compression '+b.mode+' unsupported')));cache.set(i,promise);if(cache.size>64)cache.delete(cache.keys().next().value);return promise}
 const read=async(offset,size)=>{if(size>MAX||offset<0||size<0||offset+size>logical)throw Error('UnityFS payload range invalid');const out=Buffer.alloc(size);for(let i=0;i<blocks.length;i++){const b=blocks[i];if(b.start>=offset+size)break;if(b.start+b.size<=offset)continue;const raw=await block(i),from=Math.max(offset,b.start),to=Math.min(offset+size,b.start+b.size);raw.copy(out,from-offset,from-b.start,to-b.start)}return out}
 return{file,size:st.size,entries,blocks,read,async asset(entry){const source=(o,n)=>read(entry.offset+o,n),objects=await assetIndex(source,entry.size);return{file,bundle:true,entry,objects,externals:objects.externals,version:objects.unityVersion,read:source,object:o=>source(o.offset,o.size)}},clear(){cache.clear()}}
}
