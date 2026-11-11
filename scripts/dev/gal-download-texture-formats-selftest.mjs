import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as tsk from '../tag-scripts/gal-download/tsk.mjs'
// Exercise the same format dispatcher used by extractTsk, not just the vendor decoder.
for (const [format,block] of [[48,4],[49,5],[50,6],[51,8],[52,10],[53,12]]) test(`TSK texture dispatcher: Unity format ${format} is ASTC ${block}x${block}`,()=>{
  assert.equal(typeof tsk.texturePixels,'function')
  const w=block+1,h=block+2,raw=Buffer.alloc(64),colors=[[11,22,33,255],[44,55,66,192],[77,88,99,128],[111,122,133,64]]
  colors.forEach((color,i)=>{raw[i*16]=0xfc;raw[i*16+1]=1;color.forEach((v,c)=>raw.writeUInt16LE(v*257,i*16+8+c*2))})
  const texture={m_Width:w,m_Height:h,m_TextureFormat:format,'image data':raw}
  const out=tsk.texturePixels(texture,new Map())
  assert.equal(out.w,w);assert.equal(out.h,h)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const expected=colors[Math.floor((h-1-y)/block)*2+Math.floor(x/block)];assert.deepEqual([...out.pixels.subarray((y*w+x)*4,(y*w+x+1)*4)],expected)}
  assert.throws(()=>tsk.texturePixels({...texture,'image data':raw.subarray(0,63)},new Map()),/压缩纹理数据截断/)
})
