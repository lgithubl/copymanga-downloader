import{monoHeader}from'./unity-io.mjs'
// I2.Loc serialized data only. Live/Google synchronization is never invoked.
export function readI2Source(bytes,{legacy=false}={}){
 const {r,name}=monoHeader(bytes),readTerms=()=>r.list(()=>{const key=r.str(),type=r.i(),languages=r.list(()=>r.str(),64),flags=r.bytes(),touch=r.list(()=>r.str(),64);return{key,type,languages,flags:[...flags],touch}},200000),readLanguages=()=>r.list(()=>{const name=r.str(),code=r.str();r.need(1);const flags=r.b[r.p++];r.align();return{name,code,flags}},64)
 r.bool();r.bool();r.bool();let terms=readTerms();r.bool();r.i();r.str();let languages=readLanguages();r.bool();r.i();for(let i=0;i<4;i++)r.str();r.i();r.i();r.i();r.f();r.list(()=>r.ptr())
 if(legacy){r.i();for(let i=0;i<4;i++)r.bool();r.list(()=>r.ptr());for(let i=0;i<4;i++)r.str();r.i();r.f();const oldLanguages=readLanguages();r.bool();r.i();const oldTerms=readTerms();r.bool();r.i();r.str();if(!terms.length){terms=oldTerms;languages=oldLanguages}}
 r.end();if(terms.some(t=>t.languages.length!==languages.length))throw Error('I2 language table column mismatch');return{name,languages,terms}
}
