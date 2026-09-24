const els = {
  token: document.querySelector('#token'),
  username: document.querySelector('#username'),
  password: document.querySelector('#password'),
  login: document.querySelector('#login'),
  keyword: document.querySelector('#keyword'),
  search: document.querySelector('#search'),
  results: document.querySelector('#results'),
  tabs: [...document.querySelectorAll('.tab')],
  views: [...document.querySelectorAll('.view')],
  chapters: document.querySelector('#chapters'),
  comicTitle: document.querySelector('#comic-title'),
  download: document.querySelector('#download'),
  jobs: document.querySelector('#jobs'),
  favoriteOrdering: document.querySelector('#favorite-ordering'),
  favoriteRefresh: document.querySelector('#favorite-refresh'),
  favorites: document.querySelector('#favorites'),
  downloadedRefresh: document.querySelector('#downloaded-refresh'),
  downloaded: document.querySelector('#downloaded'),
}

let currentComicPathWord = ''
let jobs = []
let downloaded = []

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

function renderComicCards(container, list) {
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
      showView('search-view')
      loadComic(pathWord)
    })
    container.append(card)
  }
  if (list.length === 0) container.innerHTML = '<p class="muted">没有结果</p>'
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

function renderComic(data) {
  currentComicPathWord = data.comic?.path_word || data.comic?.pathWord || data.path_word || ''
  els.comicTitle.textContent = data.comic?.name || data.name || '章节'
  els.download.disabled = false
  els.chapters.innerHTML = ''

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
    els.chapters.append(group)
  }
}

function renderJobs() {
  els.jobs.innerHTML = ''
  const sorted = [...jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  for (const job of sorted) {
    const total = Math.max(job.totalImages || job.totalChapters || 1, 1)
    const done = job.totalImages ? job.doneImages : job.doneChapters
    const pct = Math.min(100, Math.round((done / total) * 100))
    const el = document.createElement('article')
    el.className = 'job'
    el.innerHTML = `
      <strong>${escapeHtml(job.comicTitle || job.comicPathWord || job.id)}</strong>
      <div class="muted">${escapeHtml(job.status)} · ${escapeHtml(job.message || '')}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="muted">${done}/${total}</div>
    `
    els.jobs.append(el)
  }
  if (sorted.length === 0) els.jobs.innerHTML = '<p class="muted">暂无任务</p>'
}

async function loadComic(pathWord) {
  if (!pathWord) return
  els.chapters.innerHTML = '<p class="muted">加载章节中...</p>'
  const data = await api(`/api/comic/${encodeURIComponent(pathWord)}`)
  renderComic(data)
}

async function refreshDownloadedState() {
  downloaded = await api('/api/downloaded')
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
    if (tab.dataset.view === 'favorite-view') loadFavorite()
    if (tab.dataset.view === 'downloaded-view') loadDownloaded()
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
els.downloadedRefresh.addEventListener('click', loadDownloaded)

els.keyword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.search.click()
})

els.download.addEventListener('click', async () => {
  const chapterUuids = [...els.chapters.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value)
  if (chapterUuids.length === 0) return alert('请先勾选章节')
  try {
    setLoading(els.download, true)
    const job = await api('/api/download', {
      method: 'POST',
      body: JSON.stringify({
        comicPathWord: currentComicPathWord,
        chapterUuids,
        token: els.token.value.trim(),
      }),
    })
    jobs = [job, ...jobs.filter((item) => item.id !== job.id)]
    renderJobs()
  } catch (error) {
    alert(error.message)
  } finally {
    setLoading(els.download, false)
  }
})

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

refreshDownloadedState().catch(() => {})
