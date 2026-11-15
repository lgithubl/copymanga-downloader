// Some files downloaded from the original CDN retain gzip bytes with a .plist
// name. Decode by signature; originals stay read-only. No runtime dependencies.
import {gunzipSync} from 'node:zlib'
import {createHash,randomUUID} from 'node:crypto'
import {readFile,stat,mkdir,writeFile,rename} from 'node:fs/promises'
import path from 'node:path'
export const DJIBRIL_PLIST_MAX_BYTES=4*1024*1024
const gzip=b=>b[0]===0x1f&&b[1]===0x8b
export function decodeDjibrilPlist(bytes){
 if(bytes.length>DJIBRIL_PLIST_MAX_BYTES)throw Error('Djibril plist exceeds4MiB')
 return(gzip(bytes)?gunzipSync(bytes,{maxOutputLength:DJIBRIL_PLIST_MAX_BYTES}):bytes).toString('utf8')
}
export function createDjibrilResourceCache(directory){
 const pending=new Map()
 return async(file,enabled)=>{
  if(!enabled||!file.toLowerCase().endsWith('.plist'))return file
  const info=await stat(file)
  if(info.size>DJIBRIL_PLIST_MAX_BYTES)throw Error('Djibril plist exceeds4MiB: '+file)
  const bytes=await readFile(file);if(!gzip(bytes))return file
  const key=createHash('sha256').update(`v1:${file}:${info.size}:${info.mtimeMs}`).digest('hex'),target=path.join(directory,key.slice(0,2),key+'.plist')
  if((await stat(target).catch(()=>null))?.size)return target
  if(!pending.has(target))pending.set(target,(async()=>{const text=decodeDjibrilPlist(bytes);await mkdir(path.dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.part';await writeFile(temp,text);await rename(temp,target);return target})().finally(()=>pending.delete(target)))
  return pending.get(target)
 }
}
