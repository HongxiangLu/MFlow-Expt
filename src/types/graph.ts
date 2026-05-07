import type { SessionId } from './api'

export type GraphQueryRequest = {
  query: string
  session_id: SessionId
}

export type GraphNodeType =
  | 'artifact'
  | 'dynasty'
  | 'material'
  | 'category'
  | 'pattern'
  | 'site'
  | 'craft'
  | 'inscription'
  | 'usage'
  | 'concept'
  | 'person'
  | 'collection'
  | 'other'
  | (string & {})

export type GraphNode = {
  id: string
  label: string
  nodeType: GraphNodeType
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  label: string
  weight?: number
}

export type GraphResponse = {
  graphId: string
  centerNodeId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}
