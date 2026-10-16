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
  // 只收真正切视图的 tab：顶栏里还有个 .tab.tab-back 是「返回」，
  // 它没有 data-view，混进来会让点击走到 showView(undefined) 把所有视图隐掉
  tabs: [...document.querySelectorAll('.tab[data-view]')],
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
  globalBack: document.querySelector('#global-back'),
  viewerView: document.querySelector('#viewer-view'),
  viewerImmersive: document.querySelector('#viewer-immersive'),
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
  librarySourceProfile: document.querySelector('#library-source-profile'),
  mergeGroups: document.querySelector('#merge-groups'),
  mergeRefresh: document.querySelector('#merge-refresh'),
  mergeRunPage: document.querySelector('#merge-run-page'),
  mergePrev: document.querySelector('#merge-prev'),
  mergeNext: document.querySelector('#merge-next'),
  mergePage: document.querySelector('#merge-page'),
  mergePageTotal: document.querySelector('#merge-page-total'),
  mergeJump: document.querySelector('#merge-jump'),
  mergeLimit: document.querySelector('#merge-limit'),
  mergePageInfo: document.querySelector('#merge-page-info'),
  mergeKeyword: document.querySelector('#merge-keyword'),
  mergeSearch: document.querySelector('#merge-search'),
  mergeIndexHint: document.querySelector('#merge-index-hint'),
  mergeDumpRefresh: document.querySelector('#merge-dump-refresh'),
  mergeDumpStatus: document.querySelector('#merge-dump-status'),
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
  librarySearchPresetSelect: document.querySelector('#library-search-preset-select'),
  librarySearchPresetName: document.querySelector('#library-search-preset-name'),
  librarySearchPresetLoad: document.querySelector('#library-search-preset-load'),
  librarySearchPresetSave: document.querySelector('#library-search-preset-save'),
  librarySearchPresetDelete: document.querySelector('#library-search-preset-delete'),
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
  mergeTagScripts: document.querySelector('#merge-tag-scripts'),
  libraryRunTagScripts: document.querySelector('#library-run-tag-scripts'),
  libraryRunPageTagScripts: document.querySelector('#library-run-page-tag-scripts'),
  libraryRunAllTagScripts: document.querySelector('#library-run-all-tag-scripts'),
  libraryDetailPanel: document.querySelector('#library-detail-panel'),
  libraryDetailToggle: document.querySelector('#library-detail-toggle'),
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
  mediaImmersive: document.querySelector('#media-immersive'),
  mediaWidthAdjust: document.querySelector('#media-width-adjust'),
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
  configJobPollIntervalMs: document.querySelector('#config-job-poll-interval-ms'),
  toggleJobPoll: document.querySelector('#toggle-job-poll'),
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
  configEpubTtsApiBase: document.querySelector('#config-epub-tts-api-base'),
  configEpubTtsSpeakerAudio: document.querySelector('#config-epub-tts-speaker-audio'),
  configEpubTtsPromptAudio: document.querySelector('#config-epub-tts-prompt-audio'),
  configEpubTtsPromptText: document.querySelector('#config-epub-tts-prompt-text'),
  configEpubTtsTextLanguage: document.querySelector('#config-epub-tts-text-language'),
  configEpubTtsPromptLanguage: document.querySelector('#config-epub-tts-prompt-language'),
  configEpubTtsMaxConcurrency: document.querySelector('#config-epub-tts-max-concurrency'),
  configEpubTtsBatchMaxSentences: document.querySelector('#config-epub-tts-batch-max-sentences'),
  configEpubTtsBatchMaxChars: document.querySelector('#config-epub-tts-batch-max-chars'),
  configMediaSubtitleExtensions: document.querySelector('#config-media-subtitle-extensions'),
  configMediaOpenInNewTab: document.querySelector('#config-media-open-in-new-tab'),
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
let viewerBatch = null
let galleryBatch = null
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
let currentStreamImmersiveToggle = null
let currentStreamSeekBy = null
let galleryImmersiveJumpOnce = null

// —— 媒体浏览的 URL 深链 / 多标签页 ——
// 每个浏览器标签页是独立的 JS 环境，阅读器那二十多个模块级单例互不干扰，所以"多标签页"
// 不用改阅读器本身，只要让一个标签页能靠 URL 直接落到某个条目/章节上：
//   #/media/{type}/{itemId}                                  按历史记录续读（和点"继续"一样）
//   #/media/{type}/{itemId}/{unitId}[?section={sectionId}]   打开指定章节
// 用 hash 而不是路径：服务端不用加路由，静态文件原样返回。
// 这些放在文件靠前的位置：下面的 bootMediaRoute 在模块加载时就要用，放后面会踩 const 的 TDZ。
const MEDIA_ROUTE_PREFIX = '#/media/'
let currentMediaRoute = null   // 当前阅读器对应的路由，openMediaUnit 成功后写入
let backgroundSyncStarted = false

function parseMediaRoute(hash = location.hash) {
  if (!hash.startsWith(MEDIA_ROUTE_PREFIX)) return null
  try {
    const [pathPart, queryPart = ''] = hash.slice(MEDIA_ROUTE_PREFIX.length).split('?')
    const [type, itemId, unitId = ''] = pathPart.split('/').map((part) => decodeURIComponent(part))
    if (!type || !itemId) return null
    return { type, itemId, unitId, sectionId: new URLSearchParams(queryPart).get('section') || '' }
  } catch {
    return null   // 手敲的 URL 里有非法的 % 转义
  }
}

function mediaRouteHash({ type, itemId, unitId = '', sectionId = '' }) {
  let hash = `${MEDIA_ROUTE_PREFIX}${encodeURIComponent(type)}/${encodeURIComponent(itemId)}`
  if (unitId) hash += `/${encodeURIComponent(unitId)}`
  if (unitId && sectionId) hash += `?section=${encodeURIComponent(sectionId)}`
  return hash
}

// URL 只在"媒体浏览是当前视图、并且有阅读器"时反映它，其余时候清掉：否则从阅读器切去
// 别的页再刷新，会被拽回阅读器。用 replaceState：既不往历史栈里塞记录，也不会触发
// hashchange（不然自己改 URL 会让自己再打开一遍）。
function syncMediaHash() {
  const route = currentMediaRoute
  const showing = Boolean(route && els.mediaViewerView?.classList.contains('active'))
  if (showing) {
    const want = mediaRouteHash(route)
    if (location.hash !== want) history.replaceState(null, '', `${location.pathname}${location.search}${want}`)
  } else if (parseMediaRoute()) {
    history.replaceState(null, '', `${location.pathname}${location.search}`)
  }
}

function openMediaRouteInNewTab(route) {
  // 必须在点击处理器里同步调用（前面不能有 await），否则会被浏览器当成弹窗拦掉
  window.open(`${location.origin}${location.pathname}${location.search}${mediaRouteHash(route)}`, '_blank', 'noopener')
}

// Ctrl/⌘ 点击永远开新标签页（和浏览器里点链接的习惯一致）；普通点击看配置开关。
function shouldOpenMediaInNewTab(event) {
  return Boolean(event?.ctrlKey || event?.metaKey || appConfig?.mediaOpenInNewTab)
}

// 从 URL 启动的标签页：落在阅读器上，不是默认的搜索页。
const bootMediaRoute = parseMediaRoute()
const JOB_POLL_KEY = 'copymanga.jobPollEnabled'
let jobPollIntervalMs = 5000
let jobPollTimer = null
let appConfig = null
const mediaReaderThemeClasses = ['reader-theme-light', 'reader-theme-dark', 'reader-theme-warm', 'reader-theme-sepia']
const mediaModeClasses = ['media-mode-empty', 'media-mode-html', 'media-mode-images', 'media-mode-audio', 'media-mode-video']
const siteThemeClasses = ['site-theme-light', 'site-theme-dark', 'site-theme-warm', 'site-theme-sepia']
const defaultMediaImportProfiles = {
  'rj-media': {
    maxDepth: 6,
    idPattern: '(?:RJ|VJ|BJ|EJ)\\d{6,8}',
    defaultMetadataActions: ['builtin-scan-media-units', 'builtin-subtitles', 'rj-dlsite-v1', 'rj-series-v1', 'media-info-v1', 'builtin-thumbnails'],
    fetchDlsiteCover: true,
    fetchDlsiteTitle: true,
    dlsiteRequestMinIntervalMs: 1500,
    dlsiteRequestJitterMs: 800,
  },
  // 原先靠 scriptHints 模糊匹配勾上字幕扫描，去掉模糊匹配后在这里显式列出，
  // 行为与之前一致（但不再误勾 AI 字幕/翻译）
  'normal-video': {
    defaultMetadataActions: ['builtin-subtitles', 'media-info-v1'],
  },
  // 导入时已经建好章节、配好字幕，所以不需要 builtin-scan-media-units；
  // builtin-subtitles 留着是为了刷出「字幕v1: 有/无」tag，媒体库的字幕筛选靠它。
  // anidb-udp-v1 读的是 anidb-v1 写的「AniDB: <aid>」tag 和缓存的 anime XML，必须后跑。
  // 注意：执行顺序不由这个数组决定——提交的是 checkedTagScriptIds() 的 DOM 顺序，
  // 也就是服务端按 name localeCompare 排的顺序（「AniDB v1」< 「C AniDB日文名 v1」）。
  // 改脚本显示名时要保证这个先后关系还在。
  'monthly-ani': {
    defaultMetadataActions: ['builtin-subtitles', 'anidb-v1', 'anidb-udp-v1', 'media-info-v1', 'builtin-thumbnails'],
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
  // batch: true —— 一个来源目录会产出多个合集（每个视频一个），和 rj-media 同类
  'monthly-ani': { label: '月度 ANI', type: 'media', sourcePlaceholder: '/input/ani', batch: true },
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
  // 离开沉浸所属的视图就收起沉浸态，否则顶栏会一直是 fixed+收起的，别的页没法用。
  // 切章也走 showView('viewer-view')，所以只在「换了视图」时才收。
  if (galleryImmersiveView && galleryImmersiveView !== id) exitGalleryImmersive()
  if (epubImmersive && id !== 'media-viewer-view') exitEpubImmersive()
  for (const view of els.views) view.classList.toggle('active', view.id === id)
  for (const tab of els.tabs) tab.classList.toggle('active', tab.dataset.view === id)
  els.searchToolbar.classList.toggle('hidden', id !== 'search-view')
  els.app.classList.toggle('media-viewer-focused', id === 'media-viewer-view')
  // 顶栏的「返回」只在两个阅读视图里有意义，别的页没有「上一处」可回
  if (els.globalBack) els.globalBack.hidden = !['media-viewer-view', 'viewer-view'].includes(id)
  // 从 URL 直接落在阅读器上的标签页不建 EventSource、不轮询（阅读器用不上，见
  // startBackgroundSync）；一旦离开阅读器去别的页，那些页面要实时更新，这时才启动。
  // 普通标签页启动时已经启动过了，这里是空操作。
  if (id !== 'media-viewer-view') startBackgroundSync()
  syncMediaHash()
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
  els.viewerImmersive.disabled = true
  els.viewerTitle.textContent = title || chapterUuid
  els.viewerMeta.textContent = '加载图片中...'
  els.viewerImages.className = 'viewer-grid'
  els.viewerImages.innerHTML = ''
  els.viewerImages.classList.remove('long-strip-viewer')
  retireImageBatch(viewerBatch)   // 上一章的兜底定时器不能再往这个容器里塞图
  viewerBatch = createImageBatch({
    container: els.viewerImages,
    onMeta: (rendered, total) => {
      els.viewerMeta.textContent = `${viewerState?.sourceText || '图片'} · ${rendered}/${total} 张图`
    },
    altFor: (image, index) => `${viewerState?.title || viewerState?.chapterUuid || 'chapter'} ${Number(image.index ?? index) + 1}`,
  })

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
    viewerBatch.images = data.images || []
    appendImageBatch(viewerBatch)
    els.viewerImmersive.disabled = !viewerBatch.images.length
    // 沉浸态下切章是异步重渲染的，控制条上的章节信息要跟着走
    syncGalleryImmersive()
    if (viewerBatch.images.length && !galleryImmersive && immersivePref('viewer')) {
      enterGalleryImmersive(viewerImmersiveOptions(false))
    }
    if (!viewerBatch.images.length) {
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

// 图片分批渲染：图片浏览 tab（老模式）和媒体库图集（新模式）共用同一套。
// container 是放 img 的容器，onMeta 负责把「已渲染/总数」写到各自的信息栏。
function createImageBatch({ container, onMeta, altFor }) {
  return { container, onMeta, altFor, images: [], rendered: 0, sentinel: null, active: null, retired: false }
}

// 换章/换内容类型时必须退役旧批次：每张图都挂着 15s 兜底定时器（视口外的
// lazy 图不会触发 load，只能靠它推进度），闭包抓着旧 batch。不退役的话这些
// 定时器到点会继续续批、继续调 onMeta —— 实测 EPUB 正文页顶上会出现
// 「图集测试 · 25/30 张图」。
function retireImageBatch(batch) {
  if (!batch) return
  batch.retired = true
  batch.active = null
}

function currentViewerBatchSize() {
  return Math.max(1, Math.min(50, Math.floor(Number(viewerBatchSize || 5))))
}

function appendImageBatch(batch) {
  if (!batch || batch.retired || !batch.images.length) return
  if (batch.sentinel) {
    batch.sentinel.remove()
    batch.sentinel = null
  }
  const size = currentViewerBatchSize()
  const start = batch.rendered
  const end = Math.min(batch.images.length, start + size)
  const round = {
    total: end - start,
    done: 0,
    triggered: false,
  }
  batch.active = round
  for (const [offset, image] of batch.images.slice(start, end).entries()) {
    const index = start + offset
    const img = document.createElement('img')
    img.src = image.url
    img.alt = batch.altFor(image, index)
    img.loading = 'lazy'
    img.decoding = 'async'
    img.fetchPriority = index < size ? 'high' : 'auto'
    let settled = false
    const markDone = () => {
      if (settled) return
      settled = true
      applyImageBatchLayout(batch, img)
      markImageBatchDone(batch, round)
    }
    img.addEventListener('load', markDone, { once: true })
    img.addEventListener('error', markDone, { once: true })
    // 兜底：某张图卡住时别把整批的进度堵死
    setTimeout(markDone, 15000)
    batch.container.append(img)
  }
  batch.rendered = end
  batch.onMeta(batch.rendered, batch.images.length)
  if (batch.rendered < batch.images.length) attachImageBatchSentinel(batch)
}

function applyImageBatchLayout(batch, img) {
  if (!img.naturalWidth || !img.naturalHeight) return
  const displayWidth = Math.min(img.naturalWidth, 980)
  img.style.maxWidth = `${displayWidth}px`
  img.style.width = `min(100%, ${displayWidth}px)`
  const isLongStrip = img.naturalHeight / Math.max(img.naturalWidth, 1) >= 4
  img.classList.toggle('long-strip-image', isLongStrip)
  if (isLongStrip) batch.container.classList.add('long-strip-viewer')
}

function markImageBatchDone(batch, round) {
  if (!round || round !== batch.active) return
  round.done += 1
  if (!round.triggered && round.done / Math.max(round.total, 1) >= 0.8 && batch.rendered < batch.images.length) {
    round.triggered = true
    appendImageBatch(batch)
  }
}

function attachImageBatchSentinel(batch) {
  batch.sentinel = document.createElement('div')
  batch.sentinel.className = 'viewer-sentinel'
  batch.sentinel.textContent = '加载更多'
  batch.sentinel.addEventListener('click', () => appendImageBatch(batch))
  batch.container.append(batch.sentinel)
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
  if (els.configJobPollIntervalMs) els.configJobPollIntervalMs.value = config.jobPollIntervalMs
  jobPollIntervalMs = Number(config.jobPollIntervalMs) || jobPollIntervalMs
  applyJobPolling()
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
  els.configEpubTtsApiBase.value = config.epubTtsApiBase || ''
  els.configEpubTtsSpeakerAudio.value = config.epubTtsSpeakerAudio || ''
  els.configEpubTtsPromptAudio.value = config.epubTtsPromptAudio || ''
  els.configEpubTtsPromptText.value = config.epubTtsPromptText || ''
  els.configEpubTtsTextLanguage.value = config.epubTtsTextLanguage || ''
  els.configEpubTtsPromptLanguage.value = config.epubTtsPromptLanguage || ''
  els.configEpubTtsMaxConcurrency.value = config.epubTtsMaxConcurrency || 1
  els.configEpubTtsBatchMaxSentences.value = config.epubTtsBatchMaxSentences || 5
  els.configEpubTtsBatchMaxChars.value = config.epubTtsBatchMaxChars || 200
  els.configMediaImportSourceRoots.value = config.mediaImportSourceRoots || ''
  els.configMediaSubtitleExtensions.value = config.mediaSubtitleExtensions || defaultMediaSubtitleExtensions
  els.configMediaOpenInNewTab.checked = Boolean(config.mediaOpenInNewTab)
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
    if (tab.dataset.view === 'merge-view') {
      // 这里故意不重置 mergePage：从成员卡片点进视频会切走，再点回合并 tab 就是
      // 这条路径。重置的话每次回来都落到第 1 页，翻到第 3 页看的那组就找不着了。
      // tagScripts 是懒加载的——之前只有进媒体库 tab 才会拉，如果用户会话里
      // 从没点过媒体库、直接先点了合并，这里的 tag 脚本复选框会显示"暂无元数据
      // 脚本"（哪怕服务端其实有脚本，只是没人触发过那次请求）。跟媒体导入页
      // 用的是同一个防御性写法。
      if (!tagScripts.length) loadTagScripts().catch(() => {})
      Promise.all([loadMergeCandidates(), refreshAnidbDumpStatus()]).catch(() => {})
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
  if (els.librarySourceProfile) els.librarySourceProfile.value = String(state.sourceProfile || '')
  libraryPage = Math.max(1, Math.floor(Number(state.page || 1)))
}

function saveLibraryState() {
  const state = {
    type: els.libraryType?.value || 'all',
    limit: Number(els.libraryLimit?.value || 10),
    sort: els.librarySort?.value || 'imported_desc',
    tag: els.libraryTagSearch?.value || '',
    seriesSubtitle: els.librarySeriesSubtitle?.value || 'any',
    sourceProfile: els.librarySourceProfile?.value || '',
    page: Math.max(1, Math.floor(Number(libraryPage || 1))),
  }
  localStorage.setItem(LIBRARY_STATE_KEY, JSON.stringify(state))
}

// 媒体库的查询条件。抽出来是因为「执行所有页」要用同一套条件逐页翻——
// 两边各拼一份的话，加了筛选条件只改一处，执行的就是另一批（看不见的那批）媒体。
function libraryQueryParams(page, limit) {
  const params = new URLSearchParams({
    type: els.libraryType.value || 'all',
    page: String(page),
    limit: String(limit),
    sort: els.librarySort?.value || 'imported_desc',
  })
  if (els.libraryTagSearch.value.trim()) params.set('tag', els.libraryTagSearch.value.trim())
  const seriesSubtitle = els.librarySeriesSubtitle?.value || 'any'
  if (seriesSubtitle !== 'any') params.set('seriesSubtitle', seriesSubtitle)
  const sourceProfileFilter = els.librarySourceProfile?.value || ''
  if (sourceProfileFilter) params.set('sourceProfile', sourceProfileFilter)
  return params
}

async function loadLibraryItems() {
  try {
    setLoading(els.libraryRefresh, true)
    const limit = Math.max(1, Number(els.libraryLimit?.value || 10))
    const type = els.libraryType.value || 'all'
    const params = libraryQueryParams(libraryPage, limit)
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
  renderTagScriptCheckboxes(els.mergeTagScripts, 'merge-tag-script')
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
      // 不加引号的话，tag 名里带空格会被搜索解析器（tag-store.mjs 的
      // parseTagQuery）在空格处截断——正则是 tag:\S+，遇到空格就停，
      // 剩下那半截会被当成一个无关的普通关键词，搜出来的结果就不对了。
      // 加引号走 tag:"[^"]+" 那条分支，整个值（含空格、冒号）原样当一个 token。
      // 转义写法和下面 tag-pill 点击那处（约 6510 行）保持一致，tag 名里
      // 万一真带双引号也不会把这个 token 提前截断。
      els.libraryTagSearch.value = `tag:"${String(tag.name || '').replace(/"/g, '\\"')}"`
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
      // 脚本框是定高滚动区，展开的面板常落在框外，不滚一下看不见
      if (!editor.hidden) editor.scrollIntoView({ block: 'nearest' })
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

// 耗时：毫秒级太短看不出，分钟级又不想读一长串毫秒
function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s`
}

function clockOf(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour12: false })
}

function summarizeMetadataJobResults(job) {
  const lines = []
  let totalMs = 0
  for (const result of job.results || []) {
    // 起止时刻都给：只给耗时的话看不出脚本之间的空档（排队、等限流）
    const span = [clockOf(result.startedAt), clockOf(result.finishedAt)].filter(Boolean).join('→')
    const elapsed = formatElapsed(result.elapsedMs)
    if (Number.isFinite(result.elapsedMs)) totalMs += result.elapsedMs
    const label = (span ? `[${span}] ` : '')
      + [result.actionId || result.scriptId, result.status, elapsed].filter(Boolean).join(' · ')
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
  if (lines.length > 1 && totalMs > 0) lines.push(`合计 ${lines.length} 个脚本 · ${formatElapsed(totalMs)}`)
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
// 可合并角标。只在条目的 workKey 确实构成分组（>=2 个条目）时出现，
// 点一下直接跳到合并页的那一组——否则你得自己记住 workKey 再去翻页找。
function renderMergeBadge(item) {
  const group = item.mergeGroup
  if (!group || group.count < 2) return ''
  const title = `可与另外 ${group.count - 1} 个条目合并（${group.key}），点击去合并页`
  return `<button class="library-merge-dot" type="button" data-work-key="${escapeHtml(group.key)}"
    title="${escapeHtml(title)}">合并 ${group.count}</button>`
}

// 媒体信息从 tag 里挑出来单独渲染。前缀和 media-info-v1 的默认配置对应；
// 脚本里改了前缀，这里也要跟着改，否则页面上找不到（所以那两个前缀默认别动）。
const MEDIA_INFO_RESOLUTION = '分辨率:'
const MEDIA_INFO_DURATION = '时长:'
// 分级标识。渲染 tag 里的实际值而不是写死 "18"，以后出现 restricted: 15 不用改代码。
const MEDIA_INFO_RESTRICTED = 'restricted:'

function pickTagValues(tags, prefix) {
  return (tags || [])
    .filter((tag) => String(tag).startsWith(prefix))
    .map((tag) => String(tag).slice(prefix.length).trim())
    .filter(Boolean)
}

// 媒体维度只显示分辨率，混装合集会有多个。超出一行就截断——用户明确说看不到也接受，
// 重点是别把卡片撑变形。
// 档位从高到低。非主流的 WxH 没有档位名，统一排在主流之后、彼此按像素数比。
const RESOLUTION_ORDER = ['4K', '1440P', '1080P', '720P', '576P', '480P', '360P']

function resolutionWeight(value) {
  const index = RESOLUTION_ORDER.indexOf(value)
  if (index >= 0) return RESOLUTION_ORDER.length - index
  const [w, h] = String(value).split('x').map(Number)
  return -1 - 1 / (((Number(w) || 0) * (Number(h) || 0)) + 1)
}

// 按「宽度预算」截断，不是按个数。实测只限个数不够：1080P 这种 4~5 字符的徽标
// 和 854x362 这种 8 字符的宽度差一倍，3 个长徽标照样占满 207px，把左边的
// 「N 个目录项」压到 48px 不可读。所以短档位记 1 分、非主流 WxH 记 2 分，总分 3 分封顶。
const MEDIA_INFO_BADGE_BUDGET = 3

function badgeCost(value) {
  return RESOLUTION_ORDER.includes(value) ? 1 : 2
}

function renderMediaInfoLine(tags) {
  const values = [...pickTagValues(tags, MEDIA_INFO_RESOLUTION)]
    .sort((a, b) => resolutionWeight(b) - resolutionWeight(a))
  // 总时长固定显示、永不折叠——它每个条目只有一个，折掉就白加了。
  // 但「固定」不等于「免费」：实测七档分辨率 + 999:59:59 会把左边的「N 个目录项」
  // 压到 26px 完全不可读。所以时长照常计费，只是从分辨率的预算里扣，
  // 让分辨率多折几个给它让位，而不是反过来。
  const duration = pickTagValues(tags, MEDIA_INFO_DURATION)[0] || ''
  const restricted = pickTagValues(tags, MEDIA_INFO_RESTRICTED)[0] || ''
  if (!values.length && !duration && !restricted) return ''
  const shown = []
  let budget = MEDIA_INFO_BADGE_BUDGET - (duration ? badgeCost(duration) : 0)
  for (const value of values) {
    const cost = badgeCost(value)
    // 至少显示一个：预算再紧也不能一个都不显示，那样整行只剩 +N 看不出是什么
    if (shown.length && cost > budget) break
    shown.push(value)
    budget -= cost
  }
  const rest = values.slice(shown.length)
  // 不依赖 tag 的存储顺序：那取决于脚本写入时的顺序和后续人工编辑，UI 自己排才稳定
  const badges = shown
    .map((value) => `<span class="mediainfo-badge" title="${escapeHtml(value)}">${escapeHtml(value)}</span>`)
    .join('')
  const more = rest.length
    ? `<span class="mediainfo-badge mediainfo-more" title="${escapeHtml(`还有 ${rest.join('、')}`)}">+${rest.length}</span>`
    : ''
  // 结尾的 "+" 是脚本标的：有章节没读出时长，这是个部分和
  const durationHint = duration.endsWith('+')
    ? `总时长 ${duration.slice(0, -1)}（部分章节无时长，实际更长）`
    : `总时长 ${duration}`
  const durationBadge = duration
    ? `<span class="mediainfo-badge mediainfo-duration" title="${escapeHtml(durationHint)}">${escapeHtml(duration)}</span>`
    : ''
  // 分级标识放最左，在分辨率之前。字号和内边距都比普通徽标小一圈，所以不计预算。
  // 实测它占 ~21px：最坏场景（3 档分辨率 + 时长 + 分级）左侧从 105px 降到 83px，
  // 刚好够放「1 个目录项」（84px）。再长的文案例如「12 个目录项 · 视频 12」(186px)
  // 本来就放不下——那是这一行固有的截断，不是分级标识带来的。
  const restrictedBadge = restricted
    ? `<span class="mediainfo-badge mediainfo-restricted" title="${escapeHtml(`分级 ${restricted}`)}">${escapeHtml(restricted)}</span>`
    : ''
  return `<span class="library-card-mediainfo">${restrictedBadge}${badges}${more}${durationBadge}</span>`
}

// 章节维度：分辨率 + 时长，放标题行右侧。没有就整个不渲染，不占位。
function renderUnitMediaInfo(tags) {
  const parts = [
    pickTagValues(tags, MEDIA_INFO_RESOLUTION)[0] || '',
    pickTagValues(tags, MEDIA_INFO_DURATION)[0] || '',
  ].filter(Boolean)
  if (!parts.length) return ''
  return `<span class="unit-mediainfo">${parts
    .map((value) => `<span class="mediainfo-badge" title="${escapeHtml(value)}">${escapeHtml(value)}</span>`)
    .join('')}</span>`
}

function renderSeriesBadges(item) {
  const series = item.series
  if (!series || series.count < 2) return ''
  const elsewhere = series.hasSubtitle && !series.selfHasSubtitle
  const dotTitle = elsewhere ? `同系列 ${series.count} 个，本项无字幕但系列中有` : `同系列 ${series.count} 个`
  return `
    <button class="library-series-dot${elsewhere ? ' elsewhere' : ''}" type="button" title="${escapeHtml(dotTitle)}">${series.count}</button>
  `
}

async function openSeriesModal(item) {
  const series = item.series
  if (!series || !els.seriesModal) return
  els.seriesModalTitle.textContent = `同系列 ${series.count} 个`
  els.seriesModalList.innerHTML = '<p class="muted">加载中…</p>'
  els.seriesModal.classList.remove('hidden')
  try {
    // 列表接口只给当前页挂了精简的 series.members（没有 tag 等字段），
    // 要按媒体库卡片的样子展示就得把整个系列的完整条目取回来。
    const data = await api(`/api/library/items?seriesKey=${encodeURIComponent(series.key)}&limit=1000`)
    // members 已按「有字幕优先」排好序，按它对齐，别让列表的默认排序把顺序打乱。
    const order = new Map((series.members || []).map((member, index) => [libraryKey(member.type, member.itemId), index]))
    const list = (data.items || []).slice().sort((a, b) =>
      (order.get(libraryKey(a.type, a.itemId)) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(libraryKey(b.type, b.itemId)) ?? Number.MAX_SAFE_INTEGER))
    els.seriesModalList.innerHTML = ''
    for (const member of list) {
      const card = createLibraryCard(member, { seriesBadges: false })
      // 卡片自带的点击是「选中」，弹框里点完还得把框关掉
      card.addEventListener('click', closeSeriesModal)
      // 这两个按钮内部都 stopPropagation 了，事件到不了上面那个 card 监听，得各自补一次
      card.querySelector('.library-continue')?.addEventListener('click', closeSeriesModal)
      card.querySelector('.library-units-go')?.addEventListener('click', closeSeriesModal)
      els.seriesModalList.append(card)
    }
    if (!list.length) els.seriesModalList.innerHTML = '<p class="muted">没有取到同系列条目</p>'
  } catch (error) {
    els.seriesModalList.innerHTML = `<p class="muted">加载失败：${escapeHtml(error.message)}</p>`
  }
}

function closeSeriesModal() {
  els.seriesModal?.classList.add('hidden')
}

// 点卡片是直接进播放器还是进目录。只认 sourceProfile——它是导入时写死的结构化
// 字段，用户在详情页改不到；用 tag 驱动导航行为的话，手滑删一个 tag 就会静默改掉交互。
// 将来要加新方案或做成每条目可覆盖（item.openMode），只改这个函数。
const VIEWER_FIRST_IMPORT_PROFILES = new Set(['monthly-ani'])

// 点卡片要操作哪一项：有系列就是系列里优先级最高的那个，否则就是自己。
// 「系列选哪一项」和「进目录还是直接播」是两件事——后者仍由 libraryCardOpensViewer
// 按目标项自己的 sourceProfile/unitCount 决定，这里只负责选目标。
function libraryCardTarget(item) {
  const series = item?.series
  if (!series || series.count < 2 || !series.primaryItemId) return item
  if (series.primaryItemId === item.itemId) return item
  const primary = (series.members || []).find((member) => member.itemId === series.primaryItemId)
  // members 是列表接口附带的精简结构；拿不到就退回自己，别把点击变成空操作
  return primary || item
}
function libraryCardOpensViewer(item) {
  // 必须同时看单元数：合并把多集并进一个条目后，直接跳播放器就不对了，
  // 这时候应该进目录。单元数是结构事实，不需要额外维护。
  return VIEWER_FIRST_IMPORT_PROFILES.has(item?.sourceProfile) && item?.unitCount === 1
}

// 媒体库卡片的唯一构造处。系列弹框复用它，这样两边的外观和交互不会各走各的。
// seriesBadges=false 用于弹框：框里本来就是同一个系列，再挂红点和「进入」没有意义。
function createLibraryCard(item, { seriesBadges = true } = {}) {
  const summary = libraryItemSummary(item)
  const history = libraryHistoryByKey.get(libraryKey(item.type, item.itemId))
  const selected = currentLibraryItem?.type === item.type && currentLibraryItem?.itemId === item.itemId
  const displayTitle = libraryDisplayTitle(item)
  const fullTitle = libraryFullTitle(item)
  const target = libraryCardTarget(item)
  const targetIsSelf = target.itemId === item.itemId
  const viewerFirst = libraryCardOpensViewer(item)
  // 「目录」是回到本项自己的入口。点卡片会跳到系列目标时必须给，否则自己的目录就没法进了；
  // 目标就是自己且不是 viewerFirst 时，它和点卡片完全同义，没必要多一个按钮。
  const showUnitsGo = viewerFirst || !targetIsSelf
  const card = document.createElement('article')
  card.className = `card library-card${selected ? ' selected' : ''}`
  card.title = fullTitle
  card.innerHTML = `
      <div class="library-card-cover">${renderCover(item.cover, displayTitle)}</div>
      <div class="card-body">
        <div class="library-card-top">
          <div class="card-title" title="${escapeHtml(fullTitle)}">${escapeHtml(displayTitle)}</div>
          <div class="library-card-badges">
            ${showUnitsGo ? `<button class="library-units-go" type="button" title="${escapeHtml(targetIsSelf ? '点卡片直接播放；这里进目录' : '点卡片进入系列中优先级最高的一项；这里进本项目录')}">目录</button>` : ''}
            <span class="library-type-pill">${escapeHtml(summary.typeLabel)}</span>
            ${renderMergeBadge(item)}
            ${seriesBadges ? renderSeriesBadges(item) : ''}
          </div>
        </div>
        <div class="library-card-primary">
          <span class="library-card-meta" title="${escapeHtml(summary.primary)}">${escapeHtml(summary.primary)}</span>
          ${renderMediaInfoLine(item.tags || [])}
        </div>
        <div class="library-card-meta" title="${escapeHtml(summary.secondary)}">${escapeHtml(summary.secondary)}</div>
        ${history ? `<div class="library-card-history">继续：${escapeHtml(history.lastUnitTitle || history.lastUnitId || item.title)}${historyProgressText(history) ? ` · ${escapeHtml(historyProgressText(history))}` : ''}</div>` : ''}
        ${renderTagList(item.tags || [])}
        <button class="library-continue secondary" type="button">${history ? '继续' : '打开'}</button>
      </div>
    `
  card.addEventListener('click', (event) => {
    // continueLibraryItem 只用到 {type,itemId}，精简的 member 就够，不必取完整条目
    if (libraryCardOpensViewer(target)) continueLibraryItem(target, event).catch((error) => alert(error.message))
    else selectLibraryItem(target.type, target.itemId)
  })
  card.querySelector('.library-units-go')?.addEventListener('click', (event) => {
    event.stopPropagation()
    selectLibraryItem(item.type, item.itemId)
  })
  card.querySelector('.library-series-dot')?.addEventListener('click', (event) => {
    event.stopPropagation()
    openSeriesModal(item)
  })
  card.querySelector('.library-merge-dot')?.addEventListener('click', (event) => {
    event.stopPropagation()
    jumpToMergeGroup(item.mergeGroup?.key || '').catch((error) => alert(error.message))
  })
  card.querySelector('.library-continue')?.addEventListener('click', (event) => {
    event.stopPropagation()
    continueLibraryItem(item, event).catch((error) => alert(error.message))
  })
  return card
}

// 导入方案筛选的选项直接取自 mediaImportProfiles，和导入页同一份定义，
// 新增方案时不用两边各改一次。
function syncLibrarySourceProfileOptions() {
  const select = els.librarySourceProfile
  if (!select) return
  const current = select.value
  select.innerHTML = '<option value="">导入方案：全部</option>'
  for (const [value, info] of Object.entries(mediaImportProfiles)) {
    if (value === 'custom') continue
    const option = document.createElement('option')
    option.value = value
    option.textContent = `方案：${info.label}`
    select.append(option)
  }
  select.value = [...select.options].some((o) => o.value === current) ? current : ''
}

// —— 媒体库搜索条件预设 ——
// 常用筛选条件存成一条条命名预设，方便来回切换，不用每次手动把 tag 搜索框 +
// 类型/导入方案/系列字幕/排序/每页 这几项重新摆一遍。跟这个应用里其它个人
// 偏好（播放速度、字幕缩放……）一样走 localStorage，不进服务端 config——
// 换浏览器会丢，但实现成本低很多，这类个人速查条件本来也不需要跨设备同步。
const LIBRARY_SEARCH_PRESETS_KEY = 'copymanga.librarySearchPresets'
const LIBRARY_SEARCH_PRESETS_MAX = 50

function loadLibrarySearchPresets() {
  try {
    const list = JSON.parse(localStorage.getItem(LIBRARY_SEARCH_PRESETS_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function saveLibrarySearchPresets(list) {
  localStorage.setItem(LIBRARY_SEARCH_PRESETS_KEY, JSON.stringify(list))
}

function renderLibrarySearchPresetOptions() {
  const select = els.librarySearchPresetSelect
  if (!select) return
  const current = select.value
  select.innerHTML = '<option value="">选择预设…</option>'
  for (const preset of loadLibrarySearchPresets()) {
    const option = document.createElement('option')
    option.value = preset.name
    option.textContent = preset.name
    select.append(option)
  }
  select.value = [...select.options].some((o) => o.value === current) ? current : ''
}

// 读「现在界面上」这 6 项的值，保存时用。
function currentLibrarySearchPresetFields() {
  return {
    tagSearch: els.libraryTagSearch?.value || '',
    type: els.libraryType?.value || 'all',
    sourceProfile: els.librarySourceProfile?.value || '',
    seriesSubtitle: els.librarySeriesSubtitle?.value || 'any',
    sort: els.librarySort?.value || 'imported_desc',
    limit: els.libraryLimit?.value || '20',
  }
}

// 把预设的 6 项值填回界面控件——只填值，不管 select 里有没有这个 option
// （比如导入方案预设保存之后又被删了），填不进去的保持控件原来的值，不报错。
function applyLibrarySearchPresetFields(fields) {
  if (els.libraryTagSearch) els.libraryTagSearch.value = fields.tagSearch || ''
  const trySet = (select, value) => {
    if (!select || value === undefined) return
    if ([...select.options].some((o) => o.value === value)) select.value = value
  }
  trySet(els.libraryType, fields.type)
  trySet(els.librarySourceProfile, fields.sourceProfile)
  trySet(els.librarySeriesSubtitle, fields.seriesSubtitle)
  trySet(els.librarySort, fields.sort)
  trySet(els.libraryLimit, fields.limit)
}

// —— 合并 ——
// 候选来自索引缓存里的 workGroups（workKey 相同且 >=2）。进页面只读内存里的那份，
// 不重建；脚本写完 workKey 之后得点「重建索引并刷新」，否则看到的还是旧分组。
let mergePage = 1
let mergeTotalPages = 1
let mergeKeyword = ''
// 每页条数原来是写死的常量，现在跟媒体库页一样给个下拉框选，20 是没选过时的默认值。
const mergeLimit = () => Math.max(1, Number(els.mergeLimit?.value || 20))
// 合并完不自动刷新（人工逐组确认的流程，列表在脚下变掉最烦），所以得自己记住
// 哪些组点过了，否则那张卡看上去和没合过一模一样。刷新即清空——它只是视觉标记，
// 不是事实来源，真相始终在重建后的索引里。
const mergedGroupKeys = new Map()
// 展开过哪几组 + 滚到哪儿。从成员卡片点进视频会切到媒体库，切回来时这一页是整个
// 重建的，不记这两样就永远落回「全部折叠的第一页」，刚看到哪组全白费。
// 按 workKey 记而不是按下标：翻页、搜索、合并之后下标早就不是同一组了。
const expandedGroupKeys = new Set()
let mergeScrollTop = 0

function rememberMergeScroll() {
  if (els.mergeGroups) mergeScrollTop = els.mergeGroups.scrollTop || 0
}

function restoreMergeScroll() {
  if (els.mergeGroups && mergeScrollTop) els.mergeGroups.scrollTop = mergeScrollTop
}

// 翻页、搜索、重建索引是「主动换了一批内容」，还原旧位置就成了跳到不相干的地方。
// 只有「切走再切回来」才该还原，所以这些入口要显式清掉。
function resetMergePosition() {
  expandedGroupKeys.clear()
  mergeScrollTop = 0
}

function mergeCandidatesQuery(page = mergePage) {
  const params = new URLSearchParams({ page: String(page), limit: String(mergeLimit()) })
  if (mergeKeyword) params.set('q', mergeKeyword)
  return `/api/library/merge-candidates?${params}`
}

// 从媒体库角标跳过来：只知道 workKey，不知道在第几页，交给服务端用 focus 算。
// 落地后自动展开那一组——跳过来就是为了看它，还要再点一下没道理。
async function jumpToMergeGroup(workKey) {
  if (!workKey) return
  showView('merge-view')
  resetMergePosition()
  mergeKeyword = ''
  if (els.mergeKeyword) els.mergeKeyword.value = ''
  const params = new URLSearchParams({ limit: String(mergeLimit()), focus: workKey })
  const data = await api(`/api/library/merge-candidates?${params}`)
  if (!data.focusFound) {
    // 索引没重建时媒体库和合并页会短暂不一致，这时候得说清楚，不能静默落到第 1 页
    alert(`合并页里找不到这一组（${workKey}）。可能索引还没重建，点「重建索引并刷新」再试。`)
  }
  mergePage = data.page || 1
  expandedGroupKeys.add(workKey)
  await loadMergeCandidates()
  refreshAnidbDumpStatus().catch(() => {})
  // 滚到那一组。展开是异步拉卡片的，等一帧让高度先撑开，否则滚不到位。
  requestAnimationFrame(() => {
    const card = [...document.querySelectorAll('.merge-group')]
      .find((node) => node.querySelector('.merge-group-key')?.textContent === workKey)
    card?.scrollIntoView({ block: 'start' })
  })
}

async function loadMergeCandidates() {
  if (!els.mergeGroups) return
  els.mergeGroups.textContent = '读取中...'
  try {
    const data = await api(mergeCandidatesQuery())
    const groups = data.items || []
    mergeTotalPages = Math.max(1, Math.ceil((data.total || 0) / mergeLimit()))
    if (els.mergePage && document.activeElement !== els.mergePage) {
      els.mergePage.value = String(mergePage)
    }
    if (els.mergePage) els.mergePage.max = String(mergeTotalPages)
    if (els.mergePageTotal) els.mergePageTotal.textContent = `/ ${mergeTotalPages} 页`
    if (els.mergePageInfo) {
      els.mergePageInfo.textContent = `共 ${data.total || 0} 组`
        + (mergeKeyword ? `（搜索 "${mergeKeyword}"）` : '')
        + (data.indexStatus !== 'ready' ? `（索引 ${data.indexStatus}）` : '')
    }
    renderMergeIndexHint(data)
    if (els.mergePrev) els.mergePrev.disabled = mergePage <= 1
    if (els.mergeNext) els.mergeNext.disabled = mergePage >= mergeTotalPages
    if (els.mergeRunPage) els.mergeRunPage.disabled = !groups.length
    renderMergeGroups(groups)
  } catch (error) {
    els.mergeGroups.textContent = `读取失败：${error.message}`
  }
}

// 索引被标脏之后 status 仍然是 'ready'，不单独提示的话，页面看起来一切正常，
// 实际显示的是重建之前的分组——「改完没生效」的困惑基本都出在这儿。
function renderMergeIndexHint(data) {
  if (!els.mergeIndexHint) return
  const stale = Boolean(data?.indexDirty)
  els.mergeIndexHint.hidden = !stale
  if (stale) {
    els.mergeIndexHint.textContent = '索引已过期：条目有变动但还没重建，下面是旧分组。'
      + '点右上角「重建索引并刷新」。'
  }
}

// 重建索引再读候选。进页面走的是纯内存读（约 0.6ms），重建是全盘扫描（31 条约 390ms），
// 所以只在手动点这个按钮时才付这份代价。
async function refreshMergeCandidates() {
  const button = els.mergeRefresh
  const original = button?.textContent
  if (button) { button.disabled = true; button.textContent = '重建中...' }
  try {
    let status = await api('/api/library/index/rebuild', { method: 'POST', body: '{}' })
    const startedAt = Date.now()
    while (status.status === 'building' && Date.now() - startedAt < 120000) {
      await sleep(1500)
      status = await api('/api/library/index/status')
    }
    libraryIndexStatus = status
    renderLibraryIndexStatus()
    mergedGroupKeys.clear()
    resetMergePosition()
    mergePage = 1
    await loadMergeCandidates()
  } finally {
    if (button) { button.disabled = false; button.textContent = original }
  }
}

function renderMergeGroups(groups) {
  els.mergeGroups.innerHTML = ''
  if (!groups.length) {
    els.mergeGroups.innerHTML = mergeKeyword
      ? `<p class="muted">没有标题含「${escapeHtml(mergeKeyword)}」的分组。</p>`
      : '<p class="muted">没有可合并的分组。候选来自索引缓存，'
        + '元数据脚本写完 workKey 之后需要先点「重建索引并刷新」。</p>'
    return
  }
  for (const group of groups) {
    els.mergeGroups.append(createMergeGroupCard(group))
  }
  // 卡片是展开时异步拉的，不等一帧的话此刻列表高度还没撑开，scrollTop 会被钳成 0
  requestAnimationFrame(restoreMergeScroll)
}

function createMergeGroupCard(group) {
  const card = document.createElement('article')
  card.className = 'card merge-group'
  const done = mergedGroupKeys.get(group.key)
  // 折叠行显示主条目标题而不是光秃秃的 workKey：anidb:16913 这种 key 根本认不出
  // 是哪部作品，只剩它的话每组都得点开才知道是什么，等于没有折叠态。
  const primary = group.members[0] || {}
  card.innerHTML = `
      <div class="merge-group-head">
        <button class="merge-group-toggle" type="button" aria-expanded="false">
          <span class="merge-group-caret" aria-hidden="true"></span>
          <span>
            <span class="merge-group-name" title="${escapeHtml(primary.title || '')}">${escapeHtml(primary.title || group.key)}</span>
            <span class="muted"><span class="merge-group-key">${escapeHtml(group.key)}</span> · ${group.count} 个条目 · 合并后 ${group.unitTotal} 单元</span>
          </span>
        </button>
        <span class="merge-group-done" ${done ? '' : 'hidden'}>${escapeHtml(done || '')}</span>
        <button class="merge-group-run" type="button" ${done ? 'disabled' : ''}>${done ? '已合并' : '合并这组'}</button>
      </div>
      <div class="merge-group-cards" hidden></div>`

  const toggle = card.querySelector('.merge-group-toggle')
  const cards = card.querySelector('.merge-group-cards')
  let loaded = false
  async function setOpen(open) {
    cards.hidden = !open
    // 三角的朝向由 CSS 按 aria-expanded 画，这里只负责把状态说清楚
    toggle.setAttribute('aria-expanded', String(open))
    // 记住展开的是哪一组：从卡片点进视频会切到媒体库，切回来时整页重建，
    // 不记就永远落回「全部折叠的第一页」。
    if (open) expandedGroupKeys.add(group.key)
    else expandedGroupKeys.delete(group.key)
    // 候选里的成员记录没有 tags（只有 type/itemId/title/cover/unitCount 这些），
    // 渲染卡片要完整 item，所以展开时才拉——不展开就一个请求都不发。
    if (!open || loaded) return
    loaded = true
    cards.textContent = '读取中...'
    try {
      cards.innerHTML = ''
      cards.append(...await loadMergeMemberCards(group))
    } catch (error) {
      loaded = false
      cards.textContent = `读取失败：${error.message}`
    }
  }
  toggle.addEventListener('click', () => { setOpen(cards.hidden).catch(() => {}) })
  if (expandedGroupKeys.has(group.key)) setOpen(true).catch(() => {})

  card.querySelector('.merge-group-run').addEventListener('click', async (event) => {
    const button = event.currentTarget
    button.disabled = true
    button.textContent = '合并中...'
    try {
      const result = await runMergeGroup(group)
      markMergeGroupDone(card, group, result)
    } catch (error) {
      alert(`合并失败：${error.message}`)
      button.disabled = false
      button.textContent = '合并这组'
    }
  })
  return card
}

// 合并成功只就地标一下，不自动刷新也不移除卡片——逐组人工确认的流程里，
// 列表在脚下重排比留着一张旧卡更难受。真实状态要等你自己点刷新。
function markMergeGroupDone(card, group, result) {
  const moved = (result?.merged || []).length
  const label = `已合并 ${moved} 项，刷新后消失`
  mergedGroupKeys.set(group.key, label)
  const done = card.querySelector('.merge-group-done')
  done.hidden = false
  done.textContent = label
  const button = card.querySelector('.merge-group-run')
  button.disabled = true
  button.textContent = '已合并'
  card.classList.add('merged')
}

async function loadMergeMemberCards(group) {
  const items = await Promise.all(group.members.map(async (member) => {
    const type = member.type || group.members[0]?.type || 'media'
    const item = await api(`/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(member.itemId)}`)
    return { ...item, type: item.type || type }
  }))
  return items.map((item, index) => {
    // 系列红点在这儿没意义：一个分组本来就是同一部作品，再挂一次只会干扰判断。
    const node = createLibraryCard(item, { seriesBadges: false })
    node.classList.add('merge-member-card')
    if (index === 0) node.classList.add('merge-member-primary')
    // createLibraryCard 的点击目标是媒体库视图的面板，停在合并页点下去会写进
    // 一个看不见的 DOM。捕获阶段先把视图切过去，再让它原来的处理器跑。
    // 顺便记下滚动位置——这一跳正是「回来时找不到刚才那组」的起点。
    node.addEventListener('click', () => {
      rememberMergeScroll()
      showView('library-view')
    }, { capture: true })
    return node
  })
}

async function runMergeGroup(group) {
  const sourceItemIds = group.members.slice(1).map((m) => m.itemId)
  if (!sourceItemIds.length) return null
  const type = group.members[0].type || 'media'
  const result = await api('/api/library/merge', {
    method: 'POST',
    body: JSON.stringify({ type, targetItemId: group.targetItemId, sourceItemIds }),
  })
  // 合并本身不保留源条目的 tag（见合并页面自己的提示文案），这里给个补救：
  // 勾了脚本就对合并后的条目重跑一遍，跟库存那边"执行全量"是同一个接口。
  // 不 await——这个接口是扔进后台队列就返回，不是跑完脚本才返回；"合并当前页
  // 全部"是逐组 await runMergeGroup 的循环，这里要是 await 到脚本跑完，等于
  // 把本该并行的脚本执行硬串成了合并一组等一组，没必要也没理由这么慢。
  const actionIds = checkedTagScriptIds('merge-tag-script')
  if (actionIds.length && result?.item?.itemId) {
    api(`/api/library/items/${encodeURIComponent(type)}/${encodeURIComponent(result.item.itemId)}/metadata-actions`, {
      method: 'POST',
      body: JSON.stringify({ actionIds, force: true }),
    }).catch(() => {})
  }
  return result
}

async function refreshAnidbDumpStatus() {
  if (!els.mergeDumpStatus) return
  try {
    const d = await api('/api/anidb/dump')
    els.mergeDumpStatus.textContent = d.exists
      ? `dump：${d.animeCount || '?'} 部 · ${(d.size / 1048576).toFixed(1)} MB · 更新于 ${String(d.mtime).slice(0, 19).replace('T', ' ')}`
      : `dump 还没下载（目录 ${d.dir}）`
  } catch (error) {
    els.mergeDumpStatus.textContent = `dump 状态读取失败：${error.message}`
  }
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
    els.libraryItems.append(createLibraryCard(item))
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

function jumpMergePage() {
  mergePage = Math.max(1, Math.min(mergeTotalPages, Math.floor(Number(els.mergePage?.value || 1))))
  resetMergePosition()
  loadMergeCandidates().catch((error) => alert(error.message))
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
        <span class="chapter-title-row">
          <span class="chapter-title" title="${escapeHtml(row.title)}">${escapeHtml(unit.title)}</span>
          ${renderUnitMediaInfo(unit.tags || [])}
        </span>
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
      if (shouldOpenMediaInNewTab(event) && currentLibraryItem) {
        openMediaRouteInNewTab({ type: currentLibraryItem.type, itemId: currentLibraryItem.itemId, unitId: unit.unitId })
        return
      }
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

// 入口外壳：决定在哪打开。必须在任何 await 之前就 window.open，否则会被当成弹窗拦截。
async function continueLibraryItem(itemOrHistory, event) {
  if (shouldOpenMediaInNewTab(event)) {
    openMediaRouteInNewTab({ type: itemOrHistory.type, itemId: itemOrHistory.itemId })
    return
  }
  return resumeLibraryItem(itemOrHistory.type, itemOrHistory.itemId)
}

// 在当前标签页里按历史记录续读。新标签页启动时（URL 里没带章节）也走这里，
// 所以续读的位置和"点继续"完全一致。
async function resumeLibraryItem(type, itemId) {
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
    card.querySelector('.history-continue')?.addEventListener('click', (event) => continueLibraryItem(history, event).catch((error) => alert(error.message)))
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
    currentMediaRoute = null
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
    // 记下这个阅读器对应的路由，并把 URL 同步过去：刷新能回到同一章，链接能直接发给别的标签页。
    // 后台续播（自动连播）也更新路由，但只有媒体浏览是当前视图时才会真的写进 URL。
    currentMediaRoute = { type: owner.type, itemId: owner.itemId, unitId, sectionId: reader.section?.sectionId || sectionId || '' }
    els.mediaReaderTitle.textContent = reader.section?.title || reader.unit?.title || unitId
    els.mediaReaderPrev.disabled = !reader.navigation?.prev
    els.mediaReaderNext.disabled = !reader.navigation?.next
    renderMediaSectionSelect(reader)
    renderMediaReader(reader, options)
    syncMediaHash()
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
    syncMediaHash()   // 路由已经清空，把 URL 上残留的旧章节也清掉，免得刷新又拽回去
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
  // 上一章的分批批次到这里就作废了，不然它的兜底定时器会继续往信息栏写字
  retireImageBatch(galleryBatch)
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
  // 「默认沉浸」：音视频在 renderStreamMedia 里自己处理（它要等播放器建好），
  // 这里只管阅读类。内容已经同步渲染完了，所以能直接进。
  if (reader.type === 'html' && !epubImmersive && immersivePref('html')) enterEpubImmersive()
  if (reader.type === 'images' && !galleryImmersive && immersivePref('images')) {
    enterGalleryImmersive(galleryImmersiveOptions(false))
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

// EPUB 封面常写成 <svg width="100%" ...><image/></svg>。这种 svg 没有固有尺寸，
// max-width:100% 把它撑满容器宽、max-height 又独立压高度，两边互不相关，比例必垮
// （实测竖版封面 400x900 被拉成 1506x650，形变 +421%）。
// 只要把 svg 盒子的比例修对就够了：内层 <image> 本来就守规矩，盒子比例对了之后
// 即使写着 preserveAspectRatio="none"，那个拉伸也成了恒等变换，不必改写作者属性。
function normalizeEpubGraphics(root) {
  const absolute = (value) => /^\d+(\.\d+)?(px)?$/.test(String(value || '').trim())
  for (const svg of root.querySelectorAll('svg')) {
    if (svg.style.aspectRatio) continue
    // 自带绝对尺寸的 svg 本来就不会垮，别去动它（动了反而会缩小）
    if (absolute(svg.getAttribute('width')) && absolute(svg.getAttribute('height'))) continue
    let w = 0
    let h = 0
    const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
    if (box.length === 4 && box[2] > 0 && box[3] > 0) {
      w = box[2]
      h = box[3]
    } else {
      // 没有 viewBox 时退而求其次，用内层图片自己声明的尺寸
      const inner = svg.querySelector('image')
      w = Number(inner?.getAttribute('width')) || 0
      h = Number(inner?.getAttribute('height')) || 0
    }
    if (w <= 0 || h <= 0) continue
    svg.style.aspectRatio = `${w} / ${h}`
    // 只有 aspect-ratio 不够：width="100%" 给了确定宽、max-height 给了确定高，
    // 两边都确定时 aspect-ratio 会被架空。width:auto 让宽度由高度反推出来。
    svg.style.width = 'auto'
  }
}

// EPUB 朗读分句在服务端做（web/library/epub-tts-sentences.mjs），阅读器接口返回的 html 里
// 每句已经包好 <span class="epub-tts-sentence" data-tts-index>，reader.sentences 是句子文本。
// 前端只负责把 span 收集起来：一句话横跨 <b>/<ruby> 等元素边界时会有多个同序号的 span。
// 朗读预生成脚本用的是同一份分句结果，所以这里绝不能再自己切——切法一变缓存就对不上。
function epubTtsBatchMaxChars() {
  return Math.max(20, Number(appConfig?.epubTtsBatchMaxChars) || 200)
}

function bindEpubTtsSentences(root, sentences) {
  const byIndex = new Map()
  for (const el of root.querySelectorAll('.epub-tts-sentence[data-tts-index]')) {
    const index = Number(el.dataset.ttsIndex)
    const list = byIndex.get(index) || []
    list.push(el)
    byIndex.set(index, list)
  }
  const bound = []
  for (const sentence of Array.isArray(sentences) ? sentences : []) {
    const elements = byIndex.get(sentence.index)
    if (!elements?.length) continue
    // index 要等于数组下标：播放循环和预加载泵都拿它当下标用
    bound.push({ text: sentence.text, index: bound.length, element: elements[0], elements })
  }
  return bound
}

// 一句话的多个 span 按各自文字长度分摊进度：整句进度 40% 就是前面的 span 满、后面的 span 空，
// 而不是每个 span 都各自填 40%
function setEpubTtsProgress(entry, ratio) {
  const total = entry.elements.reduce((sum, el) => sum + el.textContent.length, 0) || 1
  let done = 0
  for (const el of entry.elements) {
    const length = el.textContent.length || 1
    const local = Math.max(0, Math.min(1, (ratio * total - done) / length))
    el.style.setProperty('--tts-progress', `${Math.round(local * 100)}%`)
    done += length
  }
}

function renderMediaHtml(reader) {
  exitWidthAdjust({ apply: false })   // 换章节时参考线不能留着
  exitGalleryImmersive()              // 图集的沉浸态在 epub 上没有意义
  // 朗读跨章节续播靠 epubTtsAutoResume 这个信号：读到本章末尾时 playEpubTtsFrom
  // 会先把它置 true 再触发翻章，这里读到信号就跳过"停"，换完章节直接接着播，
  // 不然每次翻页都会被下面这行 stopEpubTts() 打断，朗读到章节末尾就断掉了。
  const resumeTts = epubTtsAutoResume
  stopEpubTts()
  epubTtsAutoResume = false
  const themeClass = applyMediaReaderTheme()
  els.mediaReaderContent.className = `media-reader-content media-html ${themeClass}`
  const pages = document.createElement('div')
  pages.className = 'media-html-pages'
  pages.innerHTML = reader.content || ''
  normalizeEpubGraphics(pages)
  epubTtsSentences = bindEpubTtsSentences(pages, reader.sentences)
  els.mediaReaderContent.replaceChildren(pages)
  requestAnimationFrame(() => {
    layoutMediaPages()
    const ratio = reader.section?.sectionId === currentLibraryProgress?.lastSectionId ? currentLibraryProgress.lastScrollRatio : 0
    setMediaPage(Math.round(ratio * Math.max(mediaPageCount - 1, 0)), { save: false })
    // 沉浸态下换章不会重建控制条，页码/目录/上下章状态得在这里补一刀
    syncEpubImmersive()
    if (resumeTts && epubTtsSentences.length) playEpubTtsFrom(0, els.mediaReaderContent).catch(() => {})
  })
}

function renderMediaImages(reader) {
  exitEpubImmersive()   // epub 的分页沉浸态在图集上没有意义
  const themeClass = applyMediaReaderTheme()
  els.mediaReaderContent.className = `media-reader-content media-images ${themeClass}`
  galleryBatch = null
  if (!reader.images?.length) {
    els.mediaReaderContent.className = 'media-reader-content empty-panel'
    els.mediaReaderContent.textContent = '没有图片资源'
  } else {
    const list = document.createElement('div')
    list.className = 'media-image-list'
    els.mediaReaderContent.replaceChildren(list)
    const prefix = `${reader.item?.title || currentLibraryItem?.title || ''} · ${Number(reader.unit?.index || 0) + 1}/${currentLibraryUnits.length}`
    galleryBatch = createImageBatch({
      container: list,
      onMeta: (rendered, total) => {
        els.mediaReaderMeta.textContent = `${prefix} · ${rendered}/${total} 张图`
      },
      altFor: (image, index) => image.title || `${reader.unit?.title || '图片'} ${Number(image.index ?? index) + 1}`,
    })
    galleryBatch.images = reader.images
    appendImageBatch(galleryBatch)
    // 沉浸态下切章是异步重渲染的，控制条上的章节信息要跟着走
    syncGalleryImmersive()
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
  // x/y 为 null 表示「没拖过，用默认位置」。不能直接 Number()——Number(null) 是 0
  // 而且 isFinite，会被钳成 4，于是光调字号也把字幕钉到左上角。
  const toPercent = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? Math.max(4, Math.min(96, n)) : null
  }
  return {
    scale,
    x: toPercent(value.x),
    y: toPercent(value.y),
  }
}

// 字幕的参照物应该是「画面」而不是 frame：frame 常有黑边（普通态
// 1280x546 的 frame 里画面只有 971x546），同一个百分比落在画面上的
// 位置会随黑边宽度变化，全屏后字幕就横向漂了。
function subtitlePictureBox(frame, media) {
  const rect = frame?.getBoundingClientRect()
  if (!rect?.width || !rect?.height) return null
  const ar = (media?.videoWidth || 0) / (media?.videoHeight || 0)
  if (!Number.isFinite(ar) || ar <= 0) return { left: 0, top: 0, width: rect.width, height: rect.height }
  const wide = rect.width / rect.height > ar
  const width = wide ? rect.height * ar : rect.width
  const height = wide ? rect.height : rect.width / ar
  return { left: (rect.width - width) / 2, top: (rect.height - height) / 2, width, height }
}

// 24px 是按原先普通态画面高 546px 定的，折合 4.4%；换算成比例后
// 字号才会跟着画面一起放大，否则全屏时相对画面会小掉约 39%。
const SUBTITLE_HEIGHT_RATIO = 24 / 546

function applySubtitleOverlaySettings(overlay, settings = loadSubtitleOverlaySettings(), box = null) {
  const next = normalizeSubtitleOverlaySettings(settings)
  overlay.style.setProperty('--subtitle-scale', String(next.scale))
  if (box) overlay.style.setProperty('--subtitle-base', `${box.height * SUBTITLE_HEIGHT_RATIO}px`)
  if (next.x !== null && next.y !== null) {
    // 有画面盒就按画面定位（px），否则退回相对 frame 的百分比（VR 走这条）
    overlay.style.left = box ? `${box.left + (box.width * next.x) / 100}px` : `${next.x}%`
    overlay.style.top = box ? `${box.top + (box.height * next.y) / 100}px` : `${next.y}%`
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

function makeSubtitleOverlayInteractive(overlay, frame, getBox = null) {
  const box = () => (getBox ? getBox() : null)
  let settings = applySubtitleOverlaySettings(overlay, loadSubtitleOverlaySettings(), box())
  let dragging = false
  let pointerId = null
  const moveTo = (clientX, clientY) => {
    const rect = frame.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // 拖拽的落点也要换算成画面坐标，否则存进去的百分比和回放时的参照物不一致
    const pic = box()
    const originX = rect.left + (pic ? pic.left : 0)
    const originY = rect.top + (pic ? pic.top : 0)
    const spanX = pic ? pic.width : rect.width
    const spanY = pic ? pic.height : rect.height
    if (!spanX || !spanY) return
    settings = normalizeSubtitleOverlaySettings({
      ...settings,
      x: ((clientX - originX) / spanX) * 100,
      y: ((clientY - originY) / spanY) * 100,
    })
    applySubtitleOverlaySettings(overlay, settings, box())
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
    applySubtitleOverlaySettings(overlay, settings, box())
  }, { passive: false })
  // 画面尺寸变了（进出沉浸、窗口缩放、视频元数据到位）就重算一次，
  // 位置和字号都是按画面比例存的，不重算会停在旧尺寸上
  return () => applySubtitleOverlaySettings(overlay, settings, box())
}

function renderStreamMedia(reader, options = {}) {
  exitReaderImmersive()   // 从 epub/图集 切到音视频时，阅读的沉浸状态必须先收干净
  // 切章会整个重建播放器，而 currentStreamCleanup 里要清沉浸类（那是给
  // 「离开播放器」准备的）。沉浸是当前的观看模式，不该被重建顺带清掉，
  // 先记下来，新播放器建好后恢复。
  const wasImmersive = els.mediaViewerView.classList.contains('stream-page-fullscreen')
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
  const syncSubtitleLayout = makeSubtitleOverlayInteractive(subtitleOverlay, frame,
    () => subtitlePictureBox(frame, player))
  // frame 尺寸一变（进出沉浸、窗口缩放）就重算字幕的位置和字号
  const subtitleResizeObserver = new ResizeObserver(() => syncSubtitleLayout())
  subtitleResizeObserver.observe(frame)
  // 元数据到位前拿不到 videoWidth，算不出画面盒，到位后补一次
  player.addEventListener('loadedmetadata', () => syncSubtitleLayout())
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
  // 快进快退秒数——鼠标后退/前进键（见全局 mousedown 路由）专用，日常用不到
  // 放进"更多"面板，跟倍速/字幕放一块。跟音量/倍速一样走 localStorage，不是
  // 服务端配置：这个面板里其它几个设置全是这个套路，没必要为这一个新开一套。
  const seekSecondsLabel = document.createElement('label')
  seekSecondsLabel.className = 'stream-seek-seconds-label'
  seekSecondsLabel.textContent = '快进快退秒数'
  const seekSecondsInput = document.createElement('input')
  seekSecondsInput.type = 'number'
  seekSecondsInput.className = 'stream-seek-seconds'
  seekSecondsInput.min = '1'
  seekSecondsInput.max = '120'
  seekSecondsInput.step = '1'
  seekSecondsInput.value = localStorage.getItem('copymanga.mediaSeekSeconds') || '10'
  seekSecondsInput.title = '鼠标后退/前进键快进快退的秒数'
  seekSecondsInput.addEventListener('change', () => {
    const seconds = Math.max(1, Math.min(120, Math.round(Number(seekSecondsInput.value)) || 10))
    seekSecondsInput.value = String(seconds)
    localStorage.setItem('copymanga.mediaSeekSeconds', String(seconds))
  })
  seekSecondsLabel.append(seekSecondsInput)
  const seekIndicator = document.createElement('div')
  seekIndicator.className = 'stream-seek-indicator hidden'
  let seekIndicatorTimer = null
  // 跳过去的瞬间会触发 player 自己的 timeupdate，进度条（setProgress，下面定义）
  // 跟着联动更新，不用在这里手动再同步一遍。
  const seekBy = (deltaSeconds) => {
    if (!Number.isFinite(player.duration) || player.duration <= 0) return
    player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + deltaSeconds))
    seekIndicator.textContent = deltaSeconds > 0 ? `+${deltaSeconds}s ▶▶` : `◀◀ ${deltaSeconds}s`
    seekIndicator.classList.remove('hidden')
    clearTimeout(seekIndicatorTimer)
    seekIndicatorTimer = setTimeout(() => seekIndicator.classList.add('hidden'), 600)
  }
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
  // 页面全屏的开关逻辑挪到下面和「更多面板」「贴边唤出」一起管，三者要联动
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
  // 沉浸态会把页面头部整行压成 0（.stream-page-fullscreen > section 单行 +
  // .chapter-head display:none，都是既有规则），返回/上一章/下一章 就都够不着了。
  // 这里在控制条里补三个，行为一律委托给原来的按钮，不另起一套逻辑。
  const backBtn = document.createElement('button')
  backBtn.type = 'button'
  backBtn.className = 'stream-icon-button stream-back'
  backBtn.title = '退出全屏并返回'
  backBtn.textContent = '←'
  const prevChapter = document.createElement('button')
  prevChapter.type = 'button'
  prevChapter.className = 'stream-icon-button stream-chapter-prev'
  prevChapter.title = '上一章'
  // ⏮/⏭ 实测会渲染成缺字形方框，改用中文文本（和同条里的 音/字±/重播/连播 一致）
  prevChapter.textContent = '上章'
  prevChapter.disabled = !reader.navigation?.prev
  const nextChapter = document.createElement('button')
  nextChapter.type = 'button'
  nextChapter.className = 'stream-icon-button stream-chapter-next'
  nextChapter.title = '下一章'
  nextChapter.textContent = '下章'
  nextChapter.disabled = !reader.navigation?.next
  prevChapter.addEventListener('click', () => els.mediaReaderPrev?.click())
  nextChapter.addEventListener('click', () => els.mediaReaderNext?.click())

  // 「更多」面板：日常观看用不到的控件收进来，否则 15 个控件会折成两行、
  // 浮在画面上要占掉 20% 的高度。
  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'stream-icon-button stream-more'
  more.title = '更多设置'
  more.textContent = '⚙'
  const morePanel = document.createElement('div')
  morePanel.className = 'stream-more-panel hidden'
  morePanel.append(rateSelect, subtitleSelect, secondarySubtitleSelect, subtitleSmaller,
    subtitleLarger, loopToggle, nextToggle, seekSecondsLabel, vrControls.element, vrControls.presetNote)
  const setMoreOpen = (open) => {
    morePanel.classList.toggle('hidden', !open)
    more.classList.toggle('active', open)
    more.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
  setMoreOpen(false)
  more.addEventListener('click', (event) => {
    event.stopPropagation()
    setMoreOpen(morePanel.classList.contains('hidden'))
  })

  // 全屏下 .chapter-head 整个被 display:none（既有规则），标题和 meta 一起没了，
  // 而控制条里原本没有任何文字元素——音频播放时屏幕上根本不知道在放哪一首。
  // 放进 controls 而不是新建浮层：它跟着控制条一起淡入淡出，不用另写一套显隐；
  // controls 是 flex-wrap，flex-basis:100% 会让它自己占一行，不挤进度条。
  const titleInfo = document.createElement('div')
  titleInfo.className = 'stream-title-info'
  const unitTitle = reader.section?.title || reader.unit?.title || ''
  const posText = currentLibraryUnits.length
    ? `${Number(reader.unit?.index || 0) + 1}/${currentLibraryUnits.length}`
    : ''
  titleInfo.textContent = [unitTitle, posText].filter(Boolean).join(' · ')
  // 长标题截断后鼠标悬停能看全文，顺带把合集名也带上
  titleInfo.title = [reader.item?.title || currentLibraryItem?.title || '', unitTitle, posText]
    .filter(Boolean).join('\n')
  titleInfo.hidden = !titleInfo.textContent

  const controls = document.createElement('div')
  controls.className = 'stream-extra-controls'
  controls.append(titleInfo, backBtn, prevChapter, play, nextChapter, currentTime, progress, duration,
    mute, volume, vrControls.presetElement, more, fullscreen)

  // —— 页面全屏下的「贴边唤出」——
  // 鼠标贴近上/下边缘才显示顶栏和控制条，移开后延时收起。
  const EDGE = 72
  const HIDE_DELAY = 2400
  let chromeTimer = null
  const inFullscreen = () => els.mediaViewerView.classList.contains('stream-page-fullscreen')
  // 这些情况下不能收起，否则会打断正在进行的操作。
  // 焦点只认 select：原生下拉展开时焦点在它身上，收起会直接关掉下拉；
  // 而按钮点完焦点也会留在上面，若一并算作「占用」，点一次 ⛶ 之后
  // 控制条就再也不会自动隐藏了。
  const chromeHeld = () => !morePanel.classList.contains('hidden')
    || document.activeElement?.tagName === 'SELECT'
    || controls.matches(':hover')
    || morePanel.matches(':hover')
  const setChromeVisible = (visible) => els.app.classList.toggle('stream-chrome-visible', visible)
  const scheduleHide = () => {
    clearTimeout(chromeTimer)
    chromeTimer = setTimeout(() => {
      if (chromeHeld()) { scheduleHide(); return }
      setChromeVisible(false)
    }, HIDE_DELAY)
  }
  const revealChrome = () => {
    setChromeVisible(true)
    scheduleHide()
  }
  const onPointerMove = (event) => {
    if (!inFullscreen()) return
    const nearEdge = event.clientY <= EDGE || event.clientY >= window.innerHeight - EDGE
    if (nearEdge) revealChrome()
  }
  // 触屏没有 hover，点画面即切换显隐
  const onFrameTap = () => {
    if (!inFullscreen()) return
    if (els.app.classList.contains('stream-chrome-visible')) setChromeVisible(false)
    else revealChrome()
  }
  document.addEventListener('mousemove', onPointerMove)

  const setImmersive = (active, { remember = false } = {}) => {
    els.mediaViewerView.classList.toggle('stream-page-fullscreen', active)
    // 顶栏在 .media-viewer-view 外面（挂在 .content 下），只能靠 #app 上的类去管
    els.app.classList.toggle('stream-immersive', active)
    fullscreen.classList.toggle('active', active)
    els.mediaImmersive?.classList.toggle('active', active)
    fullscreen.title = active ? '退出页面全屏' : '页面全屏'
    if (remember) saveImmersivePref(reader.type, active)
    clearTimeout(chromeTimer)
    if (active) revealChrome()
    else { setChromeVisible(false); setMoreOpen(false) }
  }
  // 头部的「沉浸」按钮和播放器里的 ⛶ 是同一个开关，统一入口
  currentStreamImmersiveToggle = (active) => setImmersive(active, { remember: true })
  fullscreen.addEventListener('click', () => setImmersive(!inFullscreen(), { remember: true }))
  // 返回 = 退出全屏 + 回上一个视图。顺序不能反：showView 之后再清沉浸类，
  // 媒体库页会短暂地顶着 fixed 顶栏和满屏类渲染一帧。
  backBtn.addEventListener('click', () => {
    setImmersive(false)
    els.mediaReaderBack?.click()
  })
  // 沉浸态下「返回」按钮在 chapter-head 里被隐藏了，没有 Esc 就只能靠
  // 自动隐藏的 ⛶ 退出，手感很差
  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || !inFullscreen()) return
    if (!morePanel.classList.contains('hidden')) { setMoreOpen(false); return }
    setImmersive(false, { remember: true })
  }
  document.addEventListener('keydown', onKeyDown)
  controls.addEventListener('click', (event) => event.stopPropagation())
  morePanel.addEventListener('click', (event) => event.stopPropagation())
  // 点画面：面板开着就先关面板（不误触播放/暂停），否则走显隐切换
  frame.addEventListener('click', () => {
    if (!morePanel.classList.contains('hidden')) { setMoreOpen(false); return }
    onFrameTap()
  })
  if (reader.type === 'video') {
    player.addEventListener('dblclick', () => setImmersive(!inFullscreen()))
  }

  frame.append(player, subtitleOverlay, seekIndicator, morePanel, controls)
  shell.append(title, frame, playbackWarning, meta)
  els.mediaReaderContent.replaceChildren(shell)
  // 只在播放视图仍然在前台时恢复：后台续播（用户已经切去媒体库）时
  // 强行加沉浸类会让库页顶着满屏样式和 fixed 顶栏渲染。
  // wasImmersive 管切章保状态，immersivePref 管「默认沉浸」的首次进入。
  const inForeground = els.mediaViewerView.classList.contains('active')
  if ((wasImmersive || immersivePref(reader.type)) && inForeground) setImmersive(true)
  setTimeout(attemptAutoPlay, 0)
  currentStreamSeekBy = seekBy
  currentStreamCleanup = () => {
    document.removeEventListener('mousemove', onPointerMove)
    document.removeEventListener('keydown', onKeyDown)
    subtitleResizeObserver.disconnect()
    clearTimeout(chromeTimer)
    clearTimeout(seekIndicatorTimer)
    currentStreamImmersiveToggle = null
    currentStreamSeekBy = null
    els.mediaViewerView.classList.remove('stream-page-fullscreen')
    els.app.classList.remove('stream-immersive', 'stream-chrome-visible')
    els.mediaImmersive?.classList.remove('active')
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

  // —— 预设 ——
  // 片源格式不止一种（180左右 / 360单画面 / 鱼眼…），每换一种要动 3~4 个控件，
  // 单个持久化槽位只记得最后一次。所以存具名预设，主控制条上一个下拉直接切。
  // 「关闭 3D」只改投影：实测另外 4 项与开关无关（setActive 只看 projection），
  // 不动它们才能在切回预设前保住手动微调过的值。
  const OFF = '__off__'
  const CUSTOM = '__custom__'
  const sameState = (a, b) => !!a && !!b && ['projection', 'layout', 'eye', 'mirrorX', 'flipY']
    .every((key) => a[key] === b[key])
  const presetSelect = document.createElement('select')
  presetSelect.className = 'stream-vr-preset'
  presetSelect.title = '3D 预设'
  presetSelect.hidden = !visible
  const presetNote = document.createElement('span')
  presetNote.className = 'stream-vr-preset-note'

  const nameInput = document.createElement('input')
  nameInput.className = 'stream-vr-preset-name'
  nameInput.placeholder = '预设名称'
  const noteInput = document.createElement('input')
  noteInput.className = 'stream-vr-preset-desc'
  noteInput.placeholder = '什么场景用（可空）'
  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.className = 'stream-toggle stream-vr-preset-save'
  saveBtn.textContent = '存为预设'
  const deleteBtn = document.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.className = 'stream-toggle stream-vr-preset-delete'
  deleteBtn.textContent = '删除'
  const presetForm = document.createElement('span')
  presetForm.className = 'stream-vr-preset-form'
  presetForm.append(nameInput, noteInput, saveBtn, deleteBtn)
  wrap.append(presetForm)

  const loadPresets = () => {
    try {
      const list = JSON.parse(localStorage.getItem('copymanga.mediaVrPresets') || '[]')
      return Array.isArray(list) ? list.filter((item) => item && item.name && item.state) : []
    } catch {
      return []
    }
  }
  const savePresets = (list) => {
    localStorage.setItem('copymanga.mediaVrPresets', JSON.stringify(list))
  }
  const renderPresets = () => {
    const list = loadPresets()
    const current = value()
    const match = list.find((item) => sameState(item.state, current))
    presetSelect.innerHTML = ''
    const add = (optionValue, label, title) => {
      const option = document.createElement('option')
      option.value = optionValue
      option.textContent = label
      if (title) option.title = title
      presetSelect.append(option)
      return option
    }
    add(OFF, '关闭 3D', '只把投影切成普通，其余设置原样保留')
    for (const item of list) add(item.name, item.name, item.note || '')
    // 当前状态不属于任何预设时才给个「自定义」占位，否则下拉里一直挂个没用的项
    const isOff = current.projection === 'off'
    if (!match && !isOff) add(CUSTOM, '自定义', '当前设置还没存成预设')
    presetSelect.value = isOff ? OFF : (match ? match.name : CUSTOM)
    const active = list.find((item) => item.name === presetSelect.value)
    presetNote.textContent = active?.note || ''
    presetNote.hidden = !active?.note
    deleteBtn.disabled = !active
    if (active) {
      nameInput.value = active.name
      noteInput.value = active.note || ''
    }
  }

  const save = () => {
    const state = value()
    localStorage.setItem('copymanga.mediaVrProjection', state.projection)
    localStorage.setItem('copymanga.mediaVrLayout', state.layout)
    localStorage.setItem('copymanga.mediaVrEye', state.eye)
    localStorage.setItem('copymanga.mediaVrMirrorX', state.mirrorX ? '1' : '0')
    localStorage.setItem('copymanga.mediaVrFlipY', state.flipY ? '1' : '0')
  }
  // 先渲染一次：onChange 只有视频路径会接，不能把首次填充依赖在它身上
  renderPresets()
  return {
    element: wrap,
    presetElement: presetSelect,
    presetNote,
    presetSelect,
    nameInput,
    noteInput,
    saveBtn,
    deleteBtn,
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
        renderPresets()
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
      const applyState = (state) => {
        projection.value = state.projection
        layout.value = state.layout
        eye.value = state.eye
        setPressed(mirror, state.mirrorX)
        setPressed(flipY, state.flipY)
      }
      presetSelect.addEventListener('change', () => {
        const picked = presetSelect.value
        if (picked === CUSTOM) return
        if (picked === OFF) projection.value = 'off'
        else {
          const hit = loadPresets().find((item) => item.name === picked)
          if (!hit) return
          applyState(hit.state)
        }
        emit()
      })
      saveBtn.addEventListener('click', () => {
        const name = nameInput.value.trim()
        if (!name) { nameInput.focus(); return }
        // 预设名就是身份，重名直接覆盖——比默默存出两个同名项好懂
        const list = loadPresets().filter((item) => item.name !== name)
        list.push({ name, note: noteInput.value.trim(), state: value() })
        savePresets(list)
        renderPresets()
        presetSelect.value = name
        renderPresets()
      })
      deleteBtn.addEventListener('click', () => {
        const name = presetSelect.value
        if (name === OFF || name === CUSTOM) return
        savePresets(loadPresets().filter((item) => item.name !== name))
        nameInput.value = ''
        noteInput.value = ''
        renderPresets()
      })
      renderPresets()
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

// 阅读宽度存本地而不是服务端配置：这个值该跟屏幕走，
// 台式机和笔记本共用一个服务端值会互相打架。
const EPUB_WIDTH_KEY = 'copymanga.epubPageWidth'

function loadEpubPageWidth() {
  const raw = Number(localStorage.getItem(EPUB_WIDTH_KEY))
  return Number.isFinite(raw) && raw >= 320 ? raw : 0   // 0 = 不限制，铺满
}

function saveEpubPageWidth(width) {
  if (width > 0) localStorage.setItem(EPUB_WIDTH_KEY, String(Math.round(width)))
  else localStorage.removeItem(EPUB_WIDTH_KEY)
}

// 重排会让同一个页码指向不同内容。重排前记下视口左上角那个元素，
// 重排后滚回它所在的页，读者才不会"调个宽度就不知道跳哪去了"。
function mediaPageAnchor() {
  const content = els.mediaReaderContent
  const rect = content.getBoundingClientRect()
  for (let dy = 24; dy < Math.min(rect.height, 400); dy += 40) {
    for (let dx = 24; dx < Math.min(rect.width, 300); dx += 40) {
      const el = document.elementFromPoint(rect.left + dx, rect.top + dy)
      if (el && el !== content && content.contains(el)) return el
    }
  }
  return null
}

function restoreMediaPageAnchor(anchor) {
  if (!anchor || !anchor.isConnected) return false
  const content = els.mediaReaderContent
  // 锚点相对内容起点的横向偏移，换算成页码
  const offset = content.scrollLeft + (anchor.getBoundingClientRect().left - content.getBoundingClientRect().left)
  const page = Math.round(offset / Math.max(1, mediaPageStep))
  mediaPageIndex = Math.max(0, Math.min(page, mediaPageCount - 1))
  content.scrollLeft = mediaPageScrollLeft(mediaPageIndex)
  return true
}

function layoutMediaPages({ anchor = null } = {}) {
  const content = els.mediaReaderContent
  const pages = content.querySelector('.media-html-pages')
  if (!pages) return
  // 宽度必须量父容器：content 自己被 --media-page-width 驱动的 max-width 限制着，
  // 拿它量就是拿"上一轮的结果"当这一轮的输入，会一路自我收缩
  //（实测首次布局时 clientWidth 还是 0，算出 320 写死，之后再也回不到铺满）。
  const host = content.parentElement || content
  const frame = host.clientWidth
  // 视图还没布局出来（切到别的 tab、首帧）时先不算，等真正可见时会再调一次
  if (frame < 100) return
  const gap = Math.max(24, Math.min(48, Math.round(frame * 0.06)))
  const available = Math.max(320, frame - 56)
  const limit = loadEpubPageWidth()
  const pageWidth = limit > 0 ? Math.max(320, Math.min(limit, available)) : available
  // 左右留白：padding 加在多列元素上（内容盒仍是 pageWidth，所以栏宽和翻页步长不变），
  // 视口相应放宽到 pageWidth + 2*gutter。gutter 必须 <= gap，否则视口右边会
  // 多出 gutter-gap 的空间，把下一栏的开头露出来。
  const gutter = Math.min(28, gap)
  content.style.setProperty('--media-page-width', `${pageWidth}px`)
  content.style.setProperty('--media-page-gap', `${gap}px`)
  content.style.setProperty('--media-page-gutter', `${gutter}px`)
  content.style.setProperty('--media-page-port', `${pageWidth + gutter * 2}px`)
  pages.style.removeProperty('--media-page-width')
  pages.style.removeProperty('--media-page-gap')
  pages.style.removeProperty('--media-page-pad-x')
  mediaPageStep = pageWidth + gap
  mediaMaxScrollLeft = Math.max(0, content.scrollWidth - content.clientWidth)
  mediaPageCount = mediaMaxScrollLeft <= 0 ? 1 : Math.ceil(mediaMaxScrollLeft / mediaPageStep) + 1
  if (!restoreMediaPageAnchor(anchor)) {
    mediaPageIndex = Math.max(0, Math.min(mediaPageIndex, mediaPageCount - 1))
    content.scrollLeft = mediaPageScrollLeft(mediaPageIndex)
  }
  updateMediaPageControls()
}

// 沉浸态「上一章/下一章」的目标。EPUB 的书内章节是 section，unit 是「同一条目
// 里相邻的 epub 文件」—— 单文件 EPUB 的 navigation 恒为 null，只认它的话上下章
// 永远是灰的。优先级和 #media-page-next 保持一致：先 section，再 unit。
// 图集（stream-media）没有 sectionNavigation，自然退回 unit 级，行为不变。
function mediaStepTarget(direction) {
  const section = currentMediaReader?.sectionNavigation?.[direction]
  if (section && currentMediaReader?.unit?.unitId) {
    return () => openUnitInSession(currentMediaReader.unit.unitId, section.sectionId)
  }
  const unit = currentMediaReader?.navigation?.[direction]
  if (unit) return () => openUnitInSession(unit.unitId)
  return null
}

// 沉浸是阅读/观看的默认姿势，但必须记住用户的选择：硬性「每次都强制进沉浸」
// 会让人按了 Esc、翻到下一章又被塞回去，永远退不出来。
// 按内容类型分开记 —— 看视频想沉浸、翻 EPUB 想查目录，是合理组合。
const IMMERSIVE_PREF_KEY = 'copymanga.immersivePref'

function immersivePref(kind) {
  if (!kind) return false
  try {
    const all = JSON.parse(localStorage.getItem(IMMERSIVE_PREF_KEY) || '{}')
    return all[kind] !== false   // 没存过 = 开，这就是「默认沉浸」的初值
  } catch {
    return true
  }
}

function saveImmersivePref(kind, on) {
  if (!kind) return
  let all = {}
  try {
    all = JSON.parse(localStorage.getItem(IMMERSIVE_PREF_KEY) || '{}')
  } catch {
    all = {}
  }
  all[kind] = Boolean(on)
  localStorage.setItem(IMMERSIVE_PREF_KEY, JSON.stringify(all))
}

// 沉浸态下目录下拉的数据源，口径和 mediaStepTarget 一致：
// EPUB 用书内 section，媒体库图集/音视频用 unit。默认沉浸之后头部那个
// #media-section-select 一直是藏着的，不补这个就跳不了章。
function mediaTocEntries() {
  const reader = currentMediaReader
  if ((reader?.sections?.length || 0) > 1 && reader?.unit?.unitId) {
    return {
      current: reader.section?.sectionId || '',
      items: reader.sections.map((section) => ({ id: section.sectionId, title: `${section.index + 1}. ${section.title}` })),
      go: (id) => openUnitInSession(reader.unit.unitId, id),
    }
  }
  if (currentLibraryUnits.length > 1) {
    return {
      current: reader?.unit?.unitId || '',
      items: currentLibraryUnits.map((unit, index) => ({ id: unit.unitId, title: `${index + 1}. ${unit.title}` })),
      go: (id) => openUnitInSession(id),
    }
  }
  return null
}

function makeImmersiveToc() {
  const select = document.createElement('select')
  select.className = 'immersive-toc'
  select.title = '目录'
  select.addEventListener('change', () => {
    const toc = mediaTocEntries()
    if (toc && select.value) toc.go(select.value)
  })
  return select
}

function syncImmersiveToc(select) {
  const toc = mediaTocEntries()
  if (!toc) {
    select.hidden = true
    return
  }
  select.hidden = false
  // 只有条目真的变了才重建，不然每次 syncInfo 都会把展开的下拉关掉
  const signature = toc.items.map((item) => `${item.id} ${item.title}`).join('')
  if (select.dataset.signature !== signature) {
    select.dataset.signature = signature
    select.replaceChildren(...toc.items.map((item) => {
      const option = document.createElement('option')
      option.value = item.id
      option.textContent = item.title
      return option
    }))
  }
  select.value = toc.current
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

// 原来是 enterEpubImmersive 里的局部闭包，挪到模块级——它只依赖模块级状态
// （mediaPageIndex/mediaPageCount）和模块级函数（setMediaPage/mediaStepTarget），
// 没有任何真正需要闭包的东西。挪出来是因为鼠标后退/前进键的全局路由需要
// 在沉浸阅读器之外也能调用翻页，不想为了复用这几行再重新实现一遍。
function goPage(delta) {
  const next = mediaPageIndex + delta
  if (next >= 0 && next <= mediaPageCount - 1) { setMediaPage(next); return }
  mediaStepTarget(delta > 0 ? 'next' : 'prev')?.()
}

// EPUB 沉浸阅读。隐藏顶栏/头部那套直接复用视频的 stream-immersive +
// stream-page-fullscreen —— 那些规则里针对 .stream-player / media-stream 的部分
// 对 epub 是空操作，而「隐藏 chapter-head、section 单行、顶栏 fixed」正好就是要的。
let epubImmersive = null
let epubImmersiveSync = null

function epubImmersiveActive() {
  return Boolean(epubImmersive)
}

// 沉浸态下换章是异步重渲染的，控制条上的页码/目录/上下章状态要跟着走
function syncEpubImmersive() {
  epubImmersiveSync?.()
}

function exitEpubImmersive({ remember = false } = {}) {
  if (!epubImmersive) return
  if (remember) saveImmersivePref('html', false)
  const finish = epubImmersive
  epubImmersive = null
  epubImmersiveSync = null
  finish()
}

// —— EPUB 朗读播放控制器 ——
// epubTtsSentences 由 renderMediaHtml 在每次换章节/切书时重新赋值（bindEpubTtsSentences）。
// epubTtsAutoResume 是跨章节续读的信号：读到本章末尾时先把它置 true 再触发翻章，
// renderMediaHtml 里读到这个信号就跳过"停"直接从新章节第 0 句继续播，不然
// 每次翻页都会被 renderMediaHtml 开头的 stopEpubTts() 打断。
let epubTtsSentences = []
// 朗读倍速是浏览器端的 audio.playbackRate，缓存的音频本身不变；单独存一个 key，不和视频倍速互相影响
const EPUB_TTS_RATE_KEY = 'copymanga.epubTtsRate'
let epubTtsRate = normalizePlaybackRate(localStorage.getItem(EPUB_TTS_RATE_KEY) || '1')

function applyEpubTtsRate(audio) {
  audio.defaultPlaybackRate = epubTtsRate
  audio.playbackRate = epubTtsRate
}
let epubTtsPlaying = false
let epubTtsAutoResume = false
let epubTtsCurrentAudio = null
let epubTtsToggleBtn = null
let epubTtsSelectionBtn = null

// 客户端自己维护在途请求数，跟服务端 epubTtsMaxConcurrency 对齐——服务端的
// withEpubTtsConcurrencyLimit 只保证真正打到 TTS 的请求不超量，但如果客户端
// 这边不管不顾地疯狂发 /api/epub/.../tts-chunk，预加载泵会把一整章剩下的句子
// 瞬间全排进服务端队列，等于没有"预读多远"这个限制了。这里在请求真正发出去
// 之前先占一个坑位，没有空位就排队等，直接决定了预加载泵能跑多快多远。
let epubTtsInFlight = 0
const epubTtsSlotWaiters = []

function epubTtsMaxConcurrencyClient() {
  return Math.max(1, Number(appConfig?.epubTtsMaxConcurrency) || 1)
}

async function epubTtsAcquireSlot() {
  if (epubTtsInFlight >= epubTtsMaxConcurrencyClient()) {
    await new Promise((resolve) => epubTtsSlotWaiters.push(resolve))
  }
  epubTtsInFlight++
}

function epubTtsReleaseSlot() {
  epubTtsInFlight--
  epubTtsSlotWaiters.shift()?.()
}

function epubTtsMaxBatchSentences() {
  return Math.max(1, Number(appConfig?.epubTtsBatchMaxSentences) || 5)
}

// 预加载泵每轮递增一次批次序号，用来控制这一轮朗读会话是否还有效——暂停/
// 切换朗读目标时让旧的泵自然退出，不会跟新一轮朗读抢坑位、抢句子。
let epubTtsPrefetchToken = 0

function epubTtsConfigured() {
  // speaker_audio/prompt_audio 现在允许留空——GSV-TTS-Lite 服务端本来就
  // 支持这两个留空时落回它自己的 DEFAULT_SPEAKER_AUDIO/
  // DEFAULT_PROMPT_AUDIO 环境变量（见 web/library/epub-tts.mjs）。这里
  // 只要求配了 apiBase，具体参考音频能不能用交给服务端判断，不在前端
  // 这层提前拦死。
  return Boolean(appConfig?.epubTtsApiBase)
}

function epubTtsItemId() {
  return currentMediaReader?.item?.itemId || ''
}

function clearEpubTtsHighlight() {
  for (const el of document.querySelectorAll('.epub-tts-sentence.epub-tts-current')) el.classList.remove('epub-tts-current')
}

function stopEpubTts() {
  epubTtsPlaying = false
  epubTtsPrefetchToken++ // 让还在跑/排队的预加载泵发现自己过期了，尽快退出
  if (epubTtsCurrentAudio) {
    epubTtsCurrentAudio.pause()
    epubTtsCurrentAudio.src = ''
    epubTtsCurrentAudio = null
  }
  clearEpubTtsHighlight()
  epubTtsToggleBtn?.classList.remove('active')
  epubTtsSelectionBtn?.classList.remove('active')
}

// 从当前可视列范围里找第一个句子——"从当前页开始读"不是从全书第一句开始。
function findEpubTtsStartIndex(content) {
  const rect = content.getBoundingClientRect()
  for (const entry of epubTtsSentences) {
    if (!entry) continue
    const r = entry.element.getBoundingClientRect()
    if (r.width > 0 && r.right > rect.left + 1 && r.left < rect.left + content.clientWidth - 1) return entry.index
  }
  return epubTtsSentences.findIndex(Boolean)
}

// 纯粹发一次 /tts-chunk 请求、把结果落到 epubTtsSentences 上，不处理并发坑位——
// 调用前必须确保已经拿到了一个坑位，调用完（无论成败）由调用方自己释放。
// 拆成这一层单独的原因：泵和"紧急认领单句"两条路径都要发请求，但“谁来占坑位”
// 不一样（泵自己占、紧急路径临时占），如果这层自己占坑位，两条路径叠加调用
// 就会变成重复占用——占了两次却只释放一次，坑位会一路漏下去，占满之后所有
// 后续请求永远卡在排队，表现成朗读放到某一句就彻底卡死不动了（排查这个问题
// 花了好一阵，复现方式是用慢一点的 mock TTS + 多句朗读，前一两句正常，
// 后面突然再也不请求了）。
async function requestEpubTtsChunks(itemId, indexes) {
  try {
    const res = await fetch(`/api/epub/${itemId}/tts-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: indexes.map((i) => epubTtsSentences[i].text) }),
    })
    const data = await res.json()
    for (const chunk of data.chunks || []) {
      const i = indexes[chunk.index]
      if (epubTtsSentences[i]) { epubTtsSentences[i].chunk = chunk; epubTtsSentences[i].chunkPromise = null }
    }
  } catch (error) {
    for (const i of indexes) {
      if (epubTtsSentences[i]) { epubTtsSentences[i].chunk = { error: error.message }; epubTtsSentences[i].chunkPromise = null }
    }
  }
}

// 紧急认领一批句子：自己占坑位、自己发、自己释放，一条龙不假手旁人。用在
// "这句现在就要播，还没人认领过"的场景（典型是朗读开口的第一句，此时预加载
// 泵才刚起步）——不用等泵攒批次的节奏，立刻单独发出去。
function claimEpubTtsBatch(indexes) {
  const itemId = epubTtsItemId()
  if (!itemId) return null
  const promise = (async () => {
    await epubTtsAcquireSlot()
    try {
      await requestEpubTtsChunks(itemId, indexes)
    } finally {
      epubTtsReleaseSlot()
    }
  })()
  for (const i of indexes) epubTtsSentences[i].chunkPromise = promise
  return promise
}

// 主播放循环播到某句之前调用：这句如果已经有 chunk/chunkPromise（预加载泵
// 已经在处理或处理完了）就只是等；谁都没碰过的话（泵还没追上来，或者是
// 一开始播放的第一句——此时泵才刚起步，ramp 还在 1），立刻单独发一个只有
// 它自己的请求，不用排在泵攒的批次后面干等，不然开口第一句就要等一轮
// 攒批次逻辑跑完才有声音。
// 之前这里 need 为空就直接 return，不等已经存在的 chunkPromise——如果那个
// chunkPromise 还没 resolve，entry.chunk 这时候还是 undefined，播放循环会
// 把"还没返回"误判成"失败"直接跳过。这里改成不管 need 是不是空，最后都老实
// 等一遍所有相关的 chunkPromise。
async function ensureEpubTtsChunks(indexes) {
  const unique = [...new Set(indexes)].filter((i) => epubTtsSentences[i])
  const need = unique.filter((i) => !epubTtsSentences[i].chunk && !epubTtsSentences[i].chunkPromise)
  if (need.length) claimEpubTtsBatch(need)
  await Promise.all(unique.map((i) => epubTtsSentences[i].chunkPromise).filter(Boolean))
}

// 预加载泵：从 startIndex 往后一直攒批次往外发，直到追上这一章末尾、或者
// 朗读被停掉/换了目标。批次句数从 1 开始逐批递增，封顶 epubTtsBatchMaxSentences
// （对应"第一句单独发，后面批量变大"），同时不能超过 epubTtsBatchMaxChars
// 这个累计字符数上限——装不下的句子留给下一批，不会丢。每构建一批之前都要
// 先抢到一个并发坑位，坑位占满时这里会卡住等，天然限制了"最多往前预读多远"，
// 不会无限制地把一整章都排进请求队列。
async function runEpubTtsPrefetchPump(startIndex) {
  const token = epubTtsPrefetchToken
  let cursor = startIndex
  let batchSeq = 0
  while (epubTtsPlaying && token === epubTtsPrefetchToken) {
    while (epubTtsSentences[cursor] && (epubTtsSentences[cursor].chunk || epubTtsSentences[cursor].chunkPromise)) cursor++
    if (!epubTtsSentences[cursor]) return // 这一章能攒的都攒完了，等翻到下一章再起新的泵
    await epubTtsAcquireSlot()
    if (!epubTtsPlaying || token !== epubTtsPrefetchToken) { epubTtsReleaseSlot(); return }
    // 拿到坑位这段等待期间，cursor 指向的句子可能已经被主循环的
    // ensureEpubTtsChunks 抢先认领了（比如用户手速很快追上来），重新跳过。
    while (epubTtsSentences[cursor] && (epubTtsSentences[cursor].chunk || epubTtsSentences[cursor].chunkPromise)) cursor++
    if (!epubTtsSentences[cursor]) { epubTtsReleaseSlot(); return }
    batchSeq++
    const targetCount = Math.min(batchSeq, epubTtsMaxBatchSentences())
    const maxChars = epubTtsBatchMaxChars()
    const batch = []
    let total = 0
    while (epubTtsSentences[cursor] && batch.length < targetCount) {
      const text = epubTtsSentences[cursor].text
      if (batch.length && total + text.length > maxChars) break // 装不下了，留给下一批
      batch.push(cursor)
      total += text.length
      cursor++
    }
    const itemId = epubTtsItemId()
    if (!itemId) { epubTtsReleaseSlot(); return }
    // 坑位是泵自己在循环开头占的（上面那次 epubTtsAcquireSlot），这里只用
    // 不占坑位的 requestEpubTtsChunks，结束后自己 release——不能再调用
    // claimEpubTtsBatch/会内部占坑位的版本，否则又是同一批坑位被占两次、
    // 只释放一次的老问题。
    const promise = requestEpubTtsChunks(itemId, batch).finally(() => epubTtsReleaseSlot())
    for (const i of batch) epubTtsSentences[i].chunkPromise = promise
    // 不等这批结束就继续攒下一批（下一轮循环开头的 epubTtsAcquireSlot 会在坑位
    // 占满时自然卡住，不会无限制地往前冲）。
  }
}

// 有 subtitle 时间戳就按时间戳估，没有就退化成 currentTime/duration——
// 两种都只到句子维度的"大致位置"，不追求逐字对齐。
function computeEpubTtsRatio(subtitle, currentTime, duration) {
  if (!duration) return 0
  if (Array.isArray(subtitle) && subtitle.length) {
    const total = subtitle[subtitle.length - 1]?.end_s || duration
    return Math.max(0, Math.min(1, currentTime / total))
  }
  return Math.max(0, Math.min(1, currentTime / duration))
}

// 翻页沿用 enterEpubImmersive 里 goPage 的那几行逻辑（那是个闭包，这里独立复制一份，
// 因为朗读要跨章节续播，不能依赖沉浸条自己的闭包状态）。
function epubTtsAdvancePage(delta) {
  const next = mediaPageIndex + delta
  if (next >= 0 && next <= mediaPageCount - 1) { setMediaPage(next); return true }
  return false
}

// 只要求句子的起始位置翻到当前页可见，不要求整句都在一页内——长句子本来就可能
// 跨栏（CSS 分栏和按标点分句是两套互不知道对方的机制，句子跨栏是常态不是例外）。
// 跨栏时后半截自然溢到下一栏，边读边翻页，和纸质书翻到一半继续读是一回事；
// 之前要求整句都可见的话，跨栏句子永远凑不齐条件，会把页面滚到不该停的地方。
function ensureEpubTtsSentenceVisible(element, content) {
  let guard = 0
  while (guard++ < mediaPageCount + 1) {
    const rect = content.getBoundingClientRect()
    const er = element.getBoundingClientRect()
    if (er.left >= rect.left - 1 && er.left < rect.left + content.clientWidth - 1) return
    if (!epubTtsAdvancePage(1)) return
  }
}

async function playEpubTtsFrom(startIndex, content) {
  epubTtsPlaying = true
  epubTtsToggleBtn?.classList.add('active')
  // 开口第一句必须先占到坑位，再起预加载泵——泵自己也会抢一次坑位占着排队。
  // 如果反过来先起泵，泵的 epubTtsAcquireSlot() 会在主循环走到下面的
  // await ensureEpubTtsChunks 之前，靠微任务调度的时间差把唯一的坑位抢走
  // 去发它自己第一批（覆盖 startIndex+1）的请求，开口第一句反而要排到
  // 这批后面——实测确认过：并发=1 时请求日志里"第二句"先于"第一句"发出，
  // 朗读启动明显变慢，不是网络时序巧合，是这里调用顺序决定的。
  const firstClaim = ensureEpubTtsChunks([startIndex])
  runEpubTtsPrefetchPump(startIndex).catch(() => {})
  let index = startIndex
  while (epubTtsPlaying) {
    if (!epubTtsSentences[index]) {
      // 本节读完了，接到下一章继续——不能直接 stop，交给 renderMediaHtml 续播
      const next = mediaStepTarget('next')
      if (next) { epubTtsAutoResume = true; next(); return }
      break
    }
    await (index === startIndex ? firstClaim : ensureEpubTtsChunks([index]))
    if (!epubTtsPlaying) return
    const entry = epubTtsSentences[index]
    const chunk = entry.chunk
    if (!chunk || chunk.error) { index++; continue }   // 单句失败不中断整体朗读，跳过
    clearEpubTtsHighlight()
    for (const el of entry.elements) el.classList.add('epub-tts-current')
    setEpubTtsProgress(entry, 0)
    ensureEpubTtsSentenceVisible(entry.element, content)
    const audio = new Audio(chunk.url)
    applyEpubTtsRate(audio)
    epubTtsCurrentAudio = audio
    audio.addEventListener('timeupdate', () => {
      const ratio = computeEpubTtsRatio(chunk.subtitle, audio.currentTime, audio.duration)
      setEpubTtsProgress(entry, ratio)
    })
    const ended = new Promise((resolve) => {
      audio.addEventListener('ended', resolve, { once: true })
      audio.addEventListener('error', resolve, { once: true })
    })
    // 漏了这行会直接卡死：Audio 对象造出来、事件也挂了，但从没真的开始播，
    // ended 永远不触发，--tts-progress 就定在刚设的初始值上不会再动。
    audio.play().catch(() => {})
    await ended
    if (!epubTtsPlaying || epubTtsCurrentAudio !== audio) return   // 被打断（暂停/切章/退出）
    index++
  }
  stopEpubTts()
}

function toggleEpubTts(btn, content) {
  const wasPlaying = epubTtsPlaying
  epubTtsToggleBtn = btn
  stopEpubTts() // 不管之前是连续朗读还是读选中文本，先停干净，不会叠两路音频
  if (wasPlaying) { epubTtsAutoResume = false; return } // 原本在读 = 这次点击是暂停
  const startIndex = findEpubTtsStartIndex(content)
  if (startIndex < 0) return
  playEpubTtsFrom(startIndex, content).catch(() => {})
}

// 读选中文本：和"朗读"是两件事——这里只管读用户划选的这一段，读完就停，
// 不接着往下翻页/跳章，也不需要句子级别的高亮（选区本身已经是浏览器原生高亮）。
// 复用同一套 epubTtsCurrentAudio/stopEpubTts，这样退出沉浸、点常规朗读按钮
// 都能正确把这路播放也停掉，不会撞车。
async function playSelectedText(btn) {
  const text = String(window.getSelection?.() || '').trim()
  epubTtsSelectionBtn = btn
  stopEpubTts()
  if (!text) return
  const itemId = epubTtsItemId()
  if (!itemId) return
  btn.classList.add('active')
  let audio = null
  try {
    const res = await fetch(`/api/epub/${itemId}/tts-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [text] }),
    })
    const data = await res.json()
    const chunk = data.chunks?.[0]
    if (!chunk || chunk.error) return
    audio = new Audio(chunk.url)
    applyEpubTtsRate(audio)
    epubTtsCurrentAudio = audio
    const ended = new Promise((resolve) => {
      audio.addEventListener('ended', resolve, { once: true })
      audio.addEventListener('error', resolve, { once: true })
    })
    // 又漏了这行：自测直接用 Playwright 真实点击跑了一遍才抓出来——
    // 跟 playEpubTtsFrom 里那次一模一样的坑，Audio 对象造出来、事件也挂了，
    // 但从没真的开始播，ended 永远不触发，按钮的 active 状态会卡死。
    audio.play().catch(() => {})
    await ended
  } catch {
    // 网络错误之类的安静失败就行，不用弹窗打断阅读
  } finally {
    btn.classList.remove('active')
    if (epubTtsCurrentAudio === audio) epubTtsCurrentAudio = null
  }
}

function enterEpubImmersive({ remember = false } = {}) {
  if (epubImmersive) { exitEpubImmersive({ remember }); return }
  const content = els.mediaReaderContent
  if (!content.querySelector('.media-html-pages')) return
  if (remember) saveImmersivePref('html', true)

  const bar = document.createElement('div')
  bar.className = 'epub-bar'
  const mk = (cls, text, title) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `stream-icon-button ${cls}`
    b.textContent = text
    b.title = title
    return b
  }
  const back = mk('epub-back', '返回', '退出沉浸并返回')
  const prevCh = mk('epub-chapter-prev', '上章', '上一章')
  const prevPg = mk('epub-page-prev', '上页', '上一页')
  const info = document.createElement('span')
  info.className = 'epub-page-info'
  const nextPg = mk('epub-page-next', '下页', '下一页')
  const nextCh = mk('epub-chapter-next', '下章', '下一章')
  const toc = makeImmersiveToc()
  const widthBtn = mk('epub-width', '宽度', '调整阅读宽度')
  const ttsBtn = mk('epub-tts-toggle', '朗读', epubTtsConfigured() ? '从当前页开始朗读' : '未配置 TTS 服务地址，去配置页填 apiBase')
  ttsBtn.disabled = !epubTtsConfigured()
  const selectionBtn = mk('epub-tts-selection', '读选中', epubTtsConfigured() ? '朗读当前选中的文字' : '未配置 TTS 服务地址，去配置页填 apiBase')
  selectionBtn.disabled = !epubTtsConfigured()
  const rateSelect = document.createElement('select')
  rateSelect.className = 'stream-rate-select epub-tts-rate'
  rateSelect.title = '朗读倍速'
  for (const rate of mediaPlaybackRates) {
    const option = document.createElement('option')
    option.value = String(rate)
    option.textContent = `${rate}x`
    rateSelect.append(option)
  }
  rateSelect.value = String(epubTtsRate)
  rateSelect.addEventListener('change', () => {
    epubTtsRate = normalizePlaybackRate(rateSelect.value)
    localStorage.setItem(EPUB_TTS_RATE_KEY, String(epubTtsRate))
    // 正在读的这句立刻变速，不用等下一句
    if (epubTtsCurrentAudio) applyEpubTtsRate(epubTtsCurrentAudio)
    rateSelect.blur()
  })
  const exitBtn = mk('epub-exit', '退出', '退出沉浸')
  bar.append(back, prevCh, prevPg, info, nextPg, nextCh, toc, widthBtn, ttsBtn, selectionBtn, rateSelect, exitBtn)
  els.app.append(bar)

  const syncInfo = () => {
    // 原来只有页码，看不出在读哪一章；和图集沉浸条对齐
    const chapterTitle = currentMediaReader?.section?.title || currentMediaReader?.unit?.title || ''
    info.textContent = [chapterTitle, `${mediaPageIndex + 1} / ${mediaPageCount}`].filter(Boolean).join(' · ')
    info.title = chapterTitle
    prevCh.disabled = !mediaStepTarget('prev')
    nextCh.disabled = !mediaStepTarget('next')
    prevPg.disabled = mediaPageIndex <= 0 && !mediaStepTarget('prev')
    nextPg.disabled = mediaPageIndex >= mediaPageCount - 1 && !mediaStepTarget('next')
    syncImmersiveToc(toc)
  }
  epubImmersiveSync = syncInfo

  // —— 贴边唤出，和视频同一套手感 ——
  const EDGE = 72
  const HIDE_DELAY = 2400
  let timer = null
  // 目录下拉展开时焦点在 select 上，这时收起控制条会直接把下拉关掉
  const held = () => widthAdjustCleanup || bar.matches(':hover')
    || document.activeElement?.tagName === 'SELECT'
  const setVisible = (v) => els.app.classList.toggle('stream-chrome-visible', v)
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { if (held()) { schedule(); return } setVisible(false) }, HIDE_DELAY)
  }
  const reveal = () => { setVisible(true); schedule() }
  const onPointerMove = (event) => {
    if (event.clientY <= EDGE || event.clientY >= window.innerHeight - EDGE) reveal()
  }
  document.addEventListener('mousemove', onPointerMove)

  // —— 左右点击翻页 ——
  // epub 正文是可选中的，不能用裸 click：想选一段话时按下拖动会被当成翻页。
  // 只认「位移小 + 没有选区 + 没点在链接上」的点击。
  let downAt = null
  // 只认主键（左键/触摸/笔）。侧键（后退 3/前进 4）、中键、右键按下时浏览器也会
  // 派发 pointerdown/pointerup，不过滤的话它们会被当成"在光标当前位置点了一下"：
  // 侧键翻页（全局 mousedown 路由）之后 onUp 又按光标位置再翻一次，一下就跳好几页
  // 甚至互相抵消。
  const onDown = (event) => {
    if (event.button !== 0) return
    if (widthAdjustCleanup) return
    downAt = { x: event.clientX, y: event.clientY }
  }
  // 翻页逻辑已经挪到模块级的 goPage() 了（这样鼠标后退/前进键能复用），
  // 这里不再重复定义，直接用那个。
  const onUp = (event) => {
    if (event.button !== 0) return
    const start = downAt
    downAt = null
    if (!start || widthAdjustCleanup) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return
    if (String(window.getSelection?.() || '').length > 0) return
    if (event.target?.closest?.('a[href], button, select, input')) return
    const rect = content.getBoundingClientRect()
    // 滚动条那条在 rect 里、不在 clientWidth/clientHeight 里。
    // 用 rect.width 算比例的话，点滚动条 ratio≈0.99 会被当成"下一页"。
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (x >= content.clientWidth || y >= content.clientHeight) return
    const ratio = x / Math.max(1, content.clientWidth)
    if (ratio < 0.3) goPage(-1)
    else if (ratio > 0.7) goPage(1)
    else if (els.app.classList.contains('stream-chrome-visible')) setVisible(false)
    else reveal()
    setTimeout(syncInfo, 350)
  }
  content.addEventListener('pointerdown', onDown)
  content.addEventListener('pointerup', onUp)

  const onKey = (event) => {
    if (widthAdjustCleanup) return
    if (event.key === 'Escape') { event.preventDefault(); exitEpubImmersive({ remember: true }) }
    else if (event.key === 'ArrowLeft') { goPage(-1); setTimeout(syncInfo, 350) }
    else if (event.key === 'ArrowRight') { goPage(1); setTimeout(syncInfo, 350) }
  }
  document.addEventListener('keydown', onKey)

  // 「返回」是读完了要走，不是「不想要沉浸」，所以不改偏好
  back.addEventListener('click', () => { exitEpubImmersive(); els.mediaReaderBack?.click() })
  exitBtn.addEventListener('click', () => exitEpubImmersive({ remember: true }))
  prevCh.addEventListener('click', () => { mediaStepTarget('prev')?.() })
  nextCh.addEventListener('click', () => { mediaStepTarget('next')?.() })
  prevPg.addEventListener('click', () => { goPage(-1); setTimeout(syncInfo, 350) })
  nextPg.addEventListener('click', () => { goPage(1); setTimeout(syncInfo, 350) })
  widthBtn.addEventListener('click', () => { setVisible(true); clearTimeout(timer); toggleWidthAdjust() })
  ttsBtn.addEventListener('click', () => toggleEpubTts(ttsBtn, content))
  selectionBtn.addEventListener('click', () => playSelectedText(selectionBtn).catch(() => {}))
  bar.addEventListener('click', (event) => event.stopPropagation())

  els.mediaViewerView.classList.add('stream-page-fullscreen')
  els.app.classList.add('stream-immersive')
  els.mediaImmersive?.classList.add('active')
  els.mediaImmersive?.blur()
  // 容器尺寸变了（头部被隐藏），必须重排，否则页宽还是旧的
  requestAnimationFrame(() => {
    const keep = mediaPageAnchor()
    layoutMediaPages({ anchor: keep })
    syncInfo()
    reveal()
  })

  epubImmersive = () => {
    epubTtsAutoResume = false
    stopEpubTts()
    clearTimeout(timer)
    document.removeEventListener('mousemove', onPointerMove)
    document.removeEventListener('keydown', onKey)
    content.removeEventListener('pointerdown', onDown)
    content.removeEventListener('pointerup', onUp)
    bar.remove()
    exitWidthAdjust({ apply: false })
    els.mediaViewerView.classList.remove('stream-page-fullscreen')
    els.app.classList.remove('stream-immersive', 'stream-chrome-visible')
    els.mediaImmersive?.classList.remove('active')
    requestAnimationFrame(() => {
      const keep = mediaPageAnchor()
      layoutMediaPages({ anchor: keep })
    })
  }
}

// 看图沉浸：正常滚动看图，点右侧下一章、点左侧上一章，其余 chrome 收进去。
// 媒体库图集（新模式）和图片浏览 tab（老模式）共用同一套。
// 和 epub 沉浸的区别：这里不分页，所以没有上页/下页/页码，左右点击直接切章。
let galleryImmersive = null
let galleryImmersiveSync = null
let galleryImmersiveView = ''
let galleryImmersiveKind = ''

function exitGalleryImmersive({ remember = false } = {}) {
  if (!galleryImmersive) return
  if (remember) saveImmersivePref(galleryImmersiveKind, false)
  const finish = galleryImmersive
  galleryImmersive = null
  galleryImmersiveSync = null
  galleryImmersiveView = ''
  galleryImmersiveKind = ''
  galleryImmersiveJumpOnce = null
  finish()
}

function exitReaderImmersive() {
  exitEpubImmersive()
  exitGalleryImmersive()
}

// 切章是异步重渲染的，渲染完要把控制条上的章节信息和按钮状态补一刀
function syncGalleryImmersive() {
  galleryImmersiveSync?.()
}

function enterGalleryImmersive({ view, content, toggle, chapter, kind = '', remember = false }) {
  if (galleryImmersive) { exitGalleryImmersive({ remember }); return }
  if (!content?.querySelector('img')) return
  if (remember) saveImmersivePref(kind, true)

  const bar = document.createElement('div')
  bar.className = 'epub-bar gallery-bar'
  const mk = (cls, text, title) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `stream-icon-button ${cls}`
    b.textContent = text
    b.title = title
    return b
  }
  const back = mk('gallery-back', '返回', '退出沉浸并返回')
  const prevCh = mk('gallery-chapter-prev', '上章', '上一章')
  const info = document.createElement('span')
  info.className = 'epub-page-info gallery-info'
  const nextCh = mk('gallery-chapter-next', '下章', '下一章')
  const toc = makeImmersiveToc()
  const exitBtn = mk('gallery-exit', '退出', '退出沉浸')

  // —— 长按滚动：右侧贴着滚动条的一对箭头 + 栏里的调速滑块 ——
  // 滚的是 content.scrollTop：.content 外壳是 overflow:hidden，真正滚的是内容容器自己。
  // 用 rAF 不用 setInterval——后者在不同刷新率下速度会飘，切到后台还会积压回调。
  const SPEED_KEY = 'copymanga.galleryScrollSpeed'
  // 分段模式：按住时每隔一段时间跳一次，而不是匀速推进。
  // 匀速滚动逼着眼睛一直做平滑追踪，这是按住比滚轮晕的主因；跳跃之间的静止期
  // 把"注视"还给眼睛，和滚轮一格一跳是同一个道理。
  const MODE_KEY = 'copymanga.galleryScrollMode'
  const STEP_RATIO_KEY = 'copymanga.galleryScrollStepRatio'
  const STEP_RATIO_MIN = 0.15
  const STEP_RATIO_MAX = 0.9
  const JUMP_MS = 180            // 单次跳跃的动画时长
  const MIN_PAUSE_MS = 160       // 两跳之间至少静止这么久，否则退化成连续滚动
  const SPEED_MIN = 100
  const SPEED_MAX = 3000
  const readSpeed = () => {
    const n = Number(localStorage.getItem(SPEED_KEY))
    // 默认从 600 降到 320：900px 视口下 600px/s 是 1.5 秒换一整屏，而且匀速不停，
    // 眼睛只能一直做平滑追踪，看久了会晕。想快的人拉滑块。
    return Number.isFinite(n) && n >= SPEED_MIN && n <= SPEED_MAX ? n : 320
  }
  let speed = readSpeed()
  const readMode = () => (localStorage.getItem(MODE_KEY) === 'step' ? 'step' : 'smooth')
  let mode = readMode()
  // 每跳的幅度原来是写死的 35%，有人觉得跳得太短——改成可调，
  // 范围不让跌破 15%（太碎跟连续滚动没区别）或超过 90%（重叠太少容易跟丢位置）。
  const readStepRatio = () => {
    const n = Number(localStorage.getItem(STEP_RATIO_KEY))
    return Number.isFinite(n) && n >= STEP_RATIO_MIN && n <= STEP_RATIO_MAX ? n : 0.35
  }
  let stepRatio = readStepRatio()

  const nav = document.createElement('div')
  nav.className = 'gallery-scroll-nav'
  const mkArrow = (d, text, title) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gallery-scroll-arrow'
    b.textContent = text
    b.title = title
    b.dataset.dir = String(d)
    return b
  }
  const upBtn = mkArrow(-1, '▲', '按住向上滚')
  const downBtn = mkArrow(1, '▼', '按住向下滚')
  nav.append(upBtn, downBtn)
  els.app.append(nav)

  // 起步/收尾的加减速。没有这一段的话速度是从 0 直接阶跃到满速，
  // 画面不是"被拉动"而是"突然开始平移"，缺的就是加速度线索。
  const RAMP_UP_MS = 220
  const RAMP_DOWN_MS = 160

  let raf = 0
  let lastTs = 0
  let scrollDir = 0
  let vel = 0        // 当前速度 px/s，带符号
  let pos = 0        // 自己累加的浮点位置

  const step = (ts) => {
    // 切后台回来第一帧的 dt 可能是几秒，不钳住会直接蹦到底
    const dt = lastTs ? Math.min(ts - lastTs, 100) : 16.7
    lastTs = ts

    const target = scrollDir * speed
    const rampMs = Math.abs(target) > Math.abs(vel) ? RAMP_UP_MS : RAMP_DOWN_MS
    const maxStep = speed * (dt / rampMs)
    vel += Math.max(-maxStep, Math.min(maxStep, target - vel))
    if (!scrollDir && Math.abs(vel) < 1) vel = 0

    // 位置必须自己用浮点累加。原来写的是 content.scrollTop += delta，而 scrollTop
    // 会取整，读-改-写每帧都吞掉小数：实测 100px/s 跑出 120px/s（+20%），
    // 帧间隔一抖还会在 1px/2px 之间跳，就是肉眼看到的顿挫。
    const max = Math.max(0, content.scrollHeight - content.clientHeight)
    pos = Math.max(0, Math.min(max, pos + vel * (dt / 1000)))
    content.scrollTop = pos

    if (!scrollDir && vel === 0) { raf = 0; return }
    raf = requestAnimationFrame(step)
  }

  // —— 分段模式 ——
  let jumpFrom = 0
  let jumpTo = 0
  let jumpStart = 0
  let jumpTimer = null
  const easeOut = (t) => 1 - ((1 - t) ** 3)
  const jumpDistance = () => Math.max(40, content.clientHeight * stepRatio)

  const stepJump = (ts) => {
    if (!jumpStart) jumpStart = ts
    const t = Math.min(1, (ts - jumpStart) / JUMP_MS)
    pos = jumpFrom + (jumpTo - jumpFrom) * easeOut(t)
    content.scrollTop = pos
    if (t < 1) { raf = requestAnimationFrame(stepJump); return }
    raf = 0
    if (scrollDir) scheduleJump()
  }

  function scheduleJump() {
    // 滑块在两种模式下含义一致：平均速度。间隔由"跳多远 / 多快"反推，
    // 但不能短于一次跳跃 + 最小静止，否则又变回连续滚动（分段模式因此有速度上限）。
    const interval = Math.max(JUMP_MS + MIN_PAUSE_MS, (jumpDistance() / speed) * 1000)
    jumpTimer = setTimeout(() => {
      jumpTimer = null
      if (scrollDir) beginJump()
    }, interval - JUMP_MS)
  }

  function beginJump() {
    const max = Math.max(0, content.scrollHeight - content.clientHeight)
    jumpFrom = content.scrollTop
    jumpTo = Math.max(0, Math.min(max, jumpFrom + scrollDir * jumpDistance()))
    if (jumpTo === jumpFrom) {           // 已经到头，别空转 rAF
      if (scrollDir) scheduleJump()
      return
    }
    // 速度拉到最大时，间隔已经卡在"一跳 + 最小静止"的下限，180ms 的渐变动画
    // 反而显得拖沓——跳过渐变直接到位，手感更接近滚轮快速滑动时的"唰"一下。
    if (speed >= SPEED_MAX) {
      pos = jumpTo
      content.scrollTop = pos
      if (scrollDir) scheduleJump()
      return
    }
    jumpStart = 0
    raf = requestAnimationFrame(stepJump)
  }

  // 鼠标后退/前进键（全局 mousedown 路由）专用：点一下跳一次，不是按住连续滚。
  // 复用分段模式的 beginJump/jumpDistance——不管当前 UI 上选的是"连续"还是
  // "分段"模式，这两个函数本来就不受模式开关门控，点按的语义本来就该是离散的
  // 一下一下跳，不该去复刻"连续"模式那种按住累加速度的手感（鼠标侧键也通常
  // 不会被长按）。借用 scrollDir 这个字段只是为了复用 beginJump 内部的方向判断，
  // 跳完立刻归零，不触发 scheduleJump 进入连续跳页。
  function jumpOnce(direction) {
    scrollDir = direction
    beginJump()
    scrollDir = 0
  }

  // 松手：只是把目标速度归零，让 step 自己减速收尾；分段模式下让当前这一跳走完
  const releaseScroll = () => {
    scrollDir = 0
    if (jumpTimer) { clearTimeout(jumpTimer); jumpTimer = null }
    nav.classList.remove('active')
  }
  // 硬停：退出沉浸模式时用。不能只 releaseScroll——减速那 160ms 里 rAF 还在跑，
  // 会去摸已经被移除的 content
  const stopScroll = () => {
    scrollDir = 0
    vel = 0
    lastTs = 0
    if (jumpTimer) { clearTimeout(jumpTimer); jumpTimer = null }
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    nav.classList.remove('active')
  }
  const startScroll = (event, d) => {
    event.preventDefault()
    event.stopPropagation()
    // 必须捕获指针：否则按住后手一移出按钮就收不到 pointerup，会一直滚停不下来
    event.currentTarget.setPointerCapture?.(event.pointerId)
    scrollDir = d
    lastTs = 0
    pos = content.scrollTop     // 期间可能被滚轮/跳章改过，重新对齐
    nav.classList.add('active')
    if (mode === 'step') {
      // 立刻跳第一下，按下去要有即时反馈，不能先等一个间隔
      if (!raf && !jumpTimer) beginJump()
      return
    }
    if (!raf) raf = requestAnimationFrame(step)
  }
  for (const b of [upBtn, downBtn]) {
    const d = Number(b.dataset.dir)
    b.addEventListener('pointerdown', (event) => startScroll(event, d))
    b.addEventListener('pointerup', releaseScroll)
    // 移动端的滑动手势会把指针抢走，不处理 cancel 就会一直滚
    b.addEventListener('pointercancel', releaseScroll)
    b.addEventListener('lostpointercapture', releaseScroll)
  }
  nav.addEventListener('click', (event) => event.stopPropagation())

  // 自动淡出：长图阅读时一直有个块压在画面上。淡到还看得见，不是完全消失——
  // 全透明的话用户找不回来。
  let dimTimer = null
  const bumpNav = () => {
    nav.classList.remove('dim')
    clearTimeout(dimTimer)
    dimTimer = setTimeout(() => {
      if (!scrollDir && !nav.matches(':hover')) nav.classList.add('dim')
    }, 2500)
  }
  document.addEventListener('mousemove', bumpNav)

  // 用栏里现成的 mk()，样式和返回/上章/退出保持一致
  const modeBtn = mk('gallery-scroll-mode', '', '')
  const syncMode = () => {
    modeBtn.textContent = mode === 'step' ? '分段' : '连续'
    modeBtn.title = mode === 'step'
      ? `分段滚动：每次跳一屏的 ${Math.round(stepRatio * 100)}%，跳跃之间有静止，看久了不容易晕。点击切回连续`
      : '连续滚动：匀速推进。点击切换为分段'
    stepRatioWrap.hidden = mode !== 'step'
  }
  modeBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    stopScroll()                       // 切模式前先把当前这轮收干净
    mode = mode === 'step' ? 'smooth' : 'step'
    syncMode()
    try { localStorage.setItem(MODE_KEY, mode) } catch { /* 存不下就只在本次生效 */ }
  })

  const speedWrap = document.createElement('label')
  speedWrap.className = 'gallery-speed'
  speedWrap.title = '长按箭头时的滚动速度（分段模式下是平均速度，上限受最小静止时间限制）'
  const speedInput = document.createElement('input')
  speedInput.type = 'range'
  speedInput.min = String(SPEED_MIN)
  speedInput.max = String(SPEED_MAX)
  speedInput.step = '50'
  speedInput.value = String(speed)
  const speedVal = document.createElement('span')
  speedVal.className = 'gallery-speed-val'
  const syncSpeed = () => { speedVal.textContent = `${speed}` }
  speedInput.addEventListener('input', () => {
    speed = Number(speedInput.value)
    syncSpeed()
    // 隐私模式下 setItem 会抛，但速度本身已经生效，不该因为存不下就报错
    try { localStorage.setItem(SPEED_KEY, String(speed)) } catch { /* 存不下就只在本次生效 */ }
  })
  syncSpeed()
  speedWrap.append(speedInput, speedVal)

  // 只在分段模式下有意义（连续模式没有"跳一下多远"这回事），显隐交给 syncMode
  const stepRatioWrap = document.createElement('label')
  stepRatioWrap.className = 'gallery-speed'
  stepRatioWrap.title = '分段模式下每次跳多远（占可视区域的百分比），跳得太碎和连续滚动没区别，跳得太远容易跟丢位置'
  const stepRatioInput = document.createElement('input')
  stepRatioInput.type = 'range'
  stepRatioInput.min = String(Math.round(STEP_RATIO_MIN * 100))
  stepRatioInput.max = String(Math.round(STEP_RATIO_MAX * 100))
  stepRatioInput.step = '5'
  stepRatioInput.value = String(Math.round(stepRatio * 100))
  const stepRatioVal = document.createElement('span')
  stepRatioVal.className = 'gallery-speed-val'
  const syncStepRatio = () => { stepRatioVal.textContent = `${Math.round(stepRatio * 100)}%` }
  stepRatioInput.addEventListener('input', () => {
    stepRatio = Number(stepRatioInput.value) / 100
    syncStepRatio()
    syncMode()      // 分段模式的提示文字里带百分比，拖动时顺带刷新
    try { localStorage.setItem(STEP_RATIO_KEY, String(stepRatio)) } catch { /* 存不下就只在本次生效 */ }
  })
  syncStepRatio()
  stepRatioWrap.append(stepRatioInput, stepRatioVal)

  syncMode()

  bar.append(back, prevCh, info, nextCh, toc, modeBtn, speedWrap, stepRatioWrap, exitBtn)
  els.app.append(bar)

  const syncInfo = () => {
    info.textContent = chapter.label()
    prevCh.disabled = !chapter.canPrev()
    nextCh.disabled = !chapter.canNext()
    if (chapter.toc === false) toc.hidden = true
    else syncImmersiveToc(toc)
  }
  galleryImmersiveSync = syncInfo

  // —— 贴边唤出，和视频/epub 同一套手感 ——
  const EDGE = 72
  const HIDE_DELAY = 2400
  let timer = null
  // 目录下拉展开时焦点在 select 上，这时收起控制条会直接把下拉关掉
  const held = () => bar.matches(':hover') || document.activeElement?.tagName === 'SELECT'
  const setVisible = (v) => els.app.classList.toggle('stream-chrome-visible', v)
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { if (held()) { schedule(); return } setVisible(false) }, HIDE_DELAY)
  }
  const reveal = () => { setVisible(true); schedule() }
  const onPointerMove = (event) => {
    if (event.clientY <= EDGE || event.clientY >= window.innerHeight - EDGE) reveal()
  }
  document.addEventListener('mousemove', onPointerMove)

  // —— 左右点击切章 ——
  // 滚动看图时手会在图上拖，不能用裸 click：只认「位移小 + 没有选区 +
  // 没点在可交互元素上」的点击。.viewer-sentinel 是「加载更多」，点它只该加载。
  let downAt = null
  // 只认主键，原因同 EPUB 沉浸态：侧键也会派发 pointerdown/pointerup，不过滤就会
  // 被当成一次点击，在左/右 30% 区域直接触发「上一章/下一章」。
  const onDown = (event) => {
    if (event.button !== 0) return
    downAt = { x: event.clientX, y: event.clientY }
  }
  const onUp = (event) => {
    if (event.button !== 0) return
    const start = downAt
    downAt = null
    if (!start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return
    if (String(window.getSelection?.() || '').length > 0) return
    if (event.target?.closest?.('a[href], button, select, input, .viewer-sentinel')) return
    const rect = content.getBoundingClientRect()
    // 滚动条那条在 rect 里、不在 clientWidth/clientHeight 里。
    // 用 rect.width 算比例的话，点右侧滚动条 ratio≈0.99 会被当成「下一章」。
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (x >= content.clientWidth || y >= content.clientHeight) return
    const ratio = x / Math.max(1, content.clientWidth)
    if (ratio < 0.3) {
      if (chapter.canPrev()) { chapter.prev(); setTimeout(syncInfo, 400) }
    } else if (ratio > 0.7) {
      if (chapter.canNext()) { chapter.next(); setTimeout(syncInfo, 400) }
    } else if (els.app.classList.contains('stream-chrome-visible')) setVisible(false)
    else reveal()
  }
  content.addEventListener('pointerdown', onDown)
  content.addEventListener('pointerup', onUp)

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      exitGalleryImmersive({ remember: true })
    } else if (event.key === 'ArrowLeft') {
      if (chapter.canPrev()) { chapter.prev(); setTimeout(syncInfo, 400) }
    } else if (event.key === 'ArrowRight') {
      if (chapter.canNext()) { chapter.next(); setTimeout(syncInfo, 400) }
    }
  }
  document.addEventListener('keydown', onKey)

  // 「返回」是看完了要走，不是「不想要沉浸」，所以不改偏好
  back.addEventListener('click', () => { exitGalleryImmersive(); chapter.back() })
  exitBtn.addEventListener('click', () => exitGalleryImmersive({ remember: true }))
  prevCh.addEventListener('click', () => { chapter.prev(); setTimeout(syncInfo, 400) })
  nextCh.addEventListener('click', () => { chapter.next(); setTimeout(syncInfo, 400) })
  bar.addEventListener('click', (event) => event.stopPropagation())

  view.classList.add('stream-page-fullscreen')
  els.app.classList.add('stream-immersive')
  galleryImmersiveView = view.id
  galleryImmersiveKind = kind
  galleryImmersiveJumpOnce = jumpOnce
  toggle?.classList.add('active')
  toggle?.blur()
  syncInfo()
  reveal()

  galleryImmersive = () => {
    clearTimeout(timer)
    stopScroll()
    clearTimeout(dimTimer)
    document.removeEventListener('mousemove', bumpNav)
    nav.remove()
    document.removeEventListener('mousemove', onPointerMove)
    document.removeEventListener('keydown', onKey)
    content.removeEventListener('pointerdown', onDown)
    content.removeEventListener('pointerup', onUp)
    bar.remove()
    view.classList.remove('stream-page-fullscreen')
    els.app.classList.remove('stream-immersive', 'stream-chrome-visible')
    toggle?.classList.remove('active')
  }
}

// 拖动调宽度：全程只移动参考线，一个字都不重排。
// 改 --media-page-width 会让浏览器立刻重排多列，拖动时每帧都重排整章会卡，
// 所以宽度只在"确认退出"那一刻写入，整本只重排一次。
let widthAdjustCleanup = null

function exitWidthAdjust({ apply = false, width = 0 } = {}) {
  if (!widthAdjustCleanup) return
  const finish = widthAdjustCleanup
  widthAdjustCleanup = null
  finish(apply, width)
}

function toggleWidthAdjust() {
  if (widthAdjustCleanup) { exitWidthAdjust({ apply: false }); return }
  const content = els.mediaReaderContent
  if (!content.querySelector('.media-html-pages')) return

  const layer = document.createElement('div')
  layer.className = 'media-width-layer'
  const left = document.createElement('div')
  left.className = 'media-width-edge media-width-edge-left'
  const right = document.createElement('div')
  right.className = 'media-width-edge media-width-edge-right'
  const label = document.createElement('div')
  label.className = 'media-width-label'
  layer.append(left, right, label)
  document.body.append(layer)

  // 水平范围必须按父容器量：正文容器自己被 max-width 收到了一页宽，
  // 拿它算 available 会让宽度只能越调越窄、再也拉不回铺满。
  const host = content.parentElement || content
  const available = Math.max(320, host.clientWidth - 56)
  const limit = loadEpubPageWidth()
  let width = limit > 0 ? Math.min(limit, available) : available

  const paint = () => {
    // 参考线层必须用 fixed 按屏幕矩形定位：.media-reader-content 是横向
    // 滚动容器，absolute 相对的是 padding box，不随 scrollLeft 走 —— 翻过页
    // 之后（scrollLeft 几千）参考线会被甩出视口左边。
    // 垂直范围跟正文走，水平范围跟整块阅读区走。
    const rect = content.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    layer.style.left = `${hostRect.left}px`
    layer.style.top = `${rect.top}px`
    layer.style.width = `${hostRect.width}px`
    layer.style.height = `${rect.height}px`
    const pad = Math.max(0, (hostRect.width - width) / 2)
    left.style.left = `${pad}px`
    right.style.left = `${pad + width}px`
    label.textContent = `${Math.round(width)} px${width >= available ? '（铺满）' : ''}`
  }
  paint()

  // 列是居中的，必须对称：拖右边时左边同步内移，否则确认后文字重新居中，
  // 和拖的时候看到的位置对不上。
  let dragging = null
  let moved = false
  const onDown = (event, side) => {
    dragging = side
    moved = false
    event.preventDefault()
    event.stopPropagation()
  }
  const onMove = (event) => {
    if (!dragging) return
    const hostRect = host.getBoundingClientRect()
    const centre = hostRect.left + hostRect.width / 2
    const half = dragging === 'left' ? centre - event.clientX : event.clientX - centre
    width = Math.max(320, Math.min(available, Math.round(half * 2)))
    moved = true
    paint()
  }
  const onUp = () => { dragging = null }
  left.addEventListener('pointerdown', (e) => onDown(e, 'left'))
  right.addEventListener('pointerdown', (e) => onDown(e, 'right'))
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
  window.addEventListener('resize', paint)
  const onKey = (event) => {
    if (event.key !== 'Escape' && event.key !== 'Enter') return
    // 焦点还在「宽度」按钮上，Enter 会先走到这里、再触发按钮自身的默认激活，
    // 结果刚退出就又被重新打开。必须拦掉默认行为。
    event.preventDefault()
    if (event.key === 'Escape') exitWidthAdjust({ apply: false })
    else exitWidthAdjust({ apply: true, width })
  }
  document.addEventListener('keydown', onKey)
  // 点参考线以外的空白 = 确认。必须排掉拖动：pointerdown 在参考线上、
  // pointerup 落在层背景上时，浏览器会在共同祖先（layer）上合成一次 click，
  // target 同样是 layer —— 不防的话每次拖完松手都会自动确认，Esc 没机会取消。
  layer.addEventListener('click', (event) => {
    if (event.target !== layer || moved) { moved = false; return }
    exitWidthAdjust({ apply: true, width })
  })

  els.mediaWidthAdjust?.blur()
  els.mediaWidthAdjust?.classList.add('active')
  els.mediaReaderContent.classList.add('width-adjusting')

  widthAdjustCleanup = (apply, finalWidth) => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    window.removeEventListener('resize', paint)
    document.removeEventListener('keydown', onKey)
    layer.remove()
    els.mediaWidthAdjust?.classList.remove('active')
    els.mediaReaderContent.classList.remove('width-adjusting')
    if (!apply) return
    // 到这一刻才真正改宽度并重排，整本只重排一次
    const anchor = mediaPageAnchor()
    saveEpubPageWidth(finalWidth >= available ? 0 : finalWidth)
    layoutMediaPages({ anchor })
    scheduleLibraryProgressSave()
  }
}

function mediaScrollRatio() {
  if (currentMediaReader?.type !== 'html') return currentMediaReader?.type === 'images' ? 1 : 0.1
  return mediaPageCount <= 1 ? 1 : Math.max(0, Math.min(1, mediaPageIndex / (mediaPageCount - 1)))
}

function updateMediaPageControls() {
  // 只有 epub(html) 才有可调的阅读宽度
  if (els.mediaWidthAdjust) els.mediaWidthAdjust.disabled = currentMediaReader?.type !== 'html'
  // 沉浸四种内容都支持：epub 分页翻、图集滚动看、音视频铺满播
  if (els.mediaImmersive) {
    els.mediaImmersive.disabled = !['html', 'images', 'audio', 'video'].includes(currentMediaReader?.type)
  }
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
syncLibrarySourceProfileOptions()
renderLibrarySearchPresetOptions()
// 下拉框选中只是选中，不自动应用——按你的要求，点"加载"才真的把这个预设的
// 6 项值填回控件并触发搜索。选中时顺手把名称输入框也填上，方便直接点"保存"
// 就地更新这条预设，不用重新手打一遍名字。
els.librarySearchPresetSelect?.addEventListener('change', () => {
  if (els.librarySearchPresetSelect.value && els.librarySearchPresetName) {
    els.librarySearchPresetName.value = els.librarySearchPresetSelect.value
  }
})
els.librarySearchPresetLoad?.addEventListener('click', () => {
  const name = els.librarySearchPresetSelect?.value
  if (!name) return alert('请先在下拉框里选一个预设')
  const preset = loadLibrarySearchPresets().find((p) => p.name === name)
  if (!preset) return alert('这个预设已经不存在了，刷新一下列表')
  applyLibrarySearchPresetFields(preset)
  libraryPage = 1
  loadLibraryItems().catch((error) => alert(error.message))
})
els.librarySearchPresetSave?.addEventListener('click', () => {
  const name = (els.librarySearchPresetName?.value || '').trim()
  if (!name) return alert('请先填一个预设名称')
  const presets = loadLibrarySearchPresets()
  const fields = currentLibrarySearchPresetFields()
  const existingIndex = presets.findIndex((p) => p.name === name)
  if (existingIndex >= 0) {
    presets[existingIndex] = { name, ...fields }
  } else {
    if (presets.length >= LIBRARY_SEARCH_PRESETS_MAX) {
      return alert(`最多保存 ${LIBRARY_SEARCH_PRESETS_MAX} 条预设，先删几条再存`)
    }
    presets.push({ name, ...fields })
  }
  saveLibrarySearchPresets(presets)
  renderLibrarySearchPresetOptions()
  els.librarySearchPresetSelect.value = name
})
els.librarySearchPresetDelete?.addEventListener('click', () => {
  const name = els.librarySearchPresetSelect?.value
  if (!name) return alert('请先在下拉框里选一个要删除的预设')
  if (!confirm(`删除预设"${name}"？`)) return
  saveLibrarySearchPresets(loadLibrarySearchPresets().filter((p) => p.name !== name))
  renderLibrarySearchPresetOptions()
  if (els.librarySearchPresetName) els.librarySearchPresetName.value = ''
})
els.mergeRefresh?.addEventListener('click', () => {
  refreshMergeCandidates().catch((error) => alert(error.message))
  refreshAnidbDumpStatus().catch(() => {})
})
// 搜索改的是服务端过滤条件，必须回到第 1 页——不然在第 3 页改关键字，
// 过滤后可能一共就 1 页，拿到的是空列表，看着像「搜不到」。
function applyMergeKeyword() {
  mergeKeyword = (els.mergeKeyword?.value || '').trim()
  mergePage = 1
  resetMergePosition()
  loadMergeCandidates().catch((error) => alert(error.message))
}
els.mergeSearch?.addEventListener('click', applyMergeKeyword)
els.mergeKeyword?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') applyMergeKeyword()
})
// type=search 的小叉号走 input 事件而不是 keydown，不接的话清空后列表不动
els.mergeKeyword?.addEventListener('search', applyMergeKeyword)
els.mergePrev?.addEventListener('click', () => {
  if (mergePage > 1) { mergePage -= 1; resetMergePosition(); loadMergeCandidates().catch(() => {}) }
})
els.mergeNext?.addEventListener('click', () => {
  if (mergePage < mergeTotalPages) { mergePage += 1; resetMergePosition(); loadMergeCandidates().catch(() => {}) }
})
els.mergeJump?.addEventListener('click', jumpMergePage)
els.mergePage?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') jumpMergePage()
})
els.mergeLimit?.addEventListener('change', () => {
  mergePage = 1
  resetMergePosition()
  loadMergeCandidates().catch(() => {})
})
els.mergeDumpRefresh?.addEventListener('click', async () => {
  const button = els.mergeDumpRefresh
  button.disabled = true
  const original = button.textContent
  button.textContent = '刷新中...'
  try {
    const d = await api('/api/anidb/dump/refresh', { method: 'POST' })
    els.mergeDumpStatus.textContent = d.message || '已刷新'
    await refreshAnidbDumpStatus()
  } catch (error) {
    els.mergeDumpStatus.textContent = `刷新失败：${error.message}`
  } finally {
    button.disabled = false
    button.textContent = original
  }
})
els.mergeRunPage?.addEventListener('click', async () => {
  const button = els.mergeRunPage
  // 当前页全量：逐组串行执行，一组失败不影响后面的，最后汇总报告。
  // 必须复用同一个查询（含关键字），否则开着搜索点「合并当前页全部」，
  // 合掉的是未过滤的那一页——你根本没看见过的那些组。
  const data = await api(mergeCandidatesQuery())
  const groups = data.items || []
  if (!groups.length) return
  if (!confirm(`将合并当前页 ${groups.length} 组。源条目的文件会进 cache/library-trash（可人工取回），但元数据不保留，确定？`)) return
  button.disabled = true
  const original = button.textContent
  let ok = 0
  const failed = []
  for (const [index, group] of groups.entries()) {
    button.textContent = `合并中 ${index + 1}/${groups.length}`
    try {
      await runMergeGroup(group)
      ok += 1
    } catch (error) {
      failed.push(`${group.key}: ${error.message}`)
    }
  }
  button.disabled = false
  button.textContent = original
  // 和单组合并一致：不自动刷新。把合过的组就地标掉，列表留在原处等你自己点刷新。
  for (const card of els.mergeGroups.querySelectorAll('.merge-group')) {
    const key = card.querySelector('.merge-group-key')?.textContent || ''
    const group = groups.find((candidate) => candidate.key === key)
    if (group && !failed.some((line) => line.startsWith(`${group.key}: `))) {
      markMergeGroupDone(card, group, null)
    }
  }
  if (failed.length) alert(`成功 ${ok} 组，失败 ${failed.length} 组：\n${failed.join('\n')}`)
  else alert(`成功合并 ${ok} 组。列表没有自动刷新，点「重建索引并刷新」查看结果。`)
})
els.librarySourceProfile?.addEventListener('change', () => {
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
// 鼠标后退/前进键（button 3/4）在媒体浏览/图片浏览里改派去做内容相关的动作，
// 不走浏览器默认的页面历史后退/前进——这个应用内部切 tab/视图不依赖浏览器历史。
// 这几个按钮不是任何浏览器一定会可靠发出来的——有驱动软件的鼠标可能在
// 操作系统层面直接把侧键模拟成 Alt+方向键或者直接调浏览器命令，网页这层
// 完全看不到事件，这种情况没法在代码里处理。
// 注意：侧键按下时浏览器除了 mousedown 还会派发 pointerdown/pointerup，沉浸态里
// 原有的"点击翻页/切章"处理器必须只认主键（event.button === 0），否则会把侧键
// 当成一次点击，跟这里的动作叠加（见 enterEpubImmersive/enterGalleryImmersive）。
// 还有一点实测出来的：浏览器原生的后退/前进导航是在 mouseup 时触发的，只在
// mousedown 里 preventDefault 拦不住（实测按一下后退键页面直接被导航到上一条历史），
// 实测只有 mouseup / pointerup 的 preventDefault 能拦住，mousedown / pointerdown /
// auxclick 都不行。所以 mousedown 里接管了这次按键就记一笔，对应的 mouseup 再拦。
// 没接管的场景（没在沉浸态、不是媒体浏览）不拦，浏览器的后退前进照常工作。
let sideButtonHandled = false
document.addEventListener('mousedown', (event) => {
  if (event.button !== 3 && event.button !== 4) return
  sideButtonHandled = false
  const delta = event.button === 3 ? -1 : 1
  // 图集沉浸态：「媒体浏览」里的图集和「图片浏览」tab 共用同一个
  // enterGalleryImmersive，不管当前在哪个视图，侧键都等价于分段模式的上下
  // 虚拟键点一下（跳一屏），所以放在 mediaViewerView 判断之前。
  if (galleryImmersiveJumpOnce) {
    event.preventDefault()
    sideButtonHandled = true
    galleryImmersiveJumpOnce(delta)
    return
  }
  if (!els.mediaViewerView?.classList.contains('active')) return
  const contentClass = els.mediaReaderContent?.classList
  if (contentClass?.contains('media-html')) {
    event.preventDefault()
    sideButtonHandled = true
    goPage(delta)
    // 沉浸条上的"n / m"页码要自己刷新：原来点击翻页的 onUp 翻完会 setTimeout(syncInfo)，
    // 这里没走那条路径就得补上，不然页面翻了、标签一直停在旧页码。
    // （跨章时整页重渲染会再同步一次，这里只管章内翻页。）
    syncEpubImmersive()
  } else if (contentClass?.contains('media-stream')) {
    if (!currentStreamSeekBy) return
    event.preventDefault()
    sideButtonHandled = true
    const seconds = Math.max(1, Math.min(120, Math.round(Number(localStorage.getItem('copymanga.mediaSeekSeconds'))) || 10))
    currentStreamSeekBy(delta * seconds)
  }
})
document.addEventListener('mouseup', (event) => {
  if (event.button !== 3 && event.button !== 4) return
  if (!sideButtonHandled) return
  sideButtonHandled = false
  event.preventDefault()
}, true)
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

// 执行所有页：用当前筛选条件逐页翻，对搜出来的全部媒体执行。
// 每页都重新请求而不是先把所有 itemId 收齐——库可能很大，一次性拉全量既慢又占内存；
// 而且脚本执行本身就会改 tag，收齐的那份快照反而可能是过期的。
els.libraryRunAllTagScripts?.addEventListener('click', async () => {
  const actionIds = checkedTagScriptIds('library-tag-script')
  if (!actionIds.length) return alert('请选择元数据脚本')
  const limit = Math.max(1, Number(els.libraryLimit?.value || 10))
  let head
  try {
    head = await api(`/api/library/items?${libraryQueryParams(1, limit)}`)
  } catch (error) {
    return alert(`读取媒体列表失败：${error.message}`)
  }
  const meta = pageMeta(head, 1, limit)
  const total = meta.total || pageItems(head).length
  if (!total) return alert('当前搜索条件下没有媒体')
  if (!confirm(`将按当前搜索条件，对 ${meta.totalPages} 页共 ${total} 个媒体执行选中的元数据脚本。\n`
    + '这会排很多任务且无法中途撤销，确定继续？')) return

  const button = els.libraryRunAllTagScripts
  const original = button.textContent
  button.disabled = true
  let done = 0
  const failed = []
  try {
    for (let page = 1; page <= meta.totalPages; page += 1) {
      button.textContent = `第 ${page}/${meta.totalPages} 页`
      // 每页重新取：前面几页跑完后排序可能已经变（按更新时间排时尤其明显）。
      // 这点无法根治，所以把实际处理数报出来，让人能对账。
      const payload = await api(`/api/library/items?${libraryQueryParams(page, limit)}`)
      for (const item of pageItems(payload)) {
        try {
          await api(`/api/library/items/${encodeURIComponent(item.type)}/${encodeURIComponent(item.itemId)}/metadata-actions`, {
            method: 'POST',
            body: JSON.stringify({ actionIds, force: true }),
          })
          done += 1
        } catch (error) {
          failed.push(`${item.title || item.itemId}: ${error.message}`)
        }
      }
    }
  } finally {
    button.disabled = false
    button.textContent = original
  }
  await loadTagManager().catch(() => {})
  alert(failed.length
    ? `已提交 ${done} 个，失败 ${failed.length} 个：\n${failed.slice(0, 10).join('\n')}`
    : `已提交 ${done} 个媒体的脚本任务。任务队列同时只跑一个，完成需要时间。`)
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
  // 「执行所有页」只要求选了脚本：它自己按筛选条件重新查，不依赖当前页已加载的内容。
  // 当初漏掉这行，按钮永远是 disabled——HTML 里写死了 disabled，没人解除就是个死按钮。
  if (els.libraryRunAllTagScripts) els.libraryRunAllTagScripts.disabled = !hasScripts
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
    // batch 方案（RJ）以前不发这个字段，页面上勾什么都没用。现在一律发，
    // 服务端优先用它，只有字段缺失时才退回方案默认。
    if (metadataActionIds.length) form.set('metadataActionIds', metadataActionIds.join(','))
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
// 沉浸按钮服务全部四种内容：epub 分页、图集滚动、音视频播放。按类型分流。
function galleryImmersiveOptions(remember) {
  return {
    view: els.mediaViewerView,
    content: els.mediaReaderContent,
    toggle: els.mediaImmersive,
    kind: 'images',
    remember,
    chapter: {
      // EPUB 的图片集是书内的一个 section，章号要按 section 走；
      // 媒体库图集没有 section，才按 unit 走（显示「第几个 unit / 共几个」）
      label: () => (currentMediaReader?.section
        ? `${currentMediaReader.section.index + 1} / ${currentMediaReader.sections?.length || 1}`
        : `${Number(currentMediaReader?.unit?.index || 0) + 1} / ${currentLibraryUnits.length}`),
      canPrev: () => Boolean(mediaStepTarget('prev')),
      canNext: () => Boolean(mediaStepTarget('next')),
      prev: () => { mediaStepTarget('prev')?.() },
      next: () => { mediaStepTarget('next')?.() },
      back: () => els.mediaReaderBack?.click(),
    },
  }
}

els.mediaImmersive?.addEventListener('click', () => {
  const type = currentMediaReader?.type
  if (type === 'audio' || type === 'video') {
    currentStreamImmersiveToggle?.(!els.mediaViewerView.classList.contains('stream-page-fullscreen'))
    return
  }
  if (type === 'images') {
    enterGalleryImmersive(galleryImmersiveOptions(true))
    return
  }
  enterEpubImmersive({ remember: true })
})
els.mediaWidthAdjust?.addEventListener('click', toggleWidthAdjust)
// 从 URL 直接落在阅读器上的标签页，媒体库页从没加载过（列表是空的）。第一次"返回"借用
// 目标 tab 自己的点击处理器把它加载出来，效果和用户手点那个 tab 完全一样。普通标签页
// 不走这条：它的媒体库页早就加载好了，重载会丢掉滚动位置。
let readerTabNeedsLibraryLoad = Boolean(bootMediaRoute)
els.mediaReaderBack.addEventListener('click', () => {
  const target = mediaReturnView || 'library-view'
  if (readerTabNeedsLibraryLoad) {
    readerTabNeedsLibraryLoad = false
    const tab = els.tabs.find((candidate) => candidate.dataset.view === target)
    if (tab) { tab.click(); return }
  }
  showView(target)
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
// 顶栏的「返回」按当前视图分流，目标和各自页内那个「返回」一致。
// 沉浸态下顶栏贴上边缘才会滑出，但它确实够得到，比 chapter-head 里那个强。
els.globalBack?.addEventListener('click', () => {
  const active = els.views.find((view) => view.classList.contains('active'))?.id
  if (active === 'media-viewer-view') els.mediaReaderBack?.click()
  else if (active === 'viewer-view') els.viewerBack?.click()
})
els.viewerNext.addEventListener('click', () => openAdjacentViewer('next'))
// 图片浏览 tab 没有整本的章节表（navigation 只给 prev/next），所以 toc: false
function viewerImmersiveOptions(remember) {
  return {
    view: els.viewerView,
    content: els.viewerImages,
    toggle: els.viewerImmersive,
    kind: 'viewer',
    remember,
    chapter: {
      toc: false,
      label: () => viewerState?.title || '',
      canPrev: () => Boolean(viewerState?.navigation?.prev),
      canNext: () => Boolean(viewerState?.navigation?.next),
      prev: () => openAdjacentViewer('prev'),
      next: () => openAdjacentViewer('next'),
      back: () => els.viewerBack?.click(),
    },
  }
}

els.viewerImmersive?.addEventListener('click', () => {
  enterGalleryImmersive(viewerImmersiveOptions(true))
})
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
// 右侧面板上半部分（标题/标签输入/脚本列表/执行按钮）折叠起来，把高度让给章节列表。
// 折叠时标题和这个按钮本身要留着：全收掉就没有展开的入口了，而标题是唯一能确认
// 「当前看的是哪个条目」的东西。状态记进 localStorage，和侧栏折叠同一套做法。
function applyLibraryDetailCollapsed(collapsed) {
  if (!els.libraryDetailPanel || !els.libraryDetailToggle) return
  els.libraryDetailPanel.classList.toggle('detail-collapsed', collapsed)
  els.libraryDetailToggle.textContent = collapsed ? '⌄' : '⌃'
  els.libraryDetailToggle.title = collapsed ? '展开上方操作区' : '收起上方操作区，只看章节列表'
  els.libraryDetailToggle.setAttribute('aria-expanded', String(!collapsed))
}

applyLibraryDetailCollapsed(localStorage.getItem('copymanga.libraryDetailCollapsed') === '1')

els.libraryDetailToggle?.addEventListener('click', () => {
  const collapsed = !els.libraryDetailPanel.classList.contains('detail-collapsed')
  applyLibraryDetailCollapsed(collapsed)
  localStorage.setItem('copymanga.libraryDetailCollapsed', collapsed ? '1' : '0')
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
        jobPollIntervalMs: Number(els.configJobPollIntervalMs.value),
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
        epubTtsApiBase: els.configEpubTtsApiBase.value,
        epubTtsSpeakerAudio: els.configEpubTtsSpeakerAudio.value,
        epubTtsPromptAudio: els.configEpubTtsPromptAudio.value,
        epubTtsPromptText: els.configEpubTtsPromptText.value,
        epubTtsTextLanguage: els.configEpubTtsTextLanguage.value,
        epubTtsPromptLanguage: els.configEpubTtsPromptLanguage.value,
        epubTtsMaxConcurrency: Number(els.configEpubTtsMaxConcurrency.value),
        epubTtsBatchMaxSentences: Number(els.configEpubTtsBatchMaxSentences.value),
        epubTtsBatchMaxChars: Number(els.configEpubTtsBatchMaxChars.value),
        mediaSubtitleExtensions: els.configMediaSubtitleExtensions.value,
        mediaOpenInNewTab: els.configMediaOpenInNewTab.checked,
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

// 后台同步 = 实时事件流（EventSource /api/events）+ 任务兜底轮询 + 首屏用的几个全局状态。
// 它们只服务于漫画下载那一侧：/api/events 推的是 job/jobDelete（下载任务进度）、
// imageCheck（本地漫画图片检查）、inventoryUpdate（本地库存更新），媒体库阅读器一个都用不上。
// 原来是模块加载时无条件执行；改成函数，从 URL 直接落在阅读器上的标签页（见 bootMediaRoute）
// 启动时不跑，等它离开阅读器去别的页面时（showView）才启动。开很多个阅读器标签页时，
// 每个都开一条 SSE 长连接 + 5 秒轮询纯属浪费，而且 HTTP/1.1 下浏览器对同一主机只给约 6 个
// 并发连接，长连接占满会拖慢别的请求。幂等：重复调用是空操作。
function startBackgroundSync() {
  if (backgroundSyncStarted) return
  backgroundSyncStarted = true
  const events = new EventSource('/api/events')
  events.addEventListener('open', () => { syncJobs().catch(() => {}) })
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
  api('/api/inventory-update').then(renderInventoryUpdate).catch(() => {})
  applyJobPolling()
}
// 任务的实时更新本来就走 SSE（/api/events），这里的轮询只是兜底：
// emit() 没写 id 字段，EventSource 重连拿不到 Last-Event-ID，断线期间的事件补不回来。
// 侧栏那个 ⟳ 按钮控制开关，状态存 localStorage，刷新页面后保持。
function jobPollEnabled() {
  return localStorage.getItem(JOB_POLL_KEY) !== '0'   // 默认开
}

function applyJobPolling() {
  if (jobPollTimer) {
    clearInterval(jobPollTimer)
    jobPollTimer = null
  }
  const enabled = jobPollEnabled()
  if (els.toggleJobPoll) {
    els.toggleJobPoll.classList.toggle('active', enabled)
    els.toggleJobPoll.setAttribute('aria-pressed', enabled ? 'true' : 'false')
    els.toggleJobPoll.title = enabled ? `任务兜底轮询：开（每 ${Math.round(jobPollIntervalMs / 1000)} 秒）` : '任务兜底轮询：关'
  }
  // 后台同步还没启动（阅读器标签页）时只更新上面的按钮状态，不起定时器：loadConfig 读到
  // 轮询间隔配置也会调到这里，不拦的话阅读器标签页照样每 5 秒轮询一次。
  // startBackgroundSync 会在启动时再调一次，那时才真正开始。
  if (!enabled || !backgroundSyncStarted) return
  jobPollTimer = setInterval(() => {
    syncJobs().catch(() => {})
  }, Math.max(1000, jobPollIntervalMs))
}

els.toggleJobPoll?.addEventListener('click', () => {
  const next = !jobPollEnabled()
  localStorage.setItem(JOB_POLL_KEY, next ? '1' : '0')
  applyJobPolling()
  if (next) syncJobs().catch(() => {})   // 刚打开立刻对齐一次，不干等一个周期
})

// 打开一条媒体路由：深链启动和 hashchange（在已开着的标签页里改 URL）共用。
async function openMediaRoute({ type, itemId, unitId, sectionId }) {
  // 先切到阅读器视图再加载：openMediaUnit 靠"打开前是哪个视图"来记 mediaReturnView，
  // 深链启动时当前视图是默认的搜索页，不先切的话"返回"会回到漫画搜索而不是媒体库。
  showView('media-viewer-view')
  // URL 里没带章节：和点"继续"一样按历史记录续读，续读位置完全一致
  if (!unitId) return resumeLibraryItem(type, itemId)
  // 带了章节：先选中条目（填好目录/阅读进度），再开章节，这样 EPUB 能从上次滚动位置接着读。
  // 这个顺序和"历史页打开"是同一套（见 resumeLibraryItem）。
  await selectLibraryItem(type, itemId)
  return openMediaUnit(unitId, sectionId)
}

// 在一个已经开着的标签页里改 URL（比如粘贴了别人发的链接）不会重新加载页面，只触发
// hashchange。自己 replaceState 写 URL 不会触发它，所以不会自己打开自己；这里再比对一次
// 当前路由，相同就不重复打开。
window.addEventListener('hashchange', () => {
  const route = parseMediaRoute()
  if (!route) return
  const cur = currentMediaRoute
  if (cur && cur.type === route.type && cur.itemId === route.itemId
    && cur.unitId === route.unitId && cur.sectionId === route.sectionId) return
  openMediaRoute(route).catch((error) => alert(error.message))
})

// —— 启动 ——
loadConfig().catch(() => {})
if (bootMediaRoute) {
  // 阅读器标签页：直接落在阅读器上，不启动后台同步。侧栏的任务列表靠模块顶层那次
  // api('/api/jobs') 拿到一次快照（所有标签页启动时都会跑），之后它不会实时更新，直到
  // 这个标签页离开阅读器去别的页面（showView 会启动后台同步）。
  openMediaRoute(bootMediaRoute).catch((error) => alert(error.message))
} else {
  startBackgroundSync()
}
