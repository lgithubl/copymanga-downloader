// 适配器：MahotanArchive（まほろば妖女奇譚 アーカイブ，Tauri 图鉴 / 剧情查看器；game.id = mahotan::<游戏>）的剧情 JSON（.mhp = ZIP 里的 data/scripts/**.json，由 containers 展开，format: mhp）→ 规范场景（gal-scene/1）。
// 两种文件（真实 data mhp：scene 465 个 + stories 536 个，全部带资源表）：
//   scene/{general,adult}/<id>.json   { sceneId, commands: [...], storyAssets: {...}, contentRating? }
//   stories/{main,events,prologue,kizuna,gvg,isekai}/<id>.json   { id, version, frames, commands, playback: { commands, storyAssets }, terminalState, ... }（commands 和 playback.commands 一样；frames 是播放器预先算好的逐句状态，这里不用）
// 指令（cmd）：text（name / content / voice）、background（content = bg_N，title = 地点名）、bgm、chara_show / chara_hide、transition_in / transition_out、emotion / aura_show / aura_remove / chara_jump / chara_shake / chara_blink / eye（特效，没做）
// 资源表 storyAssets：visuals（角色 id → 立绘 / CG 图）、voices（语音 id → media/voices/…mp3）、backgrounds（bg_N → images/backgrounds/background-NNN.jpg，**每个脚本自己一张表**，不是按 N 直接对应）、bgm、metadata（立绘：{ kind: 'standing', bounds: {left, top, right, bottom, sourceWidth, sourceHeight} } / { kind: 'cg' }）
// 画面（对照 exe 里提出来的前端 index-*.js：故事播放器 Qd / Su / Q8 + CSS）：同时只有一个角色；standing = 头对齐（mahotan-heads.json 里有头框的立绘：头框长边 = 舞台高度的 20%，头框中心在舞台高度的 25% 处、水平居中；没有头框的退回「bounds 撑满舞台高度、脚对齐底边」）；cg = 铺满舞台（contain）；
//   transition_in = 盖上黑 2 秒、transition_out = 从黑里揭开 1 秒（脚本顺序 in → 换背景 / 立绘 → out；content = White 是白色，这里也用黑）；文字：去掉换行连起来（日文不加空格）；%player_name 在非玩家说话时 = 称呼（主様），玩家 / 旁白说话时 = 名字（主人公），%player_nameさん 按称呼是否已经以さん / 様结尾处理（和前端 $s / d0 一样）
// 没验证（没有游戏截图对照）：立绘位置只对着前端公式算，没有对过真实画面；非故事（scene）模式的立绘容器按和故事模式一样处理；特效（emotion / aura / jump / shake / blink）没做；chara_blink 自带的台词在前端也没用到，这里也不出
import { readFileSync } from 'node:fs'
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'mahotan::json'
export const DEFAULT_OPTIONS = {
  resDir: 'arc/res',
  stage: [1920, 1080],
  protagonistName: '主人公',
  protagonistAddress: '主様',
  headFraction: 0.2,       // 头框长边 / 舞台高度（前端 hH）
  headCenterY: 0.25,       // 头框中心的高度 / 舞台高度（前端 mH）
  transitionIn: 2,         // transition_in：盖上黑的秒数
  transitionOut: 1,        // transition_out：从黑里揭开的秒数
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

// 三种开头：scene（general）{"sceneId":…；stories {"id":…,"version":…,"frames":…；scene（adult）{"commands":[{…"cmd":…（sceneId 在后面）
const HEAD_KNOWN = /^\s*\{\s*(?:"sceneId"\s*:|"id"\s*:\s*"[^"]*"\s*,\s*"version"\s*:\s*"[^"]*"\s*,\s*"frames"\s*:\s*\[)/
const HEAD_COMMANDS = /^\s*\{\s*"commands"\s*:\s*\[\s*\{[^}]*"cmd"\s*:/
export const sniff = (text) => {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 1024)
  return HEAD_KNOWN.test(head) || HEAD_COMMANDS.test(head)
}
export const explainSniff = () => '开头不是 {"sceneId":… / {"commands":[{… / {"id":…,"version":…,"frames":…（这个适配器吃 MahotanArchive 的 data/scripts/**.json）'
export const contextFiles = () => []
export const contextDirs = (options) => { const opt = readOptions(options); return [opt.resDir].map((dir) => String(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean) }
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

// 头框表（前端 By / gH 的数据，scripts/dev/extract-mahotan-heads.mjs 提的）：By 带源图尺寸（尺寸对得上才用），heads 只按路径
let headTable = null
function heads() {
  if (!headTable) {
    try { headTable = JSON.parse(readFileSync(new URL('./mahotan-heads.json', import.meta.url), 'utf8')) } catch { headTable = { by: {}, heads: {} } }
  }
  return headTable
}
export function headBoxOf(asset, bounds) {
  const table = heads()
  const by = table.by?.[asset]
  if (by) return !bounds || (bounds.sourceWidth === by.sourceWidth && bounds.sourceHeight === by.sourceHeight) ? by.box : null
  return table.heads?.[asset] || null
}
// 立绘 → { x, y, scale }（x / y = 原图中心相对舞台中心的偏移，舞台像素、y 向下为正）
export function standingPart(asset, bounds, opt) {
  const H = opt.stage[1]
  const sw = bounds?.sourceWidth || 2034
  const sh = bounds?.sourceHeight || 2034
  const head = headBoxOf(asset, bounds)
  if (head) {
    const size = Math.max(head[2] - head[0], head[3] - head[1])
    if (size > 0) {
      const scale = (H * opt.headFraction) / size
      const cx = (head[0] + head[2]) / 2
      const cy = (head[1] + head[3]) / 2
      return { x: Math.round((sw / 2 - cx) * scale), y: Math.round(H * opt.headCenterY - cy * scale + (sh * scale) / 2 - H / 2), scale: Number(scale.toFixed(5)) }
    }
  }
  if (bounds && bounds.bottom > bounds.top && bounds.right > bounds.left) {
    const scale = H / (bounds.bottom - bounds.top)
    const cx = (bounds.left + bounds.right) / 2
    return { x: Math.round((sw / 2 - cx) * scale), y: Math.round(H - bounds.bottom * scale + (sh * scale) / 2 - H / 2), scale: Number(scale.toFixed(5)) }
  }
  const scale = H / sh
  return { x: 0, y: 0, scale: Number(scale.toFixed(5)) }
}

// 前端 $s / d0：%player_name 的替换。$s(text, value)：%play_name → %player_name；%player_nameさん → value（已经以さん / 様结尾就不再加さん）；%player_name → value。
//   value 怎么选（d0）：说话人名非空、且里面没有 %player_name（= 别人在说话）→ 用称呼（主様）；否则（旁白 / 玩家自己）→ 名字（主人公）。说话人名本身一律用名字
const subst = (text, value) => {
  const honorific = value.endsWith('さん') || value.endsWith('様') ? value : `${value}さん`
  return String(text ?? '').replaceAll('%play_name', '%player_name').replaceAll('%player_nameさん', honorific).replaceAll('%player_name', value)
}
export const substituteName = (name, opt) => subst(name, opt.protagonistName)
export function substitute(text, speaker, opt) {
  const other = String(speaker || '').trim() && !String(speaker).includes('%player_name')
  return subst(text, other ? opt.protagonistAddress : opt.protagonistName)
}
const joinLines = (text) => String(text).split(/\r?\n/).map((line) => line.trim()).join('')

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  const commands = Array.isArray(data?.commands) ? data.commands : Array.isArray(data?.playback?.commands) ? data.playback.commands : null
  if (!commands) throw new Error('不是 MahotanArchive 的剧情 JSON（没有 commands）')
  const assets = data.storyAssets || data.playback?.storyAssets || {}
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { commands: commands.length, messages: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, ignored: {}, unresolved: {} }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const [stageW, stageH] = opt.stage
  const find = (rel) => (hasIndex && rel ? ctx.resolver.resolve(rel) || '' : '')
  const refer = (bucket, rel) => {
    if (!rel) return ''
    stats[bucket].referenced += 1
    const src = find(rel)
    if (src) stats[bucket].resolved += 1; else { stats[bucket].unresolved += 1; if (hasIndex) count('unresolved', `${bucket === 'voices' ? 'voice' : bucket === 'bgm' ? 'bgm' : 'image'}:${rel}`) }
    return src
  }

  const steps = []
  let list = []
  const emit = (command) => list.push(command)
  const endStep = () => { steps.push({ index: steps.length, commands: list }); list = [] }

  let bgSrc = ''
  let visual = null          // { kind: 'standing' | 'cg', src, asset, bounds }
  let bgmAsset = ''
  let shown = { bg: '', visual: '', bgm: '' }
  let dirty = false
  function commit() {
    if (!dirty) return
    dirty = false
    if (bgSrc !== shown.bg) { if (bgSrc) emit({ op: 'bg', src: bgSrc, fade: 0 }); else if (shown.bg) emit({ op: 'bgoff' }); shown.bg = bgSrc }
    const sig = visual ? `${visual.kind}|${visual.src}` : ''
    if (sig !== shown.visual) {
      if (visual?.kind === 'standing') {
        emit({ op: 'overlayOff', slot: 'cg' })
        emit({ op: 'stand', slot: 'chara', parts: [{ src: visual.src, ...standingPart(visual.asset, visual.bounds, opt) }], stage: [stageW, stageH] })
      } else if (visual?.kind === 'cg') {
        emit({ op: 'standOff', slot: 'chara' })
        emit({ op: 'overlay', slot: 'cg', src: visual.src, x: 0, y: 0, fit: 'contain', stage: [stageW, stageH] })
      } else { emit({ op: 'standOff', slot: 'chara' }); emit({ op: 'overlayOff', slot: 'cg' }) }
      shown.visual = sig
    }
  }

  for (const cmd of commands) {
    switch (cmd.cmd) {
      case 'background': {
        const asset = assets.backgrounds?.[cmd.content]
        if (asset) { const src = refer('images', asset); if (src) { bgSrc = src; dirty = true } } else if (cmd.content) { bgSrc = ''; dirty = true; count('ignored', 'background-no-image') }   // 资源表里这个 bg_N 是 null（没有图）：前端也不画背景
        break
      }
      case 'bgm': {
        const asset = assets.bgm?.[cmd.content]
        if (asset === bgmAsset) break
        bgmAsset = asset || ''
        commit()
        if (!asset) emit({ op: 'bgmStop' })
        else { const src = refer('bgm', asset); if (src) emit({ op: 'bgm', src }) }
        break
      }
      case 'chara_show': {
        const asset = assets.visuals?.[cmd.content]
        if (!asset) { visual = null; dirty = true; count('ignored', 'chara_show-unmapped'); break }
        const info = assets.metadata?.[cmd.content] || {}
        const src = refer('images', asset)
        visual = src ? { kind: info.kind === 'cg' ? 'cg' : 'standing', src, asset, bounds: info.bounds || null } : null
        dirty = true
        break
      }
      case 'chara_hide': visual = null; dirty = true; break
      case 'transition_in': commit(); emit({ op: 'fade', to: 'black', seconds: opt.transitionIn }); break    // 前端 Ui(色, 2000, true)：盖上黑（2 秒）
      case 'transition_out': commit(); emit({ op: 'fade', to: 'clear', seconds: opt.transitionOut }); break   // Ui(色, 1000, false)：从黑里揭开（1 秒）；脚本顺序是 in → 换背景 / 立绘 → out
      case 'text': {
        commit()
        stats.messages += 1
        const speaker = substituteName(cmd.name, opt).trim()
        emit({ op: 'speaker', segments: speaker ? [{ text: speaker }] : [] })
        const voiceAsset = cmd.voice ? assets.voices?.[cmd.voice] : ''
        if (voiceAsset) { const src = refer('voices', voiceAsset); if (src) emit({ op: 'voice', src }) }
        emit({ op: 'text', segments: [{ text: joinLines(substitute(cmd.content, cmd.name, opt)) }] })
        endStep()
        break
      }
      default: count('ignored', cmd.cmd || '?')
    }
  }
  commit()
  if (list.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  return { steps, stats }
}

export const mahotanJsonAdapter = { id: ADAPTER_ID, label: 'MahotanArchive（data/scripts JSON，经 containers 展开）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
