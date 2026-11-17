import assert from'node:assert/strict'
import{test}from'node:test'
import fs from'node:fs/promises'
import{resolveKaijuSlots,kaijuEventSounds,kaijuPageTextureSize}from'../../web/library/gal/kaiju-presentation.mjs'
import{spineJsonInfo}from'../../web/library/gal/kaiju-data.mjs'
import{prepare,parse}from'../../web/library/gal/adapters/kaiju-script.mjs'
import{stateAt}from'../../web/static/gal-engine.js'
import{pickRenderStep,pickRenderSteps}from'../../web/static/gal-thumb-pick.js'
import{createSpineEventAudio}from'../../web/static/gal-spine-event-audio.js'
test('resolve only unambiguous names in the current skeleton; preserve real unknown references',()=>{
 const model={slots:['Slot_Gasp_1','Slot_Blush_Lv1','Slot_Blush_Lv2','Pussy_Sweat2_1','Pussy_Sweat2_2','Beads_Ass_Clip','Face','face'].map(name=>({name}))}
 assert.deepEqual(resolveKaijuSlots(model,'Slot_gasp_1:Slot_Blush_Lv1 Slot_Blush_Lv2:Pussy_Sweat2_1/Pussy_Sweat2_2:Clip_Beads_Ass:FACE:Fog').names,['Slot_Gasp_1','Slot_Blush_Lv1','Slot_Blush_Lv2','Pussy_Sweat2_1','Pussy_Sweat2_2','Beads_Ass_Clip'])
 assert.deepEqual(resolveKaijuSlots(model,'FACE:Fog').missing,['FACE','Fog'])
})
test('emotion and mouth slots use the native bone groups rather than a name regex',()=>{
 const m=spineJsonInfo(JSON.stringify({skeleton:{spine:'4.1.17'},bones:[{name:'root'},{name:'SLOT_Emo',parent:'root'},{name:'Tears',parent:'SLOT_Emo'},{name:'Talk_Mouth',parent:'root'}],slots:[{name:'Blush_1',bone:'SLOT_Emo'},{name:'Eye_Water',bone:'Tears'},{name:'Face_Ornament',bone:'root'},{name:'mouth',bone:'Talk_Mouth'}],skins:[],animations:{move:{events:[{name:'JJNormal_Sound',time:.1}]}}}))
 assert.deepEqual(m.emotionSlots,['Blush_1','Eye_Water']);assert.deepEqual(m.mouthSlots,['mouth']);assert.deepEqual(m.animations[0].events,[{name:'JJNormal_Sound',time:.1}])
})
test('real source expressions, compound layers and original event audio tables',async()=>{
 const base=process.env.GAL_KAIJU_FIXTURE||'.cache/kaiju-20261117',ctx=prepare({texts:{'arc/native.json':await fs.readFile(base+'/context.json','utf8')},options:{}}),scripts=JSON.parse(await fs.readFile(base+'/scripts.json')),scene=id=>parse(JSON.stringify(scripts.find(s=>s.data.id===id).data),ctx),s=scene('5011')
 assert.ok(s.stats.normalizedSlots.some(r=>r.source==='Slot_Blush_Lv1 Slot_Blush_Lv2'&&r.names.length===2));assert.ok(scene('5022').stats.normalizedSlots.some(r=>r.source.includes('/')&&r.names.length===4));assert.ok(scene('5052').stats.normalizedSlots.some(r=>r.source==='Clip_Beads_Ass'&&r.names[0]==='Beads_Ass_Clip'))
 const actor=s.steps.flatMap(s=>s.commands).find(c=>c.op==='spine'&&c.slot==='kaiju:actor:0'&&c.slotVisibility?.Face_Happy===true);assert.equal(actor.slotVisibility.Blush_1,false);assert.equal(actor.slotVisibility.Blubber_Tears_1,false)
 const cg=ctx.models[ctx.prefabs.spine0311],audio=kaijuEventSounds(cg,ctx);assert.equal(audio.JJNormal_Sound.sounds.length,4);assert.deepEqual(audio.JJNormal_Sound.voices,[]);assert.ok(cg.animations.some(a=>a.events.some(e=>e.name==='JJNormal_Sound')))
})
test('event effects, bounded voice requests, loop completion and cancellation follow current model lifetime',()=>{
 const previous=globalThis.Audio,played=[],requests=[];globalThis.Audio=class extends EventTarget{constructor(src){super();this.src=src;this.paused=true}play(){this.paused=false;played.push(this);return Promise.resolve()}pause(){this.paused=true}}
 try{const audio=createSpineEventAudio({url:v=>v,onVoice:req=>{requests.push(req);return()=>req.done()}}),spec={skel:'model',anim:'A',eventToken:1,eventAudio:{hit:{sounds:['se70'],voices:['voice1']}},voiceLoop:{id:'stage1',voices:['loop1']}};audio.sync({main:spec});audio.event({slot:'main',name:'hit'});audio.event({slot:'main',name:'hit'});assert.equal(played.length,2);assert.equal(requests.length,1,'one pending voice per event');requests[0].done();audio.event({slot:'main',name:'hit'});assert.equal(requests.length,2)
 audio.sync({main:{...spec,eventToken:2}});assert.equal(requests[1].valid(),false);assert.ok(played.every(a=>a.paused));audio.event({slot:'main',name:'hit'});assert.equal(requests.at(-1).valid(),true);audio.setPaused(true);assert.equal(requests.at(-1).valid(),false);const count=played.length;audio.event({slot:'main',name:'hit'});assert.equal(played.length,count);audio.setPaused(false);audio.sync({});assert.equal(audio.info().slots,0);audio.destroy()
 }finally{globalThis.Audio=previous}
})

test('interaction expression resets preserve native base face and other fixed layers in all poses',async()=>{
 const base=process.env.GAL_KAIJU_FIXTURE||'.cache/kaiju-20261117',ctx=prepare({texts:{'arc/native.json':await fs.readFile(base+'/context.json','utf8')},options:{}}),scripts=JSON.parse(await fs.readFile(base+'/scripts.json'))
 for(const row of scripts.filter(s=>s.data.kind==='interaction')){const m=ctx.models[row.data.model],k=parse(JSON.stringify(row.data),ctx).interaction.roles[0].model.kaiju,native=new Set([...k.emotions,...k.actions].flatMap(r=>String(r.OpenSlots||'').split(':').filter(Boolean)));for(const name of Object.keys(k.defaultSlots))assert.ok(native.has(name),'not a native switch slot: '+row.data.pose+' / '+name);for(const slot of m.slots.filter(s=>s.name==='Face'))assert.equal(k.defaultSlots[slot.name],undefined,'preserve base face');assert.ok(k.faceSlots.includes('Face_Smile'))}
})

test('normal playback keeps native CG background hidden only by streamer-only commands',async()=>{
 const base=process.env.GAL_KAIJU_FIXTURE||'.cache/kaiju-20261117',ctx=prepare({texts:{'arc/native.json':await fs.readFile(base+'/context.json','utf8')},options:{}}),scripts=JSON.parse(await fs.readFile(base+'/scripts.json')),scene=parse(JSON.stringify(scripts.find(s=>s.data.id==='10007').data),ctx),picked=pickRenderStep(scene)
 assert.ok(picked.state.spines['kaiju:cg']);assert.notEqual(picked.state.spines['kaiju:cg'].slotVisibility.BG,false,'native BG-off event is streamer-only');assert.ok(scene.stats.streamModeSkipped.some(e=>e.event===48))
})
test('thumbnails choose visible actors and never seek past them into an empty frame',()=>{
 const spine=visible=>({op:'spine',slot:'actor',skel:'actor.json',kind:'actor',visible}),scene={steps:[{commands:[{op:'bg',src:'room.png'},spine(false)]},{commands:[]},{commands:[]},{commands:[spine(true)]},{commands:[]},{commands:[{op:'spineOff',slot:'actor'}]}]}
 const picked=pickRenderStep(scene);assert.equal(picked.index,3);assert.equal(picked.state.spines.actor.visible,true);assert.ok(pickRenderSteps(scene,150,3).every(p=>p.state.spines.actor?.visible===true));assert.equal(pickRenderStep({steps:[{commands:[spine(false)]}]}),null)
})

test('CG and detailed head atlases preserve detail without increasing every outfit page',()=>{
 assert.equal(kaijuPageTextureSize('TypeV-HCG3_SkeletonData',''),4096);assert.equal(kaijuPageTextureSize('KPQ_HMode_Normal','page.png\nsize: 4096,4096\nHair_Front\nbounds: 0,0,300,300\n'),2048);assert.equal(kaijuPageTextureSize('KPQ_HMode_Normal','page.png\nsize: 4096,4096\nSkirt\nbounds: 0,0,300,300\n'),1024)
})
