import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,writeFile,mkdir}from'node:fs/promises'
import{edoPayload}from'../../web/library/gal/edo.mjs'
import{prepare,parse}from'../../web/library/gal/adapters/edo-lua.mjs'
import{prepare as rpgPrepare,parse as rpgParse}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{activePath,stateAt,choiceHistoriesForCommands}from'../../web/static/gal-engine.js'
import{resolveLayout}from'../tag-scripts/gal-layout/main.js'
import{computeSceneMarkers}from'../../web/library/gal/markers.mjs'
test('actual Shiro white4 sentence85 reopens the native message window after earlier close',async()=>{
 const text=edoPayload(await readFile('.cache/new-games-162126/extracted/g02/__remaining/shiro/src/game/12_エンディング白4■.txt'),{text:true}),scene=parse(JSON.stringify({format:'edo-lua/1',text})),live=activePath(scene),target=live.find(i=>stateAt(scene,i).text.some(t=>t.text.includes('白のことはホントに愛してる')));assert.ok(target>0);assert.equal(stateAt(scene,target).ui,true);await mkdir('.cache/reported-scenes-fixtures',{recursive:true});await writeFile('.cache/reported-scenes-fixtures/shiro-window.json',JSON.stringify({scene,target}))
})
test('actual Remastered sc6000 uses native global_config H-scene default; explicit reader override remains respected',async()=>{
 const text=await readFile('.cache/new-games-052443/analysis/remastered/src__game__sc6000.txt','utf8'),global=await readFile('.cache/new-games-052443/analysis/remastered/src__sys__global_config.txt','utf8'),texts={'arc/script/global_config.edo':JSON.stringify({format:'edo-lua/1',name:'src/sys/global_config.txt',text:global})}
 const run=initialVariables=>{const ctx=prepare({options:{...resolveLayout('edo::parente').ruleOverrides['edo::lua'],initialVariables},files:[],texts});return parse(JSON.stringify({format:'edo-lua/1',text}),ctx)},native=run({}),off=run({IS_USE_HSCENE:0});assert.ok(activePath(native).length>300);assert.ok(activePath(off).length<200);const targets=[];native.steps.forEach((s,i)=>s.commands.forEach((c,k)=>{if(c.src?.includes('EV156'))targets.push({step:i,command:k})}));const histories=choiceHistoriesForCommands(native,targets),target=targets.find(t=>histories.has(`${t.step}:${t.command}`));assert.ok(target,'EV156 can actually be reached through offered native story branches');const choices=histories.get(`${target.step}:${target.command}`);assert.ok(stateAt(native,target.step,choices).overlays.some(o=>o.src?.includes('EV156')));assert.ok(native.stats.choices>=5);console.log('sc6000 native/default-disabled steps',activePath(native).length,activePath(off).length)
})
test('MV native Map081 parallax commands become visible CG backgrounds rather than raw-only events',async()=>{
 const map=JSON.parse(await readFile('.cache/bugs-073723/extracted/g02/www/data/Map081.json')),ctx=await rpgPrepare({texts:{'data/CommonEvents.json':'[null]','data/System.json':'{}'},files:[],options:{maps:{enabled:false}}});ctx.maps.set('data/Map081.json',map);const scene=rpgParse('',ctx,{rel:'data/Map081.json',scene:'event-1-1'}),first=activePath(scene).find(i=>stateAt(scene,i).text.length);assert.equal(stateAt(scene,first).bg.src,'img/parallaxes/_Lize_SceneA_00.png');assert.equal(scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='bg'&&c.src?.includes('SceneA')).length,42);assert.ok(!scene.stats.raw['event:284'])
})
test('every adapter gets reachable middle-start checkpoints without layout-specific rules; tiny scenes stay bounded',()=>{
 const scene={steps:Array.from({length:20},(_,i)=>({index:i,commands:[{op:'text',segments:[{text:'line '+i}]}]}))},markers=computeSceneMarkers(scene,[]);assert.equal(markers.length,3);assert.ok(markers.every(m=>m.step>0&&m.step<19));assert.equal(computeSceneMarkers({steps:[scene.steps[0]]}).length,0)
 const cg={steps:scene.steps.map((s,i)=>({...s,commands:[...(i===7?[{op:'bg',src:'art/CG002.png'}]:[]),...s.commands]}))};assert.equal(computeSceneMarkers(cg,[])[0].step,7)
})
