import {spawn,execFile}from'node:child_process'
import {readFile}from'node:fs/promises'
import {promisify}from'node:util'
import {decodeBc7}from'./bc7.mjs'
import {encodePng}from'./tomoe.mjs'
import {unpackFsb5}from'../../../scripts/tag-scripts/gal-download/fsb5.mjs'
const rgb565=n=>[Math.round((n>>11)*255/31),Math.round(((n>>5)&63)*255/63),Math.round((n&31)*255/31)]
let crunchModule
async function unpackUnityCrunch(raw){
 crunchModule ||= Promise.all([import('./vendor/texture2ddecoder/texture2ddecoder.js'),readFile(new URL('./vendor/texture2ddecoder/texture2ddecoder.wasm',import.meta.url))]).then(([loader,wasmBinary])=>loader.default({wasmBinary}))
 const module=await crunchModule,result=module.unpack_unity_crunch(new Uint8Array(raw))
 if(!result?.length||result.length>128*1024*1024)throw Error('Unity Crunch payload invalid')
 return Buffer.from(result)
}
// Original mip levels are contiguous, largest first. Choosing a native mip
// avoids allocating/decoding an 8192 RGBA base image just to show a 720p scene.
export function unityTextureMip(t,maxSize){
 if(!Number.isInteger(maxSize)||maxSize<=0)return null
 const stride=({10:8,12:16,25:16})[t.m_TextureFormat],bpp=({1:1,3:3,4:4,5:4,14:4})[t.m_TextureFormat];if(!stride&&!bpp)return null
 let w=t.m_Width,h=t.m_Height,offset=0,level=0;const count=Math.max(1,Math.min(32,Number(t.m_MipCount)||1)),bytes=()=>stride?Math.ceil(w/4)*Math.ceil(h/4)*stride:w*h*bpp
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>64*1024*1024)throw Error('Unity mip dimensions invalid')
 while(Math.max(w,h)>maxSize&&level+1<count){offset+=bytes();w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));level++}
 return{texture:{...t,m_Width:w,m_Height:h},offset,size:bytes(),level}
}
export async function unityTexturePng(t,raw,options={}){
 const w=t.m_Width,h=t.m_Height,format=t.m_TextureFormat;if(!Number.isInteger(w)||!Number.isInteger(h)||w<=0||h<=0||w*h>64*1024*1024)throw Error('Unity texture dimensions invalid')
 if(format===28||format===29)return unityTexturePng({...t,m_TextureFormat:format===28?10:12},await unpackUnityCrunch(raw),options)
 const filtered=options.textureFilter==='lanczos3'&&Number.isInteger(options.maxTextureSize)&&options.maxTextureSize>0&&Math.max(w,h)>options.maxTextureSize
 const sample=!filtered&&[1,3,4,5,10,12,14].includes(format)&&Number.isInteger(options.maxTextureSize)&&options.maxTextureSize>0?2**Math.max(0,Math.ceil(Math.log2(Math.max(w,h)/options.maxTextureSize))):1,outW=Math.ceil(w/sample),outH=Math.ceil(h/sample)
 let pixels
 if(format===25)pixels=decodeBc7(raw,w,h)
 else if(format===10||format===12){
  const stride=format===10?8:16,bw=Math.ceil(w/4),bh=Math.ceil(h/4);if(raw.length<bw*bh*stride)throw Error('Unity DXT blocks truncated');pixels=Buffer.alloc(outW*outH*4)
  for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){
   const p=(by*bw+bx)*stride,c=p+(format===12?8:0),c0=raw.readUInt16LE(c),c1=raw.readUInt16LE(c+2),colors=[rgb565(c0),rgb565(c1)],bits=raw.readUInt32LE(c+4),alpha=[]
   if(c0>c1||format===12){colors.push(colors[0].map((v,k)=>Math.floor((2*v+colors[1][k])/3)),colors[0].map((v,k)=>Math.floor((v+2*colors[1][k])/3)))}else colors.push(colors[0].map((v,k)=>Math.floor((v+colors[1][k])/2)),[0,0,0])
   if(format===12){alpha.push(raw[p],raw[p+1]);if(alpha[0]>alpha[1])for(let k=1;k<=6;k++)alpha.push(Math.floor(((7-k)*alpha[0]+k*alpha[1])/7));else{for(let k=1;k<=4;k++)alpha.push(Math.floor(((5-k)*alpha[0]+k*alpha[1])/5));alpha.push(0,255)}}
   for(let i=0;i<16;i++){const x=bx*4+i%4,y=by*4+(i>>2);if(x>=w||y>=h||x%sample||y%sample)continue;const v=(bits>>>(i*2))&3,d=((y/sample)*outW+x/sample)*4;pixels[d]=colors[v][0];pixels[d+1]=colors[v][1];pixels[d+2]=colors[v][2];if(format===12){const bit=i*3,at=p+2+(bit>>3),value=(raw[at]|((raw[at+1]||0)<<8))>>>(bit&7);pixels[d+3]=alpha[value&7]}else pixels[d+3]=c0<=c1&&v===3?0:255}
  }
 }else{
  const bpp=({1:1,3:3,4:4,5:4,14:4})[format];if(!bpp)throw Error('Unity texture format unsupported: '+format);if(raw.length<w*h*bpp)throw Error('Unity texture pixels truncated');pixels=Buffer.alloc(outW*outH*4)
  for(let i=0;i<outW*outH;i++){const p=(Math.floor(i/outW)*sample*w+(i%outW)*sample)*bpp,d=i*4;if(format===1){pixels[d]=pixels[d+1]=pixels[d+2]=255;pixels[d+3]=raw[p]}else if(format===5){pixels[d]=raw[p+1];pixels[d+1]=raw[p+2];pixels[d+2]=raw[p+3];pixels[d+3]=raw[p]}else{pixels[d]=raw[p+(format===14?2:0)];pixels[d+1]=raw[p+1];pixels[d+2]=raw[p+(format===14?0:2)];pixels[d+3]=bpp===4?raw[p+3]:255}}
 }
 const row=outW*4,flipped=Buffer.alloc(pixels.length);for(let y=0;y<outH;y++)pixels.copy(flipped,y*row,(outH-1-y)*row,(outH-y)*row)
 if(filtered){
  const{default:sharp}=await import('sharp'),input={raw:{width:outW,height:outH,channels:4}},resize={width:options.maxTextureSize,height:options.maxTextureSize,fit:'inside',withoutEnlargement:true,kernel:'lanczos3'}
  if(options.texturePma){
   // Native Spine PNGs already contain associated RGB. Sharp's ordinary RGBA
   // resize unpremultiplies its result; filter RGB and coverage independently.
   const rgb=await sharp(flipped,input).removeAlpha().resize(resize).raw().toBuffer({resolveWithObject:true}),alpha=await sharp(flipped,input).extractChannel(3).resize(resize).raw().toBuffer(),rgba=Buffer.alloc(alpha.length*4)
   for(let i=0;i<alpha.length;i++){rgba[i*4+3]=alpha[i];for(let c=0;c<3;c++)rgba[i*4+c]=Math.min(alpha[i],rgb.data[i*3+c])}
   return encodePng(rgb.info.width,rgb.info.height,rgba,4)
  }
  return sharp(flipped,input).resize(resize).png().toBuffer()
 }
 return encodePng(outW,outH,flipped,4)
}
// Unity trims transparent sprite borders in the atlas. Restore the original
// canvas before placement, otherwise faces and costume layers drift apart.
export async function unitySpritePng(sprite,texture,png){
 const r=sprite.m_RD?.textureRect,offset=sprite.m_RD?.textureRectOffset,rect=sprite.m_Rect
 if(!r||!offset||!rect)throw Error('Unity sprite rectangle metadata missing')
 const width=Math.round(rect.width),height=Math.round(rect.height),left=Math.round(r.x),top=Math.round(texture.m_Height-r.y-r.height),cw=Math.round(r.width),ch=Math.round(r.height)
 if(![width,height,cw,ch].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16384)||width*height>64*1024*1024||left<0||top<0||left+cw>texture.m_Width||top+ch>texture.m_Height)throw Error('Unity sprite rectangle outside texture')
 const{default:sharp}=await import('sharp');let image=sharp(png).extract({left,top,width:cw,height:ch}),w=cw,h=ch
 const rotation=(Number(sprite.m_RD.settingsRaw)>>>2)&15
 if(rotation===1)image=image.flop();else if(rotation===2)image=image.flip();else if(rotation===3)image=image.rotate(180);else if(rotation===4){image=image.rotate(270);w=ch;h=cw}else if(rotation!==0)throw Error('Unity sprite packing rotation unsupported: '+rotation)
 const x=Math.round(offset.x),y=Math.round(height-offset.y-h),fractional=[rect.width,rect.height,r.x,r.y].some(n=>!Number.isInteger(n)),over=Math.max(-x,-y,x+w-width,y+h-height)
 // Tight sprite meshes can have fractional logical edges and a one-pixel
 // raster padding (captured 906.777 logical pixels vs 908 stored pixels).
 // Clip that border only; genuinely out-of-bounds trim metadata still fails.
 if(over>0&&(!fractional||over>1))throw Error('Unity sprite trim offset outside original canvas')
 let pixels=await image.png().toBuffer(),dx=Math.max(0,x),dy=Math.max(0,y)
 if(over>0)pixels=await sharp(pixels).extract({left:Math.max(0,-x),top:Math.max(0,-y),width:Math.min(w,width-dx),height:Math.min(h,height-dy)}).png().toBuffer()
 return sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:pixels,left:dx,top:dy}]).png().toBuffer()
}
let encoderPromise
async function oggEncoder(){
 encoderPromise ||=promisify(execFile)('ffmpeg',['-hide_banner','-encoders'],{timeout:10000,maxBuffer:1024*1024}).then(({stdout})=>{if(/\blibvorbis\b/.test(stdout))return'libvorbis';if(/\blibopus\b/.test(stdout))return'libopus';throw Error('Existing ffmpeg has no supported Ogg encoder; no encoder is downloaded')})
 return encoderPromise
}
export async function unityAudio(bytes){
 if(bytes.toString('ascii',0,4)==='FSB5')bytes=unpackFsb5(bytes).bytes
 if(bytes.toString('ascii',0,4)==='OggS')return Promise.resolve(bytes)
 const encoder=await oggEncoder()
 return new Promise((resolve,reject)=>{const parts=[],errors=[];let size=0;const p=spawn('ffmpeg',['-v','error','-protocol_whitelist','pipe','-i','pipe:0','-vn','-c:a',encoder,'-f','ogg','pipe:1'],{timeout:120000});p.on('error',reject);p.stdout.on('data',b=>{size+=b.length;if(size>128*1024*1024)p.kill();else parts.push(b)});p.stderr.on('data',b=>{if(errors.reduce((s,b)=>s+b.length,0)<8192)errors.push(b)});p.on('close',code=>code===0?resolve(Buffer.concat(parts)):reject(Error('Existing ffmpeg audio conversion failed: '+Buffer.concat(errors))));p.stdin.on('error',()=>{});p.stdin.end(bytes)})
}
