// Verify real-script marker cards pass the requested step into the existing player.
// GAL_MARKER_SAMPLES points to a local {tomoe:[{name,scene,markers}],artemis:[...]} audit.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')
const samples = JSON.parse(await readFile(process.env.GAL_MARKER_SAMPLES))
const tests = [
  {game:'tomoe',sample:samples.tomoe.find(s=>s.name==='4_1'),label:'背景人声开始'},
  {game:'artemis',sample:samples.artemis.find(s=>s.name==='01_共通_03.ast'),label:'CG 开始'}
]
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
try {
  const page = await browser.newPage({viewport:{width:1200,height:900}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')
  const wav=Buffer.alloc(44+8000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8000,40)
  await page.route('http://markers.test/**',async route=>{
    const rel=decodeURIComponent(new URL(route.request().url()).pathname)
    if(rel==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="test"></div>'})
    if(rel.startsWith('/resource/'))return route.fulfill({body:/\.(ogg|wav|m4a)$/.test(rel)?wav:png,contentType:/\.(ogg|wav|m4a)$/.test(rel)?'audio/wav':'image/png'})
    try {return route.fulfill({body:await readFile(path.join(process.cwd(),'web/static',rel)),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}
  })
  await page.goto('http://markers.test/')
  for(const {game,sample,label} of tests){
    assert.ok(sample);const marker=sample.markers.find(m=>m.label===label);assert.ok(marker)
    await page.evaluate(async sample=>{
      window.player?.destroy();window.cards?.destroy();window.calls=[];window.reported=[]
      const {createGalBrowser}=await import('/gal-browse.js'),{createGalPlayer}=await import('/gal-player.js')
      const container=document.getElementById('test'),nodeId='s:sample'
      const reader={type:'gal',item:{itemId:'marker-test',config:{}},unit:{unitId:'main'},resourceBase:'/resource',node:{id:'',kind:'cards',title:'scripts',parent:null,breadcrumb:[],sets:[],page:1,pageCount:1,total:1,pageSize:100,items:[{type:'script',node:nodeId,title:sample.name,markers:sample.markers}]}}
      window.cards=createGalBrowser({container,reader,onOpen:(node,kind,extra)=>{window.calls.push({node,kind,extra});window.cards.destroy();window.player=createGalPlayer({container,reader:{...reader,scene:{format:'gal-scene/1',...sample.scene},node:{id:nodeId,kind:'player'}},startStep:extra?.at,onStep:step=>window.reported.push(step)})}})
    },sample)
    await page.locator(`.gal-card-mark[data-step="${marker.step}"]`).click()
    const result=await page.evaluate(()=>({calls:window.calls,index:window.player.index,reported:window.reported}))
    assert.equal(result.calls.length,1,'marker click must not also activate the card')
    assert.equal(result.calls[0].extra.at,marker.step)
    assert.equal(result.index,marker.step)
    assert.ok(result.reported.includes(marker.step))
    console.log(`PASS ${game} real script: card button "${label}" starts player at step ${marker.step}`)
  }
  assert.deepEqual(errors,[])
}finally{await browser.close()}
