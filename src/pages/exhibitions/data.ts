import type { ModuleMeta } from '../dashboard/types'

export const exhibitionsModuleMeta: ModuleMeta = {
  label: '展览',
  path: '/dashboard/exhibitions',
  sidebarTitle: '展览信息',
  sidebarSubtitle: 'EXHIBITIONS',
  sidebarDescription: '该模块适合承载常设展、专题展和临展信息，后续可以加入展期、重点展项、预约入口和策展故事。',
  stageTitle: '展览内容主舞台',
  stageDescription: '这里后续可以承载展览海报、展览列表、时间轴以及专题策展页面。',
  detailTitle: '展览模块规划',
  detailIntro: '当前先建立独立路由和页面占位，方便后续把展览数据、时间信息和专题详情逐步迁移进来。',
  highlights: ['支持常设展和临展两类数据结构', '可展示展期、地点、重点作品和策展说明', '后续适合接预约与活动入口'],
}
