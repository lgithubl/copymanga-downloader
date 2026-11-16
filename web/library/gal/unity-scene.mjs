import{UnityReader}from'./unity-io.mjs'
// Common Transform prefix shared by Transform and RectTransform. RectTransform
// appends anchors/layout fields; callers use only the verified hierarchy here.
export function unityTransformPrefix(bytes){const r=new UnityReader(bytes),m_GameObject=r.ptr(),rotation={x:r.f(),y:r.f(),z:r.f(),w:r.f()},position={x:r.f(),y:r.f(),z:r.f()},scale={x:r.f(),y:r.f(),z:r.f()},m_Children=r.list(()=>r.ptr()),parent=r.ptr();return{m_GameObject,rotation,position,scale,m_Children,parent}}
// Unity UI Graphic -> MaskableGraphic -> Image prefix in2021/2022 player data.
export function unityUiImagePrefix(bytes){const r=new UnityReader(bytes);r.ptr();r.bool();r.ptr();r.str();r.ptr();const color={r:r.f(),g:r.f(),b:r.f(),a:r.f()};r.bool();for(let i=0;i<4;i++)r.f();r.bool();const calls=r.i();if(calls!==0)throw Error('Unity UI image has nonempty cull callbacks');return{sprite:r.ptr(),color}}
