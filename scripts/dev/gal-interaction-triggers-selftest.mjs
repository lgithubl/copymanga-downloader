import assert from'node:assert/strict'
import{test}from'node:test'
import{createInteractionTriggers,interactionPreferences,interactionTriggerMode,toolModeKey,areaModeKey}from'../../web/static/gal-interaction-triggers.js'
function clock(){let now=0,id=0;const timers=new Map();return{setTimer(fn,ms){timers.set(++id,{fn,at:now+ms});return id},clearTimer(i){timers.delete(i)},advance(ms){const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn()}now=end},get size(){return timers.size}}}
test('independent automatic targets, toggle stop, hold release and lifecycle cancellation',()=>{
 const c=clock(),calls=[],t=createInteractionTriggers({...c,fire:p=>calls.push(p.id),blocked:()=>false,interval:()=>500});t.toggle('a',{id:'a'});t.start('b',{id:'b'},'hold');assert.deepEqual(calls,['a','b']);c.advance(500);assert.deepEqual(calls,['a','b','a','b']);t.stopHolds();c.advance(500);assert.deepEqual(calls,['a','b','a','b','a']);t.toggle('a',{id:'a'});c.advance(1000);assert.equal(calls.length,5);t.start('a',{id:'a'},'repeat');t.destroy();assert.equal(c.size,0);c.advance(5000);assert.equal(calls.length,6)
})
test('voice/loading gate keeps a bounded FIFO, resumes fairly and drops released hold requests',()=>{
 const c=clock(),calls=[];let busy=true;const t=createInteractionTriggers({...c,fire:p=>{calls.push(p.id);busy=true},blocked:()=>busy,interval:()=>500});t.start('a',{id:'a'},'repeat');t.start('b',{id:'b'},'repeat');c.advance(1500);assert.equal(t.pending,2);assert.equal(calls.length,0);busy=false;t.notify();assert.deepEqual(calls,['a']);c.advance(500);busy=false;t.notify();assert.deepEqual(calls,['a','b']);t.start('h',{id:'hold'},'hold');t.stopHolds();t.stopAll();busy=false;t.notify();assert.equal(calls.length,2);assert.equal(c.size,0)
})
test('manual gate queues one latest request per target; disabling the voice gate releases it',()=>{
 let busy=true;const calls=[],t=createInteractionTriggers({fire:p=>calls.push(p.value),blocked:()=>busy,interval:()=>500});t.request('a',{value:1});t.request('a',{value:2});assert.equal(t.pending,1);assert.deepEqual(calls,[]);busy=false;t.notify();assert.deepEqual(calls,[2]);t.destroy()
})
test('preferences clamp corrupt values and per-role/tool/area modes do not cross games',()=>{
 const a=interactionPreferences({interval:0,voiceVolume:7,textOpacity:-1,waitVoice:true,toolModes:{bad:'evil'}}),b=interactionPreferences();assert.equal(a.interval,200);assert.equal(a.voiceVolume,1);assert.equal(a.textOpacity,0);assert.deepEqual(a.toolModes,{});a.toolModes[toolModeKey('r','t')]='repeat';a.areaModes[areaModeKey('r','t','one')]='hold';assert.equal(interactionTriggerMode(a,'r','t','one'),'hold');assert.equal(interactionTriggerMode(a,'r','t','two'),'repeat');assert.equal(interactionTriggerMode(a,'r','other','one'),'single');assert.equal(interactionTriggerMode(b,'r','t','one'),'single');assert.equal(b.waitVoice,false)
})
