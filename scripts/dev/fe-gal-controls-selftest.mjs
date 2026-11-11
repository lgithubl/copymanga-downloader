import assert from 'node:assert/strict'
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import {createGalHandler} from '../../web/library/types/gal.mjs'
import {generateTags} from '../tag-scripts/gal-layout/main.js'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test')
const work=await mkdtemp(path.join(os.tmpdir(),'gal-controls-')),dataDir=path.join(work,'data'),probe=net.createServer()
await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const base=`http://127.0.0.1:${port}`,logs=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']})
server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)))
let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
 const page=await browser.newPage({viewport:{width:1200,height:800}})
 await page.addInitScript(()=>{const NativeAudio=window.Audio;window.__audios=[];window.__plays=[];window.Audio=function(src){const a=new NativeAudio(src);window.__audios.push(a);const play=a.play.bind(a);a.play=()=>{window.__plays.push({src:a.src,loop:a.loop,volume:a.volume});return play()};return a};window.Audio.prototype=NativeAudio.prototype})
 await page.goto(base);await page.waitForLoadState('networkidle')
 const mount=async(reader,startStep=0)=>page.evaluate(async({reader,startStep})=>{window.__testPlayer?.destroy();document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1200px;height:800px';document.body.append(host);localStorage.setItem('copymanga.gal.autoChoice','1');const {createGalPlayer}=await import('/gal-player.js');window.__testPlayer=createGalPlayer({container:host,reader,startStep})},{reader,startStep})
 const commands=[{op:'text',segments:[{text:'start'}]},{op:'choice',id:'1:0',var:'picked',options:[{value:1,segments:[{text:'A'}]},{value:2,segments:[{text:'B'}]}]},{op:'text',segments:[{text:'after'}]},{op:'text',segments:[{text:'end'}]}]
 await mount({resourceBase:base,node:{markers:[]},scene:{format:'gal-scene/1',steps:commands.map((c,index)=>({index,commands:[c]})),stats:{}}})
 await page.click('.gal-next-btn');await page.waitForSelector('.gal-choices:visible');await page.waitForTimeout(1100)
 assert.equal(await page.locator('.gal-choices:visible').count(),1,'ordinary mode never auto-selects even when preference is enabled')
 await page.click('.gal-auto');await page.waitForSelector('.gal-choices',{state:'hidden'})
 console.log('PASS ordinary mode preserves choice; auto mode selects according to preference')
 const source=path.resolve('.cache/rpg-packed-063854/sparse')
 if(existsSync(source)){
  const handler=createGalHandler({dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})})
  const imported=await handler.importFromSource({sourcePath:source,options:{adapters:['rpgmaker-json']}}),item=imported.items[0],id=item.itemId
  const layout=await generateTags({item,script:{version:'2.53.0',options:{}},tags:[]});await handler.patchItemMetadata(id,layout.itemPatch)
  const home=await handler.getReaderContent(id,'main'),common=home.node.items.find(x=>x.title==='公共事件'),cards=await handler.getReaderContent(id,'main',{sectionId:common.node}),card=cards.node.items.find(x=>x.id.endsWith('common-95'))
  assert.ok(card,'real common event95 must exist')
  const reader=await handler.getReaderContent(id,'main',{sectionId:card.node}),at=reader.scene.steps.findIndex(s=>s.commands.some(c=>c.src==='audio/voice/1080.ogg'))
  assert.ok(at>=0);reader.resourceBase=base+reader.resourceBase
  await mount(reader,at)
  await page.waitForFunction(()=>window.__audios.some(a=>/1080\.ogg/.test(a.src)&&a.currentTime>0&&!a.paused),null,{timeout:15000})
  assert.ok(await page.locator('.gal-replay-btn').isEnabled())
  const count=await page.evaluate(()=>window.__plays.filter(x=>/1080\.ogg/.test(x.src)).length)
  await page.click('.gal-replay-btn')
  assert.equal(await page.evaluate(()=>window.__plays.filter(x=>/1080\.ogg/.test(x.src)).length),count+1)
  assert.ok(await page.locator('.gal-log-btn').evaluate(e=>e.nextElementSibling.classList.contains('gal-replay-btn')))
  await page.click('.gal-cfg');assert.equal(await page.locator('[data-audio-group="voice"]').isVisible(),true)
  assert.ok(await page.evaluate(()=>window.__plays.some(x=>/1080\.ogg/.test(x.src)&&x.loop===false&&x.volume>0)))
  console.log('PASS RJ01220265: actual packed/encrypted1080 voice plays, is non-looping, voice controls visible, replay restarts current voice')
 }
 console.log('Artifacts retained:',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
