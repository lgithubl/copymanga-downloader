import assert from'node:assert/strict'
import{test}from'node:test'
import{interactionAlternatives,alternativeKey,alternativePool}from'../../web/static/gal-interaction-alternatives.js'
import{interactionFeedback,roleState,interactionSpec}from'../../web/static/gal-interaction-state.js'
const role={id:'r',model:{src:'real'},hitAreas:[],outfits:[],faces:[],tools:[{id:'tool',areas:[{id:'point',replies:[{text:'one',voice:'one.ogg'},{text:'two',voice:'two.ogg'}],commands:[{op:'interactionVoiceChoice',id:'native',random:true,options:[{value:1,voice:'a.ogg'},{value:2,voice:'b.ogg'}]}]}]}]}
test('lists actual feedback and native random alternatives; explicit selection survives state and reaches playback',()=>{
 const s=roleState(role,{tool:'tool'}),key=alternativeKey('tool','point');assert.deepEqual(interactionAlternatives(role,s,'point').map(g=>[g.id,g.choices.length]),[['reply',2],['choice:native',2]])
 s.alternatives[key]={reply:'1','choice:native':'2'};const f=interactionFeedback(role,s,['point']);assert.equal(f.reply.voice,'two.ogg');assert.equal(interactionSpec(role,s,f.action,1).alternativeSelections['choice:native'],'2');assert.equal(interactionAlternatives(role,s,'other').length,0)
})

test('multiple feedback choices remain enabled and cycle only the selected pool',()=>{
 const s=roleState(role,{tool:'tool'}),key=alternativeKey('tool','point');s.alternatives[key]={reply:['0','1']};assert.deepEqual(Array.from({length:4},()=>interactionFeedback(role,s,['point']).reply.voice),['one.ogg','two.ogg','one.ogg','two.ogg']);s.alternatives[key].reply=['1'];assert.equal(interactionFeedback(role,s,['point']).reply.voice,'two.ogg');assert.deepEqual(alternativePool([{value:1},{value:2},{value:3}],['1','3']),[{value:1},{value:3}]);assert.equal(alternativePool([{value:1}],[]).length,1)
})

test('enabled reply pools keep independent cursors for different regions',()=>{
 const r=structuredClone(role);r.tools[0].areas.push({...structuredClone(r.tools[0].areas[0]),id:'second'});const s=roleState(r,{tool:'tool'});for(const area of ['point','second'])s.alternatives[alternativeKey('tool',area)]={reply:['0','1']};assert.deepEqual(['point','second','point','second'].map(area=>interactionFeedback(r,s,[area]).reply.voice),['one.ogg','one.ogg','two.ogg','two.ogg'])
})
