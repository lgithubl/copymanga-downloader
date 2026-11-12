import{test}from'node:test'
import assert from'node:assert/strict'
import{mkdtemp,readFile,writeFile,readdir}from'node:fs/promises'
import{existsSync}from'node:fs'
import path from'node:path'
import os from'node:os'
import{readSakanaIndex,readSakanaEntry,sakanaMetadata,fafaValue,sakanaParts}from'../../web/library/gal/sakana.mjs'
import{parse,prepare}from'../../web/library/gal/adapters/sakana-ks.mjs'
import{activePath,stateAt,choicesForCommand}from'../../web/static/gal-engine.js'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
import{sakanaSparse}from'./new-games-sparse-fixtures.mjs'
const cache='.cache/new-games-033525/analysis/ai'
test('real FAFA maps retain40CGs,20recall entries (including repeated numeric IDs),7names',async()=>{for(const[k,count]of[['cg',40],['scene',20],['character',7]])assert.equal(sakanaMetadata(k+'.conf',await readFile(cache+'/'+k+'.conf')).entries.length,count)})
test('native layered UI selects exact FACE group from method and keeps native offsets',async()=>{const ui=fafaValue(await readFile('.cache/new-games-155817/analysis/ai-decoded/img/720p/st/CHA02_p5_01_a/CHA02_p5_01_a.ui')),a=sakanaParts(ui,'change_2'),b=sakanaParts(ui,'shake_7');assert.ok(a.parts.some(x=>x.src.endsWith('_2_1.png')));assert.ok(!a.parts.some(x=>x.src.endsWith('_7_1.png')));assert.ok(b.parts.some(x=>x.src.endsWith('_7_1.png')));assert.ok(a.parts.length>=2);assert.ok(a.parts.every(x=>Number.isFinite(x.x)&&Number.isFinite(x.y)))})
test('actual3839pages/3native choices + explicit savedata-dependent ending selection compile; sample branch skips the other route',async()=>{const ctx=await prepare({files:[],texts:{},options:{}}),source=await readFile('.cache/new-games-162126/analysis/ai-decoded/scenario/ep_all.ks','utf8'),s=parse(JSON.stringify({format:'sakana-ks/1',name:'ep_all.ks',text:source}),ctx);assert.equal(s.stats.messages,3839);assert.equal(s.stats.choices,4)
 const simple='[switch]\n[case "A"]\n[jump target="*a"]\n[case "B"]\n[jump target="*b"]\n[endswitch]\n*a\nA[cpg]\n[jump target="*end"]\n*b\nB[cpg]\n*end\nend[cpg]',g=parse(JSON.stringify({format:'sakana-ks/1',text:simple}),ctx),c=g.steps[0].commands.find(c=>c.op==='choice'),choices={[c.id]:2};assert.deepEqual(activePath(g,choices).map(i=>stateAt(g,i,choices).text.map(x=>x.text).join('')).filter(Boolean),['B','end'])
})
test('real sparse SX import/layout/catalog/scenes and image resource roundtrip',async()=>{const work=await mkdtemp(path.join(os.tmpdir(),'sakana-app-')),media=await sakanaSparse(path.join(work,'AI')),index=await readSakanaIndex(path.join(media,'pkg/aiduma-001(00).sx'));assert.equal(index.entries.length,2154)
 const h=createGalHandler({dataDir:path.join(work,'data'),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})}),imp=await h.importFromSource({sourcePath:media,options:{adapters:['sakana::ks']}}),item=imp.items[0],layout=await generateTags({item,script:{version:'2.56.0',options:{}}});assert.equal(layout.itemPatch.gal.config.containers.format,'sakana');await h.patchItemMetadata(item.itemId,layout.itemPatch);const home=await h.getReaderContent(item.itemId,'main'),special=home.node.items.find(c=>c.title==='特殊场景'),story=home.node.items.find(c=>c.title==='剧情');assert.ok(special&&story,JSON.stringify(home.node));const cards=await h.getReaderContent(item.itemId,'main',{sectionId:special.node});assert.equal(cards.node.items.length,20);const reader=await h.getReaderContent(item.itemId,'main',{sectionId:cards.node.items[0].node});assert.ok(reader.scene.stats.messages>1);assert.ok(reader.scene.steps.flatMap(s=>s.commands).some(c=>c.cg));assert.ok(cards.node.items[0].thumb)
 let image;for(const e of index.entries.filter(e=>/\.(webp|png)$/.test(e.name))){try{const b=await readSakanaEntry(index,e);if(b.subarray(0,4).toString()==='RIFF'||b.toString('hex',0,4)==='89504e47'){image={e,b};break}}catch{}}
 assert.ok(image);const resource=await h.getResource(item.itemId,image.e.name);assert.deepEqual(await readFile(resource.file),image.b);await writeFile(path.join(work,'manifest.json'),JSON.stringify({media,dataDir:path.join(work,'data'),itemId:item.itemId,first:cards.node.items[0].node,image:image.e.name}));console.log('Sakana actual import retained:',work)
})
