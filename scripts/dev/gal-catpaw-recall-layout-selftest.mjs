import assert from'node:assert/strict'
import{test}from'node:test'
import{prepare,parse}from'../../web/library/gal/adapters/catpaw-script.mjs'
import{stateAt}from'../../web/static/gal-engine.js'
for(const[game,role,x,y,scale]of[['future','asDoubleHapply2Prefab',-47,-139,2900],['underworld','doubleStory2Prefab',0,0,2700]])test(game+' recall keeps native uniform scale and offset instead of stretching to 16:9',()=>{
 const data={format:'catpaw-context/1',variant:game,prefix:game,locales:[],notes:[],media:{},models:{m:{src:'model.json',motions:[]}},prefabs:{[role]:'m'},prefabLayouts:{[game+'/recall/'+role.toLowerCase()]:{position:{x,y,z:0},scale:{x:scale,y:scale,z:1},rotation:{x:0,y:0,z:0,w:1}}},presentation:{recallStage:[3840,2160],recallContainer:{position:{x:0,y:0},scale:{x:1,y:1}}},configs:{recallConfig:{1:{id:'1',role}},talkConfig:{1:{talkContent:'line'}}},scenes:[]},ctx=prepare({texts:{'arc/native.json':JSON.stringify(data)}}),scene=parse(JSON.stringify({format:'catpaw-script/1',kind:'replay',id:'1',rows:['1']}),ctx),spec=Object.values(stateAt(scene,0).live2ds)[0];assert.deepEqual(spec.stage,[3840,2160]);assert.deepEqual(spec.nativeOrigin,{x,y,scaleX:scale,scaleY:scale});assert.equal(spec.fit,undefined)
})

test('unknown native recall layout preserves aspect through contain and does not fabricate coordinates',()=>{
 const ctx=prepare({texts:{'arc/native.json':JSON.stringify({format:'catpaw-context/1',locales:[],models:{m:{src:'model.json',motions:[]}},prefabs:{role:'m'},configs:{recallConfig:{1:{id:'1',role:'role'}},talkConfig:{1:{talkContent:'line'}}},scenes:[]})}}),s=parse(JSON.stringify({format:'catpaw-script/1',kind:'replay',id:'1',rows:['1']}),ctx),spec=Object.values(stateAt(s,0).live2ds)[0];assert.equal(spec.fit,'contain');assert.equal(spec.nativeOrigin,undefined)
})
