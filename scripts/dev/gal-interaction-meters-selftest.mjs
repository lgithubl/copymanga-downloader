import assert from'node:assert/strict'
import{test}from'node:test'
import{createInteractionMeter}from'../../web/static/gal-interaction-meters.js'
import{createInteractionSounds}from'../../web/static/gal-interaction-sounds.js'
test('seeking is a one-time change; native rates continue and thresholds invoke authored stages',()=>{
 const m=createInteractionMeter({bars:{girl:{max:1,value:0,rate:-.01},heart:{max:1}},heartAddOnce:.2,highSeconds:.5,zeroSeconds:.5});m.rate('idle',-.01);m.rate('action',.11,true);m.seek(.5);m.tick(.2);assert.ok(Math.abs(m.snapshot().value-.52)<1e-9);m.seek(.75);m.tick(.2);assert.ok(Math.abs(m.snapshot().value-.77)<1e-9);m.seek(1);assert.equal(m.tick(.1),'iku');assert.equal(m.snapshot().count,1);assert.equal(m.snapshot().value,0);m.tick(.25);m.tick(.25);assert.equal(m.snapshot().heart,.2);m.tick(.2);assert.ok(m.snapshot().value>0);m.rate('action',0);m.seek(0);m.tick(.25);assert.equal(m.tick(.25),'riku');assert.equal(m.snapshot().count,0)
})
test('busy playback defers a full meter, resumes once and preserves rate on restore',()=>{
 const m=createInteractionMeter({bars:{girl:{max:1}},highSeconds:1},{value:.6,count:2});m.rate(1,.1);m.seek(1);assert.equal(m.tick(.1,{busy:true}),null);assert.equal(m.tick(.1),'iku');assert.equal(m.snapshot().count,3);assert.equal(m.tick(.1),null)
})
test('native MultiSound follows active branch, authored order and keeps its cursor across toggles',()=>{
 const made=[];globalThis.Audio=class{constructor(src){this.src=src;this.paused=true;made.push(this)}addEventListener(){}play(){this.paused=false;return Promise.resolve()}pause(){this.paused=true}};const sounds=createInteractionSounds({url:s=>s}),groups=[{id:'native',chain:['root','child'],auto:true,period:.2,clips:[{src:'one'},{src:'two'}]}];sounds.set('voice',groups,{root:true,child:false});sounds.tick(.2,{});assert.equal(made.length,0);sounds.tick(.2,{'fox-active:child':1});assert.equal(made[0].src,'one');sounds.stop('voice');assert.equal(made[0].paused,true);sounds.set('voice',groups,{root:true,child:true});sounds.tick(.2,{});assert.equal(made[1].src,'two');sounds.clear();assert.ok(made.every(a=>a.paused))
})
