import {test} from'node:test'
import assert from'node:assert/strict'
import fs from'node:fs/promises'
import path from'node:path'
import os from'node:os'
import * as rpg from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{initialState,applyCommand,stateAt}from'../../web/static/gal-engine.js'
import{parseMoc3,createFrame,parseMotion,evaluateMotion,updateModel}from'../../web/static/gal-moc3.js'
import{rpgShakeFrames}from'../../web/static/gal-shake.js'
const cmd=(code,parameters=[],indent=0)=>({code,parameters,indent}),text=t=>[cmd(101,['',0,0,2,'']),cmd(401,[t])]
test('RPG shake preserves native power/speed/wait and returns to zero',async()=>{
 const values=rpgShakeFrames(3,3,27)
 assert.equal(values[0],0);assert.equal(values[1],.9);assert.equal(values.at(-1),0)
 assert.ok(Math.max(...values)<7);assert.deepEqual(rpgShakeFrames(0,5,60),[0])
 const texts={'data/System.json':'{}','data/CommonEvents.json':JSON.stringify([null,{id:1,list:[cmd(225,[3,3,27,true]),...text('shake')]}])},ctx=await rpg.prepare({texts,files:Object.keys(texts),options:{maps:{enabled:false}}}),scene=rpg.parse('',ctx,{rel:'data/CommonEvents.json',scene:'common-1'}),shake=scene.steps.flatMap(s=>s.commands).find(c=>c.op==='shake')
 assert.equal(shake.native,'rpgmaker');assert.equal(shake.power,3);assert.equal(shake.speed,3);assert.equal(shake.wait,true);assert.deepEqual(shake.stage,[816,624])
})
test('native recollection uses exact catalog and follows the unique autorun without playing unrelated map events',async()=>{
 const map={autoplayBgm:false,scrollType:0,parallaxName:'',tilesetId:0,width:1,height:1,data:[],events:[null,{id:1,pages:[{trigger:0,conditions:{},list:text('not this interaction')}]},{id:2,pages:[{trigger:3,conditions:{},list:[...text('native story'),cmd(357,['RecollectionModeMZ','backToRecoMode','',{}]),...text('unreachable')]}]}]},common=[null,{id:1,name:'wrapper',list:[cmd(201,[0,2,0,0,2,0])]}],texts={'data/System.json':'{}','data/CommonEvents.json':JSON.stringify(common),'data/Map002.json':JSON.stringify(map),'js/plugins.js':'var $plugins='+JSON.stringify([{name:'RecollectionModeMZ',status:true,parameters:{}}])+';','img/system/RecollectionModeMZData.json':JSON.stringify([{title:'Original gallery title',common_event_id:1,thumbnail:'gallery/thumb'}])}
 const ctx=await rpg.prepare({texts,files:Object.keys(texts),options:{maps:{enabled:false}}}),scene=rpg.parse('',ctx,{rel:'data/CommonEvents.json',scene:'common-1'})
 assert.equal(ctx.catalogTree.children[0].children[0].title,'Original gallery title');assert.equal(ctx.catalogTree.children[0].children[0].thumb,'img/pictures/gallery/thumb.png');assert.equal(scene.stats.text,1);assert.ok(!scene.stats.raw['map-autorun-ambiguous']);assert.equal(stateAt(scene,scene.steps.length-1).text.map(x=>x.text).join(''),'native story')
 const old=await rpg.prepare({texts:{...texts,'js/plugins.js':'var $plugins=[];'},files:Object.keys(texts),options:{maps:{enabled:false}}}),legacy=rpg.parse('',old,{rel:'data/CommonEvents.json',scene:'common-1'});assert.equal(legacy.stats.raw['map-autorun-ambiguous'],1,'non-plugin game retains the conservative transfer policy')
})
test('MZ model alias, one-based motion index, native scale, case-correct assets and conditional slot state',async()=>{
 const list=[cmd(231,[1,'black',0,0,0,0,100,100,255,0]),cmd(231,[11,'front',0,0,0,0,100,100,255,0]),cmd(357,['Live2DInterfaceMZ','show','',{modelName:'A'}]),cmd(357,['Live2DInterfaceMZ','scale','',{modelName:'A',scale:'1.8'}]),cmd(357,['Live2DInterfaceMZ','motion','',{modelName:'A',motionName:'M2',loop:'true'}]),...text('animated')],texts={'data/System.json':'{"advanced":{"screenWidth":1280,"screenHeight":720}}','data/CommonEvents.json':JSON.stringify([null,{id:1,list}]),'js/plugins.js':'var $plugins='+JSON.stringify([{name:'Live2DInterfaceMZ',status:true,parameters:{pictpriority:'10',Modelcondition:JSON.stringify([JSON.stringify({Modelname:'A',folderpath:'./assets/A/',motiongroupnames:'<M2:Idle_2>'})])}}])+';'}
 const ctx=await rpg.prepare({texts,files:[...Object.keys(texts),'Assets/A/A.model3.json']}),scene=rpg.parse('',ctx,{rel:'data/CommonEvents.json',scene:'common-1'}),state=stateAt(scene,0),spec=state.live2ds['rpg-live2d:A'];assert.equal(spec.src,'Assets/A/A.model3.json');assert.equal(spec.motionGroup,'Idle');assert.equal(spec.motionIndex,1);assert.ok(Math.abs(spec.scaleX-.36)<1e-9);assert.equal(spec.visible,true);assert.equal(state.overlays.find(s=>s.slot==='rpg-picture-1').under,true);assert.ok(!state.overlays.find(s=>s.slot==='rpg-picture-11').under)
 const hidden=initialState();applyCommand(hidden,{op:'live2d',slot:'x',src:'a',defaults:{visible:false,x:10},motion:'idle',patch:true});assert.equal(hidden.live2ds.x.visible,false);applyCommand(hidden,{op:'live2d',slot:'x',src:'a',defaults:{visible:false,x:10},visible:true,patch:true});assert.equal(hidden.live2ds.x.motion,'idle');applyCommand(hidden,{op:'live2dOff',slot:'x'});assert.equal(hidden.live2ds.x,undefined)
})
const fixture=path.resolve('.cache/six-games-20261115/mz-work')
for(const [game,id,count]of[['night',474,42],['yuri',205,30]])test('real '+game+': native gallery and story output',{skip:!await fs.stat(path.join(fixture,game)).catch(()=>null)},async()=>{
 const mediaDir=path.join(fixture,game),walk=async(d,p='')=>(await Promise.all((await fs.readdir(d,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(d,e.name),p+e.name+'/'):[p+e.name]))).flat(),files=await walk(mediaDir),texts={};for(const f of files.filter(f=>/^data\/.*\.json$|^js\/plugins.js$/.test(f)))texts[f]=await fs.readFile(path.join(mediaDir,f),'utf8')
 const ctx=await rpg.prepare({mediaDir,files,texts}),scene=rpg.parse('',ctx,{rel:'data/CommonEvents.json',scene:'common-'+id});assert.equal(ctx.catalogTree.children[0].children.length,count);assert.ok(scene.stats.text>5);assert.ok(!scene.stats.raw['map-autorun-ambiguous']);if(game==='night')assert.ok(scene.steps.flatMap(s=>s.commands).some(c=>c.op==='live2d'))
})
test('real R018 moc3 v5 has visible animated geometry, not merely a parsed header',{skip:!await fs.stat(path.join(fixture,'night/Assets/R018/R018.moc3')).catch(()=>null)},async()=>{
 const dir=path.join(fixture,'night/Assets/R018'),m=parseMoc3(await fs.readFile(path.join(dir,'R018.moc3'))),f=createFrame(m),j=JSON.parse(await fs.readFile(path.join(dir,'R018.model3.json'),'utf8')),motion=parseMotion(JSON.parse(await fs.readFile(path.join(dir,Object.values(j.FileReferences.Motions)[0][0].File),'utf8'))),params=Float32Array.from(m.paramDefault),snap=[];for(const t of[0,.5]){evaluateMotion(motion,t,m,params,f,true);updateModel(m,f,params);assert.ok(f.renderOrder.length>20);assert.ok(f.vertices.every(v=>v.every(Number.isFinite)));snap.push([...f.vertices[0]])}assert.notDeepEqual(snap[0],snap[1])
})
