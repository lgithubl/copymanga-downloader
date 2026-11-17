import assert from'node:assert/strict'
import{test}from'node:test'
import{createInteractionSounds}from'../../web/static/gal-interaction-sounds.js'
import{foxStateDefaults}from'../../web/library/gal/unity-fox-state.mjs'
import{foxToggleEntries}from'../../web/library/gal/adapters/unity-fox-toggles.mjs'
import{parseFoxRoom}from'../../web/library/gal/adapters/unity-fox-room.mjs'
import{stateAt}from'../../web/static/gal-engine.js'
import{createInteractionMeter}from'../../web/static/gal-interaction-meters.js'
test('original managed-reference numeric defaults replace artificial condition choices and retain native stage bounds',()=>{
 const d=foxStateDefaults({allGirlArray:[{rid:'9007199254740993'}],references:{RefIds:[{rid:'9007199254740993',data:{name:'girl1',informationList:[{rid:'2'},{rid:'3'}]}},{rid:'2',type:{class:'IntGirlInfomation'},data:{label:'陰道',data:0}},{rid:'3',type:{class:'ClampFloatGirlInfomation'},data:{label:'愛心',data:{inside_v:0,min:0,max:3,mode:2}}}]}})
 assert.equal(d.defaultStates['fox-state:girl1:陰道'],0);assert.equal(d.stateBounds['fox-state:girl1:愛心'].max,3)
 const room={source:'scene',models:{},initial:{},gameObjects:{},functions:{act:{interactiveFlows:[{$type:'GrilInfomationBranch',girlName:'girl1',girlInfomation:'陰道',condition:{valueConditionals:[{compareOperator:4,logicOperator:0,b:0}]},trueBlock:{interactiveFlows:[{$type:'SetXState',girlName:'girl1',stateName:'state',value:7}]},falseBlock:{interactiveFlows:[]}}]}}},scene=parseFoxRoom({room},{...d,models:{},dialogue:{},voices:{},options:{maxCommands:1000}},{interactionAction:'act'})
 assert.ok(!scene.steps.flatMap(s=>s.commands).some(c=>c.interactionCondition));assert.equal(stateAt(scene,scene.steps.length-1).vars['fox-state:girl1:state'],7)
})
test('toggle entries call real inverse functions, preserve stable action ids and do not invent a missing function',()=>{
 const interactions=['小穴插入','揉奶','小穴拔出插入','揉奶解除','unknown'],functions=Object.fromEntries(interactions.map(n=>[n,{}])),rows=foxToggleEntries({interactions,functions});assert.deepEqual(rows,[{name:'小穴插入',off:'小穴拔出插入'},{name:'揉奶',off:'揉奶解除'},{name:'unknown',off:undefined}])
})
test('full-meter stage waits in the shared queue, latches despite negative rate, and respects original max stage',()=>{
 const m=createInteractionMeter({bars:{girl:{max:1,rate:-.1}},stageMax:3,highSeconds:.1},{count:3});m.seek(1);assert.equal(m.tick(.1,{busy:true}),null);assert.equal(m.pending(),'iku');m.tick(.25,{busy:true});assert.equal(m.snapshot().value,1);assert.equal(m.tick(0),'iku');assert.equal(m.snapshot().count,3);assert.equal(m.pending(),null);m.tick(.2);m.tick(.1);assert.equal(m.snapshot().count,3)
})

test('native automatic sound groups defer behind active voices, rotate fairly and release the shared queue',()=>{
 const previous=globalThis.Audio,played=[];let blocked=true,idle=0
 globalThis.Audio=class extends EventTarget{constructor(src){super();this.src=src;this.paused=true}play(){this.paused=false;played.push(this);return Promise.resolve()}pause(){this.paused=true}finish(){this.paused=true;this.dispatchEvent(new Event('ended'))}}
 try{const s=createInteractionSounds({url:v=>v,canPlay:()=>!blocked&&!s.audio(),onIdle:()=>idle++});s.set('x',[{id:'a',playOnEnable:true,auto:true,period:.1,clips:[{src:'a'}]},{id:'b',playOnEnable:true,auto:true,period:.1,clips:[{src:'b'}]}]);s.tick(.2,{});assert.equal(played.length,0);blocked=false;s.tick(.1,{});assert.equal(played[0].src,'a');s.tick(.3,{});assert.equal(played.length,1);played[0].finish();s.tick(.1,{});assert.equal(played[1].src,'b');assert.equal(idle,1);s.clear();s.tick(.1,{});assert.equal(played.length,2)}finally{globalThis.Audio=previous}
})
