// Copyright (c) 2022 morkt (SX algorithm port).
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
// SakanaGL SX archive and static FAFA metadata reader, without script execution.
// SX algorithm reference: morkt's GARbro ArcSX.cs (MIT, 2022).
import{open,readFile,readdir,stat}from'node:fs/promises'
import path from'node:path'
import{zstdDecompressSync}from'node:zlib'
const MAX=64*1024*1024
export function sxDecrypt(input,low,high){const b=Buffer.from(input);let lo=(low^0x159a55e5)>>>0,hi=(high^0x075bcd15)>>>0,a=(hi^(hi<<11)^((hi^(hi<<11))>>>8)^0x549139a)>>>0,c=(a^lo^(lo<<11)^((lo^(lo<<11)^(a>>>11))>>>8))>>>0,d=(c^(c>>>19)^0x8e415c26)>>>0,e=(d^(d>>>19)^0x4d9d5bb8)>>>0;for(let p=0;p+4<=b.length;p+=4){const x=(e^a^(a<<11)^((a^(a<<11)^(e>>>11))>>>8))>>>0,y=(c^(c<<11))>>>0;c=e;e=(x^y^((y^(x>>>11))>>>8))>>>0;b.writeUInt32LE((b.readUInt32LE(p)^(x>>>4)^(e<<12))>>>0,p);a=d;d=x}return b}
function zstd(b){if(b.length<4||b.readUInt32BE()>MAX)throw Error('SX 解压长度超过64MB');const d=zstdDecompressSync(b.subarray(4),{maxOutputLength:MAX});if(d.length!==b.readUInt32BE())throw Error('SX 解压长度不符');return d}
export function decodeSxEntry(b,e){if(b.length!==e.size||b.length>MAX)throw Error('SX 条目长度无效');let d=e.flags&16?b:sxDecrypt(b,((e.offset/16)^(e.size<<16)^0x2e76034b)>>>0,((e.size>>>16)^0x2e6)>>>0);return e.flags&3?zstd(d):d}
export async function readSakanaIndex(file){const raw=await readFile(file);if(raw.length<16||raw.length>16*1024*1024||raw.toString('ascii',0,8)!=='SSXXDEFL')throw Error('不是 SX 索引');const key=BigInt(raw.readInt32BE(8)),n=raw.length-16,derived=BigInt.asUintN(64,key^(961n*(key+BigInt(n))-124789n)^0x2e76034bn),b=zstd(sxDecrypt(raw.subarray(16),Number(derived&0xffffffffn),Number(derived>>32n)^0x2e6));let p=8
 const take=n=>{if(n<0||p+n>b.length)throw Error('SX 索引截断');const d=b.subarray(p,p+n);p+=n;return d},u8=()=>take(1)[0],u16=()=>take(2).readUInt16BE(),u32=()=>take(4).readUInt32BE(),i32=()=>take(4).readInt32BE(),count=n=>{if(n>200000)throw Error('SX 索引条目过多');return n}
 const names=Array.from({length:count(u32())},()=>new TextDecoder('utf-8',{fatal:true}).decode(take(u8()))),entries=Array.from({length:count(u32())},()=>({arc:u16(),flags:u16(),offset:u32()*16,size:u32()})),arcs=[]
 for(let i=0,n=u16();i<n;i++){const fields=[u32(),u32(),u32(),u32()];take(24);arcs.push({size:fields[3]*16})}take(u16()*24)
 const tree=(prefix='',depth=0)=>{if(depth>64)throw Error('SX 目录过深');const n=u16(),ni=i32(),fi=i32();if(ni<0||ni>=names.length)throw Error('SX 名字索引无效');const name=[prefix,names[ni]].filter(Boolean).join('/');if(fi===-1){for(let i=0;i<n;i++)tree(name,depth+1)}else{if(!entries[fi]||entries[fi].name)throw Error('SX 文件索引无效');if(name.includes('\\')||name.split('/').some(v=>!v||v==='.'||v==='..'))throw Error('SX 路径无效');entries[fi].name=name}}
 tree();if(p!==b.length||entries.some(e=>!e.name||!arcs[e.arc]||e.offset+e.size>arcs[e.arc].size||e.size>MAX))throw Error('SX 索引未完整解释/条目范围无效')
 const dir=path.dirname(file),base=path.basename(file).replace(/\([^)]*\)\.sx$/i,'').replace(/\.sx$/i,''),available=[]
 for(const name of await readdir(dir))if(name.startsWith(base)&&name.endsWith('.sxstorage')){const f=path.join(dir,name),s=await stat(f);if(s.isFile())available.push({file:f,size:s.size})}
 for(const a of arcs){const hits=available.filter(f=>f.size===a.size);if(hits.length!==1)throw Error('SX 存储分卷缺失或大小不唯一');a.file=hits[0].file}
 return{entries,arcs}
}
export async function readSakanaEntry(index,e){const f=await open(index.arcs[e.arc].file,'r');try{const b=Buffer.alloc(e.size);let p=0;while(p<b.length){const r=await f.read(b,p,b.length-p,e.offset+p);if(!r.bytesRead)throw Error('SX 数据截断');p+=r.bytesRead}return decodeSxEntry(b,e)}finally{await f.close()}}
export function fafaTokens(b){if(b.length<8||b.length>MAX||b[0]!==250||b[1]!==250)throw Error('不是 FAFA 静态配置');const size=b.readUInt32BE(2),count=b.readUInt16BE(6),end=8+size;if(end>b.length)throw Error('FAFA 代码范围无效');let p=end;const words=[];for(let i=0;i<count;i++){const e=b.indexOf(0,p);if(e<0||e-p>65536)throw Error('FAFA 字符串表截断');words.push(new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(p,e)));p=e+1}if(p!==b.length)throw Error('FAFA 字符串表尾部不符');const tokens=[];for(p=8;p<end;){const n=b[p++];if(n===128||n===129){if(p+2>end)throw Error('FAFA 词元截断');const i=b.readUInt16BE(p);p+=2;if(i>=words.length)throw Error('FAFA 字符串编号无效');tokens.push({type:n===128?'id':'string',value:words[i]})}else if(n===130){if(p+4>end)throw Error('FAFA 整数截断');tokens.push({type:'number',value:b.readInt32BE(p)});p+=4}else if(n===131){if(p+4>end)throw Error('FAFA 浮点截断');tokens.push({type:'number',value:b.readFloatBE(p)});p+=4}else tokens.push({type:'symbol',value:n<128?String.fromCharCode(n):n})}return tokens}
// Literal tables only. Unknown expressions remain outside these maps.
export function sakanaMetadata(name,b){const tokens=fafaTokens(b),v=tokens.map(t=>t.value),kind=path.basename(name).replace(/\.conf$/,''),out={kind,entries:[]};
 if(kind==='character'){for(let i=0;i<tokens.length-2;i++)if(tokens[i].type==='string'&&v[i+1]==='='&&tokens[i+2].type==='string')out.entries.push({id:v[i],name:v[i+2]});return out}
 for(let i=0;i<v.length;i++){if(v[i]!==kind||v[i+1]!=='[')continue;let k=i+2,id;if(tokens[k].type==='string'||tokens[k].type==='number')id=v[k++];else{let num='';while(/^\d$/.test(v[k]))num+=v[k++];if(!num)continue;id=Number(num)}if(v[k]!==']')continue;while(k<v.length&&v[k]!=='{')k++;if(k>=v.length)break;const row={id,graphics:{}};for(k++;k<v.length&&v[k]!=='}';k++){if(tokens[k].type==='id'&&v[k+1]==='='&&['string','number'].includes(tokens[k+2]?.type))row[v[k]]=v[k+2];if(v[k]==='graphics'&&v[k+1]==='['){let j=k+2,n='';while(/^\d$/.test(v[j]))n+=v[j++];if(v[j]===']'&&v[j+1]==='='&&tokens[j+2]?.type==='string')row.graphics[n]=v[j+2]}}out.entries.push(row);i=k}
 return out}
export function sakanaUi(b){const t=fafaTokens(b),strings=[...new Set(t.filter(t=>t.type==='string'&&/^\/?img\/.*\.(?:png|webp|jpe?g)$/i.test(t.value)).map(t=>t.value.replace(/^\//,'')))];return{format:'sakana-ui/1',images:strings,tokens:t}}
export function fafaValue(b){const t=fafaTokens(b).filter(t=>t.value!==253);let p=0,nodes=0
 const parse=depth=>{if(depth>96||++nodes>300000)throw Error('FAFA 对象超限');const a=t[p++];if(!a)throw Error('FAFA 对象截断');if(['string','number'].includes(a.type))return a.value;if(a.value===183)return true;if(a.value===184)return false;if(a.value===148||a.value===185)return null;if(a.value==='-'||a.value==='+'){const n=parse(depth+1);if(typeof n!=='number')throw Error('FAFA 非数值符号');return a.value==='-'?-n:n}
 if(a.value==='['){const out=[];while(t[p]?.value!==']'){out.push(parse(depth+1));if(t[p]?.value===',')p++;else if(t[p]?.value!==']')throw Error('FAFA 数组分隔符无效')}p++;return out}
 if(a.value==='{'){const out=Object.create(null);while(t[p]?.value!=='}'){const key=t[p++];if(key?.type!=='string'||![':', '='].includes(t[p++]?.value)||Object.hasOwn(out,key.value))throw Error('FAFA 对象键无效');out[key.value]=parse(depth+1);if(t[p]?.value===','||t[p]?.value===';')p++;else if(t[p]?.value!=='}')throw Error('FAFA 对象分隔符无效')}p++;return out}
 if(typeof a.value==='string'&&/^[-\d.]$/.test(a.value)){let str=a.value;while(typeof t[p]?.value==='string'&&/^[\d.eE+-]$/.test(t[p].value))str+=t[p++].value;const n=Number(str);if(Number.isFinite(n))return n}throw Error('FAFA 不是静态数据 '+a.value)}
 const value=parse(0);if(p!==t.length)throw Error('FAFA 静态数据尾部未消费');return value}
// Select a static expression at frame0; blinking/movement loops are not executed.
export function sakanaParts(root,method='change_1'){
 const parts=[],face=/_(\d+)$/.exec(String(method))?.[1]||'1',base=root?.rootdata;if(!base)throw Error('UI 缺少rootdata');const size=new Map(base.staticparams||[]).get(2000)||[1280,720]
 const walk=(node,x,y,sx,sy,depth)=>{if(depth>64)throw Error('UI 图层过深');const s=new Map(node.staticparams||[]),m=new Map((node.motion||[]).map(m=>[m.pid,m.key?.[0]?.p])),name=s.get(1000)||'',visible=m.has(1004)?m.get(1004):true;if(visible===false||visible===0)return;const pos=m.get(1001)||[0,0],scale=m.get(1002)||[100,100];x+=Number(pos[0]||0)*sx;y+=Number(pos[1]||0)*sy;sx*=Number(scale[0]??100)/100;sy*=Number(scale[1]??100)/100
  const src=s.get(1100),bounds=s.get(2000);if(typeof src==='string'&&/^\/?img\//.test(src)&&bounds){parts.push({src:src.replace(/^\//,''),x:x+Number(bounds[0])*sx/2-size[0]/2,y:y+Number(bounds[1])*sy/2-size[1]/2,scaleX:sx,scaleY:sy,width:bounds[0],height:bounds[1]})}
  const children=node.children||[];for(const child of children){if(name==='FACE'){const n=new Map(child.staticparams||[]).get(1000);if(String(n)!==face)continue}walk(child,x,y,sx,sy,depth+1)}
 };walk(base,0,0,1,1,0);return{stage:size,parts}
}
export async function sakanaStorageSig(file){const dir=path.dirname(file),base=path.basename(file).replace(/\([^)]*\)\.sx$/i,'').replace(/\.sx$/i,''),parts=[];for(const n of(await readdir(dir)).filter(n=>n.startsWith(base)&&n.endsWith('.sxstorage')).sort()){const s=await stat(path.join(dir,n));parts.push(`${n}:${s.size}:${s.mtimeMs}`)}return parts.join('|')}
