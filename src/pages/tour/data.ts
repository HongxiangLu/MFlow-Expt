import type { ModuleMeta } from '../dashboard/types'

export const tourModuleMeta: ModuleMeta = {
  label: '导览',
  path: '/dashboard/tour',
  sidebarTitle: '馆内导览',
  sidebarSubtitle: 'TOUR NAVIGATION',
  sidebarDescription: '该模块适合承载楼层、展厅、路线和重点展品的导览能力，后续可以叠加动线推荐和参观时长估算。',
  stageTitle: '导览主视图',
  stageDescription: '这里后续可以承载路线地图、楼层切换、展厅关系和当前位置提示。',
  detailTitle: '导览模块规划',
  detailIntro: '目前先拆成独立路由页面，后续可以接平面图、路线卡片、推荐路径与导览讲解内容。',
  highlights: ['支持按主题和时长生成参观路线', '可接馆内地图与展厅关系图', '适合与移动端定位和讲解播放联动'],
}
