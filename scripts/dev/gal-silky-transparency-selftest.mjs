import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile}from'node:fs/promises'
import{existsSync}from'node:fs'
import{decodeAkb}from'../../web/library/gal/silky.mjs'
import{parse}from'../../web/library/gal/adapters/silky-mes.mjs'
import{activePath,stateAt}from'../../web/static/gal-engine.js'
const captured='.cache/fuyu-green-capture/extracted/g01/__pair_media/layer.arc/'
function solid(flags,bgra){const b=Buffer.alloc(32);b.write('AKB ');b.writeUInt16LE(1,4);b.writeUInt16LE(1,6);b.writeUInt32LE(flags>>>0,8);Buffer.from(bgra).copy(b,12);return b}
test('24-bit transparent AKB keys exact green, retains opaque green and native 32-bit alpha',()=>{
 assert.deepEqual([...decodeAkb(solid(0xc00000ff,[0,255,0,255])).rgba],[0,255,0,0])
 assert.deepEqual([...decodeAkb(solid(0x400000ff,[0,255,0,255])).rgba],[0,255,0,255])
 assert.deepEqual([...decodeAkb(solid(0xc00000ff,[1,255,0,255])).rgba],[0,255,1,255])
 assert.deepEqual([...decodeAkb(solid(0x800000ff,[0,255,0,128])).rgba],[0,255,0,128])
})
test('real FK_SCENE_07 29–32: keyed difference reveals base and preserves changed rectangle',{skip:!existsSync(captured+'EV003_H03.AKB')},async()=>{
 const base=decodeAkb(await readFile(captured+'EV003.AKB'))
 const root='.cache/fuyu-edo-fixtures/fuyukuru/arc/script/script/',library=JSON.parse(await readFile(root+'LIBLARY.smes')),scene=parse(await readFile(root+'FK_SCENE_07.smes','utf8'),{library}),path=activePath(scene)
 for(const n of [29,30,31,32]){const st=stateAt(scene,path[n-1]);assert.equal(st.bg.src,'ev003.png');assert.equal(st.overlays.find(x=>x.slot==='silky:cg-diff').src,'ev003_h03.png')}
 for(const name of ['EV003_H02','EV003_H03','EV003_H04']){const image=decodeAkb(await readFile(captured+name+'.AKB'));let keyed=0,changed=0;for(let i=0;i<image.rgba.length;i+=4){const green=image.rgba[i]===0&&image.rgba[i+1]===255&&image.rgba[i+2]===0;if(green){assert.equal(image.rgba[i+3],0);keyed++}else{assert.equal(image.rgba[i+3],255);if(!image.rgba.subarray(i,i+3).equals(base.rgba.subarray(i,i+3)))changed++}}assert.equal(keyed,833600);assert.ok(changed>1000)}
})
