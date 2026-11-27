import assert from 'node:assert/strict'
import { test, before } from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildArc20, BgiScript, dscEncode } from './make-bgi-fixture.mjs'
import { ensureContainers } from '../../web/library/gal/containers.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { prepare, parse } from '../../web/library/gal/adapters/bgi-bs.mjs'
const files = ['room', 'cg', 'cutin', 'new-cutin', 'body']
    .map((n) => 'arc/res/' + n + '.png')
    .concat('arc/res/music.ogg'),
  ctx = prepare({ files }),
  entries = []
const scene = (name, s) => entries.push({ name, data: dscEncode(s.build()) })
scene(
  'zero',
  new BgiScript()
    .call('_DrawScene', 'room')
    .call('_DrawBS', 1, 'body')
    .call('_DrawSPR', 5, 'cutin')
    .call('_PlayBGM', 0, 'music')
    .msg('before')
    .call('_FadeSPR', 5, 0, 0)
    .call('_FadeBS', 1, 0, 0)
    .call('_FadeBGM', 0, 500, 0)
    .msg('after'),
)
scene(
  'nonzero',
  new BgiScript()
    .call('_DrawScene', 'room')
    .call('_DrawBS', 1, 'body')
    .call('_DrawSPR', 5, 'cutin')
    .call('_PlayBGM', 0, 'music')
    .msg('before')
    .call('_FadeSPR', 5, 1, 0)
    .call('_FadeBS', 1, 1, 0)
    .call('_FadeBGM', 0, 500, 1)
    .msg('after'),
)
scene(
  'replace',
  new BgiScript()
    .call('_DrawScene', 'room')
    .call('_DrawSPR', 5, 'cutin')
    .call('_DrawScene', 'room')
    .msg('same batch')
    .msg('retained before next scene')
    .call('_DrawSPR', 9, 'new-cutin')
    .call('_DrawScene', 'cg')
    .msg('new batch'),
)
// Native trace: slot5 is re-created before message66 and the next scene change
// is BLACK -> main CG before message76. No authored text or images are included.
const target = new BgiScript().call('_DrawScene', 'room')
for (let n = 1; n <= 105; n++) {
  if (n === 66) target.call('_DrawSPR', 5, 'cutin').call('_DrawScene', 'room')
  if (n === 76) target.call('_DrawScene', 'BLACK').call('_DrawScene', 'cg')
  if (n === 86) target.call('_DrawScene', 'cg')
  target.msg('message ' + n)
}
scene('native-lifetime', target)
let work, wire
before(async () => {
  await fs.mkdir('.cache/bgi-lifetime-tests', { recursive: true })
  work = await fs.mkdtemp(path.resolve('.cache/bgi-lifetime-tests/case-'))
  await fs.writeFile(path.join(work, 'data01500.arc'), buildArc20(entries))
  const config = normalizeGalConfig({
    containers: {
      enabled: true,
      dir: 'arc',
      scan: ['.'],
      format: 'buriko',
      scriptDecoder: 'bgi-bs',
      scriptExt: 'bgi',
      mode: 'hybrid',
      flat: true,
      rules: [{ match: '\\.arc$' }],
    },
  })
  const result = await ensureContainers({ mediaDir: work, config })
  assert.ok(!Object.values(result.arcs).some((r) => r.error), JSON.stringify(result))
  wire = async (name) => JSON.parse(await fs.readFile(path.join(work, 'arc/script/data01500', name + '.bgi'), 'utf8'))
})
const render = async (name, context = ctx) => parse(JSON.stringify(await wire(name)), context)
function layersAt(s, end) {
  const layers = new Map()
  for (const step of s.steps.slice(0, end + 1))
    for (const c of step.commands)
      if (c.op === 'overlay') layers.set(c.slot, c.src)
      else if (c.op === 'overlayOff') {
        if (c.slot) layers.delete(c.slot)
        else layers.clear()
      }
  return layers
}
test('binary ARC -> DSC -> compact events -> adapter clears immediate SPR, bust and BGM', async () => {
  const s = await render('zero'),
    ops = s.steps[1].commands.map((c) => c.op)
  for (const op of ['overlayOff', 'standOff', 'bgmStop'])
    assert.ok(ops.includes(op), op + ' missing after real container conversion')
})
test('legacy cached events with omitted trailing zero arguments also clear', () => {
  const events = [
      ['c', '_DrawSPR', 0, [5, 'cutin']],
      ['c', '_DrawBS', 0, [1, 'body']],
      ['k', 0x140, 0, ['before']],
      ['c', '_FadeSPR', 0, [5]],
      ['c', '_FadeBS', 0, [1]],
      ['c', '_FadeBGM', 0, [0, 500]],
      ['k', 0x140, 0, ['after']],
    ],
    s = parse(JSON.stringify({ format: 'bgi-bs/1', events }), ctx)
  for (const op of ['overlayOff', 'standOff', 'bgmStop'])
    assert.ok(
      s.steps[1].commands.some((c) => c.op === op),
      op,
    )
})
test('explicit nonzero opacity and volume are preserved', async () => {
  const s = await render('nonzero')
  assert.equal(
    s.steps[1].commands.some((c) => ['overlayOff', 'standOff', 'bgmStop'].includes(c.op)),
    false,
  )
  assert.equal(layersAt(s, 1).get('spr5'), 'arc/res/cutin.png')
})
test('new sprites in the current draw batch survive while old slots are cleared on scene replacement', async () => {
  const s = await render('replace')
  assert.equal(layersAt(s, 0).get('spr5'), 'arc/res/cutin.png')
  assert.equal(layersAt(s, 1).get('spr5'), 'arc/res/cutin.png')
  assert.deepEqual([...layersAt(s, 2)], [['spr9', 'arc/res/new-cutin.png']])
})
test('native message66 sprite is gone from message76 onward, including86 and100', async () => {
  const s = await render('native-lifetime')
  assert.equal(layersAt(s, 65).get('spr5'), 'arc/res/cutin.png')
  assert.equal(layersAt(s, 74).has('spr5'), true)
  for (const n of [76, 86, 100]) assert.equal(layersAt(s, n - 1).has('spr5'), false, 'message ' + n)
})
test('existing clearBustsOnScene=false opt-out retains its scene layers', async () => {
  const s = await render('replace', prepare({ files, options: { clearBustsOnScene: false } }))
  assert.deepEqual(
    [...layersAt(s, 2)],
    [
      ['spr5', 'arc/res/cutin.png'],
      ['spr9', 'arc/res/new-cutin.png'],
    ],
  )
})
