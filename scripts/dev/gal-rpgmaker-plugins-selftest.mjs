import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as rpg from '../../web/library/gal/adapters/rpgmaker-json.mjs'
import {collectVoices} from '../../web/library/gal/voice.mjs'
import {stateAt,activePath,visibleChoiceOptions,segmentsText} from '../../web/static/gal-engine.js'
const c=(code,parameters=[],indent=0)=>({code,parameters,indent}),mz=(name,action,args={})=>c(357,[name,action,'',args]),msg=text=>[c(101,['',0,0,2,'A']),c(401,[text])]
async function scene(list,plugins=[],others=[]){const events=[null,{id:1,name:'回想 scene',list},...others],ctx=await rpg.prepare({options:{},texts:{'data/System.json':JSON.stringify({advanced:{screenWidth:640,screenHeight:360}}),'data/CommonEvents.json':JSON.stringify(events),'js/plugins.js':'var $plugins='+JSON.stringify(plugins)+';'},files:[]});return rpg.parse(JSON.stringify(events),ctx,{rel:'data/CommonEvents.json',scene:'common-1'})}
const flat=s=>s.steps.flatMap(x=>x.commands)

test('MZ and Japanese MV voice channels are non-looping unless declared; stop preserves independent BGS lines',async()=>{
 const s=await scene([mz('ParallelBgs','CHANGE_LINE',{line:'2'}),c(245,[{name:'rain',volume:50}]),mz('SimpleVoice','PLAY_VOICE',{name:'talk/a',volume:'80',channel:'1',loop:'false'}),...msg('one'),mz('VisuMZ_2_VoiceActControl','SoundPlayAsVoiceLine',{'name:str':'talk/b','volume:num':'70'}),...msg('two'),mz('VisuMZ_2_VoiceActControl','SoundStopAllVoiceLines'),...msg('stopped'),c(356,['SV_ボイスのループ演奏 ambient 90 100 0 2']),...msg('loop'),c(356,['SV_ボイスの停止 2']),...msg('stop-loop')],[{name:'SimpleVoice',status:true,parameters:{}}])
 assert.equal(stateAt(s,0).bgvoices['rpg-voice-1'].src,'audio/se/talk/a.ogg');assert.equal(stateAt(s,0).bgvoices['rpg-voice-1'].loop,false)
 assert.ok(collectVoices(s).some(v=>v.src==='audio/se/talk/a.ogg'&&v.kind==='voice'))
 assert.equal(stateAt(s,1).bgvoices['rpg-voice-1'].src,'audio/se/talk/b.ogg')
 assert.deepEqual(Object.keys(stateAt(s,2).bgvoices),['rpg-bgs-2'])
 assert.equal(stateAt(s,3).bgvoices['rpg-voice-2'].loop,true)
 assert.deepEqual(Object.keys(stateAt(s,4).bgvoices),['rpg-bgs-2'])
 assert.ok(!Object.keys(s.stats.raw).some(k=>k.includes('SimpleVoice')||k.includes('VisuMZ')))
})

test('structured choice filters switch-gated entries, reindexes default results and writes the requested game variable',async()=>{
 const choices=[{label:'hidden',switchId:'9',resultNumber:'0'},{label:'visible',switchId:'0',resultNumber:'0'},{label:'explicit',switchId:'0',resultNumber:'7'}].map(JSON.stringify)
 const s=await scene([mz('LL_GalgeChoiceWindow','showChoice',{messageText:'Choose',choices:JSON.stringify(choices),variableNumber:'86'}),c(111,[1,86,0,1,0]),...msg('selected visible').map(c=>({...c,indent:1})),c(411),...msg('other').map(c=>({...c,indent:1})),c(412)])
 const choice=flat(s).find(c=>c.op==='choice');assert.deepEqual(visibleChoiceOptions(choice,{}).map(o=>o.value),[1,7])
 const history={[choice.id]:1},text=activePath(s,history).map(i=>segmentsText(stateAt(s,i,history).text))
 assert.ok(text.includes('selected visible'));assert.ok(!text.includes('other'));assert.equal(stateAt(s,s.steps.length-1,history).vars['rpg:v:86'],'1')
})

test('plugin windows and variable groups preserve show/append/hide state through seek; text pictures use native picture coordinates',async()=>{
 const plugins=[{name:'LogDisplayPlugin',status:true,parameters:{logSettings:JSON.stringify([JSON.stringify({name:'dialogue',x:'100',y:'50',width:'300',height:'100'})])}},{name:'VariableSpriteDisplay',status:true,parameters:{variableGroups:JSON.stringify([JSON.stringify({name:'status',variables:JSON.stringify([JSON.stringify({variableId:'9',x:'25',y:'30'})])})]),imageSprites:'[]'}}]
 const s=await scene([c(122,[9,9,0,0,12]),mz('LogDisplayPlugin','showLog',{logName:'dialogue'}),mz('LogDisplayPlugin','setNewText',{logName:'dialogue',text:'first'}),mz('LogDisplayPlugin','addToText',{logName:'dialogue',text:'second'}),mz('VariableSpriteDisplay','showGroup',{groupName:'status'}),c(356,['D_TEXT value=\\V[9] 28']),c(231,[2,'',0,0,50,80,100,100,255,0]),...msg('regular'),mz('LogDisplayPlugin','hideLog',{logName:'dialogue'}),...msg('hidden')],plugins)
 assert.equal(stateAt(s,0).ui,false);assert.equal(stateAt(s,0).rpgUi['rpg-log-dialogue'].x,'100')
 assert.equal(segmentsText(stateAt(s,1).rpgUi['rpg-log-dialogue'].segments),'first\nsecond')
 assert.equal(stateAt(s,2).rpgUi['rpg-vars-status-0'].segments[0].var,'rpg:v:9')
 assert.equal(stateAt(s,2).rpgUi['rpg-picture-2'].y,80)
 assert.equal(stateAt(s,3).rpgUi['rpg-log-dialogue'].visible,false)
 assert.equal(segmentsText(stateAt(s,0).rpgUi['rpg-log-dialogue'].segments),'first','later appends must not mutate prior snapshots')
})

test('picture callbacks become gated reader actions, execute their common event and variable operation, and restore on backtracking',async()=>{
 const binding={pictureId:'5',commonEventId:'2',variableId:'4',operationType:'1',operand:'3'}
 const s=await scene([c(122,[4,4,0,0,10]),c(231,[5,'button',0,0,0,0,100,100,255,0]),mz('PictureCallCommon','ADD_PICTURE_EVENT',binding),...msg('before')],[],[{id:2,name:'callback',list:msg('after')}])
 const action=flat(s).find(c=>c.op==='choice'),option=visibleChoiceOptions(action,stateAt(s,0).vars).find(o=>o.pictureSlot)
 assert.equal(option.pictureSlot,'rpg-picture-5')
 const history={[action.id]:option.value},last=stateAt(s,s.steps.length-1,history)
 assert.equal(last.vars['rpg:v:4'],13);assert.equal(segmentsText(last.text),'after');assert.equal(stateAt(s,0).vars['rpg:v:4'],10)
})

test('conditional forward label jumps skip only the active branch and RNG is stable on replay',async()=>{
 const s=await scene([c(121,[1,1,0]),c(111,[0,1,0]),c(119,['target'],1),c(412),...msg('must skip'),c(118,['target']),c(122,[2,2,0,2,3,9]),...msg('value=\\V[2]')])
 const texts=activePath(s,{}).map(i=>segmentsText(stateAt(s,i).text));assert.ok(!texts.includes('must skip'))
 const a=stateAt(s,s.steps.length-1),b=stateAt(s,s.steps.length-1)
 assert.ok(a.vars['rpg:v:2']>=3&&a.vars['rpg:v:2']<=9);assert.equal(a.vars['rpg:v:2'],b.vars['rpg:v:2'])
})

test('LogMessage native add is dialogue and retains geometry/clear/visibility across seek',async()=>{
 const s=await scene([mz('LogMessage','init',{x:'30',y:'40',width:'500',height:'200'}),mz('LogMessage','add',{text:'first'}),mz('LogMessage','add',{text:'second'}),mz('LogMessage','clear'),mz('LogMessage','add',{text:'fresh'}),mz('LogMessage','hide'),...msg('normal')]);
 assert.equal(s.stats.text,4);assert.equal(segmentsText(stateAt(s,0).text),'first');assert.equal(stateAt(s,0).rpgUi['rpg-log-message'].x,30);assert.equal(segmentsText(stateAt(s,1).rpgUi['rpg-log-message'].segments),'first\nsecond');assert.equal(segmentsText(stateAt(s,2).rpgUi['rpg-log-message'].segments),'fresh');assert.equal(stateAt(s,3).rpgUi['rpg-log-message'].visible,false);assert.ok(!s.stats.raw['plugin:LogMessage']);
});
