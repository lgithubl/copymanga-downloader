import assert from'node:assert/strict'
import{readFile,writeFile,mkdtemp}from'node:fs/promises'
import{existsSync}from'node:fs'
import{createRequire}from'node:module'
import{spawn}from'node:child_process'
import path from'node:path'
import os from'node:os'
import net from'node:net'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{prepare as rpgPrepare,parse as rpgParse}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{generateTags,resolveLayout}from'../tag-scripts/gal-layout/main.js'
import{activePath,stateAt}from'../../web/static/gal-engine.js'
const{chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),work=await mkdtemp(path.join(os.tmpdir(),'fe-scene-audit-')),assets=new Map(),twi=JSON.parse(await readFile('.cache/scene-audit-161/analysis/twi-native-reader.json'))
for(const a of twi.assets)assets.set('twi/'+a.rel,{body:await readFile(a.file),contentType:a.contentType})
const{source}=JSON.parse(await readFile('.cache/next-native-fixtures/Remastered.json')),dataDir=path.join(work,'rem-data'),h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})}),item=(await h.importFromSource({sourcePath:source,options:{adapters:['edo::lua'],config:{game:{id:'edo::Remastered'}}}})).items[0],layout=await generateTags({item,script:{version:'test',options:{}}});await h.patchItemMetadata(item.itemId,layout.itemPatch)
const home=await h.getReaderContent(item.itemId,'main'),story=home.node.items.find(x=>x.title==='剧情'),cards=await h.getReaderContent(item.itemId,'main',{sectionId:story.node}),card=cards.node.items.find(x=>x.title==='sc0561'),reader=await h.getReaderContent(item.itemId,'main',{sectionId:card.node}),scene=reader.scene,live=activePath(scene)
const bgTarget=live.find(i=>{const s=stateAt(scene,i);return s.overlays.some(o=>o.src?.toLowerCase().includes('bg002aal'))&&s.overlays.some(o=>o.src?.toLowerCase().includes('cs006ab'))}),cgTarget=live.find(i=>stateAt(scene,i).overlays.some(o=>o.src?.toLowerCase().includes('ev056aa')));assert.ok(bgTarget>=0);assert.ok(cgTarget>bgTarget)
for(const t of[bgTarget,cgTarget])for(const o of stateAt(scene,t).overlays){if(!o.src)continue;const r=await h.getResource(item.itemId,o.src);assets.set('rem/'+o.src,{body:await readFile(r.file),contentType:r.contentType})}
const rpgCases=[]
for(const[id,rel,selected,match]of[['RJ01271506','data/Map102.json','event-20-5','H001_01'],['RJ328940','www/data/Map016.json','event-11-1','_Meifa_SceneA_27']]){
 const f=JSON.parse(await readFile('.cache/scene-audit-161/analysis/'+id+'-fixture.json')),options={...resolveLayout('rpgmaker::'+id.toLowerCase()).ruleOverrides['rpgmaker-json'],root:f.root,maps:{enabled:false},catalog:{maps:false,common:false}},ctx=await rpgPrepare({options,files:f.files,texts:f.texts,mediaDir:f.source}),native=rpgParse('',ctx,{rel,scene:selected}),target=activePath(native).find(i=>{const s=stateAt(native,i);return s.bg?.src?.includes(match)||s.overlays.some(o=>o.src?.includes(match))});assert.ok(target>=0,id+' native CG must be reachable')
 const hh=createGalHandler({dataDir:path.join(work,id),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:f.source}}})}),ii=(await hh.importFromSource({sourcePath:f.source,options:{adapters:['rpgmaker-json'],config:{game:{id:'rpgmaker::'+id.toLowerCase()}}}})).items[0],lo=await generateTags({item:ii,script:{version:'test',options:{}}});await hh.patchItemMetadata(ii.itemId,lo.itemPatch)
 const state=stateAt(native,target),wanted=[state.bg?.src,...state.overlays.map(o=>o.src)].filter(Boolean)
 for(const src of wanted){const resource=await hh.getResource(ii.itemId,src).catch(e=>{throw Error(id+' native visible resource '+src+': '+e.message)});assets.set(id+'/'+src,{body:await readFile(resource.file),contentType:resource.contentType})}
 rpgCases.push({key:id,scene:native,target,match})
}
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`,logs=[],errors=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:path.join(work,'server-data'),HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)));let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:1280,height:850}});page.on('pageerror',e=>errors.push(e.message))
 await page.route(u=>u.pathname.startsWith('/audit-native/'),async route=>{const url=new URL(route.request().url()),key=url.pathname.split('/').at(-1)+'/'+url.searchParams.get('path'),a=assets.get(key);await route.fulfill({status:a?200:404,body:a?.body||'uncollected source',contentType:a?.contentType})});await page.goto(base);await page.waitForLoadState('networkidle')
 const spec=twi.specs.find(s=>s.motion==='002');assert.ok(spec)
 await page.evaluate(async({spec,base})=>{document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='position:relative;width:1200px;height:720px';document.body.append(host);const{createLive2dLayer}=await import('/gal-live2d.js');window.__l2d=createLive2dLayer({parent:host,url:p=>base+'/audit-native/twi?path='+encodeURIComponent(p),onMissing:p=>{throw Error('Missing native model resource '+p)}});await window.__l2d.set(spec)},{spec,base})
 await page.waitForFunction(()=>window.__l2d.info()[0]?.drawn>0);const a=await page.locator('canvas.gal-live2d').screenshot();await page.waitForTimeout(700);const b=await page.locator('canvas.gal-live2d').screenshot();assert.notDeepEqual(a,b,'native motion must change actual WebGL pixels');const info=await page.evaluate(()=>window.__l2d.info());assert.ok(info[0].motionFile.endsWith('002.motion3.json'));await writeFile(path.join(work,'native-live2d-frame.png'),b);console.log('PASS native Live2D moving WebGL frames',info)
 // Full scene state, including the preceding BG and character, without stripping
 // visual commands to make an isolated CG appear.
 for(const target of[bgTarget,cgTarget]){
  await page.evaluate(async({scene,target,base})=>{window.__l2d?.destroy();window.__player?.destroy();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1280px;height:850px';document.body.append(host);const{createGalPlayer}=await import('/gal-player.js');window.__player=createGalPlayer({container:host,reader:{node:{},resourceBase:base+'/audit-native/rem',scene:{...scene,steps:scene.steps.map(s=>({...s,commands:s.commands.filter(c=>!['voice','bgm','se','bgvoice','bgse'].includes(c.op))}))}},startStep:target})},{scene,target,base})
  await page.waitForFunction(()=>{const c=document.querySelector('canvas.gal-overlay');if(!c)return false;const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<b.length;i+=400)if(b[i]>0)n++;return n>100})
  await page.screenshot({path:path.join(work,'sc0561-'+target+'.png')});console.log('PASS native Remastered full scene',target,stateAt(scene,target).overlays.map(o=>o.src))
 }
 for(const f of rpgCases){
  await page.evaluate(async({f,base})=>{window.__player?.destroy();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1280px;height:850px';document.body.append(host);const{createGalPlayer}=await import('/gal-player.js');window.__player=createGalPlayer({container:host,reader:{node:{},resourceBase:base+'/audit-native/'+f.key,scene:{...f.scene,steps:f.scene.steps.map(s=>({...s,commands:s.commands.filter(c=>!['voice','bgm','se','bgvoice','bgse'].includes(c.op))}))}},startStep:f.target})},{f,base})
  if(f.key==='RJ328940')await page.waitForFunction(match=>[...document.querySelectorAll('.gal-bg')].some(e=>getComputedStyle(e).backgroundImage.includes(match)&&getComputedStyle(e).opacity==='1'),f.match)
  else await page.waitForFunction(()=>{const c=document.querySelector('canvas.gal-overlay');if(!c)return false;const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<b.length;i+=400)if(b[i]>0)n++;return n>100})
  await page.screenshot({path:path.join(work,f.key+'-'+f.target+'.png')});console.log('PASS native RPG imported CG player',f.key,f.target,f.match)
 }
 assert.deepEqual(errors,[]);console.log('Native browser evidence retained',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
