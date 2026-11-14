import{test}from'node:test'
import assert from'node:assert/strict'
import{activeCommandsAt,stateAt}from'../../web/static/gal-engine.js'
import{parse}from'../../web/library/gal/adapters/edo-ikunyu.mjs'
test('replay retains the voice whose guard matched before the CFG counter advanced',()=>{
 const source=JSON.stringify({format:'edo-lua/1',name:'src/game/replay',text:'playVoice("first.ogg")\ntext("first")\nplayVoice("second.ogg")\ntext("second")'})
 const scene=parse(source);const voice=scene.steps[1].commands.find(c=>c.op==='voice');assert.ok(voice.when);assert.ok(!activeCommandsAt(scene,1).some(c=>c.src==='first.ogg'));assert.equal(activeCommandsAt(scene,1).find(c=>c.op==='voice').src,'ogg/voice/second.ogg')
 // The original replay filter used this final state and incorrectly disabled replay.
 const final=stateAt(scene,1);assert.notEqual(String(final.vars[voice.when[0].var]),String(voice.when[0].value))
})
test('replay excludes the unselected branch and preserves ordinary unguarded scenes',()=>{
 const scene={steps:[{commands:[{op:'choice',id:'route',var:'route',options:[{value:1},{value:2}]}]},{commands:[{op:'voice',src:'a.ogg',when:[{var:'route',op:'==',value:1}]},{op:'voice',src:'b.ogg',when:[{var:'route',op:'==',value:2}]}]}]};assert.deepEqual(activeCommandsAt(scene,1,{route:2}).map(c=>c.src),['b.ogg']);assert.deepEqual(activeCommandsAt({steps:[{commands:[{op:'voice',src:'plain.ogg'}]}]},0).map(c=>c.src),['plain.ogg'])
})
