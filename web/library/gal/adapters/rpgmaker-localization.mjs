// DKTools dictionaries are data. Never load or execute the game's JS plugins.
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {structValue} from './rpgmaker-plugins.mjs'
export async function prepareLocalization({plugins,options,files,texts,mediaDir,root,warnings}) {
 const plugin=plugins.find(p=>p.name.split('/').at(-1)==='DKTools_Localization')
 if(!plugin)return text=>String(text??'')
 const p=plugin.parameters||{},languages=structValue(p.Languages||'[]')
 const language=String(options.localization.language||(Array.isArray(languages)?languages.find(l=>l.Primary===true||l.Primary==='true')?.Locale:'')||'en')
 const folder=String(p['Localization Folder']||'locales').replace(/\/+$/,'')
 if(!/^[\w-]+$/.test(language)||folder.startsWith('/')||folder.includes('\\')||folder.split('/').includes('..'))throw Error('RPG localization path invalid')
 const prefix=[root,folder,language].filter(Boolean).join('/')+'/',dictionary=Object.create(null)
 let bytes=0
 for(const rel of [...files].sort())if(rel.startsWith(prefix)&&/\.json$/i.test(rel)&&!rel.slice(prefix.length).includes('/')){
  const text=texts[rel]??(mediaDir?await readFile(path.join(mediaDir,...rel.split('/')),'utf8'):'')
  bytes+=Buffer.byteLength(text);if(bytes>64*1048576)throw Error('RPG localization exceeds64MB')
  const data=JSON.parse(text.replace(/^\uFEFF/,''));for(const [key,value]of Object.entries(data))if(!Object.hasOwn(dictionary,key))dictionary[key]=value
 }
 if(!Object.keys(dictionary).length)warnings.push('DKTools language dictionary missing: '+prefix)
 const missing=new Set(),depth=Math.min(8,Math.max(1,Number(p['Parse Depth'])||2))
 return value=>{
  let text=String(value??'')
  for(let i=0;i<depth;i++){
   const next=text.replace(/(?<!\\)\{([^{}]+)\}/g,(tag,key)=>{
    const result=Object.hasOwn(dictionary,key)?dictionary[key]:key.split('.').reduce((v,k)=>v&&Object.hasOwn(v,k)?v[k]:undefined,dictionary)
    if(typeof result==='string')return result
    if(/^[\w.-]+$/.test(key)&&!missing.has(key)&&missing.size<30){missing.add(key);warnings.push('DKTools unresolved text: '+key)}return tag
   });if(next===text)break;text=next
  }return text
 }
}
