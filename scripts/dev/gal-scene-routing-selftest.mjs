import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,mkdtemp}from'node:fs/promises'
import{existsSync}from'node:fs'
import os from'node:os'
import path from'node:path'
import{prepare,parse}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{compileRpgEvents}from'../../web/library/gal/adapters/rpgmaker-events.mjs'
import{resolveLayout,generateTags}from'../tag-scripts/gal-layout/main.js'
import{activePath,stateAt}from'../../web/static/gal-engine.js'
import{createGalHandler}from'../../web/library/types/gal.mjs'
const cache=new Map()
async function fixture(id){if(!cache.has(id))cache.set(id,(async()=>{const f=JSON.parse(await readFile('.cache/scene-audit-161/analysis/'+id+'-fixture.json')),options={...resolveLayout('rpgmaker::'+id.toLowerCase()).ruleOverrides['rpgmaker-json'],root:f.root,maps:{enabled:false},catalog:{maps:false,common:false}},ctx=await prepare({options,files:f.files,texts:f.texts,mediaDir:f.source});return{...f,ctx,options}})());return cache.get(id)}
test('all970 native MV map event trees fit the configured adapter context without losing tail maps',async()=>{
 const f=await fixture('RJ328940');assert.equal(f.ctx.maps.size,970);assert.ok(!f.ctx.warnings.some(w=>w.includes('上下文上限')));assert.ok(f.ctx.maps.has('www/data/Map970.json'))
})
test('native MZ SceneId121-1 renders PictureAnimation first CG cell and advances variants',async()=>{
 const f=await fixture('RJ01271506'),scene=parse('',f.ctx,{rel:'data/Map252.json',scene:'event-13-5'}),live=activePath(scene),pictures=live.map(i=>stateAt(scene,i).overlays.find(o=>o.slot==='rpg-picture-2')?.src).filter(Boolean)
 assert.ok(pictures.some(s=>s.endsWith('H001_01.png')),'native first SET_CELL0 advances the displayed _00 resource to _01')
 assert.ok(pictures.some(s=>s.endsWith('H001_02.png')),'next SET_CELL0 advances to _02 instead of retaining the first CG')
 assert.ok(!scene.stats.raw['plugin:triacontane/PictureAnimation'])
})
test('native TE wrapper Map102/event20 exposes actual template story and its CG page',async()=>{
 const f=await fixture('RJ01271506'),event=f.ctx.maps.get('data/Map102.json').events[20];assert.equal(event.pages.length,7,'actual game event inherits the seven Map252 template pages')
 const scene=parse('',f.ctx,{rel:'data/Map102.json',scene:'event-20-5'}),sources=activePath(scene).flatMap(i=>stateAt(scene,i).overlays.map(o=>o.src||''));assert.ok(sources.some(s=>s.endsWith('H001_01.png')))
})
test('native TRN5949/5950/5951 trigger declared voice IDs; real DLC resources resolve and decrypt',async()=>{
 const f=await fixture('RJ01271506'),scene=parse('',f.ctx,{rel:'data/Map252.json',scene:'event-13-3'}),voices=scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='voice')
 for(const id of[5949,5950,5951])assert.ok(voices.some(c=>c.src===`audio/voice/unique/${id}.ogg`))
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'audit-dlc-resource-')),h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:f.source}}})}),item=(await h.importFromSource({sourcePath:f.source,options:{adapters:['rpgmaker-json'],config:{game:{id:'rpgmaker::rj01271506'}}}})).items[0],layout=await generateTags({item,script:{version:'test',options:{}}});await h.patchItemMetadata(item.itemId,layout.itemPatch)
 for(const id of[5949,5950,5951]){const resource=await h.getResource(item.itemId,`audio/voice/unique/${id}.ogg`),bytes=await readFile(resource.file);assert.equal(bytes.toString('ascii',0,4),'OggS')}
 console.log('Native TRN/DLC audio retained:',dataDir)
})
test('actual modified SimpleVoice SE entries use voice playback and audio/se; ordinary effects stay SE',async()=>{
 const f=await fixture('RJ328940'),ctx=f.ctx,commands=[{code:250,parameters:[{name:'_ouka_anosa',volume:90,pitch:100,pan:0}]},{code:250,parameters:[{name:'Book2',volume:80}]},{code:101,parameters:['',0,0,2,'']},{code:401,parameters:['native SE voice classification']}],scene=compileRpgEvents(commands,ctx,{options:ctx.options,scene:'classification'}),out=scene.steps.flatMap(s=>s.commands)
 assert.ok(out.some(c=>c.op==='voice'&&c.src==='audio/se/_ouka_anosa.ogg'));assert.ok(out.some(c=>c.op==='se'&&c.src==='audio/se/Book2.ogg'))
})
test('native MZ catalogue contains the inherited actual-game CG page, with complete caller context',async()=>{
 const f=await fixture('RJ01271506'),options={...f.options,catalog:{maps:true,common:true}},ctx=await prepare({options,files:f.files,texts:f.texts,mediaDir:f.source}),special=ctx.catalogTree.children.find(n=>n.id==='special')
 assert.ok(special?.children.some(n=>n.script==='data/Map102.json::event-20-5'),'actual game wrapper CG is a reachable special entry')
 const node=special.children.find(n=>n.script==='data/Map102.json::event-20-5'),scene=parse('',ctx,{rel:node.script.split('::')[0],scene:node.script.split('::')[1]});assert.ok(activePath(scene).some(i=>stateAt(scene,i).overlays.some(o=>o.src?.endsWith('H001_01.png'))))
 console.log('Native catalogue map groups',ctx.catalogTree.children.find(n=>n.id==='maps')?.children.length,'special entries',special.children.length,'templates',ctx.templateStats)
})
test('TemplateEvent explicit original-page call uses the original event and restores caller context',async()=>{
 const f=await fixture('RJ01271506'),ctx={...f.ctx,templateOrigins:new Map([['102:20',{id:20,pages:[{list:[{code:101,parameters:['',0,0,2,'']},{code:401,parameters:['original page']}]}]}]])},scene=compileRpgEvents([{code:357,parameters:['triacontane/TemplateEvent','CALL_ORIGIN_EVENT','',{pageIndex:'1'}]},{code:101,parameters:['',0,0,2,'']},{code:401,parameters:['caller resumes']}],ctx,{options:ctx.options,eventId:20,pageIndex:4,rel:'data/Map102.json'})
 const texts=activePath(scene).map(i=>stateAt(scene,i).text.map(x=>x.text).join(''));assert.deepEqual(texts,['original page','caller resumes']);assert.ok(!scene.stats.raw['plugin:TemplateEvent'])
})
