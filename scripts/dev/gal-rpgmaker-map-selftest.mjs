import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import vm from 'node:vm'
import * as rpg from '../../web/library/gal/adapters/rpgmaker-json.mjs'
import {stateAt} from '../../web/static/gal-engine.js'
import {tilePieces} from '../../web/static/gal-rpgmaker-tiles.js'

const C=(code,parameters=[])=>({code,parameters,indent:0}),msg=text=>[C(101,['',0,0,2,'NPC']),C(401,[text])]
const image={characterName:'$NPC',characterIndex:0,tileId:0,direction:2,pattern:1}
const page=list=>({conditions:{},image,priorityType:1,moveSpeed:4,list})
async function prepare(list){
 const first={width:6,height:4,tilesetId:1,scrollType:0,data:Array(6*4*6).fill(0),events:[null,{id:1,name:'event',x:1,y:1,pages:[page(list),{...page([]),conditions:{selfSwitchValid:true,selfSwitchCh:'A'},image:{...image,characterName:'$After'}}]}]},second={...first,events:[]}
 const texts={'data/System.json':JSON.stringify({gameTitle:'map fixture',partyMembers:[1]}),'data/Actors.json':JSON.stringify([null,{characterName:'$Player',characterIndex:0}]),'data/CommonEvents.json':'[null]','data/Tilesets.json':JSON.stringify([null,{tilesetNames:['','','','','','B'],flags:[]}]),'data/Map001.json':JSON.stringify(first),'data/Map002.json':JSON.stringify(second)}
 const ctx=await rpg.prepare({options:{},texts,files:['data/Map001.json','data/Map002.json'],toResourcePath:p=>p})
 return rpg.parse(texts['data/Map001.json'],ctx,{rel:'data/Map001.json',scene:'event-1-1',options:{}})
}
test('map snapshots, native movement and turning, self-switch pages, transfer, and backward seek restore deterministically',async()=>{
 const scene=await prepare([...msg('before'),C(203,[0,0,3,1,2]),C(205,[0,{wait:true,list:[{code:4},{code:3},{code:19},{code:15,parameters:[15]},{code:0}]}]),...msg('after movement'),C(123,['A',0]),...msg('new page'),C(201,[0,2,2,3,4,2]),...msg('transferred')])
 const initial=stateAt(scene,0),moved=stateAt(scene,1),changed=stateAt(scene,2),transferred=stateAt(scene,3)
 assert.equal(initial.rpgMap.events[1].x,1);assert.equal(initial.rpgMap.events[1].src,'img/characters/$NPC.png')
 assert.equal(moved.rpgMap.events[1].x,4);assert.equal(moved.rpgMap.events[1].y,0);assert.equal(moved.rpgMap.events[1].direction,8)
 assert.ok(moved.rpgMap.lastDuration>.7);assert.equal(changed.rpgMap.events[1].src,'img/characters/$After.png')
 assert.equal(transferred.rpgMap.id,2);assert.equal(transferred.rpgMap.events[-1].x,2);assert.equal(transferred.rpgMap.events[-1].y,3)
 assert.equal(stateAt(scene,0).rpgMap.events[1].x,1,'later state must not mutate the initial map snapshot')
 assert.ok(!scene.stats.raw['event:205']);assert.ok(!scene.stats.raw['event:201'])
})
test('normal and autotile sheets use native rectangles; malformed IDs are not drawn',()=>{
 assert.deepEqual(tilePieces(1,48),[{set:5,sx:48,sy:0,w:48,h:48,x:0,y:0}])
 assert.equal(tilePieces(1536)[0].set,4);assert.equal(tilePieces(2816).length,4);assert.equal(tilePieces(4352)[0].set,2)
 assert.deepEqual(tilePieces(0),[]);assert.deepEqual(tilePieces(8192),[])
})
const core='.cache/diagnostics-138/extracted/g01/www/js/rpg_core.js'
test('all 8191 tile IDs match the collected native MV rectangle renderer, including tables and waterfalls',{skip:!existsSync(core)},async()=>{
 const source=await readFile(core,'utf8'),Tilemap={prototype:{},isTileA1:id=>id>=2048&&id<2816,isTileA2:id=>id>=2816&&id<4352,isTileA3:id=>id>=4352&&id<5888,isTileA4:id=>id>=5888&&id<8192,isTileA5:id=>id>=1536&&id<2048,getAutotileKind:id=>Math.floor((id-2048)/48),getAutotileShape:id=>(id-2048)%48}
 let code=''
 for(const name of ['FLOOR','WALL','WATERFALL'])code+=source.match(new RegExp('Tilemap\\.'+name+'_AUTOTILE_TABLE\\s*=\\s*\\[[\\s\\S]*?\\];'))[0]+'\n'
 for(const name of ['_drawNormalTile','_drawAutotile','_drawTableEdge'])code+=source.match(new RegExp('Tilemap\\.prototype\\.'+name+' = function\\([^]*?\\n};'))[0]+'\n'
 vm.runInNewContext(code,{Tilemap},{timeout:1000})
 const recorder=Object.assign(Object.create(Tilemap.prototype),{_tileWidth:48,_tileHeight:48,animationFrame:5,bitmaps:Array.from({length:11},(_,i)=>i+1),_isTableTile:id=>id>=2816&&id<4352})
 for(let id=1;id<8192;id++){
  const actual=[],bitmap={bltImage:(source,sx,sy,w,h,x,y)=>actual.push({set:source-1,sx,sy,w,h,x,y})}
  recorder[id<2048?'_drawNormalTile':'_drawAutotile'](bitmap,id,0,0)
  assert.deepEqual(tilePieces(id,48,5,0x80),actual,`tile ${id}`)
 }
})
