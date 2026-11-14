// Reproduce the HTTP demo complaint with the ORIGINAL SN0000 bytecode. A single
// image is not success: all 25 real text groups, next/previous and CG2 must work.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import path from 'node:path'
import {prepare,parse} from '../../web/library/gal/adapters/age-sys4.mjs'
import {decodeAgeImage} from '../../web/library/gal/age.mjs'
import {encodePng} from '../../web/library/gal/bgi.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test')
const root='.cache/age-http-demo/game',out='.cache/age-http-demo/dialogue-display'
await mkdir(out,{recursive:true})
const profile=JSON.parse(await readFile('.cache/age-http-demo/profile.json'))
const ctx=await prepare({mediaDir:root,options:profile.config.adapterOptions['age::sys4']})
const scene=parse(await readFile(root+'/age/script/sys4ini/SN0000.age','utf8'),ctx)
const expected=scene.steps.filter(s=>s.commands.some(c=>c.op==='text')).map(s=>({index:s.index,text:s.commands.filter(c=>c.op==='text').flatMap(c=>c.segments.map(s=>s.text)).join('')}))
assert.equal(expected.length,25);assert.ok(expected.every(s=>s.text))
const assets=new Map()
for(const name of ['EV901A','EV902A']){const im=decodeAgeImage(await readFile(root+'/'+name+'.AGF'));assets.set('age/res/sys4ini/'+name+'.png',encodePng(im.width,im.height,4,im.rgba))}
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/style.css"><div id="host" style="width:1280px;height:850px"></div>');return}
if(u.pathname==='/asset'){const data=assets.get(u.searchParams.get('path'));if(!data){res.writeHead(404);res.end();return}res.setHeader('Content-Type','image/png');res.end(data);return}
const file=u.pathname.slice(1);if(!/^[a-zA-Z0-9_.-]+\.(js|css)$/.test(file)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(path.join('web/static',file)))}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port
let browser
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
 const page=await browser.newPage({viewport:{width:1320,height:900}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 // Test clock only: remove long cinematic waits while exercising real next().
 await page.addInitScript(()=>{const set=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>set(fn,Math.min(ms||0,20),...args)})
 await page.goto(base)
 await page.evaluate(async({scene,base})=>{const{createGalPlayer}=await import('/gal-player.js');window.player=createGalPlayer({container:document.querySelector('#host'),reader:{node:{},scene,resourceBase:base+'/asset'},startStep:0})},{scene,base})
 const seen=[]
 for(const {index,text} of expected){
  if(index>0){for(let attempt=0;attempt<4;attempt++){await page.evaluate(()=>window.player.next());if(await page.evaluate(()=>window.player.index)===index)break;await page.waitForTimeout(80)}}
  assert.equal(await page.evaluate(()=>window.player.index),index)
  await page.waitForFunction(text=>{const el=document.querySelector('.gal-text')?.cloneNode(true);el?.querySelectorAll('rt').forEach(r=>r.remove());return el?.textContent===text},text)
  seen.push({index,text})
  if([0,13,24].includes(index)){await page.waitForTimeout(150);if(index!==24)await page.waitForFunction(()=>document.querySelector('canvas.gal-overlay')?.dataset.parts==='1');await page.screenshot({path:out+'/line-'+index+'.png'})}
  if(index===13){const pixels=await page.evaluate(async base=>{const actual=document.querySelector('canvas.gal-overlay'),ref=document.createElement('canvas');ref.width=actual.width;ref.height=actual.height;const im=new Image();im.src=base+'/asset?path=age/res/sys4ini/EV902A.png';await im.decode();ref.getContext('2d').drawImage(im,0,0,ref.width,ref.height);const a=actual.getContext('2d').getImageData(0,0,ref.width,ref.height).data,b=ref.getContext('2d').getImageData(0,0,ref.width,ref.height).data;let mismatch=0;for(let i=0;i<a.length;i+=124)if([0,1,2,3].some(k=>Math.abs(a[i+k]-b[i+k])>2))mismatch++;return{mismatch}},base);assert.equal(pixels.mismatch,0,'second native CG must actually replace the first image')}
 }
 await page.evaluate(()=>window.player.prev())
 await page.waitForFunction(text=>{const el=document.querySelector('.gal-text')?.cloneNode(true);el?.querySelectorAll('rt').forEach(r=>r.remove());return el?.textContent===text},expected[23].text)
 await page.locator('.gal-note').click();const diag=await page.locator('.gal-diag pre').textContent()
 assert.match(diag,/第 2 句/);assert.match(diag,/0x35d/);assert.match(diag,/诊断试播/)
 assert.deepEqual(errors,[])
 await writeFile(out+'/verification.json',JSON.stringify({originalBytecode:true,syntheticDialogue:false,originalDialogueGroups:seen.length,nextThroughAll:true,previousRestoresLine24:true,secondCgPixelMatch:true,missingAudioExpected:true,errors,seen},null,2))
 console.log('PASS original AGE: 25 dialogue groups, next/previous and second-CG pixels; audio captures unavailable')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
