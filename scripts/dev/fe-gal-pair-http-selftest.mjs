// Real import/layout/provider + HTTP resources; deliberately warm the browser's
// pre-upgrade green PNG cache, then keep that same browser open across upgrade.
import assert from'node:assert/strict'
import{readFile,writeFile,mkdir,open,stat,readdir}from'node:fs/promises'
import{existsSync}from'node:fs'
import{createRequire}from'node:module'
import{spawn}from'node:child_process'
import{createHash}from'node:crypto'
import net from'node:net'
import path from'node:path'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{decodeAkb,akbPng}from'../../web/library/gal/silky.mjs'
import{activePath,stateAt,assetUrl}from'../../web/static/gal-engine.js'
const{chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),work=path.resolve('.cache/pair-http-regression');await mkdir(work,{recursive:true});const capture='.cache/pair-runtime/extracted/g02',ranges=JSON.parse(await readFile(capture+'/__pair_media/index.json'));for(const r of ranges.files){const b=await readFile(capture+'/'+r.name);assert.equal(createHash('sha256').update(b).digest('hex'),r.sha256);const f=await open(path.resolve('.cache/fuyu-edo-fixtures/えどわ～る',r.path),'r+');try{assert.equal((await f.stat()).size,r.sourceBytes);await f.write(b,0,b.length,r.offset)}finally{await f.close()}}
const dataDir=work+'/data',fixture=path.resolve('.cache/fuyu-edo-fixtures'),h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:fixture}}})}),items={}
for(const[gid,folder,adapter]of[['g01','fuyukuru','silky::mes'],['g02','えどわ～る','edo::ikunyu']]){const installed='.cache/pair-runtime/extracted/'+gid+'/__pair_runtime/items',names=await readdir(installed),config=JSON.parse(await readFile(installed+'/'+names[0])).config,imp=await h.importFromSource({sourcePath:fixture+'/'+folder,options:{adapters:[adapter],config}});items[gid]=imp.items?.[0]||imp.item}
const green=await h.getReaderContent(items.g01.itemId,'main',{sectionId:'s:script/FK_SCENE_07.smes'});assert.ok(green.scene);const stripAudio=reader=>({...reader,scene:{...reader.scene,steps:reader.scene.steps.map(s=>({...s,commands:s.commands.filter(c=>!['voice','se','bgm'].includes(c.op))}))}})
const res=await h.getResource(items.g01.itemId,'ev003_h03.png'),fixed=await readFile(res.file),old=decodeAkb(await readFile('.cache/fuyu-green-capture/extracted/g01/__pair_media/layer.arc/EV003_H03.AKB'));for(let i=3;i<old.rgba.length;i+=4)old.rgba[i]=255;await writeFile(work+'/pre-upgrade-green.png',akbPng(old));await writeFile(res.file,akbPng(old))
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port,logs=[],errors=[];const server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});for(const s of[server.stdout,server.stderr])s.on('data',b=>logs.push(String(b)));let browser
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs.join(''))
 browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(String(e)));await page.goto(base);await page.waitForLoadState('networkidle')
 const pixel=async url=>page.evaluate(async url=>{const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;c.getContext('2d').drawImage(im,0,0);return[...c.getContext('2d').getImageData(0,0,1,1).data]},url)
 const oldUrl=base+assetUrl(green.resourceBase,stateAt(green.scene,activePath(green.scene)[29]).overlays.find(o=>o.slot==='silky:cg-diff').src);assert.deepEqual(await pixel(oldUrl),[0,255,0,255]);await writeFile(res.file,fixed);assert.deepEqual(await pixel(oldUrl),[0,255,0,255],'reopening unchanged URL demonstrably keeps old browser cache')
 const mount=async(reader,step)=>page.evaluate(async({reader,step})=>{window.__player?.destroy();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1200px;height:800px';document.body.append(host);const{createGalPlayer}=await import('/gal-player.js');window.__player=createGalPlayer({container:host,reader,startStep:step,onStep:i=>document.body.dataset.step=String(i)})},{reader,step})
 await mount(stripAudio(green),29);await page.waitForFunction(()=>document.querySelector('canvas.gal-overlay')?.dataset.parts==='1');const actual=await page.evaluate(()=>[...document.querySelector('canvas.gal-overlay').getContext('2d').getImageData(0,0,1,1).data]);assert.equal(actual[3],0,'real reader must escape pre-upgrade green browser cache');console.log('PASS native reader HTTP escapes old opaque PNG cache')
 const result={green:{corner:actual,resourceVersion:green.resourceVersion},movie:null,errors}
 if(process.env.PAIR_VERIFY!=='green'){
  const movie=await h.getReaderContent(items.g02.itemId,'main',{sectionId:'s:ver00_s0/src/game/scsg01h.edo'});assert.ok(movie.scene);const clips=[]
  for(const[n,name]of [[15,'msg01a'],[27,'msg01b'],[44,'msg01c']]){
   await mount(stripAudio(movie),n-1);await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>!v.hidden&&v.videoWidth===1920&&v.currentTime>0.3&&!v.error),null,{timeout:20000});
   const visible=await page.evaluate(()=>{const video=[...document.querySelectorAll('video')].find(v=>!v.hidden&&v.videoWidth),z=Number(getComputedStyle(video).zIndex),covering=[...document.querySelectorAll('canvas.gal-overlay')].filter(c=>Number(getComputedStyle(c).zIndex)>z&&c.getContext('2d').getImageData(960,540,1,1).data[3]>250);return{src:video.currentSrc,time:video.currentTime,z,covering:covering.length}});assert.equal(visible.covering,0,'video must visibly render, not just play behind opaque CG');assert.ok(decodeURIComponent(visible.src).includes(name+'.mp4'))
   const frame=()=>page.evaluate(()=>{const v=[...document.querySelectorAll('video')].find(v=>!v.hidden&&v.videoWidth),c=document.createElement('canvas');c.width=64;c.height=36;c.getContext('2d').drawImage(v,0,0,64,36);return{t:v.currentTime,data:[...c.getContext('2d').getImageData(0,0,64,36).data].join(',')}});const first=await frame();await page.waitForFunction(t=>[...document.querySelectorAll('video')].some(v=>!v.hidden&&v.currentTime>t+0.5),first.t);const last=await frame();assert.notEqual(last.data,first.data,'actual video frames must change');clips.push({sentence:n,...visible,changedFrames:true});
  }
  result.movie=clips;await page.screenshot({path:work+'/scsg01h-44.png'});console.log('PASS original scsg01h 15/27/44 real HTTP movies visibly animate over fallback')
 }
 assert.deepEqual(errors,[]);await writeFile(work+'/verification.json',JSON.stringify(result,null,2))
}finally{await writeFile(res.file,fixed);await browser?.close();server.kill('SIGTERM');await writeFile(work+'/server.log',logs.join(''))}
