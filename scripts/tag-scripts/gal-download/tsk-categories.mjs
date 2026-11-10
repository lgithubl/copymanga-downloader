// Business categories come from catalog paths, independent of file formats (include).
// Unknown resources stay in other and are retained unless explicitly skipped.
export const TSK_CATEGORIES = {
  scenario: '剧情 / Master 表',
  cutin: 'Cutin 演出骨架 / 纹理',
  'adventure-spine': '剧情特效骨架',
  'adventure-texture': '剧情特效图片 / 骨架',
  'event-entry': '活动入口图片',
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
  'recommend': '推荐展示',
  'skill': '技能图标 / 按钮',
  'login-bonus': '登录奖励图片',
  'home-background': '主页背景 / 分层图片',
  'world-raid': '世界 Raid 图片 / 背景骨架',
  'profile': '个人资料装饰',
  'trophy': '奖杯 / 成就图片',
  'sub-tutorial': '子教程图片',
  'special-site': '专题页素材',
  'mini-game': '小游戏素材',
  'common-icon': '通用图标',
  'theme': '主题图片',
  'ui': '通用 UI',
  'story-ui': '剧情菜单图片 / 骨架',
  'stamp': '印章图片',
  'campaign': '活动加成图片',
  'home-ui': '主页按钮',
  'tutorial': '教程图片',
  'home-shade': '主页角色阴影',
  'mission': '任务界面图片',
  'character-thumb-001': '角色图标 Thumb_001',
  'character-thumb-002': '角色图标 Thumb_002',
  'character-thumb-003': '角色图标 Thumb_003',
  'character-thumb-004': '角色图标 Thumb_004',
  'character-thumb-005': '角色图标 Thumb_005',
  'character-thumb-006': '角色图标 Thumb_006',
  'character-thumb-007': '角色图标 Thumb_007',
  'character-thumb-008': '角色图标 Thumb_008',
  'character-thumb-009': '角色图标 Thumb_009',
  other: '其他 / 未识别分类'
}

// Exact catalog folders; no guessed role for numbered thumbnail groups.
const SPRITE_CATEGORIES = {
  'recommend': 'recommend',
  'skill': 'skill',
  'loginbonus': 'login-bonus',
  'bg': 'home-background',
  'worldraidevent': 'world-raid',
  'profile': 'profile',
  'trophy': 'trophy',
  'subtutorial': 'sub-tutorial',
  'specialsite': 'special-site',
  'minigame': 'mini-game',
  'icon': 'common-icon',
  'theme': 'theme',
  'ui': 'ui',
  'story': 'story-ui',
  'stamp': 'stamp',
  'campaign': 'campaign',
  'home': 'home-ui',
  'tutorial': 'tutorial',
  'homeshade': 'home-shade',
  'mission': 'mission',
}

export const TSK_CATEGORY_PARENTS = {
  'recommend': 'other',
  'skill': 'other',
  'login-bonus': 'other',
  'home-background': 'other',
  'world-raid': 'other',
  'profile': 'other',
  'trophy': 'other',
  'sub-tutorial': 'other',
  'special-site': 'other',
  'mini-game': 'other',
  'common-icon': 'other',
  'theme': 'other',
  'ui': 'other',
  'story-ui': 'other',
  'stamp': 'other',
  'campaign': 'other',
  'home-ui': 'other',
  'tutorial': 'other',
  'home-shade': 'other',
  'mission': 'other',
  'character-thumb-001': 'character-icon',
  'character-thumb-002': 'character-icon',
  'character-thumb-003': 'character-icon',
  'character-thumb-004': 'character-icon',
  'character-thumb-005': 'character-icon',
  'character-thumb-006': 'character-icon',
  'character-thumb-007': 'character-icon',
  'character-thumb-008': 'character-icon',
  'character-thumb-009': 'character-icon',
}

export function classifyTskAsset(asset) {
  const relative = asset.replace(/^Assets\/AssetBundles\//i, '').replace(/^Assets\//i, '').toLowerCase()
  if (relative.startsWith('adventure/backgrounds/')) return 'background'
  if (relative.startsWith('cutin/')) return 'cutin'
  if (relative.startsWith('adventure/spine/')) return 'adventure-spine'
  if (relative.startsWith('adventure/textures/')) return 'adventure-texture'
  if (relative.startsWith('sprites/evententry/')) return 'event-entry'
  if (relative.startsWith('adventure/')) return 'scenario'
  if (relative.startsWith('stills/')) return 'still'
  if (relative.startsWith('characters/')) return 'character'
  if (relative.startsWith('gachacharaanim/')) return 'gacha-animation'
  if (relative.startsWith('sound/voice/')) return 'voice'
  if (relative.startsWith('sound/bgvoice/')) return 'bgvoice'
  if (relative.startsWith('sound/bgm/')) return 'bgm'
  if (/^sound\/(?:bgse|se)\//.test(relative)) return 'se'
  if (relative.startsWith('sprites/chara/')) {
    if (/(?:^|\/)enemy_[^/]+$/.test(relative)) return 'enemy-icon'
    const thumb = /^sprites\/chara\/thumb_(00[1-9])\//.exec(relative)
    return thumb ? `character-thumb-${thumb[1]}` : 'character-icon'
  }
  if (relative.startsWith('sprites/picturebook/')) return 'picturebook'
  if (relative.startsWith('sprites/eventquest/') || /^sprites\/banner\/.*\/m_event_/.test(relative)) return 'event'
  if (relative.startsWith('sprites/gacha/') || /^sprites\/banner\/.*\/m_gacha_/.test(relative)) return 'gacha-ui'
  if (relative.startsWith('sprites/shop/')) return 'shop'
  if (relative.startsWith('sprites/equip/')) return 'equipment'
  if (relative.startsWith('sprites/item/')) return 'item'
  if (relative.startsWith('sprites/startupnotification/')) return 'announcement'
  if (relative.startsWith('sprites/banner/')) return 'banner'
  const folder = /^sprites\/([^/]+)\//.exec(relative)?.[1]
  return Object.hasOwn(SPRITE_CATEGORIES, folder) ? SPRITE_CATEGORIES[folder] : 'other'
}
