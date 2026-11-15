// Synthetic invariants always run; captured fixtures are optional, source read-only.
import{test}from'node:test'
import{createRequire}from'node:module'
const requireWeb=createRequire(new URL('../../web/package.json',import.meta.url))
import assert from'node:assert/strict'
import{readFile,writeFile,mkdtemp,mkdir,stat}from'node:fs/promises'
import{existsSync}from'node:fs'
import path from'node:path'
import os from'node:os'
import{unitySpritePng,unityTexturePng,unityAudio}from'../../web/library/gal/unity-media.mjs'
import{cellTalkTable}from'../../web/library/gal/unity-celltalk.mjs'
import{parse as cellParse}from'../../web/library/gal/adapters/celltalk-native.mjs'
import{utageExpression}from'../../web/library/gal/utage-expression.mjs'
import{stateAt,activePath}from'../../web/static/gal-engine.js'
import{pickRenderStep}from'../../web/static/gal-thumb-pick.js'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'

test('trimmed sprites restore their original canvas, keeping body/face alignment',async()=>{
 const sharp=requireWeb('sharp'),png=await sharp({create:{width:4,height:4,channels:4,background:'#ff0000'}}).png().toBuffer(),sprite={m_Rect:{width:6,height:8},m_RD:{textureRect:{x:1,y:1,width:2,height:2},textureRectOffset:{x:3,y:1},settingsRaw:0}},out=await unitySpritePng(sprite,{m_Width:4,m_Height:4},png),{data,info}=await sharp(out).raw().toBuffer({resolveWithObject:true});assert.deepEqual([info.width,info.height],[6,8]);const pixel=(x,y)=>[...data.subarray((y*6+x)*4,(y*6+x+1)*4)];assert.deepEqual(pixel(3,5),[255,0,0,255]);assert.equal(pixel(0,0)[3],0);await assert.rejects(unitySpritePng({...sprite,m_RD:{...sprite.m_RD,textureRectOffset:{x:6,y:0}}},{m_Width:4,m_Height:4},png),/outside original canvas/)
})
test('Unity DXT image orientation/alpha and malformed input bounds',async()=>{
 const sharp=requireWeb('sharp'),block=Buffer.from([0,248,0,0,0,0,0,0]),png=await unityTexturePng({m_Width:4,m_Height:4,m_TextureFormat:10},block),raw=await sharp(png).raw().toBuffer();assert.deepEqual([...raw.subarray(0,4)],[255,0,0,255]);await assert.rejects(unityTexturePng({m_Width:4,m_Height:4,m_TextureFormat:10},Buffer.alloc(1)),/truncated/)
})
test('existing ffmpeg converts a local PCM stream with only the pipe protocol enabled',async()=>{
 const pcm=Buffer.alloc(1600),header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(8000,24);header.writeUInt32LE(16000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);assert.equal((await unityAudio(Buffer.concat([header,pcm]))).subarray(0,4).toString(),'OggS')
})
test('CellTalk uses native ID ranges and separate save-condition branches',()=>{
 const rows=cellTalkTable('ID|セル|Data|セル|Emotion|セル|Talker|セル|日本語|行端端|\nStart|セル||セル||セル|A|セル|first|行端端|\nStart以上|セル||セル||セル||セル|last|行端端|\nYes|セル||セル||セル||セル|yes|行端端|\nNo|セル||セル||セル||セル|no'),call=(id,end=64)=>({op:'call',method:'EventEngine.Text',address:'0x1',args:[{self:true},'ID:'+id,end]}),scene=cellParse(JSON.stringify({format:'celltalk-script/1',type:'fixture',source:'level1:1',fields:{},rows,profile:{commands:[call('Start','++以上')],condition:'saved flag',yes:{commands:[call('Yes')]},no:{commands:[call('No')]}}}),{media:{audio:{},cg:{}}}),texts=activePath(scene).map(i=>stateAt(scene,i).text.map(x=>x.text).join(''));assert.deepEqual(texts.slice(0,2),['first','last']);assert.ok(scene.steps.flatMap(s=>s.commands).some(c=>c.op==='choice'));assert.equal(scene.stats.unresolved&&Object.keys(scene.stats.unresolved).length,0)
})
test('Utage expressions cannot execute JavaScript; Live2D-only scenes have thumbnail candidates',()=>{
 assert.equal(utageExpression('a >= 2 && a < 4',{a:3}),true);assert.throws(()=>utageExpression('process.exit()'),/./);let scene={steps:[{commands:[{op:'live2d',slot:'x',src:'A.model3.json',stage:[1280,720],x:640,y:360}]}]};assert.equal(pickRenderStep(scene).score,30)
})

const base=path.resolve(process.env.GAL_SIX_FIXTURES||'.cache/six-games-20261115/integration'),cases=[
 ['nani','naninovel::script','naninovel::yorutina','s:0001_Story_Opening1.nani',7],
 ['utage','utage::native','utage::girlsclub','s:MH1.book.json',1],
 ['unite','rpgmaker-unite','unite::girlreno','s:data/CommonEvents.unite::common-25',0],
 ['cell','celltalk::native','celltalk::darkelf','s:ゴブリン凌辱.cell',0],
]
for(const[name,adapter,id,section,step]of cases)test('captured '+name+': import → layout → catalog → real scene/resources',{skip:!existsSync(path.join(base,name))},async()=>{
 const source=path.join(base,name),dataDir=await mkdtemp(path.join(os.tmpdir(),'gal-six-'+name+'-')),handler=createGalHandler({dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})}),result=await handler.importFromSource({sourcePath:source,options:{adapters:[adapter]}}),item=result.items[0];item.config={...item.config,game:{id,title:'User title '+name}};const layout=await generateTags({type:'gal',item,script:{version:'2.66.0',options:{}},tags:[]});assert.equal(layout.itemPatch.gal.config.game.title,'User title '+name);await handler.patchItemMetadata(item.itemId,layout.itemPatch);const home=await handler.getReaderContent(item.itemId,'main');assert.ok(home.node.items.length);if(name==='cell'){const native=JSON.parse(await readFile(path.join(source,layout.itemPatch.gal.config.containers.dir,'native.json'),'utf8'));assert.equal(native.scenes.length,44);assert.ok(!native.scenes.some(s=>['露出1','軍団長の夜伽5'].includes(s.name)));assert.equal(native.diagnostics.filter(d=>d.type).length,10)}const reader=await handler.getReaderContent(item.itemId,'main',{sectionId:section});assert.ok(reader.scene?.steps.length>5);assert.ok((reader.scene.stats.messages||reader.scene.stats.text)>5)
 const visual=reader.scene.steps.flatMap(s=>s.commands).find(c=>c.op==='overlay'&&c.src||c.op==='live2d'&&c.src),resource=await handler.getResource(item.itemId,visual.src);assert.ok((await stat(resource.file)).size>100)
 const voice=reader.scene.steps.flatMap(s=>s.commands).find(c=>c.op==='voice');assert.ok(voice);const sound=await handler.getResource(item.itemId,voice.src);assert.equal((await readFile(sound.file)).subarray(0,4).toString(),'OggS')
 if(name==='utage'){
  const special=home.node.items.find(i=>i.title==='特殊场景');assert.ok(special)
  const cards=await handler.getReaderContent(item.itemId,'main',{sectionId:special.node})
  const card=cards.node.items.find(i=>i.title==='みくアフター１');assert.ok(card,JSON.stringify(cards.node.items.map(i=>i.title)));assert.ok(card.thumb,'native gallery cover preserved');assert.ok(card.markers?.length,'native gallery cover must not suppress middle-start markers')
 }
 const output=path.resolve('.cache/six-games-20261115/verified');await mkdir(output,{recursive:true});await writeFile(path.join(output,name+'.json'),JSON.stringify({name,source,section,step,reader,config:layout.itemPatch.gal.config},null,2));console.log('Verified',name,reader.scene.stats.messages||reader.scene.stats.text,'messages; original resource',resource.contentType,sound.contentType)
})
