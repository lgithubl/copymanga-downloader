// GSV-TTS-Lite 是参考音频克隆音色（speaker_audio/prompt_audio），不是挑 voice 枚举。
// 用的是 docker/web_app.py（Dockerfile.web 唯一真实跑的入口，CMD 写死
// uvicorn docker.web_app:app）。disable-auto-download 分支给它加回了
// /tts/batched（之前只有单句 /api/tts，没有批量接口，这里走过一次弯路）。
// 两个都留着：单句走 /api/tts，批量走 /tts/batched，用在哪由 resolveEpubTtsChunks
// 按一次请求里缺几句来选——见那边的注释。
// 参考：GSV-TTS-Lite 仓库 docker/web_app.py（disable-auto-download 分支）

const REQUEST_TIMEOUT_MS = 60000

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// 返回 { text, buffer, subtitle, error }。单句一次请求，失败只影响这一句，
// 调用方据此跳过、不中断整体朗读。subtitle 恒为 null——/api/tts 没有这个数据，
// 前端的高亮逻辑本来就准备了「没有 subtitle 就退化成 currentTime/duration」的分支。
export async function callGsvTts({ apiBase, speakerAudio, promptAudio, promptText, text }) {
  if (!speakerAudio || !promptAudio) {
    return { text, error: '未配置参考音频（speakerAudio/promptAudio）' }
  }
  const base = String(apiBase || '').replace(/\/+$/, '')
  let response
  try {
    response = await fetchWithTimeout(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        speaker_audio: speakerAudio,
        prompt_audio: promptAudio,
        prompt_text: promptText || undefined,
      }),
    })
  } catch (error) {
    return { text, error: `GSV-TTS-Lite 请求失败: ${error.message}` }
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    return { text, error: `GSV-TTS-Lite 返回 ${response.status}: ${raw.slice(0, 200)}` }
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  return { text, buffer, subtitle: null }
}

// 返回 [{ text, buffer, subtitle, error }]，和入参 texts 一一对应，顺序不变。
// /tts/batched 是整批成功或整批报错（没有"这批里哪句失败了"的细粒度信息），
// 失败就把这批里每一句都标 error，调用方据此逐句跳过，不中断整体朗读。
export async function callGsvTtsBatched({ apiBase, speakerAudio, promptAudio, promptText, texts }) {
  if (!texts.length) return []
  if (!speakerAudio || !promptAudio) {
    return texts.map((text) => ({ text, error: '未配置参考音频（speakerAudio/promptAudio）' }))
  }
  const base = String(apiBase || '').replace(/\/+$/, '')
  let response
  try {
    response = await fetchWithTimeout(`${base}/tts/batched`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts,
        speaker_audio: speakerAudio,
        prompt_audio: promptAudio,
        prompt_text: promptText || undefined,
        return_subtitles: true,
      }),
    })
  } catch (error) {
    const message = `GSV-TTS-Lite 请求失败: ${error.message}`
    return texts.map((text) => ({ text, error: message }))
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    const message = `GSV-TTS-Lite 返回 ${response.status}: ${raw.slice(0, 200)}`
    return texts.map((text) => ({ text, error: message }))
  }
  const payload = await response.json()
  if (!payload.success || !Array.isArray(payload.filenames)) {
    return texts.map((text) => ({ text, error: `GSV-TTS-Lite 响应格式异常: ${JSON.stringify(payload).slice(0, 200)}` }))
  }
  const results = []
  for (let i = 0; i < texts.length; i++) {
    const filename = payload.filenames[i]
    if (!filename) {
      results.push({ text: texts[i], error: '未返回对应的音频文件名' })
      continue
    }
    try {
      const audioRes = await fetchWithTimeout(`${base}/audio/${filename}`, { method: 'GET' })
      if (!audioRes.ok) throw new Error(`取音频文件失败 ${audioRes.status}`)
      const buffer = Buffer.from(await audioRes.arrayBuffer())
      results.push({ text: texts[i], buffer, subtitle: payload.subtitles?.[i] || null })
    } catch (error) {
      results.push({ text: texts[i], error: error.message })
    }
  }
  return results
}


