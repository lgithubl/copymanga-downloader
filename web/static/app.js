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
  discoverFirst: document.querySelector('#discover-first'),
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
  downloadedKeyword: document.querySelector('#downloaded-keyword'),
  downloadedFirst: document.querySelector('#downloaded-first'),
  downloadedPrev: document.querySelector('#downloaded-prev'),
  downloadedNext: document.querySelector('#downloaded-next'),
  downloadedPage: document.querySelector('#downloaded-page'),
  downloadedPageTotal: document.querySelector('#downloaded-page-total'),
  downloadedJump: document.querySelector('#downloaded-jump'),
  downloadedLimit: document.querySelector('#downloaded-limit'),
  downloadedReadFilter: document.querySelector('#downloaded-read-filter'),
  downloadedImageFilter: document.querySelector('#downloaded-image-filter'),
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
  librarySeriesSubtitle: document.querySelector('#library-series-subtitle'),
  seriesModal: document.querySelector('#series-modal'),
  seriesModalTitle: document.querySelector('#series-modal-title'),
  seriesModalList: document.querySelector('#series-modal-list'),
  seriesModalClose: document.querySelector('#series-modal-close'),
  libraryTagClear: document.querySelector('#library-tag-clear'),
  libraryFirst: document.querySelector('#library-first'),
  libraryPrev: document.querySelector('#library-prev'),
  libraryPage: document.querySelector('#library-page'),
  libraryPageTotal: document.querySelector('#library-page-total'),
  libraryJump: document.querySelector('#library-jump'),
  libraryNext: document.querySelector('#library-next'),
  libraryLimit: document.querySelector('#library-limit'),
  librarySort: document.querySelector('#library-sort'),
  librarySample: document.querySelector('#library-sample'),
  librarySearch: document.querySelector('#library-search'),
  libraryRefresh: document.querySelector('#library-refresh'),
  libraryIndexRebuild: document.querySelector('#library-index-rebuild'),
  libraryIndexStatus: document.querySelector('#library-index-status'),
  libraryItems: document.querySelector('#library-items'),
  libraryItemTitle: document.querySelector('#library-item-title'),
  libraryItemMeta: document.querySelector('#library-item-meta'),
  libraryItemTags: document.querySelector('#library-item-tags'),
  librarySaveTags: document.querySelector('#library-save-tags'),
  librarySubtitles: document.querySelector('#library-subtitles'),
  libraryThumbnails: document.querySelector('#library-thumbnails'),
  libraryUnits: document.querySelector('#library-units'),
  libraryTagScripts: document.querySelector('#library-tag-scripts'),
  libraryRunTagScripts: document.querySelector('#library-run-tag-scripts'),
  libraryRunPageTagScripts: document.querySelector('#library-run-page-tag-scripts'),
  libraryRunSelectedUnits: document.querySelector('#library-run-selected-units'),
  tagScriptsReload: document.querySelector('#tag-scripts-reload'),
  tagScriptUploadFile: document.querySelector('#tag-script-upload-file'),
  tagScriptUpload: document.querySelector('#tag-script-upload'),
  tagManagerRefresh: document.querySelector('#tag-manager-refresh'),
  tagManagerKeyword: document.querySelector('#tag-manager-keyword'),
  tagManagerSearch: document.querySelector('#tag-manager-search'),
  tagManagerFirst: document.querySelector('#tag-manager-first'),
  tagManagerPrev: document.querySelector('#tag-manager-prev'),
  tagManagerNext: document.querySelector('#tag-manager-next'),
  tagManagerPageInfo: document.querySelector('#tag-manager-page-info'),
  tagScriptsFirst: document.querySelector('#tag-scripts-first'),
  tagScriptsPrev: document.querySelector('#tag-scripts-prev'),
  tagScriptsNext: document.querySelector('#tag-scripts-next'),
  tagScriptsPageInfo: document.querySelector('#tag-scripts-page-info'),
  tagJobsFirst: document.querySelector('#tag-jobs-first'),
  tagJobsPrev: document.querySelector('#tag-jobs-prev'),
  tagJobsNext: document.querySelector('#tag-jobs-next'),
  tagJobsPageInfo: document.querySelector('#tag-jobs-page-info'),
  tagDisplayPriority: document.querySelector('#tag-display-priority'),
  tagManagerTags: document.querySelector('#tag-manager-tags'),
  tagManagerScripts: document.querySelector('#tag-manager-scripts'),
  tagManagerJobs: document.querySelector('#tag-manager-jobs'),
  historyType: document.querySelector('#history-type'),
  historyKeyword: document.querySelector('#history-keyword'),
  historyRefresh: document.querySelector('#history-refresh'),
  historyClear: document.querySelector('#history-clear'),
  historyList: document.querySelector('#history-list'),
  mediaImportType: document.querySelector('#media-import-type'),
  mediaImportProfile: document.querySelector('#media-import-profile'),
  mediaImportRefresh: document.querySelector('#media-import-refresh'),
  mediaImportItem: document.querySelector('#media-import-item'),
  mediaImportTitle: document.querySelector('#media-import-title'),
  mediaImportSourcePath: document.querySelector('#media-import-source-path'),
  mediaImportFilesLabel: document.querySelector('#media-import-files-label'),
  mediaImportFiles: document.querySelector('#media-import-files'),
  mediaImportTagScripts: document.querySelector('#media-import-tag-scripts'),
  mediaImportProfileConfig: document.querySelector('#media-import-profile-config'),
  mediaImportProfileConfigSave: document.querySelector('#media-import-profile-config-save'),
  mediaImportProfileConfigReset: document.querySelector('#media-import-profile-config-reset'),
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
let downloadedTotalPages = 1
let currentDownloadedComicPathWord = ''
let discoverOffset = 0
let discoverTotal = 0
let inventoryUpdate = null
let inventoryPollTimer = null
let downloadedRefreshTimer = null
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
let libraryPage = 1
let libraryTotalPages = 1
let libraryTotalItems = 0
let libraryIndexStatus = null
let libraryStateRestored = false
let libraryHistory = []
let libraryHistoryByKey = new Map()

const LIBRARY_STATE_KEY = 'copymanga.library.state'
const MEDIA_SUBTITLE_SETTINGS_KEY = 'copymanga.mediaSubtitleOverlay'
let tagScripts = []
let tagJobs = []
let tagCatalog = []
let tagManagerPage = 1
let tagManagerPageSize = 200
let tagManagerTotal = 0
let tagManagerTotalPages = 1
let tagScriptsPage = 1
let tagScriptsPageSize = 200
let tagScriptsTotal = 0
let tagScriptsTotalPages = 1
let tagJobsPage = 1
let tagJobsPageSize = 200
let tagJobsTotal = 0
let tagJobsTotalPages = 1
let mediaTagDisplayKeys = []
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
let currentStreamCleanup = null
let appConfig = null
const mediaReaderThemeClasses = ['reader-theme-light', 'reader-theme-dark', 'reader-theme-warm', 'reader-theme-sepia']
const mediaModeClasses = ['media-mode-empty', 'media-mode-html', 'media-mode-images', 'media-mode-audio', 'media-mode-video']
const siteThemeClasses = ['site-theme-light', 'site-theme-dark', 'site-theme-warm', 'site-theme-sepia']
const defaultMediaImportProfiles = {
  'rj-media': {
    maxDepth: 6,
    idPattern: '(?:RJ|VJ|BJ|EJ)\\d{6,8}',
    defaultMetadataActions: ['builtin-scan-media-units', 'builtin-subtitles', 'rj-dlsite-v1', 'builtin-thumbnails'],
    fetchDlsiteCover: true,
    fetchDlsiteTitle: true,
    dlsiteRequestMinIntervalMs: 1500,
    dlsiteRequestJitterMs: 800,
  },
  // 原先靠 scriptHints 模糊匹配勾上字幕扫描，去掉模糊匹配后在这里显式列出，
  // 行为与之前一致（但不再误勾 AI 字幕/翻译）
  'normal-video': {
    defaultMetadataActions: ['builtin-subtitles'],
  },
}
const mediaImportTypeInfo = {
  epub: { label: 'EPUB', unit: '个 EPUB', accept: '.epub,application/epub+zip', source: false },
  media: { label: '媒体', unit: '个媒体项', accept: '.zip,.epub,application/epub+zip,.aac,.flac,.m4a,.mp3,.ogg,.opus,.wav,.webm,.m4v,.mkv,.mov,.mp4,.jpg,.jpeg,.png,.gif,.srt,.vtt,.crt,.ass,.ssa,.lrc,.sbv,.smi,.sami,.ttml,.dfxp,.xml,.sub,image/*,audio/*,video/*', source: true },
}
const mediaImportProfiles = {
  custom: { label: '自定义', type: 'media', sourcePlaceholder: '/input/album' },
  'rj-media': { label: 'RJ 媒体', type: 'media', sourcePlaceholder: '/input/rj', batch: true },
  'normal-video': { label: '普通视频', type: 'media', sourcePlaceholder: '/input/video' },
  epub: { label: 'EPUB', type: 'epub', sourcePlaceholder: '' },
}
const mediaPlaybackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const defaultMediaSubtitleExtensions = 'srt,vtt,crt,ass,ssa,lrc,sbv,smi,sami,ttml,dfxp,xml,sub'
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
  superseded: '已重试',
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
  els.discoverFirst.disabled = discoverOffset <= 0
  els.discoverPrev.disabled = discoverOffset <= 0
  els.discoverNext.disabled = discoverOffset + limit >= discoverTotal
  renderComicCards(els.discoverResults, list, (pathWord, title) => loadComic(pathWord, 'discover', title))
}

function renderDownloaded(payload) {
  const isPaged = payload && !Array.isArray(payload) && Array.isArray(payload.items)
  const list = isPaged ? payload.items : payload
  downloaded = list
  els.downloaded.innerHTML = ''
  const visibleList = isPaged ? list : list.filter(inventoryReadMatches)
  const limit = Math.max(1, Number(els.downloadedLimit.value || 10))
  const totalPages = isPaged ? Math.max(1, Number(payload.totalPages || 1)) : Math.max(1, Math.ceil(visibleList.length / limit))
  downloadedTotalPages = totalPages
  downloadedPage = isPaged ? Math.max(1, Number(payload.page || 1)) : Math.max(1, Math.min(totalPages, downloadedPage))
  const offset = isPaged ? 0 : (downloadedPage - 1) * limit
  if (document.activeElement !== els.downloadedPage) {
    els.downloadedPage.value = String(downloadedPage)
  }
  els.downloadedPage.max = String(totalPages)
  els.downloadedPageTotal.textContent = `/ ${totalPages} 页`
  els.downloadedFirst.disabled = downloadedPage <= 1
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
  downloadedPage = Math.max(1, Math.min(downloadedTotalPages, Math.floor(Number(els.downloadedPage.value || 1))))
  loadDownloaded()
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
  els.app.classList.toggle('media-viewer-focused', id === 'media-viewer-view')
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
        ${isDownloaded ? '<button class="chapter-image-check secondary" type="button" title="检查本章图片">检查</button>' : ''}
        <button class="chapter-redownload danger" type="button">重下</button>
      `
      row.addEventListener('click', (event) => {
        if (event.target.closest('button') || event.target.closest('input')) return
        event.preventDefault()
        openChapterViewer({
          comicPathWord,
          chapterUuid: id,
          title,
          comicTitle,
        })
      })
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
      row.querySelector('.chapter-image-check')?.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        requestChapterImageCheck({
          comicPathWord,
          chapterUuid: id,
          chapterTitle: chapterTitle(chapter),
          button: event.currentTarget,
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

async function requestChapterImageCheck({ comicPathWord, chapterUuid, chapterTitle, button }) {
  if (!comicPathWord || !chapterUuid) return
  try {
    setLoading(button, true)
    await api('/api/image-check/chapter', {
      method: 'POST',
      body: JSON.stringify({ comicPathWord, chapterUuid, chapterTitle }),
    })
    button.textContent = '检查中'
    await refreshDownloadedState()
    if (currentDownloadedComicPathWord === comicPathWord) {
      loadDownloadedComic(comicPathWord).catch(() => {})
    }
  } catch (error) {
    alert(error.message)
  } finally {
    setTimeout(() => {
      button.disabled = false
      button.textContent = '检查'
    }, 800)
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
  const visible = jobs.filter((job) => !['completed', 'superseded'].includes(job.status) && !job.deleted)
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
        job.supersededBy,
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
    const relationText = [
      job.retryOf ? `重试自 ${job.retryOf}` : '',
      job.supersededBy ? `已由 ${job.supersededBy} 重试` : '',
    ].filter(Boolean).join(' · ')
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
        <small>章节 ${job.doneChapters}/${job.totalChapters} · 图片 ${job.doneImages}/${job.totalImages || '?'} · pending ${imageCounts.pending || 0} · running ${imageCounts.running || 0} · done ${imageCounts.completed || 0} · failed ${imageCounts.failed || 0}${escapeHtml(failedText)}${relationText ? ` · ${escapeHtml(relationText)}` : ''} · ${escapeHtml(job.updatedAt || '')}</small>
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
    if (wasRunning) scheduleDownloadedRefreshIfActive(0)
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
  appConfig = config
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
  els.configMediaSubtitleExtensions.value = config.mediaSubtitleExtensions || defaultMediaSubtitleExtensions
  mediaTagDisplayKeys = Array.isArray(config.mediaTagDisplayKeys) ? config.mediaTagDisplayKeys : []
  els.configExportDir.value = config.exportDir
  els.configExportDirFmt.value = config.exportDirFmt
  els.configMergePdfFmt.value = config.mergePdfFmt
  els.configCreatePdfConcurrency.value = config.createPdfConcurrency
  els.configEnableMergePdf.checked = config.enableMergePdf
  els.configExportSkipMode.value = config.exportSkipMode
  renderMediaImportProfileConfig()
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
      loadLibraryTypes()
        .then(() => Promise.all([loadLibraryItems(), loadTagScripts()]))
        .catch((error) => alert(error.message))
    }
    if (tab.dataset.view === 'history-view') {
      loadLibraryTypes().then(loadLibraryHistory).catch((error) => alert(error.message))
    }
    if (tab.dataset.view === 'tag-manager-view') {
      loadTagManager().catch((error) => alert(error.message))
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

async function loadDownloaded({ silent = false } = {}) {
  try {
    if (!silent) setLoading(els.downloadedRefresh, true)
    renderDownloaded(await api(`/api/downloaded?${downloadedPageParams(downloadedPage)}`))
  } catch (error) {
    alert(error.message)
  } finally {
    if (!silent) setLoading(els.downloadedRefresh, false)
  }
}

function scheduleDownloadedRefreshIfActive(delay = 1200) {
  if (!document.querySelector('#downloaded-view')?.classList.contains('active')) return
  if (downloadedRefreshTimer) clearTimeout(downloadedRefreshTimer)
  downloadedRefreshTimer = setTimeout(() => {
    downloadedRefreshTimer = null
    loadDownloaded({ silent: true }).catch(() => {})
  }, Math.max(0, delay))
}

function downloadedPageParams(page = downloadedPage) {
  return new URLSearchParams({
    page: String(Math.max(1, Math.floor(Number(page) || 1))),
    limit: String(Math.max(1, Number(els.downloadedLimit.value || 10))),
    readFilter: els.downloadedReadFilter?.value || 'all',
    imageFilter: els.downloadedImageFilter?.value || 'all',
    keyword: els.downloadedKeyword?.value.trim() || '',
  })
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
  const currentHistory = els.historyType?.value || 'all'
  const currentImport = els.mediaImportType.value || 'epub'
  els.libraryType.innerHTML = '<option value="all">全部类型</option>'
  els.historyType.innerHTML = '<option value="all">全部类型</option>'
  els.mediaImportType.innerHTML = ''
  for (const type of libraryTypes) {
    const option = document.createElement('option')
    option.value = type.type
    option.textContent = type.label || type.type
    els.libraryType.append(option)
    const historyOption = option.cloneNode(true)
    els.historyType.append(historyOption)
    if (type.importable) {
      const importOption = document.createElement('option')
      importOption.value = type.type
      importOption.textContent = type.label || mediaImportTypeInfo[type.type]?.label || type.type
      els.mediaImportType.append(importOption)
    }
  }
  els.libraryType.value = [...els.libraryType.options].some((option) => option.value === current) ? current : 'all'
  els.historyType.value = [...els.historyType.options].some((option) => option.value === currentHistory) ? currentHistory : 'all'
  els.mediaImportType.value = [...els.mediaImportType.options].some((option) => option.value === currentImport) ? currentImport : 'epub'
  restoreLibraryState()
  updateMediaImportControls()
}

function restoreLibraryState() {
  if (libraryStateRestored) return
  libraryStateRestored = true
  let state = null
  try {
    state = JSON.parse(localStorage.getItem(LIBRARY_STATE_KEY) || 'null')
  } catch {
    state = null
  }
  if (!state || typeof state !== 'object') return
  const type = String(state.type || 'all')
  if (els.libraryType && [...els.libraryType.options].some((option) => option.value === type)) els.libraryType.value = type
  const limit = String(state.limit || '')
  if (els.libraryLimit && [...els.libraryLimit.options].some((option) => option.value === limit)) els.libraryLimit.value = limit
  const sort = String(state.sort || '')
  if (els.librarySort && [...els.librarySort.options].some((option) => option.value === sort)) els.librarySort.value = sort
  if (els.libraryTagSearch) els.libraryTagSearch.value = String(state.tag || '')
  if (els.librarySeriesSubtitle) els.librarySeriesSubtitle.value = String(state.seriesSubtitle || 'any')
  libraryPage = Math.max(1, Math.floor(Number(state.page || 1)))
}

function saveLibraryState() {
  const state = {
    type: els.libraryType?.value || 'all',
    limit: Number(els.libraryLimit?.value || 10),
    sort: els.librarySort?.value || 'imported_desc',
    tag: els.libraryTagSearch?.value || '',
    seriesSubtitle: els.librarySeriesSubtitle?.value || 'any',
    page: Math.max(1, Math.floor(Number(libraryPage || 1))),
  }
  localStorage.setItem(LIBRARY_STATE_KEY, JSON.stringify(state))
}

async function loadLibraryItems() {
  try {
    setLoading(els.libraryRefresh, true)
    const type = els.libraryType.value || 'all'
    const limit = Math.max(1, Number(els.libraryLimit?.value || 10))
    const sort = els.librarySort?.value || 'imported_desc'
    const params = new URLSearchParams({
      type,
      page: String(libraryPage),
      limit: String(limit),
      sort,
    })
    if (els.libraryTagSearch.value.trim()) params.set('tag', els.libraryTagSearch.value.trim())
    const seriesSubtitle = els.librarySeriesSubtitle?.value || 'any'
    if (seriesSubtitle !== 'any') params.set('seriesSubtitle', seriesSubtitle)
    const historyParams = new URLSearchParams({ type, limit: '1000' })
    const [payload, histories] = await Promise.all([
      api(`/api/library/items?${params}`),
      api(`/api/library/history?${historyParams}`),
    ])
    libraryItems = pageItems(payload)
    const meta = pageMeta(payload, libraryPage, limit)
    libraryPage = meta.page
    libraryTotalPages = meta.totalPages
    libraryTotalItems = meta.total
    libraryIndexStatus = payload?.index || null
    setLibraryHistory(histories)
    saveLibraryState()
    renderLibraryItems()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.libraryRefresh, false)
  }
}

async function loadTagScripts({ reload = false } = {}) {
  const params = new URLSearchParams({ page: '1', limit: '1000' })
  if (reload) params.set('reload', '1')
  const payload = await api(`/api/metadata-actions?${params}`)
  tagScripts = pageItems(payload)
  renderTagScriptPickers()
  return tagScripts
}

function renderTagScriptPickers() {
  renderTagScriptCheckboxes(els.mediaImportTagScripts, 'media-import-tag-script')
  renderTagScriptCheckboxes(els.libraryTagScripts, 'library-tag-script')
  applyMediaImportProfile()
  updateLibraryMetadataActionButtons()
}

function renderTagScriptCheckboxes(container, name) {
  if (!container) return
  container.classList.remove('muted')
  container.innerHTML = ''
  const valid = tagScripts.filter((script) => !script.error)
  if (!valid.length) {
    container.classList.add('muted')
    container.textContent = '暂无元数据脚本'
    return
  }
  for (const script of valid) {
    const label = document.createElement('label')
    label.className = 'checkbox-line tag-script-option'
    label.innerHTML = `
      <input type="checkbox" name="${name}" value="${escapeHtml(script.id)}" ${script.defaultEnabled ? 'checked' : ''} />
      <span>${escapeHtml(script.name)} <small>v${escapeHtml(script.version)}</small></span>
    `
    container.append(label)
  }
}

function checkedTagScriptIds(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value)
}

function filterTagScriptIdsByScope(actionIds, scope) {
  if (!scope) return actionIds
  const selected = new Set(actionIds)
  return tagScripts
    .filter((script) => selected.has(script.id) && Array.isArray(script.scope) && script.scope.includes(scope))
    .map((script) => script.id)
}

function pageItems(payload) {
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : [])
}

function pageMeta(payload, fallbackPage, fallbackLimit) {
  if (Array.isArray(payload)) {
    return {
      page: fallbackPage,
      limit: fallbackLimit,
      total: payload.length,
      totalPages: Math.max(1, Math.ceil(payload.length / Math.max(1, fallbackLimit))),
    }
  }
  return {
    page: Number(payload?.page || fallbackPage || 1),
    limit: Number(payload?.limit || fallbackLimit || 200),
    total: Number(payload?.total || 0),
    totalPages: Number(payload?.totalPages || 1),
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadTagManager({ reloadScripts = false } = {}) {
  try {
    setLoading(els.tagManagerRefresh, true)
    const keyword = String(els.tagManagerKeyword?.value || '').trim()
    const tagParams = new URLSearchParams({ page: String(tagManagerPage), limit: String(tagManagerPageSize) })
    if (keyword) tagParams.set('keyword', keyword)
    const scriptParams = new URLSearchParams({ page: String(tagScriptsPage), limit: String(tagScriptsPageSize) })
    if (reloadScripts) scriptParams.set('reload', '1')
    const jobParams = new URLSearchParams({ page: String(tagJobsPage), limit: String(tagJobsPageSize) })
    const [tagsPayload, scriptsPayload, jobsPayload] = await Promise.all([
      api(`/api/library/tags?${tagParams}`),
      api(`/api/metadata-actions?${scriptParams}`),
      api(`/api/metadata-jobs?${jobParams}`),
    ])
    const tagMeta = pageMeta(tagsPayload, tagManagerPage, tagManagerPageSize)
    tagCatalog = pageItems(tagsPayload)
    tagManagerPage = tagMeta.page
    tagManagerPageSize = tagMeta.limit
    tagManagerTotal = tagMeta.total
    tagManagerTotalPages = tagMeta.totalPages

    const scriptMeta = pageMeta(scriptsPayload, tagScriptsPage, tagScriptsPageSize)
    tagScripts = pageItems(scriptsPayload)
    tagScriptsPage = scriptMeta.page
    tagScriptsPageSize = scriptMeta.limit
    tagScriptsTotal = scriptMeta.total
    tagScriptsTotalPages = scriptMeta.totalPages
    renderTagScriptPickers()

    const jobMeta = pageMeta(jobsPayload, tagJobsPage, tagJobsPageSize)
    tagJobs = pageItems(jobsPayload)
    tagJobsPage = jobMeta.page
    tagJobsPageSize = jobMeta.limit
    tagJobsTotal = jobMeta.total
    tagJobsTotalPages = jobMeta.totalPages
    renderTagManager()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.tagManagerRefresh, false)
  }
}

function renderTagManager() {
  renderTagDisplayPriority()

  els.tagManagerTags.innerHTML = ''
  const visibleTags = tagCatalog
  if (els.tagManagerPageInfo) els.tagManagerPageInfo.textContent = `第 ${tagManagerPage} / ${tagManagerTotalPages} 页 · ${tagManagerTotal} 个`
  if (els.tagManagerFirst) els.tagManagerFirst.disabled = tagManagerPage <= 1
  if (els.tagManagerPrev) els.tagManagerPrev.disabled = tagManagerPage <= 1
  if (els.tagManagerNext) els.tagManagerNext.disabled = tagManagerPage >= tagManagerTotalPages
  for (const tag of visibleTags) {
    const card = document.createElement('article')
    card.className = 'card tag-manager-card'
    card.innerHTML = `
      <div class="card-body">
        <div class="card-title" title="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</div>
        <div class="library-card-meta">合集 ${tag.itemCount || 0} · 章节 ${tag.unitCount || 0}</div>
      </div>
    `
    card.addEventListener('click', () => {
      showView('library-view')
      els.libraryTagSearch.value = `tag:${tag.name}`
      loadLibraryItems().catch((error) => alert(error.message))
    })
    els.tagManagerTags.append(card)
  }
  if (!tagCatalog.length) els.tagManagerTags.innerHTML = '<p class="muted">暂无 tag</p>'

  els.tagManagerScripts.innerHTML = ''
  const visibleScripts = tagScripts
  if (els.tagScriptsPageInfo) els.tagScriptsPageInfo.textContent = `第 ${tagScriptsPage} / ${tagScriptsTotalPages} 页 · ${tagScriptsTotal} 个`
  if (els.tagScriptsFirst) els.tagScriptsFirst.disabled = tagScriptsPage <= 1
  if (els.tagScriptsPrev) els.tagScriptsPrev.disabled = tagScriptsPage <= 1
  if (els.tagScriptsNext) els.tagScriptsNext.disabled = tagScriptsPage >= tagScriptsTotalPages
  for (const script of visibleScripts) {
    const configurable = script.actionType !== 'builtin'
    const card = document.createElement('article')
    card.className = `card tag-manager-card${script.error ? ' tag-script-error' : ''}`
    card.innerHTML = `
      <div class="card-body">
        <div class="card-title">${escapeHtml(script.name)}</div>
        <div class="library-card-meta">${escapeHtml(script.id)} · v${escapeHtml(script.version)}</div>
        <div class="library-card-meta">${escapeHtml(script.description || '')}</div>
        <div class="library-card-meta" ${configurable ? '' : 'hidden'}>配置：${escapeHtml(tagScriptConfigSummary(script))}</div>
        <div class="tag-script-config-actions" ${configurable ? '' : 'hidden'}>
          <button class="secondary tag-script-config-toggle" type="button">配置</button>
          <button class="secondary tag-script-config-reset" type="button" ${Object.keys(script.userOptions || {}).length ? '' : 'disabled'}>重置</button>
        </div>
        <div class="tag-script-config-editor" hidden>
          <textarea spellcheck="false">${escapeHtml(JSON.stringify(script.userOptions || {}, null, 2))}</textarea>
          <div class="tag-script-config-actions">
            <button class="tag-script-config-save" type="button">保存</button>
            <button class="secondary tag-script-config-cancel" type="button">取消</button>
          </div>
        </div>
      </div>
    `
    const editor = card.querySelector('.tag-script-config-editor')
    const textarea = card.querySelector('textarea')
    card.querySelector('.tag-script-config-toggle')?.addEventListener('click', () => {
      editor.hidden = !editor.hidden
    })
    card.querySelector('.tag-script-config-cancel')?.addEventListener('click', () => {
      textarea.value = JSON.stringify(script.userOptions || {}, null, 2)
      editor.hidden = true
    })
    card.querySelector('.tag-script-config-save')?.addEventListener('click', async () => {
      await saveTagScriptConfig(script, textarea.value)
    })
    card.querySelector('.tag-script-config-reset')?.addEventListener('click', async () => {
      if (!confirm(`重置 ${script.name} 的用户配置吗？`)) return
      await resetTagScriptConfig(script)
    })
    els.tagManagerScripts.append(card)
  }
  if (!tagScripts.length) els.tagManagerScripts.innerHTML = '<p class="muted">暂无元数据脚本，目录 /data/tag-scripts</p>'

  els.tagManagerJobs.innerHTML = ''
  const visibleJobs = tagJobs
  if (els.tagJobsPageInfo) els.tagJobsPageInfo.textContent = `第 ${tagJobsPage} / ${tagJobsTotalPages} 页 · ${tagJobsTotal} 个`
  if (els.tagJobsFirst) els.tagJobsFirst.disabled = tagJobsPage <= 1
  if (els.tagJobsPrev) els.tagJobsPrev.disabled = tagJobsPage <= 1
  if (els.tagJobsNext) els.tagJobsNext.disabled = tagJobsPage >= tagJobsTotalPages
  for (const job of visibleJobs) {
    const row = document.createElement('div')
    row.className = `job ${job.status}`
    const unitText = Array.isArray(job.unitIds) && job.unitIds.length ? `章节 ${job.unitIds.length}` : '合集全量'
    const resultText = summarizeMetadataJobResults(job)
    row.innerHTML = `
      <strong title="${escapeHtml(job.id || '')}">${escapeHtml(job.status)} · ${escapeHtml(job.type)}/${escapeHtml(job.itemId)}</strong>
      <span class="muted">${escapeHtml(unitText)} · ${escapeHtml((job.actionIds || job.scriptIds || []).join(', ') || '未记录脚本')}</span>
      <small>${escapeHtml([job.message || '', formatShortDate(job.updatedAt || job.createdAt)].filter(Boolean).join(' · '))}</small>
      ${(resultText || job.results?.some((result) => result.hasDetails)) ? `<details class="tag-job-details" data-job-id="${escapeHtml(job.id || '')}"><summary>详情</summary><pre>${escapeHtml(resultText || '加载详情...')}</pre></details>` : ''}
    `
    const details = row.querySelector('.tag-job-details')
    details?.addEventListener('toggle', () => {
      if (!details.open || details.dataset.loaded === '1') return
      loadTagJobDetails(details.dataset.jobId, details.querySelector('pre')).catch((error) => {
        const pre = details.querySelector('pre')
        if (pre) pre.textContent = error.message
      })
    })
    els.tagManagerJobs.append(row)
  }
  if (!tagJobs.length) els.tagManagerJobs.innerHTML = '<p class="muted">暂无元数据任务</p>'
}

async function loadTagJobDetails(jobId, pre) {
  if (!jobId || !pre) return
  pre.textContent = '加载详情...'
  const job = await api(`/api/metadata-jobs/${encodeURIComponent(jobId)}`)
  pre.textContent = summarizeMetadataJobResults(job) || '暂无详情'
  pre.closest('.tag-job-details')?.setAttribute('data-loaded', '1')
}

function summarizeMetadataJobResults(job) {
  const lines = []
  for (const result of job.results || []) {
    const label = [result.actionId || result.scriptId, result.status].filter(Boolean).join(' · ')
    const logs = Array.isArray(result.logs) ? result.logs : []
    const summary = [
      result.message || '',
      logs.length ? `日志:\n${logs.map((line) => `    ${line}`).join('\n')}` : '',
      Number.isFinite(result.itemTagCount) ? `合集 tag ${result.itemTagCount}` : '',
      Number.isFinite(result.unitTagCount) ? `章节 tag ${result.unitTagCount}` : '',
      result.details ? `详情: ${typeof result.details === 'string' ? result.details : JSON.stringify(result.details)}` : '',
      result.error ? `错误: ${result.error}` : '',
    ].filter(Boolean).join(' · ')
    lines.push([label, summary].filter(Boolean).join('\n  '))
  }
  return lines.join('\n')
}

function tagDisplayKeyOf(tag = '') {
  const text = String(tag || '').trim()
  const index = text.indexOf(':')
  if (index >= 0) return `${text.slice(0, index + 1).trim()}`
  const cnIndex = text.indexOf('：')
  if (cnIndex >= 0) return `${text.slice(0, cnIndex + 1).trim()}`
  return text
}

function availableTagDisplayKeys() {
  return [...new Set([
    ...mediaTagDisplayKeys,
    ...tagCatalog.map((tag) => tagDisplayKeyOf(tag.name)).filter(Boolean),
  ])]
}

function renderTagDisplayPriority() {
  if (!els.tagDisplayPriority) return
  const keys = availableTagDisplayKeys()
  if (!keys.length) {
    els.tagDisplayPriority.innerHTML = '<p class="muted">暂无 tag key</p>'
    return
  }
  const selected = new Set(mediaTagDisplayKeys)
  els.tagDisplayPriority.innerHTML = `
    <div class="tag-display-top">
      <div class="tag-display-help">勾选后按这里的顺序优先展示，未选 tag 继续折叠。</div>
      <button class="tag-display-save" type="button">保存展示顺序</button>
    </div>
    <div class="tag-display-list">
      ${keys.map((key, index) => `
        <div class="tag-display-row" data-key="${escapeHtml(key)}">
          <label><input type="checkbox" ${selected.has(key) ? 'checked' : ''} /> <span>${escapeHtml(key)}</span></label>
          <button class="secondary tag-display-top-button" type="button" ${index === 0 ? 'disabled' : ''} title="置顶">⇧</button>
          <button class="secondary tag-display-up" type="button" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="secondary tag-display-down" type="button" ${index === keys.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
      `).join('')}
    </div>
  `
  els.tagDisplayPriority.querySelectorAll('.tag-display-up').forEach((button) => {
    button.addEventListener('click', () => moveTagDisplayRow(button.closest('.tag-display-row'), -1))
  })
  els.tagDisplayPriority.querySelectorAll('.tag-display-top-button').forEach((button) => {
    button.addEventListener('click', () => moveTagDisplayRowToTop(button.closest('.tag-display-row')))
  })
  els.tagDisplayPriority.querySelectorAll('.tag-display-down').forEach((button) => {
    button.addEventListener('click', () => moveTagDisplayRow(button.closest('.tag-display-row'), 1))
  })
  els.tagDisplayPriority.querySelector('.tag-display-save')?.addEventListener('click', saveTagDisplayPriority)
}

function moveTagDisplayRow(row, delta) {
  if (!row) return
  const sibling = delta < 0 ? row.previousElementSibling : row.nextElementSibling
  if (!sibling) return
  if (delta < 0) row.parentElement.insertBefore(row, sibling)
  else row.parentElement.insertBefore(sibling, row)
  syncTagDisplayMoveButtons()
}

function moveTagDisplayRowToTop(row) {
  if (!row?.parentElement || row === row.parentElement.firstElementChild) return
  row.parentElement.insertBefore(row, row.parentElement.firstElementChild)
  syncTagDisplayMoveButtons()
}

function syncTagDisplayMoveButtons() {
  const rows = [...els.tagDisplayPriority.querySelectorAll('.tag-display-row')]
  rows.forEach((row, index) => {
    row.querySelector('.tag-display-top-button').disabled = index === 0
    row.querySelector('.tag-display-up').disabled = index === 0
    row.querySelector('.tag-display-down').disabled = index === rows.length - 1
  })
}

async function saveTagDisplayPriority() {
  const rows = [...els.tagDisplayPriority.querySelectorAll('.tag-display-row')]
  const keys = rows
    .filter((row) => row.querySelector('input')?.checked)
    .map((row) => row.dataset.key)
    .filter(Boolean)
  try {
    await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({ mediaTagDisplayKeys: keys }),
    })
    mediaTagDisplayKeys = keys
    renderTagDisplayPriority()
    renderLibraryItems()
    if (currentLibraryItem) renderLibraryUnits()
  } catch (error) {
    alert(error.message)
  }
}

function tagScriptConfigSummary(script) {
  const userCount = Object.keys(script.userOptions || {}).length
  const defaultCount = Object.keys(script.defaultOptions || {}).length
  if (userCount) return `用户覆盖 ${userCount} 项 / 默认 ${defaultCount} 项`
  if (defaultCount) return `默认 ${defaultCount} 项`
  return '无'
}

async function saveTagScriptConfig(script, raw) {
  let options
  try {
    options = JSON.parse(raw || '{}')
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('配置必须是 JSON object')
  } catch (error) {
    alert(`配置 JSON 无效：${error.message}`)
    return
  }
  try {
    await api(`/api/metadata-actions/${encodeURIComponent(script.id)}/config`, {
      method: 'POST',
      body: JSON.stringify({ options }),
    })
    await loadTagManager({ reloadScripts: true })
  } catch (error) {
    alert(error.message)
  }
}

async function resetTagScriptConfig(script) {
  try {
    await api(`/api/metadata-actions/${encodeURIComponent(script.id)}/config`, { method: 'DELETE' })
    await loadTagManager({ reloadScripts: true })
  } catch (error) {
    alert(error.message)
  }
}

async function uploadTagScriptPackage() {
  const file = els.tagScriptUploadFile.files?.[0]
  if (!file) return alert('请选择 .tar.gz/.tgz/.zip 脚本包')
  const form = new FormData()
  form.append('file', file)
  try {
    setLoading(els.tagScriptUpload, true)
    const result = await apiForm('/api/metadata-actions/upload', form)
    els.tagScriptUploadFile.value = ''
    await loadTagManager({ reloadScripts: true })
    alert(`已安装 ${result.installed?.length || 0} 个脚本`)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.tagScriptUpload, false)
  }
}

async function loadMediaImportItems() {
  try {
    setLoading(els.mediaImportRefresh, true)
    if (!tagScripts.length) await loadTagScripts().catch(() => {})
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
  const profile = mediaImportProfiles[els.mediaImportProfile.value] || mediaImportProfiles.custom
  const selected = els.mediaImportItem.selectedOptions?.[0]
  if (profile.batch) {
    els.mediaImportMeta.textContent = els.mediaImportSourcePath.value.trim()
      ? `RJ 批量导入会递归扫描来源目录，并把每个 RJ/VJ/BJ/EJ 目录导成独立媒体：${els.mediaImportSourcePath.value.trim()}`
      : 'RJ 批量导入会递归扫描来源目录，并把每个 RJ/VJ/BJ/EJ 目录导成独立媒体'
  } else if (els.mediaImportItem.value) {
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
  const profile = mediaImportProfiles[els.mediaImportProfile.value] || mediaImportProfiles.custom
  els.mediaImportFiles.accept = info.accept || ''
  els.mediaImportFilesLabel.firstChild.textContent = `${info.label} 文件`
  els.mediaImportSubmit.textContent = profile.batch ? `批量导入 ${profile.label}` : `导入 ${info.label}`
  els.mediaImportSourcePath.disabled = !info.source
  els.mediaImportSourcePath.placeholder = info.source ? '/input/album 或 /input/movie.mp4' : 'EPUB 暂不支持路径导入'
  if (!info.source) els.mediaImportSourcePath.value = ''
  els.mediaImportItem.disabled = Boolean(profile.batch)
  els.mediaImportTitle.disabled = Boolean(profile.batch)
  if (profile.batch) {
    els.mediaImportItem.value = ''
    els.mediaImportTitle.value = ''
  }
  renderMediaImportProfileConfig()
  updateMediaImportMeta()
}

function applyMediaImportProfile() {
  const profile = mediaImportProfiles[els.mediaImportProfile.value] || mediaImportProfiles.custom
  if (profile.type && [...els.mediaImportType.options].some((option) => option.value === profile.type)) {
    els.mediaImportType.value = profile.type
  }
  if (profile.sourcePlaceholder) els.mediaImportSourcePath.placeholder = profile.sourcePlaceholder
  updateMediaImportControls()
  const defaultScriptIds = new Set(currentMediaImportProfileConfig().defaultMetadataActions || [])
  for (const input of document.querySelectorAll('input[name="media-import-tag-script"]')) {
    const script = tagScripts.find((item) => item.id === input.value)
    // 只认两个明确来源：脚本自己的 defaultEnabled，和方案里列出的 defaultMetadataActions。
    // 原先还有一套 scriptHints 子串模糊匹配，'subtitle' 会连 ai-subtitle-v1 /
    // ai-translate-subtitle-v1 一起勾上——这两个要调外部 ASR/LLM，必须用户自己勾。
    input.checked = Boolean(script?.defaultEnabled || defaultScriptIds.has(input.value))
  }
}

function currentMediaImportProfileConfig() {
  const key = els.mediaImportProfile.value
  return {
    ...(defaultMediaImportProfiles[key] || {}),
    ...((appConfig?.mediaImportProfiles || {})[key] || {}),
  }
}

function renderMediaImportProfileConfig() {
  if (!els.mediaImportProfileConfig) return
  const key = els.mediaImportProfile.value
  const supported = key === 'rj-media'
  els.mediaImportProfileConfig.closest('label').hidden = !supported
  els.mediaImportProfileConfigSave.hidden = !supported
  els.mediaImportProfileConfigReset.hidden = !supported
  if (!supported) {
    els.mediaImportProfileConfig.value = ''
    return
  }
  els.mediaImportProfileConfig.value = JSON.stringify(currentMediaImportProfileConfig(), null, 2)
}

async function saveMediaImportProfileConfig(value) {
  const key = els.mediaImportProfile.value
  if (key !== 'rj-media') return
  const nextProfiles = {
    ...(appConfig?.mediaImportProfiles || {}),
    [key]: value,
  }
  appConfig = await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({ mediaImportProfiles: nextProfiles }),
  })
  renderMediaImportProfileConfig()
}

// 只在成员 >1 时出现。紫色「字」角标表示本项无字幕但系列里有——
// 这是唯一值得单独提示的差异，其余情况卡片上的 字幕v1 tag 已经说明了。
function renderSeriesBadges(item) {
  const series = item.series
  if (!series || series.count < 2) return ''
  const elsewhere = series.hasSubtitle && !series.selfHasSubtitle
  const dotTitle = elsewhere ? `同系列 ${series.count} 个，本项无字幕但系列中有` : `同系列 ${series.count} 个`
  return `
    <button class="library-series-dot${elsewhere ? ' elsewhere' : ''}" type="button" title="${escapeHtml(dotTitle)}">${series.count}</button>
    <button class="library-series-go" type="button" title="快速进入系列中优先级最高的一项">进入</button>
  `
}

function openSeriesModal(item) {
  const series = item.series
  if (!series || !els.seriesModal) return
  els.seriesModalTitle.textContent = `同系列 ${series.count} 个`
  els.seriesModalList.innerHTML = ''
  for (const member of series.members || []) {
    const current = member.itemId === item.itemId
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `series-modal-row${current ? ' current' : ''}`
    row.innerHTML = `
      ${member.cover ? `<img src="${escapeHtml(member.cover)}" alt="" loading="lazy" />` : '<div class="series-modal-nocover"></div>'}
      <div class="series-modal-title" title="${escapeHtml(member.title || member.itemId)}">${escapeHtml(member.title || member.itemId)}</div>
      <span class="series-modal-sub ${member.hasSubtitle ? 'yes' : 'no'}">${member.hasSubtitle ? '字幕 ✓' : '字幕 ✗'}</span>
    `
    if (!current) {
      row.addEventListener('click', () => {
        closeSeriesModal()
        selectLibraryItem(member.type || item.type, member.itemId)
      })
    }
    els.seriesModalList.append(row)
  }
  els.seriesModal.classList.remove('hidden')
}

function closeSeriesModal() {
  els.seriesModal?.classList.add('hidden')
}

function renderLibraryItems() {
  els.libraryItems.innerHTML = ''
  libraryPage = Math.max(1, Math.min(libraryTotalPages, libraryPage))
  if (els.libraryPage && document.activeElement !== els.libraryPage) {
    els.libraryPage.value = String(libraryPage)
  }
  if (els.libraryPage) els.libraryPage.max = String(libraryTotalPages)
  if (els.libraryPageTotal) els.libraryPageTotal.textContent = `/ ${libraryTotalPages} 页 · ${libraryTotalItems} 个`
  if (els.libraryFirst) els.libraryFirst.disabled = libraryPage <= 1
  if (els.libraryPrev) els.libraryPrev.disabled = libraryPage <= 1
  if (els.libraryNext) els.libraryNext.disabled = libraryPage >= libraryTotalPages
  renderLibraryIndexStatus()
  for (const item of libraryItems) {
    const summary = libraryItemSummary(item)
    const history = libraryHistoryByKey.get(libraryKey(item.type, item.itemId))
    const selected = currentLibraryItem?.type === item.type && currentLibraryItem?.itemId === item.itemId
    const displayTitle = libraryDisplayTitle(item)
    const fullTitle = libraryFullTitle(item)
    const card = document.createElement('article')
    card.className = `card library-card${selected ? ' selected' : ''}`
    card.title = fullTitle
    card.innerHTML = `
      <div class="library-card-cover">${renderCover(item.cover, displayTitle)}</div>
      <div class="card-body">
        <div class="library-card-top">
          <div class="card-title" title="${escapeHtml(fullTitle)}">${escapeHtml(displayTitle)}</div>
          <div class="library-card-badges">
            <span class="library-type-pill">${escapeHtml(summary.typeLabel)}</span>
            ${renderSeriesBadges(item)}
          </div>
        </div>
        <div class="library-card-meta" title="${escapeHtml(summary.primary)}">${escapeHtml(summary.primary)}</div>
        <div class="library-card-meta" title="${escapeHtml(summary.secondary)}">${escapeHtml(summary.secondary)}</div>
        ${history ? `<div class="library-card-history">继续：${escapeHtml(history.lastUnitTitle || history.lastUnitId || item.title)}${historyProgressText(history) ? ` · ${escapeHtml(historyProgressText(history))}` : ''}</div>` : ''}
        ${renderTagList(item.tags || [])}
        <button class="library-continue secondary" type="button">${history ? '继续' : '打开'}</button>
      </div>
    `
    card.addEventListener('click', () => selectLibraryItem(item.type, item.itemId))
    card.querySelector('.library-series-dot')?.addEventListener('click', (event) => {
      event.stopPropagation()
      openSeriesModal(item)
    })
    card.querySelector('.library-series-go')?.addEventListener('click', (event) => {
      event.stopPropagation()
      const target = item.series?.primaryItemId
      if (target) selectLibraryItem(item.type, target)
    })
    card.querySelector('.library-continue')?.addEventListener('click', (event) => {
      event.stopPropagation()
      continueLibraryItem(item).catch((error) => alert(error.message))
    })
    els.libraryItems.append(card)
  }
  if (libraryItems.length === 0) {
    els.libraryItems.innerHTML = libraryIndexStatus && libraryIndexStatus.status !== 'ready'
      ? '<p class="muted">媒体缓存未就绪，请点击重建缓存</p>'
      : '<p class="muted">暂无媒体库条目</p>'
  }
  updateLibraryMetadataActionButtons()
}

function renderLibraryIndexStatus() {
  if (!els.libraryIndexStatus) return
  const status = libraryIndexStatus || {}
  const built = status.builtAt ? formatMinuteDate(status.builtAt) : '无'
  const stateText = ({
    ready: status.dirty ? '缓存需更新' : '缓存正常',
    building: '缓存构建中',
    failed: '缓存失败',
    missing: '缓存缺失',
  })[status.status] || '缓存未知'
  els.libraryIndexStatus.textContent = `${stateText} · 上次成功 ${built} · ${status.itemCount || 0} 个`
  els.libraryIndexStatus.title = status.error || ''
}

async function rebuildLibraryIndex() {
  try {
    setLoading(els.libraryIndexRebuild, true)
    libraryIndexStatus = await api('/api/library/index/rebuild', { method: 'POST', body: '{}' })
    renderLibraryIndexStatus()
    const startedAt = Date.now()
    while (Date.now() - startedAt < 120000) {
      await sleep(1500)
      libraryIndexStatus = await api('/api/library/index/status')
      renderLibraryIndexStatus()
      if (libraryIndexStatus.status !== 'building') break
    }
    libraryPage = 1
    await loadLibraryItems()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.libraryIndexRebuild, false)
  }
}

function jumpLibraryPage() {
  libraryPage = Math.max(1, Math.min(libraryTotalPages, Math.floor(Number(els.libraryPage?.value || 1))))
  loadLibraryItems().catch((error) => alert(error.message))
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
    syncLibraryItemInList(item)
    els.libraryItemTitle.textContent = item.title
    els.libraryItemMeta.textContent = libraryDetailMeta(item, units)
    els.libraryItemTags.value = (item.tags || []).join(', ')
    els.librarySaveTags.disabled = false
    els.librarySubtitles.disabled = item.type !== 'media'
    els.libraryThumbnails.disabled = item.type !== 'media'
    if (!tagScripts.length) await loadTagScripts().catch(() => {})
    updateLibraryMetadataActionButtons()
    renderLibraryItems()
    renderLibraryUnits()
  } catch (error) {
    els.libraryItemMeta.textContent = `读取失败：${error.message}`
    els.libraryUnits.className = 'chapters empty-panel'
    els.libraryUnits.textContent = error.message
  }
}

function syncLibraryItemInList(item) {
  if (!item?.type || !item?.itemId) return
  const index = libraryItems.findIndex((candidate) => candidate.type === item.type && candidate.itemId === item.itemId)
  if (index >= 0) libraryItems[index] = { ...libraryItems[index], ...item }
  else libraryItems.unshift(item)
}

function renderLibraryUnits() {
  els.libraryUnits.classList.remove('empty-panel')
  els.libraryUnits.innerHTML = ''
  const readUnits = currentLibraryProgress?.readUnits || {}
  const detail = document.createElement('div')
  detail.className = 'library-detail-card'
  detail.innerHTML = renderLibraryDetailSummary(currentLibraryItem, currentLibraryUnits, readUnits)
  els.libraryUnits.append(detail)
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
    row.className = `chapter library-unit${isRead ? ' read-chapter' : ' unread-chapter'}${unit.mediaKind === 'subtitle' ? ' subtitle-unit' : ''}`
    row.title = [unit.title, unit.relativePath, unit.managedPath].filter(Boolean).join('\n')
    const subtitleText = unit.subtitles?.length
      ? ` · 字幕 ${unit.subtitles.length}: ${unit.subtitles.map((subtitle) => subtitle.title || subtitle.relativePath).join(', ')}`
      : ''
    const thumbnailBadge = renderThumbnailBadge(unit.thumbnail)
    const unitMeta = unit.type === 'epub'
      ? `${unit.chapterCount || 0} 个内部章节${unit.imageCount ? ` · ${unit.imageCount} 张图片` : ''}`
      : unit.mediaKind === 'subtitle'
        ? `未匹配字幕 · ${unit.fileName || unit.unitId}${unit.size ? ` · ${formatBytes(unit.size)}` : ''}`
        : `${unit.mediaKind || unit.type || ''} · ${unit.fileName || unit.unitId}${unit.size ? ` · ${formatBytes(unit.size)}` : ''}${subtitleText}`
    const statusBadges = [
      isRead ? '已读' : '未读',
      unit.subtitles?.length ? `字幕${unit.subtitles.length}` : '',
      unit.imageCount ? `${unit.imageCount}图` : '',
    ].filter(Boolean)
    row.innerHTML = `
      <input class="unit-metadata-select" type="checkbox" value="${escapeHtml(unit.unitId)}" ${unit.mediaKind === 'audio' || unit.mediaKind === 'video' ? '' : 'disabled'} aria-label="选择章节" />
      ${renderUnitThumb(unit.thumbnail?.coverUrl || unit.cover || currentLibraryItem?.cover, unit.title)}
      <span class="chapter-copy">
        <span class="chapter-title" title="${escapeHtml(row.title)}">${escapeHtml(unit.title)}</span>
        <span class="library-unit-path" title="${escapeHtml(unitMeta)}">${escapeHtml(unitMeta)}</span>
        ${renderTagList(unit.tags || [])}${thumbnailBadge}
      </span>
      <span class="library-unit-status">${statusBadges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</span>
      <button class="unit-tags secondary" type="button">标签</button>
    `
    const thumb = row.querySelector('.unit-thumb')
    if (thumb && unit.thumbnail?.previewUrl) {
      thumb.addEventListener('mouseenter', () => { thumb.src = unit.thumbnail.previewUrl })
      thumb.addEventListener('mouseleave', () => { thumb.src = unit.thumbnail.coverUrl })
    }
    row.addEventListener('click', (event) => {
      if (event.target.closest('button,input')) return
      if (unit.mediaKind === 'subtitle') return
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

function libraryItemSummary(item) {
  const units = Array.isArray(item.mediaUnits) ? item.mediaUnits : []
  const counts = libraryUnitCounts(units)
  const typeLabel = mediaImportTypeInfo[item.type]?.label || item.type || '媒体'
  const primary = [
    `${item.unitCount || units.length || 0} 个目录项`,
    counts.video ? `视频 ${counts.video}` : '',
    counts.audio ? `音频 ${counts.audio}` : '',
    counts.imageGallery ? `图片 ${counts.imageGallery}` : '',
    counts.epub ? `EPUB ${counts.epub}` : '',
  ].filter(Boolean).join(' · ')
  const secondary = [
    (item.author || []).join(', ') || '',
    item.updatedAt ? `更新 ${formatShortDate(item.updatedAt)}` : '',
    item.itemId || '',
    item.path || item.relativePath || '',
  ].filter(Boolean).join(' · ') || '未记录作者'
  return { typeLabel, primary, secondary }
}

function libraryDisplayTitle(item = {}) {
  return item.dlsite?.title || item.extractedTitle || item.title || item.itemId || '媒体'
}

function libraryFullTitle(item = {}) {
  const displayTitle = libraryDisplayTitle(item)
  return [
    displayTitle,
    item.title && item.title !== displayTitle ? item.title : '',
    item.itemId || '',
    item.path || item.relativePath || '',
    item.dlsite?.circle ? `社团: ${item.dlsite.circle}` : '',
  ].filter(Boolean).join('\n')
}

function libraryDetailMeta(item, units) {
  const counts = libraryUnitCounts(units)
  const parts = [
    mediaImportTypeInfo[item.type]?.label || item.type,
    `${units.length} 个目录项`,
    counts.video ? `视频 ${counts.video}` : '',
    counts.audio ? `音频 ${counts.audio}` : '',
    counts.imageGallery ? `图片 ${counts.imageGallery}` : '',
    counts.epub ? `EPUB ${counts.epub}` : '',
    counts.subtitle ? `未匹配字幕 ${counts.subtitle}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function renderLibraryDetailSummary(item, units, readUnits = {}) {
  const counts = libraryUnitCounts(units)
  const readCount = units.filter((unit) => readUnits[unit.unitId]?.enteredAt).length
  const playableCount = units.filter((unit) => unit.mediaKind !== 'subtitle').length
  const history = libraryHistoryByKey.get(libraryKey(item?.type, item?.itemId))
  const displayTitle = libraryDisplayTitle(item)
  const fullTitle = libraryFullTitle(item)
  const stats = [
    ['目录项', units.length],
    ['已进入', `${readCount}/${playableCount || units.length || 0}`],
    ['视频', counts.video],
    ['音频', counts.audio],
    ['图片集', counts.imageGallery],
    ['EPUB', counts.epub],
    ['未匹配字幕', counts.subtitle],
  ]
  return `
    <div class="library-detail-cover">${renderCover(item?.cover, displayTitle)}</div>
    <div class="library-detail-main">
      <div class="library-detail-title" title="${escapeHtml(fullTitle)}">${escapeHtml(displayTitle)}</div>
      <div class="library-detail-subtitle" title="${escapeHtml(fullTitle)}">${escapeHtml([item?.itemId, item?.title && item.title !== displayTitle ? item.title : '', item?.updatedAt ? `更新 ${formatShortDate(item.updatedAt)}` : ''].filter(Boolean).join(' · '))}</div>
      ${history ? `<div class="library-detail-history">最近：${escapeHtml(history.lastUnitTitle || history.lastUnitId)}${historyProgressText(history) ? ` · ${escapeHtml(historyProgressText(history))}` : ''} · ${escapeHtml(formatShortDate(history.updatedAt))}</div>` : ''}
      ${renderTagList(item?.tags || [])}
      <div class="library-detail-stats">
        ${stats.map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>`).join('')}
      </div>
    </div>
  `
}

function libraryUnitCounts(units = []) {
  return units.reduce((counts, unit) => {
    const kind = unit.mediaKind || unit.type || 'unknown'
    if (kind === 'video') counts.video += 1
    else if (kind === 'audio') counts.audio += 1
    else if (kind === 'image-gallery') counts.imageGallery += 1
    else if (kind === 'subtitle') counts.subtitle += 1
    else if (kind === 'epub' || unit.type === 'epub') counts.epub += 1
    else counts.other += 1
    return counts
  }, { video: 0, audio: 0, imageGallery: 0, subtitle: 0, epub: 0, other: 0 })
}

function mediaKindLabel(kind) {
  const labels = {
    audio: '音频',
    video: '视频',
    'image-gallery': '图片',
    epub: 'EPUB',
    subtitle: '字幕',
  }
  return labels[kind] || kind
}

function libraryKey(type, itemId) {
  return `${type || ''}\u001f${itemId || ''}`
}

function setLibraryHistory(histories = []) {
  libraryHistory = Array.isArray(histories) ? histories : []
  libraryHistoryByKey = new Map(libraryHistory.map((history) => [libraryKey(history.type, history.itemId), history]))
}

function historyProgressText(history) {
  const position = history?.position || {}
  if (position.duration > 0 && position.seconds > 0) {
    return `${formatMediaTime(position.seconds)} / ${formatMediaTime(position.duration)}`
  }
  if (position.ratio > 0) return `${Math.round(position.ratio * 100)}%`
  return ''
}

async function continueLibraryItem(itemOrHistory) {
  const type = itemOrHistory.type
  const itemId = itemOrHistory.itemId
  let history = libraryHistoryByKey.get(libraryKey(type, itemId))
  if (!history) {
    history = await api(`/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}/history`)
    if (history) {
      libraryHistoryByKey.set(libraryKey(type, itemId), history)
    }
  }
  await selectLibraryItem(type, itemId)
  const targetUnitId = history?.lastUnitId || currentLibraryUnits.find((unit) => unit.mediaKind !== 'subtitle')?.unitId
  if (!targetUnitId) return
  await openMediaUnit(targetUnitId, history?.lastSectionId || '', { position: history?.position || null })
}

async function loadLibraryHistory() {
  try {
    setLoading(els.historyRefresh, true)
    const params = new URLSearchParams({
      type: els.historyType.value || 'all',
      limit: '200',
      keyword: els.historyKeyword.value.trim(),
    })
    setLibraryHistory(await api(`/api/library/history?${params}`))
    renderLibraryHistory()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.historyRefresh, false)
  }
}

function renderLibraryHistory() {
  els.historyList.classList.remove('empty-panel')
  els.historyList.innerHTML = ''
  for (const history of libraryHistory) {
    const card = document.createElement('article')
    card.className = 'card history-card'
    card.innerHTML = `
      ${renderCover(history.cover, history.title)}
      <div class="card-body">
        <div class="card-title">${escapeHtml(history.title)}</div>
        <div class="library-card-meta">${escapeHtml([mediaImportTypeInfo[history.type]?.label || history.type, history.itemId].filter(Boolean).join(' · '))}</div>
        <div class="history-last">${escapeHtml(history.lastUnitTitle || history.lastUnitId || '未记录章节')}${historyProgressText(history) ? ` · ${escapeHtml(historyProgressText(history))}` : ''}</div>
        <div class="library-card-meta">${escapeHtml(formatShortDate(history.updatedAt))} · 访问 ${history.visits || 0} 次</div>
        ${renderTagList(history.tags || [])}
        <div class="history-actions">
          <button class="history-continue" type="button">继续</button>
          <button class="history-open secondary" type="button">打开合集</button>
          <button class="history-delete danger" type="button">删除</button>
        </div>
      </div>
    `
    card.querySelector('.history-continue')?.addEventListener('click', () => continueLibraryItem(history).catch((error) => alert(error.message)))
    card.querySelector('.history-open')?.addEventListener('click', async () => {
      showView('library-view')
      await loadLibraryTypes()
      await loadLibraryItems()
      await selectLibraryItem(history.type, history.itemId)
    })
    card.querySelector('.history-delete')?.addEventListener('click', async () => {
      await api(`/api/library/items/${encodeURIComponent(history.type)}/${encodeURIComponent(history.itemId)}/history`, { method: 'DELETE' })
      await loadLibraryHistory()
    })
    els.historyList.append(card)
  }
  if (!libraryHistory.length) {
    els.historyList.className = 'cards history-list empty-panel'
    els.historyList.textContent = '暂无浏览历史'
  }
}

// 阅读会话归属哪个合集，由会话自己说了算，不能读媒体库页的当前选中项——
// 否则「A 后台播着、媒体库页点开了 B」时，A 的进度和历史会写到 B 头上。
function readerOwner(reader = currentMediaReader) {
  return reader?.item?.itemId ? reader.item : currentLibraryItem
}

function isLibraryPageOwner(owner) {
  return Boolean(owner && currentLibraryItem
    && owner.type === currentLibraryItem.type && owner.itemId === currentLibraryItem.itemId)
}

async function recordCurrentLibraryHistory({ flush = false, visit = false, position = null, reader = currentMediaReader } = {}) {
  const owner = readerOwner(reader)
  if (!owner || !reader?.unit) return null
  const unit = reader.unit
  const body = {
    title: owner.title,
    cover: owner.cover || unit.thumbnail?.coverUrl || unit.cover || '',
    tags: owner.tags || [],
    lastUnitId: unit.unitId,
    lastUnitTitle: unit.title || unit.fileName || unit.unitId,
    lastSectionId: reader.section?.sectionId || '',
    lastSectionTitle: reader.section?.title || '',
    position: position || historyPositionForReader(reader),
    visit,
    flush,
  }
  const action = flush ? 'history-flush' : 'history'
  const record = await api(`/api/library/items/${encodeURIComponent(owner.type)}/${encodeURIComponent(owner.itemId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  libraryHistoryByKey.set(libraryKey(record.type, record.itemId), record)
  return record
}

function historyPositionForReader(reader = currentMediaReader) {
  if (reader?.type === 'audio' || reader?.type === 'video') {
    const player = document.querySelector('.stream-player audio, .stream-player video')
    const seconds = Number(player?.currentTime || 0)
    const duration = Number(player?.duration || 0)
    return {
      kind: 'time',
      seconds,
      duration: Number.isFinite(duration) ? duration : 0,
      ratio: duration > 0 ? Math.max(0, Math.min(1, seconds / duration)) : 0,
    }
  }
  return {
    kind: reader?.type || '',
    seconds: 0,
    duration: 0,
    ratio: mediaScrollRatio(),
  }
}

function renderTagList(tags = []) {
  if (!tags.length) return ''
  const prioritized = orderedDisplayTags(tags)
  const visibleCount = Math.min(Math.max(4, prioritized.priorityCount || 0), prioritized.tags.length)
  const hiddenCount = Math.max(0, prioritized.tags.length - visibleCount)
  return `<span class="tag-list${hiddenCount ? ' tag-list-collapsed' : ''}" data-collapsed="1">${prioritized.tags.map((tag, index) => `<span class="tag-pill${index >= visibleCount ? ' tag-pill-extra' : ''}" data-tag="${escapeHtml(tag)}" title="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join('')}${hiddenCount ? `<button class="tag-toggle secondary" type="button" data-more="${hiddenCount}">+${hiddenCount}</button>` : ''}</span>`
}

function orderedDisplayTags(tags = []) {
  const source = [...tags]
  const picked = []
  const used = new Set()
  for (const key of mediaTagDisplayKeys) {
    for (const [index, tag] of source.entries()) {
      if (used.has(index)) continue
      if (tagDisplayKeyOf(tag) !== key) continue
      picked.push(tag)
      used.add(index)
    }
  }
  const rest = source.filter((_, index) => !used.has(index))
  return {
    tags: [...picked, ...rest],
    priorityCount: picked.length,
  }
}

function renderThumbnailBadge(thumbnail) {
  const status = thumbnail?.status || ''
  if (status === 'ready') return '<span class="tag-list"><span class="tag-pill thumbnail-ready">缩略图OK</span></span>'
  if (status === 'queued' || status === 'running') return '<span class="tag-list"><span class="tag-pill thumbnail-running">缩略图生成中</span></span>'
  if (status === 'failed') return '<span class="tag-list"><span class="tag-pill thumbnail-failed">缩略图失败</span></span>'
  return ''
}

async function regenerateUnitThumbnail(unit) {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId || !unit?.unitId) return
  try {
    await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/units/${encodeURIComponent(unit.unitId)}/thumbnail`, {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    })
    await selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId)
    setTimeout(() => selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId).catch(() => {}), 2500)
  } catch (error) {
    alert(error.message)
  }
}

async function regenerateLibraryThumbnails() {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId) return
  try {
    setLoading(els.libraryThumbnails, true)
    const result = await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/thumbnails`, {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    })
    await selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId)
    setTimeout(() => selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId).catch(() => {}), 3500)
    if (result.externalCover?.status && !['completed', 'skipped'].includes(result.externalCover.status)) {
      alert(`DL 封面刷新失败：${result.externalCover.message || result.externalCover.status}`)
    }
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.libraryThumbnails, false)
  }
}

async function rescanUnitSubtitles(unit) {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId || !unit?.unitId) return
  try {
    await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/units/${encodeURIComponent(unit.unitId)}/subtitles`, {
      method: 'POST',
      body: '{}',
    })
    await selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId)
  } catch (error) {
    alert(error.message)
  }
}

async function rescanLibrarySubtitles() {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId) return
  try {
    setLoading(els.librarySubtitles, true)
    await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/subtitles`, {
      method: 'POST',
      body: '{}',
    })
    await selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.librarySubtitles, false)
  }
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

// options.owner      显式指定这次打开属于哪个合集（后台续播必须传，否则会跟着媒体库页的选中项跑偏）
// options.background 后台续播：不抢视图、不动媒体库页的状态
async function openMediaUnit(unitId, sectionId = '', options = {}) {
  const owner = options.owner?.itemId ? options.owner : currentLibraryItem
  if (!owner?.type || !owner?.itemId || !unitId) return
  const background = options.background === true
  if (!background) {
    const activeView = els.views.find((view) => view.classList.contains('active'))?.id
    if (activeView && activeView !== 'media-viewer-view') mediaReturnView = activeView
    showView('media-viewer-view')
  }
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
    setMediaViewerMode('empty')
    els.mediaReaderTitle.textContent = unitId
    els.mediaReaderMeta.textContent = '加载中...'
    els.mediaReaderContent.className = 'media-reader-content empty-panel'
    els.mediaReaderContent.textContent = '加载中...'
    const params = new URLSearchParams()
    if (sectionId) params.set('sectionId', sectionId)
    const suffix = params.toString() ? `?${params}` : ''
    const reader = await api(`/api/library/items/${encodeURIComponent(owner.type)}/${encodeURIComponent(owner.itemId)}/reader/${encodeURIComponent(unitId)}${suffix}`)
    currentMediaReader = reader
    els.mediaReaderTitle.textContent = reader.section?.title || reader.unit?.title || unitId
    els.mediaReaderPrev.disabled = !reader.navigation?.prev
    els.mediaReaderNext.disabled = !reader.navigation?.next
    renderMediaSectionSelect(reader)
    renderMediaReader(reader, options)
    const resumeRatio = isLibraryPageOwner(owner) && reader.section?.sectionId === currentLibraryProgress?.lastSectionId
      ? currentLibraryProgress.lastScrollRatio
      : 0
    await saveLibraryProgress(resumeRatio, reader)
    await recordCurrentLibraryHistory({ visit: true, reader, position: options.position || historyPositionForReader(reader) }).catch(() => {})
    if (isLibraryPageOwner(owner)) {
      currentLibraryProgress = await api(`/api/library/items/${encodeURIComponent(owner.type)}/${encodeURIComponent(owner.itemId)}/progress`)
      renderLibraryUnits()
    }
  } catch (error) {
    els.mediaReaderMeta.textContent = `加载失败：${error.message}`
    setMediaViewerMode('empty')
    els.mediaReaderContent.className = 'media-reader-content empty-panel'
    els.mediaReaderContent.textContent = error.message
  }
}

function renderMediaReader(reader, options = {}) {
  syncMediaReaderThemeControl(reader.type)
  applyMediaReaderTheme()
  setMediaViewerMode(reader.type)
  if (!(reader.type === 'audio' || reader.type === 'video') && currentStreamCleanup) {
    currentStreamCleanup()
    currentStreamCleanup = null
  }
  const index = Number(reader.unit?.index || 0)
  const sectionText = reader.section ? ` · ${reader.section.index + 1}/${reader.sections?.length || 1}` : ''
  const typeLabel = mediaReaderTypeLabel(reader)
  els.mediaReaderMeta.textContent = `${reader.item?.title || currentLibraryItem?.title || ''} · ${index + 1}/${currentLibraryUnits.length}${sectionText} · ${typeLabel}`
  if (reader.type === 'html') {
    renderMediaHtml(reader)
  } else if (reader.type === 'images') {
    renderMediaImages(reader)
  } else if (reader.type === 'audio' || reader.type === 'video') {
    renderStreamMedia(reader, options)
  } else {
    els.mediaReaderContent.className = 'media-reader-content empty-panel'
    els.mediaReaderContent.textContent = `暂不支持的阅读内容类型：${reader.type}`
    updateMediaPageControls()
  }
}

function syncMediaReaderThemeControl(type) {
  if (!els.mediaReaderTheme) return
  if (type === 'audio' || type === 'video') {
    els.mediaReaderTheme.value = 'dark'
    els.mediaReaderTheme.disabled = true
    els.mediaReaderTheme.title = '音视频播放器使用固定深色主题'
    return
  }
  els.mediaReaderTheme.disabled = false
  els.mediaReaderTheme.title = '阅读主题'
  els.mediaReaderTheme.value = localStorage.getItem('copymanga.mediaReaderTheme') || 'light'
}

function setMediaViewerMode(type) {
  els.mediaViewerView.classList.remove(...mediaModeClasses)
  const mode = type === 'html'
    ? 'html'
    : type === 'images'
      ? 'images'
      : type === 'audio' || type === 'video'
        ? type
        : 'empty'
  els.mediaViewerView.classList.add(`media-mode-${mode}`)
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

function loadSubtitleOverlaySettings() {
  try {
    const value = JSON.parse(localStorage.getItem(MEDIA_SUBTITLE_SETTINGS_KEY) || '{}')
    return normalizeSubtitleOverlaySettings(value)
  } catch {
    return normalizeSubtitleOverlaySettings({})
  }
}

function saveSubtitleOverlaySettings(settings) {
  localStorage.setItem(MEDIA_SUBTITLE_SETTINGS_KEY, JSON.stringify(normalizeSubtitleOverlaySettings(settings)))
}

function normalizeSubtitleOverlaySettings(value = {}) {
  const scale = Math.max(0.6, Math.min(3, Number(value.scale || 1)))
  const x = Number(value.x)
  const y = Number(value.y)
  return {
    scale,
    x: Number.isFinite(x) ? Math.max(4, Math.min(96, x)) : null,
    y: Number.isFinite(y) ? Math.max(4, Math.min(96, y)) : null,
  }
}

function applySubtitleOverlaySettings(overlay, settings = loadSubtitleOverlaySettings()) {
  const next = normalizeSubtitleOverlaySettings(settings)
  overlay.style.setProperty('--subtitle-scale', String(next.scale))
  if (next.x !== null && next.y !== null) {
    overlay.style.left = `${next.x}%`
    overlay.style.top = `${next.y}%`
    overlay.style.right = 'auto'
    overlay.style.bottom = 'auto'
    overlay.style.transform = 'translate(-50%, -50%)'
  }
  return next
}

function adjustSubtitleOverlayScale(delta, overlays = []) {
  const current = loadSubtitleOverlaySettings()
  const next = normalizeSubtitleOverlaySettings({ ...current, scale: current.scale + delta })
  saveSubtitleOverlaySettings(next)
  for (const overlay of overlays.filter(Boolean)) applySubtitleOverlaySettings(overlay, next)
}

function makeSubtitleOverlayInteractive(overlay, frame) {
  let settings = applySubtitleOverlaySettings(overlay)
  let dragging = false
  let pointerId = null
  const moveTo = (clientX, clientY) => {
    const rect = frame.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    settings = normalizeSubtitleOverlaySettings({
      ...settings,
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    })
    applySubtitleOverlaySettings(overlay, settings)
  }
  overlay.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return
    dragging = true
    pointerId = event.pointerId
    overlay.setPointerCapture?.(event.pointerId)
    moveTo(event.clientX, event.clientY)
    event.preventDefault()
    event.stopPropagation()
  })
  overlay.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return
    moveTo(event.clientX, event.clientY)
    event.preventDefault()
  })
  const finishDrag = (event) => {
    if (!dragging || event.pointerId !== pointerId) return
    dragging = false
    pointerId = null
    overlay.releasePointerCapture?.(event.pointerId)
    saveSubtitleOverlaySettings(settings)
    event.preventDefault()
  }
  overlay.addEventListener('pointerup', finishDrag)
  overlay.addEventListener('pointercancel', finishDrag)
  overlay.addEventListener('wheel', (event) => {
    event.preventDefault()
    settings = normalizeSubtitleOverlaySettings({ ...settings, scale: settings.scale + (event.deltaY < 0 ? 0.08 : -0.08) })
    saveSubtitleOverlaySettings(settings)
    applySubtitleOverlaySettings(overlay, settings)
  }, { passive: false })
}

function renderStreamMedia(reader, options = {}) {
  if (currentStreamCleanup) {
    currentStreamCleanup()
    currentStreamCleanup = null
  }
  const themeClass = applyMediaReaderTheme()
  els.mediaReaderContent.className = `media-reader-content media-stream ${themeClass}`
  const shell = document.createElement('div')
  shell.className = `stream-player stream-player-${reader.type}`
  const frame = document.createElement('div')
  frame.className = `stream-frame stream-frame-${reader.type}`
  const player = document.createElement(reader.type)
  player.controls = false
  player.autoplay = true
  player.preload = 'metadata'
  if (reader.type === 'video') player.crossOrigin = 'anonymous'
  player.src = reader.stream?.url || reader.unit?.streamUrl || ''
  if (reader.type === 'video') player.playsInline = true
  if (reader.type === 'audio') {
    const art = document.createElement('div')
    art.className = 'stream-audio-art'
    const thumb = reader.unit?.thumbnail?.coverUrl || reader.unit?.thumbnail?.previewUrl || ''
    if (thumb) {
      const img = document.createElement('img')
      img.src = thumb
      img.alt = ''
      img.loading = 'lazy'
      art.append(img)
    } else {
      art.textContent = 'Audio'
    }
    frame.append(art)
  }
  const playbackWarning = document.createElement('div')
  playbackWarning.className = 'stream-player-warning hidden'
  const canPlay = player.canPlayType?.(reader.unit?.contentType || '') || ''
  if (reader.unit?.contentType && !canPlay) {
    playbackWarning.classList.remove('hidden')
    playbackWarning.textContent = `当前浏览器可能不支持播放 ${reader.unit.contentType}`
  }
  const subtitleSelect = document.createElement('select')
  subtitleSelect.className = 'stream-subtitle-select'
  subtitleSelect.title = '字幕'
  const secondarySubtitleSelect = document.createElement('select')
  secondarySubtitleSelect.className = 'stream-subtitle-select stream-subtitle-select-secondary'
  secondarySubtitleSelect.title = '副字幕'
  const subtitlePathTitle = (subtitle) => subtitle?.relativePath || subtitle?.url || ''
  const noneOption = document.createElement('option')
  noneOption.value = ''
  noneOption.textContent = '无字幕'
  noneOption.title = '无字幕'
  subtitleSelect.append(noneOption)
  const secondaryNoneOption = noneOption.cloneNode(true)
  secondaryNoneOption.textContent = '无副字幕'
  secondarySubtitleSelect.append(secondaryNoneOption)
  for (const [index, subtitle] of (reader.unit?.subtitles || []).entries()) {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = subtitle.title || subtitle.relativePath || `字幕 ${index + 1}`
    option.title = subtitlePathTitle(subtitle)
    option.dataset.path = subtitlePathTitle(subtitle)
    subtitleSelect.append(option)
    secondarySubtitleSelect.append(option.cloneNode(true))
    const track = document.createElement('track')
    track.kind = 'subtitles'
    track.label = option.textContent
    track.srclang = subtitle.language || 'zh'
    track.src = subtitle.url
    player.append(track)
  }
  const subtitleOverlay = document.createElement('div')
  subtitleOverlay.className = 'stream-subtitle-overlay hidden'
  makeSubtitleOverlayInteractive(subtitleOverlay, frame)
  const selectedSubtitleIndexes = () => {
    const values = [subtitleSelect.value, secondarySubtitleSelect.value]
      .filter((value) => value !== '')
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0)
    return [...new Set(values)]
  }
  const renderStreamSubtitles = () => {
    const rows = selectedSubtitleIndexes()
      .map((index) => {
        const track = player.textTracks?.[index]
        return track ? [...(track.activeCues || [])].map((cue) => cue.text).filter(Boolean).join('\n') : ''
      })
      .filter(Boolean)
    subtitleOverlay.replaceChildren(...rows.map((text, index) => {
      const row = document.createElement('div')
      row.className = `stream-subtitle-line stream-subtitle-line-${index}`
      row.textContent = text
      return row
    }))
    subtitleOverlay.classList.toggle('hidden', !rows.length)
  }
  subtitleSelect.disabled = !reader.unit?.subtitles?.length
  secondarySubtitleSelect.disabled = !reader.unit?.subtitles?.length
  const applySubtitleSelection = () => {
    const selectedIndexes = selectedSubtitleIndexes()
    const selectedIndex = selectedIndexes[0] ?? -1
    const secondaryIndex = selectedIndexes[1] ?? -1
    const selectedSubtitle = selectedIndex >= 0 ? reader.unit?.subtitles?.[selectedIndex] : null
    const secondarySubtitle = secondaryIndex >= 0 ? reader.unit?.subtitles?.[secondaryIndex] : null
    subtitleSelect.title = selectedSubtitle ? subtitlePathTitle(selectedSubtitle) || '字幕' : '无字幕'
    secondarySubtitleSelect.title = secondarySubtitle ? subtitlePathTitle(secondarySubtitle) || '副字幕' : '无副字幕'
    for (const [index, track] of [...player.textTracks].entries()) {
      track.mode = selectedIndexes.includes(index) ? 'hidden' : 'disabled'
      track.oncuechange = renderStreamSubtitles
    }
    renderStreamSubtitles()
    setTimeout(renderStreamSubtitles, 250)
  }
  subtitleSelect.addEventListener('change', applySubtitleSelection)
  secondarySubtitleSelect.addEventListener('change', applySubtitleSelection)
  if (reader.unit?.subtitles?.length) {
    subtitleSelect.value = '0'
    secondarySubtitleSelect.value = String(defaultSecondarySubtitleIndex(reader.unit.subtitles, 0))
    setTimeout(applySubtitleSelection, 0)
  }
  const rateSelect = document.createElement('select')
  rateSelect.className = 'stream-rate-select'
  rateSelect.title = '倍速'
  const savedRate = normalizePlaybackRate(localStorage.getItem('copymanga.mediaPlaybackRate') || '1')
  for (const rate of mediaPlaybackRates) {
    const option = document.createElement('option')
    option.value = String(rate)
    option.textContent = `${rate}x`
    rateSelect.append(option)
  }
  rateSelect.value = String(savedRate)
  player.playbackRate = savedRate
  player.defaultPlaybackRate = savedRate
  rateSelect.addEventListener('change', () => {
    const rate = normalizePlaybackRate(rateSelect.value)
    player.playbackRate = rate
    player.defaultPlaybackRate = rate
    localStorage.setItem('copymanga.mediaPlaybackRate', String(rate))
  })
  const subtitleSmaller = document.createElement('button')
  subtitleSmaller.type = 'button'
  subtitleSmaller.className = 'stream-icon-button stream-subtitle-size'
  subtitleSmaller.title = '缩小字幕'
  subtitleSmaller.textContent = '字-'
  const subtitleLarger = document.createElement('button')
  subtitleLarger.type = 'button'
  subtitleLarger.className = 'stream-icon-button stream-subtitle-size'
  subtitleLarger.title = '放大字幕'
  subtitleLarger.textContent = '字+'
  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'stream-icon-button stream-play'
  play.title = '播放/暂停'
  play.textContent = '▶'
  const mute = document.createElement('button')
  mute.type = 'button'
  mute.className = 'stream-icon-button stream-mute'
  mute.title = '静音'
  mute.textContent = '音'
  const fullscreen = document.createElement('button')
  fullscreen.type = 'button'
  fullscreen.className = 'stream-icon-button stream-fullscreen'
  fullscreen.title = '页面全屏'
  fullscreen.textContent = '⛶'
  const vrControls = createVrControls(reader.type === 'video')
  const loopToggle = document.createElement('button')
  loopToggle.type = 'button'
  loopToggle.className = 'stream-toggle'
  loopToggle.title = '结束后自动重播'
  loopToggle.textContent = '重播'
  const nextToggle = document.createElement('button')
  nextToggle.type = 'button'
  nextToggle.className = 'stream-toggle'
  nextToggle.title = '结束后自动下一章'
  nextToggle.textContent = '连播'
  const currentTime = document.createElement('span')
  currentTime.className = 'stream-time'
  currentTime.textContent = '00:00'
  const duration = document.createElement('span')
  duration.className = 'stream-time'
  duration.textContent = '--:--'
  const progress = document.createElement('input')
  progress.type = 'range'
  progress.className = 'stream-progress'
  progress.min = '0'
  progress.max = '1000'
  progress.step = '1'
  progress.value = '0'
  progress.title = '播放进度'
  const volume = document.createElement('input')
  volume.type = 'range'
  volume.className = 'stream-volume'
  volume.min = '0'
  volume.max = '1'
  volume.step = '0.01'
  volume.value = localStorage.getItem('copymanga.mediaVolume') || '1'
  player.volume = Math.max(0, Math.min(1, Number(volume.value) || 1))
  const setToggleState = () => {
    const loopEnabled = localStorage.getItem('copymanga.mediaAutoReplay') === '1'
    const nextEnabled = localStorage.getItem('copymanga.mediaAutoNext') === '1'
    loopToggle.classList.toggle('active', loopEnabled)
    loopToggle.setAttribute('aria-pressed', loopEnabled ? 'true' : 'false')
    nextToggle.classList.toggle('active', nextEnabled)
    nextToggle.setAttribute('aria-pressed', nextEnabled ? 'true' : 'false')
  }
  const setProgress = () => {
    currentTime.textContent = formatMediaTime(player.currentTime)
    duration.textContent = Number.isFinite(player.duration) ? formatMediaTime(player.duration) : '--:--'
    if (Number.isFinite(player.duration) && player.duration > 0 && document.activeElement !== progress) {
      progress.value = String(Math.round((player.currentTime / player.duration) * Number(progress.max)))
    }
  }
  const setPlayState = () => {
    play.textContent = player.paused ? '▶' : 'Ⅱ'
    play.title = player.paused ? '播放' : '暂停'
  }
  const setMuteState = () => {
    mute.textContent = player.muted || player.volume === 0 ? '静' : '音'
    mute.title = player.muted || player.volume === 0 ? '取消静音' : '静音'
  }
  setToggleState()
  setMuteState()
  let lastHistoryAt = 0
  let autoPlayAttempted = false
  const attemptAutoPlay = () => {
    if (autoPlayAttempted || !player.paused) return
    autoPlayAttempted = true
    player.play().catch(() => {
      playbackWarning.classList.remove('hidden')
      playbackWarning.textContent = '点击播放开始'
    })
  }
  play.addEventListener('click', () => {
    if (player.paused) player.play().catch(() => {})
    else player.pause()
  })
  player.addEventListener('click', () => {
    if (reader.type !== 'video') return
    if (player.paused) player.play().catch(() => {})
    else player.pause()
  })
  player.addEventListener('play', setPlayState)
  player.addEventListener('pause', setPlayState)
  player.addEventListener('pause', () => recordCurrentLibraryHistory({ flush: true, visit: false, reader }).catch(() => {}))
  player.addEventListener('loadedmetadata', () => {
    setProgress()
    renderStreamSubtitles()
    const seconds = Number(options.position?.seconds || 0)
    if (seconds > 0 && Number.isFinite(player.duration) && player.duration > 0) {
      player.currentTime = Math.max(0, Math.min(seconds, player.duration - 0.2))
    }
    attemptAutoPlay()
  })
  player.addEventListener('timeupdate', () => {
    setProgress()
    renderStreamSubtitles()
    const now = Date.now()
    if (now - lastHistoryAt > 5000) {
      lastHistoryAt = now
      recordCurrentLibraryHistory({ visit: false, reader }).catch(() => {})
    }
  })
  player.addEventListener('seeked', renderStreamSubtitles)
  progress.addEventListener('input', () => {
    if (!Number.isFinite(player.duration) || player.duration <= 0) return
    player.currentTime = (Number(progress.value) / Number(progress.max)) * player.duration
    setProgress()
  })
  mute.addEventListener('click', () => {
    player.muted = !player.muted
    setMuteState()
  })
  volume.addEventListener('input', () => {
    player.volume = Math.max(0, Math.min(1, Number(volume.value) || 0))
    player.muted = player.volume === 0
    localStorage.setItem('copymanga.mediaVolume', String(player.volume))
    setMuteState()
  })
  loopToggle.addEventListener('click', () => {
    const enabled = localStorage.getItem('copymanga.mediaAutoReplay') === '1'
    localStorage.setItem('copymanga.mediaAutoReplay', enabled ? '0' : '1')
    setToggleState()
  })
  nextToggle.addEventListener('click', () => {
    const enabled = localStorage.getItem('copymanga.mediaAutoNext') === '1'
    localStorage.setItem('copymanga.mediaAutoNext', enabled ? '0' : '1')
    setToggleState()
  })
  fullscreen.addEventListener('click', () => {
    const active = els.mediaViewerView.classList.toggle('stream-page-fullscreen')
    fullscreen.classList.toggle('active', active)
    fullscreen.title = active ? '退出页面全屏' : '页面全屏'
  })
  const vrViewer = reader.type === 'video'
    ? createVrVideoViewer({ frame, player, controls: vrControls, warning: playbackWarning })
    : null
  subtitleSmaller.addEventListener('click', () => adjustSubtitleOverlayScale(-0.1, [subtitleOverlay, vrViewer?.subtitleOverlay]))
  subtitleLarger.addEventListener('click', () => adjustSubtitleOverlayScale(0.1, [subtitleOverlay, vrViewer?.subtitleOverlay]))
  const title = document.createElement('div')
  title.className = 'stream-player-title'
  title.textContent = reader.unit?.title || reader.unit?.fileName || '媒体'
  const meta = document.createElement('div')
  meta.className = 'stream-player-meta'
  meta.textContent = [
    reader.unit?.fileName || '',
    reader.unit?.contentType || '',
    reader.unit?.size ? formatBytes(reader.unit.size) : '',
    reader.stream?.streamPath || '',
  ].filter(Boolean).join(' · ')
  player.addEventListener('ended', () => {
    // 全部用闭包里的 reader，不读全局：这样 A 在后台播完时，进度/历史/续播
    // 都还认 A，即使媒体库页此刻已经切到 B。
    saveLibraryProgress(1, reader).catch(() => {})
    recordCurrentLibraryHistory({ flush: true, visit: false, reader, position: { kind: 'time', seconds: player.duration || player.currentTime || 0, duration: player.duration || 0, ratio: 1 } }).catch(() => {})
    if (localStorage.getItem('copymanga.mediaAutoReplay') === '1') {
      player.currentTime = 0
      player.play().catch(() => {})
      return
    }
    if (localStorage.getItem('copymanga.mediaAutoNext') === '1' && reader.navigation?.next) {
      // 这个播放器已经被别的会话顶掉了就别再续了（用户点了 B 的章节 = 覆盖）
      if (currentMediaReader && currentMediaReader !== reader) return
      const viewerActive = els.mediaViewerView.classList.contains('active')
      openMediaUnit(reader.navigation.next.unitId, '', {
        owner: readerOwner(reader),
        background: !viewerActive,
      })
    }
  })
  player.addEventListener('error', () => {
    const code = player.error?.code
    const suffix = code ? ` (${code})` : ''
    playbackWarning.classList.remove('hidden')
    playbackWarning.textContent = `播放失败${suffix}：浏览器不支持该编码，或媒体文件无法被当前播放器解码`
  })
  const controls = document.createElement('div')
  controls.className = 'stream-extra-controls'
  controls.append(play, currentTime, progress, duration, mute, volume, rateSelect, subtitleSelect, secondarySubtitleSelect, subtitleSmaller, subtitleLarger, loopToggle, nextToggle, vrControls.element, fullscreen)
  frame.append(player, subtitleOverlay, controls)
  shell.append(title, frame, playbackWarning, meta)
  els.mediaReaderContent.replaceChildren(shell)
  setTimeout(attemptAutoPlay, 0)
  currentStreamCleanup = () => {
    els.mediaViewerView.classList.remove('stream-page-fullscreen')
    vrViewer?.destroy()
  }
  mediaPageIndex = 0
  mediaPageCount = 1
  mediaPageStep = 1
  updateMediaPageControls()
}

function createVrControls(visible) {
  const wrap = document.createElement('span')
  wrap.className = 'stream-vr-controls'
  wrap.hidden = !visible
  const makeSelect = (className, title, options, value) => {
    const select = document.createElement('select')
    select.className = className
    select.title = title
    for (const [optionValue, label] of options) {
      const option = document.createElement('option')
      option.value = optionValue
      option.textContent = label
      select.append(option)
    }
    select.value = options.some(([optionValue]) => optionValue === value) ? value : options[0][0]
    return select
  }
  const legacy = legacyVrModeToState(localStorage.getItem('copymanga.mediaVrMode') || '')
  const projection = makeSelect('stream-vr-mode', '投影', [
    ['off', '普通'],
    ['equirect360', '360'],
    ['equirect180', '180'],
    ['fisheye180', '鱼眼180'],
    ['dualfisheye180', '双鱼眼'],
    ['flat', '平面'],
  ], localStorage.getItem('copymanga.mediaVrProjection') || legacy.projection)
  const layout = makeSelect('stream-vr-layout', '布局', [
    ['mono', '单画面'],
    ['sbs', '左右'],
    ['tb', '上下'],
  ], localStorage.getItem('copymanga.mediaVrLayout') || legacy.layout)
  const eye = makeSelect('stream-vr-eye', '眼睛', [
    ['left', '左/上'],
    ['right', '右/下'],
  ], localStorage.getItem('copymanga.mediaVrEye') || legacy.eye)
  const mirror = document.createElement('button')
  mirror.type = 'button'
  mirror.className = 'stream-toggle stream-vr-correction'
  mirror.title = '水平镜像'
  mirror.textContent = '镜像'
  const flipY = document.createElement('button')
  flipY.type = 'button'
  flipY.className = 'stream-toggle stream-vr-correction'
  flipY.title = '上下翻转'
  flipY.textContent = '上下翻'
  const setPressed = (button, pressed) => {
    button.dataset.active = pressed ? '1' : '0'
    button.classList.toggle('active', pressed)
  }
  setPressed(mirror, (localStorage.getItem('copymanga.mediaVrMirrorX') || legacy.mirrorX) === '1')
  setPressed(flipY, (localStorage.getItem('copymanga.mediaVrFlipY') || legacy.flipY) === '1')
  wrap.append(projection, layout, eye, mirror, flipY)
  const value = () => ({
    projection: projection.value,
    layout: layout.value,
    eye: eye.value,
    mirrorX: mirror.dataset.active === '1',
    flipY: flipY.dataset.active === '1',
  })
  const save = () => {
    const state = value()
    localStorage.setItem('copymanga.mediaVrProjection', state.projection)
    localStorage.setItem('copymanga.mediaVrLayout', state.layout)
    localStorage.setItem('copymanga.mediaVrEye', state.eye)
    localStorage.setItem('copymanga.mediaVrMirrorX', state.mirrorX ? '1' : '0')
    localStorage.setItem('copymanga.mediaVrFlipY', state.flipY ? '1' : '0')
  }
  return {
    element: wrap,
    projection,
    layout,
    eye,
    mirror,
    flipY,
    value,
    save,
    onChange(callback) {
      const emit = () => {
        save()
        callback(value())
      }
      projection.addEventListener('change', emit)
      layout.addEventListener('change', emit)
      eye.addEventListener('change', emit)
      mirror.addEventListener('click', () => {
        setPressed(mirror, mirror.dataset.active !== '1')
        emit()
      })
      flipY.addEventListener('click', () => {
        setPressed(flipY, flipY.dataset.active !== '1')
        emit()
      })
    },
  }
}

function legacyVrModeToState(mode) {
  const state = { projection: 'off', layout: 'mono', eye: 'left', mirrorX: '', flipY: '' }
  if (!mode || mode === 'off') return state
  if (mode.startsWith('flat')) state.projection = 'flat'
  else state.projection = 'equirect360'
  if (mode.includes('sbs')) state.layout = 'sbs'
  if (mode.includes('tb')) state.layout = 'tb'
  if (mode.endsWith('right') || mode.endsWith('bottom')) state.eye = 'right'
  if (mode.includes('mirror-x')) state.mirrorX = '1'
  if (mode.includes('flip-y')) state.flipY = '1'
  return state
}

function defaultSecondarySubtitleIndex(subtitles = [], primaryIndex = 0) {
  if (!Array.isArray(subtitles) || subtitles.length < 2) return ''
  const zh = subtitles.findIndex((subtitle, index) => (
    index !== primaryIndex &&
    (/zh|chi|chs|cht|cn/i.test(String(subtitle?.language || '')) ||
      /AI\.zh|中文|简体|繁体/i.test(String(subtitle?.title || '')))
  ))
  if (zh >= 0) return zh
  const next = subtitles.findIndex((_, index) => index !== primaryIndex)
  return next >= 0 ? next : ''
}

function createVrVideoViewer({ frame, player, controls, warning }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'stream-vr-canvas'
  canvas.hidden = true
  const subtitleOverlay = document.createElement('div')
  subtitleOverlay.className = 'stream-vr-subtitles'
  subtitleOverlay.hidden = true
  makeSubtitleOverlayInteractive(subtitleOverlay, frame)
  frame.insertBefore(canvas, player.nextSibling)
  frame.insertBefore(subtitleOverlay, canvas.nextSibling)
  const state = {
    active: false,
    initialized: false,
    dragging: false,
    lastX: 0,
    lastY: 0,
    yaw: 0,
    pitch: 0,
    fov: Math.PI / 2.6,
    raf: 0,
    gl: null,
    program: null,
    texture: null,
    buffer: null,
    locations: null,
    vrState: controls.value(),
  }
  const showWarning = (message) => {
    warning.classList.remove('hidden')
    warning.textContent = message
  }
  const setVrState = (value) => {
    state.vrState = value || controls.value()
    setActive(state.vrState.projection !== 'off')
  }
  const setActive = (active) => {
    if (active && !initVr()) return
    state.active = active
    player.classList.toggle('stream-video-hidden', active)
    canvas.hidden = !active
    subtitleOverlay.hidden = !active
    if (active) {
      resizeVrCanvas(canvas)
      renderVr()
    } else if (state.raf) {
      cancelAnimationFrame(state.raf)
      state.raf = 0
    }
  }
  controls.onChange(setVrState)
  if (state.vrState.projection !== 'off') {
    setTimeout(() => setVrState(controls.value()), 0)
  }
  canvas.addEventListener('pointerdown', (event) => {
    state.dragging = true
    state.lastX = event.clientX
    state.lastY = event.clientY
    canvas.setPointerCapture?.(event.pointerId)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!state.dragging) return
    const dx = event.clientX - state.lastX
    const dy = event.clientY - state.lastY
    state.lastX = event.clientX
    state.lastY = event.clientY
    state.yaw -= dx * 0.005
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * 0.005))
  })
  canvas.addEventListener('pointerup', (event) => {
    state.dragging = false
    canvas.releasePointerCapture?.(event.pointerId)
  })
  canvas.addEventListener('pointercancel', () => {
    state.dragging = false
  })
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    state.fov = Math.max(Math.PI / 5, Math.min(Math.PI * 0.82, state.fov + event.deltaY * 0.001))
  }, { passive: false })
  const resizeHandler = () => {
    if (state.active) resizeVrCanvas(canvas)
  }
  window.addEventListener('resize', resizeHandler)
  function initVr() {
    if (state.initialized) return true
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) {
      showWarning('当前浏览器不支持 WebGL，无法打开 3D 全景模式')
      return false
    }
    const program = createVrProgram(gl)
    if (!program) {
      showWarning('3D 全景模式初始化失败')
      return false
    }
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]), gl.STATIC_DRAW)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    state.gl = gl
    state.program = program
    state.buffer = buffer
    state.texture = texture
    state.locations = {
      position: gl.getAttribLocation(program, 'a_position'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      yaw: gl.getUniformLocation(program, 'u_yaw'),
      pitch: gl.getUniformLocation(program, 'u_pitch'),
      fov: gl.getUniformLocation(program, 'u_fov'),
      projection: gl.getUniformLocation(program, 'u_projection'),
      layout: gl.getUniformLocation(program, 'u_layout'),
      eye: gl.getUniformLocation(program, 'u_eye'),
      mirrorX: gl.getUniformLocation(program, 'u_mirror_x'),
      flipY: gl.getUniformLocation(program, 'u_flip_y'),
      texture: gl.getUniformLocation(program, 'u_texture'),
    }
    state.initialized = true
    return true
  }
  function renderVr() {
    if (!state.active || !state.gl) return
    resizeVrCanvas(canvas)
    const gl = state.gl
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(state.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer)
    gl.enableVertexAttribArray(state.locations.position)
    gl.vertexAttribPointer(state.locations.position, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, state.texture)
    if (player.readyState >= 2 && player.videoWidth > 0 && player.videoHeight > 0) {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, player)
      } catch {
        showWarning('3D 全景模式无法读取当前视频帧，可能是浏览器限制或视频源不支持')
        setActive(false)
        return
      }
    }
    gl.uniform1i(state.locations.texture, 0)
    gl.uniform2f(state.locations.resolution, canvas.width, canvas.height)
    gl.uniform1f(state.locations.yaw, state.yaw)
    gl.uniform1f(state.locations.pitch, state.pitch)
    gl.uniform1f(state.locations.fov, state.fov)
    gl.uniform1i(state.locations.projection, vrProjectionCode(state.vrState.projection))
    gl.uniform1i(state.locations.layout, vrLayoutCode(state.vrState.layout))
    gl.uniform1i(state.locations.eye, state.vrState.eye === 'right' ? 1 : 0)
    gl.uniform1i(state.locations.mirrorX, state.vrState.mirrorX ? 1 : 0)
    gl.uniform1i(state.locations.flipY, state.vrState.flipY ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    renderVrSubtitles(player, subtitleOverlay)
    state.raf = requestAnimationFrame(renderVr)
  }
  return {
    destroy() {
      setActive(false)
      const gl = state.gl
      if (gl) {
        if (state.texture) gl.deleteTexture(state.texture)
        if (state.buffer) gl.deleteBuffer(state.buffer)
        if (state.program) gl.deleteProgram(state.program)
      }
      window.removeEventListener('resize', resizeHandler)
      canvas.remove()
      subtitleOverlay.remove()
    },
    subtitleOverlay,
    setMode: (mode) => setVrState(legacyVrModeToState(mode)),
  }
}

function vrProjectionCode(value) {
  return {
    equirect360: 1,
    equirect180: 2,
    fisheye180: 3,
    dualfisheye180: 4,
    flat: 20,
  }[value] || 0
}

function vrLayoutCode(value) {
  return {
    mono: 0,
    sbs: 1,
    tb: 2,
  }[value] || 0
}

function renderVrSubtitles(player, subtitleOverlay) {
  const cues = []
  for (const track of player.textTracks || []) {
    if (track.mode !== 'showing' && track.mode !== 'hidden') continue
    for (const cue of track.activeCues || []) cues.push(cue.text || '')
  }
  subtitleOverlay.textContent = cues.filter(Boolean).join('\n')
  subtitleOverlay.classList.toggle('hidden', !subtitleOverlay.textContent)
}

function resizeVrCanvas(canvas) {
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.floor(rect.width * ratio))
  const height = Math.max(1, Math.floor(rect.height * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
}

function createVrProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform float u_yaw;
    uniform float u_pitch;
    uniform float u_fov;
    uniform int u_projection;
    uniform int u_layout;
    uniform int u_eye;
    uniform bool u_mirror_x;
    uniform bool u_flip_y;
    varying vec2 v_uv;
    const float PI = 3.141592653589793;

    vec3 rotateX(vec3 value, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return vec3(value.x, value.y * c - value.z * s, value.y * s + value.z * c);
    }

    vec3 rotateY(vec3 value, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return vec3(value.x * c + value.z * s, value.y, -value.x * s + value.z * c);
    }

    vec2 sourceCoord(vec2 coord) {
      if (u_mirror_x) coord.x = 1.0 - coord.x;
      if (u_flip_y) coord.y = 1.0 - coord.y;
      if (u_layout == 1) coord.x = coord.x * 0.5 + (u_eye == 1 ? 0.5 : 0.0);
      if (u_layout == 2) coord.y = coord.y * 0.5 + (u_eye == 1 ? 0.5 : 0.0);
      return coord;
    }

    vec3 equirectCoord(vec3 dir, bool halfDome) {
      float lon = atan(dir.x, -dir.z);
      float lat = asin(clamp(dir.y, -1.0, 1.0));
      if (halfDome && abs(lon) > PI * 0.5) return vec3(0.0, 0.0, 0.0);
      float x = halfDome ? lon / PI + 0.5 : lon / (2.0 * PI) + 0.5;
      return vec3(x, 0.5 - lat / PI, 1.0);
    }

    vec3 fisheyeCoord(vec3 dir, bool dual) {
      bool back = dir.z > 0.0;
      vec3 viewDir = back ? vec3(-dir.x, dir.y, -dir.z) : dir;
      float theta = acos(clamp(-viewDir.z, -1.0, 1.0));
      if (theta > PI * 0.5) return vec3(0.0, 0.0, 0.0);
      float phi = atan(viewDir.y, viewDir.x);
      float radius = theta / (PI * 0.5) * 0.5;
      vec2 center = dual ? vec2(back ? 0.75 : 0.25, 0.5) : vec2(0.5, 0.5);
      float scale = dual ? 0.5 : 1.0;
      return vec3(center + vec2(cos(phi), sin(phi)) * radius * scale, 1.0);
    }

    void main() {
      vec2 ndc = v_uv * 2.0 - 1.0;
      if (u_projection >= 20) {
        gl_FragColor = texture2D(u_texture, sourceCoord(v_uv));
        return;
      }
      float aspect = u_resolution.x / max(u_resolution.y, 1.0);
      float scale = tan(u_fov * 0.5);
      vec3 dir = normalize(vec3(ndc.x * aspect * scale, -ndc.y * scale, -1.0));
      dir = rotateY(rotateX(dir, u_pitch), u_yaw);
      vec3 projected = u_projection == 2
        ? equirectCoord(dir, true)
        : u_projection == 3
          ? fisheyeCoord(dir, false)
          : u_projection == 4
            ? fisheyeCoord(dir, true)
            : equirectCoord(dir, false);
      if (projected.z < 0.5) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      gl_FragColor = texture2D(u_texture, sourceCoord(projected.xy));
    }
  `)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function normalizePlaybackRate(value) {
  const rate = Number(value)
  if (!Number.isFinite(rate)) return 1
  return mediaPlaybackRates.reduce((best, item) => (
    Math.abs(item - rate) < Math.abs(best - rate) ? item : best
  ), 1)
}

function formatMediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
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

async function saveLibraryProgress(scrollRatio = mediaScrollRatio(), reader = currentMediaReader) {
  const owner = readerOwner(reader)
  if (!owner || !reader?.unit) return
  const saved = await api(`/api/library/items/${encodeURIComponent(owner.type)}/${encodeURIComponent(owner.itemId)}/progress`, {
    method: 'POST',
    body: JSON.stringify({
      unitId: reader.unit.unitId,
      title: reader.unit.title,
      sectionId: reader.section?.sectionId || '',
      sectionTitle: reader.section?.title || '',
      scrollRatio,
    }),
  })
  // 后台续播写的是别的合集，不能拿它覆盖媒体库页正在用的进度
  if (isLibraryPageOwner(owner)) currentLibraryProgress = saved
  if (!(reader.type === 'audio' || reader.type === 'video')) {
    recordCurrentLibraryHistory({
      visit: false,
      reader,
      position: { kind: reader.type || '', seconds: 0, duration: 0, ratio: scrollRatio },
    }).catch(() => {})
  }
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
els.discoverFirst.addEventListener('click', () => {
  discoverOffset = 0
  loadDiscover()
})
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
els.downloadedRefresh.addEventListener('click', () => {
  loadDownloaded()
})
els.downloadedFirst.addEventListener('click', () => {
  downloadedPage = 1
  loadDownloaded()
})
els.downloadedPrev.addEventListener('click', () => {
  downloadedPage = Math.max(1, downloadedPage - 1)
  loadDownloaded()
})
els.downloadedNext.addEventListener('click', () => {
  downloadedPage = Math.min(downloadedTotalPages, downloadedPage + 1)
  loadDownloaded()
})
els.downloadedJump.addEventListener('click', jumpDownloadedPage)
els.downloadedPage.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') jumpDownloadedPage()
})
els.downloadedKeyword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    downloadedPage = 1
    loadDownloaded()
  }
})
els.downloadedKeyword.addEventListener('change', () => {
  downloadedPage = 1
  loadDownloaded()
})
els.downloadedLimit.addEventListener('change', () => {
  downloadedPage = 1
  loadDownloaded()
})
els.downloadedReadFilter.addEventListener('change', () => {
  downloadedPage = 1
  loadDownloaded()
})
els.downloadedImageFilter.addEventListener('change', () => {
  downloadedPage = 1
  loadDownloaded()
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
els.libraryIndexRebuild?.addEventListener('click', rebuildLibraryIndex)
els.librarySearch?.addEventListener('click', () => {
  libraryPage = 1
  loadLibraryItems()
})
els.libraryType.addEventListener('change', () => {
  libraryPage = 1
  loadLibraryItems()
})
els.libraryTagSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    libraryPage = 1
    loadLibraryItems()
  }
})
els.libraryTagClear?.addEventListener('click', () => {
  els.libraryTagSearch.value = ''
  els.libraryTagSearch.focus()
})
els.libraryFirst?.addEventListener('click', () => {
  libraryPage = 1
  loadLibraryItems().catch((error) => alert(error.message))
})
els.libraryPrev?.addEventListener('click', () => {
  libraryPage = Math.max(1, libraryPage - 1)
  loadLibraryItems().catch((error) => alert(error.message))
})
els.libraryNext?.addEventListener('click', () => {
  libraryPage = Math.min(libraryTotalPages, libraryPage + 1)
  loadLibraryItems().catch((error) => alert(error.message))
})
els.libraryJump?.addEventListener('click', jumpLibraryPage)
els.libraryPage?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') jumpLibraryPage()
})
els.libraryLimit?.addEventListener('change', () => {
  libraryPage = 1
  loadLibraryItems().catch((error) => alert(error.message))
})
els.librarySort?.addEventListener('change', () => {
  libraryPage = 1
  loadLibraryItems().catch((error) => alert(error.message))
})
els.librarySeriesSubtitle?.addEventListener('change', () => {
  libraryPage = 1
  loadLibraryItems().catch((error) => alert(error.message))
})
els.seriesModalClose?.addEventListener('click', closeSeriesModal)
els.seriesModal?.querySelector('.series-modal-backdrop')?.addEventListener('click', closeSeriesModal)
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.seriesModal?.classList.contains('hidden')) closeSeriesModal()
})
els.libraryRunTagScripts.addEventListener('click', async () => {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId) return
  const actionIds = checkedTagScriptIds('library-tag-script')
  if (!actionIds.length) return alert('请选择元数据脚本')
  try {
    setLoading(els.libraryRunTagScripts, true)
    await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/metadata-actions`, {
      method: 'POST',
      body: JSON.stringify({ actionIds, force: true }),
    })
    setTimeout(() => selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId).catch(() => {}), 1500)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.libraryRunTagScripts, false)
  }
})

els.libraryRunPageTagScripts?.addEventListener('click', async () => {
  const actionIds = checkedTagScriptIds('library-tag-script')
  if (!actionIds.length) return alert('请选择元数据脚本')
  const items = currentLibraryPageItems()
  if (!items.length) return alert('当前页没有媒体')
  if (!confirm(`对当前页 ${items.length} 个媒体执行选中的元数据脚本吗？`)) return
  try {
    setLoading(els.libraryRunPageTagScripts, true)
    for (const item of items) {
      await api(`/api/library/items/${encodeURIComponent(item.type)}/${encodeURIComponent(item.itemId)}/metadata-actions`, {
        method: 'POST',
        body: JSON.stringify({ actionIds, force: true }),
      })
    }
    await loadTagManager().catch(() => {})
    if (currentLibraryItem?.type && currentLibraryItem?.itemId) {
      setTimeout(() => selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId).catch(() => {}), 1500)
    }
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.libraryRunPageTagScripts, false)
  }
})

els.libraryRunSelectedUnits.addEventListener('click', async () => {
  const unitIds = checkedLibraryUnitIds()
  if (!unitIds.length) return alert('请选择章节')
  await runMetadataActions({ unitIds, button: els.libraryRunSelectedUnits })
})

async function runMetadataActionsForUnit(unit) {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId || !unit?.unitId) return
  await runMetadataActions({ unitIds: [unit.unitId] })
}

function checkedLibraryUnitIds() {
  return [...els.libraryUnits.querySelectorAll('.unit-metadata-select:checked')]
    .map((input) => input.value)
    .filter(Boolean)
}

function currentLibraryPageItems() {
  return libraryItems
}

function updateLibraryMetadataActionButtons() {
  const hasScripts = tagScripts.some((script) => !script.error)
  const hasCurrentItem = Boolean(currentLibraryItem?.type && currentLibraryItem?.itemId)
  const hasPageItems = currentLibraryPageItems().length > 0
  if (els.libraryRunTagScripts) els.libraryRunTagScripts.disabled = !hasScripts || !hasCurrentItem
  if (els.libraryRunSelectedUnits) els.libraryRunSelectedUnits.disabled = !hasScripts || !hasCurrentItem
  if (els.libraryRunPageTagScripts) els.libraryRunPageTagScripts.disabled = !hasScripts || !hasPageItems
}

async function runMetadataActions({ unitIds = [], button = null } = {}) {
  if (!currentLibraryItem?.type || !currentLibraryItem?.itemId) return
  const selectedActionIds = checkedTagScriptIds('library-tag-script')
  const actionIds = unitIds.length ? filterTagScriptIdsByScope(selectedActionIds, 'unit') : selectedActionIds
  if (!actionIds.length) return alert(unitIds.length ? '请选择支持章节执行的元数据脚本' : '请选择元数据脚本')
  if (unitIds.length && selectedActionIds.length !== actionIds.length) {
    console.info('已跳过不支持章节执行的元数据脚本', selectedActionIds.filter((id) => !actionIds.includes(id)))
  }
  try {
    if (button) setLoading(button, true)
    await api(`/api/library/items/${encodeURIComponent(currentLibraryItem.type)}/${encodeURIComponent(currentLibraryItem.itemId)}/metadata-actions`, {
      method: 'POST',
      body: JSON.stringify({ actionIds, unitIds, force: true }),
    })
    setTimeout(() => selectLibraryItem(currentLibraryItem.type, currentLibraryItem.itemId).catch(() => {}), 1500)
  } catch (error) {
    alert(error.message)
  } finally {
    if (button) setLoading(button, false)
  }
}
els.tagManagerRefresh.addEventListener('click', () => loadTagManager())
els.tagScriptsReload.addEventListener('click', () => loadTagManager({ reloadScripts: true }))
els.tagScriptUpload.addEventListener('click', uploadTagScriptPackage)
els.tagManagerSearch?.addEventListener('click', () => {
  tagManagerPage = 1
  loadTagManager().catch((error) => alert(error.message))
})
els.tagManagerKeyword?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    tagManagerPage = 1
    loadTagManager().catch((error) => alert(error.message))
  }
})
els.tagManagerFirst?.addEventListener('click', () => {
  tagManagerPage = 1
  loadTagManager().catch((error) => alert(error.message))
})
els.tagManagerPrev?.addEventListener('click', () => {
  tagManagerPage = Math.max(1, tagManagerPage - 1)
  loadTagManager().catch((error) => alert(error.message))
})
els.tagManagerNext?.addEventListener('click', () => {
  tagManagerPage += 1
  loadTagManager().catch((error) => alert(error.message))
})
els.tagScriptsFirst?.addEventListener('click', () => {
  tagScriptsPage = 1
  loadTagManager().catch((error) => alert(error.message))
})
els.tagScriptsPrev?.addEventListener('click', () => {
  tagScriptsPage = Math.max(1, tagScriptsPage - 1)
  loadTagManager().catch((error) => alert(error.message))
})
els.tagScriptsNext?.addEventListener('click', () => {
  tagScriptsPage += 1
  loadTagManager().catch((error) => alert(error.message))
})
els.tagJobsFirst?.addEventListener('click', () => {
  tagJobsPage = 1
  loadTagManager().catch((error) => alert(error.message))
})
els.tagJobsPrev?.addEventListener('click', () => {
  tagJobsPage = Math.max(1, tagJobsPage - 1)
  loadTagManager().catch((error) => alert(error.message))
})
els.tagJobsNext?.addEventListener('click', () => {
  tagJobsPage += 1
  loadTagManager().catch((error) => alert(error.message))
})
els.historyRefresh.addEventListener('click', loadLibraryHistory)
els.historyType.addEventListener('change', loadLibraryHistory)
els.historyKeyword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadLibraryHistory()
})
els.historyClear.addEventListener('click', async () => {
  const type = els.historyType.value || 'all'
  if (!confirm(`确定清空${type === 'all' ? '全部' : type}浏览历史吗？`)) return
  try {
    setLoading(els.historyClear, true)
    await api(`/api/library/history?type=${encodeURIComponent(type)}`, { method: 'DELETE' })
    await loadLibraryHistory()
    if (document.querySelector('#library-view')?.classList.contains('active')) await loadLibraryItems()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.historyClear, false)
  }
})
els.librarySaveTags.addEventListener('click', saveLibraryItemTags)
els.librarySubtitles.addEventListener('click', rescanLibrarySubtitles)
els.libraryThumbnails.addEventListener('click', regenerateLibraryThumbnails)
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
els.mediaImportProfile.addEventListener('change', () => {
  applyMediaImportProfile()
  loadMediaImportItems()
})
els.mediaImportProfileConfigSave.addEventListener('click', async () => {
  try {
    const value = JSON.parse(els.mediaImportProfileConfig.value || '{}')
    await saveMediaImportProfileConfig(value)
  } catch (error) {
    alert(`导入方案配置无效：${error.message}`)
  }
})
els.mediaImportProfileConfigReset.addEventListener('click', async () => {
  try {
    const key = els.mediaImportProfile.value
    await saveMediaImportProfileConfig(defaultMediaImportProfiles[key] || {})
  } catch (error) {
    alert(error.message)
  }
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
  const profile = mediaImportProfiles[els.mediaImportProfile.value] || mediaImportProfiles.custom
  const files = [...(els.mediaImportFiles.files || [])]
  const sourcePath = els.mediaImportSourcePath.value.trim()
  if (!files.length && (!info.source || !sourcePath)) return alert(`请选择 ${info.label} 文件${info.source ? '或填写来源路径' : ''}`)
  if (!profile.batch && !els.mediaImportItem.value && !els.mediaImportTitle.value.trim()) return alert('请输入合集名称')
  try {
    setLoading(els.mediaImportSubmit, true)
    const form = new FormData()
    form.set('title', els.mediaImportTitle.value.trim())
    form.set('importProfile', els.mediaImportProfile.value)
    if (!profile.batch && els.mediaImportItem.value) form.set('itemId', els.mediaImportItem.value)
    if (sourcePath) form.set('sourcePath', sourcePath)
    const metadataActionIds = checkedTagScriptIds('media-import-tag-script')
    if (!profile.batch && metadataActionIds.length) form.set('metadataActionIds', metadataActionIds.join(','))
    for (const file of files) form.append('file', file)
    const result = await apiForm(`/api/library/items?type=${encodeURIComponent(type)}`, form)
    const importedItems = Array.isArray(result.items) ? result.items : [result]
    const item = importedItems[0]
    els.mediaImportFiles.value = ''
    if (sourcePath) els.mediaImportSourcePath.value = ''
    await loadMediaImportItems()
    if (!profile.batch && item) {
      els.mediaImportItem.value = item.itemId
      els.mediaImportTitle.value = item.title
    }
    updateMediaImportMeta()
    if (item && els.libraryType.value !== item.type && els.libraryType.value !== 'all') els.libraryType.value = 'all'
    await loadLibraryItems()
    if (item) await selectLibraryItem(item.type, item.itemId)
    showView('library-view')
    if (profile.batch) alert(`已导入 ${importedItems.length} 个 RJ 媒体`)
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.mediaImportSubmit, false)
  }
})
els.mediaReaderBack.addEventListener('click', () => {
  showView(mediaReturnView || 'library-view')
})
// 阅读器导航（上一章/下一章/目录/翻页）作用在当前会话上，归属必须跟着会话走
function openUnitInSession(unitId, sectionId = '') {
  return openMediaUnit(unitId, sectionId, { owner: readerOwner(currentMediaReader) })
}

els.mediaReaderPrev.addEventListener('click', () => {
  const target = currentMediaReader?.navigation?.prev
  if (target) openUnitInSession(target.unitId)
})
els.mediaReaderNext.addEventListener('click', () => {
  const target = currentMediaReader?.navigation?.next
  if (target) openUnitInSession(target.unitId)
})
els.mediaSectionSelect.addEventListener('change', () => {
  if (currentMediaReader?.unit?.unitId && els.mediaSectionSelect.value) {
    openUnitInSession(currentMediaReader.unit.unitId, els.mediaSectionSelect.value)
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
document.addEventListener('click', (event) => {
  const toggle = event.target.closest?.('.tag-toggle')
  if (toggle) {
    event.preventDefault()
    event.stopPropagation()
    const list = toggle.closest('.tag-list')
    const collapsed = list?.dataset.collapsed !== '0'
    if (list) {
      list.dataset.collapsed = collapsed ? '0' : '1'
      list.classList.toggle('tag-list-collapsed', !collapsed)
      toggle.textContent = collapsed ? '收起' : `+${toggle.dataset.more || 0}`
    }
    return
  }
  const pill = event.target.closest?.('.tag-pill[data-tag]')
  if (!pill) return
  event.stopPropagation()
  showView('library-view')
  els.libraryTagSearch.value = `tag:"${String(pill.dataset.tag || '').replace(/"/g, '\\"')}"`
  libraryPage = 1
  loadLibraryItems().catch((error) => alert(error.message))
}, true)
els.mediaPagePrev.addEventListener('click', () => setMediaPage(mediaPageIndex - 1))
els.mediaPageNext.addEventListener('click', () => {
  if (currentMediaReader?.type === 'html' && mediaPageIndex < mediaPageCount - 1) {
    setMediaPage(mediaPageIndex + 1)
    return
  }
  const sectionTarget = currentMediaReader?.sectionNavigation?.next
  if (sectionTarget) {
    openUnitInSession(currentMediaReader.unit.unitId, sectionTarget.sectionId)
    return
  }
  const target = currentMediaReader?.navigation?.next
  if (target) openUnitInSession(target.unitId)
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
    const superseded = data.superseded || []
    const changedJobs = [...retried, ...superseded]
    const changedIds = new Set(changedJobs.map((job) => job.id))
    jobs = [...changedJobs, ...jobs.filter((job) => !changedIds.has(job.id))]
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

function formatShortDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '')
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatMinuteDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '')
  const year = String(date.getFullYear()).slice(-2)
  return `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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
    scheduleDownloadedRefreshIfActive()
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
      scheduleDownloadedRefreshIfActive()
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
      scheduleDownloadedRefreshIfActive()
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
    scheduleDownloadedRefreshIfActive(0)
  }
})

refreshDownloadedState().catch(() => {})
loadReadingProgress().catch(() => {})
loadConfig().catch(() => {})
api('/api/inventory-update').then(renderInventoryUpdate).catch(() => {})
setInterval(() => {
  syncJobs().catch(() => {})
}, 2000)
