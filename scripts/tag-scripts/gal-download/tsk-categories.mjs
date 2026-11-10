// Business categories come from catalog paths, independent of file formats (include).
// Unknown resources stay in other and are retained unless explicitly skipped.
export const TSK_CATEGORIES = {
  scenario: '剧情 / Master 表',
  still: 'CG / 场景骨架',
  character: '角色立绘 / 骨架',
  background: '剧情背景',
  voice: '角色语音',
  bgvoice: '背景语音',
  bgm: '背景音乐',
  se: '音效 / 背景音效',
  'character-icon': '角色图标 / 头像',
  'enemy-icon': '敌人图标',
  picturebook: '图鉴图片',
  event: '活动图片 / 活动横幅',
  'gacha-animation': '抽卡角色动画',
  'gacha-ui': '抽卡界面 / 抽卡横幅',
  shop: '商店商品图片',
  equipment: '装备图标',
  item: '道具图标',
  announcement: '启动公告',
  banner: '其他横幅',
  other: '其他 / 未识别分类'
}

export function classifyTskAsset(asset) {
  const relative = asset.replace(/^Assets\/AssetBundles\//i, '').replace(/^Assets\//i, '').toLowerCase()
  if (relative.startsWith('adventure/backgrounds/')) return 'background'
  if (relative.startsWith('adventure/')) return 'scenario'
  if (relative.startsWith('stills/')) return 'still'
  if (relative.startsWith('characters/')) return 'character'
  if (relative.startsWith('gachacharaanim/')) return 'gacha-animation'
  if (relative.startsWith('sound/voice/')) return 'voice'
  if (relative.startsWith('sound/bgvoice/')) return 'bgvoice'
  if (relative.startsWith('sound/bgm/')) return 'bgm'
  if (/^sound\/(?:bgse|se)\//.test(relative)) return 'se'
  if (relative.startsWith('sprites/chara/')) return /(?:^|\/)enemy_[^/]+$/.test(relative) ? 'enemy-icon' : 'character-icon'
  if (relative.startsWith('sprites/picturebook/')) return 'picturebook'
  if (relative.startsWith('sprites/eventquest/') || /^sprites\/banner\/.*\/m_event_/.test(relative)) return 'event'
  if (relative.startsWith('sprites/gacha/') || /^sprites\/banner\/.*\/m_gacha_/.test(relative)) return 'gacha-ui'
  if (relative.startsWith('sprites/shop/')) return 'shop'
  if (relative.startsWith('sprites/equip/')) return 'equipment'
  if (relative.startsWith('sprites/item/')) return 'item'
  if (relative.startsWith('sprites/startupnotification/')) return 'announcement'
  if (relative.startsWith('sprites/banner/')) return 'banner'
  return 'other'
}
