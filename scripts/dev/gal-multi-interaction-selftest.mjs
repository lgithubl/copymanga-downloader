import assert from'node:assert/strict'
import{test}from'node:test'
import{readFile}from'node:fs/promises'
import{existsSync}from'node:fs'
import{prepare as prepareCat,parse as parseCat,catalog as catCatalog}from'../../web/library/gal/adapters/catpaw-script.mjs'
import{interactionSpec,roleState,interactionRegions}from'../../web/static/gal-interaction-state.js'
import{parseFoxRoom}from'../../web/library/gal/adapters/unity-fox-room.mjs'
import{foxInteraction}from'../../web/library/gal/adapters/unity-fox-interaction.mjs'
const base='.cache/five-new-games-20261116',future=base+'/future-source/futrue_Data/arc/native.json'
test('Future native role groups retain clothing layers, exact actions, button-only regions and visible unsupported actions',{skip:!existsSync(future)},async()=>{
 const ctx=prepareCat({texts:{'arc/native.json':await readFile(future,'utf8')}}),scene=parseCat(JSON.stringify({format:'catpaw-script/1',kind:'interaction',id:'100000',rows:[]}),ctx)
 assert.equal(scene.interaction.roles.length,5);assert.equal(catCatalog(ctx).children.find(c=>c.id==='interaction').children.length,5)
 for(const r of scene.interaction.roles){const state=roleState(r),spec=interactionSpec(r,state);assert.ok(spec.motionGroups[0]);assert.ok(spec.motionGroups[1]);assert.ok(!r.hitAreas.length,'do not fabricate hit meshes');for(const t of r.tools){state.tool=t.id;assert.equal(interactionRegions(r,state).length,t.areas.length);for(const a of t.areas)assert.ok(a.disabled||a.motion)}}
 const z=scene.interaction.roles.find(r=>r.id==='100004');assert.ok(z.tools.flatMap(t=>t.areas).some(a=>a.disabled));assert.ok(z.tools.flatMap(t=>t.areas).some(a=>a.motion==='Scene5'),'unique whitespace correction uses an existing native motion')
})
test('native interaction functions preserve existing variables and do not initialize the scene on each click',()=>{
 const model={skel:'a.skel',atlas:'a.atlas',animations:[{name:'idle',duration:1},{name:'action',duration:1}],skins:['default']},room={source:'native:1',models:{'':'m'},initial:{skin:'default'},gameObjects:{},interactions:['act'],functions:{init:{interactiveFlows:[{$type:'SetIntState',girlName:'A',stateName:'count',intValue:3}]},act:{interactiveFlows:[{$type:'AddIntState',girlName:'A',stateName:'count',intValue:1},{$type:'ChangeSpine',target:'',animationName:'action',trackIndex:2,loop:true}]}}},d={name:'Ch01_room',model:'m',room},ctx={models:{m:model},dialogue:{},voices:{},options:{maxCommands:10000,skin:'default'},scenes:[{name:d.name,script:'arc/script/room.uspine',interactions:['act']}]},result=parseFoxRoom(d,ctx,{interactionAction:'act'}),commands=result.steps.flatMap(s=>s.commands)
 assert.ok(commands.some(c=>c.ifAbsent&&c.var==='fox-state:A:count'));assert.ok(!commands.some(c=>c.value===3));assert.ok(!commands.some(c=>c.tracks?.some(t=>t.track===0)))
 const view=foxInteraction(d,ctx);assert.equal(view.interaction.roles.length,1);assert.equal(view.interaction.destinations[0].node,'s:room.uspine::touch');assert.equal(view.interaction.roles[0].characterId,'Ch01')
})

test('Hakubox room actions expose nine original controller voices; onsen standing uses scoped alpha upload',{skip:!existsSync(base+'/rpg-source-regular/data/CommonEvents.json')},async()=>{
 const rpg=await import('../../web/library/gal/adapters/rpgmaker-json.mjs'),texts={};for(const p of['data/System.json','data/CommonEvents.json','js/plugins.js'])texts[p]=await readFile(base+'/rpg-source-regular/'+p,'utf8');const ctx=await rpg.prepare({texts,files:[]}),scene=rpg.parse('',ctx,{rel:'data/CommonEvents.json',scene:'hakubox-interaction'}),role=scene.interaction.roles.find(r=>r.id==='native-off'),voice=role.tools[0].areas.find(a=>a.id==='jiurutou').commands.find(c=>c.op==='interactionVoiceChoice');assert.equal(voice.options.length,9);assert.equal(voice.options[8].voice,'audio/cv/fragment/kana-groan-fragment-9.ogg');assert.ok(!role.tools[0].areas.find(a=>a.id==='motou').commands.some(c=>c.op==='interactionVoiceChoice'))
 const onsen=rpg.parse('',ctx,{rel:'data/CommonEvents.json',scene:'common-131'}),spines=onsen.steps.flatMap(s=>s.commands).filter(c=>c.op==='spine');assert.ok(spines.length);assert.ok(spines.every(c=>c.alphaMode==='premultiply'))
})
