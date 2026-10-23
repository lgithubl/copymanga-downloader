// Gal 的浏览层：把后端给的「节点」（web/library/gal/browse.mjs）渲染成卡片网格 / 列表，选项自带下一个节点的 id，
// 点了就 onOpen(节点 id)，由页面层再取一次（reader?sectionId=…）。这里不认识目录结构，只认 kind / items。
// 全部用 textContent / setAttribute 写入后端给的文字，不拼 innerHTML。
import { assetUrl } from './gal-engine.js'

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

// progress：{ [节点 id]: { ratio, completedAt } }，用来在列表里标「看到 x%」/「已看完」
// 沉浸是整个页面的状态（和播放页共用同一套：页面层隐藏头部/顶栏），这里只在顶栏里放按钮：
//   onToggleImmersive()  进入/退出沉浸（和全屏一起收在「更多」菜单里）      onLeave()  离开这个媒体（沉浸里头部藏起来了，所以这里也要有）
//   onEscape()           沉浸时按 Esc
// onOpen(节点 id, kind)：kind = 'child'（点卡片进下一层）/ 'up'（上一级、面包屑）/ 'self'（同一层换页、换筛选/排序、换文本版本）；页面层靠它记「回来时的页码和筛选」
// thumbLoader：可选，卡片缩略图交给它分批加载（图只带 data-src）；不传就用浏览器自带的 lazy
// 列表很长（100/1000 张卡片）时：筛选 / 排序 / 每页条数 / 翻页都是服务端按节点 id 里的视图参数做的（node.view / node.viewBase），这里只拼 id
let refocusSearch = ''   // 搜索框触发的重绘后，把焦点还给新的搜索框（重绘是整页换节点）
export function createGalBrowser({ container, reader, progress = {}, onOpen = () => {}, onToggleImmersive = null, onLeave = null, onEscape = null, thumbLoader = null }) {
  const node = reader.node
  const root = el('div', 'gal-browse')
  root.dataset.node = node.id

  // 顶部：面包屑（每一级都能点）+ 上一级
  const head = el('div', 'gal-browse-head')
  const up = el('button', 'gal-browse-up', '↑ 上一级')
  up.type = 'button'
  up.hidden = node.parent == null
  up.addEventListener('click', () => { if (node.parent != null) onOpen(node.parent, 'up') })
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
  head.append(up, crumbs)
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
    head.append(select)
  }
  // 「更多」：沉浸 / 全屏（沉浸按钮不再高亮：它的状态看文字「沉浸 / 退出沉浸」就够了）
  const more = el('div', 'gal-browse-more')
  const moreBtn = el('button', 'gal-browse-more-btn', '更多 ▾')
  moreBtn.type = 'button'
  moreBtn.title = '沉浸 / 全屏'
  const moreMenu = el('div', 'gal-browse-more-menu')
  moreMenu.hidden = true
  const closeMenu = () => { moreMenu.hidden = true }
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
  moreBtn.addEventListener('click', (event) => { event.stopPropagation(); moreMenu.hidden = !moreMenu.hidden })
  const onDocClick = (event) => { if (!more.contains(event.target)) closeMenu() }
  document.addEventListener('click', onDocClick)
  moreMenu.append(immBtn, fsBtn)
  more.append(moreBtn, moreMenu)
  const leaveBtn = el('button', 'gal-browse-leave', '返回')
  leaveBtn.type = 'button'
  leaveBtn.title = '退出沉浸并离开这个媒体'
  leaveBtn.hidden = !onLeave
  leaveBtn.addEventListener('click', () => onLeave?.())
  head.append(more, leaveBtn)
  root.append(head)
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
    if (!item.thumb && item.type === 'dir') box.dataset.icon = '📁'
    if (item.thumb) {
      const img = el('img')
      img.alt = ''
      img.decoding = 'async'
      const src = assetUrl(reader.resourceBase, item.thumb)
      if (thumbLoader) { img.dataset.src = src; thumbImages.push(img) } else { img.loading = 'lazy'; img.src = src }
      img.addEventListener('error', () => { img.remove(); box.classList.add('empty') })
      box.append(img)
    } else {
      box.classList.add('empty')
    }
    return box
  }

  // 一律卡片：目录卡片（头像/文件夹图标、中文标签、数量）和脚本卡片（缩略图、台词摘要）混排，右上角的小标签是来源（合并目录时用来分辨来自哪个目录）
  const body = el('div', 'gal-browse-body gal-browse-cards')
  if (node.notice) body.append(el('div', 'gal-browse-notice', node.notice))
  if (!node.items.length) body.append(el('div', 'gal-browse-empty', '这里还没有内容'))
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
    card.append(thumb, el('div', 'gal-card-title', item.title))
    if (item.subtitle) card.append(el('div', 'gal-card-sub', item.subtitle))
    card.addEventListener('click', () => onOpen(item.node, 'child'))
    body.append(card)
  }

  // 工具栏：搜索 / 排序 / 每页条数 + 当前范围；列表不到一页又没筛选时只留搜索（太短的列表不需要排序和页数）
  const buildPager = (compact) => {
    if (node.pageCount <= 1) return null
    const bar = el('div', compact ? 'gal-browse-pager compact' : 'gal-browse-pager')
    const mk = (text, title, page, disabled) => {
      const b = el('button', 'gal-pager-btn', text)
      b.type = 'button'
      b.title = title
      b.disabled = disabled
      b.addEventListener('click', () => go(view ? viewId({}, page) : `${node.id.split('#')[0]}#${page}`))
      return b
    }
    bar.append(mk('«', '第一页', 1, node.page <= 1), mk('‹ 上一页', '上一页', node.page - 1, node.page <= 1))
    const jump = el('input', 'gal-pager-jump')
    jump.type = 'number'
    jump.min = '1'
    jump.max = String(node.pageCount)
    jump.value = String(node.page)
    jump.title = '输入页码回车跳转'
    jump.setAttribute('aria-label', '跳到第几页')
    jump.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      const page = Math.max(1, Math.min(node.pageCount, Math.floor(Number(jump.value)) || node.page))
      if (page !== node.page) go(view ? viewId({}, page) : `${node.id.split('#')[0]}#${page}`)
    })
    bar.append(jump, el('span', 'gal-pager-info', `/ ${node.pageCount} 页`), mk('下一页 ›', '下一页', node.page + 1, node.page >= node.pageCount), mk('»', '最后一页', node.pageCount, node.page >= node.pageCount))
    return bar
  }

  if (view && (view.unfiltered > 8 || view.q)) {
    const tools = el('div', 'gal-browse-tools')
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
    sort.addEventListener('change', () => go(viewId({ sort: sort.value }, 1)))
    const size = el('select', 'gal-browse-size')
    size.title = '每页条数'
    for (const n of view.sizes || []) {
      const option = el('option', '', `${n} / 页`)
      option.value = String(n)
      option.selected = n === view.size
      size.append(option)
    }
    if (!(view.sizes || []).includes(view.size)) { const option = el('option', '', `${view.size} / 页`); option.value = String(view.size); option.selected = true; size.append(option) }
    size.addEventListener('change', () => go(viewId({ size: Number(size.value) === view.defaultSize ? 0 : Number(size.value) }, 1)))
    const from = node.total ? (node.page - 1) * node.pageSize + 1 : 0
    const to = Math.min(node.total, node.page * node.pageSize)
    const range = el('span', 'gal-browse-range', view.q
      ? `筛选「${view.q}」：${node.total} / ${view.unfiltered} 项${node.total ? ` · 第 ${from}–${to} 项` : ''}`
      : `${node.total ? `第 ${from}–${to} 项 · ` : ''}共 ${node.total} 项`)
    tools.append(search, sort, size, range)
    if (view.q) {
      const clear = el('button', 'gal-pager-btn', '清除筛选')
      clear.type = 'button'
      clear.addEventListener('click', () => go(viewId({ q: '' }, 1)))
      tools.append(clear)
    }
    root.append(tools)
    if (refocusSearch === node.viewBase) {
      refocusSearch = ''
      queueMicrotask(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length) })
    }
  }
  const topPager = buildPager(true)
  if (topPager) root.append(topPager)
  root.append(body)
  const bottomPager = buildPager(false)
  if (bottomPager) root.append(bottomPager)

  container.replaceChildren(root)
  if (thumbLoader && thumbImages.length) thumbLoader.attach(thumbImages, { root: container })
  return { destroy: () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onDocClick); thumbLoader?.reset(); root.remove() }, setImmersive, root }
}
