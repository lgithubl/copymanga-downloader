// Captured native metadata integration; game sources remain in the local cache.
// This catches materialization collisions that a parser-only fixture cannot.
import assert from'node:assert/strict'
import{readFile,mkdtemp}from'node:fs/promises'
import{existsSync}from'node:fs'
import path from'node:path'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
const base=path.resolve('.cache/five-new-games-20261116'),source=process.env.GAL_CATPAW_NATIVE_SOURCE||base+'/future-source'
assert.ok(existsSync(source+'/futrue_Data/resources.assets'),'Supply the collected CatPaw metadata fixture with GAL_CATPAW_NATIVE_SOURCE')
const dataDir=await mkdtemp(base+'/integration/model-identity-'),profile={rootDir:source,adapters:['catpaw::script'],config:{game:{id:'catpaw::future',title:'Native cache regression'}}},options={dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':profile}})},h=createGalHandler(options),item=(await h.importFromSource({sourcePath:source})).items[0],layout=await generateTags({type:'gal',item,script:{version:'2.74.0',options:{}}});assert.ok(layout.itemPatch?.gal?.config);await h.patchItemMetadata(item.itemId,layout.itemPatch);const home=await h.getReaderContent(item.itemId,'main');assert.ok(!home.node.problems?.some(p=>p.level==='error'),JSON.stringify(home.node.problems))
const docs=[];for(const name of['alose','anglerole']){const result=await h.getResource(item.itemId,'futrue_Data/arc/res/Model-'+name+'.model3.json'),doc=JSON.parse(await readFile(result.file));docs.push({file:result.file,doc});assert.ok(doc.FileReferences.Moc.toLowerCase().includes('/'+name+'.moc3'),JSON.stringify(doc.FileReferences))}
assert.notEqual(docs[0].file,docs[1].file,'two virtual JSON models in one physical asset need different cache entries');assert.notDeepEqual(docs[0].doc.FileReferences.Textures,docs[1].doc.FileReferences.Textures);assert.ok(docs[1].doc.FileReferences.Motions.face8);assert.ok(docs[1].doc.FileReferences.Motions.cloth_2);const restarted=createGalHandler(options);for(const[i,name]of['alose','anglerole'].entries()){const resource=await restarted.getResource(item.itemId,'futrue_Data/arc/res/Model-'+name+'.model3.json');assert.deepEqual(JSON.parse(await readFile(resource.file)),docs[i].doc)}
console.log('PASS real native import/layout, different virtual model JSON cache identities and their exact moc/atlas/motion references after handler restart; retained:',dataDir)
