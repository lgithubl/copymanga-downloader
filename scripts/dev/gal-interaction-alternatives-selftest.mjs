import assert from'node:assert/strict'
import{test}from'node:test'
import{interactionAlternatives,alternativeKey}from'../../web/static/gal-interaction-alternatives.js'
import{interactionFeedback,roleState,interactionSpec}from'../../web/static/gal-interaction-state.js'
const role={id:'r',model:{src:'real'},hitAreas:[],outfits:[],faces:[],tools:[{id:'tool',areas:[{id:'point',replies:[{text:'one',voice:'one.ogg'},{text:'two',voice:'two.ogg'}],commands:[{op:'interactionVoiceChoice',id:'native',random:true,options:[{value:1,voice:'a.ogg'},{value:2,voice:'b.ogg'}]}]}]}]}
test('lists actual feedback and native random alternatives; explicit selection survives state and reaches playback',()=>{
 const s=roleState(role,{tool:'tool'}),key=alternativeKey('tool','point');assert.deepEqual(interactionAlternatives(role,s,'point').map(g=>[g.id,g.choices.length]),[['reply',2],['choice:native',2]])
 s.alternatives[key]={reply:'1','choice:native':'2'};const f=interactionFeedback(role,s,['point']);assert.equal(f.reply.voice,'two.ogg');assert.equal(interactionSpec(role,s,f.action,1).alternativeSelections['choice:native'],'2');assert.equal(interactionAlternatives(role,s,'other').length,0)
})
