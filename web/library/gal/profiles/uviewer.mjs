// UViewer（Tauri 应用）资源包的目录方案。
// UViewer 自己把这些位置写死在后端里（静态分析 exe 字符串得到，不是配置）：
//   <resource_path>/download/adv/text/<character|cabin|room|other>/…  脚本；资源（背景/BGM/语音/立绘…）在 <resource_path>/download/…
//   user_data/settings.json（resource_path、script_language…）、user_data/character_names.json、user_data/thumbnails/<id>.webp
// 我们不照搬它的 4 个固定分类：浏览直接走真实目录树（所以 event/quest/gacha/memorial/tutorial 也看得到），
// 这里只负责「认出这种布局 + 目录名的中文标签 + 缩略图去哪找」。
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { safeRelPath } from './paths.mjs'

const TEXT_DIR = 'download/adv/text'

// 目录名 → 中文标签（只是显示用的小字典，缺的就显示原目录名）
const DIR_LABELS = {
  cabin: '纪念馆', character: '角色', room: '房间', other: '其他', event: '活动', gacha: '扭蛋', memorial: '回忆', quest: '任务', tutorial: '教程',
  adultr: '成人向', extra: '额外',
}

const isDir = async (p) => { try { return (await stat(p)).isDirectory() } catch { return false } }

export const uviewerProfile = {
  id: 'uviewer',
  label: 'UViewer 资源包',
  stripPrefixes: [],
  scriptExtensions: ['txt'],
  // 认得：resource_path（settings.json，默认 ./resources）下有 download/adv/text。
  // 同级以 text 开头的目录（比如 text---日文…，是用户换汉化文本时留下的备份）当作可切换的另一套文本
  async detect(mediaDir) {
    let resourceRoot = 'resources'
    try {
      const settings = JSON.parse(await readFile(path.join(mediaDir, 'user_data', 'settings.json'), 'utf8'))
      const configured = safeRelPath(settings?.resource_path)
      if (configured) resourceRoot = configured
    } catch { /* 没有 settings.json：用默认 */ }
    if (!(await isDir(path.join(mediaDir, resourceRoot, TEXT_DIR)))) return null
    const advDir = path.join(mediaDir, resourceRoot, 'download', 'adv')
    const sets = [{ id: 'text', dir: `${resourceRoot}/${TEXT_DIR}`, label: 'text' }]
    try {
      for (const entry of (await readdir(advDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && entry.name !== 'text' && entry.name.startsWith('text') && !entry.name.includes('|') && !entry.name.includes('#')) {
          sets.push({ id: entry.name, dir: `${resourceRoot}/download/adv/${entry.name}`, label: entry.name })
        }
      }
    } catch { /* 没有同级目录 */ }
    return { scriptRoots: sets, resourceRoot, namesFile: 'user_data/character_names.json', thumbsDir: 'user_data/thumbnails', stripPrefixes: [] }
  },
  dirLabel: (name) => DIR_LABELS[name] || '',
  // 角色目录（文本里是 4 位角色 id）的头像：download/character/<6 位>/adv/image/<6 位>.png，6 位 = 4 位 id + 2 位形态
  dirThumbs: ({ name, parentName }) => (parentName === 'character' && /^\d{4}$/.test(name)
    ? [`download/character/${name}00/adv/image/${name}00.png`, `download/character/${name}00/adv/image/${name}00_100.png`]
    : []),
  // UViewer 自己生成的脚本缩略图（auto_generate_thumbnails）：user_data/thumbnails/<脚本 id>.webp，以 ~/ 表示相对媒体目录
  scriptThumbs: ({ stem, thumbsDir }) => (thumbsDir ? [`~/${thumbsDir}/${stem}.webp`, `~/${thumbsDir}/scripts/${stem}.webp`] : []),
}
