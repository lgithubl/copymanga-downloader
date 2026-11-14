import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,mkdir}from'node:fs/promises'
import{existsSync}from'node:fs'
import path from'node:path'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
import{makeAgeNativeFixture}from'./make-age-native-fixture.mjs'
const native=await makeAgeNativeFixture('.cache/age-normal-source'),source=native.root,dataDir=path.resolve('.cache/age-normal-reader/data');await mkdir(dataDir,{recursive:true})
const h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})})
test('normal AGE import/layout/list/reader opens original prologue without demo options or injected state',async()=>{
 const item=(await h.importFromSource({sourcePath:source,options:{adapters:['age::sys4'],config:{game:{id:'age::tenyui',title:'天結いラビリンスマイスター'}}}})).items[0]
 const layout=await generateTags({item,script:{version:'2.64.5',options:{}}});assert.ok(layout.itemPatch)
 assert.equal(layout.itemPatch.gal.config.adapterOptions['age::sys4'].integers,undefined,'no precomputed demo integers in layout')
 await h.patchItemMetadata(item.itemId,layout.itemPatch)
 const home=await h.getReaderContent(item.itemId,'main'),card=home.node.items.find(n=>n.title.includes('SN0000'));assert.ok(card,JSON.stringify(home.node))
 const reader=await h.getReaderContent(item.itemId,'main',{sectionId:card.node}),scene=reader.scene
 assert.equal(scene.steps.filter(s=>s.commands.some(c=>c.op==='text')).length,25)
 assert.equal(new Set(scene.steps.flatMap(s=>s.commands.filter(c=>c.op==='overlay').map(c=>c.src))).size,2)
 assert.equal(scene.stats.nativeStartup.available,true);assert.ok(scene.stats.opcodeWarnings.some(r=>r.opcode==='0x35d'))
 assert.ok(!JSON.stringify(home.node.items).includes('RTN_'))
 const chapters=await h.getReaderContent(item.itemId,'main',{sectionId:'v:age-story-sys4ini'}),file=chapters.node.items.find(n=>n.title==='SC0000');assert.ok(file)
 const entries=await h.getReaderContent(item.itemId,'main',{sectionId:file.node}),chapter=entries.node.items.find(n=>n.title.startsWith('G0001'));assert.ok(chapter)
 assert.ok(!entries.node.items.some(n=>/^G0000(?:\s|$)/.test(n.title)),'metadata-only arm must not become a playable chapter')
 const chapterReader=await h.getReaderContent(item.itemId,'main',{sectionId:chapter.node});assert.equal(chapterReader.scene.steps.filter(s=>s.commands.some(c=>c.op==='text')).length,252,JSON.stringify(chapterReader.scene.stats.previewStopped))
 assert.ok(chapterReader.scene.stats.nativeStartup.sources.some(s=>s.script==='SCINIT.BIN'),'follow the original data initializer instead of injecting demo values')
 const{writeFile}=await import('node:fs/promises');await writeFile('.cache/age-normal-reader/reader.json',JSON.stringify(reader));await writeFile('.cache/age-normal-reader/chapter-reader.json',JSON.stringify(chapterReader));await writeFile('.cache/age-normal-reader/fixture.json',JSON.stringify({source,dataDir,itemId:item.itemId,card,chapter}));console.log('Actual AGE normal reader',card.title,card.node,item.itemId)
})
