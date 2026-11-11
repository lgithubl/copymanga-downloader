// Debonosu PAC: 16-byte header, count × 272-byte records, aligned raw payloads.
// Verified against collected Game/Bgm/Se/Voice PAC tables; no decompressor/runtime.
import {open} from 'node:fs/promises'
export async function readPacIndex(file){
 const handle=await open(file,'r')
 try{
  const {size}=await handle.stat(),head=Buffer.alloc(16);if((await handle.read(head,0,16,0)).bytesRead!==16||!head.subarray(0,4).equals(Buffer.from([0x82,0xcf,0x82,0xad])))throw Error('不是已知 PAC 容器')
  const count=head.readUInt32LE(4),start=Number(head.readBigUInt64LE(8)),bytes=count*272
  if(count>200000||start!==16+bytes||start>size||bytes>64*1024*1024)throw Error('PAC 索引范围无效')
  const table=Buffer.alloc(bytes);let done=0
  while(done<bytes){const r=await handle.read(table,done,bytes-done,16+done);if(!r.bytesRead)throw Error('PAC 索引截断');done+=r.bytesRead}
  const entries=[],seen=new Set()
  for(let i=0;i<count;i++){
   const p=i*272,n=table.readUInt32LE(p+268);if(!n||n>255)throw Error('PAC 文件名长度无效')
   const name=new TextDecoder('shift_jis',{fatal:true}).decode(table.subarray(p,p+n)).replaceAll('\\','/'),offset=start+Number(table.readBigUInt64LE(p+256)),length=table.readUInt32LE(p+264)
   if(name.startsWith('/')||name.split('/').some(v=>!v||v==='.'||v==='..')||!Number.isSafeInteger(offset)||offset+length>size)throw Error('PAC 条目范围或路径无效')
   if(seen.has(name.toLowerCase()))throw Error('PAC 重复条目');seen.add(name.toLowerCase());entries.push({name,offset,size:length})
  }
  return{size,entries}
 }finally{await handle.close()}
}
