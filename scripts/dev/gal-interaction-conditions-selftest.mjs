import assert from'node:assert/strict'
import{test}from'node:test'
import{conditionKey,conditionValue,interactionConditions}from'../../web/static/gal-interaction-conditions.js'
import{parseFoxRoom}from'../../web/library/gal/adapters/unity-fox-room.mjs'
const condition={key:'source:condition',label:'Favor >= 1',trueValue:0,falseValue:1},role={id:'scene1',characterId:'character',model:{initialCommands:[]},tools:[{areas:[{commands:[{op:'choice',interactionCondition:condition},{op:'choice',random:true}]}]}]}
test('condition overrides persist across scenes of one character, distinguish characters and use the game default',()=>{
 assert.equal(interactionConditions(role).length,1);assert.equal(conditionValue(role,condition),true);const preferences={default:false,values:{[conditionKey(role,condition)]:true}};assert.equal(conditionValue({...role,id:'scene2'},condition,preferences),true);assert.equal(conditionValue({...role,characterId:'other'},condition,preferences),false);assert.equal(conditionValue(role,condition,{default:false}),false)
})
test('Fox native unknown conditions expose semantic settings and mark only synthetic prompts',()=>{
 const command={$type:'GrilInfomationBranch',girlName:'girl',girlInfomation:'favor',condition:{valueConditionals:[{compareOperator:2,logicOperator:0,b:1}]},trueBlock:{interactiveFlows:[]},falseBlock:{interactiveFlows:[]}},room={source:'source:1',models:{'':'main'},initial:{skin:'default'},gameObjects:{},functions:{init:{interactiveFlows:[command]}}},ctx={options:{maxCommands:10000,skin:'default'},models:{main:{skel:'a',atlas:'b',skins:['default'],animations:[]}},voices:{},dialogue:{}},commands=parseFoxRoom({room},ctx).steps.flatMap(s=>s.commands),choice=commands.find(c=>c.interactionCondition)
 assert.equal(choice.interactionCondition.trueValue,0);assert.equal(choice.interactionCondition.falseValue,1);assert.ok(commands.some(c=>c.interactionConditionPrompt));assert.ok(!choice.random)
})
