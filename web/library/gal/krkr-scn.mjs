// KiriKiri Z 的场景脚本（scn.xp3 里的 PSB）→ 紧凑的 JSON（krkr-scn/1，适配器 krkr::scn 吃它）。
// 脚本结构（g08 / g09 的 521 个剧本读出来的）：
//   root = { name: 'sc_2_st01.txt', scenes: [{ label, title, nexts: [{ storage, target, type }], jumplabels, lines, texts }] }
//   lines 里：["startline", "vflag", 0, "name", 说话人, "text", 1] 后面跟一个数字 n = 台词（texts[n - 1]，46420 / 46420 的说话人对得上）；
//             ["envupdate", …] 改图层；["playvoice", …] / ["wait", "time", 毫秒] / ["quake", …] 等；[序号, { data: [图层…] }] 是此刻的环境快照
//   texts[i] = [说话人 | null, [[null, 文字（\\n = 换行）, 字号, …]…], [{ name, voice, type }] | null, 标志, { data: 图层快照 }]
//   图层快照 data = [[名字, 类别, { class, name, showmode（3 显示 / 0 隐藏）, redraw: { imageFile: { file, options }, posName }, action: [[键, 值]…] }]…]
//     类别：stage（背景，名字 bg）/ character（立绘，imageFile.file = 立绘定义名如 cha001.stand，options = { dress, face, pose, add } 选图层）/ event（事件 CG，名字 ev）/ layer / evdanmen / evcutin；bgm / se 是声音；udmask / msgwin 是遮罩 / 对话框的脸
// 输出：每个台词一步 { t: 文字, n: 说话人, v: 语音名, l: [压缩后的图层], b: [bgm 文件, 状态, 音量, 循环], tr: [转场方式, 毫秒, 遮罩]（envupdate 里 "trans" 后面那个：crossfade / universal（带遮罩图 rule）/ mosaic / ripple / rotateswap），pre: [[命令, 参数…]…] }；没有台词但有「等待 + 画面变化」的也出一步（无 t）。
import {inflateSync} from 'node:zlib'
import { Psb } from './psb.mjs'

const LAYER_CLASSES = new Set(['stage', 'character', 'event', 'eventx', 'layer', 'evdanmen', 'evcutin'])
const KEEP_ACTIONS = new Set(['xpos', 'ypos', 'zpos', 'zoomx', 'zoomy', 'leveloffset', 'originx', 'originy', 'order', 'rotate', 'opacity'])
const MAX_STEPS = 60000

const looksName = (v) => typeof v === 'string' && /^[\p{L}\p{N}_\-.@（）]{1,100}$/u.test(v) && !/^(0x|@|\.)/.test(v)

// 图层 → 紧凑数组 [名字, 类别, 文件, options|null, posName|null, showmode, actions|null]
function compactLayer(entry) {
  if (!Array.isArray(entry) || entry.length < 3) return null
  const [name, cls, obj] = entry
  if (!LAYER_CLASSES.has(cls) || !obj || typeof obj !== 'object') return null
  const image = obj.redraw?.imageFile
  const file = typeof image?.file === 'string' ? image.file : null
  const options = image?.options && typeof image.options === 'object' ? image.options : null
  const actions = []
  for (const a of Array.isArray(obj.action) ? obj.action : []) if (Array.isArray(a) && typeof a[0] === 'string' && KEEP_ACTIONS.has(a[0]) && (typeof a[1] === 'number' || typeof a[1] === 'string')) actions.push([a[0], a[1]])
  return [name, cls, file, options, obj.redraw?.posName ?? null, obj.showmode ?? 0, actions.length ? actions : null]
}
function bgmOf(data) {
  for (const entry of data) {
    if (Array.isArray(entry) && entry[0] === 'bgm' && entry[2]?.replay) { const r = entry[2].replay; return [r.filename ?? null, r.state ?? null, r.volume ?? null, r.loop ?? null] }
  }
  return null
}
const layersOf = (data) => data.map(compactLayer).filter(Boolean)

// 一个剧本（PSB 解出来的根）→ { name, text, refs }
export function decodeKrkrScn(root, { arc = '' } = {}) {
  if (!root || typeof root.name !== 'string' || !Array.isArray(root.scenes)) throw new Error('不是 KiriKiri 场景脚本（没有 name / scenes）')
  const base = root.name.replace(/\.txt$/i, '')
  const refs = { img: new Set(), bgm: new Set(), voice: new Set() }
  let total = 0
  const scenes = []
  for (const scene of root.scenes) {
    const steps = []
    const texts = Array.isArray(scene.texts) ? scene.texts : []
    const lines = Array.isArray(scene.lines) ? scene.lines : []
    let snap = null   // 最近一次看到的环境快照（data）
    let lastKey = ''   // 上一步的图层 JSON（比较用）
    let pre = []
    let trans = null   // 最近一次 envupdate 里的转场 [方式, 毫秒, 遮罩]，下一步用掉
    const emitLayers = (data) => { const l = layersOf(data); for (const x of l) if (looksName(x[2])) refs.img.add(x[2].replace(/\.[A-Za-z0-9]+$/, '')); return l }
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      if (Array.isArray(ln) && typeof ln[0] === 'number' && ln[1] && typeof ln[1] === 'object' && Array.isArray(ln[1].data)) { snap = ln[1].data; continue }
      if (!Array.isArray(ln) || typeof ln[0] !== 'string') continue
      const cmd = ln[0]
      if (cmd === 'envupdate') {
        const at = ln.indexOf('trans')
        const t = at >= 0 ? ln[at + 1] : null
        if (t && typeof t === 'object' && typeof t.method === 'string' && t.method) trans = [t.method, Number(t.time) > 0 ? Number(t.time) : 0, typeof t.rule === 'string' ? t.rule : '']
        continue
      }
      if (cmd === 'startline') {
        const hasText = ln.includes('text') && ln[ln.indexOf('text') + 1] === 1
        if (!hasText) continue
        let n = null
        for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) if (typeof lines[j] === 'number') { n = lines[j]; break }
        const t = n === null ? null : texts[n - 1]
        if (!t) continue
        const data = Array.isArray(t[4]?.data) ? t[4].data : snap || []
        const layers = emitLayers(data)
        const bgm = bgmOf(data)
        if (bgm && looksName(bgm[0])) refs.bgm.add(bgm[0])
        const voiceInfo = Array.isArray(t[2]) ? t[2].find((x) => x && typeof x.voice === 'string') : null
        if (voiceInfo && looksName(voiceInfo.voice)) refs.voice.add(voiceInfo.voice)
        const text = (Array.isArray(t[1]) ? t[1].map((seg) => (typeof seg?.[1] === 'string' ? seg[1] : '')).join('') : '').replace(/\\n/g, '\n')
        const step = { t: text, ...(t[0] ? { n: t[0] } : {}), ...(voiceInfo ? { v: voiceInfo.voice } : {}), l: layers, ...(bgm ? { b: bgm } : {}), ...(trans ? { tr: trans } : {}), ...(pre.length ? { pre } : {}) }
        steps.push(step)
        lastKey = JSON.stringify(layers)
        pre = []
        trans = null
        if (++total > MAX_STEPS) throw new Error('步数超过上限')
        continue
      }
      if (cmd === 'wait') {
        const ms = Number(ln[ln.indexOf('time') + 1])
        // 没有台词的「等待 + 画面变了」：出一个无台词的步（黑屏 / 切背景 / 事件图之类）
        if (snap && Number.isFinite(ms)) {
          const layers = emitLayers(snap)
          const key = JSON.stringify(layers)
          if (key !== lastKey) { const bgm = bgmOf(snap); steps.push({ l: layers, ...(bgm ? { b: bgm } : {}), ...(trans ? { tr: trans } : {}), pre: [...pre, ['wait', ms]] }); lastKey = key; pre = []; trans = null; continue }
        }
        if (Number.isFinite(ms)) pre.push(['wait', ms])
        continue
      }
      if (cmd === 'playvoice') {
        const v = ln[ln.indexOf('voice') + 1]
        if (looksName(v)) { refs.voice.add(v); pre.push(['bgv', v, ln[ln.indexOf('loop') + 1] ?? 0]) }
        continue
      }
      if (cmd === 'stopvoice' || cmd === 'quake' || cmd === 'stopquake') pre.push([cmd, ln[ln.indexOf('time') + 1] ?? null])
    }
    scenes.push({ label: scene.label ?? '', title: scene.title ?? '', nexts: Array.isArray(scene.nexts) ? scene.nexts.map((n) => ({ storage: n?.storage ?? '', target: n?.target ?? '', type: n?.type ?? 0,...(n?.flag?{flag:n.flag}:{}),...(n?.eval?{eval:n.eval}:{}) })) : [], steps })
  }
  const out = { format: 'krkr-scn/1', arc, name: base, scenes }
  return { name: base, text: JSON.stringify(out), refs: { img: [...refs.img], bgm: [...refs.bgm], voice: [...refs.voice] } }
}

export function decodeKrkrScnBuffer(buffer, meta = {}) {
  if(buffer.toString('latin1',0,4)==='mdf\0'){const expected=buffer.readUInt32LE(4);if(expected>64*1024*1024)throw Error('MDF 剧情超过64MB');buffer=inflateSync(buffer.subarray(8),{maxOutputLength:64*1024*1024});if(buffer.length!==expected)throw Error('MDF 剧情长度不符')}
  return decodeKrkrScn(new Psb(buffer).root(), meta)
}
