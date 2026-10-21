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
export function createGalBrowser({ container, reader, progress = {}, onOpen = () => {} }) {
  const node = reader.node
  const root = el('div', `gal-browse gal-browse-${node.kind}`)
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
  root.append(head)

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

  const body = el('div', `gal-browse-body gal-browse-${node.kind}-body`)
  if (!node.items.length) body.append(el('div', 'gal-browse-empty', '这里还没有内容'))

  if (node.kind === 'grid') {
    for (const item of node.items) {
      const card = el('button', 'gal-card')
      card.type = 'button'
      card.dataset.node = item.node
      card.append(thumbOf(item, 'gal-card-thumb'), el('div', 'gal-card-title', item.title))
      if (item.subtitle) card.append(el('div', 'gal-card-sub', item.subtitle))
      card.addEventListener('click', () => onOpen(item.node))
      body.append(card)
    }
  } else {
    for (const item of node.items) {
      const row = el('div', 'gal-row')
      row.dataset.title = item.title
      const main = el(item.variants.length ? 'div' : 'button', 'gal-row-main')
      if (!item.variants.length) {
        main.type = 'button'
        main.dataset.node = item.node
        main.addEventListener('click', () => onOpen(item.node))
      }
      const text = el('div', 'gal-row-text')
      text.append(el('div', 'gal-row-title', item.title))
      if (item.subtitle) text.append(el('div', 'gal-row-sub', item.subtitle))
      main.append(thumbOf(item, 'gal-row-thumb'), text)
      row.append(main)
      const side = el('div', 'gal-row-side')
      if (item.variants.length) {
        for (const variant of item.variants) {
          const button = el('button', 'gal-variant', variant.label || '播放')
          button.type = 'button'
          button.dataset.node = variant.node
          button.addEventListener('click', () => onOpen(variant.node))
          const badge = progressBadge(variant.node)
          if (badge) button.append(badge)
          side.append(button)
        }
      } else {
        const badge = progressBadge(item.node)
        if (badge) side.append(badge)
      }
      row.append(side)
      body.append(row)
    }
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
  return { destroy: () => root.remove(), root }
}
