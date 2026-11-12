// Browser checks use collected native portraits/backgrounds; no source game JS.
import assert from'node:assert/strict'
import{readFile,writeFile,mkdtemp}from'node:fs/promises'
import{createRequire}from'node:module'
import{spawn}from'node:child_process'
import path from'node:path'
import os from'node:os'
import net from'node:net'
import{stateAt}from'../../web/static/gal-engine.js'
const{chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),fixtures='.cache/reported-scenes-fixtures',work=await mkdtemp(path.join(os.tmpdir(),'fe-reported-scenes-')),probe=net.createServer()
await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`,logs=[],errors=[]
const server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:path.join(work,'data'),HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)))
let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const page=await browser.newPage({viewport:{width:1280,height:850}});page.on('pageerror',e=>errors.push(e.message))
 const bitmaps=new Map();for(const n of['shirobase-03','shirofacial-02-smile02','n-shirobase-00','n-shirofacial-03-scared01','n-shirofacial-06-painful01','0723','9999']){try{bitmaps.set(n+'.png',await readFile(fixtures+'/'+n+'.png'))}catch{}}
 await page.route(url=>url.pathname==='/native-bug-resource',async route=>{const n=path.posix.basename(new URL(route.request().url()).searchParams.get('path')||'').toLowerCase(),bytes=bitmaps.get(n);if(!bytes)throw Error('Unexpected uncollected browser resource: '+n);await route.fulfill({status:200,contentType:'image/png',body:bytes})})
 await page.goto(base);await page.waitForLoadState('networkidle')
 const mount=async(scene,startStep=0)=>page.evaluate(async({scene,startStep,base})=>{window.__player?.destroy();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1280px;height:850px';document.body.append(host);const{createGalPlayer}=await import('/gal-player.js');window.__player=createGalPlayer({container:host,reader:{node:{},resourceBase:base+'/native-bug-resource',scene:{format:'gal-scene/1',adapter:'edo::lua',...scene}},startStep})},{scene,startStep,base})
 const focused=(scene,images)=>({...scene,steps:scene.steps.map(s=>({...s,commands:s.commands.filter(c=>['set','text','speaker','choice','ui','overlayOff'].includes(c.op)||c.op==='overlay'&&(!c.src||images.includes(path.posix.basename(c.src).toLowerCase())))}))})
 for(const[key,images]of[['shiro-tall',['shirobase-03.png','shirofacial-02-smile02.png']],['shiro-face',['n-shirobase-00.png','n-shirofacial-03-scared01.png','n-shirofacial-06-painful01.png']]]){
  const {scene,target}=JSON.parse(await readFile(fixtures+'/'+key+'.json')),filtered=focused(scene,images);await mount(filtered,target)
  await page.waitForFunction(()=>document.querySelector('canvas.gal-overlay')?.getContext('2d').getImageData(900,200,1,1).data[3]>0)
  const expected=stateAt(scene,target).overlays.filter(x=>x.src&&images.includes(path.posix.basename(x.src).toLowerCase())),compare=()=>page.evaluate(async({specs,base})=>{
   const actual=document.querySelector('canvas.gal-overlay'),canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');for(const s of specs){const img=new Image();img.src=base+'/native-bug-resource?path='+encodeURIComponent(s.src);await img.decode();ctx.drawImage(img,960+s.x,540+s.y,img.naturalWidth*(s.scaleX||1),img.naturalHeight*(s.scaleY||1))}const a=actual.getContext('2d').getImageData(0,0,1920,1080).data,b=ctx.getImageData(0,0,1920,1080).data;let points=0,bad=0;for(let y=80;y<500;y+=7)for(let x=650;x<1200;x+=7){const i=(y*1920+x)*4;if(b[i+3]<250)continue;points++;if([0,1,2,3].some(k=>Math.abs(a[i+k]-b[i+k])>2))bad++}return{points,bad}
  },{specs:expected,base})
  let result=await compare();assert.ok(result.points>100);assert.equal(result.bad,0,key+' native head/face pixels');console.log(key,result)
  if(key==='shiro-face'){await page.click('.gal-prev');await page.click('.gal-next-btn');await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('怖くなってきた'));result=await compare();assert.equal(result.bad,0,'continuous47→48 matches direct entry')}
  await page.screenshot({path:path.join(work,key+'.png')})
 }
 const win=JSON.parse(await readFile(fixtures+'/shiro-window.json'));await mount(focused(win.scene,[]),win.target);await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('白のことはホントに愛してる'));assert.equal(await page.locator('.gal-box').evaluate(el=>getComputedStyle(el).opacity),'1');console.log('PASS native Shiro white4 sentence85 dialogue window visible');
 const pac=JSON.parse(await readFile(fixtures+'/pac-scene.json'));assert.ok(stateAt(pac,11).bg.src.endsWith('/0723.png'));await page.evaluate(async base=>{const img=new Image();img.src=base+'/native-bug-resource?path=0723.png';await img.decode();if(img.naturalWidth<500||img.naturalHeight<300)throw Error('Native restored background invalid')},base)
 const ep=JSON.parse(await readFile(fixtures+'/rpg-ep3.json'));await mount(focused(ep.scene,[]));await page.waitForSelector('.gal-choice');assert.deepEqual((await page.locator('.gal-choice').allTextContents()).map(t=>t.replace(/^\d+/,'')),['内気','真面目','高貴']);await page.locator('.gal-choice').nth(1).click();for(let i=0;i<3;i++){await page.waitForTimeout(100);if(await page.locator('.gal-choice:visible').count())await page.locator('.gal-choice:visible').first().click();else break}await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.trim().length>10);await page.screenshot({path:path.join(work,'ep3-branch.png')})
 assert.deepEqual(errors,[]);console.log('PASS native Shiro portrait pixel comparisons, continuous/direct sentence48, native PAC background decode, EP3 branch UI; retained:',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
