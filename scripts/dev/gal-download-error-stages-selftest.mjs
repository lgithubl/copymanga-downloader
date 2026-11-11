import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import {generateTags} from '../tag-scripts/gal-download/main.js'
import {archiveToTmp} from '../tag-scripts/gal-download/archive.mjs'

test('download, extract and write errors have separate reports; extraction failures keep cache and later entries continue',async()=>{
 const dir=await mkdtemp('/tmp/gdl-error-stages-'),root=path.join(dir,'media');await mkdir(root)
 const requests={}
 const server=http.createServer((req,res)=>{requests[req.url]=(requests[req.url]||0)+1;if(req.url==='/a-download'){res.writeHead(503);res.end('unavailable')}else if(req.url==='/b-extract')res.end('UnityFS\0bad header');else res.end('valid file')})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const base=`http://127.0.0.1:${server.address().port}`,task={id:'stage-errors',adapters:['test'],provider:'files',source:{entries:[{url:base+'/a-download',target:'missing.bin'},{url:base+'/b-extract',target:'broken.png',bundle:true},{url:base+'/c-good',target:'good.bin'},{url:base+'/d-write',target:'x'.repeat(240)}]}}
 const run=dryRun=>generateTags({type:'gal',item:{adapters:['test'],source:{path:root}},cacheDir:path.join(dir,'cache'),script:{options:{tasks:[{...task,dryRun}]}}})
 try{
  await run(true)
  const out=await run(false),result=JSON.parse(await readFile(path.join(out.details.runDir,'result.json'))).results[0]
  assert.equal(result.status,'failed')
  assert.deepEqual(result.entries.map(e=>e.status),['download-failed','extract-failed','written','write-failed'])
  assert.deepEqual(result.failureSummary,{download:1,extract:1,write:1})
  const broken=result.entries[1];assert.equal(broken.downloadStatus,'downloaded');assert.equal(broken.extractStatus,'failed');assert.ok(broken.cache);assert.match((await readFile(broken.cache)).toString(),/^UnityFS/)
  assert.equal(await readFile(path.join(root,'good.bin'),'utf8'),'valid file')
  for(const stage of ['download','extract','write']){const report=JSON.parse(await readFile(result.errorFiles[stage]));assert.equal(report.stage,stage);assert.equal(report.errors.length,1);assert.equal(report.errors[0].errorStage,stage)}
  const log=await readFile(out.details.logFile,'utf8');for(const stage of ['download','extract','write'])assert.match(log,new RegExp(stage+'-failed:'))
  assert.equal(result.categoryTotals.downloadFailedBundles,1);assert.equal(result.categoryTotals.extractFailedBundles,1);assert.equal(result.categoryTotals.writeFailedBundles,1)
  const cached=result.entries[1].cache,again=await run(false),second=JSON.parse(await readFile(path.join(again.details.runDir,'result.json'))).results[0]
  assert.equal(requests['/b-extract'],1,'retry extraction from the verified local bundle without another HTTP request')
  assert.equal(requests['/c-good'],1);assert.equal(second.entries[1].cache,cached);assert.equal(second.entries[1].downloadStatus,'cached');assert.equal(second.entries[1].status,'extract-failed')
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await archiveToTmp(dir)}
})
