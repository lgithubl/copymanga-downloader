const els = {
  token: document.querySelector('#token'),
  username: document.querySelector('#username'),
  password: document.querySelector('#password'),
  login: document.querySelector('#login'),
  keyword: document.querySelector('#keyword'),
  search: document.querySelector('#search'),
  results: document.querySelector('#results'),
  discoverOrdering: document.querySelector('#discover-ordering'),
  discoverTheme: document.querySelector('#discover-theme'),
  discoverRegion: document.querySelector('#discover-region'),
  discoverStatus: document.querySelector('#discover-status'),
  discoverLimit: document.querySelector('#discover-limit'),
  discoverRefresh: document.querySelector('#discover-refresh'),
  discoverPrev: document.querySelector('#discover-prev'),
  discoverNext: document.querySelector('#discover-next'),
  discoverMeta: document.querySelector('#discover-meta'),
  discoverResults: document.querySelector('#discover-results'),
  discoverChapters: document.querySelector('#discover-chapters'),
  discoverComicTitle: document.querySelector('#discover-comic-title'),
  discoverDownload: document.querySelector('#discover-download'),
  discoverDownloadAll: document.querySelector('#discover-download-all'),
  tabs: [...document.querySelectorAll('.tab')],
  views: [...document.querySelectorAll('.view')],
  chapters: document.querySelector('#chapters'),
  comicTitle: document.querySelector('#comic-title'),
  download: document.querySelector('#download'),
  downloadAll: document.querySelector('#download-all'),
  jobs: document.querySelector('#jobs'),
  retryFailed: document.querySelector('#retry-failed'),
  clearActive: document.querySelector('#clear-active'),
  favoriteOrdering: document.querySelector('#favorite-ordering'),
  favoriteRefresh: document.querySelector('#favorite-refresh'),
  favorites: document.querySelector('#favorites'),
  downloadedRefresh: document.querySelector('#downloaded-refresh'),
  downloadedUpdate: document.querySelector('#downloaded-update'),
  downloaded: document.querySelector('#downloaded'),
  configSave: document.querySelector('#config-save'),
  configDownloadDir: document.querySelector('#config-download-dir'),
  configMetadataDir: document.querySelector('#config-metadata-dir'),
  configDownloadFormat: document.querySelector('#config-download-format'),
  configEnablePickedSyncGuard: document.querySelector('#config-enable-picked-sync-guard'),
  configComicDirFmt: document.querySelector('#config-comic-dir-fmt'),
  configChapterDirFmt: document.querySelector('#config-chapter-dir-fmt'),
  configToken: document.querySelector('#config-token'),
  configApiDomainMode: document.querySelector('#config-api-domain-mode'),
  configCustomApiDomain: document.querySelector('#config-custom-api-domain'),
  configEnableFileLogger: document.querySelector('#config-enable-file-logger'),
  configChapterConcurrency: document.querySelector('#config-chapter-concurrency'),
  configChapterDownloadIntervalSec: document.querySelector('#config-chapter-download-interval-sec'),
  configImgConcurrency: document.querySelector('#config-img-concurrency'),
  configImgDownloadIntervalSec: document.querySelector('#config-img-download-interval-sec'),
  configUpdateDownloadedComicsIntervalSec: document.querySelector('#config-update-downloaded-comics-interval-sec'),
  configExportDir: document.querySelector('#config-export-dir'),
  configExportDirFmt: document.querySelector('#config-export-dir-fmt'),
  configMergePdfFmt: document.querySelector('#config-merge-pdf-fmt'),
  configCreatePdfConcurrency: document.querySelector('#config-create-pdf-concurrency'),
  configEnableMergePdf: document.querySelector('#config-enable-merge-pdf'),
  configExportSkipMode: document.querySelector('#config-export-skip-mode'),
}

let currentComicPathWord = ''
let jobs = []
let downloaded = []
let discoverOffset = 0
let discoverTotal = 0

els.token.value = localStorage.getItem('copymanga.token') || ''
els.token.addEventListener('input', () => localStorage.setItem('copymanga.token', els.token.value.trim()))

async function api(path, options = {}) {
  const resp = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
  return data
}

function setLoading(button, loading) {
  button.disabled = loading
  button.dataset.text ||= button.textContent
  button.textContent = loading ? '处理中...' : button.dataset.text
}

function pickComicTitle(item) {
  return item.name || item.title || item.comic?.name || item.path_word || '未知漫画'
}

function pickComicPathWord(item) {
  return item.path_word || item.pathWord || item.comic?.path_word || item.comic?.pathWord
}

function pickComicCover(item) {
  return item.cover || item.comic?.cover || ''
}

function chapterId(chapter) {
  return chapter.uuid || chapter.chapter_uuid || chapter.chapterUuid
}

function chapterTitle(chapter) {
  return chapter.name || chapter.chapter_name || chapter.chapterTitle || chapter.chapter_title || chapterId(chapter)
}

function renderResults(data) {
  const list = data.list || data.comics || data.results?.list || []
  els.results.innerHTML = ''
  renderComicCards(els.results, list)
}

function renderComicCards(container, list, onPick = undefined) {
  const downloadedPathWords = new Set(downloaded.map((item) => item.comicPathWord))
  container.innerHTML = ''
  for (const item of list) {
    const comic = item.comic || item
    const pathWord = pickComicPathWord(comic)
    const isDownloaded = comic.isDownloaded || downloadedPathWords.has(pathWord)
    const card = document.createElement('article')
    card.className = `card${isDownloaded ? ' downloaded-card' : ''}`
    card.innerHTML = `
      ${renderCover(pickComicCover(comic), pickComicTitle(comic))}
      <div class="card-body">
        <div class="card-title">${escapeHtml(pickComicTitle(comic))}</div>
        <div class="muted">${escapeHtml(pathWord || '')}</div>
        ${isDownloaded ? '<div class="badge">已下载</div>' : ''}
      </div>
    `
    card.addEventListener('click', () => {
      if (onPick) {
        onPick(pathWord)
      } else {
        showView('search-view')
        loadComic(pathWord)
      }
    })
    container.append(card)
  }
  if (list.length === 0) container.innerHTML = '<p class="muted">没有结果</p>'
}

function renderDiscover(data) {
  const list = data.list || []
  discoverTotal = Number(data.total || 0)
  const limit = Number(data.limit || els.discoverLimit.value || 10)
  discoverOffset = Number(data.offset || discoverOffset)
  els.discoverMeta.textContent = `共 ${discoverTotal} 部 · ${Math.floor(discoverOffset / limit) + 1} 页`
  els.discoverPrev.disabled = discoverOffset <= 0
  els.discoverNext.disabled = discoverOffset + limit >= discoverTotal
  renderComicCards(els.discoverResults, list, (pathWord) => loadComic(pathWord, 'discover'))
}

function renderDownloaded(list) {
  downloaded = list
  els.downloaded.innerHTML = ''
  for (const item of list) {
    const card = document.createElement('article')
    card.className = 'card'
    card.innerHTML = `
      ${renderCover(item.cover, item.title)}
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="muted">${escapeHtml(item.comicPathWord)}</div>
        <div class="muted">${item.chapterCount} 章 · ${item.imageCount} 张图 · ${escapeHtml(item.path)}</div>
        <div class="badge">已下载</div>
      </div>
    `
    if (item.comicPathWord) {
      card.addEventListener('click', () => {
        showView('search-view')
        loadComic(item.comicPathWord)
      })
    }
    els.downloaded.append(card)
  }
  if (list.length === 0) els.downloaded.innerHTML = '<p class="muted">暂无本地库存</p>'
}

function showView(id) {
  for (const view of els.views) view.classList.toggle('active', view.id === id)
  for (const tab of els.tabs) tab.classList.toggle('active', tab.dataset.view === id)
}

function renderComic(data, target = 'search') {
  const isDiscover = target === 'discover'
  const comicTitleEl = isDiscover ? els.discoverComicTitle : els.comicTitle
  const downloadButton = isDiscover ? els.discoverDownload : els.download
  const downloadAllButton = isDiscover ? els.discoverDownloadAll : els.downloadAll
  const chaptersEl = isDiscover ? els.discoverChapters : els.chapters
  currentComicPathWord = data.comic?.path_word || data.comic?.pathWord || data.path_word || ''
  comicTitleEl.textContent = data.comic?.name || data.name || '章节'
  downloadButton.disabled = false
  downloadAllButton.disabled = false
  chaptersEl.innerHTML = ''

  for (const [groupPathWord, chapters] of Object.entries(data.groupsChapters || {})) {
    const group = document.createElement('div')
    group.className = 'group'
    const title = data.groups?.[groupPathWord]?.name || data.groups?.[groupPathWord]?.title || groupPathWord
    group.innerHTML = `<h3>${escapeHtml(title)}</h3>`

    for (const chapter of chapters) {
      const id = chapterId(chapter)
      const isDownloaded = chapter.isDownloaded === true
      const row = document.createElement('label')
      row.className = `chapter${isDownloaded ? ' downloaded-chapter' : ''}`
      row.innerHTML = `
        <input type="checkbox" value="${escapeHtml(id)}" ${isDownloaded ? 'disabled' : ''} />
        <span>
          <span class="chapter-title">${escapeHtml(chapterTitle(chapter))}</span>
          <span class="muted">${escapeHtml(id)}${isDownloaded ? ' · 已下载' : ''}</span>
        </span>
      `
      group.append(row)
    }
    chaptersEl.append(group)
  }
}

function renderJobs() {
  els.jobs.innerHTML = ''
  const visible = jobs.filter((job) => job.status !== 'completed')
  const sorted = [...visible].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  for (const job of sorted) {
    const total = Math.max(job.totalImages || job.totalChapters || 1, 1)
    const done = job.totalImages ? job.doneImages : job.doneChapters
    const pct = Math.min(100, Math.round((done / total) * 100))
    const el = document.createElement('article')
    el.className = `job ${job.status}`
    el.innerHTML = `
      <strong>${escapeHtml(job.comicTitle || job.comicPathWord || job.id)}</strong>
      <div class="muted">${escapeHtml(job.status)} · ${escapeHtml(job.message || '')}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="muted">章节 ${job.doneChapters}/${job.totalChapters} · 图片 ${job.doneImages}/${job.totalImages || '?'}</div>
    `
    els.jobs.append(el)
  }
  if (sorted.length === 0) els.jobs.innerHTML = '<p class="muted">暂无任务</p>'
}

async function loadComic(pathWord, target = 'search') {
  if (!pathWord) return
  const chaptersEl = target === 'discover' ? els.discoverChapters : els.chapters
  chaptersEl.innerHTML = '<p class="muted">加载章节中...</p>'
  const data = await api(`/api/comic/${encodeURIComponent(pathWord)}`)
  renderComic(data, target)
}

async function refreshDownloadedState() {
  downloaded = await api('/api/downloaded')
}

async function loadConfig() {
  const config = await api('/api/config')
  els.configToken.value = config.token || els.token.value.trim() || ''
  if (config.token && !els.token.value) {
    els.token.value = config.token
    localStorage.setItem('copymanga.token', config.token)
  }
  els.configDownloadDir.value = config.downloadDir
  els.configMetadataDir.value = config.metadataDir
  els.configDownloadFormat.value = config.downloadFormat
  els.configEnablePickedSyncGuard.checked = config.enablePickedComicSyncGuard
  els.configComicDirFmt.value = config.comicDirFmt
  els.configChapterDirFmt.value = config.chapterDirFmt
  els.configApiDomainMode.value = config.apiDomainMode
  els.configCustomApiDomain.value = config.customApiDomain
  els.configEnableFileLogger.checked = config.enableFileLogger
  els.configChapterConcurrency.value = config.chapterConcurrency
  els.configChapterDownloadIntervalSec.value = config.chapterDownloadIntervalSec
  els.configImgConcurrency.value = config.imgConcurrency
  els.configImgDownloadIntervalSec.value = config.imgDownloadIntervalSec
  els.configUpdateDownloadedComicsIntervalSec.value = config.updateDownloadedComicsIntervalSec
  els.configExportDir.value = config.exportDir
  els.configExportDirFmt.value = config.exportDirFmt
  els.configMergePdfFmt.value = config.mergePdfFmt
  els.configCreatePdfConcurrency.value = config.createPdfConcurrency
  els.configEnableMergePdf.checked = config.enableMergePdf
  els.configExportSkipMode.value = config.exportSkipMode
}

els.login.addEventListener('click', async () => {
  try {
    setLoading(els.login, true)
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: els.username.value, password: els.password.value }),
    })
    const token = data.token || data.results?.token
    if (!token) throw new Error('登录成功但响应里没有 token')
    els.token.value = token
    localStorage.setItem('copymanga.token', token)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.login, false)
  }
})

els.search.addEventListener('click', async () => {
  try {
    setLoading(els.search, true)
    const q = encodeURIComponent(els.keyword.value.trim())
    const data = await api(`/api/search?q=${q}&page=1`)
    await refreshDownloadedState()
    renderResults(data)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.search, false)
  }
})

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    showView(tab.dataset.view)
    if (tab.dataset.view === 'discover-view') loadDiscover()
    if (tab.dataset.view === 'favorite-view') loadFavorite()
    if (tab.dataset.view === 'downloaded-view') loadDownloaded()
    if (tab.dataset.view === 'settings-view') loadConfig()
  })
})

async function loadFavorite() {
  try {
    setLoading(els.favoriteRefresh, true)
    const params = new URLSearchParams({
      page: '1',
      ordering: els.favoriteOrdering.value,
      token: els.token.value.trim(),
    })
    const data = await api(`/api/favorite?${params}`)
    await refreshDownloadedState()
    renderComicCards(els.favorites, data.list || [])
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.favoriteRefresh, false)
  }
}

async function loadDiscover() {
  try {
    setLoading(els.discoverRefresh, true)
    const params = new URLSearchParams({
      ordering: els.discoverOrdering.value,
      offset: String(discoverOffset),
      limit: els.discoverLimit.value,
    })
    if (els.discoverTheme.value) params.set('theme', els.discoverTheme.value)
    if (els.discoverRegion.value !== '') params.set('region', els.discoverRegion.value)
    if (els.discoverStatus.value !== '') params.set('status', els.discoverStatus.value)
    await refreshDownloadedState()
    renderDiscover(await api(`/api/comics?${params}`))
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.discoverRefresh, false)
  }
}

async function loadDownloaded() {
  try {
    setLoading(els.downloadedRefresh, true)
    renderDownloaded(await api('/api/downloaded'))
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.downloadedRefresh, false)
  }
}

els.favoriteRefresh.addEventListener('click', loadFavorite)
els.favoriteOrdering.addEventListener('change', loadFavorite)
els.discoverRefresh.addEventListener('click', () => {
  discoverOffset = 0
  loadDiscover()
})
for (const control of [els.discoverOrdering, els.discoverTheme, els.discoverRegion, els.discoverStatus, els.discoverLimit]) {
  control.addEventListener('change', () => {
    discoverOffset = 0
    loadDiscover()
  })
}
els.discoverPrev.addEventListener('click', () => {
  discoverOffset = Math.max(0, discoverOffset - Number(els.discoverLimit.value || 10))
  loadDiscover()
})
els.discoverNext.addEventListener('click', () => {
  discoverOffset += Number(els.discoverLimit.value || 10)
  loadDiscover()
})
els.downloadedRefresh.addEventListener('click', loadDownloaded)
els.downloadedUpdate.addEventListener('click', async () => {
  try {
    setLoading(els.downloadedUpdate, true)
    const data = await api('/api/downloaded/update', {
      method: 'POST',
      body: JSON.stringify({ token: els.token.value.trim() }),
    })
    const createdJobs = data.jobs || []
    const createdIds = new Set(createdJobs.map((job) => job.id))
    jobs = [...createdJobs, ...jobs.filter((item) => !createdIds.has(item.id))]
    renderJobs()
    await loadDownloaded()
    alert(`已检查 ${data.total} 部本地漫画，创建 ${data.created} 个下载任务`)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.downloadedUpdate, false)
  }
})
els.configSave.addEventListener('click', async () => {
  try {
    setLoading(els.configSave, true)
    els.token.value = els.configToken.value.trim()
    localStorage.setItem('copymanga.token', els.token.value)
    await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({
        token: els.configToken.value.trim(),
        metadataDir: els.configMetadataDir.value,
        downloadFormat: els.configDownloadFormat.value,
        enablePickedComicSyncGuard: els.configEnablePickedSyncGuard.checked,
        comicDirFmt: els.configComicDirFmt.value,
        chapterDirFmt: els.configChapterDirFmt.value,
        apiDomainMode: els.configApiDomainMode.value,
        customApiDomain: els.configCustomApiDomain.value,
        enableFileLogger: els.configEnableFileLogger.checked,
        chapterConcurrency: Number(els.configChapterConcurrency.value),
        chapterDownloadIntervalSec: Number(els.configChapterDownloadIntervalSec.value),
        imgConcurrency: Number(els.configImgConcurrency.value),
        imgDownloadIntervalSec: Number(els.configImgDownloadIntervalSec.value),
        updateDownloadedComicsIntervalSec: Number(els.configUpdateDownloadedComicsIntervalSec.value),
        exportDir: els.configExportDir.value,
        exportDirFmt: els.configExportDirFmt.value,
        mergePdfFmt: els.configMergePdfFmt.value,
        createPdfConcurrency: Number(els.configCreatePdfConcurrency.value),
        enableMergePdf: els.configEnableMergePdf.checked,
        exportSkipMode: els.configExportSkipMode.value,
      }),
    })
    await loadConfig()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.configSave, false)
  }
})
els.retryFailed.addEventListener('click', async () => {
  try {
    setLoading(els.retryFailed, true)
    const data = await api('/api/jobs/retry-failed', { method: 'POST', body: '{}' })
    jobs = [...data.retried, ...jobs.filter((job) => job.status !== 'failed')]
    renderJobs()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.retryFailed, false)
  }
})
els.clearActive.addEventListener('click', async () => {
  try {
    setLoading(els.clearActive, true)
    await api('/api/jobs/clear-active', { method: 'POST', body: '{}' })
    jobs = jobs.filter((job) => job.status === 'completed')
    renderJobs()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.clearActive, false)
  }
})

els.keyword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.search.click()
})

els.download.addEventListener('click', async () => {
  const chapterUuids = [...els.chapters.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value)
  await createDownload(chapterUuids, [els.download, els.downloadAll])
})

els.downloadAll.addEventListener('click', async () => {
  const checkboxes = [...els.chapters.querySelectorAll('input[type="checkbox"]:not(:disabled)')]
  for (const checkbox of checkboxes) checkbox.checked = true
  await createDownload(checkboxes.map((item) => item.value), [els.download, els.downloadAll])
})

els.discoverDownload.addEventListener('click', async () => {
  const chapterUuids = [...els.discoverChapters.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value)
  await createDownload(chapterUuids, [els.discoverDownload, els.discoverDownloadAll])
})

els.discoverDownloadAll.addEventListener('click', async () => {
  const checkboxes = [...els.discoverChapters.querySelectorAll('input[type="checkbox"]:not(:disabled)')]
  for (const checkbox of checkboxes) checkbox.checked = true
  await createDownload(checkboxes.map((item) => item.value), [els.discoverDownload, els.discoverDownloadAll])
})

async function createDownload(chapterUuids, buttons) {
  if (chapterUuids.length === 0) return alert('请先勾选章节')
  try {
    for (const button of buttons) setLoading(button, true)
    const data = await api('/api/download', {
      method: 'POST',
      body: JSON.stringify({
        comicPathWord: currentComicPathWord,
        chapterUuids,
        token: els.token.value.trim(),
      }),
    })
    const createdJobs = data.jobs || [data]
    const createdIds = new Set(createdJobs.map((job) => job.id))
    jobs = [...createdJobs, ...jobs.filter((item) => !createdIds.has(item.id))]
    renderJobs()
  } catch (error) {
    alert(error.message)
  } finally {
    for (const button of buttons) setLoading(button, false)
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char])
}

function renderCover(src, alt) {
  if (!src) return '<div class="cover placeholder"></div>'
  return `<img class="cover" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`
}

api('/api/jobs').then((data) => {
  jobs = data
  renderJobs()
})

async function syncJobs() {
  const previousCompleted = new Set(jobs.filter((job) => job.status === 'completed').map((job) => job.id))
  jobs = await api('/api/jobs')
  renderJobs()
  const hasNewCompletion = jobs.some((job) => job.status === 'completed' && !previousCompleted.has(job.id))
  if (hasNewCompletion) {
    await refreshDownloadedState()
    if (currentComicPathWord) await loadComic(currentComicPathWord)
    if (document.querySelector('#downloaded-view')?.classList.contains('active')) renderDownloaded(downloaded)
  }
}

const events = new EventSource('/api/events')
events.addEventListener('job', (event) => {
  const job = JSON.parse(event.data)
  jobs = [job, ...jobs.filter((item) => item.id !== job.id)]
  renderJobs()
  if (job.status === 'completed') {
    refreshDownloadedState().then(() => {
      if (currentComicPathWord === job.comicPathWord) loadComic(currentComicPathWord)
      if (document.querySelector('#downloaded-view')?.classList.contains('active')) renderDownloaded(downloaded)
    })
  }
})
events.addEventListener('jobDelete', (event) => {
  const { id } = JSON.parse(event.data)
  jobs = jobs.filter((job) => job.id !== id)
  renderJobs()
})

refreshDownloadedState().catch(() => {})
loadConfig().catch(() => {})
setInterval(() => {
  syncJobs().catch(() => {})
}, 2000)
