import assert from'node:assert/strict'
import{test}from'node:test'
import{existsSync}from'node:fs'
import{readFile}from'node:fs/promises'
import * as rpg from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{stateAt}from'../../web/static/gal-engine.js'
const root=process.env.GAL_HAKUBOX_SOURCE||'.cache/five-new-games-20261116/rpg-source-regular'
test('every captured adventure action starts with the original composed body and renders its native action frames',{skip:!existsSync(root+'/data/CommonEvents.json')},async()=>{
 const texts={};for(const p of['data/System.json','data/CommonEvents.json','js/plugins.js'])texts[p]=await readFile(root+'/'+p,'utf8');const ctx=await rpg.prepare({texts,files:[]}),events=JSON.parse(texts['data/CommonEvents.json']).filter(e=>e?.name.startsWith('涩涩动作:'));assert.equal(events.length,7)
 for(const e of events){const s=rpg.parse(texts['data/CommonEvents.json'],ctx,{scene:'common-'+e.id}),first=stateAt(s,0),commands=s.steps.flatMap(s=>s.commands),actions=commands.filter(c=>c.animation?.key?.startsWith('hakubox-adventure-action:'));assert.ok(first.overlays.some(o=>/body_back/.test(o.src)),e.name+' first-line body');assert.ok(first.overlays.some(o=>o.src.includes('/face/')),e.name+' first-line face');assert.ok(actions.length,e.name+' native action');assert.ok(!s.stats.raw['script-unhandled'],e.name+' visual scripts consumed');assert.ok(!s.stats.raw['condition-unhandled'],e.name+' native clothing conditions');assert.ok(!s.stats.raw['hakubox-adventure-action-not-lifted'],e.name+' all action IDs');for(const src of new Set(commands.flatMap(c=>[c.src,...c.animation?.frames?.map(f=>f.src)||[]]).filter(s=>s?.includes('adventure/tachie/'))))assert.ok(existsSync(root+'/'+src),e.name+' original resource '+src)
 }
})

import{hakuboxAdventure}from'../../web/library/gal/adapters/rpgmaker-hakubox-adventure.mjs'
import{cyclePose}from'../../web/static/gal-overlay-animation.js'
import{catalog as orcxCatalog}from'../../web/library/gal/adapters/orcx-script.mjs'
const harness=()=>{const commands=[],problems=[],script=hakuboxAdventure({enabled:true,emit:c=>commands.push(c),raw:(...v)=>problems.push(v),resource:(p,n)=>p+'/'+n+'.png',stage:[1280,720]});return{commands,problems,script}}
test('mixed bookkeeping never executes JS and no longer discards the original visual commands',()=>{
 const h=harness();h.script("const _scene = SceneManager._scene; _scene.tachieDirection = 'back'; _scene.tachieFace='04'; _scene.updateTachie(); Utils_Favor.addKanaSexCount('mouth',1); if(Utils_Time.day !== $gameVariables.value(67)){$gameVariables.setValue(67,Utils_Time.day);}");assert.ok(h.commands.some(c=>c.src?.endsWith('body_back_reached.png')));assert.ok(h.commands.some(c=>c.src?.endsWith('face/04.png')));assert.equal(h.problems.length,2);assert.ok(h.problems.every(p=>p[0]==='hakubox-adventure-gameplay-not-simulated'))
 globalThis.__hakuboxUnsafe=0;h.script("globalThis.__hakuboxUnsafe=1; _scene.tachieFace='09'; _scene.updateTachie();");assert.equal(globalThis.__hakuboxUnsafe,0);assert.ok(h.problems.some(p=>p[0]==='hakubox-adventure-script-not-lifted'))
})
test('all native action IDs use authored frame timing and destruction/hold behavior',()=>{
 for(const[id,total,hold]of[['01',20,false],['02',180,false],['03',180,false],['04',180,false],['05',180,false],['05_fast',100,false],['06_1',100,true],['06_2',140,true],['06_3',140,false],['07_1',140,true],['07_2',150,false]]){const h=harness();h.script(`const _scene = SceneManager._scene; _scene.showSexAction('${id}');`);const a=h.commands.find(c=>c.animation)?.animation;assert.ok(a,id);assert.equal(a.loop,false);assert.equal(Boolean(a.frames.at(-1).src),hold,id+' hold');assert.ok(Math.abs(a.frames.reduce((n,f)=>n+f.seconds,0)-total/60)<=1/60+1e-9,id+' native duration');assert.deepEqual(h.problems,[])}
})
test('native nude/skirt variants, conditional cleanup, and face repaint preserve the current action',()=>{
 const h=harness();h.script("const _scene=SceneManager._scene; _scene.tachieIsNude=true; _scene.showSexAction('03');");assert.ok(h.commands.at(-1).src.endsWith('/sex/03/03.png'));h.script("const _scene=SceneManager._scene; _scene.tachieSkirtState='half'; _scene.showSexAction('04');");assert.ok(h.commands.at(-1).src.endsWith('/sex/04/03.png'));h.script("const _scene=SceneManager._scene; _scene.showSexAction('06_1'); _scene.tachieDirection='back'; _scene.tachieFace='09'; _scene.updateTachie();");const s=stateAt({steps:[{commands:h.commands}]},0);assert.ok(s.overlays.some(c=>c.src?.endsWith('/face/09.png')));assert.ok(s.overlays.some(c=>c.animation?.frames[0].src.endsWith('/sex/06/01.png')));assert.equal(h.script.condition("SceneManager._scene.tachieSkirtState == 'normal'"),false);h.script("const _scene=SceneManager._scene; if(_scene.tachieSkirtState === 'half'){_scene.tachieSkirtState='normal';} _scene.updateTachie();");assert.equal(h.script.condition("SceneManager._scene.tachieSkirtState == 'normal'"),true)
})
test('adventure panel motion has native bounds and stops at the end without moving unrelated layers',()=>{
 for(const kind of['rumble','shake']){const c={offset:{kind,duration:1,loops:2,power:12,frequency:2}};assert.notDeepEqual(cyclePose(c,.2),cyclePose(c,.3));assert.deepEqual(cyclePose(c,2),{scale:1,alpha:1,x:0,y:0});for(let i=0;i<200;i++){const p=cyclePose(c,i/100);assert.ok(Math.abs(p.x)<=12&&Math.abs(p.y)<=12)}}assert.deepEqual(cyclePose({},.5),{scale:1,alpha:1})
})
test('OrcX character covers select three stable, unique images from that character only',()=>{
 const names=Array.from({length:6},(_,i)=>'50_ap_001_01_00_0'+i),assets=Object.fromEntries(names.map(n=>['main/'+n+'_A.png',n+'.png'])),ctx={assets,scenes:names.map(name=>({name,script:name+'.orcx',pack:'main'}))},group=orcxCatalog(ctx).children[0].children[0];assert.deepEqual(group.thumbs,[names[0]+'.png',names[2]+'.png',names[5]+'.png']);assert.equal(group.thumb,group.thumbs[0]);assert.deepEqual(orcxCatalog(ctx).children[0].children[0].thumbs,group.thumbs);assert.equal(group.children.length,6)
})
