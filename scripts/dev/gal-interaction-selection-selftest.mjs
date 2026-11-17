import assert from'node:assert/strict'
import{test}from'node:test'
import{roleState,toggleInteractionTool,interactionFeedback}from'../../web/static/gal-interaction-state.js'
const role={outfits:[],faces:[],tools:['a','b','c'].map(id=>({id,areas:[{id:'head',replies:[{id}],motion:id}]}))}
test('independent tool toggles route actions to the latest enabled tool and restore the previous one',()=>{
 const s=roleState(role);toggleInteractionTool(role,s,'a');toggleInteractionTool(role,s,'b');assert.deepEqual(s.enabledTools,['a','b']);assert.equal(interactionFeedback(role,s,['head']).reply.id,'b')
 assert.equal(toggleInteractionTool(role,s,'a'),true);assert.equal(s.tool,'a');assert.deepEqual(s.enabledTools,['a','b']);toggleInteractionTool(role,s,'a');assert.equal(s.tool,'b');toggleInteractionTool(role,s,'b');assert.equal(s.tool,'');assert.equal(interactionFeedback(role,s,['head']),null)
})
test('ordered selections restore per role, migrate old single selections and discard unavailable tools',()=>{
 assert.deepEqual(roleState(role,{tool:'a'}).enabledTools,['a']);const s=roleState(role,{enabledTools:['b','missing','a','b'],tool:'c'});assert.deepEqual(s.enabledTools,['b','a']);assert.equal(s.tool,'a');assert.deepEqual(roleState(role,{enabledTools:[],tool:'a'}).enabledTools,[]);assert.deepEqual(roleState({...role,tools:[]},s).enabledTools,[])
})
