// 适配器：Imys（Unity 6 / IL2CPP 手游的离线图库）的剧本。剧本在 content/bundles/scenarios/<类别>/<id>.jp.encrypted（AES + UnityFS，里面一个 TextAsset = 纯文本剧本），
// 由 containers.mjs（format: imys）解出来、展开成 script/<类别>/<id>.imys（{"format":"imys-adv/1","name","category","text"}）。id = imys::adv。
//
// 剧本语法（84 个真实样本 + 4 个 textdefine 核对过的全部命令）：
//   //…                         注释（//--章番号：/ //--タイトル：/ //--背景：… 只是给人看的）
//   BGDraw ("bg_avg_004");       背景（后面跟 Refresh (FADE | SUDDEN)）
//   BGMPlay (01,b1100,100); BGMStop (01,NORMAL);      音乐（bNNNN = raw/BGM/bgm_NNNN）
//   SEPlay (01,s0100,100); SEStop (…);                 音效（sNNNN = raw/SCENARIO_SE/sNNNN）
//   Voice ("amv001_0301_00010"[,说话人号]);            语音（紧挨着的下一句台词）
//   Tati (槽,角色,服装,表情,位置[-2 | +0 | +2]); ClrTati (槽); TatiEffect (槽,SWEAT | QUESTION | KIRAKIRA …)    立绘
//   TimeWait (毫秒,CLICK_ENABLE); FadeoutBlack / FadeinBlack (FADE); FadeoutWhite / FadeinWhite; ScreenEffect (QUAKE | FLASH_ONCE | CONCENTRATE …); WindowOFF; ChangeUI (R18 | COMMON); Fontsize (…)
//   说话人「台词」              对白；没有「」的行 = 旁白；<R 注音>汉字</R> = 注音
// 现在做了：文字（含注音 / 说话人 / 旁白）、背景名（资源索引里有同名图才出图）、音乐 / 音效 / 语音的名字（有对应资源才出声）、等待、黑 / 白转场；
// 立绘：Tati(槽,角色,衣装,表情号,位置) → res/tati/<角色+衣装>/<表情号>.png（服务端把图集里的身体 + 脸合成好）；表情号 1.. = default / smile / shy / ang / gag / option… 是按剧情上下文对的（01 平常、02 笑、03 害羞、04 生气、05 …），选项脸（06 起）没有对照。位置 = 水平偏移（猜的）。
// 没做：TatiEffect（气泡）、屏幕特效（记 stats.ignored）。
// 资源（背景 / 立绘 bundle、CRI 的 ACB+HCA 声音）的格式还没解，所以现在只出文字；见 README。
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'imys::adv'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',                 // containers 展开后的资源目录（虚拟索引；现在是空的）
  stage: [1920, 1080],
  imageExts: ['png', 'jpg', 'jpeg'],
  audioExts: ['ogg', 'wav', 'mp3'],
  wait: { enabled: true, max: 10 },
  tati: { enabled: true, stage: [1280, 720], spacing: 160 },   // Tati(槽,角色,衣装,表情,位置)：舞台 1280×720（背景 bundle 的原始大小）；位置 ±1 / ±2 = 水平偏移 spacing × 位置（像素，猜的）
  fadeSeconds: 0.5,
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"imys-adv\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 256))
export const explainSniff = () => '开头不是 {"format":"imys-adv/1"…（这个适配器吃 containers 从 Imys 的 .encrypted bundle 里解出来的剧本）'
export const contextFiles = () => []
export const contextDirs = (options) => [String(readOptions(options).resDir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')].filter(Boolean)
export const contextTextFilter = () => () => false
export const contextWalkLimit = 800000
export const contextSampleLimit = 0

export function prepare({ options, files, toResourcePath, resourceResolve, truncated }) {
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set((files || []).map(toRes))
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  return { opts: opt, resources, resolver, hasIndex: Boolean(files?.length), truncated: Boolean(truncated) }
}

// <R 注音>汉字</R> → ruby；别的 <…> 标记去掉
function segmentsOf(raw) {
  const src = String(raw ?? '')
  const out = []
  const ruby = /<R\s*([^<>]*)>([^<>]*)<\/R>/g
  let last = 0
  const plain = (s) => s.replace(/<\/?[A-Za-z][^<>]*>/g, '')
  for (let m = ruby.exec(src); m; m = ruby.exec(src)) {
    if (m.index > last) out.push({ text: plain(src.slice(last, m.index)) })
    out.push({ text: m[2], ruby: m[1].trim() })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ text: plain(src.slice(last)) })
  return out.filter((s) => s.text !== '')
}

const COMMAND = /^([A-Za-z_]\w*)\s*\((.*)\)\s*;?\s*$/
const argsOf = (raw) => {
  const out = []
  let cur = ''
  let quote = false
  for (const ch of raw) {
    if (ch === '"') quote = !quote
    else if (ch === ',' && !quote) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim() || out.length) out.push(cur.trim())
  return out.map((a) => a.replace(/^"|"$/g, ''))
}

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (data?.format !== 'imys-adv/1' || typeof data.text !== 'string') throw new Error('不是 imys-adv/1 剧本')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { lines: 0, messages: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, sounds: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, raw: {}, ignored: {}, unresolved: {}, links: {}, transitions: {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const find = (name, exts) => {
    if (!hasIndex || !name) return ''
    for (const ext of exts) { const hit = ctx.resolver.resolveByName?.(`${name}.${ext}`) || ctx.resolver.resolve(`${name}.${ext}`); if (hit) return hit }
    return ''
  }
  // 立绘：Tati(槽, 角色 3 位, 衣装 2 位, 表情号, 位置)。文件 = 角色 + 衣装（00101），衣装 00 找不到时试 01；表情号 → bundle 里的脸（default / smile / shy / ang / gag / option…，服务端按号合成）
  const exact = (rel) => { if (!hasIndex) return ''; return ctx.resolver.resolve(rel) || '' }
  stats.tati = { shown: 0, unresolved: 0 }
  const tati = (a) => {
    const [slot, char, costume, expr, pos] = a.map((x) => String(x || '').trim())
    const n = String(Math.max(1, Number(expr) || 1)).padStart(2, '0')
    let src = ''
    for (const id of [`${char}${costume}`, ...(Number(costume) === 0 ? [`${char}01`] : [])]) { src = exact(`tati/${id}/${n}.png`); if (src) break }
    if (!src) { stats.tati.unresolved += 1; if (hasIndex) count('unresolved', `tati:${char}${costume}`); return }
    stats.tati.shown += 1
    const dx = (Number(pos) || 0) * opt.tati.spacing
    emit({ op: 'stand', slot: `T${slot}`, stage: opt.tati.stage, parts: [{ src, x: dx, y: 0, scale: 1 }], fade: 0 })
  }
  const refer = (bucket, name, exts) => {
    stats[bucket].referenced += 1
    const src = find(name, exts)
    if (src) stats[bucket].resolved += 1; else { stats[bucket].unresolved += 1; if (hasIndex) count('unresolved', `${bucket}:${name}`) }
    return src
  }
  const steps = []
  let list = []
  let branch = null        // { var, value }：在 switch / case 里（Select 的选项）——里面的指令都带 when，没选这一支就整步不执行
  const emit = (command) => list.push(branch && !command.when ? { ...command, when: [{ var: branch.var, op: '==', value: branch.value }] } : command)
  const endStep = () => { if (!list.length) return; steps.push({ index: steps.length, commands: list }); list = [] }
  const endStepIfPending = () => { if (list.length) { emit({ op: 'text', segments: [] }); endStep() } }
  let bg = null            // { src } | null
  let pendingFade = 0
  let voice = ''
  const allLines = data.text.replace(/\r/g, '').split('\n')
  // case N: 的标签 = 它前面最近的「//--…」注释（「//--タッチ①結果」→「タッチ①」），没有就「選択 N+1」
  const caseLabel = (at, n) => {
    for (let j = at - 1; j >= Math.max(0, at - 4); j--) { const m = /^\s*\/\/--\s*(.+)$/.exec(allLines[j]); if (m) return m[1].replace(/結果\s*$/, '').trim() || `選択${n + 1}` }
    return `選択${n + 1}`
  }
  let selectVar = ''
  stats.branches = { selects: 0, cases: 0 }
  for (let at = 0; at < allLines.length; at++) {
    const rawLine = allLines[at]
    const line = rawLine.trim()
    if (!line || line.startsWith('//')) continue
    stats.lines += 1
    // Select n,…（体の触る場所を選ぶ 等）+ switch( %0 ) { case N: … break … }：選択肢 → 分岐（case の中の指令に when）
    const sel = /^Select\s+(\d+)\b/.exec(line)
    if (sel) {
      const count = Math.max(1, Math.min(8, Number(sel[1])))
      const labels = []
      for (let j = at + 1, depth = 0; j < allLines.length && labels.length < count; j++) {
        const m = /^\s*case\s+(\d+)\s*:/.exec(allLines[j])
        if (m && Number(m[1]) < count) labels[Number(m[1])] = caseLabel(j, Number(m[1]))
        if (/^\s*Select\b/.test(allLines[j])) break
      }
      endStep()   // 前面没发完的指令先落成一步
      const stepIndex = steps.length
      selectVar = `sel${stepIndex}`
      branch = null
      stats.branches.selects += 1
      emit({ op: 'speaker', segments: [] })
      emit({ op: 'choice', id: `${stepIndex}:1`, var: selectVar, options: Array.from({ length: count }, (_x, n) => ({ value: n + 1, segments: [{ text: labels[n] || `選択${n + 1}` }] })) })
      emit({ op: 'text', segments: [] })
      endStep()
      continue
    }
    if (/^switch\s*\(/.test(line) || line === '{' || line === '}' || /^InitializeBodyTouchItem\b/.test(line)) { if (!/^(switch|\{|\})/.test(line)) count('ignored', 'InitializeBodyTouchItem'); if (line === '}') branch = null; continue }
    const cs = /^case\s+(\d+)\s*:/.exec(line)
    if (cs) { branch = selectVar ? { var: selectVar, value: Number(cs[1]) + 1 } : null; stats.branches.cases += 1; continue }
    if (/^(break|default\s*:)/.test(line)) { if (/^break/.test(line)) { endStepIfPending(); branch = null } else branch = null; continue }
    const cmd = COMMAND.exec(line)
    if (cmd && /^[A-Z]/.test(cmd[1])) {
      const [, name, rest] = cmd
      const a = argsOf(rest)
      switch (name) {
        case 'BGDraw': { const src = refer('images', a[0], opt.imageExts); bg = src ? { src } : null; if (src) emit({ op: 'bg', src, fade: pendingFade || 0 }); else if (!hasIndex) emit({ op: 'bgoff', fade: 0 }); pendingFade = 0; break }
        case 'Refresh': pendingFade = /^FADE$/i.test(a[0] || '') ? opt.fadeSeconds : 0; count('transitions', a[0] || 'SUDDEN'); break
        case 'BGMPlay': { const m = /^b(\d+)$/i.exec(a[1] || ''); const src = refer('bgm', m ? `bgm_${m[1]}` : a[1], opt.audioExts); if (src) emit({ op: 'bgm', src }); break }
        case 'BGMStop': emit({ op: 'bgmStop' }); break
        case 'SEPlay': { const src = refer('sounds', a[1], opt.audioExts); if (src) emit({ op: 'se', src }); break }
        case 'Voice': { stats.voices.referenced += 1; voice = find(a[0], opt.audioExts); if (voice) stats.voices.resolved += 1; else { stats.voices.unresolved += 1; if (hasIndex) count('unresolved', `voices:${a[0]}`) } break }
        case 'Tati': { stats.stands += 1; if (opt.tati.enabled) tati(a); else count('ignored', 'Tati'); break }
        case 'ClrTati': if (opt.tati.enabled) { const slot = String(a[0] || '').trim(); if (slot) emit({ op: 'standOff', slot: `T${slot}` }); else emit({ op: 'standOff' }) } else count('ignored', 'ClrTati'); break
        case 'TimeWait': { if (opt.wait.enabled) { const seconds = Math.min(opt.wait.max, (Number(a[0]) || 0) / 1000); if (seconds > 0) emit({ op: 'wait', seconds }) } break }
        case 'FadeoutBlack': emit({ op: 'bg', color: [0, 0, 0], fade: opt.fadeSeconds }); break
        case 'FadeoutWhite': emit({ op: 'bg', color: [255, 255, 255], fade: opt.fadeSeconds }); break
        case 'FadeinBlack': case 'FadeinWhite': emit(bg ? { op: 'bg', src: bg.src, fade: opt.fadeSeconds } : { op: 'bgoff', fade: opt.fadeSeconds }); break
        default: count('ignored', name)
      }
      continue
    }
    // 台词 / 旁白
    const speech = /^([^「」]{1,24})「([\s\S]*)」$/.exec(line)
    const who = speech ? speech[1].trim() : ''
    const body = speech ? speech[2] : line
    emit({ op: 'speaker', segments: who ? [{ text: who }] : [] })
    if (voice) { emit({ op: 'voice', src: voice }); voice = '' }
    emit({ op: 'text', segments: segmentsOf(body) })
    stats.messages += 1
    endStep()
  }
  if (list.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  return { steps, stats }
}

export const imysAdvAdapter = { id: ADAPTER_ID, label: 'Imys（AES + UnityFS 里的纯文本剧本，经 containers 展开）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
