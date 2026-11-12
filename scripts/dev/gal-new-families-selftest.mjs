import{test}from'node:test'
import assert from'node:assert/strict'
import{mkdtemp,mkdir,writeFile,readFile,open}from'node:fs/promises'
import{existsSync}from'node:fs'
import path from'node:path'
import os from'node:os'
import{Scre,buildArcfam}from'./make-arcfam-fixture.mjs'
import{computeMarkers}from'../../web/library/gal/markers.mjs'
import{decodeScre}from'../../web/library/gal/arcfam-decode.mjs'
import{readArcfamIndex}from'../../web/library/gal/arcfam.mjs'
import{readPacIndex}from'../../web/library/gal/pac.mjs'
import*as pac from'../../web/library/gal/adapters/pac-script.mjs'
import{decodeTextFile}from'../../web/library/text-decode.mjs'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
import{encodePng}from'../tag-scripts/gal-download/png.mjs'
import{buildPac}from'./make-pac-fixture.mjs'

test('new eomaia dialect normalizes literal image/audio/character calls; legacy decoder remains supported',()=>{
 const s=new Scre();s.int(1).res('eomaia_image',103,'a001_01.png').int(1).int(0).int(1).res('audio',105,'m01.ogg').int(0).int(0).int(0).res('audio',130,'00_prologue_001.ogg').charCall(102,0,0,960,100,0,'fg_ren.char',1).charCall(103,0,3,'face',1).charCall(105,-1,0).say('test');const ev=decodeScre(s.build())
 assert.ok(ev.some(e=>e[0]==='i'&&e[1]===102&&e[2]==='a001_01.png'));assert.ok(ev.some(e=>e[0]==='v'));assert.ok(ev.some(e=>e[0]==='b'))
 const load=ev.find(e=>e[0]==='m'&&e[1]===101);assert.deepEqual(load.slice(2),[[100,0,'fg_ren.char',1],[0,960,19],{coordMode:'canvas-top-center',slot:0}])
 assert.ok(ev.some(e=>e[0]==='m'&&e[1]===104));assert.ok(decodeScre(new Scre().voice('old.ogg').say('old').build()).some(e=>e[0]==='v'&&e[1]==='old.ogg'))
})
test('PAC parser validates index bounds and actual resource pipeline returns lazy image/audio bytes',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pac-app-')),media=path.join(dir,'game'),png=encodePng(320,180,Buffer.alloc(320*180*4,255),4)
 for(const d of ['Pac','data/Script'])await mkdir(path.join(media,d),{recursive:true})
 const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40)
 await writeFile(path.join(media,'Pac/Game.pac'),buildPac([{name:'data/Graphics/BG/0070.png',data:png},{name:'data/Graphics/CG/023_50.png',data:png}]))
 await writeFile(path.join(media,'Pac/Se.pac'),buildPac([{name:'data/Sound/SE/000.wav',data:wav}]))
 const script='#BGSET,70,0\n#MSG\nNarrator\nStart\n#CG,23,50,0\n#SEPLAY,0\n#MSG\nA\nCG one\n#MSG\nA\nCG two\n#MSG\nA\nCG three\n#MSG\nA\nEnd\n#END\n';await writeFile(path.join(media,'data/Script/40_2111.txt'),script)
 const h=createGalHandler({dataDir:path.join(dir,'data'),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})}),imported=await h.importFromSource({sourcePath:media,options:{adapters:['pac::script']}}),item=imported.items[0],layout=await generateTags({item,script:{version:'2.54.0',options:{}}});assert.equal(layout.itemPatch.gal.config.containers.format,'pac');await h.patchItemMetadata(item.itemId,layout.itemPatch)
 const home=await h.getReaderContent(item.itemId,'main'),special=home.node.items.find(c=>c.title==='特殊场景');assert.ok(special)
 const cards=await h.getReaderContent(item.itemId,'main',{sectionId:special.node});assert.ok(cards.node.items[0].markers?.length)
 const image=await h.getResource(item.itemId,'data/Graphics/CG/023_50.png');assert.deepEqual(await readFile(image.file),png)
 const sound=await h.getResource(item.itemId,'data/Sound/SE/000.wav');assert.deepEqual(await readFile(sound.file),wav)
 const index=await readPacIndex(path.join(media,'Pac/Game.pac'));assert.equal(index.entries.length,2)
 const bad=buildPac([{name:'../escape.png',data:png}]);await writeFile(path.join(dir,'bad.pac'),bad);await assert.rejects(readPacIndex(path.join(dir,'bad.pac')),/路径/)
 console.log('PAC full app artifacts:',dir)
})
const real='.cache/new-games-085514/extracted/g05'
test('all real Night scripts normalize7196 voice calls and3367 image calls without compressed or missing entries',{skip:!existsSync(real)},async()=>{const idx=await readArcfamIndex(real+'/script.arc'),f=await open(real+'/script.arc','r');let voices=0,images=0;try{for(const e of idx.entries){assert.equal(e.size,e.origSize);const b=Buffer.alloc(e.size);await f.read(b,0,e.size,e.offset);for(const c of decodeScre(b)){voices+=c[0]==='v';images+=c[0]==='i'}}}finally{await f.close()}assert.equal(voices,7196);assert.equal(images,3367)})
test('real PAC translated text preserves speaker/body, voice references and special catalog',{skip:!existsSync('.cache/new-games-085514/extracted/g02')},async()=>{const root='.cache/new-games-085514/extracted/g02/',rel='data/Script/01_0070.txt',text=decodeTextFile(await readFile(root+rel)).text,ctx=pac.prepare({texts:{[rel]:text},files:[],options:{}}),s=pac.parse(text,ctx);assert.ok(s.steps.length>10);assert.ok(s.steps.flatMap(s=>s.commands).some(c=>c.kind==='voice'&&c.src.includes('Nyan01_0070_00')));assert.ok(s.steps.flatMap(s=>s.commands).some(c=>c.op==='speaker'&&c.segments[0].text.includes('妮亚美')))})

test('modern unbracketed speaker call and endpoint-only CG classification',()=>{const s=new Scre().str('看護婦').int(0).int(0).int(7).int(23).call().say('台詞');assert.ok(decodeScre(s.build()).some(e=>e[0]==='w'&&e[1]==='看護婦'));const scene={steps:[{commands:[{op:'bg',src:'A001_01.PNG'}]}]},rules=[{kind:'cmd',op:'bg',label:'CG',max:6,pick:'each'}];assert.equal(computeMarkers(scene,rules).length,0);assert.deepEqual(computeMarkers(scene,rules,{includeEndpoints:true}),[{step:0,label:'CG',ratio:0}])})

test('real collected PAC table and PCM WAV payload use exact source ranges',{skip:!existsSync('.cache/new-games-085514/extracted/g02')},async()=>{
 const base='.cache/new-games-085514/extracted/g02/',report=JSON.parse(await readFile(base+'__followup/index.json','utf8')),e=report.files.find(e=>e.artifact==='__followup/files/Pac/Se.pac.head.bin'),head=await readFile(base+e.artifact),dir=await mkdtemp(path.join(os.tmpdir(),'pac-real-')),file=path.join(dir,'Se.pac'),f=await open(file,'w');try{await f.truncate(e.sourceBytes);await f.write(head,0,head.length,0)}finally{await f.close()}
 const idx=await readPacIndex(file),wav=idx.entries.find(e=>e.name==='data/Sound/SE/000.wav');assert.equal(idx.entries.length,233);assert.ok(wav.offset+wav.size<=head.length);assert.equal(head.subarray(wav.offset,wav.offset+4).toString(),'RIFF');assert.equal(wav.size,141360)
})

test('Night layout reuses arcfam, reads native stage and includes first-line CG in special view',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'night-app-')),media=path.join(dir,'night');await mkdir(media)
 const script=new Scre().int(1).res('eomaia_image',103,'a001_01.png').str('看護婦').int(0).int(0).int(7).int(23).call().say('台詞').build()
 await writeFile(path.join(media,'script.arc'),buildArcfam([{name:'REN302.SCRIPT',data:script}]))
 await writeFile(path.join(media,'image.arc'),buildArcfam([{name:'A001_01.PNG',data:encodePng(8,8,Buffer.alloc(256,255),4)}]))
 await writeFile(path.join(media,'systeminfo.json'),JSON.stringify({System:{UniqueGameID:'__FG_REMAKE_YAKIN_RE__'},Screen:{Size:{width:1920,height:1080}}}))
 const h=createGalHandler({dataDir:path.join(dir,'data'),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})}),imp=await h.importFromSource({sourcePath:media,options:{adapters:['arcfam::scre']}}),item=imp.items[0],layout=await generateTags({item,script:{version:'2.54.0',options:{}}})
 assert.deepEqual(layout.itemPatch.gal.config.adapterOptions['arcfam::scre'].stage,[1920,1080]);await h.patchItemMetadata(item.itemId,layout.itemPatch)
 const home=await h.getReaderContent(item.itemId,'main'),special=home.node.items.find(c=>c.title==='特殊场景');assert.ok(special,JSON.stringify(home.node));const group=await h.getReaderContent(item.itemId,'main',{sectionId:special.node});assert.equal(group.node.items.length,1);const reader=await h.getReaderContent(item.itemId,'main',{sectionId:group.node.items[0].node});assert.ok(reader.scene.steps.flatMap(s=>s.commands).some(c=>c.op==='speaker'&&c.segments[0]?.text==='看護婦'))
})

test('PAC background effects resolve BGM archive separately from ordinary SE',()=>{const s=pac.parse('#BGSPLAY,5\n#SEPLAY,5\n#MSG\nA\nline\n#END\n',pac.prepare({files:[],texts:{},options:{}})),c=s.steps.flatMap(s=>s.commands);assert.ok(c.some(c=>c.op==='bgse'&&c.src==='data/Sound/BGM/005.ogg'));assert.ok(c.some(c=>c.op==='se'&&c.src==='data/Sound/SE/005.wav'))})

test('actual Night REN301 uses native1920x1080 canvas coordinates and a real face atlas frame',async()=>{
 const {arcfamScreAdapter}=await import('../../web/library/gal/adapters/arcfam-scre.mjs'),root='.cache/new-games-155817/extracted/g02/__media',names=['FG_REN04A01L.CHAR','FG_REN04A01L_FACE.JSON','FG_REN04A01L_0.PNG','FG_REN04A01L_FACE.PNG'],texts={};for(const n of names.filter(n=>/\.(char|json)$/i.test(n)))texts['arc/res/'+n]=await readFile(root+'/'+n,'utf8');const ctx=arcfamScreAdapter.prepare({options:{stage:[1920,1080]},files:names.map(n=>'arc/res/'+n),texts,toResourcePath:r=>r.replace(/^arc\/res\//,'')})
 const idx=await readArcfamIndex('.cache/new-games-085514/extracted/g05/script.arc'),entry=idx.entries.find(e=>e.name==='REN301.SCRIPT'),f=await open('.cache/new-games-085514/extracted/g05/script.arc','r'),b=Buffer.alloc(entry.size);try{await f.read(b,0,b.length,entry.offset)}finally{await f.close()}const events=decodeScre(b),at=events.findIndex(e=>e[0]==='m'&&e[1]===101&&String(e[2]?.[2]).toLowerCase()==='fg_ren04a01l.char'),scene=arcfamScreAdapter.parse(JSON.stringify({format:'arcfam-scre/1',events:events.slice(at,at+9)}),ctx),stand=scene.steps.flatMap(s=>s.commands).find(c=>c.op==='stand'&&c.parts?.length>=2)
 assert.ok(stand);assert.equal(stand.slot,'eomaia:1');assert.deepEqual(stand.stage,[1920,1080]);assert.equal(stand.parts[0].x,0);assert.equal(stand.parts[0].y,0);const face=stand.parts.find(p=>p.crop);assert.equal(face.x,739+356/2-960);assert.equal(face.y,211+311/2-540);assert.ok(face.crop.every(Number.isFinite))
})
