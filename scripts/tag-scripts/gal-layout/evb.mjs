// Read-only Enigma Virtual Box resource index; no executable/game JS runs.
// Modern table layout: https://github.com/mos9527/evbunpack (format reference).
import { open, stat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
const indexes=new Map()
const safe=p=>p&&!p.split('/').some(s=>!s||s==='.'||s==='..'||/[\\:\0]/.test(s))
export async function enigmaIndex(filename){
 const file=await realpath(filename),info=await stat(file),sig=`${file}:${info.size}:${info.mtimeMs}`
 if(indexes.has(sig))return indexes.get(sig)
 const pending=(async()=>{
  const handle=await open(file,'r')
  const read=async(offset,length)=>{if(offset<0||length<0||offset+length>info.size)throw Error('EVB resource range exceeds file');const b=Buffer.alloc(length);const r=await handle.read(b,0,length,offset);if(r.bytesRead!==length)throw Error('EVB resource truncated');return b}
  try{
   const head=await read(0,Math.min(262144,info.size));if(head.length<64||head.toString('ascii',0,2)!=='MZ')return null
   const pe=head.readUInt32LE(60);if(pe+24>head.length||head.toString('binary',pe,pe+4)!=='PE\0\0')return null
   const count=head.readUInt16LE(pe+6),table=pe+24+head.readUInt16LE(pe+20);let section
   for(let i=0;i<Math.min(count,128);i++){const at=table+i*40;if(at+40>head.length)throw Error('EVB section table outside header');if(head.toString('ascii',at,at+8)==='.enigma1')section={offset:head.readUInt32LE(at+20),size:head.readUInt32LE(at+16)}}
   if(!section)return null
   let magic=-1,overlap=Buffer.alloc(0)
   for(let scanned=0;scanned<Math.min(section.size,16*1048576);){const b=await read(section.offset+scanned,Math.min(1048576,section.size-scanned,16*1048576-scanned)),joined=Buffer.concat([overlap,b]),hit=joined.indexOf(Buffer.from('EVB\0'));if(hit>=0){magic=section.offset+scanned-overlap.length+hit;break}scanned+=b.length;overlap=b.subarray(-3)}
   if(magic<0)throw Error('EVB filesystem marker not found within 16MB')
   const main=await read(magic+64,16),end=magic+68+main.readUInt32LE(0),roots=main.readUInt32LE(12)
   if(end<magic+80||end>section.offset+section.size||end-magic>16*1048576||roots>200000)throw Error('EVB index bounds invalid')
   const bytes=await read(magic,end-magic),files=new Map();let at=79,offset=end,nodes=0
   const take=n=>{if(at+n>bytes.length)throw Error('EVB index truncated');const b=bytes.subarray(at,at+n);at+=n;return b}
   const walk=(parent='',depth=0)=>{
    if(++nodes>200000||depth>64)throw Error('EVB entry/depth limit exceeded')
    const header=take(16),children=header.readUInt32LE(12),letters=[];let ended=false
    for(let i=0;i<2048;i++){const pair=take(2);if(pair.readUInt16LE(0)===0){ended=true;break}letters.push(pair)}
    if(!ended)throw Error('EVB filename too long')
    const name=Buffer.concat(letters).toString('utf16le'),kind=take(1)[0];if(!safe(name))throw Error('EVB unsafe node name')
    const rel=parent?`${parent}/${name}`:name
    if(kind===3){take(25);if(children>200000)throw Error('EVB child count exceeds limit');for(let i=0;i<children;i++)walk(rel,depth+1)}
    else if(kind===2){const record=take(53),size=record.readUInt32LE(2),stored=record.readUInt32LE(49),logical=rel.replace(/^%[^/]+%\//,'');if(!safe(logical)||offset+stored>section.offset+section.size)throw Error('EVB invalid entry');if(files.has(logical.toLowerCase()))throw Error(`EVB duplicate path: ${logical}`);files.set(logical.toLowerCase(),{rel:logical,offset,size,stored});offset+=stored}
    else throw Error(`EVB unsupported node type ${kind}; legacy/compressed layouts require explicit support`)
   }
   for(let i=0;i<roots;i++)walk()
   return {file,sig,files,async read(rel){const entry=files.get(String(rel).toLowerCase());if(!entry)throw Error(`EVB entry missing: ${rel}`);if(entry.size!==entry.stored)throw Error(`EVB compressed entry not supported: ${entry.rel}`);if(entry.size>128*1048576)throw Error('EVB resource exceeds128MB');const fd=await open(file,'r');try{const current=await fd.stat();if(current.size!==info.size||current.mtimeMs!==info.mtimeMs)throw Error('EVB source changed; refresh the game index');const b=Buffer.alloc(entry.size);const r=await fd.read(b,0,b.length,entry.offset);if(r.bytesRead!==b.length)throw Error('EVB entry truncated');return b}finally{await fd.close()}}}
  }finally{await handle.close()}
 })()
 indexes.set(sig,pending);pending.catch(()=>indexes.delete(sig));if(indexes.size>30)indexes.delete(indexes.keys().next().value)
 return pending
}
export async function findPackedRpg(mediaDir,explicit=''){
 const media=await realpath(mediaDir),names=explicit?[explicit]:(await readdir(media)).filter(n=>/\.exe$/i.test(n)).slice(0,30)
 for(const name of names){if(!safe(name)||name.includes('/'))throw Error('packedExe must be a filename in the game root');const absolute=await realpath(path.join(media,name));if(path.dirname(absolute)!==media)throw Error('Packed executable escapes game root');const index=await enigmaIndex(absolute);if(!index)continue
  const system=[...index.files.values()].find(f=>/(^|\/)data\/System\.json$/i.test(f.rel)),root=system?.rel.replace(/data\/System\.json$/i,'').replace(/\/$/,'')
  if(system&&index.files.has(((root?root+'/':'')+'data/commonevents.json').toLowerCase()))return{...index,exe:name,root}
 }
 return null
}
