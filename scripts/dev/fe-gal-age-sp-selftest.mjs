import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import net from 'node:net'
import {stateAt} from '../../web/static/gal-engine.js'
const f=JSON.parse(await readFile('.cache/age-sp-reader/fixture.json')),reader=JSON.parse(await readFile('.cache/age-sp-reader/reader.json')),out='.cache/age-sp-reader/browser'
await mkdir(out,{recursive:true})
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),probe=net.createServer()
await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const base=`http://127.0.0.1:${port}`,logs=[],errors=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:f.dataDir,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']})
server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)));let browser,page
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(e.message))
 // Pin both pixel-comparison canvases to CPU: Chrome otherwise switches the
 // repeatedly read player canvas from GPU to CPU midway through this test.
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return get.call(this,kind,kind==='2d'?{...options,willReadFrequently:true}:options)}})
 await page.addInitScript(()=>{const timer=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timer(fn,Math.min(ms||0,20),...args);window.__pending=0;const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,fn,...args){if(type==='click'&&this.classList?.contains('gal-next-btn')&&typeof fn==='function')return add.call(this,type,function(e){window.__pending++;return Promise.resolve(fn.call(this,e)).finally(()=>window.__pending--)},...args);return add.call(this,type,fn,...args)}})
 for(const sectionId of ['',f.card.node])await page.request.post(base+'/api/library/items/gal/'+f.itemId+'/progress',{data:{unitId:'main',sectionId,scrollRatio:0,choices:{}}})
 await page.goto(base+'/#/media/gal/'+f.itemId+'/main?tab=new&section=');await page.getByText('剧情脚本（sys4ini，未逐场验证）',{exact:true}).click();await page.getByText('SP0023',{exact:true}).click();await page.waitForSelector('.gal-player',{timeout:60000})
 await page.waitForSelector('.gal-player[data-native-font="ready"]',{timeout:30000})
 const font=await page.locator('.gal-text').evaluate(el=>{const family=getComputedStyle(el).fontFamily;return{family,loaded:document.fonts.check('30px '+family,'\ue000\ue001\ue003')}});assert.match(font.family,/GalPrivateFont/);assert.equal(font.loaded,true)
 const text=()=>page.locator('.gal-text').evaluate(el=>{const x=el.cloneNode(true);x.querySelectorAll('rt').forEach(r=>r.remove());return x.textContent})
 const expected=reader.scene.steps.filter(s=>s.commands.some(c=>c.op==='text')).map(s=>s.commands.filter(c=>c.op==='text').flatMap(c=>c.segments.map(s=>s.text)).join('')),frames=[]
 assert.equal(expected.length,138)
 for(let i=0;i<expected.length;i++){
  if(i)for(let tries=0;tries<5;tries++){await page.locator('.gal-next-btn').click();await page.waitForFunction(()=>window.__pending===0);await page.waitForTimeout(35);if(await text()===expected[i])break}
  assert.equal(await text(),expected[i],'native SP text '+(i+1))
  if(![0,8,68,100,137].includes(i))continue
  const overlays=stateAt(reader.scene,i).overlays
  await page.waitForFunction(n=>Number(document.querySelector('canvas.gal-overlay')?.dataset.parts)===n,overlays.length)
  await page.waitForTimeout(400)
  const pixels=await page.evaluate(async({base,id,overlays})=>{
   const actual=document.querySelector('canvas.gal-overlay'),ref=document.createElement('canvas');ref.width=actual.width;ref.height=actual.height;const ctx=ref.getContext('2d'),k=Math.min(ref.width/1600,ref.height/900)
   for(const p of [...overlays].sort((a,b)=>(a.z||0)-(b.z||0))){const im=new Image();im.src=base+'/api/library/items/gal/'+id+'/resource?path='+encodeURIComponent(p.src);await im.decode();const crop=p.crop||[0,0,im.width,im.height];ctx.drawImage(im,...crop,ref.width/2+p.x*k-crop[2]*k/2,ref.height/2+p.y*k-crop[3]*k/2,crop[2]*k,crop[3]*k)}
   const a=actual.getContext('2d').getImageData(0,0,ref.width,ref.height).data,b=ctx.getImageData(0,0,ref.width,ref.height).data;let bad=0;for(let n=0;n<b.length;n+=124)if([0,1,2,3].some(c=>Math.abs(a[n+c]-b[n+c])>3))bad++;return {bad,actual:bad?actual.toDataURL():null,reference:bad?ref.toDataURL():null,slots:actual.dataset.slots}
  },{base,id:f.itemId,overlays});if(pixels.bad){await writeFile(out+'/actual.png',Buffer.from(pixels.actual.split(',')[1],'base64'));await writeFile(out+'/reference.png',Buffer.from(pixels.reference.split(',')[1],'base64'));console.log('pixel failure',i,pixels.bad,pixels.slots,overlays)}await page.screenshot({path:out+'/check-'+(i+1)+'.png'});assert.equal(pixels.bad,0,'original CG/difference pixels at line '+(i+1));await page.screenshot({path:out+'/line-'+(i+1)+'.png'});frames.push({line:i+1,images:overlays.map(x=>x.src),pixelsMatch:true})
 }
 await page.locator('.gal-prev').click();await page.waitForTimeout(100);assert.equal(await text(),expected[136])
 assert.deepEqual(errors,[]);await writeFile(out+'/verification.json',JSON.stringify({itemId:f.itemId,nativeLines:138,font,frames,previous:true,errors},null,2));console.log('PASS actual SP0023: 138 native text groups, original private font loaded, native CG and difference pixels at five positions, previous',out)
}finally{if(page)await writeFile(out+'/last-dom.txt',await page.locator('body').innerText()).catch(()=>{});await browser?.close();server.kill('SIGTERM');await writeFile(out+'/server.log',logs.join(''))}
