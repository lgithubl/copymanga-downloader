const els = {
  token: document.querySelector('#token'),
  app: document.querySelector('#app'),
  sidebarToggle: document.querySelector('#sidebar-toggle'),
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
  discoverPage: document.querySelector('#discover-page'),
  discoverPageTotal: document.querySelector('#discover-page-total'),
  discoverJump: document.querySelector('#discover-jump'),
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
  downloadedUpdateScope: document.querySelector('#downloaded-update-scope'),
  inventoryProgress: document.querySelector('#inventory-progress'),
  inventoryProgressText: document.querySelector('#inventory-progress .inventory-progress-text'),
  inventoryProgressBar: document.querySelector('#inventory-progress-bar'),
  downloaded: document.querySelector('#downloaded'),
  downloadedPrev: document.querySelector('#downloaded-prev'),
  downloadedNext: document.querySelector('#downloaded-next'),
  downloadedPage: document.querySelector('#downloaded-page'),
  downloadedPageTotal: document.querySelector('#downloaded-page-total'),
  downloadedJump: document.querySelector('#downloaded-jump'),
  downloadedLimit: document.querySelector('#downloaded-limit'),
  viewerTitle: document.querySelector('#viewer-title'),
  viewerMeta: document.querySelector('#viewer-meta'),
  viewerRefresh: document.querySelector('#viewer-refresh'),
  viewerImages: document.querySelector('#viewer-images'),
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
  configViewerImageBatchSize: document.querySelector('#config-viewer-image-batch-size'),
  configUpdateDownloadedComicsIntervalSec: document.querySelector('#config-update-downloaded-comics-interval-sec'),
  configExportDir: document.querySelector('#config-export-dir'),
  configExportDirFmt: document.querySelector('#config-export-dir-fmt'),
  configMergePdfFmt: document.querySelector('#config-merge-pdf-fmt'),
  configCreatePdfConcurrency: document.querySelector('#config-create-pdf-concurrency'),
  configEnableMergePdf: document.querySelector('#config-enable-merge-pdf'),
  configExportSkipMode: document.querySelector('#config-export-skip-mode'),
}

let currentComicPathWord = ''
let currentComicTarget = 'search'
let jobs = []
let downloaded = []
let downloadedPage = 1
let discoverOffset = 0
let discoverTotal = 0
let inventoryUpdate = null
let viewerState = null
let viewerBatchSize = 5
let viewerImages = []
let viewerRendered = 0
let viewerSentinel = null
let viewerScrollHandler = null
let viewerAppendLocked = false

els.token.value = localStorage.getItem('copymanga.token') || ''
els.token.addEventListener('input', () => localStorage.setItem('copymanga.token', els.token.value.trim()))
const savedSidebarCollapsed = localStorage.getItem('copymanga.sidebarCollapsed')
els.app.classList.toggle('sidebar-collapsed', savedSidebarCollapsed === null ? true : savedSidebarCollapsed === '1')
els.sidebarToggle.textContent = els.app.classList.contains('sidebar-collapsed') ? '›' : '‹'
els.sidebarToggle.title = els.app.classList.contains('sidebar-collapsed') ? '展开任务栏' : '收缩任务栏'

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

function shortChapterTitle(chapter) {
  const title = chapterTitle(chapter)
  const order = chapter.ordered ?? chapter.index ?? chapter.order
  return order === undefined || String(title).includes(String(order)) ? title : `${order} ${title}`
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
  const page = Math.floor(discoverOffset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(discoverTotal / limit))
  els.discoverMeta.textContent = `共 ${discoverTotal} 部 · ${page}/${totalPages} 页`
  els.discoverPage.value = String(page)
  els.discoverPage.max = String(totalPages)
  els.discoverPageTotal.textContent = `/ ${totalPages} 页`
  els.discoverPrev.disabled = discoverOffset <= 0
  els.discoverNext.disabled = discoverOffset + limit >= discoverTotal
  renderComicCards(els.discoverResults, list, (pathWord) => loadComic(pathWord, 'discover'))
}

function renderDownloaded(list) {
  downloaded = list
  els.downloaded.innerHTML = ''
  const limit = Math.max(1, Number(els.downloadedLimit.value || 10))
  const totalPages = Math.max(1, Math.ceil(list.length / limit))
  downloadedPage = Math.max(1, Math.min(totalPages, downloadedPage))
  const offset = (downloadedPage - 1) * limit
  els.downloadedPage.value = String(downloadedPage)
  els.downloadedPage.max = String(totalPages)
  els.downloadedPageTotal.textContent = `/ ${totalPages} 页`
  els.downloadedPrev.disabled = downloadedPage <= 1
  els.downloadedNext.disabled = downloadedPage >= totalPages

  for (const item of list.slice(offset, offset + limit)) {
    const remoteChapterTotal = Number.isFinite(Number(item.remoteChapterTotal)) ? Number(item.remoteChapterTotal) : null
    const chapterTotalText = remoteChapterTotal && remoteChapterTotal > 0 ? String(remoteChapterTotal) : '?'
    const card = document.createElement('article')
    card.className = 'card'
    card.innerHTML = `
      ${renderCover(item.cover, item.title)}
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="muted">${escapeHtml(item.comicPathWord)}</div>
        <div class="muted">本地 ${item.chapterCount}/${chapterTotalText} 章 · ${item.imageCount} 张图 · ${escapeHtml(item.path)}</div>
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

function jumpDownloadedPage() {
  const limit = Math.max(1, Number(els.downloadedLimit.value || 10))
  const totalPages = Math.max(1, Math.ceil(downloaded.length / limit))
  downloadedPage = Math.max(1, Math.min(totalPages, Math.floor(Number(els.downloadedPage.value || 1))))
  renderDownloaded(downloaded)
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
  const comicPathWord = data.comic?.path_word || data.comic?.pathWord || data.path_word || ''
  currentComicPathWord = comicPathWord
  currentComicTarget = target
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
      const title = shortChapterTitle(chapter)
      const fullTitle = `${chapterTitle(chapter)} · ${id}`
      const row = document.createElement('label')
      row.className = `chapter${isDownloaded ? ' downloaded-chapter' : ''}`
      row.title = fullTitle
      row.innerHTML = `
        <input type="checkbox" value="${escapeHtml(id)}" ${isDownloaded ? 'disabled' : ''} />
        <span class="chapter-copy">
          <span class="chapter-title">${escapeHtml(title)}</span>
          <span class="muted">${isDownloaded ? '已下载' : ''}</span>
        </span>
        <button class="chapter-view secondary" type="button">${isDownloaded ? '浏览' : '预览'}</button>
        <button class="chapter-redownload danger" type="button">重下</button>
      `
      row.querySelector('.chapter-view').addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        openChapterViewer({
          comicPathWord,
          chapterUuid: id,
          title,
        })
      })
      row.querySelector('.chapter-redownload').addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        createDownload([id], [event.currentTarget], { comicPathWord, force: true })
      })
      group.append(row)
    }
    chaptersEl.append(group)
  }
}

async function openChapterViewer({ comicPathWord, chapterUuid, title }) {
  if (!comicPathWord || !chapterUuid) return
  viewerState = { comicPathWord, chapterUuid, title }
  showView('viewer-view')
  els.viewerRefresh.disabled = false
  els.viewerTitle.textContent = title || chapterUuid
  els.viewerMeta.textContent = '加载图片中...'
  els.viewerImages.className = 'viewer-grid'
  els.viewerImages.innerHTML = ''
  resetViewerBatch()

  try {
    const params = new URLSearchParams({
      comicPathWord,
      chapterUuid,
      token: els.token.value.trim(),
    })
    const data = await api(`/api/chapter-images?${params}`)
    const sourceText = data.source === 'local' ? '本地' : '远端预览'
    viewerState = { ...viewerState, sourceText, totalImages: data.count || 0 }
    els.viewerMeta.textContent = `${sourceText} · 0/${data.count || 0} 张图`
    els.viewerImages.innerHTML = ''
    viewerImages = data.images || []
    appendViewerImages()
    if (!viewerImages.length) {
      els.viewerImages.className = 'viewer-grid empty-panel'
      els.viewerImages.textContent = '没有图片'
    }
  } catch (error) {
    els.viewerImages.className = 'viewer-grid empty-panel'
    els.viewerImages.textContent = error.message
    els.viewerMeta.textContent = '加载失败'
  }
}

function resetViewerBatch() {
  if (viewerScrollHandler) els.viewerImages.removeEventListener('scroll', viewerScrollHandler)
  if (viewerScrollHandler) window.removeEventListener('scroll', viewerScrollHandler)
  viewerScrollHandler = null
  viewerSentinel = null
  viewerImages = []
  viewerRendered = 0
  viewerAppendLocked = false
}

function currentViewerBatchSize() {
  return Math.max(1, Math.min(50, Math.floor(Number(viewerBatchSize || 5))))
}

function appendViewerImages(fromScroll = false) {
  if (!viewerImages.length) return
  if (fromScroll && viewerAppendLocked) return
  if (fromScroll) {
    viewerAppendLocked = true
    setTimeout(() => {
      viewerAppendLocked = false
    }, 400)
  }
  if (viewerSentinel) viewerSentinel.remove()
  const end = Math.min(viewerImages.length, viewerRendered + currentViewerBatchSize())
  for (const [offset, image] of viewerImages.slice(viewerRendered, end).entries()) {
    const img = document.createElement('img')
    img.src = image.url
    img.alt = `${viewerState?.title || viewerState?.chapterUuid || 'chapter'} ${Number(image.index ?? (viewerRendered + offset)) + 1}`
    img.loading = 'lazy'
    img.decoding = 'async'
    els.viewerImages.append(img)
  }
  viewerRendered = end
  const sourceText = viewerState?.sourceText || '图片'
  els.viewerMeta.textContent = `${sourceText} · ${viewerRendered}/${viewerImages.length} 张图`
  if (viewerRendered < viewerImages.length) attachViewerSentinel()
}

function attachViewerSentinel() {
  viewerSentinel = document.createElement('div')
  viewerSentinel.className = 'viewer-sentinel'
  viewerSentinel.textContent = '继续加载'
  viewerSentinel.addEventListener('click', () => appendViewerImages(false))
  els.viewerImages.append(viewerSentinel)
  if (viewerScrollHandler) els.viewerImages.removeEventListener('scroll', viewerScrollHandler)
  if (viewerScrollHandler) window.removeEventListener('scroll', viewerScrollHandler)
  viewerScrollHandler = () => {
    const internalThreshold = Math.max(1, (els.viewerImages.scrollHeight - els.viewerImages.clientHeight) / 2)
    const internalReady = els.viewerImages.scrollTop >= internalThreshold
    const sentinelTop = viewerSentinel.getBoundingClientRect().top
    const viewportReady = sentinelTop <= window.innerHeight * 1.5
    if (internalReady || viewportReady) appendViewerImages(true)
  }
  els.viewerImages.addEventListener('scroll', viewerScrollHandler)
  window.addEventListener('scroll', viewerScrollHandler)
}

function renderJobs() {
  els.jobs.innerHTML = ''
  const visible = jobs.filter((job) => job.status !== 'completed')
  const sorted = [...visible].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  for (const job of sorted) {
    const total = Math.max(job.totalImages || job.totalChapters || 1, 1)
    const done = job.totalImages ? job.doneImages : job.doneChapters
    const pct = Math.min(100, Math.round((done / total) * 100))
    const title = job.comicTitle || job.comicPathWord || job.id
    const tip = `${title}\n${job.status} · ${job.message || ''}\n章节 ${job.doneChapters}/${job.totalChapters} · 图片 ${job.doneImages}/${job.totalImages || '?'}`
    const el = document.createElement('article')
    el.className = `job ${job.status}`
    el.title = tip
    el.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <div class="muted">${escapeHtml(job.status)} · ${escapeHtml(job.message || '')}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="muted">章节 ${job.doneChapters}/${job.totalChapters} · 图片 ${job.doneImages}/${job.totalImages || '?'}</div>
    `
    els.jobs.append(el)
  }
  if (sorted.length === 0) els.jobs.innerHTML = '<p class="muted">暂无任务</p>'
}

function renderInventoryUpdate(update) {
  inventoryUpdate = update
  if (!update) {
    els.inventoryProgress.classList.add('hidden')
    els.downloadedUpdate.disabled = false
    return
  }

  const total = Math.max(Number(update.total || 0), 0)
  const current = Math.min(Number(update.current || 0), total)
  const pct = total > 0 ? Math.round((current / total) * 100) : (update.status === 'completed' ? 100 : 0)
  const scopeText = update.scope === 'allGroups' ? '全部分组' : '仅已下载分组'
  const groupText = update.groupTotal === null || update.groupTotal === undefined || Number(update.groupTotal) <= 0
    ? '?/?'
    : `${update.groupCurrent || 0}/${update.groupTotal || 0}`
  const chapterDownloaded = update.aggregateChapterDownloaded || update.chapterDownloaded || 0
  const chapterTotal = update.aggregateChapterTotal || update.chapterTotal
  const pendingChapters = update.aggregatePendingChapters || update.pendingChapters || 0
  const chapterText = Number(chapterTotal) > 0 ? `${chapterDownloaded}/${chapterTotal}` : `${chapterDownloaded}/?`
  els.inventoryProgress.classList.remove('hidden')
  els.inventoryProgressBar.style.width = `${pct}%`
  els.inventoryProgressText.textContent = total > 0
    ? `${update.message || '更新库存'} · ${scopeText} · 漫画 ${current}/${total} · 分组 ${groupText} · 章节 ${chapterText} · 待下载 ${pendingChapters} · 新任务 ${update.created || 0} · 跳过 ${update.skipped || 0}`
    : `${update.message || '更新库存'} · ${scopeText} · 本地库存 0 部`
  els.inventoryProgress.title = (update.errors || [])
    .map((item) => `${item.title || item.comicPathWord}: ${item.error}`)
    .join('\n')
  els.downloadedUpdate.dataset.text ||= '更新库存'
  els.downloadedUpdate.disabled = update.status === 'running'
  els.downloadedUpdate.textContent = update.status === 'running' ? '更新中...' : els.downloadedUpdate.dataset.text
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
  viewerBatchSize = config.viewerImageBatchSize || 5
  els.configViewerImageBatchSize.value = viewerBatchSize
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
    downloadedPage = 1
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
els.discoverJump.addEventListener('click', () => {
  jumpDiscoverPage()
})
els.discoverPage.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') jumpDiscoverPage()
})
function jumpDiscoverPage() {
  const limit = Number(els.discoverLimit.value || 10)
  const totalPages = Math.max(1, Math.ceil(discoverTotal / limit))
  const page = Math.max(1, Math.min(totalPages, Math.floor(Number(els.discoverPage.value || 1))))
  discoverOffset = (page - 1) * limit
  loadDiscover()
}
els.downloadedRefresh.addEventListener('click', loadDownloaded)
els.downloadedPrev.addEventListener('click', () => {
  downloadedPage = Math.max(1, downloadedPage - 1)
  renderDownloaded(downloaded)
})
els.downloadedNext.addEventListener('click', () => {
  downloadedPage += 1
  renderDownloaded(downloaded)
})
els.downloadedJump.addEventListener('click', jumpDownloadedPage)
els.downloadedPage.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') jumpDownloadedPage()
})
els.downloadedLimit.addEventListener('change', () => {
  downloadedPage = 1
  renderDownloaded(downloaded)
})
els.downloadedUpdate.addEventListener('click', async () => {
  try {
    setLoading(els.downloadedUpdate, true)
    const data = await api('/api/downloaded/update', {
      method: 'POST',
      body: JSON.stringify({
        token: els.token.value.trim(),
        scope: els.downloadedUpdateScope.value,
      }),
    })
    renderInventoryUpdate(data)
    await loadDownloaded()
  } catch (error) {
    alert(error.message)
  } finally {
    if (inventoryUpdate?.status !== 'running') setLoading(els.downloadedUpdate, false)
  }
})
els.viewerRefresh.addEventListener('click', () => {
  if (viewerState) openChapterViewer(viewerState)
})
els.sidebarToggle.addEventListener('click', () => {
  const collapsed = !els.app.classList.contains('sidebar-collapsed')
  els.app.classList.toggle('sidebar-collapsed', collapsed)
  els.sidebarToggle.textContent = collapsed ? '›' : '‹'
  els.sidebarToggle.title = collapsed ? '展开任务栏' : '收缩任务栏'
  localStorage.setItem('copymanga.sidebarCollapsed', collapsed ? '1' : '0')
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
        viewerImageBatchSize: Number(els.configViewerImageBatchSize.value),
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

async function createDownload(chapterUuids, buttons, options = {}) {
  if (chapterUuids.length === 0) return alert('请先勾选章节')
  try {
    for (const button of buttons) setLoading(button, true)
    const data = await api('/api/download', {
      method: 'POST',
      body: JSON.stringify({
        comicPathWord: options.comicPathWord || currentComicPathWord,
        chapterUuids,
        token: els.token.value.trim(),
        force: options.force === true,
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
    if (currentComicPathWord) await loadComic(currentComicPathWord, currentComicTarget)
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
      if (currentComicPathWord === job.comicPathWord) loadComic(currentComicPathWord, currentComicTarget)
      if (document.querySelector('#downloaded-view')?.classList.contains('active')) renderDownloaded(downloaded)
    })
  }
})
events.addEventListener('jobDelete', (event) => {
  const { id } = JSON.parse(event.data)
  jobs = jobs.filter((job) => job.id !== id)
  renderJobs()
})
events.addEventListener('inventoryUpdate', (event) => {
  const update = JSON.parse(event.data)
  renderInventoryUpdate(update)
  const createdJobs = update.jobs || []
  if (createdJobs.length > 0) {
    const createdIds = new Set(createdJobs.map((job) => job.id))
    jobs = [...createdJobs, ...jobs.filter((item) => !createdIds.has(item.id))]
    renderJobs()
  }
  if (update.status === 'completed') {
    loadDownloaded().catch(() => {})
  }
})

refreshDownloadedState().catch(() => {})
loadConfig().catch(() => {})
api('/api/inventory-update').then(renderInventoryUpdate).catch(() => {})
setInterval(() => {
  syncJobs().catch(() => {})
}, 2000)
