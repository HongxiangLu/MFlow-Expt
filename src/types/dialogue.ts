import type { SessionId } from './api'

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
