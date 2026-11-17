import assert from'node:assert/strict'
import{test}from'node:test'
import fs from'node:fs/promises'
import{resolveKaijuSlots,kaijuEventSounds}from'../../web/library/gal/kaiju-presentation.mjs'
import{spineJsonInfo}from'../../web/library/gal/kaiju-data.mjs'
import{prepare,parse}from'../../web/library/gal/adapters/kaiju-script.mjs'
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
