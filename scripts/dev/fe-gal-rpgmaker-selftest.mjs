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
await put('data/CommonEvents.json',JSON.stringify(common))
await put('data/System.json',JSON.stringify({gameTitle:'Generic fixture',encryptionKey:key,hasEncryptedImages:true,advanced:{screenWidth:640,screenHeight:360}}))
await put('data/Actors.json','[null]'); await put('data/MapInfos.json','[null]');await put('js/plugins.js','var $plugins = [];')
const pixels=Buffer.alloc(640*360*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=18;pixels[i+1]=172;pixels[i+2]=88;pixels[i+3]=255}
const png=encodePng(640,360,pixels,4),body=Buffer.from(png),mask=Buffer.from(key,'hex');for(let i=0;i<16;i++)body[i]^=mask[i]
await put('img/pictures/cg_sample.rpgmvp',Buffer.concat([Buffer.from('5250474d560000000003010000000000','hex'),body]))
const handler=createGalHandler({dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})})
const imported=await handler.importFromSource({sourcePath:media,options:{adapters:['rpgmaker-json']}}),itemId=imported.items[0].itemId
const layout=await generateTags({type:'gal',item:imported.items[0],script:{version:'2.49.0',options:{}},tags:[]})
await handler.patchItemMetadata(itemId,layout.itemPatch)
const home=await handler.getReaderContent(itemId,'main'),special=home.node.items.find(n=>n.title==='特殊场景');assert.ok(special)
const cards=await handler.getReaderContent(itemId,'main',{sectionId:special.node}),card=cards.node.items.find(n=>n.title==='回想 Branch');assert.ok(card?.markers?.length);assert.ok(card.thumbs?.some(p=>p.includes('cg_sample')))
const mark=card.markers.find(m=>Object.keys(m.choices||{}).length);assert.ok(mark);assert.equal(Object.values(mark.choices)[0],2)
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
 console.log('PASS full app: import, layout, special list, filtered encrypted thumbnail, branch marker, restored pixels/text; no page errors')
 console.log('Artifacts retained:',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
