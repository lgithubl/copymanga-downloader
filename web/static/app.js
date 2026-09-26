const els = {
  token: document.querySelector('#token'),
  app: document.querySelector('#app'),
  sidebarToggle: document.querySelector('#sidebar-toggle'),
  username: document.querySelector('#username'),
  password: document.querySelector('#password'),
  login: document.querySelector('#login'),
  keyword: document.querySelector('#keyword'),
  search: document.querySelector('#search'),
  searchToolbar: document.querySelector('#search-toolbar'),
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
  discoverChapterRefresh: document.querySelector('#discover-chapter-refresh'),
  discoverDownload: document.querySelector('#discover-download'),
  discoverDownloadAll: document.querySelector('#discover-download-all'),
  tabs: [...document.querySelectorAll('.tab')],
  views: [...document.querySelectorAll('.view')],
  chapters: document.querySelector('#chapters'),
  comicTitle: document.querySelector('#comic-title'),
  chapterRefresh: document.querySelector('#chapter-refresh'),
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
  downloadedImageCheck: document.querySelector('#downloaded-image-check'),
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
  downloadedReadFilter: document.querySelector('#downloaded-read-filter'),
  downloadedComicTitle: document.querySelector('#downloaded-comic-title'),
  downloadedComicMeta: document.querySelector('#downloaded-comic-meta'),
  downloadedMarkAllRead: document.querySelector('#downloaded-mark-all-read'),
  downloadedComicRefresh: document.querySelector('#downloaded-comic-refresh'),
  downloadedChapters: document.querySelector('#downloaded-chapters'),
  viewerTitle: document.querySelector('#viewer-title'),
  viewerMeta: document.querySelector('#viewer-meta'),
  viewerBack: document.querySelector('#viewer-back'),
  viewerPrev: document.querySelector('#viewer-prev'),
  viewerNext: document.querySelector('#viewer-next'),
  viewerRefresh: document.querySelector('#viewer-refresh'),
  viewerImages: document.querySelector('#viewer-images'),
  taskSearch: document.querySelector('#task-search'),
  taskStatusFilter: document.querySelector('#task-status-filter'),
  taskClearCompleted: document.querySelector('#task-clear-completed'),
  taskList: document.querySelector('#task-list'),
  libraryType: document.querySelector('#library-type'),
  libraryTagSearch: document.querySelector('#library-tag-search'),
  librarySample: document.querySelector('#library-sample'),
  libraryRefresh: document.querySelector('#library-refresh'),
  libraryItems: document.querySelector('#library-items'),
  libraryItemTitle: document.querySelector('#library-item-title'),
  libraryItemMeta: document.querySelector('#library-item-meta'),
  libraryItemTags: document.querySelector('#library-item-tags'),
  librarySaveTags: document.querySelector('#library-save-tags'),
  libraryUnits: document.querySelector('#library-units'),
  mediaImportType: document.querySelector('#media-import-type'),
  mediaImportRefresh: document.querySelector('#media-import-refresh'),
  mediaImportItem: document.querySelector('#media-import-item'),
  mediaImportTitle: document.querySelector('#media-import-title'),
  mediaImportSourcePath: document.querySelector('#media-import-source-path'),
  mediaImportFilesLabel: document.querySelector('#media-import-files-label'),
  mediaImportFiles: document.querySelector('#media-import-files'),
  mediaImportSubmit: document.querySelector('#media-import-submit'),
  mediaImportMeta: document.querySelector('#media-import-meta'),
  mediaImportItems: document.querySelector('#media-import-items'),
  mediaReaderTitle: document.querySelector('#media-reader-title'),
  mediaReaderMeta: document.querySelector('#media-reader-meta'),
  mediaViewerView: document.querySelector('#media-viewer-view'),
  mediaReaderBack: document.querySelector('#media-reader-back'),
  mediaReaderPrev: document.querySelector('#media-reader-prev'),
  mediaSectionSelect: document.querySelector('#media-section-select'),
  mediaReaderTheme: document.querySelector('#media-reader-theme'),
  mediaPagePrev: document.querySelector('#media-page-prev'),
  mediaPageNext: document.querySelector('#media-page-next'),
  mediaReaderNext: document.querySelector('#media-reader-next'),
  mediaReaderContent: document.querySelector('#media-reader-content'),
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
  configSiteTheme: document.querySelector('#config-site-theme'),
  configReadColor: document.querySelector('#config-read-color'),
  configUnreadColor: document.querySelector('#config-unread-color'),
  configUpdateDownloadedComicsIntervalSec: document.querySelector('#config-update-downloaded-comics-interval-sec'),
  configMediaStreamApiBase: document.querySelector('#config-media-stream-api-base'),
  configMediaManagedBasePath: document.querySelector('#config-media-managed-base-path'),
  configMediaStreamBasePath: document.querySelector('#config-media-stream-base-path'),
  configMediaImportSourceRoots: document.querySelector('#config-media-import-source-roots'),
  configMediaSubtitleExtensions: document.querySelector('#config-media-subtitle-extensions'),
  configExportDir: document.querySelector('#config-export-dir'),
  configExportDirFmt: document.querySelector('#config-export-dir-fmt'),
  configMergePdfFmt: document.querySelector('#config-merge-pdf-fmt'),
  configCreatePdfConcurrency: document.querySelector('#config-create-pdf-concurrency'),
  configEnableMergePdf: document.querySelector('#config-enable-merge-pdf'),
  configExportSkipMode: document.querySelector('#config-export-skip-mode'),
}

let currentComicPathWord = ''
let currentComicTarget = 'search'
let latestComicRequest = { search: '', discover: '' }
let selectedComicByTarget = {
  search: { pathWord: '', title: '' },
  discover: { pathWord: '', title: '' },
}
let jobs = []
let downloaded = []
let downloadedPage = 1
let currentDownloadedComicPathWord = ''
let discoverOffset = 0
let discoverTotal = 0
let inventoryUpdate = null
let inventoryPollTimer = null
let currentDownloadedComic = null
let viewerState = null
let viewerBatchSize = 5
let viewerImages = []
let viewerRendered = 0
let viewerSentinel = null
let viewerActiveBatch = null
let viewerReturnView = 'search-view'
let readingProgress = {}
let libraryTypes = []
let libraryItems = []
let currentLibraryItem = null
let currentLibraryUnits = []
let currentLibraryProgress = null
let currentMediaReader = null
let mediaReturnView = 'library-view'
let mediaPageIndex = 0
let mediaPageCount = 1
let mediaPageStep = 1
let mediaMaxScrollLeft = 0
let libraryProgressTimer = null
const mediaReaderThemeClasses = ['reader-theme-light', 'reader-theme-dark', 'reader-theme-warm', 'reader-theme-sepia']
const siteThemeClasses = ['site-theme-light', 'site-theme-dark', 'site-theme-warm', 'site-theme-sepia']
const mediaImportTypeInfo = {
  epub: { label: 'EPUB', unit: '个 EPUB', accept: '.epub,application/epub+zip', source: false },
  media: { label: '媒体', unit: '个媒体项', accept: '.zip,.aac,.flac,.m4a,.mp3,.ogg,.opus,.wav,.webm,.m4v,.mkv,.mov,.mp4,.jpg,.jpeg,.png,.gif,image/*,audio/*,video/*', source: true },
}
const stageLabels = {
  created: '创建完成',
  fetching_comic: '获取漫画信息',
  comic_ready: '漫画信息完成',
  fetching_chapter: '获取章节信息',
  chapter_ready: '章节图片列表完成',
  preparing_chapter: '准备章节目录',
  downloading_images: '下载图片',
  images_ready: '所有图片完成',
  writing_metadata: '写入元数据',
  metadata_ready: '元数据完成',
  completed: '完成',
  failed: '失败',
}

els.token.value = localStorage.getItem('copymanga.token') || ''
els.token.addEventListener('input', () => localStorage.setItem('copymanga.token', els.token.value.trim()))
const savedSidebarCollapsed = localStorage.getItem('copymanga.sidebarCollapsed')
els.app.classList.toggle('sidebar-collapsed', savedSidebarCollapsed === null ? true : savedSidebarCollapsed === '1')
els.sidebarToggle.textContent = els.app.classList.contains('sidebar-collapsed') ? '›' : '‹'
els.sidebarToggle.title = els.app.classList.contains('sidebar-collapsed') ? '展开任务栏' : '收缩任务栏'
els.mediaReaderTheme.value = localStorage.getItem('copymanga.mediaReaderTheme') || 'light'

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

async function apiForm(path, formData) {
  const resp = await fetch(path, {
    method: 'POST',
    body: formData,
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

function readChapterSet(comicPathWord) {
  return new Set(Object.keys(readingProgress[comicPathWord]?.readChapters || {}))
}

function allChapterUuidsOf(item) {
  if (Array.isArray(item.allChapterUuids)) return item.allChapterUuids.filter(Boolean)
  const groupsChapters = item.groupsChapters || item.comic?.groupsChapters || item.comic?.groups || {}
  return Object.values(groupsChapters)
    .flatMap((chapters) => Array.isArray(chapters) ? chapters : [])
    .map(chapterId)
    .filter(Boolean)
}

function readingStats(item) {
  const pathWord = pickComicPathWord(item) || item.comicPathWord
  const read = readChapterSet(pathWord)
  const all = allChapterUuidsOf(item)
  const total = all.length || Number(item.remoteChapterTotal || 0) || 0
  const readCount = all.length
    ? all.filter((uuid) => read.has(uuid)).length
    : read.size
  return { pathWord, readCount, total, hasAnyRead: read.size > 0 }
}

function readingClassForItem(item) {
  const stats = readingStats(item)
  if (stats.total > 0 && stats.readCount >= stats.total) return ' read-all'
  if (stats.readCount > 0 || stats.hasAnyRead) return ' partial-read'
  return ' unread-all'
}

function inventoryReadMatches(item) {
  const filter = els.downloadedReadFilter?.value || 'all'
  if (filter === 'all') return true
  const stats = readingStats(item)
  if (filter === 'hasUnread') return stats.total > 0 && stats.readCount < stats.total
  if (filter === 'allRead') return stats.total > 0 && stats.readCount >= stats.total
  if (filter === 'unread') return stats.readCount === 0
  return true
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

function chapterPayloads(data) {
  return Object.values(data.groupsChapters || {})
    .flatMap((chapters) => Array.isArray(chapters) ? chapters : [])
    .map((chapter) => ({
      chapterUuid: chapterId(chapter),
      chapterTitle: shortChapterTitle(chapter),
    }))
    .filter((chapter) => chapter.chapterUuid)
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
    const progress = readingProgress[pathWord]
    const card = document.createElement('article')
    card.className = `card${isDownloaded ? ' downloaded-card' : ''}${readingClassForItem(comic)}`
    card.innerHTML = `
      ${renderCover(pickComicCover(comic), pickComicTitle(comic))}
      <div class="card-body">
        <div class="card-title">${escapeHtml(pickComicTitle(comic))}</div>
        <div class="muted">${escapeHtml(pathWord || '')}</div>
        ${isDownloaded ? '<div class="badge">已下载</div>' : ''}
        ${progress?.lastChapterUuid ? '<button class="card-read secondary" type="button">阅读</button>' : ''}
      </div>
    `
    card.querySelector('.card-read')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openChapterViewer({
        comicPathWord: pathWord,
        chapterUuid: progress.lastChapterUuid,
        title: progress.lastChapterTitle,
        comicTitle: pickComicTitle(comic),
      })
    })
    card.addEventListener('click', () => {
      if (onPick) {
        onPick(pathWord, pickComicTitle(comic))
      } else {
        showView('search-view')
        loadComic(pathWord, 'search', pickComicTitle(comic))
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
  renderComicCards(els.discoverResults, list, (pathWord, title) => loadComic(pathWord, 'discover', title))
}

function renderDownloaded(list) {
  downloaded = list
  els.downloaded.innerHTML = ''
  const visibleList = list.filter(inventoryReadMatches)
  const limit = Math.max(1, Number(els.downloadedLimit.value || 10))
  const totalPages = Math.max(1, Math.ceil(visibleList.length / limit))
  downloadedPage = Math.max(1, Math.min(totalPages, downloadedPage))
  const offset = (downloadedPage - 1) * limit
  els.downloadedPage.value = String(downloadedPage)
  els.downloadedPage.max = String(totalPages)
  els.downloadedPageTotal.textContent = `/ ${totalPages} 页`
  els.downloadedPrev.disabled = downloadedPage <= 1
  els.downloadedNext.disabled = downloadedPage >= totalPages

  for (const item of visibleList.slice(offset, offset + limit)) {
    const remoteChapterTotal = Number.isFinite(Number(item.remoteChapterTotal)) ? Number(item.remoteChapterTotal) : null
    const chapterTotalText = remoteChapterTotal && remoteChapterTotal > 0 ? String(remoteChapterTotal) : '?'
    const progress = readingProgress[item.comicPathWord]
    const stats = readingStats(item)
    const imageCheck = imageCheckSummaryText(item.imageCheckSummary)
    const readTarget = progress?.lastChapterUuid || item.allChapterUuids?.[0] || item.chapterUuids?.[0] || ''
    const card = document.createElement('article')
    card.className = `card downloaded-card ${readingClassForItem(item)}`
    card.innerHTML = `
      ${renderCover(item.cover, item.title)}
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="muted">${escapeHtml(item.comicPathWord)}</div>
        <div class="muted">本地 ${item.chapterCount}/${chapterTotalText} 章 · 已读 ${stats.readCount}/${stats.total || '?'} · ${item.imageCount} 张图 · ${escapeHtml(item.path)}</div>
        <div class="badge">已下载</div>
        ${imageCheck ? `<div class="badge ${escapeHtml(imageCheck.className)}">${escapeHtml(imageCheck.text)}</div>` : ''}
        ${readTarget ? `<button class="card-read secondary" type="button">${progress?.lastChapterUuid ? '阅读' : '开始'}</button>` : ''}
      </div>
    `
    card.querySelector('.card-read')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openChapterViewer({
        comicPathWord: item.comicPathWord,
        chapterUuid: readTarget,
        title: progress?.lastChapterTitle || readTarget,
        comicTitle: item.title,
      })
    })
    if (item.comicPathWord) {
      card.addEventListener('click', () => {
        loadDownloadedComic(item.comicPathWord)
      })
    }
    els.downloaded.append(card)
  }
  if (visibleList.length === 0) els.downloaded.innerHTML = '<p class="muted">暂无符合条件的本地库存</p>'
}

function imageCheckSummaryText(summary = {}) {
  const failed = Number(summary.failed || 0)
  const checking = Number(summary.checking || 0)
  const pending = Number(summary.pending || 0)
  const unknown = Number(summary.unknown || 0)
  const total = Number(summary.total || 0)
  const passed = Number(summary.passed || 0)
  if (failed > 0) return { text: `异常 ${failed}`, className: 'image-check-failed' }
  if (checking > 0 || pending > 0) return { text: `检查中 ${checking + pending}`, className: 'image-check-checking' }
  if (unknown > 0) return { text: `未检查 ${unknown}`, className: 'image-check-unknown' }
  if (total > 0 && passed === total) return { text: '图片OK', className: 'image-check-passed' }
  return null
}

function imageCheckChapterText(chapter = {}) {
  const check = chapter.imageCheck || {}
  const status = check.status || 'unknown'
  if (status === 'passed') return { text: '图片OK', className: 'image-check-passed' }
  if (status === 'failed') return { text: `异常 ${check.failed || 0}`, className: 'image-check-failed' }
  if (status === 'checking' || status === 'pending') return { text: '检查中', className: 'image-check-checking' }
  return { text: '未检查', className: 'image-check-unknown' }
}

function jumpDownloadedPage() {
  const limit = Math.max(1, Number(els.downloadedLimit.value || 10))
  const totalPages = Math.max(1, Math.ceil(downloaded.filter(inventoryReadMatches).length / limit))
  downloadedPage = Math.max(1, Math.min(totalPages, Math.floor(Number(els.downloadedPage.value || 1))))
  renderDownloaded(downloaded)
}

function comicPanel(target) {
  const isDiscover = target === 'discover'
  return {
    title: isDiscover ? els.discoverComicTitle : els.comicTitle,
    chapters: isDiscover ? els.discoverChapters : els.chapters,
    refresh: isDiscover ? els.discoverChapterRefresh : els.chapterRefresh,
    download: isDiscover ? els.discoverDownload : els.download,
    downloadAll: isDiscover ? els.discoverDownloadAll : els.downloadAll,
  }
}

function renderChapterLoadError({ target, pathWord, title, message }) {
  const panel = comicPanel(target)
  panel.title.textContent = title || pathWord || '章节'
  panel.refresh.disabled = false
  panel.download.disabled = true
  panel.downloadAll.disabled = true
  panel.chapters.className = 'chapters empty-panel'
  panel.chapters.innerHTML = `
    <div class="chapter-error">
      <p>加载章节失败：${escapeHtml(message)}</p>
      <button class="secondary" type="button">刷新章节</button>
    </div>
  `
  panel.chapters.querySelector('button')?.addEventListener('click', () => loadComic(pathWord, target, title))
}

function showView(id) {
  for (const view of els.views) view.classList.toggle('active', view.id === id)
  for (const tab of els.tabs) tab.classList.toggle('active', tab.dataset.view === id)
  els.searchToolbar.classList.toggle('hidden', id !== 'search-view')
}

function renderComic(data, target = 'search') {
  const panel = comicPanel(target)
  const comicPathWord = data.comic?.path_word || data.comic?.pathWord || data.path_word || ''
  currentComicPathWord = comicPathWord
  currentComicTarget = target
  const title = data.comic?.name || data.name || '章节'
  selectedComicByTarget[target] = { pathWord: comicPathWord, title }
  panel.title.textContent = title
  panel.refresh.disabled = false
  panel.download.disabled = false
  panel.downloadAll.disabled = false
  renderChapterGroups(data, panel.chapters, comicPathWord)
}

function renderChapterGroups(data, chaptersEl, comicPathWord) {
  const read = readChapterSet(comicPathWord)
  const comicTitle = data.comic?.name || data.name || comicPathWord
  chaptersEl.classList.remove('empty-panel')
  chaptersEl.innerHTML = ''
  for (const [groupPathWord, chapters] of Object.entries(data.groupsChapters || {})) {
    const group = document.createElement('div')
    group.className = 'group'
    const title = data.groups?.[groupPathWord]?.name || data.groups?.[groupPathWord]?.title || groupPathWord
    group.innerHTML = `<h3>${escapeHtml(title)}</h3>`

    for (const chapter of chapters) {
      const id = chapterId(chapter)
      const isDownloaded = chapter.isDownloaded === true
      const isRead = read.has(id)
      const title = shortChapterTitle(chapter)
      const fullTitle = `${chapterTitle(chapter)} · ${id}`
      const imageCheck = imageCheckChapterText(chapter)
      const row = document.createElement('label')
      row.className = `chapter${isDownloaded ? ' downloaded-chapter' : ''}${isRead ? ' read-chapter' : ' unread-chapter'}`
      row.title = fullTitle
      row.innerHTML = `
        <input type="checkbox" value="${escapeHtml(id)}" ${isDownloaded ? 'disabled' : ''} />
        <span class="chapter-copy">
          <span class="chapter-title">${escapeHtml(title)}</span>
          <span class="muted">${isDownloaded ? '已下载' : ''}</span>
        </span>
        ${isDownloaded ? `<span class="badge ${escapeHtml(imageCheck.className)}">${escapeHtml(imageCheck.text)}</span>` : ''}
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
          comicTitle,
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
  if (!Object.keys(data.groupsChapters || {}).length) {
    chaptersEl.classList.add('empty-panel')
    chaptersEl.textContent = '本地 metadata 没有章节信息'
  }
}

async function openChapterViewer({ comicPathWord, chapterUuid, title, comicTitle }) {
  if (!comicPathWord || !chapterUuid) return
  const activeView = els.views.find((view) => view.classList.contains('active'))?.id
  if (activeView && activeView !== 'viewer-view') viewerReturnView = activeView
  viewerState = { comicPathWord, chapterUuid, title, comicTitle, returnView: viewerReturnView }
  showView('viewer-view')
  els.viewerBack.disabled = false
  els.viewerPrev.disabled = true
  els.viewerNext.disabled = true
  els.viewerRefresh.disabled = false
  els.viewerTitle.textContent = title || chapterUuid
  els.viewerMeta.textContent = '加载图片中...'
  els.viewerImages.className = 'viewer-grid'
  els.viewerImages.innerHTML = ''
  els.viewerImages.classList.remove('long-strip-viewer')
  resetViewerBatch()

  try {
    const params = new URLSearchParams({
      comicPathWord,
      chapterUuid,
      token: els.token.value.trim(),
    })
    const data = await api(`/api/chapter-images?${params}`)
    const sourceText = data.source === 'local' ? '本地' : '远端预览'
    const resolvedTitle = data.title || title || chapterUuid
    viewerState = { ...viewerState, title: resolvedTitle, sourceText, totalImages: data.count || 0, navigation: data.navigation || {} }
    els.viewerTitle.textContent = resolvedTitle
    els.viewerPrev.disabled = !viewerState.navigation?.prev
    els.viewerNext.disabled = !viewerState.navigation?.next
    els.viewerMeta.textContent = `${sourceText} · 0/${data.count || 0} 张图`
    els.viewerImages.innerHTML = ''
    viewerImages = data.images || []
    appendViewerImages()
    if (!viewerImages.length) {
      els.viewerImages.className = 'viewer-grid empty-panel'
      els.viewerImages.textContent = '没有图片'
    }
    recordReadingProgress({
      comicPathWord,
      comicTitle: comicTitle || viewerState.comicTitle || '',
      chapterUuid,
      chapterTitle: resolvedTitle,
    }).catch(() => {})
  } catch (error) {
    els.viewerPrev.disabled = true
    els.viewerNext.disabled = true
    els.viewerImages.className = 'viewer-grid empty-panel'
    els.viewerImages.textContent = error.message
    els.viewerMeta.textContent = '加载失败'
  }
}

function openAdjacentViewer(direction) {
  const target = viewerState?.navigation?.[direction]
  if (!target) return
  openChapterViewer({
    comicPathWord: viewerState.comicPathWord,
    chapterUuid: target.chapterUuid,
    title: target.title,
    comicTitle: viewerState.comicTitle,
  })
}

async function loadReadingProgress() {
  readingProgress = await api('/api/reading-progress')
  applyReadingColors()
}

async function recordReadingProgress(payload) {
  const progress = await api('/api/reading-progress', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  readingProgress[progress.comicPathWord] = progress
  applyReadingColors(payload.comicPathWord, payload.chapterUuid)
  if (document.querySelector('#downloaded-view')?.classList.contains('active')) renderDownloaded(downloaded)
}

function applyReadingColors(comicPathWord = '', chapterUuid = '') {
  const selectorUuid = globalThis.CSS?.escape ? CSS.escape(chapterUuid) : ''
  const chapters = comicPathWord && chapterUuid
    ? (selectorUuid ? [...document.querySelectorAll(`.chapter input[value="${selectorUuid}"]`)] : [...document.querySelectorAll('.chapter input[type="checkbox"]')].filter((input) => input.value === chapterUuid))
    : [...document.querySelectorAll('.chapter input[type="checkbox"]')]
  for (const input of chapters) {
    const row = input.closest('.chapter')
    if (!row) continue
    const rowComicPathWord = comicPathWord || currentComicPathWord || currentDownloadedComicPathWord
    const isRead = readChapterSet(rowComicPathWord).has(input.value)
    row.classList.toggle('read-chapter', isRead)
    row.classList.toggle('unread-chapter', !isRead)
  }
}

function resetViewerBatch() {
  viewerSentinel = null
  viewerImages = []
  viewerRendered = 0
  viewerActiveBatch = null
}

function currentViewerBatchSize() {
  return Math.max(1, Math.min(50, Math.floor(Number(viewerBatchSize || 5))))
}

function appendViewerImages() {
  if (!viewerImages.length) return
  if (viewerSentinel) viewerSentinel.remove()
  const start = viewerRendered
  const end = Math.min(viewerImages.length, viewerRendered + currentViewerBatchSize())
  const batch = {
    total: end - start,
    done: 0,
    triggered: false,
  }
  viewerActiveBatch = batch
  for (const [offset, image] of viewerImages.slice(start, end).entries()) {
    const img = document.createElement('img')
    img.src = image.url
    img.alt = `${viewerState?.title || viewerState?.chapterUuid || 'chapter'} ${Number(image.index ?? (start + offset)) + 1}`
    img.loading = 'lazy'
    img.decoding = 'async'
    img.fetchPriority = start + offset < currentViewerBatchSize() ? 'high' : 'auto'
    let settled = false
    const markDone = () => {
      if (settled) return
      settled = true
      applyViewerImageLayout(img)
      markViewerImageDone(batch)
    }
    img.addEventListener('load', markDone, { once: true })
    img.addEventListener('error', markDone, { once: true })
    setTimeout(markDone, 15000)
    els.viewerImages.append(img)
  }
  viewerRendered = end
  const sourceText = viewerState?.sourceText || '图片'
  els.viewerMeta.textContent = `${sourceText} · ${viewerRendered}/${viewerImages.length} 张图`
  if (viewerRendered < viewerImages.length) attachViewerSentinel()
}

function applyViewerImageLayout(img) {
  if (!img.naturalWidth || !img.naturalHeight) return
  const displayWidth = Math.min(img.naturalWidth, 980)
  img.style.maxWidth = `${displayWidth}px`
  img.style.width = `min(100%, ${displayWidth}px)`
  const isLongStrip = img.naturalHeight / Math.max(img.naturalWidth, 1) >= 4
  img.classList.toggle('long-strip-image', isLongStrip)
  if (isLongStrip) els.viewerImages.classList.add('long-strip-viewer')
}

function markViewerImageDone(batch) {
  if (!batch || batch !== viewerActiveBatch) return
  batch.done += 1
  if (!batch.triggered && batch.done / Math.max(batch.total, 1) >= 0.8 && viewerRendered < viewerImages.length) {
    batch.triggered = true
    appendViewerImages()
  }
}

function attachViewerSentinel() {
  viewerSentinel = document.createElement('div')
  viewerSentinel.className = 'viewer-sentinel'
  viewerSentinel.textContent = '加载更多'
  viewerSentinel.addEventListener('click', appendViewerImages)
  els.viewerImages.append(viewerSentinel)
}

function renderJobs() {
  els.jobs.innerHTML = ''
  const visible = jobs.filter((job) => job.status !== 'completed' && !job.deleted)
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
  renderTaskList()
}

function imageStatusSummary(images = []) {
  const counts = { pending: 0, running: 0, completed: 0, failed: 0 }
  for (const image of images) {
    const status = image?.status || 'pending'
    counts[status] = (counts[status] || 0) + 1
  }
  return counts
}

function renderTaskList() {
  if (!els.taskList) return
  const keyword = (els.taskSearch?.value || '').trim().toLowerCase()
  const status = els.taskStatusFilter?.value || 'all'
  const filtered = jobs
    .filter((job) => !job.deleted)
    .filter((job) => status === 'all' || job.status === status)
    .filter((job) => {
      if (!keyword) return true
      return [
        job.id,
        job.batchId,
        job.retryOf,
        job.comicTitle,
        job.comicPathWord,
        job.chapterTitle,
        job.chapterUuid,
        ...(job.chapterUuids || []),
        job.status,
        job.stage,
        stageLabels[job.stage],
        job.message,
        ...(job.images || []).flatMap((image) => [image.index, image.status, image.error]),
      ].join(' ').toLowerCase().includes(keyword)
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

  els.taskList.classList.toggle('empty-panel', filtered.length === 0)
  els.taskList.innerHTML = ''
  for (const job of filtered) {
    const title = job.chapterTitle || job.chapterUuid || job.chapterUuids?.[0] || '章节'
    const total = Math.max(job.totalImages || job.totalChapters || 1, 1)
    const done = job.totalImages ? job.doneImages : job.doneChapters
    const pct = Math.min(100, Math.round((done / total) * 100))
    const imageCounts = imageStatusSummary(job.images || [])
    const failedImages = (job.images || []).filter((image) => image.status === 'failed')
    const stageText = stageLabels[job.stage] || job.stage || '创建完成'
    const failedText = failedImages.length > 0
      ? ` · 失败图片 ${failedImages.map((image) => `#${image.index}`).slice(0, 8).join(', ')}${failedImages.length > 8 ? '...' : ''}`
      : ''
    const row = document.createElement('article')
    row.className = `task-row ${job.status}`
    row.innerHTML = `
      <div class="task-main">
        <strong>${escapeHtml(job.comicTitle || job.comicPathWord || job.id)}</strong>
        <span title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <small>${escapeHtml(job.chapterUuid || job.chapterUuids?.[0] || '')}</small>
      </div>
      <div class="task-state">
        <span><span class="badge">${escapeHtml(job.status)}</span> <span class="badge">${escapeHtml(stageText)}</span></span>
        <span>${escapeHtml(job.message || '')}</span>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <small>章节 ${job.doneChapters}/${job.totalChapters} · 图片 ${job.doneImages}/${job.totalImages || '?'} · pending ${imageCounts.pending || 0} · running ${imageCounts.running || 0} · done ${imageCounts.completed || 0} · failed ${imageCounts.failed || 0}${escapeHtml(failedText)} · ${escapeHtml(job.updatedAt || '')}</small>
      </div>
      <div class="task-actions">
        <button class="danger" type="button">删除</button>
      </div>
    `
    row.querySelector('button').addEventListener('click', () => deleteTask(job.id))
    els.taskList.append(row)
  }
  if (filtered.length === 0) els.taskList.textContent = '暂无任务'
}

async function deleteTask(id) {
  if (!id) return
  await api(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  jobs = jobs.filter((job) => job.id !== id)
  renderJobs()
}

function renderInventoryUpdate(update) {
  const wasRunning = inventoryUpdate?.status === 'running'
  inventoryUpdate = update
  if (!update) {
    els.inventoryProgress.classList.add('hidden')
    els.downloadedUpdate.disabled = false
    stopInventoryPolling()
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
  if (update.status === 'running') {
    startInventoryPolling()
  } else {
    stopInventoryPolling()
    if (wasRunning) loadDownloaded().catch(() => {})
  }
}

function startInventoryPolling() {
  if (inventoryPollTimer) return
  inventoryPollTimer = setInterval(async () => {
    try {
      renderInventoryUpdate(await api('/api/inventory-update'))
    } catch {
      // SSE is the primary path; polling is only a fallback.
    }
  }, 1000)
}

function stopInventoryPolling() {
  if (!inventoryPollTimer) return
  clearInterval(inventoryPollTimer)
  inventoryPollTimer = null
}

async function loadComic(pathWord, target = 'search', title = '') {
  if (!pathWord) return
  const panel = comicPanel(target)
  const requestKey = `${target}:${pathWord}:${Date.now()}:${Math.random().toString(16).slice(2)}`
  latestComicRequest[target] = requestKey
  currentComicPathWord = pathWord
  currentComicTarget = target
  selectedComicByTarget[target] = { pathWord, title: title || pathWord }
  panel.title.textContent = title || pathWord
  panel.refresh.disabled = false
  panel.download.disabled = true
  panel.downloadAll.disabled = true
  panel.chapters.classList.remove('empty-panel')
  panel.chapters.innerHTML = '<p class="muted">加载章节中...</p>'
  try {
    setLoading(panel.refresh, true)
    const data = await api(`/api/comic/${encodeURIComponent(pathWord)}`)
    if (latestComicRequest[target] !== requestKey) return
    renderComic(data, target)
  } catch (error) {
    if (latestComicRequest[target] !== requestKey) return
    renderChapterLoadError({ target, pathWord, title: title || pathWord, message: error.message })
  } finally {
    if (latestComicRequest[target] === requestKey) setLoading(panel.refresh, false)
  }
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
  els.configSiteTheme.value = config.siteTheme || 'light'
  applySiteTheme(els.configSiteTheme.value)
  els.configReadColor.value = config.readColor || '#ecfdf3'
  els.configUnreadColor.value = config.unreadColor || '#fff7ed'
  document.documentElement.style.setProperty('--read-color', els.configReadColor.value)
  document.documentElement.style.setProperty('--unread-color', els.configUnreadColor.value)
  els.configUpdateDownloadedComicsIntervalSec.value = config.updateDownloadedComicsIntervalSec
  els.configMediaStreamApiBase.value = config.mediaStreamApiBase || ''
  els.configMediaManagedBasePath.value = config.mediaManagedBasePath || ''
  els.configMediaStreamBasePath.value = config.mediaStreamBasePath || ''
  els.configMediaImportSourceRoots.value = config.mediaImportSourceRoots || ''
  els.configMediaSubtitleExtensions.value = config.mediaSubtitleExtensions || 'srt,vtt,crt'
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
    if (tab.dataset.view === 'library-view') {
      loadLibraryTypes().then(loadLibraryItems).catch((error) => alert(error.message))
    }
    if (tab.dataset.view === 'media-import-view') loadMediaImportItems()
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

async function loadDownloadedComic(pathWord, { refreshOnly = false } = {}) {
  if (!pathWord) return
  currentDownloadedComicPathWord = pathWord
  els.downloadedComicRefresh.disabled = false
  els.downloadedMarkAllRead.disabled = true
  if (!refreshOnly) {
    els.downloadedComicTitle.textContent = pathWord
    els.downloadedComicMeta.textContent = '读取本地 metadata...'
    els.downloadedChapters.className = 'chapters empty-panel'
    els.downloadedChapters.textContent = '加载章节中...'
    try {
      const local = await api(`/api/downloaded/comic/${encodeURIComponent(pathWord)}`)
      renderDownloadedComic(local, '本地 metadata')
    } catch (error) {
      els.downloadedComicMeta.textContent = `本地 metadata 读取失败：${error.message}`
    }
    return
  }

  try {
    setLoading(els.downloadedComicRefresh, true)
    const params = new URLSearchParams({
      refresh: '1',
      token: els.token.value.trim(),
    })
    const remote = await api(`/api/downloaded/comic/${encodeURIComponent(pathWord)}?${params}`)
    renderDownloadedComic(remote, '远端最新')
    await refreshDownloadedState()
    renderDownloaded(downloaded)
  } catch (error) {
    if (!refreshOnly) {
      els.downloadedComicMeta.textContent += ` · 获取最新失败：${error.message}`
    } else {
      alert(error.message)
    }
  } finally {
    setLoading(els.downloadedComicRefresh, false)
  }
}

function renderDownloadedComic(data, sourceText) {
  const comicPathWord = data.comic?.path_word || data.comic?.pathWord || data.path_word || currentDownloadedComicPathWord
  const title = data.comic?.name || data.name || comicPathWord
  const chapters = chapterPayloads(data)
  const localCount = data.downloadedInfo?.chapterCount ?? 0
  const totalCount = Object.values(data.groupsChapters || {})
    .reduce((total, chapters) => total + (Array.isArray(chapters) ? chapters.length : 0), 0)
  currentDownloadedComic = { comicPathWord, comicTitle: title, chapters }
  els.downloadedComicTitle.textContent = title
  els.downloadedComicMeta.textContent = `${sourceText} · 本地 ${localCount}/${totalCount || '?'} 章`
  els.downloadedMarkAllRead.disabled = chapters.length === 0
  renderChapterGroups(data, els.downloadedChapters, comicPathWord)
}

async function loadLibraryTypes() {
  libraryTypes = await api('/api/library/types')
  const current = els.libraryType.value || 'all'
  const currentImport = els.mediaImportType.value || 'epub'
  els.libraryType.innerHTML = '<option value="all">全部类型</option>'
  els.mediaImportType.innerHTML = ''
  for (const type of libraryTypes) {
    const option = document.createElement('option')
    option.value = type.type
    option.textContent = type.label || type.type
    els.libraryType.append(option)
    if (type.importable) {
      const importOption = document.createElement('option')
      importOption.value = type.type
      importOption.textContent = type.label || mediaImportTypeInfo[type.type]?.label || type.type
      els.mediaImportType.append(importOption)
    }
  }
  els.libraryType.value = [...els.libraryType.options].some((option) => option.value === current) ? current : 'all'
  els.mediaImportType.value = [...els.mediaImportType.options].some((option) => option.value === currentImport) ? currentImport : 'epub'
  updateMediaImportControls()
}

async function loadLibraryItems() {
  try {
    setLoading(els.libraryRefresh, true)
    const type = els.libraryType.value || 'all'
    const params = new URLSearchParams({ type })
    if (els.libraryTagSearch.value.trim()) params.set('tag', els.libraryTagSearch.value.trim())
    libraryItems = await api(`/api/library/items?${params}`)
    renderLibraryItems()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.libraryRefresh, false)
  }
}

async function loadMediaImportItems() {
  try {
    setLoading(els.mediaImportRefresh, true)
    const type = els.mediaImportType.value || 'epub'
    const items = await api(`/api/library/items?type=${encodeURIComponent(type)}`)
    renderMediaImportItems(items)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.mediaImportRefresh, false)
  }
}

function renderMediaImportItems(items) {
  const type = els.mediaImportType.value || 'epub'
  const info = mediaImportTypeInfo[type] || { label: type, unit: '个目录项', source: false }
  els.mediaImportItem.innerHTML = '<option value="">新建合集</option>'
  els.mediaImportItems.innerHTML = ''
  for (const item of items) {
    const option = document.createElement('option')
    option.value = item.itemId
    option.textContent = item.title
    option.dataset.title = item.title
    els.mediaImportItem.append(option)

    const card = document.createElement('article')
    card.className = 'card'
    card.innerHTML = `
      ${renderCover(item.cover, item.title)}
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="muted">${escapeHtml(item.itemId)} · ${item.unitCount || 0} ${escapeHtml(info.unit)}</div>
      </div>
    `
    card.addEventListener('click', () => {
      els.mediaImportItem.value = item.itemId
      els.mediaImportTitle.value = item.title
      updateMediaImportMeta()
    })
    els.mediaImportItems.append(card)
  }
  if (items.length === 0) els.mediaImportItems.innerHTML = `<p class="muted">暂无 ${escapeHtml(info.label)} 合集</p>`
  updateMediaImportMeta()
}

function updateMediaImportMeta() {
  const type = els.mediaImportType.value || 'epub'
  const info = mediaImportTypeInfo[type] || { label: type, source: false }
  const selected = els.mediaImportItem.selectedOptions?.[0]
  if (els.mediaImportItem.value) {
    els.mediaImportTitle.value ||= selected?.dataset.title || selected?.textContent || ''
    els.mediaImportMeta.textContent = `本次导入会追加到已有合集：${selected?.textContent || els.mediaImportItem.value}`
  } else {
    els.mediaImportMeta.textContent = els.mediaImportTitle.value.trim()
      ? `本次导入会新建合集：${els.mediaImportTitle.value.trim()}`
      : `未选择已有合集时，会用合集名称新建一套 ${info.label}`
  }
  if (info.source && els.mediaImportSourcePath.value.trim()) {
    els.mediaImportMeta.textContent += ` · 来源：${els.mediaImportSourcePath.value.trim()}`
  }
}

function updateMediaImportControls() {
  const type = els.mediaImportType.value || 'epub'
  const info = mediaImportTypeInfo[type] || { label: type, accept: '', source: false }
  els.mediaImportFiles.accept = info.accept || ''
  els.mediaImportFilesLabel.firstChild.textContent = `${info.label} 文件`
  els.mediaImportSubmit.textContent = `导入 ${info.label}`
  els.mediaImportSourcePath.disabled = !info.source
  els.mediaImportSourcePath.placeholder = info.source ? '/input/album 或 /input/movie.mp4' : 'EPUB 暂不支持路径导入'
  if (!info.source) els.mediaImportSourcePath.value = ''
  updateMediaImportMeta()
}

function renderLibraryItems() {
  els.libraryItems.innerHTML = ''
  for (const item of libraryItems) {
    const card = document.createElement('article')
    card.className = 'card'
    card.innerHTML = `
      ${renderCover(item.cover, item.title)}
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="muted">${escapeHtml(item.type)} · ${escapeHtml(item.itemId)}</div>
        <div class="muted">${escapeHtml((item.author || []).join(', ') || '未知作者')} · ${item.unitCount || 0} 个目录项</div>
        ${renderTagList(item.tags || [])}
      </div>
    `
    card.addEventListener('click', () => selectLibraryItem(item.type, item.itemId))
    els.libraryItems.append(card)
  }
  if (libraryItems.length === 0) els.libraryItems.innerHTML = '<p class="muted">暂无媒体库条目</p>'
}

async function selectLibraryItem(type, itemId) {
  try {
    els.libraryItemTitle.textContent = itemId
    els.libraryItemMeta.textContent = '读取目录中...'
    els.libraryUnits.className = 'chapters empty-panel'
    els.libraryUnits.textContent = '读取目录中...'
    const [item, units, progress] = await Promise.all([
      api(`/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}`),
      api(`/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/units`),
      api(`/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/progress`),
    ])
    currentLibraryItem = item
    currentLibraryUnits = units
    currentLibraryProgress = progress
    els.libraryItemTitle.textContent = item.title
    els.libraryItemMeta.textContent = `${item.type} · ${(item.author || []).join(', ') || '未知作者'} · ${units.length} 个目录项`
    els.libraryItemTags.value = (item.tags || []).join(', ')
    els.librarySaveTags.disabled = false
    renderLibraryUnits()
  } catch (error) {
    els.libraryItemMeta.textContent = `读取失败：${error.message}`
    els.libraryUnits.className = 'chapters empty-panel'
    els.libraryUnits.textContent = error.message
  }
}

function renderLibraryUnits() {
  els.libraryUnits.classList.remove('empty-panel')
  els.libraryUnits.innerHTML = ''
  const readUnits = currentLibraryProgress?.readUnits || {}
  let lastGroup = null
  for (const unit of currentLibraryUnits) {
    const groupPath = unit.groupPath || ''
    if (groupPath !== lastGroup) {
      lastGroup = groupPath
      if (groupPath) {
        const divider = document.createElement('div')
        divider.className = 'unit-group-divider'
        divider.textContent = groupPath
        els.libraryUnits.append(divider)
      }
    }
    const isRead = Boolean(readUnits[unit.unitId]?.enteredAt)
    const row = document.createElement('div')
    row.className = `chapter library-unit${isRead ? ' read-chapter' : ' unread-chapter'}`
    row.title = unit.title
    const unitMeta = unit.type === 'epub'
      ? `${unit.chapterCount || 0} 个内部章节${unit.imageCount ? ` · ${unit.imageCount} 张图片` : ''}`
      : `${unit.mediaKind || unit.type || ''} · ${unit.fileName || unit.unitId}${unit.size ? ` · ${formatBytes(unit.size)}` : ''}`
    row.innerHTML = `
      ${renderUnitThumb(unit.cover || currentLibraryItem?.cover, unit.title)}
      <span class="chapter-copy">
        <span class="chapter-title">${escapeHtml(unit.title)}</span>
        <span class="muted">${escapeHtml(unitMeta)}</span>
        ${renderTagList(unit.tags || [])}
      </span>
      <span class="muted">${isRead ? '已读' : '未读'}</span>
      <button class="unit-tags secondary" type="button">标签</button>
    `
    row.addEventListener('click', (event) => {
      if (event.target.closest('button')) return
      openMediaUnit(unit.unitId)
    })
    row.querySelector('.unit-tags')?.addEventListener('click', (event) => {
      event.stopPropagation()
      editLibraryUnitTags(unit)
    })
    els.libraryUnits.append(row)
  }
  if (currentLibraryUnits.length === 0) {
    els.libraryUnits.className = 'chapters empty-panel'
    els.libraryUnits.textContent = '没有目录项'
  }
}

function renderTagList(tags = []) {
  if (!tags.length) return ''
  return `<span class="tag-list">${tags.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join('')}</span>`
}

async function saveLibraryItemTags() {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId) return
  try {
    setLoading(els.librarySaveTags, true)
    const item = await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags: parseTagInput(els.libraryItemTags.value) }),
    })
    currentLibraryItem = item
    await loadLibraryItems()
    await selectLibraryItem(item.type, item.itemId)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.librarySaveTags, false)
  }
}

async function editLibraryUnitTags(unit) {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId || !unit?.unitId) return
  const next = prompt('章节标签，逗号分隔', (unit.tags || []).join(', '))
  if (next === null) return
  try {
    await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/units/${encodeURIComponent(unit.unitId)}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags: parseTagInput(next) }),
    })
    await selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId)
  } catch (error) {
    alert(error.message)
  }
}

function parseTagInput(value) {
  return [...new Set(String(value || '').split(/[,\n，#]+/).map((item) => item.trim()).filter(Boolean))]
}

async function openMediaUnit(unitId, sectionId = '') {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId || !unitId) return
  const activeView = els.views.find((view) => view.classList.contains('active'))?.id
  if (activeView && activeView !== 'media-viewer-view') mediaReturnView = activeView
  showView('media-viewer-view')
  try {
    currentMediaReader = null
    mediaPageIndex = 0
    mediaPageCount = 1
    els.mediaReaderBack.disabled = false
    els.mediaReaderPrev.disabled = true
    els.mediaReaderNext.disabled = true
    els.mediaSectionSelect.disabled = true
    els.mediaSectionSelect.innerHTML = '<option value="">目录</option>'
    els.mediaPagePrev.disabled = true
    els.mediaPageNext.disabled = true
    els.mediaReaderTitle.textContent = unitId
    els.mediaReaderMeta.textContent = '加载中...'
    els.mediaReaderContent.className = 'media-reader-content empty-panel'
    els.mediaReaderContent.textContent = '加载中...'
    const params = new URLSearchParams()
    if (sectionId) params.set('sectionId', sectionId)
    const suffix = params.toString() ? `?${params}` : ''
    const reader = await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/reader/${encodeURIComponent(unitId)}${suffix}`)
    currentMediaReader = reader
    els.mediaReaderTitle.textContent = reader.section?.title || reader.unit?.title || unitId
    els.mediaReaderPrev.disabled = !reader.navigation?.prev
    els.mediaReaderNext.disabled = !reader.navigation?.next
    renderMediaSectionSelect(reader)
    renderMediaReader(reader)
    await saveLibraryProgress(reader.section?.sectionId === currentLibraryProgress?.lastSectionId ? currentLibraryProgress.lastScrollRatio : 0)
    currentLibraryProgress = await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/progress`)
    renderLibraryUnits()
  } catch (error) {
    els.mediaReaderMeta.textContent = `加载失败：${error.message}`
    els.mediaReaderContent.className = 'media-reader-content empty-panel'
    els.mediaReaderContent.textContent = error.message
  }
}

function renderMediaReader(reader) {
  applyMediaReaderTheme()
  const index = Number(reader.unit?.index || 0)
  const sectionText = reader.section ? ` · ${reader.section.index + 1}/${reader.sections?.length || 1}` : ''
  const typeLabel = mediaReaderTypeLabel(reader)
  els.mediaReaderMeta.textContent = `${reader.item?.title || currentLibraryItem?.title || ''} · ${index + 1}/${currentLibraryUnits.length}${sectionText} · ${typeLabel}`
  if (reader.type === 'html') {
    renderMediaHtml(reader)
  } else if (reader.type === 'images') {
    renderMediaImages(reader)
  } else if (reader.type === 'audio' || reader.type === 'video') {
    renderStreamMedia(reader)
  } else {
    els.mediaReaderContent.className = 'media-reader-content empty-panel'
    els.mediaReaderContent.textContent = `暂不支持的阅读内容类型：${reader.type}`
    updateMediaPageControls()
  }
}

function renderMediaSectionSelect(reader) {
  els.mediaSectionSelect.innerHTML = ''
  for (const section of reader.sections || []) {
    const option = document.createElement('option')
    option.value = section.sectionId
    const suffix = section.type === 'gallery' ? ` · ${section.imageCount || 0} 张图` : ''
    option.textContent = `${section.index + 1}. ${section.title}${suffix}`
    els.mediaSectionSelect.append(option)
  }
  els.mediaSectionSelect.value = reader.section?.sectionId || ''
  els.mediaSectionSelect.disabled = !reader.sections?.length
}

function renderMediaHtml(reader) {
  const themeClass = applyMediaReaderTheme()
  els.mediaReaderContent.className = `media-reader-content media-html ${themeClass}`
  const pages = document.createElement('div')
  pages.className = 'media-html-pages'
  pages.innerHTML = reader.content || ''
  els.mediaReaderContent.replaceChildren(pages)
  requestAnimationFrame(() => {
    layoutMediaPages()
    const ratio = reader.section?.sectionId === currentLibraryProgress?.lastSectionId ? currentLibraryProgress.lastScrollRatio : 0
    setMediaPage(Math.round(ratio * Math.max(mediaPageCount - 1, 0)), { save: false })
  })
}

function renderMediaImages(reader) {
  const themeClass = applyMediaReaderTheme()
  els.mediaReaderContent.className = `media-reader-content media-images ${themeClass}`
  if (!reader.images?.length) {
    els.mediaReaderContent.className = 'media-reader-content empty-panel'
    els.mediaReaderContent.textContent = '没有图片资源'
  } else {
    const list = document.createElement('div')
    list.className = 'media-image-list'
    for (const image of reader.images) {
      const img = document.createElement('img')
      img.src = image.url
      img.alt = image.title || `${reader.unit?.title || '图片'} ${Number(image.index || 0) + 1}`
      img.loading = 'lazy'
      img.decoding = 'async'
      list.append(img)
    }
    els.mediaReaderContent.replaceChildren(list)
  }
  mediaPageIndex = 0
  mediaPageCount = 1
  mediaPageStep = 1
  updateMediaPageControls()
}

function renderStreamMedia(reader) {
  const themeClass = applyMediaReaderTheme()
  els.mediaReaderContent.className = `media-reader-content media-stream ${themeClass}`
  const shell = document.createElement('div')
  shell.className = `stream-player stream-player-${reader.type}`
  const player = document.createElement(reader.type)
  player.controls = true
  player.preload = 'metadata'
  player.src = reader.stream?.url || reader.unit?.streamUrl || ''
  if (reader.type === 'video') player.playsInline = true
  const playbackWarning = document.createElement('div')
  playbackWarning.className = 'stream-player-warning hidden'
  const canPlay = player.canPlayType?.(reader.unit?.contentType || '') || ''
  if (reader.unit?.contentType && !canPlay) {
    playbackWarning.classList.remove('hidden')
    playbackWarning.textContent = `当前浏览器可能不支持播放 ${reader.unit.contentType}`
  }
  const subtitleSelect = document.createElement('select')
  subtitleSelect.className = 'stream-subtitle-select'
  const noneOption = document.createElement('option')
  noneOption.value = ''
  noneOption.textContent = '无字幕'
  subtitleSelect.append(noneOption)
  for (const [index, subtitle] of (reader.unit?.subtitles || []).entries()) {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = subtitle.title || subtitle.relativePath || `字幕 ${index + 1}`
    subtitleSelect.append(option)
    const track = document.createElement('track')
    track.kind = 'subtitles'
    track.label = option.textContent
    track.srclang = subtitle.language || 'zh'
    track.src = subtitle.url
    player.append(track)
  }
  subtitleSelect.disabled = !reader.unit?.subtitles?.length
  subtitleSelect.addEventListener('change', () => {
    const selectedIndex = subtitleSelect.value === '' ? -1 : Number(subtitleSelect.value)
    for (const [index, track] of [...player.textTracks].entries()) {
      track.mode = index === selectedIndex ? 'showing' : 'disabled'
    }
  })
  const title = document.createElement('div')
  title.className = 'stream-player-title'
  title.textContent = reader.unit?.title || reader.unit?.fileName || '媒体'
  const meta = document.createElement('div')
  meta.className = 'muted'
  meta.textContent = [
    reader.unit?.fileName || '',
    reader.unit?.contentType || '',
    reader.unit?.size ? formatBytes(reader.unit.size) : '',
    reader.stream?.streamPath || '',
  ].filter(Boolean).join(' · ')
  player.addEventListener('ended', () => saveLibraryProgress(1).catch(() => {}))
  player.addEventListener('error', () => {
    const code = player.error?.code
    const suffix = code ? ` (${code})` : ''
    playbackWarning.classList.remove('hidden')
    playbackWarning.textContent = `播放失败${suffix}：浏览器不支持该编码，或媒体文件无法被当前播放器解码`
  })
  shell.append(title, player, subtitleSelect, playbackWarning, meta)
  els.mediaReaderContent.replaceChildren(shell)
  mediaPageIndex = 0
  mediaPageCount = 1
  mediaPageStep = 1
  updateMediaPageControls()
}

function mediaReaderTypeLabel(reader) {
  if (reader.type === 'images') return `${reader.images?.length || 0} 张图`
  if (reader.type === 'audio') return `音频${reader.unit?.size ? ` · ${formatBytes(reader.unit.size)}` : ''}`
  if (reader.type === 'video') return `视频${reader.unit?.size ? ` · ${formatBytes(reader.unit.size)}` : ''}`
  return '文本'
}

function layoutMediaPages() {
  const content = els.mediaReaderContent
  const pages = content.querySelector('.media-html-pages')
  if (!pages) return
  const gap = Math.max(24, Math.min(48, Math.round(content.clientWidth * 0.06)))
  const pageWidth = Math.max(320, content.clientWidth - 56)
  pages.style.setProperty('--media-page-width', `${pageWidth}px`)
  pages.style.setProperty('--media-page-gap', `${gap}px`)
  mediaPageStep = pageWidth + gap
  mediaMaxScrollLeft = Math.max(0, content.scrollWidth - content.clientWidth)
  mediaPageCount = mediaMaxScrollLeft <= 0 ? 1 : Math.ceil(mediaMaxScrollLeft / mediaPageStep) + 1
  mediaPageIndex = Math.max(0, Math.min(mediaPageIndex, mediaPageCount - 1))
  content.scrollLeft = mediaPageScrollLeft(mediaPageIndex)
  updateMediaPageControls()
}

function setMediaPage(pageIndex, { save = true } = {}) {
  if (currentMediaReader?.type !== 'html') return
  mediaPageIndex = Math.max(0, Math.min(pageIndex, mediaPageCount - 1))
  els.mediaReaderContent.scrollTo({ left: mediaPageScrollLeft(mediaPageIndex), top: 0, behavior: 'smooth' })
  updateMediaPageControls()
  if (save) scheduleLibraryProgressSave()
}

function mediaPageScrollLeft(pageIndex) {
  return Math.max(0, Math.min(mediaMaxScrollLeft, pageIndex * mediaPageStep))
}

function mediaScrollRatio() {
  if (currentMediaReader?.type !== 'html') return currentMediaReader?.type === 'images' ? 1 : 0.1
  return mediaPageCount <= 1 ? 1 : Math.max(0, Math.min(1, mediaPageIndex / (mediaPageCount - 1)))
}

function updateMediaPageControls() {
  const isHtml = currentMediaReader?.type === 'html'
  els.mediaPagePrev.disabled = !isHtml || mediaPageIndex <= 0
  els.mediaPageNext.disabled = !isHtml || (mediaPageIndex >= mediaPageCount - 1 && !currentMediaReader?.sectionNavigation?.next && !currentMediaReader?.navigation?.next)
  if (isHtml) {
    const sectionText = currentMediaReader.section ? ` · ${currentMediaReader.section.index + 1}/${currentMediaReader.sections?.length || 1}` : ''
    els.mediaReaderMeta.textContent = `${currentMediaReader.item?.title || currentLibraryItem?.title || ''} · ${(currentMediaReader.unit?.index || 0) + 1}/${currentLibraryUnits.length}${sectionText} · 第 ${mediaPageIndex + 1}/${mediaPageCount} 页`
  }
}

function mediaReaderThemeClass() {
  const theme = els.mediaReaderTheme?.value || 'light'
  return `reader-theme-${['light', 'dark', 'warm', 'sepia'].includes(theme) ? theme : 'light'}`
}

function applyMediaReaderTheme() {
  const themeClass = mediaReaderThemeClass()
  els.mediaViewerView.classList.remove(...mediaReaderThemeClasses)
  els.mediaViewerView.classList.add(themeClass)
  return themeClass
}

function applySiteTheme(theme) {
  const normalized = ['light', 'dark', 'warm', 'sepia'].includes(theme) ? theme : 'light'
  els.app.classList.remove(...siteThemeClasses)
  els.app.classList.add(`site-theme-${normalized}`)
  return normalized
}

async function saveLibraryProgress(scrollRatio = mediaScrollRatio()) {
  if (!currentLibraryItem || !currentMediaReader?.unit) return
  currentLibraryProgress = await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/progress`, {
    method: 'POST',
    body: JSON.stringify({
      unitId: currentMediaReader.unit.unitId,
      title: currentMediaReader.unit.title,
      sectionId: currentMediaReader.section?.sectionId || '',
      sectionTitle: currentMediaReader.section?.title || '',
      scrollRatio,
    }),
  })
}

function scheduleLibraryProgressSave() {
  if (libraryProgressTimer) clearTimeout(libraryProgressTimer)
  libraryProgressTimer = setTimeout(() => {
    saveLibraryProgress().catch(() => {})
  }, 500)
}

els.favoriteRefresh.addEventListener('click', loadFavorite)
els.favoriteOrdering.addEventListener('change', loadFavorite)
els.discoverRefresh.addEventListener('click', () => {
  discoverOffset = 0
  loadDiscover()
})
els.chapterRefresh.addEventListener('click', () => {
  const selected = selectedComicByTarget.search
  if (selected.pathWord) loadComic(selected.pathWord, 'search', selected.title)
})
els.discoverChapterRefresh.addEventListener('click', () => {
  const selected = selectedComicByTarget.discover
  if (selected.pathWord) loadComic(selected.pathWord, 'discover', selected.title)
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
els.downloadedReadFilter.addEventListener('change', () => {
  downloadedPage = 1
  renderDownloaded(downloaded)
})
els.downloadedComicRefresh.addEventListener('click', () => {
  if (currentDownloadedComicPathWord) loadDownloadedComic(currentDownloadedComicPathWord, { refreshOnly: true })
})
els.downloadedMarkAllRead.addEventListener('click', async () => {
  if (!currentDownloadedComic?.comicPathWord || !currentDownloadedComic.chapters?.length) return
  try {
    setLoading(els.downloadedMarkAllRead, true)
    const progress = await api('/api/reading-progress/mark-all', {
      method: 'POST',
      body: JSON.stringify(currentDownloadedComic),
    })
    readingProgress[progress.comicPathWord] = progress
    applyReadingColors(progress.comicPathWord)
    renderDownloaded(downloaded)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.downloadedMarkAllRead, false)
  }
})
els.libraryRefresh.addEventListener('click', loadLibraryItems)
els.libraryType.addEventListener('change', loadLibraryItems)
els.libraryTagSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadLibraryItems()
})
els.librarySaveTags.addEventListener('click', saveLibraryItemTags)
els.librarySample.addEventListener('click', async () => {
  if (!confirm('生成示例会在媒体库里新增一套测试 EPUB 合集。确定要继续吗？')) return
  try {
    setLoading(els.librarySample, true)
    const item = await api('/api/library/items/sample?type=epub', { method: 'POST', body: '{}' })
    if (els.libraryType.value !== 'epub' && els.libraryType.value !== 'all') els.libraryType.value = 'all'
    await loadLibraryItems()
    await selectLibraryItem(item.type, item.itemId)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.librarySample, false)
  }
})
els.mediaImportRefresh.addEventListener('click', loadMediaImportItems)
els.mediaImportType.addEventListener('change', () => {
  updateMediaImportControls()
  loadMediaImportItems()
})
els.mediaImportItem.addEventListener('change', () => {
  const selected = els.mediaImportItem.selectedOptions?.[0]
  if (els.mediaImportItem.value) els.mediaImportTitle.value = selected?.dataset.title || selected?.textContent || ''
  updateMediaImportMeta()
})
els.mediaImportTitle.addEventListener('input', updateMediaImportMeta)
els.mediaImportSourcePath.addEventListener('input', updateMediaImportMeta)
els.mediaImportSubmit.addEventListener('click', async () => {
  const type = els.mediaImportType.value || 'epub'
  const info = mediaImportTypeInfo[type] || { label: type, source: false }
  const files = [...(els.mediaImportFiles.files || [])]
  const sourcePath = els.mediaImportSourcePath.value.trim()
  if (!files.length && (!info.source || !sourcePath)) return alert(`请选择 ${info.label} 文件${info.source ? '或填写来源路径' : ''}`)
  if (!els.mediaImportItem.value && !els.mediaImportTitle.value.trim()) return alert('请输入合集名称')
  try {
    setLoading(els.mediaImportSubmit, true)
    const form = new FormData()
    form.set('title', els.mediaImportTitle.value.trim())
    if (els.mediaImportItem.value) form.set('itemId', els.mediaImportItem.value)
    if (sourcePath) form.set('sourcePath', sourcePath)
    for (const file of files) form.append('file', file)
    const item = await apiForm(`/api/library/items?type=${encodeURIComponent(type)}`, form)
    els.mediaImportFiles.value = ''
    if (sourcePath) els.mediaImportSourcePath.value = ''
    await loadMediaImportItems()
    els.mediaImportItem.value = item.itemId
    els.mediaImportTitle.value = item.title
    updateMediaImportMeta()
    if (els.libraryType.value !== item.type && els.libraryType.value !== 'all') els.libraryType.value = 'all'
    await loadLibraryItems()
    await selectLibraryItem(item.type, item.itemId)
    showView('library-view')
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.mediaImportSubmit, false)
  }
})
els.mediaReaderBack.addEventListener('click', () => {
  showView(mediaReturnView || 'library-view')
})
els.mediaReaderPrev.addEventListener('click', () => {
  const target = currentMediaReader?.navigation?.prev
  if (target) openMediaUnit(target.unitId)
})
els.mediaReaderNext.addEventListener('click', () => {
  const target = currentMediaReader?.navigation?.next
  if (target) openMediaUnit(target.unitId)
})
els.mediaSectionSelect.addEventListener('change', () => {
  if (currentMediaReader?.unit?.unitId && els.mediaSectionSelect.value) {
    openMediaUnit(currentMediaReader.unit.unitId, els.mediaSectionSelect.value)
  }
})
els.mediaReaderTheme.addEventListener('change', () => {
  localStorage.setItem('copymanga.mediaReaderTheme', els.mediaReaderTheme.value)
  applyMediaReaderTheme()
  if (currentMediaReader) renderMediaReader(currentMediaReader)
})
els.configSiteTheme.addEventListener('change', () => {
  applySiteTheme(els.configSiteTheme.value)
})
els.mediaPagePrev.addEventListener('click', () => setMediaPage(mediaPageIndex - 1))
els.mediaPageNext.addEventListener('click', () => {
  if (currentMediaReader?.type === 'html' && mediaPageIndex < mediaPageCount - 1) {
    setMediaPage(mediaPageIndex + 1)
    return
  }
  const sectionTarget = currentMediaReader?.sectionNavigation?.next
  if (sectionTarget) {
    openMediaUnit(currentMediaReader.unit.unitId, sectionTarget.sectionId)
    return
  }
  const target = currentMediaReader?.navigation?.next
  if (target) openMediaUnit(target.unitId)
})
window.addEventListener('resize', () => {
  if (currentMediaReader?.type === 'html' && document.querySelector('#media-viewer-view')?.classList.contains('active')) {
    layoutMediaPages()
  }
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
els.downloadedImageCheck.addEventListener('click', async () => {
  try {
    setLoading(els.downloadedImageCheck, true)
    const data = await api('/api/image-check/inventory', { method: 'POST', body: '{}' })
    els.downloadedImageCheck.dataset.text ||= '检查图片'
    els.downloadedImageCheck.textContent = `检查中 ${data.summary?.queued || data.queued?.length || 0}`
    await loadDownloaded()
  } catch (error) {
    alert(error.message)
  } finally {
    setTimeout(() => {
      els.downloadedImageCheck.disabled = false
      els.downloadedImageCheck.textContent = els.downloadedImageCheck.dataset.text || '检查图片'
    }, 800)
  }
})
els.viewerRefresh.addEventListener('click', () => {
  if (viewerState) openChapterViewer(viewerState)
})
els.viewerPrev.addEventListener('click', () => openAdjacentViewer('prev'))
els.viewerNext.addEventListener('click', () => openAdjacentViewer('next'))
els.viewerBack.addEventListener('click', () => {
  showView(viewerState?.returnView || viewerReturnView || 'search-view')
})
els.taskSearch.addEventListener('input', renderTaskList)
els.taskStatusFilter.addEventListener('change', renderTaskList)
els.taskClearCompleted.addEventListener('click', async () => {
  try {
    setLoading(els.taskClearCompleted, true)
    await api('/api/jobs/clear-completed', { method: 'POST', body: '{}' })
    jobs = jobs.filter((job) => job.status !== 'completed')
    renderJobs()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.taskClearCompleted, false)
  }
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
        siteTheme: els.configSiteTheme.value,
        readColor: els.configReadColor.value,
        unreadColor: els.configUnreadColor.value,
        updateDownloadedComicsIntervalSec: Number(els.configUpdateDownloadedComicsIntervalSec.value),
        mediaStreamApiBase: els.configMediaStreamApiBase.value,
        mediaManagedBasePath: els.configMediaManagedBasePath.value,
        mediaStreamBasePath: els.configMediaStreamBasePath.value,
        mediaImportSourceRoots: els.configMediaImportSourceRoots.value,
        mediaSubtitleExtensions: els.configMediaSubtitleExtensions.value,
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
    const retried = data.retried || []
    const retryIds = new Set(retried.map((job) => job.id))
    jobs = [...retried, ...jobs.filter((job) => !retryIds.has(job.id))]
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

function formatBytes(value) {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  const digits = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(digits)} ${units[index]}`
}

function renderCover(src, alt) {
  if (!src) return '<div class="cover placeholder"></div>'
  return `<img class="cover" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`
}

function renderUnitThumb(src, alt) {
  if (!src) return '<span class="unit-thumb placeholder"></span>'
  return `<img class="unit-thumb" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`
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
events.addEventListener('imageCheck', (event) => {
  const job = JSON.parse(event.data)
  if (job.status === 'completed' || job.status === 'failed') {
    refreshDownloadedState().then(() => {
      if (document.querySelector('#downloaded-view')?.classList.contains('active')) renderDownloaded(downloaded)
      if (currentDownloadedComicPathWord === job.comicPathWord) {
        loadDownloadedComic(job.comicPathWord).catch(() => {})
      }
    }).catch(() => {})
  }
})
events.addEventListener('inventoryUpdate', (event) => {
  const update = JSON.parse(event.data)
  renderInventoryUpdate(update)
  if (update.status === 'completed') {
    loadDownloaded().catch(() => {})
  }
})

refreshDownloadedState().catch(() => {})
loadReadingProgress().catch(() => {})
loadConfig().catch(() => {})
api('/api/inventory-update').then(renderInventoryUpdate).catch(() => {})
setInterval(() => {
  syncJobs().catch(() => {})
}, 2000)
