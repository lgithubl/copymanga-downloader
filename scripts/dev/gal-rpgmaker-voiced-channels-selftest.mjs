import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as rpg from '../../web/library/gal/adapters/rpgmaker-json.mjs'
import * as unite from '../../web/library/gal/adapters/rpgmaker-unite.mjs'
import { resolveLayout } from '../tag-scripts/gal-layout/main.js'
const c = (code, parameters = [], indent = 0) => ({ code, parameters, indent })
const say = [
  c(101, ['', 0, 0, 2]),
  c(401, ['a']),
  c(101, ['', 0, 0, 2]),
  c(401, ['b']),
  c(101, ['', 0, 0, 2]),
  c(401, ['c']),
  c(101, ['', 0, 0, 2]),
  c(401, ['d']),
]
const group = (ctx) => ctx.catalogTree.children.find((n) => n.id === 'special-voiced')
test('MV catalog counts existing non-looping SimpleVoice resources through nested calls, without BGS, SE, missing files or duplicates', async () => {
  const common = [
    null,
    {
      id: 1,
      name: '回想',
      list: [
        c(356, ['SV_ボイスの演奏 line1 90 100 0 1']),
        c(356, ['SV_ボイスの演奏 line1 90 100 0 1']),
        c(117, [2]),
        c(356, ['SV_ボイスのループ演奏 loop 90 100 0 1']),
        c(356, ['SV_ボイスの演奏 absent 90 100 0 1']),
        c(250, [{ name: 'Knock' }]),
        ...say,
      ],
    },
    { id: 2, name: 'helper', list: [c(356, ['SV_PLAY_VOICE line2']), ...say] },
  ]
  const ctx = await rpg.prepare({
    options: { maps: { enabled: false }, special: { voiced: true } },
    texts: { 'data/CommonEvents.json': JSON.stringify(common) },
    files: ['audio/voice/line1.rpgmvo', 'audio/voice/line2.ogg', 'audio/voice/loop.ogg', 'audio/se/Knock.ogg'],
  })
  assert.equal(group(ctx)?.children.length, 1)
  assert.match(group(ctx).children[0].subtitle, /2 个对白配音资源/)
  assert.match(group(ctx).children[0].subtitle, /全分支/)
})
test('Unite counts native PlayVoice after installing its compiler, excluding PlayBgv and absent clips; packet paths stay valid', async () => {
  const plugin = (action, name) =>
    c(90707, [
      'plugin',
      { code: 357, parameters: ['VoiceEvent', action, JSON.stringify([{ key: 'clipName', value: name }])] },
    ])
  const common = [
    null,
    {
      id: 1,
      name: '回想',
      list: [
        plugin('PlayVoice', 'line.ogg'),
        plugin('PlayVoice', 'line.ogg'),
        plugin('PlayBgv', 'loop.ogg'),
        plugin('PlayVoice', 'absent.ogg'),
        ...say,
      ],
    },
  ]
  const data = {
    format: 'rpgmaker-unite-context/1',
    root: 'arc/res',
    texts: { 'arc/res/data/CommonEvents.json': JSON.stringify(common) },
    files: ['arc/res/audio/voice/line.ogg', 'arc/res/audio/voice/loop.ogg'],
    packetMap: { 'arc/res/data/CommonEvents.json': 'arc/script/common.unite' },
    strings: {},
  }
  const ctx = await unite.prepare({
    texts: { 'arc/native.json': JSON.stringify(data) },
    options: { special: { voiced: true } },
  })
  assert.equal(group(ctx)?.children.length, 1)
  assert.match(group(ctx).children[0].subtitle, /1 个对白配音资源/)
  assert.equal(group(ctx).children[0].script, 'arc/script/common.unite::common-1')
})
test('only requested game profiles opt in, keeping generic RPG and Unite defaults', () => {
  assert.equal(resolveLayout('rpgmaker::RJ01220265').ruleOverrides?.['rpgmaker-json']?.special?.voiced, true)
  assert.equal(resolveLayout('unite::RJ01474142').ruleOverrides?.['rpgmaker-unite']?.special?.voiced, true)
  assert.equal(resolveLayout('unite::girlreno').ruleOverrides?.['rpgmaker-unite']?.special?.voiced, true)
  assert.equal(rpg.DEFAULT_OPTIONS.special.voiced, false)
  assert.equal(unite.DEFAULT_OPTIONS.special.voiced, false)
})

test('incomplete statistics surface a diagnostic instead of silently claiming zero dialogue resources', async () => {
  const ctx = await rpg.prepare({
    options: { maxCommands: 2, maps: { enabled: false }, special: { voiced: true } },
    texts: { 'data/CommonEvents.json': JSON.stringify([null, { id: 1, name: '回想', list: say }]) },
    files: [],
  })
  assert.ok(rpg.rpgMakerJsonAdapter.health(ctx).some((row) => /对白配音资源统计失败.*common-1/.test(row.message)))
})
