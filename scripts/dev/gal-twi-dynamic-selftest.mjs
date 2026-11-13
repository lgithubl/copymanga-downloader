// Native encrypted PSB + actual encrypted model package; import and resource
// pipeline precede browser checks. Sparse fixture holes are never treated as media.
import assert from'node:assert/strict'
import{readFile,writeFile,mkdtemp}from'node:fs/promises'
import{existsSync}from'node:fs'
import path from'node:path'
import os from'node:os'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags,resolveLayout}from'../tag-scripts/gal-layout/main.js'
import{setKeysFile}from'../../web/library/gal/containers.mjs'
import{decodeKrkrScn}from'../../web/library/gal/krkr-scn.mjs'
import{prepare,parse}from'../../web/library/gal/adapters/krkr-scn.mjs'
import{activePath,stateAt}from'../../web/static/gal-engine.js'
const source=JSON.parse(await readFile('.cache/scene-audit-161/analysis/twi-source.json')).source,dataDir=await mkdtemp(path.join(os.tmpdir(),'twi-native-reader-')),h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})}),item=(await h.importFromSource({sourcePath:source,options:{adapters:['krkr::scn'],config:{game:{id:'krkr::zweitrigger'}}}})).items[0]
await writeFile(path.join(dataDir,'gal-krkr-keys.json'),await readFile('.cache/new-games-033525/export/gal-krkr-keys-twiv.json'))
const out=await generateTags({item,script:{version:'test',options:{}}});assert.ok(out.itemPatch,out.logs.join('\n'));await h.patchItemMetadata(item.itemId,out.itemPatch)
// Use actual provider to build container scripts and lazy model resource index.
const home=await h.getReaderContent(item.itemId,'main');assert.ok(home.node)
const story=home.node.items.find(x=>x.title==='剧情');assert.ok(story,'native catalogue story section')
let card
for(let page=1;page<=3&&!card;page++){const cards=await h.getReaderContent(item.itemId,'main',{sectionId:story.node+(page>1?'#'+page:'')});card=cards.node.items.find(x=>x.node?.includes('yn03'));if(page>=cards.node.pageCount)break}
assert.ok(card,'native yn03 card across actual catalogue pagination');assert.ok(card.markers?.length,'native dynamic scene has middle-start buttons')
const actualReader=await h.getReaderContent(item.itemId,'main',{sectionId:card.node});assert.ok(actualReader.scene.steps.flatMap(s=>s.commands).some(c=>c.op==='live2d'&&c.src.includes('ev_yuna03')),'actual reader, not only direct adapter parsing, exposes dynamic CG')
const raw=JSON.parse(await readFile('.cache/scene-audit-161/analysis/twi/data.xp3-552.root.json')),decoded=decodeKrkrScn(raw,{arc:'data'});assert.ok(decoded.refs.img.includes('ev_yuna03'))
const native=JSON.parse(await readFile(source+'/arc/script/data/yn03.krkr'));assert.ok(native.scenes.some(s=>s.steps.some(x=>x.l.some(l=>l[1]==='eventx'))))
const modelRel='arc/res/ev_yuna03.l2d/ev_yuna03.model3.json',model=await h.getResource(item.itemId,modelRel.replace(/^arc\/res\//,'')),json=JSON.parse(await readFile(model.file)),files=[modelRel,...[json.FileReferences.Moc,...json.FileReferences.Textures,json.FileReferences.DisplayInfo,...json.FileReferences.Expressions.map(x=>x.File),...Object.values(json.FileReferences.Motions).flat().map(x=>x.File)].map(x=>'arc/res/ev_yuna03.l2d/'+x)]
const dir='arc/res/ev_yuna03.l2d/',options=resolveLayout('krkr::zweitrigger').ruleOverrides['krkr::scn'],ctx=prepare({files,texts:{},options}),scene=parse(decoded.text,ctx,{rel:'arc/script/data/yn03.krkr'}),specs=scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='live2d');assert.ok(specs.length>5);assert.ok(specs.some(s=>s.expression==='002'));assert.ok(specs.some(s=>s.motion==='002'))
const old=parse(decoded.text,prepare({files,texts:{},options:{}}));assert.ok(!old.steps.flatMap(s=>s.commands).some(c=>c.op==='live2d'),'legacy default does not activate Twi eventx')
const assets=[];for(const rel of files){const r=await h.getResource(item.itemId,rel.replace(/^arc\/res\//,''));assets.push({rel,file:r.file,contentType:r.contentType});assert.ok((await readFile(r.file)).length>0)}
await writeFile('.cache/scene-audit-161/analysis/twi-native-reader.json',JSON.stringify({source,dataDir,itemId:item.itemId,scene,assets,specs,config:out.itemPatch.gal.config}))
console.log('PASS native PSB eventx, profile isolation, imported encrypted Live2D package with all resources; specs',specs.length,'retained',dataDir)
