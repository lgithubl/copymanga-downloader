// Gal 的浏览层：把后端给的「节点」（web/library/gal/browse.mjs）渲染成卡片网格 / 列表，选项自带下一个节点的 id，
// 点了就 onOpen(节点 id)，由页面层再取一次（reader?sectionId=…）。这里不认识目录结构，只认 kind / items。
// 全部用 textContent / setAttribute 写入后端给的文字，不拼 innerHTML。
import { attachBarLock } from './gal-barlock.js'
import { DEFAULT_HOVER, attachThumbCycle, pickCover, thumbUrl } from './thumb-cycle.js'
import { createThumbRenderer } from './gal-thumb-render.js'
import { assetUrl } from './gal-engine.js'
import { createGalVoice } from './gal-voice.js'

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

// progress：{ [节点 id]: { ratio, completedAt } }，用来在列表里标「看到 x%」/「已看完」
// 沉浸是整个页面的状态（和播放页共用同一套：页面层隐藏头部/顶栏），这里在底部固定条里放按钮：
//   onToggleImmersive()  进入/退出沉浸（和全屏一起收在「更多」菜单里）      onLeave()  离开这个媒体（沉浸里页面头部藏起来了，所以这里也要有）
//   onEscape()           沉浸时按 Esc
// onOpen(节点 id, kind, extra)：extra = { at: 步号 }（卡片上的场景跳转点按钮：从那一步开始播）；kind = 'child'（点卡片进下一层）/ 'up'（上一级、面包屑）/ 'self'（同一层换页、换筛选/排序、换文本版本）；页面层靠它记「回来时的页码和筛选」
// thumbLoader：可选，卡片缩略图交给它分批加载（图只带 data-src）；不传就用浏览器自带的 lazy
// 列表很长（100/1000 张卡片）时：筛选 / 排序 / 每页条数 / 翻页都是服务端按节点 id 里的视图参数做的（node.view / node.viewBase），这里只拼 id
let refocusSearch = null   // 搜索框触发的重绘后，把焦点还给新的搜索框（重绘是整页换节点）
// 卡片封面 / 悬停轮播的本地偏好（localStorage，空 = 跟配置）：gal.thumbHover = on | off；gal.thumbCover = random | first | last
const PREF_HOVER = 'gal.thumbHover'
const PREF_COVER = 'gal.thumbCover'
const PREF_MODE = 'gal.thumbCarousel'   // 轮播方式：hover | auto（空 = 跟配置 thumbHover.mode）
const readPref = (key) => { try { return localStorage.getItem(key) || '' } catch { return '' } }
const writePref = (key, value) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key) } catch { /* 存不了就只对这次有效 */ } }
let keepMenuOpen = null    // 在「更多」里改了搜索 / 排序 / 每页条数 → 重绘后把菜单重新打开（还要接着改别的）
export function createGalBrowser({ container, reader, progress = {}, onOpen = () => {}, onToggleImmersive = null, onLeave = null, onEscape = null, thumbLoader = null, onRefreshIndex = null }) {
  const node = reader.node
  const root = el('div', 'gal-browse')
  // 渲染缩略图（骨骼 / 立绘场景，见 gal-thumb-render.js）：卡片带 item.render.key 时先取服务器缓存（命中 = 直接是图），没有（404）才入队离屏渲染并传回缓存
  const apiBase = String(reader.resourceBase || '').replace(/\/resource$/, '')
  const renderCfg = reader.item?.config?.thumbRender || {}
  const thumbRenderer = createThumbRenderer({
    concurrency: Number(renderCfg.concurrency) || 1,
    upload: async (task, blob) => {
      const res = await fetch(`${apiBase}/render-thumb?key=${task.key}`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
  })
  root.dataset.node = node.id
  const voice = createGalVoice({ reader, host: root })   // 随机语音：卡片 / 工具栏上的 🎲（gal-voice.js）

  // ---- 底部固定条：和播放页的工具栏同一个位置、同一套按钮样式（.gal-btn），只有一行 ----
  //   [↑ 上一级] [◀ 上一页] [页码 / 总页] [下一页 ▶] … [更多 ▾] [🔒] [返回]
  //   「更多」里放：位置（面包屑，每一级都能点）/ 搜索 / 排序 / 每页条数 / 文本版本 / 沉浸 / 全屏
  //   🔒 锁定 = 底栏常驻；没锁定 = 收起，鼠标移到最下沿才出来（gal-barlock.js）
  // 按钮不会因为状态变化消失（只有 disabled），所以位置固定、不会一会儿在这一会儿在那
  const bar = el('div', 'gal-browse-bar')       // 粘在滚动容器底部的外壳
  const barHot = el('div', 'gal-browse-bar-hot') // 没锁定时的底部热区（必须排在 barIn 前面，CSS 用 ~ 选下一个兄弟）
  const barIn = el('div', 'gal-browse-bar-in')
  const crumbRow = el('div', 'gal-browse-where')
  const crumbs = el('nav', 'gal-browse-crumbs')
  crumbs.setAttribute('aria-label', '位置')
  node.breadcrumb.forEach((crumb, index) => {
    const last = index === node.breadcrumb.length - 1
    if (index) crumbs.append(el('span', 'gal-browse-sep', '›'))
    const item = el(last ? 'span' : 'button', last ? 'gal-browse-crumb current' : 'gal-browse-crumb', crumb.title)
    if (!last) {
      item.type = 'button'
      item.addEventListener('click', () => onOpen(crumb.id, 'up'))
    }
    crumbs.append(item)
  })
  crumbRow.append(el('span', 'gal-more-label', '位置'), crumbs)

  const actions = el('div', 'gal-bar gal-browse-actions')
  const up = el('button', 'gal-btn gal-up gal-browse-up', '↑ 上一级')
  up.type = 'button'
  up.title = '回到上一级'
  up.disabled = node.parent == null
  up.addEventListener('click', () => { if (node.parent != null) onOpen(node.parent, 'up') })
  actions.append(up)

  // ---- 视图（筛选 / 排序 / 每页条数 / 翻页）：节点 id = <viewBase>[|q=…&s=…&n=…][#页码] ----
  const view = node.view && node.viewBase !== undefined ? node.view : null
  const viewId = (patch = {}, page = 1) => {
    const next = { q: view.q, sort: view.sort, size: view.size === view.defaultSize ? 0 : view.size, ...patch }
    const params = new URLSearchParams()
    if (next.q) params.set('q', next.q)
    if (next.sort && next.sort !== 'default') params.set('s', next.sort)
    if (next.size) params.set('n', String(next.size))
    const text = params.toString()
    return `${node.viewBase}${text ? `|${text}` : ''}${page > 1 ? `#${page}` : ''}`
  }
  const go = (id) => onOpen(id, 'self')
  const pageId = (page) => (view ? viewId({}, page) : `${node.id.split('#')[0]}#${page}`)

  // 翻页：一页时也留着（禁用），位置不变
  const pager = el('div', 'gal-browse-pager')
  const pageBtn = (text, title, page, disabled) => {
    const b = el('button', 'gal-btn gal-pager-btn', text)
    b.type = 'button'
    b.title = title
    b.disabled = disabled
    b.addEventListener('click', () => go(pageId(page)))
    return b
  }
  const single = node.pageCount <= 1
  const jump = el('input', 'gal-pager-jump')
  jump.type = 'number'
  jump.min = '1'
  jump.max = String(Math.max(1, node.pageCount))
  jump.value = String(node.page || 1)
  jump.disabled = single
  jump.title = '输入页码回车跳转'
  jump.setAttribute('aria-label', '跳到第几页')
  const doJump = () => {
    const page = Math.max(1, Math.min(node.pageCount, Math.floor(Number(jump.value)) || node.page))
    if (page !== node.page) go(pageId(page))
    else jump.value = String(node.page)
  }
  jump.addEventListener('keydown', (event) => { if (event.key === 'Enter') doJump() })
  const jumpBtn = el('button', 'gal-btn gal-pager-btn gal-pager-go', '跳转')
  jumpBtn.type = 'button'
  jumpBtn.title = '跳到输入的页码'
  jumpBtn.disabled = single
  jumpBtn.addEventListener('click', doJump)
  pager.append(
    pageBtn('«', '第一页', 1, single || node.page <= 1), pageBtn('◀ 上一页', '上一页', node.page - 1, single || node.page <= 1),
    jump, el('span', 'gal-pager-info', `/ ${Math.max(1, node.pageCount)} 页`), jumpBtn,
    pageBtn('下一页 ▶', '下一页', node.page + 1, single || node.page >= node.pageCount), pageBtn('»', '最后一页', node.pageCount, single || node.page >= node.pageCount),
  )
  actions.append(pager, el('span', 'gal-browse-spacer'))

  // 「更多」：向上展开的菜单（底部固定条在屏幕下沿）
  const more = el('div', 'gal-browse-more')
  const moreBtn = el('button', 'gal-btn gal-browse-more-btn', '更多 ▾')
  moreBtn.type = 'button'
  moreBtn.title = '搜索 / 排序 / 每页条数 / 沉浸 / 全屏'
  const moreMenu = el('div', 'gal-browse-more-menu')
  moreMenu.hidden = true
  moreMenu.append(crumbRow)
  const closeMenu = () => { moreMenu.hidden = true }
  // ---- 渲染诊断：这一页渲染时出了什么问题，和播放页的渲染诊断一个思路 ----
  //   卡片没有图（后端每个来源试了什么）/ 图加载失败（浏览器请求的状态）/ 脚本问题（解析失败、缺资源、暂未渲染的指令）/ 节点提示（目录读不到、列表是空的）
  const problems = []   // { kind: '没有图' | '加载失败' | '脚本问题' | '节点', title, node, lines: [..], url? }
  const diagPanel = el('div', 'gal-browse-diag')
  diagPanel.hidden = true
  const diagBtn = el('button', 'gal-browse-diag-btn', '渲染诊断')
  diagBtn.type = 'button'
  diagBtn.title = '这一页渲染出了什么问题：没有图的卡片、加载失败的图、脚本解析 / 缺资源 / 未渲染的指令（可复制）'
  const diagText = async () => {
    const kinds = {}
    for (const item of problems) kinds[item.kind] = (kinds[item.kind] || 0) + 1
    const lines = [`节点 ${node.id}（${node.kind}）· 本页 ${node.items.length} 张卡片 · ${problems.length} 个问题${problems.length ? `（${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join('、')}）` : ''}`]
    for (const item of problems) {
      lines.push('', `[${item.kind}] ${item.title}${item.node ? `  (${item.node})` : ''}`)
      for (const line of item.lines) lines.push(`  · ${line}`)
      if (item.url) {
        const status = await fetch(item.url, { method: 'HEAD' }).then((r) => `HTTP ${r.status}`, (error) => `请求失败：${error.message}`)
        lines.push(`  · 浏览器请求 ${status}`)
      }
    }
    return lines.join('\n')
  }
  const renderDiag = async () => {
    diagPanel.replaceChildren()
    const head = el('div', 'gal-browse-diag-head')
    const copy = el('button', 'gal-btn', '复制')
    copy.type = 'button'
    const close = el('button', 'gal-btn', '关闭')
    close.type = 'button'
    head.append(el('strong', '', `渲染诊断（${problems.length}）`), copy, close)
    const pre = el('pre', 'gal-browse-diag-text', '加载中…')
    diagPanel.append(head, pre)
    close.addEventListener('click', () => { diagPanel.hidden = true })
    const text = await diagText()
    pre.textContent = problems.length ? text : `${text}\n\n这一页没有发现渲染问题`
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); copy.textContent = '已复制' } catch { copy.textContent = '复制失败' } setTimeout(() => { copy.textContent = '复制' }, 1500) })
  }
  const refreshDiag = () => {
    diagBtn.textContent = problems.length ? `渲染诊断（${problems.length}）` : '渲染诊断'
    moreBtn.classList.toggle('warn', problems.length > 0)   // 工具栏很小，有问题时在「更多」上点个红点
    if (!diagPanel.hidden) renderDiag()
  }
  diagBtn.addEventListener('click', () => { closeMenu(); diagPanel.hidden = !diagPanel.hidden; if (!diagPanel.hidden) renderDiag() })
  const field = (label, control) => { const row = el('label', 'gal-more-row'); row.append(el('span', 'gal-more-label', label), control); return row }

  if (view && (view.unfiltered > 8 || view.q)) {
    const search = el('input', 'gal-browse-search')
    search.type = 'search'
    search.placeholder = '筛选名称…'
    search.value = view.q
    search.title = '按名称筛选（回车立即筛选，停顿后自动筛选）'
    search.setAttribute('aria-label', '筛选名称')
    let timer = 0
    const apply = () => {
      clearTimeout(timer)
      const q = search.value.trim()
      if (q === view.q) return
      refocusSearch = node.viewBase
      keepMenuOpen = node.viewBase
      go(viewId({ q }, 1))
    }
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 400) })
    search.addEventListener('keydown', (event) => { if (event.key === 'Enter') apply() })
    const sort = el('select', 'gal-browse-sort')
    sort.title = '排序'
    for (const entry of view.sorts || []) {
      const option = el('option', '', entry.label)
      option.value = entry.id
      option.selected = entry.id === view.sort
      sort.append(option)
    }
    sort.addEventListener('change', () => { keepMenuOpen = node.viewBase; go(viewId({ sort: sort.value }, 1)) })
    const size = el('select', 'gal-browse-size')
    size.title = '每页条数'
    for (const n of view.sizes || []) {
      const option = el('option', '', `${n} / 页`)
      option.value = String(n)
      option.selected = n === view.size
      size.append(option)
    }
    if (!(view.sizes || []).includes(view.size)) { const option = el('option', '', `${view.size} / 页`); option.value = String(view.size); option.selected = true; size.append(option) }
    size.addEventListener('change', () => { keepMenuOpen = node.viewBase; go(viewId({ size: Number(size.value) === view.defaultSize ? 0 : Number(size.value) }, 1)) })
    const from = node.total ? (node.page - 1) * node.pageSize + 1 : 0
    const to = Math.min(node.total, node.page * node.pageSize)
    moreMenu.append(
      field('搜索', search), field('排序', sort), field('每页', size),
      el('div', 'gal-browse-range', view.q
        ? `筛选「${view.q}」：${node.total} / ${view.unfiltered} 项${node.total ? ` · 第 ${from}–${to} 项` : ''}`
        : `${node.total ? `第 ${from}–${to} 项 · ` : ''}共 ${node.total} 项`),
    )
    if (view.q) {
      const clear = el('button', 'gal-pager-btn', '清除筛选')
      clear.type = 'button'
      clear.addEventListener('click', () => { keepMenuOpen = node.viewBase; go(viewId({ q: '' }, 1)) })
      moreMenu.append(clear)
    }
    if (refocusSearch !== null && refocusSearch === node.viewBase) {
      refocusSearch = null
      queueMicrotask(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length) })
    }
  }
  if (!(view && (view.unfiltered > 8 || view.q))) moreMenu.append(el('div', 'gal-browse-range', node.total != null ? `共 ${node.total} 项` : ''))
  // 文本版本（不同语言/备份的文本）：切换 = 打开那一套的首页
  if (node.sets?.length > 1) {
    const select = el('select', 'gal-browse-sets')
    select.title = '文本版本'
    for (const set of node.sets) {
      const option = el('option', '', set.label)
      option.value = set.node
      option.selected = Boolean(set.active)
      select.append(option)
    }
    select.addEventListener('change', () => onOpen(select.value, 'self'))
    moreMenu.append(field('文本版本', select))
  }
  // 缩略图：悬停轮播开关 / 封面选哪张（存在浏览器本地，覆盖配置；「跟随配置」= 清掉本地选择）
  const hoverCfg = { ...DEFAULT_HOVER, ...(node.thumbHover || {}) }
  const hoverOn = () => { const pref = readPref(PREF_HOVER); return pref === 'on' ? true : pref === 'off' ? false : hoverCfg.enabled !== false }
  const coverCfg = node.thumbCover ?? (node.thumbMode === 'random' || !node.thumbMode ? 'random' : 'first')
  const coverOf = () => { const pref = readPref(PREF_COVER); return ['random', 'first', 'last'].includes(pref) ? pref : coverCfg }
  const hoverBox = el('input', 'gal-browse-hover-toggle')
  hoverBox.type = 'checkbox'
  hoverBox.checked = hoverOn()
  hoverBox.title = '有多张图的卡片轮播（悬停 / 自动见「轮播方式」）'
  hoverBox.addEventListener('change', () => writePref(PREF_HOVER, hoverBox.checked ? 'on' : 'off'))
  const coverSel = el('select', 'gal-browse-cover-select')
  coverSel.title = '卡片有多张图时封面选哪张'
  for (const [value, label] of [['', '跟随配置'], ['random', '随机'], ['first', '第一张'], ['last', '最后一张']]) { const option = el('option', '', label); option.value = value; option.selected = value === readPref(PREF_COVER); coverSel.append(option) }
  coverSel.addEventListener('change', () => { writePref(PREF_COVER, coverSel.value); keepMenuOpen = node.viewBase; go(node.id) })
  const modeOf = () => { const pref = readPref(PREF_MODE); return pref === 'hover' || pref === 'auto' ? pref : (hoverCfg.mode === 'auto' ? 'auto' : 'hover') }
  const modeSel = el('select', 'gal-browse-carousel-mode')
  modeSel.title = '悬停 = 鼠标放上去才轮播；自动 = 在屏幕里的卡片自己轮播'
  for (const [value, label] of [['', '跟随配置'], ['hover', '悬停'], ['auto', '自动']]) { const option = el('option', '', label); option.value = value; option.selected = value === readPref(PREF_MODE); modeSel.append(option) }
  modeSel.addEventListener('change', () => { writePref(PREF_MODE, modeSel.value); keepMenuOpen = node.viewBase; go(node.id) })
  moreMenu.append(field('轮播', hoverBox), field('轮播方式', modeSel), field('封面', coverSel))
  const immBtn = el('button', 'gal-browse-imm', '沉浸')
  immBtn.type = 'button'
  immBtn.title = '沉浸模式（I）'
  immBtn.hidden = !onToggleImmersive
  immBtn.addEventListener('click', () => { closeMenu(); onToggleImmersive?.() })
  const fsBtn = el('button', 'gal-browse-fs', '全屏')
  fsBtn.type = 'button'
  fsBtn.title = '全屏（F）'
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else root.requestFullscreen?.().catch(() => {})
  }
  fsBtn.addEventListener('click', () => { closeMenu(); toggleFullscreen() })
  const toggleMenu = (open = moreMenu.hidden) => { moreMenu.hidden = !open }
  moreBtn.addEventListener('click', (event) => { event.stopPropagation(); toggleMenu() })
  // 菜单里点别处（输入框、下拉框）不关；点菜单外面才关
  const onDocClick = (event) => { if (!more.contains(event.target)) closeMenu() }
  document.addEventListener('click', onDocClick)
  // 文件索引（适配器要遍历资源目录建的索引）：什么时候建的、多少个文件、有没有被截断；「刷新」= 丢掉缓存按磁盘现状重建（新增 / 改名的文件马上能看到）
  if (node.index) {
    const row = el('div', 'gal-more-row gal-index-row')
    const info = node.index
    const when = info.builtAt ? new Date(info.builtAt).toLocaleString() : '未知'
    const text = el('span', 'gal-index-text', `文件索引：${info.files} 个文件 · 建立于 ${when}${info.truncated ? ` · ⚠ 超过上限 ${info.limit} 已截断` : ''}`)
    text.title = `适配器：${(info.adapters || []).join(' / ')} · 耗时 ${info.ms} ms`
    const refresh = el('button', 'gal-btn gal-index-refresh', '刷新')
    refresh.type = 'button'
    refresh.title = '重新遍历资源目录、重新读名称表（改了文件 / 目录后点一下）'
    refresh.hidden = !onRefreshIndex
    refresh.addEventListener('click', async () => {
      refresh.disabled = true
      refresh.textContent = '刷新中…'
      try { await onRefreshIndex() } catch (error) { refresh.textContent = '刷新失败'; refresh.title = String(error?.message || error); refresh.disabled = false }
    })
    row.append(text, refresh)
    moreMenu.append(row)
  }
  moreMenu.append(immBtn, fsBtn, diagBtn)
  more.append(moreBtn, moreMenu, diagPanel)
  const lockBtn = el('button', 'gal-btn gal-lock')
  lockBtn.type = 'button'
  const leaveBtn = el('button', 'gal-btn gal-browse-leave', '返回')
  leaveBtn.type = 'button'
  leaveBtn.title = '退出沉浸并离开这个媒体'
  leaveBtn.hidden = !onLeave
  leaveBtn.addEventListener('click', () => onLeave?.())
  // 随机语音（当前这一层列表）：🎲 随机语音 + 过滤设置弹层（白 / 黑名单正则，存 localStorage）
  const voiceWrap = el('div', 'gal-voice-wrap')
  const voiceFilterBtn = el('button', 'gal-btn gal-voice-filter-btn', '过滤 ▾')
  voiceFilterBtn.type = 'button'
  voiceFilterBtn.title = '随机语音的白名单 / 黑名单（正则）'
  const voicePop = voice.filterPopover()
  voiceFilterBtn.addEventListener('click', (event) => { event.stopPropagation(); voicePop.hidden = !voicePop.hidden })
  const onVoiceDocClick = (event) => { if (!voicePop.hidden && !voiceWrap.contains(event.target)) voicePop.hidden = true }
  document.addEventListener('click', onVoiceDocClick)
  voiceWrap.append(voice.attach(':list', node.id, { title: '从这一层列表里随机放一条语音（不打开脚本）', className: 'gal-btn gal-voice-list-btn', text: '随机语音' }), voiceFilterBtn, voicePop)
  actions.append(voiceWrap, more, lockBtn, leaveBtn)
  barIn.append(actions)
  bar.append(barHot, barIn)
  attachBarLock({ root, button: lockBtn })
  if (keepMenuOpen !== null && keepMenuOpen === node.viewBase) { keepMenuOpen = null; moreMenu.hidden = false }

  function setImmersive(active) {
    root.classList.toggle('is-immersive', Boolean(active))
    immBtn.textContent = active ? '退出沉浸' : '沉浸'
  }
  const onKey = (event) => {
    if (!root.isConnected || event.ctrlKey || event.metaKey || event.altKey) return
    if (!root.getClientRects().length) return
    const tag = event.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return
    if ((event.key === 'i' || event.key === 'I') && onToggleImmersive) onToggleImmersive()
    else if (event.key === 'f' || event.key === 'F') toggleFullscreen()
    else if (event.key === 'Escape' && !moreMenu.hidden) closeMenu()
    else if (event.key === 'Escape' && root.classList.contains('is-immersive') && onEscape) onEscape()
    else return
    event.preventDefault()
  }
  document.addEventListener('keydown', onKey)

  const progressOf = (id) => progress[id] || null
  const progressBadge = (id) => {
    const p = progressOf(id)
    if (!p) return null
    if (p.completedAt || p.ratio >= 0.98) return el('span', 'gal-badge done', '已看完')
    if (p.ratio > 0) return el('span', 'gal-badge', `看到 ${Math.round(p.ratio * 100)}%`)
    return null
  }
  const thumbImages = []
  const thumbOf = (item, className) => {
    const box = el('div', className)
    // 一张卡片可以有多张图（item.thumbs，thumb = 第一张）；thumbMode：random（默认）随机一张当封面 / first 只第一张 / hover 封面第一张、悬停轮播
    const thumbs = item.thumbs?.length ? item.thumbs : item.thumb ? [item.thumb] : []
    const cover = coverOf()
    const renders = (item.renders?.length ? item.renders : item.render?.key ? [item.render] : []).filter((r) => r?.key && (item.type === 'script' || r.node))   // 目录卡片的封面是它里面脚本渲染的（render.node）；多个 = 轮播里的几张
    const ruleCover = Boolean(item.ruleCover) && thumbs.length > 0 && renders.length > 0   // 规则给的图是封面，渲染图排在后面轮播
    const render = ruleCover ? null : renders[0] || null
    const renderUrlOf = (r) => `${apiBase}/render-thumb?key=${r.key}`
    const renderUrl = render ? renderUrlOf(render) : ''
    if (!thumbs.length && !render) problems.push({ kind: '没有图', title: item.title, node: item.node, lines: item.thumbWhy?.length ? item.thumbWhy : ['后端没有给出原因'] })
    if (!thumbs.length && item.type === 'dir') box.dataset.icon = '📁'
    if (thumbs.length || render) {
      const thumbUrls = thumbs.map((path) => thumbUrl(reader.resourceBase, path))
      const urls = ruleCover ? [thumbUrls[0], ...renders.map(renderUrlOf), ...thumbUrls.slice(1)] : [...renders.map(renderUrlOf), ...thumbUrls]
      const coverAt = ruleCover ? 0 : render ? 0 : pickCover(thumbs.length, cover)   // 有渲染缩略图就以它为封面（缓存里没有时先显示别的图，渲染好了换上）
      const img = el('img')
      img.alt = ''
      img.decoding = 'async'
      const src = urls[coverAt]
      if (thumbLoader) { img.dataset.src = src; thumbImages.push(img) } else { img.loading = 'lazy'; img.src = src }
      // 封面加载失败：还有别的图就换下一张试，都不行才报「加载失败」
      const untried = urls.map((_, i) => i).filter((i) => i !== coverAt)
      let renderMissing = false
      img.addEventListener('error', () => {
        if (render && !renderMissing && img.getAttribute('src') === renderUrl) {
          renderMissing = true   // 缓存里还没有：排队渲染（失败不缓存、不记标记，下次重建页面还会再试）
          thumbRenderer.enqueue({ apiBase, resourceBase: reader.resourceBase, node: render.node || item.node, key: render.key, variant: render.variant || 0, film: render.film || '', filmFrame: renderCfg.filmFrame ?? 0.5, width: renderCfg.width || 640, scanSteps: renderCfg.scanSteps || 150, seek: renderCfg.seek ?? 0.5, cameraMode: reader.item?.config?.player?.cameraMode || '' })
            .then((blob) => { const local = URL.createObjectURL(blob); urls[0] = local; img.hidden = false; img.src = local; box.classList.remove('empty'); if (!img.isConnected) box.prepend(img) })
            .catch((error) => {
              if (/已销毁|已经试过/.test(error?.message || '')) return
              if (!thumbs.length) { img.remove(); box.classList.add('empty') }
              problems.push({ kind: '渲染缩略图失败', title: item.title, node: item.node, lines: [error?.message || String(error), '下次打开列表会再试一次'] })
              refreshDiag()
            })
          if (untried.length) { img.src = urls[untried.shift()]; return }
          img.hidden = true; box.classList.add('empty')   // 没有别的图：等渲染好再显示
          return
        }
        if (untried.length) { img.src = urls[untried.shift()]; return }
        img.remove()
        box.classList.add('empty')
        problems.push({ kind: '加载失败', title: item.title, node: item.node, url: src, lines: [`缩略图路径 ${thumbs[coverAt]}`, `请求地址 ${src}`, ...(/\.(mp4|mkv|webm|mov|m4v)$/i.test(thumbs[coverAt]) ? ['这是视频，缩略图由服务端 ffmpeg 截帧生成（ffmpeg 没装 / 视频损坏会失败）'] : [])] })
        refreshDiag()
      })
      box.append(img)
      // 轮播里除封面外的渲染图：开始轮播时才检查缓存、没有就排队渲染（一个目录最多几张，全部一进列表就渲染太重）
      let extrasDone = false
      const ensureExtras = renders.length > (ruleCover ? 0 : 1) ? () => {
        if (extrasDone) return
        extrasDone = true
        renders.slice(ruleCover ? 0 : 1).forEach((r, k) => {
          fetch(renderUrlOf(r)).then((res) => {
            if (res.ok) return null
            return thumbRenderer.enqueue({ apiBase, resourceBase: reader.resourceBase, node: r.node || item.node, key: r.key, variant: r.variant || 0, film: r.film || '', filmFrame: renderCfg.filmFrame ?? 0.5, width: renderCfg.width || 640, scanSteps: renderCfg.scanSteps || 150, seek: renderCfg.seek ?? 0.5, cameraMode: reader.item?.config?.player?.cameraMode || '' })
              .then((blob) => { urls[k + 1] = URL.createObjectURL(blob) })
          }).catch(() => {})
        })
      } : null
      if (urls.length > 1) cardCycles.push({ box, img, urls, coverAt, hover: { ...hoverCfg, enabled: true, mode: modeOf(), ...(item.carousel ? { count: item.carousel } : {}) }, isEnabled: hoverOn, onStart: ensureExtras })
    } else {
      box.classList.add('empty')
    }
    return box
  }
  const cycles = []
  const cardCycles = []   // 有多张图的卡片：卡片建好后挂悬停轮播（hover 的目标是整张卡片，不只是图）

  // 一律卡片：目录卡片（头像/文件夹图标、中文标签、数量）和脚本卡片（缩略图、台词摘要）混排，右上角的小标签是来源（合并目录时用来分辨来自哪个目录）
  const body = el('div', 'gal-browse-body gal-browse-cards')
  if (node.notice) body.append(el('div', 'gal-browse-notice', node.notice))
  // 多个脚本根（魔法学园：剧情 / H 场景……）：首页顶部并列标签，点一个 = 打开那一套的首页（「更多」里的下拉框仍然有）
  if (node.sets?.length > 1) {
    const tabs = el('div', 'gal-browse-tabs')
    tabs.setAttribute('role', 'tablist')
    for (const set of node.sets) {
      const tab = el('button', `gal-browse-tab${set.active ? ' active' : ''}`, set.label)
      tab.type = 'button'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', set.active ? 'true' : 'false')
      tab.addEventListener('click', () => { if (!set.active) onOpen(set.node, 'self') })
      tabs.append(tab)
    }
    body.append(tabs)
  }
  // 节点图：节点的描述文字 + 「相关」节点（关联，不是父子；点了和进子节点一样往下走，返回上一级仍回到这里）
  if (node.text) body.append(el('div', 'gal-browse-text', node.text))
  if (node.related?.length) {
    const related = el('div', 'gal-browse-related')
    related.append(el('span', 'gal-more-label', '相关'))
    for (const entry of node.related) {
      const link = el('button', 'gal-btn gal-browse-related-link', entry.title)
      link.type = 'button'
      link.addEventListener('click', () => onOpen(entry.node, 'related'))
      related.append(link)
    }
    body.append(related)
  }
  if (!node.items.length) body.append(el('div', 'gal-browse-empty', '这里还没有内容'))
  if (node.notice) problems.push({ kind: '节点', title: node.title || node.id, node: node.id, lines: [node.notice] })
  // 后端的列表阶段检查（索引被截断 / 脚本根不存在 / 没有适配器认得的文件 / 适配器没读到数据 / 适配器体检）：error 直接在列表上方标出来，全部进渲染诊断
  const nodeProblems = Array.isArray(node.problems) ? node.problems : []
  for (const item of nodeProblems) {
    problems.push({ kind: '节点', title: `${item.level === 'error' ? '错误' : '提示'} · ${item.code}`, node: node.id, lines: [item.message, ...(Array.isArray(item.details) ? item.details : [])] })
    if (item.level === 'error') body.append(el('div', 'gal-browse-notice gal-browse-error', item.message))
  }
  if (!node.items.length && !node.notice) problems.push({ kind: '节点', title: node.title || node.id, node: node.id, lines: ['列表是空的：目录里没有被适配器认出的脚本（检查脚本根 / 扩展名 / 隐藏目录 / 筛选条件）'] })
  for (const item of node.items) {
    const card = el('button', `gal-card ${item.type === 'dir' ? 'is-dir' : 'is-script'}`)
    card.type = 'button'
    card.dataset.node = item.node
    card.dataset.title = item.title
    card.title = item.title
    const thumb = thumbOf(item, 'gal-card-thumb')
    if (item.badge) thumb.append(el('span', 'gal-card-badge', item.badge))
    if (item.type === 'script') {
      const progressTag = progressBadge(item.node)
      if (progressTag) { progressTag.classList.add('gal-card-progress'); thumb.append(progressTag) }
    }
    if (item.issues?.length) problems.push({ kind: '脚本问题', title: item.title, node: item.node, lines: item.issues })
    if (item.node !== 'x:expr') thumb.append(voice.attach(item.node, item.node, { title: `随机放一条「${item.title}」里的语音（不打开）` }))
    card.append(thumb, el('div', 'gal-card-title', item.title))
    if (item.subtitle) card.append(el('div', 'gal-card-sub', item.subtitle))
    // 场景跳转点（config.sceneMarkers，服务端按规则算好的 item.markers）：每个一个小按钮，点了从那一步开始播（不触发整张卡片的点击）
    if (item.type === 'script' && item.markers?.length) {
      const marks = el('div', 'gal-card-marks')
      for (const mark of item.markers.slice(0, 12)) {
        const button = el('button', 'gal-card-mark', mark.label)
        button.type = 'button'
        button.title = `从第 ${mark.step + 1} 步开始（约 ${Math.round((mark.ratio || 0) * 100)}%）`
        button.dataset.step = String(mark.step)
        button.addEventListener('click', (event) => { event.stopPropagation(); onOpen(item.node, 'child', { at: mark.step }) })
        marks.append(button)
      }
      card.append(marks)
    }
    card.addEventListener('click', () => onOpen(item.node, 'child'))
    body.append(card)
    for (const cycle of cardCycles.splice(0)) cycles.push(attachThumbCycle({ target: card, ...cycle }))
  }

  root.append(body, bar)
  refreshDiag()

  container.replaceChildren(root)
  if (thumbLoader && thumbImages.length) thumbLoader.attach(thumbImages, { root: container })
  return { destroy: () => { thumbRenderer.destroy(); voice.destroy(); document.removeEventListener('click', onVoiceDocClick); document.removeEventListener('keydown', onKey); document.removeEventListener('click', onDocClick); for (const cycle of cycles) cycle?.destroy(); thumbLoader?.reset(); root.remove() }, setImmersive, root }
}
