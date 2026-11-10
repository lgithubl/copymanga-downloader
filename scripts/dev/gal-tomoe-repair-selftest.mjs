import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,writeFile,stat} from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import {decodeBitmap,decodeArc,parseDrawImageKeys,lzssDecode,parseResourceTable,parseSoundTable,splitChapters,splitScenesForTest} from '../../web/library/gal/tomoe.mjs'
import {parse,prepare} from '../../web/library/gal/adapters/tomoe-arc04.mjs'
import {archiveToTmp} from '../tag-scripts/gal-download/archive.mjs'
const u32=(...v)=>{const b=Buffer.alloc(v.length*4);v.forEach((n,i)=>b.writeUInt32LE(n>>>0,i*4));return b}
const num=n=>Buffer.concat([Buffer.from('N'),u32(n)])
const record=b=>Buffer.concat([u32(b.length+4),b,u32(9999)])
const op=(m,...v)=>record(Buffer.concat([Buffer.from('M'+m),...v.map(num)]))
const text=t=>{const b=Buffer.alloc(9+t.length*2);b[0]=84;b.writeUInt32LE(1,1);b.writeUInt32LE(t.length,5);for(let i=0;i<t.length;i++)b.writeUInt16LE(t.charCodeAt(i)^t.length,9+i*2);return record(b)}
const table=blocks=>{let at=0;return Buffer.concat(blocks.map((b,i)=>{const tail=Buffer.alloc(7);tail.writeUInt16LE(0x3000^97);const row=Buffer.concat([u32(23,i,b.length,b.length,at),tail]);at+=b.length;return row}))}
const draw=(id,layer)=>['$',204,1,0,id,0,layer,1]
const scene=events=>JSON.stringify({format:'tomoe-arc04/1',events})
const stateOf=steps=>{let bg='';const ov=new Map();for(const step of steps)for(const c of step.commands){if(c.op==='bg')bg=c.src||'';if(c.op==='overlay')ov.set(c.slot,c.src);if(c.op==='overlayOff')ov.delete(c.slot)}return {bg,overlays:[...ov].sort()}}

test('difference mask starts at 29 and reconstructs against the declared complete base',()=>{
 const base=Buffer.alloc(33+40*3);base[0]=97;base.writeUInt32LE(40,9);base.writeUInt32LE(1,13);base.fill(10,33)
 const head=Buffer.alloc(29);head[0]=97;head.writeUInt32LE(10000000,1);head.writeUInt32LE(40,9);head.writeUInt32LE(1,13);head.writeUInt32LE(1,17);head.writeUInt32LE(5,25)
 const mask=Buffer.from([1,0,0,0,128]),d=Buffer.concat([head,mask,u32(6),Buffer.from([1,2,3,4,5,6])]);const out=decodeBitmap(d,{base})
 assert.deepEqual([...out.pixels.subarray(0,4)],[3,2,1,255]);assert.deepEqual([...out.pixels.subarray(4,8)],[10,10,10,255]);assert.deepEqual([...out.pixels.subarray(39*4)],[6,5,4,255])
 const broken=Buffer.from(d);broken[29]=0;assert.throws(()=>decodeBitmap(broken,{base}),/遮罩与色彩/)
 assert.throws(()=>decodeBitmap(d.subarray(0,-1),{base}),/色彩长度/)
})

test('Arc01 resource boundaries exclude control-flow debug blocks but retain short real stories',()=>{
 const menu=Buffer.concat([op('#',2,2),text('menu')]),debug=Buffer.concat([text('12345678901234567890'),op('#',1,3)]),story=Buffer.concat([draw(230,140)].map(e=>op(e[0],...e.slice(1))).concat([text('story'),op('#',87)]));const blocks=[menu,debug,story],out=splitChapters(Buffer.concat(blocks),{indexTable:table(blocks)})
 assert.equal(out.chapters.length,1);assert.equal(out.chapters[0].resource,2);assert.equal(out.chapters[0].texts,1);assert.equal(out.skipped.length,2)
})

test('voice, looping SE and BGM resolve through distinct native namespaces, with correct flat fallback',()=>{
 const events=[['#',43,803,1],['T','a'],['#',87],['#',114,803],['#',131,0,-1],['T','b'],['#',87]]
 const files=['arc/res/snd/voice/803.ogg','arc/res/snd/se/803.ogg','arc/res/snd/bgm/0.ogg'];const run=(files,options={})=>parse(scene(events),prepare({options,files,toResourcePath:r=>r.replace(/^arc\/res\//,'')})).steps.flatMap(s=>s.commands)
 const commands=run(files,{bgmBase:6018});assert.equal(commands.find(c=>c.op==='voice').src,'snd/voice/803.ogg');assert.equal(commands.find(c=>c.op==='bgse').src,'snd/se/803.ogg');assert.equal(commands.find(c=>c.op==='bgm').src,'snd/bgm/0.ogg')
 const legacy=run(['arc/res/snd/803.ogg','arc/res/snd/5130.ogg','arc/res/snd/6017.ogg']);assert.equal(legacy.find(c=>c.op==='bgse').src,'snd/5130.ogg');assert.equal(legacy.find(c=>c.op==='bgm').src,'snd/6017.ogg')
})

test('clear/transition removes stale layers and scene snapshots match continuous playback',()=>{
 const files=[1,2,3,4].map(n=>`arc/res/img/${n}.png`),ctx=prepare({files,toResourcePath:r=>r.replace(/^arc\/res\//,'')})
 const events=[draw(1,120),draw(2,140),['T','a'],['#',87],['#',29,2],['#',35,9999],draw(3,140),['#',13,2],['T','b'],['#',87],['#',29,2],draw(4,132),['#',13,2],['T','c'],['#',87]]
 const full=parse(scene(events),ctx);assert.equal(stateOf(full.steps.slice(0,2)).bg,'img/3.png')
 const parts=splitScenesForTest(events,{sceneTexts:1,sceneMax:1});assert.ok(parts.length>1);assert.deepEqual(stateOf(parse(scene(parts.at(-1).events),ctx).steps),stateOf(full.steps))
 assert.ok(!parts.at(-1).events.some(e=>e[0]==='$'&&e[4]===1))
})

const sampleRoot=path.resolve('.cache/tomoe-analysis'),hasReal=fs.existsSync(path.join(sampleRoot,'core/g14/Arc04.dat'))
test('real Arc01: all 74 story resources are retained, official opening has no numeric test prelude', {skip:!hasReal},async()=>{
 const out=splitChapters(await readFile(path.join(sampleRoot,'core/g14/Arc04.dat')),{indexTable:decodeArc(await readFile(path.join(sampleRoot,'core/g14/Arc01.dat')))})
 assert.deepEqual(out.chapters.map(c=>c.resource),Array.from({length:74},(_,i)=>i+4));assert.equal(out.chapters[0].events.find(e=>e[0]==='T')[1].trim(),'夜はろくでもないやつらの時間だ。');assert.ok(out.chapters[0].events.some(e=>e[0]==='$'&&e[4]===230));assert.ok(out.chapters[0].events.some(e=>e[0]==='$'&&e[4]===231));assert.ok(!out.chapters.some(c=>c.resource===3));assert.ok(out.chapters.every(c=>!c.events.some(e=>e[0]==='T'&&/^1234567890/.test(e[1]))))
 const sounds=parseSoundTable(decodeArc(await readFile(path.join(sampleRoot,'core/g14/Arc03.dat'))));assert.equal(sounds.filter(s=>s.type==='k')[803].id,5131);assert.equal(sounds.filter(s=>s.type==='u')[0].id,6018)
})

test('real difference images: 112 strict masks, available declared bases produce opaque complete frames', {skip:!hasReal},async()=>{
 const samples=JSON.parse(await readFile(path.join(sampleRoot,'image-headers.json'))).samples;const byKey=new Map(samples.filter(s=>s.flag===0).map(s=>[s.key,s]));let patches=0,reconstructed=0
 const read=s=>{const data=fs.readFileSync(s.path),a=Number(s.path.match(/_a(\d+)$/)[1]);return a?lzssDecode(data,a):data}
 for(const s of samples.filter(s=>s.flag===1)){const d=read(s),partial=decodeBitmap(d);assert.equal(partial.pixels.length,s.w*s.h*4);patches++;const base=byKey.get(s.key);if(base){const full=decodeBitmap(d,{base:read(base)});for(let i=3;i<full.pixels.length;i+=4)assert.equal(full.pixels[i],255);reconstructed++}}
 assert.equal(patches,112);assert.ok(reconstructed>=60,`only ${reconstructed} bases available`)
})

test('hybrid container reconstructs a cross-file base, exports typed audio, and regenerates indexed scripts',async()=>{
 const {ensureContainers,virtualFiles,virtualEntry,materialize}=await import('../../web/library/gal/containers.mjs')
 const {normalizeGalConfigWithWarnings}=await import('../../web/library/gal/config.mjs')
 const {tinkDecrypt}=await import('../../web/library/gal/tomoe.mjs')
 const {inflateSync}=await import('node:zlib')
 const root=await mkdtemp('/tmp/tomoe-repair-')
 const literal=b=>{const chunks=[];for(let i=0;i<b.length;i+=8)chunks.push(Buffer.from([(1<<Math.min(8,b.length-i))-1]),b.subarray(i,i+8));return Buffer.concat(chunks)}
 const arc=b=>{const c=literal(b);const d=n=>Buffer.from(String(n).padStart(8,'0').split('').map(x=>Number(x)^127));return Buffer.concat([d(b.length),d(c.length),c])}
 try{
 await mkdir(path.join(root,'Resources'))
 const base=Buffer.alloc(33+6);base[0]=97;base.writeUInt32LE(2,9);base.writeUInt32LE(1,13);base.set([1,2,3,4,5,6],33)
 const head=Buffer.alloc(29);head[0]=97;head.writeUInt32LE(10000000,1);head.writeUInt32LE(2,9);head.writeUInt32LE(1,13);head.writeUInt32LE(1,17);head.writeUInt32LE(1,25)
 const delta=Buffer.concat([head,Buffer.from([2]),u32(3),Buffer.from([9,8,7])])
 await writeFile(path.join(root,'Resources/Data00.dat'),Buffer.concat([u32(2),u32(1),u32(0,base.length,0,0),u32(0,0),u32(1),u32(0,delta.length,0,0),u32(0,0)]))
 await writeFile(path.join(root,'Resources/Data000.dat'),base);await writeFile(path.join(root,'Resources/Data001.dat'),delta)
 const script=Buffer.concat([op('$',204,1,0,1,0,140,1),text('story'),op('#',87)])
 await writeFile(path.join(root,'Arc04.dat'),script);await writeFile(path.join(root,'Arc01.dat'),arc(table([script])))
 const clips=['j','k','u'].map((t,i)=>{const b=Buffer.alloc(128,i+1);b.write('OggS');return b}),encrypted=clips.map(b=>{const e=tinkDecrypt(b);e.write('Tink');return e})
 const soundRows=['i','j','k','u'].map((t,i)=>{const tail=Buffer.alloc(7);tail.writeUInt16LE(t.charCodeAt(0)^0x3000);return Buffer.concat([u32(23,i,i?128:0,i?128:0,i?(i-1)*128:0),tail])})
 await writeFile(path.join(root,'Arc03.dat'),arc(Buffer.concat(soundRows)));await writeFile(path.join(root,'Arc06.dat'),Buffer.concat(encrypted))
 const config=normalizeGalConfigWithWarnings({containers:{enabled:true,dir:'arc',scan:['.','Resources'],scriptDecoder:'tomoe-arc04',scriptExt:'tomoe',mode:'hybrid',format:'tomoe',flat:false,rules:[{match:'\\.dat$',kinds:['script','res']}],maxEntries:1000,maxTotalMB:10}}).config
 const report=await ensureContainers({mediaDir:root,config});assert.equal(report.arcs['./Arc04.dat'].scripts,1,JSON.stringify(report))
 const vf=await virtualFiles({mediaDir:root,config});assert.ok(vf.files.includes('arc/res/img/1.png'));assert.ok(vf.files.includes('arc/res/snd/se/0.ogg'))
 const img=await virtualEntry({mediaDir:root,config,rels:['arc/res/img/1.png']});const png=await img.read(),raw=inflateSync(png.subarray(41,-12));assert.deepEqual([...raw],[0,3,2,1,255,7,8,9,255])
 const se=await virtualEntry({mediaDir:root,config,rels:['arc/res/snd/se/0.ogg']});assert.deepEqual(await se.read(),clips[1])
 const bgm=await virtualEntry({mediaDir:root,config,rels:['arc/res/snd/bgm/0.ogg']});assert.deepEqual(await bgm.read(),clips[2])
 await materialize({mediaDir:root,config,rels:['arc/res/img/1.png']});assert.deepEqual(await readFile(path.join(root,'arc/res/img/1.png')),png)
 const story=JSON.parse(await readFile(path.join(root,'arc/script/Arc04/00/00_01.tomoe')));assert.equal(story.resource,0);assert.equal(story.imageMode,'reconstructed-v3')
 }finally{await archiveToTmp(root)}
})

test('real drawing table maps opening CG IDs to Data003, not solid-color PNGs in Data001', {skip:!hasReal},async()=>{
 const script=await readFile(path.join(sampleRoot,'core/g14/Arc04.dat')), index=decodeArc(await readFile(path.join(sampleRoot,'core/g14/Arc01.dat')))
 const keys=parseDrawImageKeys(index,script)
 assert.equal(keys.length,818);assert.equal(keys[230],40000001);assert.equal(keys[231],40000002);assert.equal(keys[233],40000004)
 const files=['arc/res/img/230.png','arc/res/img/native/230.jpg','arc/res/img/native/231.png']
 const ctx=prepare({files,toResourcePath:r=>r.replace(/^arc\/res\//,'')})
 const parsed=parse(JSON.stringify({format:'tomoe-arc04/1',imageDir:'img/native',events:[draw(230,140),['T','opening'],['#',87],draw(231,2),['T','next'],['#',87]]}),ctx)
 const commands=parsed.steps.flatMap(s=>s.commands)
 assert.ok(commands.some(c=>c.src==='img/native/230.jpg'));assert.ok(commands.some(c=>c.src==='img/native/231.png'));assert.ok(!commands.some(c=>c.src==='img/230.png'))
})

test('real opening imports through hybrid containers and reads both mapped complete CG frames', {skip:!fs.existsSync(path.join(sampleRoot,'extra/opening/e0002_a463431'))},async()=>{
 const {ensureContainers,virtualFiles,virtualEntry,materialize}=await import('../../web/library/gal/containers.mjs')
 const {normalizeGalConfigWithWarnings}=await import('../../web/library/gal/config.mjs')
 const {parseImageIndex,imageToBytes}=await import('../../web/library/gal/tomoe.mjs')
 const root=await mkdtemp('/tmp/tomoe-real-import-')
 try{
  await mkdir(path.join(root,'Resources'))
  for(const name of ['Arc01.dat','Arc04.dat'])await writeFile(path.join(root,name),await readFile(path.join(sampleRoot,'core/g14',name)))
  const index=await readFile(path.join(sampleRoot,'extra/g12/Resources/Data00.dat'));await writeFile(path.join(root,'Resources/Data00.dat'),index)
  const entries=parseImageIndex(index).filter(e=>e.file===3),file=await fs.promises.open(path.join(root,'Resources/Data003.dat'),'w')
  const stored=[],decoded=[]
  try{await file.truncate(Math.max(...entries.map(e=>e.offset+e.size)));for(let k=0;k<3;k++){const e=entries[k],b=await readFile(path.join(sampleRoot,`extra/opening/e${String(k).padStart(4,'0')}_a${e.a}`));stored[k]=b;decoded[k]=lzssDecode(b,e.a);await file.write(b,0,b.length,e.offset)}}finally{await file.close()}
  // Use the existing layout's rules: Arc01 is a dependency, not an advertised resource archive.
  const config=normalizeGalConfigWithWarnings({containers:{enabled:true,dir:'arc',scan:['.','Resources'],scriptDecoder:'tomoe-arc04',scriptExt:'tomoe',mode:'hybrid',format:'tomoe',rules:[{match:'^Arc04\\.dat$',kinds:['script']},{match:'^(Arc03|Arc06|Data\\d+)\\.dat$',kinds:['res']}],maxEntries:200000,maxTotalMB:8192}}).config
  const report=await ensureContainers({mediaDir:root,config});assert.ok(report.arcs['./Arc04.dat'].scripts>74,JSON.stringify(report))
  const names=await fs.promises.readdir(path.join(root,'arc/script/Arc04'));assert.deepEqual(names,Array.from({length:74},(_,i)=>String(i+4).padStart(2,'0')))
  const firstDir=path.join(root,'arc/script/Arc04/04'),first=(await fs.promises.readdir(firstDir)).sort()[0],story=JSON.parse(await readFile(path.join(firstDir,first)));assert.equal(story.imageDir,'img/native')
  const vf=await virtualFiles({mediaDir:root,config}),ctx=prepare({files:vf.files,toResourcePath:r=>r.replace(/^arc\/res\//,'')})
  const parsed=parse(JSON.stringify(story),ctx);assert.ok(parsed.steps.length>0);assert.ok(parsed.steps.flatMap(s=>s.commands).some(c=>c.src==='img/native/231.png'))
  for(let k=1;k<=2;k++){const rel=`arc/res/img/native/${229+k}.png`,hit=await virtualEntry({mediaDir:root,config,rels:[rel]});assert.ok(hit,rel);assert.deepEqual(await hit.read(),imageToBytes(decoded[k],{base:decoded[0]}));assert.equal(await materialize({mediaDir:root,config,rels:[rel]}),1)}
 }finally{await archiveToTmp(root)}
})
