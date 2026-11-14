import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {makeAgeNativeFixture} from './make-age-native-fixture.mjs'
import {readAgeCatalog,ageResourceContext} from '../../web/library/gal/age-archive.mjs'
import {createGalHandler} from '../../web/library/types/gal.mjs'
import {generateTags} from '../tag-scripts/gal-layout/main.js'
const fixture=JSON.parse(await readFile('.cache/age-sp-reader/fixture.json'))
test('append contexts resolve encoded images/audio and unprefixed main helpers without ordinal collisions',async()=>{
 const catalog=await readAgeCatalog(fixture.source)
 for(const [namespace,group]of[['append01',1],['append02',2]]){
  const c=ageResourceContext(catalog,namespace),rows=catalog.indexes.find(x=>x.namespace===namespace).entries
  const image=rows.find(x=>/EV\d.*AGF$/.test(x.name)),voice=rows.find(x=>/XWM$/.test(x.name)),encoded=x=>group*0x1000000+x.ordinal
  assert.ok(Object.hasOwn(c.resources.images,encoded(image)))
  assert.equal(c.resources.voice[encoded(voice)],voice.src)
  assert.ok(Object.hasOwn(c.links,54),'plain helper 54 always belongs to SYS4INI, even inside append scripts')
 }
})
test('native append scripts, suffix entries and CG scenes import through ordinary and special lists',async()=>{
 const f=await makeAgeNativeFixture('.cache/age-append-tests',{additionalSources:['.cache/age-sp-193820/extracted/g01/__verify/age','.cache/age-sp-font-195123/extracted/g01/__verify/age','.cache/age-append-203141/extracted/g01/__verify/age','.cache/age-append-media/extracted/g01/__verify/age']})
 const dataDir=path.resolve('.cache/age-append-reader/data');await mkdir(dataDir,{recursive:true})
 const h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:f.root}}})})
 const item=(await h.importFromSource({sourcePath:f.root,options:{adapters:['age::sys4'],config:{game:{id:'age::tenyui',title:'天結'}}}})).items[0]
 const layout=await generateTags({item,script:{version:'2.64.7',options:{}}});await h.patchItemMetadata(item.itemId,layout.itemPatch)
 const a=await h.getReaderContent(item.itemId,'main',{sectionId:'v:age-story-append01'}),b=await h.getReaderContent(item.itemId,'main',{sectionId:'v:age-story-append02'})
 for(const letter of 'ABCDE')assert.ok(a.node.items.some(x=>x.title==='$1$SG0807'+letter),'do not lose SG suffix '+letter)
 for(const letter of 'AB')assert.ok(b.node.items.some(x=>x.title==='$2$SP0222'+letter),'do not lose SP suffix '+letter)
 const special=await h.getReaderContent(item.itemId,'main',{sectionId:'v:catalog-view-special'})
 assert.equal(special.node.total,47,'42 main plus 1 append01 plus 4 append02 SP scripts')
 const pathFiltered=await h.getReaderContent(item.itemId,'main',{sectionId:'v:catalog-view-special',viewRules:{special:{on:'path',match:'^append02/.*SP0222'}}})
 assert.equal(pathFiltered.node.total,2,'path matching can select just append02 A/B')
 const cases=[['$1$SP0203',65,'$1$EV402A'],['$2$SP0222A',80,'$2$EV503A'],['$2$SP0222B',82,'$2$EV504A']],scenes=[]
 for(const [title,count,image]of cases){
  const card=special.node.items.find(x=>x.title===title);assert.ok(card);assert.ok(card.thumbs.some(x=>x.includes(image)),'append CG thumbnail '+title)
  const r=await h.getReaderContent(item.itemId,'main',{sectionId:card.node})
  assert.equal(r.scene.steps.filter(s=>s.commands.some(c=>c.op==='text')).length,count,title)
  assert.ok(r.scene.steps.flatMap(s=>s.commands).some(c=>c.op==='overlay'&&c.src.includes(image)),title+' must resolve native CG')
  assert.equal(r.scene.fonts[0].src,'age/res/sys4ini/AGE-EXTEND.TTF','append reuses main private font')
  assert.ok(r.node.markers.some(x=>x.label.startsWith('CG 开始')),'append-prefixed CG markers '+title)
  scenes.push({title,card,reader:r})
 }
 const cgFiltered=await h.getReaderContent(item.itemId,'main',{sectionId:'v:catalog-view-special',viewRules:{special:{on:'marker',match:'^CG 开始'}}})
 for(const [title]of cases)assert.ok(cgFiltered.node.items.some(x=>x.title===title),'CG-marker matching includes '+title)
 await writeFile('.cache/age-append-reader/fixture.json',JSON.stringify({source:f.root,dataDir,itemId:item.itemId,scenes}))
})
test('ordinary AGE catalog exposes configurable special scenes without changing canonical script IDs',async()=>{
 const h=createGalHandler({dataDir:fixture.dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:fixture.source}}})})
 const item=await h.getItem(fixture.itemId)
 const layout=await generateTags({item,script:{version:'2.64.7',options:{}}});await h.patchItemMetadata(fixture.itemId,layout.itemPatch)
 const home=await h.getReaderContent(fixture.itemId,'main'),special=home.node.items.find(x=>x.title==='特殊场景');assert.ok(special)
 assert.ok(home.node.viewRules.some(r=>r.as==='special'&&r.on==='name'),'matching control must be exposed to More menu')
 const listed=await h.getReaderContent(fixture.itemId,'main',{sectionId:special.node}),sp=listed.node.items.find(x=>x.title==='SP0023');assert.ok(sp)
 assert.equal(sp.node,fixture.card.node,'same scene has one progress ID regardless of list entry')
 assert.ok(!listed.node.items.some(x=>x.title.includes('SN0000')))
 const filtered=await h.getReaderContent(fixture.itemId,'main',{sectionId:special.node,viewRules:{special:{on:'name',match:'SP0023$'}}})
 assert.equal(filtered.node.total,1);assert.equal(filtered.node.items[0].node,sp.node)
 assert.equal(filtered.node.viewRules[0].count,1);assert.equal(filtered.node.viewRules[0].local,true)
})
