import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {encodePng} from '../../web/library/gal/bgi.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test')
const red=encodePng(1,1,4,Buffer.from([255,0,0,255])),blue=encodePng(1,1,4,Buffer.from([0,0,255,255])),errors=[]
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><body>');return}if(u.pathname==='/image'){res.setHeader('Content-Type','image/png');res.end(u.searchParams.get('path')==='red'?red:blue);return}if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return}if(!/^\/[\w.-]+\.js$/.test(u.pathname))throw Error('route');res.setHeader('Content-Type','text/javascript');res.end(await readFile('web/static'+u.pathname))}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:'+server.address().port)
 await page.evaluate(async()=>{
  const raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);window.pendingRaf=new Set();window.requestAnimationFrame=cb=>{let id=raf(time=>{pendingRaf.delete(id);cb(time)});pendingRaf.add(id);return id};window.cancelAnimationFrame=id=>{pendingRaf.delete(id);cancel(id)}
  const{createOverlayLayer}=await import('/gal-stand.js');window.events=0;window.layer=createOverlayLayer({parent:document.body,url:src=>'/image?path='+src,onEvent:()=>{events++;return null}});window.spec={slot:'native',src:'red',fit:'cover',animation:{key:'action1',frames:[{src:'red',seconds:.12},{src:'blue',seconds:.12,event:{test:true}}]}};await layer.set([spec]);window.sample=()=>Array.from(layer.canvas.getContext('2d').getImageData(500,500,1,1).data).join(',')
 });await page.waitForFunction(()=>sample()==='255,0,0,255');await page.waitForFunction(()=>sample()==='0,0,255,255');assert.ok(await page.evaluate(()=>events)>0)
 const paused=await page.evaluate(()=>{layer.setPaused(true);return{color:sample(),events}});await page.waitForTimeout(400);assert.deepEqual(await page.evaluate(()=>({color:sample(),events})),paused);assert.equal(await page.evaluate(()=>pendingRaf.size),0,'paused loops stop scheduling frames')
 await page.evaluate(()=>layer.setPaused(false));await page.waitForFunction(n=>events>n,paused.events)
 await page.evaluate(async()=>{await layer.set([{...spec,animation:undefined,motion:{key:'pan',from:[0,0],to:[20,30],seconds:1}}],{live:false});layer.destroy()});assert.equal(await page.evaluate(()=>pendingRaf.size),0,'destroy cancels loops and legacy motion')
 await page.evaluate(async()=>{const{createOverlayLayer}=await import('/gal-stand.js');window.thumb=createOverlayLayer({parent:document.body,url:src=>'/image?path='+src,animated:false});await thumb.set([spec]);});await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>pendingRaf.size),0,'thumbnail is a still snapshot');await page.evaluate(()=>thumb.destroy());assert.deepEqual(errors,[])
 console.log('PASS browser visible frame changes and triggers, pause/resume, static thumbnails, legacy motion and RAF cleanup')
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
