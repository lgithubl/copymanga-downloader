// Gal 首页「表情」入口：角色 + 表情预设的列表，一个个过、一个个确认。
// 数据来自后端的 x:expr 节点（node.casts：每个全局分层脸骨架 + 脚本里用过的预设名和次数）；配置和你调的存法和播放器「更多 → 表情…」是同一份：
//   localStorage 的 copymanga.gal.view.<条目 id> 里的 expressions（预设表）和 confirmed（{ 范围: { 预设名: true } }，已确认的）。
// 预览：同一个 Spine 渲染层（gal-spine.js），选一个角色 + 一个预设，改部件马上看到。全部用 textContent 写入，不拼 innerHTML。
import { assetUrl } from '/gal-engine.js'
import { DEFAULT_EXPRESSIONS, castKeysOf, createSpineLayer, mergeExpressions, resolveExpression } from '/gal-spine.js'

const GROUPS = [['eyemain', '眼珠'], ['eye', '眼'], ['eyebrow', '眉'], ['eyepos', '眼位'], ['mouse', '嘴'], ['cheek', '腮红'], ['highlight', '高光'], ['sweat', '汗'], ['tear', '泪']]
const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export function createExprReview({ container, reader, viewKey, onOpen }) {
  const node = reader.node
  const casts = node.casts || []
  const base = reader.resourceBase
  const storeKey = `copymanga.gal.view.${viewKey}`
  const readStore = () => { try { const v = JSON.parse(localStorage.getItem(storeKey) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} } }
  // 只改 expressions / confirmed 两个字段，别的（放大、摆放、马赛克…）原样留着
  const patchStore = (patch) => { try { localStorage.setItem(storeKey, JSON.stringify({ ...readStore(), ...patch })) } catch { /* 存不了就只在这一页生效 */ } }
  const config = reader.item?.config?.adapterOptions?.['girlscreation-tag']?.expressions || {}
  let mine = readStore().expressions || {}
  let confirmed = readStore().confirmed || {}
  const table = (draft = null) => mergeExpressions(DEFAULT_EXPRESSIONS, config, mine, draft)   // 内置初始值 ← 服务端配置 ← 你调的（和播放时同一个合并顺序）
  const scopeOf = (cast) => cast.castKey || castKeysOf(cast.skel).skelBase

  const root = el('div', 'gal-expr-review')
  const head = el('div', 'gal-expr-review-head')
  const back = el('button', 'gal-btn', '↑ 上一级')
  back.type = 'button'
  back.addEventListener('click', () => onOpen('', 'up'))
  const title = el('strong', '', '表情预设')
  const progress = el('span', 'gal-expr-progress', '')
  const copy = el('button', 'gal-btn', '复制配置')
  copy.type = 'button'
  copy.title = '把你调过的表情表复制成 JSON，可以放进服务端配置 adapterOptions[\'girlscreation-tag\'].expressions'
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(mine, null, 2)); copy.textContent = '已复制' } catch { copy.textContent = '复制失败' } setTimeout(() => { copy.textContent = '复制配置' }, 1500) })
  head.append(back, title, progress, copy)

  const side = el('div', 'gal-expr-side')
  const main = el('div', 'gal-expr-main')
  const stage = el('div', 'gal-expr-stage')
  const info = el('div', 'gal-expr-info')
  const presetBar = el('div', 'gal-expr-presets')
  const editor = el('div', 'gal-expr-editor')
  main.append(stage, info, presetBar, editor)
  root.append(head, side, main)
  container.replaceChildren(root)
  if (!casts.length) { main.replaceChildren(el('div', 'gal-browse-empty', '没有找到用到分层脸骨架的预设（脚本里没有 SPINE_ACTOR，或骨架不在 data/spine/ 下）')); return { destroy() {}, setImmersive() {} } }

  const layer = createSpineLayer({ parent: stage, url: (src) => assetUrl(base, src) })
  let cast = casts[0]
  let preset = cast.presets[0]?.name || '通常'
  let animations = []
  let loadedSkel = ''

  const isConfirmed = (c, name) => Boolean(confirmed[scopeOf(c)]?.[name])
  const countConfirmed = (c) => c.presets.filter((p) => isConfirmed(c, p.name)).length
  const total = casts.reduce((n, c) => n + c.presets.length, 0)
  const done = () => casts.reduce((n, c) => n + countConfirmed(c), 0)
  const refreshProgress = () => { progress.textContent = `已确认 ${done()} / ${total}` }

  function renderSide() {
    side.replaceChildren()
    for (const c of casts) {
      const button = el('button', `gal-expr-cast${c === cast ? ' active' : ''}${countConfirmed(c) === c.presets.length ? ' all-done' : ''}`)
      button.type = 'button'
      button.append(el('span', 'gal-expr-cast-name', c.label), el('span', 'gal-expr-cast-count', `${countConfirmed(c)} / ${c.presets.length}`))
      button.title = c.name
      button.addEventListener('click', () => { cast = c; preset = c.presets[0]?.name || '通常'; render() })
      side.append(button)
    }
  }

  function renderPresets() {
    presetBar.replaceChildren()
    for (const p of cast.presets) {
      const button = el('button', `gal-expr-preset-btn${p.name === preset ? ' active' : ''}${isConfirmed(cast, p.name) ? ' confirmed' : ''}`)
      button.type = 'button'
      button.textContent = `${isConfirmed(cast, p.name) ? '✓ ' : ''}${p.name}`
      button.title = `脚本里用了 ${p.count} 次`
      button.addEventListener('click', () => { preset = p.name; renderPresets(); loadSkeleton().catch(() => renderEditor()) })
      presetBar.append(button)
    }
  }

  const currentSpec = () => {
    const { castKey, skelBase } = castKeysOf(cast.skel)
    const hit = resolveExpression({ table: table(), castKey, skelBase, preset, names: animations })
    const out = {}
    for (const anim of hit?.anims || []) { const [group, name] = anim.split('/'); out[group] = name.slice(group.length + 1) }
    return { spec: out, from: hit ? hit.scope : '', known: Boolean(hit) }
  }

  function renderEditor() {
    editor.replaceChildren()
    if (!animations.length) { editor.append(el('div', 'gal-expr-hint', '骨架加载中…')); return }
    const { spec, from, known } = currentSpec()
    info.textContent = `${cast.label} · 预设「${preset}」· ${known ? `来自预设表（范围 ${from}）` : '预设表里没有，现在用的是默认脸'}${isConfirmed(cast, preset) ? ' · 已确认' : ''}`
    const selects = new Map()
    const grid = el('div', 'gal-expr-groups')
    for (const [group, label] of GROUPS) {
      const names = animations.filter((n) => n.startsWith(`${group}/`))
      if (!names.length) continue
      const row = el('label', 'gal-expr-field')
      const select = el('select', 'gal-more-select')
      const blank = el('option', '', '（默认）')
      blank.value = ''
      select.append(blank)
      for (const name of names) { const suffix = name.slice(group.length * 2 + 2); const option = el('option', '', suffix); option.value = suffix; option.selected = suffix === spec[group]; select.append(option) }
      selects.set(group, select)
      row.append(el('span', '', `${label}（${group}）`), select)
      grid.append(row)
    }
    const scope = el('select', 'gal-more-select')
    for (const [value, text] of [[scopeOf(cast), `这个角色（${scopeOf(cast)}）`], ['default', '所有角色']]) { const option = el('option', '', text); option.value = value; scope.append(option) }
    const specOf = () => Object.fromEntries([...selects].filter(([, select]) => select.value).map(([group, select]) => [group, select.value]))
    function draftPreview() { layer.setExpressions(table({ [scope.value]: { [preset]: specOf() } })) }
    for (const select of selects.values()) select.addEventListener('change', draftPreview)
    scope.addEventListener('change', draftPreview)
    const saveBtn = el('button', 'gal-btn', '保存')
    saveBtn.type = 'button'
    saveBtn.title = '把上面选的组合存成这个预设（只存到这个媒体，浏览器里）'
    saveBtn.addEventListener('click', () => {
      mine = { ...mine, [scope.value]: { ...(mine[scope.value] || {}), [preset]: specOf() } }
      patchStore({ expressions: mine })
      layer.setExpressions(table())
      renderEditor()
      saveBtn.textContent = '已保存'
    })
    const confirmBtn = el('button', 'gal-btn gal-expr-confirm', isConfirmed(cast, preset) ? '取消确认' : '确认这个预设')
    confirmBtn.type = 'button'
    confirmBtn.addEventListener('click', () => {
      const key = scopeOf(cast)
      const next = { ...(confirmed[key] || {}) }
      if (next[preset]) delete next[preset]; else next[preset] = true
      confirmed = { ...confirmed, [key]: next }
      patchStore({ confirmed })
      render(false)
    })
    const nextBtn = el('button', 'gal-btn', '下一个未确认 ▶')
    nextBtn.type = 'button'
    nextBtn.addEventListener('click', () => {
      const flat = casts.flatMap((c) => c.presets.map((p) => [c, p.name]))
      const at = flat.findIndex(([c, name]) => c === cast && name === preset)
      const found = [...flat.slice(at + 1), ...flat.slice(0, at)].find(([c, name]) => !isConfirmed(c, name))
      if (!found) { nextBtn.textContent = '都确认完了'; return }
      cast = found[0]; preset = found[1]
      render()
    })
    const foot = el('div', 'gal-expr-foot')
    const scopeRow = el('label', 'gal-expr-field')
    scopeRow.append(el('span', '', '保存到'), scope)
    foot.append(saveBtn, confirmBtn, nextBtn)
    editor.append(grid, scopeRow, foot)
  }

  // 预览：Actor1，轨道 0 的动画就是预设名（骨架里没有这个名字 → 走预设表 / 默认脸，和播放时一样）
  async function loadSkeleton() {
    if (loadedSkel !== cast.skel) {
      loadedSkel = cast.skel
      animations = []
    }
    const spec = { op: 'spine', slot: 'Actor1', kind: 'actor', skel: cast.skel, atlas: cast.atlas, x: 0, y: 0, scale: 1, order: 1, loop: true, speed: 1, tracks: [{ track: 0, anim: preset, loop: true }] }
    await layer.set({ Actor1: spec }, { live: false, view: { still: { zoom: 1, cx: 0.5, cy: 0.5 }, actor: { zoom: 1, cx: 0.5, cy: 0.5 }, camera: { mode: 'fit' }, expressions: table() } })
    await layer.ready()
    animations = layer.info()[0]?.animations || []
    renderEditor()
  }
  function render(reload = true) {
    renderSide()
    renderPresets()
    refreshProgress()
    if (reload) loadSkeleton().catch(() => renderEditor())
    else renderEditor()
  }
  render()
  return { destroy() { layer.destroy() }, setImmersive() {} }
}
