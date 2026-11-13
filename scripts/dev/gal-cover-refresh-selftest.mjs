import assert from'node:assert/strict'
import{mkdtemp,mkdir,writeFile,readFile}from'node:fs/promises'
import{existsSync}from'node:fs'
import path from'node:path'
import os from'node:os'
import net from'node:net'
import{spawn}from'node:child_process'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
import{encodePng}from'../tag-scripts/gal-download/png.mjs'
const work=await mkdtemp(path.join(os.tmpdir(),'gal-cover-refresh-')),source=path.join(work,'RJ01402662'),dataDir=path.join(work,'data');await mkdir(path.join(source,'data'),{recursive:true});await mkdir(path.join(source,'js'))
await writeFile(source+'/data/System.json','{}');await writeFile(source+'/data/CommonEvents.json','[null,{"id":1,"name":"story","list":[{"code":401,"parameters":["text"]}]}]');await writeFile(source+'/js/plugins.js','var $plugins=[];')
const red=encodePng(2,2,Buffer.from([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255]),4),blue=encodePng(2,2,Buffer.from([0,0,255,255,0,0,255,255,0,0,255,255,0,0,255,255]),4);await writeFile(source+'/old.png',red);await writeFile(source+'/new.png',blue)
const h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})}),item=(await h.importFromSource({sourcePath:source,options:{adapters:['rpgmaker-json']}})).items[0]
async function layout(cover){const current=await h.internals.readItem(item.itemId),out=await generateTags({item:current,script:{version:'test',options:{overrides:[{path:'*',cover}]}}});await h.patchItemMetadata(item.itemId,out.itemPatch);return h.internals.readItem(item.itemId)}
const old=await layout('~/old.png');assert.deepEqual(await readFile((await h.getThumbnailFile(item.itemId)).file),red)
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`,logs=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)))
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 const first=await fetch(base+old.cover);assert.equal(first.status,200);assert.deepEqual(Buffer.from(await first.arrayBuffer()),red);assert.match(first.headers.get('cache-control'),/max-age=0.*must-revalidate/)
 const changed=await layout('~/new.png');assert.notEqual(changed.cover,old.cover);const second=await fetch(base+changed.cover);assert.equal(second.status,200);assert.deepEqual(Buffer.from(await second.arrayBuffer()),blue)
 const etag=second.headers.get('etag'),notChanged=await fetch(base+changed.cover,{headers:{'if-none-match':etag}});assert.equal(notChanged.status,304)
 await writeFile(source+'/new.png',red);const overwritten=await fetch(base+changed.cover,{headers:{'if-none-match':etag}});assert.equal(overwritten.status,200);assert.deepEqual(Buffer.from(await overwritten.arrayBuffer()),red)
 assert.ok((await h.internals.readItem(item.itemId)).cover.includes('?v='));console.log('PASS real layout override, changed cover URL, revalidation/304, same-path replacement; retained:',work)
}finally{server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
