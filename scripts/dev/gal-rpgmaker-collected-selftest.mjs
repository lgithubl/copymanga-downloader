// Optional real collection integration: all collected media, never runs game JS.
import {test,before,after} from 'node:test'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {mkdtemp,readdir,readFile,stat} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createGalHandler} from '../../web/library/types/gal.mjs'
import {generateTags} from '../tag-scripts/gal-layout/main.js'
import {enigmaIndex,findPackedRpg} from '../tag-scripts/gal-layout/evb.mjs'
async function walk(root,rel=''){const out=[];for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){const p=path.posix.join(rel,e.name);if(e.isDirectory())out.push(...await walk(root,p));else if(/\.(png|ogg|rpgmvp|rpgmvo)$/i.test(p))out.push(p)}return out}
let browser,page
before(async()=>{if(process.env.PLAYWRIGHT_PATH){const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});page=await browser.newPage()}})
after(async()=>{await browser?.close()})
const packed='.cache/rpg-packed-063854/sparse',restored='.cache/rpg-packed-063854/restored'
const games=[{id:'RJ01220265',source:packed,samples:restored,expected:11,packed:true},{id:'RJ01282923',source:'.cache/rpg-new-rj-062425/extracted/g02',expected:7},{id:'RJ01402662',source:'.cache/rpg-new-rj-062425/extracted/g03',expected:6}]
for(const g of games)test(`${g.id}: real layout, catalog, all sampled encrypted images/audio through resource and thumbnail endpoints`,{skip:!existsSync(g.source)},async()=>{
 const source=path.resolve(g.source),dataDir=await mkdtemp(path.join(os.tmpdir(),'rpg-collected-')),before=await stat(source)
 const handler=createGalHandler({dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})})
 const imported=await handler.importFromSource({sourcePath:source,options:{adapters:['rpgmaker-json']}}),item=imported.items[0],id=item.itemId
 const layout=await generateTags({type:'gal',item,script:{version:'2.51.0',options:{}},tags:[]}),cfg=layout.itemPatch.gal.config
 assert.ok(cfg.scriptCount>0);assert.equal(cfg.adapterOptions['rpgmaker-json'].packedExe||'',g.packed?'HypnosisNTR.exe':'')
 await handler.patchItemMetadata(id,layout.itemPatch)
 const home=await handler.getReaderContent(id,'main');assert.ok(home.node.items.some(n=>n.title==='特殊场景'))
 const samples=await walk(g.samples||g.source);assert.equal(samples.length,g.expected)
 for(const sample of samples){
  const rel=sample.replace(/^www\//,'').replace(/\.rpgmvp$/i,'.png').replace(/\.rpgmvo$/i,'.ogg'),resource=await handler.getResource(id,rel),b=await readFile(resource.file)
  assert.ok(resource.file.startsWith(dataDir)||resource.file.startsWith(source));assert.ok(b.length>32)
  if(rel.endsWith('.png')){assert.equal(b.subarray(1,4).toString(),'PNG',sample);assert.ok(b.readUInt32BE(16)>0&&b.readUInt32BE(20)>0);const thumb=await handler.getResource(id,rel,{width:160});assert.equal(thumb.contentType,'image/webp');assert.ok((await stat(thumb.file)).size>0)}
  else {assert.equal(b.subarray(0,4).toString(),'OggS',sample);if(page){const duration=await page.evaluate(src=>new Promise((resolve,reject)=>{const a=new Audio(),timer=setTimeout(()=>reject(Error('audio metadata timeout')),15000);a.onloadedmetadata=()=>{clearTimeout(timer);resolve(a.duration)};a.onerror=()=>{clearTimeout(timer);reject(Error('audio decode failed'))};a.src=src}),'data:audio/ogg;base64,'+b.toString('base64'));assert.ok(Number.isFinite(duration)&&duration>0,sample)}}
 }
 assert.equal((await stat(source)).mtimeMs,before.mtimeMs,'source directory stays read-only')
 console.log(`${g.id}: ${samples.length} actual resources passed; cache retained at ${dataDir}`)
})
test('packed VFS rejects traversal, absent files and observes source size bounds',{skip:!existsSync(packed)},async()=>{
 const index=await enigmaIndex(path.resolve(packed,'HypnosisNTR.exe'));assert.equal(index.files.size,4200)
 await assert.rejects(index.read('../outside'),/missing/);await assert.rejects(findPackedRpg(packed,'../HypnosisNTR.exe'),/filename/)
 assert.ok([...index.files.values()].every(f=>f.offset+f.stored<=1818266112))
})
