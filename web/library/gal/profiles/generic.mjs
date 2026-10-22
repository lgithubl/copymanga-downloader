// 兜底方案：不认识的目录。整个媒体目录就是脚本根，脚本里的相对路径直接按媒体目录解析（找不到再去掉 download/ 前缀试一次）。
export const genericProfile = {
  id: 'generic',
  label: '通用目录',
  stripPrefixes: ['download/'],
  scriptExtensions: ['txt', 'csv'],
  async detect() {
    return { scriptRoots: [{ id: '', dir: '', label: '' }], resourceRoot: '', namesFile: '', thumbsDir: '', stripPrefixes: ['download/'] }
  },
  // 目录/脚本的显示钩子（通用方案什么都不加）
  dirLabel: () => '',
  dirThumbs: () => [],
  scriptThumbs: () => [],
}
