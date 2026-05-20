export type DashboardView = 'collection' | 'search' | 'ai-guide' | 'tour' | 'exhibitions'

export type ArtifactFact = {
  label: string
  value: string
}

export type CollectionItem = {
  id: string
  name: string
  meta: string
  summary: string
  badge: string
  period: string
  material: string
  origin: string
  hall: string
  size: string
  modelUrl?: string
  description: string[]
  highlights: string[]
}

export type ModuleMeta = {
  label: string
  path: string
  sidebarTitle: string
  sidebarSubtitle: string
  sidebarDescription: string
  stageTitle: string
  stageDescription: string
  detailTitle: string
  detailIntro: string
  highlights: string[]
}
