// Real WebGL regression: a new skin must activate attachments in previously
// empty slots. Also reproduce collected TSK Ch10340034 step 45 -> 46.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { encodePng } from '../tag-scripts/gal-download/png.mjs'
import { stateAt } from '../../web/static/gal-engine.js'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '@playwright/test')
const runtime = [process.env.SPINE40_RUNTIME, 'web/static/vendor/spine-webgl-4.0.js', '.cache/tsk-coverage-2.2.3/vendor/spine-webgl-4.0.js'].find(p=>p&&existsSync(p))
assert.ok(runtime, 'An existing official Spine 4.0 runtime is required; this test never downloads one')
const work=await mkdtemp(path.join(os.tmpdir(),'gal-skin-')),fixture=path.resolve('.cache/tsk-ch10340034')
const skeleton={skeleton:{spine:'4.0.64',width:200,height:400},bones:[{name:'root'}],slots:[{name:'body',bone:'root',attachment:'body'},{name:'eyes',bone:'root',attachment:'eyes_setup'}],skins:[
 {name:'default',attachments:{body:{body:{type:'region',path:'body',x:0,y:200,width:200,height:400}}}},
 {name:'face1',attachments:{}},
 {name:'face6',attachments:{eyes:{eyes_setup:{type:'region',path:'body',x:0,y:300,width:80,height:20,color:'ff0000ff'}}}},
],animations:{wait:{bones:{root:{translate:[{time:0,x:0,y:0},{time:2,x:0,y:0}]}}}}}
const png=encodePng(32,64,Buffer.alloc(32*64*4,255),4)
const atlas='body.png\nsize: 32,64\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbody\n  bounds: 0,0,32,64\n'
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
const media=existsSync(fixture+'/collected-root.txt')?(await readFile(fixture+'/collected-root.txt','utf8')).trim():null
await page.route('http://skin-test.local/**',async route=>{
 const name=decodeURIComponent(new URL(route.request().url()).pathname)
 if(name==='/')return route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#555}#stage{position:relative;width:1280px;height:720px}canvas{position:absolute;width:100%;height:100%}</style><div id="stage"></div>'})
 if(name==='/media/fixture/skeleton.json')return route.fulfill({contentType:'application/json',body:JSON.stringify(skeleton)})
 if(name==='/media/fixture/skeleton.atlas.txt')return route.fulfill({body:atlas})
 if(name==='/media/fixture/body.png')return route.fulfill({contentType:'image/png',body:png})
 const file=name.startsWith('/vendor/')?path.resolve(runtime):name.startsWith('/media/')&&media?path.join(media,name.slice(7)):path.join(process.cwd(),'web/static',name)
 try{
  let bytes=await readFile(file)
  if(name==='/gal-spine.js'){
   const source=bytes.toString(),needle='attachmentsSetup: inst.attachmentsSetup'
   assert.ok(source.includes(needle))
   bytes=Buffer.from(source.replace(needle,'testSlots: inst.skeleton?.slots.map(s=>({name:s.data.name,attachment:s.getAttachment()?.name||null})), testTime: inst.state?.tracks[0]?.trackTime, attachmentsSetup: inst.attachmentsSetup'))
  }
  return route.fulfill({body:bytes,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream'})
 }catch{return route.fulfill({status:404,body:'Missing '+name})}
})
try{
 await page.goto('http://skin-test.local/')
 await page.evaluate(async()=>{const {createSpineLayer}=await import('/gal-spine.js');window.layer=createSpineLayer({parent:document.getElementById('stage'),url:p=>'/media/'+p})})
 const show=async spec=>{
  await page.evaluate(async spec=>{await layer.set(spec?{Chara1:spec}:{},{live:true})},spec)
  await page.waitForTimeout(100)
  return page.evaluate(()=>layer.info()[0]||null)
 }
 const base={skel:'fixture/skeleton.json',atlas:'fixture/skeleton.atlas.txt',kind:'chara',anim:'wait',loop:true,freeze:true,seek:0.5,x:0.5}
 const before=await show({...base,skin:'face1'})
 assert.equal(before.loaded,true);assert.equal(before.testSlots.find(s=>s.name==='eyes').attachment,null)
 const sequential=await show({...base,skin:'face6'})
 await show(null);const direct=await show({...base,skin:'face6'})
 assert.equal(direct.testSlots.find(s=>s.name==='eyes').attachment,'eyes_setup')
 assert.deepEqual(sequential.testSlots,direct.testSlots,'skin switch must activate previously empty slots just like a fresh load')
 assert.equal(sequential.testTime,before.testTime,'skin switch must preserve the running animation time')
 const red=await page.evaluate(()=>{const c=document.querySelector('canvas.gal-spine'),copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;const ctx=copy.getContext('2d');ctx.drawImage(c,0,0);const d=ctx.getImageData(0,0,copy.width,copy.height).data;let count=0;for(let i=0;i<d.length;i+=4)if(d[i]>180&&d[i+1]<80&&d[i+2]<80&&d[i+3]>0)count++;return count})
 assert.ok(red>0,'the new skin must actually draw its eye attachment')
 const restored=await show({...base,skin:'face1'})
 assert.equal(restored.testSlots.find(s=>s.name==='eyes').attachment,null,'returning to the old skin must remove attachments it does not contain')
 assert.equal(restored.testTime,before.testTime)
 console.log('PASS sparse skin: new eye attachment visible; sequential = direct; animation time preserved')
 if(media&&existsSync(fixture+'/patched-scene.json')){
  const scene=JSON.parse(await readFile(fixture+'/patched-scene.json'))
  const a={...stateAt(scene,44,{'24:0':1}).spines.Chara1,freeze:true,seek:0.5},b={...stateAt(scene,45,{'24:0':1}).spines.Chara1,freeze:true,seek:0.5}
  await show(null);const previous=await show(a),next=await show(b)
  await page.screenshot({path:path.join(work,'tsk-step46-sequential.png')})
  await show(null);const fresh=await show(b)
  assert.equal(next.skin,'face6');assert.equal(next.error,'');assert.equal(next.testSlots.find(s=>s.name==='face_eye_etc').attachment,'face_6_eye5')
  assert.deepEqual(next.testSlots,fresh.testSlots);assert.equal(next.testTime,previous.testTime)
  await writeFile(path.join(work,'real-transition.json'),JSON.stringify({previous,next,fresh},null,2))
  console.log('PASS real TSK Ch10340034 45 -> 46: face_6_eye5 restored; sequential = direct; animation time preserved')
 }
 assert.deepEqual(errors,[])
 console.log('Artifacts retained:',work)
}finally{await browser.close()}
