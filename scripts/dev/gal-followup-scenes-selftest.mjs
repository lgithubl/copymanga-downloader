import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,writeFile,mkdir,mkdtemp}from'node:fs/promises'
import{existsSync}from'node:fs'
import os from'node:os'
import path from'node:path'
import{edoPayload}from'../../web/library/gal/edo.mjs'
import{prepare,parse}from'../../web/library/gal/adapters/edo-lua.mjs'
import{prepare as rpgPrepare,parse as rpgParse}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{activePath,stateAt,choiceHistoriesForCommands}from'../../web/static/gal-engine.js'
import{resolveLayout,generateTags}from'../tag-scripts/gal-layout/main.js'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{computeSceneMarkers}from'../../web/library/gal/markers.mjs'
import{parse as pacParse}from'../../web/library/gal/adapters/pac-script.mjs'
import{decodeTextFile}from'../../web/library/text-decode.mjs'
import{skitScriptScope}from'../../web/library/gal/adapters/rpgmaker-skit-scripts.mjs'
test('skit wrapper translator rejects complete unrecognized JS without executing or partially applying it',()=>{
 const commands=[],scope=skitScriptScope({id:'test',arguments:['arg0'],emit:c=>commands.push(c),initial:new Map(),conditional:(_,fn)=>fn(),skit:()=>{throw Error('unexpected call')},actors:new Map()})
 assert.equal(scope('this._name = "bisty"; globalThis.__nativeGameExecuted = true;'),false);assert.equal(globalThis.__nativeGameExecuted,undefined);assert.equal(commands.length,0)
 assert.equal(scope('switch(this._arguments[0]){case 0: this._position = "left"; break; default: arbitraryCall();}'),false);assert.equal(commands.length,0)
})
test('native Kingdom30_8021 keeps BG1831 under transparent CG083 variants',async()=>{
 const root='.cache/followup-083838/extracted/g01/',text=decodeTextFile(await readFile(root+'data/Script/30_8021.txt')).text,scene=pacParse(text)
 const cg=scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='bg'&&c.cg)
 assert.ok(cg.length>3);assert.ok(cg.every(c=>c.src==='data/Graphics/BG/1831.png'));assert.ok(cg.some(c=>c.over==='data/Graphics/CG/083_02.png'))
 const sample=pacParse('#BGSET,1\n#CG,2,1\n#BGSET,3\n#MSG\nA\nline\n#BGOUT\n#MSG\nA\nline\n#CGOUT\n#END'),path=activePath(sample)
 assert.deepEqual(stateAt(sample,path[0]).bg,{src:'data/Graphics/BG/0003.png',over:'data/Graphics/CG/002_01.png'})
 assert.equal(stateAt(sample,path[1]).bg.src,'data/Graphics/CG/002_01.png');assert.equal(stateAt(sample,path[1]).bg.over,undefined)
})
test('native MZ Map062 calls its actual CommonEventExtend wrappers and shows Bisty body with expression',async()=>{
 const root='.cache/new-games-043952/extracted/g01/',mediaDir='.cache/followup-083838/extracted/g02',texts={}
 for(const rel of ['data/CommonEvents.json','data/System.json','data/Actors.json'])texts[rel]=await readFile(root+rel,'utf8')
 texts['js/plugins.js']=await readFile('.cache/new-games-043202/extracted/g01/js/plugins.js','utf8')
 const map=JSON.parse(await readFile(mediaDir+'/data/Map062.json')),files=['img/pictures/busts/bisty/normal.png_','img/pictures/busts/bisty/texture.png_','img/pictures/busts/bisty/texture.json']
 const run=async(enabled,position=0)=>{const options={...resolveLayout('rpgmaker::rj01271506').ruleOverrides['rpgmaker-json'],initialVariables:{1:position},maps:{enabled:false}};options.skit={...options.skit,wrapperScripts:enabled};const ctx=await rpgPrepare({options,files,texts,mediaDir});ctx.maps.set('data/Map062.json',map);return rpgParse('',ctx,{rel:'data/Map062.json',scene:'event-1-2'})}
 const broken=await run(false),fixed=await run(true),first=s=>activePath(s).find(i=>stateAt(s,i).text.length),state=stateAt(fixed,first(fixed))
 assert.ok(!stateAt(broken,first(broken)).overlays.some(o=>o.src?.endsWith('bisty/normal.png')))
 assert.ok(state.overlays.some(o=>o.src?.endsWith('bisty/normal.png')),'native common12 makes Bisty visible before first dialogue')
 assert.ok(state.overlays.some(o=>o.src?.endsWith('bisty/texture.png')&&o.crop),'native expression atlas accompanies the body')
 assert.ok(fixed.stats.raw['script-unhandled']>=1,'unknown save-state costume logic stays diagnosed')
 assert.ok(fixed.stats.raw['script-unhandled']<broken.stats.raw['script-unhandled'])
 assert.ok(fixed.steps.flatMap(s=>s.commands).some(c=>c.op==='overlayOff'&&c.slot==='rpg-skit-body:bisty'),'native common10 emits body cleanup')
 const right=await run(true,5),rightState=stateAt(right,first(right)),body=rightState.overlays.find(o=>o.slot==='rpg-skit-body:bisty');assert.equal(body.x,(8.5/10-.5)*body.stage[0],'native argument5 resolves configured right position')
 await writeFile('.cache/reported-scenes-fixtures/mz-bisty.json',JSON.stringify({scene:fixed,target:first(fixed)}))
})
test('actual Shiro white4 sentence85 reopens the native message window after earlier close',async()=>{
 const text=edoPayload(await readFile('.cache/new-games-162126/extracted/g02/__remaining/shiro/src/game/12_エンディング白4■.txt'),{text:true}),scene=parse(JSON.stringify({format:'edo-lua/1',text})),live=activePath(scene),target=live.find(i=>stateAt(scene,i).text.some(t=>t.text.includes('白のことはホントに愛してる')));assert.ok(target>0);assert.equal(stateAt(scene,target).ui,true);await mkdir('.cache/reported-scenes-fixtures',{recursive:true});await writeFile('.cache/reported-scenes-fixtures/shiro-window.json',JSON.stringify({scene,target}))
})
test('actual Remastered sc6000 uses native global_config H-scene default; explicit reader override remains respected',async()=>{
 const text=await readFile('.cache/new-games-052443/analysis/remastered/src__game__sc6000.txt','utf8'),global=await readFile('.cache/new-games-052443/analysis/remastered/src__sys__global_config.txt','utf8'),texts={'arc/script/global_config.edo':JSON.stringify({format:'edo-lua/1',name:'src/sys/global_config.txt',text:global})}
 const run=initialVariables=>{const ctx=prepare({options:{...resolveLayout('edo::parente').ruleOverrides['edo::lua'],initialVariables},files:[],texts});return parse(JSON.stringify({format:'edo-lua/1',text}),ctx)},native=run({}),off=run({IS_USE_HSCENE:0});assert.ok(activePath(native).length>300);assert.ok(activePath(off).length<200);const targets=[];native.steps.forEach((s,i)=>s.commands.forEach((c,k)=>{if(c.src?.includes('EV156'))targets.push({step:i,command:k})}));const histories=choiceHistoriesForCommands(native,targets),target=targets.find(t=>histories.has(`${t.step}:${t.command}`));assert.ok(target,'EV156 can actually be reached through offered native story branches');const choices=histories.get(`${target.step}:${target.command}`);assert.ok(stateAt(native,target.step,choices).overlays.some(o=>o.src?.includes('EV156')));assert.ok(native.stats.choices>=5);console.log('sc6000 native/default-disabled steps',activePath(native).length,activePath(off).length)
})
test('actual Remastered import/containers/context/reader preserves extensionless native system names and exposes sc0561 CG',async()=>{
 const{source}=JSON.parse(await readFile('.cache/next-native-fixtures/Remastered.json')),dataDir=await mkdtemp(path.join(os.tmpdir(),'remastered-sc0561-reader-')),h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})})
 const item=(await h.importFromSource({sourcePath:source,options:{adapters:['edo::lua'],config:{game:{id:'edo::Remastered'}}}})).items[0],layout=await generateTags({item,script:{version:'test',options:{}}});await h.patchItemMetadata(item.itemId,layout.itemPatch)
 const home=await h.getReaderContent(item.itemId,'main'),story=home.node.items.find(x=>x.title==='剧情'),cards=await h.getReaderContent(item.itemId,'main',{sectionId:story.node}),card=cards.node.items.find(x=>x.title==='sc0561');assert.ok(card)
 const reader=await h.getReaderContent(item.itemId,'main',{sectionId:card.node}),scene=reader.scene,initial=scene.steps[0].commands.find(c=>c.op==='set'&&c.var==='edo:IS_USE_HSCENE');assert.equal(initial?.value,1,'native global_config is loaded through actual generated .edo envelope')
 const live=activePath(scene),cg=live.filter(i=>stateAt(scene,i).overlays.some(o=>/ev05[67]/i.test(o.src||'')));assert.ok(cg.length>100,'CG remains visible along the actual reader path');console.log('native sc0561 reader',live.length,'reachable CG dialogue steps',cg.length,'retained',dataDir)
})
test('native system defaults refresh without modifying or leaking through a reused options object',()=>{
 const options={},native=value=>({'arc/script/global_config.edo':JSON.stringify({format:'edo-lua/1',name:'src/sys/global_config',text:'IS_USE_HSCENE='+value})})
 assert.equal(prepare({options,texts:native(1)}).cfg.initialVariables.IS_USE_HSCENE,1)
 assert.equal(prepare({options,texts:native(0)}).cfg.initialVariables.IS_USE_HSCENE,0)
 assert.equal(prepare({options,texts:{}}).cfg.initialVariables.IS_USE_HSCENE,undefined)
 assert.deepEqual(options,{})
})
test('MV native Map081 parallax commands become visible CG backgrounds rather than raw-only events',async()=>{
 const map=JSON.parse(await readFile('.cache/bugs-073723/extracted/g02/www/data/Map081.json')),ctx=await rpgPrepare({texts:{'data/CommonEvents.json':'[null]','data/System.json':'{}'},files:[],options:{maps:{enabled:false}}});ctx.maps.set('data/Map081.json',map);const scene=rpgParse('',ctx,{rel:'data/Map081.json',scene:'event-1-1'}),first=activePath(scene).find(i=>stateAt(scene,i).text.length);assert.equal(stateAt(scene,first).bg.src,'img/parallaxes/_Lize_SceneA_00.png');assert.equal(scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='bg'&&c.src?.includes('SceneA')).length,42);assert.ok(!scene.stats.raw['event:284'])
})
test('every adapter gets reachable middle-start checkpoints without layout-specific rules; tiny scenes stay bounded',()=>{
 const scene={steps:Array.from({length:20},(_,i)=>({index:i,commands:[{op:'text',segments:[{text:'line '+i}]}]}))},markers=computeSceneMarkers(scene,[]);assert.equal(markers.length,3);assert.ok(markers.every(m=>m.step>0&&m.step<19));assert.equal(computeSceneMarkers({steps:[scene.steps[0]]}).length,0)
 const cg={steps:scene.steps.map((s,i)=>({...s,commands:[...(i===7?[{op:'bg',src:'art/CG002.png'}]:[]),...s.commands]}))};assert.equal(computeSceneMarkers(cg,[])[0].step,7)
})
