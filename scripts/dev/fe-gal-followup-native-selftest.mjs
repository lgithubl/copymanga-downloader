// Import collected native assets, resolve through the actual resource handler,
// then check the reported scenes in Chromium. No game JS or runtime downloads.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,mkdtemp,cp,open} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import {createGalHandler} from '../../web/library/types/gal.mjs'
import {generateTags,resolveLayout} from '../tag-scripts/gal-layout/main.js'
import {buildPac} from './make-pac-fixture.mjs'
import {parse as pacParse} from '../../web/library/gal/adapters/pac-script.mjs'
import {prepare as edoPrepare,parse as edoParse} from '../../web/library/gal/adapters/edo-lua.mjs'
import {prepare as rpgPrepare,parse as rpgParse} from '../../web/library/gal/adapters/rpgmaker-json.mjs'
import {decodeTextFile} from '../../web/library/text-decode.mjs'
import {edoPayload} from '../../web/library/gal/edo.mjs'
import {activePath,stateAt,choiceHistoriesForCommands} from '../../web/static/gal-engine.js'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test'),sharp=createRequire(new URL('../../web/package.json',import.meta.url))('sharp')
const work=await mkdtemp(path.join(os.tmpdir(),'fe-followup-native-')),native='.cache/followup-083838/extracted',assets=new Map(),fixtures=[]
async function imported(source,adapter,id){
 const h=createGalHandler({dataDir:path.join(work,'data-'+id.replace(/\W/g,'_')),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})})
 const item=(await h.importFromSource({sourcePath:source,options:{adapters:[adapter],config:{game:{id}}}})).items[0],layout=await generateTags({item,script:{version:'2.61.0',options:{}}})
 assert.ok(layout.itemPatch,layout.logs?.join('\n'));await h.patchItemMetadata(item.itemId,layout.itemPatch)
 return{h,item,config:layout.itemPatch.gal.config}
}
async function asset(h,item,key,rel){const resource=await h.getResource(item.itemId,rel),b=await readFile(resource.file);await sharp(b).metadata();assets.set(key+'/'+rel.toLowerCase(),b);return b}
// PAC: the exact reported script and its transparent CG, packed in native format.
{
 const source=path.join(work,'Kingdom');await mkdir(path.join(source,'Pac'),{recursive:true});await cp(native+'/g01/data',path.join(source,'data'),{recursive:true})
 const entries=[];for(const rel of ['BG/1831.png','CG/083_02.png','CG/083_01.png'])entries.push({name:'data/Graphics/'+rel,data:await readFile(native+'/g01/__bugs/pac/data/Graphics/'+rel)})
 await writeFile(path.join(source,'Pac/Game.pac'),buildPac(entries));const{h,item}=await imported(source,'pac::script','pac::kingdom'),text=decodeTextFile(await readFile(source+'/data/Script/30_8021.txt')).text,scene=pacParse(text),target=activePath(scene).find(i=>stateAt(scene,i).bg?.over?.endsWith('083_02.png'))
 assert.ok(target>=0);const bg=await asset(h,item,'pac',stateAt(scene,target).bg.src),cg=await asset(h,item,'pac',stateAt(scene,target).bg.over),{data,info}=await sharp(cg).ensureAlpha().raw().toBuffer({resolveWithObject:true});let transparent=-1
 for(let y=60;y<info.height-100&&transparent<0;y++)for(let x=30;x<info.width-30;x++)if(data[(y*info.width+x)*4+3]===0){transparent=y*info.width+x;break}
 assert.ok(transparent>=0,'native CG contains a transparent region requiring its background');const x=transparent%info.width,y=Math.floor(transparent/info.width),pixel=await sharp(bg).extract({left:x,top:y,width:1,height:1}).removeAlpha().raw().toBuffer()
 fixtures.push({key:'pac',scene,target,pixel:{x,y,rgb:[...pixel]},stage:[1280,720]})
}
// MZ: real Map062 -> common12 -> pose/appear -> expression, real Bisty assets.
{
 const source=path.join(work,'RJ01271506');await cp('.cache/new-games-043952/extracted/g01',source,{recursive:true});await cp('.cache/new-games-052443/extracted/g01',source,{recursive:true});await cp(native+'/g02',source,{recursive:true});await cp('.cache/new-games-043202/extracted/g01/js/plugins.js',source+'/js/plugins.js')
 const{h,item}=await imported(source,'rpgmaker-json','rpgmaker::rj01271506'),f=JSON.parse(await readFile('.cache/reported-scenes-fixtures/mz-bisty.json')),state=stateAt(f.scene,f.target)
 for(const o of state.overlays.filter(o=>o.src?.includes('/bisty/')))await asset(h,item,'mz',o.src)
 const filtered={...f.scene,steps:f.scene.steps.map(s=>({...s,commands:s.commands.filter(c=>['set','text','speaker','ui','overlayOff'].includes(c.op)||c.op==='overlay'&&c.src?.includes('/bisty/'))}))}
 fixtures.push({key:'mz',scene:filtered,target:f.target,stage:state.overlays[0].stage})
}
// MV: real EV004 continuation's first and second native parallax CGs.
{
 const source=path.join(work,'RJ328940');await cp('.cache/new-games-043952/extracted/g03',source,{recursive:true});await cp(native+'/g03',source,{recursive:true});await cp('.cache/bugs-073723/extracted/g02/www/data/Map081.json',source+'/www/data/Map081.json');await cp('.cache/new-games-043202/extracted/g03/www/js/plugins.js',source+'/www/js/plugins.js')
 const{h,item}=await imported(source,'rpgmaker-json','rpgmaker::rj328940'),texts={};for(const rel of['data/System.json','data/CommonEvents.json'])texts['www/'+rel]=await readFile(source+'/www/'+rel,'utf8')
 const ctx=await rpgPrepare({options:{root:'www',maps:{enabled:false}},files:[],texts});ctx.maps.set('www/data/Map081.json',JSON.parse(await readFile(source+'/www/data/Map081.json')));const scene=rpgParse('',ctx,{rel:'www/data/Map081.json',scene:'event-1-1'}),targets=[]
 for(const name of['_Lize_SceneA_00.png','_Lize_SceneA_01.png']){const rel='img/parallaxes/'+name;await asset(h,item,'mv',rel);const target=activePath(scene).find(i=>stateAt(scene,i).bg?.src===rel);assert.ok(target>=0);targets.push(target)}
 fixtures.push({key:'mv',scene,targets})
}
// Edo: rebuild supplied sparse ranges only; actual sc6000 EV156 and its PNG.
{
 const source=path.join(work,'Remastered');await mkdir(source)
 for(const [root,manifest,sourceKey]of[['.cache/new-games-043952/extracted/g04','__next/index.json','path'],['.cache/new-games-052443/extracted/g04','__verify/index.json','source'],[native+'/g04','__bugs/index.json','source']]){
  for(const r of JSON.parse(await readFile(root+'/'+manifest)).files){const file=path.join(source,r[sourceKey]);await mkdir(path.dirname(file),{recursive:true});const f=await open(file,existsSync(file)?'r+':'w');try{if((await f.stat()).size<r.sourceBytes)await f.truncate(r.sourceBytes);const b=await readFile(root+'/'+r.artifact);await f.write(b,0,b.length,r.offset)}finally{await f.close()}}
 }
 const{h,item}=await imported(source,'edo::lua','edo::Remastered'),rules=resolveLayout('edo::parente').ruleOverrides['edo::lua'],text=await readFile('.cache/new-games-052443/analysis/remastered/src__game__sc6000.txt','utf8'),global=await readFile('.cache/new-games-052443/analysis/remastered/src__sys__global_config.txt','utf8'),ctx=edoPrepare({options:rules,files:['img/ev/ev156aa.png','img/cs/cs058ae.png','img/bg/bg001ba.png'],texts:{'arc/script/global_config.edo':JSON.stringify({format:'edo-lua/1',name:'src/sys/global_config.txt',text:global})}}),scene=edoParse(JSON.stringify({format:'edo-lua/1',text}),ctx),targets=[]
 scene.steps.forEach((s,step)=>s.commands.forEach((c,command)=>{if(c.src?.toLowerCase().includes('ev156aa'))targets.push({step,command})}));const histories=choiceHistoriesForCommands(scene,targets),target=targets.find(t=>histories.has(`${t.step}:${t.command}`));assert.ok(target);const choices=histories.get(`${target.step}:${target.command}`),state=stateAt(scene,target.step,choices),image=state.overlays.find(o=>o.src?.toLowerCase().includes('ev156aa'))
 const actual=await asset(h,item,'edo',image.src),original=edoPayload(await readFile(native+'/g04/__bugs/remastered/img/ev/ev156aa.bytes'));assert.deepEqual(actual,original)
 fixtures.push({key:'edo',scene:{...scene,steps:scene.steps.map(s=>({...s,commands:s.commands.filter(c=>['set','text','speaker','ui','overlayOff','choice'].includes(c.op)||c.op==='overlay'&&c.src===image.src)}))},target:target.step,choices})
}
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`,errors=[],logs=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:path.join(work,'server-data'),HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)));let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const page=await browser.newPage({viewport:{width:1280,height:850}});page.on('pageerror',e=>errors.push(e.message))
 await page.route(url=>url.pathname.startsWith('/native-followup/'),async route=>{const url=new URL(route.request().url()),key=url.pathname.split('/').at(-1),rel=url.searchParams.get('path')?.toLowerCase(),body=assets.get(key+'/'+rel);await route.fulfill({status:body?200:404,body:body||'uncollected fixture resource'})})
 await page.goto(base);await page.waitForLoadState('networkidle')
 for(const f of fixtures)for(const target of f.targets||[f.target]){
  // Only visual commands/resources are collected. Strip audio from this visual replay.
  const scene={...f.scene,steps:f.scene.steps.map(s=>({...s,commands:s.commands.filter(c=>!['bgm','bgse','se','voice','bgvoice'].includes(c.op))}))}
  await page.evaluate(async({scene,target,choices,base,key})=>{window.__player?.destroy();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1280px;height:850px';document.body.append(host);const{createGalPlayer}=await import('/gal-player.js');window.__player=createGalPlayer({container:host,reader:{node:{},resourceBase:base+'/native-followup/'+key,scene:{format:'gal-scene/1',...scene}},startStep:target,startChoices:choices})},{scene,target,choices:f.choices,base,key:f.key})
  if(f.key==='pac'){
   await page.waitForFunction(()=>[...document.querySelectorAll('.gal-bg')].some(e=>getComputedStyle(e).backgroundImage.includes('083_02')&&getComputedStyle(e).backgroundImage.includes('1831')))
   const images=await page.evaluate(async({base,bg})=>{const a=new Image(),b=new Image();a.src=base+'?path='+encodeURIComponent(bg.src);b.src=base+'?path='+encodeURIComponent(bg.over);await Promise.all([a.decode(),b.decode()]);return[a.naturalWidth,b.naturalWidth]},{base:base+'/native-followup/pac',bg:stateAt(scene,target).bg});assert.deepEqual(images,[1280,1280])
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('.gal-black')).opacity==='0'&&document.querySelector('.gal-text')?.textContent.trim().length>0&&[...document.querySelectorAll('.gal-bg')].some(e=>getComputedStyle(e).opacity==='1'));
   const rect=await page.locator('.gal-bg').first().boundingBox(),scale=Math.max(rect.width/1280,rect.height/720),x=Math.round(rect.x+(rect.width-1280*scale)/2+f.pixel.x*scale),y=Math.round(rect.y+(rect.height-720*scale)/2+f.pixel.y*scale),pixel=await sharp(await page.screenshot({animations:'disabled'})).extract({left:x,top:y,width:1,height:1}).removeAlpha().raw().toBuffer();assert.ok(f.pixel.rgb.every((v,i)=>Math.abs(v-pixel[i])<=8),`transparent CG must show native background pixel: expected ${f.pixel.rgb}, actual ${[...pixel]}`)

  }else if(f.key==='mv')await page.waitForFunction(()=>[...document.querySelectorAll('.gal-bg')].some(e=>getComputedStyle(e).backgroundImage.includes('SceneA')))
  else await page.waitForFunction(()=>{const c=document.querySelector('canvas.gal-overlay');if(!c)return false;const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<b.length;i+=400)if(b[i]>0)return true;return false})
  if(f.key==='mz'){
   const expected=stateAt(scene,target).overlays.filter(o=>o.src?.includes('/bisty/')),result=await page.evaluate(async({expected,base})=>{const actual=document.querySelector('canvas.gal-overlay'),ref=document.createElement('canvas');ref.width=actual.width;ref.height=actual.height;const ctx=ref.getContext('2d');for(const o of expected){const image=new Image();image.src=base+'?path='+encodeURIComponent(o.src);await image.decode();const crop=o.crop||[0,0,image.naturalWidth,image.naturalHeight],k=Math.min(ref.width/o.stage[0],ref.height/o.stage[1]),x=ref.width/2+o.x*k,y=ref.height/2+o.y*k,w=crop[2]*(o.scaleX||1)*k,h=crop[3]*(o.scaleY||1)*k;ctx.drawImage(image,...crop,x-w*o.anchor[0],y-h*o.anchor[1],w,h)}const a=actual.getContext('2d').getImageData(0,0,ref.width,ref.height).data,b=ctx.getImageData(0,0,ref.width,ref.height).data;let checked=0,bad=0;for(let i=0;i<b.length;i+=4*29)if(b[i+3]===255){checked++;if([0,1,2,3].some(k=>Math.abs(a[i+k]-b[i+k])>2))bad++}return{checked,bad}},{expected,base:base+'/native-followup/mz'});assert.ok(result.checked>100);assert.equal(result.bad,0,'actual native Bisty body + face pixels match independent composite');console.log('Bisty pixels',result)
  }
  await page.screenshot({path:path.join(work,f.key+'-'+target+'.png')});console.log('PASS actual import/resource/player',f.key,target)
 }
 assert.deepEqual(errors,[]);console.log('Native evidence, screenshots, server log retained:',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
