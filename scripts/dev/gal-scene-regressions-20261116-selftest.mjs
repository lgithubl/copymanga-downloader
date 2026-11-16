import assert from'node:assert/strict'
import{test}from'node:test'
import{parseFoxRoom}from'../../web/library/gal/adapters/unity-fox-room.mjs'
import{catalog as orcCatalog}from'../../web/library/gal/adapters/orcx-script.mjs'
import * as rpg from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{stateAt}from'../../web/static/gal-engine.js'
const graphic={object:'1',chain:['1'],stage:[1920,1080],place:{x:834,y:384,scale:.6}},model={skel:'a.skel',atlas:'a.atlas',skins:['default'],animations:[{name:'body',duration:1},{name:'face',duration:1}]}
test('Fox nonblocking native opening installs body and face tracks before the first line, with authored inset placement',()=>{
 const room={source:'level4:manager',models:{'':'main',inset:'main'},initial:{skin:'default'},graphics:{'':graphic,inset:graphic},objectStates:{1:true},gameObjects:{},functions:{init:{interactiveFlows:[{$type:'CallAVG',label:'opening',wait:false},{$type:'ChangeSpine',target:'',animationName:'body',trackIndex:0,loop:true,timeScale:1},{$type:'ChangeSpine',target:'',animationName:'face',trackIndex:2,loop:true,timeScale:1}]}}},ctx={options:{maxCommands:1000},models:{main:model},dialogue:{opening:[{Text:'first line'}]},voices:{}},scene=parseFoxRoom({room},ctx),first=stateAt(scene,0)
 assert.deepEqual(first.spines['fox:'].tracks.map(t=>t.anim),['body','face']);assert.equal(first.text[0].text,'first line');assert.equal(first.spines['fox:inset'].nativePlace,true);assert.deepEqual(first.spines['fox:inset'].place,graphic.place)
})
test('OrcX special cards group by exact first character ID without dropping or renaming scenes',()=>{
 const names=['50_ap_001_01_00_03','50_ap_001_02_00_00','50_ap_002_01_00_00','00_op_000'],ctx={assets:{},scenes:names.map(name=>({name,script:name+'.orcx',pack:'main'}))},tree=orcCatalog(ctx),groups=tree.children[0].children;assert.equal(groups.length,2);assert.deepEqual(groups[0].children.map(c=>c.title),names.slice(0,2));assert.equal(tree.children.at(-1).children.length,4)
})
test('Hakubox native adventure script renders layered body/face and timed hand frames, with no JS execution',async()=>{
 const script=["const _scene = SceneManager._scene;","_scene.tachieDirection = 'back';","_scene.tachieFace = '02';","_scene.tachieIsReached = false;","_scene.updateTachie();"],events=[null,{id:1,name:'native adventure action',list:[{code:355,parameters:[script[0]]},...script.slice(1).map(line=>({code:655,parameters:[line]})),{code:101,parameters:['',0,0,2,'A']},{code:401,parameters:['line one']},{code:355,parameters:["_scene.showSexAction('02');"]},{code:101,parameters:['',0,0,2,'A']},{code:401,parameters:['line two']}]}],ctx=await rpg.prepare({texts:{'data/System.json':JSON.stringify({advanced:{screenWidth:1280,screenHeight:720}}),'data/CommonEvents.json':JSON.stringify(events),'js/plugins.js':'var $plugins='+JSON.stringify([{name:'Hakubox_Core',status:true,parameters:{}}])+';'},files:[]}),scene=rpg.parse(JSON.stringify(events),ctx,{scene:'common-1'}),first=stateAt(scene,0),last=stateAt(scene,scene.steps.length-1)
 assert.ok(first.overlays.some(o=>o.src?.endsWith('adventure/tachie/body_back.png')));assert.ok(first.overlays.some(o=>o.src?.endsWith('adventure/tachie/face/02.png')));assert.ok(first.overlays.every(o=>o.anchor[0]===0&&o.anchor[1]===0));assert.ok(last.overlays.some(o=>o.animation?.frames.length===7&&o.animation.frames.at(-1).src===''));assert.equal(scene.stats.raw['script-unhandled'],undefined)
})

test('large multi-atlas Live2D textures stay inside the GPU budget and native UV aspect',async()=>{
 const {live2dTextureSize}=await import('../../web/static/gal-live2d.js')
 for(const count of[1,2,3,8]){const size=live2dTextureSize(8192,8192,count);assert.ok(size.width<=4096&&size.width>0);assert.equal(size.width,size.height);assert.ok(size.width*size.height*4*count*4/3<=192*1024*1024)}
 const size=live2dTextureSize(8192,4096,3,2048);assert.equal(size.width,2048);assert.equal(size.height,1024)
})
test('native Live2D texture uses an authored mip range instead of decoding the 8192 base atlas',async()=>{
 const {UnityStore}=await import('../../web/library/gal/unity-store.mjs'),store=new UnityStore('/unused'),reads=[]
 store.decode=async()=>({m_Width:8,m_Height:8,m_TextureFormat:10,m_MipCount:3,m_StreamData:{path:'atlas.resS',offset:100,size:48}})
 store.stream=async(o,s)=>{reads.push(s);return Buffer.from([224,7,0,0,0,0,0,0])}
 const png=await store.decodeMedia({classId:28},{maxTextureSize:4});assert.equal(png.readUInt32BE(16),4);assert.equal(png.readUInt32BE(20),4);assert.equal(reads[0].offset,132);assert.equal(reads[0].size,8)
})

test('Fox direct action previews bootstrap native body/face state without repeating the opening dialogue',()=>{
 const room={source:'level4:manager',models:{'':'main'},initial:{skin:'default'},graphics:{'':graphic},objectStates:{1:true},gameObjects:{},functions:{init:{interactiveFlows:[{$type:'CallAVG',label:'opening',wait:false},{$type:'ChangeSpine',target:'',animationName:'body',trackIndex:0,loop:true},{$type:'ChangeSpine',target:'',animationName:'face',trackIndex:2,loop:true}]},action:{interactiveFlows:[{$type:'CallAVG',label:'action'}]}}},ctx={options:{maxCommands:1000},models:{main:model},dialogue:{opening:[{Text:'opening'}],action:[{Text:'direct action'}]},voices:{}},scene=parseFoxRoom({room},ctx,{scene:'flow-1'}),first=stateAt(scene,0)
 assert.deepEqual(first.spines['fox:'].tracks.map(t=>t.anim),['body','face']);assert.equal(first.text[0].text,'direct action');assert.equal(scene.stats.messages,1)
})
test('single-mip DXT Live2D atlas decodes directly to bounded output without resizing sprite resources',async()=>{
 const{unityTexturePng}=await import('../../web/library/gal/unity-media.mjs'),t={m_Width:8,m_Height:8,m_TextureFormat:10},raw=Buffer.concat(Array.from({length:4},()=>Buffer.from([224,7,0,0,0,0,0,0]))),small=await unityTexturePng(t,raw,{maxTextureSize:4}),original=await unityTexturePng(t,raw);assert.equal(small.readUInt32BE(16),4);assert.equal(original.readUInt32BE(16),8)
})
