// Silky/Azurite ARC payloads and MES bytecode. Data only: no native engine execution.
// Format references: GARbro ArcAzurite/ImageAKB; AI6WINScriptTool opcode table.
// Fuyukuru uses the two-count MES header, BE operands and an extended option opcode.
import {encodePng} from './bgi.mjs'
const MAX=64*1024*1024
const sjis=new TextDecoder('shift_jis',{fatal:true})
export function silkyLzss(src,size){
 if(!Number.isInteger(size)||size<0||size>MAX)throw Error('Silky LZSS output limit')
 const out=Buffer.alloc(size),ring=Buffer.alloc(4096);let p=0,o=0,r=4078,flags=0
 const push=c=>{if(o>=size)throw Error('Silky LZSS output overflow');out[o++]=c;ring[r]=c;r=(r+1)&4095}
 while(o<size){flags>>=1;if(!(flags&256)){if(p>=src.length)throw Error('Silky LZSS flags truncated');flags=src[p++]|0xff00}if(flags&1){if(p>=src.length)throw Error('Silky LZSS literal truncated');push(src[p++])}else{if(p+2>src.length)throw Error('Silky LZSS match truncated');const a=src[p++],b=src[p++],at=a|((b&240)<<4);for(let k=0;k<(b&15)+3;k++)push(ring[(at+k)&4095])}}
 if(p!==src.length)throw Error('Silky LZSS trailing bytes');return out
}
export function silkyPayload(src,entry){return entry.origSize!==entry.size?silkyLzss(src,entry.origSize):src}
export function akbInfo(b){
 if(b.length<32||!['AKB ','AKB+'].includes(b.toString('ascii',0,4)))throw Error('Silky AKB header invalid')
 const width=b.readUInt16LE(4),height=b.readUInt16LE(6),flags=b.readUInt32LE(8),x=b.readInt32LE(16),y=b.readInt32LE(20),right=b.readInt32LE(24),bottom=b.readInt32LE(28),channels=flags&0x40000000?3:4,offset=b[3]===43?64:32
 if(!width||!height||width*height*4>MAX||x<0||y<0||right<x||bottom<y||right>width||bottom>height||b.length<offset)throw Error('Silky AKB dimensions invalid')
 let base='';if(offset===64){const n=b.indexOf(0,32);if(n<32||n>=64)throw Error('Silky AKB base name invalid');base=sjis.decode(b.subarray(32,n));if(/[\\/]/.test(base)||base==='.'||base==='..')throw Error('Silky AKB base path invalid')}
 return{width,height,flags,x,y,innerWidth:right-x,innerHeight:bottom-y,channels,offset,base}
}
export function decodeAkb(b,baseline=null){
 const m=akbInfo(b),{width,height,channels,x,y,innerWidth:w,innerHeight:h}=m
 if(baseline&&(baseline.width!==width||baseline.height!==height||baseline.channels!==channels))throw Error('Silky AKB base dimensions mismatch')
 const pixels=baseline?Buffer.from(baseline.pixels):Buffer.alloc(width*height*channels)
 if(!baseline)for(let i=0;i<pixels.length;i+=channels)b.copy(pixels,i,12,12+channels)
 if(w&&h){const raw=silkyLzss(b.subarray(m.offset),w*h*channels),stride=w*channels,part=Buffer.alloc(raw.length)
  for(let row=0;row<h;row++)raw.copy(part,(h-row-1)*stride,row*stride,(row+1)*stride)
  for(let i=channels;i<stride;i++)part[i]=(part[i]+part[i-channels])&255
  for(let i=stride;i<part.length;i++)part[i]=(part[i]+part[i-stride])&255
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){const at=(row*w+col)*channels;if(baseline&&part[at]===0&&part[at+1]===255&&part[at+2]===0)continue;part.copy(pixels,((row+y)*width+col+x)*channels,at,at+channels)}
 }
 const rgba=Buffer.alloc(width*height*4);for(let i=0,j=0;i<pixels.length;i+=channels,j+=4){rgba[j]=pixels[i+2];rgba[j+1]=pixels[i+1];rgba[j+2]=pixels[i];rgba[j+3]=channels===4&&(m.flags&0x80000000)?pixels[i+3]:255}
 return{...m,pixels,rgba}
}
export function akbPng(image){return encodePng(image.width,image.height,4,image.rgba)}
function text(bytes,encrypted){if(!encrypted)return sjis.decode(bytes);const out=[];for(let i=0;i<bytes.length;i++){const c=bytes[i];if(c<0x81){const v=(c-0x7d62)&65535;out.push(v>>8,v&255)}else{if(i+1>=bytes.length)throw Error('Silky text truncated');out.push(c,bytes[++i])}}return sjis.decode(Uint8Array.from(out))}
const plain=new Set([0,1,2,3,4,5,6,7,8,9,12,13,14,15,16,17,18,19,23,24,...Array.from({length:18},(_,i)=>i+50),250,251,252,253,254,255])
export function decodeMes(b,name=''){
 if(b.length<8||b.length>MAX)throw Error('Silky MES size invalid')
 const count=b.readUInt32LE(),extra=b.readUInt32LE(4),base=8+4*(count+extra)
 if(count>200000||extra>200000||base>b.length)throw Error('Silky MES offset table invalid')
 const ops=[];let p=base
 while(p<b.length){const at=p-base,op=b[p++];let arg=null
  if([10,11,51].includes(op)){const end=b.indexOf(0,p);if(end<0||end-p>1024*1024)throw Error(`Silky ${name} @${at} string invalid`);arg=text(b.subarray(p,end),op===10);p=end+1}
  else if([20,21,22,25,26,27,50].includes(op)){if(p+4>b.length)throw Error(`Silky ${name} @${at} operand truncated`);arg=op===50?b.readInt32BE(p):b.readUInt32BE(p);p+=4}
  else if(op===28){if(p>=b.length)throw Error('Silky newline truncated');arg=b[p++]}
  else if(!plain.has(op))throw Error(`Silky ${name} @${at} unsupported opcode 0x${op.toString(16)}`)
  ops.push({at,op,...(arg!==null?{arg}:{})});if(ops.length>1000000)throw Error('Silky MES instruction limit')
 }
 const offsets=new Set(ops.map(x=>x.at));offsets.add(b.length-base)
 for(const x of ops)if([20,21,22,27].includes(x.op)&&!offsets.has(x.arg))throw Error(`Silky ${name} @${x.at} target ${x.arg} is not an instruction`)
 return{format:'silky-mes/1',name,ops}
}
