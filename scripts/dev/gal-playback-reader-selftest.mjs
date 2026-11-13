import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{existsSync}from'node:fs'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{activePath,stateAt,initialState,condMet,applyCommand}from'../../web/static/gal-engine.js'
const f=JSON.parse(await readFile('.cache/playback-164/fixtures.json')),h=createGalHandler({dataDir:f.dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:f.work+'/games'}}})}),mz=f.fixtures.find(x=>x.id==='RJ01271506')
test('actual imported map card opens its inherited template page through the public reader',async()=>{
 const list=await h.getReaderContent(mz.itemId,'main',{sectionId:'v:map-102'}),card=list.node.items.find(x=>x.title==='ビスティカブの手料理 · 页3');assert.ok(card,'actual catalogue must expose the requested card')
 const reader=await h.getReaderContent(mz.itemId,'main',{sectionId:card.node});assert.ok(reader.scene);assert.ok(reader.scene.steps.flatMap(s=>s.commands).some(c=>c.op==='voice'&&c.src.endsWith('/5949.ogg')))
 await writeFile('.cache/playback-164/mz-page3-reader.json',JSON.stringify(reader));console.log('Native actual card',card.node,'title',reader.node.title)
})
test('actual imported CG page retains its template CG and native stage through public reader',async()=>{
 const list=await h.getReaderContent(mz.itemId,'main',{sectionId:'v:map-102'}),card=list.node.items.find(x=>x.title==='ビスティカブの手料理 · 页5');assert.ok(card)
 const reader=await h.getReaderContent(mz.itemId,'main',{sectionId:card.node});const live=activePath(reader.scene);assert.ok(live.some(i=>stateAt(reader.scene,i).overlays.some(o=>o.src?.endsWith('H001_01.png'))))
 await writeFile('.cache/playback-164/mz-page5-reader.json',JSON.stringify(reader));console.log('Native actual CG card',card.node,'steps',live.length)
})
test('actual MV EV009 reader offers native party state instead of suppressing recruited companions',async()=>{
 const mv=f.fixtures.find(x=>x.id==='RJ328940');await h.patchItemMetadata(mv.itemId,{gal:{config:{adapterOptions:{'rpgmaker-json':{...mv.config.adapterOptions['rpgmaker-json'],party:{mode:'choose',members:null}}}}}})
 const reader=await h.getReaderContent(mv.itemId,'main',{sectionId:'s:Map402.json::event-9-1'}),scene=reader.scene,choice=scene.steps.flatMap(s=>s.commands).find(c=>c.op==='choice'&&c.var==='rpg:party-mode');assert.ok(choice,'native actor-in-party branches need an explicit replay party selector')
 const all={[choice.id]:1},initial={[choice.id]:2};assert.ok(activePath(scene,all).length>activePath(scene,initial).length+20,'recruited-companion dialogue must remain reachable')
 const count=history=>{const state=initialState();let n=0;for(const step of scene.steps)for(const c of step.commands)if(condMet(c.when,state.vars)){if(['voice','bgvoice'].includes(c.op))n++;applyCommand(state,c,history)}return n};assert.equal(count(all),17);assert.equal(count(initial),5);assert.ok(reader.node.markers.some(m=>m.choices?.[choice.id]),'middle-start cards preserve the required party choice')
 await writeFile('.cache/playback-164/mv-402-party-reader.json',JSON.stringify(reader))
})
test('a second actual-game template caller opens its independent CG instead of reusing the first scene',async()=>{
 const list=await h.getReaderContent(mz.itemId,'main',{sectionId:'v:map-128'}),card=list.node.items.find(x=>x.node.includes('event-31-4'));assert.ok(card)
 const reader=await h.getReaderContent(mz.itemId,'main',{sectionId:card.node}),live=activePath(reader.scene),sources=live.flatMap(i=>stateAt(reader.scene,i).overlays.map(o=>o.src||''));assert.ok(sources.some(s=>s.endsWith('H002_00.png')));assert.ok(!sources.some(s=>s.includes('/H001_')))
 await writeFile('.cache/playback-164/mz-second-cg-reader.json',JSON.stringify(reader));console.log('Native second CG card',card.node,'steps',live.length)
})
