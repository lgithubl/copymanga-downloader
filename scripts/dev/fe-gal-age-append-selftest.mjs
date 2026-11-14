import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import net from 'node:net'
import {stateAt,ratioOfStep} from '../../web/static/gal-engine.js'
const f=JSON.parse(await readFile('.cache/age-append-reader/fixture.json')),out='.cache/age-append-reader/browser';await mkdir(out,{recursive:true})
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const base=`http://127.0.0.1:${port}`,logs=[],errors=[],results=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:f.dataDir,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)));let browser,page
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return get.call(this,kind,kind==='2d'?{...options,willReadFrequently:true}:options)};const timer=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timer(fn,Math.min(ms||0,20),...args);window.__pending=0;const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,fn,...args){if(type==='click'&&this.classList?.contains('gal-next-btn')&&typeof fn==='function')return add.call(this,type,function(e){window.__pending++;return Promise.resolve(fn.call(this,e)).finally(()=>window.__pending--)},...args);return add.call(this,type,fn,...args)}})
 const home=base+'/#/media/gal/'+f.itemId+'/main?tab=new&section='
 const text=()=>page.locator('.gal-text').evaluate(el=>{const x=el.cloneNode(true);x.querySelectorAll('rt').forEach(r=>r.remove());return x.textContent})
 const progress=async(sectionId,scrollRatio)=>{const r=await page.request.post(base+'/api/library/items/gal/'+f.itemId+'/progress',{data:{unitId:'main',sectionId,scrollRatio,choices:{}}});assert.ok(r.ok())}
 async function verifyFrame(scene,index,title){
  const state=stateAt(scene,index),expected=state.text.map(s=>s.text).join('');assert.equal(await text(),expected)
  assert.ok(state.overlays.length,'actual CG must remain visible '+title+' step '+index)
  await page.waitForFunction(n=>Number(document.querySelector('canvas.gal-overlay')?.dataset.parts)===n,state.overlays.length);await page.waitForTimeout(100)
  const bad=await page.evaluate(async({base,id,overlays})=>{const actual=document.querySelector('canvas.gal-overlay'),ref=document.createElement('canvas');ref.width=actual.width;ref.height=actual.height;const ctx=ref.getContext('2d'),k=Math.min(ref.width/1600,ref.height/900);for(const p of [...overlays].sort((a,b)=>(a.z||0)-(b.z||0))){const im=new Image();im.src=base+'/api/library/items/gal/'+id+'/resource?path='+encodeURIComponent(p.src);await im.decode();const crop=p.crop||[0,0,im.width,im.height];ctx.drawImage(im,...crop,ref.width/2+p.x*k-crop[2]*k/2,ref.height/2+p.y*k-crop[3]*k/2,crop[2]*k,crop[3]*k)}const a=actual.getContext('2d').getImageData(0,0,ref.width,ref.height).data,b=ctx.getImageData(0,0,ref.width,ref.height).data;let bad=0;for(let i=0;i<b.length;i+=124)if([0,1,2,3].some(c=>Math.abs(a[i+c]-b[i+c])>3))bad++;return bad},{base,id:f.itemId,overlays:state.overlays})
  assert.equal(bad,0,'native append CG/difference pixels '+title+' step '+index);await page.screenshot({path:out+'/'+title+'-'+index+'.png'});results.push({title,step:index,images:state.overlays.map(x=>x.src),pixelsMatch:true})
 }
 for(const c of f.scenes){
  await progress('',0);await progress(c.card.node,0);await page.goto(home);await page.getByText('特殊场景',{exact:true}).click()
  // The existing More menu must expose and apply matching, not merely show a
  // hardcoded folder. Reset the local rule before continuing ordinary playback.
  if(c===f.scenes[0]){
   await page.locator('.gal-browse-more-btn').click();const box=page.locator('.gal-view-rule[data-view="special"]');await box.locator('input').fill('SP0203$');await box.getByRole('button',{name:'应用',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.gal-view-rule[data-view="special"] .gal-browse-range')?.textContent.includes('本地规则 · 命中 1 个脚本'));assert.equal(await page.getByText('$1$SP0203',{exact:true}).count(),1);await page.locator('.gal-view-rule[data-view="special"]').getByRole('button',{name:/恢复默认/}).click();await page.waitForFunction(()=>document.querySelector('.gal-view-rule[data-view="special"] .gal-browse-range')?.textContent.includes('默认规则'));await page.locator('.gal-browse-more-btn').click()
  }
  await page.getByText(c.title,{exact:true}).click();await page.waitForSelector('.gal-player[data-native-font="ready"]',{timeout:60000});await verifyFrame(c.reader.scene,0,c.title)
  const expected=c.reader.scene.steps.map(s=>s.commands.filter(c=>c.op==='text').flatMap(c=>c.segments.map(s=>s.text)).join(''))
  for(let i=1;i<=8;i++){for(let n=0;n<5;n++){await page.locator('.gal-next-btn').click();await page.waitForFunction(()=>window.__pending===0);await page.waitForTimeout(35);if(await text()===expected[i])break}assert.equal(await text(),expected[i])}
  await verifyFrame(c.reader.scene,8,c.title);await page.locator('.gal-prev').click();await page.waitForTimeout(100);assert.equal(await text(),expected[7])
  await page.getByRole('button',{name:'↑ 列表',exact:true}).click();await page.waitForSelector('.gal-player',{state:'detached'});await page.waitForTimeout(100)
  const mid=Math.floor(c.reader.scene.steps.length/2);await progress(c.card.node,ratioOfStep(mid,c.reader.scene.steps.length));await page.goto(home+encodeURIComponent(c.card.node));await page.waitForSelector('.gal-player[data-native-font="ready"]',{timeout:60000});await verifyFrame(c.reader.scene,mid,c.title)
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/verification.json',JSON.stringify({itemId:f.itemId,specialMatching:true,originalFont:true,previous:true,resume:true,frames:results,errors},null,2));console.log('PASS actual special-scene matching and three append entries: original CG/difference pixels, private font, previous and resume',out)
}finally{if(page)await writeFile(out+'/last-dom.txt',await page.locator('body').innerText()).catch(()=>{});await browser?.close();server.kill('SIGTERM');await writeFile(out+'/server.log',logs.join(''))}
