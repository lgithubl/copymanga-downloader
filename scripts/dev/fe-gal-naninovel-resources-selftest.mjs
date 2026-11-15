// Requires gal-naninovel-resources-selftest; actual captured ranges stay local.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import {virtualEntry} from '../../web/library/gal/containers.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),sharp=createRequire(new URL('../../web/package.json',import.meta.url))('sharp'),work=path.resolve('.cache/rj01746557/verified/browser'),fixtures={}
await mkdir(work,{recursive:true});for(const name of ['scene-1','scene-4'])fixtures[name]=JSON.parse(await readFile('.cache/rj01746557/verified/'+name+'.json','utf8'))
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base='http://127.0.0.1:'+port,logs=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:work+'/server',HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)));let browser
const errors=[],missing=[],results=[]
try{
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs.join(''))
 browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message))
 await page.route(u=>u.pathname.startsWith('/nani-resource/'),async route=>{const url=new URL(route.request().url()),name=url.pathname.split('/').at(-1),rel=url.searchParams.get('path')||'',f=fixtures[name];try{const entry=await virtualEntry({mediaDir:f.source,config:f.config,rels:f.config.resourceRoots.map(root=>root?root+'/'+rel:rel)});assert.ok(entry,'missing '+rel);await route.fulfill({status:200,contentType:rel.endsWith('.ogg')?'audio/ogg':'image/png',body:await entry.read()})}catch(e){missing.push({name,rel,error:e.message});await route.fulfill({status:404,body:e.message})}})
 await page.addInitScript(()=>{const Native=window.Audio;window.__audio=[];window.Audio=function(src){const a=new Native(src);window.__audio.push(a);return a};window.Audio.prototype=Native.prototype});await page.goto(base);await page.waitForLoadState('networkidle')
 for(const[name,f]of Object.entries(fixtures)){
  await page.evaluate(async({reader,step})=>{window.__player?.destroy();window.__audio=[];document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1200px;height:800px';document.body.append(host);const {createGalPlayer}=await import('/gal-player.js');window.__player=createGalPlayer({container:host,reader,startStep:step})},{reader:{...f.reader,resourceBase:base+'/nani-resource/'+name},step:f.step})
  await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent?.length>0);await page.waitForFunction(()=>Number(document.querySelector('canvas.gal-overlay')?.dataset.parts)>=2);await page.waitForFunction(()=>window.__audio.some(a=>!a.paused&&a.readyState>=2),null,{timeout:30000});await page.waitForTimeout(500)
  const screenshot=await page.screenshot({path:work+'/'+name+'.png'}),pixels=await sharp(screenshot).stats();assert.ok(pixels.channels.some(c=>c.stdev>20),'original image must contain visible pixels')
  const result=await page.evaluate(()=>({textLength:document.querySelector('.gal-text').textContent.length,parts:Number(document.querySelector('canvas.gal-overlay').dataset.parts),playing:window.__audio.filter(a=>!a.paused&&a.readyState>=2).map(a=>({src:a.src,loop:a.loop})),audioErrors:window.__audio.filter(a=>a.error).map(a=>a.error.message)}));assert.deepEqual(result.audioErrors,[]);if(name==='scene-4')assert.ok(result.playing.filter(a=>a.loop).length>=2,'native human voice and environmental loop both play');results.push({name,...result})
  const thumbnail=await page.evaluate(async({scene,resourceBase})=>{const {renderSceneThumb}=await import('/gal-thumb-render.js');const b=await renderSceneThumb({apiBase:'/fixture-scene',resourceBase,node:'sample',scanSteps:300},{fetchImpl:()=>Promise.resolve({ok:true,json:async()=>({scene})})});return[...new Uint8Array(await b.arrayBuffer())]},{scene:f.reader.scene,resourceBase:base+'/nani-resource/'+name});const bytes=Buffer.from(thumbnail);assert.ok(bytes.length>2000);await writeFile(work+'/'+name+'-thumb.jpg',bytes);console.log('Rendered original',name,'parts',result.parts,'playing',result.playing.length,'thumbnail',bytes.length)
 }
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);await writeFile(work+'/verification.json',JSON.stringify({results,errors,missing},null,2));console.log('PASS actual Naninovel Resources browser image/audio/thumbnail')
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/server.log',logs.join(''))}
