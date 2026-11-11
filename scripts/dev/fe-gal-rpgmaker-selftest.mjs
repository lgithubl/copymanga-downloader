// Full app: import -> layout -> special cards -> encrypted thumbnail -> branch
// marker -> seek, then reader/resource endpoints. No external game/runtime tools.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import { encodePng } from '../tag-scripts/gal-download/png.mjs'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '@playwright/test')
const work = await mkdtemp(path.join(os.tmpdir(), 'rpgmaker-app-')), dataDir = path.join(work, 'data'), media = path.join(work, 'RPG Maker generic fixture')
const key = '00112233445566778899aabbccddeeff'
const put = async (rel, bytes) => { const f = path.join(media, 'www', rel); await mkdir(path.dirname(f), {recursive:true}); await writeFile(f, bytes) }
const c = (code, parameters=[], indent=0) => ({code,parameters,indent})
const msg = text => [c(101,['',0,0,2,'Alice']),c(401,[text])]
const common = [null,{id:1,name:'回想 Branch',list:[...msg('Intro one'),...msg('Intro two'),c(102,[['A','B'],-1,0,2,0]),c(402,[0,'A']),...msg('A branch').map(x=>({...x,indent:1})),c(402,[1,'B']),c(231,[10,'cg_sample',0,0,0,0,100,100,255,0],1),...msg('B target').map(x=>({...x,indent:1})),c(404),...msg('After one'),...msg('After two'),...msg('After three')]}]
common.push({id:2,name:'回想 Arbitrary picture',list:[c(231,[1,'button_ok',0,0,0,0,100,100,255,0]),c(231,[2,'tiny_decoration',0,0,0,0,100,100,255,0]),c(231,[3,'scene_0042',0,0,0,0,100,100,255,0]),...msg('Picture one'),...msg('Picture two'),...msg('Picture three'),...msg('Picture four')]})
await put('data/CommonEvents.json',JSON.stringify(common))
await put('data/System.json',JSON.stringify({gameTitle:'Generic fixture',encryptionKey:key,hasEncryptedImages:true,advanced:{screenWidth:640,screenHeight:360}}))
await put('data/Actors.json','[null]'); await put('data/MapInfos.json','[null]');await put('js/plugins.js','var $plugins = [];')
const pixels=Buffer.alloc(640*360*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=18;pixels[i+1]=172;pixels[i+2]=88;pixels[i+3]=255}
const png=encodePng(640,360,pixels,4),body=Buffer.from(png),mask=Buffer.from(key,'hex');for(let i=0;i<16;i++)body[i]^=mask[i]
await put('img/pictures/cg_sample.rpgmvp',Buffer.concat([Buffer.from('5250474d560000000003010000000000','hex'),body]))
await put('img/pictures/scene_0042.rpgmvp',Buffer.concat([Buffer.from('5250474d560000000003010000000000','hex'),body]))
await put('img/pictures/button_ok.png',png)
await put('img/pictures/tiny_decoration.png',encodePng(8,8,Buffer.alloc(8*8*4,255),4))
// Encrypted tiles and character sheets exercise the actual resource endpoint.
const encrypted = png => {const b=Buffer.from(png);for(let i=0;i<16;i++)b[i]^=mask[i];return Buffer.concat([Buffer.from('5250474d560000000003010000000000','hex'),b])}
const solid=(w,h,rgba)=>{const b=Buffer.alloc(w*h*4);for(let i=0;i<b.length;i+=4)rgba.forEach((v,n)=>b[i+n]=v);return b}
await put('img/tilesets/B.rpgmvp',encrypted(encodePng(768,768,solid(768,768,[32,96,48,255]),4)))
const npc=solid(144,192,[220,32,32,255]);for(let y=144;y<192;y++)for(let x=0;x<144;x++){const i=(y*144+x)*4;npc[i]=32;npc[i+2]=220}
await put('img/characters/$NPC.rpgmvp',encrypted(encodePng(144,192,npc,4)))
await put('data/Tilesets.json',JSON.stringify([null,{tilesetNames:['','','','','','B'],flags:[]}]))
await put('data/MapInfos.json',JSON.stringify([null,{id:1,name:'回想 地図'}]))
const image={characterName:'$NPC',characterIndex:0,direction:2,pattern:1,tileId:0}
await put('data/Map001.json',JSON.stringify({autoplayBgm:false,parallaxName:"",scrollType:0,width:13,height:7,tilesetId:1,events:[null,{id:1,name:'回想 地図演出',x:6,y:3,pages:[{image,conditions:{},priorityType:1,moveSpeed:4,list:[...msg('Map start'),c(205,[0,{wait:true,list:[{code:3,parameters:[]},{code:19,parameters:[]},{code:0}]}]),...msg('Map after move'),...msg('Map third'),...msg('Map end')]}]}],data:[...Array(13*7).fill(1),...Array(13*7*5).fill(0)]}))
const handler=createGalHandler({dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})})
const imported=await handler.importFromSource({sourcePath:media,options:{adapters:['rpgmaker-json']}}),itemId=imported.items[0].itemId
const layout=await generateTags({type:'gal',item:imported.items[0],script:{version:'2.50.0',options:{}},tags:[]})
await handler.patchItemMetadata(itemId,layout.itemPatch)
const home=await handler.getReaderContent(itemId,'main'),special=home.node.items.find(n=>n.title==='特殊场景');assert.ok(special)
const cards=await handler.getReaderContent(itemId,'main',{sectionId:special.node}),card=cards.node.items.find(n=>n.title==='回想 Branch');assert.ok(card?.markers?.length);assert.ok(card.thumbs?.some(p=>p.includes('cg_sample')))
const arbitrary=cards.node.items.find(n=>n.title==='回想 Arbitrary picture')
assert.deepEqual(arbitrary.thumbs,['img/pictures/scene_0042.png'],'arbitrary names work, UI and decrypted-size filters still apply')
const mark=card.markers.find(m=>Object.keys(m.choices||{}).length);assert.ok(mark);assert.equal(Object.values(mark.choices)[0],2)
await handler.patchItemMetadata(itemId,{gal:{config:{thumbSkip:[{match:'cg_sample',minWidth:1000}]}}})
const filtered=await handler.getReaderContent(itemId,'main',{sectionId:special.node})
assert.ok(!filtered.node.items.find(n=>n.title==='回想 Branch').thumbs.some(p=>p.includes('cg_sample')),'dimension filtering must inspect decrypted PNG, not its on-disk encrypted header')
await handler.patchItemMetadata(itemId,{gal:{config:{thumbSkip:layout.itemPatch.gal.config.thumbSkip}}})
const asset=await handler.getResource(itemId,'img/pictures/cg_sample.png');assert.equal(asset.contentType,'image/png');assert.deepEqual(await readFile(asset.file),png)
const thumb=await handler.getResource(itemId,'img/pictures/cg_sample.png',{width:320});assert.equal(thumb.contentType,'image/webp');assert.ok((await stat(thumb.file)).size>0)
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const base=`http://127.0.0.1:${port}`, logs=[]
const server=spawn(process.execPath,['web/server.mjs'],{cwd:process.cwd(),env:{...process.env,DATA_DIR:dataDir,PORT:String(port),HOST:'127.0.0.1',TAG_SCRIPTS_DIR:path.resolve('scripts/tag-scripts')},stdio:['ignore','pipe','pipe']})
server.stdout.on('data',d=>logs.push(String(d)));server.stderr.on('data',d=>logs.push(String(d)))
let browser
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs.join('').slice(-2000))
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(special.node)}`)
 await page.waitForFunction(()=>{const img=document.querySelector('.gal-card[data-title="回想 Arbitrary picture"] img');return img?.complete&&img.naturalWidth>0})
 await page.screenshot({path:path.join(work,'rpg-arbitrary-thumbnail.png')})
 await page.waitForSelector('.gal-card-mark')
 const mapCard=page.locator('.gal-card[data-title="回想 地図演出"]');assert.equal(await mapCard.count(),1)
 await mapCard.click();try{await page.waitForSelector('canvas.gal-rpgmaker-map[data-map="1"]',{timeout:10000})}catch(e){await page.screenshot({path:path.join(work,'map-failure.png')});console.log('Map failure',await page.locator('body').innerText(),errors);throw e}
 await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('Map start'))
 const mapPixel=async(x,y)=>page.evaluate(({x,y})=>{const c=document.querySelector('canvas.gal-rpgmaker-map');return [...c.getContext('2d').getImageData(Math.floor(x*c.width/640),Math.floor(y*c.height/360),1,1).data]},{x,y})
 assert.deepEqual(await mapPixel(600,300),[32,96,48,255],'encrypted ground tiles actually visible')
 assert.deepEqual(await mapPixel(320,172),[220,32,32,255],'NPC initially faces down')
 await page.screenshot({path:path.join(work,'rpg-map-before.png')})
 await page.locator('.gal-next-btn').click();await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('Map after move'))
 await page.waitForFunction(()=>{const c=document.querySelector('canvas.gal-rpgmaker-map');return c.getContext('2d').getImageData(Math.floor(368*c.width/640),Math.floor(172*c.height/360),1,1).data[2]>200})
 assert.deepEqual(await mapPixel(320,172),[32,96,48,255],'NPC left original tile')
 assert.deepEqual(await mapPixel(368,172),[32,32,220,255],'NPC moved right and turned up')
 await page.screenshot({path:path.join(work,'rpg-map-after.png')})
 await page.locator('.gal-prev').click();await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('Map start'))
 assert.deepEqual(await mapPixel(320,172),[220,32,32,255],'backward seek restores location and direction')
 await page.goto(`${base}/#/media/gal/${itemId}/main?section=${encodeURIComponent(special.node)}`)
 await page.waitForSelector('.gal-card-mark')
 const button=page.locator(`.gal-card-mark[data-step="${mark.step}"]`);assert.equal(await button.count(),1)
 await button.click();await page.waitForSelector('.gal-player')
 await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('B target'))
 await page.waitForFunction(()=>document.querySelector('canvas.gal-overlay')?.dataset.parts==='1')
 const image=await page.evaluate(()=>{const c=document.querySelector('canvas.gal-overlay'),p=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;return [...p]})
 assert.ok(image[1]>150&&image[0]<40&&image[3]===255,JSON.stringify(image))
 assert.equal(await page.locator('.gal-choices:visible').count(),0,'marker carries its branch history without asking an earlier choice')
 assert.deepEqual(errors,[])
 await page.screenshot({path:path.join(work,'rpg-marker-player.png')})
 console.log('PASS full app: import, layout, special list, arbitrary-name encrypted thumbnail visible, UI/tiny image filtering, branch marker, restored pixels/text, encrypted map/NPC, native movement/turn, backward seek; no page errors')
 console.log('Artifacts retained:',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
