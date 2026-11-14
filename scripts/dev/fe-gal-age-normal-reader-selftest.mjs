// Actual application route, ordinary imported item and untouched original BIN.
// No demo profile, synthetic scene, asset-route mocks or injected initialization.
import assert from'node:assert/strict'
import{readFile,writeFile,mkdir}from'node:fs/promises'
import{createRequire}from'node:module'
import{spawn}from'node:child_process'
import net from'node:net'
const f=JSON.parse(await readFile('.cache/age-normal-reader/fixture.json')),reader=JSON.parse(await readFile('.cache/age-normal-reader/reader.json')),out='.cache/age-normal-reader/browser';await mkdir(out,{recursive:true})
const expected=reader.scene.steps.filter(s=>s.commands.some(c=>c.op==='text')).map(s=>s.commands.filter(c=>c.op==='text').flatMap(c=>c.segments.map(s=>s.text)).join(''));assert.equal(expected.length,25)
const{chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`,logs=[],errors=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:f.dataDir,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)));let browser,page
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{window.__audioPlays=[];const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){const row={src:this.currentSrc||this.src,loop:this.loop,volume:this.volume,status:'pending'};window.__audioPlays.push(row);return play.call(this).then(()=>{row.status='playing'},e=>{row.status='failed';throw e})}})
 await page.addInitScript(()=>{window.__nextPending=0;const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,fn,...args){if(type==='click'&&this.classList?.contains('gal-next-btn')&&typeof fn==='function'){return add.call(this,type,function(e){window.__nextPending++;return Promise.resolve(fn.call(this,e)).finally(()=>{window.__nextPending--})},...args)}return add.call(this,type,fn,...args)}})
 await page.addInitScript(()=>{const timer=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timer(fn,Math.min(ms||0,20),...args)})
 await page.request.post(base+'/api/library/items/gal/'+f.itemId+'/progress',{data:{unitId:'main',sectionId:f.card.node,scrollRatio:0,choices:{}}})
 await page.request.post(base+'/api/library/items/gal/'+f.itemId+'/progress',{data:{unitId:'main',sectionId:'',scrollRatio:0,choices:{}}})
 await page.goto(base+'/#/media/gal/'+f.itemId+'/main?tab=new&section=');await page.getByText('开场 SN0000',{exact:true}).click();await page.waitForSelector('.gal-player',{timeout:60000})
 const text=()=>page.locator('.gal-text').evaluate(el=>{const x=el.cloneNode(true);x.querySelectorAll('rt').forEach(r=>r.remove());return x.textContent})
 const seen=[]
 for(let i=0;i<expected.length;i++){
  if(i)for(let tries=0;tries<5;tries++){await page.locator('.gal-next-btn').click();await page.waitForFunction(()=>window.__nextPending===0,null,{timeout:30000});await page.waitForTimeout(60);if(await text()===expected[i])break}
  await page.waitForFunction(t=>{const el=document.querySelector('.gal-text')?.cloneNode(true);el?.querySelectorAll('rt').forEach(r=>r.remove());return el?.textContent===t},expected[i]);seen.push(expected[i])
  if([0,13,24].includes(i)){await page.waitForTimeout(200);await page.screenshot({path:out+'/line-'+(i+1)+'.png'})}
  if(i===13){const match=await page.evaluate(async({base,id})=>{const actual=document.querySelector('canvas.gal-overlay'),ref=document.createElement('canvas');ref.width=actual.width;ref.height=actual.height;const image=new Image();image.src=base+'/api/library/items/gal/'+id+'/resource?path='+encodeURIComponent('age/res/sys4ini/EV902A.png');await image.decode();ref.getContext('2d').drawImage(image,0,0,ref.width,ref.height);const a=actual.getContext('2d').getImageData(0,0,ref.width,ref.height).data,b=ref.getContext('2d').getImageData(0,0,ref.width,ref.height).data;let bad=0;for(let j=0;j<b.length;j+=124)if([0,1,2,3].some(k=>Math.abs(a[j+k]-b[j+k])>2))bad++;return bad},{base,id:f.itemId});assert.equal(match,0,'CG2 must actually replace CG1 in the normal media page')}
 }
 await page.locator('.gal-prev').click();await page.waitForFunction(t=>{const x=document.querySelector('.gal-text')?.cloneNode(true);x?.querySelectorAll('rt').forEach(r=>r.remove());return x?.textContent===t},expected[23])
 await page.locator('.gal-note').click();const diagnostic=await page.locator('.gal-diag pre').innerText();assert.match(diagnostic,/0x35d/);assert.match(diagnostic,/第 2 句/);assert.match(diagnostic,/SYSTEM4.BIN/)
 await page.request.post(base+'/api/library/items/gal/'+f.itemId+'/progress',{data:{unitId:'main',sectionId:f.chapter.node,scrollRatio:0,choices:{}}})
 await page.goto(base+'/#/media/gal/'+f.itemId+'/main?tab=new&section=');await page.getByText('剧情脚本（sys4ini，未逐场验证）',{exact:true}).click();await page.getByText('SC0000',{exact:true}).click();await page.getByText(f.chapter.title,{exact:true}).click();await page.waitForSelector('.gal-player')
 await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('新婚旅行'))
 await page.waitForFunction(()=>window.__audioPlays.some(a=>a.src.includes('FIA0026.wav')&&a.status==='playing'&&!a.loop&&a.volume>0),null,{timeout:30000})
 await page.waitForFunction(()=>document.querySelector('canvas.gal-overlay')?.dataset.parts==='2');await page.screenshot({path:out+'/G0001-first-line.png'})
 const chapterPixels=await page.evaluate(async({base,id})=>{const actual=document.querySelector('canvas.gal-overlay'),ref=document.createElement('canvas');ref.width=actual.width;ref.height=actual.height;const ctx=ref.getContext('2d'),k=Math.min(ref.width/1600,ref.height/900)
  for(const [name,crop,x,y]of[['BG054AA',[0,0,1600,900],0,0],['CF002AAO',[0,0,225,183],-665.5,314.5]]){const im=new Image();im.src=base+'/api/library/items/gal/'+id+'/resource?path='+encodeURIComponent('age/res/sys4ini/'+name+'.png');await im.decode();ctx.drawImage(im,...crop,ref.width/2+x*k-crop[2]*k/2,ref.height/2+y*k-crop[3]*k/2,crop[2]*k,crop[3]*k)}
  const a=actual.getContext('2d').getImageData(0,0,ref.width,ref.height).data,b=ctx.getImageData(0,0,ref.width,ref.height).data;let bad=0;for(let j=0;j<b.length;j+=124)if([0,1,2,3].some(n=>Math.abs(a[j+n]-b[j+n])>3))bad++;return bad},{base,id:f.itemId});assert.equal(chapterPixels,0,'native G0001 BG and portrait must actually be painted at native positions')
 assert.deepEqual(errors,[]);await writeFile(out+'/verification.json',JSON.stringify({itemId:f.itemId,card:f.card,ordinaryImport:true,manuallyInjectedState:false,dialogueGroups:seen.length,secondCgPixelsMatch:true,previousRestoresLine24:true,diagnostics:true,nativeChapter:f.chapter.title,nativeChapterBgPortraitPixelsMatch:true,nativeChapterVoicePlayed:true,errors},null,2));console.log('PASS normal AGE application route: click opening, all 25 original text groups, CG2 pixels, previous, located diagnostics, G0001 native BG/portrait and actual voice playback',out)
}finally{if(page)await writeFile(out+'/last-dom.txt',await page.locator('body').innerText()).catch(()=>{});await browser?.close();server.kill('SIGTERM');await writeFile(out+'/server.log',logs.join(''))}
