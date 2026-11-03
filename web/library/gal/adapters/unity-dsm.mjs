// 适配器：Unity「GameMaterial」系（Calcite『気になるあの娘はえろちゅーばー！』；game.id = unity::<游戏>）的剧情脚本。
// 输入：containers（format: dsm）把加密的 data.dsm 解密后按章节（*EpNNN / *chaN_ex / *chaN_end）切成的 KAG 风格文本，每段第一行 `;//@dsm {"id","next","labels"}`（id = 段名，next = 顺着读的下一段，labels = 引用到的别段标签 → 段名）。
// 标签（对照真实 data.dsm：32472 行、25 个场景；资源名全部对过 __listing.tsv）：
//   文字 = 直接写的行，[cpg] / [cpg1] 换页（一页可以有几行）；[OnName num="名"] 说话人（只管到这一页结束）；[pv f="Yume001] 语音（注意引号只有开头，没有结尾）→ voice/Yume001.ogg
//   [BG g="名" rule="转场"] 背景（bgimage/名.psm）；[Event g="ev_NN_x" …] 事件 CG（同在 bgimage，替换背景）；g="black" / "white" = 纯色；[FG f="名" f="序号" pos="L|C|R"]（写法 1：第一个 f = 名字；写法 2：g="名" f=序号）→ fgimage/<名>_a_<序号>.psm；
//   [FO layer="A"] = 淡出整个画面（立绘清掉）；[plbgm bg="名"] → sound/名.ogg，[stbgm] 停；[ps se=se001] → se/se001.ogg
//   [SQ] [link target="*标签"]选项文字 … [s] 选项；[jump target="*标签"]；[if exp="…"][jump …][endif]（只在满足条件的特殊路线才跳，那些路线单独成一段，不接在主线上）；[end] 结束
//   没处理：[wait]（转场等待）/ [t_move]（立绘动作）/ [lbox] / [stopse] / [eval]（变量；选项累计 Cha1flg 之类决定特殊路线）/ [move]
// 立绘位置（对照 Assembly-CSharp 的 Sprite2DTestScript.ShowFGImage）：图是 1920×1080 的整张画布；x = 画布中心 + {LL −750, L −420, C 0, R +420, RR +750} + system/StandPos 的修正（LX −50 …）；y 修正也来自 StandPos。
// 没验证（没有游戏截图对照）：上面的位置公式只对 1080 高的画布整图（真实样本都是）；BG 转场（rule）近似成淡入淡出；[cpg1] / [cpg cn=true] 的区别没查（都当换页）；换背景 / 事件 CG 时立绘一并清掉是推断（真实脚本里 4 处换背景时立绘还在）
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'unity::dsm'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  mediaDirs: ['GameMaterial/voice', 'GameMaterial/sound', 'GameMaterial/se'],
  stage: [1920, 1080],
  voiceDir: 'voice', bgmDir: 'sound', seDir: 'se',
  audioExts: ['ogg', 'wav', 'mp3'],
  standOffsets: { LL: [-750, 0], L: [-420, 0], C: [0, 0], R: [420, 0], RR: [750, 0] },   // 基准（引擎写死）
  standAdjust: { LL: [0, 0], L: [-50, 0], C: [0, 0], R: [50, 0], RR: [10, 0] },           // system/StandPos
  transitionFade: 0.5,
  speakerColors: {
    '衛太': '#7ea2ff', 'ゆめ': '#ffde00', '律': '#ff5e5e', '夕香': '#e180f2', 'ヒロイン4': '#ffb321', '酔': '#72fb4e', '*': '#d2d2d2',
  },
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*;\/\/@dsm\s*\{/
export const sniff = (text) => {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 8192)
  return HEAD.test(head)
}
export const explainSniff = () => '开头不是 ;//@dsm {…}（这个适配器吃 containers 从 data.dsm 解密、按章节切好的脚本，不是加密的原文件）'
export const contextFiles = () => []
const cleanDir = (dir) => String(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
export const contextDirs = (options) => { const opt = readOptions(options); return [opt.resDir, ...opt.mediaDirs].map(cleanDir).filter(Boolean) }
export const contextTextFilter = () => () => false
export const contextWalkLimit = 800000
export const contextSampleLimit = 0

export function prepare({ options, files, toResourcePath, resourceResolve, truncated }) {
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  for (const rel of files || []) resources.add(toRes(rel))
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  return { opts: opt, resources, resolver, hasIndex: Boolean(files?.length), truncated: Boolean(truncated) }
}

// ---------- 词法：行 → 项 ----------
const stripQuote = (v) => String(v ?? '').replace(/^["“”]+|["“”]+$/g, '')
// 属性：名=值（值可以带 " 或 “ ” 引号、可以没有结尾引号、可以重复——重复的名字都留着）
export function parseAttrs(src) {
  const attrs = []
  const re = /([A-Za-z_]\w*)\s*=\s*(?:["“”]([^"“”]*)["“”]?|([^\s\]"“”]+))/g   // 真实脚本里有 g=“名" 这种左右引号不一致的写法，还有只有开头引号的 f="Yume001
  for (const m of String(src).matchAll(re)) attrs.push([m[1], m[2] ?? m[3] ?? ''])
  return attrs
}
const attrOf = (attrs, name) => { const hit = attrs.find(([k]) => k.toLowerCase() === name); return hit ? stripQuote(hit[1]) : '' }
const attrAll = (attrs, name) => attrs.filter(([k]) => k.toLowerCase() === name).map(([, v]) => stripQuote(v))

export function tokenize(text) {
  const items = []
  const labels = new Map()
  let header = null
  for (const raw of String(text).replace(/^﻿/, '').split(/\r\n?|\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith(';')) {
      const m = /^;\/\/@dsm\s*(\{.*\})\s*$/.exec(line)
      if (m && !header) { try { header = JSON.parse(m[1]) } catch { header = null } }
      continue
    }
    if (line.startsWith('*')) {
      const name = line.slice(1).split(/[\s|]/)[0]
      if (name) { labels.set(name, items.length); items.push({ t: 'label', name }) }
      continue
    }
    if (line.startsWith('[')) {
      // 一行可以有几个标签；标签之外的字当文字
      let rest = line
      while (rest) {
        const m = /^\[([A-Za-z_]\w*)([^\]]*)\]/.exec(rest)
        if (m) { items.push({ t: 'tag', name: m[1].toLowerCase(), attrs: parseAttrs(m[2]), raw: m[0] }); rest = rest.slice(m[0].length).trimStart(); continue }
        const next = rest.indexOf('[')
        const txt = next < 0 ? rest : rest.slice(0, next)
        if (txt.trim()) items.push({ t: 'text', text: txt.trim() })
        rest = next < 0 ? '' : rest.slice(next)
        if (next === 0 && !m) { items.push({ t: 'text', text: rest[0] }); rest = rest.slice(1) }
      }
      continue
    }
    items.push({ t: 'text', text: line })
  }
  return { items, labels, header: header || { id: '', next: '', labels: {} } }
}

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  const { items, labels, header } = tokenize(text)
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { items: items.length, messages: 0, choices: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, stands: 0, ignored: {}, unresolved: {}, links: {}, commands: 0 }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const [stageW, stageH] = opt.stage
  const find = (rel, exts) => {
    if (!hasIndex) return ''
    for (const ext of exts) { const hit = ctx.resolver.resolve(`${rel}.${ext}`); if (hit) return hit }
    return ''
  }
  const imageOf = (name) => {
    stats.images.referenced += 1
    const src = find(name, ['png'])
    if (src) stats.images.resolved += 1; else { stats.images.unresolved += 1; if (hasIndex) count('unresolved', `image:${name}`) }
    return src
  }
  const audioOf = (bucket, dir, name) => {
    stats[bucket].referenced += 1
    const src = find(`${dir}/${name}`, opt.audioExts)
    if (src) stats[bucket].resolved += 1; else { stats[bucket].unresolved += 1; if (hasIndex) count('unresolved', `${bucket === 'voices' ? 'voice' : bucket}:${dir}/${name}`) }
    return src
  }
  const colorOf = (name) => opt.speakerColors[name] || opt.speakerColors['*'] || ''

  const steps = []
  let commands = []
  let guard = []
  let nextScript = ''
  const put = (command) => commands.push(guard.length ? { ...command, when: guard } : command)
  const endStep = () => { steps.push({ index: steps.length, commands }); commands = [] }

  // 画面状态：背景（图 / 纯色）+ L / C / R 各一个立绘槽；变了才发
  let bgState = null            // { src, fade? } | { color } | null
  let stands = new Map()        // 位置 → src
  let shown = { bg: '', stands: new Map() }
  let dirty = false
  const standPart = (pos, src) => {
    const base = opt.standOffsets[pos] || [0, 0]
    const adj = opt.standAdjust[pos] || [0, 0]
    return { src, x: base[0] + adj[0], y: base[1] + adj[1], scale: 1 }
  }
  function commit() {
    if (!dirty) return
    dirty = false
    const sig = bgState ? JSON.stringify(bgState) : ''
    if (sig !== shown.bg) { if (bgState) { const { fade, ...rest } = bgState; put({ op: 'bg', ...rest, fade: fade || 0 }) } else if (shown.bg) put({ op: 'bgoff' }); shown.bg = sig }
    for (const [pos, src] of stands) {
      if (shown.stands.get(pos) === src) continue
      put({ op: 'stand', slot: pos, parts: [standPart(pos, src)], stage: [stageW, stageH], ...(shown.stands.has(pos) ? {} : { fade: 0.25 }) })
      shown.stands.set(pos, src)
      stats.stands += 1
    }
    for (const pos of [...shown.stands.keys()]) if (!stands.has(pos)) { put({ op: 'standOff', slot: pos }); shown.stands.delete(pos) }
  }
  const resetShown = () => { shown = { bg: '', stands: new Map() }; dirty = true }

  // 这一页的台词（换页标签时发出去）
  let page = { lines: [], speaker: '', voice: '' }
  const flushPage = (force = false) => {
    if (!page.lines.length && !force) return
    commit()
    stats.messages += 1
    const speaker = page.speaker
    put({ op: 'speaker', segments: speaker ? [{ text: speaker, ...(colorOf(speaker) ? { style: { color: colorOf(speaker) } } : {}) }] : [] })
    if (page.voice) { const src = audioOf('voices', opt.voiceDir, page.voice); if (src) put({ op: 'voice', src }) }
    put({ op: 'text', segments: page.lines.length ? [{ text: page.lines.join('\n') }] : [] })
    endStep()
    page = { lines: [], speaker: '', voice: '' }
  }
  const flushIfText = () => { if (page.lines.length) flushPage() }

  const setBg = (name, withTransition) => {
    flushIfText()
    stands = new Map()
    if (/^(black|white)$/i.test(name)) bgState = { color: /^white$/i.test(name) ? [255, 255, 255] : [0, 0, 0], ...(withTransition ? { fade: opt.transitionFade } : {}) }
    else { const src = imageOf(name); bgState = src ? { src, ...(withTransition ? { fade: opt.transitionFade } : {}) } : bgState }
    dirty = true
  }

  // 一个分支 / 主线从 i 往下读：返回 { kind: 'end' | 'jump' | 'eof' | 'goto', index? }
  const visited = new Set()
  function run(start, depth) {
    for (let i = start; i < items.length; i += 1) {
      const it = items[i]
      if (it.t === 'label') continue
      if (it.t === 'text') { page.lines.push(it.text); continue }
      const a = it.attrs
      switch (it.name) {
        case 'cpg': case 'cpg1': flushPage(); break
        case 'onname': page.speaker = attrOf(a, 'num'); break
        case 'pv': page.voice = attrOf(a, 'f'); break
        case 'bg': setBg(attrOf(a, 'g') || attrAll(a, 'f')[0] || '', Boolean(attrOf(a, 'rule'))); break
        case 'event': setBg(attrOf(a, 'g'), false); break
        case 'fg': {
          flushIfText()
          const fs = attrAll(a, 'f')
          const name = attrOf(a, 'g') || fs[0]
          const variant = attrOf(a, 'g') ? fs[fs.length - 1] : fs.length > 1 ? fs[fs.length - 1] : ''
          const pos = (attrOf(a, 'pos') || 'C').toUpperCase()
          if (!name || !variant) { count('ignored', 'fg-incomplete'); break }
          const src = imageOf(`${name}_a_${variant}`)
          if (src) { stands.set(pos, src); dirty = true }
          break
        }
        case 'fo': flushIfText(); if (stands.size) { stands = new Map(); dirty = true } break
        case 'plbgm': { flushIfText(); commit(); const src = audioOf('bgm', opt.bgmDir, attrOf(a, 'bg')); if (src) put({ op: 'bgm', src }); break }
        case 'stbgm': flushIfText(); commit(); put({ op: 'bgmStop' }); break
        case 'ps': {
          const se = attrOf(a, 'se') || attrOf(a, 'f')
          if (!se) break
          flushIfText(); commit()
          const src = find(`${opt.seDir}/${se}`, opt.audioExts) || (/^\d+$/.test(se) ? find(`${opt.seDir}/se${se}`, opt.audioExts) : '')
          if (src) put({ op: 'se', src }); else count('ignored', 'se-unresolved')
          break
        }
        case 'sq': {
          flushIfText(); commit()
          // 选项：[link target] + 紧跟的文字，到 [s]
          const options = []
          let j = i + 1
          for (; j < items.length; j += 1) {
            const x = items[j]
            if (x.t === 'tag' && x.name === 's') break
            if (x.t === 'tag' && x.name === 'link') options.push({ target: stripQuote(attrOf(x.attrs, 'target')).replace(/^\*/, ''), lines: [] })
            else if (x.t === 'text' && options.length) options[options.length - 1].lines.push(x.text)
          }
          return choose(options, depth)
        }
        case 'jump': {
          const target = attrOf(a, 'target').replace(/^\*/, '')
          flushIfText()
          if (labels.has(target)) {
            if (depth > 0) return { kind: 'jump', index: labels.get(target), target }
            if (visited.has(target)) { count('ignored', 'jump-loop'); return { kind: 'end' } }
            visited.add(target)
            i = labels.get(target) - 1
            break
          }
          const script = header.labels?.[target] || ''
          count('links', `goto:${target}${script ? `→${script}` : ''}`)
          if (!script) return { kind: 'end' }
          if (guard.length) { commit(); put({ op: 'goto', script }); endStepIfCommands() } else nextScript = script
          return { kind: 'goto' }
        }
        case 'if': {
          // [if …] … [endif]：里面只有 jump = 条件跳转（特殊路线），不跟；别的内容当没有条件照读
          let j = i + 1
          let hasJump = false
          for (; j < items.length; j += 1) { const x = items[j]; if (x.t === 'tag' && x.name === 'endif') break; if (x.t === 'tag' && x.name === 'jump') hasJump = true }
          if (hasJump) { count('links', `if-jump:${attrOf(a, 'exp').replace(/\s+/g, ' ').slice(0, 40)}`); i = j }
          break
        }
        case 'endif': break
        case 'end': flushIfText(); return { kind: 'end' }
        case 's': return { kind: 'end' }
        case 'wait': case 't_move': case 'lbox': case 'onmes': case 'stopse': case 'eval': case 'move': case 'link': case 'scene': case 'sceneend': case 'endpartial': count('ignored', it.name); break
        default: count('ignored', `tag:${it.name}`)
      }
    }
    flushIfText()
    return { kind: 'eof' }
  }
  function endStepIfCommands() { if (commands.length) endStep() }

  function choose(options, depth) {
    stats.choices += 1
    const stepIndex = steps.length
    const variable = `sel${stepIndex}`
    put({ op: 'speaker', segments: [] })
    put({ op: 'text', segments: [] })
    put({ op: 'choice', id: `${stepIndex}:0`, var: variable, options: options.map((o, n) => ({ value: n + 1, segments: [{ text: o.lines.join(' ') }] })) })
    endStep()
    const outer = guard
    const saved = { bgState, stands: new Map(stands) }
    const merges = []
    let ended = 0
    for (const [n, option] of options.entries()) {
      bgState = saved.bgState; stands = new Map(saved.stands)
      guard = [...outer, { var: variable, op: '==', value: n + 1 }]
      resetShown()
      const at = labels.get(option.target)
      if (at === undefined) {
        const script = header.labels?.[option.target] || ''
        count('links', `choice:${option.target}${script ? `→${script}` : ''}`)
        if (script) { put({ op: 'goto', script }); endStep() }
        continue
      }
      const r = run(at, depth + 1)
      commit()
      if (r.kind === 'jump') merges.push(r.index); else ended += 1
      if (commands.length) { put({ op: 'text', segments: [] }); endStep() }
    }
    guard = outer
    bgState = saved.bgState; stands = new Map(saved.stands)
    resetShown()
    if (merges.length && merges.every((m) => m === merges[0])) {
      if (ended) count('ignored', 'mixed-branches')
      if (depth > 0) return { kind: 'jump', index: merges[0] }
      return run(merges[0], depth)
    }
    if (merges.length) count('ignored', 'unmerged-branches')
    return { kind: 'end' }
  }

  const first = run(0, 0)
  commit()
  if (page.lines.length) flushPage()
  if (first.kind === 'eof' && header.next) nextScript = header.next
  if (commands.length || !steps.length) { put({ op: 'text', segments: [] }); endStep() }
  stats.commands = steps.reduce((n, step) => n + step.commands.length, 0)
  return { steps, stats, ...(nextScript ? { next: { script: nextScript } } : {}) }
}

export const unityDsmAdapter = { id: ADAPTER_ID, label: 'Unity GameMaterial（data.dsm，经 containers 解密切章节）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
