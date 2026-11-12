// Edoire @ARCH000 archives. Read-only, bounded index/payload access.
import {decodeTextFile} from '../text-decode.mjs'
import {open} from 'node:fs/promises'
import {readUnityFS,readSerialized} from './unity-bundle.mjs'
import {unpackFsb5} from '../../../scripts/tag-scripts/gal-download/fsb5.mjs'
const MAX=64*1024*1024
export async function readEdoIndex(file){
 const f=await open(file,'r')
 try{
  const {size}=await f.stat(),h=Buffer.alloc(23),tail=Buffer.alloc(8)
  if(size<35||(await f.read(h,0,23,0)).bytesRead!==23||h.toString('ascii',0,8)!=='@ARCH000')throw Error('不是 Edoire ARCH000 档案')
  await f.read(tail,0,8,size-8);const start=Number(tail.readBigUInt64LE()),length=size-8-start
  if(!Number.isSafeInteger(start)||start<23||length<4||length>16*1024*1024)throw Error('Edoire 索引范围无效')
  const b=Buffer.alloc(length);let done=0;while(done<length){const r=await f.read(b,done,length-done,start+done);if(!r.bytesRead)throw Error('Edoire 索引截断');done+=r.bytesRead}
  let p=4;const count=b.readUInt32LE();if(count>200000)throw Error('Edoire 条目过多')
  const string=()=>{let n=0,mul=1;for(let j=0;j<5;j++){if(p>=b.length)throw Error('Edoire 字符串截断');const v=b[p++];n+=(v&127)*mul;if(!(v&128)){if(n>4096||p+n>b.length)throw Error('Edoire 名字长度无效');const s=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(p,p+n));p+=n;return s}mul*=128}throw Error('Edoire 字符串长度无效')}
  const entries=[],seen=new Set()
  for(let i=0;i<count;i++){
   const leaf=string();if(p+17>b.length)throw Error('Edoire 记录截断');const offset=Number(b.readBigUInt64LE(p)),bytes=Number(b.readBigUInt64LE(p+8)),flag=b[p+16];p+=17;const dir=string(),name=(dir.replace(/^\//,'')+'/'+leaf).replace(/^\//,'')
   if(!name||name.includes('\\')||name.split('/').some(v=>!v||v==='.'||v==='..')||seen.has(name.toLowerCase()))throw Error('Edoire 条目路径无效或重复')
   if(flag!==78||!Number.isSafeInteger(offset)||!Number.isSafeInteger(bytes)||offset<23||bytes<=0||offset+bytes>start)throw Error('Edoire 条目编码或范围不支持')
   seen.add(name.toLowerCase());const kind=/^(?:src\/.*|!app[^/]+\/[^/]*sc[0-9][^/]*)\.txt$/i.test(name)?'script':/^img\/.*\.bytes$/i.test(name)||/^ogg\/.*\.ogg$/i.test(name)||/^!app[^/]+\/[^/]+\.(?:bytes|ogg)$/i.test(name)?'res':''
   entries.push({name,offset,size:bytes,kind,logical:name.replace(/^img\/(.*)\.bytes$/i,'img/$1.png').replace(/^!app[^/]+\/([^/]+)\.bytes$/i,'img/append/$1.png').replace(/^!app[^/]+\/([^/]+)\.ogg$/i,'ogg/append/$1.ogg')})
  }
  if(p!==b.length)throw Error('Edoire 索引存在未解释尾部')
  return{size,entries}
 }finally{await f.close()}
}
export function edoPayload(bundle,{text=false}={}){
 if(bundle.length>MAX)throw Error('Edoire bundle 超过64MB')
 const out=[];let resource=null,audio=false
 for(const file of readUnityFS(bundle,{maxOutputBytes:MAX})){
  if(/\.(resource|resS)$/.test(file.name)){resource=file.data;continue}
  for(const o of readSerialized(file.data)){
   if(o.classId===83)audio=true
   if(o.classId!==49)continue
   let p=o.start;const n=file.data.readUInt32LE(p);p+=4;if(n>4096||p+n>o.start+o.size)throw Error('Edoire TextAsset 名称截断');const name=file.data.toString('utf8',p,p+n);p=(p+n+3)&~3
   const bytes=file.data.readUInt32LE(p);p+=4;if(bytes>MAX||p+bytes>o.start+o.size)throw Error('Edoire TextAsset 数据截断');out.push({name,bytes:Buffer.from(file.data.subarray(p,p+bytes))})
  }
 }
 if(text){if(out.length!==1)throw Error('Edoire 剧本 TextAsset 不唯一');return decodeTextFile(out[0].bytes).text.replace(/^\uFEFF/,'')}
 if(out.length===1&&out[0].bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return out[0].bytes
 if(audio&&resource){if(resource.subarray(0,4).toString()==='FSB5'){const result=unpackFsb5(resource);if(result.format!=='ogg')throw Error('Edoire AudioClip 非 Vorbis，保留原资源');return result.bytes}if(resource.subarray(0,4).toString()==='OggS')return resource}
 throw Error('Edoire 资源不含唯一PNG/受支持音频')
}
