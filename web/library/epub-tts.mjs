// GSV-TTS-Lite 是参考音频克隆音色（speaker_audio/prompt_audio），不是挑 voice 枚举。
// 用 docker/web_app.py 的 /api/tts——这是 Dockerfile.web 唯一真实跑起来的入口
// （CMD 里写死 uvicorn docker.web_app:app），跟 API/personal_api.py 是两个不同的
// 服务：没有批量接口、一次只能传一句 text，也不支持 return_subtitles，响应直接
// 是音频字节（FileResponse），不是 JSON。之前照着 personal_api.py 的
// /tts/batched 写的，那个接口形状对不上用户实际部署的 Docker 服务，改了。
// 参考：GSV-TTS-Lite 仓库 docker/web_app.py

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

