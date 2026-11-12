// 场景「跳转点」（config.sceneMarkers）：场景选择的卡片上给每个脚本几个小按钮，点了从那一步开始播放（比如 H 场景开始的地方）。
// 纯函数：对解析好的场景（gal-scene/1）按规则找步号，browse.mjs 的 scriptInfo 调用（结果跟着 scriptInfo 缓存）。
//   规则 { label, kind, op?, match?, pick?, max? }（config.mjs 校验后的样子）
//     kind 'bg'：按**当前背景**判断（最后一个 bg 指令的 src / over 命中 match 就算「在这个画面里」）
//           pick 'run'（默认）= 每一段（连续在这个画面里）的第一步；'each' = 每次换到命中的背景的那一步；'first' / 'last' = 第一个 / 最后一个
//     kind 'cmd'：按指令判断（op = 指令名，如 bgse / bgmStop / bgm / movie / se / voice / text；match 对 src / name / 台词文字，没写 = 只看指令名）
//           pick 'each'（默认）/ 'first' / 'last'
//     max：每条规则最多几个（默认 6）；标签：同一条规则命中不止一个时加序号（「H 开始 2」）
//   结果 [{ step, label, ratio }]：按步号排序，第 0 步和最后两步不要（从头开始本来就是默认；跳到末尾没意义），同一步只留第一条规则的，总数最多 12
const TOTAL_LIMIT = 12
import { choiceHistoriesForCommands } from '../../static/gal-engine.js'

const textOf = (command) => (Array.isArray(command.segments) ? command.segments.map((s) => s?.text ?? '').join('') : '')
const commandKeys = (command) => [command.src, command.name, command.slot, command.over, textOf(command)].filter((x) => typeof x === 'string' && x)

function hitsOf(steps, rule) {
  const hits = []
  if (rule.kind === 'bg') {
    let now = false
    let current = ''
    steps.forEach((step, i) => {
      let changed = false
      for (const c of step.commands || []) {
        if (c.op === 'bg') { current = [c.src, c.over].filter((x) => typeof x === 'string' && x).join('\n'); changed = true } else if (c.op === 'bgoff') { current = ''; changed = true }
      }
      const matches = Boolean(current) && (!rule.re || rule.re.test(current) || current.split('\n').some((x) => rule.re.test(x)))
      if (matches && (rule.pick === 'each' ? changed : !now)) hits.push(i)
      now = matches
    })
  } else {
    steps.forEach((step, i) => {
      if ((step.commands || []).some((c) => c.op === rule.op && (!rule.re || commandKeys(c).some((x) => rule.re.test(x))))) hits.push(i)
    })
  }
  return hits
}

export function computeMarkers(scene, rules, { includeEndpoints = false } = {}) {
  const steps = Array.isArray(scene?.steps) ? scene.steps : []
  if (!rules?.length || !steps.length) return []
  const targets=[]
  steps.forEach((step,i)=>{if(!includeEndpoints&&!(i>0&&i<steps.length-2))return;step.commands?.forEach((c,k)=>{if(c.when?.length&&rules.some(rule=>rule.kind==='cmd'&&c.op===rule.op&&(!rule.re||commandKeys(c).some(x=>rule.re.test(x)))))targets.push({step:i,command:k})})})
  const histories=choiceHistoriesForCommands(scene,targets)
  const found = new Map()   // 步号 → 标签
  for (const rule of rules) {
    const choices = new Map()
    const candidates=hitsOf(steps,rule),hits=[]
    const limit=rule.pick==='first'||rule.pick==='last'?1:Number.isFinite(rule.max)?Math.max(0,rule.max):Infinity
    if(rule.pick==='last')candidates.reverse()
    for(const i of candidates){
      if(hits.length>=limit)break
      if(!includeEndpoints&&!(i>0&&i<steps.length-2))continue
      let reachable=rule.kind!=='cmd'
      if(!reachable){
        const matching=steps[i].commands.map((c,k)=>({c,k})).filter(({c})=>c.op===rule.op&&(!rule.re||commandKeys(c).some(x=>rule.re.test(x))))
        reachable=matching.some(({c})=>!c.when?.length)
        if(!reachable)for(const{k}of matching){const picked=histories.get(`${i}:${k}`);if(picked){choices.set(i,picked);reachable=true;break}}
      }
      if(reachable)hits.push(i)
    }
    hits.forEach((step, k) => { if (!found.has(step)) found.set(step, { label: hits.length > 1 ? `${rule.label} ${k + 1}` : rule.label, ...(Object.keys(choices.get(step) || {}).length ? { choices: choices.get(step) } : {}) }) })
  }
  return [...found].sort((a, b) => a[0] - b[0]).slice(0, TOTAL_LIMIT).map(([step, fields]) => ({ step, ...fields, ratio: Math.round((step / Math.max(1, steps.length - 1)) * 1000) / 1000 }))
}

// Shared by every adapter. Explicit game markers win; otherwise use actual CG
// commands, then reachable dialogue checkpoints. The card visibility switch is
// a reader preference and does not depend on the adapter's layout rules.
export function computeSceneMarkers(scene,rules=[],options={}){
  const explicit=computeMarkers(scene,rules,options);if(explicit.length)return explicit
  const steps=scene?.steps||[];if(steps.length<3)return[]
  const cg=/(?:^|[/_])(?:(?:ev|cg|hcg|event)[0-9_/-]|scene[0-9a-z_/-])/i
  const candidates=[]
  steps.forEach((step,i)=>{if(i===0||i===steps.length-1)return;step.commands?.forEach((c,k)=>{if(c.cg||['live2d','movie'].includes(c.op)||['bg','overlay'].includes(c.op)&&cg.test(c.src||''))candidates.push({step:i,command:k,label:'CG 开始'})})})
  const reachable=targets=>{
    const histories=choiceHistoriesForCommands(scene,targets),found=new Map()
    for(const t of targets){if(found.has(t.step)||found.size>=6)continue;const c=steps[t.step].commands[t.command],choices=histories.get(`${t.step}:${t.command}`);if(c.when?.length&&!choices)continue;found.set(t.step,{step:t.step,label:t.label,ratio:Math.round(t.step/(steps.length-1)*1000)/1000,...(choices&&Object.keys(choices).length?{choices}:{})})}
    return[...found.values()].sort((a,b)=>a.step-b.step)
  }
  const actual=reachable(candidates);if(actual.length)return actual.map((m,i)=>({...m,label:actual.length>1?`CG 开始 ${i+1}`:m.label}))
  const text=[];steps.forEach((step,i)=>{const k=step.commands?.findIndex(c=>c.op==='text');if(k>=0&&i>0&&i<steps.length-1)text.push({step:i,command:k})})
  if(!text.length)return[]
  return reachable([.25,.5,.75].map(p=>({...text[Math.min(text.length-1,Math.floor((text.length-1)*p))],label:`剧情 ${Math.round(p*100)}%`})))
}
