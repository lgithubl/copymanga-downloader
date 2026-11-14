// Verified native scalar initialization for the collected Tenyui SYS4 version.
// This is not full engine startup: no EXE, DLL, input handlers or game JS runs.
import {createHash} from 'node:crypto'
import {decodeAgeScript,traceAgeProgram,ageLiteralInitializer} from './age.mjs'
import {readAgeEntry,ageIndexGroup} from './age-archive.mjs'
const HASHES={
 'SYSTEM4.BIN':'3cbd3c3c9582333df361eb9ba85f58bf555468ac4d29dfc2b548b5b1d9973553',
 'INIT2.BIN':'55616d4b5ee2a963c96ee1472fe3f3c524af9155d7444d07cca7bae68451f406',
}
export function nativeAgeStartup(catalog,namespace){
 const rows=catalog.indexes.find(t=>t.namespace===namespace)?.entries||[],programs={}
 for(const[name,expected]of Object.entries(HASHES)){
  const row=rows.find(r=>r.name.toUpperCase()===name)
  if(!row?.file)return {available:false,reason:`缺少初始化脚本 ${name}`}
  if(row.size>16*1024*1024)return {available:false,reason:`初始化脚本超过16MiB：${name}`}
  const bytes=readAgeEntry(row)
  if(createHash('sha256').update(bytes).digest('hex')!==expected)return {available:false,reason:`初始化版本未验证：${name}`}
  programs[name]=decodeAgeScript(bytes)
 }
 const ids=traceAgeProgram(programs['SYSTEM4.BIN'],{entry:2040,programName:'SYSTEM4.BIN'})
 if(ids.status!=='returned')throw Error('AGE verified ID-table helper did not return')
 // Verify the known prefix boundary, then follow only instructions implemented by
 // the data VM. Missing data, graphics, native calls and unknown ops stop it; they
 // are never skipped during initialization. Full installs can therefore load the
 // original sprite/animation tables that a small capture does not contain.
 const boundary=traceAgeProgram(programs['INIT2.BIN'],{programName:'INIT2.BIN'})
 if(boundary.status!=='missing-script'||boundary.missingScript!==22929||boundary.trace.at(-1)?.offset!==340)throw Error('AGE verified scalar initialization boundary changed')
 const linked=[],byOrdinal=new Map(rows.map(r=>[r.ordinal,r]));let bytes=0,missingReason=''
 const init=traceAgeProgram(programs['INIT2.BIN'],{programName:'INIT2.BIN',integers:ids.integers,maxSteps:1000000,resolveScript:ordinal=>{
  const row=byOrdinal.get(ordinal)
  if(!row?.file||row.size>16*1024*1024||bytes+row.size>32*1024*1024){missingReason='初始化数据缺失或超过读取上限：'+(row?.name||ordinal);return null}
  const raw=readAgeEntry(row);bytes+=raw.length
  try{const program=decodeAgeScript(raw);linked.push({script:row.name,sha256:createHash('sha256').update(raw).digest('hex')});return{name:row.name,program}}
  catch{missingReason='初始化数据不可读取：'+row.name;return null}
 }})
 // The fingerprinted INIT2 has a separate straight-line dispatch table after
 // the bulk initializer calls. It only assigns literal global ordinals; the
 // following native operation is deliberately not executed. Recovering this
 // table must not depend on successfully executing unrelated flag/UI setup.
 const block=programs['INIT2.BIN'].instructions.filter(i=>i.offset>=460&&i.offset<640)
 if(block.length!==36||block.some(i=>i.opcode!==0x55||i.args[0]?.type!==3||i.args[1]?.type!==0)||programs['INIT2.BIN'].instructions.find(i=>i.offset===640)?.opcode!==0x143)throw Error('AGE verified dispatch table boundary changed')
 const supplemental=[]
 const missingDispatch=[]
 for(const i of block){
  const row=byOrdinal.get(i.args[1].value)
  // An absent link must not replace a usable direct path with a call into a
  // missing archive (sparse collected fixtures deliberately have such holes).
  let present=false
  try{present=Boolean(row?.file&&readAgeEntry(row,8).toString('ascii',0,4)==='SYS4')}catch{}
  if(present)init.integers[i.args[0].value]=i.args[1].value|0
  else missingDispatch.push(row?.name||String(i.args[1].value))
 }
 supplemental.push({script:'INIT2.BIN',entry:460,end:640,literalOnly:true})
 // Only complete literal tables from the original startup call list qualify.
 // No branches, reads, dynamic pointers, bit operations or graphics are skipped
 // here. A nonliteral table remains unapplied and full startup remains stopped.
 for(const call of programs['INIT2.BIN'].instructions.filter(i=>i.offset>=340&&i.offset<460&&i.opcode===3)){
  const row=byOrdinal.get(call.args[0]?.value)
  if(!row?.file||row.size>2*1024*1024)continue
  try{
   const raw=readAgeEntry(row),table=ageLiteralInitializer(decodeAgeScript(raw))
   // Globals already reached by strict startup take precedence.
   for(const [key,value]of Object.entries(table.integers))if(!(key in init.integers))init.integers[key]=value
   for(const [key,value]of Object.entries(table.strings))if(!(key in init.strings))init.strings[key]=value
   supplemental.push({script:row.name,literalOnly:true,sha256:createHash('sha256').update(raw).digest('hex')})
  }catch{ /* Not a complete independent literal table: retain strict diagnostic. */ }
 }
 // Each additional index occupies its native high-byte resource group. The
 // dispatch arrays reserve 32 slots per helper; main keeps slot zero. Additional
 // literal tables extend the same globals, rather than replacing main globals
 // with unrelated local ordinals or reading append resources through main.
 for(const [position,index]of catalog.indexes.entries()){
  const group=ageIndexGroup(index,position)
  if(!group)continue
  const extra=new Map(index.entries.map(row=>[row.name,row]))
  if(group>=32){missingDispatch.push(index.name+': dispatch group exceeds32 slots');continue}
  for(const i of block){
   if(i.args[0].value<6597705||i.args[0].value>6598377)continue
   const base=byOrdinal.get(i.args[1].value),row=extra.get('$'+group+'$'+base?.name)
   try{if(row?.file&&readAgeEntry(row,8).toString('ascii',0,4)==='SYS4')init.integers[i.args[0].value+group]=group*0x1000000+row.ordinal}catch{}
  }
  for(const call of programs['INIT2.BIN'].instructions.filter(i=>i.offset>=340&&i.offset<460&&i.opcode===3)){
   const base=byOrdinal.get(call.args[0]?.value),row=extra.get('$'+group+'$'+base?.name)
   if(!row?.file||row.size>2*1024*1024)continue
   try{
    const raw=readAgeEntry(row),table=ageLiteralInitializer(decodeAgeScript(raw))
    Object.assign(init.integers,table.integers);Object.assign(init.strings,table.strings)
    supplemental.push({script:row.name,group,literalOnly:true,sha256:createHash('sha256').update(raw).digest('hex')})
   }catch{ /* Dynamic append startup remains unsupported; do not guess it. */ }
  }
 }
 return{available:true,integers:init.integers,floats:init.floats,strings:init.strings,
  sources:[{script:'SYSTEM4.BIN',entry:2040},{script:'INIT2.BIN',dataOnly:true},...linked,...supplemental],
  dataPrefix:{status:init.status,stopped:init.stopped,missingScript:init.missingScript,reason:missingReason||undefined,steps:init.trace.length,missingDispatch},
  note:'从原始脚本读取标量/数组初始化；遇到缺失数据或非数据指令即停止，未执行完整原游戏启动/地图系统。'}
}
