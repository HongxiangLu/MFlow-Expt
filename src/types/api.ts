export type ApiValidationError = {
  loc?: Array<string | number>
  msg?: string
  type?: string
}

export type ApiErrorResponse = {
  detail: string | ApiValidationError[]
}

export type SessionId = string

export type ChatRequest = {
  query: string
  session_id: SessionId
}

export type ChatFinishReason = null | 'stop'

export type ChatSseFrame = {
  chunk: string
  finish_reason: ChatFinishReason
}

export type ChatSseErrorCode =
  | 'llm_timeout'
  | 'llm_rate_limit'
  | 'llm_error'
  | 'retrieval_error'
  | 'internal_error'
  | (string & {})

export type ChatSseErrorEvent = {
  code: ChatSseErrorCode
  message: string
}

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
