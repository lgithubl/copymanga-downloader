import assert from 'node:assert/strict'
import {prepare,parse} from '../../web/library/gal/adapters/rpgmaker-json.mjs'
import {resolveLayout} from '../tag-scripts/gal-layout/main.js'
const C=(code,parameters=[])=>({code,parameters}),say=t=>[C(101,['',0,0,2]),C(401,[t])],me=name=>C(249,[{name,volume:50,pitch:100,pan:0}]),common=[null,
 {id:1,name:'回想-对白',list:[me('15_PureLove_001'),...say('voice'),C(117,[2]),...say('tail'),...say('tail2'),...say('tail3')]},
 {id:2,name:'语音助手',list:[me('03_Ceremony_004'),...say('nested speech')]},
 {id:3,name:'回想-音效',list:[me('LNSM_ME01_Happy1'),C(250,[{name:'Sis_haa-1'}]),...say('sfx'),...say('a'),...say('b'),...say('c')]},
 {id:4,name:'回想-语音文件不存在',list:[me('15_PureLove_999'),...say('a'),...say('b'),...say('c'),...say('d')]},
 {id:5,name:'回想-被排除的玩法助手',list:[C(117,[6]),...say('a'),...say('b'),...say('c'),...say('d')]},
 {id:6,name:'睡到第二天',list:[me('06_DayNight_011'),...say('game loop')]}
],files=['data/CommonEvents.json','audio/me/15_PureLove_001.rpgmvo','audio/me/03_Ceremony_004.rpgmvo','audio/me/06_DayNight_011.rpgmvo'],texts={'data/CommonEvents.json':JSON.stringify(common)},options=resolveLayout('rpgmaker::RJ01234887').ruleOverrides['rpgmaker-json']
const old=await prepare({options:{},texts,files});assert.ok(!old.catalogTree.children.some(c=>c.id==='special-voiced'));assert.ok(parse('',old,{rel:files[0],scene:'common-1'}).steps.flatMap(s=>s.commands).some(c=>c.op==='se'&&c.src==='audio/me/15_PureLove_001.ogg'),'unchanged default ME channel')
const ctx=await prepare({options,texts,files}),group=ctx.catalogTree.children.find(c=>c.id==='special-voiced');assert.equal(group.title,'特殊场景（有配音）');assert.equal(group.children.length,1);assert.ok(group.children[0].subtitle.includes('2 个对白配音资源'));assert.equal(group.children[0].script,'data/CommonEvents.json::common-1');assert.equal(ctx.catalogTree.children.find(c=>c.id==='special').children.length,4,'original special scenes retained')
const scene=parse('',ctx,{rel:files[0],scene:'common-1'}),voices=scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='voice');assert.equal(voices.length,2);assert.equal(voices[0].src,'audio/me/15_PureLove_001.ogg');assert.equal(voices[0].volume,.5);assert.equal(scene.steps[0].commands.find(c=>c.op==='text').segments[0].text,'voice')
assert.ok(parse('',ctx,{rel:files[0],scene:'common-3'}).steps.flatMap(s=>s.commands).every(c=>c.op!=='voice'),'fanfare and short stock vocal sounds excluded from dialogue group');assert.equal(resolveLayout('rpgmaker::custom').ruleOverrides?.['rpgmaker-json']?.plugins?.meVoiceMatch,undefined)
console.log('PASS RJ01234887 opt-in voiced catalog, nested dialogue counts and resource existence, native ME-to-voice routing, gameplay exclusions, sound-effect exclusion and existing RPG defaults')
