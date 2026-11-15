import {UnityReader,monoHeader}from'./unity-io.mjs'
// Layout derived from the supplied Utage.dll's SerializeField declarations.
// Original files are read only; no managed assembly is loaded or executed.
function grid(r,scenario=false){const rows=r.list(()=>({rowIndex:r.i(),strings:r.list(()=>r.str(),1024),isEmpty:r.bool(),isCommentOut:r.bool()}),200000),name=r.str(),type=r.i(),textLength=r.i(),headerRow=r.i();if(scenario){r.list(()=>r.i());r.list(()=>r.list(()=>r.str(),1024))}return{rows,name,type,textLength,headerRow}}
export function unityUtageBook(data){const {r,name}=monoHeader(data),importVersion=r.i();if(importVersion!==0)throw Error('Unsupported Utage importVersion '+importVersion);const importGridList=r.list(()=>grid(r,true),10000);r.end();return{name,importVersion,importGridList,_unityUtage:true}}
export function unityUtageChapter(data){const{r,name}=monoHeader(data),chapterName=r.str(),dataList=r.list(()=>r.ptr()),settingList=r.list(()=>grid(r)),customDataList=r.list(()=>grid(r));r.end();return{name,chapterName,dataList,settingList,customDataList,_unityUtage:true}}
