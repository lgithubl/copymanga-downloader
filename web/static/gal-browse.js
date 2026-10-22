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
//   onToggleImmersive()  进入/退出沉浸      onLeave()  离开这个媒体（沉浸里头部藏起来了，所以这里也要有）
//   onEscape()           沉浸时按 Esc
export function createGalBrowser({ container, reader, progress = {}, onOpen = () => {}, onToggleImmersive = null, onLeave = null, onEscape = null }) {
  const node = reader.node
  const root = el('div', 'gal-browse')
  root.dataset.node = node.id

  // 顶部：面包屑（每一级都能点）+ 上一级
  const head = el('div', 'gal-browse-head')
  const up = el('button', 'gal-browse-up', '↑ 上一级')
  up.type = 'button'
  up.hidden = node.parent == null
  up.addEventListener('click', () => { if (node.parent != null) onOpen(node.parent) })
  const crumbs = el('nav', 'gal-browse-crumbs')
  crumbs.setAttribute('aria-label', '位置')
  node.breadcrumb.forEach((crumb, index) => {
    const last = index === node.breadcrumb.length - 1
    if (index) crumbs.append(el('span', 'gal-browse-sep', '›'))
    const item = el(last ? 'span' : 'button', last ? 'gal-browse-crumb current' : 'gal-browse-crumb', crumb.title)
    if (!last) {
      item.type = 'button'
      item.addEventListener('click', () => onOpen(crumb.id))
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
    select.addEventListener('change', () => onOpen(select.value))
    head.append(select)
  }
  const immBtn = el('button', 'gal-browse-imm', '沉浸')
  immBtn.type = 'button'
  immBtn.title = '沉浸模式（I）'
  immBtn.hidden = !onToggleImmersive
  immBtn.addEventListener('click', () => onToggleImmersive?.())
  const leaveBtn = el('button', 'gal-browse-leave', '返回')
  leaveBtn.type = 'button'
  leaveBtn.title = '退出沉浸并离开这个媒体'
  leaveBtn.hidden = !onLeave
  leaveBtn.addEventListener('click', () => onLeave?.())
  head.append(immBtn, leaveBtn)
  root.append(head)
  function setImmersive(active) {
    root.classList.toggle('is-immersive', Boolean(active))
    immBtn.textContent = active ? '退出沉浸' : '沉浸'
    immBtn.classList.toggle('active', Boolean(active))
  }
  const onKey = (event) => {
    if (!root.isConnected || event.ctrlKey || event.metaKey || event.altKey) return
    if (!root.getClientRects().length) return
    const tag = event.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return
    if ((event.key === 'i' || event.key === 'I') && onToggleImmersive) onToggleImmersive()
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
  const thumbOf = (item, className) => {
    const box = el('div', className)
    if (!item.thumb && item.type === 'dir') box.dataset.icon = '📁'
    if (item.thumb) {
      const img = el('img')
      img.loading = 'lazy'
      img.alt = ''
      img.src = assetUrl(reader.resourceBase, item.thumb)
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
    card.addEventListener('click', () => onOpen(item.node))
    body.append(card)
  }
  root.append(body)

  // 翻页：节点 id 是 `<基础 id>#<页码>`
  if (node.pageCount > 1) {
    const base = node.id.split('#')[0]
    const bar = el('div', 'gal-browse-pager')
    const go = (page) => onOpen(`${base}#${page}`)
    const prev = el('button', 'gal-pager-btn', '‹ 上一页')
    prev.type = 'button'
    prev.disabled = node.page <= 1
    prev.addEventListener('click', () => go(node.page - 1))
    const next = el('button', 'gal-pager-btn', '下一页 ›')
    next.type = 'button'
    next.disabled = node.page >= node.pageCount
    next.addEventListener('click', () => go(node.page + 1))
    bar.append(prev, el('span', 'gal-pager-info', `${node.page} / ${node.pageCount} · 共 ${node.total} 项`), next)
    root.append(bar)
  }

  container.replaceChildren(root)
  return { destroy: () => { document.removeEventListener('keydown', onKey); root.remove() }, setImmersive, root }
}
