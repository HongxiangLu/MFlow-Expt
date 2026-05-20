import type { ModuleMeta } from '../dashboard/types'

export const searchModuleMeta: ModuleMeta = {
  label: '检索',
  path: '/dashboard/search',
  sidebarTitle: '文物智能检索',
  sidebarSubtitle: 'SEARCH & DISCOVERY',
  sidebarDescription: '该模块将承载按名称、朝代、材质、纹饰和专题标签进行组合检索的能力，并支持从结果直接跳转到文物详情。',
  stageTitle: '检索结果工作区',
  stageDescription: '这里后续可以承载搜索表单、结果列表、筛选条件和智能推荐。',
  detailTitle: '检索模块规划',
  detailIntro: '当前先完成路由拆分，后续可以将输入框、筛选器、结果卡片与详情联动逐步接入。',
  highlights: ['支持关键词与多维筛选并存', '结果区可扩展为瀑布流或卡片矩阵', '可与 AI 问答、图谱和详情页形成跳转链路'],
}
