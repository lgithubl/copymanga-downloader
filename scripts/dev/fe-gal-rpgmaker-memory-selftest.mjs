// Real catalogue -> public reader -> application media page. Event-only map
// collections intentionally omit tile arrays, so this fixture disables map tiles.
import assert from'node:assert/strict'
import{readFile,writeFile,mkdir}from'node:fs/promises'
import{existsSync}from'node:fs'
import{createRequire}from'node:module'
import{spawn}from'node:child_process'
import net from'node:net'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{resolveLayout}from'../tag-scripts/gal-layout/main.js'
const f=JSON.parse(await readFile('.cache/playback-164/fixtures.json')),item=f.fixtures.find(x=>x.id==='RJ01271506'),work='.cache/rpg-replay-audit-20261114/browser';await mkdir(work,{recursive:true})
const h=createGalHandler({dataDir:f.dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:f.work+'/games'}}})}),native=resolveLayout('rpgmaker::rj01271506').ruleOverrides['rpgmaker-json']
await h.patchItemMetadata(item.itemId,{gal:{config:{adapterOptions:{'rpgmaker-json':{...item.config.adapterOptions['rpgmaker-json'],...native,maps:{enabled:false}}}}}})
const list=await h.getReaderContent(item.itemId,'main',{sectionId:'v:special|q='+encodeURIComponent('照料花朵')}),card=list.node.items.find(x=>x.title.includes('照料花朵'));assert.ok(card,'actual special-scene list must expose the original replay option')
const reader=await h.getReaderContent(item.itemId,'main',{sectionId:card.node});assert.ok(reader.scene.steps.length>30);await writeFile(work+'/reader.json',JSON.stringify(reader))
const{chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`,logs=[],errors=[],images=[],audio=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:f.dataDir,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)));let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{const u=new URL(r.url());if(u.pathname.endsWith('/resource')){const p=u.searchParams.get('path');if(p?.includes('img/'))images.push({path:p,status:r.status()});if(p?.includes('audio/voice/'))audio.push({path:p,status:r.status()})}})
 await page.request.post(base+'/api/library/items/gal/'+item.itemId+'/progress',{data:{unitId:'main',sectionId:card.node,scrollRatio:0,choices:{}}})
 await page.goto(base+'/#/media/gal/'+item.itemId+'/main?tab=new&section='+encodeURIComponent(card.node));await page.waitForSelector('.gal-player',{timeout:60000});await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('小花儿'))
 await page.waitForFunction(()=>{const c=document.querySelector('canvas.gal-overlay');if(!c)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=400)if(d[i])n++;return n>100});await page.screenshot({path:work+'/entrance-actual-reader.png'})
 assert.ok(images.some(x=>x.path.includes('/bisty/')&&x.status===200),'real heroine image must load through resource HTTP')
 await page.locator('.gal-next-btn').click();await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('看起来好开心'));await page.screenshot({path:work+'/next-actual-reader.png'})
 assert.deepEqual(errors,[]);assert.ok(audio.some(x=>x.path.endsWith('/6719.ogg')),'actual reader invokes the declared original voice resource')
 await writeFile(work+'/verification.json',JSON.stringify({card,images,audio,errors,voiceSampleLimitation:'These recollection audio bytes were not collected; URL invocation is verified, audible decoding is not.'},null,2));console.log('PASS actual recollection catalogue/reader route, original standing pixels, next sentence and original voice URL',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/server.log',logs.join(''))}
