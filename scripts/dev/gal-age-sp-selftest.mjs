import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {createGalHandler} from '../../web/library/types/gal.mjs'
import {generateTags} from '../tag-scripts/gal-layout/main.js'
import {makeAgeNativeFixture} from './make-age-native-fixture.mjs'
import {readAgeCatalog,ageResourceContext} from '../../web/library/gal/age-archive.mjs'
import {nativeAgeStartup} from '../../web/library/gal/age-startup.mjs'
import {analyzeAgeScene} from '../../web/library/gal/adapters/age-sys4.mjs'
import {createAgeGraphics} from '../../web/library/gal/age-graphics.mjs'

test('opaque texture copy updates exact destination pixels and rejects invalid bounds',()=>{
 const images={1:{src:'base.png',width:3,height:2,opaque:true,rgba:Buffer.alloc(24,10)},2:{src:'patch.png',width:1,height:1,opaque:true,rgba:Buffer.from([70,80,90,255])}}
 const gpu=createAgeGraphics({loadImage:id=>images[id]})
 const run=(opcode,args)=>gpu.instruction({opcode,args},{read:x=>x,write:()=>{}})
 run(0x1f9,[1,7,-1]);run(0x1f9,[2,42,-1]);assert.equal(run(0x207,[42,7,0,0,1,1,2,1]),true)
 assert.deepEqual([...gpu.textures.get(7).rgba.subarray(20,24)],[70,80,90,255])
 assert.deepEqual([...gpu.textures.get(7).rgba.subarray(0,20)],Array(20).fill(10))
 assert.deepEqual(gpu.textures.get(7).parts,[{src:'patch.png',crop:[0,0,1,1],x:2,y:1}])
 assert.throws(()=>run(0x207,[42,7,0,0,1,1,3,1]),/rectangle outside/)
})

test('native SP0023 dispatch loads EVINIT rather than resource zero after unsupported initialization',async()=>{
 const f=await makeAgeNativeFixture('.cache/age-sp-tests',{additionalSources:['.cache/age-sp-193820/extracted/g01/__verify/age']})
 const catalog=await readAgeCatalog(f.root),startup=nativeAgeStartup(catalog,'sys4ini')
 assert.equal(startup.integers[6597769],22971,'original INIT2 dispatch table must point to EVINIT')
 const context=ageResourceContext(catalog),wanted=new Set()
 context.resources.images=new Proxy(context.resources.images,{get(target,key){if(/^\d+$/.test(String(key)))wanted.add(Number(key));return target[key]}})
 const data={format:'age-sys4/1',name:'SP0023.BIN',script:(await readFile('.cache/age-sp-193820/extracted/g01/__verify/age/SP0023.BIN')).toString('base64'),resources:context.resources,links:context.links}
 const scene=analyzeAgeScene(data,{...startup,stage:[1600,900],unverifiedPolicy:'preview',partialPreview:true})
 assert.ok(wanted.has(21337),'original first image must be EV130A')
 assert.ok(wanted.has(21346),'original later image must be EV131A')
 assert.ok(!wanted.has(0),'never use missing initializer state as an image ordinal')
 assert.equal(scene.steps.filter(s=>s.commands.some(c=>c.op==='text')).length,138)
 assert.equal(startup.dataPrefix.stopped.script,'SHINIT2.BIN','do not claim the opaque full startup was completed')
})

test('ordinary SP list/reader exposes original CG thumbnails, differences and private-use font',async()=>{
 const f=await makeAgeNativeFixture('.cache/age-sp-tests',{additionalSources:['.cache/age-sp-193820/extracted/g01/__verify/age','.cache/age-sp-font-195123/extracted/g01/__verify/age']})
 const dataDir=path.resolve('.cache/age-sp-reader/data');await mkdir(dataDir,{recursive:true})
 const h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:f.root}}})})
 const item=(await h.importFromSource({sourcePath:f.root,options:{adapters:['age::sys4'],config:{game:{id:'age::tenyui',title:'天結'}}}})).items[0]
 const layout=await generateTags({item,script:{version:'2.64.6',options:{}}});await h.patchItemMetadata(item.itemId,layout.itemPatch)
 const home=await h.getReaderContent(item.itemId,'main',{sectionId:'v:age-story-sys4ini'}),card=home.node.items.find(x=>x.title==='SP0023');assert.ok(card)
 assert.ok(card.thumbs?.some(x=>x.includes('EV130A')),'actual list must have CG thumbnail')
 const reader=await h.getReaderContent(item.itemId,'main',{sectionId:card.node})
 assert.equal(reader.scene.fonts?.[0]?.src,'age/res/sys4ini/AGE-EXTEND.TTF')
 const images=new Set(reader.scene.steps.flatMap(s=>s.commands.filter(c=>c.op==='overlay').map(c=>c.src)))
 assert.ok(images.has('age/res/sys4ini/EV130A.png'));assert.ok(images.has('age/res/sys4ini/EV131A.png'))
 assert.ok(images.has('age/res/sys4ini/EV130_AB.png'),'opaque native texture copies must become visible differences')
 await writeFile('.cache/age-sp-reader/reader.json',JSON.stringify(reader));await writeFile('.cache/age-sp-reader/fixture.json',JSON.stringify({source:f.root,dataDir,itemId:item.itemId,card}))
})
