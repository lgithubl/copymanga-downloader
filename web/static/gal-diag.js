// 诊断中心（浏览页的弹框）：列表页卡片上的小按钮只负责「打开」这个窗口；窗口里列出支持的诊断，点了「运行」才请求服务端计算。
//   · 列出：GET <apiBase>/diagnostics?scope=card（只返回名字 / 说明 / 开销 / 参数，不计算）
//   · 运行：POST <apiBase>/diagnostics/<id>  { node: { type, id }, params }  → { summary, sections: [{ title, columns, rows }], notes, text, tookMs }
//   · 结果统一格式：这里只写一份渲染（表格 + 复制成文本 + 下载 JSON）；服务端加新诊断不用改这里
//   · heavy 的诊断先确认；运行中可以取消（abort 请求，服务端按断开处理）
function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const COST = { light: ['轻', '很快，基本不读文件'], medium: ['中', '会读文件 / 解压，可能要几秒'], heavy: ['重', '会遍历或解压很多文件，可能很慢'] }

export function createDiagnosticsDialog({ apiBase, fetchImpl = (...args) => fetch(...args) }) {
  let overlay = null
  let controller = null

  async function api(path, init) {
    const res = await fetchImpl(`${apiBase}${path}`, init)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  function renderResult(target, result) {
    target.replaceChildren()
    target.append(el('div', 'gal-diag-summary', `${result.summary || ''}${result.tookMs !== undefined ? `（用时 ${result.tookMs}ms）` : ''}`))
    for (const section of result.sections || []) {
      target.append(el('div', 'gal-diag-section-title', section.title))
      const wrap = el('div', 'gal-diag-table-wrap')
      const table = el('table', 'gal-diag-table')
      const head = el('tr')
      for (const c of section.columns) head.append(el('th', '', c))
      table.append(head)
      for (const row of section.rows) {
        const tr = el('tr')
        for (const cell of row) tr.append(el('td', '', String(cell ?? '')))
        table.append(tr)
      }
      wrap.append(table)
      target.append(wrap)
    }
    if (result.notes?.length) {
      const notes = el('ul', 'gal-diag-notes')
      for (const n of result.notes) notes.append(el('li', '', n))
      target.append(notes)
    }
    const actions = el('div', 'gal-diag-actions')
    const copy = el('button', 'gal-pager-btn', '复制为文本')
    copy.type = 'button'
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(result.text || '') ; copy.textContent = '已复制' } catch { copy.textContent = '复制失败（可以选中表格手动复制）' }
      setTimeout(() => { copy.textContent = '复制为文本' }, 1800)
    })
    const download = el('button', 'gal-pager-btn', '下载 JSON')
    download.type = 'button'
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
      const a = el('a'); a.href = url; a.download = `diagnostic-${result.id || 'result'}.json`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    })
    actions.append(copy, download)
    target.append(actions)
  }

  function close() {
    controller?.abort()
    controller = null
    overlay?.remove()
    overlay = null
  }

  // card：{ type: 'script' | 'dir', id, title }
  async function open({ card = null } = {}) {
    close()
    overlay = el('div', 'gal-diag-overlay')
    const dialog = el('div', 'gal-diag-dialog')
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close() })
    const head = el('div', 'gal-diag-head')
    head.append(el('div', 'gal-diag-title', `诊断${card?.title ? `：${card.title}` : ''}`))
    const closeBtn = el('button', 'gal-pager-btn', '关闭')
    closeBtn.type = 'button'
    closeBtn.addEventListener('click', close)
    head.append(closeBtn)
    const list = el('div', 'gal-diag-list')
    const out = el('div', 'gal-diag-result')
    out.append(el('div', 'gal-diag-hint', '选一项，点「运行」才会开始诊断。'))
    dialog.append(head, list, out)
    overlay.append(dialog)
    document.body.append(overlay)
    const onKey = (event) => { if (event.key === 'Escape') { document.removeEventListener('keydown', onKey, true); close() } }
    document.addEventListener('keydown', onKey, true)
    let defs
    try { defs = (await api(`/diagnostics?scope=${card ? 'card' : 'item'}`)).diagnostics } catch (error) { list.append(el('div', 'gal-diag-error', `读不到诊断列表：${error.message}`)); return }
    for (const def of defs) {
      const row = el('div', 'gal-diag-item')
      const title = el('div', 'gal-diag-item-title', def.title)
      const [costLabel, costTip] = COST[def.cost] || ['', '']
      if (costLabel) { const badge = el('span', `gal-diag-cost is-${def.cost}`, `开销：${costLabel}`); badge.title = costTip; title.append(badge) }
      row.append(title, el('div', 'gal-diag-desc', def.description))
      const inputs = {}
      const controls = el('div', 'gal-diag-controls')
      for (const p of def.params || []) {
        const input = el('input', 'gal-diag-input')
        input.type = 'number'
        input.min = String(p.min ?? 1); input.max = String(p.max ?? 999); input.value = String(p.default ?? '')
        inputs[p.key] = input
        const label = el('label', 'gal-diag-param', p.label)
        label.append(input)
        controls.append(label)
      }
      const run = el('button', 'gal-pager-btn gal-diag-run', '运行')
      run.type = 'button'
      run.addEventListener('click', async () => {
        if (def.cost === 'heavy' && !window.confirm(`「${def.title}」开销较大，可能要等一会儿。继续吗？`)) return
        controller?.abort()
        controller = new AbortController()
        const mine = controller
        run.disabled = true
        out.replaceChildren(el('div', 'gal-diag-hint', `正在诊断「${def.title}」…`))
        const cancel = el('button', 'gal-pager-btn', '取消')
        cancel.type = 'button'
        cancel.addEventListener('click', () => mine.abort())
        out.append(cancel)
        const params = {}
        for (const [k, input] of Object.entries(inputs)) params[k] = Number(input.value)
        try {
          const result = await api(`/diagnostics/${encodeURIComponent(def.id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ node: card ? { type: card.type, id: card.id } : null, params }), signal: mine.signal })
          if (mine === controller) renderResult(out, result)
        } catch (error) {
          if (error.name === 'AbortError') out.replaceChildren(el('div', 'gal-diag-hint', '已取消'))
          else out.replaceChildren(el('div', 'gal-diag-error', `诊断失败：${error.message}`))
        } finally { run.disabled = false }
      })
      controls.append(run)
      row.append(controls)
      list.append(row)
    }
    if (!defs.length) list.append(el('div', 'gal-diag-hint', '没有可用的诊断'))
  }

  return { open, close }
}
