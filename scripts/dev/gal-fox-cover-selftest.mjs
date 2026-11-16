import assert from'node:assert/strict'
import{test}from'node:test'
import{parseFoxRoom}from'../../web/library/gal/adapters/unity-fox-room.mjs'
import{catalog}from'../../web/library/gal/adapters/unity-spine-gallery.mjs'
import{stateAt}from'../../web/static/gal-engine.js'
test('dedicated cover initializes native body/face while excluding dialogue and interaction choices',()=>{
 const graphic={object:'1',chain:['1'],stage:[1920,1080],place:{x:0,y:0,scale:1}},model={skel:'model.skel',atlas:'model.atlas',skins:['default'],animations:[{name:'body',duration:1},{name:'face',duration:1}]},room={source:'level4:manager',models:{'':'main'},initial:{skin:'default'},graphics:{'':graphic},objectStates:{1:true},gameObjects:{},functions:{init:{interactiveFlows:[{$type:'CallAVG',label:'opening',wait:false},{$type:'ChangeSpine',target:'',animationName:'body',trackIndex:0,loop:true},{$type:'ChangeSpine',target:'',animationName:'face',trackIndex:2,loop:true}]}}},scene=parseFoxRoom({room},{options:{maxCommands:1000},models:{main:model},dialogue:{opening:[{Command:'Selection',Text:'choose'},{Text:'dialogue'}]},voices:{}},{scene:'cover'}),s=stateAt(scene,0);assert.equal(scene.steps.length,1);assert.equal(scene.stats.messages,0);assert.deepEqual(s.spines['fox:'].tracks.map(t=>t.anim),['body','face']);assert.ok(scene.steps[0].commands.every(c=>!['choice','text','wait'].includes(c.op)));assert.equal(s.spines['fox:'].nativePlace,true)
})
test('CG room directories use their own lightweight cover endpoint',()=>{
 const s={name:'Ch02_scene',script:'arc/script/room.uspine',functions:['init'],interactions:['action']},tree=catalog({scenes:[s]}),room=tree.children[0].children[0];assert.equal(room.coverScript,s.script+'::cover');assert.ok(room.children.some(c=>c.title==='原生互动演出'));assert.equal(tree.children[1].children[0].children[0].coverScript,room.coverScript)
})
