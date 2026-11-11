// PAC real audio + synthetic images through import/layout/browse/resource/player.
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import {createGalHandler} from '../../web/library/types/gal.mjs'
import {generateTags} from '../tag-scripts/gal-layout/main.js'
import {encodePng} from '../tag-scripts/gal-download/png.mjs'
import {buildPac} from './make-pac-fixture.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test')
const work=await mkdtemp(path.join(os.tmpdir(),'fe-pac-')),media=path.join(work,'game'),dataDir=path.join(work,'data'),probe=net.createServer()
await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const base=`http://127.0.0.1:${port}`,logs=[],errors=[]
for(const d of ['Pac','data/Script'])await mkdir(path.join(media,d),{recursive:true})
const png=encodePng(320,180,Buffer.alloc(320*180*4,255),4)
await writeFile(path.join(media,'Pac/Game.pac'),buildPac([{name:'data/Graphics/BG/0070.png',data:png},{name:'data/Graphics/CG/023_50.png',data:png}]))
// Reuse an actual collected PCM resource when evidence is present; no codec installation.
const evidence='.cache/new-games-085514/extracted/g02/__followup/files/Pac/Se.pac.head.bin'
let wav
if(existsSync(evidence)){const h=await readFile(evidence),start=Number(h.readBigUInt64LE(8));wav=h.subarray(start,start+h.readUInt32LE(280))}
else{wav=Buffer.alloc(22094);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40)}
await writeFile(path.join(media,'Pac/Se.pac'),buildPac([{name:'data/Sound/SE/000.wav',data:wav}]))
await writeFile(path.join(media,'data/Script/40_2111.txt'),'#BGSET,70,0\n#MSG\nA\nStart\n#CG,23,50,0\n#SEPLAY,0\n#MSG\nB\nCG one\n#MSG\nB\nCG two\n#MSG\nB\nCG three\n#MSG\nB\nEnd\n#END\n')
const h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})}),imp=await h.importFromSource({sourcePath:media,options:{adapters:['pac::script']}}),item=imp.items[0]
await h.patchItemMetadata(item.itemId,(await generateTags({item,script:{version:'2.54.0',options:{}}})).itemPatch)
const home=await h.getReaderContent(item.itemId,'main'),special=home.node.items.find(c=>c.title==='特殊场景'),cards=await h.getReaderContent(item.itemId,'main',{sectionId:special.node}),card=cards.node.items[0]
assert.ok(card.markers?.length);assert.ok(card.thumb,'PAC CG card thumbnail exists')
const server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)))
let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
 const page=await browser.newPage({viewport:{width:1200,height:800}});page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{const NativeAudio=window.Audio;window.__audios=[];window.Audio=function(src){const a=new NativeAudio(src);window.__audios.push(a);return a};window.Audio.prototype=NativeAudio.prototype})
 await page.goto(base);await page.waitForLoadState('networkidle')
 const reader=await h.getReaderContent(item.itemId,'main',{sectionId:card.node});reader.resourceBase=base+reader.resourceBase
 await page.evaluate(async({reader,startStep})=>{document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1200px;height:800px';document.body.append(host);const{createGalPlayer}=await import('/gal-player.js');window.__player=createGalPlayer({container:host,reader,startStep})},{reader,startStep:card.markers[0].step})
 await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('CG one'))
 await page.click('.gal-prev');await page.click('.gal-next-btn')
 await page.waitForFunction(()=>window.__audios.some(a=>/000\.wav/.test(a.src)&&a.currentTime>0&&!a.paused))
 const imageSrc=reader.scene.steps.flatMap(s=>s.commands).find(c=>c.op==='bg'&&c.cg).src
 assert.equal(await page.evaluate(async url=>{const img=new Image();img.src=url;await img.decode();return img.naturalWidth},reader.resourceBase+'?path='+encodeURIComponent(imageSrc)),320)
 assert.ok(await page.locator('.gal-mark-next').isEnabled());assert.deepEqual(errors,[])
 await page.screenshot({path:path.join(work,'pac-player.png')})
 console.log('PASS PAC: special CG card/thumbnail, marker start, PNG lazy resource decode, actual collected WAV playback, no page errors. Artifacts:',work)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(work,'server.log'),logs.join(''))}
