// Verified native scalar initialization for the collected Tenyui SYS4 version.
// This is not full engine startup: no EXE, DLL, input handlers or game JS runs.
import {createHash} from 'node:crypto'
import {decodeAgeScript,traceAgeProgram} from './age.mjs'
import {readAgeEntry} from './age-archive.mjs'
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
 return{available:true,integers:init.integers,floats:init.floats,strings:init.strings,
  sources:[{script:'SYSTEM4.BIN',entry:2040},{script:'INIT2.BIN',dataOnly:true},...linked],
  dataPrefix:{status:init.status,stopped:init.stopped,missingScript:init.missingScript,reason:missingReason||undefined,steps:init.trace.length},
  note:'从原始脚本读取标量/数组初始化；遇到缺失数据或非数据指令即停止，未执行完整原游戏启动/地图系统。'}
}
