// Rebuild read-only archive fixtures from exact captured byte ranges. Sparse holes
// are intentionally NOT test media: display tests request only captured entries.
import{open,mkdir,readFile,writeFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import path from'node:path'
export async function makeFuyuEdoFixture({target='.cache/fuyu-edo-fixtures',videoSource='.cache/fuyu-edo-video/extracted',bgmSource='.cache/fuyu-edo-bgm/extracted',followupSource='.cache/fuyu-edo-followup/extracted'}={}){
 const captures=[['.cache/fuyu-edo-probe/extracted','__engine_probe'],['.cache/fuyu-edo-detail/extracted','__pair_detail'],['.cache/fuyu-edo-media/extracted','__pair_media'],...(videoSource?[[videoSource,'__pair_media']]:[]),...(bgmSource?[[bgmSource,'__pair_media']]:[]),...(followupSource?[[followupSource,'__pair_media']]:[])]
 const roots={g01:path.resolve(target,'fuyukuru'),g02:path.resolve(target,'えどわ～る')};for(const root of Object.values(roots))await mkdir(root,{recursive:true})
 const written=[]
 for(const[base,kind]of captures)for(const gid of Object.keys(roots)){
  let report;try{report=JSON.parse(await readFile(path.join(base,gid,kind,'index.json')))}catch(e){if(e.code==='ENOENT'&&videoSource)continue;throw e}
  for(const item of report.files){if(!/\.arc$/i.test(item.path))continue
   const parts=kind==='__engine_probe'?item.parts:[{...item}],file=path.join(roots[gid],item.path);await mkdir(path.dirname(file),{recursive:true});let handle;try{handle=await open(file,'r+')}catch(e){if(e.code!=='ENOENT')throw e;handle=await open(file,'w+')}
   try{await handle.truncate(item.sourceBytes);for(const part of parts){const data=await readFile(path.join(base,gid,part.name));if(part.sha256&&createHash('sha256').update(data).digest('hex')!==part.sha256)throw Error('Captured source hash mismatch');await handle.write(data,0,data.length,part.offset);written.push({gid,path:item.path,offset:part.offset,bytes:data.length,name:part.name})}}finally{await handle.close()}
  }
 }
 await writeFile(path.join(target,'captured-ranges.json'),JSON.stringify(written,null,2));return{roots,written}
}
