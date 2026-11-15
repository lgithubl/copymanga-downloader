import {test} from 'node:test'
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {readFile,writeFile,mkdir,mkdtemp,stat} from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {parse,catalog} from '../../web/library/gal/adapters/naninovel-script.mjs'
import {activePath,stateAt} from '../../web/static/gal-engine.js'
import {scoreState} from '../../web/static/gal-thumb-pick.js'
import {unitySpritePng} from '../../web/library/gal/unity-media.mjs'
import {createGalHandler} from '../../web/library/types/gal.mjs'
import {generateTags} from '../tag-scripts/gal-layout/main.js'
const sharp=createRequire(new URL('../../web/package.json',import.meta.url))('sharp')
const fixture=path.resolve('.cache/rj01746557/round2/extracted/g01'),work=path.resolve('.cache/rj01746557/verified')
const ctx={resourcesBuild:true,assets:{},configs:{CameraConfiguration:{ReferenceResolution:{x:1920,y:1080},ReferencePPU:100},CharactersConfiguration:{Metadata:{ids:[],metas:[]},DefaultMetadata:{}},AudioConfiguration:{EnableAutoVoicing:false},CustomVariablesConfiguration:{PredefinedVariables:[{name:'is_replay',value:'false'}]}}}
const c=(type,data={},source=0)=>({type,data,source}),line=text=>c('PrintText',{Text:{parts:[{text}]}}),label=name=>c('Label',{labelText:name})
const compile=commands=>parse(JSON.stringify({format:'naninovel-script/1',name:'example',texts:{},commands}),ctx)
test('thumbnail scoring distinguishes native background, portrait and CG without changing old overlays',()=>{
 assert.equal(scoreState({overlays:[{src:'black.png',kind:'background'}]}),1)
 assert.equal(scoreState({overlays:[{src:'black.png',kind:'background'},{src:'portrait.png',kind:'character'}]}),60)
 assert.equal(scoreState({overlays:[{src:'cg.png',kind:'still'}]}),90)
 assert.equal(scoreState({overlays:[{src:'legacy.png'}]}),60)
})
test('native grouped choices follow their authored labels beyond Stop without losing text',()=>{
 const scene=compile([line('before'),c('RequireChoice',{ChoiceSummary:{parts:[{text:'yes'}]},GotoPath:'#yes'}),c('RequireChoice',{ChoiceSummary:{parts:[{text:'no'}]},GotoPath:'#no'}),c('Stop'),label('yes'),line('yes route'),c('Goto',{Path:'#end'}),label('no'),line('no route'),label('end'),line('after')])
 for(const[value,expected]of[[1,'yes route'],[2,'no route']]){const id=scene.steps.flatMap(s=>s.commands).find(c=>c.op==='choice').id,choices={[id]:value},texts=activePath(scene,choices).flatMap(i=>stateAt(scene,i,choices).text.map(s=>s.text));assert.ok(texts.includes(expected));assert.ok(texts.includes('after'));assert.ok(!texts.includes(value===1?'no route':'yes route'))}
 assert.equal(scene.stats.choices,1)
})
test('native replay flags skip the game-loop exit; external labels resolve to materialized scripts',()=>{
 const d={format:'naninovel-script/1',name:'example',replay:true,entryLabel:'start',texts:{},commands:[line('unreachable'),label('start'),line('replay'),c('BeginIf',{Expression:'is_replay'}),c('HideAllActors'),c('Stop'),c('EndIf'),line('not replay')]},scene=parse(JSON.stringify(d),ctx);assert.equal(scene.stats.messages,1);assert.ok(!scene.steps.flatMap(s=>s.commands).some(c=>c.op==='text'&&c.segments[0].text==='not replay'))
 const link=compile([c('Goto',{Path:'other#end'})]);assert.equal(link.steps.flatMap(s=>s.commands).find(c=>c.op==='goto').script,'label--other--end.nani')
 assert.throws(()=>compile([c('BeginIf',{Expression:'not_in_save'})]),/unknown variable/)
})
test('native UI stops retain an explicit diagnostic, never silently run the following label',()=>{
 const scene=compile([line('before UI'),c('ShowUI',{UINames:['custom UI']},12),c('Stop',{},13),label('end'),line('after UI')]);assert.equal(scene.stats.messages,1);assert.ok(scene.steps.flatMap(s=>s.commands).some(c=>c.op==='raw'&&c.cmd==='native-ui-stop'&&c.args[1]===14))
})
test('fractional tight sprite raster padding clips one pixel; invalid offsets still fail',async()=>{
 const png=await sharp({create:{width:8,height:8,channels:4,background:'#e14a24'}}).png().toBuffer(),sprite={m_Rect:{width:6.7,height:8},m_RD:{textureRect:{x:0,y:0,width:8,height:8},textureRectOffset:{x:0,y:0},settingsRaw:64}},bytes=await unitySpritePng(sprite,{m_Width:8,m_Height:8},png),m=await sharp(bytes).metadata();assert.deepEqual([m.width,m.height],[7,8]);await assert.rejects(unitySpritePng({...sprite,m_RD:{...sprite.m_RD,textureRectOffset:{x:3,y:0}}},{m_Width:8,m_Height:8},png),/outside original canvas/)
})
test('captured RJ01746557 import/layout, 15 native replay cards, images and sound',{skip:!existsSync(path.join(fixture,'Yurei_1-0-0_Data/resources.assets'))},async()=>{
 await mkdir(work,{recursive:true});const dataDir=await mkdtemp(work+'/handler-'),handler=createGalHandler({dataDir,safeSegment:v=>String(v).replace(/[^\w.-]/g,'_'),pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:fixture}}})}),result=await handler.importFromSource({sourcePath:fixture,options:{adapters:['naninovel::script']}}),item=result.items[0];item.config={...item.config,game:{id:'naninovel::RJ01746557',title:'寝取られVtuberは笑わない'}};const layout=await generateTags({type:'gal',item,script:{version:'2.66.2',options:{}},tags:[]});assert.equal(layout.itemPatch.gal.config.game.title,'寝取られVtuberは笑わない');assert.equal(layout.itemPatch.gal.config.containers.scan[0],'Yurei_1-0-0_Data');await handler.patchItemMetadata(item.itemId,layout.itemPatch)
 await handler.getReaderContent(item.itemId,'main');
 const native=JSON.parse(await readFile(path.join(fixture,'Yurei_1-0-0_Data/arc/native.json'),'utf8')),tree=catalog(native);assert.equal(tree.children.find(x=>x.id==='special').children.length,15);assert.equal(native.scenes.length,80)
 const evidence=[]
 for(const[section,step]of[['scene-1',2],['scene-4',0]]){
  const reader=await handler.getReaderContent(item.itemId,'main',{sectionId:'s:'+section+'.nani'});assert.ok(reader.scene.steps.length>50);const state=stateAt(reader.scene,step),urls=[...state.overlays.map(o=>o.src),state.bgm,...Object.values(state.bgvoices||{}).map(a=>a.src)].filter(Boolean)
  if(section==='scene-1')assert.equal(state.overlays.find(o=>o.kind==='character').y,540,'authored bottom scene origin keeps the portrait head visible')
  for(const url of urls){const resource=await handler.getResource(item.itemId,url),bytes=await readFile(resource.file);assert.ok(bytes.length>100);if(url.endsWith('.ogg'))assert.equal(bytes.subarray(0,4).toString(),'OggS');else{const m=await sharp(bytes).metadata();assert.ok(m.width>500&&m.height>500)}}
  const record={name:section,source:fixture,section:'s:'+section+'.nani',step,reader,config:layout.itemPatch.gal.config};await writeFile(work+'/'+section+'.json',JSON.stringify(record));evidence.push({section,steps:reader.scene.steps.length,resources:urls})
 }
 const replay=await handler.getReaderContent(item.itemId,'main',{sectionId:'s:replay/op-1.nani'});assert.ok(replay.scene.steps.length>50,'native replay starts after the original exploration UI');assert.ok(replay.node.markers?.length,'middle-start marker buttons');assert.ok(!Object.keys(replay.scene.stats.unresolved||{}).length)
 const all=await handler.getReaderContent(item.itemId,'main',{sectionId:'s:scene-1.nani'});assert.ok(all.scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='goto').every(c=>c.node),'external destinations link to real reader nodes')
 await writeFile(work+'/integration.json',JSON.stringify({scenes:native.scenes.length,replays:15,evidence},null,2));console.log('Verified original Resources import, replay, native image/audio and linked story continuation')
})
