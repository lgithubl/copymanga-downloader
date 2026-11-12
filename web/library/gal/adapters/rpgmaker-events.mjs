import {skitCommands} from './rpgmaker-skit.mjs'
import { structValue, pluginData } from './rpgmaker-plugins.mjs'
import { safeRegex } from './options-merge.mjs'
import { mapSnapshot } from './rpgmaker-maps.mjs'

const v = id => `rpg:v:${Number(id)}`
const s = id => `rpg:s:${Number(id)}`
const literalArgs = text => {
  // JSON literals only, never eval/Function. Game code is untrusted input.
  try { const a = JSON.parse(`[${text}]`); return a.every(x => x === null || ['number', 'string', 'boolean'].includes(typeof x)) ? a : null } catch { return null }
}

export function compileRpgEvents(list, ctx, meta) {
  const o = meta.options, stage = ctx.stage || o.stage, steps = [], stats = { commands: 0, text: 0, choices: 0, raw: {}, warnings: [...(ctx.warnings || [])], scene: meta.scene }
  const initial = new Map(), calls = [], guards = [], pictures = new Map()
  const cgMatch = safeRegex(o.pictures.cgMatch), bgMatch = safeRegex(o.pictures.backgroundMatch)
  const thumbnailMatch = safeRegex(o.pictures.thumbnailMatch), thumbnailSkip = safeRegex(o.pictures.thumbnailSkip)
  const standingImages = new Set([...(ctx.standing?.values() || [])].map(item => String(item.imageName || '').replace(/\.png$/i, '').toLowerCase()))
  let pending = [], serial = 0, standingHold = false, bgsLine = 1, dynamicText = null
  const bindings = [], logStyles = new Map(pluginData(ctx,'LogDisplayPlugin','logSettings').map(x=>[x.name,x])), imageSprites = new Map(pluginData(ctx,'VariableSpriteDisplay','imageSprites').map(x=>[x.displayName,x])), variableGroups = new Map(pluginData(ctx,'VariableSpriteDisplay','variableGroups').map(x=>[x.name,x]))
  const flush = () => { if (pending.length) { steps.push({ index: steps.length, commands: pending }); pending = [] } }
  const when = () => guards.flatMap(g => g.conditions || [])
  const emit = cmd => { if(cmd.op==='rpgText')cmd={stage,...cmd}; if ((stats.emitted = (stats.emitted || 0) + 1) > o.maxCommands) throw new Error('RPG Maker 导出指令达到上限'); const w = when(); pending.push(w.length ? { ...cmd, when: [...w,...(cmd.when||[])] } : cmd) }
  const raw = (key, args) => { stats.raw[key] = (stats.raw[key] || 0) + 1; emit({ op: 'raw', cmd: key, args: JSON.stringify(args).slice(0, 1000) }) }
  let activeEventId=meta.eventId, mapId=Number(/Map(\d+)\.json$/i.exec(meta.rel||'')?.[1]||0)
  const characterId=id=>Number(id)===0?activeEventId:Number(id)
  const showMap=(id,eventId=0,page=-1,player=null)=>{
    mapId=id
    if(o.maps?.enabled===false)return
    const snapshot=mapSnapshot(ctx,id,eventId,page,player)
    if(snapshot){
      mapId=id;emit({op:'rpgMap',map:snapshot})
      const native=ctx.maps.get(`${o.root?o.root+'/':''}data/Map${String(id).padStart(3,'0')}.json`)
      emit(native?.parallaxName?{op:'bg',src:resource('img/parallaxes',native.parallaxName)}:{op:'bg',color:[0,0,0]})
      if(native?.autoplayBgm)audio('bgm',native.bgm)
    }
    else {raw('map-missing',id);emit({op:'rpgMap',map:null})}
  }
  const variable = (id, kind = 'v') => { const key = kind === 's' ? s(id) : v(id); let value = (kind === 's' ? o.initialSwitches : o.initialVariables)[id] ?? 0; if (kind === 's' && typeof value === 'boolean') value = Number(value); if (!initial.has(key)) initial.set(key, value); return key }
  const resource = (folder, name, ext = 'png') => {
    const clean = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!clean || clean.split('/').some(x => x === '..')) return ''
    return `${folder}/${clean.replace(new RegExp(`\\.${ext}$`, 'i'), '')}.${ext}`
  }
  const textParts = text => {
    let value = String(text).replace(/\\N\[(\d+)\]/gi, (_, id) => ctx.actors?.[Number(id)]?.name || `Actor ${id}`)
    value = value.replace(/\\(?:C|I|FS|PX|PY|OW|OC)\[[^\]]*\]/gi, '').replace(/\\[.!|><^{}$]/g, '').replace(/\\G\b/g, ctx.system?.currencyUnit || '')
    const parts = []; let at = 0
    for (const m of value.matchAll(/\\V\[(\d+)\]/gi)) { if (m.index > at) parts.push({ text: value.slice(at, m.index) }); parts.push({ text: '0', var: variable(m[1]) }); at = m.index + m[0].length }
    if (at < value.length) parts.push({ text: value.slice(at) })
    return parts.length ? parts : [{ text: '' }]
  }
  const audio = (kind, sound) => {
    const folder = kind === 'bgm' ? 'bgm' : kind === 'bgse' ? 'bgs' : kind === 'voice' || kind === 'bgvoice' ? 'voice' : kind === 'me' ? 'me' : 'se'
    const src = resource(sound?.folder || (kind === 'voice' || kind === 'bgvoice' ? ctx.voiceFolder || 'audio/voice' : 'audio/' + folder), sound?.name, 'ogg')
    if (kind === 'bgse') { if (src) emit({op:'bgvoice',slot:`rpg-bgs-${bgsLine}`,src,loop:true,kind:'bgse',volume:Number(sound.volume??100)/100,token:`rpg-${serial++}`}); return }
    if (src) emit({ op: kind === 'me' ? 'se' : kind, src, ...(kind === 'bgvoice' ? { slot: String(sound.slot || '0'), loop: sound.loop !== false, token: sound.token, kind: sound.loop === false ? 'voice' : 'bgvoice', pitch: Number(sound.pitch || 100)/100 } : {}), volume: Math.max(0, Math.min(1, Number(sound.volume ?? 100) / 100)), ...(kind === 'bgse' ? { loop: true } : {}) })
  }
  const picture = (p, move = false) => {
    const id = Number(p[0]), src = move ? '' : resource(o.pictures.folder, p[1])
    if (!move && !src && dynamicText) {
      emit({op:'rpgText',slot:`rpg-picture-${id}`,segments:textParts(dynamicText.text),x:Number(p[4])||0,y:Number(p[5])||0,width:stage[0],height:Math.min(stage[1],dynamicText.size*4),fontSize:dynamicText.size,visible:true}); dynamicText=null;return
    }
    if (!move && !src) { emit({ op: 'overlayOff', slot: `rpg-picture-${id}` }); emit({op:'rpgText',slot:`rpg-picture-${id}`,visible:false}); return }
    const offset = 0, origin = Number(p[2]), variablePos = Number(p[3]) === 1
    const x = Number(p[4 - offset]) || 0, y = Number(p[5 - offset]) || 0
    const cmd = { op: 'overlay', slot: `rpg-picture-${id}`, stage, x: x - stage[0] / 2, y: y - stage[1] / 2, anchor: origin ? [0.5, 0.5] : [0, 0], scaleX: Math.abs(Number(p[6 - offset]) || 0) / 100, scaleY: Math.abs(Number(p[7 - offset]) || 0) / 100, alpha: Number(p[8 - offset] ?? 255) / 255, z: id, fit: 'none', flipX: Number(p[6 - offset]) < 0 }
    if (src) {
      cmd.src = src; pictures.set(id, src)
      if (cgMatch?.test(src)) cmd.cg = true
      else if (bgMatch?.test(src)) cmd.kind = 'bg'
      else if (thumbnailMatch?.test(src) && !thumbnailSkip?.test(src) && !standingImages.has(String(p[1]).replace(/\.png$/i, '').toLowerCase())) cmd.thumb = src
    }
    if (variablePos) Object.assign(cmd, { xVar: variable(x), yVar: variable(y), xOffset: -stage[0] / 2, yOffset: -stage[1] / 2 })
    emit({op:'set',var:`rpg:picture:${id}`,value:1}); emit(cmd)
    if (move && p[11]) emit({ op: 'wait', seconds: Math.min(60, Number(p[10] || 0) / 60) })
  }
  const standing = text => {
    if (!o.plugins.standingPicture) return text
    text = String(text).replace(/\\\\/g, '\\')
    if (!standingHold) for (let n = 1; n <= 8; n++) emit({ op: 'overlayOff', slot: `rpg-standing-${n}` })
    const matches = [...text.matchAll(/\\F([1-8]?|F{1,3})\[([^\]]*)\]/gi)]
    for (const m of matches) {
      const n = /^F+$/i.test(m[1]) ? m[1].length + 1 : Number(m[1]) || 1, item = ctx.standing?.get(m[2]), slot = `rpg-standing-${n}`
      if (!item) { if (!m[2] || m[2] === '0') emit({ op: 'overlayOff', slot }); else raw('standing-missing', m[2]); continue }
      const suffix = (n - 1) % 4 + 1, x = Number(item[suffix === 1 ? 'x' : `x${suffix}`]) || 0, y = Number(item[suffix === 1 ? 'y' : `y${suffix}`]) || 0
      emit({ op: 'overlay', slot, kind: 'stand', src: resource(o.pictures.folder, item.imageName), stage, x: x - stage[0] / 2, y: y - stage[1] / 2, anchor: Number(item.origin) ? [0.5, 0.5] : [0, 0], scaleX: Math.abs(Number(item.scaleX || 100)) / 100, scaleY: Math.abs(Number(item.scaleY || 100)) / 100, alpha: Number(item.opacity ?? 255) / 255, flipX: n % 2 === 0 && Number(item.reverse) < 0, z: -10 + n })
    }
    const hold = /\\FH\[(ON|OFF)\]/i.exec(text); if (hold) standingHold = hold[1].toUpperCase() === 'ON'
    for (const m of text.matchAll(/\\M[1-8F]*\[([^\]]+)\]/gi)) raw('standing-motion', m[1])
    if (hold && !standingHold && !matches.length) for (let n = 1; n <= 8; n++) emit({ op: 'overlayOff', slot: `rpg-standing-${n}` })
    return text.replace(/\\(?:F[1-8]?|F{2,4}|M[1-8]?|M{2,4}|FH|AA)\[[^\]]*\]/gi, '')
  }
  const skit=skitCommands(ctx,{emit,raw,initial,stage})
  const callMapEvent = (eventId,depth) => {
    const targetMapId=mapId||ctx.system?.startMapId||0,map=ctx.maps?.get(`${o.root?o.root+'/':''}data/Map${String(targetMapId).padStart(3,'0')}.json`),event=map?.events?.find(e=>e?.id===eventId)
    if(!event?.pages?.length){raw('map-event-call-missing',{map:targetMapId,event:eventId});return}
    if(event.pages.some(p=>p.conditions?.itemValid)){raw('map-event-call-inventory-condition',{map:targetMapId,event:eventId});return}
    const chosen=`rpg:map-page:${serial++}`
    emit({op:'set',var:chosen,value:-1})
    // Higher pages win. Snapshot selection before the child can change its conditions.
    for(const [i,page]of event.pages.entries()){
      const cond=page.conditions||{},tests=[]
      for(const n of[1,2])if(cond[`switch${n}Valid`])tests.push({var:variable(cond[`switch${n}Id`],'s'),op:'===',value:1})
      if(cond.variableValid)tests.push({var:variable(cond.variableId),op:'>=',value:Number(cond.variableValue)||0})
      if(cond.selfSwitchValid){const key=`rpg:self:${targetMapId}:${eventId}:${cond.selfSwitchCh}`;if(!initial.has(key))initial.set(key,0);tests.push({var:key,op:'===',value:1})}
      if(cond.actorValid){const key=`rpg:party:${cond.actorId}`;if(!initial.has(key))initial.set(key,ctx.system?.partyMembers?.includes(Number(cond.actorId))?1:0);tests.push({var:key,op:'===',value:1})}
      emit({op:'set',var:chosen,value:i,when:tests})
    }
    const caller=activeEventId,callerMap=mapId
    for(const [i,page]of event.pages.entries()){
      guards.push({type:'map-page',indent:-1,conditions:[{var:chosen,op:'===',value:i}]})
      activeEventId=eventId;mapId=targetMapId
      run(page.list||[],depth+1,`map:${targetMapId}:${eventId}`)
      guards.pop()
    }
    activeEventId=caller;mapId=callerMap
  }
  const plugin = (text,depth=0) => {
    const words = String(text).trim().split(/\s+/), command = words.shift(), arg = words
    if(command.toLowerCase()==='skit'){const [action,name,wait,value]=arg;if(skit(({exp:'expression'})[action]||action,{name,expression:value,pose:value,position:value}))return;raw('skit-command-unhandled',text);return}
    if (['PB_BGS_CHANGE_LINE','PB_BGS_CHANGE_LINE2','S_CHANGE_LINE'].includes(command)) { bgsLine=Number(arg[0])||1;return }
    if (command==='PB_BGS_ALL_STOP') { emit({op:'bgvoiceOff',prefix:'rpg-bgs-'});return }
    if (command==='D_TEXT') { dynamicText={text:arg.slice(0,-1).join(' '),size:Math.max(8,Math.min(96,Number(arg.at(-1))||28))};return }
    if (command==='D_TEXT_SETTING') { raw('text-picture-setting',text);return }
    if (command==='call_ev') { callMapEvent(Number(arg[0]),depth); return }
    if (/^SV_(?:ボイスの演奏|ボイスのループ演奏)$/i.test(command) && o.plugins.simpleVoice) {
      audio('bgvoice',{name:arg[0],volume:Number(arg[1]||90),pitch:Number(arg[2]||100),slot:`rpg-voice-${Number(arg[4])||1}`,loop:/ループ|LOOP/i.test(command),token:`rpg-${serial++}`});return
    }
    if (command==='SV_ボイスの停止') { const channel=arg[0]&&/^[0-9]+$/.test(arg[0])?arg[0]:'';emit({op:'bgvoiceOff',...(channel?{slot:`rpg-voice-${channel}`}:{prefix:'rpg-voice-',...(arg[0]?{src:resource(ctx.voiceFolder,arg[0],'ogg')}:{})})});return }
    if (/^SV_RESERVE/i.test(command)) { raw('voice-reservation-unhandled', text); return }
    if (/^SV_(?:PLAY|RESERVE)(?:_LOOP)?_VOICE$/i.test(command) && o.plugins.simpleVoice) {
      const loop = /LOOP/i.test(command)
      audio(loop ? 'bgvoice' : 'voice', { name: arg[0], volume: Number(arg[1] || 90), slot: arg[4] || '0' }); return
    }
    if (/^SV_STOP_VOICE$/i.test(command) && o.plugins.simpleVoice) { emit({ op: 'bgvoiceOff', slot: arg[0] || '' }); return }
    if (command === 'LL_StandingPictureMV' && o.plugins.standingPicture) { standing(arg.slice(1).join(' ')); return }
    for (const rule of o.plugins.commands || []) {
      const match = safeRegex(rule.match)?.exec(String(text))
      if (match && ['voice', 'bgvoice', 'bgm', 'se', 'bgse'].includes(rule.op)) { audio(rule.op, { name: match.groups?.name || match[1], folder: rule.folder, volume: 100 }); return }
    }
    raw(`plugin:${command || 'empty'}`, text)
  }
  const mzPlugin = (name, action, args, depth) => {
    name=String(name).split('/').at(-1)
    if(o.plugins.structured===false){raw(`plugin:${name}`,{action,args});return}
    if(name==='RX_T_CallEvent_in_Map'&&action==='callev'){callMapEvent(Number(args.eventID),depth);return}
    if(name==='TRP_SkitMZ'&&skit(action,args))return
    const voice=name==='SimpleVoice',visu=name==='VisuMZ_2_VoiceActControl'
    if((voice&&o.plugins.simpleVoice)||visu){
      if(['PLAY_VOICE','SoundPlayAsVoiceLine'].includes(action)){
        audio('bgvoice',{name:args.name??args['name:str'],volume:Number(args.volume??args['volume:num']??100),pitch:Number(args.pitch??args['pitch:num']??100),folder:voice?ctx.voiceFolder:'audio/se',slot:`rpg-voice-${Number(args.channel)||1}`,loop:args.loop===true||args.loop==='true',token:`rpg-${serial++}`});return
      }
      if(['STOP_VOICE','SoundStopAllVoiceLines'].includes(action)){emit({op:'bgvoiceOff',...(args.channel?{slot:`rpg-voice-${args.channel}`}:{prefix:'rpg-voice-',...(args.name?{src:resource(ctx.voiceFolder,args.name,'ogg')}:{})})});return}
    }
    if(name==='ParallelBgs'){
      if(action==='CHANGE_LINE'){bgsLine=Number(args.line??Object.values(args)[0])||1;return}
      if(action==='ALL_STOP'){emit({op:'bgvoiceOff',prefix:'rpg-bgs-'});return}
    }
    if(name==='LL_GalgeChoiceWindow'&&action==='showChoice'){
      if(args.messageText){emit({op:'ui',visible:true});emit({op:'text',segments:textParts(args.messageText)});stats.text++;flush()}
      const choices=structValue(args.choices||'[]');if(!Array.isArray(choices)){raw('plugin-choice-invalid',args);return}
      const options=choices.slice(0,128).map((x,i)=>({value:i+1,resultValue:Number(x.resultNumber)||0,segments:textParts(x.label||''),...(Number(x.switchId)?{when:[{var:variable(x.switchId,'s'),op:'===',value:1}]}:{})}))
      if(args.cancelType===true||args.cancelType==='true')options.push({value:-1,resultValue:-1,segments:textParts('取消')})
      emit({op:'choice',id:`${steps.length}:${pending.length}`,var:variable(args.variableNumber),reindex:true,options});stats.choices++;flush();return
    }
    if(name==='LogMessage'){
      const slot='rpg-log-message'
      if(action==='init'){logStyles.set(slot,{scroll:'bottom',fontSize:Number(ctx.plugins?.find(p=>p.name.split('/').at(-1)==='LogMessage')?.parameters?.fontSize)||28,x:Number(args.x)||0,y:Number(args.y)||0,width:Number(args.width)||stage[0],height:Number(args.height)||stage[1]});emit({op:'rpgText',slot,segments:[],visible:true,...logStyles.get(slot)});return}
      if(action==='add'){const segments=textParts(args.text||'');emit({op:'rpgText',slot,...(logStyles.get(slot)||{}),segments,append:true,visible:true});emit({op:'ui',visible:false});emit({op:'speaker',segments:[]});emit({op:'text',segments});stats.text++;flush();return}
      if(['hide','show','clear','remove'].includes(action)){emit({op:'rpgText',slot,...(['clear','remove'].includes(action)?{segments:[]}:{}),visible:!['hide','remove'].includes(action)});return}
    }
    if(name==='LogDisplayPlugin'){
      const slot='rpg-log-'+args.logName,style=logStyles.get(args.logName)||{}
      if(action==='showLog'||action==='hideLog'){emit({op:'rpgText',slot,visible:action==='showLog',...style});return}
      if(['setNewText','addToText'].includes(action)){
        emit({op:'rpgText',slot,...style,segments:textParts(args.text||''),append:action==='addToText',visible:true});emit({op:'ui',visible:false});emit({op:'speaker',segments:[]});emit({op:'text',segments:textParts(args.text||'')});stats.text++;flush();return
      }
    }
    if(name==='VariableSpriteDisplay'){
      if(action==='showImage'){
        const image=imageSprites.get(args.displayName);if(!image){raw('plugin-image-missing',args);return}
        emit({op:'overlay',slot:'rpg-image-'+args.displayName,src:resource('img/pictures',image.fileName),stage,x:Number(image.x)-stage[0]/2,y:Number(image.y)-stage[1]/2,anchor:[0,0],scaleX:1,scaleY:1,alpha:1,z:Number(image.zIndex)||0,fit:'none'});return
      }
      if(action==='removeImage'){emit({op:'overlayOff',slot:'rpg-image-'+args.displayName});return}
      if(action==='showGroup'||action==='removeGroup'){
        const group=variableGroups.get(args.groupName),vars=structValue(group?.variables||'[]');if(!Array.isArray(vars))return
        vars.forEach((v,i)=>emit({op:'rpgText',slot:`rpg-vars-${args.groupName}-${i}`,visible:action==='showGroup',x:Number(v.x)||0,y:Number(v.y)||0,width:200,height:48,fontSize:Number(v.fontSize)||20,color:v.fontColor,segments:[{text:'0',var:variable(v.variableId)}]}));return
      }
    }
    if(name==='DTextPicture'&&action==='dText'){dynamicText={text:args.text??args.textBody??'',size:Number(args.size??args.fontSize)||28};return}
    if(name==='PictureCallCommon'&&o.plugins.pictureActions){
      const id=Number(args.pictureId)
      if(action==='REMOVE_PICTURE_EVENT'){emit({op:'set',var:`rpg:bind:${id}`,value:0});return}
      if(action==='ADD_PICTURE_EVENT'){
        if(args.script)raw('picture-action-script-unhandled',args.script)
        const token=++serial;emit({op:'set',var:`rpg:bind:${id}`,value:token});bindings.push({id,token,args,conditions:when(),depth});return
      }
    }
    // Harmless presentation/system plugins still remain diagnosed instead of executing JS.
    plugin(`${name} ${action} ${Object.values(args||{}).join(' ')}`)
  }
  const script = text => {
    const remaining = text.replace(/\$gameScreen\.(?:showPicture|movePicture|erasePicture|clearPictures)\([^;\n]*\)\s*;?/g, '').replace(/\/\/[^\n]*/g, '').trim()
    if (remaining) { raw('script-unhandled', text); return }
    let count = 0
    if (o.plugins.pictureCalls) for (const m of text.matchAll(/\$gameScreen\.(showPicture|movePicture|erasePicture|clearPictures)\(([^;\n]*)\)\s*;?/g)) {
      const args = literalArgs(m[2]); if (!args) continue
      if (m[1] === 'showPicture') picture([args[0], args[1], args[2], 0, ...args.slice(3)])
      if (m[1] === 'movePicture') picture([args[0], '', args[1], 0, ...args.slice(2)], true)
      if (m[1] === 'erasePicture') emit({ op: 'overlayOff', slot: `rpg-picture-${Number(args[0])}` })
      if (m[1] === 'clearPictures') for (const id of pictures.keys()) emit({ op: 'overlayOff', slot: `rpg-picture-${id}` })
      count++
    }
    // Do not report a compound/loop script as fully implemented after matching
    // a single known call inside it; uncovered source is still diagnosed.
    if (!count || remaining) raw('script-unhandled', text)
  }
  const condition = p => {
    if (p[0] === 0) return { var: variable(p[1], 's'), op: '===', value: p[2] === 0 ? 1 : 0 }
    if (p[0] === 1) return { var: variable(p[1]), op: ['===', '>=', '<=', '>', '<', '!=='][p[4]] || '===', ...(p[2] === 0 ? { value: p[3] } : { valueVar: variable(p[3]) }) }
    if(p[0]===4&&p[2]===0){const key=`rpg:party:${p[1]}`;if(!initial.has(key))initial.set(key,ctx.system?.partyMembers?.includes(Number(p[1]))?1:0);return {var:key,op:'===',value:1}}
    raw('condition-unhandled', p)
    return null
  }
  const run = (commands, depth = 0, callId = '') => {
    if (depth > o.maxCallDepth || calls.includes(callId) && callId) { raw('common-event-cycle-or-depth', callId); return }
    calls.push(callId); const guardBase = guards.length, live = `rpg:scope:${serial++}`
    emit({ op: 'set', var: live, value: 1 })
    guards.push({ type: 'scope', indent: -1, conditions: [{ var: live, op: '===', value: 1 }] })
    const labels = new Map(commands.map((c, i) => c.code === 118 ? [String(c.parameters?.[0]), i] : [null, -1]))
    for (let i = 0; i < commands.length; i++) {
      if (++stats.commands > o.maxCommands) throw new Error(`RPG Maker 指令超过 ${o.maxCommands} 上限，停止解析`)
      for(let n=guards.length-1;n>=guardBase;n--)if(guards[n].type==='forwardJump'&&guards[n].owner===live&&guards[n].end<=i)guards.splice(n,1)
      const c = commands[i], p = c.parameters || [], indent = Number(c.indent || 0)
      if (c.code === 101) {
        const text = []
        while (commands[i + 1]?.code === 401) text.push(String(commands[++i].parameters?.[0] || ''))
        emit({op:'ui',visible:true})
        let body = standing(text.join('\n')), name = String(p[4] || '')
        body = body.replace(/\\n<([^>]+)>/gi, (_, who) => { name = who; return '' })
        emit({ op: 'speaker', segments: textParts(name) }); emit({ op: 'text', segments: textParts(body) }); stats.text++; flush(); continue
      }
      if (c.code === 102) {
        flush(); const key = `rpg:choice:${serial++}`, options = (p[0] || []).map((label, n) => ({ value: n + 1, segments: textParts(label) }))
        if (p[1] === -2) options.push({ value: 0, segments: [{ text: '取消' }] })
        emit({ op: 'choice', id: `${steps.length}:${pending.length}`, var: key, options }); stats.choices++; flush()
        guards.push({ indent, type: 'choice', key, conditions: [] }); continue
      }
      if (c.code === 402 || c.code === 403) { const g = [...guards].reverse().find(g => g.type === 'choice' && g.indent === indent); if (g) g.conditions = [{ var: g.key, op: '===', value: c.code === 403 ? 0 : Number(p[0]) + 1 }]; continue }
      if (c.code === 404 || c.code === 412) { const n = guards.findLastIndex(g => g.indent === indent); if (n >= guardBase) guards.splice(n, 1); continue }
      if (c.code === 111) {
        const test = condition(p), key = `rpg:branch:${serial++}`
        if (test) emit({ op: 'set', var: key, test })
        const cond = { var: key, op: '===', value: 1 }
        guards.push({ indent, type: 'if', condition: cond, conditions: [cond] }); continue
      }
      if (c.code === 411) { const g = [...guards].reverse().find(g => g.type === 'if' && g.indent === indent); if (g) g.conditions = [{ ...g.condition, not: true }]; continue }
      if (c.code === 117) { const id = Number(p[0]), inner = ctx.common?.[id]; if (inner?.list) run(inner.list, depth + 1, String(id)); else raw('common-event-missing', id); continue }
      if (c.code === 121) { for (let id = p[0]; id <= Math.min(p[1], p[0] + 10000); id++) emit({ op: 'set', var: variable(id, 's'), value: p[2] === 0 ? 1 : 0 }); continue }
      if (c.code === 122) {
        if (p[3]===2) { for(let id=p[0];id<=Math.min(p[1],p[0]+10000);id++)emit({op:'set',var:variable(id),calc:['set','add','sub','mul','div','mod'][p[2]],random:{min:Number(p[4]),max:Number(p[5]),seed:`rpg-${serial++}`}});continue }
        if (p[3] !== 0 && p[3] !== 1) { raw('variable-operand-unhandled', p); continue }
        for (let id = p[0]; id <= Math.min(p[1], p[0] + 10000); id++) emit({ op: 'set', var: variable(id), calc: ['set', 'add', 'sub', 'mul', 'div', 'mod'][p[2]], ...(p[3] === 0 ? { value: p[4] } : { valueVar: variable(p[4]) }) }); continue
      }
      if(c.code===129){emit({op:'set',var:`rpg:party:${Number(p[0])}`,value:p[1]===0?1:0});continue}
      if (c.code === 123) { emit({op:'set',var:`rpg:self:${mapId}:${activeEventId}:${p[0]}`,value:p[1]===0?1:0});continue }
      if (c.code === 201) {
        if(p[0]!==0){raw('map-transfer-variable',p);continue}
        showMap(Number(p[1]),0,-1,{x:Number(p[2]),y:Number(p[3]),direction:Number(p[4])||2});continue
      }
      if (c.code === 203) {
        const patch={...(p[4]?{direction:p[4]}:{})}
        if(p[1]===0)Object.assign(patch,{x:p[2],y:p[3]})
        if(p[1]===1)Object.assign(patch,{xVar:p[2],yVar:p[3]})
        emit({op:'rpgEvent',id:characterId(p[0]),patch,...(p[1]===2?{exchange:characterId(p[2])}:{})});continue
      }
      if (c.code === 205) {
        const route=p[1]||{},actions=[]
        for(const action of route.list||[]){
          if(++stats.commands>o.maxCommands)throw Error('RPG Maker 移动路线超过指令上限')
          if([9,23,24,45].includes(action.code)){raw('map-route-unhandled',action);continue}
          if(action.code===44){audio('se',action.parameters?.[0]);continue}
          actions.push({...action,...(action.code===41?{src:resource('img/characters',action.parameters?.[0])}:{})})
        }
        if(route.repeat)raw('map-route-repeat-once',p[0])
        emit({op:'rpgRoute',id:characterId(p[0]),serial:`route-${serial++}`,actions,wait:!!route.wait});continue
      }
      if (c.code === 211) { emit({op:'rpgEvent',id:-1,patch:{visible:p[0]!==0}});continue }
      if (c.code === 214) { emit({op:'rpgEvent',id:meta.eventId,patch:{visible:false,erased:true}});continue }
      if (c.code === 231) { picture(p); continue }
      if (c.code === 232) { picture(p, true); continue }
      if (c.code === 235) { emit({op:'set',var:`rpg:picture:${Number(p[0])}`,value:0});emit({op:'rpgText',slot:`rpg-picture-${Number(p[0])}`,visible:false}); emit({ op: 'overlayOff', slot: `rpg-picture-${Number(p[0])}` }); pictures.delete(Number(p[0])); continue }
      if (c.code === 241 || c.code === 245 || c.code === 249 || c.code === 250) { audio(({241:'bgm',245:'bgse',249:'me',250:'se'})[c.code], p[0]); continue }
      if (c.code === 242) { emit({ op: 'bgmStop', fade: Number(p[0] || 0) }); continue }
      if (c.code === 246) { emit({ op: 'bgvoiceOff',slot:`rpg-bgs-${bgsLine}` }); continue }
      if (c.code === 230) { emit({ op: 'wait', seconds: Math.min(60, Number(p[0] || 0) / 60) }); continue }
      if (c.code === 221 || c.code === 222) { emit({ op: 'fade', to: c.code === 221 ? 'black' : 'clear', seconds: 0.4 }); continue }
      if (c.code === 225) { emit({ op: 'shake', strength: Number(p[0] || 0), seconds: Number(p[2] || 0) / 60 }); continue }
      if (c.code === 261) { const src = resource('movies', p[0], 'webm'); if (src) emit({ op: 'movie', srcs: [src], loop: false }); continue }
      if (c.code === 356) { plugin(p[0],depth); continue }
      if (c.code === 357) { mzPlugin(p[0],p[1],p[3]||{},depth); continue }
      if (c.code === 355) { let text = String(p[0] || ''); while (commands[i + 1]?.code === 655) text += '\n' + String(commands[++i].parameters?.[0] || ''); script(text); continue }
      if (c.code === 119) { const at = labels.get(String(p[0])); if (at > i) {const key=`rpg:jump:${serial++}`;initial.set(key,0);emit({op:'set',var:key,value:1});guards.push({type:'forwardJump',owner:live,end:at,indent:-2,conditions:[{var:key,op:'!==',value:1}]})} else raw('jump-unhandled', p); continue }
      if (c.code === 115) { emit({ op: 'set', var: live, value: 0 }); continue }
      if ([0, 108, 408, 118, 505, 657].includes(c.code)) continue
      raw(`event:${c.code}`, p)
    }
    guards.splice(guardBase); calls.pop()
  }
  const conditions = meta.pageConditions
  for(const [id,value]of Object.entries(o.initialVariables||{}))if(Number.isInteger(Number(id))&&Number(id)>0)initial.set(v(id),value)
  for(const [id,value]of Object.entries(o.initialSwitches||{}))if(Number.isInteger(Number(id))&&Number(id)>0)initial.set(s(id),Number(!!value))
  if (conditions) {
    if (conditions.switch1Valid) initial.set(variable(conditions.switch1Id, 's'), 1)
    if (conditions.switch2Valid) initial.set(variable(conditions.switch2Id, 's'), 1)
    if (conditions.variableValid) { const key = variable(conditions.variableId); initial.set(key, Math.max(Number(initial.get(key)) || 0, Number(conditions.variableValue || 0))) }
    if (conditions.selfSwitchValid) initial.set(`rpg:self:${mapId}:${meta.eventId}:${conditions.selfSwitchCh}`,1)
  }
  emit({ op: 'bg', color: [0, 0, 0] })
  if(meta.map&&mapId)showMap(mapId,meta.eventId,meta.pageIndex)
  if(meta.map&&o.maps?.enabled!==false)stats.warnings.push('地图为事件初始快照；无游戏存档时玩家位置取系统起点或事件附近，不执行自主移动/并行事件或玩家操控')
  run(list, 0, Array.isArray(ctx.common) && String(meta.scene).startsWith('common-') ? String(meta.eventId) : '')
  flush()
  if(o.plugins.pictureActions&&bindings.length){
    const max=Math.max(1,Math.min(32,Number(o.plugins.maxPictureActions)||16)),key=`rpg:actions:${serial++}`
    const estimate=(id,seen=new Set(String(meta.scene).startsWith('common-')?[String(meta.eventId)]:[]))=>{
      if(seen.has(String(id)))return 100000
      const list=ctx.common?.[Number(id)]?.list||[];let cost=list.length
      for(const command of list)if(command.code===117){cost+=estimate(command.parameters[0],new Set([...seen,String(id)]));if(cost>2000)break}
      return cost
    }
    let budget=Math.max(0,Math.floor((o.maxCommands-Math.max(stats.commands,stats.emitted||0)-500)/4)),omitted=0
    const actions=bindings.filter(b=>Number(b.args.commonEventId)>0||Number(b.args.variableId)>0||Number(b.args.switchId)>0).slice(-max).filter(a=>{const cost=Number(a.args.commonEventId)>0?estimate(a.args.commonEventId):1;if(cost>2000||cost>budget){omitted++;return false}budget-=cost;return true})
    if(omitted)raw('picture-actions-complex-gameplay',{omitted,reason:'large/cyclic gameplay callbacks remain available in the common-event list; not expanded into the current static scene'})
    if(bindings.length>max)raw('picture-actions-limit',{total:bindings.length,selected:actions.length})
    if(actions.length){
      emit({op:'choice',id:`${steps.length}:${pending.length}`,var:key,options:[...actions.map((a,i)=>({value:i+1,pictureSlot:`rpg-picture-${a.id}`,segments:textParts(ctx.common?.[Number(a.args.commonEventId)]?.name||`图片 ${a.id}`),when:[...a.conditions,{var:`rpg:bind:${a.id}`,op:'===',value:a.token},{var:`rpg:picture:${a.id}`,op:'===',value:1}]})),{value:0,segments:textParts('结束')}]});flush()
      for(const [i,a]of actions.entries()){
        guards.push({conditions:[{var:key,op:'===',value:i+1}]})
        if(Number(a.args.switchId))emit({op:'set',var:variable(a.args.switchId,'s'),value:1})
        if(Number(a.args.variableId))emit({op:'set',var:variable(a.args.variableId),calc:['set','add','sub','mul','div','mod'][Number(a.args.operationType)||0],value:Number(a.args.operand)||0})
        const target=ctx.common?.[Number(a.args.commonEventId)];if(target?.list)run(target.list,1,String(target.id))
        flush();guards.pop()
      }
    }
  }
  const initialization = [...initial].map(([key, value]) => ({ op: 'set', var: key, value }))
  if (!steps.length) steps.push({ index: 0, commands: [] })
  steps[0].commands.unshift(...initialization)
  stats.steps = steps.length
  if (Object.keys(stats.raw).length) stats.warnings.push('未支持的游戏指令已记入 raw；不执行任意游戏JavaScript，也不模拟地图探索/战斗')
  return { steps, stats }
}
