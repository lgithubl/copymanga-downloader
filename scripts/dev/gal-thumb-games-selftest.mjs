#!/usr/bin/env node
// Gal 自测（只用 node）：gal-layout LAYOUTS 里各游戏的缩略图规则（thumbSources / thumbFallback）——用真实目录树里出现过的文件名造索引，看卡片能不能取到图。
//   node scripts/dev/gal-thumb-games-selftest.mjs
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { buildSourceIndex, subjectKey } from '../../web/library/gal/thumbs.mjs'
import { LAYOUTS, resolveLayout } from '../../scripts/tag-scripts/gal-layout/main.js'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const sourcesOf = (id) => normalizeGalConfig(resolveLayout(id).config).thumbSources
// 一条规则对一张卡片：先建索引（files = [{ dir, name }]，dir 是通配后的具体目录），再算卡片键，取索引里的图
const lookup = (rules, files, subject) => {
  const out = []
  for (const rule of rules) {
    const key = subjectKey(rule, subject)
    if (key === null) continue
    const index = buildSourceIndex(rule, files.filter((f) => f.dir === rule.dir || (rule.dir.includes('*') && new RegExp(`^${rule.dir.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`).test(f.dir))))
    out.push(...(index.get(key) || []).slice(0, rule.limit || 99))
  }
  return out
}

// ---- Girls Creation 家族（aster / aku / fruits 继承）----
{
  const rules = sourcesOf('aster')
  const files = [{ dir: 'scenes/chara_0032_r18_1', name: 'thumbnail.png' }, { dir: 'scenes/c_2', name: 'thumbnail.jpg' }, { dir: 'scenes/c_2', name: 'other.png' }]
  check('Girls Creation：脚本卡片（scenes/<场景 id>/script.txt，forKey = 父目录名）取 thumbnail.png|jpg；目录卡片（分组键 = 场景名）同理；别的图不取', J(lookup(rules, files, { kind: 'script', stem: 'script', parent: 'chara_0032_r18_1' })) === J(['scenes/chara_0032_r18_1/thumbnail.png']) && J(lookup(rules, files, { kind: 'dir', name: 'c_2' })) === J(['scenes/c_2/thumbnail.jpg']), J(rules.map((r) => [r.dir, r.for, r.forKey])))
  check('Girls Creation 家族共用一份：aku / fruits / maid / jaxin 的规则和 aster 一样；thumbFallback.topUp = true', ['aku', 'fruits', 'maid', 'jaxin'].every((id) => J(sourcesOf(id)) === J(rules)) && normalizeGalConfig(resolveLayout('aku').config).thumbFallback.topUp === true)
}

// ---- minashigo（Ren'Py）----
{
  const rules = sourcesOf('minashigo')
  const files = [{ dir: 'images/thumb', name: '110020111101_360.jpg' }, { dir: 'images/thumb', name: '110020111201_360.jpg' }, { dir: 'images/thumb', name: 'ev065_00_07201_360.jpg' }, { dir: 'images/cg/110020111', name: '110020111101.jpg' }, { dir: 'images/cg/110020111', name: '110020111102.jpg' }, { dir: 'images/icon/Character', name: '200903.png' }, { dir: 'images/stand', name: '200903stand_a.png' }]
  const got = lookup(rules, files, { kind: 'script', stem: 'scene_110020111', parent: '' })
  check('minashigo：scene_<9 位> 取 images/thumb/<9 位><3 位>_360.jpg（forStrip 去掉 scene_）再接 images/cg/<9 位>/ 里的图', got[0] === 'images/thumb/110020111101_360.jpg' && got.includes('images/cg/110020111/110020111102.jpg') && !got.some((p) => /ev065/.test(p)), J(got))
  check('minashigo：活动脚本 scene_ev065_00_07 取 ev065_00_07201_360.jpg；角色分组卡片（键 200903）取 icon + stand', J(lookup(rules, files, { kind: 'script', stem: 'scene_ev065_00_07', parent: '' })) === J(['images/thumb/ev065_00_07201_360.jpg']) && J(lookup(rules, files, { kind: 'dir', name: '200903' })) === J(['images/icon/Character/200903.png', 'images/stand/200903stand_a.png']))
}

// ---- ミナシゴノシゴトR ----
{
  const rules = sourcesOf('minashigo_r')
  const files = [{ dir: 'image/episode/story', name: '120090312.png' }, { dir: 'image/character/icon', name: '200903.png' }, { dir: 'image/character/deck', name: '200903.png' }, { dir: 'image/character/profile', name: '200903.png' }, { dir: 'image/character/stand', name: '20090301.png' }]
  check('ミナシゴノシゴトR：脚本 120090312 = 只有本集图（episode/story）；角色头像 icon / deck 不再给脚本卡片用（场景 CG 走渲染 / 兜底）', J(lookup(rules, files, { kind: 'script', stem: '120090312', parent: '' })) === J(['image/episode/story/120090312.png']), J(lookup(rules, files, { kind: 'script', stem: '120090312', parent: '' })))
  check('ミナシゴノシゴトR：角色分组卡片（键 200903）= icon → deck → profile → stand', J(lookup(rules, files, { kind: 'dir', name: '200903' })) === J(['image/character/icon/200903.png', 'image/character/deck/200903.png', 'image/character/profile/200903.png', 'image/character/stand/20090301.png']))
}

// ---- TSK ----
{
  const rules = sourcesOf('tsk')
  const files = [{ dir: 'Sprites/Chara/Thumb_005', name: 'chara_1027004_1_1.png' }, { dir: 'Sprites/Chara/Thumb_006', name: 'chara_1027004_2_1.png' }, { dir: 'Sprites/Chara/Thumb_005', name: 'chara_9020038_1_1.png' }]
  check('TSK：角色分组卡片 @1027（forStrip 去掉 @）取 Thumb_005 / Thumb_006 里 chara_1027xxx 的图', J(lookup(rules, files, { kind: 'dir', name: '@1027' })) === J(['Sprites/Chara/Thumb_005/chara_1027004_1_1.png', 'Sprites/Chara/Thumb_006/chara_1027004_2_1.png']), J(lookup(rules, files, { kind: 'dir', name: '@1027' })))
}

// ---- 魔法学园 ----
{
  const rules = sourcesOf('artwhirl')
  const files = [{ dir: 'episode_thumb/YUNI', name: 'YUNI_episode7_thumb.jpg' }, { dir: 'episode_thumb/YUNI', name: 'YUNI_episode7h_thumb.jpg' }, { dir: 'images/icons/YUNI', name: 'icon_m.jpg' }, { dir: 'images/icons/YUNI', name: 'icon_s.png' }]
  check('魔法学园：YUNI_ep7_00 取 …_episode7_thumb.jpg；H 版 YUNI_ep7_h 取 …_episode7h_thumb.jpg；两边互不串', J(lookup(rules, files, { kind: 'script', stem: 'YUNI_ep7_00', parent: 'YUNI_ep7' })) === J(['episode_thumb/YUNI/YUNI_episode7_thumb.jpg']) && J(lookup(rules, files, { kind: 'script', stem: 'YUNI_ep7_h', parent: 'YUNI_ep7' })) === J(['episode_thumb/YUNI/YUNI_episode7h_thumb.jpg']))
  check('魔法学园：目录卡片 YUNI_ep7（去掉 _ep<N> = YUNI）和 hscripts/YUNI 都取 images/icons/YUNI 的 icon；topUp = true', J(lookup(rules, files, { kind: 'dir', name: 'YUNI_ep7' })) === J(['images/icons/YUNI/icon_m.jpg', 'images/icons/YUNI/icon_s.png']) && J(lookup(rules, files, { kind: 'dir', name: 'YUNI' })) === J(['images/icons/YUNI/icon_m.jpg', 'images/icons/YUNI/icon_s.png']) && normalizeGalConfig(resolveLayout('artwhirl').config).thumbFallback.topUp === true)
}

// ---- Kamihime 兜底跳过 ----
{
  const skip = normalizeGalConfig(resolveLayout('kamihime').config).thumbFallback.skip.map((s) => new RegExp(s, 'i'))
  const skipped = (name) => skip.some((re) => re.test(name))
  check('Kamihime：兜底封面跳过 black / white / blank 占位图和 sepia_filter 滤镜层（默认那条也在）；正常图不跳', skipped('black-1ca5.png') && skipped('sepia_filter-ab.png') && skipped('white.jpg') && !skipped('story-bg_haremu_01.jpg') && !skipped('hana_00.png'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
