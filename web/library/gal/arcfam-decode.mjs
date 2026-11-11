// 自有 arc 家族（eomaia 引擎）的剧本 SCRE → 事件流（arcfam-scre/1，适配器 arcfam::scre 吃它）。
// 依据：g06 あざとカワイイ綾瀬ちゃん！ / g10 ギャル×オタ 的 script.arc（Encode:false，剧本是明文 SCRE）。不是把字节码完整解释一遍，而是认字节模式（和 bgi 不同，没有逆出全部操作码）：
//   SCRE 头：'SCRE' u32 0、u32 行数、u32 20、(行数 + 1) 个 u32 偏移（第一个 = 字节码起点）；字节码是栈机，整数一律大端：0x32 + i32 = 压整数，0x33 + 字符串\0 = 压字符串，0x17 = 调用，0x14 + 字符串\0 = 文本，0x18 + 8 字节 = 行号（u32，u32）
//   资源调用：`33 文件名\0  32 方法号  33 对象名\0  …  17`——对象 eomaia_audio（129 = 语音 .ogg，102 = BGM .wav，117 = 音效 .wav）、eomaia_image（102 = 底图：bg* / BG_* / EV*S* / h* / e*，105 / 106 = 叠加层：face / moji / karada / eff / cutin）等
//   说话人：`33 【名字】\0` 在文本之前压栈，只用一次
//   立绘（eomaia_char，g10 ギャル×オタ）：按字节码逐个 token 扫（0x32 int / 0x33 字符串 / 0x14 文本 / 0x18 +8 / 0x15 0x16 +4，别的 1 字节；每个调用 = 前面压的参数 + 方法号 + 对象名 + 2 + 11 + 0x17）→ ['m', 方法号, 参数[], [x, y, z]?]：
//     101(缩放%, 槽, 'xxx.char', 1) = 加载角色（前面 `x, y, 19` 三个整数 + 0x34 = 位置）；102(0, 序号, '部件名', 1) = 选部件（brow / eye-open / eye-close / mouth-open / mouth-close / cheek / tear）；103(底图序号)；104(淡入毫秒, 0) = 显示；105(淡出毫秒, 0, 1) = 去掉；106(-1, 1) = 清空
//   脚本引用：`33 xxx.script\0`（下一个脚本 / 分支去的脚本 / 回想场景）→ ['j', 名字]。真实脚本里：g06 的 ADV_KOHAI02 末尾只有一个（adv_kohai03.script）= 接着播；ADV_KOHAI08 末尾并排两个（adv_kohai08a / 08b）= 路线分支；中间出现的（adv_kohai_h01 等）是 H 场景，也在列表里，这里只记 links
// 没做：脚本内的选择（g06 / g10 的剧本里没有选项文字，路线分支靠脚本引用）、条件判断、叠加层的位置、立绘（这个引擎的样本里没看到立绘调用）、操作码的完整语义。
const AUDIO_METHODS = { 129: 'v', 102: 'b', 117: 's' }   // eomaia_audio

export function isScre(buf) { return buf.length > 20 && buf.subarray(0, 4).toString('latin1') === 'SCRE' }


// 逐个 token 扫字节码，抽 eomaia_char 调用（见上面的说明）。token 对齐靠「只认已知操作码的长度，别的 1 字节」——在真实剧本里 999 处 101 调用的前后模式全部一致
function charCalls(buf, start) {
  const out = []
  let i = start
  let stack = []
  let triple = null
  const n = buf.length
  while (i < n) {
    const op = buf[i]
    if (op === 0x32) { if (i + 5 > n) break; stack.push({ i: buf.readInt32BE(i + 1) }); i += 5 }
    else if (op === 0x33) { const e = buf.indexOf(0, i + 1); if (e < 0) break; stack.push({ s: buf.toString('utf8', i + 1, e), at: i }); i = e + 1 }
    else if (op === 0x17) {
      i += 1
      // 末尾 [... 方法号, 对象名, 2, 11]
      const obj = stack.findLastIndex((x) => x.s !== undefined && x.s.startsWith('eomaia'))
      if (obj >= 1 && stack[obj].s === 'eomaia_char' && stack[obj - 1].i !== undefined) {
        const method = stack[obj - 1].i
        const args = stack.slice(0, obj - 1).map((x) => (x.s !== undefined ? x.s : x.i))
        out.push({ at: stack[obj].at, e: ['m', method, args, ...(method === 101 && triple ? [triple] : [])] })
      }
      stack = []
      triple = null
    } else if (op === 0x14) { const e = buf.indexOf(0, i + 1); if (e < 0) break; i = e + 1; stack = []; triple = null }
    else if (op === 0x18) { i += 9; stack = []; triple = null }
    else if (op === 0x15 || op === 0x16) { i += 5; stack = []; triple = null }
    else {
      if (op === 0x34) { const ints = stack.filter((x) => x.i !== undefined).map((x) => x.i); triple = ints.length >= 3 ? ints.slice(-3) : null; stack = [] }   // 0x34 前面的 3 个整数 = 位置（x, y, 19）
      else { stack = []; triple = null }
      i += 1
    }
  }
  return out
}

// Literal static calls only. Unknown bytecode clears the operand stack; no VM/game code runs.
export function literalScreCalls(buf, start) {
  const calls=[];let stack=[]
  for(let i=start;i<buf.length;){
    const op=buf[i]
    if(op===0x32&&i+5<=buf.length){stack.push(buf.readInt32BE(i+1));i+=5}
    else if(op===0x33){const end=buf.indexOf(0,i+1);if(end<0)break;stack.push(buf.toString('utf8',i+1,end));i=end+1}
    else if(op===0x17){
      if(stack.length===5&&typeof stack[0]==='string'&&stack.slice(1).join(',')==='0,0,7,23')calls.push({at:i,object:'speaker',method:7,args:[stack[0]]})
      if(stack.length>=4&&typeof stack.at(-3)==='string'&&stack.at(-2)===2&&stack.at(-1)===11&&Number.isInteger(stack.at(-4)))calls.push({at:i,object:stack.at(-3),method:stack.at(-4),args:stack.slice(0,-4)})
      stack=[];i++
    }else if(op===0x14){const end=buf.indexOf(0,i+1);if(end<0)break;i=end+1;stack=[]}
    else{stack=[];i+=op===0x18?9:op===0x15||op===0x16?5:1}
    if(stack.length>1024)stack=[]
  }
  return calls
}

export function decodeScre(buf) {
  if (!isScre(buf)) throw new Error('不是 SCRE 剧本')
  const count = buf.readUInt32LE(8)
  if (count > 1_000_000 || 16 + (count + 1) * 4 > buf.length) throw new Error('SCRE 行数不合理')
  const start = buf.readUInt32LE(16)
  if (start < 16 || start > buf.length) throw new Error('SCRE 字节码起点不合理')
  const s = buf.toString('latin1')
  const events = []
  const utf8 = (latin) => Buffer.from(latin, 'latin1').toString('utf8')
  // 资源调用
  const res = /3([\x21-\x7e]{1,60}\.[A-Za-z0-9]{2,4})\x002([\s\S]{4})3([a-z_]{3,20})\x00/g
  for (let m = res.exec(s); m; m = res.exec(s)) {
    if (m.index < start) continue
    const method = Buffer.from(m[2], 'latin1').readUInt32BE(0)
    const file = m[1]
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
    if (m[3] === 'eomaia_audio' && AUDIO_METHODS[method] && (ext === 'ogg' || ext === 'wav')) events.push({ at: m.index, e: [AUDIO_METHODS[method], file] })
    else if (m[3] === 'eomaia_image' && (method === 102 || method === 105 || method === 106) && ext === 'png') events.push({ at: m.index, e: ['i', method, file] })
  }
  // 脚本引用
  const ref = /3([\x20-\x7e]{3,40}\.script)\x00/g
  for (let m = ref.exec(s); m; m = ref.exec(s)) if (m.index >= start) events.push({ at: m.index, e: ['j', m[1].toLowerCase()] })
  // 说话人：【名字】
  const who = /3(\xe3\x80\x90[^\x00]{1,80}?\xe3\x80\x91)\x00/g
  for (let m = who.exec(s); m; m = who.exec(s)) if (m.index >= start) events.push({ at: m.index, e: ['w', utf8(m[1]).replace(/^【|】$/g, '')] })
  // 文本：0x14 + utf-8 + \0（至少 2 个字符；前面是「32 00 00 00」整数的最后一个字节不算）
  const text = /\x14((?:[\x20-\x7e]|[\xc2-\xdf][\x80-\xbf]|[\xe0-\xef][\x80-\xbf]{2}|[\xf0-\xf4][\x80-\xbf]{3}){2,})\x00/g
  for (let m = text.exec(s); m; m = text.exec(s)) {
    if (m.index < start) continue
    if (m.index >= 4 && buf[m.index - 4] === 0x32 && buf[m.index - 3] === 0 && buf[m.index - 2] === 0 && buf[m.index - 1] === 0) continue   // 整数 0x14 的低字节
    let line = null
    if (m.index >= 9 && buf[m.index - 9] === 0x18) line = buf.readUInt32BE(m.index - 8)
    events.push({ at: m.index, e: ['t', utf8(m[1]), line] })
  }
  const calls=literalScreCalls(buf,start)
  const modern=calls.some(c=>c.object==='eomaia_image'&&c.method===103&&c.args.length===2&&c.args[0]===1&&typeof c.args[1]==='string'&&/\.png$/i.test(c.args[1]))||calls.some(c=>c.object==='audio'&&[105,118,130].includes(c.method))||calls.some(c=>c.object==='eomaia_char'&&c.method===102&&c.args.some(a=>typeof a==='string'&&/\.char$/i.test(a)))
  for(const call of calls){
    const {object,method,args,at}=call, file=args.find(a=>typeof a==='string'&&/\.(ogg|wav|png|char)$/i.test(a))
    if(object==='speaker'&&!/^【.*】$/.test(args[0]))events.push({at,e:['w',args[0]]})
    if(object==='audio'){
      const kind=({105:'b',118:'s',130:'v'})[method]
      if(kind&&file)events.push({at,e:[kind,file]})
      else events.push({at,e:['u',`audio:${method}`]})
    }
    if(modern&&object==='eomaia_image'&&method===103&&file)events.push({at,e:['i',102,file]})
    if(modern&&object==='eomaia_char'){
      if(method===102&&file&&args.length>=7)events.push({at,e:['m',101,[args[3],args[4],file,args[6]],[args[1],args[2],19]]})
      else if(method===103)events.push({at,e:['m',102,args]})
      else if(method>=104&&method<=107)events.push({at,e:['m',method-1,args]})
      else events.push({at,e:['u',`char:${method}`]})
    }
  }
  if(!modern)for (const call of charCalls(buf, start)) if (call.e[1] >= 101 && call.e[1] <= 106) events.push(call)
  events.sort((a, b) => a.at - b.at)
  return events.map((x) => x.e)
}
