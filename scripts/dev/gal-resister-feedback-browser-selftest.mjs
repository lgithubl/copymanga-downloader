// Real native models and audio. No replacement textures or fake Audio objects.
import assert from'node:assert/strict'
import fs from'node:fs/promises'
import{existsSync}from'node:fs'
import{createRequire}from'node:module'
import{createGalHandler}from'../../web/library/types/gal.mjs'
const base='.cache/rj01435937-20261118',out=base+'/browser/feedback',info=JSON.parse(await fs.readFile(base+'/handler.json'))
const h=createGalHandler({dataDir:info.dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({})})
const{chromium}=createRequire(import.meta.url)('/tmp/gal-six-playwright/node_modules/playwright')
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']}),report=[]
await fs.mkdir(out,{recursive:true})
try{for(const id of ['DLCFela','Fela','MovieH']){
 const reader=await h.getReaderContent(info.id,'main',{sectionId:'s:interaction/'+id+'.resister'});reader.resourceBase='/media/'
 const role=reader.scene.interaction.roles[0],action=role.tools.find(t=>t.id==='motion').areas.find(a=>a.id==='handjob'),expected=action.replies[0]
 assert.ok(expected.sound,id+' has the original handjob sound');if(id!=='MovieH')assert.ok(expected.voice,id+' has the verified native breathing voice')
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],missing=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('http://resister-feedback.test/**',async route=>{const u=new URL(route.request().url());try{
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/style.css"><div id="host"></div>'})
  if(u.pathname==='/favicon.ico')return route.fulfill({status:204})
  if(u.pathname==='/media/'){const r=await h.getResource(info.id,u.searchParams.get('path'));return route.fulfill({contentType:r.contentType,body:await fs.readFile(r.file)})}
  return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile('web/static'+u.pathname)})
 }catch(e){missing.push(u.pathname+u.search+': '+e.message);return route.fulfill({status:404,body:e.message})}})
 try{
  await page.goto('http://resister-feedback.test');await page.evaluate(async({reader,id})=>{const Native=window.Audio;window.audios=[];window.Audio=class extends Native{constructor(src){super(src);audios.push(this)}};const{createGalPlayer}=await import('/gal-player.js');window.player=createGalPlayer({container:document.getElementById('host'),reader,viewKey:'feedback-'+id})},{reader,id})
  const ready=()=>page.waitForFunction(()=>document.querySelector('.gal-interaction')?.dataset.loading==='false',null,{timeout:60000});await ready()
  const settings=await page.locator('.gal-interaction-settings').boundingBox(),regions=await page.locator('.gal-interaction-regions').boundingBox();assert.ok(settings.x+settings.width<regions.x,'settings stay left, regions stay right')
  const group=page.locator('.gal-interaction-alternative-list[data-tool="motion"][data-area="handjob"]'),trigger=group.locator('.gal-interaction-trigger')
  assert.ok((await trigger.boundingBox()).width<(await page.locator('button[data-tool="motion"][data-region="handjob"]').boundingBox()).width*.65,'compact trigger')
  await trigger.click();await ready()
  await page.waitForFunction(paths=>paths.every(path=>audios.some(a=>new URL(a.src,location.href).searchParams.get('path')===path&&a.currentTime>0&&!a.error)),[expected.sound,expected.voice].filter(Boolean),{timeout:30000})
  const initialPlayback=await page.evaluate(()=>audios.filter(a=>a.currentTime>0).map(a=>({path:new URL(a.src,location.href).searchParams.get('path'),time:a.currentTime,error:a.error?.message})))
  const frame1=await page.locator('.gal-interaction-world').screenshot();await page.waitForTimeout(450);const frame2=await page.locator('.gal-interaction-world').screenshot();assert.notDeepEqual(frame1,frame2,'real handjob motion advances')
  await page.screenshot({path:out+'/'+id+'.png'})
  assert.equal(await page.locator('.gal-interaction-speech').textContent(),'','audio aliases are labels, not fabricated dialogue')
  const stored=await page.evaluate(id=>JSON.parse(localStorage.getItem('copymanga.gal.interaction.feedback-'+id)),id);assert.ok(stored[id].enabledAreas.some(a=>a.tool==='motion'&&a.area==='handjob'),'one-shot trigger retains the selected motion')
  const voiceGroup=page.locator('.gal-interaction-alternative-list[data-tool="voice"][data-area="voice/talk"]'),voice=role.tools.find(t=>t.id==='voice').areas.find(a=>a.id==='voice/talk').replies[2]
  await voiceGroup.locator('button[data-value="2"]').click();const voiceTrigger=voiceGroup.locator('.gal-interaction-trigger');await voiceTrigger.click()
  if(expected.voice){await page.waitForFunction(()=>document.querySelector('.gal-interaction').dataset.queuedTriggers==='1');assert.equal(await voiceTrigger.textContent(),'待播放');assert.equal(await page.evaluate(path=>audios.some(a=>new URL(a.src,location.href).searchParams.get('path')===path),voice.voice),false);await page.evaluate(path=>{const a=audios.find(a=>new URL(a.src,location.href).searchParams.get('path')===path);a.playbackRate=16},expected.voice)}
  await page.waitForFunction(path=>audios.some(a=>new URL(a.src,location.href).searchParams.get('path')===path&&a.currentTime>0&&!a.error),voice.voice,{timeout:30000});assert.equal(await voiceTrigger.textContent(),'触发')
  const played=await page.evaluate(()=>audios.filter(a=>a.currentTime>0).map(a=>({path:new URL(a.src,location.href).searchParams.get('path'),time:a.currentTime,duration:a.duration,error:a.error?.message})))
  if(id==='DLCFela'){await page.getByRole('button',{name:'全屏',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);assert.ok(await page.locator('.gal-interaction-settings').isVisible());assert.ok(await page.locator('.gal-interaction-regions').isVisible());await page.evaluate(()=>document.exitFullscreen());await page.setViewportSize({width:390,height:844});await page.locator('.gal-interaction-settings>summary').click();await page.locator('.gal-interaction-regions>summary').click();assert.equal(await page.locator('.gal-interaction-settings').getAttribute('open'),null);assert.equal(await page.locator('.gal-interaction-regions').getAttribute('open'),null);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);report.push({id,initialPlayback,played,errors,missing});console.log('PASS',id,'native handjob render, real voice/sound, chosen voice, motion retained, left/right docks and compact trigger')
 }finally{await page.evaluate(()=>window.player?.destroy()).catch(()=>{});await page.close()}
}await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2))}finally{await browser.close()}
