import{open,stat}from'node:fs/promises'
const sources=new Map(),streams=new Map(),MAX=128*1024*1024
async function raw(file,offset,size){const f=await open(file,'r');try{const out=Buffer.alloc(size);let at=0;while(at<size){const r=await f.read(out,at,size-at,offset+at);if(!r.bytesRead)throw Error('Unity source truncated');at+=r.bytesRead}return out}finally{await f.close()}}
function keyStream(key,size){const cacheKey=key.toString('hex')+':'+size;if(streams.has(cacheKey))return streams.get(cacheKey);const state=Uint8Array.from({length:256},(_,i)=>i),out=Buffer.alloc(size);let j=0;for(let i=0;i<256;i++){j=(j+state[i]+key[i%key.length])&255;[state[i],state[j]]=[state[j],state[i]]}let i=0;j=0;for(let n=0;n<size;n++){i=(i+1)&255;j=(j+state[i])&255;[state[i],state[j]]=[state[j],state[i]];out[n]=state[(state[i]+state[j])&255]}streams.set(cacheKey,out);while(streams.size>16)streams.delete(streams.keys().next().value);return out}
// SENS stores a bounded independent RC4 stream per block and a40-byte footer.
// Reads use logical offsets; the original encrypted files remain unchanged.
export async function unitySource(file){
 const st=await stat(file),key=file+'|'+st.size+'|'+st.mtimeMs;let entry=sources.get(key);if(entry)return entry
 const promise=(async()=>{let footer=null;if(st.size>=40){const b=await raw(file,st.size-40,40);if(b.toString('ascii',0,4)==='SENS'){const size=Number(b.readBigUInt64LE(32)),blockSize=b.readUInt32LE(20),blocks=Number(b.readBigUInt64LE(24));if(!Number.isSafeInteger(size)||size+40!==st.size||blockSize<256||blockSize>1024*1024||blocks!==Math.ceil(size/blockSize))throw Error('Unity SENS footer invalid');footer={size,blockSize,stream:keyStream(b.subarray(4,20),blockSize)}}
 }
 const size=footer?.size??st.size;return{size,encrypted:!!footer,async read(offset,count){if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(count)||offset<0||count<0||count>MAX||offset+count>size)throw Error('Unity source range invalid');const out=await raw(file,offset,count);if(footer)for(let i=0;i<count;i++)out[i]^=footer.stream[(offset+i)%footer.blockSize];return out}}
 })();sources.set(key,promise);while(sources.size>128)sources.delete(sources.keys().next().value);promise.catch(()=>sources.delete(key));return promise
}
