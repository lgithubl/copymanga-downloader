// 适配器：ArcRecord_D（幻想天街 Kuusoutengai；game.id = arcrecord::<游戏>）的剧情（Dialog.txt 里的一段 drama，由 containers 展开成 arcrecord-dialog/1 JSON，format: arcdrama）→ 规范场景（gal-scene/1）。
// 列（对照私有仓库 arcrecord-d 的反编译 DialogData + 真实 Dialog.txt：44321 行、1719 段）：
//   Speaker / Dialog / Scene = T_ 开头的键 → Text/<语言>.txt（展开时按语言带进 JSON，选项 language 选，默认 JPN）；Speaker = 'player' 是主角（选项 playerName）；<br> 换行；<color=#…> 取颜色，<size=…> 去掉；{0} = 主角名
//   DialogBGPerfab（BG/<名>）背景：BG/<名>.png；没有 png 的（预制体目录 BG/<名>/<名>.fbx）找目录里的 png；BG/BG_Black = 黑；CG/… 的 Spine 场景暂时没做
//   Music（Sound/BGM/<名>）→ Sound/BGM/<名>.wav，Blank = 停；Sound（Sound/Dialog/<名>）音效 → .wav（Effect_Dialog 是每句台词都有的默认「噗」声，不放）；TalkSound（Hero/H0xx/Sound/<名>）角色语音 → .wav
//   Role1-3 / RoleMotion / RoleEffects（Hero/H0xx/H0xx_Dialog 预制体 = Spine 角色）没做：预制体里的位置 / 动画映射不在导出资源里（只有 fbx 网格），见 README
// 没验证（没有游戏截图对照）：BG 按图片原样铺（预制体的缩放 / 位置不知道）；音效 / 语音是在这一行开始时放，实际时机不详
import { createIndexResolver } from '../resolve.mjs'
import { createOptionsReader } from './options-merge.mjs'

export const ADAPTER_ID = 'arcrecord::dialog'
export const DEFAULT_OPTIONS = {
  resDir: 'Game',
  language: 'JPN',          // JPN / CHS / CHT / ENG（展开时带了哪几种看容器；没有就退回 JPN / 第一个有的）
  playerName: '主人公',
  audioExts: ['wav', 'ogg', 'mp3'],
  imageExts: ['png', 'jpg', 'jpeg'],
  skipSounds: ['Sound/Dialog/Effect_Dialog'],   // 不放的音效（每句都有的默认声）
  stopMusic: ['Sound/BGM/Blank'],
}
const readOptions = createOptionsReader(DEFAULT_OPTIONS)

const HEAD = /^\s*\{\s*"format"\s*:\s*"arcrecord-dialog\/1"/
export const sniff = (text) => HEAD.test(String(text || '').replace(/^﻿/, '').slice(0, 256))
export const explainSniff = () => '开头不是 {"format":"arcrecord-dialog/1"…（这个适配器吃 containers 从 StaticData/Dialog.txt 切出来的剧情，不是原始表）'
export const contextFiles = () => []
export const contextDirs = (options) => { const opt = readOptions(options); return [String(opt.resDir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')].filter(Boolean) }
export const contextTextFilter = () => () => false
export const contextWalkLimit = 800000
export const contextSampleLimit = 0

export function prepare({ options, files, toResourcePath, resourceResolve, truncated }) {
  const opt = readOptions(options)
  const toRes = toResourcePath || ((rel) => rel)
  const resources = new Set()
  const dirImages = new Map()   // 小写目录 → 目录里第一张图（预制体目录里的贴图）
  for (const rel of files || []) {
    const res = toRes(rel)
    resources.add(res)
    const m = /^(.*)\/[^/]+\.(?:png|jpe?g)$/i.exec(res)
    if (m && !dirImages.has(m[1].toLowerCase())) dirImages.set(m[1].toLowerCase(), res)
  }
  const resolver = createIndexResolver({ index: resources, cfg: { ...(resourceResolve || {}), caseInsensitive: true } })
  return { opts: opt, resources, resolver, dirImages, hasIndex: Boolean(files?.length), truncated: Boolean(truncated) }
}

// <br> 换行；<color=#rrggbb>…</color> → 颜色；别的标签（<size=60> / </size>）去掉；{0} = 主角名
export function markupSegments(raw, playerName = '') {
  const src = String(raw ?? '').replaceAll('{0}', playerName).replace(/<br\s*\/?>/gi, '\n')
  const segments = []
  let color = ''
  let buf = ''
  const flush = () => { if (buf) { segments.push({ text: buf, ...(color ? { style: { color } } : {}) }); buf = '' } }
  const re = /<(\/?)(color|size|b|i)(?:=([^>]*))?>/gi
  let last = 0
  for (const m of src.matchAll(re)) {
    buf += src.slice(last, m.index)
    last = m.index + m[0].length
    if (m[2].toLowerCase() === 'color') { flush(); color = m[1] ? '' : /^#[0-9a-f]{3,8}$/i.test(m[3] || '') ? m[3] : '' }
  }
  buf += src.slice(last)
  flush()
  return segments
}

export function parse(text, ctx = null, meta = {}) {
  const opt = ctx?.opts || readOptions(meta?.options)
  let data
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch { throw new Error('不是有效的 JSON') }
  if (data?.format !== 'arcrecord-dialog/1' || !Array.isArray(data.rows)) throw new Error('不是 arcrecord-dialog/1 剧情')
  const hasIndex = Boolean(ctx?.hasIndex)
  const stats = { rows: data.rows.length, messages: 0, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, images: { referenced: 0, resolved: 0, unresolved: 0 }, sounds: { referenced: 0, resolved: 0, unresolved: 0 }, ignored: {}, unresolved: {}, language: '' }
  const count = (bucket, key) => { stats[bucket][key] = (stats[bucket][key] || 0) + 1 }
  const langs = Object.keys(data.text || {})
  const lang = langs.includes(opt.language) ? opt.language : langs.includes('JPN') ? 'JPN' : langs[0] || ''
  stats.language = lang
  const table = data.text?.[lang] || {}
  const find = (rel, exts) => {
    if (!hasIndex || !rel) return ''
    for (const ext of exts) { const hit = ctx.resolver.resolve(`${rel}.${ext}`); if (hit) return hit }
    return ''
  }
  const refer = (bucket, rel, exts) => {
    stats[bucket].referenced += 1
    const src = find(rel, exts)
    if (src) stats[bucket].resolved += 1; else { stats[bucket].unresolved += 1; if (hasIndex) count('unresolved', `${bucket}:${rel}`) }
    return src
  }
  const steps = []
  let list = []
  const emit = (command) => list.push(command)
  const endStep = () => { steps.push({ index: steps.length, commands: list }); list = [] }
  let bg = ''
  let music = ''
  for (const row of data.rows) {
    const bgName = row.DialogBGPerfab
    if (bgName && bgName !== 'no' && bgName !== bg) {
      bg = bgName
      if (/^BG\/BG_Black$/i.test(bgName)) emit({ op: 'bg', color: [0, 0, 0], fade: 0 })
      else if (/^BG\//i.test(bgName)) {
        let src = find(bgName, opt.imageExts)
        if (!src && hasIndex) src = ctx.dirImages.get(bgName.toLowerCase()) || ''
        stats.images.referenced += 1
        if (src) { stats.images.resolved += 1; emit({ op: 'bg', src, fade: 0 }) } else { stats.images.unresolved += 1; if (hasIndex) count('unresolved', `image:${bgName}`) }
      } else count('ignored', `bg:${bgName.split('/')[0]}`)   // CG/… 的 Spine 场景
    }
    const musicName = row.Music
    if (musicName && musicName !== 'no' && musicName !== music) {
      music = musicName
      if (opt.stopMusic.includes(musicName)) emit({ op: 'bgmStop' })
      else { const src = refer('bgm', musicName, opt.audioExts); if (src) emit({ op: 'bgm', src }) }
    }
    const soundName = row.Sound
    if (soundName && soundName !== 'no' && !opt.skipSounds.includes(soundName)) { const src = refer('sounds', soundName, opt.audioExts); if (src) emit({ op: 'se', src }) }
    for (const key of ['Role1', 'Role2', 'Role3']) if (row[key] && row[key] !== 'no') count('ignored', 'role')
    const dialogText = row.Dialog ? table[row.Dialog] : ''
    if (!dialogText && !row.TalkSound) continue
    if (!dialogText) { count('ignored', 'row-without-text'); continue }
    stats.messages += 1
    const speakerText = row.Speaker ? table[row.Speaker] : ''
    const speaker = speakerText === 'player' ? opt.playerName : speakerText || ''
    emit({ op: 'speaker', segments: speaker ? [{ text: speaker }] : [] })
    if (row.TalkSound && row.TalkSound !== 'no') { const src = refer('voices', row.TalkSound, opt.audioExts); if (src) emit({ op: 'voice', src }) }
    emit({ op: 'text', segments: markupSegments(dialogText, opt.playerName) })
    endStep()
  }
  if (list.length || !steps.length) { emit({ op: 'text', segments: [] }); endStep() }
  return { steps, stats }
}

export const arcrecordDialogAdapter = { id: ADAPTER_ID, label: 'ArcRecord_D（Dialog.txt 剧情，经 containers 切段）', sniff, explainSniff, parse, contextFiles, contextDirs, contextTextFilter, contextWalkLimit, contextSampleLimit, prepare }
