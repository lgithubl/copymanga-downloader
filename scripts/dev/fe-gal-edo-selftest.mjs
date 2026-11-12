// Browser reading CFG test with actual collected PNG/Vorbis, no game Lua execution.
import assert from'node:assert/strict'
import{mkdtemp,readFile,writeFile}from'node:fs/promises'
import{createRequire}from'node:module'
import{spawn}from'node:child_process'
import net from'node:net'
import path from'node:path'
import os from'node:os'
import{parse}from'../../web/library/gal/adapters/edo-lua.mjs'
import{computeMarkers}from'../../web/library/gal/markers.mjs'
const{chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),work=await mkdtemp(path.join(os.tmpdir(),'fe-edo-')),probe=net.createServer()
await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`,logs=[],errors=[]
const png=await readFile('.cache/new-games-162126/analysis/shiro-sky_001a-payload.bin'),ogg=await readFile('.cache/new-games-162126/analysis/shiro-audio.ogg')
const source='set(BG,"sky_001a.png")\ntext("start")\nitem={}\nitem[1]="A"\nitem[2]="B"\nsel("",item)\nr=get_sel_result()\nif r==1 then goto a end\ngoto b\n::a::\nset(EV,"ev-test.png")\ntext("branch A")\ngoto finish\n::b::\nset(EV,"ev-test.png")\nplayVoice("sample.ogg")\ntext("branch B")\n::finish::\ntext("after")\ntext("end")\nend'
const scene={format:'gal-scene/1',adapter:'edo::lua',...parse(JSON.stringify({format:'edo-lua/1',name:'src/game/test',text:source}))},markers=computeMarkers(scene,[{kind:'cmd',op:'overlay',re:/ev-test/,label:'CG',pick:'each',max:6}]);assert.equal(markers.length,2);assert.ok(markers[1].choices)
const server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:path.join(work,'data'),HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)))
let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const page=await browser.newPage({viewport:{width:1200,height:800}});page.on('pageerror',e=>errors.push(e.message))
 await page.route(url=>url.pathname==='/edo-fixture',route=>route.fulfill({status:200,contentType:new URL(route.request().url()).searchParams.get('path').endsWith('.ogg')?'audio/ogg':'image/png',body:new URL(route.request().url()).searchParams.get('path').endsWith('.ogg')?ogg:png}))
 await page.addInitScript(()=>{const Native=window.Audio;window.__audios=[];window.Audio=function(src){const a=new Native(src);window.__audios.push(a);return a};window.Audio.prototype=Native.prototype})
 await page.goto(base);await page.waitForLoadState('networkidle')
 const reader={resourceBase:base+'/edo-fixture',node:{markers},scene}
 const mount=async(marker={})=>page.evaluate(async({reader,marker})=>{window.__player?.destroy();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1200px;height:800px';document.body.append(host);localStorage.setItem('copymanga.gal.fastInterval','0');const{createGalPlayer}=await import('/gal-player.js');window.__player=createGalPlayer({container:host,reader,startStep:marker.step,startChoices:marker.choices})},{reader,marker})
 console.log('server/browser ready');await mount();console.log('mounted');await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('start'));console.log('start visible');await page.click('.gal-next-btn');await page.waitForSelector('.gal-choice');await page.locator('.gal-choice').nth(1).click();await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('branch B'))
 console.log('branch B visible');await page.waitForFunction(()=>window.__audios.some(a=>a.currentTime>0&&!a.paused&&!a.error),null,{timeout:10000}).catch(async e=>{console.log(await page.evaluate(()=>window.__audios.map(a=>({src:a.src,t:a.currentTime,paused:a.paused,ready:a.readyState,error:a.error?.message}))));throw e})
 await page.click('.gal-next-btn');await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('after'));await page.click('.gal-prev');await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('branch B'))
 await mount(markers[1]);await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('branch B'));await page.waitForFunction(()=>{const c=document.querySelector('canvas.gal-overlay');return c&&c.width>0&&c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data[3]>0});assert.deepEqual(errors,[])
 await page.screenshot({path:path.join(work,'edo-player.png')});console.log('PASS Edo: real PNG/Vorbis browser decoding, B route skips A, previous restores B, marker enters guarded branch. Artifacts:',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
