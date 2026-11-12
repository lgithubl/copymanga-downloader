import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {generateTags} from '../tag-scripts/gal-layout/main.js'
import {createGalHandler} from '../../web/library/types/gal.mjs'
import {decodeIco} from '../../web/library/gal/pe-icon.mjs'
import {encodePng} from '../tag-scripts/gal-download/png.mjs'
const png=encodePng(2,2,Buffer.alloc(16,255),4),ico=Buffer.alloc(22+png.length)
ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=2;ico[7]=2;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);png.copy(ico,22)
test('ICO decoding is bounded and selects a valid PNG payload',()=>{assert.deepEqual(decodeIco(ico),png);assert.equal(decodeIco(Buffer.from('bad')),null);const bad=Buffer.from(ico);bad.writeUInt32LE(999999,18);assert.equal(decodeIco(bad),null)})
test('RPG titles honor configured/manual titles; directory icons precede executable fallback and render as PNG',async()=>{
 const work=await mkdtemp(path.join(os.tmpdir(),'rpg-presentation-')),media=path.join(work,'directory-name'),dataDir=path.join(work,'data')
 for(const dir of ['data','js'])await mkdir(path.join(media,dir),{recursive:true})
 await writeFile(path.join(media,'data/System.json'),JSON.stringify({gameTitle:'System title'}));await writeFile(path.join(media,'data/CommonEvents.json'),JSON.stringify([null,{id:1,name:'test',list:[{code:401,parameters:['text']}]}]));await writeFile(path.join(media,'js/plugins.js'),'var $plugins=[];');await writeFile(path.join(media,'Game.ico'),ico)
 const handler=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})}),imported=await handler.importFromSource({sourcePath:media,options:{adapters:['rpgmaker-json']}}),item=imported.items[0]
 const run=(item,options={})=>generateTags({item,script:{version:'2.53.0',options},tags:[]})
 const configured={...item,config:{...item.config,game:{id:'rpgmaker::fixture',title:'Configured title'}}},out=await run(configured)
 assert.equal(out.itemPatch.title,'Configured title');assert.equal(out.itemPatch.gal.config.cover,'icon:Game.ico')
 const custom=await run({...configured,title:'Manual title'});assert.equal(custom.itemPatch.title,'Configured title')
 assert.equal((await run(configured,{overrides:[{path:'*',title:'Override title'}]})).itemPatch.title,'Override title')
 await handler.patchItemMetadata(item.itemId,out.itemPatch);const cover=await handler.getThumbnailFile(item.itemId);assert.equal(cover.contentType,'image/png');assert.deepEqual(await readFile(cover.file),png)
 await mkdir(path.join(media,'icon'));await writeFile(path.join(media,'icon/icon.png'),png)
 assert.equal((await run(configured)).itemPatch.gal.config.cover,'icon:icon/icon.png')
 console.log('Presentation artifacts retained:',work)
})
