// Verified against this build's IL2CPP methods, not filename similarity.
// FelaHandJob{,2}State / DLCSitFelaHandJobState::OnEnterState call
// PlayLoopVC(138 = FelaTipLoop). Their playSEhandjob and MovieHandJobState
// dohand select SEList 84..93 (Handjob1..5 / WetHandjob1..5).
const handSounds=Array.from({length:5},(_,i)=>'Handjob'+(i+1)),wetHandSounds=Array.from({length:5},(_,i)=>'WetHandjob'+(i+1))
const hand={voices:['FelaTipLoop'],sounds:[...handSounds,...wetHandSounds]}
export const RESISTER_ACTIONS={
 Fela:{
  handjob:{...hand,variables:{SwitchHand:0,IsInMouth:0,IsOpenMouth:0}},
  handjob2:{...hand,variables:{SwitchHand:0,IsInMouth:0,IsOpenMouth:0}},
  preshot:{sounds:[...handSounds,...wetHandSounds],variables:{SwitchHand:0,IsInMouth:0,IsOpenMouth:0}},
  // ChangeFelaMode(0/1/2) tweens SwitchHand to 1/0/2 respectively.
  fela:{voices:['FelaLoop1','FelaLoop2'],variables:{SwitchHand:1,IsInMouth:1}},
  paizuri:{voices:['FelaTipLoop'],variables:{SwitchHand:2,IsInMouth:0}}
 },
 DLCFela:{
  // HandjobON is independent from the Handjob motion curve.
  handjob:{...hand,variables:{HandjobON:1,FelaON:0}},
  handjob_preshot:{sounds:[...handSounds,...wetHandSounds],variables:{HandjobON:1,FelaON:0}},
  fela:{voices:['FelaLoop1','FelaLoop2'],variables:{HandjobON:0,FelaON:1}},
  fela_preshot:{voices:['FelaTipLoop'],variables:{HandjobON:0,FelaON:1}}
 },
 MovieH:{handjob:{sounds:[...handSounds,...wetHandSounds],variables:{IsHandJob:1,InsertMode:0}},handjob_cumShot:{sounds:[...handSounds,...wetHandSounds],variables:{IsHandJob:1,InsertMode:0}}}
}
export function resisterActionFeedback(ctx,native,motion){
 const source=RESISTER_ACTIONS[native.id]?.[motion];if(!source)return{}
 const resolve=(kind,name)=>ctx.media[ctx.profile.audio[kind]?.[name]?.toLowerCase()],voices=(source.voices||[]).map(name=>({name,voice:resolve('voice',name)})).filter(r=>r.voice),sounds=(source.sounds||[]).map(name=>({name,sound:resolve('se',name)})).filter(r=>r.sound)
 const replies=(voices.length?voices:[{}]).flatMap(v=>(sounds.length?sounds:[{}]).map(s=>({id:[v.name,s.name].filter(Boolean).join(' / '),title:[s.name,v.name].filter(Boolean).join(' / '),text:'',short:s.name?.replace('WetHandjob','湿').replace('Handjob','干'),...v.voice?{voice:v.voice}:{},...s.sound?{sound:s.sound}:{}}))).filter(r=>r.voice||r.sound)
 return{variables:source.variables,replies,replyTitle:source.sounds?.length?(source.voices?.length?'语音 / 音效':'音效'):'语音'}
}
