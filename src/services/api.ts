import axios from 'axios'

export const apiPaths = {
  chat: '/api/chat',
  bookList: '/api/book/books',
  bookContent: (bookId: string) => `/api/book/books/${bookId}/content`,
  bookChapterContent: (chapterId: string) => `/api/book/chapters/${chapterId}/content`,
  bookGraph: '/api/book/graph',
  bookGraphNodeSources: (nodeId: string) => `/api/book/graph/nodes/${nodeId}/sources`,
  bookChat: '/api/book/chat',
  graphQuery: '/api/graph/query',
} as const

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export type RequestOptions = {
  signal?: AbortSignal
}

export const http = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
})

export function getApiUrl(path: string) {
  return `${apiBaseUrl.replace(/\/$/, '')}${path}`
}
