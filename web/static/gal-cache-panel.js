// Status reads never refresh. Opening/closing this panel must not reset navigation.
export function createGalCachePanel({ reader, onStatus, onRefresh, onReload }) {
  const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    e.className = cls
    if (text) e.textContent = text
    return e
  }
  const button = el('button', 'gal-btn gal-cache-btn', '缓存'),
    dialog = el('dialog', 'gal-cache-dialog'),
    title = el('strong', '', '浏览缓存'),
    details = el('div', 'gal-cache-status'),
    refresh = el('button', 'gal-btn gal-cache-refresh', '刷新缓存'),
    reload = el('button', 'gal-btn gal-cache-apply', '应用更新'),
    close = el('button', 'gal-btn', '关闭'),
    row = el('div', 'gal-cache-actions')
  button.type = refresh.type = reload.type = close.type = 'button'
  button.title = '缓存状态 / 后台刷新'
  row.append(refresh, reload, close)
  dialog.append(title, details, row)
  let timer = null,
    dead = false,
    polling = false,
    current = reader.cache || {},
    error = ''
  const busy = () => ['queued', 'running'].includes(current.status)
  const format = (value) => (value ? new Date(value).toLocaleString() : '尚未建立')
  function draw() {
    if (dead) return
    const labels = {
      empty: '尚未建立',
      ready: '可用',
      queued: '排队中',
      running: '重建中',
      error: current.available === false ? '建立失败' : '刷新失败，保留原缓存',
    }
    const updated = current.builtAt && current.builtAt > (reader.cache?.builtAt || 0)
    button.textContent = busy()
      ? `缓存 · ${labels[current.status]}`
      : updated
        ? '缓存 · 已更新'
        : current.status === 'error'
          ? '缓存 · 失败'
          : '缓存'
    refresh.disabled = busy() || !onRefresh
    reload.disabled = busy() || !onReload || !updated
    const index = current.index || reader.node.index
    const lines = [
      `状态：${labels[current.status] || '可用'}`,
      `建立时间：${format(current.builtAt)}`,
      index
        ? `文件：${index.files} · 适配器：${(index.adapters || []).join(' / ')}${index.truncated ? '（索引已截断）' : ''}`
        : '',
      `当前目录：${reader.node.total ?? reader.node.items?.length ?? 0} 项${index?.scenes === undefined ? '' : ` · 索引场景：${index.scenes} 个`}`,
      current.phase ? `阶段：${current.phase}` : '',
      current.lastBuildReason || current.reason
        ? `原因：${busy() ? current.reason : current.lastBuildReason || current.reason}`
        : '',
      `浏览缓存重建并发：1 · 全局等待：${current.queued || 0}`,
      `首页磁盘快照：${current.diskSnapshotAt ? format(current.diskSnapshotAt) : '尚未建立'}；其他浏览页使用内存缓存`,
      `本次/上次耗时：${(((busy() ? current.elapsedMs : (current.lastBuildMs ?? current.ms)) || 0) / 1000).toFixed(1)} 秒`,
      current.error ? `错误：${current.error}` : '',
      error ? `状态查询失败：${error}` : '',
      updated
        ? '缓存已有更新，点击“应用更新”保留当前目录与页码重新加载。'
        : '刷新期间继续使用原结果；首次建立没有可用旧缓存时需要等待。',
    ]
    details.replaceChildren(...lines.filter(Boolean).map((t) => el('div', '', t)))
  }
  function arm() {
    clearTimeout(timer)
    if (!dead && (dialog.open || busy())) timer = setTimeout(poll, 1500)
  }
  async function poll() {
    if (dead || polling || !onStatus) return
    polling = true
    try {
      current = await onStatus()
      error = ''
    } catch (e) {
      error = String(e?.message || e)
    } finally {
      polling = false
      draw()
      arm()
    }
  }
  button.addEventListener('click', () => {
    dialog.showModal()
    poll()
  })
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', arm)
  refresh.addEventListener('click', async () => {
    refresh.disabled = true
    try {
      current = await onRefresh()
      error = ''
    } catch (e) {
      error = String(e?.message || e)
    }
    draw()
    arm()
  })
  reload.addEventListener('click', async () => {
    reload.disabled = true
    try {
      await onReload()
    } catch (e) {
      error = String(e?.message || e)
      draw()
    }
  })
  draw()
  arm()
  return {
    button,
    dialog,
    destroy() {
      dead = true
      clearTimeout(timer)
      if (dialog.open) dialog.close()
      dialog.remove()
      button.remove()
    },
  }
}
