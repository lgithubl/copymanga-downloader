import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile}from'node:fs/promises'
import{existsSync}from'node:fs'
import{parse}from'../../web/library/gal/adapters/edo-ikunyu.mjs'
import{activePath,stateAt}from'../../web/static/gal-engine.js'
const file='.cache/fuyu-edo-analysis/edo-text/src__game__scsg01h.txt'
test('real scsg01h movie keeps its static fallback behind video instead of covering it',{skip:!existsSync(file)},async()=>{
 const text=await readFile(file,'utf8'),scene=parse(JSON.stringify({format:'edo-lua/1',name:'scsg01h',text})),p=activePath(scene)
 for(const[n,image,movie]of [[15,'sg01r01','msg01a'],[27,'sg01r02','msg01b'],[44,'sg01r03','msg01c']]){const st=stateAt(scene,p[n-1]);assert.deepEqual(st.movie?.srcs,['mp4/'+movie+'.mp4']);assert.ok(st.bg?.src.endsWith(image+'.png'),'native fallback must use background layer at sentence '+n);assert.equal(st.overlays.length,0,'opaque EV canvas would cover playing movie')}
})
